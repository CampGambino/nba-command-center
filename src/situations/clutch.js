import { CLUTCH_KEYS } from "../espn/pbp.js";

/**
 * Season totals per player for a stretch of game time: clutch (row.cp) or the
 * 4th quarter (row.q4, with field "q4"), from results rows (see
 * results.js). Team is the player's team in his latest clutch game.
 * `unsureGames` counts games whose lineups couldn't be fully inferred: minutes
 * and plus/minus from those games may be off (counting stats are not).
 */
export function clutchPlayerTotals(rows, names = {}, field = "cp") {
  const out = {};
  for (const g of [...rows].sort((a, b) => a.d.localeCompare(b.d))) {
    const w = g[field];
    if (!w) continue;
    for (const [id, v] of Object.entries(w.p)) {
      const p = (out[id] ??= { id, name: names[id] || id, team: null, gp: 0, unsureGames: 0, ...Object.fromEntries(CLUTCH_KEYS.map((k) => [k, 0])) });
      p.team = v[0] === 0 ? g.h : g.a;
      p.gp++;
      if (!w.ok) p.unsureGames++;
      CLUTCH_KEYS.forEach((k, i) => { p[k] += v[i + 1]; });
    }
  }
  for (const p of Object.values(out)) {
    p.min = Math.round((p.sec / 60) * 100) / 100;
    for (const k of CLUTCH_KEYS) p[k] = Math.round(p[k] * 10) / 10;
  }
  return Object.values(out).sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
}

/**
 * Season totals per team for the same stretch of time, summed game by game
 * from each side's player lines (so a traded player's points stay with the
 * team he scored them for).
 */
export function clutchTeamTotals(rows, field = "cp") {
  const out = {};
  for (const g of rows) {
    const w = g[field];
    if (!w) continue;
    for (const [side, tri] of [[0, g.h], [1, g.a]]) {
      const t = (out[tri] ??= { team: tri, games: 0, ...Object.fromEntries(CLUTCH_KEYS.map((k) => [k, 0])) });
      t.games++;
      for (const v of Object.values(w.p)) if (v[0] === side) CLUTCH_KEYS.forEach((k, i) => { if (k !== "sec" && k !== "pm") t[k] += v[i + 1]; });
    }
  }
  return out;
}
