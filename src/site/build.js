import { seasonFile } from "../season.js";
import { calibrate, PLAY_ONLY } from "../anticipate/calibrate.js";
import { sameName, nameKey } from "../notes/names.js";
import fs from "node:fs";
import path from "node:path";
import { parseNotes } from "../notes/parse.js";
import { buildWatch } from "../anticipate/watch.js";
import { discoverMilestones } from "../registry/discover.js";
import { onCadence } from "../anticipate/cadence.js";

/**
 * Build the website's data (docs/data/watch.json) from teams' notes.
 *
 * Teams whose notes layout has been hand-checked against the PDF are listed in
 * VERIFIED_FORMATS. For any other team the parser's output is unproven, so a
 * milestone is publishable only when ESPN independently confirms its total;
 * everything else from that team is shown as review.
 */
export const VERIFIED_FORMATS = new Set(["CLE", "LAL", "SAS", "PHX", "ATL", "CHA"]); // hand-checked 2026-11-09

/**
 * @param {object} p
 * @param {Array<{team:string, buf?:Buffer, notes?:{status:string, why?:string, error?:string}}>} p.entries
 * @param {Array} [p.games] the day's games (readScoreboard), for the games strip
 * @param {Array} [p.uncounted] tonight's games that count in neither standings nor stats (the NBA Cup final)
 */
/** Notes milestones for a player a team no longer rosters go to the team that does tonight, or are left out (0.71). */
export function moveTraded(teams, roster, rosterNames = {}) {
  for (const t of teams) {
    if (!roster[t.team]) continue;
    // 0.72: a notes player with no ESPN id (ids come from the roster) whose name isn't on the roster either has left:
    // the Kings' 11/15 notes still tracked DeRozan, Westbrook, Schröder and five more (29 milestones under SAC).
    const names = rosterNames[t.team];
    if (names?.length >= 10) {
      // On the roster: the same name, an initial for the first name, or the same last name and first letter ("Nic" / "Nicolas").
      const last = (k) => k.split(" ").pop();
      const onRoster = (who) => { const k = nameKey(who); return names.some((n) => { const r = nameKey(n); return r === k || sameName(n, who) || (last(r) === last(k) && r[0] === k[0]); }); };
      const off = t.items.filter((i) => i.origin === "notes" && !i.espnId && i.player && !onRoster(i.player));
      if (off.length) {
        t.items = t.items.filter((i) => !off.includes(i));
        for (const who of [...new Set(off.map((i) => i.player))]) t.problems.push(`${who} is in ${t.team}'s notes but not on its roster: ${off.filter((i) => i.player === who).length} milestone${off.filter((i) => i.player === who).length === 1 ? "" : "s"} left out`);
      }
    }
    const gone = t.items.filter((i) => i.origin === "notes" && i.espnId && !roster[t.team].has(String(i.espnId)));
    if (!gone.length) continue;
    t.items = t.items.filter((i) => !gone.includes(i));
    for (const i of gone) {
      const now = teams.find((o) => o !== t && roster[o.team]?.has(String(i.espnId)));
      if (now && !now.items.some((x) => String(x.espnId) === String(i.espnId) && x.stat === i.stat && x.target === i.target)) now.items.push({ ...i, note: `now with ${now.team} (${t.team}'s notes still list him)` });
      else if (!now) t.problems.push(`${i.player} is in ${t.team}'s notes but not on its roster: ${Number(i.target).toLocaleString("en-US")} ${i.label || i.stat} left out`);
    }
  }
  return teams;
}

