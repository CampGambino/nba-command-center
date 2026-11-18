/**
 * Which day's slate a build publishes (0.105).
 *
 * The user, 11/18: "before switching to slate day of, can you wait until at least all the games are completed from the
 * previous day after midnight? there is a game still active from Tuesday but I see the command center for Wednesday".
 * A build that runs after midnight Eastern used to take the new calendar day at once. Now it keeps yesterday's slate
 * while any of yesterday's games is still being played, and moves on once they are all final. It never holds past
 * 6 AM Eastern, and a scoreboard that cannot be read does not hold anything.
 *
 *   unfinished(games, nowMs)                                   -> yesterday's games not over yet
 *   slateDay({ today, yesterday, hourET, games, nowMs })       -> { day, held: [games] }
 */
export const HOLD_UNTIL_HOUR = 6;
/** In progress, or due to have tipped in the last five hours and not marked started yet (a late tip). Postponed games are neither. */
export function unfinished(games, nowMs) {
  return (games || []).filter((g) => g && (g.state === "in" || (g.state === "pre" && g.start && Date.parse(g.start) <= nowMs && nowMs - Date.parse(g.start) < 5 * 3600e3)));
}
export function slateDay({ today, yesterday, hourET, games, nowMs }) {
  if (!(hourET < HOLD_UNTIL_HOUR)) return { day: today, held: [] };
  const held = unfinished((games || []).filter((g) => g.date === yesterday), nowMs);
  return held.length ? { day: yesterday, held } : { day: today, held: [] };
}
