import { swipeDirections } from "@/components/GestureView";
import { ACTION_NAMES, buildObservation } from "./policy";
import { brain } from "./brain";

const START_ROW = 8; // hero starts on row 8 (GameSettings.startingRow); the displayed score is rows beyond it
const MAX_IDLE = 25; // decisions without reaching a new row before the round is ended (same 'too slow' rule as the training simulator)
const FRAMES_PER_DECISION = 12; // the policy was trained with one decision per 12 game frames (0.2 s hop)

/**
 * Lets the trained network play the real game.
 * The host (GameView) switches it on for the AI pane by setting `engine.autopilot.enabled = true`.
 */
export default class AutoPilot {
  enabled = false;
  private frames = 0;
  private logged = 0;
  private debug = false;
  // online learning bookkeeping: the previous decision, waiting for its outcome
  private prevObs: Float32Array | null = null;
  private prevAction = 0;
  private prevBest = 0;
  private ended = false;
  private idle = 0;
  private best = 0; // furthest row reached this game

  constructor(private engine: any) {
    if (typeof window !== "undefined") {
      try {
        this.debug = new URLSearchParams(window.location.search).get("debug") === "1";
      } catch {}
    }
  }

  /** call once per game frame from Engine.tick */
  update() {
    const e = this.engine;
    if (!this.enabled || !e._hero || !e.gameMap || e.isGameEnded()) return;
    this.frames++;
    if (e._hero.moving || this.frames < FRAMES_PER_DECISION) return;
    this.frames = 0;
    const z = Math.round(e._hero.position.z);
    const obs = buildObservation(e.gameMap, e._hero.position.x, z);
    if (z < this.best - 3) { e.gameOver(); return; } // 'fell behind' rule of the training simulator
    if (z > this.best) this.idle = 0;
    else if (++this.idle > MAX_IDLE) { e.gameOver(); return; } // the real game has no auto-scrolling camera, so stalling would never end
    this.best = Math.max(this.best, z);
    if (this.prevObs) {
      // outcome of the previous decision: -0.02 per step, +1 per new row (same reward as training)
      brain.add({ s: this.prevObs, a: this.prevAction, r: -0.02 + (this.best - this.prevBest), s2: obs, done: 0 });
    }
    const a = brain.act(obs);
    this.prevObs = obs;
    this.prevAction = a;
    this.prevBest = this.best;
    if (this.debug || this.logged++ < 15) console.log(`[autopilot] ${ACTION_NAMES[a]} at x=${e._hero.position.x.toFixed(1)} z=${Math.round(e._hero.position.z)}`);
    const d = swipeDirections;
    // NB: in this game SWIPE_LEFT moves the chicken to +x and SWIPE_RIGHT to -x, so left/right are swapped
    // relative to the Python simulator (where LEFT = x-1 and RIGHT = x+1).
    const dir = [null, d.SWIPE_UP, d.SWIPE_DOWN, d.SWIPE_RIGHT, d.SWIPE_LEFT][a];
    if (dir) e.moveWithDirection(dir);
  }

  /** called by the engine when the game ends: store the final (death) transition and the score */
  onEpisodeEnd() {
    if (!this.enabled || this.ended) return; // the engine can report the same death on several frames
    this.ended = true;
    const e = this.engine;
    if (this.prevObs) {
      const z = e._hero ? Math.round(e._hero.position.z) : this.best;
      this.best = Math.max(this.best, z);
      brain.add({ s: this.prevObs, a: this.prevAction, r: -1 + (this.best - this.prevBest), s2: this.prevObs, done: 1 });
    }
    brain.recordGame(Math.max(this.best - START_ROW, 0)); // same score the game shows: rows past the start row
    this.prevObs = null;
  }
}
