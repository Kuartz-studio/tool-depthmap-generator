// Unit tests for the pure image kernels in public/engine/core.js (run with `npm test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';

const Core = createRequire(import.meta.url)('../public/engine/core.js');

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
const u32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

// Splits a PNG into its chunks, checking each CRC on the way.
function readChunks(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  const chunks = [];
  for (let at = 8; at < png.length; ) {
    const len = u32(png, at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + len);
    assert.equal(u32(png, at + 8 + len), Core.crc32(png.subarray(at + 4, at + 8 + len)) >>> 0, `${type} CRC`);
    chunks.push({ type, body });
    at += 12 + len;
  }
  return chunks;
}

test('crc32 matches the standard CRC-32 check value', () => {
  assert.equal(Core.crc32(new TextEncoder().encode('123456789')) >>> 0, 0xcbf43926);
});

test('round14 snaps to the ViT patch size', () => {
  assert.equal(Core.round14(0), 14);
  assert.equal(Core.round14(20), 14);
  assert.equal(Core.round14(21), 28);
  assert.equal(Core.round14(518), 518);
});

test('modelSize keeps the aspect ratio on a multiple-of-14 grid', () => {
  for (const [w, h, mode] of [[1600, 1067, 'short'], [1067, 1600, 'short'], [4000, 3000, 'long'], [8000, 2000, 'short']]) {
    const [mw, mh] = Core.modelSize(w, h, 518, mode, 3300);
    assert.equal(mw % 14, 0);
    assert.equal(mh % 14, 0);
    assert.ok(Math.abs(mw / mh - w / h) / (w / h) < 0.06, `aspect ${w}x${h} -> ${mw}x${mh}`);
    assert.ok((mw / 14) * (mh / 14) <= 3300 * 1.05, `token budget ${w}x${h} -> ${mw}x${mh}`);
  }
});

test('percentiles ignores outliers', () => {
  const data = new Float32Array(1000).map((_, i) => i);
  data[0] = -1e6;
  data[999] = 1e6;
  const [lo, hi] = Core.percentiles(data, 0.01, 0.99);
  assert.ok(lo < hi);
  assert.ok(lo > -1000 && hi < 2000, `outliers leaked into [${lo}, ${hi}]`);
});

test('processDepth returns a 0..1 map at the requested size, near = 1', () => {
  const dw = 8, dh = 8;
  const disp = new Float32Array(dw * dh).map((_, i) => Math.floor(i / dw)); // disparity grows downwards
  const W = 32, H = 24;
  const depth = Core.processDepth(disp, dw, dh, null, W, H, {});
  assert.equal(depth.length, W * H);
  for (const v of depth) assert.ok(v >= 0 && v <= 1);
  const row = (y) => depth.subarray(y * W, (y + 1) * W).reduce((s, v) => s + v, 0) / W;
  assert.ok(row(H - 1) > row(0), 'bottom (large disparity) is nearer than top');
});

test('normalMap of a flat depth faces the viewer', () => {
  const w = 6, h = 5;
  const rgb = Core.normalMap(new Float32Array(w * h).fill(0.5), w, h, 2);
  assert.equal(rgb.length, w * h * 3);
  for (let i = 0; i < w * h; i++) {
    assert.ok(Math.abs(rgb[3 * i] - 128) <= 1 && Math.abs(rgb[3 * i + 1] - 128) <= 1, 'x/y ~ 0');
    assert.ok(rgb[3 * i + 2] >= 250, 'z ~ 1');
  }
});

test('encodePNG writes valid 8 and 16-bit grayscale PNGs', async () => {
  const w = 5, h = 3;
  const values = new Float32Array(w * h).map((_, i) => i / (w * h - 1));
  for (const [kind, bitDepth, bpp] of [['gray8', 8, 1], ['gray16', 16, 2]]) {
    const chunks = readChunks(await bytesOf(await Core.encodePNG(values, w, h, kind)));
    assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
    const ihdr = chunks[0].body;
    assert.equal(u32(ihdr, 0), w);
    assert.equal(u32(ihdr, 4), h);
    assert.equal(ihdr[8], bitDepth);
    assert.equal(ihdr[9], 0, 'grayscale');
    assert.equal(inflateSync(chunks[1].body).length, h * (1 + w * bpp), 'one filter byte per row');
  }
});

test('zipStore writes a stored ZIP with every entry', async () => {
  const enc = new TextEncoder();
  const zip = await bytesOf(Core.zipStore([
    { name: 'a-depth16.png', data: enc.encode('first') },
    { name: 'b-depth16.png', data: enc.encode('second file') },
  ]));
  assert.deepEqual([...zip.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'local file header');
  const end = zip.subarray(zip.length - 22);
  assert.deepEqual([...end.subarray(0, 4)], [0x50, 0x4b, 0x05, 0x06], 'end of central directory');
  assert.equal(end[10] | (end[11] << 8), 2, 'entry count');
});
