import { blue, green, red, ROUNDING_LEVELS } from '../color/rgb.js';
import type { Pixels } from './types.js';

// Content moved by less than a pixel keeps its colour: over a box, each channel's total changes
// only by what the move carries across the box's border. A real change, such as a tint, a fainter
// overlay or a drift of a few levels, changes the total over the whole box.
//
// Moving by (tx, ty), each between 0 and 1 in one of four directions, and resampling bilinearly,
// changes a box's total by tx·Lx + ty·Ly + tx·ty·K, where Lx is the column brought in less the
// column taken out, Ly the same for rows, and K the corners where they cross. That is bilinear in
// tx and ty, so it ranges between its values at the corners of the square: the change in the
// box's total when the box is moved by a whole pixel across, down, both or neither.
//
// So, one rule: box-filter both images, and one image's box total at a pixel must lie within the
// range of the other's box totals there and one pixel over, in one of the four directions, give
// or take rounding. It is tested over two boxes, either image being the one that moved:
//
// - 65×65: over texture, a drift of a level or two is what a move up the local slope would do to
//   a small box, but over a box this large the texture rises and falls, a move carries as much
//   colour in as out, and the drift remains.
// - 5×5: a real change smaller than the large box, such as a faint stroke, survives this one.
//
// And over the pixel alone, where the rule says the pixel's colour lies within the colours next to
// it in the other image, both ways round, so a colour that appears or goes away is not a move.
//
// Each box is judged by its own move, per channel. An edge inside a box lets its total take a wide
// range, so a faint change of colour beside an edge that did not move passes as a move.

/**
 * The boxes tested, the most decisive first: each one's side, and the levels per pixel of the box
 * by which a total may lie outside the range, for rounding.
 *
 * Rounding in either image enters a box's total by up to half a level per pixel, so a level per
 * pixel covers it. Renderings of the same scene through the GPU and in software differ by a little
 * more where one is lighter across an area. The 5×5 box allows a quarter of a level more: every
 * value from one level to one and a half loses no verdict on the benchmark, and below a quarter
 * more, those renderings count more pixels. Over the large box rounding goes both ways and its
 * worst case is not reached: 0.5625 of a level per pixel fails those renderings, 0.6 does not.
 * Three quarters keeps a fifth of the value between it and that edge, at the cost of a few points
 * of a faint overlay change, which a tighter bound would count.
 */
const BOXES = [
  { side: 65, slack: 0.75 },
  { side: 5, slack: ROUNDING_LEVELS + 0.25 },
] as const;

/**
 * The pixel alone, with three levels of slack: 0.1.0's. With one or two, real renders of the same
 * scene fail. The pixel's range is not widened for edges drawn more sharply than resampling mixes
 * them: a band of new colour one pixel wide beside an edge, such as a ring or an outline, lies
 * beyond the colours next to it just as such an edge pixel does, and must count.
 */
const PIXEL = { side: 1, slack: 3 } as const;

type Box = (typeof BOXES)[number] | typeof PIXEL;

const CHANNELS = 3;
const LEVELS = [red, green, blue];

/** Rows and columns filtered at once: an image is filtered only in tiles where a pixel is judged. */
const TILE = { rows: 256, columns: 512 } as const;

/** Pixels read beyond a tile, for the boxes that judge the pixels at its edge. */
const MARGIN = Math.max(...BOXES.map((box) => box.side)) + 1;

/** Directions a box may move along a side: both, or none along a side of one pixel. */
const SIGNS = [-1, 1];
const STILL = [0];

/**
 * Where a box of `n` pixels starts along a side of `size` to judge the pixel at `p` against a move
 * of a pixel towards `sign` (0 for none), or -1 if none can. The box sits around the pixel, moved inward near
 * the border so that the box moved is in the image too: colour is conserved over any box, so the
 * test stays sound off centre. A box of one pixel judges that pixel's own colour, so it cannot
 * move: on the outermost pixels, a move from beyond the border explains nothing, and across an
 * image one pixel wide no move does.
 */
function place(p: number, n: number, size: number, sign: number): number {
  const start = Math.max(sign < 0 ? 1 : 0, Math.min(p - (n >> 1), size - n - (sign > 0 ? 1 : 0)));
  return n === 1 && start !== p ? -1 : start;
}

/** A tile of an image, with each channel's summed-area table: its totals from the top left. */
interface Tile {
  readonly pixels: Pixels;
  readonly left: number;
  readonly top: number;
  /** Entries in a row of the table: one column more than the tile, by channel. */
  readonly stride: number;
  readonly sums: Uint32Array;
}

