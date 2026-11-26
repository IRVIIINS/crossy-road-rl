import React from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import GameView from "@/GameView";
import SettingsScreen from "@/SettingsScreen";
import BlocksScreen from "@/BlocksScreen";
import { addMatch } from "@/matchLog";
import { brain } from "@/ai/brain";
import { APP, LATEST, PC_BLOCKS, blockColor, blockLabel, pcBlock } from "@/ai/blocks";

type Mode = "you-vs-ai" | "ai-vs-ai";
type Screen = Mode | "settings" | "blocks";
type Blocks = [string, string]; // block driving the left / right pane (left is ignored in YOU vs AI)

const outline = (w: number) =>
  Platform.select({
    web: {
      textShadow: `-${w}px 0px 0px #000, ${w}px 0px 0px #000, 0px -${w}px 0px #000, 0px ${w}px 0px #000`,
    },
    default: {},
  }) as any;

function initialMode(): Screen | null {
  try {
    const m = new URLSearchParams(window.location.search).get("mode");
    return m === "you-vs-ai" || m === "ai-vs-ai" || m === "settings" || m === "blocks" ? m : null;
  } catch {
    return null;
  }
}

/** default brains: ?left=<block>&right=<block>, else the in-app learner while learning is ON, else the two newest blocks */
function initialBlocks(): Blocks {
  const ok = (b: string | null) => (b === APP || (b && pcBlock(b)) ? b : null);
  let left: string | null = null, right: string | null = null;
  try {
    const q = new URLSearchParams(window.location.search);
    left = ok(q.get("left")); right = ok(q.get("right"));
  } catch {}
  const prev = PC_BLOCKS.length > 1 ? PC_BLOCKS[PC_BLOCKS.length - 2].id : LATEST;
  const d = brain.defaultBlock();
  return [left ?? (d === APP ? APP : prev), right ?? d];
}

export default function Root() {
  const [mode, setMode] = React.useState<Screen | null>(initialMode);
  const [blocks, setBlocks] = React.useState<Blocks>(initialBlocks);
  const watch = (m: Mode, b: Blocks) => { setBlocks(b); setMode(m); };
  if (!mode) return <Menu onPick={setMode} />;
  if (mode === "settings") return <SettingsScreen onExit={() => setMode(null)} />;
  if (mode === "blocks") return <BlocksScreen onExit={() => setMode(null)} onWatch={watch} />;
  return <Arena key={mode + blocks.join()} mode={mode} initial={blocks} onExit={() => setMode(null)} />;
}

function Button({ label, hint, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}>
      <Text style={styles.buttonText}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </Pressable>
  );
}

function Menu({ onPick }: { onPick: (m: Screen) => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Digit1" || e.code === "Numpad1") onPick("you-vs-ai");
      if (e.code === "Digit2" || e.code === "Numpad2") onPick("ai-vs-ai");
      if (e.code === "Digit3" || e.code === "Numpad3") onPick("blocks");
      if (e.code === "Digit0" || e.code === "Numpad0") onPick("settings"); // hidden: data screen for the report
    };
    window.addEventListener("keyup", onKey);
    return () => window.removeEventListener("keyup", onKey);
  }, []);
  return (
    <View style={styles.menu}>
      <Image source={require("../../assets/images/title.png")} style={styles.title} />
      <Button label="YOU vs AI" hint="1" onPress={() => onPick("you-vs-ai")} />
      <Button label="AI vs AI" hint="2" onPress={() => onPick("ai-vs-ai")} />
      <Button label="TRAINING BLOCKS" hint="3 · every trained player, PC + in-app" onPress={() => onPick("blocks")} />
    </View>
  );
}

