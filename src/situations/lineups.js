/**
 * Lineups from NBA.com's rotations (0.151.0; the user, 11/24: "it could be used to get lineup data for two-man, three-man,
 * four-man, or five-man lineups?", then "go for" it).
 *
 * NBA.com's gamerotation gives every stint: a player's check-in and check-out to the tenth of a second from the opening
 * tip (tools/fetch-rotations.mjs). Between any two of those moments the same five are on the floor for a team. Those
 * stretches ("intervals") are joined to the score from the play-by-play we already keep for Game Flow (each scoring play's
 * period and clock), so each interval knows the points scored for and against while those five were on.
 *
 * Browser-safe and pure. The site's build writes every interval (docs/data/lineups.json); the page adds them up for any
 * two, three, four or five players and any cut (quarter, clutch, opponent, dates).
 */

export const REG = 7200, OT = 3000;   // tenths of a second in a quarter and in an overtime
/** Tenths of a second from the opening tip at the start of a period. */
export const periodStart = (p) => (p <= 4 ? (p - 1) * REG : 4 * REG + (p - 5) * OT);
export const periodLen = (p) => (p <= 4 ? REG : OT);
/** "PT11M34.50S" (or seconds) -> tenths left in the period. */
export function clockTenths(c) {
  if (typeof c === "number") return Math.round(c * 10);
  const m = /PT(?:(\d+)M)?(?:([\d.]+)S)?/.exec(String(c || ""));
  return m ? Math.round(((+m[1] || 0) * 60 + (+m[2] || 0)) * 10) : null;
}
/** Elapsed tenths at an action. */
export const elapsedAt = (period, clock) => { const left = clockTenths(clock); return left == null ? null : periodStart(period) + periodLen(period) - left; };

/**
 * Scoring events from play-by-play actions ({ period, clock, scoreHome, scoreAway }): [[t, homePts, awayPts]] where the
 * points are what that play added, and 1 when a substitution at the same moment is listed before it (see teamIntervals).
 */
export function scoringEvents(actions) {
  const out = []; let h = 0, a = 0, subAt = null;
  for (const x of actions || []) {
    if (x.actionType === "substitution") { subAt = elapsedAt(x.period, x.clock); continue; }
    if (x.scoreHome == null || x.scoreAway == null) continue;
    const H = +x.scoreHome, A = +x.scoreAway;
    if (!Number.isFinite(H) || !Number.isFinite(A) || (H === h && A === a)) continue;
    const t = elapsedAt(x.period, x.clock);
    if (t == null) continue;
    out.push([t, H - h, A - a, subAt === t ? 1 : 0]); h = H; a = A;   // 1: a substitution at this same moment came first
  }
  return { events: out, home: h, away: a };
}

/**
 * One team's intervals in one game. stints: [[personId, name, in, out, ...]] (tenths). events: scoringEvents(...).events,
 * with `home` saying which side is this team. -> { iv: [[t0, t1, [5 ids], pf, pa, marginBefore]], short: n } where short counts
 * stretches without exactly five (a data gap; they are left out).
 */
export function teamIntervals(stints, events, home) {
  // cut at every check-in and check-out, at each period's start, and where clutch time can begin (5:00 left in the 4th)
  const end = Math.max(...stints.map((s) => s[3]));
  const fixed = [REG, 2 * REG, 3 * REG, CLUTCH_FROM, 4 * REG]; for (let t = 4 * REG + OT; t < end; t += OT) fixed.push(t);
  const cuts = [...new Set([...stints.flatMap((s) => [s[2], s[3]]), ...fixed.filter((t) => t < end)])].sort((x, y) => x - y);
  const iv = []; let short = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const t0 = cuts[i], t1 = cuts[i + 1];
    if (t1 <= t0) continue;
    const on = [...new Set(stints.filter((s) => s[2] <= t0 && s[3] >= t1).map((s) => String(s[0])))].sort();
    if (on.length !== 5) { short++; continue; }
    let pf = 0, pa = 0, before = 0;
    // A point at the very moment of a substitution belongs to the five before it. (Tried 11/24: giving free throws, or
    // points the play-by-play lists after a substitution at that moment, to the five after matched ESPN's plus-minus for
    // 27% and 81% of player-games; this rule, 97%.)
    const inside = (t) => (t > t0 && t <= t1) || (t0 === 0 && t === 0);
    for (const [t, dh, da] of events) {
      const f = home ? dh : da, g = home ? da : dh;
      if (inside(t)) { pf += f; pa += g; } else if (t <= t0) before += f - g;
    }
    iv.push([t0, t1, on, pf, pa, before]);   // before: this team's margin when the stretch began
  }
  return { iv, short };
}

/** Every k-player group in a list (k of 2 to 5). */
export function groups(ids, k) {
  const out = [], pick = (start, acc) => { if (acc.length === k) { out.push(acc.join("|")); return; } for (let i = start; i < ids.length; i++) pick(i + 1, [...acc, ids[i]]); };
  pick(0, []); return out;
}

/**
 * Add up intervals for k-player groups. iv rows: { t0, t1, on: [5 ids], pf, pa } (plus anything a filter reads).
 * -> Map key -> { ids, sec, pf, pa, games:Set } (seconds, points for and against).
 */
export function aggregate(rows, k) {
  const M = new Map();
  for (const r of rows) {
    const sec = (r.t1 - r.t0) / 10;
    for (const key of k === 5 ? [r.on.join("|")] : groups(r.on, k)) {
      const u = M.get(key) || { ids: key.split("|"), sec: 0, pf: 0, pa: 0, games: new Set() };
      u.sec += sec; u.pf += r.pf; u.pa += r.pa; u.games.add(r.g);
      M.set(key, u);
    }
  }
  return M;
}

/** Clutch time as the NBA defines it: the last five minutes of the 4th quarter or overtime, the score within five. */
export const CLUTCH_FROM = 4 * REG - 3000;   // 5:00 left in the 4th; every overtime is five minutes, so all of it
export const isClutch = (t0, marginBefore) => t0 >= CLUTCH_FROM && Math.abs(marginBefore) <= 5;

/** Seconds on the floor for each player in a game, from the stints (exact, from NBA.com). */
export function secondsPlayed(stints) {
  const s = {};
  for (const x of stints) s[String(x[0])] = (s[String(x[0])] || 0) + (x[3] - x[2]) / 10;
  return s;
}
