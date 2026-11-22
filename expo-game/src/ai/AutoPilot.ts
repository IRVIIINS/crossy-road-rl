import { swipeDirections } from "@/components/GestureView";
import weights from "./weights.json";
import { ACTION_NAMES, chooseAction, Weights } from "./policy";

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
    const a = chooseAction(
      weights as unknown as Weights,
      e.gameMap,
      e._hero.position.x,
      Math.round(e._hero.position.z)
    );
    if (this.debug || this.logged++ < 15) console.log(`[autopilot] ${ACTION_NAMES[a]} at x=${e._hero.position.x.toFixed(1)} z=${Math.round(e._hero.position.z)}`);
    const d = swipeDirections;
    // NB: in this game SWIPE_LEFT moves the chicken to +x and SWIPE_RIGHT to -x, so left/right are swapped
    // relative to the Python simulator (where LEFT = x-1 and RIGHT = x+1).
    const dir = [null, d.SWIPE_UP, d.SWIPE_DOWN, d.SWIPE_RIGHT, d.SWIPE_LEFT][a];
    if (dir) e.moveWithDirection(dir);
  }
}
