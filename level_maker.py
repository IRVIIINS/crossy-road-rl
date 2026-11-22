"""The level-maker AI: a small DQN that decides what every new row of the level is.

State  : the last K=4 rows it built (one-hot over 6 row types), whether the next row index is even/odd
         (even river rows are lily pads, odd ones are logs), and how many hazard rows (road/river) came in a row.
Action : 0 grass | 1 road slow | 2 road medium | 3 road fast | 4 river slow | 5 river fast
Fairness: after MAX_HAZARD_RUN hazard rows in a row only grass is allowed, and speeds stay inside the original
         game's ranges, so every level is one the normal generator could also have produced.
Goal   : adversarial - trained (train_level_maker.py) to make levels the player AI dies on, within those rules.
"""
import random
import numpy as np
import torch
import torch.nn as nn
from expo_sim import N_DESIGN, MAX_HAZARD_RUN

K = 4
OBS = K * N_DESIGN + 2


def hazard_run(specs):
    n = 0
    for s in reversed(specs):
        if s == 0: break
        n += 1
    return n


def make_obs(specs, idx):
    o = np.zeros(OBS, dtype=np.float32)
    for j in range(K):
        k = len(specs) - 1 - j
        o[j * N_DESIGN + (specs[k] if k >= 0 else 0)] = 1.0
    o[K * N_DESIGN] = float(idx % 2)
    o[K * N_DESIGN + 1] = min(hazard_run(specs), MAX_HAZARD_RUN) / MAX_HAZARD_RUN
    return o


def legal_mask(specs):
    m = np.ones(N_DESIGN, dtype=bool)
    if hazard_run(specs) >= MAX_HAZARD_RUN:
        m[1:] = False
    return m


class QNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(OBS, 64), nn.ReLU(), nn.Linear(64, 64), nn.ReLU(), nn.Linear(64, N_DESIGN))

    def forward(self, x):
        return self.net(x)


class LevelMaker:
    """Callable used as `ExpoCrossySim(designer=...)`. eps = chance of a random *legal* row (variety)."""

    def __init__(self, net=None, eps=0.15, seed=None):
        self.net = net or QNet()
        self.eps = eps
        self.rng = random.Random(seed)

    def q(self, specs, idx):
        with torch.no_grad():
            return self.net(torch.as_tensor(make_obs(specs, idx)).unsqueeze(0))[0].numpy()

    def __call__(self, specs, idx):
        mask = legal_mask(specs)
        if self.rng.random() < self.eps:
            return self.rng.choice(list(np.flatnonzero(mask)))
        q = np.where(mask, self.q(specs, idx), -1e9)
        return int(q.argmax())

    def save(self, path):
        torch.save(self.net.state_dict(), path)

    @staticmethod
    def load(path, eps=0.15, seed=None):
        net = QNet(); net.load_state_dict(torch.load(path, map_location="cpu"))
        return LevelMaker(net, eps, seed)
