// The history table for odd lines (0.117.0): every template level in src/situations/oddlines.js counted over the
// box scores in /home/claude/work/full (see fetch-full.mjs), with the same rules the site runs on this season.
//   node tools/odd-games/build-history.mjs [--dir /home/claude/work/full] [--out src/data/odd-lines-history.json] [--through 2025]
// Only games where the players' points add up to the team's score. Season = the year it started.
import fs from "node:fs"; import path from "node:path";
import { TEMPLATES, RUNS, RUN_MAX, STARTERS, NO_TOV_PF, TOV_PF, matchLine, runLengths, posGroup, ODD } from "../../src/situations/oddlines.js";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg("--dir", "/home/claude/work/full"), OUT = arg("--out", "src/data/odd-lines-history.json"), THROUGH = +arg("--through", "2025");
const POUT = arg("--players", OUT.replace(/history\.json$/, "players.json")), WINDOW = +arg("--window", "3");   // each player's counts over the last WINDOW seasons
const CUP = new Set(["2023-12-09", "2024-12-17", "2025-12-16"]);
const seasonOf = (d) => (+d.slice(5, 7) >= 8 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const K = ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "blk", "tov", "pf"]; // p[3..19]
const lines = [], sum = new Map(); let games = 0, zeroed = 0, bad = 0, later = 0, noStarters = 0; const seen = new Set();
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
    const known = t.p.filter((p) => p[3]).length === STARTERS; if (!known) noStarters++;   // ESPN lists no starters for some old games
    for (const p of t.p) {
      const l = {}; K.forEach((k, j) => { l[k] = p[3 + j] || 0; }); if (!known) l.starter = null;
      if (!(l.min > 0) && !(l.pts + l.reb + l.ast + l.stl + l.blk + l.tov + l.pf + l.fga + l.fta > 0)) continue;
      const pk = `${p[0]}|${season}`;
      if (l.min > 0) { const s = sum.get(pk) || { n: 0, pts: 0, reb: 0, ast: 0 }; s.n++; s.pts += l.pts; s.reb += l.reb; s.ast += l.ast; sum.set(pk, s); }
      lines.push({ l, pk, pid: String(p[0]), name: p[1] || String(p[0]), pos: posGroup(p[2]), d: g.d, season, team: t.t, opp: g.t[1 - i].t });
    }
  });
}
// 0.121.0, widened in 0.122.0: the Bulls' and Pelicans' games ESPN has no player numbers for, from pbpstats
// (tools/outside/pbpstats). A game goes in when ESPN's copy of it is the zeroed one (same teams, same date or a day either
// side), its score is ESPN's, and pbpstats' points add up to it.
// 0.122.0 (the user's five Basketball Reference box scores, 11/19: 102 players, every column pbpstats has the same): the
// lines are whole lines now. Each player takes his ESPN id, position and starter flag from ESPN's own (zeroed) box score
// for the game, by name, so his season average, his runs and the bench and position rules see these games too. pbpstats
// has no turnovers or fouls: they are 0 here, the turnover and foul rules cannot fire, and the two rules a missing
// turnover or foul could make true by mistake (NO_TOV_PF) are not counted for these lines.
const FILL_DIR = arg("--fill", "tools/outside/pbpstats"), ALIAS = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", PHO: "PHX", NOH: "NOP", NOK: "NOP" }, tri = (a) => ALIAS[a] || a;
const fill = { games: 0, lines: 0, named: 0, unnamed: 0, skippedEspnHasIt: 0, skippedNoMatch: 0, skippedPoints: 0 };
const norm = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?$/g, "").replace(/[^a-z]/g, "");
// names pbpstats and ESPN spell differently (tools/merge-pbpstats-logs.mjs has the same list)
const SAME = { juanhernangomez: "juanchohernangomez", marcelohuertas: "marcelinhohuertas", eneskanter: "enesfreedom", walterlemon: "waltlemon",
  // 0.122.0: the eight names left over on the first whole run, each read off ESPN's roster for one of his games
  erikmurphy: "erikjaymurphy", robbiehummel: "robbiejohnhummel", gustavoayon: "gustavoalfonsoayon", jeromejordan: "jeromeadolphusjordan", viacheslavkravtsov: "slavakravtsov", joshakognon: "joshemmanuelakognon", hamedhaddadi: "hamedehaddadi", gigidatome: "luigidatome" };
