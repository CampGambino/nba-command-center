#!/usr/bin/env node
/**
 * Tonight's whole slate, automatically:
 *   1. ESPN's scoreboard for today -> every team playing
 *   2. download each team's notes from nba.com (fixed URL, new contents) and
 *      check they are tonight's (stale / conflict are reported, and stale notes
 *      are still used: totals are rolled forward through the games since)
 *   3. parse, track, project, and build the website data
 *   node scripts/tonight.js [--today YYYY-MM-DD]
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ["--no-warnings", ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  process.exit(r.status ?? 1);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const { createEspn } = await import("../src/espn/client.js");
const { createNbaStatic } = await import("../src/nba/static.js");
const { etDate } = await import("../src/espn/parse.js");
const { checkNotes, versionPath } = await import("../src/notes/watcher.js");
const { buildSite } = await import("../src/site/build.js");

const args = process.argv.slice(2);
const today = args.includes("--today") ? args[args.indexOf("--today") + 1] : etDate(new Date().toISOString());
const espn = createEspn({ dataDir });
const nba = createNbaStatic({ dataDir });
const sb = await espn.scoreboard(today);
if (!sb.ok) { console.error(`can't read tonight's schedule: ${sb.error}`); process.exit(1); }
const games = sb.data.games.filter((g) => g.date === today && (g.seasonType == null || g.seasonType === 2));
console.log(`${today}: ${games.length} games`);

const entries = [];
for (const g of games) {
  for (const [team, opp] of [[g.awayTri, g.homeTri], [g.homeTri, g.awayTri]]) {
    if (!team) { console.log(`  unknown team in game ${g.id}`); continue; }
    const r = await checkNotes({ team, date: today, opponent: opp, dataDir });
    const file = r.version ? versionPath(dataDir, team, r.version) : null;
    const buf = file && fs.existsSync(file) ? fs.readFileSync(file) : null;
    console.log(`  ${team.padEnd(3)} notes: ${r.status}${r.why ? ` (${r.why})` : ""}${r.error ? ` (${r.error})` : ""}`);
    entries.push({ team, buf, notes: { status: r.status, why: r.why, error: r.error } });
  }
}
const { site } = await buildSite({ entries, games, espn, nba, today, root });
const n = site.teams.reduce((a, t) => a + t.items.length, 0);
console.log(`built: ${site.teams.length} teams, ${n} milestones -> docs/data/watch.json`);
