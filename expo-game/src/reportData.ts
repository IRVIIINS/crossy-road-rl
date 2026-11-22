// Experiment results bundled into the app. `python make_report.py` regenerates assets/report/*.
export const summary: any = require("../assets/report/summary.json");
export const figures: { key: string; title: string; src: any }[] = [
  { key: "learning_curves", title: "Learning curves", src: require("../assets/report/learning_curves.png") },
  { key: "ablation_bar", title: "Ablation: held-out score", src: require("../assets/report/ablation_bar.png") },
  { key: "death_causes", title: "How the agents die", src: require("../assets/report/death_causes.png") },
  { key: "score_distribution", title: "Score distribution", src: require("../assets/report/score_distribution.png") },
  { key: "level_maker_scores", title: "Level maker: scores", src: require("../assets/report/level_maker_scores.png") },
  { key: "level_maker_rows", title: "Level maker: rows built", src: require("../assets/report/level_maker_rows.png") },
  { key: "level_maker_training", title: "Level maker: training", src: require("../assets/report/level_maker_training.png") },
];
