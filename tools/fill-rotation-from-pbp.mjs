#!/usr/bin/env node
/**
 * A game's rotation rebuilt from ESPN's play-by-play, for a game whose NBA.com rotation is missing (0.156.0).
 *
 * NBA.com's gamerotation for MIL at MIA, 11/18/26 lists no MIL stints and 3 MIA stints, so the Lineups page left the game
 * out (0.151.0). The user sent Basketball-Reference's box score for it (11/24). Game Flow's stints from ESPN's
 * play-by-play (src/gameflow/model.js buildStints) are written in NBA.com's format only if EVERY player's seconds and
 * plus-minus equal the hand-read box score exactly; otherwise nothing is written and the differences are printed.
 *
 *   node tools/fill-rotation-from-pbp.mjs src/data/boxchecks/<file>.json [--write]
 * The box file: { espnId, nbaId, d, away, home, cols: [name, mp, ..., pm], teams: { TRI: [[name, "mm:ss", ..., pm]] } }
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { expandFeeds } = await import("../src/gameflow/feeds.js");
const { buildStints } = await import("../src/gameflow/model.js");
const { SEASON } = await import("../src/season.js");
const file = process.argv[2], WRITE = process.argv.includes("--write");
const BX = JSON.parse(fs.readFileSync(file, "utf8"));
const year = String(+SEASON.slice(0, 4) + 1);
const F = expandFeeds(JSON.parse(fs.readFileSync(path.join(root, "docs", "data", "flow", year, `${BX.espnId}.json`), "utf8")));
const G = buildStints(F.pbp, F.box);
const norm = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?$/g, "").replace(/[^a-z]/g, "");
const byName = new Map(G.players.filter((p) => p.played).map((p) => [norm(p.name), p]));
// NBA.com person ids from this season's other rotation and hustle files
const rotDir = path.join(root, "history", "nbacom", SEASON), nbaId = new Map();
for (const f of fs.readdirSync(rotDir).filter((x) => /^g-\d+\.json$/.test(x))) {
  const j = JSON.parse(fs.readFileSync(path.join(rotDir, f), "utf8"));
  for (const part of [j.rot, j.hustle]) for (const rows of Object.values(part || {})) for (const r of rows) if (!nbaId.has(norm(r[1]))) nbaId.set(norm(r[1]), [String(r[0]), r[1]]);
}
const iMP = BX.cols.indexOf("mp"), iPM = BX.cols.indexOf("pm");
const bad = [], rot = {};
for (const [tri, rows] of Object.entries(BX.teams)) {
  rot[tri] = [];
  for (const r of rows) {
    const [m, s] = String(r[iMP]).split(":").map(Number), sec = m * 60 + s;
    const p = byName.get(norm(r[0])), id = nbaId.get(norm(r[0]));
    if (!p) { bad.push(`${tri} ${r[0]}: not in ESPN's play-by-play`); continue; }
    if (!id) { bad.push(`${tri} ${r[0]}: no NBA.com id on file`); continue; }
    if (p.tri !== tri) bad.push(`${tri} ${r[0]}: listed for ${p.tri} in ESPN's feed`);
    if (Math.round(p.calcMin * 60) !== sec) bad.push(`${tri} ${r[0]}: ${Math.round(p.calcMin * 60)} s rebuilt, ${sec} s in the box score`);
    if (p.calcPM !== r[iPM]) bad.push(`${tri} ${r[0]}: plus-minus ${p.calcPM} rebuilt, ${r[iPM]} in the box score`);
    for (const st of p.stints) rot[tri].push([+id[0], id[1], Math.round(st.st * 10), Math.round(st.et * 10), st.pts, st.pm]);
  }
  rot[tri].sort((a, b) => a[2] - b[2] || a[0] - b[0]);
}
const n = Object.values(BX.teams).flat().length;
if (bad.length) { console.log(`not written: ${bad.length} of ${n} players differ\n  ${bad.join("\n  ")}`); process.exit(1); }
console.log(`${BX.away} at ${BX.home} ${BX.d}: all ${n} players' seconds and plus-minus equal the box score; ${Object.entries(rot).map(([t, r]) => `${t} ${r.length} stints`).join(", ")}`);
if (!WRITE) { console.log("(dry run: --write to save)"); process.exit(0); }
const out = path.join(rotDir, `g-${BX.nbaId}.json`);
const J = JSON.parse(fs.readFileSync(out, "utf8"));
J.rot = rot;
J.rotFrom = `ESPN play-by-play (Game Flow's stints), every player's seconds and plus-minus equal to ${path.relative(root, file)}; NBA.com's rotation for this game is missing`;
J.incomplete = (J.incomplete || []).filter((x) => !x.startsWith("rot "));
if (!J.incomplete.length) delete J.incomplete;
fs.writeFileSync(out, JSON.stringify(J));
console.log(`written: ${path.relative(root, out)}`);
