/**
 * The daily jobs, as run by .github/workflows/daily.yml (and runnable by hand):
 *
 *   node scripts/ci.js build [--today YYYY-MM-DD]
 *     Builds tonight's slate (scripts/tonight.js). Keeps the predictions as
 *     history/predictions-<date>.json.gz so a later run can score them (data/ is
 *     not kept between runs). Refuses to replace today's site data with a build
 *     that read fewer teams' notes than the one already published: a blocked or
 *     failing download must never blank out good data.
 *
 *     Then refreshes team situations (scripts/situations.js); a failure there
 *     leaves the last published situations in place. (Discord posts are a
 *     separate workflow step, scripts/notify.js, so the build itself and its
 *     npm packages never run with the webhook secret.)
 *
 *   node scripts/ci.js score [--date YYYY-MM-DD]   (default: yesterday, Eastern)
 *     Scores that night (scripts/score.js) and keeps the result in
 *     history/calibration.jsonl and history/score-<date>.txt. Scoring the same
 *     night again (a late game finished) replaces its line.
 *
 * Every build writes docs/data/health.json (when it ran, each step's result and complaints); the Watch List shows a
 * note when a step failed or the data is old. A failed step never blanks good data: its last files stay.
 *
 * Exit code: 0 = done (or nothing to do), 1 = a step failed (what the other steps wrote is still committed).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const hist = path.join(root, "history");
const data = path.join(root, "data");
const watchFile = path.join(root, "docs", "data", "watch.json");
fs.mkdirSync(hist, { recursive: true });
fs.mkdirSync(data, { recursive: true });

const [mode, ...rest] = process.argv.slice(2);
const opt = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : null);
const etDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
// Each step has its own time limit (0.72), so one that hangs can't use up the job's 30 minutes and take the others with it.
const LIMIT_MIN = { "scripts/tonight.js": 14, "scripts/situations.js": 8, "scripts/flow.js": 4, "scripts/score.js": 8 };
const steps = [];
let heldNote = null;      // 0.105: set when a build after midnight stays on yesterday's slate (pickDay)
function run(args) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20, timeout: (LIMIT_MIN[args[0]] || 10) * 60e3, killSignal: "SIGKILL" });
  const timedOut = r.error?.code === "ETIMEDOUT" || r.signal === "SIGKILL";
  if (timedOut) r.status = 124;
  // What went wrong, for the site's health note: the step's own complaints (never more than a few lines).
  // 0.125: every line a step prints as a complaint (stderr), not only the ones worded a certain way: "odd lines not
  // run", "bench counts not made" and six more never matched the old word list, and a normal build prints none at all.
  const notes = String(r.stderr || "").split("\n").map((l) => l.trim()).filter((l) => l && !/DeprecationWarning|ExperimentalWarning|--trace-(?:deprecation|warnings)|UNDICI-EHPA/.test(l)).slice(0, 8).map((l) => l.slice(0, 220));
  steps.push({ step: args[0].replace(/^scripts\/|\.js$/g, ""), ok: r.status === 0, sec: Math.round((Date.now() - t0) / 1000), ...(timedOut ? { error: `stopped after ${LIMIT_MIN[args[0]] || 10} minutes` } : r.status !== 0 ? { error: `exit ${r.status}` } : {}), ...(notes.length ? { notes } : {}) });
  return r;
}
/** docs/data/health.json: when the build ran and how each step went, for the Watch List's health note (0.72). */
function writeHealth(today, extra = {}) {
  const checks = ownChecks(extra);
  try { fs.writeFileSync(path.join(root, "docs", "data", "health.json"), JSON.stringify({ at: new Date().toISOString(), today, steps, ...(heldNote ? { held: heldNote } : {}), ...extra, ...(checks.length ? { checks } : {}) })); } catch (e) { console.error(`health note not written: ${e.message}`); }
}
/**
 * 0.125: the build reads back what it wrote (src/site/selfcheck.js): a file it did not rewrite, a file for another
 * day, a top line about a player who is out or a streak that is over, a broken value in print, a slate with no lines.
 * What it finds goes in the health note, which the Watch List shows. It can never stop a build.
 */
function ownChecks(extra) {
  try {
    const dir = path.join(root, "docs", "data"), files = {};
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json") && x !== "health.json")) { try { files[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { files[f.slice(0, -5)] = null; console.error(`${f} could not be read back: ${e.message}`); } }
    const unread = Object.entries(files).filter(([, j]) => j === null).map(([n]) => `${n}.json is not valid JSON`);
    const lib = path.join(root, "docs", "lib"), copies = [];
    const walk = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".js")) { const rel = path.relative(lib, p), src = path.join(root, "src", rel); if (fs.existsSync(src)) copies.push({ name: rel, same: fs.readFileSync(src, "utf8") === fs.readFileSync(p, "utf8") }); } } };
    walk(lib);
    let bridge = null;
    try { bridge = { running: Number(/var VERSION = (\d+);/.exec(fs.readFileSync(path.join(root, "docs", "bridge", "cc-bridge.js"), "utf8"))[1]), published: JSON.parse(fs.readFileSync(path.join(root, "docs", "bridge", "version.json"), "utf8")).version }; } catch { bridge = null; }
    const kept = extra.kept || steps.some((x) => x.step === "tonight" && !x.ok) ? ["watch"] : [];
    const found = selfCheck({ data: files, buildStart: BUILD_START, keptFiles: kept, copies, bridge, said: [...unread, ...steps.flatMap((x) => (x.notes || []).map((n) => `${x.step}: ${n}`))] });
    for (const c of found) console.error(`self-check (${c.check}): ${c.text}`);
    if (!found.length) console.log("self-check: nothing found");
    return found.slice(0, 20);
  } catch (e) { console.error(`self-check not run: ${e.message}`); return [{ check: "said", text: `the build could not check its own output: ${e.message}` }]; }
}
const { notesRead, notesGuard } = await import("../src/site/notes-guard.js");
const { selfCheck } = await import("../src/site/selfcheck.js");
const BUILD_START = Date.now();

