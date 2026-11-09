import { nameKey } from "../notes/names.js";
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
const STEPS = { pts: 1000, reb: 500, ast: 500, fg3m: 100, stl: 100, blk: 100, gp: 100, dreb: 1000, ftm: 500, fgm: 1000 };
const MIN_TARGET = { pts: 1000, reb: 500, ast: 500, fg3m: 100, stl: 100, blk: 100, gp: 100, dreb: 1000, ftm: 500, fgm: 1000 };
const GAMES = 3;

export async function discoverMilestones({ team, espn, skip = [] }) {
  const out = [], problems = [];
  const teams = await espn.teams();
  if (!teams.ok) return { milestones: out, problems: [teams.error] };
  const id = teams.data.ids[team];
  const roster = id ? await espn.roster(id) : { ok: false, error: `no ESPN team for ${team}` };
  if (!roster.ok) return { milestones: out, problems: [roster.error] };
  const have = new Set(skip.map((m) => `${nameKey(m.player)}|${m.stat}|${m.target}`));
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
      if (have.has(`${nameKey(p.name)}|${stat}|${target}`)) continue;
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
