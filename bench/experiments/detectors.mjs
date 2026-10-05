// Experimental noise detectors, judged by the accuracy benchmark before any is adopted. Each has
// the NoiseDetector shape, (image, other, x, y) => boolean, so it plugs into PerceptualComparator
// as one of its parts.

const red = (rgb) => rgb >> 16;
const green = (rgb) => (rgb >> 8) & 0xff;
const blue = (rgb) => rgb & 0xff;
const CHANNELS = [red, green, blue];

/** Pixels of a square window around (x, y), clipped to the image. */
function* window(raster, x, y, radius) {
  for (let ny = Math.max(0, y - radius); ny <= Math.min(raster.height - 1, y + radius); ny++) {
    for (let nx = Math.max(0, x - radius); nx <= Math.min(raster.width - 1, x + radius); nx++) {
      yield [nx, ny];
    }
  }
}

// SSIM stabilising constants for 8-bit data (Wang et al., 2004).
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

/** Mean SSIM of the three channels over the window, and each image's variance there. */
function windowStats(image, other, x, y, radius) {
  const n = { count: 0 };
  const sums = CHANNELS.map(() => ({ a: 0, b: 0, aa: 0, bb: 0, ab: 0 }));
  for (const [nx, ny] of window(image, x, y, radius)) {
    const p = image.rgbAt(nx, ny);
    const q = other.rgbAt(nx, ny);
    CHANNELS.forEach((channel, c) => {
      const a = channel(p);
      const b = channel(q);
      const s = sums[c];
      s.a += a;
      s.b += b;
      s.aa += a * a;
      s.bb += b * b;
      s.ab += a * b;
    });
    n.count++;
  }
  let ssim = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (const s of sums) {
    const meanA = s.a / n.count;
    const meanB = s.b / n.count;
    const varA = s.aa / n.count - meanA * meanA;
    const varB = s.bb / n.count - meanB * meanB;
    const cov = s.ab / n.count - meanA * meanB;
    ssim +=
      ((2 * meanA * meanB + C1) * (2 * cov + C2)) /
      ((meanA * meanA + meanB * meanB + C1) * (varA + varB + C2));
    varianceA += varA;
    varianceB += varB;
  }
  return { ssim: ssim / 3, varianceA, varianceB };
}

/**
 * Playwright's structural rule with this package's colour threshold: a changed pixel is noise
 * when neither image is flat around it and the two are structurally near-identical (SSIM) over a
 * wider window.
 */
export function structural({ flatRadius = 1, ssimRadius = 15, minSsim = 0.99 } = {}) {
  return (image, other, x, y) => {
    const near = windowStats(image, other, x, y, flatRadius);
    if (near.varianceA === 0 || near.varianceB === 0) return false;
    return windowStats(image, other, x, y, ssimRadius).ssim >= minSsim;
  };
}
