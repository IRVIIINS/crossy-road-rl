"""Headless re-implementation of the *rules* of evanbacon/expo-crossy-road.

Goal: train a policy in Python that transfers to the real Expo/THREE.js game.
Numbers below are copied from that repo's source (src/Row/Road.ts, Row/Water.ts,
CrossyPlayer.ts, GameEngine.ts):
  * the game runs ~60 frames/s; cars/logs move `speed` units per FRAME and wrap at +-11
  * car speed .02-.08, log speed .02-.07, 1-2 cars/row, 2-3 logs/row, spacing 5-8
  * hero width .7; collision half-width = .35 + width/2 - .1
  * a hop takes 0.2 s (12 frames); you can't act while hopping
  * even water rows have static lily pads, odd water rows have logs you ride
  * off-screen at |x| > 5 kills you; first 10 rows are grass; hero starts on row 8
Assumed (not read from the models): car width 2, log width 3, lily width 1.
Left out for now: train/rail rows (treated as roads).
"""
import random
import numpy as np

GRASS, ROAD, WATER_LILY, WATER_LOG = 0, 1, 2, 3
FRAMES_PER_HOP = 12
HERO_HALF = 0.35
START_ROW = 8
WRAP = 11.0

STAY, UP, DOWN, LEFT, RIGHT = range(5)
BACK, AHEAD = 2, 5
VIEW_ROWS = BACK + 1 + AHEAD
BINS = 17                               # x samples at hero_x + k*0.5, k=-8..8
FUTURE = (0, 6, 12)                     # occupancy now, and after 6 / 12 frames
OBS_PER_ROW = 4 + 9 + BINS * len(FUTURE) + 1
OBS_SIZE = VIEW_ROWS * OBS_PER_ROW + 1


def box(width):
    return HERO_HALF + width / 2 - 0.1


class Row:
    def __init__(self, kind, rng, prev=None, idx=0):
        self.kind = kind
        self.trees = set()
        self.ents = []                  # (x0, speed, collision_half) ; position = wrap(x0 + speed*frame)
        self.speed = 0.0
        self.lily = []
        if kind == GRASS:
            if idx < 5:
                self.trees = {x for x in range(-4, 5) if abs(x) > 2}   # solid-ish border like Fill.solid
            elif idx >= 10:
                n = rng.randint(0, 3)
                self.trees = set(rng.sample(range(-4, 5), n))
            if prev is not None and prev.kind == WATER_LILY:
                self.trees -= set(prev.lily)
        elif kind == ROAD:
            self.speed = rng.uniform(0.02, 0.08)
            d = rng.choice([-1, 1]); self.dir = d
            x = -6 * d
            for _ in range(rng.randint(1, 2)):
                self.ents.append((x, self.speed * d, box(2)))
                x -= (rng.random() * 3 + 5) * d
        elif kind == WATER_LILY:
            n = rng.randint(2, 3)
            pos, x = [], int(np.floor(rng.random() * 2 - 4))
            for _ in range(n):
                pos.append(x); x += int(rng.random() * 2 + 2)
            if prev is not None and prev.kind == GRASS:
                clear = [c for c in range(-4, 5) if c not in prev.trees]
                if clear and not any(p in clear for p in pos):
                    pos[0] = rng.choice(clear); pos.sort()
            self.lily = pos
            self.ents = [(float(p), 0.0, box(1)) for p in pos]
        else:
            self.speed = rng.uniform(0.02, 0.07)
            d = rng.choice([-1, 1]); self.dir = d
            x = -6 * d
            for _ in range(rng.randint(2, 3)):
                self.ents.append((x, self.speed * d, box(3)))
                x -= (rng.random() * 3 + 5) * d

    def pos(self, i, frame):
        x0, sp, _ = self.ents[i]
        return (x0 + sp * frame + WRAP) % (2 * WRAP) - WRAP

    def hit(self, x, frame):
        """index of an entity whose collision box contains x, else -1."""
        for i, (_, _, hb) in enumerate(self.ents):
            if abs(x - self.pos(i, frame)) < hb:
                return i
        return -1


