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
const sampleDir = path.join(root, "samples", "2026-11-09");
const results = {};
for (const f of fs.readdirSync(sampleDir).filter((f) => f.endsWith(".pdf"))) {
  const team = teamFromSlug(path.basename(f, ".pdf"));
  results[team] = await parseNotes(fs.readFileSync(path.join(sampleDir, f)), { team });
}

const find = (team, player, stat, extra = {}) =>
  results[team]?.milestones.find((m) => sameName(m.player || "", player) && m.stat === stat && Object.entries(extra).every(([k, v]) => (k === "passing" ? sameName(m.passing?.player || "", v) : m[k] === v)));

function fact(name, m, expect) {
  if (!m) return ok(false, name, "not found");
  for (const [k, v] of Object.entries(expect)) ok(m[k] === v, `${name}: ${k}`, `expected ${v}, got ${m[k]}`);
}

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

// ---------- NBA.com lineups and transactions (frozen 2026-11-10) ----------
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
const more = {};
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
  ok(asked.join() === "2026-10-25", "results: a second run asks ESPN only for dates not yet complete", asked.join());

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
    ok(!bad.length && seen.size === 3, "Discord step: scripts/notify.js loads only Node built-ins and our own files (no npm packages run with the secret)", [...seen, ...bad].join(", "));
    // The PC copy has no .github/ (remote tools can't write it there); the check runs where it exists.
    const wfFile = path.join(root, ".github", "workflows", "daily.yml");
    const wf = fs.existsSync(wfFile) ? fs.readFileSync(wfFile, "utf8") : null;
    // Since 0.28.1 the Cloudflare Worker sends the #alerts digest; no GitHub step gets the webhook any more.
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
  ok(team && team.text === "AAA: 4 straight; a win tonight makes 5, tie the best win streak in NBA history (X, then)" && team.tonight, "records: a team streak reaching the NBA's list", JSON.stringify(team));
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
  // Storylines: a record line tonight, unless the notes carry the same milestone.
  const watch = { today: "2026-11-09", games: [{ id: "1", awayTri: "BBB", homeTri: "AAA" }], teams: [] };
  const recs = { today: "2026-11-09", items: [{ ...p2, pTonight: 0.4 }, { kind: "coach", team: "AAA", stat: "wins", need: 1, tonight: true, text: "Coach: 1 win from passing Old Coach (503) for 9th in career coaching wins", score: 3 }] };
  const lines = tonightStorylines({ watch, records: recs })[0].lines.filter((l) => l.kind === "record").map((l) => l.text);
  ok(lines.includes("Gun: 21 points from passing Old Star (29,080) for the NBA record; 20 ties him (40% tonight)") && lines.includes("Coach: a win tonight passes Old Coach (503) for 9th in career coaching wins"),
    "records: tonight's storylines carry them", JSON.stringify(lines));
  const watch2 = { ...watch, teams: [{ team: "AAA", items: [{ player: "Young Gun", stat: "pts", kind: "pass", scope: "nba", target: 29080, need: 21, passing: { player: "Old Star" }, publishable: true, importance: 50, pTonight: 0.4 }] }] };
  const lines2 = tonightStorylines({ watch: watch2, records: recs })[0].lines.map((l) => l.kind);
  ok(lines2.filter((k) => k === "milestone").length === 1 && lines2.filter((k) => k === "record").length === 1, "records: the notes' own version of the same milestone wins (no double line)", JSON.stringify(lines2));
  const facts = { today: "2026-11-09", teams: { AAA: [{ text: "Young Gun needs 21 points to pass Old Star for the most in NBA history.", player: "Young Gun", score: 4 }] } };
  const lines3 = tonightStorylines({ watch, records: recs, facts })[0].lines.map((l) => l.kind);
  ok(!lines3.includes("history") && lines3.includes("record"), "records: a notes history line about the same pass gives way to the record line", JSON.stringify(lines3));
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
  ok(lines.includes("Guy (4× MVP): 5 points from passing Old (100) for 3rd all-time (50% tonight)") && lines.includes("Guy: 5 assists from passing Old (100) for 9th all-time (50% tonight)"),
    "record lines: a former MVP's carries his MVPs; a Sixth Man's doesn't (headline awards only)", JSON.stringify(lines));
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

