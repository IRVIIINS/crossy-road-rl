"""Gym-style wrapper around CrossyGame (reset/step), no gym dependency."""
import numpy as np
from crossy_game import CrossyGame, W, GRASS, ROAD, RIVER

BACK, AHEAD = 2, 6            # rows visible behind / ahead of the player
VIEW_ROWS = BACK + 1 + AHEAD
N_CHANNELS = 5                # tree, car, water, log, lane velocity
OBS_SIZE = VIEW_ROWS * W * N_CHANNELS
N_ACTIONS = 5


class CrossyEnv:
    n_actions = N_ACTIONS
    obs_size = OBS_SIZE

    def __init__(self, seed=None):
        self.game = CrossyGame(seed)

    def reset(self):
        self.game.reset()
        return self._obs()

    def step(self, action):
        g = self.game
        gained, done = g.step(action)
        reward = -0.02 + 1.0 * gained
        if done:
            reward -= 1.0
        return self._obs(), reward, done, {"score": g.score, "death": g.death}

    def _obs(self):
        g = self.game
        obs = np.zeros((VIEW_ROWS, W, N_CHANNELS), dtype=np.float32)
        for i, row in enumerate(range(g.row - BACK, g.row + AHEAD + 1)):
            lane = g.lane(row)
            if lane is None:
                obs[i, :, 0] = 1.0  # below the start = wall
                continue
            if lane.kind == GRASS:
                for c in lane.trees: obs[i, c, 0] = 1.0
            elif lane.kind == ROAD:
                for c in lane.objs: obs[i, c, 1] = 1.0
                obs[i, :, 4] = lane.dir / lane.period
            else:
                obs[i, :, 2] = 1.0
                for c in lane.objs:
                    obs[i, c, 2] = 0.0
                    obs[i, c, 3] = 1.0
                obs[i, :, 4] = lane.dir / lane.period
        # mark the player's own cell on the log channel is implicit: player is row index BACK,
        # column g.col -> encode with a one-hot in channel 4 of the player's row
        c = min(max(g.col, 0), W - 1)
        half = W // 2
        padded = np.zeros((VIEW_ROWS, W + 2 * half, N_CHANNELS), dtype=np.float32)
        padded[:, :, 0] = 1.0                       # off-screen columns count as walls
        padded[:, half:half + W, :] = obs
        return padded[:, c:c + W, :].ravel()        # window centred on the player

