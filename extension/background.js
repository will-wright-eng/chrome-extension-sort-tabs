// src/lib/sort.ts
var WEB_SCHEMES = new Set(["http", "https"]);
function effectiveUrl(tab) {
  if (tab.url && tab.url.length > 0)
    return tab.url;
  if (tab.pendingUrl && tab.pendingUrl.length > 0)
    return tab.pendingUrl;
  return "";
}
function schemeOf(rawUrl) {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(rawUrl);
  return match ? match[1].toLowerCase() : "";
}
function sortKey(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    parsed = null;
  }
  if (parsed) {
    const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
    const host = parsed.hostname.toLowerCase();
    if (WEB_SCHEMES.has(scheme) && host.length > 0) {
      const fqdn = host.endsWith(".") ? host.slice(0, -1) : host;
      return { bucket: 0, key: fqdn.split(".").reverse().join(".") };
    }
    return { bucket: 1, key: scheme };
  }
  return { bucket: 1, key: schemeOf(rawUrl) };
}
function compare(a, b, dir) {
  if (a.key.bucket !== b.key.bucket)
    return a.key.bucket - b.key.bucket;
  if (a.key.key !== b.key.key)
    return (a.key.key < b.key.key ? -1 : 1) * dir;
  if (a.title !== b.title)
    return a.title < b.title ? -1 : 1;
  return a.pos - b.pos;
}
function orderTabs(tabs, direction = "asc") {
  const dir = direction === "desc" ? -1 : 1;
  const decorate = (tab, pos) => ({
    tab,
    pos,
    key: sortKey(effectiveUrl(tab)),
    title: (tab.title ?? "").toLowerCase()
  });
  const pinned = [];
  const unpinned = [];
  tabs.forEach((tab, pos) => (tab.pinned ? pinned : unpinned).push(decorate(tab, pos)));
  const sortGroup = (group) => group.sort((a, b) => compare(a, b, dir)).map((d) => d.tab);
  return [...sortGroup(pinned), ...sortGroup(unpinned)];
}
function isAlreadyOrdered(current, ordered) {
  if (current.length !== ordered.length)
    return false;
  for (let i = 0;i < current.length; i++) {
    const a = current[i];
    const b = ordered[i];
    if (a === b)
      continue;
    if (a.id !== undefined && b.id !== undefined) {
      if (a.id !== b.id)
        return false;
    } else if (a !== b) {
      return false;
    }
  }
  return true;
}

// src/lib/messages.ts
var DEFAULT_PREFS = { direction: "asc", scope: "current" };
var PREFS_KEY = "prefs";

// src/background.ts
async function getPrefs() {
  const stored = await chrome.storage.sync.get(PREFS_KEY);
  return { ...DEFAULT_PREFS, ...stored[PREFS_KEY] };
}
async function sortWindow(windowId, direction) {
  const tabs = await chrome.tabs.query({ windowId });
  const current = [...tabs].sort((a, b) => a.index - b.index);
  if (current.length <= 1)
    return 0;
  const ordered = orderTabs(current, direction);
  if (isAlreadyOrdered(current, ordered))
    return 0;
  let changed = 0;
  for (let i = 0;i < ordered.length; i++) {
    const tab = ordered[i];
    if (tab.id === undefined)
      continue;
    await chrome.tabs.move(tab.id, { index: i });
    if (current[i]?.id !== tab.id)
      changed++;
  }
  return changed;
}
async function handleSort(req) {
  try {
    if (req.scope === "all") {
      const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
      let moved = 0;
      for (const win of windows) {
        if (win.id !== undefined)
          moved += await sortWindow(win.id, req.direction);
      }
      return { ok: true, moved, windows: windows.length };
    }
    const win = await chrome.windows.getCurrent();
    if (win.id === undefined)
      return { ok: false, error: "No current window." };
    const moved = await sortWindow(win.id, req.direction);
    return { ok: true, moved, windows: 1 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SORT") {
    handleSort(message).then(sendResponse);
    return true;
  }
  return false;
});
globalThis.__domainTabSorter = {
  sortWindow,
  handleSort,
  getPrefs
};
