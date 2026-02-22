import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const sizes = [16, 32, 48, 128];
const outDir = path.resolve("icons");

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(c1, c2, t) {
  return [
    Math.round(mix(c1[0], c2[0], t)),
    Math.round(mix(c1[1], c2[1], t)),
    Math.round(mix(c1[2], c2[2], t))
  ];
}

function alphaBlend(dst, srcRgb, srcA) {
  const sa = clamp01(srcA);
  const da = dst[3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return [0, 0, 0, 0];
  const outR = (srcRgb[0] * sa + dst[0] * da * (1 - sa)) / outA;
  const outG = (srcRgb[1] * sa + dst[1] * da * (1 - sa)) / outA;
  const outB = (srcRgb[2] * sa + dst[2] * da * (1 - sa)) / outA;
  return [Math.round(outR), Math.round(outG), Math.round(outB), Math.round(outA * 255)];
}

function insideRoundedRect(nx, ny, r) {
  const ax = Math.abs(nx - 0.5);
  const ay = Math.abs(ny - 0.5);
  const hx = 0.5 - r;
  const hy = 0.5 - r;
  const dx = Math.max(ax - hx, 0);
  const dy = Math.max(ay - hy, 0);
  return dx * dx + dy * dy <= r * r;
}

function ellipseMask(nx, ny, cx, cy, rx, ry, rotationRad, soft) {
  const sx = nx - cx;
  const sy = ny - cy;
  const c = Math.cos(rotationRad);
  const s = Math.sin(rotationRad);
  const x = sx * c + sy * s;
  const y = -sx * s + sy * c;
  const d = Math.sqrt((x * x) / (rx * rx) + (y * y) / (ry * ry));
  return 1 - smoothstep(1 - soft, 1 + soft, d);
}

function waveMask(nx, ny, thickness) {
  if (nx < 0.26 || nx > 0.74) return 0;
  const waveY = 0.70 + 0.035 * Math.sin((nx - 0.5) * Math.PI * 3.2);
  const d = Math.abs(ny - waveY);
  return 1 - smoothstep(thickness, thickness + 0.012, d);
}

function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const cTop = [12, 85, 126];
  const cMid = [16, 143, 150];
  const cBottom = [40, 182, 162];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;

      if (!insideRoundedRect(nx, ny, 0.22)) {
        pixels[i + 0] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 0;
        continue;
      }

      const tV = clamp01((ny - 0.02) / 0.98);
      const tH = clamp01((nx - 0.08) / 0.92);
      const g1 = mixColor(cTop, cMid, tV);
      const g2 = mixColor(g1, cBottom, Math.pow(tV, 1.35));
      const bg = mixColor(g2, [65, 205, 185], tH * 0.18);

      let px = [bg[0], bg[1], bg[2], 255];

      const glowDx = nx - 0.5;
      const glowDy = ny - 0.42;
      const glowDist = Math.sqrt(glowDx * glowDx + glowDy * glowDy);
      const glow = 0.12 * (1 - smoothstep(0.12, 0.52, glowDist));
      px = alphaBlend(px, [235, 255, 252], glow);

      const petalMain = ellipseMask(nx, ny, 0.5, 0.50, 0.10, 0.19, 0.0, 0.05) * 0.94;
      const petalLeft = ellipseMask(nx, ny, 0.415, 0.53, 0.078, 0.145, Math.PI / 7, 0.05) * 0.90;
      const petalRight = ellipseMask(nx, ny, 0.585, 0.53, 0.078, 0.145, -Math.PI / 7, 0.05) * 0.90;
      const petals = Math.max(petalMain, petalLeft, petalRight);
      px = alphaBlend(px, [255, 255, 255], petals);

      const wave = waveMask(nx, ny, 0.024) * 0.90;
      px = alphaBlend(px, [255, 255, 255], wave);

      const dotDx = nx - 0.5;
      const dotDy = ny - 0.80;
      const dot = 1 - smoothstep(0.018, 0.033, Math.sqrt(dotDx * dotDx + dotDy * dotDy));
      px = alphaBlend(px, [255, 255, 255], dot * 0.88);

      pixels[i + 0] = px[0];
      pixels[i + 1] = px[1];
      pixels[i + 2] = px[2];
      pixels[i + 3] = px[3];
    }
  }

  return pixels;
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

const crcTable = makeCrcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    const srcStart = y * stride;
    rgba.copy(raw, rowStart + 1, srcStart, srcStart + stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  for (const size of sizes) {
    const pixels = drawIcon(size);
    const png = encodePng(size, size, Buffer.from(pixels));
    const outPath = path.join(outDir, `icon${size}.png`);
    await writeFile(outPath, png);
    console.log(`Generated ${outPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
