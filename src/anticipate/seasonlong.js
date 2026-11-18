/**
 * Season-long and morning-after lines (0.70), from the kinds of post the user sent (StatMuse, 11/15):
 *
 *   tradeLines     "Jared McCain's stats this season with Philly — 6.6 PPG… / OKC — 12.5 PPG…"; "Kuminga's win
 *                  percentage: 100.0% as a Hawk, 45.0% as a Warrior"; "20 PT games: 4 with OKC, 1 with Philly".
 *   roleLines      "Jared McCain as a starter: 22.2 PPG, 4.0 RPG, 4.2 APG, 3.3 3PM, 45/39/82%".
 *   mvpLines       "Left is Jokić in his last MVP season. Right is Jokić this season."
 *   lineupLines    "The Hornets are 14-1 with this starting lineup."
 *   turnLines      "OKC went 24-1 in their first 25 games. They are 6-5 since then."
 *   checkpointLines "ATL is 12-1 since the All-Star break (2/19); it was 26-30 before" (New Year's Day, the trade deadline, the break)
 *   sinceLines     "The Phoenix Suns have the best record in the NBA since Christmas."
 *   beatenLines    "Teams with multiple wins vs OKC: Spurs, Timberwolves. That's it."
 *   monthLines     "Hornets in January: 1st in offense, 6th in defense, 1st in net rating."
 *   oddScoringLines / teamNightLines (0.79)  the morning after: 36 points without a two-point attempt; a team's 17 missed free throws.
 *   uniqueLines    "Luka vs Pacers: 44/9/5/3/2/7: joins D-Lo as the only players…" (the morning after, from the logs).
 *
 * Inputs: this season's results rows (src/situations/results.js; team box totals hb/ab) and player games (playerGames),
 * plus the logs and the NBA Guide's seasons and awards. Counts from the logs are "since 2016-17" among current players.
 */
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const pctS = (m, a) => (a ? `${r1((100 * m) / a)}%` : "–");
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const short = (season) => `'${season.slice(2, 4)}-${season.slice(5, 7)}`;
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NICK = { ATL: "Hawk", BOS: "Celtic", BKN: "Net", CHA: "Hornet", CHI: "Bull", CLE: "Cavalier", DAL: "Maverick", DEN: "Nugget", DET: "Piston", GSW: "Warrior", HOU: "Rocket", IND: "Pacer", LAC: "Clipper", LAL: "Laker", MEM: "Grizzly", MIA: "Heat player", MIL: "Buck", MIN: "Timberwolf", NOP: "Pelican", NYK: "Knick", OKC: "Thunder player", ORL: "Magic player", PHI: "76er", PHX: "Sun", POR: "Trail Blazer", SAC: "King", SAS: "Spur", TOR: "Raptor", UTA: "Jazz player", WAS: "Wizard" };
const SUM = ["min", "pts", "reb", "ast", "stl", "blk", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "tov"];
const sum = (gs) => { const t = { g: gs.length, w: gs.filter((g) => g.win).length }; for (const k of SUM) t[k] = gs.reduce((s, g) => s + (g[k] || 0), 0); return t; };
const ts = (t) => (t.fga + 0.44 * t.fta ? (100 * t.pts) / (2 * (t.fga + 0.44 * t.fta)) : null);
const lastTeam = (gs) => gs[gs.length - 1]?.team;

// ---------------------------------------------------------------------------------------------------------------
// Players: a trade, starting vs off the bench, against his MVP season.
export function tradeLines({ pg, names }) {
  const out = [];
  for (const [id, gs] of Object.entries(pg)) {
    const teams = [...new Set(gs.map((g) => g.team))];
    if (teams.length < 2 || !names[id]) continue;
    const parts = teams.map((t) => ({ t, s: sum(gs.filter((g) => g.team === t)), p20: gs.filter((g) => g.team === t && g.pts >= 20).length }));
    const now = lastTeam(gs);
    if (parts.filter((p) => p.s.g >= 2).length < 2 || Math.max(...parts.map((p) => p.s.pts / Math.max(1, p.s.g))) < 8) continue;
    const line = (p) => `${p.t} (${p.s.g} GP, ${p.s.w}-${p.s.g - p.s.w}): ${r1(p.s.pts / p.s.g)} PPG, ${pctS(p.s.fgm, p.s.fga)} FG, ${p.s.fg3a >= 6 ? `${pctS(p.s.fg3m, p.s.fg3a)} 3P, ` : ""}${r1(p.s.min / p.s.g)} MPG${p.p20 ? `, ${p.p20} 20-point game${p.p20 === 1 ? "" : "s"}` : ""}`;
    const cur = parts.find((p) => p.t === now), prev = parts.filter((p) => p.t !== now);
    const winNow = cur.s.g ? cur.s.w / cur.s.g : 0, winBefore = prev.reduce((a, p) => a + p.s.w, 0) / Math.max(1, prev.reduce((a, p) => a + p.s.g, 0));
    const up = cur.s.pts / Math.max(1, cur.s.g) - prev.reduce((a, p) => a + p.s.pts, 0) / Math.max(1, prev.reduce((a, p) => a + p.s.g, 0));
    out.push({ kind: "trade", team: now, player: names[id], id, key: `trade|${id}`,
      text: `${names[id]} this season, ${[cur, ...prev].map(line).join(" · ")}${cur.s.g >= 3 && Math.abs(winNow - winBefore) >= 0.3 ? ` (win percentage ${r1(100 * winNow)}% as a ${NICK[now] || now}, ${r1(100 * winBefore)}% before)` : ""}`,
      score: 2.9 + Math.min(0.6, Math.abs(up) / 12) + (Math.abs(winNow - winBefore) >= 0.3 ? 0.3 : 0) });
  }
  return out;
}

export function roleLines({ pg, names }) {
  const out = [];
  for (const [id, gs] of Object.entries(pg)) {
    const st = gs.filter((g) => g.starter), bn = gs.filter((g) => !g.starter && g.min > 0);
    if (st.length < 5 || bn.length < 3 || !names[id]) continue;
    const a = sum(st), b = sum(bn);
    const diff = a.pts / a.g - b.pts / b.g;
    if (Math.abs(diff) < 6 || Math.max(a.pts / a.g, b.pts / b.g) < 12) continue;
    const pc = (m, n) => (n ? Math.round((100 * m) / n) : "–");
    out.push({ kind: "role", team: lastTeam(gs), player: names[id], id, key: `role|${id}`,
      text: `${names[id]} as a starter (${a.g} GP, ${a.w}-${a.g - a.w}): ${r1(a.pts / a.g)} PPG, ${r1(a.reb / a.g)} RPG, ${r1(a.ast / a.g)} APG, ${r1(a.fg3m / a.g)} 3PM, ${pc(a.fgm, a.fga)}/${pc(a.fg3m, a.fg3a)}/${pc(a.ftm, a.fta)}%; off the bench (${b.g} GP): ${r1(b.pts / b.g)} PPG`,
      score: 2.6 + Math.min(0.8, Math.abs(diff) / 15) + (gs[gs.length - 1].starter ? 0.2 : 0) });
  }
  return out;
}

