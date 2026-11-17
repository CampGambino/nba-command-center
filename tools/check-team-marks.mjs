// A second source for the team single-game marks the guides print (src/data/team-game-records-2026-27.json), game marks only
// (a box score has no halves or quarters):
//   1. the date is a game that team played (our results: ESPN from 1993-94, the guides' game lists before);
//   2. where two guides print the same night (one team's most, the other's "most by an opponent"), they agree;
//   3. ESPN's box score for that game has the same number (team totals exist from 1993-94).
//
//   NODE_USE_ENV_PROXY=1 node tools/check-team-marks.mjs --dir <folder for saved ESPN pages> [--no-fetch] [--out file.json]
import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib"; import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), D = (f) => path.join(root, "src", "data", f);
const js = (f) => JSON.parse(fs.readFileSync(f, "utf8")), gz = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(D(f))));
const args = process.argv.slice(2), arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null), dir = arg("--dir"), noFetch = args.includes("--no-fetch"), outFile = arg("--out");
const R = js(D("team-game-records-2026-27.json")).teams;
// every game we know: team -> date -> [{ opp, home, pf, pa, src }]
const games = {}; const put = (t, d, g) => (((games[t] ||= {})[d] ||= []).push(g));
for (const [f, src] of [[js(D("nba-results-history.json")), "espn"], [gz("nba-results-older.json.gz"), "espn"]])
  for (const g of f.games) { if (g[5] != null && g[5] !== 2) continue; const d = g[0].slice(0, 10); put(g[1], d, { opp: g[2], home: true, pf: g[3], pa: g[4], src }); put(g[2], d, { opp: g[1], home: false, pf: g[4], pa: g[3], src }); }
const GG = gz("guide-games-2026-27.json.gz").teams;
for (const [t, gs] of Object.entries(GG)) for (const g of gs) if (!(games[t]?.[g[0]] || []).some((x) => x.src === "espn")) put(t, g[0], { opp: g[2], home: g[3] === "H", pf: g[5], pa: g[6], src: "guide" });
// a team with no list of its own for that year is still in its opponents' lists
for (const [t, gs] of Object.entries(GG)) for (const g of gs) if (g[2] && !(games[g[2]]?.[g[0]] || []).some((x) => x.opp === t)) put(g[2], g[0], { opp: t, home: g[3] === "A", pf: g[6], pa: g[5], src: "guide" });
const shift = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
// 1. the marks, one row a printed game
const rows = [];
for (const [t, ms] of Object.entries(R)) for (const m of ms) if (m.period === "game") for (const g of m.games)
  rows.push({ t, side: m.side || "team", stat: m.stat, kind: m.kind, value: m.value, date: g.date, text: g.opp, n: m.games.length });
const noGame = [];
for (const r of rows) {
  const g = games[r.t]?.[r.date];
  if (g) { r.g = g[0]; continue; }
  const near = [-1, 1].map((n) => [shift(r.date, n), games[r.t]?.[shift(r.date, n)]]).find((x) => x[1]);
  if (near && r.date >= "1993-10-01") { r.g = near[1][0]; r.moved = near[0]; } else if (near) { r.old = true; } else if (r.date >= "1993-10-01" || Object.keys(GG[r.t] ? games[r.t] : {}).some((d) => d.slice(0, 4) === r.date.slice(0, 4) && games[r.t][d].some((x) => x.src === "guide" && GG[r.t].some((q) => q[0] === d)))) noGame.push(r);
}
// 2. two guides, one night: A's own mark at B is B's "by an opponent" mark, and the other way round
const key = (r) => (r.side === "team" ? [r.t, r.g?.opp] : [r.g?.opp, r.t]).join(">") + "|" + (r.moved || r.date) + "|" + r.stat;      // who did it > to whom
const byKey = {}; for (const r of rows) if (r.g) (byKey[key(r)] ||= []).push(r);
let mirrored = 0, mirrorOff = [];
// a night neither team's game list reaches: paired by date and stat alone (one team's own mark, another team's "by an opponent")
for (const r of rows) if (!r.g) (byKey["?|" + r.date + "|" + r.stat + "|" + r.kind] ||= []).push(r);
for (const list of Object.values(byKey)) { const a = list.find((r) => r.side === "team"), b = list.find((r) => r.side === "opp" && r.t !== a?.t); if (!a || !b) continue;
  if (a.value === b.value) { mirrored++; a.mirror = b.mirror = true; } else mirrorOff.push([a, b]); }
