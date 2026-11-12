/**
 * NBA Cup career leaderboards kept current: the Cup media guide's all-time leaders (2023-2025 Cups,
 * src/data/nba-cup-<season>.json) plus this season's Cup games, picked out of the box scores by the
 * guide's Group Play schedule (date + teams). Knockout games (quarterfinals Dec. 4-5, semifinals Dec. 8-9)
 * aren't on the schedule yet: a game on those dates between two teams is counted as a Cup game.
 * The Championship (Dec. 11) is outside the regular season and never in the box-score files.
 *
 *   cupRecords({ cup, teamFiles, tonight, today }) -> { items (kind "cup"), boards, cupGames, tonight: [games] }
 */
import { currentRecords } from "./guide.js";

export function cupGameKeys(cup) {
  return new Set((cup.group || []).map((g) => `${g.d}|${g.away}|${g.home}`));
}

/** Only the Cup games in each team file. */
export function cupOnly(teamFiles, cup) {
  const keys = cupGameKeys(cup);
  const ko = new Set([...(cup.knockout?.quarterfinals || []), ...(cup.knockout?.semifinals || [])]);
  const out = {};
  for (const [tri, f] of Object.entries(teamFiles || {})) {
    const games = (f.games || []).filter((g) => keys.has(g.home ? `${g.d}|${g.opp}|${tri}` : `${g.d}|${tri}|${g.opp}`) || ko.has(g.d));
    out[tri] = { ...f, games };
  }
  return out;
}

export function cupRecords({ cup, teamFiles, tonight = [], today = null }) {
  const keys = cupGameKeys(cup);
  const cupTonight = (tonight || []).filter((g) => keys.has(`${today}|${g.away}|${g.home}`));
  const files = cupOnly(teamFiles, cup);
  // Cup games left for each team: its remaining Group Play games (knockout games come later).
  const left = {};
  for (const g of cup.group || []) if (!today || g.d >= today) for (const t of [g.away, g.home]) left[t] = (left[t] || 0) + 1;
  const guide = { alltime: cup.leaders || {}, active: {}, extra: {}, watch: [], targets: [], rounds: [], coaches: {}, franchises: [], teamRecords: {} };
  const r = currentRecords({ guide, teamFiles: files, today, tonight: cupTonight, where: "in NBA Cup history", record: "the NBA Cup record", rounds: false, kind: "cup", horizon: 4 });
  // Only what can still happen in this season's Cup games.
  // Counting stats only (passing someone in games played isn't news), and only what his Cup games left can reach.
  const items = r.items.filter((i) => i.kind === "cup" && !["gp", "min"].includes(i.stat) && (left[i.team] || 0) >= i.gamesAway)
    .map((i) => ({ ...i, cupGamesLeft: left[i.team] || 0, horizonGames: left[i.team] || 0 }));
  const played = (cup.group || []).filter((g) => today && g.d < today).length;
  return { items, boards: r.boards, problems: r.problems, cupGamesPlayed: played, tonight: cupTonight };
}
