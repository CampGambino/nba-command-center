/**
 * NBA Cup vs the rest of the season (moved from NBA GameFlow, 11/13): who is different in Cup games. Pure.
 *
 * GameFlow's rules, kept: Cup games against every OTHER game he played (a partition, so the gap is like for like); 2+ Cup
 * games and 5+ others; the outlier score divides the gap by sd / sqrt(n), the spread an n-game average of his shows by chance
 * (a Cup average is several games, which wobble less than one); shooting is makes over attempts. The championship doesn't
 * count in regular-season stats and isn't in the box scores here, so it isn't in either column.
 *
 *   cupVsSeason({ teamFiles, cup }) -> { players: [...], teams: [...], cupGames }
 */
import { cupOnly } from "./cup.js";

export const CUP_MIN_GAMES = 2, CUP_MIN_BASE = 5;
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const sd = (a) => { if (a.length < 2) return null; const m = avg(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
const STATS = ["pts", "reb", "ast", "fg3m", "min"];

export function cupVsSeason({ teamFiles = {}, cup = {} }) {
  const cupFiles = cupOnly(teamFiles, cup);
  const isCup = {};
  for (const [tri, f] of Object.entries(cupFiles)) for (const g of f.games || []) isCup[`${tri}|${g.d}`] = true;
  const per = {}, teams = {};
  for (const [tri, f] of Object.entries(teamFiles)) {
    const ix = Object.fromEntries((f.keys || []).map((k, i) => [k, i]));
    const t = (teams[tri] = { tri, c: { w: 0, l: 0, pf: 0, pa: 0 }, r: { w: 0, l: 0, pf: 0, pa: 0 } });
    for (const g of f.games || []) {
      if (g.pf == null || g.pa == null) continue;
      const c = !!isCup[`${tri}|${g.d}`];
      const s = t[c ? "c" : "r"]; if (g.pf > g.pa) s.w++; else s.l++; s.pf += g.pf; s.pa += g.pa;
      for (const [id, row] of Object.entries(g.pl || {})) {
        if (!(row[ix.min] > 0)) continue;
        const p = (per[id] ??= { id, name: f.names?.[id] || id, tri, last: "", cup: [], base: [] });
        if (g.d >= p.last) { p.last = g.d; p.tri = tri; }
        const line = Object.fromEntries([...STATS, "fgm", "fga", "fg3a"].map((k) => [k, row[ix[k]] || 0]));
        (c ? p.cup : p.base).push({ d: g.d, opp: g.opp, ...line });
      }
    }
  }
  const pct = (a, m, t) => { const T = a.reduce((s, g) => s + g[t], 0); return T ? (100 * a.reduce((s, g) => s + g[m], 0)) / T : null; };
  const players = [];
  let thinCup = 0, thinBase = 0;
  for (const p of Object.values(per)) {
    if (!p.cup.length) continue;
    if (p.cup.length < CUP_MIN_GAMES) { thinCup++; continue; }
    if (p.base.length < CUP_MIN_BASE) { thinBase++; continue; }
    const row = { id: p.id, name: p.name, tri: p.tri, cupGp: p.cup.length, baseGp: p.base.length, cup: {}, base: {}, z: {}, gap: {} };
    for (const k of STATS) {
      const cv = p.cup.map((g) => g[k]), bv = p.base.map((g) => g[k]), s = sd(bv);
      row.cup[k] = avg(cv); row.base[k] = avg(bv); row.gap[k] = row.cup[k] - row.base[k];
      row.z[k] = s ? row.gap[k] / (s / Math.sqrt(cv.length)) : null;
    }
    row.fg = [pct(p.cup, "fgm", "fga"), pct(p.base, "fgm", "fga")];
    row.tp = [pct(p.cup, "fg3m", "fg3a"), pct(p.base, "fg3m", "fg3a")];
    row.games = p.cup.map((g) => ({ d: g.d, opp: g.opp, pts: g.pts, reb: g.reb, ast: g.ast }));
    players.push(row);
  }
  players.sort((a, b) => Math.abs(b.z.pts ?? 0) - Math.abs(a.z.pts ?? 0));
  const rate = (s) => { const n = s.w + s.l; return n ? { n, w: s.w, l: s.l, pf: s.pf / n, pa: s.pa / n, mg: (s.pf - s.pa) / n } : null; };
  const teamRows = Object.values(teams).map((t) => ({ tri: t.tri, cup: rate(t.c), rest: rate(t.r) })).filter((t) => t.cup && t.rest)
    .map((t) => ({ ...t, gap: t.cup.mg - t.rest.mg })).sort((a, b) => b.gap - a.gap);
  return { players, teams: teamRows, thinCup, thinBase, cupGames: Object.values(cupFiles).reduce((a, f) => a + (f.games || []).length, 0) / 2 };
}