/** Channel `c`'s total over the box of `nx` × `ny` pixels whose top left pixel is (x, y). */
function total(tile: Tile, nx: number, ny: number, c: number, x: number, y: number): number {
  const { stride, sums } = tile;
  const above = (y - tile.top) * stride + (x - tile.left) * CHANNELS + c;
  const below = above + ny * stride;
  const across = nx * CHANNELS;
  return sums[below + across]! - sums[below]! - sums[above + across]! + sums[above]!;
}

/** Reads the tile of `pixels` in the given column and row of tiles into its summed-area table. */
function filter(pixels: Pixels, column: number, row: number): Tile {
  const { width, height } = pixels;
  const left = Math.max(0, column * TILE.columns - MARGIN);
  const top = Math.max(0, row * TILE.rows - MARGIN);
  const across = Math.min(width, (column + 1) * TILE.columns + MARGIN) - left;
  const rows = Math.min(height, (row + 1) * TILE.rows + MARGIN) - top;
  // A first row and column of zeros, so every box's total is four entries.
  const stride = (across + 1) * CHANNELS;
  const sums = new Uint32Array((rows + 1) * stride);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < across; x++) {
      const rgb = pixels.rgbAt(left + x, top + y);
      const i = (y + 1) * stride + (x + 1) * CHANNELS;
      // Each channel's level, plus the totals to the left and above, less their overlap.
      for (let c = 0; c < CHANNELS; c++) {
        const level = LEVELS[c]!(rgb);
        const before = sums[i + c - CHANNELS]! - sums[i + c - stride - CHANNELS]!;
        sums[i + c] = level + before + sums[i + c - stride]!;
      }
    }
  }
  return { pixels, left, top, stride, sums };
}

// The tiles filtered in the last row of tiles of each image. Pixels are judged row by row, so a
// tile is filtered once. They are kept by image, which must not change while it is judged.
const tiles = new WeakMap<Pixels, { row: number; tiles: Tile[] }>();

function tile(pixels: Pixels, x: number, y: number): Tile {
  const row = Math.floor(y / TILE.rows);
  const column = Math.floor(x / TILE.columns);
  let cached = tiles.get(pixels);
  if (cached?.row !== row) tiles.set(pixels, (cached = { row, tiles: [] }));
  return (cached.tiles[column] ??= filter(pixels, column, row));
}

/**
 * Whether, in every channel, `to`'s total over `box` around (x, y) lies within what a move of
 * under a pixel in `from` leaves, give or take rounding.
 */
function moved(from: Tile, to: Tile, box: Box, x: number, y: number): boolean {
  const { width, height } = from.pixels;
  // At most the box's side, leaving room to move the box by a pixel where the side has room.
  const nx = Math.max(1, Math.min(box.side, width - 1));
  const ny = Math.max(1, Math.min(box.side, height - 1));
  const slack = box.slack * nx * ny;
  channels: for (let c = 0; c < CHANNELS; c++) {
    for (const sx of width > 1 ? SIGNS : STILL) {
      const x0 = place(x, nx, width, sx);
      for (const sy of height > 1 ? SIGNS : STILL) {
        const y0 = place(y, ny, height, sy);
        if (x0 < 0 || y0 < 0) continue;
        const here = total(from, nx, ny, c, x0, y0);
        const across = total(from, nx, ny, c, x0 + sx, y0);
        const down = total(from, nx, ny, c, x0, y0 + sy);
        const both = total(from, nx, ny, c, x0 + sx, y0 + sy);
        const target = total(to, nx, ny, c, x0, y0);
        const lo = Math.min(here, across, down, both);
        const hi = Math.max(here, across, down, both);
        if (target >= lo - slack && target <= hi + slack) continue channels;
      }
    }
    return false;
  }
  return true;
}

/**
 * Whether the change at pixel (x, y) is what a move of under a pixel leaves in every box, either
 * image being the one that moved. Sound: a bilinear move of any content passes, give or take
 * rounding.
 */
export function conserved(image: Pixels, other: Pixels, x: number, y: number): boolean {
  const before = tile(image, x, y);
  const after = tile(other, x, y);
  return BOXES.every((box) => moved(before, after, box, x, y) || moved(after, before, box, x, y));
}

/**
 * The window over which one move is fitted, and the residual each of its pixels may keep: rounding,
 * plus a share of the pixel's contrast with its neighbours, since a rasteriser moves an edge by its
 * coverage of each pixel and not by resampling, which differs most where the contrast is high.
 */
export const FIT = { side: 5, rounding: 1.25, contrast: 0.25, steps: 32, bias: 1.25, spread: 2 };

