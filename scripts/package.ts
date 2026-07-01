/**
 * Produce a store-ready / load-unpacked zip: build, then zip dist/ into
 * domain-tab-sorter.zip at the project root.
 */

import { $ } from "bun";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const zip = join(root, "domain-tab-sorter.zip");

await $`bun run ${join(root, "scripts/build.ts")}`;
await $`rm -f ${zip}`;
// Zip the *contents* of dist/ so manifest.json sits at the archive root.
await $`cd ${join(root, "dist")} && zip -qr ${zip} .`;

console.log("Packaged -> domain-tab-sorter.zip");
