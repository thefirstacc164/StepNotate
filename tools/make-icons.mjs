import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const OUT = path.join(process.cwd(), "extension", "icons");
const SIZES = [16, 32, 48, 128];
const SS = 4;

const INK_TOP = [32, 37, 44];
const INK_BOTTOM = [16, 20, 24];
const CREAM = [250, 248, 243];
const VERMILION = [226, 84, 44];

function roundRectSDF(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - r;
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function shade(px, py, size) {
  const u = (px / size) * 128;
  const v = (py / size) * 128;
  const bg = roundRectSDF(u, v, 64, 64, 58, 58, 28);
  if (bg > 0.5) return [0, 0, 0, 0];

  let color = mix(INK_TOP, INK_BOTTOM, Math.min(1, Math.max(0, (u + v) / 256)));

  const steps = [
    [42, 76, 13, 20, 3.5],
    [64, 66, 13, 30, 3.5],
    [86, 56, 13, 40, 3.5],
  ];
  for (const [cx, cy, hw, hh, r] of steps) {
    const d = roundRectSDF(u, v, cx, cy, hw, hh, r);
    if (d < 0.8) color = mix(color, CREAM, Math.min(1, Math.max(0, 0.8 - d)));
  }

  const swipe = roundRectSDF(u, v, 64, 102, 32, 4.5, 4.5);
  if (swipe < 0.8) color = mix(color, VERMILION, Math.min(1, Math.max(0, 0.8 - swipe)));

  const edge = Math.min(1, Math.max(0, 0.5 - bg));
  return [color[0], color[1], color[2], Math.round(edge * 255)];
}

function render(size) {
  const big = size * SS;
  const acc = new Float32Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5;
          const py = y * SS + sy + 0.5;
          const [cr, cg, cb, ca] = shade(px, py, big);
          const alpha = ca / 255;
          r += cr * alpha;
          g += cg * alpha;
          b += cb * alpha;
          a += alpha;
        }
      }
      const n = SS * SS;
      const idx = (y * size + x) * 4;
      if (a > 0) {
        acc[idx] = r / a;
        acc[idx + 1] = g / a;
        acc[idx + 2] = b / a;
      }
      acc[idx + 3] = (a / n) * 255;
    }
  }
  return acc;
}

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = y * (size * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 4; k++) raw[dst + k] = Math.round(pixels[src + k]);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(size, render(size));
  fs.writeFileSync(path.join(OUT, `icon${size}.png`), png);
  console.log(`icon${size}.png`);
}
