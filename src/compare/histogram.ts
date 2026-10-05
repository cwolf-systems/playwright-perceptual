/**
 * Fixed-width histogram for percentiles over millions of values without storing them. Percentiles
 * are accurate to one bin; values past the last bin land in it, and `max` stays exact.
 */
export class Histogram {
  private readonly bins: Uint32Array;
  private count = 0;
  private sum = 0;
  private largest = 0;

  constructor(
    private readonly binWidth: number,
    binCount: number,
  ) {
    this.bins = new Uint32Array(binCount);
  }

  add(value: number, times = 1): void {
    const bin = Math.min(this.bins.length - 1, Math.floor(value / this.binWidth));
    this.bins[bin]! += times;
    this.count += times;
    this.sum += value * times;
    this.largest = Math.max(this.largest, value);
  }

  get mean(): number {
    return this.count === 0 ? 0 : this.sum / this.count;
  }

  get max(): number {
    return this.largest;
  }

  /** The upper edge of the bin holding the q-th quantile, capped at `max`; 0 if that bin is the first. */
  percentile(q: number): number {
    const target = Math.ceil(q * this.count);
    let seen = 0;
    const bin = this.bins.findIndex((n) => (seen += n) >= target);
    if (bin <= 0) return 0;
    return Math.min(this.largest, (bin + 1) * this.binWidth);
  }
}
