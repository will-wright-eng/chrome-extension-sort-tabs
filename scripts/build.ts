/**
 * Bundle the TypeScript entrypoints into the load-unpacked `extension/` dir:
 *   - src/background.ts  -> extension/background.js
 *   - src/popup/popup.ts -> extension/popup.js
 *
 * manifest.json, popup.html, and icons/ already live in extension/ and are
 * committed; the bundled JS is committed too so the directory loads as-is.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "extension");

const entrypoints = ["src/background.ts", "src/popup/popup.ts"];

for (const entry of entrypoints) {
  const result = await Bun.build({
    entrypoints: [join(root, entry)],
    outdir,
    target: "browser",
    format: "esm",
    minify: false,
    sourcemap: "none",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`Failed to bundle ${entry}`);
  }
}

console.log("Built extension -> extension/");
