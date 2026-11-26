import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { Stats } from "@/BlocksScreen";
import { UNTRAINED, blockColor, blockLabel, pcBlock, shortGames } from "@/ai/blocks";
import { analysis } from "@/ai/ranking";

const f = (x: number | undefined | null, d = 1) => (x == null ? "?" : x.toFixed(d));
const pv = (x?: { p: number }) => (x ? (x.p < 0.001 ? "p < 0.001" : `p = ${x.p.toFixed(2)}`) : "");

/** What every number on the Settings data screen means (shown once, before the tables). */
export function Glossary() {
  const rows: [string, string][] = [
    ["row / rows crossed", "The score of one game: how many new rows the chicken reached beyond the starting row before it died or the round ended. 30 rows = about 30 hops forward."],
    ["random levels", "Levels built by the game's original random generator (grass, roads, rivers in random order)."],
    ["level-maker levels", "Levels built by the third AI, the level maker, which picks the next row type to be hard for the player (many fast rivers). Scores here are always lower."],
    ["real game", "The actual Expo Crossy Road engine running in the app (measured with a headless test harness, learning off). This is what you see on screen."],
    ["simulator", "Our Python copy of the game's rules. All training happens here because it is about 50x faster. Simulator scores are higher than real-game scores for the same player."],
    ["games / N", "How many full games were played to produce a number. More games = a more trustworthy number."],
    ["mean", "Average rows over those games."],
    ["sd (standard deviation)", "How much single games differ from each other. 25 means a typical game is about 25 rows above or below the mean, so games are very uneven."],
    ["SE (standard error)", "How far off the mean itself probably is: sd divided by the square root of the number of games. Mean 25 ± 3 means the true average is probably between 22 and 28."],
    ["median / best game", "Median: the middle game (half scored less). Best game: the highest single score seen."],
    ["p vs best", "Probability of seeing a gap this large by pure luck if the two players were actually equal (Welch t-test). Below 0.05 = a real difference; above = cannot tell them apart."],
    ["runs", "Independent training attempts of one block, started from the same point with different random seeds. The block's 'chosen player' is the best one."],
    ["mean over runs vs chosen player", "Mean over runs is the honest average quality of the recipe. The chosen player is the best of ~14 runs picked on held-out levels, so its test score is a little optimistic (the best of many tries)."],
    ["held-out / unseen levels", "Levels the player never trained on. Simulator tests use 300 of them (200 more were used to choose the best checkpoint)."],
    ["eval peak / drop", "During training the player is tested every 200 games on 100 fixed levels. 'Peak' = its best test; 'drop' = how far the score fell between the peak and the end of training."],
    ["training hours / games", "Wall-clock hours and number of training games of that player's whole line (all earlier blocks it grew out of are included)."],
    ["+ / − in brackets", "Change versus the block before it."],
  ];
  return (
    <View style={{ marginTop: 6 }}>
      {rows.map(([k, v]) => (
        <Text key={k} style={s.p}><Text style={s.term}>{k}: </Text>{v}</Text>
      ))}
    </View>
  );
}

type Story = { id: string; stats: [string, string][]; what: string; why: string; limit: string };