function Arena({ mode, initial, onExit }: { mode: Mode; initial: Blocks; onExit: () => void }) {
  const [round, setRound] = React.useState(0);
  const [blocks, setBlocks] = React.useState<Blocks>(initial);
  const newSeed = () => (Math.random() * 2 ** 31) | 0;
  // Same road on both boards whenever that is a fair race: YOU vs AI, or two DIFFERENT training blocks.
  // Two copies of the same (deterministic) block get their own roads, otherwise both boards would be identical.
  const sameRoad = (b: Blocks) => mode === "you-vs-ai" || b[0] !== b[1];
  const [seeds, setSeeds] = React.useState<number[]>(() => {
    const a = newSeed();
    return [a, sameRoad(initial) ? a : newSeed()];
  });
  const [scores, setScores] = React.useState<(number | null)[]>([null, null]);
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  const bothDone = scores[0] != null && scores[1] != null;
  // the AI learns from the round that just ended, then the next round can start
  const [learn, setLearn] = React.useState<{ done: number; total: number } | null>(null);
  const [learned, setLearned] = React.useState<string>("");
  const learning = learn != null;

  const restart = React.useCallback((b: Blocks = blocks) => {
    if (brain.busy) return;
    const a = newSeed();
    setSeeds([a, sameRoad(b) ? a : newSeed()]);
    setScores([null, null]);
    setRound((r) => r + 1);
  }, [mode, blocks]);
  const pick = (side: 0 | 1, id: string) => {
    const b: Blocks = side === 0 ? [id, blocks[1]] : [blocks[0], id];
    setBlocks(b);
    restart(b);
  };
  const aiBlocks = mode === "ai-vs-ai" ? blocks : [blocks[1]];
  const usesApp = aiBlocks.includes(APP);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") onExit();
      if (e.code === "KeyR" || (bothDone && e.code === "Enter")) restart();
    };
    window.addEventListener("keyup", onKey);
    return () => window.removeEventListener("keyup", onKey);
  }, [bothDone, restart, onExit]);

  const names =
    mode === "you-vs-ai" ? ["YOU", "AI"]
    : blocks[0] !== blocks[1] ? blocks.map((b) => blockLabel(b).toUpperCase())
    : ["AI 1", "AI 2"];
  let result = "";
  if (bothDone) {
    const [a, b] = scores as number[];
    result = a === b ? "TIE" : `${a > b ? names[0] : names[1]} WIN${names[a > b ? 0 : 1] === "YOU" ? "" : "S"}`;
  }

  // log every finished round so it can be exported from Settings
  React.useEffect(() => {
    if (!bothDone) return;
    const [a, b] = scores as number[];
    addMatch({
      time: new Date().toISOString(), mode,
      left: names[0], right: names[1], leftScore: a, rightScore: b,
      winner: a === b ? "TIE" : a > b ? names[0] : names[1],
      leftSeed: seeds[0], rightSeed: seeds[1],
      leftBlock: mode === "ai-vs-ai" ? blocks[0] : undefined, rightBlock: blocks[1],
    });
    if (brain.learningEnabled && usesApp) {
      setLearn({ done: 0, total: 1 });
      brain.trainRound((done, total) => setLearn({ done, total })).then((entry) => {
        setLearn(null);
        setLearned(entry ? `AI LEARNED  v${entry.version}  (${entry.updates} updates, saved)` : "");
      });
    } else setLearned(brain.learningEnabled ? "PC BLOCKS DO NOT LEARN (PICK IN-APP LEARNED)" : "LEARNING OFF");
  }, [bothDone, round]);

  return (
    <View style={styles.arena}>
      <View
        style={styles.panes}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setSize({ w: Math.floor((width - 4) / 2), h: Math.floor(height) });
        }}
      >
        {size && (
          <>
            <View style={{ width: size.w, height: size.h }}>
              <GameView
                key={`l${round}`}
                width={size.w}
                height={size.h}
                ai={mode === "ai-vs-ai"}
                block={blocks[0]}
                seed={seeds[0]}
                character="chicken"
                onDead={(s) => setScores((p) => [s, p[1]])}
              />
            </View>
            <View style={styles.divider} />
            <View style={{ width: size.w, height: size.h }}>
              <GameView
                key={`r${round}`}
                width={size.w}
                height={size.h}
                ai
                block={blocks[1]}
                seed={seeds[1]}
                character="chicken"
                onDead={(s) => setScores((p) => [p[0], s])}
              />
            </View>
          </>
        )}
      </View>
      {size && !bothDone && (
        <View pointerEvents="box-none" style={styles.pickers}>
          {([0, 1] as const).map((side) => (
            <View key={side} style={{ width: size.w, alignItems: "center" }}>
              {(mode === "ai-vs-ai" || side === 1) && <BlockPicker value={blocks[side]} onPick={(id) => pick(side, id)} />}
            </View>
          ))}
        </View>
      )}
      <View pointerEvents="box-none" style={styles.topBar}>
        <Pressable onPress={onExit} style={styles.small}>
          <Text style={styles.smallText}>MENU</Text>
        </Pressable>
        <Pressable onPress={() => restart()} style={styles.small}>
          <Text style={styles.smallText}>RESTART</Text>
        </Pressable>
      </View>
      {bothDone && (
        <View pointerEvents="box-none" style={styles.result}>
          <Text style={[styles.resultText, outline(5)]}>{result}</Text>
          <Text style={[styles.resultScores, outline(3)]}>
            {names[0]} {scores[0]}  -  {scores[1]} {names[1]}
          </Text>
          {learning ? (
            <Text style={[styles.resultScores, outline(3)]}>AI LEARNING {learn!.done}/{learn!.total} ...</Text>
          ) : (
            <>
              {!!learned && <Text style={[styles.learned, outline(2)]}>{learned}</Text>}
              <Button label="PLAY AGAIN" hint="Enter" onPress={() => restart()} />
            </>
          )}
        </View>
      )}
    </View>
  );
}

