/**
 * Who each team listed on the official injury report for each game date this season: the last
 * report of that date that still lists that date's games (the league posts one every 15 minutes; late
 * at night it can already have moved on to the next day, so earlier slots are tried).
 *
 * Why: ESPN's box scores leave inactive players out entirely, so a player who sat out the first
 * eight games and debuted on 11/4 (Kon Knueppel, 2026-27) looked like he joined the team on 11/4.
 * Being on a team's injury report for a game proves he was on that team that day.
 *
 * Kept in history/injuries/<YYYY-MM-DD>.json: { date, asOf, url, rows: [{ team, name, status, reason }] }.
 * Reports are published once and never change, so a date is fetched only once.
 */
import { slotsBackFrom, parseReport, nameKey, isoDate } from "./report.js";

/** Read the last report of an Eastern date. fetchPdf(url) -> pages ([[{ x, y, str }]]) or null. */
export async function finalReportFor(date, fetchPdf, { maxTries = 48 } = {}) {
  for (const url of slotsBackFrom(date, 23, 45).slice(0, maxTries)) {
    const pages = await fetchPdf(url);
    if (!pages) continue;
    const r = parseReport(pages);
    const rows = r.rows.filter((x) => isoDate(x.date) === date && x.name && x.status && x.status !== "Not yet submitted")
      .map(({ team, name, status, reason }) => ({ team, name, status, reason: reason || "" }));
    // Late at night the report can already have moved on to tomorrow's games: keep looking back.
    if (!rows.length) continue;
    return { date, asOf: r.asOf, url, rows };
  }
  return null;
}

/**
 * Match report names to player ids on each team (by name, accents and suffixes ignored).
 * report: { rows }, names: { id: name } (every player we know), teamIds: { TRI: Set(ids) } (ids seen
 * with that team in a box score). -> { TRI: [{ id, status, reason }] }; names we can't match (players
 * who haven't appeared in a box score yet) are skipped.
 */
export function listedIds(report, names, teamIds) {
  const out = {};
  if (!report) return out;
  const byKey = {};
  for (const [tri, ids] of Object.entries(teamIds)) for (const id of ids) if (names[id]) (byKey[tri] ??= {})[nameKey(names[id])] = id;
  for (const r of report.rows) {
    const id = byKey[r.team]?.[nameKey(r.name)];
    if (id) (out[r.team] ??= []).push({ id, status: r.status, reason: r.reason });
  }
  return out;
}
