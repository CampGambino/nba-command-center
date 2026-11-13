/**
 * Rest and back-to-backs (moved from NBA GameFlow, 11/13), for teams and, new, for players (the user: "extend that to
 * player performance to catch any outliers"). Pure and browser-safe.
 *
 * Rest = calendar days between a team's games minus one, in Eastern dates (the league's scheduling day), so the second game
 * of a back-to-back is 0. 3+ days is one bucket. A season opener has no previous game: no measurement, in no bucket.
 * GameFlow's rules, kept: records count decided games; shooting is makes over attempts; possessions FGA - OREB + TOV + 0.44 FTA;
 * "zero minus the rest" compares the back-to-backs with every other bucket pooled (not the season, which contains them).
 *
 *   restData({ games, teamFiles, tonight }) -> { buckets, league: { own, opp }, teams, facing, players, tonight, bothTired, openers }
 *     games:     results rows (docs/data/games.json: { d, h, a, hs, as, hb, ab })
 *     teamFiles: { TRI: team file } for the player splits
 *     tonight:   [{ home, away }] tonight's games, with today's date as `today`
 */
export const BUCKETS = [0, 1, 2, 3];
export const LABEL = { 0: "0 (back-to-back)", 1: "1 day", 2: "2 days", 3: "3+ days" };
export const PLAYER_MIN_B2B = 2, PLAYER_MIN_REST = 4, PLAYER_MIN_MIN = 20, PLAYER_GAP = 4, PLAYER_REL = 0.2;
const B = { fgm: 0, fga: 1, fg3m: 2, fg3a: 3, ftm: 4, fta: 5, oreb: 6, tov: 11 };
const dayNum = (d) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5);
export const bucket = (r) => (r == null ? null : r >= 3 ? 3 : r);

/** { "TRI|date": days of rest } from every team's schedule. */
export function restIndex(games) {
  const by = {};
  for (const g of games) for (const t of [g.h, g.a]) (by[t] ??= new Set()).add(g.d);
  const idx = {};
  for (const [t, set] of Object.entries(by)) {
    let prev = null;
    for (const d of [...set].sort()) { idx[`${t}|${d}`] = prev == null ? null : Math.max(0, dayNum(d) - dayNum(prev) - 1); prev = d; }
  }
  return idx;
}

export function stats(list) {
  const a = { n: 0, w: 0, l: 0, pf: 0, pa: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, tov: 0, poss: 0 };
  for (const r of list) {
    a.n++; if (r.pts !== r.oppPts) { if (r.pts > r.oppPts) a.w++; else a.l++; }
    a.pf += r.pts; a.pa += r.oppPts; a.fgm += r.fgm; a.fga += r.fga; a.tpm += r.tpm; a.tpa += r.tpa; a.tov += r.tov; a.poss += r.poss;
  }
  const n = a.n || null;
  return { n: a.n, w: a.w, l: a.l, ppg: n && a.pf / n, oppg: n && a.pa / n, marg: n && (a.pf - a.pa) / n, fg: a.fga ? (100 * a.fgm) / a.fga : null,
    tp: a.tpa ? (100 * a.tpm) / a.tpa : null, topg: n && a.tov / n, pace: n && a.poss / n, pct: a.w + a.l ? a.w / (a.w + a.l) : null };
}

/** One row per team per game. */
export function teamRows(games) {
  const idx = restIndex(games), out = [];
  for (const g of games) {
    if (!g.hb || !g.ab) continue;
    for (const side of [0, 1]) {
      const tri = side ? g.h : g.a, opp = side ? g.a : g.h, b = side ? g.hb : g.ab;
      const rest = idx[`${tri}|${g.d}`] ?? null, oppRest = idx[`${opp}|${g.d}`] ?? null;
      out.push({ tri, opp, d: g.d, pts: side ? g.hs : g.as, oppPts: side ? g.as : g.hs, fgm: b[B.fgm], fga: b[B.fga], tpm: b[B.fg3m], tpa: b[B.fg3a], tov: b[B.tov],
        poss: b[B.fga] - b[B.oreb] + b[B.tov] + 0.44 * b[B.fta], rest, oppRest, ob: bucket(rest), pb: bucket(oppRest) });
    }
  }
  return out;
}

const diff = (a, b, k) => (a[k] != null && b[k] != null ? a[k] - b[k] : null);

