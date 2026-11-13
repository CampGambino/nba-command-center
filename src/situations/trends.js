/**
 * Streaks and anomalies from the season's per-game player lines (pure).
 *
 * Input rows: results rows with `pl` (see results.js):
 *   pl = { espnId: [side 0 home | 1 away, starter, min, pts, fgm, fga, fg3m, fg3a, ftm, fta, reb, ast, tov, stl, blk, oreb, dreb, pf, pm] }
 *
 * Streaks count games a player PLAYED (missed games neither extend nor break
 * them), this season only: a run that began last season shows only its
 * this-season part. A streak is "active" if it includes the player's latest
 * game.
 *
 * Anomaly: one game against the same player's other games this season.
 *   score = (value - his average elsewhere) / max(his spread elsewhere, floor)
 * The floor stops a steady player's 1-point move from looking huge (points 4,
 * rebounds 2.5, assists 2, threes 1.2, minutes 5). It needs 5+ other games. A
 * game is listed when a score is 2.5+ (or -2.5 or lower for points or minutes
 * of a regular: 15+ points or 20+ minutes a game), or it's a season high by a
 * clear margin. Ranked by the biggest score.
 */
const IX = { side: 0, starter: 1, min: 2, pts: 3, fgm: 4, fga: 5, fg3m: 6, fg3a: 7, ftm: 8, fta: 9, reb: 10, ast: 11, tov: 12, stl: 13, blk: 14, oreb: 15, dreb: 16, pf: 17, pm: 18 };
export const LINE_IX = IX;

/** Each player's games, in date order: { id: [{ d, gameId, team, opp, home, win, min, pts, ... }] } */
export function playerGames(rows) {
  const out = {};
  for (const g of [...rows].sort((a, b) => a.d.localeCompare(b.d) || a.id.localeCompare(b.id))) {
    if (!g.pl) continue;
    for (const [id, v] of Object.entries(g.pl)) {
      if (!(v[IX.min] > 0)) continue;
      const home = v[IX.side] === 0;
      const line = { d: g.d, gameId: g.id, team: home ? g.h : g.a, opp: home ? g.a : g.h, home: home && !g.n, win: home ? g.hs > g.as : g.as > g.hs };
      for (const [k, i] of Object.entries(IX)) if (i >= 1) line[k] = v[i];
      (out[id] ??= []).push(line);
    }
  }
  return out;
}

export const STREAKS = [
  ["pts10", "10+ points", (l) => l.pts >= 10, 8],
  ["pts20", "20+ points", (l) => l.pts >= 20, 4],
  ["pts25", "25+ points", (l) => l.pts >= 25, 3],
  ["pts30", "30+ points", (l) => l.pts >= 30, 2],
  ["reb10", "10+ rebounds", (l) => l.reb >= 10, 3],
  ["ast8", "8+ assists", (l) => l.ast >= 8, 3],
  ["dd", "Double-double", (l) => [l.pts, l.reb, l.ast, l.stl, l.blk].filter((x) => x >= 10).length >= 2, 3],
  ["three", "Made a three", (l) => l.fg3m >= 1, 8],
  ["threes3", "3+ threes", (l) => l.fg3m >= 3, 3],
  ["start", "Starts", (l) => l.starter === 1, 0],
];

/** Active streaks at or above each category's minimum, longest first. */
export function activeStreaks(pg, names = {}) {
  const out = [];
  for (const [id, games] of Object.entries(pg)) {
    for (const [key, label, test, min] of STREAKS) {
      if (key === "start") continue;
      let n = 0;
      for (let i = games.length - 1; i >= 0 && test(games[i]); i--) n++;
      let best = 0, run = 0;
      for (const g of games) { run = test(g) ? run + 1 : 0; best = Math.max(best, run); }
      if (n >= Math.max(min, 2)) {
        out.push({ id, name: names[id] || id, team: games[games.length - 1].team, key, label, length: n, ofGames: games.length, since: games[games.length - n].d, last: games[games.length - 1].d, seasonBest: best });
      }
    }
  }
  return out.sort((a, b) => b.length - a.length || a.name.localeCompare(b.name));
}

/**
 * Team streaks: wins, losses, home, road; their own scoring (120+, 110+, held under 110) and their
 * defence (opponents held under 110 and under 100, opponents scoring 120+). Each is the current run.
 */
