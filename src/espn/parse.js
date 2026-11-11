import { teamFromText } from "../teams.js";

/**
 * Pure readers for ESPN's public JSON (site.api.espn.com / site.web.api.espn.com).
 * No network here: every function takes the parsed JSON and returns plain data,
 * so tests run on saved copies. Unknown shapes return empty results plus a
 * `warnings` entry rather than throwing: ESPN changes these feeds without notice.
 */

/** Calendar date in New York for an ISO timestamp. ESPN stamps a 7 PM ET game as the next day in UTC. */
export function etDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** /teams -> { CHA: "30", GSW: "9", ... } keyed by our tricodes (ESPN uses GS, NO, NY, SA, UTAH, WSH). */
export function readTeams(json) {
  const out = {}, warnings = [];
  const list = json?.sports?.[0]?.leagues?.[0]?.teams || [];
  for (const { team } of list) {
    const tri = teamFromText(team?.displayName || "");
    if (tri && team?.id) out[tri] = String(team.id);
    else warnings.push(`unmapped ESPN team ${team?.displayName}`);
  }
  if (Object.keys(out).length !== 30) warnings.push(`expected 30 teams, mapped ${Object.keys(out).length}`);
  return { ids: out, warnings };
}

/** /teams/:id/roster -> [{ id, name }] */
export function readRoster(json) {
  return (json?.athletes || [])
    .filter((a) => a?.id && (a.fullName || a.displayName))
    .map((a) => ({ id: String(a.id), name: a.fullName || a.displayName }));
}

/** /teams/:id/schedule -> regular-season games with ET date and whether final. */
export function readSchedule(json) {
  const out = [];
  for (const e of json?.events || []) {
    const c = e?.competitions?.[0];
    if (!c || !e.id) continue;
    out.push({
      id: String(e.id),
      date: etDate(e.date || c.date),
      start: e.date || c.date || null,
      final: c.status?.type?.completed === true,
      state: c.status?.type?.name || null,
      seasonType: e.seasonType?.type ?? c.season?.type ?? null,
      teams: (c.competitors || []).map((k) => k.team?.displayName).filter(Boolean),
      home: (c.competitors || []).find((k) => k.homeAway === "home")?.team?.displayName || null,
      away: (c.competitors || []).find((k) => k.homeAway === "away")?.team?.displayName || null,
    });
  }
  return out;
}

// Map ESPN stat keys to ours. Combined "made-attempted" keys are split.
const BOX_KEYS = {
  minutes: ["min"], points: ["pts"], rebounds: ["reb"], totalRebounds: ["reb"], assists: ["ast"],
  turnovers: ["tov"], steals: ["stl"], blocks: ["blk"], offensiveRebounds: ["oreb"],
  defensiveRebounds: ["dreb"], fouls: ["pf"],
  "fieldGoalsMade-fieldGoalsAttempted": ["fgm", "fga"],
  "threePointFieldGoalsMade-threePointFieldGoalsAttempted": ["fg3m", "fg3a"],
  "freeThrowsMade-freeThrowsAttempted": ["ftm", "fta"],
};

function readStatRow(keys, values) {
  const s = {};
  keys.forEach((k, i) => {
    const ours = BOX_KEYS[k];
    if (!ours) return;
    const parts = String(values?.[i] ?? "").split("-");
    ours.forEach((o, j) => {
      const n = Number(parts[j]);
      if (parts[j] !== undefined && parts[j] !== "" && Number.isFinite(n)) s[o] = n;
    });
  });
  return s;
}

/**
 * /summary?event=:id -> { final, date, players: [{ id, name, team, started, played, stats }] }
 * `played` is false for DNPs and for rows with no minutes.
 */
