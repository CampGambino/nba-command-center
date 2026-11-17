/**
 * "Did we see it coming?" (0.67). Each stat another account posted that the user sent (src/data/flag-checks.json)
 * is checked against what our detectors would have said that morning, from the results as they stood before that
 * day's games. The hit rate shows how much of what gets posted the Command Center has ahead of time; each miss says
 * what to build next.
 *
 * check: { id, posted, morning: "YYYY-MM-DD", claim, detector: "prep" | "teamwatch" | "seasonlong" | "flow" | "finder", match: "regex", slate?, season?, note? }
 * "flow" (0.79): the lines made from the Game Flow files (leads, late shots, full halves), from this season's files as
 * they stood before that morning; the caller passes flowAt(morning) -> the season facts.
 * A check with a past `season` (0.70) is replayed from the results history and the logs (src/anticipate/replay.js).
 */
import { playerGames } from "../situations/trends.js";
import { prepLines } from "./prep.js";
import { streakWatch } from "../situations/streakwatch.js";
import { seasonLongLines } from "./seasonlong.js";
import { pastSeason, logsBefore } from "./replay.js";
import { flowTeamLines } from "./tonight.js";
import { findings } from "./finder.js";

/** 0.81: what the finder would have listed that morning (every player, not only that day's teams). */
function finderAt(before, names, flow) {
  const teamGp = {};
  for (const g of before) { teamGp[g.h] = (teamGp[g.h] || 0) + 1; teamGp[g.a] = (teamGp[g.a] || 0) + 1; }
  return findings({ pg: playerGames(before), names, qsum: flow?.qsum || {}, teamGp });
}

export function runChecks(checks, { rows, logs, seasons, history, names, nameKey, season, awards = null, flowAt = null }) {
  const out = [];
  const cache = new Map();
  for (const c of checks || []) {
    if (c.replayable === false) { out.push({ ...c, found: null, line: null }); continue; } // needs data we don't keep for that season
    let lines = [];
    try {
      const key = `${c.detector}|${c.morning}|${JSON.stringify(c.slate || null)}`;
      if (!cache.has(key)) {
        if (c.season && c.season !== season) {
          // A past season: rebuilt from what we keep, with the logs and career seasons as they stood before it.
          const past = pastSeason({ history, logs, season: c.season, before: c.morning });
          const K = seasons?.keys?.indexOf("season") ?? -1;
          const sb = seasons && { ...seasons, players: Object.fromEntries(Object.entries(seasons.players).map(([n, r]) => [n, r.filter((x) => x[K] < c.season)]).filter(([, r]) => r.length)) };
          const slate = c.slate || history.games.filter((r) => r[0] === c.morning && r[5] === 2).map((r) => ({ away: r[2], home: r[1] }));
          // 0.72.5: a past season goes through whichever detector the check names (prep stats and the team streak
          // watch as well; the watch's history is cut to end before that season, which the rebuilt rows then supply).
          const start = `${c.season.slice(0, 4)}-08-01`;
          cache.set(key, c.detector === "teamwatch" ? streakWatch({ history: { ...history, games: history.games.filter((r) => r[0] < start) }, rows: past.rows, today: c.morning })
            : c.detector === "prep" ? prepLines({ pg: past.pg, rows: past.rows, logs: logsBefore(logs, c.season), seasons: sb, names, nameKey, season: c.season, games: slate }).lines
            : seasonLongLines({ pg: past.pg, rows: past.rows, logs: logsBefore(logs, c.season), seasons: sb, awards, names, nameKey, season: c.season, slate, today: c.morning }).lines);
        } else {
          const before = rows.filter((g) => g.d < c.morning);
          // That day's games (from the results once played; a check can name them before they are).
          const slate = c.slate || rows.filter((g) => g.d === c.morning).map((g) => ({ away: g.a, home: g.h }));
          cache.set(key, c.detector === "finder" ? finderAt(before, names, flowAt ? flowAt(c.morning) : null)
            : c.detector === "flow" ? (flowAt ? flowTeamLines(flowAt(c.morning), new Set(slate.flatMap((g) => [g.away, g.home])), c.morning) : [])
            : c.detector === "teamwatch" ? streakWatch({ history, rows: before, today: c.morning })
            : c.detector === "seasonlong" ? seasonLongLines({ pg: playerGames(before), rows: before, logs, seasons, awards, names, nameKey, season, slate, today: c.morning }).lines
            : prepLines({ pg: playerGames(before), rows: before, logs, seasons, names, nameKey, season, games: slate }).lines);
        }
      }
      lines = cache.get(key);
    } catch (e) { out.push({ ...c, found: false, line: null, error: e.message }); continue; }
    const re = new RegExp(c.match, "i");
    const hit = lines.find((l) => re.test(l.text));
    out.push({ ...c, found: !!hit, line: hit ? hit.text : null });
  }
  const found = out.filter((c) => c.found).length;
  return { checks: out, found, total: out.filter((c) => c.found !== null).length, cantReplay: out.filter((c) => c.found === null).length };
}
