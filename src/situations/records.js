/**
 * Team records by game situation, with league baselines and flags for the
 * unusual ones. Pure: takes result rows (see results.js), returns plain data.
 *
 * Situations (each a W-L record):
 *   all, home, road
 *   vsAbove   vs teams over .500 now      vs500  vs teams at exactly .500 now      vsBelow   vs teams under .500 now
 *   vsAboveThen / vs500Then / vsBelowThen   the same by the opponent's record GOING INTO that game
 *             (the user's request, 11/12; games against a 0-0 team fall in none of these). Shown with
 *             colors, but not flagged or listed as unusual: they're the same games as the "now" splits.
 *   vsTop3 / vsTop4 / vsTop5   vs the teams with the 3 / 4 / 5 best records now
 *             (by win %; teams tied at the cutoff are all included, so "top 5"
 *             can be 6 teams; a team never counts as its own opponent)
 *   clutch    games with clutch time: the last 5 minutes of the 4th or OT
 *             with the score within 5 (the NBA's definition); only games
 *             whose play-by-play has been read
 *   close     decided by 3 or fewer       ot        went to overtime
 *   ten       decided by 10 or more
 *   trailHalf / leadHalf / tiedHalf       score after two quarters
 *   trail3 / lead3 / tied3                score after three quarters
 *
 * Baseline: how often any team wins in that situation, league-wide this season
 * (for "close" that is .500 by construction; for "vsAbove" it is below .500,
 * since those are the better teams).
 *
 * Expected: that baseline adjusted for how good the team is, on the log-odds
 * scale: logit(expected) = logit(baseline) + logit(team strength), where team
 * strength is its record with 5-5 added (so 2-0 isn't treated as perfect). A
 * 1-10 team going 0-8 in 10-point games is just a bad team; the same team
 * winning 4 of 5 when trailing after three would be news.
 *
 * Flag: a record at least that far from expected would happen 1% of the time
 * or less (exact binomial tail), over at least 4 games. 1%, not 5%: with 30
 * teams and 13 situations, a 5% bar would raise about 20 flags by luck alone;
 * at 1% about 4.
 */
export const SITUATIONS = [
  ["all", "Overall"], ["home", "Home"], ["road", "Road"],
  ["vsAbove", "vs teams over .500"], ["vs500", "vs teams at .500"], ["vsBelow", "vs teams under .500"],
  ["vsAboveThen", "vs teams over .500 at the time"], ["vs500Then", "vs teams at .500 at the time"], ["vsBelowThen", "vs teams under .500 at the time"],
  ["vsTop3", "vs top-3 records"], ["vsTop4", "vs top-4 records"], ["vsTop5", "vs top-5 records"], ["clutch", "Clutch games"],
  ["close", "Decided by 3 or fewer"], ["ot", "Overtime"], ["ten", "Decided by 10+"],
  ["leadHalf", "Leading at half"], ["tiedHalf", "Tied at half"], ["trailHalf", "Trailing at half"],
  ["lead3", "Leading after 3"], ["tied3", "Tied after 3"], ["trail3", "Trailing after 3"],
];
const LABEL = Object.fromEntries(SITUATIONS);
// Phrases for flags ("... when trailing at half").
const PHRASE = {
  home: "at home", road: "on the road", vsAbove: "against teams over .500", vs500: "against teams at .500", vsBelow: "against teams under .500",
  vsAboveThen: "against teams over .500 at the time", vs500Then: "against teams at .500 at the time", vsBelowThen: "against teams under .500 at the time",
  vsTop3: "against the 3 best records", vsTop4: "against the 4 best records", vsTop5: "against the 5 best records",
  clutch: "in clutch games (within 5 in the last 5 minutes)",
  close: "in games decided by 3 or fewer", ot: "in overtime games", ten: "in games decided by 10 or more",
  leadHalf: "when leading at half", tiedHalf: "when tied at half", trailHalf: "when trailing at half",
  lead3: "when leading after 3 quarters", tied3: "when tied after 3 quarters", trail3: "when trailing after 3 quarters",
};
const MIN_GAMES = 4;
const ALPHA = 0.01;
const PRIOR = 5; // wins and losses added to a team's record for strength
const logit = (p) => Math.log(p / (1 - p));
const expit = (x) => 1 / (1 + Math.exp(-x));

