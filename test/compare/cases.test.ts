import { describe, expect, it } from 'vitest';
import { CASE_PAIRS, MIN_CHANGED, MIN_DELTA_E } from '../../bench/cases.mjs';
import { compareImages } from '../../src/compare/comparator.js';

// Should-fail cases drawn from scratch (bench/cases.mjs), which the accuracy benchmark also reports.
// First, that each is the change it is labelled as: big enough and visible, with every noise class
// counted. Then, that the comparator fails it at its defaults with 0.1% of the image allowed.

const STRICT = { ignoreAntialiasing: false, ignoreShifts: false, ignoreRounding: false } as const;

describe.each(CASE_PAIRS.map((p) => [p.name, p] as const))('%s', (_name, pair) => {
  const { expected, actual } = pair.make();

  it(`changes at least ${MIN_CHANGED} pixels, some by ΔE00 ${MIN_DELTA_E} or more`, () => {
    const strict = compareImages(expected, actual, STRICT);
    expect(strict.differing).toBeGreaterThanOrEqual(MIN_CHANGED);
    expect(strict.deltaE.max).toBeGreaterThanOrEqual(MIN_DELTA_E);
  });

  it('fails at the defaults with 0.1% of the image allowed', () => {
    const allowed = Math.floor(0.001 * expected.width * expected.height);
    expect(compareImages(expected, actual).differing).toBeGreaterThan(allowed);
  });
});
