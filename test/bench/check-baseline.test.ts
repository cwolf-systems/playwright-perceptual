import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  check,
  failing,
  sameMachine,
  type BaselinePair,
  type Machine,
  type Result,
} from '../../bench/check-baseline.mjs';

// The baseline check CI runs (bench/check-baseline.mjs): which machines count as alike for rendered
// bytes, which pairs whose bytes changed it lists, and what fails the check.

const pair = (
  id: string,
  match: boolean,
  pass: boolean,
  sha256?: readonly string[],
): BaselinePair => ({
  id,
  set: id.startsWith('rendered') ? 'design' : 'synthetic',
  match,
  pass: { none: pass, allowance: pass },
  counted: pass ? 0 : 500,
  ...(sha256 ? { sha256 } : {}),
});

const result = (machine: Machine, pairs: readonly BaselinePair[]): Result => ({
  machine,
  accuracy: { pairs },
});

const ubuntu = (cpu: string, version: string): Machine => ({
  platform: 'linux',
  cpu,
  image: `ubuntu24 ${version}`,
});

describe('sameMachine', () => {
  const amd = result(ubuntu('AMD EPYC 7763', '20261116.376.1'), []);

  it('takes the same runner image on another CPU, and in another week, as alike', () => {
    expect(sameMachine(result(ubuntu('INTEL XEON 8573C', '20261122.23.1'), []), amd)).toBe(true);
  });

  it('takes another runner image, or another platform, as different', () => {
    const noble = { platform: 'linux', cpu: 'AMD EPYC 7763', image: 'ubuntu26 20261116.1' };
    expect(sameMachine(result(noble, []), amd)).toBe(false);
    expect(
      sameMachine(result({ ...ubuntu('AMD EPYC 7763', '1'), platform: 'win32' }, []), amd),
    ).toBe(false);
  });

  it('takes a run outside CI and a CI baseline as different, whatever their CPUs', () => {
    expect(sameMachine(result({ platform: 'linux', cpu: 'AMD EPYC 7763' }, []), amd)).toBe(false);
  });

  it('takes the same CPU outside CI as alike, and another CPU as different', () => {
    const m4 = { platform: 'darwin', cpu: 'Apple M4' };
    expect(sameMachine(result(m4, []), result(m4, []))).toBe(true);
    expect(sameMachine(result({ ...m4, cpu: 'Apple M1' }, []), result(m4, []))).toBe(false);
  });
});

describe('check', () => {
  const machine = ubuntu('AMD EPYC 7763', '1');
  const baseline = result(machine, [
    pair('rendered/regression/firefox/terrain', false, false, ['a', 'b']),
    pair('rendered/colour/chromium/map', true, true, ['c', 'd']),
    pair('synthetic/cases/grid line removed', false, false),
  ]);

  it('lists the rendered pairs whose bytes changed', () => {
    const now = result(machine, [
      pair('rendered/regression/firefox/terrain', false, false, ['a', 'x']),
      pair('rendered/colour/chromium/map', true, true, ['c', 'd']),
      pair('synthetic/cases/grid line removed', false, false),
    ]);
    const r = check(now, baseline, true, true);
    expect(r.hashed).toBe(2);
    expect(r.moved).toEqual(['rendered/regression/firefox/terrain']);
    expect(r.lost).toEqual([]);
  });

  it('counts self-noise pairs whose bytes changed apart from the other rendered pairs', () => {
    const noise = 'self-noise 1×/webkit/map/0v1';
    const before = result(machine, [pair(noise, true, true, ['a', 'b'])]);
    const r = check(result(machine, [pair(noise, true, true, ['a', 'x'])]), before, true, true);
    expect(r.moved).toEqual([]);
    expect(r.hashed).toBe(0);
    expect(r.noiseHashed).toBe(1);
    expect(r.noiseMoved).toEqual([noise]);
    // Their verdicts are still checked.
    const lost = check(result(machine, [pair(noise, true, false, ['a', 'b'])]), before, true, true);
    expect(failing(lost, true).lost.map((p) => p.id)).toEqual([noise, noise]);
  });

  it('counts a rendered pair missing on a machine like the baseline’s as missing', () => {
    const now = result(machine, [pair('synthetic/cases/grid line removed', false, false)]);
    const r = check(now, baseline, true, true);
    expect(r.missing).toEqual([
      'rendered/regression/firefox/terrain',
      'rendered/colour/chromium/map',
    ]);
  });

  it('skips rendered pairs on another machine', () => {
    const now = result({ platform: 'darwin', cpu: 'Apple M4' }, [
      pair('synthetic/cases/grid line removed', false, false),
    ]);
    const r = check(now, baseline, false, false);
    expect(r.skippedRendered).toBe(2);
    expect(r.missing).toEqual([]);
  });
});

