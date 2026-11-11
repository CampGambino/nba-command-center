/**
 * Team situations for the site: records vs winning teams, in close games, when
 * trailing at half or after three, and so on, with league baselines.
 *
 *   node scripts/situations.js [--through YYYY-MM-DD] [--today YYYY-MM-DD]
 *
 * Results through yesterday (Eastern) are kept in history/results/ (a file per date), so later
 * runs only ask ESPN for new dates. Writes docs/data/situations.json, including
 * tonight's matchups.
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
const { createEspn } = await import("../src/espn/client.js");
const { collectResults, allGames, loadStore, saveStore } = await import("../src/situations/results.js");
const { computeSituations } = await import("../src/situations/records.js");
const { clutchPlayerTotals, clutchTeamTotals } = await import("../src/situations/clutch.js");
const { playerGames, activeStreaks, teamStreaks, anomalies } = await import("../src/situations/trends.js");
const { teamGames, gameLeaders, seasonLeaders, shooting, LEAD_STATS, LINES } = await import("../src/situations/leaders.js");

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const etDay = (offset = 0) => new Date(Date.now() + offset * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const today = opt("--today") || etDay(0);
const through = opt("--through") || new Date(Date.parse(today) - 864e5).toISOString().slice(0, 10);

const espn = createEspn({ dataDir: path.join(root, "data") });
const storeDir = path.join(root, "history", "results");
const oldFile = path.join(root, "history", "results.json"); // single-file store before v0.14
let store = loadStore(storeDir, fs) ?? (fs.existsSync(oldFile) ? JSON.parse(fs.readFileSync(oldFile, "utf8")) : null);
const warnings = [];
const before = store ? Object.values(store.dates).filter((d) => d.complete).length : 0;
const seasonBefore = store?.season ?? null;
store = await collectResults({ espn, store, through, warnings });
if (seasonBefore && store.season && seasonBefore !== store.season) {
  // A new season: start the store over rather than mixing seasons.
  store = await collectResults({ espn, store: { season: store.season, dates: {} }, through, warnings });
}
const rows = allGames(store);
if (!rows.length) { console.error(`no results collected${warnings.length ? `: ${warnings[0]}` : ""}`); process.exit(1); }

const sit = computeSituations(rows, { through });
const sb = await espn.scoreboard(today);
const tonight = sb.ok ? sb.data.games.filter((g) => g.date === today && g.seasonType === 2).map((g) => ({ id: g.id, away: g.awayTri, home: g.homeTri, start: g.start })) : [];

saveStore(storeDir, store, fs);
if (fs.existsSync(oldFile)) fs.rmSync(oldFile);
const out = { generatedAt: new Date().toISOString(), season: store.season, today, ...sit, tonight, warnings };
fs.writeFileSync(path.join(root, "docs", "data", "situations.json"), JSON.stringify(out));
// Clutch-time player totals for the Clutch page.
const players = clutchPlayerTotals(rows, store.names || {});
fs.writeFileSync(path.join(root, "docs", "data", "clutch-players.json"), JSON.stringify({ generatedAt: out.generatedAt, through, games: rows.filter((g) => g.cl).length, players, teams: clutchTeamTotals(rows, "cp") }));
// 4th-quarter player totals (same shape as clutch).
const q4 = clutchPlayerTotals(rows, store.names || {}, "q4");
fs.writeFileSync(path.join(root, "docs", "data", "q4-players.json"), JSON.stringify({ generatedAt: out.generatedAt, through, games: rows.filter((g) => g.q4).length, players: q4, teams: clutchTeamTotals(rows, "q4") }));
// Every player's game lines, one file per team, for "with / without a teammate"
// (computed in the browser). A file is rewritten only when that team has played.
const teamDir = path.join(root, "docs", "data", "teams");
fs.mkdirSync(teamDir, { recursive: true });
const perTeam = {};
for (const g of rows) {
  if (!g.pl) continue;
  for (const [side, tri] of [[0, g.h], [1, g.a]]) {
    const pl = Object.fromEntries(Object.entries(g.pl).filter(([, v]) => v[0] === side).map(([id, v]) => [id, v.slice(1)]));
    (perTeam[tri] ??= []).push({ id: g.id, d: g.d, opp: side === 0 ? g.a : g.h, home: side === 0 && !g.n, pf: side === 0 ? g.hs : g.as, pa: side === 0 ? g.as : g.hs, pl });
  }
}
for (const [tri, games] of Object.entries(perTeam)) {
  const ids = new Set(games.flatMap((x) => Object.keys(x.pl)));
  const names = Object.fromEntries([...ids].map((id) => [id, store.names?.[id] || id]));
  const text = JSON.stringify({ team: tri, through: games[games.length - 1].d, keys: ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"], names, games });
  const file = path.join(teamDir, `${tri}.json`);
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text);
}
// Streaks and anomalies: active streaks, team streaks, unusual games on each of the last 7 game dates.
{
  const pg = playerGames(rows);
  const dates = [...new Set(rows.filter((g) => g.pl).map((g) => g.d))].sort().slice(-7);
  const byDate = Object.fromEntries(dates.map((d) => [d, anomalies(pg, store.names || {}, { dates: [d] })]));
  fs.writeFileSync(path.join(root, "docs", "data", "trends.json"), JSON.stringify({ generatedAt: out.generatedAt, through, streaks: activeStreaks(pg, store.names || {}), teams: teamStreaks(rows), anomalies: byDate }));
}
// Team leaders: game-by-game leads, season-total leaders, and shooting lines (50 / 40 / 90).
{
  const names = store.names || {};
  const tg = teamGames(rows);
  const used = new Set();
  const nm = (id) => { used.add(id); return id; };
  // Compact rows: [id, team, stat, led, sole, played, teamGames, run]
  const gameKeys = ["id", "team", "stat", "led", "sole", "played", "teamGames", "run"];
  const games = gameLeaders(tg).map((r) => { nm(r.id); return gameKeys.map((k) => r[k]); });
  const season = Object.fromEntries(Object.entries(seasonLeaders(tg)).map(([team, t]) => {
    const keep = new Set(Object.values(t.leaders).flatMap((l) => l.ids));
    const totals = Object.fromEntries([...keep].map((id) => [nm(id), t.totals[id]]));
    return [team, { teamGames: t.teamGames, leaders: t.leaders, totals, categories: t.categories }];
  }));
  // Compact rows: [id, team, games, teamGames, then per line: made, attempts, qualified 0/1, minMakes]
  const shootKeys = ["id", "team", "games", "teamGames", ...LINES.flatMap((L) => [`${L.key}.m`, `${L.key}.a`, `${L.key}.q`, `${L.key}.min`])];
  const shoot = Object.values(shooting(rows)).filter((p) => p.fga >= 20 || p.fg3a >= 10 || p.fta >= 10)
    .map((p) => { nm(p.id); return [p.id, p.team, p.games, p.teamGames, ...LINES.flatMap((L) => [p[L.key].m, p[L.key].a, p[L.key].qualified ? 1 : 0, p[L.key].minMakes])]; });
  fs.writeFileSync(path.join(root, "docs", "data", "leaders.json"), JSON.stringify({
    generatedAt: out.generatedAt, through, stats: LEAD_STATS, lines: LINES.map(({ key, label, pct, qualMakes }) => ({ key, label, pct, qualMakes })),
    names: Object.fromEntries([...used].map((id) => [id, names[id] || id])), gameKeys, games, season, shootKeys, shooting: shoot,
  }));
}
// Per-game box totals for the "vs top teams" page, which computes in the browser.
const slim = rows.filter((g) => g.hb && g.ab).map(({ id, d, h, a, hs, as, hb, ab }) => ({ id, d, h, a, hs, as, hb, ab }));
fs.writeFileSync(path.join(root, "docs", "data", "games.json"), JSON.stringify({ generatedAt: out.generatedAt, through, games: slim }));
// The page's copy of the ratings code (kept identical to src; a test checks).
fs.mkdirSync(path.join(root, "docs", "lib", "situations"), { recursive: true });
for (const f of ["ratings.js", "withwithout.js", "leaders.js"]) fs.copyFileSync(path.join(root, "src", "situations", f), path.join(root, "docs", "lib", "situations", f));
fs.mkdirSync(path.join(root, "docs", "lib", "espn"), { recursive: true });
for (const f of ["parse.js", "pbp.js"]) fs.copyFileSync(path.join(root, "src", "espn", f), path.join(root, "docs", "lib", "espn", f));
const after = Object.values(store.dates).filter((d) => d.complete).length;
const flags = Object.values(sit.teams).reduce((a, t) => a + t.flags.length, 0);
console.log(`situations through ${through}: ${rows.length} games (${after - before} new dates), ${Object.keys(sit.teams).length} teams, ${flags} flags, ${tonight.length} games tonight${warnings.length ? `; ${warnings.length} warnings` : ""}`);
