/**
 * End-to-end verification against a real Chrome with the extension loaded
 * unpacked in new-headless mode (§7.2).
 *
 * A tiny local server answers every `*.test` host (mapped to 127.0.0.1 via
 * --host-resolver-rules), so no internet access is needed. Ordering is checked
 * two ways: through the extension's own service worker (deterministic per-window
 * cases) and through the real popup button -> runtime message path (FR-7).
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type BrowserContext, type Page, type Worker } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");

let server: ReturnType<typeof Bun.serve>;
let port: number;
let userDataDir: string;
let context: BrowserContext;
let sw: Worker;

/** Service-worker console errors, collected from the moment each worker appears. */
const swErrors: string[] = [];
const watched = new WeakSet<Worker>();
function watchWorker(worker: Worker): void {
  if (watched.has(worker)) return;
  watched.add(worker);
  worker.on("console", (msg) => {
    if (msg.type() === "error") swErrors.push(msg.text());
  });
}

async function launch(dir: string): Promise<{ context: BrowserContext; sw: Worker }> {
  // Playwright's *bundled* Chromium build supports extensions in new-headless
  // mode; the default headless-shell and system Chrome channels do not.
  // Requires `bunx playwright install chromium` (see RUN.md).
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      "--host-resolver-rules=MAP *.test 127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  // Subscribe as early as possible so startup console errors are captured
  // (for the pre-existing worker and any later respawn).
  ctx.on("serviceworker", watchWorker);
  const existing = ctx.serviceWorkers()[0];
  const worker = existing ?? (await ctx.waitForEvent("serviceworker", { timeout: 30_000 }));
  watchWorker(worker);
  return { context: ctx, sw: worker };
}

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const host = new URL(req.url).hostname;
      return new Response(
        `<!doctype html><html><head><title>${host}</title></head><body>${host}</body></html>`,
        { headers: { "content-type": "text/html" } },
      );
    },
  });
  if (server.port === undefined) throw new Error("server has no port");
  port = server.port;

  userDataDir = await mkdtemp(join(tmpdir(), "dts-e2e-"));
  ({ context, sw } = await launch(userDataDir));
});

