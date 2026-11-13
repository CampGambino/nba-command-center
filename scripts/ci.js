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
 * Exit code: 0 = done (or nothing to do), 1 = failed; nothing is written then.
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
const run = (args) => spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
const notesRead = (w) => (w?.teams || []).filter((t) => t.notesStatus === "current" || t.notesStatus === "stale").length;

if (mode === "build") build();
else if (mode === "score") score();
else {
  console.error("usage: node scripts/ci.js build [--today YYYY-MM-DD] | score [--date YYYY-MM-DD]");
  process.exit(2);
}

function build() {
  const today = opt("--today") || etDay(0);
  const before = fs.existsSync(watchFile) ? JSON.parse(fs.readFileSync(watchFile, "utf8")) : null;
  const beforeText = before ? fs.readFileSync(watchFile, "utf8") : null;
  const r = run(["scripts/tonight.js", "--today", today]);
  process.stdout.write(r.stdout || "");
  process.stderr.write(r.stderr || "");
  if (r.status !== 0) { console.error(`build failed (exit ${r.status})`); if (beforeText) fs.writeFileSync(watchFile, beforeText); process.exit(1); }
  const after = JSON.parse(fs.readFileSync(watchFile, "utf8"));
  if (before && before.today === today && notesRead(after) < notesRead(before)) {
    fs.writeFileSync(watchFile, beforeText);
    console.error(`kept the published data: this build read notes for ${notesRead(after)} teams, the published one ${notesRead(before)}`);
    situations(today);
    return;
  }
  const pred = path.join(data, `predictions-${today}.json`);
  if (fs.existsSync(pred)) fs.writeFileSync(path.join(hist, `predictions-${today}.json.gz`), zlib.gzipSync(fs.readFileSync(pred), { level: 9 }));
  console.log(`site data for ${today}: ${after.teams.length} teams, notes read for ${notesRead(after)}`);
  situations(today);
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
