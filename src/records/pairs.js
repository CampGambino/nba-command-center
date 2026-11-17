/**
 * Two teams' regular-season games before 2016-17, as far back as they can be trusted (0.88).
 *
 * The user, 11/16, on the team guides: "that information could make it easier to check past records and streaks
 * against opponents". 0.87 read the games; this hands them to the head-to-head lines, which had started in 2016-17.
 *
 *   pairHistory({ deep, official, series }, a, b) -> null | { games, from, whole, exact, by }
 *
 * games   [{ d, home, away, hs, as, type: 2, winner, neutral? }], oldest first, all before 2016-17
 * from    the first season the list covers ("1976-77")
 * whole   the list reaches the first season the two franchises could have met
 * exact   whole, and the count of these games (plus our results since) is the all-time record both guides, or one guide
 *         and the count, agree on: only then is "the longest in the series" said
 * by      whose games they are (one team's validated seasons: deepSeqs)
 */
import { seriesPair } from "./series.js";

const END = "2016-17";
// A printed score is trusted for a margin only if it could be a real one: the largest margin before 2021 was 68.
export const SANE = { low: 30, high: 200, margin: 68 };

export function pairHistory({ deep, official, series }, a, b) {
  if (!deep?.seq || !official?.[a] || !official?.[b]) return null;
  const start = [official[a][0][0], official[b][0][0]].sort()[1];
  const side = [a, b].filter((t) => deep.seq[t] && deep.from?.[t] && deep.from[t] < END).sort((x, y) => (deep.from[x] < deep.from[y] ? -1 : 1))[0];
  if (!side) return null;
  const other = side === a ? b : a;
  const games = deep.seq[side].filter((g) => g.opp === other && g.pf !== g.pa).map((g) => {
    const home = g.h === false ? other : side, away = home === side ? other : side;
    const hs = home === side ? g.pf : g.pa, as = home === side ? g.pa : g.pf;
    return { d: g.d, home, away, hs, as, type: 2, winner: g.pf > g.pa ? side : other, ...(g.h == null ? { neutral: true } : {}) };
  }).sort((x, y) => (x.d < y.d ? -1 : 1));
  const whole = deep.from[side] <= start;
  const P = series ? seriesPair(series, a, b) : null;
  const exact = !!(whole && P && P.status === "confirmed" && (series.counted?.[a]?.[b] || []).some((c) => c.by === side && c.w === P.rec.overall.w && c.l === P.rec.overall.l));
  return { games, from: whole ? start : deep.from[side], whole, exact, by: side };
}

/** Streaks in a list of meetings, oldest first: [{ w, n, start, end }]. */
export function runsOf(list) {
  const out = [];
  for (const m of list) {
    const last = out[out.length - 1];
    if (last && last.w === m.winner) { last.n++; last.end = m.d; } else out.push({ w: m.winner, n: 1, start: m.d, end: m.d });
  }
  return out;
}

/** The largest margin of victory each team has in a list of meetings: { TRI: { m, d, hs, as, home } }. */
export function margins(list) {
  const out = {};
  for (const g of list) {
    const m = Math.abs(g.hs - g.as), old = g.d < "2016-10-01";
    if (old && (Math.min(g.hs, g.as) < SANE.low || Math.max(g.hs, g.as) > SANE.high || m > SANE.margin)) continue;
    if (!out[g.winner] || m > out[g.winner].m) out[g.winner] = { m, d: g.d, hi: Math.max(g.hs, g.as), lo: Math.min(g.hs, g.as), home: g.home };
  }
  return out;
}

/** One pairing for the lookup table: the longest streak each way, the largest margin each way, the first game on file. */
export function pairSummary(list, a, b) {
  const reg = list.filter((m) => m.type === 2);
  if (!reg.length) return null;
  const runs = runsOf(reg), best = (t) => runs.filter((r) => r.w === t).sort((x, y) => y.n - x.n || (x.end < y.end ? 1 : -1))[0] || null;
  const mg = margins(reg), cur = runs[runs.length - 1];
  return { games: reg.length, first: reg[0].d, streak: { [a]: best(a), [b]: best(b) }, margin: { [a]: mg[a] || null, [b]: mg[b] || null }, current: { w: cur.w, n: cur.n, since: cur.start } };
}
