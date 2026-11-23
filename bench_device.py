"""How fast is one training worker on CPU vs GPU?  python bench_device.py
Plays the same 3000 learning steps on each device and prints ms per step. Use the faster one with overnight.py --device ..."""
import time, torch
from expo_sim import ExpoCrossySim
from dqn_agent import DQNAgent

torch.set_num_threads(1)


def bench(device, steps=3000):
    env = ExpoCrossySim(1); ag = DQNAgent(env.obs_size, 5, device=device); s = env.obs(); n = 0
    for _ in range(2500):                                       # fill the replay buffer so every step learns
        s2, r, d, _ = env.step(ag.act(s)); ag.remember(s, 0, r, s2, float(d)); s = s2
        if d: env = ExpoCrossySim(len(ag.mem)); s = env.obs()
    t = time.perf_counter()
    while n < steps:
        a = ag.act(s); s2, r, d, _ = env.step(a); ag.remember(s, a, r, s2, float(d)); ag.learn(); s = s2; n += 1
        if d: env = ExpoCrossySim(n); s = env.obs()
    return 1000 * (time.perf_counter() - t) / steps


print(f"cpu : {bench('cpu'):.2f} ms/step")
if torch.cuda.is_available():
    bench("cuda", 300)                                          # warm-up
    print(f"cuda: {bench('cuda'):.2f} ms/step  ({torch.cuda.get_device_name(0)})")
else:
    print("cuda: not available (CPU-only torch installed, or no NVIDIA driver)")
