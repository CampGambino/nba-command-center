/**
 * Tonight's matchups: what's active or lopsided between the two teams, and for each regular against tonight's opponent (0.48).
 *
 *   matchups({ history, logs, teamFiles, tonight, today }) -> [{ id, away, home, items: [{ kind, team, player, text, tag, score, … }] }]
 *
 * history   src/data/nba-results-history.json (every game 2016-17 to 2025-26, regular season and playoffs)
 * logs      src/data/player-logs-history.json.gz, unzipped ({ players: { espnId: [[date, opp, home, W|L, type, min, pts, reb, ast, stl, blk, fg3m, …]] } })
 * teamFiles this season's box scores (docs/data/teams/*.json), which carry everything since the last back-fill.
 *
 * Team items (regular season): a run of 3+ straight wins in the series, 8+ of the last 10 (stretched back while it stays 80%+), 4+ straight at tonight's arena,
 * 3+ straight season series, and this season's series so far. Player items (players averaging 18+ minutes this season):
 * his average against tonight's opponent when it is his best or worst against any team (4+ games, and far from his
 * average), his team's record in those games when lopsided, and a streak still going against this opponent.
 *
 * Everything says its window: "since 2016-17" (the first season on file), or "in his career" when his first game is in it.
 */
import { TEAMS } from "../teams.js";

const FIRST = "2016-17";
const START = "2016-10-01";
// The season a date belongs to; the 2020 bubble (July to October 2020) finished 2019-20.
const seasonOf = (d) => { const y = Number(d.slice(0, 4)) + (Number(d.slice(5, 7)) >= 8 && !(d >= "2020-07-01" && d <= "2020-10-31") ? 1 : 0); return `${y - 1}-${String(y).slice(2)}`; };
const nick = (t) => TEAMS[t]?.nick || t;
const city = (t) => TEAMS[t]?.city || t;
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const avg = (rows, i) => rows.reduce((a, r) => a + (r[i] || 0), 0) / rows.length;
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const C = { date: 0, opp: 1, home: 2, res: 3, type: 4, min: 5, pts: 6, reb: 7, ast: 8, stl: 9, blk: 10, fg3m: 11 };
const STAT = { pts: ["points", 5], reb: ["rebounds", 3], ast: ["assists", 3] };

/** Every game between two teams, oldest first: { d, home, away, hs, as, type, winner }. */
export function meetings(history, teamFiles, a, b) {
  const out = new Map();
  for (const [d, h, aw, hs, as, type] of history?.games || []) {
    if ((h === a && aw === b) || (h === b && aw === a)) out.set(`${d}|${h}|${aw}`, { d, home: h, away: aw, hs, as, type, winner: hs > as ? h : aw });
  }
  for (const t of [a, b]) {
    for (const g of teamFiles?.[t]?.games || []) {
      if (g.opp !== (t === a ? b : a) || g.pf == null || g.pa == null) continue;
      const home = g.home ? t : g.opp, away = g.home ? g.opp : t;
      const hs = g.home ? g.pf : g.pa, as = g.home ? g.pa : g.pf;
      out.set(`${g.d}|${home}|${away}`, { d: g.d, home, away, hs, as, type: 2, winner: hs > as ? home : away });
    }
  }
  return [...out.values()].sort((x, y) => (x.d < y.d ? -1 : 1));
}

/** The run at the end of a list: [winner, length]. */
function tailRun(list, key) {
  if (!list.length) return [null, 0];
  const w = key(list[list.length - 1]);
  let n = 0;
  for (let i = list.length - 1; i >= 0 && key(list[i]) === w; i--) n++;
  return [w, n];
}

