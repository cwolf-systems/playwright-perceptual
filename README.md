<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/cwolf-logo-light-text.svg">
    <img alt="CWOLFSYSTEMS" src="docs/assets/cwolf-logo-dark-text.svg" width="180">
  </picture>
</p>

# playwright-perceptual

[![CI](https://github.com/cwolf-systems/playwright-perceptual/actions/workflows/ci.yml/badge.svg)](https://github.com/cwolf-systems/playwright-perceptual/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-168-brightgreen)](https://github.com/cwolf-systems/playwright-perceptual/actions/workflows/ci.yml)

Screenshot and pixel assertions for Playwright that judge a change the way a person sees it: by
CIEDE2000 colour difference, where 1.0 is about the smallest difference anyone can notice.

Built for pages a GPU draws: maps, charts, 3D, canvas, gradients. Two machines render them a little
differently, so exact comparison fails on changes nobody can see, while Playwright's default
comparator passes changes people can. On 193 labelled pairs it caught all 48 faint regressions;
Playwright's default caught none. Baselines, update modes and the HTML report's image diff work as
they do for `toHaveScreenshot`.

> **Pre-release.** Nothing is published to npm yet.

## Quick start

```ts
import { expect as base, test } from '@playwright/test';
import { perceptualMatchers } from '@cwolf-systems/playwright-perceptual';

const expect = base.extend(perceptualMatchers);

test('terrain', async ({ page }) => {
  await page.goto('/map');
  await expect(page).toMatchPerceptually('terrain');
});
```

Pixels read back from a canvas compare the same way:
`expect(pixels).toBePerceptuallyNear(expected)`.

## Guarantees

- **Correct colour science.** CIEDE2000 matches all 34 of Sharma, Wu and Dalal's published test
  pairs to four decimal places.
- **Works like `toHaveScreenshot`.** Same baseline locations, the same behaviour in every
  `--update-snapshots` mode, screenshots retaken until stable, failures shown in the report's
  image diff.
- **Tested where it runs.** Chromium, Firefox and WebKit on Linux, macOS and Windows, and the
  oldest and newest Playwright it supports.
- **Replaceable parts.** The comparator, its colour difference, its noise detectors
  (anti-aliasing and sub-pixel shifts) and baseline storage can each be swapped.

## Learn more

- [Using the matchers](docs/guides/usage.md): options, update modes, tolerances.
- [Extending](docs/guides/extending.md): suite defaults, your own comparator or storage.
- [How it works](docs/concepts/how-it-works.md): the colour science, its limits, and references.
- [Accuracy](docs/benchmarks/accuracy.md): false failures and missed regressions, against
  pixelmatch, Playwright's experimental comparator and looks-same.
- [Speed](docs/benchmarks/speed.md): against pixelmatch and looks-same.
- [Roadmap](docs/roadmap.md): known gaps, gaps in the benchmark, and research to try next.
- [ARCHITECTURE.md](ARCHITECTURE.md).

## Development

Node 20 or later.

```bash
npm ci
npm run build
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run test:runner
npm run bench
npm run bench:accuracy
```

## Licence

Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). The CWOLFSYSTEMS name and logo are
not covered by the licence.
