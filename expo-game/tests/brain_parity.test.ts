// run: npx tsx tests/brain_parity.test.ts   (after python tests/make_brain_case.py from the repo root)
import fs from "fs";
import { Learner, netFromJson, netToJson } from "../src/ai/brain";
const w = JSON.parse(fs.readFileSync("src/ai/weights.json", "utf8"));
const c = JSON.parse(fs.readFileSync("tests/brain_case.json", "utf8"));
const L = new Learner(netFromJson(w));
const losses: number[] = [];
for (const b of c.batches) {
  losses.push(L.step(b.s.map((_: any, i: number) => ({ s: Float32Array.from(b.s[i]), s2: Float32Array.from(b.s2[i]), a: b.a[i], r: b.r[i], done: b.d[i] }))));
}
const out = netToJson(L.net);
let maxd = 0;
out.layers.forEach((l, i) => {
  l.w.forEach((row, r) => row.forEach((v, k) => (maxd = Math.max(maxd, Math.abs(v - c.final.layers[i].w[r][k])))));
  l.b.forEach((v, k) => (maxd = Math.max(maxd, Math.abs(v - c.final.layers[i].b[k]))));
});
const ld = Math.max(...losses.map((x, i) => Math.abs(x - c.losses[i])));
console.log("max |weight diff| vs PyTorch after 3 steps:", maxd.toExponential(2), " max loss diff:", ld.toExponential(2));
if (maxd > 2e-5 || ld > 1e-4) { console.error("FAIL"); process.exit(1); }
console.log("PASS");
