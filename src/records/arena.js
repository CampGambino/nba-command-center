/**
 * The most points by a player in each NBA building (0.81).
 *
 * The list is src/data/arena-records.json: a quiz the user sent (11/16/26), each row marked with how far we could
 * check it ourselves. This module puts this season's box scores on top, so a record set or tied this season is in
 * the list the next morning, and hands tonight's home buildings to NBA Live.
 *
 * A neutral-site game (the Cup's last rounds, games abroad) is in no team's building and is left out both ways.
 */
const PTS = 3, MIN = 2, SIDE = 0;   // columns of a player's line in the results store (src/situations/trends.js IX)

/** rows: this season's games from the results store; names: { id: name }. → { TRI: { arena, pts, holders, check, season? } } */
export function arenaRecords(data, rows = [], names = {}) {
  const out = {};
  for (const a of data?.arenas || []) out[a.team] = { arena: a.arena, pts: a.pts, holders: a.holders.map((h) => ({ ...h })), check: a.check };
  for (const g of [...rows].sort((x, y) => x.d.localeCompare(y.d))) {
    const R = out[g.h];
    if (!R || g.n || !g.pl || g.d <= (data.asOf || "")) continue;
    for (const [id, v] of Object.entries(g.pl)) {
      if (!(v[MIN] > 0) || !(v[PTS] >= R.pts)) continue;
      const h = { player: names[id] || id, opp: v[SIDE] === 0 ? g.a : g.h, date: g.d };
      if (v[PTS] > R.pts) { R.pts = v[PTS]; R.holders = [h]; } else if (!R.holders.some((x) => x.player === h.player && x.date === h.date)) R.holders.push(h);
      R.check = "confirmed"; R.season = true;      // from our own box score
    }
  }
  return out;
}

/** Tonight's home buildings for NBA Live: { HOME: { arena, pts, who, check } } (neutral-site games left out by the caller). */
export function arenasTonight(records, homes) {
  const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}/${d.slice(2, 4)}`;
  const out = {};
  for (const t of homes) {
    const R = records[t];
    if (R) out[t] = { arena: R.arena, pts: R.pts, who: R.holders.map((h) => `${h.player} ${md(h.date)}`).join(" and "), check: R.check };
  }
  return out;
}
