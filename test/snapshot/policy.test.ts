import { describe, expect, it } from 'vitest';
import { decide, type Situation, updateModeOf } from '../../src/snapshot/policy.js';
import type { UpdateMode } from '../../src/snapshot/types.js';

const MODES: UpdateMode[] = ['none', 'default', 'missing', 'changed', 'all'];

// What toHaveScreenshot does (Playwright 1.64, packages/playwright/src/matchers/toMatchSnapshot.ts).
describe('update policy', () => {
  it('writes a missing baseline unless updates are off, failing only in the default mode', () => {
    expect(
      MODES.map((m) => [decide('missing', m).pass, decide('missing', m).writeBaseline]),
    ).toEqual([
      [false, false],
      [false, true],
      [true, true],
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
      expect(MODES.map((m) => decide(situation, m).pass)).toEqual([
        false,
        false,
        false,
        true,
        true,
      ]);
      expect(MODES.map((m) => decide(situation, m).writeBaseline)).toEqual([
        false,
        false,
        false,
        true,
        true,
      ]);
    },
  );

  it('attaches the expected, actual and diff images when a comparison fails', () => {
    expect(decide('different', 'default').record).toEqual(['expected', 'actual', 'diff']);
    expect(decide('resized', 'default').record).toEqual(['expected', 'actual']);
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

describe('update modes across Playwright releases', () => {
  it("reads 'missing' before 1.64 as the mode that writes a baseline and fails", () => {
    expect(updateModeOf('missing', '1.53.0')).toBe('default');
    expect(updateModeOf('missing', '1.63.9')).toBe('default');
    expect(updateModeOf('missing', '0.9.0')).toBe('default');
  });

  it("keeps 'missing' from 1.64, where it writes a baseline and passes", () => {
    expect(updateModeOf('missing', '1.64.0')).toBe('missing');
    expect(updateModeOf('missing', '1.65.0-alpha-2026-11-01')).toBe('missing');
    expect(updateModeOf('missing', '2.0.0')).toBe('missing');
    expect(updateModeOf('missing', 'unknown')).toBe('missing');
  });

  it.each(['none', 'default', 'changed', 'all'] as UpdateMode[])(
    'leaves %s alone in every release',
    (mode) => {
      expect(updateModeOf(mode, '1.53.0')).toBe(mode);
      expect(updateModeOf(mode, '1.64.1')).toBe(mode);
    },
  );
});
