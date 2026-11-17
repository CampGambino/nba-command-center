/**
 * Scoring by type from one ESPN game summary (0.95; the user, 11/17: points in the paint, fast break, second chance
 * and off turnovers, for teams and for the players who lead in them).
 *
 * Team totals, [paint, fast break, off turnovers, second chance] (MISC_KEYS):
 *   paint, fast break  ESPN's own box score lines ("Points in Paint", "Fast Break Points").
 *   off turnovers      ESPN prints "Points Conceded Off Turnovers" for each team, so a team's points off turnovers are
 *                      the number on the OTHER team's line.
 *   second chance      not in ESPN's box score: counted here from the play-by-play (points on a possession after one
 *                      of its own misses was rebounded; a rebound between two free throws of one trip is not a chance).
 *
 * Players, [paint, second chance, off turnovers] (MISC_PLAYER_KEYS), all counted from the play-by-play:
 *   paint              a made two inside the lane. ESPN's coordinates are whole feet, x 0-50 across the floor and y out
 *                      from the rim; |x - 25| <= 7 and y <= 14 fits ESPN's own team totals best.
 *   off turnovers      points on the possession that follows the other team's turnover.
 * Fast-break points are a scorer's call that the play-by-play does not carry, so there is no player number for them.
 *
 * How close the counts are, on all 205 games through 11/16/26 (410 team-games): paint points equal ESPN's team total
 * in 327 and are 0.44 a game off on average; points off turnovers equal ESPN's in 381 (7,561 counted, 7,569 printed).
 * Second-chance points have no ESPN total to check: against the nine teams' per-game figures, scored and allowed, on
 * the league's page the user sent on 11/17 they are 0.11 a game off on average (0.05 high).
 *
 * `ok` is false when the play-by-play is missing or the count of paint points is more than PAINT_TOL from ESPN's total
 * for either team: the team totals still stand, the player numbers of that game are not used.
 */
export const MISC_KEYS = ["paint", "fb", "pot", "sc"];
export const MISC_PLAYER_KEYS = ["paint", "sc", "pot"];
export const PAINT = { half: 7, deep: 14 }, PAINT_TOL = 4;

const NOT_A_TRIP = /Technical|Flagrant|Clear Path/;

export function readGameMisc(json) {
  const comp = json?.header?.competitions?.[0];
  const idOf = (ha) => String(comp?.competitors?.find((c) => c.homeAway === ha)?.team?.id ?? "");
  const home = idOf("home"), away = idOf("away");
  if (!home || !away) return null;
  const other = (t) => (t === home ? away : home);
  const espn = {};
  for (const t of json?.boxscore?.teams || []) {
    const get = (n) => { const v = Number((t.statistics || []).find((s) => s.name === n)?.displayValue); return Number.isFinite(v) ? v : null; };
    espn[String(t.team?.id)] = { paint: get("pointsInPaint"), fb: get("fastBreakPoints"), conceded: get("turnoverPoints") };
  }
  if (!espn[home] || !espn[away]) return null;
  const T = { [home]: { paint: 0, sc: 0, pot: 0 }, [away]: { paint: 0, sc: 0, pot: 0 } }, players = {};
  const add = (k, team, who, v) => { T[team][k] += v; if (who) (players[who] ??= { team, paint: 0, sc: 0, pot: 0 })[k] += v; };
  let poss = null, afterTov = false, second = false, andOne = null, midTrip = false, seen = 0;
  const take = (t, tov = false) => { if (t !== poss || tov) { poss = t; afterTov = tov; second = false; } };
  for (const p of json?.plays || []) {
    const ty = p?.type?.text || "", team = String(p?.team?.id ?? ""), who = p?.participants?.[0]?.athlete?.id ? String(p.participants[0].athlete.id) : null;
    seen++;
    if (/^End (?:Period|Game)/.test(ty)) { poss = null; afterTov = false; second = false; midTrip = false; continue; }
    if (team !== home && team !== away) continue;
    if (/^Free Throw/.test(ty)) {
      if (!NOT_A_TRIP.test(ty)) {
        if (team !== poss) take(team);
        if (p.scoringPlay) { if (second || (andOne === team && /1 of 1/.test(ty))) add("sc", team, who, 1); if (afterTov) add("pot", team, who, 1); }
      }
      andOne = null;
      // A miss that is not the last of its trip, or any missed technical or flagrant free throw, is a dead ball: the
      // "rebound" ESPN lists after it is not a second chance.
      const m = ty.match(/(\d) of (\d)/);
      midTrip = !p.scoringPlay && (NOT_A_TRIP.test(ty) || (!!m && m[1] !== m[2]));
      continue;
    }
    if (/Offensive Rebound/.test(ty)) { if (midTrip) { midTrip = false; continue; } if (team !== poss) take(team); second = true; andOne = null; continue; }
    midTrip = false;
    if (/Defensive Rebound/.test(ty)) { poss = team; afterTov = false; second = false; andOne = null; continue; }
    // Travels are typed "Traveling", and an offensive foul or a charge is a turnover even when ESPN adds no
    // "Turnover" play after it.
    if (/Turnover/.test(ty) || /^Traveling/.test(ty) || /^Offensive (?:Foul|Charge)/.test(ty)) { take(other(team), true); andOne = null; continue; }
    if (!p.shootingPlay) continue;
    if (team !== poss) take(team);
    andOne = null;
    if (!p.scoringPlay) continue;
    const v = Number(p.scoreValue) || 0, c = p.coordinate || {};
    if (second) add("sc", team, who, v);
    if (afterTov) add("pot", team, who, v);
    // A made basket ends the chance; only the free throw of an and-one still belongs to it. (Left open until the
    // other team's next play, the count ran 0.2 a game over the league's; closed here it is within 0.1.)
    andOne = second ? team : null; second = false;
    if (v === 2 && Number.isFinite(c.x) && Number.isFinite(c.y) && Math.abs(c.x - 25) <= PAINT.half && c.y <= PAINT.deep && c.y > -10) add("paint", team, who, 2);
  }
  const row = (t) => [espn[t].paint, espn[t].fb, espn[other(t)].conceded, seen ? T[t].sc : null];
  const off = (t) => (espn[t].paint == null ? Infinity : Math.abs(T[t].paint - espn[t].paint));
  const ok = seen > 0 && off(home) <= PAINT_TOL && off(away) <= PAINT_TOL;
  const pl = {};
  for (const [id, x] of Object.entries(players)) if (x.paint || x.sc || x.pot) pl[id] = [x.team === home ? 0 : 1, x.paint, x.sc, x.pot];
  return { home: row(home), away: row(away), ok, players: ok ? pl : null,
    counted: { home: [T[home].paint, T[home].pot], away: [T[away].paint, T[away].pot] } };
}