export function readBox(json) {
  const header = json?.header?.competitions?.[0];
  const players = [];
  const warnings = [];
  for (const side of json?.boxscore?.players || []) {
    const team = teamFromText(side?.team?.displayName || "") || side?.team?.abbreviation || null;
    const block = side?.statistics?.[0];
    const keys = block?.keys || [];
    if (!keys.length) { warnings.push(`no stat keys for ${team}`); continue; }
    for (const a of block.athletes || []) {
      const stats = readStatRow(keys, a.stats);
      const played = !a.didNotPlay && Array.isArray(a.stats) && a.stats.length > 0 && (stats.min ?? 0) > 0;
      players.push({ id: String(a.athlete?.id), name: a.athlete?.displayName, team, started: a.starter === true, played, stats });
    }
  }
  return {
    id: json?.header?.id ? String(json.header.id) : null,
    date: header?.date ? etDate(header.date) : null,
    final: header?.status?.type?.completed === true,
    players,
    warnings,
  };
}

const CAREER_KEYS = {
  gamesPlayed: ["gp"], gamesStarted: ["gs"],
  "fieldGoalsMade-fieldGoalsAttempted": ["fgm", "fga"],
  "threePointFieldGoalsMade-threePointFieldGoalsAttempted": ["fg3m", "fg3a"],
  "freeThrowsMade-freeThrowsAttempted": ["ftm", "fta"],
  offensiveRebounds: ["oreb"], defensiveRebounds: ["dreb"], totalRebounds: ["reb"],
  assists: ["ast"], blocks: ["blk"], steals: ["stl"], fouls: ["pf"], turnovers: ["tov"], points: ["pts"],
};

function readCareerRow(names, values) {
  const s = {};
  names.forEach((k, i) => {
    const ours = CAREER_KEYS[k];
    if (!ours) return;
    const parts = String(values?.[i] ?? "").replace(/,/g, "").split("-");
    ours.forEach((o, j) => {
      const n = Number(parts[j]);
      if (parts[j] !== undefined && parts[j] !== "" && Number.isInteger(n)) s[o] = n;
    });
  });
  return s;
}

/**
 * /athletes/:id/stats -> regular-season career.
 *   rows:   one per season per team (traded seasons have several), never the
 *           "YYYY-YY Totals" summary rows, so rows can be summed safely
 *   career: ESPN's own career totals line
 * Counting stats come from the "totals" table; games played/started (whole
 * numbers) from the "averages" table, matched by season + team, not position.
 */
export function readCareer(json) {
  const warnings = [];
  const cats = json?.categories || [];
  const totals = cats.find((c) => c.name === "totals");
  const avgs = cats.find((c) => c.name === "averages");
  if (!totals) return { rows: [], career: null, warnings: [] }; // no NBA regular-season games yet
  const key = (s) => `${s?.season?.year ?? s?.season?.displayName}|${s?.teamId ?? s?.teamSlug}`;
  const isSummary = (s) => !s?.teamId || /totals/i.test(String(s?.teamSlug || ""));
  const gpBy = new Map();
  for (const s of avgs?.statistics || []) {
    const r = readCareerRow(avgs.names || [], s.stats);
    gpBy.set(key(s), { gp: r.gp, gs: r.gs });
  }
  const rows = [];
  for (const s of totals.statistics || []) {
    if (isSummary(s)) continue;
    const r = readCareerRow(totals.names || [], s.stats);
    const g = gpBy.get(key(s));
    if (g?.gp != null) r.gp = g.gp;
    if (g?.gs != null) r.gs = g.gs;
    rows.push({ season: s.season?.displayName || null, teamId: String(s.teamId), team: s.teamSlug || null, stats: r });
  }
  const career = readCareerRow(totals.names || [], totals.totals);
  if (avgs?.totals) {
    const g = readCareerRow(avgs.names || [], avgs.totals);
    if (g.gp != null) career.gp = g.gp;
    if (g.gs != null) career.gs = g.gs;
  }
  // Internal consistency: the per-team rows must add up to ESPN's own career line.
  for (const k of ["pts", "reb", "ast", "gp"]) {
    const sum = rows.reduce((a, r) => a + (r.stats[k] || 0), 0);
    if (career[k] != null && sum !== career[k]) warnings.push(`ESPN season rows add to ${sum} ${k} but its career line says ${career[k]}`);
  }
  return { rows, career, warnings };
}

