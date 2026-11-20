"""pygame renderer: smooth 120 fps animation, anti-aliased (2x supersampled) art.

The game itself is turn-based (one action = one tick, which is what the RL agent
sees). This renderer only *animates* between ticks: cars/logs slide, the chicken
hops, the camera glides. It reads game state and never changes it.
"""
import math
import random
import time
import pygame
from crossy_game import W, GRASS, ROAD, RIVER

CELL = 56            # on-screen pixels per grid cell
ROWS = 12            # visible rows
SS = 1.5             # supersampling factor (anti-aliasing); 2 = prettier, slower
TICK = 0.11          # seconds a move takes to animate

CAR_COLORS = [(231, 76, 60), (52, 152, 219), (241, 196, 15), (155, 89, 182),
              (46, 204, 113), (236, 240, 241), (230, 126, 34)]


def shade(col, f):
    return tuple(max(0, min(255, int(v * f))) for v in col)


def ease_out(p):
    return 1 - (1 - p) ** 2


class Renderer:
    def __init__(self, game, title="Crossy Road"):
        pygame.init()
        self.g = game
        self.size = (W * CELL, ROWS * CELL)
        try:
            self.screen = pygame.display.set_mode(self.size, pygame.SCALED, vsync=1)
        except Exception:
            self.screen = pygame.display.set_mode(self.size)
        pygame.display.set_caption(title)
        self.c = CELL * SS
        self.canvas = pygame.Surface((int(self.size[0] * SS), int(self.size[1] * SS)))
        self.clock = pygame.time.Clock()
        self.font = self._font(30)
        self.big = self._font(54)
        self.small = self._font(22)
        self.quit = False
        self.tick_time = TICK
        self._reset_visuals()

    # ------------------------------------------------------------------ utils
    def _font(self, px):
        for name in ("arialroundedmtbold", "avenirnext", "helveticaneue", "arial"):
            f = pygame.font.match_font(name, bold=True)
            if f:
                return pygame.font.Font(f, int(px * SS))
        return pygame.font.Font(None, int(px * SS * 1.2))

    def _reset_visuals(self):
        g = self.g
        self.lanes_ref = g.lanes
        self.seen_t = g.t
        self.vr, self.vc = float(g.row), float(g.col)
        self.start = (self.vr, self.vc)
        self.t0 = -1e9
        self.cam = max(0.0, g.row - 3.0)
        self.face = (0, 1)
        self.particles = []
        self.last = time.perf_counter()
        self.dead_at = None

    def poll(self):
        """Pump window events; returns them so the caller can handle keys."""
        events = pygame.event.get()
        for e in events:
            if e.type == pygame.QUIT:
                self.quit = True
        return events

    # ------------------------------------------------------------------ frame
    def frame(self, fps=120):
        g = self.g
        now = time.perf_counter()
        dt = min(0.05, now - self.last)
        self.last = now
        if g.lanes is not self.lanes_ref or g.t < self.seen_t:
            self._reset_visuals(); now = self.last
        if g.t != self.seen_t:                      # a game tick happened
            self.start = (self.vr, self.vc)
            dr, dc = g.row - self.start[0], g.col - self.start[1]
            if abs(dr) > 0.01 or abs(dc) > 0.01:
                self.face = (1 if dr > 0 else -1 if dr < 0 else 0, 1 if dc > 0 else -1 if dc < 0 else 0)
            self.t0 = now
            self.seen_t = g.t
            if not g.alive and self.dead_at is None:
                self.dead_at = now
                self._burst()
        p = min(1.0, (now - self.t0) / self.tick_time)
        e = ease_out(p)
        self.vr = self.start[0] + (g.row - self.start[0]) * e
        self.vc = self.start[1] + (min(max(g.col, -1), W) - self.start[1]) * e
        self.hop = math.sin(math.pi * p) * 0.30 if (p < 1 and (g.row != self.start[0] or g.col != self.start[1])) else 0.0
        target = max(0.0, self.vr - 3.0)
        self.cam += (target - self.cam) * min(1.0, dt * 9)
        self.p = p
        self.now = now
        self._draw(dt)
        pygame.transform.smoothscale(self.canvas, self.size, self.screen)
        pygame.display.flip()
        self.clock.tick(fps)

    def run_ticks(self, duration):
        """Keep drawing frames for `duration` seconds (use after each env.step)."""
        self.tick_time = min(TICK, duration)
        end = time.perf_counter() + duration
        while True:
            self.poll()
            if self.quit:
                return False
            self.frame()
            if time.perf_counter() >= end:
                return True

    # ------------------------------------------------------------------ drawing
    def _draw(self, dt):
        g, s, c = self.g, self.canvas, self.c
        s.fill((120, 190, 80))
        top = int(math.floor(self.cam)) + ROWS + 1
        bottom = int(math.floor(self.cam)) - 1
        player_row = int(round(self.vr))
        drew_player = False
        for row in range(top, bottom - 1, -1):          # far -> near
            lane = g.lane(row)
            y = (ROWS - 1 - (row - self.cam)) * c
            if lane is not None:
                self._lane(lane, row, y)
            if row == player_row:
                self._player()
                drew_player = True
        if not drew_player:
            self._player()
        self._particles(dt)
        self._hud()

    def _lane(self, lane, row, y):
        s, c, g = self.canvas, self.c, self.g
        W_px = W * c
        slide = 0.0
        if lane.moved_t == g.t:
            slide = -lane.dir * (1 - self.p) * c
        if lane.kind == GRASS:
            base = (124, 199, 82) if row % 2 == 0 else (116, 189, 74)
            pygame.draw.rect(s, base, (0, y, W_px, c + 1))
            rnd = random.Random(lane.seed)
            for _ in range(6):                           # grass tufts / flowers
                fx, fy = rnd.random() * W_px, y + rnd.random() * c * 0.9
                pygame.draw.circle(s, shade(base, 1.12), (fx, fy), c * 0.035)
                if rnd.random() < 0.25:
                    pygame.draw.circle(s, rnd.choice([(255, 255, 255), (255, 224, 102)]), (fx, fy), c * 0.04)
            for col in sorted(lane.trees):
                self._tree(col * c, y)
        elif lane.kind == ROAD:
            pygame.draw.rect(s, (88, 90, 100), (0, y, W_px, c + 1))
            pygame.draw.rect(s, (74, 76, 86), (0, y + c * 0.92, W_px, c * 0.08 + 1))
            pygame.draw.rect(s, (100, 102, 112), (0, y, W_px, c * 0.05))
            dash = c * 0.5
            x = (lane.seed % 7) * 3.0
            while x < W_px:                               # dashed centre line
                pygame.draw.rect(s, (225, 225, 215), (x, y + c * 0.47, dash * 0.6, c * 0.06), border_radius=2)
                x += dash * 1.4
            color = CAR_COLORS[lane.seed % len(CAR_COLORS)]
            for col in sorted(lane.objs):
                x = col * c + slide
                for off in (-W_px, 0, W_px):
                    self._car(x + off, y, color, lane.dir)
        else:
            water = (76, 163, 232)
            pygame.draw.rect(s, water, (0, y, W_px, c + 1))
            pygame.draw.rect(s, shade(water, 0.9), (0, y + c * 0.86, W_px, c * 0.14 + 1))
            rnd = random.Random(lane.seed)
            for k in range(7):                            # drifting ripples
                x0 = rnd.random() * W_px
                x = (x0 + self.now * lane.dir * c * 0.35 / lane.period) % W_px
                yy = y + c * (0.15 + 0.7 * rnd.random())
                pygame.draw.line(s, (150, 210, 250), (x, yy), (x + c * 0.28, yy), max(1, int(c * 0.04)))
            for col in sorted(lane.objs):
                x = col * c + slide
                for off in (-W_px, 0, W_px):
                    self._log(x + off, y)

    def _tree(self, x, y):
        s, c = self.canvas, self.c
        pygame.draw.ellipse(s, (88, 150, 60), (x + c * 0.12, y + c * 0.66, c * 0.76, c * 0.24))
        pygame.draw.rect(s, (110, 72, 40), (x + c * 0.42, y + c * 0.38, c * 0.16, c * 0.42), border_radius=3)
        pygame.draw.rect(s, (46, 125, 60), (x + c * 0.16, y - c * 0.06, c * 0.68, c * 0.52), border_radius=int(c * 0.14))
        pygame.draw.rect(s, (68, 160, 78), (x + c * 0.16, y - c * 0.06, c * 0.68, c * 0.30), border_radius=int(c * 0.14))
        pygame.draw.rect(s, (105, 195, 100), (x + c * 0.24, y - c * 0.02, c * 0.24, c * 0.10), border_radius=int(c * 0.05))

    def _car(self, x, y, col, d):
        s, c = self.canvas, self.c
        r = int(c * 0.16)
        pygame.draw.ellipse(s, (60, 62, 70), (x + c * 0.06, y + c * 0.64, c * 0.88, c * 0.22))
        pygame.draw.rect(s, shade(col, 0.72), (x + c * 0.05, y + c * 0.30, c * 0.90, c * 0.50), border_radius=r)
        pygame.draw.rect(s, col, (x + c * 0.05, y + c * 0.24, c * 0.90, c * 0.46), border_radius=r)
        cab_x = x + (c * 0.22 if d < 0 else c * 0.18)
        pygame.draw.rect(s, shade(col, 1.15), (cab_x, y + c * 0.08, c * 0.58, c * 0.34), border_radius=int(c * 0.10))
        pygame.draw.rect(s, (120, 170, 215), (cab_x + c * 0.06, y + c * 0.13, c * 0.46, c * 0.20), border_radius=int(c * 0.07))
        hx = x + (c * 0.04 if d < 0 else c * 0.90)
        pygame.draw.rect(s, (255, 236, 150), (hx, y + c * 0.34, c * 0.06, c * 0.12), border_radius=2)
        for wx in (0.18, 0.64):
            pygame.draw.ellipse(s, (35, 35, 40), (x + c * wx, y + c * 0.62, c * 0.18, c * 0.20))

    def _log(self, x, y):
        s, c = self.canvas, self.c
        pygame.draw.ellipse(s, (50, 120, 175), (x + c * 0.03, y + c * 0.66, c * 0.94, c * 0.24))
        pygame.draw.rect(s, (110, 70, 36), (x, y + c * 0.22, c + 1, c * 0.56), border_radius=int(c * 0.2))
        pygame.draw.rect(s, (160, 108, 58), (x, y + c * 0.16, c + 1, c * 0.50), border_radius=int(c * 0.2))
        pygame.draw.rect(s, (185, 132, 78), (x + c * 0.1, y + c * 0.22, c * 0.8, c * 0.08), border_radius=3)
        pygame.draw.line(s, (130, 86, 44), (x + c * 0.2, y + c * 0.45), (x + c * 0.7, y + c * 0.45), max(1, int(c * 0.03)))

    def _player(self):
        g, s, c = self.g, self.canvas, self.c
        x = self.vc * c
        y = (ROWS - 1 - (self.vr - self.cam)) * c
        hop = self.hop * c
        squash = 0.0 if g.alive else 0.5
        pygame.draw.ellipse(s, (0, 0, 0, 60) if False else (70, 120, 50), (x + c * 0.16, y + c * 0.68, c * 0.68, c * 0.2))
        by = y - hop
        h = c * (0.62 - squash * 0.5)
        top = by + c * 0.74 - h
        body = (250, 250, 250) if g.alive else (205, 205, 205)
        pygame.draw.rect(s, shade(body, 0.82), (x + c * 0.2, top + c * 0.06, c * 0.6, h), border_radius=int(c * 0.14))
        pygame.draw.rect(s, body, (x + c * 0.2, top, c * 0.6, h), border_radius=int(c * 0.14))
        if g.alive:
            pygame.draw.rect(s, (232, 62, 62), (x + c * 0.42, top - c * 0.09, c * 0.16, c * 0.12), border_radius=int(c * 0.05))
            pygame.draw.polygon(s, (255, 170, 40), [(x + c * 0.43, top + c * 0.22), (x + c * 0.57, top + c * 0.22), (x + c * 0.5, top + c * 0.34)])
            pygame.draw.circle(s, (20, 20, 25), (x + c * 0.36, top + c * 0.16), c * 0.04)
            pygame.draw.circle(s, (20, 20, 25), (x + c * 0.64, top + c * 0.16), c * 0.04)
            pygame.draw.rect(s, (235, 235, 235), (x + c * 0.12, top + c * 0.24, c * 0.1, c * 0.24), border_radius=int(c * 0.04))
            pygame.draw.rect(s, (235, 235, 235), (x + c * 0.78, top + c * 0.24, c * 0.1, c * 0.24), border_radius=int(c * 0.04))
        else:
            for dx in (0.36, 0.64):
                cx, cy = x + c * dx, top + c * 0.14
                pygame.draw.line(s, (40, 40, 45), (cx - c * 0.04, cy - c * 0.04), (cx + c * 0.04, cy + c * 0.04), 3)
                pygame.draw.line(s, (40, 40, 45), (cx - c * 0.04, cy + c * 0.04), (cx + c * 0.04, cy - c * 0.04), 3)

    def _burst(self):
        c = self.c
        x = self.vc * c + c * 0.5
        y = (ROWS - 1 - (self.vr - self.cam)) * c + c * 0.4
        for _ in range(18):
            a = random.random() * math.tau
            v = random.uniform(0.6, 2.6) * c
            self.particles.append([x, y, math.cos(a) * v, math.sin(a) * v - c, 0.7,
                                   random.choice([(255, 255, 255), (232, 62, 62), (255, 170, 40)])])

    def _particles(self, dt):
        s, c = self.canvas, self.c
        for pt in self.particles:
            pt[0] += pt[2] * dt; pt[1] += pt[3] * dt; pt[3] += c * 5 * dt; pt[4] -= dt
            if pt[4] > 0:
                pygame.draw.circle(s, pt[5], (pt[0], pt[1]), c * 0.05)
        self.particles = [p for p in self.particles if p[4] > 0]

    def _text(self, font, text, cx, y, col=(255, 255, 255)):
        sh = font.render(text, True, (0, 0, 0))
        im = font.render(text, True, col)
        r = im.get_rect(centerx=cx, y=y)
        self.canvas.blit(sh, r.move(int(3 * SS), int(3 * SS))); self.canvas.blit(im, r)

    def _hud(self):
        g, c = self.g, self.c
        self._text(self.font, str(g.score), self.canvas.get_width() // 2, int(10 * SS))
        if not g.alive:
            veil = pygame.Surface(self.canvas.get_size(), pygame.SRCALPHA)
            veil.fill((0, 0, 0, 120)); self.canvas.blit(veil, (0, 0))
            mid = self.canvas.get_width() // 2
            self._text(self.big, "Game over", mid, c * 3.4)
            self._text(self.font, f"Score {g.score}", mid, c * 4.5)
            self._text(self.small, str(g.death), mid, c * 5.3, (255, 200, 120))
            self._text(self.small, "press R to restart", mid, c * 6.0, (220, 220, 220))