export function restData({ games = [], teamFiles = {}, tonight = [], today = null }) {
  const rows = teamRows(games);
  const ladder = (key) => {
    const seen = rows.filter((r) => r[key] != null);
    const by = Object.fromEntries(BUCKETS.map((b) => [b, stats(seen.filter((r) => r[key] === b))]));
    const zero = by[0], rest = stats(seen.filter((r) => r[key] > 0));
    return { by, zero, rest, delta: Object.fromEntries(["pct", "ppg", "oppg", "marg", "fg", "tp", "topg", "pace"].map((k) => [k, diff(zero, rest, k)])) };
  };
  const tris = [...new Set(rows.map((r) => r.tri))].sort();
  const teams = tris.map((tri) => {
    const mine = rows.filter((r) => r.tri === tri && r.ob != null);
    const by = Object.fromEntries(BUCKETS.map((b) => [b, stats(mine.filter((r) => r.ob === b))]));
    const rest = stats(mine.filter((r) => r.ob > 0));
    return { tri, by, rest, gap: diff(by[0], rest, "marg") };
  });
  const facing = tris.map((tri) => {
    const mine = rows.filter((r) => r.tri === tri && r.pb != null);
    const vs = stats(mine.filter((r) => r.pb === 0)), other = stats(mine.filter((r) => r.pb > 0));
    return { tri, vs, other, gap: diff(vs, other, "marg") };
  });

  // Players: his games on the second night of a back-to-back against his other games (rest known), points and minutes.
  const idx = restIndex(games);
  const players = [];
  for (const [tri, f] of Object.entries(teamFiles)) {
    const ix = Object.fromEntries((f.keys || []).map((k, i) => [k, i]));
    const lines = {};
    for (const g of f.games || []) {
      const r = idx[`${tri}|${g.d}`];
      if (r == null) continue;
      for (const [id, row] of Object.entries(g.pl || {})) {
        if (!(row[ix.min] > 0)) continue;
        (lines[id] ??= []).push({ b2b: r === 0, pts: row[ix.pts] || 0, min: row[ix.min] || 0, fgm: row[ix.fgm] || 0, fga: row[ix.fga] || 0, reb: row[ix.reb] || 0, ast: row[ix.ast] || 0 });
      }
    }
    for (const [id, L] of Object.entries(lines)) {
      const z = L.filter((x) => x.b2b), o = L.filter((x) => !x.b2b);
      if (z.length < PLAYER_MIN_B2B || o.length < PLAYER_MIN_REST) continue;
      const avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
      const fg = (a) => { const t = a.reduce((s, x) => s + x.fga, 0); return t ? (100 * a.reduce((s, x) => s + x.fgm, 0)) / t : null; };
      const p = { id, name: f.names?.[id] || id, tri, b2bGp: z.length, restGp: o.length,
        b2b: { pts: avg(z, "pts"), min: avg(z, "min"), reb: avg(z, "reb"), ast: avg(z, "ast"), fg: fg(z) }, rest: { pts: avg(o, "pts"), min: avg(o, "min"), reb: avg(o, "reb"), ast: avg(o, "ast"), fg: fg(o) } };
      p.gap = p.b2b.pts - p.rest.pts;
      p.minGap = p.b2b.min - p.rest.min;
      // An outlier: a regular (20+ minutes rested) whose scoring moves 4+ points and 20%+ on no rest.
      p.flag = p.rest.min >= PLAYER_MIN_MIN && Math.abs(p.gap) >= PLAYER_GAP && Math.abs(p.gap) >= PLAYER_REL * p.rest.pts;
      players.push(p);
    }
  }
  players.sort((a, b) => a.gap - b.gap || a.name.localeCompare(b.name));

  // Tonight: each team's rest, from its last game before today.
  const last = {};
  for (const g of games) for (const t of [g.h, g.a]) if (!today || g.d < today) last[t] = !last[t] || g.d > last[t] ? g.d : last[t];
  const restOf = (t) => (today && last[t] ? Math.max(0, dayNum(today) - dayNum(last[t]) - 1) : null);
  const tn = tonight.map((g) => ({ home: g.home, away: g.away, homeRest: restOf(g.home), awayRest: restOf(g.away) }));

  return { buckets: BUCKETS, labels: LABEL, league: { own: ladder("ob"), opp: ladder("pb") }, teams, facing, players, tonight: tn, today,
    bothTired: rows.filter((r) => r.ob === 0 && r.pb === 0).length / 2, openers: rows.filter((r) => r.ob == null).length, b2bGames: rows.filter((r) => r.ob === 0).length };
}
