/**
 * Team streak watch (0.65, the user 11/14): what tonight's game would make of a team's current run, with the history
 * behind it, before it happens.
 *
 *   "OKC loses 3-straight games for the first time since the 2023-24 season" (flagged by an account after the game):
 *     → before it: "OKC has lost 2 straight: a loss tonight would be its first 3-game losing streak since 2023-24".
 *   "The Pelicans have allowed 135+ in four straight; the third team in NBA history":
 *     → after two or three: "NOP has allowed 135+ in 3 straight; since 2016-17 one team has done it 4 straight (DAL, 2025-26)".
 *
 * The history is the ESPN back-fill (src/data/nba-results-history.json, regular season, 2016-17 on) plus this season's
 * results store, so every "since" and count is within that window and says so.
 */
export const WINDOW = "2016-17";
const GAP_GAMES = 150; // a W/L run is news when the team hasn't had one that long in about two seasons of games (0.69:
                       // "first 6-game winning streak since March 2025" is recent enough not to need an alert)

export const seasonOf = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return m >= 8 ? `${y}-${String((y + 1) % 100).padStart(2, "0")}` : `${y - 1}-${String(y % 100).padStart(2, "0")}`; };
const MON = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const monthYear = (d) => `${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;

/** Each team's games in order: { d, pf, pa, opp }. History rows are [date, home, away, homeScore, awayScore, type]. */
export function teamSeqs(history, rows) {
  const seq = {};
  const add = (t, g) => (seq[t] ??= []).push(g);
  const seen = new Set();
  for (const r of history?.games || []) {
    if (r[5] !== 2) continue; // regular season (the Cup's group games included)
    add(r[1], { d: r[0], pf: r[3], pa: r[4], opp: r[2] });
    add(r[2], { d: r[0], pf: r[4], pa: r[3], opp: r[1] });
    seen.add(`${r[0]}|${r[1]}|${r[2]}`);
  }
  for (const g of rows || []) {
    if (g.hs == null || g.as == null || seen.has(`${g.d}|${g.h}|${g.a}`)) continue;
    add(g.h, { d: g.d, pf: g.hs, pa: g.as, opp: g.a });
    add(g.a, { d: g.d, pf: g.as, pa: g.hs, opp: g.h });
  }
  for (const s of Object.values(seq)) s.sort((a, b) => a.d.localeCompare(b.d));
  return seq;
}

/** Maximal runs of games meeting `test`: [{ start, end, n }] (indexes into the team's games). */
function runs(games, test) {
  const out = [];
  let s = -1;
  games.forEach((g, i) => {
    if (test(g)) { if (s < 0) s = i; }
    else if (s >= 0) { out.push({ start: s, end: i - 1, n: i - s }); s = -1; }
  });
  if (s >= 0) out.push({ start: s, end: games.length - 1, n: games.length - s });
  return out;
}

// Scoring and allowing runs worth a line: the highest bar he's on a 2+ run of, if few teams have gone one game further.
const BARS = [
  ...[150, 145, 140, 135, 130].map((x) => ({ key: `pa${x}`, fam: "pa", test: (g) => g.pa >= x, say: `allowed ${x}+` })),
  ...[150, 145, 140, 135, 130].map((x) => ({ key: `pf${x}`, fam: "pf", test: (g) => g.pf >= x, say: `scored ${x}+` })),
  ...[85, 90, 95].map((x) => ({ key: `held${x}`, fam: "held", test: (g) => g.pa < x, say: `held opponents under ${x}` })),
  ...[85, 90, 95].map((x) => ({ key: `low${x}`, fam: "low", test: (g) => g.pf < x, say: `scored under ${x}` })),
];
const RARE = 3; // at most this many team runs as long as tonight's would be, since 2016-17

/**
 * Lines for each team (all 30; the storylines keep tonight's).
 * -> [{ team, kind: "teamwatch", stat, n, text, score, then: { n, teams: [{ team, season }] } }]
 */
export function streakWatch({ history = null, rows = [], today = null } = {}) {
  const seq = teamSeqs(history, rows);
  const out = [];
  // League-wide runs for every bar, once.
  const league = {};
  for (const b of BARS) {
    league[b.key] = [];
    for (const [t, games] of Object.entries(seq)) for (const r of runs(games, b.test)) league[b.key].push({ team: t, n: r.n, end: games[r.end].d, current: r.end === games.length - 1 });
  }
  for (const [team, games] of Object.entries(seq)) {
    if (!games.length) continue;
    const last = games[games.length - 1];
    if (today && seasonOf(last.d) !== seasonOf(today)) continue;
    // 1. Wins and losses.
    const won = last.pf > last.pa;
    const wl = runs(games, (g) => (g.pf > g.pa) === won);
    const cur = wl[wl.length - 1];
    if (cur && cur.end === games.length - 1) {
      const want = cur.n + 1;
      const prior = wl.slice(0, -1).filter((r) => r.n >= want).pop();
      const gap = prior ? cur.start - prior.end : Infinity;
      if (want >= 3 && gap >= GAP_GAMES) {
        const what = `${want}-game ${won ? "winning" : "losing"} streak`;
        const since = prior ? `since ${seasonOf(games[prior.end].d)} (${monthYear(games[prior.end].d)})` : `since at least ${WINDOW}`;
        out.push({ team, kind: "teamwatch", stat: won ? "W" : "L", n: cur.n,
          text: `${team} has ${won ? "won" : "lost"} ${cur.n} straight: a ${won ? "win" : "loss"} tonight would be its first ${what} ${since}`,
          score: 3 + Math.min(1.5, (prior ? gap / GAP_GAMES : 4) * 0.35) });
      }
    }
    // 2. Scoring and allowing: per family, the bar whose run is rarest one game further (then the longest run).
    for (const fam of ["pa", "pf", "held", "low"]) {
      let best = null;
      for (const b of BARS.filter((x) => x.fam === fam)) {
        const r = runs(games, b.test).pop();
        if (!r || r.end !== games.length - 1 || r.n < 2) continue;
        const others = league[b.key].filter((x) => !(x.team === team && x.current));
        const atN = others.filter((x) => x.n >= r.n), atNext = others.filter((x) => x.n >= r.n + 1);
        if (atNext.length > RARE) continue;
        if (!best || atNext.length < best.atNext.length || (atNext.length === best.atNext.length && r.n > best.r.n)) best = { b, r, atN, atNext };
      }
      if (!best) continue;
      const { b, r, atN, atNext } = best;
      const name = (list) => list.slice(-3).map((x) => `${x.team} ${seasonOf(x.end)}`).join(", ");
      const n1 = r.n + 1;
      const head = atN.length === 0 ? `no other team has done it since ${WINDOW}`
        : `${atN.length === 1 ? "one other team" : `${atN.length} other teams`} since ${WINDOW}${atN.length <= 3 ? ` (${name(atN)})` : ""}`;
      const tail = atN.length === 0 ? "" : atNext.length === atN.length ? "" : atNext.length ? `; only ${name(atNext)} went ${n1}+` : `; none went ${n1}`;
      out.push({ team, kind: "teamwatch", stat: b.key, n: r.n,
        text: `${team} has ${b.say} in ${r.n} straight: ${head}${tail}`,
        score: 3.2 + (atNext.length === 0 ? 0.8 : 0) + (atN.length <= 1 ? 0.4 : 0), then: { n: n1, teams: atNext.map((x) => ({ team: x.team, season: seasonOf(x.end) })) } });
    }
  }
  return out;
}
