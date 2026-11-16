/*
 * Season facts read from the nightly Game Flow files (docs/data/flow/<season>/<id>.json), for NBA Live's
 * bridge (docs/bridge/cc-bridge.js v5) and the Command Center. 0.59.0.
 *
 *   flowStats(entries) -> {
 *     games,
 *     quarters:     the season's best single quarters by a player (points, regulation quarters), best first
 *     halves:       the same for halves (Q1+Q2, Q3+Q4)
 *     teamQuarters: the best quarters by a team
 *     full (0.79):  { halves: [{ id, name, team, opp, h, min, pts, gameId, date }], games: [...], fives: [{ team, opp, h, names }] }
 *     by10 (0.79):  { TRI: { gp, upW, upL, downW, downL, run: [{ lead, opp, d }], longest, last } }   leading / trailing by 10+
 *     swing (0.79): [{ id, name, team, m, a, gp }]   shots to tie or take the lead in the last 90 seconds of the 4th / OT
 *     rotation:     { personId: { name, team, gp, starts, out1, back, in1, out3, full1, open3, n } }   median elapsed seconds
 *                   out1  a starter's first check-out in Q1      back  his first return after it, first half
 *                   in1   a reserve's first check-in             out3  a starter's first check-out in Q3
 *                   full1 starts in which he played all of Q1   open3 starts in which he opened the 3rd quarter
 *                   n     how many games each median rests on
 *     fouls:        { personId: { name, team, gp, trouble, out, troubleIn, outIn } }  games in early foul trouble
 *                   (fouls > period) and foul-outs, with their game ids (so a card never counts tonight's game twice)
 *     leads:        { tri: { gp, blown: [..], comebacks: [..] } } leads of LEAD_MIN+ lost / deficits of LEAD_MIN+ won
 *     leftEarly:    starters who left in the first half and never returned (not foul-outs), who usually play the 2nd half
 *     leadTable:    Game Flow's "Leads & comebacks" rows for the full season (so the page needn't read every game)
 *   }
 *
 * entries: [{ row, c }] where row is the results-store game (id, d, h, a) and c the compact flow file.
 * Elapsed seconds count from the opening tip (Q2 starts at 720), the same clock as NBA Live's playToAbsT.
 */
import { expandFeeds } from "./feeds.js";
import { buildStints, REG_LEN } from "./model.js";

export const LEAD_MIN = 15;
export const CLOSE_PTS = 5;      // "close late": within 5 in the last five minutes of regulation
export const REST_LEAD = 15;     // sat the 4th with his team up this many after three: rest, not a benching
const FINISH_SEC = 90;           // "finished the game": on the floor for at least half of the last three minutes
export const TOP_N = 30;
const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1;
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

/* The slice of a game's model that Game Flow's Scoring highs and Assist leaderboard read (0.60): one season file of
   these instead of every game file. Same fields, same values, as buildStints gives the page. */
export function liteModel(G) {
  return { box: { homeTeam: { teamTricode: G.box.homeTeam.teamTricode }, awayTeam: { teamTricode: G.box.awayTeam.teamTricode } }, maxP: G.maxP,
    players: G.players.filter((p) => p.played).map((p) => ({ id: p.id, name: p.name, tri: p.tri, side: p.side, played: p.played, jersey: p.jersey, ptsByPeriod: p.ptsByPeriod })),
    assists: G.assists.map((a) => ({ from: a.from, to: a.to, side: a.side, pts: a.pts })) };
}

