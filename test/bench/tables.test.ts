import { describe, expect, it } from 'vitest';
import { accuracyTable, section, type JudgedPair, type JudgeResult } from '../../bench/tables.mjs';

// The per-platform tables (bench/tables.mjs), from a judge result built by hand.

const judged = (id: string, set: string, match: boolean, none: boolean, allowance: boolean) =>
  ({ id, set, match, pass: { none, allowance } }) satisfies JudgedPair;

const result = (image: string | null): JudgeResult => ({
  candidate: { name: 'ci', commit: '0123456789abcdef' },
  machine: { platform: 'linux', cpu: 'AMD EPYC 7763', node: 'v22.22.2', image },
  accuracy: {
    pairs: [
      judged('rendered/colour/chromium/map', 'design', true, false, true),
      judged('rendered/colour/firefox/map', 'design', true, true, true),
      judged('rendered/regression/chromium/map', 'design', false, false, true),
      judged('synthetic/cases/grid line removed', 'synthetic', false, false, false),
    ],
  },
});

describe('accuracyTable', () => {
  it('counts wrong verdicts by set and expected verdict, at both tolerances', () => {
    const rows = accuracyTable(result(null)).split('\n');
    expect(rows).toHaveLength(4);
    expect(rows[2]).toBe(
      '| design | 3 | 1 (50%, 9–91%) | 0 (0%, 0–79%) | 0 (0%, 0–66%) | 1 (100%, 21–100%) |',
    );
    expect(rows[3]).toBe('| synthetic | 1 | 0 | 0 (0%, 0–79%) | 0 | 0 (0%, 0–79%) |');
  });
});

describe('section', () => {
  it('names the runner image in CI, and the CPU elsewhere', () => {
    expect(section(result('ubuntu24 20261117.1'))).toContain(
      '### Linux, runner image ubuntu24 20261117.1 (AMD EPYC 7763)',
    );
    expect(section(result(null))).toContain('### Linux (AMD EPYC 7763)');
  });

  it('counts the rendered pairs', () => {
    expect(section(result(null))).toContain('ci at 0123456, Node v22.22.2; 3 rendered pairs.');
  });
});

describe('the self-noise set', () => {
  // Every pair of one page's renders: the rate is over pages, and a page is wrong if any pair is.
  const noise = (i: number, j: number, none: boolean) =>
    judged(`self-noise 1×/webkit/map/${i}v${j}`, 'self-noise', true, none, true);
  const withNoise: JudgeResult = {
    ...result(null),
    accuracy: { pairs: [noise(0, 1, false), noise(0, 2, false), noise(1, 2, true)] },
  };

  it('counts pages, not pairs', () => {
    const rows = accuracyTable(withNoise).split('\n');
    expect(rows[2]).toBe('| self-noise | 3 | 1 (100%, 21–100%) | 0 | 0 (0%, 0–79%) | 0 |');
  });

  it('says how many pages its pairs come from', () => {
    expect(section(withNoise)).toContain('0 rendered pairs, and 3 self-noise pairs of 1 page.');
  });
});
