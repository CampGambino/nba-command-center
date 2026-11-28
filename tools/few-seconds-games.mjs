#!/usr/bin/env node
// The few-seconds games of past seasons (0.184.0; the user, 11/28/26: "can you get around the zero-minute game by checking
// seconds played or stats in a game like personal fouls? play-by-play data may also offer insight if a player checked into
// the game … there are rare occasions … where joe ingles enters the game to inbound the ball at the end of the game then
// subs out. those games count as played").
//
// The box-score archive (tools/odd-games/README.md) gives whole minutes. A player who was on the floor for a few seconds
// can have 0 minutes and nothing else in his line. The career logs (tools/build-career-logs.mjs) count a 0-minute line as a
// game when it has any number, the plus-minus included. This tool finds the rest: the current players' 0-minute lines with
// nothing at all in them, and reads ESPN's play-by-play for each of those games. A line is a game when a substitution play
// (in or out) names him by his ESPN id. A technical foul or an ejection from the bench is not a game. Old seasons list a
// player who sat out with a line of zeros; those have no substitution and stay out.
//
//   src/data/few-seconds-history.json  { source, rule, rows: [[espnGameId, date, espnId, name, "sub"], …] }
//
//   NODE_USE_ENV_PROXY=1 node tools/few-seconds-games.mjs [--dir /home/claude/work/full] [--cache /home/claude/work/pbp-sub]
// Run it after tools/build-career-logs.mjs has run once (it reads that file for who the current players are), then run that
// tool again so the games go in. About ten minutes the first time (some 1,900 games); the cache keeps the answers.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { countedGame } from "./odd-games/counted.mjs";
import { CUP_TITLE_DATES } from "../src/situations/results.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const DIR = arg("--dir", "/home/claude/work/full"), CACHE = arg("--cache", "/home/claude/work/pbp-sub");
const OUT = path.join(root, "src", "data", "few-seconds-history.json");
const NOW = (() => { const d = new Date(), y = d.getUTCFullYear(); return `${d.getUTCMonth() >= 7 ? y : y - 1}-08-01`; })();
fs.mkdirSync(CACHE, { recursive: true });

const career = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "src", "data", "player-logs-career.json.gz"))));
// archive row: [espnId, name, pos, starter, min, pts, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, reb, ast, stl, blk, to, pf, +/-]
const anyNumber = (p) => p[4] > 0 || p.slice(5, 21).some((v) => v != null && v !== 0);
const seen = new Set(), cand = [];
for (const f of fs.readdirSync(DIR).filter((x) => /^f-\d+\.json$/.test(x)).sort()) {
  let g; try { g = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); } catch { continue; }
  if (!g?.d || g.d >= NOW || !countedGame(g, seen, CUP_TITLE_DATES)) continue;
  for (const t of g.t) for (const p of t.p) if (career.players[String(p[0])] && !anyNumber(p)) cand.push({ gid: f.slice(2, -5), d: g.d, id: String(p[0]), name: p[1] });
}
const games = [...new Set(cand.map((c) => c.gid))];
console.log(`0-minute lines with nothing in them, current players: ${cand.length} in ${games.length} games`);

// For each game: the ids named in its substitution plays (cached as { n, subIds }).
async function subIds(gid) {
  const file = path.join(CACHE, `${gid}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gid}`, { signal: AbortSignal.timeout(45000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json(), ids = new Set();
      for (const p of j.plays || []) if (/substitution/i.test(p.type?.text || "") || / enters the game for /.test(p.text || "")) for (const x of p.participants || []) if (x?.athlete?.id) ids.add(String(x.athlete.id));
      const out = { n: (j.plays || []).length, subIds: [...ids] };
      fs.writeFileSync(file, JSON.stringify(out));
      return out;
    } catch (e) { if (a === 3) return { error: e.message }; await new Promise((r) => setTimeout(r, 1500 * (a + 1))); }
  }
}
const by = {};
let i = 0, failed = 0;
await Promise.all(Array.from({ length: 6 }, async () => { while (i < games.length) { const gid = games[i++]; by[gid] = await subIds(gid); if (by[gid].error) failed++; } }));
const rows = cand.filter((c) => by[c.gid]?.subIds?.includes(c.id)).map((c) => [c.gid, c.d, c.id, c.name, "sub"]).sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
const noPlays = games.filter((g) => by[g] && !by[g].error && !by[g].n).length;
console.log(`games read: ${games.length - failed}${failed ? ` (${failed} could not be read: run again)` : ""}; ${noPlays} with no play-by-play; few-seconds games found: ${rows.length}`);
if (failed) process.exitCode = 1;
fs.writeFileSync(OUT, JSON.stringify({ source: "ESPN play-by-play (site.api.espn.com summary), for the current players' 0-minute lines in the box-score archive with nothing in them; built by tools/few-seconds-games.mjs",
  rule: "A 0-minute line is a game when a substitution play (in or out) names the player by his ESPN id. Lines with any number, the plus-minus included, are counted by tools/build-career-logs.mjs without this file.",
  rows }).replace(/\],\[/g, "],\n["));
console.log(`wrote ${path.relative(root, OUT)}: ${rows.length} rows`);
