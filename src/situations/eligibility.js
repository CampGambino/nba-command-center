/**
 * Award eligibility: the games-played rule (0.144.0; the user, 11/23, with CBA Article XXIX, Section 6: "we'll need a
 * countdown for players who are tracking for awards who may not be eligible because of the games played rule").
 *
 * The rule, as written. MVP, Defensive Player of the Year, Most Improved Player, All-NBA (1st, 2nd, 3rd) and
 * All-Defensive (1st, 2nd) need either
 *   (1) 65 regular-season games played, or
 *   (2) 62 games, a "season-ending injury" (a physician picked by the NBA and the players' union says he likely can't play
 *       through May 31), and 85% of his team's games played before that injury.
 * A game counts when he plays 20 minutes. Up to two games a season count at 15 to 19:59.
 * Out of reach of 65 he can still get in two ways, never both in one season: an Award Eligibility Grievance (his team held
 * his games or minutes down to keep him out; only when an award would raise his maximum salary or allow a designated
 * veteran contract or extension; filed within 2 days of the day 65 became impossible, and by 11:59 PM ET the day after the
 * season ends), or an Extraordinary Circumstances Challenge (he'd have reached 65 with the games extraordinary
 * circumstances cost him, counted at 20 minutes each; filed from noon ET on the last day of the regular season to
 * 11:59 PM ET the next day).
 * Rookie of the Year, Sixth Man, Clutch Player and Coach of the Year are not covered.
 *
 * ESPN's box score rounds minutes to the nearest whole minute (measured 11/23 against play-by-play seconds: in 5,529
 * player-games the difference sat between -0.5 and +0.5 minute). So an ESPN "20" can be 19:30 and an ESPN "15" can be
 * 14:30: those two values are settled by the seconds Game Flow rebuilds from the substitutions (`seconds`), and a game
 * with no answer yet is "to check" (counted as ESPN shows it, and said).
 *
 *   classify(min, sec)                    -> { kind: "full" | "short" | "under", how: "box" | "pbp" | "check" }
 *   eligibility({ rows, names, ... })     -> { players: [...], teams: {...}, counts }
 *   eligibilityLines(file, teams, today)  -> Watch List lines for tonight's teams (kind "awards")
 */
import { nameKey } from "../injuries/report.js";

export const NEED = 65, ALT = 62, ALT_SHARE = 0.85, FULL_MIN = 20, SHORT_MIN = 15, SHORT_GAMES = 2, SEASON_GAMES = 82, GRIEVANCE_DAYS = 2;
export const AWARDS = ["mvp", "dpoy", "mip", "allnba", "alldef"];
export const AWARD_LABEL = { mvp: "MVP", dpoy: "DPOY", mip: "Most Improved", allnba: "All-NBA", alldef: "All-Defensive" };
// Kalshi series behind each award (history/kalshi/awards.json, written by scripts/kalshi.js); All-NBA and All-Defensive
// add up their teams: a player can make only one of them.
export const KALSHI_SERIES = { KXNBAMVP: "mvp", KXNBADPOY: "dpoy", KXNBAMIMP: "mip", KXNBA1STTEAM: "allnba", KXNBA2NDTEAM: "allnba", KXNBA3RDTEAM: "allnba", KXNBA1STTEAMDEF: "alldef", KXNBA2NDTEAMDEF: "alldef" };

const PBP_SLACK = 0.55;   // a rebuilt total further than this from ESPN's rounded minute is a reconstruction miss: not used

/** One player-game. min = ESPN's whole minute; sec = play-by-play seconds (undefined: no Game Flow file yet; null: no good answer). */
export function classify(min, sec) {
  const m = Number(min) || 0;
  const usable = Number.isFinite(sec) && Math.abs(sec / 60 - m) <= PBP_SLACK;
  if (m === FULL_MIN || m === SHORT_MIN) {
    if (usable) return { kind: sec >= FULL_MIN * 60 ? "full" : sec >= SHORT_MIN * 60 ? "short" : "under", how: "pbp", sec: Math.round(sec) };
    return { kind: m === FULL_MIN ? "full" : "short", how: "check", why: sec === undefined ? "nofile" : "miss" };
  }
  return { kind: m > FULL_MIN ? "full" : m > SHORT_MIN ? "short" : "under", how: "box" };
}

