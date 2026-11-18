#!/usr/bin/env node
// The player lines ESPN does not have: every Bulls and Pelicans game from 2012-13 to 2017-18 (ESPN's box scores and game
// logs carry zeros for all of them), read from pbpstats.com's public API (api.pbpstats.com/docs; the user's suggestion,
// 11/18/26). One request at a time with a pause; the API is slow and often answers 502, so each game is tried several
// times and the job is resumable: a game already in the season's file is skipped.
//
//   node tools/fetch-pbpstats.mjs [--seasons 2016-17,2017-18] [--teams CHI,NOP] [--minutes 50] [--dir tools/outside/pbpstats]
//
// Writes <dir>/games-<season>.json (the season's games as pbpstats lists them) and <dir>/box-<season>.jsonl, one game a line:
//   { id, d, h, a, hs, as, p: { Home: [[nbaId, name, min, pts, reb, oreb, dreb, ast, stl, blk, fg3m, fg3a, fgm, fga, ftm, fta], …], Away: […] } }
//
// What these numbers are: pbpstats counts them from the league's play-by-play, so they are not the box score. Points,
// field goals, threes and free throws are scoring plays and add up to the score (checked on reading, tools side). Steals
// are short where a steal is not attached to a turnover play (Anthony Davis, 10/26/16: 5 here, 7 in the box score), and
// rebounds can be one off (15 here, 16 in that night's box score). Use points and shooting; treat the rest as a floor.
import fs from "node:fs";
import path from "node:path";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
// NOH: the New Orleans Hornets of 2012-13, in case the list of games uses that code
const SEASONS = arg("--seasons", "2016-17,2017-18,2015-16,2014-15,2013-14,2012-13").split(",");
const TEAMS = new Set(arg("--teams", "CHI,NOP,NOH").split(",")), DIR = arg("--dir", "tools/outside/pbpstats");
const STOP = Date.now() + Number(arg("--minutes", "50")) * 60000;
const API = "https://api.pbpstats.com", H = { headers: { "user-agent": "nba-command-center (personal project; one request at a time)" } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(u, tries = 8) {
  for (let k = 0; k < tries && Date.now() < STOP; k++) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), 75000);
    try { const r = await fetch(u, { ...H, signal: c.signal }); const x = await r.text(); if (r.status === 200) return x; if (r.status === 404 || r.status === 422) return null; } catch { /* try again */ } finally { clearTimeout(t); }
    await sleep(5000 + 4000 * k);
  }
  return null;
}
const n = (v) => v || 0;
const line = (p) => [p.EntityId, p.Name, p.Minutes || null, n(p.Points), n(p.Rebounds), n(p.OffRebounds), n(p.DefRebounds), n(p.Assists), n(p.Steals), n(p.Blocks), n(p.FG3M), n(p.FG3A), n(p.FG2M) + n(p.FG3M), n(p.FG2A) + n(p.FG3A), n(p.FtPoints), n(p.FTA)];
fs.mkdirSync(DIR, { recursive: true });
let got = 0, failed = 0, left = 0;
for (const season of SEASONS) {
  const gf = path.join(DIR, `games-${season}.json`), bf = path.join(DIR, `box-${season}.jsonl`);
  if (!fs.existsSync(gf)) {
    const x = await get(`${API}/get-games/nba?Season=${season}&SeasonType=Regular+Season`);
    if (!x) { console.log(`${season}: the list of games did not come`); left++; continue; }
    fs.writeFileSync(gf, JSON.stringify(JSON.parse(x).results.map((g) => [g.GameId, g.Date, g.HomeTeamAbbreviation, g.AwayTeamAbbreviation, g.HomePoints, g.AwayPoints])));
  }
  const games = JSON.parse(fs.readFileSync(gf, "utf8")).filter((g) => TEAMS.has(g[2]) || TEAMS.has(g[3]));
  const have = new Set(fs.existsSync(bf) ? fs.readFileSync(bf, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).id) : []);
  for (const g of games) {
    if (have.has(g[0])) continue;
    if (Date.now() > STOP) { left++; continue; }
    const x = await get(`${API}/get-game-stats?GameId=${g[0]}&Type=Player`);
    let j = null; try { j = x && JSON.parse(x); } catch { /* not JSON */ }
    const full = (s) => (j?.stats?.[s]?.FullGame || []).filter((p) => p.EntityId !== "0").map(line);
    if (!j || !full("Home").length || !full("Away").length) { failed++; left++; continue; }
    fs.appendFileSync(bf, JSON.stringify({ id: g[0], d: g[1], h: g[2], a: g[3], hs: g[4], as: g[5], p: { Home: full("Home"), Away: full("Away") } }) + "\n");
    got++;
    await sleep(2500);
  }
}
console.log(`pbpstats: ${got} game(s) read, ${failed} did not come, ${left} still to do`);
fs.writeFileSync(path.join(DIR, "status.json"), JSON.stringify({ at: new Date().toISOString(), got, failed, left }));
