/**
 * Streaks and anomalies from the season's per-game player lines (pure).
 *
 * Input rows: results rows with `pl` (see results.js):
 *   pl = { espnId: [side 0 home | 1 away, starter, min, pts, fgm, fga, fg3m, fg3a, ftm, fta, reb, ast, tov, stl, blk, oreb, dreb, pf, pm] }
 *
 * Streaks count games a player PLAYED (missed games neither extend nor break
 * them), this season only: a run that began last season shows only its
 * this-season part. A streak is "active" if it includes the player's latest
 * game.
 *
 * Anomaly: one game against the same player's other games this season.
 *   score = (value - his average elsewhere) / max(his spread elsewhere, floor)
 * The floor stops a steady player's 1-point move from looking huge (points 4,
 * rebounds 2.5, assists 2, threes 1.2, minutes 5). It needs 5+ other games. A
 * game is listed when a score is 2.5+ (or -2.5 or lower for points or minutes
 * of a regular: 15+ points or 20+ minutes a game), or it's a season high by a
 * clear margin. Ranked by the biggest score.
 */
const IX = { side: 0, starter: 1, min: 2, pts: 3, fgm: 4, fga: 5, fg3m: 6, fg3a: 7, ftm: 8, fta: 9, reb: 10, ast: 11, tov: 12, stl: 13, blk: 14, oreb: 15, dreb: 16, pf: 17, pm: 18 };
export const LINE_IX = IX;

/** Each player's games, in date order: { id: [{ d, gameId, team, opp, home, win, min, pts, ... }] } */
export function playerGames(rows) {
  const out = {};
  for (const g of [...rows].sort((a, b) => a.d.localeCompare(b.d) || a.id.localeCompare(b.id))) {
    if (!g.pl) continue;
    for (const [id, v] of Object.entries(g.pl)) {
      // 0.145.0: a few seconds on the floor (0 minutes, not a DNP: the store's z) is a game played, as the NBA counts it.
      const cameo = !(v[IX.min] > 0) && (g.z || []).includes(id);
      if (!(v[IX.min] > 0) && !cameo) continue;
      const home = v[IX.side] === 0;
      const line = { d: g.d, gameId: g.id, team: home ? g.h : g.a, opp: home ? g.a : g.h, home: home && !g.n, win: home ? g.hs > g.as : g.as > g.hs };
      for (const [k, i] of Object.entries(IX)) if (i >= 1) line[k] = v[i];
      if (cameo) line.cameo = 1;
      (out[id] ??= []).push(line);
    }
  }
  return out;
}

export const STREAKS = [
  ["pts10", "10+ points", (l) => l.pts >= 10, 8],
  ["pts20", "20+ points", (l) => l.pts >= 20, 4],
  ["pts25", "25+ points", (l) => l.pts >= 25, 3],
  ["pts30", "30+ points", (l) => l.pts >= 30, 2],
  ["reb10", "10+ rebounds", (l) => l.reb >= 10, 3],
  ["ast8", "8+ assists", (l) => l.ast >= 8, 3],
  ["dd", "Double-double", (l) => [l.pts, l.reb, l.ast, l.stl, l.blk].filter((x) => x >= 10).length >= 2, 3],
  ["three", "Made a three", (l) => l.fg3m >= 1, 8],
  ["threes3", "3+ threes", (l) => l.fg3m >= 3, 3],
  ["start", "Starts", (l) => l.starter === 1, 0],
];

/** Active streaks at or above each category's minimum, longest first. */
/**
 * 0.145.0: a run that covers every game he has played this season goes on from last season (carry: src/data/streak-carry-*.json,
 * made by tools/streak-carry.mjs from ESPN's game logs: { players: { id: { key: [n, from] } } }). Where the Records page and NBA
 * Live hold the same run from Basketball-Reference's list (featlive.json streaks: Curry's made threes), that count is used, so
 * every page says one number. length = the whole run; thisSeason = its games this season; carried = from before; since = its start.
 */
