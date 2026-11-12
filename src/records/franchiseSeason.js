/**
 * Franchise single-season records, on pace: each franchise's best seasons through 2025-26
 * (src/data/nba-franchise-seasons-<season>.json, built by tools/build-franchise-seasons.py from the NBA Guide's
 * team-by-team year-by-year pages) against what each player is doing for that team this season. Pure: no I/O.
 *
 *   seasonPace({ seasons, teamFiles, minTeamGames, seasonGames }) -> [{
 *     kind: "total" | "perGame", who, team, stat, label, now, games, teamGames, pace?, avg?, place,
 *     record: { name, value, season }, beats?: { name, value, season }, text, score }]
 *
 * Totals: his total with the team now, plus his rate per TEAM game times the team's games left (games he
 * misses lower his pace). Listed when the pace would be a top-3 season in franchise history.
 * Per game: his average, when he has played 70% of the team's games (the qualifier the season lists use).
 * Listed when it would be a top-3 season. Early in a season a pace moves a lot: nothing before minTeamGames.
 */
import { seasonLines, teamResults, LABEL } from "./guide.js";
import { TEAMS } from "../teams.js";

const STATS = ["pts", "reb", "ast", "stl", "blk", "fg3m"];
const ORD = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const fmt = (n) => Number(n).toLocaleString("en-US");
const one = (x) => (Math.round(x * 10) / 10).toFixed(1);
const PLACE = (p) => (p === 1 ? "the most" : `the ${ORD(p)}-most`);

export function seasonPace({ seasons, teamFiles, minTeamGames = 10, seasonGames = 82 }) {
  const lines = seasonLines(teamFiles);
  const results = teamResults(teamFiles);
  const out = [];
  for (const p of Object.values(lines)) {
    const tri = p.team; // his current team: a season record counts only his games for them
    const F = seasons?.franchises?.[tri];
    const R = results[tri] || [];
    if (!F || R.length < minTeamGames) continue;
    const L = p.lines.filter((l) => l.team === tri);
    // Team games since he joined (a player traded in is measured on the games he could have played).
    const first = L.length ? L[L.length - 1].d : null;
    const tg = first ? R.filter((r) => r.d >= first).length : 0;
    if (L.length < 8 || tg < minTeamGames) continue;
    const left = Math.max(0, seasonGames - R.length);
    const nick = TEAMS[tri]?.nick || F.name || tri;
    const last = p.name.replace(/\s+(?:Jr\.|II|III|IV)$/, "").split(" ").pop();
    for (const stat of STATS) {
      const now = L.reduce((a, l) => a + (l.stats[stat] || 0), 0);
      if (!now) continue;
      // Totals.
      const list = F.totals?.[stat] || [];
      if (list.length) {
        const pace = Math.round(now + (now / tg) * left);
        const place = 1 + list.filter((r) => r[1] > pace).length;
        if (place <= 3) {
          const rec = list[0];
          out.push({ kind: "total", who: p.name, last, team: tri, stat, label: LABEL[stat], now, games: L.length, teamGames: R.length, pace, place,
            record: { name: rec[0], value: rec[1], season: rec[2] },
            text: `${last}: on pace for ${fmt(pace)} ${LABEL[stat]}, which would be ${PLACE(place)} in a season in ${nick} history (${place === 1 ? "record" : "the record"}: ${rec[0]}, ${fmt(rec[1])} in ${rec[2]})`,
            score: place === 1 ? 2 : place === 2 ? 1.6 : 1.3 });
        }
      }
      // Per game, once he qualifies (70% of the team's games since he joined).
      const pg = F.perGame?.[stat] || [];
      if (pg.length && L.length >= Math.ceil(0.7 * tg)) {
        const avg = now / L.length;
        const place = 1 + pg.filter((r) => r[1] > avg).length;
        if (place <= 3) {
          const rec = pg[0];
          out.push({ kind: "perGame", who: p.name, last, team: tri, stat, label: LABEL[stat], now, games: L.length, teamGames: R.length, avg: Math.round(avg * 100) / 100, place,
            record: { name: rec[0], value: rec[1], season: rec[2] },
            text: `${last}: ${one(avg)} ${LABEL[stat]} a game; over the season that would be ${place === 1 ? "the best" : `the ${ORD(place)}-best`} in ${nick} history (${place === 1 ? "record" : "the record"}: ${rec[0]}, ${one(rec[1])} in ${rec[2]})`,
            score: place === 1 ? 2.1 : place === 2 ? 1.7 : 1.4 });
        }
      }
    }
  }
  return out.sort((a, b) => a.place - b.place || b.score - a.score);
}
