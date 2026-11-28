/**
 * 0.181.0: a game counts for a player only if he played in it, checked against every source we hold.
 *
 * The user, 11/28/26, on "Damian Lillard … was held scoreless for the first time since at least 2016-17 (598 games):
 * 0-for-0 with 0 assists and 0 rebounds in 0 minutes vs GSW" (he sat out with a calf injury): "it's imperative to count
 * players only for games they have played. you have access to the injury reports and espn/nba.com box scores. this
 * should not have been presented as fact".
 *
 * What happened: ESPN's box score, read minutes after the final, listed him with a line of zeros and no did-not-play
 * mark. One reading from one source was taken as "in the game for a few seconds" (row.z), which every page counts as a
 * game played. The league's own injury report had him Out that night; nobody asked it.
 *
 * Three locks now, the first where the box score is read and the other two here, on every build, over the whole season:
 *   1. ESPN's own summary must show him on the floor (src/espn/parse.js readPlayerBox): a number in his line, or a play
 *      with his name. A line of zeros alone is not a game.
 *   2. The league's injury report for that night (history/injuries): a player listed Out did not play.
 *   3. NBA.com's check-in and check-out times (history/nbacom, the nightly pull): a player with no stint did not play.
 * A 0-minute game that fails 2 or 3 is taken out of row.z, so no page counts it. A game with minutes that fails one is
 * left alone and said in the build log: minutes in a box score that adds up to the final is the stronger claim, and the
 * disagreement is for a person to look at.
 *
 * NBA.com's names are matched to ESPN's by name (accents and suffixes ignored). "No stint" is only said when every
 * NBA.com name on his team matched an ESPN player who played: a spelling we can't match must not cost a real game.
 */
const plain = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(?:jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

/** Did he play in this game? pl row minutes, or the few-seconds mark (z). minIx: where minutes sit in the row (2 in the store, 1 in a team file). */
export const playedIn = (g, id, minIx = 2) => g?.pl?.[id]?.[minIx] > 0 || (g?.z || []).includes(String(id));

/**
 * rows: the results rows (pl, z), changed in place: a 0-minute game another source rules out leaves row.z.
 * names: { espnId: name }. nba: { "date|AWAY|HOME" or "date|TEAM": NBA.com game file ({ rot: { TRI: [[nbaId, name, in, out, …]] } }) }.
 * outByDate: { date: { TRI: Set(espnId) } } listed Out on that night's injury report.
 * → { dropped: [{ id, name, d, game, why }], added: [{ id, name, d, game, sec }], warn: [text], checked: { games, nba, inj, zero } }
 * 0.184.0: a player ESPN has not playing whom NBA.com has on the floor (a stint, however short) is added to row.z.
 */
export function auditPlayed({ rows, names = {}, nba = {}, outByDate = {} }) {
  const dropped = [], added = [], warn = [], checked = { games: 0, nba: 0, inj: 0, zero: 0 };
  for (const g of rows || []) {
    if (!g.pl) continue;
    checked.games++;
    const game = `${g.d} ${g.a} @ ${g.h}`, outs = outByDate[g.d];
    // by date and teams, or (0.183.0) by date and either team: one NBA.com file's heading has no home team (IND 11/7/26)
    // and its check-in times are all there. A team plays once a day.
    const file = nba[`${g.d}|${g.a}|${g.h}`] || nba[`${g.d}|${g.h}`] || nba[`${g.d}|${g.a}`];
    if (file) checked.nba++;
    if (outs) checked.inj++;
    for (const side of [0, 1]) {
      const tri = side === 0 ? g.h : g.a, ids = Object.keys(g.pl).filter((id) => g.pl[id][0] === side);
      const rot = file?.rot?.[tri]?.length ? file.rot[tri] : null;
      const stint = new Map();                                             // plain NBA.com name → seconds on the floor
      for (const r of rot || []) stint.set(plain(r[1]), (stint.get(plain(r[1])) || 0) + (r[3] - r[2]) / 10);
      const mine = new Set(ids.filter((id) => playedIn(g, id)).map((id) => plain(names[id])));
      const unmatched = [...stint.keys()].filter((k) => !mine.has(k));       // on NBA.com's floor, not among ESPN's players who played
      for (const id of ids) {
        const name = names[id] || id, k = plain(names[id]), min = g.pl[id][2], counted = playedIn(g, id);
        const out = !!outs?.[tri]?.has(id), has = rot ? stint.has(k) : null;
        if (!counted) {
          // 0.184.0 (the user, 11/28: "can you get around the zero-minute game by checking seconds played"): NBA.com's
          // check-in and check-out times are seconds on the floor. A stint there is a game, even one that starts and ends on
          // the same tick of the clock (Trey Lyles, 3/16/19: in and out with 27.9 seconds left, between free throws), unless
          // the injury report had him Out, which is said instead.
          if (has && !out) { (g.z ??= []).push(String(id)); added.push({ id: String(id), name, d: g.d, game, team: tri, sec: Math.round(stint.get(k) * 10) / 10 }); }
          else if (has) warn.push(`${game}: NBA.com has ${name} on the floor for ${Math.round(stint.get(k))} seconds, and the injury report had him Out: not counted (look at this one)`);
          continue;
        }
        if (!(min > 0)) checked.zero++;
        const why = [];
        if (out) why.push("listed Out on the league's injury report that night");
        if (has === false && !unmatched.length) why.push("no check-in in NBA.com's rotations");
        if (!why.length) {
          if (has === false && !(min > 0)) warn.push(`${game}: ${name} (0 minutes) is not in NBA.com's rotations under that name, and NBA.com has ${unmatched.join(", ")} unmatched: kept, not confirmed`);
          continue;
        }
        if (min > 0) { warn.push(`${game}: ESPN gives ${name} ${min} minutes, but he is ${why.join(" and has ")}: kept (look at this one)`); continue; }
        g.z = (g.z || []).filter((x) => x !== String(id));
        if (!g.z.length) delete g.z;
        dropped.push({ id: String(id), name, d: g.d, game, team: tri, why: why.join("; ") });
      }
    }
  }
  return { dropped, added, warn, checked };
}
