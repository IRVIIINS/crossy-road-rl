# Block analysis

| Block | runs | sim test random (mean ± std over runs) | sim test maker | eval peak at | peak → end | 2nd half − 1st half | runs peaking in 1st half | peak optimism |
|---|---|---|---|---|---|---|---|---|
| round1 | 8 | 36.29 ± 6.34 | 22.10 ± 6.94 | 71% of training | 10.2 | +8.1 | 3/8 | 1.8 |
| round2 | 14 | 41.61 ± 7.22 | 23.64 ± 8.20 | 68% of training | 10.6 | +6.0 | 4/14 | 2.5 |
| round3 | 14 | 55.49 ± 4.01 | 31.81 ± 2.71 | 84% of training | 8.6 | +6.4 | 0/14 | 5.2 |
| round4 | 14 | 57.45 ± 3.28 | 30.86 ± 4.92 | 38% of training | 13.3 | -0.4 | 9/14 | 7.2 |
| round5 | 14 | 57.69 ± 2.55 | 32.87 ± 5.45 | 57% of training | 11.6 | +0.4 | 5/14 | 6.6 |

Pairwise Welch p-values on per-run simulator test scores (random levels):

- round1-round2: diff +5.32, p = 0.090
- round1-round3: diff +19.20, p = 0.000
- round1-round4: diff +21.17, p = 0.000
- round1-round5: diff +21.40, p = 0.000
- round2-round3: diff +13.88, p = 0.000
- round2-round4: diff +15.84, p = 0.000
- round2-round5: diff +16.07, p = 0.000
- round3-round4: diff +1.96, p = 0.169
- round3-round5: diff +2.20, p = 0.098
- round4-round5: diff +0.23, p = 0.836
