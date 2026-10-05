import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deltaE2000 } from '../../src/color/ciede2000.js';
import type { Lab } from '../../src/color/types.js';

// Sharma, Wu and Dalal (2005), Table I: 34 pairs of CIELAB colours and their CIEDE2000
// difference, from hajim.rochester.edu/ece/sites/gsharma/ciede2000/.
function parse(line: string): [Lab, Lab, number] {
  const values = line.trim().split(/\s+/).map(Number);
  const at = (i: number): number => values[i] ?? Number.NaN;
  return [{ l: at(0), a: at(1), b: at(2) }, { l: at(3), a: at(4), b: at(5) }, at(6)];
}

const pairs = readFileSync(new URL('../fixtures/sharma-2005.tsv', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .map(parse);

describe('deltaE2000', () => {
  it('matches all 34 published test pairs to four decimal places', () => {
    expect(pairs).toHaveLength(34);
    for (const [x, y, expected] of pairs) expect(deltaE2000(x, y)).toBeCloseTo(expected, 4);
  });

  it('is symmetric, and zero between a colour and itself', () => {
    for (const [x, y] of pairs) {
      expect(deltaE2000(x, y)).toBeCloseTo(deltaE2000(y, x), 10);
      expect(deltaE2000(x, x)).toBe(0);
    }
  });

  it('weights a lightness difference by kL', () => {
    const x = { l: 50, a: 0, b: 0 };
    const y = { l: 60, a: 0, b: 0 };
    expect(deltaE2000(x, y, { kL: 2, kC: 1, kH: 1 })).toBeCloseTo(deltaE2000(x, y) / 2, 10);
  });
});
