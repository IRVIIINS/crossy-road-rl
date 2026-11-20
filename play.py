"""Play it yourself with the arrow keys / WASD. Space = wait."""
import pygame
from crossy_game import CrossyGame, STAY, UP, DOWN, LEFT, RIGHT
from crossy_render import Renderer

g = CrossyGame()
r = Renderer(g)
keys = {pygame.K_UP: UP, pygame.K_w: UP, pygame.K_DOWN: DOWN, pygame.K_s: DOWN,
        pygame.K_LEFT: LEFT, pygame.K_a: LEFT, pygame.K_RIGHT: RIGHT, pygame.K_d: RIGHT, pygame.K_SPACE: STAY}
running = True
while running:
    for e in pygame.event.get():
        if e.type == pygame.QUIT: running = False
        elif e.type == pygame.KEYDOWN and e.key in keys and g.alive:
            g.step(keys[e.key])
        elif e.type == pygame.KEYDOWN and e.key == pygame.K_r:
            g.reset()
    r.draw(30)
    if not g.alive: pygame.display.set_caption(f"Game over: {g.death} - score {g.score} (R to restart)")
