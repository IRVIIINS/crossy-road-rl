"""Run a trained agent. --render to watch it. python evaluate.py --render"""
import argparse, os
import numpy as np
from crossy_env import CrossyEnv
from dqn_agent import DQNAgent

p = argparse.ArgumentParser()
p.add_argument("--model", default="models/best.pt")
p.add_argument("--episodes", type=int, default=20)
p.add_argument("--render", action="store_true")
p.add_argument("--fps", type=int, default=8, help="agent moves per second")
a = p.parse_args()

env = CrossyEnv(seed=123)
agent = DQNAgent(env.obs_size, env.n_actions, device="cpu")
agent.load(a.model)
renderer = None
if a.render:
    from crossy_render import Renderer
    renderer = Renderer(env.game)
scores = []
for ep in range(a.episodes):
    s = env.reset(); done = False
    while not done:
        s, r, done, info = env.step(agent.act(s, greedy=True))
        if renderer and not renderer.run_ticks(1.0 / a.fps): raise SystemExit
        if env.game.t > 3000: break
    scores.append(info["score"]); print(f"episode {ep+1}: score {info['score']} ({info['death']})")
print(f"mean {np.mean(scores):.1f}  max {max(scores)}")
