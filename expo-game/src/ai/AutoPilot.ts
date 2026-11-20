import { swipeDirections } from "@/components/GestureView";
import weights from "./weights.json";
import { chooseAction, Weights } from "./policy";

const FRAMES_PER_DECISION = 12; // the policy was trained with one decision per 12 game frames (0.2 s hop)

/**
 * Lets the trained network play the real game.
 * Turn it on with `?ai=1` in the web URL, or press the P key to toggle.
 */
export default class AutoPilot {
  enabled = false;
  private frames = 0;

  constructor(private engine: any) {
    if (typeof window !== "undefined") {
      try {
        this.enabled = new URLSearchParams(window.location.search).get("ai") === "1";
      } catch {}
      window.addEventListener?.("keydown", (e: KeyboardEvent) => {
        if (e.code === "KeyP") {
          this.enabled = !this.enabled;
          console.log(`[autopilot] ${this.enabled ? "ON" : "OFF"}`);
        }
      });
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
    const d = swipeDirections;
    const dir = [null, d.SWIPE_UP, d.SWIPE_DOWN, d.SWIPE_LEFT, d.SWIPE_RIGHT][a];
    if (dir) e.moveWithDirection(dir);
  }
}
