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
* `expo-game/src/ai/` – observation builder + network + autopilot. Run it: `cd expo-game && npm install && npx expo start --web`, then pick **YOU vs AI** or **AI vs AI** on the menu (or open `?mode=you-vs-ai` / `?mode=ai-vs-ai`). See `expo-game/AI_AUTOPILOT.md`.

`models/expo_best.pt` scores about 24 rows on average in the simulator (random play: about 1.4; best run 104). Not tested inside the real game yet; train trains/rail rows are not modelled.

## Versions and Mac apps (download from Releases, no terminal build)

| version | what | Mac app |
|---|---|---|
| **v1** | first version: simple 2D game + DQN agent | source only |
| **v2** | improved 2D pygame game (smooth art) + AI | `Crossy Road v2.app` |
| **v3** | the real expo-crossy-road 3D game (3D graphics and gameplay) + the AI autopilot | `Crossy Road v3.app` |

GitHub builds the apps (Actions -> *Build releases*). Install v3 (v2 is the same with `v2`); each version has its own app name, so they never overwrite each other:
```bash
cd ~/Downloads && curl -L -o CrossyRoad-v3-mac.zip https://github.com/IRVIIINS/crossy-road-rl/releases/download/v3/CrossyRoad-v3-mac.zip && ditto -x -k CrossyRoad-v3-mac.zip /Applications && xattr -cr "/Applications/Crossy Road v3.app" && open "/Applications/Crossy Road v3.app"
```
v3 is in `desktop/` (Electron window around `expo-game/`). Menu: **YOU vs AI** (you on the left, the AI on the right, same road) and **AI vs AI** (two AIs, one road each). Keys: 1 / 2 pick a mode, R restart, Esc back to the menu.

### (Optional) simple 2D pygame app

`./build_mac.sh` builds `dist/Crossy Road AI.app` (the v2 app, locally) with PyInstaller (native arm64 on Apple Silicon). It has a menu to play yourself or watch the AI,
and needs no PyTorch at runtime (`models/grid_best.npz` is the exported network; regenerate with `python export_numpy.py models/best.pt models/grid_best.npz`).
Quick run without building: `python native_app.py`.
