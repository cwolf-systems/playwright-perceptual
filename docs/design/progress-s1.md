# S1 progress checkpoint (working file; dropped from the final branch)

## Design at 8dac48b

D's box rule with a 65×65 box (slack 0.75 / px) and the 5×5 box (1.25 / px), one summed-area
table per tile for every box, the pixel test widened by the quadrant's range only beside a
neighbour that kept its colour (within a level), A's integer-brightness anti-aliasing asked once
for both ways.

Judge (redesign/judge-margin 62569c4, skip-speed): 0 / 0 lost, 11 / 4 gained, wrong 42 / 24;
opacity 93.6 / 82.7 %; drift 100 %; slivers 1 px; edge sides changed 9 of 27 counted (as 0.1.0);
ground beside an edge 0 of 44 (limit, as 0.1.0 and PR #1); margin worst 34.4 % (PR #1 45.3 %);
src/image code 209.

Sensitivity (each constant alone, others at the design values):
- 65×65 slack 0.75: 0.5625 loses 1 verdict (2× GPU vs software terrain); 0.6, 0.675, 0.825, 0.9
  lose none; real opacity 87.9 → 78.6 % across that range.
- 5×5 slack 1.25: 1.0 to 1.5 lose none; margin 73.0 % at 1.0, 46.1 % at 1.125, 34.4 % above.
- widen 1: 0.8 to 1.2 lose none; gains 10 / 4 to 13 / 4; margin 34.4 % throughout.
- kept tolerance 1 level: 0, 2, 3 lose none; margin 33.2 / 56.2 / 45.3 %.

Soundness: box rules refuse 0 of 400,000 random bilinear moves; full isShifted refuses most moves
of random noise (1,465 of 2,000), since noise keeps no neighbour's colour.

Measured and dropped: adapted shared-offset solver (+70 lines; fixes C's 11×11 fixtures but not
the judge's adapted pairs; 1 lost); with 5×5 corner placements (4 / 5 lost); hull caps (5×5:
7 / 9 gained, margin 90.2 %; 7×7: 8 / 11, margin 95.3 %); lazy per-box filtering.

## Next

Full judge with speed at the head; design log, how-it-works, benchmarks, CHANGELOG; gates; push;
CI 9 jobs.
