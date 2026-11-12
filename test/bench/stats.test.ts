import { describe, expect, it } from 'vitest';
import { rateCell, wilson } from '../../bench/stats.mjs';

// The benchmark's 95% intervals (bench/stats.mjs), against the values R. G. Newcombe (1998)
// publishes for the score method without continuity correction (method 3), to four places.

describe('wilson', () => {
  it.each([
    [81, 263, 0.2553, 0.3662],
    [15, 148, 0.0624, 0.1605],
    [0, 20, 0, 0.1611],
    [1, 29, 0.0061, 0.1718],
  ])('gives Newcombe’s interval for %i of %i', (k, n, low, high) => {
    const interval = wilson(k, n);
    expect(interval?.low).toBeCloseTo(low, 4);
    expect(interval?.high).toBeCloseTo(high, 4);
  });

  it('bounds none of n by z² / (n + z²), and all of n by its mirror', () => {
    const z2 = 1.959963984540054 ** 2;
    for (const n of [1, 9, 24, 107]) {
      expect(wilson(0, n)).toEqual({ low: 0, high: expect.closeTo(z2 / (n + z2), 12) as number });
      expect(wilson(n, n)).toEqual({ low: expect.closeTo(n / (n + z2), 12) as number, high: 1 });
    }
  });

  it('is symmetric: k of n mirrors n − k of n', () => {
    for (let k = 0; k <= 15; k++) {
      const a = wilson(k, 15)!;
      const b = wilson(15 - k, 15)!;
      expect(a.low).toBeCloseTo(1 - b.high, 12);
      expect(a.high).toBeCloseTo(1 - b.low, 12);
    }
  });

  it('has no interval without trials', () => {
    expect(wilson(0, 0)).toBeNull();
  });

  it('refuses counts that are not a proportion', () => {
    expect(() => wilson(-1, 5)).toThrow(RangeError);
    expect(() => wilson(6, 5)).toThrow(RangeError);
    expect(() => wilson(1.5, 5)).toThrow(RangeError);
    expect(() => wilson(0, -1)).toThrow(RangeError);
  });
});

describe('rateCell', () => {
  it('prints the count, its rate and its interval in whole percent', () => {
    expect(rateCell(9, 15)).toBe('9 (60%, 36–80%)');
    expect(rateCell(0, 24)).toBe('0 (0%, 0–14%)');
  });

  it('prints the count alone without trials', () => {
    expect(rateCell(0, 0)).toBe('0');
  });
});
