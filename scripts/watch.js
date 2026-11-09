#!/usr/bin/env node
/**
 * Watch List from one or more teams' notes.
 *   node scripts/watch.js samples/2026-11-09/*.pdf [--today 2026-11-09] [--json out.json]
 * Prints tonight's likely milestones and the ones coming up, per team and combined.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ["--no-warnings", ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  process.exit(r.status ?? 1);
}

const { parseNotes } = await import("../src/notes/parse.js");
const { teamFromSlug } = await import("../src/teams.js");
const { createEspn } = await import("../src/espn/client.js");
const { buildWatch, rank } = await import("../src/anticipate/watch.js");
const { etDate } = await import("../src/espn/parse.js");

const args = process.argv.slice(2);
const files = args.filter((a) => a.endsWith(".pdf"));
const today = args.includes("--today") ? args[args.indexOf("--today") + 1] : etDate(new Date().toISOString());
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
if (!files.length) { console.error("usage: node scripts/watch.js <notes.pdf>... [--today YYYY-MM-DD] [--json out.json]"); process.exit(2); }

const espn = createEspn({ dataDir: "data" });
const all = [];
const reports = [];
for (const f of files) {
  const team = teamFromSlug(path.basename(f, ".pdf"));
  const parsed = await parseNotes(fs.readFileSync(f), { team });
  const w = await buildWatch({ team, notesDate: parsed.meta.gameDate, milestones: parsed.milestones, espn, today });
  reports.push({ ...w, opponent: parsed.meta.opponent });
  all.push(...w.items);
  for (const p of w.problems) console.log(`PROBLEM ${team}: ${p}`);
}

const pct = (x) => (x == null ? "  -" : `${Math.round(x * 100)}%`.padStart(4));
const line = (i) => {
  const what = i.kind === "pass" ? `pass ${i.passing?.player}${i.scope ? ` (${i.scope})` : ""}` : `${Number(i.target).toLocaleString("en-US")} ${i.label} (${i.scope || "career"})`;
  const flags = [i.publishable ? "" : "REVIEW", i.injury ? i.injury.status.toUpperCase() : "", i.confidence === "low" ? "few games" : ""].filter(Boolean).join(", ");
  return `${pct(i.pTonight)} tonight ${pct(i.pNext3)} in 3  imp ${String(i.importance).padStart(2)}  ${i.team} ${i.player}: ${what}, needs ${i.need}${i.eta ? `, ETA game ${i.eta.game} (${i.eta.date})` : ""}${flags ? `  [${flags}]` : ""}`;
};
const { tonight, soon } = rank(all);
console.log(`\nTONIGHT (${today})`);
for (const i of tonight) console.log("  " + line(i));
console.log(`\nNEXT 5 GAMES`);
for (const i of soon.filter((x) => x.eta.game <= 5)) console.log("  " + line(i));
console.log(`\n${all.length} milestones; ${tonight.length} possible tonight; ${soon.filter((x) => x.eta.game <= 5).length} more within 5 games; ${all.filter((i) => i.reached).length} already reached`);
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify({ today, reports }, null, 1)); console.log(`wrote ${jsonOut}`); }
