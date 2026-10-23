// Synthetic image pairs that reproduce findings from a downstream WebGL map renderer's test
// suite (reported 2026-10-22), for the accuracy benchmark and the unit tests. The original
// captures contain third-party basemap tiles and are not redistributed; these are generated from
// scratch and reproduce each phenomenon, so the same pixel classes reach the comparator.
//
// Every generator is deterministic: the same arguments give the same bytes on every platform.
// Images are 8-bit RGBA, { data, width, height }, row by row from the top left.

const WIDTH = 320;
const HEIGHT = 200;

/** Sub-samples per axis when a pixel's colour is the average over its area. */
const SUPERSAMPLE = 4;

// A hash of integer lattice coordinates to [0, 1): smooth value noise needs nothing stored.
function hash(ix, iy, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}

const smooth = (t) => t * t * (3 - 2 * t);

function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const top = hash(ix, iy, seed) * (1 - fx) + hash(ix + 1, iy, seed) * fx;
  const bottom = hash(ix, iy + 1, seed) * (1 - fx) + hash(ix + 1, iy + 1, seed) * fx;
  return top * (1 - fy) + bottom * fy;
}

// Two terrains, both dark, as basemaps look dimmed under overlays: a smooth relief map, whose
// neighbouring pixels mostly differ by a level or none, with contour lines; and a rough one with
// detail down to a few pixels.
const SMOOTH = {
  octaves: [
    [64, 1],
    [32, 0.5],
    [16, 0.25],
    [8, 0.12],
  ],
  low: [60, 52, 46],
  high: [94, 78, 68],
  relief: 6,
  contours: 6,
};
const ROUGH = {
  octaves: [
    [48, 1],
    [24, 0.5],
    [12, 0.25],
    [6, 0.125],
    [3, 0.07],
  ],
  low: [62, 74, 58],
  high: [104, 92, 76],
  relief: 9,
  contours: 0,
};

const CONTOUR_HALF_WIDTH = 0.25;
const CONTOUR_SHADE = 0.8;

/** Terrain height at a point, in [0, 1]. */
function terrainHeight(terrain, x, y, seed) {
  let h = 0;
  let total = 0;
  for (const [scale, amplitude] of terrain.octaves) {
    h += amplitude * valueNoise(x / scale, y / scale, seed);
    total += amplitude;
  }
  return h / total;
}

/**
 * A terrain's height, remembered at the sample points of an area render (`renderArea`) whose
 * scene is panned by `pan`. Hillshading reads the height half a pixel either side of each sample,
 * which is mostly another sample, so each height is computed about once rather than five times.
 * A point is looked up only when its coordinates equal a sample's exactly, so the image is the
 * same as without this.
 */
function sampledHeights(terrain, seed, pan, width = WIDTH, height = HEIGHT) {
  const step = 1 / SUPERSAMPLE;
  // The coordinates renderArea passes, computed the same way, with the pan added as the scene does.
  const at = (n) => Math.floor(n / SUPERSAMPLE) + ((n % SUPERSAMPLE) + 0.5) * step;
  const columns = Float64Array.from({ length: width * SUPERSAMPLE }, (_, i) => at(i) + pan);
  const rows = Float64Array.from({ length: height * SUPERSAMPLE }, (_, j) => at(j));
  const known = new Float64Array(columns.length * rows.length).fill(NaN);
  return (x, y) => {
    const i = Math.round((x - pan) * SUPERSAMPLE - 0.5);
    const j = Math.round(y * SUPERSAMPLE - 0.5);
    if (!(columns[i] === x && rows[j] === y)) return terrainHeight(terrain, x, y, seed);
    const k = j * columns.length + i;
    let h = known[k];
    if (Number.isNaN(h)) h = known[k] = terrainHeight(terrain, x, y, seed);
    return h;
  };
}

