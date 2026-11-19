/**
 * Shifts: where a player's season changes (0.120.0; pure, no imports).
 *
 * The user, 11/19 3:20 PM: "Do you tracking shooting slumps or hot shooting stretches? I guess it would be similar to a
 * team's record for one timeframe compared to a more recent time frame… player stats over a period of time to see how
 * stats are shifting… the hot and cold checker… seems limited on scope over a recent 5-game period and only includes
 * points, rebounds, and assists. maybe build off that outline to find these fluctuations on performance".
 *
 * The idea is the team stretches' (seasonlong.js `stretches`, the user's "it's always a sliding scale"), applied to a
 * player and to every column: his season in one stat is cut into as many stretches as his numbers support, with no fixed
 * window, and the line is the stretch he is in now against the one before it.
 *
 *   - A percentage (FG%, 3P%, FT%, 2P%) is cut shot by shot: every attempt is a make or a miss, like a win or a loss, and
 *     a cut may only fall between games. A stretch needs SHIFT.min games and the stat's `att` attempts.
 *   - A counting number (points, rebounds, assists, steals, blocks, turnovers, threes, shots, free throw attempts,
 *     minutes) is cut game by game about each stretch's average.
 *   - A new stretch has to explain more than chance would: each one costs c × variance × ln(games). For a percentage the
 *     variance is 0.25 a shot (the most a shot can vary); for a counting number it is half the average squared change
 *     from one game to the next, which a change of level hardly moves.
 *   - The user's rule for teams holds here too: a short earlier stretch stops being a fair comparison once the current
 *     one has run past SHIFT.ratio times its length; then the current stretch is set against everything before it.
 *   - `z` is the gap between the two in units of what two samples of those sizes would show by chance.
 *   - `odds`: the honest measure. The cut is chosen after looking, so a big z is easy to find in pure noise. His same
 *     games are shuffled into random orders SHIFT.shuffles times and searched the same way; `odds` is "1 in N" random
 *     orders that show a shift at least this big (in either direction). On 11/19 of last season 83% of the shooting
 *     shifts at z 2+ and 75% of the counting ones at z 3+ were no more than shuffling produces, so the odds, not z, rank
 *     the rows. Nothing is cut for poor odds; the page chooses what to show.
 *
 * A game line: { d, min, pts, fgm, fga, fg3m, fg3a, ftm, fta, reb, ast, stl, blk, tov } (trends.js playerGames).
 */
export const SHIFT = { min: 3, c: 1.5, ratio: 4, games: 8, z: 2, shuffles: 200, role: 0.25, keep: 2 };
export const SHIFT_STATS = [
  { k: "fg", label: "FG%", kind: "rate", made: (g) => g.fgm, att: (g) => g.fga, need: 25, word: "from the field" },
  { k: "fg3", label: "3P%", kind: "rate", made: (g) => g.fg3m, att: (g) => g.fg3a, need: 12, word: "from three" },
  { k: "fg2", label: "2P%", kind: "rate", made: (g) => g.fgm - g.fg3m, att: (g) => g.fga - g.fg3a, need: 15, word: "on twos" },
  { k: "ft", label: "FT%", kind: "rate", made: (g) => g.ftm, att: (g) => g.fta, need: 10, word: "at the line" },
  { k: "pts", label: "Points", kind: "count", v: (g) => g.pts, word: "points" },
  { k: "reb", label: "Rebounds", kind: "count", v: (g) => g.reb, word: "rebounds" },
  { k: "ast", label: "Assists", kind: "count", v: (g) => g.ast, word: "assists" },
  { k: "fg3m", label: "Threes made", kind: "count", v: (g) => g.fg3m, word: "threes" },
  { k: "fga", label: "Shots", kind: "count", v: (g) => g.fga, word: "shots" },
  { k: "fta", label: "Free throw attempts", kind: "count", v: (g) => g.fta, word: "free throw attempts" },
  { k: "stl", label: "Steals", kind: "count", v: (g) => g.stl, word: "steals" },
  { k: "blk", label: "Blocks", kind: "count", v: (g) => g.blk, word: "blocks" },
  { k: "tov", label: "Turnovers", kind: "count", v: (g) => g.tov, word: "turnovers", lowGood: true },
  { k: "min", label: "Minutes", kind: "count", v: (g) => g.min, word: "minutes" },
];

/**
 * Cut a sequence into stretches: [[from, to), …] over game indexes. Exact (every cut is tried).
 *   cost(i, j): what stretch [i, j) leaves unexplained · ok(i, j): may [i, j) be a stretch? · pen: the price of one stretch
 */
