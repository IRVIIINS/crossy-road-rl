# Technical documentation

How the Crossy Road RL project works, end to end. (Same role as `DOCUMENTATION.md` in the Flappy Bird repo.)

## 1. Problem

Learn to play Crossy Road with reinforcement learning. The agent hops forward across grass, roads (cars) and
rivers (logs / lily pads) and is scored by how many rows it crosses. Unlike Flappy Bird (one decision: flap or
not), the agent must read several lanes of moving objects, predict where they will be, and choose among
5 actions: stay, up, down, left, right.

## 2. Environments

| File | What it is |
|---|---|
| `crossy_game.py`, `crossy_env.py` | Our own small grid game (v1/v2), Gym-style `reset()/step()`. Observation: 8 rows x 9 columns x 5 channels around the player. |
| `expo_sim.py` | Headless Python re-implementation of the **rules** of [evanbacon/expo-crossy-road](https://github.com/evanbacon/expo-crossy-road) (frame-based cars/logs, 12-frame hops, lily pads, logs you ride). Used for training because the real game is a 3D app. |
| `expo-game/` | The real 3D game (React Native Web + THREE.js) with the AI autopilot added (`expo-game/src/ai/`). |

### Observation of `expo_sim.py` (521 numbers; 249 without look-ahead)
For each of 8 rows around the player (2 behind, the current one, 5 ahead): row type (one-hot), where the trees are
(9 columns), **occupancy planes** (17 x-positions at 0.5 spacing around the player) for cars/logs *now, in 6 frames
and in 12 frames*, the row's signed speed, plus the player's x position. The future planes are the main idea:
objects move deterministically, so the planes tell the network where they *will be* when the hop lands.

### Reward
`-0.02` per step (don't dawdle) `+1` per new row reached, `-1` on death. Episode ends on death, after 25 idle steps
("too slow") or when the camera scrolls past you ("fell behind").

## 3. Agent (`dqn_agent.py`)

Double DQN in PyTorch: MLP 521 -> 256 -> 128 -> 5, Adam (lr 5e-4), gamma 0.97, replay buffer 100k, batch 128,
Huber loss, gradient clipping at 10, target network synced every 1000 steps, epsilon-greedy 1.0 -> 0.05 over 50k
steps. `double=False` gives plain DQN (used as an ablation). Same family as the Flappy Bird agent
(replay buffer, target net, epsilon-greedy); differences are Double-DQN targets, Huber loss and the much richer observation.

## 4. Training

* `train_dqn.py` - plain fixed-length training (`--env expo --episodes 20000`). Produced the shipped model.
* `train_iterative.py` - **iterative training with early stopping** (like the Flappy repo's `train_iterative.py`):
  rounds of 200 episodes -> greedy evaluation on fixed seeds -> log + checkpoint -> keep best -> stop at target or
  after `--patience` rounds (default 15) without a new best, counted only after exploration has finished and `--min-iters` (default 30) rounds
  have passed, because this agent often starts learning late (~episode 3000+).
  Writes `iterations.csv`, `episodes.csv`, `checkpoints/iter_XX.pt`, `best.pt`, `final.pt`, `run.json`, `learning_curve.png`.
* `run_experiments.py` - runs every config x seed (3 ablation configs) in parallel; resumable.
* `make_report.py` - held-out test of every run's `best.pt` + baselines -> `results/` (tables, CSVs, figures, `summary.json`)
  and copies them into the app so **Settings** can show/export them.

## 4b. The three AIs

| # | AI | What it does | Files |
|---|---|---|---|
| 1 | **Player AI** | plays the chicken (Double DQN, 521 -> 256 -> 128 -> 5) | `dqn_agent.py`, `train_*.py`, `expo-game/src/ai/{policy,AutoPilot}.ts` |
| 2 | **Opponent AI** | the same player network, used as the second contestant in **AI vs AI** (and as your opponent in **YOU vs AI**) | same as #1 |
| 3 | **Level-maker AI** | a second DQN (26 -> 64 -> 64 -> 6) that chooses what every new row is: grass, road slow/medium/fast, river slow/fast | `level_maker.py`, `train_level_maker.py`, `eval_level_maker.py`, `expo-game/src/ai/levelMaker.ts` |

**Level maker.** State: the last 4 rows it built, whether the next row is even/odd (even rivers are lily pads, odd rivers have
logs) and the current run of road/river rows. Reward: +1 when the (frozen) player AI dies on a row the maker built, -0.05 for each
row the player crosses safely. Fairness is enforced by an action mask: after 3 road/river rows in a row it must build grass, and speeds
stay inside the original game's ranges, so every level is one the normal random generator could also have produced.
At play time it picks a random legal row 15% of the time for variety. It is always on in the app (`?levelmaker=0` in the web URL switches
back to the original random generator for comparison). The levels of one match are the same for both boards in **YOU vs AI**.
The TypeScript port is parity-tested against Python (`expo-game/tests/levelmaker_parity.test.ts`: identical inputs, Q-values within 1e-4, identical actions).

## 5. Experiments (see `results/tables.md`)

| Config | What changes | Question |
|---|---|---|
| `main` | Double DQN + look-ahead planes (0, 6, 12 frames) | the model we ship |
| `no_future` | observation only has the *present* (frame offset 0) | do look-ahead features matter? |
| `vanilla` | plain DQN target | does Double DQN matter? |
| baselines | random, always-UP, hand-written reactive rule | does learning beat simple rules? |
| level maker | 3 level-maker AIs (own seeds) vs the original random generator; 5 players, 200 held-out levels each | can an AI build harder levels, and does it generalise to players it never saw? |

Protocol: every run trains with its own seed; the model is selected on evaluation seeds 10000-10049 during training,
then **re-tested on 200 unseen seeds (20000+)**. We report mean +- std across training seeds, not a single lucky run.

## 6. From Python to the real game

1. `export_weights.py` writes the network to `expo-game/src/ai/weights.json`.
2. `expo-game/src/ai/policy.ts` rebuilds the same observation from the live game state and runs the network in pure
   TypeScript (parity-tested against Python: identical observations on 400 states, Q-values within 3e-4).
3. `AutoPilot.ts` decides every 12 frames when the chicken is not hopping. The real game's swipe directions are
   mirrored left/right relative to the simulator; the autopilot compensates.

**Known limitation (sim-to-real gap).** The agent scores about 24 rows in the simulator but only about 1-7 in
the real game in short headless trials. The simulator omits train/rail rows, assumes some object widths, and the real game's
timing differs slightly. This is worth a paragraph in the report (domain gap) and is the obvious next improvement
(train against the real game's exact dimensions / include rails / domain randomization).

## 7. The app

`desktop/` wraps the exported web build in Electron. Menu: **YOU vs AI**, **AI vs AI**, **SETTINGS**.
Settings = data screen: experiment tables/figures with CSV/JSON/PNG downloads, plus a log of every round played in the app
(`matches.csv`). Release builds come from `.github/workflows/build-mac.yml`.