export async function buildSite({ entries, games = [], uncounted = [], espn, nba = null, today, root, calibration = null, injuryFetch = null }) {
  // Outside confirmations (Basketball Reference pages the user checked) settle a notes-vs-ESPN difference (0.72.4).
  let verified = null;
  try { verified = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "verified-totals.json"), "utf8")); } catch { /* none: nothing is settled */ }
  // 0.141.2: tonight's NBA injury report (the last one read by situations.js, docs/data/injuries.json) when it is
  // today's: it sets each card's chance to play tonight; ESPN's feed is kept for return dates and as the fallback.
  // 0.141.5: the newest posted report, read here (this step runs before situations.js saves one); the last saved
  // copy only if none can be read (before, always the saved copy: the previous build's, hours old in the evening).
  let report = null;
  try {
    const { latestReport, reportClock, tonightRowsOf } = await import("../injuries/report.js");
    const c = reportClock(today), r = injuryFetch ? await latestReport(today, c.h, c.m, { fetchFn: injuryFetch }) : null;
    if (r && !r.none) report = { asOf: r.asOf || null, rows: tonightRowsOf(r, today), fresh: true };
  } catch { /* fall back to the saved copy */ }
  if (!report) try {
    const ij = JSON.parse(fs.readFileSync(path.join(root, "docs", "data", "injuries.json"), "utf8"));
    if (ij?.date === today && Array.isArray(ij.players)) report = { asOf: ij.report?.asOf || null, rows: ij.players };
  } catch { /* no report on file: ESPN's feed only */ }
  // 0.80: each active player's career totals through last season, from the NBA Guide's year-by-year lines: the count
  // that breaks a tie between the notes and ESPN (see trackMilestones).
  let guideBase = null;
  try {
    const cs = JSON.parse(fs.readFileSync(path.join(root, "src", "data", seasonFile("nba-career-seasons")), "utf8"));
    const K = Object.fromEntries(cs.keys.map((k, i) => [k, i])), STAT = { gp: "g" };
    const loose = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.'’]/g, "").replace(/\s+(jr|sr|ii|iii|iv)$/, "").replace(/\s+/g, " ").trim();
    const by = new Map(Object.entries(cs.players).map(([n, rows]) => [loose(n), rows]));
    guideBase = (name, stat) => { const rows = by.get(loose(name)), i = K[STAT[stat] || stat]; return rows && i != null ? rows.reduce((a, r) => a + (r[i] || 0), 0) : null; };
  } catch { /* no guide totals: a difference stays a count check */ }
  // 0.146.0: the man a pass is against, when he still adds to his total (src/anticipate/rivals.js), from this season's
  // team files as the last build left them (this step runs before situations.js rewrites them).
  let rivalOf = null;
  try {
    const dir = path.join(root, "docs", "data", "teams");
    const teamFiles = Object.fromEntries(fs.readdirSync(dir).filter((f) => /^[A-Z]{3}\.json$/.test(f)).map((f) => [f.slice(0, 3), JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))]));
    const tonightTeams = new Set(games.flatMap((g) => [g.homeTri, g.awayTri]).filter(Boolean));
    const statusOf = (name, tri) => report?.rows?.find((r) => r.team === tri && sameName(r.name, name))?.status ?? null;
    const { rivalLookup } = await import("../anticipate/rivals.js");
    const { makeSampler } = await import("../anticipate/model.js");
    rivalOf = rivalLookup(teamFiles, { tonightTeams, statusOf, makeSampler });
  } catch (err) { console.error(`pass rivals skipped: ${err.message}`); }
  const reports = [], teams = [];
  for (const e of entries) {
    const base = { team: e.team, notesStatus: e.notes?.status || "local", notesWhy: e.notes?.why || e.notes?.error || null, verifiedFormat: VERIFIED_FORMATS.has(e.team) };
    const problems = [];
    let parsed = null;
    if (!e.buf) problems.push(base.notesWhy || "no notes");
    else {
      try { parsed = await parseNotes(e.buf, { team: e.team }); }
      catch (err) { problems.push(`couldn't read the notes: ${err.message}`); }
    }
    let watchItems = [], tonightGame = null;
    if (parsed) {
      // 0.163.0: notes with a misprinted date are tonight's (src/notes/watcher.js misprintedDate): no game came after them
      const w = await buildWatch({ team: e.team, notesDate: e.notes?.misprint ? e.notes.misprint.date : parsed.meta.gameDate, milestones: parsed.milestones, espn, nba, today, verified, guideBase, report, rivalOf });
      reports.push({ ...w, opponent: parsed.meta.opponent, notesStatus: base.notesStatus });
      watchItems = w.items; tonightGame = w.tonightGame; problems.push(...w.problems);
    }
    // Round career numbers within ~3 games, straight from ESPN, for every rostered
    // player; notes milestones win where both exist. Projected separately with
    // today's date: ESPN's totals are already current, nothing to roll forward.
    const found = await discoverMilestones({ team: e.team, espn, skip: watchItems, today });
    problems.push(...found.problems);
    if (found.milestones.length) {
      const w2 = await buildWatch({ team: e.team, notesDate: today, milestones: found.milestones, espn, nba, today, report, rivalOf });
      reports.push({ ...w2, origin: "espn" });
      watchItems = [...watchItems, ...w2.items];
      tonightGame = tonightGame || w2.tonightGame;
    }
    // Round numbers on the user's spacing (src/anticipate/cadence.js): every 1,000 with exceptions. A notes
    // line for 1,400 points for a 3rd-year player at 1,352 is dropped (1,500 is his next). Passes are untouched.
    const seasonsOf = new Map();
    for (const i of watchItems) {
      if (i.kind !== "round" || !i.espnId || seasonsOf.has(i.espnId) || !espn?.career) continue;
      const c = await espn.career(i.espnId).catch(() => null);
      seasonsOf.set(i.espnId, c?.ok ? new Set(c.data.rows.map((r) => r.season)).size : null);
    }
    const offCadence = watchItems.filter((i) => i.kind === "round" && (i.scope === "career" || i.scope === "franchise" || i.scope === "nba" || i.scope == null)
      && !onCadence(i.stat, i.target, i.current, { seasons: seasonsOf.get(i.espnId) ?? null }));
    if (offCadence.length) watchItems = watchItems.filter((i) => !offCadence.includes(i));
    const items = watchItems.map((i) => {
      let publishable = i.publishable, review = i.checks;
      if (i.origin === "notes" && !base.verifiedFormat) {
        // ESPN can confirm the player's own total. For a round number that is the
        // whole milestone; for a pass, the other player's total (the target) is
        // still only what the unchecked parser read.
        if (!(i.tracking === "confirmed" || i.tracking === "corrected") || i.kind !== "round") publishable = false;
        review = [...(review || []), `${e.team}'s notes layout hasn't been hand-checked yet: only round-number totals ESPN confirms are publishable`];
      }
      return {
        player: i.player, espnId: i.espnId, nbaId: i.nbaId ?? null, origin: i.origin, stat: i.stat, label: i.label, kind: i.kind, scope: i.scope,
        target: i.target, current: i.current, need: i.need,
        // Some notes print only the rank a pass reaches ("3rd all-time"), not who is passed.
        passing: i.passing ? { player: i.passing.player ?? (i.passing.rank ? `No. ${i.passing.rank}` : null), rank: i.passing.rank ?? null } : null,
        importance: i.importance, why: i.why,
        publishable, status: i.status, review, tracking: i.tracking,
        // 0.140: the chance tonight as recalibrated from the scored nights (src/anticipate/calibrate.js); the
        // simulation's own figure is kept beside it. The saved predictions (what is scored) stay the raw ones.
        pTonight: PLAY_ONLY.has(i.stat) ? i.pTonight ?? null : calibrate(i.pTonight ?? null, calibration), pTonightRaw: i.pTonight ?? null, pNext3: i.pNext3 ?? null, pNext5: i.pNext5 ?? null, eta: i.eta ?? null,
        pPlayTonight: i.pPlayTonight ?? null,
        ...(i.rivals?.length ? { rivals: i.rivals } : {}),   // 0.146.0: the man being passed also adds (src/anticipate/rivals.js)
        injury: i.injury ? { status: i.injury.status, returnDate: i.injury.returnDate, from: i.injury.from ?? null, asOf: i.injury.asOf ?? null, comment: i.injury.from === "nba" ? i.injury.comment ?? null : null } : null,
        confidence: i.confidence ?? null, games: i.form?.games ?? null, lineup: i.lineup ?? null,
        reached: !!i.reached, stale: !!i.stale, note: i.note ?? null,
        ...(i.minor ? { minor: true } : {}),   // 0.64: a pass to a place not worth saying (src/records/notable.js)
        ...(i.siteOnly ? { siteOnly: true } : {}),   // 0.142: a site line, never an NBA Live card
      };
    });
    teams.push({ ...base, opponent: parsed?.meta.opponent ?? null, notesDate: parsed?.meta.gameDate ?? null, tonightGame, problems, items,
      offCadence: offCadence.map((i) => `${i.player} ${Number(i.target).toLocaleString("en-US")} ${i.label || i.stat}`) });
  }

  // 0.71: a team's notes can still list a player it has traded (Kings' notes, Nique Clifford, now with OKC): his notes
  // milestones go with him to the team ESPN rosters him on tonight, or are left out if he isn't playing tonight.
  try {
    const roster = {};
    const T = espn?.teams ? await espn.teams() : null;
    const rosterNames = {};
    if (T?.ok) for (const t of teams) { const id = T.data.ids[t.team]; const r = id && espn.roster ? await espn.roster(id) : null; if (r?.ok) { roster[t.team] = new Set(r.data.players.map((p) => String(p.id))); rosterNames[t.team] = r.data.players.map((p) => p.name).filter(Boolean); } }
    moveTraded(teams, roster, rosterNames);
  } catch (err) { console.error(`roster check skipped: ${err.message}`); }
  const docs = path.join(root, "docs");
  fs.mkdirSync(path.join(docs, "data"), { recursive: true });
  const site = { generatedAt: new Date().toISOString(), today, games: games.map((g) => ({ id: g.id, start: g.start, home: g.home, away: g.away, homeTri: g.homeTri, awayTri: g.awayTri })), uncounted, teams };
  fs.writeFileSync(path.join(docs, "data", "watch.json"), JSON.stringify(site));
  // Same code the tests cover, for the page's live countdowns.
  for (const rel of ["teams.js", "notes/names.js", "espn/parse.js", "registry/track.js", "nba/movement.js", "situations/ratings.js", "espn/pbp.js", "situations/withwithout.js", "situations/leaders.js", "anticipate/tonight.js", "gameflow/feeds.js", "gameflow/model.js", "situations/vsplayers.js", "situations/form.js", "situations/pairsplit.js"]) {
    const dst = path.join(docs, "lib", rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(root, "src", rel), dst);
  }
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", `predictions-${today}.json`), JSON.stringify({ today, reports }, null, 1));
  return { site, reports };
}
