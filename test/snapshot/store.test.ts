import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSnapshotStore } from '../../src/snapshot/store.js';

let dir: string;
let attached: [string, string][];
let store: FileSnapshotStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'perceptual-'));
  attached = [];
  store = new FileSnapshotStore(
    {
      baseline: join(dir, 'snapshots', 'view.png'),
      outputPrefix: join(dir, 'results', 'view'),
      attachmentName: 'view',
    },
    (name, path) => {
      attached.push([name, path]);
      return Promise.resolve();
    },
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('FileSnapshotStore', () => {
  it('reads nothing until a baseline is written, creating its folder', () => {
    expect(store.readBaseline()).toBeNull();
    store.writeBaseline(Buffer.from('png'));
    expect(store.readBaseline()).toEqual(Buffer.from('png'));
    expect(store.location).toBe(join(dir, 'snapshots', 'view.png'));
  });

  it('attaches the baseline as the expected image, and writes the others beside the output', async () => {
    store.writeBaseline(Buffer.from('baseline'));
    await store.record('expected', Buffer.from('ignored'));
    await store.record('actual', Buffer.from('actual'));
    await store.record('diff', Buffer.from('diff'));
    expect(attached).toEqual([
      ['view-expected.png', join(dir, 'snapshots', 'view.png')],
      ['view-actual.png', join(dir, 'results', 'view-actual.png')],
      ['view-diff.png', join(dir, 'results', 'view-diff.png')],
    ]);
    expect(readFileSync(join(dir, 'results', 'view-actual.png'), 'utf8')).toBe('actual');
    expect(existsSync(join(dir, 'results', 'view-expected.png'))).toBe(false);
  });
});
