# Domain Tab Sorter — Chrome Extension Design Specification

> **Purpose.** A build-and-verify specification for an autonomous coding agent (e.g. Claude Code).
> It defines what to build, how to build it, how to prove it works, and what environment access
> the agent needs.
>
> **Definition of done.** Every item in *§8 Acceptance Criteria* passes and the deliverables in
> *§10* exist.
>
> **Default decisions.** A few UX/behavior choices were made to keep v1 focused; each is flagged
> **`[DECISION]`** so you can flip it before handoff.

---

## 1. Product Overview

- **Name:** Domain Tab Sorter
- **One-line description:** Reorders the tabs in a Chrome window so tabs from the same domain are grouped together and ordered alphabetically by domain.
- **Target browser:** Google Chrome (and Chromium/Edge, which share the same APIs).
- **Manifest version:** Manifest V3 (required — Chrome no longer accepts MV2).
- **User problem:** Long, chaotic tab strips make it hard to find related pages. One click groups everything by site.

---

## 2. Functional Requirements

- **FR-1 — Sort current window.** When the user triggers a sort, all tabs in the current window are reordered so that tabs sharing a registrable domain are adjacent, and domains are ordered alphabetically. Subdomains of the same domain stay grouped (e.g. `docs.google.com` and `mail.google.com` sit next to each other).
- **FR-2 — Pinned tabs preserved.** Pinned tabs remain pinned and stay ahead of all unpinned tabs. They are sorted among themselves using the same rule; unpinned tabs are sorted among themselves. *(Pinned tabs must occupy the lowest indices — Chrome enforces this.)*
- **FR-3 — Non-web tabs bucketed.** Tabs without a normal web host (`chrome://`, `about:`, `file://`, `chrome-extension://`, `edge://`, etc.) are grouped together at the end, after all http/https tabs. **`[DECISION]`** (alternative: leave them in place).
- **FR-4 — Sort direction.** The user can choose ascending (A–Z, default) or descending (Z–A). Non-web tabs remain at the end regardless of direction.
- **FR-5 — Scope.** Sorting applies to the current window by default. **`[DECISION]`** An "all windows" option may be offered (each window sorted independently); v1 default is current window only.
- **FR-6 — Preferences persist.** Sort direction and scope persist across browser restarts (`chrome.storage.sync`).
- **FR-7 — Trigger.** Clicking the toolbar icon opens a popup with a **Sort tabs** button plus the direction/scope controls. **`[DECISION]`** Alternative: one-click sort via `chrome.action.onClicked` with no popup, moving preferences to a dedicated options page.
- **FR-8 — Safe no-ops.** A window with 0 or 1 tabs, or one already sorted, completes without error and makes no unnecessary moves.

### Edge cases to handle gracefully
- Tabs still loading — read `tab.url` and fall back to `tab.pendingUrl` when `url` is empty.
- A tab whose URL cannot be parsed — treat as a non-web tab (FR-3 bucket).
- Existing Chrome **tab groups** — see §9; v1 does not preserve grouping and may split groups. Document this clearly.

---

## 3. Technical Architecture

### Components
- **Background service worker** (`background.ts`) — hosts the sort routine; receives a message from the popup and performs the tab moves.
- **Popup** (`popup.html` / `popup.ts`) — Sort button, direction toggle (A–Z / Z–A), scope selector; reads/writes preferences.
- **No content scripts, no options page** in v1 (popup carries the controls).

### Permissions
- `"tabs"` — required to read each tab's `url`/`title` and to reorder tabs. *Store-review note: this surfaces the "Read your browsing history" warning to users; it is unavoidable for reading tab URLs and should be disclosed in the store listing.*
- `"storage"` — persist preferences.
- **No `host_permissions`** — the extension never injects scripts or contacts any origin.

### Sort algorithm (the heart of the extension — factor this into a pure, testable function)
For each tab, compute a sort key from its URL:

```
function sortKey(url):
    host = hostname(url)                     # may be empty for chrome://, file://, etc.
    if host is empty or url is not http(s):
        return { bucket: 1, key: scheme(url) }     # non-web tabs, grouped at the end
    key = host.split('.').reverse().join('.')      # "mail.google.com" -> "com.google.mail"
    return { bucket: 0, key }
```

Sort by `(bucket, key)`; tie-break by title then original index for stability. Reversing the
host labels reliably clusters `*.google.com` together and orders by TLD → domain → subdomain
**without any external dependency**.

> **Optional refinement.** For strict registrable-domain grouping across multi-part suffixes
> (e.g. `bbc.co.uk`), compute eTLD+1 using the Public Suffix List (`psl` package). Not required
> for v1 — the label-reversal key keeps real domains adjacent in practice.

### Applying the order
1. Query tabs: `chrome.tabs.query({ currentWindow: true })`.
2. Partition into pinned and unpinned; sort each partition with the comparator above (respecting direction).
3. Concatenate: sorted pinned first, then sorted unpinned.
4. Move each tab to its target index in order via `chrome.tabs.move(tabId, { index })`. Because pinned tabs lead the ordered list, they naturally receive the lowest indices and satisfy Chrome's pinned-tab constraint.

---

## 4. Project Structure (target)

