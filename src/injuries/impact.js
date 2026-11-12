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
