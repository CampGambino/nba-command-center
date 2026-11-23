/**
 * Consecutive games played (0.142.6; the user, 11/23, with San Antonio's "ACTIVE, MOST CONSECUTIVE GAMES PLAYED" table:
 * "maybe it can be tested against the box scores to confirm the length"). Pure: no I/O.
 *
 * A game counts as played when he is in the box as a starter, or with any minutes or any stat: Mikal Bridges kept his
 * run on the last day of 2024-25 and 2025-26 by starting and leaving with 0 minutes and one foul. A miss is a game his
 * team played while he was theirs and he didn't.
 * 0.142.7 (the user, 11/23, Bridges's Basketball-Reference page: 655 games, every one his team has played; we had 654):
 * a player can get in for a few seconds and leave with 0 minutes and nothing in the box (Bridges's debut, 10/17/2018).
 * ESPN still gives him a stat line and doesn't mark him "did not play", so being listed with a line is what counts
 * (`listed`); `appeared` is the fallback for a line that can't tell the two apart. Any stat that isn't 0 counts,
 * a minus plus-minus included (Josh Minott, 11/2: 0 minutes, -1).
 * "His team" is read from his appearances:
 *   - a season's first team: from that team's first game (the run carries over the summer only if he plays it);
 *   - a team he joins in mid-season: from his first game for it (the days around a trade aren't misses);
 *   - a team he leaves in mid-season: to his last game for it; his last team of a season: to its last game.
 *
 *   walkStreak(apps, teamGames, { start }) -> { n, broke }
 *   apps: his games, oldest first, [{ d, gid, team, season }]; teamGames: { "<team>|<season>": [{ d, gid }] } oldest first.
 *   start: the run he brings in (a count at the end of an earlier stretch that `apps` doesn't cover).
 */
export const appeared = (starter, min, stats, listed = false) => !!listed || !!starter || min > 0 || (stats || []).some((x) => x != null && x !== 0);

export function walkStreak(apps, teamGames, { start = 0 } = {}) {
  if (!apps.length) return { n: start, broke: null };
  const played = new Set(apps.map((a) => String(a.gid)));
  // Stints: one team in one season, in order.
  const stints = [];
  for (const a of apps) {
    const s = stints[stints.length - 1];
    if (s && s.team === a.team && s.season === a.season) s.to = a.d;
    else stints.push({ team: a.team, season: a.season, from: a.d, to: a.d });
  }
  let n = start, broke = null;
  stints.forEach((s, i) => {
    const games = teamGames[`${s.team}|${s.season}`] || [];
    const firstOfSeason = i === 0 || stints[i - 1].season !== s.season, lastOfSeason = i === stints.length - 1 || stints[i + 1].season !== s.season;
    const from = firstOfSeason ? (games[0]?.d ?? s.from) : s.from, to = lastOfSeason ? (games[games.length - 1]?.d ?? s.to) : s.to;
    // (A player who joins after a season starts, a signing or a call-up, misses its first games on paper; his run then
    // starts with his first game, which is all it can be.)
    for (const g of games) {
      if (g.d < from || g.d > to) continue;
      if (played.has(String(g.gid))) n++;
      else { n = 0; broke = g.d; }
    }
  });
  return { n, broke };
}