const LOG_KEYS = {
  minutes: ["min"], totalRebounds: ["reb"], assists: ["ast"], blocks: ["blk"], steals: ["stl"],
  fouls: ["pf"], turnovers: ["tov"], points: ["pts"],
  "fieldGoalsMade-fieldGoalsAttempted": ["fgm", "fga"],
  "threePointFieldGoalsMade-threePointFieldGoalsAttempted": ["fg3m", "fg3a"],
  "freeThrowsMade-freeThrowsAttempted": ["ftm", "fta"],
};

/**
 * /athletes/:id/gamelog?season=YYYY -> games grouped by ESPN season type
 * ("Regular Season", "Play In Regular Season", "Postseason", "Preseason").
 * Play-in games are their own type here and are NOT in ESPN's season rows
 * (checked 2026-11-09 against three players' 2025-26 rows). No offensive or
 * defensive rebounds or starts in game logs.
 */
export function readGameLog(json) {
  const names = json?.names || [];
  const events = json?.events || {};
  const types = [];
  for (const st of json?.seasonTypes || []) {
    const games = [];
    for (const c of st.categories || []) {
      for (const e of c.events || []) {
        const s = {};
        names.forEach((k, i) => {
          const ours = LOG_KEYS[k];
          if (!ours) return;
          const parts = String(e.stats?.[i] ?? "").split("-");
          ours.forEach((o, j) => { const n = Number(parts[j]); if (parts[j] !== undefined && parts[j] !== "" && Number.isFinite(n)) s[o] = n; });
        });
        games.push({ id: String(e.eventId), date: etDate(events[e.eventId]?.gameDate), stats: s });
      }
    }
    types.push({ name: st.displayName || "", playIn: /play.?in/i.test(st.displayName || ""), games });
  }
  return { types };
}

/**
 * /injuries -> Map-like object { [athleteId]: { name, team, status, comment, returnDate, updated } }.
 * ESPN's statuses are "Out" and "Day-To-Day" (no Questionable/Probable grades;
 * the NBA's official injury report has those).
 */
export function readInjuries(json) {
  const out = {};
  for (const t of json?.injuries || []) {
    for (const i of t.injuries || []) {
      const href = (i.athlete?.links || []).map((l) => l.href).find((h) => /\/id\/\d+/.test(h || "")) || "";
      const id = (/\/id\/(\d+)/.exec(href) || [])[1] || (i.athlete?.id ? String(i.athlete.id) : null);
      if (!id) continue;
      out[id] = {
        name: i.athlete?.displayName || null,
        team: teamFromText(i.athlete?.team?.displayName || t.displayName || ""),
        status: i.status || null,
        comment: i.shortComment || null,
        returnDate: i.details?.returnDate || null,
        updated: i.date || null,
      };
    }
  }
  return { players: out };
}

/** /scoreboard?dates=YYYYMMDD -> the day's games with both teams as our tricodes. */
export function readScoreboard(json) {
  const games = [];
  for (const e of json?.events || []) {
    const c = e?.competitions?.[0];
    if (!c || !e.id) continue;
    const comp = (h) => c.competitors?.find((k) => k.homeAway === h);
    const side = (h) => comp(h)?.team?.displayName || null;
    const home = side("home"), away = side("away");
    const score = (h) => { const v = Number(comp(h)?.score); return Number.isFinite(v) ? v : null; };
    const quarters = (h) => (comp(h)?.linescores || []).map((l) => Number(l.value)).filter(Number.isFinite);
    games.push({
      id: String(e.id), date: etDate(e.date || c.date), start: e.date || c.date || null,
      home, away, homeTri: teamFromText(home || ""), awayTri: teamFromText(away || ""),
      seasonType: e.season?.type ?? null, state: c.status?.type?.state || null,
      // Results (for team situations): final score and points by period, OT periods included.
      final: c.status?.type?.completed === true, periods: c.status?.period ?? null, neutral: c.neutralSite === true,
      homeScore: score("home"), awayScore: score("away"), homeQ: quarters("home"), awayQ: quarters("away"),
    });
  }
  // Every date with games this season (preseason included), as Eastern dates.
  const calendar = (json?.leagues?.[0]?.calendar || []).map((d) => (typeof d === "string" ? d : d?.startDate || "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return { games, calendar, season: json?.leagues?.[0]?.season?.year ?? null };
}
