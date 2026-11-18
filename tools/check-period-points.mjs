// A second source for the points-by-half, -quarter and -overtime marks the guides print (src/data/team-game-records-2026-27.json):
// ESPN's daily scoreboards carry every game's score by period from 1993-94.
//   1. each printed game: the team (or its opponent, for a "by an opponent" mark) scored that number in a half, a quarter or an overtime that night;
//   2. the sweep: every regular-season game since 1993-94 is read for a half, quarter or overtime that beats a printed mark, or ties one the guide does not list.
// Games are matched by the two teams, never by the score alone (two games can end with the same score on one night).
//
//   NODE_USE_ENV_PROXY=1 node tools/check-period-points.mjs --dir <folder for saved ESPN pages> [--no-fetch] [--out file.json]
import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib"; import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), D = (f) => path.join(root, "src", "data", f);
const js = (f) => JSON.parse(fs.readFileSync(f, "utf8")), gz = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(D(f))));
const args = process.argv.slice(2), arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null), dir = arg("--dir"), noFetch = args.includes("--no-fetch"), outFile = arg("--out");
const R = js(D("team-game-records-2026-27.json")).teams;
const ALIAS = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", VAN: "MEM", SEA: "OKC", NJ: "BKN", NOK: "NOP", NOH: "NOP", PHO: "PHX", CHH: "CHA" }, tri = (a) => ALIAS[a] || a;
// our results (ESPN's finals): date -> games
const store = {};
for (const f of [js(D("nba-results-history.json")), gz("nba-results-older.json.gz")]) for (const g of f.games) { if (g[5] != null && g[5] !== 2) continue; (store[g[0].slice(0, 10)] ||= []).push({ home: g[1], away: g[2], hs: g[3], as: g[4] }); }
const dates = Object.keys(store).sort();
const H = { headers: { "User-Agent": "Mozilla/5.0 nba-command-center" } };
async function board(d) {
  const f = dir && path.join(dir, "ls-" + d + ".json");
  if (f && fs.existsSync(f)) return js(f);
  if (noFetch) return null;
  for (let k = 0; k < 4; k++) { try { const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d.replace(/-/g, "")}&limit=100`, H); if (!r.ok) throw new Error(r.status); const j = await r.json();
      const keep = { events: (j.events || []).map((e) => ({ id: e.id, type: e.season?.type, done: e.competitions[0].status?.type?.completed, c: e.competitions[0].competitors.map((c) => ({ ha: c.homeAway, a: c.team.abbreviation, s: Number(c.score), ls: (c.linescores || []).map((l) => Number(l.value ?? l.displayValue)) })) })) };
      if (f) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(keep)); }
      return keep; } catch (e) { await new Promise((r2) => setTimeout(r2, 900 * (k + 1))); } }
  return null;
}
// ESPN line scores that add up and are still wrong, by another source (a quarter's points moved to the next one)
const WRONG = { "2001-12-05 PHI@GSW": "ESPN prints Philadelphia 5, 34, 29, 19; Land of Basketball and Basketball Reference's play-by-play have 23, 16, 29, 19" };
// every game, both sides: { t, opp, home, date, q: [..], oq: [..] } (q = that team's points by period)
const G = [], bad = { noBoard: [], noEvent: [], noLine: [], sumOff: [], broken: [], wrong: [] };
let next = 0;
async function worker() { while (next < dates.length) { const d = dates[next++]; const sb = await board(d);
    if (!sb) { bad.noBoard.push(d); continue; }
    for (const g of store[d]) {
      // ESPN lists some games twice, once with no line score (all of 1998-99): the one with a line score is read
      const evs = sb.events.filter((e) => tri(e.c.find((c) => c.ha === "home")?.a) === g.home && tri(e.c.find((c) => c.ha === "away")?.a) === g.away);
      const ev = evs.find((e) => e.c.every((c) => c.ls.length >= 4)) || evs[0];
      if (!ev) { bad.noEvent.push(d + " " + g.away + "@" + g.home); continue; }
      const h = ev.c.find((c) => c.ha === "home"), a = ev.c.find((c) => c.ha === "away");
      if (WRONG[d + " " + g.away + "@" + g.home]) { bad.wrong.push(d + " " + g.away + "@" + g.home); continue; }
      if (h.ls.length < 4 || a.ls.length < 4) { bad.noLine.push(d + " " + g.away + "@" + g.home); continue; }
      const sum = (x) => x.reduce((p, q) => p + q, 0);
      if (sum(h.ls) !== g.hs || sum(a.ls) !== g.as || h.s !== g.hs || a.s !== g.as) { bad.sumOff.push(`${d} ${g.away}@${g.home} ${g.as}-${g.hs} line ${a.ls.join(",")} / ${h.ls.join(",")}`); continue; }
      // a page that runs two quarters together still adds up (BKN at IND 12/21/01: 24, 55, 0, 15): no quarter is 0, and none is over the league record of 58
      // ... and an overtime follows a tie (NYK at NOP 11/22/02 is printed 31, 22, 22, 6, 16: a fourth quarter of 22 cut in two)
      const tied = (n) => sum(h.ls.slice(0, n)) === sum(a.ls.slice(0, n)), ots = h.ls.length - 4;
      if (h.ls.length !== a.ls.length || Array.from({ length: ots }, (_, k) => tied(4 + k)).some((x) => !x) || [...h.ls.slice(0, 4), ...a.ls.slice(0, 4)].some((x) => x === 0 || x > 58)) { bad.broken.push(`${d} ${g.away}@${g.home} line ${a.ls.join(",")} / ${h.ls.join(",")}`); continue; }
      G.push({ t: g.home, opp: g.away, home: true, date: d, q: h.ls, oq: a.ls }, { t: g.away, opp: g.home, home: false, date: d, q: a.ls, oq: h.ls });
    }
    if (next % 500 === 0) process.stderr.write(`  ${next} of ${dates.length} days\n`); } }
await Promise.all(Array.from({ length: noFetch ? 1 : 6 }, worker));
// an "overtime" mark is one overtime period in some guides and all of a game's overtime in others (NOP 28 at CHI 12/2/13 is 6 + 13 + 9): both are read
const parts = (q, period, whole = true) => (period === "quarter" ? q.slice(0, 4) : period === "half" ? [q[0] + q[1], q[2] + q[3]] : whole && q.length > 5 ? [...q.slice(4), q.slice(4).reduce((p, x) => p + x, 0)] : q.slice(4));
const byTeam = {}; for (const g of G) ((byTeam[g.t] ||= {})[g.date] ||= []).push(g);
const shift = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
// 1. the printed games
const marks = []; for (const [t, ms] of Object.entries(R)) for (const m of ms) if (m.stat === "pts" && m.period !== "game") marks.push({ t, ...m, side: m.side || "team" });
const res = { same: [], moved: [], differs: [], noGame: [], before: 0, undated: 0 };
for (const m of marks) for (const g of m.games) {
  if (!g.date) { res.undated++; continue; }
  if (g.date < "1993-10-01") { res.before++; continue; }
  const row = { t: m.t, side: m.side, kind: m.kind, period: m.period, value: m.value, date: g.date, text: g.opp };
  const has = (d) => (byTeam[m.t]?.[d] || []).find((x) => parts(m.side === "team" ? x.q : x.oq, m.period).includes(m.value));
  if (has(g.date)) { res.same.push(row); continue; }
  const near = [-1, 1].map((n) => shift(g.date, n)).find((d) => has(d));
  if (near) { res.moved.push({ ...row, on: near }); continue; }
  const x = (byTeam[m.t]?.[g.date] || [])[0];
  if (x) res.differs.push({ ...row, opp: x.opp, line: (m.side === "team" ? x.q : x.oq).join(","), got: parts(m.side === "team" ? x.q : x.oq, m.period).join(",") }); else res.noGame.push(row);
}
// two guides, one night: A's own mark against B is B's "by an opponent" mark
const mirror = { same: 0, off: [] };
for (const a of marks) if (a.side === "team") for (const ga of a.games) for (const b of marks) if (b.side === "opp" && b.t !== a.t && b.period === a.period && b.kind === a.kind) for (const gb of b.games) {
  if (!ga.date || ga.date !== gb.date) continue;
  const x = (byTeam[a.t]?.[ga.date] || [])[0]; if (ga.date >= "1993-10-01" && x && x.opp !== b.t) continue;
  if (a.value === b.value) mirror.same++; else mirror.off.push(`${a.t} ${a.kind} pts in a ${a.period} ${a.value} (${ga.opp}) / ${b.t} by an opponent ${b.value} (${gb.opp}) ${ga.date}`);
}
// 2. the sweep: a half, quarter or overtime since 1993-94 that beats the printed mark, or ties it on a night the guide does not print
const beats = [], otBeats = [], ties = [], FROM = { OKC: "2008-10-01" };      // the Thunder's guide starts in Oklahoma City
for (const m of marks) {
  const better = (v) => (m.kind === "most" ? v > m.value : v < m.value), printed = new Set(m.games.flatMap((g) => (g.date ? [g.date, shift(g.date, -1), shift(g.date, 1)] : [])));
  for (const g of G) if (g.t === m.t && g.date >= (FROM[m.t] || "")) for (const v of parts(m.side === "team" ? g.q : g.oq, m.period, false)) {
    const row = { t: m.t, side: m.side, kind: m.kind, period: m.period, printed: m.value, got: v, date: g.date, opp: g.opp, home: g.home, line: (m.side === "team" ? g.q : g.oq).join(",") };
    if (better(v)) (m.period === "ot" ? otBeats : beats).push(row); else if (m.period === "ot") continue; else if (v === m.value && !printed.has(g.date)) ties.push({ ...row, listed: m.games.length, times: m.times || null, text: m.games.map((x) => x.opp).join(" | ") });
  }
}
const say = (r) => `${r.t} ${r.side === "opp" ? "opp " : ""}${r.kind} pts in a ${r.period}: ${r.value ?? r.printed} ${r.text ?? ""} ${r.date}`;
console.log(`${marks.length} points marks by half, quarter and overtime; ${marks.reduce((n, m) => n + m.games.length, 0)} printed games`);
console.log(`games read: ${G.length / 2} with a line score that adds up (${bad.noBoard.length} days no page, ${bad.noEvent.length} games not on the page, ${bad.noLine.length} no line score, ${bad.sumOff.length} line score does not add up, ${bad.broken.length} quarters run together, ${bad.wrong.length} wrong by another source)`);
console.log(`printed games: ${res.same.length} same, ${res.moved.length} a day off, ${res.differs.length} differ, ${res.noGame.length} no usable game that day, ${res.before} before 1993-94, ${res.undated} undated`);
console.log(`two guides, one night: ${mirror.same} agree, ${mirror.off.length} do not`); for (const x of mirror.off) console.log("  " + x);
for (const r of res.moved) console.log("  day off: " + say(r) + " -> " + r.on);
for (const r of res.differs) console.log("  DIFFERS: " + say(r) + ` | v ${r.opp} line ${r.line} (${r.period}s ${r.got})`);
for (const r of res.noGame) console.log("  no game: " + say(r));
console.log(`sweep (halves and quarters): ${beats.length} beat a printed mark, ${ties.length} tie one on a night the guide does not print; one overtime: ${otBeats.length} beat a printed mark (some guides mean a game's whole overtime, so these are not corrections)`);
for (const r of otBeats) console.log(`  one overtime: ${say(r)} ${r.home ? "v" : "at"} ${r.opp}: ${r.got} (line ${r.line})`);
for (const r of beats) console.log(`  BEATS: ${say(r)} ${r.home ? "v" : "at"} ${r.opp}: ${r.got} (line ${r.line})`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ res, beats, otBeats, ties, bad }, null, 1));
