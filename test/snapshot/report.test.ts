import { describe, expect, it } from 'vitest';
import { describeComparison, describeSize } from '../../src/snapshot/report.js';

describe('report', () => {
  it("gives the share of changed pixels, then the comparator's notes", () => {
    const comparison = { width: 10, height: 10, differing: 5, notes: ['ΔE00 above 1.'] };
    expect(describeComparison(comparison)).toBe(
      '5 pixels (5.00% of the image) changed.\nΔE00 above 1.',
    );
  });

  it('describes a change of size', () => {
    expect(describeSize({ width: 6, height: 4 }, { width: 4, height: 4 })).toBe(
      'Expected an image 6×4, got 4×4.',
    );
  });
});
