/**
 * Season stat titles in context: who leads the league per game this season (points, rebounds, assists,
 * steals, blocks), and what a title would mean, from the NBA Guide's yearly leaders (1946-47 to 2025-26,
 * src/data/nba-history-<season>.json): his Nth title, the last time, and the last time his team had the leader.
 *
 *   titleRace({ history, teamFiles, top = 3 }) -> [{ stat, label, rows: [{ name, team, perGame, gp, titles, lastTitle, teamLast, note }] }]
 *
 * Qualified: played 70% of his team's games (and 5+). Franchise history is by the guide's team names, so
 * a moved franchise's earlier city (Seattle for OKC) isn't counted as the same team.
 */
import { nameKey } from "../notes/names.js";
import { seasonLines } from "./guide.js";

const STATS = [["pts", "scoring"], ["reb", "rebounding"], ["ast", "assists"], ["stl", "steals"], ["blk", "blocks"]];
const CITY = { LAL: "LA Lakers", LAC: "LA Clippers", GSW: "Golden State", OKC: "Oklahoma City", NYK: "New York", BKN: "Brooklyn", SAS: "San Antonio", NOP: "New Orleans",
  ATL: "Atlanta", BOS: "Boston", CHA: "Charlotte", CHI: "Chicago", CLE: "Cleveland", DAL: "Dallas", DEN: "Denver", DET: "Detroit", HOU: "Houston", IND: "Indiana",
  MEM: "Memphis", MIA: "Miami", MIL: "Milwaukee", MIN: "Minnesota", ORL: "Orlando", PHI: "Philadelphia", PHX: "Phoenix", POR: "Portland", SAC: "Sacramento",
  TOR: "Toronto", UTA: "Utah", WAS: "Washington" };
const poss = (s) => (s.endsWith("s") ? `${s}'` : `${s}'s`);
const ORD = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;

export function titleRace({ history, teamFiles, top = 3 }) {
  const L = Object.values(seasonLines(teamFiles));
  const teamGames = Object.fromEntries(Object.entries(teamFiles || {}).map(([t, f]) => [t, (f.games || []).length]));
  const out = [];
  for (const [stat, word] of STATS) {
    const past = history?.leaders?.[stat] || [];
    const rows = L.filter((p) => p.lines.length >= 5 && p.lines.length >= 0.7 * (teamGames[p.team] || 0))
      .map((p) => ({ name: p.name, team: p.team, gp: p.lines.length, perGame: Math.round((p.lines.reduce((a, l) => a + (l.stats[stat] || 0), 0) / p.lines.length) * 10) / 10 }))
      .sort((a, b) => b.perGame - a.perGame).slice(0, top);
    for (const r of rows) {
      const mine = past.filter((e) => nameKey(e.player) === nameKey(r.name));
      const city = CITY[r.team];
      const teamPast = city ? past.filter((e) => e.team.split("/").includes(city)) : [];
      r.titles = mine.length;
      r.lastTitle = mine.length ? mine[mine.length - 1].season : null;
      r.teamLast = teamPast.length ? { season: teamPast[teamPast.length - 1].season, player: teamPast[teamPast.length - 1].player } : null;
      r.note = `would be his ${mine.length ? `${ORD(mine.length + 1)} ${word} title (last ${r.lastTitle})` : `first ${word} title`}`
        + (r.teamLast ? (r.teamLast.player && nameKey(r.teamLast.player) === nameKey(r.name) ? "" : `; ${poss(city)} last: ${r.teamLast.player}, ${r.teamLast.season}`) : city ? `; no ${city} player has led the league` : "");
    }
    out.push({ stat, label: word, rows });
  }
  return out;
}
