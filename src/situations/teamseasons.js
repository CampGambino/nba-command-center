/**
 * Team history from every franchise's season records, 1946-47 on (0.80).
 *
 * The data is src/data/nba-team-seasons-<season>.json (tools/build-team-seasons.py: the NBA Guide's standings for
 * each season, checked against the Tip-Off Guide's all-time records). Two things are read from it, for every team:
 *
 *   since   A team's record since a given season, ranked against the league ("the Clippers have the NBA's
 *           fifth-best record since 2011-12"). Every start season back to SINCE.back is tried, and the longest
 *           span in which the team is in the top or bottom SINCE.top is the one that is said.
 *   pace    This season's winning percentage against the franchise's own best and worst seasons, from PACE.games on.
 *
 * Both are standing lines: nothing about them can change during tonight's game.
 */
export const SINCE = { back: 2004, minSeasons: 3, top: 3 };   // 2004-05: the first season with today's 30 franchises
export const PACE = { games: 12, minSeason: 50 };

const ord = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;
const startYear = (s) => +String(s).slice(0, 4);
const pct = (w, l) => (w + l ? w / (w + l) : 0);

/** Every team's record from season `from` (start year) through now. `now` is { TRI: { w, l } } for this season. */
export function sinceTable(teams, now, from) {
  const rows = Object.keys(teams).map((tri) => {
    let w = now?.[tri]?.w || 0, l = now?.[tri]?.l || 0;
    for (const [s, sw, sl] of teams[tri]) if (startYear(s) >= from) { w += sw; l += sl; }
    return { tri, w, l, pct: pct(w, l) };
  }).sort((a, b) => b.pct - a.pct || b.w - a.w);
  rows.forEach((r, i) => { r.rank = i && rows[i - 1].pct === r.pct ? rows[i - 1].rank : i + 1; });
  return rows;
}

/** Lines for tonight's teams. `S` is the standings ({ East, West }), `season` this season's start year. */
export function teamSeasonLines(data, S, teams, { season }) {
  const T = data?.teams;
  if (!T || !S) return [];
  const now = {};
  for (const conf of ["East", "West"]) for (const t of S[conf] || []) now[t.tri] = { w: t.w, l: t.l };
  const out = [], n = Object.keys(T).length;
  // since: the earliest start season that still puts the team in the top or bottom few.
  const best = {};
  for (let from = SINCE.back; from <= season - SINCE.minSeasons; from++) {
    const tab = sinceTable(T, now, from);
    for (const r of tab) {
      if (best[r.tri]) continue;
      const side = r.rank <= SINCE.top ? "best" : r.rank > n - SINCE.top ? "worst" : null;
      if (side) best[r.tri] = { from, side, r, lead: side === "best" ? tab[0] : tab[tab.length - 1] };
    }
  }
  for (const tri of teams) {
    const b = best[tri];
    if (b) {
      const place = b.side === "best" ? b.r.rank : n + 1 - b.r.rank, tag = `${b.from}-${String(b.from + 1).slice(2)}`;
      out.push({ kind: "era", team: tri, key: `era|since|${tri}|${b.side}`, standing: true, rare: place === 1 && season - b.from >= 10, score: 2.8 + (4 - place) * 0.2 + Math.min(0.6, (season - b.from) * 0.04),
        text: `${tri} has the NBA's ${place === 1 ? "" : `${ord(place)}-`}${b.side} record since ${tag} (${b.r.w}-${b.r.l})${place === 1 ? "" : `; ${b.lead.tri} is ${b.side === "best" ? "first" : "last"} at ${b.lead.w}-${b.lead.l}`}` });
    }
    const cur = now[tri], hist = (T[tri] || []).filter(([, w, l]) => w + l >= PACE.minSeason);
    if (!cur || cur.w + cur.l < PACE.games || hist.length < 10) continue;
    const p = pct(cur.w, cur.l), top = hist.reduce((a, x) => (pct(x[1], x[2]) > pct(a[1], a[2]) ? x : a)), low = hist.reduce((a, x) => (pct(x[1], x[2]) < pct(a[1], a[2]) ? x : a));
    const on = Math.round(p * 82);
    if (p > pct(top[1], top[2])) out.push({ kind: "era", team: tri, key: `era|pace|${tri}|best`, standing: true, rare: cur.w + cur.l >= 30, score: 3.3,
      text: `${tri} (${cur.w}-${cur.l}) is on pace for ${on}-${82 - on}; the best season in franchise history is ${top[1]}-${top[2]} (${top[0]})` });
    else if (p < pct(low[1], low[2])) out.push({ kind: "era", team: tri, key: `era|pace|${tri}|worst`, standing: true, rare: cur.w + cur.l >= 30, score: 3.3,
      text: `${tri} (${cur.w}-${cur.l}) is on pace for ${on}-${82 - on}; the worst season in franchise history is ${low[1]}-${low[2]} (${low[0]})` });
  }
  return out;
}
