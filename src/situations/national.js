/**
 * National TV vs other games (the user's request, 11/12): who plays better, or worse, with the bigger
 * spotlight. National = ABC, ESPN, NBC, Peacock (incl. the Monday Peacock/NBCSN games) and Prime Video,
 * from the season's national schedule (src/data/national-tv-<season>.json, read from the NBA's
 * Tip-Off Guide). NBA TV and ESPN Radio games are not national here.
 *
 * Input: the team files' game lists (docs/data/teams/<TRI>.json: { team, keys, names, games: [{ d, opp, home, pf, pa, pl }] }).
 * A player traded mid-season is summed over his teams. Only games he played (minutes > 0) count.
 */
export const nationalKey = (d, away, home) => `${d}|${away}|${home}`;

/** The schedule file -> Map(key -> networks). */
export function nationalIndex(schedule) {
  const m = new Map();
  for (const g of schedule?.games || []) m.set(nationalKey(g.d, g.away, g.home), g.networks || []);
  return m;
}

const STATS = ["min", "pts", "reb", "ast", "fg3m", "fgm", "fga", "ftm", "fta", "stl", "blk", "tov", "pm"];
const blank = () => ({ gp: 0, ...Object.fromEntries(STATS.map((k) => [k, 0])) });

/**
 * teamFiles: { TRI: file }. index: nationalIndex(). currentTeam: (id) -> team code (optional; else his last team).
 * -> { teams: { TRI: { nat: { w, l }, other: { w, l }, byNet: { ABC: { w, l }, … } } }, players: [{ id, name, team, nat, other }] }
 *    where nat/other are totals ({ gp, min, pts, … }) over the games he played. A game carried by two networks
 *    counts for each (byNet), once in nat.
 */
export function nationalSplits(teamFiles, index, { currentTeam = null } = {}) {
  const teams = {}, players = {};
  for (const [tri, f] of Object.entries(teamFiles)) {
    const ix = Object.fromEntries((f.keys || []).map((k, i) => [k, i]));
    const t = (teams[tri] = { nat: { w: 0, l: 0 }, other: { w: 0, l: 0 }, byNet: {} });
    for (const g of f.games || []) {
      const key = g.home ? nationalKey(g.d, g.opp, tri) : nationalKey(g.d, tri, g.opp);
      const side = index.has(key) ? "nat" : "other";
      if (g.pf != null && g.pa != null) {
        const r = g.pf > g.pa ? "w" : "l";
        t[side][r]++;
        for (const n of new Set(index.get(key) || [])) (t.byNet[n] ??= { w: 0, l: 0 })[r]++;
      }
      for (const [id, row] of Object.entries(g.pl || {})) {
        if (!(row[ix.min] > 0)) continue;
        const p = (players[id] ??= { id, name: (f.names || {})[id] || id, team: tri, last: "", nat: blank(), other: blank() });
        if (g.d >= p.last) { p.last = g.d; p.team = tri; }
        const s = p[side];
        s.gp++;
        for (const k of STATS) s[k] += row[ix[k]] || 0;
      }
    }
  }
  const list = Object.values(players).map(({ last, ...p }) => ({ ...p, team: (currentTeam && currentTeam(p.id)) || p.team }));
  return { teams, players: list };
}

/** Per-game averages and percentages for a totals block. */
export function perGame(s) {
  const g = s.gp || 0, r = (x) => (g ? Math.round((x / g) * 10) / 10 : null);
  return { gp: g, min: r(s.min), pts: r(s.pts), reb: r(s.reb), ast: r(s.ast), fg3m: r(s.fg3m), stl: r(s.stl), blk: r(s.blk), tov: r(s.tov), pm: r(s.pm),
    fgPct: s.fga ? Math.round((s.fgm / s.fga) * 1000) / 10 : null, tsPct: s.fga + s.fta ? Math.round((s.pts / (2 * (s.fga + 0.44 * s.fta))) * 1000) / 10 : null };
}
