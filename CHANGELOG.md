# Changelog

## Unreleased

- Shift tolerance no longer takes a change of colour over an area for a move. A pixel counts as
  shifted only if the colour in the 5×5 window around it is conserved, as a move of under a pixel
  conserves it, give or take a level per pixel for rounding. A translucent overlay made a little
  stronger or weaker over textured ground used to pass as shifts and anti-aliasing; it now fails.
  Renders whose colour drifts by two levels or more over an area between runs now fail too.
- Anti-aliasing detection asks that the flat area beside a slope keep its colour, give or take a
  level. A uniform change of colour no longer passes there as anti-aliasing.
- Rounding is its own class: a pixel past `maxDeltaE` whose channels each differ by at most one
  level is skipped, counted in `rounded`, noted in the failure message and painted green in the
  diff image. `ignoreRounding: false` counts such pixels. Before, they passed only when shift
  tolerance took them for a move.
- The accuracy benchmark has a synthetic set reproducing four findings from a renderer's tests,
  and reports it pair by pair.
- Source maps carry the TypeScript sources, so stack traces and debuggers show them.
- The matchers' types are exported: `PerceptualMatchers`, `ToMatchPerceptually` and
  `ToBePerceptuallyNear`.

## 0.1.0

First release.

- `toMatchPerceptually`: screenshot assertions judged by CIEDE2000 colour difference, with
  `toHaveScreenshot`'s baselines, update modes, stable-screenshot loop and report attachments.
- `toBePerceptuallyNear`: the same comparison for pixels read back from a canvas.
- Anti-aliasing and sub-pixel shift tolerance, each replaceable or switchable off.
- Speed and accuracy benchmarks against pixelmatch, Playwright's experimental comparator and
  looks-same.
