#!/usr/bin/env node
// Last season's 4th-quarter and clutch-time totals for every player (0.185.0; 0.187.0: every quarter, both halves, and teams), the baseline the splits scan sets a
// player's recent 4th quarters against (src/situations/splits.js). This season's lines are in the results store (q4, cp);
// last season's are read here from ESPN's play-by-play with the same reader (src/espn/parse.js readGameDetail).
//
//   src/data/q4-history-<season>.json  { season, source, keys, games, q4: { espnId: [games, ...KEYS] }, clutch: { … } }
//   KEYS: sec, pts, fgm, fga, fg3m, fg3a, ftm, fta
//
//   NODE_USE_ENV_PROXY=1 node tools/q4-history.mjs [--season 2025-26] [--dir /home/claude/work/full] [--cache /home/claude/work/q4cache]
// The game list is the box-score archive's (tools/odd-games/README.md). About ten minutes; the cache keeps each game's lines.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countedGame } from "./odd-games/counted.mjs";
import { CUP_TITLE_DATES } from "../src/situations/results.js";
import { readGameDetail } from "../src/espn/parse.js";
import { TEAMS, teamFromCode } from "../src/teams.js";
const ALIAS = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", PHO: "PHX" };
const tri = (c) => ALIAS[c] || (TEAMS[c] ? c : teamFromCode(c));

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const SEASON = arg("--season", "2025-26"), DIR = arg("--dir", "/home/claude/work/full"), CACHE = arg("--cache", "/home/claude/work/q4cache2");
const y = +SEASON.slice(0, 4), FROM = `${y}-10-01`, TO = `${y + 1}-07-01`;
fs.mkdirSync(CACHE, { recursive: true });
const KEYS = ["sec", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta"];

const seen = new Set(), games = [], sides = {};
for (const f of fs.readdirSync(DIR).filter((x) => /^f-\d+\.json$/.test(x)).sort()) {
  let g; try { g = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); } catch { continue; }
  if (!g?.d || g.d < FROM || g.d >= TO || !countedGame(g, seen, CUP_TITLE_DATES)) continue;
  games.push(f.slice(2, -5));
  sides[f.slice(2, -5)] = Object.fromEntries(g.t.map((t) => [t.home ? "home" : "away", tri(t.t)]));
}
console.log(`${SEASON}: ${games.length} regular-season games in the archive`);

async function lines(gid) {
  const file = path.join(CACHE, `${gid}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gid}`, { signal: AbortSignal.timeout(45000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = readGameDetail(await r.json());
      // 0.187.0: [side, ...line] so the teams can be summed too; and the 1st-3rd quarters (only when every period adds up)
      const pick = (w) => (w ? Object.fromEntries(Object.entries(w.players).map(([id, x]) => [id, [x.team, ...x.s]])) : null);
      const per = d.periodPlayers || [];
      const out = { usable: !!d.q4Players, q1: pick(per[0]), q2: pick(per[1]), q3: pick(per[2]), q4: pick(d.q4Players), clutch: pick(d.clutchPlayers) };
      fs.writeFileSync(file, JSON.stringify(out));
      return out;
    } catch (e) { if (a === 3) return { error: e.message }; await new Promise((r) => setTimeout(r, 1500 * (a + 1))); }
  }
}
const by = {};
let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => { while (i < games.length) { const g = games[i++]; by[g] = await lines(g); } }));
const failed = games.filter((g) => by[g].error), unusable = games.filter((g) => !by[g].error && !by[g].usable);
// cached line: [side, sec, pts, fgm, fga, fg3m, fg3a, ftm, fta, reb, ast, tov, stl, blk, pm]
// 0.187.0: every quarter, both halves (h1 = 1st + 2nd, h2 = 3rd + 4th, regulation), clutch time; players and teams.
const W = ["q1", "q2", "q3", "q4", "h1", "h2", "clutch"], HALF = { h1: ["q1", "q2"], h2: ["q3", "q4"] };
const tot = Object.fromEntries(W.map((w) => [w, {}])), teams = Object.fromEntries(W.map((w) => [w, {}]));
const add = (t, s) => { t[0]++; for (let k = 0; k < 8; k++) t[k + 1] += k === 0 ? Math.round(s[k]) : s[k]; };
const on = (s) => s && (s[0] > 0 || s.slice(1, 8).some((v) => v));   // on the floor in that stretch, or a number in it
for (const g of games) {
  const L = by[g];
  if (!L || L.error) continue;
  const line = (w, id) => { if (!HALF[w]) return L[w]?.[id]?.slice(1) || null; const parts = HALF[w].map((q) => L[q]?.[id]?.slice(1)).filter(Boolean); if (HALF[w].some((q) => !L[q])) return null; return parts.length ? parts.reduce((a, b) => a.map((v, i) => v + b[i])) : null; };
  for (const w of W) {
    if (HALF[w] ? HALF[w].some((q) => !L[q]) : !L[w]) continue;
    const ids = new Set(HALF[w] ? HALF[w].flatMap((q) => Object.keys(L[q] || {})) : Object.keys(L[w]));
    const team = {};
    for (const id of ids) {
      const s = line(w, id); if (!on(s)) continue;
      add((tot[w][id] ??= [0, 0, 0, 0, 0, 0, 0, 0, 0]), s);
      const side = (L[HALF[w] ? HALF[w].find((q) => L[q]?.[id]) : w]?.[id] || [])[0], t = sides[g]?.[side];
      if (t) { const x = (team[t] ??= Array(8).fill(0)); s.slice(0, 8).forEach((v, i) => { x[i] += v; }); }
    }
    for (const [t, s] of Object.entries(team)) { const x = (teams[w][t] ??= [0, 0, 0, 0, 0, 0, 0, 0, 0]); x[0]++; for (let k = 1; k < 8; k++) x[k + 1] += s[k]; }
  }
}
console.log(`games read: ${games.length - failed.length}${failed.length ? ` (${failed.length} could not be read: run again)` : ""}; plays not adding up (left out): ${unusable.length}; players with a 4th quarter: ${Object.keys(tot.q4).length}`);
if (failed.length) process.exitCode = 1;
const out = path.join(root, "src", "data", `q4-history-${SEASON}.json`);
fs.writeFileSync(out, JSON.stringify({ season: SEASON, source: "ESPN play-by-play (site.api.espn.com summary), read with src/espn/parse.js readGameDetail; built by tools/q4-history.mjs",
  keys: ["games", ...KEYS], games: games.length - failed.length - unusable.length, ...tot, teams }));
console.log(`wrote ${path.relative(root, out)}`);
