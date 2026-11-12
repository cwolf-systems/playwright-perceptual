import type { SyntheticPair } from './synthetic.d.mts';

export interface CasePair {
  readonly name: string;
  readonly category: string;
  readonly make: () => SyntheticPair;
}

export const MIN_CHANGED: number;
export const MIN_DELTA_E: number;
export const CASE_PAIRS: readonly CasePair[];
