#!/usr/bin/env node
/**
 * NBA.com's own box scores for the Bulls and Pelicans games ESPN has zeroed (0.146.0).
 *
 * The user, 11/24: "continue with the bulls/pelicans. maybe you can use nba.com to verify those box scores". The 972
 * games (2012-13 to 2017-18, tools/outside/pbpstats/box-<season>.jsonl) came from pbpstats, whose points and shooting
 * are exact but whose rebounds, assists, steals and blocks can run short and which has no turnovers or fouls. NBA.com's
 * traditional box score (stats.nba.com boxscoretraditionalv2) has every column. This reads it for the same game ids and
 * writes tools/outside/nbacom/box-<season>.jsonl, one game a line:
 *   { id, d, h, a, hs, as, cols: [...], p: { TRI: [[playerId, name, starter, min "mm:ss", ...cols]] } }
 * Resumable: games already in the output are skipped. One request every 1.5 seconds.
 *
 *   NODE_USE_ENV_PROXY=1 node tools/fetch-nbacom-box.mjs [season ...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const inDir = path.join(root, "tools", "outside", "pbpstats"), outDir = path.join(root, "tools", "outside", "nbacom");
fs.mkdirSync(outDir, { recursive: true });
const seasons = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(inDir).map((f) => /^box-(\d{4}-\d\d)\.jsonl$/.exec(f)?.[1]).filter(Boolean).sort();
export const COLS = ["fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "blk", "tov", "pf", "pts", "pm"];
const SRC = ["FGM", "FGA", "FG3M", "FG3A", "FTM", "FTA", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "PF", "PTS", "PLUS_MINUS"];
const HEAD = { Referer: "https://www.nba.com/", Origin: "https://www.nba.com", Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TRI = { NOH: "NOH", NOP: "NOP", BKN: "BKN", PHX: "PHX", GSW: "GSW", SAS: "SAS", NYK: "NYK" };

async function one3(id) {
  try {
    const r = await fetch(`https://stats.nba.com/stats/boxscoretraditionalv3?GameID=${id}&StartPeriod=0&EndPeriod=10&StartRange=0&EndRange=28800&RangeType=0`, { headers: HEAD, signal: AbortSignal.timeout(30000) });
    return r.ok ? (await r.json()).boxScoreTraditional : null;
  } catch { return null; }
}
async function one(id) {
  for (let tryNo = 1; tryNo <= 3; tryNo++) {
    try {
      const r = await fetch(`https://stats.nba.com/stats/boxscoretraditionalv2?GameID=${id}&StartPeriod=0&EndPeriod=10&StartRange=0&EndRange=28800&RangeType=0`, { headers: HEAD, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.json();
      console.log(`  ${id}: HTTP ${r.status} (try ${tryNo})`);
    } catch (e) { console.log(`  ${id}: ${e.name} (try ${tryNo})`); }
    await sleep(5000 * tryNo);
  }
  return null;
}

// 0.149.0: --list <file> [--out <name>]: any other games, as a JSON array of { id, d, ... } (NBA.com game ids), written to
// tools/outside/nbacom/<name>.jsonl. The archive's other gaps (games whose ESPN box score doesn't add up to the score).
const LIST = process.argv.indexOf("--list") > 0 ? process.argv[process.argv.indexOf("--list") + 1] : null;
const OUTNAME = process.argv.indexOf("--out") > 0 ? process.argv[process.argv.indexOf("--out") + 1] : "box-extra";
const jobs = LIST ? [[OUTNAME, JSON.parse(fs.readFileSync(LIST, "utf8"))]] : seasons.map((season) => [`box-${season}`, fs.readFileSync(path.join(inDir, `box-${season}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l))]);
for (const [name, src] of jobs) {
  const season = name;
  const outFile = path.join(outDir, `${name}.jsonl`);
  const have = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).id) : []);
  let n = 0;
  for (const g of src) {
    if (have.has(g.id)) continue;
    const j = await one(g.id);
    await sleep(1500);
    if (!j) { console.log(`${season} ${g.id}: not read`); continue; }
    const ps = j.resultSets.find((x) => x.name === "PlayerStats");
    const ix = Object.fromEntries(ps.headers.map((h, i) => [h, i]));
    const p = {};
    for (const row of ps.rowSet) {
      const tri = TRI[row[ix.TEAM_ABBREVIATION]] || row[ix.TEAM_ABBREVIATION];
      (p[tri] ??= []).push([String(row[ix.PLAYER_ID]), row[ix.PLAYER_NAME], row[ix.START_POSITION] ? 1 : 0, row[ix.MIN] || null, row[ix.COMMENT] || "", ...SRC.map((k) => row[ix[k]])]);
    }
    // 0.149.0: the v2 box score is empty for 2025-26 games; NBA.com's v3 box score has them (same numbers, new shape)
    let v3 = null;
    if (!ps.rowSet.length) {
      v3 = await one3(g.id); await sleep(1500);
      for (const side of v3 ? ["homeTeam", "awayTeam"] : []) {
        const T = v3[side], tri = TRI[T.teamTricode] || T.teamTricode;
        for (const pl of T.players || []) { const x = pl.statistics || {};
          (p[tri] ??= []).push([String(pl.personId), `${pl.firstName} ${pl.familyName}`.trim(), pl.position ? 1 : 0, x.minutes && x.minutes !== "0:00" && x.minutes !== "00:00" ? x.minutes : null, pl.comment || "",
            ...["fieldGoalsMade", "fieldGoalsAttempted", "threePointersMade", "threePointersAttempted", "freeThrowsMade", "freeThrowsAttempted", "reboundsOffensive", "reboundsDefensive", "reboundsTotal", "assists", "steals", "blocks", "turnovers", "foulsPersonal", "points", "plusMinusPoints"].map((k) => x[k] ?? 0)]); }
      }
    }
    let { h, a, hs, as } = g;
    if (h == null && v3) { h = TRI[v3.homeTeam.teamTricode] || v3.homeTeam.teamTricode; a = TRI[v3.awayTeam.teamTricode] || v3.awayTeam.teamTricode;
      hs = (p[h] || []).reduce((n, r) => n + (r[19] || 0), 0); as = (p[a] || []).reduce((n, r) => n + (r[19] || 0), 0); }
    if (h == null) {   // a listed game: the teams and points from NBA.com's own team rows (the first row is the away team)
      const ts = j.resultSets.find((x) => x.name === "TeamStats"), ti = Object.fromEntries(ts.headers.map((x, i) => [x, i]));
      [a, h] = ts.rowSet.map((r) => TRI[r[ti.TEAM_ABBREVIATION]] || r[ti.TEAM_ABBREVIATION]); [as, hs] = ts.rowSet.map((r) => r[ti.PTS]);
    }
    fs.appendFileSync(outFile, JSON.stringify({ id: g.id, d: g.d, h, a, hs, as, ...(g.espnD ? { espnD: g.espnD } : {}), cols: COLS, p }) + "\n");
    if (++n % 25 === 0) console.log(`${season}: ${n} read`);
  }
  console.log(`${season}: done (${n} new)`);
}
