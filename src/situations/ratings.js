/**
 * Team ratings from box totals, and each team's offense against the best
 * defenses. Pure and browser-safe: the "vs top defenses" page imports a copy
 * (docs/lib/situations/ratings.js) and recomputes when the reader changes N.
 *
 * Input rows: results rows with hb/ab box totals
 *   [fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, ast, stl, blk, tov, pf].
 *
 * Possessions per team-game: FGA - OREB + TOV + 0.44 x FTA (the usual
 * estimate), averaged over both teams so a game has one possession count.
 * Offensive rating = points per 100 possessions; defensive rating = points
 * allowed per 100. A team's defense rank is by defensive rating, lowest first,
 * over all its games this season.
 */
const IX = { fgm: 0, fga: 1, fg3m: 2, fg3a: 3, ftm: 4, fta: 5, oreb: 6, dreb: 7, ast: 8, stl: 9, blk: 10, tov: 11, pf: 12 };
const est = (b) => b[IX.fga] - b[IX.oreb] + b[IX.tov] + 0.44 * b[IX.fta];

/** One line per team per game with box totals: { team, opp, date, win, pts, oppPts, poss, box, oppBox }. */
export function teamGameLines(rows) {
  const out = [];
  for (const g of rows) {
    if (!g.hb || !g.ab) continue;
    const poss = (est(g.hb) + est(g.ab)) / 2;
    out.push({ team: g.h, opp: g.a, date: g.d, win: g.hs > g.as, pts: g.hs, oppPts: g.as, poss, box: g.hb, oppBox: g.ab });
    out.push({ team: g.a, opp: g.h, date: g.d, win: g.as > g.hs, pts: g.as, oppPts: g.hs, poss, box: g.ab, oppBox: g.hb });
  }
  return out;
}

/** Totals over some lines -> offense numbers. null when there are no lines. */
export function offense(lines) {
  if (!lines.length) return null;
  const s = (f) => lines.reduce((a, l) => a + f(l), 0);
  const poss = s((l) => l.poss), pts = s((l) => l.pts);
  const fga = s((l) => l.box[IX.fga]), fgm = s((l) => l.box[IX.fgm]), fg3m = s((l) => l.box[IX.fg3m]), fg3a = s((l) => l.box[IX.fg3a]);
  const fta = s((l) => l.box[IX.fta]), oreb = s((l) => l.box[IX.oreb]), oppDreb = s((l) => l.oppBox[IX.dreb]), tov = s((l) => l.box[IX.tov]);
  return {
    games: lines.length, w: lines.filter((l) => l.win).length, l: lines.filter((l) => !l.win).length,
    ppg: pts / lines.length, ortg: (100 * pts) / poss, pace: poss / lines.length,
    efg: fga ? (fgm + 0.5 * fg3m) / fga : null, fg3: fg3a ? fg3m / fg3a : null,
    tov: poss ? tov / poss : null, oreb: oreb + oppDreb ? oreb / (oreb + oppDreb) : null, ftr: fga ? fta / fga : null,
  };
}

/** Season ratings for every team: { team: { games, ortg, drtg, net, pace } }, plus defense ranks. */
export function ratings(lines) {
  const by = {};
  for (const l of lines) (by[l.team] ??= []).push(l);
  const out = {};
  for (const [t, ls] of Object.entries(by)) {
    const poss = ls.reduce((a, l) => a + l.poss, 0);
    const pts = ls.reduce((a, l) => a + l.pts, 0), opp = ls.reduce((a, l) => a + l.oppPts, 0);
    out[t] = { games: ls.length, ortg: (100 * pts) / poss, drtg: (100 * opp) / poss, net: (100 * (pts - opp)) / poss, pace: poss / ls.length };
  }
  Object.keys(out).sort((a, b) => out[a].drtg - out[b].drtg).forEach((t, i) => { out[t].drank = i + 1; });
  Object.keys(out).sort((a, b) => out[b].ortg - out[a].ortg).forEach((t, i) => { out[t].orank = i + 1; });
  return out;
}

/**
 * Each team's offense against the N best defenses (by defensive rating) and
 * against everyone else. A team in the top N is compared with the other N-1
 * top defenses (it never plays itself).
 */
export function vsTopDefenses(lines, n) {
  const r = ratings(lines);
  const top = new Set(Object.keys(r).filter((t) => r[t].drank <= n));
  const by = {};
  for (const l of lines) (by[l.team] ??= []).push(l);
  const teams = {};
  for (const [t, ls] of Object.entries(by)) {
    const vs = offense(ls.filter((l) => top.has(l.opp)));
    const rest = offense(ls.filter((l) => !top.has(l.opp)));
    teams[t] = { all: offense(ls), vsTop: vs, rest, diff: vs && rest ? vs.ortg - rest.ortg : null, drank: r[t].drank, orank: r[t].orank };
  }
  return { n, top: [...top].sort((a, b) => r[a].drank - r[b].drank).map((t) => ({ team: t, drtg: r[t].drtg })), teams, ratings: r };
}
