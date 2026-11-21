/**
 * Is a pass worth saying? The user's rule for NBA Live (0.61, 11/13: "consider player, team, new placement, and stat…
 * scale back"), now shared by the Watch List and the Records "Tonight" tab (0.64).
 *
 *   NBA Cup:   top 2.
 *   Franchise: top 3 in points, rebounds, assists, steals, blocks and threes; top 2 in anything else.
 *   All-time:  top 25 in those six; top 10 in anything else. Points (0.142, the user, 11/21): a live card for a place in the
 *              top 50, and for entering the top 100, 75, 50 or 25 from below; a pass to 51st-100th is a site line only
 *              (siteOnly: the Records page and the storylines on the site, never an NBA Live card).
 *
 * The place is the one he reaches (the rank of the player passed). Round numbers are left to the cadence; a pass with
 * no known place is kept. docs/bridge/cc-bridge.js has the same rule (worthPlace) for NBA Live.
 */
export const MAJOR = new Set(["pts", "reb", "ast", "stl", "blk", "fg3m"]);

export const PTS_LIVE = 50, PTS_SITE = 100, PTS_TIERS = [25, 50, 75, 100];

export function worthPlace(scope, stat, place, { site = false } = {}) {
  if (!place) return true;
  const major = MAJOR.has(stat);
  if (scope === "cup") return place <= 2;
  if (scope === "franchise") return place <= (major ? 3 : 2);
  if (scope === "nba") return place <= (stat === "pts" ? (site ? PTS_SITE : PTS_LIVE) : major ? 25 : 10);
  return true;
}

/** The all-time points tier (top 25, 50, 75 or 100) a player enters going from place `before` to `after`; the best one if
 *  he crosses several, null if none. `before` null = below every ranked name. */
export function tierEntered(stat, before, after) {
  if (stat !== "pts" || !after) return null;
  const b = before || Infinity;
  return PTS_TIERS.find((t) => after <= t && b > t) || null;
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
  return !i.tier && !worthPlace(scope, i.stat, place, { site: true });
}

/** True when a pass is worth a line on the site but not an NBA Live card (all-time points, 51st-100th, no tier). */
export function isSiteOnlyPass(i) {
  const scope = passScope(i);
  if (scope !== "nba" || i.tier) return false;
  const place = i.rank ?? i.passing?.rank ?? null;
  return !!place && worthPlace(scope, i.stat, place, { site: true }) && !worthPlace(scope, i.stat, place);
}
