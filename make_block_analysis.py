"""Block analysis for the Settings screen and the report.

Reads training_rounds/round*/ (results.md, iterations.csv), results/real_game_blocks.json and writes
  results/block_analysis.json  and  expo-game/assets/report/block_analysis.json   (bundled into the app)
  results/block_analysis.md                                                       (tables for the report)

  python make_block_analysis.py
"""
import csv, glob, json, math, os, re
import numpy as np
from scipy import stats

ROOT = os.path.dirname(os.path.abspath(__file__))
ROUNDS = [f"round{i}" for i in range(1, 6)]


def run_tests(r):
    """per-run test scores (random levels, maker levels) from results.md: rows `| run | ckpt | selection | random | maker |`"""
    out = {}
    for line in open(os.path.join(ROOT, "training_rounds", r, "results.md"), encoding="utf-8"):
        c = [x.strip() for x in line.strip().strip("|").split("|")]
        if len(c) == 5 and re.match(r"^[a-z0-9]+_s\d+$", c[0]):
            out[c[0]] = dict(ckpt=c[1], sel=float(c[2]), random=float(c[3]), maker=float(c[4]))
    return out


def curves(r):
    runs = {}
    for f in sorted(glob.glob(os.path.join(ROOT, "training_rounds", r, "*", "iterations.csv"))):
        d = list(csv.DictReader(open(f)))
        if len(d) >= 10:
            runs[os.path.basename(os.path.dirname(f))] = d
    return runs


