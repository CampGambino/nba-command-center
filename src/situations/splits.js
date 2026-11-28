/**
 * A star's recent 4th quarters (or clutch time) against his own before (0.185.0).
 *
 * The user, 11/28/26, with Kalshi's post "Jayson Tatum in the 4th Quarter of his last 6 games: 3.7 PPG, 24.0 FG% (6-25 FG),
 * 7.7 3PT% (1-13 3PT), 60.0 FT% (9-15 FT)": "were stats like this sliced up never checked? It's a good representation of
 * the type of ways to cut up data that is noteable, relevant, and I may not have mentioned to find but we have all the
 * data to be checking for this kind of dropoff for a star player."
 *
 * The data: every game's 4th-quarter and clutch-time player lines in the results store (row.q4, row.cp, from the
 * play-by-play; src/espn/pbp.js), and last season's totals (src/data/q4-history-<season>.json, tools/q4-history.mjs).
 *
 * For every scorer (SPLITS.ppg+ a game this season), for each stretch (the 4th quarter; clutch time) and each window of his
 * last N appearances in it (SPLITS.windows), the window is set against his own appearances in that stretch before it: this
 * season's earlier games and all of last season's. Three tests, each a chance figure:
 *   points    his points a stretch, against the earlier average, with the spread of his earlier games this season;
 *   shooting  his made shots, against what his earlier rate would give on the same attempts (a binomial tail);
 *   threes    the same from three.
 * The size decides (SPLITS: points, shooting or threes well off his own), and the strongest chance must be 1 in 10 or
 * less. One line a player, the window with the smallest chance; ranked by that chance and how much he scores.
 *
 *   splitLines({ rows, names, last, slate, teamOf }) -> [{ kind: "split", team, player, id, key, text, score, ... }]
 *   rows: the store's games; names: { espnId: name }; last: q4-history file or null; slate: tonight's games;
 *   teamOf(id, tri): his team now (a traded player's).
 */
// 0.185.0: a first cut that asked for chance-level rarity (1 in 50 after counting every window) found two lines and not
// Tatum's, whose six 4th quarters were a 1-in-14 run for a 40% shooter. The user's bar is what resonates, not what a
// statistician would call rare, so the size of the slide decides and the chance only keeps out plain noise: a slide in
// points a stretch (a quarter or more down, and 1.5+), in his shooting (12+ points of percentage on 15+ shots) or from
// three (15+ points on 10+ threes), with a chance of 1 in 10 or less for the strongest of them. Ranked, not cut further.
export const SPLITS = { sdFloor: 3, ppg: 15, windows: [5, 6, 7, 8, 10], minBase: 8, minBaseFga: 20, p: 0.1, drop: 0.75, dropPts: 1.5, rise: 1.4, risePts: 2.5, fgGap: 0.12, fgMin: 15, threeGap: 0.15, threeMin: 10 };
// 0.187.0 (the user, 11/28: "build it", of every quarter and each half per player; "same for teams"): every quarter, both
// halves and clutch time. "Short" is the word in "he didn't play in the 4th".
const Q = (n, ord) => ({ say: (k) => `in the ${ord} quarter of his last ${k} games`, base: `${ord} quarters`, minWinFga: 10, short: `the ${ord}`, has: `a ${ord} quarter`, quarter: true, n });
const STRETCH = {
  q1: Q(1, "1st"), q2: Q(2, "2nd"), q3: Q(3, "3rd"),
  q4: { ...Q(4, "4th"), minWinFga: 12 },
  h1: { say: (k) => `in the first half of his last ${k} games`, base: "first halves", minWinFga: 20, short: "the first half", has: "a first half", half: true },
  h2: { say: (k) => `in the second half of his last ${k} games`, base: "second halves", minWinFga: 20, short: "the second half", has: "a second half", half: true },
  clutch: { say: (k) => `in clutch time in his last ${k} games with clutch time`, base: "clutch time", minWinFga: 10, note: "clutch time: the last five minutes of the 4th or overtime, within 5" },
};
export const STRETCHES = Object.keys(STRETCH);
export const STRETCH_WEIGHT = { q1: 0.3, q2: 0.3, q3: 0.3, h1: 0.15, h2: 0.15, q4: 0, clutch: 0 };
// The 8-number line [sec, pts, fgm, fga, fg3m, fg3a, ftm, fta] of a player in one stretch of a game, or null when he had none;
// undefined when that stretch of the game isn't on file (its plays didn't add up, or it was read before 0.187.0).
const add8 = (a, b) => (a && b ? a.map((v, i) => v + b[i]) : a || b || null);
export function stretchLine(g, id, w) {
  const qp = g.qp?.p, q = (k) => (qp?.[id] ? qp[id].slice(1 + (k - 1) * 8, 1 + k * 8) : null), q4 = () => (g.q4?.p?.[id] ? g.q4.p[id].slice(1, 9) : null);
  const on = (x) => (x && (x[0] > 0 || x.slice(1).some((v) => v)) ? x : null);
  if (w === "q1" || w === "q2" || w === "q3") return g.qp ? on(q(+w[1])) : undefined;
  if (w === "q4") return g.q4 ? on(q4()) : undefined;
  if (w === "h1") return g.qp ? on(add8(on(q(1)), on(q(2)))) : undefined;
  if (w === "h2") return g.qp && g.q4 ? on(add8(on(q(3)), on(q4()))) : undefined;
  if (w === "clutch") return g.cp ? on(g.cp.p?.[id] ? g.cp.p[id].slice(1, 9) : null) : undefined;
  return undefined;
}
// the 8-number line: [sec, pts, fgm, fga, fg3m, fg3a, ftm, fta]
const S = { sec: 0, pts: 1, fgm: 2, fga: 3, fg3m: 4, fg3a: 5, ftm: 6, fta: 7 };

