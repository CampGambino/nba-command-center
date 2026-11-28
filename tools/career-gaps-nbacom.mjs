#!/usr/bin/env node
// The games NBA.com counts that the box-score archive has no line for (0.184.0).
//
// After the plus-minus and the play-by-play (tools/few-seconds-games.mjs), the career logs matched the record book (the
// NBA Guide, src/data/nba-career-seasons-*.json) in 3,530 of 3,534 player-seasons. The four left were games ESPN's box
// score has no line for: Trey Lyles (DEN vs IND, 3/16/19) and Jarred Vanderbilt (DEN at BOS, 3/18/19), marked did-not-play
// at ESPN though ESPN's own plays have Lyles in and out with 27.9 seconds left; Alex Len (SAC vs PHI, 1/21/23); and
// Lachlan Olbrich's 15 games of 2025-26, whose rows in ESPN's box score have no player id at all.
//
// This compares the career logs with the record book season by season and, for each season that is short, reads NBA.com's
// game log for that player and season (stats.nba.com playergamelog) and keeps the games the career logs don't have, with
// NBA.com's numbers. A season with more games than the book is said and left alone.
//
//   src/data/career-games-nbacom.json  { source, columns, rows: [[espnId, name, nbaGameId, date, opp, home, W|L, min, pts,
//                                        reb, ast, stl, blk, fg3m, fgm, fga, fg3a, ftm, fta], …] }
//
//   NODE_USE_ENV_PROXY=1 node tools/career-gaps-nbacom.mjs        (then node tools/build-career-logs.mjs)
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "src", "data", "career-games-nbacom.json");
const HEAD = { Referer: "https://www.nba.com/", Origin: "https://www.nba.com", Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(u) {
  for (let a = 0; a < 4; a++) {
    try { const r = await fetch(u, { headers: HEAD, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (a === 3) throw e; await sleep(3000 * (a + 1)); }
  }
}
const plain = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const seasonOf = (d) => { const y = +d.slice(0, 4), s = +d.slice(5, 7) >= 10 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}`; };

const career = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "src", "data", "player-logs-career.json.gz"))));
const bookFile = fs.readdirSync(path.join(root, "src", "data")).filter((f) => /^nba-career-seasons-\d{4}-\d\d\.json$/.test(f)).sort().pop();
const book = {};
for (const [n, rows] of Object.entries(JSON.parse(fs.readFileSync(path.join(root, "src", "data", bookFile), "utf8")).players)) { const t = {}; for (const r of rows) t[r[0]] = (t[r[0]] || 0) + r[1]; book[plain(n)] = t; }
const names = {};
for (const f of fs.readdirSync(path.join(root, "docs", "data", "teams"))) Object.assign(names, JSON.parse(fs.readFileSync(path.join(root, "docs", "data", "teams", f), "utf8")).names || {});
// players not in this season's box scores: their names from the career-logs tool's own source, the archive (if here)
const ARCH = "/home/claude/work/full";
if (fs.existsSync(ARCH)) for (const f of fs.readdirSync(ARCH).filter((x) => x.endsWith(".json")).sort().slice(-4000)) { try { for (const t of JSON.parse(fs.readFileSync(path.join(ARCH, f), "utf8")).t || []) for (const p of t.p) if (p[0] && !names[p[0]]) names[p[0]] = p[1]; } catch {} }

const short = [];
for (const [id, rows] of Object.entries(career.players)) {
  const b = book[plain(names[id])]; if (!b) continue;
  const per = {}; for (const r of rows) per[seasonOf(r[0])] = (per[seasonOf(r[0])] || 0) + 1;
  for (const [s, gp] of Object.entries(b)) {
    if (s >= seasonOf(new Date().toISOString().slice(0, 10))) continue;
    if ((per[s] || 0) < gp) short.push({ id, name: names[id], s, have: per[s] || 0, gp });
    else if ((per[s] || 0) > gp) console.log(`more games than the record book, left alone: ${names[id]} ${s} (${per[s]} against ${gp})`);
  }
}
console.log(`seasons short of the record book: ${short.length}${short.length ? `: ${short.map((x) => `${x.name} ${x.s} (${x.have} of ${x.gp})`).join("; ")}` : ""}`);

const all = short.length ? await get("https://stats.nba.com/stats/commonallplayers?IsOnlyCurrentSeason=0&LeagueID=00&Season=2025-26") : null;
const byName = {};
if (all) { const rs = all.resultSets[0], H = rs.headers; for (const r of rs.rowSet) (byName[plain(r[H.indexOf("DISPLAY_FIRST_LAST")])] ??= []).push(r[H.indexOf("PERSON_ID")]); }
const iso = (s) => { const t = Date.parse(`${s} 12:00 UTC`); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null; };
const rows = [];
for (const x of short) {
  const pids = byName[plain(x.name)] || [];
  if (pids.length !== 1) { console.log(`${x.name}: ${pids.length} players of that name at NBA.com, left`); continue; }
  await sleep(1200);
  const j = await get(`https://stats.nba.com/stats/playergamelog?PlayerID=${pids[0]}&Season=${x.s}&SeasonType=Regular%20Season&LeagueID=00`);
  const g = j.resultSets[0], h = g.headers, v = (r, k) => r[h.indexOf(k)];
  const have = new Set(career.players[x.id].map((r) => r[0]));
  const add = g.rowSet.filter((r) => !have.has(iso(v(r, "GAME_DATE"))));
  for (const r of add) {
    const m = /^(\w+) (vs\.|@) (\w+)$/.exec(v(r, "MATCHUP")) || [];
    rows.push([x.id, x.name, v(r, "Game_ID"), iso(v(r, "GAME_DATE")), m[3] || null, m[2] === "vs." ? 1 : 0, v(r, "WL"), v(r, "MIN") ?? 0, v(r, "PTS"), v(r, "REB"), v(r, "AST"), v(r, "STL"), v(r, "BLK"), v(r, "FG3M"), v(r, "FGM"), v(r, "FGA"), v(r, "FG3A"), v(r, "FTM"), v(r, "FTA")]);
  }
  const now = x.have + add.length;
  console.log(`${x.name} ${x.s}: NBA.com has ${g.rowSet.length} games, the record book ${x.gp}, ours ${x.have}; ${add.length} added${now === x.gp ? "" : ` (still ${now} of ${x.gp})`}`);
}
rows.sort((a, b) => (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0));
fs.writeFileSync(OUT, JSON.stringify({ source: `stats.nba.com playergamelog, for the seasons where the career logs had fewer games than the record book (${bookFile}); built by tools/career-gaps-nbacom.mjs`,
  columns: ["espnId", "name", "nbaGameId", "date", "opp", "home", "result", "min", "pts", "reb", "ast", "stl", "blk", "fg3m", "fgm", "fga", "fg3a", "ftm", "fta"], rows }).replace(/\],\[/g, "],\n["));
console.log(`wrote ${path.relative(root, OUT)}: ${rows.length} games`);
