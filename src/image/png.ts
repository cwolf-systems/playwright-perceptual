import { PNG } from 'pngjs';
import { PngDecodeError } from '../errors.js';
import type { RgbaImage } from './types.js';

/** Decodes PNG bytes. `source` names them in the error if they can't be read. */
export function decodePng(bytes: Buffer, source = 'image'): RgbaImage {
  try {
    const png = PNG.sync.read(bytes);
    return { data: png.data, width: png.width, height: png.height };
  } catch (cause) {
    throw new PngDecodeError(source, { cause });
  }
}

export function encodePng(image: RgbaImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  return PNG.sync.write(png);
}
