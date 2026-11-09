#!/usr/bin/env node
/**
 * Build the Watch List website (GitHub Pages serves the docs/ folder).
 *   node scripts/publish.js samples/2026-11-09/*.pdf [--today YYYY-MM-DD]
 *
 * Writes:
 *   docs/data/watch.json            what the page shows (numbers only: no text
 *                                   copied from the teams' notes is published)
 *   docs/lib/...                    the same parsing code the tests cover, so the
 *                                   page's live countdowns use identical logic
 *   data/predictions-<today>.json   full predictions, kept locally for scoring
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
const { parseNotes } = await import("../src/notes/parse.js");
const { teamFromSlug } = await import("../src/teams.js");
const { createEspn } = await import("../src/espn/client.js");
const { buildWatch } = await import("../src/anticipate/watch.js");
const { etDate } = await import("../src/espn/parse.js");

const args = process.argv.slice(2);
const files = args.filter((a) => a.endsWith(".pdf"));
const today = args.includes("--today") ? args[args.indexOf("--today") + 1] : etDate(new Date().toISOString());
if (!files.length) { console.error("usage: node scripts/publish.js <notes.pdf>... [--today YYYY-MM-DD]"); process.exit(2); }

const espn = createEspn({ dataDir: path.join(root, "data") });
const reports = [], teams = [];
for (const f of files) {
  const team = teamFromSlug(path.basename(f, ".pdf"));
  const parsed = await parseNotes(fs.readFileSync(f), { team });
  const w = await buildWatch({ team, notesDate: parsed.meta.gameDate, milestones: parsed.milestones, espn, today });
  reports.push({ ...w, opponent: parsed.meta.opponent });
  teams.push({
    team, opponent: parsed.meta.opponent, notesDate: parsed.meta.gameDate, tonightGame: w.tonightGame,
    problems: w.problems,
    items: w.items.map((i) => ({
      player: i.player, espnId: i.espnId, stat: i.stat, label: i.label, kind: i.kind, scope: i.scope,
      target: i.target, current: i.current, need: i.need,
      passing: i.passing ? { player: i.passing.player, rank: i.passing.rank ?? null } : null,
      importance: i.importance, why: i.why,
      publishable: i.publishable, status: i.status, review: i.checks, tracking: i.tracking,
      pTonight: i.pTonight ?? null, pNext3: i.pNext3 ?? null, pNext5: i.pNext5 ?? null, eta: i.eta ?? null,
      pPlayTonight: i.pPlayTonight ?? null,
      injury: i.injury ? { status: i.injury.status, returnDate: i.injury.returnDate } : null,
      confidence: i.confidence ?? null, games: i.form?.games ?? null,
      reached: !!i.reached, stale: !!i.stale, note: i.note ?? null,
    })),
  });
  console.log(`${team}: ${w.items.length} milestones${w.tonightGame ? `, plays tonight (${w.tonightGame.id})` : ""}`);
}

const docs = path.join(root, "docs");
fs.mkdirSync(path.join(docs, "data"), { recursive: true });
fs.writeFileSync(path.join(docs, "data", "watch.json"), JSON.stringify({ generatedAt: new Date().toISOString(), today, teams }));
// Same code the tests cover, for the page's live countdowns.
for (const rel of ["teams.js", "notes/names.js", "espn/parse.js", "registry/track.js"]) {
  const dst = path.join(docs, "lib", rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(root, "src", rel), dst);
}
fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.writeFileSync(path.join(root, "data", `predictions-${today}.json`), JSON.stringify({ today, reports }, null, 1));
console.log(`wrote docs/data/watch.json and data/predictions-${today}.json`);
