/**
 * All-time series between two teams, from the team media guides (0.84).
 *
 * The user, 11/16: "did you completely mine the team PDF folder… that information could make it easier to check past
 * records and streaks against opponents rather than relying on the current game notes."
 *
 * src/data/nba-series-history-2026-27.json holds what each guide prints about every opponent through 2025-26:
 * the regular-season record overall, at home and on the road, and in most guides the current streak and the dates
 * of the last win and loss. This module adds this season's meetings and says how far a record can be leaned on:
 *
 *   confirmed   both teams' guides print the pairing and their records mirror (A's wins are B's losses)
 *   differs     both print it and they do not agree: both are kept and shown
 *   single      one guide prints it
 *
 * A guide's own track record matters too: `guides[TRI].agree` is how many of its pairings another guide mirrors; a
 * record known only from a guide that is mirrored less than TRUST of the time is marked `weak`. What the cross-check
 * found (0.84.1, 24 guides): Denver's rows all stop at 2024-25 (last season is added from our results, `adjusted`),
 * a few rows elsewhere do too, Utah counted last season twice in four rows and is off by one or two in others,
 * Detroit and Oklahoma City count only their current city's years (`guides[TRI].era`), and a row that does not add
 * up is marked `bad`.
 */
import { TEAMS } from "../teams.js";

export const TRUST = 0.75;
export const SERIES = { tied: 2, lopsided: 0.7, games: 60, round: 100 };
const nick = (t) => TEAMS[t]?.nick || t;
const poss = (t) => `${nick(t)}${/s$/.test(nick(t)) ? "'" : "'s"}`;
const flip = (r) => (r ? { w: r.l, l: r.w, ...(r.streak != null ? { streak: -r.streak } : {}), ...(r.lastL ? { lastW: r.lastL } : {}), ...(r.lastW ? { lastL: r.lastW } : {}) } : null);
const trusted = (series, t) => { const g = series?.guides?.[t]?.agree; return !!g && g[1] >= 4 && g[0] / g[1] >= TRUST; };

/** The pairing through 2025-26, from `a`'s side: { status, source, rec: { overall, home, road, neutral }, other, weak }. */
export function seriesPair(series, a, b) {
  const A = series?.teams?.[a]?.[b], B = series?.teams?.[b]?.[a];
  if (!A && !B) return null;
  // B's record seen from A: its home games are A's road games.
  const fromB = B ? { overall: flip(B.overall), home: flip(B.road), road: flip(B.home), neutral: flip(B.neutral) } : null;
  const era = (t) => series.guides?.[t]?.era || null;
  const adj = (r) => (r?.adjusted ? { adjusted: r.adjusted } : {});
  if (A && B) {
    const same = A.overall.w === B.overall.l && A.overall.l === B.overall.w;
    if (same) return { status: "confirmed", source: [a, b], rec: { ...fromB, ...A } };
    const games = (r) => r.overall.w + r.overall.l;
    // One guide counts only its current city's years (Detroit, Oklahoma City) and so has fewer games: it does not
    // contradict the other, it measures less. The full count stands alone.
    for (const [short, full, S, F] of [[a, b, A, B], [b, a, B, A]]) {
      if (era(short) && !era(full) && games(S) < games(F)) return { status: "single", source: [full], rec: full === a ? A : fromB, weak: !trusted(series, full), ...adj(F) };
    }
    // A record that does not add up (a misprint) loses to one that does; otherwise lean on the guide other guides
    // agree with more often.
    const ta = series.guides?.[a]?.agree || [0, 1], tb = series.guides?.[b]?.agree || [0, 1];
    const useA = !!A.bad !== !!B.bad ? !A.bad : ta[0] / (ta[1] || 1) >= tb[0] / (tb[1] || 1);
    const used = useA ? A : B;
    return { status: "differs", source: [useA ? a : b], rec: useA ? A : fromB, other: { team: useA ? b : a, overall: useA ? fromB.overall : A.overall, ...((useA ? B : A).bad ? { bad: true } : {}) }, weak: !!used.bad || !trusted(series, useA ? a : b), ...adj(used) };
  }
  const one = A ? a : b, R = A || B;
  // A single guide that starts at its current city's first season: the record is real but not all-time.
  return { status: "single", source: [one], rec: A || fromB, weak: !!R.bad || !trusted(series, one), ...(era(one) ? { era: era(one) } : {}), ...adj(R) };
}

/**
 * The pairing entering `today`: the guide's numbers plus this season's regular-season meetings
 * (`games`: [{ d, home, away, hs, as, neutral? }], oldest first, already limited to this season).
 */
