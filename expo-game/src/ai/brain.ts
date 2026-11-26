/**
 * The player AI's "brain": the live network, plus everything needed to keep learning from the real game and to
 * remember what it learned between sessions.
 *
 *  - act():        greedy action from the current network (a small epsilon of random moves while learning)
 *  - add():        every decision of every AI pane is stored as a transition (obs, action, reward, next obs, done)
 *  - trainRound(): after a round, a few hundred Double-DQN gradient steps on those transitions
 *                  (the same update rule as dqn_agent.py), in small time slices so the UI stays responsive
 *  - save()/load(): weights + learning log are stored in localStorage (survives closing the app)
 *
 * Pure TypeScript (no React Native imports) so it can be tested in Node against PyTorch.
 */
import { APP, LATEST, UNTRAINED, blockWeights, pcBlock } from "./blocks";

type Net = { dims: number[]; W: Float32Array[]; B: Float32Array[] };
export type Transition = { s: Float32Array; a: number; r: number; s2: Float32Array; done: number };
export type LearnEntry = {
  time: string; version: number; games: number; meanScore: number; transitions: number;
  updates: number; loss: number; totalUpdates: number;
};

const GAMMA = 0.97; // same as dqn_agent.py
const LR = 1e-4; // much smaller than training (5e-4): fine-tuning, not retraining
const BATCH = 32;
const CLIP = 10;
const TARGET_SYNC = 50; // updates
const BUFFER = 6000;
const EPS_EXPLORE = 0.05;
const KEY_NET = "crossy.brain.v1";
const KEY_LOG = "crossy.learning.v1";
const KEY_ON = "crossy.learning.on";

// ---------------------------------------------------------------- network
export function netFromJson(w: { layers: { w: number[][]; b: number[] }[] }): Net {
  const dims = [w.layers[0].w[0].length, ...w.layers.map((l) => l.b.length)];
  const W = w.layers.map((l) => Float32Array.from(l.w.flat()));
  const B = w.layers.map((l) => Float32Array.from(l.b));
  return { dims, W, B };
}
export const cloneNet = (n: Net): Net => ({ dims: n.dims.slice(), W: n.W.map((x) => x.slice()), B: n.B.map((x) => x.slice()) });
export function netToJson(n: Net) {
  return {
    layers: n.W.map((w, l) => {
      const i = n.dims[l], o = n.dims[l + 1];
      const rows: number[][] = [];
      for (let r = 0; r < o; r++) rows.push(Array.from(w.subarray(r * i, (r + 1) * i)).map((v) => Math.round(v * 1e6) / 1e6));
      return { w: rows, b: Array.from(n.B[l]).map((v) => Math.round(v * 1e6) / 1e6) };
    }),
  };
}

/** forward a batch; returns activations of every layer (post-ReLU for hidden, raw for output) */
function forwardBatch(n: Net, X: Float32Array, B: number) {
  const acts: Float32Array[] = [X];
  let cur = X;
  for (let l = 0; l < n.W.length; l++) {
    const i = n.dims[l], o = n.dims[l + 1], W = n.W[l], bias = n.B[l];
    const out = new Float32Array(B * o);
    const last = l === n.W.length - 1;
    for (let b = 0; b < B; b++) {
      const xo = b * i;
      for (let r = 0; r < o; r++) {
        let s = bias[r];
        const wo = r * i;
        for (let c = 0; c < i; c++) s += W[wo + c] * cur[xo + c];
        out[b * o + r] = last ? s : s > 0 ? s : 0;
      }
    }
    acts.push(out);
    cur = out;
  }
  return acts;
}

function qOne(n: Net, x: Float32Array): Float32Array {
  const a = forwardBatch(n, x, 1);
  return a[a.length - 1];
}

// ---------------------------------------------------------------- learner
export class Learner {
  net: Net;
  target: Net;
  m: Float32Array[]; v: Float32Array[]; mb: Float32Array[]; vb: Float32Array[];
  t = 0;
  updates = 0;
  constructor(net: Net, public lr = LR) {
    this.net = net;
    this.target = cloneNet(net);
    const z = (arr: Float32Array[]) => arr.map((x) => new Float32Array(x.length));
    this.m = z(net.W); this.v = z(net.W); this.mb = z(net.B); this.vb = z(net.B);
  }

