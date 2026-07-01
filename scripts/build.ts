/**
 * Build the extension into `dist/`:
 *   - bundle src/background.ts   -> dist/background.js
 *   - bundle src/popup/popup.ts  -> dist/popup.js
 *   - copy manifest.json, popup.html, and assets/icons/ into dist/
 *
 * Uses Bun's bundler (no Vite/esbuild dependency needed).
 */

import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

const entrypoints = ["src/background.ts", "src/popup/popup.ts"];

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "icons"), { recursive: true });

// Bundle each entrypoint to a flat file at the dist root (background.js, popup.js).
for (const entry of entrypoints) {
  const result = await Bun.build({
    entrypoints: [join(root, entry)],
    outdir: dist,
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

await cp(join(root, "manifest.json"), join(dist, "manifest.json"));
await cp(join(root, "src/popup/popup.html"), join(dist, "popup.html"));
await cp(join(root, "assets/icons"), join(dist, "icons"), { recursive: true });

console.log("Built extension -> dist/");
