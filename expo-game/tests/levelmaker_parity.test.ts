// npx tsx tests/levelmaker_parity.test.ts <cases.json> <weights.json>   (run from expo-game/)
import { readFileSync } from "fs";
import { designRow, makeObs } from "../src/ai/levelMaker";
import { forward } from "../src/ai/policy";

const cases = JSON.parse(readFileSync(process.argv[2], "utf8"));
const weights = JSON.parse(readFileSync(process.argv[3], "utf8"));
let obsDiff = 0, qDiff = 0, actMismatch = 0;
for (const c of cases) {
  const o = makeObs(c.specs, c.idx);
  for (let i = 0; i < o.length; i++) obsDiff = Math.max(obsDiff, Math.abs(o[i] - c.obs[i]));
  const q = forward(weights, o);
  for (let i = 0; i < q.length; i++) qDiff = Math.max(qDiff, Math.abs(q[i] - c.q[i]));
  // greedy action: eps=0 by making rand() always return 1 (never < EPS)
  const act = designRow(weights, c.specs, c.idx, () => 0.999);
  if (act !== c.action) actMismatch++;
}
console.log(`cases ${cases.length} | max obs diff ${obsDiff} | max Q diff ${qDiff.toFixed(5)} | action mismatches ${actMismatch}`);
if (obsDiff > 0 || qDiff > 1e-2 || actMismatch > 0) { console.log("FAIL"); process.exit(1); }
console.log("PASS");
