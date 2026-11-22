/**
 * Career feat boards and live streaks (0.142; pure, no imports: bundled into docs/bridge/cc-bridge.js as FEAT_RULES by
 * tools/bundle-bridge-rules.mjs, and used by the build for the site's lines). The user, 11/21: "proceed with your
 * suggestions" (combination-feat boards with an active player near the top; live streak cards from the game notes).
 *
 * A board: { label, one (one game: "30-10-5 game"), short, min: { stat: n }, max?: { stat: n }, td?: true, since?,
 * rows: [{ name, id?, now, live?, atLeast? }] }. Its counts are Basketball-Reference's career game-finder results as the
 * user sent them (all of NBA history, regular season) plus the qualifying games in our box scores since; or (since:
 * "1993-94", 0.142.1) our own box scores, where a count marked atLeast may be short and is never passed, tied or placed. A card only when a game moves a player on the board: passing or tying a
 * name, or adding to a record he holds. A board with a ceiling (single-digit points) can be undone by more scoring, so
 * it is said only late, "as it stands", like the rare lines.
 *
 * A streak: { tests: ["dd" | "td" | "start" | { k, min }], n } for a player, or a team streak (see teamStake).
 */
export const FEAT_STEP = { pts: 5, reb: 2, ast: 2, fg3m: 1, stl: 1, blk: 1 };   // how close counts as "on the verge"
export const FEAT_WORD = { pts: ["point", "points"], reb: ["rebound", "rebounds"], ast: ["assist", "assists"], fg3m: ["three", "threes"], stl: ["steal", "steals"], blk: ["block", "blocks"] };
const say = (k, n) => `${n} ${FEAT_WORD[k] ? FEAT_WORD[k][n === 1 ? 0 : 1] : k}`;
export const featOrd = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const isTd = (l) => ["pts", "reb", "ast", "stl", "blk"].filter((k) => (Number(l[k]) || 0) >= 10).length >= 3;
const isDd = (l) => ["pts", "reb", "ast", "stl", "blk"].filter((k) => (Number(l[k]) || 0) >= 10).length >= 2;

/** Does a line meet the board? */
export function qualifies(board, l) {
  for (const k in board.min || {}) if ((Number(l[k]) || 0) < board.min[k]) return false;
  for (const k in board.max || {}) if ((Number(l[k]) || 0) > board.max[k]) return false;
  return !board.td || isTd(l);
}

/** What a line still lacks: [[stat, more]], or null when it can't get there (a ceiling already passed). A triple-double
 *  board's missing third stat is the nearest of the others. */
export function shortOf(board, l) {
  for (const k in board.max || {}) if ((Number(l[k]) || 0) > board.max[k]) return null;
  const out = [];
  for (const k in board.min || {}) { const m = board.min[k] - (Number(l[k]) || 0); if (m > 0) out.push([k, m]); }
  if (board.td && !isTd(Object.assign({}, l, Object.fromEntries(out.map(([k, m]) => [k, (Number(l[k]) || 0) + m]))))) {
    const t = Object.assign({}, l); for (const [k, m] of out) t[k] = (Number(t[k]) || 0) + m;
    const tens = ["pts", "reb", "ast", "stl", "blk"].map((k) => [k, 10 - (Number(t[k]) || 0)]).filter((x) => x[1] > 0).sort((a, b) => a[1] - b[1]);
    const have = 5 - tens.length;
    for (const x of tens.slice(0, Math.max(0, 3 - have))) out.push(x);
  }
  return out;
}

/** Where a count puts a player on a board (others only): his place, who he passes going from `before` to `after`, who he
 *  ties, the leader. Rows are { name, now }. */
// A count marked atLeast is taken to be up to this much short (the archive misses about 13% of games in its worst seasons,
// and these feats come once in dozens of games): a lead or a place is said only when that couldn't change it.
export const LEAD_SLACK = 2;
export function standing(rows, me, before, after) {
  const others = rows.filter((r) => r.name !== me);
  // A count marked atLeast (games missing from our box scores) may be higher: never passed or tied, and if it is at or
  // below his, his place isn't known.
  const sure = others.filter((r) => !r.atLeast), unsure = others.filter((r) => r.atLeast);
  const place = 1 + others.filter((r) => r.now > after).length;
  const placeKnown = !unsure.some((r) => r.now <= after && r.now + LEAD_SLACK >= after);
  const passed = sure.filter((r) => r.now >= before && r.now < after).sort((a, b) => b.now - a.now);
  const tied = sure.filter((r) => r.now === after);
  const top = others.reduce((a, r) => (!a || r.now > a.now ? r : a), null);
  const next = others.filter((r) => r.now > after).sort((a, b) => a.now - b.now)[0] || null;
  const clear = (n) => !unsure.some((r) => r.now + LEAD_SLACK >= n);
  return { place, placeKnown, passed, tied, top, next, leading: place === 1 && !tied.length && clear(after), wasLeading: !!top && before > top.now && clear(before) };
}

const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
// Two names said; past that, "Larry Bird, Jason Kidd and three others".
const names = (L) => (L.length === 1 ? L[0].name : L.length === 2 ? `${L[0].name} and ${L[1].name}`
  : L.length === 3 ? `${L[0].name}, ${L[1].name} and ${L[2].name}` : `${L[0].name}, ${L[1].name} and ${WORDS[L.length - 2] || L.length - 2} others`);

