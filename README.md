# Crossy Road + Deep Q-Learning

Same layout as the Flappy Bird project: game -> env -> DQN agent -> train/evaluate.

| file | what |
|---|---|
| `crossy_game.py` | game rules (grass / road with cars / river with logs), no pygame needed |
| `crossy_env.py` | Gym-style `reset()/step()`; observation = 9x9-wide, 9-row window centred on the player |
| `crossy_render.py` | pygame drawing |
| `play.py` | play it yourself (arrows/WASD, space = wait, R = restart) |
| `dqn_agent.py` | Double DQN, replay buffer, target network |
| `train_dqn.py` | `python train_dqn.py --episodes 5000` (uses CUDA automatically) |
| `evaluate.py` | `python evaluate.py --render` to watch the trained agent |

Setup: `pip install -r requirements.txt`

Reward: +1 per new row reached, -0.02 per tick, -1 on death.
Deaths: hit by car, drowned, carried off screen by a log, or eagle (idle too long).
`models/best.pt` is a short 5-minute CPU run (avg ~7 rows, random play ~2.3): train longer for better.

Why the observation is centred on the player: with absolute columns the net did not
learn at all (stuck near random, ~2.7); centring made it learn within minutes.