const unnamed = {};
// Turnovers and fouls for the filled games a box score has been read for (tools/outside/bref-screens/*.json: the user's
// Basketball Reference screenshots). A line with both is a whole line: every rule counts for it.
const SCREENS = "tools/outside/bref-screens", screen = new Map();
if (fs.existsSync(SCREENS)) for (const f of fs.readdirSync(SCREENS).filter((x) => x.endsWith(".json"))) for (const g of JSON.parse(fs.readFileSync(path.join(SCREENS, f), "utf8")).games || [])
  screen.set(`${g.d}|${[tri(g.h), tri(g.a)].sort().join("|")}`, Object.fromEntries(Object.entries(g.p).map(([name, v]) => [norm(name), { tov: v[13], pf: v[14], pts: v[15], reb: v[9] }])));
// 0.148.0: NBA.com's own box score for every one of the 972 filled games (tools/outside/nbacom, by tools/fetch-nbacom-box.mjs),
// so every filled line has its turnovers and fouls and every rule counts for it on the next run. Its points, shooting,
// rebounds, assists, steals and blocks matched pbpstats in 20,113 of 20,117 player lines (CHANGES 0.148.0).
const NBACOM = "tools/outside/nbacom";
if (fs.existsSync(NBACOM)) for (const f of fs.readdirSync(NBACOM).filter((x) => /^box-.*\.jsonl$/.test(x))) for (const row of fs.readFileSync(path.join(NBACOM, f), "utf8").split("\n").filter(Boolean)) {
  const g = JSON.parse(row), C = Object.fromEntries(g.cols.map((c, i) => [c, i + 5]));
  const k = `${g.d}|${[tri(g.h), tri(g.a)].sort().join("|")}`;
  if (screen.has(k)) continue;   // a Basketball-Reference screenshot read for the game comes first
  screen.set(k, Object.fromEntries(Object.values(g.p).flat().filter((p) => p[3]).map((p) => [norm(p[1]), { tov: p[C.tov], pf: p[C.pf], pts: p[C.pts], reb: p[C.reb] }])));
}
if (fs.existsSync(FILL_DIR)) {
  const zeroedAt = new Map(), whole = new Set();
  for (const f of fs.readdirSync(DIR)) {
    const g = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); if (g.t.length !== 2 || seasonOf(g.d) > THROUGH) continue;
    const k = `${g.d}|${g.t.map((t) => tri(t.t)).sort().join("|")}`;
    if (g.t.every((t) => t.p.every((p) => !p[5] && !p[14] && !p[15]))) zeroedAt.set(k, { score: g.t.map((t) => t.s).sort((a, b) => a - b).join("-"),
      who: Object.fromEntries(g.t.map((t) => [tri(t.t), { five: t.p.filter((p) => p[3]).length === STARTERS, by: Object.fromEntries(t.p.map((p) => [norm(p[1]), p])) }])) }); else whole.add(k);
  }
  const near = (d, k) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
  for (const f of fs.readdirSync(FILL_DIR).filter((x) => /^box-.*\.jsonl$/.test(x)).sort()) for (const row of fs.readFileSync(path.join(FILL_DIR, f), "utf8").split("\n").filter(Boolean)) {
    const g = JSON.parse(row), teams = [tri(g.h), tri(g.a)].sort().join("|"), keys = [0, -1, 1].map((k) => `${near(g.d, k)}|${teams}`);
    if (seasonOf(g.d) > THROUGH) continue;
    if (g.p.Home.reduce((a, p) => a + p[3], 0) !== g.hs || g.p.Away.reduce((a, p) => a + p[3], 0) !== g.as) { fill.skippedPoints++; continue; }
    const key = keys.find((k) => zeroedAt.has(k));
    if (!key) { if (keys.some((k) => whole.has(k))) fill.skippedEspnHasIt++; else fill.skippedNoMatch++; continue; }
    if (zeroedAt.get(key).score !== [g.hs, g.as].sort((a, b) => a - b).join("-")) { fill.skippedNoMatch++; continue; }
    fill.games++;
    const d = key.slice(0, 10), season = seasonOf(d);
    for (const [side, team, opp] of [["Home", g.h, g.a], ["Away", g.a, g.h]]) for (const p of g.p[side]) {
      // pbpstats row: id, name, "mm:ss", pts, reb, oreb, dreb, ast, stl, blk, fg3m, fg3a, fgm, fga, ftm, fta
      const [mm, ss] = String(p[2] || "0:00").split(":").map(Number);
      const l = { starter: null, min: Math.round((mm || 0) + (ss || 0) / 60), pts: p[3] || 0, reb: p[4] || 0, oreb: p[5] || 0, dreb: p[6] || 0, ast: p[7] || 0, stl: p[8] || 0, blk: p[9] || 0, fg3m: p[10] || 0, fg3a: p[11] || 0, fgm: p[12] || 0, fga: p[13] || 0, ftm: p[14] || 0, fta: p[15] || 0, tov: 0, pf: 0 };
      if (!(l.min > 0) && !(l.pts + l.reb + l.ast + l.stl + l.blk + l.fga + l.fta > 0)) continue;
      const W = zeroedAt.get(key).who[tri(team)], k = norm(p[1]), e = W && (W.by[k] || W.by[SAME[k]]);
      if (e) { fill.named++; l.starter = W.five ? (e[3] ? 1 : 0) : null; } else { fill.unnamed++; unnamed[p[1]] = (unnamed[p[1]] || 0) + 1; }
      const pk = `${e ? e[0] : `pbp:${p[0]}`}|${season}`;
      if (l.min > 0) { const sm = sum.get(pk) || { n: 0, pts: 0, reb: 0, ast: 0 }; sm.n++; sm.pts += l.pts; sm.reb += l.reb; sm.ast += l.ast; sum.set(pk, sm); }
      // his turnovers and fouls, where a box score has been read for this game (and only if its points and rebounds are his)
      const scr = keys.map((kk) => screen.get(kk)).find(Boolean) || {};   // the box score is filed under its own date; ESPN's can be a day off
      const sc = scr[k] || scr[SAME[k]] || Object.entries(scr).find(([kk]) => SAME[kk] === k)?.[1];
      const whole = !!sc && sc.pts === l.pts && sc.reb === l.reb; if (whole) { l.tov = sc.tov; l.pf = sc.pf; fill.withTovPf = (fill.withTovPf || 0) + 1; }
      fill.lines++; lines.push({ l, fill: !whole, filled: true, pk, pid: e ? String(e[0]) : `pbp:${p[0]}`, name: (e && e[1]) || p[1] || String(p[0]), pos: e ? posGroup(e[2]) : null, d, season, team, opp });
    }
  }
}
lines.sort((a, b) => a.d.localeCompare(b.d));
const seasons = [...new Set(lines.map((x) => x.season))].sort(), from = seasons[0], last5 = THROUGH - ODD.recent + 1;
const ERAS = [[1993, 1999], [2000, 2006], [2007, 2013], [2014, 2020], [2021, THROUGH]];
const T = {};
for (const t of TEMPLATES) for (const lv of t.levels) T[`${t.id}.${lv.k}`] = { what: lv.what, f: t.f, n: 0, l5: 0, era: ERAS.map(() => 0), last: [] };
const bySeason = new Map();   // pid|season -> his lines in date order, each with its context
const count = (h, x) => { const e = T[h.key]; e.n++; if (x.season >= last5) e.l5++; const ei = ERAS.findIndex(([a, b]) => x.season >= a && x.season <= b); if (ei >= 0) e.era[ei]++; e.last.unshift([x.name, x.d, x.team, h.say]); if (e.last.length > ODD.list) e.last.pop(); };
for (const x of lines) {
  const s = sum.get(x.pk), mine = x.l.min > 0 ? 1 : 0, n = (s?.n || 0) - mine;
  const avg = n >= ODD.games ? { pts: (s.pts - mine * x.l.pts) / n, reb: (s.reb - mine * x.l.reb) / n, ast: (s.ast - mine * x.l.ast) / n } : null;
  x.x = { pos: x.pos, avg }; if (!bySeason.has(x.pk)) bySeason.set(x.pk, []); bySeason.get(x.pk).push(x);
  for (const h of matchLine(x.l, { pos: x.pos, avg })) { if (x.fill && NO_TOV_PF.includes(h.id)) continue; count(h, x); if (x.filled) { T[h.key].filled = (T[h.key].filled || 0) + 1; if (process.env.SHOW_FILLED) console.error(h.key, "|", x.name, x.d, x.team, "|", h.say); } }   // `last` is newest first
}
// Runs and repeats (0.118.0): how often a run reached each length, with the function the site runs on this season.
const reach = () => Object.fromEntries(Array.from({ length: RUN_MAX - 1 }, (_, i) => [i + 2, { n: 0, l5: 0, last: null }]));
const runsT = Object.fromEntries(RUNS.map((r) => [r.id, reach()])), againT = {};
const firstP = THROUGH - WINDOW + 1, P = {}, leagueP = {};
for (const gs of [...bySeason.values()].sort((a, b) => a[0].d.localeCompare(b[0].d))) {
  const R = runLengths(gs), season = gs[0].season, name = gs[0].name;
  // the date of each game that extended a run: walk the season again beside the lengths
  const mark = (table, lens, dates) => lens.forEach((len, i) => { if (len < 2 || len > RUN_MAX) return; const e = table[len]; e.n++; if (season >= last5) e.l5++; if (!e.last || dates[i] >= e.last[1]) e.last = [name, dates[i]]; });
  for (const r of RUNS) if (R.runs[r.id]) mark(runsT[r.id], R.runs[r.id], gs.filter((g) => g.l.min >= 20 && r.test(g.l, g.x)).map((g) => g.d));
  const playedGs = gs.filter((g) => g.l.min > 0), hitDates = {};
  gs.forEach((g, i) => { for (const k of R.hits[i]) (hitDates[k] ??= []).push(g.d); });
  for (const [k, lens] of Object.entries(R.again)) mark((againT[k] ??= reach()), lens, hitDates[k]);
  if (season >= firstP) {
    const e = (P[gs[0].pid] ??= { g: 0, k: {} }); e.g += playedGs.length;
    for (const [k, ds] of Object.entries(hitDates)) { const c = (e.k[k] ??= [0, ""]); c[0] += ds.length; if (ds[ds.length - 1] > c[1]) c[1] = ds[ds.length - 1]; leagueP[k] = (leagueP[k] || 0) + ds.length; }
  }
}
for (const k of Object.keys(againT)) { for (const n of Object.keys(againT[k])) if (!againT[k][n].n) delete againT[k][n]; if (!Object.keys(againT[k]).length) delete againT[k]; }
for (const id of Object.keys(P)) if (!Object.keys(P[id].k).length) delete P[id];
const tag = (y) => `${y}-${String(y + 1).slice(2)}`;
const out = { v: 1, from: tag(from), through: tag(THROUGH), seasons: seasons.length, recent: ODD.recent, eras: ERAS.map(([a, b]) => `${tag(a)} to ${tag(b)}`), eraSeasons: ERAS.map(([a, b]) => seasons.filter((y) => y >= a && y <= b).length),
  games, lines: lines.filter((x) => !x.filled).length, left: { noPlayerNumbers: zeroed, other: bad }, noStarters,
  fill: { ...fill, source: "pbpstats (tools/outside/pbpstats): the Bulls' and Pelicans' games ESPN has no player numbers for; no turnovers or fouls", notCounted: TOV_PF, left: zeroed - fill.games + bad, checked: "five Basketball Reference box scores (tools/outside/bref-screens/box-2026-11-19.json): 102 players, every column the same" },
  source: "ESPN box scores (site.api.espn.com summary), regular season; only games where the players' points add up to the score. Averages: his other games that season, 10 or more. Position: ESPN's label for the player.",
  t: T, runMin: 20, runs: runsT, again: againT };
fs.writeFileSync(OUT, JSON.stringify(out));
fs.writeFileSync(POUT, JSON.stringify({ v: 1, since: tag(firstP), through: tag(THROUGH), seasons: WINDOW, note: "Each player's count of every odd-line level over these seasons (ESPN ids): p[id] = { g: games played, k: { level: [times, last date] } }; league[level] = everyone's.", league: leagueP, p: P }));
console.log({ games, zeroed, bad, later, noStarters, fill, unnamed: Object.entries(unnamed).sort((a, b) => b[1] - a[1]).slice(0, 12), lines: lines.length, seasons: seasons.length, levels: Object.keys(T).length, bytes: fs.statSync(OUT).size, players: Object.keys(P).length, playersBytes: fs.statSync(POUT).size });
