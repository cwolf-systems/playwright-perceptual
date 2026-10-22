import { channelLuma, ROUNDING_LEVELS, withinLevels } from '../color/rgb.js';
import { CHANNELS, Sum, tileAt } from './tiles.js';
import type { Pixels } from './types.js';
import { contains, NEIGHBOURS, onEdge } from './raster.js';

// Anti-aliasing detection after Vyšniauskas (2009), "Anti-aliased Pixel and Intensity Slope
// Detector": a pixel on a slope between a darker and a brighter neighbour, one of which sits in a
// flat area in both images. Rasterisers place such edge pixels differently.
//
// That flat neighbour must also keep its colour, give or take rounding. Placing an edge
// differently changes the slope, not the flat area beside it; a change of colour over a whole
// area, such as an overlay made more transparent, changes both.

/** Neighbours of the same colour beyond which an area counts as flat. */
const FLAT_NEIGHBOURS = 2;

/** An edge pixel counts one of its missing neighbours as the same colour. */
const edgeAllowance = (pixels: Pixels, x: number, y: number): number =>
  onEdge(pixels, x, y) ? 1 : 0;

function inFlatArea(pixels: Pixels, x: number, y: number): boolean {
  const own = pixels.rgbAt(x, y);
  let same = edgeAllowance(pixels, x, y);
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = x + dx;
    const ny = y + dy;
    if (contains(pixels, nx, ny) && pixels.rgbAt(nx, ny) === own && ++same > FLAT_NEIGHBOURS) {
      return true;
    }
  }
  return false;
}

/** Whether pixel (x, y) of `image` looks like anti-aliasing, judged against `other`. */
export function isAntialiased(image: Pixels, other: Pixels, x: number, y: number): boolean {
  // Either image's tile will do: they hold the same pixels.
  const { tile, swapped } = tileAt(image, other, x, y, true);
  // The flat neighbour must have kept its colour. Most changed pixels have no such neighbour,
  // and are turned away here with four lookups.
  const neighbours = {
    x0: Math.max(0, x - 1),
    y0: Math.max(0, y - 1),
    x1: Math.min(image.width - 1, x + 1),
    y1: Math.min(image.height - 1, y + 1),
  };
  if (tile.sum(Sum.kept, neighbours) === 0) return false;
  const { planes } = tile;
  const plane = swapped ? planes.other : planes.image;
  const at = planes.at(x, y);
  const own = channelLuma(plane[at]!, plane[at + 1]!, plane[at + 2]!);
  let same = edgeAllowance(image, x, y);
  let darkest = 0;
  let brightest = 0;
  let darkX = 0;
  let darkY = 0;
  let brightX = 0;
  let brightY = 0;

  for (let n = 0; n < NEIGHBOURS.length; n++) {
    const [dx, dy] = NEIGHBOURS[n]!;
    const nx = x + dx;
    const ny = y + dy;
    if (!contains(image, nx, ny)) continue;
    const i = at + dy * planes.rowStride + dx * CHANNELS;
    const delta = channelLuma(plane[i]!, plane[i + 1]!, plane[i + 2]!) - own;
    if (delta === 0) {
      if (++same > FLAT_NEIGHBOURS) return false;
    } else if (delta < darkest) {
      darkest = delta;
      darkX = nx;
      darkY = ny;
    } else if (delta > brightest) {
      brightest = delta;
      brightX = nx;
      brightY = ny;
    }
  }
  if (darkest === 0 || brightest === 0) return false;

  // Whether the neighbour kept its colour is checked first: it is the cheapest test.
  const flatInBoth = (nx: number, ny: number) =>
    withinLevels(image.rgbAt(nx, ny), other.rgbAt(nx, ny), ROUNDING_LEVELS) &&
    inFlatArea(image, nx, ny) &&
    inFlatArea(other, nx, ny);
  return flatInBoth(darkX, darkY) || flatInBoth(brightX, brightY);
}