// ---------- NBA Live bridge (docs/bridge/cc-bridge.js) against a stand-in NBA Live ----------
{
  const vm = await import("node:vm");
  const code = fs.readFileSync(path.join(root, "docs", "bridge", "cc-bridge.js"), "utf8");
  const item = (o) => ({ espnId: "1", player: "P One", stat: "pts", label: "points", kind: "round", scope: "career", target: 1000, need: 10, importance: 30, pTonight: 0.5, publishable: true, tracking: "confirmed", review: [], origin: "notes", ...o });
  const watch = { today: "2026-11-09", teams: [
    { team: "LAL", items: [
      item({}),                                                                  // in play: card
      item({ espnId: "2", player: "Low Chance", pTonight: 0.02, need: 50 }),     // < 10% and not reached: no card
      item({ espnId: "9", player: "Surprise", pTonight: 0.01 }),                 // 1% but reached tonight: card
      item({ espnId: "3", player: "Minor Mark", importance: 9 }),                // importance < 15: no card
      item({ espnId: "10", player: "Allen Like", importance: 18 }),              // 15-19 (like Allen's 4,000 defensive rebounds): card since 0.15.2
      item({ espnId: "11", player: "Just Under", importance: 14 }),              // just under the cutoff: no card
      item({ espnId: "4", player: "Pass Man", kind: "pass", scope: "nba", importance: 15, passing: { player: "Old Guy", rank: 40 }, need: 2, stat: "fg3m", label: "3-pointers" }), // pass: card even below 20
      item({ espnId: "5", player: "Ladder Guy", target: 20000, need: 5 }),        // NBA Live's own ladder: skipped
      item({ espnId: "6", player: "Count Guy", target: 15000, need: 50, tracking: "disagrees", review: ["notes say 14950, ESPN says 14946"] }), // ladder + disagreement: count note
      item({ espnId: "7", player: "Bench Guy" }),                                // hasn't played: no card
      item({ espnId: "8", player: "Espn Only", origin: "espn" }),                 // ESPN-only: never
    ] },
    { team: "SAS", items: [ item({ espnId: "20", player: "Final Reach", need: 6 }), item({ espnId: "21", player: "Final Miss", need: 30 }) ] },
  ] };
  const pl = (id, o) => ({ id, min: 20, pts: 12, tpm: 3, reb: 5, ast: 2, stl: 1, blk: 0, dreb: 4, oreb: 1, starter: true, ...o });
  function run({ date = "20261109", hooks = true, games } = {}) {
    const cards = new Map(); let original = 0;
    const el = { style: {}, textContent: "" };
    const ctx = {
      URLSearchParams, console, Promise, Object, Number, String, Math, Array, Date, JSON,
      location: { search: "?cc=" + encodeURIComponent("https://cc.example/data/watch.json") },
      document: { readyState: "complete", getElementById: (id) => (id === "cc-bridge-note" ? el : null), createElement: () => el, body: { appendChild() {} } },
      fetch: async (u) => ({ ok: true, json: async () => (String(u).includes("tonight.json") ? tonightData : String(u).includes("records.json") ? recordsData : String(u).includes("single-game-bests") ? bestsData : watch) }),
      setInterval() {}, setTimeout() {}, clearTimeout() {}, addEventListener() {},
    };
    ctx.window = ctx;
    if (hooks) {
      Object.assign(ctx, {
        GAMES: games, MILESTONE_LADDERS: { pts: { step: 1000, from: 10000 }, tpm: { step: 500, from: 1000 } },
        fireStory: (k, c) => cards.set(k, c), runAlertChecks: () => { original++; }, activeDateYMD: () => date,
        fmtAlertStatLine: (rows) => rows.map((r) => r.join(" ")).join(" · "),
      });
    }
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    return { ctx, cards, el, orig: () => original };
  }
  // tonight.json for the pre-game cards (v2): LAL @ ATL is live in the games below, MIA @ BOS hasn't tipped.
  const L = (kind, text) => ({ kind, text, team: "X", score: 1 });
  const tonightData = { today: "2026-11-09", games: [
    { away: "LAL", home: "ATL", lines: [L("streak", "Live game line")] },
    { away: "MIA", home: "BOS", lines: [L("streak", "Pre one: 30+ points in 8 straight"), L("lead", "Pre two"), L("shooting", "Pre three"), L("team", "Pre four")] },
  ] };
  // v3: career records and the single-game lists.
  const rec = (o) => ({ id: "30", who: "Rec Man", team: "LAL", stat: "ast", label: "assists", kind: "pass", need: 3, target: 101, rank: 26, score: 3, pTonight: 0.6,
    passing: { name: "Old Passer", value: 100, rank: 26 }, text: "Man: 3 assists from passing Old Passer (100) for 26th all-time", ...o });
  const recordsData = { today: "2026-11-09", cup: { tonight: [{ away: "LAL", home: "ATL" }] },
    franchiseGame: { teams: { LAL: { name: "Lakers", src: "Lakers guide p. 99", pts: { value: 58, holders: ["Old Laker vs. Boston 1/1/60"] }, fg3m: { value: 12, holders: ["Kobe Bryant vs. Seattle 1/7/03"] } } } }, items: [
    rec({}),                                                                                      // reached tonight (5 assists): card
    rec({ id: "31", who: "Cup Man", kind: "cup", stat: "fg3m", label: "3-pointers", need: 2, rank: 1, passing: { name: "Cup King", value: 64, rank: 1 }, text: "Man: 2 3-pointers from passing Cup King (64) for the NBA Cup record; 1 ties him" }), // Cup game: card
    rec({ id: "32", who: "Far Man", need: 40, pTonight: 0.05 }),                                   // long shot, not reached: none
    rec({ id: "1", who: "P One", stat: "pts", kind: "round", target: 1000, need: 10, text: "One: 10 points from 1,000 career points", passing: null }), // the notes already carry it: none
  ] };
  const bestsData = { "Regular season": { pts: { floor: 57, games: [{ value: 100 }, { value: 81 }, { value: 60 }, { value: 58 }, { value: 58 }, { value: 57 }] }, fg3m: { floor: 11, games: [{ value: 14 }, { value: 11 }] } },
    "NBA Cup": { pts: { floor: 39, games: [{ value: 60 }, { value: 49 }, { value: 39 }] } } };
  const flush = () => new Promise((r) => setTimeout(r, 5));
  const games = [
    { id: "g1", status: "live", away: { tricode: "LAL", score: 50 }, home: { tricode: "ATL", score: 48 }, boxscore: { away: [pl("1"), pl("2"), pl("3"), pl("4"), pl("5"), pl("6"), pl("7", { min: 0, pts: 0 }), pl("9"), pl("10"), pl("11"),
      pl("30", { name: "Rec Man", ast: 5 }), pl("31", { name: "Cup Man", tpm: 1 }), pl("32", { name: "Far Man", ast: 3 }), pl("40", { name: "Big Night", pts: 58, tpm: 9 }), pl("41", { name: "Warm Hand", pts: 52 })], home: [] } },
    { id: "g2", status: "final", away: { tricode: "SA", score: 100 }, home: { tricode: "PHX", score: 90 }, boxscore: { away: [pl("20"), pl("21")], home: [] } },
  ];
  games.push({ id: "g9", status: "pre", away: { tricode: "MIA", score: 0 }, home: { tricode: "BOS", score: 0 }, boxscore: { away: [], home: [] } });
  const t = run({ games });
  await flush(); t.ctx.runAlertChecks(); await flush();
  const keys = [...t.cards.keys()];
  const has = (frag) => keys.some((k) => k.includes(frag));
  ok(t.orig() === 1, "bridge: NBA Live's own checks still run, once");
  {
    const pre = keys.filter((k) => k.startsWith("cc-pre-"));
    const c0 = t.cards.get(pre[0]);
    ok(pre.length === 3 && pre.every((k) => k.includes("MIA-BOS")) && c0.text === "Pre one: 30+ points in 8 straight" && /STREAK/.test(c0.icon) && c0.live === false && c0.gameScore === "Pre-game",
      "bridge v2: a game before tip-off gets its top 3 storylines as cards; a live game gets none of them", pre.join(" ") + " | " + keys.join(" ") + " | tonight=" + JSON.stringify(t.ctx.CC_BRIDGE.state.tonightError));
  }
  ok(has("cc-1-"), "bridge: an in-play milestone gets a card");
  ok(!has("cc-2-"), "bridge: under 10% tonight and not reached: no card", keys.join(" "));
  ok(!has("cc-3-"), "bridge: a minor round number gets no card even when reached", keys.join(" "));
  ok(has("cc-10-") && !has("cc-11-"), "bridge: importance cutoff is 15 (18 gets a card, 14 doesn't)", keys.join(" "));
  ok(has("cc-9-"), "bridge: a long-shot milestone reached tonight gets a card (the surprise is the story)");
  ok(has("cc-4-") && /passes Old Guy/.test(t.cards.get(keys.find((k) => k.includes("cc-4-"))).text), "bridge: a pass gets a card and is worded 'passes Old Guy' (needed 2, made 3)");
  ok(!has("cc-5-") && !has("cc-count-5"), "bridge: NBA Live's own ladder milestone is left to NBA Live");
  ok(has("cc-count-6"), "bridge: a ladder total the notes dispute gets a count-check card");
  ok(!has("cc-7-") && !has("cc-8-"), "bridge: a player who hasn't played, and ESPN-only items: no card");
  ok(has("cc-20-") && !has("cc-21-"), "bridge: a final game shows only what fell in it");
  ok(/SA @ PHX/.test(t.cards.get(keys.find((k) => k.includes("cc-20-"))).gameTag) && /Command Center/.test(t.cards.get(keys.find((k) => k.includes("cc-1-"))).sub), "bridge: cards carry the game and say they come from the Command Center");
  ok(/milestones.* for 2026-11-09/.test(t.el.textContent), "bridge: status note shows it is connected", t.el.textContent);
  // Cap: 9 in-play milestones in one game -> 6 cards.
  const many = { id: "g3", status: "live", away: { tricode: "LAL", score: 1 }, home: { tricode: "ATL", score: 1 }, boxscore: { away: Array.from({ length: 9 }, (_, k) => pl(String(100 + k))), home: [] } };
  watch.teams[0].items.push(...Array.from({ length: 9 }, (_, k) => item({ espnId: String(100 + k), player: `Many ${k}`, need: 50, pTonight: 0.2 + k / 100 })));
  const t2 = run({ games: [many] }); await flush(); t2.ctx.runAlertChecks(); await flush();
  ok([...t2.cards.keys()].filter((k) => /cc-1\d\d-/.test(k)).length === 6, "bridge: at most 6 in-play cards per game");
  const t3 = run({ games, date: "20261110" }); await flush(); t3.ctx.runAlertChecks(); await flush();
  ok(t3.cards.size === 0 && /NBA Live shows 2026-11-10/.test(t3.el.textContent), "bridge: a Watch List for another night is not used");
  let threw = null;
  try { const t4 = run({ hooks: false }); await flush(); ok(/not connected/.test(t4.el.textContent), "bridge: an NBA Live without the hooks gets a 'not connected' note"); } catch (e) { threw = e; }
  ok(!threw, "bridge: missing hooks never throw", String(threw));
  // v3
  const recCard = t.cards.get(keys.find((k) => k.startsWith("cc-rec-30-")) || "");
  ok(recCard && recCard.text === "Rec Man (LAL) — passes Old Passer (100) for 26th all-time" && /all-time/.test(recCard.sub),
    "bridge v3: a career-list pass reached tonight gets a card, re-worded for now", recCard && recCard.text);
  const cupCard = t.cards.get(keys.find((k) => k.startsWith("cc-rec-31-")) || "");
  ok(cupCard && cupCard.text === "Cup Man (LAL) — 1 3-pointer from passing Cup King (64) for the NBA Cup record", "bridge v3: an NBA Cup mark in a Cup game, counting down live", cupCard && cupCard.text);
  ok(!has("cc-rec-32-") && !has("cc-rec-1-"), "bridge v3: a long shot not reached, and a milestone the notes already carry: no record card", keys.filter((k) => k.startsWith("cc-rec")).join(" "));
  if (!t.cards.get("cc-list-cup-40-pts-made")) console.log("DEBUG keys", [...t.cards.keys()].filter((k) => k.includes("list")).join(" "), JSON.stringify(t.ctx.CC_BRIDGE.state.listError));
  const made = t.cards.get("cc-list-40-pts-made"), near = t.cards.get("cc-list-41-pts-near"), cupMade = t.cards.get("cc-list-cup-40-pts-made");
  ok(made && made.text === "Big Night (LAL) — 58 points: tied for the 4th-most in a game on the NBA's all-time list (6 games of 57+)" && near && /5 from the NBA's all-time single-game list \(57\+, 6 games\)/.test(near.text) && cupMade && /CUP/.test(cupMade.icon),
    "bridge v3: making the all-time single-game list (with his place), nearing it, and the Cup's list on a Cup night", [made && made.text, near && near.text].join(" | "));
  ok(has("cc-list-40-fg3m-near") && !has("cc-list-1-fg3m"), "bridge v3: 9 threes is 2 from the 11+ list (window 2): a card; 3 threes: none");
  const fgTie = t.cards.get("cc-fg-40-pts-tied"), fgNear = t.cards.get("cc-fg-41-pts-near");
  ok(fgTie && fgTie.text === "Big Night (LAL) — 58 points: ties the Lakers record (58, Old Laker vs. Boston 1/1/60)" && fgNear && /6 from the Lakers record \(58, Old Laker/.test(fgNear.text) && !has("cc-fg-40-fg3m") && /Lakers guide p\. 99/.test(fgTie.sub),
    "bridge v4: a franchise single-game record tied, one nearing it (52 of 58, window 8); 9 threes isn't near 12 (window 2)", [fgTie && fgTie.text, fgNear && fgNear.text].join(" | "));
  const t5 = run({ games: [{ ...games[1], status: "final" }] }); await flush(); t5.ctx.runAlertChecks(); await flush();
  ok(![...t5.cards.keys()].some((k) => k.startsWith("cc-list-")), "bridge v3: a final game with nobody on a list gets no list card");
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
    && hk("The Warriors' franchise-record home sellout streak is at 613 consecutive games.") === "614 with tonight's game.",
    "notes, tags and hooks from the 11/13 slate: team history stays team history; games-played vs. do-it-again vs. team streaks");
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
  const p = V.settleProblems(["Al Horford dreb: the guide gives 6,949 and 6,950 (active list)", "Dolph Schayes ftm: the guide gives 6,712 and 6,979 (career scorers, NBA Guide p. 136)"],
    [{ name: "Al Horford", totals: { dreb: { base: 6949, season: 33, now: 6982 } } }], verified);
  ok(p.problems.length === 1 && /Schayes/.test(p.problems[0]), "verified: an unconfirmed guide clash stays a problem");
  ok(p.errata.length === 1 && /6,950 \(active list\); 6,949 is right/.test(p.errata[0]), "verified: B-Ref's 6,982 makes the guide's 6,950 a slip", p.errata[0]);
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

// ---------- snapshot ----------
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
