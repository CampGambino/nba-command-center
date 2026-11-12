/**
 * This season against each player's own career, season by season (the NBA Guide's year-by-year stats, 1979-80 to
 * 2025-26, src/data/nba-career-seasons-<season>.json) — the "lowest since" / "highest since" / "career-high pace"
 * context behind a rise or a dip (e.g. a veteran's scoring falling to its lowest in a decade).
 *
 *   careerContext({ seasons, teamFiles, minGames = 8 }) -> [{ name, team, stat, label, now, last, lastSeason, delta, kind: "low" | "high" | "change",
 *        since: "2010-11" | null (career low/high), sinceValue, seasonsCompared, text, score }]
 *
 * Per game: points, rebounds, assists, 3-pointers made, minutes. Only seasons of 20+ games count as comparisons
 * (a 9-game season isn't a "season" to measure against). Needs 3+ such seasons.
 */
import { nameKey } from "../notes/names.js";
import { seasonLines } from "./guide.js";

const STATS = [["pts", "points"], ["reb", "rebounds"], ["ast", "assists"], ["fg3m", "3-pointers"], ["min", "minutes"]];
const MIN_SEASON_GAMES = 20, MIN_SEASONS = 3, NOTABLE_SPAN = 5;
const r1 = (x) => Math.round(x * 10) / 10;

// Year-over-year change worth a line on its own (per game), even without a "since" landmark.
const BIG_CHANGE = { pts: 5, reb: 3, ast: 3, fg3m: 1.5 };

export function careerContext({ seasons, teamFiles, minGames = 8 }) {
  const K = Object.fromEntries((seasons?.keys || []).map((k, i) => [k, i]));
  const byKey = new Map(Object.entries(seasons?.players || {}).map(([n, rows]) => [nameKey(n), rows]));
  const out = [];
  for (const p of Object.values(seasonLines(teamFiles))) {
    if (p.lines.length < minGames) continue;
    const rows = (byKey.get(nameKey(p.name)) || []).filter((r) => r[K.g] >= MIN_SEASON_GAMES);
    if (rows.length < MIN_SEASONS) continue;
    const last = rows[rows.length - 1];
    for (const [stat, label] of STATS) {
      const now = p.lines.reduce((a, l) => a + (l.stats[stat] || 0), 0) / p.lines.length;
      const per = (r) => r[K[stat]] / r[K.g];
      const lastV = per(last);
      const lastMin = r1(last[K.min] / last[K.g]);
      const short = p.name.replace(/\s+(?:Jr\.|II|III|IV)$/, "").split(" ").pop();
      // A big swing from last season, with where it sits in his career.
      if (BIG_CHANGE[stat] && Math.abs(now - lastV) >= BIG_CHANGE[stat] && last[K.g] >= MIN_SEASON_GAMES) {
        const down = now < lastV;
        const hit = [...rows].reverse().find((r) => (down ? per(r) <= now : per(r) >= now));
        const where = hit ? `his ${down ? "lowest" : "highest"} since ${hit[K.season]} (${r1(per(hit))})` : `a career ${down ? "low" : "high"}`;
        out.push({ name: p.name, team: p.team, stat, label, now: r1(now), last: r1(lastV), lastSeason: last[K.season], delta: r1(now - lastV), kind: "change", since: hit ? hit[K.season] : null,
          sinceValue: hit ? r1(per(hit)) : null, seasonsCompared: rows.length, games: p.lines.length, lastMin,
          text: `${short}: ${r1(now)} ${label} a game, ${down ? "down" : "up"} ${r1(Math.abs(now - lastV))} from ${r1(lastV)} in ${last[K.season]}; ${where}`,
          score: 1.5 + Math.min(2, Math.abs(now - lastV) / BIG_CHANGE[stat] / 2) });
      }
      for (const kind of ["low", "high"]) {
        // the most recent season at or beyond this mark
        const hit = [...rows].reverse().find((r) => (kind === "low" ? per(r) <= now : per(r) >= now));
        const span = hit ? 2026 - Number(hit[K.season].slice(0, 4)) - 1 : rows.length;
        const career = !hit;
        if (!career && span < NOTABLE_SPAN) continue;
        if (stat === "min" && !career) continue; // minutes only when it's a career low or high
        // Ignore tiny numbers (a center's 0.3 threes a game "career high" is noise).
        if ((stat === "fg3m" && Math.max(now, lastV) < 1) || (stat === "ast" && Math.max(now, lastV) < 2) || (stat === "reb" && Math.max(now, lastV) < 3) || (stat === "pts" && Math.max(now, lastV) < 8)) continue;
        const since = hit ? hit[K.season] : null;
        const what = kind === "low" ? (career ? "career low" : `lowest since ${since} (${r1(per(hit))})`) : (career ? "career high" : `highest since ${since} (${r1(per(hit))})`);
        out.push({
          name: p.name, team: p.team, stat, label, now: r1(now), last: r1(lastV), lastSeason: rows[rows.length - 1][K.season], delta: r1(now - lastV), kind, since,
          sinceValue: hit ? r1(per(hit)) : null, seasonsCompared: rows.length, games: p.lines.length, lastMin,
          text: `${short}: ${r1(now)} ${label} a game, his ${what}; ${r1(lastV)} in ${rows[rows.length - 1][K.season]}`,
          score: (career ? 2 + rows.length / 10 : 1 + span / 10) + Math.min(1.5, Math.abs(now - lastV) / Math.max(1, lastV)),
        });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
