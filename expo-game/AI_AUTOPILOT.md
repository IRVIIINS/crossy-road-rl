# AI autopilot (added on top of expo-crossy-road)

A small neural network (Double DQN trained in Python) plays the real game.

* `src/ai/policy.ts` – builds the observation from the game's live rows and runs the network (pure TypeScript).
* `src/ai/AutoPilot.ts` – every 12 game frames, if the hero isn't mid-hop, asks the network for a move and calls `engine.moveWithDirection`.
* `src/ai/weights.json` – the trained weights, exported by `export_weights.py` in the `crossy-road-rl` repo.
* `src/GameEngine.ts` – 2 added lines (create the autopilot, call `update()` each tick).

## Run

```bash
npm install        # or bun install
npx expo start --web
```

The game menu has **YOU vs AI** and **AI vs AI** (web: `?mode=you-vs-ai` or `?mode=ai-vs-ai`); the AI pane switches the autopilot on, to let the AI play,
Tap/click or arrow keys / WASD to play your own chicken.

## Re-train / improve the AI

In the `crossy-road-rl` repo: `python train_dqn.py --env expo --episodes 20000`, then
`python export_weights.py models/best.pt weights.json` and copy `weights.json` to `src/ai/weights.json`.

## Known limits

* Trained on a Python re-implementation of this game's rules (`expo_sim.py`): trains/rail rows aren't modelled (the AI treats them like roads and may get hit), and car/log widths are assumptions.
* Game speeds are per frame, so on a 120 Hz screen the whole game runs 2x faster; the AI assumes 60 fps.

## Training blocks (menu 3)

Every trained player is a **block**: one per training round on the PC, plus the player that learns inside the app.

* **TRAINING BLOCKS** screen: *Each block* shows what a block trained on, how long, its test scores, its learning curve, and buttons to
  watch it (alone, against the block before it, or against you). *Cumulative* adds everything up: games and CPU-hours of all blocks,
  the score after each block, and the winning player's learning curve across blocks (and the in-app learning after it).
* **YOU vs AI / AI vs AI**: a **BRAIN** picker under each AI pane chooses the block, and the pane's label shows which block is playing.
  Two different blocks race on the same road; two copies of the same block get different roads.
* Only the **In-app learned** brain learns (Settings or the blocks screen: Learning ON). PC blocks are fixed.

Add a training round (from the repo root, after `overnight.py` finished and wrote `results_bundle.zip`):

```bash
python add_stage.py --bundle results_bundle_round1.zip --id round1 --label "PC round 1" --date 2026-11-23
```

This writes `training_rounds/<id>/` (tables, every run's learning curve and log), `models/expo_<id>.pt`,
`src/ai/stages/<id>.json` and updates `src/ai/stages/stages.json` + `index.ts`. Use `--continues <id>` when the round resumed
an earlier round's runs, `--starts-from <id>` when it fine-tuned from an earlier block (`overnight.py --init`).
