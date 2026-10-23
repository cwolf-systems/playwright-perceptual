import type { Comparison } from '../compare/types.js';

const percent = (part: number, whole: number): string => `${((part / whole) * 100).toFixed(2)}%`;

/** How a comparison came out, for failure messages. */
export function describeComparison(comparison: Comparison): string {
  const { width, height, differing, exceeded, notes } = comparison;
  // Counting stops at the first pixel past the allowance: more pixels changed than the allowance.
  const counted = exceeded ? differing - 1 : differing;
  const share = percent(counted, width * height);
  const count = exceeded
    ? `More than ${counted} pixels (over ${share} of the image) changed; counting stopped there.`
    : `${counted} pixels (${share} of the image) changed.`;
  return [count, ...notes].join('\n');
}

export const describeSize = (
  expected: { width: number; height: number },
  actual: { width: number; height: number },
): string =>
  `Expected an image ${expected.width}×${expected.height}, got ${actual.width}×${actual.height}.`;
