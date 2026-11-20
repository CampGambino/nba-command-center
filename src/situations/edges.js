/**
 * Matchup edges (0.95; the user, 11/17): what is lopsided between tonight's opponents.
 *
 *   1. Scoring by type. Each team's points in the paint, on the fast break, off turnovers and on second chances, scored
 *      and allowed, per game and ranked. A team at one end against a team at the other end is an edge: a top-EDGE.end
 *      offense in the category against a bottom-EDGE.end defense in it, or a bottom offense against a top defense.
 *   2. Players. A player in the league's top EDGE.players in paint, second-chance or off-turnover points a game against
 *      a team that allows the most of it. (There is no player number for fast-break points: see espn/misc.js. The
 *      opponent's own numbers are not set against one player.)
 *   3. Outliers against a group tonight's opponent is in (0.135; the user, 11/20: "I want to make sure we are flagging
 *      the relevant outliers, especially if there is a match between player and opponent or opponent and opponent").
 *      Four groups (GROUPS): the top and bottom EDGE.topDef defenses, the EDGE.topDef best and worst records (ties at
 *      the cutoff all in). A player whose scoring changes most against a group (among the league's EDGE.outliers
 *      biggest drops or rises, by EDGE.gap points or more), and a team whose rating does (among the EDGE.end biggest,
 *      by EDGE.teamGap or more per 100), get a line when tonight's opponent is in that group. One opponent in two
 *      groups (Brooklyn: a bottom-5 defense and a bottom-5 record) gives one line per player or team, naming both.
 *
 * Input rows are the season's results (situations/results.js) with m / mp filled in. Pure: no I/O.
 * The cut-offs in EDGE are first guesses, to be tuned on what the list looks like through a season.
 */
import { TEAMS } from "../teams.js";
import { teamGameLines, vsTop, topSet, ratings } from "./ratings.js";
import { playerGames, vsDefenses } from "./vsplayers.js";

export const EDGE = { end: 5, players: 10, minGames: 5, share: 0.5, coverage: 0.8, topDef: 5, outliers: 10, gap: 4, teamGap: 5, perGame: 6 };
// 0.135: the groups an opponent can be in. `by`/`side` as in ratings.js topSet; `what` reads after "against the".
export const GROUPS = [
  { cat: "topdef", by: "defense", side: "top", what: (n) => `top ${n} defenses`, tag: (n) => `vs top-${n} defenses` },
  { cat: "botdef", by: "defense", side: "bottom", what: (n) => `bottom ${n} defenses`, tag: (n) => `vs bottom-${n} defenses` },
  { cat: "toprec", by: "record", side: "top", what: (n) => `${n} best records`, tag: (n) => `vs top-${n} records` },
  { cat: "botrec", by: "record", side: "bottom", what: (n) => `${n} worst records`, tag: (n) => `vs bottom-${n} records` },
];
export const CATS = [
  { k: "paint", i: 0, pi: 1, words: "points in the paint", tag: "Paint" },
  { k: "fb", i: 1, pi: null, words: "fast-break points", tag: "Fast break" },
  { k: "pot", i: 2, pi: 3, words: "points off turnovers", tag: "Off turnovers" },
  { k: "sc", i: 3, pi: 2, words: "second-chance points", tag: "Second chance" },
];
const nick = (t) => TEAMS[t]?.nick || t;
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
// A player's line weighs with his role, as the other matchup lines do: 0.8 for a 6-point player, 1.2 at 24+ a game.
const role = (ppg) => 0.8 + Math.min(0.4, Math.max(0, ((ppg || 0) - 6) / 45));
const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
/** A rank counted from the highest number, in words: "the most", "4th most", "3rd fewest", "the fewest". */
export const place = (rank, of) => (rank === 1 ? "the most" : rank === of ? "the fewest" : rank <= of / 2 ? `${ord(rank)} most` : `${ord(of - rank + 1)} fewest`);

