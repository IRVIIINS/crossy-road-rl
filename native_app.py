"""Crossy Road AI - one window, no terminal needed.

  Menu:  1 = play yourself   2 = watch the AI   Esc = back / quit
  Play:  arrows / WASD, space = wait, R = restart
  AI:    the trained network plays; R = restart, [ and ] change its speed

Runs with only pygame + numpy (no PyTorch), so it can be packaged as a small Mac .app.
"""
import os
import sys
import time
import numpy as np
import pygame
from crossy_env import CrossyEnv
from crossy_game import STAY, UP, DOWN, LEFT, RIGHT
from crossy_render import Renderer, SS


def resource(path):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, path)


class NumpyPolicy:
    def __init__(self, path):
        d = np.load(path)
        self.layers = [(d[f"l{i}_weight"], d[f"l{i}_bias"]) for i in (0, 2, 4)]

    def act(self, obs):
        x = obs
        for n, (w, b) in enumerate(self.layers):
            x = w @ x + b
            if n < len(self.layers) - 1:
                x = np.maximum(x, 0)
        return int(np.argmax(x))


KEYS = {pygame.K_UP: UP, pygame.K_w: UP, pygame.K_DOWN: DOWN, pygame.K_s: DOWN,
        pygame.K_LEFT: LEFT, pygame.K_a: LEFT, pygame.K_RIGHT: RIGHT, pygame.K_d: RIGHT,
        pygame.K_SPACE: STAY}


def main(selftest=False):
    env = CrossyEnv(seed=int(time.time()) % 100000)
    g = env.game
    policy = NumpyPolicy(resource("models/grid_best.npz"))
    if selftest:
        obs = env.reset()
        for _ in range(200):
            obs, _, done, _ = env.step(policy.act(obs))
            if done: obs = env.reset()
        print("selftest ok")
        return
    r = Renderer(g, "Crossy Road v2 (2D)")
    pygame.key.set_repeat(170, 100)
    mode, obs, last, move_dt = "menu", env._obs(), 0.0, 0.14

    def text(surf, font, s, y, col=(255, 255, 255)):
        im = font.render(s, True, col)
        sh = font.render(s, True, (0, 0, 0))
        rect = im.get_rect(centerx=surf.get_width() // 2, y=int(y))
        surf.blit(sh, rect.move(3, 3)); surf.blit(im, rect)

    def overlay(rr):
        if mode != "menu":
            if mode == "ai":
                text(rr.canvas, rr.small, "AI playing  ( [ slower   ] faster )", rr.canvas.get_height() - 36 * SS, (255, 255, 255))
            return
        veil = pygame.Surface(rr.canvas.get_size(), pygame.SRCALPHA)
        veil.fill((0, 0, 0, 150)); rr.canvas.blit(veil, (0, 0))
        c = rr.c
        text(rr.canvas, rr.big, "Crossy Road AI", c * 2.2)
        text(rr.canvas, rr.font, "1   Play yourself", c * 4.2)
        text(rr.canvas, rr.font, "2   Watch the AI", c * 5.2)
        text(rr.canvas, rr.small, "Esc to quit", c * 6.8, (210, 210, 210))

    while not r.quit:
        for e in r.poll():
            if e.type != pygame.KEYDOWN:
                continue
            if e.key == pygame.K_ESCAPE:
                if mode == "menu": r.quit = True
                else: mode = "menu"; g.reset(); obs = env._obs()
            elif mode == "menu" and e.key in (pygame.K_1, pygame.K_KP1):
                mode = "play"; g.reset()
            elif mode == "menu" and e.key in (pygame.K_2, pygame.K_KP2):
                mode = "ai"; obs = env.reset()
            elif e.key == pygame.K_r and mode != "menu":
                obs = env.reset()
            elif mode == "play" and e.key in KEYS and g.alive:
                g.step(KEYS[e.key])
            elif mode == "ai" and e.key == pygame.K_LEFTBRACKET:
                move_dt = min(0.6, move_dt * 1.3)
            elif mode == "ai" and e.key == pygame.K_RIGHTBRACKET:
                move_dt = max(0.04, move_dt / 1.3)
        if mode == "ai" and g.alive and time.perf_counter() - last >= move_dt:
            obs, _, _, _ = env.step(policy.act(obs))
            last = time.perf_counter()
        elif mode == "ai" and not g.alive and time.perf_counter() - last > 1.6:
            obs = env.reset(); last = time.perf_counter()
        r.frame(120, overlay)


if __name__ == "__main__":
    main(selftest="--selftest" in sys.argv)
