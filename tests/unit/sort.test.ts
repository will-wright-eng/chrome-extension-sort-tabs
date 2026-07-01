import { describe, expect, test } from "bun:test";
import {
  effectiveUrl,
  isAlreadyOrdered,
  orderTabs,
  sortKey,
  type TabLike,
} from "../../src/lib/sort";

let nextId = 1;
function tab(partial: Partial<TabLike> & { url?: string }): TabLike {
  return { id: nextId++, pinned: false, ...partial };
}

/** Order a list of URLs (all unpinned) and return the resulting URL order. */
function orderUrls(urls: string[], direction: "asc" | "desc" = "asc"): string[] {
  const tabs = urls.map((url) => tab({ url }));
  return orderTabs(tabs, direction).map((t) => t.url ?? "");
}

describe("sortKey", () => {
  test("reverses host labels for web tabs", () => {
    expect(sortKey("https://mail.google.com/inbox")).toEqual({
      bucket: 0,
      key: "com.google.mail",
    });
    expect(sortKey("http://github.com")).toEqual({ bucket: 0, key: "com.github" });
  });

  test("lower-cases the host", () => {
    expect(sortKey("https://GitHub.COM/foo").key).toBe("com.github");
  });

  test("buckets non-web schemes at the end, keyed by scheme", () => {
    expect(sortKey("chrome://extensions")).toEqual({ bucket: 1, key: "chrome" });
    expect(sortKey("about:blank")).toEqual({ bucket: 1, key: "about" });
    expect(sortKey("file:///Users/me/x.txt")).toEqual({ bucket: 1, key: "file" });
    expect(sortKey("chrome-extension://abc/page.html")).toEqual({
      bucket: 1,
      key: "chrome-extension",
    });
    expect(sortKey("edge://settings")).toEqual({ bucket: 1, key: "edge" });
  });

  test("treats unparseable URLs as non-web", () => {
    expect(sortKey("not a url").bucket).toBe(1);
    expect(sortKey("").bucket).toBe(1);
  });

  test("ignores port and userinfo when keying", () => {
    expect(sortKey("https://user:pass@a.test:8443/x").key).toBe("test.a");
  });

  test("normalizes a fully-qualified trailing dot so it groups with its sibling", () => {
    expect(sortKey("https://example.com./a").key).toBe("com.example");
    expect(sortKey("https://example.com/b").key).toBe("com.example");
  });
});

describe("effectiveUrl", () => {
  test("falls back to pendingUrl when url is empty", () => {
    expect(effectiveUrl({ url: "", pendingUrl: "https://x.com" })).toBe("https://x.com");
    expect(effectiveUrl({ pendingUrl: "https://y.com" })).toBe("https://y.com");
    expect(effectiveUrl({ url: "https://z.com", pendingUrl: "https://x.com" })).toBe(
      "https://z.com",
    );
    expect(effectiveUrl({})).toBe("");
  });
});

