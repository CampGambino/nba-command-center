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
const { checkNotes, versionPath, misprintedDate } = await import("../src/notes/watcher.js");
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
    let r = await checkNotes({ team, date: today, opponent: opp, dataDir });
    // 0.163.0: tonight's opponent under a date the team didn't play them on is a misprinted date, not an old file
    if (r.status === "stale") {
      try { const tf = path.join(root, "docs", "data", "teams", `${team}.json`); r = misprintedDate(r, { date: today, opponent: opp, games: fs.existsSync(tf) ? JSON.parse(fs.readFileSync(tf, "utf8")).games : null }); }
      catch (err) { console.log(`  ${team} date check: ${err.message}`); }
    }
    const file = r.version ? versionPath(dataDir, team, r.version) : null;
    const buf = file && fs.existsSync(file) ? fs.readFileSync(file) : null;
    console.log(`  ${team.padEnd(3)} notes: ${r.status}${r.why ? ` (${r.why})` : ""}${r.error ? ` (${r.error})` : ""}`);
    entries.push({ team, opp, home: team === g.homeTri, buf, notes: { status: r.status, why: r.why, error: r.error, gameDate: r.meta?.gameDate || null, ...(r.misprint ? { misprint: r.misprint } : {}) } });
  }
}
// 0.140: the milestone chances' recalibration, fitted to every scored call on file (history/calls.jsonl).
const { fitCalibration, readCalls } = await import("../src/anticipate/calibrate.js");
const callsFile = path.join(root, "history", "calls.jsonl");
const calibration = fitCalibration(readCalls(fs.existsSync(callsFile) ? fs.readFileSync(callsFile, "utf8") : ""));
fs.writeFileSync(path.join(root, "docs", "data", "calibration.json"), JSON.stringify({ generatedAt: new Date().toISOString(), today, fit: calibration }));
console.log(calibration ? `calibration: a=${calibration.a} b=${calibration.b} from ${calibration.n} scored calls (50% -> ${Math.round(100 / (1 + Math.exp(-calibration.a)))}%)` : "calibration: too few scored calls yet, chances left as simulated");
const { site } = await buildSite({ entries, games, uncounted, espn, nba, today, root, calibration, injuryFetch: globalThis.fetch });
const n = site.teams.reduce((a, t) => a + t.items.length, 0);
console.log(`built: ${site.teams.length} teams, ${n} milestones -> docs/data/watch.json`);
const off = site.teams.flatMap((t) => t.offCadence || []);
if (off.length) console.log(`round numbers off the spacing (dropped): ${off.length}`);

