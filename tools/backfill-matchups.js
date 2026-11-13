#!/usr/bin/env node
/**
 * Back-fill for matchup history (0.48): run once on GitHub Actions (ESPN isn't reachable from Claude's shell),
 * then again only to add a finished season.
 *
 *   node tools/backfill-matchups.js [--from 2017] [--to 2026] [--results-only] [--logs-only] [--max-players N]
 *
 * Writes
 *   src/data/nba-results-history.json   every regular-season and playoff game, 2016-17 to 2025-26:
 *                                        rows [date, home, away, homeScore, awayScore, type]  (type 2 = regular, 3 = playoffs)
 *   src/data/player-logs-history.json.gz every game of every player who has played this season, same seasons:
 *                                        { players: { <espnId>: [[date, opp, home 1|0, "W"|"L", type, min, pts, reb, ast, stl, blk, fg3m, fgm, fga, fg3a, ftm, fta], …] } }
 * This season's games come from the daily box scores (docs/data/teams/*.json), so neither file changes during a season.
 *
 * Prints counts only (the Actions log is public).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { readGameLog } from "../src/espn/parse.js";
import { TEAMS, teamFromCode } from "../src/teams.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = Number(arg("--from", 2017)), TO = Number(arg("--to", 2026)); // ESPN season = the year it ends
const MAXP = Number(arg("--max-players", 100000));
const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba";

let last = 0, calls = 0, fails = 0;
async function get(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = Math.max(0, last + 220 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    calls++;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20000);
      const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 nba-command-center" } });
      clearTimeout(t);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 3) { fails++; return null; }
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return null;
}
const etDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return new Date(d.getTime() - 5 * 3600e3).toISOString().slice(0, 10); // ET (standard time is close enough: games end before 4 AM ET)
};
const tri = (abbr) => (TEAMS[abbr] ? abbr : teamFromCode(abbr || "")) || null;

// ---------- Team results ----------
async function results() {
  const tj = await get(`${BASE}/teams`);
  const ids = (tj?.sports?.[0]?.leagues?.[0]?.teams || []).map((x) => x.team?.id).filter(Boolean);
  const games = new Map();
  for (const id of ids) {
    for (let y = FROM; y <= TO; y++) {
      for (const type of [2, 3]) {
        const j = await get(`${BASE}/teams/${id}/schedule?season=${y}&seasontype=${type}`);
        for (const e of j?.events || []) {
          const c = e?.competitions?.[0];
          if (!c || c.status?.type?.completed !== true || games.has(e.id)) continue;
          const h = (c.competitors || []).find((k) => k.homeAway === "home"), a = (c.competitors || []).find((k) => k.homeAway === "away");
          const ht = tri(h?.team?.abbreviation), at = tri(a?.team?.abbreviation);
          const hs = Number(h?.score?.value ?? h?.score?.displayValue ?? h?.score), as = Number(a?.score?.value ?? a?.score?.displayValue ?? a?.score);
          if (!ht || !at || !Number.isFinite(hs) || !Number.isFinite(as)) continue;
          games.set(e.id, [etDate(e.date || c.date), ht, at, hs, as, Number(e.seasonType?.type ?? type) === 3 ? 3 : 2]);
        }
      }
    }
  }
  const rows = [...games.values()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const out = path.join(root, "src", "data", "nba-results-history.json");
  fs.writeFileSync(out, JSON.stringify({ source: "ESPN team schedules (regular season and playoffs)", seasons: `${FROM - 1}-${String(FROM).slice(2)} to ${TO - 1}-${String(TO).slice(2)}`, columns: ["date", "home", "away", "homeScore", "awayScore", "type"], games: rows }) + "\n");
  const bySeason = {};
  for (const r of rows) { const y = Number(r[0].slice(0, 4)) + (Number(r[0].slice(5, 7)) >= 8 ? 1 : 0); bySeason[y] = (bySeason[y] || 0) + 1; }
  console.log(`results: ${rows.length} games (${rows.filter((r) => r[5] === 3).length} playoff); by season ${JSON.stringify(bySeason)}`);
}

// ---------- Player game logs ----------
async function logs() {
  const ids = new Set();
  for (const f of fs.readdirSync(path.join(root, "docs", "data", "teams"))) {
    if (!f.endsWith(".json")) continue;
    const j = JSON.parse(fs.readFileSync(path.join(root, "docs", "data", "teams", f), "utf8"));
    for (const id of Object.keys(j.names || {})) ids.add(id);
  }
  const players = {};
  let n = 0, seasonsRead = 0, gamesRead = 0, noOpp = 0;
  for (const id of [...ids].slice(0, MAXP)) {
    n++;
    const cur = await get(`${WEB}/athletes/${id}/gamelog`);
    const opts = (cur?.filters || []).find((f) => f.name === "season")?.options || [];
    const seasons = opts.map((o) => Number(o.value)).filter((y) => y >= FROM && y <= TO);
    const rows = [];
    for (const y of seasons.sort()) {
      const j = await get(`${WEB}/athletes/${id}/gamelog?season=${y}`);
      if (!j) continue;
      seasonsRead++;
      const parsed = readGameLog(j);
      for (const t of parsed.types) {
        const type = /post/i.test(t.name) ? 3 : /regular/i.test(t.name) ? 2 : null;
        if (!type) continue; // preseason, play-in, All-Star
        for (const g of t.games) {
          const ev = j.events?.[g.id] || {};
          const opp = tri(ev.opponent?.abbreviation);
          if (!opp) { noOpp++; continue; }
          const home = ev.atVs === "vs" ? 1 : ev.atVs === "@" ? 0 : (ev.homeTeamId && ev.team?.id ? (String(ev.homeTeamId) === String(ev.team.id) ? 1 : 0) : null);
          const s = g.stats;
          rows.push([g.date || etDate(ev.gameDate), opp, home, ev.gameResult || null, type, s.min ?? null, s.pts ?? 0, s.reb ?? 0, s.ast ?? 0, s.stl ?? 0, s.blk ?? 0, s.fg3m ?? 0, s.fgm ?? 0, s.fga ?? 0, s.fg3a ?? 0, s.ftm ?? 0, s.fta ?? 0]);
          gamesRead++;
        }
      }
    }
    if (rows.length) players[id] = rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (n % 50 === 0) console.log(`  ${n} players, ${seasonsRead} seasons, ${gamesRead} games`);
  }
  const out = path.join(root, "src", "data", "player-logs-history.json.gz");
  const body = JSON.stringify({ source: "ESPN player game logs", seasons: `${FROM - 1}-${String(FROM).slice(2)} to ${TO - 1}-${String(TO).slice(2)}`, columns: ["date", "opp", "home", "result", "type", "min", "pts", "reb", "ast", "stl", "blk", "fg3m", "fgm", "fga", "fg3a", "ftm", "fta"], players });
  fs.writeFileSync(out, zlib.gzipSync(body, { level: 9 }));
  console.log(`logs: ${Object.keys(players).length} of ${n} players with past games; ${seasonsRead} seasons, ${gamesRead} games, ${noOpp} without an opponent; ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
}

if (!process.argv.includes("--logs-only")) await results();
if (!process.argv.includes("--results-only")) await logs();
console.log(`requests: ${calls}, failed: ${fails}`);
