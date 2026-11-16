/**
 * What an injury report entry means for tonight (pure): the team's record with and without the
 * player, and which teammates' numbers change in the games he missed.
 *
 *   injuryImpacts(rows, teamFiles, { date }) -> [{ team, id, name, status, reason, gameDate, matchup,
 *        mpg, gp, teamGames, missedInARow, without: { games, w, l, margin }, with: { games, w, l, margin },
 *        movers: [{ id, name, stat, with, without, games }], text, score }]
 *
 * rows: parseReport(...).rows. teamFiles: { TRI: { names, games: [{ d, pf, pa, pl: { id: [starter, min, ...] } }] } }
 * (the same per-team files the With / without page reads). date: "YYYY-MM-DD", the night to describe.
 *
 * Only regulars count (18+ minutes a game over 3+ games with the team); "Available" and
 * "Probable" entries, two-way and G League assignments are left out. A player out for a while
 * shows up every night, so the score favours a NEW absence (he played the team's last game).
 * Samples are small early in the season; every line says how many games it rests on.
 */
import { withWithout, roster } from "../situations/withwithout.js";
import { nameKey, shortReason } from "./report.js";

export const MIN_MPG = 18, MIN_GP = 3;
const WEIGHT = { Out: 1, Doubtful: 0.9, Questionable: 0.7 };
const WORD = { Out: "OUT", Doubtful: "DOUBTFUL", Questionable: "QUESTIONABLE" };
const MOVE = { pts: [3, "pts"], ast: [2, "ast"], reb: [2.5, "reb"], min: [6, "min"] };
const short = (name) => { const p = String(name).split(" "); return p.length < 2 ? name : `${p[0][0]}. ${p.slice(1).join(" ")}`; };
const ymd = (mdY) => { const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(mdY || ""); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };
const rec = (r, n) => ({ games: n, w: r.w, l: r.l, margin: r.margin });

/** ESPN id for a report row, matched by name within the team's own file. */
export function matchId(row, file) {
  if (!file || !row.name) return null;
  const want = nameKey(row.name);
  const ids = Object.keys(file.names || {}).filter((id) => nameKey(file.names[id]) === want);
  return ids.length === 1 ? ids[0] : null;
}

