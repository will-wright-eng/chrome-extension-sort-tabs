/**
 * Popup controller. Loads/saves preferences and asks the background service
 * worker to sort. The popup carries all controls — there is no options page.
 */

import {
  DEFAULT_PREFS,
  PREFS_KEY,
  type Direction,
  type Prefs,
  type Scope,
  type SortRequest,
  type SortResponse,
} from "../lib/messages";

function pick<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

async function loadPrefs(): Promise<Prefs> {
  const stored = await chrome.storage.sync.get(PREFS_KEY);
  return { ...DEFAULT_PREFS, ...(stored[PREFS_KEY] as Partial<Prefs> | undefined) };
}

async function savePrefs(prefs: Prefs): Promise<void> {
  await chrome.storage.sync.set({ [PREFS_KEY]: prefs });
}

function readForm(): Prefs {
  const direction = pick<HTMLInputElement>('input[name="direction"]:checked').value as Direction;
  const scope = pick<HTMLInputElement>('input[name="scope"]:checked').value as Scope;
  return { direction, scope };
}

function applyForm(prefs: Prefs): void {
  pick<HTMLInputElement>(`input[name="direction"][value="${prefs.direction}"]`).checked = true;
  pick<HTMLInputElement>(`input[name="scope"][value="${prefs.scope}"]`).checked = true;
}

async function init(): Promise<void> {
  applyForm(await loadPrefs());

  for (const input of document.querySelectorAll('input[name="direction"], input[name="scope"]')) {
    input.addEventListener("change", () => void savePrefs(readForm()));
  }

  const status = pick<HTMLParagraphElement>("#status");
  pick<HTMLButtonElement>("#sort").addEventListener("click", async () => {
    const prefs = readForm();
    await savePrefs(prefs);
    status.textContent = "Sorting…";

    const request: SortRequest = { type: "SORT", ...prefs };
    try {
      const res = (await chrome.runtime.sendMessage(request)) as SortResponse | undefined;
      if (res?.ok) {
        status.textContent =
          res.moved && res.moved > 0
            ? `Sorted ${res.moved} tab${res.moved === 1 ? "" : "s"}.`
            : "Already sorted.";
      } else {
        status.textContent = `Error: ${res?.error ?? "no response"}`;
      }
    } catch (err) {
      status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => void init());
