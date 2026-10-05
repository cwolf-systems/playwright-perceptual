import type { ExpectMatcherState, MatcherReturnType } from '@playwright/test';
import { DEFAULT_WITHIN, wholePixels } from '../defaults.js';
import { InvalidOptionError } from '../errors.js';
import { describeComparison, describeSize } from '../snapshot/report.js';
import type { RgbaImage } from '../image/types.js';
import type { MatcherDefaults, PerceptualPixelOptions } from './types.js';
import { comparatorFor } from './shared.js';

const NAME = 'toBePerceptuallyNear';

const percent = (share: number): string => `${Number((share * 100).toFixed(4))}%`;

export function createToBePerceptuallyNear(defaults: MatcherDefaults) {
  return function toBePerceptuallyNear(
    this: ExpectMatcherState,
    actual: RgbaImage,
    expected: RgbaImage,
    overrides: PerceptualPixelOptions = {},
  ): MatcherReturnType {
    const options = { ...defaults, ...overrides };
    const within = options.within ?? DEFAULT_WITHIN;
    if (!(within >= 0 && within <= 1)) {
      throw new InvalidOptionError('within', within, 'between 0 and 1');
    }

    const hint = this.utils.matcherHint(NAME, undefined, undefined, { isNot: this.isNot });
    if (expected.width !== actual.width || expected.height !== actual.height) {
      return {
        pass: false,
        name: NAME,
        message: () => `${hint}\n\n${describeSize(expected, actual)}`,
      };
    }

    const comparison = comparatorFor(options).compare(expected, actual);
    const pass = comparison.differing <= wholePixels((1 - within) * actual.width * actual.height);
    const expectation = this.isNot
      ? 'Expected the pixels to differ visibly.'
      : `Expected ${percent(within)} of pixels unchanged.`;
    return {
      pass,
      name: NAME,
      message: () => `${hint}\n\n${expectation}\n${describeComparison(comparison)}`,
    };
  };
}
