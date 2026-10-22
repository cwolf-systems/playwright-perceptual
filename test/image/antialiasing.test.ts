import { describe, expect, it } from 'vitest';
import { isAntialiased } from '../../src/image/antialiasing.js';
import { onEdge, Raster } from '../../src/image/raster.js';
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

  it('rejects a slope whose flat sides changed colour, as a uniform change leaves it', () => {
    /** Flat 40 to the left of column 4, 128 on it, flat 210 to the right, all `levels` lighter. */
    const softEdge = (levels: number) => {
      const image = solid(9, 9, [210 + levels, 210 + levels, 210 + levels, 255]);
      for (let y = 0; y < 9; y++) {
        for (let x = 0; x <= 4; x++) {
          const v = (x < 4 ? 40 : 128) + levels;
          setPixel(image, x, y, [v, v, v, 255]);
        }
      }
      return new Raster(image);
    };
    expect(isAntialiased(softEdge(0), softEdge(1), 4, 4)).toBe(true);
    expect(isAntialiased(softEdge(0), softEdge(3), 4, 4)).toBe(false);
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
  it('knows which pixels are on its edge', () => {
    const raster = new Raster(solid(3, 3, [0, 0, 0, 255]));
    expect([onEdge(raster, 0, 1), onEdge(raster, 1, 1)]).toEqual([true, false]);
  });

  it('reads colours a row at a time, blended over white, the same as by index', () => {
    const image = solid(3, 2, [10, 20, 30, 255]);
    setPixel(image, 2, 1, [0, 0, 0, 0]);
    const raster = new Raster(image);
    expect(raster.rgbAt(2, 1)).toBe(0xffffff);
    expect(raster.rgbAt(0, 0)).toBe(raster.rgb(0));
    expect(raster.rgbAt(1, 1)).toBe(0x0a141e);
  });
});
