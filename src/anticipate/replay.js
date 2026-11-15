/**
 * A past season rebuilt from what we keep (0.70), so the season-long detectors can be checked against posts from
 * that season: results rows from the results history (scores only: no team box totals, no play-by-play) and player
 * games from the current players' logs, with each game's team worked out from the results (date + opponent + home).
 * No starters (the logs don't say), so the starting-lineup and starter/bench lines can't be replayed.
 */
export function seasonOfDate(d) {
  const y = +d.slice(0, 4), m = +d.slice(5, 7);
  const s = m >= 8 ? y : y - 1;
  return `${s}-${String(s + 1).slice(2)}`;
}

export function pastSeason({ history, logs, season, before = null }) {
  const H = history.columns, hi = Object.fromEntries(H.map((c, i) => [c, i]));
  const rows = [];
  const byKey = new Map();
  for (const r of history.games) {
    const d = r[hi.date];
    if (r[hi.type] !== 2 || seasonOfDate(d) !== season || (before && d >= before)) continue;
    const g = { id: `${d}-${r[hi.away]}-${r[hi.home]}`, d, h: r[hi.home], a: r[hi.away], hs: r[hi.homeScore], as: r[hi.awayScore] };
    rows.push(g);
    byKey.set(`${d}|${g.a}|1`, g); // a home player's opponent is the away team
    byKey.set(`${d}|${g.h}|0`, g);
  }
  const C = logs.columns, ix = Object.fromEntries(C.map((c, i) => [c, i]));
  const pg = {};
  for (const [id, L] of Object.entries(logs.players)) {
    for (const r of L) {
      const d = r[ix.date];
      if (r[ix.type] !== 2 || seasonOfDate(d) !== season || (before && d >= before)) continue;
      const g = byKey.get(`${d}|${r[ix.opp]}|${r[ix.home] ? 1 : 0}`);
      if (!g) continue;
      const home = !!r[ix.home];
      const team = home ? g.h : g.a;
      (pg[id] ??= []).push({ d, gameId: g.id, team, opp: r[ix.opp], home, win: home ? g.hs > g.as : g.as > g.hs, starter: null,
        min: r[ix.min] || 0, pts: r[ix.pts] || 0, reb: r[ix.reb] || 0, ast: r[ix.ast] || 0, stl: r[ix.stl] || 0, blk: r[ix.blk] || 0,
        fg3m: r[ix.fg3m] || 0, fgm: r[ix.fgm] || 0, fga: r[ix.fga] || 0, fg3a: r[ix.fg3a] || 0, ftm: r[ix.ftm] || 0, fta: r[ix.fta] || 0, tov: 0 });
    }
  }
  for (const gs of Object.values(pg)) gs.sort((a, b) => a.d.localeCompare(b.d));
  return { rows: rows.sort((a, b) => a.d.localeCompare(b.d)), pg };
}

/** The logs as they stood before a season (so "since 2016-17" counts don't see the season being replayed). */
export function logsBefore(logs, season) {
  const ix = logs.columns.indexOf("date");
  const players = {};
  for (const [id, L] of Object.entries(logs.players)) { const k = L.filter((r) => seasonOfDate(r[ix]) < season); if (k.length) players[id] = k; }
  return { ...logs, players };
}
