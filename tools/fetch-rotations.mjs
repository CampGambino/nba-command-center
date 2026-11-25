#!/usr/bin/env node
/**
 * NBA.com's rotations and hustle stats for this season's games (0.151.0; the user, 11/24: "go for" the rotations and
 * lineups idea parked earlier the same day).
 *   - stats.nba.com gamerotation: every stint, each player's check-in and check-out to the tenth of a second (IN_TIME_REAL,
 *     OUT_TIME_REAL in tenths of a second from the opening tip), with his points and the score margin over the stint
 *   - stats.nba.com boxscorehustlev2: contested shots (2 and 3), deflections, charges drawn, screen assists (and the points
 *     from them), loose balls recovered, box-outs
 * One file a game in <out>/g-<gameId>.json: { id, d, home, away, rot: { TRI: [[personId, name, in, out, pts, ptDiff]] },
 * hustle: { TRI: [[personId, name, min, contested2, contested3, deflections, charges, screenAst, screenAstPts, looseBalls, boxOuts]] } }
 * Resumable (games already on file are skipped). 1.5 seconds between requests.
 *   NODE_USE_ENV_PROXY=1 node tools/fetch-rotations.mjs [--out history/nbacom/2026-27] [--season 2026-27] [--max N]
 */
import fs from "node:fs";
import path from "node:path";
import { SEASON as CURRENT } from "../src/season.js";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
// 0.154.0: the season comes from src/season.js (it was written in as "2026-27": the daily pull would have kept reading
// last season's list after the rollover and found nothing new, every day)
const SEASON = arg("--season", CURRENT), OUT = arg("--out", `history/nbacom/${SEASON}`), MAX = +arg("--max", "100000");
const HEAD = { Referer: "https://www.nba.com/", Origin: "https://www.nba.com", Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QUICK = process.argv.includes("--quick");   // the build's nightly pull: one try at the game list, then give up quietly
async function get(url, tries = 3) {
  for (let k = 1; k <= tries; k++) {
    try { const r = await fetch(url, { headers: HEAD, signal: AbortSignal.timeout(45000) }); if (r.ok) return await r.json(); console.log(`  HTTP ${r.status} (try ${k}) ${url.split("?")[0].split("/").pop()}`); }
    catch (e) { console.log(`  ${e.name} (try ${k})`); }
    await sleep(4000 * k);
  }
  return null;
}
const rows = (j, name) => { const rs = (j?.resultSets || []).find((x) => x.name === name) || (j?.resultSets || [])[0]; if (!rs) return []; const I = Object.fromEntries(rs.headers.map((h, i) => [h, i])); return rs.rowSet.map((r) => Object.fromEntries(Object.entries(I).map(([h, i]) => [h, r[i]]))); };
fs.mkdirSync(OUT, { recursive: true });
const log = await get(`https://stats.nba.com/stats/leaguegamelog?Counter=0&DateFrom=&DateTo=&Direction=ASC&LeagueID=00&PlayerOrTeam=T&Season=${SEASON}&SeasonType=Regular+Season&Sorter=DATE`, QUICK ? 1 : 3);
if (!log) { (QUICK ? console.log : console.error)("rotations: NBA.com's game list can't be read from here; nothing fetched"); process.exit(QUICK ? 0 : 1); }
const games = new Map(), triOf = {};
for (const r of rows(log, "LeagueGameLog")) {
  triOf[r.TEAM_ID] = r.TEAM_ABBREVIATION;
  const g = games.get(r.GAME_ID) || { id: r.GAME_ID, d: r.GAME_DATE, home: null, away: null };
  if (/ vs\. /.test(r.MATCHUP)) g.home = r.TEAM_ABBREVIATION; else g.away = r.TEAM_ABBREVIATION;
  games.set(r.GAME_ID, g);
}
const [PK, PN] = arg("--part", "0/1").split("/").map(Number);   // --part k/n: every nth game from the kth (runs side by side)
// a neutral-site game lists both teams with "@" (Mexico City, 11/7): the other team is the "home" one here; the build
// matches such a game either way round (scripts/lineups.js)
for (const g of games.values()) if (!g.home || !g.away) { const both = rows(log, "LeagueGameLog").filter((r) => r.GAME_ID === g.id).map((r) => r.TEAM_ABBREVIATION); g.home ??= both.find((t) => t !== g.away); g.away ??= both.find((t) => t !== g.home); }
// 0.154.0: a game NBA.com hadn't finished posting is read again. POR-PHI 11/23 was read the next day with no hustle stats
// (NBA.com had none yet) and never again; MIL's rotation for 11/18 is missing on NBA.com. Such a file says what it lacks
// (`incomplete`) and is retried for RETRY_DAYS after the game, then left as it is.
const RETRY_DAYS = 7, todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const daysSince = (d) => Math.round((Date.parse(`${todayET}T12:00:00Z`) - Date.parse(`${String(d).slice(0, 10)}T12:00:00Z`)) / 864e5);
const lacking = (g) => { const f = path.join(OUT, `g-${g.id}.json`); if (!fs.existsSync(f)) return "new";
  try { const j = JSON.parse(fs.readFileSync(f, "utf8")); return j.incomplete?.length && daysSince(j.d) <= RETRY_DAYS ? "again" : null; } catch { return "new"; } };
const todo = [...games.values()].filter((g, i) => i % PN === PK && lacking(g)).slice(0, MAX);
const again = todo.filter((g) => lacking(g) === "again").length;
console.log(`${SEASON}: ${games.size} games played, ${todo.length} to read${again ? ` (${again} read before with something missing, tried again)` : ""}`);
let n = 0, failed = 0;
for (const g of todo) {
  const rot = await get(`https://stats.nba.com/stats/gamerotation?GameID=${g.id}&LeagueID=00`); await sleep(1500);
  const hus = await get(`https://stats.nba.com/stats/boxscorehustlev2?GameID=${g.id}`); await sleep(1500);
  if (!rot) { failed++; continue; }
  const R = {};
  for (const side of ["AwayTeam", "HomeTeam"]) for (const r of rows(rot, side)) (R[triOf[r.TEAM_ID] || r.TEAM_ID] ??= []).push([String(r.PERSON_ID), `${r.PLAYER_FIRST} ${r.PLAYER_LAST}`.trim(), r.IN_TIME_REAL, r.OUT_TIME_REAL, r.PLAYER_PTS, r.PT_DIFF]);
  const H = {};
  if (hus?.boxScoreHustle) for (const side of ["homeTeam", "awayTeam"]) { const T = hus.boxScoreHustle[side]; for (const p of T?.players || []) { const x = p.statistics || {}; if (!p.personId) continue;
    (H[T.teamTricode] ??= []).push([String(p.personId), `${p.firstName} ${p.familyName}`.trim(), x.minutes || null, x.contestedShots2pt ?? 0, x.contestedShots3pt ?? 0, x.deflections ?? 0, x.chargesDrawn ?? 0, x.screenAssists ?? 0, x.screenAssistPoints ?? 0, x.looseBallsRecoveredTotal ?? 0, x.boxOuts ?? 0]); } }
  else for (const r of rows(hus, "PlayerStats")) (H[r.TEAM_ABBREVIATION] ??= []).push([String(r.PLAYER_ID), r.PLAYER_NAME, r.MINUTES || null, r.CONTESTED_SHOTS_2PT ?? 0, r.CONTESTED_SHOTS_3PT ?? 0, r.DEFLECTIONS ?? 0, r.CHARGES_DRAWN ?? 0, r.SCREEN_ASSISTS ?? 0, r.SCREEN_AST_PTS ?? 0, r.LOOSE_BALLS_RECOVERED ?? 0, r.BOX_OUTS ?? 0]);   // 0.154.0: loose balls fell back to box-outs
  // what NBA.com didn't have: a team with no stints, or no hustle stats for a team
  const incomplete = [...[g.home, g.away].filter((t) => !(R[t]?.length >= 5)).map((t) => `rot ${t}`), ...[g.home, g.away].filter((t) => !H[t]?.length).map((t) => `hustle ${t}`)];
  const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, `g-${g.id}.json`), "utf8")); } catch { return null; } })();
  // a second read keeps whichever part the first read had and this one lacks
  const rotOut = Object.keys(R).length ? R : prev?.rot || R, hustleOut = Object.keys(H).length ? H : prev?.hustle || null;
  const still = incomplete.filter((x) => (x.startsWith("rot") ? !(rotOut[x.slice(4)]?.length >= 5) : !hustleOut?.[x.slice(7)]?.length));
  fs.writeFileSync(path.join(OUT, `g-${g.id}.json`), JSON.stringify({ id: g.id, d: g.d, home: g.home, away: g.away, rot: rotOut, hustle: hustleOut, ...(still.length ? { incomplete: still } : {}) }));
  if (still.length) console.log(`  ${g.d} ${g.away}@${g.home}: NBA.com lacks ${still.join(", ")} (tried again for ${RETRY_DAYS} days)`);
  if (++n % 20 === 0) console.log(`  ${n} read`);
}
console.log(`done: ${n} read, ${failed} not read`);
