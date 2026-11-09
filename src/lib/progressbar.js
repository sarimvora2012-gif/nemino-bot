'use strict';

const zlib = require('node:zlib');

/**
 * A tiny PNG writer for the XP bar on the level cards.
 *
 * Discord text cannot be coloured, so the only way to show the same rounded
 * green bar as the design board is to draw it. This keeps it dependency-free:
 * zlib does the compression and the few bytes of PNG framing are below.
 */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** True when the pixel sits inside a pill of radius `r`, cut off at `limit`. */
function insidePill(x, y, width, height, r, limit) {
  if (x < 0 || y < 0 || x >= limit || y >= height) return false;
  const cx = Math.min(Math.max(x, r), width - r - 1);
  const cy = Math.min(Math.max(y, r), height - r - 1);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

const TRACK = [30, 31, 34];
const FILL_START = [87, 242, 135];
const FILL_END = [59, 165, 93];

/**
 * Draws the XP bar: a rounded track with a green gradient up to `percent`.
 * Rendered at 3x and box-filtered down, which is enough antialiasing for the
 * rounded ends at this size.
 */
function progressBarPng({ percent = 0, width = 440, height = 16, scale = 3 } = {}) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const bigW = width * scale;
  const bigH = height * scale;
  const radius = bigH / 2;
  const filledW = Math.round((pct / 100) * bigW);
  const pixels = Buffer.alloc(bigW * bigH * 4);

  for (let y = 0; y < bigH; y += 1) {
    for (let x = 0; x < bigW; x += 1) {
      if (!insidePill(x, y, bigW, bigH, radius, bigW)) continue;
      const offset = (y * bigW + x) * 4;
      if (x < filledW) {
        const t = filledW > 1 ? Math.min(1, x / (filledW - 1)) : 1;
        for (let channel = 0; channel < 3; channel += 1) {
          const start = FILL_START[channel];
          pixels[offset + channel] = Math.round(start + (FILL_END[channel] - start) * t);
        }
      } else {
        pixels[offset] = TRACK[0];
        pixels[offset + 1] = TRACK[1];
        pixels[offset + 2] = TRACK[2];
      }
      pixels[offset + 3] = 255;
    }
  }

  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const offset = ((y * scale + sy) * bigW + (x * scale + sx)) * 4;
          const alpha = pixels[offset + 3];
          r += pixels[offset] * alpha;
          g += pixels[offset + 1] * alpha;
          b += pixels[offset + 2] * alpha;
          a += alpha;
        }
      }
      const offset = (y * width + x) * 4;
      if (a > 0) {
        out[offset] = Math.round(r / a);
        out[offset + 1] = Math.round(g / a);
        out[offset + 2] = Math.round(b / a);
      }
      out[offset + 3] = Math.round(a / (scale * scale));
    }
  }

  return png(width, height, out);
}

module.exports = { progressBarPng };
