// Every finished round of "YOU vs AI" / "AI vs AI" is saved here (browser/Electron localStorage) so it can be
// exported from Settings and used as data in the report.
export type Match = {
  time: string;
  mode: "you-vs-ai" | "ai-vs-ai";
  left: string; right: string;
  leftScore: number; rightScore: number;
  winner: string;
  leftSeed: number; rightSeed: number;
};

const KEY = "crossy.matches.v1";

export function loadMatches(): Match[] {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function addMatch(m: Match) {
  try {
    const all = loadMatches();
    all.push(m);
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

export function clearMatches() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {}
}

export function matchesCsv(ms: Match[]) {
  const cols = ["time", "mode", "left", "right", "leftScore", "rightScore", "winner", "leftSeed", "rightSeed"];
  return [cols.join(","), ...ms.map((m) => cols.map((c) => JSON.stringify((m as any)[c] ?? "")).join(","))].join("\n") + "\n";
}
