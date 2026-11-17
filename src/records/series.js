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
  const R = settledPair(series, a, b), N = R && (series?.outside || []).find((v) => (v.a === a && v.b === b) || (v.a === b && v.b === a));
  // 0.94: what Basketball Reference's head-to-head page has where it settles nothing (a tiebreaker counted as a game, a
  // guide that starts later than the franchise): shown beside the record, never instead of it.
  return N ? { ...R, outside: { w: N.a === a ? N.w : N.l, l: N.a === a ? N.l : N.w, note: N.note } } : R;
}
function settledPair(series, a, b) {
  const P = printedPair(series, a, b);
  if (!P) return P;
  // 0.92: a record looked up outside the guides (src/data/series-verified.json; Basketball Reference pages the user
  // sends). It names the guide that is right, or stands alone if neither is.
  const V = (series?.verified || []).find((v) => (v.a === a && v.b === b) || (v.a === b && v.b === a));
  if (V && P.status !== "confirmed") {
    const w = V.a === a ? V.w : V.l, l = V.a === a ? V.l : V.w, same = (r) => !!r && r.w === w && r.l === l, { other: o_, weak: w_, ...keep } = P;
    if (same(P.rec.overall)) return { ...keep, status: "confirmed", source: [P.source[0], "check"], checked: V.by };
    if (P.other && same(P.other.overall)) {
      const O = printedPair({ ...series, teams: { [a]: {}, [b]: {}, [P.other.team]: { [P.other.team === a ? b : a]: series.teams[P.other.team][P.other.team === a ? b : a] } } }, a, b);
      if (O) return { status: "confirmed", source: [P.other.team, "check"], rec: O.rec, checked: V.by, ...(O.adjusted ? { adjusted: O.adjusted } : {}) };
    }
    return { status: "confirmed", source: ["check"], rec: { overall: { w, l } }, checked: V.by };
  }
  if (P.status === "confirmed") return P;
  // 0.87: a third opinion where the two guides do not settle it. Twenty-two guides print their games, so many pairings
  // can be counted game by game (countedPairs below). A count that lands exactly on a printed record confirms it: on
  // the one already shown, or on the other guide's, which is then the one shown. A count that lands on neither
  // changes nothing.
  const counts = series?.counted?.[a]?.[b] || [];
  // Four guides have no table by opponent, so their "record" is already a count of their own lists (`lists`): the
  // same lists counted again prove nothing, and only the other team's games can back such a record.
  // 0.94: nor does any guide's own game list confirm its own table. The Hawks' table (121-123 against Milwaukee) and
  // the Hawks' list agreed with each other and were both wrong: they share a misprinted result (3/1/74). Only the other
  // team's games can back a record.
  const hits = (r, t) => !!r && counts.some((c) => c.w === r.w && c.l === r.l && c.by !== t);
  const mine = hits(P.rec.overall, P.source[0]), theirs = !!(P.other && !P.other.bad && hits(P.other.overall, P.other.team));
  // 0.91: neither print is right, but the two teams' games, counted apart, come to the same record: that record is
  // shown, as counted (Memphis v Utah: 42-69 and 44-67 in print, 44-69 from each team's own list).
  const ca = counts.find((c) => c.by === a), cb = counts.find((c) => c.by === b);
  if (!mine && !theirs && P.status === "differs" && ca && cb && ca.w === cb.w && ca.l === cb.l) return { status: "confirmed", source: ["games"], rec: { overall: { w: ca.w, l: ca.l } }, counted: true, printed: { [a]: series.teams[a][b].overall, [b]: series.teams[b][a].overall } };
  if (mine === theirs) return P;                       // neither, or the two sides' counts back one each
  const { other, weak, ...rest } = P;
  if (mine) return { ...rest, status: "confirmed", source: [P.source[0], "games"], counted: true };
  const O = printedPair({ ...series, teams: { [a]: {}, [b]: {}, [other.team]: { [other.team === a ? b : a]: series.teams[other.team][other.team === a ? b : a] } } }, a, b);
  return O ? { status: "confirmed", source: [other.team, "games"], rec: O.rec, counted: true, ...(O.adjusted ? { adjusted: O.adjusted } : {}) } : P;
}

/**
 * Every pairing that can be counted game by game through `through` (the guides' last season), from the games the
 * build already trusts: each team's seasons before 2016-17 that add up to the franchise's record (deepSeqs) and our
 * own results since. A team's count against an opponent is whole only if its games go back to the first season the
 * two could have met. -> { A: { B: [{ w, l, by }, ...] } }: one count from each side that can make it, seen from A
 * (`by`: whose games were counted).
 */
