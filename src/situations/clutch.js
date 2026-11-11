import { CLUTCH_KEYS } from "../espn/pbp.js";

/**
 * Season clutch-time totals per player from results rows (row.cp, see
 * results.js). Team is the player's team in his latest clutch game.
 * `unsureGames` counts games whose lineups couldn't be fully inferred: minutes
 * and plus/minus from those games may be off (counting stats are not).
 */
export function clutchPlayerTotals(rows, names = {}) {
  const out = {};
  for (const g of [...rows].sort((a, b) => a.d.localeCompare(b.d))) {
    if (!g.cp) continue;
    for (const [id, v] of Object.entries(g.cp.p)) {
      const p = (out[id] ??= { id, name: names[id] || id, team: null, gp: 0, unsureGames: 0, ...Object.fromEntries(CLUTCH_KEYS.map((k) => [k, 0])) });
      p.team = v[0] === 0 ? g.h : g.a;
      p.gp++;
      if (!g.cp.ok) p.unsureGames++;
      CLUTCH_KEYS.forEach((k, i) => { p[k] += v[i + 1]; });
    }
  }
  for (const p of Object.values(out)) {
    p.min = Math.round((p.sec / 60) * 100) / 100;
    for (const k of CLUTCH_KEYS) p[k] = Math.round(p[k] * 10) / 10;
  }
  return Object.values(out).sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
}
