import { describe, expect, it } from 'vitest';
import { PerceptualComparator } from '../../src/compare/comparator.js';
import { encodePng } from '../../src/image/png.js';
import { matchSnapshot } from '../../src/snapshot/match.js';
import type { Tolerance, UpdateMode } from '../../src/snapshot/types.js';
import { MemoryStore, solid } from '../helpers.js';

const GREY = encodePng(solid(4, 4, [128, 128, 128, 255]));
const RED = encodePng(solid(4, 4, [200, 40, 40, 255]));
const WIDE = encodePng(solid(6, 4, [128, 128, 128, 255]));

/** Screenshots in order, repeating the last. */
function screens(...shots: Buffer[]) {
  let i = 0;
  return {
    capture: () => Promise.resolve(shots[Math.min(i++, shots.length - 1)]!),
    timeoutMs: 1_000,
  };
}

function run(store: MemoryStore, mode: UpdateMode, shots: Buffer[], tolerance: Tolerance = {}) {
  return matchSnapshot({
    source: screens(...shots),
    store,
    comparator: new PerceptualComparator(),
    tolerance,
    mode,
  });
}

/** The default comparator, counting how often it paints a diff image. */
class CountingComparator extends PerceptualComparator {
  diffs = 0;

  override diff(...images: Parameters<PerceptualComparator['diff']>) {
    this.diffs++;
    return super.diff(...images);
  }
}

describe('matchSnapshot', () => {
  it('writes a missing baseline and fails, and says so', async () => {
    const store = new MemoryStore();
    const result = await run(store, 'missing', [GREY]);
    expect(result.pass).toBe(false);
    expect(result.message).toMatch(/didn't exist at memory:\/\/baseline\.png/);
    expect(store.baseline).toEqual(GREY);
    expect(store.recorded).toEqual(['expected', 'actual']);
  });

  it("doesn't capture at all when there is no baseline and updates are off", async () => {
    const store = new MemoryStore();
    let captured = 0;
    const result = await matchSnapshot({
      source: { capture: () => Promise.resolve((captured++, GREY)), timeoutMs: 1_000 },
      store,
      comparator: new PerceptualComparator(),
      tolerance: {},
      mode: 'none',
    });
    expect(result.pass).toBe(false);
    expect(captured).toBe(0);
  });

  it('passes a matching screenshot on the first capture, recording nothing', async () => {
    const store = new MemoryStore(GREY);
    const result = await run(store, 'missing', [GREY]);
    expect(result).toMatchObject({ pass: true, wroteBaseline: false });
    expect(result.log).toContain('matched after 1 screenshot');
    expect(store.recorded).toEqual([]);
  });

  it('fails a visible change with the ΔE distribution, and attaches a diff', async () => {
    const store = new MemoryStore(GREY);
    const result = await run(store, 'missing', [RED]);
    expect(result.pass).toBe(false);
    expect(result.message).toMatch(/16 pixels \(100\.00% of the image\) changed\./);
    expect(result.message).toMatch(/median \d+\.\d\d, p95/);
    expect(store.recorded).toEqual(['expected', 'actual', 'diff']);
    expect(store.baseline).toEqual(GREY);
  });

  it('rewrites a changed baseline when updating', async () => {
    const store = new MemoryStore(GREY);
    const result = await run(store, 'changed', [RED]);
    expect(result).toMatchObject({
      pass: true,
      wroteBaseline: true,
      message: 'Updated memory://baseline.png.',
    });
    expect(store.baseline).toEqual(RED);
  });

  it('waits for the page to settle before comparing', async () => {
    const result = await run(new MemoryStore(GREY), 'missing', [RED, GREY, GREY]);
    expect(result.pass).toBe(true);
    expect(result.log).toContain('stable after 3 screenshots');
  });

  it('allows the given number of changed pixels', async () => {
    const speck = solid(4, 4, [128, 128, 128, 255]);
    speck.data.set([255, 0, 0, 255], 0);
    const shot = encodePng(speck);
    expect((await run(new MemoryStore(GREY), 'missing', [shot])).pass).toBe(false);
    expect((await run(new MemoryStore(GREY), 'missing', [shot], { maxDiffPixels: 1 })).pass).toBe(
      true,
    );
  });

  it('fails when screenshots never settle, showing the last two differ', async () => {
    let n = 0;
    const result = await matchSnapshot({
      source: { capture: () => Promise.resolve(n++ % 2 === 0 ? RED : GREY), timeoutMs: 20 },
      store: new MemoryStore(GREY),
      comparator: new PerceptualComparator(),
      tolerance: {},
      mode: 'missing',
    });
    expect(result.pass).toBe(false);
    expect(result.message).toMatch(/kept changing for 20 ms\.\nThe last two:/);
  });

  it('reports a change of size instead of comparing', async () => {
    const store = new MemoryStore(WIDE);
    const result = await run(store, 'missing', [GREY]);
    expect(result).toMatchObject({ pass: false, message: 'Expected an image 6×4, got 4×4.' });
    expect(store.recorded).toEqual(['expected', 'actual']);
  });

  it('paints a diff image only for a failure that attaches one', async () => {
    const passing = new CountingComparator();
    await matchSnapshot({
      source: screens(RED, GREY, GREY),
      store: new MemoryStore(GREY),
      comparator: passing,
      tolerance: {},
      mode: 'missing',
    });
    expect(passing.diffs).toBe(0);

    const failing = new CountingComparator();
    const store = new MemoryStore(GREY);
    await matchSnapshot({
      source: screens(RED, GREY, RED, RED),
      store,
      comparator: failing,
      tolerance: {},
      mode: 'missing',
    });
    expect(failing.diffs).toBe(1);
    expect(store.recorded).toContain('diff');
  });

  it('replaces even a matching baseline when updating everything', async () => {
    const store = new MemoryStore(GREY);
    const result = await run(store, 'all', [RED, RED]);
    expect(result).toMatchObject({ pass: true, wroteBaseline: true });
    expect(store.baseline).toEqual(RED);
  });

  it('replaces an unreadable baseline when updating everything, without reading it', async () => {
    const store = new MemoryStore(Buffer.from('not a png'));
    const result = await run(store, 'all', [RED, RED]);
    expect(result).toMatchObject({ pass: true, wroteBaseline: true });
    expect(store.baseline).toEqual(RED);
  });

  it('fails when screenshots keep changing size, with nothing to diff', async () => {
    let n = 0;
    const store = new MemoryStore(GREY);
    const result = await matchSnapshot({
      source: { capture: () => Promise.resolve(n++ % 2 === 0 ? WIDE : GREY), timeoutMs: 20 },
      store,
      comparator: new PerceptualComparator(),
      tolerance: {},
      mode: 'missing',
    });
    expect(result.message).toBe('Screenshots kept changing for 20 ms.');
    expect(store.recorded).toEqual(['actual']);
  });
});