if (mode === "build") await build();
else if (mode === "score") score();
else {
  console.error("usage: node scripts/ci.js build [--today YYYY-MM-DD] | score [--date YYYY-MM-DD]");
  process.exit(2);
}

/**
 * 0.105: after midnight Eastern the slate stays on yesterday until yesterday's games are all final (src/espn/slate.js).
 * A date given by hand (--today) is used as given.
 */
async function pickDay() {
  if (opt("--today")) return opt("--today");
  const today = etDay(0), yesterday = etDay(-1), hourET = Number(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false })) % 24;
  try {
    // read only when needed, so the build still runs if these cannot be loaded
    const { slateDay, HOLD_UNTIL_HOUR } = await import("../src/espn/slate.js"); if (!(hourET < HOLD_UNTIL_HOUR)) return today;
    const { readScoreboard } = await import("../src/espn/parse.js");
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${yesterday.replace(/-/g, "")}&limit=100`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`ESPN ${r.status}`);
    const { day, held } = slateDay({ today, yesterday, hourET, games: readScoreboard(await r.json()).games, nowMs: Date.now() });
    if (held.length) { heldNote = `still on ${yesterday}'s slate: ${held.map((g) => `${g.awayTri || g.away} at ${g.homeTri || g.home}`).join(", ")} ${held.length === 1 ? "has" : "have"} not finished`; console.log(`slate: ${heldNote}`); }
    return day;
  } catch (e) { console.error(`slate: yesterday's scoreboard not read (${e.message}); building ${today}`); return today; }
}
async function build() {
  const today = await pickDay();
  const before = fs.existsSync(watchFile) ? JSON.parse(fs.readFileSync(watchFile, "utf8")) : null;
  const beforeText = before ? fs.readFileSync(watchFile, "utf8") : null;
  const r = run(["scripts/tonight.js", "--today", today]);
  process.stdout.write(r.stdout || "");
  process.stderr.write(r.stderr || "");
  if (r.status !== 0) {
    // 0.72: the notes step failing no longer stops the rest: results, clutch, streaks and Game Flow still update,
    // the health note says what failed, and the run ends red so it's seen.
    console.error(`build failed (exit ${r.status}); the published Watch List stays, the other steps still run`);
    if (beforeText) fs.writeFileSync(watchFile, beforeText);
    situations(today);
    writeHealth(today);
    process.exit(1);
  }
  const after = JSON.parse(fs.readFileSync(watchFile, "utf8"));
  // 0.124: the rule and its wording live in src/site/notes-guard.js (a conflict is notes read; the note names the teams).
  const guard = notesGuard(before, after, today);
  if (guard.keep) {
    fs.writeFileSync(watchFile, beforeText);
    console.error(`kept the published data: ${guard.text}`);
    situations(today);
    writeHealth(today, { kept: guard.text });
    return;
  }
  const pred = path.join(data, `predictions-${today}.json`);
  if (fs.existsSync(pred)) fs.writeFileSync(path.join(hist, `predictions-${today}.json.gz`), zlib.gzipSync(fs.readFileSync(pred), { level: 9 }));
  console.log(`site data for ${today}: ${after.teams.length} teams, notes read for ${notesRead(after)}`);
  situations(today);
  writeHealth(today);
  // A later step failing leaves its last data up, but the run still ends red (it used to end green and go unseen).
  if (steps.some((x) => !x.ok)) { console.error(`steps failed: ${steps.filter((x) => !x.ok).map((x) => x.step).join(", ")}`); process.exit(1); }
}

// Team situations (records vs winning teams, close games, trailing at half...).
// Its own step: if it fails, the Watch List still publishes and the last
// situations data stays up (the script writes nothing unless it succeeds).
function situations(today) {
  const r = run(["scripts/situations.js", "--today", today]);
  process.stdout.write(r.stdout || "");
  process.stderr.write(r.stderr || "");
  if (r.status !== 0) console.error(`team situations not updated (exit ${r.status}); the last published ones stay`);
  // Game Flow: each finished game's play-by-play, read once and kept (scripts/flow.js). Never fatal.
  const f = run(["scripts/flow.js"]);
  process.stdout.write(f.stdout || "");
  process.stderr.write(f.stderr || "");
  if (f.status !== 0) console.error(`game flow not updated (exit ${f.status})`);
}

function score() {
  const date = opt("--date") || etDay(-1);
  const gz = path.join(hist, `predictions-${date}.json.gz`);
  if (!fs.existsSync(gz)) { console.log(`no predictions kept for ${date}; nothing to score`); process.exit(0); }
  const pred = path.join(data, `predictions-${date}.json`);
  fs.writeFileSync(pred, zlib.gunzipSync(fs.readFileSync(gz)));
  const cal = path.join(hist, "calibration.jsonl");
  if (fs.existsSync(cal)) fs.copyFileSync(cal, path.join(data, "calibration.jsonl"));
  const r = run(["scripts/score.js", pred]);
  process.stderr.write(r.stderr || "");
  if (r.status !== 0) { console.error(`scoring failed (exit ${r.status})`); process.exit(1); }
  process.stdout.write(r.stdout);
  fs.writeFileSync(path.join(hist, `score-${date}.txt`), r.stdout);
  if (fs.existsSync(path.join(data, "calibration.jsonl"))) fs.copyFileSync(path.join(data, "calibration.jsonl"), cal);
}
