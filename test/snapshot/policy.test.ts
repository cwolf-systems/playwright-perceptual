import { describe, expect, it } from 'vitest';
import { decide, type Situation } from '../../src/snapshot/policy.js';
import type { UpdateMode } from '../../src/snapshot/types.js';

const MODES: UpdateMode[] = ['none', 'missing', 'changed', 'all'];

// What toHaveScreenshot does (Playwright 1.60, packages/playwright/src/matchers/toMatchSnapshot.ts).
describe('update policy', () => {
  it('writes a missing baseline unless updates are off, passing only when updating', () => {
    expect(
      MODES.map((m) => [decide('missing', m).pass, decide('missing', m).writeBaseline]),
    ).toEqual([
      [false, false],
      [false, true],
      [true, true],
      [true, true],
    ]);
  });

  it('passes a match in every mode, rewriting it only when updating everything', () => {
    for (const mode of MODES) expect(decide('matching', mode).pass).toBe(true);
    expect(MODES.filter((m) => decide('matching', m).writeBaseline)).toEqual(['all']);
  });

  it.each(['different', 'resized'] as Situation[])(
    'fails a %s screenshot unless updating, which rewrites the baseline',
    (situation) => {
      expect(MODES.map((m) => decide(situation, m).pass)).toEqual([false, false, true, true]);
      expect(MODES.map((m) => decide(situation, m).writeBaseline)).toEqual([
        false,
        false,
        true,
        true,
      ]);
    },
  );

  it('attaches the expected, actual and diff images when a comparison fails', () => {
    expect(decide('different', 'missing').record).toEqual(['expected', 'actual', 'diff']);
    expect(decide('resized', 'missing').record).toEqual(['expected', 'actual']);
  });

  it('always fails an unstable screenshot, without touching the baseline', () => {
    for (const mode of MODES) {
      expect(decide('unstable', mode)).toEqual({
        pass: false,
        writeBaseline: false,
        record: ['actual', 'diff'],
      });
    }
  });
});
