/**
 * Which round numbers are worth a card (the user, 11/13): "natural cutoffs every 1,000, with exceptions".
 *
 *   - a young player (1st-3rd season) counts every 100 until he reaches 1,000;
 *   - points, rebounds and assists go by 1,000, closer together once the total is high for that stat
 *     (points 20,000+, rebounds and assists 10,000+: every 500);
 *   - steals, blocks and 3-pointers come less often, so they go by 250 (250, 500, 750, 1,000, 1,250 ...);
 *   - a young player past 1,000 (a Wembanyama or a Flagg) goes by 500 in points until 5,000 and in
 *     rebounds and assists until 3,000;
 *   - an all-time great late in his career is already in the "high" range of his stats (LeBron's points
 *     by 500, Curry's threes by 250);
 *   - games played go by 100 (the 900th game), from 500;
 *   - the young player's 100s start at 500 points (200 of anything else): 100 career points isn't a milestone;
 *   - stats it doesn't cover (double-doubles, games started, …) are left alone.
 * First build (11/13): 433 of 649 round-number cards were off the spacing; that first cut dropped every veteran's
 * steals, blocks and threes under 1,000 and every double-double count, so both were loosened.
 * Passing a player on a list is a different kind of milestone and is never filtered by this.
 */
export const YOUNG_SEASONS = 3;
const HIGH = { pts: 20000, reb: 10000, ast: 10000, dreb: 7000, oreb: 3000 };
const RARE = new Set(["stl", "blk", "fg3m"]);
const PHENOM = { pts: 5000, reb: 3000, ast: 3000 };
const GP_FLOOR = 500;
const YOUNG_FROM = { pts: 500 };
export const CADENCE_STATS = new Set(["pts", "reb", "ast", "stl", "blk", "fg3m", "gp", "fgm", "ftm", "oreb", "dreb"]);

/** The spacing of round numbers for this stat at this total. seasons: seasons played, this one included (null: unknown, treated as a veteran). */
export function roundStep(stat, total, { seasons = null } = {}) {
  const young = seasons != null && seasons <= YOUNG_SEASONS;
  if (stat === "gp") return 100;
  if (young && total < 1000) return 100;
  if (RARE.has(stat)) return 250;
  if (young && PHENOM[stat] && total < PHENOM[stat]) return 500;
  if (HIGH[stat] && total >= HIGH[stat]) return 500;
  return 1000;
}

/** The next round number above `total` on that spacing. */
export function nextRound(stat, total, opts = {}) {
  const step = roundStep(stat, total, opts);
  const t = Math.floor(total / step) * step + step;
  return onCadence(stat, t, total, opts) ? t : null;
}

/**
 * Is `target` a round number worth a card for a player now at `total`? It must sit on the spacing for
 * where he is (1,400 points for a 3rd-year player at 1,352 is not: he's past 1,000, so 2,000 is next).
 */
export function onCadence(stat, target, total, opts = {}) {
  if (!CADENCE_STATS.has(stat)) return true;
  if (!Number.isFinite(target) || !Number.isFinite(total) || target <= 0) return true; // nothing to judge
  if (stat === "gp" && target < GP_FLOOR) return false;
  const step = roundStep(stat, total, opts);
  if (step === 100 && stat !== "gp" && target < (YOUNG_FROM[stat] ?? 200)) return false;
  return target % step === 0;
}
