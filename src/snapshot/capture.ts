import { decodePng } from '../image/png.js';
import type { Comparison } from '../compare/types.js';
import type { RgbaImage } from '../image/types.js';

/** Produces screenshots, and how long to wait for them to stop changing. */
export interface ScreenshotSource {
  /** Takes a screenshot within `timeoutMs`, which is Infinity for no limit. */
  capture(timeoutMs: number): Promise<Buffer>;
  /** Infinity waits as long as it takes. */
  readonly timeoutMs: number;
}

export interface Shot {
  readonly png: Buffer;
  readonly image: RgbaImage;
}

/** How one image compares with another under the active tolerance. */
export type Judgement =
  | { readonly kind: 'resized' }
  | { readonly kind: 'compared'; readonly comparison: Comparison; readonly agrees: boolean };

export type Judge = (expected: RgbaImage, actual: RgbaImage) => Judgement;

export type Capture =
  /** The first screenshot already matched the baseline. */
  | { readonly kind: 'matched'; readonly shot: Shot; readonly attempts: number }
  /** Two consecutive screenshots agreed. */
  | { readonly kind: 'stable'; readonly shot: Shot; readonly attempts: number }
  /** Screenshots kept changing until the timeout. */
  | {
      readonly kind: 'unstable';
      readonly shot: Shot;
      readonly previous: Shot;
      readonly last: Judgement;
      readonly attempts: number;
    };

export type Wait = (ms: number) => Promise<void>;

/** Pauses after each capture, as Playwright's own loop makes; the last one repeats. */
const PAUSES_MS = [0, 100, 250, 500, 1000] as const;

const pauseAfter = (attempt: number): number => PAUSES_MS[Math.min(attempt, PAUSES_MS.length) - 1]!;

const sleep: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const agrees = (judgement: Judgement): boolean => judgement.kind === 'compared' && judgement.agrees;

/**
 * Captures until two consecutive screenshots agree, mirroring `toHaveScreenshot`: the first
 * capture is accepted at once if it already matches the baseline, which skips the second capture
 * on the common, passing path.
 */
export async function captureStable(
  source: ScreenshotSource,
  judge: Judge,
  baseline: RgbaImage | null,
  wait: Wait = sleep,
): Promise<Capture> {
  const deadline = Date.now() + source.timeoutMs;
  const remaining = (): number => Math.max(0, deadline - Date.now());
  let previous: Shot | null = null;
  for (let attempts = 1; ; attempts++) {
    const png = await source.capture(remaining());
    const shot: Shot = { png, image: decodePng(png, 'screenshot') };
    if (previous === null) {
      if (baseline !== null && agrees(judge(baseline, shot.image))) {
        return { kind: 'matched', shot, attempts };
      }
    } else {
      const last = judge(previous.image, shot.image);
      if (agrees(last)) return { kind: 'stable', shot, attempts };
      if (remaining() === 0) return { kind: 'unstable', shot, previous, last, attempts };
    }
    previous = shot;
    await wait(Math.min(pauseAfter(attempts), remaining()));
  }
}
