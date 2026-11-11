/**
 * A team's games with and without one player (browser-safe, pure). Used by the
 * "With / without" page on a team file (docs/data/teams/<TRI>.json):
 *   { team, keys: [starter, min, pts, fgm, fga, fg3m, fg3a, ftm, fta, reb, ast, tov, stl, blk, oreb, dreb, pf, pm],
 *     names: { id: name }, games: [{ id, d, opp, home, pf, pa, pl: { id: [..keys] } }] }
 *
 * "Without" means he didn't play (not listed, or listed with 0 minutes), counted
 * only from his first game listed with this team, so games before he joined (or
 * before his first appearance at all) aren't counted against him.
 */
const IX = { starter: 0, min: 1, pts: 2, fgm: 3, fga: 4, fg3m: 5, fg3a: 6, ftm: 7, fta: 8, reb: 9, ast: 10, tov: 11, stl: 12, blk: 13, oreb: 14, dreb: 15, pf: 16, pm: 17 };
const played = (g, id) => (g.pl[id]?.[IX.min] ?? 0) > 0;

/** Per-game averages over the games a player played; null if none. */
export function averages(lines) {
  if (!lines.length) return null;
  const s = (k) => lines.reduce((a, l) => a + l[IX[k]], 0);
  const n = lines.length;
  const fga = s("fga"), fg3a = s("fg3a"), fta = s("fta");
  return {
    gp: n, starts: s("starter"), min: s("min") / n, pts: s("pts") / n, reb: s("reb") / n, ast: s("ast") / n, stl: s("stl") / n, blk: s("blk") / n, tov: s("tov") / n,
    fga: fga / n, fg3m: s("fg3m") / n, fta: fta / n, pm: s("pm") / n,
    fgp: fga ? s("fgm") / fga : null, fg3p: fg3a ? s("fg3m") / fg3a : null, ftp: fta ? s("ftm") / fta : null,
  };
}

function record(games) {
  const w = games.filter((g) => g.pf > g.pa).length;
  return { w, l: games.length - w, margin: games.length ? games.reduce((a, g) => a + g.pf - g.pa, 0) / games.length : null, pf: games.length ? games.reduce((a, g) => a + g.pf, 0) / games.length : null, pa: games.length ? games.reduce((a, g) => a + g.pa, 0) / games.length : null };
}

/** Players listed for the team, with games played and minutes, for the picker. */
export function roster(file) {
  const out = {};
  for (const g of file.games) {
    for (const [id, l] of Object.entries(g.pl)) {
      const p = (out[id] ??= { id, name: file.names[id] || id, gp: 0, min: 0, first: g.d });
      if (l[IX.min] > 0) { p.gp++; p.min += l[IX.min]; }
    }
  }
  const games = file.games.length;
  return Object.values(out).map((p) => {
    const since = file.games.filter((g) => g.d >= p.first).length;
    return { ...p, mpg: p.gp ? p.min / p.gp : 0, missed: since - p.gp };
  }).sort((a, b) => b.min - a.min || a.name.localeCompare(b.name)).map((p) => ({ ...p, teamGames: games }));
}

export function withWithout(file, outId) {
  const games = [...file.games].sort((a, b) => a.d.localeCompare(b.d));
  const first = games.find((g) => outId in g.pl)?.d;
  if (!first) return null;
  const span = games.filter((g) => g.d >= first);
  const withG = span.filter((g) => played(g, outId)), withoutG = span.filter((g) => !played(g, outId));
  const ids = new Set(span.flatMap((g) => Object.keys(g.pl)).filter((id) => id !== outId));
  const players = [...ids].map((id) => {
    const w = averages(withG.filter((g) => played(g, id)).map((g) => g.pl[id]));
    const wo = averages(withoutG.filter((g) => played(g, id)).map((g) => g.pl[id]));
    return { id, name: file.names[id] || id, with: w, without: wo };
  }).filter((p) => p.with || p.without);
  return {
    out: { id: outId, name: file.names[outId] || outId, since: first },
    games: { with: withG.length, without: withoutG.length, withoutDates: withoutG.map((g) => g.d) },
    team: { with: record(withG), without: record(withoutG) },
    players,
  };
}
