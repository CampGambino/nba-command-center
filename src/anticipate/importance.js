/**
 * How much a milestone matters: a transparent 0-100 score with its reasons.
 * Heuristic v1, meant to be tuned: every weight is in the tables below and every
 * score lists the reasons that produced it.
 *
 *   NBA-history passes  > franchise passes > round career numbers
 *   higher on the list  > lower on the list
 *   points              > rebounds/assists > threes > the rest
 *   bigger round number > smaller (10,000 points vs 500 points)
 */

const STAT_WEIGHT = {
  pts: 1.0, reb: 0.8, ast: 0.8, fg3m: 0.75, td: 0.8, dd: 0.6, stl: 0.6, blk: 0.6,
  dreb: 0.5, oreb: 0.45, gp: 0.5, gs: 0.4, fgm: 0.45, ftm: 0.45, min: 0.35,
  g30pt: 0.6, g40pt: 0.75, g50pt: 0.9, g60pt: 1.0,
  // Printed by some teams (Boston, Chicago, Orlando) but rarely news: kept, ranked low.
  fga: 0.15, fta: 0.15, pf: 0.1,
};

// Career totals that are notable on their own, smallest first; each step up adds weight.
const LANDMARKS = {
  pts: [5000, 10000, 15000, 20000, 25000, 30000],
  reb: [3000, 5000, 8000, 10000, 12000, 15000],
  ast: [2000, 3000, 5000, 6000, 8000, 10000],
  fg3m: [500, 1000, 1500, 2000, 2500, 3000],
  stl: [500, 1000, 1500, 2000],
  blk: [500, 1000, 1500, 2000],
  dreb: [3000, 5000, 8000, 10000],
  gp: [500, 800, 1000, 1200, 1500],
  ftm: [2000, 4000, 6000, 8000],
  fgm: [3000, 5000, 8000, 10000],
  td: [10, 25, 50, 100, 150],
  dd: [100, 200, 300, 500],
};

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
  "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"];

/** Rank the player moves into: the passed player's printed rank, or "seventh-most" / "10th" in a sentence. */
function rankOf(m) {
  if (m.passing?.rank != null) {
    const n = Number(String(m.passing.rank).replace(/\D/g, ""));
    if (n) return n;
  }
  const t = String(m.passing?.forWhat || "").toLowerCase();
  const d = /\b(\d{1,3})(?:st|nd|rd|th)\b/.exec(t);
  if (d) return Number(d[1]);
  const i = ORDINALS.findIndex((o) => new RegExp(`\\b${o}\\b`).test(t));
  return i >= 0 ? i + 1 : NaN;
}

export function importance(m) {
  const reasons = [];
  const w = STAT_WEIGHT[m.stat] ?? 0.4;
  let base;
  const rank = rankOf(m);
  if (m.kind === "pass" && m.scope === "nba") {
    base = 60;
    reasons.push("NBA history");
    if (rank <= 10) { base += 30; reasons.push(`top 10 (passing #${rank})`); }
    else if (rank <= 25) { base += 20; reasons.push(`top 25 (passing #${rank})`); }
    else if (rank <= 50) { base += 10; reasons.push(`top 50 (passing #${rank})`); }
    else if (rank <= 100) { base += 5; reasons.push(`top 100 (passing #${rank})`); }
  } else if (m.kind === "pass" && m.scope === "franchise") {
    base = 40;
    reasons.push("franchise history");
    if (rank <= 3) { base += 25; reasons.push(`top 3 (passing #${rank})`); }
    else if (rank <= 5) { base += 15; reasons.push(`top 5 (passing #${rank})`); }
    else if (rank <= 10) { base += 8; reasons.push(`top 10 (passing #${rank})`); }
  } else if (m.kind === "pass") {
    base = 30;
    reasons.push(`passing someone on a list of unproven scope`);
  } else {
    base = 25;
    const marks = LANDMARKS[m.stat] || [];
    const step = marks.filter((x) => m.target >= x).length;
    if (step) { base += 10 * step; reasons.push(`${m.target.toLocaleString("en-US")} ${m.label || m.stat} is a landmark (level ${step} of ${marks.length})`); }
    else reasons.push("round number");
  }
  if (w !== 1) reasons.push(`${m.label || m.stat} weighted ${w}`);
  const score = Math.max(0, Math.min(100, Math.round(base * w)));
  return { score, reasons };
}