export function mvpLines({ pg, names, seasons, awards, nameKey = (n) => n, season, minGames = 8 }) {
  const K = seasons?.keys || [];
  const ix = Object.fromEntries(K.map((k, i) => [k, i]));
  const byName = new Map(Object.entries(seasons?.players || {}).map(([n, rows]) => [nameKey(n), rows]));
  const mvps = new Map();
  for (const a of awards?.["NBA Most Valuable Player"] || []) if (a.season < season) mvps.set(nameKey(a.player), a.season); // the last one wins
  const out = [];
  for (const [id, gs] of Object.entries(pg)) {
    const name = names[id];
    const last = name && mvps.get(nameKey(name));
    if (!last || gs.length < minGames) continue;
    const row = (byName.get(nameKey(name)) || []).find((r) => r[ix.season] === last);
    if (!row) continue;
    const then = Object.fromEntries(["g", ...SUM].map((k) => [k, row[ix[k]] || 0]));
    const now = sum(gs);
    const M = [["PPG", (t) => t.pts / t.g], ["RPG", (t) => t.reb / t.g], ["APG", (t) => t.ast / t.g], ["TS%", ts]];
    const better = M.filter(([, f]) => f(now) > f(then));
    const close = Math.abs(now.pts / now.g - then.pts / then.g) <= 1.5 && better.length >= 1; // scoring like his MVP year
    if (better.length < 3 && !close) continue;
    out.push({ kind: "season", team: lastTeam(gs), player: name, id, key: `mvp|${id}`,
      text: `${name} this season vs. his last MVP season (${last}): ${M.map(([l, f]) => `${r1(f(now))} ${l} (${r1(f(then))})`).join(", ")}${better.length === 4 ? ": better in all four" : better.length === 3 ? ": better in three of the four" : ""}`,
      score: 2.8 + 0.2 * better.length, rare: better.length === 4 });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Teams.
function teamGames(rows) {
  const T = {};
  for (const g of [...rows].filter((g) => g.hs != null && g.as != null).sort((a, b) => a.d.localeCompare(b.d) || String(a.id).localeCompare(String(b.id)))) {
    (T[g.h] ??= []).push({ id: g.id, d: g.d, opp: g.a, home: true, win: g.hs > g.as, pf: g.hs, pa: g.as, box: g.hb, obox: g.ab });
    (T[g.a] ??= []).push({ id: g.id, d: g.d, opp: g.h, home: false, win: g.as > g.hs, pf: g.as, pa: g.hs, box: g.ab, obox: g.hb });
  }
  return T;
}
const rec = (gs) => `${gs.filter((g) => g.win).length}-${gs.filter((g) => !g.win).length}`;

export function lineupLines({ pg, rows, names, minGames = 6 }) {
  const T = teamGames(rows);
  const starters = {};
  for (const [id, gs] of Object.entries(pg)) for (const g of gs) if (g.starter) ((starters[g.team] ??= {})[g.gameId] ??= []).push(id);
  const out = [];
  for (const [team, games] of Object.entries(T)) {
    const by = {};
    for (const g of games) { const five = (starters[team]?.[g.id] || []).sort(); if (five.length === 5) (by[five.join(",")] ??= []).push(g); }
    const best = Object.entries(by).sort((a, b) => b[1].length - a[1].length)[0];
    if (!best || best[1].length < minGames) continue;
    const L = best[1], w = L.filter((g) => g.win).length, pct = w / L.length;
    const others = games.filter((g) => !L.includes(g));
    const po = others.length >= 3 ? others.filter((g) => g.win).length / others.length : null;
    const contrast = po == null ? 0 : Math.abs(pct - po);
    if (!((pct >= 0.85 && L.length >= 10) || ((pct >= 0.75 || pct <= 0.25) && contrast >= 0.3))) continue;
    const who = best[0].split(",").map((id) => names[id] || id);
    out.push({ kind: "lineup", team, key: `lineup|${team}|${best[0]}`,
      text: `${team} is ${w}-${L.length - w} with ${who.join(", ")} starting${others.length ? ` (${rec(others)} otherwise)` : ""}`,
      score: 2.8 + Math.abs(pct - 0.5) + Math.min(0.4, L.length / 40) + contrast / 2 });
  }
  return out;
}

// 0.107.1 (the user, 11/18, on ESPN's "Heat since Oct. 28" card: 0-4, then 8-2): "being able to pinpoint where teams changed
// their performance over a stretch of games… it doesn't have to be limited to 10-15 game samples". The turn is looked for
// from four games in (it had needed eight on each side), with a higher bar while a side is short, and the line now says
// what the team has been since the turn: its league ranks over those same dates, for every team's games in them.
export const TURN = { early: 4, late: 6, gap: 0.4, shortGap: 0.5, top: 5, most: 4, teams: 20, games: 3 };
const ordinal = (k) => `${k}${["th", "st", "nd", "rd"][k % 10 > 3 || [11, 12, 13].includes(k % 100) ? 0 : k % 10]}`;
/** Each team's numbers from a date on, and its rank among the teams with enough games: { TRI: { n, ortg: [value, rank], … } }. */
export function sinceRanks(T, from) {
  const poss = (b) => b[1] + 0.44 * b[5] - b[6] + b[11], sum = (gs, f) => gs.reduce((a, g) => a + f(g), 0);
  const R = [];
  for (const [t, all] of Object.entries(T)) {
    const gs = all.filter((g) => g.d >= from && g.box && g.obox);
    if (gs.length < TURN.games) continue;
    const P = sum(gs, (g) => (poss(g.box) + poss(g.obox)) / 2), pf = sum(gs, (g) => g.pf), pa = sum(gs, (g) => g.pa), B = (i) => sum(gs, (g) => g.box[i] || 0);
    R.push({ t, n: gs.length, ortg: (100 * pf) / P, drtg: (100 * pa) / P, net: (100 * (pf - pa)) / P, fg: (100 * B(0)) / B(1), astPct: (100 * B(8)) / B(0), astTo: B(8) / Math.max(1, B(11)) });
  }
  if (R.length < TURN.teams) return null;
  const out = {};
  for (const [k, asc] of [["net", false], ["ortg", false], ["drtg", true], ["fg", false], ["astPct", false], ["astTo", false]]) {
    const L = [...R].sort((x, y) => (asc ? x[k] - y[k] : y[k] - x[k]));
    L.forEach((x, i) => { (out[x.t] ??= { n: x.n, of: R.length })[k] = [x[k], i + 1]; });
  }
  return out;
}
/** The ranks worth saying: the league's top five after a change for the better, its bottom five after one for the worse. */
function rankWords(since, up) {
  const said = [];
  if (!since) return said;
  const W = { net: ["net rating", (v) => (v > 0 ? "+" : "") + v.toFixed(1)], ortg: ["offensive rating", (v) => v.toFixed(1)], drtg: ["defensive rating", (v) => v.toFixed(1)], fg: ["FG%", (v) => v.toFixed(1)], astPct: ["assist rate", (v) => `${Math.round(v)}% of its baskets`], astTo: ["assists per turnover", (v) => v.toFixed(1)] };
  for (const k of ["net", "ortg", "drtg", "fg", "astPct", "astTo"]) {
    const [v, r] = since[k]; if (up ? r > TURN.top : r <= since.of - TURN.top) continue;
    if (said.length < TURN.most) said.push(`${ordinal(r)} in ${W[k][0]} (${W[k][1](v)})`);
  }
  return said;
}
export function turnLines({ rows, minSide = 8 }) {
  const out = [], T = teamGames(rows);
  for (const [team, games] of Object.entries(T)) {
    let best = null;
    for (let k = Math.min(minSide, TURN.early); k <= games.length - Math.min(minSide, TURN.late); k++) {
      const a = games.slice(0, k), b = games.slice(k);
      const pa = a.filter((g) => g.win).length / a.length, pb = b.filter((g) => g.win).length / b.length;
      const need = a.length >= minSide && b.length >= minSide ? TURN.gap : TURN.shortGap;
      if (Math.abs(pa - pb) >= need && (!best || Math.abs(pa - pb) > best.gap)) best = { k, a, b, gap: Math.abs(pa - pb), up: pb > pa };
    }
    if (!best) continue;
    // what it has been since: ranks in the league's top five after a turn for the better, bottom five after one for the worse
    const since = sinceRanks(T, best.b[0].d)?.[team], said = rankWords(since, best.up);
    out.push({ kind: "turn", team, key: `turn|${team}`, from: best.b[0].d, ...(since ? { since: { from: best.b[0].d, ...since } } : {}),
      text: `${team} went ${rec(best.a)} in its first ${best.k} games; ${rec(best.b)} since (${md(best.b[0].d)} on)${said.length ? `. Since then: ${said.join(", ")}` : ""}`, score: 2.7 + best.gap + (said.length >= 3 ? 0.3 : 0) });
  }
  return out;
}

/** The first game day after the All-Star break: the longest stretch of February days without a game (from the results; null until it's played). */
function allStarBreak(rows) {
  const days = [...new Set(rows.map((g) => g.d))].filter((d) => d.slice(5, 7) === "02" || d.slice(5, 7) === "03").sort();
  let asb = null, gap = 2;
  for (let i = 1; i < days.length; i++) { const n = (Date.parse(days[i]) - Date.parse(days[i - 1])) / 864e5; if (n > gap) { gap = n; asb = days[i]; } }
  return asb;
}

// 0.107.5 (the user, 11/18: "sometimes teams completely change their outlook starting January 1, others are better after
// the trade deadline, others are better after the all-star break"). turnLines finds the date that splits a season best;
// this asks the same of the three dates people name, for every team: the record since against the record before, with
// the ranks since. One line a team (the date with the widest change). When a team's own turn falls within CHECK.days of
// the named date, seasonLongLines keeps this line and drops the turn line: they are the same change, and this one has a name.
// Trade deadlines (3 PM ET; that night's games count as after): 2026-27 from the league's key dates as reported by NBC
// Sports and Hoops Rumors (read 11/18/26); 2025-26 from nba.com/trade-deadline ("was Feb. 5, 2026, at 3 p.m. ET"), kept
// for replaying last season in the tests.
export const DEADLINE = { "2026-27": "2027-02-11", "2025-26": "2026-02-05" };
// The bar falls as the sample since the date grows: a swing of .450 in winning percentage with 6 to 9 games since, .380
// with 10 to 14, .300 from 15 on. Replayed on 2025-26 with one bar of .300, a week after the deadline it said things like
// "7-0 since (it was 34-16 before)": a good team's good week, not a change.
export const CHECK = { before: 10, since: 6, gap: 0.3, gapShort: 0.38, gapShortest: 0.45, days: 10 };
export function checkpointLines({ rows, today }) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7), season0 = m >= 8 ? y : y - 1;
  const dl = DEADLINE[`${season0}-${String(season0 + 1).slice(2)}`], asb = allStarBreak(rows);
  const anchors = [[`${season0 + 1}-01-01`, "New Year's Day"], ...(dl ? [[dl, "the trade deadline"]] : []), ...(asb ? [[asb, "the All-Star break"]] : [])].filter(([d]) => d < today);
  const T = teamGames(rows), out = [], wp = (gs) => gs.filter((g) => g.win).length / gs.length;
  for (const [team, games] of Object.entries(T)) {
    let best = null;
    for (const [d, label] of anchors) {
      const a = games.filter((g) => g.d < d), b = games.filter((g) => g.d >= d);
      if (a.length < CHECK.before || b.length < CHECK.since) continue;
      const gap = Math.abs(wp(a) - wp(b));
      const need = b.length >= 15 ? CHECK.gap : b.length >= 10 ? CHECK.gapShort : CHECK.gapShortest;
      if (gap >= need && (!best || gap > best.gap)) best = { d, label, a, b, gap, up: wp(b) > wp(a) };
    }
    if (!best) continue;
    const said = rankWords(sinceRanks(T, best.d)?.[team], best.up);
    out.push({ kind: "turn", team, key: `check|${team}`, from: best.d,
      text: `${team} is ${rec(best.b)} since ${best.label} (${md(best.d)}); it was ${rec(best.a)} before${said.length ? `. Since then: ${said.join(", ")}` : ""}`, score: 2.8 + best.gap + (said.length >= 3 ? 0.3 : 0) });
  }
  return out;
}