function stories(): Story[] {
  const R = analysis.rounds as Record<string, any>;
  const rg = analysis.real_game?.blocks ?? {};
  const pw = analysis.pairwise_sim_random ?? {};
  const real = (id: string): [string, string][] => rg[id] ? [
    [`${f(rg[id].original.mean)} ± ${f(rg[id].original.sem)}`, `rows, real game, random levels (mean ± SE of ${rg[id].original.games} games)`],
    [`${f(rg[id].maker.mean)} ± ${f(rg[id].maker.sem)}`, `rows, real game, level-maker levels (mean ± SE of ${rg[id].maker.games} games)`],
  ] : [];
  const sim = (id: string): [string, string][] => R[id] ? [
    [`${f(R[id].test_random_mean)} ± ${f(R[id].test_random_std)}`, `rows, simulator, random levels (mean ± sd over ${R[id].runs} runs)`],
    [`${f(R[id].test_maker_mean)} ± ${f(R[id].test_maker_std)}`, `rows, simulator, level-maker levels (mean ± sd over ${R[id].runs} runs)`],
    [`${f(pcBlock(id)?.test?.random)} / ${f(pcBlock(id)?.test?.maker)}`, "rows, simulator, the chosen (best) player: random / maker levels"],
  ] : [];
  const cfg = (id: string, k: string) => pcBlock(id)?.configs?.[k];

  return [
    {
      id: UNTRAINED,
      stats: [...real(UNTRAINED), ["0", "training games played"], ["0.01", "rows, simulator, random levels (100 games)"]],
      what: "A network with exactly the shape of the other players (521 numbers describing the road around the chicken, then 256 and 128 hidden units, then 5 moves) but with random starting weights. It has never played a training game.",
      why: "Random weights know nothing about cars, logs or trees, so its choices never carry the chicken forward: it does not cross a single row in the real game, and the 'too slow' rule ends every round after about 5 seconds. It is the floor of the scale and proves that every row any other player scores was learned, not luck.",
      limit: "Nothing to improve: it is the control.",
    },
    {
      id: "original",
      stats: [...real("original"), [f(pcBlock("original")?.test?.random), "rows, simulator, random levels (300 unseen levels)"], [f(pcBlock("original")?.test?.maker), "rows, simulator, level-maker levels"], ["10,000", "training games (x5 seeds, best seed kept)"]],
      what: "The first AI we trained, before any PC runs. It is what apps v1 to v4 shipped. Double DQN with a look-ahead view (where each car and log will be 6 and 12 frames from now), trained in the simulator on the Mac with 5 random seeds of 10,000 games each; the best seed was kept.",
      why: "From only 10,000 games it already learned the basics: cross roads between cars, ride logs, hop onto lily pads and walk around trees. Random play scores about 1.4 rows, this player about 23 in the simulator and 15.6 in the real game.",
      limit: "A small training budget (10,000 games, versus 44,000 to 180,000 for the later blocks), trained on random levels only, and a single try per seed. All five rounds average higher in the real game; the gap to the best round is significant (p = 0.002).",
    },
    {
      id: "round1",
      stats: [...real("round1"), ...sim("round1"), ["8", "runs trained at the same time (4 random-level, 4 'mix50')"], [shortGames(pcBlock("round1")?.games), "training games of the chosen player"], [f(pcBlock("round1")?.hours, 1), "training hours of the chosen player"]],
      what: "The first long run on the PC: 8 runs trained from scratch for about 4.5 hours. Four used random levels only; four 'mix50' runs spent half of their games on level-maker levels. Learning rate 0.0005 falling to 0.0001; random exploration moves shrinking from 100% to 5% over the first 50,000 steps; one test every 200 games on 100 fixed levels; the best checkpoint was chosen on 200 other levels.",
      why: `More games and more tries than the original: the chosen player's line has ${shortGames(pcBlock("round1")?.games)} games instead of 10,000, and the best of 8 runs was kept. Random-level runs averaged ${f(cfg("round1", "random")?.random)} rows on random levels, mix50 runs ${f(cfg("round1", "mix50")?.random)}; on level-maker levels it was the other way round (${f(cfg("round1", "mix50")?.maker)} for mix50, ${f(cfg("round1", "random")?.maker)} for random-only). Training on the harder maker levels trades random-level skill for maker-level skill.`,
      limit: `Training was cut off by the time limit, not by convergence: the second half of training still gained ${f(R.round1?.second_half_minus_first_half)} rows over the first half, so the curves were still rising.`,
    },
    {
      id: "round2",
      stats: [...real("round2"), ...sim("round2"), ["14", "runs (round 1's 8 resumed + 6 new)"], [shortGames(pcBlock("round2")?.games), "training games of the chosen player"], [f(pcBlock("round2")?.hours, 1), "training hours of the chosen player"]],
      what: "Resumed round 1's eight runs for more hours and added six new ones, so all 14 CPU cores were busy. Same recipe as round 1 (random and mix50 runs).",
      why: `Simply more training on the same recipe: the mean over runs rose from ${f(R.round1?.test_random_mean)} to ${f(R.round2?.test_random_mean)} rows (${pv(pw["round1-round2"])}, gap ${f(pw["round1-round2"]?.diff)}). Inside the round, random-level runs averaged ${f(cfg("round2", "random")?.random)} versus ${f(cfg("round2", "mix50")?.random)} for mix50 on random levels, and mix50 gave no clear gain on maker levels (${f(cfg("round2", "mix50")?.maker)} vs ${f(cfg("round2", "random")?.maker)}). That is why mix50 was dropped from round 3.`,
      limit: `Still not converged (second half of training +${f(R.round2?.second_half_minus_first_half)} rows). In the real game it has the highest average of all blocks (${f(rg.round2?.original.mean)} / ${f(rg.round2?.maker.mean)}) but it is not significantly above rounds 1, 3, 4 or 5.`,
    },
    {
      id: "round3",
      stats: [...real("round3"), ...sim("round3"), ["14", "runs, all on random levels"], [shortGames(pcBlock("round3")?.games), "training games of the chosen player"], [f(pcBlock("round3")?.hours, 1), "training hours of the chosen player"]],
      what: "The biggest jump. Every run started from round 2's best player and kept training for about 6 hours on random levels only, with low exploration (10% falling to 5%) and a lower learning rate (0.0001 falling to 0.00005). 14 runs in parallel, the best one kept.",
      why: `The simulator mean over runs jumped from ${f(R.round2?.test_random_mean)} to ${f(R.round3?.test_random_mean)} rows (${pv(pw["round2-round3"])}); the chosen player reached ${f(pcBlock("round3")?.test?.random)}. Four things changed at once (start from the best player instead of from scratch, no mix50, lower learning rate, lower exploration) plus the best-of-14 choice, so we cannot say which one did it; no ablation was run.`,
      limit: `In the real game round 3 scored ${f(rg.round3?.original.mean)} / ${f(rg.round3?.maker.mean)}, not different from round 2 (${f(rg.round2?.original.mean)} / ${f(rg.round2?.maker.mean)}). If only about 45% of the simulator gain carried over (+6 rows), that is too small for 60 games to detect, so the real-game test cannot confirm that the simulator gain carried over. The simulator itself kept improving little after this round.`,
    },
    {
      id: "round4",
      stats: [...real("round4"), ...sim("round4"), ["14", "runs, all on random levels"], [shortGames(pcBlock("round4")?.games), "training games of the chosen player"], [f(pcBlock("round4")?.hours, 1), "training hours of the chosen player"]],
      what: "Same recipe as round 3, started from round 3's chosen player: 14 runs of about 6 hours on random levels, low exploration and learning rate.",
      why: `No gain: the mean over runs moved from ${f(R.round3?.test_random_mean)} to ${f(R.round4?.test_random_mean)} rows (${pv(pw["round3-round4"])}, not significant); the chosen player scores ${f(pcBlock("round4")?.test?.random)} / ${f(pcBlock("round4")?.test?.maker)} in the simulator. Its runs peaked after ${Math.round(100 * (R.round4?.peak_iteration_frac ?? 0))}% of training and then declined: see "Round 4: overfitting" below for the whole explanation.`,
      limit: "Most of its six hours were wasted on training after the peak. In the real game it still ranks near the top (the 5 trained rounds are statistically tied).",
    },
    {
      id: "round5",
      stats: [...real("round5"), ...sim("round5"), ["14", "runs, all on random levels"], [shortGames(pcBlock("round5")?.games), "training games of the chosen player"], [f(pcBlock("round5")?.hours, 1), "training hours of the chosen player"]],
      what: "Same recipe again from round 4's chosen player (14 runs, about 6 hours, random levels). It is the default player in the app.",
      why: `The simulator mean over runs is ${f(R.round5?.test_random_mean)} rows (round 4: ${f(R.round4?.test_random_mean)}, ${pv(pw["round4-round5"])}), so it is no better than round 4, but it is the most consistent: the spread between runs is the smallest (sd ${f(R.round5?.test_random_std)} rows against ${f(R.round3?.test_random_std)} in round 3). The chosen player's simulator score (${f(pcBlock("round5")?.test?.random)}) is lower than round 4's chosen player (${f(pcBlock("round4")?.test?.random)}), which is within the noise of choosing the best of 14.`,
      limit: `Diminishing returns: two more blocks with the same recipe (rounds 4 and 5, about 12 PC hours on 14 cores) moved the simulator mean by ${f(pw["round3-round5"]?.diff)} rows in total (${pv(pw["round3-round5"])}, not significant). It was chosen as the default because it has the most real-game evidence behind it (${rg.round5?.original.games} games per level kind), not because it is proven best.`,
    },
  ];
}

