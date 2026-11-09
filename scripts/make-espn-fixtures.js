#!/usr/bin/env node
/**
 * Freeze the ESPN data the tests use, from the live cache in data/espn/, into
 * samples/<date>/espn/ (git-ignored like the PDFs: ESPN's data, kept locally).
 * Box scores are trimmed to header + boxscore. Run after a live `track.js` run:
 *   node scripts/make-espn-fixtures.js 2026-11-09 CHA
 */
import fs from "node:fs";
import path from "node:path";

const [date, team = "CHA"] = process.argv.slice(2);
if (!date) { console.error("usage: node scripts/make-espn-fixtures.js <date> [team]"); process.exit(2); }
const src = path.join("data", "espn"), dst = path.join("samples", date, "espn");
fs.mkdirSync(dst, { recursive: true });
const read = (k) => JSON.parse(fs.readFileSync(path.join(src, `${k}.json`), "utf8"));
const teams = read("teams");
const id = teams.data.sports[0].leagues[0].teams.find((t) => t.team.abbreviation === team)?.team.id;
if (!id) { console.error(`no ESPN id for ${team}`); process.exit(1); }
const keep = ["teams", `roster-${id}`, `schedule-${id}`];
for (const f of fs.readdirSync(src)) {
  const k = f.replace(/\.json$/, "");
  if (k.startsWith("career-")) keep.push(k);
}
const sched = read(`schedule-${id}`);
for (const e of sched.data.events || []) {
  const k = `box-${e.id}`;
  if (fs.existsSync(path.join(src, `${k}.json`))) keep.push(k);
}
let bytes = 0;
for (const k of keep) {
  const j = read(k);
  if (k.startsWith("box-")) j.data = { header: j.data.header, boxscore: j.data.boxscore };
  const out = JSON.stringify(j);
  bytes += out.length;
  fs.writeFileSync(path.join(dst, `${k}.json`), out);
}
console.log(`${keep.length} files, ${(bytes / 1e6).toFixed(1)} MB -> ${dst}`);
