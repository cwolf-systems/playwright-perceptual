export interface Interval {
  readonly low: number;
  readonly high: number;
}

export function wilson(successes: number, trials: number, z?: number): Interval | null;
export function rateCell(successes: number, trials: number): string;
