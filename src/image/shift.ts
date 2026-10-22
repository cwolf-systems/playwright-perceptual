import { ROUNDING_LEVELS } from '../color/rgb.js';
import { CHANNELS, Sum, tileAt, windowAround, type Box, type Tile } from './tiles.js';
import type { Pixels } from './types.js';

// Content moved by less than a pixel is resampled between neighbours, so each image's colour at a
// pixel lies within the range of colours around the same place in the other image. A real change
// brings in colours that weren't there.
//
// That range is wide on textured ground, wide enough to hold a faint change of colour over the
// whole area, such as an overlay made a little more transparent. Two tests tell a move from such
// a change, over the 5×5 window around the pixel:
//
// - Noise and resampling keep the colour of an area: each channel's mean over the window changes
//   by at most a level and a half. A change of colour moves the mean by what it adds everywhere.
// - Where the mean did change, the change must be a move. The window is registered: the change is
//   fitted as the expected image's gradient times one offset, a single Lucas–Kanade step, and is a
//   move if an offset under 0.75 px explains at least 40% of it. Texture moved one way and back
//   averages to no change, so a change of colour over texture has no offset that explains it. A
//   ramp or an edge does have one: there a move and a change of colour look alike.
//
// An edge resampled differently, rather than moved, as a GPU and a software rasteriser draw a
// soft edge or a gradient's end, is neither: it changes the mean and fits no one offset. Such a
// pixel is, in both images, a mixture of the same two colours found on either side of it, and
// those kept their colour. A change of colour over an area changes the sides too.

/** Half the side of the neighbourhood searched: 1 for 3×3. */
const RADIUS = 1;

/** Channel levels allowed outside the neighbourhood's range, for rounding in the resampling. */
const SLACK = 3;

/**
 * Levels by which a channel's mean over the window may change: rounding, grain and a GPU's
 * filtering, which in the benchmark move it by up to 1.5 levels. A change of two levels counts.
 */
const DRIFT = 1.5;

/** The largest offset a registration may find, in pixels along each axis. */
const MAX_OFFSET = 0.75;

/** The share of the change, in squared levels, that the offset may leave unexplained. */
const UNEXPLAINED = 0.6;

/**
 * Damping of the fitted offset, as a share of the window's gradient energy. Along a straight edge
 * the offset is not determined; this keeps it to the part across the edge.
 */
const DAMPING = 0.1;

/**
 * Whether each channel of the pixel at `index` in plane `from` lies within the colours of plane
 * `among` around (x, y), give or take `SLACK`.
 */
