"""Turn runs/ into the numbers, tables and figures for the report.

  python make_report.py                  # reads runs/, writes results/
  python make_report.py --test-episodes 200

Held-out test: each run's best.pt (chosen on the evaluation seeds 10000-10049 during training) is re-evaluated on
200 NEW seeds (20000-20199) that were never used for model selection. Baselines use the same test seeds.
Writes results/{summary.json, tables.md, final_eval.csv, learning_curves.csv, baselines.csv, *.png}.
"""
import argparse, csv, glob, io, json, os
from collections import Counter
import numpy as np
import torch
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from expo_sim import ExpoCrossySim, GRASS, ROAD, WATER_LILY, WATER_LOG
from dqn_agent import DQNAgent
from train_iterative import evaluate

LABEL = {"main": "Double DQN + look-ahead (ours)", "no_future": "no look-ahead (ablation)",
         "vanilla": "vanilla DQN (ablation)"}
COLOR = {"main": "#1b7f3b", "no_future": "#d9822b", "vanilla": "#3b6fd9", "random": "#888", "always_up": "#b04bd0",
         "reactive": "#c9a227"}
FUT = {"main": (0, 6, 12), "no_future": (0,), "vanilla": (0, 6, 12)}


def rollout_policy(policy, seeds, max_steps=1500):
    out = []
    for sd in seeds:
        env = ExpoCrossySim(sd)
        env.reset(); info = {"score": 0, "death": None}
        for _ in range(max_steps):
            _, _, done, info = env.step(policy(env))
            if done: break
        out.append((info["score"], info.get("death") or "timeout"))
    return out


def pol_random(env):
    return np.random.randint(0, 5)


def pol_up(env):
    return 1


def pol_reactive(env):
    """Hand-written, no learning: step up unless the next row's cars are about to hit us / no log is there."""
    r = env.row(env.z + 1)
    if r.kind == ROAD:
        danger = any(r.hit(env.x, env.frame + f) >= 0 for f in range(0, 14, 2))
        return 0 if danger else 1
    if r.kind == WATER_LOG:
        return 1 if r.hit(env.x, env.frame + 12) >= 0 else 0
    return 1


def stats(res):
    sc = np.array([r[0] for r in res], dtype=float)
    return dict(mean=float(sc.mean()), std=float(sc.std()), median=float(np.median(sc)), max=int(sc.max()),
                min=int(sc.min()), n=len(sc), deaths=dict(Counter(r[1] for r in res)))


