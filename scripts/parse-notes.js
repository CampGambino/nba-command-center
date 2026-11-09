#!/usr/bin/env node
/**
 * Parse one or more game notes PDFs and print what was found.
 *   node scripts/parse-notes.js samples/2026-11-09/cavaliers.pdf
 *   node scripts/parse-notes.js samples/2026-11-09/*.pdf --json
 */
import fs from "node:fs";
import path from "node:path";
import { parseNotes } from "../src/notes/parse.js";
import { teamFromSlug, teamFromText } from "../src/teams.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const files = args.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: node scripts/parse-notes.js <notes.pdf> [...] [--json]");
  process.exit(1);
}

for (const file of files) {
  const base = path.basename(file, ".pdf");
  const team = teamFromSlug(base) || teamFromText(base);
  const res = await parseNotes(fs.readFileSync(file), { team });
  if (asJson) { console.log(JSON.stringify({ file, ...res }, null, 2)); continue; }

  const ok = res.milestones.filter((m) => m.status === "ok");
  const review = res.milestones.filter((m) => m.status !== "ok");
  console.log(`\n=== ${file}  [${team || "?"}]  ${res.meta.pageCount} pages`);
  console.log(`game: ${res.meta.gameDate || "date ?"} vs ${res.meta.opponent || "opponent ?"}`);
  console.log(`milestones: ${ok.length} ok, ${review.length} for review; leaderboards: ${res.leaderboards.length}; roster names: ${res.roster.length}`);
  const show = [...ok].sort((a, b) => a.need - b.need).slice(0, 25);
  for (const m of show) {
    const what = m.kind === "round" ? `${m.target.toLocaleString()} ${m.label}` : `${m.kind === "average-gap" ? "trails" : "pass"} ${m.passing.player} (${m.passing.total}) on "${m.list}" [${m.scope}]`;
    console.log(`  ${String(m.need).padStart(5)}  ${m.player.padEnd(24)} ${what}  [now ${m.current.toLocaleString()}]`);
  }
  for (const m of review) console.log(`  REVIEW ${m.player || "?"} ${m.label || ""}: ${m.checks.join("; ")}`);
  for (const n of res.notes.slice(0, 8)) console.log(`  NOTE p${n.page}: ${n.text.slice(0, 200)}`);
  if (res.notes.length > 8) console.log(`  ... ${res.notes.length - 8} more forward-looking sentences`);
  for (const p of res.problems) console.log(`  PROBLEM p${p.page}: ${p.problem}`);
  for (const lb of res.leaderboards.filter((l) => l.checks.length)) console.log(`  LIST p${lb.page} "${lb.title}": ${lb.checks.join("; ")}`);
}
