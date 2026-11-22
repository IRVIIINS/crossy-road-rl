/**
 * The level-maker AI (third AI of the project). A small DQN trained in Python (level_maker.py /
 * train_level_maker.py) that chooses what each new row is. Pure TypeScript, must match level_maker.py exactly.
 *
 * Row types: 0 grass | 1 road slow | 2 road medium | 3 road fast | 4 river slow | 5 river fast
 */
import { Weights, forward } from "./policy";

export const N_DESIGN = 6;
const K = 4;
const MAX_HAZARD_RUN = 3; // fairness rule: at most 3 road/river rows in a row, then grass
const EPS = 0.15; // chance of a random legal row, for variety
export const OBS = K * N_DESIGN + 2;

// Speed ranges stay inside the original game's ranges (road .02-.08, river .02-.07).
export const ROAD_SPEEDS: [number, number][] = [
  [0.02, 0.04],
  [0.04, 0.06],
  [0.06, 0.08],
];
export const WATER_SPEEDS: [number, number][] = [
  [0.02, 0.045],
  [0.045, 0.07],
];

function hazardRun(specs: number[]): number {
  let n = 0;
  for (let i = specs.length - 1; i >= 0; i--) {
    if (specs[i] === 0) break;
    n++;
  }
  return n;
}

export function makeObs(specs: number[], idx: number): Float32Array {
  const o = new Float32Array(OBS);
  for (let j = 0; j < K; j++) {
    const k = specs.length - 1 - j;
    o[j * N_DESIGN + (k >= 0 ? specs[k] : 0)] = 1;
  }
  o[K * N_DESIGN] = idx % 2;
  o[K * N_DESIGN + 1] = Math.min(hazardRun(specs), MAX_HAZARD_RUN) / MAX_HAZARD_RUN;
  return o;
}

/** Decide the row type for row `idx`, given the types of all rows before it. */
export function designRow(weights: Weights, specs: number[], idx: number, rand: () => number = Math.random): number {
  const legal: number[] = [];
  for (let a = 0; a < N_DESIGN; a++) if (a === 0 || hazardRun(specs) < MAX_HAZARD_RUN) legal.push(a);
  if (rand() < EPS) return legal[Math.floor(rand() * legal.length)];
  const q = forward(weights, makeObs(specs, idx));
  let best = legal[0];
  for (const a of legal) if (q[a] > q[best]) best = a;
  return best;
}
