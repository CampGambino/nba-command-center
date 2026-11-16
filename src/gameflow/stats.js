/*
 * Season facts read from the nightly Game Flow files (docs/data/flow/<season>/<id>.json), for NBA Live's
 * bridge (docs/bridge/cc-bridge.js v5) and the Command Center. 0.59.0.
 *
 *   flowStats(entries) -> {
 *     games,
 *     quarters:     the season's best single quarters by a player (points, regulation quarters), best first
 *     halves:       the same for halves (Q1+Q2, Q3+Q4)
 *     teamQuarters: the best quarters by a team
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
    return { id: String(p.id), name: p.name, team: tri[p.side], opp: tri[1 - p.side], starter: !!p.starter, q4, last3, second,
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
  return { ...base, players, teams, closeLate, periods: G.maxP };
}

export function flowStats(entries, lite = null) {
  const quarters = [], halves = [], teamQuarters = [], rot = {}, fouls = {}, leads = {}, table = {}, early = [], fourth = {};
  let games = 0;
  for (const { row, c } of entries) {
    let F;
    try { F = gameFacts(row, c, lite); } catch { continue; }
    games++;
    const at = { gameId: F.gameId, date: F.date };
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
    for (const t of F.teams) {
      t.q.forEach((pts, k) => teamQuarters.push({ pts, team: t.team, opp: t.opp, q: k + 1, ...at }));
      const L = leads[t.team] || (leads[t.team] = { gp: 0, blown: [], comebacks: [] });
      L.gp++;
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
  return { games, leadMin: LEAD_MIN, leadTable: Object.values(table), leftEarly, quarters: top(quarters), halves: top(halves), teamQuarters: top(teamQuarters), rotation, fouls, leads, fourth };
}

/* The place a value would take on a best-first list: 1 = the best. Ties share the place. */
export function placeOn(list, v) {
  return list.filter((x) => x.pts > v).length + 1;
}