const sum = (a, n) => (a || []).slice(0, n).reduce((x, y) => x + y, 0);

/** Each game seen from each team's side. */
export function teamGames(rows) {
  const out = [];
  for (const g of rows) {
    for (const home of [true, false]) {
      const us = home ? g.h : g.a, them = home ? g.a : g.h;
      const pf = home ? g.hs : g.as, pa = home ? g.as : g.hs;
      const q = home ? g.hq : g.aq, oq = home ? g.aq : g.hq;
      const hasQ = q?.length >= 3 && oq?.length >= 3;
      out.push({
        id: g.id, date: g.d, team: us, opp: them, home: home && !g.n, road: !home && !g.n, win: pf > pa, margin: pf - pa, ot: g.ot > 0,
        // Clutch: true / false once the play-by-play is read; null before.
        clutch: g.x ? !!g.cl : null, clutchNet: g.x && g.cl ? (home ? g.cl[0] - g.cl[1] : g.cl[1] - g.cl[0]) : 0,
        q4: q?.length >= 4 && oq?.length >= 4 ? [q[3], oq[3]] : null,
        half: hasQ ? sum(q, 2) - sum(oq, 2) : null, after3: hasQ ? sum(q, 3) - sum(oq, 3) : null,
      });
    }
  }
  return out;
}

function binomTail(k, n, p, upper) {
  // P(X >= k) if upper, else P(X <= k), X ~ Binomial(n, p).
  let c = 1, total = 0;
  for (let i = 0; i <= n; i++) {
    if (i > 0) c = (c * (n - i + 1)) / i;
    const pr = c * p ** i * (1 - p) ** (n - i);
    if (upper ? i >= k : i <= k) total += pr;
  }
  return Math.min(1, total);
}

const rec = () => ({ w: 0, l: 0 });
const add = (r, win) => { if (win) r.w++; else r.l++; };
const pct = (r) => (r.w + r.l ? r.w / (r.w + r.l) : null);

