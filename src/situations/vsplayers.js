/**
 * Players against the top defenses, and 30-point games allowed (moved from NBA GameFlow, 11/13).
 * Pure and browser-safe: the "vs top teams" page imports a copy (docs/lib/situations/vsplayers.js).
 *
 * Input: the team files (docs/data/teams/<TRI>.json: { team, keys, names, games: [{ d, opp, home, pf, pa, pl: { id: [..keys] } }] }).
 * Only games a player played (minutes > 0) count. A traded player's games are combined; his team is the latest.
 *
 * GameFlow's rules, kept: "vs the rest" is the complement of the group (the two columns partition his games, so the gap is
 * like for like); shooting is makes over attempts across the games, never an average of percentages; a qualified player
 * averages 5+ points, has played half his team's games, and has 2+ games on each side of the split.
 */
export const POOL_MIN_PPG = 5, POOL_SHARE = 0.5, POOL_MIN_SIDE = 2, THIRTY = 30;

/** { id: { id, name, tri, games: [{ d, opp, home, pts, fgm, fga, fg3m, fg3a, min }] } } and { tri: team games played }. */
export function playerGames(teamFiles) {
  const players = {}, teamGp = {};
  for (const [tri, f] of Object.entries(teamFiles || {})) {
    const ix = Object.fromEntries((f.keys || []).map((k, i) => [k, i]));
    const games = (f.games || []).filter((g) => g.pf != null && g.pa != null);
    teamGp[tri] = games.length;
    for (const g of games) {
      for (const [id, row] of Object.entries(g.pl || {})) {
        if (!(row[ix.min] > 0)) continue;
        const p = (players[id] ??= { id, name: f.names?.[id] || id, tri, last: "", games: [] });
        if (g.d >= p.last) { p.last = g.d; p.tri = tri; p.name = f.names?.[id] || p.name; }
        p.games.push({ d: g.d, opp: g.opp, home: !!g.home, team: tri, pts: row[ix.pts] || 0, fgm: row[ix.fgm] || 0, fga: row[ix.fga] || 0, fg3m: row[ix.fg3m] || 0, fg3a: row[ix.fg3a] || 0, min: row[ix.min] || 0 });
      }
    }
  }
  for (const p of Object.values(players)) { p.games.sort((a, b) => a.d.localeCompare(b.d)); delete p.last; }
  return { players, teamGp };
}

const mean = (a) => (a.length ? a.reduce((s, g) => s + g.pts, 0) / a.length : null);
const shot = (a) => { let m = 0, t = 0; for (const g of a) { m += g.fgm; t += g.fga; } return { m, t, pct: t ? (100 * m) / t : null }; };

/** One player split against a set of opponents. */
export function splitRow(p, top) {
  const vs = p.games.filter((g) => top.has(g.opp)), rest = p.games.filter((g) => !top.has(g.opp));
  const mv = mean(vs), mr = mean(rest);
  const sv = shot(vs), sr = shot(rest);
  return { id: p.id, name: p.name, tri: p.tri, gp: p.games.length, avg: mean(p.games), fg: shot(p.games),
    vsGp: vs.length, vsAvg: mv, vsFg: sv, restGp: rest.length, restAvg: mr, restFg: sr,
    gap: mv != null && mr != null ? mv - mr : null, fgGap: sv.pct != null && sr.pct != null ? sv.pct - sr.pct : null };
}

/** Every qualified player against the top defenses, biggest drop first, with counts of who was left out and why. */
export function vsDefenses({ players, teamGp }, top) {
  const out = [];
  let considered = 0, quiet = 0, thin = 0, oneSided = 0;
  for (const p of Object.values(players)) {
    considered++;
    const r = splitRow(p, top);
    if ((r.avg ?? 0) < POOL_MIN_PPG) { quiet++; continue; }
    r.need = Math.ceil((teamGp[p.tri] || 0) * POOL_SHARE);
    if (r.gp < r.need) { thin++; continue; }
    if (r.vsGp < POOL_MIN_SIDE || r.restGp < POOL_MIN_SIDE) { oneSided++; continue; }
    out.push(r);
  }
  out.sort((a, b) => a.gap - b.gap || a.name.localeCompare(b.name));
  return { rows: out, considered, quiet, thin, oneSided };
}

/**
 * 30-point games allowed: one is credited to a defense for every opposing player who reached 30 against it (two in one
 * game count twice). ratings: { tri: { games, drtg } } from ratings.js. -> { teams: [{ tri, allowed, gp, perGame, drtg }], games: [...] }
 */
export function thirtyAllowed({ players, teamGp }, ratings = {}) {
  const games = [];
  for (const p of Object.values(players)) for (const g of p.games) if (g.pts >= THIRTY) games.push({ id: p.id, name: p.name, team: g.team, pts: g.pts, against: g.opp, d: g.d, home: g.home });
  games.sort((a, b) => b.pts - a.pts || a.d.localeCompare(b.d));
  const tris = new Set([...Object.keys(teamGp), ...Object.keys(ratings), ...Object.values(players).flatMap((p) => p.games.map((g) => g.opp))]);
  const teams = [...tris].map((tri) => {
    const allowed = games.filter((g) => g.against === tri).length, gp = teamGp[tri] || ratings[tri]?.games || 0;
    return { tri, allowed, gp, perGame: gp ? allowed / gp : null, drtg: ratings[tri]?.drtg ?? null, players: [...new Set(games.filter((g) => g.against === tri).map((g) => g.name))] };
  }).sort((a, b) => b.allowed - a.allowed || (b.perGame ?? 0) - (a.perGame ?? 0) || a.tri.localeCompare(b.tri));
  return { teams, games };
}
