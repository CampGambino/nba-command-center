#!/usr/bin/env node
/**
 * Freeze the ESPN data the tests use, from the live cache in data/espn/, into
 * samples/<date>/espn/ (git-ignored like the PDFs: ESPN's data, kept locally).
 * Box scores are trimmed to header + boxscore. Run after a live `track.js` run:
 *   node scripts/make-espn-fixtures.js 2026-11-09 CHA
 */
import fs from "node:fs";
import path from "node:path";
import { SHRINK } from "../src/espn/client.js";

const [date, team = "CHA"] = process.argv.slice(2);
if (!date) { console.error("usage: node scripts/make-espn-fixtures.js <date> [team]"); process.exit(2); }
const src = path.join("data", "espn"), dst = path.join("samples", date, "espn");
fs.mkdirSync(dst, { recursive: true });
const read = (k) => JSON.parse(fs.readFileSync(path.join(src, `${k}.json`), "utf8"));
const teams = read("teams");
const id = teams.data.sports[0].leagues[0].teams.find((t) => t.team.abbreviation === team)?.team.id;
if (!id) { console.error(`no ESPN id for ${team}`); process.exit(1); }
const keep = ["teams", `roster-${id}`, `schedule-${id}`, "injuries"];
const sched = read(`schedule-${id}`);
const players = new Set(read(`roster-${id}`).data.athletes.map((a) => String(a.id)));
for (const e of sched.data.events || []) {
  const k = `box-${e.id}`;
  if (!fs.existsSync(path.join(src, `${k}.json`))) continue;
  keep.push(k);
  for (const side of read(k).data.boxscore?.players || []) for (const a of side.statistics?.[0]?.athletes || []) players.add(String(a.athlete?.id));
}
// Only this team's games and the players in them (plus anyone named in its notes' lists, via career files already fetched).
for (const f of fs.readdirSync(src)) {
  const k = f.replace(/\.json$/, "");
  const m = /^(career|log)-(\d+)/.exec(k);
  if (m && players.has(m[2])) keep.push(k);
}
let bytes = 0;
for (const k of keep) {
  const j = read(k);
  if (k.startsWith("box-")) j.data = SHRINK.box(j.data);
  if (k.startsWith("log-")) j.data = SHRINK.gameLog(j.data);
  if (k === "injuries") j.data = SHRINK.injuries(j.data);
  const out = JSON.stringify(j);
  bytes += out.length;
  fs.writeFileSync(path.join(dst, `${k}.json`), out);
}
console.log(`${keep.length} files, ${(bytes / 1e6).toFixed(1)} MB -> ${dst}`);
