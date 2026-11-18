#!/usr/bin/env node
// Every player's runs of big games, by franchise, since 1993-94 (0.106): "30+ points in four straight" and the like, for
// every player ESPN's box scores hold, not only the ones still playing. The morning lines use it to say "would be the
// fifth Magic player since 1993-94 with 30+ in four straight" (src/anticipate/prep.js, streakLines).
//
//   NODE_USE_ENV_PROXY=1 node tools/build-feat-runs.mjs --boards <dir of ls-YYYY-MM-DD.json scoreboards> --dir <cache of p-<id>.json>
//        [--no-fetch] [--through 2025-26] [--out src/data/player-feat-runs-2026-27.json.gz]
//
// What is trusted: a game counts only when each team's player points add up to the score on ESPN's scoreboard. A game
// that does not (or has no player lines) is "unknown" for both teams: it ends a run in `runs` (the certain count), and
// `maybe` holds what a run could have been had the player done the feat that night (the upper bound). A line is said
// only when the upper bound cannot change it. Runs are within one season and one franchise, as the morning lines count.
// Regular season only. Seattle is Oklahoma City's history, Vancouver Memphis', New Jersey Brooklyn's; Charlotte's
// 1988-2002 Hornets are Charlotte's and New Orleans starts in 2002-03, as the league files them.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const BOARDS = arg("--boards"), DIR = arg("--dir"), NOFETCH = process.argv.includes("--no-fetch");
const THROUGH = arg("--through", "2025-26"), OUT = arg("--out", "src/data/player-feat-runs-2026-27.json.gz");
if (!BOARDS || !DIR) { console.error("usage: build-feat-runs.mjs --boards <dir> --dir <cache> [--no-fetch] [--through 2025-26] [--out file]"); process.exit(1); }

const ALIAS = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", VAN: "MEM", SEA: "OKC", NJ: "BKN", NOK: "NOP", NOH: "NOP", PHO: "PHX", CHH: "CHA" }, tri = (a) => ALIAS[a] || a;
const seasonOf = (d) => { const y = +d.slice(0, 4), s = +d.slice(5, 7) >= 8 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}`; };
const td = (g) => [g.pts, g.reb, g.ast, g.stl, g.blk].filter((x) => x >= 10).length >= 3;
// The same feats, with the same keys, as FEATS in src/anticipate/prep.js (a test keeps the two lists equal).
export const FEATS = [["pts50", (g) => g.pts >= 50], ["pts40", (g) => g.pts >= 40], ["pts35", (g) => g.pts >= 35], ["pts30", (g) => g.pts >= 30], ["reb20", (g) => g.reb >= 20], ["reb15", (g) => g.reb >= 15],
  ["ast15", (g) => g.ast >= 15], ["ast12", (g) => g.ast >= 12], ["fg3m7", (g) => g.fg3m >= 7], ["fg3m5", (g) => g.fg3m >= 5], ["blk5", (g) => g.blk >= 5], ["td", td]];

// The NBA Cup's title game is filed by ESPN with the regular season, and the league does not count it in anyone's
// statistics (found in the self-audit of 0.106). The list is src/data/cup-finals.json.
const CUP = JSON.parse(fs.readFileSync(new URL("../src/data/cup-finals.json", import.meta.url), "utf8")).games;
const isCupFinal = (g) => CUP.some((c) => c[0] === g.d && ((c[1] === g.h && c[2] === g.a) || (c[1] === g.a && c[2] === g.h)));

// 1. The games, from the scoreboards.
const games = [];
for (const f of fs.readdirSync(BOARDS).filter((x) => /^ls-\d{4}-\d\d-\d\d\.json$/.test(x)).sort()) {
  const d = f.slice(3, 13);
  if (seasonOf(d) > THROUGH) continue;
  const seen = new Map();
  for (const e of JSON.parse(fs.readFileSync(path.join(BOARDS, f), "utf8")).events || []) {
    if (e.type !== 2) continue;
    const h = e.c.find((c) => c.ha === "home"), a = e.c.find((c) => c.ha === "away");
    if (!h?.a || !a?.a) continue;
    const g = { d, id: e.id, h: tri(h.a), a: tri(a.a), hs: h.s, as: a.s, ls: (h.ls || []).length };
    const k = `${g.h}|${g.a}`; // 1998-99: ESPN lists some games twice; the one with a line score is the real one
    if (!seen.has(k) || g.ls > seen.get(k).ls) seen.set(k, g);
  }
  games.push(...[...seen.values()].filter((g) => !isCupFinal(g)));
}

const counts = { games: games.length, trusted: 0, unknown: 0 };

// 2. Each game's player lines (fetched once, kept in --dir).
fs.mkdirSync(DIR, { recursive: true });
const num = (s) => (s == null || s === "" || s === "--" ? null : +String(s).split("-")[0]);
async function fetchOne(id) {
  for (let k = 0; k < 4; k++) {
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`, { headers: { "user-agent": "Mozilla/5.0 nba-command-center" } });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json(), out = [];
      for (const t of j.boxscore?.players || []) {
        const st = t.statistics?.[0]; if (!st) continue;
        const K = st.keys || st.names || [], ix = (re) => K.findIndex((x) => re.test(x));
        const I = { min: ix(/^minutes$/), pts: ix(/^points$/), reb: ix(/^rebounds$/), ast: ix(/^assists$/), stl: ix(/^steals$/), blk: ix(/^blocks$/), fg3: ix(/^threePoint/), fg: ix(/^fieldGoalsMade/), ft: ix(/^freeThrowsMade/) };
        const rows = [];
        for (const a of st.athletes || []) { if (!a.stats?.length) continue; const v = (k2) => (I[k2] < 0 ? null : num(a.stats[I[k2]])); rows.push([a.athlete?.id, a.athlete?.displayName, v("min"), v("pts"), v("reb"), v("ast"), v("stl"), v("blk"), v("fg3"), v("fg"), v("ft")]); }
        out.push({ t: t.team?.abbreviation, id: t.team?.id, p: rows });
      }
      fs.writeFileSync(path.join(DIR, `p-${id}.json`), JSON.stringify(out)); return;
    } catch { await new Promise((r) => setTimeout(r, 800 * (k + 1))); }
  }
}
if (!NOFETCH) {
  const todo = games.filter((g) => !fs.existsSync(path.join(DIR, `p-${g.id}.json`)));
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (next < todo.length) await fetchOne(todo[next++].id); }));
  if (todo.length) console.error(`fetched ${todo.length} box score(s)`);
}