/** one labelled card per block: what it is, what yielded its result, what limited it */
export function BlockStories() {
  return (
    <View>
      {stories().map((st) => (
        <View key={st.id} style={[s.card, { borderLeftColor: blockColor(st.id) }]}>
          <Text style={[s.cardTitle, { color: blockColor(st.id) }]}>{blockLabel(st.id).toUpperCase()}</Text>
          <Stats items={st.stats.map(([v, l]) => [l, v] as [string, string])} />
          <Text style={s.p}><Text style={s.term}>What it is. </Text>{st.what}</Text>
          <Text style={s.p}><Text style={s.term}>What yielded this result. </Text>{st.why}</Text>
          <Text style={s.p}><Text style={s.term}>What limited it. </Text>{st.limit}</Text>
        </View>
      ))}
    </View>
  );
}

type Item = { title: string; evidence: string; fix: string };

const PROBLEMS: Item[] = [
  { title: "1. The simulator is not the real game", evidence: "Round 5 scores 57.7 rows in the simulator but 23.5 in the real game on random levels (0.41x), 32.9 vs 16.3 on level-maker levels. Train tracks and decision timing were tested and ruled out as the cause; the real cause is still unknown. From round 2 to round 3 the simulator mean rose 13.9 rows, yet the real game shows no measurable change.", fix: "Replay identical levels and identical moves in both and compare frame by frame to find the difference; add the found mismatch to the simulator; or fine-tune the final player directly in the real engine (the headless harness runs ~50x faster than real time, about 0.3 games per second per core)." },
  { title: "2. Wasted compute after the peak", evidence: "Round 4's runs peaked after 38% of training and every round lost 9 to 13 rows between peak and end of training. Rounds 4 and 5 (about 6 hours each on 14 cores) gave no significant gain over round 3.", fix: "Early stopping per run (stop when no new best for N evaluations), kill the weakest runs and restart them from the best (population-based training), and stop a round when its best run no longer beats the previous round." },
  { title: "3. Noisy measurement", evidence: "Single games vary a lot (sd 15 to 45 rows). The 100-level training test has a standard error around 5 rows, and picking the best of ~260 tests on the same levels is optimistic by up to 7 rows. The chosen player of round 3 tests 65.7 while the mean over its 14 runs is 55.5.", fix: "Test the top few checkpoints on a much larger held-out set before choosing, use the same levels for every player being compared (paired comparison), and report the mean over runs, not only the best run." },
  { title: "4. Real-game evaluation is too small and slow to rank the rounds", evidence: "60 to 120 real-game games per block cannot separate rounds 1 to 5 (standard errors 2 to 3 rows each). The harness does about 0.3 games per second per core.", fix: "Run the harness on all 14 PC cores for a few hours: 2,000+ games per block gives a standard error around 0.6 rows, enough to rank them." },
  { title: "5. Training uses one CPU core per run; the GPU is idle", evidence: "All runs used device=cpu. OVERNIGHT.md measured about 95% of the time in the network update on one core; the RTX 4080 was not used.", fix: "Batch many simulator copies per step and train on the GPU (bench_device.py exists to check the gain). Expect more games per hour, which matters most for problem 1." },
  { title: "6. Unfair or unplayable maker levels", evidence: "The level maker chooses fast rivers for 38% of its rows and builds three rivers in a row in about 3% of its hazard runs. In the real game rivers alternate between a lily-pad row (only 2 to 3 pads in 9 columns) and a log row, so some combinations are extremely hard or impossible. It was trained against the original player and has not been retrained against a stronger one (retraining against round 5 did not make levels harder).", fix: "Add a playability check to every proposed row (reject rows with no safe route, cap rivers in a row, ensure a pad or log lines up), then re-measure every block." },
  { title: "7. Round 3's gain is confounded", evidence: "Round 3 changed four settings at once, so we cannot say why it improved.", fix: "Re-run with one change per run (start point, mix50 off, learning rate, exploration) and keep the settings that matter." },
  { title: "8. Online learning in the app makes the player worse", evidence: "In the simulator test it fell from 27 to 10 rows over 150 learning rounds (Settings figure 'Online learning test').", fix: "Keep it off by default (already done), or make it safer: tiny learning rate, a replay buffer that keeps old PC games, and revert if the score drops." },
];