/** Best (and worst) record in the NBA since a date everyone knows (Christmas, New Year's, the 1st of the month…). */
export function sinceLines({ rows, today, minGames = 8 }) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  const season0 = m >= 8 ? y : y - 1;
  const asb = allStarBreak(rows);
  const anchors = [[`${season0}-12-25`, "Christmas"], [`${season0 + 1}-01-01`, "New Year's Day"], ...(asb ? [[asb, "the All-Star break"]] : [])].filter(([d]) => d < today);
  const T = teamGames(rows);
  const out = [];
  const leaders = new Set();
  for (const [d, label] of anchors.reverse()) { // the latest anchor first; an earlier one only for a team not already named
    const R = Object.entries(T).map(([t, gs]) => { const s = gs.filter((g) => g.d >= d); return { t, s, w: s.filter((g) => g.win).length }; }).filter((x) => x.s.length >= minGames);
    if (R.length < 20) continue;
    const pct = (x) => x.w / x.s.length;
    R.sort((a, b) => pct(b) - pct(a) || b.w - a.w);
    const top = R[0], bot = R[R.length - 1];
    if (pct(top) > pct(R[1]) && !leaders.has(`top|${top.t}`)) { leaders.add(`top|${top.t}`); out.push({ kind: "turn", team: top.t, key: `since|${d}|top`, text: `${top.t} has the best record in the NBA since ${label}: ${top.w}-${top.s.length - top.w}`, score: 3.1 }); }
    if (pct(bot) < pct(R[R.length - 2]) && !leaders.has(`bot|${bot.t}`)) { leaders.add(`bot|${bot.t}`); out.push({ kind: "turn", team: bot.t, key: `since|${d}|bot`, text: `${bot.t} has the worst record in the NBA since ${label}: ${bot.w}-${bot.s.length - bot.w}`, score: 2.6 }); }
  }
  return out;
}