export function gameFacts(row, c, lite) {
  const { pbp, box } = expandFeeds(c);
  const G = buildStints(pbp, box);
  if (lite) lite[String(row.id || c.id)] = liteModel(G);
  const tri = [G.teams[0].teamTricode, G.teams[1].teamTricode];
  const base = { gameId: String(row.id || c.id), date: row.d || null };
  const players = G.players.filter((p) => p.played).map((p) => {
    const st = p.stints;
    const inQ = (a, b) => st.filter((s) => s.st >= a - 1e-6 && s.st < b);
    const q1 = inQ(0, REG_LEN), first = st[0];
    let out1 = null, back = null, in1 = null, out3 = null, full1 = false, open3 = false;
    if (p.starter && first && first.st < 1e-6) {
      if (first.et < REG_LEN - 1e-6) out1 = first.et; else full1 = true;
      const next = st[1];
      if (out1 != null && next && next.st < 2 * REG_LEN) back = next.st;
      // On the floor when the second half opened (a stint that runs through the half-time seam counts).
      const s3 = st.find((s) => s.st <= 2 * REG_LEN + 1e-6 && s.et > 2 * REG_LEN + 1e-6);
      open3 = !!s3 && G.maxP >= 3;
      if (s3 && s3.et < 3 * REG_LEN - 1e-6) out3 = s3.et;
    } else if (!p.starter && first) in1 = first.st;
    const pp = p.ptsByPeriod || {};
    // 0.72.6 (fourth-quarter minutes): seconds on the floor in the 4th, and in the last three minutes of regulation.
    const on = (a, b) => st.reduce((n, s) => n + Math.max(0, Math.min(s.et, b) - Math.max(s.st, a)), 0);
    const q4 = on(3 * REG_LEN, 4 * REG_LEN), last3 = on(4 * REG_LEN - 180, 4 * REG_LEN), second = on(2 * REG_LEN, 3 * REG_LEN);
    // 0.79 (the user, 11/16: "checking for players who play full halves (rare) and full games (almost never)"): on the
    // floor for every second of a half, or of the whole game with its overtimes.
    const gameLen = 4 * REG_LEN + Math.max(0, G.maxP - 4) * 300;
    const fullH1 = G.maxP >= 2 && on(0, 2 * REG_LEN) >= 2 * REG_LEN - 1, fullH2 = G.maxP >= 4 && on(2 * REG_LEN, 4 * REG_LEN) >= 2 * REG_LEN - 1;
    const fullGame = G.maxP >= 4 && on(0, gameLen) >= gameLen - 1;
    return { id: String(p.id), name: p.name, team: tri[p.side], opp: tri[1 - p.side], starter: !!p.starter, q4, last3, second, fullH1, fullH2, fullGame,
      q: [1, 2, 3, 4].map((k) => pp[k] || 0), out1, back, in1, out3, full1, open3, q1n: q1.length,
      lastOut: st.length ? st[st.length - 1].et : null, min: Math.round(p.calcMin || 0), mins: p.calcMin || 0, pts: p.boxPts || 0,
      trouble: !!p.troubleFrom, fouledOut: !!p.fouledOut };
  });
  // Biggest lead each side held, from the score flow (home minus away), and who won.
  let maxHome = 0, maxAway = 0;
  for (const f of G.flow) { if (f.d > maxHome) maxHome = f.d; if (-f.d > maxAway) maxAway = -f.d; }
  const hs = box.game.homeTeam.score, as = box.game.awayTeam.score;
  // Close late: within CLOSE_PTS at some moment of the last five minutes of regulation (the margin entering them counts).
  let entering = 0, closeLate = false;
  for (const f of G.flow) {
    if (f.t < 4 * REG_LEN - 300) entering = f.d;
    else if (f.t <= 4 * REG_LEN && Math.abs(f.d) <= CLOSE_PTS) closeLate = true;
  }
  if (Math.abs(entering) <= CLOSE_PTS) closeLate = true;
  const after3 = [0, 1].map((side) => G.per[side].filter((x) => x.p <= 3).reduce((a, x) => a + x.pts, 0));
  const teams = [0, 1].map((side) => ({ team: tri[side], opp: tri[1 - side], won: side ? hs > as : as > hs, home: side === 1, after3: after3[side] - after3[1 - side],
    neverLed: !!(G.everLed && !G.everLed[side]), neverTrailed: !!(G.everLed && !G.everLed[1 - side]),
    held: !!(G.leadState && G.leadState[side] && G.leadState[side].held), heldStrict: !!(G.leadState && G.leadState[side] && G.leadState[side].heldStrict),
    maxLead: side ? maxHome : maxAway, maxDown: side ? maxAway : maxHome,
    q: G.per[side].filter((x) => x.p <= 4).map((x) => x.pts), score: side ? hs : as, oppScore: side ? as : hs }));
  return { ...base, players, teams, closeLate, periods: G.maxP, l2m: lastTwo(pbp, G, tri), shots: shotLog(pbp, G, tri), swing: swingShots(pbp, G) };
}