const IMPROVEMENTS: Item[] = [
  { title: "More stable value learning (all standard DQN upgrades, untested here)", evidence: "Every block declines after its peak, which is the instability of plain DQN.", fix: "Prioritized replay, dueling heads, noisy exploration, a slowly averaged copy of the weights (EMA) and a learning rate that decays to near zero. These are the Rainbow components; try them one at a time on the simulator." },
  { title: "Multi-step and Monte Carlo returns", evidence: "Plain DQN looks one step ahead and trusts its own estimate. Crossy Road episodes are short and end at death, so full returns are cheap.", fix: "Use n-step returns (for example n = 5 to 10) or mix in the Monte Carlo return (lambda returns). That reduces bias at the price of more variance; compare against the current one-step target." },
  { title: "Better player input", evidence: "The player sees 8 rows as 521 numbers and a small fully-connected network.", fix: "A small convolutional network over the grid, longer look-ahead of cars and logs, or a few past frames. Each is a separate experiment." },
  { title: "Train on harder, fairer levels (curriculum)", evidence: "mix50 (half maker levels from the start) hurt random levels; random-only never learned the maker's hardest rows.", fix: "Start on random levels, then raise the maker share slowly, and retrain the maker against the new player in alternation (train_iterative.py already does this idea), always with the playability check from problem 6." },
  { title: "Ensembles and domain randomisation", evidence: "14 runs per round give 14 different players, but only one is kept.", fix: "Average the Q-values of the top 3 to 5 players (a free accuracy gain at play time), and randomise simulator details (widths, speeds) so the player is less tied to one exact copy of the game." },
  { title: "Faster, bigger evaluation", evidence: "Problems 3 and 4.", fix: "Larger held-out sets, paired levels, and an automatic real-game test after every round, so each round is judged by the real game and not only the simulator." },
];

