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
// Games tonight that don't count (the NBA Cup final): listed on the Watch List, not tracked.
const uncounted = sb.data.games.filter((g) => g.date === today && g.seasonType === "cup-final").map((g) => ({ id: g.id, start: g.start, home: g.home, away: g.away, note: "NBA Cup final" }));
console.log(`${today}: ${games.length} games`);

const entries = [];
for (const g of games) {
  for (const [team, opp] of [[g.awayTri, g.homeTri], [g.homeTri, g.awayTri]]) {
    if (!team) { console.log(`  unknown team in game ${g.id}`); continue; }
    const r = await checkNotes({ team, date: today, opponent: opp, dataDir });
    const file = r.version ? versionPath(dataDir, team, r.version) : null;
    const buf = file && fs.existsSync(file) ? fs.readFileSync(file) : null;
    console.log(`  ${team.padEnd(3)} notes: ${r.status}${r.why ? ` (${r.why})` : ""}${r.error ? ` (${r.error})` : ""}`);
    entries.push({ team, opp, buf, notes: { status: r.status, why: r.why, error: r.error } });
  }
}
const { site } = await buildSite({ entries, games, uncounted, espn, nba, today, root });
const n = site.teams.reduce((a, t) => a + t.items.length, 0);
console.log(`built: ${site.teams.length} teams, ${n} milestones -> docs/data/watch.json`);

// History lines from tonight's notes (src/notes/narrative.js readHistory): verbatim sentences the
// teams' PR staff wrote ("first rookie since...", "only player in NBA history...", "needs 816 to pass...").
// A player is attached only when the sentence names him. Each line remembers when it was first seen
// (history/notes-facts/<TEAM>.json), so "new" means new in today's notes.
{
  const { readPdf } = await import("../src/notes/pdf-layout.js");
  const { readHistory } = await import("../src/notes/narrative.js");
  const { annotate } = await import("../src/notes/facts.js");
  const modelFile = path.join(root, "src", "data", "fact-model.json");
  const model = fs.existsSync(modelFile) ? JSON.parse(fs.readFileSync(modelFile, "utf8")) : null;
  const { TEAMS } = await import("../src/teams.js");
  // How notes refer to a team besides city and nickname (a sentence that opens with one is about the team).
  const TEAM_ALIASES = { DAL: ["Mavs"], CLE: ["Cavs"], PHI: ["Sixers", "76ers"], MIN: ["Wolves", "Timberwolves"], POR: ["Blazers", "Trail Blazers"], MIA: ["HEAT"], LAC: ["LA Clippers"], GSW: ["Golden State"] };
  const factsDir = path.join(root, "history", "notes-facts");
  fs.mkdirSync(factsDir, { recursive: true });
  const keyOf = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160);
  const teams = {};
  for (const e of entries) {
    if (!e.buf) continue;
    try {
      const tf = path.join(root, "docs", "data", "teams", `${e.team}.json`);
      const box = fs.existsSync(tf) ? JSON.parse(fs.readFileSync(tf, "utf8")) : null; // this season's box scores: who did what, game by game
      const players = box ? Object.entries(box.names || {}).map(([id, name]) => ({ id, name })) : [];
      const seasonStart = `${Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 8 ? 1 : 0)}-10-01`;
      const T = TEAMS[e.team] || {};
      const teamWords = [T.city, T.nick, T.city && T.nick ? `${T.city} ${T.nick}` : null, ...(T.alt || []), ...(TEAM_ALIASES[e.team] || [])].filter(Boolean);
      const O = TEAMS[e.opp] || {};
      const oppWords = [O.city, O.nick, ...(O.alt || []), ...(TEAM_ALIASES[e.opp] || [])].filter(Boolean);
      const doc = await readPdf(e.buf);
      // 0.48: league context, clubs, races and the series too, each read for type, tag, the table beside it and what tonight can change.
      const lines = annotate(readHistory(doc, players, { seasonStart, today, teamWords, oppWords, box }), { doc, box, model, teamNames: [T.city, T.nick, e.team].filter(Boolean) });
      const seenFile = path.join(factsDir, `${e.team}.json`);
      const seen = fs.existsSync(seenFile) ? JSON.parse(fs.readFileSync(seenFile, "utf8")) : {};
      const facts = lines.map((l) => {
        const k = keyOf(l.text);
        seen[k] ??= today;
        const isNew = seen[k] === today;
        const named = l.player && !l.guessed;
        // The learned scorer (src/data/fact-model.json) weighs in: 0.5 is neutral; a live hook (a race, a club to stay in) adds.
        const stale = l.hook?.stale;
        const score = l.score + (isNew ? 1.5 : 0) + (named ? 0.6 : 0) - (/^(?:He|His|She|They|It)\b/.test(l.text) ? 0.8 : 0) + (l.model != null ? 3 * (l.model - 0.5) : 0) + (l.hook?.live ? 0.5 : 0) - (stale ? 3 : 0);
        return { text: l.text, kind: l.kind, player: named ? l.player : null, playerId: named ? l.playerId : null, how: l.how, game: l.boxGame ? { d: l.boxGame.d, opp: l.boxGame.opp } : undefined, when: l.when, isNew, firstSeen: seen[k], score: Math.round(score * 100) / 100,
          type: l.type, tag: l.tag, matchup: l.matchup || undefined, hook: l.hook ? { text: l.hook.text, live: !!l.hook.live, stale: !!stale } : undefined, model: l.model };
      }).sort((a, b) => b.score - a.score);
      // Keep 60 days of first-seen dates.
      const cut = new Date(Date.parse(`${today}T12:00:00Z`) - 60 * 864e5).toISOString().slice(0, 10);
      for (const [k, d] of Object.entries(seen)) if (d < cut) delete seen[k];
      fs.writeFileSync(seenFile, JSON.stringify(seen));
      teams[e.team] = facts.slice(0, 40);
    } catch (err) { console.log(`  ${e.team} history lines: ${err.message}`); }
  }
  fs.writeFileSync(path.join(root, "docs", "data", "notes-facts.json"), JSON.stringify({ generatedAt: site.generatedAt, today, teams }));
  const all = Object.values(teams).flat();
  console.log(`history lines: ${all.length} from ${Object.keys(teams).length} teams' notes (${all.filter((f) => f.isNew).length} new today, ${all.filter((f) => f.player).length} naming a player)`);
}
