/**
 * Franchise history, kept current: every player's totals with each of the 30 franchises through last
 * season (src/data/nba-franchise-careers-<season>.json, built by tools/build-franchise-careers.py from the
 * NBA Guide's team-by-team year-by-year pages) plus his games for that team this season. Pure: no I/O.
 *
 *   franchiseRecords({ careers, teamFiles, tonight, horizon, top }) -> {
 *     boards   { TRI: { stat: [{ name, now, rank, live, first, last }] } }   each franchise's list as it stands now (top `top`)
 *     items    [{ kind: "franchise", source: "history", who, id, team, stat, label, now, target, need, rate,
 *                 passing: { name, value, rank }, rank, gamesAway, text, score, tonight, opp }]
 *     problems [...]
 *   }
 *
 * Only games for that franchise count, so a player traded in starts from his total there (zero if he never
 * played for them). A pass is listed when it lifts him into the franchise's top 10 (top 20 in points, rebounds, assists) and is within
 * `horizon` games at his rate with that team this season.
 */
import { strictKey, seasonLines, LABEL, statWord } from "./guide.js";
import { TEAMS } from "../teams.js";

const STAT = { g: "gp", pts: "pts", reb: "reb", oreb: "oreb", dreb: "dreb", ast: "ast", stl: "stl", blk: "blk", fgm: "fgm", ftm: "ftm", fg3m: "fg3m" };
const RANKED = { pts: 20, reb: 20, ast: 20 }; // passes for a place in a franchise's top 20 (points, rebounds, assists) or top 10
const HORIZON = 10;    // games ahead worth listing
const ORD = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const fmt = (n) => Number(n).toLocaleString("en-US");

export function franchiseRecords({ careers, teamFiles, tonight = [], horizon = HORIZON, top = 25 }) {
  const problems = [];
  const lines = seasonLines(teamFiles);
  const playing = new Map();
  for (const g of tonight || []) { playing.set(g.home, { home: true, opp: g.away }); playing.set(g.away, { home: false, opp: g.home }); }
  // This season's players with each team: TRI -> [{ id, name, lines }]
  const withTeam = {};
  for (const p of Object.values(lines)) {
    for (const tri of new Set(p.lines.map((l) => l.team))) (withTeam[tri] ??= []).push({ id: p.id, name: p.name, current: p.team === tri, lines: p.lines.filter((l) => l.team === tri) });
  }
  const boards = {}, items = [];
  for (const [tri, F] of Object.entries(careers?.franchises || {})) {
    const nick = TEAMS[tri]?.nick || F.name || tri;
    const active = new Map(Object.entries(F.active || {}).map(([n, v]) => [strictKey(n), { name: n, ...v }]));
    const players = withTeam[tri] || [];
    const live = new Map(); // key -> { name, id, current, base, season, rate }
    for (const p of players) {
      const k = strictKey(p.name);
      if (live.has(k)) { problems.push(`${nick}: two players this season named ${p.name}`); continue; }
      live.set(k, { ...p, base: active.get(k) || null });
    }
    boards[tri] = {};
    for (const [key, stat] of Object.entries(STAT)) {
      const hist = F.top?.[key] || [];
      if (!hist.length) continue;
      // The list now: retired and inactive names as printed; anyone who has played for them this season, live.
      const rows = new Map();
      for (const [name, value, first, last] of hist) rows.set(strictKey(name), { name, now: value, first, last, live: false });
      for (const [k, p] of live) {
        const base = p.base?.[key] || 0;
        const season = p.lines.reduce((a, l) => a + (l.stats[stat] || 0), 0);
        // Same name as a retired player on the list but no total with them before: a different player.
        rows.set(!p.base && rows.has(k) ? `${k}|now` : k, { name: p.base?.name || p.name, id: p.id, now: base + season, base, season, first: p.base?.first || null, last: "2026-27", live: true, current: p.current,
          rate: p.lines.length ? season / p.lines.length : 0 });
      }
      const sorted = [...rows.values()].sort((a, b) => b.now - a.now);
      // Ranks hold only as deep as the printed list reaches: below its last value someone unlisted may be ahead.
      const floor = hist[hist.length - 1][1];
      for (const r of sorted) r.rank = r.now >= floor || hist.length < 60 ? 1 + sorted.filter((q) => q.now > r.now).length : null;
      boards[tri][stat] = sorted.slice(0, top).map(({ name, now, rank, live, first, last }) => ({ name, now, rank, live, first, last }));
      // Passes: a current player with that team, the next one or two names ahead inside the top RANKED.
      for (const r of sorted) {
        if (!r.live || !r.current || stat === "min") continue;
        const ahead = sorted.filter((q) => q !== r && q.rank && q.rank <= (RANKED[stat] || 10) && q.now >= r.now).sort((a, b) => a.now - b.now).slice(0, 2);
        for (const a of ahead) {
          const need = a.now - r.now + 1;
          const gamesAway = r.rate > 0 ? Math.max(1, Math.ceil(need / r.rate)) : null;
          if (gamesAway == null || gamesAway > horizon) continue;
          const last = r.name.replace(/\s+(?:Jr\.|II|III|IV)$/, "").split(" ").pop();
          const t = playing.get(tri);
          const place = a.rank === 1 ? "the most" : `${ORD(a.rank)}`;
          items.push({ kind: "franchise", source: "history", who: r.name, last, id: r.id, team: tri, stat, label: LABEL[stat], now: r.now, target: a.now + 1, need, rate: r.rate,
            passing: { name: a.name, value: a.now, rank: a.rank, live: a.live }, rank: a.rank, gamesAway,
            text: `${last}: ${fmt(need)} ${statWord(stat, need)} from passing ${a.name} (${fmt(a.now)}) for ${place} in ${nick} history${a.rank === 1 && need > 1 ? `; ${fmt(need - 1)} ties him` : ""}`,
            score: (a.rank === 1 ? 4 : a.rank <= 3 ? 3.2 : a.rank <= 10 ? 2.6 : 2) - (["oreb", "dreb", "gp"].includes(stat) ? 0.4 : 0),
            tonight: !!t, opp: t?.opp || null });
        }
      }
    }
  }
  items.sort((a, b) => a.gamesAway - b.gamesAway || b.score - a.score);
  return { boards, items, problems };
}