const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** The injury report's reason, sorted for the "missed" breakdown. */
export function reasonKind(reason) {
  const r = String(reason || "");
  if (/G League/i.test(r)) return "gleague";
  if (/Suspension/i.test(r)) return "suspension";
  if (/Rest\b/i.test(r)) return "rest";
  if (/Personal|Not With Team/i.test(r)) return "personal";
  if (/Injury|Illness|Concussion/i.test(r)) return "injury";
  return "other";
}

/** Kalshi's award prices, by player name: { key: { mvp, dpoy, mip, allnba, alldef } } in cents (chance in points). */
export function awardStakes(awardsFile) {
  const out = {};
  for (const [series, list] of Object.entries(awardsFile?.series || {})) {
    const a = KALSHI_SERIES[series]; if (!a) continue;
    for (const m of list || []) {
      if (!m?.name || !(m.p > 0)) continue;
      const k = nameKey(m.name), s = (out[k] ??= {});
      s[a] = Math.min(99, (s[a] || 0) + m.p);
    }
  }
  return out;
}

/**
 * rows:     the results store's games (each with pl, and z for 0-minute appearances), regular season only
 * names:    espn id -> name
 * current:  docs/data/rosters.json `changes` (a player whose team changed since his last game: { team | null, since })
 * seconds:  { gameId: { espnId: seconds | null } } for ESPN minutes of 20 and 15 (src/gameflow buildStints)
 * listings: { date: { TRI: [{ id, status, reason }] } } each night's final injury report, matched to ids
 * tonight:  { players: [{ team, name, status, reason }], date } today's injury report (docs/data/injuries.json)
 * awards:   history/kalshi/awards.json (or null)
 * tonightTeams: teams playing today
 */
