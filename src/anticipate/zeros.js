/**
 * A first for the wrong reasons (0.82): a player's first career game without a point, a rebound or an assist.
 *
 * The user, 11/16, on a broadcast graphic ("TRAE YOUNG · FIRST SCORELESS GAME (512 CAREER GAMES)"): "this is something
 * worth incorporating. someone's first career scoreless game, especially given the price tag, name recognition, and
 * accolades."
 *
 * For every player, and for each of points, rebounds and assists: has he ever finished a game he played in with
 * none? The career is the NBA Guide's seasons (games and totals through last season) plus this season's box scores;
 * the game-by-game record is ESPN's logs, which start in 2016-17. So the claim is "in his career" only when his
 * first season is 2016-17 or later, and "since 2016-17" otherwise.
 *
 *   watch   players who have never had one, for NBA Live: a card when one is still at zero late in a game.
 *   lines   last night's firsts, for "From last night".
 *
 * A stat counts for a player only if it is his: ZERO.avg a game for his career (15 points, 7 rebounds, 5 assists),
 * with ZERO.games career games behind him. Regular season only.
 *
 * 0.181.0: "a game he played in" is the played check's answer (src/situations/played.js), never a line of zeros alone.
 * On 11/28/26 this module said Damian Lillard "was held scoreless for the first time since at least 2016-17 (598
 * games): 0-for-0 … in 0 minutes" for a game he sat out injured: the 0-minute mark it trusted (cameo) had been set from
 * one early reading of ESPN's box score. The mark now needs proof he was on the floor, and the injury report and
 * NBA.com's check-in times are asked on every build. A real few-seconds game reads "in under a minute".
 */
export const ZERO = { avg: { pts: 15, reb: 7, ast: 5 }, games: 150, live: { pts: 1, reb: 1, ast: 1 } };
const WORD = { pts: ["scoreless", "points", "a point"], reb: ["without a rebound", "rebounds", "a rebound"], ast: ["without an assist", "assists", "an assist"] };

/**
 * pg: this season's games by player id ({ d, team, opp, min, pts, reb, ast, fgm, fga, … }); logs: player-logs-history
 * ({ columns, players: { id: rows } }); seasons: nba-career-seasons ({ keys, players: { name: rows } }); names: { id: name };
 * nameKey: the name matcher used for the guide; allStar: { plainName: selections } (optional, for the line).
 * → { players: { id: { name, team, games, full, stats: { pts: { zeros }, … } } } } for everyone a stat counts for.
 */
export function zeroCareers({ pg, logs, seasons, names = {}, nameKey = (x) => x, before = null }) {
  const C = Object.fromEntries((logs?.columns || []).map((c, i) => [c, i]));
  const K = Object.fromEntries((seasons?.keys || []).map((c, i) => [c, i]));
  const guide = new Map(Object.entries(seasons?.players || {}).map(([n, rows]) => [nameKey(n), rows]));
  const out = {};
  for (const [id, all] of Object.entries(pg || {})) {
    const games = all.filter((g) => (g.min > 0 || g.cameo) && (!before || g.d < before));
    const name = names[id], rows = guide.get(nameKey(name || ""));
    if (!name || !rows || !rows.length) continue;                       // a rookie, or no career on file
    const past = rows.reduce((a, r) => a + (r[K.g] || 0), 0), career = past + games.length;
    if (career < ZERO.games) continue;
    const full = String(rows[0][K.season]) >= "2016-17";
    const log = ((logs?.players || {})[id] || []).filter((r) => r[C.type] === 2 && r[C.min] > 0);
    const stats = {};
    for (const k of ["pts", "reb", "ast"]) {
      const tot = rows.reduce((a, r) => a + (r[K[k]] || 0), 0) + games.reduce((a, g) => a + (g[k] || 0), 0);
      if (tot / career < ZERO.avg[k]) continue;
      stats[k] = { zeros: log.filter((r) => r[C[k]] === 0).length + games.filter((g) => (g[k] || 0) === 0).length };
    }
    if (Object.keys(stats).length) out[id] = { name, team: games.length ? games[games.length - 1].team : null, games: career, full, logGames: log.length + games.length, stats };
  }
  return out;
}

/** Players who have never had one, on tonight's teams: for NBA Live. { id: { name, games, full, stats: ["pts", …] } } */
export function zeroWatch(careers, teams) {
  const out = {};
  for (const [id, p] of Object.entries(careers)) {
    const never = Object.keys(p.stats).filter((k) => p.stats[k].zeros === 0);
    if (never.length && (!teams || teams.has(p.team))) out[id] = { name: p.name, games: p.full ? p.games : p.logGames, full: p.full, stats: never };
  }
  return out;
}

/** Last night's firsts. `since`: only games on or after this date. Careers must be as they stood BEFORE those games. */
export function zeroLines({ pg, careersBefore, since, allStar = null, plainName = (x) => x }) {
  const out = [];
  for (const [id, p] of Object.entries(careersBefore || {})) {
    for (const g of (pg[id] || []).filter((x) => x.d >= since && (x.min > 0 || x.cameo))) {
      for (const k of Object.keys(p.stats)) {
        if ((g[k] || 0) !== 0 || p.stats[k].zeros !== 0) continue;
        const n = (p.full ? p.games : p.logGames) + 1, sel = allStar ? allStar[plainName(p.name)] || 0 : 0;
        const rest = k === "pts" ? `${g.fgm}-for-${g.fga} with ${g.ast} assist${g.ast === 1 ? "" : "s"} and ${g.reb} rebound${g.reb === 1 ? "" : "s"}` : `${g.pts} points${k === "reb" ? `, ${g.ast} assists` : `, ${g.reb} rebounds`}`;
        out.push({ kind: "unique", team: g.team, player: p.name, date: g.d, key: `zero|${id}|${k}|${g.d}`, rare: true, score: 3.9 + Math.min(0.6, n / 1500) + (sel ? 0.3 : 0),
          text: `${p.name}${sel ? ` (${sel}-time All-Star)` : ""} ${k === "pts" ? "was held scoreless" : `finished ${WORD[k][0]}`} for the first time ${p.full ? "in his career" : "since at least 2016-17"} (${n.toLocaleString("en-US")} games): ${rest} in ${Math.round(g.min) >= 1 ? `${Math.round(g.min)} minute${Math.round(g.min) === 1 ? "" : "s"}` : "under a minute"} vs ${g.opp}` });
      }
    }
  }
  return out;
}
