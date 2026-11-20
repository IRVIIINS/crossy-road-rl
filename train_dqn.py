"""Train a Double-DQN agent on Crossy Road.  python train_dqn.py --episodes 5000"""
import argparse, os, time
import numpy as np
from crossy_env import CrossyEnv
from expo_sim import ExpoCrossySim
from dqn_agent import DQNAgent

p = argparse.ArgumentParser()
p.add_argument("--episodes", type=int, default=5000)
p.add_argument("--max-steps", type=int, default=1500)
p.add_argument("--out", default="models")
p.add_argument("--seed", type=int, default=0)
p.add_argument("--resume", default=None, help="continue from a saved .pt (starts with low exploration)")
p.add_argument("--env", choices=["grid", "expo"], default="grid", help="grid = our simple game, expo = rules of expo-crossy-road")
a = p.parse_args()

os.makedirs(a.out, exist_ok=True)
env = ExpoCrossySim(a.seed) if a.env == "expo" else CrossyEnv(a.seed)
agent = DQNAgent(env.obs_size, env.n_actions)
if a.resume:
    agent.load(a.resume); agent.steps = agent.eps_decay
print("device:", agent.device)
scores, best_avg, t0 = [], -1, time.time()
for ep in range(1, a.episodes + 1):
    s = env.reset(); info = {}
    for _ in range(a.max_steps):
        act = agent.act(s)
        s2, r, done, info = env.step(act)
        agent.remember(s, act, r, s2, float(done))
        agent.learn()
        s = s2
        if done: break
    scores.append(info["score"])
    if ep % 50 == 0:
        avg = np.mean(scores[-50:])
        print(f"ep {ep:5d} | avg score(50) {avg:5.1f} | max {max(scores[-50:]):3d} | eps {agent.epsilon:.2f} | {time.time()-t0:.0f}s", flush=True)
        if avg > best_avg:
            best_avg = avg; agent.save(os.path.join(a.out, "best.pt"))
        agent.save(os.path.join(a.out, "latest.pt"))
