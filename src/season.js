/**
 * The season the Command Center is set up for (0.141.6). One place: the reference files are named for it
 * (src/data/*-2026-27.json), the notes readers recognise "this season" by it, and the build warns when the calendar
 * has moved past it. Changing it is a step of the rollover checklist (docs/SEASON.md), done once the new season's
 * files are in place: with the constant changed and the files missing, the build fails loudly rather than reading
 * last season's.
 */
export const SEASON = "2026-27";

/** "2026-27" for any day from Aug 1, 2026 to Jul 31, 2027. */
export function seasonFor(dateYmd) {
  const y = Number(String(dateYmd).slice(0, 4)), m = Number(String(dateYmd).slice(5, 7));
  const start = m >= 8 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The short form the notes also print ("26-27"). */
export const SEASON_SHORT = SEASON.slice(2);

/** "2026-27" escaped for use inside a RegExp. */
export const SEASON_RE = SEASON.replace(/-/g, "\\-");

/** A reference file named for the season: seasonFile("nba-career-seasons") -> "nba-career-seasons-2026-27.json". */
export const seasonFile = (stem, ext = ".json") => `${stem}-${SEASON}${ext}`;

/**
 * What the build should say about the season, or null. From Aug 1 the calendar is in the next season: the
 * reference files and dates are last season's until the rollover is done. `keyDates` lists the season's dates the
 * code needs (trade deadline, NBA Cup final); a missing one is named.
 */
export function seasonNotice(today, { keyDates = {} } = {}) {
  const now = seasonFor(today);
  if (now !== SEASON) return `The calendar is in the ${now} season but the Command Center is set up for ${SEASON}: reference files, record books and key dates are last season's until the rollover is done (docs/SEASON.md).`;
  const missing = Object.entries(keyDates).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return `Season ${SEASON}: no ${missing.join(" or ")} on file (docs/SEASON.md).`;
  return null;
}
