#!/usr/bin/env node
/**
 * The archive behind the rare-combination cards (0.141.17, src/situations/linerare.js): every regular-season player line
 * since 1993-94 through last season, as counts per combination (a histogram, so the nightly build can add this season's
 * games), and the games whose own count is small enough to be named. NBA Cup title games are left out (they count toward
 * no regular-season total; src/situations/results.js CUP_TITLE_DATES).
 *   node tools/line-rarity-archive.mjs --dir /home/claude/work/full > /dev/null   (writes src/data/line-rarity-archive.json.gz)
 * Box scores: the backtest's folder of ESPN box scores (f-<id>.json: { d, t: [{ t, home, s, p: [[id, name, pos, starter,
 * min, pts, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, reb, ast, stl, blk, tov, pf, pm]] }] }).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { COMBOS, FEW, RARE_MAX } from "../src/situations/linerare.js";
import { CUP_TITLE_DATES } from "../src/situations/results.js";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg("--dir"), THROUGH = arg("--through", "2026-07-31");
if (!DIR) { console.error("usage: node tools/line-rarity-archive.mjs --dir <folder>"); process.exit(2); }
const COLS = ["min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "blk", "tov", "pf", "pm"];
const cup = new Set(CUP_TITLE_DATES || []);
const lines = [];
let games = 0, skipped = 0, first = null, last = null;
for (const f of fs.readdirSync(DIR)) {
  if (!f.startsWith("f-")) continue;
  const g = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  if (g.d > THROUGH) continue;
  if (cup.has(g.d)) { skipped++; continue; }
  games++; if (!first || g.d < first) first = g.d; if (!last || g.d > last) last = g.d;
  for (const t of g.t) for (const p of t.p) {
    if (!(p[4] > 0)) continue;
    const r = { name: p[1], team: t.t, d: g.d, gid: f.slice(2, -5) };
    COLS.forEach((c, i) => (r[c] = p[i + 4]));
    lines.push(r);
  }
}
const hist = {}, top = {};
for (const c of COMBOS) {
  const [A, B, C] = c.caps, ix = (x, y, z) => (x * (B + 1) + y) * (C + 1) + z, G = new Int32Array((A + 1) * (B + 1) * (C + 1));
  const cellOf = (r) => c.keys.map((k, i) => Math.min(c.caps[i], Math.max(0, r[k] | 0)));
  for (const r of lines) { const [x, y, z] = cellOf(r); G[ix(x, y, z)]++; }
  const h = [];
  for (let x = 0; x <= A; x++) for (let y = 0; y <= B; y++) for (let z = 0; z <= C; z++) if (G[ix(x, y, z)]) h.push([x, y, z, G[ix(x, y, z)]]);
  hist[c.id] = h;
  // suffix counts, to keep the games whose own count is small
  const S = Int32Array.from(G);
  for (let x = A; x >= 0; x--) for (let y = B; y >= 0; y--) for (let z = C; z >= 0; z--) {
    let v = S[ix(x, y, z)];
    if (x < A) v += S[ix(x + 1, y, z)]; if (y < B) v += S[ix(x, y + 1, z)]; if (z < C) v += S[ix(x, y, z + 1)];
    if (x < A && y < B) v -= S[ix(x + 1, y + 1, z)]; if (x < A && z < C) v -= S[ix(x + 1, y, z + 1)]; if (y < B && z < C) v -= S[ix(x, y + 1, z + 1)];
    if (x < A && y < B && z < C) v += S[ix(x + 1, y + 1, z + 1)];
    S[ix(x, y, z)] = v;
  }
  top[c.id] = lines.filter((r) => { const [x, y, z] = cellOf(r); return S[ix(x, y, z)] <= RARE_MAX + 1; }).map((r) => [...cellOf(r), r.name, r.team, r.d, r.gid]);
}
{
  const P = FEW.capPts, F = FEW.capFga, H = new Int32Array((P + 1) * (F + 1)), ix = (p, f) => p * (F + 1) + f;
  for (const r of lines) H[ix(Math.min(P, r.pts), Math.min(F, r.fga))]++;
  const h = []; for (let p = 0; p <= P; p++) for (let f = 0; f <= F; f++) if (H[ix(p, f)]) h.push([p, f, H[ix(p, f)]]);
  hist.few = h;
  const S = Int32Array.from(H);
  for (let p = P; p >= 0; p--) for (let f = 0; f <= F; f++) { let v = S[ix(p, f)]; if (p < P) v += S[ix(p + 1, f)]; if (f > 0) v += S[ix(p, f - 1)]; if (p < P && f > 0) v -= S[ix(p + 1, f - 1)]; S[ix(p, f)] = v; }
  top.few = lines.filter((r) => r.pts >= FEW.minPts && S[ix(Math.min(P, r.pts), Math.min(F, r.fga))] <= RARE_MAX + 1).map((r) => [Math.min(P, r.pts), Math.min(F, r.fga), r.name, r.team, r.d, r.gid]);
}
const out = { made: new Date().toISOString().slice(0, 10), first, last, games, playerLines: lines.length, cupTitleGamesLeftOut: skipped, hist, top };
const file = new URL("../src/data/line-rarity-archive.json.gz", import.meta.url).pathname;
fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(out), { level: 9 }));
console.error(`line rarity archive: ${games} games ${first} → ${last} (${skipped} Cup title games left out), ${lines.length} player lines; top games ${Object.entries(top).map(([k, v]) => `${k} ${v.length}`).join(", ")}; ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