/** problems and inefficiencies found in this project, then what to add; every item names the evidence */
export function ImprovementPlan() {
  const render = (items: Item[]) => items.map((it) => (
    <View key={it.title} style={s.card2}>
      <Text style={s.cardTitle2}>{it.title}</Text>
      <Text style={s.p}><Text style={s.term}>Evidence. </Text>{it.evidence}</Text>
      <Text style={s.p}><Text style={s.term}>What to do. </Text>{it.fix}</Text>
    </View>
  ));
  return (
    <View>
      <Text style={s.h2}>PROBLEMS AND INEFFICIENCIES TO SOLVE</Text>
      <Text style={s.p}>Each problem names the evidence from this project. The fixes are proposals; none of them has been tested yet.</Text>
      {render(PROBLEMS)}
      <Text style={s.h2}>WHAT WE CAN ADD TO IMPROVE TRAINING</Text>
      {render(IMPROVEMENTS)}
    </View>
  );
}

const mono = Platform.select({ web: "ui-monospace, Menlo, monospace", default: "Courier" }) as string;
const s = StyleSheet.create({
  h2: { fontFamily: "retro", fontSize: 20, color: "#f8e84d", marginTop: 30, marginBottom: 8 },
  p: { color: "#ddd", fontFamily: mono, fontSize: 13, marginBottom: 8, lineHeight: 19 },
  term: { color: "#f8e84d", fontWeight: "700" },
  card: { borderLeftWidth: 4, backgroundColor: "#101010", padding: 12, marginBottom: 14 },
  cardTitle: { fontFamily: "retro", fontSize: 16, marginBottom: 8 },
  card2: { backgroundColor: "#101010", padding: 12, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: "#555" },
  cardTitle2: { fontFamily: "retro", fontSize: 13, color: "#fff", marginBottom: 6 },
});
