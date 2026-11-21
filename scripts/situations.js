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

// 0.87: the deep history is built for the streak watch and used again for the all-time series further down.
const deepShared = { deep: null, official: null, tried: false };
let lastTime = null;   // 0.89: { feats, watch } once the prep step has made them
// Built once, on first use (0.89: last night's "first since" lines need it before the streak watch does).
async function loadDeep() {
  if (deepShared.tried) return deepShared.deep;
  deepShared.tried = true;
  try {
    const zl = await import("node:zlib"); const { deepSeqs } = await import("../src/situations/deepseq.js");
    const sf = path.join(root, "src", "data", "nba-team-seasons-2026-27.json");
    deepShared.official = fs.existsSync(sf) ? JSON.parse(fs.readFileSync(sf, "utf8")).teams : null;
    const gz = (f) => { const p = path.join(root, "src", "data", f); return fs.existsSync(p) ? JSON.parse(zl.gunzipSync(fs.readFileSync(p))) : null; };
    const deep = deepSeqs({ older: gz("nba-results-older.json.gz"), guide: gz("guide-games-2026-27.json.gz"), official: deepShared.official });
    const fr = {}; for (const [t, s] of Object.entries(deep.from)) (fr[s] ??= []).push(t);
    console.log(`deep history: every team from ${deep.league}; further back: ${Object.entries(fr).filter(([s]) => s < deep.league).sort().map(([s, ts]) => `${ts.join(", ")} from ${s}`).join("; ") || "none"}`);
    deepShared.deep = deep;
  } catch (e) { console.error(`deep history not used: ${e.message}`); deepShared.deep = null; }
  return deepShared.deep;
}

if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ["--no-warnings", ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  process.exit(r.status ?? 1);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createEspn } = await import("../src/espn/client.js");
const { collectResults, allGames, loadStore, saveStore, recordCheck } = await import("../src/situations/results.js");
const { computeSituations } = await import("../src/situations/records.js");
const { clutchPlayerTotals, clutchTeamTotals } = await import("../src/situations/clutch.js");
const { playerGames, activeStreaks, teamStreaks, anomalies, careerHighs, careerHighsAllowed } = await import("../src/situations/trends.js");
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
// 0.141.5: tonight's NBA injury report, the newest posted one, read once here and used by the record chances and the
// injuries step below. Before, the record chances (which run first) used the copy the previous build saved: between
// the 5:30 PM and 12:15 AM builds, hours old.
let latestInj = null;
try {
  const { latestReport, reportClock } = await import("../src/injuries/report.js");
  const c = reportClock(today);
  latestInj = await latestReport(today, c.h, c.m);
} catch (e) { warnings.push(`injury report: ${e.message}`); }
const before = store ? Object.values(store.dates).filter((d) => d.complete).length : 0;
const seasonBefore = store?.season ?? null;
store = await collectResults({ espn, store, through, warnings });
if (seasonBefore && store.season && seasonBefore !== store.season) {
  // A new season: start the store over rather than mixing seasons.
  store = await collectResults({ espn, store: { season: store.season, dates: {} }, through, warnings });
}
// Stat corrections: recent games are re-read for a few days (src/situations/results.js RECHECK_DAYS).
if (store.corrected?.length) console.log(`stat corrections: ${store.corrected.length} recent game(s) changed on a re-read: ${store.corrected.join(", ")}`);
if (store.requartered?.length) console.log(`quarter scores: ${store.requartered.length} game(s) changed on a re-read: ${store.requartered.map((x) => `${x.d} ${x.a}@${x.h}`).join(", ")}`);
const rows = allGames(store);
if (!rows.length) { console.error(`no results collected${warnings.length ? `: ${warnings[0]}` : ""}`); process.exit(1); }

const sit = computeSituations(rows, { through });
const sb = await espn.scoreboard(today);
const tonight = sb.ok ? sb.data.games.filter((g) => g.date === today && g.seasonType === 2).map((g) => ({ id: g.id, away: g.awayTri, home: g.homeTri, start: g.start })) : [];
// 0.72: the results store against ESPN's own team records (a game lost on a bad read would otherwise go unnoticed).
try {
  const off = sb.ok ? recordCheck(rows, sb.data.games.filter((g) => g.date === today)) : [];
  for (const x of off) warnings.push(`results store: ${x.team} is ${x.espn} on ESPN but ${x.store} here (a game missing or extra; delete that date's file in history/results to re-read it)`);
  if (off.length) console.error(`results check: ${off.map((x) => `${x.team} ${x.espn} vs ${x.store}`).join(", ")}`);
} catch (e) { console.error(`results check skipped: ${e.message}`); }

