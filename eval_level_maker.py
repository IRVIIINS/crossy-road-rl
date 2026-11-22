"""Evaluate the level-maker AI against the original random level generator.

  python eval_level_maker.py            # needs lm_runs/s*/best.pt (train_level_maker.py) and runs/ (run_experiments.py)

Every player plays the same 200 held-out seeds on (a) levels from the original random generator and
(b) levels built by the level-maker AI. Players: the shipped agent (the one the maker was trained against),
three independently trained agents from the ablation (not seen by the maker), and a hand-written rule.
Writes results/level_maker.{json,csv} and figures, and updates results/summary.json + the app's bundled copy.
"""
import glob, json, os, shutil
from collections import Counter
import numpy as np
import torch
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from expo_sim import ExpoCrossySim, DESIGN_NAMES, MAX_HAZARD_RUN
from dqn_agent import DQNAgent
from level_maker import LevelMaker
from make_report import pol_reactive

SEEDS = [20_000 + i for i in range(200)]
OUT = "results"


def agent_policy(path):
    a = DQNAgent(ExpoCrossySim(0).obs_size, 5, device="cpu"); a.load(path)
    return lambda env, obs: a.act(obs, greedy=True)


def run(policy, designer_factory, seed):
    env = ExpoCrossySim(seed, designer=designer_factory(seed) if designer_factory else None)
    obs, info = env.obs(), {"score": 0, "death": None}
    for _ in range(1500):
        obs, _, done, info = env.step(policy(env, obs))
        if done: break
    return info["score"], env


def hazard_runs(specs):
    best = cur = 0
    for s in specs:
        cur = cur + 1 if s else 0; best = max(best, cur)
    return best


def main():
    torch.set_num_threads(1)
    makers = sorted(glob.glob("lm_runs/s*/best.pt"))
    assert makers, "train the level maker first (train_level_maker.py)"
    players = {"shipped agent (maker trained against it)": agent_policy("models/expo_best.pt")}
    for p in sorted(glob.glob("runs/main_s*/best.pt")):
        players[f"independent agent {os.path.basename(os.path.dirname(p)).split('_')[1]}"] = agent_policy(p)
    players["hand-written rule"] = lambda env, obs: pol_reactive(env)

    res = {}          # player -> {"random": [scores], "maker": [[scores per maker seed]]}
    for name, pol in players.items():
        rnd = [run(pol, None, sd)[0] for sd in SEEDS]
        mk = []
        for mp in makers:
            net = mp
            mk.append([run(pol, lambda sd, net=net: LevelMaker.load(net, eps=0.15, seed=sd), sd)[0] for sd in SEEDS])
        res[name] = dict(random=rnd, maker=mk)
        print(f"{name}: random {np.mean(rnd):.2f} | maker {np.mean([np.mean(m) for m in mk]):.2f}", flush=True)

    # level statistics (random vs maker): row-type mix, longest hazard run, speed ranges respected
    comp = {"random generator": Counter(), "level maker": Counter()}
    longest = {"random generator": [], "level maker": []}
    for sd in SEEDS[:100]:
        e = ExpoCrossySim(sd); specs = e.specs[10:]; comp["random generator"].update(specs); longest["random generator"].append(hazard_runs(specs))
        for mp in makers:
            e = ExpoCrossySim(sd, designer=LevelMaker.load(mp, eps=0.15, seed=sd)); specs = e.specs[10:]
            comp["level maker"].update(specs); longest["level maker"].append(hazard_runs(specs))
    mix = {k: {DESIGN_NAMES[i]: v.get(i, 0) / sum(v.values()) for i in range(6)} for k, v in comp.items()}

    table = []
    for name, r in res.items():
        seed_means = [float(np.mean(m)) for m in r["maker"]]
        table.append(dict(player=name, random_levels=float(np.mean(r["random"])), maker_levels=float(np.mean(seed_means)),
                          maker_levels_std_over_maker_seeds=float(np.std(seed_means, ddof=1)) if len(seed_means) > 1 else 0.0,
                          maker_levels_per_maker_seed=seed_means,
                          drop_pct=100 * (1 - np.mean(seed_means) / max(np.mean(r["random"]), 1e-9)),
                          best_score_on_maker_levels=int(max(max(m) for m in r["maker"]))))
    logs = []
    for f in sorted(glob.glob("lm_runs/s*/training_log.csv")):
        import csv
        logs.append([dict(r) for r in csv.DictReader(open(f))])
    summary = dict(test_seeds=len(SEEDS), maker_seeds=len(makers), table=table, row_mix=mix,
                   longest_hazard_run={k: dict(mean=float(np.mean(v)), max=int(max(v))) for k, v in longest.items()},
                   max_allowed_hazard_run=MAX_HAZARD_RUN,
                   training=[[{k: float(v) for k, v in r.items()} for r in lg] for lg in logs])
    os.makedirs(OUT, exist_ok=True)
    json.dump(summary, open(os.path.join(OUT, "level_maker.json"), "w"), indent=1)
    with open(os.path.join(OUT, "level_maker.csv"), "w") as f:
        f.write("player,random_levels,maker_levels,maker_std_over_maker_seeds,drop_pct,best_score_on_maker_levels\n")
        for t in table:
            f.write(f"{t['player']},{t['random_levels']:.2f},{t['maker_levels']:.2f},{t['maker_levels_std_over_maker_seeds']:.2f},{t['drop_pct']:.1f},{t['best_score_on_maker_levels']}\n")

    # ---- figures
    fig, ax = plt.subplots(figsize=(8, 4.4))
    x = np.arange(len(table)); w = 0.38
    ax.bar(x - w / 2, [t["random_levels"] for t in table], w, label="random generator", color="#888")
    ax.bar(x + w / 2, [t["maker_levels"] for t in table], w, yerr=[t["maker_levels_std_over_maker_seeds"] for t in table],
           capsize=3, label="level-maker AI", color="#c0392b")
    ax.set_xticks(x); ax.set_xticklabels([t["player"].replace(" (", "\n(") for t in table], fontsize=7)
    ax.set(ylabel="mean score (rows crossed)", title="Level-maker AI vs random levels (200 held-out seeds)"); ax.legend(); ax.grid(axis="y", alpha=.25)
    fig.tight_layout(); fig.savefig(os.path.join(OUT, "level_maker_scores.png"), dpi=150); plt.close(fig)

    fig, ax = plt.subplots(figsize=(7.5, 4))
    for i, (k, c) in enumerate((("random generator", "#888"), ("level maker", "#c0392b"))):
        ax.bar(np.arange(6) + (i - .5) * .38, [mix[k][n] for n in DESIGN_NAMES], .38, label=k, color=c)
    ax.set_xticks(range(6)); ax.set_xticklabels(DESIGN_NAMES, fontsize=8)
    ax.set(ylabel="fraction of rows", title="What kind of rows does the level maker build?"); ax.legend(); ax.grid(axis="y", alpha=.25)
    fig.tight_layout(); fig.savefig(os.path.join(OUT, "level_maker_rows.png"), dpi=150); plt.close(fig)

    fig, ax = plt.subplots(figsize=(7.5, 4))
    for lg in logs:
        xs = [float(r["episode"]) for r in lg]
        ax.plot(xs, [float(r["player_score_on_maker_levels"]) for r in lg], color="#c0392b", alpha=.6)
    ax.axhline(float(logs[0][0]["player_score_on_random_levels"]), color="#888", ls="--", label="same player, random levels")
    ax.plot([], [], color="#c0392b", label="same player, level-maker levels (one line per maker seed)")
    ax.set(xlabel="level-maker training episodes", ylabel="player score", title="Level maker learning to beat the player"); ax.legend(fontsize=8); ax.grid(alpha=.25)
    fig.tight_layout(); fig.savefig(os.path.join(OUT, "level_maker_training.png"), dpi=150); plt.close(fig)
    patch_summary()
    print("wrote results/level_maker.*")


