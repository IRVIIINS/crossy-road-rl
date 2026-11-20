/**
 * Neural-network autopilot, trained in Python (see the `crossy-rl` repo, `expo_sim.py`).
 * Pure TypeScript with no React Native imports, so it can be unit-tested in Node.
 *
 * The observation MUST match `ExpoCrossySim.obs()` in Python exactly.
 */
export type Action = 0 | 1 | 2 | 3 | 4; // STAY, UP, DOWN, LEFT, RIGHT
export const ACTION_NAMES = ["STAY", "UP", "DOWN", "LEFT", "RIGHT"];

const BACK = 2;
const AHEAD = 5;
const VIEW_ROWS = BACK + 1 + AHEAD;
const BINS = 17;
const FUTURE = [0, 6, 12]; // occupancy now, and after 6 / 12 frames
const OBS_PER_ROW = 4 + 9 + BINS * FUTURE.length + 1;
export const OBS_SIZE = VIEW_ROWS * OBS_PER_ROW + 1;

type Entity = { mesh: { position: { x: number } }; speed: number; collisionBox: number };

/** Minimal shape of the game's row map (CrossyGameMap) that we need. */
export interface RowLike {
  type: string;
  entity: any;
}
export interface MapLike {
  getRow(z: number): RowLike | undefined;
}

// kind: 0 grass, 1 road, 2 lily-pad water, 3 log water
function rowKind(row: RowLike, z: number): number {
  if (row.type === "grass") return 0;
  if (row.type === "water") return z % 2 === 0 ? 2 : 3;
  return 1; // road (and rail road, treated like a road)
}

function entitiesOf(row: RowLike): Entity[] {
  if (row.type === "road") return row.entity.cars ?? [];
  if (row.type === "water") return row.entity.entities ?? [];
  return [];
}

export function buildObservation(map: MapLike, heroX: number, heroZ: number): Float32Array {
  const o = new Float32Array(OBS_SIZE);
  const cols: number[] = [];
  for (let k = -4; k <= 4; k++) cols.push(Math.round(heroX) + k);
  for (let i = 0; i < VIEW_ROWS; i++) {
    const z = heroZ - BACK + i;
    const base = i * OBS_PER_ROW;
    if (z < 0) {
      for (let j = 0; j < 9; j++) o[base + 4 + j] = 1;
      continue;
    }
    const row = map.getRow(z);
    if (!row) continue;
    const kind = rowKind(row, z);
    o[base + kind] = 1;
    for (let j = 0; j < 9; j++) {
      const c = cols[j];
      if (row.type === "grass" && `${c | 0}` in row.entity.obstacleMap) o[base + 4 + j] = 1;
      if (Math.abs(c) > 4) o[base + 4 + j] = 1;
    }
    const ents = entitiesOf(row);
    if (row.type !== "railRoad" && ents.length) {
      FUTURE.forEach((df, f) => {
        for (let k = 0; k < BINS; k++) {
          const bx = heroX + (k - 8) * 0.5;
          for (const e of ents) {
            const ex = ((((e.mesh.position.x + e.speed * df + 11) % 22) + 22) % 22) - 11;
            if (Math.abs(bx - ex) < e.collisionBox) {
              o[base + 13 + f * BINS + k] = 1;
              break;
            }
          }
        }
      });
    }
    if ((kind === 1 || kind === 3) && ents.length && row.type !== "railRoad") {
      o[base + 13 + BINS * FUTURE.length] = ents[0].speed / 0.08; // speed is already signed by direction
    }
  }
  o[VIEW_ROWS * OBS_PER_ROW] = heroX / 5;
  return o;
}

export type Layer = { w: number[][]; b: number[] };
export type Weights = { layers: Layer[] };

export function forward(weights: Weights, x: Float32Array): Float32Array {
  let cur: ArrayLike<number> = x;
  weights.layers.forEach((layer, li) => {
    const out = new Float32Array(layer.b.length);
    for (let r = 0; r < out.length; r++) {
      const wr = layer.w[r];
      let s = layer.b[r];
      for (let c = 0; c < wr.length; c++) s += wr[c] * cur[c];
      out[r] = li < weights.layers.length - 1 ? Math.max(0, s) : s;
    }
    cur = out;
  });
  return cur as Float32Array;
}

export function chooseAction(weights: Weights, map: MapLike, heroX: number, heroZ: number): Action {
  const q = forward(weights, buildObservation(map, heroX, heroZ));
  let best = 0;
  for (let i = 1; i < q.length; i++) if (q[i] > q[best]) best = i;
  return best as Action;
}
