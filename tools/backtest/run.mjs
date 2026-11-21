#!/usr/bin/env node
/**
 * The backtest (0.141.7, the user 11/21: "couldn't you check box scores from the last 1-4 years to increase the
 * volume of scored calls across all stats… trends and timeframes and player hot and cold streaks while highlighting
 * the outliers?").
 *
 * Reads every regular-season box score in a folder of f-<id>.json files ({ d, t: [{ t, home, s, p: [[id, name, pos,
 * starter, min, pts, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, reb, ast, stl, blk, tov, pf, pm]] }] }, players who
 * played only) and answers four questions, using for each game only the games before it:
 *
 *  A. Calibration, per stat (the last four seasons): what the live model (src/anticipate/model.js makeSampler: his
 *     games in his team's last 20, topped up from last season to 20; 80% a draw from those games, 20% a smoothed
 *     normal) gives for "at least k" in the next game he plays, against what happened. Exact, not simulated: the
 *     model's chance for one game is 0.8 × share of his lines at k or more + 0.2 × P(normal ≥ k − 0.5).
 *  B. Hot and cold stretches (all seasons): how much of a last-W-games stretch above or below his own norm carries
 *     into the next 1, 3 and 10 games, per stat, in counts and per minute (and minutes themselves).
 *  C. Timeframes (the last four seasons): which window of past games predicts the next game best, per stat.
 *  D. Outliers (the last four seasons): how often a night is 2, 2.5, 3 spreads above a player's own norm.
 *
 *   node tools/backtest/run.mjs --dir /home/claude/work/full --out /tmp/backtest.json [--from 2022-23]
 */
import fs from "node:fs";
import path from "node:path";
import { fitCalibration, calibrate } from "../../src/anticipate/calibrate.js";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg("--dir"), OUT = arg("--out", "/tmp/backtest.json"), FROM = arg("--from", "2022-23");
const COLS = ["min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "blk", "tov", "pf"];
const CI = Object.fromEntries(COLS.map((c, i) => [c, i + 4]));
const STATS = ["pts", "reb", "ast", "fg3m", "stl", "blk", "tov", "ftm", "fgm", "oreb", "dreb"];
const seasonOf = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7), s = m >= 8 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; };

// ---------- load ----------
const t0 = Date.now();
const players = new Map();             // id -> [{ d, s, team, v: Float32Array(stats), min, starter, pos }]
const teamDates = new Map();           // `${season}|${team}` -> sorted dates
for (const f of fs.readdirSync(DIR)) {
  if (!f.startsWith("f-")) continue;
  const g = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  const s = seasonOf(g.d);
  for (const t of g.t) {
    const k = `${s}|${t.t}`;
    (teamDates.get(k) ?? teamDates.set(k, []).get(k)).push(g.d);
    for (const p of t.p) {
      const row = { d: g.d, s, team: t.t, min: p[CI.min], starter: p[3], pos: p[2], v: {} };
      for (const st of STATS) row.v[st] = p[CI[st]];
      const L = players.get(p[0]) ?? players.set(p[0], []).get(p[0]);
      L.push(row);
    }
  }
}
for (const L of players.values()) L.sort((a, b) => a.d.localeCompare(b.d));
for (const L of teamDates.values()) L.sort();
const seasons = [...new Set([...teamDates.keys()].map((k) => k.split("|")[0]))].sort();
const recent = seasons.filter((s) => s >= FROM);
console.log(`loaded ${players.size} players, ${seasons.length} seasons (${seasons[0]} to ${seasons.at(-1)}), ${Math.round((Date.now() - t0) / 1000)} s`);

// ---------- helpers ----------
const Phi = (x) => { // standard normal CDF (Abramowitz-Stegun 7.1.26)
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return 0.5 * (1 + Math.sign(x) * y);
};
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sdOf = (a, m) => Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1));