/**
 * Shots to tie or take the lead late (0.79; a post the user sent, 11/16: "6-for-7 when taking a shot to tie or take
 * the lead in the final 90 seconds of the 4th or OT"). A field goal attempt in the last SWING_SEC seconds of the 4th
 * quarter or an overtime, by a team tied or behind, that would tie the game or put it ahead if it went in (a two when
 * down 0-2, a three when down 0-3). Free throws are not counted. -> { id: { m, a } }
 */
export const SWING_SEC = 90;
function swingShots(pbp, G) {
  const A = (pbp.game && pbp.game.actions) || pbp.actions || [];
  const side = {};
  for (const p of G.players) side[String(p.id)] = p.side;
  const out = {};
  let home = 0, away = 0;
  for (const a of A) {
    const isShot = a.actionType === "2pt" || a.actionType === "3pt";
    const left = clockLeft(a.clock), id = a.personId ? String(a.personId) : null, sd = id != null ? side[id] : null;
    if (isShot && a.period >= 4 && left != null && left <= SWING_SEC && sd != null) {
      const v = a.actionType === "3pt" ? 3 : 2, made = a.shotResult === "Made";
      // The score before the shot: a made shot's own row already carries its points.
      let h = home, w = away;
      if (made && a.scoreHome != null && a.scoreHome !== "") { h = Number(a.scoreHome) - (sd === 1 ? v : 0); w = Number(a.scoreAway) - (sd === 0 ? v : 0); }
      const behind = sd === 1 ? w - h : h - w;
      if (behind >= 0 && behind <= v) { const L = (out[id] ??= { m: 0, a: 0 }); L.a++; if (made) L.m++; }
    }
    if (a.scoreHome != null && a.scoreHome !== "") { home = Number(a.scoreHome); away = Number(a.scoreAway); }
  }
  return out;
}

/**
 * Every shot of a game, per player, in order, each with the seconds he had been on the floor when he took it (0.75; the
 * user, 11/15: "is there anyway to track consecutive made shots over multiple games… longest time without a made field
 * goal… longest time played without a free-throw attempt"). -> { id: { name, team, total (court seconds), ev: [[courtSec, "2"|"3"|"F", made]] } }
 */
function shotLog(pbp, G, tri) {
  const A = (pbp.game && pbp.game.actions) || pbp.actions || [];
  const out = {};
  const by = {};
  for (const p of G.players) if (p.played) { by[String(p.id)] = p; out[String(p.id)] = { name: p.name, team: tri[p.side], total: Math.round(p.stints.reduce((n, x) => n + (x.et - x.st), 0)), ev: [] }; }
  for (const a of A) {
    const k = a.actionType === "2pt" ? "2" : a.actionType === "3pt" ? "3" : a.actionType === "freethrow" ? "F" : null;
    const p = k && a.personId ? by[String(a.personId)] : null;
    const left = p ? clockLeft(a.clock) : null;
    if (!p || left == null || !a.shotResult) continue;
    const per = Number(a.period) || 1;
    const t = per <= 4 ? per * REG_LEN - left : 4 * REG_LEN + (per - 4) * 300 - left;
    const on = p.stints.reduce((n, x) => n + Math.max(0, Math.min(x.et, t) - x.st), 0);
    out[String(p.id)].ev.push([Math.round(on), k, a.shotResult === "Made"]);
  }
  return out;
}

/**
 * Runs that cross games: makes in a row (field goals, threes, free throws), misses in a row, and court time since his
 * last made field goal and since his last free-throw attempt. Active runs per player (pruned to the notable), and the
 * season's longest of each for scale.
 *   games: [{ date, shots: gameFacts().shots }], any order.
 */
export const BIG_QUARTER = 20;
const plainName = (n) => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
/**
 * Lists seeded from a team's notes (src/data/seeded-lists.json), counted forward (0.76; the user, 11/16, on the Suns'
 * "MOST 20+ POINT QUARTERS IN THE NBA SINCE 2016-17 (STATHEAD)"). Each row's count is the printed one plus the
 * player's quarters at that level dated after the list's `through` day.
 *   bigQuarters: flowStats().bigQuarters; teamOf: plain name -> team code, for tonight's slate
 *   -> [{ id, what, since, source, through, min, rows: [{ name, n, added, team }] }], rows best first
 */
