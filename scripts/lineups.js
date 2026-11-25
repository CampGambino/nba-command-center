#!/usr/bin/env node
/**
 * Lineups, exact minutes and hustle stats from NBA.com's rotations (0.151.0). Reads:
 *   - history/nbacom/<season>/g-<NBA game id>.json (tools/fetch-rotations.mjs): stints and hustle stats
 *   - docs/data/games.json (our games, ESPN ids) and docs/data/flow/<year>/<ESPN id>.json (the play-by-play's score)
 * Writes docs/data/lineups.json: every stretch with the same five on the floor, for each team and game, with points for and
 * against and the margin it began at; each player's exact seconds by game; hustle totals; and the checks against ESPN's
 * box scores (minutes and plus-minus, player by player). The page (docs/lineups.html) adds the stretches up.
 *   node scripts/lineups.js [--season 2026-27]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
// 0.156.0: the season from src/season.js (it was written in as "2026-27", like the pull's)
const { SEASON: CURRENT } = await import("../src/season.js");
const SEASON = arg("--season", CURRENT), YEAR = String(+SEASON.slice(0, 4) + 1);
const { scoringEvents, teamIntervals, secondsPlayed } = await import("../src/situations/lineups.js");
const { expandFeeds } = await import("../src/gameflow/feeds.js");
const rotDir = path.join(root, "history", "nbacom", SEASON), flowDir = path.join(root, "docs", "data", "flow", YEAR);
if (!fs.existsSync(rotDir)) { console.log(`lineups: no rotations on file for ${SEASON}`); process.exit(0); }
const G = JSON.parse(fs.readFileSync(path.join(root, "docs", "data", "games.json"), "utf8")).games || [];
const ours = new Map(G.map((g) => [`${g.d}|${g.h}`, g]));
const near = (d, k) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const norm = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?$/g, "").replace(/[^a-z]/g, "");
const TRI = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", PHO: "PHX" }, tri = (t) => TRI[t] || t;

const players = {}, pIndex = new Map(), games = [], iv = [], secs = {}, hustle = {}, checks = { games: 0, noFlow: 0, short: 0, minutes: { n: 0, within1: 0, worst: [] }, pm: { n: 0, same: 0, off: [] }, scoreOk: 0 };
const pid = (id, name, team, espn) => {
  if (!pIndex.has(id)) { pIndex.set(id, pIndex.size); players[pIndex.get(id)] = [name, team, espn || null]; }
  const k = pIndex.get(id); if (espn && !players[k][2]) players[k][2] = espn; players[k][1] = team; return k;
};
for (const f of fs.readdirSync(rotDir).filter((x) => /^g-\d+\.json$/.test(x)).sort()) {
  const R = JSON.parse(fs.readFileSync(path.join(rotDir, f), "utf8"));
  // by date and teams; a neutral-site game (Mexico City, 11/7) has no home team on NBA.com's list, so either way round
  const teams = [R.home, R.away].filter(Boolean).map(tri);
  const g = [0, -1, 1].flatMap((k) => G.filter((x) => x.d === near(R.d, k))).find((x) => teams.every((t) => t === x.h || t === x.a) && (teams.length === 2 || teams[0] === x.a || teams[0] === x.h));
  if (g && (!R.home || !R.away)) { R.home = g.h; R.away = g.a; }
  const flowFile = g && path.join(flowDir, `${g.id}.json`);
  if (!g || !fs.existsSync(flowFile)) { checks.noFlow++; continue; }
  const X = expandFeeds(JSON.parse(fs.readFileSync(flowFile, "utf8")));
  const S = scoringEvents(X.pbp.game.actions);
  if (S.home === g.hs && S.away === g.as) checks.scoreOk++;
  const gi = games.length; games.push([g.id, g.d, tri(R.home), tri(R.away), g.hs, g.as]); checks.games++;
  // ESPN ids and box lines by name, for the checks and to join the rest of the site
  const box = {};
  for (const side of ["homeTeam", "awayTeam"]) for (const p of X.box.game[side].players || []) box[norm(p.name)] = p;
  for (const [team, stints] of Object.entries(R.rot || {})) {
    const home = tri(team) === tri(R.home);
    const ids = new Map();
    for (const s of stints) if (!ids.has(String(s[0]))) ids.set(String(s[0]), pid(String(s[0]), s[1], tri(team), box[norm(s[1])]?.personId));
    const T = teamIntervals(stints, S.events, home);
    checks.short += T.short;
    for (const [t0, t1, on, pf, pa, before] of T.iv) iv.push([gi, home ? 1 : 0, t0, t1, ...on.map((x) => ids.get(x)), pf, pa, before]);
    const sp = secondsPlayed(stints);
    for (const [id, sec] of Object.entries(sp)) {
      const b = box[norm(players[ids.get(id)][0])];
      const m = b && /PT(\d+)M([\d.]+)S/.exec(b.statistics?.minutes || "");
      let ok = true;
      if (m) { checks.minutes.n++; const espnMin = +m[1] + +m[2] / 60, d = Math.abs(sec / 60 - espnMin); if (d <= 1) checks.minutes.within1++; else { ok = false; if (checks.minutes.worst.length < 8) checks.minutes.worst.push([players[ids.get(id)][0], g.d, Math.round(sec), Math.round(espnMin * 60)]); } }
      // a player whose NBA.com stints don't add up to his minutes (Giannis Antetokounmpo 11/18: one stint of 46:39 for a
      // 32:15 night) gets no exact seconds; the stretches with six or four "on" because of it are already left out
      if (ok) (secs[ids.get(id)] ??= []).push([gi, Math.round(sec)]);
    }
    // plus-minus from the stretches against the box score's
    const pm = {};
    for (const r of T.iv) for (const x of r[2]) pm[x] = (pm[x] || 0) + r[3] - r[4];
    for (const [id, v] of Object.entries(pm)) {
      const b = box[norm(players[ids.get(id)][0])]; const want = b?.statistics?.plusMinusPoints;
      if (want == null) continue; checks.pm.n++; if (want === v) checks.pm.same++; else if (checks.pm.off.length < 8) checks.pm.off.push([players[ids.get(id)][0], g.d, v, want]);
    }
  }
  for (const [team, rows] of Object.entries(R.hustle || {})) for (const r of rows) {
    const k = pid(String(r[0]), r[1], tri(team)), h = (hustle[k] ??= [0, 0, 0, 0, 0, 0, 0, 0, 0]);
    if (!r[2]) continue;   // didn't play
    h[0]++; for (let i = 3; i <= 10; i++) h[i - 2] += r[i] || 0;
  }
}
// every team-game's stretches should cover the whole game and add up to its final score
{ const T = {}; for (const r of iv) { const k = `${r[0]}|${r[1]}`, x = (T[k] ??= [0, 0, 0]); x[0] += r[3] - r[2]; x[1] += r[9]; x[2] += r[10]; }
  checks.teamGames = games.length * 2; checks.wholeGame = 0; checks.pointsAddUp = 0;
  // a team-game with no stretch of exactly five: NBA.com's stints for it are broken (MIA 11/18: one stint of 46:39 for
  // Antetokounmpo, who played 32:15), so the whole team-game is left out
  checks.leftOut = games.flatMap((g, gi) => [1, 0].filter((h) => !T[`${gi}|${h}`]).map((h) => `${h ? g[2] : g[3]} ${g[1]}`));
  for (const [k, [t, f, a]] of Object.entries(T)) { const g = games[+k.split("|")[0]], home = k.endsWith("|1");
    if (t >= 28800 && (t - 28800) % 3000 === 0) checks.wholeGame++;
    if (f === (home ? g[4] : g[5]) && a === (home ? g[5] : g[4])) checks.pointsAddUp++; } }
const out = { generatedAt: new Date().toISOString(), season: SEASON, source: "NBA.com rotations (stats.nba.com gamerotation) and hustle stats (boxscorehustlev2); the score from the play-by-play",
  cols: { iv: ["game", "home", "t0", "t1", "p1", "p2", "p3", "p4", "p5", "pf", "pa", "marginBefore"], games: ["espnId", "date", "home", "away", "homePts", "awayPts"], players: ["name", "team", "espnId"],
    hustle: ["games", "contested2", "contested3", "deflections", "charges", "screenAst", "screenAstPts", "looseBalls", "boxOuts"] },
  games, players, iv, secs, hustle, checks };
fs.writeFileSync(path.join(root, "docs", "data", "lineups.json"), JSON.stringify(out));
const pct = (a, b) => (b ? `${Math.round((1000 * a) / b) / 10}%` : "-");
console.log(`lineups: ${games.length} games, ${iv.length} stretches, ${Object.keys(players).length} players; minutes within 1 of ESPN ${pct(checks.minutes.within1, checks.minutes.n)}, plus-minus equal ${pct(checks.pm.same, checks.pm.n)}; ${checks.wholeGame}/${checks.teamGames} team-games covered whole, ${checks.pointsAddUp} adding up to the score${checks.leftOut.length ? ` (left out, broken stints: ${checks.leftOut.join(", ")})` : ""}; ${checks.short} stretches without five, ${checks.noFlow} games without a Game Flow file`);
