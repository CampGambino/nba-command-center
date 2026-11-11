import fs from "node:fs";
import path from "node:path";
import { readTeams, readRoster, readSchedule, readBox, readCareer, readGameLog, readInjuries, readScoreboard, readGameDetail } from "./parse.js";

/**
 * ESPN client with an on-disk cache under <dataDir>/espn/.
 *
 * - Never throws: every call returns { ok, data, error, warnings, fromCache, stale }.
 * - Fresh cache is used without a request. If ESPN can't be reached, an older
 *   cached copy is returned marked `stale` with a warning, so a PC that wakes
 *   up offline still has yesterday's numbers (and says so).
 * - A final box score never changes, so it is cached forever.
 * - Requests are spaced (default 250 ms) to stay polite.
 */
const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba";
const HOUR = 3600e3;

// What is kept of each feed (logos, links and play-by-play are dropped).
export const SHRINK = {
  box: (d) => ({ header: d?.header, boxscore: d?.boxscore }),
  gameLog: (d) => ({
    names: d?.names,
    events: Object.fromEntries(Object.entries(d?.events || {}).map(([k, e]) => [k, { gameDate: e?.gameDate }])),
    seasonTypes: (d?.seasonTypes || []).map((t) => ({ displayName: t.displayName, categories: (t.categories || []).map((c) => ({ events: (c.events || []).map((e) => ({ eventId: e.eventId, stats: e.stats })) })) })),
  }),
  injuries: (d) => ({
    injuries: (d?.injuries || []).map((t) => ({
      displayName: t.displayName,
      injuries: (t.injuries || []).map((i) => ({
        status: i.status, date: i.date, shortComment: i.shortComment, details: { returnDate: i.details?.returnDate },
        athlete: { displayName: i.athlete?.displayName, team: { displayName: i.athlete?.team?.displayName }, links: (i.athlete?.links || []).filter((l) => /\/id\/\d+/.test(l.href || "")).slice(0, 1).map((l) => ({ href: l.href })) },
      })),
    })),
  }),
};

export function createEspn({ dataDir, fetchImpl = fetch, now = () => Date.now(), spacingMs = 250, timeoutMs = 20000 } = {}) {
  let last = 0;
  const dir = path.join(dataDir, "espn");

  async function getJson(key, url, maxAgeMs, shrink = (d) => d) {
    const file = path.join(dir, `${key}.json`);
    let cached = null;
    try { cached = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* none or damaged: refetch */ }
    if (cached && (maxAgeMs === Infinity || now() - cached.fetchedAt < maxAgeMs)) {
      return { ok: true, data: cached.data, fromCache: true, stale: false, warnings: [] };
    }
    const wait = last + spacingMs - now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = now();
    let error;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      let res, body;
      // The timeout covers the whole transfer, not just the headers.
      try {
        res = await fetchImpl(url, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 nba-command-center" } });
        if (res.ok) body = await res.text();
      } finally { clearTimeout(t); }
      if (!res.ok) error = `HTTP ${res.status}`;
      else {
        const data = shrink(JSON.parse(body));
        try {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const tmp = `${file}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: now(), url, data }));
          fs.renameSync(tmp, file);
        } catch { /* cache is best-effort */ }
        return { ok: true, data, fromCache: false, stale: false, warnings: [] };
      }
    } catch (e) {
      error = e?.name === "AbortError" ? "timed out" : `network: ${e?.message || e}`;
    }
    if (cached) {
      const age = Math.round((now() - cached.fetchedAt) / HOUR);
      return { ok: true, data: cached.data, fromCache: true, stale: true, warnings: [`ESPN unreachable (${error}); using a copy from ${age}h ago`] };
    }
    return { ok: false, data: null, error: `ESPN ${key}: ${error}`, warnings: [] };
  }

  const wrap = async (key, url, maxAge, reader, shrink) => {
    const r = await getJson(key, url, maxAge, shrink);
    if (!r.ok) return r;
    try {
      const parsed = reader(r.data);
      return { ...r, data: parsed, warnings: [...r.warnings, ...(parsed?.warnings || [])] };
    } catch (e) {
      return { ok: false, data: null, error: `ESPN ${key}: unreadable (${e.message})`, warnings: r.warnings };
    }
  };

  return {
    teams: () => wrap("teams", `${BASE}/teams`, 7 * 24 * HOUR, readTeams),
    roster: (espnTeamId) => wrap(`roster-${espnTeamId}`, `${BASE}/teams/${espnTeamId}/roster`, 12 * HOUR, (j) => ({ players: readRoster(j) })),
    schedule: (espnTeamId) => wrap(`schedule-${espnTeamId}`, `${BASE}/teams/${espnTeamId}/schedule`, 1 * HOUR, (j) => ({ games: readSchedule(j) })),
    // A box score is only cached forever once it is final.
    // Only the header and box score are kept (the full summary with play-by-play is ~400 KB a game).
    box: async (eventId) => {
      const shrink = SHRINK.box;
      const r = await wrap(`box-${eventId}`, `${BASE}/summary?event=${eventId}`, Infinity, readBox, shrink);
      // A cached copy of an unfinished game is refreshed (overwritten, never deleted).
      if (r.ok && !r.data.final && r.fromCache) return wrap(`box-${eventId}`, `${BASE}/summary?event=${eventId}`, 60e3, readBox, shrink);
      return r;
    },
    // A finished game reduced to team box totals and clutch-time scoring (a few
    // hundred bytes kept, not the ~450 KB summary). Ask only for final games.
    detail: async (eventId) => {
      const r = await wrap(`detail-${eventId}`, `${BASE}/summary?event=${eventId}`, Infinity, (d) => d, readGameDetail);
      if (r.ok && !r.data.final && r.fromCache) return wrap(`detail-${eventId}`, `${BASE}/summary?event=${eventId}`, 60e3, (d) => d, readGameDetail);
      return r;
    },
    scoreboard: (isoDate) => wrap(`scoreboard-${isoDate}`, `${BASE}/scoreboard?dates=${isoDate.replace(/-/g, "")}`, 10 * 60e3, readScoreboard),
    injuries: () => wrap("injuries", `${BASE}/injuries`, 1 * HOUR, readInjuries, SHRINK.injuries),
    // Past seasons don't change: cache for a week. `season` is the ending year (2026 = 2025-26).
    gameLog: (athleteId, season) => wrap(`log-${athleteId}-${season}`, `${WEB}/athletes/${athleteId}/gamelog?season=${season}`, 7 * 24 * HOUR, readGameLog, SHRINK.gameLog),
    career: (athleteId) => wrap(`career-${athleteId}`, `${WEB}/athletes/${athleteId}/stats`, 6 * HOUR, readCareer),
  };
}
