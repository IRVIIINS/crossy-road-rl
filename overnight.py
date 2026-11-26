"""Long unattended experiment: does MUCH longer training, and training on level-maker levels, make the player AI better?

  python overnight.py --hours 36 --workers 4

Jobs: config "random" (all training episodes on the original random levels) and "mix50" (half on level-maker levels), each with
several seeds, 150k episodes max. Workers run at low priority. Safe to interrupt: re-run the same command and it resumes
(the 36 h budget counts from the first start). Create the file long_run/STOP (or press Ctrl+C once) to stop early; results so far are used.
At the end it (1) picks each run's best checkpoint on FRESH seeds, (2) tests it on 300 more unseen seeds, (3) trains a new level maker
against the best new player and (4) writes long_run/results.md, results.csv and models/expo_best_long.pt.
"""
import argparse, csv, glob, json, os, shutil, subprocess, sys, time
import numpy as np

try: sys.stdout.reconfigure(encoding="utf-8")   # Windows consoles default to cp1252 (the results use "±")
except Exception: pass

PY = sys.executable
CONFIGS = {"random": 0.0, "mix50": 0.5}


def lowprio():
    if os.name == "nt":
        return dict(creationflags=0x00004000 | 0x08000000)       # BELOW_NORMAL_PRIORITY_CLASS | CREATE_NO_WINDOW
    return dict(preexec_fn=lambda: os.nice(10))


def job_state(d):
    if os.path.exists(os.path.join(d, "done.json")): return "done"
    return "todo"


def run_jobs(a, deadline):
    jobs = []
    for s in range(a.seeds):
        for name, mix in CONFIGS.items():
            if name not in a.configs.split(","): continue
            jobs.append((f"{name}_s{s}", name, mix, s))
    running, failures, last_status = {}, {}, 0
    margin = min(600, max(5, (deadline - time.time()) * 0.1))   # stop jobs a little before the deadline so they can save
    stop_file = os.path.join(a.out, "STOP")
    per_job_h = max(1.0, (deadline - time.time()) / 3600 * a.workers / len(jobs) * 1.15)
    pending = [j for j in jobs if job_state(os.path.join(a.out, j[0])) != "done"]
    print(f"{len(pending)} jobs to run, {a.workers} at a time, up to {per_job_h:.1f} h each", flush=True)
    try:
        while pending or running:
            for jid, (proc, _) in list(running.items()):
                if proc.poll() is not None:
                    del running[jid]
                    d = os.path.join(a.out, jid)
                    if job_state(d) != "done" and not os.path.exists(stop_file) and time.time() < deadline:
                        failures[jid] = failures.get(jid, 0) + 1
                        if failures[jid] <= 3:
                            print(f"{jid} exited early (code {proc.returncode}), restarting ({failures[jid]}/3)", flush=True)
                            pending.insert(0, next(j for j in jobs if j[0] == jid))
            stopping = os.path.exists(stop_file) or time.time() > deadline - margin
            if stopping and not os.path.exists(stop_file):
                open(stop_file, "w").write("deadline")
            while pending and len(running) < a.workers and not stopping:
                jid, name, mix, s = pending.pop(0)
                d = os.path.join(a.out, jid)
                cmd = [PY, "train_long.py", "--out", d, "--seed", str(s), "--maker-mix", str(mix), "--maker", a.maker,
                       "--episodes", str(a.episodes), "--episodes-per-iter", str(a.episodes_per_iter),
                       "--eval-episodes", str(a.eval_episodes), "--deadline", str(min(deadline, time.time() + per_job_h * 3600)), "--device", a.device,
                       "--lr", str(a.lr), "--lr-final", str(a.lr_final), "--eps-start", str(a.eps_start)] + (["--init", a.init] if a.init else [])
                os.makedirs(d, exist_ok=True)
                log = open(os.path.join(d, "log.txt"), "a")
                running[jid] = (subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, **lowprio()), log)
                print(time.strftime("%H:%M"), "started", jid, flush=True)
            if time.time() - last_status > 600:
                last_status = time.time()
                lines = []
                for jid in sorted(running):
                    try: lines.append(open(os.path.join(a.out, jid, "log.txt")).read().strip().splitlines()[-1])
                    except Exception: pass
                open(os.path.join(a.out, "status.txt"), "w", encoding="utf-8").write(time.strftime("%Y-%m-%d %H:%M") + "\n" + "\n".join(lines) + "\n")
                print(time.strftime("%H:%M"), "running:", len(running), "pending:", len(pending), flush=True)
            if stopping and not running:
                break
            time.sleep(15)
    except KeyboardInterrupt:
        print("Ctrl+C: asking jobs to stop (they save and can be resumed)...", flush=True)
        open(stop_file, "w").write("ctrl-c")
        for proc, _ in running.values():
            try: proc.wait(timeout=600)
            except Exception: proc.kill()


