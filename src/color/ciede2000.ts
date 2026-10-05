import type { Lab } from './types.js';

// CIEDE2000 colour difference (ISO/CIE 11664-6), following Sharma, Wu and Dalal (2005), "The
// CIEDE2000 color-difference formula", Color Research & Application 30(1). Equation numbers are
// theirs. About 1.0 is just noticeable.

/** Weights for lightness, chroma and hue. 1 for reference viewing conditions. */
export interface Weights {
  readonly kL: number;
  readonly kC: number;
  readonly kH: number;
}

const REFERENCE: Weights = { kL: 1, kC: 1, kH: 1 };

const DEGREES = Math.PI / 180;
const FULL_TURN = 360;
const HALF_TURN = 180;

/** 25⁷: chroma where the a* rescaling and the hue rotation are at half strength (Eqs. 4, 17). */
const CHROMA_PIVOT = 25 ** 7;

/** Hue weighting T = 1 + Σ w·cos(k·h̄′ − φ), as [w, k, φ in degrees] (Eq. 15). */
const HUE_TERMS: readonly (readonly [number, number, number])[] = [
  [-0.17, 1, 30],
  [0.24, 2, 0],
  [0.32, 3, -6],
  [-0.2, 4, 63],
];

/** Hue rotation Δθ = 30·exp(−((h̄′ − 275) / 25)²), in degrees (Eq. 16). */
const ROTATION = { peak: 30, centre: 275, width: 25 } as const;

/** Lightness compensation S_L = 1 + 0.015(L̄′ − 50)² / √(20 + (L̄′ − 50)²) (Eq. 18). */
const LIGHTNESS = { weight: 0.015, mid: 50, offset: 20 } as const;

/** Chroma and hue compensation: S_C = 1 + 0.045·C̄′ (Eq. 19), S_H = 1 + 0.015·C̄′·T (Eq. 20). */
const CHROMA_WEIGHT = 0.045;
const HUE_WEIGHT = 0.015;

const cos = (degrees: number): number => Math.cos(degrees * DEGREES);
const sin = (degrees: number): number => Math.sin(degrees * DEGREES);

/** √(C⁷ / (C⁷ + 25⁷)), the chroma factor in Eqs. 4 and 17. */
function chromaFactor(c: number): number {
  const c2 = c * c;
  const c7 = c2 * c2 * c2 * c;
  return Math.sqrt(c7 / (c7 + CHROMA_PIVOT));
}

/** Hue angle h′ in degrees, 0 for a neutral colour (Eq. 7). */
function hueAngle(b: number, a: number): number {
  if (a === 0 && b === 0) return 0;
  const h = Math.atan2(b, a) / DEGREES;
  return h < 0 ? h + FULL_TURN : h;
}

/** Signed hue difference Δh′, the short way round (Eq. 10). */
function hueDifference(h1: number, h2: number, chromaProduct: number): number {
  if (chromaProduct === 0) return 0;
  const dh = h2 - h1;
  if (dh > HALF_TURN) return dh - FULL_TURN;
  if (dh < -HALF_TURN) return dh + FULL_TURN;
  return dh;
}

/** Mean hue h̄′, the short way round (Eq. 14). */
function meanHue(h1: number, h2: number, chromaProduct: number): number {
  const sum = h1 + h2;
  if (chromaProduct === 0) return sum;
  if (Math.abs(h1 - h2) <= HALF_TURN) return sum / 2;
  return sum < FULL_TURN ? (sum + FULL_TURN) / 2 : (sum - FULL_TURN) / 2;
}

/** Hue weighting T (Eq. 15). */
function hueWeighting(hMean: number): number {
  let t = 1;
  for (const [w, k, phi] of HUE_TERMS) t += w * cos(k * hMean - phi);
  return t;
}

export function deltaE2000(x: Lab, y: Lab, weights: Weights = REFERENCE): number {
  // Step 1: rescale a* so neutral colours get chroma and hue consistent with the rest (Eqs. 2–7).
  const g = 0.5 * (1 - chromaFactor((Math.hypot(x.a, x.b) + Math.hypot(y.a, y.b)) / 2));
  const a1 = (1 + g) * x.a;
  const a2 = (1 + g) * y.a;
  const c1 = Math.hypot(a1, x.b);
  const c2 = Math.hypot(a2, y.b);
  const h1 = hueAngle(x.b, a1);
  const h2 = hueAngle(y.b, a2);
  const chromaProduct = c1 * c2;

  // Step 2: differences in lightness, chroma and hue (Eqs. 8–11).
  const dL = y.l - x.l;
  const dC = c2 - c1;
  const dH = 2 * Math.sqrt(chromaProduct) * sin(hueDifference(h1, h2, chromaProduct) / 2);

  // Step 3: weight them (Eqs. 12–22).
  const lMean = (x.l + y.l) / 2;
  const cMean = (c1 + c2) / 2;
  const hMean = meanHue(h1, h2, chromaProduct);
  const rotation = (hMean - ROTATION.centre) / ROTATION.width;
  const dTheta = ROTATION.peak * Math.exp(-(rotation * rotation));
  const lOffset = (lMean - LIGHTNESS.mid) ** 2;
  const sL = 1 + (LIGHTNESS.weight * lOffset) / Math.sqrt(LIGHTNESS.offset + lOffset);
  const sC = 1 + CHROMA_WEIGHT * cMean;
  const sH = 1 + HUE_WEIGHT * cMean * hueWeighting(hMean);
  const rT = -sin(2 * dTheta) * 2 * chromaFactor(cMean);

  const lightness = dL / (weights.kL * sL);
  const chroma = dC / (weights.kC * sC);
  const hue = dH / (weights.kH * sH);
  return Math.sqrt(lightness * lightness + chroma * chroma + hue * hue + rT * chroma * hue);
}