describe("orderTabs", () => {
  test("groups subdomains and orders domains alphabetically (FR-1)", () => {
    expect(
      orderUrls([
        "https://mail.google.com",
        "https://github.com",
        "https://docs.google.com",
        "https://google.com",
      ]),
    ).toEqual([
      "https://github.com",
      "https://google.com",
      "https://docs.google.com",
      "https://mail.google.com",
    ]);
  });

  test("puts non-web tabs after web tabs (FR-3)", () => {
    expect(orderUrls(["chrome://extensions", "https://github.com"])).toEqual([
      "https://github.com",
      "chrome://extensions",
    ]);
  });

  test("descending reverses the web bucket but keeps non-web tabs last (FR-4)", () => {
    expect(
      orderUrls(
        ["https://a.com", "https://b.com", "chrome://version", "https://c.com"],
        "desc",
      ),
    ).toEqual(["https://c.com", "https://b.com", "https://a.com", "chrome://version"]);
  });

  test("descending keeps subdomain grouping intact", () => {
    expect(
      orderUrls(
        ["https://mail.google.com", "https://github.com", "https://google.com"],
        "desc",
      ),
    ).toEqual(["https://mail.google.com", "https://google.com", "https://github.com"]);
  });

  test("pinned tabs stay ahead of unpinned tabs and sort among themselves (FR-2)", () => {
    const tabs = [
      tab({ url: "https://z-unpinned.com", pinned: false }),
      tab({ url: "https://b-pinned.com", pinned: true }),
      tab({ url: "https://a-unpinned.com", pinned: false }),
      tab({ url: "https://a-pinned.com", pinned: true }),
    ];
    const result = orderTabs(tabs, "asc");
    expect(result.map((t) => t.pinned)).toEqual([true, true, false, false]);
    expect(result.map((t) => t.url)).toEqual([
      "https://a-pinned.com",
      "https://b-pinned.com",
      "https://a-unpinned.com",
      "https://z-unpinned.com",
    ]);
  });

  test("is stable for tabs sharing a host (tie-break by original order)", () => {
    const tabs = [
      tab({ id: 10, url: "https://example.com/first", title: "same" }),
      tab({ id: 20, url: "https://example.com/second", title: "same" }),
      tab({ id: 30, url: "https://example.com/third", title: "same" }),
    ];
    expect(orderTabs(tabs, "asc").map((t) => t.id)).toEqual([10, 20, 30]);
    // Same-host tabs keep original order even under descending direction.
    expect(orderTabs(tabs, "desc").map((t) => t.id)).toEqual([10, 20, 30]);
  });

  test("tie-breaks equal-host tabs by title", () => {
    const tabs = [
      tab({ id: 1, url: "https://example.com/b", title: "Beta" }),
      tab({ id: 2, url: "https://example.com/a", title: "Alpha" }),
    ];
    expect(orderTabs(tabs, "asc").map((t) => t.id)).toEqual([2, 1]);
  });

  test("no-op for 0 or 1 tab (FR-8)", () => {
    expect(orderTabs([], "asc")).toEqual([]);
    const one = [tab({ url: "https://only.com" })];
    expect(orderTabs(one, "asc")).toEqual(one);
  });

  test("does not mutate the input array", () => {
    const tabs = [tab({ url: "https://b.com" }), tab({ url: "https://a.com" })];
    const snapshot = tabs.map((t) => t.url);
    orderTabs(tabs, "asc");
    expect(tabs.map((t) => t.url)).toEqual(snapshot);
  });
});

describe("isAlreadyOrdered", () => {
  test("true when order matches by id", () => {
    const a = tab({ id: 1, url: "https://a.com" });
    const b = tab({ id: 2, url: "https://b.com" });
    expect(isAlreadyOrdered([a, b], [a, b])).toBe(true);
  });

  test("false when order differs", () => {
    const a = tab({ id: 1, url: "https://a.com" });
    const b = tab({ id: 2, url: "https://b.com" });
    expect(isAlreadyOrdered([a, b], [b, a])).toBe(false);
  });

  test("compares by id across structurally-distinct objects (not reference identity)", () => {
    // Different object instances that share ids in the same order -> equal.
    const current = [tab({ id: 1, url: "https://a.com" }), tab({ id: 2, url: "https://b.com" })];
    const ordered = [tab({ id: 1, url: "https://a.com" }), tab({ id: 2, url: "https://b.com" })];
    expect(isAlreadyOrdered(current, ordered)).toBe(true);
    // Same instances, mismatched ids in the second list -> not equal.
    const swapped = [tab({ id: 2, url: "https://b.com" }), tab({ id: 1, url: "https://a.com" })];
    expect(isAlreadyOrdered(current, swapped)).toBe(false);
  });

  test("an already-sorted list orders to itself", () => {
    const tabs = [
      tab({ id: 1, url: "https://github.com" }),
      tab({ id: 2, url: "https://google.com" }),
    ];
    expect(isAlreadyOrdered(tabs, orderTabs(tabs, "asc"))).toBe(true);
  });
});
