// src/lib/messages.ts
var DEFAULT_PREFS = { direction: "asc", scope: "current" };
var PREFS_KEY = "prefs";

// src/popup/popup.ts
function pick(selector) {
  const el = document.querySelector(selector);
  if (!el)
    throw new Error(`Missing element: ${selector}`);
  return el;
}
async function loadPrefs() {
  const stored = await chrome.storage.sync.get(PREFS_KEY);
  return { ...DEFAULT_PREFS, ...stored[PREFS_KEY] };
}
async function savePrefs(prefs) {
  await chrome.storage.sync.set({ [PREFS_KEY]: prefs });
}
function readForm() {
  const direction = pick('input[name="direction"]:checked').value;
  const scope = pick('input[name="scope"]:checked').value;
  return { direction, scope };
}
function applyForm(prefs) {
  pick(`input[name="direction"][value="${prefs.direction}"]`).checked = true;
  pick(`input[name="scope"][value="${prefs.scope}"]`).checked = true;
}
async function init() {
  applyForm(await loadPrefs());
  for (const input of document.querySelectorAll('input[name="direction"], input[name="scope"]')) {
    input.addEventListener("change", () => void savePrefs(readForm()));
  }
  const status = pick("#status");
  pick("#sort").addEventListener("click", async () => {
    const prefs = readForm();
    await savePrefs(prefs);
    status.textContent = "Sorting…";
    const request = { type: "SORT", ...prefs };
    try {
      const res = await chrome.runtime.sendMessage(request);
      if (res?.ok) {
        status.textContent = res.moved && res.moved > 0 ? `Sorted ${res.moved} tab${res.moved === 1 ? "" : "s"}.` : "Already sorted.";
      } else {
        status.textContent = `Error: ${res?.error ?? "no response"}`;
      }
    } catch (err) {
      status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  });
}
document.addEventListener("DOMContentLoaded", () => void init());
