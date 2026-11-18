// The sweep: every regular-season box score ESPN has (team totals from 1993-94) is read for a game that beats a mark a
// guide prints (src/data/team-game-records-2026-27.json, whole-game marks), or ties one on a night the guide does not print.
// A hit is a lead, not a correction: ESPN's old pages are wrong often enough (2007-08 rebounds, 2017-18 scrambled, one
// turnover number where the guides count another) that each one needs a second source before it goes in
// tools/team-records-verified.json. Where the other team's guide prints the same number for the same night, that is said.
//
//   NODE_USE_ENV_PROXY=1 node tools/sweep-team-marks.mjs --dir <saved ESPN box scores> --boards <saved ESPN scoreboards (check-period-points.mjs)> [--no-fetch] [--out file.json]
import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib"; import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), D = (f) => path.join(root, "src", "data", f);
const js = (f) => JSON.parse(fs.readFileSync(f, "utf8")), gz = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(D(f))));
const args = process.argv.slice(2), arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null), dir = arg("--dir"), boards = arg("--boards"), noFetch = args.includes("--no-fetch"), outFile = arg("--out");
const R = js(D("team-game-records-2026-27.json")).teams;
const ALIAS = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", VAN: "MEM", SEA: "OKC", NJ: "BKN", NOK: "NOP", NOH: "NOP", PHO: "PHX", CHH: "CHA" }, tri = (a) => ALIAS[a] || a;
const store = {};
for (const f of [js(D("nba-results-history.json")), gz("nba-results-older.json.gz")]) for (const g of f.games) { if (g[5] != null && g[5] !== 2) continue; (store[g[0].slice(0, 10)] ||= []).push({ home: g[1], away: g[2], hs: g[3], as: g[4] }); }
const dates = Object.keys(store).sort();
const H = { headers: { "User-Agent": "Mozilla/5.0 nba-command-center" } };
// the games, with ESPN's event id from the saved scoreboards
const todo = [], miss = { board: 0, event: 0, box: 0 };
for (const d of dates) { const f = path.join(boards, "ls-" + d + ".json"); if (!fs.existsSync(f)) { miss.board++; continue; } const sb = js(f);
  for (const g of store[d]) { const evs = sb.events.filter((e) => tri(e.c.find((c) => c.ha === "home")?.a) === g.home && tri(e.c.find((c) => c.ha === "away")?.a) === g.away && e.c.find((c) => c.ha === "home")?.s === g.hs);
    const ev = evs.find((e) => e.c.every((c) => c.ls.length >= 4)) || evs[0]; if (!ev) { miss.event++; continue; } todo.push({ ...g, date: d, id: ev.id }); } }
