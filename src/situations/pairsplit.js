/**
 * One player with and without another (moved from NBA GameFlow, 11/13). Pure, browser-safe.
 *
 * Any two players in the league:
 *   - teammates: A's games split by whether B played. GameFlow's rules: the denominator is A's own games; games when the two
 *     were not on the same roster (before or after a trade) are set aside, neither "with" nor "without". "On the roster that
 *     night" also counts the injury report (the Command Center's rule, src/situations/withwithout.js), so a teammate who sat
 *     the opening games injured counts as "without", not "before he joined".
 *   - opponents (new): A's games against B's team, split by whether B played in them ("Brunson vs MIL with and without Giannis").
 *
 * teamFiles: { TRI: { team, keys, names, games: [{ d, opp, home, pf, pa, pl: { id: [..keys] }, inj?: { id: status } }] } }
 */
export const LINE = ["min", "pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "pm"];

function gamesOf(teamFiles, id) {
  const out = [];
  for (const [tri, f] of Object.entries(teamFiles || {})) {
    const ix = Object.fromEntries((f.keys || []).map((k, i) => [k, i]));
    for (const g of f.games || []) {
      const row = g.pl?.[id];
      if (row && row[ix.min] > 0) out.push({ tri, g, line: Object.fromEntries(LINE.map((k) => [k, row[ix[k]] || 0])) });
    }
  }
  return out.sort((a, b) => a.g.d.localeCompare(b.g.d));
}
const played = (f, g, id) => { const ix = (f.keys || []).indexOf("min"); return !!(g.pl?.[id] && g.pl[id][ix] > 0); };
const present = (g, id) => !!(g.pl && id in g.pl) || !!(g.inj && id in g.inj);

export function sum(list) {
  const t = { n: list.length, ...Object.fromEntries(LINE.map((k) => [k, 0])) };
  for (const x of list) for (const k of LINE) t[k] += x.line[k];
  const per = (k) => (t.n ? t[k] / t.n : null), pct = (m, a) => (t[a] ? (100 * t[m]) / t[a] : null);
  return { ...t, avg: Object.fromEntries(LINE.map((k) => [k, per(k)])), fg: pct("fgm", "fga"), tp: pct("fg3m", "fg3a"), ft: pct("ftm", "fta") };
}

/** -> { mode: "teammates" | "opponents" | "none", with: sum, without: sum, apart, games: { with: [...], without: [...] } } */
export function pairSplit(teamFiles, aId, bId) {
  aId = String(aId); bId = String(bId);
  const mine = gamesOf(teamFiles, aId);
  const withB = [], withoutB = [], apart = [], vsWith = [], vsWithout = [];
  // B's team on each date (the team file B is listed in, or on whose injury report he is).
  const bTeam = {};
  for (const [tri, f] of Object.entries(teamFiles || {})) for (const g of f.games || []) if (present(g, bId)) bTeam[g.d] = { tri, f, g };
  for (const x of mine) {
    const b = bTeam[x.g.d];
    if (b && b.tri === x.tri) (played(b.f, b.g, bId) ? withB : withoutB).push(x);
    else if (b && b.tri === x.g.opp) (played(b.f, b.g, bId) ? vsWith : vsWithout).push(x);
    else apart.push(x);
  }
  const teammates = withB.length + withoutB.length > 0;
  const opponents = vsWith.length + vsWithout.length > 0;
  const mode = teammates ? "teammates" : opponents ? "opponents" : "none";
  const W = teammates ? withB : vsWith, WO = teammates ? withoutB : vsWithout;
  const view = (x) => ({ d: x.g.d, opp: x.g.opp, home: !!x.g.home, tri: x.tri, win: x.g.pf > x.g.pa, ...x.line });
  return { mode, with: sum(W), without: sum(WO), apart: apart.length + (teammates ? vsWith.length + vsWithout.length : 0), total: mine.length,
    games: { with: W.map(view), without: WO.map(view) } };
}

/** Everyone in the league with a game played: [{ id, name, tri (latest), gp }] by name. */
export function everyone(teamFiles) {
  const p = {};
  for (const [tri, f] of Object.entries(teamFiles || {})) {
    const ix = (f.keys || []).indexOf("min");
    for (const g of f.games || []) for (const [id, row] of Object.entries(g.pl || {})) {
      if (!(row[ix] > 0)) continue;
      const x = (p[id] ??= { id, name: f.names?.[id] || id, tri, last: "", gp: 0 });
      x.gp++; if (g.d >= x.last) { x.last = g.d; x.tri = tri; }
    }
  }
  return Object.values(p).map(({ last, ...x }) => x).sort((a, b) => a.name.localeCompare(b.name));
}
