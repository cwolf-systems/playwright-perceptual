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

## Next

1. Look for margin on the effects pair within the 5 spare lines.
2. Unit, lint, typecheck, coverage, browser, runner, test:count gates.
3. Full judge at the head (and the margin branch if it exists), docs, CHANGELOG, push, CI.

## Open questions

- Whether the ablation analyst's recipe changes the slack or the pixel test.
- The anti-aliasing early exit from A costs about 15 lines; whole frame is already 0.90×.
