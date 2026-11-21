#!/usr/bin/env node
/**
 * Past seasons' box scores from ESPN, in the results store's own format (0.141.7, the user 11/21: "check box scores
 * from the last 1-4 years to increase the volume of scored calls across all stats").
 *
 * One store per season: <out>/<season>/meta.json (names) and <out>/<season>/YYYY-MM-DD.json ({ complete, games }), each
 * game { id, d, h, a, hs, as, t, pl } with pl = { espnId: [0 home | 1 away, starter, minutes, ...PLAYER_BOX_KEYS] }, the
 * same shape this season's history/results uses, so the code that reads this season reads these. `t` is ESPN's season
 * type (2 regular season, 3 playoffs; "cup-final" for the NBA Cup final, which counts in no record).
 *
 * Resumable: a date already written is skipped. Polite: four requests at a time, spaced. ESPN only (no NBA.com stats).
 *   NODE_USE_ENV_PROXY=1 node tools/fetch-box-history.mjs --from 2022-10-01 --to 2026-06-30 --out ../box-history
 */
import fs from "node:fs";
import path from "node:path";
import { readScoreboard, readPlayerBox, CUP_FINAL } from "../src/espn/parse.js";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = arg("--from"), TO = arg("--to"), OUT = arg("--out");
if (!FROM || !TO || !OUT) { console.error("usage: fetch-box-history.mjs --from YYYY-MM-DD --to YYYY-MM-DD --out <dir>"); process.exit(1); }
const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { "User-Agent": "nba-command-center (personal use)" } });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch { /* retry */ }
    await sleep(1500 * i);
  }
  throw new Error(`gave up on ${url}`);
}

const seasonOf = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7), s = m >= 8 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; };
const days = [];
for (let t = Date.parse(`${FROM}T12:00:00Z`); t <= Date.parse(`${TO}T12:00:00Z`); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));

const metas = {};
const meta = (season) => {
  if (metas[season]) return metas[season];
  const f = path.join(OUT, season, "meta.json");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  metas[season] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : { season, source: "ESPN box scores (tools/fetch-box-history.mjs)", names: {} };
  return metas[season];
};
const saveMeta = (season) => fs.writeFileSync(path.join(OUT, season, "meta.json"), JSON.stringify(metas[season]));

let gamesDone = 0, daysDone = 0, skipped = 0;
const t0 = Date.now();
for (const d of days) {
  const season = seasonOf(d), file = path.join(OUT, season, `${d}.json`);
  if (fs.existsSync(file)) { skipped++; continue; }
  const sb = await getJson(`${SITE}/scoreboard?dates=${d.replace(/-/g, "")}&limit=50`);
  const games = (sb ? readScoreboard(sb).games : []).filter((g) => g.final && (g.seasonType === 2 || g.seasonType === 3 || g.seasonType === CUP_FINAL) && g.homeTri && g.awayTri && g.date === d);
  const rows = [];
  for (let i = 0; i < games.length; i += 4) {
    const batch = games.slice(i, i + 4);
    const got = await Promise.all(batch.map((g) => getJson(`${SITE}/summary?event=${g.id}`).catch(() => null)));
    batch.forEach((g, k) => {
      const j = got[k];
      if (!j) return;
      const homeId = j?.header?.competitions?.[0]?.competitors?.find((c) => c.homeAway === "home")?.team?.id;
      const box = readPlayerBox(j, homeId);
      const pl = {}, m = meta(season);
      for (const [id, x] of Object.entries(box)) { pl[id] = [x.side === "home" ? 0 : 1, x.starter ? 1 : 0, x.min, ...x.s]; if (x.name) m.names[id] = x.name; }
      if (!Object.keys(pl).length) return;
      rows.push({ id: g.id, d, h: g.homeTri, a: g.awayTri, hs: g.homeScore, as: g.awayScore, t: g.seasonType, pl });
    });
    await sleep(250);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ complete: rows.length === games.length, games: rows }));
  if (rows.length) saveMeta(season);
  gamesDone += rows.length; daysDone++;
  if (daysDone % 20 === 0) console.log(`${d}: ${gamesDone} games in ${daysDone} days (${Math.round((Date.now() - t0) / 1000)} s)`);
}
console.log(`done: ${gamesDone} games over ${daysDone} days fetched, ${skipped} days already on file`);