export function eligibility({ rows, names = {}, current = {}, seconds = {}, listings = {}, tonight = null, awards = null, today, through, seasonEnd = null, tonightTeams = new Set() }) {
  const games = rows.filter((g) => g.pl && g.d <= through).sort((a, b) => a.d.localeCompare(b.d) || String(a.id).localeCompare(String(b.id)));
  const teamDates = {};            // tri -> [date of each game played]
  for (const g of games) for (const t of [g.h, g.a]) (teamDates[t] ??= []).push(g.d);
  const gpBy = (tri, d) => { const L = teamDates[tri] || []; let n = 0; while (n < L.length && L[n] <= d) n++; return n; };
  const P = {};
  for (const g of games) {
    const z = new Set(g.z || []);
    for (const [id, v] of Object.entries(g.pl)) {
      const min = v[2], zero = z.has(id);
      if (!(min > 0) && !zero) continue;                                  // DNP: listed, didn't play
      const team = v[0] === 0 ? g.h : g.a;
      const c = zero ? { kind: "under", how: "box" } : classify(min, seconds[g.id]?.[id]);
      (P[id] ??= []).push({ d: g.d, id: g.id, team, opp: v[0] === 0 ? g.a : g.h, min, ...c });
    }
  }
  const stakes = awardStakes(awards);
  const tonightBy = {};
  if (tonight && (!tonight.date || tonight.date === today)) for (const p of tonight.players || []) tonightBy[`${p.team}|${nameKey(p.name)}`] = { status: p.status, reason: p.reason || null };
  const listedOn = (d, tri, id) => (listings[d]?.[tri] || []).find((x) => x.id === id) || null;

  const players = [];
  for (const [id, apps] of Object.entries(P)) {
    const name = names[id] || id;
    let full = 0, short = 0, under = 0, check = 0, checkLater = 0, q = 0;
    const qAt = {};                                                      // date -> qualifying games through that date
    const border = [];
    for (const a of apps) {
      if (a.kind === "full") { full++; q++; }
      else if (a.kind === "short") { short++; if (short <= SHORT_GAMES) q++; }
      else under++;
      if (a.how === "check") { check++; if (a.why === "nofile") checkLater++; }
      if (a.how !== "box") border.push({ d: a.d, opp: a.opp, min: a.min, ...(a.sec != null ? { sec: a.sec } : {}), counted: a.kind === "full" || (a.kind === "short" && short <= SHORT_GAMES), how: a.how, ...(a.why ? { why: a.why } : {}) });
      qAt[a.d] = q;
    }
    const last = apps[apps.length - 1], moved = current[id];
    const team = moved ? moved.team || null : last.team;
    // team games: the games of each team he played for, from his first game with it to his last (his current team: through today)
    const stints = [];
    for (const a of apps) { const s = stints[stints.length - 1]; if (s && s.team === a.team) s.to = a.d; else stints.push({ team: a.team, from: a.d, to: a.d }); }
    if (team && stints[stints.length - 1].team === team) stints[stints.length - 1].to = through;
    let avail = 0; for (const s of stints) avail += (teamDates[s.team] || []).filter((d) => d >= s.from && d <= s.to).length;
    // games his team played that he didn't count in, and why (his first team's games before his first game count only
    // when he was on its injury report that night: before that he may not have been on the roster)
    const missed = { short: 0, injury: 0, rest: 0, personal: 0, suspension: 0, gleague: 0, other: 0, unlisted: 0 };
    const counted = new Set(); { let s = 0; for (const a of apps) { if (a.kind === "short") s++; if (a.kind === "full" || (a.kind === "short" && s <= SHORT_GAMES)) counted.add(`${a.team}|${a.d}`); } }
    const played = new Set(apps.map((a) => `${a.team}|${a.d}`));
    const span = stints.map((s, i) => ({ ...s, from: i === 0 ? "0000-00-00" : s.from }));
    let earlyListed = 0;
    for (const s of span) for (const d of teamDates[s.team] || []) {
      if (d < s.from || d > s.to || counted.has(`${s.team}|${d}`)) continue;
      const L = listedOn(d, s.team, id);
      if (d < stints[0].from && s === span[0]) { if (!L || /Available/i.test(L.status)) continue; earlyListed++; }
      if (played.has(`${s.team}|${d}`)) missed.short++;
      else if (L && !/Available/i.test(L.status)) missed[reasonKind(L.reason)]++;
      else missed.unlisted++;
    }
    const left = team ? Math.max(0, SEASON_GAMES - (teamDates[team] || []).length) : null;
    const need = Math.max(0, NEED - q);
    const canMiss = left == null ? null : left - need;
    const status = q >= NEED ? "in" : left == null ? "unsigned" : canMiss < 0 ? "out" : "alive";
    // the day 65 went out of reach: walk his team's dates (the team he was with on each date)
    let outSince = null;
    if (status === "out") {
      const dates = [...new Set(stints.flatMap((s) => (teamDates[s.team] || []).filter((d) => d >= (s === stints[0] ? "0000" : s.from) && d <= s.to)))].sort();
      let qq = 0, run = null;
      for (const d of dates) {
        if (qAt[d] != null) qq = qAt[d];
        const t = (stints.find((s) => d >= s.from && d <= s.to) || stints[0]).team;
        const out = qq + (SEASON_GAMES - gpBy(t, d)) < NEED;
        if (out && !run) run = d; else if (!out) run = null;
      }
      outSince = run;
    }
    const totalAvail = avail + earlyListed;
    const rate = totalAvail ? q / totalAvail : 0;
    const pace = left == null ? null : Math.min(q + left, Math.round(q + rate * left));
    const stake = stakes[nameKey(name)] || null;
    const best = stake ? AWARDS.filter((k) => stake[k]).sort((x, y) => stake[y] - stake[x])[0] : null;
    const inj = team ? tonightBy[`${team}|${nameKey(name)}`] || null : null;
    const row = {
      id, name, team, q, full, short, shortUsed: Math.min(short, SHORT_GAMES), under, check, checkLater, apps: apps.length, teamGames: totalAvail,
      left, need, canMiss, status, pace, rate: Math.round(rate * 1000) / 1000, missed,
      ...(outSince ? { outSince, grievanceBy: addDays(outSince, GRIEVANCE_DAYS) } : {}),
      // out of reach of 65: the 62-game path is open while 62 is still reachable
      ...(status === "out" ? { alt: q + left >= ALT, share: totalAvail ? Math.round((q / totalAvail) * 1000) / 1000 : null } : {}),
      ...(moved ? { was: moved.was || null, moved: moved.since || null } : {}),
      ...(stake ? { stake, best } : {}),
      ...(inj && !/Available/i.test(inj.status) ? { tonight: inj } : {}),
      ...(team && tonightTeams.has(team) ? { plays: 1 } : {}),
      border,
    };
    players.push(row);
  }
  const tier = (p) => (p.status === "out" ? 0 : p.status === "alive" ? 1 : 2);
  players.sort((a, b) => tier(a) - tier(b) || (a.canMiss ?? 99) - (b.canMiss ?? 99) || b.q - a.q);
  const teams = Object.fromEntries(Object.entries(teamDates).map(([t, L]) => [t, { gp: L.length, left: SEASON_GAMES - L.length }]));
  const cand = players.filter((p) => p.stake);
  return {
    players, teams, seasonEnd,
    challengeWindow: seasonEnd ? { from: `${seasonEnd} 12:00 PM ET`, to: `${addDays(seasonEnd, 1)} 11:59 PM ET` } : null,
    counts: { players: players.length, candidates: cand.length, candidatesOut: cand.filter((p) => p.status === "out").length, toCheck: players.reduce((n, p) => n + p.check, 0), toCheckLater: players.reduce((n, p) => n + p.checkLater, 0), borderline: players.reduce((n, p) => n + p.border.length, 0) },
  };
}