// The live model's lines for a player's game at index i: his games with this team inside the team's last 20 games
// before the date, most recent first, topped up to 20 from his last season's games (most recent first).
function liveLines(L, i) {
  const g = L[i], dates = teamDates.get(`${g.s}|${g.team}`) || [];
  let hi = dates.findIndex((d) => d >= g.d); if (hi < 0) hi = dates.length;
  const win = new Set(dates.slice(Math.max(0, hi - 20), hi));
  const lines = [];
  for (let j = i - 1; j >= 0 && L[j].s === g.s; j--) if (L[j].team === g.team && win.has(L[j].d)) lines.push(L[j]);
  if (lines.length < 20) {
    const prevSeason = seasons[seasons.indexOf(g.s) - 1];
    for (let j = i - 1; j >= 0 && lines.length < 20; j--) if (L[j].s === prevSeason) lines.push(L[j]);
  }
  return lines;
}
function modelP(vals, k) {
  const n = vals.length, m = mean(vals), sd = Math.max(sdOf(vals, m), Math.sqrt(m)) || 1e-9;
  const frac = vals.filter((x) => x >= k).length / n;
  const smooth = k <= 0 ? 1 : 1 - Phi((k - 0.5 - m) / sd);
  return 0.8 * frac + 0.2 * smooth;
}

