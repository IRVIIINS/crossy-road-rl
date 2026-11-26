import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { LineChart, Table, Bar, Stats } from "@/BlocksScreen";
import type { Series } from "@/BlocksScreen";
import { PC_BLOCKS, UNTRAINED, blockColor, blockLabel, pcBlock, shortGames } from "@/ai/blocks";
import { analysis, orderWorstToBest, rankInfo } from "@/ai/ranking";
import { download } from "@/download";

type Mode = "you-vs-ai" | "ai-vs-ai";

/**
 * Settings -> block analysis: every trained player compared, watch-each-player buttons (worst -> best), the block 4 write-up and the
 * Monte Carlo explanation. All numbers come from assets/report/block_analysis.json (python make_block_analysis.py).
 */
export default function BlockAnalysis({ onWatch, onTour }: { onWatch: (m: Mode, b: [string, string]) => void; onTour: (ids: string[]) => void }) {
  const rg = analysis.real_game;
  const rounds = analysis.rounds as Record<string, any>;
  const ids = PC_BLOCKS.map((b) => b.id).filter((id) => rounds[id]);
  const order = orderWorstToBest();
  const best = rg?.best as string | undefined;
  const worstTrained = order.find((id) => id !== UNTRAINED);
  const maxReal = Math.max(...order.map((id) => rg.blocks[id].original.mean), 1);
  const p = (k: string, key: "random" | "maker" = "random") => analysis[`pairwise_sim_${key}`]?.[k];
  const fmtP = (x?: { diff: number; p: number }) => (x ? `${x.diff >= 0 ? "+" : ""}${x.diff.toFixed(1)} (p ${x.p < 0.001 ? "< 0.001" : "= " + x.p.toFixed(2)})` : "-");

  // learning curves of all blocks on one axis: mean over the block's runs, x = share of the block's training
  const curve = (key: "random" | "maker"): Series[] =>
    ids.filter((id) => rounds[id].mean_curve).map((id) => {
      const c = rounds[id].mean_curve;
      return { color: blockColor(id), points: c.x.map((x: number, i: number) => [x * 100, c[key][i]] as [number, number]) };
    });

  if (!rg) return <Text style={s.p}>Block analysis data is not bundled (run make_block_analysis.py and rebuild).</Text>;

  return (
    <View>
      <Text style={s.h2}>WATCH EVERY PLAYER, WORST TO BEST</Text>
      <Text style={s.p}>
        The untrained player is a network with random starting weights that has never played a training game. The others are the five PC
        training blocks. Labels come from the real game: average rows crossed over random levels and level-maker levels, learning off, headless
        test harness ({order.reduce((a, id) => a + rg.blocks[id].original.games, 0)} games on random levels in total).
      </Text>
      <View style={s.rowWrap}>
        <Btn label="TOUR: WORST → BEST" onPress={() => onTour(order)} />
        <Btn label="TOUR: TRAINING ORDER" onPress={() => onTour([UNTRAINED, ...PC_BLOCKS.map((b) => b.id)])} />
        {best && <Btn label="UNTRAINED NEXT TO BEST" onPress={() => onWatch("ai-vs-ai", [UNTRAINED, best])} />}
        {best && worstTrained && worstTrained !== best && <Btn label="WORST TRAINED NEXT TO BEST" onPress={() => onWatch("ai-vs-ai", [worstTrained, best])} />}
      </View>
      <View style={[s.table, { marginTop: 10 }]}>
        {order.map((id, i) => {
          const r = rankInfo(id)!;
          const tagColor = r.tag === "WORST" ? "#ff5252" : r.tag === "BEST" ? "#8bf58b" : "#888";
          return (
            <View key={id} style={[s.prow, i % 2 ? { backgroundColor: "#151515" } : null]}>
              <View style={[s.dot, { backgroundColor: blockColor(id) }]} />
              <View style={{ flex: 2.2 }}>
                <Text style={[s.td, { color: blockColor(id), fontWeight: "700" }]}>{blockLabel(id).toUpperCase()}</Text>
                <Text style={[s.td, { color: tagColor, fontSize: 11 }]}>
                  {r.tag ?? `RANK ${r.of - r.rank + 1} OF ${r.of}`}{r.tag === "BEST" ? " (tied with several, see below)" : r.tag === "WORST" ? " (never trained)" : r.tied ? " · tied with best" : ""}
                </Text>
              </View>
              <Text style={[s.td, { flex: 1 }]}>{r.original.toFixed(1)}</Text>
              <Text style={[s.td, { flex: 1 }]}>{r.maker.toFixed(1)}</Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Btn small label="WATCH" onPress={() => onWatch("ai-vs-ai", [id, id])} />
                <Btn small label="PLAY IT" onPress={() => onWatch("you-vs-ai", [id, id])} />
              </View>
            </View>
          );
        })}
        <Text style={[s.td, { color: "#888", padding: 6, fontSize: 11 }]}>columns: real-game rows on random levels · on level-maker levels</Text>
      </View>

      <Text style={s.h2}>REAL-GAME SCORE, EVERY PLAYER</Text>
      {order.map((id) => (
        <View key={id} style={{ marginBottom: 6 }}>
          <Bar label={blockLabel(id)} value={rg.blocks[id].original.mean} max={maxReal} color={blockColor(id)} />
          <Bar label="  level maker" value={rg.blocks[id].maker.mean} max={maxReal} color={blockColor(id)} faded />
        </View>
      ))}
      <Table
        head={["Player", "Games", "Random levels (mean ± SE)", "Median", "Max", "Maker levels (mean ± SE)", "p vs best"]}
        flex={[1.6, 0.7, 1.9, 0.8, 0.7, 1.9, 1.1]}
        rows={[...order].reverse().map((id) => {
          const o = rg.blocks[id].original, m = rg.blocks[id].maker;
          const pv = Math.max(o.p_vs_best ?? 0, m.p_vs_best ?? 0);
          return [blockLabel(id), `${o.games}/${m.games}`, `${o.mean.toFixed(1)} ± ${o.sem.toFixed(1)} (sd ${o.std.toFixed(0)})`, String(o.median), String(o.max),
            `${m.mean.toFixed(1)} ± ${m.sem.toFixed(1)} (sd ${m.std.toFixed(0)})`, id === best ? "-" : pv < 0.001 ? "<0.001" : pv.toFixed(2)];
        })}
      />
      <Text style={s.note}>
        SE = standard error of the mean (sd / √games). p vs best = Welch t-test against the best player, the larger of the two level kinds. The previous
        shipped player (before the PC training) scored {rg.previous_shipped_player?.original} / {rg.previous_shipped_player?.maker}.
        Every trained block beats it and the untrained net (always 0, it stands still until the "too slow" rule ends the round), but the
        five trained blocks are NOT significantly different from each other: standard deviations are 15–45 rows, so 30–90 games cannot separate
        them. The BEST and WORST-trained labels are the highest and lowest averages, not proven differences.
      </Text>

      <Text style={s.h2}>SIMULATOR TEST, EVERY BLOCK</Text>
      <Text style={s.p}>
        Mean ± std over the runs of each block (every run tested on the same 300 unseen levels, best checkpoint chosen on 200 other levels).
        "Chosen player" is the single run that was shipped as that block.
      </Text>
      <Table
        head={["Block", "Runs", "Random levels", "Maker levels", "Chosen player (random / maker)", "Games (its line)", "Hours"]}
        flex={[1.2, 0.6, 1.5, 1.5, 2, 1.1, 0.7]}
        rows={ids.map((id) => {
          const r = rounds[id], b = pcBlock(id)!;
          return [blockLabel(id), String(r.runs), `${r.test_random_mean.toFixed(1)} ± ${r.test_random_std.toFixed(1)}`, `${r.test_maker_mean.toFixed(1)} ± ${r.test_maker_std.toFixed(1)}`,
            `${b.test?.random.toFixed(1)} / ${b.test?.maker.toFixed(1)}`, shortGames(b.games), b.hours == null ? "?" : b.hours.toFixed(1)];
        })}
      />
      <Text style={s.note}>
        Differences between blocks (mean over runs, random levels; Welch t-test across the 14 runs): round 2→3 {fmtP(p("round2-round3"))},
        round 3→4 {fmtP(p("round3-round4"))}, round 4→5 {fmtP(p("round4-round5"))}, round 3→5 {fmtP(p("round3-round5"))}. The big jumps are real (rounds 1→3);
        from round 3 on nothing is significant: more PC hours stopped paying off after round 3.
      </Text>

      <Text style={s.h2}>LEARNING CURVES OF ALL BLOCKS</Text>
      <LineChart series={curve("random")} xFormat={(x) => `${Math.round(x)}%`} />
      <Text style={s.note}>
        Evaluation score on 100 fixed levels (random levels), averaged over each block's runs, against the share of the block's training time.
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 4 }}>
        {ids.map((id) => <Text key={id} style={[s.note, { color: blockColor(id), marginTop: 0 }]}>■ {blockLabel(id)}</Text>)}
      </View>
      <LineChart series={curve("maker")} xFormat={(x) => `${Math.round(x)}%`} />
      <Text style={s.note}>Same, on level-maker levels. Colours as above.</Text>

      <Text style={s.h2}>TRAINING DIAGNOSTICS: WHEN DID EACH BLOCK PEAK?</Text>
      <Table
        head={["Block", "Eval peak at (share of training)", "Runs that peaked in 1st half", "Peak → end of training", "2nd half − 1st half", "Peak vs held-out score"]}
        flex={[1.1, 1.7, 1.7, 1.4, 1.4, 1.5]}
        rows={ids.map((id) => {
          const r = rounds[id];
          return [blockLabel(id), `${Math.round(100 * r.peak_iteration_frac)}%`, `${r.runs_peaking_in_first_half}/${r.curve_runs}`, `-${r.decline_peak_to_end.toFixed(1)}`,
            `${r.second_half_minus_first_half >= 0 ? "+" : ""}${r.second_half_minus_first_half.toFixed(1)}`, r.eval_peak_optimism == null ? "?" : `+${r.eval_peak_optimism.toFixed(1)}`];
        })}
      />
      <Text style={s.note}>
        Eval score = average of random-level and level-maker-level score on the 100 fixed evaluation levels, one value per 200 games.
        "Peak vs held-out" = how much higher the best evaluation value is than the same checkpoint's score on 200 other levels (selection optimism).
      </Text>

      <Text style={s.h2}>BLOCK 4: OVERFITTING, AND WHAT IT COST</Text>
      <Text style={s.p}>
        What the data shows. Block 4 (14 runs, each fine-tuned from block 3's winner for about 6 hours on random levels) peaked early and then got worse:
        on average its evaluation score peaked after {Math.round(100 * rounds.round4.peak_iteration_frac)}% of the training (blocks 1–3: {Math.round(100 * Math.min(...["round1", "round2", "round3"].map((k) => rounds[k].peak_iteration_frac)))}–{Math.round(100 * Math.max(...["round1", "round2", "round3"].map((k) => rounds[k].peak_iteration_frac)))}%),
        {" "}{rounds.round4.runs_peaking_in_first_half} of {rounds.round4.curve_runs} runs peaked in the first half (block 3: {rounds.round3.runs_peaking_in_first_half} of {rounds.round3.curve_runs}),
        the score fell {rounds.round4.decline_peak_to_end.toFixed(1)} rows from the peak to the end (the largest fall of any block), and the second half of training was no better than the first
        ({rounds.round4.second_half_minus_first_half.toFixed(1)} rows, while block 3 still gained {rounds.round3.second_half_minus_first_half.toFixed(1)}). The extra training did not improve the player; it
        made the late checkpoints worse than the early ones.
      </Text>
      <Text style={s.p}>
        Why call it overfitting. The likely mechanism (a hypothesis, not tested separately): the network kept adjusting to its own recent games, with low exploration and a replay
        buffer full of near-identical behaviour, until its decisions were tuned to that narrow experience and generalised worse to the evaluation levels. Two caveats: (1) it cannot be
        memorising levels, because every training game used a fresh random level, so the better description is over-training / policy drift, a form of overfitting to
        its own experience; (2) the usual training-vs-test gap cannot be read from the logs because training games include exploration moves.
        There is also overfitting on the selection side: the best of about 260 evaluations on the same 100 levels is optimistic by {rounds.round4.eval_peak_optimism.toFixed(1)} rows in block 4
        (block 1: {rounds.round1.eval_peak_optimism.toFixed(1)}), so the shipped checkpoint is chosen on 200 other levels.
      </Text>
      <Text style={s.p}>
        What it cost and what it did not. It wasted most of the block's six hours (the useful checkpoints were early) and gave no gain over block 3: the chosen players test at{" "}
        {pcBlock("round3")?.test?.random.toFixed(1)} (block 3), {pcBlock("round4")?.test?.random.toFixed(1)} (block 4), {pcBlock("round5")?.test?.random.toFixed(1)} (block 5) on random levels. Because checkpoints are picked on held-out levels (early stopping), the shipped
        block 4 player is NOT significantly worse than its neighbours: mean over runs {rounds.round4.test_random_mean.toFixed(1)} vs {rounds.round3.test_random_mean.toFixed(1)} (block 3, p = {p("round3-round4")?.p.toFixed(2)}) and
        {" "}{rounds.round5.test_random_mean.toFixed(1)} (block 5, p = {p("round4-round5")?.p.toFixed(2)}), and in the real game it ranks {rankInfo("round4") ? `${rankInfo("round4")!.of - rankInfo("round4")!.rank + 1} of ${rankInfo("round4")!.of}` : "?"} on average but is statistically tied with the other trained blocks. So the overfitting is
        visible in block 4's training curves and in the compute it wasted, not as a worse final player. Block 5 showed the same pattern, less strongly ({Math.round(100 * rounds.round5.peak_iteration_frac)}% peak point).
      </Text>

      <Text style={s.h2}>HOW THIS RELATES TO MONTE CARLO TRAINING</Text>
      <Text style={s.p}>
        Monte Carlo reinforcement learning estimates the value of a move from the real outcome: play the whole game, add up the rewards that followed (here
        +1 per new row, −0.02 per step, −1 on death, discounted by γ = 0.97) and use that sum as the target. It needs no model, is unbiased, but is noisy, because one
        unlucky car or log changes the whole sum. Our player does not do this. It is Double DQN, a temporal-difference method: the target is the next reward
        plus its own estimate of the next state (bootstrapping). That learns from every single move and can reuse old moves from a replay buffer, but its
        targets are biased by the network's own errors, which is exactly what makes long DQN runs drift and overfit (see block 4). Monte Carlo targets would not
        bootstrap, but they would need complete games and would have much higher variance (death scores range from 0 to over 200 rows).
      </Text>
      <Text style={s.p}>
        Monte Carlo sampling is still everywhere in this project: (1) every training game is a random sample of the level generator and the car/log timing, so
        the update averages over random levels; (2) epsilon-greedy exploration samples random moves; (3) every score on this screen is a Monte Carlo estimate of
        the player's true average, made from N random games, with a standard error of sd/√N. With sd of 25 rows and N = 30 games the standard error is about 5
        rows, which is why the five trained blocks cannot be ranked in the real game, while the 300-level simulator tests (SE about 3) can separate round 1 from round 3 but not
        round 3 from 4 or 5; (4) the level maker's own randomness (15% random choices) makes each maker game different. More games shrink the error slowly (4x the games, half
        the error), which is the practical limit of evaluating a high-variance game by sampling.
      </Text>
      <View style={s.rowWrap}>
        <Btn label="Block analysis (JSON)" onPress={() => download("block_analysis.json", JSON.stringify(analysis, null, 2), "application/json")} />
      </View>
    </View>
  );
}