/** The terrain's hillshaded colour at a point, as unrounded sRGB levels, and its height. */
function terrainAt(terrain, x, y, seed, height = (px, py) => terrainHeight(terrain, px, py, seed)) {
  const h = height(x, y);
  const dx = height(x + 0.5, y) - height(x - 0.5, y);
  const dy = height(x, y + 0.5) - height(x, y - 0.5);
  const shade = Math.min(1.4, Math.max(0.6, 1 + terrain.relief * (dx - dy)));
  const { low, high } = terrain;
  const colour = [
    (low[0] + (high[0] - low[0]) * h) * shade,
    (low[1] + (high[1] - low[1]) * h) * shade,
    (low[2] + (high[2] - low[2]) * h) * shade,
  ];
  if (terrain.contours > 0) {
    // Contour lines half a pixel wide: distance to the nearest contour, in pixels.
    const level = h * terrain.contours;
    const distance = Math.abs(level - Math.round(level)) / (terrain.contours * Math.hypot(dx, dy));
    if (distance < CONTOUR_HALF_WIDTH) {
      return {
        colour: [colour[0] * CONTOUR_SHADE, colour[1] * CONTOUR_SHADE, colour[2] * CONTOUR_SHADE],
        h,
      };
    }
  }
  return { colour, h };
}

const terrainColour = (terrain, x, y, seed) => terrainAt(terrain, x, y, seed).colour;

// Written out per channel rather than mapped: a render calls it millions of times.
const blend = (under, over, alpha) => [
  under[0] * (1 - alpha) + over[0] * alpha,
  under[1] * (1 - alpha) + over[1] * alpha,
  under[2] * (1 - alpha) + over[2] * alpha,
];

/** Renders a scene, given as a colour at a point, by the average over each pixel's area. */
function renderArea(colourAt, width = WIDTH, height = HEIGHT) {
  const data = new Uint8Array(width * height * 4);
  const step = 1 / SUPERSAMPLE;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const colour = colourAt(x + (sx + 0.5) * step, y + (sy + 0.5) * step);
          for (let c = 0; c < 3; c++) sum[c] += colour[c];
        }
      }
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(sum[c] / SUPERSAMPLE ** 2);
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Renders a scene by its colour at each pixel's centre, as rasterisers without anti-aliasing do. */
function renderCentres(colourAt, width = WIDTH, height = HEIGHT) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const colour = colourAt(x + 0.5, y + 0.5);
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(colour[c]);
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Whether a point lies inside a convex polygon whose vertices run clockwise on screen. */
function insideConvex(polygon, x, y) {
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) return false;
  }
  return true;
}

// Finding 1: a translucent elevation surface, coloured by altitude, over the terrain. Only its
// opacity changes; nothing moves.
const SURFACE = [
  [40, 70],
  [250, 52],
  [292, 150],
  [150, 186],
  [24, 160],
];
const SURFACE_LOW = [70, 98, 90];
const SURFACE_HIGH = [84, 112, 102];

function surfaceScene(opacity, pan = 0) {
  const height = sampledHeights(SMOOTH, 7, pan);
  return (x, y) => {
    const { colour, h } = terrainAt(SMOOTH, x + pan, y, 7, height);
    if (!insideConvex(SURFACE, x + pan, y)) return colour;
    return blend(colour, blend(SURFACE_LOW, SURFACE_HIGH, h), opacity);
  };
}

// Finding 1's pairs share their unpanned image at 35%; each render is kept, and copied out.
const surfaceRenders = new Map();

function renderSurface(opacity, pan = 0) {
  const key = `${opacity} ${pan}`;
  if (!surfaceRenders.has(key)) surfaceRenders.set(key, renderArea(surfaceScene(opacity, pan)));
  const { data, width, height } = surfaceRenders.get(key);
  return { data: Uint8Array.from(data), width, height };
}

/**
 * Finding 1. The surface at 35% opacity, then at 30%: a real change, visible as a lighter wash
 * over the area, of two or three levels per channel.
 */
export function surfaceOpacity(before = 0.35, after = 0.3) {
  return { expected: renderSurface(before), actual: renderSurface(after) };
}

/** The control for finding 1: the same scene panned by part of a pixel, with nothing else changed. */
export function surfacePanned(pan = 0.3) {
  return { expected: renderSurface(0.35), actual: renderSurface(0.35, pan) };
}

// Finding 2: a map label, a translucent box with text, placed at a projected position. Two
// loads of the same scene land the anchor either side of a pixel boundary, so the label moves by
// a whole pixel, or one edge of its box covers one more row.

