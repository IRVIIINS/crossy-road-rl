"""Run the ablation study: every config x every seed, a few in parallel. Resumable (skips finished runs).

  python run_experiments.py --seeds 0 1 2 --workers 2
  python make_report.py            # then build tables / plots / results.json from runs/

Configs:  main       Double DQN + future-occupancy look-ahead  (the model we ship)
          no_future  Double DQN, observation only shows the present (ablation of the look-ahead features)
          vanilla    plain DQN target + look-ahead             (ablation of Double DQN)
"""
import argparse, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

CONFIGS = {"main": [], "no_future": ["--no-future"], "vanilla": ["--vanilla"]}

p = argparse.ArgumentParser()
p.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2])
p.add_argument("--configs", nargs="+", default=list(CONFIGS))
p.add_argument("--workers", type=int, default=2)
p.add_argument("--runs-dir", default="runs")
p.add_argument("--extra", nargs=argparse.REMAINDER, default=[], help="extra args passed to train_iterative.py")
a = p.parse_args()
# Early stopping is OFF in the ablation (patience 999) so every config gets exactly the same budget
# (max-iters x 200 episodes); a late-starting run must not be cut short and look worse than it is.
a.extra = ["--patience", "999"] + a.extra


def job(cs):
    cfg, seed = cs
    out = os.path.join(a.runs_dir, f"{cfg}_s{seed}")
    if os.path.exists(os.path.join(out, "run.json")):
        print("skip", out, flush=True); return
    cmd = [sys.executable, "train_iterative.py", "--env", "expo", "--out", out, "--seed", str(seed)] + CONFIGS[cfg] + a.extra
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "log.txt"), "w") as log:
        subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, check=False)
    print("finished", out, flush=True)

jobs = [(c, s) for s in a.seeds for c in a.configs]     # seed-major so complete seeds finish first
with ThreadPoolExecutor(a.workers) as ex:
    list(ex.map(job, jobs))
