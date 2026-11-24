#!/usr/bin/env node
/**
 * The Bulls' and Pelicans' filled lines, checked against NBA.com's own box scores (0.148.0).
 *
 * The user, 11/24: "continue with the bulls/pelicans. maybe you can use nba.com to verify those box scores". The players'
 * filled game lines (src/data/player-logs-fill.json.gz, from pbpstats, src "p") had exact points and shooting but only a
 * floor for rebounds, assists, steals and blocks. NBA.com's traditional box score for each of the 972 games
 * (tools/outside/nbacom, by tools/fetch-nbacom-box.mjs) has every column. Each filled line is matched to its game (same
 * date, a day either side, the opponent in it) and to the player (the one line on his side with the same points and the
 * same seven shooting numbers). A matched line takes NBA.com's minutes, rebounds, assists, steals and blocks and is
 * marked src "n" (NBA.com): a whole line every reader may use (src/situations/logfill.js).
 *
 *   node tools/verify-fill-nbacom.mjs [--write]
 */
import fs from "node:fs";
import zlib from "node:zlib";
const FILL = "src/data/player-logs-fill.json.gz", DIR = "tools/outside/nbacom";
const F = JSON.parse(zlib.gunzipSync(fs.readFileSync(FILL)));
const ix = Object.fromEntries(F.columns.map((c, i) => [c, i]));
const games = [];
for (const f of fs.readdirSync(DIR).filter((x) => /^box-.*\.jsonl$/.test(x))) for (const l of fs.readFileSync(`${DIR}/${f}`, "utf8").trim().split("\n")) games.push(JSON.parse(l));
const T = { NOH: "NOP", NO: "NOP", NY: "NYK", GS: "GSW", SA: "SAS", UTAH: "UTA", WSH: "WAS", PHO: "PHX" }, tri = (t) => T[t] || t;
const near = (d, k) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const byDate = new Map();
for (const g of games) (byDate.get(g.d) || byDate.set(g.d, []).get(g.d)).push(g);
const SHOT = ["pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta"];
const stat = { rows: 0, matched: 0, changed: {}, noGame: 0, noPlayer: 0, ambiguous: 0 }, examples = [];
for (const [id, rows] of Object.entries(F.players)) for (const r of rows) {
  if (r[ix.src] !== "p") continue;
  stat.rows++;
  const opp = tri(r[ix.opp]);
  const g = [0, -1, 1].flatMap((k) => byDate.get(near(r[ix.date], k)) || []).find((x) => tri(x.h) === opp || tri(x.a) === opp);
  if (!g) { stat.noGame++; continue; }
  const C = Object.fromEntries(g.cols.map((c, i) => [c, i + 5]));
  const mine = Object.entries(g.p).filter(([t]) => tri(t) !== opp).flatMap(([, v]) => v).filter((p) => p[3]);
  let hit = mine.filter((p) => SHOT.every((k) => (p[C[k]] || 0) === (r[ix[k]] || 0)));
  // two lines alike in scoring (most often two scoreless bench players): the one whose rebounds, assists and blocks agree too
  if (hit.length > 1) hit = hit.filter((p) => ["reb", "ast", "blk"].every((k) => (p[C[k]] || 0) === (r[ix[k]] || 0)));
  if (!hit.length) { stat.noPlayer++; continue; }
  if (hit.length > 1) { stat.ambiguous++; continue; }
  const p = hit[0], [mm, ss] = String(p[3]).split(":").map(Number), min = Math.round((mm || 0) + (ss || 0) / 60);
  stat.matched++;
  for (const [k, v] of [["min", min], ["reb", p[C.reb]], ["ast", p[C.ast]], ["stl", p[C.stl]], ["blk", p[C.blk]]]) {
    if (r[ix[k]] !== v) { stat.changed[k] = (stat.changed[k] || 0) + 1; if (examples.length < 12) examples.push([id, p[1], r[ix.date], k, r[ix[k]], v]); r[ix[k]] = v; }
  }
  r[ix.src] = "n";
}
console.log(stat);
for (const e of examples) console.log("  ", e.join(" | "));
if (process.argv.includes("--write")) {
  F.source = `${F.source}; checked against NBA.com's box scores (stats.nba.com boxscoretraditionalv2, tools/verify-fill-nbacom.mjs): matched lines carry src "n" and NBA.com's minutes, rebounds, assists, steals and blocks`;
  fs.writeFileSync(FILL, zlib.gzipSync(JSON.stringify(F), { level: 9 }));
  console.log(`written: ${FILL}`);
}