def welch(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    t, p = stats.ttest_ind(a, b, equal_var=False)
    return float(p)


def pool(samples):
    """combine (games, mean, std) samples into one (n, mean, std)"""
    n = sum(x["games"] for x in samples)
    mean = sum(x["games"] * x["mean"] for x in samples) / n
    ss = sum((x["games"] - 1) * x["std"] ** 2 + x["games"] * (x["mean"] - mean) ** 2 for x in samples)
    return n, mean, math.sqrt(ss / (n - 1))


def real_game_summary(samples):
    """per block: pooled real-game score on original and level-maker levels, a rank (mean of the two), and who is statistically tied"""
    res = {}
    for blk in sorted({x["block"] for x in samples}):
        res[blk] = {}
        for lv in ("original", "maker"):
            ss = [x for x in samples if x["block"] == blk and x["levels"] == lv and x["games"] > 1]
            if ss:
                n, m, sd = pool(ss)
                res[blk][lv] = dict(games=n, mean=round(m, 2), std=round(sd, 2), sem=round(sd / math.sqrt(n), 2),
                                    median=float(np.median([x["median"] for x in ss])), max=max(x["max"] for x in ss))
    ranked = sorted([b for b in res if "original" in res[b] and "maker" in res[b]],
                    key=lambda b: (res[b]["original"]["mean"] + res[b]["maker"]["mean"]) / 2)
    for i, b in enumerate(ranked):
        res[b]["score"] = round((res[b]["original"]["mean"] + res[b]["maker"]["mean"]) / 2, 2)
        res[b]["rank_from_worst"] = i + 1
    # Welch t-test from summary statistics: is each block different from the best one, per level kind?
    best = ranked[-1]
    for b in ranked:
        for lv in ("original", "maker"):
            a_, c_ = res[b][lv], res[best][lv]
            if b != best:
                p = stats.ttest_ind_from_stats(a_["mean"], a_["std"], a_["games"], c_["mean"], c_["std"], c_["games"], equal_var=False).pvalue
                res[b][lv]["p_vs_best"] = round(float(p), 4)
    return dict(blocks=res, order_worst_to_best=ranked, best=best, worst=ranked[0])


def main():
    out = {"rounds": {}, "pairwise_sim_random": {}, "pairwise_sim_maker": {}}
    tests = {r: run_tests(r) for r in ROUNDS}
    for r in ROUNDS:
        t = tests[r]
        rows = curves(r)
        # only the runs of the config that was actually trained in this round (random / mix50 mixed in rounds 1-2)
        peak_frac, peak, last10, first_half, second_half, sel_gap = [], [], [], [], [], []
        mean_curve = None
        grid = np.linspace(0, 1, 26)
        acc_r, acc_m = [], []
        for job, d in rows.items():
            e = np.array([float(x["eval_both"]) for x in d])
            er = np.array([float(x["eval_random"]) for x in d])
            em = np.array([float(x["eval_maker"]) for x in d])
            n = len(e); k = int(e.argmax())
            peak_frac.append((k + 1) / n); peak.append(e[k]); last10.append(e[-10:].mean())
            first_half.append(e[: n // 2].mean()); second_half.append(e[n // 2:].mean())
            x = np.linspace(0, 1, n)
            acc_r.append(np.interp(grid, x, er)); acc_m.append(np.interp(grid, x, em))
            if job in t:   # optimism of picking the best of ~260 noisy evals on the same 100 seeds: peak vs held-out selection score
                sel_gap.append(e[k] - t[job]["sel"])
        rr = [v["random"] for v in t.values()]; mm = [v["maker"] for v in t.values()]
        # the block's chosen player: best selection score (= what results.md calls the winner)
        win = max(t.items(), key=lambda kv: kv[1]["sel"])
        out["rounds"][r] = dict(
            runs=len(t), curve_runs=len(rows),
            test_random_mean=float(np.mean(rr)), test_random_std=float(np.std(rr, ddof=1)),
            test_maker_mean=float(np.mean(mm)), test_maker_std=float(np.std(mm, ddof=1)),
            test_random_best=float(max(rr)), test_random_worst=float(min(rr)),
            winner=dict(job=win[0], checkpoint=win[1]["ckpt"], random=win[1]["random"], maker=win[1]["maker"]),
            peak_iteration_frac=float(np.mean(peak_frac)), peak_eval=float(np.mean(peak)), last10_eval=float(np.mean(last10)),
            decline_peak_to_end=float(np.mean(np.array(peak) - np.array(last10))),
            second_half_minus_first_half=float(np.mean(np.array(second_half) - np.array(first_half))),
            runs_peaking_in_first_half=int(sum(1 for f in peak_frac if f < 0.5)),
            eval_peak_optimism=float(np.mean(sel_gap)) if sel_gap else None,
            mean_curve=dict(x=[round(float(v), 3) for v in grid], random=[round(float(v), 2) for v in np.mean(acc_r, 0)],
                            maker=[round(float(v), 2) for v in np.mean(acc_m, 0)]) if acc_r else None,
        )
    # pairwise Welch t-test on the per-run test scores (14 runs per round, same 300 unseen seeds for every run)
    for key in ("random", "maker"):
        for i, a in enumerate(ROUNDS):
            for b in ROUNDS[i + 1:]:
                va = [v[key] for v in tests[a].values()]; vb = [v[key] for v in tests[b].values()]
                out[f"pairwise_sim_{key}"][f"{a}-{b}"] = dict(diff=float(np.mean(vb) - np.mean(va)), p=welch(va, vb))
    # real game (headless harness), if available
    rg_path = os.path.join(ROOT, "results", "real_game_blocks.json")
    if os.path.exists(rg_path):
        raw = json.load(open(rg_path))
        out["real_game"] = real_game_summary(raw["samples"])
        out["real_game"]["previous_shipped_player"] = raw.get("previous_shipped_player")
    os.makedirs(os.path.join(ROOT, "results"), exist_ok=True)
    json.dump(out, open(os.path.join(ROOT, "results", "block_analysis.json"), "w"), indent=1)
    json.dump(out, open(os.path.join(ROOT, "expo-game", "assets", "report", "block_analysis.json"), "w"), separators=(",", ":"))

    md = ["# Block analysis", "",
          "| Block | runs | sim test random (mean ± std over runs) | sim test maker | eval peak at | peak → end | 2nd half − 1st half | runs peaking in 1st half | peak optimism |",
          "|---|---|---|---|---|---|---|---|---|"]
    for r in ROUNDS:
        x = out["rounds"][r]
        md.append(f"| {r} | {x['runs']} | {x['test_random_mean']:.2f} ± {x['test_random_std']:.2f} | {x['test_maker_mean']:.2f} ± {x['test_maker_std']:.2f} | "
                  f"{100 * x['peak_iteration_frac']:.0f}% of training | {x['decline_peak_to_end']:.1f} | {x['second_half_minus_first_half']:+.1f} | "
                  f"{x['runs_peaking_in_first_half']}/{x['curve_runs']} | {x['eval_peak_optimism'] if x['eval_peak_optimism'] is None else round(x['eval_peak_optimism'], 1)} |")
    md += ["", "Pairwise Welch p-values on per-run simulator test scores (random levels):", ""]
    for k, v in out["pairwise_sim_random"].items():
        md.append(f"- {k}: diff {v['diff']:+.2f}, p = {v['p']:.3f}")
    open(os.path.join(ROOT, "results", "block_analysis.md"), "w").write("\n".join(md) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    main()