LM_FIGS = ["level_maker_scores", "level_maker_rows", "level_maker_training"]


def patch_summary():
    """Add the level-maker results to results/summary.json (what the app's Settings screen shows) and copy to the app."""
    sp = os.path.join(OUT, "summary.json")
    if not (os.path.exists(sp) and os.path.exists(os.path.join(OUT, "level_maker.json"))):
        return
    sm = json.load(open(sp)); lm = json.load(open(os.path.join(OUT, "level_maker.json")))
    sm["level_maker"] = lm
    sm["figures"] = [f for f in sm["figures"] if f not in LM_FIGS] + LM_FIGS
    sm["csv"]["level_maker"] = open(os.path.join(OUT, "level_maker.csv")).read()
    md = ["", "## Level-maker AI vs random levels (mean score, rows crossed)", "",
          "| Player | Random levels | Level-maker levels | Drop |", "|---|---|---|---|"]
    for t in lm["table"]:
        md.append(f"| {t['player']} | {t['random_levels']:.2f} | {t['maker_levels']:.2f} ± {t['maker_levels_std_over_maker_seeds']:.2f} | {t['drop_pct']:.0f}% |")
    head = sm["tables_md"].split("\n## Level-maker AI")[0]
    sm["tables_md"] = head + "\n".join(md) + "\n"
    json.dump(sm, open(sp, "w"), indent=1)
    open(os.path.join(OUT, "tables.md"), "w").write(sm["tables_md"])
    app_dir = os.path.join("expo-game", "assets", "report")
    if os.path.isdir(app_dir):
        for n in LM_FIGS:
            shutil.copy(os.path.join(OUT, f"{n}.png"), os.path.join(app_dir, f"{n}.png"))
        shutil.copy(sp, os.path.join(app_dir, "summary.json"))


if __name__ == "__main__":
    main()
