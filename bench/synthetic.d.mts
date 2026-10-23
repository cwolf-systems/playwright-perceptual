import type { RgbaImage } from '../src/image/types.js';

export interface SyntheticPair {
  readonly expected: RgbaImage;
  readonly actual: RgbaImage;
}

export interface LabelledSyntheticPair {
  readonly name: string;
  readonly finding: number;
  readonly category: string;
  readonly shouldMatch: boolean;
  readonly make: () => SyntheticPair;
}

export function surfaceOpacity(before?: number, after?: number): SyntheticPair;
export function surfacePanned(pan?: number): SyntheticPair;
export function labelMoved(): SyntheticPair;
export function labelEdge(): SyntheticPair;
export function rasteriserTerrain(): SyntheticPair;
export function rasteriserOverlay(): SyntheticPair;
export function bilinearRounding(): SyntheticPair;
export const SYNTHETIC_PAIRS: readonly LabelledSyntheticPair[];
