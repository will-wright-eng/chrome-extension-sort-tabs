/**
 * Background service worker. Owns the sort routine and responds to `SORT`
 * messages from the popup. Reads no origins and injects no scripts — it only
 * queries and reorders tabs.
 */

import { isAlreadyOrdered, orderTabs, type Direction } from "./lib/sort";
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  type Prefs,
  type SortRequest,
  type SortResponse,
} from "./lib/messages";

async function getPrefs(): Promise<Prefs> {
  const stored = await chrome.storage.sync.get(PREFS_KEY);
  return { ...DEFAULT_PREFS, ...(stored[PREFS_KEY] as Partial<Prefs> | undefined) };
}

/**
 * Reorder every tab in one window. Returns the number of tabs whose position
 * changed (0 for an empty/single-tab or already-sorted window — FR-8).
 */
async function sortWindow(windowId: number, direction: Direction): Promise<number> {
  const tabs = await chrome.tabs.query({ windowId });
  const current = [...tabs].sort((a, b) => a.index - b.index);
  if (current.length <= 1) return 0;

  const ordered = orderTabs(current, direction);
  if (isAlreadyOrdered(current, ordered)) return 0;

  // Move each tab to its target index in order. Because pinned tabs lead the
  // ordered list they receive the lowest indices, satisfying Chrome's
  // pinned-tabs-first constraint automatically.
  let changed = 0;
  for (let i = 0; i < ordered.length; i++) {
    const tab = ordered[i];
    if (tab.id === undefined) continue;
    await chrome.tabs.move(tab.id, { index: i });
    if (current[i]?.id !== tab.id) changed++;
  }
  return changed;
}

async function handleSort(req: SortRequest): Promise<SortResponse> {
  try {
    if (req.scope === "all") {
      const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
      let moved = 0;
      for (const win of windows) {
        if (win.id !== undefined) moved += await sortWindow(win.id, req.direction);
      }
      return { ok: true, moved, windows: windows.length };
    }

    const win = await chrome.windows.getCurrent();
    if (win.id === undefined) return { ok: false, error: "No current window." };
    const moved = await sortWindow(win.id, req.direction);
    return { ok: true, moved, windows: 1 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

chrome.runtime.onMessage.addListener(
  (message: SortRequest, _sender, sendResponse: (response: SortResponse) => void) => {
    if (message?.type === "SORT") {
      handleSort(message).then(sendResponse);
      return true; // keep the message channel open for the async response
    }
    return false;
  },
);

// Testing hook: lets the e2e suite drive the exact same sort code path with an
// explicit window id (see tests/e2e/sort.e2e.ts). Harmless in production.
(globalThis as unknown as Record<string, unknown>).__domainTabSorter = {
  sortWindow,
  handleSort,
  getPrefs,
};
