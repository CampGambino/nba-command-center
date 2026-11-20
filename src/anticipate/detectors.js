/**
 * Four searches from the storyline catalog that had no code (0.141.0; audit step 5, the user's go 11/20 4:14 PM).
 * Each returns lines in the shape prep.lines carries ({ kind, team, player, key, text, score, rare }), so they reach
 * the storylines, the briefing and the ledger like every other line.
 *
 *   luck      a team's record against what its point differential says (catalog E10, "luck vs skill"); a shooter far
 *             from his own career rate on real volume (the "likely to cool off / bounce back" flag of the catalog's
 *             alert engine, item 8). Predictive: what is far from its base rate tends back toward it.
 *   paradox   a player whose big scoring nights his team keeps losing (A12, C12: great numbers, bad result).
 *   scarce    league-state scarcity (D14): "one of 2 teams unbeaten at home", shrinking as the season goes.
 *   defpos    what a defense gives up to one position (guards, forwards, centers) against those players' own
 *             averages, said for tonight's opponent and its players at that position.
 *
 * Scores: 3.4 to 4.9, set beside the other rare lines (notes history and records run 4-5; the pool's median is
 * about 3.35), since each fires only on a real outlier.
 *
 * Pure: no I/O. Inputs: rows (situations/results.js allGames), pg (trends.js playerGames), names, seasons (the NBA
 * Guide's career seasons: { keys, players: { name: [[season, …keys]] } }), nameKey, positions ({ espnId: label }),
 * posGroup, slate ([{ away, home }]).
 */