async function box(id) {
  const f = path.join(dir, "g-" + id + ".json");
  if (fs.existsSync(f)) return js(f);
  if (noFetch) return null;
  for (let k = 0; k < 4; k++) { try { const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`, H); if (!r.ok) throw new Error(r.status); const j = await r.json();
      const keep = { c: (j.header?.competitions?.[0]?.competitors || []).map((c) => ({ ha: c.homeAway, id: c.team?.id ?? c.id, s: Number(c.score) })), t: (j.boxscore?.teams || []).map((x) => ({ id: x.team?.id, ha: x.homeAway, st: Object.fromEntries((x.statistics || []).map((q) => [q.name, q.displayValue])) })) };
      fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(keep)); return keep; } catch (e) { await new Promise((r2) => setTimeout(r2, 900 * (k + 1))); } }
  return null;
}
const num = (v) => (v == null || v === "" ? null : Number(v)), pair = (v, i) => (v ? num(String(v).split("-")[i]) : null);
// every reading ESPN gives for a stat: a hit must hold for all of them (rebounds with and without team rebounds, three turnover numbers)
function readings(st, stat) {
  const o = num(st.offensiveRebounds), d = num(st.defensiveRebounds), tot = num(st.totalRebounds);
  return { fgm: [pair(st["fieldGoalsMade-fieldGoalsAttempted"], 0)], fga: [pair(st["fieldGoalsMade-fieldGoalsAttempted"], 1)], fg3m: [pair(st["threePointFieldGoalsMade-threePointFieldGoalsAttempted"], 0)], fg3a: [pair(st["threePointFieldGoalsMade-threePointFieldGoalsAttempted"], 1)],
    ftm: [pair(st["freeThrowsMade-freeThrowsAttempted"], 0)], fta: [pair(st["freeThrowsMade-freeThrowsAttempted"], 1)], oreb: [o], dreb: [d], reb: [o != null && d != null ? o + d : null, tot], ast: [num(st.assists)], stl: [num(st.steals)], blk: [num(st.blocks)],
    tov: [num(st.totalTurnovers), num(st.turnovers) || null, num(st.totalTurnovers) != null && num(st.teamTurnovers) != null && num(st.turnovers) ? num(st.totalTurnovers) - num(st.teamTurnovers) : null], pf: [num(st.fouls)] }[stat]?.filter((x) => x != null) || [];
}
// a whole box score: shots, fouls and assists are there, and the made shots give the final score
function whole(st, pts) {
  const fgm = pair(st["fieldGoalsMade-fieldGoalsAttempted"], 0), fga = pair(st["fieldGoalsMade-fieldGoalsAttempted"], 1), tpm = pair(st["threePointFieldGoalsMade-threePointFieldGoalsAttempted"], 0), ftm = pair(st["freeThrowsMade-freeThrowsAttempted"], 0);
  return fga >= 40 && num(st.fouls) > 0 && num(st.assists) > 0 && fgm != null && tpm != null && ftm != null && 2 * fgm + tpm + ftm === pts;
}
const G = []; let next = 0, notWhole = 0;
async function worker() { while (next < todo.length) { const g = todo[next++]; const b = await box(g.id);
    if (!b || !b.t?.length) { miss.box++; continue; }
    const h = b.t.find((x) => x.ha === "home"), a = b.t.find((x) => x.ha === "away");
    if (!h || !a || !whole(h.st, g.hs) || !whole(a.st, g.as)) { notWhole++; continue; }
    G.push({ t: g.home, opp: g.away, home: true, date: g.date, st: h.st, ost: a.st, pts: g.hs, opts: g.as }, { t: g.away, opp: g.home, home: false, date: g.date, st: a.st, ost: h.st, pts: g.as, opts: g.hs });
    if (next % 2000 === 0) process.stderr.write(`  ${next} of ${todo.length} games\n`); } }
await Promise.all(Array.from({ length: noFetch ? 1 : 8 }, worker));
const shift = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const FROM = { OKC: "2008-10-01" }, SHAKY = (d, stat) => (d >= "2007-10-01" && d <= "2008-06-30" && ["reb", "oreb", "dreb"].includes(stat)) || (d >= "2017-10-01" && d <= "2018-06-30");
const marks = []; for (const [t, ms] of Object.entries(R)) for (const m of ms) if (m.period === "game") marks.push({ t, ...m, side: m.side || "team" });
const find = (t, side, stat, kind) => marks.find((m) => m.t === t && m.side === side && m.stat === stat && m.kind === kind);
const beats = [], ties = [];
for (const m of marks) {
  const printed = new Set(m.games.flatMap((g) => (g.date ? [g.date, shift(g.date, -1), shift(g.date, 1)] : [])));
  for (const g of G) { if (g.t !== m.t || g.date < (FROM[m.t] || "")) continue;
    const vs = m.stat === "pts" ? [m.side === "team" ? g.pts : g.opts] : readings(m.side === "team" ? g.st : g.ost, m.stat); if (!vs.length) continue;
    const beat = vs.every((v) => (m.kind === "most" ? v > m.value : v < m.value)), tie = !beat && vs.every((v) => v === m.value) && !printed.has(g.date);
    if (!beat && !tie) continue;
    // the other team's guide, the same night
    const o = find(g.opp, m.side === "team" ? "opp" : "team", m.stat, m.kind), mirror = o && o.games.some((x) => x.date === g.date) ? o.value : null;
    const row = { t: m.t, side: m.side, stat: m.stat, kind: m.kind, printed: m.value, got: vs, date: g.date, opp: g.opp, home: g.home, shaky: SHAKY(g.date, m.stat), mirror, listed: m.games.length, times: m.times || null };
    (beat ? beats : ties).push(row); }
}
const say = (r) => `${r.t} ${r.side === "opp" ? "opp " : ""}${r.kind} ${r.stat}: printed ${r.printed}, ${r.got.join("/")} on ${r.date} ${r.home ? "v" : "at"} ${r.opp}${r.mirror != null ? ` [the ${r.opp} guide prints ${r.mirror} that night]` : ""}${r.shaky ? " [a season ESPN's numbers are unreliable for]" : ""}`;
console.log(`${marks.length} whole-game marks; ${todo.length} games since 1993-94 (${miss.board} days with no saved scoreboard, ${miss.event} games not on it), ${G.length / 2} whole box scores read (${miss.box} no page, ${notWhole} not whole)`);
console.log(`${beats.length} box scores beat a printed mark (${beats.filter((r) => r.shaky).length} in an unreliable season, ${beats.filter((r) => r.mirror != null).length} with the other guide printing that night); ${ties.length} tie one on a night the guide does not print`);
for (const r of beats.sort((a, b) => (a.t + a.side + a.stat + a.kind + a.date < b.t + b.side + b.stat + b.kind + b.date ? -1 : 1))) console.log("  " + say(r));
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ beats, ties, miss, notWhole }, null, 1));
