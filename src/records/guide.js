/**
 * Career leaderboards and records, kept current: the NBA's Tip-Off Guide totals (through last season,
 * src/data/tipoff-guide-<season>.json, read by tools/parse-tipoff-guide.py) plus this season's box
 * scores (docs/data/teams/<TRI>.json). Pure: no I/O.
 *
 *   currentRecords({ guide, teamFiles, today, tonight }) -> {
 *     players   [{ name, id, team, totals: { stat: { base, season, now } } }]   everyone the guide gives a total for
 *     boards    { stat: [{ name, now, rank, preRank, live, team }] }           all-time lists as they stand now
 *     items     [...]   what is coming: passes, round numbers, franchise records, coaches, team records
 *     problems  [...]   names that matched no one or more than one player, conflicting guide totals
 *   }
 *
 * An item: { kind: "pass" | "round" | "franchise" | "coach" | "team" | "franchiseWins", who, id?, team,
 *            stat, label, now, target, need, passing?: { name, value, rank, live }, rank?, rate, gamesAway,
 *            text, score, tonight: bool }
 * `rate` is his per-game rate this season; `gamesAway` = need / rate (rounded up). Probabilities for
 * tonight are added by the caller (scripts/situations.js, with src/anticipate/model.js).
 *
 * Ranks: the guide gives each listed player's rank before the season. A rank now = that rank, moved
 * by every listed player who has passed him (or he has passed) since. Players the guide doesn't list
 * can't be seen, so a rank is only as good as the guide's lists around it (top 10, plus the names
 * its milestone pages mention).
 */
import { nameKey } from "../notes/names.js";
import { TEAMS } from "../teams.js";

/** Name match that keeps suffixes: the guide's Gary Payton is not this season's Gary Payton II. */
export const strictKey = (n) => {
  const suffix = /\s+(Jr\.?|Sr\.?|II|III|IV)\s*$/i.exec(String(n || ""));
  return `${nameKey(n)}${suffix ? ` ${suffix[1].replace(/\./, "").toLowerCase()}` : ""}`;
};

export const LABEL = { pts: "points", reb: "rebounds", oreb: "offensive rebounds", dreb: "defensive rebounds", ast: "assists", stl: "steals", blk: "blocks",
  fgm: "field goals", ftm: "free throws", fg3m: "3-pointers", gp: "games", min: "minutes", td: "triple-doubles", wins: "wins" };
const SINGULAR = { pts: "point", reb: "rebound", oreb: "offensive rebound", dreb: "defensive rebound", ast: "assist", stl: "steal", blk: "block",
  fgm: "field goal", ftm: "free throw", fg3m: "3-pointer", gp: "game", min: "minute", td: "triple-double", wins: "win" };