export function seededCounts(lists, bigQuarters, teamOf = {}) {
  return (lists || []).filter((l) => l.event?.type === "quarter" && l.event.min >= BIG_QUARTER).map((l) => {
    const rows = l.rows.map(([name, n]) => {
      const k = plainName(name);
      const added = (bigQuarters || []).filter((q) => plainName(q.name) === k && q.pts >= l.event.min && String(q.date).slice(0, 10) > l.through).length;
      return { name, n: n + added, added, team: teamOf[k] || null };
    }).sort((a, b) => b.n - a.n);
    return { id: l.id, what: l.what, since: l.since, source: l.source, through: l.through, min: l.event.min, rows };
  });
}

export const SHOT_KEEP = { fg: 8, fg3: 5, ft: 20, fgMiss: 8, fg3Miss: 9, dryFg: 20 * 60, dryFt: 45 * 60 };
export function shotStreaks(games) {
  const P = {}, best = { fg: [], fg3: [], ft: [], dryFg: [], dryFt: [] };
  const fresh = (date) => ({ sec: 0, fga: 0, from: date, games: 0 });
  for (const g of [...games].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    for (const [id, x] of Object.entries(g.shots || {})) {
      const S = P[id] || (P[id] = { name: x.name, team: x.team, last: null, gp: 0, fta: 0, fg: 0, fg3: 0, ft: 0, fgMiss: 0, fg3Miss: 0, dryFg: fresh(g.date), dryFt: fresh(g.date) });
      S.team = x.team; S.last = g.date; S.gp++; S.fta += x.ev.filter((e) => e[1] === "F").length;
      const endMake = (k) => { if (S[k] >= SHOT_KEEP[k]) best[k].push({ n: S[k], name: S.name, team: S.team, from: S[`${k}From`], end: g.date }); S[k] = 0; };
      const endDry = (k, cs, mark) => { const d = S[k]; d.sec += cs - mark; if (d.sec >= SHOT_KEEP[k]) best[k].push({ sec: d.sec, fga: d.fga, name: S.name, team: S.team, from: d.from, end: g.date, games: d.games + 1 }); S[k] = fresh(g.date); };
      let markFg = 0, markFt = 0;
      for (const [cs, k, made] of x.ev) {
        if (k === "F") {
          endDry("dryFt", cs, markFt); markFt = cs;
          if (made) { if (!S.ft) S.ftFrom = g.date; S.ft++; } else endMake("ft");
          continue;
        }
        S.dryFt.fga++;
        if (made) { if (!S.fg) S.fgFrom = g.date; S.fg++; S.fgMiss = 0; endDry("dryFg", cs, markFg); markFg = cs; }
        else { endMake("fg"); if (!S.fgMiss) S.fgMissFrom = g.date; S.fgMiss++; S.dryFg.fga++; }
        if (k === "3") { if (made) { if (!S.fg3) S.fg3From = g.date; S.fg3++; S.fg3Miss = 0; } else { endMake("fg3"); if (!S.fg3Miss) S.fg3MissFrom = g.date; S.fg3Miss++; } }
      }
      S.dryFg.sec += x.total - markFg; S.dryFg.games++;
      S.dryFt.sec += x.total - markFt; S.dryFt.games++;
    }
  }
  const players = {};
  for (const [id, S] of Object.entries(P)) {
    for (const k of ["fg", "fg3", "ft"]) if (S[k] >= SHOT_KEEP[k]) best[k].push({ n: S[k], name: S.name, team: S.team, from: S[`${k}From`], end: S.last, active: true });
    for (const k of ["dryFg", "dryFt"]) if (S[k].sec >= SHOT_KEEP[k]) best[k].push({ ...S[k], name: S.name, team: S.team, end: S.last, active: true });
    if (S.fg >= SHOT_KEEP.fg || S.fg3 >= SHOT_KEEP.fg3 || S.ft >= SHOT_KEEP.ft || S.fgMiss >= SHOT_KEEP.fgMiss || S.fg3Miss >= SHOT_KEEP.fg3Miss || S.dryFg.sec >= SHOT_KEEP.dryFg || S.dryFt.sec >= SHOT_KEEP.dryFt) players[id] = S;
  }
  for (const k of ["fg", "fg3", "ft"]) best[k] = best[k].sort((a, b) => b.n - a.n).slice(0, 10);
  for (const k of ["dryFg", "dryFt"]) best[k] = best[k].sort((a, b) => b.sec - a.sec).slice(0, 10);
  return { players, best };
}