// 2b. ESPN's box scores for every Bulls and Pelicans game from 2012-13 to 2017-18 list the players with every number
// zero, and the same nights are missing from each player's own game log on the site (tried 11/18/26: Tobias Harris'
// 2014-15 log has every game but his four against those two teams). Those team-seasons are `blind`: nothing is said about
// a franchise's history when it has one. The players listed on those nights are kept (`blindPlayers`), so it is known whose
// seasons are missing.
const boxOf = (g) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, `p-${g.id}.json`), "utf8")); } catch { return null; } };
const blindPlayers = {};

// 3. Each franchise-season's games in order: a player's line, or "unknown" for the whole team.
const bySeason = {}; // season -> tri -> [{ d, known, lines: Map(id -> line) }]
const names = {}, unknown = {};
for (const g of games) {
  const box = boxOf(g);
  if (box && box.length === 2 && box.every((t) => t.p.length >= 5 && t.p.every((p) => !p[3] && !p[4] && !p[5]))) {
    counts.zeroed = (counts.zeroed || 0) + 1;
    for (const t of box) for (const p of t.p) if (p[0]) { ((blindPlayers[tri(t.t)] ??= {})[seasonOf(g.d)] ??= {})[p[0]] = p[1]; }
  }
  const sides = {};
  if (box && box.length === 2) {
    for (const t of box) {
      const pts = t.p.reduce((s, p) => s + (p[3] || 0), 0);
      const side = pts === g.hs && pts !== g.as ? "h" : pts === g.as && pts !== g.hs ? "a" : tri(t.t) === g.h && pts === g.hs ? "h" : tri(t.t) === g.a && pts === g.as ? "a" : null;
      if (side && t.p.length >= 5) sides[side] = t;
    }
  }
  const ok = sides.h && sides.a && sides.h !== sides.a;
  ok ? counts.trusted++ : counts.unknown++;
  const s = seasonOf(g.d);
  for (const [side, team] of [["h", g.h], ["a", g.a]]) {
    const row = { d: g.d, known: !!ok, lines: new Map() };
    if (ok) for (const p of sides[side].p) {
      if (!p[0] || p[2] === 0 || (p[2] == null && !p[3] && !p[4] && !p[5])) continue; // did not play
      names[p[0]] = p[1];
      row.lines.set(p[0], { pts: p[3] || 0, reb: p[4] || 0, ast: p[5] || 0, stl: p[6] || 0, blk: p[7] || 0, fg3m: p[8] || 0 });
    } else ((unknown[team] ??= {})[s] ??= []).push(g.d);
    ((bySeason[s] ??= {})[team] ??= []).push(row);
  }
}