/** What a qualifying game does: null unless it moves him (passes or ties a name, or adds to a record he holds). */
export function featMove(board, me, before) {
  const after = before + 1, s = standing(board.rows || [], me, before, after);
  if (!s.passed.length && !s.tied.length && !s.wasLeading) return null;
  // A board from our own box scores says "since 1993-94"; Basketball-Reference's boards are all of NBA history.
  const where = board.since ? `since ${board.since}` : "all-time", rec = board.since ? `the most since ${board.since}` : "the NBA record";
  const at = (p) => (p === 1 ? rec : s.placeKnown ? `${featOrd(p)} ${where}` : null);
  const nth = featOrd(after);
  let what;
  if (s.wasLeading) what = `adding to ${board.since ? `his lead since ${board.since}` : "his NBA record"}${s.top ? ` (${s.top.name} is next with ${s.top.now}${s.top.atLeast ? " or more" : ""})` : ""}`;
  else if (s.leading) what = `passing ${names(s.passed)} (${s.passed[0].now}) for ${rec}`;
  else if (s.tied.length && !s.passed.length) what = `tying ${names(s.tied)}${at(s.place) ? ` for ${at(s.place)}` : ""}`;
  else what = `passing ${names(s.passed)} (${s.passed[0].now})${s.tied.length ? `, level with ${names(s.tied)}` : ""}${at(s.place) ? ` for ${s.tied.length ? "a share of " : ""}${at(s.place)}` : ""}`;
  return { after, place: s.placeKnown ? s.place : null, record: s.place === 1 && s.placeKnown, passed: s.passed.map((r) => r.name), tied: s.tied.map((r) => r.name), top: s.top,
    what, text: `his ${nth} ${board.one || board.label}, ${what}`, s };
}

/** The pre-game line for a board player: what his next qualifying game would do, or null. */
export function featNext(board, row) {
  const m = featMove(board, row.name, row.now);
  return m ? { ...m, line: `${row.name}: his next ${board.one || board.label} would be his ${featOrd(m.after)}, ${m.what}` } : null;
}

/** Live: a hit (qualifies now and moves him) or a warning (one stat short by a step or less, and getting there would move
 *  him). `before` is his count entering tonight. -> { hit } | { warn: { k, more } } | null */
export function featLive(board, me, before, l) {
  if (qualifies(board, l)) { const m = featMove(board, me, before); return m ? { hit: m } : null; }
  const s = shortOf(board, l);
  if (!s || s.length !== 1 || s[0][1] > (FEAT_STEP[s[0][0]] || 0)) return null;
  if (board.max) return null;                         // a ceiling: only said once it stands
  const m = featMove(board, me, before);
  return m ? { warn: { k: s[0][0], more: s[0][1], move: m } } : null;
}
export const featWarnText = (board, w) => `${say(w.k, w.more)} from ${w.move.text.replace(/^his /, "his ")}`;

// ---- streaks ----
/** Does a line meet a streak's tests? */
export function streakMet(tests, l) {
  return (tests || []).every((x) => (x === "dd" ? isDd(l) : x === "td" ? isTd(l) : x === "start" ? !!l.starter : (Number(l[x.k]) || 0) >= x.min));
}
/** What a line still lacks for a streak's tests (stat tests only): [[stat, more]]. */
export function streakShort(tests, l) {
  const out = [];
  for (const x of tests || []) {
    if (x && x.k) { const m = x.min - (Number(l[x.k]) || 0); if (m > 0) out.push([x.k, m]); }
    else if (x === "dd" || x === "td") {
      const need = x === "dd" ? 2 : 3, tens = ["pts", "reb", "ast", "stl", "blk"].map((k) => [k, 10 - (Number(l[k]) || 0)]).sort((a, b) => a[1] - b[1]);
      for (const t of tens.slice(0, need)) if (t[1] > 0) out.push(t);
    }
  }
  return out;
}
export const shortText = (L) => L.map(([k, m]) => say(k, m)).join(" and ");

/** A team streak at stake tonight? kind winVs (wins vs one opponent, home games only if home), ptsVs (points vs one
 *  opponent), winHolding (wins when holding the opponent to `max` or fewer). -> { atStake, met, ended, inDanger } */
export function teamStake(t, g) {
  const us = Number(g.us) || 0, them = Number(g.them) || 0;
  if ((t.kind === "winVs" || t.kind === "ptsVs") && (g.opp !== t.opp || (t.home && !g.home))) return { atStake: false };
  if (t.kind === "ptsVs") return { atStake: true, met: us >= t.min, ended: g.final && us < t.min, inDanger: !g.final && g.late && us < t.min };
  if (t.kind === "winVs") return { atStake: true, met: g.final && us > them, ended: g.final && us < them, inDanger: !g.final && g.late && us <= them };
  if (t.kind === "winHolding") {
    if (them > t.max) return { atStake: false, off: true };
    return { atStake: true, met: g.final && us > them, ended: g.final && us < them, inDanger: !g.final && g.late && us <= them };
  }
  return { atStake: false };
}
