import { nameKey, sameName } from "../notes/names.js";
import { statLabel } from "../notes/stats.js";
import { nextRound } from "../anticipate/cadence.js";

/**
 * Milestones found from ESPN alone, for teams whose notes can't be read (or
 * to add to those that can): every rostered player within about 3 games of a
 * round career number.
 *
 * Marked origin "espn" and held for review: ESPN's career counts differ from
 * the NBA's by a few for some players (9 of 39 Charlotte totals on
 * 2026-11-09), so a single-source count isn't publishable as fact.
 */
// Round numbers on the user's spacing (src/anticipate/cadence.js, 11/13): every 100 for a young player until
// 1,000, then every 1,000, closer for high totals and for steals, blocks and threes. Earlier rungs followed
// NBA Live's MILESTONE_LADDERS (points from 10,000 only), which hid every young player's milestones.
const STATS = ["pts", "fg3m", "reb", "ast", "stl", "blk", "gp", "dreb", "ftm", "fgm"];
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
    const seasons = new Set(c.data.rows.map((r) => r.season)).size;
    for (const stat of STATS) {
      const cur = car[stat];
      if (!Number.isFinite(cur)) continue;
      const target = nextRound(stat, cur, { seasons });
      if (!target) continue;
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
