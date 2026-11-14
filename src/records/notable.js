/**
 * Is a pass worth saying? The user's rule for NBA Live (0.61, 11/13: "consider player, team, new placement, and stat…
 * scale back"), now shared by the Watch List and the Records "Tonight" tab (0.64).
 *
 *   NBA Cup:   top 2.
 *   Franchise: top 3 in points, rebounds, assists, steals, blocks and threes; top 2 in anything else.
 *   All-time:  top 25 in those six; top 10 in anything else.
 *
 * The place is the one he reaches (the rank of the player passed). Round numbers are left to the cadence; a pass with
 * no known place is kept. docs/bridge/cc-bridge.js has the same rule (worthPlace) for NBA Live.
 */
export const MAJOR = new Set(["pts", "reb", "ast", "stl", "blk", "fg3m"]);

export function worthPlace(scope, stat, place) {
  if (!place) return true;
  const major = MAJOR.has(stat);
  if (scope === "cup") return place <= 2;
  if (scope === "franchise") return place <= (major ? 3 : 2);
  if (scope === "nba") return place <= (major ? 25 : 10);
  return true;
}

/** The list a pass is on: Records items (kind pass / franchise / cup) and Watch List items (kind pass + scope). */
export function passScope(i) {
  if (i.kind === "cup") return "cup";
  if (i.kind === "franchise") return "franchise";
  if (i.kind !== "pass") return null;
  if (i.scope == null) return "nba";                 // Records: an all-time pass
  if (i.scope === "nba" || i.scope === "franchise") return i.scope;
  if (i.scope === "unknown") return "franchise";     // a list of unproven scope: the stricter rule
  return null;
}

/** True when an item is a pass to a place not worth saying (shown only in the full lists). */
export function isMinorPass(i) {
  const scope = passScope(i);
  if (!scope) return false;
  const place = i.rank ?? i.passing?.rank ?? null;
  return !worthPlace(scope, i.stat, place);
}