def finalize_job(args):
    """pick the best checkpoint of one run on fresh seeds, then test it on unseen seeds."""
    d, maker_path, n_sel, n_test = args
    import torch
    from expo_sim import ExpoCrossySim
    from dqn_agent import DQNAgent
    from level_maker import LevelMaker
    from train_long import evaluate
    torch.set_num_threads(1)
    maker = LevelMaker.load(maker_path).net
    sel_seeds, test_seeds = [40_000 + i for i in range(n_sel)], [20_000 + i for i in range(n_test)]
    cks = sorted(glob.glob(os.path.join(d, "checkpoints", "iter_*.pt")))
    cks = cks[len(cks) * 3 // 5:] + [p for p in (os.path.join(d, "best.pt"), os.path.join(d, "final.pt")) if os.path.exists(p)]
    if not cks: return None
    best = None
    for p in cks:
        ag = DQNAgent(ExpoCrossySim(0).obs_size, 5, device="cpu"); ag.load(p)
        sc = 0.5 * (evaluate(ag, sel_seeds, None) + evaluate(ag, sel_seeds, maker))
        if best is None or sc > best[0]: best = (sc, p)
    ag = DQNAgent(ExpoCrossySim(0).obs_size, 5, device="cpu"); ag.load(best[1])
    shutil.copy(best[1], os.path.join(d, "selected.pt"))
    return dict(job=os.path.basename(d), checkpoint=os.path.basename(best[1]), selection_score=round(best[0], 2),
                test_random=round(evaluate(ag, test_seeds, None), 2), test_maker=round(evaluate(ag, test_seeds, maker), 2))


def finalize(a):
    from multiprocessing import Pool
    dirs = [d for d in sorted(glob.glob(os.path.join(a.out, "*_s[0-9]*"))) if os.path.isdir(d)]
    print("selecting checkpoints on fresh seeds and testing...", flush=True)
    with Pool(max(1, a.workers)) as pool:
        res = [r for r in pool.map(finalize_job, [(d, a.maker, 200, 300) for d in dirs]) if r]
    with open(os.path.join(a.out, "results.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(res[0])); w.writeheader(); w.writerows(res)
    lines = ["# Long-run results (test = 300 unseen seeds, best checkpoint chosen on 200 other seeds)\n",
             "| Config | Runs | Test: random levels | Test: level-maker levels |", "|---|---|---|---|"]
    for name in CONFIGS:
        rr = [r for r in res if r["job"].startswith(name + "_")]
        if rr:
            ms = lambda k: f"{np.mean([r[k] for r in rr]):.2f} ± {np.std([r[k] for r in rr]):.2f}"
            lines.append(f"| {name} | {len(rr)} | {ms('test_random')} | {ms('test_maker')} |")
    lines += ["", "| Run | Checkpoint | Selection score | Random | Maker |", "|---|---|---|---|---|"]
    lines += [f"| {r['job']} | {r['checkpoint']} | {r['selection_score']} | {r['test_random']} | {r['test_maker']} |" for r in res]
    open(os.path.join(a.out, "results.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print("\n".join(lines), flush=True)
    top = max(res, key=lambda r: r["selection_score"])
    os.makedirs("models", exist_ok=True)
    shutil.copy(os.path.join(a.out, top["job"], "selected.pt"), "models/expo_best_long.pt")
    print("best run:", top["job"], "-> models/expo_best_long.pt", flush=True)
    return top


def cotrain(a, top):
    """train a new level maker against the new best player, then cross-evaluate."""
    out = os.path.join(a.out, "maker_vs_new_player")
    if not os.path.exists(os.path.join(out, "best.pt")):
        subprocess.run([PY, "train_level_maker.py", "--player", "models/expo_best_long.pt", "--episodes", "6000",
                        "--out", out, "--seed", "0"], check=False, **lowprio())
    import torch
    from expo_sim import ExpoCrossySim
    from dqn_agent import DQNAgent
    from level_maker import LevelMaker
    from train_long import evaluate
    torch.set_num_threads(1)
    seeds = [20_000 + i for i in range(300)]
    makers = {"original level maker": LevelMaker.load(a.maker).net}
    if os.path.exists(os.path.join(out, "best.pt")): makers["level maker retrained against the new player"] = LevelMaker.load(os.path.join(out, "best.pt")).net
    players = {"previous shipped player": "models/expo_best.pt"}
    if a.init: players["starting player (before fine-tuning)"] = a.init
    players["new long-run player"] = "models/expo_best_long.pt"
    lines = ["# Cross-evaluation (300 unseen seeds, rows crossed)\n", "| Player | random levels | " + " | ".join(makers) + " |", "|---|---|" + "---|" * len(makers)]
    for pn, pp in players.items():
        ag = DQNAgent(ExpoCrossySim(0).obs_size, 5, device="cpu"); ag.load(pp)
        row = [f"{evaluate(ag, seeds, None):.2f}"] + [f"{evaluate(ag, seeds, m):.2f}" for m in makers.values()]
        lines.append(f"| {pn} | " + " | ".join(row) + " |")
    open(os.path.join(a.out, "cross_eval.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print("\n".join(lines), flush=True)


def bundle(a):
    """small zip with everything needed to look at the results (no big checkpoints)."""
    import zipfile
    zp = os.path.join(a.out, "results_bundle.zip")
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
        for pat in ("results.md", "results.csv", "cross_eval.md", "status.txt", "started_at.txt", "*/iterations.csv", "*/selected.pt",
                    "*/done.json", "*/stopped.json", "*/log.txt", "maker_vs_new_player/best.pt", "maker_vs_new_player/training_log.csv"):
            for f in glob.glob(os.path.join(a.out, pat)): z.write(f, os.path.relpath(f, a.out))
        if os.path.exists("models/expo_best_long.pt"): z.write("models/expo_best_long.pt", "expo_best_long.pt")
    print("results bundle:", os.path.abspath(zp), f"({os.path.getsize(zp)/1e6:.1f} MB)", flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--hours", type=float, default=36.0)
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--seeds", type=int, default=4)
    p.add_argument("--episodes", type=int, default=150_000)
    p.add_argument("--episodes-per-iter", type=int, default=200)
    p.add_argument("--eval-episodes", type=int, default=100)
    p.add_argument("--reserve-hours", type=float, default=1.5, help="time kept at the end for selection, testing and the level-maker retrain")
    p.add_argument("--maker", default="lm_runs/s0/best.pt")
    p.add_argument("--out", default="long_run")
    p.add_argument("--no-cotrain", action="store_true")
    p.add_argument("--configs", default="random,mix50", help="comma list of configs to run: random, mix50")
    p.add_argument("--init", default="", help="start every job from this player (.pt) instead of from scratch (fine-tuning)")
    p.add_argument("--eps-start", type=float, default=1.0, help="starting exploration; use ~0.1 with --init")
    p.add_argument("--lr", type=float, default=5e-4)
    p.add_argument("--lr-final", type=float, default=1e-4)
    p.add_argument("--device", default="cpu", help="cpu or cuda: where each worker trains its network (run bench_device.py to see which is faster)")
    a = p.parse_args()
    os.makedirs(a.out, exist_ok=True)
    started = os.path.join(a.out, "started_at.txt")
    if not os.path.exists(started): open(started, "w").write(str(time.time()))
    t_start = float(open(started).read())
    deadline = t_start + a.hours * 3600 - a.reserve_hours * 3600
    print(f"started {time.ctime(t_start)}; training stops {time.ctime(deadline)}; everything done by {time.ctime(t_start + a.hours * 3600)}", flush=True)
    if os.path.exists(os.path.join(a.out, "STOP")) and time.time() < deadline:
        os.remove(os.path.join(a.out, "STOP"))
    run_jobs(a, deadline)
    top = finalize(a)
    if not a.no_cotrain: cotrain(a, top)
    bundle(a)
    print("ALL DONE", flush=True)