class ExpoCrossySim:
    n_actions = 5
    obs_size = OBS_SIZE

    def __init__(self, seed=None, max_idle=25, future=FUTURE):
        """future: frame offsets of the occupancy planes in the observation. (0, 6, 12) is the full model;
        (0,) is the ablation that only sees where cars/logs are *right now* (no look-ahead)."""
        self.rng = random.Random(seed)
        self.max_idle = max_idle
        self.future = tuple(future)
        self.obs_per_row = 4 + 9 + BINS * len(self.future) + 1
        self.obs_size = VIEW_ROWS * self.obs_per_row + 1
        self.reset()

    def row(self, z):
        while len(self.rows) <= z:
            i = len(self.rows)
            if i < 10:
                kind = GRASS
            else:
                kind = self.rng.choice(["grass", "road", "water"])
                if kind == "grass": kind = GRASS
                elif kind == "road": kind = ROAD
                else: kind = WATER_LILY if i % 2 == 0 else WATER_LOG
            prev = self.rows[-1] if self.rows else None
            self.rows.append(Row(kind, self.rng, prev, i))
        return self.rows[z]

    def reset(self):
        self.rows = []
        self.row(30)
        self.z, self.x = START_ROW, 0.0
        self.frame = 0
        self.riding = None              # (row_index, entity_index)
        self.best = START_ROW
        self.idle = 0
        self.alive = True
        self.death = None
        return self.obs()

    @property
    def score(self):
        return self.best - START_ROW

    # ----------------------------------------------------------------- physics
    def _tick_frame(self, z_col):
        """advance one frame; z_col = row used for car/water collisions this frame."""
        self.frame += 1
        if self.riding is not None:
            rz, ei = self.riding
            self.x += self.rows[rz].ents[ei][1]
        r = self.row(z_col)
        if r.kind == ROAD and r.hit(self.x, self.frame) >= 0:
            self._die("hit by car")
        if abs(self.x) > 5:
            self._die("off screen")

    def _die(self, why):
        if self.alive:
            self.alive, self.death = False, why

    def _settle(self):
        """after landing: find a log/lily to ride, otherwise drown."""
        r = self.row(self.z)
        if r.kind in (WATER_LILY, WATER_LOG):
            i = r.hit(self.x, self.frame)
            if i >= 0:
                self.riding = (self.z, i)
            else:
                self._die("drowned")

    def step(self, action):
        before_best = self.best
        if not self.alive:
            return self.obs(), 0.0, True, self.info()
        tx, tz = self.x, self.z
        if action == UP: tz += 1
        elif action == DOWN: tz -= 1
        elif action == LEFT: tx -= 1
        elif action == RIGHT: tx += 1
        if action in (UP, DOWN):
            tx = round(self.x)
            if self.riding is not None:
                d = self.rows[self.riding[0]].ents[self.riding[1]][1]
                tx = int(np.floor(tx)) if d < 0 else int(np.ceil(tx)) if d > 0 else tx
        tz = max(tz, 0)
        # tree collision: stay in place (the real game just plays the hop)
        tr = self.row(tz)
        if tr.kind == GRASS and int(tx) in tr.trees and (tx, tz) != (self.x, self.z):
            tx, tz = self.x, self.z
        moving = (tx, tz) != (self.x, self.z)
        if moving:
            self.riding = None
        start_x, start_z = self.x, self.z
        for f in range(FRAMES_PER_HOP):
            if moving and f >= FRAMES_PER_HOP // 2:
                self.x, self.z = tx, tz                   # in the air: collisions use the target row
            self._tick_frame(self.z if not moving or f >= FRAMES_PER_HOP // 2 else start_z)
            if not self.alive:
                break
        if self.alive:
            if moving:
                self.x, self.z = tx, tz
            self._settle()
        # camera / progress rules
        if self.alive and self.z > self.best:
            self.best = self.z; self.idle = 0
        else:
            self.idle += 1
            if self.idle > self.max_idle:
                self._die("too slow")
        if self.alive and self.z < self.best - 3:
            self._die("fell behind")
        gained = self.best - before_best
        reward = -0.02 + gained - (1.0 if not self.alive else 0.0)
        return self.obs(), reward, not self.alive, self.info()

    def info(self):
        return {"score": self.score, "death": self.death}

    # ------------------------------------------------------------- observation
    def obs(self):
        o = np.zeros((VIEW_ROWS, self.obs_per_row), dtype=np.float32)
        hx = self.x
        cols = [int(round(hx)) + k for k in range(-4, 5)]
        for i, z in enumerate(range(self.z - BACK, self.z + AHEAD + 1)):
            if z < 0:
                o[i, 4] = 1; o[i, 4 + 9:4 + 9 + 0] = 0     # wall behind the start
                o[i, 4:13] = 1.0
                continue
            r = self.row(z)
            o[i, r.kind] = 1.0
            for j, c in enumerate(cols):
                if r.kind == GRASS and int(c) in r.trees: o[i, 4 + j] = 1.0
                if abs(c) > 4: o[i, 4 + j] = 1.0
            if r.ents:
                for f, df in enumerate(self.future):
                    for k in range(BINS):
                        bx = hx + (k - 8) * 0.5
                        if r.hit(bx, self.frame + df) >= 0:
                            o[i, 13 + f * BINS + k] = 1.0
            if r.kind in (ROAD, WATER_LOG):
                o[i, 13 + BINS * len(self.future)] = r.dir * r.speed / 0.08
        return np.concatenate([o.ravel(), np.array([hx / 5.0], dtype=np.float32)])
