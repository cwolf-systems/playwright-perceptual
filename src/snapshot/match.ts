import { allowedDiffPixels } from '../defaults.js';
import { decodePng, encodePng } from '../image/png.js';
import type { Comparison, ImageComparator } from '../compare/types.js';
import type { RgbaImage } from '../image/types.js';
import type { Tolerance, UpdateMode } from './types.js';
import {
  captureStable,
  type Capture,
  type Judge,
  type Judgement,
  type ScreenshotSource,
  type Shot,
} from './capture.js';
import { decide } from './policy.js';
import { describeComparison, describeSize } from './report.js';
import type { Artifact, SnapshotStore } from './store.js';

export interface MatchRequest {
  readonly source: ScreenshotSource;
  readonly store: SnapshotStore;
  readonly comparator: ImageComparator;
  readonly tolerance: Tolerance;
  readonly mode: UpdateMode;
}

export interface MatchResult {
  readonly pass: boolean;
  readonly message: string;
  readonly wroteBaseline: boolean;
  /** Progress lines for Playwright's call log. */
  readonly log: readonly string[];
}

/** Two images compared, kept so the diff image can be painted only when it is needed. */
interface Pair {
  readonly expected: RgbaImage;
  readonly actual: RgbaImage;
}

type Outcome =
  | { readonly situation: 'missing' }
  | { readonly situation: 'matching' }
  | { readonly situation: 'different'; readonly comparison: Comparison; readonly pair: Pair }
  | { readonly situation: 'resized'; readonly baseline: RgbaImage }
  | { readonly situation: 'unstable'; readonly last: Judgement; readonly pair: Pair };

function judgeWith(comparator: ImageComparator, tolerance: Tolerance): Judge {
  return (expected, actual) => {
    if (expected.width !== actual.width || expected.height !== actual.height) {
      return { kind: 'resized' };
    }
    const comparison = comparator.compare(expected, actual);
    const allowed = allowedDiffPixels(tolerance, expected.width * expected.height);
    return { kind: 'compared', comparison, agrees: comparison.differing <= allowed };
  };
}

/** The baseline as it stands: absent, present but unread, or decoded. */
type Baseline =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unread' }
  | { readonly kind: 'read'; readonly image: RgbaImage };

function classify(capture: Capture, stored: Baseline, judge: Judge): Outcome {
  switch (capture.kind) {
    case 'unstable':
      return {
        situation: 'unstable',
        last: capture.last,
        pair: { expected: capture.previous.image, actual: capture.shot.image },
      };
    case 'matched':
      return { situation: 'matching' };
    case 'stable': {
      if (stored.kind === 'absent') return { situation: 'missing' };
      // Only 'all' leaves a baseline unread, and it replaces the baseline whatever it holds.
      if (stored.kind === 'unread') return { situation: 'matching' };
      const baseline = stored.image;
      const judgement = judge(baseline, capture.shot.image);
      if (judgement.kind === 'resized') return { situation: 'resized', baseline };
      return judgement.agrees
        ? { situation: 'matching' }
        : {
            situation: 'different',
            comparison: judgement.comparison,
            pair: { expected: baseline, actual: capture.shot.image },
          };
    }
  }
}

function describe(outcome: Outcome, shot: Shot, request: MatchRequest): string {
  const { store, source } = request;
  switch (outcome.situation) {
    case 'missing':
      return `A baseline didn't exist at ${store.location}; wrote the actual screenshot.`;
    case 'matching':
      return 'The screenshot matches its baseline.';
    case 'different':
      return describeComparison(outcome.comparison);
    case 'resized':
      return describeSize(outcome.baseline, shot.image);
    case 'unstable': {
      const header = `Screenshots kept changing for ${source.timeoutMs} ms.`;
      return outcome.last.kind === 'compared'
        ? `${header}\nThe last two:\n${describeComparison(outcome.last.comparison)}`
        : header;
    }
  }
}

/** The pair whose diff image a failure shows, if it has one. */
function diffPair(outcome: Outcome): Pair | null {
  if (outcome.situation === 'different') return outcome.pair;
  if (outcome.situation === 'unstable' && outcome.last.kind === 'compared') return outcome.pair;
  return null;
}

const waiting = (timeoutMs: number): string =>
  Number.isFinite(timeoutMs)
    ? `waiting up to ${timeoutMs} ms for a stable screenshot`
    : 'waiting for a stable screenshot';

/** Compares a stable screenshot with its baseline and applies the update mode's policy. */
export async function matchSnapshot(request: MatchRequest): Promise<MatchResult> {
  const { source, store, comparator, tolerance, mode } = request;
  const log: string[] = [];
  const baselinePng = store.readBaseline();

  // Without a baseline and without permission to write one, there is nothing to capture for.
  if (baselinePng === null && !decide('missing', mode).writeBaseline) {
    return {
      pass: false,
      message: `A baseline doesn't exist at ${store.location}.`,
      wroteBaseline: false,
      log,
    };
  }

  // Updating everything replaces the baseline whatever it holds, even an unreadable file.
  const stored: Baseline =
    baselinePng === null
      ? { kind: 'absent' }
      : mode === 'all'
        ? { kind: 'unread' }
        : { kind: 'read', image: decodePng(baselinePng, store.location) };
  const judge = judgeWith(comparator, tolerance);
  log.push(waiting(source.timeoutMs));
  const capture = await captureStable(source, judge, stored.kind === 'read' ? stored.image : null);
  log.push(
    `${capture.kind} after ${capture.attempts} screenshot${capture.attempts === 1 ? '' : 's'}`,
  );

  const outcome = classify(capture, stored, judge);
  const decision = decide(outcome.situation, mode);

  if (decision.writeBaseline) {
    store.writeBaseline(capture.shot.png);
    log.push(`wrote ${store.location}`);
  }

  const pair = diffPair(outcome);
  const images: Record<Artifact, () => Buffer | null> = {
    expected: () => (decision.writeBaseline ? capture.shot.png : baselinePng),
    actual: () => capture.shot.png,
    diff: () => (pair ? encodePng(comparator.diff(pair.expected, pair.actual).diff) : null),
  };
  for (const artifact of decision.record) {
    const png = images[artifact]();
    if (png) await store.record(artifact, png);
  }

  const message =
    decision.pass && decision.writeBaseline
      ? `Updated ${store.location}.`
      : describe(outcome, capture.shot, request);
  return { pass: decision.pass, message, wroteBaseline: decision.writeBaseline, log };
}