/** { tri: { gp, games, f: [per game scored by category], a: [allowed] } }, teams whose games are covered only. */
export function teamTypes(rows) {
  const T = {};
  for (const g of rows) {
    for (const [t, mine, opp] of [[g.h, g.m?.[0], g.m?.[1]], [g.a, g.m?.[1], g.m?.[0]]]) {
      const x = (T[t] ??= { gp: 0, games: 0, f: [0, 0, 0, 0], a: [0, 0, 0, 0] });
      x.games++;
      if (!mine || !opp || mine.some((v) => v == null) || opp.some((v) => v == null)) continue;
      x.gp++;
      mine.forEach((v, i) => { x.f[i] += v; });
      opp.forEach((v, i) => { x.a[i] += v; });
    }
  }
  const out = {};
  for (const [t, x] of Object.entries(T)) {
    if (x.gp < EDGE.minGames || x.gp / x.games < EDGE.coverage) continue;
    out[t] = { gp: x.gp, games: x.games, f: x.f.map((v) => v / x.gp), a: x.a.map((v) => v / x.gp) };
  }
  // Ranks counted from the highest number (1 = scores the most / allows the most); ties share a rank.
  const n = Object.keys(out).length;
  for (const side of ["f", "a"]) for (const c of CATS) {
    const vals = Object.values(out).map((x) => x[side][c.i]);
    for (const x of Object.values(out)) {
      (x[`${side}r`] ??= [])[c.i] = 1 + vals.filter((v) => v > x[side][c.i] + 1e-9).length;
      (x[`${side}b`] ??= [])[c.i] = 1 + vals.filter((v) => v < x[side][c.i] - 1e-9).length;      // the same rank counted from the lowest number
    }
  }
  return { teams: out, n };
}

/** Players' paint / second-chance / off-turnover points a game: { rows: [{ id, name, tri, gp, v: [paint, sc, pot], r: [...] }], n }. */
export function playerTypes(rows, names = {}) {
  const P = {}, teamGp = {};
  for (const g of rows) {
    if (!g.mq || !g.pl) continue;
    teamGp[g.h] = (teamGp[g.h] || 0) + 1; teamGp[g.a] = (teamGp[g.a] || 0) + 1;
    for (const [id, row] of Object.entries(g.pl)) {
      if (!(row[2] > 0)) continue;                                   // minutes
      const p = (P[id] ??= { id, name: names[id] || id, tri: null, last: "", gp: 0, pts: 0, v: [0, 0, 0] });
      const tri = row[0] === 0 ? g.h : g.a;
      if (g.d >= p.last) { p.last = g.d; p.tri = tri; }
      p.gp++; p.pts += row[3] || 0;
      const m = g.mp?.[id];
      if (m) { p.v[0] += m[1]; p.v[1] += m[2]; p.v[2] += m[3]; }
    }
  }
  const list = Object.values(P).filter((p) => p.gp >= EDGE.minGames && p.gp >= (teamGp[p.tri] || 0) * EDGE.share)
    .map((p) => ({ id: p.id, name: p.name, tri: p.tri, gp: p.gp, ppg: p.pts / p.gp, v: p.v.map((x) => x / p.gp) }));
  for (const p of list) p.r = p.v.map((x, i) => 1 + list.filter((q) => q.v[i] > x + 1e-9).length);
  return { rows: list, n: list.length };
}

/**
 * Tonight's edges: [{ away, home, items: [{ kind: "matchup", edge: true, lopsided: true, team, player?, tag, text, score }] }].
 * tonight: [{ away, home }]; teamFiles: docs/data/teams files (for the players-against-defenses split).
 */
