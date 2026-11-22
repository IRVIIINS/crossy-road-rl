import React from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Asset } from "expo-asset";

import { download, downloadUrl } from "@/download";
import { Match, clearMatches, loadMatches, matchesCsv } from "@/matchLog";
import { figures, realGame, summary } from "@/reportData";
import { brain } from "@/ai/brain";

/**
 * Settings = the data screen for the report:
 *   - experiment results (ablation table, baselines, figures) with CSV / JSON / PNG downloads
 *   - the log of every YOU vs AI / AI vs AI round played in this app, with CSV download
 */
export default function SettingsScreen({ onExit }: { onExit: () => void }) {
  const [matches, setMatches] = React.useState<Match[]>(loadMatches);
  const [fig, setFig] = React.useState(0);
  const [, bump] = React.useState(0);
  const refresh = () => bump((n) => n + 1);
  const cfgs = Object.entries(summary.configs || {}) as [string, any][];
  const bases = Object.entries(summary.baselines || {}) as [string, any][];
  const hasResults = cfgs.length > 0;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.code === "Escape" && onExit();
    window.addEventListener("keyup", onKey);
    return () => window.removeEventListener("keyup", onKey);
  }, []);

  const wins = (who: string) => matches.filter((m) => m.winner === who).length;
  const everything = () =>
    JSON.stringify({ exported: new Date().toISOString(), experiment_summary: summary, match_log: matches, learning_log: brain.log }, null, 2);
  const figUri = (i: number) => (Asset.fromModule(figures[i].src).uri || (figures[i].src as any)?.uri) as string;

  return (
    <View style={s.root}>
      <View style={s.top}>
        <Pressable onPress={onExit} style={s.btn}>
          <Text style={s.btnText}>BACK</Text>
        </Pressable>
        <Text style={s.h1}>SETTINGS · DATA</Text>
        <View style={{ width: 90 }} />
      </View>
      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.h2}>EXPERIMENT RESULTS</Text>
        {!hasResults ? (
          <Text style={s.p}>No results bundled yet. Run run_experiments.py and make_report.py, then rebuild.</Text>
        ) : (
          <>
            <Text style={s.p}>
              Score = rows crossed. Mean ± std across training seeds, tested on {summary.test_episodes} held-out seeds.
            </Text>
            <Table
              head={["Config", "Seeds", "Test score", "Best seed", "Median", "Max"]}
              rows={cfgs.map(([, g]) => [
                g.label, String(g.seeds.length), `${g.mean_of_seed_means.toFixed(2)} ± ${g.std_across_seeds.toFixed(2)}`,
                g.best_seed_mean.toFixed(2), String(g.pooled_median), String(g.pooled_max),
              ])}
              flex={[3.2, 0.8, 1.6, 1.1, 1, 0.8]}
            />
            <Text style={[s.h3]}>BASELINES (NO LEARNING)</Text>
            <Table
              head={["Policy", "Mean", "Std", "Median", "Max"]}
              rows={bases.map(([k, v]) => [summary.baseline_labels[k], v.mean.toFixed(2), v.std.toFixed(2), String(v.median), String(v.max)])}
              flex={[3.2, 1, 1, 1, 1]}
            />
            {summary.level_maker && (
              <>
                <Text style={s.h3}>LEVEL-MAKER AI vs RANDOM LEVELS (SCORE, ROWS CROSSED)</Text>
                <Table
                  head={["Player", "Random levels", "Level maker", "Drop"]}
                  rows={summary.level_maker.table.map((t: any) => [
                    t.player, t.random_levels.toFixed(2),
                    `${t.maker_levels.toFixed(2)} ± ${t.maker_levels_std_over_maker_seeds.toFixed(2)}`, `${t.drop_pct.toFixed(0)}%`,
                  ])}
                  flex={[3.4, 1.3, 1.6, 0.8]}
                />
              </>
            )}
            <Text style={s.h3}>SHIPPED AI IN THE REAL GAME (NOT THE SIMULATOR), LEARNING OFF</Text>
            <Table
              head={["Levels", "Games", "Mean rows", "Std", "Median", "Max"]}
              rows={[["random_levels", "original random levels"], ["maker_levels", "level-maker levels"]].map(([k, label]) => {
                const r = realGame.after[k];
                return [label, String(r.games), r.mean.toFixed(2), r.std.toFixed(2), String(r.median), String(r.max)];
              })}
              flex={[2.4, 0.8, 1.2, 0.8, 1, 0.8]}
            />
            <View style={s.tabs}>
              {figures.map((f, i) => (
                <Pressable key={f.key} onPress={() => setFig(i)} style={[s.tab, i === fig && s.tabOn]}>
                  <Text style={s.tabText}>{f.title}</Text>
                </Pressable>
              ))}
            </View>
            <Image source={figures[fig].src} style={s.fig} resizeMode="contain" />
            <View style={s.row}>
              <Btn label="Save this figure (PNG)" onPress={() => downloadUrl(`${figures[fig].key}.png`, figUri(fig))} />
            </View>
            <Text style={s.h3}>DOWNLOAD DATA</Text>
            <View style={s.rowWrap}>
              <Btn label="Final results (CSV)" onPress={() => download("final_eval.csv", summary.csv.final_eval, "text/csv")} />
              <Btn label="Learning curves (CSV)" onPress={() => download("learning_curves.csv", summary.csv.learning_curves, "text/csv")} />
              {summary.csv.level_maker ? (
                <Btn label="Level maker (CSV)" onPress={() => download("level_maker.csv", summary.csv.level_maker, "text/csv")} />
              ) : null}
              <Btn label="Baselines (CSV)" onPress={() => download("baselines.csv", summary.csv.baselines, "text/csv")} />
              <Btn label="Tables (Markdown)" onPress={() => download("results_tables.md", summary.tables_md, "text/markdown")} />
              <Btn label="Summary (JSON)" onPress={() => download("summary.json", JSON.stringify(summary, null, 2), "application/json")} />
            </View>
          </>
        )}

        <Text style={[s.h2, { marginTop: 30 }]}>MATCHES PLAYED IN THIS APP</Text>
        <Text style={s.p}>
          {matches.length} rounds logged · YOU {wins("YOU")} · AI {wins("AI")} · AI 1 {wins("AI 1")} · AI 2 {wins("AI 2")} · ties {wins("TIE")}
        </Text>
        {matches.length > 0 && (
          <Table
            head={["When", "Mode", "Left", "Right", "Winner"]}
            rows={matches.slice(-12).reverse().map((m) => [
              new Date(m.time).toLocaleString(), m.mode === "you-vs-ai" ? "YOU vs AI" : "AI vs AI",
              `${m.left} ${m.leftScore}`, `${m.right} ${m.rightScore}`, m.winner,
            ])}
            flex={[2.4, 1.6, 1.4, 1.4, 1]}
          />
        )}
        <View style={s.rowWrap}>
          <Btn label="Match log (CSV)" onPress={() => download("matches.csv", matchesCsv(matches), "text/csv")} />
          <Btn label="Clear log" onPress={() => { clearMatches(); setMatches([]); }} />
        </View>

        <Text style={[s.h2, { marginTop: 30 }]}>WHAT THE AI HAS LEARNED</Text>
        <Text style={s.p}>
          Learning is OFF by default and is an experiment. When ON, the AI trains after every round on what it just did (Double DQN,
          same update as the Python training) and saves the new weights on this computer. In our simulator test (figure "Online
          learning test") this made the AI worse (27 to 10 rows over 150 rounds); "Reset AI to original" undoes it. Learning is {brain.learningEnabled ? "ON" : "OFF"} · {brain.version} learning rounds ·{" "}
          {brain.games} games · {brain.totalTransitions} moves learned from · {brain.totalUpdates} gradient updates.
        </Text>
        {brain.log.length > 0 && (
          <Table
            head={["Round", "Games", "Mean score", "Moves", "Updates", "Loss"]}
            rows={brain.log.slice(-12).reverse().map((e) => [
              `v${e.version}`, String(e.games), e.meanScore.toFixed(2), String(e.transitions), String(e.updates), e.loss.toFixed(4),
            ])}
            flex={[1, 1, 1.4, 1, 1, 1]}
          />
        )}
        <View style={s.rowWrap}>
          <Btn label={`Learning: ${brain.learningEnabled ? "ON" : "OFF"} (tap to switch)`} onPress={() => { brain.setLearning(!brain.learningEnabled); refresh(); }} />
          <Btn label="Learning log (CSV)" onPress={() => download("learning_log.csv", brain.logCsv(), "text/csv")} />
          <Btn label="Learned weights (JSON)" onPress={() => download("learned_weights.json", brain.exportWeightsJson(), "application/json")} />
          <Btn label="Reset AI to original" onPress={() => { brain.reset(); refresh(); }} />
        </View>

        <Text style={[s.h2, { marginTop: 30 }]}>EVERYTHING</Text>
        <View style={s.rowWrap}>
          <Btn label="Download all (JSON)" onPress={() => download("crossy_report_data.json", everything(), "application/json")} />
        </View>
      </ScrollView>
    </View>
  );
}

