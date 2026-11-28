#!/usr/bin/env node
// Three tables from every regular-season game on file, 1993-94 to last season (0.187.0). The first buzz report (11/28) found
// three claims the site had the games for and never checked:
//   "Dončić had nine straight games of 30+ points, 5+ rebounds and 5+ assists" -> combined-line runs, the longest on file
//   "Dončić's 468 points through 12 games were the most through a season's first 12" -> totals through a player's first N games
//   "Ten Grizzlies scored in double figures, a franchise record" -> players in double figures in one game, by team
//
//   node --max-old-space-size=3000 tools/onfile-history.mjs [--dir /home/claude/work/full] [--through 2025-26]
//        [--out src/data/onfile-history-2025-26.json]
//
// The games are the archive's (tools/odd-games/README.md), counted by the one rule every reader uses (counted.mjs): every
// regular-season game once, with each team's player points adding up to its score. A player's games are the ones he played:
// minutes, or any number in his line (the site's played rule; a 0-minute line with nothing in it is not a game). Runs are
// within one season and count his games (a game he missed doesn't end one, as the Streaks page counts). Totals through N are
// through his first N games of a season. Franchises as the league files them: Vancouver is Memphis, Seattle Oklahoma City,
// New Jersey Brooklyn, the 1988-2002 Hornets Charlotte; New Orleans starts in 2002-03.
import fs from "node:fs";
import path from "node:path";
import { countedGame } from "./odd-games/counted.mjs";
import { CUP_TITLE_DATES } from "../src/situations/results.js";
import { COMBOS, START_STATS, START_N } from "../src/situations/onfile.js";

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const DIR = arg("--dir", "/home/claude/work/full"), THROUGH = arg("--through", "2025-26"), OUT = arg("--out", `src/data/onfile-history-${THROUGH}.json`);
const ALIAS = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", VAN: "MEM", SEA: "OKC", NJ: "BKN", NOK: "NOP", NOH: "NOP", PHO: "PHX", CHH: "CHA" }, tri = (a) => ALIAS[a] || a;
const seasonOf = (d) => { const y = +d.slice(0, 4), s = +d.slice(5, 7) >= 8 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}`; };
// archive row: [espnId, name, pos, starter, min, pts, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, reb, ast, stl, blk, to, pf, +/-]
const line = (p) => ({ min: p[4] || 0, pts: p[5] || 0, fg3m: p[8] || 0, reb: p[14] || 0, ast: p[15] || 0, stl: p[16] || 0, blk: p[17] || 0 });
const played = (p) => p[4] > 0 || p.slice(5, 21).some((v) => v != null && v !== 0);

const seen = new Set(), games = [];
for (const f of fs.readdirSync(DIR).filter((x) => /^f-(nba-)?\d+\.json$/.test(x)).sort()) {
  let g; try { g = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); } catch { continue; }
  if (!g?.d || seasonOf(g.d) > THROUGH || !countedGame(g, seen, CUP_TITLE_DATES)) continue;
  games.push(g);
}
games.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
console.log(`${games.length} games, ${games[0].d} to ${games[games.length - 1].d}`);

// players' games by season, in date order; double figures by team
const P = new Map(), names = {}, teams = {}, league = [];
for (const g of games) {
  const s = seasonOf(g.d);
  g.t.forEach((t, i) => {
    const T = tri(t.t), opp = tri(g.t[1 - i].t);
    let dbl = 0;
    for (const p of t.p) {
      if (!played(p)) continue;
      const id = String(p[0]); names[id] = p[1];
      const k = `${id}|${s}`; if (!P.has(k)) P.set(k, []); P.get(k).push({ d: g.d, ...line(p) });
      if ((p[5] || 0) >= 10) dbl++;
    }
    const x = (teams[T] ??= { from: s, games: 0, hist: {} }); x.games++;
    if (dbl >= 7) { const h = (x.hist[dbl] ??= [0, null]); h[0]++; h[1] = g.d; }
    if (dbl >= 9) league.push([dbl, T, opp, g.d]);
  });
}

// combined-line runs: every run of 2+ (within a season), longest first; kept to the 40 longest of each
const combos = {};
for (const [k, , test] of COMBOS) {
  const runs = [];
  for (const [key, list] of P) {
    const [id, s] = key.split("|");
    let n = 0;
    const close = (i) => { if (n >= 2) runs.push([n, id, s, list[i - 1].d]); n = 0; };
    list.forEach((g, i) => { if (test(g)) n++; else close(i); });
    close(list.length);
  }
  runs.sort((a, b) => b[0] - a[0] || (a[3] < b[3] ? -1 : 1));
  // how many runs reach each length (for "the Nth player since 1993-94 to do it N straight")
  const reach = {}; for (const r of runs) for (let n = 2; n <= r[0]; n++) reach[n] = (reach[n] || 0) + 1;
  combos[k] = { top: runs.slice(0, 40), reach };
}

// totals through a player's first N games of a season: the 10 best for each N and stat
const start = {};
for (const st of START_STATS) {
  start[st] = [];
  for (let n = 1; n <= START_N; n++) {
    const all = [];
    for (const [key, list] of P) {
      if (list.length < n) continue;
      const [id, s] = key.split("|");
      let v = 0; for (let i = 0; i < n; i++) v += list[i][st];
      all.push([v, id, s]);
    }
    all.sort((a, b) => b[0] - a[0] || (a[2] < b[2] ? -1 : 1));
    start[st].push(all.slice(0, 10));
  }
}

const used = new Set([...Object.values(combos).flatMap((c) => c.top.map((r) => r[1])), ...Object.values(start).flatMap((a) => a.flatMap((l) => l.map((r) => r[1])))]);
league.sort((a, b) => b[0] - a[0] || (a[3] < b[3] ? 1 : -1));
const out = {
  source: "ESPN box scores (NBA.com's where ESPN's are missing or don't add up), regular season; built by tools/onfile-history.mjs",
  from: seasonOf(games[0].d), through: THROUGH, games: games.length, built: new Date().toISOString().slice(0, 10),
  note: "combos: { key: { top: [games in a row, ESPN id, season, date of the last], reach: { n: runs of n or more } } }, within one season, his games. start: { stat: [for N = 1, 2, …: the 10 best [total, id, season] through a player's first N games of a season] }. double: { teams: { TRI: { from, games, hist: { count: [games, date of the last] } } } for 7+ players with 10+ points, league: [count, team, opp, date] for 9+ }.",
  combos, start, double: { teams, league: league.slice(0, 60) },
  names: Object.fromEntries([...used].map((id) => [id, names[id]])),
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
for (const [k] of COMBOS) console.log(k, combos[k].top.slice(0, 3).map((r) => `${r[0]} ${names[r[1]]} ${r[2]}`).join("; "));
console.log("MEM double figures:", JSON.stringify(teams.MEM));
console.log("pts through 12:", start.pts[11].slice(0, 3).map((r) => `${r[0]} ${names[r[1]]} ${r[2]}`).join("; "));
