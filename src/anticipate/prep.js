/**
 * Prep stats (0.66): the kinds of line other accounts post before and after games, worked out ahead of time.
 * The user's examples (11/14), one detector each:
 *
 *   seasonLines  "Curry this season: 30.6 PPG (highest since '20-21), 50.3% FG (highest since '15-16), 45.7% 3PT (career-high)";
 *                "Durant: 21.0 PPG (lowest since his rookie year), 12.8 FGA/G (career-low)"; Jokić's career-worst 22.9% from three.
 *   absenceLines "Ayo Dosunmu since Anthony Edwards' injury: 20.6 PPG, 5.7 RPG… Wolves' leading scorer, 4-2 in that span."
 *   runLines     "Curry over the Warriors' 7-game winning streak: 6 GP, 33.8 PPG… 73.3 TS%"; Wemby over the Spurs' 9 straight.
 *   streakLines  "Players with 40+ in 5 straight games… Luka can join tonight"; Franz Wagner's 30+ in four straight.
 *   vsOppLines   "Jokić has a triple-double in 14 of his last 17 games vs. the Pelicans."
 *   paceLines    "Most points through the first 10 games of a season: … Luka Dončić 393 (this season)."
 *
 * History: the ESPN game logs of current players (2016-17 on) and the NBA Guide's year-by-year seasons (1979-80 on, active
 * players). The logs hold only current players, so every count from them says "since 2016-17" and is among current players.
 */
const STATS = ["min", "pts", "reb", "ast", "stl", "blk", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "tov"];
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const pct = (m, a) => (a ? (100 * m) / a : null);
const ts = (t) => (t.fga + 0.44 * t.fta ? (100 * t.pts) / (2 * (t.fga + 0.44 * t.fta)) : null);
const short = (season) => `'${season.slice(2, 4)}-${season.slice(5, 7)}`;
const surname = (n) => n.replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV)$/, "").split(" ").slice(-1)[0];
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;

function sum(games) {
  const t = { g: games.length };
  for (const k of STATS) t[k] = games.reduce((s, g) => s + (g[k] || 0), 0);
  return t;
}

/** A game's line in the logs' column order -> { d, opp, home, win, type, min, pts, … }. */
// One conversion per logs object (0.72): three detectors ask for it, and every "Did we see it coming?" morning asks again.
const LOG_ROWS = new WeakMap();
function logRows(logs) {
  if (logs && LOG_ROWS.has(logs)) return LOG_ROWS.get(logs);
  const out = logRows0(logs);
  if (logs) LOG_ROWS.set(logs, out);
  return out;
}
function logRows0(logs) {
  const C = logs?.columns || [];
  const ix = Object.fromEntries(C.map((c, i) => [c, i]));
  const out = {};
  for (const [id, rows] of Object.entries(logs?.players || {})) {
    out[id] = rows.map((r) => ({ d: r[ix.date], opp: r[ix.opp], home: !!r[ix.home], win: r[ix.result] === "W", type: r[ix.type],
      ...Object.fromEntries(STATS.filter((k) => ix[k] != null).map((k) => [k, r[ix[k]] ?? 0])) }));
  }
  return out;
}
const seasonOfDate = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return m >= 8 ? `${y}-${String((y + 1) % 100).padStart(2, "0")}` : `${y - 1}-${String(y % 100).padStart(2, "0")}`; };
const td = (g) => [g.pts, g.reb, g.ast, g.stl, g.blk].filter((x) => x >= 10).length >= 3;
const dd = (g) => [g.pts, g.reb, g.ast, g.stl, g.blk].filter((x) => x >= 10).length >= 2;

// ---------------------------------------------------------------------------------------------------------------
// 1. This season against his career seasons.
const METRICS = [
  // key, label, value(t), worth saying this season (t, high?), qualifies a past season (t), lows worth saying (career)
  ["ppg", "PPG", (t) => t.pts / t.g, (t, hi) => t.min / t.g >= 20 && (!hi || t.pts / t.g >= 15), (t) => t.g >= 20, (c) => c.bestPpg >= 15],
  ["rpg", "RPG", (t) => t.reb / t.g, (t, hi) => t.min / t.g >= 20 && hi && t.reb / t.g >= 8, (t) => t.g >= 20, () => false],
  ["apg", "APG", (t) => t.ast / t.g, (t, hi) => t.min / t.g >= 20 && hi && t.ast / t.g >= 6, (t) => t.g >= 20, () => false],
  ["fgp", "FG", (t) => pct(t.fgm, t.fga), (t) => t.fga / t.g >= 9, (t) => t.fga >= 300, (c) => c.bestPpg >= 15],
  ["fg3p", "3PT", (t) => pct(t.fg3m, t.fg3a), (t) => t.fg3a / t.g >= 4, (t) => t.fg3a >= 120, (c) => c.bestPpg >= 15],
  ["fga", "FGA/G", (t) => t.fga / t.g, (t, hi) => t.min / t.g >= 20 && !hi, (t) => t.g >= 20, (c) => c.bestPpg >= 20],
  ["ts", "TS%", ts, (t) => t.fga / t.g >= 12, (t) => t.fga >= 500, (c) => c.bestPpg >= 18],
];
// What a line keeps: the order a reader wants, at most three.
const ORDER = ["ppg", "rpg", "apg", "fgp", "fg3p", "ts", "fga"];
const fmtM = (k, v) => (["fgp", "fg3p", "ftp"].includes(k) ? `${r1(v)}%` : r1(v));

