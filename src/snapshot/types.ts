/** How many changed pixels still count as a match. */
export interface Tolerance {
  readonly maxDiffPixels?: number;
  /** As a share of all pixels. */
  readonly maxDiffPixelRatio?: number;
}

/** Playwright's `updateSnapshots` modes. */
export type UpdateMode = 'all' | 'changed' | 'missing' | 'none';