export const statWord = (stat, n) => (n === 1 ? SINGULAR[stat] : LABEL[stat]) || stat;
// Round numbers worth a post, past these floors (the guide's own "reach" marks are added on top).
export const STEPS = { pts: 1000, reb: 1000, ast: 1000, fgm: 1000, ftm: 1000, fg3m: 100, stl: 250, blk: 250, oreb: 500, dreb: 1000, gp: 100, td: 25, wins: 100 };
export const FLOOR = { pts: 20000, reb: 10000, ast: 5000, fgm: 8000, ftm: 5000, fg3m: 2000, stl: 1500, blk: 1500, oreb: 3000, dreb: 7000, gp: 1200, td: 50, wins: 800 };
const HORIZON = 15;        // games ahead worth listing
const RECORD_HORIZON = 60; // an NBA record chase: listed while it's reachable this season
const AHEAD = 3;           // players ahead listed per stat
const ORD = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const fmt = (n) => Number(n).toLocaleString("en-US");
const BOX = ["pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "fgm", "ftm", "fg3m", "min"];

/** Each player's lines this season from the team files: { id: { name, team, last, lines: [{ d, team, opp, home, win, stats }] } } */
export function seasonLines(teamFiles) {
  const out = {};
  for (const [tri, f] of Object.entries(teamFiles || {})) {
    const ix = Object.fromEntries((f.keys || []).map((k, i) => [k, i]));
    for (const g of f.games || []) {
      for (const [id, row] of Object.entries(g.pl || {})) {
        const v = (k) => row[ix[k]] || 0;
        const played = v("min") > 0 || ["pts", "reb", "ast", "stl", "blk", "fga", "fta", "tov", "pf"].some((k) => v(k) > 0);
        const p = (out[id] ??= { id, name: (f.names || {})[id] || id, team: tri, last: "", lines: [], teamGames: {} });
        (p.teamGames[tri] ??= []).push({ d: g.d, played });
        if (!played) continue;
        const stats = Object.fromEntries(BOX.map((k) => [k, v(k)]));
        stats.gp = 1;
        stats.td = ["pts", "reb", "ast", "stl", "blk"].filter((k) => stats[k] >= 10).length >= 3 ? 1 : 0;
        const win = g.pf != null && g.pa != null ? (g.pf > g.pa ? 1 : 0) : 0;
        stats.wins = win;
        p.lines.push({ d: g.d, team: tri, opp: g.opp, home: !!g.home, stats });
        if (g.d >= p.last) { p.last = g.d; p.team = tri; }
      }
    }
  }
  for (const p of Object.values(out)) p.lines.sort((a, b) => b.d.localeCompare(a.d)); // most recent first
  return out;
}

/** Team results this season: { TRI: [{ d, home, win }] } oldest first. */
export function teamResults(teamFiles) {
  const out = {};
  for (const [tri, f] of Object.entries(teamFiles || {})) {
    out[tri] = (f.games || []).filter((g) => g.pf != null && g.pa != null).map((g) => ({ d: g.d, home: !!g.home, win: g.pf > g.pa })).sort((a, b) => a.d.localeCompare(b.d));
  }
  return out;
}

export function currentRecords({ guide, teamFiles, today = null, tonight = [], scorers = [], coachList = null, coachTeams = null, where = "all-time", record = "the NBA record", rounds = true, kind = null, horizon = HORIZON }) {
  const problems = [];
  const lines = seasonLines(teamFiles);
  const byKey = {};
  for (const p of Object.values(lines)) (byKey[strictKey(p.name)] ??= []).push(p);
  const playing = new Map(); // tri -> { home, opp } tonight
  for (const g of tonight || []) { playing.set(g.home, { home: true, opp: g.away }); playing.set(g.away, { home: false, opp: g.home }); }

  // ---- everyone the guide gives a career total (league-wide scope) ----
  const people = new Map(); // key -> { name, totals: { stat: base }, preRank: { stat: n } }
  const person = (name) => { const k = strictKey(name); if (!people.has(k)) people.set(k, { name, totals: {}, preRank: {} }); return people.get(k); };
  const put = (name, stat, value, rank, where) => {
    const p = person(name);
    if (p.totals[stat] != null && p.totals[stat] !== value) problems.push(`${name} ${stat}: the guide gives ${fmt(p.totals[stat])} and ${fmt(value)} (${where})`);
    p.totals[stat] ??= value;
    if (rank) p.preRank[stat] ??= rank;
  };
  for (const [stat, rows] of Object.entries(guide.alltime || {})) rows.forEach((r, i) => put(r.name, stat, r.value, i + 1, "all-time list"));
  for (const [stat, rows] of Object.entries(guide.active || {})) rows.forEach((r) => put(r.name, stat, r.value, null, "active list"));
  // Per-game lists: their totals, but not their games (for older players those count only the seasons the stat was kept).
  for (const [stat, rows] of Object.entries(guide.extra || {})) if (stat !== "gp") rows.forEach((r) => put(r.name, stat, r.value, null, "per-game list"));
  for (const w of guide.watch || []) if (w.scope === "nba") put(w.player, w.stat, w.value, w.rank, `milestone watch p. ${w.page}`);
  // The NBA Guide's top career scorers (every 19,000-point scorer, in order): points ranks 1-68, and their other totals.
  for (const r of scorers || []) {
    put(r.name, "pts", r.pts, r.rank, "career scorers, NBA Guide p. 136");
    for (const k of ["gp", "fgm", "ftm", "reb", "ast", "min"]) if (r[k] != null) put(r.name, k, r[k], null, "career scorers, NBA Guide p. 136");
  }
  for (const t of guide.targets || []) if (t.scope === "nba") put(t.name, t.stat, t.value, t.rank, `milestone watch p. ${t.page}`);
  // A rank tie in the top-10 lists ("tied for 29th") is fine; a rank the milestone pages give wins.
  for (const w of [...(guide.watch || []), ...(guide.targets || [])]) if (w.scope === "nba" && w.rank) person(w.player || w.name).preRank[w.stat] = w.rank;

  // ---- this season, matched by name ----
  for (const p of people.values()) {
    const m = byKey[strictKey(p.name)] || [];
    if (m.length > 1) { problems.push(`${p.name}: ${m.length} players this season with that name; not counted`); continue; }
    p.season = m[0] || null;
  }
  const seasonOf = (p, stat) => (p.season ? p.season.lines.reduce((a, l) => a + (l.stats[stat] || 0), 0) : 0);
  const players = [...people.values()].map((p) => ({
    name: p.name, id: p.season?.id || null, team: p.season?.team || null,
    totals: Object.fromEntries(Object.entries(p.totals).map(([stat, base]) => [stat, { base, season: seasonOf(p, stat), now: base + seasonOf(p, stat), preRank: p.preRank[stat] || null }])),
  }));

  // ---- all-time lists as they stand now ----
  const boards = {};
  for (const stat of Object.keys(LABEL)) {
    const rows = players.filter((p) => p.totals[stat]).map((p) => ({ name: p.name, id: p.id, team: p.team, live: !!p.id, now: p.totals[stat].now, base: p.totals[stat].base, preRank: p.totals[stat].preRank }));
    if (!rows.length) continue;
    const ranked = rows.filter((r) => r.preRank);
    for (const r of ranked) {
      // Moved down by every ranked player now ahead who started behind, up by every one now behind who started ahead.
      r.rank = r.preRank + ranked.filter((q) => q !== r && q.preRank > r.preRank && q.now > r.now).length - ranked.filter((q) => q !== r && q.preRank < r.preRank && q.now < r.now).length;
    }
    boards[stat] = rows.sort((a, b) => b.now - a.now);
  }

  // ---- what's coming ----
  const items = [];
  const rateOf = (p, stat) => {
    const L = p.season?.lines || [];
    return L.length ? L.reduce((a, l) => a + (l.stats[stat] || 0), 0) / L.length : 0;
  };
  const add = (it) => {
    const gamesAway = it.rate > 0 ? Math.max(1, Math.ceil(it.need / it.rate)) : null;
    // An NBA record chase stays listed however far off; the rest only within HORIZON games.
    if (it.need <= 0 || gamesAway == null || (gamesAway > horizon && !(it.kind === "pass" && it.rank === 1 && gamesAway <= RECORD_HORIZON))) return;
    const t = playing.get(it.team);
    items.push({ ...it, ...(kind ? { kind } : {}), gamesAway, tonight: !!t, opp: t?.opp || null });
  };
  for (const p of players) {
    if (!p.id) continue;
    const src = people.get(strictKey(p.name)).season;
    const last = (p.name.replace(/\s+(?:Jr\.|II|III|IV)$/, "").split(" ").pop());
    for (const [stat, T] of Object.entries(p.totals)) {
      if (stat === "min") continue; // box-score minutes are rounded: not exact enough to count down
      const rate = rateOf({ season: src }, stat);
      const board = boards[stat] || [];
      // Ranked players ahead (nearest first), and the rank he'd reach. Unranked names (from the active and
      // per-game lists) aren't landmarks: passing the 40th-best total nobody numbered isn't news.
      const ahead = board.filter((r) => r.rank && r.name !== p.name && r.now >= T.now).sort((a, b) => a.now - b.now || a.rank - b.rank);
      // Players level with each other are passed together: "passing Kyle Lowry and Buddy Hield (2,209) for 14th".
      const groups = [];
      for (const r of ahead) { const g = groups[groups.length - 1]; if (g && g[0].now === r.now) g.push(r); else groups.push([r]); }
      for (const grp of groups.slice(0, AHEAD)) {
        const a = { ...grp[0], name: grp.map((x) => x.name).join(" and "), rank: Math.min(...grp.map((x) => x.rank)), live: grp.some((x) => x.live) };
        const need = a.now - T.now + 1;
        add({ kind: "pass", who: p.name, last, id: p.id, team: p.team, stat, label: LABEL[stat], now: T.now, target: a.now + 1, need, rate,
          passing: { name: a.name, value: a.now, rank: a.rank || null, live: a.live }, rank: a.rank || null,
          text: `${last}: ${fmt(need)} ${statWord(stat, need)} from passing ${a.name} (${fmt(a.now)})${a.rank === 1 ? ` for ${record}` : a.rank ? ` for ${ORD(a.rank)} ${where}` : ""}${a.rank === 1 && need > 1 ? `; ${fmt(need - 1)} ties him` : ""}`,
          score: a.rank ? (a.rank === 1 ? 5 : a.rank <= 5 ? 4.2 : a.rank <= 10 ? 3.6 : a.rank <= 25 ? 2.8 : 2.2) : 2 });
      }
      // Round numbers: the guide's own marks, and the usual steps past the floor.
      const marks = new Set((guide.rounds || []).filter((r) => r.scope === "nba" && r.stat === stat && r.player === p.name).map((r) => r.value));
      if (rounds && STEPS[stat] && T.now >= FLOOR[stat] - STEPS[stat]) marks.add(Math.floor(T.now / STEPS[stat]) * STEPS[stat] + STEPS[stat]);
      for (const v of marks) {
        if (v <= T.now || v < FLOOR[stat]) continue;
        const need = v - T.now;
        const club = board.filter((r) => r.now >= v).length; // listed players already there
        add({ kind: "round", who: p.name, last, id: p.id, team: p.team, stat, label: LABEL[stat], now: T.now, target: v, need, rate,
          text: `${last}: ${fmt(need)} ${statWord(stat, need)} from ${fmt(v)} career ${LABEL[stat]}`,
          score: v >= 30000 || (stat === "fg3m" && v >= 3000) ? 3.6 : v % (STEPS[stat] * 5) === 0 ? 2.8 : 2.2, club });
      }
    }
  }
  // Franchise records: only games for that franchise count.
  for (const w of guide.watch || []) {
    if (w.scope !== "franchise") continue;
    const m = byKey[strictKey(w.player)] || [];
    if (m.length !== 1) { problems.push(`${w.player}: no single match this season (franchise ${w.stat})`); continue; }
    const p = m[0], L = p.lines.filter((l) => l.team === w.team);
    const now = w.value + L.reduce((a, l) => a + (l.stats[w.stat] || 0), 0);
    const rate = L.length ? L.reduce((a, l) => a + (l.stats[w.stat] || 0), 0) / L.length : 0;
    for (const t of (guide.targets || []).filter((x) => x.scope === "franchise" && x.team === w.team && x.stat === w.stat)) {
      const last = w.player.split(" ").pop();
      const need = t.value - now + 1;
      const T = TEAMS[w.team];
      add({ kind: "franchise", who: w.player, last, id: p.id, team: w.team, stat: w.stat, label: LABEL[w.stat], now, target: t.value + 1, need, rate,
        passing: { name: t.name, value: t.value, rank: t.rank }, rank: t.rank,
        text: `${last}: ${fmt(need)} ${statWord(w.stat, need)} from passing ${t.name} (${fmt(t.value)}) for ${t.rank === 1 ? "the most" : ORD(t.rank)} in ${T ? T.nick : w.team} history`,
        score: t.rank === 1 ? 4 : 2.5 });
    }
  }
  // Coaches: wins and games coached = guide + the team's games this season.
  const results = teamResults(teamFiles);
  // With the NBA Guide's coaching rankings (every 300-win coach, top 20 by games) and today's head coaches
  // from ESPN's rosters, every ranked coach is followed; otherwise the Tip-Off Guide's three.
  let coachWatch = guide.coaches?.watch || [], coachBoard = (stat) => [
    ...(stat === "wins" ? guide.coaches?.wins || [] : []),
    ...(guide.coaches?.targets || []).filter((t) => t.stat === stat),
  ];
  let coachRounds = guide.coaches?.rounds || [];
  if (coachList && coachTeams) {
    const byName = new Map(coachList.wins.map((c) => [nameKey(c.name), c]));
    coachWatch = Object.entries(coachTeams).flatMap(([team, name]) => {
      const c = name && byName.get(nameKey(name));
      return c ? [{ name: c.name, team, wins: c.w, games: c.w + c.l }] : [];
    });
    coachBoard = (stat) => (stat === "wins" ? coachList.wins.map((c) => ({ name: c.name, value: c.w, rank: c.rank })) : coachList.games.map((c) => ({ name: c.name, value: c.g, rank: c.rank })));
    coachRounds = coachWatch.flatMap((c) => [
      { name: c.name, stat: "wins", value: Math.floor(c.wins / 100) * 100 + 100 },
      ...(c.games >= 900 ? [{ name: c.name, stat: "games", value: Math.floor(c.games / 100) * 100 + 100 }] : []),
    ]);
  }
  for (const c of coachWatch) {
    const R = results[c.team] || [];
    const tw = R.filter((r) => r.win).length, tg = R.length;
    for (const stat of ["wins", "games"]) {
      if (c[stat] == null) continue;
      const now = c[stat] + (stat === "wins" ? tw : tg);
      const rate = stat === "games" ? 1 : tg ? tw / tg : 0.5;
      const last = c.name.split(" ").pop();
      const ahead = coachBoard(stat).filter((t) => t.name !== c.name && t.value >= now).sort((a, b) => a.value - b.value).slice(0, 2);
      for (const t of ahead) {
        const need = t.value - now + 1;
        add({ kind: "coach", who: c.name, last, team: c.team, stat, label: stat === "games" ? "games coached" : "coaching wins", now, target: t.value + 1, need, rate,
          passing: { name: t.name, value: t.value, rank: t.rank }, rank: t.rank,
          text: `${last}: ${fmt(need)} ${stat === "games" ? (need === 1 ? "game" : "games") : need === 1 ? "win" : "wins"} from passing ${t.name} (${fmt(t.value)}) for ${ORD(t.rank)} in career ${stat === "games" ? "games coached" : "coaching wins"}`,
          score: t.rank <= 10 ? 3 : 2.2 });
      }
      for (const r of coachRounds.filter((r) => r.name === c.name && r.stat === stat && r.value > now)) {
        const need = r.value - now;
        add({ kind: "coach", who: c.name, last, team: c.team, stat, label: stat === "games" ? "games coached" : "coaching wins", now, target: r.value, need, rate,
          text: stat === "games" ? `${last}: ${need === 1 ? `coaches his ${fmt(r.value)}th game` : `${need} games from his ${fmt(r.value)}th game coached`}`
            : `${last}: ${need === 1 ? "1 win" : `${need} wins`} from his ${fmt(r.value)}th career win`, score: r.value % 500 === 0 ? 3 : 2.4 });
      }
    }
  }
  // Players' wins (LeBron's record chase) ride on his team's results in his games: covered by "pass" on stat wins.

  // Team records: streaks and starts, from the guide's all-time lists.
  for (const [tri, R] of Object.entries(results)) {
    const T = TEAMS[tri];
    const name = T ? T.nick : tri;
    const cur = streak(R), losses = R.filter((r) => !r.win).length, wins = R.length - losses;
    const homeR = R.filter((r) => r.home), roadR = R.filter((r) => !r.home);
    const checks = [
      { list: "winStreak", n: cur, what: "win streak", any: true },
      { list: "startUnbeaten", n: losses === 0 ? wins : 0, what: "unbeaten start", any: true },
      ...[1, 2, 3].map((l) => ({ list: `start${l}`, n: losses === l ? wins : 0, what: `start with ${l} loss${l > 1 ? "es" : ""}`, losses: l, any: true })),
      { list: "homeStart", n: homeR.every((r) => r.win) ? homeR.length : 0, what: "home win streak to start a season", home: true },
      { list: "homeStreak", n: streak(homeR), what: "home win streak", home: true },
      { list: "roadStart", n: roadR.every((r) => r.win) ? roadR.length : 0, what: "road win streak to start a season", home: false },
      { list: "roadStreak", n: streak(roadR), what: "road win streak", home: false },
    ];
    for (const c of checks) {
      const list = guide.teamRecords?.[c.list] || [];
      if (!list.length || c.n <= 0) continue;
      const floor = Math.min(...list.map((r) => r.w));
      const next = c.n + 1;
      // Listed when the next win (or the one after) would reach the list.
      if (next + 1 < floor) continue;
      const better = list.filter((r) => r.w > next).length;
      const ties = list.filter((r) => r.w === next);
      const rec = c.losses ? `${next}-${c.losses}` : `${next}`;
      const t = playing.get(tri);
      const fits = t && (c.home == null || t.home === c.home);
      const place = better === 0 ? (ties.length ? "tie the best" : "the best") : `${ties.length ? "tie for " : ""}the ${ORD(better + 1)}-best`;
      const text = c.losses || c.list === "startUnbeaten"
        ? `${name}: ${c.losses ? `${wins}-${c.losses}` : `${wins}-0`}; a win${fits ? " tonight" : ""} makes ${rec}${c.losses ? "" : "-0"}, ${place} ${c.what} in NBA history${ties.length ? ` (${ties.map((r) => `${r.team} ${r.when}`).join("; ")})` : ""}`
        : `${name}: ${c.n} straight; a ${c.home === true ? "home " : c.home === false ? "road " : ""}win${fits ? " tonight" : ""} makes ${next}, ${place} ${c.what} in NBA history${ties.length ? ` (${ties.map((r) => `${r.team}, ${r.when}`).join("; ")})` : ""}`;
      items.push({ kind: "team", who: name, team: tri, stat: c.list, label: c.what, now: c.n, target: next, need: next >= floor ? 1 : 2, rate: null, gamesAway: next >= floor ? 1 : 2,
        rank: better + 1, text: next >= floor ? text : `${name}: ${c.n}${c.losses ? `-${c.losses}` : ""} ${c.what}; two more wins reach the NBA's top list (${floor})`,
        score: next >= floor ? (better <= 2 ? 4.5 : 3.5) : 1.5, tonight: !!fits, opp: t?.opp || null });
    }
  }
  // Franchises: round-number wins (every 500) and all-time .500.
  const nickOf = Object.fromEntries(Object.entries(TEAMS).map(([tri, t]) => [`${t.city} ${t.nick}`.replace(/^LA /, "LA "), tri]));
  nickOf["Los Angeles Clippers"] = "LAC"; nickOf["LA Clippers"] = "LAC";
  for (const f of guide.franchises || []) {
    const tri = nickOf[f.team];
    if (!tri) { problems.push(`franchise "${f.team}": no team code`); continue; }
    const R = results[tri] || [];
    const w = f.w + R.filter((r) => r.win).length, l = f.l + R.filter((r) => !r.win).length;
    const name = TEAMS[tri].nick;
    const t = playing.get(tri);
    const rate = R.length ? R.filter((r) => r.win).length / R.length : 0.5;
    const next500 = Math.floor(w / 500) * 500 + 500;
    if (next500 - w <= 5) add({ kind: "franchiseWins", who: name, team: tri, stat: "wins", label: "franchise wins", now: w, target: next500, need: next500 - w, rate,
      text: `${name}: ${next500 - w} win${next500 - w === 1 ? "" : "s"} from the franchise's ${fmt(next500)}th regular-season win (${fmt(w)}-${fmt(l)} all-time)`, score: 2.6 });
    const diff = w - l;
    if (Math.abs(diff) <= 2) {
      const text = diff === 0 ? `${name}: exactly .500 all-time (${fmt(w)}-${fmt(l)}); tonight's result puts the franchise above or below`
        : diff > 0 ? `${name}: ${fmt(w)}-${fmt(l)} all-time; ${diff === 1 ? "a loss" : "two losses"} would bring the franchise to .500`
          : `${name}: ${fmt(w)}-${fmt(l)} all-time; ${diff === -1 ? "a win" : "two wins"} would bring the franchise to .500`;
      items.push({ kind: "franchiseWins", who: name, team: tri, stat: "500", label: "all-time .500", now: w, target: l, need: Math.abs(diff), rate: null, gamesAway: Math.max(1, Math.abs(diff)), text, score: Math.abs(diff) <= 1 ? 2.4 : 1.4, tonight: !!t, opp: t?.opp || null });
    }
  }
  items.sort((a, b) => a.gamesAway - b.gamesAway || b.score - a.score);
  return { players, boards, items, problems, through: Object.values(teamFiles || {}).reduce((a, f) => (f.through > a ? f.through : a), "") };
}

function streak(R) {
  let n = 0;
  for (let i = R.length - 1; i >= 0 && R[i].win; i--) n++;
  return n;
}

/**
 * Chances for a player's items: tonight (if his team plays) and within his next 5 games, from his
 * games this season (src/anticipate/model.js). pPlay = share of his team's last 10 games he played.
 * Mutates and returns items.
 */
export function addChances(items, teamFiles, { makeSampler, simulate, sims = 3000 }) {
  const L = seasonLines(teamFiles);
  const cache = new Map();
  for (const it of items) {
    if (!it.id || !L[it.id] || it.kind === "coach" || it.kind === "team" || it.kind === "franchiseWins") continue;
    const p = L[it.id];
    const lines = it.kind === "franchise" ? p.lines.filter((l) => l.team === it.team) : p.lines;
    if (lines.length < 3) { it.note = "fewer than 3 games this season: no odds"; continue; }
    const binary = ["gp", "td", "wins"].includes(it.stat);
    const key = `${it.id}|${binary}`;
    if (!cache.has(key)) {
      const tg = (p.teamGames[p.team] || []).slice(-10);
      const pPlay = Math.min(0.97, tg.length >= 3 ? Math.max(0.05, tg.filter((g) => g.played).length / tg.length) : 0.9);
      cache.set(key, { pPlay, sample: makeSampler(lines.slice(0, 20), { smooth: binary ? 0 : 0.2 }) });
    }
    const c = cache.get(key);
    const n = Math.max(1, it.horizonGames ?? 5); // the Cup: his Cup games left
    const games = Array.from({ length: n }, () => ({ pPlay: c.pPlay }));
    const sim = simulate({ need: it.need, stat: it.stat, sample: c.sample, games, sims, seed: hash(`${it.who}|${it.stat}|${it.need}`) });
    if (sim.unknown) continue;
    it.pPlay = Math.round(c.pPlay * 100) / 100;
    it.pTonight = it.tonight ? Math.round(sim.byGame[0] * 1000) / 1000 : 0;
    it.pNext5 = Math.round(sim.byGame[Math.min(4, n - 1)] * 1000) / 1000;
  }
  return items;
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
