import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Images a failed or updated comparison leaves behind for the report. */
export type Artifact = 'expected' | 'actual' | 'diff';

/** Where baselines are kept and where a run's images go. */
export interface SnapshotStore {
  /** Names the baseline in messages, usually its path. */
  readonly location: string;
  readBaseline(): Buffer | null;
  writeBaseline(png: Buffer): void;
  /** Keeps an image from this run and attaches it to the report. */
  record(artifact: Artifact, png: Buffer): Promise<void>;
}

export interface SnapshotPaths {
  /** The baseline, where `testInfo.snapshotPath(name, { kind: 'screenshot' })` puts it. */
  readonly baseline: string;
  /** Path prefix for this run's images, in the test's output directory. */
  readonly outputPrefix: string;
  /** Prefix for attachment names. Playwright's report pairs `<name>-expected` with `<name>-actual`. */
  readonly attachmentName: string;
}

export type Attach = (name: string, path: string) => Promise<void>;

function write(path: string, data: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

/** Keeps baselines and run images on disk, as `toHaveScreenshot` does. */
export class FileSnapshotStore implements SnapshotStore {
  constructor(
    private readonly paths: SnapshotPaths,
    private readonly attach: Attach,
  ) {}

  get location(): string {
    return this.paths.baseline;
  }

  readBaseline(): Buffer | null {
    return existsSync(this.paths.baseline) ? readFileSync(this.paths.baseline) : null;
  }

  writeBaseline(png: Buffer): void {
    write(this.paths.baseline, png);
  }

  async record(artifact: Artifact, png: Buffer): Promise<void> {
    // The expected image is the baseline itself; the others are written beside the test's output.
    const path =
      artifact === 'expected' ? this.paths.baseline : `${this.paths.outputPrefix}-${artifact}.png`;
    if (artifact !== 'expected') write(path, png);
    await this.attach(`${this.paths.attachmentName}-${artifact}.png`, path);
  }
}
