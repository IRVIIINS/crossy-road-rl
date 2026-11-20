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

Open the page with `?ai=1` on the end of the URL (e.g. `http://localhost:8081/?ai=1`) to let the AI play,
or press **P** to toggle it while playing. Tap/click to start the game as usual.

## Re-train / improve the AI

In the `crossy-road-rl` repo: `python train_dqn.py --env expo --episodes 20000`, then
`python export_weights.py models/best.pt weights.json` and copy `weights.json` to `src/ai/weights.json`.

## Known limits

* Trained on a Python re-implementation of this game's rules (`expo_sim.py`): trains/rail rows aren't modelled (the AI treats them like roads and may get hit), and car/log widths are assumptions.
* Game speeds are per frame, so on a 120 Hz screen the whole game runs 2x faster; the AI assumes 60 fps.
