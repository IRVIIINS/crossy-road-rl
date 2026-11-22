"""Iterative training with evaluation, checkpoints and early stopping.

Train in rounds ("iterations") of N episodes. After every round, evaluate the greedy policy on a FIXED set
of evaluation seeds (so rounds are comparable), log the numbers, save a checkpoint, and keep the best model.
Stop when the target is reached, when there has been no improvement for `--patience` rounds (counted only
after exploration has finished decaying and `--min-iters` rounds), or when `--max-iters` is hit.

  python train_iterative.py --env expo --out runs/main_s0 --seed 0
  python train_iterative.py --env expo --no-future --out runs/no_future_s0     # ablation: no look-ahead
  python train_iterative.py --env expo --vanilla   --out runs/vanilla_s0       # ablation: plain DQN target

Outputs in --out:  iterations.csv (one row per round), episodes.csv (every training episode),
                   checkpoints/iter_XX.pt, best.pt, final.pt, run.json (config + summary), learning_curve.png
"""
import argparse, csv, json, os, random, time
import numpy as np
import torch
from crossy_env import CrossyEnv
from expo_sim import ExpoCrossySim
from dqn_agent import DQNAgent


def make_env(kind, seed, future):
    return ExpoCrossySim(seed, future=future) if kind == "expo" else CrossyEnv(seed)


def evaluate(agent, kind, future, seeds, max_steps=1500):
    """Greedy rollouts, one per seed. Returns list of (score, death_cause)."""
    out = []
    for sd in seeds:
        env = make_env(kind, sd, future)
        s, info = env.reset(), {"score": 0, "death": None}
        for _ in range(max_steps):
            s, _, done, info = env.step(agent.act(s, greedy=True))
            if done:
                break
        out.append((info["score"], info.get("death") or "timeout"))
    return out


