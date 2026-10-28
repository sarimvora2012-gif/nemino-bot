'use strict';

/**
 * Draws the staff rank role icons from scratch and writes them as PNGs into
 * assets/role-icons/. No image library: shapes are rasterised by hand at 3x and
 * box-downsampled for smooth edges, then encoded with node:zlib.
 *
 * Run with: npm run icons
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT_DIR = path.join(__dirname, '..', 'assets', 'role-icons');
const SIZE = 256; // plenty for a role icon and for a 128px server emoji
const SS = 4; // supersampling factor
const WORK = SIZE * SS;

// ---- PNG encoding ---------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- tiny rasteriser ------------------------------------------------------

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const hex = (value) => {
  const text = value.replace('#', '');
  return [
    parseInt(text.slice(0, 2), 16),
    parseInt(text.slice(2, 4), 16),
    parseInt(text.slice(4, 6), 16),
  ];
};
const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

function createCanvas(size) {
  return { size, pixels: new Float32Array(size * size * 4) };
}

/** Straight-alpha source-over blend of one pixel. */
function blend(canvas, x, y, color, alpha) {
  if (alpha <= 0) return;
  const index = (y * canvas.size + x) * 4;
  const pixels = canvas.pixels;
  const dstA = pixels[index + 3];
  const srcA = clamp01(alpha);
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    pixels[index + channel] =
      (color[channel] * srcA + pixels[index + channel] * dstA * (1 - srcA)) / outA;
  }
  pixels[index + 3] = outA;
}

/** Paints every pixel in the bounding box whose centre passes `inside`. */
function paint(canvas, bounds, inside, color, alpha = 1) {
  const x0 = Math.max(0, Math.floor(bounds.x0));
  const x1 = Math.min(canvas.size - 1, Math.ceil(bounds.x1));
  const y0 = Math.max(0, Math.floor(bounds.y0));
  const y1 = Math.min(canvas.size - 1, Math.ceil(bounds.y1));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (inside(x + 0.5, y + 0.5)) blend(canvas, x, y, color, alpha);
    }
  }
}

const circleBounds = (cx, cy, r) => ({ x0: cx - r - 1, x1: cx + r + 1, y0: cy - r - 1, y1: cy + r + 1 });

function drawCircle(canvas, cx, cy, r, color, alpha = 1) {
  paint(canvas, circleBounds(cx, cy, r), (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r, color, alpha);
}

function drawDisc(canvas, cx, cy, rOuter, rInner, color, alpha = 1) {
  paint(
    canvas,
    circleBounds(cx, cy, rOuter),
    (x, y) => {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      return d <= rOuter * rOuter && d >= rInner * rInner;
    },
    color,
    alpha,
  );
}

function polygonBounds(points) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    x0: Math.min(...xs) - 1,
    x1: Math.max(...xs) + 1,
    y0: Math.min(...ys) - 1,
    y1: Math.max(...ys) + 1,
  };
}

/** Even-odd fill across one or more polygons, so rings and cut-outs are easy. */
function drawPolygons(canvas, polygons, color, alpha = 1) {
  const bounds = polygonBounds(polygons.flat());
  paint(
    canvas,
    bounds,
    (x, y) => {
      let crossings = 0;
      for (const points of polygons) {
        for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
          const [xi, yi] = points[i];
          const [xj, yj] = points[j];
          if (yi > y !== yj > y) {
            const crossX = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
            if (x < crossX) crossings += 1;
          }
        }
      }
      return crossings % 2 === 1;
    },
    color,
    alpha,
  );
}

function drawRect(canvas, x, y, width, height, color, alpha = 1) {
  paint(
    canvas,
    { x0: x, x1: x + width, y0: y, y1: y + height },
    (px, py) => px >= x && px <= x + width && py >= y && py <= y + height,
    color,
    alpha,
  );
}

// ---- emblem shapes (unit space: -1..1, scaled and centred later) ----------

function scalePoints(points, scale, cx, cy) {
  return points.map(([x, y]) => [cx + x * scale, cy + y * scale]);
}