const FEAT_KEY = (tests) => (tests?.length === 1 && tests[0].k === "fg3m" ? (tests[0].min === 1 ? "three" : tests[0].min === 3 ? "threes3" : null) : null);
export function activeStreaks(pg, names = {}, { carry = null, featlive = null } = {}) {
  const out = [];
  const listed = new Map();
  for (const s of featlive?.streaks || []) { const k = FEAT_KEY(s.tests); if (k && s.source === "list") listed.set(`${s.id}|${k}`, s); }
  for (const [id, games] of Object.entries(pg)) {
    for (const [key, label, test, min] of STREAKS) {
      if (key === "start") continue;
      let n = 0;
      for (let i = games.length - 1; i >= 0 && test(games[i]); i--) n++;
      let best = 0, run = 0;
      for (const g of games) { run = test(g) ? run + 1 : 0; best = Math.max(best, run); }
      const before = n === games.length ? carry?.players?.[id]?.[key] || null : null;
      const fromList = n === games.length ? listed.get(`${id}|${key}`) : null;
      const carried = fromList ? Math.max(0, fromList.n - n) : before ? before[0] : 0;
      const total = n + carried;
      if (total >= Math.max(min, 2) && n >= 1) {
        out.push({ id, name: names[id] || id, team: games[games.length - 1].team, key, label, length: total, ofGames: games.length, since: carried ? (before?.[1] || games[0].d) : games[games.length - n].d, last: games[games.length - 1].d, seasonBest: best,
          ...(carried ? { thisSeason: n, carried, carriedFrom: fromList ? "list" : "logs" } : {}) });
      }
    }
  }
  return out.sort((a, b) => b.length - a.length || a.name.localeCompare(b.name));
}

/**
 * Team streaks: wins, losses, home, road; their own scoring (120+, 110+, held under 110) and their
 * defence (opponents held under 110 and under 100, opponents scoring 120+). Each is the current run.
 */
export function teamStreaks(rows) {
  const tg = {};
  for (const g of [...rows].sort((a, b) => a.d.localeCompare(b.d) || a.id.localeCompare(b.id))) {
    for (const home of [true, false]) {
      const t = home ? g.h : g.a;
      (tg[t] ??= []).push({ d: g.d, home: home && !g.n, road: !home && !g.n, pf: home ? g.hs : g.as, pa: home ? g.as : g.hs });
    }
  }
  const run = (list, test) => { let n = 0; for (let i = list.length - 1; i >= 0 && test(list[i]); i--) n++; return n; };
  const out = {};
  for (const [t, games] of Object.entries(tg)) {
    const last = games[games.length - 1];
    const win = last.pf > last.pa;
    const homeG = games.filter((x) => x.home), roadG = games.filter((x) => x.road);
    const hw = homeG.length ? homeG[homeG.length - 1].pf > homeG[homeG.length - 1].pa : null;
    const rw = roadG.length ? roadG[roadG.length - 1].pf > roadG[roadG.length - 1].pa : null;
    out[t] = {
      streak: { type: win ? "W" : "L", n: run(games, (x) => (x.pf > x.pa) === win) },
      home: hw === null ? null : { type: hw ? "W" : "L", n: run(homeG, (x) => (x.pf > x.pa) === hw) },
      road: rw === null ? null : { type: rw ? "W" : "L", n: run(roadG, (x) => (x.pf > x.pa) === rw) },
      scored120: run(games, (x) => x.pf >= 120),
      scored110: run(games, (x) => x.pf >= 110),
      under110: run(games, (x) => x.pf < 110),
      held110: run(games, (x) => x.pa < 110),
      held100: run(games, (x) => x.pa < 100),
      allowed120: run(games, (x) => x.pa >= 120),
    };
  }
  return out;
}

const FLOOR = { pts: 4, reb: 2.5, ast: 2, fg3m: 1.2, stl: 1, blk: 1, min: 5 };
const LABEL = { pts: "points", reb: "rebounds", ast: "assists", fg3m: "threes", stl: "steals", blk: "blocks", min: "minutes" };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };

/** Unusual single games on the given dates (default: the latest date with games). */
/**
 * Career highs before this season, for "career high" on outlier games (the user, 11/13: a career high supersedes
 * a season high, and is the only one a rookie has).
 *   logs     player-logs-history.json.gz ({ players: { espnId: [[date, opp, home, W|L, type, min, pts, reb, ast, stl, blk, fg3m, …]] } }), 2016-17 on
 *   seasons  nba-career-seasons-<season>.json ({ keys, players: { name: [[season, …, hi]] } }): every season back to 1979-80; "hi" is his
 *            high in points that season, so points are known for everyone it lists
 *   names    { espnId: name }; season: this season ("2026-27")
 * -> { espnId: { hi: { pts, reb, … }, known: Set(stats) } }. A stat is known when his whole career is on file:
 *    points for anyone the guide lists (or a rookie), the rest when his first season is 2016-17 or later.
 */
