import type { MatcherDefaults } from './types.js';
import { createToBePerceptuallyNear } from './to-be-perceptually-near.js';
import { createToMatchPerceptually } from './to-match-perceptually.js';

/**
 * Matchers for `expect.extend`, with defaults applied to every assertion. Options given to an
 * assertion override them.
 *
 * ```ts
 * const expect = base.extend(createPerceptualMatchers({ maxDeltaE: 2 }));
 * ```
 */
export function createPerceptualMatchers(defaults: MatcherDefaults = {}) {
  return {
    toMatchPerceptually: createToMatchPerceptually(defaults),
    toBePerceptuallyNear: createToBePerceptuallyNear(defaults),
  };
}

export const perceptualMatchers = createPerceptualMatchers();
