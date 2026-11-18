// The players' logs with the games ESPN lacks put back in (0.110; the user, 11/18: "merge the bulls/pelicans games").
// ESPN's game logs have no line for any player in a Bulls or Pelicans game of 2016-17 and 2017-18. Those lines come from
// pbpstats (src/data/player-logs-fill.json.gz, made by tools/merge-pbpstats-logs.mjs --fill) and carry src "p":
//   exact   points, field goals, threes, free throws (made and attempted); the game itself (date, opponent, result)
//   a floor rebounds, assists, steals, blocks (counted from the play-by-play: steals run short, rebounds can be one off)
// So the filled logs go ONLY to readers that use the exact columns, or that use a floor in a way a floor can carry
// (a floor of 1 or more is not a zero). Every other reader keeps the logs as they were. EXACT says which stats a reader
// may take from a row with src "p".
export const EXACT = new Set(["pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta"]);
export const isFill = (row, columns) => row[columns.indexOf("src")] === "p";

export function withFill(logs, fill) {
  if (!logs?.players || !fill?.players || !Array.isArray(fill.columns)) return logs;
  const cols = logs.columns.includes("src") ? logs.columns : [...logs.columns, "src"], fi = Object.fromEntries(fill.columns.map((c, i) => [c, i])), di = logs.columns.indexOf("date");
  if (fi.date == null || fi.src == null || di < 0) return logs;
  const players = {};
  for (const [id, rows] of Object.entries(logs.players)) {
    const have = new Set(rows.map((r) => r[di]));
    const extra = (fill.players[id] || []).filter((r) => r[fi.src] === "p" && !have.has(r[fi.date])).map((r) => cols.map((c) => (fi[c] != null ? r[fi[c]] ?? null : null)));
    players[id] = extra.length ? [...rows, ...extra].sort((a, b) => (a[di] < b[di] ? -1 : a[di] > b[di] ? 1 : 0)) : rows;
  }
  return { ...logs, columns: cols, players };
}