export function careerHighs({ logs = null, seasons = null, names = {}, ids = [], season = null, nameKey = (n) => n }) {
  const L = { min: 5, pts: 6, reb: 7, ast: 8, stl: 9, blk: 10, fg3m: 11 };
  const SRC = (logs?.columns || []).indexOf("src"), FROM_FILL = new Set(["pts", "fg3m"]), FILL_SLACK = { min: 2, reb: 2, ast: 1, stl: 3, blk: 1 };   // one more than the miss seen in each (assists and blocks matched); a judgment
  const S = Object.fromEntries((seasons?.keys || []).map((k, i) => [k, i]));
  const byName = new Map(Object.entries(seasons?.players || {}).map(([n, rows]) => [nameKey(n), rows]));
  const out = {};
  for (const id of ids) {
    // 0.110: the logs may carry the games ESPN lacks (src "p", src/situations/logfill.js). Those rows count for points and
    // threes only; everything else here reads the rows it always read.
    const every = (logs?.players?.[id] || []).filter((r) => r[4] === 2 && (!season || seasonOfDate(r[0]) !== season));
    const rows = SRC < 0 ? every : every.filter((r) => r[SRC] !== "p"), filled = every.length - rows.length;
    const sz = byName.get(nameKey(names[id] || "")) || null;
    const past = sz ? sz.filter((r) => r[S.season] !== season) : null;
    const first = past?.length ? past[0][S.season] : rows.length ? seasonOfDate(rows[0][0]) : null;
    const rookie = !first && !rows.length;
    const hi = {}, known = new Set();
    // Whole career on file: a rookie; the guide's first season is 2016-17 or later; or (not in the guide) the logs begin after
    // 2016-17 (logs that begin in 2016-17 may be the middle of a longer career).
    const whole = rookie || (past?.length ? first >= "2016-17" && rows.length > 0 : first > "2016-17");
    if (whole) for (const k of Object.keys(L)) known.add(k);
    for (const [k, i] of Object.entries(L)) for (const r of FROM_FILL.has(k) ? every : rows) hi[k] = Math.max(hi[k] ?? 0, r[i] || 0);
    // The other stats in those games are only a floor (steals run short, rebounds can be one off: 5 against 7 and 15
    // against 16 in the one game checked). A whole career stays "known" in a stat unless one of those games comes
    // within FILL_SLACK of passing his high: then the high may be in a game we cannot read, and no "career high" is said.
    if (filled) for (const [k, i] of Object.entries(L)) if (!FROM_FILL.has(k) && every.some((r) => r[SRC] === "p" && (r[i] || 0) + FILL_SLACK[k] > (hi[k] ?? 0))) known.delete(k);
    if (past && S.hi != null) { known.add("pts"); for (const r of past) hi.pts = Math.max(hi.pts ?? 0, r[S.hi] || 0); }
    out[id] = { hi, known, rookie };
  }
  return out;
}
const seasonOfDate = (d) => { const y = Number(d.slice(0, 4)) + (Number(d.slice(5, 7)) >= 8 && !(d >= "2020-07-01" && d <= "2020-10-31") ? 1 : 0); return `${y - 1}-${String(y).slice(2)}`; };

/**
 * How often a night this far from his norm happens (0.141.15): the share of player-games over the last four seasons at
 * least as far out, measured the same way (src/data/outlier-tails.json, tools/outlier-tails.mjs). The bell curve the
 * spreads assume makes these far rarer than they are (points at 2.5 spreads: 1 in 35 player-games, not 1 in 160), and a
 * spread means different things per stat (blocks at 2.5: 1 in 108). Log-linear between the measured steps.
 */