// ---------- A. calibration (and C. windows, D. outliers) over the recent seasons ----------
const A = {}, Abins = {}, C = {}, D = {};
const WINDOWS = [3, 5, 10, 20, 40, "season", "live"];
for (const st of STATS) {
  A[st] = []; Abins[st] = Array.from({ length: 20 }, () => ({ n: 0, p: 0, hit: 0 }));
  C[st] = Object.fromEntries(WINDOWS.map((w) => [w, { n: 0, abs: 0, sq: 0 }]));
  D[st] = { n: 0, z2: 0, z25: 0, z3: 0, zm2: 0 };
}
let callCount = 0;
const R = (() => { let a = 12345; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
for (const L of players.values()) {
  for (let i = 0; i < L.length; i++) {
    const g = L[i];
    if (!recent.includes(g.s) || g.min <= 0) continue;
    const lines = liveLines(L, i);
    if (lines.length < 5) continue;
    for (const st of STATS) {
      const vals = lines.map((l) => l.v[st]), y = g.v[st];
      const m = mean(vals), sd = Math.max(sdOf(vals, m), Math.sqrt(m));
      // A: thresholds where the model is between 3% and 97%, up to five of them, spread across that range
      const ks = [];
      for (let k = 1; k <= 80; k++) { const p = modelP(vals, k); if (p < 0.03) break; if (p <= 0.97) ks.push([k, p]); }
      const pick = ks.length <= 5 ? ks : [0, 1, 2, 3, 4].map((q) => ks[Math.round((q * (ks.length - 1)) / 4)]);
      for (const [k, p] of pick) {
        const hit = y >= k ? 1 : 0, b = Abins[st][Math.min(19, Math.floor(p * 20))];
        b.n++; b.p += p; b.hit += hit; callCount++;
        if (A[st].length < 150000 || R() < 0.05) A[st].length < 150000 ? A[st].push({ p, hit }) : (A[st][Math.floor(R() * 150000)] = { p, hit });
      }
      // C: next-game error by window (mean of the last N games he played, any team, this season or before)
      for (const w of WINDOWS) {
        let pv;
        if (w === "live") pv = m;
        else if (w === "season") { const sv = []; for (let j = i - 1; j >= 0 && L[j].s === g.s; j--) sv.push(L[j].v[st]); if (sv.length < 5) continue; pv = mean(sv); }
        else { if (i < w) continue; let s = 0; for (let j = i - w; j < i; j++) s += L[j].v[st]; pv = s / w; }
        const e = y - pv, c = C[st][w]; c.n++; c.abs += Math.abs(e); c.sq += e * e;
      }
      // D: how far above his own norm (the live lines' mean and spread)
      if (m >= 1) { const z = (y - m) / sd, dd = D[st]; dd.n++; if (z >= 2) dd.z2++; if (z >= 2.5) dd.z25++; if (z >= 3) dd.z3++; if (z <= -2) dd.zm2++; }
    }
  }
}
const calib = {};
for (const st of STATS) {
  const fit = fitCalibration(A[st]);
  const bins = Abins[st].filter((b) => b.n >= 200).map((b) => ({ pAvg: +(b.p / b.n).toFixed(3), hit: +(b.hit / b.n).toFixed(3), n: b.n }));
  const all = Abins[st].reduce((s, b) => ({ n: s.n + b.n, p: s.p + b.p, hit: s.hit + b.hit }), { n: 0, p: 0, hit: 0 });
  const brier = (cal) => mean(A[st].map((c) => ((cal ? calibrate(c.p, fit) : c.p) - c.hit) ** 2));
  calib[st] = { calls: all.n, expected: Math.round(all.p), happened: all.hit, fit: fit ? { a: +fit.a.toFixed(3), b: +fit.b.toFixed(3) } : null, brierRaw: +brier(false).toFixed(4), brierFit: fit ? +brier(true).toFixed(4) : null, bins };
}
console.log(`A: ${callCount} calls scored over ${recent.join(", ")}`);

// ---------- B. hot and cold stretches over every season ----------
// For a player's game i with 40 earlier games this season-or-last: base = mean of the 40 games before the last W;
// dev = (mean of the last W) - base. Outcome: mean of the next H games - base. Slope (least squares through 0):
// the share of a stretch's excess that carries forward. In counts, per 36 minutes, and minutes.
const B = {};
const BW = [3, 5, 10], BH = [1, 3, 10], BSTATS = ["min", ...STATS.slice(0, 6)];
for (const st of BSTATS) for (const per of st === "min" ? ["count"] : ["count", "per36"]) for (const w of BW) for (const h of BH) B[`${st}|${per}|${w}|${h}`] = { n: 0, xy: 0, xx: 0, hotN: 0, hotDev: 0, hotOut: 0, coldN: 0, coldDev: 0, coldOut: 0 };
const valOf = (g, st, per) => (st === "min" ? g.min : per === "per36" ? (g.min >= 10 ? (g.v[st] * 36) / g.min : null) : g.v[st]);
for (const L of players.values()) {
  for (let i = 50; i < L.length - 10; i++) {
    if (L[i - 50].d < "1993-08-01") continue;
    for (const w of BW) {
      const baseRows = L.slice(i - w - 40, i - w), recentRows = L.slice(i - w, i);
      // keep it inside two seasons and with real minutes
      if (seasons.indexOf(L[i].s) - seasons.indexOf(baseRows[0].s) > 1) continue;
      for (const st of BSTATS) for (const per of st === "min" ? ["count"] : ["count", "per36"]) {
        const bv = baseRows.map((g) => valOf(g, st, per)).filter((x) => x != null), rv = recentRows.map((g) => valOf(g, st, per)).filter((x) => x != null);
        if (bv.length < 30 || rv.length < w) continue;
        const base = mean(bv), sd = sdOf(bv, base), dev = mean(rv) - base;
        if (sd <= 0) continue;
        const z = dev / (sd / Math.sqrt(w));
        for (const h of BH) {
          const ov = L.slice(i, i + h).map((g) => valOf(g, st, per)).filter((x) => x != null);
          if (ov.length < h) continue;
          const out = mean(ov) - base, c = B[`${st}|${per}|${w}|${h}`];
          c.n++; c.xy += dev * out; c.xx += dev * dev;
          if (z >= 1.5) { c.hotN++; c.hotDev += dev; c.hotOut += out; }
          if (z <= -1.5) { c.coldN++; c.coldDev += dev; c.coldOut += out; }
        }
      }
    }
  }
}
const streaks = {};
for (const [k, c] of Object.entries(B)) {
  if (!c.n) continue;
  streaks[k] = { n: c.n, carry: +(c.xy / c.xx).toFixed(3), hot: c.hotN ? { n: c.hotN, dev: +(c.hotDev / c.hotN).toFixed(2), next: +(c.hotOut / c.hotN).toFixed(2), kept: +(c.hotOut / c.hotDev).toFixed(3) } : null, cold: c.coldN ? { n: c.coldN, dev: +(c.coldDev / c.coldN).toFixed(2), next: +(c.coldOut / c.coldN).toFixed(2), kept: +(c.coldOut / c.coldDev).toFixed(3) } : null };
}

const windows = {};
for (const st of STATS) windows[st] = Object.fromEntries(Object.entries(C[st]).filter(([, c]) => c.n).map(([w, c]) => [w, { n: c.n, mae: +(c.abs / c.n).toFixed(3), rmse: +Math.sqrt(c.sq / c.n).toFixed(3) }]));
const outliers = {};
for (const st of STATS) { const d = D[st]; outliers[st] = { n: d.n, z2: +(d.z2 / d.n).toFixed(4), z25: +(d.z25 / d.n).toFixed(4), z3: +(d.z3 / d.n).toFixed(4), zMinus2: +(d.zm2 / d.n).toFixed(4) }; }

const out = { made: new Date().toISOString(), dir: DIR, seasons: { all: [seasons[0], seasons.at(-1)], recent }, calibration: calib, streaks, windows, outliers };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s -> ${OUT}`);
