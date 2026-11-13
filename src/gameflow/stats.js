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
 *     leadTable:    Game Flow's "Leads & comebacks" rows for the full season (so the page needn't read every game)
 *   }
 *
 * entries: [{ row, c }] where row is the results-store game (id, d, h, a) and c the compact flow file.
 * Elapsed seconds count from the opening tip (Q2 starts at 720), the same clock as NBA Live's playToAbsT.
 */
import { expandFeeds } from "./feeds.js";
import { buildStints, REG_LEN } from "./model.js";

export const LEAD_MIN = 15;
export const TOP_N = 30;
const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1;
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

export function gameFacts(row, c) {
  const { pbp, box } = expandFeeds(c);
  const G = buildStints(pbp, box);
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
    return { id: String(p.id), name: p.name, team: tri[p.side], opp: tri[1 - p.side], starter: !!p.starter,
      q: [1, 2, 3, 4].map((k) => pp[k] || 0), out1, back, in1, out3, full1, open3, q1n: q1.length,
      trouble: !!p.troubleFrom, fouledOut: !!p.fouledOut };
  });
  // Biggest lead each side held, from the score flow (home minus away), and who won.
  let maxHome = 0, maxAway = 0;
  for (const f of G.flow) { if (f.d > maxHome) maxHome = f.d; if (-f.d > maxAway) maxAway = -f.d; }
  const hs = box.game.homeTeam.score, as = box.game.awayTeam.score;
  const teams = [0, 1].map((side) => ({ team: tri[side], opp: tri[1 - side], won: side ? hs > as : as > hs, home: side === 1,
    neverLed: !!(G.everLed && !G.everLed[side]), neverTrailed: !!(G.everLed && !G.everLed[1 - side]),
    held: !!(G.leadState && G.leadState[side] && G.leadState[side].held), heldStrict: !!(G.leadState && G.leadState[side] && G.leadState[side].heldStrict),
    maxLead: side ? maxHome : maxAway, maxDown: side ? maxAway : maxHome,
    q: G.per[side].filter((x) => x.p <= 4).map((x) => x.pts), score: side ? hs : as, oppScore: side ? as : hs }));
  return { ...base, players, teams };
}

export function flowStats(entries) {
  const quarters = [], halves = [], teamQuarters = [], rot = {}, fouls = {}, leads = {}, table = {};
  let games = 0;
  for (const { row, c } of entries) {
    let F;
    try { F = gameFacts(row, c); } catch { continue; }
    games++;
    const at = { gameId: F.gameId, date: F.date };
    for (const p of F.players) {
      p.q.forEach((pts, k) => { if (pts >= 10) quarters.push({ pts, id: p.id, name: p.name, team: p.team, opp: p.opp, q: k + 1, ...at }); });
      [[0, 1], [2, 3]].forEach(([a, b], h) => { const pts = p.q[a] + p.q[b]; if (pts >= 15) halves.push({ pts, id: p.id, name: p.name, team: p.team, opp: p.opp, h: h + 1, ...at }); });
      const R = rot[p.id] || (rot[p.id] = { name: p.name, team: p.team, gp: 0, starts: 0, full1: 0, open3: 0, _o1: [], _b: [], _i1: [], _o3: [] });
      R.team = p.team; R.gp++;
      if (p.starter) R.starts++;
      if (p.full1) R.full1++;
      if (p.open3) R.open3++;
      if (p.out1 != null) R._o1.push(p.out1);
      if (p.back != null) R._b.push(p.back);
      if (p.in1 != null) R._i1.push(p.in1);
      if (p.out3 != null) R._o3.push(p.out3);
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
    rotation[id] = { name: R.name, team: R.team, gp: R.gp, starts: R.starts, full1: R.full1, open3: R.open3,
      out1: median(R._o1), back: median(R._b), in1: median(R._i1), out3: median(R._o3),
      n: { out1: R._o1.length, back: R._b.length, in1: R._i1.length, out3: R._o3.length } };
  }
  for (const id of Object.keys(fouls)) if (!fouls[id].trouble && !fouls[id].out) delete fouls[id];
  return { games, leadMin: LEAD_MIN, leadTable: Object.values(table), quarters: top(quarters), halves: top(halves), teamQuarters: top(teamQuarters), rotation, fouls, leads };
}

/* The place a value would take on a best-first list: 1 = the best. Ties share the place. */
export function placeOn(list, v) {
  return list.filter((x) => x.pts > v).length + 1;
}