export function edges({ rows, names = {}, tonight = [], teamFiles = null }) {
  const TT = teamTypes(rows), PT = playerTypes(rows, names), of = TT.n;
  const lines = teamGameLines(rows), R = ratings(lines);
  const topD = topSet(R, EDGE.topDef, "defense");
  // 0.135: each group's players and teams, ranked by how much they change against it (see GROUPS).
  const PGs = teamFiles ? playerGames(teamFiles) : null, N = EDGE.topDef;
  const G = GROUPS.map((g) => {
    const set = topSet(R, N, g.by, g.side), vs = PGs ? vsDefenses(PGs, set) : { rows: [] };
    const tv = vsTop(lines, N, g.by, g.side).teams, key = g.by === "record" ? "net" : "ortg";
    const diffs = Object.entries(tv).filter(([, x]) => x.diff != null && x.vsTop?.games >= 2 && x.rest?.games >= 2)
      .map(([t, x]) => ({ t, diff: x.diff, games: x.vsTop.games, vs: x.vsTop[key], rest: x.rest[key], w: x.vsTop.w, l: x.vsTop.l, rw: x.rest.w, rl: x.rest.l })).sort((a, b) => a.diff - b.diff);
    const label = g.what(N) + (set.size > N ? ` (${set.size} teams, ties included)` : "");
    return { ...g, set, label, drops: vs.rows.filter((x) => x.gap < 0), rises: vs.rows.filter((x) => x.gap > 0).reverse(), diffs, key };
  });
  const oppWord = (g, def) => (g.by === "defense" ? `the ${nick(def)} are ${ord(R[def].drank)} in defensive rating` : `the ${nick(def)} are ${R[def].w}-${R[def].l}`);
  const out = [];
  for (const g of tonight) {
    const items = [];
    for (const [off, def] of [[g.away, g.home], [g.home, g.away]]) {
      const O = TT.teams[off], D = TT.teams[def];
      // His team's players among the league's leaders in the category, when the other team allows the most of it.
      const leadersIn = (c) => (c.pi == null || !D || D.ar[c.i] > EDGE.end ? [] : PT.rows.filter((p) => p.tri === off && p.r[c.pi - 1] <= EDGE.players && p.v[c.pi - 1] > 0).sort((a, b) => a.r[c.pi - 1] - b.r[c.pi - 1]));
      const inNba = (rank) => (rank === 1 ? "the most in the NBA" : `${ord(rank)} in the NBA`);
      for (const c of CATS) {
        const who = D && D.ab[c.i] > of / 2 ? leadersIn(c) : [], k = c.pi - 1;
        const fr = O?.fr[c.i], ar = D?.ar[c.i];
        // A top offense in the category against a defense that allows the most of it: the edge is the offense's. Its
        // own leaders in the category are named on the same line, not on lines of their own.
        // (Counted from the other end too: when many teams share a number, nobody is at an end of the league.)
        if (O && D && fr <= EDGE.end && ar <= EDGE.end && O.fb[c.i] > of / 2 && D.ab[c.i] > of / 2) {
          items.push({ kind: "matchup", edge: true, lopsided: true, team: off, cat: c.k, tag: `${c.tag} edge · ${off}`, score: 1.9 + 0.05 * (2 * EDGE.end + 2 - fr - ar),
            text: `The ${nick(off)} score ${r1(O.f[c.i])} ${c.words} a game (${place(fr, of)}); the ${nick(def)} allow ${r1(D.a[c.i])} (${place(ar, of)}).` +
              (who.length ? ` ${who.slice(0, 3).map((p) => `${p.name} scores ${r1(p.v[k])} (${inNba(p.r[k])})`).join("; ")}.` : "") });
          continue;
        }
        // A bottom offense against a defense that allows the fewest: the edge is the defense's.
        if (O && D && fr > of - EDGE.end && ar > of - EDGE.end) items.push({ kind: "matchup", edge: true, lopsided: true, team: def, cat: c.k, tag: `${c.tag} edge · ${def}`, score: 1.9 + 0.05 * (fr + ar - 2 * (of - EDGE.end)),
          text: `The ${nick(off)} score ${r1(O.f[c.i])} ${c.words} a game (${place(fr, of)}); the ${nick(def)} allow ${r1(D.a[c.i])} (${place(ar, of)}).` });
        // A leader in the category whose team is not at the top of it, against a defense that allows the most.
        for (const p of who) items.push({ kind: "matchup", edge: true, lopsided: true, team: off, player: p.name, cat: c.k, tag: `${c.tag} edge · ${p.name}`,
          score: (1.7 + 0.04 * (EDGE.players + 1 - p.r[k]) + 0.03 * (EDGE.end + 1 - D.ar[c.i])) * role(p.ppg),
          text: `${p.name} scores ${r1(p.v[k])} ${c.words} a game (${inNba(p.r[k])}); the ${nick(def)} allow ${r1(D.a[c.i])} a game (${place(D.ar[c.i], of)}).` });
      }
      // 0.135: against a group tonight's opponent is in. One line per player (and per team) naming every group he is an
      // outlier against that includes this opponent, scored on the biggest.
      const hits = {}, teamHits = [];
      for (const g of G) {
        if (!g.set.has(def)) continue;
        for (const [list, word] of [[g.drops, "drop"], [g.rises, "rise"]]) list.slice(0, EDGE.outliers).forEach((x, i) => {
          if (x.tri !== off || Math.abs(x.gap) < EDGE.gap) return;
          (hits[x.name] ??= []).push({ g, x, i, word, s: (1.8 + Math.min(0.6, Math.abs(x.gap) / 20) + 0.02 * (EDGE.outliers - i)) * role(x.avg) });
        });
        const ti = g.diffs.findIndex((x) => x.t === off), td = g.diffs[ti];
        if (td && Math.abs(td.diff) >= EDGE.teamGap && (ti < EDGE.end || ti >= g.diffs.length - EDGE.end)) {
          const fromTop = ti < EDGE.end ? ti : g.diffs.length - 1 - ti;
          teamHits.push({ g, td, fromTop, word: ti < EDGE.end ? "drop" : "rise", s: 1.8 + Math.min(0.5, Math.abs(td.diff) / 30) });
        }
      }
      const sgn = (v) => `${v > 0 ? "+" : "−"}${r1(Math.abs(v))}`, nth = (i) => (i === 0 ? "" : `${ord(i + 1)}-`);
      for (const [name, hs] of Object.entries(hits)) {
        hs.sort((a, b) => b.s - a.s);
        const [h, ...more] = hs, x = h.x;
        items.push({ kind: "matchup", edge: true, lopsided: true, team: off, player: name, cat: h.g.cat, cats: hs.map((y) => y.g.cat), tag: `${h.g.tag(N)} · ${name}`, score: h.s + 0.15 * more.length,
          text: `${name} has averaged ${r1(x.vsAvg)} points in ${x.vsGp} games against the ${h.g.label} and ${r1(x.restAvg)} in his other ${x.restGp} (${sgn(x.gap)}), the ${nth(h.i)}biggest ${h.word} in the NBA; ${oppWord(h.g, def)}.` +
            more.map((y) => ` Against the ${y.g.label}: ${r1(y.x.vsAvg)} in ${y.x.vsGp} (${sgn(y.x.gap)}, the ${nth(y.i)}biggest ${y.word}); ${oppWord(y.g, def)}.`).join("") });
      }
      if (teamHits.length) {
        teamHits.sort((a, b) => b.s - a.s);
        const say = (t) => (t.g.by === "defense"
          ? `scored ${r1(t.td.vs)} points per 100 possessions in ${t.td.games} games against the ${t.g.label} and ${r1(t.td.rest)} against everyone else (${sgn(t.td.diff)})`
          : `gone ${t.td.w}-${t.td.l} against the ${t.g.label} (net rating ${sgn(t.td.vs)}) and ${t.td.rw}-${t.td.rl} against everyone else (${sgn(t.td.rest)}), a swing of ${sgn(t.td.diff)} per 100`);
        const [h, ...more] = teamHits;
        items.push({ kind: "matchup", edge: true, lopsided: true, team: off, cat: h.g.cat, cats: teamHits.map((t) => t.g.cat), tag: `${h.g.tag(N)} · ${off}`, score: h.s + 0.15 * more.length,
          text: `The ${nick(off)} have ${say(h)}, the ${nth(h.fromTop)}biggest ${h.word} in the NBA; ${oppWord(h.g, def)}.` + more.map((t) => ` They have ${say(t)}, the ${nth(t.fromTop)}biggest ${t.word}.`).join("") });
      }
    }
    items.sort((a, b) => b.score - a.score);
    out.push({ away: g.away, home: g.home, items: items.map((i) => ({ ...i, score: Math.round(i.score * 100) / 100 })) });
  }
  const table = Object.entries(TT.teams).sort((a, b) => a[0].localeCompare(b[0])).map(([t, x]) => ({ team: t, gp: x.gp, f: x.f.map((v) => Math.round(v * 10) / 10), a: x.a.map((v) => Math.round(v * 10) / 10), fr: x.fr, ar: x.ar }));
  const leaders = Object.fromEntries(CATS.filter((c) => c.pi != null).map((c) => [c.k, PT.rows.filter((p) => p.r[c.pi - 1] <= 25 && p.v[c.pi - 1] > 0).sort((a, b) => b.v[c.pi - 1] - a.v[c.pi - 1]).map((p) => ({ name: p.name, team: p.tri, gp: p.gp, v: Math.round(p.v[c.pi - 1] * 10) / 10, rank: p.r[c.pi - 1] }))]));
  return { games: out, table, leaders, teams: of, topDefenses: [...topD].sort((a, b) => R[a].drank - R[b].drank), covered: rows.filter((g) => g.m).length, total: rows.length };
}
