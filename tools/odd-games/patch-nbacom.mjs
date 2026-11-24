// The archive's games with no usable ESPN box score, written over from NBA.com's own box score (0.149.0; the user, 11/24:
// "I am comfortable getting the bulls pelicans lines from nba.com for closure").
// Reads tools/outside/nbacom/espn-map.json (which archive file is which NBA.com game) and the NBA.com box scores in
// tools/outside/nbacom/*.jsonl, and rewrites each mapped archive file (/home/claude/work/full/f-<espn id>.json) in the
// archive's own shape, with every column NBA.com has. Players take their ESPN id and position from ESPN's own box score of
// the game, else from his other games for that team that season, by name; anyone left gets "nba:<id>".
// Only a game whose NBA.com points add up to NBA.com's final for both teams is written. Run before build-history.mjs.
//   node tools/odd-games/patch-nbacom.mjs [--dir /home/claude/work/full]
import fs from "node:fs"; import path from "node:path";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const DIR = arg("--dir", "/home/claude/work/full"), NB = "tools/outside/nbacom";
const map = JSON.parse(fs.readFileSync(path.join(NB, "espn-map.json"), "utf8")).games;
const box = new Map();
for (const f of fs.readdirSync(NB).filter((x) => x.endsWith(".jsonl"))) for (const l of fs.readFileSync(path.join(NB, f), "utf8").trim().split("\n").filter(Boolean)) { const g = JSON.parse(l); box.set(g.id, g); }
const norm = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?$/g, "").replace(/[^a-z]/g, "");
const seasonOf = (d) => (+d.slice(5, 7) >= 8 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
// ESPN's team codes against NBA.com's (old and new)
const M = { PHI: ["PHL"], DEF: ["DET"], NO: ["NOP", "NOH", "NOK"], SA: ["SAS", "SAN"], NY: ["NYK"], GS: ["GSW", "GOS"], UTAH: ["UTA", "UTH"], WSH: ["WAS", "WSB"], NJ: ["NJN"], CHA: ["CHA", "CHH", "CHO"], PHO: ["PHX"], DEV: ["DEN"] };
// names NBA.com and ESPN spell differently (the pbpstats list in build-history.mjs, and those found here)
const ALIAS = { juanhernangomez: "juanchohernangomez", marcelohuertas: "marcelinhohuertas", eneskanter: "enesfreedom", walterlemon: "waltlemon",
  erikmurphy: "erikjaymurphy", robbiehummel: "robbiejohnhummel", gustavoayon: "gustavoalfonsoayon", jeromejordan: "jeromeadolphusjordan",
  viacheslavkravtsov: "slavakravtsov", joshakognon: "joshemmanuelakognon", nenehilario: "nene", mingyao: "yaoming", jianlianyi: "yijianlian",
  wangzhizhi: "wangzhizhi", lafayettelever: "fatlever", flipmurray: "ronaldmurray", hotrodwilliams: "johnwilliams" };
const same = (espn, nba) => espn === nba || (M[espn] || []).includes(nba);
// who is who: every archive player by season, ESPN team code and name
const files = fs.readdirSync(DIR), who = new Map(), goodAt = new Map(), codeCount = new Map();
for (const f of files) {
  const g = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  for (const t of g.t || []) codeCount.set(t.t, (codeCount.get(t.t) || 0) + 1);
  for (const t of g.t || []) for (const p of t.p || []) if (p[0]) who.set(`${seasonOf(g.d)}|${t.t}|${norm(p[1])}`, [String(p[0]), p[1], p[2]]);
  if (!g.src && (g.t || []).length === 2 && g.t.every((t) => t.s > 0 && t.p.length && t.p.reduce((a, p) => a + (p[5] || 0), 0) === t.s))
    goodAt.set(`${g.d}|${g.t.map((t) => t.s).sort((a, b) => a - b).join("-")}`, [...(goodAt.get(`${g.d}|${g.t.map((t) => t.s).sort((a, b) => a - b).join("-")}`) || []), g.t.map((t) => t.t)]);
}
const near = (d, k) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
// ESPN already has the game under other team codes (1993-94 DAL-"DEV", 1997-98 DEN-"DEF": a mistyped copy beside a good one)
// (the same score, a day either side, and the same two teams, except that a code seen in under 50 games is a mistyped one)
const goodElsewhere = (d, a, b, tris) => [0, -1, 1].some((k) => (goodAt.get(`${near(d, k)}|${[a, b].sort((x, y) => x - y).join("-")}`) || [])
  .some((codes) => codes.some((c) => tris.some((t) => same(c, t))) && codes.every((c) => tris.some((t) => same(c, t)) || (codeCount.get(c) || 0) < 50)));
const st = { written: 0, noBox: 0, notAdding: 0, teamMismatch: 0, players: 0, named: 0, unnamed: 0 };
const unnamed = {};
for (const m of map) {
  const g = box.get(m.nba); if (!g) { st.noBox++; continue; }
  const C = Object.fromEntries(g.cols.map((c, i) => [c, i + 5]));
  const sides = Object.entries(g.p);
  if (!sides.every(([tri, rows]) => rows.reduce((a, r) => a + (r[C.pts] || 0), 0) === (tri === g.h ? g.hs : tri === g.a ? g.as : NaN))) { st.notAdding++; continue; }
  const file = path.join(DIR, m.espn[0]), E = JSON.parse(fs.readFileSync(file, "utf8"));
  if (goodElsewhere(E.d, g.hs, g.as, Object.keys(g.p))) { st.alreadyGood = [...(st.alreadyGood || []), `${m.espn[0]} ${E.d} ${Object.keys(g.p).join("-")} ${g.hs}-${g.as}`]; continue; }
  const season = seasonOf(E.d), t = [];
  for (const et of E.t) {
    const side = sides.find(([tri]) => same(et.t, tri));
    if (!side) break;
    const [tri, rows] = side, byName = Object.fromEntries((et.p || []).map((p) => [norm(p[1]), p]));
    // starters: ESPN's flags when its own box marks five (NBA.com's older box scores can mark more than five)
    const espnFive = (et.p || []).filter((q) => q[3]).length === 5;
    const p = [];
    for (const r of rows) {
      if (!r[3]) continue;   // didn't play (no minutes listed)
      // Minutes as ESPN gives them in the same seasons: the nearest whole minute from 2012-13 on; before that ESPN never
      // shows a player who got in with 0 (none of its 400,000-odd lines from 1993-94 to 2011-12 has a stat in 0 minutes),
      // so a few seconds count as 1 there, or the "a stat in 0 minutes" counts would rise only in the filled games.
      const [mm, ss] = String(r[3]).split(":").map(Number), secs = (mm || 0) * 60 + (ss || 0);
      const min = season >= 2012 ? Math.round(secs / 60) : secs > 0 ? Math.max(1, Math.round(secs / 60)) : 0;
      const k = ALIAS[norm(r[1])] || norm(r[1]);
      let e = byName[k] ? [String(byName[k][0]), byName[k][1], byName[k][2]] : who.get(`${season}|${et.t}|${k}`);
      if (!e) {   // the one player on that team that season with his surname and first initial
        const sur = norm(String(r[1]).split(" ").slice(-1)[0]), ini = norm(r[1])[0];
        const c = [...who.entries()].filter(([kk]) => kk.startsWith(`${season}|${et.t}|`) && kk.endsWith(sur) && kk.split("|")[2][0] === ini);
        if (c.length === 1) e = c[0][1];
      }
      st.players++; if (e) st.named++; else { st.unnamed++; unnamed[r[1]] = (unnamed[r[1]] || 0) + 1; }
      const starter = espnFive && byName[k] ? (byName[k][3] ? 1 : 0) : r[2];
      p.push([e ? e[0] : `nba:${r[0]}`, e ? e[1] : r[1], e ? e[2] : null, starter, min, r[C.pts], r[C.fgm], r[C.fga], r[C.fg3m], r[C.fg3a], r[C.ftm], r[C.fta], r[C.oreb], r[C.dreb], r[C.reb], r[C.ast], r[C.stl], r[C.blk], r[C.tov], r[C.pf], r[C.pm]]);
    }
    t.push({ t: et.t, home: et.home, s: tri === g.h ? g.hs : g.as, p });
  }
  if (t.length !== 2) { st.teamMismatch++; st.mismatched = [...(st.mismatched || []), `${m.espn[0]} ${E.t.map((x) => x.t).join("/")} vs ${sides.map(([x]) => x).join("/")}`]; continue; }
  fs.writeFileSync(file, JSON.stringify({ d: E.d, t, src: `nba.com ${m.nba}` }));
  st.written++;
}
// Games ESPN's scoreboards don't list at all (espn-map.json "missing"): a new archive file each, f-nba-<id>.json, with
// ESPN's team codes. The NBA.com date is used (ESPN's would be the same for these, all evening games).
const ESPN_CODE = { NOP: "NO", NOH: "NO", NOK: "NO", SAS: "SA", SAN: "SA", NYK: "NY", GSW: "GS", GOS: "GS", UTA: "UTAH", UTH: "UTAH", WAS: "WSH", NJN: "NJ", CHH: "CHA", PHL: "PHI" };
for (const m of JSON.parse(fs.readFileSync(path.join(NB, "espn-map.json"), "utf8")).missing || []) {
  const g = box.get(m.nba); if (!g || !Object.keys(g.p).length) { st.noBox++; continue; }
  const C = Object.fromEntries(g.cols.map((c, i) => [c, i + 5])), season = seasonOf(g.d), t = [];
  for (const [tri, rows] of Object.entries(g.p)) {
    const code = ESPN_CODE[tri] || tri, p = [];
    for (const r of rows) {
      if (!r[3]) continue;
      const [mm, ss] = String(r[3]).split(":").map(Number), secs = (mm || 0) * 60 + (ss || 0);
      const min = season >= 2012 ? Math.round(secs / 60) : secs > 0 ? Math.max(1, Math.round(secs / 60)) : 0;
      const k = ALIAS[norm(r[1])] || norm(r[1]), e = who.get(`${season}|${code}|${k}`);
      st.players++; if (e) st.named++; else { st.unnamed++; unnamed[r[1]] = (unnamed[r[1]] || 0) + 1; }
      p.push([e ? e[0] : `nba:${r[0]}`, e ? e[1] : r[1], e ? e[2] : null, r[2], min, r[C.pts], r[C.fgm], r[C.fga], r[C.fg3m], r[C.fg3a], r[C.ftm], r[C.fta], r[C.oreb], r[C.dreb], r[C.reb], r[C.ast], r[C.stl], r[C.blk], r[C.tov], r[C.pf], r[C.pm]]);
    }
    const s = tri === g.h ? g.hs : g.as;
    if (p.reduce((a, r) => a + (r[5] || 0), 0) !== s) { st.notAdding++; t.length = 0; break; }
    t.push({ t: code, home: tri === g.h ? 1 : 0, s, p });
  }
  if (t.length !== 2) continue;
  fs.writeFileSync(path.join(DIR, `f-nba-${m.nba}.json`), JSON.stringify({ d: g.d, t, src: `nba.com ${m.nba}` }));
  st.added = (st.added || 0) + 1;
}
console.log(st, Object.entries(unnamed).sort((a, b) => b[1] - a[1]).slice(0, 15));
