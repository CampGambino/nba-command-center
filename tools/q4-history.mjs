#!/usr/bin/env node
// Last season's 4th-quarter and clutch-time totals for every player (0.185.0), the baseline the splits scan sets a
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

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const SEASON = arg("--season", "2025-26"), DIR = arg("--dir", "/home/claude/work/full"), CACHE = arg("--cache", "/home/claude/work/q4cache");
const y = +SEASON.slice(0, 4), FROM = `${y}-10-01`, TO = `${y + 1}-07-01`;
fs.mkdirSync(CACHE, { recursive: true });
const KEYS = ["sec", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta"];

const seen = new Set(), games = [];
for (const f of fs.readdirSync(DIR).filter((x) => /^f-\d+\.json$/.test(x)).sort()) {
  let g; try { g = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); } catch { continue; }
  if (!g?.d || g.d < FROM || g.d >= TO || !countedGame(g, seen, CUP_TITLE_DATES)) continue;
  games.push(f.slice(2, -5));
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
      const pick = (w) => (w ? Object.fromEntries(Object.entries(w.players).map(([id, x]) => [id, x.s])) : null);
      const out = { usable: !!d.q4Players, q4: pick(d.q4Players), clutch: pick(d.clutchPlayers) };
      fs.writeFileSync(file, JSON.stringify(out));
      return out;
    } catch (e) { if (a === 3) return { error: e.message }; await new Promise((r) => setTimeout(r, 1500 * (a + 1))); }
  }
}
const by = {};
let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => { while (i < games.length) { const g = games[i++]; by[g] = await lines(g); } }));
const failed = games.filter((g) => by[g].error), unusable = games.filter((g) => !by[g].error && !by[g].usable);
// pbp.js player line: [sec, pts, fgm, fga, fg3m, fg3a, ftm, fta, reb, ast, tov, stl, blk, pm]
const tot = { q4: {}, clutch: {} };
for (const g of games) for (const w of ["q4", "clutch"]) for (const [id, s] of Object.entries(by[g][w] || {})) {
  if (!(s[0] > 0) && !s.slice(1, 8).some((v) => v)) continue;   // on the floor in that stretch, or a number in it
  const t = (tot[w][id] ??= [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  t[0]++; for (let k = 0; k < 8; k++) t[k + 1] += k === 0 ? Math.round(s[0]) : s[k];
}
console.log(`games read: ${games.length - failed.length}${failed.length ? ` (${failed.length} could not be read: run again)` : ""}; plays not adding up (left out): ${unusable.length}; players with a 4th quarter: ${Object.keys(tot.q4).length}`);
if (failed.length) process.exitCode = 1;
const out = path.join(root, "src", "data", `q4-history-${SEASON}.json`);
fs.writeFileSync(out, JSON.stringify({ season: SEASON, source: "ESPN play-by-play (site.api.espn.com summary), read with src/espn/parse.js readGameDetail; built by tools/q4-history.mjs",
  keys: ["games", ...KEYS], games: games.length - failed.length - unusable.length, q4: tot.q4, clutch: tot.clutch }));
console.log(`wrote ${path.relative(root, out)}`);
