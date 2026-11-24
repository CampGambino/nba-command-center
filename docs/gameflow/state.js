/* Game Flow's shared, changing state in one object (0.153.0, the split's part 2).
 * Once the sections live in their own files, a plain `let` in one file cannot be reassigned
 * from another (an imported binding is read-only), so everything more than one file sets
 * lives here and is read and written as S.<name>.
 *
 * The aggregates are each view's built result, kept so switching back is instant; clearCaches
 * in gameflow.js drops them all when the season changes.
 */
export const S = {
  seasonAgg: null,   // season rotation heatmap
  assistAgg: null,   // assist network
  boardAgg: null,    // assist leaderboard / records boards
  highsAgg: null,    // scoring highs
  rangeAgg: null,    // 3PT range
  leagueAgg: null,   // leads & comebacks, on/off, Cup
  LITE: null,        // promise of the season's per-game slices (data/flow/<season>-lite.json)
  PBP_TRIED: 0,      // games asked for play-by-play this season
  PBP_MISSING: 0,    // of those, how many came back without one
  NO_PBP: false,     // true once enough have been tried and none had one
};
