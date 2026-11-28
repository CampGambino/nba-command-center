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
export const SPLITS = { ppg: 15, windows: [5, 6, 7, 8, 10], minBase: 8, minBaseFga: 20, p: 0.1, drop: 0.75, dropPts: 1.5, rise: 1.4, risePts: 2.5, fgGap: 0.12, fgMin: 15, threeGap: 0.15, threeMin: 10 };
const STRETCH = {
  q4: { field: "q4", hist: "q4", say: (n) => `in the 4th quarter of his last ${n} games`, base: "4th quarters", minWinFga: 12 },
  clutch: { field: "cp", hist: "clutch", say: (n) => `in clutch time in his last ${n} games with clutch time`, base: "clutch time", minWinFga: 10, note: "clutch time: the last five minutes of the 4th or overtime, within 5" },
};
// pbp.js line in the store, after the side: [sec, pts, fgm, fga, fg3m, fg3a, ftm, fta, reb, ast, tov, stl, blk, pm]
const S = { sec: 1, pts: 2, fgm: 3, fga: 4, fg3m: 5, fg3a: 6, ftm: 7, fta: 8 };

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

export function splitLines({ rows = [], names = {}, last = null, slate = [], teamOf = (id, t) => t } = {}) {
  const playing = new Set((slate || []).flatMap((g) => [g.home, g.away]));
  const games = [...rows].filter((g) => g.pl).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  // his games this season (minutes) and points, for who is a scorer
  const seasonPts = {}, team = {}, played = {};
  for (const g of games) for (const [id, r] of Object.entries(g.pl)) {
    if (!(r[2] > 0) && !(g.z || []).includes(id)) continue;
    (seasonPts[id] ??= []).push(r[3]); team[id] = r[0] === 0 ? g.h : g.a; if (g.q4) (played[id] ??= []).push(g.d);   // a game whose 4th quarter isn't on file is not one he sat
  }
  const out = [];
  for (const [id, pts] of Object.entries(seasonPts)) {
    const ppg = pts.reduce((a, b) => a + b, 0) / pts.length;
    if (ppg < SPLITS.ppg || pts.length < SPLITS.windows[0] + 3) continue;
    let best = null;
    for (const [sk, st] of Object.entries(STRETCH)) {
      const app = [];   // his appearances in the stretch this season, in date order
      for (const g of games) { const x = g[st.field]?.p?.[id]; if (x && (x[S.sec] > 0 || x.slice(2, 9).some((v) => v))) app.push({ d: g.d, x }); }
      const hist = last?.[st.hist]?.[id];   // [games, sec, pts, fgm, fga, fg3m, fg3a, ftm, fta]
      for (const n of SPLITS.windows) {
        if (app.length < n) continue;
        const win = app.slice(-n), before = app.slice(0, -n);
        const sum = (list, k) => list.reduce((a, e) => a + e.x[k], 0);
        const W = { g: n, pts: sum(win, S.pts), fgm: sum(win, S.fgm), fga: sum(win, S.fga), fg3m: sum(win, S.fg3m), fg3a: sum(win, S.fg3a), ftm: sum(win, S.ftm), fta: sum(win, S.fta) };
        const B = { g: before.length + (hist?.[0] || 0), pts: sum(before, S.pts) + (hist?.[2] || 0), fgm: sum(before, S.fgm) + (hist?.[3] || 0), fga: sum(before, S.fga) + (hist?.[4] || 0),
          fg3m: sum(before, S.fg3m) + (hist?.[5] || 0), fg3a: sum(before, S.fg3a) + (hist?.[6] || 0), now: before.length, lastSeason: hist?.[0] || 0 };
        if (B.g < SPLITS.minBase || B.fga < SPLITS.minBaseFga || W.fga < st.minWinFga) continue;
        const wp = W.pts / n, bp = B.pts / B.g, rate = B.fgm / B.fga, wr = W.fgm / W.fga, r3 = B.fg3a ? B.fg3m / B.fg3a : null, w3 = W.fg3a ? W.fg3m / W.fg3a : null;
        const ptsDown = wp <= bp * SPLITS.drop && bp - wp >= SPLITS.dropPts, ptsUp = wp >= bp * SPLITS.rise && wp - bp >= SPLITS.risePts;
        const fgDown = W.fga >= SPLITS.fgMin && wr <= rate - SPLITS.fgGap, fgUp = W.fga >= SPLITS.fgMin && wr >= rate + SPLITS.fgGap;
        const thDown = r3 != null && B.fg3a >= 20 && W.fg3a >= SPLITS.threeMin && w3 <= r3 - SPLITS.threeGap, thUp = r3 != null && B.fg3a >= 20 && W.fg3a >= SPLITS.threeMin && w3 >= r3 + SPLITS.threeGap;
        // one direction: down needs his points down (or flat) and a shooting slide or the points slide itself; up the same
        const down = (ptsDown || ((fgDown || thDown) && wp <= bp)), up = (ptsUp || ((fgUp || thUp) && wp >= bp));
        if (down === up) continue;
        // the spread of his points a stretch, from this season's earlier games (at least 3 points: few games read small)
        const bpts = before.map((e) => e.x[S.pts]), mean = bpts.length ? bpts.reduce((a, b) => a + b, 0) / bpts.length : bp;
        const sd = Math.max(3, bpts.length >= 4 ? Math.sqrt(bpts.reduce((a, b) => a + (b - mean) ** 2, 0) / (bpts.length - 1)) : 0);
        const pPts = normTail(Math.abs(wp - bp) / (sd / Math.sqrt(n)));
        const pFg = (down && wr < rate) || (up && wr > rate) ? binomTail(W.fgm, W.fga, rate, up) : 1;
        const p3 = r3 != null && W.fg3a >= SPLITS.threeMin && ((down && w3 < r3) || (up && w3 > r3)) ? binomTail(W.fg3m, W.fg3a, r3, up) : 1;
        const pAdj = Math.min(pPts, pFg, p3);   // the strongest of the three; the windows are a choice, said in the line
        if (pAdj > SPLITS.p) continue;
        if (!best || pAdj < best.pAdj) best = { sk, st, n, W, B, wp, bp, rate, r3, down, pAdj, since: win[0].d };
      }
    }
    if (!best) continue;
    const { st, n, W, B, wp, bp, r3, down, pAdj } = best;
    const tri = teamOf(id, team[id]) || team[id], name = names[id] || id;
    const from = [B.now ? `${B.now} this season` : "", B.lastSeason ? `${B.lastSeason} last season` : ""].filter(Boolean).join(", ");
    // games he played in that stretch without a 4th quarter of his: said, so "his last 8 games" is true
    const span = (played[id] || []).filter((d) => d >= best.since).length, skipped = best.sk === "q4" ? span - n : 0;
    const text = `${name} ${st.say(n)}${skipped > 0 ? ` with a 4th quarter (he didn't play in the 4th in ${skipped} other game${skipped === 1 ? "" : "s"} since ${+best.since.slice(5, 7)}/${+best.since.slice(8, 10)})` : ""}: ${r1(wp)} points a game, ${W.fgm}-${W.fga} FG (${pct(W.fgm, W.fga)}), ${W.fg3m}-${W.fg3a} 3PT, ${W.ftm}-${W.fta} FT. `
      + `In his ${st.base} before that (${from}): ${r1(bp)} points a game, ${pct(B.fgm, B.fga)} FG${r3 != null && B.fg3a >= 10 ? `, ${pct(B.fg3m, B.fg3a)} 3PT` : ""}`
      + (st.note ? ` (${st.note})` : "");
    const score = 2.8 + Math.min(0.8, -Math.log10(pAdj) / 3) + Math.min(0.6, (ppg - SPLITS.ppg) / 20) + (playing.has(tri) ? 0.2 : 0);
    out.push({ kind: "split", team: tri, player: name, id, key: `split|${id}|${best.sk}|${down ? "down" : "up"}`, text, score: Math.round(score * 100) / 100,
      stretch: best.sk, dir: down ? "down" : "up", n, chance: Number(pAdj.toPrecision(2)), since: best.since, window: W, before: { g: B.g, pts: B.pts, fgm: B.fgm, fga: B.fga, now: B.now, lastSeason: B.lastSeason }, rare: pAdj <= 0.001 });
  }
  return out.sort((a, b) => b.score - a.score);
}
