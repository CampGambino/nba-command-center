#!/usr/bin/env node
// Each current player's regular-season games, his whole career, from the box-score archive (0.172.0; the user, 11/27, on
// the list of runs against one team: "I thought we had data goin back to 2003 and that nba.com covered the bulls and
// pelicans missing games"). We do: the archive holds every regular-season box score from 1993-94 on (ESPN's, with
// NBA.com's for the games ESPN has no player numbers for; tools/odd-games/README.md says how to rebuild it), and LeBron
// James's first game, 10/29/03, is the oldest of any current player. The matchup step had been reading ESPN's player game
// logs instead, which start in 2016-17 and have holes (the Bulls' and Pelicans' games of 2016-18, Julius Randle's 2017-18
// and 2018-19, Moritz Wagner's 2020-21, and no log at all for a player who joined this season's files after they were made).
//
//   src/data/player-logs-career.json.gz  { source, seasons, columns, players: { <espnId>: [[date, opp, home 1|0, "W"|"L", 2,
//                                          min, pts, reb, ast, stl, blk, fg3m, fgm, fga, fg3a, ftm, fta], …] } }
//
// The same columns as the ESPN logs (src/data/player-logs-history.json.gz), regular season only, through last season; this
// season's games come from the daily box scores. Only players in this season's box scores or in the ESPN logs are kept.
// A team is its franchise today (Seattle is Oklahoma City, New Jersey Brooklyn), as everywhere else on the site. The
// Cup's title games are left out. A game counts when the player has minutes or any number in the box score.
//
// It also prints how the archive compares with the ESPN logs (and their Bulls and Pelicans fill) from 2016-17 on.
// Run it once a season, after the archive has last season's games, and whenever a veteran new to the files turns up.
//
//   node tools/build-career-logs.mjs [--dir /home/claude/work/full] [--out src/data/player-logs-career.json.gz] [--check-only]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { countedGame } from "./odd-games/counted.mjs";
import { TEAMS, teamFromCode } from "../src/teams.js";
import { CUP_TITLE_DATES } from "../src/situations/results.js";
import { withFill } from "../src/situations/logfill.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const DIR = arg("--dir", "/home/claude/work/full"), OUT = arg("--out", path.join(root, "src", "data", "player-logs-career.json.gz"));
const SPLIT = "2016-10-01";   // the ESPN logs' first season starts here
const NOW = (() => { const d = new Date(), y = d.getUTCFullYear(); return `${d.getUTCMonth() >= 7 ? y : y - 1}-08-01`; })();   // this season's games are not the archive's to give
const ALIAS = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", VAN: "MEM", SEA: "OKC", NJ: "BKN", NOK: "NOP", NOH: "NOP", PHO: "PHX", CHH: "CHA" };
const tri = (c) => ALIAS[c] || (TEAMS[c] ? c : teamFromCode(c));
const gz = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(f)));

const names = {};
for (const f of fs.readdirSync(path.join(root, "docs", "data", "teams"))) Object.assign(names, JSON.parse(fs.readFileSync(path.join(root, "docs", "data", "teams", f), "utf8")).names || {});
const espn = gz(path.join(root, "src", "data", "player-logs-history.json.gz"));
const fillF = path.join(root, "src", "data", "player-logs-fill.json.gz");
const logs = fs.existsSync(fillF) ? withFill(espn, gz(fillF)) : espn;
const want = new Set([...Object.keys(names), ...Object.keys(espn.players)]);