// A line is for someone the market gives a real chance at a covered award, and only once his margin is thin.
export const LINE_STAKE = 10, LINE_MVP = 3, LINE_MARGIN = 8, LINE_OUT_DAYS = 10;
export const isCandidate = (p) => !!p.stake && ((p.stake.mvp || 0) >= LINE_MVP || AWARDS.some((k) => (p.stake[k] || 0) >= LINE_STAKE));
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const pl = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
export const stakeText = (p) => (p.best ? `${AWARD_LABEL[p.best]} ${p.stake[p.best]}% on Kalshi` : "");

/** Watch List lines for tonight's teams. */
export function eligibilityLines(file, teams, today) {
  if (!file?.players || (file.today && today && file.today !== today)) return [];
  const out = [];
  for (const p of file.players) {
    if (!p.team || !teams.has(p.team) || !isCandidate(p)) continue;
    const s = Math.max(...AWARDS.map((k) => p.stake[k] || 0)) / 100;
    const sitting = p.tonight && /Out|Doubtful/i.test(p.tonight.status);
    const tn = p.tonight ? ` · ${p.tonight.status.toLowerCase()} tonight${p.tonight.reason ? ` (${p.tonight.reason.replace(/^Injury\/Illness - /, "")})` : ""}` : "";
    if (p.status === "alive" && p.canMiss <= LINE_MARGIN) {
      const after = sitting ? `; ${p.canMiss - 1 < 0 ? "out of reach" : `${p.canMiss - 1} after tonight`}` : "";
      out.push({ team: p.team, player: p.name, kind: "awards", key: `elig|${p.id}`,
        text: `${p.name} (${stakeText(p)}): ${p.canMiss === 0 ? "can't miss another game" : `can miss ${pl(p.canMiss, "more game")}`} and stay award-eligible under the 65-game rule (${p.q} of his team's ${p.teamGames} games counted, ${p.left} left)${tn}${after}`,
        score: Math.min(4.6, 2.4 + s + 0.18 * (LINE_MARGIN - p.canMiss) + (sitting ? 0.4 : 0)) });
    } else if (p.status === "out" && p.outSince && Date.parse(today) - Date.parse(p.outSince) <= LINE_OUT_DAYS * 864e5) {
      out.push({ team: p.team, player: p.name, kind: "awards", key: `elig|${p.id}`,
        text: `${p.name} (${stakeText(p)}) can no longer reach 65 games: out of award eligibility since ${md(p.outSince)} (${p.q} games counted, ${p.left} left)${p.alt ? "; the 62-game season-ending-injury path is still open" : ""}`,
        score: Math.min(4.8, 3.4 + s) });
    }
  }
  return out;
}