saveStore(storeDir, store, fs);
if (fs.existsSync(oldFile)) fs.rmSync(oldFile);
const out = { generatedAt: new Date().toISOString(), season: store.season, today, ...sit, tonight, warnings };
fs.writeFileSync(path.join(root, "docs", "data", "situations.json"), JSON.stringify(out));
// Current teams (src/rosters/current.js): a traded player shows his new team in the league-wide lists
// (Clutch, 4th quarter, Streaks) from the day it's official, before he plays for it. ESPN's 30 rosters,
// with NBA.com's official transactions as the fallback for changes ESPN hasn't caught up to.
const coachTeams = {}; // tri -> head coach's name, from ESPN's rosters (for the coaching records)
const rosterPos = {}; // espn id -> ESPN's position label, from the same rosters (0.117: the odd lines' position rules)
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
      if (r.ok) { const j = await r.json(); espn[tri] = readEspnRoster(j); for (const p of espn[tri]) if (p.pos) rosterPos[p.id] = p.pos; const c = j.coach?.[0]; if (c) coachTeams[tri] = `${c.firstName} ${c.lastName}`; } else problems.push(`${tri} ${r.status}`);
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
  const { nationalIndex, nationalSplits, perGame, mergeNational, asAired } = await import("../src/situations/national.js");
  const season = store.season || Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 8 ? 1 : 0); // the year the season ends
  const schedFile = path.join(root, "src", "data", `national-tv-${season - 1}-${String(season).slice(2)}.json`);
  if (fs.existsSync(schedFile)) {
    const guide = JSON.parse(fs.readFileSync(schedFile, "utf8"));
    // 0.65: ESPN's national listings for today and the next 20 days confirm, add or drop the guide's games (flexes).
    const espnDays = {};
    for (let i = 0; i <= 20; i++) {
      const d = new Date(Date.parse(`${today}T12:00:00Z`) + i * 864e5).toISOString().slice(0, 10);
      try { const r = await espn.scoreboard(d); if (r.ok) espnDays[d] = r.data.games.filter((g) => g.date === d && g.awayTri && g.homeTri && (g.seasonType == null || g.seasonType === 2)).map((g) => ({ away: g.awayTri, home: g.homeTri, tv: g.tv || [] })); } catch {}
    }
    const seenFile = path.join(root, "history", "national-tv-seen.json");
    const seenOld = fs.existsSync(seenFile) ? JSON.parse(fs.readFileSync(seenFile, "utf8")) : {};
    const merged = mergeNational(guide, espnDays, seenOld, today);
    fs.mkdirSync(path.dirname(seenFile), { recursive: true });
    fs.writeFileSync(seenFile, JSON.stringify(merged.seen));
    const sched = { ...guide, games: asAired(merged).games };
    const flex = merged.games.filter((g) => g.status === "added" || g.status === "dropped" || g.status === "changed");
    console.log(`national TV: ESPN read for ${Object.keys(espnDays).length} days; ${merged.games.filter((g) => g.status === "confirmed").length} confirmed, ${flex.length} flexed (${flex.map((g) => `${g.d} ${g.away}@${g.home} ${g.status}`).join(", ") || "none"})`);
    const split = nationalSplits(teamFiles, nationalIndex(sched), { currentTeam: (id) => (rosterChanges[id] ? rosterChanges[id].team || "FA" : null) });
    const players = split.players.filter((p) => p.nat.gp >= 1 && p.nat.gp + p.other.gp >= 3)
      .map((p) => ({ id: p.id, name: p.name, team: p.team, nat: perGame(p.nat), other: perGame(p.other) }));
    // Every national game from today on (the guide's, as ESPN now lists them), with each one's status; the page shows
    // the next two weeks and counts the rest per team.
    const upcoming = merged.games.filter((g) => g.d >= today);
    const played = sched.games.filter((g) => g.d <= through).length;
    const espnThrough = Object.keys(espnDays).sort().pop() || null;
    fs.writeFileSync(path.join(root, "docs", "data", "national.json"), JSON.stringify({ generatedAt: out.generatedAt, through, networks: guide.networks, source: guide.source, played, total: sched.games.length, aired: split.aired, upcoming, espnThrough, flexed: merged.games.filter((g) => g.status === "added" || g.status === "dropped" || g.status === "changed"), teams: split.teams, players }));
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
    // 0.141.1: tonight's injury report caps the chance to play tonight: Out 0, Doubtful 25%, Questionable 60%. 0.141.5:
    // the newest report (latestInj, read at the top); the last saved one only if none could be read.
    const tonightStatus = {};
    try {
      const { tonightRowsOf } = await import("../src/injuries/report.js");
      const ij = path.join(root, "docs", "data", "injuries.json"), saved = fs.existsSync(ij) ? JSON.parse(fs.readFileSync(ij, "utf8")) : null;
      const rep = latestInj && !latestInj.none ? { date: today, players: tonightRowsOf(latestInj, today) } : saved;
      if (rep?.date === today && Array.isArray(rep.players)) {
        const { listedIds } = await import("../src/injuries/history.js");
        const teamIds = Object.fromEntries(Object.entries(teamFiles).map(([tri, f]) => [tri, new Set(Object.keys(f.names || {}))]));
        for (const L of Object.values(listedIds({ rows: rep.players }, store.names || {}, teamIds))) for (const x of L) tonightStatus[x.id] = x.status;
      }
    } catch (e) { warnings.push(`records: tonight's injury report not read (${e.message})`); }
    addChances(rec.items, teamFiles, { makeSampler, simulate, tonightTeams, tonightStatus });
    // NBA Cup career lists (src/records/cup.js): the Cup media guide's leaders plus this season's Cup games.
    let cupOut = null;
    const cupFile = path.join(root, "src", "data", `nba-cup-${season - 1}-${String(season).slice(2)}.json`);
    if (fs.existsSync(cupFile)) {
      const { cupRecords, cupOnly } = await import("../src/records/cup.js");
      const cup = JSON.parse(fs.readFileSync(cupFile, "utf8"));
      const c = cupRecords({ cup, teamFiles, tonight, today });
      // Chances from his games this season (all of them: a Cup game is a regular game).
      addChances(c.items, teamFiles, { makeSampler, simulate, tonightTeams: new Set(c.tonight.flatMap((g) => [g.home, g.away])), tonightStatus });
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
      addChances(f.items, teamFiles, { makeSampler, simulate, tonightTeams, tonightStatus });
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
      context = careerContext({ seasons: JSON.parse(fs.readFileSync(csFile, "utf8")), teamFiles }).slice(0, 400);
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
    // 0.64: every pass (all-time, franchise history, NBA Cup) to a place not worth saying is flagged for the pages.
    { const { isMinorPass } = await import("../src/records/notable.js"); for (const i of rec.items) if (isMinorPass(i)) i.minor = true; }
    const recordsOut = { titles, awards, context,
      generatedAt: out.generatedAt, through: rec.through, today, source: guide.source, items: rec.items, boards, checks, problems: rec.problems, errata: [...(guide.errata || []), ...settledErrata],
      coaches: coachTeams, teamRecords: guide.teamRecords, cup: cupOut, franchise: franchiseOut, seasonPace: seasonPaceOut, franchiseGame: franchiseGameOut,
    };
    // 0.140: every chance tonight in the records (all-time and franchise passes, NBA Cup lists, season pace) is the same
    // simulation as a milestone's, so it gets the same recalibration (src/anticipate/calibrate.js); the raw one is kept.
    try {
      const { fitCalibration, readCalls, calibrate, PLAY_ONLY } = await import("../src/anticipate/calibrate.js");
      const cf = path.join(root, "history", "calls.jsonl"), fit = fitCalibration(readCalls(fs.existsSync(cf) ? fs.readFileSync(cf, "utf8") : ""));
      let n = 0;
      const walk = (o) => { if (!o || typeof o !== "object") return; if (Array.isArray(o)) { for (const x of o) walk(x); return; }
        if (typeof o.pTonight === "number" && !("pTonightRaw" in o) && !PLAY_ONLY.has(o.stat)) { o.pTonightRaw = o.pTonight; o.pTonight = calibrate(o.pTonight, fit); n++; }
        for (const v of Object.values(o)) walk(v); };
      if (fit) { walk(recordsOut); console.log(`records: ${n} chances tonight recalibrated`); }
    } catch (e) { console.error(`record chances not recalibrated: ${e.message}`); }
    fs.writeFileSync(path.join(root, "docs", "data", "records.json"), JSON.stringify(recordsOut));
    console.log(`records: ${rec.players.filter((p) => p.id).length} guide players playing this season, ${rec.items.length} within reach (${rec.items.filter((i) => i.tonight).length} playing tonight); vs notes/ESPN: ${checks.same} agree, ${checks.differ.length} differ${rec.problems.length ? `; ${rec.problems.length} problems` : ""}`);
  } else console.log(`records: no Tip-Off Guide file for ${season - 1}-${String(season).slice(2)} (src/data/)`);
}
// Streaks and anomalies: active streaks, team streaks, unusual games on each of the last 7 game dates.
{
  const pg = playerGames(rows);
  const dates = [...new Set(rows.filter((g) => g.pl).map((g) => g.d))].sort().slice(-7);
  // Career highs before this season (the 2016-17 on back-fill, and the NBA Guide's yearly points highs).
  let careers = null, logsData = null, logsFull = null, seasonsData = null, seasonTag = null, keyFn = (n) => n, awardsData = null;
  let shiftAll = null;   // 0.121: every player's shifts, found once for the Watch List lines and the Shifts table
  try {
    const zlib = await import("node:zlib");
    const { strictKey } = await import("../src/records/guide.js");
    keyFn = strictKey;
    const ends = store.season || Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 8 ? 1 : 0);
    const tag = `${ends - 1}-${String(ends).slice(2)}`;
    seasonTag = tag;
    const logFile = path.join(root, "src", "data", "player-logs-history.json.gz");
    const csFile = path.join(root, "src", "data", `nba-career-seasons-${tag}.json`);
    logsData = fs.existsSync(logFile) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(logFile))) : null;
    // 0.110: the Bulls and Pelicans games of 2016-17 and 2017-18, which ESPN's logs lack, for the readers that may use them
    const fillFile = path.join(root, "src", "data", "player-logs-fill.json.gz"), { withFill } = await import("../src/situations/logfill.js");
    logsFull = logsData && fs.existsSync(fillFile) ? withFill(logsData, JSON.parse(zlib.gunzipSync(fs.readFileSync(fillFile)))) : logsData;
    seasonsData = fs.existsSync(csFile) ? JSON.parse(fs.readFileSync(csFile, "utf8")) : null;
    careers = careerHighs({ logs: logsFull, seasons: seasonsData, names: store.names || {}, ids: Object.keys(pg), season: tag, nameKey: strictKey });
  } catch (e) { console.error(`career highs not read: ${e.message}`); }
  // Prep stats (0.66): season vs career, spans, player streak watch, vs tonight's opponent, through N games.
  let featRuns = null, teamNicks = null;
  try {
    const { prepLines } = await import("../src/anticipate/prep.js");
    const wf = path.join(root, "docs", "data", "watch.json");
    const w = fs.existsSync(wf) ? JSON.parse(fs.readFileSync(wf, "utf8")) : { games: [] };
    const slate = (w.today === today ? w.games : []).map((g) => ({ away: g.awayTri, home: g.homeTri }));
    // 0.106: every player's runs by franchise since 1993-94, so a streak line can say where a run stands in his team's history.
    try {
      const rf = path.join(root, "src", "data", "player-feat-runs-2026-27.json.gz");
      const zlib = await import("node:zlib");
      if (fs.existsSync(rf)) { featRuns = JSON.parse(zlib.gunzipSync(fs.readFileSync(rf))); const { TEAMS: T } = await import("../src/teams.js"); teamNicks = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, v.nick])); }
    } catch (e) { console.error(`franchise runs not read: ${e.message}`); }
    const prep = prepLines({ pg, rows, logs: logsData, seasons: seasonsData, names: store.names || {}, nameKey: keyFn, season: seasonTag, games: slate, runs: featRuns, nicks: teamNicks });
    // Season-long and morning-after lines (0.70): trades, starter/bench, vs MVP season, lineups, record turns, best
    // since Christmas, who has beaten the best teams, month ratings and totals, rookies, last night's unique lines.
    let lastNight = [], zeros = {};
    lastTime = null;
    try {
      const { seasonLongLines } = await import("../src/anticipate/seasonlong.js");
      const hf2 = path.join(root, "src", "data", `nba-history-${seasonTag}.json`);
      awardsData = fs.existsSync(hf2) ? JSON.parse(fs.readFileSync(hf2, "utf8")).awards : null;
      const brf = path.join(root, "src", "data", "brothers.json"), brothers = fs.existsSync(brf) ? JSON.parse(fs.readFileSync(brf, "utf8")) : null;
      const sl = seasonLongLines({ pg, rows, logs: logsData, seasons: seasonsData, awards: awardsData, names: store.names || {}, nameKey: keyFn, season: seasonTag, slate, today, brothers, fullLogs: logsFull });
      const yday = new Date(Date.parse(`${today}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
      lastNight = sl.lines.filter((l) => l.kind === "unique" && l.date >= yday).sort((a, b) => b.score - a.score);
      // 0.82: a first career game without a point, a rebound or an assist (the user, 11/16: Trae Young's first scoreless
      // game in 512). Last night's go to "From last night"; the players who have never had one go to NBA Live.
      try {
        const { zeroCareers, zeroWatch, zeroLines } = await import("../src/anticipate/zeros.js");
        const { plainName } = await import("../src/anticipate/finder.js");
        const pcf = path.join(root, "src", "data", `nba-postseason-careers-${seasonTag}.json`);
        const allStar = fs.existsSync(pcf) ? Object.fromEntries((JSON.parse(fs.readFileSync(pcf, "utf8")).allStarSelections || []).map((x) => [plainName(x.name), x.selections])) : null;
        const zargs = { pg, logs: logsFull || logsData, seasons: seasonsData, names: store.names || {}, nameKey: keyFn };
        const zl = zeroLines({ pg, careersBefore: zeroCareers({ ...zargs, before: yday }), since: yday, allStar, plainName });
        lastNight = [...zl, ...lastNight].sort((a, b) => b.score - a.score);
        zeros = zeroWatch(zeroCareers(zargs), new Set(slate.flatMap((g) => [g.away, g.home])));
        console.log(`firsts: ${zl.length} first game(s) without a point, rebound or assist last night; ${Object.keys(zeros).length} of tonight's players have never had one`);
      } catch (e) { prep.errors.push(`zeros: ${e.message}`); }
      // 0.89: "the first since…": the guides' last-time pages (three teams) counted forward, and every team's points
      // and margins from its own games. Last night's go to "From last night"; the rest feeds NBA Live and the Index.
      try {
        const { advance, scoreFeats, firstSince, watchList } = await import("../src/records/lasttime.js");
        const ltf = path.join(root, "src", "data", `last-time-${seasonTag}.json`), rhf = path.join(root, "src", "data", "nba-results-history.json");
        const feats = [...(fs.existsSync(ltf) ? advance(JSON.parse(fs.readFileSync(ltf, "utf8")), rows, store.names || {}) : []),
          ...scoreFeats({ deep: await loadDeep(), history: fs.existsSync(rhf) ? JSON.parse(fs.readFileSync(rhf, "utf8")) : null, rows })];
        // 0.90: each team's single-game marks from the same games (most and fewest points, largest win and loss).
        // 0.93: where a guide prints the mark (19 guides), the print is the mark through last season; the box-score marks
        // (rebounds, threes, a quarter's points, an opponent's) come from the same file.
        const { teamGameRecords, recordLines, boxRecordLines, boxTable, leagueRecordLines, withLeagueFirst, liveTeamMarks } = await import("../src/records/teamgame.js");
        // 0.107.9: an NBA record comes before a franchise one (the league's record book; a franchise line for the same mark folds into it)
        const lbf = path.join(root, "src", "data", `nba-record-book-${seasonTag}.json`), leagueBook = fs.existsSync(lbf) ? JSON.parse(fs.readFileSync(lbf, "utf8")) : null;
        const tgf = path.join(root, "src", "data", `team-game-records-${seasonTag}.json`), printed = fs.existsSync(tgf) ? JSON.parse(fs.readFileSync(tgf, "utf8")) : null;
        const teamGame = teamGameRecords({ deep: await loadDeep(), history: fs.existsSync(rhf) ? JSON.parse(fs.readFileSync(rhf, "utf8")) : null, rows, printed });
        const bl = printed ? boxRecordLines(printed, rows, yday, today) : [];
        const rl = withLeagueFirst(leagueBook ? leagueRecordLines({ book: leagueBook, rows, since: yday, today }) : [], [...bl, ...recordLines(teamGame, yday, today)]), setNow = new Set(rl.map((l) => `${l.team}|${l.date}`));
        // A team mark says it all: the "first since" line for the same team and night is dropped.
        const fl = firstSince(feats, yday, today).filter((l) => l.player || !setNow.has(`${l.team}|${l.date}`));
        lastNight = [...rl, ...fl, ...lastNight].sort((a, b) => b.score - a.score);
        lastTime = { feats, watch: watchList(feats, [...new Set(slate.flatMap((g) => [g.away, g.home]))], today) };
        fs.writeFileSync(path.join(root, "docs", "data", "lasttime.json"), JSON.stringify({ generatedAt: out.generatedAt, through, teamGame, teamBox: printed ? boxTable(printed) : [], teamBoxSeason: withLeagueFirst(leagueBook ? leagueRecordLines({ book: leagueBook, rows, since: `${Number(seasonTag.slice(0, 4))}-08-01`, today }) : [], [...(printed ? boxRecordLines(printed, rows, `${Number(seasonTag.slice(0, 4))}-08-01`, today) : []), ...recordLines(teamGame, `${Number(seasonTag.slice(0, 4))}-08-01`, today)]).sort((a, b) => (a.date < b.date ? 1 : -1)).map((l) => ({ date: l.date, team: l.team, text: l.text })), feats: feats.filter((f) => f.last), season: firstSince(feats, `${Number(seasonTag.slice(0, 4))}-08-01`, today).map((l) => ({ date: l.date, team: l.team, text: l.text })) }));
        // 0.109.0: the same marks for NBA Live's card (bridge v24), as they stand this morning, each with what backs its number
        if (printed) {
          const msf = path.join(root, "src", "data", "team-marks-sources.json"), tm = liveTeamMarks({ printed, rows, today, sources: fs.existsSync(msf) ? JSON.parse(fs.readFileSync(msf, "utf8")) : null, book: leagueBook });
          fs.writeFileSync(path.join(root, "docs", "data", "teammarks.json"), JSON.stringify({ generatedAt: out.generatedAt, ...tm }));
          const all = Object.values(tm.teams).flatMap((t) => t.m);
          console.log(`team marks for NBA Live: ${all.length} whole-game marks for ${Object.keys(tm.teams).length} teams, ${all.filter((m) => m.ok).length} with a second source for the number; ${Object.keys(tm.league).length} league marks`);
        }
        console.log(`last time: ${feats.length} feats on file; ${fl.length} first-since line(s) from last night`);
      } catch (e) { console.error(`last-time lines not made: ${e.message}`); }
      prep.lines.push(...sl.lines.filter((l) => l.kind !== "unique"));
      prep.errors.push(...sl.errors);
    } catch (e) { prep.errors.push(`season-long: ${e.message}`); }
    // 0.72.7: a quarter far out of line with a team's other three, and tonight's opponent in that quarter.
    try { const { quarterLines } = await import("../src/situations/quarters.js"); prep.lines.push(...quarterLines(rows, slate)); } catch (e) { prep.errors.push(`quarters: ${e.message}`); }
    // 0.141 (audit step 5): luck (record vs point differential; shooting vs his career), paradox (30-point games his
    // team loses), scarcity ("one of 2 teams unbeaten on the road"), what a defense gives up to one position.
    try {
      const { detectorLines } = await import("../src/anticipate/detectors.js"), { posGroup } = await import("../src/situations/oddlines.js");
      const dl = detectorLines({ rows, pg, names: store.names || {}, seasons: seasonsData, nameKey: keyFn, positions: rosterPos, posGroup, slate, errors: prep.errors });
      prep.lines.push(...dl);
      const c = {}; for (const l of dl) c[l.kind] = (c[l.kind] || 0) + 1;
      console.log(`detectors: ${dl.length} lines (${Object.entries(c).map(([k, n]) => `${n} ${k}`).join(", ")})`);
    } catch (e) { prep.errors.push(`detectors: ${e.message}`); }
    // 0.80: standings with magic and elimination numbers; a line once a team's number is within five.
    try {
      const { standings, clinchLines } = await import("../src/situations/standings.js");
      const st = standings(rows.filter((g) => g.d < today));
      fs.writeFileSync(path.join(root, "docs", "data", "standings.json"), JSON.stringify({ generatedAt: out.generatedAt, through, ...st }));
      const tonightTeams = new Set(slate.flatMap((g) => [g.away, g.home]));
      prep.lines.push(...clinchLines(st, tonightTeams));
      // 0.80: every franchise's season records since 1946-47 (the NBA Guide): record since a season, pace against its own history.
      const tsf = path.join(root, "src", "data", `nba-team-seasons-${seasonTag}.json`);
      if (fs.existsSync(tsf)) {
        const { teamSeasonLines } = await import("../src/situations/teamseasons.js");
        prep.lines.push(...teamSeasonLines(JSON.parse(fs.readFileSync(tsf, "utf8")), st, tonightTeams, { season: +seasonTag.slice(0, 4) }));
      }
      // 0.91: points for and against a game by season, from each team's own games (and the Knicks' printed table
      // before theirs start): the most or fewest a team has scored or allowed in 15 seasons or more.
      try {
        const { scoringBySeason, scoringLines } = await import("../src/situations/teamscoring.js");
        const rhf = path.join(root, "src", "data", "nba-results-history.json"), kf = path.join(root, "src", "data", `knicks-team-seasons-${seasonTag}.json`);
        const printed = fs.existsSync(kf) ? { NYK: { ...JSON.parse(fs.readFileSync(kf, "utf8")), whole: true } } : null;
        const scoring = scoringBySeason({ deep: await loadDeep(), history: fs.existsSync(rhf) ? JSON.parse(fs.readFileSync(rhf, "utf8")) : null, rows: rows.filter((g) => g.d < today), printed });
        const sl2 = scoringLines(scoring, [...tonightTeams], { season: seasonTag });
        prep.lines.push(...sl2);
        fs.writeFileSync(path.join(root, "docs", "data", "teamscoring.json"), JSON.stringify({ generatedAt: out.generatedAt, through, teams: Object.fromEntries(Object.entries(scoring).map(([t, v]) => [t, { from: v.from, whole: v.whole, seasons: v.seasons.map((x) => [x.season, x.g, Math.round(x.ppg * 10) / 10, Math.round(x.opp * 10) / 10]) }])) }));
        console.log(`team scoring by season: ${sl2.length} line(s) for tonight's teams`);
      } catch (e) { prep.errors.push(`team scoring: ${e.message}`); }
    } catch (e) { prep.errors.push(`standings: ${e.message}`); }
    // 0.81: the finder: every player's season cut several ways, kept only where a cut is far out of line with the
    // league. Tonight's teams' findings are candidates; the league's most out-of-line few go to the page as suggestions.
    let finds = [];
    try {
      const { finderLines } = await import("../src/anticipate/finder.js");
      const ff = path.join(root, "docs", "data", "flowstats.json");
      const qsum = fs.existsSync(ff) ? JSON.parse(fs.readFileSync(ff, "utf8")).qsum || {} : {};
      const teamGp = {};
      for (const g of rows) { teamGp[g.h] = (teamGp[g.h] || 0) + 1; teamGp[g.a] = (teamGp[g.a] || 0) + 1; }
      // All-Star selections through last season's game (the NBA Guide), for "has never been an All-Star".
      let allStars = null;
      try { const { plainName } = await import("../src/anticipate/finder.js"); const pc = path.join(root, "src", "data", `nba-postseason-careers-${seasonTag}.json`);
        if (fs.existsSync(pc)) allStars = new Set((JSON.parse(fs.readFileSync(pc, "utf8")).allStarSelections || []).map((x) => plainName(x.name))); } catch { /* no list: that test is skipped */ }
      // 0.94: who has led the league before (the NBA Guide's yearly leaders), and who is a rookie (no game logs before this
      // season and no career line in the guide): a leader's line says what is new about him, and a rookie is never "not an All-Star".
      let leaders = null, rookies = null;
      try { const hf2 = path.join(root, "src", "data", `nba-history-${seasonTag}.json`); if (fs.existsSync(hf2)) leaders = JSON.parse(fs.readFileSync(hf2, "utf8")).leaders || null; } catch { /* the leader line is skipped */ }
      try { const careers = new Set(Object.keys(seasonsData?.players || {}).map(keyFn)); rookies = new Set(Object.keys(pg).filter((id) => store.names?.[id] && !(logsData?.players?.[id] || []).length && !careers.has(keyFn(store.names[id])))); } catch { /* no rookie list: nobody is treated as one */ }
      const F = finderLines({ pg, names: store.names || {}, qsum, teamGp, allStars, leaders, rookies, rows: rows.filter((g) => !g.cupFinal) }, new Set(slate.flatMap((g) => [g.away, g.home])), { top: 24 });
      prep.lines.push(...F.lines);
      // 0.121: the strongest shifts on tonight's teams (src/situations/shifts.js), so the Watch List carries them.
      try {
        const { allShifts, shiftStoryLines } = await import("../src/situations/shifts.js");
        shiftAll = allShifts(pg, store.names || {}, (id, last) => nowTeam({ id, team: last }).team);
        const SL = shiftStoryLines(shiftAll, new Set(slate.flatMap((g) => [g.away, g.home])));
        prep.lines.push(...SL);
        console.log(`shifts for the Watch List: ${SL.length} line(s) on tonight's teams`);
      } catch (e) { prep.errors.push(`shifts: ${e.message}`); }
      finds = F.league;
      console.log(`finder: ${F.n} finding(s) league-wide (${F.teamFinds} about teams), ${F.lines.length} about tonight's teams${Object.keys(qsum).length ? "" : " (no quarter scoring yet: the Game Flow step of the last build)"}`);
    } catch (e) { prep.errors.push(`finder: ${e.message}`); }
    const byKind = {};
    for (const l of prep.lines) byKind[l.kind] = (byKind[l.kind] || 0) + 1;
    console.log(`prep stats: ${prep.lines.length} lines (${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(", ")})${prep.errors.length ? `; errors: ${prep.errors.join("; ")}` : ""}`);
    fs.writeFileSync(path.join(root, "docs", "data", "prep.json"), JSON.stringify({ generatedAt: out.generatedAt, today, through, lines: prep.lines, stars: prep.stars, lastNight, finds, zeros }));
  } catch (e) { console.error(`prep stats not written: ${e.message}`); }
  // "Did we see it coming?" (0.67): the stats other accounts posted, against what we'd have said that morning.
  try {
    const { runChecks } = await import("../src/anticipate/flagcheck.js");
    const cf = path.join(root, "src", "data", "flag-checks.json");
    const hf = path.join(root, "src", "data", "nba-results-history.json");
    if (fs.existsSync(cf)) {
      const { flowStats } = await import("../src/gameflow/stats.js");
      const R = runChecks(JSON.parse(fs.readFileSync(cf, "utf8")).checks, { rows, logs: logsData, seasons: seasonsData, history: fs.existsSync(hf) ? JSON.parse(fs.readFileSync(hf, "utf8")) : null, names: store.names || {}, nameKey: keyFn, season: seasonTag, awards: awardsData, runs: featRuns, nicks: teamNicks,
        // 0.79: checks on lines made from the Game Flow files: this season's files as they stood before that morning.
        flowAt: (morning) => {
          const dir = path.join(root, "docs", "data", "flow", String(store.season));
          if (!fs.existsSync(dir)) return null;
          const byId = new Map(rows.map((r) => [String(r.id), r]));
          const entries = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).map((f) => ({ row: byId.get(f.replace(".json", "")), f })).filter((e) => e.row && e.row.d < morning)
            .map((e) => ({ row: e.row, c: JSON.parse(fs.readFileSync(path.join(dir, e.f), "utf8")) }));
          return flowStats(entries);
        } });
      fs.writeFileSync(path.join(root, "docs", "data", "flag-checks.json"), JSON.stringify({ generatedAt: out.generatedAt, ...R }));
      console.log(`flag checks: ${R.found} of ${R.total} seen coming${R.checks.filter((c) => c.found === false).length ? ` (missed: ${R.checks.filter((c) => c.found === false).map((c) => c.id).join(", ")})` : ""}`);
    }
  } catch (e) { console.error(`flag checks not run: ${e.message}`); }
  const byDate = Object.fromEntries(dates.map((d) => [d, anomalies(pg, store.names || {}, { dates: [d], careers })]));
  // Odd lines (0.117; the user, 11/19: "these are concepts worth tracking and flagging"): the shape of a line, graded by
  // how often it has happened in 33 seasons of box scores (src/data/odd-lines-history.json, tools/odd-games/build-history.mjs).
  let oddByDate = null, oddTally = null;
  try {
    const { oddNights } = await import("../src/situations/oddlines.js"), { LINE_IX } = await import("../src/situations/trends.js");
    const hf = path.join(root, "src", "data", "odd-lines-history.json"), history = fs.existsSync(hf) ? JSON.parse(fs.readFileSync(hf, "utf8")) : null;
    oddByDate = { from: history?.from || null, through: history?.through || null, games: history?.games || null, positions: Object.keys(rosterPos).length,
      nights: oddNights({ rows: rows.filter((g) => !g.cupFinal), history, names: store.names || {}, pos: rosterPos, dates, IX: LINE_IX }) };
    // 0.119: what the NBA Live bridge needs to judge a live line: each level's count (history plus this season), each
    // player's averages over his games so far (ODD.games or more), and ESPN's position labels. Rules: docs/lib/situations/oddlines.js.
    try {
      const { ODD } = await import("../src/situations/oddlines.js"), r2 = (v) => Math.round(v * 100) / 100, t = {}, avg = {};
      // Everything in this file is "before today": a game finished this afternoon must not count itself tonight.
      const before = rows.filter((g) => !g.cupFinal && g.d < today), pgBefore = playerGames(before);
      oddTally = {}; oddNights({ rows: before, history, names: store.names || {}, pos: rosterPos, dates: [], IX: LINE_IX, tally: oddTally });
      for (const [k, e] of Object.entries(history?.t || {})) {
        const mine = oddTally[k] || null, last = mine?.last || e.last?.[0] || null;
        t[k] = [e.n + (mine?.n || 0), Math.round((e.l5 / ODD.recent) * 10) / 10, last ? last[0] : null, last ? last[1] : null];
      }
      for (const [id, gs] of Object.entries(pgBefore)) { const n = gs.length; if (n >= ODD.games) avg[id] = [r2(gs.reduce((a, g) => a + g.pts, 0) / n), r2(gs.reduce((a, g) => a + g.reb, 0) / n), r2(gs.reduce((a, g) => a + g.ast, 0) / n), n]; }
      if (history) fs.writeFileSync(path.join(root, "docs", "data", "oddlive.json"), JSON.stringify({ v: 1, generatedAt: out.generatedAt, before: today, from: history.from, games: history.games, t, avg, pos: rosterPos }));
      console.log(`odd lines, live file: ${Object.keys(t).length} levels, averages for ${Object.keys(avg).length} players`);
    } catch (e) { console.error(`odd lines, live file: ${e.message}`); }
    // 0.118: tonight's watch lists: who on the slate is a game short of a rare run or repeat, and who tends to produce which line.
    try {
      const { oddWatch } = await import("../src/situations/oddlines.js");
      const wf = path.join(root, "docs", "data", "watch.json"), w = fs.existsSync(wf) ? JSON.parse(fs.readFileSync(wf, "utf8")) : { games: [] };
      const games = w.today === today ? w.games || [] : [], vs = {};
      for (const g of games) { vs[g.homeTri] = `vs ${g.awayTri}`; vs[g.awayTri] = `@ ${g.homeTri}`; }
      const pf = path.join(root, "src", "data", "odd-lines-players.json"), players = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, "utf8")) : null;
      if (games.length) {
        const W = oddWatch({ rows: rows.filter((g) => !g.cupFinal), history, players, names: store.names || {}, pos: rosterPos, teams: new Set(Object.keys(vs)), vs, IX: LINE_IX,
          teamNow: (id, t) => (rosterChanges[id] ? rosterChanges[id].team || "FA" : t) });
        oddByDate.tonight = { date: today, since: players?.since || null, runMin: history?.runMin || null, ...W };
        console.log(`odd lines to watch tonight: ${W.runs.length} run(s) or repeat(s) a game short, ${W.owners.length} player habit(s) on ${games.length} game(s)`);
      }
    } catch (e) { console.error(`odd lines, tonight: ${e.message}`); }
    const all = Object.values(oddByDate.nights).flat(), by = (g) => all.filter((o) => o.grade === g).length;
    console.log(`odd lines: ${all.length} over ${dates.length} dates (${by("rare")} rare, ${by("few")} a few a season, ${by("monthly")} monthly, ${by("common")} common); positions for ${Object.keys(rosterPos).length} players`);
  } catch (e) { console.error(`odd lines not run: ${e.message}`); }
  const ch = Object.values(byDate).flat().filter((a) => a.notes.some((n) => n.careerHigh)).length;
  console.log(`outliers: ${Object.values(byDate).flat().length} over ${dates.length} dates, ${ch} with a career high`);
  // Team streak watch (0.65): what tonight would make of each team's run, against the 2016-17 on history.
  let watchLines = [];
  try {
    const { streakWatch } = await import("../src/situations/streakwatch.js");
    const hf = path.join(root, "src", "data", "nba-results-history.json");
    // 0.86: each team's games before 2016-17, as far back as its seasons add up to the franchise's record.
    const deep = await loadDeep();
    watchLines = streakWatch({ history: fs.existsSync(hf) ? JSON.parse(fs.readFileSync(hf, "utf8")) : null, rows, today, deep });
    console.log(`team streak watch: ${watchLines.length} lines`);
  } catch (e) { console.error(`team streak watch: ${e.message}`); }
  fs.writeFileSync(path.join(root, "docs", "data", "trends.json"), JSON.stringify({ generatedAt: out.generatedAt, through, streaks: activeStreaks(pg, store.names || {}).map(nowTeam), teams: teamStreaks(rows), watch: watchLines, highsAllowed: careers ? careerHighsAllowed(pg, careers, store.names || {}) : null, anomalies: byDate, odd: oddByDate }));
  // Hot hand (src/situations/form.js, moved from GameFlow in 0.56): each player's game lines for the form section.
  try {
    const { formData } = await import("../src/situations/form.js");
    const F = formData(pg, store.names || {}, (id, last) => nowTeam({ id, team: last }).team);
    fs.writeFileSync(path.join(root, "docs", "data", "form.json"), JSON.stringify({ generatedAt: out.generatedAt, through, ...F }));
    console.log(`form: ${Object.keys(F.players).length} players with 8+ games`);
  } catch (e) { console.error(`form not written: ${e.message}`); }
  // Shifts (0.120; the user, 11/19: "shooting slumps or hot shooting stretches… player stats over a period of time to see how
  // stats are shifting"): each player's season in each stat cut where his numbers changed, the current stretch against the
  // one before, and how often a random order of the same games would show as much (src/situations/shifts.js).
  try {
    const { allShifts, pairsSearched, chanceCounts, SHIFT, SHIFT_STATS } = await import("../src/situations/shifts.js");
    const wf = path.join(root, "docs", "data", "watch.json"), w = fs.existsSync(wf) ? JSON.parse(fs.readFileSync(wf, "utf8")) : { games: [] };
    const tonight = w.today === today ? [...new Set((w.games || []).flatMap((g) => [g.homeTri, g.awayTri]))] : [];
    const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10), slim = (x) => ({ ...x, v: r1(x.v), min: r1(x.min) });
    const all = shiftAll || allShifts(pg, store.names || {}, (id, last) => nowTeam({ id, team: last }).team);
    const rowsS = all.filter((s) => s.odds >= SHIFT.keep).map((s) => ({ ...s, season: r1(s.season), now: slim(s.now), was: slim(s.was) }));
    fs.writeFileSync(path.join(root, "docs", "data", "shifts.json"), JSON.stringify({ generatedAt: out.generatedAt, through, today, tonight, pairs: pairsSearched(pg), shuffles: SHIFT.shuffles, found: all.length, chance: chanceCounts(pg),
      stats: SHIFT_STATS.map((t) => ({ k: t.k, label: t.label, kind: t.kind })), rows: rowsS }));
    console.log(`shifts: ${all.length} found in ${pairsSearched(pg)} player-and-stat pairs; ${rowsS.length} written (${rowsS.filter((s) => s.kind === "rate").length} shooting); 1 in 20 or rarer: ${rowsS.filter((s) => s.odds >= 20).length}`);
  } catch (e) { console.error(`shifts not written: ${e.message}`); }
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
const INJURY_LATE_MIN = 90; // a report in use this far behind the clock (afternoon on) is a warning in the build log and on the page
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
  // 0.141.5: read once at the start of this script (latestInj, the newest posted report), shared with the record chances.
  let report = latestInj && !latestInj.none ? latestInj : null;
  const slots = { length: latestInj?.slotsTried ?? 0 };
  try {
    if (report && today === etToday && report.behind.minutes >= INJURY_LATE_MIN && h >= 13)
      warnings.push(`injury report: the newest one with players on it is ${report.asOf || report.url.split("/").pop()} (${report.behind.minutes} minutes back; ${report.behind.missing} slots not posted, ${report.behind.empty} empty or unreadable)`);
    if (!report && today === etToday && h >= 13) warnings.push(`injury report: none could be read in the last ${slots.length} slots; the last one written for today stays`);
  } catch (e) { warnings.push(`injury report: ${e.message}`); }
  if (report && report.rows.length) {
    const files = Object.fromEntries(Object.entries(perTeam).map(([tri, games]) => {
      const ids = new Set(games.flatMap((x) => Object.keys(x.pl)));
      return [tri, { team: tri, names: Object.fromEntries([...ids].map((id) => [id, store.names?.[id] || id])), games }];
    }));
    // The report writes "11/02/2026" (zero-padded): compare as dates, not strings.
    const tonightRows = report.rows.filter((r) => isoDate(r.date) === today);
    const impact = injuryImpacts(report.rows, files, { date: today });
    // 0.72.6: two regulars out at once: the team's games without both, this season and last, and who steps up.
    try {
      const { comboAbsences } = await import("../src/injuries/impact.js");
      const { pastSeason } = await import("../src/anticipate/replay.js");
      const zlib = await import("node:zlib");
      const lf = path.join(root, "src", "data", "player-logs-history.json.gz"), hf = path.join(root, "src", "data", "nba-results-history.json");
      const y = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 8 ? 1 : 0);
      const last = `${y - 1}-${String(y % 100).padStart(2, "0")}`;
      const prior = fs.existsSync(lf) && fs.existsSync(hf) ? pastSeason({ history: JSON.parse(fs.readFileSync(hf, "utf8")), logs: JSON.parse(zlib.gunzipSync(fs.readFileSync(lf))), season: last }).pg : null;
      const combos = comboAbsences(impact, files, { prior });
      impact.push(...combos);
      impact.sort((p, q) => q.score - p.score);
      if (combos.length) console.log(`two out at once: ${combos.map((c) => c.text).join(" | ")}`);
    } catch (e) { warnings.push(`combined absences: ${e.message}`); }
    fs.writeFileSync(file, JSON.stringify({ generatedAt: out.generatedAt, date: today, report: { url: report.url, asOf: report.asOf, behind: report.behind },
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
    // 0.84: the all-time series each team's media guide prints (tools/parse-series-history.py), counted forward.
    const serName = fs.readdirSync(path.join(root, "src", "data")).filter((f) => /^nba-series-history-\d{4}-\d{2}\.json$/.test(f)).sort().pop();
    const series = serName ? JSON.parse(fs.readFileSync(path.join(root, "src", "data", serName), "utf8")) : null;
    // 0.90: the largest win each way as three guides print it, the check on the margins counted from the games.
    const sbf = path.join(root, "src", "data", "series-bests-2026-27.json"), seriesBests = fs.existsSync(sbf) ? JSON.parse(fs.readFileSync(sbf, "utf8")) : null;
    if (series) {
      try {
        const { seriesTable, countedPairs } = await import("../src/records/series.js");
        // 0.87: pairings that can be counted game by game settle some the two guides leave open.
        const svf = path.join(root, "src", "data", "series-verified.json");
        if (fs.existsSync(svf)) { const sv = JSON.parse(fs.readFileSync(svf, "utf8")); series.verified = sv.pairs; series.outside = sv.notes || []; }
        if (deepShared.deep && history) series.counted = countedPairs({ deep: deepShared.deep, history, official: deepShared.official, through: series.through });
        const sg = rows.filter((g) => !g.cupFinal && g.hs > 0 && g.as > 0).map((g) => ({ d: g.d, home: g.h, away: g.a, hs: g.hs, as: g.as, neutral: !!g.n }));
        const table = seriesTable(series, sg, today);
        // 0.88: each pairing's older games, where they are on file: the longest streak and largest win each way.
        if (deepShared.deep) {
          const { pairHistory, pairSummary } = await import("../src/records/pairs.js");
          const { meetings } = await import("../src/records/matchup.js");
          for (const r of table) {
            const past = pairHistory({ deep: deepShared.deep, official: deepShared.official, series, bests: seriesBests }, r.a, r.b);
            if (!past) continue;
            const sum = pairSummary([...past.games, ...meetings(history, teamFiles, r.a, r.b)].filter((m) => m.d < today), r.a, r.b, past.printed, past.whole);
            if (sum) r.hist = { from: past.from, whole: past.whole, exact: past.exact, ...sum };
          }
        }
        fs.writeFileSync(path.join(root, "docs", "data", "series.json"), JSON.stringify({ generatedAt: out.generatedAt, through, guidesThrough: series.through, guides: series.guides, pairs: table }));
        console.log(`series: ${table.length} of 435 pairings from ${Object.keys(series.guides || {}).length} team guides (${table.filter((r) => r.status === "confirmed" && !r.counted && !r.checked).length} confirmed by both guides, ${table.filter((r) => r.counted).length} by a count of the games, ${table.filter((r) => r.checked).length} by an outside check, ${table.filter((r) => r.status === "differs").length} where they differ)`);
      } catch (e) { console.error(`series not written: ${e.message}`); }
    }
    const m = matchups({ history, logs, teamFiles, tonight, today, series, deep: deepShared.deep, official: deepShared.official, bests: seriesBests });
    // 0.95 (the user, 11/17): what is lopsided between tonight's opponents by the type of scoring (paint, fast break,
    // second chance, off turnovers) and against the top defenses (src/situations/edges.js). The lines join each game's
    // matchup items (EDGE.perGame of them, the page shows them first); the whole table goes to docs/data/edges.json.
    try {
      const { edges, EDGE } = await import("../src/situations/edges.js");
      const E = edges({ rows, names: store.names || {}, tonight, teamFiles });
      for (const g of m) {
        const mine = (E.games.find((x) => x.away === g.away && x.home === g.home)?.items || []).slice(0, EDGE.perGame);
        g.items = [...g.items, ...mine].sort((a, b) => b.score - a.score);
      }
      fs.writeFileSync(path.join(root, "docs", "data", "edges.json"), JSON.stringify({ generatedAt: out.generatedAt, today, through, ...E }));
      console.log(`edges: ${E.covered} of ${E.total} games have scoring by type; ${E.table.length} teams ranked; ${E.games.reduce((a, g) => a + g.items.length, 0)} lopsided matchups tonight`);
    } catch (e) { console.error(`edges not written: ${e.message}`); }
    fs.writeFileSync(path.join(root, "docs", "data", "matchups.json"), JSON.stringify({ generatedAt: out.generatedAt, today, window: history?.seasons || null, games: m.map((g) => ({ ...g, items: [...g.items.slice(0, 12), ...g.items.slice(12).filter((i) => i.series || i.edge)] })) }));   // 0.85.1: the all-time series line is kept even on a game with more than twelve items
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
    const opt = (f) => { try { return rd(f); } catch { return null; } };
    const args = { watch, trends: rd("trends.json"), leaders: rd("leaders.json"), injuries, facts, records, matchups: matchupData, national: opt("national.json"), rest: opt("rest.json"), form: opt("form.json"), fouls: opt("flowstats.json"), prep: opt("prep.json"), maxLines: 8 };
    const games = tonightStorylines(args)
      .map((g) => ({ ...g, lines: g.lines.map(({ kind, team, text, score, standing }) => ({ kind, team, text, score: Math.round(score * 100) / 100, ...(standing ? { bg: 1 } : {}) })) }));
    // 0.71: 30- and 40-point games each defense has allowed, for NBA Live's "first one allowed" card (the user, 11/15: the Celtics).
    let defense = null;
    try { const { allowedCounts } = await import("../src/anticipate/seasonlong.js"); const C = allowedCounts({ pg: playerGames(rows), rows }); defense = { n30: C.n30, n40: C.n40, teams: Object.fromEntries(Object.entries(C.teams).map(([t, x]) => [t, { gp: x.gp, t30: x.t30, t40: x.t40 }])) }; } catch (e) { console.error(`defense counts not written: ${e.message}`); }
    // 0.79: rare game states with a record someone looked up (seeded-lists.json `situations`), for NBA Live to show when a
    // live game enters one. The playoff ones wait for the playoffs.
    let situations = [];
    try { situations = (JSON.parse(fs.readFileSync(path.join(root, "src", "data", "seeded-lists.json"), "utf8")).situations || []).filter((x) => !x.playoffs).map(({ id, when, text, asOf }) => ({ id, when, text, asOf })); } catch (e) { console.error(`situations not written: ${e.message}`); }
    // 0.72.8: the big names (prep stats' prominence, 0.6+), for NBA Live's milestone cards: a lesser round number gets a card only for them.
    let stars = null;
    try { const st = rd("prep.json").stars || {}; stars = Object.fromEntries(Object.entries(st).filter(([, v]) => v >= 0.6).map(([n, v]) => [n, Math.round(v * 100) / 100])); } catch { /* no prep stats: no exceptions */ }
    // 0.81: the most points by a player in each of tonight's buildings (a list the user sent 11/16, with this season's
    // box scores on top), for NBA Live's arena-record card. Neutral-site games are in no one's building.
    let arenas = {};
    try {
      const { arenaRecords, arenasTonight } = await import("../src/records/arena.js");
      const arenaData = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "arena-records.json"), "utf8"));
      const all = arenaRecords(arenaData, rows, store.names || {});
      const neutral = new Set((sb.ok ? sb.data.games : []).filter((g) => g.neutral).map((g) => g.homeTri));
      arenas = arenasTonight(all, (watch.games || []).map((g) => g.homeTri).filter((t) => !neutral.has(t)));
      fs.writeFileSync(path.join(root, "docs", "data", "arenas.json"), JSON.stringify({ generatedAt: out.generatedAt, through, asOf: arenaData.asOf, arenas: all }));   // 0.83: for the Index page
      const fresh = Object.entries(all).filter(([, r]) => r.season);
      if (fresh.length) console.log(`arena records: set or tied this season in ${fresh.map(([t, r]) => `${t} (${r.pts})`).join(", ")}`);
    } catch (e) { console.error(`arena records not read: ${e.message}`); }
    // 0.83: how often a bench has outscored its own starters over a whole game, by team and league-wide, for NBA Live's
    // BENCH IMPACT card (the user, 11/16: "maybe there is a way to track if this is a common occurrence").
    let bench = null;
    try { const { benchOverStarters } = await import("../src/situations/bench.js"); bench = benchOverStarters(rows); } catch (e) { console.error(`bench counts not made: ${e.message}`); }
    fs.writeFileSync(path.join(root, "docs", "data", "tonight.json"), JSON.stringify({ generatedAt: out.generatedAt, today: watch.today, games, defense, stars, situations, arenas, lasttime: lastTime?.watch || {}, zeros: args.prep?.zeros || {}, bench }));
    // The briefing (0.66): one ranking over every candidate line, with what was already shown on earlier days.
    try {
      const { tonightCandidates } = await import("../src/anticipate/tonight.js");
      const { briefing } = await import("../src/anticipate/briefing.js");
      const cand = tonightCandidates(args);
      const seenFile = path.join(root, "history", "briefing-seen.json");
      const seen = fs.existsSync(seenFile) ? JSON.parse(fs.readFileSync(seenFile, "utf8")) : {};
      const nat = new Set((args.national?.upcoming || []).filter((g) => g.d === watch.today && g.status !== "dropped").map((g) => `${g.away}@${g.home}`));
      // 0.67: the user's 👍/👎 from the Worker (a copy is kept in history/ in case the Worker can't be reached).
      const { learn, boost } = await import("../src/anticipate/learn.js");
      const votesFile = path.join(root, "history", "briefing-votes.json");
      let votes = fs.existsSync(votesFile) ? JSON.parse(fs.readFileSync(votesFile, "utf8")) : [];
      try {
        const r = await fetch("https://ncc-articles.dukie0813.workers.dev/votes", { signal: AbortSignal.timeout(15000) });
        if (r.ok) { votes = (await r.json()).votes || []; fs.writeFileSync(votesFile, JSON.stringify(votes)); }
      } catch (e) { console.error(`briefing votes not read (using the saved copy): ${e.message}`); }
      const model = learn(votes, args.prep?.stars || {});
      // 0.70: what the news is about (the articles watcher's last 72 hours of headlines) moves those lines up.
      let buzz = null;
      try {
        const { buzzCounts } = await import("../src/anticipate/buzz.js");
        const r = await fetch("https://ncc-articles.dukie0813.workers.dev/headlines", { signal: AbortSignal.timeout(15000) });
        if (r.ok) buzz = buzzCounts((await r.json()).headlines || [], { players: cand.all.map((l) => l.player).filter(Boolean), teams: cand.games.flatMap((g) => [g.away, g.home]), league: Object.values(store.names || {}) });
      } catch (e) { console.error(`headlines not read: ${e.message}`); }
      // 0.138: the ledger: one record per claim across every detector, with what was seen and shown on earlier days.
      const { buildLedger, markShown, pageKey, hashKey } = await import("../src/anticipate/ledger.js");
      const ledgerFile = path.join(root, "history", "ledger-seen.json");
      const ledgerSeen = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, "utf8")) : {};
      const ledger = buildLedger(cand.all, { seen: ledgerSeen, today: watch.today });
      const b = briefing({ all: cand.all, games: cand.games, stars: args.prep?.stars || {}, nationalGames: nat, seen, today: watch.today, model, buzz, ledger });
      fs.writeFileSync(seenFile, JSON.stringify(b.seen));
      const atTop = new Set([...b.top, ...b.deep].map((l) => l.claim).filter(Boolean));
      fs.writeFileSync(ledgerFile, JSON.stringify(markShown(ledger.seen, ledger.claims.filter((c) => atTop.has(c.key)), watch.today)));
      const ledgerFirstRun = !Object.keys(ledgerSeen).length;
      const status = (c) => (ledgerFirstRun ? "seen" : c.isNew ? "new" : c.changed ? "updated" : "seen");
      fs.writeFileSync(path.join(root, "docs", "data", "ledger.json"), JSON.stringify({ generatedAt: out.generatedAt, today: watch.today, lines: cand.all.length,
        claims: ledger.claims.sort((x, y) => (y.best.score || 0) - (x.best.score || 0)).map((c) => ({ key: c.key, team: c.team, player: c.player, game: c.game, kinds: c.kinds, sources: c.lines.length,
          text: c.best.text, score: Math.round((c.best.score || 0) * 100) / 100, first: c.first, status: status(c), shownStreak: c.shownStreak, top: atTop.has(c.key),
          pk: [...new Set(c.lines.map((l) => pageKey(l.team, l.text)))] })) }));
      // 0.138.1: the page's lookup table (page key -> claim id), small; the full ledger above is for research.
      const pk = {}, who = {}; for (const c of ledger.claims) { for (const l of c.lines) pk[hashKey(pageKey(l.team, l.text))] = hashKey(c.key); if (c.player) who[hashKey(c.key)] = c.player; }
      // 0.139: who each claim is about, so a storyline marked "used" teaches the ranking about the right player.
      fs.writeFileSync(path.join(root, "docs", "data", "ledger-index.json"), JSON.stringify({ generatedAt: out.generatedAt, today: watch.today, pk, who }));
      console.log(`ledger: ${cand.all.length} lines -> ${ledger.claims.length} claims (${ledger.claims.filter((c) => c.kinds.length > 1).length} found by two detectors); ${ledger.claims.filter((c) => status(c) === "new").length} new, ${ledger.claims.filter((c) => status(c) === "updated").length} updated`);
      const firstRun = !Object.keys(seen).length; // the first build has nothing to compare with: nothing is "new"
      const slimL = (l) => ({ key: l.key, claim: l.claim || null, status: ledgerFirstRun ? null : l.status || null, kind: l.kind, team: l.team, player: l.player || null, game: l.game, text: l.text, rank: l.rank, learned: l.learned || 0, isNew: l.age === 0 && !firstRun, news: l.news || 0, headlines: l.news ? buzz?.titles?.[l.player] || [] : [] });
      const learned = Object.entries(model.weights).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 12);
      fs.writeFileSync(path.join(root, "docs", "data", "briefing.json"), JSON.stringify({ generatedAt: out.generatedAt, today: watch.today, candidates: cand.all.length, votes: { n: model.n, up: model.up.size, down: model.down.size, learned }, top: b.top.map(slimL), deep: b.deep.map(slimL),
        lastNight: (args.prep?.lastNight || []).slice(0, 6).map((l) => ({ key: l.key, kind: l.kind, team: l.team, player: l.player, text: l.text })),
        // 0.81: the finder's league list: a line voted down is gone, and the rest are ordered by surprise plus what the votes taught.
        finds: (args.prep?.finds || []).filter((l) => !model.down.has(l.key)).map((l) => ({ l, r: l.score + boost(l, model, args.prep?.stars || {}) })).sort((a, b) => b.r - a.r)
          .slice(0, 8).map(({ l }) => ({ key: l.key, kind: l.kind, team: l.team, player: l.player, text: l.text, game: "" })),
        news: buzz ? Object.entries(buzz.players).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, n]) => ({ name, n, titles: buzz.titles[name] || [] })) : null }));
      console.log(`briefing: ${cand.all.length} candidates -> top ${b.top.length}, deep cuts ${b.deep.length}; ${model.n} votes, ${Object.keys(model.weights).length} learned weights; ${buzz ? `${Object.keys(buzz.players).length} players and ${Object.keys(buzz.teams).length} teams in the headlines` : "no headlines"}; ${(args.prep?.lastNight || []).length} lines from last night`);
    } catch (e) { console.error(`briefing not written: ${e.message}`); }
  } catch (e) { console.error(`tonight's storylines not written: ${e.message}`); }
}
// Per-game box totals for the "vs top teams" page, which computes in the browser.
const slim = rows.filter((g) => g.hb && g.ab).map(({ id, d, h, a, hs, as, hb, ab }) => ({ id, d, h, a, hs, as, hb, ab }));
fs.writeFileSync(path.join(root, "docs", "data", "games.json"), JSON.stringify({ generatedAt: out.generatedAt, through, games: slim }));
// The page's copy of the ratings code (kept identical to src; a test checks).
fs.mkdirSync(path.join(root, "docs", "lib", "situations"), { recursive: true });
for (const f of ["ratings.js", "withwithout.js", "leaders.js", "oddlines.js"]) fs.copyFileSync(path.join(root, "src", "situations", f), path.join(root, "docs", "lib", "situations", f));
// The record book and single-game lists (static reference data) for the Records page.
fs.mkdirSync(path.join(root, "docs", "ref"), { recursive: true });
for (const f of fs.readdirSync(path.join(root, "src", "data")).filter((f) => /^nba-(record-book|single-game-bests|postseason-careers)-/.test(f))) fs.copyFileSync(path.join(root, "src", "data", f), path.join(root, "docs", "ref", f.replace(/-\d{4}-\d\d\.json$/, ".json")));
fs.mkdirSync(path.join(root, "docs", "lib", "anticipate"), { recursive: true });
for (const f of ["tonight.js", "briefing.js", "learn.js", "buzz.js", "ledger.js"]) fs.copyFileSync(path.join(root, "src", "anticipate", f), path.join(root, "docs", "lib", "anticipate", f));
fs.mkdirSync(path.join(root, "docs", "lib", "site"), { recursive: true });
for (const f of ["trim.js", "post.js"]) fs.copyFileSync(path.join(root, "src", "site", f), path.join(root, "docs", "lib", "site", f));   // 0.137/0.139: the Watch List's folding rules and post-ready wording
fs.mkdirSync(path.join(root, "docs", "lib", "espn"), { recursive: true });
for (const f of ["parse.js", "pbp.js", "misc.js"]) fs.copyFileSync(path.join(root, "src", "espn", f), path.join(root, "docs", "lib", "espn", f));
const after = Object.values(store.dates).filter((d) => d.complete).length;
const flags = Object.values(sit.teams).reduce((a, t) => a + t.flags.length, 0);
console.log(`situations through ${through}: ${rows.length} games (${after - before} new dates), ${Object.keys(sit.teams).length} teams, ${flags} flags, ${tonight.length} games tonight${warnings.length ? `; ${warnings.length} warnings` : ""}`);
// 0.132.0: each warning on its own line. A count alone ("1 warnings") hid a game with no box score for a day.
// 0.136.4 (the user, 11/20, with the banner): a game whose box score is kept while ESPN's plays don't add up is ESPN's gap,
// not a build problem, and nothing the reader can act on: it goes to the log and the diagnostic, not the build check.
for (const w of warnings) (/box score kept/.test(w) ? console.log : console.error)(w);   // ci.js names the step
