import { luma, ROUNDING_LEVELS, withinLevels } from '../color/rgb.js';
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
  const own = luma(image.rgbAt(x, y));
  let same = edgeAllowance(image, x, y);
  let darkest = 0;
  let brightest = 0;
  let darkX = 0;
  let darkY = 0;
  let brightX = 0;
  let brightY = 0;

  for (const [dx, dy] of NEIGHBOURS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!contains(image, nx, ny)) continue;
    const delta = luma(image.rgbAt(nx, ny)) - own;
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

/**
 * `isAntialiased` asked both ways round. Either way needs a neighbour that kept its colour, so
 * where none did, as across most of a real change, it is settled after one pass.
 */
export function isAntialiasedEitherWay(
  image: Pixels,
  other: Pixels,
  x: number,
  y: number,
): boolean {
  const kept = NEIGHBOURS.some(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    return (
      contains(image, nx, ny) &&
      withinLevels(image.rgbAt(nx, ny), other.rgbAt(nx, ny), ROUNDING_LEVELS)
    );
  });
  return kept && (isAntialiased(image, other, x, y) || isAntialiased(other, image, x, y));
}
