/**
 * Team scoring margin by quarter (0.72.7; the user, 11/15: "team plus/minus by quarter to determine if a team has one
 * awful quarter worth highlighting").
 *
 *   quarterMargins(rows) -> { TRI: { gp, q: [{ pf, pa, w, l }, x4], rank: [1 = best margin a game in that quarter, x4] } }
 *   quarterLines(rows, slate) -> storyline lines (kind "qtr"), one a team at most: a quarter near the top or bottom of
 *     the league that is out of line with the team's other three; and, when tonight's opponent is near the other end in
 *     the same quarter, that too (the predictive half: "the 3rd tonight: worst in the NBA against 2nd-best").
 *
 * rows: the results store's games ({ d, h, a, hq: [points by period], aq }). Overtime periods are left out, and the
 * line says so for a team that has played one (0.78).
 */
export const Q_MIN_GP = 8, Q_MARGIN = 2.5, Q_GAP = 4.5, Q_EDGE = 3;
const NAMES = ["1st", "2nd", "3rd", "4th"];
const ord = (n) => (n === 1 ? "" : n === 2 ? "2nd-" : n === 3 ? "3rd-" : `${n}th-`);
const sg = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "even");

export function quarterMargins(rows) {
  const T = {};
  const team = (t) => (T[t] ??= { gp: 0, q: [0, 1, 2, 3].map(() => ({ pf: 0, pa: 0, w: 0, l: 0 })) });
  for (const g of rows || []) {
    if (!Array.isArray(g.hq) || !Array.isArray(g.aq) || g.hq.length < 4 || g.aq.length < 4) continue;
    const H = team(g.h), A = team(g.a);
    H.gp++; A.gp++;
    if (g.hq.length > 4) { H.ot = (H.ot || 0) + 1; A.ot = (A.ot || 0) + 1; }
    for (let k = 0; k < 4; k++) {
      const h = g.hq[k] || 0, a = g.aq[k] || 0;
      H.q[k].pf += h; H.q[k].pa += a; A.q[k].pf += a; A.q[k].pa += h;
      if (h > a) { H.q[k].w++; A.q[k].l++; } else if (a > h) { A.q[k].w++; H.q[k].l++; }
    }
  }
  const per = (t, k) => (T[t].q[k].pf - T[t].q[k].pa) / T[t].gp;
  for (const t of Object.keys(T)) T[t].rank = [0, 1, 2, 3].map((k) => Object.keys(T).filter((o) => per(o, k) > per(t, k) + 1e-9).length + 1);
  return T;
}

export function quarterLines(rows, slate = []) {
  const T = quarterMargins(rows);
  const n = Object.keys(T).length;
  const opp = {};
  for (const g of slate || []) { opp[g.away] = g.home; opp[g.home] = g.away; }
  const out = [];
  for (const [t, x] of Object.entries(T)) {
    if (x.gp < Q_MIN_GP) continue;
    let best = null;
    for (let k = 0; k < 4; k++) {
      const net = x.q[k].pf - x.q[k].pa, m = net / x.gp;
      const others = [0, 1, 2, 3].filter((j) => j !== k).reduce((a, j) => a + x.q[j].pf - x.q[j].pa, 0);
      const gap = m - others / 3 / x.gp;
      const fromBottom = n - x.rank[k] + 1;
      const bad = fromBottom <= Q_EDGE && m <= -Q_MARGIN && (others >= 0 || gap <= -Q_GAP);
      const good = x.rank[k] <= Q_EDGE && m >= Q_MARGIN && (others <= 0 || gap >= Q_GAP);
      if (!bad && !good) continue;
      const size = Math.abs(gap);
      if (!best || size > best.size) best = { k, net, m, others, bad, place: bad ? fromBottom : x.rank[k], size };
    }
    if (!best) continue;
    const { k, net, m, others, bad, place } = best;
    const q = x.q[k];
    let text = `${t} has ${bad ? "been outscored by" : "outscored opponents by"} ${Math.abs(net)} in ${NAMES[k]} quarters (${m > 0 ? "+" : "−"}${Math.abs(m).toFixed(1)} a game, the ${ord(place)}${bad ? "worst" : "best"} in the NBA; ${bad ? `lost the quarter in ${q.l}` : `won the quarter in ${q.w}`} of ${x.gp} games) and is ${sg(others)} in the other three quarters combined${x.ot ? " (overtime not counted)" : ""}`;
    let score = 3.0 + Math.min(0.8, best.size / 10);
    const o = opp[t], O = o && T[o];
    if (O && O.gp >= Q_MIN_GP) {
      const oNet = O.q[k].pf - O.q[k].pa, oPlace = bad ? O.rank[k] : n - O.rank[k] + 1;
      if (oPlace <= 5 && (bad ? oNet > 0 : oNet < 0)) { text += `; tonight's opponent ${o} is ${sg(oNet)} in ${NAMES[k]} quarters (${ord(oPlace)}${bad ? "best" : "worst"})`; score += 0.5; }
    }
    out.push({ kind: "qtr", team: t, key: `qtr|${t}|${k}|${bad ? "bad" : "good"}`, text, score: Math.round(score * 100) / 100, rare: place === 1 });
  }
  return out;
}