// 3. ESPN
const H = { headers: { "User-Agent": "Mozilla/5.0 nba-command-center" } };
async function page(name, url) {
  const f = dir && path.join(dir, name + ".json");
  if (f && fs.existsSync(f)) return js(f);
  if (noFetch) return null;
  for (let k = 0; k < 3; k++) { try { const r = await fetch(url, H); if (!r.ok) throw new Error(r.status); const j = await r.json();
      const keep = name.startsWith("sb-") ? { events: (j.events || []).map((e) => ({ id: e.id, c: e.competitions[0].competitors.map((c) => ({ ha: c.homeAway, s: Number(c.score), a: c.team.abbreviation })) })) }
        : { c: (j.header?.competitions?.[0]?.competitors || []).map((c) => ({ ha: c.homeAway, id: c.team?.id ?? c.id, s: Number(c.score) })), t: (j.boxscore?.teams || []).map((x) => ({ id: x.team?.id, ha: x.homeAway, st: Object.fromEntries((x.statistics || []).map((q) => [q.name, q.displayValue])) })) };
      if (f) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(keep)); }
      await new Promise((r2) => setTimeout(r2, 120)); return keep; } catch (e) { await new Promise((r2) => setTimeout(r2, 800 * (k + 1))); } }
  return null;
}
const num = (v) => (v == null || v === "" ? null : Number(v)), pair = (v, i) => (v ? num(String(v).split("-")[i]) : null);
function statOf(st, stat) {
  const o = num(st.offensiveRebounds), d = num(st.defensiveRebounds), tot = num(st.totalRebounds);
  return { fgm: [pair(st["fieldGoalsMade-fieldGoalsAttempted"], 0)], fga: [pair(st["fieldGoalsMade-fieldGoalsAttempted"], 1)], fg3m: [pair(st["threePointFieldGoalsMade-threePointFieldGoalsAttempted"], 0)], fg3a: [pair(st["threePointFieldGoalsMade-threePointFieldGoalsAttempted"], 1)],
    ftm: [pair(st["freeThrowsMade-freeThrowsAttempted"], 0)], fta: [pair(st["freeThrowsMade-freeThrowsAttempted"], 1)], oreb: [o], dreb: [d], reb: [o != null && d != null ? o + d : null, tot], ast: [num(st.assists)], stl: [num(st.steals)], blk: [num(st.blocks)],
    tov: [num(st.totalTurnovers), num(st.turnovers), num(st.totalTurnovers) != null && num(st.teamTurnovers) != null ? num(st.totalTurnovers) - num(st.teamTurnovers) : null], pf: [num(st.fouls)] }[stat]?.filter((x) => x != null) || [];
}
const todo = rows.filter((r) => r.g && r.g.src === "espn" && r.stat !== "pts");
let done = 0;
async function check(r) {
  const d = r.moved || r.date, g = r.g, hs = g.home ? g.pf : g.pa, as = g.home ? g.pa : g.pf;
  let ev = null;
  for (const dd of [d, shift(d, -1), shift(d, 1)]) { const sb = await page("sb-" + dd, `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dd.replace(/-/g, "")}`);
    ev = sb?.events.find((e) => e.c.find((c) => c.ha === "home")?.s === hs && e.c.find((c) => c.ha === "away")?.s === as); if (ev) break; }
  if (!ev) { r.espn = "no event"; return; }
  const s = await page("g-" + ev.id, `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${ev.id}`);
  const mine = (r.side === "team") === g.home ? "home" : "away";          // whose numbers the mark is about
  const id = s?.c.find((c) => c.ha === mine)?.id, tm = s?.t.find((x) => (x.ha ? x.ha === mine : String(x.id) === String(id)));
  // ESPN's 2017-18 pages carry scrambled totals (no fouls, 22 blocks): a page where either team has no fouls or no assists is not used
  const broken = (s?.t || []).some((x) => num(x.st.fouls) === 0 || num(x.st.assists) === 0 || x.st.fouls == null);
  const vals = tm && !broken ? statOf(tm.st, r.stat) : [];
  if (!vals.length) { r.espn = "no totals"; return; }
  r.espnVals = vals; r.event = ev.id;
  // Older pages give one turnover number with team turnovers (shot-clock violations and the like) in it, which the guides leave out
  const lumped = r.stat === "tov" && !(num(tm.st.turnovers) > 0), over = vals[0] - r.value;
  r.espn = vals.includes(r.value) ? "same" : lumped && over > 0 && over <= 2 ? "team turnovers" : "differs";
  if (++done % 100 === 0) process.stderr.write(`  ${done} box scores read\n`);
}
const queue = todo.slice(); await Promise.all(Array.from({ length: 5 }, async () => { while (queue.length) await check(queue.shift()); }));
// report
const cnt = (f) => rows.filter(f).length, non = rows.filter((r) => r.stat !== "pts");
console.log(`${rows.length} printed games behind ${Object.values(R).flat().filter((m) => m.period === "game").length} game marks (${non.length} are not points)`);
console.log(`1. date is a game the team played: ${cnt((r) => r.g && !r.moved)}; a day off: ${cnt((r) => r.moved)}; no game found: ${noGame.length}; older than our games, or in a gap of them: ${cnt((r) => !r.g) - noGame.length}`);
for (const r of rows.filter((x) => x.moved)) console.log(`   a day off: ${r.t} ${r.side} ${r.kind} ${r.stat} ${r.value}, printed ${r.date} "${r.text}", played ${r.moved} ${r.g.home ? "vs" : "@"} ${r.g.opp}`);
for (const r of noGame) console.log(`   NO GAME: ${r.t} ${r.side} ${r.kind} ${r.stat} ${r.value}, printed ${r.date} "${r.text}"`);
console.log(`2. two guides print the same night: ${mirrored + mirrorOff.length}; same value: ${mirrored}; different: ${mirrorOff.length}`);
for (const [a, b] of mirrorOff) console.log(`   DIFFERENT: ${a.t} prints ${a.kind} ${a.stat} ${a.value} on ${a.date} (${a.text}); ${b.t} prints ${b.value} by an opponent (${b.text})`);
const e = (v) => todo.filter((r) => r.espn === v);
console.log(`3. ESPN box score (non-points marks since 1993-94): ${todo.length}; same: ${e("same").length}; turnovers within two of ESPN's total, which includes team turnovers: ${e("team turnovers").length}; differs: ${e("differs").length}; no totals: ${e("no totals").length}; game not found: ${e("no event").length}${noFetch ? "; not fetched: " + todo.filter((r) => !r.espn).length : ""}`);
for (const r of e("differs")) console.log(`   DIFFERS: ${r.t} ${r.side} ${r.kind} ${r.stat} ${r.value} on ${r.date} (${r.text}); ESPN ${r.espnVals.join("/")} [${r.event}]${r.mirror ? " (another guide agrees with the print)" : ""}`);
const either = non.filter((r) => r.espn === "same" || r.mirror).length, older = non.filter((r) => !(r.espn === "same" || r.mirror));
console.log(`non-points printed games with a second source: ${either} of ${non.length}; without: ${older.length} (${older.filter((r) => r.date < "1993-10-01").length} before 1993-94)`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify(rows.map(({ g, ...r }) => ({ ...r, opp: g?.opp, home: g?.home })), null, 0));