export const DETECT = {
  pyth: 14,             // the NBA's usual exponent for points-for / points-against win expectation
  luckWins: 1.8,        // wins above or below the point differential's record to be said
  luckMinGames: 8,
  shootMin3: 40, careerMin3: 300, gap3: 7,     // three-point %: attempts this season, career attempts before, points from career
  shootTop: 5,          // the furthest this many above and below, for threes and for free throws (57 lines on 11/20 without it)
  shootMinFt: 30, careerMinFt: 200, gapFt: 10, // free-throw %
  bigGame: 30, paradoxMin: 3, paradoxPct: 0.25,
  scarceMax: 3, scarceMin: 3,
  posMinGames: 25, posGap: 2.0, posTop: 3, posMinPpg: 8,
};
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const pc = (x) => (x * 100).toFixed(1);
const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const rec = (w, l) => `${w}-${l}`;
const an = (w) => (/^(8|11|18)(\D|$)/.test(String(w)) ? "an" : "a");   // "an 8-7 team", "an 11-5 team"
const listOf = (a) => (a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}` : a[0] || "");

/** Each team's games from the results: { team: [{ d, home, win, pf, pa, q3: margin after 3, close: decided by 5 or less }] } */
export function teamGamesOf(rows) {
  const T = {};
  for (const g of rows || []) {
    if (g.hs == null || g.as == null) continue;
    const h3 = (g.hq || []).slice(0, 3).reduce((a, b) => a + b, 0), a3 = (g.aq || []).slice(0, 3).reduce((a, b) => a + b, 0), q3ok = (g.hq || []).length >= 3 && (g.aq || []).length >= 3;
    (T[g.h] ??= []).push({ d: g.d, home: !g.n, win: g.hs > g.as, pf: g.hs, pa: g.as, q3: q3ok ? h3 - a3 : null, close: Math.abs(g.hs - g.as) <= 5 });
    (T[g.a] ??= []).push({ d: g.d, home: false, road: !g.n, win: g.as > g.hs, pf: g.as, pa: g.hs, q3: q3ok ? a3 - h3 : null, close: Math.abs(g.hs - g.as) <= 5 });
  }
  for (const t of Object.keys(T)) { T[t].sort((a, b) => a.d.localeCompare(b.d)); for (const x of T[t]) if (x.road === undefined) x.road = false; }
  return T;
}

/** luck (teams): wins against the point differential's expectation (Pythagorean, exponent 14). */
export function teamLuck(rows) {
  const T = teamGamesOf(rows), all = [];
  for (const [team, gs] of Object.entries(T)) {
    if (gs.length < DETECT.luckMinGames) continue;
    const pf = gs.reduce((a, g) => a + g.pf, 0), pa = gs.reduce((a, g) => a + g.pa, 0), w = gs.filter((g) => g.win).length, l = gs.length - w;
    const exp = gs.length * pf ** DETECT.pyth / (pf ** DETECT.pyth + pa ** DETECT.pyth), ew = Math.round(exp), luck = w - exp;
    const close = gs.filter((g) => g.close), cw = close.filter((g) => g.win).length;
    all.push({ team, w, l, n: gs.length, diff: pf - pa, exp, ew, luck, cw, cl: close.length - cw });
  }
  const out = [], up = [...all].sort((a, b) => b.luck - a.luck), down = [...all].sort((a, b) => a.luck - b.luck);
  for (const x of all) {
    if (Math.abs(x.luck) < DETECT.luckWins) continue;
    const rank = (x.luck > 0 ? up : down).indexOf(x) + 1, more = x.luck > 0;
    out.push({ kind: "luck", team: x.team, player: null, key: `luck|team|${x.team}`, rare: rank === 1, score: 3.6 + Math.min(1, Math.abs(x.luck) * 0.25) + (rank === 1 ? 0.3 : 0),
      text: `${x.team} is ${rec(x.w, x.l)} ${x.diff === 0 ? "with its points scored and allowed even" : `with a point differential of ${x.diff > 0 ? "+" : ""}${x.diff} (${x.diff > 0 ? "+" : ""}${r1(x.diff / x.n)} a game)`}, which usually makes ${an(x.ew)} ${rec(x.ew, x.n - x.ew)} team: ${r1(Math.abs(x.luck))} wins ${more ? "more" : "fewer"} than its scoring margin says, the ${rank === 1 ? "" : `${ord(rank)}-`}most ${more ? "above" : "below"} it in the NBA${x.cw + x.cl ? ` (${rec(x.cw, x.cl)} in games decided by 5 or fewer)` : ""}` });
  }
  return out;
}

/** luck (shooters): this season's 3P% / FT% far from his own career before it, on real volume. */
export function shootingLuck({ pg, names = {}, seasons = null, nameKey = (n) => n }) {
  if (!seasons?.players || !Array.isArray(seasons.keys)) return [];
  const K = Object.fromEntries(seasons.keys.map((k, i) => [k, i]));
  const career = {};
  for (const [name, rows] of Object.entries(seasons.players)) {
    const c = { fg3m: 0, fg3a: 0, ftm: 0, fta: 0 };
    for (const r of rows) for (const k of Object.keys(c)) c[k] += Number(r[K[k]]) || 0;
    career[nameKey(name)] = c;
  }
  const rows = [];
  for (const [id, gs] of Object.entries(pg || {})) {
    const name = names[id]; if (!name) continue;
    const c = career[nameKey(name)]; if (!c) continue;
    const s = gs.reduce((a, g) => ({ fg3m: a.fg3m + (g.fg3m || 0), fg3a: a.fg3a + (g.fg3a || 0), ftm: a.ftm + (g.ftm || 0), fta: a.fta + (g.fta || 0) }), { fg3m: 0, fg3a: 0, ftm: 0, fta: 0 });
    const team = gs[gs.length - 1].team;
    if (s.fg3a >= DETECT.shootMin3 && c.fg3a >= DETECT.careerMin3) rows.push({ id, name, team, what: "three", m: s.fg3m, a: s.fg3a, pct: s.fg3m / s.fg3a, cpct: c.fg3m / c.fg3a, ca: c.fg3a, gap: 100 * (s.fg3m / s.fg3a - c.fg3m / c.fg3a) });
    if (s.fta >= DETECT.shootMinFt && c.fta >= DETECT.careerMinFt) rows.push({ id, name, team, what: "free throw", m: s.ftm, a: s.fta, pct: s.ftm / s.fta, cpct: c.ftm / c.fta, ca: c.fta, gap: 100 * (s.ftm / s.fta - c.ftm / c.fta) });
  }
  const out = [];
  for (const what of ["three", "free throw"]) {
    const R = rows.filter((x) => x.what === what), bar = what === "three" ? DETECT.gap3 : DETECT.gapFt;
    const hi = R.filter((x) => x.gap >= bar).sort((a, b) => b.gap - a.gap), lo = R.filter((x) => x.gap <= -bar).sort((a, b) => a.gap - b.gap);
    for (const [list, word] of [[hi, "above"], [lo, "below"]]) list.slice(0, DETECT.shootTop).forEach((x, i) => out.push({ kind: "luck", team: x.team, player: x.name, key: `luck|${what}|${x.id}`, rare: i === 0,
      score: 3.4 + Math.min(1, Math.abs(x.gap) / 20) + (i === 0 ? 0.3 : 0),
      text: `${x.name} is shooting ${pc(x.pct)}% on ${what === "three" ? "threes" : "free throws"} this season (${x.m}-for-${x.a}), against ${pc(x.cpct)}% over his career before it (${x.ca.toLocaleString("en-US")} attempts): ${r1(Math.abs(x.gap))} points ${word} his own rate, the ${i === 0 ? "" : `${ord(i + 1)}-`}furthest ${word} among the ${R.length} players with ${what === "three" ? DETECT.shootMin3 : DETECT.shootMinFt}+ attempts` }));
  }
  return out;
}

/** paradox: his 30-point games, and his team keeps losing them. */
export function bigGameLosses({ pg, names = {} }) {
  const out = [];
  for (const [id, gs] of Object.entries(pg || {})) {
    const big = gs.filter((g) => g.pts >= DETECT.bigGame), w = big.filter((g) => g.win).length;
    if (big.length < DETECT.paradoxMin || w / big.length > DETECT.paradoxPct) continue;
    const rest = gs.filter((g) => g.pts < DETECT.bigGame), rw = rest.filter((g) => g.win).length, name = names[id] || id, team = gs[gs.length - 1].team;
    const avg = big.reduce((a, g) => a + g.pts, 0) / big.length;
    out.push({ kind: "paradox", team, player: name, key: `paradox|30|${id}`, rare: w === 0, score: 3.7 + Math.min(0.8, (big.length - w) * 0.15) + (w === 0 ? 0.3 : 0),
      text: `${name} has ${big.length} games of ${DETECT.bigGame}+ points this season (${r1(avg)} a game in them), and ${team} is ${rec(w, big.length - w)} in those games${rest.length ? ` (${rec(rw, rest.length - rw)} in the others)` : ""}` });
  }
  return out;
}

/** scarce: conditions only a few teams meet, the teams named. */
export function scarcity(rows) {
  const T = teamGamesOf(rows), out = [];
  const tests = [
    ["unbeaten at home", (gs) => { const h = gs.filter((g) => g.home); return h.length >= DETECT.scarceMin && h.every((g) => g.win) ? rec(h.length, 0) + " at home" : null; }],
    ["unbeaten on the road", (gs) => { const r = gs.filter((g) => g.road); return r.length >= DETECT.scarceMin && r.every((g) => g.win) ? rec(r.length, 0) + " on the road" : null; }],
    ["without a home win", (gs) => { const h = gs.filter((g) => g.home); return h.length >= DETECT.scarceMin && !h.some((g) => g.win) ? rec(0, h.length) + " at home" : null; }],
    ["without a road win", (gs) => { const r = gs.filter((g) => g.road); return r.length >= DETECT.scarceMin && !r.some((g) => g.win) ? rec(0, r.length) + " on the road" : null; }],
    ["unbeaten when leading after three quarters", (gs) => { const x = gs.filter((g) => g.q3 > 0); return x.length >= 5 && x.every((g) => g.win) ? rec(x.length, 0) + " when leading after three quarters" : null; }],
    ["without a win when trailing after three quarters", (gs) => { const x = gs.filter((g) => g.q3 < 0); return x.length >= 5 && !x.some((g) => g.win) ? rec(0, x.length) + " when trailing after three quarters" : null; }],
    ["unbeaten in games decided by 5 or fewer", (gs) => { const x = gs.filter((g) => g.close); return x.length >= DETECT.scarceMin && x.every((g) => g.win) ? rec(x.length, 0) + " in games decided by 5 or fewer" : null; }],
    ["without a win in games decided by 5 or fewer", (gs) => { const x = gs.filter((g) => g.close); return x.length >= DETECT.scarceMin && !x.some((g) => g.win) ? rec(0, x.length) + " in games decided by 5 or fewer" : null; }],
  ];
  for (const [label, test] of tests) {
    const hits = Object.entries(T).map(([t, gs]) => [t, test(gs)]).filter(([, s]) => s);
    if (!hits.length || hits.length > DETECT.scarceMax) continue;
    for (const [team, said] of hits) {
      const others = hits.filter(([t]) => t !== team).map(([t]) => t);
      out.push({ kind: "scarce", team, player: null, key: `scarce|${label}|${team}`, rare: hits.length === 1, score: 3.6 + (hits.length === 1 ? 0.5 : hits.length === 2 ? 0.25 : 0),
        text: `${team} is ${said}: ${hits.length === 1 ? `the only team ${label}` : `one of ${hits.length} teams ${label} (${listOf(others)} ${others.length === 1 ? "is the other" : "are the others"})`}` });
    }
  }
  return out;
}

/**
 * defpos: what each defense gives up to guards, forwards and centers, measured against those players' own season
 * averages (so a defense that faced a run of stars isn't blamed for their usual nights). A defense among the three
 * that give up the most or the least to one position, by 2+ points a game over 25+ player-games, is said for
 * tonight's opponent, naming its players at that position (8+ points a game).
 */
export function defenseByPosition({ pg, names = {}, positions = {}, posGroup, slate = [] }) {
  if (!posGroup || !slate.length) return [];
  const avg = {}, pos = {}, team = {};
  for (const [id, gs] of Object.entries(pg || {})) { avg[id] = gs.reduce((a, g) => a + g.pts, 0) / gs.length; pos[id] = posGroup(positions[id]); team[id] = gs[gs.length - 1].team; }
  const acc = {};
  for (const [id, gs] of Object.entries(pg || {})) {
    const P = pos[id]; if (!P || gs.length < 4) continue;
    for (const g of gs) {
      if (!(g.min >= 15)) continue;
      // his average from his other games, so tonight's line doesn't move its own baseline
      const other = (avg[id] * gs.length - g.pts) / (gs.length - 1);
      const a = ((acc[g.opp] ??= {})[P] ??= { n: 0, sum: 0 }); a.n++; a.sum += g.pts - other;
    }
  }
  const out = [];
  for (const P of ["G", "F", "C"]) {
    const L = Object.entries(acc).map(([t, x]) => ({ t, n: x[P]?.n || 0, v: x[P] ? x[P].sum / x[P].n : 0 })).filter((x) => x.n >= DETECT.posMinGames).sort((a, b) => b.v - a.v);
    const word = { G: "guards", F: "forwards", C: "centers" }[P];
    L.forEach((d, i) => {
      const most = i < DETECT.posTop, least = i >= L.length - DETECT.posTop;
      if ((!most && !least) || Math.abs(d.v) < DETECT.posGap) return;
      const rank = most ? i + 1 : L.length - i;
      for (const g of slate) {
        const off = g.away === d.t ? g.home : g.home === d.t ? g.away : null;
        if (!off) continue;
        const who = Object.keys(pg).filter((id) => team[id] === off && pos[id] === P && avg[id] >= DETECT.posMinPpg).sort((a, b) => avg[b] - avg[a]).slice(0, 2);
        if (!who.length) continue;
        out.push({ kind: "defpos", team: off, player: names[who[0]] || who[0], key: `defpos|${d.t}|${P}`, rare: rank === 1, score: 3.5 + Math.min(0.8, Math.abs(d.v) / 6) + (rank === 1 ? 0.2 : 0),
          text: `Opposing ${word} have scored ${r1(Math.abs(d.v))} points a game ${d.v > 0 ? "more" : "fewer"} than their own averages against ${d.t} (${d.n} games of 15+ minutes), the ${rank === 1 ? "" : `${ord(rank)}-`}${most ? "most" : "fewest"} in the NBA; tonight: ${who.map((id) => `${names[id] || id} (${r1(avg[id])} a game)`).join(", ")}` });
      }
    });
  }
  return out;
}

/** All four. */
export function detectorLines(args) {
  const out = [];
  for (const [name, f] of [["team luck", () => teamLuck(args.rows)], ["shooting luck", () => shootingLuck(args)], ["paradox", () => bigGameLosses(args)], ["scarcity", () => scarcity(args.rows)], ["defense by position", () => defenseByPosition(args)]]) {
    try { out.push(...f()); } catch (e) { (args.errors ||= []).push(`${name}: ${e.message}`); }
  }
  return out;
}
