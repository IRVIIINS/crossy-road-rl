"""Dump test cases for the TypeScript port of the level maker:  python tests/make_levelmaker_cases.py <weights.pt> <out.json>"""
import json, random, sys
sys.path.insert(0, ".")
import numpy as np
from level_maker import LevelMaker, make_obs, legal_mask
lm = LevelMaker.load(sys.argv[1], eps=0.0)
rng = random.Random(0); cases = []
for _ in range(300):
    n = rng.randint(10, 60)
    specs = [0] * 10
    while len(specs) < n:
        m = legal_mask(specs)
        specs.append(int(rng.choice(list(np.flatnonzero(m)))))
    idx = len(specs)
    cases.append(dict(specs=specs, idx=idx, obs=[float(x) for x in make_obs(specs, idx)],
                      q=[float(x) for x in lm.q(specs, idx)], action=lm(specs, idx)))
json.dump(cases, open(sys.argv[2], "w"))
print(len(cases), "cases")
