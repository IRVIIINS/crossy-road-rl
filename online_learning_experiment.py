"""Does the in-app online learning actually help? Runs the app's exact learning loop (brain.ts) in the simulator.

Per round (like AI vs AI in the app): the AI plays 2 games on level-maker levels with eps=0.05 random moves, every move is stored,
then it does clip(3*moves, 30, 150) Double-DQN/Huber/Adam(lr 1e-4, batch 32) updates on a 6000-move replay buffer, target sync every 50 updates.
Every --eval-every rounds the greedy policy is tested on 100 held-out seeds on (a) the original random levels and (b) level-maker levels.
  python online_learning_experiment.py --rounds 150 --seeds 0 1 2
Writes results/online_learning.csv and results/online_learning.png.
"""
import argparse, copy, csv, random
from collections import deque
import numpy as np, torch, torch.nn as nn
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from expo_sim import ExpoCrossySim
from dqn_agent import DQNAgent
from level_maker import LevelMaker

GAMMA, BATCH, EPS = 0.97, 32, 0.05
HP = dict(lr=1e-4, sync=50, buf=6000, upd=3.0, lo=30, hi=150, anchor=0.0, head=False)  # defaults = the version first shipped in the app
EVAL_SEEDS = [30_000 + i for i in range(100)]


def greedy(q, obs):
    with torch.no_grad():
        return int(q(torch.as_tensor(obs, dtype=torch.float32)).argmax())


def evaluate(q, maker):
    out = {}
    for name, mk in (("random levels", False), ("maker levels", True)):
        sc = []
        for sd in EVAL_SEEDS:
            env = ExpoCrossySim(sd, designer=LevelMaker.load(maker, eps=0.15, seed=sd) if mk else None)
            obs, info = env.obs(), {"score": 0}
            for _ in range(1500):
                obs, _, done, info = env.step(greedy(q, obs))
                if done: break
            sc.append(info["score"])
        out[name] = float(np.mean(sc))
    return out


def run_seed(seed, rounds, eval_every, maker):
    LR, SYNC, BUF = HP['lr'], HP['sync'], HP['buf']
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
    base = DQNAgent(ExpoCrossySim(0).obs_size, 5, device="cpu"); base.load("models/expo_best.pt")
    q, tgt = base.q, copy.deepcopy(base.q)
    params = list(q.parameters())[-2:] if HP['head'] else list(q.parameters())   # head=True: only the last layer learns
    opt = torch.optim.Adam(params, lr=LR)
    p0 = [p.detach().clone() for p in q.parameters()]  # original weights (for the anchor penalty)
    buf, upd, rows = deque(maxlen=BUF), 0, []
    rows.append(dict(seed=seed, round=0, **evaluate(q, maker)))
    print(rows[-1], flush=True)
    for r in range(1, rounds + 1):
        fresh = 0
        for g in range(2):
            sd = random.randrange(2 ** 31)
            env = ExpoCrossySim(sd, designer=LevelMaker.load(maker, eps=0.15, seed=sd))
            obs = env.obs()
            for _ in range(1500):
                a = random.randrange(5) if random.random() < EPS else greedy(q, obs)
                obs2, rew, done, _ = env.step(a)
                buf.append((obs, a, rew, obs2, float(done))); fresh += 1
                obs = obs2
                if done: break
        for _ in range(int(min(HP['hi'], max(HP['lo'], fresh * HP['upd'])))):
            b = random.sample(buf, min(BATCH, len(buf)))
            s, a, rw, s2, d = (torch.as_tensor(np.array(x), dtype=torch.float32) for x in zip(*b))
            a = a.long()
            with torch.no_grad():
                na = q(s2).argmax(1, keepdim=True)
                y = rw + GAMMA * tgt(s2).gather(1, na).squeeze(1) * (1 - d)
            loss = nn.functional.smooth_l1_loss(q(s).gather(1, a[:, None]).squeeze(1), y)
            opt.zero_grad(); loss.backward()
            if HP['anchor'] > 0:   # pull the weights back toward the shipped ones (limits forgetting)
                for p, w0 in zip(q.parameters(), p0): p.grad += HP['anchor'] * (p.detach() - w0)
            nn.utils.clip_grad_norm_(q.parameters(), 10); opt.step()
            upd += 1
            if upd % SYNC == 0: tgt.load_state_dict(q.state_dict())
        if r % eval_every == 0:
            rows.append(dict(seed=seed, round=r, **evaluate(q, maker)))
            print(rows[-1], flush=True)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", type=int, default=150); ap.add_argument("--eval-every", type=int, default=25)
    ap.add_argument("--lr", type=float, default=1e-4); ap.add_argument("--sync", type=int, default=50)
    ap.add_argument("--buf", type=int, default=6000); ap.add_argument("--upd", type=float, default=3.0)
    ap.add_argument("--lo", type=int, default=30); ap.add_argument("--hi", type=int, default=150)
    ap.add_argument("--anchor", type=float, default=0.0); ap.add_argument("--tag", default=""); ap.add_argument("--head", action="store_true")
    ap.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2]); ap.add_argument("--maker", default="lm_runs/s0/best.pt")
    a = ap.parse_args(); torch.set_num_threads(1)
    HP.update(lr=a.lr, sync=a.sync, buf=a.buf, upd=a.upd, lo=a.lo, hi=a.hi, anchor=a.anchor, head=a.head); print('HP', HP, flush=True)
    rows = [x for s in a.seeds for x in run_seed(s, a.rounds, a.eval_every, a.maker)]
    with open(f"results/online_learning{a.tag}.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["seed", "round", "random levels", "maker levels"]); w.writeheader(); w.writerows(rows)
    fig, ax = plt.subplots(1, 2, figsize=(9, 3.4))
    for k, name in enumerate(["random levels", "maker levels"]):
        for s in a.seeds:
            rr = [x for x in rows if x["seed"] == s]; ax[k].plot([x["round"] for x in rr], [x[name] for x in rr], alpha=.45, label=f"seed {s}")
        rounds_ = sorted({x["round"] for x in rows})
        ax[k].plot(rounds_, [np.mean([x[name] for x in rows if x["round"] == r]) for r in rounds_], "k-o", lw=2, label="mean")
        ax[k].set_title(f"test score on {name}"); ax[k].set_xlabel("learning rounds (2 games each)"); ax[k].set_ylabel("rows crossed")
    ax[0].legend(fontsize=7); plt.tight_layout(); plt.savefig(f"results/online_learning{a.tag}.png", dpi=150)


if __name__ == "__main__":
    main()
