# Domain Tab Sorter — Local Run & Test

A Manifest V3 Chrome extension that reorders a window's tabs so tabs from the
same domain are grouped and ordered alphabetically. See `SPEC.md` for the full
design.

## Prerequisites

- **[Bun](https://bun.sh)** ≥ 1.3 (this project uses Bun instead of npm/node —
  the two are interchangeable for the pipeline; equivalents are noted below).
- **Google Chrome / Chromium** for loading the extension.
- For the e2e suite only: Playwright's bundled Chromium —
  `bunx playwright install chromium` (one-time; needs network). The e2e loads
  the extension in *new-headless* mode, which only the bundled Chromium build
  supports.

| Spec step (§6) | npm            | Bun (used here)     |
| -------------- | -------------- | ------------------- |
| Install        | `npm ci`       | `bun install`       |
| Typecheck      | `tsc --noEmit` | `bun run typecheck` |
| Lint           | `eslint .`     | `bun run lint`      |
| Build          | `vite build`   | `bun run build`     |
| Package        | zip `extension/` | `bun run package` |

> **Note on SPEC §8 criterion #1.** The spec lists `npm ci && npm run build`.
> This project intentionally ships a Bun toolchain (only `bun.lock` is
> committed), so the equivalent is **`bun install && bun run build`**, which
> completes with zero errors. `npm ci` would fail for lack of a
> `package-lock.json` — this is the one place the deliberate Bun substitution
> diverges from the literal npm wording.

## Install

```bash
bun install
```

## Build

```bash
bun run build          # bundles src/ -> extension/background.js + extension/popup.js
bun run package        # build + zip extension/ -> domain-tab-sorter.zip
```

The `extension/` directory is the load-unpacked target and is fully committed,
including the bundled `background.js` and `popup.js`. Re-run `bun run build`
after changing anything under `src/` and commit the regenerated JS.

`bun run gen:icons` regenerates the PNG icons in `extension/icons/` (already
committed; only needed if you change the icon design).

## Static checks & unit tests

```bash
bun run typecheck      # tsc --noEmit
bun run lint           # eslint .
bun run test:unit      # pure sort-logic tests (tests/unit/sort.test.ts)
bun run check          # typecheck + lint + unit + build, all in one
```

## End-to-end tests (real Chrome, headless)

```bash
bunx playwright install chromium   # one-time
bun run test:e2e                   # builds, then drives headless Chrome with the extension loaded
```

The e2e suite (`tests/e2e/sort.e2e.ts`) launches Chromium unpacked with the
extension, serves distinct `*.test` hostnames from a tiny local Bun server
(mapped to 127.0.0.1 via `--host-resolver-rules`), and asserts grouping, pinned
ordering, non-web bucketing, descending order, the single-tab no-op, and
preference persistence across a restart. **No internet access is required at
runtime.**

## Load the extension manually in Chrome

1. Open `chrome://extensions`. (No build step needed — `extension/` is
   committed ready to load. Run `bun run build` only if you edited `src/`.)
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the `extension/` folder.
   (To use the archive instead, first unzip `domain-tab-sorter.zip` and
   **Load unpacked** on the extracted folder — `chrome://extensions` cannot
   load a raw `.zip` as an unpacked extension.)
4. Pin the **Domain Tab Sorter** toolbar icon, open a few tabs across several
   sites, click the icon, and press **Sort tabs**. Use the Direction / Scope
   controls to change behavior; preferences persist across restarts.

## Project layout

```
extension/             # load this folder unpacked in chrome://extensions
  manifest.json        # MV3 manifest (permissions: tabs, storage — no host permissions)
  popup.html           # popup UI
  background.js        # built from src/background.ts (committed)
  popup.js             # built from src/popup/popup.ts (committed)
  icons/               # 16/32/48/128 px PNGs
src/
  background.ts        # service worker: receives SORT messages, moves tabs
  popup/popup.ts       # popup controller (prefs + trigger)
  lib/sort.ts          # pure, unit-tested ordering logic (the heart)
  lib/messages.ts      # shared message/preference contracts
scripts/               # build.ts, package.ts, gen-icons.ts
tests/unit/            # sort.test.ts
tests/e2e/             # sort.e2e.ts
```

## What is NOT verified automatically

Per SPEC §7.3 / §9, the following need human validation and are intentionally
out of automated scope:

- **Chrome Web Store review & publishing** — requires a developer account and
  signing credentials (human-gated). Note: the `tabs` permission surfaces the
  "Read your browsing history" warning; this is unavoidable for reading tab URLs
  and should be disclosed in the store listing.
- **Existing Chrome tab groups** — v1 does not preserve groups; moving grouped
  tabs can split them. Not covered by tests (a natural v2 feature via the
  `tabGroups` API).
- **Multi-part public suffixes** (`bbc.co.uk`, etc.) — grouped approximately by
  the label-reversal key; strict eTLD+1 grouping (PSL) is an optional §3
  refinement not implemented in v1.
- **Cross-browser quirks** and the **long tail of real-world sites** — only
  synthetic `*.test` hosts are exercised in e2e.
- **The popup's visual DOM** — the popup's message/preference logic is exercised
  via unit tests and the shared code path is covered e2e, but pixel-level popup
  rendering is validated manually (step "Load the extension manually").
```
