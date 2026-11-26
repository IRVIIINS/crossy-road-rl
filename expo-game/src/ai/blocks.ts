/**
 * Training blocks: every trained player the app knows about, in training order.
 *   - PC blocks come from `stages/stages.json` (written by add_stage.py in the crossy-road-rl repo, one per training round)
 *   - the "app" block is the network that learned inside this app (Settings -> Learning ON), on top of a PC block
 * Pure TypeScript (no React Native imports).
 */
import manifest from "./stages/stages.json";
import { STAGE_WEIGHTS } from "./stages/index";

export type Curve = [games: number, evalRandom: number, evalMaker: number][];
export type Block = {
  id: string;
  label: string;
  where: "pc" | "app";
  date: string;
  summary: string;
  games: number; // games played by this player's whole line, from scratch
  hours: number | null; // training hours of that line
  updates: number | null; // gradient updates of that line
  gamesAllRuns: number; // games this block added, over all its runs
  cpuHoursAllRuns?: number | null;
  jobGames?: Record<string, number>; // games each run had played at the end of this block
  runs: number;
  startsFrom: string | null; // fine-tuned from this block
  continues: string | null; // resumed the runs of this block
  winner: { job: string; checkpoint: string; iteration: number | null };
  test: { random: number; maker: number } | null; // 300 unseen seeds in the simulator
  testNote?: string;
  configs?: Record<string, { runs: number; random: number; maker: number }>;
  crossEval?: string;
  curve: Curve;
  weights?: string;
};

export const APP = "app";
export const PC_BLOCKS: Block[] = (manifest as any).stages;
export const LATEST = PC_BLOCKS[PC_BLOCKS.length - 1].id;
/** combined test score (random + level-maker levels, 300 unseen seeds each); null when a block was not tested */
export const testTotal = (b: Block) => (b.test ? b.test.random + b.test.maker : null);
/** the strongest PC block on the test (the newest block is not always the best: later rounds can test lower) */
export const BEST = PC_BLOCKS.reduce((a, b) => ((testTotal(b) ?? -1) > (testTotal(a) ?? -1) ? b : a), PC_BLOCKS[0]).id;
export const COLORS = ["#b0b0b0", "#4fc3f7", "#f8e84d", "#8bf58b", "#ff8a65", "#ce93d8", "#80cbc4", "#fff59d"];
export const APP_COLOR = "#ff6fb5";

export const blockIndex = (id: string) => PC_BLOCKS.findIndex((b) => b.id === id);
export const blockColor = (id: string) => (id === APP ? APP_COLOR : COLORS[Math.max(0, blockIndex(id)) % COLORS.length]);
export const pcBlock = (id: string) => PC_BLOCKS.find((b) => b.id === id);
export const blockWeights = (id: string) => STAGE_WEIGHTS[id];

export function blockLabel(id: string) {
  if (id === APP) return "In-app learned";
  return pcBlock(id)?.label ?? id;
}

export function shortGames(n: number | null | undefined) {
  if (n == null) return "?";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

/** the chain of blocks that led to `id` (oldest first), following --continues / --starts-from */
export function lineage(id: string): Block[] {
  const out: Block[] = [];
  let b = pcBlock(id);
  const seen = new Set<string>();
  while (b && !seen.has(b.id)) {
    seen.add(b.id);
    out.unshift(b);
    const prev: string | null = b.startsFrom ?? b.continues;
    // a continued round whose winner is a different run did not grow from the earlier winner
    if (!b.startsFrom && b.continues && pcBlock(b.continues)?.winner.job !== b.winner.job) break;
    b = prev ? pcBlock(prev) : undefined;
  }
  return out;
}

/** games already played by the line before this block's own curve starts (fine-tuned blocks restart their curve at 0) */
export function curveOffset(b: Block) {
  return b.startsFrom ? pcBlock(b.startsFrom)?.games ?? 0 : 0;
}