// 5×7 glyphs, one string per row, '#' for ink.
const GLYPHS = {
  3: ['#####', '   # ', '  #  ', '   # ', '    #', '#   #', ' ### '],
  1: ['  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  6: ['  ## ', ' #   ', '#    ', '#### ', '#   #', '#   #', ' ### '],
  5: ['#####', '#    ', '#### ', '    #', '    #', '#   #', ' ### '],
  m: ['     ', '     ', '## # ', '# # #', '# # #', '# # #', '# # #'],
};
const LABEL_TEXT = '1563m';
const LABEL_BOX = [24, 72, 34, 14];
const LABEL_FILL = [24, 26, 32];
const LABEL_OPACITY = 0.8;
const LABEL_INK = [232, 84, 72];

function inkAt(text, x, y) {
  const glyph = Math.floor(x / 6);
  const gx = Math.floor(x) - glyph * 6;
  const gy = Math.floor(y);
  const rows = GLYPHS[text[glyph]];
  return rows !== undefined && gy >= 0 && gy < 7 && gx < 5 && rows[gy][gx] === '#';
}

function labelScene(anchorX, anchorY, boxBottom) {
  const [left, top, width, height] = LABEL_BOX;
  const ax = Math.round(anchorX);
  const ay = Math.round(anchorY);
  const bottom = boxBottom ?? ay + top + height;
  return (x, y) => {
    const terrain = terrainColour(ROUGH, x, y, 11);
    const lx = x - ax - left;
    const ly = y - ay - top;
    if (lx < 0 || lx >= width || ly < 0 || y >= bottom) return terrain;
    const box = blend(terrain, LABEL_FILL, LABEL_OPACITY);
    return inkAt(LABEL_TEXT, lx - 2, ly - 3) ? LABEL_INK : box;
  };
}

/** Finding 2. The label's anchor lands at x = 100.49 in one load and 100.51 in the next. */
export function labelMoved() {
  return {
    expected: renderCentres(labelScene(100.49, 40)),
    actual: renderCentres(labelScene(100.51, 40)),
  };
}

/** Finding 2. The label's box covers one more row in one load: its bottom edge crosses a centre. */
export function labelEdge() {
  const bottom = 40 + LABEL_BOX[1] + LABEL_BOX[3];
  return {
    expected: renderCentres(labelScene(100, 40, bottom + 0.49)),
    actual: renderCentres(labelScene(100, 40, bottom + 0.51)),
  };
}

// Finding 3: the same scene through a rasteriser that snaps vertices to 1/16 px (SwiftShader) and
// one that does not (Metal). Interpolated terrain moves by less than 1/32 px; an aliased overlay
// edge that passes within 1/32 px of a row of pixel centres flips the whole row.

const SUBPIXEL = 16;
const snap = (v) => Math.round(v * SUBPIXEL) / SUBPIXEL;

// A geofence fill; its bottom edge runs 0.02 px past the centres of row 129 (y = 129.5), its
// sloped edges pass near many centres.
const GEOFENCE = [
  [60, 40.3],
  [230, 46.7],
  [262, 129.52],
  [44, 129.52],
];
const GEOFENCE_FILL = [213, 0, 0];
const GEOFENCE_OPACITY = 0.35;

// Point (x, y) is covered when strictly inside: a centre on an edge belongs to the neighbour.
function covered(polygon, x, y) {
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) <= 0) return false;
  }
  return true;
}

/** How far interpolation across a snapped mesh moves the terrain: under 1/32 px, smoothly. */
function snapError(x, y) {
  return [
    (valueNoise(x / 20, y / 20, 5) - 0.5) / (SUBPIXEL / 2),
    (valueNoise(x / 20, y / 20, 6) - 0.5) / (SUBPIXEL / 2),
  ];
}

function rasteriserScene(snapped, overlay) {
  const polygon = snapped ? GEOFENCE.map(([x, y]) => [snap(x), snap(y)]) : GEOFENCE;
  return (x, y) => {
    const [dx, dy] = snapped ? snapError(x, y) : [0, 0];
    const terrain = terrainColour(ROUGH, x + dx, y + dy, 3);
    return overlay && covered(polygon, x, y)
      ? blend(terrain, GEOFENCE_FILL, GEOFENCE_OPACITY)
      : terrain;
  };
}

