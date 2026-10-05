import type { Page } from '@playwright/test';

export const fixture = (name: string, variant?: string): string => {
  const url = new URL(`fixtures/${name}.html`, import.meta.url);
  if (variant) url.searchParams.set('variant', variant);
  return url.href;
};

/** Fixture pages with a colour-only `subtle` variant, which should match. */
export const COLOUR_NOISE = ['effects', 'image', 'terrain', 'map', 'viewer'] as const;

/** Every fixture has `regression` and `faint` variants, which should not match. */
export const ALL_FIXTURES = [
  'text',
  'svg',
  'effects',
  'image',
  'chart',
  'terrain',
  'map',
  'viewer',
] as const;

/** Fixture pages drawn with WebGL 2. */
const WEBGL_FIXTURES: readonly string[] = ['terrain', 'viewer'];

/** Opens a fixture page; false where it needs WebGL 2 and the browser has none. */
export async function openFixture(page: Page, name: string, variant?: string): Promise<boolean> {
  await page.goto(fixture(name, variant));
  if (!WEBGL_FIXTURES.includes(name)) return true;
  const body = page.locator('body[data-webgl]');
  await body.waitFor({ state: 'attached' });
  return (await body.getAttribute('data-webgl')) === 'available';
}

export const NO_WEBGL = 'WebGL 2 is unavailable in this browser on this machine';
