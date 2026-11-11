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
import { readScoreboard, readGameDetail, clockSeconds, readPlayerBox } from "../src/espn/parse.js";
import { teamGameLines, offense, ratings, vsTopDefenses, vsTop } from "../src/situations/ratings.js";
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

// ---------- website (docs/) ----------
{
  const docs = path.join(root, "docs");
  if (fs.existsSync(path.join(docs, "lib"))) {
    for (const rel of ["teams.js", "notes/names.js", "espn/parse.js", "registry/track.js", "nba/movement.js", "situations/ratings.js", "espn/pbp.js", "situations/withwithout.js", "situations/leaders.js"]) {
      const a = fs.readFileSync(path.join(root, "src", rel), "utf8"), b = fs.existsSync(path.join(docs, "lib", rel)) ? fs.readFileSync(path.join(docs, "lib", rel), "utf8") : null;
      ok(a === b, `website: docs/lib/${rel} matches src (run scripts/publish.js after code changes)`);
    }
    // Everything the page imports, followed through its own imports, must run in a browser.
    const seen = new Set(), stack = ["espn/parse.js", "registry/track.js", "situations/ratings.js", "situations/withwithout.js", "situations/leaders.js"];
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
  const car = (id, career, season) => ({ ok: true, stale: false, warnings: [], data: { rows: [{ season: "2026-27", teamId: "1", stats: season }], career } });
  const fake = {
    teams: async () => ({ ok: true, warnings: [], data: { ids: { LAL: "13" } } }),
    roster: async () => ({ ok: true, warnings: [], data: { players: [{ id: "a", name: "Big Scorer" }, { id: "b", name: "Young Guy" }, { id: "c", name: "Far Away" }, { id: "d", name: "Rookie" }] } }),
    career: async (id) => ({
      a: car("a", { pts: 19985, fg3m: 1497, gp: 999, reb: 4990 }, { gp: 10, pts: 250, fg3m: 30, reb: 50 }),   // 15 pts from 20,000; 3 threes from 1,500; 1 game from 1,000
      b: car("b", { pts: 1990, fg3m: 98, gp: 99 }, { gp: 10, pts: 200, fg3m: 20 }),                          // below every bar
      c: car("c", { pts: 18500 }, { gp: 10, pts: 200 }),                                                     // 1,500 away: not within 3 games
      d: { ok: true, stale: false, warnings: [], data: { rows: [], career: null } },                          // no NBA games
    }[id]),
  };
  const r = await discoverMilestones({ team: "LAL", espn: fake });
  const got = r.milestones.map((m) => `${m.player}|${m.stat}|${m.target}|${m.need}`).sort();
  ok(got.join(",") === ["Big Scorer|fg3m|1500|3", "Big Scorer|gp|1000|1", "Big Scorer|pts|20000|15", "Big Scorer|reb|5000|10"].join(","), "discover: only rungs at NBA Live's bar, within about 3 games", got.join(", "));
  ok(r.milestones.every((m) => m.origin === "espn" && m.status === "review"), "discover: ESPN-only finds are always held for review");
  const skip = await discoverMilestones({ team: "LAL", espn: fake, skip: [{ player: "Big Scorer", stat: "pts", target: 20000 }] });
  ok(!skip.milestones.some((m) => m.stat === "pts"), "discover: a milestone the notes already have isn't repeated");
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
  }
}
function wl(r) { return r ? `${r.w}-${r.l}` : "0-0"; }

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
      location: { search: "?cc=test" },
      document: { readyState: "complete", getElementById: (id) => (id === "cc-bridge-note" ? el : null), createElement: () => el, body: { appendChild() {} } },
      fetch: async () => ({ ok: true, json: async () => watch }),
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
  const flush = () => new Promise((r) => setTimeout(r, 5));
  const games = [
    { id: "g1", status: "live", away: { tricode: "LAL", score: 50 }, home: { tricode: "ATL", score: 48 }, boxscore: { away: [pl("1"), pl("2"), pl("3"), pl("4"), pl("5"), pl("6"), pl("7", { min: 0, pts: 0 }), pl("9"), pl("10"), pl("11")], home: [] } },
    { id: "g2", status: "final", away: { tricode: "SA", score: 100 }, home: { tricode: "PHX", score: 90 }, boxscore: { away: [pl("20"), pl("21")], home: [] } },
  ];
  const t = run({ games });
  await flush(); t.ctx.runAlertChecks(); await flush();
  const keys = [...t.cards.keys()];
  const has = (frag) => keys.some((k) => k.includes(frag));
  ok(t.orig() === 1, "bridge: NBA Live's own checks still run, once");
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
  ok(/milestones for 2026-11-09/.test(t.el.textContent), "bridge: status note shows it is connected", t.el.textContent);
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
