import { luma } from '../color/rgb.js';
import type { Pixels } from './types.js';
import { contains, NEIGHBOURS, onEdge } from './raster.js';

// Anti-aliasing detection after Vyšniauskas (2009), "Anti-aliased Pixel and Intensity Slope
// Detector": a pixel on a slope between a darker and a brighter neighbour, one of which sits in a
// flat area in both images. Rasterisers place such edge pixels differently.

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

  const flatInBoth = (nx: number, ny: number) =>
    inFlatArea(image, nx, ny) && inFlatArea(other, nx, ny);
  return flatInBoth(darkX, darkY) || flatInBoth(brightX, brightY);
}