const Btn = ({ label, onPress, small }: { label: string; onPress: () => void; small?: boolean }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [s.btn, small && { paddingVertical: 4, paddingHorizontal: 8 }, pressed && { opacity: 0.75 }]}>
    <Text style={[s.btnText, small && { fontSize: 11 }]}>{label}</Text>
  </Pressable>
);

const mono = Platform.select({ web: "ui-monospace, Menlo, monospace", default: "Courier" }) as string;
const s = StyleSheet.create({
  h2: { fontFamily: "retro", fontSize: 20, color: "#f8e84d", marginTop: 30, marginBottom: 8 },
  p: { color: "#ddd", fontFamily: mono, fontSize: 13, marginBottom: 10, lineHeight: 19 },
  note: { color: "#999", fontFamily: mono, fontSize: 11, marginTop: 4, lineHeight: 16 },
  btn: { backgroundColor: "#000", borderColor: "#fff", borderWidth: 2, paddingVertical: 8, paddingHorizontal: 14 },
  btnText: { fontFamily: "retro", color: "#fff", fontSize: 13 },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  table: { borderColor: "#444", borderWidth: 1, marginBottom: 6 },
  prow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 6 },
  dot: { width: 10, height: 10 },
  td: { color: "#eee", fontFamily: mono, fontSize: 12, padding: 2 },
});
