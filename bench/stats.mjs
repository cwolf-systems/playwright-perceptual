// Intervals for the rates the benchmark reports. With 9 to 24 pairs in a group, one pair moves a
// rate by 4 to 11 points, so each rate is printed with its 95% interval and a difference of a pair
// or two is not read as real.

/** The normal quantile for a two-sided 95% interval. */
const Z95 = 1.959963984540054;

/**
 * Wilson's score interval for a proportion (Wilson, 1927; method 3 of Newcombe, 1998, without
 * continuity correction): the proportions p whose score test does not reject k successes in n
 * trials. Unlike the normal approximation it stays within [0, 1] and is not empty at k = 0 or
 * k = n, which matters here: most cells of the accuracy tables are 0.
 *
 * Returns null when there are no trials.
 */
export function wilson(successes, trials, z = Z95) {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) || trials < 0) {
    throw new RangeError(`wilson(${successes}, ${trials}): counts must be whole and non-negative`);
  }
  if (successes < 0 || successes > trials) {
    throw new RangeError(`wilson(${successes}, ${trials}): successes must lie in 0..trials`);
  }
  if (trials === 0) return null;
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  // At k = 0 and k = n the bounds are 0 and 1 exactly; rounding would leave them a hair off.
  return {
    low: successes === 0 ? 0 : Math.max(0, centre - half),
    high: successes === trials ? 1 : Math.min(1, centre + half),
  };
}

const percent = (x) => Math.round(x * 100);

/**
 * A count with its rate and 95% interval, for a table cell: "8 (23%, 12–39%)". With no trials, the
 * count alone.
 */
export function rateCell(successes, trials) {
  const interval = wilson(successes, trials);
  if (interval === null) return String(successes);
  const rate = percent(successes / trials);
  return `${successes} (${rate}%, ${percent(interval.low)}–${percent(interval.high)}%)`;
}
