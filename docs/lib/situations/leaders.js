/**
 * Team leaders and shooting thresholds from the season's per-game player lines (pure).
 *
 * Input rows: results rows with `pl` (see results.js):
 *   pl = { espnId: [side 0 home | 1 away, starter, min, pts, fgm, fga, fg3m, fg3a, ftm, fta, reb, ast, tov, stl, blk, oreb, dreb, pf, pm] }
 *
 * Game leaders: in each team game, the player(s) with the team's most of a stat.
 * A tie counts as leading for every tied player ("sole" counts only outright
 * leads). A game where nobody on the team had any (0 blocks, say) has no
 * leader. A player is credited only with the team he played for that night, so
 * a traded player has one line per team.
 *   led       games he led (sole or tied)
 *   played    games he played for that team (minutes, or any stat)
 *   teamGames the team's games
 *   run       his current run: consecutive games he PLAYED, latest backwards,
 *             in which he led (missed games neither extend nor break it)
 *
 * Season leaders: each team's season totals per player (with that team only),
 * and the leader(s) of each stat. "Categories led" counts the stats in which a
 * player has the team's highest total (ties included, and marked).
 *
 * Shooting: a player's season totals over all his teams. Qualified as on the
 * NBA's leaderboards: 300 FG made, 82 threes made, 125 FT made over 82 games,
 * prorated by his current team's games so far (rounded up). For each line:
 *   cushion  misses in a row he can take and stay at or above the line
 *   need     makes in a row he needs to reach the line
 */
const IX = { side: 0, starter: 1, min: 2, pts: 3, fgm: 4, fga: 5, fg3m: 6, fg3a: 7, ftm: 8, fta: 9, reb: 10, ast: 11, tov: 12, stl: 13, blk: 14 };
export const LEAD_STATS = [["pts", "Points"], ["reb", "Rebounds"], ["ast", "Assists"], ["stl", "Steals"], ["blk", "Blocks"], ["fg3m", "3-pointers"]];
export const LINES = [
  { key: "fg", label: "50% from the field", m: "fgm", a: "fga", pct: 50, qualMakes: 300 },
  { key: "fg3", label: "40% on threes", m: "fg3m", a: "fg3a", pct: 40, qualMakes: 82 },
  { key: "ft", label: "90% from the line", m: "ftm", a: "fta", pct: 90, qualMakes: 125 },
];

const played = (v) => v[IX.min] > 0 || LEAD_STATS.some(([k]) => v[IX[k]] > 0) || v[IX.fga] > 0 || v[IX.fta] > 0;
const sortRows = (rows) => [...rows].filter((g) => g.pl).sort((a, b) => a.d.localeCompare(b.d) || a.id.localeCompare(b.id));

/** { team: [{ d, gameId, players: { id: line } }] } in date order; line = { min, pts, ... }. */
export function teamGames(rows) {
  const out = {};
  for (const g of sortRows(rows)) {
    for (const [side, team] of [[0, g.h], [1, g.a]]) {
      const players = {};
      for (const [id, v] of Object.entries(g.pl)) {
        if (v[IX.side] !== side) continue;
        players[id] = { played: played(v) };
        for (const [k, i] of Object.entries(IX)) if (i >= 2) players[id][k] = v[i];
      }
      (out[team] ??= []).push({ d: g.d, gameId: g.id, players });
    }
  }
  return out;
}