const SHAPES = {
  crown(scale, cx, cy) {
    const body = scalePoints(
      [
        [-1, 0.28],
        [-1, -0.34],
        [-0.52, 0.02],
        [0, -0.62],
        [0.52, 0.02],
        [1, -0.34],
        [1, 0.28],
      ],
      scale,
      cx,
      cy,
    );
    const band = scalePoints(
      [
        [-1, 0.44],
        [-1, 1],
        [1, 1],
        [1, 0.44],
      ],
      scale,
      cx,
      cy,
    );
    return [body, band];
  },

  /** A faceted gem: the outer rhombus with a smaller table cut into the top. */
  diamond(scale, cx, cy) {
    const outer = [
      [0, -1],
      [0.86, -0.18],
      [0, 1],
      [-0.86, -0.18],
    ];
    const table = [
      [0, -0.62],
      [0.36, -0.18],
      [0, 0.18],
      [-0.36, -0.18],
    ];
    return [scalePoints(outer, scale, cx, cy), scalePoints(table, scale, cx, cy)];
  },

  chevron(count) {
    const polygons = [];
    const thickness = 0.36;
    const step = 0.62;
    for (let i = 0; i < count; i += 1) {
      const offset = (i - (count - 1) / 2) * step;
      polygons.push([
        [-1, 0.48 + offset],
        [0, -0.28 + offset],
        [1, 0.48 + offset],
        [1, 0.48 + thickness + offset],
        [0, 0.02 + thickness + offset],
        [-1, 0.48 + thickness + offset],
      ]);
    }
    return polygons;
  },

  shield(scale, cx, cy) {
    const outer = [
      [-0.92, -1],
      [0.92, -1],
      [0.92, 0.02],
      [0.68, 0.62],
      [0, 1],
      [-0.68, 0.62],
      [-0.92, 0.02],
    ];
    const inner = [
      [-0.55, -0.62],
      [0.55, -0.62],
      [0.55, 0.02],
      [0.4, 0.44],
      [0, 0.68],
      [-0.4, 0.44],
      [-0.55, 0.02],
    ];
    return [
      scalePoints(outer, scale, cx, cy),
      scalePoints(inner, scale, cx, cy),
    ];
  },

  hexagon(scale, cx, cy) {
    const outer = [];
    const inner = [];
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      outer.push([Math.cos(angle), Math.sin(angle)]);
      inner.push([Math.cos(angle) * 0.6, Math.sin(angle) * 0.6]);
    }
    return [scalePoints(outer, scale, cx, cy), scalePoints(inner, scale, cx, cy)];
  },

  star(scale, cx, cy) {
    const points = [];
    for (let i = 0; i < 10; i += 1) {
      const radius = i % 2 === 0 ? 1 : 0.44;
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    return [scalePoints(points, scale, cx, cy)];
  },

  plus(scale, cx, cy) {
    const arm = 0.34;
    return [
      scalePoints(
        [
          [-arm, -1],
          [arm, -1],
          [arm, -arm],
          [1, -arm],
          [1, arm],
          [arm, arm],
          [arm, 1],
          [-arm, 1],
          [-arm, arm],
          [-1, arm],
          [-1, -arm],
          [-arm, -arm],
        ],
        scale,
        cx,
        cy,
      ),
    ];
  },

  ring(scale, cx, cy) {
    const outer = [];
    const inner = [];
    for (let i = 0; i < 48; i += 1) {
      const angle = (Math.PI * 2 * i) / 48;
      outer.push([Math.cos(angle), Math.sin(angle)]);
      inner.push([Math.cos(angle) * 0.62, Math.sin(angle) * 0.62]);
    }
    return [scalePoints(outer, scale, cx, cy), scalePoints(inner, scale, cx, cy)];
  },
};

const ICONS = [
  {
    file: 'owner',
    name: 'Owner',
    from: '#F7C948',
    to: '#A9601A',
    emblem: (scale, cx, cy) => SHAPES.crown(scale, cx, cy),
  },
  {
    file: 'coowner',
    name: 'Co-Owner',
    from: '#B79CFF',
    to: '#5B21B6',
    emblem: (scale, cx, cy) => SHAPES.diamond(scale, cx, cy),
  },
  {
    file: 'head',
    name: 'Head',
    from: '#FF8A8A',
    to: '#8E1B1B',
    emblem: (scale, cx, cy) => SHAPES.chevron(3).map((polygon) => scalePoints(polygon, scale, cx, cy)),
  },
  {
    file: 'admin',
    name: 'Admin',
    from: '#7DB4FF',
    to: '#173EA5',
    emblem: (scale, cx, cy) => SHAPES.shield(scale, cx, cy),
  },
  {
    file: 'senior',
    name: 'Senior',
    from: '#7BE3B0',
    to: '#0B6B4A',
    emblem: (scale, cx, cy) => SHAPES.star(scale, cx, cy),
  },
  {
    file: 'mod',
    name: 'Moderator',
    from: '#5FE3D0',
    to: '#0B5F63',
    emblem: (scale, cx, cy) => SHAPES.hexagon(scale, cx, cy),
  },
  {
    file: 'trial',
    name: 'Trial',
    from: '#B9C4D6',
    to: '#46536B',
    emblem: (scale, cx, cy) => SHAPES.chevron(1).map((polygon) => scalePoints(polygon, scale, cx, cy)),
  },
  {
    file: 'helper',
    name: 'Helper',
    from: '#FFA8CE',
    to: '#A61B57',
    emblem: (scale, cx, cy) => SHAPES.plus(scale, cx, cy),
  },
  {
    file: 'staff',
    name: 'Staff',
    from: '#A9B6D6',
    to: '#3D4A66',
    emblem: (scale, cx, cy) => SHAPES.ring(scale, cx, cy),
  },
];

// ---- composition ----------------------------------------------------------