export function teamStreaks(rows) {
  const tg = {};
  for (const g of [...rows].sort((a, b) => a.d.localeCompare(b.d) || a.id.localeCompare(b.id))) {
    for (const home of [true, false]) {
      const t = home ? g.h : g.a;
      (tg[t] ??= []).push({ d: g.d, home: home && !g.n, road: !home && !g.n, pf: home ? g.hs : g.as, pa: home ? g.as : g.hs });
    }
  }
  const run = (list, test) => { let n = 0; for (let i = list.length - 1; i >= 0 && test(list[i]); i--) n++; return n; };
  const out = {};
  for (const [t, games] of Object.entries(tg)) {
    const last = games[games.length - 1];
    const win = last.pf > last.pa;
    const homeG = games.filter((x) => x.home), roadG = games.filter((x) => x.road);
    const hw = homeG.length ? homeG[homeG.length - 1].pf > homeG[homeG.length - 1].pa : null;
    const rw = roadG.length ? roadG[roadG.length - 1].pf > roadG[roadG.length - 1].pa : null;
    out[t] = {
      streak: { type: win ? "W" : "L", n: run(games, (x) => (x.pf > x.pa) === win) },
      home: hw === null ? null : { type: hw ? "W" : "L", n: run(homeG, (x) => (x.pf > x.pa) === hw) },
      road: rw === null ? null : { type: rw ? "W" : "L", n: run(roadG, (x) => (x.pf > x.pa) === rw) },
      scored120: run(games, (x) => x.pf >= 120),
      scored110: run(games, (x) => x.pf >= 110),
      under110: run(games, (x) => x.pf < 110),
      held110: run(games, (x) => x.pa < 110),
      held100: run(games, (x) => x.pa < 100),
      allowed120: run(games, (x) => x.pa >= 120),
    };
  }
  return out;
}

const FLOOR = { pts: 4, reb: 2.5, ast: 2, fg3m: 1.2, stl: 1, blk: 1, min: 5 };
const LABEL = { pts: "points", reb: "rebounds", ast: "assists", fg3m: "threes", stl: "steals", blk: "blocks", min: "minutes" };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };

/** Unusual single games on the given dates (default: the latest date with games). */
export function anomalies(pg, names = {}, { dates = null, minOther = 5, threshold = 2.5 } = {}) {
  const all = Object.values(pg).flat().map((l) => l.d);
  const latest = all.length ? all.reduce((a, b) => (a > b ? a : b)) : null;
  const want = new Set(dates || (latest ? [latest] : []));
  const out = [];
  for (const [id, games] of Object.entries(pg)) {
    games.forEach((g, i) => {
      if (!want.has(g.d)) return;
      const other = games.filter((_, j) => j !== i);
      if (other.length < minOther) return;
      const notes = [];
      let best = 0;
      for (const k of Object.keys(FLOOR)) {
        const xs = other.map((o) => o[k]);
        const m = mean(xs), s = Math.max(sd(xs), FLOOR[k]);
        const z = (g[k] - m) / s;
        const high = Math.max(...xs);
        const regular = k === "pts" ? m >= 15 : k === "min" ? m >= 20 : false;
        const seasonHigh = g[k] > high && g[k] - high >= FLOOR[k];
        if (z >= threshold || (z <= -threshold && regular) || (seasonHigh && z >= 1.5)) {
          notes.push({ stat: k, value: g[k], avg: Math.round(m * 10) / 10, z: Math.round(z * 100) / 100, seasonHigh, prevHigh: high, low: z < 0 });
          best = Math.max(best, Math.abs(z));
        }
      }
      // Shooting: 10+ shots at least 25 points of FG% off his usual, or 0 for 6+ from three.
      const fgaO = other.reduce((a, o) => a + o.fga, 0), fgmO = other.reduce((a, o) => a + o.fgm, 0);
      if (g.fga >= 10 && fgaO >= 30) {
        const usual = fgmO / fgaO, now = g.fgm / g.fga;
        if (Math.abs(now - usual) >= 0.25) { notes.push({ stat: "fgp", value: Math.round(now * 1000) / 10, avg: Math.round(usual * 1000) / 10, fgm: g.fgm, fga: g.fga, low: now < usual, z: (now - usual) * 10 }); best = Math.max(best, Math.abs(now - usual) * 10); }
      }
      if (g.fg3a >= 6 && g.fg3m === 0) { notes.push({ stat: "fg3cold", value: 0, fg3a: g.fg3a, low: true, z: -2.5 }); best = Math.max(best, 2.5); }
      if (!notes.length) return;
      out.push({ id, name: names[id] || id, team: g.team, opp: g.opp, home: g.home, win: g.win, d: g.d, min: g.min, line: { pts: g.pts, reb: g.reb, ast: g.ast, fgm: g.fgm, fga: g.fga, fg3m: g.fg3m, fg3a: g.fg3a }, games: games.length, score: Math.round(best * 100) / 100, notes, text: describe(g, notes) });
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

function describe(g, notes) {
  return notes.map((n) => {
    if (n.stat === "fgp") return `shot ${n.fgm}-${n.fga} (${n.value}%; usually ${n.avg}%)`;
    if (n.stat === "fg3cold") return `0-${n.fg3a} from three`;
    const hi = n.seasonHigh ? `, season high (previous ${n.prevHigh})` : "";
    return `${n.value} ${LABEL[n.stat]} (averages ${n.avg}${hi})`;
  }).join("; ");
}
