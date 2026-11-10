import { nameKey, sameName } from "../notes/names.js";
import { statLabel } from "../notes/stats.js";

/**
 * Milestones found from ESPN alone, for teams whose notes can't be read (or
 * to add to those that can): every rostered player within about 3 games of a
 * round career number.
 *
 * Marked origin "espn" and held for review: ESPN's career counts differ from
 * the NBA's by a few for some players (9 of 39 Charlotte totals on
 * 2026-11-09), so a single-source count isn't publishable as fact.
 */
// Rungs follow the user's own bar in NBA Live (MILESTONE_LADDERS: "a rung nobody celebrates
// produces a card nobody wants"): points from 10,000, threes from 1,000 by 500, and so on.
// Stats NBA Live doesn't ladder use comparable bars.
const STEPS = { pts: 1000, fg3m: 500, reb: 1000, ast: 1000, stl: 500, blk: 500, gp: 100, dreb: 1000, ftm: 1000, fgm: 1000 };
const MIN_TARGET = { pts: 10000, fg3m: 1000, reb: 5000, ast: 3000, stl: 1000, blk: 1000, gp: 1000, dreb: 5000, ftm: 3000, fgm: 5000 };
const GAMES = 3;

export async function discoverMilestones({ team, espn, skip = [] }) {
  const out = [], problems = [];
  const teams = await espn.teams();
  if (!teams.ok) return { milestones: out, problems: [teams.error] };
  const id = teams.data.ids[team];
  const roster = id ? await espn.roster(id) : { ok: false, error: `no ESPN team for ${team}` };
  if (!roster.ok) return { milestones: out, problems: [roster.error] };
  // Already in the notes: same ESPN player (by id when the tracker matched one, so
  // "J. Tatum" in Boston's grid is "Jayson Tatum" here), same stat, same target.
  const inNotes = (p, stat, target) => skip.some((m) => m.stat === stat && m.target === target
    && (m.espnId ? String(m.espnId) === String(p.id) : sameName(m.player || "", p.name) || nameKey(m.player || "") === nameKey(p.name)));
  for (const p of roster.data.players) {
    const c = await espn.career(p.id);
    if (!c.ok) { problems.push(`${p.name}: ${c.error}`); continue; }
    const car = c.data.career;
    if (!car || !c.data.rows.length) continue;
    // Per-game pace: this season if 3+ games, else career.
    const latest = c.data.rows[c.data.rows.length - 1];
    const base = latest?.stats?.gp >= 3 ? latest.stats : car;
    for (const [stat, step] of Object.entries(STEPS)) {
      const cur = car[stat];
      if (!Number.isFinite(cur)) continue;
      const target = Math.floor(cur / step) * step + step;
      if (target < MIN_TARGET[stat]) continue;
      const need = target - cur;
      const perGame = stat === "gp" ? 1 : base.gp ? (base[stat] ?? 0) / base.gp : 0;
      if (!(perGame > 0) || need > perGame * GAMES) continue;
      if (inNotes(p, stat, target)) continue;
      out.push({
        team, player: p.name, stat, label: statLabel(stat), kind: "round", scope: "career",
        current: cur, target, need, origin: "espn",
        sources: [{ format: "espn", text: `ESPN career ${stat}: ${cur}` }],
        checks: ["from ESPN's career totals only (not in the team's notes); ESPN can differ from NBA.com by a few"],
        status: "review",
      });
    }
  }
  return { milestones: out, problems };
}
