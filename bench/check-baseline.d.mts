export interface BaselinePair {
  readonly id: string;
  readonly set: string;
  readonly match: boolean;
  readonly pass: { readonly none: boolean; readonly allowance: boolean };
  readonly counted?: number | null;
  readonly sha256?: readonly string[];
}

export interface Machine {
  readonly platform: string;
  readonly cpu: string;
  readonly image?: string | null;
}

export interface Result {
  readonly machine: Machine;
  readonly accuracy: { readonly pairs: readonly BaselinePair[] };
}

export interface Lost {
  readonly id: string;
  readonly tolerance: string;
  readonly match: boolean;
  readonly counted: number | null | undefined;
}

export interface Check {
  readonly lost: readonly Lost[];
  readonly gained: readonly Lost[];
  readonly missing: readonly string[];
  readonly skippedReal: number;
  readonly skippedRendered: number;
  readonly notRendered: number;
  readonly compared: number;
  readonly hashed: number;
  readonly moved: readonly string[];
}

export function isRendered(id: string): boolean;
export function sameMachine(result: Result, baseline: Result): boolean;
export function check(
  result: Result,
  baseline: Result,
  compareRendered: boolean,
  sameMachine: boolean,
): Check;
export function failing(
  r: Check,
  enforceRendered: boolean,
): { lost: readonly Lost[]; missing: readonly string[] };
