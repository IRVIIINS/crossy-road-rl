import random
from collections import deque
import numpy as np
import torch
import torch.nn as nn


class QNet(nn.Module):
    def __init__(self, obs_size, n_actions):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(obs_size, 256), nn.ReLU(),
            nn.Linear(256, 128), nn.ReLU(),
            nn.Linear(128, n_actions))

    def forward(self, x):
        return self.net(x)


class DQNAgent:
    def __init__(self, obs_size, n_actions, lr=5e-4, gamma=0.97, buffer=100_000,
                 batch=128, eps_start=1.0, eps_end=0.05, eps_decay_steps=50_000,
                 target_sync=1000, device=None):
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.q = QNet(obs_size, n_actions).to(self.device)
        self.target = QNet(obs_size, n_actions).to(self.device)
        self.target.load_state_dict(self.q.state_dict())
        self.opt = torch.optim.Adam(self.q.parameters(), lr=lr)
        self.mem = deque(maxlen=buffer)
        self.n_actions, self.gamma, self.batch = n_actions, gamma, batch
        self.eps_start, self.eps_end, self.eps_decay = eps_start, eps_end, eps_decay_steps
        self.target_sync = target_sync
        self.steps = 0

    @property
    def epsilon(self):
        f = min(1.0, self.steps / self.eps_decay)
        return self.eps_start + f * (self.eps_end - self.eps_start)

    def act(self, obs, greedy=False):
        if not greedy and random.random() < self.epsilon:
            return random.randrange(self.n_actions)
        with torch.no_grad():
            x = torch.as_tensor(obs, device=self.device).unsqueeze(0)
            return int(self.q(x).argmax(1).item())

    def remember(self, s, a, r, s2, done):
        self.mem.append((s, a, r, s2, done))

    def learn(self):
        self.steps += 1
        if len(self.mem) < max(self.batch, 2000):
            return None
        s, a, r, s2, d = zip(*random.sample(self.mem, self.batch))
        dev = self.device
        s = torch.as_tensor(np.array(s), device=dev)
        s2 = torch.as_tensor(np.array(s2), device=dev)
        a = torch.as_tensor(a, device=dev).unsqueeze(1)
        r = torch.as_tensor(r, dtype=torch.float32, device=dev)
        d = torch.as_tensor(d, dtype=torch.float32, device=dev)
        q = self.q(s).gather(1, a).squeeze(1)
        with torch.no_grad():  # Double DQN target
            best = self.q(s2).argmax(1, keepdim=True)
            nxt = self.target(s2).gather(1, best).squeeze(1)
            y = r + self.gamma * nxt * (1 - d)
        loss = nn.functional.smooth_l1_loss(q, y)
        self.opt.zero_grad(); loss.backward()
        nn.utils.clip_grad_norm_(self.q.parameters(), 10)
        self.opt.step()
        if self.steps % self.target_sync == 0:
            self.target.load_state_dict(self.q.state_dict())
        return float(loss.item())

    def save(self, path):
        torch.save(self.q.state_dict(), path)

    def load(self, path):
        self.q.load_state_dict(torch.load(path, map_location=self.device))
        self.target.load_state_dict(self.q.state_dict())