// History lines from tonight's notes (src/notes/narrative.js readHistory): verbatim sentences the
// teams' PR staff wrote ("first rookie since...", "only player in NBA history...", "needs 816 to pass...").
// A player is attached only when the sentence names him. Each line remembers when it was first seen
// (history/notes-facts/<TEAM>.json), so "new" means new in today's notes.
{
  const { readPdf } = await import("../src/notes/pdf-layout.js");
  const { whoseNotes } = await import("../src/notes/meta.js");
  const { readHistory } = await import("../src/notes/narrative.js");
  const { annotate, trimLines, staleCount, staleReach, checkGamesPlayed, closedEvent, agedShare, SHELF, reach, farShare } = await import("../src/notes/facts.js");
  // 0.146.0: every active games-played run, as the last build counted it (docs/data/featlive.json, through last night)
  let gpRuns = null;
  try { gpRuns = JSON.parse(fs.readFileSync(path.join(root, "docs", "data", "featlive.json"), "utf8")).gpRuns || null; } catch { /* first build: no check */ }
  const { readCoachRecord, coachLine, fromTenures } = await import("../src/notes/formats/coach-record.js");
  const ctf = path.join(root, "src", "data", "coach-tenures.json");
  const coachTenures = fs.existsSync(ctf) ? JSON.parse(fs.readFileSync(ctf, "utf8")).coaches || {} : {};
  // Every regular-season game we hold (2016-17 on, and this season's store as the last build left it), read once if needed.
  let coachGamesCache = null;
  const coachGames = async () => {
    if (coachGamesCache) return coachGamesCache;
    const out = [];
    try {
      const H = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-results-history.json"), "utf8"));
      const { CUP_TITLE_DATES: CUP } = await import("../src/situations/results.js");   // Cup title games count in no record (one list since 0.141.6)
      for (const r of H.games) if (r[5] === 2 && !CUP.has(r[0])) out.push({ d: r[0], h: r[1], a: r[2], hs: r[3], as: r[4] });
      const { loadStore, allGames } = await import("../src/situations/results.js");
      const { cupFinal } = await import("../src/situations/standings.js");
      const rows = allGames(loadStore(path.join(root, "history", "results"), fs)), cup = cupFinal(rows);
      for (const g of rows) if (g !== cup) out.push({ d: g.d, h: g.h, a: g.a, hs: g.hs, as: g.as });
    } catch (err) { console.log(`  coach games not read: ${err.message}`); }
    return (coachGamesCache = out);
  };
  const modelFile = path.join(root, "src", "data", "fact-model.json");
  const model = fs.existsSync(modelFile) ? JSON.parse(fs.readFileSync(modelFile, "utf8")) : null;
  const { TEAMS } = await import("../src/teams.js");
  // How notes refer to a team besides city and nickname (a sentence that opens with one is about the team).
  const TEAM_ALIASES = { DAL: ["Mavs"], CLE: ["Cavs"], PHI: ["Sixers", "76ers"], MIN: ["Wolves", "Timberwolves"], POR: ["Blazers", "Trail Blazers"], MIA: ["HEAT"], LAC: ["LA Clippers"], GSW: ["Golden State"] };
  // 0.71: each player's past seasons (the NBA Guide's rows), to date a "within his first N seasons" fact.
  let careers = null;
  try {
    const { strictKey } = await import("../src/records/guide.js");
    const tag = `${Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 8 ? 1 : 0)}-${String(Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) < 8 ? 0 : 1)).slice(2)}`;
    const cf = path.join(root, "src", "data", `nba-career-seasons-${tag}.json`);
    if (fs.existsSync(cf)) {
      const cs = JSON.parse(fs.readFileSync(cf, "utf8"));
      const si = cs.keys.indexOf("season");
      const byKey = new Map(Object.entries(cs.players).map(([n, rows]) => [strictKey(n), [...new Set(rows.map((r) => r[si]).filter((x) => x < tag))].sort()]));
      careers = new Proxy({}, { get: (_, name) => byKey.get(strictKey(String(name))) });
    }
  } catch (e) { console.error(`career seasons not read: ${e.message}`); }
  const factsDir = path.join(root, "history", "notes-facts");
  fs.mkdirSync(factsDir, { recursive: true });
  const keyOf = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160);
  const bagOf = (k) => k.split(" ").sort().join(" ");
  const teams = {}, trimmedBy = {}, status = {};
  // Every team playing tonight is listed, with or without lines, so the page shows each one was checked (0.49).
  for (const e of entries) status[e.team] = { opp: e.opp, home: e.home, notes: e.notes.status, why: e.notes.why || e.notes.error || null, read: !!e.buf };
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
      // 0.158.0: whose notes are these? On 11/25 the NBA's link for the Cavaliers' notes held the Knicks' file: it was read
      // as Cleveland's, gave no lines, and the page said only "notes read · No lines kept". Count each roster's players
      // named in the file: when the opponent's far outnumber the team's own, say so and read nothing from it.
      try {
        const of = path.join(root, "docs", "data", "teams", `${e.opp}.json`);
        const oppBox = fs.existsSync(of) ? JSON.parse(fs.readFileSync(of, "utf8")) : null;
        const whose = whoseNotes(doc, Object.values(box?.names || {}), Object.values(oppBox?.names || {}));
        if (whose.wrong) {
          status[e.team] = { ...status[e.team], notes: "wrong file", why: `the NBA's link for ${e.team}'s notes holds ${e.opp}'s file (it names ${whose.opp} ${e.opp} players and ${whose.own} of ${e.team}'s)`, read: false };
          console.log(`  ${e.team}: ${status[e.team].why}; not read`);
          teams[e.team] = []; trimmedBy[e.team] = [];
          continue;
        }
      } catch (err) { console.log(`  ${e.team} whose-notes check: ${err.message}`); }
      // 0.48: league context, clubs, races and the series too, each read for type, tag, the table beside it and what tonight can change.
      const hist = readHistory(doc, players, { seasonStart, today, teamWords, oppWords, box });
      // 0.76: the head coach's record against tonight's opponent, from the "ALL-TIME RECORD VS. THE NBA" table (only when
      // the table reads whole and adds up to his career record).
      try {
        let crec = readCoachRecord(doc);
        // 0.83: no table by opponent in his notes: count it from our results if we know his teams and it adds up.
        if (crec && !crec.ok && coachTenures[crec.coach]) crec = fromTenures(crec, coachTenures[crec.coach].tenures, await coachGames(), today);
        const cl = coachLine(crec, e.opp);
        if (cl) hist.push({ page: null, text: cl, kind: "context", player: null, playerId: null, team: true, matchup: true, how: "team", resolved: false, boxGame: null, when: "season", score: 2.6 });
      } catch (err) { console.log(`  ${e.team} coach record: ${err.message}`); }
      const read = checkGamesPlayed(annotate(hist, { doc, box, model, teamNames: [T.city, T.nick, e.team].filter(Boolean), careers }), gpRuns);   // 0.146.0
      // 0.49: closed past one-offs, filler, the other venue's stats and layout-garbled lines are trimmed (listed on the page).
      const { keep: lines, trimmed } = trimLines(read, { box, today, home: e.home, opp: e.opp });
      trimmedBy[e.team] = trimmed.map((l) => ({ text: l.text, player: l.player && !l.guessed ? l.player : null, why: l.trimmed }));
      const seenFile = path.join(factsDir, `${e.team}.json`);
      const seen = fs.existsSync(seenFile) ? JSON.parse(fs.readFileSync(seenFile, "utf8")) : {};
      const facts = lines.map((l) => {
        const k = keyOf(l.text);
        // 0.157.0: the same words in another order aren't a new line. Phoenix's "(Nov. 2 and Nov. Season 4)" on 11/25 was a
        // line first read 11/16 with a table's word spliced in at a different place: marked new, it went to the top.
        if (!(k in seen)) { const bag = bagOf(k), twin = Object.keys(seen).find((x) => x.length === k.length && bagOf(x) === bag); if (twin) seen[k] = seen[twin]; }
        // 0.159.0: nor is a line whose only change is an ordinal ending the reader now keeps ("ranks 6 among NBA centers"
        // is "ranks 6th among…" from today; "23 player in NBA history" is "23rd player").
        if (!(k in seen) && /\d(?:st|nd|rd|th)\b/.test(k)) { const bare = (x) => x.replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "$1"), mine = bare(k);
          const twin = Object.keys(seen).find((x) => { const y = bare(x), n = Math.min(mine.length, y.length, 150); return n >= 30 && Math.abs(mine.length - y.length) <= 10 && mine.slice(0, n) === y.slice(0, n); }); if (twin) seen[k] = seen[twin]; }
        // 0.163.0: nor one whose only change is a table label getting its "3-" back ("Pointers Made 42 3PM" is
        // "3-Pointers Made 42 3PM" from today): the old key is this one with some "3" tokens missing.
        if (!(k in seen) && /\b3 point/.test(k)) { const mine = k.split(" ");
          const twin = Object.keys(seen).find((x) => { const y = x.split(" "); let i = 0, j = 0, skipped = 0;
            while (i < mine.length && j < y.length) {
              if (mine[i] === y[j]) { i++; j++; } else if (mine[i] === "3" && skipped < 4) { i++; skipped++; }
              else if ((i === mine.length - 1 || j === y.length - 1) && (mine[i].startsWith(y[j]) || y[j].startsWith(mine[i]))) break;   // a key is cut at 160 characters, mid-word
              else return false; }
            return skipped > 0 && j >= 8; }); if (twin) seen[k] = seen[twin]; }
        // 0.163.0: a line the old duplicate rule folded into another (same tag, alike words, another bar: "first career 15+
        // point/5+ assist half" under "first 30+ point/5+ assist game") was never on file, so on the first build under
        // the new rule it read as new and went to the top of its game (Minnesota, 11/25). Until every team has played
        // once under the rule, it is dated like the line it was folded into. Removable after 12/5/26.
        if (!(k in seen) && l.kin && today <= "2026-12-05") { const kk = keyOf(l.kin); if (kk in seen) seen[k] = seen[kk]; }
        seen[k] ??= today;
        const isNew = seen[k] === today;
        if (!isNew) staleCount(l, seen[k], box);   // 0.113: a streak count printed unchanged while games went by
        // 0.182.0: a countdown in the notes of an earlier game, against what he has done in that game and since
        if (e.notes.status === "stale" && e.notes.gameDate && e.notes.gameDate < today) staleReach(l, e.notes.gameDate, box);
        const named = l.player && !l.guessed;
        // The learned scorer (src/data/fact-model.json) weighs in: 0.5 is neutral; a live hook (a race, a club to stay in) adds.
        const stale = l.hook?.stale;
        // 0.157.0 (the user, 11/25: "a balance in time … and how important it is"): a dated happening that is over loses
        // rank as it ages through its shelf life (src/notes/facts.js SHELF), and its "new today" lift with it.
        const ev = closedEvent(l, { box, today }), old = agedShare(ev);
        const raw = l.score + (isNew ? 1.5 * (1 - old) : 0) + (named ? 0.6 : 0) - (/^(?:He|His|She|They|It)\b/.test(l.text) ? 0.8 : 0) + (l.model != null ? 3 * (l.model - 0.5) : 0) + (l.hook?.live ? 0.5 : 0) - (stale ? 3 : 0);
        // 0.159.0: a countdown far from its mark ranks lower, by how many games off it is at his rate this season
        // (the page's own milestone lines are ranked by the chance tonight; a notes countdown had no such measure).
        const rc = reach(l, { box }), far = farShare(rc);
        // Importance against time, as in 0.157.0: a chase the scorer rates so far above the storylines' 4.8 ceiling that it
        // would still be at it (Durant's 658 points from Kobe Bryant, 6.9; Thompson's 14 threes from Ray Allen, 8.1) keeps
        // its score and its place; an ordinary round number far off (Portis, 5.5 -> 4.1) loses the distance.
        const aged = old > 0 ? Math.min(raw, 4.8) - SHELF.penalty * old : raw;   // 4.8: the most a notes line counts for on the Watch List
        const score = far > 0 && aged - far < 4.8 ? aged - far : aged;
        return { aged: old > 0 ? { age: ev.age, days: ev.days, why: ev.why } : undefined, reach: far > 0 ? { ...rc, far, ...(score === aged ? { kept: true } : {}) } : undefined, text: l.text, kind: l.kind, player: named ? l.player : null, playerId: named ? l.playerId : null, how: l.how, game: l.boxGame ? { d: l.boxGame.d, opp: l.boxGame.opp } : undefined, when: l.when, isNew, firstSeen: seen[k], score: Math.round(score * 100) / 100,
          type: l.type, tag: l.tag, matchup: l.matchup || undefined, gpCheck: l.gpCheck || undefined, hook: l.hook ? { text: l.hook.text, live: !!l.hook.live, stale: !!stale } : undefined, model: l.model, kept: l.kept };
      }).sort((a, b) => b.score - a.score);
      // Keep 60 days of first-seen dates.
      const cut = new Date(Date.parse(`${today}T12:00:00Z`) - 60 * 864e5).toISOString().slice(0, 10);
      for (const [k, d] of Object.entries(seen)) if (d < cut) delete seen[k];
      fs.writeFileSync(seenFile, JSON.stringify(seen));
      teams[e.team] = facts.slice(0, 40);
    } catch (err) { console.log(`  ${e.team} history lines: ${err.message}`); status[e.team].error = err.message; }
  }
  for (const t of Object.keys(status)) teams[t] ??= [];
  fs.writeFileSync(path.join(root, "docs", "data", "notes-facts.json"), JSON.stringify({ generatedAt: site.generatedAt, today, teams, trimmed: trimmedBy, status }));
  console.log(`trimmed: ${Object.values(trimmedBy).flat().length} lines (${Object.entries(Object.values(trimmedBy).flat().reduce((a, l) => { const k = l.why.replace(/ \(.*$/, ""); a[k] = (a[k] || 0) + 1; return a; }, {})).map(([k, n]) => `${n} ${k}`).join(", ")})`);
  const all = Object.values(teams).flat();
  console.log(`history lines: ${all.length} from ${Object.keys(teams).length} teams' notes (${all.filter((f) => f.isNew).length} new today, ${all.filter((f) => f.player).length} naming a player)`);
}