def run(a):
    os.makedirs(os.path.join(a.out, "checkpoints"), exist_ok=True)
    random.seed(a.seed); np.random.seed(a.seed); torch.manual_seed(a.seed)
    torch.set_num_threads(1)
    future = (0,) if a.no_future else (0, 6, 12)
    env = make_env(a.env, a.seed, future)
    agent = DQNAgent(env.obs_size, env.n_actions, device="cpu", double=not a.vanilla,
                     eps_decay_steps=a.eps_decay)
    eval_seeds = [10_000 + i for i in range(a.eval_episodes)]   # same seeds every round and every run

    cfg = {k: v for k, v in vars(a).items()}
    cfg.update(future=list(future), obs_size=env.obs_size, double=not a.vanilla)
    it_rows, ep_rows = [], []
    best, best_it, stale, ep_total, t0, stop = -1.0, 0, 0, 0, time.time(), "max_iters"

    for it in range(1, a.max_iters + 1):
        train_scores = []
        for _ in range(a.episodes_per_iter):
            ep_total += 1
            s, info = env.reset(), {"score": 0}
            for _ in range(a.max_steps):
                act = agent.act(s)
                s2, r, done, info = env.step(act)
                agent.remember(s, act, r, s2, float(done)); agent.learn(); s = s2
                if done:
                    break
            train_scores.append(info["score"])
            ep_rows.append((ep_total, agent.steps, info["score"]))
        ev = evaluate(agent, a.env, future, eval_seeds)
        sc = np.array([e[0] for e in ev], dtype=float)
        row = dict(iteration=it, episodes=ep_total, steps=agent.steps, epsilon=round(agent.epsilon, 4),
                   train_mean=round(float(np.mean(train_scores)), 3),
                   eval_mean=round(float(sc.mean()), 3), eval_std=round(float(sc.std()), 3),
                   eval_median=float(np.median(sc)), eval_max=int(sc.max()), eval_min=int(sc.min()),
                   seconds=round(time.time() - t0, 1))
        it_rows.append(row)
        agent.save(os.path.join(a.out, "checkpoints", f"iter_{it:02d}.pt"))
        improved = row["eval_mean"] > best
        if improved:
            best, best_it, stale = row["eval_mean"], it, 0
            agent.save(os.path.join(a.out, "best.pt"))
        elif agent.epsilon <= agent.eps_end + 1e-9 and it >= a.min_iters:
            stale += 1                                   # patience only counts after exploration AND --min-iters
        print(f"[{os.path.basename(a.out.rstrip('/'))}] it {it:2d} ep {ep_total:5d} eps {agent.epsilon:.2f} | "
              f"train {row['train_mean']:5.1f} | eval {row['eval_mean']:5.1f}±{row['eval_std']:4.1f} "
              f"max {row['eval_max']:3d}{' *' if improved else ''} | {row['seconds']:.0f}s", flush=True)
        if row["eval_mean"] >= a.target_mean and row["eval_min"] >= a.target_min:
            stop = "target_reached"; break
        if stale >= a.patience:
            stop = "early_stopping"; break

    agent.save(os.path.join(a.out, "final.pt"))
    with open(os.path.join(a.out, "iterations.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(it_rows[0])); w.writeheader(); w.writerows(it_rows)
    with open(os.path.join(a.out, "episodes.csv"), "w", newline="") as f:
        w = csv.writer(f); w.writerow(["episode", "steps", "score"]); w.writerows(ep_rows)
    summary = dict(config=cfg, stop_reason=stop, best_eval_mean=best, best_iteration=best_it,
                   iterations=len(it_rows), episodes=ep_total, steps=agent.steps,
                   seconds=round(time.time() - t0, 1))
    json.dump(summary, open(os.path.join(a.out, "run.json"), "w"), indent=2)
    plot_run(a.out, it_rows, ep_rows)
    print(f"done: {stop}, best eval mean {best:.2f} at iteration {best_it}")
    return summary


def plot_run(out, it_rows, ep_rows):
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 2, figsize=(11, 3.8))
    sc = np.array([r[2] for r in ep_rows], dtype=float)
    k = min(100, max(1, len(sc) // 10))
    ax[0].plot(sc, alpha=.2, lw=.6, label="episode")
    if len(sc) >= k:
        ax[0].plot(np.arange(k - 1, len(sc)), np.convolve(sc, np.ones(k) / k, "valid"), lw=2, label=f"moving avg ({k})")
    ax[0].set(title="Training score per episode", xlabel="episode", ylabel="rows crossed"); ax[0].legend()
    x = [r["episodes"] for r in it_rows]; m = np.array([r["eval_mean"] for r in it_rows]); sd = np.array([r["eval_std"] for r in it_rows])
    ax[1].plot(x, m, "o-", label="greedy eval mean"); ax[1].fill_between(x, m - sd, m + sd, alpha=.2)
    ax[1].plot(x, [r["eval_max"] for r in it_rows], "--", label="eval max")
    ax[1].set(title="Evaluation after each iteration", xlabel="training episodes", ylabel="score"); ax[1].legend()
    fig.tight_layout(); fig.savefig(os.path.join(out, "learning_curve.png"), dpi=130); plt.close(fig)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--env", choices=["grid", "expo"], default="expo")
    p.add_argument("--out", default="runs/main_s0")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--episodes-per-iter", type=int, default=200)
    p.add_argument("--max-iters", type=int, default=50)
    p.add_argument("--max-steps", type=int, default=1500)
    p.add_argument("--eval-episodes", type=int, default=50)
    p.add_argument("--eps-decay", type=int, default=50_000)
    p.add_argument("--target-mean", type=float, default=30.0, help="stop when eval mean >= this ...")
    p.add_argument("--target-min", type=int, default=10, help="... and the worst eval episode >= this")
    p.add_argument("--patience", type=int, default=15, help="stop after this many rounds without a new best")
    p.add_argument("--min-iters", type=int, default=30, help="never early-stop before this round (learning can start late)")
    p.add_argument("--no-future", action="store_true", help="ablation: observation has no look-ahead planes")
    p.add_argument("--vanilla", action="store_true", help="ablation: plain DQN target instead of Double DQN")
    run(p.parse_args())
