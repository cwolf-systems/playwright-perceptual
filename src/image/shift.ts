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
// it in the other image, both ways round. A rasteriser covers an edge more sharply than bilinear
// resampling mixes it, so beside a neighbour that kept its colour the range is widened by the
// contrast across it.
//
// Each box is judged by its own move, per channel. An edge inside a box lets its total take a wide
// range, so a faint change of colour beside an edge that did not move passes as a move.

/**
 * The boxes tested, the most decisive first: each one's side, the levels per pixel of the box by
 * which a total may lie outside the range, for rounding, and the share of the range itself by which
 * it may, for sharpness.
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
  { side: 65, slack: 0.75, widen: 0 },
  { side: 5, slack: ROUNDING_LEVELS + 0.25, widen: 0 },
] as const;

/**
 * The pixel alone, with three levels of slack: 0.1.0's. With one or two, real renders of the same
 * scene fail. What a rasteriser moves across a box's border matches bilinear resampling on
 * average, but a single pixel along an edge only roughly: a thin line moved by half a pixel, for
 * one, gathers into a pixel darker than any beside it. Widened by the whole range, such moves of
 * text, SVG and charts pass; from 0.8 to 1.2 of the range, no verdict changes for the worse. A flat
 * neighbourhood has no range, so a speck there still counts.
 */
const PIXEL = { side: 1, slack: 3, widen: 1 } as const;

type Box = (typeof BOXES)[number] | typeof PIXEL;

const CHANNELS = 3;
const LEVELS = [red, green, blue];

/** Rows and columns filtered at once: an image is filtered only in tiles where a pixel is judged. */
const TILE = { rows: 256, columns: 512 } as const;

/** Pixels read beyond a tile, for the boxes that judge the pixels at its edge. */
const MARGIN = BOXES[0].side + 1;

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
  const sum = (tile: Tile, c: number, x0: number, y0: number) => total(tile, nx, ny, c, x0, y0);
  channels: for (let c = 0; c < CHANNELS; c++) {
    for (const sx of width > 1 ? SIGNS : STILL) {
      const x0 = place(x, nx, width, sx);
      for (const sy of height > 1 ? SIGNS : STILL) {
        const y0 = place(y, ny, height, sy);
        if (x0 < 0 || y0 < 0) continue;
        const here = sum(from, c, x0, y0);
        const across = sum(from, c, x0 + sx, y0);
        const down = sum(from, c, x0, y0 + sy);
        const both = sum(from, c, x0 + sx, y0 + sy);
        const target = sum(to, c, x0, y0);
        const lo = Math.min(here, across, down, both);
        const hi = Math.max(here, across, down, both);
        // Widened only beside a neighbour that kept its colour, give or take rounding: an edge
        // drawn more sharply leaves the colour beside it, while an edge whose sides changed colour
        // too is a change. From no level to three, no verdict is lost; one counts the fewest
        // pixels on pairs that should match.
        const kept = (x1: number, y1: number) =>
          Math.abs(sum(from, c, x1, y1) - sum(to, c, x1, y1)) <= ROUNDING_LEVELS * nx * ny;
        const sharp =
          box.widen > 0 && (kept(x0 + sx, y0) || kept(x0, y0 + sy) || kept(x0 + sx, y0 + sy));
        const allowed = box.slack * nx * ny + (sharp ? box.widen * (hi - lo) : 0);
        if (target >= lo - allowed && target <= hi + allowed) continue channels;
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

/** Whether pixel (x, y) differs only because content moved by less than a pixel. */
export function isShifted(image: Pixels, other: Pixels, x: number, y: number): boolean {
  const before = tile(image, x, y);
  const after = tile(other, x, y);
  // The pixel both ways round, so a colour that appears or goes away is not a move. A colour
  // that went away from content of high contrast is sometimes a move too, and is then refused.
  return (
    conserved(image, other, x, y) &&
    moved(before, after, PIXEL, x, y) &&
    moved(after, before, PIXEL, x, y)
  );
}
