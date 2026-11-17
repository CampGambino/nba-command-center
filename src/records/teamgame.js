/**
 * Each team's single-game marks from its own games (0.90): most and fewest points, most and fewest allowed, largest
 * win and loss, as far back as the games can be trusted (deepSeqs), with this season on top.
 *
 * The guides print these too, each in its own layout; the box-score ones (rebounds, assists, threes in a game) are
 * not read. What can be counted from scores is counted here for all 30 teams and says its window.
 *
 *   teamGameRecords({ deep, history, rows }) -> { TRI: { window: { from, whole }, marks: { most, fewest, allowed, held, win, loss } } }
 *       a mark: { v, d, opp, score, prev: the mark before it | null }
 *   recordLines(records, since, today)       -> lines for marks set or tied on or after `since`
 */
import { TEAMS } from "../teams.js";

export const SANE = { low: 30, high: 200 };
const nick = (t) => TEAMS[t]?.nick || t;
const mdy = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}/${d.slice(2, 4)}`;
const KINDS = {
  most: [(g) => g.pf, 1, "the most points in a game"], fewest: [(g) => g.pf, -1, "the fewest points in a game"],
  allowed: [(g) => g.pa, 1, "the most points allowed in a game"], held: [(g) => g.pa, -1, "the fewest points allowed in a game"],
  win: [(g) => g.pf - g.pa, 1, "the largest win"], loss: [(g) => g.pa - g.pf, 1, "the largest loss"],
};

export function teamGameRecords({ deep, history, rows }) {
  const seq = {}, put = (t, d, pf, pa, opp) => { if (t && Math.min(pf, pa) >= SANE.low && Math.max(pf, pa) <= SANE.high) (seq[t] ??= []).push({ d, pf, pa, opp }); };
  for (const [t, gs] of Object.entries(deep?.seq || {})) for (const g of gs) put(t, g.d, g.pf, g.pa, g.opp);
  const cols = history?.columns || [], at = (k) => cols.indexOf(k);
  for (const g of history?.games || []) {
    if (g[at("type")] !== 2) continue;
    const d = String(g[at("date")]).slice(0, 10);
    put(g[at("home")], d, g[at("homeScore")], g[at("awayScore")], g[at("away")]); put(g[at("away")], d, g[at("awayScore")], g[at("homeScore")], g[at("home")]);
  }
  for (const g of rows || []) if (g.hs > 0 && g.as > 0) { put(g.h, g.d, g.hs, g.as, g.a); put(g.a, g.d, g.as, g.hs, g.h); }
  const out = {};
  for (const [t, gs] of Object.entries(seq)) {
    gs.sort((a, b) => (a.d < b.d ? -1 : 1));
    const marks = {};
    for (const [k, [val, sign]] of Object.entries(KINDS)) {
      let best = null, prev = null;
      for (const g of gs) {
        const v = val(g);
        if (best === null || sign * v > sign * best.v) { prev = best; best = { v, d: g.d, opp: g.opp, score: `${Math.max(g.pf, g.pa)}-${Math.min(g.pf, g.pa)}` }; }
        else if (v === best.v && g.d !== best.d) { prev = best; best = { v, d: g.d, opp: g.opp, score: `${Math.max(g.pf, g.pa)}-${Math.min(g.pf, g.pa)}`, tied: true }; }
      }
      if (best) marks[k] = { ...best, prev: prev ? { v: prev.v, d: prev.d, opp: prev.opp } : null };
    }
    out[t] = { window: { from: deep?.from?.[t] || null, whole: !!deep?.whole?.[t] }, games: gs.length, marks };
  }
  return out;
}

/** A team mark set or tied on or after `since`: "DEN scored 163 on 11/16: the most points in a game in franchise history (was 161, 3/2/90)". */
export function recordLines(records, since, today = null) {
  const out = [];
  for (const [t, r] of Object.entries(records || {})) for (const [k, m] of Object.entries(r.marks)) {
    if (m.d < since || (today && m.d >= today) || !m.prev || r.games < 400) continue;
    const scope = r.window.whole ? "in franchise history" : r.window.from ? `since at least ${r.window.from}` : "";
    const did = k === "most" || k === "fewest" ? `scored ${m.v}` : k === "allowed" || k === "held" ? `allowed ${m.v}` : k === "win" ? `won by ${m.v}` : `lost by ${m.v}`;
    out.push({ kind: "unique", team: t, player: null, date: m.d, key: `teamgame|${t}|${k}`, score: 4.2 + (r.window.whole ? 0.4 : 0),
      text: `${t} ${did} on ${mdy(m.d).replace(/\/\d\d$/, "")} (${m.score}${m.opp ? `, ${m.opp}` : ""}): ${m.tied ? KINDS[k][2].replace(/^the /, "tied for the ") : KINDS[k][2]} ${scope} for the ${nick(t)} (${m.tied ? "also" : "was"} ${m.prev.v}, ${mdy(m.prev.d)})`.replace(/\s+/g, " ") });
  }
  return out.sort((a, b) => b.score - a.score);
}
