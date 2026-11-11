/**
 * Season results, one compact row per finished regular-season game, kept in a
 * store that survives between runs (history/results-<season>.json), so a run
 * only asks ESPN for dates it hasn't finished collecting.
 *
 * Store: { season, dates: { "YYYY-MM-DD": { complete, games: [row] } } }
 * Row:   { id, d, h, a, hs, as, hq: [pts by period], aq: [...], ot, n }
 *        h/a = home/away tricode, hs/as = final score, ot = overtime periods,
 *        n = neutral site.
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
  return out;
}

export const allGames = (store) => Object.keys(store?.dates || {}).sort().flatMap((d) => store.dates[d].games);