// archive row: [espnId, name, pos, starter, min, pts, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, reb, ast, stl, blk, to, pf, +/-]
const played = (p) => p[4] > 0 || [5, 7, 11, 14, 15, 16, 17, 18, 19].some((i) => p[i] > 0);
const early = {}, late = {}, seen = new Set(), unmapped = new Map();
let games = 0;
const all = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".json")).sort()) {
  let g; try { g = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); } catch { continue; }
  if (g?.d >= NOW || !countedGame(g, seen, CUP_TITLE_DATES)) continue;
  const codes = g.t.map((t) => tri(t.t));
  if (codes.some((c) => !c)) { for (const t of g.t) if (!tri(t.t)) unmapped.set(t.t, (unmapped.get(t.t) || 0) + 1); continue; }
  all.push({ g, codes, n: Number((/(\d+)\.json$/.exec(f) || [])[1]) || 0 });
}
// A team can't play twice in a day. ESPN stamps one game a day late (Golden State at Phoenix, 2/29/20, as 3/1, the day
// Golden State hosted Washington): of two games for one team on one date, the one with the lower ESPN id was the day
// before, when neither of its teams has a game there already. Anything else is left and said.
{
  const on = new Map();
  for (const x of all) for (const c of x.codes) { const k = `${x.g.d}|${c}`; on.set(k, [...(on.get(k) || []), x]); }
  const dayBefore = (d) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
  for (const [k, xs] of [...on]) {
    if (xs.length < 2) continue;
    const [a] = [...xs].sort((x, y) => x.n - y.n), prev = dayBefore(a.g.d);
    if (xs.length === 2 && a.n && a.codes.every((c) => !on.has(`${prev}|${c}`))) { console.log(`one day late at ESPN: ${a.codes.join("-")} ${a.g.d} is ${prev} (${k.split("|")[1]} also plays ${xs.find((x) => x !== a).codes.join("-")} that day)`); a.g = { ...a.g, d: prev }; for (const c of a.codes) on.set(`${prev}|${c}`, [a]); }
    else console.log(`two games for one team on one date, left as they are: ${k}`);
  }
}
for (const { g, codes } of all) {
  games++;
  g.t.forEach((t, i) => {
    const o = g.t[1 - i], res = t.s > o.s ? "W" : "L";
    for (const p of t.p) {
      const id = String(p[0]);
      if (!want.has(id) || !played(p)) continue;
      const row = [g.d, codes[1 - i], t.home ? 1 : 0, res, 2, p[4] ?? 0, p[5] ?? 0, p[14] ?? 0, p[15] ?? 0, p[16] ?? 0, p[17] ?? 0, p[8] ?? 0, p[6] ?? 0, p[7] ?? 0, p[9] ?? 0, p[10] ?? 0, p[11] ?? 0];
      ((g.d < SPLIT ? early : late)[id] ||= []).push(row);
    }
  });
}
for (const o of [early, late]) for (const id of Object.keys(o)) o[id].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
const nEarly = Object.values(early).reduce((a, r) => a + r.length, 0), nLate = Object.values(late).reduce((a, r) => a + r.length, 0);
const first = Object.values(early).map((r) => r[0][0]).sort()[0];
console.log(`archive: ${games} regular-season games read; ${Object.keys(early).length} current players with ${nEarly} games before 2016-17 (the first on ${first}); ${Object.keys(late).length} with ${nLate} from 2016-17 on${unmapped.size ? `; team codes not placed: ${[...unmapped].map(([c, n]) => `${c} x${n}`).join(", ")}` : ""}`);

// the cross-check, 2016-17 on: the same player-games, opponents and results in the archive and in the logs
const C = { date: 0, opp: 1, res: 3, type: 4 };
let both = 0, onlyArchive = 0, onlyLogs = 0, differ = 0; const sample = { onlyArchive: [], onlyLogs: [], differ: [] };
const lastArchive = Object.values(late).flat().map((r) => r[0]).sort().pop();
for (const id of want) {
  const a = new Map((late[id] || []).map((r) => [r[0], r]));
  const l = new Map((logs.players[id] || []).filter((r) => r[C.type] === 2 && !CUP_TITLE_DATES.has(r[C.date]) && r[C.date] >= SPLIT && r[C.date] <= lastArchive).map((r) => [r[C.date], r]));
  for (const [d, r] of a) {
    const x = l.get(d);
    if (!x) { onlyArchive++; if (sample.onlyArchive.length < 8) sample.onlyArchive.push(`${names[id] || id} ${d} ${r[1]} ${r[3]} ${r[5]}min`); }
    else if (x[C.opp] !== r[1] || x[C.res] !== r[3]) { differ++; if (sample.differ.length < 8) sample.differ.push(`${names[id] || id} ${d} archive ${r[1]} ${r[3]} logs ${x[C.opp]} ${x[C.res]}`); }
    else both++;
  }
  for (const [d, x] of l) if (!a.has(d)) { onlyLogs++; if (sample.onlyLogs.length < 8) sample.onlyLogs.push(`${names[id] || id} ${d} ${x[C.opp]} ${x[C.res]} ${x[5]}min`); }
}
console.log(`2016-17 on, archive against the logs: ${both} player-games the same; ${differ} with another opponent or result; ${onlyArchive} only in the archive; ${onlyLogs} only in the logs`);
for (const [k, v] of Object.entries(sample)) if (v.length) console.log(`  ${k}: ${v.join("; ")}`);

if (!process.argv.includes("--check-only")) {
  // (the 2020 restart's August games belong to 2019-20: a season starts in October)
  const seasonOf = (d) => { const y = +d.slice(0, 4), s = +d.slice(5, 7) >= 10 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}`; };
  const players = {};
  for (const id of new Set([...Object.keys(early), ...Object.keys(late)])) players[id] = [...(early[id] || []), ...(late[id] || [])];
  const body = JSON.stringify({ source: "ESPN box scores (site.api.espn.com summary), with NBA.com's box score for the games ESPN has no player numbers for; regular season; built by tools/build-career-logs.mjs from the archive of tools/odd-games",
    seasons: `${seasonOf(first)} to ${seasonOf(lastArchive)}`, whole: true,
    note: "Every regular-season game of each current player's career through last season. whole: no current player's career began before the first season here. A game counts when the player has minutes or any number in the box score.",
    columns: espn.columns.slice(0, 17), players });
  fs.writeFileSync(OUT, zlib.gzipSync(body, { level: 9 }));
  console.log(`wrote ${path.relative(root, OUT)}: ${Object.keys(players).length} players, ${nEarly + nLate} games, ${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB`);
}
