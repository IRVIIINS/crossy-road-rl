/**
 * Which player is best / worst, from the REAL game (headless harness, results/real_game_blocks.json, pooled by make_block_analysis.py).
 * Rank = mean of the average score on original levels and on level-maker levels. Blocks whose difference to the best one is not
 * statistically significant (Welch t-test, p >= 0.05) are marked as tied.
 */
import { UNTRAINED } from "./blocks";

export const analysis: any = require("../../assets/report/block_analysis.json");

export type Rank = { rank: number; of: number; tag: "WORST" | "BEST" | null; tied: boolean; original: number; maker: number; score: number; games: number };

export function rankInfo(id: string): Rank | null {
  const rg = analysis.real_game;
  const b = rg?.blocks?.[id];
  if (!b?.score && b?.score !== 0) return null;
  const order: string[] = rg.order_worst_to_best;
  const i = order.indexOf(id);
  const p = Math.max(b.original?.p_vs_best ?? 1, b.maker?.p_vs_best ?? 1);
  const tag = id === rg.worst ? "WORST" : id === rg.best ? "BEST" : null;
  // tied with the best: neither level kind is significantly different from the best block
  const tied = id !== UNTRAINED && ((b.original?.p_vs_best ?? 1) >= 0.05 && (b.maker?.p_vs_best ?? 1) >= 0.05);
  void p;
  return { rank: i + 1, of: order.length, tag, tied, original: b.original.mean, maker: b.maker.mean, score: b.score, games: b.original.games + b.maker.games };
}

/** players from worst to best (real game) */
export const orderWorstToBest = (): string[] => analysis.real_game?.order_worst_to_best ?? [];
