// How close the play-by-play counts in src/espn/misc.js are to ESPN's own team totals (points in the paint, points off
// turnovers), over this season's games. Second-chance points have no ESPN total: check those against a published table.
//
//   NODE_USE_ENV_PROXY=1 node tools/check-scoring-types.mjs [games, newest first; default 40] [--dir <folder of saved summaries>]
// With --dir, summaries are read from (and saved to) <folder>/<espn id>.json instead of being fetched each time.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { readGameMisc } from "../src/espn/misc.js";
import { loadStore, allGames } from "../src/situations/results.js";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), di = args.indexOf("--dir"), dir = di >= 0 ? args[di + 1] : null, n = Number(args.find((a, i) => /^\d+$/.test(a) && i !== di + 1)) || 40;
const rows = allGames(loadStore(path.join(root, "history", "results"), fs)).filter((g) => g.x).slice(-n);
let games = 0, teams = 0, paintSame = 0, paintOff = 0, potSame = 0, potOff = 0, notOk = 0;
for (const g of rows) {
  const file = dir ? path.join(dir, `${g.id}.json`) : null;
  let json = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  if (!json) {
    try {
      const j = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${g.id}`, { headers: { "User-Agent": "Mozilla/5.0 nba-command-center" } })).json();
      json = { header: j.header, boxscore: { teams: j.boxscore?.teams }, plays: j.plays };
      if (file) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(json)); }
      await new Promise((r) => setTimeout(r, 200));
    } catch (e) { console.log(`${g.id}: not read (${e.message})`); continue; }
  }
  const m = readGameMisc(json);
  if (!m) { console.log(`${g.id}: no totals`); continue; }
  games++; if (!m.ok) { notOk++; console.log(`${g.d} ${g.a} @ ${g.h}: paint counted ${m.counted.away[0]}-${m.counted.home[0]}, ESPN ${m.away[0]}-${m.home[0]} (players not used)`); }
  for (const side of ["home", "away"]) { teams++; const dp = m.counted[side][0] - m[side][0], dt = m.counted[side][1] - m[side][2]; paintSame += dp === 0; paintOff += Math.abs(dp); potSame += dt === 0; potOff += Math.abs(dt); }
}
console.log(`${games} games, ${teams} team-games. Paint: equal to ESPN in ${paintSame}, ${(paintOff / (teams || 1)).toFixed(2)} a game off on average. Off turnovers: equal in ${potSame}, ${(potOff / (teams || 1)).toFixed(2)} off. Games whose player numbers are not used: ${notOk}.`);
