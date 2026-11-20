"""Play it yourself: arrows / WASD to hop, space = wait, R = restart (hold a key to keep moving)."""
import pygame
from crossy_game import CrossyGame, STAY, UP, DOWN, LEFT, RIGHT
from crossy_render import Renderer

g = CrossyGame()
r = Renderer(g)
pygame.key.set_repeat(170, 100)
keys = {pygame.K_UP: UP, pygame.K_w: UP, pygame.K_DOWN: DOWN, pygame.K_s: DOWN,
        pygame.K_LEFT: LEFT, pygame.K_a: LEFT, pygame.K_RIGHT: RIGHT, pygame.K_d: RIGHT, pygame.K_SPACE: STAY}
while not r.quit:
    for e in r.poll():
        if e.type == pygame.KEYDOWN:
            if e.key in keys and g.alive:
                g.step(keys[e.key])
            elif e.key == pygame.K_r:
                g.reset()
            elif e.key == pygame.K_ESCAPE:
                r.quit = True
    r.frame(120)
