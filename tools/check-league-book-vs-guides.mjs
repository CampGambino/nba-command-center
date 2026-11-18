// The league's record book against the team guides (0.110; the user, 11/18: "doesn't the nba guide new pdf have team
// single game records? Is that not reliable for records before this season to check against?").
// The book (NBA Guide pp. 198-268, src/data/nba-record-book-2026-27.json) prints the best few ever in each category,
// league-wide: not each team's own records. So it reaches a franchise mark only where that mark is among the best ever.
// Every regular-season team entry for a game, each line of it and not just the first, is set against the guides two ways:
//   1. same game: the holder's guide, or the other team's "by an opponent" mark, prints that night. Do the numbers agree? ("both teams" entries carry
//      each team's number in brackets);
//   2. the holder's own guide: is its franchise mark at least the book's number for that team (most), or at most (fewest)?
//   node tools/check-league-book-vs-guides.mjs [--out file.json]
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), J = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
const book = J("src/data/nba-record-book-2026-27.json"), R = J("src/data/team-game-records-2026-27.json").teams;
const STAT = { "points": "pts", "field goals made": "fgm", "field goal attempts": "fga", "three-point field goals made": "fg3m", "three-point field goal attempts": "fg3a", "free throws made": "ftm",
  "free throw attempts": "fta", "rebounds": "reb", "offensive rebounds": "oreb", "defensive rebounds": "dreb", "assists": "ast", "steals": "stl", "blocked shots": "blk", "turnovers": "tov", "personal fouls": "pf" };
