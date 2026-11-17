/**
 * Benches that outscore their own starters (0.83).
 *
 * The user, 11/16, on NBA Live's BENCH IMPACT card ("PHX bench outscoring starters, 28-20" in the 2nd quarter):
 * "maybe there is a way to track if this a common occurrence, which it generally shouldn't be."
 *
 * Counted over whole games from the box scores: a team's reserves' points against its five starters' points.
 *   → { gp, n, teams: { TRI: { gp, n, last: { d, opp, bench, starters } | null } }, list: [every such game, newest first] }
 * gp is team games (two a game). NBA Live's card fires on the score at that moment; this is how often it lasts.
 */
const SIDE = 0, STARTER = 1, MIN = 2, PTS = 3;   // columns of a player's line in the results store

export function benchOverStarters(rows) {
  const teams = {}, list = [];
  let gp = 0, n = 0;
  for (const g of [...rows].sort((a, b) => a.d.localeCompare(b.d))) {
    if (!g.pl || g.hs == null) continue;
    const sum = { home: [0, 0], away: [0, 0] };
    let starters = 0;
    for (const v of Object.values(g.pl)) {
      if (!(v[MIN] > 0)) continue;
      const side = v[SIDE] === 0 ? "home" : "away";
      sum[side][v[STARTER] ? 0 : 1] += v[PTS] || 0;
      if (v[STARTER]) starters++;
    }
    if (starters < 8) continue;                                       // a box score without its starters marked
    for (const [side, tri, opp] of [["home", g.h, g.a], ["away", g.a, g.h]]) {
      const T = (teams[tri] ??= { gp: 0, n: 0, last: null });
      T.gp++; gp++;
      if (sum[side][1] > sum[side][0]) { T.n++; n++; T.last = { d: g.d, opp, bench: sum[side][1], starters: sum[side][0] }; list.push({ team: tri, ...T.last }); }
    }
  }
  return { gp, n, teams, list: list.reverse() };
}