/**
 * The final two minutes (0.72.7; the user, 11/15: "clutch stats in the final 2 minutes of the 4th quarter to differentiate
 * from the final five minutes"). The league's Last Two Minute reports cover games within three points at any time in
 * the last two minutes of the 4th quarter or overtime; this is the same window: for each such period, everything from
 * 2:00 on. Clutch time (the last five minutes, within five) stays what it was.
 * -> null, or { periods, teams: [{ pf, pa }, { pf, pa }] (away, home), players: { id: { sec, pts, fgm, … pm } } }
 */
export const L2M_SEC = 120, L2M_PTS = 3;
const clockLeft = (c) => { const m = /PT(\d+)M([\d.]+)S/.exec(String(c || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
function lastTwo(pbp, G, tri) {
  const A = (pbp.game && pbp.game.actions) || pbp.actions || [];
  const side = {};
  for (const p of G.players) side[String(p.id)] = p.side;
  const endOf = (per) => (per <= 4 ? per * REG_LEN : 4 * REG_LEN + (per - 4) * 300);
  const out = { periods: 0, teams: [{ pf: 0, pa: 0 }, { pf: 0, pa: 0 }], players: {} };
  const line = (id) => (out.players[id] ??= { sec: 0, pts: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, reb: 0, tov: 0, pm: 0 });
  for (let per = 4; per <= G.maxP; per++) {
    const acts = A.filter((a) => a.period === per);
    let entering = null, close = false;
    const inWin = [];
    for (const a of acts) {
      const left = clockLeft(a.clock);
      if (left == null || a.scoreHome == null || a.scoreHome === "") continue;
      const d = Number(a.scoreHome) - Number(a.scoreAway);
      if (left > L2M_SEC) entering = d;
      else { inWin.push({ a, left, d }); if (Math.abs(d) <= L2M_PTS) close = true; }
    }
    if (entering != null && Math.abs(entering) <= L2M_PTS) close = true;
    if (!close || !inWin.length) continue;
    out.periods++;
    const end = endOf(per), start = end - L2M_SEC;
    // Who was on the floor, and for how long.
    for (const p of G.players) {
      const sec = p.stints.reduce((n, x) => n + Math.max(0, Math.min(x.et, end) - Math.max(x.st, start)), 0);
      if (sec > 0) line(String(p.id)).sec += sec;
    }
    // On the floor at t: in a stint that has begun and not ended (at the final horn, the ones that ran to it).
    const onAt = (t) => G.players.filter((p) => p.stints.some((x) => (x.st <= t + 1e-6 && x.et > t + 1e-6) || (t >= end - 1e-6 && x.et >= end - 1e-6 && x.st < end)));
    for (const { a, left } of inWin) {
      const id = a.personId ? String(a.personId) : null, sd = id != null ? side[id] : null;
      const made = a.shotResult === "Made";
      const pts = made ? (a.actionType === "3pt" ? 3 : a.actionType === "2pt" ? 2 : a.actionType === "freethrow" ? 1 : 0) : 0;
      if (id != null && sd != null) {
        const L = line(id);
        if (a.actionType === "2pt" || a.actionType === "3pt") { L.fga++; if (made) L.fgm++; if (a.actionType === "3pt") { L.fg3a++; if (made) L.fg3m++; } }
        else if (a.actionType === "freethrow") { L.fta++; if (made) L.ftm++; }
        else if (a.actionType === "rebound") L.reb++;
        else if (a.actionType === "turnover") L.tov++;
        L.pts += pts;
      }
      if (pts && sd != null) {
        out.teams[sd].pf += pts; out.teams[1 - sd].pa += pts;
        for (const p of onAt(end - left)) line(String(p.id)).pm += p.side === sd ? pts : -pts;
      }
    }
  }
  return out.periods ? out : null;
}

export function flowStats(entries, lite = null) {
  const quarters = [], halves = [], teamQuarters = [], rot = {}, fouls = {}, leads = {}, table = {}, early = [], fourth = {};
  const full = { halves: [], games: [], fives: [] }, swing = {}, led = {};
  const shotGames = [];
  const l2m = { games: 0, players: {}, teams: {} };
  const L2K = ["sec", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "tov", "pm"];
  let games = 0;
  for (const { row, c } of entries) {
    let F;
    try { F = gameFacts(row, c, lite); } catch { continue; }
    games++;
    const at = { gameId: F.gameId, date: F.date };
    // 0.79: full halves and full games, and a team whose five all played a whole half.
    for (const p of F.players) {
      for (const h of [1, 2]) if (p[h === 1 ? "fullH1" : "fullH2"]) full.halves.push({ id: p.id, name: p.name, team: p.team, opp: p.opp, h, min: p.min, pts: p.pts, ...at });
      if (p.fullGame) full.games.push({ id: p.id, name: p.name, team: p.team, opp: p.opp, min: p.min, pts: p.pts, ot: Math.max(0, F.periods - 4), ...at });
    }
    for (const t of F.teams) for (const h of [1, 2]) {
      const five = F.players.filter((p) => p.team === t.team && p[h === 1 ? "fullH1" : "fullH2"]);
      if (five.length >= 5) full.fives.push({ team: t.team, opp: t.opp, h, names: five.map((p) => p.name), ...at });
    }
    for (const [id, x] of Object.entries(F.swing || {})) {
      const who = F.players.find((p) => p.id === id); if (!who) continue;
      const S = swing[id] || (swing[id] = { id, name: who.name, team: who.team, m: 0, a: 0, gp: 0 });
      S.team = who.team; S.m += x.m; S.a += x.a; S.gp++;
    }
    for (const p of F.players) {
      // A starter who left in the first half and never came back (not a foul-out): injury news, more often than not.
      if (p.starter && p.lastOut != null && p.lastOut < 2 * REG_LEN - 1e-6 && !p.fouledOut)
        early.push({ id: p.id, name: p.name, team: p.team, opp: p.opp, out: p.lastOut, min: p.min, pts: p.pts, ...at });
      p.q.forEach((pts, k) => { if (pts >= 10) quarters.push({ pts, id: p.id, name: p.name, team: p.team, opp: p.opp, q: k + 1, ...at }); });
      [[0, 1], [2, 3]].forEach(([a, b], h) => { const pts = p.q[a] + p.q[b]; if (pts >= 15) halves.push({ pts, id: p.id, name: p.name, team: p.team, opp: p.opp, h: h + 1, ...at }); });
      const R = rot[p.id] || (rot[p.id] = { name: p.name, team: p.team, gp: 0, starts: 0, full1: 0, open3: 0, _min: 0, _o1: [], _b: [], _i1: [], _o3: [] });
      R.team = p.team; R.gp++; R._min += p.mins || 0;
      if (p.starter) R.starts++;
      if (p.full1) R.full1++;
      if (p.open3) R.open3++;
      if (p.out1 != null) R._o1.push(p.out1);
      if (p.back != null) R._b.push(p.back);
      if (p.in1 != null) R._i1.push(p.in1);
      if (p.out3 != null) R._o3.push(p.out3);
      // 0.72.6: a starter's fourth quarters. Sat it out (still playing after halftime, not fouled out), and whether he
      // was on the floor to finish the games that were close late.
      if (p.starter && F.periods >= 4 && p.second > 0 && !(p.fouledOut && p.q4 === 0)) {
        const Q = fourth[p.id] || (fourth[p.id] = { name: p.name, team: p.team, gs: 0, sat: 0, satLed: 0, satW: 0, satMargin: 0, satMin: null, satClose: 0, satPts: 0, satIn: [], close: 0, closed: 0, ends: [] });
        const T = F.teams.find((t) => t.team === p.team);
        if (Q.team !== p.team) Object.assign(Q, { team: p.team, gs: 0, sat: 0, satLed: 0, satW: 0, satMargin: 0, satMin: null, satClose: 0, satPts: 0, satIn: [], close: 0, closed: 0, ends: [] });   // traded: his new team's games only
        Q.gs++;
        if (p.q4 === 0) {
          Q.sat++; Q.satPts += p.pts; Q.satIn.push(F.gameId);
          if (T) { if (T.after3 >= REST_LEAD) Q.satLed++; if (T.won) Q.satW++; Q.satMargin += T.score - T.oppScore; const m = Math.abs(T.score - T.oppScore); Q.satMin = Q.satMin == null ? m : Math.min(Q.satMin, m); }
          if (F.closeLate) Q.satClose++;
        }
        if (F.closeLate) { const fin = p.last3 >= FINISH_SEC; Q.close++; if (fin) Q.closed++; Q.ends.push({ date: F.date, opp: p.opp, fin, gameId: F.gameId }); }
      }
      const Fo = fouls[p.id] || (fouls[p.id] = { name: p.name, team: p.team, gp: 0, trouble: 0, out: 0, troubleIn: [], outIn: [] });
      Fo.team = p.team; Fo.gp++;
      if (p.trouble) { Fo.trouble++; Fo.troubleIn.push(F.gameId); }
      if (p.fouledOut) { Fo.out++; Fo.outIn.push(F.gameId); }
    }
    shotGames.push({ date: F.date, shots: F.shots });
    if (F.l2m) {
      l2m.games++;
      const names = Object.fromEntries(F.players.map((p) => [p.id, p]));
      for (const [id, x] of Object.entries(F.l2m.players)) {
        const who = names[id]; if (!who) continue;
        const P = l2m.players[id] || (l2m.players[id] = { id, name: who.name, team: who.team, gp: 0, ...Object.fromEntries(L2K.map((k) => [k, 0])) });
        P.team = who.team; P.gp++;
        for (const k of L2K) P[k] += x[k];
      }
      F.teams.forEach((t, side) => {
        const T = l2m.teams[t.team] || (l2m.teams[t.team] = { team: t.team, games: 0, w: 0, l: 0, pts: 0, opp: 0, pm: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, reb: 0, tov: 0 });
        T.games++; if (t.won) T.w++; else T.l++;
        T.pts += F.l2m.teams[side].pf; T.opp += F.l2m.teams[side].pa; T.pm = T.pts - T.opp;
        for (const [id, x] of Object.entries(F.l2m.players)) if (names[id]?.team === t.team) for (const k of ["fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "tov"]) T[k] += x[k];
      });
    }
    for (const t of F.teams) {
      t.q.forEach((pts, k) => teamQuarters.push({ pts, team: t.team, opp: t.opp, q: k + 1, ...at }));
      const L = leads[t.team] || (leads[t.team] = { gp: 0, blown: [], comebacks: [] });
      L.gp++;
      // 0.79 (posts the user sent, 11/16: "4-5 when leading by 10+ points this season", "blown a double-digit lead in 3
      // straight games"): each game's biggest lead and deficit with its result, oldest first after the sort below.
      (led[t.team] ??= []).push({ d: F.date, opp: t.opp, won: t.won, lead: t.maxLead, down: t.maxDown, gameId: F.gameId });
      if (!t.won && t.maxLead >= LEAD_MIN) L.blown.push({ lead: t.maxLead, opp: t.opp, score: t.score + "-" + t.oppScore, ...at });
      if (t.won && t.maxDown >= LEAD_MIN) L.comebacks.push({ down: t.maxDown, opp: t.opp, score: t.score + "-" + t.oppScore, ...at });
      // Game Flow's "Leads & comebacks" table for the full season, the same counts the page makes (renderStreaks).
      const T = table[t.team] || (table[t.team] = { tri: t.team, gp: 0, pf: 0, pa: 0, neverLed: 0, neverTrailed: 0, held: 0, heldStrict: 0, blown10: 0, comeback10: 0, bigBlown: null, bigComeback: null });
      T.gp++; T.pf += t.score; T.pa += t.oppScore;
      if (t.neverLed) T.neverLed++;
      if (t.neverTrailed) T.neverTrailed++;
      if (t.held) T.held++;
      if (t.heldStrict) T.heldStrict++;
      // noon Eastern, so the page's local date is the game's date anywhere in the Americas
      const vs = { opp: t.opp, date: F.date ? F.date + "T17:00:00Z" : null, home: t.home, score: t.score + "-" + t.oppScore };
      if (!t.won && t.maxLead >= 10) { T.blown10++; if (!T.bigBlown || t.maxLead > T.bigBlown.n) T.bigBlown = { n: t.maxLead, ...vs }; }
      if (t.won && t.maxDown >= 10) { T.comeback10++; if (!T.bigComeback || t.maxDown > T.bigComeback.n) T.bigComeback = { n: t.maxDown, ...vs }; }
    }
  }
  const top = (xs) => xs.sort((a, b) => b.pts - a.pts || String(a.date).localeCompare(String(b.date))).slice(0, TOP_N);
  const rotation = {};
  for (const [id, R] of Object.entries(rot)) {
    // mpg (0.72.2): the bridge's foul-trouble card is for starters and for 25.0 minutes a game or more.
    rotation[id] = { name: R.name, team: R.team, gp: R.gp, starts: R.starts, mpg: R.gp ? Math.round(R._min / R.gp * 10) / 10 : 0, full1: R.full1, open3: R.open3,
      out1: median(R._o1), back: median(R._b), in1: median(R._i1), out3: median(R._o3),
      n: { out1: R._o1.length, back: R._b.length, in1: R._i1.length, out3: R._o3.length } };
  }
  for (const id of Object.keys(fouls)) if (!fouls[id].trouble && !fouls[id].out) delete fouls[id];
  // Fourth quarters: games oldest first; `miss` is his current run of close games he didn't finish.
  for (const [id, Q] of Object.entries(fourth)) {
    Q.ends.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let miss = 0;
    for (let i = Q.ends.length - 1; i >= 0 && !Q.ends[i].fin; i--) miss++;
    Q.miss = miss; Q.ends = Q.ends.slice(-6);
    if (Q.sat < 2 && Q.close < 3) delete fourth[id];
  }
  // Only those who usually play the second half: a rest-day starter pulled at the half is no story.
  const leftEarly = early.filter((e) => { const r = rotation[e.id]; return r && r.starts >= 3 && (r.open3 || 0) >= 0.7 * r.starts; })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  // 0.76: every 20-point quarter of the season (not only the 30 best), so a list counted from a date can be kept current.
  const bigQuarters = quarters.filter((q) => q.pts >= BIG_QUARTER).map(({ pts, id, name, team, q, date }) => ({ pts, id, name, team, q, date })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.pts - a.pts));
  // Record when leading / trailing by 10+, and the current run of games lost after leading by 10+ (0 = the last game wasn't one).
  const by10 = {};
  for (const [tri, gs] of Object.entries(led)) {
    gs.sort((a, b) => String(a.d).localeCompare(String(b.d)));
    const up = gs.filter((g) => g.lead >= 10), dn = gs.filter((g) => g.down >= 10);
    const run = [];
    for (let i = gs.length - 1; i >= 0 && !gs[i].won && gs[i].lead >= 10; i--) run.unshift({ lead: gs[i].lead, opp: gs[i].opp, d: gs[i].d });
    let longest = 0, cur = 0;
    for (const g of gs) { cur = !g.won && g.lead >= 10 ? cur + 1 : 0; if (cur > longest) longest = cur; }
    by10[tri] = { gp: gs.length, upW: up.filter((g) => g.won).length, upL: up.filter((g) => !g.won).length, downW: dn.filter((g) => g.won).length, downL: dn.filter((g) => !g.won).length, run, longest, last: gs.length ? gs[gs.length - 1].d : null };
  }
  const byDate = (a, b) => String(b.date).localeCompare(String(a.date));
  full.halves.sort(byDate); full.games.sort(byDate); full.fives.sort(byDate);
  const swingTop = Object.values(swing).filter((x) => x.a >= 2).sort((a, b) => b.m - a.m || a.a - b.a).slice(0, 40);
  return { games, leadMin: LEAD_MIN, by10, full, swing: swingTop, leadTable: Object.values(table), leftEarly, bigQuarters, quarters: top(quarters), halves: top(halves), teamQuarters: top(teamQuarters), rotation, fouls, leads, fourth, shots: shotStreaks(shotGames),
    l2m: { games: l2m.games, teams: l2m.teams, players: Object.values(l2m.players).map((p) => ({ ...p, sec: Math.round(p.sec), min: Math.round(p.sec / 6) / 10, ast: null, stl: null, blk: null })).sort((a, b) => b.pts - a.pts) } };
}

/* The place a value would take on a best-first list: 1 = the best. Ties share the place. */
export function placeOn(list, v) {
  return list.filter((x) => x.pts > v).length + 1;
}