const Btn = ({ label, onPress }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [s.btn, pressed && { opacity: 0.75 }]}>
    <Text style={s.btnText}>{label}</Text>
  </Pressable>
);

function Table({ head, rows, flex }: { head: string[]; rows: string[][]; flex: number[] }) {
  return (
    <View style={s.table}>
      <View style={[s.tr, { backgroundColor: "#222" }]}>
        {head.map((h, i) => (
          <Text key={i} style={[s.th, { flex: flex[i] }]}>{h}</Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={[s.tr, ri % 2 ? { backgroundColor: "#151515" } : null]}>
          {r.map((c, i) => (
            <Text key={i} style={[s.td, { flex: flex[i] }]}>{c}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const mono = Platform.select({ web: "ui-monospace, Menlo, monospace", default: "Courier" }) as string;
const s = StyleSheet.create({
  root: { position: Platform.select({ web: "fixed", default: "absolute" }) as any, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#0b0b0b" },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, backgroundColor: "#87C6FF" },
  h1: { fontFamily: "retro", fontSize: 22, color: "#000" },
  h2: { fontFamily: "retro", fontSize: 20, color: "#f8e84d", marginBottom: 8 },
  h3: { fontFamily: "retro", fontSize: 14, color: "#f8e84d", marginTop: 18, marginBottom: 6 },
  p: { color: "#ddd", fontFamily: mono, fontSize: 13, marginBottom: 10 },
  body: { padding: 20, maxWidth: 980, width: "100%", alignSelf: "center", paddingBottom: 60 },
  btn: { backgroundColor: "#000", borderColor: "#fff", borderWidth: 2, paddingVertical: 8, paddingHorizontal: 14 },
  btnText: { fontFamily: "retro", color: "#fff", fontSize: 13 },
  row: { flexDirection: "row", marginTop: 8 },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  table: { borderColor: "#444", borderWidth: 1, marginBottom: 6 },
  tr: { flexDirection: "row" },
  th: { color: "#f8e84d", fontFamily: mono, fontSize: 12, padding: 6, fontWeight: "700" },
  td: { color: "#eee", fontFamily: mono, fontSize: 12, padding: 6 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 },
  tab: { borderColor: "#666", borderWidth: 1, paddingVertical: 5, paddingHorizontal: 10 },
  tabOn: { backgroundColor: "#2a2a2a", borderColor: "#f8e84d" },
  tabText: { color: "#fff", fontFamily: mono, fontSize: 12 },
  fig: { width: "100%", height: 420, backgroundColor: "#fff", marginTop: 10 },
});
