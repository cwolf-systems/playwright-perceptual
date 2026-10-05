import { describe, expect, it } from 'vitest';
import { isAntialiased } from '../../src/image/antialiasing.js';
import { contains, onEdge, Raster } from '../../src/image/raster.js';
import type { RgbaImage } from '../../src/image/types.js';
import { setPixel, solid } from '../helpers.js';

/** A vertical black/white edge whose one grey transition column sits at `greyAt`. */
function edge(greyAt: number): RgbaImage {
  const image = solid(9, 9, [255, 255, 255, 255]);
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x <= greyAt; x++) {
      const v = x < greyAt ? 0 : 128;
      setPixel(image, x, y, [v, v, v, 255]);
    }
  }
  return image;
}

describe('isAntialiased', () => {
  it('recognises a transition pixel between flat dark and flat bright areas', () => {
    const image = new Raster(edge(4));
    expect(isAntialiased(image, new Raster(edge(5)), 4, 4)).toBe(true);
  });

  it('rejects a pixel inside a flat area', () => {
    const image = new Raster(edge(4));
    expect(isAntialiased(image, image, 1, 4)).toBe(false);
  });

  it('rejects a lone speck, which has no slope across it', () => {
    const image = solid(5, 5, [255, 255, 255, 255]);
    setPixel(image, 2, 2, [0, 0, 0, 255]);
    const raster = new Raster(image);
    expect(isAntialiased(raster, raster, 2, 2)).toBe(false);
  });

  it('rejects a pixel with only darker neighbours', () => {
    const image = solid(3, 3, [0, 0, 0, 255]);
    setPixel(image, 1, 1, [200, 200, 200, 255]);
    const raster = new Raster(image);
    expect(isAntialiased(raster, raster, 1, 1)).toBe(false);
  });
});

describe('Raster', () => {
  it('knows which coordinates are inside it and on its edge', () => {
    const raster = new Raster(solid(3, 3, [0, 0, 0, 255]));
    expect([contains(raster, 0, 0), contains(raster, 3, 0), contains(raster, -1, 1)]).toEqual([
      true,
      false,
      false,
    ]);
    expect([onEdge(raster, 0, 1), onEdge(raster, 1, 1)]).toEqual([true, false]);
  });
});