/** The largest difference in each channel between (x, y) and its four neighbours. */
function contrast(image: Pixels, x: number, y: number, c: number): number {
  const level = LEVELS[c]!;
  const here = level(image.rgbAt(x, y));
  let most = 0;
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue;
    most = Math.max(most, Math.abs(level(image.rgbAt(nx, ny)) - here));
  }
  return most;
}

const clamp = (v: number, size: number) => Math.max(0, Math.min(size - 1, v));

/**
 * Whether one move of `from` by under a pixel, the same for every pixel and channel of the window
 * around (x, y), leaves `to` within the residual FIT allows, in the mean. A move of (tx, ty)
 * towards (sx, sy), resampled bilinearly, changes a pixel by tx·a + ty·b + tx·ty·e, where a and b
 * are its differences with the pixels across and down, and e their cross term; the fit is least
 * squares over tx in FIT.steps steps, each with its best ty in closed form.
 */
function fits(from: Pixels, to: Pixels, x: number, y: number): boolean {
  const { width, height } = from;
  const half = FIT.side >> 1;
  const n = FIT.side * FIT.side * CHANNELS;
  const d = new Float64Array(n);
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  const e = new Float64Array(n);
  const w = new Float64Array(n);
  for (const sx of SIGNS) {
    for (const sy of SIGNS) {
      let k = 0;
      for (let qy = y - half; qy <= y + half; qy++) {
        for (let qx = x - half; qx <= x + half; qx++) {
          const px = clamp(qx, width);
          const py = clamp(qy, height);
          const here = from.rgbAt(px, py);
          const across = from.rgbAt(clamp(px + sx, width), py);
          const down = from.rgbAt(px, clamp(py + sy, height));
          const both = from.rgbAt(clamp(px + sx, width), clamp(py + sy, height));
          const now = to.rgbAt(px, py);
          for (let c = 0; c < CHANNELS; c++) {
            const level = LEVELS[c]!;
            const h = level(here);
            d[k] = level(now) - h;
            a[k] = level(across) - h;
            b[k] = level(down) - h;
            e[k] = level(both) - level(across) - level(down) + h;
            const tolerance = FIT.rounding + FIT.contrast * contrast(from, px, py, c);
            w[k] = 1 / (tolerance * tolerance);
            k++;
          }
        }
      }
      // The best move, then what it leaves in each channel over the window, on average.
      let best = Infinity;
      let bestX = 0;
      let bestY = 0;
      for (let step = 0; step <= FIT.steps; step++) {
        const tx = step / FIT.steps;
        let gg = 0;
        let gr = 0;
        for (let i = 0; i < n; i++) {
          const g = b[i]! + tx * e[i]!;
          gg += w[i]! * g * g;
          gr += w[i]! * g * (d[i]! - tx * a[i]!);
        }
        const ty = gg > 0 ? Math.max(0, Math.min(1, gr / gg)) : 0;
        let sum = 0;
        for (let i = 0; i < n; i++) {
          const r = d[i]! - tx * a[i]! - ty * (b[i]! + tx * e[i]!);
          sum += w[i]! * r * r;
        }
        if (sum < best) {
          best = sum;
          bestX = tx;
          bestY = ty;
        }
      }
      // What the best move leaves on the values that changed, weighted as in the fit: on average
      // a move leaves nothing, a uniform change leaves itself.
      const left = [0, 0, 0];
      const weight = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        if (d[i] === 0) continue;
        left[i % CHANNELS]! += w[i]! * (d[i]! - bestX * a[i]! - bestY * (b[i]! + bestX * e[i]!));
        weight[i % CHANNELS]! += w[i]!;
      }
      // A bias over a few values of high contrast says little, so the bound also grows with the
      // square root of the weight, as the spread of a weighted sum of noise does.
      const within = (r: number, c: number) =>
        Math.abs(r) <= FIT.bias * weight[c]! + FIT.spread * Math.sqrt(weight[c]!);
      if (left.every(within)) return true;
    }
  }
  return false;
}

/** Whether pixel (x, y) differs only because content moved by less than a pixel. */
export function isShifted(image: Pixels, other: Pixels, x: number, y: number): boolean {
  const before = tile(image, x, y);
  const after = tile(other, x, y);
  // The pixel both ways round, so a colour that appears or goes away is not a move. A colour
  // that went away from content of high contrast is sometimes a move too, and is then refused.
  return (
    conserved(image, other, x, y) &&
    moved(before, after, PIXEL, x, y) &&
    moved(after, before, PIXEL, x, y) &&
    (fits(image, other, x, y) || fits(other, image, x, y))
  );
}
