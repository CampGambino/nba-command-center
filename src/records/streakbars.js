/**
 * Which runs are worth a live card (0.166.0). Pure: no I/O.
 *
 * The user, 11/25/26, on a "STREAK EXTENDED: Kyle Kuzma — 10+ points in 6 straight games" card in NBA Live: "a six game
 * streak of 10+ points doesn't warrant an alert. that's very low level. maybe when they approach 75 or 100 straight
 * games, but it is something that is common. … It'll be very notable if a player is close to not extending the number
 * late in the game, maybe over 100 games. … It's all situational, because a steak of 10+ points will be longer than a
 * streak of 30+ point games, something that is uncommon past 5 games. sliding scale if you will".
 *
 * The scale: a run counts once it is as long as the 50th-longest run of its kind in the box scores on file (2016-17 on,
 * regular season, the games a player played). That is about five runs a season league-wide, whatever the feat, and it
 * lands where the user pointed: 82 games for 10+ points, 6 for 30+ points (11/25/26 files). The same rule gives every
 * other feat its own bar (41 for 15+ points, 20 for 20+, 11 for a double-double, 48 for a made three), and any run a
 * team's notes name gets its bar the same way.
 *
 * The box scores on file are ESPN's logs of this season's players back to 2016-17 (425 players on 11/25/26), not every
 * player of those seasons, so a bar is, if anything, a little low. A run that reaches the first game on file for a
 * player who was already playing in 2016-17 is longer than we can count (`atLeast`).
 */
import { streakMet } from "./featlive.js";
import { CUP_TITLE_DATES, PLAY_IN_DATES } from "../situations/results.js";

export const BAR_RANK = 50;    // a run counts once it is as long as the 50th-longest of its kind on file
export const BAR_FLOOR = 3;    // and never under three games

const T = (k, min) => ({ k, min });
/** The feats watched for every player. A run named in a team's notes with other tests is weighed by the same rule. */
export const RUN_FEATS = [
  ...[10, 15, 20, 25, 30, 35, 40].map((n) => ({ tests: [T("pts", n)], label: `${n}+ points` })),
  ...[10, 15].map((n) => ({ tests: [T("reb", n)], label: `${n}+ rebounds` })),
  ...[5, 10].map((n) => ({ tests: [T("ast", n)], label: `${n}+ assists` })),
  { tests: ["dd"], label: "a double-double" }, { tests: ["td"], label: "a triple-double" },
  { tests: [T("fg3m", 1)], label: "a made three" }, ...[2, 3, 5].map((n) => ({ tests: [T("fg3m", n)], label: `${n}+ threes` })),
  { tests: [T("blk", 1)], label: "a block" }, ...[2, 3].map((n) => ({ tests: [T("blk", n)], label: `${n}+ blocks` })),
  { tests: [T("stl", 1)], label: "a steal" }, ...[2, 3].map((n) => ({ tests: [T("stl", n)], label: `${n}+ steals` })),
];
export const testsKey = (tests) => JSON.stringify(tests);
/** Can this run be counted in the history on file? (Starts aren't in it.) */
export const countable = (tests) => (tests || []).length > 0 && tests.every((x) => x === "dd" || x === "td" || (x && x.k && ["pts", "reb", "ast", "stl", "blk", "fg3m"].includes(x.k)));

/**
 * Every player's regular-season games played, oldest first: the history file's (type 2, minutes played, the Cup's title
 * game and the play-in left out, as the NBA and Basketball-Reference count) and then this season's.
 *   logs: player-logs-history ({ columns, players: { id: [[...]] } }), or null; pg: this season's games per player
 */
export function careerGames(logs, pg = {}) {
  const C = Object.fromEntries((logs?.columns || []).map((c, i) => [c, i])), out = {};
  for (const [id, rows] of Object.entries(logs?.players || {})) {
    out[id] = rows.filter((r) => r[C.type] === 2 && r[C.min] > 0 && !CUP_TITLE_DATES.has(r[C.date]) && !PLAY_IN_DATES.has(r[C.date]))
      .map((r) => ({ d: r[C.date], pts: r[C.pts], reb: r[C.reb], ast: r[C.ast], stl: r[C.stl], blk: r[C.blk], fg3m: r[C.fg3m] }));
  }
  for (const [id, gs] of Object.entries(pg || {})) {
    const have = new Set((out[id] || []).map((g) => g.d));
    out[id] = [...(out[id] || []), ...gs.filter((g) => !have.has(g.d))];
  }
  for (const id of Object.keys(out)) out[id].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  return out;
}

/** One player's runs for a test: every finished or current run's length, and the run still going (or null). */
export function runsOf(games, tests) {
  const lengths = []; let n = 0, start = null;
  for (const g of games) { if (streakMet(tests, g)) { if (!n) start = g.d; n++; } else { if (n) lengths.push(n); n = 0; start = null; } }
  if (n) lengths.push(n);
  return { lengths, active: n ? { n, start, fromFirst: start === games[0].d } : null };
}

/** The bar for a kind of run: the length of the 50th-longest on file (never under three; unreachable when there aren't 50). */
export function barOf(career, tests, rank = BAR_RANK) {
  const all = [];
  for (const gs of Object.values(career)) for (const n of runsOf(gs, tests).lengths) all.push(n);
  all.sort((a, b) => b - a);
  return all.length >= rank ? Math.max(BAR_FLOOR, all[rank - 1]) : Infinity;
}

/**
 * The runs still going that are at their bar, or one game from it.
 *   career: careerGames(); pg: this season's games (a run is followed only for a player who has played this season)
 *   extra: [{ tests, label, id, note? }] runs a team's notes name, for tests outside RUN_FEATS
 *   -> { runs: [{ id, name, team, tests, label, n, bar, start, source: "box", atLeast?, note? }], bars: { label: bar } }
 */
export function longRuns({ career, pg = {}, names = {}, teamOf = () => null, extra = [] }) {
  const feats = [...RUN_FEATS], keys = new Set(feats.map((f) => testsKey(f.tests)));
  for (const x of extra) if (countable(x.tests) && !keys.has(testsKey(x.tests))) { keys.add(testsKey(x.tests)); feats.push({ tests: x.tests, label: x.label, only: new Set(extra.filter((y) => testsKey(y.tests) === testsKey(x.tests)).map((y) => String(y.id))) }); }
  const noteOf = (id, tests) => extra.find((x) => String(x.id) === String(id) && testsKey(x.tests) === testsKey(tests))?.note || null;
  const runs = [], bars = {};
  for (const f of feats) {
    const bar = barOf(career, f.tests);
    bars[f.label] = Number.isFinite(bar) ? bar : null;
    if (!Number.isFinite(bar)) continue;
    for (const id of Object.keys(pg)) {
      if (f.only && !f.only.has(String(id))) continue;
      const gs = career[id]; if (!gs || !gs.length) continue;
      const a = runsOf(gs, f.tests).active;
      if (!a || a.n + 1 < bar) continue;
      const note = noteOf(id, f.tests);
      runs.push({ id: String(id), name: names[id] || String(id), team: teamOf(id), tests: f.tests, label: f.label, n: a.n, bar, start: a.start, source: "box",
        ...(a.fromFirst && a.start < "2017-01-01" ? { atLeast: true } : {}), ...(note ? { note } : {}), last: gs[gs.length - 1].d });
    }
  }
  return { runs: runs.sort((a, b) => b.n / b.bar - a.n / a.bar), bars };
}
