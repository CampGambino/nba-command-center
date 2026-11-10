#!/usr/bin/env node
/**
 * Build the website from notes PDFs on disk (GitHub Pages serves docs/).
 *   node scripts/publish.js samples/2026-11-09/*.pdf [--today YYYY-MM-DD]
 * For tonight's whole slate, downloaded automatically, use scripts/tonight.js.
 * Writes docs/data/watch.json (numbers only: no text from the notes),
 * docs/lib/ (shared code for live countdowns) and data/predictions-<today>.json.
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
const { teamFromSlug } = await import("../src/teams.js");
const { createEspn } = await import("../src/espn/client.js");
const { createNbaStatic } = await import("../src/nba/static.js");
const { etDate } = await import("../src/espn/parse.js");
const { buildSite } = await import("../src/site/build.js");

const args = process.argv.slice(2);
const files = args.filter((a) => a.endsWith(".pdf"));
const today = args.includes("--today") ? args[args.indexOf("--today") + 1] : etDate(new Date().toISOString());
if (!files.length) { console.error("usage: node scripts/publish.js <notes.pdf>... [--today YYYY-MM-DD]"); process.exit(2); }

const espn = createEspn({ dataDir: path.join(root, "data") });
const nba = createNbaStatic({ dataDir: path.join(root, "data") });
const sb = await espn.scoreboard(today);
const entries = files.map((f) => ({ team: teamFromSlug(path.basename(f, ".pdf")), buf: fs.readFileSync(f) }));
const teamsHere = new Set(entries.map((e) => e.team));
const games = sb.ok ? sb.data.games.filter((g) => teamsHere.has(g.homeTri) || teamsHere.has(g.awayTri)) : [];
const { site } = await buildSite({ entries, games, espn, nba, today, root });
for (const t of site.teams) console.log(`${t.team}: ${t.items.length} milestones`);
console.log(`wrote docs/data/watch.json and data/predictions-${today}.json`);