export function countedPairs({ deep, history, official, through }) {
  const out = {};
  if (!deep?.seq || !history?.games || !official) return out;
  const first = Object.fromEntries(Object.entries(official).map(([t, rows]) => [t, rows[0][0]]));
  const rec = {}, add = (x, y, won) => { const r = ((rec[x] ??= {})[y] ??= { w: 0, l: 0 }); won ? r.w++ : r.l++; };
  for (const [t, gs] of Object.entries(deep.seq)) for (const g of gs) if (g.opp && first[g.opp]) add(t, g.opp, g.pf > g.pa);
  const cols = history.columns, at = (k) => cols.indexOf(k);
  const seasonOf = (d) => { const y = Number(d.slice(0, 4)) - (Number(d.slice(5, 7)) >= 8 && !(d >= "2020-07-01" && d <= "2020-10-31") ? 0 : 1); return `${y}-${String(y + 1).slice(2)}`; };
  const recent = {}, addR = (x, y, won) => { const r = ((recent[x] ??= {})[y] ??= { w: 0, l: 0 }); won ? r.w++ : r.l++; };
  for (const g of history.games) {
    const d = String(g[at("date")]).slice(0, 10);
    if (g[at("type")] !== 2 || CUP_FINALS.has(d) || (through && seasonOf(d) > through)) continue;
    const h = g[at("home")], a = g[at("away")], hw = g[at("homeScore")] > g[at("awayScore")];
    addR(h, a, hw); addR(a, h, !hw);
  }
  for (const x of Object.keys(first)) for (const y of Object.keys(first)) {
    if (x === y || !deep.from?.[x]) continue;
    const start = [first[x], first[y]].sort()[1];
    if (deep.from[x] > start) continue;                  // x's games do not reach the first season the two could meet
    const o = rec[x]?.[y] || { w: 0, l: 0 }, n = recent[x]?.[y] || { w: 0, l: 0 };
    const c = { w: o.w + n.w, l: o.l + n.l };
    (((out[x] ??= {})[y] ??= [])).push({ ...c, by: x });
    (((out[y] ??= {})[x] ??= [])).push({ w: c.l, l: c.w, by: x });
  }
  return out;
}
const CUP_FINALS = new Set(["2023-12-09", "2024-12-17", "2025-12-16"]);

/** What the two guides print, before any count of the games. */
function printedPair(series, a, b) {
  const A = series?.teams?.[a]?.[b], B = series?.teams?.[b]?.[a];
  if (!A && !B) return null;
  // B's record seen from A: its home games are A's road games.
  const fromB = B ? { overall: flip(B.overall), home: flip(B.road), road: flip(B.home), neutral: flip(B.neutral) } : null;
  // A guide that starts late (`era`: Detroit 1957-58, Golden State's lists 1962-63, Oklahoma City 2008-09) still holds
  // a whole series against a franchise that did not exist before then: its count is cut short only when the two
  // could have met earlier. `short`: a guide whose lists leave out a season or a few games.
  const F = series.first || {};
  const era = (t, o) => { const e = series.guides?.[t]?.era; return e && Math.max(F[t] ?? 0, F[o] ?? 0) < Number(e.slice(0, 4)) ? e : null; };
  // 0.91: a guide whose lists once fell short is whole again when its count, from seasons that each add up to the
  // franchise's record, is the record it is credited with (Washington since 0.87).
  const mended = (t, o) => (series.counted?.[t]?.[o] || []).some((c) => c.by === t && c.w === series.teams[t][o].overall.w && c.l === series.teams[t][o].overall.l);
  const rank = (t, o) => (era(t, o) ? 2 : series.guides?.[t]?.short && !mended(t, o) ? 1 : 0);
  const adj = (r) => (r?.adjusted ? { adjusted: r.adjusted } : {});
  if (A && B) {
    const same = A.overall.w === B.overall.l && A.overall.l === B.overall.w;
    if (same) return { status: "confirmed", source: [a, b], rec: { ...fromB, ...A } };
    const games = (r) => r.overall.w + r.overall.l;
    // The guide that measures less and has fewer games does not contradict the other: the fuller count stands alone.
    for (const [short, full, S, Fu] of [[a, b, A, B], [b, a, B, A]]) {
      if (rank(short, full) > rank(full, short) && games(S) < games(Fu)) return { status: "single", source: [full], rec: full === a ? A : fromB, weak: !!Fu.bad || !trusted(series, full), ...(era(full, short) ? { era: era(full, short) } : {}), ...adj(Fu) };
    }
    // A record that does not add up (a misprint) loses to one that does; otherwise lean on the guide other guides
    // agree with more often.
    const ta = series.guides?.[a]?.agree || [0, 1], tb = series.guides?.[b]?.agree || [0, 1];
    const bothLess = rank(a, b) > 0 && rank(b, a) > 0;          // two counts that each leave something out: the bigger one is nearer
    const useA = !!A.bad !== !!B.bad ? !A.bad : bothLess ? games(A) >= games(B) : ta[0] / (ta[1] || 1) >= tb[0] / (tb[1] || 1);
    const used = useA ? A : B;
    return { status: "differs", source: [useA ? a : b], rec: useA ? A : fromB, other: { team: useA ? b : a, overall: useA ? fromB.overall : A.overall, ...((useA ? B : A).bad ? { bad: true } : {}) }, weak: !!used.bad || !trusted(series, useA ? a : b), ...adj(used) };
  }
  const one = A ? a : b, R = A || B;
  // A single guide that starts at its current city's first season: the record is real but not all-time.
  const other = A ? b : a;
  return { status: "single", source: [one], rec: A || fromB, weak: !!R.bad || !trusted(series, one), ...(era(one, other) ? { era: era(one, other) } : {}), ...adj(R) };
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
  const src = S.checked ? (S.source[0] === "check" ? `${S.checked}; neither guide prints it` : `the ${poss(S.source[0])} media guide${plus}, and ${S.checked} agrees`) : S.counted && S.source[0] === "games" ? "counted from both teams' game lists, which agree; their guides print other totals" : S.counted ? `the ${poss(S.source[0])} media guide${plus}, and a count of the games agrees` : S.status === "confirmed" ? "both teams' media guides agree" : S.status === "differs" ? `the ${poss(S.source[0])} media guide${plus}; the ${poss(S.other.team)} has it ${wl(lead === away ? flip(S.other.overall) : S.other.overall)}${S.other.bad ? ", which does not add up" : ""}` : `the ${poss(S.source[0])} media guide${plus}`;
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
      ...(S.era ? { era: S.era } : {}), ...(S.adjusted ? { adjusted: S.adjusted } : {}), ...(S.counted ? { counted: true } : {}), ...(S.checked ? { checked: S.checked } : {}), ...(S.outside ? { outside: S.outside } : {}) });
  }
  return out;
}
