"""One long, resumable training run (used by overnight.py).

Differences to train_iterative.py: it can be stopped and resumed at any time (state.pt is written after every iteration),
it stops at a wall-clock deadline or when a STOP file appears, it can train on a mix of original random levels and
level-maker levels (--maker-mix), the learning rate decays linearly over the run, and every iteration is evaluated on
BOTH kinds of levels (random / level-maker) with the same fixed seeds.

  python train_long.py --out long_run/mix50_s0 --seed 0 --maker-mix 0.5 --episodes 150000
"""
import argparse, csv, json, os, random, time
import numpy as np
import torch
from expo_sim import ExpoCrossySim
from dqn_agent import DQNAgent
from level_maker import LevelMaker

EPS_MAKER = 0.15      # same randomness of the maker as in the app / experiments


def play(agent, seed, maker_net, greedy, learn=False, max_steps=1500):
    env = ExpoCrossySim(seed, designer=LevelMaker(maker_net, eps=EPS_MAKER, seed=seed) if maker_net is not None else None)
    s, info = env.obs(), {"score": 0}
    for _ in range(max_steps):
        a = agent.act(s, greedy=greedy)
        s2, r, done, info = env.step(a)
        if learn:
            agent.remember(s, a, r, s2, float(done)); agent.learn()
        s = s2
        if done:
            break
    return info["score"]


def evaluate(agent, seeds, maker_net):
    return float(np.mean([play(agent, sd, maker_net, True) for sd in seeds]))


def atomic_save(obj, path):
    torch.save(obj, path + ".tmp"); os.replace(path + ".tmp", path)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--maker", default="lm_runs/s0/best.pt")
    p.add_argument("--maker-mix", type=float, default=0.0, help="share of training episodes played on level-maker levels")
    p.add_argument("--episodes", type=int, default=150_000)
    p.add_argument("--episodes-per-iter", type=int, default=200)
    p.add_argument("--eval-episodes", type=int, default=100)
    p.add_argument("--lr", type=float, default=5e-4)
    p.add_argument("--lr-final", type=float, default=1e-4)
    p.add_argument("--eps-decay", type=int, default=50_000)
    p.add_argument("--ckpt-every", type=int, default=10)
    p.add_argument("--device", default="cpu", help="cpu or cuda")
    p.add_argument("--deadline", type=float, default=0, help="unix time at which to stop (0 = none)")
    a = p.parse_args()
    os.makedirs(os.path.join(a.out, "checkpoints"), exist_ok=True)
    stop_file = os.path.join(os.path.dirname(os.path.abspath(a.out)), "STOP")
    random.seed(a.seed); np.random.seed(a.seed); torch.manual_seed(a.seed); torch.set_num_threads(1)

    maker_net = LevelMaker.load(a.maker).net
    agent = DQNAgent(ExpoCrossySim(0).obs_size, 5, device=a.device, eps_decay_steps=a.eps_decay, lr=a.lr)
    eval_seeds = [10_000 + i for i in range(a.eval_episodes)]
    rng = random.Random(a.seed * 7919 + 13)
    it, ep_total, best, best_it, rows = 0, 0, -1.0, 0, []
    state_path = os.path.join(a.out, "state.pt")
    if os.path.exists(state_path):                                   # resume
        st = torch.load(state_path, map_location="cpu", weights_only=False)
        agent.q.load_state_dict(st["q"]); agent.target.load_state_dict(st["target"]); agent.opt.load_state_dict(st["opt"])
        agent.steps, it, ep_total, best, best_it, rows = st["steps"], st["it"], st["ep_total"], st["best"], st["best_it"], st["rows"]
        rng.setstate(st["rng"]) if "rng" in st else None
        print(f"resumed {a.out} at iteration {it}, episode {ep_total}", flush=True)
    t0 = time.time() - (rows[-1]["seconds"] if rows else 0)
    reason = "episodes_done"

    while ep_total < a.episodes:
        if (a.deadline and time.time() > a.deadline) or os.path.exists(stop_file):
            reason = "stopped"; break
        frac = min(1.0, ep_total / a.episodes)
        for g in agent.opt.param_groups:
            g["lr"] = a.lr + frac * (a.lr_final - a.lr)
        train = []
        for _ in range(a.episodes_per_iter):
            ep_total += 1
            use_maker = rng.random() < a.maker_mix
            train.append(play(agent, rng.randrange(2 ** 31), maker_net if use_maker else None, greedy=False, learn=True))
        it += 1
        e_rand, e_make = evaluate(agent, eval_seeds, None), evaluate(agent, eval_seeds, maker_net)
        score = 0.5 * (e_rand + e_make)
        row = dict(iteration=it, episodes=ep_total, steps=agent.steps, epsilon=round(agent.epsilon, 4),
                   lr=round(g["lr"], 6), train_mean=round(float(np.mean(train)), 3), eval_random=round(e_rand, 3),
                   eval_maker=round(e_make, 3), eval_both=round(score, 3), seconds=round(time.time() - t0, 1))
        rows.append(row)
        if it % a.ckpt_every == 0:
            agent.save(os.path.join(a.out, "checkpoints", f"iter_{it:04d}.pt"))
        if score > best:
            best, best_it = score, it
            agent.save(os.path.join(a.out, "best.pt"))
        atomic_save(dict(q=agent.q.state_dict(), target=agent.target.state_dict(), opt=agent.opt.state_dict(), steps=agent.steps,
                         it=it, ep_total=ep_total, best=best, best_it=best_it, rows=rows, rng=rng.getstate()), state_path)
        with open(os.path.join(a.out, "iterations.csv"), "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(row)); w.writeheader(); w.writerows(rows)
        print(f"[{os.path.basename(a.out)}] it {it:4d} ep {ep_total:6d} | train {row['train_mean']:5.1f} | random {e_rand:5.1f} "
              f"maker {e_make:5.1f} | best {best:5.1f}@{best_it} | {row['seconds']/60:.0f} min", flush=True)

    agent.save(os.path.join(a.out, "final.pt"))
    agent.save(os.path.join(a.out, "checkpoints", f"iter_{it:04d}.pt"))
    summary = dict(reason=reason, iterations=it, episodes=ep_total, best_eval_both=best, best_iteration=best_it, config=vars(a))
    json.dump(summary, open(os.path.join(a.out, "done.json" if reason == "episodes_done" else "stopped.json"), "w"), indent=1)
    print("finished:", reason, flush=True)


if __name__ == "__main__":
    main()
