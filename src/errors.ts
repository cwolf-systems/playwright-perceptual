/** Base class for errors this package throws. A failed comparison is an assertion result, not an error. */
export class PerceptualError extends Error {
  override name = 'PerceptualError';
}

/** An option outside its allowed range. */
export class InvalidOptionError extends PerceptualError {
  override name = 'InvalidOptionError';

  constructor(
    readonly option: string,
    readonly value: unknown,
    expected: string,
  ) {
    super(`${option} must be ${expected}, got ${String(value)}`);
  }
}

/** Two images that can't be compared pixel by pixel. */
export class ImageSizeError extends PerceptualError {
  override name = 'ImageSizeError';

  constructor(
    readonly expected: { readonly width: number; readonly height: number },
    readonly actual: { readonly width: number; readonly height: number },
  ) {
    super(
      `Images differ in size: expected ${expected.width}×${expected.height}, actual ${actual.width}×${actual.height}`,
    );
  }
}

/** Bytes that aren't a readable PNG. */
export class PngDecodeError extends PerceptualError {
  override name = 'PngDecodeError';

  constructor(source: string, options: { cause: unknown }) {
    super(`Could not read ${source} as a PNG`, options);
  }
}
