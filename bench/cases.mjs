// Should-fail pairs the accuracy benchmark lacked: a removed one-pixel line, a change of how text
// is anti-aliased or hinted, and dark themes. Any change that sets more pixels aside as noise,
// such as filtering out detail too fine to see, could hide exactly these, so they are measured
// before such a change is tried.
//
// They are drawn from scratch, like bench/synthetic.mjs, so the same bytes reach the comparator on
// every platform: a browser's switches for subpixel text and hinting differ by platform, and most
// platforms have neither.
//
// Each pair is labelled by construction: it should fail. test/compare/cases.test.ts checks that
// each changes at least MIN_CHANGED pixels and that some reach ΔE00 MIN_DELTA_E, the benchmark's
// floor for a visible regression; a pair that does not is dropped, not relabelled.

import { blend, renderArea, ROUGH, terrainColour } from './synthetic.mjs';

const WIDTH = 320;
const HEIGHT = 200;

export const MIN_CHANGED = 20;
export const MIN_DELTA_E = 3;

// ---------------------------------------------------------------------------------------------
// Shapes

/** Whether a point lies inside a convex polygon, whichever way its vertices run. */
function insideConvex(polygon, x, y) {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    const side = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
    if (side === 0) continue;
    if (sign === 0) sign = side;
    else if (side !== sign) return false;
  }
  return true;
}

/** Distance from a point to the segment from a to b. */
function toSegment([ax, ay], [bx, by], x, y) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

// ---------------------------------------------------------------------------------------------
// A removed overlay outline: a translucent zone over textured ground, outlined one pixel wide

const ZONE_FILL = [41, 98, 255];
const ZONE_FILL_OPACITY = 0.12;
const ZONE_OUTLINE = [41, 98, 255];

/** A rectangle whose edges lie on pixel boundaries, so its outline covers whole pixels. */
const CRISP_ZONE = { left: 60, top: 50, right: 250, bottom: 150 };

function crispZone(outlined) {
  const { left, top, right, bottom } = CRISP_ZONE;
  return (x, y) => {
    const ground = terrainColour(ROUGH, x, y, 21);
    if (x < left || x >= right || y < top || y >= bottom) return ground;
    const onOutline = x < left + 1 || x >= right - 1 || y < top + 1 || y >= bottom - 1;
    if (outlined && onOutline) return ZONE_OUTLINE;
    return blend(ground, ZONE_FILL, ZONE_FILL_OPACITY);
  };
}

/** A pentagon with sloped edges, so its outline, one pixel wide, falls across two pixels. */
const SLOPED_ZONE = [
  [72.3, 40.6],
  [236.8, 31.2],
  [281.4, 118.7],
  [171.9, 171.3],
  [41.2, 132.8],
];

function slopedZone(outlined) {
  return (x, y) => {
    const ground = terrainColour(ROUGH, x, y, 22);
    if (outlined) {
      for (let i = 0; i < SLOPED_ZONE.length; i++) {
        const a = SLOPED_ZONE[i];
        const b = SLOPED_ZONE[(i + 1) % SLOPED_ZONE.length];
        if (toSegment(a, b, x, y) <= 0.5) return ZONE_OUTLINE;
      }
    }
    if (!insideConvex(SLOPED_ZONE, x, y)) return ground;
    return blend(ground, ZONE_FILL, ZONE_FILL_OPACITY);
  };
}

// ---------------------------------------------------------------------------------------------
// A removed grid line: a chart panel with grid lines one pixel high and bars over them

const PANEL = [251, 250, 247];
const GRID = [213, 219, 227];
const BAR = [63, 124, 191];
const GRID_ROWS = [40, 75, 110, 145, 180];
const BARS = [62, 110, 84, 140, 96, 128];

function chart(removedRow) {
  return (x, y) => {
    for (const [i, value] of BARS.entries()) {
      const left = 30 + i * 46;
      if (x >= left && x < left + 30 && y >= 180 - value && y < 180) return BAR;
    }
    const row = Math.floor(y);
    if (x >= 20 && x < 300 && row !== removedRow && GRID_ROWS.includes(row) && y < row + 1) {
      return GRID;
    }
    return PANEL;
  };
}

