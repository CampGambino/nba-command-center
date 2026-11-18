// Which printed team marks have a second source, mark by mark (0.109.0; the user, 11/18: "I am concerned that not all of
// the stats are factual given the errors already spotted"). It reads what the three checkers found and writes
// src/data/team-marks-sources.json, which the Records page and the NBA Live card use to say "checked" or "guide only".
//
//   node tools/check-team-marks.mjs   --dir <espn pages> --no-fetch --out marks.json
//   node tools/check-period-marks.mjs --dir <pbp> --boards <boards> --no-fetch --out pmarks.json
//   node tools/check-period-points.mjs --dir <boards> --no-fetch --out ppoints.json
//   node tools/check-league-book-vs-guides.mjs --out book.json
//   node tools/mark-sources.mjs --marks marks.json --pmarks pmarks.json --ppoints ppoints.json --book book.json
//
// A mark counts as checked when, for one of the nights the guide prints, a source other than that guide has the same
// number: ESPN's box score, the other team's guide, the final score (points), ESPN's line score (points by half and
// quarter), the play-by-play (other stats by half and quarter), the league's record book (the same game), or a look-up recorded in tools/team-records-verified.json.
// It does NOT show that nobody ever did more: only the guide claims that.
import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib"; import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), D = (f) => path.join(root, "src", "data", f), js = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const args = process.argv.slice(2), arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const R = js(D("team-game-records-2026-27.json")).teams, V = js(path.join(root, "tools", "team-records-verified.json"));
const key = (t, side, stat, kind, period, date) => [t, side || "team", stat, kind, period, date].join("|");
const how = new Map(), put = (k, w) => { if (!how.has(k)) how.set(k, w); };
// 1. whole games, not points
const rows = js(arg("--marks"));
const byNight = new Map(); for (const r of rows) byNight.set([r.t, r.side, r.stat, r.kind, r.date].join("|"), r);
for (const r of rows) {
  if (r.stat === "pts") continue;
  const k = key(r.t, r.side, r.stat, r.kind, "game", r.date);
  if (r.espn === "same" || r.espn === "team turnovers") put(k, "ESPN's box score");
  else if (r.outside) put(k, "a box score looked up by hand");
  else if (r.opp) { const o = byNight.get([r.opp, r.side === "team" ? "opp" : "team", r.stat, r.kind, r.date].join("|")); if (o && o.value === r.value) put(k, "the other team's guide"); }
}
// 2. points in a whole game: the final score in our results
const score = new Map();
const add = (g) => { const d = g[0].slice(0, 10); (score.get(g[1] + d) || score.set(g[1] + d, []).get(g[1] + d)).push([g[3], g[4]]); (score.get(g[2] + d) || score.set(g[2] + d, []).get(g[2] + d)).push([g[4], g[3]]); };
for (const f of [js(D("nba-results-history.json")), JSON.parse(zlib.gunzipSync(fs.readFileSync(D("nba-results-older.json.gz"))))]) for (const g of f.games) add(g);
for (const r of rows) if (r.stat === "pts") for (const [mine, theirs] of score.get(r.t + r.date) || []) if ((r.side === "team" ? mine : theirs) === r.value) put(key(r.t, r.side, "pts", r.kind, "game", r.date), "the final score");
// 3. points by half, quarter and overtime: ESPN's line score
for (const r of js(arg("--ppoints")).res.same || []) put(key(r.t, r.side, "pts", r.kind, r.period, r.date), "ESPN's line score");
// 4. other stats by half and quarter: the play-by-play
for (const r of js(arg("--pmarks")).same || []) put(key(r.t, r.side, r.stat, r.kind, r.period, r.date), "the play-by-play");
// 5. the league's record book prints the same game with the same number (tools/check-league-book-vs-guides.mjs --out)
if (arg("--book")) for (const k of js(arg("--book")).sameNight.keys || []) put(k, "the league's record book");
// 6. looked up by hand
for (const [kind, dateOf] of [["marks", (e) => e.date], ["revalue", (e) => e.date], ["add", (e) => e.date], ["redate", (e) => null]])
  for (const [t, es] of Object.entries(V[kind] || {})) for (const e of es) if (dateOf(e) && e.second !== false) how.set(key(t, e.side, e.stat, e.kind, e.period, dateOf(e)), "a look-up recorded with its source");
// mark by mark
const out = {}; let n = 0, ok = 0; const tally = {};
for (const [t, ms] of Object.entries(R)) for (const m of ms) {
  n++;
  const w = (m.games || []).map((g) => how.get(key(t, m.side, m.stat, m.kind, m.period, g.date))).find(Boolean);
  if (!w) continue;
  ok++; tally[w] = (tally[w] || 0) + 1; (out[t] ||= {})[[m.side || "team", m.kind, m.stat, m.period].join("|")] = w;
}
const game = Object.values(R).flat().filter((m) => m.period === "game"), gameOk = Object.entries(R).reduce((s, [t, ms]) => s + ms.filter((m) => m.period === "game" && out[t]?.[[m.side || "team", m.kind, m.stat, m.period].join("|")]).length, 0);
fs.writeFileSync(D("team-marks-sources.json"), JSON.stringify({ note: "Printed team marks with a second source for the number on a printed night (tools/mark-sources.mjs). A mark not listed rests on the team's guide alone. No source here shows that nobody ever did more.", marks: n, checked: ok, teams: out }));
console.log(`${ok} of ${n} marks have a second source (${gameOk} of ${game.length} whole-game marks)`, tally);
