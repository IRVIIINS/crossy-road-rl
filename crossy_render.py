"""pygame renderer. Reads game state only."""
import os
import pygame
from crossy_game import W, GRASS, ROAD, RIVER

CELL = 48
VIEW_ROWS = 13
COL = {GRASS: (112, 190, 90), ROAD: (70, 70, 78), RIVER: (64, 140, 220)}


class Renderer:
    def __init__(self, game):
        pygame.init()
        self.g = game
        self.screen = pygame.display.set_mode((W * CELL, VIEW_ROWS * CELL))
        pygame.display.set_caption("Crossy Road")
        self.clock = pygame.time.Clock()
        self.font = pygame.font.SysFont(None, 32)

    def draw(self, fps=8):
        for e in pygame.event.get():
            if e.type == pygame.QUIT: return False
        g, s = self.g, self.screen
        base = max(0, g.row - 3)
        for i in range(VIEW_ROWS):
            row = base + i
            y = (VIEW_ROWS - 1 - i) * CELL
            lane = g.lane(row)
            pygame.draw.rect(s, COL[lane.kind], (0, y, W * CELL, CELL))
            if lane.kind == GRASS:
                for c in lane.trees:
                    pygame.draw.rect(s, (80, 54, 30), (c*CELL+19, y+26, 10, 18))
                    pygame.draw.circle(s, (30, 110, 50), (c*CELL+24, y+20), 16)
            elif lane.kind == ROAD:
                pygame.draw.line(s, (200, 200, 200), (0, y+CELL-1), (W*CELL, y+CELL-1), 1)
                for c in lane.objs:
                    pygame.draw.rect(s, (220, 60, 60), (c*CELL+3, y+9, CELL-6, CELL-18), border_radius=6)
            else:
                for c in lane.objs:
                    pygame.draw.rect(s, (150, 100, 50), (c*CELL+1, y+8, CELL-2, CELL-16), border_radius=6)
        py = (VIEW_ROWS - 1 - (g.row - base)) * CELL
        color = (255, 255, 255) if g.alive else (120, 120, 120)
        pygame.draw.rect(s, color, (g.col*CELL+10, py+8, CELL-20, CELL-14), border_radius=6)
        pygame.draw.polygon(s, (250, 170, 40), [(g.col*CELL+20, py+8), (g.col*CELL+28, py+8), (g.col*CELL+24, py+2)])
        s.blit(self.font.render(f"Score {g.score}", True, (255, 255, 255)), (8, 6))
        pygame.display.flip()
        self.clock.tick(fps)
        return True
