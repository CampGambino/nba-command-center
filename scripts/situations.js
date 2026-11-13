/**
 * Team situations for the site: records vs winning teams, in close games, when
 * trailing at half or after three, and so on, with league baselines.
 *
 *   node scripts/situations.js [--through YYYY-MM-DD] [--today YYYY-MM-DD]
 *
 * Results through yesterday (Eastern) are kept in history/results/ (a file per date), so later
 * runs only ask ESPN for new dates. Writes docs/data/situations.json, including
 * tonight's matchups.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ["--no-warnings", ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  process.exit(r.status ?? 1);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createEspn } = await import("../src/espn/client.js");
const { collectResults, allGames, loadStore, saveStore } = await import("../src/situations/results.js");
const { computeSituations } = await import("../src/situations/records.js");
const { clutchPlayerTotals, clutchTeamTotals } = await import("../src/situations/clutch.js");
const { playerGames, activeStreaks, teamStreaks, anomalies, careerHighs } = await import("../src/situations/trends.js");
const { teamGames, gameLeaders, seasonLeaders, shooting, LEAD_STATS, LINES } = await import("../src/situations/leaders.js");

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const etDay = (offset = 0) => new Date(Date.now() + offset * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const today = opt("--today") || etDay(0);
const through = opt("--through") || new Date(Date.parse(today) - 864e5).toISOString().slice(0, 10);

const espn = createEspn({ dataDir: path.join(root, "data") });
const storeDir = path.join(root, "history", "results");
const oldFile = path.join(root, "history", "results.json"); // single-file store before v0.14
let store = loadStore(storeDir, fs) ?? (fs.existsSync(oldFile) ? JSON.parse(fs.readFileSync(oldFile, "utf8")) : null);
const warnings = [];
const before = store ? Object.values(store.dates).filter((d) => d.complete).length : 0;
const seasonBefore = store?.season ?? null;
store = await collectResults({ espn, store, through, warnings });
if (seasonBefore && store.season && seasonBefore !== store.season) {
  // A new season: start the store over rather than mixing seasons.
  store = await collectResults({ espn, store: { season: store.season, dates: {} }, through, warnings });
}
const rows = allGames(store);
if (!rows.length) { console.error(`no results collected${warnings.length ? `: ${warnings[0]}` : ""}`); process.exit(1); }

const sit = computeSituations(rows, { through });
const sb = await espn.scoreboard(today);
const tonight = sb.ok ? sb.data.games.filter((g) => g.date === today && g.seasonType === 2).map((g) => ({ id: g.id, away: g.awayTri, home: g.homeTri, start: g.start })) : [];

saveStore(storeDir, store, fs);
if (fs.existsSync(oldFile)) fs.rmSync(oldFile);
const out = { generatedAt: new Date().toISOString(), season: store.season, today, ...sit, tonight, warnings };
fs.writeFileSync(path.join(root, "docs", "data", "situations.json"), JSON.stringify(out));
// Current teams (src/rosters/current.js): a traded player shows his new team in the league-wide lists
// (Clutch, 4th quarter, Streaks) from the day it's official, before he plays for it. ESPN's 30 rosters,
// with NBA.com's official transactions as the fallback for changes ESPN hasn't caught up to.
const coachTeams = {}; // tri -> head coach's name, from ESPN's rosters (for the coaching records)
const rosterChanges = await (async () => {
  const { currentTeams, readMoves, readEspnRoster, ESPN_ROSTER, MOVES_URL, NBA_TEAM_ID } = await import("../src/rosters/current.js");
  const TEAMS = Object.fromEntries(Object.values(NBA_TEAM_ID).map((t) => [t, true]));
  const season = store.season || Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 8 ? 1 : 0);
  const ESPN_CODE = { GSW: "GS", NYK: "NY", SAS: "SA", NOP: "NO", UTA: "UTAH", WAS: "WSH" };
  const last = {};
  for (const g of [...rows].filter((x) => x.pl).sort((x, y) => x.d.localeCompare(y.d))) {
    for (const [id, v] of Object.entries(g.pl)) last[id] = { name: (store.names || {})[id] || id, team: v[0] === 0 ? g.h : g.a, d: g.d };
  }
  const espn = {}, problems = [];
  await Promise.all(Object.keys(TEAMS).map(async (tri) => {
    try {
      const r = await fetch(ESPN_ROSTER(ESPN_CODE[tri] || tri), { signal: AbortSignal.timeout(15000) });
      if (r.ok) { const j = await r.json(); espn[tri] = readEspnRoster(j); const c = j.coach?.[0]; if (c) coachTeams[tri] = `${c.firstName} ${c.lastName}`; } else problems.push(`${tri} ${r.status}`);
    }
    catch (e) { problems.push(`${tri} ${e.name}`); }
  }));
  let moves = [], movesNote = "";
  try {
    const r = await fetch(MOVES_URL, { headers: { Referer: "https://www.nba.com/", Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
    if (r.ok) moves = readMoves(await r.json(), { since: `${season - 1}-07-01` }); else movesNote = `NBA.com moves ${r.status}`;
  } catch (e) { movesNote = `NBA.com moves: ${e.message}`; }
  // ESPN counts only if every roster was read (otherwise "not listed" could just mean "not read").
  const changes = currentTeams(last, Object.keys(espn).length === 30 ? espn : {}, moves);
  const named = Object.fromEntries(Object.entries(changes).map(([id, c]) => [id, { name: last[id].name, ...c }]));
  fs.writeFileSync(path.join(root, "docs", "data", "rosters.json"), JSON.stringify({ generatedAt: out.generatedAt, espnTeams: Object.keys(espn).length, moves: moves.length, problems: [...problems, movesNote].filter(Boolean), changes: named }));
  console.log(`current teams: ${Object.keys(espn).length}/30 ESPN rosters, ${moves.length} NBA.com moves this season; ${Object.keys(changes).length} players moved since their last game${problems.length || movesNote ? ` (${[...problems, movesNote].filter(Boolean).join("; ")})` : ""}`);
  return changes;
})();
/** A league-wide player line with his current team (and where he was, if moved). */
const nowTeam = (p) => { const c = rosterChanges[p.id]; return c ? { ...p, team: c.team || "FA", was: c.was, moved: c.since || null } : p; };
// Clutch-time player totals for the Clutch page.
const players = clutchPlayerTotals(rows, store.names || {}).map(nowTeam);
fs.writeFileSync(path.join(root, "docs", "data", "clutch-players.json"), JSON.stringify({ generatedAt: out.generatedAt, through, games: rows.filter((g) => g.cl).length, players, teams: clutchTeamTotals(rows, "cp") }));
// 4th-quarter player totals (same shape as clutch).
const q4 = clutchPlayerTotals(rows, store.names || {}, "q4").map(nowTeam);
fs.writeFileSync(path.join(root, "docs", "data", "q4-players.json"), JSON.stringify({ generatedAt: out.generatedAt, through, games: rows.filter((g) => g.q4).length, players: q4, teams: clutchTeamTotals(rows, "q4") }));
// Every player's game lines, one file per team, for "with / without a teammate"
// (computed in the browser). A file is rewritten only when that team has played.
const teamDir = path.join(root, "docs", "data", "teams");
fs.mkdirSync(teamDir, { recursive: true });
// Each game date's final injury report (history/injuries/<date>.json), fetched once: who was on each team's
// report that night. ESPN's box scores leave inactive players out, so this is how we know a player who
// hadn't debuted yet (or sat injured) was on the team for those games.
const injDir = path.join(root, "history", "injuries");
fs.mkdirSync(injDir, { recursive: true });
const injByDate = {};
{
  const { finalReportFor } = await import("../src/injuries/history.js");
  let pdfjs = null;
  const fetchPdf = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (!res || !res.ok) return null;
    pdfjs ??= await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()), verbosity: 0 }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) pages.push((await (await doc.getPage(p)).getTextContent()).items.map((it) => ({ x: it.transform[4], y: it.transform[5], str: it.str })));
    return pages;
  };
  const dates = [...new Set(rows.filter((g) => g.pl).map((g) => g.d))].sort();
  let fetched = 0, missing = 0;
  for (const d of dates) {
    const f = path.join(injDir, `${d}.json`);
    if (fs.existsSync(f)) { injByDate[d] = JSON.parse(fs.readFileSync(f, "utf8")); continue; }
    if (fetched >= 40) { missing++; continue; } // the rest on the next run
    try {
      const r = await finalReportFor(d, fetchPdf);
      fetched++;
      if (r) { fs.writeFileSync(f, JSON.stringify(r)); injByDate[d] = r; } else missing++;
    } catch (e) { missing++; warnings.push(`injury report ${d}: ${e.message}`); }
  }
  console.log(`injury reports by game date: ${Object.keys(injByDate).length} of ${dates.length} dates (${fetched} fetched now${missing ? `, ${missing} still missing` : ""})`);
}
const perTeam = {};
for (const g of rows) {
  if (!g.pl) continue;
  for (const [side, tri] of [[0, g.h], [1, g.a]]) {
    const pl = Object.fromEntries(Object.entries(g.pl).filter(([, v]) => v[0] === side).map(([id, v]) => [id, v.slice(1)]));
    (perTeam[tri] ??= []).push({ id: g.id, d: g.d, opp: side === 0 ? g.a : g.h, home: side === 0 && !g.n, pf: side === 0 ? g.hs : g.as, pa: side === 0 ? g.as : g.hs, pl });
  }
}
// Attach each game's injury-report listings for the team: inj: { id: "Out" | "Doubtful" | … }.
{
  const { listedIds } = await import("../src/injuries/history.js");
  const teamIds = Object.fromEntries(Object.entries(perTeam).map(([tri, games]) => [tri, new Set(games.flatMap((x) => Object.keys(x.pl)))]));
  const byDate = {};
  for (const [tri, games] of Object.entries(perTeam)) for (const g of games) {
    if (!injByDate[g.d]) continue; // no report for that night: unknown (no inj key)
    const L = (byDate[g.d] ??= listedIds(injByDate[g.d], store.names || {}, teamIds))[tri] || [];
    g.inj = Object.fromEntries(L.map((x) => [x.id, x.status])); // {} = report read, nobody listed
  }
}
const teamFiles = {};
for (const [tri, games] of Object.entries(perTeam)) {
  const ids = new Set(games.flatMap((x) => Object.keys(x.pl)));
  const names = Object.fromEntries([...ids].map((id) => [id, store.names?.[id] || id]));
  const text = JSON.stringify({ team: tri, through: games[games.length - 1].d, keys: ["starter", "min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "dreb", "pf", "pm"], names, games });
  const file = path.join(teamDir, `${tri}.json`);
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text);
  teamFiles[tri] = JSON.parse(text);
}
// National TV vs other games (src/situations/national.js; the season's national schedule from the Tip-Off Guide).
{
  const { nationalIndex, nationalSplits, perGame } = await import("../src/situations/national.js");
  const season = store.season || Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 8 ? 1 : 0); // the year the season ends
  const schedFile = path.join(root, "src", "data", `national-tv-${season - 1}-${String(season).slice(2)}.json`);
  if (fs.existsSync(schedFile)) {
    const sched = JSON.parse(fs.readFileSync(schedFile, "utf8"));
    const split = nationalSplits(teamFiles, nationalIndex(sched), { currentTeam: (id) => (rosterChanges[id] ? rosterChanges[id].team || "FA" : null) });
    const players = split.players.filter((p) => p.nat.gp >= 1 && p.nat.gp + p.other.gp >= 3)
      .map((p) => ({ id: p.id, name: p.name, team: p.team, nat: perGame(p.nat), other: perGame(p.other) }));
    const upcoming = sched.games.filter((g) => g.d >= today).slice(0, 14);
    const played = sched.games.filter((g) => g.d <= through).length;
    fs.writeFileSync(path.join(root, "docs", "data", "national.json"), JSON.stringify({ generatedAt: out.generatedAt, through, networks: sched.networks, source: sched.source, played, total: sched.games.length, upcoming, teams: split.teams, players }));
    console.log(`national TV: ${played} of ${sched.games.length} national games played; ${players.length} players with a national game`);
  } else console.log(`national TV: no schedule file for ${season - 1}-${String(season).slice(2)} (src/data/)`);
}
// Career leaderboards and records (src/records/guide.js): the Tip-Off Guide's totals through last season
// plus this season's box scores; what's within reach, with chances from src/anticipate/model.js.
{
  const { currentRecords, addChances, strictKey } = await import("../src/records/guide.js");
  const { makeSampler, simulate } = await import("../src/anticipate/model.js");
  const season = store.season || Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 8 ? 1 : 0);
  const guideFile = path.join(root, "src", "data", `tipoff-guide-${season - 1}-${String(season).slice(2)}.json`);
  if (fs.existsSync(guideFile)) {
    const guide = JSON.parse(fs.readFileSync(guideFile, "utf8"));
    const scorersFile = path.join(root, "src", "data", `nba-career-scorers-${season - 1}-${String(season).slice(2)}.json`);
    const scorers = fs.existsSync(scorersFile) ? JSON.parse(fs.readFileSync(scorersFile, "utf8")) : [];
    const coachesFile = path.join(root, "src", "data", `nba-coaches-${season - 1}-${String(season).slice(2)}.json`);
    const coachList = fs.existsSync(coachesFile) && Object.keys(coachTeams).length >= 25 ? JSON.parse(fs.readFileSync(coachesFile, "utf8")) : null;
    // The newest current career lists (src/data/career-leaders-<date>.json), if any.
    const curFile = fs.readdirSync(path.join(root, "src", "data")).filter((f) => /^career-leaders-\d{4}-\d\d-\d\d\.json$/.test(f)).sort().pop();
    const current = curFile ? JSON.parse(fs.readFileSync(path.join(root, "src", "data", curFile), "utf8")) : null;
    const streaksFile = path.join(root, "src", "data", `nba-franchise-streaks-${season - 1}-${String(season).slice(2)}.json`);
    const franchiseStreaks = fs.existsSync(streaksFile) ? JSON.parse(fs.readFileSync(streaksFile, "utf8")) : null;
    const rec = currentRecords({ guide, teamFiles, today, tonight, scorers, coachList, coachTeams: coachList ? coachTeams : null, current, franchiseStreaks });
    const tonightTeams = new Set((tonight || []).flatMap((g) => [g.home, g.away]));
    addChances(rec.items, teamFiles, { makeSampler, simulate, tonightTeams });
    // NBA Cup career lists (src/records/cup.js): the Cup media guide's leaders plus this season's Cup games.
    let cupOut = null;
    const cupFile = path.join(root, "src", "data", `nba-cup-${season - 1}-${String(season).slice(2)}.json`);
    if (fs.existsSync(cupFile)) {
      const { cupRecords, cupOnly } = await import("../src/records/cup.js");
      const cup = JSON.parse(fs.readFileSync(cupFile, "utf8"));
      const c = cupRecords({ cup, teamFiles, tonight, today });
      // Chances from his games this season (all of them: a Cup game is a regular game).
      addChances(c.items, teamFiles, { makeSampler, simulate, tonightTeams: new Set(c.tonight.flatMap((g) => [g.home, g.away])) });
      rec.items.push(...c.items);
      // Cup games vs the rest of the season, per player and team (src/records/cupform.js, moved from GameFlow in 0.57).
      const { cupVsSeason } = await import("../src/records/cupform.js");
      const vsSeason = cupVsSeason({ teamFiles, cup });
      console.log(`NBA Cup vs season: ${vsSeason.players.length} players with 2+ Cup games, ${vsSeason.teams.length} teams`);
      cupOut = { vsSeason, played: c.cupGamesPlayed, tonight: c.tonight, boards: Object.fromEntries(Object.entries(c.boards).map(([k, rows]) => [k, rows.slice(0, 25).map(({ name, team, live, now, base, rank, preRank }) => ({ name, team, live, now, base, rank: rank ?? null, preRank: preRank ?? null }))])),
        schedule: cup.group.filter((g) => g.d >= today).slice(0, 15), standings: c.standings, problems: c.problems };
      console.log(`NBA Cup: ${c.cupGamesPlayed} Cup games played this season, ${c.items.length} Cup marks within reach, ${c.tonight.length} Cup games tonight`);
    }
    // Franchise history (src/records/franchise.js): every player's totals with each franchise, from the NBA
    // Guide's year-by-year team pages, plus his games for that team this season.
    let franchiseOut = null;
    const fcFile = path.join(root, "src", "data", `nba-franchise-careers-${season - 1}-${String(season).slice(2)}.json`);
    if (fs.existsSync(fcFile)) {
      const { franchiseRecords } = await import("../src/records/franchise.js");
      const f = franchiseRecords({ careers: JSON.parse(fs.readFileSync(fcFile, "utf8")), teamFiles, tonight });
      addChances(f.items, teamFiles, { makeSampler, simulate, tonightTeams });
      // The Tip-Off Guide's franchise marks say the same thing: keep one of each (the history list's).
      const seen = new Set(f.items.map((i) => `${strictKey(i.who)}|${i.team}|${i.stat}|${i.target}`));
      rec.items = rec.items.filter((i) => i.kind !== "franchise" || !seen.has(`${strictKey(i.who)}|${i.team}|${i.stat}|${i.target}`));
      rec.items.push(...f.items);
      rec.problems.push(...f.problems);
      franchiseOut = f.boards;
      console.log(`franchise history: ${f.items.length} franchise marks within reach (${f.items.filter((i) => i.tonight).length} playing tonight)`);
    }
    // Each franchise's single-game records (29 team media guides), for NBA Live's live checks and the Records tab.
    let franchiseGameOut = null;
    const fgFile = path.join(root, "src", "data", `nba-franchise-single-game-${season - 1}-${String(season).slice(2)}.json`);
    if (fs.existsSync(fgFile)) franchiseGameOut = JSON.parse(fs.readFileSync(fgFile, "utf8"));
    // Franchise single-season records on pace (src/records/franchiseSeason.js).
    let seasonPaceOut = null;
    const fsFile = path.join(root, "src", "data", `nba-franchise-seasons-${season - 1}-${String(season).slice(2)}.json`);
    if (fs.existsSync(fsFile)) {
      const { seasonPace } = await import("../src/records/franchiseSeason.js");
      seasonPaceOut = seasonPace({ seasons: JSON.parse(fs.readFileSync(fsFile, "utf8")), teamFiles });
      console.log(`franchise season records: ${seasonPaceOut.length} on pace for a top-3 season (${seasonPaceOut.filter((x) => x.place === 1).length} for the record)`);
    }
    // Cross-check: the same totals in the teams' notes and ESPN's career stats (docs/data/watch.json).
    const checks = { same: 0, differ: [] };
    try {
      const watch = JSON.parse(fs.readFileSync(path.join(root, "docs", "data", "watch.json"), "utf8"));
      const byName = new Map(rec.players.filter((p) => p.id).map((p) => [strictKey(p.name), p]));
      const seen = new Set();
      for (const t of watch.teams || []) for (const i of t.items || []) {
        const p = byName.get(strictKey(i.player));
        if (!p || !p.totals[i.stat] || !(i.scope === "career" || i.scope === "nba") || i.current == null || i.reached || i.stale) continue;
        const k = `${p.name}|${i.stat}|${i.origin}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (p.totals[i.stat].now === i.current) checks.same++;
        else checks.differ.push({ player: p.name, stat: i.stat, ours: p.totals[i.stat].now, theirs: i.current, source: i.origin === "espn" ? "ESPN career" : `${t.team} notes (${t.notesDate})` });
      }
      // Franchise totals: the history lists against the notes' franchise figures (the player and the name ahead).
      if (franchiseOut) {
        checks.franchise = { same: 0, differ: [] };
        for (const t of watch.teams || []) for (const i of t.items || []) {
          if (i.scope !== "franchise" || i.current == null || i.reached || i.stale) continue;
          const b = franchiseOut[t.team]?.[i.stat] || [];
          const pairs = [[i.player, i.current, true], ...(i.passing?.player && i.passing.total != null ? [[i.passing.player, i.passing.total, false]] : [])];
          for (const [name, theirs, mustLive] of pairs) {
            const r = b.find((x) => strictKey(x.name) === strictKey(name) && (mustLive || !x.live));
            if (!r) continue;
            if (r.now === theirs) checks.franchise.same++;
            else checks.franchise.differ.push({ player: r.name, stat: i.stat, ours: r.now, theirs, source: `${t.team} notes (${t.notesDate})` });
          }
        }
      }
    } catch { /* no watch list yet */ }
    const boards = Object.fromEntries(Object.entries(rec.boards).map(([stat, rows]) => [stat, rows.slice(0, 40).map(({ name, team, live, now, base, rank, preRank }) => ({ name, team, live, now, base, rank: rank ?? null, preRank: preRank ?? null }))]));
    // Stat titles in context (src/records/titles.js), from the NBA Guide's yearly leaders.
    let titles = null, awards = {};
    const histFile = path.join(root, "src", "data", `nba-history-${season - 1}-${String(season).slice(2)}.json`);
    if (fs.existsSync(histFile)) {
      const history = JSON.parse(fs.readFileSync(histFile, "utf8"));
      const { titleRace } = await import("../src/records/titles.js");
      titles = titleRace({ history, teamFiles });
      // Award résumés for every name the page shows (players on the lists and items, coaches, title races).
      const { resumes } = await import("../src/records/awards.js");
      const { nameKey } = await import("../src/notes/names.js");
      const R = resumes(history);
      const names = new Set([...rec.items.map((i) => i.who), ...rec.items.map((i) => i.passing?.name).filter(Boolean).flatMap((n) => n.split(" and ")),
        ...Object.values(rec.boards).flatMap((rows) => rows.slice(0, 40).map((r) => r.name)), ...Object.values(coachTeams), ...(titles || []).flatMap((t) => t.rows.map((r) => r.name))]);
      for (const n of names) { const r = R.get(nameKey(n)); if (r) awards[n] = r; }
    }
    // This season against each player's career, season by season (src/records/yoy.js, the NBA Guide's year-by-year stats).
    let context = null;
    const csFile = path.join(root, "src", "data", `nba-career-seasons-${season - 1}-${String(season).slice(2)}.json`);
    if (fs.existsSync(csFile)) {
      const { careerContext } = await import("../src/records/yoy.js");
      context = careerContext({ seasons: JSON.parse(fs.readFileSync(csFile, "utf8")), teamFiles }).slice(0, 250);
      console.log(`career context: ${context.length} notes (e.g. ${context.find((c) => c.kind === "change")?.text || "none"})`);
    }
    // Outside confirmations (Basketball Reference pages the user checked) settle disagreements in the checks.
    let settledErrata = [];
    const vFile = path.join(root, "src", "data", "verified-totals.json");
    if (fs.existsSync(vFile)) {
      const { settleChecks, settleProblems } = await import("../src/records/verified.js");
      const verified = JSON.parse(fs.readFileSync(vFile, "utf8"));
      settleChecks(checks, verified, today);
      const s = settleProblems(rec.problems, rec.players, verified);
      rec.problems = s.problems; settledErrata = s.errata;
    }
    fs.writeFileSync(path.join(root, "docs", "data", "records.json"), JSON.stringify({ titles, awards, context,
      generatedAt: out.generatedAt, through: rec.through, today, source: guide.source, items: rec.items, boards, checks, problems: rec.problems, errata: [...(guide.errata || []), ...settledErrata],
      coaches: coachTeams, teamRecords: guide.teamRecords, cup: cupOut, franchise: franchiseOut, seasonPace: seasonPaceOut, franchiseGame: franchiseGameOut,
    }));
    console.log(`records: ${rec.players.filter((p) => p.id).length} guide players playing this season, ${rec.items.length} within reach (${rec.items.filter((i) => i.tonight).length} playing tonight); vs notes/ESPN: ${checks.same} agree, ${checks.differ.length} differ${rec.problems.length ? `; ${rec.problems.length} problems` : ""}`);
  } else console.log(`records: no Tip-Off Guide file for ${season - 1}-${String(season).slice(2)} (src/data/)`);
}
// Streaks and anomalies: active streaks, team streaks, unusual games on each of the last 7 game dates.
{
  const pg = playerGames(rows);
  const dates = [...new Set(rows.filter((g) => g.pl).map((g) => g.d))].sort().slice(-7);
  // Career highs before this season (the 2016-17 on back-fill, and the NBA Guide's yearly points highs).
  let careers = null;
  try {
    const zlib = await import("node:zlib");
    const { strictKey } = await import("../src/records/guide.js");
    const ends = store.season || Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 8 ? 1 : 0);
    const tag = `${ends - 1}-${String(ends).slice(2)}`;
    const logFile = path.join(root, "src", "data", "player-logs-history.json.gz");
    const csFile = path.join(root, "src", "data", `nba-career-seasons-${tag}.json`);
    careers = careerHighs({ logs: fs.existsSync(logFile) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(logFile))) : null,
      seasons: fs.existsSync(csFile) ? JSON.parse(fs.readFileSync(csFile, "utf8")) : null, names: store.names || {}, ids: Object.keys(pg), season: tag, nameKey: strictKey });
  } catch (e) { console.error(`career highs not read: ${e.message}`); }
  const byDate = Object.fromEntries(dates.map((d) => [d, anomalies(pg, store.names || {}, { dates: [d], careers })]));
  const ch = Object.values(byDate).flat().filter((a) => a.notes.some((n) => n.careerHigh)).length;
  console.log(`outliers: ${Object.values(byDate).flat().length} over ${dates.length} dates, ${ch} with a career high`);
  fs.writeFileSync(path.join(root, "docs", "data", "trends.json"), JSON.stringify({ generatedAt: out.generatedAt, through, streaks: activeStreaks(pg, store.names || {}).map(nowTeam), teams: teamStreaks(rows), anomalies: byDate }));
  // Hot hand (src/situations/form.js, moved from GameFlow in 0.56): each player's game lines for the form section.
  try {
    const { formData } = await import("../src/situations/form.js");
    const F = formData(pg, store.names || {}, (id, last) => nowTeam({ id, team: last }).team);
    fs.writeFileSync(path.join(root, "docs", "data", "form.json"), JSON.stringify({ generatedAt: out.generatedAt, through, ...F }));
    console.log(`form: ${Object.keys(F.players).length} players with 8+ games`);
  } catch (e) { console.error(`form not written: ${e.message}`); }
}
// Team leaders: game-by-game leads, season-total leaders, and shooting lines (50 / 40 / 90).
{
  const names = store.names || {};
  const tg = teamGames(rows);
  const used = new Set();
  const nm = (id) => { used.add(id); return id; };
  // Compact rows: [id, team, stat, led, sole, played, teamGames, run]
  const gameKeys = ["id", "team", "stat", "led", "sole", "played", "teamGames", "run"];
  const games = gameLeaders(tg).map((r) => { nm(r.id); return gameKeys.map((k) => r[k]); });
  const season = Object.fromEntries(Object.entries(seasonLeaders(tg)).map(([team, t]) => {
    const keep = new Set(Object.values(t.leaders).flatMap((l) => l.ids));
    const totals = Object.fromEntries([...keep].map((id) => [nm(id), t.totals[id]]));
    return [team, { teamGames: t.teamGames, leaders: t.leaders, totals, categories: t.categories }];
  }));
  // Compact rows: [id, team, games, teamGames, then per line: made, attempts, qualified 0/1, minMakes]
  const shootKeys = ["id", "team", "games", "teamGames", ...LINES.flatMap((L) => [`${L.key}.m`, `${L.key}.a`, `${L.key}.q`, `${L.key}.min`])];
  const shoot = Object.values(shooting(rows)).filter((p) => p.fga >= 20 || p.fg3a >= 10 || p.fta >= 10)
    .map((p) => { nm(p.id); return [p.id, p.team, p.games, p.teamGames, ...LINES.flatMap((L) => [p[L.key].m, p[L.key].a, p[L.key].qualified ? 1 : 0, p[L.key].minMakes])]; });
  fs.writeFileSync(path.join(root, "docs", "data", "leaders.json"), JSON.stringify({
    generatedAt: out.generatedAt, through, stats: LEAD_STATS, lines: LINES.map(({ key, label, pct, qualMakes }) => ({ key, label, pct, qualMakes })),
    names: Object.fromEntries([...used].map((id) => [id, names[id] || id])), gameKeys, games, season, shootKeys, shooting: shoot,
  }));
}
// Injuries: the NBA's latest official injury report for tonight, and what each regular's absence
// means (team record and teammates with / without him). Read from the league's PDF, newest
// 15-minute slot first. If no report can be read, the last one written for tonight stays.
{
  const { slotsBackFrom, parseReport, isoDate } = await import("../src/injuries/report.js");
  const { injuryImpacts } = await import("../src/injuries/impact.js");
  const file = path.join(root, "docs", "data", "injuries.json");
  const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const etToday = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const [h, m] = today === etToday ? [etNow.getHours(), etNow.getMinutes()] : [23, 45];
  let report = null;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    for (const url of slotsBackFrom(today, h, m).slice(0, 64)) {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) }).catch(() => null);
      if (!res || !res.ok) continue;
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()), verbosity: 0 }).promise;
      const pages = [];
      for (let p = 1; p <= doc.numPages; p++) pages.push((await (await doc.getPage(p)).getTextContent()).items.map((it) => ({ x: it.transform[4], y: it.transform[5], str: it.str })));
      report = { url, ...parseReport(pages) };
      break;
    }
  } catch (e) { warnings.push(`injury report: ${e.message}`); }
  if (report && report.rows.length) {
    const files = Object.fromEntries(Object.entries(perTeam).map(([tri, games]) => {
      const ids = new Set(games.flatMap((x) => Object.keys(x.pl)));
      return [tri, { team: tri, names: Object.fromEntries([...ids].map((id) => [id, store.names?.[id] || id])), games }];
    }));
    // The report writes "11/02/2026" (zero-padded): compare as dates, not strings.
    const tonightRows = report.rows.filter((r) => isoDate(r.date) === today);
    const impact = injuryImpacts(report.rows, files, { date: today });
    fs.writeFileSync(file, JSON.stringify({ generatedAt: out.generatedAt, date: today, report: { url: report.url, asOf: report.asOf },
      players: tonightRows.map(({ team, name, status, reason, matchup, time }) => ({ team, name, status, reason, matchup, time })), impact }));
    console.log(`injury report ${report.asOf}: ${tonightRows.length} entries tonight, ${impact.length} regulars listed out/doubtful/questionable`);
  } else {
    const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    if (!old || old.date !== today) fs.writeFileSync(file, JSON.stringify({ generatedAt: out.generatedAt, date: today, report: null, players: [], impact: [] }));
    console.log(`injury report: none found for ${today}${old?.date === today ? " (kept the last one)" : ""}`);
  }
}
// Tonight's matchups (src/records/matchup.js, 0.48): what's active or lopsided between the two teams and for each regular
// against tonight's opponent, from the 2016-17 to 2025-26 back-fill plus this season's box scores.
{
  const histFile = path.join(root, "src", "data", "nba-results-history.json");
  const logFile = path.join(root, "src", "data", "player-logs-history.json.gz");
  try {
    const { matchups } = await import("../src/records/matchup.js");
    const zlib = await import("node:zlib");
    const history = fs.existsSync(histFile) ? JSON.parse(fs.readFileSync(histFile, "utf8")) : null;
    const logs = fs.existsSync(logFile) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(logFile))) : null;
    const m = matchups({ history, logs, teamFiles, tonight, today });
    fs.writeFileSync(path.join(root, "docs", "data", "matchups.json"), JSON.stringify({ generatedAt: out.generatedAt, today, window: history?.seasons || null, games: m.map((g) => ({ ...g, items: g.items.slice(0, 12) })) }));
    console.log(`matchups: ${m.reduce((a, g) => a + g.items.length, 0)} items for ${m.length} games tonight${history ? "" : " (no results back-fill yet)"}${logs ? "" : " (no player logs back-fill yet)"}`);
  } catch (e) { console.error(`matchups not written: ${e.message}`); }
}
// Rest and back-to-backs (src/situations/rest.js, moved from GameFlow in 0.55): teams, players, and tonight's rest.
{
  try {
    const { restData } = await import("../src/situations/rest.js");
    const R = restData({ games: rows.filter((g) => g.hb && g.ab), teamFiles, tonight, today });
    fs.writeFileSync(path.join(root, "docs", "data", "rest.json"), JSON.stringify({ generatedAt: out.generatedAt, through, ...R }));
    const b2b = R.tonight.flatMap((g) => [g.awayRest === 0 ? g.away : null, g.homeRest === 0 ? g.home : null]).filter(Boolean);
    console.log(`rest: ${R.b2bGames} team-games on zero rest; ${R.players.filter((p) => p.flag).length} players with a clear back-to-back split; tonight on a back-to-back: ${b2b.join(", ") || "none"}`);
  } catch (e) { console.error(`rest not written: ${e.message}`); }
}
// Tonight's storylines per game (the Watch List cards and NBA Live's pre-game cards read this),
// from the published Watch List plus the trends and leaders data written above.
{
  const { tonightStorylines } = await import("../src/anticipate/tonight.js");
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, "docs", "data", f), "utf8"));
  try {
    const watch = rd("watch.json");
    const injuries = fs.existsSync(path.join(root, "docs", "data", "injuries.json")) ? rd("injuries.json") : null;
    const facts = fs.existsSync(path.join(root, "docs", "data", "notes-facts.json")) ? rd("notes-facts.json") : null;
    const records = fs.existsSync(path.join(root, "docs", "data", "records.json")) ? rd("records.json") : null;
    const matchupData = fs.existsSync(path.join(root, "docs", "data", "matchups.json")) ? rd("matchups.json") : null;
    const games = tonightStorylines({ watch, trends: rd("trends.json"), leaders: rd("leaders.json"), injuries, facts, records, matchups: matchupData, national: (() => { try { return rd("national.json"); } catch { return null; } })(), rest: (() => { try { return rd("rest.json"); } catch { return null; } })(), form: (() => { try { return rd("form.json"); } catch { return null; } })(), fouls: (() => { try { return rd("flowstats.json"); } catch { return null; } })(), maxLines: 8 })
      .map((g) => ({ ...g, lines: g.lines.map(({ kind, team, text, score }) => ({ kind, team, text, score: Math.round(score * 100) / 100 })) }));
    fs.writeFileSync(path.join(root, "docs", "data", "tonight.json"), JSON.stringify({ generatedAt: out.generatedAt, today: watch.today, games }));
  } catch (e) { console.error(`tonight's storylines not written: ${e.message}`); }
}
// Per-game box totals for the "vs top teams" page, which computes in the browser.
const slim = rows.filter((g) => g.hb && g.ab).map(({ id, d, h, a, hs, as, hb, ab }) => ({ id, d, h, a, hs, as, hb, ab }));
fs.writeFileSync(path.join(root, "docs", "data", "games.json"), JSON.stringify({ generatedAt: out.generatedAt, through, games: slim }));
// The page's copy of the ratings code (kept identical to src; a test checks).
fs.mkdirSync(path.join(root, "docs", "lib", "situations"), { recursive: true });
for (const f of ["ratings.js", "withwithout.js", "leaders.js"]) fs.copyFileSync(path.join(root, "src", "situations", f), path.join(root, "docs", "lib", "situations", f));
// The record book and single-game lists (static reference data) for the Records page.
fs.mkdirSync(path.join(root, "docs", "ref"), { recursive: true });
for (const f of fs.readdirSync(path.join(root, "src", "data")).filter((f) => /^nba-(record-book|single-game-bests|postseason-careers)-/.test(f))) fs.copyFileSync(path.join(root, "src", "data", f), path.join(root, "docs", "ref", f.replace(/-\d{4}-\d\d\.json$/, ".json")));
fs.mkdirSync(path.join(root, "docs", "lib", "anticipate"), { recursive: true });
fs.copyFileSync(path.join(root, "src", "anticipate", "tonight.js"), path.join(root, "docs", "lib", "anticipate", "tonight.js"));
fs.mkdirSync(path.join(root, "docs", "lib", "espn"), { recursive: true });
for (const f of ["parse.js", "pbp.js"]) fs.copyFileSync(path.join(root, "src", "espn", f), path.join(root, "docs", "lib", "espn", f));
const after = Object.values(store.dates).filter((d) => d.complete).length;
const flags = Object.values(sit.teams).reduce((a, t) => a + t.flags.length, 0);
console.log(`situations through ${through}: ${rows.length} games (${after - before} new dates), ${Object.keys(sit.teams).length} teams, ${flags} flags, ${tonight.length} games tonight${warnings.length ? `; ${warnings.length} warnings` : ""}`);
