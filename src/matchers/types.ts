import type {
  ExpectMatcherState,
  Locator,
  MatcherReturnType,
  Page,
  PageScreenshotOptions,
} from '@playwright/test';
import type { CompareOptions, ImageComparator } from '../compare/types.js';
import type { RgbaImage } from '../image/types.js';
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

export type ToMatchPerceptually = (
  this: ExpectMatcherState,
  target: Page | Locator,
  name: string,
  options?: PerceptualScreenshotOptions,
) => Promise<MatcherReturnType>;

export type ToBePerceptuallyNear = (
  this: ExpectMatcherState,
  actual: RgbaImage,
  expected: RgbaImage,
  options?: PerceptualPixelOptions,
) => MatcherReturnType;

/**
 * The matchers `expect.extend` adds. A type alias, not an interface: `expect.extend` takes a
 * `Record<string, …>`, and only aliases get the implicit index signature that needs.
 */
export type PerceptualMatchers = {
  readonly toMatchPerceptually: ToMatchPerceptually;
  readonly toBePerceptuallyNear: ToBePerceptuallyNear;
};
