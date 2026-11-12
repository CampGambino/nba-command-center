/**
 * A team's games with and without one player (browser-safe, pure). Used by the
 * "With / without" page on a team file (docs/data/teams/<TRI>.json):
 *   { team, keys: [starter, min, pts, fgm, fga, fg3m, fg3a, ftm, fta, reb, ast, tov, stl, blk, oreb, dreb, pf, pm],
 *     names: { id: name }, games: [{ id, d, opp, home, pf, pa, pl: { id: [..keys] }, inj?: { id: status } }] }
 *
 * "Without" means he didn't play (not in the box score, or in it with 0 minutes), counted over the
 * games he was with the team: from the first game he was in the box score OR on the team's
 * official injury report (inj), to the last such game. ESPN's box scores leave inactive players
 * out, so without the injury report a player who sat the first eight games and debuted on 11/4
 * would look like he joined on 11/4. Games before he joined or after he left (a trade) don't count.
 */
const IX = { starter: 0, min: 1, pts: 2, fgm: 3, fga: 4, fg3m: 5, fg3a: 6, ftm: 7, fta: 8, reb: 9, ast: 10, tov: 11, stl: 12, blk: 13, oreb: 14, dreb: 15, pf: 16, pm: 17 };
const played = (g, id) => (g.pl[id]?.[IX.min] ?? 0) > 0;
/** With the team that night: in the box score (even 0 minutes) or on its injury report. */
const present = (g, id) => id in g.pl || !!(g.inj && id in g.inj);
/** The games he was with the team: first game present to the last (games sorted by date). */
function stint(games, id) {
  const i = games.findIndex((g) => present(g, id));
  if (i < 0) return [];
  // He left (a trade, a waiver) after the last game he was present for, unless we don't have that
  // night's injury report (no inj at all): then we can't tell, and he stays counted.
  let j = games.length - 1;
  while (j > i && !present(games[j], id) && games[j].inj) j--;
  return games.slice(i, j + 1);
}

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
  const sorted = [...file.games].sort((a, b) => a.d.localeCompare(b.d));
  for (const g of sorted) {
    for (const [id, l] of Object.entries(g.pl)) {
      const p = (out[id] ??= { id, name: file.names[id] || id, gp: 0, min: 0 });
      if (l[IX.min] > 0) { p.gp++; p.min += l[IX.min]; }
    }
  }
  const games = file.games.length;
  return Object.values(out).map((p) => {
    const st = stint(sorted, p.id);
    return { ...p, first: st[0]?.d, mpg: p.gp ? p.min / p.gp : 0, missed: st.length - p.gp };
  }).sort((a, b) => b.min - a.min || a.name.localeCompare(b.name)).map((p) => ({ ...p, teamGames: games }));
}

export function withWithout(file, outId) {
  const games = [...file.games].sort((a, b) => a.d.localeCompare(b.d));
  const span = stint(games, outId);
  if (!span.length) return null;
  const first = span[0].d;
  const withG = span.filter((g) => played(g, outId)), withoutG = span.filter((g) => !played(g, outId));
  const ids = new Set(span.flatMap((g) => Object.keys(g.pl)).filter((id) => id !== outId));
  const players = [...ids].map((id) => {
    const w = averages(withG.filter((g) => played(g, id)).map((g) => g.pl[id]));
    const wo = averages(withoutG.filter((g) => played(g, id)).map((g) => g.pl[id]));
    return { id, name: file.names[id] || id, with: w, without: wo };
  }).filter((p) => p.with || p.without);
  return {
    out: { id: outId, name: file.names[outId] || outId, since: first },
    games: { with: withG.length, without: withoutG.length, withoutDates: withoutG.map((g) => g.d), withoutWhy: withoutG.map((g) => g.inj?.[outId] || (outId in g.pl ? "DNP" : "not in box score")) },
    team: { with: record(withG), without: record(withoutG) },
    players,
  };
}
