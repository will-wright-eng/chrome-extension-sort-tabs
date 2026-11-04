/**
 * Generate the extension's PNG icons (16/32/48/128) with zero image
 * dependencies — a small hand-rolled PNG encoder (node:zlib for DEFLATE).
 *
 * Design: a blue tile with three white bars of decreasing width, evoking a
 * sorted list. Run with `bun run gen:icons`.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = [16, 32, 48, 128];
const BG: [number, number, number, number] = [0x1a, 0x73, 0xe8, 0xff]; // Google blue
const BAR: [number, number, number, number] = [0xff, 0xff, 0xff, 0xff];

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, (ch) => ch.charCodeAt(0));
  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(concat([typeBytes, data])));
  return out;
}

function renderPixels(size: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const set = (x: number, y: number, c: readonly number[]) => {
    const o = (y * size + x) * 4;
    px[o] = c[0];
    px[o + 1] = c[1];
    px[o + 2] = c[2];
    px[o + 3] = c[3];
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, BG);

  const margin = Math.max(1, Math.round(size * 0.2));
  const barH = Math.max(1, Math.round(size * 0.12));
  const gap = Math.max(1, Math.round(size * 0.1));
  const fullW = size - margin * 2;
  const shrink = Math.round(size * 0.14);

  let y = margin;
  for (let b = 0; b < 3 && y + barH <= size - margin + gap; b++) {
    const w = Math.max(2, fullW - b * shrink);
    for (let yy = y; yy < y + barH && yy < size; yy++) {
      for (let x = margin; x < margin + w && x < size; x++) set(x, yy, BAR);
    }
    y += barH + gap;
  }
  return px;
}

function encodePng(size: number): Uint8Array {
  const px = renderPixels(size);
  const stride = size * 4;
  const raw = new Uint8Array(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    raw.set(px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // bytes 10-12 (compression, filter, interlace) stay 0

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = new Uint8Array(deflateSync(raw));
  return concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "extension", "icons");
mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  writeFileSync(join(outDir, `${size}.png`), encodePng(size));
  console.log(`wrote extension/icons/${size}.png`);
}
