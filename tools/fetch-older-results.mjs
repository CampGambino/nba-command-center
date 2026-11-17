#!/usr/bin/env node
/**
 * Regular-season results before the main back-fill (0.86): every game ESPN has for 1993-94 through 2015-16.
 *
 *   node tools/fetch-older-results.mjs        (about four minutes; 690 requests)
 *
 * Writes src/data/nba-results-older.json.gz: rows [date, home, away, homeScore, awayScore], regular season only.
 * ESPN thins out before 1993-94 (a game a day or none), so that is where this starts. Each team-season is checked
 * against the franchise's record (src/data/nba-team-seasons-2026-27.json): every one from 1993-94 on is right except
 * 1999-00, where ESPN is about 23 games short league-wide; `complete` in the file says which seasons can be leaned on.
 * The 1988-2002 Hornets are filed under New Orleans by ESPN and under Charlotte by the league; they are moved to CHA.
 * Used only for team streaks and starts (src/situations/deepseq.js); head-to-head and player lines keep 2016-17.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const FROM = 1994, TO = 2016; // ESPN season = the year it ends
const get = async (url) => { for (let k = 0; k < 3; k++) { try { const r = await fetch(url, { signal: AbortSignal.timeout(25000) }); if (r.ok) return await r.json(); } catch { /* retry */ } await new Promise((r) => setTimeout(r, 500)); } return null; };
const etDate = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const seasonOf = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return m >= 8 ? `${y}-${String((y + 1) % 100).padStart(2, "0")}` : `${y - 1}-${String(y % 100).padStart(2, "0")}`; };

const tj = await get(`${BASE}/teams`);
const teams = (tj?.sports?.[0]?.leagues?.[0]?.teams || []).map((x) => x.team);
const FIX = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", PHO: "PHX" };
const triOf = Object.fromEntries(teams.map((t) => [t.id, FIX[t.abbreviation] || t.abbreviation]));
const jobs = []; for (const t of teams) for (let y = FROM; y <= TO; y++) jobs.push([t.id, y]);
const raw = new Map(); let i = 0, fails = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (i < jobs.length) {
    const [id, y] = jobs[i++]; const j = await get(`${BASE}/teams/${id}/schedule?season=${y}&seasontype=2`);
    if (!j) { fails++; continue; }
    for (const e of j.events || []) {
      const c = e?.competitions?.[0]; if (!c || c.status?.type?.completed !== true || raw.has(e.id)) continue;
      const h = (c.competitors || []).find((k) => k.homeAway === "home"), a = (c.competitors || []).find((k) => k.homeAway === "away");
      const ht = triOf[h?.team?.id], at = triOf[a?.team?.id];
      const hs = Number(h?.score?.value ?? h?.score?.displayValue ?? h?.score), as = Number(a?.score?.value ?? a?.score?.displayValue ?? a?.score);
      raw.set(e.id, [etDate(e.date || c.date), ht, at, hs, as]);
    }
  }
}));
// Out: placeholder rows (0-0, a team ESPN no longer has), and the same game listed twice.
const seen = new Set(), games = [];
for (const [d, h0, a0, hs, as] of [...raw.values()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
  if (!h0 || !a0 || !(hs >= 40) || !(as >= 40) || hs === as) continue;
  const old = seasonOf(d) < "2002-03", h = old && h0 === "NOP" ? "CHA" : h0, a = old && a0 === "NOP" ? "CHA" : a0;
  if (seen.has(`${d}|${h}|${a}`)) continue;
  seen.add(`${d}|${h}|${a}`); games.push([d, h, a, hs, as]);
}
// Each team-season against the franchise's record.
const official = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-team-seasons-2026-27.json"), "utf8")).teams;
const by = {};
for (const [d, h, a, hs, as] of games) { const s = seasonOf(d); ((by[s] ??= {})[h] ??= [0, 0])[hs > as ? 0 : 1]++; ((by[s] ??= {})[a] ??= [0, 0])[as > hs ? 0 : 1]++; }
const complete = {};
for (const s of Object.keys(by).sort()) {
  const all = Object.entries(official).filter(([, rows]) => rows.some((r) => r[0] === s));
  const right = all.filter(([t, rows]) => { const r = rows.find((x) => x[0] === s); return by[s][t] && by[s][t][0] === r[1] && by[s][t][1] === r[2]; }).length;
  complete[s] = right === all.length;
  console.log(`${s}: ${right} of ${all.length} teams' records right`);
}
fs.writeFileSync(path.join(root, "src", "data", "nba-results-older.json.gz"), zlib.gzipSync(JSON.stringify({
  source: "ESPN team schedules, regular season", seasons: `${FROM - 1}-${String(FROM).slice(2)} to ${TO - 1}-${String(TO).slice(2)}`, complete,
  note: "A season marked complete: every team's wins and losses equal the franchise's record. 1999-00 is about 23 games short in ESPN's data.",
  columns: ["date", "home", "away", "homeScore", "awayScore"], games })));
console.log(`${games.length} games written; ${fails} requests failed; seasons not complete: ${Object.keys(complete).filter((s) => !complete[s]).join(", ") || "none"}`);