// 4. Runs. Certain: an unknown game ends a run. Upper bound: an unknown game counts as the feat for everyone on the team that season.
const runs = [], maybe = [];
for (const [season, teams] of Object.entries(bySeason)) for (const [team, list] of Object.entries(teams)) {
  list.sort((a, b) => a.d.localeCompare(b.d));
  const ids = new Set(list.flatMap((r) => [...r.lines.keys()]));
  const gaps = list.some((r) => !r.known);
  for (const id of ids) for (const [k, test] of FEATS) {
    // his games for the team, in order: true / false, or null for a night we cannot read
    const seq = [];
    for (const r of list) { if (!r.known) seq.push([null, r.d]); else if (r.lines.has(id)) seq.push([test(r.lines.get(id)), r.d]); }
    const walk = (wild, out) => {
      let n = 0, sure = 0, end = null;
      const close = () => { if (n >= 2 && (!wild || n > sure) && (wild ? sure >= 1 : true)) out.push([team, k, n, id, season, end]); n = 0; sure = 0; };
      for (const [v, d] of seq) { if (v === true || (wild && v === null)) { n++; if (v === true) { sure++; end = d; } } else close(); }
      close();
    };
    walk(false, runs);
    if (gaps) walk(true, maybe);
  }
}
// An upper-bound run is only worth keeping when it is longer than every certain run it covers (walk() already drops the rest).
const byN = (a, b) => b[2] - a[2] || a[5].localeCompare(b[5]);
runs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || byN(a, b));
maybe.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || byN(a, b));
// A team-season with fewer than half its games readable is blind (with half or more, every regular appears on a readable
// night, so the upper bound covers the rest).
const blind = {};
for (const [season, teams] of Object.entries(bySeason)) for (const [team, list] of Object.entries(teams)) if (list.length >= 20 && list.filter((r) => r.known).length < 0.5 * list.length) (blind[team] ??= []).push(season);
for (const t of Object.keys(blind)) blind[t].sort();
for (const t of Object.keys(blindPlayers)) { if (!blind[t]) delete blindPlayers[t]; else for (const s2 of Object.keys(blindPlayers[t])) if (!blind[t].includes(s2)) delete blindPlayers[t][s2]; }
const used = new Set([...runs, ...maybe].map((r) => r[3]));
const out = {
  source: "ESPN box scores (site.api.espn.com summary), regular season; built by tools/build-feat-runs.mjs",
  from: "1993-94", through: THROUGH, built: new Date().toISOString().slice(0, 10),
  note: "runs: [team, feat, games in a row, ESPN athlete id, season, date of the last one], two or more, within one season and one franchise; a game is used only when both teams' player points add up to the score. maybe: the same run counted as if he had done it on every night we could not read (an upper bound); a line is said only when no upper bound could change it. unknown: those nights by team and season. blind: team-seasons ESPN has no player numbers for (nothing is said about that franchise's history); blindPlayers: who was on those teams.",
  feats: FEATS.map((f) => f[0]), counts: { ...counts, runs: runs.length, maybe: maybe.length },
  columns: ["team", "feat", "n", "id", "season", "end"], runs, maybe, unknown, blind, blindPlayers,
  names: Object.fromEntries([...used].sort((a, b) => a - b).map((id) => [id, names[id]])),
};
fs.writeFileSync(OUT, zlib.gzipSync(JSON.stringify(out), { level: 9 }));
console.log(`${counts.games} games, ${counts.trusted} trusted, ${counts.unknown} unknown; ${runs.length} runs, ${maybe.length} upper-bound runs; ${Object.keys(out.names).length} players -> ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