/** Finding 3. The terrain alone, through each rasteriser. */
export function rasteriserTerrain() {
  return {
    expected: renderCentres(rasteriserScene(false, false)),
    actual: renderCentres(rasteriserScene(true, false)),
  };
}

/** Finding 3. The terrain with an aliased, translucent geofence over it, through each rasteriser. */
export function rasteriserOverlay() {
  return {
    expected: renderCentres(rasteriserScene(false, true)),
    actual: renderCentres(rasteriserScene(true, true)),
  };
}

// Finding 4: a 4×4 texture magnified to 64×64 with a linear, clamp-to-edge sampler. Exact
// bilinear filtering against the same filter computed in half precision, as GPUs may (OpenGL ES
// 3.0 §3.8.10 leaves the precision of filter weights to the implementation): every channel within
// one level, and a few pixels where two channels round opposite ways past ΔE00 1.

const TEXELS = Array.from({ length: 16 }, (_, i) => [
  (53 * i) % 256,
  (97 * i + 31) % 256,
  (((255 - 16 * i) % 256) + 256) % 256,
]);

/** Rounds to the nearest binary16 value (normal range only, which is all this needs). */
function half(v) {
  if (v === 0) return 0;
  const step = 2 ** (Math.floor(Math.log2(Math.abs(v))) - 10);
  return Math.round(v / step) * step;
}

function bilinear(precise) {
  const size = 64;
  const texel = (x, y, c) =>
    TEXELS[Math.min(3, Math.max(0, y)) * 4 + Math.min(3, Math.max(0, x))][c];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 4 - 0.5;
      const v = ((y + 0.5) / size) * 4 - 0.5;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const fx = u - x0;
      const fy = v - y0;
      for (let c = 0; c < 3; c++) {
        const t00 = texel(x0, y0, c);
        const t10 = texel(x0 + 1, y0, c);
        const t01 = texel(x0, y0 + 1, c);
        const t11 = texel(x0 + 1, y0 + 1, c);
        let value;
        if (precise) {
          value =
            t00 * (1 - fx) * (1 - fy) + t10 * fx * (1 - fy) + t01 * (1 - fx) * fy + t11 * fx * fy;
        } else {
          const n = (t) => half(t / 255);
          const top = half(half(n(t00) * half(1 - fx)) + half(n(t10) * half(fx)));
          const bottom = half(half(n(t01) * half(1 - fx)) + half(n(t11) * half(fx)));
          value = half(half(top * half(1 - fy)) + half(bottom * half(fy))) * 255;
        }
        data[(y * size + x) * 4 + c] = Math.round(value);
      }
      data[(y * size + x) * 4 + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

/** Finding 4. Exact bilinear magnification, and the same in half precision. */
export function bilinearRounding() {
  return { expected: bilinear(true), actual: bilinear(false) };
}

/** The labelled pairs, as the accuracy benchmark reports them. */
export const SYNTHETIC_PAIRS = [
  {
    name: 'surface opacity 35% → 30%',
    finding: 1,
    category: 'faint regression',
    shouldMatch: false,
    make: () => surfaceOpacity(),
  },
  {
    name: 'surface panned 0.3 px',
    finding: 1,
    category: 'sub-pixel shift',
    shouldMatch: true,
    make: () => surfacePanned(),
  },
  {
    name: 'label moved a pixel',
    finding: 2,
    category: 'self-noise',
    shouldMatch: true,
    make: labelMoved,
  },
  {
    name: 'label box one row taller',
    finding: 2,
    category: 'self-noise',
    shouldMatch: true,
    make: labelEdge,
  },
  {
    name: 'terrain, snapped vertices',
    finding: 3,
    category: 'software vs GPU',
    shouldMatch: true,
    make: rasteriserTerrain,
  },
  {
    name: 'geofence, snapped vertices',
    finding: 3,
    category: 'software vs GPU',
    shouldMatch: true,
    make: rasteriserOverlay,
  },
  {
    name: 'bilinear in half precision',
    finding: 4,
    category: 'rounding',
    shouldMatch: true,
    make: bilinearRounding,
  },
];