  /** one Double-DQN + Huber + Adam step on a batch; returns the loss */
  step(batch: Transition[]): number {
    const n = this.net, L = n.W.length, B = batch.length, D = n.dims[0], A = n.dims[L];
    const X = new Float32Array(B * D), X2 = new Float32Array(B * D);
    batch.forEach((t, b) => { X.set(t.s, b * D); X2.set(t.s2, b * D); });
    // targets: online net picks the next action, target net scores it
    const qOnline2 = forwardBatch(n, X2, B)[L];
    const qTarget2 = forwardBatch(this.target, X2, B)[L];
    const acts = forwardBatch(n, X, B);
    const Q = acts[L];
    const dOut = new Float32Array(B * A);
    let loss = 0;
    for (let b = 0; b < B; b++) {
      let best = 0;
      for (let a = 1; a < A; a++) if (qOnline2[b * A + a] > qOnline2[b * A + best]) best = a;
      const y = batch[b].r + GAMMA * qTarget2[b * A + best] * (1 - batch[b].done);
      const q = Q[b * A + batch[b].a];
      const diff = q - y, ad = Math.abs(diff);
      loss += (ad < 1 ? 0.5 * diff * diff : ad - 0.5) / B;
      dOut[b * A + batch[b].a] = Math.max(-1, Math.min(1, diff)) / B;
    }
    // backward
    const gW: Float32Array[] = new Array(L), gB: Float32Array[] = new Array(L);
    let dZ = dOut;
    for (let l = L - 1; l >= 0; l--) {
      const i = n.dims[l], o = n.dims[l + 1], W = n.W[l], Aprev = acts[l];
      const dW = new Float32Array(W.length), dB = new Float32Array(o);
      for (let b = 0; b < B; b++) {
        for (let r = 0; r < o; r++) {
          const g = dZ[b * o + r];
          if (g === 0) continue;
          dB[r] += g;
          const wo = r * i, xo = b * i;
          for (let c = 0; c < i; c++) dW[wo + c] += g * Aprev[xo + c];
        }
      }
      gW[l] = dW; gB[l] = dB;
      if (l > 0) {
        const dA = new Float32Array(B * i);
        for (let b = 0; b < B; b++)
          for (let r = 0; r < o; r++) {
            const g = dZ[b * o + r];
            if (g === 0) continue;
            const wo = r * i, xo = b * i;
            for (let c = 0; c < i; c++) dA[xo + c] += g * W[wo + c];
          }
        for (let k = 0; k < dA.length; k++) if (acts[l][k] <= 0) dA[k] = 0; // ReLU'
        dZ = dA;
      }
    }
    // gradient clipping (global norm), then Adam
    let sq = 0;
    for (let l = 0; l < L; l++) { for (const x of gW[l]) sq += x * x; for (const x of gB[l]) sq += x * x; }
    const scale = Math.sqrt(sq) > CLIP ? CLIP / (Math.sqrt(sq) + 1e-6) : 1;
    this.t++;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
    const upd = (p: Float32Array, g: Float32Array, m: Float32Array, v: Float32Array) => {
      for (let k = 0; k < p.length; k++) {
        const gk = g[k] * scale;
        m[k] = b1 * m[k] + (1 - b1) * gk;
        v[k] = b2 * v[k] + (1 - b2) * gk * gk;
        p[k] -= (this.lr * (m[k] / c1)) / (Math.sqrt(v[k] / c2) + eps);
      }
    };
    for (let l = 0; l < L; l++) { upd(n.W[l], gW[l], this.m[l], this.v[l]); upd(n.B[l], gB[l], this.mb[l], this.vb[l]); }
    this.updates++;
    if (this.updates % TARGET_SYNC === 0) this.target = cloneNet(n);
    return loss;
  }
}

// ---------------------------------------------------------------- brain (shared by every AI pane)
const b64 = (a: Float32Array) => {
  let s = ""; const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u.subarray(i, i + 0x8000)));
  return btoa(s);
};
const unb64 = (s: string) => {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Float32Array(u.buffer);
};
const ls = () => { try { return window.localStorage; } catch { return null; } };

export class Brain {
  private nets: Record<string, Net> = {};
  /** the fixed network of a PC training block (see blocks.ts) */
  netFor(id: string): Net {
    if (!this.nets[id]) this.nets[id] = netFromJson((id === UNTRAINED || pcBlock(id) ? blockWeights(id) : null) ?? blockWeights(LATEST));
    return this.nets[id];
  }
  base = LATEST; // the PC block that in-app learning started from
  get original() { return this.netFor(this.base); }
  learner = new Learner(cloneNet(this.netFor(LATEST)));
  buffer: Transition[] = [];
  fresh: Transition[] = []; // this round's transitions (decide how many updates to do)
  gameScores: number[] = []; // AI scores since the last trainRound
  learningEnabled = true;
  version = 0; // number of completed learning rounds, ever
  games = 0;
  totalTransitions = 0;
  log: LearnEntry[] = [];
  busy = false;

  constructor() {
    this.load();
    // ?learn=0 -> deterministic, no learning, nothing written (used by evaluations)
    try { if (new URLSearchParams(window.location.search).get("learn") === "0") this.learningEnabled = false; } catch {}
  }

  /** learning ON: the policy that has been learning; OFF: the newest PC block */
  get net() { return this.learningEnabled ? this.learner.net : this.netFor(LATEST); }
  get totalUpdates() { return this.learner.updates; }
  /** block an AI pane uses unless one is picked: the in-app learner while learning is ON, else the newest PC block */
  defaultBlock() { return this.learningEnabled ? APP : LATEST; }

