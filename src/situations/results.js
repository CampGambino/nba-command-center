/**
 * Season results, one compact row per finished regular-season game, kept in a
 * store that survives between runs (history/results-<season>.json), so a run
 * only asks ESPN for dates it hasn't finished collecting.
 *
 * Store: { season, dates: { "YYYY-MM-DD": { complete, games: [row] } } }
 * Row:   { id, d, h, a, hs, as, hq: [pts by period], aq: [...], ot, n, hb, ab, cl, x }
 *        h/a = home/away tricode, hs/as = final score, ot = overtime periods,
 *        n = neutral site. From the game's summary (filled in once, x = 1):
 *        hb/ab = team box totals (see TEAM_BOX_KEYS in espn/parse.js),
 *        cl = [home, away] points in clutch time, or 0 if it had none.
 *        A summary whose box doesn't add up to the final score is not used.
 *
 * A date is complete once every regular-season game on it is final (or it is
 * 3+ days old: a game still not final then was postponed). A date ESPN
 * can't answer is left out (not marked complete), so the next run asks again.
 */
export function rowFromGame(g) {
  if (!g.final || g.seasonType !== 2 || !g.homeTri || !g.awayTri) return null;
  if (g.homeScore == null || g.awayScore == null || g.homeScore === g.awayScore) return null;
  return {
    id: g.id, d: g.date, h: g.homeTri, a: g.awayTri, hs: g.homeScore, as: g.awayScore,
    hq: g.homeQ, aq: g.awayQ, ot: Math.max(0, (g.periods ?? 4) - 4), n: g.neutral || undefined,
  };
}

export async function collectResults({ espn, store, through, warnings = [] }) {
  const out = store && store.dates ? store : { season: null, dates: {} };
  const probe = await espn.scoreboard(through);
  if (!probe.ok) { warnings.push(probe.error); return out; }
  out.season = probe.data.season ?? out.season;
  const dates = probe.data.calendar.filter((d) => d <= through);
  for (const d of dates) {
    if (out.dates[d]?.complete) continue;
    const sb = d === through ? probe : await espn.scoreboard(d);
    if (!sb.ok) { warnings.push(sb.error); continue; }
    const reg = sb.data.games.filter((g) => g.seasonType === 2);
    const rows = reg.map(rowFromGame).filter(Boolean);
    // A game never finished 3+ days later was postponed: the date is done anyway.
    const old = Date.parse(through) - Date.parse(d) >= 3 * 864e5;
    out.dates[d] = { complete: reg.every((g) => g.final) || old, games: rows };
  }
  // Fill in box totals and clutch scoring for games that don't have them yet.
  for (const d of Object.keys(out.dates).sort()) {
    for (const row of out.dates[d].games) {
      if (row.x) continue;
      const r = await espn.detail(row.id);
      if (!r.ok) { warnings.push(r.error); continue; }
      const g = r.data;
      if (!g.final || !g.home || !g.away || !g.plays) { warnings.push(`game ${row.id}: summary incomplete`); continue; }
      if (pointsOf(g.home) !== row.hs || pointsOf(g.away) !== row.as) { warnings.push(`game ${row.id}: box totals ${pointsOf(g.home)}-${pointsOf(g.away)} don't match the final ${row.hs}-${row.as}`); continue; }
      row.hb = g.home; row.ab = g.away;
      row.cl = g.clutch ? [g.clutch.home, g.clutch.away] : 0;
      row.x = 1;
    }
  }
  return out;
}

/** Points from box totals: 2 per field goal, 1 more per three, 1 per free throw. */
export const pointsOf = (b) => (b && b.every((v, i) => i > 5 || Number.isFinite(v)) ? 2 * b[0] + b[2] + b[4] : null);

export const allGames = (store) => Object.keys(store?.dates || {}).sort().flatMap((d) => store.dates[d].games);