describe('failing', () => {
  const machine = ubuntu('AMD EPYC 7763', '1');
  const baseline = result(machine, [
    pair('rendered/regression/firefox/terrain', false, false),
    pair('rendered/colour/chromium/map', true, true),
    pair('synthetic/cases/grid line removed', false, false),
  ]);
  // The rendered regression now passes, the rendered map is gone, and the synthetic case passes.
  const now = result(machine, [
    pair('rendered/regression/firefox/terrain', false, true),
    pair('synthetic/cases/grid line removed', false, true),
  ]);
  const r = check(now, baseline, true, true);

  it('fails on every lost verdict and missing pair where rendered pairs are enforced', () => {
    const f = failing(r, true);
    expect(f.lost.map((p) => p.id)).toEqual([
      'rendered/regression/firefox/terrain',
      'rendered/regression/firefox/terrain',
      'synthetic/cases/grid line removed',
      'synthetic/cases/grid line removed',
    ]);
    expect(f.missing).toEqual(['rendered/colour/chromium/map']);
  });

  it('still fails on the other pairs where rendered pairs are only reported', () => {
    const f = failing(r, false);
    expect(f.lost.map((p) => p.id)).toEqual([
      'synthetic/cases/grid line removed',
      'synthetic/cases/grid line removed',
    ]);
    expect(f.missing).toEqual([]);
    // Reported all the same.
    expect(r.lost).toHaveLength(4);
  });
});

describe('the script', () => {
  // Run through a symbolic link to the script, so that a check that does not recognise it is being
  // run, and silently does nothing, shows here as a wrong exit code.
  const dir = mkdtempSync(join(tmpdir(), 'check-baseline-'));
  const script = join(dir, 'check-baseline.mjs');
  symlinkSync(resolve('bench/check-baseline.mjs'), script);
  const machine = ubuntu('AMD EPYC 7763', '1');
  const file = (name: string, pairs: readonly BaselinePair[]) => {
    const path = join(dir, name);
    const judged = {
      judge: { labels: 'l' },
      candidate: { name: 'ci', commit: null },
      ...result(machine, pairs),
    };
    writeFileSync(path, JSON.stringify(judged));
    return path;
  };
  const baseline = file('baseline.json', [
    pair('rendered/regression/firefox/terrain', false, false),
    pair('synthetic/cases/grid line removed', false, false),
  ]);
  const run = (resultFile: string, ...flags: string[]) =>
    spawnSync(process.execPath, [script, resultFile, '--baseline', baseline, ...flags], {
      encoding: 'utf8',
    }).status;

  const renderedLost = file('rendered-lost.json', [
    pair('rendered/regression/firefox/terrain', false, true),
    pair('synthetic/cases/grid line removed', false, false),
  ]);
  const syntheticMissing = file('synthetic-missing.json', [
    pair('rendered/regression/firefox/terrain', false, false),
  ]);

  it('fails on a lost rendered verdict, unless rendered pairs are only reported', () => {
    expect(run(renderedLost)).toBe(1);
    expect(run(renderedLost, '--report-rendered')).toBe(0);
  });

  it('fails on a missing synthetic pair even when rendered pairs are only reported', () => {
    expect(run(syntheticMissing, '--report-rendered')).toBe(1);
  });
});