// log of the binomial tail, P(X <= k) or P(X >= k), X ~ Bin(n, p)
function lnChoose(n, k) { let s = 0; for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i); return s; }
export function binomTail(k, n, p, upper) {
  if (n <= 0) return 1;
  p = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  let s = 0;
  for (let i = upper ? k : 0; upper ? i <= n : i <= k; i++) s += Math.exp(lnChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, s);
}
// one-sided normal tail for z (Abramowitz-Stegun 26.2.17)
export function normTail(z) {
  if (z < 0) return 1 - normTail(-z);
  const t = 1 / (1 + 0.2316419 * z), d = 0.3989423 * Math.exp(-z * z / 2);
  return d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
}
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const pct = (m, a) => (a ? `${r1((100 * m) / a)}%` : "n/a");

/** Every player's best window in each stretch that passes (one a stretch), before one is picked a player. */
export function splitCandidates({ rows = [], names = {}, last = null, slate = [], teamOf = (id, t) => t } = {}) {
  const playing = new Set((slate || []).flatMap((g) => [g.home, g.away]));
  const games = [...rows].filter((g) => g.pl).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  // his games this season (minutes, or the few-seconds mark) and points, for who is a scorer
  const seasonPts = {}, team = {}, played = {};
  for (const g of games) for (const [id, r] of Object.entries(g.pl)) {
    if (!(r[2] > 0) && !(g.z || []).includes(id)) continue;
    (seasonPts[id] ??= []).push(r[3]); team[id] = r[0] === 0 ? g.h : g.a; (played[id] ??= []).push(g);
  }
  const out = [];
  for (const [id, pts] of Object.entries(seasonPts)) {
    const ppg = pts.reduce((a, b) => a + b, 0) / pts.length;
    if (ppg < SPLITS.ppg || pts.length < SPLITS.windows[0] + 3) continue;
    for (const [sk, st] of Object.entries(STRETCH)) {
      const app = [];   // his appearances in the stretch this season, in date order
      for (const g of games) { const x = stretchLine(g, id, sk); if (x) app.push({ d: g.d, x }); }
      const hist = last?.[sk]?.[id];   // [games, sec, pts, fgm, fga, fg3m, fg3a, ftm, fta]
      const half = st.half ? 2 : 1;    // a half has twice a quarter's points and shots
      let best = null;
      for (const n of SPLITS.windows) {
        if (app.length < n) continue;
        const win = app.slice(-n), before = app.slice(0, -n);
        const sum = (list, k) => list.reduce((a, e) => a + e.x[k], 0);
        const W = { g: n, pts: sum(win, S.pts), fgm: sum(win, S.fgm), fga: sum(win, S.fga), fg3m: sum(win, S.fg3m), fg3a: sum(win, S.fg3a), ftm: sum(win, S.ftm), fta: sum(win, S.fta) };
        const B = { g: before.length + (hist?.[0] || 0), pts: sum(before, S.pts) + (hist?.[2] || 0), fgm: sum(before, S.fgm) + (hist?.[3] || 0), fga: sum(before, S.fga) + (hist?.[4] || 0),
          fg3m: sum(before, S.fg3m) + (hist?.[5] || 0), fg3a: sum(before, S.fg3a) + (hist?.[6] || 0), now: before.length, lastSeason: hist?.[0] || 0 };
        if (B.g < SPLITS.minBase || B.fga < SPLITS.minBaseFga * half || W.fga < st.minWinFga) continue;
        const wp = W.pts / n, bp = B.pts / B.g, rate = B.fgm / B.fga, wr = W.fgm / W.fga, r3 = B.fg3a ? B.fg3m / B.fg3a : null, w3 = W.fg3a ? W.fg3m / W.fg3a : null;
        const ptsDown = wp <= bp * SPLITS.drop && bp - wp >= SPLITS.dropPts * half, ptsUp = wp >= bp * SPLITS.rise && wp - bp >= SPLITS.risePts * half;
        const fgDown = W.fga >= SPLITS.fgMin * half && wr <= rate - SPLITS.fgGap, fgUp = W.fga >= SPLITS.fgMin * half && wr >= rate + SPLITS.fgGap;
        const thDown = r3 != null && B.fg3a >= 20 && W.fg3a >= SPLITS.threeMin && w3 <= r3 - SPLITS.threeGap, thUp = r3 != null && B.fg3a >= 20 && W.fg3a >= SPLITS.threeMin && w3 >= r3 + SPLITS.threeGap;
        // one direction: down needs his points down (or flat) and a shooting slide or the points slide itself; up the same
        const down = (ptsDown || ((fgDown || thDown) && wp <= bp)), up = (ptsUp || ((fgUp || thUp) && wp >= bp));
        if (down === up) continue;
        // the spread of his points a stretch, from this season's earlier games (at least 3 a quarter: few games read small)
        const bpts = before.map((e) => e.x[S.pts]), mean = bpts.length ? bpts.reduce((a, b) => a + b, 0) / bpts.length : bp;
        const sd = Math.max(SPLITS.sdFloor * Math.sqrt(half), bpts.length >= 4 ? Math.sqrt(bpts.reduce((a, b) => a + (b - mean) ** 2, 0) / (bpts.length - 1)) : 0);
        const pPts = normTail(Math.abs(wp - bp) / (sd / Math.sqrt(n)));
        const pFg = (down && wr < rate) || (up && wr > rate) ? binomTail(W.fgm, W.fga, rate, up) : 1;
        const p3 = r3 != null && W.fg3a >= SPLITS.threeMin && ((down && w3 < r3) || (up && w3 > r3)) ? binomTail(W.fg3m, W.fg3a, r3, up) : 1;
        // the strongest of the three (the window and the stretch are choices, said in the line), graded as 0.185.0 graded the
        // 4th quarter: leeway, then ranked (the user: resonance is the bar, not rarity alone)
        const pAdj = Math.min(pPts, pFg, p3);
        if (pAdj > SPLITS.p) continue;
        if (!best || pAdj < best.pAdj) best = { sk, st, n, W, B, wp, bp, rate, r3, down, pAdj, since: win[0].d };
      }
      if (!best) continue;
      const { n, W, B, wp, bp, r3, down, pAdj } = best;
      const tri = teamOf(id, team[id]) || team[id], name = names[id] || id;
      const from = [B.now ? `${B.now} this season` : "", B.lastSeason ? `${B.lastSeason} last season` : ""].filter(Boolean).join(", ");
      // games he played in that stretch of time with that stretch on file and none of his: said, so "his last 8 games" is true
      const skipped = st.quarter || st.half ? (played[id] || []).filter((g) => g.d >= best.since && stretchLine(g, id, sk) === null).length : 0;
      const text = `${name} ${st.say(n)}${skipped > 0 ? ` with ${st.has} (he didn't play in ${st.short} in ${skipped} other game${skipped === 1 ? "" : "s"} since ${+best.since.slice(5, 7)}/${+best.since.slice(8, 10)})` : ""}: `
        + `${r1(wp)} points a game, ${W.fgm}-${W.fga} FG (${pct(W.fgm, W.fga)}), ${W.fg3m}-${W.fg3a} 3PT, ${W.ftm}-${W.fta} FT. `
        + `In his ${st.base} before that (${from}): ${r1(bp)} points a game, ${pct(B.fgm, B.fga)} FG${r3 != null && B.fg3a >= 10 ? `, ${pct(B.fg3m, B.fg3a)} 3PT` : ""}`
        + (st.note ? ` (${st.note})` : "");
      // the 4th quarter and clutch time are the ones people talk about (Kalshi's Tatum post); the 1st to 3rd quarters a little
      // less, the halves in between
      const score = 2.8 + Math.min(0.8, -Math.log10(pAdj) / 3) + Math.min(0.6, (ppg - SPLITS.ppg) / 20) + (playing.has(tri) ? 0.2 : 0) - (STRETCH_WEIGHT[sk] || 0);
      out.push({ kind: "split", team: tri, player: name, id, key: `split|${id}|${sk}|${down ? "down" : "up"}`, text, score: Math.round(score * 100) / 100,
        stretch: sk, dir: down ? "down" : "up", n, chance: Number(pAdj.toPrecision(2)), since: best.since, window: W, before: { g: B.g, pts: B.pts, fgm: B.fgm, fga: B.fga, now: B.now, lastSeason: B.lastSeason }, rare: pAdj <= 0.001 });
    }
  }
  return out;
}

/** One line a player a direction, his best-ranked stretch each way (Tatum's 1st quarters up and 4th quarters down are two
 *  stories); then the teams (teamSplitLines). Ranked. */
export function splitLines(args = {}) {
  const best = new Map();
  // the best-ranked stretch each way: the chance, how good he is, and the 4th quarter and clutch time ahead of the rest
  for (const c of splitCandidates(args)) { const k = `${c.id}|${c.dir}`, b = best.get(k); if (!b || c.score > b.score || (c.score === b.score && c.chance < b.chance)) best.set(k, c); }
  return [...best.values(), ...teamSplitLines(args)].sort((a, b) => b.score - a.score);
}

// ---------- teams (0.187.0; the user, 11/28: "same for teams") ----------
// A team's recent quarters or halves against its own before: points scored a stretch (this season's earlier games and all of
// last season's, from the play-by-play) and its margin a stretch (this season's earlier games). One line a team.
export const TEAM_SPLITS = { windows: [5, 6, 7, 8, 10], minBase: 8, p: 0.01, ptsGap: 4, marginGap: 6 };
const meanOf = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sdOf = (a) => { if (a.length < 2) return 0; const m = meanOf(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const gapZ = (a, b, floor) => normTail(Math.abs(meanOf(a) - meanOf(b)) / Math.sqrt(Math.max(floor, sdOf(a)) ** 2 / a.length + Math.max(floor, sdOf(b)) ** 2 / b.length));
const TEAM_SAY = { q1: "1st quarter", q2: "2nd quarter", q3: "3rd quarter", q4: "4th quarter", h1: "first half", h2: "second half" };
const TEAM_BASE = { q1: "1st quarters", q2: "2nd quarters", q3: "3rd quarters", q4: "4th quarters", h1: "first halves", h2: "second halves" };
export function teamSplitLines({ rows = [], last = null, slate = [] } = {}) {
  const playing = new Set((slate || []).flatMap((g) => [g.home, g.away]));
  const games = [...rows].filter((g) => Array.isArray(g.hq) && Array.isArray(g.aq) && g.hq.length >= 4 && g.aq.length >= 4).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const per = {}, rec = {};
  const span = (q, w) => (w === "h1" ? q[0] + q[1] : w === "h2" ? q[2] + q[3] : q[+w[1] - 1]);
  for (const g of games) for (const [t, o, mine, theirs] of [[g.h, g.a, g.hq, g.aq], [g.a, g.h, g.aq, g.hq]]) {
    (per[t] ??= []).push({ d: g.d, opp: o, s: Object.fromEntries(Object.keys(TEAM_SAY).map((w) => [w, [span(mine, w), span(theirs, w)]])) });
    const r = (rec[t] ??= { w: 0, l: 0 }); if (g.hs != null) { const won = (t === g.h ? g.hs > g.as : g.as > g.hs); if (won) r.w++; else r.l++; }
  }
  const out = [];
  for (const [t, list] of Object.entries(per)) {
    const pctW = rec[t].w / Math.max(1, rec[t].w + rec[t].l);
    let best = null;
    for (const w of Object.keys(TEAM_SAY)) {
      const half = w[0] === "h" ? 2 : 1, hist = last?.teams?.[w]?.[t];
      for (const n of TEAM_SPLITS.windows) {
        if (list.length < n + TEAM_SPLITS.minBase) continue;
        const win = list.slice(-n), before = list.slice(0, -n);
        const m = (l, f) => l.reduce((a, e) => a + f(e), 0) / l.length;
        const wPf = m(win, (e) => e.s[w][0]), wPa = m(win, (e) => e.s[w][1]), wMg = wPf - wPa;
        const bMg = m(before, (e) => e.s[w][0] - e.s[w][1]);
        const bPf = (before.reduce((a, e) => a + e.s[w][0], 0) + (hist?.[2] || 0)) / (before.length + (hist?.[0] || 0));
        const mgShift = Math.abs(wMg - bMg) >= TEAM_SPLITS.marginGap * half, pfShift = Math.abs(wPf - bPf) >= TEAM_SPLITS.ptsGap * half;
        if (!mgShift && !pfShift) continue;
        // margin: the window against this season's earlier games, both samples' spread (Welch); points: against this
        // season's earlier games and last season's, with this season's spread
        const pM = mgShift ? gapZ(win.map((e) => e.s[w][0] - e.s[w][1]), before.map((e) => e.s[w][0] - e.s[w][1]), 5 * Math.sqrt(half)) : 1;
        const sdP = Math.max(4 * Math.sqrt(half), sdOf(before.map((e) => e.s[w][0])));
        const pP = pfShift ? normTail(Math.abs(wPf - bPf) / Math.sqrt(Math.max(4 * Math.sqrt(half), sdOf(win.map((e) => e.s[w][0]))) ** 2 / n + sdP ** 2 / (before.length + (hist?.[0] || 0)))) : 1;
        // six stretches looked at, so the chance is counted six times over (the windows overlap and are said in the line)
        const chance = Math.min(1, Math.min(pM, pP) * 6);
        if (chance > TEAM_SPLITS.p) continue;
        const down = pM <= pP ? wMg < bMg : wPf < bPf;
        if (!best || chance < best.chance) best = { w, n, wPf, wPa, wMg, bMg, bPf, pM, pP, before: before.length, lastSeason: hist?.[0] || 0, chance, down, since: win[0].d };
      }
    }
    if (!best) continue;
    const { w, n, wPf, wPa, wMg, bMg, bPf, chance, down } = best;
    const sg = (x) => (x >= 0 ? `+${r1(x)}` : `−${r1(-x)}`);
    const from = [`${best.before} this season`, best.lastSeason ? `${best.lastSeason} last season` : ""].filter(Boolean).join(", ");
    const byPts = best.pP < best.pM;
    const text = byPts
      ? `${t} in the ${TEAM_SAY[w]} of its last ${n} games: ${r1(wPf)} points a game (${sg(wMg)} margin). Before that: ${r1(bPf)} points a game in ${TEAM_BASE[w]} (${from})`
      : `${t} in the ${TEAM_SAY[w]} of its last ${n} games: ${sg(wMg)} a game (${r1(wPf)}-${r1(wPa)}). Before that: ${sg(bMg)} a game in ${TEAM_BASE[w]} this season (${best.before} games)`;
    const score = 2.8 + Math.min(0.8, -Math.log10(chance) / 3) + Math.min(0.5, Math.max(0, pctW - 0.4)) + (playing.has(t) ? 0.2 : 0) - (STRETCH_WEIGHT[w] || 0);
    out.push({ kind: "split", team: t, player: null, id: `team:${t}`, key: `split|${t}|${w}|${down ? "down" : "up"}`, text, score: Math.round(score * 100) / 100,
      stretch: w, dir: down ? "down" : "up", n, chance: Number(chance.toPrecision(2)), since: best.since, teamLine: true, rare: chance <= 0.001 });
  }
  return out;
}
