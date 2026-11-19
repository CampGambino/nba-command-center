/**
 * Standings and magic numbers (0.80; the user, 11/16: "it would be great to know the magic number for a team to
 * clinch ahead of time as they get close").
 *
 * Standings: each conference in order, with the splits the league prints (conference, division, home, road, last
 * ten, streak). Teams with the same record are put in order by the first rungs of the league's two-team tie-break
 * that the results alone can decide: head-to-head, then conference record, then point differential.
 *
 * Magic number of A over B: the number of A wins plus B losses after which B can no longer finish ahead of A.
 *   B's best finish is GAMES - B's losses wins. A is safely ahead once A's wins exceed that, or equal it while A
 *   holds the tie-break. The tie-break is credited only when it is already decided: A has won the season series
 *   (three wins, the most a series of four can need). So a number here is never too small: a team may clinch a
 *   game sooner on a tie-break the results don't yet decide, never later.
 * A's number for a place is the number that puts A ahead of enough teams: 9 for a playoff berth (top 6), 5 for at
 * least the Play-In (top 10), 14 for the conference's best record, 4 for the division.
 * Elimination numbers are the same sum from the other side: enough teams safely ahead of A.
 *
 * Pure. rows: the results store's regular-season games ({ d, h, a, hs, as, n? }).
 */
import { DIVISIONS } from "./records.js";

export const GAMES = 82;
const DIV_OF = Object.fromEntries(Object.entries(DIVISIONS).flatMap(([d, ts]) => ts.map((t) => [t, d])));
const EAST = new Set(["Atlantic", "Central", "Southeast"]);
export const confOf = (tri) => (DIV_OF[tri] ? (EAST.has(DIV_OF[tri]) ? "East" : "West") : null);
const rec = () => ({ w: 0, l: 0 });
const pct = (r) => (r.w + r.l ? r.w / (r.w + r.l) : 0);

/**
 * The NBA Cup's title game. ESPN files it with the regular season, but it counts in no one's record. It is the one
 * neutral-site game in December whose two teams both played another neutral-site game in the four days before it
 * (the semifinals, which do count).
 */
