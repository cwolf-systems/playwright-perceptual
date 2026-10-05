import { describe, expect, it } from 'vitest';
import { Histogram } from '../../src/compare/histogram.js';

describe('Histogram', () => {
  it('reports zeros when everything is zero', () => {
    const h = new Histogram(0.01, 100);
    for (let i = 0; i < 10; i++) h.add(0);
    expect([h.mean, h.max, h.percentile(0.5), h.percentile(0.99)]).toEqual([0, 0, 0, 0]);
  });

  it('places percentiles to within one bin and keeps the mean and max exact', () => {
    const h = new Histogram(0.01, 1_000);
    for (let i = 1; i <= 100; i++) h.add(i / 10);
    expect(h.percentile(0.5)).toBeCloseTo(5, 1);
    expect(h.percentile(0.95)).toBeCloseTo(9.5, 1);
    expect(h.mean).toBeCloseTo(5.05, 10);
    expect(h.max).toBe(10);
  });

  it('caps values past the last bin there, without losing the max', () => {
    const h = new Histogram(1, 10);
    h.add(500);
    expect(h.percentile(1)).toBe(10);
    expect(h.max).toBe(500);
  });

  it('has a mean of zero before any value', () => {
    expect(new Histogram(1, 10).mean).toBe(0);
  });
});
