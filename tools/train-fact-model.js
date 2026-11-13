#!/usr/bin/env node
/**
 * The notes-line scorer (0.48): a logistic model over the features in src/notes/facts.js, learned from the user's picks.
 *
 *   node tools/train-fact-model.js            -> src/data/fact-model.json
 *
 * Labels: src/data/fact-labels.json, [{ date, team, text, meta: { player, team, matchup, kind, live }, label: 1|0, weight, source }].
 * A pick (a line the user sent as interesting) is label 1, weight 1. The other lines kept from the same notes are label 0
 * with a small weight: not chosen, which is weaker than "not interesting".
 *
 * With few labels the data can't stand alone, so the fit is pulled toward a hand-set prior (PRIOR below; a Gaussian prior,
 * sigma 1 per weight): the picks move the weights, they don't replace them. More picks, more movement.
 * Prints the fit and leave-one-out accuracy on the picks.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { features, FEATURES, score } from "../src/notes/facts.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PRIOR = {
  bias: -0.6,
  weights: { club: 0.8, clubSmall: 0.6, league: 0.5, history: 0.4, franchise: -0.1, season: 0.4, rank1: 0.8, rankTop3: 0.5, rankTop10: 0.1, rankDeep: -0.5,
    streak: 0.7, race: 0.6, matchup: 0.6, perGame: 0.1, combo: 0.3, singleGame: -0.3, slice: -0.1, since1973: 0.1, vague: -0.6, bio: -1.2,
    team: 0.1, player: 0.2, forward: 0.5, live: 0.6, long: -0.2 },
};

export function train(labels, { prior = PRIOR, sigma = 1, steps = 4000, lr = 0.05 } = {}) {
  const X = labels.map((l) => features(l.text, l.meta || {}));
  const w = { ...prior.weights };
  for (const k of FEATURES) w[k] ??= 0;
  let b = prior.bias;
  for (let it = 0; it < steps; it++) {
    const g = Object.fromEntries(FEATURES.map((k) => [k, 0]));
    let gb = 0;
    X.forEach((x, i) => {
      const p = score(x, { bias: b, weights: w });
      const e = (p - labels[i].label) * (labels[i].weight ?? 1);
      for (const k of FEATURES) g[k] += e * (x[k] || 0);
      gb += e;
    });
    for (const k of FEATURES) w[k] -= lr * (g[k] + (w[k] - (prior.weights[k] || 0)) / (sigma * sigma));
    b -= lr * (gb + (b - prior.bias) / (sigma * sigma));
  }
  return { bias: Math.round(b * 1000) / 1000, weights: Object.fromEntries(FEATURES.map((k) => [k, Math.round(w[k] * 1000) / 1000])) };
}

/** Ranking quality: the chance a pick scores above a line not picked (0.5 = coin flip, 1 = perfect). */
export function auc(labels, scores) {
  let n = 0, s = 0;
  labels.forEach((a, i) => labels.forEach((b, j) => { if (a.label === 1 && b.label === 0) { n++; s += scores[i] > scores[j] ? 1 : scores[i] === scores[j] ? 0.5 : 0; } }));
  return n ? Math.round((s / n) * 1000) / 1000 : null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const labels = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "fact-labels.json"), "utf8")).labels;
  const picks = labels.filter((l) => l.label === 1).length;
  const X = labels.map((l) => features(l.text, l.meta || {}));
  const priorAuc = auc(labels, X.map((x) => score(x, PRIOR)));
  // Leave-one-out at three prior strengths: each line scored by a model that never saw it.
  const tries = [0.25, 0.5, 1].map((sigma) => ({ sigma, auc: auc(labels, labels.map((l, i) => score(X[i], train(labels.filter((_, j) => j !== i), { sigma, steps: 1500 })))) }));
  const best = tries.sort((a, b) => b.auc - a.auc)[0];
  // The picks earn their way in: learned weights only when they rank held-out lines better than the prior does.
  const use = best.auc > priorAuc;
  const m = use ? train(labels, { sigma: best.sigma }) : { bias: PRIOR.bias, weights: { ...PRIOR.weights } };
  const out = { trainedAt: new Date().toISOString().slice(0, 10), labels: labels.length, picks, learned: use, sigma: use ? best.sigma : null,
    heldOutAuc: Object.fromEntries(tries.map((t) => [`sigma${t.sigma}`, t.auc])), priorAuc, prior: PRIOR, ...m };
  fs.writeFileSync(path.join(root, "src", "data", "fact-model.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`fact model: ${labels.length} labels (${picks} picks). Held-out AUC ${tries.map((t) => `${t.auc} (sigma ${t.sigma})`).join(", ")}; prior ${priorAuc}. ${use ? `Learned weights in use (sigma ${best.sigma}).` : "The prior stays in use until the picks beat it."}`);
}
