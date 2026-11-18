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

const STATS = ["min", "pts", "reb", "ast", "fg3m", "fg3a", "fgm", "fga", "ftm", "fta", "stl", "blk", "tov", "pm"];
const blank = () => ({ gp: 0, ...Object.fromEntries(STATS.map((k) => [k, 0])) });

/**
 * teamFiles: { TRI: file }. index: nationalIndex(). currentTeam: (id) -> team code (optional; else his last team).
 * -> { teams: { TRI: { nat: { w, l }, other: { w, l }, byNet: { ABC: { w, l }, … } } }, players: [{ id, name, team, nat, other }] }
 *    where nat/other are totals ({ gp, min, pts, … }) over the games he played. A game carried by two networks
 *    counts for each (byNet), once in nat.
 */
export function nationalSplits(teamFiles, index, { currentTeam = null } = {}) {
  const teams = {}, players = {}, aired = new Map(); // aired (0.107.1): the national games already played, so a page can mark them in a player's game list
  for (const [tri, f] of Object.entries(teamFiles)) {
    const ix = Object.fromEntries((f.keys || []).map((k, i) => [k, i]));
    const t = (teams[tri] = { nat: { w: 0, l: 0 }, other: { w: 0, l: 0 }, byNet: {} });
    for (const g of f.games || []) {
      const key = g.home ? nationalKey(g.d, g.opp, tri) : nationalKey(g.d, tri, g.opp);
      const side = index.has(key) ? "nat" : "other";
      if (side === "nat" && !aired.has(key)) aired.set(key, { d: g.d, away: g.home ? g.opp : tri, home: g.home ? tri : g.opp, networks: [...new Set(index.get(key) || [])] });
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
  return { teams, players: list, aired: [...aired.values()].sort((x, y) => x.d.localeCompare(y.d)) };
}

/** Per-game averages and percentages for a totals block. */
export function perGame(s) {
  const g = s.gp || 0, r = (x) => (g ? Math.round((x / g) * 10) / 10 : null);
  return { gp: g, min: r(s.min), pts: r(s.pts), reb: r(s.reb), ast: r(s.ast), fg3m: r(s.fg3m), stl: r(s.stl), blk: r(s.blk), tov: r(s.tov), pm: r(s.pm),
    fga: r(s.fga), fg3a: r(s.fg3a), fta: r(s.fta),
    fg3Pct: s.fg3a ? Math.round((s.fg3m / s.fg3a) * 1000) / 10 : null, ftPct: s.fta ? Math.round((s.ftm / s.fta) * 1000) / 10 : null,
    fgPct: s.fga ? Math.round((s.fgm / s.fga) * 1000) / 10 : null, tsPct: s.fga + s.fta ? Math.round((s.pts / (2 * (s.fga + 0.44 * s.fta))) * 1000) / 10 : null };
}

/**
 * Flex tracking (0.65, the user 11/14: "the national tv games that are set at the beginning of the season are subject
 * to change as the league flexes games in and out… there has to be a way to confirm ahead of time"). ESPN's scoreboard
 * lists each game's national broadcasts; read for the next three weeks every build, it confirms, adds or drops the
 * Tip-Off Guide's games. ESPN's listing as last seen is kept (history/national-tv-seen.json), so a flex is remembered
 * once the game is played and the splits count the game as it aired.
 */
const ESPN_NET = { ABC: "ABC", ESPN: "ESPN", ESPN2: "ESPN", NBC: "NBC", Peacock: "Peacock", NBCSN: "Peacock", "Prime Video": "Prime Video", "Amazon Prime Video": "Prime Video", Prime: "Prime Video" };
/** ESPN's national broadcast names -> our networks (NBA TV and radio aren't national here). */
export function espnNational(names = []) { return [...new Set(names.map((n) => ESPN_NET[String(n).trim()]).filter(Boolean))]; }

/**
 * sched: the guide's schedule. espnDays: { "YYYY-MM-DD": [{ away, home, tv: [names] }] } for the days ESPN was read.
 * seen: { key: { nets, at } } from earlier builds. today: "YYYY-MM-DD".
 * -> { games: [{ d, away, home, time, neutral, guide, espn, networks, status }], seen }
 *    status: "confirmed" (ESPN lists it, same networks), "changed" (ESPN lists other national networks), "added"
 *    (national on ESPN, not in the guide: flexed in), "dropped" (in the guide, ESPN read and lists no national
 *    network: flexed out), "guide" (not read on ESPN yet: the guide's word, subject to change).
 */
export function mergeNational(sched, espnDays = {}, seen = {}, today = null) {
  const next = { ...seen };
  for (const [d, list] of Object.entries(espnDays)) for (const g of list) next[nationalKey(d, g.away, g.home)] = { nets: espnNational(g.tv), at: today };
  const out = new Map();
  for (const g of sched?.games || []) out.set(nationalKey(g.d, g.away, g.home), { d: g.d, away: g.away, home: g.home, time: g.time || null, neutral: !!g.neutral, guide: g.networks || [] });
  for (const [k, v] of Object.entries(next)) {
    if (!v.nets.length || out.has(k)) continue;
    const [d, away, home] = k.split("|");
    out.set(k, { d, away, home, time: null, neutral: false, guide: [] });
  }
  const games = [...out.entries()].map(([k, g]) => {
    const e = next[k] ? next[k].nets : null;
    const status = e == null ? (g.guide.length ? "guide" : null) : !e.length ? (g.guide.length ? "dropped" : null)
      : !g.guide.length ? "added" : e.slice().sort().join() === g.guide.slice().sort().join() || e.every((n) => g.guide.includes(n)) ? "confirmed" : "changed";
    return status ? { ...g, espn: e, networks: e && e.length ? e : g.guide, status } : null;
  }).filter(Boolean).sort((a, b) => a.d.localeCompare(b.d) || String(a.time).localeCompare(String(b.time)));
  return { games, seen: next };
}

/** The schedule as it aired / will air: national games only (dropped ones out, added ones in), for nationalIndex. */
export const asAired = (merged) => ({ games: merged.games.filter((g) => g.status !== "dropped").map((g) => ({ d: g.d, away: g.away, home: g.home, networks: g.networks })) });
