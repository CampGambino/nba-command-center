/**
 * Each team's games before the main back-fill, as far back as they can be trusted (0.86).
 *
 * The user, 11/17, on lines ending "since at least 2016-17": "I think these can be more accurate now that the full
 * season game-by-game records are mostly known."
 *
 * Two sources reach behind 2016-17:
 *   older   ESPN's regular-season results, 1993-94 to 2015-16 (src/data/nba-results-older.json.gz), all teams
 *   guide   every game four team media guides list season by season (src/data/guide-games-2026-27.json.gz):
 *           the Lakers from 1948-49, Golden State from 1962-63, Milwaukee from 1968-69, Washington from 1961-62
 *
 * A season is used only if its wins and losses equal the franchise's record (src/data/nba-team-seasons-2026-27.json),
 * from either source, ESPN first. A team's games then start at the earliest season from which every season since is
 * right: one bad season (ESPN's 1999-00, the Bucks' missing 1969-70) is where "since at least" has to stop.
 *
 *   deepSeqs({ older, guide, official }) -> { seq: { TRI: [{ d, pf, pa, opp }] }, from: { TRI: "2000-01" },
 *                                             whole: { TRI: true|false }, league: "2000-01" }
 * `whole`: the games reach the franchise's first season, so "in franchise history" can be said.
 * `league`: the season from which every team is covered (or did not exist yet): the window for league-wide counts.
 */
import { seasonOf } from "./streakwatch.js";

const END = "2016-17"; // the main back-fill starts here

export function deepSeqs({ older = null, guide = null, official = null } = {}) {
  const out = { seq: {}, from: {}, whole: {}, league: END };
  if (!official) return out;
  const cand = {}; // team -> season -> [[games from ESPN], [games from the guide]]
  const put = (t, s, k, g) => ((((cand[t] ??= {})[s] ??= [[], []])[k]).push(g));
  for (const [d, h, a, hs, as] of older?.games || []) {
    const s = seasonOf(d);
    if (s >= END) continue;
    put(h, s, 0, { d, pf: hs, pa: as, opp: a }); put(a, s, 0, { d, pf: as, pa: hs, opp: h });
  }
  // A guide's result is settled by its running record; where the printed score says the opposite (a misprint or the
  // two numbers in the other order, a handful of games) the score is turned to agree with the result.
  for (const [t, gs] of Object.entries(guide?.teams || {})) for (const [d, , opp, , won, pf0, pa0] of gs) {
    const s = seasonOf(d);
    if (s >= END) continue;
    let pf = pf0, pa = pa0;
    if (!!won !== pf > pa) { [pf, pa] = [pa, pf]; if (pf === pa) { if (won) pf++; else pa++; } }
    put(t, s, 1, { d, pf, pa, opp });
  }
  // A game ESPN lacks may be in one of the four guides' lists (it is the other team's game too). Where a team's ESPN
  // season does not add up on its own, it is tried again with such games added: this mends 1999-00 for the teams
  // whose missing games were against those four.
  const extra = {};
  const have = new Set((older?.games || []).map(([d, h, a]) => `${d}|${[h, a].sort().join("|")}`));
  const first = (older?.games || []).length ? seasonOf(older.games[0][0]) : END;
  for (const [t, gs] of Object.entries(guide?.teams || {})) for (const [d, , opp, , won, pf0, pa0] of gs) {
    const s = seasonOf(d), k = `${d}|${[t, opp].sort().join("|")}`;
    if (!opp || s < first || s >= END || have.has(k)) continue;
    // A day either side is the same game filed under another time zone's date.
    const near = [-1, 1].some((o) => have.has(`${new Date(Date.parse(d) + o * 864e5).toISOString().slice(0, 10)}|${[t, opp].sort().join("|")}`));
    if (near) continue;
    have.add(k);
    let pf = pf0, pa = pa0;
    if (!!won !== pf > pa) { [pf, pa] = [pa, pf]; if (pf === pa) { if (won) pf++; else pa++; } }
    (((extra[t] ??= {})[s] ??= [])).push({ d, pf, pa, opp }); (((extra[opp] ??= {})[s] ??= [])).push({ d, pf: pa, pa: pf, opp: t });
  }
  for (const [t, rows] of Object.entries(official)) {
    const record = Object.fromEntries(rows.map(([s, w, l]) => [s, [w, l]]));
    const seasons = rows.map((r) => r[0]).filter((s) => s < END).sort().reverse(); // newest first
    const good = [];
    for (const s of seasons) {
      const [espn = [], own = []] = cand[t]?.[s] || [];
      const pick = [espn, own, extra[t]?.[s] ? [...espn, ...extra[t][s]] : []].find((gs) => gs.length && gs.filter((g) => g.pf > g.pa).length === record[s][0] && gs.filter((g) => g.pf < g.pa).length === record[s][1] && gs.length === record[s][0] + record[s][1]);
      if (!pick) break;
      good.push([s, pick]);
    }
    if (!good.length) { out.from[t] = END; out.whole[t] = rows.every((r) => r[0] >= END); continue; }
    out.seq[t] = good.reverse().flatMap(([, gs]) => [...gs].sort((x, y) => x.d.localeCompare(y.d)));
    out.from[t] = good[0][0];
    out.whole[t] = good[0][0] === rows[0][0];
  }
  // League-wide counts need every team that existed: the latest start among teams whose history is not whole.
  const cut = Object.keys(out.from).filter((t) => !out.whole[t]).map((t) => out.from[t]).sort().pop();
  out.league = cut || Object.values(out.from).sort()[0] || END;
  return out;
}
