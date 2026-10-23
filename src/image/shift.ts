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
// or take rounding. It is tested over three boxes, either image being the one that moved:
//
// - 65×65: over texture, a drift of a level or two is what a move up the local slope would do to
//   a small box, but over a box this large the texture rises and falls, a move carries as much
//   colour in as out, and the drift remains.
// - 5×5: a real change smaller than the large box, such as a faint stroke, survives this one.
// - The pixel alone, where the rule says the pixel's colour lies within the colours next to it in
//   the other image, both ways round, so a colour that appears or goes away is not a move. A
//   rasteriser covers an edge more sharply than bilinear resampling mixes it, so here the range is
//   widened by the contrast across it.

/**
 * The boxes tested, the most decisive first: each one's side, the levels per pixel of the box by
 * which a total may lie outside the range, for rounding, and the share of the range itself by which
 * it may, for sharpness.
 *
 * - Rounding in either image enters a box's total by up to half a level per pixel, so a level per
 *   pixel covers it. Renderings of the same scene through the GPU and in software differ by a
 *   little more where one is lighter across an area, and a 5×5 box needs a quarter of a level
 *   more to pass them with room to spare. Over the large box rounding goes both ways and its
 *   worst case is not reached: half a level per pixel fails those renderings, five eighths does
 *   not, and the tighter bound counts more of a faint overlay change than the 5×5 box gives up.
 * - Over the pixel alone, three levels: 0.1.0's slack. With one or two, real renders of the same
 *   scene fail. What a rasteriser moves across a box's border matches bilinear resampling on
 *   average, but a single pixel along an edge only roughly: widened by the whole range, sub-pixel
 *   moves of text, SVG and charts pass, and no faint change counts less. Half the range passes
 *   fewer of them; a flat neighbourhood has no range, so a speck there still counts.
 */
const BOXES = [
  { side: 65, slack: 0.625, widen: 0 },
  { side: 5, slack: ROUNDING_LEVELS + 0.25, widen: 0 },
  { side: 1, slack: 3, widen: 1 },
] as const;

const CHANNELS = 3;

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

/** Each channel's totals over boxes of one size, for a tile of an image. */
interface Boxes {
  readonly nx: number;
  readonly ny: number;
  /** Boxes in a row. */
  readonly columns: number;
  readonly totals: Uint32Array;
}

/** A tile of an image, box-filtered at each size of box. */
interface Tile {
  readonly pixels: Pixels;
  readonly left: number;
  readonly top: number;
  readonly boxes: readonly Boxes[];
}

/** Channel `c`'s total over the `b`th size of box whose top left pixel is (x, y). */
function total({ left, top, boxes }: Tile, b: number, c: number, x: number, y: number): number {
  const { columns, totals } = boxes[b]!;
  return totals[((y - top) * columns + x - left) * CHANNELS + c]!;
}

/** Box-filters the tile of `pixels` in the given column and row of tiles. */
function filter(pixels: Pixels, column: number, row: number): Tile {
  const { width, height } = pixels;
  const left = Math.max(0, column * TILE.columns - MARGIN);
  const top = Math.max(0, row * TILE.rows - MARGIN);
  const across = Math.min(width, (column + 1) * TILE.columns + MARGIN) - left;
  const rows = Math.min(height, (row + 1) * TILE.rows + MARGIN) - top;
  const stride = across * CHANNELS;
  const levels = new Uint32Array(rows * stride);
  for (let y = 0, i = 0; y < rows; y++) {
    for (let x = 0; x < across; x++, i += CHANNELS) {
      const rgb = pixels.rgbAt(left + x, top + y);
      levels[i] = red(rgb);
      levels[i + 1] = green(rgb);
      levels[i + 2] = blue(rgb);
    }
  }
  // Separable running sums: totals down each column over the box's rows, then across.
  const boxes = BOXES.map(({ side: n }) => {
    // At most n, leaving room to move the box by a pixel where the side has room.
    const nx = Math.max(1, Math.min(n, width - 1));
    const ny = Math.max(1, Math.min(n, height - 1));
    const columns = across - nx + 1;
    if (nx === 1 && ny === 1) return { nx, ny, columns, totals: levels };
    const totals = new Uint32Array(rows * columns * CHANNELS);
    const down = new Uint32Array(stride);
    const sums = new Int32Array(stride);
    for (let y = 0; y < rows; y++) {
      const first = (y - ny + 1) * columns * CHANNELS;
      for (let i = 0; i < stride; i++) {
        down[i]! += levels[y * stride + i]! - (y < ny ? 0 : levels[(y - ny) * stride + i]!);
        sums[i] = down[i]! + (i < CHANNELS ? 0 : sums[i - CHANNELS]!);
        // The box ending at this pixel starts nx pixels back; its total, once it is all read.
        const before = i - nx * CHANNELS;
        if (first >= 0 && before >= -CHANNELS) {
          totals[first + before + CHANNELS] = sums[i]! - (before < 0 ? 0 : sums[before]!);
        }
      }
    }
    return { nx, ny, columns, totals };
  });
  return { pixels, left, top, boxes };
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
 * Whether, in every channel, `to`'s total over the `b`th size of box around (x, y) lies within
 * what a move of under a pixel in `from` leaves, give or take rounding.
 */
function moved(from: Tile, to: Tile, b: number, x: number, y: number): boolean {
  const { nx, ny } = from.boxes[b]!;
  const { width, height } = from.pixels;
  const { slack, widen } = BOXES[b]!;
  channels: for (let c = 0; c < CHANNELS; c++) {
    for (const sx of width > 1 ? SIGNS : STILL) {
      const x0 = place(x, nx, width, sx);
      for (const sy of height > 1 ? SIGNS : STILL) {
        const y0 = place(y, ny, height, sy);
        if (x0 < 0 || y0 < 0) continue;
        const here = total(from, b, c, x0, y0);
        const across = total(from, b, c, x0 + sx, y0);
        const down = total(from, b, c, x0, y0 + sy);
        const both = total(from, b, c, x0 + sx, y0 + sy);
        const target = total(to, b, c, x0, y0);
        const lo = Math.min(here, across, down, both);
        const hi = Math.max(here, across, down, both);
        const allowed = slack * nx * ny + widen * (hi - lo);
        if (target >= lo - allowed && target <= hi + allowed) continue channels;
      }
    }
    return false;
  }
  return true;
}

/** Whether pixel (x, y) differs only because content moved by less than a pixel. */
export function isShifted(image: Pixels, other: Pixels, x: number, y: number): boolean {
  const before = tile(image, x, y);
  const after = tile(other, x, y);
  return BOXES.every(({ side }, b) =>
    side === 1
      ? moved(before, after, b, x, y) && moved(after, before, b, x, y)
      : moved(before, after, b, x, y) || moved(after, before, b, x, y),
  );
}
