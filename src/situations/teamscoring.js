/**
 * Points for and against a game, by team and season, as far back as the games go (0.91).
 *
 * The user (11/17) pointed to the Knicks' team statistics by season. Read alone they would be one team's table, and
 * the rule is league-wide: so every team's averages are worked out from its own games (deepSeqs, our results, this
 * season), and a guide's printed table (the Knicks', back to 1946-47) fills in the seasons before a team's games start.
 *
 *   scoringBySeason({ deep, history, rows, printed }) -> { TRI: { from, whole, seasons: [{ season, g, ppg, opp, src }] } }
 *   scoringLines(table, teams, { season })            -> "NYK is scoring 121.4 points a game (14 games): its most since 1988-89 (116.7)"
 */
export const SCORING = { games: 12, back: 15, minSeason: 40 };
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const seasonOf = (d) => { const y = Number(d.slice(0, 4)) - (Number(d.slice(5, 7)) >= 8 && !(d >= "2020-07-01" && d <= "2020-10-31") ? 0 : 1); return `${y}-${String(y + 1).slice(2)}`; };

export function scoringBySeason({ deep, history, rows, printed = null }) {
  const acc = {}, add = (t, s, pf, pa) => { const x = ((acc[t] ??= {})[s] ??= { g: 0, pf: 0, pa: 0 }); x.g++; x.pf += pf; x.pa += pa; };
  for (const [t, gs] of Object.entries(deep?.seq || {})) for (const g of gs) add(t, seasonOf(g.d), g.pf, g.pa);
  const cols = history?.columns || [], at = (k) => cols.indexOf(k);
  for (const g of history?.games || []) {
    if (g[at("type")] !== 2) continue;
    const s = seasonOf(String(g[at("date")]).slice(0, 10));
    add(g[at("home")], s, g[at("homeScore")], g[at("awayScore")]); add(g[at("away")], s, g[at("awayScore")], g[at("homeScore")]);
  }
  for (const g of rows || []) if (g.hs > 0 && g.as > 0 && !g.cupFinal) { add(g.h, seasonOf(g.d), g.hs, g.as); add(g.a, seasonOf(g.d), g.as, g.hs); }
  const out = {};
  for (const [t, by] of Object.entries(acc)) {
    const seasons = Object.entries(by).map(([season, x]) => ({ season, g: x.g, ppg: x.pf / x.g, opp: x.pa / x.g, src: "games" }));
    // A guide's table for the seasons before the games start.
    const P = printed?.[t], first = seasons.map((s) => s.season).sort()[0];
    let whole = !!deep?.whole?.[t], from = deep?.from?.[t] && deep.from[t] < first ? deep.from[t] : first;
    if (P) {
      for (const [season, o] of Object.entries(P.offense || {})) if (season < first && P.defense?.[season]) seasons.push({ season, g: o.g, ppg: o.avg, opp: P.defense[season].avg, src: "guide" });
      from = seasons.map((s) => s.season).sort()[0]; whole = whole || !!P.whole;
    }
    out[t] = { from, whole, seasons: seasons.sort((a, b) => (a.season < b.season ? -1 : 1)) };
  }
  return out;
}

/** The current season against the team's past: the most or fewest it has scored or allowed since a season at least `back` seasons ago. */
export function scoringLines(table, teams, { season }) {
  const out = [];
  for (const t of teams) {
    const T = table?.[t], cur = T?.seasons.find((s) => s.season === season);
    if (!cur || cur.g < SCORING.games) continue;
    const past = T.seasons.filter((s) => s.season < season && s.g >= SCORING.minSeason);
    for (const [key, val, hi, words] of [["ppg", (s) => s.ppg, true, "is scoring"], ["ppg", (s) => s.ppg, false, "is scoring"], ["opp", (s) => s.opp, true, "is allowing"], ["opp", (s) => s.opp, false, "is allowing"]]) {
      const v = val(cur), beat = (s) => (hi ? val(s) >= v : val(s) <= v);
      const last = [...past].reverse().find(beat), span = last ? past.filter((s) => s.season > last.season).length : past.length;
      if (span < SCORING.back) continue;
      const scope = last ? `since ${last.season} (${r1(val(last))})` : T.whole ? "in franchise history" : `since at least ${T.from}`;
      out.push({ kind: "era", team: t, key: `era|scoring|${t}|${key}|${hi ? "hi" : "lo"}`, standing: true, rare: span >= 30, score: 2.6 + Math.min(1, span / 40),
        text: `${t} ${words} ${r1(v)} points a game (${cur.g} games): its ${hi ? "most" : "fewest"} ${scope}` });
    }
  }
  return out;
}
