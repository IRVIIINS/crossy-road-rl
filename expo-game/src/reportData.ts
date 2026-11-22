// Experiment results bundled into the app. `python make_report.py` regenerates assets/report/*.
export const summary: any = require("../assets/report/summary.json");
export const figures: { key: string; title: string; src: any }[] = [
  { key: "learning_curves", title: "Learning curves", src: require("../assets/report/learning_curves.png") },
  { key: "ablation_bar", title: "Ablation: held-out score", src: require("../assets/report/ablation_bar.png") },
  { key: "death_causes", title: "How the agents die", src: require("../assets/report/death_causes.png") },
  { key: "score_distribution", title: "Score distribution", src: require("../assets/report/score_distribution.png") },
];
