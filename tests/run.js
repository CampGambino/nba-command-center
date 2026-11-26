#!/usr/bin/env node
/**
 * Test suite. Runs offline against the saved sample notes in samples/.
 *
 *   node tests/run.js            run everything
 *   node tests/run.js --update   accept the current parser output as the new
 *                                snapshot (only after reviewing the diff!)
 *
 * Two kinds of test:
 *   1. FACTS - hand-checked against the PDFs. These are the truth; a failure
 *      means the parser is wrong.
 *   2. SNAPSHOT - everything the parser finds, saved in tests/expected/. Any
 *      change (a milestone appearing, disappearing or changing) is listed so
 *      no change to the output goes unnoticed.
 */
import os from "node:os";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseNotes } from "../src/notes/parse.js";
import { teamFromSlug, teamFromCode } from "../src/teams.js";
import { normStat, statFromTitle, num, isDecimal, looksLikeThousandsTypo } from "../src/notes/stats.js";
import { sameName, nameKey, looksLikeNameHeading } from "../src/notes/names.js";
import { etDate, readCareer } from "../src/espn/parse.js";
import { createEspn } from "../src/espn/client.js";
import { trackMilestones, statFromLine } from "../src/registry/track.js";
import { makeSampler, simulate, rng } from "../src/anticipate/model.js";
import { importance } from "../src/anticipate/importance.js";
import { buildWatch, rank } from "../src/anticipate/watch.js";
import { discoverMilestones } from "../src/registry/discover.js";
import { readLineups, readMovement, standing, slugOf } from "../src/nba/movement.js";
import { repairToUnicode } from "../src/notes/pdf-repair.js";
import { dropShadowLayer } from "../src/notes/pdf-layout.js";
import { computeSituations, teamGames } from "../src/situations/records.js";
import { rowFromGame, collectResults, allGames } from "../src/situations/results.js";
import { readScoreboard, readGameDetail, clockSeconds, readPlayerBox, readSchedule, isCupFinal, CUP_FINAL } from "../src/espn/parse.js";
import { teamGameLines, offense, ratings, vsTopDefenses, vsTop } from "../src/situations/ratings.js";
import { tonightStorylines, discordDigest, MIN_IMPORTANCE } from "../src/anticipate/tonight.js";
import { readHistory } from "../src/notes/narrative.js";
import { parseReport, slotUrl, slotsBackFrom, displayName, shortReason } from "../src/injuries/report.js";
import { injuryImpacts, matchId } from "../src/injuries/impact.js";
import { articlesChecks } from "./articles-worker.js";
import { contractChecks } from "./contracts.js";
import { bridgeChecks } from "./bridge.js";
import { teamGames as leaderGames, gameLeaders, seasonLeaders, shooting, cushion, needed } from "../src/situations/leaders.js";
import { clutchPlayers, windowPlayers, WINDOWS, CLUTCH_KEYS } from "../src/espn/pbp.js";
import { roster, withWithout } from "../src/situations/withwithout.js";
import { playerGames, activeStreaks, teamStreaks, anomalies } from "../src/situations/trends.js";
import { loadStore, saveStore } from "../src/situations/results.js";
import { clutchPlayerTotals, clutchTeamTotals } from "../src/situations/clutch.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPDATE = process.argv.includes("--update");
let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name, detail = "") => {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ` -- ${detail}` : ""}`); }
};

// ---------- unit checks (no PDFs) ----------
ok(normStat("3FG") === "fg3m" && normStat("3PT") === "fg3m" && normStat("Three-pointers") === "fg3m", "stat names: threes");
ok(normStat("DBL-DBL") === "dd" && normStat("GP") === "gp" && normStat("DREB") === "dreb", "stat names: misc");
ok(statFromTitle("POINTS (7-10 RANKING)") === "pts", "title stat: points with ranking");
ok(statFromTitle("# OF 20-PT GAMES") === "g20pt", "title stat: 20-point games");
ok(statFromTitle("SPURS, CONSECUTIVE GAMES W/ A 3-POINTER") === "list", "title stat: compound list kept as list");
ok(statFromTitle("3- POINTERS MADE") === "fg3m", "title stat: '3- POINTERS'");
// num() reads what is printed; the "1.944 for 1,944" typo is fixed only inside a
// comma-formatted list (leaderboards.js), and then flagged for review.
ok(num("1,944") === 1944 && num("1.944") === 1.944 && num("29.4") === 29.4, "numbers: plain reading");
ok(looksLikeThousandsTypo("1.944") && !looksLikeThousandsTypo("29.4") && !looksLikeThousandsTypo(".853") && isDecimal(".853") && !isDecimal("1,944"), "numbers: thousands typo vs decimal");
ok(sameName("D. MITCHELL", "Donovan Mitchell") && !sameName("J. Allen", "Ray Allen"), "names: initial matching");
ok(nameKey("Luka Dončić") === "luka doncic", "names: accents");
ok(looksLikeNameHeading("JARRETT ALLEN") && looksLikeNameHeading("#40 HARRISON BARNES") && !looksLikeNameHeading("REGULAR SEASON MILESTONES"), "names: headings");

// ---------- sample notes ----------
// The teams' notes PDFs are the NBA's documents and stay off the public repo (.gitignore), so on GitHub's servers
// the checks that read them are skipped and said to be (0.141.4). Everything else runs everywhere.
const HAVE_SAMPLES = fs.existsSync(path.join(root, "samples", "2026-11-09"));
if (!HAVE_SAMPLES) console.log("notes PDFs (samples/) not on this machine: the checks that read them are skipped");
const sampleDir = path.join(root, "samples", "2026-11-09");
const results = {};
for (const f of (HAVE_SAMPLES ? fs.readdirSync(sampleDir) : []).filter((f) => f.endsWith(".pdf"))) {
  const team = teamFromSlug(path.basename(f, ".pdf"));
  results[team] = await parseNotes(fs.readFileSync(path.join(sampleDir, f)), { team });
}

const find = (team, player, stat, extra = {}) =>
  results[team]?.milestones.find((m) => sameName(m.player || "", player) && m.stat === stat && Object.entries(extra).every(([k, v]) => (k === "passing" ? sameName(m.passing?.player || "", v) : m[k] === v)));

function fact(name, m, expect) {
  if (!m) return ok(false, name, "not found");
  for (const [k, v] of Object.entries(expect)) ok(m[k] === v, `${name}: ${k}`, `expected ${v}, got ${m[k]}`);
}
if (HAVE_SAMPLES) { // needs the notes PDFs (samples/): skipped where they are not, e.g. on GitHub

// Front-page facts: which game these notes are for.
for (const [team, opp] of [["CLE", "CHA"], ["CHA", "CLE"], ["LAL", "ATL"], ["ATL", "LAL"], ["SAS", "PHX"], ["PHX", "SAS"]]) {
  ok(results[team]?.meta.gameDate === "2026-11-09", `${team} notes date`, `got ${results[team]?.meta.gameDate}`);
  ok(results[team]?.meta.opponent === opp, `${team} notes opponent`, `got ${results[team]?.meta.opponent}`);
}

// Front pages of tonight's other notes (downloaded 2026-11-09): date and opponent only,
// their milestone layouts are not hand-checked yet.
ok(teamFromCode("HOU - 11/9/26") === "HOU" && teamFromCode("GS") === "GSW" && teamFromCode("UTAH") === "UTA" && teamFromCode("PM") === null && teamFromCode("Houston") === null, "teams: codes at the start of a phrase");
{
  const slate = path.join(root, "samples", "2026-11-09-slate");
  const expect = { nuggets: ["DEN", "HOU"], pacers: ["IND", "DAL"], rockets: ["HOU", "DEN"], mavericks: ["DAL", "IND"], pistons: ["DET", "WAS"], wizards: ["WAS", "DET"], grizzlies: ["MEM", "TOR"], raptors: ["TOR", "MEM"], pelicans: ["NOP", "GSW"], warriors: ["GSW", "NOP"] };
  if (!fs.existsSync(slate)) ok(false, "slate samples missing (samples/2026-11-09-slate)");
  else for (const [slug, [team, opp]] of Object.entries(expect)) {
    const f = path.join(slate, `${slug}.pdf`);
    if (!fs.existsSync(f)) { ok(false, `${team} slate notes missing`); continue; }
    const m = (await parseNotes(fs.readFileSync(f), { team })).meta;
    ok(m.gameDate === "2026-11-09", `${team} notes date (new layout)`, `got ${m.gameDate}`);
    ok(m.opponent === opp, `${team} notes opponent`, `got ${m.opponent}`);
  }
}

{
  // 2026-11-10's notes as downloaded that morning: more date layouts (no year, no space after
  // the comma, a space before it), and two teams whose notes were still from an earlier game.
  const slate = path.join(root, "samples", "2026-11-10-slate");
  const expect = { bucks: ["MIL", "2026-11-10", "NYK"], knicks: ["NYK", "2026-11-10", "MIL"], kings: ["SAC", "2026-11-10", "ORL"], "trail-blazers": ["POR", "2026-11-10", "OKC"], blazers: ["POR", "2026-11-10", "OKC"], thunder: ["OKC", "2026-11-07", null], suns: ["PHX", "2026-11-09", "SAS"], "76ers": ["PHI", "2026-11-10", "BOS"], sixers: ["PHI", "2026-11-10", "BOS"], jazz: ["UTA", "2026-11-10", "MIA"], celtics: ["BOS", "2026-11-10", "PHI"] };
  if (!fs.existsSync(slate)) ok(false, "slate samples missing (samples/2026-11-10-slate)");
  else for (const [slug, [team, date, opp]] of Object.entries(expect)) {
    const f = path.join(slate, `${slug}.pdf`);
    if (!fs.existsSync(f)) continue; // slug spellings vary; at least one of each pair exists
    const m = (await parseNotes(fs.readFileSync(f), { team })).meta;
    ok(m.gameDate === date, `${team} notes date (2026-11-10 slate)`, `got ${m.gameDate}`);
    if (opp) ok(m.opponent === opp, `${team} notes opponent (2026-11-10 slate)`, `got ${m.opponent}`);
  }
  const n = fs.existsSync(slate) ? fs.readdirSync(slate).length : 0;
  ok(n >= 11, "2026-11-10 slate samples present", `${n} files`);
}

// Cleveland: "target STAT (current) Needs N" under name headings.
fact("CLE Allen 4,000 DREB", find("CLE", "Jarrett Allen", "dreb", { target: 4000 }), { current: 3997, need: 3, status: "ok" });
fact("CLE Mitchell 3,000 AST", find("CLE", "Donovan Mitchell", "ast", { target: 3000 }), { current: 2984, need: 16, status: "ok" });
fact("CLE Mitchell 200 BLK", find("CLE", "Donovan Mitchell", "blk", { target: 200 }), { current: 198, need: 2, status: "ok" });
fact("CLE Harden 30,000 PTS", find("CLE", "James Harden", "pts", { target: 30000 }), { current: 29496, need: 504, status: "ok" });
// The notes' own arithmetic is wrong here; these must be held for review.
fact("CLE Allen 6,000 REB (notes say needs 225, it's 223)", find("CLE", "Jarrett Allen", "reb", { target: 6000 }), { need: 223, status: "review" });
fact("CLE Harden 3,500 3FG (notes say needs 585, it's 85)", find("CLE", "James Harden", "fg3m", { target: 3500 }), { need: 85, status: "review" });
// A misprinted leaderboard (Chones 3,790 listed below Allen 3,421) must be flagged.
ok(results.CLE.leaderboards.some((lb) => lb.checks.some((c) => /Chones/.test(c) && /3790/.test(c))), "CLE rebounds list order error flagged");
fact("CLE Harden passes Korver in NBA games played", find("CLE", "James Harden", "gp", { kind: "pass", passing: "Kyle Korver" }), { need: 2, scope: "nba" });
fact("CLE Harden passes Iverson in 30-point games", find("CLE", "James Harden", "g30pt", { kind: "pass", passing: "Allen Iverson" }), { need: 2, scope: "nba", status: "ok" });
// Audit defect 1: these sit under "NBA ALL-TIME HISTORY FOR HARDEN", not a sidebar.
fact("CLE Harden passes Curry in NBA 3PM (not Cavs history)", find("CLE", "James Harden", "fg3m", { kind: "pass", passing: "Stephen Curry" }), { need: 872, scope: "nba" });
// Audit defect 7: "12. P. Hubbard / 12. D. MITCHELL / 13. S. Kemp" (rank printed twice).
fact("CLE Mitchell vs Hubbard in FTM held (rank printed twice)", find("CLE", "Donovan Mitchell", "ftm", { kind: "pass", passing: "P. Hubbard" }), { need: 8, status: "review" });
// "1.944" printed for Kobe's 1,944 steals.
ok(results.CLE.leaderboards.some((lb) => lb.rows.some((r) => r.player === "Kobe Bryant" && r.total === 1944) && lb.checks.some((c) => /1\.944/.test(c))), "CLE '1.944' read as 1,944 and flagged");
ok(!results.CLE.milestones.some((m) => /^[A-Z. ]+$/.test(m.player || "")), "CLE player names shown in normal case");

// Lakers: wide tracker table, accented names.
fact("LAL Doncic 1,700 3PM", find("LAL", "Luka Dončić", "fg3m", { kind: "round" }), { current: 1684, target: 1700, need: 16, status: "ok" });
ok(find("LAL", "Luka Dončić", "fg3m", { kind: "round" })?.ranks?.nba?.rank === 41, "LAL Doncic 3PM NBA rank 41");
fact("LAL Doncic 250 blocks", find("LAL", "Luka Dončić", "blk", { kind: "round" }), { current: 243, need: 7 });
fact("LAL Looney 1,000 assists", find("LAL", "Kevon Looney", "ast", { kind: "round" }), { current: 991, need: 9 });
fact("LAL Sexton 400 steals", find("LAL", "Collin Sexton", "stl", { kind: "round" }), { current: 398, need: 2 });
// Two lists side by side under different headings: NBA (left) vs Lakers (right).
fact("LAL Doncic passes Steve Nash in NBA 3PM", find("LAL", "Luka Dončić", "fg3m", { kind: "pass", passing: "Steve Nash" }), { need: 2, scope: "nba" });
fact("LAL Doncic passes Metta World Peace in Lakers 3PM", find("LAL", "Luka Dončić", "fg3m", { kind: "pass", passing: "Metta World Peace" }), { current: 408, need: 13, scope: "franchise" });
// Rounded averages are never publishable as a "gap" (Doncic 29.4 vs Wilt 30.1, Jordan also 30.1).
ok(results.LAL.milestones.filter((m) => m.kind === "average-gap").length > 0 && results.LAL.milestones.filter((m) => m.kind === "average-gap").every((m) => m.status === "review"), "LAL per-game average gaps held for review");
// "T-4. Luka Dončić (1)" rows are read (50- and 60-point game lists).
ok(results.LAL.leaderboards.some((lb) => lb.rows.some((r) => /Don/.test(r.player) && r.tied && r.total === 4)), "LAL tied 'T-4.' rows read");
ok(results.LAL.problems.length === 0, "LAL tracker rows all read", JSON.stringify(results.LAL.problems.slice(0, 2)));
ok(new Set(results.LAL.milestones.filter((m) => m.sources[0].format === "tracker-table").map((m) => m.player)).size === 18, "LAL tracker: all 18 players");

// San Antonio: "STAT: target current" under "#NN NAME".
fact("SAS Barnes 15,000 PTS", find("SAS", "Harrison Barnes", "pts", { target: 15000 }), { current: 14613, need: 387 });
fact("SAS Wembanyama 700 BLK", find("SAS", "Victor Wembanyama", "blk", { target: 700 }), { current: 666, need: 34 });
fact("SAS Vassell 800 3PT", find("SAS", "Devin Vassell", "fg3m", { target: 800 }), { current: 798, need: 2 });
fact("SAS Fox 3,600 AST already passed (stale notes)", find("SAS", "De’Aaron Fox", "ast", { target: 3600 }), { status: "review" });
ok(results.SAS.milestones.filter((m) => m.scope === "streak" || m.scope === "season-record").every((m) => m.status === "review"), "SAS streak/single-season chases held for review");
// Audit defect 2: "CAREER BENCH SCORING" is bench points only, not career points.
const keldonRose = results.SAS.milestones.find((m) => sameName(m.player, "Keldon Johnson") && sameName(m.passing?.player || "", "Malik Rose"));
ok(!keldonRose || (keldonRose.stat !== "pts" && keldonRose.status === "review"), "SAS bench-scoring list is not plain career points", JSON.stringify(keldonRose && { stat: keldonRose.stat, status: keldonRose.status }));

// Phoenix: "PLAYER: target Stat (current)" inline tracker.
fact("PHX Booker 19,000 points", find("PHX", "Devin Booker", "pts", { target: 19000 }), { current: 18322, need: 678 });
fact("PHX Booker 3,000 rebounds", find("PHX", "Devin Booker", "reb", { target: 3000 }), { current: 2988, need: 12 });
fact("PHX Booker 4,000 assists", find("PHX", "Devin Booker", "ast", { target: 4000 }), { current: 3947, need: 53 });
fact("PHX Ighodaro 100 blocks", find("PHX", "Oso Ighodaro", "blk", { target: 100 }), { current: 91, need: 9 });

// Atlanta: bare-rank franchise lists ("11  ONYEKA OKONGWU  416").
fact("ATL Okongwu passes Kevin Willis in Hawks blocks", find("ATL", "Onyeka Okongwu", "blk", { kind: "pass", passing: "Kevin Willis" }), { need: 10, scope: "franchise", status: "ok" });
// Audit defect 2: subset lists (Hawks centers, 2020 draft class) are never published as plain totals.
for (const who of ["Clint Capela", "Jon Koncak", "Isaiah Stewart"]) {
  const m = results.ATL.milestones.find((x) => sameName(x.player, "Onyeka Okongwu") && sameName(x.passing?.player || "", who));
  ok(m && m.status === "review", `ATL Okongwu vs ${who} (subset list) held for review`, JSON.stringify(m && { scope: m.scope, status: m.status, list: m.list }));
}
// Audit defect 3: Trey Murphy III (printed normally, not a Hawk) is not a chaser.
ok(!results.ATL.roster.some((r) => /Murphy/.test(r.name)), "ATL roster does not include Trey Murphy III");
ok(!results.ATL.milestones.some((m) => /Murphy/.test(m.player)), "ATL no chase credited to Trey Murphy III");
ok(!results.PHX.roster.some((r) => /\b(Guard|LAST|GAME)\b/.test(r.name)), "PHX roster has no 'Guard'/'LAST GAME' junk");
// Audit defect 1: lists with no NBA/franchise evidence are not publishable.
ok(results.ATL.milestones.filter((m) => m.scope === "unknown").every((m) => m.status === "review"), "ATL unknown-scope chases held for review");
// Audit defect 5: a chase on one list never absorbs a chase on another list.
for (const [team, r] of Object.entries(results)) {
  ok(r.milestones.filter((m) => m.kind === "pass").every((m) => new Set(m.sources.map((s) => s.format === "leaderboard" ? s.text.split(":")[0] : "text")).size <= 2), `${team}: merged chases come from one list`);
}

// Charlotte: bullet milestones ("is 93 rebounds away from 1,500 career rebounds") and
// the rank-less all-time leaderboard (audit defect 4).
fact("CHA Grayson Allen 1,500 rebounds", find("CHA", "Grayson Allen", "reb", { target: 1500 }), { need: 93, current: 1407, status: "ok" });
fact("CHA Grayson Allen 500 games", find("CHA", "Grayson Allen", "gp", { target: 500 }), { need: 36, status: "ok" });
fact("CHA Grant Williams 500 3PM", find("CHA", "Grant Williams", "fg3m", { target: 500 }), { need: 2, status: "ok" });
fact("CHA Naz Reid 500 games ('games played from')", find("CHA", "Naz Reid", "gp", { target: 500 }), { need: 7 });
// Space glyphs only 0.07pt wide: the line used to read "NazReidis89points...".
fact("CHA Naz Reid 6,000 points (tightly justified line)", find("CHA", "Naz Reid", "pts", { target: 6000 }), { need: 89 });
// Last bullet runs into the leaderboard heading below it.
fact("CHA Coby White 500 games (last bullet before a heading)", find("CHA", "Coby White", "gp", { target: 500 }), { need: 25 });
fact("CHA Moussa Diabate 100 starts", find("CHA", "Moussa Diabate", "gs", { target: 100 }), { need: 35 });
fact("CHA Schröder 5,000 made field goals", find("CHA", "Dennis Schröder", "fgm", { target: 5000 }), { need: 417 });
fact("CHA Sion James 100 3PM", find("CHA", "Sion James", "fg3m", { target: 100 }), { need: 6 });
fact("CHA Miller passes PJ Washington in franchise 3PM", find("CHA", "Brandon Miller", "fg3m", { kind: "pass" }), { need: 18, scope: "franchise" });
ok(results.CHA.milestones.filter((m) => m.sources.some((s) => s.format === "away-from")).length >= 30, "CHA all bullet milestones read", `got ${results.CHA.milestones.filter((m) => m.sources.some((s) => s.format === "away-from")).length}`);
ok(results.CHA.leaderboards.filter((lb) => lb.style === "value-first").length >= 12, "CHA all-time lists read", `got ${results.CHA.leaderboards.filter((lb) => lb.style === "value-first").length}`);
ok(results.CHA.leaderboards.some((lb) => lb.rows.some((r) => r.player === "Marvin Williams" && r.total === 1854)), "CHA '1.854' defensive rebounds read as 1,854");

// Invariants: nothing uncertain is publishable, every milestone names a player.
for (const [team, r] of Object.entries(results)) {
  const bad = r.milestones.filter((m) => m.status === "ok" && (["unknown", "streak", "season-record", "season"].includes(m.scope) || m.kind === "average-gap" || m.checks.length));
  ok(bad.length === 0, `${team}: no uncertain milestone is marked ok`, bad.slice(0, 2).map((m) => `${m.player} ${m.list || m.label} [${m.scope}]`).join("; "));
  ok(r.milestones.every((m) => m.player), `${team}: every milestone names a player`);
  ok(r.notes.every((n) => n.verified === false), `${team}: quoted note sentences marked unverified`);
}

// ---------- notes watcher (fake network, real PDFs) ----------
{
  const { checkNotes } = await import("../src/notes/watcher.js");
  const os = await import("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ncc-watch-"));
  const pdf = (slug) => fs.readFileSync(path.join(sampleDir, `${slug}.pdf`));
  const respond = (status, body, headers = {}) => ({
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  });
  let served = respond(200, pdf("cavaliers"), { "last-modified": "Mon, 09 Nov 2026 15:18:07 GMT" });
  let lastHeaders = null;
  const fake = async (url, opts) => { lastHeaders = opts.headers; return served; };

  const a = await checkNotes({ team: "CLE", date: "2026-11-09", opponent: "CHA", dataDir: tmp, fetchImpl: fake });
  ok(a.status === "current" && a.isNew, "watcher: first download is tonight's notes", JSON.stringify({ s: a.status, n: a.isNew, why: a.why }));
  const b = await checkNotes({ team: "CLE", date: "2026-11-09", opponent: "CHA", dataDir: tmp, fetchImpl: fake });
  ok(b.status === "current" && !b.isNew, "watcher: same file again is not a new version");
  ok(lastHeaders["if-modified-since"] === "Mon, 09 Nov 2026 15:18:07 GMT", "watcher: asks only for changes since last version");
  served = respond(304, Buffer.alloc(0));
  const c = await checkNotes({ team: "CLE", date: "2026-11-09", opponent: "CHA", dataDir: tmp, fetchImpl: fake });
  ok(c.status === "current" && !c.isNew, "watcher: 304 Not Modified keeps the stored version");
  // Next night (Nov 11 at NYK): the site still has the Nov 9 file -> stale.
  served = respond(200, pdf("cavaliers"));
  const d = await checkNotes({ team: "CLE", date: "2026-11-11", opponent: "NYK", dataDir: tmp, fetchImpl: fake });
  ok(d.status === "stale" && /not updated yet/.test(d.why), "watcher: yesterday's file is reported stale", d.why);
  served = respond(403, Buffer.from("forbidden"));
  const e = await checkNotes({ team: "CLE", date: "2026-11-11", dataDir: tmp, fetchImpl: fake });
  ok(e.status === "unreachable" && /403/.test(e.error) && e.version?.hash === a.version.hash, "watcher: blocked download keeps last good version");
  served = respond(200, Buffer.from("<html>Access denied</html>"));
  const f = await checkNotes({ team: "CLE", date: "2026-11-11", dataDir: tmp, fetchImpl: fake });
  ok(f.status === "unreachable" && /isn't a PDF/.test(f.error), "watcher: block page is not saved as notes");
  const g = await checkNotes({ team: "CLE", date: "2026-11-11", dataDir: tmp, fetchImpl: async () => { throw new Error("ENOTFOUND"); } });
  ok(g.status === "unreachable" && /network/.test(g.error), "watcher: offline is reported, not thrown");
  const versions = JSON.parse(fs.readFileSync(path.join(tmp, "notes", "CLE", "versions.json"), "utf8"));
  ok(versions.length === 1, "watcher: one stored version after repeats and failures", `got ${versions.length}`);
  // Download cut off mid-transfer (no %%EOF): reported, not stored, not thrown.
  const whole = pdf("cavaliers");
  served = respond(200, whole.subarray(0, Math.floor(whole.length / 2)));
  const h = await checkNotes({ team: "CLE", date: "2026-11-11", dataDir: tmp, fetchImpl: fake });
  ok(h.status === "unreachable" && /cut off/.test(h.error), "watcher: truncated PDF is rejected", h.error);
  served = { status: 200, ok: true, headers: { get: () => null }, arrayBuffer: async () => { throw new Error("socket hang up"); } };
  const i = await checkNotes({ team: "CLE", date: "2026-11-11", dataDir: tmp, fetchImpl: fake });
  ok(i.status === "unreachable" && /network/.test(i.error), "watcher: body failing mid-read is reported, not thrown");
  // Dated tonight but naming a different opponent than the schedule: a conflict, not "stale".
  served = respond(200, pdf("cavaliers"));
  const j = await checkNotes({ team: "CLE", date: "2026-11-09", opponent: "BOS", dataDir: tmp, fetchImpl: fake });
  ok(j.status === "conflict", "watcher: date matches but opponent doesn't -> conflict", j.why);
  // Damaged index file: set aside, warned about, and the check still works.
  fs.writeFileSync(path.join(tmp, "notes", "CLE", "versions.json"), "{ not json");
  const k = await checkNotes({ team: "CLE", date: "2026-11-09", opponent: "CHA", dataDir: tmp, fetchImpl: fake });
  ok(k.status === "current" && k.warnings.some((w) => /unreadable/.test(w)), "watcher: damaged versions.json recovered with a warning");
  // The site switches to another team's... (a different file) then back: latest follows it.
  served = respond(200, pdf("hornets"));
  await checkNotes({ team: "CLE", date: "2026-11-09", dataDir: tmp, fetchImpl: fake });
  served = respond(200, pdf("cavaliers"));
  await checkNotes({ team: "CLE", date: "2026-11-09", dataDir: tmp, fetchImpl: fake });
  served = respond(304, Buffer.alloc(0));
  const l = await checkNotes({ team: "CLE", date: "2026-11-09", opponent: "CHA", dataDir: tmp, fetchImpl: fake });
  ok(l.version?.hash === a.version.hash, "watcher: after a rollback, 304 refers to the file the site is actually serving");
}

// ---------- milestone tracking (saved ESPN data, no network) ----------
{
  // Unit checks.
  ok(etDate("2026-11-10T00:00Z") === "2026-11-09" && etDate("2026-11-07T00:00:00.000+00:00") === "2026-11-06" && etDate("x") === null, "tracking: ESPN UTC times -> New York dates");
  const line = (stats, extra = {}) => ({ played: true, started: false, stats, ...extra });
  ok(statFromLine("g30pt", line({ pts: 30 })) === 1 && statFromLine("g30pt", line({ pts: 29 })) === 0, "tracking: 30-point games counted at 30, not 29");
  ok(statFromLine("dd", line({ pts: 10, reb: 10, ast: 9 })) === 1 && statFromLine("td", line({ pts: 10, reb: 10, ast: 9 })) === 0 && statFromLine("td", line({ pts: 10, reb: 10, ast: 10 })) === 1, "tracking: double/triple-doubles");
  ok(statFromLine("gs", line({ pts: 2 }, { started: true })) === 1 && statFromLine("gp", { played: false, stats: {} }) === 0 && statFromLine("pts", null) === 0, "tracking: starts, DNPs, absent players");
  ok(statFromLine("min", line({ pts: 2 })) === null, "tracking: a stat missing from the box score is unknown, not zero");

  const fx = path.join(root, "samples", "2026-11-09", "espn");
  if (!fs.existsSync(fx)) {
    ok(false, "tracking: ESPN fixtures missing", "run: node scripts/track.js samples/2026-11-09/hornets.pdf && node scripts/make-espn-fixtures.js 2026-11-09 CHA");
  } else {
    // Serve the frozen copies as a fresh cache; any real request fails the test.
    const os = await import("node:os");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ncc-espn-"));
    fs.mkdirSync(path.join(tmp, "espn"));
    // Every copy is stamped with one time so none is "stale" whatever order they were saved in.
    const newest = Date.UTC(2026, 10, 9, 21, 0);
    for (const f of fs.readdirSync(fx)) {
      const j = JSON.parse(fs.readFileSync(path.join(fx, f), "utf8"));
      j.fetchedAt = newest;
      fs.writeFileSync(path.join(tmp, "espn", f), JSON.stringify(j));
    }
    let requests = 0;
    const espn = createEspn({ dataDir: tmp, now: () => newest + 60e3, spacingMs: 0, fetchImpl: async () => { requests++; throw new Error("offline test"); } });

    // Traded seasons: per-team rows add up to the career line, "Totals" rows excluded.
    const sch = readCareer(JSON.parse(fs.readFileSync(path.join(fx, "career-3032979.json"), "utf8")).data);
    ok(sch.rows.length > 0 && !sch.rows.some((r) => /totals/i.test(r.team)) && sch.warnings.length === 0 && sch.career.ast === 4482, "tracking: Schröder's traded seasons read without double counting (4,482 AST)", JSON.stringify(sch.warnings));

    const cha = results.CHA.milestones;
    // As written (notes for 11/9, no game since): cross-check only.
    const now = await trackMilestones({ team: "CHA", notesDate: "2026-11-09", milestones: cha, espn });
    const tr = (r, player, stat, extra = {}) => r.milestones.find((m) => sameName(m.player, player) && m.stat === stat && Object.entries(extra).every(([k, v]) => m[k] === v));
    const allenGp = tr(now, "Grayson Allen", "gp", { target: 500 });
    ok(allenGp?.tracking.status === "confirmed" && allenGp.tracking.espn.value === 464, "tracking: Grayson Allen 464 games confirmed by ESPN", JSON.stringify(allenGp?.tracking));
    const allenReb = tr(now, "Grayson Allen", "reb", { target: 1500 });
    ok(allenReb?.tracking.status === "disagrees" && allenReb.tracking.espn.value === 1398 && allenReb.status === "review", "tracking: Grayson Allen rebounds 1,407 vs ESPN 1,398 -> review", JSON.stringify(allenReb?.tracking));
    const schroder = tr(now, "Dennis Schröder", "ast", { target: 4500 });
    ok(schroder?.tracking.status === "confirmed", "tracking: Schröder (accent) matched to ESPN's 'Schroder' and confirmed", JSON.stringify(schroder?.tracking));
    const ball = now.milestones.find((m) => m.player === "LaMelo Ball" && m.scope === "franchise");
    ok(ball?.tracking.status === "off-roster", "tracking: LaMelo Ball (traded) franchise chase is not live", JSON.stringify(ball?.tracking));
    ok(now.games.length === 0, "tracking: no games after notes dated today");
    ok(!now.milestones.some((m) => m.tracking.status === "disagrees" && m.status === "ok"), "tracking: no disagreement is left 'ok'");

    // Same notes treated as written for 11/4: the 11/4 and 11/6 games get added.
    const back = await trackMilestones({ team: "CHA", notesDate: "2026-11-04", milestones: cha, espn });
    ok(back.games.map((g) => g.date).join(",") === "2026-11-04,2026-11-06", "tracking: games since 11/4 are 11/4 and 11/6", back.games.map((g) => g.date).join(","));
    const miller = tr(back, "Brandon Miller", "pts", { target: 3500 });
    ok(miller?.tracking.delta === 18 && miller.tracking.current === 3378 && miller.tracking.need === 122, "tracking: Miller +10 +8 points -> 3,378, needs 122", JSON.stringify(miller?.tracking));
    const mcn = tr(back, "Liam McNeeley", "gp", { target: 100 });
    ok(mcn?.tracking.delta === 1, "tracking: McNeeley DNP on 11/4 adds 1 game, not 2", JSON.stringify(mcn?.tracking));
    const dia = tr(back, "Moussa Diabate", "fgm", { target: 500 });
    ok(dia?.tracking.delta === 2, "tracking: Diabate 2 FGM on 11/4, DNP 11/6", JSON.stringify(dia?.tracking));
    const reid = tr(back, "Naz Reid", "gp", { target: 500 });
    ok(reid?.tracking.need === 5, "tracking: Naz Reid 7 games from 500 becomes 5", JSON.stringify(reid?.tracking));
    const ballOk = back.milestones.filter((m) => m.tracking.status === "off-roster");
    ok(ballOk.length > 0 && ballOk.every((m) => m.status === "review"), "tracking: a chase by a player who has left is never 'ok'");
    // A chase of a teammate: both totals move with the same games (synthetic case on real box scores).
    const fake = [{ team: "CHA", player: "Brandon Miller", stat: "pts", kind: "pass", scope: "franchise", current: 1000, target: 1101, tieAt: 100, need: 101, passing: { player: "Coby White", total: 1100 }, status: "ok", checks: [] }];
    const tm = await trackMilestones({ team: "CHA", notesDate: "2026-11-04", milestones: fake, espn });
    ok(tm.milestones[0].tracking.targetMoved === 11 && tm.milestones[0].tracking.target === 1112 && tm.milestones[0].tracking.need === 1112 - 1018, "tracking: chasing a teammate moves the target (White +4 +7)", JSON.stringify(tm.milestones[0].tracking));
    // 0.80: the notes and ESPN differ and no one has looked it up: the NBA Guide's total plus this season breaks the tie.
    {
      const src = now.milestones.find((m) => m.scope === "career" && m.kind === "round" && m.stat === "pts" && m.tracking?.status === "confirmed" && m.tracking.espn?.value === m.tracking.current && m.target != null);
      const E = src.tracking.espn.value;
      const typo = [{ ...src, current: E - 5, need: src.target - (E - 5), tracking: undefined, checks: [] }];
      const run = async (guideBase) => (await trackMilestones({ team: "CHA", notesDate: "2026-11-09", milestones: typo, espn, guideBase })).milestones[0].tracking;
      const none = await run(null), probe = await run(() => 0);
      const S = probe.guide?.season;
      const espnWins = await run(() => E - S), notesWin = await run(() => E - 5 - S), neither = await run(() => E - 2 - S);
      // One apart: not settled either way (a stat correction can be in one source and not yet the others); it says which side our count is on.
      const oneOff = (await trackMilestones({ team: "CHA", notesDate: "2026-11-09", milestones: [{ ...typo[0], current: E - 1, need: src.target - (E - 1) }], espn, guideBase: () => E - S })).milestones[0].tracking;
      ok(oneOff.status === "disagrees" && !oneOff.settled && oneOff.guide.backs === "ESPN" && /agrees with ESPN, but a difference this small can be a stat correction/.test(oneOff.notes.join(" ")),
        "notes vs ESPN (0.80): a difference of one or two is never settled by our own count; it stays in Review and says which side the count is on", JSON.stringify([oneOff.status, oneOff.guide, oneOff.notes]));
      ok(none.status === "disagrees" && probe.status === "disagrees" && neither.status === "disagrees" && !neither.settled
        && espnWins.status === "corrected" && espnWins.current === E && espnWins.need === src.target - E && espnWins.settled.right === "ESPN" && espnWins.inconsistent === true && /ESPN's number is used/.test(espnWins.notes.join(" "))
        && notesWin.status === "corrected" && notesWin.current === E - 5 && notesWin.settled.right === "the notes" && notesWin.inconsistent === true && /the notes' number is used/.test(notesWin.notes.join(" ")),
        "notes vs ESPN (0.80): the NBA Guide's career total plus this season's games breaks the tie either way, the difference stays on the item, and a count matching neither settles nothing",
        JSON.stringify({ player: src.player, stat: src.stat, E, S, none: none.status, espnWins: [espnWins.status, espnWins.current, espnWins.settled], notesWin: [notesWin.status, notesWin.current], neither: neither.status }));
    }
    ok(requests === 0, "tracking: tests made no network requests", `${requests} attempted`);


    // Transactions through the tracker (frozen NBA.com log).
    {
      const mvFile = path.join(root, "samples", "2026-11-10", "nba", "movement.json");
      if (fs.existsSync(mvFile)) {
        const mv = readMovement(JSON.parse(fs.readFileSync(mvFile, "utf8")).data);
        const fakeNba = { movement: async () => ({ ok: true, warnings: [], data: mv }) };
        const tr = await trackMilestones({ team: "CHA", notesDate: "2026-11-09", milestones: cha, espn, nba: fakeNba });
        const bm = tr.milestones.find((m) => m.player === "LaMelo Ball" && m.scope === "franchise");
        ok(bm?.tracking.status === "off-roster" && bm.checks.some((c) => /traded to MIN on 2026-07-10/.test(c)), "nba: the tracker says Ball was traded to MIN, not just 'missing'", JSON.stringify(bm?.checks));
        ok(tr.milestones.every((m) => !m.tracking.espnId || m.tracking.nbaId), "nba: every matched player also gets an NBA id");
      }
    }

    // ---------- anticipation: P(tonight), ETA, importance ----------
    {
      const r1 = rng(5), r2 = rng(5);
      ok([1, 2, 3].every(() => r1() === r2()), "model: seeded random numbers repeat");
      const ten = makeSampler([{ stats: { pts: 10 }, started: true }], { smooth: 0 });
      const g = (n, p = 1) => Array.from({ length: n }, (_, i) => ({ date: `2026-11-${10 + i}`, pPlay: p }));
      const a = simulate({ need: 25, stat: "pts", sample: ten, games: g(5), sims: 500 });
      ok(a.byGame.join() === "0,0,1,1,1" && a.medianGame === 2, "model: 10 a game, needs 25 -> exactly game 3", a.byGame.join());
      ok(simulate({ need: 0, stat: "pts", sample: ten, games: g(3) }).byGame.every((x) => x === 1), "model: need 0 is already done");
      ok(simulate({ need: 5, stat: "pts", sample: ten, games: g(3, 0) }).pNever === 1, "model: never plays -> never happens");
      const half = simulate({ need: 1, stat: "gp", sample: ten, games: g(1, 0.5), sims: 20000 });
      ok(Math.abs(half.byGame[0] - 0.5) < 0.02, "model: 50% to play, needs 1 game -> about 50%", String(half.byGame[0]));
      const coin = makeSampler([{ stats: { pts: 0 } }, { stats: { pts: 20 } }], { smooth: 0 });
      const c = simulate({ need: 20, stat: "pts", sample: coin, games: g(2), sims: 20000 });
      ok(Math.abs(c.byGame[0] - 0.5) < 0.02 && Math.abs(c.byGame[1] - 0.75) < 0.02, "model: 0 or 20 points -> 50% tonight, 75% within 2", c.byGame.join());
      const x1 = simulate({ need: 20, stat: "pts", sample: coin, games: g(2), seed: 9 }), x2 = simulate({ need: 20, stat: "pts", sample: coin, games: g(2), seed: 9 });
      ok(x1.byGame.join() === x2.byGame.join(), "model: same inputs, same answer");
      ok(simulate({ need: 3, stat: "min", sample: makeSampler([{ stats: { pts: 3 } }], { smooth: 0 }), games: g(2) }).unknown === true, "model: a stat with no game data is reported unknown, not guessed");
      const smooth = makeSampler([{ stats: { pts: 20 } }, { stats: { pts: 22 } }]);
      const big = simulate({ need: 30, stat: "pts", sample: smooth, games: g(1), sims: 20000 });
      ok(big.byGame[0] > 0 && big.byGame[0] < 0.1, "model: a 30-point night for a 20-22 scorer is possible but unlikely", String(big.byGame[0]));

      const nba10 = importance({ kind: "pass", scope: "nba", stat: "pts", passing: { rank: 8 } });
      const fr7 = importance({ kind: "pass", scope: "franchise", stat: "fg3m", label: "3-pointers", passing: { forWhat: "seventh-most" } });
      const r100 = importance({ kind: "round", stat: "reb", label: "rebounds", target: 100 });
      const r30k = importance({ kind: "round", stat: "pts", label: "points", target: 30000 });
      ok(nba10.score > fr7.score && fr7.score > r100.score && r30k.score > r100.score, "importance: NBA top-10 > franchise 7th > 100 rebounds; 30,000 points > 100 rebounds", [nba10.score, fr7.score, r100.score, r30k.score].join());
      ok(fr7.reasons.some((x) => /#7/.test(x)), "importance: 'seventh-most' read as rank 7");

      const w1 = await buildWatch({ team: "CHA", notesDate: "2026-11-09", milestones: cha, espn, today: "2026-11-09", sims: 2000 });
      const w2 = await buildWatch({ team: "CHA", notesDate: "2026-11-09", milestones: cha, espn, today: "2026-11-09", sims: 2000 });
      ok(JSON.stringify(w1.items) === JSON.stringify(w2.items), "watch: same data, same Watch List");
      const wi = (player, stat, target) => w1.items.find((i) => sameName(i.player, player) && i.stat === stat && (target == null || i.target === target));
      const sj = wi("Sion James", "pts", 500);
      ok(sj && sj.pTonight > 0.3 && sj.pTonight < 0.9 && sj.publishable === false, "watch: Sion James 5 points from 500: likely, but held for review (sources disagree)", JSON.stringify(sj && { p: sj.pTonight, pub: sj.publishable }));
      const gw = wi("Grant Williams", "fg3m", 500);
      ok(gw && gw.injury?.status === "Out" && gw.pTonight === 0, "watch: Grant Williams is out tonight -> 0%", JSON.stringify(gw && { inj: gw.injury, p: gw.pTonight }));
      const nr = wi("Naz Reid", "gp", 500);
      ok(nr && nr.pTonight === 0 && nr.eta?.game >= 7, "watch: Naz Reid needs 7 games -> not tonight, game 7 at the earliest", JSON.stringify(nr && { p: nr.pTonight, eta: nr.eta }));
      const ballW = w1.items.filter((i) => i.player === "LaMelo Ball");
      ok(ballW.length && ballW.every((i) => !i.publishable && i.pTonight == null), "watch: traded players' franchise chases are not projected or published");
      const ranked = rank(w1.items);
      ok(ranked.tonight.every((i) => i.pTonight >= 0.05) && ranked.soon.every((i, k, arr) => k === 0 || arr[k - 1].eta.game <= i.eta.game), "watch: tonight list and upcoming list ordered as documented");
      ok(w1.items.every((i) => i.pPlayTonight == null || i.pPlayTonight <= 0.97), "watch: nobody is ever 100% to play");
      // 0.141.2: tonight's NBA injury report sets tonight's chance to play when it has the team's game.
      const rep = { asOf: "11/09/26 05:45 PM", rows: [{ team: "CHA", name: "Sion James", status: "Doubtful", reason: "Ankle" }, { team: "CHA", name: "Grant Williams", status: "Questionable", reason: "Knee" }] };
      const w3 = await buildWatch({ team: "CHA", notesDate: "2026-11-09", milestones: cha, espn, today: "2026-11-09", sims: 2000, report: rep });
      const wi3 = (player, stat, target) => w3.items.find((i) => sameName(i.player, player) && i.stat === stat && i.target === target);
      const sj3 = wi3("Sion James", "pts", 500), gw3 = wi3("Grant Williams", "fg3m", 500);
      ok(sj3 && sj3.pPlayTonight <= 0.25 && sj3.injury?.status === "Doubtful" && sj3.injury?.from === "nba" && gw3 && gw3.pPlayTonight > 0 && gw3.pPlayTonight <= 0.6 && gw3.injury?.status === "Questionable",
        "watch (0.141.2): tonight's NBA report caps tonight (Doubtful 25%, Questionable 60%) and overrules ESPN's Out for tonight", JSON.stringify([sj3?.pPlayTonight, sj3?.injury, gw3?.pPlayTonight, gw3?.injury]));
      const w4 = await buildWatch({ team: "CHA", notesDate: "2026-11-09", milestones: cha, espn, today: "2026-11-09", sims: 2000, report: { asOf: null, rows: [{ team: "CHA", name: "Somebody Else", status: "Out" }] } });
      const gw4 = w4.items.find((i) => sameName(i.player, "Grant Williams") && i.stat === "fg3m" && i.target === 500);
      const w5 = await buildWatch({ team: "CHA", notesDate: "2026-11-09", milestones: cha, espn, today: "2026-11-09", sims: 2000, report: { asOf: null, rows: [{ team: "ZZZ", name: "Grant Williams", status: "Probable" }] } });
      const nbaLU = (st) => ({ movement: async () => ({ ok: false, error: "test" }), lineups: async () => ({ ok: true, data: { games: [{ teams: { CHA: [{ name: "Sion James", lineupStatus: "Confirmed" }, { name: "Grant Williams", lineupStatus: st }] } }] } }) });
      const rq = { asOf: null, rows: [{ team: "CHA", name: "Sion James", status: "Questionable" }, { team: "CHA", name: "Grant Williams", status: "Questionable" }] };
      const w6 = await buildWatch({ team: "CHA", notesDate: "2026-11-09", milestones: cha, espn, nba: nbaLU("Expected"), today: "2026-11-09", sims: 2000, report: rq });
      const p6 = (n, st, t) => w6.items.find((i) => sameName(i.player, n) && i.stat === st && i.target === t)?.pPlayTonight;
      ok(p6("Sion James", "pts", 500) === 0.95 && p6("Grant Williams", "fg3m", 500) <= 0.6,
        "watch (0.141.2): a confirmed starter plays despite Questionable; a projected one keeps the report's cap", JSON.stringify([p6("Sion James", "pts", 500), p6("Grant Williams", "fg3m", 500)]));
      ok(gw4 && gw4.pPlayTonight === 0 && gw4.injury?.from === "espn" && JSON.stringify(w5.items) === JSON.stringify(w1.items),
        "watch (0.141.2): ESPN's Out stands when the report leaves him off; a report without his team's game changes nothing", JSON.stringify([gw4?.pPlayTonight, gw4?.injury]));
      ok(requests === 0, "watch: tests made no network requests", `${requests} attempted`);
    }
    // ESPN unreachable with no cache: nothing throws, every milestone says why.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ncc-espn-empty-"));
    const off = await trackMilestones({ team: "CHA", notesDate: "2026-11-09", milestones: cha, espn: createEspn({ dataDir: empty, spacingMs: 0, fetchImpl: async () => { throw new Error("ENOTFOUND"); } }) });
    ok(off.milestones.length === cha.length && off.milestones.every((m) => m.tracking.status === "unavailable") && off.problems.some((p) => /network/.test(p)), "tracking: offline -> unavailable, reported, not thrown");
    const nodate = await trackMilestones({ team: "CHA", notesDate: null, milestones: cha, espn });
    ok(nodate.milestones.every((m) => m.tracking.status === "unavailable"), "tracking: unknown notes date -> nothing rolled forward");
  }
}
} // end: needs the notes PDFs (samples/)

// ---------- published data files: every one parses, none carries merge-conflict markers ----------
// (11/11: a push carried "<<<<<<<" markers in 7 data files and broke the site for ~2 minutes.)
{
  const bad = [];
  const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith(".json")) { const t = fs.readFileSync(p, "utf8"); if (/^(<{7}|={7}|>{7})( |$)/m.test(t)) bad.push(`${p}: conflict markers`); else { try { JSON.parse(t); } catch (e) { bad.push(`${p}: ${e.message.slice(0, 60)}`); } } }
  } };
  const dataDir = path.join(root, "docs", "data");
  if (fs.existsSync(dataDir)) walk(dataDir);
  ok(!bad.length, "published data: every docs/data JSON file parses and has no merge-conflict markers", bad.slice(0, 5).join("; "));
}

// ---------- website (docs/) ----------
{
  const docs = path.join(root, "docs");
  if (fs.existsSync(path.join(docs, "lib"))) {
    for (const rel of ["teams.js", "notes/names.js", "espn/parse.js", "registry/track.js", "nba/movement.js", "situations/ratings.js", "espn/pbp.js", "situations/withwithout.js", "situations/leaders.js", "anticipate/tonight.js"]) {
      const a = fs.readFileSync(path.join(root, "src", rel), "utf8"), b = fs.existsSync(path.join(docs, "lib", rel)) ? fs.readFileSync(path.join(docs, "lib", rel), "utf8") : null;
      ok(a === b, `website: docs/lib/${rel} matches src (run scripts/publish.js after code changes)`);
    }
    // Everything the page imports, followed through its own imports, must run in a browser.
    const seen = new Set(), stack = ["espn/parse.js", "registry/track.js", "situations/ratings.js", "situations/withwithout.js", "situations/leaders.js", "anticipate/tonight.js"];
    while (stack.length) {
      const rel = stack.pop();
      if (seen.has(rel)) continue;
      seen.add(rel);
      const src = fs.readFileSync(path.join(docs, "lib", rel), "utf8");
      ok(!/from "node:|require\(/.test(src), `website: docs/lib/${rel} uses no Node-only modules`);
      for (const m of src.matchAll(/from "(\.{1,2}\/[^"]+)"/g)) stack.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
    }
    const html = fs.readFileSync(path.join(docs, "index.html"), "utf8");
    const imports = [...html.matchAll(/from "\.\/(lib\/[^"]+)"/g)].map((m) => m[1]);
    ok(imports.length >= 2 && imports.every((f) => fs.existsSync(path.join(docs, f))), "website: every module the page imports exists", imports.join(", "));
    const w = JSON.parse(fs.readFileSync(path.join(docs, "data", "watch.json"), "utf8"));
    ok(Array.isArray(w.teams) && w.today && w.teams.every((t) => Array.isArray(t.items)), "website: watch.json has the expected shape");
    ok(!JSON.stringify(w).includes('"source"'), "website: no text copied from the notes is published");
  }
}

// ---------- ESPN-only milestone discovery ----------
{
  const car = (id, career, season, years = 1) => ({ ok: true, stale: false, warnings: [], data: { rows: Array.from({ length: years }, (_, k) => ({ season: `${2026 - k}-${String(27 - k).padStart(2, "0")}`, teamId: "1", stats: season })), career } });
  const fake = {
    teams: async () => ({ ok: true, warnings: [], data: { ids: { LAL: "13" } } }),
    roster: async () => ({ ok: true, warnings: [], data: { players: [{ id: "a", name: "Big Scorer" }, { id: "b", name: "Young Guy" }, { id: "c", name: "Far Away" }, { id: "d", name: "Rookie" }] } }),
    career: async (id) => ({
      a: car("a", { pts: 19985, fg3m: 1497, gp: 999, reb: 4990, ast: 2950 }, { gp: 10, pts: 250, fg3m: 30, reb: 50, ast: 60 }, 12), // a veteran: 15 pts from 20,000; 3 threes from 1,500 (by 250 past 1,000); 1 game from 1,000; 2,950 assists: 3,000 isn't a 1,000 step
      b: car("b", { pts: 1990, fg3m: 98, gp: 99 }, { gp: 10, pts: 200, fg3m: 20 }),                          // a rookie: 2,000 points (by 500 until 5,000); 100 threes and 100 games are too few
      c: car("c", { pts: 18500 }, { gp: 10, pts: 200 }, 9),                                                  // 1,500 away: not within 3 games
      d: { ok: true, stale: false, warnings: [], data: { rows: [], career: null } },                          // no NBA games
    }[id]),
  };
  const r = await discoverMilestones({ team: "LAL", espn: fake });
  const got = r.milestones.map((m) => `${m.player}|${m.stat}|${m.target}|${m.need}`).sort();
  ok(got.join(",") === ["Big Scorer|fg3m|1500|3", "Big Scorer|gp|1000|1", "Big Scorer|pts|20000|15", "Big Scorer|reb|5000|10", "Young Guy|pts|2000|10"].join(","), "discover: round numbers on the user's spacing (11/13), within about 3 games", got.join(", "));
  ok(r.milestones.every((m) => m.origin === "espn" && m.status === "review"), "discover: ESPN-only finds are always held for review");
  const skip = await discoverMilestones({ team: "LAL", espn: fake, skip: [{ player: "Big Scorer", stat: "pts", target: 20000 }] });
  ok(!skip.milestones.some((m) => m.stat === "pts" && m.player === "Big Scorer") && skip.milestones.some((m) => m.player === "Young Guy" && m.stat === "pts"), "discover: a milestone the notes already have isn't repeated");
}

const more = {};   // the 11/10 notes, read below (and checked against their snapshots at the end)
// ---------- NBA.com lineups and transactions (frozen 2026-11-10) ----------
if (HAVE_SAMPLES) { // needs the notes PDFs (samples/): skipped where they are not, e.g. on GitHub
{
  const dir = path.join(root, "samples", "2026-11-10", "nba");
  if (!fs.existsSync(dir)) ok(false, "NBA.com fixtures missing (samples/2026-11-10/nba)");
  else {
    const mv = readMovement(JSON.parse(fs.readFileSync(path.join(dir, "movement.json"), "utf8")).data);
    ok(mv.rows.length > 10000 && mv.rows[0].date >= mv.rows[mv.rows.length - 1].date, "nba: transactions read, newest first", `${mv.rows.length} rows`);
    const ball = standing(mv, "LaMelo Ball", "CHA");
    ok(ball.status === "left" && ball.to === "MIN" && ball.last.date === "2026-07-10", "nba: LaMelo Ball left CHA, traded to MIN on 2026-07-10", JSON.stringify(ball.last));
    const br = standing(mv, "Miles Bridges", "CHA"), brPhx = standing(mv, "Miles Bridges", "PHX");
    ok(br.status === "left" && br.to === "PHX" && brPhx.status === "with", "nba: Miles Bridges left CHA for PHX (2026-07-13) and is with PHX");
    ok(standing(mv, "Nae’Qwan Tomlin", "CLE").status === "with", "nba: Tomlin's last move keeps him with CLE (ESPN's roster lacks him)");
    ok(standing(mv, "Jabari Smith Jr.", "HOU").nbaId != null && slugOf("Dennis Schröder") === "dennis-schroder", "nba: suffixes and accents in slugs ('jabari-smith-jr', 'dennis-schroder')");
    ok(standing(mv, "Nobody Atall", "CHA").status === null, "nba: an unknown player is 'no evidence', not 'left'");
    const lu = readLineups(JSON.parse(fs.readFileSync(path.join(dir, "lineups-2026-11-10.json"), "utf8")).data);
    const nyk = lu.games.map((g) => g.teams.NYK).find(Boolean);
    ok(lu.games.length === 6 && nyk?.length === 5 && nyk.some((p) => p.name === "Mikal Bridges" && p.nbaId === "1628969"), "nba: 2026-11-10 lineups, NYK's five with NBA ids");
  }
  const any = makeSampler([{ stats: { pts: 10 }, started: false }], { smooth: 0 });
  const g1 = (pStart) => [{ date: "2026-11-10", pPlay: 1, pStart }];
  const sOn = simulate({ need: 1, stat: "gs", sample: any, games: g1(0.98), sims: 20000 });
  const sOff = simulate({ need: 1, stat: "gs", sample: any, games: g1(0.02), sims: 20000 });
  const sHist = simulate({ need: 1, stat: "gs", sample: any, games: g1(null), sims: 2000 });
  ok(Math.abs(sOn.byGame[0] - 0.98) < 0.01 && Math.abs(sOff.byGame[0] - 0.02) < 0.01 && sHist.byGame[0] === 0, "model: tonight's lineup decides a games-started milestone (98% listed, 2% not, history otherwise)");
}

// ---------- Boston: broken font maps repaired, milestone grid, last-season totals ----------
{
  const f = path.join(root, "samples", "2026-11-10-slate", "celtics.pdf");
  if (!fs.existsSync(f)) ok(false, "Boston notes sample missing (samples/2026-11-10-slate/celtics.pdf)");
  else {
    const raw = fs.readFileSync(f);
    const fixed = repairToUnicode(raw);
    ok(fixed.repaired.length === 4 && fixed.buf.length > raw.length && fixed.buf.subarray(0, raw.length).equals(raw), "pdf repair: Boston's 4 broken font maps fixed by appending; original bytes untouched", fixed.repaired.join(", "));
    let untouched = 0, total = 0;
    for (const dir of ["2026-11-09", "2026-11-09-slate", "2026-11-10-slate"]) {
      const d = path.join(root, "samples", dir);
      if (!fs.existsSync(d)) continue;
      for (const x of fs.readdirSync(d).filter((n) => n.endsWith(".pdf") && n !== "celtics.pdf")) {
        total++; const b = fs.readFileSync(path.join(d, x)); const r = repairToUnicode(b);
        if (r.buf === b && !r.repaired.length) untouched++;
      }
    }
    ok(total >= 20 && untouched === total, "pdf repair: every other team's notes are left exactly as they are", `${untouched}/${total}`);
    const bos = await parseNotes(raw, { team: "BOS" });
    const doc1 = bos.meta;
    ok(doc1.gameDate === "2026-11-10" && doc1.opponent === "PHI", "BOS notes readable: date and opponent", JSON.stringify(doc1));
    const g = (player, stat, target) => bos.milestones.find((m) => sameName(m.player, player) && m.stat === stat && m.target === target);
    const facts = [["J. Tatum", "pts", 14400, 24], ["J. Tatum", "ast", 2400, 2], ["J. Tatum", "blk", 400, 8], ["J. Tatum", "fg3m", 1600, 7], ["D. White", "pts", 7800, 5], ["B. Scheierman", "pts", 600, 1], ["M. Conley", "ast", 6800, 16], ["P. Pritchard", "fg3m", 900, 27]];
    for (const [p, st, t, need] of facts) {
      const m = g(p, st, t);
      ok(m && m.target - m.current === need, `BOS grid: ${p} ${t.toLocaleString()} ${st} needs ${need} (as printed)`, JSON.stringify(m && { cur: m.current, t: m.target }));
    }
    ok(!g("L. Garza", "reb", 500) && !g("L. Garza", "gp", 200), "BOS grid: marks with a date acquired are not upcoming (Garza 500 rebounds, 3/30/26)");
    ok(bos.milestones.filter((m) => m.format === "needs-grid" || m.sources?.some?.((x) => x.format === "needs-grid")).length >= 75 && !bos.problems.some((p) => /milestone grid/.test(p)), "BOS grid: about 82 milestones, every row has 3 entries per stat", `${bos.milestones.length} milestones; ${bos.problems.filter((p) => /grid/.test(p)).join("; ")}`);
  }
  // Notes left at last season's totals: notes + this season = ESPN exactly -> "corrected".
  const one = (rows, career) => ({ ok: true, stale: false, warnings: [], data: { rows, career } });
  const fake = {
    teams: async () => ({ ok: true, warnings: [], data: { ids: { BOS: "2" } } }),
    roster: async () => ({ ok: true, warnings: [], data: { players: [{ id: "p1", name: "Payton Pritchard" }, { id: "p2", name: "Luka Garza" }, { id: "p3", name: "Mike Conley" }] } }),
    schedule: async () => ({ ok: true, warnings: [], data: { games: [] } }),
    box: async () => ({ ok: false, error: "none" }),
    career: async (id) => ({
      p1: one([{ season: "2025-26", teamId: "2", stats: { fg3m: 873 } }, { season: "2026-27", teamId: "2", stats: { fg3m: 21 } }], { fg3m: 894 }),
      p2: one([{ season: "2025-26", teamId: "2", stats: { oreb: 297 } }, { season: "2026-27", teamId: "2", stats: { oreb: 22 } }], { oreb: 319 }),
      p3: one([{ season: "2025-26", teamId: "2", stats: { reb: 3547 } }, { season: "2026-27", teamId: "2", stats: { reb: 3 } }], { reb: 3551 }),
    }[id]),
  };
  const ms = [
    { team: "BOS", player: "P. Pritchard", stat: "fg3m", kind: "round", scope: "career", target: 900, current: 873, need: 27, status: "ok", checks: [] },
    { team: "BOS", player: "L. Garza", stat: "oreb", kind: "round", scope: "career", target: 300, current: 297, need: 3, status: "ok", checks: [] },
    { team: "BOS", player: "M. Conley", stat: "reb", kind: "round", scope: "career", target: 3750, current: 3550, need: 200, status: "ok", checks: [] },
  ];
  const tr = await trackMilestones({ team: "BOS", notesDate: "2026-11-10", milestones: ms, espn: fake });
  const [pp, lg, mc] = tr.milestones.map((m) => m.tracking);
  ok(pp.status === "corrected" && pp.current === 894 && pp.need === 6 && tr.milestones[0].status === "ok", "tracking: notes at last season's total + this season = ESPN -> corrected (Pritchard needs 6, not 27)", JSON.stringify(pp));
  ok(lg.status === "corrected" && lg.reached === true, "tracking: a mark passed earlier this season is recognised as already reached (Garza 319 offensive rebounds)", JSON.stringify(lg));
  ok(mc.status === "disagrees" && tr.milestones[2].status === "review", "tracking: a difference that isn't this season's total stays a disagreement (Conley +1)", JSON.stringify(mc));
}

// ---------- 2026-11-10 layouts: MIL, ORL, PHI, IND, BKN, MIN, DAL, HOU ----------
// Every fact below was read by hand off the PDF page named with it.
{
  const dir = path.join(root, "samples", "2026-11-10-more");
  if (!fs.existsSync(dir)) ok(false, "2026-11-10 layout samples missing (samples/2026-11-10-more)");
  else for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".pdf"))) {
    const team = teamFromSlug(path.basename(f, ".pdf"));
    more[team] = await parseNotes(fs.readFileSync(path.join(dir, f)), { team });
  }
  const get = (team, player, stat, target, extra = {}) => more[team]?.milestones.find((m) => sameName(m.player || "", player) && m.stat === stat && (target == null || m.target === target) && Object.entries(extra).every(([k, v]) => (k === "passing" ? sameName(m.passing?.player || "", v) : m[k] === v)));
  const has = (name, m, want) => ok(!!m && Object.entries(want).every(([k, v]) => m[k] === v), name, JSON.stringify(m && { player: m.player, cur: m.current, t: m.target, need: m.need, scope: m.scope, status: m.status, checks: m.checks }));
  if (Object.keys(more).length === 8) {
    // Milwaukee p.8: Player | Category | Current # | Milestone # | Needs
    has("MIL table: Myles Turner 9,948 points, 10,000 needs 52", get("MIL", "Myles Turner", "pts", 10000), { current: 9948, need: 52, scope: "career", status: "ok" });
    has("MIL table: Caris LeVert 7,717 points, 8,000 needs 283", get("MIL", "Caris LeVert", "pts", 8000), { current: 7717, need: 283, status: "ok" });
    ok(more.MIL.meta.opponent === "NYK" && more.MIL.meta.gameDate === "2026-11-10", "MIL notes: at New York, 2026-11-10");
    // Orlando p.10-11: "NEXT CAREER MILESTONE" and "MAGIC ALL-TIME LIST" blocks
    has("ORL rows: Banchero 378 threes, needs 22 to reach 400", get("ORL", "Paolo Banchero", "fg3m", 400), { current: 378, need: 22, scope: "career", status: "ok" });
    has("ORL rows: Bitadze 398 blocked shots, needs 2 to reach 400", get("ORL", "Goga Bitadze", "blk", 400), { current: 398, need: 2, status: "ok" });
    has("ORL rows: a row without a total continues the one above (Suggs needs 140 threes to reach 600)", get("ORL", "Jalen Suggs", "fg3m", 600), { current: 460, need: 140, status: "ok" });
    has("ORL rows: Vučević 17,706 points, needs 294 to reach 18,000", get("ORL", "Nikola Vucevic", "pts", 18000), { current: 17706, need: 294 });
    has("ORL list: Banchero 1,550 free throws, needs 19 to pass Hardaway (1,568) for 5th", get("ORL", "Paolo Banchero", "ftm", 1569, { passing: "Hardaway" }), { kind: "pass", scope: "franchise", current: 1550, need: 19, tieAt: 18, status: "ok" });
    has("ORL list: Vučević needs 206 points to pass Anderson (10,650) for 2nd", get("ORL", "Nikola Vucevic", "pts", 10651, { passing: "Anderson" }), { kind: "pass", current: 10445, need: 206 });
    const fga = get("ORL", "Paolo Banchero", "fga", 5523);
    ok(fga && fga.status === "review" && fga.checks.some((c) => /stated need 907/.test(c)), "ORL list: a printed need that is off by one is flagged (907 attempts vs 5,522 + 1 - 4,615 = 908)", JSON.stringify(fga?.checks));
    ok(more.ORL.milestones.length === 86 && !more.ORL.problems.length, "ORL: 86 milestones from pp.10-11, nothing unread", `${more.ORL.milestones.length}; ${JSON.stringify(more.ORL.problems)}`);
    // Philadelphia p.12: PLAYER | MILESTONE | NEEDED
    has("PHI table: Dominick Barlow 100 career steals needs 6", get("PHI", "Dominick Barlow", "stl", 100), { current: 94, need: 6, scope: "career", status: "ok" });
    has("PHI table: Jaylen Brown 2,000 career assists needs 7", get("PHI", "Jaylen Brown", "ast", 2000), { current: 1993, need: 7, status: "ok" });
    has("PHI table: a cell wrapped over three lines is read whole (Embiid 1,116 offensive rebounds, 7th in franchise history, needs 11)", get("PHI", "Joel Embiid", "oreb", 1116), { kind: "pass", scope: "franchise", current: 1105, need: 11 });
    const lbj = get("PHI", "LeBron James", "ast", 12092);
    ok(lbj && lbj.kind === "pass" && lbj.scope === "nba" && lbj.need === 16 && sameName(lbj.passing?.player || "", "Jason Kidd") && lbj.passing.total === 12091 && lbj.status === "ok" && lbj.sources.length === 2,
      "PHI: '12,092 Career Assists (3rd all-time in NBA History), needs 16' merges with the leaderboard row (Kidd 12,091): one chase, two sources", JSON.stringify(lbj && { p: lbj.passing, s: lbj.scope, st: lbj.status, c: lbj.checks, n: lbj.sources.length }));
    ok(more.PHI.meta.opponent === "BOS", "PHI notes: vs Boston");
    // Indiana p.2: PLAYER | MILESTONE | NEEDS/ACCOMPLISHED, beside a prose column
    has("IND table: rows without a name belong to the player above (Haliburton 3,000 career assists needs 15)", get("IND", "Tyrese Haliburton", "ast", 3000), { current: 2985, need: 15, scope: "career" });
    has("IND table: 'Pacers points' is a franchise total (Haliburton 5,000 needs 551)", get("IND", "Tyrese Haliburton", "pts", 5000), { scope: "franchise", need: 551 });
    ok(!get("IND", "Tyrese Haliburton", "pts", 6000) && !get("IND", "Pascal Siakam", "pts", 13000), "IND table: 'Accomplished' rows are not upcoming");
    const z7 = get("IND", "Ivica Zubac", "reb", 7000), z6 = get("IND", "Ivica Zubac", "reb", 6000);
    ok(z7?.status === "review" && z6?.status === "review" && z7.checks.some((c) => /2 different current/.test(c)), "IND table: two rows implying different totals for one player and stat are both flagged (Zubac 6,671 vs 5,294 rebounds)", JSON.stringify(z7?.checks));
    ok(!more.IND.milestones.some((m) => /Siakam passed|Carlisle/.test(m.sources[0].text)), "IND table: the prose column beside it is not read as rows");
    // Brooklyn p.11: letter-spaced headings, progress cards in two columns
    ok(more.BKN.meta.opponent === "DAL", "BKN notes: opponent is Dallas ('nets' inside 'Hornets' no longer counts as Brooklyn)", JSON.stringify(more.BKN.meta.opponentEvidence));
    has("BKN cards: Julius Randle 15,352 / 16,000 points", get("BKN", "Julius Randle", "pts", 16000), { current: 15352, status: "ok" });
    has("BKN cards: Day'Ron Sharpe 683 / 700 offensive rebounds", get("BKN", "Day'Ron Sharpe", "oreb", 700), { current: 683 });
    has("BKN cards: 'G A M E S P L AY E D' (a kerned pair) is still a heading (Randle 797 / 800 games)", get("BKN", "Julius Randle", "gp", 800), { current: 797, status: "ok" });
    ok(!get("BKN", "Julius Randle", "ftm", 800) && !!get("BKN", "Keon Ellis", "gp", 250), "BKN cards: games-played cards are not read as free throws");
    ok(more.BKN.milestones.length === 30 && more.BKN.milestones.every((m) => m.status === "ok"), "BKN: 30 cards, each % COMPLETE agrees with its current / target", String(more.BKN.milestones.length));
    // Minnesota bios: UPCOMING/RECENT MILESTONES column
    has("MIN bios: DiVincenzo …2 GAMES FOR 500", get("MIN", "Donte DiVincenzo", "gp", 500), { current: 498, need: 2, status: "ok" });
    has("MIN bios: DiVincenzo …1 STEAL FOR 600", get("MIN", "Donte DiVincenzo", "stl", 600), { current: 599, need: 1 });
    has("MIN bios: '...' as well as '…' (Beringer ...16 BLOCKS FOR 50)", get("MIN", "Joan Beringer", "blk", 50), { current: 34, need: 16 });
    has("MIN bios: 'OFF REB' is offensive rebounds (McDaniels ...4 OFF REB FOR 500)", get("MIN", "Jaden McDaniels", "oreb", 500), { current: 496, need: 4, status: "ok" });
    ok(!more.MIN.milestones.some((m) => /100TH REBOUND|200TH POINT/i.test(m.sources[0].text)), "MIN bios: recent milestones (with a date) are not upcoming");
    ok(more.MIN.milestones.length === 60, "MIN: 60 upcoming bio milestones", String(more.MIN.milestones.length));
    // Dallas p.5 sentences; Houston p.5 sentence
    has("DAL sentence: P.J. Washington Jr. needs 12 assists (988) to reach 1,000", get("DAL", "P.J. Washington", "ast", 1000), { current: 988, need: 12, scope: "career", status: "ok" });
    has("DAL sentence: Naji Marshall needs 76 field goals (1,424) to reach 1,500", get("DAL", "Naji Marshall", "fgm", 1500), { current: 1424, need: 76 });
    const kd = get("HOU", "Kevin Durant", "pts", null, { passing: "Kobe Bryant" });
    ok(kd && kd.player === "Kevin Durant" && kd.need === 816 && kd.scope === "nba" && kd.passing.rank === 4, "HOU sentence: Durant needs 816 points to pass Kobe Bryant for 4th (NBA); the heading before his name is not part of it", JSON.stringify(kd && { p: kd.player, s: kd.scope, pass: kd.passing }));
  }
  // Drop-shadow text layer (Dallas player pages)
  {
    const f = path.join(root, "samples", "2026-11-10-more", "mavericks.pdf");
    if (fs.existsSync(f)) {
      const { readPdf } = await import("../src/notes/pdf-layout.js");
      const d = await readPdf(fs.readFileSync(f));
      const p14 = d.pages.find((p) => p.page === 14);
      ok(p14.shadowDropped > 300 && p14.lines.some((l) => l.cells.some((c) => c.text === "STLS")) && !p14.lines.some((l) => /STLSSTLS|6\.16\.1/.test(l.text)), "pdf: a page drawn twice (drop shadow) is read once (DAL p.14 'STLS', not 'STLSSTLS')", String(p14.shadowDropped));
    }
    const run = (strs, shift) => strs.map((s, i) => ({ str: s, x: 10 + i * 20 + shift, y: 500 - Math.floor(i / 5) * 12 + (shift ? 0.8 : 0), w: 10, h: 8 }));
    const words = Array.from({ length: 40 }, (_, i) => `w${i % 7}`);
    const a = [...run(words, 0), ...run(words, -3)];
    ok(dropShadowLayer(a) === 40 && a.length === 40, "pdf: a repeated, shifted copy of a page's runs is dropped");
    const b = run(words, 0), n = b.length;
    ok(dropShadowLayer(b) === 0 && b.length === n, "pdf: a page without a copy is left exactly as it is");
  }
  // A notes page not updated for the last game before the notes date (Brooklyn 2026-11-08)
  {
    const one = (career) => ({ ok: true, stale: false, warnings: [], data: { rows: [{ season: "2026-27", teamId: "17", stats: {} }], career } });
    const line = (id, stats) => ({ id, team: "BKN", played: true, stats });
    const fake = {
      teams: async () => ({ ok: true, warnings: [], data: { ids: { BKN: "17" } } }),
      roster: async () => ({ ok: true, warnings: [], data: { players: [{ id: "a", name: "Ann One" }, { id: "b", name: "Bob Two" }, { id: "c", name: "Cy Three" }, { id: "d", name: "Di Four" }] } }),
      schedule: async () => ({ ok: true, warnings: [], data: { games: [{ id: "g1", date: "2026-11-07", final: true, seasonType: 2 }] } }),
      box: async () => ({ ok: true, warnings: [], data: { final: true, players: [line("a", { pts: 19 }), line("b", { pts: 6 }), line("c", { pts: 12 }), line("d", { pts: 4 })] } }),
      career: async (id) => one({ a: { pts: 1019 }, b: { pts: 506 }, c: { pts: 712 }, d: { pts: 409 } }[id]),
    };
    const m = (player, cur, page = 11) => ({ team: "BKN", player, stat: "pts", kind: "round", scope: "career", current: cur, target: cur + 100, need: 100, status: "ok", checks: [], sources: [{ format: "progress-cards", page }] });
    const tr = await trackMilestones({ team: "BKN", notesDate: "2026-11-08", milestones: [m("Ann One", 1000), m("Bob Two", 500), m("Cy Three", 700), m("Di Four", 400)], espn: fake });
    const st = tr.milestones.map((x) => x.tracking);
    ok(st[0].status === "corrected" && st[0].current === 1019 && st[0].corrected.gamesBefore === 1 && st[1].status === "corrected" && st[2].status === "corrected", "tracking: a page short by exactly the last game before the notes date, for most of its rows, is corrected", JSON.stringify(st.map((t) => t.status)));
    ok(st[3].status === "disagrees" && tr.milestones[3].status === "review", "tracking: a row on that page the missed game doesn't explain still disagrees (+5, game had 4)", JSON.stringify(st[3]));
    const tr2 = await trackMilestones({ team: "BKN", notesDate: "2026-11-08", milestones: [m("Ann One", 1000), m("Di Four", 400), m("Bob Two", 499)], espn: fake });
    ok(tr2.milestones[0].tracking.status === "disagrees", "tracking: one row matching a missed game is a coincidence, not a stale page (fewer than 3)", JSON.stringify(tr2.milestones.map((x) => x.tracking.status)));
  }
}
} // end: needs the notes PDFs (samples/)

// ---------- 0.72.2: a build after today's game is final still counts from "entering today" (the user, 11/15) ----------
// IND @ PHI was a matinee; the 5 PM build added it to every PHI total, and NBA Live then added tonight's box score again:
// Jaylen Brown "reached 2,000 assists" at 1,999, and LeBron James passing Jason Kidd was "reached since the notes" (no card).
{
  const line = (id, ast, min) => ({ id, team: "PHI", played: true, started: true, stats: { ast, min, pts: 10 } });
  const make = (inEspn) => {
    const extra = inEspn ? 1 : 0;
    const car = { a: { ast: 1997 + 2 * extra, gp: 600 + extra }, b: { ast: 12081 + 11 * extra, gp: 1500 + extra } };
    return {
      teams: async () => ({ ok: true, warnings: [], data: { ids: { PHI: "20" } } }),
      roster: async () => ({ ok: true, warnings: [], data: { players: [{ id: "a", name: "Jay Brown" }, { id: "b", name: "Lee James" }] } }),
      schedule: async () => ({ ok: true, warnings: [], data: { games: [{ id: "g0", date: "2026-11-13", final: true, seasonType: 2 }, { id: "g1", date: "2026-11-15", final: true, seasonType: 2, start: "2026-11-15T18:00Z", teams: ["PHI", "IND"], home: "PHI", away: "IND" },
        { id: "g2", date: "2026-11-17", final: false, seasonType: 2 }] } }),
      box: async (id) => ({ ok: true, warnings: [], data: { final: true, players: id === "g1" ? [line("a", 2, 34), line("b", 11, 36)] : [line("a", 5, 30), line("b", 9, 33)] } }),
      career: async (id) => ({ ok: true, stale: false, warnings: [], data: { rows: [{ season: "2025-26", teamId: "2", stats: { gp: 70, ast: 300 } }, { season: "2026-27", teamId: "20", stats: { gp: 1 + extra, ast: (id === "a" ? 5 : 9) + (id === "a" ? 2 : 11) * extra } }], career: car[id] } }),
      gameLog: async () => ({ ok: true, warnings: [], data: { types: [{ name: "2026-27 Regular Season", playIn: false, games: [{ id: "g0", stats: { ast: 6, pts: 20 } }, ...(inEspn ? [{ id: "g1", stats: { ast: 4, pts: 18 } }] : [])] }] } }),
      injuries: async () => ({ ok: true, warnings: [], data: { players: {} } }),
    };
  };
  const ms = () => [
    { team: "PHI", player: "Jay Brown", stat: "ast", label: "assists", kind: "round", scope: "career", current: 1997, target: 2000, need: 3, status: "ok", checks: [], sources: [] },
    { team: "PHI", player: "Lee James", stat: "ast", label: "assists", kind: "pass", scope: "nba", current: 12081, target: 12092, need: 11, passing: { player: "Old Kidd", rank: 3 }, status: "ok", checks: [], sources: [] },
  ];
  for (const inEspn of [false, true]) {
    const tr = await trackMilestones({ team: "PHI", notesDate: "2026-11-15", milestones: ms(), espn: make(inEspn), today: "2026-11-15" });
    const [a, b] = tr.milestones.map((x) => x.tracking);
    ok(a.current === 1997 && a.need === 3 && !a.reached && a.status === "confirmed" && b.current === 12081 && b.need === 11 && !b.reached && b.status === "confirmed",
      `tracking 0.72.2: today's finished game is not added to the entering totals (ESPN ${inEspn ? "already has" : "hasn't yet added"} the game): 1,997 and 3 to go, confirmed`, JSON.stringify([a.current, a.need, a.status, a.notes, b.current, b.need, b.status]));
  }
  const old = await trackMilestones({ team: "PHI", notesDate: "2026-11-15", milestones: ms(), espn: make(false) });
  ok(old.milestones[0].tracking.current === 1999 && old.milestones[1].tracking.reached, "tracking: without a day given (the one-team script), finished games on or after the notes date are still added");
  const w = await buildWatch({ team: "PHI", notesDate: "2026-11-15", milestones: ms(), espn: make(true), today: "2026-11-15", sims: 300 });
  ok(w.tonightGame?.id === "g1" && w.items[0].need === 3 && !w.items[0].reached && w.items[0].pTonight != null && w.items[1].need === 11 && !w.items[1].reached,
    "watch 0.72.2: today's game stays tonight's game once it is final, and nothing counts as reached before it", JSON.stringify([w.tonightGame, w.items.map((i) => [i.need, i.reached, i.pTonight, i.note])]));
  const d1 = await discoverMilestones({ team: "PHI", espn: make(true), today: "2026-11-15" });
  const d0 = await discoverMilestones({ team: "PHI", espn: make(false), today: "2026-11-15" });
  const br = (d) => d.milestones.find((m) => m.player === "Jay Brown" && m.stat === "ast");
  ok(br(d1)?.current === 1997 && br(d1)?.need === 3 && br(d0)?.current === 1997 && br(d0)?.need === 3,
    "discovery 0.72.2: ESPN's totals are taken back to entering today once ESPN has added today's game, and left alone before it has", JSON.stringify([br(d1), br(d0), d1.problems]));
}

// ---------- 0.72.4: a Basketball Reference total the user checked settles a notes-vs-ESPN difference ----------
{
  const fake = {
    teams: async () => ({ ok: true, warnings: [], data: { ids: { WAS: "27" } } }),
    roster: async () => ({ ok: true, warnings: [], data: { players: [{ id: "a", name: "Tony Davis" }, { id: "b", name: "Other Guy" }] } }),
    schedule: async () => ({ ok: true, warnings: [], data: { games: [] } }),
    box: async () => ({ ok: false, error: "none" }),
    career: async (id) => ({ ok: true, stale: false, warnings: [], data: { rows: [{ season: "2026-27", teamId: "27", stats: { gp: 11 } }], career: id === "a" ? { reb: 8752 } : { reb: 500 } } }),
  };
  const m = (player, current) => ({ team: "WAS", player, stat: "reb", label: "rebounds", kind: "round", scope: "career", current, target: 9000, need: 9000 - current, status: "ok", checks: [], sources: [] });
  const rows = (value) => ({ rows: [{ player: "Tony Davis", stat: "reb", scope: "career", value, asOf: "2026-11-14" }] });
  const run1 = async (verified) => (await trackMilestones({ team: "WAS", notesDate: "2026-11-15", today: "2026-11-15", milestones: [m("Tony Davis", 8751), m("Other Guy", 499)], espn: fake, verified })).milestones;
  const [d1, o1] = await run1(rows(8752)), [d2] = await run1(rows(8751)), [d3] = await run1(null), [d4] = await run1(rows(8740));
  ok(d1.tracking.status === "corrected" && d1.tracking.current === 8752 && d1.tracking.need === 248 && d1.status !== "review" && /ESPN and Basketball Reference \(through 2026-11-14\) say 8752/.test(d1.tracking.notes.join(" "))
    && o1.tracking.status === "disagrees" && d3.tracking.status === "disagrees" && d3.status === "review" && d4.tracking.status === "disagrees",
    "tracking 0.72.4: notes one short of ESPN, and Basketball Reference with ESPN: ESPN's total is used and it isn't a disagreement; no confirmation, an old one, or another player's row settles nothing", JSON.stringify([d1.tracking.status, d1.tracking.current, d1.status, o1.tracking.status, d3.tracking.status, d4.tracking.status]));
  ok(d2.tracking.status === "disagrees" && /Basketball Reference \(through 2026-11-14\) agrees with the notes/.test(d2.checks.join(" ")), "tracking 0.72.4: when Basketball Reference sides with the notes, the difference stays flagged and says so", d2.checks.join(" | "));
}

// ---------- ESPN-only discovery never repeats a notes milestone (site showed "J. Tatum" and "Jayson Tatum") ----------
{
  const fake = {
    teams: async () => ({ ok: true, warnings: [], data: { ids: { BOS: "2" } } }),
    roster: async () => ({ ok: true, warnings: [], data: { players: [{ id: "4065648", name: "Jayson Tatum" }] } }),
    career: async () => ({ ok: true, stale: false, warnings: [], data: { rows: [{ season: "2026-27", stats: { gp: 9, fgm: 80 } }], career: { gp: 700, fgm: 4981 } } }),
  };
  const notesItem = { player: "J. Tatum", espnId: "4065648", stat: "fgm", target: 5000 };
  const a = await discoverMilestones({ team: "BOS", espn: fake, skip: [notesItem] });
  const b = await discoverMilestones({ team: "BOS", espn: fake, skip: [] });
  ok(!a.milestones.some((m) => m.stat === "fgm" && m.target === 5000) && b.milestones.some((m) => m.stat === "fgm" && m.target === 5000),
    "discover: a notes milestone written with an initial (J. Tatum) is matched by ESPN id, so it isn't listed twice", JSON.stringify(a.milestones.map((m) => [m.player, m.stat, m.target])));
}

// ---------- Team situations (records by game situation, from ESPN results) ----------
{
  // Scoreboard reading: final score, points by period (OT included), the season calendar.
  const comp = (homeAway, abbr, name, score, q) => ({ homeAway, score: String(score), team: { abbreviation: abbr, displayName: name }, linescores: q.map((value) => ({ value })) });
  const ev = (id, date, done, period, home, away, type = 2) => ({ id, date, season: { type }, competitions: [{ status: { period, type: { completed: done, state: done ? "post" : "pre" } }, competitors: [home, away] }] });
  const sbJson = { leagues: [{ season: { year: 2027 }, calendar: ["2026-10-20T07:00Z", "2026-10-21T07:00Z"] }], events: [
    ev("1", "2026-10-21T23:30Z", true, 5, comp("home", "BOS", "Boston Celtics", 110, [25, 25, 25, 25, 10]), comp("away", "NY", "New York Knicks", 108, [30, 20, 30, 20, 8])),
    ev("2", "2026-10-21T23:30Z", false, 0, comp("home", "MIA", "Miami Heat", 0, []), comp("away", "ORL", "Orlando Magic", 0, [])),
    ev("3", "2026-10-21T23:30Z", true, 4, comp("home", "LAL", "Los Angeles Lakers", 100, [25, 25, 25, 25]), comp("away", "GS", "Golden State Warriors", 90, [20, 20, 25, 25]), 1),
  ] };
  const sb = readScoreboard(sbJson);
  const r1 = sb.games.find((g) => g.id === "1");
  ok(r1.final && r1.periods === 5 && r1.homeScore === 110 && r1.awayTri === "NYK" && r1.homeQ.length === 5 && sb.calendar.join() === "2026-10-20,2026-10-21" && sb.season === 2027,
    "scoreboard: final score, five periods (one OT), team codes and the season calendar are read", JSON.stringify({ r1, cal: sb.calendar }));
  const row = rowFromGame(r1);
  ok(row && row.ot === 1 && row.h === "BOS" && row.a === "NYK" && row.hs === 110, "results: a finished regular-season game becomes a row, overtime counted", JSON.stringify(row));
  ok(rowFromGame(sb.games.find((g) => g.id === "2")) === null && rowFromGame(sb.games.find((g) => g.id === "3")) === null, "results: unfinished games and preseason games are left out");
  {
    // 0.111: the Cup's title game is kept out twice: by ESPN's label (another season type) and by its date
    const fin = { id: "9", date: "2026-12-11", final: true, seasonType: 2, homeTri: "NYK", awayTri: "OKC", homeScore: 110, awayScore: 104 };
    ok(rowFromGame(fin) === null && rowFromGame({ ...fin, date: "2026-12-12" }) !== null && rowFromGame({ ...fin, date: "2026-12-12", seasonType: "cup-final" }) === null,
      "0.111: a game on the day of the NBA Cup's title game (12/11/26, confirmed by the user and by ESPN's schedule) is not collected even if it arrives labelled regular season; the same game a day later is");
  }

  // Collecting: finished dates are kept and not asked for again; a date with an
  // unfinished game is asked again, unless it is 3+ days old (postponed).
  const asked = [];
  const day = (d, done) => ({ ok: true, warnings: [], data: { season: 2027, calendar: ["2026-10-20", "2026-10-21", "2026-10-25"], games: [{ id: d, date: d, seasonType: 2, final: done, homeTri: "BOS", awayTri: "NYK", homeScore: 100, awayScore: 99, homeQ: [25, 25, 25, 25], awayQ: [25, 25, 25, 24], periods: 4 }] } });
  const fakeSb = { scoreboard: async (d) => { asked.push(d); return day(d, d !== "2026-10-21" && d !== "2026-10-25"); }, detail: async () => ({ ok: false, error: "no summary (test)" }) };
  let store = await collectResults({ espn: fakeSb, store: null, through: "2026-10-25" });
  ok(store.dates["2026-10-20"].complete && store.dates["2026-10-21"].complete && !store.dates["2026-10-25"].complete && allGames(store).length === 1,
    "results: a finished date is complete; an unfinished game 4 days back counts as postponed; tonight's unfinished one is not", JSON.stringify(store.dates));
  asked.length = 0;
  store = await collectResults({ espn: fakeSb, store, through: "2026-10-25" });
  ok(asked.join() === "2026-10-25,2026-10-20" && store.qsweep === 1, "results: a second run asks ESPN for dates not yet complete, and once for each recent finished date's quarter scores (0.78)", asked.join());
  // Stat corrections (0.60): a game's summary is read again once a day for 3 days; a change is noted, a failed re-read keeps the old.
  {
    let pts = 20, fail = false, reads = 0;
    const det = { scoreboard: async (d) => day(d, true), detail: async (id) => { if (id === "2026-10-20") reads++; return fail ? { ok: false, error: "x" } : { ok: true, data: { final: true, plays: [1], scoreOk: true,
      home: [40, 80, 10, 30, 10, 12, 0], away: [40, 80, 9, 30, 10, 12, 0], players: { 7: { side: "home", starter: true, min: 30, s: [pts], name: "P7" } } } }; } };
    let st = await collectResults({ espn: det, store: null, through: "2026-10-20" });
    const r0 = st.dates["2026-10-20"].games[0];
    const once = reads; st = await collectResults({ espn: det, store: st, through: "2026-10-20" });
    const same = reads === once;
    pts = 22; st = await collectResults({ espn: det, store: st, through: "2026-10-21" });
    const fixed = st.corrected.join() === "2026-10-20" && r0.pl[7][3] === 22;
    const again = reads; st = await collectResults({ espn: det, store: st, through: "2026-10-21" });
    const oncePerDay = reads === again;
    fail = true; st = await collectResults({ espn: det, store: st, through: "2026-10-22" });
    const kept = r0.pl[7][3] === 22 && !st.corrected.length;
    fail = false; const r4 = reads; await collectResults({ espn: det, store: st, through: "2026-10-24" });
    ok(r0.x && same && fixed && oncePerDay && kept && reads === r4,
      "results (0.60): stat corrections: a recent game is re-read once a day (changes noted, a failed read keeps the old line), not past 3 days", JSON.stringify({ same, fixed, oncePerDay, kept, reads, r4 }));
  }
  // 0.132.0: plays that don't add up hold back clutch only; the box score that matches the final is kept (NYK@MIN 11/19).
  {
    let good = false, reads = 0;
    const det = { scoreboard: async (d) => day(d, true), detail: async (id) => { if (id === "2026-10-20") reads++; return { ok: true, data: { final: true, plays: [1], scoreOk: good, clutch: good ? { home: 5, away: 3 } : null,
      home: [40, 80, 10, 30, 10, 12, 0], away: [40, 80, 9, 30, 10, 12, 0], players: { 7: { side: "home", starter: true, min: 30, s: [20], name: "P7" }, 8: { side: "away", starter: false, min: 12, s: [4], name: "P8" } } } }; } };
    const w1 = []; let st = await collectResults({ espn: det, store: null, through: "2026-10-20", warnings: w1 });
    const r0 = st.dates["2026-10-20"].games[0];
    const boxKept = r0.pl && r0.pl[7][3] === 20 && r0.pl[8][0] === 1 && r0.hb && !r0.x && !r0.cl && /box score kept/.test(w1.join());
    const n1 = reads; good = true; st = await collectResults({ espn: det, store: st, through: "2026-10-21" });
    const r1 = st.dates["2026-10-20"].games[0];
    ok(boxKept && reads === n1 + 1 && r1.x === 1 && r1.cl && r1.pl[7][3] === 20,
      "results (0.132): plays that don't add up keep the box score (player lines, team totals) and hold back only clutch; the game is read again until the plays add up", JSON.stringify({ boxKept, x: r1.x, cl: r1.cl, w1 }));
  }

  // Records. Four teams; A beats everyone; quarters set so each situation is exercised.
  const g = (id, d, h, a, hq, aq, extra = {}) => ({ id, d, h, a, hs: hq.reduce((x, y) => x + y), as: aq.reduce((x, y) => x + y), hq, aq, ot: hq.length - 4, ...extra });
  const rows = [
    g("1", "2026-10-21", "AAA", "BBB", [20, 20, 30, 30], [30, 30, 20, 10]), // AAA trails at half (40-60) and after 3 (70-80), wins 100-90
    g("2", "2026-10-22", "CCC", "AAA", [25, 25, 25, 26], [25, 25, 25, 28]), // tied at half and after 3; AAA wins by 2 on the road
    g("3", "2026-10-23", "AAA", "DDD", [30, 30, 30, 20, 10], [20, 20, 30, 40, 5]), // AAA leads at half, after 3; overtime, wins by 5
    g("4", "2026-10-24", "BBB", "CCC", [30, 30, 30, 30], [20, 20, 20, 20], { n: true }), // neutral site
    g("5", "2026-10-25", "DDD", "BBB", [10, 10, 10, 10], [30, 30, 30, 30]),
  ];
  const tgs = teamGames(rows);
  const a1 = tgs.find((x) => x.id === "1" && x.team === "AAA");
  ok(a1.half === -20 && a1.after3 === -10 && a1.win && a1.home, "situations: half and after-3 margins come from the quarter scores", JSON.stringify(a1));
  const S = computeSituations(rows, { through: "2026-10-25" });
  const A = S.teams.AAA.splits, B = S.teams.BBB.splits;
  ok(wl(A.all) === "3-0" && wl(A.trailHalf) === "1-0" && wl(A.trail3) === "1-0" && wl(A.tiedHalf) === "1-0" && wl(A.tied3) === "1-0" && wl(A.leadHalf) === "1-0" && wl(A.ot) === "1-0" && wl(A.close) === "1-0" && wl(A.ten) === "1-0",
    "situations: AAA 3-0, 1-0 trailing at half, tied at half, leading at half, overtime, decided by 3 or fewer, by 10+", JSON.stringify(A));
  ok(wl(A.home) === "2-0" && wl(A.road) === "1-0" && !B.home?.w && wl(B.road) === "1-1" && (B.all.w + B.all.l) === 3, "situations: a neutral-site game is neither home nor road", JSON.stringify(B));
  // Records now: AAA 3-0, BBB 2-1, CCC 0-2, DDD 0-2. Over .500: AAA, BBB.
  ok(wl(A.vsAbove) === "1-0" && wl(A.vsBelow) === "2-0" && wl(S.teams.CCC.splits.vsAbove) === "0-2", "situations: 'vs teams over .500' uses each opponent's record now", JSON.stringify({ A: [A.vsAbove, A.vsBelow], C: S.teams.CCC.splits }));
  // Going into each game (the user, 11/12): game 1 both 0-0 (no bucket); CCC met AAA at 1-0 (over); BBB met CCC at 0-1 (under);
  // DDD met BBB at 1-1 (exactly .500); BBB met DDD at 0-1 (under).
  const C = S.teams.CCC.splits, D = S.teams.DDD.splits;
  ok(!A.vsAboveThen && !A.vsBelowThen && !A.vs500Then && wl(C.vsAboveThen) === "0-1" && wl(C.vsBelowThen) === "0-1" && wl(B.vsBelowThen) === "2-0" && wl(D.vs500Then) === "0-1" && wl(D.vsAboveThen) === "0-1",
    "situations: 'at the time' uses each opponent's record going into the game; games against a 0-0 team fall in no bucket", JSON.stringify({ A, B, C, D }));
  ok(!Object.values(S.teams).some((t) => t.splits.vs500) && S.labels.vs500 === "vs teams at .500" && Object.values(S.teams).every((t) => !t.flags.some((f) => f.key.endsWith("Then"))) && !S.unusual.some((u) => u.key.endsWith("Then")),
    "situations: a .500 split only where an opponent is exactly .500; 'at the time' splits are never flagged or listed as unusual");
  // Exactly .500 now counts as .500, not 'under' (it used to be '.500 or below').
  // CCC beats DDD, DDD beats BBB: BBB is 2-2 today.
  const even2 = computeSituations([...rows, g("6", "2026-10-26", "CCC", "DDD", [30, 30, 30, 30], [20, 20, 20, 20]), g("9", "2026-10-29", "DDD", "BBB", [30, 30, 30, 30], [20, 20, 20, 20])]);
  ok(wl(even2.teams.AAA.splits.vs500) === "1-0" && !even2.teams.AAA.splits.vsBelow?.l && wl(even2.teams.AAA.splits.vsBelow) === "2-0", "situations: games against a team at .500 today go in 'vs .500'", JSON.stringify(even2.teams.AAA.splits));
  ok(S.teams.AAA.streak === "W3" && wl(S.teams.AAA.last10) === "3-0" && S.teams.DDD.streak === "L2", "situations: streak and last 10");
  // Trailing at half: AAA won once (game 1); DDD, CCC, DDD lost (games 3-5). Leading is the mirror.
  ok(wl(S.baseline.trailHalf) === "1-3" && wl(S.baseline.leadHalf) === "3-1" && S.baseline.close.pct === 0.5 && S.baseline.all.pct === 0.5, "situations: league baselines are counted from both sides of every game", JSON.stringify(S.baseline));
  // Flags: 1% bar with team strength. A 1-10 team going 0-8 in 10-point games is not flagged.
  const many = [];
  for (let i = 0; i < 11; i++) many.push(g(`m${i}`, `2026-11-${String(i + 1).padStart(2, "0")}`, "MIL", i % 2 ? "XXX" : "YYY", i === 0 ? [30, 30, 30, 30] : [20, 20, 20, 20], i === 0 ? [20, 20, 20, 20] : (i < 9 ? [25, 25, 25, 25] : [21, 21, 20, 20])));
  const M = computeSituations(many);
  ok(wl(M.teams.MIL.splits.all) === "1-10" && M.teams.MIL.flags.length === 0, "situations: a bad team losing big games isn't flagged; strength is part of the expectation", JSON.stringify(M.teams.MIL.flags));
  const hot = [];
  for (let i = 0; i < 6; i++) hot.push(g(`h${i}`, `2026-12-${String(i + 1).padStart(2, "0")}`, "HHH", `O${i}`, [20, 20, 20, 50], [30, 30, 30, 10])); // HHH trails after 3, wins all 6
  for (let i = 0; i < 40; i++) hot.push(g(`z${i}`, `2026-12-${String((i % 28) + 1).padStart(2, "0")}`, `P${i % 8}`, `Q${i % 8}`, [30, 30, 30, 30], [20, 20, 20, 20])); // leaders win: trailing teams 0-40
  const H = computeSituations(hot);
  const f = H.teams.HHH.flags.find((x) => x.key === "trail3");
  ok(f && f.p <= 0.01 && /6-0 when trailing after 3 quarters/.test(f.text) && H.unusual[0].team === "HHH", "situations: 6-0 when trailing after 3, where trailing teams win 13%, is flagged and ranked first", JSON.stringify(H.teams.HHH.flags));
  const u3 = H.unusual.find((u) => u.key === "trail3");
  ok(u3 && u3.short === "6-0 when trailing after 3 quarters" && u3.list.length === 6 && u3.list.every((g) => g.w && g.d && g.opp && g.pf > g.pa),
    "situations (0.65): an unusual record carries its short line and the games behind it", JSON.stringify([u3?.short, u3?.list?.length]));

  // Clutch time and team box totals from a game summary.
  ok(clockSeconds("4:47") === 287 && clockSeconds("5:00") === 300 && clockSeconds("51.2") === 51.2 && clockSeconds("") === null, "detail: game clock read as seconds left");
  const play = (period, clock, away, home) => ({ period: { number: period }, clock: { displayValue: clock }, awayScore: away, homeScore: home });
  const stat = (name, v) => ({ name, displayValue: v });
  const teamBox = (ha, fg, fg3, ft) => ({ homeAway: ha, statistics: [stat("fieldGoalsMade-fieldGoalsAttempted", fg), stat("threePointFieldGoalsMade-threePointFieldGoalsAttempted", fg3), stat("freeThrowsMade-freeThrowsAttempted", ft),
    stat("offensiveRebounds", "10"), stat("defensiveRebounds", "30"), stat("assists", "25"), stat("steals", "7"), stat("blocks", "5"), stat("totalTurnovers", "12"), stat("fouls", "18")] });
  // Plays are given as running scores (away-home); they become scoring plays with team and points,
  // which is what the reader counts. Home team id "4" (CHI), away "20" (PHI).
  const detailJson = (rawPlays, final = null) => {
    let ph = 0, pa = 0;
    const plays = [];
    for (const r of rawPlays) {
      const dA = r.awayScore - pa, dH = r.homeScore - ph;
      if (dA > 0) plays.push({ ...r, scoringPlay: true, scoreValue: dA, team: { id: "20" } });
      else if (dH > 0) plays.push({ ...r, scoringPlay: true, scoreValue: dH, team: { id: "4" } });
      else plays.push({ ...r, scoringPlay: false, scoreValue: 0 });
      ph = r.homeScore; pa = r.awayScore;
    }
    return { header: { id: "9", competitions: [{ status: { type: { completed: true } }, competitors: [{ homeAway: "home", team: { id: "4" }, score: String(final ? final[1] : ph) }, { homeAway: "away", team: { id: "20" }, score: String(final ? final[0] : pa) }] }] },
      boxscore: { teams: [teamBox("home", "40-85", "12-35", "16-20"), teamBox("away", "38-90", "10-30", "14-18")] }, plays };
  };
  // Philadelphia at Chicago, 2026-11-08, by hand from the play-by-play: clutch time starts at 4:47 (113-110);
  // the plays at 3:31 (116-110) and 1:31 (123-116) came with the gap above 5, so they don't count.
  const pbp = [play(4, "6:00", 113, 0), play(4, "6:00", 113, 106), play(4, "5:35", 113, 108), play(4, "5:05", 113, 110), play(4, "4:47", 116, 110), play(4, "3:31", 116, 113), play(4, "3:05", 118, 113),
    play(4, "3:00", 118, 115), play(4, "3:00", 118, 116), play(4, "2:40", 119, 116), play(4, "2:40", 120, 116), play(4, "2:13", 123, 116), play(4, "1:31", 123, 117),
    play(4, "1:31", 123, 118), play(4, "1:09", 123, 120), play(4, "51.2", 124, 120), play(4, "51.2", 125, 120), play(4, "16.5", 125, 121), play(4, "13.4", 126, 121), play(4, "13.4", 127, 121)];
  const det = readGameDetail(detailJson(pbp));
  ok(det.clutch && det.clutch.away === 14 && det.clutch.home === 6, "detail: clutch-time points (PHI 14, CHI 6 in PHI 127-121 at CHI, checked by hand)", JSON.stringify(det.clutch));
  ok(readGameDetail(detailJson([play(3, "1:00", 100, 0), play(3, "1:00", 100, 80), play(4, "4:00", 100, 82), play(4, "1:00", 102, 82)])).clutch === null && readGameDetail(detailJson([play(3, "1:00", 100, 0), play(3, "1:00", 100, 80), play(4, "4:00", 100, 82), play(4, "1:00", 102, 82)])).scoreOk, "detail: a game never within 5 in the last 5 minutes has no clutch time");
  ok(readGameDetail(detailJson([play(3, "1:00", 50, 50), play(4, "6:00", 90, 90), play(4, "6:00", 110, 90)])).clutch === null, "detail: a close game before the last 5 minutes isn't clutch time");
  const bad = readGameDetail(detailJson(pbp, [125, 121]));
  ok(bad.scoreOk === false && bad.clutch === null, "detail: play-by-play that doesn't add up to the final score gives no clutch numbers");
  ok(det.home.join() === "40,85,12,35,16,20,10,30,25,7,5,12,18" && 2 * det.home[0] + det.home[2] + det.home[4] === 108, "detail: team box totals; points from them = 2 per field goal + 1 per three + free throws");
  // A summary whose box doesn't add up to the final score is not used.
  const fakeDet = { scoreboard: async () => day("2026-10-20", true), detail: async () => ({ ok: true, data: { final: true, home: det.home, away: det.away, plays: 5, clutch: null, scoreOk: true } }) };
  const warn = [];
  const st2 = await collectResults({ espn: fakeDet, store: null, through: "2026-10-20", warnings: warn });
  ok(!st2.dates["2026-10-20"].games[0].x && warn.some((w) => /don't match the final/.test(w)), "results: box totals that don't add up to the final score are rejected", warn.join("; "));

  // vs top N records, ties at the cutoff included.
  const T = [];
  let id = 0;
  const play2 = (h, a, homeWins) => T.push(g(`t${id++}`, "2026-11-01", h, a, homeWins ? [30, 30, 30, 30] : [20, 20, 20, 20], homeWins ? [20, 20, 20, 20] : [30, 30, 30, 30]));
  // Records: A 3-0, B 2-1, C 2-1, D 1-2, E 0-3 -> top 2 = A, B, C (B and C tied at the cutoff)
  play2("A", "E", true); play2("A", "D", true); play2("C", "A", false); play2("B", "E", true); play2("B", "C", false); play2("D", "E", true); play2("C", "D", true); play2("D", "B", false); play2("E", "C", true);
  const R = computeSituations(T.map((x) => ({ ...x, x: 1, cl: 0 })));
  ok(R.topTeams[3].sort().join() === "A,B,C" && R.topTeams[5].length === 5, "situations: top-3 by record (A 3-0, B and C 2-2)", JSON.stringify({ rec: Object.fromEntries(Object.entries(R.teams).map(([k, v]) => [k, wl(v.splits.all)])), top: R.topTeams }));
  ok(wl(R.teams.A.splits.vsTop3) === "1-0" && wl(R.teams.D.splits.vsTop3) === "0-3", "situations: record vs the top 3 (a team never counts as its own opponent)", JSON.stringify([R.teams.A.splits.vsTop3, R.teams.D.splits.vsTop3]));

  // Ratings: possessions, offensive and defensive rating, top defenses.
  const box = (fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, tov) => [fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, 20, 5, 5, tov, 18];
  const rr = [
    { id: "r1", d: "2026-11-01", h: "X", a: "Y", hs: 100, as: 90, hb: box(40, 80, 10, 30, 10, 15, 10, 30, 10), ab: box(35, 85, 8, 25, 12, 15, 12, 30, 12) },
    { id: "r2", d: "2026-11-02", h: "Y", a: "Z", hs: 95, as: 110, hb: box(38, 85, 9, 30, 10, 12, 8, 32, 14), ab: box(42, 84, 12, 30, 14, 18, 10, 34, 10) },
    { id: "r3", d: "2026-11-03", h: "Z", a: "X", hs: 105, as: 99, hb: box(40, 82, 10, 28, 15, 20, 9, 33, 11), ab: box(39, 88, 9, 33, 12, 14, 11, 30, 13) },
  ];
  const L = teamGameLines(rr);
  const p1 = (80 - 10 + 10 + 0.44 * 15 + (85 - 12 + 12 + 0.44 * 15)) / 2;
  ok(Math.abs(L[0].poss - p1) < 1e-9 && Math.abs(L[0].poss - 89.1) < 1e-9, "ratings: possessions = FGA - OREB + TOV + 0.44 FTA, averaged over both teams (86.6 and 91.6 -> 89.1)", String(L[0].poss));
  const RT = ratings(L);
  ok(Math.abs(RT.X.ortg - (100 * (100 + 99)) / (L[0].poss + L.find((l) => l.team === "X" && l.opp === "Z").poss)) < 1e-9 && RT.Z.drank === 1, "ratings: offensive rating over a season; best defense ranked 1", JSON.stringify(RT));
  const off = offense([L[0]]);
  ok(Math.abs(off.efg - (40 + 5) / 80) < 1e-9 && Math.abs(off.oreb - 10 / (10 + 30)) < 1e-9 && off.w === 1, "ratings: eFG% (threes count 1.5) and offensive rebound share", JSON.stringify(off));
  const v1 = vsTopDefenses(L, 1);
  ok(v1.top[0].team === "Z" && v1.teams.X.vsTop.games === 1 && v1.teams.X.rest.games === 1 && v1.teams.Z.vsTop === null, "ratings: offense vs the top defense; the top defense itself has none to face", JSON.stringify(v1.teams.Z));

  // vs top teams by record: rank by win %, then wins; ties at the cutoff are all in; net-rating difference.
  {
    const g = (id, d, h, a, hs, as) => ({ id, d, h, a, hs, as, hb: box(40, 85, 10, 30, 15, 20, 10, 30, 12), ab: box(40, 85, 10, 30, 15, 20, 10, 30, 12) });
    // After t1-t5: P 2-0, Q 2-1, R 1-2, S 0-2.
    const G = [g("t1", "2026-11-01", "P", "Q", 110, 100), g("t2", "2026-11-02", "R", "P", 90, 100), g("t3", "2026-11-03", "Q", "R", 105, 100), g("t4", "2026-11-04", "S", "R", 95, 101), g("t5", "2026-11-05", "S", "Q", 99, 102)];
    const LL = teamGameLines(G);
    const R2 = ratings(LL);
    ok(R2.P.rrank === 1 && R2.Q.rrank === 2 && R2.R.rrank === 3 && R2.S.rrank === 4, "vs top teams: record rank by win %, then wins", JSON.stringify(Object.fromEntries(Object.entries(R2).map(([t, r]) => [t, [r.w, r.l, r.rrank]]))));
    const v2 = vsTop(LL, 2, "record");
    ok(v2.top.map((x) => x.team).join() === "P,Q" && v2.teams.R.vsTop.w === 0 && v2.teams.R.vsTop.l === 2 && v2.teams.P.vsTop.games === 1, "vs top teams: W-L against the top 2 (a top team faces only the others in the group)", JSON.stringify(v2.teams.R.vsTop));
    ok(Math.abs(v2.teams.R.diff - (v2.teams.R.vsTop.net - v2.teams.R.rest.net)) < 1e-9 && v2.teams.S.vsTop.margin === -3, "vs top teams: difference is net rating vs top minus vs rest; margin per game", JSON.stringify([v2.teams.R.diff, v2.teams.S.vsTop]));
    // S beats P: P and Q are both 2-1, tied for the top spot.
    const G2 = [...G, g("t6", "2026-11-06", "S", "P", 120, 100)];
    const v3 = vsTop(teamGameLines(G2), 1, "record");
    ok(v3.top.map((x) => x.team).sort().join() === "P,Q" && v3.top.length === 2, "vs top teams: a tie at the cutoff puts both teams in (top 1 has 2 teams at 2-1)", JSON.stringify(v3.top));
    ok(vsTop(LL, 2, "defense").by === "defense" && vsTopDefenses(LL, 2).top.length === 2, "vs top teams: the defense ranking still works");
    // 0.133.0: the same against the bottom N (the "Teams vs the bottom" tab).
    const b2 = vsTop(LL, 2, "record", "bottom");
    ok(R2.S.rbrank === 1 && R2.R.rbrank === 2 && R2.P.rbrank === 4 && b2.side === "bottom" && b2.top.map((x) => x.team).join() === "S,R" && b2.teams.P.vsTop.w === 1 && b2.teams.P.vsTop.games === 1 && b2.teams.S.inTop && !b2.teams.P.inTop,
      "vs bottom teams: rank from the worst record; W-L against the bottom 2 (a bottom team faces only the others in the group)", JSON.stringify(b2.top));
    const b3 = vsTop(teamGameLines(G2), 1, "record", "bottom");   // after S beats P: S 1-2, R 1-2 share the worst record
    ok(b3.top.map((x) => x.team).sort().join() === "R,S", "vs bottom teams: a tie at the cutoff puts both teams in", JSON.stringify(b3.top));
    const { topSet: topSetB } = await import("../src/situations/ratings.js");
    const bd = vsTop(LL, 1, "defense", "bottom"), worstD = Object.entries(R2).sort((a, b) => b[1].drtg - a[1].drtg)[0][0];
    ok(bd.top[0].team === worstD && R2[worstD].dbrank === 1 && [...topSetB(R2, "losing", "record", "bottom")].sort().join() === "R,S", "vs bottom teams: the worst defensive rating ranks 1; 'all losing teams' is every team under .500", JSON.stringify(bd.top));
  }

  // Team leaders: game-by-game leads, season totals, shooting lines.
  {
    // pl = [side, starter, min, pts, fgm, fga, fg3m, fg3a, ftm, fta, reb, ast, tov, stl, blk, oreb, dreb, pf, pm]
    const line = (side, o) => { const v = [side, 1, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; const ix = { min: 2, pts: 3, fgm: 4, fga: 5, fg3m: 6, fg3a: 7, ftm: 8, fta: 9, reb: 10, ast: 11, stl: 13, blk: 14 }; for (const [k, x] of Object.entries(o)) v[ix[k]] = x; return v; };
    const G = [
      // A (home) vs B. a1 20 pts, a2 20 pts (tie), a1 1 blk; nobody on A has a steal.
      { id: "L1", d: "2026-11-01", h: "A", a: "B", hs: 100, as: 90, pl: { a1: line(0, { pts: 20, reb: 5, blk: 1, fgm: 8, fga: 16, fg3m: 2, fg3a: 5, ftm: 2, fta: 2 }), a2: line(0, { pts: 20, reb: 7 }), b1: line(1, { pts: 30, stl: 2 }) } },
      // a1 misses the game (0 minutes, no stats); a2 leads alone.
      { id: "L2", d: "2026-11-03", h: "B", a: "A", hs: 95, as: 99, pl: { a1: line(1, { min: 0 }), a2: line(1, { pts: 25, reb: 9 }), b1: line(0, { pts: 10, stl: 1 }), b2: line(0, { pts: 12, stl: 1 }) } },
      // a1 back, leads points; b1 traded to A: his A line counts with A only.
      { id: "L3", d: "2026-11-05", h: "A", a: "C", hs: 110, as: 100, pl: { a1: line(0, { pts: 31, reb: 2, fgm: 12, fga: 20, fg3m: 3, fg3a: 6, ftm: 4, fta: 4 }), a2: line(0, { pts: 14, reb: 3 }), b1: line(0, { pts: 5, reb: 11 }), c1: line(1, { pts: 22 }) } },
    ];
    const tg = leaderGames(G);
    const gl = gameLeaders(tg);
    const find = (id, team, stat) => gl.find((r) => r.id === id && r.team === team && r.stat === stat);
    const a1p = find("a1", "A", "pts"), a2p = find("a2", "A", "pts");
    ok(a1p.led === 2 && a1p.sole === 1 && a1p.played === 2 && a1p.teamGames === 3 && a1p.run === 2, "leaders: a tie counts as leading (not sole); a missed game neither counts nor breaks the run", JSON.stringify(a1p));
    ok(a2p.led === 2 && a2p.sole === 1 && a2p.played === 3 && a2p.run === 0, "leaders: run ends when he plays and doesn't lead", JSON.stringify(a2p));
    ok(!gl.some((r) => r.team === "A" && r.stat === "stl"), "leaders: a game with no steals on the team has no steals leader");
    const b2s = find("b2", "B", "stl"), b1s = find("b1", "B", "stl");
    ok(b2s.led === 1 && b2s.sole === 0 && b1s.led === 2 && b1s.played === 2 && b1s.teamGames === 2, "leaders: tied steals leaders both credited", JSON.stringify([b1s, b2s]));
    ok(find("b1", "A", "reb").led === 1 && find("b1", "A", "reb").played === 1 && find("b1", "A", "reb").teamGames === 3, "leaders: a traded player's games count with the team he played for that night", JSON.stringify(find("b1", "A", "reb")));
    const sl = seasonLeaders(tg);
    ok(sl.A.leaders.pts.ids.join() === "a2" && sl.A.leaders.pts.total === 59 && sl.A.leaders.pts.margin === 8 && sl.A.totals.a1.games === 2, "leaders: season totals with each team; leader, total, lead over the next player", JSON.stringify(sl.A.leaders.pts));
    ok(sl.B.leaders.pts.total === 40 && sl.B.totals.b1.pts === 40 && sl.A.totals.b1.pts === 5, "leaders: a traded player's totals are split by team", JSON.stringify([sl.B.totals.b1, sl.A.totals.b1]));
    ok(sl.A.categories.a2.map((c) => c.stat).join() === "pts,reb" && sl.A.categories.a1.map((c) => c.stat).join() === "blk,fg3m", "leaders: categories led", JSON.stringify(sl.A.categories));
    ok(cushion(6, 10, 50) === 2 && cushion(5, 10, 50) === 0 && cushion(4, 10, 50) === -1 && needed(4, 10, 50) === 2 && needed(8, 10, 90) === 10 && needed(9, 10, 90) === 0 && cushion(9, 10, 90) === 0 && needed(39, 100, 40) === 2,
      "leaders: shooting math (6-10 can miss 2 and stay at 50%; 4-10 needs 2 makes; 8-10 needs 10 makes for 90%)");
    const sh = shooting(G);
    ok(sh.a1.fg.m === 20 && sh.a1.fg.a === 36 && sh.a1.fg3.m === 5 && sh.a1.ft.m === 6 && sh.a1.games === 2 && sh.b1.team === "A" && sh.b1.games === 3, "leaders: season shooting over all a player's games; latest team", JSON.stringify([sh.a1.fg, sh.b1]));
    ok(sh.a1.fg.minMakes === Math.ceil((300 * 3) / 82) && sh.a1.fg.qualified === true && sh.a1.ft.minMakes === 5 && sh.a1.ft.qualified === true && sh.a1.fg3.minMakes === 3,
      "leaders: qualifiers prorated by team games (300 FGM / 82 x 3 games = 11; 125 FTM -> 5; 82 3PM -> 3)", JSON.stringify(sh.a1));
  }

  // Clutch player lines. Home (team 1): h1-h5 start, h6 on the bench; away (team 2): a1-a5.
  {
    const ath = (t, n) => Array.from({ length: n }, (_, i) => ({ athlete: { id: `${t}${i + 1}`, displayName: `${t.toUpperCase()} ${i + 1}` } }));
    const boxscore = { players: [{ team: { id: "1" }, statistics: [{ athletes: ath("h", 6) }] }, { team: { id: "2" }, statistics: [{ athletes: ath("a", 5) }] }] };
    const P = (per, clock, team, extra) => ({ period: { number: per }, clock: { displayValue: clock }, team: { id: team }, ...extra });
    const who = (...x) => x.map((id) => ({ athlete: { id } }));
    const plays = [
      // 1st quarter: everyone appears once so they're known to be on court; away builds a 10-point lead.
      ...["h1", "h2", "h3", "h4", "h5"].map((id) => P(1, "11:00", "1", { type: { text: "Personal Foul" }, text: `${id} personal foul`, participants: who(id) })),
      ...["a1", "a2", "a3", "a4", "a5"].map((id) => P(1, "10:00", "2", { type: { text: "Jump Shot" }, text: `${id} makes jumper`, shootingPlay: true, scoringPlay: true, scoreValue: 2, pointsAttempted: 2, participants: who(id) })),
      // 4th quarter: home cuts it to 5 before 5:00, so clutch time starts at 5:00.
      P(4, "11:00", "1", { type: { text: "Jump Shot" }, text: "h1 makes three", shootingPlay: true, scoringPlay: true, scoreValue: 3, pointsAttempted: 3, participants: who("h1", "h2") }),
      P(4, "10:00", "1", { type: { text: "Jump Shot" }, text: "h2 makes jumper", shootingPlay: true, scoringPlay: true, scoreValue: 2, pointsAttempted: 2, participants: who("h2") }),
      P(4, "9:00", "2", { type: { text: "Personal Foul" }, text: "a1 foul", participants: who("a1", "a2", "a3", "a4", "a5") }),
      // 4:00 left (60 s of clutch time so far): h1 three, assisted by h3 -> 8-10... score 15-20 -> 18-20
      P(4, "4:00", "1", { type: { text: "Jump Shot" }, text: "h1 makes 25-foot three point jumper (h3 assists)", shootingPlay: true, scoringPlay: true, scoreValue: 3, pointsAttempted: 3, participants: who("h1", "h3") }),
      P(4, "3:30", "2", { type: { text: "Layup Shot" }, text: "h4 blocks a1's layup", shootingPlay: true, scoringPlay: false, scoreValue: 0, pointsAttempted: 2, participants: who("a1", "h4") }),
      P(4, "3:29", "1", { type: { text: "Defensive Rebound" }, text: "h5 defensive rebound", participants: who("h5") }),
      P(4, "3:00", "1", { type: { text: "Substitution" }, text: "h6 enters the game for h2", participants: who("h6", "h2") }),
      P(4, "2:00", "1", { type: { text: "Lost Ball Turnover" }, text: "h6 lost ball turnover (a2 steals)", participants: who("h6", "a2") }),
      P(4, "1:00", "2", { type: { text: "Free Throw - 1 of 2" }, text: "a3 makes free throw 1 of 2", shootingPlay: true, scoringPlay: true, scoreValue: 1, pointsAttempted: 1, participants: who("a3") }),
      P(4, "1:00", "2", { type: { text: "Free Throw - 2 of 2" }, text: "a3 misses free throw 2 of 2", shootingPlay: true, scoringPlay: false, scoreValue: 0, pointsAttempted: 1, participants: who("a3") }),
      P(4, "0.0", "", { type: { text: "End Game" }, text: "End of Game", participants: [] }),
    ];
    const r = clutchPlayers({ boxscore, plays }, { homeId: "1", awayId: "2" });
    const L = (id) => Object.fromEntries(CLUTCH_KEYS.map((k, i) => [k, r.players[id]?.s[i] ?? 0]));
    ok(L("h1").pts === 3 && L("h1").fgm === 1 && L("h1").fg3a === 1 && L("h3").ast === 1 && L("h4").blk === 1 && L("a1").fga === 1 && L("h5").reb === 1 && L("h6").tov === 1 && L("a2").stl === 1 && L("a3").ftm === 1 && L("a3").fta === 2,
      "clutch players: points, threes, assist, block, rebound, turnover, steal, free throws, counted only in clutch time", JSON.stringify(r.players));
    ok(L("h1").fga === 1 && L("h2").fgm === 0, "clutch players: shots before the last 5 minutes don't count");
    // Minutes: h2 on from 5:00 to 3:00 = 120 s; h6 from 3:00 to 0:00 = 180 s; h1 all 300 s.
    ok(L("h1").sec === 300 && L("h2").sec === 120 && L("h6").sec === 180 && r.lineupOk, "clutch players: seconds on court, through a substitution", JSON.stringify({ h1: L("h1").sec, h2: L("h2").sec, h6: L("h6").sec, ok: r.lineupOk }));
    // Plus/minus: home +3 (h1's three) then away +1 (a3's free throw).
    ok(L("h1").pm === 2 && L("h2").pm === 3 && L("h6").pm === -1 && L("a1").pm === -2, "clutch players: plus/minus for whoever was on court", JSON.stringify({ h1: L("h1").pm, h2: L("h2").pm, h6: L("h6").pm, a1: L("a1").pm }));
    // 4th quarter: the same plays, all of period 4 at any score. h1 also gets the 11:00 three; h2 the 10:00 two.
    const q = windowPlayers({ boxscore, plays }, { homeId: "1", awayId: "2" }, WINDOWS.q4);
    const Q = (id) => Object.fromEntries(CLUTCH_KEYS.map((k, i) => [k, q.players[id]?.s[i] ?? 0]));
    ok(Q("h1").pts === 6 && Q("h2").pts === 2 && Q("h3").ast === 1 && Q("h2").ast === 1 && Q("h1").sec === 720 && Q("h2").sec === 540 && Q("h6").sec === 180, "4th quarter: all of period 4 counts, at any score (h1 6 points, 720 s)", JSON.stringify({ h1: Q("h1"), h2: Q("h2").sec }));
    ok(clutchTeamTotals([{ h: "BOS", a: "NYK", cp: { ok: 1, p: { x: [0, 60, 5, 2, 3, 1, 1, 0, 0, 1, 0, 0, 0, 0, 4], y: [1, 60, 3, 1, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, -4] } } }]).NYK.pts === 3, "clutch teams: totals summed per game and side");
    const tot = clutchPlayerTotals([{ d: "2026-11-01", h: "BOS", a: "NYK", cp: { ok: 1, p: { x: [0, 60, 5, 2, 3, 1, 1, 0, 0, 1, 0, 0, 0, 0, 4] } } }, { d: "2026-11-03", h: "MIA", a: "BOS", cp: { ok: 0, p: { x: [1, 30, 2, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, -2] } } }], { x: "Player X" });
    ok(tot[0].name === "Player X" && tot[0].gp === 2 && tot[0].pts === 7 && tot[0].min === 1.5 && tot[0].pm === 2 && tot[0].team === "BOS" && tot[0].unsureGames === 1, "clutch players: season totals, team from the latest game, games with unsure lineups counted", JSON.stringify(tot[0]));
  }

  // Player box lines from a summary.
  {
    const box = readPlayerBox({ boxscore: { players: [{ team: { id: "1" }, statistics: [{ keys: ["minutes", "points", "fieldGoalsMade-fieldGoalsAttempted", "threePointFieldGoalsMade-threePointFieldGoalsAttempted", "freeThrowsMade-freeThrowsAttempted", "rebounds", "assists", "turnovers", "steals", "blocks", "offensiveRebounds", "defensiveRebounds", "fouls", "plusMinus"],
      athletes: [{ athlete: { id: "9", displayName: "Nine" }, starter: true, stats: ["33", "22", "8-16", "2-5", "4-5", "5", "5", "3", "1", "0", "0", "5", "1", "+1"] }, { athlete: { id: "8", displayName: "Eight" }, didNotPlay: true, stats: [] }] }] }] } }, "1");
    ok(box["9"].min === 33 && box["9"].s.join() === "22,8,16,2,5,4,5,5,5,3,1,0,0,5,1,1" && box["9"].starter && box["9"].side === "home" && box["8"].dnp && box["8"].min === 0, "player box: minutes, made-attempted pairs, +/- with a sign, DNP", JSON.stringify(box));
  }
  // With / without: A plays games 1-3, misses 4 and 5; B plays all five.
  {
    const L = (min, pts) => [1, min, pts, 5, 10, 1, 3, 2, 2, 4, 3, 1, 1, 0, 1, 3, 2, 0];
    const file = { team: "XXX", names: { A: "Player A", B: "Player B", C: "Player C" }, games: [
      { id: "1", d: "2026-10-21", pf: 110, pa: 100, pl: { A: L(30, 20), B: L(30, 10) } },
      { id: "2", d: "2026-10-23", pf: 100, pa: 105, pl: { A: L(30, 20), B: L(30, 10) } },
      { id: "3", d: "2026-10-25", pf: 120, pa: 100, pl: { A: L(30, 20), B: L(30, 10) } },
      { id: "4", d: "2026-10-27", pf: 95, pa: 110, pl: { A: L(0, 0), B: L(36, 20) } },
      { id: "5", d: "2026-10-29", pf: 101, pa: 100, pl: { B: L(36, 24), C: L(10, 2) } },
    ] };
    const x = withWithout(file, "A");
    const B = x.players.find((p) => p.id === "B");
    ok(x.games.with === 3 && x.games.without === 2 && x.team.with.w === 2 && x.team.without.w === 1 && x.team.without.margin === -7, "with/without: games, record and average margin with and without A (0 minutes counts as without)", JSON.stringify(x.team));
    ok(B.with.pts === 10 && B.without.pts === 22 && B.without.min === 36 && B.with.gp === 3 && B.without.gp === 2, "with/without: a teammate's per-game averages each way", JSON.stringify(B));
    const C = withWithout(file, "C");
    ok(C.games.with === 1 && C.games.without === 0, "with/without: games before a player's first listing don't count as missed", JSON.stringify(C.games));
    const r = roster(file);
    ok(r[0].id === "B" && r.find((p) => p.id === "A").missed === 2, "with/without: roster sorted by minutes, games missed since first listed", JSON.stringify(r));
  }
  // With the injury reports (inj): D is on the report for games 1-3 and debuts in game 4 (ESPN leaves inactive
  // players out of the box score); E plays 1-2 and is gone from 3 on (traded: on no report).
  {
    const L = (min, pts) => [1, min, pts, 5, 10, 1, 3, 2, 2, 4, 3, 1, 1, 0, 1, 3, 2, 0];
    const file = { team: "XXX", names: { B: "Player B", D: "Player D", E: "Player E" }, games: [
      { id: "1", d: "2026-10-21", pf: 110, pa: 100, pl: { B: L(30, 10), E: L(20, 8) }, inj: { D: "Out" } },
      { id: "2", d: "2026-10-23", pf: 100, pa: 105, pl: { B: L(30, 10), E: L(20, 8) }, inj: { D: "Out" } },
      { id: "3", d: "2026-10-25", pf: 120, pa: 100, pl: { B: L(30, 10) }, inj: { D: "Out" } },
      { id: "4", d: "2026-10-27", pf: 95, pa: 110, pl: { B: L(36, 20), D: L(6, 3) }, inj: {} },
      { id: "5", d: "2026-10-29", pf: 101, pa: 100, pl: { B: L(36, 24) }, inj: { D: "Out" } },
    ] };
    const D = withWithout(file, "D"), E = withWithout(file, "E");
    ok(D.games.with === 1 && D.games.without === 4 && D.games.withoutWhy.join() === "Out,Out,Out,Out" && roster(file).find((p) => p.id === "D").missed === 4,
      "with/without: games on the injury report before his debut count as missed (Knueppel: 1 played, 10 missed)", JSON.stringify(D.games));
    ok(E.games.with === 2 && E.games.without === 0, "with/without: games after he's gone (in no box score, on no report) don't count", JSON.stringify(E.games));
    const { isoDate } = await import("../src/injuries/report.js");
    const { listedIds } = await import("../src/injuries/history.js");
    ok(isoDate("11/02/2026") === "2026-11-02" && isoDate("11/2/26") === "2026-11-02" && isoDate("x") === null, "injury report: game dates read zero-padded or not (\"11/02/2026\" had been missed)");
    const li = listedIds({ rows: [{ team: "CHA", name: "Kon Knueppel", status: "Out" }, { team: "CHA", name: "Nobody Yet", status: "Out" }, { team: "BOS", name: "Kon Knueppel", status: "Out" }] }, { 5: "Kon Knueppel" }, { CHA: new Set(["5"]) });
    ok(JSON.stringify(li) === JSON.stringify({ CHA: [{ id: "5", status: "Out", reason: undefined }] }), "injury report: names matched to the team's player ids only", JSON.stringify(li));
  }
  // Results store, one file per date: round trip, and unchanged files aren't rewritten.
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ncc-store-"));
    const st = { season: 2027, names: { 1: "One" }, dates: { "2026-10-21": { complete: true, games: [{ id: "g" }] } } };
    const w1 = saveStore(dir, st, fs), w2 = saveStore(dir, st, fs);
    const back = loadStore(dir, fs);
    ok(w1 === 2 && w2 === 0 && back.season === 2027 && back.names[1] === "One" && back.dates["2026-10-21"].games[0].id === "g", "results store: a file per date; saving again writes nothing", `${w1} ${w2}`);
    fs.rmSync(dir, { recursive: true });
  }

  // Streaks and outliers. Player P: 7 games, 30+ in the last 4, 10 rebounds in game 2 only,
  // a DNP between games 5 and 6 (doesn't break streaks), 50 points in the last game.
  {
    const ln = (min, pts, reb, ast = 2, fg3m = 1, fgm = 8, fga = 16) => [0, 1, min, pts, fgm, fga, fg3m, 3, 4, 5, reb, ast, 2, 1, 0, 1, reb - 1, 2, 0];
    const pts = [12, 14, 16, 31, 33, 0, 35, 50];
    const rows = pts.map((p, i) => ({ id: `g${i}`, d: `2026-11-0${i + 1}`, h: "AAA", a: i % 2 ? "BBB" : "CCC", hs: 110 + i, as: 100, pl: { P: i === 5 ? ln(0, 0, 0) : ln(34, p, i === 1 ? 10 : 4) } }));
    const pg = playerGames(rows);
    ok(pg.P.length === 7, "streaks: a DNP (0 minutes) isn't a game played", String(pg.P.length));
    const st = activeStreaks(pg, { P: "Player P" });
    const s30 = st.find((x) => x.key === "pts30"), s10 = st.find((x) => x.key === "pts10");
    ok(s30?.length === 4 && s30.since === "2026-11-04" && !s10 && !st.some((x) => x.key === "reb10"), "streaks: 30+ points in 4 straight games played (the DNP doesn't break it); 10+ in 7 is below that kind's minimum of 8; one 10-rebound game isn't a streak", JSON.stringify(st.map((x) => [x.key, x.length])));
    const an = anomalies(pg, { P: "Player P" });
    ok(an.length === 1 && an[0].d === "2026-11-08" && an[0].notes.some((n) => n.stat === "pts" && n.seasonHigh && n.prevHigh === 35), "outliers: 50 points against his other games (season high, previous 35) is listed for the latest date", JSON.stringify(an.map((x) => x.text)));
    const quiet = anomalies(pg, {}, { dates: ["2026-11-03"] });
    ok(!quiet.some((x) => x.notes.some((n) => n.stat === "pts" && !n.low)), "outliers: an ordinary 16-point game isn't listed as a scoring outlier", JSON.stringify(quiet.map((x) => x.text)));
    const ts = teamStreaks(rows);
    ok(ts.AAA.streak.type === "W" && ts.AAA.streak.n === 8 && ts.AAA.home.n === 8 && ts.AAA.road === null && ts.BBB.streak.type === "L", "team streaks: wins, home wins, no road games yet, losses", JSON.stringify(ts.AAA));
    ok(ts.AAA.scored110 === 8 && ts.AAA.under110 === 0 && ts.AAA.held110 === 8 && ts.AAA.held100 === 0 && ts.BBB.under110 > 0 && ts.BBB.allowed120 === 0, "team streaks: 110+ scored, opponents held under 110 but not under 100 (100 isn't under), the losers' own scoring held under 110", JSON.stringify([ts.AAA, ts.BBB]));
  }
}
function wl(r) { return r ? `${r.w}-${r.l}` : "0-0"; }

// ---------- Tonight's storylines (Discord digest) ----------
{
  const item = (o) => ({ player: "P", team: "AAA", stat: "pts", label: "points", kind: "round", scope: "career", target: 10000, need: 5, importance: 30, pTonight: 0.9, publishable: true, ...o });
  const watch = { today: "2026-11-11", games: [{ id: "g1", awayTri: "AAA", homeTri: "BBB", start: "2026-11-12T00:00Z" }, { id: "g2", awayTri: "CCC", homeTri: "DDD", start: "2026-11-12T00:30Z" }], teams: [
    { team: "AAA", items: [item({ player: "Big One" }), item({ player: "Unverified", publishable: false }), item({ player: "Long Shot", pTonight: 0.1 }), item({ player: "Minor", importance: MIN_IMPORTANCE - 1 }), item({ player: "Average", kind: "average-gap" }), item({ player: "Passer", kind: "pass", scope: "nba", passing: { player: "Old Guy", rank: 40 }, need: 2, label: "3-pointers", stat: "fg3m" })] },
    { team: "EEE", items: [item({ player: "Not Tonight" })] },
  ] };
  const trends = { streaks: [
    { id: "9", name: "Scorer", team: "BBB", key: "pts30", label: "30+ points", length: 6, ofGames: 9 },
    { id: "9", name: "Scorer", team: "BBB", key: "pts20", label: "20+ points", length: 9, ofGames: 9 },
    { id: "8", name: "Short", team: "BBB", key: "reb10", label: "10+ rebounds", length: 4, ofGames: 9 },
  ], teams: { BBB: { streak: { type: "L", n: 5 } }, CCC: { streak: { type: "W", n: 3 } } } };
  const leaders = { names: { "7": "Blocker", "6": "Shooter" }, gameKeys: ["id", "team", "stat", "led", "sole", "played", "teamGames", "run"], games: [["7", "CCC", "blk", 9, 9, 9, 10, 9], ["7", "CCC", "reb", 4, 4, 9, 10, 4]],
    lines: [{ key: "fg", pct: 50 }, { key: "fg3", pct: 40 }, { key: "ft", pct: 90 }], shootKeys: ["id", "team", "games", "teamGames", "fg.m", "fg.a", "fg.q", "fg.min", "fg3.m", "fg3.a", "fg3.q", "fg3.min", "ft.m", "ft.a", "ft.q", "ft.min"],
    shooting: [["6", "DDD", 10, 10, 49, 100, 1, 37, 20, 50, 1, 10, 9, 10, 0, 16]] };
  const st = tonightStorylines({ watch, trends, leaders });
  const g1 = st[0].lines.map((l) => l.text).join(" | "), g2 = st[1].lines.map((l) => l.text).join(" | ");
  {
    const fl = { fouls: { "70": { name: "Hack A", team: "BBB", gp: 10, trouble: 6, out: 1 }, "71": { name: "Bench Hack", team: "BBB", gp: 10, trouble: 9, out: 0 }, "72": { name: "Clean", team: "BBB", gp: 10, trouble: 3, out: 0 } },
      rotation: { "70": { starts: 10 }, "71": { starts: 1 }, "72": { starts: 10 } } };
    const sf = tonightStorylines({ watch, trends, leaders, fouls: fl }).flatMap((g) => g.lines).filter((l) => l.kind === "foul");
    ok(sf.length === 1 && sf[0].text === "Hack A: in early foul trouble in 6 of 10 games this season, fouled out once (2 fouls in the 1st, 3 by the half…)",
      "tonight (0.59.1): foul watch for a starter in early foul trouble in half his games; not a reserve, not 3 of 10", JSON.stringify(sf));
    const le = { leftEarly: [{ id: "80", name: "Hurt Guy", team: "BBB", opp: "ZZZ", out: 335, min: 6, pts: 3, date: "2026-11-09", gameId: "g" }, { id: "81", name: "Old News", team: "BBB", opp: "ZZZ", out: 900, min: 15, pts: 9, date: "2026-11-01", gameId: "h" }] };
    const se = tonightStorylines({ watch: { ...watch, today: "2026-11-11" }, trends, leaders, fouls: le }).flatMap((g) => g.lines).filter((l) => l.kind === "early");
    ok(se.length === 1 && se[0].text === "Hurt Guy left 11/9 vs ZZZ at Q1 6:25 and didn't return (6 min, 3 pts); he usually plays the second half",
      "tonight (0.60): a starter who left a game in the last 3 days in the first half and didn't return; an older one isn't news", JSON.stringify(se));
  }
  ok(/Big One: 5 points from 10,000 career points \(90% tonight\)/.test(g1) && /Passer: 2 3-pointers from passing Old Guy \(No\. 40\) in NBA history/.test(g1), "tonight: publishable milestones worded per kind", g1);
  ok(!/Unverified|Long Shot|Minor|Average|Not Tonight/.test(g1 + g2), "tonight: unverified, under 25%, below importance 20, other kinds and other games' teams are left out", g1);
  ok(/Scorer: 30\+ points in 6 straight games/.test(g1) && !/20\+ points/.test(g1) && !/Short/.test(g1), "tonight: only the biggest streak of a family per player; under 5 games left out", g1);
  ok(/BBB: lost 5 straight/.test(g1) && !/CCC: won 3/.test(g2), "tonight: team streaks of 4+ only", g2);
  ok(/Blocker: has led CCC in blocks 9 straight games, every game he's played/.test(g2) && !/rebounds 4 straight/.test(g2), "tonight: team-lead runs of 5+", g2);
  ok(/Shooter: 2 straight makes from 50% from the field \(49\.0%, 49-100\)/.test(g2) && /Shooter: one miss drops him below 40% on threes/.test(g2) && !/90%/.test(g2), "tonight: qualified shooters one or two shots from a line (not the unqualified FT line)", g2);
  ok(st.every((g) => g.lines.length <= 6) && st[0].lines.every((l, i, a) => !i || a[i - 1].score >= l.score), "tonight: at most 6 lines per game, best first");
  const big = Array.from({ length: 23 }, (_, k) => ({ away: "A" + k, home: "B", start: "2026-11-12T00:00Z", lines: Array.from({ length: 6 }, () => ({ text: "x".repeat(150) })) }));
  const pay = discordDigest(big, { date: "Wed, Nov 11" });
  const sizes = pay.map((p) => p.embeds.reduce((a, e) => a + e.title.length + e.description.length, 0));
  // The Discord step runs with the webhook secret in its environment: it must load no npm packages.
  {
    const seen = new Set(), stack = ["scripts/notify.js"], bad = [];
    while (stack.length) {
      const rel = stack.pop();
      if (seen.has(rel)) continue;
      seen.add(rel);
      for (const m of fs.readFileSync(path.join(root, rel), "utf8").matchAll(/(?:^|\n)\s*import[^"']*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
        const spec = m[1] || m[2];
        if (spec.startsWith("node:")) continue;
        if (!spec.startsWith(".")) { bad.push(`${rel} -> ${spec}`); continue; }
        stack.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
      }
    }
    ok(!bad.length && seen.size === 4, "Discord step: scripts/notify.js loads only Node built-ins and our own files (no npm packages run with the secret)", [...seen, ...bad].join(", "));
    // The PC copy has no .github/ (remote tools can't write it there); the check runs where it exists.
    const wfFile = path.join(root, ".github", "workflows", "daily.yml");
    const wf = fs.existsSync(wfFile) ? fs.readFileSync(wfFile, "utf8") : null;
    // Since 0.28.1 the Cloudflare Worker sends the #alerts digest; no GitHub step gets the webhook any more.
    if (wf) {
      // 0.128: the next day's slate is built after midnight Eastern, not first at 8 AM
      const crons = [...wf.matchAll(/^\s*- cron: "(\d+) (\d+) \* \* \*"/gm)].map((m) => `${m[2]}:${m[1].padStart(2, "0")}`), score = [...(/"30 8 \* \* \*"\|"0 12 \* \* \*"\) job=score/.test(wf) ? ["8:30", "12:00"] : [])];
      const overnight = crons.filter((c) => !score.includes(c) && +c.split(":")[0] >= 5 && +c.split(":")[0] < 9);   // 05:00 to 08:59 UTC is after midnight Eastern, winter and summer
      // 0.141.6: 11 runs: a 6:40 PM ET build (23:40 UTC) so the evening injury report reaches the site before 7 PM tips.
      ok(crons.length === 11 && crons.includes("23:40") && score.length === 2 && overnight.join() === "5:15,6:30,7:45" && /\*\) job=build ;;/.test(wf),
        "schedule (0.128): three builds after midnight Eastern (12:15, 1:30 and 2:45 AM in winter) publish the next day's slate once last night's games are final; they run the build job, not the scoring job", JSON.stringify([crons, overnight]));
    }
    if (wf) ok(!/secrets\.DISCORD_WEBHOOK/.test(wf) && !/node scripts\/notify\.js/.test(wf.replace(/^\s*#.*$/gm, "")), "Discord: no GitHub step receives the #alerts webhook or runs notify.js (Cloudflare sends the digest)");
  }
  ok(pay.length >= 3 && pay.every((p) => p.embeds.length <= 10) && sizes.every((n) => n <= 6000) && pay.reduce((a, p) => a + p.embeds.length, 0) === 23 && pay[0].content && !pay[1].content && pay.every((p) => p.allowed_mentions.parse.length === 0),
    "tonight: Discord digest split within limits (10 embeds, 6,000 characters per message), no @-mentions", JSON.stringify(sizes));
}

// ---------- History lines from the notes (readHistory) and in tonight's storylines ----------
{
  // A one-column notes page; each bullet is one line (cells as pdf-layout gives them).
  const L = (text) => ({ text, cells: [{ x0: 40, x1: 560, cx: 300, text }], charX: [] });
  const doc = { pages: [{ page: 1, width: 612, lines: [
    L("• ANTHONY DAVIS Logged his 39th career 40-point double-double on 11/9 at Detroit, tying Michael Jordan for the seventh-most since 1973-74."),
    L("• On 3/27/25 in Cleveland, Stephon Castle recorded 22 points, becoming the first rookie this season to reach 1,000 career points."),
    L("• MAMBA MENTALITY Kevin Durant needs 816 points to pass Kobe Bryant for 4th on the all-time scoring list."),
    L("• Moved from 8th to 5th on the all-time scoring list in 2025-26… needs 816 points to pass Kobe Bryant for 4th."),
    L("• Became the first player in school history to earn unanimous National Player of the Year honors at Kentucky."),
    L("• Lonzo Ball 29p-11r-9a 10/20/17 @ PHO and became the youngest player in franchise history to post that line."),
    L("• Entered 2026-27 as one of four undrafted players in NBA history to (10) as turnovers (11)."),
    L("• Became the second player in NBA history to tally multiple 30-point, 10-assist games within his first 10 career games."),
    // The user's 11/12 review: each of these must be dropped.
    L("• Jakob Poeltl became the first Austrian-born player in NBA history when he was drafted in 2016."),
    L("• Became the first player in Texas Tech history to be named a consensus first-team All-American."),
    L("• Darko Rajaković earned his 100th career win as head coach on 3/4/26 vs. Charlotte, the fastest in franchise history."),
    L("• DIRK NOWITZKI 10/30/08 36 points, the first teenager in NBA history to record 40+ 3-pointers in his first 10 games."),
    L("• .joined Shaquille O'Neal as the only players in NBA history to post 30-15 with 7 blocks in a game."),
    L("• The Mavericks have picked ninth four other times in franchise history (Dirk Nowitzki, 1998)."),
    L("• Kristaps Porziņģis had 30 points, 15 rebounds and 7 blocks on 1/2/22, the first Maverick in franchise history to do so."),
    L("• He is the only rookie in NBA history to record 50+ points while committing zero turnovers in a game."),
    L("• TOLU SMITH Ron Holland II became the youngest player in franchise history to record 5+ steals this season."),
    // Last season's days with no year (today is 11/11): "11/26" and "Dec. 19-28, 2025" are a year old.
    L("• Kevin Durant passed Matt Bonner for fourth in franchise history in made threes on 11/26 in Portland."),
    L("• Kevin Durant had 2+ STL in five straight games from Dec. 19-28, 2025, the longest such streak in franchise history."),
    L("• Passed Kevin Durant (1,391) for eighth on the all-time free throws made list on Oct. 28 @ Toronto."),
    L("• Anthony Davis is the first player in franchise history with 20 blocks in a season opener stretch this season (10/21-10/25)."),
  ] }] };
  const players = [{ id: "1", name: "Anthony Davis" }, { id: "2", name: "Stephon Castle" }, { id: "3", name: "Kevin Durant" }, { id: "4", name: "Jakob Poeltl" }, { id: "5", name: "Tolu Smith" }];
  const h = readHistory(doc, players, { seasonStart: "2026-10-01", today: "2026-11-11", teamWords: ["Dallas", "Mavericks", "Mavs"] });
  const by = (re) => h.find((x) => re.test(x.text));
  const davis = by(/39th career/), kd = h.filter((x) => /816 points/.test(x.text));
  ok(davis && davis.player === "Anthony Davis" && /^Logged his 39th/.test(davis.text), "history: a capitals heading is dropped and names the player", JSON.stringify(davis));
  ok(!by(/3\/27\/25/), "history: a line whose dates are all before this season is dropped (even if it says \"this season\")", JSON.stringify(h.map((x) => x.text.slice(0, 40))));
  ok(kd.length === 1 && kd[0].player === "Kevin Durant" && kd[0].kind === "pass", "history: a pass printed twice is kept once, the copy that names the player", JSON.stringify(kd));
  ok(!by(/school history/) && !by(/29p-11r-9a/) && !by(/undrafted/), "history: college lines, stat-table splices and unbalanced fragments are left out", JSON.stringify(h.map((x) => x.text.slice(0, 30))));
  ok(!by(/second player in NBA history to tally/), "history: a sentence that names no one is dropped, not guessed");
  const review = [/Austrian/, /Texas Tech/, /Rajakovi/, /DIRK|teenager/, /joined Shaq/, /picked ninth/, /Porzi/, /only rookie in NBA history to record 50/, /Ron Holland/];
  ok(review.every((re) => !by(re)), "history: the nine lines from the 11/12 review are all dropped", JSON.stringify(review.filter((re) => by(re)).map(String)));
  ok(!by(/Matt Bonner/) && !by(/Dec\. 19-28/), "history: a yearless day later than today, and a dated range, are last season's", JSON.stringify(h.map((x) => x.text.slice(0, 40))));
  ok(!by(/^Passed Kevin Durant/), "history: \"Passed <name>\" names the player passed, not the subject");
  const ad = by(/20 blocks/);
  ok(ad && ad.player === "Anthony Davis" && ad.when === "season" && h.length === 3, "history: a named, current line is kept (3 lines kept in all)", JSON.stringify(h.map((x) => [x.player, x.text.slice(0, 40)])));
  // In tonight's storylines: named or team lines only, at most 2 a game, an Out player's line removed.
  const watch = { today: "2026-11-11", games: [{ id: "g", awayTri: "WAS", homeTri: "IND", start: "2026-11-12T00:00Z" }], teams: [] };
  const F = (text, player, score, isNew = false) => ({ text, kind: "record", player, score, isNew });
  const facts = { today: "2026-11-11", teams: {
    WAS: [F("Logged his 39th career 40-point double-double, tying Michael Jordan.", "Anthony Davis", 4), F("Became the second player in NBA history to do it.", null, 3.9), F("The Wizards are the first team since 1990 to win this way, a franchise first.", null, 3)],
    IND: [F("Haliburton became the first player in franchise history to do X.", "Tyrese Haliburton", 4.4), F("Siakam is the first Pacer in team history to do Y.", "Pascal Siakam", 3.5)] } };
  const st = tonightStorylines({ watch, facts, injuries: { date: "2026-11-11", players: [{ team: "IND", name: "Tyrese Haliburton", status: "Out" }], impact: [] } });
  const hl = st[0].lines.filter((l) => l.kind === "history").map((l) => l.text);
  ok(hl.length === 2 && hl[0].startsWith("WAS notes — Anthony Davis: Logged his 39th") && hl.some((t) => t.startsWith("IND notes: Siakam")) && hl.some((t) => /Siakam/.test(t)) && !hl.some((t) => /second player in NBA history to do it|Haliburton/.test(t)),
    "storylines: history lines labelled by team (and player when the line doesn't name him), 2 a game, unnamed pronoun lines and an Out player's lines left out", JSON.stringify(hl));
}

// ---------- History lines: who, by box score, bio header and paragraph; injuries hide lines ----------
{
  const { statClaims, thresholdClaims, checkLine } = await import("../src/notes/boxscore.js");
  const { injuryStatus } = await import("../src/anticipate/tonight.js");
  const L = (text) => ({ text, cells: [{ x0: 40, x1: 560, cx: 300, text }], charX: [] });
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const row = (o) => keys.map((k) => o[k] ?? 0);
  const box = { keys, names: { 10: "Day'Ron Sharpe", 11: "Michael Porter Jr.", 12: "Giannis Antetokounmpo", 13: "Bam Adebayo", 14: "Caleb Wilson" }, games: [
    { d: "2026-11-07", opp: "ATL", pl: { 10: row({ pts: 12, ast: 13, reb: 11 }), 11: row({ pts: 25, ast: 3, reb: 8 }) } },
    { d: "2026-10-26", opp: "DAL", pl: { 12: row({ pts: 29, reb: 14, ast: 11 }), 13: row({ pts: 18, reb: 9, ast: 4 }), 14: row({ pts: 24, stl: 4, fg3m: 4 }) } },
  ] };
  const players = Object.entries(box.names).map(([id, name]) => ({ id, name }));
  ok(JSON.stringify(statClaims("a career-high 13 assists on 11/7 at Atlanta")) === JSON.stringify([{ stat: "ast", n: 13 }]), "box: a single-game number is a claim");
  ok(statClaims("at least 35 points, 10 rebounds and 5 assists in a game").length === 0 && statClaims("151 points, 18 3FGM and 14 steals through the first seven games").length === 0 && statClaims("averaging 10.4 points per game").length === 0,
    "box: thresholds (and the rest of their list), totals over several games and averages are not claims");
  ok(statClaims("Posted a 29-point, 14-rebound, 11-assist triple-double").length === 3 && statClaims("his fifth career 40-point game").length === 0, "box: a stat line in adjectives counts; one \"40-point game\" doesn't");
  ok(thresholdClaims("four-plus steals and four-plus 3FGM in a single game").length === 2, "box: thresholds read when the sentence says in a game");
  ok(checkLine(box, "career-high 13 assists vs. ATL (11/7)", { dates: ["2026-11-07"] }).who === "10", "box: the claim points to the one player who had that game");
  const doc = { pages: [
    { page: 1, width: 612, lines: [L("• Porter Jr. also leads the league with 4.9 handoff possessions per game. SHARPE Assists per game by Day'Ron Sharpe this season, the most by a center in franchise history. He has recorded 6+ assists in three straight games, the longest streak by a center in franchise history.")] },
    { page: 2, width: 612, lines: [L("• # 13 BAM ADEBAYO CENTER Playing in 10th season with the HEAT. Became the HEAT's all-time rebound leader on October 28 at Atlanta, passing Udonis Haslem. # 7 GIANNIS ANTETOKOUNMPO FORWARD Playing in 1st season. Recorded his 1,000th career steal on October 28 to become just the sixth player in NBA history with those totals.")] },
    { page: 3, width: 612, lines: [L("• Some team notes here about the season so far. Posted a 29-point, 14-rebound, 11-assist triple-double on October 26 vs. Dallas, the fastest triple-double in HEAT history.")] },
    { page: 4, width: 612, lines: [L("• On Dec. 23, 2025 vs. Oklahoma City, Caleb Wilson finished with 10 assists and 5 steals. He is now the first rookie in franchise history to have 5+ steals with 8+ assists in a single game.")] },
    { page: 5, width: 612, lines: [L("• Caleb Wilson is the first rookie in Bulls history to tally four-plus steals and four-plus 3FGM in a single game.")] },
  ] };
  const h = readHistory(doc, players, { seasonStart: "2026-10-01", today: "2026-11-11", box });
  const by = (re) => h.find((x) => re.test(x.text));
  ok(by(/three straight games/)?.player === "Day'Ron Sharpe", "history: a one-word capitals heading (\"SHARPE\") names the paragraph's player, not the one before", JSON.stringify(h.map((x) => [x.player, x.how])));
  ok(by(/rebound leader/)?.player === "Bam Adebayo" && by(/1,000th career steal/)?.player === "Giannis Antetokounmpo", "history: a bio header (# 7 GIANNIS…) owns the lines after it, up to the next");
  ok(by(/29-point, 14-rebound/)?.player === "Giannis Antetokounmpo" && by(/29-point/)?.how === "box", "history: an unnamed stat line is credited to the player whose box score matches");
  ok(!by(/He is now the first rookie/), "history: a \"He…\" line after a sentence dated last season is last season's too");
  ok(by(/four-plus steals/)?.player === "Caleb Wilson", "history: a named undated line is current when he had such a game this season");
  const st = injuryStatus({ date: "2026-11-12", players: [{ team: "CHA", name: "Kon Knueppel", status: "Out" }] }, "2026-11-12");
  ok(st("CHA", "Kon Knueppel") === "Out" && st("CHA", "Brandon Miller") === undefined && injuryStatus({ date: "2026-11-11", players: [{ team: "CHA", name: "Kon Knueppel", status: "Out" }] }, "2026-11-12")("CHA", "Kon Knueppel") === undefined,
    "injuries: tonight's report gives a player's status (the panel hides Out/Doubtful lines); an old report doesn't count");
}

// ---------- Current teams: ESPN rosters, with NBA.com's official moves as the fallback ----------
{
  const { currentTeams, readMoves, readEspnRoster } = await import("../src/rosters/current.js");
  const row = (d, type, team, desc, slug, from = 0) => ({ Transaction_Type: type, TRANSACTION_DATE: `${d}T00:00:00`, TRANSACTION_DESCRIPTION: desc, TEAM_ID: team, PLAYER_ID: 1, PLAYER_SLUG: slug, Additional_Sort: from });
  const moves = readMoves({ NBA_Player_Movement: { rows: [
    row("2026-11-08", "Trade", 1610612760, "Oklahoma City Thunder received guard Nique Clifford from Sacramento Kings.", "nique-clifford", 1610612758),
    row("2026-11-08", "Waive", 1610612760, "Oklahoma City Thunder waived forward Dalen Terry.", "dalen-terry"),
    row("2026-11-05", "Waive", 1610612747, "Los Angeles Lakers waived guard Some One.", "some-one"),
    row("2026-11-06", "Signing", 1610612747, "Los Angeles Lakers re-signed guard Some One.", "some-one"),
    row("2026-11-03", "ContractConverted", 1610612756, "Phoenix Suns converted the contract of center Duop Reath to a Two-Way Contract.", "duop-reath"),
    row("2025-07-03", "Signing", 1610612758, "Sacramento Kings re-signed guard Nique Clifford.", "nique-clifford"),
  ] } }, { since: "2026-07-01" });
  ok(moves.length === 4 && moves[0].type === "to" && moves[0].team === "OKC" && moves[0].from === "SAC" && moves[0].key === "nique clifford" && moves.some((m) => m.type === "out" && m.team === "OKC"),
    "rosters: NBA.com moves read (trade to OKC from SAC, waiver out; contract conversions and last season's moves skipped)", JSON.stringify(moves));
  const players = {
    1: { name: "Nique Clifford", team: "SAC", d: "2026-11-06" }, // traded 11/8, hasn't played for OKC yet
    2: { name: "Dalen Terry", team: "OKC", d: "2026-11-04" },     // waived 11/8
    3: { name: "Some One", team: "LAL", d: "2026-11-02" },        // waived then re-signed: still LAL
    4: { name: "Sean Pedulla", team: "HOU", d: "2026-11-01" },    // no official move here; ESPN has him on SAC
    5: { name: "Shai Gilgeous-Alexander", team: "OKC", d: "2026-11-11" },
  };
  const espn = { SAC: [{ id: "1", name: "Nique Clifford" }, { id: "4", name: "Sean Pedulla" }], OKC: [{ id: "5", name: "Shai Gilgeous-Alexander" }], LAL: [{ id: "3", name: "Some One" }] };
  const c = currentTeams(players, espn, moves);
  ok(c[1]?.team === "OKC" && c[1].was === "SAC" && c[1].source === "trade" && c[1].since === "2026-11-08",
    "rosters: an official trade after his last game moves him even though ESPN still lists him on his old team (Clifford)", JSON.stringify(c[1]));
  ok(c[2]?.team === null && c[2].source === "waived" && !c[3] && c[4]?.team === "SAC" && c[4].source === "espn" && !c[5],
    "rosters: waived → no team; waived then re-signed → no change; otherwise ESPN's roster; unchanged players aren't listed", JSON.stringify(c));
  ok(Object.keys(currentTeams({ 1: { name: "Nique Clifford", team: "SAC", d: "2026-11-09" } }, {}, moves)).length === 0, "rosters: a move dated before his last game doesn't count");
  ok(readEspnRoster({ athletes: [{ id: 4702384, displayName: "Nique Clifford" }] })[0].id === "4702384", "rosters: ESPN roster ids as strings (they match our box-score ids)");
}

// ---------- National TV vs other games (the user, 11/12) ----------
{
  const { nationalIndex, nationalSplits, perGame, nationalKey } = await import("../src/situations/national.js");
  const sched = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "national-tv-2026-27.json"), "utf8"));
  const TRI = new Set(["ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GSW","HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NOP","NYK","OKC","ORL","PHI","PHX","POR","SAC","SAS","TOR","UTA","WAS"]);
  const nets = new Set(sched.games.flatMap((g) => g.networks));
  ok(sched.games.length === 236 && sched.games.every((g) => TRI.has(g.away) && TRI.has(g.home) && g.away !== g.home && /^\d{4}-\d\d-\d\d$/.test(g.d) && g.networks.length)
    && [...nets].every((n) => ["ABC", "ESPN", "NBC", "Peacock", "Prime Video"].includes(n)) && sched.games.filter((g) => g.d === "2026-12-25").length === 5
    && nationalIndex(sched).get(nationalKey("2026-11-11", "GSW", "HOU"))?.[0] === "ESPN",
    "national TV: 236 games from the Tip-Off Guide, valid teams and dates, only ABC/ESPN/NBC/Peacock/Prime (5 on Christmas; GSW at HOU on ESPN 11/11)", [...nets].join());
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const L = (min, pts) => keys.map((k) => ({ min, pts, fgm: 8, fga: 16, fta: 4, ftm: 3 }[k] ?? 0));
  const files = {
    AAA: { team: "AAA", keys, names: { 1: "Star One", 2: "Bench Two" }, games: [
      { d: "2026-11-01", opp: "BBB", home: true, pf: 110, pa: 100, pl: { 1: L(36, 40), 2: L(10, 2) } },  // national (BBB at AAA)
      { d: "2026-11-03", opp: "BBB", home: false, pf: 90, pa: 100, pl: { 1: L(36, 20), 2: L(0, 0) } },   // not national; Bench Two DNP
      { d: "2026-11-05", opp: "CCC", home: true, pf: 101, pa: 99, pl: { 1: L(36, 24) } } ] },
    DDD: { team: "DDD", keys, names: { 1: "Star One" }, games: [{ d: "2026-11-08", opp: "EEE", home: false, pf: 95, pa: 105, pl: { 1: L(30, 30) } }] }, // traded; national (DDD at EEE)
  };
  const ix = nationalIndex({ games: [{ d: "2026-11-01", away: "BBB", home: "AAA", networks: ["ESPN"] }, { d: "2026-11-08", away: "DDD", home: "EEE", networks: ["Prime Video"] }] });
  const sp = nationalSplits(files, ix);
  const star = sp.players.find((p) => p.id === "1"), bench = sp.players.find((p) => p.id === "2");
  ok(star.nat.gp === 2 && star.nat.pts === 70 && star.other.gp === 2 && star.other.pts === 44 && star.team === "DDD" && bench.nat.gp === 1 && bench.other.gp === 0,
    "national TV: a player's national and other games, summed across his teams (latest team shown); a 0-minute game doesn't count", JSON.stringify(sp.players));
  ok(sp.teams.AAA.nat.w === 1 && sp.teams.AAA.nat.l === 0 && sp.teams.AAA.other.w === 1 && sp.teams.AAA.other.l === 1 && sp.teams.DDD.nat.l === 1, "national TV: team records split the same way", JSON.stringify(sp.teams));
  const sp2 = nationalSplits(files, nationalIndex({ games: [{ d: "2026-11-01", away: "BBB", home: "AAA", networks: ["NBC", "Peacock"] }, { d: "2026-11-05", away: "CCC", home: "AAA", networks: ["ESPN"] }] }));
  ok(sp2.teams.AAA.nat.w === 2 && sp2.teams.AAA.byNet.NBC.w === 1 && sp2.teams.AAA.byNet.Peacock.w === 1 && sp2.teams.AAA.byNet.ESPN.w === 1 && !sp2.teams.AAA.byNet.ABC,
    "national TV: each network's record (an NBC/Peacock simulcast counts for both, once in the national total)", JSON.stringify(sp2.teams.AAA));
  const pg = perGame(star.nat);
  ok(pg.pts === 35 && pg.fgPct === 50 && Math.abs(pg.tsPct - Math.round((70 / (2 * (32 + 0.44 * 8))) * 1000) / 10) < 1e-9, "national TV: per-game averages and shooting", JSON.stringify(pg));
}

// ---------- Career leaderboards and records from the Tip-Off Guide (the user, 11/12) ----------
{
  const { currentRecords, addChances, strictKey } = await import("../src/records/guide.js");
  const { makeSampler, simulate } = await import("../src/anticipate/model.js");
  const { tonightStorylines } = await import("../src/anticipate/tonight.js");
  const guide = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "tipoff-guide-2026-27.json"), "utf8"));
  // The parsed guide: 10 per list, and the numbers the pages print.
  const at = (stat, name) => guide.alltime[stat]?.find((r) => r.name === name)?.value;
  ok(Object.values(guide.alltime).every((r) => r.length === 10) && Object.values(guide.active).every((r) => r.length === 10)
    && at("pts", "LeBron James") === 43440 && at("fgm", "Shaquille O’Neal") === 11330 && at("ast", "Jason Kidd") === 12091 && at("fg3m", "Paul George") === 2449
    && guide.active.pts.find((r) => r.name === "DeMar DeRozan")?.value === 26711,
    "records: the guide's career lists (top 10 all-time and active, 12 stats) read with the printed totals");
  const W = (p, s) => guide.watch.find((w) => w.player === p && w.stat === s);
  ok(W("Stephen Curry", "pts")?.value === 26528 && W("Stephen Curry", "pts").rank === 19 && W("Bam Adebayo", "reb")?.scope === "franchise" && W("Bam Adebayo", "reb").team === "MIA"
    && guide.targets.some((t) => t.name === "Oscar Robertson" && t.value === 26710 && t.rank === 17) && guide.targets.some((t) => t.name === "Kobe Bryant" && t.stat === "fgm" && t.value === 11719),
    "records: milestone-watch pages: totals, franchise scope, the players ahead (a surname-only mention gets its full name)");
  ok(guide.franchises.length === 30 && guide.teamRecords.startUnbeaten[0].w === 24 && guide.teamRecords.start2.some((r) => r.team === "Philadelphia 76ers")
    && guide.coaches.watch.length === 3 && guide.errata.length === 1, "records: franchise records, streak and best-start lists (a team named with digits), coaches, the guide's one slip");

  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const L = (o) => keys.map((k) => o[k] ?? 0);
  const g = (d, opp, home, pf, pa, pl) => ({ d, opp, home, pf, pa, pl });
  const mini = {
    alltime: { pts: [{ name: "Old Star", value: 30000 }, { name: "Mid Star", value: 29000 }], fg3m: [] },
    active: { pts: [{ name: "Young Gun", value: 28990 }] }, extra: {},
    watch: [{ player: "Young Gun", stat: "pts", scope: "nba", value: 28990, rank: 3, page: 1 }, { player: "Young Gun", stat: "ast", scope: "franchise", team: "AAA", value: 990, rank: 2, page: 1 }],
    targets: [{ stat: "ast", scope: "franchise", team: "AAA", name: "Club Legend", value: 1000, rank: 1, page: 1 }],
    rounds: [], coaches: { wins: [{ name: "Old Coach", value: 503, rank: 9 }], watch: [{ name: "New Coach", team: "AAA", wins: 498, games: 995 }], targets: [], rounds: [{ name: "New Coach", stat: "games", value: 1000 }] },
    franchises: [], teamRecords: { winStreak: [{ w: 5, team: "X", when: "then" }, { w: 4, team: "Y", when: "then" }] },
  };
  const files = {
    AAA: { team: "AAA", keys, names: { 1: "Young Gun", 2: "Gary Payton II" }, games: [
      g("2026-11-01", "BBB", true, 110, 100, { 1: L({ min: 34, pts: 20, ast: 5 }), 2: L({ min: 10, pts: 2 }) }),
      g("2026-11-03", "BBB", false, 101, 100, { 1: L({ min: 30, pts: 10, ast: 3 }), 2: L({}) }),
      g("2026-11-05", "CCC", true, 99, 90, { 1: L({ min: 33, pts: 15, reb: 10, ast: 11 }) }),
      g("2026-11-07", "CCC", false, 120, 100, { 1: L({ min: 36, pts: 25, ast: 2 }) }) ] },
  };
  const r = currentRecords({ guide: mini, teamFiles: files, today: "2026-11-09", tonight: [{ away: "BBB", home: "AAA" }] });
  const yg = r.players.find((p) => p.name === "Young Gun");
  ok(yg.id === "1" && yg.totals.pts.now === 28990 + 70 && yg.totals.pts.season === 70, "records: a guide total plus this season's games (DNP rows add nothing)", JSON.stringify(yg.totals));
  // He started 3rd (28,990) and is past Mid Star (29,000) now: 2nd, Mid Star 3rd.
  ok(r.boards.pts.map((x) => `${x.name}:${x.rank}`).join() === "Old Star:1,Young Gun:2,Mid Star:3" && r.boards.pts[1].now === 29060, "records: ranks move when a listed player passes another", JSON.stringify(r.boards.pts.map((x) => [x.name, x.rank])));
  ok(!r.items.some((i) => i.kind === "franchise"), "records: a franchise record he has already broken (990 + 21 > 1,000) isn't listed");
  const r2 = currentRecords({ guide: { ...mini, alltime: { pts: [{ name: "Old Star", value: 29080 }, { name: "Mid Star", value: 29000 }] } }, teamFiles: files, today: "2026-11-09", tonight: [{ away: "BBB", home: "AAA" }] });
  const p2 = r2.items.find((i) => i.kind === "pass");
  ok(p2 && p2.passing.name === "Old Star" && p2.need === 29080 - 29060 + 1 && p2.text === "Gun: 21 points from passing Old Star (29,080) for the NBA record; 20 ties him" && p2.tonight && p2.gamesAway === 2,
    "records: the next name ahead, the points needed, 'for the NBA record' at No. 1, games away from his rate, tonight's game", JSON.stringify(p2));
  const coach = r.items.filter((i) => i.kind === "coach").map((i) => i.text);
  ok(coach.includes("Coach: 2 wins from passing Old Coach (503) for 9th in career coaching wins") && coach.includes("Coach: coaches his 1,000th game"),
    "records: a coach's wins and games = the guide's + his team's this season (4-0: 502 wins, 999 games)", JSON.stringify(coach));
  const team = r.items.find((i) => i.kind === "team");
  ok(team && team.text === "AAA: 4 straight; a win tonight makes 5, tying the best win streak in NBA history (X, then)" && team.tonight, "records: a team streak reaching the NBA's list", JSON.stringify(team));
  ok(!r.players.some((p) => p.name === "Gary Payton") && strictKey("Gary Payton II") !== strictKey("Gary Payton") && strictKey("Tim Hardaway Jr.") === strictKey("Tim Hardaway Jr"),
    "records: the guide's Gary Payton is never this season's Gary Payton II (suffixes kept in matching)");
  addChances(r2.items, files, { makeSampler, simulate, sims: 500 });
  ok(p2.pTonight > 0 && p2.pTonight < 1 && p2.pNext5 >= p2.pTonight, "records: chances tonight and in the next 5 games", JSON.stringify([p2.pTonight, p2.pNext5]));
  {
    // Passing an active player: his games count too (0.50, the user's Brunson/Giannis and Gobert/Davis question).
    const G = (d, pts) => g(d, "ZZZ", true, 100, 90, { 1: L({ min: 34, pts: 20 }), 7: L({ min: 34, pts }) });
    const f2 = { ...files, RRR: { team: "RRR", keys, names: { 7: "Rival Guy" }, games: [G("2026-11-01", 30), G("2026-11-03", 30), G("2026-11-05", 30), G("2026-11-07", 30)].map((x) => ({ ...x, pl: { 7: x.pl[7] } })) } };
    const base = { kind: "pass", id: "1", who: "Young Gun", stat: "pts", need: 15, tonight: true, team: "AAA" };
    const frozen = { ...base, passing: { name: "Rival Guy", value: 1, live: false } };
    const both = { ...base, passing: { name: "Rival Guy", value: 1, live: true } };
    const off = { ...base, passing: { name: "Rival Guy", value: 1, live: true } };
    addChances([frozen, both], f2, { makeSampler, simulate, sims: 800, tonightTeams: new Set(["AAA", "RRR"]) });
    addChances([off], f2, { makeSampler, simulate, sims: 800, tonightTeams: new Set(["AAA"]) });
    ok(frozen.pTonight > 0.5 && both.pTonight < 0.2 && both.rivals?.[0]?.tonight === true && Math.abs(off.pTonight - frozen.pTonight) < 0.08 && off.rivals?.[0]?.tonight === false,
      "records: 15 from passing a retired name is likely tonight; 15 from passing a 30-a-game player who also plays tonight isn't; if he's off tonight the odds tonight are about a retired name's",
      JSON.stringify([frozen.pTonight, both.pTonight, off.pTonight, both.rivals]));
  }
  {
    // 0.141.1: games he was listed Out on the injury report don't count against his chance to play (Steven Adams,
    // 11/20: 2 of HOU's last 10 played, the other 8 out with a soleus strain; given 20%).
    const back = (d, played, out) => ({ ...g(d, "ZZZ", true, 100, 90, { 9: played ? L({ min: 25, pts: 8 }) : L({}) }), inj: out ? { 9: "Out" } : {} });
    const days = Array.from({ length: 10 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
    const fR = { RTN: { team: "RTN", keys, names: { 9: "Back Again" }, games: days.map((d, i) => back(d, i >= 7, i < 7)) } };
    const fB = { RTN: { team: "RTN", keys, names: { 9: "Back Again" }, games: days.map((d, i) => back(d, i >= 7, false)) } };
    const it = () => ({ kind: "pass", id: "9", who: "Back Again", stat: "pts", need: 1, tonight: true, team: "RTN", passing: { name: "Old Name", value: 1, live: false } });
    const ret = it(), bench = it();
    addChances([ret], fR, { makeSampler, simulate, sims: 800 }); addChances([bench], fB, { makeSampler, simulate, sims: 800 });
    const q = it(), out = it();
    addChances([q], fR, { makeSampler, simulate, sims: 800, tonightStatus: { 9: "Questionable" } }); addChances([out], fR, { makeSampler, simulate, sims: 800, tonightStatus: { 9: "Out" } });
    ok(q.pPlay === 0.6 && q.pTonight <= 0.65 && out.pTonight === 0 && out.pNext5 > 0.8, "records (0.141.1): tonight's injury report caps tonight only (Questionable 60%, Out 0)", JSON.stringify([q.pPlay, q.pTonight, out.pTonight, out.pNext5]));
    ok(ret.pTonight > 0.8 && bench.pTonight < 0.35, "records (0.141.1): back from 7 games listed Out, he is likely to play; 7 coach's-decision DNPs still count against him", JSON.stringify([ret.pTonight, bench.pTonight]));
  }
  // Storylines: a record line tonight, unless the notes carry the same milestone.
  const watch = { today: "2026-11-09", games: [{ id: "1", awayTri: "BBB", homeTri: "AAA" }], teams: [] };
  const recs = { today: "2026-11-09", items: [{ ...p2, pTonight: 0.4 }, { kind: "coach", team: "AAA", stat: "wins", need: 1, tonight: true, text: "Coach: 1 win from passing Old Coach (503) for 9th in career coaching wins", score: 3 }] };
  const lines = tonightStorylines({ watch, records: recs })[0].lines.filter((l) => l.kind === "record").map((l) => l.text);
  ok(lines.includes("Young Gun: 21 points from passing Old Star (29,080) for the NBA record; 20 ties him (40% tonight)") && lines.includes("Coach: a win tonight passes Old Coach (503) for 9th in career coaching wins"),   // 0.160.0: the full name
    "records: tonight's storylines carry them", JSON.stringify(lines));
  const watch2 = { ...watch, teams: [{ team: "AAA", items: [{ player: "Young Gun", stat: "pts", kind: "pass", scope: "nba", target: 29080, need: 21, passing: { player: "Old Star" }, publishable: true, importance: 50, pTonight: 0.4 }] }] };
  const lines2 = tonightStorylines({ watch: watch2, records: recs })[0].lines.map((l) => l.kind);
  ok(lines2.filter((k) => k === "milestone").length === 1 && lines2.filter((k) => k === "record").length === 1, "records: the notes' own version of the same milestone wins (no double line)", JSON.stringify(lines2));
  const facts = { today: "2026-11-09", teams: { AAA: [{ text: "Young Gun needs 21 points to pass Old Star for the most in NBA history.", player: "Young Gun", score: 4 }] } };
  const lines3 = tonightStorylines({ watch, records: recs, facts })[0].lines.map((l) => l.kind);
  ok(!lines3.includes("history") && lines3.includes("record"), "records: a notes history line about the same pass gives way to the record line", JSON.stringify(lines3));
}

// ---------- 0.64: the notability rule on the Watch List, the Records "Tonight" tab and the storylines ----------
{
  const { worthPlace, isMinorPass } = await import("../src/records/notable.js");
  ok(worthPlace("cup", "pts", 2) && !worthPlace("cup", "pts", 3) && worthPlace("franchise", "reb", 3) && !worthPlace("franchise", "dreb", 3)
    && worthPlace("franchise", "dreb", 2) && worthPlace("nba", "ast", 25) && !worthPlace("nba", "ast", 26) && !worthPlace("nba", "gp", 11) && worthPlace("nba", "gp", 10) && worthPlace("nba", "pts", null),
    "notable: Cup top 2; franchise top 3 (six main stats) / top 2; all-time top 25 / top 10; no known place is kept");
  // Records items (kind + rank) and Watch List items (kind pass + scope + passing.rank).
  ok(isMinorPass({ kind: "franchise", stat: "ast", rank: 8 }) && !isMinorPass({ kind: "franchise", stat: "ast", rank: 3 })
    && isMinorPass({ kind: "pass", stat: "blk", rank: 37 }) && !isMinorPass({ kind: "pass", stat: "pts", rank: 16 })
    && isMinorPass({ kind: "cup", stat: "stl", rank: 5 }) && !isMinorPass({ kind: "round", stat: "pts", rank: 40 }) && !isMinorPass({ kind: "coach", stat: "wins", rank: 30 })
    && isMinorPass({ kind: "pass", scope: "franchise", stat: "dreb", passing: { rank: 8 } }) && !isMinorPass({ kind: "pass", scope: "nba", stat: "fg3m", passing: { rank: 1 } })
    && isMinorPass({ kind: "pass", scope: "unknown", stat: "fg3m", passing: { rank: 4 } }) && !isMinorPass({ kind: "round", scope: "career", stat: "pts" }),
    "notable: Records and Watch List passes judged by the place reached; round numbers and coaches untouched; an unproven list gets the franchise rule");
  const watch = { today: "2026-11-09", games: [{ id: "1", awayTri: "BBB", homeTri: "AAA" }], teams: [{ team: "AAA", items: [
    { player: "Bench Guy", stat: "dreb", kind: "pass", scope: "franchise", target: 900, need: 2, passing: { player: "Old Big", rank: 8 }, publishable: true, importance: 50, pTonight: 0.8, minor: true },
    { player: "Star Guy", stat: "pts", kind: "pass", scope: "franchise", target: 20000, need: 5, passing: { player: "Legend", rank: 2 }, publishable: true, importance: 60, pTonight: 0.8 }] }] };
  const recs = { today: "2026-11-09", items: [
    { kind: "franchise", who: "Bench Guy", team: "AAA", stat: "reb", rank: 17, tonight: true, pTonight: 0.9, need: 1, minor: true, text: "Guy: 1 rebound from passing Someone (1,200) for 17th in AAA history", score: 2.5 },
    { kind: "pass", who: "Star Guy", team: "AAA", stat: "pts", rank: 16, tonight: true, pTonight: 0.7, need: 6, text: "Guy: 6 points from passing Great (26,806) for 16th all-time", score: 2.8 }] };
  const texts = tonightStorylines({ watch, records: recs })[0].lines.map((l) => l.text).join(" | ");
  ok(!/Bench Guy|Old Big|17th in AAA/.test(texts) && /Legend/.test(texts) && /16th all-time/.test(texts),
    "notable: the storylines skip a minor pass (Watch List and Records) and keep the ones worth saying", texts);
}

// ---------- The NBA Guide: career scorers, record book, single-game lists (the user, 11/12) ----------
{
  const { currentRecords } = await import("../src/records/guide.js");
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, "src", "data", f), "utf8"));
  const sc = rd("nba-career-scorers-2026-27.json"), tip = rd("tipoff-guide-2026-27.json");
  ok(sc.length === 68 && sc[0].name === "LeBron James" && sc[0].pts === 43440 && sc.find((r) => r.name === "Anthony Davis")?.rank === 61 && sc[67].pts === 19004,
    "NBA Guide: 68 career scorers in order (19,000+), Davis 61st as the Tip-Off Guide says");
  const r = currentRecords({ guide: tip, teamFiles: {}, scorers: sc });
  ok(!r.problems.some((p) => /the guide gives/.test(p)) && r.boards.pts.find((x) => x.name === "Paul George").rank === 62, "NBA Guide: every scorer's totals agree with the Tip-Off Guide's (no conflicting totals)", r.problems.join("; "));
  const rb = rd("nba-record-book-2026-27.json");
  const find = (book, title) => rb.find((x) => x.book === book && x.title === title);
  ok(find("Regular season", "Most points, game")?.entries[1]?.value === "83" && /Bam Adebayo/.test(find("Regular season", "Most points, game").entries[1].holder)
    && find("Regular season", "Most three-point field goals, game")?.entries[0].value === "14" && find("NBA Cup", "Most points, game")?.entries[0].value === "60"
    && find("Regular season", "Most points, one quarter")?.scope === "quarter" && find("Regular season", "Most consecutive games, 20 or more points")?.scope === "streak"
    && new Set(rb.map((x) => x.book)).size === 6,
    "record book: Elias's records by book and scope (Adebayo's 83, Klay's 14 threes, Fox's 60 in the Cup)");
  const sg = rd("nba-single-game-bests-2026-27.json");
  ok(sg["Regular season"].pts.floor === 57 && sg["Regular season"].fg3m.floor === 11 && sg["NBA Cup"].pts.games[0].value === 60 && sg["Regular season"].pts.games.some((g) => g.player === "Joe Fulks" && g.value === 63),
    "single-game lists: floors (57 points, 11 threes), the Cup's list, a row whose numbers wrapped");
}

// ---------- NBA Cup career lists from the Cup media guide (the user, 11/12) ----------
{
  const { cupRecords, cupOnly } = await import("../src/records/cup.js");
  const cup = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-cup-2026-27.json"), "utf8"));
  const per = {};
  for (const g of cup.group) for (const t of [g.away, g.home]) per[t] = (per[t] || 0) + 1;
  ok(cup.group.length === 60 && Object.keys(per).length === 30 && Object.values(per).every((n) => n === 4) && cup.group.filter((g) => g.d === "2026-11-13").length === 9
    && cup.leaders.pts[0].name === "Shai Gilgeous-Alexander" && cup.leaders.pts[0].value === 502 && cup.leaders.fg3m[0].value === 55,
    "NBA Cup guide: 60 Group Play games (4 a team, 9 on 11/13), all-time leaders (SGA 502 points, Curry 55 threes)");
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const L = (o) => keys.map((k) => o[k] ?? 0);
  const files = { OKC: { team: "OKC", keys, names: { 9: "Shai Gilgeous-Alexander" }, games: [
    { d: "2026-11-06", opp: "MEM", home: false, pf: 120, pa: 110, pl: { 9: L({ min: 34, pts: 30 }) } },   // Cup (OKC at MEM)
    { d: "2026-11-08", opp: "MEM", home: true, pf: 120, pa: 110, pl: { 9: L({ min: 34, pts: 40 }) } } ] } }; // not a Cup game
  ok(cupOnly(files, cup).OKC.games.length === 1, "NBA Cup: only the schedule's Cup games count (date and teams)");
  const c = cupRecords({ cup, teamFiles: files, tonight: [{ away: "OKC", home: "LAC" }], today: "2026-11-13" });
  const okcSt = c.standings.find((x) => x.team === "OKC");
  ok(okcSt.overall[0] === cup.standings.OKC.overall[0] + 1 && okcSt.road[0] === cup.standings.OKC.road[0] + 1 && okcSt.season.join() === "1,0" && cup.standings.MIL.overall.join() === "14,3",
    "NBA Cup: all-time standings (Bucks 14-3) plus this season's Cup results, home and road", JSON.stringify(okcSt));
  ok(c.boards.pts[0].now === 532 && c.tonight.length === 1 && !c.items.some((i) => i.stat === "gp"), "NBA Cup: his Cup total = the guide's + this season's Cup games; tonight's Cup game; no games-played passes", JSON.stringify(c.boards.pts[0]));
}

// ---------- NBA Guide: coaching rankings and award history (the user, 11/12) ----------
{
  const { currentRecords } = await import("../src/records/guide.js");
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, "src", "data", f), "utf8"));
  const co = rd("nba-coaches-2026-27.json");
  const carl = co.wins.find((c) => c.name === "Rick Carlisle");
  ok(co.wins.length >= 79 && co.wins[0].name === "Gregg Popovich" && carl?.w === 1012 && carl.l === 923 && carl.rank === 11 && co.games.find((c) => c.name === "Rick Carlisle")?.g === 1935
    && co.wins.some((c) => c.name === "Bill Russell" && c.w === 341), "coaches: every 300-win coach (Carlisle 1,012-923, 11th; 1,935 games), a name next to a heading read right (Bill Russell)");
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const files = { NYK: { team: "NYK", keys, names: {}, games: [{ d: "2026-11-01", opp: "BOS", home: true, pf: 100, pa: 90, pl: {} }, { d: "2026-11-03", opp: "BOS", home: false, pf: 100, pa: 90, pl: {} }] } };
  const list = { wins: [{ name: "Old Coach", w: 510, l: 400, rank: 1 }, { name: "Mike Brown", w: 507, l: 333, rank: 2 }], games: [] };
  const r = currentRecords({ guide: { alltime: {}, active: {}, extra: {}, watch: [], targets: [], rounds: [], coaches: {}, franchises: [], teamRecords: {} }, teamFiles: files, coachList: list, coachTeams: { NYK: "Mike Brown" } });
  ok(r.items.some((i) => i.text === "Brown: 2 wins from passing Old Coach (510) for 1st in career coaching wins"), "coaches: today's head coach (from ESPN) with his ranked total plus his team's wins", JSON.stringify(r.items.map((i) => i.text)));
  const h = rd("nba-history-2026-27.json");
  ok(h.awards["NBA Most Valuable Player"].length === 71 && h.awards["NBA Most Valuable Player"].at(-1).player === "Shai Gilgeous-Alexander" && h.awards["NBA Finals Most Valuable Player"][0].season === "1969",
    "award history: MVPs 1955-56 to 2025-26, Finals MVPs from 1969");
}

// ---------- Current career lists (top 40 per stat, sent by the user 11/12) ----------
{
  const { currentRecords } = await import("../src/records/guide.js");
  const cur = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "career-leaders-2026-11-11.json"), "utf8"));
  ok(Object.keys(cur.lists).length === 12 && Object.entries(cur.lists).every(([k, v]) => v.length >= 40 && v.every((r, i) => i === 0 || v[i - 1][1] >= r[1])) && cur.lists.td.length === 72,
    "current lists: 12 stats, top 40 each (triple-doubles to 72), in order");
  // A live player's listed total (through asOf) is taken back to the start of the season, so later games add once.
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const L = (o) => keys.map((k) => o[k] ?? 0);
  const files = { PHI: { team: "PHI", keys, names: { 23: "Big Man" }, games: [
    { d: "2026-11-10", opp: "BOS", home: true, pf: 1, pa: 0, pl: { 23: L({ min: 30, reb: 10, fgm: 5, fg3m: 1 }) } },
    { d: "2026-11-12", opp: "BOS", home: false, pf: 1, pa: 0, pl: { 23: L({ min: 30, reb: 4, fgm: 3, fg3m: 0 }) } } ] } };
  const g = { alltime: {}, active: {}, extra: {}, watch: [], targets: [], rounds: [], coaches: {}, franchises: [], teamRecords: {} };
  const r = currentRecords({ guide: g, teamFiles: files, current: { asOf: "2026-11-11", lists: { reb: [["Old Big", 1010], ["Big Man", 1000], ["Third Guy", 990]], fg2m: [["Big Man", 500]] } } });
  const big = r.boards.reb.find((x) => x.name === "Big Man");
  ok(big.now === 1004 && big.rank === 2 && r.boards.fg2m[0].now === 503 && r.items.some((i) => i.text === "Man: 7 rebounds from passing Old Big (1,010) for the NBA record; 6 ties him"),
    "current lists: listed total + games after the list's date only; ranks from today's totals; 2-point field goals counted (FGM - 3PM)", JSON.stringify([big, r.boards.fg2m[0]]));
}

// ---------- Yearly stat leaders and title races (NBA Guide pp. 122-127) ----------
{
  const { titleRace } = await import("../src/records/titles.js");
  const h = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-history-2026-27.json"), "utf8"));
  const run = (k) => h.leaders[k].map((e) => Number(e.season.slice(0, 4))).every((y, i, a) => i === 0 || y - a[i - 1] === 1);
  ok(["pts", "reb", "ast", "stl", "blk"].every(run) && h.leaders.pts.length === 80 && h.leaders.pts.at(-1).player === "Luka Doncic" && h.leaders.blk.find((e) => e.season === "1973-74")?.player === "Elmore Smith",
    "yearly leaders: every season once, 1946-47 to 2025-26 (Doncic 2025-26 scoring; Elmore Smith first blocks leader)");
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const L = (o) => keys.map((k) => o[k] ?? 0);
  const games = Array.from({ length: 6 }, (_, i) => ({ d: `2026-11-0${i + 1}`, opp: "BOS", home: true, pf: 1, pa: 0, pl: { 7: L({ min: 36, pts: 40 }) } }));
  const t = titleRace({ history: h, teamFiles: { LAL: { team: "LAL", keys, names: { 7: "Luka Dončić" }, games } } });
  ok(t[0].rows[0].note === "would be his 3rd scoring title (last 2025-26)", "title races: the leader's Nth title from the guide's history (accents ignored)", t[0].rows[0]?.note);
  // Seattle counts as Thunder history (user, 11/13/26).
  const og = games.map((g) => ({ ...g, pl: { 9: L({ min: 36, reb: 15, stl: 4 }) } }));
  const o = titleRace({ history: h, teamFiles: { OKC: { team: "OKC", keys, names: { 9: "Okc Big" }, games: og } } });
  const sea = titleRace({ history: { leaders: { ...h.leaders, stl: [...h.leaders.stl.filter((e) => e.team !== "Oklahoma City")] } }, teamFiles: { OKC: { team: "OKC", keys, names: { 9: "Okc Big" }, games: og } } });
  ok(o[1].rows[0].note === "would be his first rebounding title; no Oklahoma City or Seattle player has led the league"
    && o[3].rows[0].note === "would be his first steals title; Oklahoma City's last: Paul George, 2018-19"
    && sea[3].rows[0].note === "would be his first steals title; Oklahoma City's last: Gary Payton (Seattle), 1995-96",
    "title races: Seattle's leaders count as Thunder history", JSON.stringify([o[1].rows[0]?.note, o[3].rows[0]?.note, sea[3].rows[0]?.note]));
}

// ---------- Award résumés (NBA Guide award history) ----------
{
  const { resumes } = await import("../src/records/awards.js");
  const h = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-history-2026-27.json"), "utf8"));
  const R = resumes(h);
  ok(R.get("kobe bryant") === "MVP · 2× Finals MVP · 4× All-Star MVP" && R.get("shaquille oneal") === "MVP · 3× Finals MVP · Rookie of the Year · 3× All-Star MVP"
    && R.get("nikola jokic") === "3× MVP · Finals MVP · West Finals MVP" && R.get("joe mazzulla") === "Coach of the Year",
    "awards: résumés from the history, shared awards counted for both winners (2009 All-Star MVP: Kobe and Shaq), accents ignored", [R.get("kobe bryant"), R.get("shaquille oneal")].join(" | "));
}

// ---------- Franchise streak records and reference tables (NBA Guide pp. 27-28, 44-45, 142-143) ----------
{
  const { currentRecords } = await import("../src/records/guide.js");
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, "src", "data", f), "utf8"));
  const fs2 = rd("nba-franchise-streaks-2026-27.json");
  ok(Object.keys(fs2.win).length === 30 && Object.keys(fs2.lose).length === 30 && fs2.win.LAL.n === 33 && fs2.lose.DET.n === 28 && fs2.lose.MEM.also[0].n === 19 && /Vancouver/.test(fs2.lose.MEM.seasons),
    "franchise streaks: all 30 teams' longest winning and losing streaks (Lakers 33, Pistons 28 losses; Memphis's Vancouver record kept with the Memphis-era one)");
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const games = Array.from({ length: 15 }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, opp: "BOS", home: true, pf: 90, pa: 100, pl: {} }));
  const g = { alltime: {}, active: {}, extra: {}, watch: [], targets: [], rounds: [], coaches: {}, franchises: [], teamRecords: {} };
  const r = currentRecords({ guide: g, teamFiles: { WAS: { team: "WAS", keys, names: {}, games } }, tonight: [{ away: "BOS", home: "WAS" }], franchiseStreaks: fs2 });
  const it = r.items.find((i) => i.stat === "franchiseLoseStreak");
  ok(it && it.text === "Wizards: lost 15 straight; a loss tonight ties the franchise record (16, 2009-10, 2023-24, 2024-25, 2025-26)" && it.need === 1 && it.tonight, "franchise streaks: one loss from tying the franchise record, tonight", it && it.text);
  const ref = rd("nba-guide-reference-2026-27.json");
  ok(ref.cup2025.pts.find((x) => x.player === "Jalen Brunson")?.total === 199 && ref.playoffActive.pts[0].value === 8521 && ref.playoffActive.ast?.length === 10,
    "reference: 2025 Cup leaders (Brunson 199 points) and active career playoff leaders (LeBron 8,521)");
}

// ---------- Award phrasing in record storylines ----------
{
  const { tonightStorylines } = await import("../src/anticipate/tonight.js");
  const watch = { today: "2026-11-09", games: [{ id: "1", awayTri: "BBB", homeTri: "AAA" }], teams: [] };
  const item = (who, text) => ({ kind: "pass", team: "AAA", who, stat: "pts", target: 10, need: 5, tonight: true, pTonight: 0.5, score: 3, text });
  const recs = { today: "2026-11-09", awards: { "Star Guy": "4× MVP · 4× Finals MVP", "Sixth Guy": "Sixth Man" },
    items: [item("Star Guy", "Guy: 5 points from passing Old (100) for 3rd all-time"), item("Sixth Guy", "Guy: 5 assists from passing Old (100) for 9th all-time")] };
  const lines = tonightStorylines({ watch, records: recs })[0].lines.map((l) => l.text);
  // 0.157.0 (the user, 11/25: "no need to include the accolades in the text. it takes up space")
  ok(lines.includes("Guy: 5 points from passing Old (100) for 3rd all-time (50% tonight)") && lines.includes("Guy: 5 assists from passing Old (100) for 9th all-time (50% tonight)") && !lines.some((t) => /MVP/.test(t)),
    "record lines (0.157.0): no award in the text, whatever the player has won", JSON.stringify(lines));
}

// ---------- Postseason and All-Star career lists, single-game lists (NBA Guide pp. 157-186) ----------
{
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, "src", "data", f), "utf8"));
  const pc = rd("nba-postseason-careers-2026-27.json"), sg = rd("nba-single-game-bests-2026-27.json");
  ok(pc.careers.playoffs.pts[0].name === "LeBron James" && pc.careers.playoffs.pts[0].value === 8521 && pc.careers.playoffs.ast[0].name === "Magic Johnson"
    && pc.careers.finals.pts[0].name === "Jerry West" && pc.careers.allStar.pts[0].value === 449 && pc.careers.playIn.pts[0].name === "Stephen Curry"
    && pc.allStarSelections.find((s) => s.name === "LeBron James")?.selections === 22 && pc.allStarSelections.some((s) => s.name === "Tracy McGrady"),
    "postseason careers: playoffs (LeBron 8,521; Magic's assists), Finals (West), All-Star (LeBron 449), Play-In (Curry); All-Star selections (LeBron 22)");
  ok(sg.Playoffs.pts.floor === 49 && sg.Playoffs.pts.games[0].value === 63 && sg.Finals.pts.games[0].value === 61 && sg["Play-In"].pts.games[0].value === 50 && sg["Regular season"].pts.floor === 57,
    "single-game lists: playoffs (63, list from 49), Finals (61), Play-In (50) beside the regular season's");
}

// ---------- This season vs his career (NBA Guide year-by-year stats) ----------
{
  const { careerContext } = await import("../src/records/yoy.js");
  const { tonightStorylines } = await import("../src/anticipate/tonight.js");
  const cs = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-career-seasons-2026-27.json"), "utf8"));
  const H = cs.players["James Harden"], K = Object.fromEntries(cs.keys.map((k, i) => [k, i]));
  ok(H.length === 17 && H[0][K.season] === "2009-10" && H.at(-1)[K.season] === "2025-26" && cs.players["LeBron James"].length === 23 && cs.players["Gary Payton II"]?.length >= 8,
    "career seasons: every season of active players since 1979-80 (Harden 17, LeBron 23; Gary Payton II not mixed with his father)");
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const L = (o) => keys.map((k) => o[k] ?? 0);
  const games = Array.from({ length: 10 }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, opp: "BOS", home: true, pf: 1, pa: 0, pl: { 1: L({ min: 30, pts: 17, ast: 6, reb: 5 }) } }));
  const seasons = { keys: cs.keys, players: { "Vet Guard": [["2019-20", 70, 2400, 1400, 300, 400, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40], ["2020-21", 70, 2400, 1000, 300, 400, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40], ["2024-25", 70, 2400, 1600, 300, 400, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40], ["2025-26", 70, 2400, 1680, 300, 400, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40]], "Bench Guy": [["2023-24", 60, 600, 300, 300, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20], ["2024-25", 60, 600, 300, 300, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20], ["2025-26", 60, 600, 900, 300, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20]] } };
  games.forEach((g) => { g.pl[2] = L({ min: 10, pts: 3 }); });
  const c = careerContext({ seasons, teamFiles: { LAC: { team: "LAC", keys, names: { 1: "Vet Guard", 2: "Bench Guy" }, games } } });
  const ch = c.find((x) => x.kind === "change" && x.stat === "pts" && x.name === "Vet Guard");
  ok(ch && ch.text === "Guard: 17 points a game, down 7 from 24 in 2025-26; his lowest since 2020-21 (14.3)", "career context: a big drop from last season, with the last season he was this low", ch && ch.text);
  const watch = { today: "2026-11-11", games: [{ id: "1", awayTri: "BOS", homeTri: "LAC" }], teams: [] };
  const lines = tonightStorylines({ watch, records: { today: "2026-11-11", context: c } })[0].lines.filter((l) => l.kind === "context");
  ok(lines.length === 1 && /^Guard:/.test(lines[0].text) && c.some((x) => x.name === "Bench Guy"), "career context: at most one line a game, a regular's (10 minutes a game last season isn't storyline material; it stays on the page)", JSON.stringify(lines));
}

// ---------- Franchise history (NBA Guide team-by-team year-by-year pages) ----------
{
  const { franchiseRecords } = await import("../src/records/franchise.js");
  const fc = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-franchise-careers-2026-27.json"), "utf8")).franchises;
  const v = (t, s, n) => fc[t].top[s].find((r) => r[0] === n)?.[1];
  // Every check against a team media guide or the Tip-Off Guide's franchise pages.
  const known = [["LAL", "pts", "Kobe Bryant", 33643], ["LAL", "ast", "Magic Johnson", 10141], ["LAL", "blk", "Kareem Abdul-Jabbar", 2694], ["LAL", "pts", "Jerry West", 25192],
    ["TOR", "pts", "DeMar DeRozan", 13296], ["TOR", "pts", "Kyle Lowry", 10540], ["MIA", "reb", "Udonis Haslem", 5791], ["MIA", "dreb", "Bam Adebayo", 4341], ["PHX", "fgm", "Walter Davis", 6497],
    ["BOS", "fg3m", "Paul Pierce", 1823], ["ATL", "fgm", "Dominique Wilkins", 8752], ["ATL", "fgm", "Bob Pettit", 7349], ["ATL", "g", "Tree Rollins", 814], ["HOU", "pts", "Hakeem Olajuwon", 26511],
    ["UTA", "pts", "Karl Malone", 36374], ["NYK", "pts", "Patrick Ewing", 23665], ["UTA", "ast", "John Stockton", 15806], ["DAL", "pts", "Dirk Nowitzki", 31560],
    // Found checking the team media guides (0.46): "Jr." rows, a header over 7 lines, ". ." blanks, stints years apart, a second name.
    ["POR", "pts", "Clyde Drexler", 18040], ["CHI", "pts", "Scottie Pippen", 15123], ["ATL", "pts", "Kevin Willis", 10582], ["ATL", "reb", "Kevin Willis", 7332],
    ["HOU", "pts", "Rudy Tomjanovich", 13383], ["PHI", "reb", "Red Kerr", 9506], ["UTA", "reb", "Karl Malone", 14601], ["WAS", "pts", "Wes Unseld", 10624],
    // The Cavs guide's leaders, from the user's screenshots (0.47.4): Bingo/Bobby Smith one player. Thompson, Allen and Chones are
    // checked against the guide's own totals, which disagree with its oreb/dreb lines (see CHANGES 0.47.4).
    ["CLE", "pts", "Bingo Smith", 9513], ["CLE", "g", "Bingo Smith", 720], ["CLE", "fgm", "Bingo Smith", 4182], ["CLE", "reb", "Jarrett Allen", 3859],
    ["CLE", "oreb", "Jarrett Allen", 1174], ["CLE", "reb", "Jim Chones", 3790], ["CLE", "dreb", "Jim Chones", 2750], ["CLE", "g", "Tristan Thompson", 708],
    ["CLE", "ast", "Foots Walker", 2115], ["CLE", "blk", "Larry Nance", 1087]];
  const bad = known.filter(([t, s, n, x]) => v(t, s, n) !== x);
  ok(Object.keys(fc).length === 30 && !bad.length, "franchise history: 30 franchises; totals match the team guides (Kareem's 'K. Abdul-Jabbar' rows, Pettit's 1954-55, Hakeem's 1991-92 broken header, Malone's missing 2001-02 row from the Jazz totals, Drexler's 1991-92, Pippen's and Willis's returns, Rudy T's 1976-77, Red/Johnny Kerr, Bingo/Bobby Smith)", JSON.stringify(bad.map(([t, s, n, x]) => [t, s, n, x, v(t, s, n)])));
  ok(!fc.LAL.top.pts.some((r) => /^[A-Z ]+$/.test(r[0])) && fc.CLE.active["LeBron James"]?.pts === 23119, "franchise history: no team or opponents total rows; a player active now keeps his totals with old teams (LeBron, Cleveland)");
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const L = (o) => keys.map((k) => o[k] ?? 0);
  const games = Array.from({ length: 4 }, (_, i) => ({ d: `2026-11-0${i + 1}`, opp: "BOS", home: true, pf: 1, pa: 0, pl: { 1: L({ min: 30, pts: 25, fgm: 10, ftm: 5 }), 2: L({ min: 20, pts: 10, fgm: 5 }) } }));
  const careers = { franchises: { AAA: { name: "Testers", top: { pts: [["Club Legend", 2000, "1990-91", "2000-01"], ["Old Star", 1050, "1980-81", "1985-86"], ["Vet Guard", 950, "2020-21", "2025-26"]] },
    active: { "Vet Guard": { pts: 950, first: "2020-21", last: "2025-26" } } } } };
  const f = franchiseRecords({ careers, teamFiles: { AAA: { team: "AAA", keys, names: { 1: "Vet Guard", 2: "Club Legend" }, games } }, tonight: [{ home: "AAA", away: "BBB" }] });
  const it = f.items.find((i) => i.who === "Vet Guard");
  ok(it && it.now === 1050 && it.need === 1 && it.passing.name === "Old Star" && it.rank === 2 && it.tonight && /for 2nd in Testers history/.test(it.text),
    "franchise history: last season's total + this season's games with them; the next name ahead, with the place", JSON.stringify(f.items));
  ok(f.boards.AAA.pts.some((r) => r.name === "Club Legend" && !r.live && r.now === 2000) && f.boards.AAA.pts.some((r) => r.name === "Club Legend" && r.live && r.now === 40),
    "franchise history: a new player with a retired player's name is a different player (his own row from zero)", JSON.stringify(f.boards.AAA.pts));
}

// ---------- Franchise single-season records, on pace ----------
{
  const { seasonPace } = await import("../src/records/franchiseSeason.js");
  const fs2 = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-franchise-seasons-2026-27.json"), "utf8")).franchises;
  const top = (t, k, s) => fs2[t][k][s][0];
  ok(top("GSW", "totals", "pts").join() === "Wilt Chamberlain,4029,1961-62,80" && top("CHI", "totals", "pts").join() === "Michael Jordan,3041,1986-87,82" && top("LAL", "totals", "pts")[1] === 2832
    && top("HOU", "perGame", "pts")[0] === "James Harden" && top("HOU", "perGame", "pts")[1] === 36.128 && top("UTA", "totals", "ast")[1] === 1164 && top("GSW", "totals", "fg3m")[1] === 402
    && top("SAS", "totals", "blk")[1] === 320 && fs2.LAL.teamGames["1998-99"] === 50 && fs2.LAL.teamGames["2019-20"] === 71,
    "franchise seasons: best seasons per franchise (Wilt 4,029; Jordan 3,041; Kobe 2,832; Harden 36.1 a game; Stockton 1,164 assists; Curry 402 threes; Robinson 320 blocks); team games from the totals row (50 in 1998-99)");
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const L = (o) => keys.map((k) => o[k] ?? 0);
  // 10 team games: Star plays all 10 (30 points), Sixth plays 6 (25 points).
  const games = Array.from({ length: 10 }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, opp: "BOS", home: true, pf: 1, pa: 0,
    pl: { 1: L({ min: 34, pts: 30 }), ...(i < 6 ? { 2: L({ min: 20, pts: 25 }) } : { 2: L({}) }) } }));
  const seasons = { franchises: { AAA: { name: "Testers", totals: { pts: [["Old Star", 2400, "1990-91", 82], ["Next", 2300, "1991-92", 80], ["Third", 2200, "1992-93", 80]] },
    perGame: { pts: [["Old Star", 29.3, "1990-91", 82]] } } } };
  const r = seasonPace({ seasons, teamFiles: { AAA: { team: "AAA", keys, names: { 1: "Big Star", 2: "Sixth Man" }, games } } });
  const tot = r.find((x) => x.who === "Big Star" && x.kind === "total"), pg = r.find((x) => x.who === "Big Star" && x.kind === "perGame");
  ok(tot?.pace === 2460 && tot.place === 1 && /on pace for 2,460 points, which would be the most in a season in Testers history \(record: Old Star, 2,400 in 1990-91\)/.test(tot.text)
    && pg?.place === 1 && !r.some((x) => x.who === "Sixth Man"),
    "franchise seasons: pace = total + rate per team game over the games left; per game only at 70% of team games (6 of 10 doesn't qualify; 150 + 15/game pace stays below 3rd)", JSON.stringify(r));
}

// ---------- Franchise single-game records (29 team media guides) ----------
{
  const fg = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-franchise-single-game-2026-27.json"), "utf8")).teams;
  const st = ["pts", "reb", "ast", "stl", "blk", "fg3m"];
  ok(Object.keys(fg).length === 30 && fg.UTA.pts.value === 68 && Object.values(fg).every((t) => st.every((s) => t[s] && t[s].value > 0 && t[s].holders.length)),
    "franchise single-game records: all 30 teams (Utah from its 'top individual' lists, Maravich 68), all six stats with holders");
  ok(fg.GSW.pts.value === 100 && fg.LAL.pts.value === 81 && fg.MIA.pts.value === 83 && fg.PHX.pts.value === 70 && fg.LAL.blk.value === 17 && fg.ORL.ast.value === 30
    && fg.OKC.pts.value === 58 && fg.OKC.pts.holders.length === 2 && fg.OKC.reb.value === 30 && fg.OKC.ast.value === 25 && fg.OKC.stl.value === 10 && fg.OKC.fg3m.holders.length === 2,
    "franchise single-game records: Wilt 100, Kobe 81, Adebayo 83, Booker 70, Elmore Smith 17 blocks, Skiles 30 assists; the Thunder's include Seattle (Fred Brown's 58, Fox's 30, McMillan's 25; Joe ties George's 10 threes)");
}

// ---------- NBA Cup final: counts in neither standings nor stats ----------
{
  // Shapes as ESPN gave them for the 12/13/25 semifinals and 12/16/25 final (scoreboard and team schedule).
  const ev = (id, note, type, home, away, hs, as) => ({ id, date: "2025-12-17T01:30Z", season: { year: 2026, type: 2 }, seasonType: { type: 2 },
    competitions: [{ type, notes: [{ headline: note }], neutralSite: true, status: { type: { completed: true, state: "post" }, period: 4 },
      competitors: [{ homeAway: "home", score: String(hs), team: { displayName: home } }, { homeAway: "away", score: String(as), team: { displayName: away } }] }] });
  const json = { events: [
    ev("401809839", "NBA Cup Championship", { id: "39", abbreviation: "CC" }, "New York Knicks", "San Antonio Spurs", 124, 113),
    ev("401809838", "NBA Cup - Semifinals", { id: "1", abbreviation: "STD" }, "San Antonio Spurs", "Oklahoma City Thunder", 111, 109),
  ] };
  const sb = readScoreboard(json).games;
  ok(sb[0].seasonType === CUP_FINAL && sb[1].seasonType === 2, "NBA Cup: the final is set apart (type CC / note), a semifinal still counts", JSON.stringify(sb.map((g) => g.seasonType)));
  ok(isCupFinal({ type: { id: "1" }, notes: [{ headline: "NBA Cup Championship" }] }) && isCupFinal({ type: { abbreviation: "CC" } }) && !isCupFinal({ type: { abbreviation: "STD" }, notes: [{ headline: "NBA Cup - East Group A" }] }),
    "NBA Cup: either signal marks the final; group games don't");
  const sch = readSchedule(json);
  ok(sch.filter((g) => g.seasonType === 2).length === 1 && sch.find((g) => g.id === "401809839").seasonType === CUP_FINAL, "NBA Cup: team schedules mark it too");
  ok(rowFromGame({ ...sb[0], date: "2025-12-16" }) === null && rowFromGame({ ...sb[1], date: "2025-12-13" }) !== null, "NBA Cup: team records skip the final, keep the semifinal");
}

// ---------- Official injury report: reading the PDF's table, and what an absence means ----------
{
  ok(slotUrl("2026-11-11", 20, 37) === "https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-11_08_30PM.pdf" && slotUrl("2026-11-12", 0, 5).endsWith("_12_00AM.pdf") && slotUrl("2026-11-12", 12, 0).endsWith("_12_00PM.pdf")
    && slotsBackFrom("2026-11-11", 0, 20).length === 2, "injuries: report URLs per 15-minute Eastern slot (12 AM / 12 PM handled)");
  ok(displayName("Haliburton, Tyrese") === "Tyrese Haliburton" && displayName("Udeh, Jr., Ernest") === "Ernest Udeh Jr." && displayName("McCullar Jr., Kevin") === "Kevin McCullar Jr." && displayName("Jackson- Davis, Trayce") === "Trayce Jackson-Davis",
    "injuries: names \"Last, First\", suffix as its own part, and a hyphen split by a line break");
  ok(shortReason("Injury/Illness - Left Hamstring Strain") === "left hamstring strain" && shortReason("G League - Two-Way") === "g league: two-way", "injuries: short reasons");
  // A made-up report with the real layout's quirks (x positions as on the 11/11/26 report).
  const I = (x, y, str) => ({ x, y, str });
  const header = [I(289, 533, "Injury"), I(356, 533, "Report:"), I(438, 533, "11/11/26"), I(540, 533, "08:30"), I(602, 533, "PM"),
    I(23, 480, "Game"), I(53, 480, "Date"), I(120, 480, "Game"), I(149, 480, "Time"), I(200, 480, "Matchup"), I(264, 480, "Team"), I(425, 480, "Player"), I(457, 480, "Name"), I(586, 480, "Current"), I(624, 480, "Status"), I(666, 480, "Reason")];
  const page1 = [...header,
    I(24, 459, "11/11/2026"), I(121, 459, "07:00"), I(146, 459, "(ET)"), I(201, 459, "WAS@IND"), I(265, 459, "Indiana"), I(298, 459, "Pacers"), I(426, 459, "Haliburton,"), I(474, 459, "Tyrese"), I(587, 459, "Out"), I(667, 459, "Injury/Illness"), I(722, 459, "-"), I(727, 459, "Left"), I(745, 459, "Hamstring"), I(789, 459, "Strain"),
    I(667, 444, "Injury/Illness"), I(722, 444, "-"), I(727, 444, "Right"), I(750, 444, "Avulsion"), // reason wraps above and below its row
    I(426, 437, "Bittle,"), I(452, 437, "Nate"), I(587, 437, "Out"),
    I(667, 430, "Fracture"),
    I(426, 415, "Udeh,"), I(453, 415, "Jr.,"), I(467, 415, "Ernest"), I(587, 415, "Questionable"), I(667, 415, "G"), I(676, 415, "League"), I(707, 415, "-"), I(712, 415, "Two-"), I(732, 415, "Way"),
    I(399, 50, "Page"), I(420, 50, "1"), I(428, 50, "of"), I(438, 50, "2")];
  const page2 = [I(289, 533, "Injury"), I(356, 533, "Report:"), I(438, 533, "11/11/26"),
    I(426, 505, "Jackson-"), I(460, 505, "Davis,"), I(487, 505, "Trayce"), I(587, 505, "Doubtful"), I(667, 505, "Injury/Illness"), I(722, 505, "-"), I(727, 505, "Illness"), // team carried from page 1
    I(24, 483, "11/12/2026"), I(121, 483, "07:00"), I(146, 483, "(ET)"), I(201, 483, "DET@WAS"), I(265, 483, "Washington"), I(316, 483, "Wizards"), I(426, 483, "NOT"), I(446, 483, "YET"), I(466, 483, "SUBMITTED")];
  const rep = parseReport([page1, page2]);
  const R = rep.rows;
  ok(rep.asOf === "11/11/26 08:30 PM" && R.length === 5, "injuries: report time and row count", JSON.stringify(R.map((r) => r.name)));
  ok(R[0].team === "IND" && R[0].matchup === "WAS@IND" && R[0].name === "Tyrese Haliburton" && R[0].status === "Out" && R[0].reason === "Injury/Illness - Left Hamstring Strain", "injuries: first row read", JSON.stringify(R[0]));
  ok(R[1].name === "Nate Bittle" && R[1].team === "IND" && R[1].reason === "Injury/Illness - Right Avulsion Fracture", "injuries: a reason split above and below its row is rejoined; team carried down", JSON.stringify(R[1]));
  ok(R[2].name === "Ernest Udeh Jr." && R[2].status === "Questionable" && R[2].reason === "G League - Two-Way", "injuries: suffix name; G League reason", JSON.stringify(R[2]));
  ok(R[3].name === "Trayce Jackson-Davis" && R[3].team === "IND" && R[3].date === "11/11/2026" && R[3].status === "Doubtful", "injuries: page 2 has no header; columns and team carry over", JSON.stringify(R[3]));
  ok(R[4].team === "WAS" && R[4].date === "11/12/2026" && R[4].status === "Not yet submitted" && R[4].name === null, "injuries: a team that hasn't submitted yet", JSON.stringify(R[4]));
  {
    // 0.141.5: one reader of the newest posted report for every step (the cards and the record chances used the previous
    // build's copy). Two slots not posted, then this report: read it, count the two, keep tonight's rows.
    const { latestReport, reportClock, tonightRowsOf } = await import("../src/injuries/report.js");
    const asItems = (pg) => ({ items: pg.map((it) => ({ str: it.str, transform: [1, 0, 0, 1, it.x, it.y] })) });
    const fakePdf = { getDocument: () => ({ promise: Promise.resolve({ numPages: 2, getPage: async (n) => ({ getTextContent: async () => asItems(n === 1 ? page1 : page2) }) }) }) };
    let asked = [];
    const fetchFn = async (url) => { asked.push(url); return asked.length <= 2 ? { ok: false } : { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; };
    const lr = await latestReport("2026-11-11", 20, 40, { fetchFn, pdfjs: fakePdf });
    const tr = tonightRowsOf(lr, "2026-11-11");
    const none = await latestReport("2026-11-11", 20, 40, { fetchFn: async () => ({ ok: false }), pdfjs: fakePdf, maxSlots: 3 });
    const clk = reportClock("2026-01-01", new Date("2026-11-21T05:30:00Z"));
    ok(lr.asOf === "11/11/26 08:30 PM" && lr.behind.missing === 2 && lr.behind.minutes === 30 && asked[0].endsWith("_08_30PM.pdf") && asked[2].endsWith("_08_00PM.pdf")
      && tr.length === 4 && tr.every((r) => r.team === "IND") && tr[0].name === "Tyrese Haliburton" && Object.keys(tr[0]).join() === "team,name,status,reason,matchup,time"
      && none.none === true && none.slotsTried === 3 && clk.h === 23 && clk.m === 45 && !clk.live,
      "injuries (0.141.5): the newest posted report, slots not posted passed over and counted; tonight's rows in the saved shape; none found says so", JSON.stringify({ behind: lr.behind, n: tr.length, none, clk }));
  }
  // Impact on a made-up team: H (the injured regular) misses games 4-5; T picks up his shots.
  const line = (min, pts, ast = 2, reb = 4) => [1, min, pts, 0, 0, 0, 0, 0, 0, reb, ast, 0, 0, 0, 0, 0, 0, 0];
  const g = (d, pf, pa, hMin, tPts, tMin = 25) => ({ d, pf, pa, pl: { h1: line(hMin, hMin ? 20 : 0), t1: line(tMin, tPts), z1: line(10, 2) } });
  const files = { IND: { team: "IND", names: { h1: "Tyrese Haliburton", t1: "Andrew Nembhard", z1: "Bench Guy" }, games: [
    g("2026-11-01", 110, 100, 34, 10), g("2026-11-03", 105, 100, 33, 11), g("2026-11-05", 100, 104, 35, 9), g("2026-11-07", 95, 110, 0, 18, 32), g("2026-11-09", 99, 101, 0, 20, 33)] } };
  ok(matchId({ team: "IND", name: "Tyrese Haliburton" }, files.IND) === "h1" && matchId({ team: "IND", name: "Nobody Here" }, files.IND) === null, "injuries: report names matched to ESPN ids within the team");
  const imp = injuryImpacts([{ ...R[0] }, { ...R[2] }, { team: "IND", name: "Bench Guy", status: "Out", reason: "Rest", date: "11/11/2026" }], files, { date: "2026-11-11" });
  const h = imp[0];
  ok(imp.length === 1 && h.id === "h1" && h.without.w === 0 && h.without.l === 2 && h.with.w === 2 && h.missedInARow === 2,
    "injuries: a regular's record without him; bench players and G League entries left out", JSON.stringify(imp.map((x) => x.text)));
  ok(/^Tyrese Haliburton OUT \(left hamstring strain\): IND 0-2 without him \(-8\.5 a game\), 2-1 with; A\. Nembhard 10\.0 → 19\.0 pts/.test(h.text), "injuries: line wording, with the teammate whose numbers jump", h.text);
  ok(injuryImpacts([{ ...R[0], date: "11/12/2026" }], files, { date: "2026-11-11" }).length === 0, "injuries: another night's entries are ignored");
  // The report overrules the storylines: Out removes a player's other lines; Questionable marks them.
  const watch = { today: "2026-11-11", games: [{ id: "g", awayTri: "WAS", homeTri: "IND", start: "2026-11-12T00:00Z" }], teams: [{ team: "IND", items: [
    { player: "Tyrese Haliburton", stat: "ast", label: "assists", kind: "round", scope: "career", target: 3000, need: 5, importance: 40, pTonight: 0.8, publishable: true },
    { player: "Pascal Siakam", stat: "pts", label: "points", kind: "round", scope: "career", target: 15000, need: 9, importance: 45, pTonight: 0.9, publishable: true }] }] };
  const injuries = { date: "2026-11-11", players: [{ team: "IND", name: "Tyrese Haliburton", status: "Out" }, { team: "IND", name: "Pascal Siakam", status: "Questionable" }],
    impact: [h, { ...h, text: "two", score: 1 }, { ...h, text: "three", score: 0.5 }] };
  const st = tonightStorylines({ watch, injuries });
  const txt = st[0].lines.map((l) => l.text).join(" | ");
  ok(!/Haliburton: 5 assists/.test(txt) && /Siakam: 9 points .* · questionable tonight/.test(txt) && st[0].lines.filter((l) => l.kind === "injury").length === 2,
    "storylines: an Out player loses his other lines, a Questionable one is marked, at most 2 injury lines a game", txt);
  ok(tonightStorylines({ watch, injuries: { ...injuries, date: "2026-11-10" } })[0].lines.some((l) => /Haliburton: 5 assists/.test(l.text)), "storylines: an injury report for another night is ignored");
}

// ---------- Articles watcher (cloudflare/articles-worker.js): tests/articles-worker.js ----------
await articlesChecks(ok);
await contractChecks(ok, root);
{
  // 0.141.6: the season in one place (src/season.js) and the rollover warning (docs/SEASON.md).
  const S = await import("../src/season.js");
  const etToday = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  ok(S.seasonFor("2026-10-21") === "2026-27" && S.seasonFor("2027-06-15") === "2026-27" && S.seasonFor("2027-07-31") === "2026-27" && S.seasonFor("2027-08-01") === "2027-28"
    && S.seasonFor("2099-12-01") === "2099-00" && S.seasonFile("nba-career-seasons") === `nba-career-seasons-${S.SEASON}.json` && S.seasonFile("guide-games", ".json.gz") === `guide-games-${S.SEASON}.json.gz`
    && /2027-28 season but the Command Center is set up for 2026-27/.test(S.seasonNotice("2027-08-01") || "") && S.seasonNotice("2026-11-21") === null
    && /no trade deadline/.test(S.seasonNotice("2026-11-21", { keyDates: { "trade deadline": undefined, "NBA Cup final date": "2026-12-11" } }) || ""),
    "season (0.141.6): one season constant; season of a date (Aug 1 starts the next); file names; the rollover and missing-date notices");
  const files = fs.readdirSync(path.join(root, "src", "data")).filter((f) => f.includes(S.SEASON));
  ok(files.length >= 20 && ["nba-career-seasons", "nba-team-seasons", "series-bests"].every((st) => files.includes(S.seasonFile(st))) && files.includes(S.seasonFile("guide-games", ".json.gz")) && files.includes(S.seasonFile("player-feat-runs", ".json.gz")),
    `season (0.141.6): every reference file the build loads by the season's name is on file (${files.length} named for ${S.SEASON})`, JSON.stringify(files));
  // The trigger: from Aug 1 this fails on every test run (so every code push) until the rollover is done.
  ok(S.seasonNotice(etToday) === null, `season (0.141.6): the calendar (${etToday}) is still in ${S.SEASON}; when this fails, follow docs/SEASON.md`, S.seasonNotice(etToday));
}   // 0.141.6: what NBA Live reads, against the real published files (docs/DATA.md)

// ---------- NBA Live bridge: tests/bridge.js (moved out 0.141.6) ----------
await bridgeChecks(ok, root);

// ---------- Trends, sidebars and feature tables in the notes (0.62; the user's Rockets / Blazers / Jazz picks, 11/13) ----------
{
  const N2 = await import("../src/notes/narrative.js");
  const F = await import("../src/notes/facts.js");
  const L = (text) => ({ text, cells: [{ x0: 40, x1: 560, cx: 300, text }], charX: [] });
  const doc = { pages: [
    { page: 1, width: 612, lines: [
      L("KBME 790/KTRH 740 • SOL 101.7 FM (Spanish) Forward #7 Kevin Durant 6-10/240 • 9/29/88 • Texas/USA • 20th season (2nd w/HOU) Notes/Trends [2026-27 Video Highlights] 2026-27 Season Stats Had 5+ assists in each of the past 2 games after doing so once prior this GP 12 PPG 20.9 RPG 6.1 APG 3.6 season; back to last season, Rockets are 30-12 when he has 5+ assists… GS 12 SPG 0.58 BPG 1.25 TPG 3.3 bla has scored 20+ points in 4 straight games for the 2nd time this season (first 4 games)… Center #28 Alperen Sengun 6-11/255 • 7/25/02 • Besiktas (TBSL)/Türkiye • 6th season (6th w/HOU) Notes/Trends [2026-27 Video Highlights] Along with Jokić, on pace to become first players in NBA history to have GP 10 PPG 21.1 RPG 9.4 APG 7.9 averaged at least 21.0 ppg, 9.0 rpg, 7.0 apg, 1.00 spg and 1.00 bpg in a season."),
    ] },
    { page: 4, width: 612, lines: [
      L("Rockets Offense ➢ Averaging 108.0 ppg over the past 5 games after averaging 120.7 the first 7 games (115.4 per overall)."),
      L("SCHEDULE NOTES Here are some notes from the Rockets schedule this season: • From 12/18 through All-Star break, Houston will play 20 of 32 games of the road. • Following a 5-game homestand post All-Star break, the Rockets will play 9 of 13 on the road from 3/7-3/31 before finishing with 4 of their final 5 games at home."),
    ] },
    { page: 2, width: 612, lines: [
      L("#33 Toumani Camara F • 6-7 • 230 • Dayton/Belgium • 4th Season LAST GAME: 14 pts / 5 rebs / 3 asts / 2 blks / 38 mins • Ranks 10th in NBA in 3FG% (.432, 32-74), fourth in eFG% (.667) GP/GS PPG RPG APG SPG BPG MPG and second in catch and shoot 3FG% (.450) 11/11 13.1 3.5 1.5 0.7 0.4 28.5 • Has started 97 consecutive regular season games"),
    ] },
    { page: 3, width: 612, lines: [
      L("Coming off the bench in every game so far this season, Jrue Holiday ranks highly in several bench offensive categories: Category Value NBA Bench Rank Total Bench Points 147 pts 4th Points Per 36 Minutes (min. 250 MP) 18.4 4th Assists Per 36 Minutes (min. 250 MP) 5.4 2nd HOLIDAY JOINS LILLARD IN TOP 100"),
    ] },
  ] };
  const players = [{ id: "1", name: "Kevin Durant" }, { id: "2", name: "Alperen Sengun" }, { id: "3", name: "Toumani Camara" }, { id: "4", name: "Jrue Holiday" }];
  const dropped = [];
  const h = readHistory(doc, players, { seasonStart: "2026-10-01", today: "2026-11-13", teamWords: ["Houston", "Rockets", "Portland", "Trail Blazers"], dropped, tris: ["POR"] });
  const by = (re) => h.find((x) => re.test(x.text));
  ok(by(/^Had 5\+ assists in each of the past 2 games after doing so once prior this season; back to last season, Rockets are 30-12/)?.player === "Kevin Durant"
    && by(/^Has scored 20\+ points in 4 straight games/)?.player === "Kevin Durant" && by(/^Along with Jokić, on pace/)?.player === "Alperen Sengun",
    "notes (0.62): a player box with its stats sidebar read into the prose reads whole, and each note is his (the header before the box)", JSON.stringify(h.map((x) => [x.player, x.text.slice(0, 60)])));
  ok(by(/Averaging 108\.0 ppg over the past 5 games/)?.team && !h.some((x) => /will play/.test(x.text)) && dropped.filter((d) => d.reason === "schedule").length === 2,
    "notes (0.62): a team-stats box's stretch is the team's; schedule stretches ('will play 20 of 32…') are left out", JSON.stringify(dropped.filter((d) => d.reason === "schedule")));
  ok(by(/^Ranks 10th in NBA in 3FG% \(\.432, 32-74\), fourth in eFG% \(\.667\) and second in catch and shoot/)?.player === "Toumani Camara" && by(/^Has started 97 consecutive regular season games\.$/)?.player === "Toumani Camara",
    "notes (0.62): bullets without a final stop and a season line read into them; league ranks written without 'the'", JSON.stringify(h.map((x) => x.text.slice(0, 70))));
  ok(by(/Jrue Holiday ranks highly in several bench offensive categories: Total Bench Points 147 pts \(4th\); Points Per 36 Minutes 18\.4 \(4th\); Assists Per 36 Minutes 5\.4 \(2nd\)\.$/)?.player === "Jrue Holiday",
    "notes (0.62): a feature box's table read into one line with its ranks", JSON.stringify(h.map((x) => x.text)));
  ok(N2.summarizeTable("Through the season’s first 11 games, Portland’s offensive output is outperforming last season’s production in several categories: Offensive Category 2025-26 (rank) 2026-27 (rank) Offensive Rating 113.1 (21st) 118.5 (4th) Points Per Game 115.5 ppg (17th) 119.5 ppg (2nd) BLAZERS IMPROVING UP")
    === "Through the season’s first 11 games, Portland’s offensive output is outperforming last season’s production in several categories: Offensive Rating 118.5 (4th), from 113.1 (21st); Points Per Game 119.5 ppg (2nd), from 115.5 ppg (17th).",
    "notes (0.62): a this-season-against-last table reads 'now, from then'");
  const kd = { text: "Averaging 108.0 ppg over the past 5 games after averaging 120.7 the first 7 games (115.4 per overall).", kind: "trend" };
  const bx = { games: ["2026-10-21", "2026-10-23", "2026-11-11"].map((d) => ({ d })) };
  ok(F.trimReason(kd, { box: bx, today: "2026-11-13" }) === null && F.features(kd.text, kd).stretch === 1 && F.features("Rockets are 30-12 when he has 5+ assists.", {}).whenRecord === 1,
    "notes (0.62): a stretch against the season's first games isn't a past one-off; the scorer sees stretches and records-when");
}

// ---------- 0.66: prep stats and the briefing (the user's 11/14 tweets: Curry, Durant, Dosunmu, Dončić, Jokić) ----------
{
  const P = await import("../src/anticipate/prep.js");
  const { briefing } = await import("../src/anticipate/briefing.js");
  const day = (n) => new Date(Date.UTC(2026, 9, 21) + n * 864e5).toISOString().slice(0, 10);
  const line = (d, team, opp, o) => ({ d, gameId: `${d}${team}`, team, opp, home: true, win: true, min: 34, pts: 20, reb: 5, ast: 5, stl: 1, blk: 0, fgm: 7, fga: 15, fg3m: 2, fg3a: 6, ftm: 4, fta: 5, tov: 2, ...o });
  // Season vs career: a scorer at 31 PPG and 50% FG this season; his past seasons top out at 29.4 PPG (2022-23) and 32 (2020-21).
  const seasons = { keys: ["season", "g", "min", "pts", "reb", "ast", "stl", "blk", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "tov", "hi"], players: { "Star Guy": [
    ["2014-15", 80, 2700, 1900, 300, 600, 100, 20, 650, 1340, 280, 640, 300, 330, 200, 50], ["2015-16", 79, 2700, 2375, 430, 525, 170, 15, 805, 1600, 400, 885, 360, 400, 260, 53],
    ["2018-19", 69, 2300, 1880, 370, 360, 90, 25, 630, 1340, 350, 810, 290, 320, 190, 51], ["2019-20", 70, 2300, 1750, 350, 350, 80, 20, 600, 1330, 300, 760, 250, 280, 180, 45],
    ["2020-21", 63, 2150, 2015, 345, 365, 75, 10, 660, 1365, 337, 801, 362, 395, 213, 62], ["2021-22", 64, 2210, 1630, 335, 405, 85, 20, 535, 1225, 285, 750, 270, 290, 205, 50],
    ["2022-23", 56, 1940, 1645, 345, 355, 50, 20, 560, 1135, 275, 645, 255, 280, 175, 50], ["2023-24", 74, 2420, 1950, 330, 375, 55, 30, 650, 1450, 355, 870, 290, 315, 210, 46],
    ["2024-25", 70, 2280, 1680, 310, 420, 80, 25, 580, 1290, 310, 780, 250, 270, 200, 50], ["2025-26", 72, 2300, 1900, 320, 400, 80, 20, 640, 1390, 330, 820, 270, 290, 205, 49]] } };
  const pg = { s1: Array.from({ length: 8 }, (_, i) => line(day(i), "GSW", "AAA", { pts: 31, fgm: 11, fga: 22, fg3m: 5, fg3a: 11 })) };
  const S = P.seasonLines({ pg, seasons, names: { s1: "Star Guy" }, season: "2026-27" });
  ok(S[0] && /31\.0 PPG \(highest since '20-21\)/.test(S[0].text) && /50\.0% FG \(highest since '15-16\)/.test(S[0].text), "prep (0.66): this season against his career seasons: 'highest since' and career highs", S[0]?.text);
  // Since a teammate went out: ESTAR (25 PPG) plays 3, then misses 4; the guard goes from 12 to 21.
  const rows = [], pg2 = { e: [], g: [] };
  for (let i = 0; i < 7; i++) { const d = day(i), id = `x${i}`; rows.push({ id, d, h: "MIN", a: "OPP", hs: i % 3 ? 110 : 100, as: 105 });
    if (i < 3) pg2.e.push({ ...line(d, "MIN", "OPP", { pts: 25 }), gameId: id });
    pg2.g.push({ ...line(d, "MIN", "OPP", { pts: i < 3 ? 12 : 21 }), gameId: id }); }
  const A = P.absenceLines({ pg: pg2, rows, names: { e: "Edwards Star", g: "Guard Guy" } });
  ok(A[0] && /^Guard Guy since Edwards Star last played \(\d+\/\d+\), 4 games: 21\.0 PPG.*\(12\.0 PPG before\); MIN's leading scorer, \d-\d in that span/.test(A[0].text), "prep (0.66): since a teammate last played: who stepped up, before and after, the record", A[0]?.text);
  // Player streak watch: 40+ in 4 straight now; in history one player did 5.
  const logs = { columns: ["date", "opp", "home", "result", "type", "min", "pts", "reb", "ast", "stl", "blk", "fg3m", "fgm", "fga", "fg3a", "ftm", "fta"], players: {
    h1: [40, 41, 44, 50, 42, 20].map((p, i) => [`2018-11-0${i + 1}`, "BBB", 1, "W", 2, 36, p, 5, 5, 1, 0, 3, 12, 25, 8, 10, 12]) } };
  const pg3 = { l1: [28, 45, 42, 40, 53].map((p, i) => line(day(i), "LAL", "CCC", { pts: p })) };
  const T = P.streakLines({ pg: pg3, logs, names: { l1: "Luka Guy", h1: "James Harden" } });
  ok(T[0] && /40\+ points in 4 straight games: one more tonight would put him with James Harden '18-19/.test(T[0].text), "prep (0.66): a 5th straight 40-point game tonight, with who else did it since 2016-17", T[0]?.text);
  // 0.141.7: the run ends. The same 40+ run (4 straight), then 31 on the latest date: said once, with what one more meant;
  // a player whose run goes on, or who didn't play on the latest date, gets nothing.
  const pgB = { l1: [28, 45, 42, 40, 53, 31].map((p, i) => line(day(i), "LAL", "CCC", { pts: p })), k1: [41, 43, 44, 40, 45, 46].map((p, i) => line(day(i), "BOS", "DDD", { pts: p })) };
  const Bk = P.brokenLines({ pg: pgB, logs, names: { l1: "Luka Guy", h1: "James Harden", k1: "Keeps Going" } });
  const BkNext = P.brokenLines({ pg: { ...pgB, z9: [line(day(6), "NYK", "EEE", {})] }, logs, names: { l1: "Luka Guy", h1: "James Harden", k1: "Keeps Going", z9: "Other Guy" } });
  ok(Bk.length === 1 && Bk[0].kind === "broken" && /^Luka Guy's run of 4 straight games with 40\+ points ended \d+\/\d+ \(31 points\): one more would have put him with James Harden '18-19$/.test(Bk[0].text) && !BkNext.some((l) => l.player === "Luka Guy"),
    "prep (0.141.7): a streak that ended last night is said once, the day after, with what one more would have meant; not for a run that goes on, and not the next day", JSON.stringify({ Bk: Bk.map((l) => l.text), BkNext: BkNext.map((l) => l.text) }));
  // Vs tonight's opponent: triple-doubles in 6 of 8 against NOP, 2 of 20 against everyone else.
  const L4 = { columns: logs.columns, players: { j1: [...Array.from({ length: 8 }, (_, i) => [`2019-0${(i % 9) + 1}-10`, "NOP", 1, "W", 2, 34, 27, i < 6 ? 12 : 8, i < 6 ? 11 : 7, 1, 1, 1, 10, 18, 3, 4, 5]),
    ...Array.from({ length: 20 }, (_, i) => [`2020-0${(i % 9) + 1}-${10 + (i % 15)}`, "XXX", 1, "W", 2, 34, 24, i < 2 ? 12 : 9, i < 2 ? 10 : 6, 1, 1, 1, 9, 17, 3, 4, 5])] } };
  const V = P.vsOppLines({ pg: { j1: [line(day(0), "DEN", "QQQ", {})] }, logs: L4, names: { j1: "Joker Guy" }, games: [{ away: "DEN", home: "NOP" }] });
  ok(V[0] && /a triple-double in 6 of his last 8 games vs\. NOP/.test(V[0].text), "prep (0.66): a feat far more common against tonight's opponent", V[0]?.text);
  // The briefing: one per player, injuries kept out, a new rare line beats a stale big one, deep cuts are lesser-known players.
  const all = [{ kind: "injury", team: "AAA", text: "X out", score: 9 }, { kind: "pstreak", team: "AAA", player: "Star", text: "Star 40+ in 4 straight", score: 3.6, rare: true },
    { kind: "season", team: "AAA", player: "Star", text: "Star this season…", score: 3 }, { kind: "history", team: "BBB", player: "Old News", text: "a stale line", score: 3.8, key: "old" },
    { kind: "pace", team: "BBB", player: "Bench Guy", text: "Bench Guy most threes through 9", score: 3.4, rare: true }];
  const B = briefing({ all, games: [{ away: "AAA", home: "BBB" }], stars: { Star: 0.9, "Old News": 0.5, "Bench Guy": 0.2 }, seen: { old: "2026-11-01" }, today: "2026-11-14", topN: 1, deepN: 2 });
  ok(B.top[0].text === "Star 40+ in 4 straight" && !B.top.some((l) => l.kind === "injury") && B.top.filter((l) => l.player === "Star").length === 1 && B.deep.some((l) => l.player === "Bench Guy") && B.seen.old === "2026-11-01",
    "briefing (0.66): ranked across the slate, one line per player, no injury lines, a line seen for days fades, lesser-known rare lines as deep cuts", JSON.stringify({ top: B.top.map((l) => l.text), deep: B.deep.map((l) => l.text) }));
}

// ---------- 0.67: learning from briefing votes; "did we see it coming?" ----------
{
  const { learn, boost, features } = await import("../src/anticipate/learn.js");
  const { briefing } = await import("../src/anticipate/briefing.js");
  const stars = { "Star A": 0.9, "Star B": 0.8, "Bench C": 0.2, "Bench D": 0.25 };
  const votes = [
    { key: "k1", kind: "season", player: "Star A", text: "Star A this season: 20.0 PPG (career-low)", v: 1 },
    { key: "k2", kind: "season", player: "Star B", text: "Star B this season: 25.0 PPG (career-low)", v: 1 },
    { key: "k3", kind: "history", player: "Bench C", text: "CHI notes: Bench C ranked second in deflections", v: -1 },
    { key: "k4", kind: "history", player: "Bench D", text: "DET notes: Bench D led the team in charges", v: -1 },
  ];
  const M = learn(votes, stars);
  const good = { kind: "season", player: "Star B", text: "Star B this season: 24.0 PPG (career-low)" }, bad = { kind: "history", player: "Bench D", text: "MIA notes: Bench D…" };
  ok(M.n === 4 && boost(good, M, stars) > 0.5 && boost(bad, M, stars) < -0.5 && features({ kind: "team", text: "x" }).includes("who:team"),
    "learn (0.67): votes become weights by feature (kind, who, what it says); like lines rise, unlike lines sink", JSON.stringify(M.weights));
  const all = [{ kind: "history", team: "AAA", player: "Bench D", text: "MIA notes: Bench D…", score: 4 }, { kind: "season", team: "BBB", player: "Star B", text: "Star B this season: 24.0 PPG (career-low)", score: 3 },
    { kind: "team", team: "AAA", text: "voted down", score: 5, key: "kd" }];
  const B = briefing({ all, games: [{ away: "AAA", home: "BBB" }], stars, today: "2026-11-15", model: { ...M, down: new Set([...M.down, "kd"]) } });
  ok(B.top[0].player === "Star B" && !B.top.some((l) => l.key === "kd"), "briefing (0.67): the learned weights reorder it, and a line voted down stays out", JSON.stringify(B.top.map((l) => [l.text, l.learned])));
  const { runChecks } = await import("../src/anticipate/flagcheck.js");
  const rows = [{ d: "2026-11-10", h: "OKC", a: "AAA", hs: 100, as: 110 }, { d: "2026-11-12", h: "OKC", a: "AAA", hs: 99, as: 104 }, { d: "2026-11-13", h: "OKC", a: "AAA", hs: 90, as: 104 }];
  const H = { games: [] };
  for (let i = 0; i < 90; i++) H.games.push([new Date(Date.UTC(2024, 0, 1) + i * 864e5).toISOString().slice(0, 10), "OKC", "AAA", i % 2 ? 120 : 100, 110, 2]);
  const R = runChecks([{ id: "okc", morning: "2026-11-13", claim: "OKC 3 straight", detector: "teamwatch", match: "^OKC has lost 2 straight: a loss tonight would be its first 3-game losing streak" },
    { id: "nope", morning: "2026-11-13", claim: "something else", detector: "teamwatch", match: "^NOP " }], { rows, history: H, names: {} });
  ok(R.found === 1 && R.total === 2 && R.checks[0].found && /first 3-game losing streak/.test(R.checks[0].line) && !R.checks[1].found,
    "flag checks (0.67): a posted stat is checked against what we'd have said that morning (results before that day only)", JSON.stringify(R.checks.map((c) => [c.id, c.found, c.line])));
}

// ---------- 0.70: season-long and morning-after lines (the StatMuse posts, 11/15), headlines, last season replayed ----------
{
  const S = await import("../src/anticipate/seasonlong.js");
  const day = (i) => new Date(Date.UTC(2026, 9, 21) + i * 864e5).toISOString().slice(0, 10);
  const T30 = ["ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"];
  // 30 teams, 20 nights: OKC wins its first 12 then goes 2-6; everyone else alternates. Box totals: 100 possessions a side.
  const rows = [];
  const box = (pts) => [40, 85, 12, 35, 8, 10, 10, 34, 25, 8, 5, 15, 20];
  for (let i = 0; i < 20; i++) for (let k = 0; k < 15; k++) {
    const h = T30[(k + i) % 30], a = T30[(k + i + 15) % 30];
    let hw = (i + k) % 2 === 0;
    if (h === "OKC") hw = i < 12 || i % 4 === 0; if (a === "OKC") hw = !(i < 12 || i % 4 === 0);
    rows.push({ id: `g${i}-${k}`, d: day(i), h, a, hs: hw ? 110 : 100, as: hw ? 100 : 110, hb: box(), ab: box() });
  }
  const turn = S.turnLines({ rows });
  // 0.107.1: the turn may now fall anywhere from four games in to six from the end, so the split is where it really is (13-0, then 1-6; with eight a side it could only say 12-0, then 2-6)
  ok(turn.some((l) => /^OKC went 13-0 in its first 13 games; 1-6 since/.test(l.text)), "season-long (0.70): a record turn (\"24-1 in their first 25, 6-5 since\")", JSON.stringify(turn.map((l) => l.text)));
  // Players: a trade (two teams), a starter/bench split, a five that keeps winning, a rookie club, an MVP season.
  const g = (d, team, opp, win, o) => ({ d, gameId: `${d}-${team}`, team, opp, home: true, win, starter: false, min: 20, pts: 10, reb: 4, ast: 3, stl: 1, blk: 0, fgm: 4, fga: 9, fg3m: 1, fg3a: 3, ftm: 1, fta: 2, tov: 1, ...o });
  const pg = {
    tr: [0, 1, 2, 3].map((i) => g(day(i), "PHI", "BOS", false, { pts: 6 })).concat([4, 5, 6].map((i) => g(day(i), "OKC", "BOS", true, { pts: 22 }))),
    ro: [0, 1, 2, 3, 4].map((i) => g(day(i), "CHA", "BOS", true, { starter: true, pts: 24 })).concat([5, 6, 7].map((i) => g(day(i), "CHA", "BOS", false, { pts: 8 }))),
    mv: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => g(day(i), "DEN", "BOS", true, { pts: 30, reb: 13, ast: 11, fga: 18, fta: 6, fgm: 11 })),
  };
  const names = { tr: "Trade Guy", ro: "Role Guy", mv: "Big Man" };
  const tr = S.tradeLines({ pg, names }), ro = S.roleLines({ pg, names });
  const seasons = { keys: ["season", "g", "min", "pts", "reb", "ast", "stl", "blk", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "tov"], players: { "Big Man": [["2023-24", 79, 2700, 2085, 976, 708, 100, 70, 822, 1411, 83, 230, 358, 438, 237]] } };
  const mv = S.mvpLines({ pg, names, seasons, awards: { "NBA Most Valuable Player": [{ season: "2023-24", player: "Big Man" }] }, season: "2026-27" });
  ok(tr.length === 1 && /^Trade Guy this season, OKC \(3 GP, 3-0\): 22\.0 PPG.*3 20-point games · PHI \(4 GP, 0-4\): 6\.0 PPG.*win percentage 100\.0% as a Thunder player, 0\.0% before/.test(tr[0].text) && tr[0].team === "OKC"
    && ro.length === 1 && /^Role Guy as a starter \(5 GP, 5-0\): 24\.0 PPG.*off the bench \(3 GP\): 8\.0 PPG/.test(ro[0].text)
    && mv.length === 1 && /^Big Man this season vs\. his last MVP season \(2023-24\): 30\.0 PPG \(26\.4\)/.test(mv[0].text),
    "season-long (0.70): a player's split by team after a trade (win percentage too), as a starter vs. off the bench, and against his last MVP season", JSON.stringify([...tr, ...ro, ...mv].map((l) => l.text)));
  // Who has beaten the best team (OKC lost 6, to 4 teams; one beat it twice), with tonight's opponent.
  const bt = S.beatenLines({ rows: rows.concat([{ id: "x1", d: day(20), h: "OKC", a: "SAS", hs: 90, as: 100 }, { id: "x2", d: day(21), h: "SAS", a: "OKC", hs: 100, as: 90 }, ...Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, d: day(22 + i), h: "OKC", a: "UTA", hs: 120, as: 100 }))]), slate: [{ away: "SAS", home: "OKC" }] });
  ok(bt.some((l) => l.team === "OKC" && /^Teams with multiple wins vs\. OKC this season: (?:[A-Z]{3}, )*SAS \(/.test(l.text)), "season-long (0.70): the teams with more than one win over a top team", JSON.stringify(bt.map((l) => l.text)));
  const mo = S.monthLines({ rows, today: "2026-11-09" });
  ok(Array.isArray(mo) && mo.every((l) => /in (October|November)/.test(l.text) && /in net rating/.test(l.text)), "season-long (0.70): month ratings from the team box totals (possessions)", JSON.stringify(mo.slice(0, 2).map((l) => l.text)));
  // Last night: a line no one else in the logs has.
  const logs = { columns: ["date", "opp", "home", "result", "type", "min", "pts", "reb", "ast", "stl", "blk", "fg3m", "fgm", "fga", "fg3a", "ftm", "fta"], players: { o1: [["2020-01-01", "BOS", 1, "W", 2, 36, 40, 10, 5, 1, 1, 5, 14, 25, 9, 7, 8]] } };
  const pgU = { u1: [g(day(3), "HOU", "NOP", true, { pts: 36, reb: 13, ast: 7, stl: 3, blk: 3, fg3m: 5 })] };
  const un = S.uniqueLines({ pg: pgU, logs, names: { u1: "Six Cat", o1: "Old Guy" } });
  ok(un.length === 1 && /^Six Cat vs\. NOP \(10\/24\): 36 PTS, 13 REB, 7 AST, 3 STL, 3 BLK, 5 3P\. No other current player has had 35\+ PTS, \d/.test(un[0].text) && un[0].kind === "unique",
    "season-long (0.70): last night's line nobody else had since 2016-17, with the fewest numbers that make it so", JSON.stringify(un.map((l) => l.text)));
}
{
  const { buzzCounts, buzzBoost } = await import("../src/anticipate/buzz.js");
  const { briefing } = await import("../src/anticipate/briefing.js");
  const heads = [{ title: "Jared McCain is thriving in OKC" }, { title: "Why McCain's role keeps growing with the Thunder" }, { title: "Lakers beat Clippers" }, { title: "Los Angeles weather" }, { title: "Jalen Williams out again" },
    { title: "After flight delay, Donovan Mitchell wanted game postponed" }, { title: "Rockets' Sengun shines" }, { title: "Wemby on Draymond Green's shove" }, { title: "Ant's ankle" }, { title: "Heat checks of the young season" }, { title: "an ant farm" }];
  const B = buzzCounts(heads, { players: ["Jared McCain", "Jalen Williams", "Jaylin Williams", "Ajay Mitchell", "Alperen Sengun", "Jalen Green", "Victor Wembanyama", "Anthony Edwards", "Trae Young"], teams: ["OKC", "LAL", "LAC"], league: ["Donovan Mitchell"] });
  ok(B.players["Jared McCain"] === 2 && B.players["Jalen Williams"] === 1 && !B.players["Jaylin Williams"] && !B.players["Ajay Mitchell"] && B.players["Alperen Sengun"] === 1 && !B.players["Jalen Green"] && B.players["Victor Wembanyama"] === 1 && B.players["Anthony Edwards"] === 1 && !B.players["Trae Young"] && B.teams.OKC === 1 && B.teams.LAL === 1 && B.teams.LAC === 1,
    "buzz (0.70): headlines name players (full name, or a surname no one else in the league has, not after another first name; a few nicknames: Wemby, Ant) and teams (a shared city doesn't count)", JSON.stringify(B));
  {
    // 0.106: a run against the franchise's own history.
    const { streakLines, runsBefore, FRANCHISE } = await import("../src/anticipate/prep.js");
    const g = (d, team, pts) => ({ d, team, pts, reb: 0, ast: 0, stl: 0, blk: 0, fg3m: 0, min: 30 });
    const pgF = { 1: [g("2026-11-01", "ORL", 31), g("2026-11-03", "ORL", 33), g("2026-11-05", "ORL", 30)], 2: [g("2026-11-01", "CHI", 31), g("2026-11-03", "CHI", 33), g("2026-11-05", "CHI", 30)], 3: [g("2026-11-01", "MIA", 31), g("2026-11-03", "ORL", 33), g("2026-11-05", "ORL", 30)] };
    const namesF = { 1: "Test Forward", 2: "Test Bull", 3: "Test Traded" };
    const runsF = { runs: [["ORL", "pts30", 14, 10, "2002-03", "x"], ["ORL", "pts30", 5, 11, "1993-94", "x"], ["ORL", "pts30", 4, 12, "2010-11", "x"], ["ORL", "pts30", 4, 10, "2003-04", "x"], ["ORL", "pts30", 3, 13, "2011-12", "x"]], maybe: [], blind: { CHI: ["2016-17"] }, names: { 10: "Player A", 11: "Player B", 12: "Player C", 13: "Player D" } };
    const manyLogs = { columns: ["date", "opp", "home", "result", "type", "pts"], players: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [100 + i, ["2018-11-01", "2018-11-03", "2018-11-05", "2018-11-07"].map((d) => [d, "BOS", 1, "W", 2, 40])])) };
    const F = streakLines({ pg: pgF, logs: manyLogs, names: namesF, runs: runsF, nicks: { ORL: "Magic", CHI: "Bulls" } });
    const one = F.find((l) => l.id === "1");
    const hid = streakLines({ pg: pgF, logs: manyLogs, names: namesF, runs: { ...runsF, maybe: [["ORL", "pts30", 4, 14, "2014-15", "x"]] }, nicks: { ORL: "Magic" } });
    ok(F.length === 1 && /^Test Forward has 30\+ points in 3 straight games: one more tonight would make him the fourth Magic player since 1993-94 to do it 4 straight \(Player A '02-03, Player B '93-94, Player C '10-11\)$/.test(one.text) && one.franchise && !hid.length
      && runsBefore(runsF, "2003-04").runs.length === 2 && FRANCHISE.most === 4,
      "franchise streaks (0.106): a run is placed in his franchise's history since 1993-94 (one name per player, the season of his longest); nothing for a franchise with seasons ESPN has no numbers for (the Bulls), for a run that began with another team, or when a night we could not read might hide a longer run; a past morning sees only earlier seasons", JSON.stringify([F.map((l) => l.text), hid.map((l) => l.text)]));
    const real = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "src", "data", "player-feat-runs-2026-27.json.gz"))));
    const prepSrc = fs.readFileSync(path.join(root, "src", "anticipate", "prep.js"), "utf8");
    const four = new Map(); for (const r of real.runs) if (r[0] === "ORL" && r[1] === "pts30" && r[2] >= 4) four.set(r[3], real.names[r[3]]);
    ok(real.feats.every((k) => prepSrc.includes(`["${k}",`)) && real.feats.length === 12 && real.counts.games > 39000 && real.counts.trusted / real.counts.games > 0.96
      && JSON.stringify(Object.keys(real.blind).sort()) === '["CHI","NOP"]' && real.blind.CHI.length === 6 && [...four.values()].sort().join(", ") === "Dwight Howard, Paolo Banchero, Shaquille O'Neal, Tracy McGrady"
      && real.runs.some((r) => r[0] === "LAL" && r[1] === "pts40" && r[2] === 9 && real.names[r[3]] === "Kobe Bryant") && real.runs.some((r) => r[0] === "OKC" && r[1] === "td" && r[2] === 11) && real.maybe.some((r) => r[0] === "HOU" && r[1] === "pts30" && r[2] === 32),
      "franchise streaks, the real file (0.106): the feats are the morning lines' own; 97% of 39,010 games add up; the Bulls and Pelicans of 2012-13 to 2017-18 are marked blind; the four Magic players with 30+ in four straight are the ones the post of 11/14 implied; McGrady-era and Bryant's 9 straight 40s and Westbrook's 11 straight triple-doubles are there, and Harden's 32 straight 30s is an upper bound (a night in the middle did not add up)", JSON.stringify(real.counts));
  }
  {
    // 0.106.1 (self-audit): the Cup's title games are in neither past-season file nor the runs file.
    const cup = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "cup-finals.json"), "utf8")).games;
    const hist = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-results-history.json"), "utf8"));
    const lg = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "src", "data", "player-logs-history.json.gz"))));
    const fr2 = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "src", "data", "player-feat-runs-2026-27.json.gz"))));
    const days = new Set(cup.map((c) => c[0]));
    const inHist = hist.games.filter((g) => days.has(g[0])).length, inLogs = Object.values(lg.players).flat().filter((r) => days.has(r[0])).length;
    const giannis = fr2.runs.find((r) => r[0] === "MIL" && r[1] === "pts30" && r[4] === "2024-25" && fr2.names[r[3]] === "Giannis Antetokounmpo" && r[2] === 7);
    ok(cup.length === 3 && inHist === 0 && inLogs === 0 && hist.games.length === 12812 && giannis && !fr2.runs.some((r) => days.has(r[5])),
      "Cup title games (0.106.1): Lakers v Pacers 12/9/23, Bucks v Thunder 12/17/24 and Knicks v Spurs 12/16/25 count for nothing: they are out of the results history (12,812 games), the players' logs and the runs file, where Antetokounmpo's 30-point run of 2024-25 is 7 (the title game, 26 points, had cut it into 5 and 2)", JSON.stringify([inHist, inLogs, hist.games.length, !!giannis]));
  }
  {
    // 0.107.1: a turn found from four games in; a kind of game one player has had more often than everyone else together.
    const { turnLines, TURN } = await import("../src/anticipate/seasonlong.js");
    const { findings: find2, MORE } = await import("../src/anticipate/finder.js");
    const day = (i) => `2026-11-${String(i + 1).padStart(2, "0")}`;
    const run = (team, wins) => wins.map((w, i) => ({ id: `${team}${i}`, d: day(i), h: team, a: `Z${team}${i}`, hs: w ? 110 : 100, as: w ? 100 : 110 }));
    const tl = turnLines({ rows: [...run("AAA", [0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0]), ...run("BBB", [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]), ...run("CCC", [0, 0, 0, 1, 1, 1, 0, 1, 1])] });
    const g2 = (pts, reb, ast) => ({ min: 30, pts, reb, ast, stl: 0, blk: 0, fg3m: 0, team: "LAL" });
    const pgM = { 1: [g2(46, 6, 9), g2(47, 4, 7), g2(51, 9, 5), g2(20, 3, 3)], 2: [g2(45, 11, 5), g2(18, 2, 2)], 3: [g2(48, 3, 6), g2(31, 5, 5)], 4: [g2(30, 12, 12), g2(31, 11, 10), g2(22, 10, 10)] };
    for (let k = 10; k < 46; k++) pgM[k] = Array.from({ length: 6 }, () => g2(10, 2, 2)); // the finder says nothing until thirty players qualify
    const fm = find2({ pg: pgM, names: { 1: "One Guy", 2: "Two Guy", 3: "Three Guy", 4: "Four Guy" } }).filter((x) => x.test === "more");
    ok(tl.length === 1 && tl[0].team === "AAA" && tl[0].text === "AAA went 0-4 in its first 4 games; 8-2 since (11/5 on)" && TURN.min === 4
      && fm.length === 1 && fm[0].text === "One Guy has 3 games with 40+ points this season. Every other player combined has 2" && MORE.least === 3,
      "0.107.1: a team's turn is found from four games in (0-4, then 8-2), with a higher bar while a side is short (an even team and a nine-game sample say nothing; with no box totals, no ranks are claimed); the finder names the kind of game one player has had more often than every other player combined (three against two; of the grids with the same lead it says the broadest, here 40+ points), and a two-against-one case is not said",
      JSON.stringify([tl.map((x) => x.text), fm.map((x) => x.text)]));
  }
  {
    // 0.110: the games ESPN's logs lack (Bulls and Pelicans, 2016-17 and 2017-18) come from a file of their own and reach
    // only the readers that may use them.
    const { withFill, EXACT } = await import("../src/situations/logfill.js");
    const { careerHighs: CH } = await import("../src/situations/trends.js");
    const { zeroCareers: ZC } = await import("../src/anticipate/zeros.js");
    const cols = ["date", "opp", "home", "result", "type", "min", "pts", "reb", "ast", "stl", "blk", "fg3m", "fgm", "fga", "fg3a", "ftm", "fta"];
    const row = (d, pts, reb, ast, stl, blk, fg3m, min = 30) => [d, "BOS", 1, "W", 2, min, pts, reb, ast, stl, blk, fg3m, 8, 16, 5, 4, 5];
    const logsT = { columns: cols, players: { 7: [row("2017-11-01", 30, 12, 6, 4, 3, 5), row("2018-11-01", 31, 9, 5, 2, 1, 4)], 8: [row("2019-01-01", 10, 3, 2, 1, 0, 1)] } };
    const fillT = { columns: [...cols, "src"], players: { 7: [[...row("2017-01-10", 44, 11, 2, 2, 0, 9), "p"], [...row("2017-11-01", 99, 99, 99, 9, 9, 9), "p"], [...row("2018-01-10", 0, 0, 3, 0, 0, 0), "p"]], 99: [[...row("2017-02-02", 50, 1, 1, 1, 1, 1), "p"]] } };
    const fullT = withFill(logsT, fillT), seasonsT = { keys: ["season", "g", "pts", "reb", "ast", "hi"], players: { "Fill Man": [["2016-17", 260, 3900, 2000, 1500, 20], ["2017-18", 270, 4800, 2100, 1500, 31]] } };
    const key = (n) => String(n || "").toLowerCase();
    const hA = CH({ logs: logsT, seasons: seasonsT, names: { 7: "Fill Man" }, ids: ["7"], season: "2026-27", nameKey: key })[7], hB = CH({ logs: fullT, seasons: seasonsT, names: { 7: "Fill Man" }, ids: ["7"], season: "2026-27", nameKey: key })[7];
    ok(fullT.players[7].length === 4 && fullT.players[7].map((r) => r[0]).join() === "2017-01-10,2017-11-01,2018-01-10,2018-11-01" && fullT.players[7][1][6] === 30 && !fullT.players[99] && fullT.players[8] === logsT.players[8]
      && logsT.columns.length === 17 && logsT.players[7].length === 2 && fullT.columns[17] === "src" && EXACT.has("pts") && !EXACT.has("reb"),
      "0.110: the filled logs add a game only where the player has none that day (ESPN's row wins), only for players already in the logs, in date order, and leave the logs themselves as they were",
      JSON.stringify(fullT.players[7].map((r) => [r[0], r[6], r[17]])));
    ok(hA.hi.pts === 31 && hB.hi.pts === 44 && hA.hi.fg3m === 5 && hB.hi.fg3m === 9 && hB.hi.reb === 12 && hB.hi.ast === 6 && hB.hi.stl === 4 && hB.hi.blk === 3
      && hA.known.has("reb") && !hB.known.has("reb") && hB.known.has("ast") && !hB.known.has("stl") && hB.known.has("blk") && hB.known.has("pts"),
      "0.110: career highs take points and threes from the filled games (31 becomes 44, 5 threes become 9) and nothing else; a stat stays \"known\" unless a filled game's floor comes close enough to pass his high (11 rebounds against 12: not known; 2 assists against 6: known)",
      JSON.stringify([hB.hi, [...hB.known]]));
    const pgT = { 7: Array.from({ length: 12 }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, team: "AAA", min: 30, pts: 20, reb: 5, ast: 4 })) };
    const zA = ZC({ pg: pgT, logs: logsT, seasons: seasonsT, names: { 7: "Fill Man" }, nameKey: key })[7], zB = ZC({ pg: pgT, logs: fullT, seasons: seasonsT, names: { 7: "Fill Man" }, nameKey: key })[7];
    ok(zA && zB && zA.stats.pts.zeros === 0 && zB.stats.pts.zeros === 1 && zA.stats.reb.zeros === 0 && zB.stats.reb.zeros === 1 && zB.stats.ast.zeros === 0 && zB.logGames === zA.logGames + 2,
      "0.110: a scoreless game ESPN's logs lack now counts, so \"held scoreless for the first time\" is not said of him; a filled game with no rebound counted is treated as one without a rebound (the careful side), and one with assists is not a zero",
      JSON.stringify([zA?.stats, zB?.stats, zA?.logGames, zB?.logGames]));
    // the file itself
    const FL = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "src", "data", "player-logs-fill.json.gz")))), LG = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "src", "data", "player-logs-history.json.gz"))));
    const fx = Object.fromEntries(FL.columns.map((c, i) => [c, i])), all = Object.entries(FL.players).flatMap(([id, rs]) => rs.map((r) => [id, r]));
    const clash = all.filter(([id, r]) => (LG.players[id] || []).some((x) => x[0] === r[fx.date])).length, strangers = Object.keys(FL.players).filter((id) => !LG.players[id]).length;
    ok(all.length >= 1291 && all.every(([, r]) => (r[fx.src] === "p" || r[fx.src] === "n") && r[fx.type] === 2 && r[fx.date] >= "2012-10-01" && r[fx.date] <= "2018-04-30" && r[fx.pts] >= 0 && r[fx.fgm] <= r[fx.fga] && r[fx.fg3m] <= r[fx.fg3a] && r[fx.ftm] <= r[fx.fta]
      && r[fx.pts] === 2 * r[fx.fgm] + r[fx.fg3m] + r[fx.ftm]) && clash === 0 && strangers === 0 && !LG.columns.includes("src"),
      "0.110: src/data/player-logs-fill.json.gz: every row is marked \"p\" (or \"n\", checked against NBA.com, 0.148.0), its points equal its made shots (2 x FGM + 3PM + FTM), no row repeats a game the logs have, every player is in the logs, and the logs file itself has no such rows",
      JSON.stringify([all.length, clash, strangers]));
    const nn = all.filter(([, r]) => r[fx.src] === "n").length;
    ok(nn >= 1280 && nn <= all.length, "0.148.0: the filled lines checked against NBA.com's box scores carry src \"n\" (1,286 of 1,291)", String(nn));
  }
  {
    // 0.115: one player's total against whole teams' totals, by window (the user, 11/19: "wembanyama having more blocks
    // in a month than several teams").
    const { findings: FD, OUTDO } = await import("../src/anticipate/finder.js");
    const pgO = {}, namesO = {};
    const line = (d, team, blk, pts = 10) => ({ d, gameId: `${d}-${team}`, team, opp: "ZZZ", min: 30, pts, reb: 4, ast: 2, stl: 1, blk, fg3m: 1, fgm: 4, ftm: 1, oreb: 1 });
    const nov = ["02", "04", "06", "08", "10", "12"].map((x) => `2026-11-${x}`), oct = ["22", "24", "26", "28"].map((x) => `2026-10-${x}`);
    // six teams of five; the Blocker's team is AAA. In October every team blocks plenty; in November BBB and CCC do not.
    ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"].forEach((t, ti) => { for (let i = 0; i < 5; i++) { const id = `${t}${i}`; namesO[id] = id === "AAA0" ? "The Blocker" : `P ${id}`;
      pgO[id] = [...oct.map((d) => line(d, t, id === "AAA0" ? 2 : 2)), ...nov.map((d) => line(d, t, id === "AAA0" ? 5 : t === "BBB" || t === "CCC" ? 0 + (i === 0 ? 4 : 0) : 2))]; } });
    pgO.FFF0 = pgO.FFF0.filter((g) => g.d < "2026-11-06");                               // a player who left: his team still played
    for (const id of ["DDD0", "DDD1", "DDD2", "DDD3", "DDD4"]) pgO[id] = pgO[id].filter((g) => g.d < "2026-11-05" || g.d.startsWith("2026-10"));   // DDD has played only 2 games in November
    const O = FD({ pg: pgO, names: namesO }).filter((f) => f.test === "outdo");
    const blk = O.filter((f) => /blocks/.test(f.text)), top = O[0];
    ok(top.text === "The Blocker has 30 blocks in November (6 games): more than 3 whole teams (BBB 24 in 6, CCC 24 in 6, DDD 20 in 2)" && top.player === "The Blocker" && OUTDO.teams === 1
      && blk.some((f) => /^P BBB0 has 24 blocks in November \(6 games\): more than all of DDD \(20 in 2\)$/.test(f.text)) && !O.some((f) => /this season/.test(f.text) && /The Blocker/.test(f.text)),
      "0.115.1 (the user: \"no need to put restrictions… It's one player against a whole team\"): a player's total against whole teams' totals, found in the month where it is true and not over the season; a team that has played two games in the window is counted like any other, with its games printed; one team is enough for a line",
      JSON.stringify(O.map((f) => f.text)));
    // 0.115.2: a calendar month is compared once he has played four games in it
    const early = (n) => FD({ pg: Object.fromEntries(Object.entries(pgO).map(([id, gs]) => [id, gs.filter((g) => g.d.startsWith("2026-10") || g.d <= nov[n - 1])])), names: namesO }).filter((f) => f.test === "outdo" && /in November/.test(f.text));
    ok(early(3).length === 0 && early(4).some((f) => /^The Blocker has 20 blocks in November \(4 games\)/.test(f.text)) && OUTDO.month === 4,
      "0.115.2 (the user: \"wait 4 games for the player side\"): no line about a calendar month until the player has four games in it; from his fourth it is compared", JSON.stringify([early(3).map((f) => f.text), early(4).map((f) => f.text)]));
    const ft = FD({ pg: Object.fromEntries(Object.entries(pgO).map(([id, gs]) => [id, gs.map((g) => ({ ...g, ftm: id === "AAA0" ? 14 : 1, fta: id === "AAA0" ? 16 : 2 }))])), names: namesO }).filter((f) => f.test === "outdo" && /free throw/.test(f.text));
    ok(ft.some((f) => /^The Blocker has \d+ free throws /.test(f.text)) && ft.some((f) => /^The Blocker has \d+ free throw attempts /.test(f.text)),
      "0.115.1: free throws made and free throw attempts are compared too", JSON.stringify(ft.map((f) => f.text)));
  }
  {
    // 0.117.0: odd lines. The shape of a line, graded by how often it has happened since 1993-94.
    const { TEMPLATES, matchLine, oddNights, gradeOf, rateOf, posGroup, ODD } = await import("../src/situations/oddlines.js");
    const { LINE_IX: IX } = await import("../src/situations/trends.js");
    const Z = { starter: 1, min: 30, pts: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0 };
    const keys = (l, x) => matchLine({ ...Z, ...l }, x).map((h) => h.key);
    const has = (l, want, x) => { const k = keys(l, x); return want.every((w) => k.includes(w)); };
    // the user's posts, as lines: each is caught by a rule that does not name the player or the exact numbers
    const posts = [
      ["27 points on two baskets, 22-of-25 at the line", { min: 44, pts: 27, fgm: 2, fga: 9, fg3m: 1, fg3a: 5, ftm: 22, fta: 25, reb: 6, ast: 5, blk: 1 }, ["ftshare.2fg", "ftshare.75", "fta.20"]],
      ["48 points with no free throw", { min: 43, pts: 48, fgm: 24, fga: 40, reb: 10, ast: 3, blk: 2 }, ["noft.40", "noft.30"]],
      ["37 points and nothing else", { min: 38, pts: 37, fgm: 16, fga: 20, fg3m: 2, fg3a: 2, ftm: 3, fta: 3, tov: 4, pf: 5 }, ["empty.30", "empty.20near"]],
      ["29 points in 20 minutes with zeros", { min: 20, pts: 29, fgm: 10, fga: 14, fg3m: 9, fg3a: 13 }, ["empty.25", "quick.25in20"]],
      ["14 points on 0-for-10 and 14-of-14", { min: 28, pts: 14, fga: 10, fg3a: 1, ftm: 14, fta: 14, reb: 6, ast: 1, stl: 1 }, ["nofg.12", "ofg.10", "perft.14"]],
      ["a guard with 18 rebounds on 1-for-13", { min: 43, pts: 5, fgm: 1, fga: 13, fg3a: 7, ftm: 3, fta: 4, reb: 18, ast: 4 }, ["greb.18"], { pos: "G" }],
      ["a triple-double with 4 points", { min: 38, pts: 4, fgm: 2, fga: 6, fg3a: 3, reb: 11, ast: 10, stl: 10, blk: 5 }, ["lowpts.td", "lowpts.ra5"]],
      ["one of everything", { min: 9, pts: 1, fga: 1, ftm: 1, fta: 2, reb: 1, ast: 1, stl: 1, blk: 1, tov: 1 }, ["ones.5", "ones.6"]],
      ["17 points in 10 minutes without a basket", { min: 10, pts: 17, fga: 2, ftm: 17, fta: 20 }, ["nofg.12", "quick.15in10", "ftshare.75"]],
      ["a turnover in 0 minutes", { min: 0, tov: 1 }, ["zeromin.1"]],
      ["0-for-13 with 0-for-8 from three", { min: 42, pts: 2, fga: 13, fg3a: 8, ftm: 2, fta: 2 }, ["ofg.12", "o3.8"]],
    ];
    const missed = posts.filter(([, l, want, x]) => !has(l, want, x)).map(([n, l, , x]) => `${n}: ${keys(l, x).join(",")}`);
    ok(!missed.length && keys({ min: 32, pts: 20, fgm: 8, fga: 16, fg3m: 2, fg3a: 5, ftm: 2, fta: 2, reb: 5, ast: 4, stl: 1, tov: 2, pf: 2 }).length === 0 && !keys({ min: 43, pts: 5, fgm: 1, fga: 13, reb: 18 }, { pos: "F" }).includes("greb.18"),
      "0.117.0 (the user: \"these are concepts worth tracking and flagging\"): each of the posted odd lines is caught by a rule about its shape; an ordinary line is not; a position rule needs the position", missed.join(" | "));
    ok(!keys({ min: 30, pts: 6, fgm: 2, fga: 12 }).some((k) => /^dud|^erupt/.test(k)) && has({ min: 30, pts: 6, fgm: 2, fga: 12 }, ["dud.25", "dud.half"], { avg: { pts: 26, reb: 5, ast: 5 } })
      && has({ min: 30, pts: 31, fgm: 12, fga: 18, ftm: 7, fta: 8, reb: 3 }, ["erupt.u8", "erupt.3x"], { avg: { pts: 5.5, reb: 3, ast: 1 } }) && posGroup("PG") === "G" && posGroup("C") === "C" && posGroup("") === null,
      "0.117.0: far-from-his-average rules need an average (10 other games) and say nothing without one");
    // counting: history plus this season's earlier nights; same-night lines do not count each other; the rarest level is the one said
    const v = (side, l) => { const a = []; a[IX.side] = side; for (const [k, i] of Object.entries(IX)) if (i >= 1) a[i] = ({ ...Z, ...l })[k]; return a; };
    const day = (i) => `2026-11-${String(i).padStart(2, "0")}`;
    const rowsO = [];
    for (let i = 1; i <= 11; i++) rowsO.push({ id: `g${i}`, d: day(i), h: "AAA", a: "BBB", hs: 100, as: 90, pl: { A: v(0, { pts: 26, fgm: 10, fga: 20, ftm: 6, fta: 6, reb: 5, ast: 5 }), C: v(1, { pts: 10, fgm: 4, fga: 9, ftm: 2, fta: 2, reb: 3 }) } });
    rowsO.push({ id: "g12", d: day(12), h: "AAA", a: "BBB", hs: 100, as: 90, pl: { A: v(0, { pts: 6, fgm: 2, fga: 12, ftm: 2, fta: 2, reb: 5, ast: 5 }), C: v(1, { fga: 10, reb: 3 }), D: v(1, { fga: 11, reb: 2 }), B: v(0, { pts: 12, fgm: 5, fga: 9, ftm: 2, fta: 2, reb: 9, ast: 13 }) } });
    rowsO.push({ id: "g13", d: day(13), h: "BBB", a: "AAA", hs: 100, as: 90, pl: { C: v(0, { fga: 10, reb: 3 }) } });
    const histO = { from: "1993-94", t: { "ofg.8": { n: 752, l5: 133 }, "ofg.10": { n: 5, l5: 2, last: [["Old Guy", "2024-01-01", "XXX", "0-for-11 from the field"]] }, "dud.25": { n: 117, l5: 35 }, "dud.half": { n: 546, l5: 166 }, "cast.12": { n: 150, l5: 98 }, "brick.15": { n: 1464, l5: 207 } } };
    const NO = oddNights({ rows: rowsO, history: histO, names: { A: "Star One", B: "Big Two", C: "Cold Three", D: "Dry Four" }, pos: { B: "C" }, dates: [day(12), day(13)], IX });
    const n12 = NO[day(12)], cold = n12.find((o) => o.name === "Cold Three"), dry = n12.find((o) => o.name === "Dry Four"), star = n12.find((o) => o.name === "Star One"), big = n12.find((o) => o.name === "Big Two"), next = NO[day(13)][0];
    ok(cold?.hits[0].key === "ofg.10" && cold.grade === "rare" && cold.hits[0].before === 5 && cold.hits[0].note === "No field goal on 10+ attempts: the 6th on file since 1993-94 (last: Old Guy, 1/1/24, 0-for-11 from the field)."
      && dry?.hits[0].before === 5 && n12[0].grade === "rare" && n12[n12.length - 1].grade === "common"
      && next?.hits[0].before === 7 && /\(last: (Cold Three|Dry Four), 11\/12\/26/.test(next.hits[0].note),
      "0.117.0: an odd line is counted against the history plus this season's earlier nights (two on one night do not count each other), the rarest level it passes is the one said, and the night is ordered rarest first",
      JSON.stringify([cold?.hits, dry?.hits, next?.hits, n12.map((o) => o.grade)]));
    ok(star?.hits.some((h) => h.key === "dud.25" && h.grade === "monthly" && /^6 points in 30 minutes \(averages 26\.0; 2-for-12\)$/.test(h.say) && /about 7 a season over the last five seasons/.test(h.note))
      && big?.hits[0].key === "cast.12" && big.grade === "common" && big.hits[0].say === "13 assists by a center" && !NO[day(12)].some((o) => o.hits.some((h) => h.key === "dud.half")),
      "0.117.0: a star's dud is measured against his other games this season; a common line is still listed, graded common (nothing is cut for being common)", JSON.stringify([star?.hits, big?.hits]));
    ok(gradeOf(1) === "rare" && gradeOf(1.2) === "few" && gradeOf(5) === "few" && gradeOf(15) === "monthly" && gradeOf(15.2) === "common" && rateOf({ l5: 23 }) === 4.6 && ODD.games === 10,
      "0.117.0: grades are per season over the last five seasons: at most 1 rare, at most 5 a few a season, at most 15 monthly, more common");
    // the committed table: built with these rules, and it holds the study's numbers
    const HT = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "odd-lines-history.json"), "utf8")), all = TEMPLATES.flatMap((t) => t.levels.map((l) => `${t.id}.${l.k}`));
    ok(HT.games === 38949 && HT.seasons === 33 && all.length === new Set(all).size && all.every((k) => HT.t[k]) && Object.keys(HT.t).length === all.length
      && HT.t["noft.40"].n === 9 && HT.t["noft.30"].n === 323 && HT.t["ofg.10"].n === 148 && HT.t["lowpts.td"].n === 1 && /Draymond Green/.test(HT.t["lowpts.td"].last[0][0]) && HT.t["ones.6"].last.some((x) => x[0] === "Pervis Ellison")
      && HT.t["pair.3oreb8"].n === 0 && HT.t["nothing.20"].n === 0 && Object.values(HT.t).every((e) => e.l5 <= e.n && e.era.reduce((a, b) => a + b, 0) === e.n && e.last.length <= 3),
      "0.117.0 (0.149.0: every regular-season game since 1993-94, 38,949): the history table has every level of every template, and holds the study's counts (40 points without a free throw 9 times; a triple-double under 10 points once)");
    const pageT = fs.readFileSync(path.join(root, "docs", "trends.html"), "utf8"), sitJs = fs.readFileSync(path.join(root, "scripts", "situations.js"), "utf8");
    ok(/id="oddlines"/.test(pageT) && /function renderOdd\(\)/.test(pageT) && /On file/.test(pageT) && /odd: oddByDate/.test(sitJs) && /rows\.filter\(\(g\) => !g\.cupFinal\)/.test(sitJs),
      "0.117.0: the Streaks & outliers page lists the odd lines with what \"on file\" leaves out; the build writes them beside the outliers, without the Cup's title game");
  }
  {
    // 0.118.0: tonight's watch lists (runs and repeats a game short; habits), and starters only where ESPN lists five.
    const { oddNights, oddWatch, runLengths, RUNS, RUN_MIN, RUN_MAX, OWN } = await import("../src/situations/oddlines.js");
    const { LINE_IX: IX } = await import("../src/situations/trends.js");
    const Z = { starter: 1, min: 30, pts: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0 };
    const v = (side, l) => { const a = []; a[IX.side] = side; for (const [k, i] of Object.entries(IX)) if (i >= 1) a[i] = ({ ...Z, ...l })[k]; return a; };
    const day = (i) => `2026-11-${String(i).padStart(2, "0")}`;
    // a run is counted over games of 20+ minutes: a short game neither extends nor breaks it; a normal game ends it
    const avg = { pts: 24, reb: 5, ast: 5 }, G = (pts, min = 30) => ({ l: { ...Z, pts, min, fgm: Math.floor(pts / 2), fga: 16 }, x: { pos: null, avg }, d: "x" });
    const RL = runLengths([G(26), G(8), G(10, 12), G(9), G(30), G(7)]);
    ok(JSON.stringify(RL.runs.half) === "[1,2,1]" && RL.now.runs.half === 1 && RUN_MIN === 20 && RUNS.some((r) => r.id === "st0") && RUN_MAX === 6,
      "0.118.0: a run of bad nights is counted over his games of 20+ minutes (a 12-minute game neither extends nor breaks it) and ends with a normal game", JSON.stringify(RL.runs));
    // tonight: Star is two games into "under half his average"; Big is coming off 13 assists as a center; Idle's team is not playing
    const rowsW = [];
    const others = (i) => Object.fromEntries(["a", "b", "c", "d"].map((x) => [`H${x}`, v(0, { pts: 10, fgm: 4, fga: 9, reb: 4, starter: 1 })]).concat(["a", "b", "c", "d"].map((x) => [`V${x}`, v(1, { pts: 10, fgm: 4, fga: 9, reb: 4, starter: 1 })])));
    for (let i = 1; i <= 13; i++) rowsW.push({ id: `w${i}`, d: day(i), h: "AAA", a: "BBB", hs: 100, as: 90, pl: { ...others(i),
      S: v(0, i >= 12 ? { pts: 8, fgm: 3, fga: 14 } : { pts: 26, fgm: 10, fga: 20 }), B: v(1, i === 13 ? { pts: 12, fgm: 5, fga: 9, ast: 13 } : { pts: 12, fgm: 5, fga: 9, ast: 4 }), I: v(1, { pts: 5, fgm: 2, fga: 5, starter: 0 }) } });
    const histW = { from: "1993-94", runMin: 20, t: { "cast.12": { what: "a center with 12+ assists", n: 150, l5: 98 }, "ast3x.1": { what: "12+ assists at three times his average", n: 469, l5: 94 } },
      runs: { half: { 2: { n: 198, l5: 45, last: ["A", "2026-04-03"] }, 3: { n: 21, l5: 6, last: ["Desmond Bane", "2025-11-04"] } }, seventy: {}, st0: {}, cold: {} },
      again: { "cast.12": { 2: { n: 20, l5: 14, last: ["Nikola Jokic", "2026-04-06"] } } } };
    const playersW = { since: "2023-24", league: { "cast.12": 98 }, p: { B: { g: 200, k: { "cast.12": [3, "2026-01-05"] } } } };
    const W = oddWatch({ rows: rowsW, history: histW, players: playersW, names: { S: "Star One", B: "Big Two", I: "Idle Three" }, pos: { B: "C" }, teams: new Set(["AAA", "BBB"]), vs: { AAA: "vs BBB", BBB: "@ AAA" }, IX,
      teamNow: (id, t) => (id === "I" ? "CCC" : t) });
    const run = W.runs.find((r) => r.kind === "run" && r.key === "half" && r.name === "Star One"), rep = W.runs.find((r) => r.kind === "again" && r.key === "cast.12"), own = W.owners.find((o) => o.key === "cast.12");
    ok(run?.length === 2 && run.n === 21 && run.grade === "few" && /^Star One has been under half his scoring average in 2 straight games of 20\+ minutes \(8 points on 3-for-14 on 11\/13\/26; averages 24\.5\)\. A third straight for a 20-point scorer under half his average has happened 21 times on file since 1993-94 \(last: Desmond Bane, 11\/4\/25\)\.$/.test(run.text)
      && rep?.length === 1 && rep.n === 20 && /^Big Two: 13 assists by a center on 11\/13\/26\. A center with 12\+ assists in 2 straight games has happened 20 times on file since 1993-94 \(last: Nikola Jokic, 4\/6\/26\)\.$/.test(rep.text)
      && own?.n === 4 && own.season === 1 && own.league === 99 && /^Big Two: a center with 12\+ assists, 4 times in 213 games since 2023-24 \(1 this season\); the league has 99\. Last: 11\/13\/26\.$/.test(own.text)
      && !W.runs.concat(W.owners).some((x) => x.name === "Idle Three") && OWN.min === 2,
      "0.118.0 (the user: \"keep going\"): tonight's list names who is a game short of a run or a repeat, with how often the next step has happened, and who has a habit (twice or more); a player whose team is not playing is left out",
      JSON.stringify([run?.text, rep?.text, own?.text]));
    // starters: a side with no starters marked says nothing about "off the bench"
    const big = { pts: 41, fgm: 15, fga: 25, ftm: 11, fta: 12, reb: 5, ast: 5 };
    const noStart = { id: "n1", d: day(20), h: "AAA", a: "BBB", hs: 100, as: 90, pl: { X: v(0, { ...big, starter: 0 }), ...Object.fromEntries(["a", "b", "c", "d", "e"].map((x) => [`V${x}`, v(1, { pts: 10, fgm: 4, fga: 9, reb: 4, starter: 1 })])), Y: v(1, { ...big, starter: 0 }) } };
    const NS = oddNights({ rows: [noStart], history: { t: { "bench.40": { what: "40+ points off the bench", n: 37, l5: 8 } } }, names: { X: "No Flags", Y: "Sixth Man" }, dates: [day(20)], IX })[day(20)];
    ok(NS.some((o) => o.name === "Sixth Man" && o.hits.some((h) => h.key === "bench.40")) && !NS.some((o) => o.name === "No Flags"),
      "0.118.0: \"off the bench\" is said only when that side's box score marks five starters (ESPN marks none for 482 old team-games, which had counted Dwyane Wade's 40 on 3/8/06 as a reserve's)", JSON.stringify(NS.map((o) => [o.name, o.hits.map((h) => h.key)])));
    const HT = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "odd-lines-history.json"), "utf8")), PT = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "odd-lines-players.json"), "utf8"));
    ok(HT.t["bench.40"].n === 37 && HT.t["bench.35"].n === 147 && HT.noStarters === 589 && HT.runs.half[3].n === 23 && HT.runs.st0[3].n === 7 && HT.runs.seventy[5].n === 5 && HT.runs.cold[4].n === 10 && HT.again["cast.12"][2].n === 20 && !HT.again["zeromin.1"]
      && PT.since === "2023-24" && Object.keys(PT.p).length > 300 && Object.values(PT.p).every((e) => e.g > 0 && Object.values(e.k).every(([n, d]) => n >= 1 && /^\d{4}-\d\d-\d\d$/.test(d))),
      "0.118.0: the history holds how often each run reached each length (under half his average three straight: 21 times) and each repeat; 40 points off the bench is 37 on file, not 55; the players' table covers 2023-24 on");
    const pageT = fs.readFileSync(path.join(root, "docs", "trends.html"), "utf8");
    ok(/id="oddruns"/.test(pageT) && /function renderOddWatch\(\)/.test(pageT) && /Injuries are not checked here/.test(pageT), "0.118.0: the page shows tonight's list under the odd lines and says injuries are not checked");
  }
  {
    // 0.120.0: shifts. A player's season in one stat cut where his numbers changed; the current stretch against the one before.
    const { playerShifts, allShifts, rateStretches, countStretches, chanceOdds, chanceCounts, pairsSearched, SHIFT, SHIFT_STATS, CHANCE_LEVELS } = await import("../src/situations/shifts.js");
    const day = (i) => `2026-11-${String(i + 1).padStart(2, "0")}`;
    const G = (i, o) => ({ d: day(i), team: "AAA", min: 30, pts: 16, fgm: 6, fga: 13, fg3m: 2, fg3a: 5, ftm: 2, fta: 2, reb: 5, ast: 4, stl: 1, blk: 0, tov: 2, ...o });
    // a three-point slump: 4-for-8 a night for eight games, then 1-for-9 a night for five; everything else level
    const slump = Array.from({ length: 13 }, (_, i) => G(i, i < 8 ? { fg3m: 4, fg3a: 8, fgm: 6, fga: 13 } : { fg3m: 1, fg3a: 9, fgm: 6, fga: 13 }));
    const S1 = playerShifts(slump, "Cold Shooter", { id: "c1" }), three = S1.find((s) => s.k === "fg3");
    ok(JSON.stringify(rateStretches(slump.map((g) => g.fg3m), slump.map((g) => g.fg3a), { need: 12 })) === "[[0,8],[8,13]]"
      && three && three.up === false && three.good === false && three.now.n === 5 && three.now.made === 5 && three.now.att === 45 && three.was.n === 8 && three.was.made === 32 && three.was.att === 64 && three.was.all === false
      && three.text === "Cold Shooter is shooting 11.1% from three over his last 5 games (5-for-45, since 11/9), down from 50.0% over the 8 games before (32-for-64)"
      && three.odds === SHIFT.shuffles + 1 && three.role === false && !S1.some((s) => s.k === "pts" || s.k === "reb" || s.k === "min"),
      "0.120.0 (the user: \"Do you tracking shooting slumps or hot shooting stretches?\"): a three-point slump is found where it starts, whatever its length, and said against the stretch before; stats that did not move say nothing",
      JSON.stringify(S1.map((s) => [s.k, s.text, s.odds])));
    // a counting stat with his minutes: points and minutes drop together -> flagged as a possible role change
    const role = Array.from({ length: 12 }, (_, i) => G(i, i < 7 ? { pts: 20 + (i % 2), min: 32 } : { pts: 7 + (i % 2), min: 17 }));
    const S2 = playerShifts(role, "Role Player", { id: "r1" }), pts = S2.find((s) => s.k === "pts"), mins = S2.find((s) => s.k === "min");
    ok(JSON.stringify(countStretches(role.map((g) => g.pts))) === "[[0,7],[7,12]]" && pts?.role === true && pts.up === false && /^Role Player is averaging 7\.6 points over his last 5 games \(since 11\/8\), down from 20\.4 over the 7 games before$/.test(pts.text)
      && mins && mins.role === false && Math.round(pts.now.min) === 17 && Math.round(pts.was.min) === 32,
      "0.120.0: a counting stat is cut game by game, and a change that came with his minutes moving a quarter or more is marked as a possible role change", JSON.stringify([pts?.text, pts?.role, mins?.text]));
    // turnovers going down is good; the user's rule for teams: a short early stretch is not a fair comparison for a long one
    const tovs = Array.from({ length: 12 }, (_, i) => G(i, { tov: i < 6 ? 5 : 1 })), tv = playerShifts(tovs, "Careful", { odds: false }).find((s) => s.k === "tov");
    const longNow = Array.from({ length: 18 }, (_, i) => G(i, { ast: i < 3 ? 12 : 3 + (i % 2), fga: 13 })), la = playerShifts(longNow, "Passer", { odds: false }).find((s) => s.k === "ast");
    ok(tv && tv.up === false && tv.good === true && la && la.was.all === true && /over his first 3 games$/.test(la.text) && SHIFT.ratio === 4 && SHIFT.min === 3,
      "0.120.0: fewer turnovers is the good direction; a current stretch more than four times as long as the one before is set against everything before it and says so", JSON.stringify([tv?.good, la?.text]));
    // by chance: the same games in random orders. A clean break is never matched; noise usually is. The same input gives the same odds.
    let sd = 5; const rnd = (n) => { sd = (sd * 1103515245 + 12345) % 2147483648; return sd % n; };
    const noisy = Array.from({ length: 16 }, (_, i) => { const a = 4 + rnd(6), m = rnd(a + 1) >> 1; return G(i, { fg3m: m, fg3a: a, pts: 8 + rnd(20), reb: 2 + rnd(8), ast: 1 + rnd(7) }); });
    const N1 = playerShifts(noisy, "Noisy", { id: "n1" }), N2 = playerShifts(noisy, "Noisy", { id: "n1" });
    const st3 = SHIFT_STATS.find((t) => t.k === "fg3");
    ok(JSON.stringify(N1) === JSON.stringify(N2) && N1.every((s) => s.odds >= 1 && s.odds <= SHIFT.shuffles + 1) && N1.filter((s) => s.odds > 50).length <= 2 && chanceOdds(st3, slump, three.z, { seed: 9 }) >= 100
      && JSON.stringify(N1.map((s) => s.odds)) === JSON.stringify([...N1.map((s) => s.odds)].sort((a, b) => b - a)),
      "0.120.0: every shift carries how often a random order of the same games shows as much; the same games give the same odds on every build; rows are ranked by those odds", JSON.stringify(N1.map((s) => [s.k, s.z, s.odds])));
    const pgS = { c1: slump, r1: role, n1: noisy, few: slump.slice(0, 5) }, A = allShifts(pgS, { c1: "Cold Shooter", r1: "Role Player", n1: "Noisy" }, (id, t) => (id === "r1" ? "BBB" : t));
    const CC = chanceCounts(pgS, { passes: 1, shuffles: 30 });
    ok(pairsSearched(pgS) === 3 * SHIFT_STATS.length && A[0].odds === SHIFT.shuffles + 1 && A.find((s) => s.id === "r1").team === "BBB" && !A.some((s) => s.id === "few") && A.every((s) => s.name && s.last && s.games >= SHIFT.games)
      && Object.keys(CC).length === SHIFT_STATS.length && CHANCE_LEVELS.every((n) => CC.fg3[n] >= 0 && CC.fg3[n] <= 3) && CC.pts[50] <= CC.pts[5],
      "0.120.0: the league list leaves out players with under eight games, uses his team today, and comes with what the same search finds when every player's games are shuffled", JSON.stringify([A.length, CC.fg3, CC.pts]));
    const srcS = fs.readFileSync(path.join(root, "src", "situations", "shifts.js"), "utf8"), pageT = fs.readFileSync(path.join(root, "docs", "trends.html"), "utf8"), sitJs = fs.readFileSync(path.join(root, "scripts", "situations.js"), "utf8");
    ok(!/^\s*import\b|from "/m.test(srcS) && /id="htab"/.test(pageT) && /function renderShifts\(\)/.test(pageT) && /shuffled into random order/.test(pageT) && /what has happened, not as what comes next/.test(pageT)
      && /shifts\.json/.test(sitJs) && /chance: chanceCounts\(pg\)/.test(sitJs) && /trends\.html#shifts/.test(fs.readFileSync(path.join(root, "docs", "find.html"), "utf8")),
      "0.120.0: the Streaks & outliers page has the Shifts table with the count a shuffled league would show beside the real one, and the Index lists it");
  }
  {
    // 0.122.0: the Bulls' and Pelicans' games as whole lines (the user's five box scores matched pbpstats in every column, 102 players),
    // without turnovers and fouls except where a box score has been read; and the strongest shifts as Watch List lines (0.121.0).
    const M = await import("../src/situations/oddlines.js"), { shiftStoryLines, STORY, SHIFT } = await import("../src/situations/shifts.js");
    let sd = 3; const rnd = (n) => { sd = (sd * 1103515245 + 12345) % 2147483648; return sd % n; };
    let leak = null;
    for (let i = 0; i < 3000 && !leak; i++) {
      const fga = rnd(26), fgm = rnd(fga + 1), fg3a = rnd(fga + 1), fg3m = Math.min(fgm, rnd(fg3a + 1)), fta = rnd(24), ftm = rnd(fta + 1), oreb = rnd(8), dreb = rnd(14);
      const l = { pts: 2 * fgm + fg3m + ftm, fgm, fga, fg3m, fg3a, ftm, fta, min: rnd(48), starter: rnd(2), oreb, dreb, reb: oreb + dreb, ast: rnd(16), stl: rnd(7), blk: rnd(7) };
      const x = { pos: ["G", "F", "C", null][rnd(4)], avg: rnd(2) ? null : { pts: rnd(30), reb: rnd(10), ast: rnd(9) } };
      const free = (tov, pf) => M.matchLine({ ...l, tov, pf }, x).filter((h) => !M.TOV_PF.includes(h.id) && !M.TOV_PF.includes(h.key)).map((h) => h.key).join(",");
      if (free(0, 0) !== free(rnd(12), rnd(7))) leak = JSON.stringify(l);
    }
    const HT = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "odd-lines-history.json"), "utf8")), ids = M.TEMPLATES.map((t) => t.id);
    const filledKeys = Object.entries(HT.t).filter(([, e]) => e.filled > 0).map(([k]) => k);
    const B = JSON.parse(fs.readFileSync(path.join(root, "tools", "outside", "bref-screens", "box-2026-11-19.json"), "utf8"));
    const adds = B.games.every((g) => { const rows = Object.values(g.p); return [["away", rows.slice(0, g.awayPlayers)], ["home", rows.slice(g.awayPlayers)]].every(([side, rs]) => g.totals[side].every((t, i) => rs.reduce((a, r) => a + r[i + 1], 0) + (i === 12 ? g.teamTurnovers[side] : 0) === t)); });
    ok(!leak && M.NO_TOV_PF.every((id) => M.TOV_PF.includes(id)) && M.TOV_PF.filter((k) => !k.includes(".")).every((id) => ids.includes(id))
      // 0.149.0: the games ESPN can't give are in the archive itself from NBA.com's box score (every column), so nothing is set aside
      && HT.fill?.games === 1134 && /NBA\.com/.test(HT.fill.source) && HT.fill.unnamed <= 20 && HT.fill.notCounted.length === 0 && HT.games === 38949 && HT.allStar === 43 && filledKeys.length === 0
      && HT.t["ofg.10"].n === 148 && HT.t["noft.30"].n === 323 && HT.t["ones.5"].n === 8 && HT.t["ones.6"].n === 2 && HT.t["ones.6"].last[0][0] === "C.J. Watson" && HT.t["ones.6"].last[0][1] === "2013-04-04"
      && HT.t["x5.5"].n === 14 && HT.t["empty.20"].n === 39 && HT.t["blk0reb.5"].n === 5 && B.games.length === 5 && Object.values(B.games).reduce((a, g) => a + Object.keys(g.p).length, 0) === 102 && adds,
      "0.122.0 (the user's five box scores, 11/19): the 971 filled games count as whole lines for every rule that does not need a turnover or a foul (3,000 random lines: turnovers and fouls never change any other rule), every player named to his ESPN id; C.J. Watson's one of everything, turnover included, is the second on file; the five box scores as read add up to their team totals",
      String(leak || JSON.stringify([HT.fill, HT.t["ones.6"].last[0], adds])));
    const S = (o) => ({ id: "p1", name: "P One", team: "AAA", k: "pts", kind: "count", z: -3, odds: 40, role: false, now: { min: 30 }, text: "P One is averaging 8.0 points over his last 5 games (since 11/8), down from 19.0 over the 7 games before", ...o });
    const L = shiftStoryLines([
      S({}), S({ k: "fg3", kind: "rate", odds: 67, text: "P One is shooting 17.6% from three over his last 6 games (6-for-34, since 11/6), down from 42.6% over the 8 games before (29-for-68)" }),   // his shooting line has a place of its own
      S({ id: "p2", name: "P Two", k: "min", odds: 201, text: "P Two is averaging 31.7 minutes over his last 3 games (since 11/14), up from 21.4 over the 8 games before" }),
      S({ id: "p3", name: "P Three", odds: 101 }), S({ id: "p4", name: "P Four", odds: 90 }),                                 // a third "other" line for AAA: over the cap
      S({ id: "p5", name: "Role Change", odds: 150, role: true }), S({ id: "p6", name: "Bench Guy", odds: 150, now: { min: 9 } }), S({ id: "p7", name: "Weak", odds: 12 }), S({ id: "p8", name: "Other Team", team: "ZZZ", odds: 201 }),
    ], new Set(["AAA"]));
    const by = Object.fromEntries(L.map((l) => [l.player, l]));
    ok(L.length === 3 && by["P Two"]?.score === STORY.top && by["P Two"].text.endsWith("(by chance: under 1 in 200)") && by["P Three"] && !by["P Four"] && !by["Role Change"] && !by["Bench Guy"] && !by["Weak"] && !by["Other Team"]
      && by["P One"]?.key === "shift|p1|fg3" && by["P One"].text.endsWith("(29-for-68) (by chance: 1 in 67)") && by["P One"].score > STORY.base + STORY.shootBonus && L.every((l) => l.kind === "shift" && l.team === "AAA")
      && /"find", "shift"\]\)/.test(fs.readFileSync(path.join(root, "src", "anticipate", "tonight.js"), "utf8")) && /shift: \["📊", "trends\.html#shifts"\]/.test(fs.readFileSync(path.join(root, "docs", "index.html"), "utf8"))
      && /shiftStoryLines\(shiftAll/.test(fs.readFileSync(path.join(root, "scripts", "situations.js"), "utf8")),
      "0.121.0 (the user: \"are the most significant ones posted in the watch list?\"): the strongest shifts on tonight's teams become Watch List lines: one a player, a shooting line and two others a team at most, rotation players only, 1 in 20 or rarer, a stat that moved with his minutes left out",
      JSON.stringify(L.map((l) => [l.player, l.score, l.key])));
  }
  {
    // 0.108.0: brothers. Their last N games reading alike, and a big night on the same date.
    const { brotherLines, BRO } = await import("../src/anticipate/seasonlong.js");
    const day = (i) => `2026-11-${String(i + 1).padStart(2, "0")}`;
    const log = (team, lines) => lines.map(([pts, reb, ast], i) => ({ d: day(i), team, min: 30, pts, reb, ast, fgm: 6, fga: 12, fg3m: 2, fg3a: 5, ftm: 3, fta: 4 }));
    const pgB = { 1: log("AAA", [[30, 2, 2], [5, 1, 1], [16, 3, 6], [17, 2, 5], [15, 4, 6], [16, 3, 6]]), 2: log("BBB", [[2, 9, 0], [28, 8, 1], [17, 2, 5], [15, 3, 7], [18, 3, 5], [16, 4, 6]]),      // alike over their last four
      3: log("CCC", [[10, 5, 2], [12, 5, 2], [11, 5, 2], [24, 5, 2]]), 4: log("DDD", [[30, 9, 9], [31, 9, 9], [29, 9, 9], [27, 9, 9]]),                                                      // nothing alike, but 24 and 27 on the same night
      5: log("EEE", [[10, 5, 2], [12, 5, 2], [11, 5, 2]]), 6: log("FFF", [[25, 9, 9], [26, 9, 9], [24, 9, 9]]) };                                                                            // nothing
    const BL = brotherLines({ pg: pgB, names: { 1: "Al One", 2: "Bo One", 3: "Cy Two", 4: "Di Two", 5: "Ed Three", 6: "Fa Three" }, today: "2026-11-05",
      brothers: { pairs: [{ ids: [1, 2] }, { ids: [3, 4], twins: true }, { ids: [5, 6] }] } }).map((l) => l.text);
    ok(BL.length === 3 && BL.includes("Al One and his brother Bo One each scored 16 on 11/6") && BL.includes("Over their last 4 games: Al One 16.0 PPG, 3.0 RPG, 5.8 APG, 50/40/75; his brother Bo One 16.5 PPG, 3.0 RPG, 5.8 APG, 50/40/75")
      && BL.includes("Cy Two (24) and his twin Di Two (27) each scored 20+ on 11/4, the first night this season they both have") && BRO.pts === 2,
      "0.108.0: brothers (the pairs in src/data/brothers.json): their last N games side by side when they read alike, for whichever N fits best (16.0 and 16.5 points over four, not over six), a night they both scored 20, and a night they scored the same number (12 or more); a pair with nothing in common says nothing",
      JSON.stringify(BL));
  }
  {
    // 0.108.0: searches, not detectors: clubs of very few, a total set against minutes, ranks inside a group.
    const { findings: f8, CLUB, RATE, GROUP } = await import("../src/anticipate/finder.js");
    const pgN = {}, namesN = {}; let n = 0;
    const add = (name, per, o = {}) => { const id = String(++n); namesN[id] = name; pgN[id] = Array.from({ length: 10 }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, team: `T${n % 30}`, opp: "ZZZ", starter: o.bench ? 0 : 1, min: o.min ?? 30, pts: 12, reb: 4, ast: 3, stl: 1, blk: 0, fg3m: 1, fgm: 5, ftm: 1, pm: 0, ...per })); return id; };
    for (let i = 0; i < 30; i++) add(`Filler ${i}`, { pts: 10 + (i % 7), reb: 3 + (i % 4), ast: 2 + (i % 3) }, { bench: i >= 8 });
    for (let i = 0; i < 5; i++) { add(`Scorer ${i}`, { pts: 32 }); add(`Boarder ${i}`, { reb: 13 }); add(`Passer ${i}`, { ast: 10 }); add(`Blocker ${i}`, { blk: 3 }); }
    add("All Around", { pts: 30, reb: 12, ast: 9, blk: 2 });                      // nobody else clears all four of his bars; each bar alone is cleared by several
    add("Quick Hands", { stl: 4, pts: 6 }, { min: 12, bench: true });             // first in steals, last in minutes
    add("Sixth Man", { pts: 20, ast: 6, fg3m: 4, pm: 8 }, { bench: true });       // leads the bench in points, assists, threes and plus/minus
    const F8 = f8({ pg: pgN, names: namesN }), of = (t) => F8.filter((x) => x.test === t).map((x) => x.text);
    ok(of("club").some((t) => /^Players this season with 300 points, 100 rebounds, 75 assists and 20 blocks: All Around\. Nobody else$/.test(t)) && !of("club").some((t) => /Scorer|Boarder|Passer|Blocker|Filler/.test(t))
      && of("rate").some((t) => /^Quick Hands has the most steals in the NBA this season\. He ranks \d+(st|nd|rd|th) in minutes played$/.test(t))
      && of("group").some((t) => /^Sixth Man off the bench this season \(10 games as a reserve\): 1st in points, .*1st in assists.*1st in threes, 1st in plus\/minus$/.test(t))
      && CLUB.most === 3 && RATE.ratio === 2.5 && GROUP.need === 3,
      "0.108.0: the finder searches every set of two to four season totals for a club of at most three (round bars taken from the candidate's own numbers, each cleared alone by several players, together by one), sets every total against minutes played (first in steals, near last in minutes), and ranks players inside a group (the bench: first in points, assists, threes and plus/minus); none of the names, stats or bars is given to it",
      JSON.stringify({ club: of("club"), rate: of("rate"), group: of("group") }));
    // 0.132.0: a rank he shares says so ("tied for 4th"), as the Jrue Holiday line should have on 11/20.
    add("Even Keel", { pm: 8 }, { bench: true });
    const G2 = f8({ pg: pgN, names: namesN }).filter((x) => x.test === "group").map((x) => x.text), six = G2.find((t) => /^Sixth Man/.test(t)) || "";
    ok(/1st in points/.test(six) && !/tied for 1st in points/.test(six) && /tied for 1st in plus\/minus$/.test(six),
      "0.132.0: a group rank shared with another player reads \"tied for\"; an unshared one doesn't", six);
  }
  {
    // 0.107.9: an NBA record comes before a franchise record (the league's own record book is checked first).
    const { leagueMarks, leagueRecordLines, withLeagueFirst } = await import("../src/records/teamgame.js");
    const book = JSON.parse(fs.readFileSync(path.join(root, "src/data/nba-record-book-2026-27.json"), "utf8")), LM = leagueMarks(book);
    // box: fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, ast, stl, blk, tov, pf
    const bx = (o = {}) => { const b = [40, 88, 12, 34, 18, 22, 10, 33, 25, 7, 5, 13, 19]; for (const [k, v] of Object.entries(o)) b[["fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf"].indexOf(k)] = v; return b; };
    const gm = (d, h, a, hb, ab, hq = [28, 27, 29, 26], aq = [25, 26, 27, 24]) => ({ id: `${d}${h}`, d, h, a, hs: hq.reduce((x, y) => x + y, 0), as: aq.reduce((x, y) => x + y, 0), hb, ab, hq, aq });
    const rowsL = [
      gm("2026-11-10", "MIL", "MIA", bx({ fg3m: 29, fg3a: 55 }), bx()),                                   // ties the 29
      gm("2026-11-12", "BOS", "NYK", bx({ fg3m: 31, fg3a: 60 }), bx({ fg3m: 19 })),                       // 31: the record; 50 together: the both-teams record
      gm("2026-11-14", "DEN", "UTA", bx({ fg3m: 30 }), bx({ blk: 0 })),                                   // 30 after a 31 is nothing; a night without a block is nothing
      gm("2026-11-16", "PHX", "SAC", bx(), bx(), [59, 20, 21, 22], [20, 21, 22, 23]),                     // 59 in a first quarter: said once, as "in a quarter"
    ];
    const LL = leagueRecordLines({ book, rows: rowsL, since: "2026-11-01", today: "2026-11-18" }).map((l) => l.text).sort();
    const fr = [{ team: "BOS", date: "2026-11-12", key: "teambox|BOS|team|most|fg3m|game", text: "franchise threes", score: 4.4 }, { team: "BOS", date: "2026-11-12", key: "teambox|BOS|team|most|fg3a|game", text: "franchise attempts", score: 4.4 }];
    const merged = withLeagueFirst(leagueRecordLines({ book, rows: rowsL, since: "2026-11-12", today: "2026-11-13" }), fr);
    ok(LM["most|fg3m|one|game"].v === 29 && LM["most|pts|one|game"].v === 186 && LM["fewest|pf|one|game"].v === 4 && LM["most|pts|one|quarter"].v === 58 && LM["most|pts|one|quarter|0"].v === 55 && LM["fewest|blk|one|game"].many
      && !/\(47\)/.test(LM["most|fg3m|both|game"].holder)
      && LL.length === 4
      && LL.includes("BOS had 31 threes on 11/12 (NYK): an NBA record, the most by one team in a game (was 29, Milwaukee at Miami, Dec. 29, 2020 and 3 more), by the league's record book")
      && LL.includes("MIL had 29 threes on 11/10 (MIA): tying the NBA record for the most by one team in a game (also 29, Milwaukee at Miami, Dec. 29, 2020 and 3 more), by the league's record book")
      && LL.some((t) => /^NYK and BOS combined for 50 threes on 11\/12: an NBA record, the most by both teams in a game \(was 48, Golden State vs\. Dallas, Dec\. 15, 2024\)/.test(t))
      && LL.some((t) => /^PHX had 59 points in a quarter on 11\/16 \(SAC\): an NBA record, the most by one team in a quarter \(was 58, Buffalo at Boston, Oct\. 20, 1972\)/.test(t))
      && merged.length === 3 && /^BOS had 31 threes.*; also the Celtics' franchise mark$/.test(merged[0].text) && merged.some((l) => l.text === "franchise attempts") && !merged.some((l) => l.text === "franchise threes"),
      "0.107.9: every game is set against the league's record book before a team's own marks: 31 threes is an NBA record (and the team's franchise line for the same mark folds into it), 29 ties it, 30 after a 31 says nothing, the two teams' 50 is the both-teams record, 59 points in a first quarter is said once as the most in any quarter, and a mark the book gives as held by many (a night without a block) is never a line",
      JSON.stringify({ LL, merged: merged.map((l) => l.text) }));
  }
  {
    // 0.107.6: a season cut into as many stretches as its wins and losses support; the line is the current stretch against the one before.
    const { turnLines: tl6, stretches, TURN: T6 } = await import("../src/anticipate/seasonlong.js");
    const dN = (i) => new Date(Date.UTC(2026, 10, 1) + i * 864e5).toISOString().slice(0, 10);
    const mk = (team, wins) => wins.map((w, i) => ({ id: `${team}${i}`, d: dN(i), h: team, a: `Z${team}${i}`, hs: w ? 110 : 100, as: w ? 100 : 110 }));
    const rep = (pattern, n) => Array.from({ length: n }, (_, i) => pattern[i % pattern.length]);
    const one = (wins) => tl6({ rows: mk("GGG", wins) }).map((l) => l.text);
    const three = one([...rep([1, 1, 1, 1, 0], 10), ...rep([0, 0, 0, 1], 8), ...rep([1, 1, 1, 0], 8)]);           // the cuts fall where the losses start and stop: 8-1, then 1-7, then 7-2
    const stale = one([0, 0, 0, 0, ...rep([1, 0], 20)]);                                                          // 0-4, then 10-10: twenty games is past four times four
    const fresh = one([0, 0, 0, 0, ...rep([1, 1, 1, 1, 0], 10)]);                                                 // 0-4, then 8-2
    const blip = one([...rep([1, 1, 0], 30), 0, 0, 0, 0, ...rep([1, 1, 0, 1, 1, 0, 1, 0, 1, 1], 24)]);            // 20-9, five straight losses, then 17-7 over 24: back to what it was, and past four times five
    const skid = one([...rep([1, 1, 0], 30), 0, 0, 0, 0, 0]);                                                     // 20-10, then five straight losses: fresh, said at once
    ok(JSON.stringify(stretches([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0])) === "[[0,6],[6,12]]" && stretches(rep([1, 0], 12)).length === 1 && stretches([1, 0, 1]).length === 1
      && three.length === 1 && three[0] === "GGG is 7-2 since 11/18; it went 1-7 in the 8 games before that (11/10 on), after 8-1 to start (16-10 in all)"
      && stale.length === 0 && fresh.length === 1 && fresh[0] === "GGG went 0-4 in its first 4 games; 8-2 since (11/5 on)"
      && blip.length === 0 && skid.length === 1 && skid[0] === "GGG went 20-9 in its first 29 games; 0-6 since (11/30 on)" && T6.ratio === 4 && T6.z === 1.9,
      "0.107.6: a team's season is cut into stretches wherever its wins and losses change by more than chance would (not once, and not at a fixed length): good, bad, good is said as the current stretch, the one before it and the one before that, with the season's record; a 0-4 start stops carrying the comparison once the stretch since has run past sixteen games; a five-game dip inside a good season says nothing once the team has been back to what it was for more than twenty games; six straight losses after 20-9 are said at once",
      JSON.stringify({ three, stale, fresh, blip, skid }));
  }
  {
    // 0.107.5: the dates people name (New Year's Day, the trade deadline, the All-Star break), asked of every team.
    const { checkpointLines, seasonLongLines: sll, CHECK, DEADLINE } = await import("../src/anticipate/seasonlong.js");
    const mk = (team, days, wins) => wins.map((w, i) => ({ id: `${team}${days[i]}`, d: days[i], h: team, a: `Z${team}${i}`, hs: w ? 110 : 100, as: w ? 100 : 110 }));
    const dec = (n) => Array.from({ length: n }, (_, i) => `2026-12-${String(i + 1).padStart(2, "0")}`), jan = (n, from = 2) => Array.from({ length: n }, (_, i) => `2027-01-${String(i + from).padStart(2, "0")}`), feb = (n) => Array.from({ length: n }, (_, i) => `2027-02-${String(i + 11).padStart(2, "0")}`);
    const W1 = (w, l) => [...Array(w).fill(1), ...Array(l).fill(0)];
    // by 1/25: AAA 4-8 then 9-1 (ten games since: the .380 bar); CCC 8-4 then 5-2 (no change); EEE 3-9 then 5-2 (seven games since: .464 clears .450); FFF 4-8 then 5-2 (.381 does not)
    const r1 = [...mk("AAA", dec(12), W1(4, 8)), ...mk("AAA", jan(10), W1(9, 1)), ...mk("CCC", dec(12), W1(8, 4)), ...mk("CCC", jan(7), W1(5, 2)), ...mk("EEE", dec(12), W1(3, 9)), ...mk("EEE", jan(7), W1(5, 2)), ...mk("FFF", dec(12), W1(4, 8)), ...mk("FFF", jan(7), W1(5, 2))];
    const c1 = checkpointLines({ rows: r1, today: "2027-01-25" });
    // by 2/20: DDD 10-10 then 7-0 from the deadline on; GGG 14-6 then 7-0 (a good team's good week); a team with nine games before says nothing
    const r2 = [...mk("DDD", dec(12), W1(6, 6)), ...mk("DDD", jan(8), W1(4, 4)), ...mk("DDD", feb(7), W1(7, 0)), ...mk("GGG", dec(12), W1(8, 4)), ...mk("GGG", jan(8), W1(6, 2)), ...mk("GGG", feb(7), W1(7, 0)), ...mk("HHH", dec(9), W1(0, 9)), ...mk("HHH", feb(7), W1(7, 0))];
    const c2 = checkpointLines({ rows: r2, today: "2027-02-20" });
    // a team's own turn within ten days of the named date is the same change: the named line stays, the turn line goes
    const both = sll({ rows: r1, today: "2027-01-25" }).lines.filter((l) => l.team === "AAA" && l.kind === "turn").map((l) => l.key);
    // last season as it was played, from the results history: Atlanta after the break, Charlotte and New York around New Year's
    const HG = JSON.parse(fs.readFileSync(path.join(root, "src/data/nba-results-history.json"), "utf8")).games.filter((g) => g[0] >= "2025-10-01" && g[0] <= "2026-04-30" && g[5] === 2).map((g, i) => ({ id: `h${i}`, d: g[0], h: g[1], a: g[2], hs: g[3], as: g[4] }));
    const at = (today) => checkpointLines({ rows: HG.filter((g) => g.d < today), today }).map((l) => l.text);
    const mar = at("2026-03-20"), jn = at("2026-01-20"), feb25 = at("2026-02-25");
    ok(c1.map((l) => l.text).sort().join(" | ") === "AAA is 9-1 since New Year's Day (1/1); it was 4-8 before | EEE is 5-2 since New Year's Day (1/1); it was 3-9 before"
      && c2.length === 1 && c2[0].text === "DDD is 7-0 since the trade deadline (2/11); it was 10-10 before" && DEADLINE["2026-27"] === "2027-02-11" && CHECK.gapShortest === 0.45
      && both.join() === "check|AAA"
      && mar.includes("ATL is 12-1 since the All-Star break (2/19); it was 26-30 before") && mar.includes("CHA is 25-12 since New Year's Day (1/1); it was 11-22 before")
      && jn.includes("NYK is 2-8 since New Year's Day (1/1); it was 23-10 before") && feb25.length === 2 && !feb25.some((t) => /^SAS/.test(t)),
      "0.107.5: a team's record since New Year's Day, the trade deadline or the All-Star break against its record before, when the change is wide enough for the games played since (.450 with six to nine, .380 with ten to fourteen, .300 from fifteen); a good team's 7-0 week after the deadline says nothing; the team's own turn within ten days of the named date gives way to it; last season replayed from the results history gives Atlanta 12-1 after the break (26-30 before), Charlotte 25-12 after New Year's (11-22), New York 2-8 (23-10)",
      JSON.stringify([c1.map((l) => l.text), c2.map((l) => l.text), both, mar, jn, feb25]));
  }
  const W = buzzCounts([{ title: "Memphis Grizzlies vs. Washington Wizards: Game Highlights" }, { title: "Washington leading Memphis early" }, { title: "P.J. Washington scores 30 for Dallas" }, { title: "Tatum continues to impress" }],
    { players: ["P.J. Washington", "Jayson Tatum"], teams: ["WAS", "MEM"] });
  ok(W.players["P.J. Washington"] === 1 && W.players["Jayson Tatum"] === 1 && W.teams.WAS === 2 && W.teams.MEM === 2,
    "buzz (0.106): a surname that is a team's city or nickname never counts alone (the published list of 11/18 had P.J. Washington in four headlines, all about the Wizards); his full name still does, and a headline naming him is not a Wizards headline", JSON.stringify(W));
  const all = [{ kind: "season", team: "OKC", player: "Jared McCain", text: "a", score: 3 }, { kind: "season", team: "SAS", player: "Other Guy", text: "b", score: 3.2 }];
  const R = briefing({ all, games: [{ away: "OKC", home: "SAS" }], stars: { "Jared McCain": 0.4, "Other Guy": 0.4 }, today: "2026-11-15", buzz: B });
  ok(buzzBoost(all[0], B) > 0.25 && R.top[0].player === "Jared McCain" && R.top[0].news === 2, "briefing (0.70): a player in the news moves up, and says so", JSON.stringify(R.top.map((l) => [l.player, l.rank, l.news])));
}
{
  const { pastSeason } = await import("../src/anticipate/replay.js");
  const { runChecks } = await import("../src/anticipate/flagcheck.js");
  const history = { columns: ["date", "home", "away", "homeScore", "awayScore", "type"], games: [["2025-12-01", "PHI", "BOS", 100, 110, 2], ["2025-12-03", "PHI", "BOS", 100, 105, 2], ["2026-02-10", "OKC", "UTA", 120, 100, 2], ["2026-02-12", "UTA", "OKC", 90, 115, 2], ["2026-04-20", "OKC", "PHX", 120, 100, 3]] };
  const logs = { columns: ["date", "opp", "home", "result", "type", "min", "pts", "reb", "ast", "stl", "blk", "fg3m", "fgm", "fga", "fg3a", "ftm", "fta"],
    players: { m1: [["2025-12-01", "BOS", 1, "L", 2, 20, 6, 2, 2, 0, 0, 1, 2, 7, 3, 1, 2], ["2025-12-03", "BOS", 1, "L", 2, 20, 6, 2, 2, 0, 0, 1, 2, 7, 3, 1, 2], ["2026-02-10", "UTA", 1, "W", 2, 24, 21, 3, 4, 1, 0, 3, 8, 14, 6, 2, 2], ["2026-02-12", "UTA", 0, "W", 2, 24, 22, 3, 4, 1, 0, 3, 8, 14, 6, 3, 3], ["2026-04-20", "PHX", 1, "W", 3, 30, 30, 3, 4, 1, 0, 3, 8, 14, 6, 2, 2]] } };
  const P = pastSeason({ history, logs, season: "2025-26" });
  ok(P.rows.length === 4 && P.pg.m1.map((x) => x.team).join() === "PHI,PHI,OKC,OKC" && P.pg.m1[3].win,
    "replay (0.70): last season's player games get their team from the results (date, opponent, home); playoffs left out", JSON.stringify(P.pg.m1.map((x) => [x.d, x.team, x.win])));
  const R = runChecks([{ id: "a", season: "2025-26", morning: "2026-02-13", claim: "x", detector: "seasonlong", match: "^Mac Cain this season, OKC \\(2 GP, 2-0\\)" }, { id: "b", season: "2025-26", morning: "2026-02-13", claim: "y", replayable: false }],
    { rows: [], logs, seasons: null, history, names: { m1: "Mac Cain" }, season: "2026-27" });
  ok(R.found === 1 && R.total === 1 && R.cantReplay === 1 && R.checks[1].found === null, "flag checks (0.70): a post from last season is replayed; one that needs data we don't keep is set apart, not counted a miss", JSON.stringify(R));
}
// ---------- 0.75: shots across games: makes and misses in a row, court time without a field goal or a free throw ----------
{
  const { shotStreaks } = await import("../src/gameflow/stats.js");
  const { tonightCandidates } = await import("../src/anticipate/tonight.js");
  const mk = (name, team, total, ev) => ({ name, team, total, ev });
  // Hot Hand: 4 straight makes to end game 1, 5 in game 2, 3 to open game 3 (12 in a row, still going); 2 free throws a game, the 1st missed.
  // Cold One: a make early in game 1, then 0-for-9 over 3 games; Line Man: 5 free-throw trips a game until none in games 2 and 3.
  const games = [
    { date: "2026-11-10", shots: { h: mk("Hot Hand", "DAL", 1200, [[100, "2", false], [200, "2", true], [300, "2", true], [400, "F", false], [500, "2", true], [600, "2", true], [700, "F", true]]),
      c: mk("Cold One", "DAL", 1500, [[60, "2", true], [300, "3", false], [900, "2", false], [1200, "3", false]]), l: mk("Line Man", "DAL", 1800, [[100, "F", true], [300, "F", true], [600, "F", true], [900, "F", true], [1500, "F", true], [1600, "2", true]]) } },
    { date: "2026-11-12", shots: { h: mk("Hot Hand", "DAL", 1200, [[100, "2", true], [200, "2", true], [300, "2", true], [400, "2", true], [500, "2", true], [600, "F", true], [700, "F", true]]),
      c: mk("Cold One", "DAL", 1500, [[100, "3", false], [500, "2", false], [1400, "3", false]]), l: mk("Line Man", "DAL", 1800, Array.from({ length: 12 }, (_, i) => [100 + i * 100, "2", i % 2 === 0])) } },
    { date: "2026-11-14", shots: { h: mk("Hot Hand", "DAL", 1200, [[100, "2", true], [200, "2", true], [300, "2", true]]),
      c: mk("Cold One", "DAL", 1500, [[100, "2", false], [500, "3", false], [900, "2", false]]), l: mk("Line Man", "DAL", 1800, Array.from({ length: 12 }, (_, i) => [100 + i * 100, "2", i % 2 === 0])) } } ];
  const S = shotStreaks([games[2], games[0], games[1]]);     // any order in
  const h = S.players.h, c = S.players.c, l = S.players.l;
  ok(h.fg === 12 && h.fgFrom === "2026-11-10" && h.ft === 3 && c.fgMiss === 9 && c.fg3Miss === 5 && c.dryFg.fga === 9 && c.dryFg.sec === 1440 + 1500 + 1500 && c.dryFg.games === 3 && c.dryFg.from === "2026-11-10"
    && l.dryFt.sec === 300 + 1800 + 1800 && l.dryFt.fga === 25 && l.fta === 5 && l.gp === 3 && S.best.fg[0].n === 12 && S.best.fg[0].active && S.best.dryFg[0].name === "Cold One",
    "shot streaks (0.75): makes in a row carry across games; court time and attempts since the last made field goal and the last free-throw attempt add up over games; the season's longest are kept", JSON.stringify([h.fg, h.ft, c.fgMiss, c.dryFg, l.dryFt, S.best.fg]));
  const watch = { today: "2026-11-15", teams: [], games: [{ id: "1", homeTri: "DAL", awayTri: "XXX", home: "DAL", away: "XXX" }] };
  l.fta = 15;                                                 // at the line 5 times a game before it stopped
  const L = tonightCandidates({ watch, fouls: { shots: S } }).all.filter((x) => /^shots\|/.test(x.key || "")).map((x) => x.text);
  ok(L.includes("Hot Hand has made 12 field goals in a row (since 11/10): the longest run this season; the NBA record is 35 (Wilt Chamberlain, 1967)")
    && L.includes("Cold One has gone 74 minutes on the floor without a made field goal (0-for-9 since 11/10, over 3 games): the longest this season")
    && L.includes("Line Man has played 65 minutes without a free-throw attempt (25 shots in that time, since 11/10, over 3 games); he averages 5.0 a game") && L.length === 3
    && tonightCandidates({ watch: { ...watch, today: "2026-11-25" }, fouls: { shots: S } }).all.filter((x) => /^shots\|/.test(x.key || "")).length === 0,
    "storylines (0.75): shots across games: a run of makes with the season's scale and the NBA record, court time without a field goal with the attempts, and without a free throw for a player who usually gets there; nothing once the run is a week old", L.join(" | "));
}

// ---------- 0.74: the two-source lineup watch (scripts/lineup-sources.js): reading and reporting ----------
{
  const S = await import("../scripts/lineup-sources.js");
  const pl = (status, stamp, pos = "G") => ({ position: pos, lineupStatus: status, timestamp: stamp });
  const feed = { games: [{ gameId: "0022600001", homeTeam: { teamAbbreviation: "PHI", players: [...Array(5)].map(() => pl("Confirmed", "2026-11-16T18:36:00")).concat([{ position: "", lineupStatus: "Confirmed", timestamp: "2026-11-16T19:50:00" }]) },
    awayTeam: { teamAbbreviation: "IND", players: [...Array(4)].map(() => pl("Confirmed", "2026-11-16T18:35:00")).concat([pl("Expected", "2026-11-16T12:00:00")]) } }] };
  const L = S.readLineups(feed);
  const box = S.readBoxStarters({ game: { homeTeam: { teamTricode: "PHI", players: [...Array(5)].map(() => ({ starter: "1" })).concat([{ starter: "0" }]) }, awayTeam: { teamTricode: "IND", players: [{ starter: "1" }] } } });
  ok(S.stampMs("2026-11-12T18:34:00") === Date.parse("2026-11-12T23:34:00Z") && S.stampMs("2026-07-01T18:34:00") === Date.parse("2026-07-01T22:34:00Z")
    && L.PHI.confirmed && L.PHI.stamp === Date.parse("2026-11-16T23:36:00Z") && L.PHI.gameId === "0022600001" && !L.IND.confirmed && box.PHI === true && box.IND === false,
    "lineup sources (0.74): NBA.com's Eastern stamps (winter and summer), a five confirmed only when all five are, starters in the box score file only when there are five", JSON.stringify([L, box]));
  const T = Date.parse("2026-11-16T23:36:00Z");
  const R = S.report([{ team: "PHI", tip: T + 24 * 60e3, stamp: T, feed: T + 276e3, box: T + 70e3, boxThere: T - 600e3 }, { team: "IND", tip: T + 24 * 60e3, stamp: T, feed: T + 216e3, box: null }], [T, T + 200e3, T + 380e3]);
  ok(/^PHI tip 19:00:00 · stamp 18:36:00 · lineups file 18:40:36 \(\+276s\) · box file 18:37:10 \(\+70s\) · box file first there 18:26:00 · box ahead by 206s$/.test(R.lines[0]) && /^IND .* box file —$/.test(R.lines[1])
    && R.summary === "teams with both: 1 of 2 · median lineups-file lag 246s · median box-file lag 70s · box ahead in 1 of 1 (median 206s) · lineups file rewritten 3 times, 190s apart at the median (180-200s)" && !/[a-z]{4,} [A-Z][a-z]+ [A-Z][a-z]+/.test(R.lines.join(" ")),
    "lineup sources (0.74): the report is one line a team (codes and clock times only) with each file's lag from the stamp and which was ahead, then the medians and how often the lineups file was rewritten", [R.lines.join(" | "), R.summary].join(" || "));
}

// ---------- 0.72.7: margin by quarter, and the final two minutes (the user, 11/15: "Proceed") ----------
{
  const { quarterMargins, quarterLines } = await import("../src/situations/quarters.js");
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const d = `2026-11-${String(i + 1).padStart(2, "0")}`;
    rows.push({ d, h: "AAA", a: "BBB", hq: [28, 28, 20, 28], aq: [25, 25, 28, 25] });      // AAA: +3, +3, -8, +3; BBB the reverse
    rows.push({ d, h: "CCC", a: "DDD", hq: [25, 25, 25, 25], aq: [25, 25, 25, 25] });
    rows.push({ d, h: "EEE", a: "FFF", hq: [26, 25, 25, 25, 12], aq: [25, 25, 26, 25, 10] }); // an overtime period is left out
  }
  const M = quarterMargins(rows);
  const L = quarterLines(rows, [{ away: "BBB", home: "AAA" }]);
  const a = L.find((l) => l.team === "AAA"), b = L.find((l) => l.team === "BBB");
  ok(M.AAA.gp === 10 && M.AAA.q[2].pf - M.AAA.q[2].pa === -80 && M.AAA.rank[2] === 6 && M.BBB.rank[2] === 1 && M.EEE.q.length === 4
    && a && a.kind === "qtr" && a.text === "AAA has been outscored by 80 in 3rd quarters (−8.0 a game, the worst in the NBA; lost the quarter in 10 of 10 games) and is +90 in the other three quarters combined; tonight's opponent BBB is +80 in 3rd quarters (best)"
    && b && /^BBB has outscored opponents by 80 in 3rd quarters \(\+8\.0 a game, the best in the NBA; won the quarter in 10 of 10 games\) and is −90 in the other three quarters combined; tonight's opponent AAA is −80 in 3rd quarters \(worst\)$/.test(b.text)
    && !L.some((l) => ["CCC", "DDD", "EEE", "FFF"].includes(l.team)) && quarterLines(rows.slice(0, 9), []).length === 0,
    "quarters (0.72.7): one quarter far out of line with a team's other three, its place in the league, and tonight's opponent in that quarter; even teams and teams with few games get no line", L.map((l) => l.text).join(" | "));
  const { tonightCandidates } = await import("../src/anticipate/tonight.js");
  const flow = { l2m: { games: 20, teams: { UTA: { team: "UTA", games: 6, w: 1, l: 5, pts: 29, opp: 46 }, PHI: { team: "PHI", games: 5, w: 5, l: 0, pts: 41, opp: 23 }, BOS: { team: "BOS", games: 6, w: 3, l: 3, pts: 30, opp: 30 }, DEN: { team: "DEN", games: 2, w: 2, l: 0, pts: 9, opp: 2 } },
    top: [{ name: "Late Scorer", team: "PHI", gp: 5, pts: 24, fgm: 9, fga: 13, ftm: 4, fta: 4 }, { name: "Not Tonight", team: "MEM", gp: 6, pts: 22, fgm: 5, fga: 13, ftm: 10, fta: 10 }, { name: "Few Points", team: "UTA", gp: 4, pts: 12, fgm: 3, fga: 9, ftm: 5, fta: 6 }] } };
  const watch = { today: "2026-11-16", teams: [], games: [{ id: "1", homeTri: "UTA", awayTri: "PHI", home: "UTA", away: "PHI" }, { id: "2", homeTri: "BOS", awayTri: "DEN", home: "BOS", away: "DEN" }] };
  const T = tonightCandidates({ watch, fouls: flow }).all.filter((l) => l.kind === "fourth").map((l) => l.text);
  ok(T.length === 3 && T.includes("UTA is 1-5 in games within 3 in the final two minutes, outscored 46-29 in those two-minute stretches") && T.includes("PHI is 5-0 in games within 3 in the final two minutes, outscoring opponents 41-23 in those two-minute stretches")
    && T.includes("Late Scorer has 24 points in the final two minutes of close games (the most in the NBA): 9-13 FG, 4-4 FT in 5 games (within 3 in the last two minutes)"),
    "storylines (0.72.7): the final two minutes: a team at either end of the record (4+ games) and the league's top scorers there (15+ points, playing tonight)", T.join(" | "));
}

// ---------- 0.72.6: fourth-quarter storylines and two regulars out at once (the user, 11/15: "Start it up") ----------
{
  const end = (date, opp, fin, gameId, gone) => ({ date, opp, fin, gameId, ...(gone != null ? { gone } : {}) });
  const flow = { fourth: {
    a: { name: "Was Closing", team: "NYK", gs: 9, sat: 1, satW: 0, satMargin: -2, satMin: 2, satClose: 1, satPts: 6, satIn: ["g7"], close: 7, closed: 4, miss: 3, ends: [end("2026-11-01", "BOS", true, "g4"), end("2026-11-05", "PHI", false, "g5", 162), end("2026-11-11", "CLE", false, "g6", 93), end("2026-11-13", "IND", false, "g7", 720)] },
    f: { name: "Pulled Late", team: "NYK", gs: 9, sat: 0, satW: 0, satMargin: 0, satMin: null, satClose: 0, satPts: 0, satIn: [], close: 7, closed: 4, miss: 3, ends: [end("2026-11-01", "BOS", true, "g4"), end("2026-11-05", "PHI", false, "g5", 162), end("2026-11-11", "CLE", false, "g6", 300), end("2026-11-13", "IND", false, "g7", 93)] },
    g: { name: "Old File", team: "NYK", gs: 9, sat: 0, satW: 0, satMargin: 0, satMin: null, satClose: 0, satPts: 0, satIn: [], close: 7, closed: 4, miss: 3, ends: [end("2026-11-05", "PHI", false, "g5"), end("2026-11-11", "CLE", false, "g6"), end("2026-11-13", "IND", false, "g7")] },
    b: { name: "Rested Star", team: "OKC", gs: 13, sat: 5, satW: 2, satMargin: 5, satMin: 21, satClose: 0, satPts: 131, satIn: [], close: 4, closed: 4, miss: 0, ends: [] },
    c: { name: "Never Closes", team: "DET", gs: 12, sat: 0, satW: 0, satMargin: 0, satMin: null, satClose: 0, satPts: 0, satIn: [], close: 5, closed: 0, miss: 5, ends: [end("2026-11-12", "WAS", false, "g9")] },
    d: { name: "Role Player", team: "OKC", gs: 13, sat: 6, satW: 3, satMargin: 9, satMin: 4, satClose: 0, satPts: 40, satIn: [], close: 4, closed: 3, miss: 1, ends: [] },
    e: { name: "Fine Starter", team: "DET", gs: 12, sat: 1, satW: 1, satMargin: 20, satMin: 20, satClose: 0, satPts: 20, satIn: [], close: 5, closed: 4, miss: 0, ends: [] } } };
  const watch = { today: "2026-11-16", teams: [], games: [{ id: "1", homeTri: "NYK", awayTri: "OKC", home: "NYK", away: "OKC" }, { id: "2", homeTri: "DET", awayTri: "XXX", home: "DET", away: "XXX" }] };
  const { tonightCandidates } = await import("../src/anticipate/tonight.js");
  const L = tonightCandidates({ watch, fouls: flow }).all.filter((l) => l.kind === "fourth").map((l) => l.text);
  const RULE = "close: within 5 in the last five minutes; at the end: on the floor for half of the last three";
  ok(L.length === 5 && L.includes(`Was Closing started but wasn't on the floor at the end of NYK's last 3 close games, most recently 11/13 vs IND (didn't play in the 4th); he had finished 4 of 4 before (${RULE})`)
    && L.includes(`Pulled Late started but wasn't on the floor at the end of NYK's last 3 close games, most recently 11/13 vs IND (out for the last 1:33); he had finished 4 of 4 before (${RULE})`)
    && L.includes(`Old File started but wasn't on the floor at the end of NYK's last 3 close games; he had finished 4 of 4 before (${RULE})`)
    && L.includes("Rested Star hasn't played in the 4th quarter in 5 of his 13 starts: OKC 2-3 in those (every one decided by 20+), and he averages 26.2 points in them")
    && L.includes(`Never Closes has not finished any of the 5 close games he has started for DET (${RULE})`),
    "storylines (0.72.6): fourth quarters: a starter who stopped finishing close games, a scorer who sits the 4th of decided games, one who never finishes; a role player sitting and a starter who finishes get none", L.join(" | "));
  // Two regulars out at once: games without both since each joined, this season and last, and the teammate who rises most.
  const { comboAbsences } = await import("../src/injuries/impact.js");
  const pl = (min, pts, reb = 5, ast = 5) => [1, min, pts, 0, 0, 0, 0, 0, 0, reb, ast, 0, 0, 0, 0, 0, 0, 0];
  const file = { team: "LAL", names: { s1: "Star One", s2: "Star Two", r: "Third Guy", t: "Top Scorer" }, games: [
    { d: "2026-10-22", pf: 110, pa: 100, pl: { s1: pl(35, 30), s2: pl(34, 25), r: pl(30, 18), t: pl(30, 26) } },
    { d: "2026-10-24", pf: 100, pa: 110, pl: { s1: pl(35, 30), r: pl(30, 20), t: pl(30, 26) } },
    { d: "2026-10-26", pf: 120, pa: 110, pl: { s1: pl(0, 0), s2: pl(0, 0), r: pl(38, 51, 11, 9), t: pl(30, 27) } },
    { d: "2026-10-28", pf: 100, pa: 105, pl: { r: pl(38, 37, 8, 13), t: pl(30, 27) } },
    { d: "2026-10-30", pf: 100, pa: 99, pl: { s1: pl(35, 30), s2: pl(34, 25), r: pl(30, 16), t: pl(30, 26) } } ] };
  const prior = { s1: [{ d: "2026-03-01", team: "LAL", pts: 30, win: true }], s2: [{ d: "2026-03-01", team: "LAL", pts: 20, win: true }], r: [{ d: "2026-02-01", team: "LAL", pts: 40, reb: 1, ast: 1, win: true }, { d: "2026-03-01", team: "LAL", pts: 18, reb: 4, ast: 4, win: true }, { d: "2026-03-05", team: "LAL", pts: 45, reb: 7, ast: 7, win: false }], t: [] };
  const imp = [{ team: "LAL", id: "s1", name: "Star One", status: "Out", mpg: 35, score: 3 }, { team: "LAL", id: "s2", name: "Star Two", status: "Out", mpg: 34, score: 2.5 }, { team: "BOS", id: "x", name: "Lone Out", status: "Out", mpg: 30, score: 2 }];
  const C = comboAbsences(imp, { LAL: file }, { prior });
  ok(C.length === 1 && C[0].text === "Star One and Star Two both out: LAL 1-2 in 3 games without both since last season; Third Guy 44.3 PPG, 8.7 RPG, 9.7 APG in them (18.0 PPG otherwise)" && C[0].score > 3,
    "injuries (0.72.6): two regulars out at once: the games without both since both were with the team (a game before then isn't one), last season's included, and the teammate whose scoring rises most", JSON.stringify(C.map((c) => c.text)));
  // A deep reserve who only plays in those games isn't the pick; the top scorer is.
  const deep = { ...file, names: { ...file.names, z: "Deep Reserve" }, games: file.games.map((g, k) => ({ ...g, pl: { ...g.pl, z: pl(k === 2 || k === 3 ? 20 : 3, k === 2 || k === 3 ? 12 : 1), r: pl(30, 20) } })) };
  ok(/; Top Scorer 27\.0 PPG/.test(comboAbsences(imp, { LAL: deep }, { prior: null })[0]?.text || ""), "injuries (0.72.6): a reserve who only plays without them (12 from 1) isn't named over the team's scorer", JSON.stringify(comboAbsences(imp, { LAL: deep }, { prior: null }).map((c) => c.text)));
  ok(comboAbsences(imp.slice(0, 1), { LAL: file }, { prior }).length === 0 && comboAbsences(imp, { LAL: { ...file, games: file.games.slice(0, 2) } }, { prior: null }).length === 0, "injuries (0.72.6): one regular out, or no games without both, gets no such line");
}

// ---------- 0.72.5: era totals, blowout spans, and last season's posts through the team watch (the user's 20 posts, 11/15) ----------
{
  const { eraLines } = await import("../src/anticipate/seasonlong.js");
  const { streakWatch } = await import("../src/situations/streakwatch.js");
  const { runChecks } = await import("../src/anticipate/flagcheck.js");
  const cols = ["date", "opp", "home", "result", "type", "min", "pts", "reb", "ast", "stl", "blk", "fg3m", "fgm", "fga", "fg3a", "ftm", "fta"];
  const g = (d, type, pts, reb, ast, stl, blk) => [d, "XXX", 1, "W", type, 30, pts, reb, ast, stl, blk, 1, 5, 10, 3, 2, 2];
  const many = (n, start, f) => Array.from({ length: n }, (_, i) => f(new Date(Date.parse(start) + i * 2 * 864e5).toISOString().slice(0, 10)));
  // Vet: before the decade 9,000 points that mustn't count, then 100 games of 30/10/10. Rival: 100 games of 30 and a 40-point playoff game.
  // Kid: his whole career in the logs (debut 2023), 100 games with 4 blocks; Vet and Rival block 1 a game over the same span.
  const logs = { columns: cols, players: {
    vet: [...many(300, "2017-10-20", (d) => g(d, 2, 30, 5, 5, 1, 1)), ...many(100, "2023-10-25", (d) => g(d, 2, 30, 10, 10, 2, 1))],
    riv: [...many(100, "2023-10-25", (d) => g(d, 2, 30, 4, 3, 1, 1)), g("2024-06-01", 3, 40, 4, 3, 1, 1)],
    kid: many(100, "2023-10-25", (d) => g(d, 2, 15, 6, 2, 0, 4)) } };
  const pgOf = (team, pts, n = 4) => Array.from({ length: n }, (_, i) => ({ d: `2026-11-0${i + 1}`, team, pts, reb: 5, ast: 5, stl: 1, blk: 1, fg3m: 1, win: true }));
  const pg = { vet: pgOf("DEN", 30), riv: pgOf("BOS", 30), kid: pgOf("SAS", 15) };
  const L = eraLines({ pg, logs, names: { vet: "Old Vet", riv: "The Rival", kid: "New Kid" }, today: "2026-11-15" });
  const txt = L.map((l) => l.text);
  // Decade points: Vet 300 games counted from 2020 only... (those 300 start in 2017: the ones before 1/1/2020 are out).
  ok(txt.some((t) => /^Old Vet leads the decade \(since 1\/1\/2020, playoffs included\) in .*rebounds .*assists .*steals/.test(t)) && L.every((l) => l.kind === "era"),
    "era lines (0.72.5): a player leading three or more of the decade's totals among current players, games before 2020 left out", txt.join(" | "));
  ok(txt.some((t) => /^Most blocks since New Kid entered the NBA \(10\/25\/23\): New Kid 404, /.test(t) && /regular season, current players/.test(t)),
    "era lines (0.72.5): most blocks since a player entered the NBA, when his whole career is in the logs and he leads by a distance", txt.join(" | "));
  // A lead about to change hands: the chaser within two of his games.
  const close = { columns: cols, players: { a: many(100, "2024-01-01", (d) => g(d, 2, 30, 1, 1, 0, 0)), b: [...many(99, "2024-01-01", (d) => g(d, 2, 30, 1, 1, 0, 0)), g("2024-09-01", 3, 27, 1, 1, 0, 0)] } };
  const L2 = eraLines({ pg: { a: pgOf("DEN", 30, 1), b: pgOf("BOS", 30, 1) }, logs: close, names: { a: "Front Man", b: "Chaser" }, today: "2026-11-15" });
  ok(L2.length === 1 && L2[0].text.startsWith("Chaser is 4 points from passing Front Man for the most points this decade (3,027 to 3,030;"), "era lines (0.72.5): a decade lead within reach is said before it changes hands (playoffs counted)", L2.map((l) => l.text).join(" | "));
  // Blowouts: 25+ losses in three of the last five; history has one team with three in five and none with four.
  const H = { games: [] };
  const add = (d, home, away, hs, as) => H.games.push([d, home, away, hs, as, 2]);
  ["2025-01-01", "2025-01-03", "2025-01-05"].forEach((d) => add(d, "UTA", "BOS", 90, 120));
  const rows = [["2026-11-01", 80, 111], ["2026-11-03", 100, 114], ["2026-11-05", 90, 117], ["2026-11-07", 99, 100], ["2026-11-09", 80, 113]].map(([d, hs, as], i) => ({ d, h: "SAC", a: ["ATL", "DEN", "MIN", "LAL", "OKC"][i], hs, as }));
  const W = streakWatch({ history: H, rows, today: "2026-11-10" });
  const sac = W.find((l) => l.team === "SAC" && l.stat === "blown25");
  ok(sac && sac.text === "SAC has lost 3 of its last 5 by 25+ (by 31, 27, 33): one other team has had 3 in a 5-game span since 2016-17 (UTA 2024-25); none had 4" && !W.some((l) => l.team === "ATL" && /by 25\+/.test(l.text)),
    "team watch (0.72.5): 25-point losses in three of the last five, with how many teams have had that many and one more", W.map((l) => l.text).join(" | "));
  // Last season's post through the team watch: the history is cut before that season so its games aren't counted twice.
  const hist = { columns: ["date", "home", "away", "homeScore", "awayScore", "type"], games: [...H.games, ...rows.map((r) => [r.d.replace("2026", "2025"), r.h, r.a, r.hs, r.as, 2])] };
  const R = runChecks([{ id: "k", season: "2025-26", morning: "2025-11-10", claim: "x", detector: "teamwatch", match: "^SAC has lost 3 of its last 5 by 25\\+" }], { rows: [], logs: { columns: cols, players: {} }, seasons: null, history: hist, names: {}, season: "2026-27" });
  ok(R.found === 1, "flag checks (0.72.5): a post from last season can be checked against the team watch and the prep stats, not only the season-long lines", JSON.stringify(R.checks.map((c) => [c.found, c.error, c.line])));
}

// ---------- 0.65: career highs allowed (this season's, rookies apart) ----------
{
  const { careerHighsAllowed } = await import("../src/situations/trends.js");
  const pg = {
    v1: [{ d: "2026-10-22", team: "AAA", opp: "BBB", home: true, pts: 20 }, { d: "2026-10-25", team: "AAA", opp: "CCC", home: false, pts: 31 }, { d: "2026-10-28", team: "AAA", opp: "BBB", home: true, pts: 33 }],
    r1: [{ d: "2026-10-22", team: "DDD", opp: "CCC", home: true, pts: 12 }, { d: "2026-10-24", team: "DDD", opp: "BBB", home: true, pts: 18 }, { d: "2026-10-26", team: "DDD", opp: "CCC", home: true, pts: 9 }],
    x1: [{ d: "2026-10-22", team: "EEE", opp: "BBB", home: true, pts: 50 }],
  };
  const careers = { v1: { hi: { pts: 30 }, known: new Set(["pts"]), rookie: false }, r1: { hi: {}, known: new Set(["pts"]), rookie: true }, x1: { hi: { pts: 12 }, known: new Set(), rookie: false } };
  const H = careerHighsAllowed(pg, careers, { v1: "Vet One", r1: "Rook One", x1: "Unknown" });
  const bbb = H.teams.find((t) => t.tri === "BBB"), ccc = H.teams.find((t) => t.tri === "CCC");
  ok(H.games.length === 3 && bbb.vets === 1 && bbb.rookies === 1 && ccc.vets === 1 && ccc.rookies === 0 && H.games.find((g) => g.pts === 33).prev === 31 && !H.games.some((g) => g.name === "Unknown"),
    "career highs allowed (0.65): new career highs this season by the team that allowed them; a rookie's debut doesn't count, his later bests do (marked); a career not on file is left out", JSON.stringify(H.teams.map((t) => [t.tri, t.vets, t.rookies])));
}

// ---------- 0.65: national TV flexes (ESPN's listings confirm, add or drop the guide's games) ----------
{
  const { mergeNational, asAired, espnNational, nationalIndex } = await import("../src/situations/national.js");
  const guide = { games: [{ d: "2026-11-16", away: "ORL", home: "BOS", time: "7:00 PM", networks: ["Peacock"] }, { d: "2026-11-18", away: "MIL", home: "MIA", networks: ["ESPN"] },
    { d: "2026-11-18", away: "PHX", home: "SAC", networks: ["ESPN"] }, { d: "2026-12-25", away: "NYK", home: "SAS", networks: ["ABC", "ESPN"] }] };
  const espnDays = { "2026-11-16": [{ away: "ORL", home: "BOS", tv: ["NBCSN"] }], "2026-11-18": [{ away: "MIL", home: "MIA", tv: ["ESPN"] }, { away: "PHX", home: "SAC", tv: ["NBA TV"] }, { away: "GSW", home: "DAL", tv: ["ESPN"] }] };
  const m = mergeNational(guide, espnDays, {}, "2026-11-14");
  const st = Object.fromEntries(m.games.map((g) => [`${g.away}@${g.home}`, g.status]));
  ok(st["ORL@BOS"] === "confirmed" && st["MIL@MIA"] === "confirmed" && st["PHX@SAC"] === "dropped" && st["GSW@DAL"] === "added" && st["NYK@SAS"] === "guide"
    && espnNational(["NBCSN", "NBA TV", "ESPN2"]).join() === "Peacock,ESPN",
    "national (0.65): ESPN's listing confirms the guide's games, drops a flexed-out one, adds a flexed-in one; beyond ESPN's days the guide stands", JSON.stringify(st));
  // Remembered after the game: a later build with no ESPN read for 11/18 keeps the flex.
  const m2 = mergeNational(guide, {}, m.seen, "2026-11-20");
  const ix = nationalIndex(asAired(m2));
  ok(ix.has("2026-11-18|GSW|DAL") && !ix.has("2026-11-18|PHX|SAC") && ix.has("2026-11-18|MIL|MIA"), "national (0.65): a flex is remembered once played, and the splits count the game as it aired");
}

// ---------- 0.65: team streak watch (OKC's first 3-game losing streak since 2023-24; NOP allowing 135+ four straight) ----------
{
  const { streakWatch } = await import("../src/situations/streakwatch.js");
  // History: OKC lost 3 straight in Feb. 2024, then 100 games of win-loss-win…; this season: lost the last 2.
  const H = { games: [] };
  const day = (n) => new Date(Date.UTC(2023, 9, 25) + n * 864e5).toISOString().slice(0, 10);
  let k = 0;
  for (let i = 0; i < 3; i++) H.games.push([day(k++), "OKC", "AAA", 100, 110, 2]);
  for (let i = 0; i < 160; i++) H.games.push([day(k++), "OKC", "AAA", i % 2 ? 120 : 100, 110, 2]);
  // DAL allowed 135+ four straight once; nobody else.
  for (let i = 0; i < 4; i++) H.games.push([day(k++), "DAL", "BBB", 120, 140, 2]);
  H.games.push([day(k++), "DAL", "BBB", 120, 100, 2]);
  const rows = [{ d: "2026-11-10", h: "OKC", a: "AAA", hs: 100, as: 110 }, { d: "2026-11-12", h: "OKC", a: "AAA", hs: 99, as: 104 },
    ...[0, 1, 2, 3].map((i) => ({ d: `2026-11-0${i + 2}`, h: "NOP", a: "CCC", hs: 110, as: 136 + i }))];
  const W = streakWatch({ history: H, rows, today: "2026-11-14" });
  const okc = W.find((w) => w.team === "OKC" && w.stat === "L"), nop = W.find((w) => w.team === "NOP" && w.stat === "pa135");
  ok(okc && /a loss tonight would be its first 3-game losing streak since 2023-24/.test(okc.text), "streak watch (0.65): a loss tonight would be OKC's first 3-game losing streak since 2023-24", JSON.stringify(W.map((w) => w.text)));
  ok(nop && /allowed 135\+ in 4 straight: one other team since 2016-17 \(DAL 2023-24\); none went 5/.test(nop.text), "streak watch (0.65): allowing 135+ four straight, with the one other team since 2016-17", nop?.text);
  const st = tonightStorylines({ watch: { today: "2026-11-14", games: [{ id: "1", awayTri: "OKC", homeTri: "NOP" }], teams: [] }, trends: { teams: { OKC: { streak: { type: "L", n: 4 } } }, watch: W } });
  const texts = st[0].lines.filter((l) => l.kind === "team").map((l) => l.text);
  ok(texts.some((t) => /first 3-game losing streak/.test(t)) && !texts.some((t) => /^OKC: lost/.test(t)) && texts.some((t) => /^NOP has allowed 135\+/.test(t)), "streak watch (0.65): the storylines carry it in place of the bare 'lost N straight'", JSON.stringify(texts));
}

// ---------- 0.69: the user's 11/15 notes review (Daniels, Shead, Wembanyama, the Spurs' blocks streak, Naz Reid) ----------
{
  const N = await import("../src/notes/narrative.js");
  const F = await import("../src/notes/facts.js");
  const T = (text, o = {}) => F.trimReason({ text, kind: "trend", ...o }, { today: "2026-11-15", box: { games: [] } });
  ok(/garbled/.test(T("DREB 92 times (@ CHI, 10 at DEN 1/9/26 Totaled 108 points, 79 rebounds, 60 assists and 32 steals through first 11 games.") || "")
    && /garbled/.test(T("Became the seventh player in franchise history total 27+ assists in a two-game span. (vs. MEM, 11/9/26) Nov. 6 at Milwaukee: Made first start of the season.") || ""),
    "notes (0.69): a stats table read into a sentence is trimmed as garbled");
  ok(/last season's note/.test(T("The Spurs recorded 5+ blocks in 23 straight games from Jan. 17 to March 8, 2026, the longest streak in the NBA this season and the Spurs longest streak in 25 years.") || "")
    && F.describe("The Spurs recorded 5+ blocks in 23 straight games from Jan. 17 to March 8, 2026, the longest streak in the NBA this season.").type !== "streak"
    && F.describe("The Spurs have recorded 5+ blocks in 23 straight games, the longest active streak in the NBA.").type === "streak",
    "notes (0.69): a streak with an end date isn't active, and 'this season' with only last season's dates is last season's note");
  ok(/title from past seasons/.test(T("Third consecutive NBA blocks champion, becoming third player in NBA history to lead the league in blocks per game in three consecutive seasons.") || "")
    && F.trimReason({ text: "Third consecutive NBA blocks champion.", kind: "trend" }, { today: "2027-03-10", box: { games: [] } }) === null,
    "notes (0.69): a title from past seasons waits until March");
  ok(F.describe("Became the 12th Raptor ever to record 15+ assists in a single-game and joins Mark Jackson (2X) and Jose Calderon (2X) as the only Raptors to record 16+ assists in a game with one turnover or fewer.").tag === "1 of 3 in team history"
    && N.repairLayout("Became the 12th Raptor ever to record 15+ assists in a single-game (vs. BOS, 11/11/26) 12/22/24 and joins Mark Jackson") === "Became the 12th Raptor ever to record 15+ assists in a single-game (vs. BOS, 11/11/26) and joins Mark Jackson",
    "notes (0.69): 'the only Raptors' is team history; a stray date from the next table cell is cut");
}

// ---------- 0.124: the notes guard and two game headers (11/19/26) ----------
{
  // the user, 6:03 PM: "what is the warning about a build for 6 teams… the game notes should have updated for teams on a back-to-back. what gives?"
  const { readMeta } = await import("../src/notes/meta.js");
  const { notesGuard, notesRead, HAS_NOTES } = await import("../src/site/notes-guard.js");
  const L = (...cells) => ({ text: cells.join("  "), cells: cells.map((text) => ({ text })) });
  // Minnesota's front page that night, as the layout reader gives it: no space after "VS."
  const min = readMeta({ pages: [{ lines: [L("GAME NOTES"), L("MINNESOTA TIMBERWOLVES (11-4) VS.NEW YORK KNICKS (8-6) • REGULAR SEASON GAME #16 • REGULAR SEASON HOME GAME #10"),
    L("TARGET CENTER (MINNEAPOLIS, MN) • THURSDAY, NOVEMBER 19, 2026 AT 7:00 P.M. CT • TV: DAZN"), L("TIMBERWOLVES 2026-27 SCHEDULE", "LAST GAME STARTERS: NOVEMBER 17 VS. PORTLAND TRAIL BLAZERS"),
    L("10/21", "AT MIAMI", "W, 131-106")] }] }, "MIN");
  // New York's: the header split over two lines, a schedule heading between them, and an "at Orlando" sentence lower down
  const nykLines = [L("2026-27 SCHEDULE"), L("NEW YORK KNICKS (8-6) at"), L("DATE", "OPPONENT", "TIME/RESULT", "W/L"), L("MINNESOTA TIMBERWOLVES (11-4)"), L("*Oct. 2", "at Philadelphia", "120-97", "L, 0-1"),
    L("*Oct. 13", "at Toronto", "148-98", "L, 0-4", "NOVEMBER 19, 2026 *8:00 P.M ET"), L("TARGET CENTER (MINNEAPOLIS, MN)"), L("Oct. 23", "@ Boston", "107-103", "L, 0-2", "GAME 15; AWAY GAME 8"),
    L("Knicks 92-88 win at Orlando. He finishes the night with 24 points and 16 rebounds.")];
  const nyk = readMeta({ pages: [{ lines: nykLines }] }, "NYK");
  // not joined: the cell below is not a bare team name; and a home header on one line is untouched
  const noJoin = readMeta({ pages: [{ lines: [L("NEW YORK KNICKS (8-6) at"), L("Madison Square Garden hosts the Celtics next week"), L("NOVEMBER 19, 2026 *8:00 P.M ET"), L("Nov. 19  @ Minnesota  8:00pm")] }] }, "NYK");
  const one = readMeta({ pages: [{ lines: [L("BOSTON CELTICS (9-5) vs. DENVER NUGGETS (10-4)"), L("WEDNESDAY, NOVEMBER 18, 2026"), L("LAST GAME: NOV. 16 VS. CHICAGO BULLS")] }] }, "BOS");
  ok(min.gameDate === "2026-11-19" && min.opponent === "NYK" && nyk.gameDate === "2026-11-19" && nyk.opponent === "MIN" && nyk.opponentEvidence === "NEW YORK KNICKS (8-6) at MINNESOTA TIMBERWOLVES (11-4)"
    && noJoin.opponent === "MIN" && one.opponent === "DEN",
    "notes (0.124): \"TIMBERWOLVES (11-4) VS.NEW YORK KNICKS\" with no space after VS. and \"NEW YORK KNICKS (8-6) at\" with the opponent two lines down are both read as tonight's game (they were read as vs. Portland and vs. Orlando)",
    JSON.stringify([min.opponent, min.opponentEvidence, nyk.opponent, nyk.opponentEvidence, noJoin.opponent, noJoin.opponentEvidence, one.opponent]));
  // the guard, with the statuses of 11/19: the 10:48 AM list, the 4:52 PM build as it was read, and a build that really lost a team
  const W = (st, generatedAt = "2026-11-19T15:48:22.252Z") => ({ today: "2026-11-19", generatedAt, teams: Object.entries(st).map(([team, notesStatus]) => ({ team, notesStatus })) });
  const am = W({ GSW: "current", MEM: "stale", POR: "current", MIL: "stale", NYK: "conflict", MIN: "stale", LAC: "current", SAS: "current" });
  const pm = W({ GSW: "current", MEM: "current", POR: "current", MIL: "current", NYK: "conflict", MIN: "conflict", LAC: "current", SAS: "current" });
  const lostOne = W({ GSW: "current", MEM: "current", POR: "current", MIL: "current", NYK: "conflict", MIN: "unreachable", LAC: "current", SAS: "current" });
  const g1 = notesGuard(am, pm, "2026-11-19"), g2 = notesGuard(am, lostOne, "2026-11-19"), g3 = notesGuard(am, lostOne, "2026-11-20"), g4 = notesGuard(null, lostOne, "2026-11-19");
  const oldRule = (w) => w.teams.filter((t) => t.notesStatus === "current" || t.notesStatus === "stale").length;
  ok(HAS_NOTES.join() === "current,stale,conflict" && oldRule(am) === 7 && oldRule(pm) === 6 && notesRead(am) === 8 && notesRead(pm) === 8 && g1.keep === false && g1.text === null
    && g2.keep === true && g2.lost.length === 1 && g2.lost[0].team === "MIN" && g2.lost[0].was === "stale" && g2.lost[0].now === "unreachable"
    && g2.text === "this build could not read the notes for MIN (unreachable); the published Watch List built at 10:48 AM ET has them and was kept, so nothing newer from the other teams' notes is showing"
    && g3.keep === false && g4.keep === false,
    "build (0.124): a team whose notes went from yesterday's file to today's with the opponent in doubt still has notes, so the afternoon build of 11/19 is published (the old count, 7 against 6, threw it away); a team that really cannot be read keeps the published list, and the note names the team and the time",
    JSON.stringify([g1, g2.text, g3.keep, g4.keep]));
}

// ---------- 0.125: the build checks its own output; a dead streak cannot lead; "to watch" without players who are out ----------
{
  // the user, 6:33 PM 11/19: "can you run a diagnostic that may find these issues and correct them now rather than having them sit dormant."
  const { selfCheck, CHECK_NAMES } = await import("../src/site/selfcheck.js");
  const { briefing } = await import("../src/anticipate/briefing.js");
  const T0 = Date.parse("2026-11-19T23:20:00Z"), at = (m) => new Date(T0 + m * 60e3).toISOString();
  const good = () => ({
    watch: { generatedAt: at(1), today: "2026-11-19", games: [{ awayTri: "GSW", homeTri: "MEM" }], teams: [{ team: "GSW", notesStatus: "current", items: [{ player: "Stephen Curry", label: "points" }] }, { team: "MEM", notesStatus: "current", items: [] }] },
    tonight: { generatedAt: at(2), today: "2026-11-19", games: [{ away: "GSW", home: "MEM", lines: [{ kind: "injury", team: "GSW", player: "Stephen Curry", text: "Stephen Curry OUT" }, { kind: "find", team: "MEM", player: "Cam Spencer", text: "Cam Spencer leads the NBA in true shooting" }] }] },
    briefing: { generatedAt: at(2), today: "2026-11-19", top: [{ kind: "find", team: "MEM", player: "Cam Spencer", text: "Cam Spencer leads the NBA in true shooting" }, { kind: "team", team: "MEM", text: "MEM is 11-4" }], deep: [], lastNight: [] },
    injuries: { generatedAt: at(2), date: "2026-11-19", players: [{ team: "GSW", name: "Stephen Curry", status: "Out" }, { team: "GSW", name: "Jimmy Butler III", status: "Doubtful" }, { team: "MEM", name: "Cam Spencer", status: "Questionable" }] },
    oddlive: { generatedAt: at(2), before: "2026-11-19" }, prep: { generatedAt: at(2), today: "2026-11-19" } });
  const run = (edit, extra = {}) => { const data = good(); edit?.(data); return selfCheck({ data, buildStart: T0, ...extra }); };
  const kinds = (r) => r.map((c) => c.check).join(",");
  const clean = run();
  const stale = run((d) => { d.oddlive.generatedAt = at(-200); }), staleKept = run((d) => { d.watch.generatedAt = at(-400); }, { keptFiles: ["watch"] });
  const day = run((d) => { d.oddlive.before = "2026-11-18"; d.prep.today = "2026-11-18"; });
  const out = run((d) => { d.briefing.top.unshift({ kind: "history", team: "GSW", player: "Stephen Curry", text: "GSW notes: 2nd all-time · Stephen Curry made his first 51" }); d.tonight.games[0].lines.unshift({ kind: "season", team: "GSW", player: "Jimmy Butler", text: "Jimmy Butler this season" }); });
  const quest = run((d) => { d.briefing.top[0].player = "Cam Spencer"; });   // questionable is not out
  const ended = run((d) => { d.briefing.top.unshift({ kind: "history", team: "SAS", player: "Victor Wembanyama", text: "SAS notes: Streak over · Victor Wembanyama became the 7th player" }); });
  const junk = run((d) => { d.tonight.games[0].lines.push({ kind: "find", team: "MEM", text: "MEM averages NaN points" }); });
  const empty = run((d) => { d.tonight.games[0].lines = []; d.briefing.top = []; });
  const conflict = run((d) => { d.watch.teams[1].notesStatus = "conflict"; d.watch.teams[1].notesWhy = "notes are dated 2026-11-19 but name POR as the opponent"; });
  const other = run(null, { copies: [{ name: "situations/oddlines.js", same: false }, { name: "anticipate/tonight.js", same: true }], bridge: { running: 26, published: 25 }, said: ["situations: odd lines not run: boom"] });
  ok(CHECK_NAMES.length === 11 && clean.length === 0 && kinds(stale) === "stale" && /oddlive\.json was not rebuilt by this build: it is from 11\/19, 3:00 PM ET/.test(stale[0].text) && staleKept.length === 0
    && kinds(day) === "day,day" && kinds(out) === "out,out" && /#1 in the briefing is about Stephen Curry, who is listed out tonight/.test(out[0].text) && /line 1 of GSW at MEM \(a pre-game card in NBA Live\) is about Jimmy Butler, who is listed doubtful/.test(out[1].text)
    && quest.length === 0 && kinds(ended) === "ended" && kinds(junk) === "junk" && /MEM averages NaN/.test(junk[0].text) && kinds(empty) === "empty,empty" && kinds(conflict) === "conflict" && kinds(other) === "copies,bridge,said",
    "self-check (0.125): a clean build finds nothing; a file the build did not rewrite, a file for another day, a top line about a player who is out, a streak that is over, a broken value, a game with no lines, notes set aside, a stale copy, a bridge version apart and a step's complaint are each named in a sentence (a file the guard kept and a questionable player are not)",
    JSON.stringify({ clean, stale, day: kinds(day), out: out.map((c) => c.text.slice(0, 70)), quest, ended: kinds(ended), junk: kinds(junk), empty: kinds(empty), conflict: kinds(conflict), other: kinds(other) }));
  // 0.145.0 (the consistency audit, 11/24): one fact, two values on two pages.
  {
    const { agreement } = await import("../src/site/selfcheck.js");
    const base = () => ({
      watch: { teams: [{ team: "BOS", items: [{ espnId: "4251", player: "Paul George", stat: "fg3m", target: 2500, current: 2495, pTonight: 0.194 }] }] },
      records: { items: [{ id: "4251", who: "Paul George", stat: "fg3m", label: "3-pointers", target: 2500, now: 2495, pTonight: 0.194 }, { id: "3112335", who: "Nikola Jokić", stat: "ast", target: 129, now: 118, pTonight: 0.27 }] },
      standings: { East: [{ tri: "IND", w: 6, l: 12, home: "3-5", road: "3-6", last10: "3-7", streak: "L2" }], West: [] },
      situations: { teams: { IND: { splits: { all: { w: 6, l: 12 }, home: { w: 3, l: 5 }, road: { w: 3, l: 6 } }, last10: { w: 3, l: 7 }, streak: "L2" } } },
      form: { players: { 4397475: { name: "AJ Green", g: Array(17).fill([]) }, 3112335: { name: "Nikola Jokić", g: [] } } },
      eligibility: { players: [{ id: "4397475", name: "AJ Green", apps: 17 }] }, national: { players: [{ id: "4397475", name: "AJ Green", nat: { gp: 2 }, other: { gp: 15 } }] },
      games: { games: Array(258).fill({}) }, "q4-players": { games: 258 }, flowstats: { games: 258 },
      briefing: { top: [{ player: "Nikola Jokić" }], deep: [], finds: [] }, trends: { streaks: [{ name: "Nikola Jokić" }] } });
    const clean = agreement(base());
    const d = base();
    d.watch.teams[0].items[0].pTonight = 0.32; d.situations.teams.IND.splits.road = { w: 3, l: 7 }; d.eligibility.players[0].apps = 18; d["q4-players"].games = 257; d.trends.streaks[0].name = "Nikola Jokic";
    const dirty = agreement(d);
    ok(clean.length === 0 && dirty.length === 5 && /Paul George 2,500 3-pointers: 19% on the Records page, 32% on the Watch List/.test(dirty[0]) && /IND road 3-6 in the standings, 3-7 in Team situations/.test(dirty[1])
      && /AJ Green \(17 hot hand, 18 award eligibility, 17 national TV\)/.test(dirty[2]) && /4th-quarter tables count 257 of the season's 258 games/.test(dirty[3]) && /"Nikola Jokić" \(the briefing\) and "Nikola Jokic" \(the Streaks page\)/.test(dirty[4]),
      "0.145.0: the build's agreement check: pages that agree find nothing; two chances, two road records, two games-played counts, a game missing from a table and two spellings are each named", JSON.stringify({ clean, dirty }));
  }
  // the briefing: a notes streak that is over cannot be a top line; an old sentence with a new tag in front is not "new today"
  const games = [{ away: "LAC", home: "SAS" }], H = (o) => ({ kind: "history", team: "SAS", score: 4.8, ...o });
  const B = briefing({ games, today: "2026-11-19", stars: { "Victor Wembanyama": 1 }, seen: {}, all: [
    H({ player: "Victor Wembanyama", text: "SAS notes: Streak over · Victor Wembanyama became the 7th player in NBA history", score: 3.3, ended: true, firstSeen: "2026-11-12" }),
    H({ player: "Stephon Castle", text: "SAS notes: Castle has 10+ assists in three straight", firstSeen: "2026-11-19" }),
    H({ player: "Devin Vassell", text: "SAS notes: 2nd in team history · Vassell passed Manu Ginobili", firstSeen: "2026-11-10" }),
    { kind: "team", team: "LAC", text: "LAC has lost 4 straight", score: 3 }] });
  const byP = Object.fromEntries(B.top.map((l) => [l.player || l.team, l]));
  const src = (f) => fs.readFileSync(path.join(root, ...f), "utf8"), tn = src(["src", "anticipate", "tonight.js"]), tp = src(["docs", "trends.html"]), ci = src(["scripts", "ci.js"]), ix = src(["docs", "index.html"]);
  ok(B.top.length === 3 && !byP["Victor Wembanyama"] && !B.deep.some((l) => l.player === "Victor Wembanyama") && byP["Stephon Castle"].age === 0 && byP["Devin Vassell"].age === 9 && byP["Stephon Castle"].rank > byP["Devin Vassell"].rank
    && B.seen["history|SAS|Devin Vassell|sas notes: #nd in team history · vassell passed manu ginobili"] === "2026-11-10"
    && /const ended = f\.tag === "Streak over";/.test(tn) && /score: Math\.min\(4\.8, f\.score\) - \(ended \? 1\.5 : 0\)/.test(tn) && tn === src(["docs", "lib", "anticipate", "tonight.js"]) && src(["src", "anticipate", "briefing.js"]) === src(["docs", "lib", "anticipate", "briefing.js"]),
    "briefing (0.125; \"Streak over · Wembanyama…\" was #1 on 11/19): a notes streak the box scores say is over is never a top line or a deep cut and ranks 1.5 lower in its game; a notes line is as old as the notes' first printing of it, whatever tag is put in front",
    JSON.stringify([B.top.map((l) => [l.player || l.team, l.age, l.rank]), Object.keys(B.seen)]));
  ok(/const st = \(a\) => \(INJ && INJ\.date === W\.date \? INJSTATUS/.test(tp) && /id="oddwatchout"/.test(tp) && /fetch\("data\/injuries\.json"/.test(tp)
    && /const \{ selfCheck \} = await import\("\.\.\/src\/site\/selfcheck\.js"\)/.test(ci) && /\.\.\.\(checks\.length \? \{ checks \} : \{\}\)/.test(ci) && !/not \(\?:written\|read\|updated\|built\)/.test(ci)
    && /for \(const t of new Set\(\(h\?\.checks \|\| \[\]\)\.map\(\(c\) => c\.text\)\)\) notes\.push\(`Build check: \$\{esc\(t\)\}`\)/.test(ix) && fs.existsSync(path.join(root, "tools", "diagnose.mjs")),
    "0.125: the odd lines' \"to watch tonight\" leaves out players listed out or doubtful and says who; every complaint a step prints reaches the health note (not only ones worded a certain way); the Watch List prints the build's own checks in its warning box; tools/diagnose.mjs is the by-hand version");
}

// ---------- 0.126: a star's absence up top; one shift line; the notes guard keeps one team, not the list ----------
{
  const { briefing, STAR_OUT, KIND_CAP } = await import("../src/anticipate/briefing.js");
  const { tonightCandidates } = await import("../src/anticipate/tonight.js");
  const { keepLostTeams } = await import("../src/site/notes-guard.js");
  const games = [{ away: "GSW", home: "MEM" }, { away: "POR", home: "MIL" }], stars = { "Stephen Curry": 0.86, "Anthony Edwards": 1, "Tyler Herro": 0.7 };
  const inj = (o) => ({ kind: "injury", status: "Out", missed: 0, score: 5, ...o });
  const B = briefing({ games, today: "2026-11-19", stars, seen: {}, all: [
    inj({ team: "GSW", who: ["Stephen Curry", "Draymond Green"], text: "Stephen Curry and Draymond Green both out: GSW 5-7 without both", score: 5.04, missed: 0 }),
    inj({ team: "GSW", who: ["Stephen Curry"], text: "Stephen Curry OUT (right oblique tear): GSW 1-4 without him", score: 4.9, missed: 3 }),     // the same player again: one line
    inj({ team: "GSW", who: ["Draymond Green"], text: "Draymond Green OUT: GSW 1-1 without him", score: 4.44 }),                               // not a star: stays in the game card
    inj({ team: "MIL", who: ["Kyle Kuzma", "Myles Turner"], text: "Kyle Kuzma and Myles Turner both out", score: 5.3 }),
    inj({ team: "MEM", who: ["Anthony Edwards"], status: "Questionable", text: "Anthony Edwards QUESTIONABLE", score: 5.5 }),                  // questionable is not an absence
    { kind: "rest", team: "MIL", text: "MIL on a back-to-back", score: 6 },
    { kind: "shift", team: "MIL", player: "Tyler Herro", text: "Tyler Herro is shooting 17.6% from three over his last 6 games", score: 4.5 },
    { kind: "shift", team: "MEM", player: "Cam Spencer", text: "Cam Spencer is averaging 31.7 minutes over his last 3 games", score: 4.4 },
    { kind: "shift", team: "POR", player: "Kris Dunn", text: "Kris Dunn is averaging 21.4 minutes over his last 5 games", score: 4.3 },
    { kind: "team", team: "MIL", text: "MIL is 1-14: its worst start through 15 games in franchise history", score: 3.9 }] });
  const txt = B.top.map((l) => l.text.slice(0, 24));
  const old = briefing({ games, today: "2026-11-19", stars, seen: {}, all: [inj({ team: "MEM", who: ["Anthony Edwards"], text: "Anthony Edwards OUT (knee): MIN 8-3 without him", score: 4.6, missed: 11 }), inj({ team: "GSW", who: ["Stephen Curry"], text: "Stephen Curry OUT", score: 4.6, missed: 0 })] });
  const cand = tonightCandidates({ watch: { today: "2026-11-19", games: [{ id: "1", awayTri: "GSW", homeTri: "MEM" }], teams: [] }, injuries: { date: "2026-11-19", players: [], impact: [{ team: "GSW", name: "Stephen Curry", status: "Out", missedInARow: 3, text: "Stephen Curry OUT", score: 4.9 }, { team: "GSW", names: ["Stephen Curry", "Draymond Green"], text: "both out", score: 5 }, { team: "GSW", name: "Draymond Green", status: "Out", missedInARow: 0, text: "Draymond Green OUT", score: 4.4 }] } }).all.filter((l) => l.kind === "injury");
  ok(STAR_OUT === 0.6 && KIND_CAP.shift === 1 && KIND_CAP.injury === 2 && B.top.length === 3 && B.top[0].kind === "injury" && /^Stephen Curry and Draymond Green both out/.test(B.top[0].text) && B.top[0].prom === 0.86 && B.top[0].age === 0
    && B.top.filter((l) => l.kind === "injury").length === 1 && B.top.filter((l) => l.kind === "shift").length === 1 && B.top.find((l) => l.kind === "shift").player === "Tyler Herro" && B.top.some((l) => /^MIL is 1-14/.test(l.text))
    && old.top.length === 2 && old.top[0].who[0] === "Stephen Curry" && old.top[1].age === 22 && old.top[1].rank < old.top[0].rank - 1
    && cand.length === 3 && cand[0].who.join() === "Stephen Curry" && cand[0].missed === 3 && cand[0].status === "Out" && cand[1].who.length === 2 && cand[1].status === "Out" && cand[1].missed === 0 && !cand.some((l) => "player" in l),
    "briefing (0.126): a star listed out or doubtful can be a top line (one line a player; a role player's absence, a questionable star and rest stay in the game cards; an absence 11 games old ranks as old news); one shift line in the top ten, so a team's record line is not pushed out by a second",
    JSON.stringify([txt, B.top.map((l) => [l.kind, l.rank, l.age]), old.top.map((l) => [l.who, l.age, l.rank]), cand.map((l) => [l.who, l.status, l.missed])]));
  // the guard: one team's download fails in the evening build
  const W = (st, at) => ({ today: "2026-11-19", generatedAt: at, games: [1, 2], teams: Object.entries(st).map(([team, [notesStatus, n]]) => ({ team, notesStatus, items: Array.from({ length: n }, (_, i) => ({ player: `${team} ${i}` })) })) });
  const before = W({ GSW: ["current", 3], MEM: ["stale", 2], MIN: ["current", 4] }, "2026-11-19T15:48:22.252Z"), after = W({ GSW: ["current", 5], MEM: ["current", 6], MIN: ["unreachable", 0] }, "2026-11-19T22:00:00.000Z");
  const F = (o) => ({ today: "2026-11-19", teams: Object.fromEntries(Object.entries(o).map(([t, n]) => [t, Array.from({ length: n }, () => ({ text: "x" }))])), status: Object.fromEntries(Object.keys(o).map((t) => [t, { read: o[t] > 0 }])), trimmed: [] });
  const K = keepLostTeams({ before, after, beforeFacts: F({ GSW: 2, MEM: 1, MIN: 7 }), afterFacts: F({ GSW: 3, MEM: 4, MIN: 0 }), today: "2026-11-19" });
  const byT = Object.fromEntries(K.watch.teams.map((t) => [t.team, t]));
  const none = keepLostTeams({ before, after: W({ GSW: ["current", 5], MEM: ["current", 6], MIN: ["conflict", 0] }, "x"), today: "2026-11-19" }), otherDay = keepLostTeams({ before: { ...before, today: "2026-11-18" }, after, today: "2026-11-19" });
  const ci = fs.readFileSync(path.join(root, "scripts", "ci.js"), "utf8");
  ok(K.lost.length === 1 && K.lost[0].team === "MIN" && K.lost[0].now === "unreachable" && byT.MIN.notesStatus === "current" && byT.MIN.items.length === 4 && byT.MIN.notesKept === "10:48 AM ET"
    && byT.GSW.items.length === 5 && byT.MEM.notesStatus === "current" && byT.MEM.items.length === 6 && !byT.GSW.notesKept && K.watch.generatedAt === after.generatedAt
    && K.facts.teams.MIN.length === 7 && K.facts.teams.MEM.length === 4 && K.facts.status.MIN.read === true
    && K.text === "this build could not read the notes for MIN (unreachable); that team's notes and milestones are from the 10:48 AM ET build, and everything else is new"
    && none.lost.length === 0 && none.watch.teams[2].notesStatus === "conflict" && otherDay.lost.length === 0
    && /keepLostTeams\(\{ before, after, beforeFacts, afterFacts: readJson\(factsFile\), today \}\)/.test(ci) && !/kept the published data/.test(ci) && /if \(h\?\.keptTeams\) notes\.push/.test(fs.readFileSync(path.join(root, "docs", "index.html"), "utf8")),
    "build (0.126): when one team's notes cannot be read in a later build, that team keeps its published milestones and history lines and every other team's are new (the whole list used to be kept); a conflict is not a loss; nothing is kept from another day",
    JSON.stringify([K.lost, K.text, Object.fromEntries(Object.entries(byT).map(([t, v]) => [t, [v.notesStatus, v.items.length, v.notesKept]]))]));
}

// ---------- 0.127: how often an "as it stands" line holds ----------
{
  const M = await import("../src/situations/oddlines.js");
  const H = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "odd-lines-hold.json"), "utf8")), A = H.t.ALL, late = M.TEMPLATES.map((t) => t.id).filter((id) => M.liveKind(id) === "late");
  const sums = H.marks.map((m) => Object.entries(H.t).filter(([k]) => k !== "ALL").reduce((a, [, e]) => a.map((v, i) => v + e[m][i]), [0, 0, 0, 0, 0, 0]));
  const rising = H.marks.every((m, i) => i === 0 || A[m][1] / A[m][0] > A[H.marks[i - 1]][1] / A[H.marks[i - 1]][0]);
  const tp = fs.readFileSync(path.join(root, "docs", "trends.html"), "utf8"), sj = fs.readFileSync(path.join(root, "scripts", "situations.js"), "utf8");
  ok(H.marks.join() === "300,180,120,60" && H.from === "2002-10-29" && H.through === "2026-04-12" && H.counts.games === 28853 && H.counts.overtime === 1704 && H.skipped.join() === "zeromin,nothing"
    && A[300].join() === "3528,2462,2273,1288,263,101" && H.marks.every((m, i) => sums[i].join() === A[m].join()) && rising
    && Object.keys(H.t).filter((k) => k !== "ALL").every((k) => late.includes(k) && M.LATE_NAMES[k]) && late.every((id) => M.LATE_NAMES[id]) && Object.values(H.t).every((e) => H.marks.every((m) => e[m][1] <= e[m][0] && e[m][3] <= e[m][2] && e[m][2] <= e[m][0]))
    && !/oddhold|renderOddHold/.test(tp) && !/odd-lines-hold/.test(sj) && fs.existsSync(path.join(root, "tools", "odd-games", "late", "eval-late.mjs")),
    "odd lines (0.127): the hold table (play-by-play of 28,853 games since 2002-03): of 3,528 lines standing with five minutes left 2,462 held (70%), more with less time left; every row is a rule one play can undo, the rows add up to the total, kept on file only (0.129: off the page, \"I don't need to see this table\"; 0.130: out of NBA Live's data, \"I don't need as it stands\")",
    JSON.stringify([A, sums[0], rising]));
}

// ---------- 0.72: the full diagnostic (11/15): what could break, and what was quietly wrong ----------
{
  // The Knicks' 11/15 notes: an "on this date" line named the Spurs and carried today's month and day.
  const { readMeta } = await import("../src/notes/meta.js");
  const L = (text) => ({ text, cells: [{ text }] });
  const doc = { pages: [{ lines: [L("NEW YORK KNICKS (8-5)"), L("TORONTO RAPTORS (5-7)"), L("NOVEMBER 15, 2026 *6:00 P.M ET"), L("Nov. 15  @ Toronto  6:00pm"),
    L("November 15,2012: Knicks ride a 27-11 rally over the game's final 7:02 for a stunning win over the Spurs at San Antonio.")] }] };
  const m = readMeta(doc, "NYK");
  ok(m.gameDate === "2026-11-15" && m.opponent === "TOR", "notes (0.72): an \"on this date\" line from another year doesn't name tonight's opponent (the Knicks' notes were read as vs. SAS)", JSON.stringify([m.gameDate, m.opponent, m.opponentEvidence]));
  // Initials with and without periods.
  const { strictKey } = await import("../src/records/guide.js");
  ok(strictKey("A.J. Green") === strictKey("AJ Green") && nameKey("P.J. Washington Jr.") === nameKey("PJ Washington") && strictKey("Gary Payton II") !== strictKey("Gary Payton")
    && nameKey("D. Mitchell") === "d. mitchell" && sameName("D. Mitchell", "Donovan Mitchell") && sameName("R. Westbrook", "Russell Westbrook"),
    "names (0.72): \"A.J. Green\" (the Guide) and \"AJ Green\" (ESPN) are one player; suffixes and single initials still work", JSON.stringify([strictKey("A.J. Green"), nameKey("P.J. Washington Jr."), nameKey("D. Mitchell")]));
  // Notes players with no ESPN id who aren't on the roster (the Kings' notes still tracked DeRozan and Westbrook).
  const { moveTraded } = await import("../src/site/build.js");
  const it = (player, o = {}) => ({ player, espnId: null, origin: "notes", stat: "pts", label: "points", target: 500, ...o });
  const roster12 = ["Domantas Sabonis", "Nicolas Claxton", "Keegan Murray", "A B", "C D", "E F", "G H", "I J", "K L", "M N", "O P", "Q R"];
  const teams = [{ team: "SAC", items: [it("D. DeRozan"), it("D. DeRozan", { stat: "blk" }), it("R. Westbrook"), it("D. Sabonis"), it("Nic Claxton"), it("Keegan Murray", { espnId: "9" })], problems: [] }];
  moveTraded(teams, { SAC: new Set(["9"]) }, { SAC: roster12 });
  ok(teams[0].items.map((i) => i.player).join() === "D. Sabonis,Nic Claxton,Keegan Murray" && teams[0].problems.some((p) => /^D\. DeRozan is in SAC's notes but not on its roster: 2 milestones left out/.test(p)),
    "milestones (0.72): a notes player with no ESPN id and no one by that name on the roster is left out; an initial or a short first name still matches", JSON.stringify(teams[0]));
  // The results store against ESPN's records.
  const { recordCheck } = await import("../src/situations/results.js");
  const { readScoreboard } = await import("../src/espn/parse.js");
  const rowsR = [{ id: "1", h: "BOS", a: "DAL", hs: 110, as: 100 }, { id: "2", h: "DAL", a: "BOS", hs: 90, as: 99 }, { id: "3", h: "NYK", a: "TOR", hs: 100, as: 90 }];
  const sbg = (o) => ({ seasonType: 2, state: "pre", final: false, ...o });
  const off = recordCheck(rowsR, [sbg({ id: "9", homeTri: "BOS", awayTri: "DAL", homeRec: [2, 0], awayRec: [0, 2] }), sbg({ id: "8", homeTri: "NYK", awayTri: "TOR", homeRec: [2, 0], awayRec: [0, 2] }),
    sbg({ id: "7", homeTri: "MIA", awayTri: "ORL", state: "post", final: true, homeScore: 100, awayScore: 90, homeRec: [1, 0], awayRec: [0, 1] }), sbg({ id: "6", homeTri: "LAL", awayTri: "PHX", state: "in", homeRec: [5, 5], awayRec: [5, 5] })]);
  const sbj = { events: [{ id: "1", date: "2026-11-15T23:00Z", season: { type: 2 }, competitions: [{ status: { type: { completed: false, state: "pre" } }, competitors: [
    { homeAway: "home", team: { displayName: "Boston Celtics" }, records: [{ type: "total", summary: "10-2" }, { type: "home", summary: "6-1" }] }, { homeAway: "away", team: { displayName: "Dallas Mavericks" }, records: [] }] }] }] };
  const g0 = readScoreboard(sbj).games[0];
  ok(off.map((x) => `${x.team} ${x.espn} ${x.store}`).join() === "NYK 2-0 1-0,TOR 0-2 0-1" && g0.homeRec.join("-") === "10-2" && g0.awayRec === null,
    "results (0.72): the store is checked against ESPN's team records (a game lost on a bad read shows as a difference); games in progress are skipped, a final not yet stored is counted", JSON.stringify([off, g0.homeRec]));
}
{
  // scripts/ci.js: one failed step no longer hides (green) or stops the others; the health note says what happened.
  const { spawnSync } = await import("node:child_process");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ncc-ci-"));
  fs.mkdirSync(path.join(tmp, "scripts")); fs.mkdirSync(path.join(tmp, "docs", "data"), { recursive: true });
  fs.copyFileSync(path.join(root, "scripts", "ci.js"), path.join(tmp, "scripts", "ci.js"));
  fs.mkdirSync(path.join(tmp, "src", "site"), { recursive: true }); for (const f of ["notes-guard.js", "selfcheck.js"]) fs.copyFileSync(path.join(root, "src", "site", f), path.join(tmp, "src", "site", f));   // 0.124, 0.125: the guard's rule and the self-check are modules
  fs.writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');
  const watchOld = JSON.stringify({ today: "2026-11-15", teams: [{ notesStatus: "current" }], v: "old" });
  const stub = (name, body) => fs.writeFileSync(path.join(tmp, "scripts", name), body);
  const runCi = () => { fs.writeFileSync(path.join(tmp, "docs", "data", "watch.json"), watchOld); const r = spawnSync(process.execPath, ["scripts/ci.js", "build", "--today", "2026-11-15"], { cwd: tmp, encoding: "utf8" }); return { code: r.status, health: JSON.parse(fs.readFileSync(path.join(tmp, "docs", "data", "health.json"), "utf8")), watch: JSON.parse(fs.readFileSync(path.join(tmp, "docs", "data", "watch.json"), "utf8")) }; };
  const good = `import fs from "node:fs"; fs.writeFileSync("docs/data/watch.json", JSON.stringify({ today: "2026-11-15", teams: [{ notesStatus: "current" }], v: "new" }));`;
  stub("tonight.js", good); stub("situations.js", `console.error("prep stats not written: boom"); process.exit(1);`); stub("flow.js", `console.log("ok");`);
  const A = runCi();
  stub("tonight.js", `import fs from "node:fs"; fs.writeFileSync("docs/data/watch.json", "{}"); process.exit(1);`); stub("situations.js", `console.log("ok");`);
  const B = runCi();
  stub("tonight.js", good);
  const C = runCi();
  // 0.126: the build itself, with one team's notes unreadable: that team is kept from the published list, the rest is new, the run is green
  const dd = path.join(tmp, "docs", "data"), T = (team, notesStatus, n) => ({ team, notesStatus, items: Array.from({ length: n }, (_, i) => ({ player: `${team} ${i}` })) });
  stub("tonight.js", `import fs from "node:fs"; fs.writeFileSync("docs/data/watch.json", JSON.stringify({ today: "2026-11-15", generatedAt: new Date().toISOString(), teams: [${JSON.stringify(T("GSW", "current", 5))}, ${JSON.stringify(T("MIN", "unreachable", 0))}] })); fs.writeFileSync("docs/data/notes-facts.json", JSON.stringify({ today: "2026-11-15", teams: { GSW: [1, 2, 3], MIN: [] }, status: { GSW: { read: true }, MIN: { read: false } } }));`);
  fs.writeFileSync(path.join(dd, "notes-facts.json"), JSON.stringify({ today: "2026-11-15", teams: { GSW: [1], MIN: [1, 2, 3, 4] }, status: { GSW: { read: true }, MIN: { read: true } } }));
  fs.writeFileSync(path.join(dd, "watch.json"), JSON.stringify({ today: "2026-11-15", generatedAt: "2026-11-15T15:48:00.000Z", teams: [T("GSW", "stale", 2), T("MIN", "current", 4)] }));
  const rD = spawnSync(process.execPath, ["scripts/ci.js", "build", "--today", "2026-11-15"], { cwd: tmp, encoding: "utf8" });
  const D = { code: rD.status, health: JSON.parse(fs.readFileSync(path.join(dd, "health.json"), "utf8")), watch: JSON.parse(fs.readFileSync(path.join(dd, "watch.json"), "utf8")), facts: JSON.parse(fs.readFileSync(path.join(dd, "notes-facts.json"), "utf8")) };
  fs.rmSync(path.join(dd, "notes-facts.json"));
  ok(D.code === 0 && D.watch.teams[0].notesStatus === "current" && D.watch.teams[0].items.length === 5 && D.watch.teams[1].notesStatus === "current" && D.watch.teams[1].items.length === 4 && D.watch.teams[1].notesKept === "10:48 AM ET"
    && D.facts.teams.GSW.length === 3 && D.facts.teams.MIN.length === 4 && D.facts.status.MIN.read === true && !D.health.kept && !(D.health.checks || []).length
    && D.health.keptTeams === "this build could not read the notes for MIN (unreachable); that team's notes and milestones are from the 10:48 AM ET build, and everything else is new",
    "build (0.126), run for real with stand-in steps: one team's notes unreadable keeps that team from the published list (milestones and history lines), publishes the other team's new ones, ends green and says so in the health note", JSON.stringify([D.code, D.health, D.watch.teams.map((t) => [t.team, t.notesStatus, t.items.length]), rD.stderr.slice(0, 200)]));
  fs.rmSync(tmp, { recursive: true, force: true });
  ok(A.code === 1 && A.watch.v === "new" && A.health.steps.map((x) => `${x.step}:${x.ok}`).join() === "tonight:true,situations:false,flow:true" && /not written: boom/.test(A.health.steps[1].notes?.[0] || "")
    && B.code === 1 && B.watch.v === "old" && B.health.steps.map((x) => `${x.step}:${x.ok}`).join() === "tonight:false,situations:true,flow:true"
    && C.code === 0 && C.health.steps.every((x) => x.ok) && C.health.today === "2026-11-15",
    "build (0.72): a failed step ends the run red, the other steps still run, the published Watch List is kept when the notes step fails, and health.json says which step and why", JSON.stringify([A.code, A.health.steps, B.code, B.watch.v, C.code]));
}

// ---------- 0.71: the user's second 11/15 review (pages, data) ----------
{
  const { moveTraded } = await import("../src/site/build.js");
  const it = (o) => ({ player: "Nique Clifford", espnId: "77", origin: "notes", stat: "pts", label: "points", target: 700, ...o });
  const teams = [{ team: "SAC", items: [it({}), it({ espnId: "5", player: "Kings Guy" })], problems: [] }, { team: "OKC", items: [], problems: [] }, { team: "BOS", items: [it({ espnId: "88", player: "Gone Guy" })], problems: [] }];
  moveTraded(teams, { SAC: new Set(["5"]), OKC: new Set(["77"]), BOS: new Set([]) });
  ok(teams[0].items.length === 1 && teams[1].items[0]?.player === "Nique Clifford" && /now with OKC/.test(teams[1].items[0].note) && !teams[2].items.length && /not on its roster/.test(teams[2].problems[0]),
    "milestones (0.71): a traded player's notes milestones go with him to tonight's team, or are left out (with a note)", JSON.stringify(teams));
  const S = await import("../src/anticipate/seasonlong.js");
  const T30 = ["ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"];
  const rows = T30.map((t, i) => ({ id: `r${i}`, d: "2026-11-01", h: t, a: T30[(i + 1) % 30], hs: 100, as: 99 }));
  const pg = Object.fromEntries(T30.filter((t) => t !== "BOS").map((t, i) => [`p${i}`, [{ d: "2026-11-01", team: "X", opp: t, pts: 31 }]]));
  pg.flagg = [{ d: "2026-11-02", team: "DAL", opp: "UTA", pts: 43 }];
  const dl = S.defenseLines({ pg, rows, names: { flagg: "Cooper Flagg" }, slate: [{ away: "DAL", home: "BOS" }] });
  ok(dl.length === 1 && /^BOS hasn't allowed a 30-point game this season \(\d+ games\): the only team; \d+ across the league\. DAL's 30-point scorers: Cooper Flagg \(1, high 43\)/.test(dl[0].text),
    "defense (0.71): the only team that hasn't allowed a 30-point game is a Watch List line the day it plays, with the opponent's 30-point scorers", JSON.stringify(dl));
  const { tonightCandidates } = await import("../src/anticipate/tonight.js");
  const st = (team, home, road) => ({ team, overall: [home[0] + road[0], home[1] + road[1]], home, road });
  const records = { today: "2026-11-20", cup: { tonight: [{ away: "BKN", home: "ORL" }], standings: [st("ORL", [8, 0], [5, 3]), st("LAL", [9, 2], [5, 2]), st("BKN", [2, 5], [0, 4])] } };
  const C = tonightCandidates({ watch: { today: "2026-11-20", games: [{ id: "1", awayTri: "BKN", homeTri: "ORL" }], teams: [] }, records }).all.filter((l) => l.kind === "cup");
  ok(C.some((l) => l.team === "ORL" && /^ORL is 8-0 at home in NBA Cup games all-time: the only team unbeaten at home; tonight is a home Cup game/.test(l.text))
    && C.some((l) => l.team === "BKN" && /0-4 on the road.*the only team without a win on the road/.test(l.text)),
    "cup (0.71): on a Cup night, a team unbeaten (or winless) at home or on the road in Cup history is a Watch List line", JSON.stringify(C));
  const { restData } = await import("../src/situations/rest.js");
  const box = [40, 85, 12, 35, 8, 10, 10, 34, 25, 8, 5, 15, 20];
  const g = (d, h, a) => ({ d, h, a, hs: 110, as: 100, hb: box, ab: box });
  const R = restData({ games: [g("2026-11-01", "AAA", "CCC"), g("2026-11-01", "BBB", "DDD"), g("2026-11-02", "AAA", "BBB"), g("2026-11-05", "CCC", "DDD"), g("2026-11-06", "AAA", "DDD")] });
  const A = R.facing.find((x) => x.tri === "AAA");
  ok(A.vs.n === 2 && A.both.n === 1 && A.rested.n === 1, "rest (0.71): games against a tired opponent split by the team's own rest (both on a back-to-back, or it rested)", JSON.stringify(A));
  const { careerContext } = await import("../src/records/yoy.js");
  const cs = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-career-seasons-2026-27.json"), "utf8"));
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const Lr = (o) => keys.map((k) => o[k] ?? 0);
  const games = Array.from({ length: 12 }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, opp: "BOS", home: true, pf: 1, pa: 0, pl: { 1: Lr({ min: 30, pts: 13, fgm: 6, fga: 11, fg3m: 3, fg3a: 7, ftm: 4, fta: 5, reb: 3 }) } }));
  const row = (season, fgm, fga, fg3m, fg3a, ftm, fta) => { const r = Array(cs.keys.length).fill(0); const ix = Object.fromEntries(cs.keys.map((k, i) => [k, i])); Object.assign(r, { [ix.season]: season, [ix.g]: 70, [ix.min]: 2100, [ix.pts]: 800, [ix.reb]: 300, [ix.ast]: 100, [ix.fgm]: fgm, [ix.fga]: fga, [ix.fg3m]: fg3m, [ix.fg3a]: fg3a, [ix.ftm]: ftm, [ix.fta]: fta }); return r; };
  const seasons = { keys: cs.keys, players: { "Shoot Guy": [row("2023-24", 300, 700, 100, 280, 80, 110), row("2024-25", 310, 700, 110, 300, 90, 120), row("2025-26", 320, 720, 120, 320, 85, 120)] } };
  const c = careerContext({ seasons, teamFiles: { POR: { team: "POR", keys, names: { 1: "Shoot Guy" }, games } } });
  const combo = c.find((x) => x.stat === "pct");
  ok(combo && /^Guy: career highs in FG%, 3P%, 2P% and FT% \(54\.5%, 42\.9%, 75%, 80%\)/.test(combo.text) && c.some((x) => x.stat === "fg3" && /42\.9% from three \(36-84\), his career high/.test(x.text)),
    "season vs career (0.71): shooting percentages against his seasons (enough attempts), and one line for three or more career highs", JSON.stringify(c.filter((x) => /fg|ft|pct/.test(x.stat)).map((x) => x.text)));
}

// ---------- 0.114: a bio paragraph headed by the bare season ("2025-26: …", San Antonio) is last season's ----------
{
  const N = await import("../src/notes/narrative.js");
  const L = (text) => ({ text, cells: [{ x0: 40, x1: 560, cx: 300, text }], charX: [] });
  const doc = { pages: [{ page: 1, width: 612, lines: [L("#3 KELDON JOHNSON Guard/Forward • 6-6 • 215 • Kentucky • Eighth Season • DOB: 10/11/99"),
    L("2025-26: 2025-26 NBA Sixth Man of the Year … One of two Spurs who played in all 82 games … averaged 13.2 points, 5.4 rebounds and 3.7 assists off the bench for San Antonio ... made 99 three-pointers, moving him to fifth all-time in Spurs franchise history ... ranks second in NBA in total bench points (1,081) ... his 414 made field goals and 439 rebounds each rank second among NBA reserves ... led all reserves in win shares (6.4) on second-best team in the NBA."),
    L("2026-27: Ranks third in the NBA in bench points (212) this season ... has scored in double figures in 11 of 15 games.")] },
    { page: 2, width: 612, lines: [L("SERIES NOTES The Spurs lead the all-time series. 2025-26: 3-1. San Antonio has won six of the last eight meetings with the Clippers this season and last.")] }] };
  const dropped = [];
  const h = N.readHistory(doc, [{ id: "3", name: "Keldon Johnson" }], { seasonStart: "2026-10-01", today: "2026-11-19", teamWords: ["San Antonio", "Spurs"], oppWords: ["Clippers", "LA"], dropped });
  ok(!h.some((x) => /1,081|414 made field goals|Sixth Man/.test(x.text)) && h.some((x) => /^Ranks third in the NBA in bench points \(212\) this season\.$/.test(x.text))
    && dropped.filter((d) => d.reason === "past-season").length >= 5 && dropped.some((d) => d.reason === "past-season" && /^2025-26: Ranks second in NBA in total bench points/.test(d.text))
    && !dropped.some((d) => d.reason === "past-season" && /six of the last eight/.test(d.text)),
    "notes (0.114; the user, 11/19: \"these stats were from last season\"): a bio paragraph that opens with the bare season and a colon is that season's, so last season's ranks are not shown as this season's; the paragraph headed 2026-27 is kept; a bare \"2025-26: 3-1\" outside a bio is not a heading",
    JSON.stringify([h.map((x) => x.text), dropped.map((d) => d.reason + ": " + d.text.slice(0, 50))]));
}

// ---------- 0.71: the user's second 11/15 review (Celtics, Hornets, Mavericks, Hawks notes) ----------
{
  const N = await import("../src/notes/narrative.js");
  const F = await import("../src/notes/facts.js");
  const L = (text) => ({ text, cells: [{ x0: 40, x1: 560, cx: 300, text }], charX: [] });
  const doc = { pages: [
    { page: 1, width: 612, lines: [L("#9 Derrick White 2026-27 SEASON: Derrick White leads the league in free throw percentage this season at 1.000 so far. 2025-26 SEASON: Scored a game-high 33 points to go with five rebounds in 36 minutes vs. MIA Dec. 19...White’s nine 3-pointers tied his career high...It marked White’s seventh career game with 30+ points. PROFESSIONAL CAREER: 2024-25 SEASON: Appeared in 76 games (all starts) where he averaged 16.4 points...Made a franchise record 265 threes during the season...His 265 3-pointers amounted to the fourth most three-pointers in the NBA this season.")] },
    { page: 2, width: 612, lines: [L("#8 Ron Harper Jr. Posted 22 points (8-11 FG, 6-9 3FG) to go with three rebounds and two assists in 33 minutes at SAS March 10...Harper Jr.'s six 3-pointers marked a career high.")] },
    { page: 3, width: 612, lines: [L("#29 Morez Johnson Jr. 2025-26 SEASON: Recorded a career-high 17 rebounds vs. UTA (11/6/26), becoming one of three Maverick rookies to record 10+ offensive rebounds in a game and one of six Maverick rookies to record 17+ rebounds in a game.")] },
    { page: 4, width: 612, lines: [L("Ryan Kalkbrenner Effective Field Goal % 70.0% 96th percentile On/Off point differential: A statistic that measures the amount of points a team scores per 100 Brandon Miller Block % 1.2% 85th percentile possessions. Charlotte's offense is 21.2 points per 100 possessions better with Kalkbrenner on the floor than off, placing him in the 99th percentile in offensive on/off point differential per Cleaning The Glass.")] },
  ] };
  const players = [{ id: "9", name: "Derrick White" }, { id: "8", name: "Ron Harper Jr." }, { id: "29", name: "Morez Johnson Jr." }, { id: "5", name: "Ryan Kalkbrenner" }];
  const dropped = [];
  const h = N.readHistory(doc, players, { seasonStart: "2026-10-01", today: "2026-11-15", teamWords: ["Charlotte", "Hornets"], dropped });
  ok(!h.some((x) => /265|nine 3-pointers|six 3-pointers/.test(x.text)) && h.some((x) => /leads the league in free throw percentage/.test(x.text))
    && h.some((x) => /one of three Maverick rookies/.test(x.text)) && dropped.some((d) => d.reason === "past-season" && /265/.test(d.text)),
    "notes (0.71): '2025-26 SEASON:' and 'PROFESSIONAL CAREER: 2024-25 SEASON:' headers mark last seasons' notes; 'marked a career high' after an old date is that game's; a past header over this season's dates is a typo", JSON.stringify([h.map((x) => x.text.slice(0, 50)), dropped.map((d) => d.reason)]));
  ok(!h.some((x) => /percentile On\/Off|A statistic that/.test(x.text)) && h.some((x) => /99th percentile in offensive on\/off/.test(x.text)),
    "notes (0.71): a stats glossary read into its table is dropped; a real sentence about the stat stays", JSON.stringify(h.map((x) => x.text.slice(0, 60))));
  ok(N.repairLayout("It marked the seventh time in his career he’s gone 100% fromDate the free-throw line with at least nine attempts") === "It marked the seventh time in his career he’s gone 100% from the free-throw line with at least nine attempts"
    && N.repairLayout("Date of his last start was 11/2 and the Score was close") === "Date of his last start was 11/2 and the Score was close",
    "notes (0.107.1): a table's header word stuck inside a sentence is taken out (Denver, 11/18: '100% fromDate the free-throw line'); the same words used as words are left alone");
  ok(N.repairLayout("joining Moussa Cisse and Popeye Jones. 2 0 2 6 - 2 7 D A L L A S M A V E R I C K S G A M E N O T E S.") === "joining Moussa Cisse and Popeye Jones."
    && N.repairLayout("Kornet is just the sixth active player to be undrafted and have 300+ blocks. 17 Find us on X: @spurs | Facebook: http://www.facebook.com/Spurs.") === "Kornet is just the sixth active player to be undrafted and have 300+ blocks.",
    "notes (0.71): a letter-spaced page footer and the PR accounts' footer are cut");
  ok(F.whenWithin("Became one of only three undrafted players in NBA history to start 400 games within their first seven seasons.", ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"])?.season === "2025-26"
    && F.whenWithin("within his first seven seasons", ["2024-25", "2025-26"]) === null,
    "notes (0.71): 'within his first N seasons' is dated to his Nth season once it's past");
  const A = F.annotate([{ text: "Johnson Jr. is one of three rookies to record 10+ offensive rebounds in a game, joining Moussa Cisse and Popeye Jones.", kind: "context", player: "Morez Johnson Jr." },
    { text: "Recorded a career-high 17 rebounds vs. UTA (11/6/26), becoming one of three Maverick rookies to record 10+ offensive rebounds in a game.", kind: "record", player: "Morez Johnson Jr." }], {});
  ok(/one of three Maverick rookies to record 10\+ offensive rebounds/.test(A[0].text) && A[0].tag === "1 of 3 in team history",
    "notes (0.71): a club the same notes call a team club elsewhere says so", JSON.stringify(A.map((x) => [x.text.slice(0, 60), x.tag])));
}

// ---------- 0.65: the user's 11/14 notes review (Sharpe, Porter Jr., Mobley, the Cavs, Kyrie, Coward, Jenkins) ----------
{
  const N = await import("../src/notes/narrative.js");
  const F = await import("../src/notes/facts.js");
  const R = N.repairLayout;
  ok(R("An elite offensive rebounder as well, Sharpe holds the highest11/2 at NYK L 21:51 1-5 0-0 2-2 3 3 6 3 5 0 3 1 4 offensive rebound percentage by any player in NBA history, minimum 200 games played.")
      === "An elite offensive rebounder as well, Sharpe holds the highest offensive rebound percentage by any player in NBA history, minimum 200 games played."
    && R("Joins 10/30 vs. Pistons 94-110 L 0-5 11/1 @ Pacers 98-90 W 1-5 Luka Dončić as the only players averaging 7.0 REB and 3.0 3PM 11/2 @ Knicks 90-103 L 1-6 this season.")
      === "Joins Luka Dončić as the only players averaging 7.0 REB and 3.0 3PM this season.",
    "notes (0.65): game-log rows spliced into a sentence are cut out");
  ok(R("His 3.5 th th triples per game rank T-11 in the NBA.") === "His 3.5 triples per game rank T-11th in the NBA."
    && R("Mobley is shooting a career-high .479 from beyond the arc this season, th the 9 -best mark in the NBA.") === "Mobley is shooting a career-high .479 from beyond the arc this season, the 9th-best mark in the NBA."
    && R("He scored 30 points vs. Boston on 11/2, the most this season.") === "He scored 30 points vs. Boston on 11/2, the most this season."
    && R("Cedric Coward (2025-26 First Team) and Zach Edey are on the team. 2026-27 Game Notes.") === "Cedric Coward (2025-26 First Team) and Zach Edey are on the team.",
    "notes (0.65): superscript suffixes printed apart go back on their number; a page footer is dropped; ordinary text is untouched");
  const kyrie = { text: "Recorded 15 points at HOU (10/21/26) in his return to play after 597 days away from the game.", kind: "trend", player: "Kyrie Irving" };
  const bx = { games: ["2026-10-21", "2026-10-23", "2026-11-11"].map((d) => ({ d })) };
  ok(/^past one-off/.test(F.trimReason(kyrie, { box: bx, today: "2026-11-14" }) || ""), "notes (0.65): a return game three weeks ago is a past one-off ('597 days away from the game' isn't a milestone countdown)");
  const d1 = F.describe("Amongst all NBA centers, Sharpe currently ranks fifth in APG (4.1) and total assists (45).", {});
  const d2 = F.describe("Thomas is shooting 26-55 (.473) from beyond the arc on the year, which ranks 1st in 3FG% among all NBA rookies.", {});
  ok(d1.tag === "5th among centers" && d2.tag === "Leads rookies", "notes (0.65): a rank within a group says the group in its tag", JSON.stringify([d1.tag, d2.tag]));
}

// ---------- Notes lines read for meaning, tables, hooks, the learned scorer (0.48; the user's Wizards picks, 11/13) ----------
{
  const F = await import("../src/notes/facts.js");
  const L = (text) => ({ text, cells: [{ x0: 40, x1: 560, cx: 300, text }], charX: [] });
  const doc = { pages: [
    { page: 1, width: 612, lines: [
      L("• KYSHAWN GEORGE Was selected to the 2026 Castrol Rising Stars roster as part of NBA All-Star Weekend 2026 in Los Angeles. • Leads all NBA third-years with 18.5 points per game this season. • Is one of five players averaging 18+ points, 4+ assists, 4+ rebounds and 1+ block per game this season."),
      L("• ANTHONY DAVIS One of two players in the league averaging 25+ points, 10+ rebounds, 1+ steal and 1+ block per game this season."),
      L("• BUB CARRINGTON Has appeared in 176 consecutive games, the third-longest active streak in the NBA."),
    ] },
    { page: 2, width: 612, lines: [
      L("SERIES NOTES"),
      L("• Detroit took the first game of this season's series on Nov. 9, and has won each of the past two season series between the teams."),
    ] },
    { page: 3, width: 612, lines: [
      L("Since entering the league in 2012-13, Davis owns the most blocks in the NBA."),
      L("MOST BLOCKS RECORDED PLAYER, NBA, SINCE 2012-13 RK. NAME BLOCKS TEAM 1 ANTHONY DAVIS 1,859 WAS 2 RUDY GOBERT 1,851 MIN 3 BROOK LOPEZ 1,742 LAC"),
      L("Despite having the sixth-most points in the paint in the NBA according to Sportradar, the Wizards have been blocked the least of any team in the league this season."),
      L("TEAM, MOST POINTS IN THE PAINT NBA, 2026-27 RANK TEAM PAINT POINTS 1 NEW ORLEANS 682 2 SAN ANTONIO 658 3 L.A. LAKERS 638 4 ATLANTA 632 5 INDIANA 602 6 WASHINGTON 596 @WIZPRSTATS"),
      L("Davis is one of two players in the NBA this season to average 25.0+ points, 10.0+ rebounds , 1.0+ steal and 1.0+ block per game."),
    ] },
  ] };
  const players = [{ id: "10", name: "Kyshawn George" }, { id: "11", name: "Anthony Davis" }, { id: "12", name: "Bub Carrington" }];
  const h = readHistory(doc, players, { seasonStart: "2026-10-01", today: "2026-11-12", teamWords: ["Washington", "Wizards"], oppWords: ["Detroit", "Pistons"] });
  const by = (re) => h.find((x) => re.test(x.text));
  ok(by(/third-years/)?.player === "Kyshawn George" && by(/one of five/)?.player === "Kyshawn George" && by(/176 consecutive/)?.player === "Bub Carrington"
    && by(/Detroit took/)?.matchup && by(/blocked the least/)?.team && by(/owns the most blocks/)?.player === "Anthony Davis",
    "notes, league context (0.48): third-year lead, a 1-of-5 club, an active streak, the series, a team rank, a race — each with its subject", JSON.stringify(h.map((x) => [x.player || (x.matchup ? "series" : "team"), x.text.slice(0, 30)])));
  const d = (t) => F.describe(t, {});
  ok(d("One of two players in the league averaging 25+ points, 10+ rebounds, 1+ steal and 1+ block per game this season.").tag === "1 of 2 this season"
    && d("Has appeared in 176 consecutive games, the third-longest active streak in the NBA.").tag === "Active streak · 176"
    && d("Logged his 39th career 40-point double-double on 11/9 at Detroit, tying Michael Jordan for the seventh-most since 1973-74.").tag === "T-7th since 1973-74"
    && F.thresholds("averaging 18+ points, 4+ assists, 4+ rebounds and 1+ block per game").map((x) => `${x.stat}${x.min}`).join() === "pts18,ast4,reb4,blk1",
    "notes, describe: tags (1 of 2 this season; Active streak · 176; T-7th since 1973-74) and the club's thresholds");
  // From the 11/13 slate: team-history lines aren't tagged as league ones, and a streak's hook fits its kind.
  const hk = (t, m = {}) => F.hookFor({ text: t, ...m, facts: F.describe(t, m) }, {})?.text;
  ok(d("Passed Scott Skiles (1,176) for eighth on the Magic’s all-time free throws made list on Oct. 28 @ Toronto.").tag === "8th in team history"
    && d("Mitchell’s +/- of +28 is the second highest +/- this season by any Cavs player.").tag === "2nd in team history"
    && d("Jordan Clarkson has now scored 8,699 points off the bench in his career, passing Thurl Bailey for seventh all-time since the 1968-69 season.").tag === "7th since 1968-69"
    && hk("Has appeared in 176 consecutive games, the third-longest active streak in the NBA.", { player: "Bub Carrington" }) === "177 if he plays tonight."
    && hk("Victor Wembanyama has recorded a block and a steal in 10 consecutive games, the longest active streak in the NBA.", { player: "Victor Wembanyama" }) === "11 if he does it again tonight."
    && hk("The Warriors' franchise-record home sellout streak is at 613 consecutive games.") === "The notes' count, not checked against the results.",
    "notes, tags and hooks from the 11/13 slate: team history stays team history; games-played vs. do-it-again; a team streak's count is the notes' until checked (0.113)");
  const T = F.readTables(doc);
  const blk = T.find((t) => /MOST BLOCKS/.test(t.title)), paint = T.find((t) => /POINTS IN THE PAINT/.test(t.title));
  ok(blk?.rows.length === 3 && blk.rows[1].name === "RUDY GOBERT" && blk.rows[1].value === 1851 && paint?.rows[5]?.name === "WASHINGTON" && paint.rows[5]?.value === 596 && paint.title === "TEAM, MOST POINTS IN THE PAINT NBA, 2026-27",
    "notes, tables: ranked infographic tables read (title, rank, name, value)", JSON.stringify(T.map((t) => [t.title, t.rows.length])));
  // Box scores: Davis 10 games at 25.2 / 10.0 / 1.3 / 1.1.
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const Lb = (o) => keys.map((k) => o[k] ?? 0);
  const games = Array.from({ length: 10 }, (_, i) => ({ d: `2026-10-${String(21 + i).padStart(2, "0")}`, opp: "BOS", home: true, pf: 1, pa: 0, pl: { 11: Lb({ min: 34, pts: i < 2 ? 26 : 25, reb: 10, stl: i < 3 ? 2 : 1, blk: i < 1 ? 2 : 1 }) } }));
  const box = { keys, names: { 11: "Anthony Davis" }, games };
  const ann = F.annotate(h, { doc, box, teamNames: ["Washington", "Wizards", "WAS"] });
  const davis2 = ann.filter((x) => x.player === "Anthony Davis" && x.type === "club");
  const race = ann.find((x) => /owns the most blocks/.test(x.text)), paintL = ann.find((x) => /sixth-most points in the paint/.test(x.text));
  ok(davis2.length === 1 && davis2[0].hook?.text === "Stays in it with 10+ rebounds, 23+ points tonight." && davis2[0].hook.live,
    "notes, one of two: the same club printed twice is one line; what he needs tonight to stay in it, from the box scores", JSON.stringify(davis2.map((x) => x.hook)));
  ok(race?.hook?.text === "Leads Rudy Gobert by 8 (1,859 to 1,851)." && race.hook.live && paintL?.hook?.text === "6 behind Indiana (602) for 5th.",
    "notes, races: the table beside the line gives the gap (Davis 8 blocks ahead of Gobert since 2012-13; Wizards 6 paint points from 5th)", JSON.stringify([race?.hook, paintL?.hook]));
  const left = F.stayInClub([{ stat: "pts", min: 30 }, { stat: "reb", min: 10 }], box, "11");
  ok(left && !left.ok && F.hookFor({ text: "x", facts: F.describe("One of two players averaging 30+ points and 10+ rebounds per game this season.", {}) }, { stay: left }).stale,
    "notes, a club he has since left (the box scores say 25.2, not 30+): marked no longer true, and the storylines skip it");
  const { train, auc, PRIOR } = await import("../tools/train-fact-model.js");
  const labels = [{ text: "Leads all NBA third-years with 18.5 points per game this season.", label: 1 }, { text: "Was selected to the 2026 Castrol Rising Stars roster as part of NBA All-Star Weekend.", label: 0 },
    { text: "Has appeared in 176 consecutive games, the third-longest active streak in the NBA.", label: 1 }, { text: "He ranks seventh among all rookies in Wizards history over eight career games.", label: 0 }];
  const m = train(labels, { steps: 800 });
  ok(auc(labels, labels.map((l) => F.score(F.features(l.text, {}), m))) === 1 && F.score(F.features(labels[1].text, {}), PRIOR) < 0.5,
    "notes, the learned scorer: picks rank above the rest; a roster note (All-Star Weekend selection) scores low on the prior");
  const fm = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "fact-model.json"), "utf8"));
  ok(fm.labels >= 30 && fm.picks >= 22 && typeof fm.priorAuc === "number" && (fm.learned ? Object.values(fm.heldOutAuc).some((a) => a > fm.priorAuc) : fm.weights.club === PRIOR.weights.club),
    "notes, fact-model.json: trained on the user's picks; learned weights only when they beat the prior on held-out lines", JSON.stringify({ labels: fm.labels, learned: fm.learned, priorAuc: fm.priorAuc, heldOutAuc: fm.heldOutAuc }));
}

// ---------- Trimming the notes (0.49, the user's review of the 11/13 slate) ----------
{
  const F = await import("../src/notes/facts.js");
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const days = ["2026-10-21", "2026-10-24", "2026-10-26", "2026-10-28", "2026-10-31", "2026-11-02", "2026-11-04", "2026-11-07", "2026-11-09", "2026-11-11"];
  const box = { keys, names: {}, games: days.map((d) => ({ d, opp: "BOS", home: true, pf: 1, pa: 0, pl: {} })) };
  const T = (text, extra = {}, home = true) => F.trimReason({ text, ...extra }, { box, today: "2026-11-13", home });
  const cut = [
    [T("The Warriors’ franchise-record home sellout streak, the fifth-longest in NBA history, is at 613 consecutive games (7 sellouts in 2026-27).", {}, false), /home stat, on a road night/],
    [T("Passed Scott Skiles (1,176) for eighth on the Magic’s all-time free throws made list on Oct. 28 @ Toronto.", { player: "Franz Wagner" }), /past one-off/],
    [T("The Indiana Pacers traveled to Mexico City for the first time in team history to face the Denver Nuggets as part of the NBA Mexico City Game 2026 on November 7."), /past event/],
    [T("Giannis Antetokounmpo scored at least 35 points in each of the first two games this season, becoming just the third player in NBA history to score at least 35 points in his first two games with a new team.", { player: "Giannis Antetokounmpo" }), /past one-off/],
    [T("Giannis Antetokounmpo scored a team-high 35 points vs. Minnesota in the season opener on October 21, the second-most in a HEAT season opener in franchise history.", { player: "Giannis Antetokounmpo" }), /past one-off \(season opener/],
    [T("The HEAT are currently in their 39th season in franchise history."), /filler/],
    [T("Chicago recorded 57 rebounds in the season opener at TOR (10/21), which marked the third-highest rebound total in a season opener in franchise history (most: 64 vs. PHI, 10/10/72)."), /past one-off/],
    [T("Scored career-high 45 PTS and set franchise record for Opening Night PTS on Virginia / USA 8th Season 10/21/26 vs UTA.", { player: "Ty Jerome" }), /garbled \(a table row\)/],
    [T("With 38 points at Memphis on Oct 31st, Acuff is also one of six players in NBA history with 30+ points in four of Darius Acuff Jr. notches his second consecutive 30+ point game, joining their first 10 career games, joining Wilt Chamberlain.", { player: "Darius Acuff Jr." }), /garbled \(two columns/],
  ];
  const kept = [
    T("The Bulls attempted 47 free throws in their season opener at TOR (10/21), the most FTA in a regulation game for the team since Dec. 12, 2014."),
    T("With 29 points and six assists versus Orlando on Nov. 10th, he recorded his seventh consecutive game with 20+ points and 5+ assists, the second longest streak this season.", { player: "Darius Acuff Jr." }),
    T("Jalen Smith logged a career-high five 3FGM en route to matching a career-high 23 points vs. SAS (11/11), joining Nikola Vučević (9x) as the only centers in team history to do it.", { player: "Jalen Smith" }),
    T("Giddey has recorded six games of 15plus assists while with Chicago, which is tied for fourth-most in team history (most: Guy Rodgers, 17).", { player: "Josh Giddey" }),
    T("The Warriors’ franchise-record home sellout streak, the fifth-longest in NBA history, is at 613 consecutive games (7 sellouts in 2026-27).", {}, true),
  ];
  ok(cut.every(([why, re]) => re.test(why || "")) && kept.every((x) => x === null),
    "notes, trimming (the user's 11/13 review): past one-offs, filler, the other venue and garbled lines cut; the 2014 FTA mark, a live streak, the last game's line and a growing count kept",
    JSON.stringify({ cut: cut.map(([w]) => w), kept }));
  const few = F.trimLines([{ text: "Chicago recorded 57 rebounds in the season opener at TOR (10/21), which marked the third-highest rebound total in a season opener in franchise history.", score: 2 }, { text: "The HEAT are currently in their 39th season in franchise history.", score: 3 }], { box, today: "2026-11-13", home: true });
  ok(few.keep.length === 1 && few.keep[0].kept === "few lines tonight" && few.trimmed.length === 1 && few.trimmed[0].trimmed === "filler",
    "notes, trimming isn't too strict: a team with few lines keeps its best past one-offs (never filler)");
  const twin = F.trimLines([{ text: "Caleb Wilson became the first rookie in Bulls history to tally at least four steals and four 3FGM in a single game after tallying 24 points vs. PHI (11/2).", player: "Caleb Wilson" },
    { text: "Wilson is the first rookie in Bulls history to tally four-plus steals and four-plus 3FGM in a single game.", player: "Caleb Wilson" },
    { text: "Powell is the first player in the NBA this season to score 30-plus points without missing from inside the arc.", player: "Norman Powell" }], { box, today: "2026-11-13", home: true, floor: 0 });
  const trip = F.trimLines([{ text: "The Indiana Pacers traveled to Mexico City for the first time in team history to face the Denver Nuggets as part of the NBA Mexico City Game 2026 on November 7.", score: 5 }], { box, today: "2026-11-13", home: false });
  ok(twin.keep.length === 1 && /Powell/.test(twin.keep[0].text) && twin.trimmed.some((x) => /told again/.test(x.trimmed)) && trip.keep.length === 0,
    "notes, trimming: the same past fact told without its date goes too; a past trip never comes back for a team with few lines");
}

// ---------- Tonight's matchups (src/records/matchup.js, 0.48) ----------
{
  const M = await import("../src/records/matchup.js");
  // DET-WAS: Detroit won the last 3; Washington had won 9 straight before; 5 straight DET wins in Washington.
  const G = [];
  const add = (d, h, a, hs, as) => G.push([d, h, a, hs, as, 2]);
  for (let i = 0; i < 9; i++) add(`20${17 + Math.floor(i / 2)}-0${i % 2 ? 3 : 1}-1${i}`, i % 2 ? "WAS" : "DET", i % 2 ? "DET" : "WAS", i % 2 ? 110 : 100, i % 2 ? 100 : 110);
  add("2024-01-15", "WAS", "DET", 117, 129); add("2025-11-10", "DET", "WAS", 137, 135); add("2026-02-05", "DET", "WAS", 117, 126); add("2026-03-17", "WAS", "DET", 117, 130); add("2026-03-19", "WAS", "DET", 95, 117);
  const history = { games: G.sort((a, b) => (a[0] < b[0] ? -1 : 1)) };
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const Lb = (o) => keys.map((k) => o[k] ?? 0);
  const was = { team: "WAS", keys, names: { 11: "Anthony Davis" }, games: [
    { d: "2026-11-09", opp: "DET", home: false, pf: 111, pa: 122, pl: { 11: Lb({ min: 38, pts: 44, reb: 13 }) } },
    ...Array.from({ length: 4 }, (_, i) => ({ d: `2026-10-2${i + 1}`, opp: "BOS", home: true, pf: 100, pa: 90, pl: { 11: Lb({ min: 34, pts: 22, reb: 10 }) } })),
  ] };
  const det = { team: "DET", keys, names: {}, games: [{ d: "2026-11-09", opp: "WAS", home: true, pf: 122, pa: 111, pl: {} }] };
  const teamFiles = { WAS: was, DET: det };
  const t = M.teamItems(history, teamFiles, "DET", "WAS", "2026-11-12");
  const tx = (re) => t.find((i) => re.test(i.text));
  ok(tx(/^The Pistons have won 3 straight against the Wizards \(last: 122-111 on 11\/9\)\.$/) && !tx(/straight in Washington|at home/) && tx(/lead the season series 1-0/),
    "matchups, series: the run of straight wins (3, counting this season's 11/9; Washington won 2/5/26) and this season's series", JSON.stringify(t.map((i) => i.text)));
  // Davis: 12 past games vs DET at 31 a game, 24 against everyone else (9 other teams, 4+ games each); 30+ in his last 3 vs DET.
  const rows = [];
  const teamsList = ["BOS", "NYK", "MIA", "CHI", "ATL", "TOR", "PHI", "MIL", "IND"];
  for (let i = 0; i < 12; i++) rows.push([`2018-0${(i % 9) + 1}-1${i % 10}`, "DET", 1, i < 11 ? "W" : "W", 2, 36, i >= 9 ? 33 : 30, 11, 3, 1, 2, 0]);
  teamsList.forEach((o, k) => { for (let i = 0; i < 4; i++) rows.push([`2019-0${(i % 9) + 1}-${10 + k}`, o, 1, "L", 2, 36, 24, 10, 3, 1, 2, 0]); });
  const logs = { players: { 11: rows.sort((a, b) => (a[0] < b[0] ? -1 : 1)) } };
  const p = M.playerItems({ id: "11", name: "Anthony Davis", team: "WAS", opp: "DET", logs, teamFiles, today: "2026-11-12" });
  const px = (re) => p.find((i) => re.test(i.text));
  ok(px(/averaged 31\.8 points in 13 games against the Pistons in his career, his most against any team \(25\.8 overall\)/) && px(/30\+ points in 13 straight games against the Pistons, every game in his career/)
    && px(/teams are 12-1 against the Pistons/) && px(/had 44 points, 13 rebounds against the Pistons on 11\/9 \(lost\)/),
    "matchups, a player: his best average against any team, a streak still going against them, and this season's big game", JSON.stringify(p.map((i) => i.text)));
  const st = (await import("../src/anticipate/tonight.js")).tonightStorylines({ watch: { today: "2026-11-12", games: [{ id: "1", awayTri: "DET", homeTri: "WAS" }] },
    matchups: { today: "2026-11-12", games: [{ away: "DET", home: "WAS", items: [...t, ...p] }] } });
  ok(st[0].lines.filter((l) => l.kind === "matchup").length === 2 && st[0].lines.every((l) => /^[^:]+: /.test(l.text)),
    "matchups in tonight's storylines: at most two a game, tag first", JSON.stringify(st[0].lines.map((l) => l.text)));
}

// ---------- Outliers: a career high supersedes a season high (the user, 11/13) ----------
{
  const { careerHighs, anomalies: an2 } = await import("../src/situations/trends.js");
  const line = (d, pts, min = 34) => ({ d, team: "DET", opp: "WAS", home: false, win: true, min, pts, reb: 5, ast: 6, fg3m: 1, stl: 1, blk: 0, fgm: 10, fga: 20, fg3a: 4 });
  const pg = { 7: ["2026-10-22", "2026-10-24", "2026-10-26", "2026-10-28", "2026-10-30", "2026-11-01"].map((d, i) => line(d, [20, 25, 33, 18, 22, 21][i])).concat([line("2026-11-12", 52, 48)]),
    8: ["2026-10-22", "2026-10-24", "2026-10-26", "2026-10-28", "2026-10-30"].map((d, i) => line(d, [8, 10, 6, 9, 7][i], 20)).concat([line("2026-11-12", 24, 30)]),
    9: ["2026-10-22", "2026-10-24", "2026-10-26", "2026-10-28", "2026-10-30", "2026-11-01"].map((d, i) => line(d, [20, 22, 18, 19, 21, 20][i])).concat([line("2026-11-12", 40)]) };
  const logs = { players: { 7: [["2024-01-10", "BOS", 1, "W", 2, 45, 46, 5, 6, 1, 0, 3], ["2024-05-01", "NYK", 1, "W", 3, 47, 60, 5, 6, 1, 0, 3]], 9: [["2017-01-10", "BOS", 1, "W", 2, 40, 41, 5, 6, 1, 0, 3]] } };
  const seasons = { keys: ["season", "g", "hi"], players: { "Cade Guy": [["2021-22", 64, 34], ["2023-24", 62, 46]], "Old Vet": [["2012-13", 70, 44], ["2016-17", 70, 41]] } };
  const careers = careerHighs({ logs, seasons, names: { 7: "Cade Guy", 8: "Rook Ie", 9: "Old Vet" }, ids: ["7", "8", "9"], season: "2026-27" });
  const a = an2(pg, { 7: "Cade Guy", 8: "Rook Ie", 9: "Old Vet" }, { dates: ["2026-11-12"], careers });
  const n = (name, stat) => a.find((x) => x.name === name)?.notes.find((x) => x.stat === stat);
  ok(n("Cade Guy", "pts")?.careerHigh && n("Cade Guy", "pts").prevCareer === 46 && n("Cade Guy", "min")?.careerHigh && n("Cade Guy", "min").prevCareer === 45 && /52 points \(averages .*, career high \(previous 46\)\)/.test(a.find((x) => x.name === "Cade Guy").text),
    "outliers: 52 beats his best of 46 (a 60 in the playoffs doesn't count): career high, not 'season high (was 33)'", JSON.stringify(a.map((x) => x.text)));
  ok(n("Rook Ie", "pts")?.careerHigh && n("Rook Ie", "pts").prevCareer === 10, "outliers: a rookie's season high is his career high");
  ok(n("Old Vet", "pts")?.seasonHigh && !n("Old Vet", "pts").careerHigh, "outliers: 40 for a veteran whose high is 44 (2012-13, before the game logs) is a season high, not a career high", JSON.stringify(n("Old Vet", "pts")));
}

// ---------- Matchups: a lopsided run past the last 10, and only last season's playoffs (the user, 11/13) ----------
{
  const M = await import("../src/records/matchup.js");
  const G = [];
  // 16 regular-season meetings, BOS 13-3 (losses at #2, #5, #9 counted oldest first), then 2024-25 and 2025-26 playoff series.
  for (let i = 0; i < 16; i++) { const bw = ![1, 4, 8].includes(i); G.push([`20${18 + Math.floor(i / 2)}-0${(i % 2) + 1}-15`, "BOS", "NYK", bw ? 110 : 100, bw ? 100 : 110, 2]); }
  for (let i = 0; i < 4; i++) G.push([`2025-05-0${i + 1}`, "NYK", "BOS", 101, 99, 3]);
  const t1 = M.teamItems({ games: G.sort((a, b) => (a[0] < b[0] ? -1 : 1)) }, {}, "NYK", "BOS", "2026-11-13");
  ok(t1.some((i) => /are 13-3 in the last 16 meetings/.test(i.text)) && !t1.some((i) => /in the last 10 meetings/.test(i.text)) && !t1.some((i) => /2024-25 playoffs/.test(i.text)),
    "matchups: a one-sided run reaches back past 10 meetings (13-3 in the last 16); a series from two playoffs ago isn't shown", JSON.stringify(t1.map((i) => i.text)));
  const G2 = G.concat(Array.from({ length: 4 }, (_, i) => [`2026-05-0${i + 1}`, "BOS", "NYK", 105, 95, 3]));
  const t2 = M.teamItems({ games: G2.sort((a, b) => (a[0] < b[0] ? -1 : 1)) }, {}, "NYK", "BOS", "2026-11-13");
  ok(t2.some((i) => /Playoff rematch: the Celtics beat the Knicks 4-0 in the 2025-26 playoffs/.test(i.text)), "matchups: last season's playoff series is still a rematch line", JSON.stringify(t2.map((i) => i.text)));
}

// ---------- Outside confirmations settle the Records checks (src/records/verified.js, 0.50) ----------
{
  const V = await import("../src/records/verified.js");
  const verified = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "verified-totals.json"), "utf8"));
  const c = { same: 0, differ: [], franchise: { same: 0, differ: [
    { player: "Jarrett Allen", stat: "reb", ours: 3942, theirs: 3442, source: "CLE notes (2026-11-13)" },
    { player: "Sam Merrill", stat: "fg3m", ours: 450, theirs: 454, source: "CLE notes (2026-11-13)" },
    { player: "Domantas Sabonis", stat: "oreb", ours: 970, theirs: 3599, source: "SAC notes (2026-11-20)" },
  ] } };
  V.settleChecks(c, verified, "2026-11-13");
  const [a, m, s] = c.franchise.differ;
  ok(a.settled?.value === 3942 && !a.against, "verified: B-Ref's 3,942 settles Allen's CLE rebounds in our favour");
  ok(!m.settled && m.against?.value === 457, "verified: a same-day B-Ref figure that disagrees with ours is flagged against us");
  const s2 = { ...s, against: undefined };
  V.settleChecks({ differ: [], franchise: { differ: [s2] } }, verified, "2026-11-20");
  ok(!s2.settled && !s2.against, "verified: a week-old confirmation says nothing once our total has moved on");
  const p = V.settleProblems(["Al Horford dreb: the guide gives 6,949 and 6,950 (active list)", "Dolph Schayes ftm: the guide gives 6,712 and 6,979 (career scorers, NBA Guide p. 136)", "Old Timer ftm: the guide gives 5,000 and 5,010 (somewhere)"],
    [{ name: "Al Horford", totals: { dreb: { base: 6949, season: 33, now: 6982 } } }], verified);
  ok(p.problems.length === 1 && /Old Timer/.test(p.problems[0]), "verified: an unconfirmed guide clash stays a problem");
  ok(p.errata.some((e) => e === "Dolph Schayes ftm: the guide also gives 6,979 (career scorers, NBA Guide p. 136); 6,712 is right (Basketball Reference, checked 2026-11-16)"),
    "verified (0.80): a retired player's two guide totals are settled by the one Basketball Reference gives", p.errata.join(" | "));
  ok(p.errata.length === 2 && /6,950 \(active list\); 6,949 is right/.test(p.errata[0]), "verified: B-Ref's 6,982 makes the guide's 6,950 a slip", p.errata[0]);
}

{
  const { fixReboundSplit } = await import("../src/notes/parse.js");
  const mk = (stat, current) => ({ player: "Domantas Sabonis", stat, scope: "franchise", current, checks: [], status: "ok" });
  const L = [mk("oreb", 961), mk("dreb", 2638), mk("oreb", 3599)];
  fixReboundSplit(L);
  ok(L[2].stat === "reb" && L[2].status === "review" && L[0].stat === "oreb", "notes: SAC's 3,599 'offensive' rebounds (961 + 2,638) is Sabonis's total rebounds", JSON.stringify(L[2]));
}

// ---------- Watch List: 50-40-90 watch and national-TV splits (0.50) ----------
{
  const watch = { today: "2026-11-13", games: [{ id: "g1", awayTri: "AAA", homeTri: "BBB" }], teams: [] };
  const leaders = { names: { 1: "Ayo D", 2: "Far Off", 3: "In Club" }, lines: [{ key: "fg", pct: 50 }, { key: "fg3", pct: 40 }, { key: "ft", pct: 90 }],
    shootKeys: ["id", "team", "games", "teamGames", "fg.m", "fg.a", "fg.q", "fg.min", "fg3.m", "fg3.a", "fg3.q", "fg3.min", "ft.m", "ft.a", "ft.q", "ft.min"],
    shooting: [["1", "AAA", 10, 10, 60, 115, 1, 1, 23, 49, 1, 1, 26, 29, 1, 1], ["2", "AAA", 10, 10, 50, 110, 1, 1, 20, 55, 1, 1, 30, 36, 1, 1], ["3", "BBB", 10, 10, 60, 110, 1, 1, 30, 70, 1, 1, 40, 44, 1, 1]] };
  const L = tonightStorylines({ watch, leaders, maxLines: 20 }).flatMap((g) => g.lines);
  const club = L.filter((l) => l.kind === "club");
  ok(club.length === 2 && /Ayo D: 0\.3 short of 50-40-90 .*1 make from the line/.test(club.find((l) => l.player === "Ayo D").text) && /In Club: shooting 50-40-90/.test(club.find((l) => l.player === "In Club").text)
    && !L.some((l) => l.player === "Ayo D" && l.kind === "shooting"), "watch list: 50-40-90 watch (0.3 short at 89.7% FT; one at all three); the single-line shooting note gives way", JSON.stringify(club.map((l) => l.text)));
  const P = (name, team, nat, other) => ({ name, team, nat, other });
  const national = { upcoming: [{ d: "2026-11-13", away: "AAA", home: "BBB", networks: ["Prime Video"] }], players: [
    P("Spot Light", "AAA", { gp: 4, min: 34, pts: 31, tsPct: 63 }, { gp: 6, min: 34, pts: 24, tsPct: 57 }),
    P("Few Games", "AAA", { gp: 2, min: 34, pts: 40 }, { gp: 6, min: 34, pts: 20 }),
    P("Small Gap", "BBB", { gp: 4, min: 30, pts: 25 }, { gp: 6, min: 30, pts: 22 }),
    P("Bench Guy", "BBB", { gp: 4, min: 12, pts: 2 }, { gp: 6, min: 14, pts: 9 }),
    P("Fades", "BBB", { gp: 3, min: 30, pts: 10 }, { gp: 6, min: 30, pts: 16 }) ] };
  const T = tonightStorylines({ watch, national, injuries: { date: "2026-11-13", players: [] }, maxLines: 20 }).flatMap((g) => g.lines).filter((l) => l.kind === "tv");
  ok(T.length === 2 && T.some((l) => l.player === "Spot Light" && /31\.0 points a game in 4 national games vs 24\.0 .*better.*Prime Video/.test(l.text)) && T.some((l) => l.player === "Fades" && /worse/.test(l.text)),
    "watch list: national TV tonight flags a clear split (3+ games each, 20+ minutes, 4+ points and 20%+); not 2 games, a 3-point gap or a bench player", JSON.stringify(T.map((l) => l.text)));
  const out = tonightStorylines({ watch, national, injuries: { date: "2026-11-13", players: [{ team: "AAA", name: "Spot Light", status: "Out" }] }, maxLines: 20 }).flatMap((g) => g.lines);
  ok(!out.some((l) => l.kind === "tv" && l.player === "Spot Light"), "watch list: the injury report removes a national-TV line for a player listed out");
  const busy = { ...watch, teams: [{ team: "AAA", items: Array.from({ length: 10 }, (_, k) => ({ player: `P${k}`, team: "AAA", stat: "pts", label: "points", kind: "round", scope: "career", target: 10000, need: 5, importance: 40, pTonight: 0.9, publishable: true })) }] };
  const crowded = tonightStorylines({ watch: busy, national, leaders, maxLines: 6 })[0].lines;
  ok(crowded.length === 6 && crowded.some((l) => l.kind === "tv") && crowded.some((l) => l.kind === "club"), "watch list: on a crowded night the best 50-40-90 and national-TV lines still get a place", JSON.stringify(crowded.map((l) => l.kind)));
}

// ---------- Round-number spacing (src/anticipate/cadence.js, the user 11/13) ----------
{
  const { roundStep, nextRound, onCadence } = await import("../src/anticipate/cadence.js");
  // The four cards the user flagged: Fears (2nd season) 1,352 -> 1,400; Watford 2,094 -> 2,100; Mykhailiuk 2,681 -> 2,700; Achiuwa 3,270 -> 3,300.
  ok(!onCadence("pts", 1400, 1352, { seasons: 2 }) && nextRound("pts", 1352, { seasons: 2 }) === 1500
    && !onCadence("pts", 2100, 2094, { seasons: 6 }) && !onCadence("pts", 2700, 2681, { seasons: 10 }) && !onCadence("pts", 3300, 3270, { seasons: 7 })
    && onCadence("pts", 3000, 2681, { seasons: 10 }), "cadence: 1,400 / 2,100 / 2,700 / 3,300 points are off the spacing; a young player past 1,000 goes by 500, a veteran by 1,000");
  ok(nextRound("pts", 640, { seasons: 1 }) === 700 && nextRound("blk", 680, { seasons: 3 }) === 700 && nextRound("pts", 640, { seasons: 8 }) === 1000,
    "cadence: a rookie or a 3rd-year player goes by 100 until 1,000 (Wembanyama's blocks); a veteran's next is 1,000");
  ok(roundStep("pts", 43591) === 500 && roundStep("pts", 19000) === 1000 && roundStep("fg3m", 4100) === 250 && roundStep("stl", 1500) === 250 && roundStep("reb", 11000) === 500 && roundStep("ast", 6000) === 1000,
    "cadence: points past 20,000 by 500 (LeBron); threes, steals and blocks past 1,000 by 250; rebounds past 10,000 by 500");
  ok(nextRound("gp", 99, { seasons: 2 }) === null && nextRound("gp", 899) === 900, "cadence: games played by 100 from 500");
  ok(nextRound("stl", 480, { seasons: 8 }) === 500 && nextRound("blk", 380, { seasons: 6 }) === 500 && onCadence("dd", 300, 296) && !onCadence("pts", 100, 96, { seasons: 1 }) && onCadence("pts", 600, 560, { seasons: 1 }) && !onCadence("reb", 100, 95, { seasons: 1 }),
    "cadence: a veteran's steals and blocks by 250 (Haliburton's 500 steals); double-doubles untouched; a rookie's 100s start at 500 points, 200 of anything else");
}

// ---------- Game Flow: the ESPN reader and its compact files (src/gameflow/feeds.js, 0.52) ----------
{
  const F = await import("../src/gameflow/feeds.js");
  const fx = path.join(root, "tests", "fixtures", "espn-summary.json.gz");
  if (!fs.existsSync(fx)) ok(false, "game flow: ESPN summary fixture missing (run the flow-sample workflow)");
  else {
    const sum = JSON.parse(zlib.gunzipSync(fs.readFileSync(fx)));
    const orig = F.espnToFeeds(sum);
    const c = F.compactFeeds(orig);
    const back = F.expandFeeds(JSON.parse(JSON.stringify(c)));
    // Every field the page reads, action by action; play text only as the two things read out of it.
    const norm = (a) => ({ ...a, description: /(\d+)[-\s]foot/i.exec(a.description || "")?.[1] && (a.actionType === "2pt" || a.actionType === "3pt") ? `${/(\d+)[-\s]foot/i.exec(a.description)[1]}-foot`
      : a.actionType === "foul" && /technical/i.test(a.description || "") ? "technical" : "" });
    const A = orig.pbp.game.actions.map(norm), B = back.pbp.game.actions;
    const diffs = [];
    A.forEach((a, i) => { const b = B[i]; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push(`${i} ${k}: ${JSON.stringify(a[k])} vs ${JSON.stringify(b[k])}`); });
    ok(A.length === B.length && A.length > 300 && !diffs.length, `game flow: the compact file gives back every action field the page reads (${A.length} actions)`, diffs.slice(0, 5).join("; "));
    const sorted = (x) => (Array.isArray(x) ? x.map(sorted) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sorted(x[k])])) : x);
    const box = (g) => JSON.stringify(sorted(g));
    ok(box(orig.box.game) === box(back.box.game), "game flow: and the whole box score");
    ok(JSON.stringify(c).length < JSON.stringify(sum).length / 8, "game flow: the compact file is under an eighth of ESPN's summary", `${JSON.stringify(c).length} vs ${JSON.stringify(sum).length}`);
    ok(fs.readFileSync(path.join(root, "src", "gameflow", "feeds.js"), "utf8") === fs.readFileSync(path.join(root, "docs", "lib", "gameflow", "feeds.js"), "utf8"), "game flow: the page's copy of the reader is the build's");
    // 0.145.0: the running score. Rebuilt from the scoring plays it ends on the final; with a 1st-quarter basket taken out of
    // the plays (as ESPN's NYK at MIN 11/19 was), it is set back on the line score at the 2nd quarter and ends on the final,
    // and the clutch reader still counts the game (the 4th quarter adds up) instead of dropping it.
    {
      const P = await import("../src/espn/parse.js");
      const comp = sum.header.competitions[0], fin = (s) => Number(comp.competitors.find((x) => x.homeAway === s).score);
      const lastOf = (f) => f.pbp.game.actions[f.pbp.game.actions.length - 1];
      const e0 = lastOf(orig);
      const cut = JSON.parse(JSON.stringify(sum));
      const ix = cut.plays.findIndex((p) => p.period?.number === 1 && p.scoringPlay && Number(p.scoreValue) === 2);
      const lost = cut.plays[ix], lostHome = String(lost.team?.id) === String(comp.competitors.find((x) => x.homeAway === "home").team.id);
      cut.plays.splice(ix, 1);
      for (const p of cut.plays) { if (lostHome) p.homeScore = Math.max(0, Number(p.homeScore) - (cut.plays.indexOf(p) >= ix ? 2 : 0)); else p.awayScore = Math.max(0, Number(p.awayScore) - (cut.plays.indexOf(p) >= ix ? 2 : 0)); }
      const f2 = F.espnToFeeds(cut), e2 = lastOf(f2);
      const q2 = f2.pbp.game.actions.find((a) => a.period === 2);
      const lh = comp.competitors.find((x) => x.homeAway === "home").linescores.map((l) => Number(l.displayValue ?? l.value));
      const la = comp.competitors.find((x) => x.homeAway === "away").linescores.map((l) => Number(l.displayValue ?? l.value));
      const g0 = P.readGameDetail(sum), g2 = P.readGameDetail(cut);
      ok(+e0.scoreHome === fin("home") && +e0.scoreAway === fin("away") && +e2.scoreHome === fin("home") && +e2.scoreAway === fin("away")
        && +q2.scoreHome >= lh[0] && +q2.scoreAway >= la[0]
        && g0.scoreOk && !g0.tailOk && !g2.scoreOk && g2.tailOk && JSON.stringify(g2.badPeriods) === "[1]" && g2.q4Players && JSON.stringify(g2.clutch) === JSON.stringify(g0.clutch),
        "0.145.0: Game Flow's score ends on the final; a basket missing from the 1st quarter's plays is set right at the 2nd quarter, and the clutch and 4th-quarter lines still count (the same clutch points as the whole game)",
        JSON.stringify({ e0: [e0.scoreAway, e0.scoreHome], e2: [e2.scoreAway, e2.scoreHome], fin: [fin("away"), fin("home")], q2: [q2.scoreAway, q2.scoreHome], g2: [g2.scoreOk, g2.tailOk, g2.badPeriods], c: [g0.clutch, g2.clutch] }));
    }
    // 0.59: the model moved out of the page, and the season facts built on it (src/gameflow/model.js, stats.js).
    ok(fs.readFileSync(path.join(root, "src", "gameflow", "model.js"), "utf8") === fs.readFileSync(path.join(root, "docs", "lib", "gameflow", "model.js"), "utf8")
      // 0.141.10: the page's script is docs/gameflow.js (moved out of the page unchanged); the page loads it.
      && /from "\.\/lib\/gameflow\/model\.js"/.test(fs.readFileSync(path.join(root, "docs", "gameflow.js"), "utf8"))
      && !/function buildStints\(/.test(fs.readFileSync(path.join(root, "docs", "gameflow.js"), "utf8"))
      && /<script type="module" src="gameflow\.js"><\/script>/.test(fs.readFileSync(path.join(root, "docs", "gameflow.html"), "utf8")),
      "game flow (0.59): the page imports the stint model the build runs (one copy, no second definition in the page)");
    // 0.141.13: ESPN writes a period's last minute as seconds ("58.8"); it was read as 0:00. And the running score for +/-
    // comes from the made baskets, so a score field that moves a play late (or on a turnover) can't shift points across a sub.
    {
      const raw = sum.plays.filter((p) => /^\d+(\.\d+)?$/.test(p.clock?.displayValue || ""));
      const lastMin = orig.pbp.game.actions.filter((a) => /^PT00M(?!00\.00)/.test(a.clock));
      ok(raw.length > 5 && lastMin.length >= raw.length - 2 && orig.pbp.game.actions.some((a) => a.clock === "PT00M58.80S" || /^PT00M\d\d\.\d0S$/.test(a.clock)),
        `game flow (0.141.13): last-minute clocks are read ("58.8" is 0:58.8, not the buzzer): ${lastMin.length} of ${raw.length} plays`);
      const Mm = await import("../src/gameflow/model.js");
      const glitch = F.expandFeeds(JSON.parse(JSON.stringify(c)));
      const acts = glitch.pbp.game.actions.slice().sort((x, y) => x.orderNumber - y.orderNumber);
      const to = acts.findIndex((a, i) => i > 50 && a.actionType === "turnover");
      for (let i = to; i < acts.length; i++) { if (acts[i].scoreHome != null) acts[i].scoreHome = String(+acts[i].scoreHome + 3); }
      const pmOf = (fe) => JSON.stringify(Mm.buildStints(fe.pbp, fe.box).recon.map((r) => r.dpm));
      ok(to > 0 && pmOf(glitch) === pmOf(F.expandFeeds(JSON.parse(JSON.stringify(c)))),
        "game flow (0.141.13): +/- follows the made baskets, not the feed's score field (3 phantom points on a turnover change nothing)");
    }
    // 0.141.16: the script split by section (docs/gameflow/*.js). Every import between them names something its file exports
    // (a wrong one stops the whole page loading), and no player photos come back (the user's "no posters/headshots").
    {
      const dir = path.join(root, "docs"), files = ["gameflow.js", ...fs.readdirSync(path.join(dir, "gameflow")).filter((f) => f.endsWith(".js")).map((f) => `gameflow/${f}`)];
      const bad = [];
      for (const f of files) {
        const t = fs.readFileSync(path.join(dir, f), "utf8");
        for (const m of t.matchAll(/^import \{([^}]+)\} from "(\.[^"]+)";/gms)) {
          const target = path.join(dir, path.dirname(f), m[2]);
          if (!fs.existsSync(target)) { bad.push(`${f}: ${m[2]} missing`); continue; }
          const tt = fs.readFileSync(target, "utf8");
          for (const raw of m[1].split(",")) {
            const name = raw.trim().split(/\s+as\s+/)[0].trim();
            if (!name) continue;
            const q = name.replace(/[$]/g, "\\$"), w = "(?![\\w$])", b = "(?<![\\w$])";
            const re = new RegExp(`^export\\s+(async\\s+)?(function\\*?|const|let|var|class)\\s+${q}${w}|^export\\s*\\{[^}]*${b}${q}${w}[^}]*\\}|^export\\s+(const|let)\\s+[^;\\n]*${b}${q}\\s*=`, "m");
            if (!re.test(tt)) bad.push(`${f}: ${name} from ${m[2]}`);
          }
        }
      }
      const photos = files.filter((f) => /espncdn\.com\/i\/headshots|cdn\.nba\.com\/headshots/.test(fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")));
      ok(files.length >= 10 && !bad.length && !photos.length,
        `game flow (0.141.16): ${files.length} script files, every import between them exported by its file, and no player photos`, JSON.stringify({ bad: bad.slice(0, 8), photos }));
    }
    // 0.141.11: on a phone the timeline column got nothing (172px names + three 52px stat columns > the screen).
    {
      const css = fs.readFileSync(path.join(root, "docs", "gameflow.css"), "utf8");
      const tmin = +((css.match(/--trackmin:(\d+)px/) || [])[1] || 0);
      ok(tmin >= 300 && /grid-template-columns:var\(--namew\) minmax\(var\(--trackmin\),1fr\) repeat\(3,var\(--statw\)\)/.test(css)
        && /\.grid\{min-width:calc\(var\(--namew\) \+ var\(--trackmin\) \+ 3\*var\(--statw\)\)\}/.test(css)
        && /\.grid>\.nm\{position:sticky;left:0/.test(css)
        && css.indexOf("@media (max-width:600px)") > css.indexOf("  .grid .nm{padding-right"),
        "game flow (0.141.11): the timeline keeps at least " + tmin + "px on a phone, the rows scroll sideways with the names pinned, and the phone rule comes after the rules it overrides");
    }
    const S = await import("../src/gameflow/stats.js");
    const row = { id: c.id, d: "2026-11-12" };
    const Fg = S.gameFacts(row, JSON.parse(JSON.stringify(c)));
    const Gm = (await import("../src/gameflow/model.js")).buildStints(back.pbp, back.box);
    const qSumOk = Fg.players.every((p) => { const pl = Gm.players.find((x) => String(x.id) === p.id); return p.q.reduce((a, b) => a + b, 0) <= pl.boxPts && (Gm.maxP > 4 || p.q.reduce((a, b) => a + b, 0) === pl.boxPts); });
    const st = Fg.players.filter((p) => p.starter);
    ok(qSumOk && st.length === 10 && st.every((p) => p.full1 || (p.out1 > 0 && p.out1 < 720)) && Fg.players.filter((p) => !p.starter && p.in1 != null).every((p) => p.in1 >= 0)
      && Fg.teams.length === 2 && Fg.teams.some((t) => t.won) && Fg.teams.every((t) => t.q.length === 4 && t.q.reduce((a, b) => a + b, 0) <= t.score),
      "game flow stats: a real game's quarters add up to each player's points (regulation), ten starters each with a first check-out in Q1 or a full Q1, two teams' quarters",
      JSON.stringify(st.map((p) => [p.name, p.out1, p.back, p.full1])));
    const two = S.flowStats([{ row, c }, { row: { id: "x2", d: "2026-11-13" }, c: { ...JSON.parse(JSON.stringify(c)), id: "x2" } }]);
    const r1 = Object.values(two.rotation).find((r) => r.starts === 2);
    ok(two.games === 2 && two.quarters.length && two.quarters[0].pts >= two.quarters[two.quarters.length - 1].pts && r1 && r1.gp === 2
      && two.leadTable.length === 2 && two.leadTable.every((t) => t.gp === 2 && t.neverTrailed + t.neverLed <= 2) && S.placeOn([{ pts: 20 }, { pts: 18 }, { pts: 18 }], 18) === 2,
      "game flow stats: season lists best first, rotations over games, the Leads & comebacks table, places on a list (ties share)", JSON.stringify(two.leadTable));
    // 0.79: the same two games give each team a record when leading / trailing by 10+, a run, and the lists exist.
    {
      const tA = Fg.teams[0], B = two.by10[tA.team];
      ok(B && B.gp === 2 && B.upW + B.upL === (tA.maxLead >= 10 ? 2 : 0) && B.downW + B.downL === (tA.maxDown >= 10 ? 2 : 0) && B.run.length === (!tA.won && tA.maxLead >= 10 ? 2 : 0) && B.longest === B.run.length
        && Array.isArray(two.full.halves) && Array.isArray(two.full.games) && Array.isArray(two.full.fives) && Array.isArray(two.swing)
        && Fg.players.every((p) => typeof p.fullGame === "boolean" && (!p.fullGame || (p.fullH1 && p.fullH2)) && (!p.fullH1 || p.mins >= 23.9))
        && Object.values(Fg.swing).every((x) => x.m <= x.a && x.a >= 1),
        "game flow stats (0.79): the record when leading or trailing by 10+, the run of games lost after such a lead, full halves and games, tie-or-lead shots late", JSON.stringify([B, two.full, Fg.swing]));
      // 0.81: the biggest lead held in the 4th quarter or overtime (the margin entering the 4th counts) can't top the
      // game's biggest; the season file carries it, and every player's points by quarter add up to his points.
      const flowG = Gm.flow, enter = [...flowG].reverse().find((f) => f.t <= 3 * 720)?.d ?? 0, lateMax = Math.max(enter, ...flowG.filter((f) => f.t > 3 * 720).map((f) => f.d));
      const home = Fg.teams.find((t) => t.home), awayT = Fg.teams.find((t) => !t.home);
      const qs = Object.values(two.qsum);
      ok(Fg.teams.every((t) => t.lead4 <= t.maxLead && t.down4 <= t.maxDown && t.lead4 >= 0) && home.lead4 === Math.max(0, lateMax) && home.lead4 === awayT.down4
        && Array.isArray(B.lateLost) && Array.isArray(B.lateWon) && typeof B.lateW === "number" && B.lateW + B.lateLost.length === (tA.lead4 >= S.LATE_LEAD ? 2 : 0) && S.LATE_LEAD === 15
        && qs.length >= 16 && qs.every((q) => q.gp === 2 && (Gm.maxP > 4 ? q.q.reduce((a, b) => a + b, 0) <= q.pts : q.q.reduce((a, b) => a + b, 0) === q.pts)),
        "game flow stats (0.81): the biggest lead held in the 4th quarter is kept for each side, with the record in games led by 15+ there; every player's points by quarter are summed", JSON.stringify([Fg.teams.map((t) => [t.team, t.maxLead, t.lead4, t.down4]), B.lateW, B.lateLost]));
    }
    // 0.75: every shot of the sample game, per player: his makes add up to his points in the box score.
    const shotPts = (x) => x.ev.reduce((n, [, k, m]) => n + (m ? (k === "3" ? 3 : k === "2" ? 2 : 1) : 0), 0);
    const off = Object.entries(Fg.shots).filter(([id, x]) => shotPts(x) !== Gm.players.find((p) => String(p.id) === id).boxPts).map(([, x]) => x.name);
    ok(off.length === 0 && Object.values(Fg.shots).every((x) => x.ev.every(([cs], i, a) => cs >= 0 && cs <= x.total + 1 && (i === 0 || cs >= a[i - 1][0]))),
      "game flow stats (0.75): a real game's shots per player add up to his points, each with his court time when he took it (never more than he played, never going backwards)", off.join(", "));
    // 0.72.7: the final two minutes. When the sample game qualifies, the players' points are the teams' points.
    const two2 = Fg.l2m;
    ok(two2 === null || (two2.periods >= 1 && Object.values(two2.players).reduce((n, x) => n + x.pts, 0) === two2.teams[0].pf + two2.teams[1].pf && two2.teams[0].pf === two2.teams[1].pa
      && Object.values(two2.players).every((x) => x.fgm <= x.fga && x.ftm <= x.fta && x.sec <= 120 * two2.periods + 1)),
      "game flow stats (0.72.7): a real game's final two minutes (if within 3): players' points add up to the two teams', makes never exceed attempts, nobody plays more than the window", JSON.stringify(two2 && [two2.periods, two2.teams]));
    // 0.72.6: fourth quarters. Five players are on the floor for each team in the 4th and in its last three minutes.
    const q4By = {}, l3By = {};
    for (const p of Fg.players) { q4By[p.team] = (q4By[p.team] || 0) + p.q4; l3By[p.team] = (l3By[p.team] || 0) + p.last3; }
    const fq = Object.values(two.fourth)[0];
    ok(Object.values(q4By).every((v) => Math.abs(v - 3600) <= 60) && Object.values(l3By).every((v) => Math.abs(v - 900) <= 30) && typeof Fg.closeLate === "boolean" && Fg.teams[0].after3 === -Fg.teams[1].after3
      && Object.values(two.fourth).every((x) => x.gs === 2 && x.sat <= 2 && x.closed <= x.close && x.miss <= x.close),
      "game flow stats (0.72.6): a real game's 4th-quarter seconds add up to five players a side; starters' fourth quarters (sat it out, finished the close ones) are counted per player", JSON.stringify([q4By, l3By, Fg.closeLate, fq]));
    const lite = {}; S.flowStats([{ row, c }], lite);
    const Lm = lite[String(c.id)], Gp = Gm.players.filter((p) => p.played);
    ok(Lm && Lm.players.length === Gp.length && Lm.assists.length === Gm.assists.length && Lm.box.homeTeam.teamTricode === Gm.box.homeTeam.teamTricode
      && Lm.players.every((p) => JSON.stringify(p.ptsByPeriod) === JSON.stringify(Gp.find((x) => x.id === p.id).ptsByPeriod)),
      "game flow (0.60): the season's lite file carries the same players, points by period and assists the page's model has");
  }
}

// ---------- vs top teams: players vs top defenses and 30-point games allowed (moved from GameFlow, 0.54) ----------
{
  const V = await import("../src/situations/vsplayers.js");
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const L = (min, pts, fgm, fga) => keys.map((k) => ({ min, pts, fgm, fga }[k] ?? 0));
  const opp = ["TOP", "TOP", "TOP", "BBB", "CCC", "DDD"];
  const files = {
    AAA: { team: "AAA", keys, names: { 1: "Star", 2: "Bench", 3: "Rarely" }, games: opp.map((o, i) => ({ d: `2026-11-0${i + 1}`, opp: o, home: true, pf: 100, pa: 90,
      pl: { 1: L(36, o === "TOP" ? 18 : 30, o === "TOP" ? 6 : 11, 18), 2: L(10, 3, 1, 3), ...(i === 0 ? { 3: L(30, 20, 8, 15) } : {}) } })) },
  };
  const pg = V.playerGames(files);
  const res = V.vsDefenses(pg, new Set(["TOP"]));
  const star = res.rows.find((r) => r.name === "Star");
  ok(res.rows.length === 1 && star.vsAvg === 18 && star.restAvg === 30 && star.gap === -12 && star.vsFg.m === 18 && star.vsFg.t === 54 && Math.abs(star.fgGap - (100 * 18 / 54 - 100 * 33 / 54)) < 1e-9
    && res.quiet === 1 && res.thin === 1, "vs top defenses: the gap is top group vs the rest (they partition his games); FG% pooled; a 3-point scorer and a 1-game player left out and counted", JSON.stringify(res));
  const t = V.thirtyAllowed(pg, { BBB: { games: 1, drtg: 110 } });
  ok(t.games.length === 3 && t.teams.find((x) => x.tri === "BBB").allowed === 1 && t.teams.find((x) => x.tri === "TOP").allowed === 0, "30-point games allowed: credited to the defense they were scored against", JSON.stringify(t.teams.slice(0, 3)));
  const { topSet } = await import("../src/situations/ratings.js");
  ok([...topSet({ A: { w: 5, l: 2 }, B: { w: 3, l: 3 }, C: { w: 1, l: 4 } }, "winning", "record")].join() === "A", "vs top teams: 'all winning teams' is every team over .500");
  ok(fs.readFileSync(path.join(root, "src", "situations", "vsplayers.js"), "utf8") === fs.readFileSync(path.join(root, "docs", "lib", "situations", "vsplayers.js"), "utf8"), "vs top teams: the page's copy of vsplayers.js is the build's");
}

// ---------- Rest & back-to-backs (src/situations/rest.js, moved from GameFlow, 0.55) ----------
{
  const R = await import("../src/situations/rest.js");
  const hb = [40, 85, 12, 34, 15, 20, 10, 33, 25, 8, 5, 13, 20];
  const G = (d, h, a, hs, as) => ({ d, h, a, hs, as, hb, ab: hb });
  const games = [G("2026-11-01", "AAA", "BBB", 110, 100), G("2026-11-02", "CCC", "AAA", 120, 100), G("2026-11-04", "AAA", "CCC", 105, 95), G("2026-11-08", "BBB", "AAA", 90, 100), G("2026-11-09", "AAA", "BBB", 99, 101)];
  const idx = R.restIndex(games);
  ok(idx["AAA|2026-11-01"] === null && idx["AAA|2026-11-02"] === 0 && idx["AAA|2026-11-04"] === 1 && idx["AAA|2026-11-08"] === 3 && idx["AAA|2026-11-09"] === 0 && idx["CCC|2026-11-04"] === 1,
    "rest: days off between games (0 = back-to-back), none for the opener", JSON.stringify(idx));
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const L = (pts) => keys.map((k) => ({ min: 34, pts, fgm: 8, fga: 18 }[k] ?? 0));
  const dates = ["2026-11-01", "2026-11-02", "2026-11-04", "2026-11-06", "2026-11-08", "2026-11-09", "2026-11-11", "2026-11-13"];
  const g2 = dates.map((d) => G(d, "AAA", "CCC", 100, 90));
  const files = { AAA: { team: "AAA", keys, names: { 1: "Tired Guy" }, games: dates.map((d) => ({ d, opp: "BBB", home: true, pf: 100, pa: 90, pl: { 1: L(["2026-11-02", "2026-11-09"].includes(d) ? 12 : 24) } })) } };
  const out = R.restData({ games: g2, teamFiles: files, tonight: [{ home: "AAA", away: "BBB" }], today: "2026-11-14" });
  const p = out.players.find((x) => x.name === "Tired Guy");
  ok(p && p.b2bGp === 2 && p.restGp === 5 && p.gap === -12 && p.flag, "rest, players: 12 points on the two back-to-backs against 24 otherwise is a clear split", JSON.stringify(p));
  ok(out.tonight[0].homeRest === 0 && out.teams.find((t) => t.tri === "AAA").by[0].n === 2, "rest: tonight's rest from the last game (11/13 then 11/14 = back-to-back)", JSON.stringify(out.tonight));
  const { tonightStorylines: TS } = await import("../src/anticipate/tonight.js");
  const st = TS({ watch: { today: "2026-11-14", games: [{ id: "1", awayTri: "BBB", homeTri: "AAA" }], teams: [] }, rest: out, maxLines: 10 })[0].lines.filter((l) => l.kind === "rest");
  ok(st.length === 2 && st.some((l) => /^AAA: second night of a back-to-back.*2-0 on no rest/.test(l.text)) && st.some((l) => /Tired Guy on no rest: 12\.0 points in 2 back-to-back games vs 24\.0/.test(l.text)),
    "rest on the Watch List: the team on a back-to-back and its regular with a clear split", JSON.stringify(st.map((l) => l.text)));
}

// ---------- Hot hand (src/situations/form.js, moved from GameFlow, 0.56) ----------
{
  const F = await import("../src/situations/form.js");
  const g = (pts, min = 30) => ["2026-11-01", min, pts, 5, 3, 1];
  const players = {
    1: { name: "Heater", team: "AAA", g: [12, 14, 10, 13, 11, 12, 25, 28, 24, 26, 30].map((p) => g(p)) },
    2: { name: "One Night", team: "AAA", g: [12, 14, 10, 13, 11, 12, 10, 40, 11, 12, 10].map((p) => g(p)) },
    3: { name: "Cameo", team: "BBB", g: [12, 14, 10, 13, 11, 12, 25, 28, 24, 26, 30].map((p, i) => g(p, i === 9 ? 6 : 30)) },
  };
  const rows = F.formRows(players, { len: 5, key: "pts", dir: "up", minMinutes: 20 });
  const h = rows.find((r) => r.name === "Heater"), o = rows.find((r) => r.name === "One Night");
  ok(h && h.real && h.z > 3 && h.above === 5 && o && !o.real && !rows.some((r) => r.name === "Cameo"),
    "hot hand: a real heater; one 40 doesn't make a heater (median test); a 6-minute game in the stretch takes a player out", JSON.stringify(rows.map((r) => [r.name, r.real, r.z.toFixed(1)])));
  const runs = F.formRuns(players, { key: "pts", dir: "up" });
  ok(runs.find((r) => r.name === "Heater")?.run === 5 && !runs.some((r) => r.name === "One Night" && r.run > 1), "hot hand: runs above his own normal (5 straight)", JSON.stringify(runs.map((r) => [r.name, r.run])));
  const { tonightStorylines: TS } = await import("../src/anticipate/tonight.js");
  const st = TS({ watch: { today: "2026-11-05", games: [{ id: "1", awayTri: "BBB", homeTri: "AAA" }], teams: [] }, form: { players }, maxLines: 10 })[0].lines.filter((l) => l.kind === "form");
  ok(st.length === 1 && /^Heater is hot: 26\.6 points over his last 5 vs 12\.0/.test(st[0].text), "hot hand on the Watch List: only the real heater", JSON.stringify(st.map((l) => l.text)));
}

// ---------- NBA Cup vs the rest of the season (src/records/cupform.js, moved from GameFlow, 0.57) ----------
{
  const { cupVsSeason } = await import("../src/records/cupform.js");
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const L = (pts) => keys.map((k) => ({ min: 32, pts, fgm: 8, fga: 16 }[k] ?? 0));
  const days = ["2026-10-22", "2026-10-24", "2026-10-26", "2026-10-28", "2026-10-30", "2026-11-01", "2026-11-03", "2026-11-06"];
  const cupDays = new Set(["2026-10-30", "2026-11-06"]);
  const files = { AAA: { team: "AAA", keys, names: { 1: "Cup Star" }, games: days.map((d, i) => ({ d, opp: "BBB", home: true, pf: cupDays.has(d) ? 120 : 100, pa: 100 - i, pl: { 1: L(cupDays.has(d) ? 30 : [18, 20, 22, 19, 21, 20][i > 4 ? i - 2 : i] ?? 20) } })) } };
  const r = cupVsSeason({ teamFiles: files, cup: { group: [{ d: "2026-10-30", away: "BBB", home: "AAA" }, { d: "2026-11-06", away: "BBB", home: "AAA" }], knockout: {} } });
  const p = r.players[0];
  ok(p && p.cupGp === 2 && p.baseGp === 6 && p.cup.pts === 30 && Math.abs(p.base.pts - 119 / 6) < 1e-9 && p.z.pts > 5 && r.teams[0].cup.n === 2,
    "Cup vs season: Cup games against every other game (a partition), z on the spread of a 2-game average", JSON.stringify([p?.cup, p?.base, p?.z, r.teams[0]]));
}

// ---------- One player with / without another (src/situations/pairsplit.js, moved from GameFlow, 0.58) ----------
{
  const P = await import("../src/situations/pairsplit.js");
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const L = (min, pts) => keys.map((k) => ({ min, pts, fgm: 5, fga: 10 }[k] ?? 0));
  const files = {
    AAA: { team: "AAA", keys, names: { 1: "Guard", 2: "Big" }, games: [
      { d: "2026-11-01", opp: "BBB", home: true, pf: 100, pa: 90, pl: { 1: L(30, 20), 2: L(30, 10) } },
      { d: "2026-11-03", opp: "CCC", home: true, pf: 100, pa: 90, pl: { 1: L(30, 30) }, inj: { 2: "Out" } },
      { d: "2026-11-05", opp: "BBB", home: false, pf: 90, pa: 100, pl: { 1: L(30, 25), 2: L(0, 0) } } ] },
    BBB: { team: "BBB", keys, names: { 3: "Rival" }, games: [
      { d: "2026-11-01", opp: "AAA", home: false, pf: 90, pa: 100, pl: { 3: L(34, 25) } },
      { d: "2026-11-05", opp: "AAA", home: true, pf: 100, pa: 90, pl: {}, inj: { 3: "Out" } } ] },
  };
  const t = P.pairSplit(files, 1, 2);
  ok(t.mode === "teammates" && t.with.n === 1 && t.without.n === 2 && t.without.avg.pts === 27.5, "with / without: a teammate on the injury report or listed with 0 minutes is 'without'", JSON.stringify([t.with.n, t.without.n, t.without.avg.pts]));
  const o = P.pairSplit(files, 1, 3);
  ok(o.mode === "opponents" && o.with.n === 1 && o.without.n === 1 && o.with.avg.pts === 20 && o.without.avg.pts === 25, "with / without: an opponent splits his games against that team (new)", JSON.stringify([o.mode, o.with.n, o.without.n]));
  ok(P.everyone(files).map((x) => x.name).join() === "Big,Guard,Rival", "with / without: the league picker lists everyone who has played");
}

// ---------- 0.76: the user's 20 screenshots (11/16): notes that read wrong, and lists not yet tracked ----------
{
  const P = await import("../src/notes/pdf-layout.js");
  const N = await import("../src/notes/narrative.js");
  const F = await import("../src/notes/facts.js");
  // Text drawn as pictures (Milwaukee): each run measures short, so "Los A" + "ngeles" opened a gap.
  const run = (x, str, w, y = 655.5) => ({ x, y, w, h: 9, str });
  const gap = (x, w, y = 655.5) => ({ x, y, w, h: 9, str: " ", space: true });
  const items = [run(40, "on Nov. 11 vs. the Los A", 87), gap(127, 17.4), run(144.4, "ngeles Lakers, marking the fifth", 114.5), gap(258.9, 20.3), run(279.2, "-", 2.8), gap(281.9, 1),
    run(282.9, "earliest start by a rookie since the 2014", 143.8), gap(426.7, 24.7), run(451.4, "-", 2.8), gap(454.1, 1.1), run(455.2, "15 campaign. Check", 72.7), gap(528, 14.6), run(542.6, "out when", 34.9)];
  for (let i = 0; i < 6; i++) items.push(run(40, `filler line number ${i}`, 80, 600 - i * 12));
  const before = P.buildLines(items.map((x) => ({ ...x })))[0].text;
  ok(/Los A\s+ngeles/.test(before) && /fifth\s+-\s*earliest/.test(before), "pictured text: without the fix the runs read apart", before);
  const rects = items.filter((x) => !x.space).map((x, i, all) => { const next = all[i + 1]; return { x: x.x, y: x.y - 2.2, h: 11.52, w: (next && next.y === x.y ? next.x - x.x : x.w * 1.2) + 4.05 }; });
  const raws = items.filter((x) => !x.space).map((x) => ({ x: x.x, y: x.y, str: /Check$/.test(x.str) ? `${x.str} ` : x.str }));
  const fixed = items.map((x) => ({ ...x }));
  const n = P.picturedText(fixed, { rects, raws });
  const after = P.buildLines(fixed)[0].text;
  ok(n === 13 && after === "on Nov. 11 vs. the Los Angeles Lakers, marking the fifth-earliest start by a rookie since the 2014-15 campaign. Check out when", "pictured text: printed widths and the file's own spaces put the line back together", after);
  const plainPage = items.map((x) => ({ ...x }));
  ok(P.picturedText(plainPage, { rects: rects.slice(0, 4), raws }) === 0 && plainPage.length === items.length, "pictured text: a page whose runs don't sit on pictures is left exactly as it is");

  // A line ending in a hyphen: the notes themselves say whether it is a cut word or a compound.
  const vocab = N.wordCounts(["a double-double and a second straight game", "the franchise record", "his career and career-high", "second second longest"]);
  ok(N.keepsHyphen("double", "double", vocab) && N.keepsHyphen("second", "longest", vocab) && N.keepsHyphen("1968", "69", vocab) && N.keepsHyphen("career", "high", vocab), "hyphen at a line end: compounds and seasons keep it (double-double, second-longest, 1968-69)");
  ok(!N.keepsHyphen("fran", "chise", vocab) && !N.keepsHyphen("Alex", "ander", vocab), "hyphen at a line end: a cut word is joined (franchise; a first half the notes never use alone)");
  const cell = (text, x0) => ({ text, x0, x1: x0 + text.length * 3.2, cx: x0 + text.length * 1.6 });
  const row = (y, ...cells) => Object.assign(cells, { y });
  {
    const L = (text) => ({ text, cells: [{ x0: 40, x1: 560, cx: 300, text }], charX: [] });
    const b = N.blocks({ pages: [{ page: 1, width: 612, lines: [L("Towns has recorded a double-"), L("double in nine straight games, tied for the second-"), L("longest streak since the 1968-"), L("69 season in fran-"), L("chise history. The franchise record is 13.")] }] });
    ok(/a double-double in nine straight games, tied for the second-longest streak since the 1968-69 season in franchise history\./.test(b[0].text), "hyphen at a line end: read in the notes' own text", b[0].text);
  }

  // Two lists of sentences side by side: read one side, then the other.
  const rows = [
    row(346, cell("UPCOMING MILESTONES", 49), cell("MILESTONES ACHIEVED in 2026-27", 327)),
    row(337, cell("P.J. Washington Jr. needs 10 assists (990) to reach 1,000 career assists.", 49), cell("Marcus Sasser hit 200 career 3-pointers (vs. SAS, 10/24/26).", 327)),
    row(328, cell("Santi Aldama needs 65 points (2935) for 3000 career points.", 49), cell("P.J. Washington Jr. surpassed 6,000 career points (6,009) and 2,000 points as a", 327)),
    row(319, cell("Naji Marshall (494) needs 6 more assists as a Dallas Maverick for 500 career assists", 49), cell("Maverick (2,010), moving into 47th place on Dallas' all-time scoring list (vs. SAC,", 327)),
    row(310, cell("with the franchise.", 49), cell("11/2/26).", 327)),
    row(250, cell("2 0 2 6 - 2 7  D A L L A S  M A V E R I C K S  G A M E  N O T E S", 180)),
  ];
  const side = N.sideBySide(rows);
  ok(side.indexOf("with the franchise.") === side.indexOf("Naji Marshall (494) needs 6 more assists as a Dallas Maverick for 500 career assists") + 1
    && side.indexOf("11/2/26).") === side.indexOf("Maverick (2,010), moving into 47th place on Dallas' all-time scoring list (vs. SAC,") + 1
    && side[side.length - 1].startsWith("2 0 2 6"), "side by side: each list is read whole, and the footer below the gap is not part of either", side.join(" / "));
  const table = [row(100, cell("1. Reggie Miller", 40), cell("4,141", 300)), row(90, cell("2. Vern Fleming", 40), cell("4,038", 300)), row(80, cell("3. Mark Jackson", 40), cell("3,294", 300)), row(70, cell("4. Jamaal Tinsley", 40), cell("2,786", 300))];
  ok(N.sideBySide(table).join("|") === "1. Reggie Miller 4,141|2. Vern Fleming 4,038|3. Mark Jackson 3,294|4. Jamaal Tinsley 2,786", "side by side: a table still reads across");

  // The streak in the notes against the box scores (Towns: "eighth consecutive", "nine straight", really 12).
  const keys = ["starter", "min", "pts", "reb", "ast", "stl", "blk"];
  const box = { keys, games: Array.from({ length: 12 }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, pl: { 7: [1, 34, 22, 12, 3, 1, 1], 8: [1, 30, i < 9 ? 31 : 12, 4, 5, 0, 0] } })) };
  const a8 = F.statedStreak("Towns also recorded his eighth consecutive double-double to start the season which ranks fourth in franchise history.");
  const a9 = F.statedStreak("Towns has recorded a double-double in nine straight games to start the season, which is tied for the second-longest double-double streak to start a season in franchise history.");
  ok(a8?.n === 8 && a8.key === "dd" && a9?.n === 9 && a9.key === "dd", "streak check: the count and the kind are read from both wordings");
  ok(F.statedStreak("He had a double-double in nine straight games last season.") === null && F.statedStreak("His streak of 12 straight double-doubles was snapped on Friday.") === null, "streak check: last season's streak and one that ended are left as written");
  const th = F.statedStreak("Has scored 30+ points in five straight games this season.");
  ok(th?.n === 5 && th.key === "pts30" && F.streakInBox(box, "8", th).now === 0 && F.streakInBox(box, "7", a9).now === 12 && F.streakInBox(box, "7", a9).all === true, "streak check: counted back from his last game in the box scores");
  const lines = F.checkStreaks([
    { text: "Towns also recorded his eighth consecutive double-double to start the season which ranks fourth in franchise history.", player: "Karl-Anthony Towns", playerId: "7", score: 3 },
    { text: "Towns has recorded a double-double in nine straight games to start the season, which is tied for the second-longest double-double streak to start a season in franchise history.", player: "Karl-Anthony Towns", playerId: "7", score: 3 },
    { text: "Clarkson has now scored 8,699 points off the bench in his career.", player: "Jordan Clarkson", playerId: "8", score: 3 },
  ], box);
  ok(lines[1].tag === "Now 12 straight" && /box scores have it at 12 straight double-doubles through 11\/12 \(every game he has played this season\), so where this line ranks it is out of date\. 13 if he does it again tonight\./.test(lines[1].hook.text) && !lines[2].streakNow, "streak check: a line behind the box scores says so, with the count and what tonight makes it", lines[1].hook?.text);
  {
    // 0.145.0 (the consistency audit, 11/24): Kyshawn George's "Made three three-pointers for the third straight game,
    // tying the longest streak of his career" had no "has" and no date: it was not checked and ranked #4 in the briefing.
    const g3 = F.statedStreak("Made three three-pointers for the third straight game, tying the longest streak of his career.");
    const dd5 = F.statedStreak("Recorded a double-double for the fifth consecutive game.");
    const r4 = F.statedStreak("Grabbed 10 rebounds in his fourth game in a row.");
    ok(g3?.n === 3 && g3.key === "fg3m3" && dd5?.n === 5 && dd5.key === "dd" && r4?.n === 4 && r4.key === "reb10"
      && F.statedStreak("Dybantsa logged a 20-point, 10-rebound double-double for the second game in a row on 11/20 at Chicago.") === null
      && F.statedStreak("Made three three-pointers for the third straight game on Nov. 4 vs. PHI.") === null
      && F.statedStreak("Had a double-double for the third straight game last season.") === null,
      "0.145.0: \"did X for the Nth straight game\" with no date is a streak to check; a dated recap and last season's are left as written");
    const gk = ["min", "fg3m"], gg = (d, m) => ({ d, opp: "XXX", pl: { 9: [30, m] } });
    const wiz = { keys: gk, games: [gg("2026-10-30", 4), gg("2026-11-02", 4), gg("2026-11-04", 3), gg("2026-11-06", 5), gg("2026-11-18", 4), gg("2026-11-20", 1), gg("2026-11-22", 6)] };
    const kg = F.checkStreaks([{ text: "Made three three-pointers for the third straight game, tying the longest streak of his career.", player: "Kyshawn George", playerId: "9", type: "other", tag: "Notes" }], wiz)[0];
    ok(kg.tag === "Streak over" && kg.hook.text === "Not active: the notes say 3 straight with 3+ threes; the box scores have 1 through 11/22.",
      "0.145.0: George's line is over in the box scores, so it is tagged \"Streak over\" (ranked down, never a top line)", JSON.stringify([kg.tag, kg.hook?.text]));
    // Two dates for one game (WAS notes, 11/24: Sarr's 25 vs Houston "on 11/16" in one line and "on 11/15" in the next).
    const wk = { keys: ["min"], games: [{ d: "2026-10-21", opp: "MIL", pl: {} }, { d: "2026-11-15", opp: "HOU", pl: {} }, { d: "2026-11-16", opp: "MEM", pl: {} }, { d: "2026-11-20", opp: "CHI", pl: {} }] };
    const dl = F.checkDates([{ text: "Put up 25 points … on 11/16 vs. HOU, scoring 25+ points in consecutive games." }, { text: "25 points on .692 shooting on 11/15 vs. Houston." },
      { text: "A double-double on 11/20 at Chicago." }, { text: "His 10th straight vs. BKN (11/8/25)." }, { text: "Had 30 vs. HOU on 3/2." }], wk);
    ok(dl[0].hook?.text === "Date check: the box scores have the Rockets game on 11/15, not 11/16." && dl[0].dateCheck?.actual === "2026-11-15"
      && !dl[1].hook && !dl[2].hook && !dl[3].hook && !dl[4].hook,
      "0.145.0: a date next to an opponent the team didn't play that day, but did within 3 days, is flagged with the box scores' date; right dates, other seasons and far-off dates are left alone", JSON.stringify(dl.map((l) => l.hook?.text)));
    // 0.146.0: the notes' games-played runs against ours (the user, 11/24: a self-check keeps them consistent).
    const said = ["Mikal Bridges has played in 655 consecutive games, the longest active streak in the NBA.", "Champagnie has appeared in 203 straight games.",
      "His 102 consecutive games played rank third among active players.", "has played in 100 consecutive regular-season games",
      "He scored 20+ in five straight games.", "His 185-game iron man streak ended on 11/18.", "has started 40 consecutive games", "He has played in each of the last 12 games.",
      "Wizards guard Bub Carrington, who grew up in Northwest Baltimore, played in 179 consecutive games to start his career."].map(F.statedPlayedRun);
    ok(JSON.stringify(said) === JSON.stringify([655, 203, 102, 100, null, null, null, null, null]),
      "0.146.0: a current games-played run is read from the notes' wording; scoring runs, ended runs, starts and \"each of the last N\" are not", JSON.stringify(said));
    const gpl = F.checkGamesPlayed([{ text: "Has played in 655 consecutive games.", playerId: "1" }, { text: "Has appeared in 203 straight games.", playerId: "2" },
      { text: "Has played in 176 consecutive games.", playerId: "3" }, { text: "Has played in 50 straight games.", playerId: "4", guessed: true }], [["1", 655, "2026-11-22"], ["2", 202, "2026-11-22"]]);
    ok(!gpl[0].hook && gpl[0].gpCheck?.now === 655 && gpl[1].hook?.text === "Games check: our box scores count 202 straight games played through 11/22, not 203."
      && /no current run/.test(gpl[2].hook?.text || "") && gpl[2].gpCheck?.now === 0 && !gpl[3].gpCheck,
      "0.146.0: a games-played run that differs from our count gets a games check (ours with its date, or no run at all); a matching one or a guessed player is left alone", JSON.stringify(gpl.map((l) => l.hook?.text || null)));
  }
  {
    // 0.151.0: lineups from NBA.com's rotations (src/situations/lineups.js)
    const LU = await import("../src/situations/lineups.js");
    const st = [["a", "A", 0, 28800], ["b", "B", 0, 28800], ["c", "C", 0, 28800], ["d", "D", 0, 14400], ["e", "E", 0, 28800], ["f", "F", 14400, 28800]];
    const ev = LU.scoringEvents([{ period: 1, clock: "PT11M00.00S", scoreHome: "2", scoreAway: "0" }, { period: 2, clock: "PT00M00.00S", scoreHome: "2", scoreAway: "3", actionType: "3pt" },
      { period: 3, clock: "PT12M00.00S", scoreHome: "2", scoreAway: "3" }, { period: 4, clock: "PT04M00.00S", scoreHome: "4", scoreAway: "3" }]);
    const T = LU.teamIntervals(st, ev.events, true);
    const sum = T.iv.reduce((a, r) => [a[0] + r[1] - r[0], a[1] + r[3], a[2] + r[4]], [0, 0, 0]);
    const second = T.iv.find((r) => r[0] === 14400), clutch = T.iv.find((r) => r[0] === LU.CLUTCH_FROM);
    const agg = LU.aggregate(T.iv.map((r) => ({ t0: r[0], t1: r[1], on: r[2], pf: r[3], pa: r[4], g: 0 })), 2);
    ok(ev.events.length === 3 && ev.events[0][0] === 600 && sum[0] === 28800 && sum[1] === 4 && sum[2] === 3 && T.short === 0
      && second && second[2].includes("f") && !second[2].includes("d") && second[5] === -1 && clutch && LU.isClutch(clutch[0], clutch[5])
      && agg.get("a|b").sec === 2880 && agg.get("a|d").sec === 1440 && agg.get("a|d").pa === 3 && !agg.has("d|f") && LU.groups(["a", "b", "c", "d", "e"], 3).length === 10,
      "0.151.0: lineups: the five on the floor between check-ins, cut at periods and at clutch time; the score from the play-by-play at those moments; a 3 at the buzzer counts for the five on before the break; 2-man groups add up across stretches",
      JSON.stringify([ev.events, sum, T.iv.map((r) => [r[0], r[1], r[2].join(""), r[3], r[4], r[5]])]));
  }
  {
    // 0.146.0: the man a Watch List pass is against still adds to his total (src/anticipate/rivals.js).
    const { rivalLookup } = await import("../src/anticipate/rivals.js");
    const keys = ["side", "min", "pts", "reb", "ast", "stl", "blk", "fga", "fta", "tov", "pf", "fgm", "fg3m"];
    const row = (pts) => [0, 30, pts, 5, 5, 1, 0, 15, 4, 2, 2, 7, 2];
    const tf = (tri, names, ids) => ({ keys, names, games: Array.from({ length: 6 }, (_, i) => ({ d: `2026-11-${String(10 + i).padStart(2, "0")}`, opp: "XXX", pl: Object.fromEntries(ids.map((id) => [id, row(20 + i)])) })) });
    const files = { GSW: tf("GSW", { 10: "Stephen Curry", 11: "Draymond Green" }, ["10", "11"]), SAC: tf("SAC", { 20: "DeMar DeRozan" }, ["20"]) };
    const look = rivalLookup(files, { tonightTeams: new Set(["SAC"]), statusOf: (n) => (n === "DeMar DeRozan" ? "Questionable" : null), makeSampler });
    const a = look({ kind: "pass", scope: "nba", team: "GSW", passing: { player: "DeMar DeRozan" }, espnId: "10" });
    const b = look({ kind: "pass", scope: "franchise", team: "GSW", passing: { player: "DeMar DeRozan" }, espnId: "10" });
    const c = look({ kind: "pass", scope: "franchise", team: "GSW", passing: { player: "Draymond Green" }, espnId: "10" });
    const d = look({ kind: "pass", scope: "nba", team: "GSW", qualifier: "by a teen", passing: { player: "DeMar DeRozan" }, espnId: "10" });
    const e = look({ kind: "pass", scope: "nba", team: "GSW", passing: { player: "Wilt Chamberlain" }, espnId: "10" });
    const f = look({ kind: "pass", scope: "franchise", team: "GSW", passing: { player: "Green" }, espnId: "10" });
    const g = look({ kind: "pass", scope: "season", team: "GSW", qualifier: "SINCE 2018", passing: { player: "DeMar DeRozan" }, espnId: "10" });
    ok(f?.id === "11" && g?.id === "20", "0.146.0: a franchise list's surname is the one teammate with it; a \"since 2018-19\" window still grows", JSON.stringify([f?.id, g?.id]));
    ok(a?.id === "20" && a.tonight && a.pTonight === 0.6 && !b && c?.id === "11" && c.tonight === false && c.pTonight === 0 && !d && !e,
      "0.146.0: a pass's rival adds wherever he plays on an all-time list, only on the same franchise on a franchise list, never on a subset list or when retired; tonight only if his team plays, capped by his grade",
      JSON.stringify([a && [a.id, a.tonight, a.pTonight], !!b, c && [c.id, c.tonight, c.pTonight], !!d, !!e]));
    const solo = simulate({ need: 10, stat: "pts", sample: makeSampler([{ stats: { pts: 12 } }]), games: [{ pPlay: 1 }], sims: 500 });
    const vs = simulate({ need: 10, stat: "pts", sample: makeSampler([{ stats: { pts: 12 } }]), games: [{ pPlay: 1 }], rivals: [{ sample: makeSampler([{ stats: { pts: 20 } }]), games: [{ pPlay: 1 }] }], sims: 500 });
    ok(solo.byGame[0] > 0.9 && vs.byGame[0] < 0.1, "0.146.0: a rival who plays the same night moves the bar (12 against a need of 10 passes him alone, not when he adds 20)", JSON.stringify([solo.byGame[0], vs.byGame[0]]));
  }
  {
    // 0.113 (the user, 11/19: "taken as factual without fact checking"): a team's winning or losing streak is set
    // against its results; a count nothing can check is not called active and promises no next number.
    const g = (d, opp, pf, pa, pl = {}) => ({ d, opp, pf, pa, pl });
    const spurs = { keys: ["side", "min", "pts", "stl", "blk"], games: [g("2026-10-23", "HOU", 110, 114), ...["24", "27", "28", "31"].map((x) => g(`2026-10-${x}`, "DAL", 120, 100)), ...["02", "04", "06", "07", "09", "11", "13"].map((x) => g(`2026-11-${x}`, "UTA", 120, 100, { 5: [0, 30, 20, x <= "07" ? 1 : 0, 1] })), g("2026-11-15", "UTA", 110, 102, { 5: [0, 30, 20, 1, 1] }), g("2026-11-17", "DET", 93, 105, { 5: [0, 30, 20, 1, 2] })] };
    const run = (text, box, extra = {}) => F.checkStreaks([{ text, player: null, playerId: null, type: "streak", tag: "Active streak · 11", hook: F.hookFor({ text, facts: F.describe(text, {}) }, {}), ...extra }], box)[0];
    const over = run("As of Nov. 13, San Antonio has won 11 straight games.", spurs);
    const upTo = (n) => ({ ...spurs, games: spurs.games.slice(0, n) });
    const same = run("As of Nov. 13, San Antonio has won 11 straight games.", upTo(12)), behind = run("As of Nov. 13, San Antonio has won 11 straight games.", upTo(13)), never = run("San Antonio has lost 5 straight games.", spurs);
    const home = run("As of Nov. 6, San Antonio has won 6 straight home games.", spurs), sell = run("The franchise-record home sellout streak is at 613 consecutive games.", spurs);
    ok(over.tag === "Streak over" && over.hook.text === "No longer true: the streak ended at 12 on 11/17 (lost to DET 93-105)." && over.hook.stale === true && over.hook.live === false
      && same.tag === "Active streak · 11" && same.hook.text === "Checked against the results (through 11/13). 12 with a win tonight." && same.hook.live === true
      && behind.tag === "Now 12 straight" && behind.hook.text === "The notes are behind: the results have it at 12 straight through 11/15. 13 with a win tonight."
      && never.tag === "Streak over" && never.hook.text === "Does not match the results: the notes say lost 5 straight; the team has lost its last game through 11/17." && never.hook.stale === true,
      "0.113: a team's winning streak against its results: over (when it ended, at what, and who ended it), the same (and only then \"12 with a win tonight\"), behind the results, and one the results never show",
      JSON.stringify([over, same, behind, never].map((l) => [l.tag, l.hook.text])));
    ok(home.tag === "Streak · 6 (notes)" && home.hook.text === "The notes' count, not checked: it is dated 11/6 and the team has played 6 games since." && home.hook.live === false
      && sell.tag === "Streak · 11 (notes)" && sell.hook.text === "The notes' count, not checked against the results." && F.statedTeamStreak("The Spurs' 10-game winning streak from Oct. 24 to Nov. 11 was their longest since 2019.") === null,
      "0.113: a streak over some of the games only (home games), or of something the results do not hold (sellouts), is the notes' count: not called active, no next number, and its own date is held against the games played since; a streak that is told as finished is left alone",
      JSON.stringify([home, sell].map((l) => [l.tag, l.hook.text])));
    const ann = F.annotate([{ text: "Has started 100 consecutive regular season games.", kind: "context", player: "A B", playerId: "5", score: 3 }, { text: "As of Nov. 13, San Antonio has won 11 straight games.", kind: "context", player: null, playerId: null, score: 3 }], { box: upTo(12), teamNames: ["Spurs"] });
    ok(ann[0].tag === "Streak (notes)" && !ann[0].hook && ann[1].tag === "Active streak · 11",
      "0.113: \"Active streak\" is said only of a count checked tonight; a games-started streak the box scores cannot count keeps its number as the notes' own", JSON.stringify(ann.map((l) => [l.tag, l.hook?.text])));
    const wem = F.checkStreaks([{ text: "Victor Wembanyama became the 7th player in NBA history to have both a block and a steal in 10 straight games to start a season.", player: "Victor Wembanyama", playerId: "5", type: "streak", tag: "Active streak · 10", hook: { text: "11 if he does it again tonight.", live: true } }], spurs)[0];
    const old = F.staleCount({ text: "Has appeared in 176 consecutive games.", player: "A B", playerId: "5", type: "streak", tag: "Active streak · 176", hook: { text: "177 if he plays tonight.", live: true } }, "2026-11-13", spurs);
    const fresh = F.staleCount({ text: "Has appeared in 176 consecutive games.", player: "A B", playerId: "5", type: "streak", tag: "Active streak · 176", hook: { text: "177 if he plays tonight.", live: true } }, "2026-11-18", spurs);
    ok(wem.tag === "Streak over" && wem.hook.text === "Not active: the notes say 10 straight with a block and a steal; the box scores have 2 through 11/17." && wem.hook.live === false && !wem.hook.stale
      && old.tag === "Streak · 176 (old count)" && old.hook.text === "Out of date: the notes have printed this count unchanged since 11/13 and he has played 3 games since. It is longer now, or over." && old.hook.stale === true
      && fresh.tag === "Active streak · 176" && fresh.hook.live === true,
      "0.113: a player's streak the box scores have shorter than the notes is not active (the line itself stays true); a count printed unchanged while he played three more games is out of date; one first read today is left alone",
      JSON.stringify([wem, old, fresh].map((l) => [l.tag, l.hook.text])));
  }
  const tr = F.trimLines(lines, { box, today: "2026-11-13" });
  ok(tr.keep.some((l) => /nine straight/.test(l.text)) && tr.trimmed.length === 1 && /^an older count of the same streak \(8; it is at 12\)/.test(tr.trimmed[0].trimmed), "streak check: the older count of the same streak is trimmed, the latest kept", tr.trimmed.map((l) => l.trimmed).join(" | "));

  // A team box's heading names what its bullet is about; a player's bullet near the team's name is not the team's.
  {
    const L = (text) => ({ text, cells: [{ x0: 40, x1: 560, cx: 300, text }], charX: [] });
    const doc = { pages: [{ page: 1, width: 612, lines: [
      L("Rockets are 0-0 when having more turnovers than assists (0-1 in 2025-26) and 1-0 when opponents did so (2-0 in 2025-26) Rockets 3-Point Percentage • Shooting 34.4% over the past 5 games after shooting 39.1% the first 8 games (37.2% overall)."),
      L("He helped the Rockets rally late in the win over Denver, the team's fourth in a row. • Scored a career-high 14 points in a career-best 21 minutes of action on Oct. 31 vs. CLE, the most by a Rockets reserve this season."),
      L("P.J. Washington Jr. needs 10 assists (990) to reach 1,000 career assists."),
    ] }] };
    const h = N.readHistory(doc, [{ id: "1", name: "P.J. Washington" }], { seasonStart: "2026-10-01", today: "2026-11-15", teamWords: ["Houston", "Rockets"] });
    const shot = h.find((x) => /34\.4%/.test(x.text));
    ok(shot?.text.startsWith("Rockets 3-Point Percentage: Shooting 34.4% over the past 5 games") && shot.topic === "Rockets 3-Point Percentage" && shot.how === "team", "team box: the heading goes in front of its bullet", shot?.text);
    ok(!h.some((x) => /career-best 21 minutes/.test(x.text) && x.how === "team"), "team box: a bullet with the team's name somewhere before it is not credited to the team");
    ok(h.some((x) => x.text.startsWith("P.J. Washington Jr. needs 10 assists")), "a name's initials are not a heading: \"P.J.\" stays on the sentence", h.map((x) => x.text.slice(0, 30)).join(" | "));
    // Two lines that differ only in the heading's first word still count as two.
    const two = F.dedupe([{ text: "Rockets Offense: Scored 110+ points in each of the past 3 games after scoring below in each of the 3 games prior (116.2 per overall).", topic: "Rockets Offense", score: 2 },
      { text: "Rockets Defense: Since allowing 110+ points in each of the first 4 games (111.0 per) have done so 3 times over the past 9 games (105.8 per; 107.4 per overall).", topic: "Rockets Defense", score: 2 }]);
    ok(two.length === 2, "team box: the heading is not counted when two lines are compared for sameness");
    ok(F.trimReason({ text: "Three-time winner of the NBA Hustle Award (2018-19, 2021-22, 2022-5-of-19 over the past 4 games (career-high 37.1% overall). 23)." }, { today: "2026-11-15" }) === "garbled (two columns read as one)", "a season list cut by the next column is trimmed as garbled");
  }

  // Dallas' other two wordings for a milestone, and a former team's list.
  {
    const { readNeedsSentence } = await import("../src/notes/formats/needs-sentence.js");
    const L = (text) => ({ text, cells: [{ x0: 40, x1: 560, cx: 300, text }], charX: [] });
    const m = readNeedsSentence({ pages: [{ page: 5, width: 612, lines: [L("Santi Aldama needs 65 points (2935) for 3000 career points."), L("Naji Marshall (494) needs 6 more assists as a Dallas Maverick for 500 career assists with the franchise."), L("Max Christie needs 7 rebounds (990) for 1,000 career rebounds.")] }] });
    const al = m.find((x) => x.player === "Santi Aldama"), nm = m.find((x) => x.player === "Naji Marshall");
    ok(al?.stat === "pts" && al.target === 3000 && al.current === 2935 && al.scope === "career", "needs … for: \"needs 65 points (2935) for 3000 career points\"", JSON.stringify(al));
    ok(nm?.stat === "ast" && nm.target === 500 && nm.current === 494 && nm.scope === "franchise", "needs … for: a count with the team (\"as a Dallas Maverick … with the franchise\") is a franchise total", JSON.stringify(nm));
    ok(!m.some((x) => x.player === "Max Christie"), "needs … for: a printed total that doesn't add up to the target is not read (990 + 7 is not 1,000)");
  }

  // Indiana's franchise leaders: dotted rows, a tied row with no rank, "NBA YEARS ONLY", and a count of games.
  {
    const { readLeaderboards } = await import("../src/notes/formats/leaderboards.js");
    const L = (text, x = 488) => ({ text, charX: Array.from(text, (_, i) => x + i * 4), cells: [{ x0: x, x1: x + text.length * 4, cx: x + text.length * 2, text }] });
    const page = { page: 4, width: 612, lines: [L("FRANCHISE LEADERS", 505), L("NBA YEARS ONLY", 513), L("(1976-PRESENT)", 515), L("ASSISTS", 520),
      L("1.  Reggie Miller ...............................4,141"), L("2.  Vern Fleming .............................4,038"), L("3.  Mark Jackson .............................3,294"), L("4.  Jamaal Tinsley ...........................2,786"), L("5.  T.J. McConnell ........................2,385"), L("6.  Tyrese Haliburton .......................2,297"),
      L("GAMES WITH 10+ ASSISTS", 500),
      L("1.  Mark Jackson .......................................130"), L("2.  Tyrese Haliburton..........................129"), L("3.  Jamaal Tinsley .......................................85"), L("4.  Vern Fleming.......................................82"), L("5.  Don Buse............................................34"), L("6.  T.J. McConnell.....................................31"), L("7.  Micheal Williams....................................29"), L("Pooh Richardson....................................29", 504), L("9.  Andrew Nembhard ...............................28")] };
    const lbs = readLeaderboards({ pages: [page] });
    const ast = lbs.find((l) => l.title === "ASSISTS"), g10 = lbs.find((l) => /10\+ ASSISTS/.test(l.title));
    ok(ast?.scope === "franchise" && ast.stat === "ast" && ast.rows.length === 6 && ast.rows[4].player === "T.J. McConnell" && ast.rows[4].total === 2385, "franchise leaders: dotted rows are read, and \"NBA YEARS ONLY\" does not make it an NBA list", JSON.stringify(ast && { t: ast.title, s: ast.scope, n: ast.rows.length }));
    ok(g10?.stat === "g10ast" && g10.rows.find((r) => r.player === "Tyrese Haliburton")?.total === 129 && g10.rows.find((r) => r.player === "Pooh Richardson")?.rank === 7 && g10.rows[g10.rows.length - 1].player === "Andrew Nembhard", "franchise leaders: \"games with 10+ assists\" is a countable stat, and a row with no rank is tied with the one above", JSON.stringify(g10 && g10.rows.map((r) => [r.rank, r.player])));
    ok(statFromTitle("GAMES WITH 10+ ASSISTS") === "g10ast" && statFromTitle("# OF 30-PT GAMES") === "g30pt" && statFromTitle("games with 5+ 3PM in season") === "list", "stat from a title: a plain count of games is counted; a compound list keeps its title");
    const S2 = await import("../src/notes/stats.js");
    ok(S2.statLabel("g10ast") === "games with 10+ assists" && S2.statLabel("g30pt") === "30-point games", "stat label for a count of games");
    ok(statFromLine("g10ast", { played: true, stats: { ast: 11 } }) === 1 && statFromLine("g10ast", { played: true, stats: { ast: 9 } }) === 0 && statFromLine("g30pt", { played: true, stats: { pts: 31 } }) === 1, "a box-score line adds one to \"games with 10+ assists\" when he has 10");
    ok(importance({ stat: "fgm", kind: "round", target: 5000, scope: "career" }).score === importance({ stat: "ftm", kind: "round", target: 5000, scope: "career" }).score && importance({ stat: "fgm", kind: "round", target: 5000, scope: "career" }).reasons.some((w) => /weighted 0\.45/.test(w)), "importance: field goals and free throws are back at 0.45 (a comment had swallowed them)");
  }

  // A coach's record against every team.
  {
    const { readCoachRecord, coachLine } = await import("../src/notes/formats/coach-record.js");
    const nicks = Object.values((await import("../src/teams.js")).TEAMS).map((t) => t.nick);
    const L = (text) => ({ text });
    const trip = []; for (let i = 0; i < 30; i += 3) trip.push(nicks.slice(i, i + 3));
    const lines = [L("JOHN-BLAIR BICKERSTAFF'S OVERALL RECORD  JOHN-BLAIR BICKERSTAFF'S ALL-TIME RECORD VS. THE NBA (ENTERING 11/12/2026)"), L("2017-18  Grizzlies  15-48  .238  11  13  8  14  8  8"), L(trip[0].join("  "))];
    for (const t of trip.slice(1)) lines.push(L(`2020-21  Cavaliers  22-50  .306  ${t.map((n) => `${n}  10  9`).join("  ")}`));
    lines.push(L("CAREER REGULAR SEASON RECORD: 297-278"));
    const rec = readCoachRecord({ pages: [{ page: 26, lines }] });
    const first = Object.entries((await import("../src/teams.js")).TEAMS).find(([, t]) => t.nick === nicks[0])[0];
    ok(rec?.coach === "John-Blair Bickerstaff" && rec.entering === "11/12" && Object.keys(rec.teams).length === 30 && rec.teams[first].w === 11 && rec.teams[first].l === 13 && rec.ok, "coach record: all 30 teams, a row whose names and numbers print apart, and the rows add up to his career record", JSON.stringify(rec && { c: rec.coach, n: Object.keys(rec.teams).length, sum: rec.sum, ok: rec.ok }));
    ok(/^John-Blair Bickerstaff is 11-13 all-time against the \w+ as a head coach \(297-278 overall, entering 11\/12\)\.$/.test(coachLine(rec, first) || ""), "coach record: tonight's line", coachLine(rec, first));
    lines[lines.length - 1] = L("CAREER REGULAR SEASON RECORD: 300-278");
    ok(coachLine(readCoachRecord({ pages: [{ page: 26, lines }] }), first) === null, "coach record: a table that doesn't add up to his career record is not used");
    ok(F.describe("Rick Carlisle is 35-31 all-time against the 76ers as a head coach (1,017-931 overall, entering 11/15).", { matchup: true }).tag === "Coach vs. opponent", "coach record: tagged as the coach against the opponent");
  }

  // His own best start, and already at last season's count.
  {
    const { ownStartLines, alreadyLines } = await import("../src/anticipate/prep.js");
    const columns = ["date", "opp", "home", "result", "type", "min", "pts", "reb", "ast", "stl", "blk", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "tov"];
    const day = (y, i) => new Date(Date.UTC(y, 9, 20 + i * 2)).toISOString().slice(0, 10);
    const season = (y, n, pts) => Array.from({ length: n }, (_, i) => [day(y, i), "BOS", 1, "W", 2, 30, typeof pts === "function" ? pts(i) : pts, 5, 2, 1, 0, 4, 9, 1, 3, 2, 2, 1]);
    const logs = { columns, players: {
      1: [...season(2023, 60, 9), ...season(2024, 60, 10), ...season(2025, 70, (i) => (i < 10 ? 11 : 9))],     // best 10-game start: 110
      2: [...season(2016, 70, 26), ...season(2022, 70, 25), ...season(2023, 70, 27), ...season(2024, 70, 24), ...season(2025, 76, (i) => (i < 3 ? 22 : 12))],
      3: [...season(2023, 60, 12), ...season(2024, 60, 12), ...season(2025, 70, 12)],
      4: [2016, 2021, 2022, 2023, 2024, 2025].flatMap((y) => season(y, 70, 25)),
    } };
    const now = (n, pts, team) => Array.from({ length: n }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, team, min: 30, pts: typeof pts === "function" ? pts(i) : pts, reb: 5, ast: 2, stl: 1, blk: 0, fgm: 4, fga: 9, fg3m: 1, fg3a: 3, ftm: 2, fta: 2, tov: 1 }));
    const pg = { 1: now(10, (i) => (i < 4 ? 15 : 9), "LAC"), 2: now(11, (i) => (i < 4 ? 21 : 12), "LAC"), 3: now(10, 12, "UTA"), 4: now(11, 16, "HOU") };
    const names = { 1: "Derrick Jones Jr.", 2: "Brook Lopez", 3: "Steady Eddie", 4: "Kevin Durant" };
    const own = ownStartLines({ pg, logs, names });
    ok(own.find((l) => l.id === "1")?.text === "Derrick Jones Jr.'s 114 points through 10 games are his most through 10 games of any season (previous: 110, '25-26)", "own start: the most through N games of any of his seasons, with the previous best", own.map((l) => l.text).join(" | "));
    ok(/^Kevin Durant's 176 points through 11 games are his fewest through 11 games of any season since 2016-17 \(previous low: 275, '16-17\)$/.test(own.find((l) => l.id === "4")?.text || "") && !own.some((l) => l.id === "3" || l.id === "2"), "own start: a scorer's slowest start says \"since 2016-17\" when the logs don't reach his first season; a start like his others says nothing", own.map((l) => l.text).join(" | "));
    const al = alreadyLines({ pg, logs, names });
    ok(al.find((l) => l.id === "2")?.text === "Brook Lopez has 4 20-point games in 11 games this season: already more than in all of last season (3 in 76 games)", "already: more 20-point games than in all of last season", al.map((l) => l.text).join(" | "));
    const pg2 = { 2: now(11, (i) => (i < 2 ? 21 : 12), "LAC") };
    const one = alreadyLines({ pg: pg2, logs, names });
    ok(/one more matches all of last season \(3 in 76 games\)$/.test(one[0]?.text || "") && one[0].tonight === true, "already: one short of last season's count is said before the game", one.map((l) => l.text).join(" | "));
  }

  // A list from the notes, counted forward; records against each conference and the team's own division.
  {
    const G = await import("../src/gameflow/stats.js");
    const lists = [{ id: "q20", what: "quarters of 20+ points", since: "2016-17", event: { type: "quarter", min: 20 }, source: "Suns game notes for 11/15/26 (Stathead)", through: "2026-11-14",
      rows: [["Luka Doncic", 33], ["Stephen Curry", 31], ["Devin Booker", 29], ["James Harden", 29], ["Damian Lillard", 24]] }];
    const big = [{ name: "Devin Booker", pts: 22, date: "2026-11-10" }, { name: "Devin Booker", pts: 26, date: "2026-11-15" }, { name: "Luka Dončić", pts: 21, date: "2026-11-15" }, { name: "James Harden", pts: 20, date: "2026-11-01" }];   // 0.163.0: Harden has one this season (before the list's day: not added)
    const S = G.seededCounts(lists, big, { "devin booker": "PHX", "luka doncic": "LAL", "james harden": "CLE", "stephen curry": "GSW" });
    ok(S[0].rows.map((r) => `${r.name} ${r.n}`).join(", ") === "Luka Doncic 34, Stephen Curry 31, Devin Booker 30, James Harden 29, Damian Lillard 24", "seeded list: only quarters after the day the list was read are added (accents or not)", JSON.stringify(S[0].rows));
    const T = await import("../src/anticipate/tonight.js");
    const sl = T.seededLines({ seeded: S }, new Set(["PHX", "CLE"]));
    ok(sl.length === 2 && sl[0].text === "Devin Booker has 30 quarters of 20+ points since 2016-17, 3rd-most; the next one ties Stephen Curry (31). From the Suns' notes, counted forward here from 11/14" && /^James Harden has 29 .*4th-most; the next one ties Devin Booker \(30\)/.test(sl[1].text), "seeded list: tonight's line says where he stands and what the next one does", sl.map((l) => l.text).join(" | "));
    ok(T.seededLines({ seeded: S }, new Set(["POR"])).length === 0, "seeded list: nothing when the next one changes no place (Lillard is five back)");
    const g = (id, d, h, a, hs, as) => ({ id, d, h, a, hs, as, ot: 0 });
    const sit = computeSituations([g("1", "2026-10-21", "MIL", "IND", 110, 100), g("2", "2026-10-23", "MIL", "BOS", 90, 100), g("3", "2026-10-25", "LAL", "MIL", 120, 100), g("4", "2026-10-27", "MIL", "CHI", 95, 99)]);
    const sp = sit.teams.MIL.splits;
    ok(sp.vsEast.w === 1 && sp.vsEast.l === 2 && sp.vsWest.w === 0 && sp.vsWest.l === 1 && sp.vsDiv.w === 1 && sp.vsDiv.l === 1 && sit.labels.vsDiv === "vs own division", "records: against the East, the West and the team's own division", JSON.stringify(sp));
  }
}

// ---------- 0.77: the user's 19 screenshots (11/16, 10 AM): lines without their subject, repeats, last season's notes ----------
{
  const N = await import("../src/notes/narrative.js");
  const F = await import("../src/notes/facts.js");
  const L = (text, y = 400) => ({ text, y, cells: [{ x0: 40, x1: 560, cx: 300, text }], charX: [] });
  const players = [{ id: "1", name: "Devin Booker" }, { id: "2", name: "James Harden" }, { id: "3", name: "Donovan Mitchell" }, { id: "4", name: "Jamal Murray" }];
  const opts = { seasonStart: "2026-10-01", today: "2026-11-16", teamWords: ["Chicago", "Bulls"] };

  ok(N.repairLayout("Tied for the fifth-highest scoring game by any active NBA player (70 on 3/24/17) 2026-27.") === "Tied for the fifth-highest scoring game by any active NBA player (70 on 3/24/17)."
    && N.repairLayout("He averaged 25.6 points in 2025-26.") === "He averaged 25.6 points in 2025-26.", "the next header's season after a last bullet is cut off; a season in a sentence stays");

  // A sentence that points back ("such instances", "such a game", "in the group… during the span").
  ok(N.dangling("Booker is tied for the second-most such instances in the NBA this season, trailing only Luka Dončić.") && N.dangling("The Bulls are one of five teams this season to record such a game (DAL, GSW, HOU, LAL).")
    && N.dangling("Brooks is the only player in the group to knock down 30+ 3FGM during the span."), "points back: \"such instances\", \"such a game\", \"in the group\" say nothing alone");
  ok(!N.dangling("Tre Jones had 12 points, four rebounds, four assists and four steals off the bench at BOS (10/30), becoming the first NBA reserve to tally such minimums in game this season.")
    && !N.dangling("He leads the team in steals this season with 24 and has five games with three or more steals, tying for third-most such games in the league.")
    && !N.dangling("Since Chris Finch took over as Head Coach, the Wolves have held their opponents under 40.0% shooting 63 times, the third most in the NBA during that span (Oklahoma City: 75 and Boston: 74)."),
    "points back: a sentence that names its own feat or its own span stands alone");
  {
    const h = N.readHistory({ pages: [{ page: 1, width: 612, lines: [
      L("Devin Booker put up 13 points on 5-of-6 shooting and 3-of-4 3FG in the first quarter on Nov. 14, his fifth 10+ point first quarter of the season. Booker is tied for the second-most such instances in the NBA this season, trailing only Luka Dončić."),
      L("Chicago had 11 steals and 10 blocks vs. ATL (11/13), marking their first game this season with at least 10 steals and 10 blocks. The Bulls are one of five teams this season to record such a game (DAL, GSW, HOU, LAL)."),
    ] }, { page: 2, width: 612, lines: [L("Jamal Murray is the only player in the group to knock down 30+ 3FGM during the span, a mark he set last week against Utah.")] }] }, players, opts);
    const bk = h.filter((x) => /such instances/.test(x.text)), ch = h.filter((x) => /such a game/.test(x.text));
    ok(bk.length === 1 && /his fifth 10\+ point first quarter of the season\. Booker is tied for the second-most such instances/.test(bk[0].text) && ch.length === 1 && ch[0].text.startsWith("Chicago had 11 steals and 10 blocks"),
      "points back: read together with the sentence right before it", h.map((x) => x.text.slice(0, 50)).join(" | "));
    ok(!h.some((x) => /in the group/.test(x.text)) && !h.some((x) => /^Devin Booker put up 13 points.*first quarter of the season\.$/.test(x.text)), "points back: with no sentence before it, it is left out; the joined line replaces its first half");
  }

  // The page's footer and a table's header word are not part of the paragraph.
  {
    const cell = (text, x0) => ({ text, x0, x1: x0 + text.length * 4, cx: x0 + text.length * 2 });
    const line = (y, ...cells) => ({ y, text: cells.map((c) => c.text).join("  "), cells });
    const cols = N.columnsOf({ width: 612, lines: [line(402, cell("Murray has tallied two or more blocks in three consecutive", 59)), line(392, cell("Date", 118)), line(383, cell("games, tying his career-high streak.", 59)),
      line(19.4, cell("Michael Porter Jr. leads the NBA with 6.3 PPG off dribble handoffs this season.", 47), cell("1", 579)), line(17.1, cell("@nuggets", 37), cell("PAGE 5", 80))] });
    ok(cols.flat().join(" ") === "Murray has tallied two or more blocks in three consecutive games, tying his career-high streak. Michael Porter Jr. leads the NBA with 6.3 PPG off dribble handoffs this season.",
      "footers: a page number, \"@nuggets PAGE 5\" and a stray \"Date\" are left out of the text", JSON.stringify(cols));
  }

  // Cleveland's "2025-26 Notes:" covers the bullets under it, down the page, until another player's box.
  {
    const doc = { pages: [{ page: 16, width: 612, lines: [
      L("#1 James Harden Guard 6-5 220lbs 18th Year Pro"),
      L("2026-27 NOTES: • Tallied a season-high 32 PTS on 9-14 shooting on Nov. 11 at New York, his 345th career game with at least 30 PTS, tying Allen Iverson for the 11th-most games with 30+ PTS in NBA history."),
      L("2025-26 Notes: Appeared in 70 games (all starts) this season for the L.A. Clippers (44 games) and Cleveland (26 games)."),
      L("• Contributed a season-high 55 PTS, including 10-16 shooting from the three-point line, 7 AST, 3 REB and 1 STL in 35 MIN on Nov. 22 at CHA. His 55 points is tied for the 2nd-most points scored by any player in the NBA this season."),
      L("• Recorded a team-high 30 PTS on 11-16 shooting on March 11 at ORL. It was his 343rd career 30-point game, tying Elgin Baylor for the 12th-most 30-point games in NBA history."),
      L("#45 Donovan Mitchell Guard 6-3 228lbs 10th Year Pro"),
      L("• Donovan Mitchell became the 4th player in Cavs history to make at least 900 3FG with his 2nd made three-pointer on Nov. 14 vs. DAL."),
    ] }] };
    const dropped = [];
    const h = N.readHistory(doc, players, { ...opts, dropped });
    ok(!h.some((x) => /55 points is tied|343rd career 30-point/.test(x.text)) && dropped.some((d) => d.reason === "past-season" && /55 points is tied/.test(d.text)),
      "season header: bullets under \"2025-26 Notes:\" are last season's, each in its own block", h.map((x) => x.text.slice(0, 40)).join(" | "));
    ok(h.some((x) => /345th career game/.test(x.text)) && h.some((x) => /900 3FG/.test(x.text) && x.player === "Donovan Mitchell"), "season header: this season's notes above it, and the next player's box below it, are kept", h.map((x) => x.text.slice(0, 40)).join(" | "));
  }

  // The same fact told twice.
  ok([...F.numbersIn("Sharpe has recorded 5+ assists in five consecutive contests, T-1st with 58.4% and 1,234 in 2025-26")].sort().join(",") === "1,1234,5,58.4", "numbers in a line: digits, spelled-out counts and ordinals; a season is not a number");
  ok(F.sameFact("He ranks 11th in the NBA with 130 bench points this season.", "Wagner ranks 11 with 130 bench points this season and is 8th in the NBA with a 58.4% FG.")
    && F.sameFact("Sharpe has recorded 5+ assists in five consecutive contests, which establishes a franchise-record streak by a center.", "Day'Ron Sharpe has recorded 5+ assists in five straight games, which is the longest streak by a center in franchise history.")
    && !F.sameFact("He ranks 11th in the NBA with 130 bench points this season.", "Wagner is averaging 10.8 points, 3.4 rebounds and 1.5 assists in 18.3 minutes across 12 outings."), "same fact: told shorter or in other words; different numbers are a different fact");
  {
    const mk = (text, player, score) => ({ text, player, playerId: player, score });
    const d = F.dedupe([
      mk("He ranks 11th in the NBA with 130 bench points this season.", "Moritz Wagner", 5), mk("Wagner ranks 11 with 130 bench points this season and is 8th in the NBA with a 58.4% FG.", "Moritz Wagner", 3),
      mk("Day'Ron Sharpe has recorded 5+ assists in five straight games, which is the longest streak by a center in franchise history.", "Day'Ron Sharpe", 4), mk("Sharpe has recorded 5+ assists in five consecutive contests, which establishes a franchise-record streak by a center.", "Day'Ron Sharpe", 3),
      mk("An elite offensive rebounder as well, Sharpe holds the highest offensive rebound percentage by any player in NBA history, minimum 200 games played.", "Day'Ron Sharpe", 6),
      mk("Sharpe owns the highest career offensive rebound percentage in NBA history (18.2%), min. 200 games played, and owns the fourth-highest career field goal percentage (56.2%) in Nets franchise history.", "Day'Ron Sharpe", 2),
      mk("Career vs. Golden State Warriors - Bey averages 16.0 points per game off the bench, which is ranked 3rd in the NBA among all reserves.", "Saddiq Bey", 5), mk("Bey has been very productive off the bench, averaging 16.0 points per game, which ranks 3 among all NBA bench players.", "Saddiq Bey", 4),
    ]).map((l) => l.text.slice(0, 34));
    ok(d.length === 4 && d.includes("Wagner ranks 11 with 130 bench poi") && d.includes("Sharpe owns the highest career off") && d.includes("Day'Ron Sharpe has recorded 5+ ass") && d.includes("Bey has been very productive off t"),
      "same fact: one line stays, the one that says more (or, at the same numbers, the one that opens with his name)", d.join(" | "));
  }

  // A climb up one list, the season opener a month on, and a recap left from the night of an older game.
  {
    const box = { keys: ["starter", "min"], games: [{ d: "2026-10-21" }, { d: "2026-11-14" }] };
    const bk = (text, tag) => ({ text, tag, player: "Devin Booker", playerId: "1", score: 3 });
    const lines = [bk("Devin Booker passed Tracy McGrady on the NBA's all-time scoring list and now ranks 77th in league history.", "77th all-time"), bk("He passed Tracy McGrady for the 78th most points in NBA history.", "78th all-time"),
      bk("He passed Julius Erving for the 79th most points in NBA history.", "79th all-time"), bk("He ranks 11th in points in NBA history by any player before their 30th birthday.", "11th all-time"),
      bk("He ranks 3rd all-time in points among players drafted 13th.", "3rd all-time"),
      { text: "Giannis Antetokounmpo passed his own mark with at least 12 rebounds in seven-straight games, tying the third-longest such streak in team history.", tag: "3rd in team history", player: "G", playerId: "9", score: 3 },
      { text: "Giannis Antetokounmpo passed Alonzo Mourning and ranks second in rebounds in team history.", tag: "2nd in team history", player: "G", playerId: "9", score: 3 }];
    const t = F.trimLines(lines, { box, today: "2026-11-16", floor: 0 });
    const why = Object.fromEntries(t.trimmed.map((l) => [l.tag, l.trimmed]));
    ok(why["78th all-time"] === "an earlier place on the same list (78th; he is 77th now)" && why["79th all-time"] === "an earlier place on the same list (79th; he is 77th now)" && t.keep.some((l) => l.tag === "77th all-time"),
      "ladder: the place he holds now is kept; the rungs below say where he is now", JSON.stringify(why));
    ok(t.keep.some((l) => l.tag === "11th all-time") && t.keep.some((l) => l.tag === "3rd all-time") && t.keep.some((l) => l.tag === "3rd in team history") && t.keep.some((l) => l.tag === "2nd in team history"),
      "ladder: a list with a condition on it, a place far above, and a streak's rank are other lists", t.trimmed.map((l) => l.tag).join(","));
    const opener = { text: "Bam Adebayo has now started eight season openers with Miami, the second-most in team history.", player: "Bam Adebayo", playerId: "5" };
    ok(F.trimReason(opener, { box, today: "2026-11-16" }) === "past one-off (season opener, over three weeks ago)" && F.trimReason(opener, { box, today: "2026-11-05" }) !== "past one-off (season opener, over three weeks ago)"
      && F.trimReason({ text: "He has scored 20+ points in every game since the season opener, the longest such run of his career.", player: "X", playerId: "6" }, { box, today: "2026-11-16" }) !== "past one-off (season opener, over three weeks ago)",
      "season opener: trimmed once it is over three weeks old; a run going since the opener is not");
    ok(F.trimReason({ text: "Gobert had 10 rebounds through three quarters of tonight’s game, marking his 37th game with 10+ rebounds through the first three quarters, second in the NBA behind Nikola Jokic (38).", player: "Rudy Gobert", playerId: "7" }, { box, today: "2026-11-16" }) === "a recap from the night of an earlier game (its counts are as of that night)"
      && F.trimReason({ text: "Tonight’s game is the first of four meetings between the teams this season.", player: null }, { box, today: "2026-11-16" }) !== "a recap from the night of an earlier game (its counts are as of that night)",
      "\"tonight's game\" in a recap left from an earlier night is trimmed; a line about tonight's own game is not");
  }
}

// ---------- 0.78: the user's second set of 11/16 (20 images): notes that don't hold up, quarter scores, league-wide trackers ----------
{
  const N = await import("../src/notes/narrative.js");
  const F = await import("../src/notes/facts.js");
  const L = (text, y = 400) => ({ text, y, cells: [{ x0: 40, x1: 560, cx: 300, text }], charX: [] });
  const players = [{ id: "1", name: "Bilal Coulibaly" }, { id: "2", name: "AJ Dybantsa" }, { id: "3", name: "Deandre Ayton" }, { id: "4", name: "Justin Champagnie" }, { id: "5", name: "Jeremiah Fears" }, { id: "6", name: "Yves Missi" }];
  const opts = { seasonStart: "2026-10-01", today: "2026-11-16", teamWords: ["Washington", "Wizards"] };

  ok(N.repairLayout("S T E A L S / B L O C K S With five assists at MIN (11/14), Josh Giddey (1,099) passed both Chet Walker (1,097) and Clem Haskins (1,098).") === "With five assists at MIN (11/14), Josh Giddey (1,099) passed both Chet Walker (1,097) and Clem Haskins (1,098)."
    && N.repairLayout("A J Green scored 20 points.") === "A J Green scored 20 points.", "a letter-spaced heading in front of a sentence is cut off");
  // "to do so" and a place with no stat say nothing alone.
  ok(N.dangling("He is only the second Wizard to do so in the opening game of the season since 1973-74, when steals and blocks began being tracked.")
    && N.dangling("He ranks eighth among all rookies in Wizards history over nine career games."),
    "points back (0.78): \"the second Wizard to do so\" and \"ranks eighth among all rookies\" (in what?) say nothing alone");
  ok(!N.dangling("Posted back-to-back 20-point, 10-assist double-doubles to start the season, joining Michael Adams (1991-92) as the only players in franchise history to do so.")
    && !N.dangling("He ranks third in the NBA in steals per game.") && !N.dangling("Carrington appeared in all 82 games as a rookie during the 2024-25 season, the only rookie to do so.")
    && !N.dangling("He is in his third season with the Wizards."),
    "points back (0.78): a sentence that names its own feat or its own stat stands alone");
  {
    const dropped = [];
    const h = N.readHistory({ pages: [{ page: 1, width: 612, lines: [
      L("Coulibaly recorded four steals and two blocks in the season-opener on 10/21/26 vs. Milwaukee. He is only the second Wizard to do so in the opening game of the season since 1973-74, when steals and blocks began being tracked."),
      L("Dybantsa has scored 135 points over nine games in his career. He ranks eighth among all rookies in Wizards history over nine career games."),
      L("Below is a look at where Jeremiah Fears and Derik Queen matchup amongst all NBA sophomores this season."),
    ] }] }, players, { ...opts, dropped });
    ok(h.some((x) => /^Coulibaly recorded four steals and two blocks.*He is only the second Wizard to do so/.test(x.text)) && h.some((x) => /^Dybantsa has scored 135 points over nine games in his career\. He ranks eighth/.test(x.text))
      && !h.some((x) => /^He (?:is only|ranks)/.test(x.text)) && !h.some((x) => /Below is a look/.test(x.text)) && dropped.some((d) => d.reason === "lead-in"),
      "notes (0.78): each is read with the sentence before it; a table's lead-in (\"Below is a look at where…\") is dropped", h.map((x) => x.text).join(" | "));
  }
  // Washington's "2025-26 SEASON HIGHLIGHTS:" covers the bullets under it.
  {
    const dropped = [];
    const h = N.readHistory({ pages: [{ page: 26, width: 612, lines: [
      L("#9 Justin Champagnie Forward 6-7 211lbs 5 Years Pro"),
      L("2026-27 SEASON HIGHLIGHTS: • Tied a career-high with 14 rebounds on 10/24 at CHI, his first double-double of the season."),
      L("2025-26 SEASON HIGHLIGHTS: • Appeared in 69 games (19 starts) on the season."),
      L("• Recorded at least one steal in a career-high 42 games."),
      L("• Shot a career-high .671 (403-601 FG) from the floor."),
    ] }] }, players, { ...opts, dropped });
    ok(!h.some((x) => /career-high 42 games|403-601/.test(x.text)) && dropped.filter((d) => d.reason === "past-season").length >= 2,
      "season header (0.78): bullets under \"2025-26 SEASON HIGHLIGHTS:\" are last season's", h.map((x) => x.text).join(" | ") + " // " + dropped.map((d) => d.reason).join(","));
  }
  // The backstop: a season total this season can't hold yet.
  {
    const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
    const row = keys.map((k) => ({ min: 28, pts: 12, fgm: 5, fga: 8, ftm: 2, fta: 3 }[k] ?? 0));
    const box = { keys, names: { 3: "Deandre Ayton" }, games: Array.from({ length: 14 }, (_, i) => ({ d: `2026-10-${String(21 + i).padStart(2, "0")}`.replace("2026-10-32", "2026-11-01"), pl: { 3: row } })) };
    ok(/^last season's total \(403-601; he has 112 field goal attempts this season\)$/.test(F.cantBeThisSeason("Shot a career-high .671 (403-601 FG) from the floor.", { box, playerId: "3" }) || "")
      && /^last season's count \(42 games; the team has played 14\)$/.test(F.cantBeThisSeason("Recorded at least one steal in a career-high 42 games.", { box, playerId: "4" }) || "")
      && F.cantBeThisSeason("He is shooting .625 (70-112 FG) from the floor this season.", { box, playerId: "3" }) === null
      && F.cantBeThisSeason("He has made 403 of 601 shots (403-601 FG) in his career against Brooklyn.", { box, playerId: "3" }) === null
      && F.cantBeThisSeason("Has scored in double figures in a career-high 11 games in a row.", { box, playerId: "3" }) === null
      && /^last season's total/.test(F.trimReason({ text: "Shot a career-high .671 (403-601 FG) from the floor.", player: "Deandre Ayton", playerId: "3" }, { box, today: "2026-11-16" }) || ""),
      "a total this season can't hold: 601 attempts against his 112, a count of 42 games after 14; this season's own totals and career totals are left alone");
  }
  // Games missed in a row are not a streak he extends by playing.
  {
    const d = F.describe("On 11/14 vs. DEN, returned to the court after missing 11 consecutive games due to a left knee contusion.", { player: "Yves Missi" });
    const s = F.describe("Has scored in double figures in 11 consecutive games.", { player: "Yves Missi" });
    ok(d.type !== "streak" && !/Active streak/.test(d.tag) && s.type === "streak" && s.tag === "Active streak · 11", "streak tag: \"after missing 11 consecutive games\" is not an active streak; 11 straight games in double figures is", JSON.stringify([d.type, d.tag, s.type, s.tag]));
  }

  // Quarter scores are read again (ESPN moved three points of GSW @ HOU from the 3rd quarter to the 2nd after the first read).
  {
    const { collectResults: CR, QUARTER_DAYS } = await import("../src/situations/results.js");
    let aq = [20, 28, 31, 29];
    const asked = [];
    const sbd = (d) => ({ ok: true, warnings: [], data: { season: 2027, calendar: ["2026-11-11", "2026-11-16"], games: d === "2026-11-11" ? [{ id: "g1", date: d, seasonType: 2, final: true, homeTri: "HOU", awayTri: "GSW", homeScore: 115, awayScore: 108, homeQ: [35, 21, 29, 30], awayQ: aq, periods: 4 }] : [] } });
    const espn = { scoreboard: async (d) => { asked.push(d); return sbd(d); }, detail: async () => ({ ok: false, error: "no summary (test)" }) };
    let st = await CR({ espn, store: null, through: "2026-11-16" });
    aq = [20, 31, 28, 29];
    st = await CR({ espn, store: st, through: "2026-11-16" });
    const row = st.dates["2026-11-11"].games[0];
    ok(row.aq.join() === "20,31,28,29" && st.requartered.length === 1 && st.requartered[0].was[0].join() === "20,28,31,29" && QUARTER_DAYS === 10, "results (0.78): a game's quarter scores are read again and a change is taken (GSW 28-31 became 31-28)", JSON.stringify([row.aq, st.requartered]));
    aq = [20, 31, 28, 20];                                    // a line score that doesn't add up to the final: not taken
    st = await CR({ espn, store: st, through: "2026-11-16" });
    asked.length = 0;
    const later = await CR({ espn, store: { ...st, qsweep: 1 }, through: "2026-11-30" });
    ok(st.dates["2026-11-11"].games[0].aq.join() === "20,31,28,29" && !st.requartered.length && !asked.includes("2026-11-11") && later.dates["2026-11-11"].games[0].aq.join() === "20,31,28,29",
      "results (0.78): a line score that doesn't add up to the final is not taken; after ten days a date is no longer asked for", asked.join());
    const { quarterLines } = await import("../src/situations/quarters.js");
    const tris = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];
    const rows = [];
    for (let i = 0; i < 10; i++) { rows.push({ d: `2026-11-${10 + i}`, h: "AAA", a: "BBB", hq: [30, 30, 20, 30, ...(i === 0 ? [10] : [])], aq: [27, 27, 28, 27, ...(i === 0 ? [12] : [])] }); rows.push({ d: `2026-11-${10 + i}`, h: "CCC", a: "DDD", hq: [25, 25, 25, 25], aq: [25, 25, 25, 25] }); rows.push({ d: `2026-11-${10 + i}`, h: "EEE", a: "FFF", hq: [25, 25, 25, 25], aq: [25, 25, 25, 25] }); }
    const ql = quarterLines(rows, []);
    ok(tris.length === 6 && /in the other three quarters combined \(overtime not counted\)$/.test(ql.find((l) => l.team === "AAA")?.text || ""), "quarters (0.78): a team that has played overtime is told it isn't counted", ql.map((l) => l.text).join(" | "));
  }

  // A standing fact is marked, so NBA Live leaves it to the Watch List; the bridge is v14.
  {
    const src = fs.readFileSync(path.join(root, "docs", "bridge", "cc-bridge.js"), "utf8");
    const sl = fs.readFileSync(path.join(root, "src", "anticipate", "seasonlong.js"), "utf8");
    ok(/var VERSION = (?:1[4-9]|[2-9]\d);/.test(src) && /return !l\.bg && (?:!l\.siteOnly && )?\(l\.kind !== "foul"/.test(src) && (sl.match(/standing: true/g) || []).length === 2 && /era\|decade\|[^\n]*\n[^\n]*\n[^\n]*standing: true/.test(sl),
      "bridge v14: a standing fact (\"leads the decade in…\") is marked bg and gets no pre-game card in NBA Live");
  }

  // Hot and cold shooting over his last games, the whole league; a second kind of shot gone the same way is added.
  {
    const { slumpLines, SLUMP } = await import("../src/anticipate/prep.js");
    const columns = ["date", "opp", "home", "result", "type", "min", "pts", "reb", "ast", "stl", "blk", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "tov"];
    const day = (y, i) => new Date(Date.UTC(y, 9, 20 + i * 2)).toISOString().slice(0, 10);
    const season = (y, n) => Array.from({ length: n }, (_, i) => [day(y, i), "BOS", 1, "W", 2, 32, 28, 10, 4, 1, 1, 10, 20, 1, 3, 7, 8, 3]); // 50% FG, 33.3% 3PT
    const logs = { columns, players: { 1: [...season(2023, 60), ...season(2024, 60), ...season(2025, 60)], 2: [...season(2024, 60), ...season(2025, 60)], 3: [...season(2024, 60), ...season(2025, 60)] } };
    const g = (i, o) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, team: "PHI", min: 32, pts: 20, reb: 8, ast: 3, stl: 1, blk: 1, fgm: 10, fga: 20, fg3m: 1, fg3a: 3, ftm: 5, fta: 6, tov: 3, ...o });
    const pg = {
      1: Array.from({ length: 12 }, (_, i) => g(i, i >= 3 ? { fg3m: i === 5 ? 1 : 0, fg3a: i === 5 ? 1 : 3, ...(i >= 5 ? { fgm: i === 6 ? 8 : 4, fga: i === 6 ? 15 : 13 } : {}) } : {})),   // 1-for-25 from three over 9; 20-for-65 from the field over 5
      2: Array.from({ length: 12 }, (_, i) => g(i, {})),                                           // his normal
      3: Array.from({ length: 12 }, (_, i) => g(i, i >= 9 ? { min: 9, fgm: 0, fga: 14 } : {})),    // cold, but in 9 minutes a game
    };
    const sl = slumpLines({ pg, logs, names: { 1: "Joel Embiid", 2: "Steady Eddie", 3: "Garbage Time" } });
    ok(sl.length === 1 && sl[0].kind === "span" && sl[0].key === "slump|1|fg3|cold"
      && sl[0].text === "Joel Embiid is 1-for-25 from three over his last 9 games (4.0%, since 11/4); he had shot 33.3% for his career before that; also 20-for-65 from the field over his last 5 (49.9% before)" && SLUMP.z === 2.8,
      "slumps (0.78): the stretch furthest from his own rate, with a second kind of shot gone the same way; a normal stretch and a bench cameo give no line", sl.map((l) => l.text).join(" | "));
  }

  // Miss runs count more for a bigger name; a player who barely shoots needs a longer one.
  {
    const { tonightCandidates: TC, SHOTS } = await import("../src/anticipate/tonight.js");
    const P = (name, fga) => ({ name, team: "MIA", last: "2026-11-13", gp: 7, fta: 6, fg: 0, fg3: 0, ft: 0, fgMiss: fga, fg3Miss: 0, dryFg: { sec: 2003, fga, from: "2026-10-28", games: 5 }, dryFt: { sec: 0, fga: 0, from: "2026-11-13", games: 1 } });
    const flow = { shots: { players: { a: P("Dru Smith", 8), b: P("Big Name", 8), c: P("Role Player", 12) }, best: { dryFg: [{ sec: 4476, fga: 13, name: "Terance Mann" }] } } };
    const watch = { today: "2026-11-16", teams: [], games: [{ id: "1", homeTri: "MIA", awayTri: "HOU" }] };
    const shots = (stars) => TC({ watch, fouls: flow, prep: stars ? { lines: [], stars } : null }).all.filter((x) => /^shots\|/.test(x.key || ""));
    const withStars = shots({ "Dru Smith": 0, "Big Name": 0.7, "Role Player": 0.1 }), none = shots(null);
    const sc = (L, n) => L.find((x) => x.player === n)?.score;
    ok(none.length === 3 && withStars.length === 2 && !withStars.some((x) => x.player === "Dru Smith") && sc(withStars, "Big Name") > sc(none, "Big Name") + 0.5 && sc(withStars, "Role Player") < sc(none, "Role Player") && SHOTS.minor.dryFgFga === 4,
      "shot droughts (0.78): 0-for-8 by a player who barely plays is no line (0-for-12 is); the same drought ranks higher for a big name", JSON.stringify(withStars.map((x) => [x.player, x.score])));
  }

  // A back-to-back counts for a player only when he played both nights.
  {
    const R = await import("../src/situations/rest.js");
    const hb = [40, 85, 12, 34, 15, 20, 10, 33, 25, 8, 5, 13, 20];
    const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
    const Lr = (pts, min = 34) => keys.map((k) => ({ min, pts, fgm: 8, fga: 18 }[k] ?? 0));
    const dates = ["2026-11-01", "2026-11-02", "2026-11-04", "2026-11-06", "2026-11-08", "2026-11-09", "2026-11-11", "2026-11-13"];
    const files = { AAA: { team: "AAA", keys, names: { 1: "Both Nights", 2: "Sat The First" }, games: dates.map((d) => ({ d, opp: "BBB", home: true, pf: 100, pa: 90,
      pl: { 1: Lr(["2026-11-02", "2026-11-09"].includes(d) ? 12 : 24), 2: Lr(["2026-11-02", "2026-11-09"].includes(d) ? 12 : 24, ["2026-11-01", "2026-11-08"].includes(d) ? 0 : 34) } })) } };
    const out = R.restData({ games: dates.map((d) => ({ d, h: "AAA", a: "CCC", hs: 100, as: 90, hb, ab: hb })), teamFiles: files, tonight: [], today: "2026-11-14" });
    ok(out.players.find((x) => x.name === "Both Nights")?.b2bGp === 2 && !out.players.some((x) => x.name === "Sat The First"),
      "rest, players (0.78): a second night counts only if he played the night before; a player who sat the first night has no back-to-back games", JSON.stringify(out.players.map((p) => [p.name, p.b2bGp, p.restGp])));
  }

  // 30-point games: the same scorer against the same defense more than once; and again tonight.
  {
    const { thirtyAllowed } = await import("../src/situations/vsplayers.js");
    const G = (d, opp, pts) => ({ d, opp, team: "LAL", home: true, pts });
    const t = thirtyAllowed({ players: { 1: { id: "1", name: "Luka Doncic", games: [G("2026-10-30", "DET", 41), G("2026-11-08", "DET", 35), G("2026-11-10", "SAC", 33)] }, 2: { id: "2", name: "Austin Reaves", games: [G("2026-10-30", "DET", 31)] } }, teamGp: { DET: 12, SAC: 13, BOS: 13 } });
    const det = t.teams.find((x) => x.tri === "DET");
    ok(det.allowed === 3 && det.who[0].name === "Luka Doncic" && det.who[0].n === 2 && det.who[0].pts.join() === "41,35" && det.who[1].n === 1 && det.players.join() === "Luka Doncic,Austin Reaves",
      "30-point games allowed (0.78): a scorer who did it to the same defense twice is counted twice and marked", JSON.stringify(det.who));
    const S = await import("../src/anticipate/seasonlong.js");
    const tris = Array.from({ length: 22 }, (_, i) => `T${String(i).padStart(2, "0")}`);
    const rows = tris.map((t2, i) => ({ d: "2026-11-01", h: t2, a: i ? tris[i - 1] : "DET", hs: 100, as: 90 })).concat([{ d: "2026-10-30", h: "LAL", a: "DET", hs: 120, as: 110 }, { d: "2026-11-08", h: "DET", a: "LAL", hs: 100, as: 120 }]);
    const pg = { 1: [{ d: "2026-10-30", team: "LAL", opp: "DET", pts: 41 }, { d: "2026-11-08", team: "LAL", opp: "DET", pts: 35 }, { d: "2026-11-10", team: "LAL", opp: "SAC", pts: 33 }] };
    const dl = S.defenseLines({ pg, rows, names: { 1: "Luka Doncic" }, slate: [{ away: "DET", home: "LAL" }] }).filter((l) => /^rep30\|/.test(l.key));
    ok(dl.length === 1 && dl[0].kind === "vsopp" && dl[0].opp === "DET" && dl[0].text === "Luka Doncic has scored 30+ against DET both times this season (41 on 10/30, 35 on 11/8); they meet again tonight"
      && !S.defenseLines({ pg, rows, names: { 1: "Luka Doncic" }, slate: [{ away: "SAC", home: "LAL" }] }).some((l) => /^rep30\|/.test(l.key)),
      "30 again (0.78): two 30-point games against tonight's opponent this season is a line on the night they meet again, for anyone", dl.map((l) => l.text).join(" | "));
  }

  // Career highs raised more than once, the whole league.
  {
    const { repeatHighs } = await import("../src/situations/trends.js");
    const H = (id, name, team, d, prev, pts, rookie = false) => ({ id, name, team, against: "UTA", home: false, d, pts, prev, rookie });
    const games = [H("1", "Dylan Harper", "SAS", "2026-11-15", 25, 31), H("1", "Dylan Harper", "SAS", "2026-10-31", 24, 25), H("2", "Ajay Mitchell", "OKC", "2026-11-06", 30, 35), H("2", "Ajay Mitchell", "OKC", "2026-10-26", 26, 30),
      H("3", "Cade Cunningham", "DET", "2026-11-12", 46, 52), H("4", "Darryn Peterson", "UTA", "2026-10-28", 15, 18, true), H("4", "Darryn Peterson", "UTA", "2026-10-23", 9, 15, true), H("4", "Darryn Peterson", "UTA", "2026-11-06", 18, 21, true)];
    const rp = repeatHighs(games);
    ok(rp.length === 3 && rp[0].name === "Darryn Peterson" && rp[0].n === 3 && rp[0].rookie && rp[1].name === "Dylan Harper" && rp[1].steps.join() === "24,25,31" && rp[1].last === "2026-11-15" && !rp.some((r) => r.name === "Cade Cunningham"),
      "career highs (0.78): everyone who has raised his career high more than once this season, with each step", JSON.stringify(rp));
    const { tonightCandidates: TC } = await import("../src/anticipate/tonight.js");
    const lines = (home) => TC({ watch: { today: "2026-11-16", teams: [], games: [{ id: "1", homeTri: home, awayTri: "MEM" }] }, trends: { highsAllowed: { teams: [], games, repeat: rp } } }).all.filter((x) => /^highs\|/.test(x.key || ""));
    const sas = lines("SAS"), uta = lines("UTA");
    ok(sas.length === 1 && sas[0].kind === "season" && sas[0].text === "Dylan Harper has raised his career high twice this season (24 → 25 → 31, the latest on 11/15): one of 2 players past their rookie season to do it twice (with Ajay Mitchell)" && uta.length === 0,
      "career highs (0.78): a line for any player past his rookie season who has done it twice or more, when he plays; rookies are left to the page", sas.map((l) => l.text).join(" | "));
  }
}

// ---------- 0.79: twelve posts the user sent (11/16) and full halves / full games ----------
{
  const T = await import("../src/anticipate/tonight.js");
  const by = (upW, upL, run = [], longest = run.length) => ({ gp: 13, upW, upL, downW: 1, downL: 5, run, longest, last: "2026-11-15" });
  const flow = { games: 197, by10: { TOR: by(4, 4, [{ lead: 22, opp: "BOS", d: "2026-11-11" }, { lead: 17, opp: "PHI", d: "2026-11-12" }, { lead: 13, opp: "NYK", d: "2026-11-15" }]), CHA: by(4, 5, [], 3), UTA: by(1, 5, [{ lead: 10, opp: "HOU", d: "2026-11-13" }, { lead: 10, opp: "SAS", d: "2026-11-15" }]), BOS: by(9, 1), MIL: by(0, 4), LAC: by(6, 2) },
    swing: [{ id: "1", name: "Scottie Barnes", team: "TOR", m: 3, a: 5, gp: 5 }, { id: "2", name: "Landry Shamet", team: "NYK", m: 2, a: 2, gp: 2 }],
    full: { halves: [{ id: "9", name: "Max Christie", team: "DAL", opp: "IND", h: 2, min: 38, pts: 16, gameId: "g9", date: "2026-11-14" }], games: [], fives: [] } };
  const L = T.flowTeamLines(flow, new Set(["TOR", "UTA", "BOS", "LAC", "DAL", "NYK"]), "2026-11-16");
  const txt = (k) => L.find((l) => l.key === k)?.text;
  ok(txt("blown10|TOR") === "TOR has lost its last 3 games after leading by 10+ (22 vs BOS 11/11, 17 vs PHI 11/12, 13 vs NYK 11/15); a fourth straight tonight would be the longest such run in the NBA this season"
    && txt("blown10|UTA") === "UTA has lost its last 2 games after leading by 10+ (10 vs HOU 11/13, 10 vs SAS 11/15); a third straight tonight would tie the season's longest (3)",
    "blown leads (0.79): games lost in a row after leading by 10+, for any team, with what tonight would make it", L.filter((l) => /^blown10/.test(l.key)).map((l) => l.text).join(" | "));
  ok(txt("led10|UTA") === "UTA is 1-5 when leading by 10+ this season: one of 3 teams with a losing record in those games (with CHA, MIL)" && txt("led10|TOR") === "TOR is 4-4 when leading by 10+ this season; only CHA and UTA have lost more such games" && !txt("led10|BOS") && !txt("led10|LAC"),
    "leading by 10+ (0.79): a losing record names the others; many such losses without a losing record says who has more; a team that holds its leads gets no line", L.filter((l) => /^led10/.test(l.key)).map((l) => l.text).join(" | "));
  ok(txt("swing|1") === "Scottie Barnes is 3-for-5 on shots to tie or take the lead in the final 90 seconds of the 4th or overtime this season (the most makes in the NBA)" && !txt("swing|2")
    && txt("fullhalf|9|g9") === "Max Christie played the entire second half on 11/14 vs IND (38 minutes in the game): the only full half by any player this season (197 games); nobody has played a full game"
    && !T.flowTeamLines(flow, new Set(["DAL"]), "2026-11-30").some((l) => /^full/.test(l.key)),
    "late shots and full halves (0.79): the league's most makes to tie or lead late (three or more); a full half in his team's last game, for a few days", L.filter((l) => /^(swing|full)/.test(l.key)).map((l) => l.text).join(" | "));
  {
    const f2 = JSON.parse(JSON.stringify(flow));
    f2.full.games = [{ id: "7", name: "Iron Man", team: "DAL", opp: "IND", min: 53, pts: 30, ot: 1, gameId: "g9", date: "2026-11-14" }];
    f2.full.halves.push({ id: "7", name: "Iron Man", team: "DAL", opp: "IND", h: 1, min: 53, pts: 30, gameId: "g9", date: "2026-11-14" });
    f2.full.fives = [{ team: "DAL", opp: "IND", h: 2, names: ["A", "B", "C", "D", "E"], gameId: "g9", date: "2026-11-14" }];
    const L2 = T.flowTeamLines(f2, new Set(["DAL"]), "2026-11-16");
    ok(L2.find((l) => l.key === "fullgame|7|g9")?.text === "Iron Man played every second of DAL's last game (53 minutes, an overtime included, 11/14 vs IND): the only full game by any player this season (197 games)"
      && !L2.some((l) => l.key === "fullhalf|7|g9") && /^DAL played the same five for the entire second half on 11\/14 vs IND \(A, B, C, D, E\): the only time a team has done it this season$/.test(L2.find((l) => l.key === "fullfive|DAL|g9")?.text || ""),
      "full games (0.79): a full game is one line (his halves aren't repeated); five players a whole half is a team line", L2.map((l) => l.text).join(" | "));
  }

  // The morning after: an unusual scoring game, a team's game that is the season's most.
  {
    const S = await import("../src/anticipate/seasonlong.js");
    const columns = ["date", "opp", "home", "result", "type", "min", "pts", "reb", "ast", "stl", "blk", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "tov"];
    const lg = (date, pts, fgm, fga, fg3m, fg3a, ftm, fta) => [date, "BOS", 1, "W", 2, 30, pts, 4, 2, 1, 0, fgm, fga, fg3m, fg3a, ftm, fta, 1];
    const logs = { columns, players: { 2: [lg("2023-03-24", 30, 10, 10, 10, 10, 0, 0), lg("2024-01-05", 50, 18, 30, 4, 10, 10, 12)], 3: [lg("2022-02-02", 27, 9, 14, 9, 14, 0, 0)] } };
    const g = (o) => ({ d: "2025-12-31", team: "SAS", opp: "NYK", min: 34, pts: 36, reb: 6, ast: 0, stl: 0, blk: 0, fgm: 11, fga: 17, fg3m: 11, fg3a: 17, ftm: 3, fta: 3, tov: 1, ...o });
    const odd = S.oddScoringLines({ pg: { 1: [g({})], 4: [g({ pts: 22, fgm: 8, fga: 16, fg3m: 2, fg3a: 6, ftm: 4, fta: 4 })] }, logs, names: { 1: "Julian Champagnie", 2: "Luke Kennard", 3: "Old Shooter", 4: "Normal Night" } });
    ok(odd.length === 1 && odd[0].kind === "unique" && odd[0].date === "2025-12-31"
      && odd[0].text === "Julian Champagnie scored 36 without a two-point attempt vs. NYK (12/31; 11-of-17 from three, 3-of-3 at the line): the most by a current player in such a game since 2016-17 (was Luke Kennard 30, 3/24/23)",
      "the morning after (0.79): the most points in a game without a two-point attempt by a current player since 2016-17; an ordinary 22 gives nothing", odd.map((l) => l.text).join(" | "));
    const tb = (ftm, fta, tov = 12) => [40, 88, 12, 34, ftm, fta, 10, 33, 25, 8, 5, tov, 20];
    const rows = [];
    for (let i = 0; i < 31; i++) rows.push({ d: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`, h: "AAA", a: "BBB", hs: 110, as: 100, hq: [1, 1, 1, 1], aq: [1, 1, 1, 1], hb: tb(18, 22 + (i === 5 ? 11 : 0)), ab: tb(20, 24) });
    rows.push({ d: "2026-11-02", h: "LAC", a: "TOR", hs: 118, as: 125, hq: [1, 1, 1, 1], aq: [1, 1, 1, 1], hb: tb(20, 25), ab: tb(31, 48) });
    const tn = S.teamNightLines({ rows });
    ok(tn.length === 1 && tn[0].key === "teamnight|ftmiss|TOR|2026-11-02" && tn[0].text === "TOR missed 17 free throws vs. LAC (11/2; 31-of-48): the most by any team in a game this season (was AAA 15, 10/6)" && !S.teamNightLines({ rows: rows.slice(0, 10) }).length,
      "the morning after (0.79): a team's box-score total that is the season's most for any team; nothing in the season's first weeks", tn.map((l) => l.text).join(" | "));
  }

  // Runs of wins and losses by 15+ are watched too.
  {
    const SW = await import("../src/situations/streakwatch.js");
    const src = fs.readFileSync(path.join(root, "src", "situations", "streakwatch.js"), "utf8");
    ok((src.match(/\[30, 25, 20, 15\]/g) || []).length === 2 && typeof SW.teamSeqs === "function", "team streak watch (0.79): runs of games won or lost by 15+ join 20, 25 and 30");
  }

  // Seeded rare game states reach NBA Live through tonight.json; the playoff ones wait.
  {
    const sd = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "seeded-lists.json"), "utf8"));
    const st = fs.readFileSync(path.join(root, "scripts", "situations.js"), "utf8");
    ok(sd.situations.length === 4 && sd.situations.filter((x) => !x.playoffs).map((x) => x.id).join() === "ot-down-10,road-100-before-50" && sd.situations.every((x) => x.text && x.asOf && x.when && x.source) && /filter\(\(x\) => !x\.playoffs\)/.test(st) && /defense, stars, situations\b/.test(st)
      && /var VERSION = (?:1[5-9]|[2-9]\d);/.test(fs.readFileSync(path.join(root, "docs", "bridge", "cc-bridge.js"), "utf8")),
      "seeded situations (0.79): four looked-up records kept with their date and source; the two that aren't playoff-only go to NBA Live (bridge v15)");
  }
}

// ---------- 0.80: standings and magic numbers, team seasons since 1946-47, season starts, calendar records, injury fallback ----------
{
  // 0.81: a run of missed threes is a line when it fits in SHOTS.fg3Games of his own games, however far apart they
  // were (the user, 11/16: a time limit "disregards players who are injured for weeks at a time between games").
  {
    const { tonightCandidates: TC, SHOTS } = await import("../src/anticipate/tonight.js");
    const P = (name, from, games) => ({ name, team: "MIA", last: "2026-11-15", gp: 12, fta: 6, fg: 0, fg3: 0, ft: 0, fgMiss: 0, fg3Miss: 14, fg3MissFrom: from, fg3MissGames: games, dryFg: { sec: 0, fga: 0, from: "2026-11-15", games: 1 }, dryFt: { sec: 0, fga: 0, from: "2026-11-15", games: 1 } });
    const flow = { shots: { players: { a: P("Volume Shooter", "2026-11-09", 3), b: P("Rare Shooter", "2026-10-22", 12), c: P("Back From Injury", "2026-10-22", 3) }, best: {} } };
    const watch = { today: "2026-11-16", teams: [], games: [{ id: "1", homeTri: "MIA", awayTri: "HOU" }] };
    const L = TC({ watch, fouls: flow, prep: null }).all.filter((x) => /^shots\|/.test(x.key || "") && /3-point/.test(x.text)).map((x) => x.text).sort();
    ok(L.length === 2 && L[0] === "Back From Injury has missed his last 14 3-point attempts (over his last 3 games, since 10/22)" && /^Volume Shooter has missed his last 14 3-point attempts \(over his last 3 games, since 11\/9\)$/.test(L[1]) && SHOTS.fg3Games === 10 && SHOTS.fg3Days === undefined,
      "shot runs (0.81): 14 missed threes over three of his games is a line even when three weeks out lie between them; the same 14 spread over twelve games is not", JSON.stringify(L));
    // The span is counted in the games he played.
    const { shotStreaks } = await import("../src/gameflow/stats.js");
    const miss = (n) => ({ name: "Shooter", team: "MIA", total: 2880, ev: Array.from({ length: n }, (_, i) => [60 * (i + 1), "3", 0]) });
    const SS = shotStreaks([{ date: "2026-10-20", shots: { 9: miss(4) } }, { date: "2026-10-22", shots: { 9: miss(3) } }, { date: "2026-11-14", shots: { 9: miss(5) } }]);
    ok(SS.players[9].fg3Miss === 12 && SS.players[9].fg3MissGames === 3 && SS.players[9].fg3MissFrom === "2026-10-20", "shot runs (0.81): the span of a miss run is his own games played, not days", JSON.stringify(SS.players[9]));
  }
  const { standings, clinchLines, cupFinal, GAMES } = await import("../src/situations/standings.js");
  const { teamSeasonLines, sinceTable } = await import("../src/situations/teamseasons.js");
  const { streakWatch } = await import("../src/situations/streakwatch.js");
  const TS = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-team-seasons-2026-27.json"), "utf8"));
  const tip = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "tipoff-guide-2026-27.json"), "utf8"));
  // Every franchise's seasons add up to the all-time record the Tip-Off Guide prints (two printed sources agreeing).
  const NICK = { Celtics: "BOS", Spurs: "SAS", Lakers: "LAL", Thunder: "OKC", Suns: "PHX", Jazz: "UTA", Bucks: "MIL", Heat: "MIA", "Trail Blazers": "POR", "76ers": "PHI", Nuggets: "DEN", Rockets: "HOU", Bulls: "CHI", Hawks: "ATL", Mavericks: "DAL", Pacers: "IND", Cavaliers: "CLE", Knicks: "NYK", Warriors: "GSW", Magic: "ORL", Raptors: "TOR", Pistons: "DET", Kings: "SAC", Wizards: "WAS", Pelicans: "NOP", Nets: "BKN", Hornets: "CHA", Clippers: "LAC", Grizzlies: "MEM", Timberwolves: "MIN" };
  const off = tip.franchises.map((f) => { const tri = NICK[Object.keys(NICK).find((k) => f.team.endsWith(k))], L = TS.teams[tri] || []; return [tri, L.reduce((a, x) => a + x[1], 0), L.reduce((a, x) => a + x[2], 0), f.w, f.l]; }).filter((x) => x[1] !== x[3] || x[2] !== x[4]);
  ok(Object.keys(TS.teams).length === 30 && tip.franchises.length === 30 && off.length === 0 && TS.teams.BOS[0][0] === "1946-47" && TS.teams.OKC[0][0] === "1967-68" && TS.teams.CHA.length === 36,
    "team seasons (0.80): every franchise's season records since 1946-47 add up to the Tip-Off Guide's all-time record, all 30", JSON.stringify(off));
  // A small league: two seasons of history, this season's standings.
  const mini = { teams: { AAA: [["2004-05", 60, 22], ["2025-26", 20, 62]], BBB: [["2004-05", 30, 52], ["2025-26", 50, 32]], CCC: [["2004-05", 41, 41], ["2025-26", 41, 41]] } };
  const tab = sinceTable(mini.teams, { AAA: { w: 1, l: 0 } }, 2025);
  ok(tab[0].tri === "BBB" && tab[0].rank === 1 && tab[2].tri === "AAA" && tab[2].w === 21 && sinceTable(mini.teams, {}, 2004)[0].tri === "CCC" && sinceTable(mini.teams, {}, 2004)[1].w === 80 && sinceTable(mini.teams, {}, 2004)[1].rank === sinceTable(mini.teams, {}, 2004)[2].rank,
    "team seasons (0.80): a record since a season, this season included, ranked against the league", JSON.stringify(tab));
  const hist = { teams: Object.fromEntries(Object.keys(TS.teams).map((t) => [t, TS.teams[t]])) };
  const S0 = { East: [{ tri: "BOS", w: 11, l: 2 }, { tri: "MIL", w: 1, l: 13 }, { tri: "NYK", w: 7, l: 6 }], West: [{ tri: "SAS", w: 12, l: 2 }, { tri: "LAC", w: 5, l: 8 }] };
  const tl = teamSeasonLines(hist, S0, new Set(["BOS", "MIL", "NYK", "SAS", "LAC"]), { season: 2026 });
  const tx = (k) => tl.find((l) => l.key === k)?.text;
  ok(/^SAS has the NBA's best record since 2004-05 \(\d+-\d+\)$/.test(tx("era|since|SAS|best")) && /^BOS has the NBA's 2nd-best record since 2004-05 \(\d+-\d+\); SAS is first at/.test(tx("era|since|BOS|best"))
    && tx("era|pace|BOS|best") === "BOS (11-2) is on pace for 69-13; the best season in franchise history is 68-14 (1972-73)" && tx("era|pace|MIL|worst") === "MIL (1-13) is on pace for 6-76; the worst season in franchise history is 15-67 (2013-14)"
    && !tl.some((l) => l.team === "NYK" && /pace/.test(l.key)) && tl.every((l) => l.kind === "era" && l.standing === true),
    "team seasons (0.80): any team's record since a season when it ranks in the league's top or bottom three, and a pace past the franchise's best or worst season; standing lines", JSON.stringify(tl.map((l) => l.text)));

  // Standings: a made-up finish. Five East teams; the two leaders have a game left with each other.
  const E5 = ["BOS", "NYK", "PHI", "BKN", "TOR"];
  const mk = (d, h, a, hs, as, n) => ({ d, h, a, hs, as, n });
  const rowsS = [];
  let day = 0;
  const date = () => `2027-0${1 + Math.floor(day / 28)}-${String(1 + (day++ % 28)).padStart(2, "0")}`;
  for (let i = 0; i < 20; i++) { rowsS.push(mk(date(), "BOS", "TOR", 110, 100)); rowsS.push(mk(date(), "NYK", "BKN", 110, 100)); }
  for (let i = 0; i < 5; i++) rowsS.push(mk(date(), "PHI", "NYK", 110, 100));
  const st = standings(rowsS, { games: 30 });
  const row = (t) => st.East.find((x) => x.tri === t);
  ok(row("BOS").seed === 1 && row("BOS").w === 20 && row("BOS").l === 0 && row("BOS").left === 10 && row("NYK").w === 20 && row("NYK").l === 5 && row("NYK").gb === 2.5 && row("TOR").l === 20 && row("BOS").streak === "W20" && row("BOS").home === "20-0"
    && st.East.length === 15 && st.West.length === 15 && GAMES === 82,
    "standings (0.80): order, record, games back, home record and streak from the results alone", JSON.stringify(st.East.slice(0, 5).map((t) => [t.tri, t.seed, t.w, t.l, t.gb, t.streak, t.home])));
  // BOS for the division: the rival hardest to shake is unbeaten PHI (5-0): 30 - 0 (its losses) - 20 (BOS's wins) + 1 (no tie-break in hand) = 11.
  ok(row("BOS").magic.division.n === 11 && row("BOS").magic.division.vs === "PHI", "standings (0.80): a magic number is games minus their losses minus our wins, plus one without the tie-break", JSON.stringify(row("BOS").magic));
  const near = { East: [{ tri: "BOS", w: 60, l: 10, magic: { top: { n: 1, vs: "NYK" }, division: { n: 1, vs: "NYK" }, playoff: { n: 0, vs: "MIA" }, playin: { n: 0, vs: "CHI" } }, elim: {} },
    { tri: "ATL", w: 30, l: 40, magic: { top: null, division: null, playoff: { n: 9, vs: "ORL" }, playin: { n: 4, vs: "CHI" } }, elim: { playoff: { n: 3, vs: "ORL" } } },
    { tri: "WAS", w: 15, l: 55, magic: {}, elim: { playin: { n: 1, vs: "CHI" }, playoff: { n: 0, vs: "MIA" } } }], West: [] };
  const cl = clinchLines(near, new Set(["BOS", "ATL", "WAS"])).map((l) => l.text);
  ok(cl.includes("BOS (60-10) clinches the best record in the East with a win tonight") && cl.some((t) => /^ATL's magic number for at least a Play-In place is 4 \(30-40; any mix of its wins and CHI losses\)$/.test(t))
    && cl.some((t) => /^ATL's elimination number for a top-six place is 3/.test(t)) && cl.includes("WAS (15-55) is out of the postseason with a loss tonight") && clinchLines(near, new Set(["NYK"])).length === 0,
    "clinch watch (0.80): a line once a number is within five, the biggest prize only, and 'with a win tonight' at one", JSON.stringify(cl));
  // The Cup's title game is in no one's record; the semifinals are.
  const cupRows = [mk("2026-12-12", "OKC", "HOU", 110, 100, 1), mk("2026-12-12", "NYK", "ORL", 110, 100, 1), mk("2026-12-15", "OKC", "NYK", 110, 100, 1), mk("2026-12-25", "NYK", "CLE", 110, 100)];
  const cs = standings(cupRows);
  ok(cupFinal(cupRows)?.d === "2026-12-15" && cs.West.find((t) => t.tri === "OKC").w === 1 && cs.East.find((t) => t.tri === "NYK").w === 2 && cs.East.find((t) => t.tri === "NYK").l === 0 && cupFinal(cupRows.slice(0, 2)) === null,
    "standings (0.80): the NBA Cup's title game counts in no record (ESPN files it with the regular season); the semifinals count");

  // Season starts against a team's own earlier starts.
  const H = { columns: ["date", "home", "away", "homeScore", "awayScore", "type"], games: [] };
  for (let y = 2016; y <= 2025; y++) for (let i = 0; i < 8; i++) {
    const d = `${y}-11-${String(i + 1).padStart(2, "0")}`;
    H.games.push([d, "OKC", "UTA", y >= 2024 ? 110 : i < 2 ? 110 : 90, 100, 2]);          // OKC: 8-0 the last two seasons, 2-6 before
    H.games.push([d, "POR", "SAC", i < 3 ? 110 : 90, 100, 2]);                              // POR: 3-5 every season
  }
  const cur = [];
  for (let i = 0; i < 6; i++) { const d = `2026-10-${String(20 + i).padStart(2, "0")}`; if (i < 4) cur.push(mk(d, "OKC", "UTA", 110, 100)); cur.push(mk(d, "POR", "SAC", i === 5 ? 90 : 110, 100)); }
  const sw = streakWatch({ history: H, rows: cur, today: "2026-10-27" }).filter((l) => /^start/.test(l.stat)).map((l) => l.text);
  ok(sw.includes("OKC is 4-0: a win tonight makes it 5-0 for the 3rd straight season (no team has done that since 2016-17)") && sw.includes("POR is 5-1: its best start through 6 games since at least 2016-17")
    && sw.some((t) => /^SAC is 1-5: its worst start through 6 games since at least 2016-17$/.test(t)) && !sw.some((t) => /^UTA is 0-4/.test(t)),
    "season starts (0.80): any team's best or worst start in five or more seasons, and an unbeaten team one win from matching its last seasons' starts", JSON.stringify(sw));

  // Weekday and month records: counted for every team, listed as unusual only when far from the team's own record.
  const { computeSituations } = await import("../src/situations/records.js");
  const cal = [];
  let cid = 0;
  const g2 = (d, h, a, hs, as) => ({ ...mk(d, h, a, hs, as), id: String(++cid) });
  const iso = (n) => new Date(Date.UTC(2026, 9, 25 + n)).toISOString().slice(0, 10); // 10/25/26 is a Sunday
  // DEN loses all 12 Sundays and wins its other 24; MIA splits everything evenly.
  for (let w = 0; w < 12; w++) {
    cal.push(g2(iso(7 * w), "DEN", "DAL", 90, 100), g2(iso(7 * w + 3), "DEN", "DAL", 110, 100), g2(iso(7 * w + 5), "DEN", "DAL", 110, 100));
    cal.push(g2(iso(7 * w), "MIA", "ATL", w % 2 ? 90 : 110, 100), g2(iso(7 * w + 3), "MIA", "ATL", w % 2 ? 110 : 90, 100));
  }
  const cso = computeSituations(cal, { through: "2027-01-20" });
  const den = cso.teams.DEN, calU = (cso.unusual || []).filter((x) => x.cal);
  ok(den.splits.dow0?.l === 12 && den.splits.dow0.w === 0 && den.splits.dow3?.w === 12 && den.splits.mon11 && cso.teams.MIA.splits.dow0.w === 6
    && calU.some((x) => x.team === "DEN" && x.key === "dow0" && /^0-12 on Sundays$/.test(x.short)) && !calU.some((x) => x.team === "MIA"),
    "calendar records (0.80): every team's record by weekday and month is counted; one is listed as unusual only when it is far from the team's own record", JSON.stringify({ keys: Object.keys(den.splits || {}).filter((k) => /^(dow|mon)/.test(k)), calU: calU.map((x) => [x.team, x.short, x.p]) }));
}

// ---------- 0.81: fourth-quarter leads, arena records, the finder, New Orleans' coach table ----------
{
  const T = await import("../src/anticipate/tonight.js");
  // A lead of 15+ held in the 4th quarter and lost, with the league's record in such games.
  const by = (o) => ({ gp: 12, upW: 5, upL: 1, downW: 1, downL: 4, run: [], longest: 1, last: "2026-11-15", lateW: 3, lateLost: [], lateWon: [], ...o });
  const flow = { by10: { NOP: by({ lateLost: [{ lead: 19, opp: "DEN", d: "2026-10-24" }] }), DEN: by({ lateW: 5, lateWon: [{ down: 19, opp: "NOP", d: "2026-10-24" }] }), BOS: by({ lateW: 6 }) } };
  const L = T.flowTeamLines(flow, new Set(["NOP", "DEN", "BOS"]), "2026-11-16");
  const tx = (k) => L.find((l) => l.key === k)?.text;
  ok(tx("late15|NOP|lost") === "NOP has lost a game it led by 15+ in the 4th quarter (19 up on DEN 10/24); teams with such a lead are 14-1 this season"
    && tx("late15|DEN|won") === "DEN has won a game it trailed by 15+ in the 4th quarter (19 down to NOP 10/24); teams that far behind in a 4th quarter are 1-14 this season" && !L.some((l) => /^late15\|BOS/.test(l.key)),
    "fourth-quarter leads (0.81): any team that lost a game it led by 15+ in the 4th, or won one it trailed by that much, with the league's record in those games", JSON.stringify(L.map((l) => l.text)));
  const br = fs.readFileSync(path.join(root, "docs", "bridge", "cc-bridge.js"), "utf8");
  ok(/var VERSION = (?:1[7-9]|[2-9]\d);/.test(br) && /var LATE_LEAD = 15;/.test(br) && /M\[side\] >= LEAD \|\| late >= LATE_LEAD/.test(br) && /"📉 4TH-QUARTER LEAD LOST"/.test(br) && /function arenaChecks/.test(br) && /find: "🔎 FOUND IN THE NUMBERS"/.test(br),
    "bridge v17: a lead lost is a card from 20 at any time or from 15 held in the 4th quarter; the arena-record card; the finder's label");

  // Arena records: the list as sent, with what we could check, and this season's box scores on top.
  const { arenaRecords, arenasTonight } = await import("../src/records/arena.js");
  const AR = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "arena-records.json"), "utf8"));
  const tris = AR.arenas.map((a) => a.team);
  ok(AR.arenas.length === 30 && new Set(tris).size === 30 && AR.arenas.every((a) => a.arena && a.pts >= 50 && a.holders.length && a.holders.every((h) => h.player && /^\d{4}-\d\d-\d\d$/.test(h.date)) && ["confirmed", "quiz", "corrected", "unconfirmed"].includes(a.check) && (a.check === "confirmed" || a.check === "quiz" || a.note))
    && AR.arenas.find((a) => a.team === "HOU").holders.length === 1 && AR.arenas.find((a) => a.team === "DET").pts === 53 && AR.arenas.find((a) => a.team === "OKC").pts === 58 && AR.arenas.find((a) => a.team === "OKC").check === "confirmed" && AR.former.length === 16,
    "arena records (0.81): all 30 buildings, each row marked confirmed / as the quiz has it / corrected / unconfirmed, and every row that isn't as sent says why");
  const line = (side, pts) => [side, 1, 36, pts, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const g = (d, h, a, pl, n) => ({ id: d + h, d, h, a, hs: 110, as: 100, n, pl });
  const rowsA = [g("2026-05-01", "DET", "CHI", { 1: line(1, 70) }),                               // before the list's date: already in it
    g("2026-11-01", "DET", "CHI", { 1: line(1, 53), 2: line(0, 30) }), g("2026-11-03", "BKN", "NYK", { 3: line(0, 58) }),
    g("2026-12-12", "OKC", "HOU", { 4: line(0, 80) }, 1), g("2026-11-05", "MIA", "ATL", { 5: line(1, 82) })];
  const rec = arenaRecords(AR, rowsA, { 1: "Visiting Scorer", 3: "Home Scorer", 4: "Cup Scorer" });
  const at = arenasTonight(rec, ["DET", "BKN"]);
  ok(rec.DET.pts === 53 && rec.DET.holders.length === 2 && rec.DET.holders[1].player === "Visiting Scorer" && rec.DET.holders[1].opp === "DET" && rec.DET.check === "confirmed"
    && rec.BKN.pts === 58 && rec.BKN.holders.length === 1 && rec.BKN.holders[0].player === "Home Scorer" && rec.BKN.season === true && rec.OKC.pts === 58 && rec.MIA.pts === 83
    && at.BKN.who === "Home Scorer 11/3/26" && /Little Caesars Arena/.test(at.DET.arena) && /^Anthony Edwards 1\/4\/25 and Visiting Scorer 11\/1\/26$/.test(at.DET.who) && !at.OKC,
    "arena records (0.81): this season's box scores set or tie a building's record (either team's player), games before the list's date and neutral-site games don't", JSON.stringify([rec.DET, rec.BKN, at]));

  // The finder: pieces of a scorer against the league's whole, one player against whole teams, a leader far ahead.
  const { findings, finderLines, PART, TEAMS: FT } = await import("../src/anticipate/finder.js");
  const pgF = {}, namesF = {}, qsumF = {}, teamGpF = {};
  const TRIS = ["ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"];
  let pid = 0;
  const add = (name, team, ppg, { ftm = 4, fg3m = 2, ast = 4, q = null } = {}) => {
    const id = String(++pid); namesF[id] = name;
    pgF[id] = Array.from({ length: 10 }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, team, opp: "XXX", min: 34, pts: ppg, fgm: Math.round((ppg - ftm - fg3m) / 2), fg3m, ftm, reb: 5, ast, stl: 1, blk: 0 }));
    const qq = q || [ppg / 4, ppg / 4, ppg / 4, ppg / 4];
    qsumF[id] = { name, team, gp: 10, q: qq.map((v) => v * 10), pts: ppg * 10 };
  };
  TRIS.forEach((t, i) => { teamGpF[t] = 10; add(`Scorer ${t}`, t, 28 - i * 0.5); add(`Second ${t}`, t, 14 - i * 0.2); });
  add("Absurd Scorer", "LAL", 40, { ftm: 9, fg3m: 5, q: [12, 11, 10, 7] });            // 33 through three quarters; 31 without free throws
  add("Lone Passer", "UTA", 12, { ast: 11 });                                           // ten 10-assist games; nobody else has one
  const FD = findings({ pg: pgF, names: namesF, qsum: qsumF, teamGp: teamGpF });
  const fd = (re) => FD.find((f) => re.test(f.key));
  const part = fd(/^find\|part\|\d+\|q3\+noft$/), teamsF = fd(/^find\|teams\|\d+\|a10$/), gapF = FD.filter((f) => f.test === "gap" && f.player === "Absurd Scorer");
  ok(part && part.player === "Absurd Scorer" && part.text === "Absurd Scorer is the NBA's leading scorer at 40.0 a game. His scoring through three quarters alone (33.0) would still lead everyone else (next: Scorer ATL, 28.0); his scoring without his free throws alone (31.0) would still lead everyone else (next: Scorer ATL, 28.0)"
    && teamsF && teamsF.text === "Lone Passer has 10 games with 10+ assists this season: more than any other team has in total (29 teams have none)" && teamsF.rare
    && gapF.length === 1 && /^Absurd Scorer leads the NBA in scoring/.test(gapF[0].text) && /a bigger gap than the one between 2nd and 10th/.test(gapF[0].text)
    && !FD.some((f) => f.test === "part" && /^Second /.test(f.player)) && FD.every((f) => f.kind === "find" && f.score >= 2.9 && f.score <= 4 && f.key.startsWith("find|")) && PART.top === 10 && FT.min === 24,
    "finder (0.81): a piece of a scorer's game that would still rank among the league's full averages, one player's count against whole teams, and a leader further ahead than 2nd is of 10th; ordinary players produce nothing",
    JSON.stringify(FD.slice(0, 6).map((f) => [f.test, f.surprise, f.text])));
  const FL = finderLines({ pg: pgF, names: namesF, qsum: qsumF, teamGp: teamGpF }, new Set(["UTA"]), { top: 3 });
  ok(FL.lines.every((l) => l.team === "UTA") && FL.lines.some((l) => l.player === "Lone Passer") && FL.league.length <= 3 && new Set(FL.league.map((l) => l.player)).size === FL.league.length && FL.league[0].surprise >= FL.league[FL.league.length - 1].surprise
    && findings({ pg: Object.fromEntries(Object.entries(pgF).slice(0, 20)), names: namesF, qsum: qsumF, teamGp: teamGpF }).length === 0,
    "finder (0.81): tonight's teams get their findings as candidates, the league list has one line a player, most out-of-line first; too few qualified players and it says nothing");
  // All-Star selections (the NBA Guide's counts): the highest-ranked player on a list who has never been one.
  {
    const { plainName } = await import("../src/anticipate/finder.js");
    const AS = new Set(Object.values(namesF).filter((n) => n !== "Scorer BKN" && n !== "Lone Passer").map(plainName));
    const NA = findings({ pg: pgF, names: namesF, qsum: qsumF, teamGp: teamGpF, allStars: AS }).filter((f) => f.test === "noas").map((f) => f.text);
    const real = new Set(JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-postseason-careers-2026-27.json"), "utf8")).allStarSelections.map((x) => plainName(x.name)));
    ok(NA.includes("Scorer BKN is 4th in the NBA in scoring (27.0 points a game) and has never been an All-Star: the 3 players ahead of him have all been one") && NA.includes("Lone Passer leads the NBA in assists (11.0 assists a game) and has never been an All-Star")
      && plainName("Luka Dončić") === "luka doncic" && plainName("Jaren Jackson Jr.") === "jaren jackson" && real.has("lebron james") && real.has("luka doncic") && real.size >= 400
      && findings({ pg: pgF, names: namesF, qsum: qsumF, teamGp: teamGpF }).every((f) => f.test !== "noas"),
      "finder (0.81): the highest-ranked scorer, rebounder or passer who has never been an All-Star, from the NBA Guide's selection counts; names match without accents or Jr.", JSON.stringify(NA));
  }
  // 0.94 (the user, 11/17): a rookie is never "not an All-Star", and a league leader gets what is new about him.
  {
    const { plainName } = await import("../src/anticipate/finder.js");
    const AS = new Set(Object.values(namesF).filter((n) => n !== "Scorer BKN" && n !== "Lone Passer").map(plainName));
    const idOf = (n) => Object.keys(namesF).find((k) => namesF[k] === n);
    const leadersF = { ast: [{ season: "2024-25", player: "Old Passer", value: 11.6 }, { season: "2025-26", player: "Other Passer", value: 10.7 }], pts: [{ season: "2025-26", player: "Absurd Scorer", value: 33.1 }] };
    const F1 = findings({ pg: pgF, names: namesF, qsum: qsumF, teamGp: teamGpF, allStars: AS, leaders: leadersF, rookies: new Set() });
    const F2 = findings({ pg: pgF, names: namesF, qsum: qsumF, teamGp: teamGpF, allStars: AS, leaders: leadersF, rookies: new Set([idOf("Lone Passer"), idOf("Scorer BKN")]) });
    const t1 = F1.filter((f) => f.test === "first" || f.test === "noas").map((f) => f.text), t2 = F2.filter((f) => f.test === "first" || f.test === "noas").map((f) => f.text);
    ok(t1.includes("Lone Passer leads the NBA in assists (11.0 assists a game): he has never led the league in assists (last season's leader: Other Passer, 10.7)") && !t1.some((t) => /Lone Passer.*All-Star/.test(t))
      && t1.some((t) => /^Scorer BKN is \dth in the NBA in scoring .* and has never been an All-Star/.test(t)) && !t1.some((t) => /^Absurd Scorer leads the NBA in scoring .*never led/.test(t))
      && t2.includes("Lone Passer leads the NBA in assists (11.0 assists a game) as a rookie (last season's leader: Other Passer, 10.7)") && !t2.some((t) => /All-Star/.test(t) && /Lone Passer|Scorer BKN/.test(t)),
      "finder (0.94; the user, 11/17: a rookie \"wouldn't have been able to be\" an All-Star, and of the assists leader \"since he's never led the league in assists per game before, it is notable that he is now\"): the league leader in a stat who has never led it gets that line, from the NBA Guide's yearly leaders; a past leader gets none; nobody in his first season is called 'never an All-Star'; a rookie leading says 'as a rookie'",
      JSON.stringify([t1, t2]));
  }
  // 0.94 (the user's 'DET notes' line, 11/17): two bullets that ran together are two lines, and a feat gets its game's date.
  {
    const { readHistory, splitBullets } = await import("../src/notes/narrative.js");
    const { statClaims: SC } = await import("../src/notes/boxscore.js");
    const Ln = (text) => ({ text, cells: [{ x0: 40, x1: 560, cx: 300, text }], charX: [] });
    const keysN = ["min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"], rowN = (o) => keysN.map((k) => o[k] || 0);
    const playersN = [{ id: "1", name: "Cade Cunningham" }, { id: "2", name: "Duncan Robinson" }, { id: "3", name: "Jalen Duren" }];
    const boxN = { keys: keysN, names: { 1: "Cade Cunningham", 2: "Duncan Robinson" }, games: [{ d: "2026-11-15", opp: "PHI", pl: { 1: rowN({ pts: 30, ftm: 14, fta: 14 }), 2: rowN({ pts: 8, fg3m: 2 }) } }, { d: "2026-11-13", opp: "CHI", pl: { 1: rowN({ pts: 22, ftm: 5, fta: 7 }) } }] };
    const docN = { pages: [{ page: 1, width: 612, lines: [Ln("• Cade Cunningham made all 14 of his free throws, the most he has made without a miss in his career Duncan Robinson knocked down two three-point field goals and his 47 treys are tied for the fourth most in the league this season.")] }] };
    const hN = readHistory(docN, playersN, { seasonStart: "2026-10-01", today: "2026-11-17", teamWords: ["Detroit", "Pistons"], box: boxN }).map((x) => [x.player, x.text]);
    const fullN = playersN.map((p) => ({ ...p, re: new RegExp(`\\b${p.name}\\b`, "i") }));
    ok(hN.length === 2 && hN[0][0] === "Cade Cunningham" && hN[0][1] === "Cade Cunningham made all 14 of his free throws, the most he has made without a miss in his career (11/15 vs. PHI)."
      && hN[1][0] === "Duncan Robinson" && /^Duncan Robinson knocked down two three-point field goals/.test(hN[1][1]) && !/Cunningham/.test(hN[1][1])
      && splitBullets("Cade Cunningham scored 30 points and handed out 10 assists, joining Jalen Duren as the only Pistons with such a game this season and the first since 2019.", fullN).length === 1
      && splitBullets("Cade Cunningham and Jalen Duren combined for 60 points, the most by a Pistons duo since Isiah Thomas and Joe Dumars had 62 in 1990 in a win.", fullN).length === 1
      && JSON.stringify(SC("made all 14 of his free throws")) === JSON.stringify([{ stat: "ftm", n: 14 }, { stat: "fta", n: 14 }]),
      "notes (0.94; the user, 11/17: \"this looks like a merge, but it also doesn't tell me when cade made those free throws\"): a bullet with no full stop that ran into the next player's bullet is cut at his name, each line keeps its own player, and a feat told without a date gets the date of the one box score it matches; a name after 'joining' or 'and' is not a new bullet",
      JSON.stringify(hN));
  }
  // Votes on finder lines teach it by test and by cut.
  const { features } = await import("../src/anticipate/learn.js");
  ok(["kind:find", "find:part", "find:part:q3", "find:part:noft"].every((f) => features(part, {}).includes(f)) && features({ kind: "season", key: "x|y", text: "" }, {}).every((f) => !f.startsWith("find:")),
    "finder (0.81): a vote on a finder line counts for its kind, its test and each cut it used", JSON.stringify(features(part, {})));

  // New Orleans' coach table: three teams' numbers print a line above their names, with another table's row after them.
  const { readCoachRecord, coachLine } = await import("../src/notes/formats/coach-record.js");
  const nick = ["Hawks", "Celtics", "Nets", "Hornets", "Bulls", "Cavaliers", "Mavericks", "Nuggets", "Pistons", "Warriors", "Rockets", "Pacers", "Lakers", "Heat", "Bucks", "Timberwolves", "Pelicans", "Knicks", "Thunder", "Magic", "76ers", "Suns", "Trail Blazers", "Kings", "Spurs", "Raptors", "Wizards"];
  const linesC = [{ text: "JAMAHL MOSLEY'S ALL-TIME RECORD VS. THE NBA (ENTERING 11/16/2026)  JAMAHL MOSLEY'S OVERALL RECORD" }, { text: "CAREER REGULAR SEASON RECORD: 67-76" },
    { text: "6  6  4  7  3  9  2022-23  Magic  34-47  .420" }, { text: "Jazz  Clippers  Grizzlies" }];
  for (let i = 0; i < nick.length; i += 3) linesC.push({ text: nick.slice(i, i + 3).map((n) => `${n}  2  2`).join("  ") });
  const recC = readCoachRecord({ pages: [{ page: 30, lines: linesC }] });
  ok(recC?.ok && Object.keys(recC.teams).length === 30 && recC.teams.UTA.w === 6 && recC.teams.LAC.l === 7 && recC.teams.MEM.l === 9 && recC.sum.w === 67
    && coachLine(recC, "UTA") === "Jamahl Mosley is 6-6 all-time against the Jazz as a head coach (67-76 overall, entering 11/16)."
    && /against the Heat as/.test(coachLine({ ...recC, teams: { ...recC.teams, MIA: { w: 10, l: 11 } } }, "MIA")),
    "coach record (0.81): New Orleans' table, where three teams' numbers sit on the line above their names; every nickname takes 'the'", JSON.stringify([recC?.ok, recC?.sum, recC && Object.keys(recC.teams).length]));
}

// ---------- 0.82: NBA Live cards (fouls, bench, reach), first scoreless game, Warriors' notes, lists of games ----------
{
  const br = fs.readFileSync(path.join(root, "docs", "bridge", "cc-bridge.js"), "utf8");
  ok(/var VERSION = (?:18|19|[2-9]\d);/.test(br) && /function foulTime\(game, id, n, asPlay\)/.test(br) && /foulTime\(game, p\.id, pf, true\)/.test(br) && /var benchFor = function/.test(br) && /per <= 2 && \(pf >= 2 \|\| state\.ftShown/.test(br)
    && /var BIG_IMPORTANCE = 50;/.test(br) && /var REACH = \{ pts: 10, fg3m: 3, reb: 4, ast: 4, stl: 3, blk: 3,/.test(br) && /i\.importance < BIG_IMPORTANCE && \(i\.need - v\) > reachOf\(i\.stat\)/.test(br) && /function zeroChecks/.test(br),
    "bridge v18: a foul's own time from the play-by-play; no bench card for a starter sitting with two fouls in the first half; a milestone below importance 50 only within NBA Live's reach; the still-scoreless card");
  // The bridge's foul clock, run on a made-up play list (newest first, as NBA Live keeps it).
  {
    const src = br.slice(br.indexOf("  function foulTime(game, id, n, asPlay) {"), br.indexOf("  function feedReached(game, qtr) {"));
    const foulTime = new Function(`${src}; return foulTime;`)();
    const plays = [{ badge: "foul", playerId: "7", qtr: "Q2", clock: "9:44", desc: "X shooting foul" }, { badge: "foul", playerId: "7", qtr: "Q1", clock: "3:10", desc: "X technical foul" },
      { badge: "foul", playerId: "9", qtr: "Q1", clock: "5:00", desc: "Y personal foul" }, { badge: "foul", playerId: "7", qtr: "Q1", clock: "6:15", desc: "X personal foul" }, { badge: "foul", playerId: "7", qtr: "Q1", clock: "10:02", desc: "X offensive foul" }];
    ok(foulTime({ plays }, "7", 1) === "Q1 10:02" && foulTime({ plays }, "7", 2) === "Q1 6:15" && foulTime({ plays }, "7", 3) === "Q2 9:44" && foulTime({ plays }, "7", 4) === null && foulTime({ plays: [] }, "7", 1) === null,
      "bridge v18: the time of a player's nth personal foul is read from the play-by-play (technicals not counted), whenever the card is drawn");
    // v22: ESPN's two plays for one offensive foul (Luka Doncic, 11/17 v CHA: his 3rd at Q1 22.3, his 4th at Q2 8.3)
    const luka = [["Q1", "5:51", "personal foul"], ["Q1", "1:30", "personal foul"], ["Q1", "22.3", "offensive foul"], ["Q1", "22.3", "offensive foul turnover"], ["Q2", "8.3", "offensive foul"], ["Q2", "8.3", "offensive foul turnover"]]
      .map(([qtr, clock, d], i) => ({ badge: "foul", playerId: "77", qtr, clock, desc: "Luka Doncic " + d, seqNum: i }));
    ok(foulTime({ plays: luka }, "77", 3) === "Q1 22.3" && foulTime({ plays: luka }, "77", 4) === "Q2 8.3" && foulTime({ plays: luka }, "77", 5) === null && !/more fouls than the period number/.test(br.slice(br.indexOf("var rows = (times.length === pf"), br.indexOf("var rows = (times.length === pf") + 400)) && /var VERSION = (?:2[3-9]|[3-9]\d);/.test(br),
      "bridge v22: an offensive foul's 'offensive foul turnover' line is not a second foul (his 4th foul is at its own time, not his 3rd's), and the foul trouble card's back no longer prints the rule",
      JSON.stringify([3, 4, 5].map((n) => foulTime({ plays: luka }, "77", n))));
    // v23: a charge has only its turnover line tagged as a foul (Kevin Durant, 11/14: three shooting fouls, then a charge at Q4 1:14; LeBron James the same night)
    const kd = [["Q2", "5:18", "shooting foul"], ["Q2", "4:51", "shooting foul"], ["Q3", "11:23", "shooting foul"], ["Q4", "1:14", "offensive foul turnover"], ["Q4", "0:40", "hanging techfoul"]]
      .map(([qtr, clock, d], i) => ({ badge: "foul", playerId: "35", qtr, clock, desc: "Kevin Durant " + d, seqNum: i }));
    ok(foulTime({ plays: kd }, "35", 4) === "Q4 1:14" && foulTime({ plays: kd }, "35", 5) === null && foulTime({ plays: luka }, "77", 4) === "Q2 8.3",
      "bridge v23 (self-audit of v22): a charge's only foul-tagged line is its 'offensive foul turnover', which v22 threw away; it is the foul when no foul line stands at the same instant, and 'hanging techfoul' is a technical", JSON.stringify([4, 5].map((n) => foulTime({ plays: kd }, "35", n))));
  }

  // A first career game without a point, rebound or assist.
  const { zeroCareers, zeroWatch, zeroLines, ZERO } = await import("../src/anticipate/zeros.js");
  const logs = { columns: ["date", "opp", "home", "result", "type", "min", "pts", "reb", "ast"], players: {
    1: Array.from({ length: 200 }, (_, i) => [`2024-01-${String((i % 28) + 1).padStart(2, "0")}`, "BOS", 1, "W", 2, 34, 22 + (i % 5), 3, 9]),      // never scoreless
    2: [...Array.from({ length: 199 }, () => ["2024-01-01", "BOS", 1, "W", 2, 30, 18, 4, 2]), ["2024-02-01", "BOS", 1, "L", 2, 12, 0, 1, 0], ["2024-04-20", "BOS", 1, "L", 3, 30, 0, 1, 0]],  // one scoreless game already
    3: Array.from({ length: 300 }, () => ["2019-01-01", "BOS", 1, "W", 2, 33, 25, 8, 4]) } };
  const seasonsZ = { keys: ["season", "g", "min", "pts", "reb", "ast"], players: { "Never Blanked": [["2021-22", 100, 3400, 2300, 300, 900], ["2022-23", 100, 3400, 2300, 300, 900]],
    "Blanked Once": [["2021-22", 100, 3000, 1800, 400, 200], ["2022-23", 100, 3000, 1800, 400, 200]], "Old Hand": [["2010-11", 400, 14000, 10000, 3200, 1600], ["2016-17", 300, 10000, 7500, 2400, 1200]] } };
  const gz = (d, pts, o = {}) => ({ d, team: "WAS", opp: "HOU", min: 26, pts, reb: 1, ast: 8, fgm: 0, fga: 5, ...o });
  const pgZ = { 1: [gz("2026-11-12", 37, { fgm: 8 }), gz("2026-11-15", 0)], 2: [gz("2026-11-15", 0, { ast: 1 })], 3: [gz("2026-11-15", 0, { ast: 3, reb: 6 })], 4: [gz("2026-11-15", 0)] };
  const namesZ = { 1: "Never Blanked", 2: "Blanked Once", 3: "Old Hand", 4: "A Rookie" };
  const beforeZ = zeroCareers({ pg: pgZ, logs, seasons: seasonsZ, names: namesZ, before: "2026-11-15" });
  const zl = zeroLines({ pg: pgZ, careersBefore: beforeZ, since: "2026-11-15", allStar: { "never blanked": 4 }, plainName: (x) => x.toLowerCase() }).map((l) => l.text);
  const nowZ = zeroCareers({ pg: pgZ, logs, seasons: seasonsZ, names: namesZ });
  ok(zl.length === 2 && zl.includes("Never Blanked (4-time All-Star) was held scoreless for the first time in his career (202 games): 0-for-5 with 8 assists and 1 rebound in 26 minutes vs HOU")
    && zl.includes("Old Hand was held scoreless for the first time since at least 2016-17 (301 games): 0-for-5 with 3 assists and 6 rebounds in 26 minutes vs HOU")
    && beforeZ[1].stats.ast && !beforeZ[1].stats.reb && !beforeZ[4] && beforeZ[2].stats.pts.zeros === 1
    && !zeroWatch(nowZ, new Set(["WAS"]))[1].stats.includes("pts") && zeroWatch(nowZ, new Set(["WAS"]))[1].stats.includes("ast") && zeroWatch(beforeZ, new Set(["WAS"]))[1].stats.includes("pts") && !zeroWatch(beforeZ, new Set(["BOS"]))[1] && ZERO.games === 150,
    "firsts (0.82): a first scoreless game is said with the career games behind it ('since at least 2016-17' when the career is older than the logs); an earlier one, a playoff game or a rookie says nothing; NBA Live gets who has never had one",
    JSON.stringify([zl, beforeZ[2], zeroWatch(nowZ, null)]));

  // A list of whole games counted forward, and games in a row won after trailing by 10+.
  const S2 = await import("../src/gameflow/stats.js");
  const T2 = await import("../src/anticipate/tonight.js");
  const sd = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "seeded-lists.json"), "utf8"));
  const sc = S2.seededCounts(sd.lists, [], { "stephen curry": "GSW", "lebron james": "LAL" }, [{ name: "LeBron James", pts: 41, date: "2026-11-20" }, { name: "LeBron James", pts: 44, date: "2026-11-01" }, { name: "Stephen Curry", pts: 39, date: "2026-11-21" }]);
  const g35 = sc.find((l) => l.id === "g40-age35");
  const sl = T2.seededLines({ seeded: [g35] }, new Set(["LAL", "GSW"])).map((l) => l.text);
  ok(g35 && g35.rows.map((r) => `${r.name} ${r.n}`).join("|") === "Stephen Curry 16|LeBron James 16|Michael Jordan 12" && sl.length === 1 && sl.some((t) => /^LeBron James has 16 40-point games at age 35 or older, tied with Stephen Curry for the most; the next one puts him alone in first\. From the Warriors' notes, counted forward here from 11\/15$/.test(t)) && S2.BIG_GAME === 40   // 0.163.0: Curry, with no 40-point game this season, has no "next one" line
    && g35.rows.find((r) => r.name === "LeBron James").season === 2 && g35.rows.find((r) => r.name === "Stephen Curry").season === 0,
    "seeded lists (0.82): a list of whole games (40-point games at 35 or older, from the Warriors' notes) is counted forward from the day after it was printed", JSON.stringify([g35, sl]));
  const byB = (o) => ({ gp: 9, upW: 3, upL: 1, downW: 4, downL: 2, run: [], longest: 0, last: "2026-11-05", lateW: 1, lateLost: [], lateWon: [], backRun: [], longestBack: 1, ...o });
  const fb = { by10: { GSW: byB({ backRun: [{ down: 25, opp: "LAL", d: "2026-10-30" }, { down: 11, opp: "LAC", d: "2026-11-01" }, { down: 17, opp: "PHX", d: "2026-11-02" }], longestBack: 3 }), MIA: byB({}) } };
  const bl = T2.flowTeamLines(fb, new Set(["GSW", "MIA"]), "2026-11-05").filter((l) => /^back10/.test(l.key)).map((l) => l.text);
  ok(bl.length === 1 && bl[0] === "GSW has won its last 3 games after trailing by 10+ (25 down to LAL 10/30, 11 down to LAC 11/1, 17 down to PHX 11/2); a fourth straight tonight would be the longest such run in the NBA this season",
    "comeback runs (0.82): any team's games in a row won after trailing by 10+, and what tonight would make of it", JSON.stringify(bl));

  // The Warriors' notes: a team's history line said in the present, with an earlier occurrence named for comparison.
  const N = await import("../src/notes/narrative.js");
  const L = (text) => ({ text, cells: [{ x0: 40, x1: 560, cx: 300, text }], charX: [] });
  const doc = { pages: [{ page: 9, width: 612, lines: [
    L("In four consecutive games (Oct. 30 - Nov. 5) the Warriors won after trailing by 10-or-more points. According to the Elias Sports Bureau, this is just the second time in the play-by-play era (1997-98) the Warriors have had four consecutive comeback wins after trailing by 10-or-more points, the other time coming from Feb. 26 to Mar. 3, 2023."),
    L("This season's Warriors are the first team to start a season 0-3 and then win their next eight games."),
    L("In 2019 the Warriors won 57 games, which was the most in the Western Conference that season and the third time since 2015 they had done so.")] }] };
  const dropped = [];
  const h = N.readHistory(doc, [{ id: "3975", name: "Stephen Curry" }], { seasonStart: "2026-10-01", today: "2026-11-16", teamWords: ["Golden State", "Warriors"], dropped });
  ok(h.some((x) => /^According to the Elias Sports Bureau, this is just the second time in the play-by-play era/.test(x.text) && !x.player) && h.some((x) => /first team to start a season 0-3/.test(x.text)) && !h.some((x) => /In 2019 the Warriors won 57/.test(x.text)),
    "notes (0.82): 'the second time in the play-by-play era' is history, a team's present-tense line is current, and the earlier occurrence it names for comparison doesn't date it; an old season's line still isn't current",
    JSON.stringify([h.map((x) => x.text.slice(0, 80)), dropped.map((d) => [d.reason, d.text.slice(0, 60)])]));
}

// ---------- 0.86: another player's last name; streaks and starts measured against the whole history ----------
{
  const N = await import("../src/notes/narrative.js");
  const L = (text) => ({ text, cells: [{ x0: 40, x1: 560, cx: 300, text }], charX: [] });
  const doc = { pages: [{ page: 1, width: 612, lines: ["Sion James is 37 steals away from 100 career steals.", "Grant Williams is 2 points away from 3,000 career points.", "Herb Jones is 12 steals away from 500 career steals.",
    "Through Nov. 8, Kessler leads the league in blocks this season.", "Williams is 14 rebounds away from 1,000 career rebounds.", "Bronny James is 9 assists away from 200 career assists."].map(L) }] };
  const players = [{ id: "1", name: "Bronny James" }, { id: "2", name: "Ziaire Williams" }, { id: "3", name: "Herbert Jones" }, { id: "4", name: "Walker Kessler" }];
  const dropped = [];
  const h = N.readHistory(doc, players, { seasonStart: "2026-10-01", today: "2026-11-17", teamWords: ["Los Angeles", "Lakers"], dropped });
  const whoOf = (re) => (h.find((x) => re.test(x.text)) || {}).player;
  ok(!h.some((x) => /Sion James|Grant Williams/.test(x.text)) && dropped.filter((d) => d.reason === "no-who" && /Sion James|Grant Williams/.test(d.text)).length === 2
    && whoOf(/Herb Jones/) === "Herbert Jones" && whoOf(/Kessler leads the league/) === "Walker Kessler" && whoOf(/^Williams is 14/) === "Ziaire Williams" && whoOf(/^Bronny James/) === "Bronny James",
    "notes (0.86; the user, 11/17: \"the wires got crossed because of the last names\"): a line that names another James or Williams is not given to the roster's only James or Williams; a short first name, a bare last name and \"Through Nov. 8, Kessler\" still are",
    JSON.stringify([h.map((x) => [x.player || null, x.text.slice(0, 40)]), dropped.map((d) => d.reason)]));
}

// 0.86: each team's games before 2016-17, as far back as its seasons add up to the franchise's record.
{
  const { deepSeqs } = await import("../src/situations/deepseq.js");
  const { streakWatch: SW } = await import("../src/situations/streakwatch.js");
  // AAA: ESPN right in 2014-15 and 2015-16, a game short in 2013-14 (so it starts at 2014-15). BBB: the guide has
  // 2013-14 too, one score printed the wrong way round, and BBB's first season is 2013-14 (its history is whole).
  const season = (y, n, wins, t, o) => Array.from({ length: n }, (_, i) => { const d = `${y}-11-${String(i + 1).padStart(2, "0")}`; return i < wins ? [d, t, o, 100, 90] : [d, t, o, 90, 100]; });
  const older = { games: [...season(2013, 3, 2, "AAA", "CCC"), ...season(2014, 4, 3, "AAA", "CCC"), ...season(2015, 4, 1, "AAA", "CCC"), ...season(2014, 4, 0, "BBB", "DDD").map((g) => [g[0].replace("-11-", "-12-"), ...g.slice(1)]), ...season(2015, 4, 4, "BBB", "DDD").map((g) => [g[0].replace("-11-", "-12-"), ...g.slice(1)])] };
  const guide = { teams: { BBB: [["2013-12-01", "Dee", "DDD", "H", 1, 90, 100], ["2013-12-02", "Dee", "DDD", "H", 1, 100, 90], ["2013-12-03", "Dee", "DDD", "A", 0, 80, 99], ["2013-12-04", "Old Town", null, "A", 1, 100, 99]] } };
  const official = { AAA: [["2012-13", 2, 2], ["2013-14", 2, 2], ["2014-15", 3, 1], ["2015-16", 1, 3], ["2016-17", 2, 2]], BBB: [["2013-14", 3, 1], ["2014-15", 0, 4], ["2015-16", 4, 0], ["2016-17", 2, 2]] };
  const DS = deepSeqs({ older, guide, official });
  ok(DS.from.AAA === "2014-15" && !DS.whole.AAA && DS.seq.AAA.length === 8 && DS.from.BBB === "2013-14" && DS.whole.BBB && DS.seq.BBB.length === 12 && DS.seq.BBB[0].pf === 100 && DS.seq.BBB[0].pa === 90 && DS.league === "2014-15"
    && deepSeqs({}).league === "2016-17",
    "deep history (0.86): a team's games start at the earliest season from which every season adds up to the franchise's record, from ESPN or a guide's lists; a score printed against the guide's own result is turned round; the league's shared window is the latest such start",
    JSON.stringify([DS.from, DS.whole, DS.league, DS.seq.BBB?.slice(0, 2)]));
  // With it, a streak or a start is measured against all of the team's games and says how far that is.
  const hist = { games: [...season(2016, 4, 2, "AAA", "CCC"), ...season(2016, 4, 2, "BBB", "DDD")].map((g) => [...g, 2]) };
  const now = [0, 1, 2, 3, 4].flatMap((i) => [{ d: `2026-11-0${i + 1}`, h: "AAA", a: "CCC", hs: 100, as: 90 }, { d: `2026-11-0${i + 1}`, h: "BBB", a: "DDD", hs: 100, as: 90 }]);
  const S0 = SW({ history: hist, rows: now, today: "2026-11-17" }), S1 = SW({ history: hist, rows: now, today: "2026-11-17", deep: DS });
  const t0 = (S, re) => (S.find((l) => re.test(l.text)) || {}).text;
  ok(t0(S0, /^AAA has won 5 straight/) === "AAA has won 5 straight: a win tonight would be its first 6-game winning streak since at least 2016-17"
    && t0(S1, /^AAA has won 5 straight/) === "AAA has won 5 straight: a win tonight would be its first 6-game winning streak since at least 2014-15"
    && t0(S0, /^BBB has won 5 straight/) && !t0(S1, /^BBB has won 5 straight/)     // its six straight across 2015-16 and 2016-17 are now seen, and are too recent for a line
    && /since 2014-15/.test(t0(S1, /^AAA has held opponents under 95/) || ""),
    "streak watch (0.86; the user, 11/17: \"these can be more accurate now\"): with the deeper games a streak is measured against the team's own window (\"since at least 2014-15\") and finds the earlier one where there is one (a run that began in the older games); counts across the league use the shared window; without them nothing changes",
    JSON.stringify([S0.map((l) => l.text), S1.map((l) => l.text)]));
  // 0.87: a season built opponent by opponent. EEE's own guide lists 3 of its 4 games in 2012-13 (it left out one
  // against FFF, which FFF's guide has) and files a fourth against GGG that GGG's guide does not have and the record
  // has no room for. HHH prints no games at all: its 2012-13 is its opponents' lists (FFF's and GGG's).
  {
    const off = { EEE: [["2012-13", 2, 2]], FFF: [["2012-13", 3, 1]], GGG: [["2012-13", 1, 1]], HHH: [["2012-13", 1, 2]], III: [["2012-13", 2, 1]] };
    const g2 = { teams: {
      EEE: [["2012-11-01", "Eff", "FFF", "H", 1, 100, 90], ["2012-11-05", "Gee", "GGG", "H", 1, 100, 90], ["2012-11-09", "Gee", "GGG", "A", 0, 90, 100], ["2012-11-12", "Gee", "GGG", "A", 1, 99, 98]],
      FFF: [["2012-11-01", "Eee", "EEE", "A", 0, 90, 100], ["2012-11-03", "Eee", "EEE", "H", 1, 100, 90], ["2012-11-20", "Aitch", "HHH", "H", 1, 100, 90], ["2012-11-22", "Aitch", "HHH", "A", 1, 100, 90]],
      GGG: [["2012-11-05", "Eee", "EEE", "A", 0, 90, 100], ["2012-11-09", "Eee", "EEE", "H", 1, 100, 90], ["2012-11-25", "Aitch", "HHH", "H", 0, 90, 100]],
      III: [["2012-11-02", "Jay", null, "H", 1, 100, 90], ["2012-11-04", "Jay", null, "H", 1, 100, 90]] } };   // III: a game short and nobody else lists it
    const DM = deepSeqs({ older: { games: [] }, guide: g2, official: off });
    ok(DM.from.EEE === "2012-13" && DM.seq.EEE.length === 4 && DM.seq.EEE.filter((g) => g.pf > g.pa).length === 2 && !DM.seq.EEE.some((g) => g.d === "2012-11-12") && DM.seq.EEE.some((g) => g.d === "2012-11-03" && g.opp === "FFF" && g.pf === 90)
      && DM.mended.EEE.join() === "2012-13" && DM.from.FFF === "2012-13" && !DM.mended.FFF && DM.from.HHH === "2012-13" && DM.seq.HHH.map((g) => `${g.d.slice(5)}${g.pf > g.pa ? "W" : "L"}${g.opp}`).join(" ") === "11-20LFFF 11-22LFFF 11-25WGGG"
      && DM.mended.HHH.join() === "2012-13" && DM.from.III === "2016-17" && !DM.seq.III,
      "deep history (0.87): a season that does not add up from one source is built opponent by opponent, from whichever list has that opponent's games (a game the team's own guide left out comes from the opponent's guide; one it filed against the wrong team goes); a team whose guide prints no games is built from its opponents' lists; a season that still does not come to the franchise's record is not used",
      JSON.stringify([DM.from, DM.mended, DM.seq.EEE, DM.seq.HHH]));
  }
  // The real files: how far each team goes.
  const zl = await import("node:zlib");
  const gzr = (f) => JSON.parse(zl.gunzipSync(fs.readFileSync(path.join(root, "src", "data", f))));
  const OLD = gzr("nba-results-older.json.gz");
  const DR = deepSeqs({ older: OLD, guide: gzr("guide-games-2026-27.json.gz"), official: JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-team-seasons-2026-27.json"), "utf8")).teams });
  const wholeR = Object.keys(DR.whole).filter((t) => DR.whole[t]).sort().join(" ");
  ok(OLD.games.length === 26947 && OLD.complete["1999-00"] === false && Object.values(OLD.complete).filter(Boolean).length === 22 && DR.league === "1993-94" && DR.from.LAL === "1948-49" && DR.whole.LAL && DR.from.GSW === "1962-63" && DR.from.MIL === "1968-69" && DR.whole.MIL
    && DR.from.SAC === "1948-49" && DR.from.PHI === "1949-50" && DR.from.WAS === "1961-62" && DR.from.UTA === "1974-75" && DR.from.DEN === "1976-77" && DR.from.IND === "1976-77" && DR.from.BKN === "1976-77" && DR.from.DAL === "1980-81"
    && DR.from.CHI === "1979-80" && DR.from.BOS === "1988-89" && DR.from.ATL === "1968-69" && DR.from.PHX === "1968-69" && DR.from.POR === "1970-71" && DR.from.CLE === "1970-71" && DR.from.LAC === "1970-71" && DR.from.SAS === "1993-94" && DR.from.NYK === "1993-94" && DR.from.DET === "1993-94"
    && wholeR === "BKN CHA CLE DAL DEN IND LAC LAL MEM MIA MIL MIN NOP PHI PHX POR SAC TOR UTA WAS" && !DR.whole.BOS && DR.seq.LAL[0].d === "1948-11-04" && DR.seq.SAC[0].d.startsWith("1948-11") && DR.mended.WAS.length === 2 && DR.seq.NYK.filter((g) => g.d >= "1999-10-01" && g.d < "2000-05-01").length === 82,
    "deep history, the real files (0.87, 0.92, 0.93): every team from 1993-94 (the games ESPN lacks in 1999-00 are in the guides); twenty franchises whole (0.92 adds Cleveland from its picture pages, and Charlotte, Miami, Phoenix, Portland and the Clippers once the rows the user's screenshots showed were read; 0.93 adds Milwaukee with the 1969-70 season its guide does not print, from the Basketball Reference schedule the user sent), among them Sacramento from 1948-49, Philadelphia from 1949-50 and Washington from 1961-62; Atlanta from 1968-69, Chicago 1979-80, Boston 1988-89",
    JSON.stringify([OLD.games.length, DR.league, DR.from]));
}

// ---------- 0.84: the finder for teams ----------
{
  const { teamFindings, teamLines, TEAM } = await import("../src/anticipate/teamfinder.js");
  const { finderLines } = await import("../src/anticipate/finder.js");
  const T30 = ["ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"];
  // Fifteen pairings, six games each: ordinary scores a point or two apart, then four planted oddities.
  // ATL beats MIA 130-100 every night behind a 40-25 first quarter; BOS make 20 threes a game (ORL did it twice,
  // nobody else has); BKN never reach 30 assists (everyone else always does); CHA score 70 (so NOP win by 31).
  const line = (side, starter, pts, o = {}) => [side, starter, 30, pts, o.fgm ?? 40, o.fga ?? 88, o.fg3m ?? 10, 30, 15, 20, 44, o.ast ?? 30, 13, 7, 5, 10, 34, 20, 0];
  const rowsT = [];
  for (let i = 0; i < 15; i++) for (let k = 0; k < 6; k++) {
    const h = T30[i], a = T30[i + 15];
    let hs = 100 + i, as = 98 + i, hq = [25, 25, 25, 25 + i], aq = [25, 25, 24, 24 + i];
    if (h === "ATL") { hs = 130; as = 100; hq = [40, 30, 30, 30]; aq = [25, 25, 25, 25]; }
    if (h === "CHA") { hs = 70; hq = [18, 18, 17, 17]; }
    const box = (t, side, pts) => ({ [`${t}s`]: line(side, 1, pts - 20, { fg3m: t === "BOS" || (t === "ORL" && k < 2) ? 20 : 10, ast: t === "BKN" ? 20 : 30 }), [`${t}b`]: line(side, 0, 20, { fgm: 0, fga: 0, fg3m: 0, ast: 0 }) });
    rowsT.push({ id: `${h}${k}`, d: `2026-11-${String(k + 1).padStart(2, "0")}`, h, a, hs, as, hq, aq, pl: { ...box(h, 0, hs), ...box(a, 1, as) } });
  }
  const TL = teamLines(rowsT);
  const TF = teamFindings({ rows: rowsT }), tf = (re) => TF.filter((f) => re.test(f.key));
  const partA = tf(/^find\|tpart\|ATL\|/), partO = tf(/^find\|tpart\|MIA\|/), cntB = tf(/^find\|tcount\|BOS\|t/), onlyB = tf(/^find\|tonly\|BKN\|/), gapC = tf(/^find\|tgap\|CHA\|/);
  ok(TL.ATL.length === 6 && TL.ATL[0].pts === 130 && TL.ATL[0].opts === 100 && TL.ATL[0].bench === 20 && TL.MIA[0].q[0] === 25 && TL.MIA[0].oq[0] === 40 && TL.BOS[0].box.fg3m === 20 && TL.BOS[0].obox.fg3m === 10,
    "team finder (0.84): one line per team per game with its points, quarters, box totals and bench points, and the opponent's beside them");
  ok(partA.length === 1 && partA[0].text === "ATL outscore opponents by 15.0 points in 1st quarters alone: only 1 other team has a better margin over a whole game (ATL's own: +30.0)"
    && partO.length === 1 && /^MIA are outscored by 15\.0 points in 1st quarters alone: only 1 other team has a worse margin/.test(partO[0].text),
    "team finder: one quarter of a team's games measured against everyone's whole games, at both ends (the user, 11/16: \"also implement it for team stats\")", JSON.stringify([partA, partO].map((x) => x.map((f) => f.text))));
  ok(cntB.length === 1 && cntB[0].text === "BOS have 6 games with 20+ threes this season: no other team has more than 2, and it is more than every other team combined (28 teams have none)" && cntB[0].rare
    && !tf(/^find\|tcount\|ORL\|/).length,
    "team finder: a kind of game one team has piled up, only when it is alone in front (1.5 times the next team and two more); 20+ and 15+ threes are one family, said once", JSON.stringify(cntB.map((f) => f.text)));
  ok(onlyB.length === 1 && onlyB[0].text === "BKN are the only team that hasn't had 30 assists in a game this season (the other 29 have 174 such games between them)",
    "team finder: the one team without something every other team has", JSON.stringify(onlyB.map((f) => f.text)));
  ok(gapC.length === 1 && /^CHA .*: a wider gap than the one across the next nine teams \(/.test(gapC[0].text) && /than the next team \(/.test(gapC[0].text),
    "team finder: last (or first) in a stat by more than the next nine teams are spread; one gap line a team, the widest", JSON.stringify(gapC.map((f) => f.text)));
  ok(TF.every((f) => f.kind === "find" && f.player === null && /^find\|t(?:gap|part|count|only)\|[A-Z]{3}\|/.test(f.key) && f.score >= 2.9 && f.score <= 4) && TEAM.games === 5 && TEAM.count.least === 4 && TEAM.only.others === 28
    && teamFindings({ rows: rowsT.filter((g) => g.d <= "2026-11-04") }).length === 0,
    "team finder: findings have the player finder's shape (votes and the briefing treat them alike); nothing before a team has five games");
  const FL = finderLines({ pg: {}, rows: rowsT }, new Set(["ATL", "WAS"]), { top: 50 });
  ok(FL.teamFinds === TF.length && FL.lines.length && FL.lines.every((f) => f.team === "ATL" || f.team === "WAS") && new Set(FL.league.map((f) => f.team)).size === FL.league.length && FL.league.some((f) => f.team === "CHA"),
    "finder (0.84): team findings join the players' in one list, one line a team; tonight's teams' findings are candidates", JSON.stringify(FL.league.map((f) => f.key)));
  const { features } = await import("../src/anticipate/learn.js");
  ok(features(cntB[0]).includes("find:tcount") && features(cntB[0]).includes("who:team") && features(cntB[0]).some((x) => /^find:tcount:t\d+$/.test(x)),
    "learn (0.84): a vote on a team finding counts for its test and its cut", JSON.stringify(features(cntB[0])));
}

// ---------- 0.84: all-time series from the team media guides ----------
{
  const { seriesPair, seriesNow, seriesItems, seriesTable, TRUST } = await import("../src/records/series.js");
  const SR = { through: "2025-26", guides: { BOS: { agree: [9, 10] }, LAL: { agree: [9, 10] }, DEN: { agree: [0, 10] } }, teams: {
    BOS: { LAL: { overall: { w: 99, l: 100, streak: 2, lastW: "2026-02-22", lastL: "2025-01-23" }, home: { w: 60, l: 40, streak: 1, lastW: "2025-12-05", lastL: "2024-02-01" }, road: { w: 39, l: 60, streak: 1 } },
      DEN: { overall: { w: 62, l: 42, streak: -2 }, home: { w: 41, l: 11 }, road: { w: 21, l: 31 } } },
    LAL: { BOS: { overall: { w: 100, l: 99 }, home: { w: 60, l: 39 }, road: { w: 40, l: 60 } } },
    DEN: { BOS: { overall: { w: 40, l: 62 }, home: { w: 30, l: 21 }, road: { w: 10, l: 41 } }, UTA: { overall: { w: 50, l: 50 }, home: { w: 30, l: 20 }, road: { w: 20, l: 30 } } } } };
  const P1 = seriesPair(SR, "LAL", "BOS"), P2 = seriesPair(SR, "DEN", "BOS"), P3 = seriesPair(SR, "UTA", "DEN");
  ok(P1.status === "confirmed" && P1.rec.overall.w === 100 && P1.rec.home.w === 60 && P2.status === "differs" && P2.source[0] === "BOS" && P2.rec.overall.w === 42 && P2.rec.overall.l === 62 && P2.rec.home.w === 31 && P2.other.team === "DEN" && P2.other.overall.w === 40 && !P2.weak
    && P3.status === "single" && P3.weak && P3.rec.overall.w === 50 && P3.rec.home.w === 30 && P3.rec.home.l === 20 && !seriesPair(SR, "NYK", "MIA") && TRUST === 0.75,
    "series (0.84): a pairing both guides print is confirmed when they mirror; when they differ the guide other guides back up more is used and the other kept; one guide alone is marked weak if the others rarely match it",
    JSON.stringify([P1, P2, P3]));
  const season = [{ d: "2026-11-01", home: "BOS", away: "LAL", hs: 110, as: 100 }, { d: "2026-11-20", home: "LAL", away: "BOS", hs: 120, as: 100 }];
  const N1 = seriesNow(SR, season, "BOS", "LAL", "2026-11-17");
  ok(N1.added === 1 && N1.rec.overall.w === 100 && N1.rec.overall.l === 100 && N1.rec.overall.streak === 3 && N1.rec.overall.lastW === "2026-11-01" && N1.rec.home.w === 61 && N1.rec.home.streak === 2 && N1.rec.road.w === 39,
    "series: this season's meetings before today are added to the guide's record, streak and last-win date (a later game is not)", JSON.stringify(N1.rec));
  const I0 = seriesItems(SR, [], "LAL", "BOS", "2026-11-17"), I1 = seriesItems(SR, season, "LAL", "BOS", "2026-11-17"), I2 = seriesItems(SR, [], "BOS", "DEN", "2026-11-17"), I3 = seriesItems(SR, [], "DEN", "UTA", "2026-11-17");
  ok(I0[0].text === "All-time: the Lakers lead the Celtics 100-99 in the regular season; the Celtics are 60-40 at home in it (through 11/16/26; both teams' media guides agree)" && I0[0].score === 2
    && I0.some((i) => i.text === "A win tonight would be the Celtics' 100th in the regular season against the Lakers (both teams' media guides agree)" && i.score === 2.3)
    && I0.some((i) => i.text === "A win tonight would tie the all-time series for the Celtics (99-100 against the Lakers)")
    && I1[0].text.startsWith("All-time: the Celtics and Lakers are tied 100-100") && I1.some((i) => i.text === "The winner tonight takes the lead in the all-time series (tied 100-100)") && I1.every((i) => i.kind === "matchup"),
    "series: tonight's matchup gets the all-time record with its basis, a win that would be a 100th, and a series that tonight would tie or tip", JSON.stringify([...I0, ...I1].map((i) => i.text)));
  ok(I2.length === 1 && I2[0].text === "All-time: the Celtics lead the Nuggets 62-42 in the regular season; the Nuggets are 31-21 at home in it (through 11/16/26; the Celtics' media guide; the Nuggets' has it 62-40)" && I2[0].score === 1
    && I3.length === 1 && I3[0].score === 1 && I3[0].weak && /tied 50-50/.test(I3[0].text) && !seriesItems(SR, [], "NYK", "MIA", "2026-11-17").length,
    "series: where the two guides differ both numbers are said and nothing is built on it; a weak single-guide record is listed but never promoted; no guide, no line", JSON.stringify([...I2, ...I3].map((i) => [i.score, i.text])));
  const N2 = seriesNow(SR, [{ d: "2026-11-02", home: "DEN", away: "BOS", hs: 120, as: 110 }], "BOS", "DEN", "2026-11-17");
  ok(N2.rec.overall.l === 43 && N2.other.overall.l === 41 && N2.other.overall.w === 62 && SR.teams.DEN.BOS.overall.w === 40, "series: the guide that differs is counted forward with the one that is used (and the file's own numbers are left alone)", JSON.stringify(N2));
  const TB = seriesTable(SR, season, "2026-11-17");
  ok(TB.length === 3 && TB[0].a === "BOS" && TB[0].b === "DEN" && TB.find((r) => r.b === "LAL").overall.w === 100 && TB.find((r) => r.a === "DEN" && r.b === "UTA").weak, "series: the lookup table has one row a pairing, counted forward", JSON.stringify(TB.map((r) => [r.a, r.b, r.status])));
  // 0.84.1: a misprint loses to a record that adds up; a guide that starts at its current city's first season does not
  // contradict a full count, and alone it is "since", not all-time; a row we corrected is shown but nothing is built on it.
  const SX = { through: "2025-26", guides: { HOU: { agree: [9, 10] }, SAC: { agree: [9, 10] }, OKC: { agree: [0, 10], era: "2008-09" }, BOS: { agree: [9, 10] }, DEN: { agree: [9, 10] }, UTA: { agree: [9, 10] } }, teams: {
    HOU: { SAC: { overall: { w: 143, l: 103 }, home: { w: 80, l: 43 }, road: { w: 63, l: 60 } } }, SAC: { HOU: { overall: { w: 103, l: 43 }, home: { w: 65, l: 55 }, road: { w: 36, l: 87 }, bad: true } },
    OKC: { BOS: { overall: { w: 19, l: 17 }, home: { w: 10, l: 8 }, road: { w: 9, l: 9 } }, ATL: { overall: { w: 21, l: 13 }, home: { w: 12, l: 5 }, road: { w: 9, l: 8 } } },
    BOS: { OKC: { overall: { w: 80, l: 69 }, home: { w: 41, l: 29 }, road: { w: 39, l: 40 } } },
    DEN: { NYK: { overall: { w: 50, l: 50 }, home: { w: 30, l: 20 }, road: { w: 20, l: 30 }, adjusted: "2025-26 added: this guide's rows stop a season early" } } } };
  const X1 = seriesPair(SX, "SAC", "HOU"), X2 = seriesPair(SX, "BOS", "OKC"), X3 = seriesItems(SX, [], "OKC", "ATL", "2026-11-17"), X4 = seriesItems(SX, [], "NYK", "DEN", "2026-11-17"), X5 = seriesItems(SX, [], "HOU", "SAC", "2026-11-17");
  ok(X1.status === "differs" && X1.source[0] === "HOU" && X1.rec.overall.w === 103 && X1.rec.overall.l === 143 && X1.other.bad && !X1.weak
    && X2.status === "single" && X2.source[0] === "BOS" && X2.rec.overall.w === 80 && !X2.other && !X2.era
    && X3.length === 1 && X3[0].text === "Since 2008-09 (as far back as the Thunder's guide counts): the Thunder lead the Hawks 21-13 in the regular season; the Hawks are 8-9 at home in it (through 11/16/26; the Thunder's media guide)" && X3[0].score === 1
    && X4.length === 1 && X4[0].score === 1 && /tied 50-50 in the regular season.*the Nuggets' media guide, plus last season from our results\)$/.test(X4[0].text)
    && /the Rockets' media guide; the Kings' has it 43-103, which does not add up\)$/.test(X5[0].text),
    "series (0.84.1): a misprinted record loses to one that adds up; a guide counting only its current city's years is 'since', not all-time, and does not contradict a full count; a row corrected with last season's results is shown but never built on",
    JSON.stringify([X1, X2, X3, X4, X5]));
  // 0.85: a count that starts late is whole against a franchise that did not exist before it started, and cut short
  // only against an older one; of two counts that each leave something out, the bigger is used.
  const SY = { through: "2025-26", first: { GSW: 1946, CHI: 1966, LAL: 1948, MIL: 1968, WAS: 1961 }, guides: { GSW: { agree: [19, 20], era: "1962-63" }, CHI: { agree: [9, 10] }, LAL: { agree: [9, 10] }, MIL: { agree: [5, 10], short: "x" }, WAS: { agree: [5, 10], short: "y" } }, teams: {
    GSW: { CHI: { overall: { w: 83, l: 87 } }, LAL: { overall: { w: 127, l: 209 } }, WAS: { overall: { w: 112, l: 86 } } }, CHI: { GSW: { overall: { w: 87, l: 83 } } }, LAL: { GSW: { overall: { w: 268, l: 178 } }, MIL: { overall: { w: 87, l: 63 } } },
    WAS: { GSW: { overall: { w: 86, l: 121 } }, MIL: { overall: { w: 99, l: 136 } } }, MIL: { LAL: { overall: { w: 60, l: 84 } }, WAS: { overall: { w: 133, l: 96 } } } } };
  const Y1 = seriesPair(SY, "GSW", "CHI"), Y2 = seriesPair(SY, "GSW", "LAL"), Y3 = seriesPair(SY, "GSW", "WAS"), Y4 = seriesPair(SY, "MIL", "LAL"), Y5 = seriesPair(SY, "MIL", "WAS");
  ok(Y1.status === "confirmed" && Y2.status === "single" && Y2.source[0] === "LAL" && Y2.rec.overall.w === 178 && !Y2.era && Y3.status === "single" && Y3.source[0] === "WAS" && Y3.rec.overall.w === 121
    && Y4.status === "single" && Y4.source[0] === "LAL" && Y4.rec.overall.w === 63 && Y5.status === "differs" && Y5.source[0] === "WAS" && Y5.rec.overall.w === 136 && Y5.other.team === "MIL",
    "series (0.85): Golden State's lists (from 1962-63) are a whole count against Chicago (1966) but not against the Lakers or Washington (1961), where the fuller count stands; a list missing a season yields to a full one; of two short counts the bigger is used",
    JSON.stringify([Y1.status, Y2, Y3, Y4, Y5]));
  // The file read from the guides (tools/parse-series-history.py): the checks that were run on it, kept as facts.
  const RS = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-series-history-2026-27.json"), "utf8"));
  const pairsR = seriesTable(RS, [], "2026-10-01"), cnt = (st) => pairsR.filter((r) => r.status === st).length;
  const adjR = Object.values(RS.teams).flatMap((t) => Object.values(t)).filter((r) => r.adjusted);
  ok(Object.keys(RS.teams).length === 30 && pairsR.length === 435 && cnt("confirmed") === 345 && cnt("differs") === 37 && RS.teams.BOS.LAL.overall.w === 169 && RS.teams.BOS.LAL.overall.l === 135 && RS.teams.BOS.LAL.home.w === 85
    && RS.teams.LAL.BOS.overall.w === 135 && RS.teams.LAL.BOS.overall.l === 169 && RS.teams.DEN.BOS.overall.w === 42 && RS.teams.DEN.BOS.adjusted && RS.guides.OKC.era === "2008-09" && RS.guides.DET.era === "1957-58" && RS.guides.GSW.era === "1962-63" && !RS.guides.MIL.short && RS.guides.MIL.lists
    && RS.guides.GSW.agree.join("/") === "20/20" && RS.teams.ATL.BOS.overall.l === 251 && RS.teams.NYK.ATL.overall.w === 195 && RS.teams.NYK.ATL.adjusted && RS.teams.SAC.HOU.bad && RS.first.OKC === 1967
    && adjR.length === 73 && adjR.filter((r) => /twice/.test(r.adjusted)).length === 5 && !RS.teams.SAS.ATL.overall.streak && pairsR.every((r) => r.overall && r.overall.w + r.overall.l > 0),
    "series data (0.85, 0.93, 0.94): all 30 guides and all 435 pairings, 345 confirmed from both sides (330 before the Bucks' 1969-70 season was added to their lists in 0.93; 340 before the Wizards' postponed-game rows and a misprinted record were read right in 0.94); the Lakers' count from their game lists mirrors Boston's printed 169-135; Denver's and the Knicks' rows stopped at 2024-25 and are brought up with our results; the Kings' misprint is marked",
    JSON.stringify([Object.keys(RS.teams).length, pairsR.length, cnt("confirmed"), cnt("differs"), adjR.length, adjR.filter((r) => /twice/.test(r.adjusted)).length, RS.guides.GSW]));
  // 0.87: a count of the games as a third opinion.
  {
    const { countedPairs } = await import("../src/records/series.js");
    const ser = { through: "2025-26", first: { AAA: 1990, BBB: 1990, CCC: 1990, DDD: 1990, LLL: 1990 }, guides: { AAA: { agree: [9, 10] }, BBB: { agree: [8, 10] }, CCC: { agree: [9, 10] }, DDD: { agree: [9, 10] }, LLL: { agree: [9, 10], lists: true } },
      teams: { AAA: { BBB: { overall: { w: 12, l: 8 } }, CCC: { overall: { w: 5, l: 5 } }, LLL: { overall: { w: 3, l: 3 } } }, BBB: { AAA: { overall: { w: 9, l: 12 }, home: { w: 6, l: 5 }, road: { w: 3, l: 7 } } }, DDD: { AAA: { overall: { w: 7, l: 2 } } }, LLL: { AAA: { overall: { w: 4, l: 3 } } } } };
    const P0 = seriesPair(ser, "AAA", "BBB");
    const withC = (c) => ({ ...ser, counted: c });
    const mineP = seriesPair(withC({ AAA: { BBB: [{ w: 12, l: 8, by: "BBB" }] } }), "AAA", "BBB"), theirP = seriesPair(withC({ AAA: { BBB: [{ w: 12, l: 9, by: "AAA" }] } }), "AAA", "BBB");
    const ownP = seriesPair(withC({ AAA: { BBB: [{ w: 12, l: 8, by: "AAA" }] } }), "AAA", "BBB");
    const noneP = seriesPair(withC({ AAA: { BBB: [{ w: 13, l: 9, by: "AAA" }] } }), "AAA", "BBB"), bothP = seriesPair(withC({ AAA: { BBB: [{ w: 12, l: 8, by: "BBB" }, { w: 12, l: 9, by: "AAA" }] } }), "AAA", "BBB");
    const oneP = seriesPair(withC({ AAA: { DDD: [{ w: 2, l: 7, by: "AAA" }] } }), "AAA", "DDD"), selfL = seriesPair(withC({ AAA: { LLL: [{ w: 3, l: 4, by: "LLL" }] } }), "AAA", "LLL"), otherL = seriesPair(withC({ AAA: { LLL: [{ w: 3, l: 4, by: "AAA" }] } }), "AAA", "LLL");
    ok(P0.status === "differs" && mineP.status === "confirmed" && mineP.counted && mineP.source.join() === "AAA,games" && mineP.rec.overall.w === 12 && mineP.rec.overall.l === 8 && !mineP.other
      && theirP.status === "confirmed" && theirP.source.join() === "BBB,games" && theirP.rec.overall.w === 12 && theirP.rec.overall.l === 9 && theirP.rec.home.w === 7 && theirP.rec.road.l === 6
      && ownP.status === "differs" && noneP.status === "differs" && bothP.status === "differs" && oneP.status === "confirmed" && oneP.source.join() === "DDD,games" && oneP.rec.overall.w === 2
      && selfL.status === "differs" && otherL.status === "confirmed" && otherL.source.join() === "LLL,games" && otherL.rec.overall.l === 4,
      "series (0.87, 0.94): a count of the games settles a pairing only by landing exactly on a printed record: on the one shown (confirmed, that guide and the games), on the other guide's (that one is shown instead, with its home and road splits), on neither or on one each (unchanged); a single guide's record is confirmed the same way; 0.94: a guide's own game list never confirms its own table (the Hawks' table and list shared a misprint against Milwaukee), only the other team's games do",
      JSON.stringify([mineP, theirP, noneP.status, bothP.status, oneP, selfL.status, otherL]));
    // countedPairs: XXX's games reach its first season, YYY's do not; a Cup final and a later season are left out.
    const deepT = { seq: { XXX: [{ d: "2010-11-01", pf: 100, pa: 90, opp: "YYY" }, { d: "2011-11-01", pf: 90, pa: 100, opp: "YYY" }, { d: "2011-11-03", pf: 100, pa: 90, opp: "GONE" }], YYY: [{ d: "2015-11-01", pf: 100, pa: 90, opp: "XXX" }] }, from: { XXX: "2010-11", YYY: "2015-16" } };
    const histT = { columns: ["date", "home", "away", "homeScore", "awayScore", "type"], games: [["2020-01-05", "XXX", "YYY", 110, 100, 2], ["2021-02-05", "YYY", "XXX", 110, 100, 2], ["2023-12-09", "XXX", "YYY", 110, 100, 2], ["2022-04-20", "XXX", "YYY", 110, 100, 3], ["2026-11-01", "XXX", "YYY", 110, 100, 2]] };
    const CP = countedPairs({ deep: deepT, history: histT, official: { XXX: [["2010-11", 1, 0]], YYY: [["2005-06", 1, 0]] }, through: "2025-26" });
    ok(JSON.stringify(CP.XXX.YYY) === JSON.stringify([{ w: 2, l: 2, by: "XXX" }]) && JSON.stringify(CP.YYY.XXX) === JSON.stringify([{ w: 2, l: 2, by: "XXX" }]) && Object.keys(countedPairs({})).length === 0,
      "series (0.87): a pairing is counted from a team's games only if they reach the first season the two could have met (XXX's do, YYY's start too late), with our results since 2016-17 added: regular season only, no Cup final, nothing past the guides' last season",
      JSON.stringify(CP));
    // The real files.
    const zl = await import("node:zlib"); const { deepSeqs } = await import("../src/situations/deepseq.js");
    const gzr = (f) => JSON.parse(zl.gunzipSync(fs.readFileSync(path.join(root, "src", "data", f))));
    const offR = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-team-seasons-2026-27.json"), "utf8")).teams;
    const RS2 = { ...RS, counted: countedPairs({ deep: deepSeqs({ older: gzr("nba-results-older.json.gz"), guide: gzr("guide-games-2026-27.json.gz"), official: offR }), history: JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-results-history.json"), "utf8")), official: offR, through: RS.through }) };
    const T2 = seriesTable(RS2, [], "2026-10-01"), c2 = (st) => T2.filter((r) => r.status === st).length, uw = T2.find((r) => r.a === "UTA" && r.b === "WAS"), al = T2.find((r) => r.a === "ATL" && r.b === "LAL");
    const changed = T2.filter((r, i) => r.overall.w !== pairsR[i].overall.w || r.overall.l !== pairsR[i].overall.l).map((r) => r.a + r.b).join();
    const itC = seriesItems(RS2, [], "UTA", "WAS", "2026-11-17")[0];
    const mu = T2.find((r) => r.a === "MEM" && r.b === "UTA"), mw = T2.find((r) => r.a === "MIL" && r.b === "WAS"), am = T2.find((r) => r.a === "ATL" && r.b === "MIL");
    const SV = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "series-verified.json"), "utf8")), T2v = seriesTable({ ...RS2, verified: SV.pairs, outside: SV.notes }, [], "2026-10-01"), cv = (st) => T2v.filter((r) => r.status === st).length, fv = (a, b) => T2v.find((r) => r.a === a && r.b === b);
    ok(c2("confirmed") === 383 && c2("differs") === 11 && c2("single") === 41 && T2.filter((r) => r.counted).length === 38 && changed === "MEMUTA" && am.status === "confirmed" && am.source.join() === "MIL,games" && am.overall.w === 122 && am.overall.l === 122
      && cv("confirmed") === 435 && cv("differs") === 0 && cv("single") === 0 && T2v.filter((r) => r.checked).length === 53 && fv("ATL", "GSW").overall.w === 151 && fv("ATL", "GSW").overall.l === 153 && fv("ATL", "GSW").source.join() === "ATL,check" && fv("ATL", "GSW").outside.w === 152 && fv("BOS", "DET").overall.w === 257 && fv("BOS", "DET").overall.l === 144 && fv("BOS", "DET").source.join() === "check" && !fv("BOS", "DET").outside && fv("ATL", "LAL").overall.w === 145 && fv("ATL", "LAL").overall.l === 199 && fv("ATL", "LAL").source.join() === "LAL,check" && fv("ATL", "DET").overall.w === 222 && fv("ATL", "DET").overall.l === 231 && fv("ATL", "DET").outside.w === 223 && fv("DET", "GSW").overall.w === 150 && fv("DET", "GSW").overall.l === 163 && !fv("DET", "GSW").outside && fv("OKC", "PHI").overall.w === 76 && fv("OKC", "PHI").overall.l === 73 && fv("DEN", "IND").overall.w === 104 && fv("DEN", "IND").source.join() === "DEN,check"
      && fv("GSW", "WAS").source.join() === "WAS,check" && fv("GSW", "WAS").overall.w === 122 && fv("CHA", "OKC").source.join() === "check" && fv("CHA", "OKC").overall.l === 46 && fv("ATL", "DEN").overall.l === 50 && fv("LAL", "SAC").overall.w === 288
      && fv("NYK", "PHI").status === "confirmed" && fv("NYK", "PHI").outside.l === 267 && fv("ATL", "LAL").outside.w === 146 && !fv("BOS", "LAL").outside && mu.overall.w === 44 && mu.overall.l === 69 && mu.source.join() === "games" && mw.status === "confirmed" && mw.source.join() === "MIL,WAS" && mw.overall.w === 136 && mw.overall.l === 99 && uw.overall.w === 64 && uw.overall.l === 54 && uw.source.join() === "WAS,games"
      && al.status === "differs" && RS.guides.LAL.lists && RS.guides.WAS.lists && !RS.guides.UTA.lists && /the Wizards' media guide, and a count of the games agrees/.test(itC.text),
      "series, the real files (0.87 to 0.94): 345 pairings are confirmed by both guides and 37 more by the other team's games (Memphis v Utah, 44-69, by the two counts where neither print is right; Hawks v Bucks is 122-122 once the Hawks' misprinted 3/1/74 is corrected). 0.94: with 24 of Basketball Reference's head-to-head pages read, 428 were confirmed (46 by that check); 0.95: 430 (Celtics v Pistons 257-144 by Stathead and Land of Basketball's game list, where the Celtics' guide prints 258; Hawks v Warriors 151-153 by the Hawks' guide and Land of Basketball's game list, Basketball Reference's 152 carried beside it), 3 differ (Atlanta v Detroit, Atlanta v the Lakers, Detroit v Golden State) and 2 rest on one guide; 0.96: 383 by the guides and the games (Lakers v Kings now counts to the Lakers' 288-169 once the Royals' two swapped results are corrected), all 435 with the outside checks (the 1956 and 1957 tiebreakers explain Basketball Reference's extra Hawks v Lakers and Hawks v Pistons games; Land of Basketball and Basketball Reference agree on Pistons v Warriors 150-163, Thunder v 76ers 76-73; Nuggets v Pacers 104-91 with the ABA years); where the page settles nothing (a tiebreaker counted as a game, a guide that starts late) its figure is carried beside the record; Milwaukee v Washington is 136-99 by both; Utah v Washington is Washington's 54-64; Atlanta v the Lakers stays open because the Lakers' record is their own lists",
      JSON.stringify([c2("confirmed"), c2("differs"), c2("single"), T2.filter((r) => r.counted).length, changed, uw, al.status, itC && itC.text]));
  }
  // 0.88: the older games in the head-to-head lines.
  {
    const { pairHistory, runsOf, margins, pairSummary } = await import("../src/records/pairs.js");
    const { teamItems: TI } = await import("../src/records/matchup.js");
    const { countedPairs } = await import("../src/records/series.js");
    // PPP v QQQ, both from 2000-01. Before 2016-17: QQQ won six straight (2001-03), then PPP four. Since: PPP seven more.
    const old = [];
    for (let i = 0; i < 6; i++) old.push({ d: `200${1 + (i >> 1)}-0${1 + (i % 2)}-10`, pf: 90, pa: 100 + (i === 2 ? 40 : 0), opp: "QQQ", h: i % 2 === 0 });
    for (let i = 0; i < 4; i++) old.push({ d: `201${0 + i}-03-10`, pf: 100, pa: 95, opp: "QQQ", h: i < 3 ? true : null });
    const deepP = { seq: { PPP: old }, from: { PPP: "2000-01" } }, offP = { PPP: [["2000-01", 1, 1]], QQQ: [["2000-01", 1, 1]] };
    const histP = { columns: ["date", "home", "away", "homeScore", "awayScore", "type"], games: Array.from({ length: 7 }, (_, i) => [`20${17 + i}-01-05`, i % 2 ? "QQQ" : "PPP", i % 2 ? "PPP" : "QQQ", i % 2 ? 99 : 111, i % 2 ? 105 : 100, 2]) };
    const serP = { through: "2025-26", guides: { PPP: { agree: [9, 10] }, QQQ: { agree: [9, 10] } }, teams: { PPP: { QQQ: { overall: { w: 11, l: 6 } } }, QQQ: { PPP: { overall: { w: 6, l: 11 } } } } };
    serP.counted = countedPairs({ deep: deepP, history: histP, official: offP, through: "2025-26" });
    const pastP = pairHistory({ deep: deepP, official: offP, series: serP }, "QQQ", "PPP");
    const itsP = TI(histP, null, "QQQ", "PPP", "2026-11-17", pastP), itsOld = TI(histP, null, "QQQ", "PPP", "2026-11-17");
    const tx = (its, re) => (its.find((i) => re.test(i.text)) || {}).text || "";
    const short = pairHistory({ deep: { seq: { PPP: old.slice(6) }, from: { PPP: "2009-10" } }, official: offP, series: serP }, "QQQ", "PPP"), itsS = TI(histP, null, "QQQ", "PPP", "2026-11-17", short);
    ok(pastP.games.length === 10 && pastP.whole && pastP.exact && pastP.by === "PPP" && pastP.from === "2000-01" && pastP.games[0].home === "PPP" && pastP.games[1].home === "QQQ" && pastP.games[9].neutral === true
      && runsOf(pastP.games).map((r) => `${r.w}${r.n}`).join() === "QQQ6,PPP4" && margins(pastP.games).QQQ.m === 50 && margins([{ d: "1990-01-01", home: "A", winner: "A", hs: 190, as: 100 }]).A === undefined
      && tx(itsP, /11 straight/) === "The PPP have won 11 straight against the QQQ, the longest streak by either team in the series (was 6, the QQQ, 2001-03) (last: 111-100 on 1/5/23)."
      && tx(itsOld, /7 straight/).startsWith("The PPP have won 7 straight against the QQQ, every meeting (last")
      && tx(itsP, /straight at home/) === "The PPP have won 7 straight at home against the QQQ; the QQQ last won there on 1/10/03." && /Largest wins in the series: the PPP by 11 \(111-100 on 1\/5\/17\); the QQQ by 50 \(140-90 on 1\/10\/02\)/.test(tx(itsP, /Largest wins/))
      && !short.whole && !short.exact && short.from === "2009-10" && /have won 11 straight against the QQQ, every meeting since 2009-10 \(last/.test(tx(itsS, /11 straight/)) && !tx(itsS, /Largest wins/)
      && pairHistory({ deep: { seq: {}, from: {} }, official: offP }, "QQQ", "PPP") === null && pairSummary(pastP.games, "PPP", "QQQ").streak.QQQ.n === 6,
      "head-to-head (0.88; the user, 11/16: \"easier to check past records and streaks against opponents\"): a pairing's games before 2016-17 join the lines, so a streak is placed in the series (\"the longest streak by either team in the series (was 6…)\"), a home streak says when the visitors last won there, a game at a third site is not a home game, and the largest win each way is given; with only part of the series on file it says \"since 2009-10\" and claims no series record; a margin that could not be real is not used",
      JSON.stringify([pastP.games.length, pastP.whole, pastP.exact, itsP.map((i) => i.text), itsS.map((i) => i.text)]));
    // The real files, with no games from this season.
    const zl = await import("node:zlib"); const { deepSeqs } = await import("../src/situations/deepseq.js");
    const gzr = (f) => JSON.parse(zl.gunzipSync(fs.readFileSync(path.join(root, "src", "data", f))));
    const offR = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-team-seasons-2026-27.json"), "utf8")).teams, HR = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-results-history.json"), "utf8"));
    const deepR = deepSeqs({ older: gzr("nba-results-older.json.gz"), guide: gzr("guide-games-2026-27.json.gz"), official: offR });
    const RS3 = { ...RS, counted: countedPairs({ deep: deepR, history: HR, official: offR, through: RS.through }) };
    const T30 = Object.keys(offR).sort(); let nP = 0, nW = 0, nE = 0;
    for (let i = 0; i < 30; i++) for (let j = i + 1; j < 30; j++) { const p = pairHistory({ deep: deepR, official: offR, series: RS3 }, T30[i], T30[j]); if (p) { nP++; nW += p.whole; nE += p.exact; } }
    const lacCha = pairHistory({ deep: deepR, official: offR, series: RS3 }, "CHA", "LAC"), clW = TI(HR, null, "WAS", "CLE", "2026-10-20", pairHistory({ deep: deepR, official: offR, series: RS3 }, "WAS", "CLE"));
    ok(nP === 435 && nW === 399 && nE === 358 && deepR.seq.LAL.every((g) => g.h === true || g.h === false || g.h === null) && lacCha.from === "1988-89" && lacCha.whole
      && /^The Cavaliers have won 16 straight against the Wizards, the longest streak by either team in the series \(was 13, the Wizards, 1972-74\)/.test(tx(clW, /16 straight/)),
      "head-to-head, the real files (0.88, 0.93): every pairing has games before 2016-17 (ESPN from 1993-94 at the least), 399 back to the first meeting, 358 of those with a count that lands on the record shown before the outside check (fewer than in 0.93, because a guide's own list no longer confirms its own table; 0.96: two more, Lakers v Kings and Pistons v Heat, once the Royals' and the Heat's swapped results are corrected); \"The Cavaliers have won 16 straight against the Wizards, the longest streak by either team in the series (was 13, the Wizards, 1972-74)\"",
      JSON.stringify([nP, nW, nE, lacCha.from, clW.map((i) => i.text).slice(0, 4)]));
  }
  // 0.89: "the last time…".
  {
    const { advance, scoreFeats, firstSince, watchList, phrase, LAST } = await import("../src/records/lasttime.js");
    const { PLAYER_BOX_KEYS: PK, TEAM_BOX_KEYS: TK } = await import("../src/espn/parse.js");
    const line = (side, o) => [side, 1, 30, ...PK.map((k) => o[k] || 0)], tb = (o) => TK.map((k) => o[k] || 0);
    const seed = { feats: [
      { team: "BOS", by: "team", who: "player", stat: "reb", n: 25, date: "1987-01-09", holder: "Robert Parish", value: "25 REB", opp: "Sacramento" },
      { team: "BOS", by: "team", who: "player", stat: "reb", n: 20, date: "2026-01-07", holder: "Neemias Queta", value: "20 REB", opp: "Denver" },
      { team: "BOS", by: "opp", who: "player", stat: "ast", n: 20, date: "1989-12-15", holder: "Magic Johnson", value: "21 AST", opp: "LA Lakers" },
      { team: "BOS", by: "team", who: "team", stat: "ftm", n: 35, date: "2011-02-26", holder: null, value: "35 FTM", opp: "LA Clippers" },
      { team: "BOS", by: "team", who: "team", stat: "pts", n: 150, date: "2020-01-01", holder: null, value: "150", opp: "X" },
      { team: "BOS", by: "team", who: "player", stat: "td", n: 1, date: "2026-04-01", holder: "Jayson Tatum", value: "", opp: "Miami" } ] };
    const rowsL = [
      { d: "2026-11-10", h: "BOS", a: "ORL", hs: 120, as: 100, hb: tb({ ftm: 20 }), ab: tb({}), pl: { 1: line(0, { pts: 12, reb: 26 }), 2: line(1, { pts: 30, ast: 9 }) } },
      { d: "2026-11-16", h: "DEN", a: "BOS", hs: 99, as: 131, hb: tb({}), ab: tb({ ftm: 36 }), pl: { 1: line(1, { pts: 20, reb: 21 }), 3: line(0, { pts: 14, ast: 22, reb: 10 }) } } ];
    const A = advance(seed, rowsL, { 1: "Big Man", 2: "Guard", 3: "Passer" }), fa = (st, n, by = "team") => A.find((f) => f.stat === st && f.n === n && f.by === by);
    const FS = firstSince(A, "2026-11-16", "2026-11-17"), FSall = firstSince(A, "2026-10-01", "2026-11-17");
    const WL = watchList(A, ["BOS"], "2026-11-17");
    ok(A.length === 5 && !A.some((f) => f.stat === "pts") && fa("reb", 25).last.date === "2026-11-10" && fa("reb", 25).last.holder === "Big Man" && fa("reb", 25).prev.holder === "Robert Parish" && fa("reb", 20).last.date === "2026-11-16"
      && fa("ast", 20, "opp").last.holder === "Passer" && fa("ftm", 35).last.value === "36" && fa("td", 1).last.guide === true
      && FS.map((l) => l.text).sort().join(" | ") === "BOS made 36 free throws on 11/16: the first game with 35+ free throws for the Celtics since 2/26/11 (35 FTM) | Passer (DEN) had 22 assists on 11/16: the first 20-assist game against the Celtics since Magic Johnson (21 AST, 12/15/89)"
      && FSall.some((l) => l.text === "Big Man (BOS) had 26 rebounds on 11/10: the first 25-rebound game for the Celtics since Robert Parish (25 REB, 1/9/87)") && FS.every((l) => l.kind === "unique" && l.date === "2026-11-16")
      && JSON.stringify(WL) === "{}" && watchList(advance(seed, [], {}), ["BOS"], "2026-11-17").BOS.map((x) => `${x.by}${x.stat}${x.n}`).join() === "teamreb25,oppast20"
      && watchList(advance(seed, [], {}), ["BOS"], "2026-11-17").BOS[0].phrase === "the first 25-rebound game for the Celtics since Robert Parish (25 REB, 1/9/87)" && LAST.years === 3,
      "last time (0.89): the guides' \"last time\" feats are carried forward by this season's box scores (a player on the team, a player against it, a team total); one done last night whose time before was three years or more earlier is a line (\"the first 20-assist game against the Celtics since Magic Johnson (21 AST, 12/15/89)\"); a team's points and margins are left to its own games; NBA Live is sent only the player feats not done in three years, sentence included",
      JSON.stringify([A.map((f) => [f.stat, f.n, f.by, f.last.date]), FS.map((l) => l.text), WL]));
    // From scores: every team, with its window.
    const deepL = { seq: { AAA: [{ d: "2001-01-05", pf: 151, pa: 120, opp: "BBB" }, { d: "2005-01-05", pf: 20, pa: 300, opp: "BBB" }] }, from: { AAA: "2000-01", CCC: "2010-11" }, whole: { AAA: true } };
    const histL = { columns: ["date", "home", "away", "homeScore", "awayScore", "type"], games: [["2018-01-05", "CCC", "AAA", 130, 80, 2], ["2019-05-05", "AAA", "CCC", 170, 80, 3]] };
    const SF = scoreFeats({ deep: deepL, history: histL, rows: [{ d: "2026-11-16", h: "AAA", a: "CCC", hs: 155, as: 100 }] });
    const sf = (t, by, st, n) => SF.find((f) => f.team === t && f.by === by && f.stat === st && f.n === n), SL = firstSince(SF, "2026-11-16", "2026-11-17").map((l) => l.text);
    ok(sf("AAA", "team", "pts", 150).last.date === "2026-11-16" && sf("AAA", "team", "pts", 150).prev.date === "2001-01-05" && sf("AAA", "opp", "pts", 150).last === null && sf("AAA", "opp", "margin", 50).last.date === "2018-01-05"
      && sf("CCC", "opp", "margin", 50).last.date === "2026-11-16" && sf("CCC", "opp", "margin", 50).prev === null && sf("CCC", "team", "margin", 50).prev === null
      && SL.includes("AAA scored 155 on 11/16: the first 150-point game for the AAA since 1/5/01 (151-120, BBB)") && SL.includes("AAA won by 55 on 11/16: the first win by 50 or more by the AAA in franchise history")
      && SL.includes("AAA won by 55 on 11/16: the first loss by 50 or more for the CCC since at least 2010-11") && phrase({ team: "BOS", by: "opp", who: "player", stat: "td", n: 1, prev: { date: "2020-02-02", holder: "A B", value: "" } }) === "the first triple-double against the Celtics since A B (2/2/20)",
      "last time, from scores (0.89): every team's points and margins come from its own games (playoff games and impossible scores left out), and a first says how far back it can see: \"since 1/5/01\", \"in franchise history\" where the games reach the first season, \"since at least 2010-11\" where they do not",
      JSON.stringify([SL, sf("CCC", "opp", "margin", 50)]));
    // The data file read from the guides.
    const LT = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "last-time-2026-27.json"), "utf8")).feats, lt = (t, by, st, n) => LT.find((f) => f.team === t && f.by === by && f.stat === st && f.n === n && f.who === "player");
    ok(LT.length === 174 && lt("BOS", "team", "reb", 25).date === "1987-01-09" && lt("BOS", "team", "reb", 25).holder === "Robert Parish" && lt("WAS", "team", "reb", 25).holder === "Wes Unseld" && lt("BOS", "opp", "ast", 20).holder === "Magic Johnson"
      && lt("GSW", "team", "ast", 20).holder === "Tim Hardaway" && lt("PHI", "team", "pts", 60).holder === "Joel Embiid" && lt("PHI", "team", "pts", 60).date === "2024-01-22" && lt("TOR", "team", "td", 1).date === "2026-04-12" && !LT.some((f) => f.team === "CLE" || f.team === "NYK"),
      "last time, the guides (0.89): 174 feats from the Celtics', Wizards' and Warriors' \"last time\" pages and from lists of every triple-double or 40-point game that run into last season (a list that stops earlier is not used): the last 25-rebound game by a Celtic is Robert Parish's, 1/9/87",
      JSON.stringify([LT.length, lt("BOS", "team", "reb", 25)]));
  }
  // 0.92: an outside check on a pairing; a printed box-score mark reached.
  {
    const base = { through: "2025-26", guides: { AAA: { agree: [9, 10] }, BBB: { agree: [9, 10] } }, teams: { AAA: { BBB: { overall: { w: 288, l: 169 }, home: { w: 160, l: 60 } } }, BBB: { AAA: { overall: { w: 169, l: 289 } } } } };
    const v = (w, l) => seriesPair({ ...base, verified: [{ a: "BBB", b: "AAA", w, l, by: "Basketball Reference" }] }, "AAA", "BBB");
    const vA = v(169, 288), vB = v(169, 289), vN = v(170, 290), VR = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "series-verified.json"), "utf8")).pairs;
    const ls = seriesPair({ ...RS, verified: VR }, "LAL", "SAC");
    ok(seriesPair(base, "AAA", "BBB").status === "differs" && vA.status === "confirmed" && vA.source.join() === "AAA,check" && vA.rec.overall.w === 288 && vA.rec.home.w === 160 && vA.checked === "Basketball Reference" && !vA.other
      && vB.source.join() === "BBB,check" && vB.rec.overall.w === 289 && vN.source.join() === "check" && vN.rec.overall.w === 290 && vN.rec.overall.l === 170
      && ls.status === "confirmed" && ls.source.join() === "LAL,check" && ls.rec.overall.w === 288 && ls.rec.overall.l === 169 && seriesPair(RS, "LAL", "SAC").status === "differs",
      "series (0.92; the user's Basketball Reference page for Lakers v Kings, 11/17): a record looked up outside the guides names the guide that is right, or stands alone when neither is; Lakers v Kings is the Lakers' 288-169 through 2025-26 (the page's 289-169 counts this season's game), not the Kings' 289-169",
      JSON.stringify([vA, vB.source, vN, ls.source, ls.rec.overall]));
    const { boxRecordLines } = await import("../src/records/teamgame.js");
    const { TEAM_BOX_KEYS: TK2 } = await import("../src/espn/parse.js"), tb2 = (o) => TK2.map((k) => o[k] || 0);
    const recs = { teams: { AAA: [{ stat: "ast", kind: "most", period: "game", value: 45, games: [{ opp: "X", date: "1989-03-03" }] }, { stat: "pts", kind: "most", period: "quarter", value: 51, games: [{ opp: "Y", date: "1963-03-02" }, { opp: "Z", date: "2026-03-25" }] }, { stat: "reb", kind: "fewest", period: "game", value: 20, games: [{ opp: "X", date: "1990-01-01" }] },
      { stat: "fg3m", kind: "most", period: "game", value: 20, side: "opp", games: [{ opp: "Q", date: "2021-02-22" }] }, { stat: "stl", kind: "fewest", period: "game", value: 0, games: [{ opp: "Q", date: "2001-01-01" }] }, { stat: "oreb", kind: "fewest", period: "game", value: 2, side: "opp", games: [{ opp: "Q", date: "2024-03-07" }] },
      { stat: "pts", kind: "most", period: "game", value: 160, games: [{ opp: "Q", date: "1990-11-10" }] }] } };
    const rowsB = [{ d: "2026-11-16", h: "AAA", a: "BBB", hs: 150, as: 100, hq: [30, 52, 40, 28], aq: [25, 25, 25, 25], hb: tb2({ fga: 90, ast: 46, oreb: 5, dreb: 10 }), ab: tb2({ fga: 88, ast: 50, fg3m: 21, oreb: 1, dreb: 30 }) }, { d: "2026-11-10", h: "AAA", a: "BBB", hs: 100, as: 90, hb: tb2({ fga: 85, ast: 47, oreb: 10, dreb: 30 }), ab: tb2({ fga: 85, oreb: 9, dreb: 30 }) }];
    const BL = boxRecordLines(recs, rowsB, "2026-11-16", "2026-11-17").map((l) => l.text), BL10 = boxRecordLines(recs, rowsB, "2026-11-10", "2026-11-17").map((l) => l.text);
    const TRF = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "team-game-records-2026-27.json"), "utf8")), TR = TRF.teams, tr = (t, st, pd, kind = "most", side = "team") => TR[t].find((m) => m.stat === st && m.period === pd && m.kind === kind && (m.side || "team") === side);
    ok(BL.length === 4 && BL.includes("AAA had 52 points in a quarter on 11/16 (BBB): the most in a quarter in franchise history, by its media guide (was 51, 3/2/63 and 1 more)")
      && BL.includes("BBB had 21 threes against AAA on 11/16: the most by an opponent in a game in franchise history, by the AAA media guide (was 20, 2/22/21)")
      && BL.includes("AAA had 15 rebounds on 11/16 (BBB): the fewest in a game in franchise history, by its media guide (was 20, 1/1/90)")
      && BL.includes("BBB had 1 offensive rebound against AAA on 11/16: the fewest by an opponent in a game in franchise history, by the AAA media guide (was 2, 3/7/24)")
      && !BL.some((t) => /assists|steals|150 points/.test(t)) && BL10.includes("AAA had 47 assists on 11/10 (BBB): the most in a game in franchise history, by its media guide (was 45, 3/3/89)") && !BL10.some((t) => /46 assists/.test(t)),
      "team records (0.92, 0.93): a guide's printed marks are checked against the season's box scores in order, so 46 assists a week after 47 is not a record (0.92 said it was); 0.93 adds the fewest and an opponent's most and fewest; a second night without a steal is not a line; points in a game are left to the score-based marks",
      JSON.stringify([BL, BL10]));
    ok(Object.keys(TR).length === 30 && tr("BOS", "reb", "game").value === 112 && tr("HOU", "blk", "game", "most", "opp").value === 21 && tr("IND", "reb", "game", "fewest").value === 21 && tr("IND", "reb", "game", "fewest").games[0].date === "2006-12-11" && tr("IND", "reb", "game", "fewest").games[0].opp === "at Chicago" && /Basketball Reference/.test(tr("BKN", "fg3a", "game").checked) && tr("CHA", "fg3a", "game", "fewest").games[1].date === "1988-11-04" && tr("GSW", "pts", "game").games.length === 1 && tr("MIL", "ftm", "game").games.length === 1 && tr("MIL", "pf", "game", "fewest").games[0].date === "2024-04-09" && tr("NYK", "fg3m", "game", "most", "opp").games[0].date === "2024-10-22" && tr("IND", "ast", "game", "fewest", "opp").value === 5 && !tr("ORL", "blk", "game", "fewest", "opp") && tr("BOS", "tov", "game", "fewest", "opp").games[0].date === "2025-04-02" && tr("SAS", "oreb", "game", "fewest", "opp").games[0].date === "2022-10-26" && tr("CLE", "pts", "game").value === 154 && tr("CLE", "pts", "game").games[0].opp === "vs. L.A. Lakers" && tr("CLE", "pts", "quarter").value === 50 && tr("CLE", "oreb", "game", "most", "opp").games.length === 2 && tr("CLE", "oreb", "game", "most", "opp").games[1].opp === "@ New Jersey" && tr("CLE", "fg3m", "game", "most", "opp").value === 29 && !tr("CLE", "pts", "game", "fewest") && tr("ATL", "pts", "game").value === 161 && tr("ATL", "pts", "game", "most", "opp").value === 168 && tr("DEN", "pts", "game").value === 184 && tr("DEN", "pts", "game", "most", "opp").value === 186 && tr("DEN", "oreb", "game", "fewest").value === 1 && tr("DEN", "dreb", "game", "fewest").value === 14 && tr("MEM", "pts", "game").value === 155 && tr("MEM", "pts", "quarter").value === 55 && tr("MEM", "fta", "game", "fewest").value === 1 && tr("SAC", "pts", "game").value === 176 && tr("SAC", "pts", "game", "most", "opp").value === 175 && tr("SAC", "fga", "game", "most", "opp").value === 160 && TRF.scopes.DEN === "in the Nuggets' NBA years (since 1976-77)" && tr("UTA", "pts", "game").value === 154 && tr("UTA", "pts", "game").games.length === 2 && tr("UTA", "pts", "game", "fewest", "opp").games[0].date === "2001-12-18" && tr("MIA", "pts", "game", "fewest").games[0].date === "2008-03-19" && tr("TOR", "pts", "game", "fewest", "opp").value === 54
      && tr("IND", "pts", "game").value === 162 && tr("IND", "ast", "game").value === 50 && tr("IND", "fgm", "game", "fewest", "opp").value === 20 && tr("NYK", "pts", "game", "most", "opp").value === 169 && tr("NYK", "pts", "game", "most", "opp").games[0].date === "1962-03-02" && tr("NYK", "oreb", "game").value === 29 && tr("NYK", "oreb", "game").games.length === 0 && tr("NYK", "oreb", "game").times === "2 times" && tr("NYK", "pts", "quarter").value === 53
      && tr("WAS", "pts", "game").value === 161 && tr("WAS", "pts", "game", "most", "opp").value === 162 && tr("WAS", "pts", "half").games.length === 2 && tr("MIA", "pts", "game").value === 153 && tr("MIA", "pts", "game", "fewest", "opp").value === 49 && tr("MIA", "pts", "quarter").value === 53 && tr("MIA", "blk", "game").value === 15
      && tr("PHI", "pts", "game").value === 163 && tr("PHI", "pts", "quarter").value === 53 && tr("PHI", "fg3m", "game").games.length === 2 && tr("LAL", "pts", "game").value === 162 && tr("LAL", "pts", "game").games[0].date === "1972-03-19" && tr("LAL", "pts", "game", "most", "opp").value === 173
      && tr("MIN", "pts", "game").value === 151 && tr("CHI", "pts", "game", "fewest").value === 49 && tr("DAL", "pts", "game").value === 156 && tr("DAL", "pts", "game", "most", "opp").value === 153 && tr("GSW", "fgm", "game", "fewest").value === 23 && tr("POR", "fgm", "game", "fewest").value === 19
      && tr("MIL", "pts", "game", "most", "opp").value === 171 && tr("OKC", "fgm", "game", "fewest").value === 20 && tr("NOP", "pts", "game").games[0].date === "2026-04-07" && tr("ORL", "fga", "game").games.length === 2 && tr("DET", "pts", "game").value === 186 && tr("LAC", "pts", "game", "fewest").value === 63
      && tr("BOS", "fgm", "game").value === 72 && !tr("BOS", "fgm", "game").doubt && /Basketball Reference/.test(tr("BOS", "fgm", "game").checked) && tr("BOS", "fta", "game").value === 65 && tr("PHX", "reb", "game", "fewest", "opp").value === 19 && tr("CHA", "fg3m", "game", "most", "opp").value === 28 && tr("SAS", "pts", "game").value === 171 && tr("BKN", "pts", "half", "fewest").value === 24 && tr("HOU", "pts", "game", "most", "opp").value === 165
      && TRF.scopes.OKC === "in Oklahoma City history (since 2008-09)" && Object.values(TR).flat().length > 2700,
      "team records, the real file (0.93, 0.95, 0.97): all 30 guides' team records pages are read (0.99: checked against ESPN's box scores, which found sub-rows read as ties (the Warriors' 'West Coast' rows, the Bucks' 'Most, 0 Missed') and 16 dates the guides misprint, each corrected with its source; 0.98 adds Cleveland, highs only, with one scrambled block put back into rows; 0.97 adds Atlanta's three columns, Denver's DEN / OPP rows and its mislabelled offensive-rebounds list, Memphis's three stats across, and the Kings-Royals franchise pages) (0.95 adds Utah and Toronto, points only, and Indiana, New York, Washington and Miami; Washington's 'two teams combined' lists are not an opponent's marks; a Knicks mark 'Done 2 times' has a value and no game; Utah's fewest allowed and Miami's fewest are the same night in both guides) (each lays them out its own way: rows with a label, a label on the line above or below, a 'Low' row, sub-headings, bands, dotted leaders): the Lakers' 162 and the 173 scored on them, Dallas's 156 in double overtime, Golden State's 'Fewest Game' rows, Portland's 'Field Goals / Made'; Boston prints one night as 72 and as 77 field goals, and the box score (the user's screenshot, 11/17) says 72, so the 77 is dropped; the Thunder's marks are Oklahoma City's only",
      JSON.stringify([Object.keys(TR), Object.values(TR).flat().length, tr("BOS", "fgm", "game")]));
    // 0.100: points by half, quarter and overtime against ESPN's line scores (tools/check-period-points.mjs)
    const dts = (m) => (m?.games || []).map((g) => g.date);
    ok(tr("MIN", "pts", "quarter").value === 52 && dts(tr("MIN", "pts", "quarter"))[0] === "2025-04-10" && /Associated Press/.test(tr("MIN", "pts", "quarter").checked) && tr("MEM", "pts", "quarter", "most", "opp").value === 52
      && tr("GSW", "pts", "half").value === 92 && dts(tr("GSW", "pts", "half"))[0] === "2018-10-29" && tr("POR", "pts", "quarter", "most", "opp").value === 55 && tr("CHA", "pts", "quarter", "most", "opp").value === 53
      && tr("SAC", "pts", "half", "fewest", "opp").value === 24 && dts(tr("SAC", "pts", "half", "fewest", "opp"))[0] === "1995-02-02" && !tr("NYK", "pts", "ot", "fewest")
      && dts(tr("BKN", "pts", "half", "fewest")).includes("2003-03-08") && !dts(tr("BKN", "pts", "half", "fewest")).includes("2003-02-25") && tr("BKN", "pts", "half", "fewest").games.find((g) => g.date === "2003-03-08").opp === "@ Houston"
      && dts(tr("CHI", "pts", "quarter", "most", "opp"))[0] === "2026-03-25" && dts(tr("ATL", "pts", "quarter", "fewest", "opp")).includes("2008-02-25") && dts(tr("PHX", "pts", "half", "fewest", "opp"))[0] === "2000-02-22"
      && dts(tr("ORL", "pts", "quarter", "fewest", "opp")).includes("2009-01-06") && !dts(tr("ORL", "pts", "quarter", "fewest", "opp")).includes("2008-01-06") && dts(tr("HOU", "pts", "half", "fewest")).join() === "2014-01-16" && dts(tr("MIN", "pts", "ot", "fewest", "opp"))[0] === "2015-11-07",
      "team records (0.100): every points mark by half, quarter and overtime with a game since 1993-94 is checked against ESPN's line scores. Seven dates the guides misprint are corrected (the Nets' 24-point half was at Houston, not Cleveland), the Knicks' overtime low (their second-half low printed again) is dropped, and six marks a guide's page is behind on are raised, each with a second source (the Wolves' 52-point quarter, the Warriors' 92-point half)",
      JSON.stringify([tr("MIN", "pts", "quarter"), tr("BKN", "pts", "half", "fewest"), tr("NYK", "pts", "ot", "fewest"), tr("HOU", "pts", "half", "fewest")]));
    // 0.100: the sweep of every ESPN box score since 1993-94 (tools/sweep-team-marks.mjs): only hits the other team's guide also prints go in
    ok(tr("MEM", "tov", "game", "fewest", "opp").value === 1 && dts(tr("MEM", "tov", "game", "fewest", "opp")).join() === "2023-04-02" && tr("MEM", "reb", "game", "fewest").value === 20 && tr("MEM", "fta", "game", "fewest", "opp").value === 3
      && tr("HOU", "dreb", "game").value === 52 && tr("IND", "ast", "game", "most", "opp").value === 50 && tr("IND", "fg3a", "game").value === 54 && tr("LAL", "pf", "game", "fewest", "opp").value === 6 && tr("SAC", "pf", "game", "fewest").value === 7
      && tr("POR", "fg3m", "game", "most", "opp").value === 27 && tr("GSW", "pf", "game", "fewest", "opp").value === 5 && tr("GSW", "oreb", "game", "fewest", "opp").value === 1 && /Kings' guide/.test(tr("GSW", "oreb", "game", "fewest", "opp").checked)
      && dts(tr("GSW", "ast", "game", "fewest")).join() === "2002-01-06,2006-03-21,2008-04-01" && dts(tr("GSW", "ftm", "game", "fewest")).length === 2 && Object.values(TR).flat().every((m) => m.games.every((g) => !/^\)|\s{2,}/.test(g.opp || ""))),
      "team records (0.100): the sweep found the Pacers' 21-rebound night (at Chicago 12/11/06, two days after the game the guide prints; the Bulls' guide has it) and eleven marks a guide's page is behind on that the other team's guide prints (the Bulls' 1 turnover against Memphis, Washington's 50 assists against Indiana); ties printed under the Warriors' 'Fewest Game' rows are read (three 8-assist games); opponent names carry no stray characters",
      JSON.stringify([tr("MEM", "tov", "game", "fewest", "opp"), tr("GSW", "ast", "game", "fewest"), tr("IND", "reb", "game", "fewest")]));
    // 0.105: which day's slate a build publishes (src/espn/slate.js)
    {
      const { slateDay: sd, unfinished: unf } = await import("../src/espn/slate.js");
      const t0 = Date.parse("2026-11-18T06:55:00Z"), gm = (state, start, date = "2026-11-17") => ({ state, start, date, awayTri: "UTA", homeTri: "LAC" });
      const live = [gm("post", "2026-11-18T00:30:00Z"), gm("in", "2026-11-18T03:30:00Z")], done = [gm("post", "2026-11-18T00:30:00Z"), gm("post", "2026-11-18T03:30:00Z")];
      const day = (games, hourET = 1) => sd({ today: "2026-11-18", yesterday: "2026-11-17", hourET, games, nowMs: t0 });
      ok(day(live).day === "2026-11-17" && day(live).held.length === 1 && day(done).day === "2026-11-18" && day(live, 6).day === "2026-11-18" && day(live, 13).day === "2026-11-18" && day([]).day === "2026-11-18" && day(null).day === "2026-11-18"
        && day([gm("pre", "2026-11-18T03:30:00Z")]).day === "2026-11-17" && day([gm("pre", "2026-11-17T23:00:00Z")]).day === "2026-11-18" && day([gm("in", "2026-11-18T03:30:00Z", "2026-11-16")]).day === "2026-11-18" && unf([gm("post", null)], t0).length === 0
        && (await (async () => { const { readScoreboard: rsb } = await import("../src/espn/parse.js");      // the real reader's shape, as scripts/ci.js passes it
          const espn = (state) => ({ events: [{ id: "1", date: "2026-11-18T03:30Z", competitions: [{ date: "2026-11-18T03:30Z", status: { type: { state, completed: state === "post" } }, competitors: [{ homeAway: "home", team: { displayName: "LA Clippers" }, score: "50" }, { homeAway: "away", team: { displayName: "Utah Jazz" }, score: "48" }] }] }] });
          return day(rsb(espn("in")).games).day === "2026-11-17" && day(rsb(espn("in")).games).held[0].homeTri === "LAC" && day(rsb(espn("post")).games).day === "2026-11-18" && /readScoreboard\(await r\.json\(\)\)\.games/.test(fs.readFileSync(path.join(root, "scripts", "ci.js"), "utf8")); })()),
        "slate (0.105): after midnight Eastern a build keeps yesterday's slate while one of yesterday's games is still being played (or tipped late and is not marked started), moves on when all are final, never holds past 6 AM, and does not hold for a postponed game or an unreadable scoreboard",
        JSON.stringify([day(live), day(done), day(live, 6)]));
    }
    // 0.102: Kalshi's NBA markets: when a move is a line (src/kalshi.js)
    {
      const { look: kLook, line: kLine, priceOf: kPrice, isGameEvent: kGame, typical: kTyp, threshold: kThr } = await import("../src/kalshi.js");
      const mk = (t, name, bid, ask, last, vol = 100) => ({ ticker: t, yes_sub_title: name, yes_bid_dollars: (bid / 100).toFixed(4), yes_ask_dollars: (ask / 100).toFixed(4), last_price_dollars: (last / 100).toFixed(4), volume_24h_fp: String(vol) });
      const evs = (ms) => [{ series_ticker: "KXNBAMVP", event_ticker: "KXNBAMVP-27", title: "NBA MVP", mutually_exclusive: true, markets: ms }, { series_ticker: "KXNBAGAME", event_ticker: "KXNBAGAME-26NOV17NYKTOR", title: "NYK at TOR", mutually_exclusive: true, markets: [mk("G1", "NYK", 60, 62, 61), mk("G2", "TOR", ms.length > 4 ? 20 : 38, ms.length > 4 ? 22 : 40, 39)] }];
      const k1 = kLook({}, evs([mk("A", "Wemby", 31, 33, 32), mk("B", "Luka", 25, 27, 26), mk("C", "Flagg", 1, 2, 1), mk("D", "Nobody", 0, 100, 1, 0)]), "2026-11-17T20:00:00Z");
      const k2 = kLook(k1.state, evs([mk("A", "Wemby", 31, 33, 32), mk("B", "Luka", 38, 40, 39), mk("C", "Flagg", 5, 6, 5), mk("D", "Nobody", 0, 100, 9, 0), mk("E", "New", 3, 4, 3)]), "2026-11-17T21:00:00Z");
      // 0.106.3: a stray trade is not a move. Cup MVP as on 11/18: bid 5, ask 16 (too wide for a midpoint), one trade at 13.
      const cup = (ms) => [{ series_ticker: "KXNBACUPMVP", event_ticker: "KXNBACUPMVP-26", title: "Cup MVP", mutually_exclusive: true, markets: ms }];
      const c1 = kLook({}, cup([mk("GA", "Giannis", 6, 8, 7, 137)]), "2026-11-18T05:00:00Z"), c2 = kLook(c1.state, cup([mk("GA", "Giannis", 5, 16, 13, 137)]), "2026-11-18T06:04:00Z"),
        c3 = kLook(c2.state, cup([mk("GA", "Giannis", 6, 8, 7, 137)]), "2026-11-18T06:15:00Z"), c4 = kLook(c3.state, cup([mk("GA", "Giannis", 12, 14, 13, 137)]), "2026-11-18T07:15:00Z"),
        c5 = kLook(c4.state, cup([mk("GA", "Giannis", 5, 16, 7, 137)]), "2026-11-18T08:15:00Z"), c6 = kLook(c5.state, cup([mk("GA", "Giannis", 5, 7, 6, 137)]), "2026-11-18T09:15:00Z");
      ok(c2.alerts.length === 0 && c3.alerts.length === 0 && c4.alerts.length === 1 && c4.alerts[0].from === 7 && c4.alerts[0].to === 13 && c5.alerts.length === 0 && c6.alerts.length === 1 && c6.alerts[0].to === 6,
        "kalshi (0.106.3, self-audit): a rise is a line only when the bid itself is past the bar, a fall only when the ask is; a trade at 13 with the bid still at 5 is nothing, and neither is its return (on 11/18 that was two lines eleven minutes apart)", JSON.stringify([c2, c3, c4, c5, c6].map((x) => x.alerts.map((a) => [a.from, a.to]))));
      const kTier = (await import("../src/kalshi.js")).tier, wins = (lo, hi, v) => [{ series_ticker: "KXNBAWINS", event_ticker: "KXNBAWINS-27NYK", title: "New York Total Wins", mutually_exclusive: false, markets: [mk("W45", "45+ wins", lo - 1, lo + 1, lo, v), mk("W50", "50+ wins", hi - 1, hi + 1, hi, v)] }];
      const w1 = kLook({}, wins(70, 50, 900), "2026-11-17T20:00:00Z"), w2 = kLook(w1.state, wins(77, 57, 900), "2026-11-17T21:00:00Z"), w3 = kLook(w2.state, wins(84, 62, 900), "2026-11-17T22:00:00Z"), w4 = kLook(w1.state, wins(84, 62, 300), "2026-11-17T21:00:00Z");
      ok(kTier("KXNBAMVP") === 1 && kTier("KXNBA") === 1 && kTier("KXNBAATLANTIC") === 1 && kTier("KXNBAWINS") === 2 && kTier("KXNBASEED") === 2 && kGame("KXNBARACE-26NOV18MILMIA-30") && !kGame("KXNBAROTM-NOV26WEST")
        && w2.alerts.length === 0 && w3.alerts.length === 1 && w3.alerts[0].name === "45+ wins" && w3.alerts[0].from === 70 && w3.alerts[0].also === 1 && w4.alerts.length === 0,
        "Kalshi (0.103): headline markets (awards, title, conference, division) keep the 5-point rule; any other future needs 10 points on 500+ contracts and gives one line per group; a market named for one game, like a race to 30 points, is never a line",
        JSON.stringify([w2.alerts, w3.alerts, w4.alerts]));
      const k3 = kLook(k2.state, evs([mk("A", "Wemby", 31, 33, 32), mk("B", "Luka", 39, 41, 40), mk("C", "Flagg", 5, 6, 5), mk("D", "Nobody", 0, 100, 9, 0)]), "2026-11-18T21:00:00Z");
      ok(k1.alerts.length === 0 && k1.moves.length === 0 && k1.counts.markets === 6 && k1.counts.game === 2 && k1.state.e["KXNBAMVP-27"].name === "Wemby"
        && k2.alerts.length === 3 && k2.alerts.map((a) => a.kind).join() === "move,surge,leader" && k2.alerts[0].from === 26 && k2.alerts[0].to === 39 && k2.alerts[1].name === "Flagg" && k2.alerts[2].past === "Wemby"
        && k2.alerts.every((a) => a.name !== "Nobody" && a.series !== "KXNBAGAME") && k2.moves.some((m) => m[1] === "G2" && m.length === 6) && /new favorite \*\*Luka\*\* 39%/.test(kLine(k2.alerts[2])) && /from the pack/.test(kLine(k2.alerts[1]))
        && k3.alerts.length === 0 && k3.state.m.B.d.join() === "39" && k3.state.m.B.base === 39 && kPrice(mk("x", "x", 0, 100, 1, 0)).how === "last" && kPrice(mk("x", "x", 10, 30, 12)).p === 12 && !kGame("KXNBA-27") && kGame("KXNBAPRA-26NOV17NYKTOR") && kTyp([30, 31, 35, 36, 36, 40]) === 1 && kThr([30, 40, 30, 40, 30]) === 30,
        "Kalshi (0.102): the first look only sets the baseline; a move of 5 points (or three times the market's usual day) from its last alert is a line once, a long shot that doubles is a line (\"from the pack\"), a new favorite is a line; a market with an empty book is never one, and a market tied to one game is logged, not alerted",
        JSON.stringify([k2.alerts, k2.moves, k3.state.m.B]));
    }
    // 0.101: the user's thirteen box scores; the night-and-opponent check; ESPN's play-by-play by period
    ok(tr("BOS", "pf", "game", "fewest").value === 6 && tr("IND", "pf", "game", "fewest").value === 7 && tr("CHA", "fg3a", "game").value === 59 && tr("GSW", "fg3a", "game").value === 59 && tr("GSW", "fg3a", "game", "most", "opp").value === 58
      && tr("LAC", "dreb", "game").value === 54 && tr("LAC", "fta", "game", "fewest").value === 5 && tr("MIA", "ftm", "game", "most", "opp").value === 47 && tr("MIA", "pf", "game").value === 39 && tr("MIA", "pf", "game").games.length === 2
      && tr("PHX", "fgm", "game", "fewest").value === 22 && tr("SAC", "fta", "game", "fewest").value === 3 && tr("SAS", "reb", "game", "fewest", "opp").value === 20 && /Basketball Reference/.test(tr("SAS", "reb", "game", "fewest", "opp").checked)
      && dts(tr("IND", "reb", "game"))[0] === "1986-11-28" && dts(tr("POR", "pf", "game"))[0] === "1984-03-16" && dts(tr("LAL", "reb", "quarter", "fewest")).includes("2026-01-17") && !dts(tr("LAL", "reb", "quarter", "fewest")).includes("2026-01-07")
      && tr("LAC", "blk", "game", "fewest").games.some((g) => g.date === "2022-01-21" && g.opp === "at PHI") && !tr("CHI", "blk", "ot", "fewest") && !dts(tr("DET", "dreb", "half", "most", "opp")).includes("2025-02-11")
      && dts(tr("NOP", "fg3a", "half", "most", "opp")).includes("2025-02-10") && dts(tr("ORL", "tov", "ot", "fewest")).includes("2025-11-16") && Object.values(TR).flat().every((m) => m.games.every((g) => /^(19[4-9]|20[0-2])\d-\d\d-\d\d$/.test(g.date) && g.date < "2026-07-01")),
      "team records (0.101): the thirteen marks ESPN alone had are confirmed by Basketball Reference and raised; a check of every printed game's night and opponent, and ESPN's play-by-play counted by period, correct twelve more dates (the Pacers' 75 rebounds were 11/28/86, the Blazers' 44 fouls 3/16/84), five opponents' names, and drop fourteen lines a guide's opponents page copies from the team's own; no printed date is malformed or after the guide went to press",
      JSON.stringify([tr("MIA", "pf", "game"), tr("IND", "reb", "game"), tr("LAC", "blk", "game", "fewest"), Object.values(TR).flat().flatMap((m) => m.games).filter((g) => !(g.date < "2026-07-01")).slice(0, 3)]));
    const { teamGameRecords: TGR3, recordLines: RL3, boxTable } = await import("../src/records/teamgame.js");
    const deepP = { seq: { AAA: [{ d: "1990-11-10", pf: 160, pa: 120, opp: "Q" }, { d: "1993-03-26", pf: 107, pa: 155, opp: "DDD" }, ...Array.from({ length: 420 }, (_, i) => ({ d: `2010-01-${String((i % 28) + 1).padStart(2, "0")}`, pf: 100, pa: 99, opp: "CCC" }))] }, from: { AAA: "1988-89" }, whole: { AAA: true } };
    const prP = { through: "2025-26", scopes: {}, teams: { AAA: [{ stat: "pts", kind: "most", period: "game", value: 160, games: [{ opp: "Q", date: "1990-11-10" }] }, { stat: "pts", kind: "most", period: "game", value: 146, side: "opp", games: [{ opp: "R", date: "2021-11-27" }, { opp: "S", date: "1990-02-07" }] }] } };
    const TG3 = TGR3({ deep: deepP, history: null, rows: [{ d: "2026-11-10", h: "AAA", a: "CCC", hs: 152, as: 90 }, { d: "2026-11-16", h: "CCC", a: "AAA", hs: 120, as: 161 }], printed: prP }), m3 = TG3.AAA.marks;
    const bt = boxTable(TRF), lalRow = bt.find((r) => r[0] === "LAL" && r[1] === "points");
    ok(m3.most.v === 161 && m3.most.source === "guide" && m3.most.prev.v === 160 && m3.allowed.v === 146 && m3.allowed.d === "2021-11-27" && m3.allowed.doubt.v === 155 && m3.allowed.doubt.d === "1993-03-26" && !m3.win.source
      && RL3(TG3, "2026-11-16", "2026-11-17").some((l) => l.text === "AAA scored 161 on 11/16 (161-120, CCC): the most points in a game in franchise history for the AAA, by its media guide (was 160, 11/10/90)")
      && RL3(TG3, "2026-11-10", "2026-11-11").every((l) => !/scored/.test(l.text)) && lalRow[2] === "162 (3/19/72)" && lalRow[4] === "173 (2/27/59)" && bt.length > 300,
      "team records (0.93): where the guide prints the mark it is the mark through last season and only this season's games move it; a game on file that beats the print (Charlotte's season page has a 107-155 loss; its records page says no opponent has passed 146) is shown as a doubt and never becomes the record; the finder table has a row a team and stat",
      JSON.stringify([m3.most, m3.allowed, lalRow, bt.length]));
  }
  // 0.94: our own results override a guide page that is behind; the Standings tab; pages and grouping on the long tables.
  {
    const { teamGameRecords: TGR4 } = await import("../src/records/teamgame.js");
    const prB = { through: "2025-26", scopes: {}, teams: { AAA: [{ stat: "pts", kind: "most", period: "game", value: 146, side: "opp", games: [{ opp: "R", date: "2021-11-27" }] }] } };
    const deepB = { seq: { AAA: [{ d: "1993-03-26", pf: 107, pa: 155, opp: "DDD" }] }, from: { AAA: "1988-89" }, whole: { AAA: true } };
    const histB = { columns: ["date", "home", "away", "homeScore", "awayScore", "type"], games: [["2025-11-14", "MMM", "AAA", 147, 134, 2], ["2025-11-20", "AAA", "MMM", 120, 110, 2]] };
    const mB = TGR4({ deep: deepB, history: histB, rows: [], printed: prB }).AAA.marks.allowed;
    const sit = fs.readFileSync(path.join(root, "docs", "situations.html"), "utf8"), stn = fs.readFileSync(path.join(root, "docs", "standings.html"), "utf8");
    const same = stn.replace('<body data-view="standings">', '<body data-view="situations">').replace("<title>NBA Command Center · Standings</title>", "<title>NBA Command Center · Team situations</title>")
      .replace('<a href="situations.html">Team situations</a><a class="on" href="standings.html">Standings</a>', '<a class="on" href="situations.html">Team situations</a><a href="standings.html">Standings</a>') === sit;
    const pagesH = fs.readdirSync(path.join(root, "docs")).filter((f) => f.endsWith(".html")), navOk = pagesH.every((f) => /href="standings\.html"[^>]*>Standings<\/a>/.test(fs.readFileSync(path.join(root, "docs", f), "utf8")));
    const tr2 = fs.readFileSync(path.join(root, "docs", "trends.html"), "utf8"), nat = fs.readFileSync(path.join(root, "docs", "national.html"), "utf8"), ldr = fs.readFileSync(path.join(root, "docs", "leaders.html"), "utf8"), idx = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8");
    ok(mB.v === 147 && mB.d === "2025-11-14" && mB.behind === 146 && mB.doubt.v === 155 && same && navOk && pagesH.length === 14
      && /body\[data-view="situations"\] \.v-standings, body\[data-view="standings"\] \.v-situations \{ display: none; \}/.test(sit) && sit.indexOf('<div class="v-standings">') < sit.indexOf("<h2>All teams</h2>") && sit.indexOf("Most unusual records") < sit.indexOf('<div class="v-standings">')
      && /id="sgroup"/.test(tr2) && /sgroup !== "off" && !cat/.test(tr2) && /data-g="player"/.test(tr2) && /const PER = 25/.test(nat) && /id="ppager"/.test(nat) && ldr.indexOf("<h2>50-40-90 watch</h2>") < ldr.indexOf('<details id="shootbox"') && !/<h2>Shooting lines/.test(ldr)
      && /"standings\.html#rest"/.test(idx) && /"standings\.html#standings"/.test(idx),
      "0.94: a game from our own results that beats a guide's printed mark is the mark and the page is noted as behind (Milwaukee's 147 on Charlotte, 11/14/25; the guide still says 146), while an older listed game stays a doubt; the four standings tables are on their own Standings tab (the same file as Team situations, kept in step), every page links to it; the streaks table can show one row a player and stat, the national TV table has pages of 25, and the shooting-lines table is folded away under the 50-40-90 watch",
      JSON.stringify([mB, same, navOk, pagesH.length]));
  }
  // 0.91: two teams' counts that agree; a mended list; scoring by season.
  {
    const { countedPairs: CP2 } = await import("../src/records/series.js");
    const g2 = { AAA: { agree: [9, 10] }, BBB: { agree: [9, 10] }, LLL: { agree: [9, 10], lists: true, short: "a season missing" }, MMM: { agree: [9, 10], lists: true, short: "a season missing" } };
    const ser2 = { through: "2025-26", first: { AAA: 1990, BBB: 1990, LLL: 1990, MMM: 1990 }, guides: g2, teams: { AAA: { BBB: { overall: { w: 42, l: 69 } } }, BBB: { AAA: { overall: { w: 67, l: 44 } } }, LLL: { MMM: { overall: { w: 133, l: 96 } } }, MMM: { LLL: { overall: { w: 99, l: 136 } } } } };
    const both = seriesPair({ ...ser2, counted: { AAA: { BBB: [{ w: 44, l: 69, by: "AAA" }, { w: 44, l: 69, by: "BBB" }] } } }, "AAA", "BBB"), oneOnly = seriesPair({ ...ser2, counted: { AAA: { BBB: [{ w: 44, l: 69, by: "AAA" }] } } }, "AAA", "BBB");
    const apart = seriesPair({ ...ser2, counted: { AAA: { BBB: [{ w: 44, l: 69, by: "AAA" }, { w: 43, l: 69, by: "BBB" }] } } }, "AAA", "BBB");
    const before = seriesPair(ser2, "LLL", "MMM"), after = seriesPair({ ...ser2, counted: { MMM: { LLL: [{ w: 99, l: 136, by: "MMM" }] }, LLL: { MMM: [{ w: 136, l: 99, by: "MMM" }] } } }, "LLL", "MMM");
    ok(both.status === "confirmed" && both.source.join() === "games" && both.rec.overall.w === 44 && both.rec.overall.l === 69 && both.counted && both.printed.AAA.w === 42 && oneOnly.status === "differs" && apart.status === "differs"
      && before.status === "differs" && after.status === "single" && after.source.join() === "MMM" && after.rec.overall.w === 136 && after.rec.overall.l === 99,
      "series (0.91): when neither guide's print is what the games say but the two teams' games, counted apart, come to one record, that record is shown as counted; one count alone, or two that differ, change nothing; a guide whose lists once fell short stands against another short count once its own validated count is the record it is credited with",
      JSON.stringify([both, oneOnly.status, apart.status, before.status, after]));
    const { scoringBySeason, scoringLines, SCORING } = await import("../src/situations/teamscoring.js");
    const mk = (y, n, pf, pa) => Array.from({ length: n }, (_, i) => ({ d: `${y}-11-${String(1 + (i % 28)).padStart(2, "0")}`, pf, pa, opp: "X" }));
    const deepS = { seq: { AAA: Array.from({ length: 20 }, (_, k) => mk(1995 + k, 41, 100 + (k === 3 ? 20 : 0), 98 - (k === 5 ? 12 : 0))).flat() }, from: { AAA: "1995-96" }, whole: { AAA: false } };
    const rowsS = Array.from({ length: 12 }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, h: "AAA", a: "BBB", hs: 118, as: 80 }));
    const TS2 = scoringBySeason({ deep: deepS, history: null, rows: rowsS, printed: { AAA: { offense: { "1990-91": { g: 82, avg: 119.5 } }, defense: { "1990-91": { g: 82, avg: 101 } }, whole: true } } });
    const SL2 = scoringLines(TS2, ["AAA", "BBB"], { season: "2026-27" }).map((l) => l.text);
    const KN = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "knicks-team-seasons-2026-27.json"), "utf8"));
    ok(TS2.AAA.from === "1990-91" && TS2.AAA.whole && TS2.AAA.seasons.length === 22 && TS2.AAA.seasons[0].src === "guide" && SL2.join(" | ") === "AAA is scoring 118.0 points a game (12 games): its most since 1998-99 (120.0) | AAA is allowing 80.0 points a game (12 games): its fewest in franchise history"
      && SCORING.back === 15 && scoringLines(TS2, ["AAA"], { season: "2026-27" }).every((l) => l.kind === "era" && l.standing) && Object.keys(KN.offense).length === 80 && Object.keys(KN.defense).length === 78 && KN.offense["1995-96"].avg === 97.2 && KN.defense["1996-97"].avg === 92.2,
      "team scoring (0.91; the user's Knicks pages, 11/17): every team's points for and against a game by season come from its own games, with a guide's printed table for the seasons before them (the Knicks', 80 seasons); a line when this season's average is the most or fewest in 15 seasons or more, with the season that last beat it",
      JSON.stringify([TS2.AAA.from, TS2.AAA.seasons.length, SL2]));
  }
  // 0.90: team single-game marks, the guides' largest margins as a check, arena records confirmed.
  {
    const { teamGameRecords, recordLines } = await import("../src/records/teamgame.js");
    const { bestMargins, pairHistory: PH2 } = await import("../src/records/pairs.js");
    const many = Array.from({ length: 420 }, (_, i) => ({ d: `19${90 + Math.floor(i / 60)}-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, "0")}`, pf: 100 + (i % 7), pa: 99 - (i % 5), opp: "BBB" }));
    const deepT = { seq: { AAA: [...many, { d: "1998-03-03", pf: 150, pa: 100, opp: "BBB" }, { d: "1998-03-04", pf: 20, pa: 250, opp: "BBB" }] }, from: { AAA: "1990-91" }, whole: { AAA: true } };
    const TG = teamGameRecords({ deep: deepT, history: null, rows: [{ d: "2026-11-16", h: "AAA", a: "CCC", hs: 152, as: 90 }, { d: "2026-11-10", h: "CCC", a: "AAA", hs: 120, as: 119 }] });
    const RL = recordLines(TG, "2026-11-16", "2026-11-17").map((l) => l.text);
    ok(TG.AAA.marks.most.v === 152 && TG.AAA.marks.most.prev.v === 150 && TG.AAA.marks.win.v === 62 && TG.AAA.marks.win.prev.v === 50 && TG.AAA.marks.loss.v === 1 && TG.AAA.games === 423 && TG.CCC.games === 2
      && RL.includes("AAA scored 152 on 11/16 (152-90, CCC): the most points in a game in franchise history for the AAA (was 150, 3/3/98)") && RL.includes("AAA won by 62 on 11/16 (152-90, CCC): the largest win in franchise history for the AAA (was 50, 3/3/98)")
      && !RL.some((t) => /^CCC/.test(t)) && recordLines(TG, "2026-11-17", "2026-11-18").length === 0,
      "team marks (0.90): each team's most and fewest points, most and fewest allowed and largest win and loss come from its own games (a score that could not be real is left out); a mark set last night is a line that says its window; a team with too few games on file claims nothing",
      JSON.stringify([RL, TG.AAA.marks.most, TG.CCC.games]));
    const lst = [{ d: "1990-01-01", home: "A", away: "B", winner: "A", hs: 140, as: 100 }, { d: "2020-01-01", home: "A", away: "B", winner: "A", hs: 130, as: 85 }, { d: "2000-01-01", home: "B", away: "A", winner: "B", hs: 120, as: 100 }];
    const bm = (pr, whole = true) => bestMargins(lst, pr, whole);
    ok(bm(null).A.m === 45 && bm(null).A.src === "games" && bm(null, false).A === undefined && bm({ A: { m: 38, d: "1985-02-02" } }).A.m === 45 && bm({ A: { m: 38, d: "1985-02-02" } }).A.d === "2020-01-01"
      && bm({ A: { m: 52, d: "1985-02-02" } }).A.src === "guide" && bm({ A: { m: 52, d: "1985-02-02" } }).A.m === 52 && bm({ B: { m: 20, d: "2000-01-01" } }).B.src === "both" && bm({ B: { m: 18, d: "1999-01-01" } }, false).B.m === 18,
      "series margins (0.90): where a guide prints a team's largest win over an opponent it stands, unless a game since 2016-17 beats it (an older, bigger margin in the games is more likely a misprinted score); with no print the games decide, if the whole series is on file",
      JSON.stringify([bm(null), bm({ A: { m: 52, d: "1985-02-02" } })]));
    const SB = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "series-bests-2026-27.json"), "utf8")).teams, AR = Object.values(JSON.parse(fs.readFileSync(path.join(root, "src", "data", "arena-records.json"), "utf8")).arenas);
    ok(Object.keys(SB).sort().join() === "DET,PHI,PHX" && SB.PHX.MIA.win.m === 39 && SB.PHX.MIA.win.d === "1990-12-29" && SB.PHX.MIA.loss.m === 28 && SB.PHI.BOS.loss.m === 48 && SB.PHI.BOS.loss.d === "2022-02-15" && Object.keys(SB.PHX).length === 28
      && AR.filter((r) => r.check === "confirmed").length === 28 && AR.filter((r) => r.check === "corrected").length === 2 && !AR.some((r) => r.check === "quiz") && /Lakers' 2026-27 media guide/.test(AR.find((r) => r.team === "LAL").note),
      "guides (0.90): the Suns', 76ers' and Pistons' largest win and loss against each opponent are read as a check on the games; the six arena scoring records that were still as the quiz had them are confirmed in the teams' own guides (28 confirmed, 2 corrected)",
      JSON.stringify([Object.keys(SB), SB.PHX.MIA]));
  }
  // Every game four guides list season by season (tools/guide_games.py): each season's wins and losses must be the
  // franchise's own record (the NBA Guide's standings).
  {
    const zl = await import("node:zlib");
    const GGm = JSON.parse(zl.gunzipSync(fs.readFileSync(path.join(root, "src", "data", "guide-games-2026-27.json.gz"))));
    const TSn = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-team-seasons-2026-27.json"), "utf8")).teams).map(([t, rows]) => [t, Object.fromEntries(rows.map(([sn, w, l]) => [sn, `${w}-${l}`]))]));
    const seasonOfD = (d) => { const y = Number(d.slice(0, 4)) - (Number(d.slice(5, 7)) >= 8 && !(d >= "2020-07-01" && d <= "2020-10-31") ? 0 : 1); return `${y}-${String(y + 1).slice(2)}`; };
    const right = {};
    for (const [t, gs] of Object.entries(GGm.teams)) {
      const by = {};
      for (const g of gs) { const sn = seasonOfD(g[0]); (by[sn] ??= [0, 0])[g[4] ? 0 : 1]++; }
      const from = Object.keys(by).sort()[0], all = Object.keys(TSn[t]).filter((sn) => sn >= from);
      right[t] = `${all.filter((sn) => by[sn] && by[sn].join("-") === TSn[t][sn]).length}/${all.length}/${gs.length}`;
    }
    const lalBos = GGm.teams.LAL.filter((g) => g[2] === "BOS"), first = GGm.teams.LAL[0];
    const nT = Object.keys(GGm.teams).length, nG = Object.values(GGm.teams).reduce((n, gs) => n + gs.length, 0), part = (t) => right[t].split("/").slice(0, 2).join("/");
    ok(nT === 24 && nG === 97819 && GGm.teams.MIL.some((g) => g[0] === "2001-03-25" && g[2] === "ATL" && g[4] === 1) && GGm.teams.WAS.some((g) => g[0] === "2021-04-09" && g[2] === "GSW" && g[4] === 1) && GGm.teams.WAS.some((g) => g[0] === "2015-02-24" && g[2] === "GSW" && g[4] === 0) && GGm.teams.WAS.some((g) => g[0] === "2015-02-22" && g[4] === 0) && GGm.teams.ATL.some((g) => g[0] === "1974-03-01" && g[4] === 1 && g[5] === 105) && GGm.teams.ATL.some((g) => g[0] === "1974-01-13" && g[4] === 0) && GGm.teams.CHA.some((g) => g[0] === "1993-03-26" && g[6] === 115) && GGm.teams.MIL.filter((g) => g[0] >= "1969-10-01" && g[0] < "1970-04-01").length === 82 && GGm.teams.MIL.filter((g) => g[0] >= "1969-10-01" && g[0] < "1970-04-01" && g[4]).length === 56 && GGm.teams.MIL.some((g) => g[0] === "1970-03-15" && g[2] === "CHI" && g[3] === "N") && part("CLE") === "49/56" && GGm.teams.CLE[0][0] === "1970-10-14" && GGm.teams.MIA.some((g) => g[0] === "1991-02-22" && g[4] === 0) && GGm.teams.PHX.some((g) => g[0] === "1969-01-29" && g[3] === "N" && g[2] === "MIL")
      && GGm.teams.POR.some((g) => g[0] === "1997-03-05" && g[4] === 1 && g[5] === 121) && GGm.teams.ATL.some((g) => g[0] === "1988-11-21" && g[2] === "HOU") && !GGm.teams.LAC.some((g) => g[0] === "1992-04-08") && GGm.teams.LAC.some((g) => g[0] === "1982-04-08" && g[2] === "OKC") && part("SAC") === "65/78" && part("PHI") === "63/77" && part("DEN") === "33/50" && part("BKN") === "49/50" && part("UTA") === "44/52" && part("MIN") === "27/37"
      && GGm.teams.SAC[0][0].startsWith("1948-11") && GGm.teams.BOS.some((g) => g[0] === "1969-11-15" && g[2] === "NYK" && g[3] === "A" && g[4] === 0 && g[5] === 98 && g[6] === 113)
      && GGm.teams.DET.some((g) => g[0].startsWith("1999-") && g[2] === "NYK") && GGm.teams.PHX.some((g) => g[0] === "1968-11-14" && g[2] === "DET" && g[3] === "N")
      && GGm.teams.IND.every((g) => g[0] < "1976-10-01" || g[2]) && !GGm.teams.NYK && !GGm.teams.HOU,
      "guide games (0.87, 0.92, 0.93, 0.94): 24 guides, 97,819 games (0.93: the Bucks' 1969-70, 82 games, 56-26, from Basketball Reference; 0.94: a Bucks date printed '325', the Wizards' postponed rows and a record misprinted '33-33' read right, and five results the guides print wrong corrected from box scores and the other team's guide: Charlotte 107-115 at Detroit 3/26/93, four on the Hawks' 1973-74 page); 0.92 adds Cleveland's picture pages read by OCR (49 of 56 seasons add up on their own) and the rows the user's screenshots of 11/17 showed the text had lost or garbled (two Heat games of 1990-91, two Suns games of 1968-69 in Tucson, a Blazers score, a Hawks date, a Clippers year); a third-site game is neutral; New York and Houston print none",
      JSON.stringify([nT, nG, right]));
    ok(right.LAL === "78/78/6168" && right.GSW === "64/64/5164" && right.MIL === "56/58/4686" && right.WAS === "60/65/5246" && lalBos.filter((g) => g[4]).length === 135 && lalBos.length === 304
      && first[0] === "1948-11-04" && first[1] === "Baltimore" && first[2] === null && first[3] === "A" && first[4] === 1 && first[5] === 84 && first[6] === 72
      && GGm.teams.GSW.some((g) => g[0] === "1962-10-27" && g[1] === "Chicago" && g[2] === "WAS" && g[3] === "A") && GGm.teams.MIL.some((g) => g[0] === "1968-10-19" && g[2] === "ATL"),
      "guide games (0.85): 21,181 games from four guides' season lists; every Lakers season since 1948-49 and every Warriors season since 1962-63 adds up to the franchise's record; a city is mapped to the franchise of that season (Chicago in 1962 is the Zephyrs, now Washington; the 1948 Baltimore Bullets are no one)",
      JSON.stringify(right));
  }
  // Through matchups(): the series line arrives with the others.
  const { matchups: mu } = await import("../src/records/matchup.js");
  const MU = mu({ history: { games: [] }, logs: null, teamFiles: {}, tonight: [{ id: "g", away: "LAL", home: "BOS" }], today: "2026-11-17", series: SR });
  ok(MU[0].items.some((i) => /^All-time: the Lakers lead the Celtics 100-99/.test(i.text)) && !mu({ history: { games: [] }, logs: null, teamFiles: {}, tonight: [{ id: "g", away: "LAL", home: "BOS" }], today: "2026-11-17" })[0].items.length,
    "matchups (0.84): the all-time series joins tonight's matchup items when the guides' file is there");
  ok(/g\.items\.slice\(12\)\.filter\(\(i\) => i\.series \|\| i\.edge\)/.test(fs.readFileSync(path.join(root, "scripts", "situations.js"), "utf8")),
    "matchups (0.85.1): the all-time series line survives the twelve-item cut (NYK @ TOR on 11/17 had lost it)");
  const rcd = fs.readFileSync(path.join(root, "docs", "records.html"), "utf8");
  ok(/const ALL30 = \[/.test(rcd) && /\(no one on pace\)/.test(rcd) && /Every team's season records are on file/.test(rcd),
    "Records (0.85; the user, 11/17: \"teams are missing\" from the drop-down): the on-pace table's team list has all 30 teams and says when a team has no one on pace");
  const ix = fs.readFileSync(path.join(root, "docs", "find.html"), "utf8");
  ok(/get\("series\.json"\)/.test(ix) && /t-series/.test(ix) && /both guides agree/.test(ix) && /not all-time/.test(ix) && /last season added from our results/.test(ix), "Index (0.84): the all-time series lookup, with the basis of each row");
}

// ---------- 0.141.15: lines from the backtest (minutes behind a run, measured rarity, team runs ended) ----------
{
  const P = await import("../src/anticipate/prep.js"), Tr = await import("../src/situations/trends.js");
  const G = (mins) => mins.map((min, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, min, pts: 20 }));
  ok(P.minutesClause(G([30, 31, 29, 30, 36, 37, 35]), 3) === " (with more minutes: 36 a game in the run, 30 before it)"
    && P.minutesClause(G([34, 35, 33, 34, 34, 35]), 2) === " (on his usual minutes, 34.5 a game)"
    && P.minutesClause(G([36, 36, 36, 30, 31]), 2) === " (on fewer minutes: 30.5 a game in the run, 36 before it)"
    && P.minutesClause(G([30, 36, 37]), 2) === "",
    "prep (0.141.15): a run says whether it came with more minutes, fewer, or his usual (nothing without 3 games before it)");
  // Team runs: BOS won 6 straight and lost last night; NYK lost 5 and won; MIA won 2 and won again (nothing).
  const rowsE = []; let id = 0;
  const day = (k) => `2026-11-${String(k).padStart(2, "0")}`;
  for (let k = 1; k <= 6; k++) rowsE.push({ id: ++id, d: day(k), h: "BOS", a: `X${k}`, hs: 110, as: 100 });
  for (let k = 1; k <= 5; k++) rowsE.push({ id: ++id, d: day(k), h: "NYK", a: `Y${k}`, hs: 90, as: 100 });
  rowsE.push({ id: ++id, d: day(1), h: "MIA", a: "Z1", hs: 100, as: 90 }, { id: ++id, d: day(5), h: "MIA", a: "Z2", hs: 100, as: 90 });
  rowsE.push({ id: ++id, d: day(7), h: "CHI", a: "BOS", hs: 101, as: 99 }, { id: ++id, d: day(7), h: "NYK", a: "MIA", hs: 104, as: 98 });
  const TE = P.teamEndedLines({ rows: rowsE });
  const bos = TE.find((l) => l.team === "BOS"), nyk = TE.find((l) => l.team === "NYK");
  ok(TE.length === 2 && bos && bos.text === "BOS's 6-game winning streak (the NBA's longest active winning streak) ended 11/7: lost at CHI 99-101"
    && nyk && nyk.text === "NYK ended a 5-game losing streak (the NBA's longest active losing streak) 11/7: beat MIA 104-98" && bos.kind === "broken" && !TE.some((l) => l.team === "MIA"),
    "prep (0.141.15): a team's 5+ game run that ended last night is said, with whether it was the league's longest", JSON.stringify(TE.map((l) => l.text)));
  // Measured rarity: a 2.5-spread points night is far commoner than a 2.5-spread blocks night, and the list leads with the rarer.
  const tails = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "outlier-tails.json"), "utf8"));
  const sP = Tr.noteShare({ stat: "pts", z: 2.5 }, tails), sB = Tr.noteShare({ stat: "blk", z: 2.5 }, tails), sMid = Tr.noteShare({ stat: "pts", z: 2.625 }, tails);
  const pgR = { p: Array.from({ length: 10 }, (_, i) => ({ d: day(i + 1), team: "A", opp: "B", min: 30, pts: i === 9 ? 34 : 18 + (i % 3), reb: 5, ast: 4, fg3m: 2, stl: 1, blk: 0, fgm: 7, fga: 15, fg3a: 5 })),
    b: Array.from({ length: 10 }, (_, i) => ({ d: day(i + 1), team: "C", opp: "D", min: 30, pts: 12, reb: 6, ast: 2, fg3m: 1, stl: 1, blk: i === 9 ? 5 : i % 2, fgm: 5, fga: 10, fg3a: 3 })) };
  const AR = Tr.anomalies(pgR, { p: "Points Guy", b: "Block Guy" }, { dates: [day(10)], tails });
  ok(tails.playerGames > 50000 && sP > 0.02 && sP < 0.04 && sB < sP / 2 && sMid < sP && sMid > Tr.noteShare({ stat: "pts", z: 2.75 }, tails) && Tr.oneIn(0.0285) === 35
    && AR.length === 2 && AR.every((a) => a.oneIn > 0 && a.notes.some((n) => n.oneIn)) && AR[0].share <= AR[1].share,
    "outliers (0.141.15): each night carries how often a night that far out happens (1 in N player-games, measured), rarest first",
    JSON.stringify({ sP, sB, AR: AR.map((a) => [a.name, a.oneIn, a.score]) }));
}

// ---------- 0.141.15: streaks the game notes were following, ended last night ----------
{
  const P = await import("../src/anticipate/prep.js");
  const day = (k) => `2026-11-${String(k).padStart(2, "0")}`;
  const ln = (k, o) => ({ d: day(k), team: "NYK", opp: "X", min: 34, pts: 20, reb: 11, ast: 3, stl: 1, blk: 1, fg3m: 1, fg3a: 4, starter: 1, ...o });
  // Double-doubles in games 1-11, then 12 points and 8 rebounds on 11/12. The notes (first seen 11/10) had it at nine.
  const pgN = { t: [...Array.from({ length: 11 }, (_, i) => ln(i + 1)), ln(12, { pts: 12, reb: 8 })], o: [ln(1), ln(12)] };
  const factsN = { teams: { NYK: [{ text: "Towns has recorded a double-double in nine straight games to start the season, tied for the second-longest such run.", player: "Karl-Anthony Towns", playerId: "t", firstSeen: day(10) }] } };
  const L1 = P.notesEndedLines({ pg: pgN, names: { t: "Karl-Anthony Towns" }, notesFacts: factsN });
  // A note that said seven (first seen 11/10): eleven is more than seven plus the two games since and one of slack, so a
  // run that long isn't the one the notes meant.
  const L2 = P.notesEndedLines({ pg: pgN, names: { t: "Karl-Anthony Towns" }, notesFacts: { teams: { NYK: [{ ...factsN.teams.NYK[0], text: "Towns has recorded a double-double in seven straight games." }] } } });
  const parsed = [P.noteStreak("Daniel Gafford recorded a block vs. BKN (11/8/26), his 10th consecutive game with a block."), P.noteStreak("Dished out 5+ assists in 13 straight games (10/23 - 11/19)"),
    P.noteStreak("The Mavericks have won 11 consecutive home games against Utah."), P.noteStreak("first 76er to make at least five three-pointers off the bench in three consecutive games"), P.noteStreak("Javon Small posted his first career double-double with 12 points and 12 assists")];
  ok(L1.length === 1 && L1[0].text === "Karl-Anthony Towns's run of 11 straight games with a double-double ended 11/12 (12 points, 8 rebounds, 3 assists): a streak in the NYK game notes"
    && !L1[0].text.includes("second-longest") && L2.length === 0
    // "to start the season", every game he has played: credited however stale the notes' count (the note said nine, first seen 11/11).
    && P.notesEndedLines({ pg: pgN, names: { t: "Karl-Anthony Towns" }, notesFacts: { teams: { NYK: [{ ...factsN.teams.NYK[0], firstSeen: day(11) }] } } }).length === 1
    && P.notesEndedLines({ pg: pgN, names: { t: "Karl-Anthony Towns" }, notesFacts: { teams: { NYK: [{ ...factsN.teams.NYK[0], text: "Towns has recorded a double-double in seven straight games to start the season.", firstSeen: day(11) }] } } }).length === 1
    && parsed[0]?.n === 10 && JSON.stringify(parsed[0].tests) === '[{"k":"blk","min":1}]' && parsed[1]?.n === 13 && parsed[1].tests[0].min === 5 && parsed.slice(2).every((x) => x === null),
    "prep (0.141.15): a streak the game notes were following, ended last night, counted from the box scores (no notes text copied; an older run isn't credited)", JSON.stringify({ L1: L1.map((l) => l.text), L2: L2.length, parsed }));
}

// ---------- 0.141.17: rare combinations for NBA Live (src/situations/linerare.js) ----------
{
  const zlib = await import("node:zlib"), LR = await import("../src/situations/linerare.js");
  const A = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "src", "data", "line-rarity-archive.json.gz"))));
  const D = LR.buildRare({ hist: A.hist, top: A.top, rows: [] });
  const t = (l) => LR.liveRare(D, { fg3m: 0, stl: 0, blk: 0, fga: 30, ...l });
  const wemb = t({ pts: 52, reb: 24, ast: 2, stl: 2, blk: 2 }), bam = t({ pts: 83, reb: 9, ast: 3, fg3m: 7, stl: 2, blk: 2, fga: 43 }), trivial = t({ pts: 50, reb: 23, ast: 2, blk: 1, fga: 28 });
  // The boundary is exact: a brute-force count over the archive's histogram for a few lines equals the list count.
  const brute = (c, v) => A.hist[c].reduce((n, [x, y, z, k]) => n + (x >= v[0] && y >= v[1] && z >= v[2] ? k : 0), 0);
  const probes = [["pra", [52, 24, 0]], ["pra", [50, 23, 0]], ["pra", [34, 19, 13]], ["rbp", [9, 9, 40]], ["p3a", [52, 8, 10]], ["pra", [40, 10, 10]]];
  const exact = probes.every(([c, v]) => { const keys = LR.COMBOS.find((x) => x.id === c).keys, l = Object.fromEntries(keys.map((k, i) => [k, v[i]])); const w = LR.pastCount(D, c, l), b = brute(c, v); return b <= LR.RARE_MAX ? w && w.length === b : w === null; });
  ok(fs.readFileSync(path.join(root, "src", "situations", "linerare.js"), "utf8") === fs.readFileSync(path.join(root, "docs", "lib", "situations", "linerare.js"), "utf8")
    && A.games === 38949 && A.first === "1993-11-05" && A.cupTitleGamesLeftOut === 3
    && wemb.hits[0]?.line === "52 points and 24 rebounds" && wemb.hits[0].n === 0 && !bam.hits.length && trivial.hits[0]?.line === "50 points and 23 rebounds" && exact,
    "rare combinations (0.141.17): the bridge's copy is the build's; 38,949 games since 1993-94 (0.149.0: every regular-season game, All-Star games and Cup title games out); 52 and 24 is no one else's; an 83-point night is the single-game lists' card, not this one; a trivial qualifier (1 block) is never what makes a line rare; the boundary equals a brute-force count",
    JSON.stringify({ wemb: wemb.hits[0], bam: bam.hits, trivial: trivial.hits[0], exact }));
}

// ---------- 0.142: all-time points to the top 100, career feat boards, live streaks ----------
{
  const N = await import("../src/records/notable.js");
  ok(N.worthPlace("nba", "pts", 50) && !N.worthPlace("nba", "pts", 51) && N.worthPlace("nba", "pts", 100, { site: true }) && !N.worthPlace("nba", "pts", 101, { site: true }) && !N.worthPlace("nba", "reb", 26)
    && N.tierEntered("pts", 101, 100) === 100 && N.tierEntered("pts", 101, 74) === 75 && N.tierEntered("pts", 76, 75) === 75 && N.tierEntered("pts", 75, 74) === null && N.tierEntered("pts", null, 99) === 100 && N.tierEntered("reb", 30, 25) === null
    && N.isSiteOnlyPass({ kind: "pass", stat: "pts", rank: 80 }) && !N.isSiteOnlyPass({ kind: "pass", stat: "pts", rank: 80, tier: 100 }) && !N.isSiteOnlyPass({ kind: "pass", stat: "pts", rank: 40 })
    && !N.isMinorPass({ kind: "pass", stat: "pts", rank: 80 }) && N.isMinorPass({ kind: "pass", stat: "pts", rank: 101 }) && !N.isMinorPass({ kind: "pass", stat: "pts", rank: 100, tier: 100 })
    && N.isSiteOnlyPass({ kind: "pass", scope: "nba", stat: "pts", passing: { rank: 60 } }),
    "points (0.142, the user 11/21): a live card to 50th, a site line to 100th, and entering the top 100/75/50/25 from below is a card wherever it lands; the other stats keep their rule");
  // The guide: the deeper list and active totals make the points list complete to its floor; only the pass that crosses a tier enters it.
  const { currentRecords } = await import("../src/records/guide.js");
  const tf = { AAA: { keys: ["min", "pts"], names: { "9": "Climber Guy" }, games: Array.from({ length: 10 }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, opp: "BBB", home: true, pf: 100, pa: 90, pl: { "9": [30, 30] } })) } };
  const tag = (i) => `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}x`;   // names, not numbers (names match without digits)
  const scorers = Array.from({ length: 70 }, (_, i) => ({ rank: i + 1, name: `Old Scorer ${tag(i)}`, pts: 40000 - i * 300 }));
  const deep = { asOf: "2026-11-01", floor: 17000, rows: Array.from({ length: 30 }, (_, i) => ({ name: `Deep Guy ${tag(i)}`, pts: 19190 - i * 40 })) };   // ranks 71-100
  const R = currentRecords({ guide: {}, teamFiles: tf, today: "2026-11-11", tonight: [{ home: "AAA", away: "BBB" }], scorers, deepPoints: deep, activeTotals: [{ name: "Climber Guy", stat: "pts", value: 17720 }] });
  const me = R.boards.pts.find((r) => r.name === "Climber Guy"), mine = R.items.filter((i) => i.kind === "pass" && i.who === "Climber Guy");
  ok(me?.now === 18020 && me.rank === 101 && mine.length === 3 && JSON.stringify(mine.map((i) => [i.rank, i.tier || null, !!i.siteOnly, !!i.minor])) === "[[100,100,false,false],[99,null,true,false],[98,null,true,false]]"
    && /for 100th all-time, into the top 100$/.test(mine[0].text),
    "points (0.142): ranks run past the Guide's 68 with the deeper list and every active total; a tier is tagged once, on the crossing pass", JSON.stringify({ me, mine: mine.map((i) => [i.text, i.tier]) }));
  // Feat boards: the rules, and the build's counts on top of the screenshot's.
  const F = await import("../src/records/featlive.js"), FB = await import("../src/records/featboards.js");
  const b = { label: "30-point, 10-rebound, 5-assist games", one: "30-10-5 game", min: { pts: 30, reb: 10, ast: 5 }, rows: [{ name: "Leader", now: 164 }, { name: "Tied Man", now: 135 }, { name: "Me", now: 135 }] };
  const td = { label: "30-point triple-doubles", one: "30-point triple-double", min: { pts: 30 }, td: true, rows: [{ name: "Top", now: 106 }, { name: "Me", now: 59 }] };
  ok(F.featNext(b, b.rows[2])?.line === "Me: his next 30-10-5 game would be his 136th, passing Tied Man (135) for 2nd all-time" && F.featNext(td, td.rows[1]) === null
    && F.featNext(b, b.rows[0]).what === "adding to his NBA record (Tied Man is next with 135)"
    && JSON.stringify(F.shortOf(td, { pts: 31, reb: 12, ast: 8 })) === '[["ast",2]]' && F.shortOf({ min: { reb: 10, ast: 10 }, max: { pts: 9 } }, { pts: 10, reb: 9, ast: 9 }) === null
    && F.featLive(b, "Me", 135, { pts: 24, reb: 11, ast: 6 }) === null && F.featLive(b, "Me", 135, { pts: 28, reb: 11, ast: 6 }).warn.k === "pts" && F.featLive(b, "Me", 135, { pts: 30, reb: 10, ast: 5 }).hit.place === 2
    && F.streakMet(["dd"], { pts: 10, reb: 10 }) && !F.streakMet(["start"], { starter: 0 }) && F.shortText(F.streakShort([{ k: "ast", min: 5 }], { ast: 3 })) === "2 assists",
    "feat boards (0.142): his next one is said only when it passes or ties a name or adds to his record; on the verge is one stat a step short; a ceiling broken can't be met");
  const pg = { p1: [{ d: "2026-11-05", gameId: "g1", team: "AAA", opp: "BBB", home: true, pts: 31, reb: 11, ast: 6, starter: 1 }, { d: "2026-11-10", gameId: "g2", team: "AAA", opp: "CCC", home: false, pts: 33, reb: 12, ast: 7, starter: 1 },
    { d: "2026-11-12", gameId: "g3", team: "AAA", opp: "BBB", home: true, pts: 20, reb: 12, ast: 9, starter: 1 }],
    p2: [{ d: "2026-11-12", gameId: "g3", team: "BBB", opp: "AAA", home: false, pts: 90, reb: 0, ast: 0, starter: 1 }] };
  const file = { asOf: "2026-11-08", source: "test", boards: { b: { label: b.label, one: b.one, min: b.min, rows: [["Leader", "1960-61", "1970-71", 164], ["Tied Man", "2003-04", "2024-25", 135], ["Me Player", "2016-17", "2026-27", 134]] } },
    streaks: { fg3: { label: "a made three", min: { fg3m: 1 }, since: "1967-68", rows: [] } } };
  const out = FB.buildFeatLive({ file, pg, names: { p1: "Me Player", p2: "Them" }, tonightTeams: new Set(["AAA"]),
    notesFacts: { teams: { AAA: [{ text: "The Aces have won 11 consecutive home games against the Bees.", playerId: null, firstSeen: "2026-11-11" }, { text: "Me Player has recorded a double-double in three straight games to start the season.", playerId: "p1", firstSeen: "2026-11-11" }] } } });
  const row = out.boards.b.rows.find((r) => r.name === "Me Player");
  ok(row.now === 135 && row.base === 134 && JSON.stringify(row.games) === '["g2"]' && out.pre[0]?.line === "Me Player: his next 30-10-5 game would be his 136th, passing Tied Man (135) for 2nd all-time (2 of his 3 games this season)"
    && !out.streaks.length && !out.teamStreaks.length && out.teamEnded.length === 0 && !out.problems.length
    && FB.teamStreakOf("The Mavericks have won 11 consecutive home games against Utah.", "DAL")?.opp === "UTA" && FB.teamStreakOf("In defeating Portland 106-105 on Nov. 17, the Wolves have now won 33 consecutive games when holding opponents to 105 points or fewer.", "MIN")?.asOf === "11-17",
    "feat boards (0.142): the screenshot's count plus his qualifying games after its date (named, so NBA Live can't count tonight twice); a three-game run the notes name is no longer followed live (0.166.0: runs are weighed by their bar); a team's home run over one opponent waits for a home game against it",
    JSON.stringify({ row, pre: out.pre, streaks: out.streaks, team: out.teamStreaks, problems: out.problems }));
  // The real file: every board's count and filter agree with our box scores this season (its own consistency check), through 11/19.
  const real = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "feat-boards-2026-11-21.json"), "utf8"));
  ok(real.asOf === "2026-11-19" && Object.values(real.boards).every((x) => x.one && x.rows.every((r) => r.length === 4 && r[3] > 0) && x.rows.every((r, i, a) => !i || a[i - 1][3] >= r[3])),
    "feat boards (0.142): the transcribed boards are sorted, complete rows, each with a one-game name; counts through 11/19 (Basketball-Reference hadn't added 11/20)");
}

// ---------- 0.142.6: consecutive games played, from the box scores (the user, 11/23, San Antonio's table) ----------
{
  const { walkStreak, appeared } = await import("../src/records/gpstreak.js"), { gamesPlayedRuns } = await import("../src/records/featboards.js");
  const tg = { "AAA|s1": [{ d: "1", gid: "a1" }, { d: "2", gid: "a2" }, { d: "3", gid: "a3" }, { d: "4", gid: "a4" }], "BBB|s1": [{ d: "2", gid: "b2" }, { d: "3", gid: "b3" }, { d: "5", gid: "b5" }, { d: "6", gid: "b6" }],
    "BBB|s2": [{ d: "7", gid: "b7" }, { d: "8", gid: "b8" }] };
  const traded = [{ d: "1", gid: "a1", team: "AAA", season: "s1" }, { d: "2", gid: "a2", team: "AAA", season: "s1" }, { d: "5", gid: "b5", team: "BBB", season: "s1" }, { d: "6", gid: "b6", team: "BBB", season: "s1" }, { d: "7", gid: "b7", team: "BBB", season: "s2" }, { d: "8", gid: "b8", team: "BBB", season: "s2" }];
  const sat = [{ d: "1", gid: "a1", team: "AAA", season: "s1" }, { d: "3", gid: "a3", team: "AAA", season: "s1" }, { d: "4", gid: "a4", team: "AAA", season: "s1" }];
  const summer = [{ d: "1", gid: "a1", team: "AAA", season: "s1" }, { d: "2", gid: "a2", team: "AAA", season: "s1" }, { d: "7", gid: "b7", team: "BBB", season: "s2" }, { d: "8", gid: "b8", team: "BBB", season: "s2" }];
  ok(walkStreak(traded, tg).n === 6 && walkStreak(sat, tg).n === 2 && walkStreak(sat, tg).broke === "2" && walkStreak(summer, tg).n === 2 && walkStreak(summer, tg, { start: 50 }).n === 2
    && walkStreak([{ d: "7", gid: "b7", team: "BBB", season: "s2" }, { d: "8", gid: "b8", team: "BBB", season: "s2" }], tg, { start: 600 }).n === 602
    && appeared(1, 0, [0, 0, 1]) && appeared(0, 3, []) && !appeared(0, 0, [0, 0, 0]),
    "games played (0.142.6): a trade in the season doesn't break a run, a missed game does, his team's last games of a season count (a summer move after sitting them out ends it), a run carries into the next season; a start with 0 minutes counts");
  const base = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "games-played-streaks-2025-26.json"), "utf8"));
  const top = Object.fromEntries(base.rows.slice(0, 20).map((r) => [r[1], r[2]]));
  ok(top["Mikal Bridges"] === 638 && top["Julian Champagnie"] === 185 && top["Kris Dunn"] === 96 && base.rows.find((r) => r[1] === "Jared McCain")?.[2] === 37 && base.through === "2025-26",
    "games played (0.142.7): at the end of 2025-26, Bridges 638 (every game since his debut, which he played at 0 minutes: Basketball-Reference's 655 through 11/22), Champagnie 185, Dunn 96");
  const games = [{ id: "g1", d: "2026-10-21", h: "NYK", a: "BOS", hs: 100, as: 90, pl: { "3147657": [0, 1, 30, 10], "x": [1, 0, 0, 0] } }, { id: "g2", d: "2026-10-23", h: "NYK", a: "MIA", hs: 100, as: 90, pl: { "3147657": [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] } }];
  const runs = gamesPlayedRuns(games, base, "2026-27");
  ok(runs[0]?.id === "3147657" && runs[0].n === 640 && runs[0].rank === 1, "games played (0.142.6): last season's run carried through this season's games", JSON.stringify(runs.slice(0, 2)));
  // 0.142.7: in for a few seconds, 0 minutes, nothing in the box (ESPN gives him a line, not a DNP) is a game played.
  const { setZero } = await import("../src/situations/results.js"), { readPlayerBox } = await import("../src/espn/parse.js");
  const pb = readPlayerBox({ boxscore: { players: [{ team: { id: "1" }, statistics: [{ keys: ["minutes", "points", "plusMinus"], athletes: [
    { athlete: { id: "z1", displayName: "Zero" }, starter: false, stats: ["0", "0", "0"] }, { athlete: { id: "d1", displayName: "Dnp" }, didNotPlay: true, stats: [] },
    { athlete: { id: "p1", displayName: "Played" }, stats: ["12", "4", "+2"] }] }] }] } }, "1");
  const row = {}; setZero(row, pb);
  const late = [{ id: "g3", d: "2026-10-25", h: "NYK", a: "ORL", hs: 100, as: 90, pl: { "3147657": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } }];
  const noZ = gamesPlayedRuns([...games, ...late], base, "2026-27"), withZ = gamesPlayedRuns([...games, { ...late[0], z: ["3147657"] }], base, "2026-27"),
    fromFile = gamesPlayedRuns([...games, ...late], base, "2026-27", { rows: [["g3", "2026-10-25", "NYK", "3147657", "Mikal Bridges"]] });
  ok(pb.z1.zero && !pb.d1.zero && !pb.p1.zero && JSON.stringify(row.z) === '["z1"]' && appeared(0, 0, [0, 0, -1]) && appeared(0, 0, [], true)
    && !noZ.some((r) => r.id === "3147657") && withZ[0].n === 641 && fromFile[0].n === 641,
    "games played (0.142.7): a 0-minute line that isn't a DNP is kept in the store (z) and counts, from the store or the backfill file; a minus plus-minus is a stat");
  const zf = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "zero-minute-games-2026-27.json"), "utf8"));
  ok(zf.rows.length === 17 && zf.rows.some((r) => r[4] === "Josh Minott" && r[1] === "2026-11-02"), "games played (0.142.7): this season's 0-minute games through 11/22, read from ESPN's summaries");
  // 0.145.0 (the consistency audit, 11/24: AJ Green 17 games on the award page, 16 everywhere else): the few-seconds game counts
  // on every page: the per-player games (streaks, form, finds), the team files' readers (with/without, national TV, rest).
  {
    const { roster } = await import("../src/situations/withwithout.js");
    const zrows = [{ id: "a", d: "2026-11-21", h: "MIL", a: "PHI", hs: 100, as: 90, pl: { "4397475": [0, 0, 12, 9, 3, 6, 3, 5, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 2] } },
      { id: "b", d: "2026-11-23", h: "TOR", a: "MIL", hs: 111, as: 116, z: ["4397475"], pl: { "4397475": [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } },
      { id: "c", d: "2026-11-24", h: "MIL", a: "BOS", hs: 100, as: 90, pl: { "4397475": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } }];
    const pgz = playerGames(zrows)["4397475"];
    const file = { names: { "4397475": "AJ Green" }, games: [{ d: "2026-11-21", pl: { "4397475": [0, 12] } }, { d: "2026-11-23", z: ["4397475"], pl: { "4397475": [0, 0] } }, { d: "2026-11-24", pl: { "4397475": [0, 0] } }] };
    const ro = Object.fromEntries(roster({ ...file, keys: ["starter", "min"] }).map((p) => [p.id, p]));
    const streak = activeStreaks({ "4397475": pgz }, { "4397475": "AJ Green" }).find((s) => s.key === "three");
    ok(pgz.length === 2 && pgz[1].cameo === 1 && pgz[1].min === 0 && ro["4397475"].gp === 2 && !streak,
      "0.145.0: a few-seconds game (z) is a game played in the per-player games and the team files; a DNP (no z) isn't; a cameo with no three ends a made-three run",
      JSON.stringify({ pgz, gp: ro["4397475"]?.gp, streak }));
  }
}

// ---------- 0.144.0: award eligibility, the 65-game rule (the user, 11/23: "we'll need a countdown for players who are tracking for awards who may not be eligible because of the games played rule") ----------
{
  const { classify, eligibility, eligibilityLines, awardStakes, reasonKind } = await import("../src/situations/eligibility.js");
  const c = (m, s) => { const r = classify(m, s); return `${r.kind}/${r.how}`; };
  ok(c(21) === "full/box" && c(19) === "short/box" && c(16) === "short/box" && c(14) === "under/box" && c(20, 1185) === "short/pbp" && c(20, 1200) === "full/pbp" && c(20) === "full/check"
    && c(20, null) === "full/check" && c(20, 1300) === "full/check" && c(15, 890) === "under/pbp" && c(15, 905) === "short/pbp" && c(15) === "short/check",
    "award eligibility (0.144.0): ESPN rounds minutes, so its 20s and 15s are settled by play-by-play seconds (19:45 is not 20 minutes); a rebuilt total more than half a minute off ESPN's isn't used, and the game stays to check");
  // AAA and BBB play each other 20 times; CCC plays DDD 15 times. X: 3 full, 17-18-16 (two count), an ESPN 20 that was 19:50 (a fourth short game),
  // an ESPN 20 that was 20:10, a 0-minute appearance, then out (injury report: 5 nights listed, the rest not). Y: 2 games then gone. Z: traded AAA -> CCC.
  const day = (i) => `2026-11-${String(i).padStart(2, "0")}`;
  const rows = [];
  const mins = { X: [25, 25, 25, 17, 18, 16, 20, 20, 0], Y: [30, 30] };
  for (let i = 1; i <= 20; i++) {
    const pl = { B1: [1, 1, 30] };
    if (mins.X[i - 1] != null) pl.X = [0, 1, mins.X[i - 1]];
    if (mins.Y[i - 1] != null) pl.Y = [0, 1, mins.Y[i - 1]];
    if (i <= 10) pl.Z = [0, 1, 30];
    rows.push({ id: `g${i}`, d: day(i), h: "AAA", a: "BBB", pl, ...(i === 9 ? { z: ["X"] } : {}) });
    if (i >= 6) rows.push({ id: `c${i}`, d: day(i), h: "CCC", a: "DDD", pl: { D1: [1, 1, 30], ...(i >= 12 && i <= 16 ? { Z: [0, 1, 28] } : {}) } });
  }
  const seconds = { g7: { X: 1190 }, g8: { X: 1210 } };
  const listings = Object.fromEntries([10, 11, 12, 13, 14].map((i) => [day(i), { AAA: [{ id: "X", status: "Out", reason: "Injury/Illness - Left Ankle Sprain" }] }]));
  const awards = { series: { KXNBA1STTEAM: [{ name: "Ex Player", p: 20 }], KXNBA2NDTEAM: [{ name: "Ex Player", p: 15 }], KXNBAMVP: [{ name: "Wy Playér", p: 5 }], KXNBAROY: [{ name: "Ex Player", p: 50 }] } };
  const E = eligibility({ rows, names: { X: "Ex Player", Y: "Wy Player", Z: "Zed Player" }, current: { Z: { team: "CCC", was: "AAA", since: "2026-11-11" } }, seconds, listings,
    tonight: { date: "2026-11-21", players: [{ team: "AAA", name: "Ex Player", status: "Out", reason: "Injury/Illness - Left Ankle Sprain" }] }, awards, today: "2026-11-21", through: "2026-11-20", seasonEnd: "2027-04-11", tonightTeams: new Set(["AAA"]) });
  const X = E.players.find((p) => p.id === "X"), Y = E.players.find((p) => p.id === "Y"), Z = E.players.find((p) => p.id === "Z");
  ok(X.q === 6 && X.full === 4 && X.short === 4 && X.shortUsed === 2 && X.under === 1 && X.left === 62 && X.need === 59 && X.canMiss === 3 && X.status === "alive" && X.teamGames === 20
    && X.missed.short === 3 && X.missed.injury === 5 && X.missed.unlisted === 6 && X.border.length === 2 && X.border[0].counted === false && X.border[1].counted === true && X.check === 0,
    "award eligibility (0.144.0): 20+ minutes counts, only two games at 15-19 count, an ESPN 20 at 19:50 is a 15-19 game, a 0-minute appearance counts for nothing; 65 needed of 82, so 3 more he can miss; every team game he didn't count in has its reason", JSON.stringify(X));
  ok(Y.status === "out" && Y.outSince === "2026-11-20" && Y.grievanceBy === "2026-11-22" && Y.alt === true && Y.q === 2 && Y.missed.unlisted === 18,
    "award eligibility (0.144.0): 65 goes out of reach the night his team plays its 18th game without him (2 counted + 62 left = 64); the grievance window is the next two days; 62 is still reachable", JSON.stringify(Y));
  ok(Z.team === "CCC" && Z.q === 15 && Z.left === 82 - 15 && Z.canMiss === 67 - 50 && Z.was === "AAA",
    "award eligibility (0.144.0): a traded player's games count across his teams, and what's left is his new team's schedule", JSON.stringify(Z));
  // 0.144.1: a priced player who hasn't played (Jimmy Butler III, out all season) is on the board, from the injury report
  const reports = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [day(i + 1), i < 15 ? [{ team: "AAA", name: "Jimmy Butler III", status: "Out", reason: "Injury/Illness - Right ACL Repair / Surgery" }] : []]));
  const EB = eligibility({ rows, names: {}, reports, awards: { series: { KXNBA3RDTEAM: [{ name: "Jimmy Butler", p: 4 }, { name: "Tie/Co-Winners", p: 1 }], KXNBAMVP: [{ name: "Nobody Listed", p: 2 }] } }, today: "2026-11-21", through: "2026-11-20" });
  const JB = EB.players.find((p) => p.noGames && p.team === "AAA"), NL = EB.players.find((p) => p.name === "Nobody Listed");
  ok(JB && JB.name === "Jimmy Butler III" && JB.q === 0 && JB.teamGames === 20 && JB.left === 62 && JB.status === "out" && JB.outSince === day(18) && JB.alt === true && JB.missed.injury === 15 && JB.missed.unlisted === 5
    && NL && NL.status === "unsigned" && NL.team === null && !EB.players.some((p) => /Tie/.test(p.name)),
    "award eligibility (0.144.1): a player Kalshi prices who hasn't played a game is on the board: his team from the latest injury report listing him, every team game missed, out of reach the night his team played its 18th; Kalshi's tie option isn't a player", JSON.stringify([JB, NL]));
  // 0.144.2: a minute checked against an outside box score wins over our rebuild (Terrence Shannon Jr. 10/21: 19:43, ours 17:27)
  const EC = eligibility({ rows, names: { X: "Ex Player" }, seconds: { g7: { X: null }, g8: { X: 1210 } }, checked: { g7: { X: { sec: 1183 } }, g8: { X: { sec: 1195 } } }, today: "2026-11-21", through: "2026-11-20" });
  const XC = EC.players.find((p) => p.id === "X"), mc = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "minutes-checked.json"), "utf8"));
  ok(XC.check === 0 && XC.border.every((b) => b.how === "ref") && XC.full === 3 && XC.short === 5 && XC.q === 5 && mc["401909091"]["4432847"].sec === 19 * 60 + 43,
    "award eligibility (0.144.2): minutes checked against Basketball-Reference (src/data/minutes-checked.json) are used before the rebuilt seconds and settle a game the rebuild couldn't (Shannon 10/21, 19:43)", JSON.stringify(XC));
  const st = awardStakes(awards);
  ok(st["ex player"].allnba === 35 && !st["ex player"].roy && st["wy player"].mvp === 5 && E.challengeWindow.to === "2027-04-12 11:59 PM ET" && reasonKind("G League - Two-Way") === "gleague" && reasonKind("Not With Team") === "personal",
    "award eligibility (0.144.0): Kalshi's All-NBA teams add up (a player makes one), names match without accents, Rookie of the Year isn't a covered award; the challenge window runs to 11:59 PM ET the day after the season ends");
  const L = eligibilityLines({ ...E, today: "2026-11-21" }, new Set(["AAA"]), "2026-11-21");
  const LX = L.find((l) => l.player === "Ex Player"), LY = L.find((l) => l.player === "Wy Player");
  const E2 = eligibility({ rows, names: { X: "Ex Player", Y: "Wy Player" }, seconds, listings, awards: { series: { KXNBADPOY: [{ name: "Ex Player", p: 9 }], KXNBAMVP: [{ name: "Wy Player", p: 2 }] } }, today: "2026-11-21", through: "2026-11-20" });
  ok(L.length === 2 && /can miss 3 more games and stay award-eligible under the 65-game rule \(6 of his team's 20 games counted, 62 left\) · out tonight \(Left Ankle Sprain\); 2 after tonight/.test(LX.text) && /^Ex Player \(All-NBA\): /.test(LX.text) && !/Kalshi/.test(LX.text)
    && /Wy Player \(MVP\) can no longer reach 65 games: out of award eligibility since 11\/20 \(2 games counted, 62 left\); the 62-game season-ending-injury path is still open/.test(LY.text) && LY.score > LX.score - 1
    && eligibilityLines({ ...E2, today: "2026-11-21" }, new Set(["AAA"]), "2026-11-21").length === 0 && eligibilityLines({ ...E, today: "2026-11-21" }, new Set(["CCC"]), "2026-11-21").length === 0,
    "award eligibility (0.144.0): the Watch List gets a line for a player the market gives a real chance (MVP 3%+, or 10%+ elsewhere) once his margin is 8 games or fewer (with tonight's injury listing), or in the 10 days after 65 went out of reach; a 9% DPOY or 2% MVP price gets none, and nor does a team not playing", JSON.stringify(L));
  const { tonightStorylines } = await import("../src/anticipate/tonight.js");
  const crowd = { watch: { today: "2026-11-21", games: [{ awayTri: "BBB", homeTri: "AAA" }], teams: [] }, trends: { watch: Array.from({ length: 10 }, (_, i) => ({ team: "AAA", text: `AAA line ${i}`, score: 4.5 })) },
    elig: { today: "2026-11-21", lines: [{ ...LX }] }, maxLines: 8 };
  const SL = tonightStorylines(crowd)[0].lines;
  ok(SL.length === 8 && SL.filter((l) => l.kind === "awards").length === 1 && SL.find((l) => l.kind === "awards").siteOnly === true && tonightStorylines({ ...crowd, elig: { today: "2026-11-20", lines: [LX] } })[0].lines.every((l) => l.kind !== "awards"),
    "award eligibility (0.144.0): on a crowded night a game's best award-eligibility line keeps a place among its eight (as club and TV lines do), as a site-only line; a file from another day gives none", JSON.stringify(SL.map((l) => l.kind)));
  const tn = fs.readFileSync(path.join(root, "src", "anticipate", "tonight.js"), "utf8"), kal = fs.readFileSync(path.join(root, "scripts", "kalshi.js"), "utf8"), sj = fs.readFileSync(path.join(root, "scripts", "situations.js"), "utf8");
  const pages = fs.readdirSync(path.join(root, "docs")).filter((f) => f.endsWith(".html") && f !== "awards.html");
  ok(/\.\.\.awardLines\(elig, teams, watch\.today\)\] \};/.test(tn) && /siteOnly: true \}\)\);/.test(tn.slice(tn.indexOf("function awardLines"), tn.indexOf("function awardLines") + 400)) && !/^import .*eligibility/m.test(tn)
    && /history", "kalshi", "awards\.json"/.test(sj) && /eligibility\.json/.test(sj) && /awards\.json/.test(kal) && /KALSHI_SERIES\[e\.series_ticker\]/.test(kal)
    && pages.every((f) => fs.readFileSync(path.join(root, "docs", f), "utf8").includes('href="awards.html"')),
    "award eligibility (0.144.0): the lines are site-only (Watch List and the Discord digest, never an NBA Live card) and survive an Out listing; Kalshi's award prices are saved by the hourly read; every page links the new tab", pages.filter((f) => !fs.readFileSync(path.join(root, "docs", f), "utf8").includes('href="awards.html"')).join(","));
}
// ---------- 0.143.0: NBA fines and suspensions from pr.nba.com (the user, 11/23: "a database of fines and career totals for each player") ----------
{
  const { parseRelease } = await import("../tools/pr-fines/parse.mjs");
  const one = (t, title = "") => parseRelease(t, title).rows.map((r) => [r.name, r.team, r.kind, r.type, r.amount ?? r.games].join(" "));
  const a = one("NEW YORK – Houston Rockets head coach Ime Udoka, forward Tari Eason and center Alperen Sengun have been fined $50,000, $35,000 and $15,000, respectively, it was announced today. Eason has been fined $35,000 for throwing a towel. Sengun has been fined $15,000 for directing inappropriate language toward a game official.");
  const b = one("NEW YORK – Detroit Pistons forward-center Isaiah Stewart has been suspended seven games for fighting, it was announced today. Additionally, Charlotte Hornets forwards Miles Bridges and Moussa Diabaté have each been suspended four games for fighting and escalating the altercation, and Pistons center Jalen Duren has been suspended two games for initiating the altercation.");
  const c = one("NEW YORK – The NBA announced today that it has fined Golden State Warriors Governor Joe Lacob $50,000 for violating the league’s anti-tampering rule.");
  const d = one("NEW YORK – Michael Gearon, an owner of the Atlanta Hawks, has been fined $35,000 for publicly criticizing NBA officiating.");
  const e = one("NEW YORK – Atlanta Hawks guard Kingston Flemings has been suspended one game without pay for intentionally elbowing New Orleans Pelicans guard Bryce McGowens in the head.");
  ok(JSON.stringify(a) === JSON.stringify(["Ime Udoka HOU coach fine 50000", "Tari Eason HOU player fine 35000", "Alperen Sengun HOU player fine 15000"])
    && JSON.stringify(b) === JSON.stringify(["Isaiah Stewart DET player suspension 7", "Miles Bridges CHA player suspension 4", "Moussa Diabaté CHA player suspension 4", "Jalen Duren DET player suspension 2"])
    && c[0] === "Joe Lacob GSW executive fine 50000" && d[0] === "Michael Gearon ATL executive fine 35000" && e.length === 1 && e[0] === "Kingston Flemings ATL player suspension 1",
    "fines (0.143.0): a release's penalties, each to its own person: \"respectively\" amounts, a shared team, \"Additionally,\", the older \"has fined X $N\" and \"Name, an owner of\", never the player he hit", JSON.stringify([a, b, c, d, e]));
  const pf = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-penalties-2026-11-23.json"), "utf8"));
  const tot = (n) => pf.rows.filter((r) => r[1] === n).reduce((t, r) => ({ fines: t.fines + (r[4] === "fine"), dollars: t.dollars + (r[5] || 0), games: t.games + (r[6] || 0) }), { fines: 0, dollars: 0, games: 0 });
  const dg = tot("Draymond Green"), ae = tot("Anthony Edwards");
  ok(pf.rows.length === 922 && pf.from === "2009-09-15" && pf.through === "2026-11-16" && dg.games === 20 && dg.fines === 11 && ae.dollars === 500000
    && !pf.rows.some((r) => /^(Additionally|NBA|The)\b/.test(r[1])) && new Set(pf.rows.map((r) => r[9] + r[1] + r[4] + r[5] + r[6])).size === pf.rows.length,
    "fines (0.143.0): 922 penalties, 9/15/2009 to 11/16/2026; Draymond Green 11 fines and 20 games suspended (his indefinite one was 12), Anthony Edwards $500,000; no penalty twice", JSON.stringify({ dg, ae }));
}
// ---------- 0.142.5: last season's facts read as this season's (the user, 11/23: "the number of games played this season does not allow for what is listed") ----------
{
  const { tooBigForSeason } = await import("../src/notes/narrative.js");
  const yes = ["Jalen Johnson continued his breakout season with his 43 double-double, scoring 27 points.", "They’ve notched 21 games with 20+ turnovers.", "Recorded 37 double-doubles, seventh-most in the NBA.",
    "Has 1,013 points this season, fourth in the NBA."];
  const no = ["Has scored 20+ points in an NBA-record 1,286 games.", "Currently holds the third-longest active streak of games played among all players at 174 games.", "The Mavericks secured a 130-93 win.",
    "The Knicks recorded their 14th win by at least 30 points since the start of last season, the most in the NBA.", "He became the fastest Spur to reach 1,500 points, doing so in 105 games.", "Over his last 25 games, he is averaging 30.1 points.",
    "His 12th double-double of the season ties for the team lead.", "Has 640 points this season.", "Has won 33 consecutive games when holding opponents to 105 or fewer."];
  ok(yes.every((s) => tooBigForSeason(s, 15)) && no.every((s) => !tooBigForSeason(s, 15)),
    "notes (0.142.5): a count of games no team has played yet (43 double-doubles, 21 games, 37 double-doubles, 1,013 points with 15 played) isn't this season's; a career, a record, a streak, a stretch, a score, a run since last season are left alone",
    JSON.stringify({ missed: yes.filter((s) => !tooBigForSeason(s, 15)), wrong: no.filter((s) => tooBigForSeason(s, 15)) }));
  const pdf = path.join(root, "samples", "2026-11-23", "pistons.pdf");
  if (fs.existsSync(pdf)) {
    const { readPdf } = await import("../src/notes/pdf-layout.js"), { readHistory } = await import("../src/notes/narrative.js");
    const box = { games: Array.from({ length: 15 }, (_, i) => ({ d: `2026-10-${String(i + 10).padStart(2, "0")}`, pl: {} })), names: {} };
    const dropped = [], h = readHistory(await readPdf(fs.readFileSync(pdf)), [{ id: "4684742", name: "Ausar Thompson" }, { id: "1", name: "Jalen Duren" }], { seasonStart: "2026-10-01", today: "2026-11-23", teamWords: ["Detroit", "Pistons"], oppWords: ["Atlanta", "Hawks"], box, dropped });
    ok(!h.some((x) => /Jalen Johnson|43 double-double|ninth game of the season with at least four-plus steals|21 games with 20\+ turnovers/.test(x.text)) && dropped.filter((d) => d.reason === "last-meeting-old").length >= 10,
      "notes (0.142.5): Detroit's \"LAST MEETING — HAWKS 130, PISTONS 129 – MARCH 25, 2026\" box is last season's game, and none of its Key Notes is read as this season's", JSON.stringify(h.map((x) => x.text.slice(0, 80))));
  }
}

// ---------- 0.142.3: a list limited to a kind of player is a subset (the user, 11/22: "cooper flagg is in his second year") ----------
{
  const { qualifierOf } = await import("../src/notes/stats.js"), { subsetLabel } = await import("../src/notes/parse.js");
  ok(qualifierOf("MOST REBOUNDS BY A TEEN, NBA HISTORY") === "BY A TEEN" && qualifierOf("MOST POINTS BY A SOPHOMORE") === "BY A SOPHOMORE" && qualifierOf("MOST BLOCKS BY A 7-FOOTER, NBA HISTORY") === "BY A 7-FOOTER"
    && qualifierOf("MOST 3PM BY A MAVERICK") === null && qualifierOf("MOST POINTS BY A SIXER") === null && qualifierOf("MOST REBOUNDS IN NBA HISTORY") === null && qualifierOf("CAREER REBOUNDS") === null
    && qualifierOf("MOST STEALS BY A ROOKIE, MAVS HISTORY") === "BY A ROOKIE"
    && subsetLabel("MOST REBOUNDS BY A TEEN, NBA HISTORY REBOUNDS", "rebounds") === "rebounds by a teen"
    && subsetLabel("teenager in NBA history (1,762+). MOST POINTS BY A TEEN, NBA HISTORY TOT POINTS", "points") === "points by a teen",
    "notes (0.142.3): \"by a teen\", \"by a sophomore\" and the like make a list a subset (never \"by a Maverick\"), and its chase is labeled with the list's own words");
  const B = fs.readFileSync(path.join(root, "docs", "bridge", "cc-bridge.js"), "utf8"), W = fs.readFileSync(path.join(root, "src", "anticipate", "watch.js"), "utf8");
  ok(/var board = i\.qualifier \? null :/.test(B) && /m\.qualifier \? \{ qualifier: m\.qualifier \}/.test(W),
    "bridge v31: a subset list's card never gets the all-time or franchise board on its back; the watch list carries the subset");
}

// ---------- 0.142.1: a feat board from our own box scores (25 points, 5 threes, 3 blocks since 1993-94) ----------
{
  const F = await import("../src/records/featlive.js");
  const b = { label: "x", one: "25-5-3 game", since: "1993-94", min: { pts: 25, fg3m: 5, blk: 3 },
    rows: [{ name: "Wemby", now: 14 }, { name: "Gap Star", now: 8, atLeast: true }, { name: "Sure Four", now: 4 }, { name: "Gap Four", now: 4, atLeast: true }, { name: "Me", now: 3 }, { name: "Low", now: 2 }] };
  const n = (who) => F.featNext(b, b.rows.find((r) => r.name === who));
  ok(n("Wemby")?.what === "adding to his lead since 1993-94 (Gap Star is next with 8 or more)"
    && n("Me")?.what === "tying Sure Four" && n("Me").place === null
    && F.featNext({ ...b, rows: b.rows.map((r) => (r.name === "Gap Star" ? { ...r, now: 13 } : r)) }, b.rows[0]) === null
    && F.featNext({ ...b, rows: [{ name: "Me", now: 9 }, { name: "Far Gap", now: 5, atLeast: true }, { name: "Eleven", now: 11 }, { name: "Nine", now: 9 }] }, { name: "Me", now: 9 })?.what === "passing Nine (9) for 2nd since 1993-94",
    "feat boards (0.142.1): a count that may be short (\"8 or more\") is never passed or tied, a place near it isn't said, and a lead over it needs room (2); far below, it doesn't matter");
  const real = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "feat-boards-2026-11-22.json"), "utf8")).boards.p25t5b3;
  ok(real.since === "1993-94" && real.from === "ours" && real.rows[0][0] === "Victor Wembanyama" && real.rows[0][3] === 15 && real.asOf === "2026-11-23" && real.complete && real.rows.every((r) => r.length === 4)
    && real.rows[1][0] === "Kevin Durant" && real.rows[1][3] === 8
    && real.rows.every((r, i, a) => !i || a[i - 1][3] >= r[3]) && /tools\/feat-board-ours\.mjs/.test(fs.readFileSync(path.join(root, "src", "data", "feat-boards-2026-11-22.json"), "utf8")),
    "feat boards (0.142.1; 0.149.0: every game on file): the 25-5-3 board is ours, since 1993-94, Wembanyama 15 through 11/23; Durant's 8 is no longer \"at least\"");
  const B = fs.readFileSync(path.join(root, "docs", "bridge", "cc-bridge.js"), "utf8");
  ok(/b\.from === "ours" \? "regular season since "/.test(B) && /atLeast: !!r\.atLeast/.test(B) && /\(r\.al \? "\+" : ""\)/.test(B) && /since: b\.since, rows: rows/.test(B),
    "bridge v29.1: an \"ours\" board's card names our box scores since 1993-94, its back shows \"8+\", and the rules see which counts may be short");
}

// ---------- 0.141.14: the Worker's saved data, backed up (tools/kv-backup.mjs, .github/workflows/kv-backup.yml) ----------
{
  const K = await import("../tools/kv-backup.mjs");
  const ns = K.namespaceId(fs.readFileSync(path.join(root, "cloudflare", "wrangler.toml"), "utf8"));
  // A fake Cloudflare: 2,500 keys over three pages; one expires between the list and the read.
  const store = new Map(Array.from({ length: 2500 }, (_, i) => [`k${i}`, JSON.stringify({ i })]));
  store.set("state", JSON.stringify({ base: "https://x", seen: { a: 1 } }));
  const listed = [...store.keys()];
  const calls = [];
  const fake = async (url, opt = {}) => {
    calls.push(`${opt.method || "GET"} ${url.replace(/^.*namespaces\/[^/]+/, "")}`);
    const u = new URL(url);
    if (u.pathname.endsWith("/keys")) {
      const at = +(u.searchParams.get("cursor") || 0), page = listed.slice(at, at + 1000);
      return { ok: true, status: 200, json: async () => ({ success: true, result: page.map((name) => ({ name, ...(name === "k7" ? { expiration: 4e9 } : {}) })), result_info: { cursor: at + 1000 < listed.length ? String(at + 1000) : "" } }) };
    }
    if (u.pathname.includes("/values/")) {
      const k = decodeURIComponent(u.pathname.split("/values/")[1]);
      if (k === "k5") return { ok: false, status: 404, text: async () => "" };
      return { ok: true, status: 200, text: async () => store.get(k) };
    }
    if (u.pathname.endsWith("/bulk")) return { ok: true, status: 200, json: async () => ({ success: true, rows: JSON.parse(opt.body).length }) };
    throw new Error("unexpected " + url);
  };
  const d = await K.dump({ account: "acct", ns, token: "t", fetchFn: fake });
  const pages = calls.filter((c) => c.startsWith("GET /keys")).length;
  const wrote = []; const fake2 = async (url, opt) => { wrote.push(JSON.parse(opt.body).length); return fake(url, opt); };
  const n = await K.restore({ account: "acct", ns, token: "t", data: { keys: [...d.keys, { key: "old", value: "x", expiration: 1000 }] }, fetchFn: fake2, now: 2e12 });
  ok(/^[0-9a-f]{32}$/.test(ns) && pages === 3 && d.n === 2500 && !d.keys.some((k) => k.key === "k5") && d.keys.find((k) => k.key === "k7").expiration === 4e9
    && d.keys.find((k) => k.key === "state").value === store.get("state") && n === 2500 && JSON.stringify(wrote) === "[1000,1000,500]",
    "kv backup (0.141.14): every key over all pages, a key gone since the list skipped, expirations kept; restore writes 1,000 a request and drops a copy already expired",
    JSON.stringify({ pages, n: d.n, restored: n, wrote }));
  // The workflow keeps nothing without the passphrase, and the encryption it uses opens again with it (when openssl is here).
  const wf = fs.readFileSync(path.join(root, ".github", "workflows", "kv-backup.yml"), "utf8");
  const enc = /openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_KEY/.test(wf), dec = /openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_KEY/.test(wf);
  let roundTrip = "skipped (no openssl)";
  try {
    const { execSync } = await import("node:child_process");
    const env = { ...process.env, BACKUP_KEY: "test passphrase" };
    const sealed = execSync("gzip -9 | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_KEY", { input: JSON.stringify(d), env });
    const back = execSync("openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_KEY | gunzip", { input: sealed, env }).toString();
    roundTrip = back === JSON.stringify(d) && !sealed.toString("latin1").includes("seen") ? "ok" : "differs";
  } catch (e) { if (!/not found|ENOENT/.test(String(e))) roundTrip = "failed: " + e.message.slice(0, 80); }
  ok(enc && dec && /if \[ -z "\$\{BACKUP_KEY\}" \]; then[\s\S]*?exit 1/.test(wf) && !/git add[^\n]*kv\.json\b/.test(wf) && /rm -f "\$RUNNER_TEMP\/kv\.json"/.test(wf) && (roundTrip === "ok" || roundTrip.startsWith("skipped")),
    `kv backup (0.141.14): kept only encrypted, refused without NCC_BACKUP_KEY, and the copy opens with it (${roundTrip})`);
}

// ---------- 0.83: cards file in by time, bench over starters, a coach's record counted, the Index page ----------
{
  const br = fs.readFileSync(path.join(root, "docs", "bridge", "cc-bridge.js"), "utf8");
  ok(/var VERSION = (?:19|[2-9]\d);/.test(br) && /Object\.assign\(\{ type: "streak", live: live/.test(br) && /var rare = function/.test(br) && /rare\(\{ icon: "🦾 FULL GAME"/.test(br) && /type: "clutch", icon: late >= LATE_LEAD/.test(br) && /type: "streak", icon: "🧮 COUNT CHECK"/.test(br),
    "bridge v19 (the user, 11/16: Command Center alerts 'feel pinned to the top'): season cards are routine in NBA Live's ordering; only a full game, an almost-never state, records and milestones take the top tier");
  // The bridge's fire(), run alone. v20 (the user, 11/16: "I don't want the first alert to be stuck in the queue even as
  // the player is scoring more points... tell me you didn't completely override the guideline"): NBA Live's rule stands,
  // so a card with new numbers goes through with no time of its own and NBA Live moves it up. Only a card marked
  // `hold` keeps the moment it first fired, and only while it is the same card.
  {
    const i = br.indexOf("  function fire(key, card) {"), src = br.slice(i, br.indexOf("\n  }\n", i) + 5);
    const sent = [];
    const fire = new Function("state", "ALERT_STORIES", "fireStory", `${src}; return fire;`)({ done: { gone: 1 }, keys: {} },
      new Map([["k", { icon: "🎯 11 FROM 5,000", t: 400, wt: 9000 }], ["b", { icon: "🔄 STILL ON THE BENCH", t: 900, wt: 77 }]]), (k, c) => sent.push([k, c]));
    fire("k", { icon: "🎯 9 FROM 5,000", text: "a" }); fire("b", { hold: true, icon: "🔄 STILL ON THE BENCH", text: "later" }); fire("b", { hold: true, icon: "🔄 NOT OUT FOR THE 3RD" });
    fire("b", { hold: true, icon: "🔄 STILL ON THE BENCH", t: 7 }); fire("new", { hold: true, icon: "x" }); fire("gone", { icon: "x" });
    ok(sent.length === 5 && sent[0][1].t === undefined && sent[0][1].wt === undefined && sent[1][1].t === 900 && sent[1][1].wt === 77 && sent[2][1].t === undefined && sent[3][1].t === 7 && sent[3][1].wt === undefined && sent[4][1].t === undefined && sent.every((x) => !("hold" in x[1])),
      "bridge v20: a countdown that moves closer is left to NBA Live, which moves it up; a held card keeps the time it first fired until it becomes a different card or is given its own time", JSON.stringify(sent.map((x) => [x[0], x[1].t, x[1].wt])));
    ok((br.match(/base\(\{ hold: true, icon: "🔄 /g) || []).length === 3 && (br.match(/hold: true/g) || []).length === 3,
      "bridge v20: only the three rotation cards (hasn't checked in, still on the bench, not out for the 3rd) are held");
  }

  // Benches that outscore their own starters, over whole games.
  const { benchOverStarters } = await import("../src/situations/bench.js");
  const ln = (side, starter, pts) => [side, starter, 30, pts];
  const five = (side, pts) => Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`${side}s${i}`, ln(side, 1, pts)]));
  const gB = (d, h, a, hb, ab) => ({ d, h, a, hs: 100, as: 90, pl: { ...five(0, 10), ...five(1, 10), hb: ln(0, 0, hb), ab: ln(1, 0, ab) } });
  const BN = benchOverStarters([gB("2026-11-01", "PHX", "LAL", 60, 20), gB("2026-11-03", "PHX", "DEN", 50, 51), gB("2026-11-05", "MIL", "PHX", 10, 78), { d: "2026-11-06", h: "BOS", a: "NYK", hs: 100, as: 90, pl: { x: ln(0, 0, 99) } }]);
  ok(BN.gp === 6 && BN.n === 3 && BN.teams.PHX.gp === 3 && BN.teams.PHX.n === 2 && BN.teams.PHX.last.d === "2026-11-05" && BN.teams.PHX.last.bench === 78 && BN.teams.DEN.n === 1 && BN.teams.LAL.n === 0 && !BN.teams.BOS && BN.list[0].team === "PHX" && BN.list.length === 3,
    "bench (0.83): how often a team's reserves outscored its five starters over a whole game, by team and league-wide; a box score with no starters marked is left out", JSON.stringify(BN));

  // A coach with no table in his notes: his record by opponent counted from the results, used only if it adds up.
  const { fromTenures, coachLine } = await import("../src/notes/formats/coach-record.js");
  const recS = { coach: "New Coach", entering: "11/16", teams: {}, career: { w: 3, l: 2 }, ok: false };
  const gms = [{ d: "2025-10-22", h: "POR", a: "MIN", hs: 90, as: 100 },                                   // before he took over
    { d: "2025-10-24", h: "POR", a: "GSW", hs: 110, as: 100 }, { d: "2025-11-01", h: "DEN", a: "POR", hs: 120, as: 100 }, { d: "2026-01-05", h: "POR", a: "DEN", hs: 105, as: 100 },
    { d: "2026-10-22", h: "POR", a: "DEN", hs: 80, as: 100 },                                              // Portland after he left
    { d: "2026-10-23", h: "CHI", a: "DEN", hs: 100, as: 90 }, { d: "2026-11-10", h: "CLE", a: "CHI", hs: 110, as: 100 }, { d: "2026-11-16", h: "CLE", a: "CHI", hs: 110, as: 100 }];   // today's game not counted
  const ten = [{ team: "POR", from: "2025-10-23", to: "2026-06-30" }, { team: "CHI", from: "2026-10-01" }];
  const cnt = fromTenures(recS, ten, gms, "2026-11-16"), off = fromTenures({ ...recS, career: { w: 4, l: 2 } }, ten, gms, "2026-11-16");
  ok(cnt.ok && cnt.counted && cnt.teams.DEN.w === 2 && cnt.teams.DEN.l === 1 && cnt.teams.CLE.l === 1 && !cnt.teams.MIN && cnt.sum.w === 3 && cnt.sum.l === 2
    && coachLine(cnt, "DEN") === "New Coach is 2-1 all-time against the Nuggets as a head coach (3-2 overall, entering 11/16; counted from our results, which add up to the record his notes print)."
    && !off.ok && coachLine(off, "DEN") === null && fromTenures(recS, [], gms, "2026-11-16") === recS,
    "coach record (0.83): no table in the notes (Chicago): the record by opponent is counted from the games of his tenures, and used only when it adds up to the career record the notes print", JSON.stringify([cnt.teams, cnt.sum, off.ok]));
  const CT = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "coach-tenures.json"), "utf8"));
  ok(Object.values(CT.coaches).every((c) => c.source && c.tenures.length && c.tenures.every((t) => /^[A-Z]{3}$/.test(t.team) && /^\d{4}-\d\d-\d\d$/.test(t.from) && t.from >= "2016-10-01")),
    "coach record (0.83): every listed tenure starts inside the seasons we hold game by game, with its source");

  // The Index page lists every page of the site and reads the season files itself.
  const fh = fs.readFileSync(path.join(root, "docs", "find.html"), "utf8");
  const pages = fs.readdirSync(path.join(root, "docs")).filter((f) => f.endsWith(".html") && f !== "find.html");
  ok(pages.every((f) => f === "index.html" ? /\["[^"]+", "\.\/[#"]/.test(fh) : fh.includes(`"${f}`)) && pages.every((f) => fs.readFileSync(path.join(root, "docs", f), "utf8").includes('href="find.html"'))
    && /get\("flowstats\.json"\)/.test(fh) && /get\("arenas\.json"\)/.test(fh) && /built \$\{esc\(ago\(f\.at\)\)\}/.test(fh),
    "index page (0.83): every page of the site is in its list and links to it; each row shows how fresh its data is; the season tables read the live files", pages.join(","));
}

// ---------- snapshot ----------
// ---------- 0.95: scoring by type, matchup edges, the League row, every value in the count dropdowns ----------
{
  const { readGameMisc } = await import("../src/espn/misc.js");
  const { edges, teamTypes, playerTypes, place, EDGE } = await import("../src/situations/edges.js");
  const { boxRecordLines: BRL5, boxTable: BT5 } = await import("../src/records/teamgame.js");
  // One invented game: home team 1, away team 2. ESPN's "turnoverPoints" is what a team CONCEDED off its turnovers.
  const P = (type, team, o = {}) => ({ type: { text: type }, team: { id: team }, participants: o.who ? [{ athlete: { id: o.who } }] : [], scoringPlay: !!o.pts, scoreValue: o.pts || 0, shootingPlay: !!o.shot, coordinate: o.xy ? { x: o.xy[0], y: o.xy[1] } : undefined });
  const plays = [
    P("Jump Shot", "1", { shot: 1, who: "a" }), P("Offensive Rebound", "1", { who: "b" }), P("Layup Shot", "1", { shot: 1, pts: 2, who: "b", xy: [25, 1] }),      // second chance 2, paint 2
    P("Free Throw - 1 of 1", "1", { pts: 1, who: "b" }),                                                                                                         // the and-one of that basket: second chance 3
    P("Bad Pass\nTurnover", "2", { who: "x" }), P("Jump Shot", "1", { shot: 1, pts: 3, who: "a", xy: [10, 22] }),                                                 // off a turnover 3
    P("Traveling", "1", { who: "a" }), P("Driving Layup Shot", "2", { shot: 1, pts: 2, who: "x", xy: [27, 3] }),                                                  // a travel is a turnover: 2 off it, in the paint
    P("Jump Shot", "2", { shot: 1, who: "y" }), P("Defensive Rebound", "1", { who: "a" }), P("Pullup Jump Shot", "1", { shot: 1, pts: 2, who: "a", xy: [36, 9] }), // a two outside the lane: no paint
    P("Shooting Foul", "2", { who: "y" }), P("Free Throw - 1 of 2", "1", { who: "b" }), P("Offensive Rebound", "1"), P("Free Throw - 2 of 2", "1", { pts: 1, who: "b" }), // the "rebound" between free throws is no second chance
    P("Offensive Charge", "2", { who: "y" }), P("Hook Shot", "1", { shot: 1, pts: 2, who: "b", xy: [22, 6] }),                                                    // a charge is a turnover: 2 off it, in the paint
    P("End Period", ""),
  ];
  const game = (paintH, paintA) => ({ header: { competitions: [{ status: { type: { completed: true } }, competitors: [{ homeAway: "home", team: { id: "1" } }, { homeAway: "away", team: { id: "2" } }] }] },
    boxscore: { teams: [{ team: { id: "1" }, statistics: [{ name: "pointsInPaint", displayValue: String(paintH) }, { name: "fastBreakPoints", displayValue: "5" }, { name: "turnoverPoints", displayValue: "2" }] },
      { team: { id: "2" }, statistics: [{ name: "pointsInPaint", displayValue: String(paintA) }, { name: "fastBreakPoints", displayValue: "0" }, { name: "turnoverPoints", displayValue: "5" }] }] }, plays });
  const M = readGameMisc(game(4, 2)), M2 = readGameMisc(game(14, 2));
  ok(JSON.stringify(M.home) === "[4,5,5,3]" && JSON.stringify(M.away) === "[2,0,2,0]" && M.ok && JSON.stringify(M.players.b) === "[0,4,3,2]" && JSON.stringify(M.players.a) === "[0,0,0,3]" && JSON.stringify(M.players.x) === "[1,2,0,2]" && !M.players.y
    && JSON.stringify(M.counted) === '{"home":[4,5],"away":[2,2]}' && !M2.ok && M2.players === null && M2.home[0] === 14,
    "scoring by type (0.95): paint and fast break are ESPN's lines; a team's points off turnovers are the OTHER team's 'points conceded' line; second chance is counted from the plays (the and-one of a putback counts, a rebound between two free throws does not; a travel and a charge are turnovers); a made two outside the lane is not paint; when the count of paint points is far from ESPN's, the team totals stand and the players' are not used", JSON.stringify([M, M2.ok]));
  // Edges: 30 invented teams; T01 scores the most in the paint and T30 allows the most; T30 scores the fewest and T01 allows the fewest.
  const tris = Array.from({ length: 30 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`), rows = [], ix = (t) => tris.indexOf(t), hb5 = [40, 85, 10, 30, 20, 25, 10, 30, 25, 8, 5, 13, 20];
  // Everyone plays everyone once. A team's paint points: its own level (60, 59, ... 31) plus what its opponent gives up (0 to 14.5); every other category is the same number for all.
  for (let i = 0; i < 30; i++) for (let j = i + 1; j < 30; j++) {
    const h = tris[i], a = tris[j], paint = (t, o) => 60 - ix(t) + ix(o) / 2;
    rows.push({ id: `g${i}-${j}`, d: "2026-11-01", h, a, hs: 110, as: 100, hb: hb5, ab: hb5, m: [[paint(h, a), 12, 15, 14], [paint(a, h), 12, 15, 14]], mq: 1,
      pl: { [`p${h}`]: [0, 1, 34, 25], [`p${a}`]: [1, 1, 34, 25] }, mp: { [`p${h}`]: [0, (60 - ix(h)) / 3, 2, 3], [`p${a}`]: [1, (60 - ix(a)) / 3, 2, 3] } });
  }
  const names = Object.fromEntries(tris.map((t) => [`p${t}`, `Player ${t}`]));
  const TT = teamTypes(rows), PT = playerTypes(rows, names);
  const E = edges({ rows, names, tonight: [{ away: "T01", home: "T30" }, { away: "T14", home: "T15" }] });
  const e0 = E.games[0].items, off = e0.find((i) => i.cat === "paint" && i.team === "T01"), def = e0.find((i) => i.cat === "paint" && i.team === "T01" && /fewest/.test(i.text));
  ok(TT.n === 30 && TT.teams.T01.fr[0] === 1 && TT.teams.T30.fr[0] === 30 && PT.rows.find((p) => p.id === "pT01").r[0] === 1 && place(1, 30) === "the most" && place(4, 30) === "4th most" && place(28, 30) === "3rd fewest" && place(30, 30) === "the fewest"
    && off && /^The T01 score [\d.]+ points in the paint a game \(the most\); the T30 allow [\d.]+ \((?:the most|\d\w\w most)\)\. Player T01 scores [\d.]+ \(the most in the NBA\)\.$/.test(off.text) && off.edge && off.lopsided && off.kind === "matchup" && /^Paint edge · T01$/.test(off.tag)
    && e0.some((i) => i.cat === "paint" && i.team === "T01" && /^The T30 score .*\(the fewest\); the T01 allow [\d.]+ \(the fewest\)\.$/.test(i.text)) && !e0.some((i) => i.player) && e0.every((i) => i.cat === "paint") && !E.games[1].items.length
    && E.table.length === 30 && E.leaders.paint[0].name === "Player T01" && !("fb" in E.leaders) && EDGE.end === 5,
    "matchup edges (0.95): a top-5 offense in a category against a bottom-5 defense in it is an edge for the offense, with its own league leaders named on the same line and not on lines of their own; a bottom-5 offense against a top-5 defense is the defense's; two mid-table teams have none; a category in which every team has the same number has no ends, so no edge; ranks in words; no player list for fast-break points", JSON.stringify([e0.map((i) => i.text), E.games[1].items.length]));
  // A team with too few games read is not ranked, so a half-read season shows nothing rather than skewed ranks.
  const half = rows.map((g, i) => (i % 3 ? { ...g, m: undefined, mq: undefined, mp: undefined } : g));
  ok(Object.keys(teamTypes(half).teams).length === 0 && edges({ rows: half, names, tonight: [{ away: "T01", home: "T30" }] }).games[0].items.filter((i) => !i.cats).length === 0,
    "matchup edges (0.95): while the season's games are still being read (under 80% of a team's games) nothing is ranked or said");
  // 0.137.0: what the Watch List shows first and what it folds (src/site/trim.js; copied to docs/lib/site).
  {
    const { trimStories, trimMatchups, trimNotes, briefClaimSet, smallShift, TRIM } = await import("../src/site/trim.js");
    const BT = briefClaimSet({ top: [{ team: "TOR", text: "RJ Barrett and Collin Murray-Boyles both out: TOR 2-2" }], deep: [] });
    const S = trimStories([
      { kind: "injury", team: "TOR", text: "RJ Barrett and Collin  Murray-Boyles both out: TOR 2-2", score: 3 },
      { kind: "shift", team: "DET", text: "Daniss Jenkins is averaging 36.5 minutes over his last 6 games", score: 2.5 },
      { kind: "shift", team: "DET", text: "Jalen Duren is averaging 11.0 rebounds over his last 4 games", score: 2.1 },
      { kind: "shift", team: "TOR", text: "Michael Porter Jr. is averaging 0.6 steals over his last 10 games", score: 2.4 },
      { kind: "history", team: "DET", text: "DET notes — Ausar Thompson: career-high 12 assists", score: 2 },
    ], BT);
    ok(S.inBrief.length === 1 && S.shown.map((l) => l.text.split(" ")[0]).join() === "Daniss,DET" && S.folded.length === 2 && smallShift(S.folded[1]) && TRIM.shiftsPerTeam === 1,
      "Watch List (0.137): a storyline already in the briefing isn't repeated (spacing aside); a team keeps its strongest shift; a shift under 1.5 steals, blocks or turnovers folds even when it is a team's only one", JSON.stringify(S));
    const M = trimMatchups([
      { edge: true, team: "ORL", tag: "Paint edge · ORL", text: "The Nets score 42.3 points in the paint", score: 2.05 },
      { team: "ORL", tag: "Series streak · 9", text: "The Magic have won 9 straight against the Nets, their longest since 2012.", score: 4.2 },
      { team: "ORL", tag: "Series record", text: "A win tonight would be the Magic's 10th straight over the Nets.", score: 2.4 },
      { team: "ORL", tag: "Season series", text: "The Magic lead the season series 1-0.", score: 1.6 },
      { team: "ORL", tag: "All-time series", text: "All-time: the Magic lead the Nets 78-60.", score: 1 },
      { team: "ORL", tag: "Streak vs BKN · 10", text: "Wendell Carter Jr.'s teams have won 10 straight against the Nets.", score: 2.7 },
      { team: "ORL", tag: "Streak vs BKN · 8", text: "Anthony Black's teams have won 8 straight against the Nets.", score: 2.38 },
      { team: "BKN", tag: "Streak vs ORL · 6", text: "Day'Ron Sharpe's teams have lost 6 straight against the Magic.", score: 1.54 },
    ], ["Series streak · 9: The Magic have won 9 straight against the Nets, their longest since 2012."]);
    ok(M.inStories.length === 1 && M.shown.map((i) => i.tag.split(" ·")[0]).join() === "Paint edge,Streak vs BKN,Series record,Season series,Streak vs ORL" && M.folded.map((i) => i.tag.split(" ·")[0]).join() === "Streak vs BKN,All-time series",
      "Watch List (0.137): matchups show every edge first, the two strongest series lines of 1.5+, one player-vs-opponent line a team; a line already in the storylines isn't repeated; the rest fold", JSON.stringify(M));
    const M2 = trimMatchups([{ team: "A", tag: "All-time series", text: "All-time: A leads B 75-68 in the regular season.", score: 1 }, { team: "A", tag: "Series margins", text: "Largest wins in the series: A by 47.", score: 0.9 }]);
    ok(M2.shown.length === 1 && M2.shown[0].tag === "All-time series", "Watch List (0.137): with no series line of 1.5+, the strongest one still shows", JSON.stringify(M2));
    const N = trimNotes([
      { text: "Diabate leads the league in offensive rebounds per game this season.", tag: "Leads NBA", score: 6.5 },
      { text: "The Hornets have played 14 games this season, going 4-10 so far.", tag: "Notes", score: 7 },
      { text: "Ball needs 12 assists to pass Muggsy Bogues for the most in team history.", tag: "Notes", score: 3, hook: { live: true } },
      { text: "Miller is 3rd in team history in threes by a player in his first 3 seasons.", tag: "3rd in team history", score: 4 },
      { text: "Knueppel has made a three in 30 straight games, the longest streak in the league.", tag: "Streak · 30", score: 5 },
    ], ["CHA notes — Kon Knueppel: Streak · 30 · Knueppel has made a three in 30 straight games, the longest streak in the league."]);
    ok(N.inStories.length === 1 && N.shown.map((x) => x.text.split(" ")[0]).join() === "Diabate,Miller,Ball" && N.folded[0].text.startsWith("The Hornets") && TRIM.notesPerTeam === 3,
      "Watch List (0.137): a team's notes show three facts with a hook (rank, record, streak, in play tonight) before plain ones, none already in the storylines; the rest fold", JSON.stringify(N));
  }
  // 0.138.0: the ledger: one record per claim across detectors, with new / updated / repeat across days.
  {
    const { buildLedger, ledgerAdjust, markShown, claimKeyOf, pageKey, hashKey, LEDGER } = await import("../src/anticipate/ledger.js");
    const { claimIndex, claimOf, trimStories, briefClaimSet } = await import("../src/site/trim.js");
    const day1 = [
      { kind: "streak", team: "LAL", player: "Luka Doncic", text: "Luka Doncic: 30+ points in 10 straight games", score: 3 },
      { kind: "context", team: "HOU", player: "Jabari Smith Jr.", text: "Smith: career highs in FG%, 3P% and FT% (45.5%, 38.8%, 84.6%)", score: 2 },
      { kind: "season", team: "HOU", player: "Jabari Smith Jr.", text: "Jabari Smith Jr. this season (16 games): 45.5% FG (career-high), 38.8% 3PT (career-high)", score: 2.6 },
      { kind: "streak", team: "CLE", player: "Donovan Mitchell", text: "Donovan Mitchell: made a three in 15 straight games, every game this season", score: 2 },
      { kind: "streak", team: "CLE", player: "James Harden", text: "James Harden: made a three in 15 straight games, every game this season", score: 2 },
      { kind: "injury", team: "OKC", player: null, text: "Jalen Williams OUT (left ankle surgery): OKC 6-6 without him (+2.9 a game), 3-0 with", score: 2 },
      { kind: "injury", team: "OKC", player: null, text: "Chet Holmgren OUT (right knee): OKC 6-6 without him (+2.9 a game), 3-0 with", score: 2 },
      { kind: "shooting", team: "DEN", player: "Nikola Jokic", text: "Nikola Jokic is shooting 89.8% from the line", score: 2 },
    ];
    const L1 = buildLedger(day1, { seen: {}, today: "2026-11-18" });
    const smith = L1.of.get(day1[1]);
    ok(L1.claims.length === 7 && smith === L1.of.get(day1[2]) && smith.best === day1[2] && smith.kinds.join() === "season,context" && L1.of.get(day1[3]) !== L1.of.get(day1[4]) && L1.of.get(day1[5]) !== L1.of.get(day1[6]) && L1.claims.every((c) => c.isNew),
      "ledger (0.138): the same claim from two detectors is one record (same player, two shared decimals: Smith's career highs); the same words about two players, or two absences with the same record, stay two", JSON.stringify(L1.claims.map((c) => [c.kinds, c.sources])));
    ok(Math.abs(ledgerAdjust(smith) - LEDGER.sourceBonus) < 1e-9 && ledgerAdjust(L1.of.get(day1[0])) === 0, "ledger (0.138): a claim two detectors found ranks a little higher", String(ledgerAdjust(smith)));
    const top1 = [L1.of.get(day1[0]), L1.of.get(day1[7])];
    let seen = markShown(L1.seen, top1, "2026-11-18");
    // Day 2: Luka's streak one longer (moved numbers, a streak: updated, up); Jokic's line unchanged after a day on top (fades).
    const day2 = [{ ...day1[0], text: "Luka Doncic: 30+ points in 11 straight games" }, day1[7], day1[3]];
    const L2 = buildLedger(day2, { seen, today: "2026-11-19" });
    const luka = L2.of.get(day2[0]), jok = L2.of.get(day2[1]), mitch = L2.of.get(day2[2]);
    ok(luka.key === claimKeyOf(day1[0]) && luka.changed && !luka.isNew && luka.shownStreak === 0 && ledgerAdjust(luka) === LEDGER.changed
      && !jok.changed && jok.shownStreak === 1 && ledgerAdjust(jok) === -LEDGER.repeat && !mitch.changed && mitch.shownStreak === 0 && ledgerAdjust(mitch) === 0,
      "ledger (0.138): a streak one game longer is the same claim, updated (moves up); a line already on top yesterday with the same numbers fades; one seen but never on top is neither", JSON.stringify({ luka: [luka.changed, luka.shownStreak], jok: [jok.changed, jok.shownStreak] }));
    seen = markShown(L2.seen, [jok], "2026-11-19");
    const L3 = buildLedger([day1[7]], { seen, today: "2026-11-20" }), jok3 = L3.claims[0];
    // a second build the same day: what is compared is still the numbers of the last earlier day
    const L3b = buildLedger([day1[7]], { seen: L3.seen, today: "2026-11-20" });
    ok(jok3.shownStreak === 2 && ledgerAdjust(jok3) === -2 * LEDGER.repeat && L3b.claims[0].shownStreak === 2 && !L3b.claims[0].changed && jok3.first === "2026-11-18",
      "ledger (0.138): two days on top unchanged fades twice as much; a later build the same day agrees; the first day seen is kept", JSON.stringify(jok3));
    // The page: a storyline worded as the briefing's season line is found in the briefing through the ledger's merged claim.
    const idx = claimIndex({ pk: Object.fromEntries(L1.claims.flatMap((c) => c.lines.map((l) => [hashKey(pageKey(l.team, l.text)), hashKey(c.key)]))) });
    const B = briefClaimSet({ top: [{ team: "HOU", text: day1[2].text }], deep: [] }, idx);
    const S = trimStories([{ kind: "context", team: "HOU", text: day1[1].text, score: 2 }, { kind: "streak", team: "CLE", text: day1[3].text, score: 2 }], B, idx);
    ok(S.inBrief.length === 1 && S.inBrief[0].kind === "context" && S.shown.length === 1 && claimOf(idx, "HOU", day1[1].text) === hashKey(smith.key),
      "ledger (0.138): on the page, a storyline making the same claim as a briefing line in other words isn't repeated", JSON.stringify(S));
  }
  // 0.139.0: post-ready wording, "used it", and a used claim held back until it updates.
  {
    const { postText, POST_MAX } = await import("../src/site/post.js");
    const P = (t, player) => postText(t, { player });
    const cases = [
      ["DEN notes — Nikola Jokic: 5th in NBA · He’s shooting 89.8% from the free-throw line this season, marking the fifth-best in the NBA (min. 50 FTM).", null, "Nikola Jokic is shooting 89.8% from the free-throw line this season, marking the fifth-best in the NBA (min. 50 FTM)."],
      ["SAC notes — Darius Acuff Jr.: Team history · Tallied fifth 30+ point game, becoming the fourth rookie in franchise history with five or more 30+ point games, vs. PHX (11/18).", null, "Darius Acuff Jr. tallied fifth 30+ point game, becoming the fourth rookie in franchise history with five or more 30+ point games, vs. PHX (11/18)."],
      ["LAL notes: 1 of 2 in team history · Dončić averaged 41.2 points during an 11-game streak.", null, "Dončić averaged 41.2 points during an 11-game streak."],
      ["TOR notes — Ja'Kobe Walter: Streak · 13 (notes) · Has made a career-high 13 consecutive starts (Oct. 25 - Nov. 18); Averaging 12.8 points in that span. → 14 if he does it again tonight.", null, "Ja'Kobe Walter has made a career-high 13 consecutive starts (Oct. 25 - Nov. 18); averaging 12.8 points in that span."],
      ["WAS notes — Anthony Davis: 1 of 3 this season · One of three players in the league averaging 24+ points. → Stays in it with 9+ rebounds tonight.", null, "Anthony Davis is one of three players in the league averaging 24+ points."],
      ["ORL notes — Wendell Carter Jr.: T-9th in NBA · As of Nov. 19, ranks ninth in the NBA in field goal percentage.", null, "As of Nov. 19, Wendell Carter Jr. ranks ninth in the NBA in field goal percentage."],
      ["HOU notes — Fred VanVleet: Notes · Over his past 7 games played, averaging 14.9 ppg on 48.7% shooting.", null, "Over his past 7 games played, Fred VanVleet is averaging 14.9 ppg on 48.7% shooting."],
      ["Gilgeous-Alexander (2× MVP): 4 free throws from passing Giannis Antetokounmpo (121) for the NBA Cup record; 3 ties him (66% tonight)", "Shai Gilgeous-Alexander", "Shai Gilgeous-Alexander is 4 free throws from passing Giannis Antetokounmpo (121) for the NBA Cup record; 3 ties him"],
      ["Naz Reid: 8 points from 6,000 career points (89% tonight)", "Naz Reid", "Naz Reid is 8 points from 6,000 career points"],
      ["Amen Thompson is averaging 8.3 rebounds over his last 7 games (since 11/4), up from 3.6 over the 5 games before (by chance: under 1 in 200)", null, "Amen Thompson is averaging 8.3 rebounds over his last 7 games (since 11/4), up from 3.6 over the 5 games before"],
      ["Series streak · 9: The Magic have won 9 straight against the Nets, their longest since a run of 10 that ended in 2012.", null, "The Magic have won 9 straight against the Nets, their longest since a run of 10 that ended in 2012."],
      ["Luka Doncic: 25+ points in 12 straight games", "Luka Doncic", "Luka Doncic: 25+ points in 12 straight games"],
      ["RJ Barrett OUT (right hamstring strain): TOR 0-1 without him (-4.0 a game), 5-9 with · questionable tonight", null, "RJ Barrett OUT (right hamstring strain): TOR 0-1 without him (-4.0 a game), 5-9 with"],
    ];
    const bad = cases.filter(([t, pl, want]) => P(t, pl) !== want).map(([t, pl, want]) => ({ got: P(t, pl), want }));
    const long = P("A".repeat(10) + " " + "word ".repeat(70) + ". Second sentence " + "more ".repeat(20));
    ok(!bad.length && long.length <= POST_MAX && !/ $/.test(long), "post-ready (0.139): page labels, chances and odds off; a notes sentence gets its subject back (He's → name, a bare verb, One of / As of / Over his…); a countdown says \"is\"; never over 280; nothing added", JSON.stringify(bad));
    const { learn } = await import("../src/anticipate/learn.js");
    const M = learn([{ key: "k1", claim: "abc", kind: "record", team: "OKC", player: "P", text: "x record", v: 2 }]);
    ok(M.used.has("k1") && M.usedClaims.has("abc") && M.up.has("k1") && M.weights["kind:record"] === 0.4, "learn (0.139): a used line counts as two 👍 (a feature weight from one use) and its claim is listed as used", JSON.stringify(M.weights));
    const { buildLedger, hashKey } = await import("../src/anticipate/ledger.js");
    const { briefing } = await import("../src/anticipate/briefing.js");
    const lineA = { kind: "record", team: "OKC", player: "Shai Gilgeous-Alexander", text: "Gilgeous-Alexander: 4 free throws from passing Giannis Antetokounmpo (121) for the NBA Cup record", score: 4 };
    const lineB = { kind: "streak", team: "OKC", player: "Chet Holmgren", text: "Chet Holmgren: 2+ blocks in 6 straight games", score: 3 };
    const L0 = buildLedger([lineA, lineB], { today: "2026-11-20" }), usedId = hashKey(L0.of.get(lineA).key);
    const model = { weights: {}, down: new Set(), up: new Set(), usedClaims: new Set([usedId]) };
    const B1 = briefing({ all: [lineA, lineB], games: [{ away: "NOP", home: "OKC" }], today: "2026-11-20", ledger: L0, model });
    const lineA2 = { ...lineA, text: lineA.text.replace("4 free throws", "1 free throw") };
    const L1 = buildLedger([lineA2, lineB], { seen: L0.seen, today: "2026-11-21" });
    const B2 = briefing({ all: [lineA2, lineB], games: [{ away: "NOP", home: "OKC" }], today: "2026-11-21", ledger: L1, model });
    ok(B1.top.map((l) => l.kind).join() === "streak" && B2.top.some((l) => l.kind === "record" && l.status === "updated"),
      "briefing (0.139): a claim marked used stays out of the briefing; once its numbers move it comes back, as updated", JSON.stringify({ b1: B1.top.map((l) => l.text), b2: B2.top.map((l) => [l.status, l.text]) }));
  }
  // 0.140.0: milestone chances recalibrated from the scored nights.
  {
    const { fitCalibration, calibrate, readCalls, CAL } = await import("../src/anticipate/calibrate.js");
    // 600 invented calls whose chances run high: a call said p came true at 0.8 × p.
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const calls = Array.from({ length: 600 }, () => { const p = 0.05 + 0.9 * rnd(); return { p, hit: rnd() < 0.8 * p }; });
    const F = fitCalibration(calls), few = fitCalibration(calls.slice(0, CAL.min - 1));
    const said = calls.reduce((a, c) => a + c.p, 0), got = calls.filter((c) => c.hit).length, now = calls.reduce((a, c) => a + calibrate(c.p, F), 0);
    ok(F && F.n === 600 && Math.abs(now - got) < Math.abs(said - got) * 0.25 && calibrate(0.6, F) < 0.6 && few === null && calibrate(0.6, null) === 0.6 && calibrate(0.03, F) === 0.03 && calibrate(null, F) === null,
      "calibration (0.140): fitted to calls that ran high, the corrected chances add up to about what happened; under 100 calls, under 5% or no fit, a chance is left as it is", JSON.stringify({ F, said: said.toFixed(1), got, now: now.toFixed(1) }));
    const file = fs.readFileSync(path.join(root, "history", "calls.jsonl"), "utf8"), H = readCalls(file), FH = fitCalibration(H);
    ok(H.length >= 367 && FH && FH.b > 0.8 && FH.b < 1 && FH.a < 0 && calibrate(0.62, FH) < 0.56 && calibrate(0.62, FH) > 0.48,
      "calibration (0.140): on the scored nights on file (11/10 on) the fit pulls a 62% call down to about 52%, as the held-out test said", JSON.stringify(FH));
  }
  // 0.141.1: ESPN's DNP reason kept; only the coach's decisions count against a player's chance to play; games-played
  // and starts milestones are left out of the recalibration (fitted on stats, not on whether a man plays).
  {
    const P = await import("../src/espn/parse.js"), W = await import("../src/anticipate/watch.js"), C = await import("../src/anticipate/calibrate.js");
    const ath = (id, o) => ({ athlete: { id, displayName: `P${id}` }, starter: false, ...o });
    const bx = P.readBox({ boxscore: { players: [{ team: { displayName: "Houston Rockets" }, statistics: [{ keys: ["minutes", "points"], athletes: [
      ath("1", { stats: ["30", "12"], reason: "COACH'S DECISION" }), ath("2", { didNotPlay: true, stats: [], reason: "RIGHT SOLEUS STRAIN" }), ath("3", { didNotPlay: true, stats: [], reason: "COACH'S DECISION" })] }] }] } });
    const r = Object.fromEntries(bx.players.map((p) => [p.id, p.dnpReason]));
    ok(r[1] === null && r[2] === "RIGHT SOLEUS STRAIN" && r[3] === "COACH'S DECISION" && !W.isBenched(r[2]) && W.isBenched(r[3]) && W.isBenched(null),
      "watch (0.141.1): a DNP's reason is kept (none when he played; ESPN marks players who played \"COACH'S DECISION\" too); an injury doesn't count as benched", JSON.stringify(r));
    const calls = Array.from({ length: 300 }, (_, i) => ({ p: 0.6, hit: i % 10 < 4, what: "1000 points" })).concat(Array.from({ length: 300 }, () => ({ p: 0.6, hit: false, what: "800 games" })));
    const fit = C.fitCalibration(calls), fitStats = C.fitCalibration(calls.slice(0, 300));
    ok(C.PLAY_ONLY.has("gp") && C.PLAY_ONLY.has("gs") && !C.PLAY_ONLY.has("pts") && C.playOnlyCall({ what: "800 games" }) && C.playOnlyCall({ what: "500 starts" }) && !C.playOnlyCall({ what: "1000 points" })
      && Math.abs(C.calibrate(0.6, fit) - C.calibrate(0.6, fitStats)) < 1e-9,
      "calibrate (0.141.1): games-played and starts calls are left out of the fit", JSON.stringify([C.calibrate(0.6, fit), C.calibrate(0.6, fitStats)]));
  }
  // 0.141.9: record chases kept for scoring, and their own fit.
  {
    const { tonightChances } = await import("../src/records/predictions.js"), C = await import("../src/anticipate/calibrate.js");
    const recOut = { items: [{ kind: "pass", id: 7, who: "A Guy", team: "BOS", stat: "pts", label: "points", need: 12, tonight: true, pTonight: 0.4, pTonightRaw: 0.5, pPlay: 0.97, passing: { name: "Old Star" } },
        { kind: "pass", id: 8, who: "Not Tonight", team: "NYK", stat: "ast", need: 3, tonight: false, pTonight: 0.2 }],
      cup: { boards: [{ items: [{ kind: "cup", id: "9", who: "Cup Guy", team: "LAL", stat: "reb", need: 4, tonight: true, pTonight: 0.3 }] }] },
      franchise: [{ kind: "franchise", id: 7, who: "A Guy", team: "BOS", stat: "pts", need: 12, tonight: true, pTonight: 0.45, pTonightRaw: 0.5 }] };
    const k = tonightChances(recOut);
    const txt = [{ d: "x", p: 0.5, hit: true }, { d: "x", p: 0.5, hit: false, from: "records" }].map((c) => JSON.stringify(c)).join("\n");
    ok(k.length === 3 && k[0].id === "7" && k[0].pTonight === 0.5 && k[0].passing === "Old Star" && k[0].list === "records" && k.some((x) => x.list === "cup" && x.id === "9") && k.some((x) => x.list === "franchise" && x.kind === "franchise")
      && !k.some((x) => x.who === "Not Tonight") && C.readCalls(txt).length === 1 && C.readCalls(txt, { kind: "records" }).length === 1 && C.readCalls(txt, { kind: "all" }).length === 2,
      "records (0.141.9): tonight's record chances kept once each with the raw chance (records, Cup, franchise); milestone and record calls read apart", JSON.stringify(k));
  }
  // 0.141.12: a record chase against an active player who also plays tonight is scored as finishing ahead of him.
  {
    const { tonightChances, recordHit } = await import("../src/records/predictions.js");
    const k = tonightChances({ cup: [{ kind: "cup", id: "4017837", who: "Ivica Zubac", team: "IND", stat: "reb", label: "rebounds", need: 6, target: 145, tonight: true, pTonight: 0.115,
      passing: { name: "Jalen Johnson", live: true }, rivals: [{ name: "Jalen Johnson", id: "4701230", team: "ATL", tonight: true }, { name: "Idle Guy", id: "1", team: "X", tonight: false }] },
      { kind: "cup", id: "2", who: "Plain", team: "BOS", stat: "pts", need: 4, tonight: true, pTonight: 0.9, rivals: [{ name: "Off Tonight", tonight: false }] }] });
    const z = k.find((x) => x.id === "4017837"), pl = k.find((x) => x.id === "2");
    // 11/20: Zubac got 10 rebounds and needed 6, but Johnson got 6 that night: 10 < 6 + 6, a miss (scored a hit before 0.141.12).
    ok(z && JSON.stringify(z.rivals) === JSON.stringify([{ name: "Jalen Johnson", id: "4701230", team: "ATL" }]) && pl && !("rivals" in pl)
      && !recordHit(10, 6, 6) && recordHit(12, 6, 6) && recordHit(6, 6) && !recordHit(5, 6),
      "records (0.141.12): a rival playing tonight is kept with the chance, and the call is a hit only if he finishes ahead of him", JSON.stringify(k));
  }
  // 0.145.0: the Mexico City game (DEN-IND 11/7, neutral site): one meeting, not two; home and road for neither team; the
  // national-TV schedule still matched by the listed home team (dh). The user: "counted as a neutral court so we can still
  // check the Pacers' last 10 road games".
  {
    const { meetings } = await import("../src/records/matchup.js"), { teamResults } = await import("../src/records/guide.js"), { nationalSplits, nationalIndex } = await import("../src/situations/national.js");
    const files = {
      IND: { team: "IND", keys: ["starter", "min", "pts"], names: { 1: "Pacer" }, games: [{ d: "2026-11-05", opp: "BOS", home: false, pf: 99, pa: 101, pl: { 1: [1, 30, 10] } }, { d: "2026-11-07", opp: "DEN", home: false, n: 1, dh: 1, pf: 102, pa: 114, pl: { 1: [1, 30, 12] } }] },
      DEN: { team: "DEN", keys: ["starter", "min", "pts"], names: { 2: "Nugget" }, games: [{ d: "2026-11-07", opp: "IND", home: false, n: 1, pf: 114, pa: 102, pl: { 2: [1, 30, 20] } }] } };
    const m = meetings({ games: [] }, files, "DEN", "IND");
    const tr = teamResults(files);
    const idx = nationalIndex({ games: [{ d: "2026-11-07", away: "DEN", home: "IND", networks: ["NBA TV"] }] });
    const ns = nationalSplits(files, idx);
    ok(m.length === 1 && m[0].home === "IND" && m[0].away === "DEN" && m[0].neutral === true && m[0].winner === "DEN"
      && tr.IND.filter((r) => r.road).length === 1 && tr.IND.find((r) => r.d === "2026-11-07").road === false && !tr.IND.find((r) => r.d === "2026-11-07").home
      && ns.teams.IND.nat.w + ns.teams.IND.nat.l === 1 && ns.teams.DEN.nat.w + ns.teams.DEN.nat.l === 1,
      "0.145.0: a neutral-site game is one meeting (listed home team kept), neither home nor road, and still matched to its national broadcast for both teams",
      JSON.stringify({ m, ind: tr.IND, ns: ns.teams }));
  }
  // 0.145.2: Detroit's notes, 11/24, on NBA Live: "…rim protectiona cross the lineup, with 5.85.8 Kevin Huerter tying…".
  {
    const { buildLines, dropDoubled } = await import("../src/notes/pdf-layout.js");
    const T = (str, x, y, h, w) => ({ str, x, y, h, w: w ?? str.length * h * 0.5 });
    const items = [T("in the NBA behind San Antonio. Detroit gets rim protectiona cross the lineup, with", 190, 112.5, 12, 372),
      T("5.8", 82.3, 97.5, 30, 38), T("5.8", 82.3, 97.5, 30, 38), T("Kevin Huerter tying his career high with five blocks on Nov. 8 against the Lakers, and", 174.7, 98.1, 12, 388),
      T("NOTABLE", 40, 300, 10), T("NOTABLE", 40, 300, 10), T("ASTS", 120, 300, 10),
      T("16/16", 40, 400, 8), T("9.6", 80, 400, 8), T("GP/GS", 120, 400, 4.2), T("PPG", 150, 400, 4.2)];
    const dropped = dropDoubled(items);
    const lines = buildLines(items).map((l) => l.text);
    ok(dropped === 2 && lines.includes("Kevin Huerter tying his career high with five blocks on Nov. 8 against the Lakers, and") && !lines.some((l) => /5\.8/.test(l))
      && lines.some((l) => /^NOTABLE\s+ASTS$/.test(l)) && lines.some((l) => /16\/16\s+9\.6/.test(l)),
      "0.145.2: a word drawn twice in one spot is read once; a big call-out number beside a sentence is taken off it; table numbers beside small labels stay", JSON.stringify({ dropped, lines }));
  }
  // 0.145.1: ESPN files the All-Star games under "Regular Season" (Curry's two on 2/16/25): left out of the game logs, so his
  // made-three run is Basketball-Reference's 102, not 104 (the user's screenshots, 11/24).
  {
    const { readGameLog } = await import("../src/espn/parse.js");
    const { SHRINK } = await import("../src/espn/client.js");
    const raw = { names: ["3PT"], events: { 1: { gameDate: "2025-02-14T00:30:00Z" }, 2: { gameDate: "2025-02-17T02:10:00Z", eventNote: "NBA All-Star - Semifinals First team to 40 points wins - Untimed" }, 3: { gameDate: "2025-02-17T03:00:00Z", eventNote: "NBA All-Star - Championship" }, 4: { gameDate: "2025-02-21T03:00:00Z" } },
      seasonTypes: [{ displayName: "2024-25 Regular Season", categories: [{ events: [{ eventId: "1", stats: ["4-10"] }, { eventId: "2", stats: ["2-5"] }, { eventId: "3", stats: ["0-3"] }, { eventId: "4", stats: ["4-9"] }] }] }] };
    const a = readGameLog(raw).types[0].games, b = readGameLog(SHRINK.gameLog(raw)).types[0].games;
    ok(a.length === 2 && b.length === 2 && a.map((g) => g.date).join() === "2025-02-13,2025-02-20",
      "0.145.1: the All-Star games are not in a player's game log, also after the cache shrinks it", JSON.stringify({ a, b }));
  }
  // 0.145.0: one spelling per player (the audit: "Jokić" at #2 in the briefing, "Nikola Jokic" at #6).
  {
    const { accentMap, withAccents } = await import("../src/site/accents.js");
    const m = accentMap(['{"who":"Nikola Jokić","x":"Luka Dončić","team":"DEN","note":"Mile High","y":"Kristaps Porziņģis"}', '{"a":"Nikola Jokić"}']);
    const n = withAccents({ 1: "Nikola Jokic", 2: "Luka Doncic", 3: "Jamal Murray" }, m);
    ok(m.size === 3 && n[1] === "Nikola Jokić" && n[2] === "Luka Dončić" && n[3] === "Jamal Murray" && m.get("Kristaps Porzingis") === "Kristaps Porziņģis",
      "0.145.0: ESPN's unaccented names take the accented spelling our reference files use; other names are left as they are", JSON.stringify([...m, n]));
  }
  // 0.145.0: the Streaks page's runs go back into last season (the audit: Curry "10, every game" there, 102 on the Records page).
  {
    const g = (d, fg3m, pts = 20) => ({ d, team: "GSW", fg3m, pts, reb: 5, ast: 5, stl: 1, blk: 0, starter: 1, min: 30 });
    const pgc = { "3975": [g("2026-10-21", 4), g("2026-10-23", 2), g("2026-10-25", 5)], "9": [g("2026-10-21", 0), g("2026-10-23", 2), g("2026-10-25", 1)] };
    const carry = { players: { "3975": { three: [94, "2024-12-21"], pts10: [12, "2026-01-15"] }, "9": { three: [40, "2025-01-01"] } } };
    const featlive = { streaks: [{ id: "3975", tests: [{ k: "fg3m", min: 1 }], n: 95, source: "list" }] };
    const st = activeStreaks(pgc, { "3975": "Stephen Curry", "9": "Broke It" }, { carry, featlive });
    const c3 = st.find((s) => s.id === "3975" && s.key === "three"), c10 = st.find((s) => s.id === "3975" && s.key === "pts10"), b3 = st.find((s) => s.id === "9" && s.key === "three");
    const plain = activeStreaks(pgc, { "3975": "Stephen Curry" }).find((s) => s.id === "3975" && s.key === "three");   // 3 < the page's 8: not listed without the carry
    ok(c3.length === 95 && c3.thisSeason === 3 && c3.carried === 92 && c3.carriedFrom === "list" && c3.since === "2024-12-21"
      && c10.length === 15 && c10.carriedFrom === "logs" && c10.since === "2026-01-15"
      && !b3 && plain === undefined,
      "0.145.0: a run that covers every game this season goes on from last season (the Records page's count where it has one); one broken this season carries nothing and stays under the page's minimum",
      JSON.stringify({ c3, c10, b3 }));
  }
  // 0.145.0: one chance per chase (the consistency audit, 11/24: Paul George's 2,500 threes read 19% and 32%).
  {
    const { oneChance } = await import("../src/anticipate/onechance.js");
    const { tonightChances } = await import("../src/records/predictions.js");
    const watch = { teams: [{ team: "BOS", items: [
      { espnId: "4251", player: "Paul George", stat: "fg3m", target: 2500, current: 2495, pTonight: 0.194, pTonightRaw: 0.235, pNext5: 0.996, pPlayTonight: 0.97 },
      { espnId: "7", player: "Rival Chaser", stat: "pts", target: 1001, current: 990, pTonight: 0.5, pTonightRaw: 0.5 },
      { espnId: "8", player: "Two Marks", stat: "pts", target: 5000, current: 4990, pTonight: 0.6, pTonightRaw: 0.6 }] }] };
    const rec = { items: [
      { kind: "round", id: "4251", who: "Paul George", team: "BOS", stat: "fg3m", now: 2495, target: 2500, need: 5, tonight: true, pTonight: 0.319, pTonightRaw: 0.336, pNext5: 0.998, pPlay: 0.97 },
      { kind: "pass", id: "7", who: "Rival Chaser", team: "BOS", stat: "pts", now: 990, target: 1001, need: 11, tonight: true, pTonight: 0.3, pTonightRaw: 0.32, rivals: [{ name: "R", tonight: true }] },
      { kind: "franchise", id: "8", who: "Two Marks", team: "BOS", stat: "pts", now: 4400, target: 5000, need: 600, tonight: true, pTonight: 0, pTonightRaw: 0 }] };
    const r = oneChance(rec, watch);
    const [pg, rc, tm] = rec.items, w = watch.teams[0].items;
    const kept = tonightChances(rec).find((x) => x.id === "4251");
    ok(r.matched === 2 && r.fromMilestones === 1 && r.fromRecords === 1
      && pg.pTonight === 0.194 && pg.pNext5 === 0.996 && pg.chanceFrom === "milestones" && pg.own.pTonight === 0.319 && kept.pTonight === 0.336
      && w[1].pTonight === 0.3 && w[1].chanceFrom === "records" && w[1].own.pTonight === 0.5 && rc.pTonight === 0.3
      && tm.pTonight === 0 && !tm.chanceFrom && w[2].pTonight === 0.6,
      "0.145.0: the same chase publishes one chance: the milestones' unless the records simulate a rival who also plays; the records still score their own raw chance; a franchise mark with the same target number as a career one is a different chase",
      JSON.stringify({ r, pg, rc: rc.pTonight, w1: w[1], kept }));
  }
  // 0.141.0: luck, paradox, scarcity, defense by position (src/anticipate/detectors.js).
  {
    const D = await import("../src/anticipate/detectors.js");
    // Ten teams. LCK wins every close game and loses big: 6-4, 6×(+1) and 4×(−16) = −58.
    const rowsD = [], tris = ["LCK", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    let day = 1; const dt = () => `2026-11-${String(day++).padStart(2, "0")}`;
    for (let k = 0; k < 6; k++) rowsD.push({ id: `w${k}`, d: dt(), h: "LCK", a: tris[1 + k], hs: 101, as: 100, hq: [25, 25, 25, 26], aq: [25, 25, 26, 24] });
    for (let k = 0; k < 4; k++) rowsD.push({ id: `l${k}`, d: dt(), h: tris[1 + k], a: "LCK", hs: 120, as: 104, hq: [30, 30, 30, 30], aq: [26, 26, 26, 26] });
    for (let k = 0; k < 40; k++) { const h = tris[1 + (k % 9)], a = tris[1 + ((k + 3) % 9)]; if (h !== a) rowsD.push({ id: `x${k}`, d: dt(), h, a, hs: 110, as: 100, hq: [27, 27, 28, 28], aq: [25, 25, 25, 25] }); }
    const TL = D.teamLuck(rowsD), lck = TL.find((l) => l.team === "LCK");
    ok(lck && /^LCK is 6-4 with a point differential of -58 \(-5\.8 a game\), which usually makes an? \d+-\d+ team: [\d.]+ wins more than its scoring margin says, the most above it in the NBA \(6-0 in games decided by 5 or fewer\)$/.test(lck.text),
      "detectors (0.141): a record far above what the point differential usually makes is said, with the close games", JSON.stringify(TL.map((l) => l.text)));
    const SC = D.scarcity(rowsD), only = SC.find((l) => l.team === "LCK" && /decided by 5/.test(l.text));
    ok(only && /^LCK is 6-0 in games decided by 5 or fewer: the only team unbeaten in games decided by 5 or fewer$/.test(only.text), "detectors (0.141): scarcity names the only team (or the few) meeting a condition", JSON.stringify(SC.map((l) => l.text)));
    // Shooting: a 35% career shooter at 50% on 60 threes; paradox: 30+ four times, all losses.
    const G = (n, f) => Array.from({ length: n }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, team: "B", opp: "C", min: 34, pts: 20, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, win: true, ...f(i) }));
    const pgS = { s1: G(10, () => ({ fg3m: 3, fg3a: 6 })), s2: G(10, (i) => (i < 4 ? { pts: 32, win: false } : { pts: 15, win: i % 2 === 0 })) };
    for (let k = 0; k < 6; k++) pgS[`f${k}`] = G(10, () => ({ fg3m: 2, fg3a: 5 }));   // shooters near their norm
    const seasonsS = { keys: ["season", "g", "fg3m", "fg3a", "ftm", "fta"], players: { "Hot Hand": [["2025-26", 70, 140, 400, 100, 120]], ...Object.fromEntries(Array.from({ length: 6 }, (_, k) => [`Steady ${k}`, [["2025-26", 70, 160, 400, 100, 120]]])) } };
    const namesS = { s1: "Hot Hand", s2: "Lone Star", ...Object.fromEntries(Array.from({ length: 6 }, (_, k) => [`f${k}`, `Steady ${k}`])) };
    const SL = D.shootingLuck({ pg: pgS, names: namesS, seasons: seasonsS });
    const PX = D.bigGameLosses({ pg: pgS, names: namesS });
    ok(SL.length === 1 && /^Hot Hand is shooting 50\.0% on threes this season \(30-for-60\), against 35\.0% over his career before it \(400 attempts\): 15\.0 points above his own rate, the furthest above among the 7 players with 40\+ attempts$/.test(SL[0].text)
      && PX.length === 1 && /^Lone Star has 4 games of 30\+ points this season \(32\.0 a game in them\), and B is 0-4 in those games \(3-3 in the others\)$/.test(PX[0].text),
      "detectors (0.141): a shooter far from his own career rate on volume (players near theirs are not said); a scorer whose team loses his 30-point games", JSON.stringify({ SL: SL.map((l) => l.text), PX: PX.map((l) => l.text) }));
    // Defense by position: centers score 5 over their averages against DEF; tonight OFF (with a center) plays DEF.
    const pgP = {}, posP = {}, namesP = {};
    for (let k = 0; k < 12; k++) for (const [P, opp] of [["C", "DEF"], ["G", "DEF"], ["C", "OTH"]]) {
      const id = `${P}${opp}${k}`; posP[id] = P; namesP[id] = id;
      pgP[id] = Array.from({ length: 6 }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, team: `T${k}`, opp: i % 2 ? opp : `Z${k}`, min: 30, pts: i % 2 && opp === "DEF" && P === "C" ? 20 : 15 }));
    }
    pgP.big = Array.from({ length: 6 }, (_, i) => ({ d: `2026-11-0${i + 1}`, team: "OFF", opp: "Q", min: 30, pts: 18 })); posP.big = "C"; namesP.big = "Big Man";
    const posGroupT = (p) => p;
    const DP = D.defenseByPosition({ pg: pgP, names: namesP, positions: posP, posGroup: posGroupT, slate: [{ away: "OFF", home: "DEF" }] });
    ok(DP.length === 1 && /^Opposing centers have scored [\d.]+ points a game more than their own averages against DEF \(36 games of 15\+ minutes\), the most in the NBA; tonight: Big Man \(18\.0 a game\)$/.test(DP[0].text) && DP[0].team === "OFF",
      "detectors (0.141): what a defense gives up to one position, against those players' own averages, said for tonight's opponent with its players at that position", JSON.stringify(DP.map((l) => l.text)));
  }
  // 0.135: outliers against the group tonight's opponent is in. Home teams win every game here, so T01 has the best
  // record and defense and T30 the worst. "Feaster" (T14) scores 30 against T26-T30 and 10 against everyone else.
  {
    const { GROUPS } = await import("../src/situations/edges.js");
    const tf = Object.fromEntries(tris.map((t) => [t, { keys: ["min", "pts"], names: { [`q${t}`]: `Steady ${t}`, ...(t === "T14" ? { feast: "Feaster" } : {}) }, games: [] }]));
    for (const g of rows) for (const [t, o, home] of [[g.h, g.a, 1], [g.a, g.h, 0]]) {
      const pl = { [`q${t}`]: [30, 12] };
      if (t === "T14") pl.feast = [32, ix(o) >= 25 ? 30 : 10];
      tf[t].games.push({ d: g.d, opp: o, home, pf: home ? g.hs : g.as, pa: home ? g.as : g.hs, pl });
    }
    const EG = edges({ rows, names, tonight: [{ away: "T14", home: "T30" }, { away: "T14", home: "T15" }], teamFiles: tf });
    const fl = EG.games[0].items.filter((i) => i.player === "Feaster"), mid = EG.games[1].items.filter((i) => i.cats);
    ok(GROUPS.map((g) => g.cat).join() === "topdef,botdef,toprec,botrec" && fl.length === 1 && fl[0].cats.includes("botrec") && fl[0].cats.includes("botdef")
      && /^Feaster has averaged 30\.0 points in \d+ games against the (5 worst records|bottom 5 defenses) and 10\.0 in his other \d+ \(\+20\.0\), the biggest rise in the NBA; the T30 are (0-29|\d+\w\w in defensive rating)\. Against the (5 worst records|bottom 5 defenses): 30\.0/.test(fl[0].text)
      && !mid.some((i) => i.player === "Feaster"),
      "matchup edges (0.135): a player's outlier against a group tonight's opponent is in gets one line, naming every group (bottom defense and worst record); against a mid-table team, none", JSON.stringify({ fl, mid: mid.map((i) => i.text) }));
  }
  // A printed mark with no game ("Done 2 times"): the record line and the table say how often, not a date.
  const recs = { teams: { AAA: [{ stat: "oreb", kind: "most", period: "game", value: 29, games: [], times: "2 times" }] } };
  const bx = (oreb) => [40, 85, 10, 30, 20, 25, oreb, 30, 25, 8, 5, 13, 20];
  const L5 = BRL5(recs, [{ d: "2026-11-10", h: "AAA", a: "BBB", hs: 110, as: 100, hb: bx(30), ab: bx(9), hq: [28, 27, 28, 27], aq: [25, 25, 25, 25] }], "2026-11-01", "2026-11-17").map((l) => l.text);
  ok(L5.length === 1 && /^AAA had 30 offensive rebounds on 11\/10 \(BBB\): the most in a game in franchise history, by its media guide \(was 29, 2 times\)$/.test(L5[0]) && BT5(recs).some((r) => r[0] === "AAA" && r[2] === "29 (2 times)"),
    "team records (0.95): a mark the guide gives without a game is still a mark", JSON.stringify([L5, BT5(recs)]));
  // Pages.
  const rd5 = (f) => fs.readFileSync(path.join(root, "docs", f), "utf8"), sit5 = rd5("situations.html"), def5 = rd5("defenses.html"), idx5 = rd5("index.html");
  const every = (html, id, n) => { const m = html.match(new RegExp(`<select id="${id}">(.*?)</select>`)); return !!m && Array.from({ length: n }, (_, i) => i + 1).every((k) => new RegExp(`<option[^>]*>${k}(?:\\+| games?)?</option>`).test(m[1])); };
  ok(/id="leagueRow"/.test(sit5) && !/>League<\/th>/.test(sit5.split("$(\"tonight\").innerHTML")[1].split("</table>")[0]) && every(def5, "n", 10) && every(def5, "pn", 10) && every(rd5("clutch.html"), "mingp", 5) && every(rd5("records.html"), "games", 10)
    && /data-v="types"/.test(def5) && /li\.edge/.test(idx5) && /i\.edge \? ' class="edge"'/.test(idx5) && fs.existsSync(path.join(root, "docs", "lib", "espn", "misc.js"))
    && fs.readFileSync(path.join(root, "docs", "lib", "espn", "misc.js"), "utf8") === fs.readFileSync(path.join(root, "src", "espn", "misc.js"), "utf8"),
    "pages (0.95): the league's win rates are said once above tonight's matchup cards, not as a column on each; the Top-N and count dropdowns offer every value (1-10 for the top defenses and records); the vs top teams page has a Scoring by type view; the Watch List marks the lopsided lines; the page's copy of the reader is the build's");
}

// ---------- 0.154.0: from the 11/24 simulation (past-date builds) ----------
{
  const { streakScore } = await import("../src/anticipate/tonight.js");
  // a streak's score levels off below 6 (records and milestones top out about there); short runs score as before (length × weight / 5)
  ok(streakScore(6) === 1.2 && streakScore(20) === 4 && streakScore(142 * 0.4) < 6 && streakScore(346 * 0.4) < 6 && streakScore(346 * 0.4) > streakScore(142 * 0.4),
    "briefing (0.154.0): a long streak of a routine line ranks near the top, not miles above it (Tatum's 142 straight 10+ point games scored 11.4)");
  const sit = fs.readFileSync(path.join(root, "scripts", "situations.js"), "utf8");
  ok(/allGames\(store\)\.filter\(\(g\) => !g\.d \|\| g\.d <= through\)/.test(sit), "situations (0.154.0): the season's results are cut at yesterday, so a build for an earlier date doesn't count later games");
  const fr = fs.readFileSync(path.join(root, "tools", "fetch-rotations.mjs"), "utf8");
  ok(/from "\.\.\/src\/season\.js"/.test(fr) && !/"2026-27"\)/.test(fr) && /incomplete/.test(fr) && /RETRY_DAYS = 7/.test(fr) && !/LOOSE_BALLS_RECOVERED \?\? r\.BOX_OUTS/.test(fr),
    "rotations pull (0.154.0): the season from src/season.js; a game NBA.com hadn't finished posting is marked and read again for 7 days; loose balls no longer fall back to box-outs");
  const ix = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8"), bn = ix.match(/function bigNum\(t\) \{[\s\S]*?\n\}/);
  const bigNum = bn ? new Function(`${bn[0]}; return bigNum;`)() : null;
  ok(bigNum && bigNum("DET 1-2 in 3 games")?.[0] === "1-2" && bigNum("Doncic (4, 1/9-1/16/19) to post") === null && bigNum("10 points (4-7 FG, 2-4 3FG)") === null,
    "Spotlight (0.154.0): a tile's big number is a record, not a date range or a shooting split");
}

// 0.155.0: the Spotlight with no filter is a short list (the user, 11/24: "Please", to the layout drawn after the simulation)
{
  const ix = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8");
  ok(/const SPOT_BASE = 8, SPOT_MAX = 20;/.test(ix) && /PER_GAME = Math\.max\(3, Math\.ceil\(SIZE \/ Math\.max\(1, games\.length\)\)\)/.test(ix) && /\(l\.player && \(byPlayer\[l\.player\] \|\| 0\) >= 2\)/.test(ix)
    && /id="bygame"/.test(ix) && /id="rankedMore"/.test(ix) && /const RANK_PAGE = 50;/.test(ix) && /const rest = shown\.filter\(\(l\) => !tiles\.includes\(l\) && !inCards\.has\(l\)\);/.test(ix),
    "Spotlight (0.155.0): with no filter, 8 + 1 a game (at most 20), 2 a player, a share per game, one of each kind of streak; then each game's best 3; then the ranked list 50 at a time; every line still on the page");
}

// 0.156.0: the postseason pull, and a game whose NBA.com rotation is missing filled from ESPN's play-by-play
{
  const fr = fs.readFileSync(path.join(root, "tools", "fetch-rotations.mjs"), "utf8"), lu = fs.readFileSync(path.join(root, "scripts", "lineups.js"), "utf8");
  ok(/SeasonType=\$\{name\}/.test(fr) && /\["pi", "PlayIn"\], \["p", "Playoffs"\]/.test(fr) && /path\.join\(OUT, "post"\)/.test(fr) && /todayMonth >= 4 && todayMonth <= 7/.test(fr)
    && /filter\(\(x\) => \/\^g-\\d\+\\\.json\$\/\.test\(x\)\)/.test(lu) && /from "\.\.\/src\/season\.js"|import\("\.\.\/src\/season\.js"\)/.test(lu),
    "rotations pull (0.156.0): play-in and playoff games are read (April-July, or --post) into post/, apart from the regular season the Lineups page and award checks read; lineups.js takes the season from src/season.js");
  const BX = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "boxchecks", "2026-11-18-MIL-MIA.json"), "utf8"));
  const secs = (t) => BX.teams[t].reduce((a, r) => a + (+r[1].split(":")[0]) * 60 + (+r[1].split(":")[1]), 0), col = (t, c) => BX.teams[t].reduce((a, r) => a + r[BX.cols.indexOf(c)], 0);
  ok(secs("MIL") === 14400 && secs("MIA") === 14400 && col("MIL", "pts") === 130 && col("MIA", "pts") === 137 && col("MIL", "pm") === -35 && col("MIA", "pm") === 35,
    "box check (0.156.0): the hand-read MIL-MIA box adds up: 240:00 a team, 130 and 137 points, plus-minus -35 and +35");
  const R = JSON.parse(fs.readFileSync(path.join(root, "history", "nbacom", "2026-27", "g-0022600260.json"), "utf8"));
  const played = (t) => R.rot[t].reduce((a, s) => a + (s[3] - s[2]), 0);
  ok(played("MIL") === 144000 && played("MIA") === 144000 && /ESPN play-by-play/.test(R.rotFrom || "") && !(R.incomplete || []).some((x) => x.startsWith("rot")),
    "lineups (0.156.0): MIL-MIA 11/18's rotation, missing on NBA.com, is rebuilt from ESPN's play-by-play: five players a side for all 48 minutes");
}

// ---------- 0.157.0: a notes line's age against its importance (the user, 11/25) ----------
{
  const F = await import("../src/notes/facts.js");
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const days = ["2026-10-21", "2026-10-24", "2026-10-26", "2026-10-28", "2026-10-31", "2026-11-02", "2026-11-04", "2026-11-07", "2026-11-09", "2026-11-11", "2026-11-13", "2026-11-16", "2026-11-18", "2026-11-21", "2026-11-23"];
  const row = (pts) => { const r = keys.map(() => 0); r[1] = 30; r[2] = pts; return r; };
  const box = { keys, names: {}, games: days.map((d) => ({ d, opp: "BOS", home: true, pf: 1, pa: 0, pl: { 7: row(13), 9: row(28) } })) };
  const T = (text, today, extra = {}) => F.trimReason({ text, ...extra }, { box, today });
  const green = "Recorded multiple blocks in consecutive games (Nov. 2 and Nov. 4) for the first time in his career.";
  // the user's case: a career first, three weeks on, is cut; the day after it happened it is kept, and a week on it's cut
  ok(T(green, "2026-11-25", { playerId: "7" }) === "past one-off (21 days ago, 8 games since)" && T(green, "2026-11-05", { playerId: "7" }) === null && /^past one-off/.test(T(green, "2026-11-12", { playerId: "7" }) || ""),
    "notes (0.157.0): a run told in the past tense with its dates is over once the team has played past it: Jalen Green's two-game blocks note is cut three weeks on, kept the day after", T(green, "2026-11-25", { playerId: "7" }));
  // a live streak ("has … straight") and a count still growing stay open
  ok(T("Has recorded multiple blocks in five straight games (Nov. 13-23), the longest streak of his career.", "2026-11-25", { playerId: "7" }) === null,
    "notes (0.157.0): a streak told as still going (\"has … straight\") stays");
  const nba = "Became the first player in NBA history to record 23 points, 14 rebounds and 22 assists in a game vs. DEN (11/13).", team = "Became the first rookie in Bulls history to tally four steals and four 3FGM in a game vs. PHI (11/13).", recap = "Scored 25 points at New Orleans on Nov. 13.",
    pass = "On Nov. 13 vs. Hornets, passed Tracy McGrady for the 78th most points in NBA history.", high = "Scored a career-high 18 points on 7-10 shooting in a win over New Orleans on 11/13.";
  const S = (text, today, id) => F.closedEvent({ text, playerId: id }, { box, today });
  ok(S(nba, "2026-11-25", "7").days === 14 && S(team, "2026-11-25", "7").days === 10 && S(nba, "2026-11-25", "9").days === 21 && S(team, "2026-11-25", "9").days === 15
    && [green, recap, pass, high].every((x) => S(x, "2026-11-25", "9").recap && S(x, "2026-11-25", "9").days === 7)
    && F.shelfLife("Sharpe recorded 5+ assists in six consecutive contests from 11/4 - 11/16, which set the franchise record.").days === 10 && F.shelfLife("Passed Scott Skiles (1,176) for eighth on the Magic’s all-time free throws made list on Oct. 28 @ Toronto.").recap,
    "notes (0.157.0): shelf lives: a first or record in NBA history 14 days, in team history 10, half as long again for a 20-point scorer; a recap, a career high, a career first and a pass on a list as before");
  // kept longer than a recap, and losing rank on the way
  ok(T(nba, "2026-11-25", { playerId: "7" }) === null && /^past one-off \(12 days ago, 4 games since; a team-history first keeps its place 10 days\)$/.test(T(team, "2026-11-25", { playerId: "7" }) || "") && /^past one-off \(\d+ days ago, 2 games since\)$/.test(T(recap, "2026-11-20", { playerId: "7" }) || "")
    && /^past one-off/.test(T(pass, "2026-11-20", { playerId: "7" }) || "") && /^past one-off/.test(T(high, "2026-11-20", { playerId: "7" }) || "") && /NBA-history first keeps its place 14 days/.test(T(nba, "2026-11-28", { playerId: "7" }) || "")
    && F.agedShare(S(nba, "2026-11-14", "7")) === 0 && Math.abs(F.agedShare(S(nba, "2026-11-21", "7")) - 0.25) < 1e-9 && F.agedShare(S(nba, "2026-11-16", "7")) < 0.01 && F.agedShare(S(nba, "2026-11-27", "7")) === 1 && F.agedShare(S(recap, "2026-11-14", "7")) === 0,
    "notes (0.157.0): an NBA-history first is kept 12 days on where a team first, a recap, a list pass and a career high are cut; it loses rank slowly at first: nothing for two days, under 1% at day 3, a quarter at day 8, all of the penalty at day 14");
  const tn = fs.readFileSync(path.join(root, "scripts", "tonight.js"), "utf8"), nv = fs.readFileSync(path.join(root, "src", "notes", "narrative.js"), "utf8"), sc = fs.readFileSync(path.join(root, "src", "site", "selfcheck.js"), "utf8"), ix = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8");
  ok(/bagOf\(x\) === bag/.test(tn) && /SHELF\.penalty \* old/.test(tn) && /1\.5 \* \(1 - old\)/.test(tn) && /const bioSeason = /.test(nv) && /l\.kind !== "awards"/.test(sc) && /longest\[sk\] !== l/.test(ix),
    "0.157.0: the same words reordered aren't new; the age penalty is applied; a bio header's stray \"Season\" is dropped; an award-eligibility line about a player who is out isn't flagged; the streak tile goes to the longest run");
  const { columnsOf } = await import("../src/notes/narrative.js");
  const cell = (text, x0) => ({ text, x0, x1: x0 + text.length * 4 }), line = (y, ...cells) => ({ y, h: 8, text: cells.map((c) => c.text).join("  "), cells });
  const cols = columnsOf({ page: 1, width: 612, lines: [line(447, cell("G • 6-4 • 186 • NBA G League Ignite/USA • 6th", 300)), line(442, cell("+ Recorded multiple blocks in consecutive games (Nov. 2 and Nov.", 300)), line(438, cell("Season", 520)), line(435, cell("4) for the first time in his career", 300))] });
  ok(!cols.flat().join(" ").includes("Season") && cols.flat().join(" ").includes("Nov. 4)".slice(-2)),
    "notes (0.157.0): \"Season\" under a bio header's \"• 6th\" is not read into the sentence beside it (Phoenix, 11/25: \"Nov. 2 and Nov. Season 4\")", JSON.stringify(cols));
}

// ---------- 0.158.0: from the user's home-page screenshots of 11/25 ----------
{
  const F = await import("../src/notes/facts.js");
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const days = ["2026-10-21", "2026-10-24", "2026-10-26", "2026-10-29", "2026-10-31", "2026-11-02", "2026-11-04", "2026-11-07", "2026-11-10", "2026-11-11", "2026-11-13", "2026-11-16", "2026-11-18", "2026-11-21", "2026-11-23"];
  const box = { keys, names: {}, games: days.map((d) => ({ d, opp: "BOS", home: true, pf: 1, pa: 0, pl: {} })) };
  const T = (text, today, extra = {}, opt = {}) => F.trimReason({ text, ...extra }, { box, today, ...opt });
  const acuffRun = "With 29 points and six assists versus Orlando on Nov. 10th, he recorded his seventh consecutive game with 20+ points and 5+ assists, the second longest streak this season and the fourth longest streak for a rookie in NBA history.";
  const acuff2010 = "Recorded his second game with 20+ points and 10+ assists vs. LAL (11/4), becoming the sixth teenager in NBA history to have multiple 20-10 games.";
  ok(T(acuffRun, "2026-11-25") === "past one-off (15 days ago, 6 games since)" && T(acuffRun, "2026-11-13") === null,
    "notes (0.158.0): a run told in the past tense mid-sentence is over once the team has played past it (Acuff's seven straight through Nov. 10, still shown on 11/25); three days on it is kept, as in the 11/13 review", T(acuffRun, "2026-11-25"));
  const ev = F.closedEvent({ text: acuff2010 }, { box, today: "2026-11-25" });
  ok(ev && ev.age === 21 && ev.days === 14 && ev.why === "an NBA-history first" && /^past one-off \(21 days ago/.test(T(acuff2010, "2026-11-25") || "") && T(acuff2010, "2026-11-12") === null && F.agedShare(F.closedEvent({ text: acuff2010 }, { box, today: "2026-11-12" })) === 0.25,
    "notes (0.158.0): a dated happening led by a past-tense verb is closed even with \"game with\" in it: \"the sixth teenager in NBA history\" keeps its place 14 days and loses rank on the way", JSON.stringify(ev));
  ok(T("One of five players with five consecutive 20+ point games to start the season (10/21 - 10/29).", "2026-11-25", { facts: undefined }) === "past one-off (the start of the season, 27 days ago)"
    && T("Towns recorded his 16th double-double to start the season, which ties him with Domantas Sabonis and Moses Malone for the fifth longest streak to start a season since the 1975-76 season.", "2026-11-25") === null
    && T("One of five players with five consecutive 20+ point games to start the season (10/21 - 10/29).", "2026-11-05") === null,
    "notes (0.158.0): a run \"to start the season\" whose printed dates ended over three weeks ago is cut; one still going, or recent, stays");
  ok(/^a recap from the night of an earlier game/.test(T("Drummond’s double-double in the first half today was the third fastest (14:18) by any Knicks player since 1996-97 (play-by-play era).", "2026-11-25") || "")
    && T("A win tonight would be the team's fifth straight.", "2026-11-25") === null,
    "notes (0.158.0): \"in the first half today was…\" is a recap left in from an earlier night; \"a win tonight would…\" is not");
  const mem = "Minnesota has now made at least 10 threes in 22 consecutive games against Memphis, tying its longest active streak versus any opponent (New Orleans Pelicans).";
  ok(T(mem, "2026-11-25", {}, { opp: "OKC" }) === "a streak against another opponent (Memphis), not tonight's" && T(mem, "2026-11-25", {}, { opp: "MEM" }) === null && T(mem, "2026-11-25") === null,
    "notes (0.158.0): a streak against a team that isn't tonight's opponent is the last opponent's series note; against tonight's it stays");
  ok(T("Only had more than 6 rebounds once over the past 6 games after.", "2026-11-25") === "garbled (cut off mid-sentence)" && T("Has scored 20 or more in 5 straight games and counting.", "2026-11-25") === null,
    "notes (0.158.0): a sentence ending on \"after.\" was cut off by the next column");
  const d1 = F.dedupe([{ text: "Hawkins’ effort matched the most points by any Bulls reserve this season (other: Leonard Miller - 19 points at MIL, 10/23).", player: "Jordan Hawkins", score: 6 },
    { text: "His 19 points off the bench matched the most points by any Bulls reserve this season (previous high: Leonard Miller - 19 points at MIL, 10/23).", player: "Leonard Miller", score: 5 }]);
  const d2 = F.dedupe([{ text: "Giannis Antetokounmpo scored at least 20 points and grabbed 10 rebounds in eight-straight games from October 26 through November 10.", player: "Giannis Antetokounmpo", score: 4 },
    { text: "Bam Adebayo and Giannis Antetokounmpo grabbed at least eight rebounds in nine-straight games from October 26 through November 12.", player: "Bam Adebayo", score: 4 }]);
  ok(d1.length === 1 && /^Hawkins/.test(d1[0].text) && d2.length === 2 && F.commonRun("abc def ghi", "xx DEF, GHI yy") === 8,
    "notes (0.158.0): the same sentence with another opening is one line even when filed under two players (same numbers, 45+ characters in common); two runs that share only their dates' wording are two");
  ok(F.describe("Maxey ranks tied for second most 20-point games in the Eastern Conference and tied for fourth most in the league.", {}).tag === "T-2nd in the East" && F.describe("Wolf ranks 3rd in the NBA with a 52.2% 3PT (24-46) this season.", {}).tag === "3rd in NBA",
    "notes (0.158.0): a rank in a conference is tagged as that, not as a rank in the NBA", F.describe("Maxey ranks tied for second most 20-point games in the Eastern Conference and tied for fourth most in the league.", {}).tag);
  const { whoseNotes } = await import("../src/notes/meta.js");
  const docOf = (names) => ({ pages: [{ lines: names.map((n) => ({ text: `${n} scored 10 points.` })) }] });
  const A = ["Al One", "Bo Two", "Cy Three Jr.", "Di Four", "Ed Five", "Fy Six", "Gus Seven", "Hal Eight", "Ian Nine"], B = ["Jo Ten", "Ky Eleven", "Lu Twelve", "Mo Thirteen", "Ny Fourteen", "Oz Fifteen", "Pat Sixteen", "Quin Seventeen", "Ray Eighteen"];
  const mine = whoseNotes(docOf([...A, B[0], B[1]]), A, B), theirs = whoseNotes(docOf([...B, A[0], A[1]]), A, B);
  ok(mine.own === 9 && mine.opp === 2 && !mine.wrong && theirs.own === 2 && theirs.opp === 9 && theirs.wrong,
    "notes (0.158.0): a file that names the opponent's roster and hardly any of the team's own is the other team's (11/25: the NBA's link for the Cavaliers' notes held the Knicks' file)", JSON.stringify({ mine, theirs }));
  const { columnsOf } = await import("../src/notes/narrative.js");
  const cell = (text, x0) => ({ text, x0, x1: x0 + text.length * 4 }), line = (y, ...cells) => ({ y, h: 8, text: cells.map((c) => c.text).join("  "), cells });
  const cols = columnsOf({ page: 4, width: 612, lines: [line(279, cell("plus 3FG (11/22-11/23; Buzelis, Hield, Jalen Smith also with four-plus 3FGM each on", 57)), line(264, cell("11/22).", 57), cell("3 F G M", 490)), line(155, cell("Jordan Hawkins scored a Bulls career-high 19 points against CLE (11/23).", 192)), line(111, cell("B E N C H P O I N T S", 51))] }).flat().join(" ");
  ok(!cols.includes("3 F G M") && cols.includes("11/22).") && cols.includes("B E N C H P O I N T S"),
    "notes (0.158.0): a chart's letter-spaced label beside a sentence is not read into it; a letter-spaced heading alone on its line is left", cols);
  const fd = fs.readFileSync(path.join(root, "src", "anticipate", "finder.js"), "utf8"), ix = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8"), tn = fs.readFileSync(path.join(root, "scripts", "tonight.js"), "utf8");
  ok(/x\.tied \? "is tied for" : "has"/.test(fd) && /tied: \[\.\.\.ranks\[k\]\.values\(\)\]\.filter\(\(v\) => v === r\)\.length > 1/.test(fd), "finds (0.158.0): two players level on a total are \"tied for\" it");
  ok(/ol\.ranked \{[^}]*display: grid; grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 520px\), 1fr\)\)/.test(ix) && !/ol\.ranked \{[^}]*columns: 2/.test(ix) && /const pick3 = /.test(ix) && /l\.kind !== "awards" && \/\^\(\?:Out\|Doubtful\)/.test(ix) && /l\.kind === "awards" \|\| !\/\^\(\?:Out\|Doubtful\)/.test(ix) && /st\.notes === "wrong file"/.test(ix)
    && /whoseNotes\(doc,/.test(tn) && /opp: e\.opp \}\)/.test(tn),
    "home page (0.158.0): the ranked list reads across then down; a game card's three lines are about different players where it can; an award-eligibility line stays when its player sits; a wrong notes file is said at the top");
}

// ---------- 0.159.0: from the user's ranked-list screenshots of 11/25 ----------
{
  const F = await import("../src/notes/facts.js");
  const P = await import("../src/notes/pdf-layout.js");
  const { withoutTonights, sameLine } = await import("../src/anticipate/briefing.js");
  // a raised "th" 3pt above its number, in smaller type
  const row = (y, h, parts) => parts.map(([x, str, w]) => ({ x, y, h, w, str }));
  const sup = [...row(532.6, 6, [[391, "th", 5]]), ...row(529.5, 9, [[60, "per game, which ranks 6", 331]]), ...row(518.8, 9, [[60, "among NBA centers this season", 130]])];
  const two = [...row(745.9, 5, [[512, "rd", 5]]), ...row(742.8, 7.9, [[40, "the sixth active player and 23", 472], [520, "player in", 40]])];
  const heading = [...row(540, 6, [[300, "th", 5]]), ...row(529.5, 9, [[60, "Thunder on the boards", 100]])];   // no number under it: left alone
  const txt = (items) => P.buildLines(items.map((x) => ({ ...x }))).map((l) => l.text);
  ok(txt(sup)[0] === "per game, which ranks 6th" && txt(sup).length === 2 && /and 23rd\s+player in/.test(txt(two)[0]) && txt(two).length === 1 && txt(heading).length === 2 && txt(heading)[0] === "th",
    "notes PDF (0.159.0): a raised ordinal ending is put back on its number (\"ranks 6\" + a small \"th\" above it reads \"ranks 6th\"; \"23 player\" reads \"23rd player\"); one with no number under it is left", JSON.stringify([txt(sup), txt(two), txt(heading)]));
  const tag = (t, player = null) => F.describe(t, { player, team: !player }).tag;
  ok(tag("Holiday is the second current Trail Blazer to crack the NBA’s all-time scoring top 100—Damian Lillard currently ranks 37th on the list (22,945 points).", "Jrue Holiday") === "NBA history"
    && tag("Lillard passed Kobe Bryant—Lillard now ranks 37th on the all-time list.", "Damian Lillard") === "37th all-time",
    "notes (0.159.0): a rank said of someone else after a dash isn't the line's tag (\"37th all-time\" was Lillard's, on a Holiday line); his own still is");
  ok(tag("Herro is also one of 23 players in the NBA with a combined average of more than 20.0 ppg, 5.0 rpg and 4.0 apg since the 2021-22 campaign.", "Tyler Herro") === "1 of 23 since 2021-22"
    && tag("Domantas Sabonis has proven to be one of the league's leaders in triple-doubles since the 2022-23 season, tallying 51 in that time, which ranks second in the NBA.", "Domantas Sabonis") === "2nd since 2022-23"
    && tag("Booker is one of four players in league history to tally 18,000 points, 3,900 assists and 1,000 three-pointers before turning 30.", "Devin Booker") === "1 of 4 in NBA history"
    && tag("The Knicks 8-for-8 start is tied for the 13th longest streak in the NBA since tracking started.") === "T-13th all-time",
    "notes (0.159.0): a club or a rank \"since the 2021-22 campaign\" is tagged with its span, not \"in NBA history\" or \"all-time\"; real all-time ones are unchanged");
  ok(tag("The Nets are tied for first in the NBA with 11.3 catch-and-shoot 3PM per game and with 12.4 points per game off dribble-handoffs.") === "T-1st in NBA"
    && tag("The Wolves have now held their opponents under 40.0% shooting five time this season, tied with Boston for the most games in the NBA this season.") === "T-1st in NBA"
    && tag("Diabate currently leads the league in all major offensive rebounding statistics; total offensive rebounds (76).", "Moussa Diabaté") === "Leads NBA",
    "notes (0.159.0): first place shared is \"T-1st in NBA\", not \"Leads NBA\"; a sole lead still leads");
  ok(tag("Entered 2026-27 as the only player with 15+ GP to have averaged at least 15.0 rebounds and 6.0 offensive boards per 36 minutes played.", "Oscar Tshiebwe") === "Only one"
    && tag("Giddey is the only guard in the NBA this season to record a half with at least 10 points/10 rebounds/five assists.", "Josh Giddey") === "Only one this season"
    && tag("Ranks second in NBA history amongst qualified players in career 3FG% behind only Steve Kerr.", "Luke Kennard") === "2nd all-time"
    && tag("Has 32 career 20-point triple-doubles, 12th in NBA history.", "Domantas Sabonis") === "12th all-time",
    "notes (0.159.0): \"Entered 2026-27 as the only player…\" isn't \"this season\"; a place on an all-time list is the tag (\"2nd all-time\" was \"Race\", \"12th all-time\" was \"NBA history\")");
  // old recaps
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const days = ["2026-10-21", "2026-10-24", "2026-10-26", "2026-10-29", "2026-10-31", "2026-11-02", "2026-11-04", "2026-11-07", "2026-11-10", "2026-11-11", "2026-11-13", "2026-11-16", "2026-11-19", "2026-11-21", "2026-11-23"];
  const line = (pts, ast) => { const r = Array(keys.length).fill(0); r[1] = 30; r[2] = pts; r[10] = ast; return r; };
  const box = { keys, names: {}, games: days.map((d, i) => ({ d, opp: i === 14 ? "MEM" : "BOS", home: true, pf: i % 4 ? 110 : 90, pa: 100, pl: { 7: line(28, 1.5), 8: line(i < 12 ? 16 : 9, 4) } })) };
  const T = (text, today, opt = {}) => F.trimReason({ text }, { box, today, ...opt });
  const lyles = "The Nov. 6 game marked Lyles' seventh career game with 3+ steals, moving to 5-2 when recording 3+ steals.";
  const ament = "Scored a career-high 18 points with a career-best 9 rebounds in a career-leading 35 minutes of play on Nov. 19 vs. POR.";
  const third = "Logged his third game this season with 15+ REB and a career-high-tying 21 points at Atlanta (Nov. 21).";
  ok(/^past one-off \(1[89] days ago/.test(T(lyles, "2026-11-25") || "") && T(ament, "2026-11-25") === "past one-off (6 days ago, 2 games since)" && T(ament, "2026-11-20") === null && T(third, "2026-11-25") === null && /^past one-off/.test(T(third, "2026-11-29") || "")
    && T("Minnesota has now held their opponents under 100 points three times this season, most recently on Nov. 12.", "2026-11-25") === null && T("Has 3 games this season with 15+ rebounds, the latest on Nov. 16.", "2026-11-25") === null,   // 0.160.0: was Nov. 6; a date over 14 days back is now past whatever the tense
    "notes (0.159.0): a telling of one night in the past tense is a recap whatever counts it carries (\"The Nov. 6 game marked his seventh career game with…\", \"a career-best 9 rebounds … on Nov. 19\"): gone after two games or a week; a count in the present tense stays", JSON.stringify([T(lyles, "2026-11-25"), T(ament, "2026-11-25"), T(third, "2026-11-25")]));
  // a streak count the notes are behind on
  const st = F.statedStreak("Facing Portland on Nov. 16, McDaniels finished with 13 points, extending his 10+ point streak to all 14 games to start the season, second-longest such streak of his career.");
  const mc = F.checkStreaks([{ text: "Facing Portland on Nov. 16, McDaniels finished with 13 points, extending his 10+ point streak to all 12 games to start the season.", playerId: "7" },
    { text: "With 24 points against the Bulls, Dosunmu has extended his 15+ point streak to nine games, the longest such streak of his career.", playerId: "8" }], box);
  ok(st && st.n === 14 && st.key === "pts10" && mc[0].tag === "Now 15 straight" && /The notes are behind: the box scores have it at 15 straight with 10\+ points through 11\/23 \(every game he has played this season\)/.test(mc[0].hook.text)
    && mc[1].tag === "Streak over" && /the notes say 9 straight with 15\+ points; the box scores have 0 through 11\/23/.test(mc[1].hook.text),
    "notes (0.159.0): \"extending his 10+ point streak to all 14 games\" is checked against the box scores like any other streak: behind is said, over is said", JSON.stringify(mc.map((l) => [l.tag, l.hook?.text])));
  // a date written out
  const dc = F.checkDates([{ text: "Tallied a career-high 25 points in his first-career 20-point game versus Memphis (Nov. 24)." }, { text: "Tied his career-high with 3 blocks versus Memphis (Nov. 23)." }, { text: "Made his 1,000th-career three-point field goal in win at Memphis on Nov. 24, 2022." }], box);
  ok(dc[0].hook?.text === "Date check: the box scores have the Grizzlies game on 11/23, not 11/24." && !dc[1].hook && !dc[2].hook,
    "notes (0.159.0): a game's date written out (\"versus Memphis (Nov. 24)\") is checked against the schedule like \"11/24\"; another season's date is left", JSON.stringify(dc.map((l) => l.hook?.text || null)));
  // countdowns
  const R = (text, playerId) => F.reach({ text, playerId }, { box });
  const portis = R("Is 21 assists short from the 1,000th of his career.", "7"), giannis = R("Giannis Antetokounmpo is 46 points short from the 22,000th point of his career.", "7"), wins = R("The Rockets need 6 wins to reach 2,500 in franchise history.", null);
  ok(portis.games === 14 && F.farShare(portis) === 1.4 && giannis.games === 1.6 && F.farShare(giannis) === 0 && F.farShare(R("Klay Thompson is now 16 assists away from tying Ray Allen for third place.", "8")) === 0.5
    && wins.stat === "w" && wins.per === 0.73 && R("Hall is 1 rebound away from 100 career rebounds.", "99") === null && R("Scored 21 points, one shy of his season high.", "7") === null && F.farShare(null) === 0
    && F.farShare({ games: 400 }) === 1.5 && F.farShare({ games: null }) === 1.5,
    "notes (0.159.0): a countdown's distance is its need over his rate this season (21 assists at 1.5 a game: 14 games); within two games' reach it loses nothing, then half a point per doubling, 1.5 at most; no rate, no change", JSON.stringify({ portis, giannis, wins }));
  const tnSrc = fs.readFileSync(path.join(root, "src", "anticipate", "tonight.js"), "utf8"), tjs = fs.readFileSync(path.join(root, "scripts", "tonight.js"), "utf8");
  ok(/score: Math\.min\(4\.8, f\.score\)/.test(tnSrc) && /const rc = reach\(l, \{ box \}\), far = farShare\(rc\);/.test(tjs) && /const score = far > 0 && aged - far < 4\.8 \? aged - far : aged;/.test(tjs) && /reach: far > 0 \? \{ \.\.\.rc, far, /.test(tjs)
    && /const bare = \(x\) => x\.replace\(\/\\b\(\\d\+\)\(\?:st\|nd\|rd\|th\)\\b\/g, "\$1"\)/.test(tjs),
    "notes (0.159.0): the distance comes off the line's score unless it would still be at the storylines' 4.8 ceiling: a chase the scorer rates far above it (Durant on Kobe Bryant, 6.9) keeps its place, an ordinary round number far off doesn't; a line whose only change is a restored ordinal ending isn't new today");
  // the ranked list
  const finds = [{ text: "Myles Turner is tied for the 2nd most blocks in the NBA this season. He ranks 119th in minutes played" }, { text: "Victor Wembanyama has the most blocks in the NBA this season. He ranks 52nd in minutes played" }, { text: "Luka Dončić has 7 40-point games this season: more than any other team has in total (13 teams have none)" }];
  const tonightLines = [{ text: "Myles Turner is tied for the 2nd most blocks in the NBA this season. He ranks 119th in minutes played" }, { text: "Victor Wembanyama has the most blocks in the NBA this season. He ranks 52nd in minutes played · questionable tonight" }];
  const left = withoutTonights(finds, tonightLines);
  const ix = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8"), sj = fs.readFileSync(path.join(root, "scripts", "situations.js"), "utf8");
  ok(left.length === 1 && /Luka/.test(left[0].text) && sameLine("x · questionable tonight") === "x" && withoutTonights(finds, []).length === 3
    && /\.\.\.withoutTonights\(args\.prep\?\.finds \|\| \[\], b\.ranked\)\.filter\(\(l\) => !model\.down\.has\(l\.key\)\)/.test(sj)
    && /const all = SPOT\.game \? \[\.\.\.all0\]\.sort\(\(a, b\) => place\.get\(a\) - place\.get\(b\)\) : firsts;/.test(ix) && /const place = new Map\(all0\.map\(\(l\) => \[l, placeOfFirst\.get\(saidAt\.get\(wordsOf\(l\)\)\)\]\)\);/.test(ix) && /chip\("g", "", `All \$\{firsts\.length\}`/.test(ix),
    "home page (0.159.0): a league-wide find already in tonight's lines is listed once, under its game (17 were doubled on 11/25); the same words under two games are one line in the list of every game, and each game's filter keeps its own", JSON.stringify(left));
}

// ---------- 0.160.0: the user's answers of 11/25 (full names; "rules across all teams") ----------
{
  const F = await import("../src/notes/facts.js");
  const { fullNamed } = await import("../src/anticipate/tonight.js");
  ok(fullNamed({ who: "Brook Lopez", last: "Lopez", text: "Lopez: 6 points from passing Rick Barry (18,395) for 79th all-time" }) === "Brook Lopez: 6 points from passing Rick Barry (18,395) for 79th all-time"
    && fullNamed({ who: "Steve Kerr", last: "Kerr", text: "Kerr: 1 win from passing Mike Dunleavy (613) for 27th in career coaching wins" }).startsWith("Steve Kerr: 1 win")
    && fullNamed({ who: "Spurs", text: "Spurs: 8 straight; a road win tonight makes 9" }) === "Spurs: 8 straight; a road win tonight makes 9"
    && fullNamed({ who: "Nenê", last: "Nenê", text: "Nenê: 3 points from 10,000 career points" }) === "Nenê: 3 points from 10,000 career points"
    && fullNamed({ last: "Lopez", text: "Lopez: 6 points from passing Rick Barry" }) === "Lopez: 6 points from passing Rick Barry",
    "record lines (0.160.0): the full name is the record's own (\"Brook Lopez: 6 points from…\", coaches too); a team's line, a one-name player and an item with no full name on file keep their text");
  const tn = fs.readFileSync(path.join(root, "src", "anticipate", "tonight.js"), "utf8"), sj = fs.readFileSync(path.join(root, "scripts", "situations.js"), "utf8");
  ok(/const said = fullNamed\(i\);/.test(tn) && /\.\.\.\(said !== i\.text \? \{ was: `\$\{i\.text\} \(\$\{pct\(p\)\} tonight\)` \} : \{\}\)/.test(tn) && /\.\.\.\(l\.was \? \{ was: `\$\{l\.was\} · questionable tonight` \} : \{\}\)/.test(tn)
    && /if \(!\(lineKey\(l\) in seen\) && lineKey\(o\) in seen\) seen\[lineKey\(l\)\] = seen\[lineKey\(o\)\];/.test(sj) && /if \(!\(claimKeyOf\(l\) in ledgerSeen\) && claimKeyOf\(o\) in ledgerSeen\) ledgerSeen\[claimKeyOf\(l\)\] = ledgerSeen\[claimKeyOf\(o\)\];/.test(sj)
    && tn === fs.readFileSync(path.join(root, "docs", "lib", "anticipate", "tonight.js"), "utf8"),
    "record lines (0.160.0): a renamed line carries its old wording so the build keeps its first-seen date and its history (it isn't new today)");
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const days = ["2026-10-21", "2026-10-24", "2026-10-26", "2026-10-28", "2026-10-30", "2026-11-01", "2026-11-04", "2026-11-07", "2026-11-10", "2026-11-12", "2026-11-14", "2026-11-16", "2026-11-19", "2026-11-21", "2026-11-23"];
  const box = { keys, names: {}, games: days.map((d) => ({ d, opp: "BOS", home: true, pf: 1, pa: 0, pl: {} })) };
  const T = (text, today, extra = {}) => F.trimReason({ text, ...extra }, { box, today });
  const simons = "Anfernee Simons is the first 76er in franchise history to make at least five three-pointers off the bench in three consecutive games (10/28 vs. IND (6-10 3FG), 10/30 vs. BOS and 11/1 vs. BKN).";
  const ftm = "Chicago recorded 20-plus FTMs in eight-straight games (10/21-11/4), which is the second-longest streak in the NBA this season (NOP, 10-straight).";
  const held = "In holding the Mavericks to just 94 points on Nov. 12, Minnesota has now held their opponents under 100 points three times this season, one of six teams that have recorded three or more such games.";
  ok(T(simons, "2026-11-25") === "past one-off (its latest date is 24 days old; what it counts is as of then)" && T(simons, "2026-11-10") === null
    && T(ftm, "2026-11-25") === "past one-off (its latest date is 21 days old; what it counts is as of then)" && T(ftm, "2026-11-16") === null
    && T(held, "2026-11-25") === null && /^past one-off \(its latest date is 15 days old/.test(T(held, "2026-11-27") || ""),
    "notes (0.160.0): whatever its wording, a line whose own latest date is more than 14 days back is past (\"is the first 76er…\" at 24 days, \"which is the second-longest streak\" at 21); inside 14 days a standing count stays", JSON.stringify([T(simons, "2026-11-25"), T(ftm, "2026-11-25"), T(held, "2026-11-27")]));
  ok(T("Hawkins’ effort matched the most points by any Bulls reserve this season (other: Leonard Miller - 19 points at MIL, 10/23).", "2026-11-25") === null
    && T("This is just the second time in the play-by-play era the Warriors have had four consecutive comeback wins after trailing by 10-or-more points, the other time coming from Oct. 26 to Nov. 1.", "2026-11-25") === null
    && T("Deni Avdija is shooting 64.1% from the field over his last 4 games (since 10/13).", "2026-11-25") === null
    && T("The Bulls attempted 47 free throws at TOR (10/21), the most FTA in a regulation game for the team since Dec. 12, 2014.", "2026-11-25") === null
    && T("Is 21 assists short from the 1,000th of his career after his five assists on Oct. 28.", "2026-11-25", { kind: "next" }) === null
    && T("Has started 103 consecutive regular season games, the longest active streak on the team (began Oct. 26).", "2026-11-25", { hook: { text: "x", live: true } }) === null
    && F.eventDate("Made his 1,000th-career three-point field goal in win at Minnesota on Nov. 9. 2022, joining Steve Nash.", { today: "2026-11-25" }) === null
    && !/10\/23/.test(F.ownDates("matched the most (other: Leonard Miller - 19 points at MIL, 10/23)")) && /11\/4/.test(F.ownDates("in eight-straight games (10/21-11/4)")),
    "notes (0.160.0): the age rule goes by the line's own dates, not a comparison's (\"other: … 10/23\", \"the other time coming from…\", \"since 10/13\"); a countdown, a streak the box scores still carry, a mark rare over ten years and another season's date (\"Nov. 9. 2022\") are left alone");
}

// ---------- 0.161.0: three games on each side for a line against a group (the user, 11/25) ----------
{
  const V = await import("../src/situations/vsplayers.js"), { EDGE } = await import("../src/situations/edges.js");
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const L = (pts) => keys.map((k) => ({ min: 36, pts, fgm: 6, fga: 18 }[k] ?? 0));
  const run = (opp) => V.vsDefenses(V.playerGames({ AAA: { team: "AAA", keys, names: { 1: "Star" }, games: opp.map((o, i) => ({ d: `2026-11-0${i + 1}`, opp: o, home: true, pf: 100, pa: 90, pl: { 1: L(o === "TOP" ? 14 : 21) } })) } }), new Set(["TOP"]));
  const two = run(["TOP", "TOP", "BBB", "CCC", "DDD", "EEE"]), three = run(["TOP", "TOP", "TOP", "BBB", "CCC", "DDD"]), twoRest = run(["TOP", "TOP", "TOP", "TOP", "CCC", "DDD"]);
  const ed = fs.readFileSync(path.join(root, "src", "situations", "edges.js"), "utf8");
  ok(V.POOL_MIN_SIDE === 3 && EDGE.minVs === undefined && two.rows.length === 0 && two.oneSided === 1 && three.rows.length === 1 && three.rows[0].vsGp === 3 && three.rows[0].gap === -7 && twoRest.rows.length === 0
    && /x\.vsTop\?\.games >= floors\.vs && x\.rest\?\.games >= floors\.rest/.test(ed),   // 0.162.0: the floors grow with the pool
    "matchups (0.161.0): a player's or a team's line against a group needs three games on each side (\"14.0 points in 2 games against the bottom 5 defenses\" is no longer a line); three is enough", JSON.stringify([two.oneSided, three.rows.length, twoRest.rows.length]));
}

// ---------- 0.162.0: the minimum grows with the pool; a next-game line only for a player doing it now (the user, 11/25) ----------
{
  const V = await import("../src/situations/vsplayers.js"), FB = await import("../src/records/featboards.js");
  ok(V.median([3, 1, 2]) === 2 && V.median([4, 2, 3, 3]) === 3 && V.median([]) === 0 && V.sideMin([2, 3, 3, 4]) === 3 && V.sideMin([14, 13, 15, 12]) === 7 && V.sideMin([5, 6, 7]) === 3 && V.sideMin([7, 7, 7]) === 4
    && JSON.stringify(V.sideFloors([14, 13, 15, 12], [60, 61, 58, 62])) === '{"vs":7,"rest":3}' && JSON.stringify(V.sideFloors([60, 61, 58], [14, 13, 15])) === '{"vs":3,"rest":7}' && JSON.stringify(V.sideFloors([3, 4, 2], [13, 12, 14])) === '{"vs":3,"rest":3}',
    "matchups (0.162.0): the smaller side of a split needs three games, or half of what is typical there among those compared, whichever is more (3 in November, 7 when the typical count is 14); the larger side keeps three");
  const keys = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"];
  const L = (pts) => keys.map((k) => ({ min: 36, pts, fgm: 6, fga: 18 }[k] ?? 0));
  // 26 team games, 12 of them against the group; Star and Mate play all, Late only 4 of the 12 (and all 14 others)
  const opp = Array.from({ length: 26 }, (_, i) => (i < 12 ? "TOP" : `O${i}`));
  const file = { team: "AAA", keys, names: { 1: "Star", 2: "Mate", 3: "Late" }, games: opp.map((o, i) => ({ d: `2027-01-${String(i + 1).padStart(2, "0")}`, opp: o, home: true, pf: 100, pa: 90,
    pl: { 1: L(o === "TOP" ? 14 : 21), 2: L(15), ...(i >= 8 ? { 3: L(o === "TOP" ? 8 : 20) } : {}) } })) };
  const res = V.vsDefenses(V.playerGames({ AAA: file }), new Set(["TOP"]));
  const dh = fs.readFileSync(path.join(root, "docs", "defenses.html"), "utf8");
  ok(res.minVs === 6 && res.minRest === 3 && res.rows.length === 2 && !res.rows.some((r) => r.name === "Late") && res.oneSided === 1
    && /\$\{res\.minVs\}\+ games against them and \$\{res\.minRest\}\+ against the rest/.test(dh),
    "matchups (0.162.0): with twelve games against the group typical, a player with four isn't compared (floor 6); the Defenses page states the floors in use", JSON.stringify([res.minVs, res.minRest, res.rows.map((r) => [r.name, r.vsGp]), res.oneSided]));
  // next-game lines
  const b = { label: "30-point, 10-rebound, 5-assist games", one: "30-10-5 game", min: { pts: 30, reb: 10, ast: 5 } };
  const g = (d, id, team, pts) => ({ d, gameId: id, team, opp: "ZZZ", home: true, pts, reb: 11, ast: 6, starter: 1 });
  const pg = { p1: [g("2026-11-05", "g1", "AAA", 12), g("2026-11-10", "g2", "AAA", 14), g("2026-11-12", "g3", "AAA", 9)],          // on the list, none this season, not the leader
    p2: [g("2026-11-05", "g4", "AAA", 31), g("2026-11-10", "g5", "AAA", 12), g("2026-11-12", "g6", "AAA", 15)],                     // one this season
    p3: [g("2026-11-05", "g7", "AAA", 10), g("2026-11-10", "g8", "AAA", 11), g("2026-11-12", "g9", "AAA", 12)] };                   // the record holder, none this season
  const file2 = { asOf: "2026-11-01", source: "test", boards: { b: { label: b.label, one: b.one, min: b.min, rows: [["Holder Now", "2013-14", "2025-26", 164], ["Old Great", "1960-61", "1970-71", 150], ["Past Star", "2008-09", "2014-15", 40], ["Does It", "2020-21", "2026-27", 39], ["Other Man", "1990-91", "1999-00", 40]] } }, streaks: {} };
  const out = FB.buildFeatLive({ file: file2, pg, names: { p1: "Past Star", p2: "Does It", p3: "Holder Now" }, tonightTeams: new Set(["AAA"]) });
  const who = out.pre.map((p) => p.name).sort().join(), fbSrc = fs.readFileSync(path.join(root, "src", "records", "featboards.js"), "utf8");
  ok(who === "Does It,Holder Now" && /\(1 of his 3 games this season\)$/.test(out.pre.find((p) => p.name === "Does It").line) && /adding to his NBA record/.test(out.pre.find((p) => p.name === "Holder Now").line)
    && out.boards.b.rows.find((r) => r.name === "Past Star").now === 40 && /if \(!n \|\| n\.after < 3 \|\| !\(r\.season > 0 \|\| n\.record\)\) continue;/.test(fbSrc),
    "feat boards (0.162.0): a pre-game line only for a player who has done it this season or would add to a record he holds; one in the top 10 with none this season gets no line, and stays on the board NBA Live counts from", JSON.stringify(out.pre.map((p) => p.line)));
}

// ---------- 0.163.0: the home-page review of 11/25 (20 screenshots): a misprinted notes date, last season's text, bench ranks, tags, labels ----------
{
  const W = await import("../src/notes/watcher.js"), F = await import("../src/notes/facts.js"), N = await import("../src/notes/narrative.js");
  const T = await import("../src/anticipate/tonight.js"), G = await import("../src/gameflow/stats.js"), SL = await import("../src/anticipate/seasonlong.js");
  // a misprinted date
  const stale = W.judge("HOU", { meta: { gameDate: "2026-11-23", opponent: "PHX" } }, false, "2026-11-25", "PHX");
  const hou = [{ d: "2026-11-20", opp: "DEN" }, { d: "2026-11-23", opp: "LAC" }];
  const fixed = W.misprintedDate(stale, { date: "2026-11-25", opponent: "PHX", games: hou });
  const real = W.misprintedDate(stale, { date: "2026-11-25", opponent: "PHX", games: [...hou.slice(0, 1), { d: "2026-11-23", opp: "PHX" }] });
  const other = W.misprintedDate(W.judge("HOU", { meta: { gameDate: "2026-11-23", opponent: "LAC" } }, false, "2026-11-25", "PHX"), { date: "2026-11-25", opponent: "PHX", games: hou });
  const tn = fs.readFileSync(path.join(root, "scripts", "tonight.js"), "utf8"), bd = fs.readFileSync(path.join(root, "src", "site", "build.js"), "utf8");
  ok(stale.status === "stale" && fixed.status === "current" && fixed.misprint.said === "2026-11-23" && fixed.misprint.date === "2026-11-25" && /print the date as 11\/23, when HOU played LAC: a misprint/.test(fixed.why)
    && real.status === "stale" && other.status === "stale" && W.misprintedDate(stale, { date: "2026-11-25", opponent: "PHX", games: [] }).status === "stale"
    && /misprintedDate\(r, \{ date: today, opponent: opp/.test(tn) && /notesDate: e\.notes\?\.misprint \? e\.notes\.misprint\.date : parsed\.meta\.gameDate/.test(bd),
    "notes (0.163.0): notes that name tonight's opponent under a date the team didn't play them on are tonight's with a misprinted date (Houston, 11/25: 'Nov. 23' over the Phoenix game; the 11/23 game was counted twice in Durant's milestone); notes from a real earlier game against the same team, or for another opponent, stay stale; the milestone tracker counts from tonight",
    JSON.stringify([fixed.status, fixed.why, real.status, other.status]));
  // another season's game
  const sas = { team: "SAS", games: [{ d: "2026-11-21", opp: "MEM", pf: 110, pa: 100 }, { d: "2026-11-23", opp: "SAC", pf: 110, pa: 100 }] };
  const dl = [{ text: "On 11/23 in Phoenix, Julian Champagnie set a new career high with 12 rebounds – his second career double-double." }, { text: "On 11/23 in Sacramento, he had 7 rebounds." },
    { text: "Ranks second in Spurs history (11/23) in threes." }, { text: "On 11/23 in San Antonio, he had 7." }, { text: "On 11/24 in Sacramento, he had six threes." }, { text: "On 11/23 in Phoenix, he had his first double-double this season." }];
  F.checkDates(dl, sas);
  const why = dl.map((l) => F.trimReason(l, { box: sas, today: "2026-11-25" }));
  ok(dl[0].dateCheck?.otherSeason && /^an earlier season's game \(on 11\/23 this season the team played SAC, not PHX\)$/.test(why[0]) && !dl[1].dateCheck && !dl[2].dateCheck && !dl[3].dateCheck
    && dl[4].dateCheck?.actual === "2026-11-23" && !dl[4].dateCheck.otherSeason && dl[5].dateCheck?.otherSeason && !/earlier season/.test(why[5] || "") && /earlier season's game/.test(dl[5].hook.text),
    "notes (0.163.0): a game named by its city ('On 11/23 in Phoenix') on a day the team played somebody else, with no game against that team within three days, is another season's: the line is trimmed and says why (San Antonio, 11/25, still carried Champagnie's 11/23/25 game); the team's own city is a home game, 'in Spurs history' isn't a city, a date a day off is still a date check, and a line that says 'this season' stays, flagged",
    JSON.stringify([dl.map((l) => l.dateCheck || null), why]));
  // a last-meeting box under "Last game vs."
  const nsrc = fs.readFileSync(path.join(root, "src", "notes", "narrative.js"), "utf8");
  ok(/\(\?:GAME\|TIME\|MATCHUP\|Game\|Time\|Matchup\|game\|time\|matchup\) \(\?:VS/.test(nsrc)
    && N.summarizeTable("Holiday ranks among the league leaders off the bench in several categories this season, as shown in the table: Category Value NBA Bench Rank Total Bench Points 239 pts 1st Assists 76 ast 2nd 3-Pointers Made 42 3PM t-1st 3-Point Percentage (min. 90 3PA) 44.2% 5th Points Per 36 Minutes 18.4 4th")
      === "Holiday ranks among the league leaders off the bench in several categories this season, as shown in the table: Total Bench Points 239 pts (1st); Assists 76 ast (2nd); 3-Pointers Made 42 3PM (t-1st); 3-Point Percentage 44.2% (5th); Points Per 36 Minutes 18.4 (4th).",
    "notes (0.163.0): 'Last game vs. Nets – April 10, 2026' heads a last-meeting box like 'LAST MEETING' does (Milwaukee, 11/25: last April's 'Green finished with a career-high 35 points' ran as this season's); a table label keeps its '3-' ('3-Pointers Made 42 3PM (t-1st)', not 'Pointers Made')");
  // a stated record the results have moved past
  const mem = { team: "MEM", games: [] }; const seq = "WWWWWWLLLWLWWWWWLW";
  ["10-21", "10-23", "10-25", "10-26", "10-29", "10-31", "11-02", "11-04", "11-06", "11-09", "11-11", "11-13", "11-14", "11-16", "11-18", "11-19", "11-21", "11-23"].forEach((d, i) => mem.games.push({ d: `2026-${d}`, opp: "XXX", pf: seq[i] === "W" ? 110 : 100, pa: 105 }));
  const rl = [{ text: "Memphis moved to 2-0 against Golden State this season and 12-4 overall, the team’s best start since the 2014-15 season." }, { text: "Memphis improved to 13-5 overall." }, { text: "The Grizzlies fell to 3-9 on the season." }, { text: "Memphis moved to 6-0 against the West." }];
  F.checkRecordSaid(rl, mem);
  ok(rl[0].recordCheck?.asOf === "2026-11-19" && rl[0].hook.text === "Record check: the Grizzlies were 12-4 after 11/19; they are 13-5 now." && !rl[1].recordCheck && !rl[2].recordCheck && !rl[3].recordCheck
    && F.trimReason({ ...rl[0] }, { box: mem, today: "2026-11-25" }) == null && /past one-off/.test(F.trimReason({ ...rl[0] }, { box: mem, today: "2026-12-20" }) || ""),
    "notes (0.163.0): a team record said as the season's ('12-4 overall') that the results show at exactly that many games, with games played since, says when it was true and what it is now, and that day dates the line (Memphis, 11/25: 12-4 was after 11/19; 13-5 now); the current record, a record that never was, and a record against part of the league say nothing",
    JSON.stringify(rl.map((l) => [l.recordCheck || null, l.hook?.text || null])));
  // tags
  const tag = (t, p) => F.describe(t, { player: p }).tag;
  const tags = [tag("With three blocks on Nov. 21, Gobert became the 17th NBA player (since blocked shots became an official statistic in 1973-74) to register at least 500 blocks with 2 different teams. Manute Bol is the only player to accomplish the feat with three teams.", "Rudy Gobert"),
    tag("Gobert is the only player in NBA history with four DPOY awards. Ben Wallace is the only other player with three.", "Rudy Gobert"),
    tag("Sharpe owns the highest career offensive rebound percentage in NBA history (18.3%), min. 200 games played, and owns the fourth-highest career field goal percentage (56.3%) in Nets franchise history.", "Day'Ron Sharpe"),
    tag("His 12 threes are the most in franchise history and one of the most in NBA history.", "A B"),
    tag("The Knicks pulled down 50+ rebounds for the sixth time this season, which ties for second in the NBA (Minnesota Timberwolves).", null),
    tag("Memphis leads the NBA in free throw percentage (.854) and is on pace to record the best free throw percentage in a single season in NBA history.", null),
    tag("His 14 blocks tied the most in a game in NBA history and rank second in Spurs franchise history for a half.", "A B")];
  ok(tags[0] !== "Only one" && !/^Only one/.test(tags[0]) && tags[1] === "Only one in NBA history" && tags[2] === "NBA record" && tags[3] === "Team history" && tags[4] === "T-2nd in NBA" && tags[5] === "Leads NBA" && tags[6] === "Ties NBA record",
    "notes tags (0.163.0): an 'only' said of someone else isn't the line's (Gobert's line was 'Only one' for Manute Bol); the best mark in NBA history comes before a franchise rank ('NBA record', not '4th in team history'; the user: an NBA record comes before a franchise record), 'one of the most' is not it, and a tie says so; 'ties for second in the NBA' is T-2nd; a lead held now is 'Leads NBA'",
    JSON.stringify(tags));
  // labels said once
  const m163 = T.buildTonight ? null : null;
  ok(T.labelled("Playoff rematch", "Playoff rematch: the Spurs beat the Trail Blazers 4-1 in the 2025-26 playoffs.") === "Playoff rematch: the Spurs beat the Trail Blazers 4-1 in the 2025-26 playoffs."
    && T.labelled("vs top-5 records · Bam Adebayo", "Bam Adebayo has averaged 11.7 points in 3 games") === "vs top-5 records: Bam Adebayo has averaged 11.7 points in 3 games"
    && T.labelled("Streak vs PHI · 23", "Giannis Antetokounmpo has a double-double in 23 straight games against the 76ers.") === "Streak vs PHI · 23: Giannis Antetokounmpo has a double-double in 23 straight games against the 76ers."
    && T.labelled("Series", "The Knicks lead 2-0") === "Series: The Knicks lead 2-0" && m163 === null,
    "matchup lines (0.163.0): a label is said once ('Playoff rematch: Playoff rematch: the Spurs beat…' and 'vs top-5 records · Bam Adebayo: Bam Adebayo has averaged…' until 11/25)");
  // "the next one…" only for a player with one this season
  const lists = [{ id: "q20", what: "quarters of 20+ points", since: "2016-17", event: { type: "quarter", min: 20 }, source: "Suns game notes for 11/15/26 (Stathead)", through: "2026-11-14", rows: [["Stephen Curry", 31], ["Devin Booker", 29], ["James Harden", 29]] }];
  const S = G.seededCounts(lists, [{ name: "James Harden", pts: 22, date: "2026-11-02" }], { "devin booker": "PHX", "james harden": "CLE", "stephen curry": "GSW" });
  const sl = T.seededLines({ seeded: S }, new Set(["PHX", "CLE"])).map((l) => l.player);
  const oldFile = T.seededLines({ seeded: [{ ...S[0], rows: S[0].rows.map(({ season, ...r }) => r) }] }, new Set(["PHX", "CLE"])).length;
  ok(sl.join() === "James Harden" && S[0].rows.find((r) => r.name === "Devin Booker").season === 0 && oldFile === 2,
    "seeded lists (0.163.0; the user, 11/25, on next-game lines): 'the next one…' is said of a player with one this season (Harden, a 20-point quarter on 11/2), not of one with none (Booker); a stats file written before the count existed says what it did", JSON.stringify([sl, S[0].rows]));
  // a stretch starts where its run starts
  const gm = (s) => [...s].map((c, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, win: c === "W" }));
  const all = gm("LLLWWWWWWWWLLLLLW"), snapped = SL.snapToRuns([all.slice(0, 4), all.slice(4, 11), all.slice(11)]).map((p) => `${p.filter((g) => g.win).length}-${p.filter((g) => !g.win).length}`);
  const even = SL.snapToRuns([gm("WLWL"), gm("WLWW")]).map((p) => p.length);
  ok(snapped.join() === "0-3,8-0,1-5" && even.join() === "4,4",
    "turns (0.163.0): a stretch starts where its run starts (Golden State lost three, won eight, went 1-5: '8-0 in the 8 games before that, after 0-3 to start', where the split said 7-0 after 1-3; the Warriors' notes say 0-3 and then eight wins); a stretch with no lean keeps its edge; whether there is a turn is still decided on the split", JSON.stringify([snapped, even]));
  // the page: tile numbers and labels; a streak-record line's wording
  const ix = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8"), gd = fs.readFileSync(path.join(root, "src", "records", "guide.js"), "utf8"), ks = fs.readFileSync(path.join(root, "scripts", "kalshi.js"), "utf8");
  const bn = new Function(`${(ix.match(/function bigNum\(t\) \{[\s\S]*?\n\}/) || [""])[0]}; return bigNum;`)();
  ok(bn("Anthony Edwards (All-NBA 99% on Kalshi): can miss 3 more games and stay award-eligible under the 65-game rule")?.join() === "3,more games"
    && bn("He’s one of just four players this season to record back-to-back 30-point games while shooting 60% or better from the field") == null
    && bn("Tyler Herro is shooting 62.5% from three over his last 3 games")?.[0] === "62.5%" && bn("Damian Lillard: 2 3-pointers from passing Stephen Curry (63) for 2nd in NBA Cup history")?.join() === "2,threes" && /l\.kind === "feat" && \/\\bhis next\\b/.test(ix) && /esc\(wordOf\(l\)\)/.test(ix)
    && /"tying the best" : "the best"\) : `\$\{ties\.length \? "tied for " : ""\}/.test(gd) && /how: pr\.how, bid: cents\(m\.yes_bid_dollars\), ask: cents\(m\.yes_ask_dollars\)/.test(ks),
    "home page (0.163.0): an award line's tile shows the games he can still miss, not the market price in its label; a bar to clear ('60% or better') isn't a tile's number; '2 threes' over a tile, not '2 3-pointers'; a next-game line's tile is 'Next one', not 'One of one'; 'a win makes 9, tied for the 7th-best…'; the award prices are saved with how each was read",
    JSON.stringify([bn("Anthony Edwards (All-NBA 99% on Kalshi): can miss 3 more games"), bn("shooting 60% or better from the field")]));
}

// ---------- 0.163.0: what the old-against-new run of 11/25 caught in this version's own rules ----------
{
  const F = await import("../src/notes/facts.js");
  // a list of other teams' games in parentheses isn't this team's game
  const min = { team: "MIN", games: [{ d: "2026-11-04", opp: "HOU" }, { d: "2026-11-12", opp: "DAL" }] };
  const L = [{ text: "Minnesota punded the paint against the Mavericks on Nov. 12, recording a season-high 74 points down low, the third-highest paint-point toal in the NBA this season (New Orleans: 80 points; Oct. 29 vs. Sacramento and Denver: 76 points; Nov. 4 vs. Toronto)." },
    { text: "He set a career high with 12 rebounds (11/4 at TOR)." }];
  F.checkDates(L, min);
  // two bars are two facts; the same bar told twice is one
  const k = [{ text: "The Knicks pulled down 50+ rebounds for the sixth time this season, which ties for second in the NBA (Minnesota Timberwolves).", team: true, score: 5 },
    { text: "The Knicks pulled down 40+ rebounds as a team for the 13th time this season, tying for second in the NBA.", team: true, score: 4 },
    { text: "The Knicks have pulled down 50+ rebounds six times this season, tied for second in the NBA.", team: true, score: 3 }];
  const kept = F.dedupe(k).map((l) => l.text.slice(23, 26));
  const tn = fs.readFileSync(path.join(root, "scripts", "tonight.js"), "utf8");
  ok(!L[0].dateCheck && L[1].dateCheck?.otherSeason && kept.join() === "50+,40+" && /mine\[i\] === "3" && skipped < 4/.test(tn),
    "notes (0.163.0, from the old-against-new run): a date inside a list in parentheses ('(New Orleans: 80 points; … Denver: 76 points; Nov. 4 vs. Toronto)') can be another team's game and isn't called another season's (the first cut flagged Minnesota's line), while '(11/4 at TOR)' alone is the line's own; '50+ rebounds for the sixth time' and '40+ rebounds for the 13th time' are two lines now that both are tagged T-2nd, and the same bar told twice is still one; a line whose table label got its '3-' back keeps the day it was first seen",
    JSON.stringify([L.map((l) => l.dateCheck || null), kept]));
}

// ---------- 0.163.0: bench ranks count bench games; a past leader's name as the rosters spell it ----------
{
  const { findings } = await import("../src/anticipate/finder.js");
  const pg = {}, names = {}; let n = 0;
  const add = (name, per, starts = 0) => { const id = String(++n); names[id] = name;
    pg[id] = Array.from({ length: 12 }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, team: `T${n % 30}`, opp: "ZZZ", starter: i < starts ? 1 : 0, min: 24, pts: 8, reb: 3, ast: 2, stl: 0, blk: 0, fg3m: 1, fgm: 3, ftm: 1, pm: 0,
      ...(i < starts ? per.start || per : per.bench || per) })); };
  for (let i = 0; i < 28; i++) add(`Reserve ${i}`, { pts: 7 + (i % 5), reb: 2 + (i % 3), ast: 1 + (i % 3), fg3m: i % 3 }, 0);
  add("Pure Sixth", { pts: 16, ast: 6, fg3m: 3 }, 0);                                                              // never starts: 192 points, 72 assists, 36 threes off the bench
  add("Part Starter", { start: { pts: 30, ast: 9, fg3m: 6 }, bench: { pts: 9, ast: 2, fg3m: 2 } }, 5);            // 5 starts in 12: 213 points in all, 63 off the bench
  add("Nikola Jokić", { pts: 28, reb: 13, ast: 10 }, 12);
  add("New Leader", { pts: 20, reb: 4, ast: 12 }, 12);
  const F = findings({ pg, names, leaders: { ast: [{ season: "2025-26", player: "Nikola Jokic", value: 10.7 }] } });
  const grp = F.filter((x) => x.test === "group").map((x) => x.text), first = F.find((x) => x.test === "first" && /assists/.test(x.text))?.text || "";
  ok(grp.some((t) => /^Pure Sixth off the bench this season \(12 games as a reserve\): 1st in points, 1st in assists, 1st in threes$/.test(t)) && !grp.some((t) => /^Part Starter/.test(t))
    && /last season's leader: Nikola Jokić, 10\.7\)$/.test(first),
    "finder (0.163.0): a bench rank counts what a player did off the bench (11/25: Julian Champagnie, 6 starts in 18, was '1st in threes' with the threes he made as a starter, and Jrue Holiday, who hasn't started, was 2nd in points where Portland's notes have him 1st); a past leader's name is spelled as this season's rosters spell it (Jokić)",
    JSON.stringify([grp, first]));
}

// ---------- 0.164.0: the user's answers of 11/25, 7:22 PM: no Kalshi price on award lines; one streak, one number ----------
{
  const P = await import("../src/anticipate/prep.js"), T = await import("../src/anticipate/tonight.js"), F = await import("../src/notes/facts.js"), E = await import("../src/situations/eligibility.js");
  // an award line names the award, not the market's price
  ok(E.stakeText({ best: "allnba", stake: { allnba: 99 } }) === "All-NBA" && E.stakeText({ best: null, stake: {} }) === "",
    "award eligibility (0.164.0; the user: \"I don't think Kalshi price is needed now\"): an award line says the award ('Anthony Edwards (All-NBA): can miss 3 more games…'), not the market's price; 175 of the 204 award prices on file on 11/25 were last trades with no live quote");
  // every game of the window: the run itself, past the window
  const cols = ["date", "opp", "home", "result", "type", "min", "pts", "reb", "ast", "stl", "blk", "fg3m", "fgm", "fga", "fg3a", "ftm", "fta"];
  const row = (d, opp, reb) => [d, opp, 1, "W", 2, 34, 28, reb, 5, 1, 1, 1, 10, 18, 3, 4, 5];
  const vsPhi = [row("2017-01-16", "PHI", 6), ...Array.from({ length: 23 }, (_, i) => row(`20${18 + Math.floor(i / 3)}-0${(i % 3) + 1}-1${i % 3}`, "PHI", 13))];
  const rest = Array.from({ length: 60 }, (_, i) => row(`20${17 + Math.floor(i / 8)}-1${i % 3}-${10 + (i % 15)}`, "XXX", i % 3 === 0 ? 12 : 7));
  const pgG = { g1: [{ d: "2026-11-23", team: "MIA", opp: "QQQ", min: 34, pts: 28, reb: 7, ast: 5, stl: 1, blk: 1, fg3m: 1 }] };
  const V = P.vsOppLines({ pg: pgG, logs: { columns: cols, players: { g1: [...vsPhi, ...rest] } }, names: { g1: "Giannis Guy" }, games: [{ away: "MIA", home: "PHI" }] });
  const part = P.vsOppLines({ pg: pgG, logs: { columns: cols, players: { g1: [...vsPhi.slice(0, -1), row("2025-04-03", "PHI", 6), ...rest] } }, names: { g1: "Giannis Guy" }, games: [{ away: "MIA", home: "PHI" }] });
  const run = { kind: "matchup", team: "MIA", player: "Giannis Guy", text: "Streak vs PHI · 23: Giannis Guy has a double-double in 23 straight games against the 76ers." };
  const vline = { kind: "vsopp", team: "MIA", player: "Giannis Guy", text: V[0]?.text, every: V[0]?.every };
  ok(/^Giannis Guy has a double-double in each of his last 23 games vs\. PHI \(/.test(V[0]?.text || "") && V[0].every.n === 23 && /a double-double in 19 of his last 20 games vs\. PHI/.test(part[0]?.text || "") && !part[0].every
    && T.withoutSaidRuns([run, vline]).length === 1 && T.withoutSaidRuns([run, vline])[0].kind === "matchup"
    && T.withoutSaidRuns([{ ...run, text: run.text.replace(/23/g, "21") }, vline]).length === 2 && T.withoutSaidRuns([{ ...run, text: "Streak vs PHI · 23: Giannis Guy has 30+ points in 23 straight games against the 76ers." }, vline]).length === 2
    && T.withoutSaidRuns([run, { ...vline, player: "Other Guy" }]).length === 2 && T.withoutSaidRuns([vline]).length === 1,
    "one run, one number (0.164.0; the user: \"the most recent, usually higher number, is most accurate\"): a feat in every one of his last 20 against tonight's opponent is said as the run itself, counted past the 20-game window ('each of his last 23', not '20 of his last 20' beside '23 straight'), and the line goes when a matchup line says the same run for him at least as long; 19 of 20 is said as before; a shorter matchup run, another feat or another player drops nothing",
    JSON.stringify([V[0]?.text, part[0]?.text]));
  // a season-start count under the same streak's count now
  const box = { team: "GSW", games: Array.from({ length: 17 }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, opp: "XXX", pf: 100, pa: 90 })) };
  const L = [{ text: "The Warriors' franchise-record home sellout streak, the fifth-longest in NBA history, is at 614 consecutive games (8 sellouts in 2026-27), regular season, play-in and playoffs.", team: true, type: "streak" },
    { text: "Currently the Warriors have the second-longest active home sellout streak, trailing only Miami, and the fifth-longest all-time streak in NBA history.", team: true, type: "streak" },
    { text: "Entering the 2026-27 season, the Warriors had sold out 606 consecutive home games (Miami, 683).", team: true, type: "streak" },
    { text: "Entering the season, the Warriors had won 12 consecutive home openers.", team: true, type: "streak" },
    { text: "Entering the 2026-27 season, Curry had made a three in 150 consecutive home games.", playerId: "1", player: "Stephen Curry" }];
  const r = F.trimLines(L, { box, today: "2026-11-25" });
  const far = F.trimLines([{ ...L[0], text: L[0].text.replace("614", "700") }, L[2]], { box, today: "2026-11-25" });
  ok(r.keep.length === 4 && r.trimmed.length === 1 && r.trimmed[0].trimmed === "the count entering the season (606); the same streak is at 614 in another line" && far.trimmed.length === 0,
    "notes (0.164.0; the user: \"Sellout streak can't be two different numbers unless it's two different stats\"): a streak's count entering the season goes when another line of the same team or player counts the same thing higher by no more than the games played since (606 entering the season, 614 now); a line with no number, another streak and a player's streak stay, and so does a count too far above to be the same streak",
    JSON.stringify([r.keep.map((l) => l.text.slice(0, 40)), r.trimmed.map((l) => l.trimmed), far.trimmed.length]));
}

// ---------- 0.165.0: no Kalshi price on the Awards page ----------
{
  const aw = fs.readFileSync(path.join(root, "docs", "awards.html"), "utf8");
  const names = new Function(`const AW = { mvp: "MVP", dpoy: "DPOY", mip: "MIP", allnba: "All-NBA", alldef: "All-Def" }, AWS = ["mvp", "dpoy", "mip", "allnba", "alldef"]; ${(aw.match(/const awardNames = [^\n]+/) || [""])[0]} ${(aw.match(/const awardChips = [^\n]+/) || [""])[0]} return [awardNames, awardChips];`)();
  const p = { stake: { mvp: 2, allnba: 99, alldef: 12, dpoy: 9 } };
  ok(names[0](p).join() === "All-NBA,All-Def" && names[1](p) === '<span class="chip aw">All-NBA</span><span class="chip aw">All-Def</span>' && names[0]({}).length === 0
    && !/Award odds|stake\[k\]\}%|Kalshi award prices as of|stakeMax/.test(aw) && /\["stake", "Award"\]/.test(aw) && /no prices are shown/.test(aw),
    "awards page (0.165.0; the user, 11/25: \"You can remove Kalshi odds from awards page\"): the chips and the table name the awards a player is a candidate for (MVP at 3 or more, the others at 10 or more) and show no price; no 'Award odds' column, no price time in the header; nothing sorts by a hidden price",
    JSON.stringify([names[0](p), names[1](p)]));
}

// ---------- 0.166.0: live streak cards on a sliding scale (the user, 11/25: "a six game streak of 10+ points doesn't warrant an alert … sliding scale if you will") ----------
{
  const S = await import("../src/records/streakbars.js"), FL = await import("../src/records/featlive.js"), FB = await import("../src/records/featboards.js"), RS = await import("../src/situations/results.js");
  const zlib = await import("node:zlib");
  const cols = ["date", "opp", "home", "result", "type", "min", "pts", "reb", "ast", "stl", "blk", "fg3m"];
  const row = (d, pts, o = {}) => [d, "XXX", 1, "W", o.type ?? 2, o.min ?? 30, pts, o.reb ?? 3, 2, 0, 0, 1];
  // a player's games: play-in, the Cup's title game, the playoffs and a DNP are not regular-season games played
  const logs = { columns: cols, players: {
    a1: [row("2026-04-08", 12), row("2026-04-10", 14), row("2026-04-15", 4), row("2026-04-19", 3, { type: 3 }), row("2025-12-16", 2), row("2026-04-12", 0, { min: 0 })],
    a2: Array.from({ length: 60 }, (_, i) => row(`2025-${String(1 + Math.floor(i / 20)).padStart(2, "0")}-${String(1 + (i % 20)).padStart(2, "0")}`, i === 9 ? 3 : 20)) } };
  const pgA = { a1: [{ d: "2026-10-21", pts: 11, reb: 2, ast: 1 }, { d: "2026-10-23", pts: 15, reb: 2, ast: 1 }] };
  const career = S.careerGames(logs, pgA), a1 = S.runsOf(career.a1, [{ k: "pts", min: 10 }]), a2 = S.runsOf(career.a2, [{ k: "pts", min: 10 }]);
  ok(career.a1.length === 4 && a1.active.n === 4 && a1.active.start === "2026-04-08" && JSON.stringify(a2.lengths) === "[9,50]" && RS.PLAY_IN_DATES.has("2026-04-15") && RS.PLAY_IN_DATES.has("2022-04-12"),
    "streak bars (0.166.0): a run is counted over regular-season games played, across seasons; a play-in game, the Cup's title game, a playoff game and a DNP are not in it (ESPN's logs file the play-in as regular season: with them in, five of Basketball-Reference's 19 active 10+ point runs were one game long)",
    JSON.stringify([career.a1.map((g) => g.d), a1, a2.lengths]));
  // the bar: the 50th-longest run of the kind, never under three; fewer than 50 runs on file: no bar
  const many = { columns: cols, players: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`m${i}`, [...Array.from({ length: 5 + i }, (_, j) => row(`2025-01-${String(1 + (j % 28)).padStart(2, "0")}T${j}`, 12)), row("2025-03-01", 2)]])) };
  const cm = S.careerGames(many, {});
  ok(S.barOf(cm, [{ k: "pts", min: 10 }]) === 15 && S.barOf(cm, [{ k: "pts", min: 10 }], 10) === 55 && S.barOf(career, [{ k: "pts", min: 10 }]) === Infinity && S.barOf(cm, [{ k: "pts", min: 40 }]) === Infinity
    && S.countable(["dd"]) && S.countable([{ k: "ast", min: 5 }]) && !S.countable(["start"]) && !S.countable([{ k: "pts", min: 10 }, "start"]),
    "streak bars: the bar is the length of the 50th-longest run of the kind on file (60 runs of 5 to 64 games: 15); with fewer than 50 runs there is no bar and no card; a run of starts can't be counted in the history",
    JSON.stringify([S.barOf(cm, [{ k: "pts", min: 10 }]), S.barOf(cm, [{ k: "pts", min: 10 }], 10)]));
  // which run is carded, and when
  const kd = { tests: [{ k: "pts", min: 10 }], label: "10+ points", n: 346, bar: 82 }, kz = { ...kd, n: 5 }, s15 = { tests: [{ k: "pts", min: 15 }], label: "15+ points", n: 167, bar: 41 },
    s10 = { ...kd, n: 233 }, s30 = { tests: [{ k: "pts", min: 30 }], label: "30+ points", n: 6, bar: 6 }, at = { ...kd, n: 81 };
  const say = (x) => (x ? `${x.kind} ${x.run.label} ${x.n1}${x.also.length ? ` +${x.also.map((r) => r.label).join("+")}` : ""}` : null);
  const got = [say(FL.runCard([kz], { pts: 12 })), say(FL.runCard([kz], { pts: 3 }, { fin: true })), say(FL.runCard([kz], { pts: 3 }, { late: true })),
    say(FL.runCard([kd], { pts: 12 })), say(FL.runCard([{ ...kd, n: 349 }], { pts: 12 })), say(FL.runCard([at], { pts: 10 })), say(FL.runCard([kd], { pts: 7 }, { late: true })), say(FL.runCard([kd], { pts: 7 })), say(FL.runCard([kd], { pts: 7 }, { fin: true })),
    say(FL.runCard([s15, s10, s30], { pts: 13 }, { late: true })), say(FL.runCard([s15, s10, s30], { pts: 31 })), say(FL.runCard([s15, s10, s30], { pts: 8 }, { fin: true }))];
  ok(JSON.stringify(got) === JSON.stringify([null, null, null, null, "extended 10+ points 350", "extended 10+ points 82", "danger 10+ points 347", null, "ends 10+ points 346",
      "danger 15+ points 168 +30+ points", "extended 30+ points 7", "ends 15+ points 167 +10+ points+30+ points"])
    && [6, 12, 13, 39, 40, 82].map(FL.runStep).join() === "1,1,5,5,25,25",
    "streak cards (0.166.0): a run under its bar says nothing, whatever happens (10+ points in 6 straight; the bar is 82); a run at its bar is in danger late, ends at the final, and is \"extended\" only on reaching the bar or a round mark (every game for a bar of 12 or under, every 5th to 39, every 25th above); one thing a player, the run furthest past its bar",
    JSON.stringify(got));
  ok(FL.saysRun("Karl-Anthony Towns (NY) — 21 straight double-doubles, dating to last season", "Karl-Anthony Towns", ["dd"]) && !FL.saysRun("Karl-Anthony Towns (NY) — 21 straight double-doubles", "Karl-Anthony Towns", [{ k: "reb", min: 10 }])
    && FL.saysRun("Luka Dončić — 6 straight 30-point games", "Luka Doncic", [{ k: "pts", min: 30 }]) && !FL.saysRun("Luka Dončić — 6 straight 30-point games", "Luka Dončić", [{ k: "pts", min: 25 }])
    && !FL.saysRun("Jalen Brunson (NY) — 21 straight double-doubles", "Karl-Anthony Towns", ["dd"]) && !FL.saysRun("Karl-Anthony Towns — a double-double tonight", "Karl-Anthony Towns", ["dd"]),
    "streak cards: another card tells the same run when it names the player, a run, and the same feat (\"21 straight double-doubles\"); a different feat, bar or player isn't the same run");
  // the build: every player's runs with their bars, a notes run weighed like any other; without the history, none
  const bigLogs = { columns: cols, players: { ...many.players, p1: Array.from({ length: 14 }, (_, i) => row(`2026-03-${String(1 + i).padStart(2, "0")}`, 12, { reb: 11 })) } };
  const pgB = { p1: [{ d: "2026-11-05", gameId: "g1", team: "AAA", opp: "BBB", home: true, pts: 31, reb: 11, ast: 6, starter: 1 }, { d: "2026-11-10", gameId: "g2", team: "AAA", opp: "CCC", home: false, pts: 13, reb: 12, ast: 7, starter: 1 }] };
  const fileB = { asOf: "2026-11-08", source: "test", boards: {}, streaks: {} };
  const nfB = { teams: { AAA: [{ text: "Me Player has started 16 consecutive games.", playerId: "p1", firstSeen: "2026-11-11" }] } };
  const outB = FB.buildFeatLive({ file: fileB, pg: pgB, names: { p1: "Me Player" }, notesFacts: nfB, logs: bigLogs }), none = FB.buildFeatLive({ file: fileB, pg: pgB, names: { p1: "Me Player" }, notesFacts: nfB });
  const r10 = outB.streaks.find((s) => s.label === "10+ points");
  ok(r10 && r10.n === 16 && r10.bar === 8 && r10.everyGame && r10.start === "2026-03-01" && r10.source === "box" && r10.team === "AAA" && outB.bars["10+ points"] === 16 && outB.bars["40+ points"] === null
    && !outB.streaks.some((s) => s.source === "notes") && !none.streaks.length && Array.isArray(outB.unweighed),
    "feat boards (0.166.0; 0.168.0: the league's longest 10+ run has half the bar): the live file carries every player's runs at their bar, counted across seasons (14 games last season and 2 this one: 16), with the bar and the start; no notes run is followed unweighed; without the history on hand nothing is followed",
    JSON.stringify([outB.streaks.map((s) => [s.label, s.n, s.bar]), outB.bars["10+ points"]]));
  // Basketball-Reference's list of 11/24/26 against our own count, on the real files (while they hold that day)
  const chk = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "streak-check-2026-11-24.json"), "utf8"));
  const lf = path.join(root, "src", "data", "player-logs-history.json.gz"), td = path.join(root, "docs", "data", "teams");
  if (fs.existsSync(lf) && fs.existsSync(td)) {
    const real = JSON.parse(zlib.gunzipSync(fs.readFileSync(lf))), pgR = {}, nm = {};
    for (const f of fs.readdirSync(td)) { const b = JSON.parse(fs.readFileSync(path.join(td, f), "utf8")), k = Object.fromEntries(b.keys.map((x, i) => [x, i])); Object.assign(nm, b.names);
      for (const g of b.games) { if (g.d > chk.asOf) continue; for (const [id, l] of Object.entries(g.pl || {})) if (l[k.min] > 0) (pgR[id] ||= []).push({ d: g.d, pts: l[k.pts], reb: l[k.reb], ast: l[k.ast], stl: l[k.stl], blk: l[k.blk], fg3m: l[k.fg3m] }); } }
    const cr = S.careerGames(real, pgR), bad = [];
    const covers = Object.values(pgR).some((gs) => gs.some((g) => g.d === "2026-11-24"));
    for (const [name, n, start] of chk.rows) { const id = Object.keys(nm).find((i) => nm[i] === name), a = id && cr[id] ? S.runsOf(cr[id], chk.tests).active : null; if (!a || a.n !== n || a.start !== start) bad.push(`${name}: ${n} from ${start}, ours ${a ? `${a.n} from ${a.start}` : "none"}`); }
    ok(!covers || !bad.length, "streak bars, the real files (0.166.0): all 19 of Basketball-Reference's active 10+ point runs entering 11/25/26 (the user's screenshot: Kevin Durant 346 from 4/25/21 … Jalen Johnson 31) equal our count and start date", bad.join("; "));
  }
}

// ---------- 0.167.0: play-in games are not regular-season games anywhere ----------
{
  const zlib = await import("node:zlib"), RS = await import("../src/situations/results.js"), MP = await import("../tools/mark-play-in.mjs");
  const fx = { columns: ["date", "opp", "home", "result", "type", "min", "pts"], players: { a: [["2026-04-12", "BOS", 1, "W", 2, 30, 20], ["2026-04-15", "ORL", 1, "W", 2, 34, 31], ["2026-04-19", "BOS", 0, "L", 3, 36, 21]], b: [["2022-04-12", "CLE", 1, "W", 2, 40, 25]] } };
  const first = MP.markPlayIn(fx), again = MP.markPlayIn(fx);
  const lf = path.join(root, "src", "data", "player-logs-history.json.gz");
  let left = -1, marked = -1;
  if (fs.existsSync(lf)) { const L = JSON.parse(zlib.gunzipSync(fs.readFileSync(lf))), ix = Object.fromEntries(L.columns.map((c, i) => [c, i])); left = 0; marked = 0;
    for (const rows of Object.values(L.players)) for (const r of rows) if (RS.PLAY_IN_DATES.has(r[ix.date])) { if (r[ix.type] === 2) left++; else if (r[ix.type] === 5) marked++; } }
  const bf = fs.readFileSync(path.join(root, "tools", "backfill-matchups.js"), "utf8");
  ok(first.n === 2 && again.n === 0 && fx.players.a.map((r) => r[4]).join() === "2,5,3" && fx.players.b[0][4] === 5 && (left === -1 || (left === 0 && marked === 456))
    && /\/play\.\?in\/i\.test\(t\.name\) \? 5/.test(bf),
    "history (0.167.0): play-in games are their own type in the past-seasons player log, in neither the regular season nor the playoffs (ESPN's logs file them as regular season; 456 rows on 16 dates were counted in last season's averages, career marks and runs against one opponent); the back-fill tool reads them that way from now on; marking twice changes nothing",
    JSON.stringify({ first, again, left, marked }));
}

// ---------- 0.168.0: the user's answers on the streak scale (11/26): their bars, the leaders every game, one streak card a player; a pass says its place ----------
{
  const S = await import("../src/records/streakbars.js"), FL = await import("../src/records/featlive.js"), IM = await import("../src/anticipate/importance.js"), NT = await import("../src/records/notable.js");
  const cols = ["date", "opp", "home", "result", "type", "min", "pts", "reb", "ast", "stl", "blk", "fg3m"];
  const row = (d, pts, fg3m = 0) => [d, "XXX", 1, "W", 2, 30, pts, 3, 2, 0, 0, fg3m];
  const day = (i) => `2025-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`;
  // 60 retired-style runs of 10+ points (5 to 64 games, each ended) set the bar at 15; three players are active
  const players = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`m${i}`, [...Array.from({ length: 5 + i }, (_, j) => row(day(j), 12)), row("2025-12-30", 2)]]));
  players.kd = Array.from({ length: 40 }, (_, j) => row(day(j), 22, 1)); players.sg = Array.from({ length: 30 }, (_, j) => row(day(j), 21, 1)); players.cu = Array.from({ length: 49 }, (_, j) => row(day(j), 8, 1));
  const pg = { kd: [{ d: "2026-11-01", pts: 25, reb: 3, ast: 2, fg3m: 1 }], sg: [{ d: "2026-11-01", pts: 24, reb: 3, ast: 2, fg3m: 1 }], cu: [{ d: "2026-11-01", pts: 9, reb: 3, ast: 2, fg3m: 2 }] };
  const R = S.longRuns({ career: S.careerGames({ columns: cols, players }, pg), pg, names: { kd: "Kay Dee", sg: "Ess Gee", cu: "See Three" }, teamOf: () => "AAA" });
  const get = (id, label) => R.runs.find((r) => r.id === id && r.label === label);
  ok(R.bars["a made three"] === 50 && R.bars["a double-double"] === 10 && R.bars["30+ points"] === 5 && R.bars["10+ points"] === 17
    && get("kd", "10+ points")?.leader && get("kd", "10+ points").everyGame && get("kd", "10+ points").bar === 9 && !get("kd", "10+ points").tied
    && get("sg", "10+ points")?.bar === 17 && !get("sg", "10+ points").leader && !get("sg", "10+ points").everyGame
    && get("cu", "a made three")?.n === 50 && get("cu", "a made three").leader && !get("cu", "a made three").everyGame
    && R.leaders["10+ points"].n === 41 && R.leaders["10+ points"].names.join() === "Kay Dee" && R.leaders["a made three"].names.join() === "See Three",
    "streak bars (0.168.0; the user, 11/26): a made three starts at 50, a double-double at 10, 30+ points at 5 (the user's bars; the others stay the 50th-longest); the longest active run of 10+ points (and of 20+) is marked for a card every game, from half the kind's bar; the second-longest is not, and the leader of another kind is named but not marked",
    JSON.stringify([R.bars["a made three"], R.bars["10+ points"], R.runs.map((r) => [r.id, r.label, r.n, r.leader || false, r.everyGame || false]), R.leaders["10+ points"]]));
  const kd = { tests: [{ k: "pts", min: 10 }], label: "10+ points", n: 346, bar: 82 }, s25 = { tests: [{ k: "pts", min: 25 }], label: "25+ points", n: 12, bar: 11 }, s15 = { tests: [{ k: "pts", min: 15 }], label: "15+ points", n: 174, bar: 41 };
  const say = (x) => (x ? `${x.kind} ${x.run.label} ${x.n1}` : null);
  ok(say(FL.runCard([kd], { pts: 12 })) === null && say(FL.runCard([{ ...kd, everyGame: true }], { pts: 12 })) === "extended 10+ points 347"
    && say(FL.runCard([s25], { pts: 31 })) === "extended 25+ points 13" && say(FL.runCard([s25], { pts: 31 }, { quiet: true })) === null
    && say(FL.runCard([s25, s15], { pts: 31 }, { quiet: true })) === "extended 15+ points 175" && say(FL.runCard([{ ...kd, everyGame: true }], { pts: 12 }, { quiet: true })) === "extended 10+ points 347"
    && say(FL.runCard([s25], { pts: 20 }, { quiet: true, late: true })) === "danger 25+ points 13" && say(FL.runCard([s25], { pts: 20 }, { quiet: true, fin: true })) === "ends 25+ points 12"
    && FL.saysAnyRun("Shai Gilgeous-Alexander (OKC) — 7 straight 30-point games", "Shai Gilgeous-Alexander") && !FL.saysAnyRun("Shai Gilgeous-Alexander (OKC) — 32 points tonight", "Shai Gilgeous-Alexander") && !FL.saysAnyRun("Chet Holmgren (OKC) — 7 straight games with a block", "Shai Gilgeous-Alexander"),
    "streak cards (0.168.0; the user, 11/26, with \"25+ points in 13 straight games\" beside NBA Live's \"7 straight 30-point games\": \"why two alerts?\"): while NBA Live's own streak card is up for a player, an every-game \"extended\" card of ours is not added; a long run's round mark, the league leader's card, \"in danger\" and \"ends\" still are; the leader's run is a mark every game");
  // a pass carries its place when the notes say it in words
  const m = { kind: "pass", scope: "franchise", stat: "fg3m", passing: { player: "P.J. Washington Jr.", forWhat: "seventh-most in franchise history" } };
  const wsrc = fs.readFileSync(path.join(root, "src", "anticipate", "watch.js"), "utf8");
  ok(IM.passPlace(m) === 7 && IM.passPlace({ ...m, passing: { player: "X", rank: "3rd" } }) === 3 && IM.passPlace({ ...m, passing: { player: "X", forWhat: "the franchise lead" } }) === null
    && NT.isMinorPass({ ...m, passing: { ...m.passing, rank: IM.passPlace(m) } }) && !NT.isMinorPass(m) && !NT.isMinorPass({ ...m, passing: { player: "X", rank: 3 } })
    && /rank: m\.passing\.rank \?\? \(m\.kind === "pass" \? passPlace\(m\) : null\)/.test(wsrc) && /isMinorPass\(\{ kind: m\.kind, scope: m\.scope, stat: m\.stat, passing \}\)/.test(wsrc),
    "watch list (0.168.0; the user, 11/26, on \"Brandon Miller — passes P.J. Washington Jr. in franchise history (3-pointers)\": \"shouldn't this tell me what place is being passed?\"): a pass whose place the notes give in words (\"for seventh-most in franchise history\") carries the place, so a card can say it, and the rule for which places get a card (franchise: top 3) applies: 7th is a line in the full list, not an NBA Live card; with no place it had slipped through");
}

const snapDir = path.join(root, "tests", "expected");
fs.mkdirSync(snapDir, { recursive: true });
const brief = (m) => [m.player, m.kind, m.stat, m.scope, m.current, m.target, m.need, m.status, m.passing?.player || ""].join(" | ");
const diffs = [];
for (const [team, r] of Object.entries({ ...results, ...more })) {
  const now = r.milestones.map(brief).sort();
  const file = path.join(snapDir, `${team}.json`);
  if (UPDATE) { fs.writeFileSync(file, JSON.stringify(now, null, 1)); continue; }
  // A missing snapshot is a failure, not a silent pass: it has to be created
  // deliberately (and reviewed) with --update.
  if (!fs.existsSync(file)) { diffs.push({ team, added: [`(no saved snapshot: ${now.length} milestones not yet reviewed)`], removed: [] }); continue; }
  const before = JSON.parse(fs.readFileSync(file, "utf8"));
  const added = now.filter((x) => !before.includes(x)), removed = before.filter((x) => !now.includes(x));
  if (added.length || removed.length) diffs.push({ team, added, removed });
}

console.log(`facts & checks: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (diffs.length) {
  console.log(`snapshot: output changed for ${diffs.map((d) => d.team).join(", ")}`);
  for (const d of diffs) {
    for (const a of d.added.slice(0, process.env.ALLDIFF ? 9999 : 15)) console.log(`  + ${d.team} ${a}`);
    for (const r of d.removed.slice(0, process.env.ALLDIFF ? 9999 : 15)) console.log(`  - ${d.team} ${r}`);
  }
  console.log("  Review the changes; if they are improvements run: node tests/run.js --update");
} else console.log(UPDATE ? "snapshot: updated" : "snapshot: unchanged");
process.exit(fail || diffs.length ? 1 : 0);
