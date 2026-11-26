"""Collect BYBLOCK lines printed by real_eval.js into results/real_game_blocks.json.

  python tests/real_game_eval/collect_blocks.py <dir with *_lm0.out / *_lm1.out files>

File names must end in _lm0.out (original random levels) or _lm1.out (level-maker levels).
Every BYBLOCK line is one sample: {block: {games, mean, std, median, max}}.
"""
import glob, json, os, re, sys

src = sys.argv[1]
samples = []
for f in sorted(glob.glob(os.path.join(src, "*_lm[01].out"))):
    levels = "maker" if f.endswith("_lm1.out") else "original"
    for line in open(f, errors="ignore"):
        if "BYBLOCK" not in line:
            continue
        d = json.loads(line[line.index("{"):])
        for blk, v in d.items():
            samples.append(dict(block=blk, levels=levels, source=os.path.basename(f), **v))
# the original shipped player ("original" block) was measured earlier with the same harness (80 games per level kind)
old = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "results", "real_game_eval.json")
if os.path.exists(old):
    a = json.load(open(old))["after"]
    for key, lv in (("random_levels", "original"), ("maker_levels", "maker")):
        v = a[key]
        samples.append(dict(block="original", levels=lv, source="real_game_eval.json", games=v["games"], mean=v["mean"], std=v["std"], median=v["median"], max=v["max"]))
out = dict(
    note="Real Expo Crossy Road engine, headless Electron harness (tests/real_game_eval), learning off, AI vs AI. Rows beyond the start row. "
         "One sample = one run of real_eval.js (up to 80 games per block).",
    previous_shipped_player=dict(original=15.6, maker=5.4, games=80),
    samples=samples)
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "results", "real_game_blocks.json")
json.dump(out, open(dst, "w"), indent=1)
print(len(samples), "samples ->", os.path.normpath(dst))
