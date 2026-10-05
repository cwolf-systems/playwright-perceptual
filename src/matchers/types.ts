import type { PageScreenshotOptions } from '@playwright/test';
import type { CompareOptions, ImageComparator } from '../compare/types.js';
import type { Tolerance } from '../snapshot/types.js';

/** Options passed to `screenshot()`. */
export type CaptureOptions = Pick<
  PageScreenshotOptions,
  | 'animations'
  | 'caret'
  | 'clip'
  | 'fullPage'
  | 'mask'
  | 'maskColor'
  | 'omitBackground'
  | 'scale'
  | 'style'
>;

/** Replaces the perceptual comparator, which the `CompareOptions` configure. */
export interface ComparatorOption {
  readonly comparator?: ImageComparator;
}

export interface PerceptualScreenshotOptions
  extends CompareOptions, Tolerance, CaptureOptions, ComparatorOption {
  /** How long to wait for a stable screenshot. Default: the expect timeout. */
  readonly timeout?: number;
}

export interface PerceptualPixelOptions extends CompareOptions, ComparatorOption {
  /** Share of pixels that must count as unchanged. */
  readonly within?: number;
}

/** Defaults for every assertion made with one set of matchers. */
export type MatcherDefaults = Omit<PerceptualScreenshotOptions, 'clip' | 'mask'> &
  Pick<PerceptualPixelOptions, 'within'>;