export function noteShare(n, tails) {
  if (!tails) return null;
  const at = (xs, ys, x) => {
    if (!ys) return null;
    if (x <= xs[0]) return ys[0];
    for (let i = 1; i < xs.length; i++) if (x <= xs[i]) {
      const a = Math.max(ys[i - 1], 1e-7), b = Math.max(ys[i], 1e-7), f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return Math.exp(Math.log(a) + f * (Math.log(b) - Math.log(a)));
    }
    return Math.max(ys[ys.length - 1], 1e-7);
  };
  if (n.stat === "fg3cold") return tails.cold3 ?? null;
  if (n.stat === "fgp") return at(tails.fgDiff, n.low ? tails.fgLow : tails.fgHigh, Math.abs(n.value - n.avg) / 100);
  return n.z < 0 ? at(tails.z, tails.down?.[n.stat], -n.z) : at(tails.z, tails.up?.[n.stat], n.z);
}
/** "1 in N", N to two significant figures. */
export const oneIn = (share) => (share > 0 ? Number((1 / share).toPrecision(2)) : null);

export function anomalies(pg, names = {}, { dates = null, minOther = 5, threshold = 2.5, careers = null, tails = null } = {}) {
  const all = Object.values(pg).flat().map((l) => l.d);
  const latest = all.length ? all.reduce((a, b) => (a > b ? a : b)) : null;
  const want = new Set(dates || (latest ? [latest] : []));
  const out = [];
  for (const [id, games] of Object.entries(pg)) {
    games.forEach((g, i) => {
      if (!want.has(g.d)) return;
      const other = games.filter((_, j) => j !== i);
      if (other.length < minOther) return;
      const notes = [];
      let best = 0;
      for (const k of Object.keys(FLOOR)) {
        const xs = other.map((o) => o[k]);
        const m = mean(xs), s = Math.max(sd(xs), FLOOR[k]);
        const z = (g[k] - m) / s;
        // Highs as of that night: his earlier games this season (not later ones), and his career before it.
        const prior = games.slice(0, i).map((o) => o[k]);
        const high = prior.length ? Math.max(...prior) : null;
        const regular = k === "pts" ? m >= 15 : k === "min" ? m >= 20 : false;
        const seasonHigh = high != null && g[k] > high && g[k] - high >= FLOOR[k];
        const c = careers?.[id];
        const cPrev = c?.known?.has(k) ? Math.max(c.hi?.[k] ?? 0, high ?? 0) : null;
        const careerHigh = cPrev != null && (high != null || c.hi?.[k] != null) && g[k] > cPrev && g[k] > 0;
        const tiesCareer = !careerHigh && cPrev != null && cPrev > 0 && g[k] === cPrev && (high == null || g[k] > high);
        if (z >= threshold || (z <= -threshold && regular) || ((seasonHigh || careerHigh) && z >= 1.5)) {
          notes.push({ stat: k, value: g[k], avg: Math.round(m * 10) / 10, z: Math.round(z * 100) / 100, seasonHigh: seasonHigh || careerHigh, prevHigh: high, low: z < 0,
            ...(careerHigh ? { careerHigh: true, prevCareer: cPrev } : tiesCareer && z > 0 ? { tiesCareer: true } : {}) });
          best = Math.max(best, Math.abs(z));
        }
      }
      // Shooting: 10+ shots at least 25 points of FG% off his usual, or 0 for 6+ from three.
      const fgaO = other.reduce((a, o) => a + o.fga, 0), fgmO = other.reduce((a, o) => a + o.fgm, 0);
      if (g.fga >= 10 && fgaO >= 30) {
        const usual = fgmO / fgaO, now = g.fgm / g.fga;
        if (Math.abs(now - usual) >= 0.25) { notes.push({ stat: "fgp", value: Math.round(now * 1000) / 10, avg: Math.round(usual * 1000) / 10, fgm: g.fgm, fga: g.fga, low: now < usual, z: (now - usual) * 10 }); best = Math.max(best, Math.abs(now - usual) * 10); }
      }
      if (g.fg3a >= 6 && g.fg3m === 0) { notes.push({ stat: "fg3cold", value: 0, fg3a: g.fg3a, low: true, z: -2.5 }); best = Math.max(best, 2.5); }
      if (!notes.length) return;
      // 0.141.15: each note's measured rarity, and the night's rarest.
      let rare = null;
      for (const nt of notes) { const sh = noteShare(nt, tails); if (sh != null) { nt.oneIn = oneIn(sh); if (rare == null || sh < rare) rare = sh; } }
      out.push({ id, name: names[id] || id, team: g.team, opp: g.opp, home: g.home, win: g.win, d: g.d, min: g.min, line: { pts: g.pts, reb: g.reb, ast: g.ast, fgm: g.fgm, fga: g.fga, fg3m: g.fg3m, fg3a: g.fg3a }, games: games.length, score: Math.round(best * 100) / 100,
        ...(rare != null ? { share: Number(rare.toPrecision(3)), oneIn: oneIn(rare) } : {}), notes, text: describe(g, notes) });
    });
  }
  // Rarest first when measured (0.141.15), else by spreads as before.
  return out.sort((a, b) => (a.share != null && b.share != null ? a.share - b.share : 0) || b.score - a.score);
}

