#!/usr/bin/env node
/**
 * Bring a team's notes milestones up to date with ESPN and cross-check them.
 *   node scripts/track.js samples/2026-11-09/hornets.pdf [--team CHA] [--json] [--all]
 * Without --all only milestones whose tracking found something worth a look are
 * listed (disagreements, reached, changed). Data is cached in data/espn/.
 */
import fs from "node:fs";
import path from "node:path";
import { parseNotes } from "../src/notes/parse.js";
import { teamFromSlug } from "../src/teams.js";
import { createEspn } from "../src/espn/client.js";
import { trackMilestones } from "../src/registry/track.js";

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".pdf"));
if (!file) { console.error("usage: node scripts/track.js <notes.pdf> [--team XXX] [--json] [--all]"); process.exit(2); }
const team = args.includes("--team") ? args[args.indexOf("--team") + 1] : teamFromSlug(path.basename(file, ".pdf"));
const parsed = await parseNotes(fs.readFileSync(file), { team });
const espn = createEspn({ dataDir: "data" });
const r = await trackMilestones({ team, notesDate: parsed.meta.gameDate, milestones: parsed.milestones, espn });

if (args.includes("--json")) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
console.log(`${team} notes for ${parsed.meta.gameDate}: ${r.games.length} game(s) played since: ${r.games.map((g) => g.date).join(", ") || "none"}`);
const counts = {};
for (const m of r.milestones) counts[m.tracking.status] = (counts[m.tracking.status] || 0) + 1;
console.log("tracking:", JSON.stringify(counts));
for (const p of r.problems) console.log(`PROBLEM ${p}`);
for (const w of [...new Set(r.warnings)]) console.log(`WARN ${w}`);
for (const m of r.milestones) {
  const t = m.tracking;
  const interesting = t.status === "disagrees" || t.reached || t.delta || t.status === "unavailable";
  if (!interesting && !args.includes("--all")) continue;
  const what = m.kind === "pass" ? `pass ${m.passing?.player} (${m.scope})` : `${m.target} ${m.label} (${m.scope})`;
  const now = t.current != null ? `now ${t.current}` : "";
  const need = t.need != null ? (t.reached ? "REACHED" : `need ${t.need}`) : "";
  const espnTxt = t.espn ? `ESPN ${t.espn.value}${t.espn.diff ? ` (${t.espn.diff > 0 ? "+" : ""}${t.espn.diff})` : " ✓"}` : "";
  console.log(`${t.status.padEnd(11)} ${m.player}: ${what} ${now} ${need} ${espnTxt}`.replace(/\s+/g, " "));
  if (t.status !== "confirmed") for (const n of t.notes) console.log(`            - ${n}`);
}
