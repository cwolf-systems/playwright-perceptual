import { expect as base, test, type Page } from '@playwright/test';
import { perceptualMatchers, type RgbaImage } from '../../src/index.js';
import { NO_WEBGL, openFixture } from './fixtures.js';

const expect = base.extend(perceptualMatchers);

function filled(width: number, height: number, rgba: readonly number[]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { data, width, height };
}

/** Reads the WebGL canvas back, flipped so the first row is the top one. */
async function readTerrain(page: Page): Promise<RgbaImage> {
  const { data, width, height } = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const gl = canvas.getContext('webgl2')!;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { data: Array.from(pixels), width: canvas.width, height: canvas.height };
  });
  const rows = Array.from({ length: height }, (_, y) =>
    data.slice((height - 1 - y) * width * 4, (height - y) * width * 4),
  );
  return { data: Uint8Array.from(rows.flat()), width, height };
}

test('2D canvas pixels compare by perceived colour', async ({ page }) => {
  await page.setContent('<canvas width="16" height="16"></canvas>');
  const data = await page.evaluate(() => {
    const ctx = document.querySelector('canvas')!.getContext('2d')!;
    ctx.fillStyle = 'rgb(40, 90, 160)';
    ctx.fillRect(0, 0, 16, 16);
    return Array.from(ctx.getImageData(0, 0, 16, 16).data);
  });
  const actual = { data: Uint8Array.from(data), width: 16, height: 16 };
  expect(actual).toBePerceptuallyNear(filled(16, 16, [41, 90, 160, 255]));
  expect(actual).not.toBePerceptuallyNear(filled(16, 16, [200, 90, 160, 255]));
});

test('WebGL pixels read back from two renders agree', async ({ page }) => {
  test.skip(!(await openFixture(page, 'terrain')), NO_WEBGL);
  const first = await readTerrain(page);
  await openFixture(page, 'terrain');
  expect(await readTerrain(page)).toBePerceptuallyNear(first, { within: 0.999 });
});

test('within counts whole pixels: exactly 90% unchanged passes at 0.9', () => {
  const expected = filled(10, 1, [128, 128, 128, 255]);
  const actual = filled(10, 1, [128, 128, 128, 255]);
  actual.data.set([200, 40, 40, 255], 0);
  expect(actual).toBePerceptuallyNear(expected, { within: 0.9 });
  expect(actual).not.toBePerceptuallyNear(expected, { within: 0.91 });
});

test('images of different sizes fail with their sizes, rather than throwing', () => {
  const small = filled(8, 8, [128, 128, 128, 255]);
  const large = filled(16, 16, [128, 128, 128, 255]);
  expect(large).not.toBePerceptuallyNear(small);
  expect(() => {
    expect(large).toBePerceptuallyNear(small);
  }).toThrow(/Expected an image 8×8, got 16×16\./);
});