function describe(g, notes) {
  return notes.map((n) => {
    if (n.stat === "fgp") return `shot ${n.fgm}-${n.fga} (${n.value}%; usually ${n.avg}%)`;
    if (n.stat === "fg3cold") return `0-${n.fg3a} from three`;
    const hi = n.careerHigh ? `, career high (previous ${n.prevCareer})` : n.tiesCareer ? ", ties his career high" : n.seasonHigh ? `, season high (previous ${n.prevHigh})` : "";
    return `${n.value} ${LABEL[n.stat]} (averages ${n.avg}${hi})`;
  }).join("; ");
}

/**
 * Career highs allowed (0.65, the user 11/14: "track which teams have allowed opposing players to score their
 * career-highs this season… rookies would have to be differentiated"). Points only. A game counts when it beats
 * everything he scored before it: his career high entering the season (careerHighs) and this season's games so far,
 * so a player can set more than one. A rookie's debut is not counted (any total is a career high); his later new
 * bests are, marked as a rookie's.
 * -> { games: [{ id, name, team, against, home, d, pts, prev, rookie }], teams: [{ tri, vets, rookies, games }], repeat (0.78) }
 */
export const HIGH_MIN = 10; // a career high of 7 isn't a story
export function careerHighsAllowed(pg, careers, names = {}) {
  const games = [];
  for (const [id, list] of Object.entries(pg)) {
    const c = careers?.[id];
    if (!c) continue;
    const rookie = !!c.rookie;
    let best = rookie ? null : c.known?.has?.("pts") ? c.hi?.pts ?? null : null;
    if (!rookie && best == null) continue; // his career before this season isn't on file
    list.forEach((g, k) => {
      if (!(g.pts > 0) || (best != null && g.pts <= best)) return;
      if (!(rookie && k === 0) && g.pts >= HIGH_MIN) games.push({ id, name: names[id] || id, team: g.team, against: g.opp, home: g.home, d: g.d, pts: g.pts, prev: best, rookie });
      best = g.pts;
    });
  }
  games.sort((a, b) => b.d.localeCompare(a.d) || b.pts - a.pts);
  const by = {};
  for (const g of games) { const t = (by[g.against] ??= { tri: g.against, vets: 0, rookies: 0, games: [] }); t[g.rookie ? "rookies" : "vets"]++; t.games.push(g); }
  const teams = Object.values(by).sort((a, b) => b.vets - a.vets || b.rookies - a.rookies || a.tri.localeCompare(b.tri));
  return { games, teams, repeat: repeatHighs(games) };
}

/**
 * Players who have raised their career high more than once this season (0.78; the user, 11/16: "a non-rookie (Dylan
 * Harper) set his career-high twice already this season, it might be something to monitor if he or anyone else keeps
 * doing it"). Everyone in the league, rookies marked.
 * games: careerHighsAllowed's. -> [{ id, name, team, rookie, n, steps: [high entering, each new high], dates, last }], most first.
 */
export function repeatHighs(games) {
  const by = {};
  for (const g of games || []) (by[g.id] ??= []).push(g);
  return Object.values(by).filter((L) => L.length >= 2).map((L) => {
    L = L.slice().sort((a, b) => a.d.localeCompare(b.d));
    const end = L[L.length - 1];
    return { id: end.id, name: end.name, team: end.team, rookie: !!end.rookie, n: L.length, steps: [L[0].prev, ...L.map((g) => g.pts)], dates: L.map((g) => g.d), last: end.d };
  }).sort((a, b) => b.n - a.n || b.last.localeCompare(a.last) || a.name.localeCompare(b.name));
}