/** chips to choose which training block drives an AI pane */
function BlockPicker({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  const ids = [...PC_BLOCKS.map((b) => b.id), ...(brain.learningEnabled || brain.version > 0 ? [APP] : [])];
  return (
    <View style={styles.picker}>
      <Text style={styles.pickerHead}>BRAIN</Text>
      {ids.map((id) => {
        const on = id === value;
        return (
          <Pressable key={id} onPress={() => !on && onPick(id)}
            style={[styles.chip, { borderColor: blockColor(id) }, on && { backgroundColor: blockColor(id) }]}>
            <Text style={[styles.chipText, on && { color: "#000" }]}>{blockLabel(id).toUpperCase()}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: Platform.select({ web: "fixed", default: "absolute" }) as any,
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "#87C6FF",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
  },
  title: { width: "70%", maxWidth: 480, height: 200, resizeMode: "contain", marginBottom: 24 },
  button: {
    minWidth: 280,
    paddingVertical: 14,
    paddingHorizontal: 28,
    backgroundColor: "#0b0b0b",
    borderColor: "#fff",
    borderWidth: 3,
    alignItems: "center",
  },
  buttonText: { fontFamily: "retro", color: "#fff", fontSize: 30, letterSpacing: 1 },
  hint: { fontFamily: "retro", color: "#f8e84d", fontSize: 12, marginTop: 4 },
  arena: {
    position: Platform.select({ web: "fixed", default: "absolute" }) as any,
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "#000",
  },
  panes: { flex: 1, flexDirection: "row" },
  divider: { width: 4, backgroundColor: "#000" },
  topBar: {
    position: "absolute", bottom: 10, left: 0, right: 0,
    flexDirection: "row", justifyContent: "center", gap: 10,
  },
  pickers: { position: "absolute", bottom: 52, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between" },
  picker: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.6)", paddingVertical: 6, paddingHorizontal: 8, maxWidth: "96%",
  },
  pickerHead: { fontFamily: "retro", color: "#aaa", fontSize: 11, marginRight: 2 },
  chip: { borderWidth: 2, paddingVertical: 3, paddingHorizontal: 7 },
  chipText: { fontFamily: "retro", color: "#fff", fontSize: 11 },
  small: { backgroundColor: "rgba(0,0,0,0.7)", paddingVertical: 6, paddingHorizontal: 12 },
  smallText: { fontFamily: "retro", color: "#fff", fontSize: 14 },
  result: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center", justifyContent: "center", gap: 14,
  },
  resultText: { fontFamily: "retro", color: "#f8e84d", fontSize: 64 },
  learned: { fontFamily: "retro", color: "#8bf58b", fontSize: 18 },
  resultScores: { fontFamily: "retro", color: "#fff", fontSize: 28 },
});