export function seasonLines({ pg, seasons, names, nameKey = (n) => n, season, minGames = 6 }) {
  const K = seasons?.keys || [];
  const ix = Object.fromEntries(K.map((k, i) => [k, i]));
  const byName = new Map(Object.entries(seasons?.players || {}).map(([n, rows]) => [nameKey(n), rows]));
  const out = [];
  for (const [id, games] of Object.entries(pg)) {
    const name = names[id];
    if (!name || games.length < minGames) continue;
    const past = (byName.get(nameKey(name)) || []).filter((r) => r[ix.season] < season)
      .map((r) => ({ season: r[ix.season], ...Object.fromEntries(["g", ...STATS].filter((k) => ix[k] != null).map((k) => [k, r[ix[k]] || 0])) }));
    if (past.filter((p) => p.g >= 20).length < 3) continue;
    const now = sum(games);
    const team = games[games.length - 1].team;
    const ctx = { bestPpg: Math.max(...past.filter((p) => p.g >= 20).map((p) => p.pts / p.g), 0) };
    const first = past[0].season;
    const parts = [];
    let best = 0;
    for (const [k, label, val, okNow, okPast, lowsOk] of METRICS) {
      const v = val(now);
      const P = past.filter(okPast).map((p) => ({ season: p.season, v: val(p) })).filter((p) => p.v != null);
      if (v == null || P.length < 3) continue;
      for (const dir of [1, -1]) {
        if (!okNow(now, dir > 0) || (dir < 0 && !lowsOk(ctx))) continue;
        const beats = (p) => (dir > 0 ? v > p.v + 1e-9 : v < p.v - 1e-9);
        if (P.every(beats)) {
          parts.push({ k, s: `${fmtM(k, v)} ${label} (career-${dir > 0 ? "high" : "low"})`, w: 2.6 + (dir < 0 ? 0.15 : 0) });
          break;
        }
        // Since when: the last past season at least this good.
        const last = [...P].reverse().find((p) => !beats(p));
        const gap = last ? past.filter((p) => p.season > last.season).length : 0;
        if (last && gap >= 4) {
          const rookie = last.season === first;
          parts.push({ k, s: `${fmtM(k, v)} ${label} (${dir > 0 ? "highest" : "lowest"} since ${rookie ? "his rookie year" : short(last.season)})`, w: 2.1 + Math.min(0.5, gap * 0.05) });
          break;
        }
      }
    }
    if (!parts.length) continue;
    // FGA/G alone isn't a story; TS% is said only when FG% isn't.
    let P2 = parts.filter((p) => !(p.k === "ts" && parts.some((q) => q.k === "fgp")));
    // FGA/G only beside a scoring low (Durant: "12.8 FGA/G (career-low)").
    if (!P2.some((p) => p.k === "ppg" && /low/.test(p.s))) P2 = P2.filter((p) => p.k !== "fga");
    // One shooting number alone isn't a line; scoring alone is.
    if (!P2.length || (P2.length === 1 && P2[0].k !== "ppg")) continue;
    P2 = P2.sort((a, b) => b.w - a.w).slice(0, 3).sort((a, b) => ORDER.indexOf(a.k) - ORDER.indexOf(b.k));
    best = Math.max(...P2.map((p) => p.w));
    out.push({ kind: "season", team, player: name, id, key: `season|${id}|${P2.map((p) => p.k).join(",")}`,
      text: `${name} this season (${now.g} games): ${P2.map((p) => p.s).join(", ")}`, score: best + 0.15 * (P2.length - 1), rare: P2.some((p) => /career-/.test(p.s)) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Team games this season, in order: { TRI: [{ id, d, opp, win }] }.
function teamGames(rows) {
  const T = {};
  for (const g of [...rows].filter((g) => g.hs != null && g.as != null).sort((a, b) => a.d.localeCompare(b.d) || String(a.id).localeCompare(String(b.id)))) {
    (T[g.h] ??= []).push({ id: g.id, d: g.d, opp: g.a, win: g.hs > g.as });
    (T[g.a] ??= []).push({ id: g.id, d: g.d, opp: g.h, win: g.as > g.hs });
  }
  return T;
}
const statLine = (t, { tsToo = false } = {}) => {
  const bits = [`${r1(t.pts / t.g)} PPG`, `${r1(t.reb / t.g)} RPG`, `${r1(t.ast / t.g)} APG`];
  if (t.stl / t.g >= 1.5) bits.push(`${r1(t.stl / t.g)} SPG`);
  if (t.blk / t.g >= 1.5) bits.push(`${r1(t.blk / t.g)} BPG`);
  if (t.fga >= 20) bits.push(`${Math.round(pct(t.fgm, t.fga))}% FG`);
  if (t.fg3a >= 15) bits.push(`${Math.round(pct(t.fg3m, t.fg3a))}% 3PT`);
  if (tsToo && ts(t) != null) bits.push(`${r1(ts(t))} TS%`);
  return bits.join(", ");
};

// 2. Since a key teammate went out: who has stepped up, and the team's record.
export function absenceLines({ pg, rows, names, minOut = 3 }) {
  const T = teamGames(rows);
  const byTeam = {};
  for (const [id, games] of Object.entries(pg)) for (const g of games) ((byTeam[g.team] ??= {})[id] ??= new Map()).set(g.gameId, g);
  const out = [];
  for (const [team, list] of Object.entries(T)) {
    const players = byTeam[team] || {};
    for (const [id, gm] of Object.entries(players)) {
      const played = list.filter((g) => gm.has(g.id));
      const ppg = played.reduce((s, g) => s + gm.get(g.id).pts, 0) / Math.max(1, played.length);
      if (played.length < 3 || ppg < 18) continue;
      // Out for the team's last N games (and not traded: his last game was for this team).
      let n = 0;
      for (let i = list.length - 1; i >= 0 && !gm.has(list[i].id); i--) n++;
      if (n < minOut) continue;
      const span = list.slice(list.length - n), before = list.slice(0, list.length - n);
      const W = span.filter((g) => g.win).length;
      // The teammate who has done the most with him out: points per game in the span (2+ games), vs before.
      let best = null;
      for (const [oid, om] of Object.entries(players)) {
        if (oid === id) continue;
        const sg = span.filter((g) => om.has(g.id)).map((g) => om.get(g.id)), bg = before.filter((g) => om.has(g.id)).map((g) => om.get(g.id));
        if (sg.length < Math.max(2, n - 2)) continue;
        const t = sum(sg), b = bg.length ? sum(bg) : null;
        const up = t.pts / t.g - (b ? b.pts / b.g : 0);
        if (!best || t.pts / t.g > best.t.pts / best.t.g) best = { oid, t, b, up };
      }
      if (!best || best.t.pts / best.t.g < 12 || (best.b && best.up < 3)) continue;
      const who = names[best.oid] || best.oid, out0 = names[id] || id;
      const lead = Object.entries(players).every(([oid, om]) => oid === best.oid || oid === id || span.filter((g) => om.has(g.id)).reduce((s, g) => s + om.get(g.id).pts, 0) / Math.max(1, span.filter((g) => om.has(g.id)).length) <= best.t.pts / best.t.g);
      out.push({ kind: "span", team, player: who, id: best.oid, key: `absence|${team}|${id}`,
        text: `${who} since ${out0} last played (${md(list[list.length - n - 1]?.d || span[0].d)}), ${n} games: ${statLine(best.t)}${best.b ? ` (${r1(best.b.pts / best.b.g)} PPG before)` : ""}${lead ? `; ${team}'s leading scorer` : ""}, ${W}-${n - W} in that span`,
        score: 2.9 + Math.min(0.6, best.up / 15) });
    }
  }
  return out;
}

// 3. Over the team's current winning streak (5+): its best scorer in the span.
export function runLines({ pg, rows, names, minRun = 5 }) {
  const T = teamGames(rows);
  const out = [];
  for (const [team, list] of Object.entries(T)) {
    let n = 0;
    for (let i = list.length - 1; i >= 0 && list[i].win; i--) n++;
    if (n < minRun) continue;
    const ids = new Set(list.slice(-n).map((g) => g.id));
    let best = null;
    for (const [id, games] of Object.entries(pg)) {
      const sg = games.filter((g) => g.team === team && ids.has(g.gameId));
      if (sg.length < Math.max(3, n - 2)) continue;
      const t = sum(sg);
      if (!best || t.pts / t.g > best.t.pts / best.t.g) best = { id, t };
    }
    if (!best) continue;
    const who = names[best.id] || best.id;
    const start = list[list.length - n - 1];
    out.push({ kind: "span", team, player: who, id: best.id, key: `run|${team}`,
      text: `${who} over ${team}'s ${n}-game winning streak${start && !start.win && list.length - n <= 3 ? ` (after a ${list.length - n === 1 ? "0-1" : `0-${list.length - n}`} start)` : ""}: ${best.t.g} GP, ${statLine(best.t, { tsToo: true })}`,
      score: 2.8 + Math.min(0.8, (n - minRun) * 0.12) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Player streaks: what tonight would make of his run, against every run in the logs since 2016-17.
const FEATS = [
  ["pts50", "50+ points", (g) => g.pts >= 50], ["pts40", "40+ points", (g) => g.pts >= 40], ["pts35", "35+ points", (g) => g.pts >= 35], ["pts30", "30+ points", (g) => g.pts >= 30],
  ["reb20", "20+ rebounds", (g) => g.reb >= 20], ["reb15", "15+ rebounds", (g) => g.reb >= 15], ["ast15", "15+ assists", (g) => g.ast >= 15], ["ast12", "12+ assists", (g) => g.ast >= 12],
  ["fg3m7", "7+ threes", (g) => g.fg3m >= 7], ["fg3m5", "5+ threes", (g) => g.fg3m >= 5], ["blk5", "5+ blocks", (g) => g.blk >= 5], ["td", "a triple-double", td],
];
const RARE = 5;
function runsOf(games, test) {
  const out = [];
  let s = -1;
  games.forEach((g, i) => { if (test(g)) { if (s < 0) s = i; } else if (s >= 0) { out.push({ n: i - s, end: games[i - 1].d }); s = -1; } });
  if (s >= 0) out.push({ n: games.length - s, end: games[games.length - 1].d, current: true });
  return out;
}
// 4b. The same run against his franchise's past (0.106): every player's runs by franchise since 1993-94, from ESPN's box
// scores (src/data/player-feat-runs-2026-27.json.gz, tools/build-feat-runs.mjs), with this season's finished runs on top.
// The league-wide count above knows only players still active; this one knows everyone, but only since 1993-94, and says so.
// Said when at most `most` of the franchise's players have gone one game further. On its own (no league-wide line to ride
// on) a run of two is said only when at most `fewAt2` have: "would be the fourth to do it three straight" is not news.
export const FRANCHISE = { most: 4, fewAt2: 1 };
const ALSO = { OKC: "Seattle", MEM: "Vancouver", BKN: "New Jersey" };
const ORD = ["", "first", "second", "third", "fourth", "fifth"];
const RUN_IX = new WeakMap();
function runIndex(runs) {
  if (RUN_IX.has(runs)) return RUN_IX.get(runs);
  const ix = { sure: new Map(), maybe: new Map() };
  for (const [which, list] of [["sure", runs.runs], ["maybe", runs.maybe]]) for (const [team, feat, n, id, season] of list || []) {
    const k = `${team}|${feat}`;
    (ix[which].get(k) || ix[which].set(k, []).get(k)).push({ n, id: String(id), season });
  }
  RUN_IX.set(runs, ix);
  return ix;
}
/** The file as it stood before a season (for replaying a past morning). */
export function runsBefore(runs, season) {
  return runs && { ...runs, runs: runs.runs.filter((r) => r[4] < season), maybe: (runs.maybe || []).filter((r) => r[4] < season) };
}
function franchiseClause({ runs, pg, names, id, team, k, test, n, nick }) {
  if (!runs?.runs || !team || runs.blind?.[team]?.length) return null; // Chicago and New Orleans: six seasons ESPN has no player numbers for
  const ix = runIndex(runs), key = `${team}|${k}`;
  // this season's finished runs with this team, everyone's (his own earlier ones too)
  const now = [];
  for (const [pid, gs] of Object.entries(pg)) {
    const mine = gs.filter((g) => g.team === team);
    for (const r of runsOf(mine, test)) if (r.n >= 2 && !(pid === id && r.current)) now.push({ n: r.n, id: String(pid), season: "this season" });
  }
  const all = [...(ix.sure.get(key) || []), ...now];
  const best = (min) => { const m = new Map(); for (const x of all) if (x.n >= min && (!m.has(x.id) || m.get(x.id).n < x.n)) m.set(x.id, x); return [...m.values()].sort((a, b) => b.n - a.n); };
  const ahead = best(n + 1);
  if (ahead.some((x) => x.id === String(id)) || ahead.length > FRANCHISE.most) return null; // he has done it before, or it is not rare here
  // a night we could not read that might hide a longer run by someone not already counted: nothing is said
  if ((ix.maybe.get(key) || []).some((x) => x.n >= n + 1 && !ahead.some((y) => y.id === x.id))) return null;
  const nm = (x) => `${names[x.id] || runs.names?.[x.id] || "a player"} ${x.season === "this season" ? "this season" : short(x.season)}`;
  const scope = `${nick} player since 1993-94${ALSO[team] ? ` (${ALSO[team]} included)` : ""}`;
  if (!ahead.length) {
    const at = best(n).filter((x) => x.id !== String(id));
    // someone who may have had n straight on a night we could not read: the claim stands, the list of names is left off
    if ((ix.maybe.get(key) || []).some((x) => x.n >= n && !at.some((y) => y.id === x.id) && x.id !== String(id))) return { ahead: 0, text: `one more tonight would be the longest such run by a ${scope}` };
    return { ahead: 0, text: `one more tonight would be the longest such run by a ${scope}${at.length ? ` (${n} straight: ${at.slice(0, 4).map(nm).join(", ")}${at.length > 4 ? ` and ${at.length - 4} more` : ""})` : ` (no one else has had ${n} straight)`}` };
  }
  return { ahead: ahead.length, text: `one more tonight would make him the ${ORD[ahead.length + 1]} ${scope} to do it ${n + 1} straight (${ahead.map(nm).join(", ")})` };
}

export function streakLines({ pg, logs, names, runs = null, nicks = null }) {
  const L = logRows(logs);
  const out = [];
  // Every run in history (regular season, one season at a time), per feat, with whose it was.
  const hist = {};
  for (const [k, , test] of FEATS) {
    hist[k] = [];
    for (const [id, rows] of Object.entries(L)) {
      const by = {};
      for (const g of rows) if (g.type === 2) (by[seasonOfDate(g.d)] ??= []).push(g);
      for (const [s, gs] of Object.entries(by)) for (const r of runsOf(gs, test)) if (r.n >= 2) hist[k].push({ id, n: r.n, season: s });
    }
    // This season's finished runs too (a current run is the player's own and is left out below).
    for (const [id, gs] of Object.entries(pg)) for (const r of runsOf(gs, test)) if (r.n >= 2 && !r.current) hist[k].push({ id, n: r.n, season: "this season" });
  }
  for (const [id, games] of Object.entries(pg)) {
    const name = names[id];
    if (!name) continue;
    const team = games[games.length - 1].team;
    let best = null;
    for (const [k, label, test] of FEATS) {
      const r = runsOf(games, test).pop();
      if (!r || !r.current || r.n < 2) continue;
      const others = hist[k];
      const atN = others.filter((x) => x.n >= r.n), atNext = others.filter((x) => x.n >= r.n + 1);
      if (atNext.length > RARE) continue;
      const players = [...new Map(atNext.map((x) => [x.id, x])).values()];
      if (!best || atNext.length < best.atNext.length || (atNext.length === best.atNext.length && r.n > best.r.n)) best = { k, label, r, atN, atNext, players };
    }
    // The franchise's own history for the same run; on its own when the league-wide count has nothing rare to say.
    const nick = nicks?.[team] || team;
    const samTeam = (r) => games.slice(-r.n).every((g) => g.team === team);
    let fr = null;
    if (runs) {
      if (best && samTeam(best.r)) { const f = FEATS.find((x) => x[0] === best.k); fr = franchiseClause({ runs, pg, names, id, team, k: best.k, test: f[2], n: best.r.n, nick }); }
      if (!best) for (const [k, label, test] of FEATS) {
        const r = runsOf(games, test).pop();
        if (!r || !r.current || r.n < 2 || !samTeam(r)) continue;
        const c = franchiseClause({ runs, pg, names, id, team, k, test, n: r.n, nick });
        if (c && (r.n >= 3 || c.ahead <= FRANCHISE.fewAt2) && (!fr || c.ahead < fr.ahead || (c.ahead === fr.ahead && r.n > fr.r.n))) fr = { ...c, k, label, r };
      }
      if (!best && fr) {
        out.push({ kind: "pstreak", team, player: name, id, key: `pstreak|${id}|${fr.k}`, text: `${name} has ${fr.label.replace(/^a /, "")}${/^a /.test(fr.label) ? "s" : ""} in ${fr.r.n} straight games: ${fr.text}`,
          score: 3 + (fr.ahead ? 0.4 : 0.8) + Math.min(0.4, fr.r.n * 0.05), rare: true, franchise: true });
        continue;
      }
    }
    if (!best) continue;
    const { label, r, atNext, players, atN } = best;
    const nm = (x) => `${names[x.id] || x.id} ${x.season === "this season" ? "this season" : short(x.season)}`;
    const nobody = !atNext.length;
    const text = `${name} has ${label.replace(/^a /, "")}${/^a /.test(label) ? "s" : ""} in ${r.n} straight games: ${nobody
      ? `no current player has done it ${r.n + 1} straight since 2016-17${atN.length ? ` (${atN.length} did ${r.n}: ${[...new Map(atN.map((x) => [x.id, x])).values()].slice(0, 3).map(nm).join(", ")})` : ""}`
      : `one more tonight would put him with ${players.slice(0, 4).map(nm).join(", ")} as the only current players to do it ${r.n + 1} straight since 2016-17`}`;
    out.push({ kind: "pstreak", team, player: name, id, key: `pstreak|${id}|${best.k}`, text: fr ? `${text}. For the ${nick}: ${fr.text}` : text, ...(fr ? { franchise: true } : {}),
      score: 3 + (nobody ? 0.9 : 0.4) + Math.min(0.4, r.n * 0.05), rare: true });
  }
  return out;
}

// 5. Against tonight's opponent: a feat he does far more often against this team (career logs + this season).
const VS = [["td", "a triple-double", td], ["pts30", "30+ points", (g) => g.pts >= 30], ["dd", "a double-double", dd], ["pts40", "40+ points", (g) => g.pts >= 40]];
export function vsOppLines({ pg, logs, names, games: slate, lastN = 20 }) {
  const L = logRows(logs);
  const opp = new Map();
  for (const g of slate || []) { opp.set(g.away, g.home); opp.set(g.home, g.away); }
  const out = [];
  for (const [id, games] of Object.entries(pg)) {
    const name = names[id];
    const team = games[games.length - 1]?.team;
    const o = opp.get(team);
    if (!name || !o) continue;
    const all = [...(L[id] || []).filter((g) => g.type === 2), ...games.map((g) => ({ ...g, type: 2 }))].sort((a, b) => a.d.localeCompare(b.d));
    const vs = all.filter((g) => g.opp === o).slice(-lastN);
    if (vs.length < 6) continue;
    let best = null;
    for (const [k, label, test] of VS) {
      const hit = vs.filter(test).length, rate = hit / vs.length;
      const base = all.filter(test).length / all.length;
      if (hit < 4 || rate < 0.4 || rate - base < 0.2) continue;
      const w = rate - base + (k === "td" || k === "pts40" ? 0.15 : 0);
      if (!best || w > best.w) best = { k, label, hit, rate, base, w };
    }
    if (!best) continue;
    const t = sum(vs);
    out.push({ kind: "vsopp", team, opp: o, player: name, id, key: `vsopp|${id}|${o}|${best.k}`,
      text: `${name} has ${best.label} in ${best.hit} of his last ${vs.length} games vs. ${o} (${Math.round(best.base * 100)}% of all his games since 2016-17); ${r1(t.pts / t.g)} PPG, ${r1(t.reb / t.g)} RPG, ${r1(t.ast / t.g)} APG in those games`,
      score: 2.7 + Math.min(0.9, best.w * 1.5) });
  }
  return out;
}

// 6. Through N games: the most points (and threes) through his team's first N games of a season, since 2016-17.
export function paceLines({ pg, logs, names }) {
  const L = logRows(logs);
  const out = [];
  const K = [["pts", "points"], ["fg3m", "threes"], ["reb", "rebounds"], ["ast", "assists"]];
  // For every current player's past season: his running totals through 1, 2, 3… games.
  const seasonsOf = [];
  for (const [id, rows] of Object.entries(L)) {
    const by = {};
    for (const g of rows) if (g.type === 2) (by[seasonOfDate(g.d)] ??= []).push(g);
    for (const [s, gs] of Object.entries(by)) seasonsOf.push({ id, season: s, gs });
  }
  for (const [k, label] of K) {
    const cur = Object.entries(pg).map(([id, gs]) => ({ id, n: gs.length, v: gs.reduce((s, g) => s + g[k], 0) })).filter((x) => x.n >= 5 && names[x.id]);
    const byN = new Map();
    for (const n of new Set(cur.map((c) => c.n))) byN.set(n, seasonsOf.filter((x) => x.gs.length >= n).map((x) => ({ id: x.id, season: x.season, v: x.gs.slice(0, n).reduce((a, g) => a + g[k], 0) })).sort((a, b) => b.v - a.v));
    for (const c of cur) {
      const hist = byN.get(c.n);
      const better = hist.filter((h) => h.v >= c.v);
      const thisBetter = cur.filter((x) => x.n === c.n && x.v > c.v).length;
      if (better.length + thisBetter > 2 || c.v < (k === "pts" ? 150 : 25)) continue;
      const name = names[c.id];
      const rank = better.length + thisBetter + 1;
      const next = hist.find((h) => h.v < c.v);
      out.push({ kind: "pace", team: pg[c.id][pg[c.id].length - 1].team, player: name, id: c.id, key: `pace|${c.id}|${k}`,
        text: `${name}'s ${c.v} ${label} through ${c.n} games are ${rank === 1 ? "the most" : `the ${rank === 2 ? "2nd" : "3rd"}-most`} by any current player through ${c.n} games of a season since 2016-17${rank > 1 && better.length ? ` (${better.slice(0, 2).map((h) => `${names[h.id] || h.id} ${h.v}, ${short(h.season)}`).join("; ")})` : next ? ` (next: ${names[next.id] || next.id} ${next.v}, ${short(next.season)})` : ""}`,
        score: (rank === 1 ? 3.4 : 2.8) + (k === "pts" ? 0.3 : 0), rare: rank === 1 });
    }
  }
  return out;
}

// 7. His own best start (0.76; the Clippers' notes, 11/15: "His 114 points through first 10 games is the most through
// his first 10 games of any season (previous: 108 points in 2025-26)"). paceLines measures a start against the league;
// this measures it against the player's own seasons. The logs begin in 2016-17, so for a player who was already in
// the league then the line says "since 2016-17".
const OWN = { games: 8, past: 3, mpg: 20, perGame: { pts: 10, reb: 6, ast: 4, fg3m: 1.8 }, low: { past: 5, mpg: 24, bestPpg: 18 }, keep: 30 };
const OWN_STATS = [["pts", "points"], ["reb", "rebounds"], ["ast", "assists"], ["fg3m", "threes"]];
export function ownStartLines({ pg, logs, names, seasons = null, nameKey = (n) => n, keep = OWN.keep }) {
  const L = logRows(logs);
  const out = [];
  const si = seasons?.keys ? seasons.keys.indexOf("season") : -1;
  const firstByKey = si >= 0 ? new Map(Object.entries(seasons.players || {}).map(([nm, rows]) => [nameKey(nm), rows.map((r) => r[si]).sort()[0]])) : new Map();
  const firstSeason = (nm) => firstByKey.get(nameKey(nm)) || null;
  for (const [id, gs] of Object.entries(pg)) {
    const name = names[id], n = gs.length;
    if (!name || n < OWN.games || !L[id]) continue;
    const now = seasonOfDate(gs[n - 1].d);
    const by = {};
    for (const g of L[id]) if (g.type === 2 && seasonOfDate(g.d) < now) (by[seasonOfDate(g.d)] ??= []).push(g);
    const all = Object.entries(by).map(([season, rows]) => ({ season, rows: rows.sort((a, b) => (a.d < b.d ? -1 : 1)) }));
    const past = all.filter((x) => x.rows.length >= n);
    if (past.length < OWN.past) continue;
    const t = sum(gs);
    if (t.min / n < OWN.mpg) continue;
    // The logs start in 2016-17: a player whose career began before then (the NBA Guide's seasons say) gets "since 2016-17".
    const span = all.some((x) => x.season === "2016-17") && !(firstSeason(name) >= "2016-17") ? " since 2016-17" : "";
    const through = (rows, k) => rows.slice(0, n).reduce((a, g) => a + (g[k] || 0), 0);
    let best = null;
    for (const [k, label] of OWN_STATS) {
      const v = t[k];
      if (v / n < OWN.perGame[k]) continue;
      const prev = past.map((x) => ({ season: x.season, v: through(x.rows, k) })).sort((a, b) => b.v - a.v)[0];
      if (v <= prev.v) continue;
      const lift = (v - prev.v) / Math.max(1, prev.v);
      if (!best || (k === "pts" ? 1 : 0) + lift > best.rank) best = { rank: (k === "pts" ? 1 : 0) + lift, k, label, v, prev, lift };
    }
    if (best) {
      out.push({ kind: "pace", team: gs[n - 1].team, player: name, id, key: `own|${id}|${best.k}`,
        text: `${name}'s ${best.v} ${best.label} through ${n} games are his most through ${n} games of any season${span} (previous: ${best.prev.v}, ${short(best.prev.season)})`,
        score: 2.3 + Math.min(0.5, best.lift * 2) + (best.k === "pts" ? 0.2 : 0) });
      continue;
    }
    // The other end, for a scorer: his fewest points through this many games.
    const bestPpg = Math.max(...all.filter((x) => x.rows.length >= 20).map((x) => x.rows.reduce((a, g) => a + g.pts, 0) / x.rows.length), 0);
    if (past.length < OWN.low.past || t.min / n < OWN.low.mpg || bestPpg < OWN.low.bestPpg) continue;
    const low = past.map((x) => ({ season: x.season, v: through(x.rows, "pts") })).sort((a, b) => a.v - b.v)[0];
    if (t.pts >= low.v) continue;
    out.push({ kind: "pace", team: gs[n - 1].team, player: name, id, key: `own|${id}|ptsLow`,
      text: `${name}'s ${t.pts} points through ${n} games are his fewest through ${n} games of any season${span} (previous low: ${low.v}, ${short(low.season)})`,
      score: 2.3 + Math.min(0.5, ((low.v - t.pts) / Math.max(1, low.v)) * 2) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, keep);
}

// 8. Already at last season's count (0.76; the Clippers' notes: "Has recorded 20-point performances in four of 11
// games this season, after doing so three times during entire 25-26 campaign"). And one short of it, which is the
// line to have before the game: one more tonight matches all of last season.
const ALREADY = { games: 8, lastGames: 40, share: 0.5, keep: 30 };
const EVENTS = [
  // family, key, label (plural), test; the first of a family that qualifies is the one said
  ["pts", "pts40", "40-point games", (g) => g.pts >= 40], ["pts", "pts30", "30-point games", (g) => g.pts >= 30], ["pts", "pts20", "20-point games", (g) => g.pts >= 20],
  ["dbl", "td", "triple-doubles", td], ["dbl", "dd", "double-doubles", dd],
  ["fg3", "fg3m5", "games with 5+ threes", (g) => g.fg3m >= 5], ["ast", "ast10", "games with 10+ assists", (g) => g.ast >= 10],
];
export function alreadyLines({ pg, logs, names }) {
  const L = logRows(logs);
  const out = [];
  for (const [id, gs] of Object.entries(pg)) {
    const name = names[id], n = gs.length;
    if (!name || n < ALREADY.games || !L[id]) continue;
    const now = seasonOfDate(gs[n - 1].d);
    const lastTag = `${+now.slice(0, 4) - 1}-${String(+now.slice(0, 4) % 100).padStart(2, "0")}`;
    const last = L[id].filter((g) => g.type === 2 && seasonOfDate(g.d) === lastTag);
    if (last.length < ALREADY.lastGames || n > last.length * ALREADY.share) continue;
    const seen = new Set();
    let best = null;
    for (const [fam, key, label, test] of EVENTS) {
      if (seen.has(fam)) continue;
      const c = gs.filter(test).length, was = last.filter(test).length;
      const how = c > was && was >= 2 ? "more" : c === was && was >= 3 ? "same" : c === was - 1 && was >= 3 && c >= 2 ? "one" : null;
      if (!how) continue;
      seen.add(fam);
      const rank = { more: 3, one: 2, same: 1 }[how] + (fam === "pts" ? 0.5 : 0) + Math.min(0.4, was / 50);
      if (!best || rank > best.rank) best = { rank, how, key, label, c, was };
    }
    if (!best) continue;
    const tail = best.how === "more" ? `already more than in all of last season (${best.was} in ${last.length} games)`
      : best.how === "same" ? `already as many as in all of last season (${best.was} in ${last.length} games)`
      : `one more matches all of last season (${best.was} in ${last.length} games)`;
    out.push({ kind: "season", team: gs[n - 1].team, player: name, id, key: `already|${id}|${best.key}`,
      text: `${name} has ${best.c} ${best.label} in ${n} games this season: ${tail}`,
      score: 2.2 + best.rank * 0.15, ...(best.how === "one" ? { tonight: true } : {}) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, ALREADY.keep);
}

// ---------------------------------------------------------------------------------------------------------------
// 9. Hot and cold shooting over his last few games (0.78; the user, 11/16, on a post: "Joel Embiid … is just 1-for-25
//    from three over his last nine games": "even something like this … looks noteworthy, especially for the top
//    players"). Every player in the league, threes, field goals and free throws: the stretch of his latest games
//    (3 to 12) that is furthest from what he normally shoots, when it is far enough (SLUMP.z standard deviations of a
//    shooter at his own rate) and on enough attempts. His normal is his career rate in the logs before the stretch
//    (2016-17 on), or this season's before it for a player with little history.
export const SLUMP = { games: 6, minN: 3, maxN: 12, z: 2.8, also: 2.4, mpg: 18, keep: 40,
  shots: [["fg3", "fg3m", "fg3a", "from three", 15, 150], ["fg", "fgm", "fga", "from the field", 40, 400], ["ft", "ftm", "fta", "at the line", 15, 150]] };
export function slumpLines({ pg, logs, names }) {
  const L = logRows(logs);
  const prom = prominence(pg, names);
  const out = [];
  for (const [id, gs] of Object.entries(pg)) {
    const name = names[id], n = gs.length;
    if (!name || n < SLUMP.games) continue;
    const first = gs[0].d;
    const past = (L[id] || []).filter((g) => g.type === 2 && g.d < first);
    let best = null;
    const byType = {};
    for (const [key, mk, ak, where, minAtt, minBase] of SLUMP.shots) {
      for (let N = SLUMP.minN; N <= Math.min(SLUMP.maxN, n - 1); N++) {
        const win = gs.slice(-N), before = [...past, ...gs.slice(0, -N)];
        const m = win.reduce((x, g) => x + (g[mk] || 0), 0), a = win.reduce((x, g) => x + (g[ak] || 0), 0);
        if (a < minAtt || win.reduce((x, g) => x + (g.min || 0), 0) / N < SLUMP.mpg) continue;
        const bm = before.reduce((x, g) => x + (g[mk] || 0), 0), ba = before.reduce((x, g) => x + (g[ak] || 0), 0);
        if (ba < minBase) continue;
        const p0 = bm / ba, z = (m - a * p0) / Math.sqrt(a * p0 * (1 - p0));
        if (!(Math.abs(z) >= SLUMP.also)) continue;
        // The stretch starts with a game on the same side of his normal (it isn't padded with an ordinary one).
        const g0 = win[0], side = (g0[ak] ? g0[mk] / g0[ak] : p0) - p0;
        if (g0[ak] && Math.sign(side) !== Math.sign(z)) continue;
        const f = { key, where, N, m, a, p0, z, career: past.length >= 40, from: g0.d };
        if (!byType[key] || Math.abs(z) > Math.abs(byType[key].z)) byType[key] = f;
        if (Math.abs(z) >= SLUMP.z && (!best || Math.abs(z) > Math.abs(best.z))) best = f;
      }
    }
    if (!best) continue;
    const cold = best.z < 0, pr = prom[name] ?? 0;
    // A second kind of shot gone the same way ("…and is just 1-for-25 from three over his last nine games").
    const also = Object.values(byType).filter((f) => f.key !== best.key && Math.sign(f.z) === Math.sign(best.z)).sort((x, y) => Math.abs(y.z) - Math.abs(x.z))[0];
    out.push({ kind: "span", team: gs[n - 1].team, player: name, id, key: `slump|${id}|${best.key}|${cold ? "cold" : "hot"}`,
      text: `${name} is ${best.m}-for-${best.a} ${best.where} over his last ${best.N} games (${r1(pct(best.m, best.a))}%, since ${md(best.from)}); he ${best.career ? "had shot" : "was at"} ${r1(100 * best.p0)}% ${best.career ? `for his career before that${past[0].d < "2017-08-01" ? " (since 2016-17)" : ""}` : "this season before that"}${also ? `; also ${also.m}-for-${also.a} ${also.where} over his last ${also.N} (${r1(100 * also.p0)}% before)` : ""}`,
      score: Math.round((2.5 + Math.min(1, (Math.abs(best.z) - SLUMP.z) * 0.4) + 0.7 * pr) * 100) / 100, rare: Math.abs(best.z) >= 4 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, SLUMP.keep);
}

/** Everyone's prominence (0-1) from this season's minutes and points, for the briefing's ranking. */
export function prominence(pg, names) {
  const out = {};
  for (const [id, gs] of Object.entries(pg)) {
    const name = names[id];
    if (!name || !gs.length) continue;
    const t = sum(gs);
    out[name] = Math.round(Math.max(0, Math.min(1, 0.6 * Math.min(1, Math.max(0, (t.pts / t.g - 6) / 22)) + 0.4 * Math.min(1, Math.max(0, (t.min / t.g - 12) / 22)))) * 100) / 100;
  }
  return out;
}

/** All of it, for scripts/situations.js -> docs/data/prep.json. */
export function prepLines(args) {
  const parts = [["season", seasonLines], ["absence", absenceLines], ["run", runLines], ["streak", streakLines], ["vsopp", vsOppLines], ["pace", paceLines], ["own", ownStartLines], ["already", alreadyLines], ["slump", slumpLines]];
  const lines = [], errors = [];
  for (const [k, f] of parts) { try { lines.push(...f(args)); } catch (e) { errors.push(`${k}: ${e.message}`); } }
  return { lines, errors, stars: prominence(args.pg, args.names) };
}
export { surname };