export function cupFinal(rows) {
  const dec = rows.filter((g) => g.n && g.d.slice(5, 7) === "12");
  const days = (a, b) => (Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 864e5;
  const semi = (tri, g) => dec.some((x) => x !== g && (x.h === tri || x.a === tri) && days(g.d, x.d) > 0 && days(g.d, x.d) <= 4);
  return dec.find((g) => semi(g.h, g) && semi(g.a, g)) || null;
}

export function standings(rows, { games = GAMES } = {}) {
  const T = {};
  const team = (tri) => (T[tri] ??= { tri, conf: confOf(tri), div: DIV_OF[tri], w: 0, l: 0, confRec: rec(), divRec: rec(), home: rec(), road: rec(), pf: 0, pa: 0, log: [], vs: {} });
  for (const tri of Object.keys(DIV_OF)) team(tri);
  const cup = cupFinal(rows);
  for (const g of [...rows].sort((a, b) => a.d.localeCompare(b.d))) {
    if (!DIV_OF[g.h] || !DIV_OF[g.a] || g.hs == null || g.as == null || g === cup) continue;
    for (const home of [true, false]) {
      const us = team(home ? g.h : g.a), opp = home ? g.a : g.h, win = home ? g.hs > g.as : g.as > g.hs;
      const add = (r) => { if (win) r.w++; else r.l++; };
      add(us);
      if (confOf(opp) === us.conf) add(us.confRec);
      if (DIV_OF[opp] === us.div) add(us.divRec);
      if (!g.n) add(home ? us.home : us.road);
      add((us.vs[opp] ??= rec()));
      us.pf += home ? g.hs : g.as; us.pa += home ? g.as : g.hs;
      us.log.push(win);
    }
  }
  const order = (a, b) => pct(b) - pct(a)
    || (pct(a.vs[b.tri] || rec()) !== pct(b.vs[a.tri] || rec()) && (a.vs[b.tri]?.w || 0) + (a.vs[b.tri]?.l || 0) > 0 ? pct(b.vs[a.tri] || rec()) - pct(a.vs[b.tri] || rec()) : 0)
    || pct(b.confRec) - pct(a.confRec) || (b.pf - b.pa) - (a.pf - a.pa) || a.tri.localeCompare(b.tri);
  // A's number over B; `owns` = A has already won the season series.
  const over = (A, B) => games - B.l - A.w + ((A.vs[B.tri]?.w || 0) >= 3 ? 0 : 1);
  const out = {};
  for (const conf of ["East", "West"]) {
    const list = Object.values(T).filter((t) => t.conf === conf).sort(order);
    const top = list[0];
    out[conf] = list.map((t, i) => {
      const others = list.filter((o) => o !== t);
      const need = others.map((o) => ({ tri: o.tri, n: over(t, o) })).sort((a, b) => a.n - b.n);
      const out2 = others.map((o) => ({ tri: o.tri, n: over(o, t) })).sort((a, b) => a.n - b.n);
      const nth = (L, k) => (L[k - 1] ? { n: Math.max(0, L[k - 1].n), vs: L[k - 1].tri } : null);
      const divNeed = need.filter((x) => DIV_OF[x.tri] === t.div).sort((a, b) => b.n - a.n)[0];
      const last = t.log.slice(-10), streakWin = t.log[t.log.length - 1];
      let streak = 0;
      for (let k = t.log.length - 1; k >= 0 && t.log[k] === streakWin; k--) streak++;
      return {
        tri: t.tri, seed: i + 1, w: t.w, l: t.l, pct: Math.round(pct(t) * 1000) / 1000, gb: ((top.w - t.w) + (t.l - top.l)) / 2,
        conf: `${t.confRec.w}-${t.confRec.l}`, nonconf: `${t.w - t.confRec.w}-${t.l - t.confRec.l}`, div: `${t.divRec.w}-${t.divRec.l}`, home: `${t.home.w}-${t.home.l}`, road: `${t.road.w}-${t.road.l}`,
        last10: `${last.filter(Boolean).length}-${last.filter((x) => !x).length}`, streak: t.log.length ? `${streakWin ? "W" : "L"}${streak}` : "", diff: t.pf - t.pa, left: games - t.w - t.l,
        // Clinch: ahead of 9 (playoffs), 5 (Play-In or better), 14 (best record), the division's other 4.
        magic: { playoff: nth(need, 9), playin: nth(need, 5), top: nth(need, 14), division: divNeed ? { n: Math.max(0, divNeed.n), vs: divNeed.tri } : null },
        // Out: 6 teams safely ahead (no top-six place), 10 (no Play-In place).
        elim: { playoff: nth(out2, 6), playin: nth(out2, 10) },
      };
    });
  }
  return out;
}

export const CLINCH = { show: 5 };
const WHAT = { playoff: "a playoff berth", playin: "at least a Play-In place", top: "the best record in the", division: "the" };
/**
 * Lines for tonight's teams whose number is within CLINCH.show (kind clinch). A number of 1 is said as what it is:
 * a win tonight does it.
 */
export function clinchLines(S, teams) {
  const out = [];
  for (const conf of ["East", "West"]) for (const t of S?.[conf] || []) {
    if (!teams.has(t.tri)) continue;
    const say = (key, m) => `${key === "top" ? `${WHAT.top} ${conf}` : key === "division" ? `${WHAT.division} ${DIV_OF[t.tri]} Division` : WHAT[key]}`;
    // The biggest prize within reach only: the best record implies the rest.
    for (const key of ["top", "division", "playoff", "playin"]) {
      const m = t.magic[key];
      if (!m || m.n < 1 || m.n > CLINCH.show) continue;
      if (key === "playin" && t.magic.playoff && t.magic.playoff.n <= CLINCH.show) continue;
      out.push({ team: t.tri, kind: "clinch", key: `clinch|${t.tri}|${key}`, rare: m.n === 1, score: 3.2 + (CLINCH.show - m.n) * 0.25 + (key === "top" ? 0.3 : 0),
        text: m.n === 1 ? `${t.tri} (${t.w}-${t.l}) clinches ${say(key)} with a win tonight` : `${t.tri}'s magic number for ${say(key)} is ${m.n} (${t.w}-${t.l}; any mix of its wins and ${m.vs} losses)` });
      break;
    }
    for (const key of ["playin", "playoff"]) {
      const e = t.elim[key];
      if (!e || e.n < 1 || e.n > CLINCH.show) continue;
      out.push({ team: t.tri, kind: "clinch", key: `elim|${t.tri}|${key}`, rare: e.n === 1, score: 3.0 + (CLINCH.show - e.n) * 0.25,
        text: e.n === 1 ? `${t.tri} (${t.w}-${t.l}) is out of ${key === "playin" ? "the postseason" : "the top six"} with a loss tonight` : `${t.tri}'s elimination number ${key === "playin" ? "for the postseason" : "for a top-six place"} is ${e.n} (${t.w}-${t.l}; any mix of its losses and ${e.vs} wins)` });
      break;
    }
  }
  return out;
}