def csv_text(rows):
    if not rows: return ""
    f = io.StringIO(); w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    return f.getvalue()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--runs", default="runs"); p.add_argument("--out", default="results")
    p.add_argument("--test-episodes", type=int, default=200)
    a = p.parse_args()
    os.makedirs(a.out, exist_ok=True)
    test_seeds = [20_000 + i for i in range(a.test_episodes)]

    runs = {}   # cfg -> {seed: dict}
    for d in sorted(glob.glob(os.path.join(a.runs, "*_s*"))):
        if not os.path.exists(os.path.join(d, "run.json")): continue
        cfg, seed = os.path.basename(d).rsplit("_s", 1)
        meta = json.load(open(os.path.join(d, "run.json")))
        its = list(csv.DictReader(open(os.path.join(d, "iterations.csv"))))
        agent = DQNAgent(ExpoCrossySim(0, future=FUT[cfg]).obs_size, 5, device="cpu")
        agent.load(os.path.join(d, "best.pt"))
        torch.set_num_threads(1)
        res = evaluate(agent, "expo", FUT[cfg], test_seeds)
        runs.setdefault(cfg, {})[int(seed)] = dict(meta=meta, its=its, test=stats(res), scores=[r[0] for r in res])
        print(cfg, seed, "test mean %.2f" % runs[cfg][int(seed)]["test"]["mean"], flush=True)

    np.random.seed(0)
    base = {"random": stats(rollout_policy(pol_random, test_seeds)),
            "always_up": stats(rollout_policy(pol_up, test_seeds)),
            "reactive": stats(rollout_policy(pol_reactive, test_seeds))}
    BLABEL = {"random": "random actions", "always_up": "always press UP", "reactive": "hand-written reactive rule"}

    # ---- CSVs
    final_rows, curve_rows = [], []
    for cfg, by in runs.items():
        for seed, r in sorted(by.items()):
            t = r["test"]
            final_rows.append(dict(config=cfg, seed=seed, test_mean=round(t["mean"], 3), test_std=round(t["std"], 3),
                                   test_median=t["median"], test_max=t["max"], episodes_trained=r["meta"]["episodes"],
                                   best_iteration=r["meta"]["best_iteration"], stop_reason=r["meta"]["stop_reason"],
                                   minutes=round(r["meta"]["seconds"] / 60, 1)))
            for it in r["its"]:
                curve_rows.append(dict(config=cfg, seed=seed, episodes=it["episodes"], eval_mean=it["eval_mean"],
                                       eval_max=it["eval_max"], train_mean=it["train_mean"], epsilon=it["epsilon"]))
    base_rows = [dict(policy=BLABEL[k], test_mean=round(v["mean"], 3), test_std=round(v["std"], 3),
                      test_median=v["median"], test_max=v["max"]) for k, v in base.items()]
    for name, rows in (("final_eval", final_rows), ("learning_curves", curve_rows), ("baselines", base_rows)):
        open(os.path.join(a.out, f"{name}.csv"), "w").write(csv_text(rows))

    # ---- aggregate per config (mean over seeds of the per-seed test mean)
    agg = {}
    for cfg, by in runs.items():
        m = np.array([r["test"]["mean"] for r in by.values()])
        allsc = np.concatenate([r["scores"] for r in by.values()])
        dc = Counter()
        for r in by.values(): dc.update(r["test"]["deaths"])
        tot = sum(dc.values())
        agg[cfg] = dict(label=LABEL[cfg], seeds=sorted(by), mean_of_seed_means=float(m.mean()),
                        std_across_seeds=float(m.std(ddof=1)) if len(m) > 1 else 0.0,
                        per_seed_means=[float(x) for x in m], best_seed_mean=float(m.max()),
                        pooled_median=float(np.median(allsc)), pooled_max=int(allsc.max()),
                        mean_episodes=float(np.mean([r["meta"]["episodes"] for r in by.values()])),
                        death_fractions={k: v / tot for k, v in dc.items()})

    # ---- figures
    fig, ax = plt.subplots(figsize=(7, 4.2))
    for cfg, by in runs.items():
        xs = sorted({int(it["episodes"]) for r in by.values() for it in r["its"]})
        mat = np.full((len(by), len(xs)), np.nan)
        for i, r in enumerate(by.values()):
            for it in r["its"]: mat[i, xs.index(int(it["episodes"]))] = float(it["eval_mean"])
        # runs that stopped early keep their last value (carried forward) so the mean isn't biased by dropouts
        for i in range(mat.shape[0]):
            for j in range(1, mat.shape[1]):
                if np.isnan(mat[i, j]): mat[i, j] = mat[i, j - 1]
        mu, sd = np.nanmean(mat, 0), np.nanstd(mat, 0)
        ax.plot(xs, mu, lw=2, color=COLOR[cfg], label=f"{LABEL[cfg]} (n={len(by)})")
        ax.fill_between(xs, mu - sd, mu + sd, color=COLOR[cfg], alpha=.18)
    ax.axhline(base["reactive"]["mean"], ls=":", color=COLOR["reactive"], label="hand-written rule")
    ax.axhline(base["random"]["mean"], ls=":", color=COLOR["random"], label="random")
    ax.set(xlabel="training episodes", ylabel="mean score (rows crossed), eval seeds",
           title="Learning curves (mean ± std over seeds)"); ax.legend(fontsize=8); ax.grid(alpha=.25)
    fig.tight_layout(); fig.savefig(os.path.join(a.out, "learning_curves.png"), dpi=150); plt.close(fig)

    fig, ax = plt.subplots(figsize=(7, 4.2))
    names, vals, errs, cols, pts = [], [], [], [], []
    for cfg in runs:
        names.append(LABEL[cfg].replace(" (", "\n(")); vals.append(agg[cfg]["mean_of_seed_means"])
        errs.append(agg[cfg]["std_across_seeds"]); cols.append(COLOR[cfg]); pts.append(agg[cfg]["per_seed_means"])
    for k, v in base.items():
        names.append(BLABEL[k].replace(" ", "\n", 1)); vals.append(v["mean"]); errs.append(0); cols.append(COLOR[k]); pts.append([])
    ax.bar(range(len(vals)), vals, yerr=errs, color=cols, capsize=4)
    for i, pp in enumerate(pts):
        ax.scatter([i] * len(pp), pp, color="k", s=14, zorder=3)
    ax.set_xticks(range(len(vals))); ax.set_xticklabels(names, fontsize=7)
    ax.set(ylabel=f"mean score on {a.test_episodes} held-out seeds", title="Held-out test score (dots = individual training seeds)")
    ax.grid(axis="y", alpha=.25); fig.tight_layout(); fig.savefig(os.path.join(a.out, "ablation_bar.png"), dpi=150); plt.close(fig)

    fig, ax = plt.subplots(figsize=(7, 4))
    causes = ["hit by car", "drowned", "off screen", "too slow", "fell behind", "timeout"]
    bottoms = np.zeros(len(runs))
    for c in causes:
        v = np.array([agg[cfg]["death_fractions"].get(c, 0) for cfg in runs])
        if v.sum() > 0:
            ax.bar([LABEL[c2].replace(" (", "\n(") for c2 in runs], v, bottom=bottoms, label=c); bottoms += v
    ax.set(ylabel="fraction of test episodes", title="How the agents die"); ax.legend(fontsize=8)
    ax.tick_params(axis="x", labelsize=7); fig.tight_layout(); fig.savefig(os.path.join(a.out, "death_causes.png"), dpi=150); plt.close(fig)

    fig, ax = plt.subplots(figsize=(7, 4))
    top = max(max(r["scores"]) for by in runs.values() for r in by.values())
    bins = np.arange(0, top + 4, 2)
    for cfg, by in runs.items():
        ax.hist(np.concatenate([r["scores"] for r in by.values()]), bins=bins, alpha=.45, color=COLOR[cfg],
                label=LABEL[cfg], density=True)
    ax.set(xlabel="score (rows crossed)", ylabel="density", title="Distribution of test scores"); ax.legend(fontsize=8)
    fig.tight_layout(); fig.savefig(os.path.join(a.out, "score_distribution.png"), dpi=150); plt.close(fig)

    # ---- markdown tables
    L = ["# Results (auto-generated by make_report.py)\n",
         f"Held-out test: {a.test_episodes} episodes on seeds 20000+ that were never used for model selection. "
         "Score = rows crossed. Training seeds are listed per row.\n",
         "## Ablation (mean ± std across training seeds of each seed's test mean)\n",
         "| Config | Seeds | Test score | Best seed | Pooled median | Pooled max | Episodes trained |", "|---|---|---|---|---|---|---|"]
    for cfg, g in agg.items():
        L.append(f"| {g['label']} | {len(g['seeds'])} | {g['mean_of_seed_means']:.2f} ± {g['std_across_seeds']:.2f} | "
                 f"{g['best_seed_mean']:.2f} | {g['pooled_median']:.0f} | {g['pooled_max']} | {g['mean_episodes']:.0f} |")
    L += ["\n## Baselines (no learning)\n", "| Policy | Mean | Std | Median | Max |", "|---|---|---|---|---|"]
    for k, v in base.items():
        L.append(f"| {BLABEL[k]} | {v['mean']:.2f} | {v['std']:.2f} | {v['median']:.0f} | {v['max']} |")
    L += ["\n## Per-run results\n", "| Config | Seed | Test mean | Test max | Episodes | Best iteration | Stopped because |", "|---|---|---|---|---|---|---|"]
    for r in final_rows:
        L.append(f"| {r['config']} | {r['seed']} | {r['test_mean']:.2f} | {r['test_max']} | {r['episodes_trained']} | {r['best_iteration']} | {r['stop_reason']} |")
    L += ["\n## Death causes (fraction of test episodes)\n", "| Config | " + " | ".join(causes) + " |", "|---|" + "---|" * len(causes)]
    for cfg, g in agg.items():
        L.append(f"| {g['label']} | " + " | ".join(f"{100*g['death_fractions'].get(c,0):.0f}%" for c in causes) + " |")
    open(os.path.join(a.out, "tables.md"), "w").write("\n".join(L) + "\n")

    csvs = {n: open(os.path.join(a.out, f"{n}.csv")).read() for n in ("final_eval", "learning_curves", "baselines")}
    summary = dict(test_episodes=a.test_episodes, configs=agg, baselines=base, baseline_labels=BLABEL,
                   figures=["learning_curves", "ablation_bar", "death_causes", "score_distribution"],
                   csv=csvs, tables_md="\n".join(L))
    json.dump(summary, open(os.path.join(a.out, "summary.json"), "w"), indent=1)
    # bundle the results into the app so the Settings screen shows them (then rebuild the app)
    app_dir = os.path.join("expo-game", "assets", "report")
    if os.path.isdir(app_dir):
        import shutil
        for n in summary["figures"]:
            shutil.copy(os.path.join(a.out, f"{n}.png"), os.path.join(app_dir, f"{n}.png"))
        shutil.copy(os.path.join(a.out, "summary.json"), os.path.join(app_dir, "summary.json"))
        print("copied results into", app_dir)
    print("wrote", a.out)


if __name__ == "__main__":
    main()