function cut(n, cost, ok, pen) {
  if (!n) return [];
  const F = Array(n + 1).fill(Infinity), P = Array(n + 1).fill(0);
  F[0] = -pen;
  for (let j = 1; j <= n; j++) for (let i = 0; i < j; i++) {
    if (F[i] === Infinity || !ok(i, j)) continue;
    const v = F[i] + cost(i, j) + pen;
    if (v < F[j] - 1e-12) { F[j] = v; P[j] = i; }
  }
  if (F[n] === Infinity) return [[0, n]];
  const out = []; for (let j = n; j > 0; j = P[j]) out.unshift([P[j], j]);
  return out;
}
const prefix = (a) => { const S = [0]; for (const v of a) S.push(S[S.length - 1] + v); return S; };

/** A percentage: makes and attempts a game -> stretches. */
export function rateStretches(made, att, { min = SHIFT.min, need = 10, c = SHIFT.c } = {}) {
  const n = made.length, M = prefix(made), A = prefix(att);
  if (A[n] < 2 * need || n < 2 * min) return n ? [[0, n]] : [];
  const cost = (i, j) => { const a = A[j] - A[i], m = M[j] - M[i]; return a > 0 ? m - (m * m) / a : 0; };
  // ln(games), not ln(shots): a cut may only fall between games, so the games are what a chance cut is searched over
  return cut(n, cost, (i, j) => j - i >= min && A[j] - A[i] >= need, c * 0.25 * Math.log(n));
}
/** A counting number a game -> stretches. `noise`: the variance of one game about its stretch's level. */
export function countStretches(vals, { min = SHIFT.min, c = SHIFT.c } = {}) {
  const n = vals.length;
  if (n < 2 * min) return n ? [[0, n]] : [];
  const S = prefix(vals), Q = prefix(vals.map((v) => v * v)), noise = noiseOf(vals);
  const cost = (i, j) => { const s = S[j] - S[i]; return Q[j] - Q[i] - (s * s) / (j - i); };
  return cut(n, cost, (i, j) => j - i >= min, c * noise * Math.log(n));
}
/** Half the average squared change from one game to the next (a change of level moves it by one term only). At least 0.25. */
export function noiseOf(vals) {
  if (vals.length < 2) return 0.25;
  let s = 0; for (let i = 1; i < vals.length; i++) s += (vals[i] - vals[i - 1]) ** 2;
  return Math.max(0.25, s / (2 * (vals.length - 1)));
}

const r1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;

/** The current stretch against the one before, for one stat: { z, ci, cj, wf, all, now, was, season } or null. */
function shiftOf(st, games) {
  const n = games.length;
  if (st.kind === "rate") {
    const made = games.map((g) => Math.max(0, st.made(g) || 0)), att = games.map((g) => Math.max(0, st.att(g) || 0)), M = prefix(made), A = prefix(att);
    const segs = rateStretches(made, att, { need: st.need });
    if (segs.length < 2) return null;
    const side = (i, j) => ({ n: j - i, made: M[j] - M[i], att: A[j] - A[i], v: A[j] - A[i] > 0 ? (100 * (M[j] - M[i])) / (A[j] - A[i]) : null, size: A[j] - A[i] });
    const [ci, cj] = segs[segs.length - 1], [pi] = segs[segs.length - 2], now = side(ci, cj);
    let was = side(pi, ci), all = false;
    if (now.size > SHIFT.ratio * was.size) { was = side(0, ci); all = true; }
    if (now.v == null || was.v == null || was.att < st.need) return null;
    const p = (now.made + was.made) / (now.att + was.att), se = Math.sqrt(p * (1 - p) * (1 / now.att + 1 / was.att));
    if (!(se > 0)) return null;
    return { z: (now.v - was.v) / 100 / se, ci, cj, wf: all ? 0 : pi, all, now, was, season: A[n] > 0 ? (100 * M[n]) / A[n] : null };
  }
  const vals = games.map((g) => Number(st.v(g)) || 0), S = prefix(vals), segs = countStretches(vals);
  if (segs.length < 2) return null;
  const side = (i, j) => ({ n: j - i, v: (S[j] - S[i]) / (j - i), size: j - i });
  const [ci, cj] = segs[segs.length - 1], [pi] = segs[segs.length - 2], now = side(ci, cj);
  let was = side(pi, ci), all = false;
  if (now.size > SHIFT.ratio * was.size) { was = side(0, ci); all = true; }
  const se = Math.sqrt(noiseOf(vals) * (1 / now.n + 1 / was.n));
  return { z: (now.v - was.v) / se, ci, cj, wf: all ? 0 : pi, all, now, was, season: S[n] / n };
}