export function computeSituations(rows, { through = null } = {}) {
  const tg = teamGames(rows).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const overall = {};
  for (const g of tg) add((overall[g.team] ??= rec()), g.win);
  // Over, at or under .500: "above" / "even" / "below" (null for 0-0).
  const side = (r) => (!r || r.w + r.l === 0 ? null : r.w > r.l ? "above" : r.w === r.l ? "even" : "below");
  const KEY = { above: "vsAbove", even: "vs500", below: "vsBelow" };
  // Each opponent's record going into the game (games before that date; no team plays twice in a day).
  const thenRec = new Map(), run = {};
  const dates = [...new Set(tg.map((g) => g.date))].sort();
  for (const d of dates) {
    const day = tg.filter((g) => g.date === d);
    for (const g of day) thenRec.set(g, { ...(run[g.opp] || rec()) });
    for (const g of day) add((run[g.team] ??= rec()), g.win);
  }
  // Best records now: rank by win %, then wins; ties at the cutoff are all in.
  const ranked = Object.keys(overall).sort((x, y) => pct(overall[y]) - pct(overall[x]) || overall[y].w - overall[x].w);
  const topSet = (n) => {
    if (ranked.length < n) return new Set(ranked);
    const cut = pct(overall[ranked[n - 1]]);
    return new Set(ranked.filter((t) => pct(overall[t]) >= cut));
  };
  const tops = { 3: topSet(3), 4: topSet(4), 5: topSet(5) };

  const keysOf = (g) => {
    const k = ["all"];
    if (g.home) k.push("home");
    if (g.road) k.push("road");
    k.push(KEY[side(overall[g.opp])]);
    const then = side(thenRec.get(g));
    if (then) k.push(`${KEY[then]}Then`);
    for (const n of [3, 4, 5]) if (tops[n].has(g.opp)) k.push(`vsTop${n}`);
    if (g.clutch) k.push("clutch");
    if (Math.abs(g.margin) <= 3) k.push("close");
    if (g.ot) k.push("ot");
    if (Math.abs(g.margin) >= 10) k.push("ten");
    if (g.half != null) k.push(g.half > 0 ? "leadHalf" : g.half < 0 ? "trailHalf" : "tiedHalf");
    if (g.after3 != null) k.push(g.after3 > 0 ? "lead3" : g.after3 < 0 ? "trail3" : "tied3");
    return k;
  };

  const teams = {}, league = {};
  for (const g of tg) {
    const t = (teams[g.team] ??= { splits: {}, games: [] });
    for (const k of keysOf(g)) {
      add((t.splits[k] ??= rec()), g.win);
      add((league[k] ??= rec()), g.win);
    }
    t.games.push(g);
  }
  const baseline = Object.fromEntries(Object.entries(league).map(([k, r]) => [k, { w: r.w, l: r.l, pct: pct(r) }]));

  const tests = [];
  for (const [team, t] of Object.entries(teams)) {
    const res = t.games.map((g) => (g.win ? "W" : "L"));
    let n = 0; const last = res[res.length - 1];
    for (let i = res.length - 1; i >= 0 && res[i] === last; i--) n++;
    t.streak = last ? `${last}${n}` : null;
    const ten = res.slice(-10);
    t.last10 = { w: ten.filter((x) => x === "W").length, l: ten.filter((x) => x === "L").length };
    const all = t.splits.all;
    t.strength = (all.w + PRIOR) / (all.w + all.l + 2 * PRIOR);
    t.expected = {};
    t.luck = {}; // per situation: chance of a record at least this far from expected
    t.clutchGames = t.games.filter((g) => g.clutch !== null).length; // games whose play-by-play was read
    t.clutchNet = t.games.reduce((a, g) => a + g.clutchNet, 0);
    // 4th quarter: points for and against in period 4 (overtime not included).
    t.q4 = t.games.reduce((acc, g) => { if (g.q4 != null) { acc.games++; acc.pf += g.q4[0]; acc.pa += g.q4[1]; if (g.q4[0] > g.q4[1]) acc.won++; else if (g.q4[0] < g.q4[1]) acc.lost++; } return acc; }, { games: 0, pf: 0, pa: 0, won: 0, lost: 0 });
    t.flags = [];
    for (const [k, r] of Object.entries(t.splits)) {
      if (k === "all" || !PHRASE[k]) continue;
      const n = r.w + r.l, p0 = baseline[k]?.pct;
      if (p0 == null || p0 <= 0 || p0 >= 1) continue;
      const pe = expit(logit(p0) + logit(t.strength));
      t.expected[k] = Math.round(pe * n * 10) / 10;
      if (n < 3) continue;
      const hi = r.w / n > pe;
      const tail = binomTail(r.w, n, pe, hi);
      t.luck[k] = { p: tail, direction: hi ? "better" : "worse" };
      if (k.endsWith("Then")) continue; // shown, not flagged: the same games as the "now" splits
      const item = {
        team, key: k, w: r.w, l: r.l, baseline: p0, expectedPct: pe, expectedWins: t.expected[k], p: tail, direction: hi ? "better" : "worse",
        text: `${r.w}-${r.l} ${PHRASE[k]}: a team this good would win about ${t.expected[k]} of ${n} (league-wide, teams win ${Math.round(p0 * 100)}% of those)`,
      };
      tests.push(item);
      if (n < MIN_GAMES || tail > ALPHA) continue;
      t.flags.push({
        key: k, w: r.w, l: r.l, baseline: p0, expectedPct: pe, expectedWins: t.expected[k], p: tail, direction: hi ? "better" : "worse",
        text: `${r.w}-${r.l} ${PHRASE[k]}: a team this good would win about ${t.expected[k]} of ${n} (league-wide, teams win ${Math.round(p0 * 100)}% of those)`,
      });
    }
    t.flags.sort((a, b) => a.p - b.p);
    t.games = undefined;
  }
  // The most unusual records league-wide, flagged or not: early in the season
  // few reach the 1% bar, and these are the ones closest to it. Each carries
  // its chance of happening by luck, so the page can say how strong it is.
  const unusual = tests.filter((x) => x.p < 0.1).sort((a, b) => a.p - b.p).slice(0, 12);
  const topTeams = Object.fromEntries([3, 4, 5].map((n) => [n, [...tops[n]]]));
  return { through, games: rows.length, baseline, teams, unusual, topTeams, labels: LABEL };
}
