#!/usr/bin/env node
/**
 * How rare an outlier night really is (0.141.15, from the backtest's finding D: real nights have fat tails, so "2.5
 * spreads above his norm" is about 1 in 36 games for points, not the bell curve's 1 in 160).
 *
 * Over the last four regular seasons of box scores (the backtest's folder of f-<id>.json files), every player-game with 5+
 * earlier games that season is measured the way src/situations/trends.js anomalies() measures a night: against his
 * earlier games that season, with the same spread floors. Kept: for each stat, the share of all those player-games at
 * least so many spreads above (and, for points and minutes among regulars, below); the share of 0-for-6+ nights from
 * three; and the share of 10+ shot nights at least so far off his usual field-goal percentage.
 *   node tools/outlier-tails.mjs --dir /home/claude/work/full [--from 2022-23] > src/data/outlier-tails.json
 */
import fs from "node:fs";
import path from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg("--dir"), FROM = arg("--from", "2022-23");
if (!DIR) { console.error("usage: node tools/outlier-tails.mjs --dir <folder of f-<id>.json>"); process.exit(2); }
// The same floors and "regular" rules as anomalies() (src/situations/trends.js).
export const FLOOR = { pts: 4, reb: 2.5, ast: 2, fg3m: 1.2, stl: 1, blk: 1, min: 5 };
const COLS = ["min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "blk", "tov", "pf"];
const CI = Object.fromEntries(COLS.map((c, i) => [c, i + 4]));
const seasonOf = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7), s = m >= 8 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; };

const players = new Map();
for (const f of fs.readdirSync(DIR)) {
  if (!f.startsWith("f-")) continue;
  const g = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  const s = seasonOf(g.d);
  if (s < FROM) continue;
  for (const t of g.t) for (const p of t.p) {
    const row = { d: g.d, s };
    for (const c of COLS) row[c] = p[CI[c]];
    (players.get(p[0]) ?? players.set(p[0], []).get(p[0])).push(row);
  }
}
const UP = []; for (let z = 1.5; z <= 8.001; z += 0.25) UP.push(+z.toFixed(2));
const DIFF = []; for (let x = 0.25; x <= 0.701; x += 0.05) DIFF.push(+x.toFixed(2));
const up = Object.fromEntries(Object.keys(FLOOR).map((k) => [k, UP.map(() => 0)]));
const down = { pts: UP.map(() => 0), min: UP.map(() => 0) };
const fgHi = DIFF.map(() => 0), fgLo = DIFF.map(() => 0);
let n = 0, cold3 = 0;
const seasons = new Set();
for (const L of players.values()) {
  L.sort((a, b) => a.d.localeCompare(b.d));
  for (let i = 0; i < L.length; i++) {
    const g = L[i];
    const prior = [];
    for (let j = i - 1; j >= 0 && L[j].s === g.s; j--) prior.push(L[j]);
    if (prior.length < 5) continue;
    n++; seasons.add(g.s);
    for (const k of Object.keys(FLOOR)) {
      const xs = prior.map((o) => o[k]), m = xs.reduce((a, b) => a + b, 0) / xs.length;
      const s = Math.max(Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)), FLOOR[k]);
      const z = (g[k] - m) / s;
      UP.forEach((t, q) => { if (z >= t) up[k][q]++; });
      const regular = k === "pts" ? m >= 15 : k === "min" ? m >= 20 : false;
      if (regular) UP.forEach((t, q) => { if (z <= -t) down[k][q]++; });
    }
    if (g.fg3a >= 6 && g.fg3m === 0) cold3++;
    const fga = prior.reduce((a, o) => a + o.fga, 0), fgm = prior.reduce((a, o) => a + o.fgm, 0);
    if (g.fga >= 10 && fga >= 30) {
      const dlt = g.fgm / g.fga - fgm / fga;
      DIFF.forEach((t, q) => { if (dlt >= t) fgHi[q]++; if (dlt <= -t) fgLo[q]++; });
    }
  }
}
const share = (c) => +(c / n).toPrecision(3);
const out = {
  made: new Date().toISOString().slice(0, 10), seasons: [...seasons].sort(), playerGames: n,
  note: "Share of player-games (5+ earlier games that season) at least this far from his own norm, as src/situations/trends.js measures it.",
  z: UP, up: Object.fromEntries(Object.entries(up).map(([k, v]) => [k, v.map(share)])), down: Object.fromEntries(Object.entries(down).map(([k, v]) => [k, v.map(share)])),
  fgDiff: DIFF, fgHigh: fgHi.map(share), fgLow: fgLo.map(share), cold3: share(cold3),
};
process.stdout.write(JSON.stringify(out) + "\n");
console.error(`outlier tails: ${n} player-games over ${out.seasons.join(", ")}; points 2.5 spreads up ${out.up.pts[UP.indexOf(2.5)]}, 3 up ${out.up.pts[UP.indexOf(3)]}; 0-for-6+ from three ${out.cold3}`);
