// Which archive files are real regular-season games, once each (0.149.0). Shared by the tools that read the archive
// (build-history.mjs, ../line-rarity-archive.mjs, ../feat-board-ours.mjs), so they count the same games:
//   - not an All-Star or Rising Stars game (ESPN's scoreboards file those as regular season)
//   - not ESPN's empty copy of a game (no player numbers) or one whose players' points don't add up to the score
//     (since 0.149.0 the archive holds NBA.com's box score for every such game, tools/odd-games/patch-nbacom.mjs)
//   - not an NBA Cup title game (they count toward no regular-season total)
//   - once: a second good copy of the same date and teams is left out
export const EXHIBITION = new Set(["EAST", "WEST", "USA", "WORLD", "LEB", "GIA", "DUR", "STE", "KEN", "CAN", "CHK", "SHQ", "STARS", "STRIPES", "VANCOUVER", "undefined"]);
export function countedGame(g, seen, cup = new Set()) {
  if (!g || cup.has(g.d) || (g.t || []).length !== 2) return false;
  if (g.t.some((t) => !t.t || EXHIBITION.has(t.t))) return false;
  if (g.t.every((t) => t.p.every((p) => !p[5] && !p[14] && !p[15]))) return false;
  if (!g.t.every((t) => t.s != null && t.p.reduce((a, p) => a + (p[5] || 0), 0) === t.s)) return false;
  const key = `${g.d}|${g.t.map((t) => t.t).sort().join("|")}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}