/** The teams that have beaten the best teams, and what tonight would make of it. */
export function beatenLines({ rows, slate = [], minGames = 10 }) {
  const T = teamGames(rows);
  const opp = new Map();
  for (const g of slate) { opp.set(g.away, g.home); opp.set(g.home, g.away); }
  const out = [];
  for (const [team, gs] of Object.entries(T)) {
    if (gs.length < minGames || gs.filter((g) => g.win).length / gs.length < 0.7) continue;
    const beat = {};
    for (const g of gs) if (!g.win) beat[g.opp] = (beat[g.opp] || 0) + 1;
    const two = Object.entries(beat).filter(([, n]) => n >= 2).map(([t]) => t);
    const names = Object.keys(beat);
    const tonight = opp.get(team);
    const losses = gs.filter((g) => !g.win).length;
    let text;
    if (two.length && two.length <= 3 && losses >= 4) text = `Teams with multiple wins vs. ${team} this season: ${two.join(", ")}${two.length === 1 ? " (the only one)" : ""}`;
    else if (names.length >= 1 && names.length <= 4 && gs.length >= 20) text = `Only ${names.length} team${names.length === 1 ? " has" : "s have"} beaten ${team} this season: ${names.map((t) => `${t}${beat[t] > 1 ? ` (${beat[t]})` : ""}`).join(", ")}`;
    else continue;
    if (tonight && two.length && text.startsWith("Teams with")) { if (beat[tonight] === 1) text += `; ${tonight}, tonight's opponent, beat ${team} once already`; }
    else if (tonight) text += beat[tonight] ? `; ${tonight}, tonight's opponent, is one of them${beat[tonight] === 1 ? ` (a win would be its second)` : ""}` : `; ${tonight} would be the ${names.length + 1}${["th", "st", "nd", "rd"][(names.length + 1) % 10 > 3 || [11, 12, 13].includes(names.length + 1) ? 0 : (names.length + 1) % 10]} team to beat ${team}`;
    out.push({ kind: "beaten", team, key: `beaten|${team}`, text: `${text} (${rec(gs)})`, score: 2.9 + (tonight ? 0.4 : 0) + (losses <= 3 ? 0.3 : 0) });
  }
  return out;
}

/** This month's offensive, defensive and net ratings (points per 100 possessions, from the team box totals). */
export function monthLines({ rows, today, minGames = 5 }) {
  const ym = today.slice(0, 7);
  // In the first days of a month, last month (complete).
  const day = +today.slice(8, 10);
  const target = day <= 5 ? new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 2, 15)).toISOString().slice(0, 7) : ym;
  const T = teamGames(rows);
  const poss = (b) => (b ? b[1] + 0.44 * b[5] - b[6] + b[11] : null); // fga + 0.44 fta − oreb + tov
  const R = [];
  for (const [t, gs] of Object.entries(T)) {
    const s = gs.filter((g) => g.d.slice(0, 7) === target && g.box && g.obox);
    if (s.length < minGames) continue;
    const P = s.reduce((a, g) => a + (poss(g.box) + poss(g.obox)) / 2, 0);
    const ortg = (100 * s.reduce((a, g) => a + g.pf, 0)) / P, drtg = (100 * s.reduce((a, g) => a + g.pa, 0)) / P;
    R.push({ t, n: s.length, ortg, drtg, net: ortg - drtg });
  }
  if (R.length < 20) return [];
  const rank = (k, asc) => { const L = [...R].sort((a, b) => (asc ? a[k] - b[k] : b[k] - a[k])); return (t) => L.findIndex((x) => x.t === t) + 1; };
  const o = rank("ortg"), dd = rank("drtg", true), n = rank("net");
  const ord = (k) => `${k}${["th", "st", "nd", "rd"][k % 10 > 3 || [11, 12, 13].includes(k % 100) ? 0 : k % 10]}`;
  const month = MON[+target.slice(5, 7) - 1];
  const out = [];
  for (const x of R) {
    const ranks = [o(x.t), dd(x.t), n(x.t)];
    const firsts = ranks.filter((k) => k === 1).length, lasts = ranks.filter((k) => k === R.length).length;
    if (!firsts && !lasts) continue;
    out.push({ kind: "month", team: x.t, key: `month|${target}|${x.t}`,
      text: `${x.t} in ${month}${target === ym ? " so far" : ""} (${x.n} games): ${ord(ranks[0])} in offense (${r1(x.ortg)}), ${ord(ranks[1])} in defense (${r1(x.drtg)}), ${ord(ranks[2])} in net rating (${x.net >= 0 ? "+" : ""}${r1(x.net)})`,
      score: 2.6 + 0.3 * firsts + 0.15 * lasts });
  }
  return out;
}

