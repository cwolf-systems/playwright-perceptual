import type { UpdateMode } from './types.js';
import type { Artifact } from './store.js';

// What to do with a screenshot in each update mode, as `toHaveScreenshot` behaves. Kept as data
// so the whole policy can be read, and tested, in one place.

/** What the stable screenshot turned out to be, relative to the baseline. */
export type Situation = 'missing' | 'matching' | 'different' | 'resized' | 'unstable';

export interface Decision {
  readonly pass: boolean;
  readonly writeBaseline: boolean;
  readonly record: readonly Artifact[];
}

const PASS: Decision = { pass: true, writeBaseline: false, record: [] };
const UPDATE: Decision = { pass: true, writeBaseline: true, record: [] };
const fail = (...record: Artifact[]): Decision => ({ pass: false, writeBaseline: false, record });

const COMPARED: readonly Artifact[] = ['expected', 'actual', 'diff'];

const POLICY: Readonly<Record<Situation, Readonly<Record<UpdateMode, Decision>>>> = {
  missing: {
    none: fail(),
    // Written so the next run has a baseline, but still a failure: nothing was checked.
    missing: { pass: false, writeBaseline: true, record: ['expected', 'actual'] },
    changed: { pass: true, writeBaseline: true, record: ['expected', 'actual'] },
    all: { pass: true, writeBaseline: true, record: ['expected', 'actual'] },
  },
  matching: { none: PASS, missing: PASS, changed: PASS, all: UPDATE },
  different: { none: fail(...COMPARED), missing: fail(...COMPARED), changed: UPDATE, all: UPDATE },
  resized: {
    none: fail('expected', 'actual'),
    missing: fail('expected', 'actual'),
    changed: UPDATE,
    all: UPDATE,
  },
  unstable: {
    none: fail('actual', 'diff'),
    missing: fail('actual', 'diff'),
    changed: fail('actual', 'diff'),
    all: fail('actual', 'diff'),
  },
};

export const decide = (situation: Situation, mode: UpdateMode): Decision => POLICY[situation][mode];