/** A small seeded generator (the build must give the same odds twice). */
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/**
 * In how many random orders of the same games does a shift at least this big show up? -> N of "1 in N" (at most
 * shuffles + 1, which means "none of the shuffles").
 */
export function chanceOdds(st, games, z, { shuffles = SHIFT.shuffles, seed = 1 } = {}) {
  const r = rng(seed), b = games.slice(); let hit = 0;
  for (let k = 0; k < shuffles; k++) {
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = b[i]; b[i] = b[j]; b[j] = t; }
    const s = shiftOf(st, b);
    if (s && Math.abs(s.z) >= Math.abs(z) - 1e-9) hit++;
  }
  return Math.round(((shuffles + 1) / (hit + 1)) * 10) / 10;
}

/**
 * One player's shifts, one a stat that has a current stretch to compare:
 * [{ k, label, kind, up, good, z, odds, role, now: { n, from, to, v, made?, att?, min }, was: { n, from, to, v, made?, att?, min, all }, season, text }]
 * `was.all`: the current stretch is set against everything before it (the earlier stretch was too short to be fair).
 * `role`: his minutes moved by SHIFT.role (a quarter) or more between the two, so the change may be about his role.
 */
export function playerShifts(games, name = "He", { odds = true, id = "" } = {}) {
  const out = [], n = games.length;
  if (n < SHIFT.games) return out;
  const mins = prefix(games.map((g) => g.min || 0));
  for (const st of SHIFT_STATS) {
    const s = shiftOf(st, games);
    if (!s) continue;
    const r = row(st, games, name, { up: s.z > 0, ...s, mins });
    if (odds) r.odds = chanceOdds(st, games, s.z, { seed: hash(`${id}|${st.k}|${n}`) });
    out.push(r);
  }
  return out.sort((a, b) => (b.odds ?? 0) - (a.odds ?? 0) || Math.abs(b.z) - Math.abs(a.z));
}

function row(st, games, name, { up, z, ci, cj, wf, all, now, was, mins, season }) {
  const mpg = (i, j) => (mins[j] - mins[i]) / (j - i);
  const N = { n: now.n, from: games[ci].d, to: games[cj - 1].d, v: now.v, min: mpg(ci, cj), ...(st.kind === "rate" ? { made: now.made, att: now.att } : {}) };
  const W = { n: was.n, from: games[wf].d, to: games[ci - 1].d, v: was.v, min: mpg(wf, ci), all, ...(st.kind === "rate" ? { made: was.made, att: was.att } : {}) };
  const g = (k) => `${k} game${k === 1 ? "" : "s"}`, before = all ? `his first ${g(W.n)}` : `the ${g(W.n)} before`;
  const text = st.kind === "rate"
    ? `${name} is shooting ${r1(N.v)}% ${st.word} over his last ${g(N.n)} (${N.made}-for-${N.att}, since ${md(N.from)}), ${up ? "up" : "down"} from ${r1(W.v)}% over ${before} (${W.made}-for-${W.att})`
    : `${name} is averaging ${r1(N.v)} ${st.word} over his last ${g(N.n)} (since ${md(N.from)}), ${up ? "up" : "down"} from ${r1(W.v)} over ${before}`;
  const role = st.k !== "min" && W.min > 0 && Math.abs(N.min - W.min) / W.min >= SHIFT.role;
  return { k: st.k, label: st.label, kind: st.kind, up, good: st.lowGood ? !up : up, z: Math.round(z * 100) / 100, role, now: N, was: W, season, text };
}

/** How many player-and-stat pairs were looked at (so the page can say how many "1 in N" rows chance alone would give). */
export const pairsSearched = (pg) => Object.values(pg || {}).filter((g) => g.length >= SHIFT.games).length * SHIFT_STATS.length;

/**
 * Every player's shifts: [{ id, name, team, games, ...shift }], the least likely by chance first.
 *   pg: { id: [game lines in date order] } · names: { id: name } · teamOf: (id, lastTeam) => his team today
 */
export function allShifts(pg, names = {}, teamOf = (id, t) => t, { odds = true } = {}) {
  const out = [];
  for (const [id, games] of Object.entries(pg || {})) {
    if (games.length < SHIFT.games) continue;
    const name = names[id] || id, team = teamOf(id, games[games.length - 1].team);
    for (const s of playerShifts(games, name, { odds, id })) out.push({ id, name, team, games: games.length, last: games[games.length - 1].d, ...s });
  }
  return out.sort((a, b) => (b.odds ?? 0) - (a.odds ?? 0) || Math.abs(b.z) - Math.abs(a.z) || a.name.localeCompare(b.name));
}