export function seriesNow(series, games, a, b, today) {
  const P = seriesPair(series, a, b);
  if (!P) return null;
  const rec = {};
  for (const k of ["overall", "home", "road", "neutral"]) if (P.rec[k]) rec[k] = { ...P.rec[k] };
  const other = P.other ? { ...P.other, overall: { ...P.other.overall } } : undefined;   // the guide that differs is counted forward too
  let added = 0;
  for (const g of (games || []).filter((x) => x.d < today && [x.home, x.away].includes(a) && [x.home, x.away].includes(b)).sort((x, y) => (x.d < y.d ? -1 : 1))) {
    const won = (g.hs > g.as) === (g.home === a);
    const bump = (r) => {
      if (!r) return;
      won ? r.w++ : r.l++;
      if (r.streak != null) r.streak = won ? (r.streak > 0 ? r.streak + 1 : 1) : (r.streak < 0 ? r.streak - 1 : -1);
      if (won) r.lastW = g.d; else r.lastL = g.d;
    };
    bump(rec.overall); bump(g.neutral ? rec.neutral : g.home === a ? rec.home : rec.road); if (other) bump(other.overall);
    added++;
  }
  return { ...P, rec, added, ...(other ? { other } : {}) };
}

const wl = (r) => `${r.w}-${r.l}`;
const mdy = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}/${d.slice(2, 4)}`;

/** Tonight's matchup items for one game: the all-time series, and what a result tonight would do to it. */
export function seriesItems(series, games, away, home, today) {
  const S = seriesNow(series, games, home, away, today);   // from the home team's side
  if (!S || !S.rec.overall) return [];
  const o = S.rec.overall, n = o.w + o.l, items = [];
  if (!n) return items;
  const lead = o.w === o.l ? null : o.w > o.l ? home : away, hi = Math.max(o.w, o.l), lo = Math.min(o.w, o.l);
  const plus = S.adjusted ? (/twice/.test(S.adjusted) ? ", less a season it counted twice" : ", plus last season from our results") : "";
  const src = S.status === "confirmed" ? "both teams' media guides agree" : S.status === "differs" ? `the ${poss(S.source[0])} media guide${plus}; the ${poss(S.other.team)} has it ${wl(lead === away ? flip(S.other.overall) : S.other.overall)}${S.other.bad ? ", which does not add up" : ""}` : `the ${poss(S.source[0])} media guide${plus}`;
  const there = S.rec.home && S.rec.home.w + S.rec.home.l >= 10 ? `; the ${nick(home)} are ${wl(S.rec.home)} at home in it` : "";
  // What a line may be built on: both guides agreeing, or one well-backed guide's own print (not a row we corrected).
  const solid = !S.era && (S.status === "confirmed" || (S.status === "single" && !S.weak && !S.adjusted));
  const head = S.era ? `Since ${S.era} (as far back as the ${poss(S.source[0])} guide counts)` : "All-time";
  let score = 1.0, tag = "All-time series";
  if (solid && Math.abs(o.w - o.l) <= SERIES.tied && n >= 40) { score = 2.0; tag = "All-time series · close"; }
  else if (solid && n >= SERIES.games && hi / n >= SERIES.lopsided) { score = 1.8; tag = "All-time series · lopsided"; }
  items.push({ kind: "matchup", team: lead || home, tag: S.era ? `Series since ${S.era}` : tag, score, series: S.status, weak: !!S.weak,
    text: `${head}: ${lead ? `the ${nick(lead)} lead the ${nick(lead === home ? away : home)} ${hi}-${lo}` : `the ${nick(home)} and ${nick(away)} are tied ${o.w}-${o.l}`} in the regular season${there} (through ${mdy(lastDay(today))}; ${src})` });
  if (solid) for (const [t, w] of [[home, o.w], [away, o.l]]) {
    if ((w + 1) % SERIES.round === 0) items.push({ kind: "matchup", team: t, tag: `Win No. ${w + 1}`, score: 2.3, active: true, series: S.status,
      text: `A win tonight would be the ${poss(t)} ${w + 1}th in the regular season against the ${nick(t === home ? away : home)} (${src})` });
  }
  if (solid && n >= 40 && Math.abs(o.w - o.l) <= 1) {
    const t = o.w === o.l ? null : o.w < o.l ? home : away;
    items.push({ kind: "matchup", team: t || home, tag: "All-time series · the lead", score: 2.2, active: true, series: S.status,
      text: t ? `A win tonight would tie the all-time series for the ${nick(t)} (${wl(t === home ? o : flip(o))} against the ${nick(t === home ? away : home)})` : `The winner tonight takes the lead in the all-time series (tied ${o.w}-${o.l})` });
  }
  return items;
}
const lastDay = (today) => new Date(Date.parse(today) - 864e5).toISOString().slice(0, 10);

/** Every pairing we have, entering today, for the lookup table: one row a pair, the first team alphabetically first. */
export function seriesTable(series, games, today) {
  const out = [], T = Object.keys(TEAMS).sort();
  for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) {
    const S = seriesNow(series, games, T[i], T[j], today);
    if (!S) continue;
    out.push({ a: T[i], b: T[j], status: S.status, weak: !!S.weak, source: S.source, overall: S.rec.overall, home: S.rec.home || null, road: S.rec.road || null, other: S.other || null, added: S.added,
      ...(S.era ? { era: S.era } : {}), ...(S.adjusted ? { adjusted: S.adjusted } : {}) });
  }
  return out;
}