```
domain-tab-sorter/
  manifest.json
  src/
    background.ts
    popup/
      popup.html
      popup.ts
    lib/
      sort.ts            # pure sortKey + ordering logic (unit-tested)
  assets/
    icons/               # 16, 32, 48, 128 px
  tests/
    unit/sort.test.ts
    e2e/sort.e2e.ts
  package.json
  tsconfig.json
```

---

## 5. Environment & Access Requirements

### 5.1 Build & static checks (minimum grant)
- **Filesystem:** read/write to the project directory.
- **Shell:** run the package manager and build/test scripts.
- **Node.js:** 20 LTS.
- **Network:** access to the npm registry (`registry.npmjs.org` or your mirror) for install. *If the sandbox uses a domain allowlist, permit it or installs fail.*

### 5.2 Runtime verification (additional grant)
- **Chrome/Chromium binary** installed in the environment.
- **Launch capability:** start Chrome with the unpacked extension (`--load-extension=<dir>` and `--disable-extensions-except=<dir>`).
- **Display context:** `--headless=new` (the legacy headless mode does **not** support extensions) *or* Xvfb.
- **E2E driver:** Playwright (recommended) or Puppeteer.
- **External network:** **none required.** The extension calls no external service. For e2e, distinct hostnames are produced locally (see §7.2), so no internet access is needed at runtime.

### 5.3 Not granted (human-gated — see §9)
Chrome Web Store developer account, signing, and publishing credentials.

---

## 6. Build Pipeline

1. **Install:** `npm ci`
2. **Typecheck:** `tsc --noEmit`
3. **Lint:** `eslint .`
4. **Build:** `vite build` (or esbuild) → `dist/`
5. **Package:** zip `dist/` → `domain-tab-sorter.zip`

Build must complete with zero errors and zero lint errors.

---

## 7. Verification Plan

### 7.1 Static verification (headless, always run)
- Build, typecheck, and lint pass.
- **Manifest validity:** valid MV3, declares `service_worker`, requests only `tabs` and `storage`, no host permissions.
- **Unit tests for `lib/sort.ts`** (pure function — no browser needed). Required cases:
  - Groups subdomains: `[mail.google.com, github.com, docs.google.com, google.com]` → `[github.com, google.com, docs.google.com, mail.google.com]`.
  - Non-web tabs bucket last: `[chrome://extensions, github.com]` → `[github.com, chrome://extensions]`.
  - Descending direction reverses the web bucket but keeps non-web tabs at the end.
  - Pinned partition stays ahead of unpinned.
  - Stable order for tabs sharing a host.
  - No-op input (0 or 1 tab) returns unchanged order.

### 7.2 Runtime verification (Chrome required)
Using Playwright with the extension loaded unpacked and `--headless=new`:
- **Loads cleanly:** service worker registers; no console errors.
- **FR-1/FR-2 end-to-end:** launch Chrome with `--host-resolver-rules="MAP *.test 127.0.0.1"` and a tiny local static server, open tabs on distinct hostnames (`a.test`, `b.test`, `sub.a.test`, plus a `chrome://version` tab and a pinned tab), trigger the sort, then read tab order via the driver and assert it matches the expected grouped/sorted order with pinned first and the `chrome://` tab last.
- **FR-6 persistence:** set direction to Z–A, restart the browser context, confirm the preference is retained.

### 7.3 Coverage note
Cross-browser quirks, behavior across the long tail of real sites, tab-group interactions, and store-policy review are **not** covered by automated tests and need human validation.

---

## 8. Acceptance Criteria

- [ ] `npm ci && npm run build` completes with zero errors.
- [ ] Typecheck and lint pass with no errors.
- [ ] `manifest.json` is valid MV3 and requests only `tabs` + `storage` (no host permissions).
- [ ] All §7.1 unit cases pass.
- [ ] E2E: extension loads with no service-worker console errors.
- [ ] E2E: tabs end up grouped by domain, alphabetically, subdomains adjacent (FR-1).
- [ ] E2E: pinned tabs remain pinned and ahead of unpinned tabs (FR-2).
- [ ] E2E: non-web tabs land at the end (FR-3).
- [ ] E2E: sort direction preference persists across restart (FR-4, FR-6).
- [ ] Window with 0/1 tab is a safe no-op (FR-8).
- [ ] `domain-tab-sorter.zip` is produced and loads as an unpacked extension.
- [ ] `RUN.md` documents how to load and test locally.

---

## 9. Out of Scope / Known Limitations (v1)

- **Publishing** to the Chrome Web Store (developer account + signing) — human-gated.
- **Chrome tab groups:** moving grouped tabs can split existing groups; v1 does not preserve or create groups. *(Natural v2 feature: use the `tabGroups` API to keep or create per-domain groups.)*
- **Multi-window "all windows" scope** beyond the FR-5 default, if not enabled.
- **Multi-part public suffixes** (`co.uk`, etc.) are grouped approximately unless the optional PSL refinement in §3 is added.

---

## 10. Deliverables

- Working extension source in the structure of §4.
- `dist/` build output and `domain-tab-sorter.zip`.
- Passing unit + e2e suites.
- `RUN.md` with local load/test instructions.
- A brief note on anything in §8 that could not be verified automatically and why.
