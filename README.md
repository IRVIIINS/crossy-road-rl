# Crossy Road + Deep Q-Learning

Same layout as the Flappy Bird project: game -> env -> DQN agent -> train/evaluate.

| file | what |
|---|---|
| `crossy_game.py` | game rules (grass / road with cars / river with logs), no pygame needed |
| `crossy_env.py` | Gym-style `reset()/step()`; observation = 9x9-wide, 9-row window centred on the player |
| `crossy_render.py` | pygame drawing: anti-aliased art, smooth 120 fps animation (hopping chicken, sliding cars/logs, gliding camera) |
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

## Play it in the real Crossy Road clone (Expo / THREE.js)

`expo-game/` is a copy of [evanbacon/expo-crossy-road](https://github.com/evanbacon/expo-crossy-road) (MIT license, kept in `expo-game/LICENSE`;
the author says it is for educational purposes) with an **AI autopilot** added. The network is trained here in Python and runs inside the game in TypeScript.

* `expo_sim.py` – Python re-implementation of that game's rules (frame-based cars/logs, 0.2 s hops, lily pads, logs). Trains fast, no graphics.
* `python train_dqn.py --env expo --episodes 20000` – train on it (keeps `models/best.pt`).
* `python export_weights.py models/expo_best.pt expo-game/src/ai/weights.json` – export the network for the game.
* `expo-game/src/ai/` – observation builder + network + autopilot. Run it: `cd expo-game && npm install && npx expo start --web`, then open the page with `?ai=1` (or press **P**). See `expo-game/AI_AUTOPILOT.md`.

`models/expo_best.pt` scores about 24 rows on average in the simulator (random play: about 1.4; best run 104). Not tested inside the real game yet; train trains/rail rows are not modelled.
