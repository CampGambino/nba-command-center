#!/usr/bin/env node
/**
 * Past nights' record chances, for scoring (0.141.9): for each date, the records.json of the last commit before
 * 6:30 PM ET that day whose `today` is that date (what the Records page showed before tip-off), through the same
 * tonightChances the build now uses, into history/predictions-records-<date>.json.gz. Then score them with
 * `node scripts/ci.js score --date <date>`. A date that already has the file is skipped.
 *   node tools/backfill-record-predictions.mjs --from 2026-11-10 --to 2026-11-20
 */
import fs from "node:fs";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { tonightChances } from "../src/records/predictions.js";

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const FROM = arg("--from"), TO = arg("--to");
const root = new URL("..", import.meta.url).pathname;
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 256 << 20 });
for (let t = Date.parse(`${FROM}T12:00:00Z`); t <= Date.parse(`${TO}T12:00:00Z`); t += 864e5) {
  const d = new Date(t).toISOString().slice(0, 10), out = `${root}history/predictions-records-${d}.json.gz`;
  if (fs.existsSync(out)) { console.log(`${d}: already on file`); continue; }
  // 6:30 PM ET = 23:30 UTC in winter
  const commits = git("log", "origin/main", `--before=${d}T23:30:00Z`, `--after=${d}T00:00:00Z`, "--format=%H %cI", "--", "docs/data/records.json").trim().split("\n").filter(Boolean);
  let got = null;
  for (const line of commits) {
    const [h, when] = line.split(" ");
    let r; try { r = JSON.parse(git("show", `${h}:docs/data/records.json`)); } catch { continue; }
    if (r.today === d) { got = { h, when, r }; break; }
  }
  if (!got) { console.log(`${d}: no records.json for that day before 6:30 PM ET`); continue; }
  const items = tonightChances(got.r);
  fs.writeFileSync(out, zlib.gzipSync(JSON.stringify({ today: d, items, from: `${got.h.slice(0, 7)} ${got.when}` }), { level: 9 }));
  console.log(`${d}: ${items.length} chances (${items.filter((i) => i.pTonight >= 0.05).length} at 5%+) from ${got.h.slice(0, 7)} ${got.when}`);
}
