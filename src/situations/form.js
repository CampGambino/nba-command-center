/**
 * Hot hand: who is playing above (or below) his own normal lately (moved from NBA GameFlow, 11/13). Pure, browser-safe.
 *
 * GameFlow's rules, kept:
 *   - a stretch = his last N games played; "normal" = his games before it (5+ needed), so the stretch is never in its own baseline;
 *   - strength in standard deviations of his normal (sample SD), ranked by that;
 *   - the median of the stretch must sit on the same side of normal as the average ("real"): one 40 can't make three quiet
 *     games a heater, one 0 can't make them a slump;
 *   - a floor: on the stretch for a heater, on his normal for a slump; a minutes bar every game of the stretch must clear;
 *   - runs: how many games in a row, from his latest, each beat the average of everything before them (2+).
 *
 * Input (docs/data/form.json, written by the build): { players: { id: { name, team, g: [[date, min, pts, reb, ast, tov], ...] } } }
 */
export const LENS = [3, 4, 5], MIN_BASE = 5, MIN_RUN = 2;
export const STATS = { pts: "points", reb: "rebounds", ast: "assists", pra: "points + rebounds + assists", min: "minutes", to: "turnovers" };
export const FLOORS = { pts: [0, 5, 10, 15, 20], reb: [0, 2, 4, 6, 8], ast: [0, 2, 3, 5, 7], to: [0, 2, 3, 4], min: [0, 10, 15, 20, 25], pra: [0, 10, 15, 20, 25, 30] };
const C = { d: 0, min: 1, pts: 2, reb: 3, ast: 4, to: 5 };
export const statOf = (row, k) => (k === "pra" ? row[C.pts] + row[C.reb] + row[C.ast] : row[C[k]] || 0);
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const med = (a) => { if (!a.length) return null; const v = a.slice().sort((x, y) => x - y), h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; };
const sd = (a) => { if (a.length < 2) return null; const m = avg(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };

/** Stretches: [{ id, name, team, recentAvg, baseAvg, gap, z, real, med, above, below, minAvg, minLow, seasonAvg, last, cats }] strongest first. */
export function formRows(players, { len = 5, key = "pts", dir = "up", floor = 0, minMinutes = 0 } = {}) {
  const down = dir === "down", out = [];
  for (const [id, p] of Object.entries(players || {})) {
    const g = p.g;
    if (g.length < len + MIN_BASE) continue;
    const recent = g.slice(-len), base = g.slice(0, -len);
    const rv = recent.map((r) => statOf(r, key)), bv = base.map((r) => statOf(r, key));
    const rm = avg(rv), bm = avg(bv), s = sd(bv);
    if (rm == null || bm == null || !s) continue;
    const mins = recent.map((r) => r[C.min]);
    if (minMinutes > 0 && !mins.every((m) => m >= minMinutes)) continue;
    if (floor > 0 && (down ? bm : rm) < floor) continue;
    const m = med(rv);
    const cats = ["pts", "reb", "ast"].map((c) => { const v = g.map((r) => statOf(r, c)); const a = avg(v.slice(-len)), b = avg(v.slice(0, -len)); return { cat: c, recent: a, base: b, moved: down ? a < b : a > b }; });
    out.push({ id, name: p.name, team: p.team, recentAvg: rm, baseAvg: bm, sd: s, gap: rm - bm, z: (rm - bm) / s, med: m, real: down ? m < bm : m > bm,
      above: rv.filter((v) => v > bm).length, below: rv.filter((v) => v < bm).length, values: rv, minAvg: avg(mins), minLow: Math.min(...mins),
      seasonAvg: avg(g.map((r) => statOf(r, key))), last: g[g.length - 1][C.d], baseN: base.length, cats });
  }
  out.sort((a, b) => (down ? a.z - b.z : b.z - a.z));
  return out;
}

/** Runs: games in a row, from his latest, each above (or below) the average of everything before them. Longest first. */
export function formRuns(players, { key = "pts", dir = "up" } = {}) {
  const down = dir === "down", out = [];
  for (const [id, p] of Object.entries(players || {})) {
    const vals = p.g.map((r) => statOf(r, key));
    let run = 0, base = null;
    for (let L = 1; L + MIN_BASE <= vals.length; L++) {
      const bm = avg(vals.slice(0, vals.length - L)), tail = vals.slice(vals.length - L);
      if (bm == null || !tail.every((v) => (down ? v < bm : v > bm))) break;
      run = L; base = bm;
    }
    if (run >= MIN_RUN) out.push({ id, name: p.name, team: p.team, run, baseAvg: base, runAvg: avg(vals.slice(-run)), values: vals.slice(-run), baseN: vals.length - run, last: p.g[p.g.length - 1][C.d] });
  }
  out.sort((a, b) => b.run - a.run || (down ? (a.runAvg - a.baseAvg) - (b.runAvg - b.baseAvg) : (b.runAvg - b.baseAvg) - (a.runAvg - a.baseAvg)));
  return out;
}

/** form.json from the season's player games (src/situations/trends.js playerGames: { id: [{ d, team, min, pts, reb, ast, tov, ... }] }). */
export function formData(pg, names = {}, teamOf = (id, last) => last) {
  const players = {};
  for (const [id, games] of Object.entries(pg)) {
    const g = games.map((x) => [x.d, Math.round(x.min * 10) / 10, x.pts, x.reb, x.ast, x.tov]);
    if (g.length < MIN_BASE + LENS[0]) continue;
    players[id] = { name: names[id] || id, team: teamOf(id, games[games.length - 1].team), g };
  }
  return { players };
}
