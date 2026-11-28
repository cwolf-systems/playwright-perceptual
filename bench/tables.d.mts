export interface JudgedPair {
  readonly id: string;
  readonly set: string;
  readonly match: boolean;
  readonly pass: { readonly none: boolean; readonly allowance: boolean };
}

export interface JudgeResult {
  readonly candidate: { readonly name: string; readonly commit: string | null };
  readonly machine: {
    readonly platform: string;
    readonly cpu: string;
    readonly node: string;
    readonly image?: string | null;
  };
  readonly accuracy: { readonly pairs: readonly JudgedPair[] };
}

export function accuracyTable(result: JudgeResult): string;
export function section(result: JudgeResult): string;
