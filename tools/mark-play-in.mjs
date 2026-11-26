#!/usr/bin/env node
// Marks the play-in tournament's games in the past-seasons player log (src/data/player-logs-history.json.gz) as their
// own game type, 5. ESPN's game logs file them under the regular season (type 2), and every reader of the file counted
// them there: last season's averages, career highs since 2016-17, runs against one opponent. The NBA and
// Basketball-Reference count play-in games in neither the regular season nor the playoffs. Found 11/25/26 against
// Basketball-Reference's list of active 10+ point runs (0.166.0). Readers ask for type 2 (regular season) or 3
// (playoffs), so a type-5 row is in neither. The dates are PLAY_IN_DATES (src/situations/results.js); only play-in
// games are played on them. Safe to run again: it changes only rows still marked 2.
//   node tools/mark-play-in.mjs            rewrite the file
//   node tools/mark-play-in.mjs --check    say how many rows would change, write nothing
import fs from "node:fs";
import zlib from "node:zlib";
import { PLAY_IN_DATES } from "../src/situations/results.js";

export const PLAY_IN_TYPE = 5;
export function markPlayIn(logs) {
  const ix = Object.fromEntries(logs.columns.map((c, i) => [c, i]));
  let n = 0; const dates = {};
  for (const rows of Object.values(logs.players)) for (const r of rows) if (r[ix.type] === 2 && PLAY_IN_DATES.has(r[ix.date])) { r[ix.type] = PLAY_IN_TYPE; n++; dates[r[ix.date]] = (dates[r[ix.date]] || 0) + 1; }
  return { n, dates };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lf = "src/data/player-logs-history.json.gz";
  const L = JSON.parse(zlib.gunzipSync(fs.readFileSync(lf)));
  const { n, dates } = markPlayIn(L);
  if (n && !process.argv.includes("--check")) fs.writeFileSync(lf, zlib.gzipSync(JSON.stringify(L), { level: 9 }));
  console.log(`player logs: ${n} play-in row(s) ${process.argv.includes("--check") ? "would be" : ""} marked type ${PLAY_IN_TYPE} on ${Object.keys(dates).length} date(s)${n ? `: ${Object.entries(dates).sort().map(([d, c]) => `${d} ${c}`).join(", ")}` : ""}`);
}
