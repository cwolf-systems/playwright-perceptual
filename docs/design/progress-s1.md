# S1 progress checkpoint (working file; may be dropped from the final branch)

## Done

- 725ec11: approach D brought in unchanged (tree identical to origin/redesign/d-boxfilter 269abc8).
  Judge (skip-speed): 0 lost, 1 gained; opacity 76.5 / 77.2 %; drift 3.6 %; slivers 1 px;
  src/image code 195.
- 08c5352: third box, 65×65, slack 0.75 level per pixel, totals Uint32, tiles 256 rows.
  Judge: 0 lost, 1 gained; opacity 94.2 / 86.1 %; drift 100 %; slivers 1 px; code 198.
  Speed (full judge): bench 100 % 0.66× / 0.72× / 0.67× of 0.1.0; drift 0.58×; real whole frame
  0.90× (398.9 vs 443.9 ms); real grain 123.9 ms (0.49×); 1280×720 1 % 17.1 ms (0.1.0 11).
  Worst should-match margin among passing pairs: 73 % (2× GPU vs software effects, 187 / 256).
- Slack sweep for the 65 box: 0.5 loses 2 verdicts (GPU vs software terrain, effects);
  0.625 → 96.3 / 89.2 %, 0 lost; 0.75 → 94.2 / 86.1 %, 0 lost; 0.875 → 91.5 / 83.1 %;
  1.0 → 88.4 / 81.8 %. Kept 0.75 for room above the cliff.
- Tried and dropped: lazy per-box filtering (−4 ms on small changes, +14 ms whole frame);
  box orders 1-5-65 and 5-1-65 (drift 590 ms against 350).

- 0edea24: pixel test widened by the quadrant's range (B's idea as a term of the box rule;
  B's separate 3×3 range function was 214 lines in all, 19 / 16 gained). Widen 0.5 → 16 / 16
  gained; widen 1 → 22 / 17 gained, 0 lost, residuals unchanged (94.2 / 86.1 %, drift 100 %).
  Code 199. Margin: worst passing 80.9 % (a pair PR #1 failed), worst among PR #1-correct
  pairs 73.0 % (2× GPU vs software effects), median of non-zero 13.3 % (D: 63.5 %).
  Finding 2's label test now asserts a pass with no allowance, as B's branch does.
- Note: the session scratchpad was wiped once; the 0.1.0 build for speed must be rebuilt.

- 49e4a24: slacks 5×5 1.25, 65×65 0.625. 0 lost, wrong 29 / 10, opacity 96.1 / 87.0 %.
  Full judge (before the AA change): whole-frame cases 0.60–0.98× 0.1.0.
- db7b734: A's either-way anti-aliasing (whole frame ~410 → ~345 ms in probes); 215 lines.
- 59743a9: one summed-area table per tile serves every box: 202 lines; whole ~370 ms, grain 84.
  Margin (worst, allowance ≥ 10 px): 75.4 % (recipe 87.1 %). Coordinator: keep this design.
- Tests added (uncommitted): 65×65 drift, 16-bit overflow (fails with Uint16), random
  bilinear moves. Random moves: the box rules refuse 0 of 2,000; the pixel test's reverse
  direction refuses 121 (widen 1.5: 39, 2: 17, 3: 9): not sound by construction.

## Next (coordinator, latest)

1. C's two shift tests (textured ground beside an edge; edge pixel whose sides changed):
   run; if failing, try one consistent move across channels; port both as regression tests.
2. Lighter anti-aliasing (integer brightness, direct loops, no either-way) vs mine.
3. Sensitivity of 5×5 slack, 65×65 slack, widen at ±10 / ±20 %; distance to a lost verdict.
4. Soundness test: export the box part (conserved) and test it; note the pixel test's limit.
5. Docs, gates, push, full judge with speed, CI 9 jobs.