const MON = { Jan: 1, Feb: 2, March: 3, Mar: 3, April: 4, Apr: 4, May: 5, June: 6, Oct: 10, Nov: 11, Dec: 12 };
const date = (s) => { const m = /\b(Jan|Feb|March|Mar|April|Apr|May|June|Oct|Nov|Dec)\.? (\d{1,2}), (\d{4})/.exec(s); return m ? `${m[3]}-${String(MON[m[1]]).padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };
// who that city was that season
const team = (name, d) => {
  const y = +d.slice(0, 4) + (+d.slice(5, 7) >= 8 ? 1 : 0), n = name.replace(/\s*\(\d+\)/g, "").trim();   // y: the year the season ended
  const fixed = { "Boston": "BOS", "New York": "NYK", "Golden State": "GSW", "San Francisco": "GSW", "Minneapolis": "LAL", "Los Angeles": "LAL", "LA Lakers": "LAL", "L.A. Lakers": "LAL", "LA Clippers": "LAC", "L.A. Clippers": "LAC",
    "Syracuse": "PHI", "Rochester": "SAC", "Cincinnati": "SAC", "Kansas City": "SAC", "Kansas City-Omaha": "SAC", "Sacramento": "SAC", "St. Louis": "ATL", "Atlanta": "ATL", "Fort Wayne": "DET", "Detroit": "DET", "Ft. Wayne": "DET", "Oklahmoa City": "OKC", "Baltimore": "WAS", "Capital": "WAS",
    "Washington": "WAS", "Buffalo": "LAC", "Seattle": "OKC", "Oklahoma City": "OKC", "Vancouver": "MEM", "Memphis": "MEM", "New Jersey": "BKN", "Brooklyn": "BKN", "Denver": "DEN", "Phoenix": "PHX", "Portland": "POR", "Houston": "HOU",
    "Dallas": "DAL", "San Antonio": "SAS", "Utah": "UTA", "Indiana": "IND", "Cleveland": "CLE", "Miami": "MIA", "Orlando": "ORL", "Minnesota": "MIN", "Toronto": "TOR", "Milwaukee": "MIL" };
  if (fixed[n]) return n === "Milwaukee" && y <= 1955 ? "ATL" : fixed[n];
  if (n === "Philadelphia") return y <= 1962 ? "GSW" : "PHI";
  if (n === "Chicago") return y >= 1962 && y <= 1963 ? "WAS" : y >= 1967 ? "CHI" : null;
  if (n === "San Diego") return y <= 1971 ? "HOU" : "LAC";
  if (n === "New Orleans") return y <= 1979 ? "UTA" : "NOP";
  if (n === "Charlotte") return "CHA";
  return null;
};
const own = (t, stat, kind) => (R[t] || []).find((m) => m.period === "game" && m.stat === stat && m.kind === kind && (m.side || "team") === "team");
const res = { entries: 0, noDate: 0, sameNight: { agree: 0, differ: [], keys: [] }, own: { covers: 0, short: [], noMark: 0, noTeam: [] } };
for (const r of book) {
  if (r.book !== "Regular season" || r.side !== "team") continue;
  const m = /^(Most|Fewest) (.+?), (one team|both teams), game$/.exec(r.title); if (!m || !STAT[m[2]]) continue;
  const kind = m[1].toLowerCase(), stat = STAT[m[2]], both = m[3] === "both teams";
  for (const e of r.entries) {
    if (/^By many/i.test(e.holder)) continue;
    res.entries++;
    const d = date(e.holder), V = Number(e.value); if (!d) { res.noDate++; continue; }
    const two = [...e.holder.matchAll(/\((\d+)\)/g)].map((x) => +x[1]);
    const names = e.holder.replace(/,? at [A-Z][a-z]+ville\b/, "").split(/,/)[0].split(/ (?:vs\.|at) /).map((x) => x.trim()), A = team(names[0] || "", d), B = team(names[1] || "", d);
    if (!A) res.own.noTeam.push(`${names[0]} ${d}`);
    const at = (t, side) => (R[t] || []).find((m) => m.period === "game" && m.stat === stat && m.kind === kind && (m.side || "team") === side && m.games.some((g) => g.date === d));
    // 1. the same game in a guide: the holder's own mark that night, and the other team's "by an opponent" mark.
    //    For "both teams" each team's bracketed number, only when the brackets add up to the entry (three do not).
    const pairs = both ? (two.length === 2 && two[0] + two[1] === V ? [[A, B, two[0]], [B, A, two[1]]] : []) : [[A, B, V]];
    for (const [t, o, v] of pairs) for (const [g, whose, gt, gs] of [[t && at(t, "team"), `the ${t} guide (its own)`, t, "team"], [o && at(o, "opp"), `the ${o} guide (by an opponent)`, o, "opp"]]) {
      if (!g) continue;
      if (g.value === v) { res.sameNight.agree++; res.sameNight.keys.push([gt, gs, stat, kind, "game", d].join("|")); } else res.sameNight.differ.push(`${r.title}: the book has ${v} for ${t} (${e.holder}); ${whose} prints ${g.value}`);
    }
    // 2. the holder's own franchise mark (one-team entries)
    if (both || !A) continue;
    const f = own(A, stat, kind);
    if (!f) { res.own.noMark++; continue; }
    if (kind === "most" ? f.value >= V : f.value <= V) res.own.covers++;
    else res.own.short.push(`${r.title}: the book has ${A} with ${V} (${e.holder}); the ${A} guide's ${kind} is ${f.value} (${f.games[0]?.date || "no date"})`);
  }
}
console.log(`${res.entries} dated lines in the book's regular-season team game records (${res.noDate} without a date read)`);
console.log(`1. same night in a guide: ${res.sameNight.agree} agree, ${res.sameNight.differ.length} differ`); for (const x of res.sameNight.differ) console.log("   DIFFERS: " + x);
console.log(`2. the holder's own guide: ${res.own.covers} have a mark at least as good, ${res.own.short.length} do not, ${res.own.noMark} print no such mark, ${res.own.noTeam.length} team not placed`);
for (const x of res.own.short) console.log("   SHORT: " + x); if (res.own.noTeam.length) console.log("   not placed: " + res.own.noTeam.join("; "));
const o = process.argv.indexOf("--out"); if (o > 0) fs.writeFileSync(process.argv[o + 1], JSON.stringify(res, null, 1));
