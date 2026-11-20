// node tools/odd-games/late/fetch-late.mjs <from YYYY-MM-DD> <to YYYY-MM-DD> [concurrency]
// Reads ESPN's play-by-play for every game in the box-score folder between the dates, rebuilds each player's running
// line (reduce.mjs) and writes one compact file a game: his line at 5:00, 3:00, 2:00 and 1:00 left in the 4th, his
// box-score line, whether the rebuilt final equals the box score ("clean"), and his seconds on the floor after each mark.
// Stops itself after 560 seconds; run it again and it carries on. 28,880 games took 470 seconds on 11/19/26.
// Folders: WORK (default /home/claude/work) holds full/ (box scores, from fetch-full.mjs) and late/g/ (the output).
import fs from "fs"; import { reduce, floorAfter, MARKS } from "./reduce.mjs";
const [from, to, conc = "8"] = process.argv.slice(2), WORK = process.env.WORK || "/home/claude/work", FULL = `${WORK}/full`, OUT = `${WORK}/late/g`; fs.mkdirSync(OUT, { recursive: true });
const idx = `${WORK}/late/index.json`;
let all; if (fs.existsSync(idx)) all = JSON.parse(fs.readFileSync(idx, "utf8")); else { all = []; for (const f of fs.readdirSync(FULL)) { try { const g = JSON.parse(fs.readFileSync(`${FULL}/${f}`, "utf8")); all.push([f.slice(2, -5), g.d]); } catch { /* skip */ } } fs.writeFileSync(idx, JSON.stringify(all)); }
const todo = all.filter(([id, d]) => d >= from && d <= to && !fs.existsSync(`${OUT}/${id}.json`)).sort((a, b) => (a[1] < b[1] ? 1 : -1));
const K = ["pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "blk", "tov", "pf"], IX = { pts: 5, fgm: 6, fga: 7, fg3m: 8, fg3a: 9, ftm: 10, fta: 11, oreb: 12, dreb: 13, reb: 14, ast: 15, stl: 16, blk: 17, tov: 18, pf: 19 };
let done = 0, fail = 0; const t0 = Date.now(), stopAt = t0 + 560e3;
async function one([id, d]) {
  for (let tryN = 0; tryN < 3; tryN++) { try {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json(), box = JSON.parse(fs.readFileSync(`${FULL}/f-${id}.json`, "utf8"));
    if (!(j.plays || []).length) { fs.writeFileSync(`${OUT}/${id}.json`, JSON.stringify({ d, none: 1 })); done++; return; }
    const R = reduce(j), teamOf = {}; for (const t of box.t) for (const p of t.p) teamOf[String(p[0])] = t.t;
    const F = floorAfter(j, teamOf), players = [];
    for (const t of box.t) { const five = t.p.filter((p) => p[3]).length === 5; for (const p of t.p) { const pid = String(p[0]); if (!p[4] && !R.final[pid]) continue;
      const fin = R.final[pid] || {}, clean = K.every((k) => (fin[k] || 0) === (p[IX[k]] || 0));
      players.push({ id: pid, n: p[1], pos: p[2], t: t.t, st: five ? p[3] : null, box: K.map((k) => p[IX[k]] || 0), min: p[4] || 0, clean: clean ? 1 : 0, bad: clean ? undefined : K.filter((k) => (fin[k] || 0) !== (p[IX[k]] || 0)),
        at: Object.fromEntries(MARKS.map((m) => [m, K.map((k) => R.snaps[m]?.[pid]?.[k] || 0)])), after: F.ok[t.t] ? MARKS.map((m) => F.after[pid]?.[m] || 0) : null, on: MARKS.map((m) => (F.onAt[m]?.has(pid) ? 1 : 0)) }); } }
    const sc = (m) => { let last = null; for (const x of j.plays) { const s = /^(\d+):(\d+)/.exec(x.clock?.displayValue || ""); const sv = s ? +s[1] * 60 + +s[2] : parseFloat(x.clock?.displayValue) || 0; if (x.period?.number > 4 || (x.period?.number === 4 && sv < m)) break; last = x; } return last ? [last.awayScore, last.homeScore] : null; };
    fs.writeFileSync(`${OUT}/${id}.json`, JSON.stringify({ d, per: R.periods, teams: box.t.map((t) => [t.t, t.home, t.s]), score: Object.fromEntries(MARKS.map((m) => [m, sc(m)])), p: players })); done++; return;
  } catch (e) { if (tryN === 2) { fail++; if (fail < 6) console.error(id, e.message); } else await new Promise((r) => setTimeout(r, 800 * (tryN + 1))); } }
}
let i = 0; await Promise.all(Array.from({ length: +conc }, async () => { while (i < todo.length && Date.now() < stopAt) await one(todo[i++]); }));
console.log(`done ${done}, failed ${fail}, left ${todo.length - i}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