export function teamItems(history, teamFiles, away, home, today) {
  const all = meetings(history, teamFiles, away, home).filter((m) => m.d < today);
  const reg = all.filter((m) => m.type === 2);
  const items = [];
  if (!reg.length) return items;
  const since = reg[0].d.slice(0, 10) < "2016-11-15" ? ` since ${FIRST}` : "";
  // A run of straight wins in the series.
  const [w, n] = tailRun(reg, (m) => m.winner);
  if (n >= 3) {
    const l = w === away ? home : away;
    const every = n === reg.length ? `, every meeting${since}` : "";
    items.push({ kind: "matchup", team: w, text: `The ${nick(w)} have won ${n} straight against the ${nick(l)}${every} (last: ${reg[reg.length - 1].hs > reg[reg.length - 1].as ? `${reg[reg.length - 1].hs}-${reg[reg.length - 1].as}` : `${reg[reg.length - 1].as}-${reg[reg.length - 1].hs}`} on ${md(reg[reg.length - 1].d)}${seasonOf(reg[reg.length - 1].d) !== seasonOf(today) ? `/${reg[reg.length - 1].d.slice(2, 4)}` : ""}).`, tag: `Series streak · ${n}`, score: 1.5 + 0.3 * Math.min(n, 20), active: true });
  }
  // The recent meetings, when one-sided: at least the last 10, and further back for as long as it stays
  // 80%+ (the user, 11/13: don't cut a longer run off at 10). "13-3 in the last 16 meetings".
  if (reg.length >= 10) {
    for (const t of [away, home]) {
      let best = null;
      for (let N = 10; N <= reg.length; N++) {
        const last = reg.slice(-N), k = last.filter((m) => m.winner === t).length;
        if (k >= 8 && k / N >= 0.8) best = { N, k, first: last[0] };
      }
      if (!best || (n >= 8 && w === t && n >= best.k)) continue;
      const { N, k, first } = best;
      const all = N === reg.length ? `, every meeting${since}` : "";
      items.push({ kind: "matchup", team: t, text: `The ${nick(t)} are ${k}-${N - k} in the last ${N} meetings with the ${nick(t === away ? home : away)}${all} (since ${md(first.d)}/${first.d.slice(2, 4)}).`, tag: `Last ${N} · ${k}-${N - k}`, score: 1.3 + 0.45 * (Math.min(k, 16) - 7) * Math.min(1, k / N / 0.9) });
    }
  }
  // Tonight's arena.
  const there = reg.filter((m) => m.home === home);
  const [vw, vn] = tailRun(there, (m) => m.winner);
  if (vn >= 4) {
    const text = vw === home ? `The ${nick(home)} have won ${vn} straight at home against the ${nick(away)}.` : `The ${nick(away)} have won ${vn} straight road games against the ${nick(home)}.`;
    items.push({ kind: "matchup", team: vw, text: vn === there.length ? text.replace(/\.$/, `, every game there${since}.`) : text, tag: `${vw === home ? "Home" : "Road"} streak · ${vn}`, score: 1.2 + 0.25 * Math.min(vn, 12), active: true });
  }
  // Season series, completed seasons.
  const cur = seasonOf(today);
  const bySeason = new Map();
  for (const m of reg) { const s = seasonOf(m.d); const x = bySeason.get(s) || { [away]: 0, [home]: 0 }; x[m.winner]++; bySeason.set(s, x); }
  const done = [...bySeason.entries()].filter(([s]) => s !== cur).map(([s, x]) => ({ s, w: x[away] > x[home] ? away : x[home] > x[away] ? home : null, x }));
  const [sw, sn] = tailRun(done, (z) => z.w);
  const now = bySeason.get(cur);
  if (sw && sn >= 3) items.push({ kind: "matchup", team: sw, text: `The ${nick(sw)} have won ${sn} straight season series against the ${nick(sw === away ? home : away)}${sn === done.length ? `, every one${since}` : ""}${now ? ` (this season: ${now[sw]}-${now[sw === away ? home : away]})` : ""}.`, tag: `Season series · ${sn} straight`, score: 1.3 + 0.3 * Math.min(sn, 8) });
  // This season so far.
  if (now) {
    const lead = now[away] === now[home] ? null : now[away] > now[home] ? away : home;
    const lastM = reg[reg.length - 1];
    items.push({ kind: "matchup", team: lead || home, text: lead ? `The ${nick(lead)} lead the season series ${now[lead]}-${now[lead === away ? home : away]} (${lastM.winner === away ? nick(away) : nick(home)} ${Math.max(lastM.hs, lastM.as)}-${Math.min(lastM.hs, lastM.as)} on ${md(lastM.d)}).` : `The season series is tied ${now[away]}-${now[home]}.`, tag: "Season series", score: 1.0 });
  }
  // Last season's playoff series only (the user, 11/13: two playoffs ago is too old to surface).
  const po = all.filter((m) => m.type === 3 && seasonOf(m.d) === seasonOf(`${Number(seasonOf(today).slice(0, 4)) - 1}-10-01`));
  if (po.length >= 4) {
    const s = seasonOf(po[po.length - 1].d);
    const ser = po.filter((m) => seasonOf(m.d) === s);
    const wins = { [away]: 0, [home]: 0 };
    for (const m of ser) wins[m.winner]++;
    const win = wins[away] > wins[home] ? away : home;
    const ago = Number(seasonOf(today).slice(0, 4)) - Number(s.slice(0, 4));
    items.push({ kind: "matchup", team: win, text: `${ago === 1 ? "Playoff rematch: t" : "T"}he ${nick(win)} beat the ${nick(win === away ? home : away)} ${wins[win]}-${wins[win === away ? home : away]} in the ${s} playoffs.`, tag: ago === 1 ? "Playoff rematch" : `${s} playoffs`, score: ago === 1 ? 2.3 : 1.4 });
  }
  return items;
}

