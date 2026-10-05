import { describe, expect, it } from 'vitest';
import { encodePng } from '../../src/image/png.js';
import { captureStable, type Judge } from '../../src/snapshot/capture.js';
import { solid } from '../helpers.js';

const shade = (v: number): Buffer => encodePng(solid(2, 2, [v, v, v, 255]));

/** Agrees when the two images are byte for byte the same. */
const exact: Judge = (expected, actual) => {
  const agrees = Buffer.from(expected.data).equals(Buffer.from(actual.data));
  return {
    kind: 'compared',
    agrees,
    comparison: { width: 2, height: 2, differing: agrees ? 0 : 4, notes: [] },
  };
};

/** A page that changes `changes` times, then holds still, recording each capture's timeout. */
function settling(changes: number, timeoutMs: number) {
  let n = 0;
  const timeouts: number[] = [];
  return {
    timeouts,
    source: {
      timeoutMs,
      capture: (timeout: number) => {
        timeouts.push(timeout);
        return Promise.resolve(shade(Math.min(n++, changes) * 10));
      },
    },
  };
}

describe('captureStable', () => {
  it('pauses between captures as Playwright does, longer each time', async () => {
    const pauses: number[] = [];
    const page = settling(6, 60_000);
    const capture = await captureStable(page.source, exact, null, (ms) => {
      pauses.push(ms);
      return Promise.resolve();
    });
    expect(capture.kind).toBe('stable');
    expect(pauses).toEqual([0, 100, 250, 500, 1000, 1000, 1000]);
  });

  it('gives each screenshot the time that remains', async () => {
    const page = settling(2, 60_000);
    await captureStable(page.source, exact, null, () => Promise.resolve());
    expect(page.timeouts).toHaveLength(4);
    for (const timeout of page.timeouts) {
      expect(timeout).toBeGreaterThan(59_000);
      expect(timeout).toBeLessThanOrEqual(60_000);
    }
  });

  it('waits as long as it takes when the timeout is infinite', async () => {
    const page = settling(20, Number.POSITIVE_INFINITY);
    const capture = await captureStable(page.source, exact, null, () => Promise.resolve());
    expect(capture).toMatchObject({ kind: 'stable', attempts: 22 });
    expect(page.timeouts.every((timeout) => timeout === Number.POSITIVE_INFINITY)).toBe(true);
  });

  it('never pauses past the deadline', async () => {
    const pauses: number[] = [];
    const page = settling(1_000, 30);
    const capture = await captureStable(page.source, exact, null, (ms) => {
      pauses.push(ms);
      return new Promise((resolve) => setTimeout(resolve, ms));
    });
    expect(capture.kind).toBe('unstable');
    expect(Math.max(...pauses)).toBeLessThanOrEqual(30);
  });
});
