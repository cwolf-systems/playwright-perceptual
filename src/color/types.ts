/** A colour in CIELAB (CIE 1976), relative to the D65 white point. */
export interface Lab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

/** Perceived difference between two colours, roughly 1.0 at the threshold of notice. */
export type ColorDifference = (expected: Lab, actual: Lab) => number;
