"""Core Crossy Road game logic (no pygame needed, so training is fast).

Grid world, W columns wide, infinite rows going "up" (row index grows forward).
Lane types:
  grass : safe, some cells blocked by trees
  road  : cars drive left/right (wrap around the screen)
  river : water; you must stand on a log. Logs carry you sideways.
Time is discrete: one agent action = one tick.
"""
import numpy as np

W = 9
GRASS, ROAD, RIVER = 0, 1, 2

# actions
STAY, UP, DOWN, LEFT, RIGHT = range(5)
ACTION_NAMES = ["stay", "up", "down", "left", "right"]


class Lane:
    def __init__(self, kind, rng):
        self.kind = kind
        self.dir = 1
        self.period = 1       # lane moves one cell every `period` ticks
        self.offset = 0
        self.trees = set()
        self.objs = set()     # car or log cells
        if kind == GRASS:
            n = rng.integers(0, 4)
            self.trees = set(int(c) for c in rng.choice(W, size=n, replace=False))
        else:
            self.dir = int(rng.choice([-1, 1]))
            self.period = int(rng.integers(1, 4))
            self.offset = int(rng.integers(0, self.period))
            if kind == ROAD:
                n = int(rng.integers(1, 4))
                self.objs = set(int(c) for c in rng.choice(W, size=n, replace=False))
            else:  # logs are 2-3 cells long
                self.objs = set()
                for start in range(int(rng.integers(0, 3)), W, 4):
                    ln = int(rng.integers(2, 4))
                    for k in range(ln):
                        self.objs.add((start + k) % W)

    def step(self, t):
        if self.kind == GRASS or (t + self.offset) % self.period != 0:
            return 0
        self.objs = {(c + self.dir) % W for c in self.objs}
        return self.dir


class CrossyGame:
    def __init__(self, seed=None, max_idle=40):
        self.rng = np.random.default_rng(seed)
        self.max_idle = max_idle
        self.reset()

    # ---- world generation -------------------------------------------------
    def _make_lane(self, row):
        if row <= 1:
            return Lane(GRASS, self.rng)
        prev = self.lanes[row - 1].kind
        r = self.rng.random()
        if prev == GRASS:
            kind = ROAD if r < 0.6 else RIVER if r < 0.8 else GRASS
        else:
            kind = prev if r < 0.35 else GRASS if r < 0.6 else (ROAD if prev == RIVER else RIVER) if r < 0.7 else ROAD if r < 0.9 else RIVER
        lane = Lane(kind, self.rng)
        if kind == GRASS:
            lane.trees.discard(W // 2)
        return lane

    def _ensure(self, row):
        while len(self.lanes) <= row:
            self.lanes.append(self._make_lane(len(self.lanes)))

    def lane(self, row):
        if row < 0:
            return None
        self._ensure(row)
        return self.lanes[row]

    # ---- gameplay ----------------------------------------------------------
    def reset(self):
        self.lanes = []
        self._ensure(1)
        self.lanes[0] = Lane(GRASS, self.rng); self.lanes[0].trees = set()
        self.lanes[1] = Lane(GRASS, self.rng); self.lanes[1].trees = set()
        self.row, self.col = 0, W // 2
        self.best = 0
        self.t = 0
        self.idle = 0
        self.alive = True
        self.death = None
        self.score = 0
        return self

    def _kill(self, why):
        self.alive = False
        self.death = why

    def step(self, action):
        """Advance one tick. Returns (new_best_row_gained, done)."""
        if not self.alive:
            return 0, True
        self.t += 1
        nr, nc = self.row, self.col
        if action == UP: nr += 1
        elif action == DOWN: nr = max(0, nr - 1)
        elif action == LEFT: nc -= 1
        elif action == RIGHT: nc += 1
        nc = min(max(nc, 0), W - 1)
        target = self.lane(nr)
        if not (target.kind == GRASS and nc in target.trees):
            self.row, self.col = nr, nc
        # lanes move
        self._ensure(self.row + 12)
        for i in range(max(0, self.row - 4), self.row + 12):
            shift = self.lanes[i].step(self.t)
            if i == self.row and shift and self.lanes[i].kind == RIVER and self.col in self._prev_logs(i, shift):
                self.col += shift
        cur = self.lanes[self.row]
        if self.col < 0 or self.col >= W:
            self._kill("swept off screen")
        elif cur.kind == ROAD and self.col in cur.objs:
            self._kill("hit by car")
        elif cur.kind == RIVER and self.col not in cur.objs:
            self._kill("drowned")
        gained = 0
        if self.alive and self.row > self.best:
            gained = self.row - self.best
            self.best = self.row
            self.idle = 0
        else:
            self.idle += 1
            if self.idle > self.max_idle:
                self._kill("eaten by eagle (too slow)")
        self.score = self.best
        return gained, not self.alive

    def _prev_logs(self, i, shift):
        # cells that held a log before this lane moved (so a rider is carried along)
        return {(c - shift) % W for c in self.lanes[i].objs}