/**
 * What the same search finds in a league with no real shifts: every player's own games put in a random order, searched
 * and given odds the same way, `passes` times over. -> { stat: { 5: rows at 1 in 5 or rarer (average a pass), 10: …, 20: …, 50: … } }
 * The page sets this beside the real counts, so "38 rows" can be read against "31 in a shuffled league".
 */
export const CHANCE_LEVELS = [5, 10, 20, 50];
export function chanceCounts(pg, { passes = 2, shuffles = 100, seed = 20261119 } = {}) {
  const r = rng(seed), out = Object.fromEntries(SHIFT_STATS.map((t) => [t.k, Object.fromEntries(CHANCE_LEVELS.map((n) => [n, 0]))]));
  for (let p = 0; p < passes; p++) for (const [id, games] of Object.entries(pg || {})) {
    if (games.length < SHIFT.games) continue;
    const b = games.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = b[i]; b[i] = b[j]; b[j] = t; }
    for (const st of SHIFT_STATS) {
      const s = shiftOf(st, b); if (!s) continue;
      const odds = chanceOdds(st, b, s.z, { shuffles, seed: hash(`${id}|${st.k}|${p}`) });
      for (const n of CHANCE_LEVELS) if (odds >= n) out[st.k][n] += 1 / passes;
    }
  }
  for (const k of Object.keys(out)) for (const n of CHANCE_LEVELS) out[k][n] = Math.round(out[k][n] * 10) / 10;
  return out;
}

/**
 * 0.121.0: the strongest shifts on tonight's teams, as Watch List lines (the user, 11/19, on the Shifts table: "this is
 * definitely a lot to try to comb through every day. are the most significant ones posted in the watch list?").
 * One line a player (his least-likely-by-chance shift), only players in the rotation now, and a counting stat that moved
 * with his minutes is left to the minutes line itself. A team gets at most STORY.shoot shooting lines and STORY.team
 * others: shooting has its own place (and a small bonus) because it is what the user asked for first and because minutes
 * changes, the commonest real shift, would otherwise take every place.
 *   rows: allShifts() · teams: Set of tonight's teams
 * -> [{ kind: "shift", team, player, id, key, text, score }]
 */
export const STORY = { odds: 20, min: 20, team: 2, shoot: 1, base: 3.2, top: 4.2, shootBonus: 0.3 };
export function shiftStoryLines(rows, teams) {
  const best = new Map();
  for (const r of rows || []) {
    if (!teams.has(r.team) || !(r.odds >= STORY.odds) || r.now.min < STORY.min || (r.role && r.k !== "min")) continue;
    const cur = best.get(r.id);
    if (!cur || r.odds > cur.odds || (r.odds === cur.odds && Math.abs(r.z) > Math.abs(cur.z))) best.set(r.id, r);
  }
  // his best shooting shift is kept beside his best other one, so a team's shooting place can be filled
  const shootBest = new Map();
  for (const r of rows || []) {
    if (r.kind !== "rate" || !teams.has(r.team) || !(r.odds >= STORY.odds) || r.now.min < STORY.min) continue;
    const cur = shootBest.get(r.id);
    if (!cur || r.odds > cur.odds) shootBest.set(r.id, r);
  }
  const perTeam = {}, out = [], said = new Set();
  const pool = [...new Set([...best.values(), ...shootBest.values()])].sort((a, b) => b.odds - a.odds || Math.abs(b.z) - Math.abs(a.z));
  for (const r of pool) {
    const slot = `${r.team}|${r.kind === "rate" ? "shoot" : "other"}`, cap = r.kind === "rate" ? STORY.shoot : STORY.team;
    if (said.has(r.id) || (perTeam[slot] || 0) >= cap) continue;
    perTeam[slot] = (perTeam[slot] || 0) + 1; said.add(r.id);
    const odds = r.odds > SHIFT.shuffles ? `under 1 in ${SHIFT.shuffles}` : `1 in ${Math.round(r.odds)}`;
    // the more unlikely by chance, the higher: 1 in 20 scores STORY.base, "none of the shuffles" STORY.top
    const score = Math.round((STORY.base + (r.kind === "rate" ? STORY.shootBonus : 0) + (STORY.top - STORY.base) * Math.min(1, Math.log(r.odds / STORY.odds) / Math.log((SHIFT.shuffles + 1) / STORY.odds))) * 100) / 100;
    out.push({ kind: "shift", team: r.team, player: r.name, id: r.id, key: `shift|${r.id}|${r.k}`, text: `${r.text} (by chance: ${odds})`, score });
  }
  return out;
}