/** The fewest bars (three or more, points always in) that no one else reached; else all of them, with who did. */
function sharpest(bars, others, mine) {
  const pts = bars.filter(([c]) => c === "pts"), rest = bars.filter(([c]) => c !== "pts");
  const subsets = [];
  const walk = (i, cur) => { if (i === rest.length) { if (cur.length + pts.length >= 3) subsets.push([...pts, ...cur]); return; } walk(i + 1, [...cur, rest[i]]); walk(i + 1, cur); };
  walk(0, []);
  subsets.sort((a, b) => a.length - b.length);
  const hit = (set) => others.filter((x) => set.every(([c, , b]) => x[c] >= b));
  for (const set of subsets) if (set.length < bars.length && !hit(set).length) return { set, who: [], own: mine ? mine.filter((x) => set.every(([c, , b]) => x[c] >= b)).length : 0 };
  return { set: bars, who: hit(bars), own: mine ? mine.filter((x) => bars.every(([c, , b]) => x[c] >= b)).length : 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// The morning after: last night's lines no current player had reached since 2016-17 (or only one or two).
const CATS = [["pts", "PTS", 30, 5], ["reb", "REB", 10, 5], ["ast", "AST", 5, 5], ["stl", "STL", 3, 1], ["blk", "BLK", 2, 1], ["fg3m", "3P", 5, 1]];
export function uniqueLines({ pg, logs, names, date = null, history = null }) {
  const days = Object.values(pg).flat().map((g) => g.d).sort();
  const d = date || days[days.length - 1];
  if (!d) return [];
  const C = logs?.columns || [];
  const ix = Object.fromEntries(C.map((c, i) => [c, i]));
  const all = [];
  for (const [id, rows] of Object.entries(logs?.players || {})) for (const r of rows) if (r[ix.type] === 2 && r[ix.date] < d) all.push({ id, d: r[ix.date], v: Object.fromEntries(CATS.map(([k]) => [k, r[ix[k]] || 0])) });
  for (const [id, gs] of Object.entries(pg)) for (const g of gs) if (g.d < d) all.push({ id, d: g.d, v: Object.fromEntries(CATS.map(([k]) => [k, g[k] || 0])) });
  const out = [];
  for (const [id, gs] of Object.entries(pg)) {
    const g = gs.find((x) => x.d === d);
    if (!g || !names[id]) continue;
    const bars = CATS.filter(([k, , min]) => g[k] >= min).map(([k, l, , step]) => [k, l, Math.floor(g[k] / step) * step]);
    if (bars.length < 4 || g.pts < 30) continue;
    const best = sharpest(bars, all.filter((x) => x.id !== id).map((x) => ({ id: x.id, ...x.v })), all.filter((x) => x.id === id).map((x) => x.v));
    const own = best.own;
    const who = [...new Set(best.who.map((x) => names[x.id] || x.id))];
    if (who.length > 2 || own > 1) continue;
    const line = CATS.map(([k, l]) => `${g[k]} ${l}`).join(", ");
    const what = best.set.map(([, l, b]) => `${b}+ ${l}`).join(", ");
    out.push({ kind: "unique", team: g.team, player: names[id], id, key: `unique|${id}|${d}`, date: d,
      text: `${names[id]} vs. ${g.opp} (${md(d)}): ${line}. ${who.length ? `Joins ${who.join(" and ")} as the only current players with ${what} in a game since 2016-17` : `No other current player has had ${what} in a game since 2016-17`}${own ? ` (his second)` : ""}`,
      score: 3.4 + (who.length ? 0 : 0.5) + 0.1 * (bars.length - 4), rare: true });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 0.79 (posts the user sent, 11/16), the morning after, the whole league:
//  - a scoring game of an unusual make-up ("Have you scored more than 35 points in a game without a 2PA?"): no
//    two-point attempt, no free throw attempt, or no miss; among the three highest such games by a current player
//    since 2016-17;
//  - a team's game that is the season's most for any team in a box-score total ("Raptors missed 17 free throws
//    tonight"): missed free throws, turnovers, threes, steals, blocks, offensive rebounds, assists, fouls.
const WITHOUT = [
  ["no2", "without a two-point attempt", (g) => g.fga > 0 && g.fga === g.fg3a, (g) => `${g.fg3m}-of-${g.fg3a} from three${g.fta ? `, ${g.ftm}-of-${g.fta} at the line` : ""}`, 20],
  ["noft", "without a free throw attempt", (g) => g.fta === 0 && g.fga > 0, (g) => `${g.fgm}-of-${g.fga} from the field, ${g.fg3m} threes`, 35],
  ["nomiss", "without a missed shot", (g) => g.fga >= 6 && g.fgm === g.fga && g.ftm === g.fta, (g) => `${g.fgm}-of-${g.fga} from the field${g.fta ? `, ${g.ftm}-of-${g.fta} at the line` : ""}`, 20],
];
export function oddScoringLines({ pg, logs, names, date = null }) {
  const days = Object.values(pg).flat().map((g) => g.d).sort();
  const d = date || days[days.length - 1];
  if (!d) return [];
  const C = logs?.columns || [], ix = Object.fromEntries(C.map((c, i) => [c, i]));
  const K = ["pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta"];
  const all = [];
  for (const [id, rows] of Object.entries(logs?.players || {})) for (const r of rows) if (r[ix.type] === 2 && r[ix.date] < d) all.push({ id, d: r[ix.date], ...Object.fromEntries(K.map((k) => [k, r[ix[k]] || 0])) });
  for (const [id, gs] of Object.entries(pg)) for (const g of gs) if (g.d < d) all.push({ id, d: g.d, ...Object.fromEntries(K.map((k) => [k, g[k] || 0])) });
  const out = [];
  for (const [id, gs] of Object.entries(pg)) {
    const g = gs.find((x) => x.d === d);
    if (!g || !names[id]) continue;
    for (const [key, say, test, how, min] of WITHOUT) {
      if (g.pts < min || !test(g)) continue;
      const pool = all.filter(test).sort((x, y) => y.pts - x.pts);
      const better = pool.filter((x) => x.pts > g.pts), top = pool[0];
      if (better.length > 2) continue;
      const nm = (x) => `${names[x.id] || "a current player"} ${x.pts}, ${md(x.d)}/${x.d.slice(2, 4)}`;
      out.push({ kind: "unique", team: g.team, player: names[id], id, key: `odd|${key}|${id}|${d}`, date: d, rare: true, score: 3.5 + (better.length ? 0 : 0.5),
        text: `${names[id]} scored ${g.pts} ${say} vs. ${g.opp} (${md(d)}; ${how(g)}): ${!better.length ? `the most by a current player in such a game since 2016-17${top ? ` (was ${nm(top)})` : ""}` : `only ${better.slice(0, 2).map(nm).join(" and ")} had more in such a game among current players since 2016-17`}` });
      break;
    }
  }
  return out;
}

const TEAM_NIGHT = [["ftmiss", "missed", "free throws", (b) => b.fta - b.ftm, (b) => `${b.ftm}-of-${b.fta}`], ["tov", "committed", "turnovers", (b) => b.tov], ["fg3m", "made", "threes", (b) => b.fg3m, (b) => `${b.fg3m}-of-${b.fg3a}`],
  ["fg3miss", "missed", "threes", (b) => b.fg3a - b.fg3m, (b) => `${b.fg3m}-of-${b.fg3a}`], ["stl", "had", "steals", (b) => b.stl], ["blk", "blocked", "shots", (b) => b.blk], ["oreb", "grabbed", "offensive rebounds", (b) => b.oreb],
  ["ast", "had", "assists", (b) => b.ast], ["pf", "committed", "fouls", (b) => b.pf]];
export function teamNightLines({ rows, date = null, boxKeys = ["fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf"], minGames = 60 }) {
  const withBox = (rows || []).filter((g) => Array.isArray(g.hb) && Array.isArray(g.ab));
  const d = date || withBox.map((g) => g.d).sort().pop();
  if (!d) return [];
  const box = (arr) => Object.fromEntries(boxKeys.map((k, i) => [k, arr[i] || 0]));
  const sides = (g) => [{ team: g.h, opp: g.a, d: g.d, b: box(g.hb), ot: (g.hq || []).length > 4 }, { team: g.a, opp: g.h, d: g.d, b: box(g.ab), ot: (g.aq || []).length > 4 }];
  const before = withBox.filter((g) => g.d < d).flatMap(sides), night = withBox.filter((g) => g.d === d).flatMap(sides);
  if (before.length < minGames) return [];
  const out = [];
  for (const t of night) for (const [key, verb, noun, val, how] of TEAM_NIGHT) {
    const v = val(t.b), prev = before.map((x) => ({ ...x, v: val(x.b) })).sort((x, y) => y.v - x.v)[0];
    if (!(v >= prev.v) || night.some((o) => o !== t && val(o.b) > v)) continue;
    if (v === prev.v && before.filter((x) => val(x.b) === v).length > 2) continue;   // a mark many games share is no mark
    out.push({ kind: "unique", team: t.team, key: `teamnight|${key}|${t.team}|${d}`, date: d, rare: v > prev.v, score: 3.3 + (v > prev.v ? 0.3 : 0) + (key === "ftmiss" || key === "tov" ? 0.1 : 0),
      text: `${t.team} ${verb} ${v} ${noun} vs. ${t.opp} (${md(d)}${how ? `; ${how(t.b)}` : ""}${t.ot ? "; overtime" : ""}): ${v > prev.v ? "the most" : "tied for the most"} by any team in a game this season (${v > prev.v ? "was" : "with"} ${prev.team} ${prev.v}, ${md(prev.d)})` });
  }
  return out;
}

/** Rookies by points: the club at the highest round number two to six of them have reached, and who is closest. */
export function rookieLines({ pg, logs, seasons, names, nameKey = (n) => n }) {
  const veteran = new Set(Object.keys(logs?.players || {}).filter((id) => (logs.players[id] || []).length));
  const careers = new Set(Object.keys(seasons?.players || {}).map(nameKey));
  const R = Object.entries(pg).filter(([id]) => names[id] && !veteran.has(id) && !careers.has(nameKey(names[id])))
    .map(([id, gs]) => ({ id, name: names[id], team: lastTeam(gs), pts: gs.reduce((a, g) => a + g.pts, 0), g: gs.length })).sort((a, b) => b.pts - a.pts);
  if (R.length < 10) return [];
  let T = 0;
  for (let t = 100; t <= 3000; t += 100) { const n = R.filter((r) => r.pts >= t).length; if (n >= 2 && n <= 6) T = t; if (n < 2) break; }
  if (!T) return [];
  const club = R.filter((r) => r.pts >= T);
  const text = `Rookies with ${T}+ points this season: ${club.map((r) => `${r.name} (${r.pts})`).join(", ")}`;
  const out = [{ kind: "rookie", team: club[0].team, player: club[0].name, id: club[0].id, key: `rookie|${T}`, text, score: 2.6 }];
  // Who is about to join a club (any round number with ten or fewer rookies in it), one line per rookie.
  const named = new Set();
  for (let t = T; t >= 100; t -= 100) {
    const c = R.filter((r) => r.pts >= t);
    if (c.length > 10) break;
    for (const r of R) if (r.pts < t && t - r.pts <= 30 && !named.has(r.id)) {
      named.add(r.id);
      out.push({ kind: "rookie", team: r.team, player: r.name, id: r.id, key: `rookie|${t}|${r.id}`, text: `${r.name} is ${t - r.pts} points from joining the ${c.length} rookies with ${t}+ this season (${c.map((x) => x.name).join(", ")})`, score: 2.9 + (c.length <= 5 ? 0.2 : 0) });
    }
  }
  return out;
}

/** A month's totals no current player had reached in a month since 2016-17 ("500 points, 35 steals and 50 threes in a month"). */
const MCATS = [["pts", "points", 300, 50], ["reb", "rebounds", 100, 25], ["ast", "assists", 100, 25], ["stl", "steals", 20, 5], ["blk", "blocks", 20, 5], ["fg3m", "threes", 30, 10]];
export function monthPlayerLines({ pg, logs, names, today }) {
  const ym = today.slice(0, 7);
  const day = +today.slice(8, 10);
  const target = day <= 3 ? new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 2, 15)).toISOString().slice(0, 7) : ym;
  const C = logs?.columns || [];
  const ix = Object.fromEntries(C.map((c, i) => [c, i]));
  const M = new Map();
  for (const [id, rows] of Object.entries(logs?.players || {})) for (const r of rows) {
    if (r[ix.type] !== 2) continue;
    const k = `${id}|${r[ix.date].slice(0, 7)}`;
    const t = M.get(k) || M.set(k, { id, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fg3m: 0 }).get(k);
    for (const [c] of MCATS) t[c] += r[ix[c]] || 0;
  }
  for (const [id, gs] of Object.entries(pg)) for (const g of gs) {
    if (g.d.slice(0, 7) >= target) continue;
    const k = `${id}|${g.d.slice(0, 7)}`;
    const t = M.get(k) || M.set(k, { id, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fg3m: 0 }).get(k);
    for (const [c] of MCATS) t[c] += g[c] || 0;
  }
  const prior = [...M.values()];
  const month = MON[+target.slice(5, 7) - 1];
  const out = [];
  for (const [id, gs] of Object.entries(pg)) {
    const s = gs.filter((g) => g.d.slice(0, 7) === target);
    if (!s.length || !names[id]) continue;
    const t = Object.fromEntries(MCATS.map(([c]) => [c, s.reduce((a, g) => a + (g[c] || 0), 0)]));
    const bars = MCATS.filter(([c, , min]) => t[c] >= min).map(([c, l, , step]) => [c, l, Math.floor(t[c] / step) * step]);
    if (bars.length < 3 || !bars.some(([c]) => c === "pts")) continue;
    const best = sharpest(bars, prior.filter((x) => x.id !== id), null);
    const who = [...new Set(best.who.map((x) => names[x.id] || x.id))];
    if (who.length > 2) continue;
    const what = best.set.map(([, l, b]) => `${b} ${l}`).join(", ").replace(/, ([^,]+)$/, " and $1");
    out.push({ kind: "monthp", team: lastTeam(gs), player: names[id], id, key: `monthp|${id}|${target}|${best.set.map((b) => b[2]).join("-")}`,
      text: `${names[id]} in ${month}${target === ym ? " so far" : ""} (${s.length} games): ${MCATS.filter(([c]) => t[c] >= 10).map(([c, l]) => `${t[c]} ${l}`).join(", ")}. ${who.length ? `Joins ${who.join(" and ")} as the only current players with ${what} in a month since 2016-17` : `No other current player has had ${what} in a month since 2016-17`}`,
      score: 3.0 + (who.length ? 0 : 0.4), rare: !who.length });
  }
  return out;
}

/**
 * 30- and 40-point games allowed (0.71; the user, 11/15: "celtics not allowing any player to score 30 points in a game
 * is definitely notable and something I would want to know the day of"). counts: { tri: { gp, t30, t40 } } and the
 * league's totals; a line when a team on tonight's slate is the only one (or one of the few) that hasn't allowed one,
 * with tonight's opponent's 30-point scorers.
 */
export function allowedCounts({ pg, rows }) {
  const T = {};
  for (const g of rows || []) { if (g.hs == null) continue; for (const t of [g.h, g.a]) (T[t] ??= { gp: 0, t30: 0, t40: 0, by30: [] }).gp++; }
  let n30 = 0, n40 = 0;
  for (const gs of Object.values(pg || {})) for (const g of gs) {
    if (g.pts < 30 || !T[g.opp]) continue;
    T[g.opp].t30++; n30++;
    if (g.pts >= 40) { T[g.opp].t40++; n40++; }
  }
  return { teams: T, n30, n40 };
}
export function defenseLines({ pg, rows, names, slate = [] }) {
  const C = allowedCounts({ pg, rows });
  const tris = Object.keys(C.teams);
  if (tris.length < 20) return [];
  const opp = new Map();
  for (const g of slate) { opp.set(g.away, g.home); opp.set(g.home, g.away); }
  const out = [];
  for (const [bar, key, n] of [[30, "t30", C.n30], [40, "t40", C.n40]]) {
    const zero = tris.filter((t) => C.teams[t][key] === 0);
    if (!zero.length || zero.length > (bar === 30 ? 3 : 2)) continue;
    for (const t of zero) {
      const o = opp.get(t);
      if (!o) continue;
      // Tonight's opponent's players who have scored that many this season.
      const threats = Object.entries(pg).filter(([, gs]) => gs.length && gs[gs.length - 1].team === o).map(([id, gs]) => ({ name: names[id] || id, n: gs.filter((g) => g.pts >= bar).length, hi: Math.max(...gs.map((g) => g.pts)) }))
        .filter((x) => x.n).sort((a, b) => b.n - a.n || b.hi - a.hi).slice(0, 3);
      const others = zero.filter((x) => x !== t);
      out.push({ kind: "defense", team: t, key: `defense|${t}|${bar}`,
        text: `${t} hasn't allowed a ${bar}-point game this season (${C.teams[t].gp} games): ${others.length ? `one of ${zero.length} teams (with ${others.join(", ")})` : "the only team"}; ${n} across the league${threats.length ? `. ${o}'s ${bar}-point scorers: ${threats.map((x) => `${x.name} (${x.n}, high ${x.hi})`).join(", ")}` : ""}`,
        score: 3.6 + (others.length ? 0 : 0.9) + (bar === 40 ? -0.3 : 0), rare: !others.length });
    }
  }
  // 0.78: the same scorer against the same defense, again tonight. Anyone with two or more 30-point games against
  // tonight's opponent this season ("if a player has scored 30 or more points more than once against the same team,
  // please note how many times"; the user, 11/16). Kind vsopp.
  for (const [id, gs] of Object.entries(pg)) {
    if (!gs.length) continue;
    const team = gs[gs.length - 1].team, o = opp.get(team);
    if (!o) continue;
    const vs = gs.filter((g) => g.opp === o), big = vs.filter((g) => g.pts >= 30);
    if (big.length < 2) continue;
    const name = names[id] || id;
    out.push({ kind: "vsopp", team, opp: o, player: name, id, key: `rep30|${id}|${o}`,
      text: `${name} has scored 30+ against ${o} ${big.length === vs.length ? (big.length === 2 ? "both times" : `all ${big.length} times`) : `in ${big.length} of ${vs.length} games`} this season (${big.map((g) => `${g.pts} on ${+g.d.slice(5, 7)}/${+g.d.slice(8, 10)}`).join(", ")}); they meet again tonight`,
      score: 3.3 + 0.3 * (big.length - 2) + (big.length === vs.length ? 0.2 : 0), rare: big.length >= 3 });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 0.72.5: totals over an era, among current players (the logs start in 2016-17). The decade counts the playoffs, as the
// post did; "since he entered the NBA" is regular season only, as that post was (Brook Lopez 342).
//   "Most blocks since Victor Wembanyama entered the NBA: Wemby 449 … Brook Lopez 342, Walker Kessler 301."
//   "Jokić now leads this decade in total points, total rebounds, total assists, and total steals!" (and, before it:
//   "Jokić is 26 points from passing Jayson Tatum for the most points this decade").
const ECATS = [["pts", "points", 2000], ["reb", "rebounds", 600], ["ast", "assists", 400], ["stl", "steals", 100], ["blk", "blocks", 100], ["fg3m", "3-pointers", 200]];
const DECADE = "2020-01-01";
const num = (n) => Number(n).toLocaleString("en-US");
export function eraLines({ pg, logs, names, today }) {
  const C = logs?.columns || [];
  const ix = Object.fromEntries(C.map((c, i) => [c, i]));
  if (ix.date == null) return [];
  // Every current player's games, oldest first: [date, { cat: value }].
  const G = new Map();
  const put = (id, d, row, reg) => { if (!G.has(id)) G.set(id, []); G.get(id).push([d, row, reg]); };
  for (const [id, rows] of Object.entries(logs.players || {})) for (const r of rows) { if (today && r[ix.date] >= today) continue; put(id, r[ix.date], Object.fromEntries(ECATS.map(([c]) => [c, r[ix[c]] || 0])), r[ix.type] === 2); }
  for (const [id, gs] of Object.entries(pg)) for (const g of gs) put(id, g.d, Object.fromEntries(ECATS.map(([c]) => [c, g[c] || 0])), true);
  const since = (start, regOnly = false) => { const T = new Map(); for (const [id, gs] of G) { const t = { g: 0 }; for (const [c] of ECATS) t[c] = 0; for (const [d, r, reg] of gs) if (d >= start && (reg || !regOnly)) { t.g++; for (const [c] of ECATS) t[c] += r[c]; } if (t.g) T.set(id, t); } return T; };
  const board = (T, c) => [...T.entries()].map(([id, t]) => ({ id, v: t[c] })).sort((a, b) => b.v - a.v);
  const nm = (id) => names[id] || id;
  const perGame = (id, c) => { const gs = pg[id] || []; return gs.length ? gs.reduce((a, g) => a + (g[c] || 0), 0) / gs.length : 0; };
  const out = [];

  // 1. The decade: who leads what, and a lead about to change hands.
  const D = since(DECADE);
  const boards = Object.fromEntries(ECATS.map(([c]) => [c, board(D, c)]));
  const leads = {};
  for (const [c, , min] of ECATS) { const top = boards[c][0]; if (top && top.v >= min) (leads[top.id] ??= []).push(c); }
  for (const [id, cats] of Object.entries(leads)) {
    if (cats.length < 3 || !pg[id]?.length) continue;
    const say = cats.map((c) => `${ECATS.find((x) => x[0] === c)[1]} (${num(boards[c][0].v)})`).join(", ").replace(/, ([^,]+)$/, " and $1");
    out.push({ kind: "era", team: lastTeam(pg[id]), player: nm(id), id, key: `era|decade|${id}|${cats.join("-")}`,
      text: `${nm(id)} leads the decade (since 1/1/2020, playoffs included) in ${say}: ${cats.length} of the six main totals, among current players`,
      score: 3.2 + 0.3 * cats.length, rare: cats.length >= 4, standing: true }); // standing: nothing about it can change tonight (0.78: not an NBA Live card)
  }
  for (const [c, label, min] of ECATS) {
    const [first, second] = boards[c];
    if (!first || !second || first.v < min || !pg[second.id]?.length) continue;
    const gap = first.v - second.v + 1, rate = perGame(second.id, c);
    if (gap <= 0 || !(rate > 0) || gap > 2 * rate) continue;              // within about two of his games
    out.push({ kind: "era", team: lastTeam(pg[second.id]), player: nm(second.id), id: second.id, key: `era|decade-pass|${second.id}|${c}`,
      text: `${nm(second.id)} is ${num(gap)} ${gap === 1 ? label.replace(/s$/, "") : label} from passing ${nm(first.id)} for the most ${label} this decade (${num(second.v)} to ${num(first.v)}; since 1/1/2020, playoffs included, current players)`,
      score: 3.9, rare: true });
  }

  // 2. Since he entered the NBA: a player whose whole career is in the logs, first by a distance in something.
  for (const [id, gs] of G) {
    const season = pg[id] || [];
    const debut = gs[0][0];
    if (debut < "2017-10-01" || gs.length < 82 || season.length < 3 || perGame(id, "pts") < 12) continue;
    const T = since(debut, true);
    let best = null;
    for (const [c, label, min] of ECATS) {
      const b = board(T, c);
      if (b[0]?.id !== id || b[0].v < min || !b[1]) continue;
      const margin = (b[0].v - b[1].v) / b[0].v;
      if (margin >= 0.15 && (!best || margin > best.margin)) best = { c, label, b, margin };
    }
    if (!best) continue;
    const [a, b2, c3] = best.b;
    out.push({ kind: "era", team: lastTeam(season), player: nm(id), id, key: `era|debut|${id}|${best.c}`,
      text: `Most ${best.label} since ${nm(id)} entered the NBA (${md(debut)}/${debut.slice(2, 4)}): ${nm(id)} ${num(a.v)}, ${nm(b2.id)} ${num(b2.v)}${c3 ? `, ${nm(c3.id)} ${num(c3.v)}` : ""} (regular season, current players)`,
      score: 3.0 + Math.min(1, best.margin * 2), rare: best.margin >= 0.25, standing: true });
  }
  return out;
}

export function seasonLongLines(args) {
  const parts = [["trade", tradeLines], ["role", roleLines], ["mvp", mvpLines], ["lineup", lineupLines], ["turn", turnLines], ["check", checkpointLines], ["since", sinceLines], ["beaten", beatenLines], ["month", monthLines], ["unique", uniqueLines], ["odd", oddScoringLines], ["teamnight", teamNightLines], ["rookie", rookieLines], ["monthp", monthPlayerLines], ["defense", defenseLines], ["era", eraLines]];
  const lines = [], errors = [];
  for (const [k, f] of parts) { try { lines.push(...f(args)); } catch (e) { errors.push(`${k}: ${e.message}`); } }
  // a team's own turn and a named date within a few days of it are one change: keep the named one
  const named = new Map(lines.filter((l) => l.key?.startsWith("check|")).map((l) => [l.team, l.from]));
  const same = (l) => l.key?.startsWith("turn|") && named.has(l.team) && l.from && Math.abs(Date.parse(l.from) - Date.parse(named.get(l.team))) <= CHECK.days * 864e5;
  return { lines: lines.filter((l) => !same(l)), errors };
}
