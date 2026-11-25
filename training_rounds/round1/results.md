# Long-run results (test = 300 unseen seeds, best checkpoint chosen on 200 other seeds)

| Config | Runs | Test: random levels | Test: level-maker levels |
|---|---|---|---|
| random | 4 | 40.87 ± 2.69 | 18.77 ± 2.85 |
| mix50 | 4 | 31.70 ± 4.58 | 25.43 ± 7.34 |

| Run | Checkpoint | Selection score | Random | Maker |
|---|---|---|---|---|
| mix50_s0 | best.pt | 31.66 | 36.15 | 19.42 |
| mix50_s1 | iter_0370.pt | 33.34 | 31.1 | 36.42 |
| mix50_s2 | iter_0320.pt | 34.24 | 35.1 | 27.76 |
| mix50_s3 | best.pt | 21.0 | 24.47 | 18.13 |
| random_s0 | best.pt | 32.6 | 40.11 | 19.31 |
| random_s1 | iter_0220.pt | 35.52 | 45.06 | 22.52 |
| random_s2 | iter_0210.pt | 31.82 | 40.74 | 18.74 |
| random_s3 | best.pt | 27.28 | 37.57 | 14.5 |
