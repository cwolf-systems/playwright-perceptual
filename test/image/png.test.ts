import { describe, expect, it } from 'vitest';
import { PngDecodeError } from '../../src/errors.js';
import { decodePng, encodePng } from '../../src/image/png.js';
import { solid } from '../helpers.js';

describe('png', () => {
  it('round-trips pixels', () => {
    const image = solid(3, 2, [10, 20, 30, 255]);
    const back = decodePng(encodePng(image));
    expect([back.width, back.height]).toEqual([3, 2]);
    expect(Array.from(back.data)).toEqual(Array.from(image.data));
  });

  it('names the source of bytes it cannot read', () => {
    expect(() => decodePng(Buffer.from('not a png'), 'baseline.png')).toThrow(PngDecodeError);
    expect(() => decodePng(Buffer.from('not a png'), 'baseline.png')).toThrow(/baseline\.png/);
  });
});