export function injuryImpacts(rows, teamFiles, { date } = {}) {
  const out = [];
  for (const row of rows) {
    if (!WEIGHT[row.status] || /^G League/i.test(row.reason || "")) continue;
    const gameDate = ymd(row.date);
    if (date && gameDate && gameDate !== date) continue;
    const file = teamFiles[row.team];
    const id = matchId(row, file);
    if (!id) continue;
    const r = roster(file).find((p) => p.id === id);
    if (!r || r.gp < MIN_GP || r.mpg < MIN_MPG) continue;
    const ww = withWithout(file, id);
    if (!ww) continue;
    // Games missed in a row, up to tonight.
    const games = [...file.games].sort((a, b) => a.d.localeCompare(b.d)).filter((g) => g.d >= ww.out.since);
    let missedInARow = 0;
    for (let i = games.length - 1; i >= 0 && !((games[i].pl[id]?.[1] ?? 0) > 0); i--) missedInARow++;
    // Teammates whose numbers move most in the games he missed (2+ such games, 3+ with him).
    const movers = [];
    if (ww.games.without >= 2) {
      for (const p of ww.players) {
        if (!p.with || !p.without || p.with.gp < 3 || p.without.gp < 2) continue;
        for (const [stat, [min]] of Object.entries(MOVE)) {
          const d = p.without[stat] - p.with[stat];
          if (d >= min) movers.push({ id: p.id, name: p.name, stat, with: p.with[stat], without: p.without[stat], games: p.without.gp, size: d / min });
        }
      }
      // Biggest moves first; one stat per teammate, at most two teammates.
      movers.sort((a, b) => b.size - a.size);
      const keep = [];
      for (const m of movers) if (!keep.some((k) => k.id === m.id) && keep.length < 2) keep.push(m);
      movers.splice(0, movers.length, ...keep);
    }
    const W = ww.team.without, H = ww.team.with;
    const status = WORD[row.status];
    const why = shortReason(row.reason);
    const head = `${ww.out.name} ${status}${why ? ` (${why})` : ""}`;
    let body;
    if (ww.games.without === 0) body = `${row.team} hasn't played without him this season (${H.w}-${H.l} with him)`;
    else {
      body = `${row.team} ${W.w}-${W.l} without him${W.margin != null ? ` (${W.margin >= 0 ? "+" : ""}${W.margin.toFixed(1)} a game)` : ""}, ${H.w}-${H.l} with`;
      if (movers.length) body += `; ${movers.map((m) => `${short(m.name)} ${m.with.toFixed(1)} → ${m.without.toFixed(1)} ${MOVE[m.stat][1]}`).join(", ")} without him (${ww.games.without} games)`;
    }
    const fresh = missedInARow === 0 ? 1.3 : missedInARow <= 2 ? 1 : 0.6;
    out.push({
      team: row.team, id, name: ww.out.name, status: row.status, reason: why, gameDate, matchup: row.matchup,
      mpg: Math.round(r.mpg * 10) / 10, gp: r.gp, teamGames: r.teamGames, missedInARow,
      without: rec(W, ww.games.without), with: rec(H, ww.games.with), movers: movers.map(({ size, ...m }) => m),
      text: `${head}: ${body}`,
      score: Math.round(WEIGHT[row.status] * Math.min(1.5, r.mpg / 24) * fresh * 3.2 * 100) / 100,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Two regulars out at once (0.72.6; the post, 11/15: "Austin Reaves in 3 career games without Luka Doncic, LeBron
 * James since Doncic trade: 51/11/9, 37/8/13, 45/7/7"). For a team with two or more regulars listed Out or Doubtful
 * tonight: its games without both of the two biggest (each already with the team by then), this season and last, and
 * the teammate who scores most in them.
 *
 * impacts: injuryImpacts(...). prior: last season's player games by ESPN id, [{ d, team, pts, reb, ast, win }]
 * (src/anticipate/replay.js pastSeason().pg), or null for this season only.
 */
const IXL = { min: 1, pts: 2, reb: 9, ast: 10 };
export function comboAbsences(impacts, teamFiles, { prior = null, minGames = 2 } = {}) {
  const out = [];
  const byTeam = {};
  for (const x of impacts) if (x.status === "Out" || x.status === "Doubtful") (byTeam[x.team] ??= []).push(x);
  for (const [team, list] of Object.entries(byTeam)) {
    if (list.length < 2 || !teamFiles[team]) continue;
    const [a, b] = [...list].sort((p, q) => q.mpg - p.mpg);
    const file = teamFiles[team];
    // The team's games, oldest first, each with who played: { d, won, lines: { id: { pts, reb, ast } }, season }.
    const games = [];
    if (prior) {
      const byDate = new Map();
      for (const [id, gs] of Object.entries(prior)) for (const g of gs) {
        if (g.team !== team) continue;
        const G = byDate.get(g.d) || byDate.set(g.d, { d: g.d, won: !!g.win, lines: {}, last: true }).get(g.d);
        G.lines[id] = { pts: g.pts || 0, reb: g.reb || 0, ast: g.ast || 0 };
      }
      games.push(...byDate.values());
    }
    for (const g of file.games) {
      const lines = {};
      for (const [id, l] of Object.entries(g.pl)) if ((l[IXL.min] || 0) > 0) lines[id] = { pts: l[IXL.pts] || 0, reb: l[IXL.reb] || 0, ast: l[IXL.ast] || 0 };
      games.push({ d: g.d, won: g.pf > g.pa, lines });
    }
    games.sort((x, y) => x.d.localeCompare(y.d));
    // Without both, once each has played for the team (a game before he arrived isn't a game without him).
    const here = { [a.id]: false, [b.id]: false };
    const both = [], rest = [];
    for (const g of games) {
      const inA = !!g.lines[a.id], inB = !!g.lines[b.id];
      if (here[a.id] && here[b.id]) (!inA && !inB ? both : rest).push(g);
      if (inA) here[a.id] = true;
      if (inB) here[b.id] = true;
    }
    if (both.length < minGames) continue;
    const now = new Set(Object.keys(file.games[file.games.length - 1]?.pl || {}));
    let best = null;
    for (const id of new Set(both.flatMap((g) => Object.keys(g.lines)))) {
      if (id === a.id || id === b.id || !now.has(id)) continue;
      const mine = both.filter((g) => g.lines[id]), other = rest.filter((g) => g.lines[id]);
      if (mine.length < minGames) continue;
      const avg = (gs, k) => gs.reduce((n, g) => n + g.lines[id][k], 0) / gs.length;
      const c = { id, name: file.names[id] || id, n: mine.length, pts: avg(mine, "pts"), reb: avg(mine, "reb"), ast: avg(mine, "ast"), other: other.length ? avg(other, "pts") : null, otherN: other.length };
      // The teammate whose scoring rises most without them (3+ a game, on 3+ other games); failing that, the top scorer.
      c.gain = c.other != null && c.otherN >= 3 ? c.pts - c.other : null;
      const rank = (x) => (x.gain != null && x.gain >= 3 ? 1000 + x.gain : x.pts);
      if (!best || rank(c) > rank(best)) best = c;
    }
    const w = both.filter((g) => g.won).length;
    const span = both.some((g) => g.last) ? " since last season" : " this season";
    const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
    const word = a.status === "Out" && b.status === "Out" ? "out" : "out or doubtful";
    let text = `${a.name} and ${b.name} both ${word}: ${team} ${w}-${both.length - w} in ${both.length} games without both${span}`;
    if (best) text += `; ${best.name} ${r1(best.pts)} PPG, ${r1(best.reb)} RPG, ${r1(best.ast)} APG in ${best.n === both.length ? "them" : `${best.n} of them`}${best.other != null && best.otherN >= 3 ? ` (${r1(best.other)} PPG otherwise)` : ""}`;
    out.push({ team, combo: [a.id, b.id], names: [a.name, b.name], games: both.length, w, l: both.length - w, best, text,
      score: Math.round((Math.max(a.score, b.score) + 0.3 + (best && best.other != null && best.pts - best.other >= 5 ? 0.3 : 0)) * 100) / 100 });
  }
  return out;
}
