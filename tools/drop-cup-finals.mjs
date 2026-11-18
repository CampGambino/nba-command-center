#!/usr/bin/env node
// Takes the NBA Cup's title games (src/data/cup-finals.json) out of the two past-season files, where ESPN's "regular
// season" label had put them (found in the self-audit of 0.106). Safe to run again: it removes only what is there.
//   node tools/drop-cup-finals.mjs
import fs from "node:fs";
import zlib from "node:zlib";
const CUP = JSON.parse(fs.readFileSync("src/data/cup-finals.json", "utf8")).games;
const hf = "src/data/nba-results-history.json", lf = "src/data/player-logs-history.json.gz";
const H = JSON.parse(fs.readFileSync(hf, "utf8"));
const isCup = (d, a, b) => CUP.some((c) => c[0] === d && ((c[1] === a && c[2] === b) || (c[1] === b && c[2] === a)));
const before = H.games.length;
H.games = H.games.filter((g) => !isCup(g[0], g[1], g[2]));
if (H.games.length !== before) fs.writeFileSync(hf, JSON.stringify(H));
const L = JSON.parse(zlib.gunzipSync(fs.readFileSync(lf)));
const ix = Object.fromEntries(L.columns.map((c, i) => [c, i]));
let cut = 0;
for (const [id, rows] of Object.entries(L.players)) {
  const keep = rows.filter((r) => !CUP.some((c) => c[0] === r[ix.date] && (c[1] === r[ix.opp] || c[2] === r[ix.opp])));
  cut += rows.length - keep.length; L.players[id] = keep;
}
if (cut) fs.writeFileSync(lf, zlib.gzipSync(JSON.stringify(L), { level: 9 }));
console.log(`results history: ${before - H.games.length} game(s) removed (${H.games.length} left); player logs: ${cut} row(s) removed`);