// ---------------------------------------------------------------------------------------------
// Text, from a 5 × 7 bitmap font whose cells are drawn as squares at any scale and position, so
// edges fall within pixels and are anti-aliased like a font's outlines.

const GLYPHS = {
  A: [' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  C: [' ####', '#    ', '#    ', '#    ', '#    ', '#    ', ' ####'],
  E: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'],
  H: ['#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #', '#   #', '#   #'],
  O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  R: ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'],
  S: [' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
  Z: ['#####', '    #', '   # ', '  #  ', ' #   ', '#    ', '#####'],
  0: [' ### ', '#   #', '#  ##', '# # #', '##  #', '#   #', ' ### '],
  1: ['  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  2: [' ### ', '#   #', '    #', '   # ', '  #  ', ' #   ', '#####'],
  4: ['   # ', '  ## ', ' # # ', '#  # ', '#####', '   # ', '   # '],
  7: ['#####', '    #', '   # ', '  #  ', ' #   ', ' #   ', ' #   '],
};
const ADVANCE = 6;
const LINE_HEIGHT = 10;
const TEXT = ['NORTH ZONE 4', 'SECTOR 7 RATE 20', 'STATE 1 ON', 'ZONE 42 EAST', 'REACH 10 SECTOR'];

/**
 * Whether a point is ink, for text set from (left, top) with cells `scale` pixels square. Hinted,
 * every cell edge is rounded to a whole pixel, as hinting snaps stems and bars to the pixel grid:
 * stems then cover whole pixels, one or two of them where the true width is between.
 */
function textInk(lines, left, top, scale, hinted) {
  const edge = (origin, n) => (hinted ? Math.round(origin + n * scale) : origin + n * scale);
  // The cell index whose edges hold v: a first guess from the true scale, moved by the snapping.
  const cell = (origin, v) => {
    let n = Math.floor((v - origin) / scale);
    while (v < edge(origin, n)) n--;
    while (v >= edge(origin, n + 1)) n++;
    return n;
  };
  return (x, y) => {
    const row = cell(top, y);
    const line = Math.floor(row / LINE_HEIGHT);
    const glyphRow = row - line * LINE_HEIGHT;
    if (row < 0 || line >= lines.length || glyphRow >= 7) return false;
    const column = cell(left, x);
    const glyph = GLYPHS[lines[line][Math.floor(column / ADVANCE)]];
    const glyphColumn = column - Math.floor(column / ADVANCE) * ADVANCE;
    return (
      column >= 0 && glyph !== undefined && glyphColumn < 5 && glyph[glyphRow][glyphColumn] === '#'
    );
  };
}

/** Samples per pixel across, a whole number per subpixel stripe, and down. */
const SUB_X = 12;
const SUB_Y = 4;

/**
 * Coverage of each third of each pixel, row by row: the share of samples that are ink in the
 * pixel's red, green and blue stripe, left to right, as on an RGB-striped panel.
 */
function stripeCoverage(ink, width, height) {
  const perStripe = SUB_X / 3;
  const coverage = new Float64Array(width * 3 * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let sx = 0; sx < SUB_X; sx++) {
        for (let sy = 0; sy < SUB_Y; sy++) {
          if (ink(x + (sx + 0.5) / SUB_X, y + (sy + 0.5) / SUB_Y)) {
            coverage[(y * width + x) * 3 + Math.floor(sx / perStripe)] += 1 / (perStripe * SUB_Y);
          }
        }
      }
    }
  }
  return coverage;
}

// FreeType's default LCD filter (FT_LCD_FILTER_DEFAULT: 0x08, 0x4D, 0x56, 0x4D, 0x08 of 256),
// which spreads each stripe's coverage over its neighbours to soften colour fringes.
const LCD_FILTER = [8 / 256, 77 / 256, 86 / 256, 77 / 256, 8 / 256];

/**
 * Text drawn over a flat background. Subpixel: each channel takes its own stripe's coverage,
 * filtered across stripes. Greyscale: every channel takes the pixel's coverage, the mean of its
 * three stripes. Colours blend in sRGB levels, as browsers draw text.
 */
function drawText(ink, background, foreground, subpixel, width = WIDTH, height = HEIGHT) {
  const stripes = stripeCoverage(ink, width, height);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * width * 3;
    const at = (k) => (k < 0 || k >= width * 3 ? 0 : stripes[row + k]);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        let cover;
        if (subpixel) {
          cover = 0;
          for (let t = 0; t < LCD_FILTER.length; t++)
            cover += LCD_FILTER[t] * at(x * 3 + c + t - 2);
        } else {
          cover = (at(x * 3) + at(x * 3 + 1) + at(x * 3 + 2)) / 3;
        }
        data[i + c] = Math.round(background[c] + (foreground[c] - background[c]) * cover);
      }
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const PAGE = [251, 250, 247];
const INK = [31, 41, 51];
/** Cells of a little under a pixel and a half, so stems fall across pixel boundaries. */
const TEXT_SCALE = 1.37;
const TEXT_LEFT = 12.3;
const TEXT_TOP = 14.6;

// ---------------------------------------------------------------------------------------------
// A dark theme: text on a dark panel, with a divider one pixel high

const DARK = [30, 34, 40];
const DARK_LIGHTER = [41, 45, 52];
const DARK_TEXT = [201, 209, 217];
const DARK_TEXT_DIMMED = [184, 192, 200];
const DIVIDER = [59, 67, 77];
const DIVIDER_ROW = 100;

function darkPanel({ background = DARK, text = DARK_TEXT, divider = true } = {}) {
  const top = textInk(TEXT.slice(0, 3), 14.4, 18.7, 1.5, false);
  const bottom = textInk(TEXT.slice(3), 14.4, 118.7, 1.5, false);
  return (x, y) => {
    if (top(x, y) || bottom(x, y)) return text;
    if (divider && x >= 8 && x < 312 && Math.floor(y) === DIVIDER_ROW) return DIVIDER;
    return background;
  };
}

// ---------------------------------------------------------------------------------------------
// The pairs

/** The labelled pairs, as the accuracy benchmark reports them. All should fail. */
export const CASE_PAIRS = [
  {
    name: 'overlay outline removed, on whole pixels',
    category: 'line removed',
    make: () => ({ expected: renderArea(crispZone(true)), actual: renderArea(crispZone(false)) }),
  },
  {
    name: 'overlay outline removed, across two pixels',
    category: 'line removed',
    make: () => ({ expected: renderArea(slopedZone(true)), actual: renderArea(slopedZone(false)) }),
  },
  {
    name: 'grid line removed',
    category: 'line removed',
    make: () => ({ expected: renderArea(chart(null)), actual: renderArea(chart(110)) }),
  },
  {
    name: 'dark theme, divider removed',
    category: 'line removed',
    make: () => ({
      expected: renderArea(darkPanel()),
      actual: renderArea(darkPanel({ divider: false })),
    }),
  },
  {
    name: 'text, subpixel to greyscale anti-aliasing',
    category: 'text rendering',
    make: () => {
      const ink = textInk(TEXT, TEXT_LEFT, TEXT_TOP, TEXT_SCALE, false);
      return { expected: drawText(ink, PAGE, INK, true), actual: drawText(ink, PAGE, INK, false) };
    },
  },
  {
    name: 'text, hinted to unhinted',
    category: 'text rendering',
    make: () => ({
      expected: drawText(textInk(TEXT, TEXT_LEFT, TEXT_TOP, TEXT_SCALE, true), PAGE, INK, false),
      actual: drawText(textInk(TEXT, TEXT_LEFT, TEXT_TOP, TEXT_SCALE, false), PAGE, INK, false),
    }),
  },
  {
    name: 'dark theme, text dimmed',
    category: 'faint regression',
    make: () => ({
      expected: renderArea(darkPanel()),
      actual: renderArea(darkPanel({ text: DARK_TEXT_DIMMED })),
    }),
  },
  {
    name: 'dark theme, background a shade lighter',
    category: 'faint regression',
    make: () => ({
      expected: renderArea(darkPanel()),
      actual: renderArea(darkPanel({ background: DARK_LIGHTER })),
    }),
  },
];
