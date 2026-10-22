/** How many changed pixels still count as a match. */
export interface Tolerance {
  readonly maxDiffPixels?: number;
  /** As a share of all pixels. */
  readonly maxDiffPixelRatio?: number;
}

/**
 * Playwright's `updateSnapshots` modes, with the meanings Playwright 1.64 gives them:
 * - `'default'`: a missing baseline is written, and the test fails.
 * - `'missing'`: a missing baseline is written, and the test passes.
 * - `'changed'`: missing baselines and baselines that differ are written; the test passes.
 * - `'all'`: every baseline is rewritten; the test passes.
 * - `'none'`: nothing is written.
 *
 * Before 1.64, Playwright's `'missing'` meant what `'default'` means now; the matcher translates it.
 */
export type UpdateMode = 'all' | 'changed' | 'missing' | 'none' | 'default';
