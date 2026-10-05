# Architecture

Playwright assertions that compare screenshots and pixels by perceived colour difference. Plain
TypeScript, one runtime dependency (pngjs), Playwright as a peer.

## Layout

```
src/
  index.ts      the only entry point, and the public API
  errors.ts     PerceptualError and one subclass per failure
  defaults.ts   default options and their validation
  color/        packed RGB, sRGB to CIELAB, CIEDE2000
  image/        pixel access, PNG decoding, the anti-aliasing and shift detectors
  compare/      PerceptualComparator, its histogram and diff image
  snapshot/     the toHaveScreenshot workflow: capture until stable, update policy, storage,
                failure messages
  matchers/     the two matchers and the factory that builds them
```

Each folder keeps its shared types in its own `types.ts`, and `index.ts` re-exports the public
ones; there are no other barrels. Imports point up the list, from `matchers/` down to `color/`.
`color/` knows nothing of images, `compare/` nothing of Playwright, and `snapshot/` only sees an
`ImageComparator`, a `ScreenshotSource` and a `SnapshotStore`. Only `matchers/` imports
`@playwright/test` at runtime.

## Positions

**Small parts behind interfaces.** The comparator is an `ImageComparator`, which reports only a
size, a count of changed pixels and notes for the message; the perceptual one adds its ΔE
distribution. Inside it, the colour difference is a function, and each noise detector is a function
that reads pixels through the `Pixels` interface, never the internal `Raster`. Storage is a
`SnapshotStore`, screenshots come from a `ScreenshotSource`. Each can be replaced without touching
the rest, and each is tested on its own with in-memory stand-ins.

**The update policy is data.** What happens in each `--update-snapshots` mode, for each outcome,
is one table in `snapshot/policy.ts`, so it can be read and tested in one place. The workflow in
`snapshot/match.ts` classifies an outcome, looks it up and carries out the decision.

**Outcomes are unions.** A capture is matched, stable or unstable; a judgement is resized or
compared; an outcome is one of five situations. Switches over them are exhaustive, so a new case
fails to compile until it is handled everywhere.

**Errors are for misuse.** An invalid option, images of different sizes and an unreadable PNG
throw subclasses of `PerceptualError`. A failed comparison is an assertion result, never an error.

**The pixel loop is plain.** It runs once per pixel, millions of times a screenshot, so it uses
index loops, typed arrays and packed integers, compares pixels as 32-bit words first, and caches
CIELAB and ΔE by colour. Colour maths and the detectors allocate nothing per pixel. Elsewhere,
clarity wins over speed.

**Equations stay recognisable.** Constants are named and sit at the top of their module, with the
equation numbers of the paper they come from. CIEDE2000 follows Sharma, Wu and Dalal's three steps
in order, and is tested against all 34 of their published pairs.

**Strict TypeScript, ESM only.** `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes` and `verbatimModuleSyntax`; lint is typescript-eslint's
`strictTypeChecked`. Typed-array reads use `!` where the index is already in range.

## Testing

- `test/` (unit): colour science against published data, the detectors, the comparator, the
  policy table, the workflow with in-memory stores. Coverage is enforced.
- `test/browser/`: the matchers in Chromium, Firefox and WebKit, on fixture pages from text to
  WebGL terrain and GIS scenes. CI runs them on Linux, macOS and Windows, and on the oldest and
  newest supported Playwright.
- `test/runner/`: real Playwright runs in each `--update-snapshots` mode, checking exit codes,
  baselines on disk and report attachments.
- `bench/`: speed, and accuracy against other comparators on labelled pairs. Results are in
  `docs/benchmarks/`.