  /** block = a PC block id (fixed network, greedy) or "app" (the in-app learner, explores a little while learning) */
  act(obs: Float32Array, block: string = this.defaultBlock()): number {
    const app = block === APP;
    if (app && this.learningEnabled && Math.random() < EPS_EXPLORE) return Math.floor(Math.random() * 5);
    const q = qOne(app ? this.learner.net : this.netFor(block), obs);
    let best = 0;
    for (let i = 1; i < q.length; i++) if (q[i] > q[best]) best = i;
    return best;
  }

  add(t: Transition) {
    if (!this.learningEnabled) return;
    this.buffer.push(t); this.fresh.push(t);
    if (this.buffer.length > BUFFER) this.buffer.shift();
  }

  recordGame(score: number) {
    if (!this.learningEnabled) return;
    this.gameScores.push(score);
  }

  /** Learn from what just happened. Time-sliced; calls onProgress(done, total). Saves at the end. */
  async trainRound(onProgress?: (done: number, total: number) => void): Promise<LearnEntry | null> {
    if (!this.learningEnabled || this.busy) { this.fresh = []; this.gameScores = []; return null; }
    if (this.buffer.length < BATCH) return null; // too little experience yet: keep it and learn after the next round
    this.busy = true;
    const total = Math.max(30, Math.min(150, this.fresh.length * 3));
    let lossSum = 0;
    for (let i = 0; i < total; i++) {
      const batch: Transition[] = [];
      for (let k = 0; k < BATCH; k++) batch.push(this.buffer[Math.floor(Math.random() * this.buffer.length)]);
      lossSum += this.learner.step(batch);
      if (i % 4 === 3 || i === total - 1) {
        onProgress?.(i + 1, total);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    this.version++;
    this.games += this.gameScores.length;
    this.totalTransitions += this.fresh.length;
    const mean = this.gameScores.length ? this.gameScores.reduce((a, b) => a + b, 0) / this.gameScores.length : 0;
    const entry: LearnEntry = {
      time: new Date().toISOString(), version: this.version, games: this.gameScores.length,
      meanScore: Math.round(mean * 100) / 100, transitions: this.fresh.length, updates: total,
      loss: Math.round((lossSum / total) * 1e5) / 1e5, totalUpdates: this.learner.updates,
    };
    this.log.push(entry);
    this.fresh = []; this.gameScores = [];
    this.save();
    this.busy = false;
    return entry;
  }

  save() {
    const s = ls(); if (!s) return;
    try {
      const n = this.learner.net;
      s.setItem(KEY_NET, JSON.stringify({
        dims: n.dims, base: this.base, version: this.version, games: this.games, transitions: this.totalTransitions, updates: this.learner.updates,
        W: n.W.map(b64), B: n.B.map(b64),
      }));
      s.setItem(KEY_LOG, JSON.stringify(this.log.slice(-500)));
    } catch (e) { console.warn("could not save brain", e); }
  }

  load() {
    const s = ls(); if (!s) return;
    try {
      this.learningEnabled = s.getItem(KEY_ON) === "1"; // opt-in: naive online fine-tuning made the policy worse in our simulator test
      this.log = JSON.parse(s.getItem(KEY_LOG) || "[]");
      const raw = s.getItem(KEY_NET);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (JSON.stringify(d.dims) !== JSON.stringify(this.netFor(LATEST).dims)) return; // different architecture: ignore
      this.base = d.base && pcBlock(d.base) ? d.base : "original"; // saved before blocks existed: learned on top of the original player
      this.learner = new Learner({ dims: d.dims, W: d.W.map(unb64), B: d.B.map(unb64) });
      this.learner.updates = d.updates || 0;
      this.version = d.version || 0; this.games = d.games || 0; this.totalTransitions = d.transitions || 0;
    } catch (e) { console.warn("could not load brain", e); }
  }

  setLearning(on: boolean) {
    this.learningEnabled = on;
    try { ls()?.setItem(KEY_ON, on ? "1" : "0"); } catch {}
  }

  /** forget everything learned in the app and start again from a PC block (default: the newest) */
  reset(base: string = LATEST) {
    this.base = pcBlock(base) ? base : LATEST;
    this.learner = new Learner(cloneNet(this.netFor(this.base)));
    this.buffer = []; this.fresh = []; this.gameScores = []; this.log = [];
    this.version = 0; this.games = 0; this.totalTransitions = 0;
    const s = ls(); try { s?.removeItem(KEY_NET); s?.removeItem(KEY_LOG); } catch {}
  }

  exportWeightsJson() { return JSON.stringify(netToJson(this.learner.net)); }
  logCsv() {
    const cols = ["time", "version", "games", "meanScore", "transitions", "updates", "loss", "totalUpdates"];
    return [cols.join(","), ...this.log.map((e) => cols.map((c) => (e as any)[c]).join(","))].join("\n") + "\n";
  }
}

export const brain = new Brain();

// handy for debugging / the report: open DevTools and inspect window.__crossyBrain
if (typeof window !== "undefined") (window as any).__crossyBrain = brain;
