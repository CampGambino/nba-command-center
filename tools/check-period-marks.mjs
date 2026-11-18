// A second source for the half, quarter and overtime marks that are not points (rebounds in a quarter, threes in a half...):
// ESPN's play-by-play, counted by period. No box score goes below a whole game, so this is the only check these marks have.
//
// The count is trusted for a game and a stat only when the plays add up to that game's own box score total for the stat
// (ESPN's old play-by-play drops plays). Then: the printed number is one of that team's halves, quarters or overtimes.
//
//   NODE_USE_ENV_PROXY=1 node tools/check-period-marks.mjs --dir <folder for saved counts> --boards <saved ESPN scoreboards (check-period-points.mjs)> [--no-fetch] [--out file.json]
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), D = (f) => path.join(root, "src", "data", f);
const js = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const args = process.argv.slice(2), arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null), dir = arg("--dir"), boards = arg("--boards"), noFetch = args.includes("--no-fetch"), outFile = arg("--out");
const R = js(D("team-game-records-2026-27.json")).teams;
const ALIAS = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", VAN: "MEM", SEA: "OKC", NJ: "BKN", NOK: "NOP", NOH: "NOP", PHO: "PHX", CHH: "CHA" }, tri = (a) => ALIAS[a] || a;
const H = { headers: { "User-Agent": "Mozilla/5.0 nba-command-center" } };
const STATS = ["fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf"];
// --rows file.json: check these rows instead ({ t, side, stat, kind, period, value, date }): a lead's likely nights, from check-mark-nights.py
const rows = arg("--rows") ? js(arg("--rows")) : [];
if (!arg("--rows")) for (const [t, ms] of Object.entries(R)) for (const m of ms) if (m.period !== "game" && m.stat !== "pts") for (const g of m.games) if (g.date)
  rows.push({ t, side: m.side || "team", stat: m.stat, kind: m.kind, period: m.period, value: m.value, date: g.date, text: g.opp });
