import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { brain } from "@/ai/brain";
import {
  APP, APP_COLOR, Block, LATEST, PC_BLOCKS, blockColor, blockLabel, curveOffset, lineage, pcBlock, shortGames,
} from "@/ai/blocks";

type Mode = "you-vs-ai" | "ai-vs-ai";
type Pt = [number, number];
export type Series = { color: string; points: Pt[]; dashed?: boolean };

/**
 * TRAINING BLOCKS: every trained player, one "block" per training round on the PC plus the in-app learner.
 *   EACH BLOCK  - pick a block: what it trained on, how long, its scores, its learning curve; watch it play
 *   CUMULATIVE  - all blocks together: total training, the winning line's learning curve across blocks, score after each block
 */
export default function BlocksScreen({ onExit, onWatch }: { onExit: () => void; onWatch: (m: Mode, b: [string, string]) => void }) {
  const [view, setView] = React.useState<"each" | "cumulative">("each");
  const [sel, setSel] = React.useState<string>(LATEST);
  const [, bump] = React.useState(0);
  const ids = [...PC_BLOCKS.map((b) => b.id), APP];

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.code === "Escape" && onExit();
    window.addEventListener("keyup", onKey);
    return () => window.removeEventListener("keyup", onKey);
  }, []);

  return (
    <View style={s.root}>
      <View style={s.top}>
        <Pressable onPress={onExit} style={s.btn}><Text style={s.btnText}>BACK</Text></Pressable>
        <Text style={s.h1}>TRAINING BLOCKS</Text>
        <View style={s.toggle}>
          {(["each", "cumulative"] as const).map((v) => (
            <Pressable key={v} onPress={() => setView(v)} style={[s.tgl, view === v && s.tglOn]}>
              <Text style={[s.tglText, view === v && { color: "#000" }]}>{v === "each" ? "EACH BLOCK" : "CUMULATIVE"}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <ScrollView contentContainerStyle={s.body}>
        <Timeline ids={ids} sel={view === "each" ? sel : null} onSel={(id) => { setSel(id); setView("each"); }} />
        {view === "each" ? (
          sel === APP ? <AppBlock onWatch={onWatch} refresh={() => bump((n) => n + 1)} /> : <PcBlock b={pcBlock(sel)!} onWatch={onWatch} />
        ) : (
          <Cumulative />
        )}
      </ScrollView>
    </View>
  );
}

// ------------------------------------------------------------------ timeline of blocks
function Timeline({ ids, sel, onSel }: { ids: string[]; sel: string | null; onSel: (id: string) => void }) {
  return (
    <View style={s.timeline}>
      {ids.map((id, i) => {
        const b = pcBlock(id);
        const on = sel === id;
        return (
          <React.Fragment key={id}>
            {i > 0 && <Text style={s.arrow}>{b?.startsFrom || b?.continues || id === APP ? "→" : "·"}</Text>}
            <Pressable onPress={() => onSel(id)} style={[s.tcard, { borderColor: blockColor(id) }, on && { backgroundColor: "#1f1f1f" }]}>
              <View style={[s.dot, { backgroundColor: blockColor(id) }]} />
              <Text style={s.tTitle}>{blockLabel(id).toUpperCase()}</Text>
              <Text style={s.tSub}>
                {id === APP ? `${brain.version} rounds · ${brain.games} games` : `${shortGames(b!.games)} games${b!.test ? ` · sim ${b!.test.random.toFixed(1)} rows` : ""}`}
              </Text>
              <Text style={[s.badge, { color: id === APP ? APP_COLOR : "#9ad" }]}>{id === APP ? "IN APP" : "ON PC"}</Text>
            </Pressable>
          </React.Fragment>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ one PC block
function PcBlock({ b, onWatch }: { b: Block; onWatch: (m: Mode, bl: [string, string]) => void }) {
  const i = PC_BLOCKS.findIndex((x) => x.id === b.id);
  const prev = i > 0 ? PC_BLOCKS[i - 1] : null;
  const maxScore = Math.max(...PC_BLOCKS.map((x) => x.test?.random ?? 0), 1);
  const off = curveOffset(b);
  const curve = b.curve.map(([g, r, m]) => [g + off, r, m] as const);
  const from = b.startsFrom ? `fine-tuned from ${blockLabel(b.startsFrom)}` : b.continues ? `continued the runs of ${blockLabel(b.continues)}` : "trained from scratch";
  return (
    <View>
      <Text style={[s.h2, { color: blockColor(b.id) }]}>{b.label.toUpperCase()}</Text>
      <Text style={s.p}>{b.date} · trained on the PC · {from}. {b.summary}</Text>
      <Stats items={[
        ["games (this player, all blocks)", b.games.toLocaleString()],
        ["games added by this block (all runs)", b.gamesAllRuns.toLocaleString()],
        ["runs in this block", String(b.runs)],
        ["training hours (this player)", b.hours == null ? "?" : b.hours.toFixed(1)],
        ["gradient updates (this player)", b.updates == null ? "?" : b.updates.toLocaleString()],
        ["chosen checkpoint", `${b.winner.job} · ${b.winner.checkpoint}`],
      ]} />

      <Text style={s.h3}>TEST SCORE (ROWS CROSSED, 300 UNSEEN LEVELS)</Text>
      {b.test ? (
        <>
          <Bar label="random levels" value={b.test.random} max={maxScore} color={blockColor(b.id)} delta={prev?.test ? b.test.random - prev.test.random : null} />
          <Bar label="level-maker levels" value={b.test.maker} max={maxScore} color={blockColor(b.id)} delta={prev?.test ? b.test.maker - prev.test.maker : null} />
          {prev && <Text style={s.note}>change vs {prev.label} in brackets</Text>}
        </>
      ) : <Text style={s.p}>not tested</Text>}

      {curve.length > 1 && (
        <>
          <Text style={s.h3}>LEARNING CURVE OF THE CHOSEN RUN (EVAL SCORE vs GAMES PLAYED)</Text>
          <LineChart
            series={[
              { color: blockColor(b.id), points: curve.map(([g, r]) => [g, r] as Pt) },
              { color: blockColor(b.id), points: curve.map(([g, , m]) => [g, m] as Pt), dashed: true },
            ]}
            markers={b.startsFrom ? [{ x: off, label: `start: ${blockLabel(b.startsFrom)}`, color: blockColor(b.startsFrom) }] : []}
          />
          <Text style={s.note}>bright = random levels · faded = level-maker levels · 100 fixed evaluation levels per point</Text>
        </>
      )}

      {b.configs && Object.keys(b.configs).length > 0 && (
        <>
          <Text style={s.h3}>SETUPS TRIED IN THIS BLOCK (MEAN OVER RUNS)</Text>
          <Table head={["Setup", "Runs", "Random levels", "Level-maker levels"]} flex={[2, 1, 1.6, 1.8]}
            rows={Object.entries(b.configs).map(([k, v]) => [k === "mix50" ? "mix50 (half on level-maker levels)" : k === "random" ? "random (original levels)" : k, String(v.runs), v.random.toFixed(2), v.maker.toFixed(2)])} />
        </>
      )}

      <View style={s.rowWrap}>
        {prev && <Btn label={`WATCH vs ${prev.label.toUpperCase()}`} onPress={() => onWatch("ai-vs-ai", [prev.id, b.id])} />}
        <Btn label="WATCH IT PLAY" onPress={() => onWatch("ai-vs-ai", [b.id, b.id])} />
        <Btn label="PLAY AGAINST IT" onPress={() => onWatch("you-vs-ai", [b.id, b.id])} />
      </View>

      {!!b.crossEval && (
        <>
          <Text style={s.h3}>CROSS-EVALUATION</Text>
          <Text style={s.mono}>{b.crossEval.trim()}</Text>
        </>
      )}
    </View>
  );
}

// ------------------------------------------------------------------ the in-app learner
function AppBlock({ onWatch, refresh }: { onWatch: (m: Mode, bl: [string, string]) => void; refresh: () => void }) {
  const base = pcBlock(brain.base);
  let games = 0;
  const pts: Pt[] = brain.log.map((e) => { games += e.games; return [games, e.meanScore]; });
  return (
    <View>
      <Text style={[s.h2, { color: APP_COLOR }]}>IN-APP LEARNED</Text>
      <Text style={s.p}>
        Learning in the app is {brain.learningEnabled ? "ON" : "OFF"}. When ON, an AI pane set to "In-app learned" trains after every round on
        the moves it just made (Double DQN, same update as on the PC) and saves the weights on this device. It started from{" "}
        {base?.label ?? brain.base}. Scores here are from the real game, so they are not directly comparable with the PC test scores.
      </Text>
      <Stats items={[
        ["started from", base?.label ?? brain.base],
        ["learning rounds", String(brain.version)],
        ["games learned from", brain.games.toLocaleString()],
        ["moves learned from", brain.totalTransitions.toLocaleString()],
        ["gradient updates in app", brain.totalUpdates.toLocaleString()],
        ["games incl. PC training", ((base?.games ?? 0) + brain.games).toLocaleString()],
      ]} />
      {pts.length > 1 ? (
        <>
          <Text style={s.h3}>MEAN SCORE PER LEARNING ROUND (REAL GAME)</Text>
          <LineChart series={[{ color: APP_COLOR, points: pts }]} />
        </>
      ) : <Text style={s.p}>No in-app learning rounds yet. Switch learning ON, pick "In-app learned" as an AI's brain, and play.</Text>}
      <View style={s.rowWrap}>
        <Btn label={`LEARNING: ${brain.learningEnabled ? "ON" : "OFF"} (TAP)`} onPress={() => { brain.setLearning(!brain.learningEnabled); refresh(); }} />
        <Btn label={`WATCH vs ${(base?.label ?? "base").toUpperCase()}`} onPress={() => onWatch("ai-vs-ai", [brain.base, APP])} />
        <Btn label="PLAY AGAINST IT" onPress={() => onWatch("you-vs-ai", [APP, APP])} />
        <Btn label={`RESET (START FROM ${blockLabel(LATEST).toUpperCase()})`} onPress={() => { brain.reset(LATEST); refresh(); }} />
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ everything together
function Cumulative() {
  const totalGames = PC_BLOCKS.reduce((a, b) => a + b.gamesAllRuns, 0) + brain.games;
  const cpuHours = PC_BLOCKS.reduce((a, b) => a + (b.cpuHoursAllRuns ?? 0), 0);
  const line = lineage(LATEST);
  const lastPc = line[line.length - 1];
  // the winning line's learning curve, block after block (each block coloured, no overlap)
  const series: Series[] = [];
  const markers: { x: number; label: string; color: string }[] = [];
  let end = 0;
  const add = (id: string, label: string, pts: Pt[]) => {
    if (!pts.length) return;
    markers.push({ x: pts[0][0], label, color: blockColor(id) });
    series.push({ color: blockColor(id), points: series.length ? [series[series.length - 1].points.slice(-1)[0], ...pts] : pts });
    end = pts[pts.length - 1][0];
  };
  for (const b of line) {
    const off = curveOffset(b);
    const pts = b.curve.map(([g, r]) => [g + off, r] as Pt).filter(([x]) => x > end || end === 0);
    // a continued round: the part of this run's curve played during the earlier round gets that round's colour
    const prev = b.continues ? pcBlock(b.continues) : undefined;
    const split = prev?.jobGames?.[b.winner.job];
    if (prev && split && !line.includes(prev)) {
      add(prev.id, `${prev.label} (same run)`, pts.filter(([x]) => x <= split));
      add(b.id, b.label, pts.filter(([x]) => x > split));
    } else add(b.id, b.label, pts);
  }
  if (brain.base === lastPc?.id && brain.log.length) {
    let g = lastPc.games;
    markers.push({ x: g, label: "in app", color: APP_COLOR });
    series.push({ color: APP_COLOR, dashed: true, points: brain.log.map((e) => { g += e.games; return [g, e.meanScore] as Pt; }) });
  }
  const maxScore = Math.max(...PC_BLOCKS.map((b) => b.test?.random ?? 0), 1);

  return (
    <View>
      <Text style={s.h2}>ALL BLOCKS TOGETHER</Text>
      <Stats items={[
        ["training blocks", `${PC_BLOCKS.length} on PC + in-app`],
        ["games played in training (all runs, all blocks)", totalGames.toLocaleString()],
        ["PC compute (CPU-hours, all runs)", cpuHours ? cpuHours.toFixed(0) : "?"],
        ["games behind the newest player", lastPc ? lastPc.games.toLocaleString() : "?"],
        ["in-app learning", `${brain.version} rounds · ${brain.games} games · ${brain.totalUpdates} updates`],
        ["newest player vs original (random levels)", PC_BLOCKS[0].test && lastPc?.test ? `${PC_BLOCKS[0].test.random.toFixed(1)} → ${lastPc.test.random.toFixed(1)}` : "?"],
      ]} />

      <Text style={s.h3}>GAMES ADDED BY EACH BLOCK (CUMULATIVE)</Text>
      <Stacked parts={[...PC_BLOCKS.map((b) => ({ id: b.id, v: b.gamesAllRuns })), { id: APP, v: brain.games }]} />

      <Text style={s.h3}>SCORE AFTER EACH BLOCK (300 UNSEEN LEVELS)</Text>
      {PC_BLOCKS.map((b) => b.test && (
        <View key={b.id} style={{ marginBottom: 6 }}>
          <Text style={[s.small, { color: blockColor(b.id) }]}>{b.label.toUpperCase()} · {shortGames(b.games)} games</Text>
          <Bar label="random" value={b.test.random} max={maxScore} color={blockColor(b.id)} />
          <Bar label="level maker" value={b.test.maker} max={maxScore} color={blockColor(b.id)} faded />
        </View>
      ))}

      {series.length > 0 && (
        <>
          <Text style={s.h3}>THE WINNING LINE, BLOCK AFTER BLOCK (EVAL SCORE vs TOTAL GAMES)</Text>
          <LineChart series={series} markers={markers} />
          <Text style={s.note}>
            Each colour is one block; the line follows {line.map((b) => b.label).join(" → ")}
            {brain.base === lastPc?.id && brain.log.length ? " → in-app learning (faded, real-game score)" : ""}.
          </Text>
        </>
      )}
    </View>
  );
}

// ------------------------------------------------------------------ small drawing helpers (plain Views, no chart library)
export function LineChart({ series, markers = [], height = 220, xFormat }: { series: Series[]; markers?: { x: number; label: string; color: string }[]; height?: number; xFormat?: (x: number) => string }) {
  const [w, setW] = React.useState(0);
  const all = series.flatMap((x) => x.points);
  const xMin = Math.min(...all.map((p) => p[0]), ...markers.map((m) => m.x));
  const xMax = Math.max(...all.map((p) => p[0]), xMin + 1);
  const yMax = Math.max(...all.map((p) => p[1]), 1) * 1.1;
  const pad = 36;
  const X = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * (w - pad - 8);
  const Y = (y: number) => height - 18 - (y / yMax) * (height - 28);
  const seg = (a: Pt, b: Pt, color: string, dashed: boolean | undefined, k: string) => {
    const x1 = X(a[0]), y1 = Y(a[1]), x2 = X(b[0]), y2 = Y(b[1]);
    const len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1);
    return (
      <View key={k} style={{
        position: "absolute", left: (x1 + x2) / 2 - len / 2, top: (y1 + y2) / 2 - 1, width: len, height: 2,
        backgroundColor: color, opacity: dashed ? 0.55 : 1, transform: [{ rotate: `${ang}rad` }],
      }} />
    );
  };
  const ticks = [0, 0.5, 1].map((f) => Math.round(yMax * f / 1.1));
  return (
    <View style={[s.chart, { height }]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <>
          {ticks.map((t) => (
            <React.Fragment key={t}>
              <View style={{ position: "absolute", left: pad, right: 8, top: Y(t), height: 1, backgroundColor: "#2a2a2a" }} />
              <Text style={[s.axis, { top: Y(t) - 7, left: 4 }]}>{t}</Text>
            </React.Fragment>
          ))}
          {markers.map((m, i) => (
            <React.Fragment key={`m${i}`}>
              <View style={{ position: "absolute", left: X(m.x), top: 4, bottom: 18, width: 1, backgroundColor: m.color, opacity: 0.6 }} />
              <Text style={[s.axis, { left: X(m.x) + 3, top: 4 + (i % 3) * 12, color: m.color }]}>{m.label}</Text>
            </React.Fragment>
          ))}
          {series.map((sr, si) => sr.points.slice(1).map((p, i) => seg(sr.points[i], p, sr.color, sr.dashed, `${si}-${i}`)))}
          <Text style={[s.axis, { left: pad, bottom: 2 }]}>{xFormat ? xFormat(xMin) : shortGames(xMin)}</Text>
          <Text style={[s.axis, { right: 8, bottom: 2 }]}>{xFormat ? xFormat(xMax) : `${shortGames(xMax)} games`}</Text>
        </>
      )}
    </View>
  );
}

export function Stacked({ parts }: { parts: { id: string; v: number }[] }) {
  const total = parts.reduce((a, p) => a + p.v, 0) || 1;
  return (
    <View>
      <View style={s.stack}>
        {parts.filter((p) => p.v > 0).map((p) => (
          <View key={p.id} style={{ flex: p.v / total, backgroundColor: blockColor(p.id), minWidth: 3 }} />
        ))}
      </View>
      <View style={s.legend}>
        {parts.map((p) => (
          <Text key={p.id} style={[s.small, { color: blockColor(p.id) }]}>
            ■ {blockLabel(p.id)} {shortGames(p.v)} ({Math.round((100 * p.v) / total)}%)
          </Text>
        ))}
      </View>
    </View>
  );
}

export function Bar({ label, value, max, color, delta = null, faded }: { label: string; value: number; max: number; color: string; delta?: number | null; faded?: boolean }) {
  return (
    <View style={s.barRow}>
      <Text style={s.barLabel}>{label}</Text>
      <View style={s.barTrack}>
        <View style={{ width: `${Math.min(100, (100 * value) / max)}%`, height: "100%", backgroundColor: color, opacity: faded ? 0.5 : 1 }} />
      </View>
      <Text style={s.barVal}>
        {value.toFixed(1)}
        {delta != null ? ` (${delta >= 0 ? "+" : ""}${delta.toFixed(1)})` : ""}
      </Text>
    </View>
  );
}

export function Stats({ items }: { items: [string, string][] }) {
  return (
    <View style={s.stats}>
      {items.map(([k, v]) => (
        <View key={k} style={s.stat}>
          <Text style={[s.statV, v.length > 14 && { fontSize: 12 }]}>{v}</Text>
          <Text style={s.statK}>{k}</Text>
        </View>
      ))}
    </View>
  );
}

const Btn = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [s.btn, pressed && { opacity: 0.75 }]}>
    <Text style={s.btnText}>{label}</Text>
  </Pressable>
);

export function Table({ head, rows, flex }: { head: string[]; rows: string[][]; flex: number[] }) {
  return (
    <View style={s.table}>
      <View style={[s.tr, { backgroundColor: "#222" }]}>
        {head.map((h, i) => <Text key={i} style={[s.th, { flex: flex[i] }]}>{h}</Text>)}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={[s.tr, ri % 2 ? { backgroundColor: "#151515" } : null]}>
          {r.map((c, i) => <Text key={i} style={[s.td, { flex: flex[i] }]}>{c}</Text>)}
        </View>
      ))}
    </View>
  );
}

const mono = Platform.select({ web: "ui-monospace, Menlo, monospace", default: "Courier" }) as string;
const s = StyleSheet.create({
  root: { position: Platform.select({ web: "fixed", default: "absolute" }) as any, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#0b0b0b" },
  top: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between", padding: 14, backgroundColor: "#87C6FF" },
  h1: { fontFamily: "retro", fontSize: 22, color: "#000" },
  h2: { fontFamily: "retro", fontSize: 20, color: "#f8e84d", marginTop: 18, marginBottom: 8 },
  h3: { fontFamily: "retro", fontSize: 13, color: "#f8e84d", marginTop: 20, marginBottom: 8 },
  p: { color: "#ddd", fontFamily: mono, fontSize: 13, marginBottom: 10, lineHeight: 19 },
  note: { color: "#888", fontFamily: mono, fontSize: 11, marginTop: 4 },
  small: { fontFamily: mono, fontSize: 12, marginBottom: 2 },
  mono: { color: "#ccc", fontFamily: mono, fontSize: 11, backgroundColor: "#141414", padding: 10 },
  body: { padding: 16, maxWidth: 980, width: "100%", alignSelf: "center", paddingBottom: 60 },
  btn: { backgroundColor: "#000", borderColor: "#fff", borderWidth: 2, paddingVertical: 8, paddingHorizontal: 12 },
  btnText: { fontFamily: "retro", color: "#fff", fontSize: 12 },
  toggle: { flexDirection: "row", borderWidth: 2, borderColor: "#000" },
  tgl: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: "#000" },
  tglOn: { backgroundColor: "#f8e84d" },
  tglText: { fontFamily: "retro", color: "#fff", fontSize: 12 },
  timeline: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  arrow: { color: "#777", fontSize: 18 },
  tcard: { borderWidth: 2, padding: 8, minWidth: 120, backgroundColor: "#111" },
  dot: { width: 10, height: 10, marginBottom: 4 },
  tTitle: { fontFamily: "retro", color: "#fff", fontSize: 12 },
  tSub: { fontFamily: mono, color: "#bbb", fontSize: 11, marginTop: 2 },
  badge: { fontFamily: "retro", fontSize: 9, marginTop: 4 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { backgroundColor: "#151515", padding: 10, minWidth: 150, flexGrow: 1, flexBasis: 150 },
  statV: { fontFamily: "retro", color: "#fff", fontSize: 16 },
  statK: { fontFamily: mono, color: "#999", fontSize: 11, marginTop: 4 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  barLabel: { fontFamily: mono, color: "#bbb", fontSize: 12, width: 130 },
  barTrack: { flex: 1, height: 14, backgroundColor: "#1d1d1d" },
  barVal: { fontFamily: mono, color: "#fff", fontSize: 12, width: 100 },
  chart: { backgroundColor: "#121212", borderColor: "#2a2a2a", borderWidth: 1, overflow: "hidden" },
  axis: { position: "absolute", fontFamily: mono, color: "#888", fontSize: 10 },
  stack: { flexDirection: "row", height: 22, backgroundColor: "#1d1d1d" },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, marginTop: 6 },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
  table: { borderColor: "#444", borderWidth: 1, marginBottom: 6 },
  tr: { flexDirection: "row" },
  th: { color: "#f8e84d", fontFamily: mono, fontSize: 12, padding: 6, fontWeight: "700" },
  td: { color: "#eee", fontFamily: mono, fontSize: 12, padding: 6 },
});
