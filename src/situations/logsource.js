// The players' past games, made whole (0.173.0; the user, 11/27: "If it corrects the mistakes, then go for archive… we
// need to limit bugs, errors, and omissions").
//
// Two files hold a current player's past games:
//   ESPN's player game logs (src/data/player-logs-history.json.gz, tools/backfill-matchups.js): 2016-17 on, regular season,
//     playoffs and play-in. They have holes in the regular season: no line for anyone in a Bulls or Pelicans game of
//     2016-17 and 2017-18, a game here and there, and whatever a failed request left out when the file was made.
//   the career logs (src/data/player-logs-career.json.gz, tools/build-career-logs.mjs): every regular-season game of his
//     career from the box-score archive (ESPN's box scores, NBA.com's for the games ESPN has no numbers for).
// Set side by side on 11/27/26, every regular-season line in the ESPN logs is in the career logs with the same numbers in
// every column (121,470 of 121,470; tests/run.js keeps checking), and the career logs have the lines ESPN lacks.
//
// So the past games every reader gets are: the career logs' regular season, inside the ESPN logs' own seasons (the readers
// say "since 2016-17", and that stays true), plus the ESPN logs' playoff and play-in lines. Same columns, same shape.
// Every line is whole: nothing here is a floor, so no reader has to set a filled line apart (src/situations/logfill.js
// did that for the Bulls and Pelicans games until now).
export function wholeLogs(espn, career) {
  if (!career?.players || !Array.isArray(career.columns)) return espn || null;
  const columns = espn?.columns?.length ? espn.columns : career.columns;
  if (career.columns.slice(0, columns.length).join() !== columns.slice(0, career.columns.length).join()) return espn || null;   // not the same columns: leave it
  const ti = columns.indexOf("type"), di = columns.indexOf("date");
  const first = (/^(\d{4})-\d{2}\b/.exec(String(espn?.seasons || "")) || [])[1], start = first ? `${first}-10-01` : "0000";
  const players = {};
  for (const id of new Set([...Object.keys(career.players), ...Object.keys(espn?.players || {})])) {
    const reg = (career.players[id] || []).filter((r) => r[di] >= start);
    const other = (espn?.players?.[id] || []).filter((r) => r[ti] !== 2);
    // a player the career logs don't have (he joined this season's box scores after they were built) keeps ESPN's lines
    const rows = career.players[id] ? [...reg, ...other] : espn.players[id];
    if (rows.length) players[id] = [...rows].sort((a, b) => (a[di] < b[di] ? -1 : a[di] > b[di] ? 1 : 0));
  }
  return { ...(espn || {}), source: `${career.source ? "regular season: " + career.source : "regular season: the box-score archive"}; playoffs and play-in: ${espn?.source || "none"}`,
    seasons: espn?.seasons || career.seasons, columns, whole: true, players };
}