afterAll(async () => {
  await context?.close();
  server?.stop(true);
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

function extensionId(worker: Worker): string {
  return new URL(worker.url()).host;
}

/** Poll the context's pages for one matching `url`. */
async function findPage(url: string): Promise<Page> {
  for (let i = 0; i < 100; i++) {
    const page = context.pages().find((p) => p.url() === url);
    if (page) return page;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`page not found: ${url}`);
}

/** Create a fresh window with the given tab urls; returns the window id. */
async function makeWindow(sortWorker: Worker, urls: string[]): Promise<number> {
  return sortWorker.evaluate(async (tabUrls: string[]) => {
    const win = await chrome.windows.create({ url: tabUrls, focused: true });
    if (!win || win.id === undefined) throw new Error("window has no id");
    // Wait until every tab has committed a real URL (not the initial about:blank).
    for (let i = 0; i < 50; i++) {
      const tabs = await chrome.tabs.query({ windowId: win.id });
      const ready =
        tabs.length >= tabUrls.length &&
        tabs.every((t) => (t.url ?? t.pendingUrl ?? "").length > 0);
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return win.id;
  }, urls);
}

/** Read the tab order of a window as [{ url, pinned }]. */
async function readOrder(
  sortWorker: Worker,
  windowId: number,
): Promise<Array<{ url: string; pinned: boolean }>> {
  return sortWorker.evaluate(async (id: number) => {
    const tabs = (await chrome.tabs.query({ windowId: id })).sort((a, b) => a.index - b.index);
    return tabs.map((t) => ({ url: t.url || t.pendingUrl || "", pinned: t.pinned }));
  }, windowId);
}

test("service worker starts up cleanly with no console errors", async () => {
  expect(sw.url()).toContain("background.js");
  // A successful round-trip proves the top-level startup ran to completion —
  // the test hook is assigned at the very end of background.ts, so it only
  // exists if nothing threw on the way there.
  const hookType = await sw.evaluate(
    () => typeof (self as unknown as Record<string, unknown>).__domainTabSorter,
  );
  expect(hookType).toBe("object");
  // Give any startup console errors a chance to flush, then assert none.
  await new Promise((r) => setTimeout(r, 250));
  expect(swErrors).toEqual([]);
});

test("groups by domain with pinned first and non-web last (FR-1, FR-2, FR-3)", async () => {
  const windowId = await makeWindow(sw, [
    `http://b.test:${port}/`,
    `http://a.test:${port}/`,
    `http://sub.a.test:${port}/`,
    `http://z.test:${port}/`,
  ]);

  // Pin the z.test tab and add a chrome:// tab, then sort ascending.
  await sw.evaluate(
    async ({ windowId: id, portNum }: { windowId: number; portNum: number }) => {
      await chrome.tabs.create({ windowId: id, url: "chrome://version/", active: false });
      const tabs = await chrome.tabs.query({ windowId: id });
      const z = tabs.find((t) => (t.url ?? t.pendingUrl ?? "").includes(`z.test:${portNum}`));
      if (z?.id) await chrome.tabs.update(z.id, { pinned: true });
      const api = (self as unknown as { __domainTabSorter: { sortWindow: (w: number, d: string) => Promise<number> } })
        .__domainTabSorter;
      await api.sortWindow(id, "asc");
    },
    { windowId, portNum: port },
  );

  const order = await readOrder(sw, windowId);

  // Pinned z.test leads even though its domain would otherwise sort last.
  expect(order[0].pinned).toBe(true);
  expect(order[0].url).toContain("z.test");

  const unpinned = order.filter((o) => !o.pinned).map((o) => o.url);
  // Web tabs grouped/sorted (test.a < test.a.sub < test.b), chrome:// last.
  expect(unpinned[0]).toContain("a.test");
  expect(unpinned[1]).toContain("sub.a.test");
  expect(unpinned[2]).toContain("b.test");
  expect(unpinned[3]).toContain("chrome://version");
});

test("descending reverses web order, chrome:// still last (FR-4)", async () => {
  const windowId = await makeWindow(sw, [
    `http://a.test:${port}/`,
    `http://b.test:${port}/`,
    `http://c.test:${port}/`,
  ]);
  await sw.evaluate(async (id: number) => {
    await chrome.tabs.create({ windowId: id, url: "chrome://version/", active: false });
    const api = (self as unknown as { __domainTabSorter: { sortWindow: (w: number, d: string) => Promise<number> } })
      .__domainTabSorter;
    await api.sortWindow(id, "desc");
  }, windowId);

  const urls = (await readOrder(sw, windowId)).map((o) => o.url);
  expect(urls[0]).toContain("c.test");
  expect(urls[1]).toContain("b.test");
  expect(urls[2]).toContain("a.test");
  expect(urls[3]).toContain("chrome://version");
});

test("single-tab window is a safe no-op (FR-8)", async () => {
  const windowId = await makeWindow(sw, [`http://solo.test:${port}/`]);
  const moved = await sw.evaluate((id: number) => {
    const api = (self as unknown as { __domainTabSorter: { sortWindow: (w: number, d: string) => Promise<number> } })
      .__domainTabSorter;
    return api.sortWindow(id, "asc");
  }, windowId);
  expect(moved).toBe(0);
});

test("sorting via the popup button uses the real runtime message path (FR-7)", async () => {
  const windowId = await makeWindow(sw, [
    `http://b.test:${port}/`,
    `http://a.test:${port}/`,
    `http://sub.a.test:${port}/`,
  ]);

  const popupUrl = `chrome-extension://${extensionId(sw)}/popup.html`;
  // Leave only the test window open, then add the popup as a tab in it, so
  // scope:'current' (resolved by handleSort via chrome.windows.getCurrent —
  // headless focus is unreliable) unambiguously targets this window.
  await sw.evaluate(
    async ({ id, url }: { id: number; url: string }) => {
      const wins = await chrome.windows.getAll();
      for (const w of wins) {
        if (w.id !== undefined && w.id !== id) await chrome.windows.remove(w.id);
      }
      await chrome.tabs.create({ windowId: id, url, active: true });
      await chrome.windows.update(id, { focused: true });
    },
    { id: windowId, url: popupUrl },
  );

  const popup = await findPage(popupUrl);
  await popup.waitForSelector("#sort");
  await popup.check('input[name="direction"][value="asc"]');
  await popup.check('input[name="scope"][value="current"]');
  await popup.click("#sort");

  // The status text only updates after handleSort responds over the real
  // chrome.runtime message channel (popup.sendMessage -> onMessage -> handleSort).
  await popup.waitForFunction(
    () => {
      const t = document.querySelector("#status")?.textContent ?? "";
      return t.length > 0 && !t.includes("Sorting");
    },
    undefined,
    { timeout: 15_000 },
  );
  const status = (await popup.textContent("#status")) ?? "";
  expect(status.startsWith("Error")).toBe(false);
  expect(status.startsWith("Sorted") || status === "Already sorted.").toBe(true);

  const order = await readOrder(sw, windowId);
  const web = order.filter((o) => o.url.startsWith("http")).map((o) => o.url);
  expect(web[0]).toContain("a.test");
  expect(web[1]).toContain("sub.a.test");
  expect(web[2]).toContain("b.test");
  // The extension popup page is non-web and sinks to the end.
  expect(order[order.length - 1].url).toContain("popup.html");
});

test("popup persists the direction preference across a restart (FR-4, FR-6)", async () => {
  const before = await context.newPage();
  await before.goto(`chrome-extension://${extensionId(sw)}/popup.html`);
  await before.waitForSelector('input[name="direction"][value="desc"]');
  // Selecting Z–A fires the popup's change handler -> savePrefs() (real path).
  await before.check('input[name="direction"][value="desc"]');
  // Confirm the popup actually wrote it to storage.sync before we restart.
  await before.waitForFunction(
    async () => {
      const s = await chrome.storage.sync.get("prefs");
      return (s.prefs as { direction?: string } | undefined)?.direction === "desc";
    },
    undefined,
    { timeout: 10_000 },
  );

  await context.close();
  ({ context, sw } = await launch(userDataDir));

  // Reopen the popup; its init() runs loadPrefs() -> applyForm(), which should
  // restore and check the Z–A radio from persisted storage.
  const after = await context.newPage();
  await after.goto(`chrome-extension://${extensionId(sw)}/popup.html`);
  await after.waitForSelector('input[name="direction"][value="desc"]:checked', {
    timeout: 10_000,
  });
  expect(await after.isChecked('input[name="direction"][value="desc"]')).toBe(true);
});
