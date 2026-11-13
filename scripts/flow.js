#!/usr/bin/env node
/**
 * Game Flow (stage 1 of the GameFlow merge, 11/13): every finished regular-season game's play-by-play,
 * read from ESPN once and kept as a compact file the Game Flow page reads instead of ESPN's ~450 KB summary.
 *
 *   docs/data/flow/<season>/<gameId>.json   one per game (src/gameflow/feeds.js compactFeeds), written once
 *   docs/data/flow/index.json               { season, v, ids: [gameId], missing: [gameId], updated }
 *   docs/data/flow/<season>-lite.json       per game, the slice of the model Scoring highs and the Assist leaderboard read
 *   docs/data/flowstats.json                season facts from those files (src/gameflow/stats.js, 0.59.0): best quarters and
 *                                           halves, usual check-in/out times, foul trouble, leads lost and comebacks; read by
 *                                           NBA Live's bridge (v5)
 *
 * Games come from the results store (history/results, kept by scripts/situations.js). A game whose summary has
 * no play-by-play yet is listed as missing and asked for again next run. At most --max games a run (default 400).
 *   node scripts/flow.js [--max N]
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ["--no-warnings", ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  process.exit(r.status ?? 1);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { loadStore, allGames } = await import("../src/situations/results.js");
const { espnToFeeds, compactFeeds, FLOW_VERSION } = await import("../src/gameflow/feeds.js");

const args = process.argv.slice(2);
const max = args.includes("--max") ? Number(args[args.indexOf("--max") + 1]) : 400;
const store = loadStore(path.join(root, "history", "results"), fs);
if (!store) { console.error("flow: no results store yet"); process.exit(0); }
const rows = allGames(store);
const season = String(store.season || "");
const dir = path.join(root, "docs", "data", "flow", season);
fs.mkdirSync(dir, { recursive: true });
const have = new Set(fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).map((f) => f.replace(".json", "")));
// Stat corrections (the user, 11/13): a game played in the last RECHECK_DAYS days is read again once a day, and its file
// rewritten if anything changed. index.json keeps the day each recent game was last read.
const RECHECK_DAYS = 3;
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const idxFile = path.join(root, "docs", "data", "flow", "index.json");
const prevIdx = (() => { try { return JSON.parse(fs.readFileSync(idxFile, "utf8")); } catch { return {}; } })();
const checked = prevIdx.checked || {};
const recent = (r) => (Date.parse(today) - Date.parse(r.d)) / 864e5 <= RECHECK_DAYS;
const recheck = rows.filter((r) => have.has(String(r.id)) && recent(r) && checked[r.id] !== today);
const todo = [...rows.filter((r) => !have.has(String(r.id))), ...recheck].slice(0, max);
const corrected = [];
const missing = [];
let wrote = 0, last = 0;
for (const r of todo) {
  const wait = last + 250 - Date.now();
  if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
  last = Date.now();
  try {
    const res = await fetch(`https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${r.id}`, { headers: { "User-Agent": "Mozilla/5.0 nba-command-center" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) { missing.push(String(r.id)); continue; }
    const sum = await res.json();
    if (!sum.plays?.length) { missing.push(String(r.id)); continue; }
    const c = compactFeeds(espnToFeeds(sum));
    // Only a game ESPN calls final, and whose box adds up to the final score we have, is kept for good.
    const final = sum.header?.competitions?.[0]?.status?.type?.completed;
    const [away, home] = c.t;
    if (!final || home.score !== r.hs || away.score !== r.as) { missing.push(String(r.id)); continue; }
    const file = path.join(dir, `${r.id}.json`), text = JSON.stringify(c);
    if (have.has(String(r.id))) { if (fs.readFileSync(file, "utf8") !== text) { fs.writeFileSync(file, text); corrected.push(String(r.id)); } }
    else { fs.writeFileSync(file, text); wrote++; }
    have.add(String(r.id));
    checked[r.id] = today;
  } catch { missing.push(String(r.id)); }
}
// A raw summary for the tests (the flow-sample workflow sets FLOW_SAMPLE): the latest game on file.
if (process.env.FLOW_SAMPLE && rows.length) {
  const r = rows[rows.length - 1];
  const res = await fetch(`https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${r.id}`, { headers: { "User-Agent": "Mozilla/5.0 nba-command-center" } }).catch(() => null);
  if (res?.ok) fs.writeFileSync(process.env.FLOW_SAMPLE, await res.text());
}
const ids = rows.map((r) => String(r.id)).filter((id) => have.has(id));
const keepChecked = Object.fromEntries(Object.entries(checked).filter(([id]) => rows.some((r) => String(r.id) === id && recent(r))));
fs.writeFileSync(idxFile, JSON.stringify({ season, v: FLOW_VERSION, ids, missing: missing.filter((id) => !have.has(id)), checked: keepChecked, updated: new Date().toISOString() }));
if (corrected.length) console.log(`game flow: stat corrections in ${corrected.length} recent game(s): ${corrected.join(", ")}`);
// Season facts for the bridge. Never fatal: the flow files above are already written.
try {
  const { flowStats } = await import("../src/gameflow/stats.js");
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const entries = ids.map((id) => ({ row: byId.get(id), c: JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")) }));
  const lite = {};
  const S = flowStats(entries, lite);
  fs.writeFileSync(path.join(root, "docs", "data", "flowstats.json"), JSON.stringify({ season, updated: new Date().toISOString(), ...S }));
  // Game Flow's Scoring highs and Assist leaderboard read this one file instead of every game's (0.60).
  fs.writeFileSync(path.join(root, "docs", "data", "flow", `${season}-lite.json`), JSON.stringify({ season, v: 1, games: lite }));
  console.log(`flow stats: ${S.games} games, ${Object.keys(S.rotation).length} players' rotations, best quarter ${S.quarters[0] ? S.quarters[0].pts + " (" + S.quarters[0].name + ")" : "none"}`);
} catch (e) { console.error("flow stats failed:", e.message); }
console.log(`game flow: ${wrote} games read, ${ids.length} of ${rows.length} on file${missing.length ? `, ${missing.length} not yet (no play-by-play or not final)` : ""}${rows.length - ids.length - missing.length > 0 ? `; ${rows.length - ids.length - missing.length} left for the next run` : ""}`);
