/**
 * Team situations for the site: records vs winning teams, in close games, when
 * trailing at half or after three, and so on, with league baselines.
 *
 *   node scripts/situations.js [--through YYYY-MM-DD] [--today YYYY-MM-DD]
 *
 * Results through yesterday (Eastern) are kept in history/results.json, so later
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
const { collectResults, allGames } = await import("../src/situations/results.js");
const { computeSituations } = await import("../src/situations/records.js");
const { clutchPlayerTotals } = await import("../src/situations/clutch.js");

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const etDay = (offset = 0) => new Date(Date.now() + offset * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const today = opt("--today") || etDay(0);
const through = opt("--through") || new Date(Date.parse(today) - 864e5).toISOString().slice(0, 10);

const espn = createEspn({ dataDir: path.join(root, "data") });
const storeFile = path.join(root, "history", "results.json");
let store = fs.existsSync(storeFile) ? JSON.parse(fs.readFileSync(storeFile, "utf8")) : null;
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

fs.mkdirSync(path.dirname(storeFile), { recursive: true });
fs.writeFileSync(storeFile, JSON.stringify(store));
const out = { generatedAt: new Date().toISOString(), season: store.season, today, ...sit, tonight, warnings };
fs.writeFileSync(path.join(root, "docs", "data", "situations.json"), JSON.stringify(out));
// Clutch-time player totals for the Clutch page.
const players = clutchPlayerTotals(rows, store.names || {});
fs.writeFileSync(path.join(root, "docs", "data", "clutch-players.json"), JSON.stringify({ generatedAt: out.generatedAt, through, games: rows.filter((g) => g.cl).length, players }));
// Per-game box totals for the "vs top defenses" page, which computes in the browser.
const slim = rows.filter((g) => g.hb && g.ab).map(({ id, d, h, a, hs, as, hb, ab }) => ({ id, d, h, a, hs, as, hb, ab }));
fs.writeFileSync(path.join(root, "docs", "data", "games.json"), JSON.stringify({ generatedAt: out.generatedAt, through, games: slim }));
// The page's copy of the ratings code (kept identical to src; a test checks).
fs.mkdirSync(path.join(root, "docs", "lib", "situations"), { recursive: true });
fs.copyFileSync(path.join(root, "src", "situations", "ratings.js"), path.join(root, "docs", "lib", "situations", "ratings.js"));
const after = Object.values(store.dates).filter((d) => d.complete).length;
const flags = Object.values(sit.teams).reduce((a, t) => a + t.flags.length, 0);
console.log(`situations through ${through}: ${rows.length} games (${after - before} new dates), ${Object.keys(sit.teams).length} teams, ${flags} flags, ${tonight.length} games tonight${warnings.length ? `; ${warnings.length} warnings` : ""}`);
