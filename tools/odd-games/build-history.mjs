// The history table for odd lines (0.117.0): every template level in src/situations/oddlines.js counted over the
// box scores in /home/claude/work/full (see fetch-full.mjs), with the same rules the site runs on this season.
//   node tools/odd-games/build-history.mjs [--dir /home/claude/work/full] [--out src/data/odd-lines-history.json] [--through 2025]
// Only games where the players' points add up to the team's score. Season = the year it started.
import fs from "node:fs"; import path from "node:path";
import { TEMPLATES, matchLine, posGroup, ODD } from "../../src/situations/oddlines.js";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg("--dir", "/home/claude/work/full"), OUT = arg("--out", "src/data/odd-lines-history.json"), THROUGH = +arg("--through", "2025");
const CUP = new Set(["2023-12-09", "2024-12-17", "2025-12-16"]);
const seasonOf = (d) => (+d.slice(5, 7) >= 8 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const K = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "blk", "tov", "pf"]; // p[3..19]
const lines = [], sum = new Map(); let games = 0, zeroed = 0, bad = 0, later = 0; const seen = new Set();
for (const f of fs.readdirSync(DIR)) {
  const g = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  if (seasonOf(g.d) > THROUGH) { later++; continue; }
  if (CUP.has(g.d) || g.t.length !== 2) { bad++; continue; }
  const key = `${g.d}|${g.t.map((t) => t.t).sort().join("|")}`; if (seen.has(key)) { bad++; continue; } seen.add(key);
  if (g.t.every((t) => t.p.every((p) => !p[5] && !p[14] && !p[15]))) { zeroed++; continue; }
  if (!g.t.every((t) => t.s != null && t.p.reduce((a, p) => a + (p[5] || 0), 0) === t.s)) { bad++; continue; }
  games++;
  const season = seasonOf(g.d);
  g.t.forEach((t, i) => {
    for (const p of t.p) {
      const l = {}; K.forEach((k, j) => { l[k] = p[3 + j] || 0; });
      if (!(l.min > 0) && !(l.pts + l.reb + l.ast + l.stl + l.blk + l.tov + l.pf + l.fga + l.fta > 0)) continue;
      const pk = `${p[0]}|${season}`;
      if (l.min > 0) { const s = sum.get(pk) || { n: 0, pts: 0, reb: 0, ast: 0 }; s.n++; s.pts += l.pts; s.reb += l.reb; s.ast += l.ast; sum.set(pk, s); }
      lines.push({ l, pk, name: p[1] || String(p[0]), pos: posGroup(p[2]), d: g.d, season, team: t.t, opp: g.t[1 - i].t });
    }
  });
}
lines.sort((a, b) => a.d.localeCompare(b.d));
const seasons = [...new Set(lines.map((x) => x.season))].sort(), from = seasons[0], last5 = THROUGH - ODD.recent + 1;
const ERAS = [[1993, 1999], [2000, 2006], [2007, 2013], [2014, 2020], [2021, THROUGH]];
const T = {};
for (const t of TEMPLATES) for (const lv of t.levels) T[`${t.id}.${lv.k}`] = { what: lv.what, f: t.f, n: 0, l5: 0, era: ERAS.map(() => 0), last: [] };
for (const x of lines) {
  const s = sum.get(x.pk), mine = x.l.min > 0 ? 1 : 0, n = (s?.n || 0) - mine;
  const avg = n >= ODD.games ? { pts: (s.pts - mine * x.l.pts) / n, reb: (s.reb - mine * x.l.reb) / n, ast: (s.ast - mine * x.l.ast) / n } : null;
  for (const h of matchLine(x.l, { pos: x.pos, avg })) {
    const e = T[h.key]; e.n++; if (x.season >= last5) e.l5++;
    const ei = ERAS.findIndex(([a, b]) => x.season >= a && x.season <= b); if (ei >= 0) e.era[ei]++;
    e.last.unshift([x.name, x.d, x.team, h.say]); if (e.last.length > ODD.list) e.last.pop();   // newest first
  }
}
const tag = (y) => `${y}-${String(y + 1).slice(2)}`;
const out = { v: 1, from: tag(from), through: tag(THROUGH), seasons: seasons.length, recent: ODD.recent, eras: ERAS.map(([a, b]) => `${tag(a)} to ${tag(b)}`), eraSeasons: ERAS.map(([a, b]) => seasons.filter((y) => y >= a && y <= b).length),
  games, lines: lines.length, left: { noPlayerNumbers: zeroed, other: bad },
  source: "ESPN box scores (site.api.espn.com summary), regular season; only games where the players' points add up to the score. Averages: his other games that season, 10 or more. Position: ESPN's label for the player.",
  t: T };
fs.writeFileSync(OUT, JSON.stringify(out));
console.log({ games, zeroed, bad, later, lines: lines.length, seasons: seasons.length, levels: Object.keys(T).length, bytes: fs.statSync(OUT).size });