/** A player's regular-season games, oldest first, from the back-fill and this season's box scores (rows in the logs' columns). */
export function playerGames(id, logs, teamFiles) {
  const out = new Map();
  for (const r of logs?.players?.[id] || []) if (r[C.type] === 2) out.set(r[C.date], r);
  for (const [t, f] of Object.entries(teamFiles || {})) {
    const k = Object.fromEntries((f.keys || []).map((x, i) => [x, i]));
    for (const g of f.games || []) {
      const l = g.pl?.[id];
      if (!l || !(l[k.min] > 0)) continue;
      out.set(g.d, [g.d, g.opp, g.home ? 1 : 0, g.pf > g.pa ? "W" : "L", 2, l[k.min], l[k.pts], l[k.reb], l[k.ast], l[k.stl], l[k.blk], l[k.fg3m], t]);
    }
  }
  return [...out.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

export function playerItems({ id, name, team, opp, logs, teamFiles, today, minGames = 4 }) {
  const games = playerGames(id, logs, teamFiles).filter((r) => r[C.date] < today && r[C.date] >= START);
  const vs = games.filter((r) => r[C.opp] === opp);
  const items = [];
  if (vs.length < 2) return items;
  const career = games.length && games[0][C.date] > "2016-11-15";
  const scope = career ? "in his career" : `since ${FIRST}`;
  const who = name;
  // Best or worst against any team.
  if (vs.length >= minGames) {
    const byOpp = new Map();
    for (const r of games) { const a = byOpp.get(r[C.opp]) || []; a.push(r); byOpp.set(r[C.opp], a); }
    const field = [...byOpp.entries()].filter(([, rs]) => rs.length >= minGames);
    let best = null;
    for (const [stat, [word, gap]] of Object.entries(STAT)) {
      const all = avg(games, C[stat]), mine = avg(vs, C[stat]);
      const ranked = field.map(([o, rs]) => [o, avg(rs, C[stat])]).sort((x, y) => y[1] - x[1]);
      const at = ranked.findIndex(([o]) => o === opp);
      if (field.length < 8 || at < 0) continue;
      const hi = at === 0 && mine - all >= gap, lo = at === ranked.length - 1 && all - mine >= gap && all >= gap * 2;
      if (!hi && !lo) continue;
      const strength = Math.abs(mine - all) / gap;
      if (!best || strength > best.strength) best = { stat, word, hi, mine, all, strength };
    }
    if (best) items.push({ kind: "matchup", team, player: name, text: `${who} has averaged ${r1(best.mine)} ${best.word} in ${vs.length} games against the ${nick(opp)} ${scope}, his ${best.hi ? "most" : "fewest"} against any team (${r1(best.all)} overall).`, tag: best.hi ? `Best vs any team` : `Worst vs any team`, score: 1.6 + 0.5 * Math.min(best.strength, 3), lopsided: true });
    // His teams' record in those games.
    const W = vs.filter((r) => r[C.res] === "W").length, L = vs.length - W;
    if (vs.length >= 8 && (W / vs.length >= 0.85 || L / vs.length >= 0.85)) items.push({ kind: "matchup", team, player: name, text: `${who}'s teams are ${W}-${L} against the ${nick(opp)} in games he's played ${scope}.`, tag: `${W}-${L} vs ${opp}`, score: Math.min(2.6, 1.4 + 0.08 * Math.max(W, L)), lopsided: true });
  }
  // A streak still going against this opponent.
  const runs = [
    ["30+ points", (r) => r[C.pts] >= 30, 3, 2.0], ["25+ points", (r) => r[C.pts] >= 25, 4, 1.7], ["20+ points", (r) => r[C.pts] >= 20, 6, 1.5],
    ["a double-double", (r) => [r[C.pts], r[C.reb], r[C.ast], r[C.stl], r[C.blk]].filter((x) => x >= 10).length >= 2, 4, 1.6],
    ["10+ rebounds", (r) => r[C.reb] >= 10, 5, 1.4], ["10+ assists", (r) => r[C.ast] >= 10, 4, 1.5], ["3+ threes", (r) => r[C.fg3m] >= 3, 5, 1.4],
    // His teams' run against this opponent (the user liked "Oubre's teams have lost 6 straight against the Knicks", 11/13).
    ["a win", (r) => r[C.res] === "W", 6, 1.8], ["a loss", (r) => r[C.res] === "L", 6, 1.8],
  ];
  // A scoring or rebounding streak counts only at a bar near his own average (20+ in a row means little from a 30-a-game scorer).
  const mean = (i) => (games.length ? avg(games, i) : 0);
  const bar = { "30+ points": 30 >= mean(C.pts) - 2, "25+ points": 25 >= mean(C.pts) - 2, "20+ points": 20 >= mean(C.pts) - 2, "10+ rebounds": 10 >= mean(C.reb) - 1, "10+ assists": 10 >= mean(C.ast) - 1, "3+ threes": 3 >= mean(C.fg3m) - 0.5, "a double-double": true, "a win": true, "a loss": true };
  let top = null;
  for (const [what, test, min, base] of runs) {
    if (!bar[what]) continue;
    let n = 0;
    for (let i = vs.length - 1; i >= 0 && test(vs[i]); i--) n++;
    if (n < min) continue;
    const score = base + 0.25 * (n - min);
    if (!top || score > top.score) top = { what, n, score };
  }
  if (top) {
    const text = top.what === "a win" ? `${who}'s teams have won ${top.n} straight against the ${nick(opp)} with him playing${top.n === vs.length ? `, every game ${scope}` : ""}.`
      : top.what === "a loss" ? `${who}'s teams have lost ${top.n} straight against the ${nick(opp)} with him playing${top.n === vs.length ? `, every game ${scope}` : ""}.`
      : `${who} has ${top.what} in ${top.n} straight games against the ${nick(opp)}${top.n === vs.length ? `, every game ${scope}` : ""}.`;
    items.push({ kind: "matchup", team, player: name, text, tag: `Streak vs ${opp} · ${top.n}`, score: top.score, active: true });
  }
  // The last meeting, when big.
  const lastG = vs[vs.length - 1];
  if (seasonOf(lastG[C.date]) === seasonOf(today) && (lastG[C.pts] >= 30 || lastG[C.reb] >= 15 || lastG[C.ast] >= 12)) {
    const parts = [[C.pts, "points"], [C.reb, "rebounds"], [C.ast, "assists"]].filter(([i]) => lastG[i] >= 10).map(([i, w]) => `${lastG[i]} ${w}`);
    items.push({ kind: "matchup", team, player: name, text: `${who} had ${parts.join(", ")} against the ${nick(opp)} on ${md(lastG[C.date])} (${lastG[C.res] === "W" ? "won" : "lost"}).`, tag: "Last meeting", score: 1.2 + (lastG[C.pts] >= 40 ? 0.6 : 0) });
  }
  return items;
}

/** Regulars this season: 18+ minutes a game over 3+ games, on the team they last played for. */
export function regulars(teamFiles, tri) {
  const f = teamFiles?.[tri];
  if (!f) return [];
  const k = Object.fromEntries((f.keys || []).map((x, i) => [x, i]));
  const lastTeam = new Map();
  for (const [t, ff] of Object.entries(teamFiles)) for (const g of ff.games || []) for (const id of Object.keys(g.pl || {})) if (g.pl[id][k.min] > 0 && (!lastTeam.has(id) || lastTeam.get(id).d < g.d)) lastTeam.set(id, { t, d: g.d });
  const out = [];
  for (const [id, name] of Object.entries(f.names || {})) {
    if (lastTeam.get(id)?.t !== tri) continue;
    const g = (f.games || []).filter((x) => x.pl?.[id]?.[k.min] > 0);
    if (g.length >= 3 && g.reduce((a, x) => a + x.pl[id][k.min], 0) / g.length >= 18) out.push({ id, name, ppg: g.reduce((a, x) => a + x.pl[id][k.pts], 0) / g.length });
  }
  return out;
}

export function matchups({ history, logs, teamFiles, tonight, today }) {
  return (tonight || []).map((g) => {
    const items = [...teamItems(history, teamFiles, g.away, g.home, today)];
    // A player's lines weigh with his role: 0.8 for a 6-point player, 1.0 at 15, 1.2 at 24+ points a game this season.
    for (const [t, o] of [[g.away, g.home], [g.home, g.away]]) for (const p of regulars(teamFiles, t)) {
      const role = 0.8 + Math.min(0.4, Math.max(0, (p.ppg - 6) / 45));
      items.push(...playerItems({ id: p.id, name: p.name, team: t, opp: o, logs, teamFiles, today }).map((i) => ({ ...i, score: Math.round(i.score * role * 100) / 100 })));
    }
    return { id: g.id, away: g.away, home: g.home, items: items.sort((a, b) => b.score - a.score) };
  });
}
