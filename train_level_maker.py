"""Train the level-maker AI against a frozen player AI.

  python train_level_maker.py --player models/expo_best.pt --episodes 6000 --out level_maker

Each episode: the frozen player plays a level that the maker builds row by row. The maker gets
  +1 when the player dies on a row it built (hit by a car / drowned there, or stuck waiting to enter it),
  -0.05 for every row the player crossed safely.
Rows the player never reached get no reward (not resolved). Fairness limits (level_maker.py) are enforced by an
action mask, so the maker cannot simply build an impossible wall of traffic.
"""
import argparse, csv, json, os, random, time
import numpy as np
import torch
import torch.nn as nn
from expo_sim import ExpoCrossySim, START_ROW
from dqn_agent import DQNAgent
from level_maker import LevelMaker, QNet, make_obs, legal_mask, OBS
from expo_sim import N_DESIGN

SURVIVE, KILL = -0.05, 1.0




def play(player, maker, seed, max_steps=1500):
    """One level built by `maker` for the frozen `player`. Returns (env, info)."""
    env = ExpoCrossySim(seed, designer=maker)
    s, info = env.obs(), {"score": 0, "death": None}
    for _ in range(max_steps):
        s, _, done, info = env.step(player(s))
        if done: break
    return env, info


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--player", default="models/expo_best.pt")
    p.add_argument("--episodes", type=int, default=6000)
    p.add_argument("--out", default="level_maker")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--eval-every", type=int, default=250)
    a = p.parse_args()
    os.makedirs(a.out, exist_ok=True)
    random.seed(a.seed); np.random.seed(a.seed); torch.manual_seed(a.seed); torch.set_num_threads(1)

    pl = DQNAgent(ExpoCrossySim(0).obs_size, 5, device="cpu"); pl.load(a.player)
    player = lambda s: pl.act(s, greedy=True)

    net, target = QNet(), QNet(); target.load_state_dict(net.state_dict())
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    maker = LevelMaker(net, eps=1.0, seed=a.seed)
    mem, steps, log, t0 = [], 0, [], time.time()
    eval_seeds = [10_000 + i for i in range(60)]
    ep_scores = []

    for ep in range(1, a.episodes + 1):
        maker.eps = max(0.1, 1.0 - ep / (0.6 * a.episodes))
        rec = []
        def designer(specs, idx, rec=rec):
            act = maker(specs, idx)
            rec.append((idx, make_obs(specs, idx), legal_mask(specs), act))
            return act
        env = ExpoCrossySim(random.randrange(10**9), designer=designer)
        s, info = env.obs(), {"score": 0, "death": None}
        for _ in range(1500):
            s, _, done, info = env.step(player(s))
            if done: break
        ep_scores.append(info["score"])
        # resolve which designed row ended the run
        death, zdeath = info["death"], env.z
        blame = None
        if death in ("hit by car", "drowned"): blame = zdeath
        elif death == "too slow": blame = zdeath + 1
        last = max(zdeath, blame or 0)
        by_idx = {r[0]: r for r in rec}
        for j in range(START_ROW + 2, last + 1):
            if j not in by_idx or j + 1 not in by_idx: continue
            idx, o, m, act = by_idx[j]
            r = KILL if j == blame else SURVIVE
            done_j = (j == last)
            mem.append((o, act, r, by_idx[j + 1][1], by_idx[j + 1][2], float(done_j)))
        mem = mem[-60_000:]
        if len(mem) >= 500:
            for _ in range(40):
                steps += 1
                b = random.sample(mem, 64)
                o = torch.as_tensor(np.array([x[0] for x in b])); a_ = torch.as_tensor([x[1] for x in b]).unsqueeze(1)
                r = torch.as_tensor([x[2] for x in b], dtype=torch.float32)
                o2 = torch.as_tensor(np.array([x[3] for x in b])); m2 = torch.as_tensor(np.array([x[4] for x in b]))
                d = torch.as_tensor([x[5] for x in b], dtype=torch.float32)
                q = net(o).gather(1, a_).squeeze(1)
                with torch.no_grad():
                    q2 = target(o2).masked_fill(~m2, -1e9)
                    best = net(o2).masked_fill(~m2, -1e9).argmax(1, keepdim=True)    # double-DQN target
                    y = r + 0.95 * q2.gather(1, best).squeeze(1) * (1 - d)
                loss = nn.functional.smooth_l1_loss(q, y)
                opt.zero_grad(); loss.backward(); nn.utils.clip_grad_norm_(net.parameters(), 10); opt.step()
                if steps % 200 == 0: target.load_state_dict(net.state_dict())
        if ep % a.eval_every == 0:
            ev = LevelMaker(net, eps=0.15, seed=1)
            sc = [play(player, ev, sd)[1]["score"] for sd in eval_seeds]
            rs = []
            for sd in eval_seeds:
                e = ExpoCrossySim(sd); st, inf = e.obs(), {"score": 0}
                for _ in range(1500):
                    st, _, dn, inf = e.step(player(st))
                    if dn: break
                rs.append(inf["score"])
            row = dict(episode=ep, eps=round(maker.eps, 3), train_score=round(float(np.mean(ep_scores[-a.eval_every:])), 2),
                       player_score_on_maker_levels=round(float(np.mean(sc)), 2), player_score_on_random_levels=round(float(np.mean(rs)), 2),
                       seconds=round(time.time() - t0))
            log.append(row)
            print(row, flush=True)
            if len(log) == 1 or row["player_score_on_maker_levels"] <= min(r["player_score_on_maker_levels"] for r in log):
                LevelMaker(net).save(os.path.join(a.out, "best.pt"))
    LevelMaker(net).save(os.path.join(a.out, "final.pt"))
    with open(os.path.join(a.out, "training_log.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(log[0])); w.writeheader(); w.writerows(log)


if __name__ == "__main__":
    main()
