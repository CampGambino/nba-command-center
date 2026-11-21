#!/usr/bin/env node
/**
 * Adds stat, pPlay (the chance to play the build gave) and played (whether he played) to scored calls that predate
 * 0.141.7, from the saved predictions (history/predictions-<date>.json.gz) and this season's box scores
 * (history/results). A call that can't be matched to its prediction or its game is left as it was. Lines that already
 * have the fields are untouched. node tools/backfill-calls.mjs [--write]
 */
import fs from "node:fs";
import zlib from "node:zlib";
import { loadStore, allGames } from "../src/situations/results.js";

const root = new URL("..", import.meta.url).pathname, file = `${root}history/calls.jsonl`;
const games = allGames(loadStore(`${root}history/results`, fs));
const preds = {};
for (const f of fs.readdirSync(`${root}history`)) {
  const m = f.match(/^predictions-(\d{4}-\d\d-\d\d)\.json\.gz$/);
  if (m) preds[m[1]] = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${root}history/${f}`)));
}
let added = 0, had = 0, unmatched = 0;
const out = fs.readFileSync(file, "utf8").trim().split("\n").map((line) => {
  const c = JSON.parse(line);
  if ("pPlay" in c) { had++; return line; }
  const rep = preds[c.d]?.reports.find((r) => r.team === c.team);
  const it = rep?.items.find((i) => i.player === c.player && i.need === c.need && (`${i.target} ${i.label}` === c.what || (i.kind === "pass" && c.what === `pass ${i.passing?.player}`)));
  const g = games.find((x) => x.d === c.d && (x.h === c.team || x.a === c.team));
  const row = it?.espnId && g ? g.pl?.[it.espnId] : undefined;
  if (!it || it.pPlayTonight == null || !g) { unmatched++; return line; }
  added++;
  return JSON.stringify({ ...c, stat: it.stat || null, pPlay: it.pPlayTonight, played: row ? row[2] > 0 : false });
});
console.log(`calls: ${out.length}; filled in ${added}, already had them ${had}, couldn't match ${unmatched}`);
if (process.argv.includes("--write")) fs.writeFileSync(file, out.join("\n") + "\n");