function inNeighbourhood(tile: Tile, from: Uint8Array, among: Uint8Array, x: number, y: number) {
  const { planes } = tile;
  const own = planes.at(x, y);
  for (let c = 0; c < CHANNELS; c++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let ny = y - RADIUS; ny <= y + RADIUS; ny++) {
      for (let nx = x - RADIUS; nx <= x + RADIUS; nx++) {
        // Clamping repeats the border pixel, which leaves the range as clipping would.
        const v = among[planes.at(nx, ny) + c]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const value = from[own + c]!;
    if (value < lo - SLACK || value > hi + SLACK) return false;
  }
  return true;
}

/** Whether each channel's mean over the window changes by no more than `DRIFT`. */
function keepsColour(tile: Tile, window: Box): boolean {
  const allowed = DRIFT * (window.x1 - window.x0 + 1) * (window.y1 - window.y0 + 1);
  return [Sum.red, Sum.green, Sum.blue].every((c) => Math.abs(tile.sum(c, window)) <= allowed);
}

/**
 * Whether a move of `image` by under `MAX_OFFSET` explains the change to `other` over the window.
 * The change d is fitted, summed over the channels, as g·t for the gradient g of `image` and one
 * offset t: the normal equations M t = b, with M the sum of g gᵀ and b the sum of g d (Lucas and
 * Kanade, 1981). What the fit leaves is the sum of d² less 2 b·t plus tᵀ M t.
 */
function explainedByMove(tile: Tile, window: Box): boolean {
  const gxx = tile.sum(Sum.gxx, window);
  const gxy = tile.sum(Sum.gxy, window);
  const gyy = tile.sum(Sum.gyy, window);
  const bx = tile.sum(Sum.gxd, window);
  const by = tile.sum(Sum.gyd, window);
  const change = tile.sum(Sum.dd, window);
  const damping = DAMPING * (gxx + gyy);
  const mxx = gxx + damping;
  const myy = gyy + damping;
  const det = mxx * myy - gxy * gxy;
  // A flat window has no gradient to move: nothing there is a move.
  if (!(det > 0)) return false;
  const tx = (myy * bx - gxy * by) / det;
  const ty = (mxx * by - gxy * bx) / det;
  if (Math.abs(tx) > MAX_OFFSET || Math.abs(ty) > MAX_OFFSET) return false;
  const left = change - 2 * (bx * tx + by * ty) + gxx * tx * tx + 2 * gxy * tx * ty + gyy * ty * ty;
  return left <= UNEXPLAINED * change;
}

/** Levels per channel a colour may lie off the line between the two colours it mixes. */
const MIX_SLACK = 2;

/**
 * Whether the colour at `at` in `plane` is a mixture of the colours at `from` and `to` in `ends`,
 * give or take `MIX_SLACK` in each channel: whether it lies near the line between them in RGB.
 */
function mixes(plane: Uint8Array, at: number, ends: Uint8Array, from: number, to: number): boolean {
  let along = 0;
  let length = 0;
  for (let c = 0; c < CHANNELS; c++) {
    const span = ends[to + c]! - ends[from + c]!;
    along += (plane[at + c]! - ends[from + c]!) * span;
    length += span * span;
  }
  // The nearest point of the line, as a share of the way from one end to the other.
  const share = length > 0 ? Math.min(1, Math.max(0, along / length)) : 0;
  for (let c = 0; c < CHANNELS; c++) {
    const nearest = ends[from + c]! + share * (ends[to + c]! - ends[from + c]!);
    if (Math.abs(plane[at + c]! - nearest) > MIX_SLACK) return false;
  }
  return true;
}

/** Whether no channel at `at` differs between the planes by more than rounding. */
function kept(before: Uint8Array, after: Uint8Array, at: number): boolean {
  for (let c = 0; c < CHANNELS; c++) {
    if (Math.abs(before[at + c]! - after[at + c]!) > ROUNDING_LEVELS) return false;
  }
  return true;
}

/**
 * Whether the pixel is, in both images, a mixture of the same two colours on opposite sides of it
 * in the window, each of which kept its colour, give or take rounding.
 */
function remixed(tile: Tile, window: Box, x: number, y: number): boolean {
  // The pixel itself changed: two pixels around it must have kept their colour.
  if (tile.sum(Sum.kept, window) < 2) return false;
  const { planes } = tile;
  const { image: before, other: after } = planes;
  const sides: { dx: number; dy: number; at: number }[] = [];
  for (let ny = window.y0; ny <= window.y1; ny++) {
    for (let nx = window.x0; nx <= window.x1; nx++) {
      const at = planes.at(nx, ny);
      if (kept(before, after, at)) sides.push({ dx: nx - x, dy: ny - y, at });
    }
  }
  const at = planes.at(x, y);
  for (let i = 0; i < sides.length; i++) {
    for (let j = i + 1; j < sides.length; j++) {
      const a = sides[i]!;
      const b = sides[j]!;
      // Opposite sides: the two directions from the pixel point more apart than together.
      if (a.dx * b.dx + a.dy * b.dy >= 0) continue;
      if (mixes(before, at, before, a.at, b.at) && mixes(after, at, before, a.at, b.at)) {
        return true;
      }
    }
  }
  return false;
}

/** Whether pixel (x, y) differs only because content moved by less than a pixel. */
export function isShifted(image: Pixels, other: Pixels, x: number, y: number): boolean {
  const { tile } = tileAt(image, other, x, y);
  const { image: before, other: after } = tile.planes;
  const window = windowAround(image, x, y);
  return (
    (inNeighbourhood(tile, after, before, x, y) &&
      inNeighbourhood(tile, before, after, x, y) &&
      (keepsColour(tile, window) || explainedByMove(tile, window))) ||
    remixed(tile, window, x, y)
  );
}
