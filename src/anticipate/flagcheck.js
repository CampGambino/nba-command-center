/**
 * "Did we see it coming?" (0.67). Each stat another account posted that the user sent (src/data/flag-checks.json)
 * is checked against what our detectors would have said that morning, from the results as they stood before that
 * day's games. The hit rate shows how much of what gets posted the Command Center has ahead of time; each miss says
 * what to build next.
 *
 * check: { id, posted, morning: "YYYY-MM-DD", claim, detector: "prep" | "teamwatch", match: "regex", slate?, note? }
 */
import { playerGames } from "../situations/trends.js";
import { prepLines } from "./prep.js";
import { streakWatch } from "../situations/streakwatch.js";

export function runChecks(checks, { rows, logs, seasons, history, names, nameKey, season }) {
  const out = [];
  const cache = new Map();
  for (const c of checks || []) {
    let lines = [];
    try {
      const key = `${c.detector}|${c.morning}|${JSON.stringify(c.slate || null)}`;
      if (!cache.has(key)) {
        const before = rows.filter((g) => g.d < c.morning);
        // That day's games (from the results once played; a check can name them before they are).
        const slate = c.slate || rows.filter((g) => g.d === c.morning).map((g) => ({ away: g.a, home: g.h }));
        cache.set(key, c.detector === "teamwatch" ? streakWatch({ history, rows: before, today: c.morning })
          : prepLines({ pg: playerGames(before), rows: before, logs, seasons, names, nameKey, season, games: slate }).lines);
      }
      lines = cache.get(key);
    } catch (e) { out.push({ ...c, found: false, line: null, error: e.message }); continue; }
    const re = new RegExp(c.match, "i");
    const hit = lines.find((l) => re.test(l.text));
    out.push({ ...c, found: !!hit, line: hit ? hit.text : null });
  }
  const found = out.filter((c) => c.found).length;
  return { checks: out, found, total: out.length };
}
