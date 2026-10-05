import { describe, expect, it } from 'vitest';
import { deltaE2000 } from '../../src/color/ciede2000.js';
import { rgbToLab } from '../../src/color/cielab.js';
import { luma, overWhite, pack } from '../../src/color/rgb.js';

describe('rgbToLab', () => {
  it.each([
    ['white', pack(255, 255, 255), [100, 0, 0]],
    ['black', pack(0, 0, 0), [0, 0, 0]],
    ['red', pack(255, 0, 0), [53.24, 80.09, 67.2]],
    ['green', pack(0, 255, 0), [87.73, -86.18, 83.18]],
    ['blue', pack(0, 0, 255), [32.3, 79.19, -107.86]],
  ] as const)('maps %s to its CIELAB value', (_, rgb, [l, a, b]) => {
    const lab = rgbToLab(rgb);
    expect(lab.l).toBeCloseTo(l, 1);
    expect(lab.a).toBeCloseTo(a, 1);
    expect(lab.b).toBeCloseTo(b, 1);
  });

  it('puts one 8-bit step of mid grey below a noticeable difference', () => {
    const step = deltaE2000(rgbToLab(pack(128, 128, 128)), rgbToLab(pack(129, 129, 129)));
    expect(step).toBeGreaterThan(0.2);
    expect(step).toBeLessThan(1);
  });
});

describe('packed colours', () => {
  it('weigh green heaviest in luma', () => {
    expect(luma(pack(0, 255, 0))).toBeGreaterThan(luma(pack(255, 0, 0)));
    expect(luma(pack(255, 255, 255))).toBeCloseTo(255, 6);
  });

  it('blend a transparent channel to white', () => {
    expect(overWhite(0, 0)).toBe(255);
    expect(overWhite(0, 255)).toBe(0);
    expect(overWhite(0, 128)).toBe(127);
  });
});
