import type { Artifact, SnapshotStore } from '../src/snapshot/store.js';
import type { RgbaImage } from '../src/image/types.js';

export type Rgba = readonly [number, number, number, number];

export function solid(width: number, height: number, rgba: Rgba): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { data, width, height };
}

export function setPixel(image: RgbaImage, x: number, y: number, rgba: Rgba): void {
  image.data.set(rgba, (y * image.width + x) * 4);
}

export function pixelAt(image: RgbaImage, x: number, y: number): number[] {
  const i = (y * image.width + x) * 4;
  return Array.from(image.data.slice(i, i + 4));
}

/** A snapshot store held in memory, recording what a match did. */
export class MemoryStore implements SnapshotStore {
  readonly location = 'memory://baseline.png';
  readonly recorded: Artifact[] = [];

  constructor(public baseline: Buffer | null = null) {}

  readBaseline(): Buffer | null {
    return this.baseline;
  }

  writeBaseline(png: Buffer): void {
    this.baseline = png;
  }

  record(artifact: Artifact): Promise<void> {
    this.recorded.push(artifact);
    return Promise.resolve();
  }
}
