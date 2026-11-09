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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseNotes } from "../src/notes/parse.js";
import { teamFromSlug } from "../src/teams.js";
import { normStat, statFromTitle, num, isDecimal, looksLikeThousandsTypo } from "../src/notes/stats.js";
import { sameName, nameKey, looksLikeNameHeading } from "../src/notes/names.js";
import { etDate, readCareer } from "../src/espn/parse.js";
import { createEspn } from "../src/espn/client.js";
import { trackMilestones, statFromLine } from "../src/registry/track.js";
import { makeSampler, simulate, rng } from "../src/anticipate/model.js";
import { importance } from "../src/anticipate/importance.js";
import { buildWatch, rank } from "../src/anticipate/watch.js";

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

// ---------- snapshot ----------
const snapDir = path.join(root, "tests", "expected");
fs.mkdirSync(snapDir, { recursive: true });
const brief = (m) => [m.player, m.kind, m.stat, m.scope, m.current, m.target, m.need, m.status, m.passing?.player || ""].join(" | ");
const diffs = [];
for (const [team, r] of Object.entries(results)) {
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