/** Game-by-game leaders: [{ id, team, stat, led, sole, played, teamGames, run, lastLed }]. */
export function gameLeaders(tg) {
  const out = [];
  for (const [team, games] of Object.entries(tg)) {
    for (const [stat] of LEAD_STATS) {
      const per = {};
      for (const g of games) {
        const max = Math.max(0, ...Object.values(g.players).map((p) => p[stat] || 0));
        const leaders = max > 0 ? Object.keys(g.players).filter((id) => (g.players[id][stat] || 0) === max) : [];
        for (const [id, p] of Object.entries(g.players)) {
          if (!p.played) continue;
          const r = (per[id] ??= { id, team, stat, led: 0, sole: 0, played: 0, teamGames: games.length, seq: [] });
          r.played++;
          const isLeader = leaders.includes(id);
          if (isLeader) { r.led++; if (leaders.length === 1) r.sole++; r.lastLed = g.d; }
          r.seq.push(isLeader);
        }
      }
      for (const r of Object.values(per)) {
        let run = 0;
        for (let i = r.seq.length - 1; i >= 0 && r.seq[i]; i--) run++;
        r.run = run;
        delete r.seq;
        if (r.led > 0) out.push(r);
      }
    }
  }
  return out;
}

/** Season totals with each team, and each team's leader(s) per stat. */
export function seasonLeaders(tg) {
  const teams = {};
  for (const [team, games] of Object.entries(tg)) {
    const tot = {};
    for (const g of games) {
      for (const [id, p] of Object.entries(g.players)) {
        if (!p.played) continue;
        const t = (tot[id] ??= { games: 0, min: 0, ...Object.fromEntries(LEAD_STATS.map(([k]) => [k, 0])) });
        t.games++; t.min += p.min || 0;
        for (const [k] of LEAD_STATS) t[k] += p[k] || 0;
      }
    }
    const leaders = {};
    for (const [k] of LEAD_STATS) {
      const max = Math.max(0, ...Object.values(tot).map((t) => t[k]));
      const ids = max > 0 ? Object.keys(tot).filter((id) => tot[id][k] === max) : [];
      // Runner-up (the best total not tied for the lead), so the page can show the margin.
      const second = Math.max(0, ...Object.values(tot).map((t) => t[k]).filter((x) => x < max));
      leaders[k] = { ids, total: max, second, margin: max - second };
    }
    const cats = {};
    for (const [k] of LEAD_STATS) for (const id of leaders[k].ids) (cats[id] ??= []).push({ stat: k, tied: leaders[k].ids.length > 1 });
    teams[team] = { teamGames: games.length, leaders, totals: tot, categories: cats };
  }
  return teams;
}

/** Misses in a row a shooter can take and stay at or above pct (whole percent); -1 if already below. */
export function cushion(m, a, pct) {
  if (100 * m < pct * a) return -1;
  return Math.floor((100 * m - pct * a) / pct);
}
/** Makes in a row needed to reach pct; 0 if already there. */
export function needed(m, a, pct) {
  const gap = pct * a - 100 * m;
  return gap <= 0 ? 0 : Math.ceil(gap / (100 - pct));
}

/** Season shooting per player (all teams), with each line's standing. */
export function shooting(rows) {
  const tg = teamGames(rows);
  const teamCount = Object.fromEntries(Object.entries(tg).map(([t, g]) => [t, g.length]));
  const out = {};
  for (const g of sortRows(rows)) {
    for (const [id, v] of Object.entries(g.pl)) {
      if (!played(v)) continue;
      const p = (out[id] ??= { id, games: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0 });
      p.games++;
      p.team = v[IX.side] === 0 ? g.h : g.a; // latest team (rows are in date order)
      for (const k of ["fgm", "fga", "fg3m", "fg3a", "ftm", "fta"]) p[k] += v[IX[k]] || 0;
    }
  }
  for (const p of Object.values(out)) {
    p.teamGames = teamCount[p.team] || p.games;
    for (const L of LINES) {
      const m = p[L.m], a = p[L.a];
      const minMakes = Math.ceil((L.qualMakes * p.teamGames) / 82);
      p[L.key] = { m, a, pct: a ? (100 * m) / a : null, qualified: m >= minMakes, minMakes, cushion: a ? cushion(m, a, L.pct) : -1, need: a ? needed(m, a, L.pct) : null };
    }
  }
  return out;
}