// the event: the team's game that day on the saved scoreboard
function event(t, d) {
  const f = path.join(boards, "ls-" + d + ".json"); if (!fs.existsSync(f)) return null;
  const evs = js(f).events.filter((e) => e.type === 2 && e.c.some((c) => tri(c.a) === t));
  const ev = evs.find((e) => e.c.every((c) => c.ls.length >= 4)) || evs[0]; if (!ev) return null;
  return { id: ev.id, home: tri(ev.c.find((c) => c.ha === "home").a) === t };
}
const num = (v) => (v == null || v === "" ? null : Number(v)), pair = (v, i) => (v && String(v).includes("-") ? num(String(v).split("-")[i]) : null);
function count(j) {
  const comp = j.header?.competitions?.[0]?.competitors || [], side = Object.fromEntries(comp.map((c) => [String(c.team?.id ?? c.id), c.homeAway])), other = { home: "away", away: "home" };
  const per = {}, add = (p, s, k, n = 1) => { if (!s) return; (((per[p] ||= { home: {}, away: {} })[s])[k] = ((per[p][s][k]) || 0) + n); };
  for (const x of j.plays || []) {
    const p = x.period?.number, s = side[String(x.team?.id)], ty = (x.type?.text || "").replace(/\s+/g, " "), tx = (x.text || "").replace(/\s+/g, " "); if (!p || !s) continue;
    const ft = /^Free Throw/i.test(ty);
    if (ft) { add(p, s, "fta"); if (x.scoringPlay) add(p, s, "ftm"); continue; }
    if (x.shootingPlay) { const three = x.pointsAttempted === 3 || x.scoreValue === 3 || /three point|3-point|three-point/i.test(tx);
      add(p, s, "fga"); if (three) add(p, s, "fg3a"); if (x.scoringPlay) { add(p, s, "fgm"); if (three) add(p, s, "fg3m"); if (/assists\)|Assisted by/i.test(tx)) add(p, s, "ast"); }
      if (/\bblocks\b|Blocked by/i.test(tx)) add(p, other[s], "blk"); continue; }
    if (/Rebound/i.test(ty)) { if (/\bteam\b/i.test(tx) || !/\S/.test(tx)) continue; add(p, s, /Offensive/i.test(ty) ? "oreb" : "dreb"); continue; }
    if (/Turnover|^Traveling$|^Travel/i.test(ty)) { add(p, s, "tov"); if (/steals\)|Stolen by/i.test(tx)) add(p, other[s], "stl"); if (/Offensive Foul Turnover/i.test(ty)) continue; }
    if (/Foul|^Offensive Charge$/i.test(ty) && !/Technical|Turnover/i.test(ty)) add(p, s, "pf");
  }
  const box = Object.fromEntries((j.boxscore?.teams || []).map((x) => { const st = Object.fromEntries((x.statistics || []).map((q) => [q.name, q.displayValue]));
    return [x.homeAway, { fgm: pair(st["fieldGoalsMade-fieldGoalsAttempted"], 0), fga: pair(st["fieldGoalsMade-fieldGoalsAttempted"], 1), fg3m: pair(st["threePointFieldGoalsMade-threePointFieldGoalsAttempted"], 0), fg3a: pair(st["threePointFieldGoalsMade-threePointFieldGoalsAttempted"], 1),
      ftm: pair(st["freeThrowsMade-freeThrowsAttempted"], 0), fta: pair(st["freeThrowsMade-freeThrowsAttempted"], 1), oreb: num(st.offensiveRebounds), dreb: num(st.defensiveRebounds), ast: num(st.assists), stl: num(st.steals), blk: num(st.blocks),
      tov: [num(st.turnovers), num(st.totalTurnovers)].filter((v) => v != null && v > 0), pf: num(st.fouls) }]; }));
  return { plays: (j.plays || []).length, per, box };
}
async function counts(id) {
  const f = path.join(dir, "p-" + id + ".json");
  if (fs.existsSync(f)) return js(f);
  if (noFetch) return null;
  for (let k = 0; k < 4; k++) { try { const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`, H); if (!r.ok) throw new Error(r.status);
      const keep = count(await r.json()); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(keep)); return keep; } catch (e) { await new Promise((r2) => setTimeout(r2, 900 * (k + 1))); } }
  return null;
}
// --sweep: every regular-season game since 2002-03 (the play-by-play years), not only the printed ones. For each mark it lists the
// periods that beat it, and for each printed game the plays disagree with, the nights the number does occur (the likely slip).
if (args.includes("--sweep")) {
  const get2 = (o, k) => (k === "reb" ? (o?.oreb || 0) + (o?.dreb || 0) : o?.[k] || 0), G = [], files = fs.readdirSync(boards).filter((f) => /^ls-\d{4}-\d\d-\d\d\.json$/.test(f) && f.slice(3, 13) >= "2002-10-01").sort();
  const todo = []; for (const f of files) for (const e of js(path.join(boards, f)).events) if (e.type === 2 && e.c.length === 2 && e.c.every((c) => c.ls.length >= 4 && c.a)) todo.push({ id: e.id, date: f.slice(3, 13), home: tri(e.c.find((c) => c.ha === "home").a), away: tri(e.c.find((c) => c.ha === "away").a) });
  let k = 0, none = 0;
  await Promise.all(Array.from({ length: noFetch ? 1 : 8 }, async () => { while (k < todo.length) { const g = todo[k++]; const c = await counts(g.id); if (!c || c.plays < 200) { none++; continue; } G.push({ ...g, c }); if (k % 2000 === 0) process.stderr.write(`  ${k} of ${todo.length} games\n`); } }));
  const marks = []; for (const [t, ms] of Object.entries(R)) for (const m of ms) if (m.period !== "game" && m.stat !== "pts") marks.push({ t, ...m, side: m.side || "team" });
  const shift = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10), FROM = { OKC: "2008-10-01" }, beats = [], where = {};
  const open = new Set((arg("--leads") ? js(arg("--leads")) : []).map((r) => [r.t, r.side, r.stat, r.kind, r.period].join("|")));
  for (const m of marks) { const key = [m.t, m.side, m.stat, m.kind, m.period].join("|"), printed = new Set(m.games.flatMap((g) => (g.date ? [g.date] : [])));
    for (const g of G) { if ((g.home !== m.t && g.away !== m.t) || g.date < (FROM[m.t] || "")) continue;
      const me = (m.side === "team") === (g.home === m.t) ? "home" : "away", ps = Object.keys(g.c.per).map(Number).sort((a, b) => a - b), q = (p) => get2(g.c.per[p]?.[me], m.stat);
      const total = ps.reduce((n, p) => n + q(p), 0), b = g.c.box?.[me], want = m.stat === "reb" ? (b?.oreb != null && b?.dreb != null ? [b.oreb + b.dreb] : []) : [].concat(b?.[m.stat] ?? []);
      if (!want.length || !want.includes(total)) continue;
      const parts = m.period === "quarter" ? [1, 2, 3, 4].map(q) : m.period === "half" ? [q(1) + q(2), q(3) + q(4)] : ps.filter((p) => p > 4).map(q);
      const opp = g.home === m.t ? g.away : g.home, row = { t: m.t, side: m.side, stat: m.stat, kind: m.kind, period: m.period, printed: m.value, date: g.date, opp, home: g.home === m.t, parts };
      if (parts.some((v) => (m.kind === "most" ? v > m.value : v < m.value))) beats.push(row);
      else if (open.has(key) && parts.includes(m.value) && !printed.has(g.date)) (where[key] ||= []).push(row); } }
  const say2 = (r) => `${r.t} ${r.side === "opp" ? "opp " : ""}${r.kind} ${r.stat} in a ${r.period}: printed ${r.printed}; ${r.date} ${r.home ? "v" : "at"} ${r.opp}: ${r.parts.join(", ")}`;
  console.log(`${todo.length} games since 2002-03, ${G.length} with play-by-play (${none} without); ${marks.length} period marks that are not points`);
  const fewest0 = beats.filter((r) => r.kind === "fewest"), most = beats.filter((r) => r.kind === "most");
  console.log(`periods that beat a printed mark, where the plays add up to the box score: ${most.length} for a "most", ${fewest0.length} for a "fewest"`);
  for (const r of most.sort((a, b) => (a.t + a.stat + a.period + a.date < b.t + b.stat + b.period + b.date ? -1 : 1))) console.log("  MOST: " + say2(r));
  const byMark = {}; for (const r of fewest0) (byMark[[r.t, r.side, r.stat, r.period, r.printed].join(" ")] ||= []).push(r);
  for (const [k2, v] of Object.entries(byMark).sort()) console.log(`  FEWEST: ${k2}: ${v.length} games, e.g. ${v.slice(-3).map((r) => `${r.date} ${r.home ? "v" : "at"} ${r.opp} (${r.parts.join(",")})`).join("; ")}`);
  for (const [k2, v] of Object.entries(where)) console.log(`  WHERE ${k2}: ${v.length} nights have the number: ${v.slice(0, 12).map((r) => `${r.date} ${r.home ? "v" : "at"} ${r.opp}`).join("; ")}`);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ beats, where }, null, 0));
  process.exit(0);
}
const get = (o, k) => (k === "reb" ? (o?.oreb || 0) + (o?.dreb || 0) : o?.[k] || 0);
let next = 0; const res = { same: [], differs: [], untrusted: [], noPlays: [], noEvent: [], before: 0 };
async function worker() { while (next < rows.length) { const r = rows[next++];
    if (r.date < "1996-10-01") { res.before++; continue; }
    const ev = event(r.t, r.date); if (!ev) { res.noEvent.push(r); continue; }
    const c = await counts(ev.id); if (!c || c.plays < 200) { res.noPlays.push(r); continue; }
    const me = (r.side === "team") === ev.home ? "home" : "away", ps = Object.keys(c.per).map(Number).sort((a, b) => a - b), q = (p) => get(c.per[p]?.[me], r.stat);
    // do the plays add up to the box score for this stat?
    const total = ps.reduce((n, p) => n + q(p), 0), b = c.box?.[me], want = r.stat === "reb" ? (b?.oreb != null && b?.dreb != null ? [b.oreb + b.dreb] : []) : [].concat(b?.[r.stat] ?? []);
    r.total = total; r.box = want;
    const parts = r.period === "quarter" ? [1, 2, 3, 4].map(q) : r.period === "half" ? [q(1) + q(2), q(3) + q(4)] : (() => { const o = ps.filter((p) => p > 4).map(q); return o.length > 1 ? [...o, o.reduce((x, y) => x + y, 0)] : o; })();
    r.parts = parts;
    if (!want.length || !want.includes(total)) { (parts.includes(r.value) ? res.untrusted : res.untrusted).push({ ...r, hit: parts.includes(r.value) }); continue; }
    (parts.includes(r.value) ? res.same : res.differs).push(r); } }
await Promise.all(Array.from({ length: noFetch ? 1 : 8 }, worker));
const say = (r) => `${r.t} ${r.side === "opp" ? "opp " : ""}${r.kind} ${r.stat} in a ${r.period}: ${r.value} "${r.text}" ${r.date}`;
console.log(`${rows.length} printed games beside half, quarter and overtime marks that are not points`);
console.log(`  play-by-play adds up to the box score and has the number: ${res.same.length}`);
console.log(`  adds up and does NOT have the number: ${res.differs.length}`);
console.log(`  does not add up to the box score for that stat (no verdict): ${res.untrusted.length}, of which the number is there anyway: ${res.untrusted.filter((r) => r.hit).length}`);
console.log(`  no play-by-play: ${res.noPlays.length}; no game on the saved scoreboard that day: ${res.noEvent.length}; before 1996-97: ${res.before}`);
for (const r of res.differs.sort((a, b) => (a.t + a.date < b.t + b.date ? -1 : 1))) console.log(`    DIFFERS: ${say(r)} | ${r.period}s ${r.parts.join(", ")} (game ${r.total})`);
for (const r of res.noEvent) console.log(`    no game: ${say(r)}`);
if (arg("--rows")) for (const [k, v] of Object.entries(res)) if (Array.isArray(v)) for (const r of v) console.log(`    ${k === "same" ? "HAS IT" : k}: ${say(r)}${r.parts ? ` | ${r.period}s ${r.parts.join(", ")} (game ${r.total}; box ${r.box})` : ""}`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify(res, null, 1));
