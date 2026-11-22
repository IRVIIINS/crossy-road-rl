# Real-game evaluation (headless, ~50x faster than real time)

Runs the actual Expo game (not the simulator) with the player AI, no drawing and a virtual clock, and prints mean/std/median/max rows crossed.

    cd expo-game && npx expo export --platform web            # builds expo-game/dist
    cd ../desktop && npm install                               # electron
    # on Linux prefix with xvfb-run -a ; on macOS run directly
    ROUNDS=40 LM=1 RS=11 npx electron --no-sandbox ../tests/real_game_eval/real_eval.js

ROUNDS = rounds (2 AI games each), LM=1 level maker on / 0 off (original random levels), RS = random seed.
`?headless=1` skips rendering, `?learn=0` turns learning off, `preload.js` installs the virtual clock and a seeded Math.random.
