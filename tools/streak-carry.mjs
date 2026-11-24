#!/usr/bin/env node
/**
 * The streaks still alive at the end of last season (0.145.0), for the Streaks page's active runs.
 *
 * The consistency audit, 11/24: the Streaks page showed Stephen Curry's made-three run as 10 ("every game", active) while
 * the Records page and NBA Live had 102 (7th since 1967-68). The page counted this season only; 53 of its 147 runs covered
 * every game he had played this season, so any of them could be longer.
 *
 * For every player in this season's team files, ESPN's game logs (regular season, play-in left out) for last season and,
 * while the run covers every game of a season, the seasons before it (up to MAX_BACK): how long each of the page's streaks
 * (src/situations/trends.js STREAKS) had run at his last game of last season, and the date it started.
 *   NODE_USE_ENV_PROXY=1 node tools/streak-carry.mjs            -> src/data/streak-carry-<last season>.json
 * Kept only where the run is 2+ games. A game log lists only games he played, so injuries don't break a run (as on the page).
 * 0.145.1: the All-Star games, which ESPN files under "Regular Season", are left out (src/espn/parse.js readGameLog): they
 * made Curry's made-three run 104 against Basketball-Reference's 102, and broke 10+ point runs (Durant's, SGA's…).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readGameLog } from "../src/espn/parse.js";
import { STREAKS } from "../src/situations/trends.js";
import { SEASON } from "../src/season.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BACK = 25;                      // seasons before last season, at most (a run still going there is "at least")
const last = Number(SEASON.slice(0, 4));   // ESPN numbers a season by its end year: 2026 = 2025-26, the season before SEASON
const label = (y) => `${y - 1}-${String(y).slice(2)}`;
const tests = STREAKS.filter(([k]) => k !== "start");

const ids = new Map();
for (const f of fs.readdirSync(path.join(root, "docs", "data", "teams")).filter((x) => x.endsWith(".json"))) {
  const t = JSON.parse(fs.readFileSync(path.join(root, "docs", "data", "teams", f), "utf8"));
  for (const [id, name] of Object.entries(t.names || {})) ids.set(id, name);
}
const cache = new Map();
async function season(id, y) {
  const k = `${id}|${y}`;
  if (cache.has(k)) return cache.get(k);
  for (let tries = 0; tries < 3; tries++) {
    try {
      const r = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${id}/gamelog?season=${y}`, { signal: AbortSignal.timeout(20000) });
      if (r.status === 404) { cache.set(k, []); return []; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const log = readGameLog(await r.json());
      const games = log.types.filter((t) => /regular season/i.test(t.name) && !t.playIn).flatMap((t) => t.games)
        .map((g) => ({ d: g.date, ...g.stats, fg3m: g.stats.fg3m ?? 0 })).filter((g) => g.d).sort((a, b) => a.d.localeCompare(b.d));
      cache.set(k, games); return games;
    } catch (e) { if (tries === 2) { console.error(`${id} ${label(y)}: ${e.message}`); cache.set(k, null); return null; } await new Promise((ok) => setTimeout(ok, 1000)); }
  }
}

const out = {}; let done = 0, failed = 0;
const queue = [...ids.keys()];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) {
    const id = queue.shift();
    const runs = {};
    let open = tests.map(([k]) => k), y = last;
    const n = Object.fromEntries(open.map((k) => [k, 0])), from = {};
    while (open.length && y >= last - MAX_BACK) {
      const games = await season(id, y);
      if (games == null) { failed++; open = []; break; }
      const still = [];
      for (const k of open) {
        const test = tests.find(([x]) => x === k)[2];
        let i = games.length - 1;
        for (; i >= 0 && test(games[i]); i--) { n[k]++; from[k] = games[i].d; }
        if (i < 0) still.push(k);          // the whole season (or no games): the run may go back further
      }
      open = still; y--;
    }
    // [games, first game, 1 when the run was still going at the oldest season read (a count of at least)]
    for (const [k] of tests) if (n[k] >= 2) runs[k] = open.includes(k) ? [n[k], from[k], 1] : [n[k], from[k]];
    if (Object.keys(runs).length) out[id] = runs;
    if (++done % 50 === 0) console.log(`${done} of ${ids.size} players`);
  }
}));
const file = path.join(root, "src", "data", `streak-carry-${label(last)}.json`);
fs.writeFileSync(file, JSON.stringify({
  source: `ESPN game logs, regular season (play-in left out), ${label(last)} and as far back as ${label(last - MAX_BACK)} while a run covers every game; read ${new Date().toISOString().slice(0, 10)} by tools/streak-carry.mjs`,
  through: label(last), keys: ["n", "from", "atLeast"], streaks: tests.map(([k, l]) => [k, l]), players: out }));
console.log(`${Object.keys(out).length} of ${ids.size} players with a run of 2+ alive at the end of ${label(last)}; ${failed} logs unreadable -> ${path.relative(root, file)}`);