const WHITE = [255, 255, 255];

function drawBackground(canvas, { from, to }) {
  const centre = canvas.size / 2;
  const radius = canvas.size * 0.5;
  const top = hex(from);
  const bottom = hex(to);

  paint(
    canvas,
    { x0: 0, x1: canvas.size, y0: 0, y1: canvas.size },
    (x, y) => (x - centre) ** 2 + (y - centre) ** 2 <= radius * radius,
    WHITE,
    0,
  );

  for (let y = 0; y < canvas.size; y += 1) {
    for (let x = 0; x < canvas.size; x += 1) {
      const dx = (x - centre) / radius;
      const dy = (y - centre) / radius;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > 1) continue;
      // Diagonal gradient plus a soft top-left highlight.
      const t = clamp01((dx + dy + 2) / 4);
      const base = mix(top, bottom, t);
      const highlight = clamp01(0.16 * (1 - Math.hypot(dx + 0.35, dy + 0.35)));
      blend(canvas, x, y, mix(base, WHITE, highlight), 1);
    }
  }
}

function drawIcon(spec) {
  const canvas = createCanvas(WORK);
  drawBackground(canvas, spec);

  const centre = canvas.size / 2;
  const radius = canvas.size * 0.5;
  const scale = canvas.size * 0.2;

  // Inner hairline ring keeps the icon from looking flat.
  drawDisc(canvas, centre, centre, radius * 0.9, radius * 0.885, WHITE, 0.35);

  const polygons = spec.emblem(scale, centre, centre);

  // Soft shadow, then the emblem itself.
  const shadow = polygons.map((points) =>
    points.map(([x, y]) => [x + canvas.size * 0.004, y + canvas.size * 0.012]),
  );
  drawPolygons(canvas, shadow, [8, 10, 20], 0.28);
  drawPolygons(canvas, polygons, WHITE, 0.97);

  return downsample(canvas);
}

/** Box filter from the supersampled canvas down to SIZE. */
function downsample(canvas) {
  const out = Buffer.alloc(SIZE * SIZE * 4);
  const factor = SS;
  const samples = factor * factor;

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const index = ((y * factor + sy) * canvas.size + (x * factor + sx)) * 4;
          const alpha = canvas.pixels[index + 3];
          r += canvas.pixels[index] * alpha;
          g += canvas.pixels[index + 1] * alpha;
          b += canvas.pixels[index + 2] * alpha;
          a += alpha;
        }
      }
      const index = (y * SIZE + x) * 4;
      if (a > 0) {
        out[index] = Math.round(r / a);
        out[index + 1] = Math.round(g / a);
        out[index + 2] = Math.round(b / a);
      }
      out[index + 3] = Math.round((a / samples) * 255);
    }
  }

  return out;
}

/** One sheet with every icon, so the set can be judged at a glance. */
function writeContactSheet(icons) {
  const cell = 220;
  const gap = 22;
  const columns = 3;
  const rows = Math.ceil(icons.length / columns);
  const width = columns * cell + (columns + 1) * gap;
  const height = rows * cell + (rows + 1) * gap;
  const sheet = Buffer.alloc(width * height * 4);

  for (let i = 0; i < sheet.length; i += 4) {
    sheet[i] = 24;
    sheet[i + 1] = 26;
    sheet[i + 2] = 33;
    sheet[i + 3] = 255;
  }

  icons.forEach((icon, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const originX = gap + column * (cell + gap);
    const originY = gap + row * (cell + gap);
    const step = SIZE / cell;

    for (let y = 0; y < cell; y += 1) {
      for (let x = 0; x < cell; x += 1) {
        const sx = Math.min(SIZE - 1, Math.floor(x * step));
        const sy = Math.min(SIZE - 1, Math.floor(y * step));
        const src = (sy * SIZE + sx) * 4;
        const alpha = icon.pixels[src + 3] / 255;
        if (alpha <= 0) continue;
        const dst = ((originY + y) * width + (originX + x)) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          sheet[dst + channel] = Math.round(
            icon.pixels[src + channel] * alpha + sheet[dst + channel] * (1 - alpha),
          );
        }
        sheet[dst + 3] = 255;
      }
    }
  });

  fs.writeFileSync(path.join(OUT_DIR, '_preview.png'), encodePng(width, height, sheet));
  return { width, height };
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const rendered = ICONS.map((spec) => {
  const pixels = drawIcon(spec);
  fs.writeFileSync(path.join(OUT_DIR, `${spec.file}.png`), encodePng(SIZE, SIZE, pixels));
  return { ...spec, pixels };
});

const sheet = writeContactSheet(rendered);

console.log(`Wrote ${rendered.length} role icons to ${path.relative(process.cwd(), OUT_DIR)}`);
for (const icon of rendered) console.log(`  ${icon.file}.png  — ${icon.name}`);
console.log(`  _preview.png — contact sheet ${sheet.width}x${sheet.height}`);
