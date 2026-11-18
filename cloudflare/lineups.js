/**
 * Lineups watcher (runs inside the ncc-articles Worker, on the same 5-minute cron).
 *
 * Reads the NBA's daily lineups file (the data behind nba.com/players/todays-lineups) and posts to the
 * user's private #lineups channel (secret LINEUPS_WEBHOOK) when a team's starting five is CONFIRMED,
 * before tip-off. Each post says what changed:
 *   - from the five NBA.com first listed as "Expected" that day, and
 *   - from the team's starters in its last game (our own box-score file on GitHub).
 * If a confirmed five changes again before tip, a "lineup change" post follows. After tip-off, who actually
 * started (ESPN's box score) is checked against the confirmed five: a late scratch posts "started differently";
 * a team that never had a confirmed five before tip gets its starters posted from the box score.
 *
 * For the user's personal use only (their decision, 11/12; NBA.com terms: personal, non-commercial).
 * So: the channel is private; nothing is published on the public site; no lineup history is kept
 * (KV holds only today's state, for spotting changes); NBA.com's file is read only from 90 minutes before
 * each scheduled tip (every 5 minutes; every 30 seconds from 35 to 10 minutes out; every 3 minutes after that),
 * then ESPN's box every minute after tip.
 */
export const FEED = (yyyymmdd) => `https://stats.nba.com/js/data/leaders/00_daily_lineups_${yyyymmdd}.json`;
export const ESPN_SCOREBOARD = (yyyymmdd) => `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${yyyymmdd}`;
export const ESPN_SUMMARY = (id) => `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`;
/** ESPN's team abbreviations that differ from the NBA's. */
export const ESPN_TRI = { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS" };
const triOf = (a) => ESPN_TRI[a] || a;
export const TEAM_FILE = (tri) => `https://raw.githubusercontent.com/CampGambino/nba-command-center/main/docs/data/teams/${tri}.json`;
import { latestReport, statusOnReport } from "./injurypdf.js";
import { tfetch, bodyJson, bodyText, LIMIT_MS } from "./net.js";
export const INJURIES_FILE = "https://raw.githubusercontent.com/CampGambino/nba-command-center/main/docs/data/injuries.json";
const POS_ORDER = { PG: 0, SG: 1, G: 1.5, SF: 2, F: 2.5, PF: 3, C: 4 };

export const etParts = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, minute: +p.minute };
};
export const etClock = (ms) => new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
export const nameKey = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.'’]/g, "").replace(/-/g, " ").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ").replace(/\s+/g, " ").trim();
/**
 * The feed's timestamps ("2026-11-12T18:34:00") are Eastern clock time without a zone. 11/12/26 showed it: DET/WAS
 * stamped 18:34 were first seen by us at 6:35 PM ET; read as UTC they had shown as 1:34 PM, 5 hours early.
 */
export const etOffsetMs = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000; // ET clock minus UTC: -5 h (EST) or -4 h (EDT)
};
export const feedTime = (t) => {
  if (!t) return null;
  if (/Z|[+-]\d\d:?\d\d$/.test(t)) return Date.parse(t);
  const wall = Date.parse(`${t}Z`); // the clock reading, as if it were UTC
  if (Number.isNaN(wall)) return null;
  const guess = wall - etOffsetMs(wall);
  return wall - etOffsetMs(guess); // second pass gets the offset right on the night the clocks change
};

/**
 * The feed -> [{ gameId, gameStatus, statusText, teams: [{ tri, opp, home, status, at, starters: [{ name, pos }], inactive: [name] }] }]
 * A team's status is "Confirmed" when all five starters are confirmed, else "Expected" (or "None" if no five yet).
 */
export function parseLineups(json) {
  const out = [];
  for (const g of json?.games || []) {
    const sides = [["homeTeam", true], ["awayTeam", false]];
    const teams = sides.map(([k, home]) => {
      const t = g[k] || {}, pl = t.players || [];
      const starters = pl.filter((p) => p.position).map((p) => ({ name: p.playerName || `${p.firstName} ${p.lastName}`, pos: p.position, status: p.lineupStatus, at: feedTime(p.timestamp) }))
        .sort((a, b) => (POS_ORDER[a.pos] ?? 9) - (POS_ORDER[b.pos] ?? 9));
      const status = starters.length < 5 ? "None" : starters.every((p) => p.status === "Confirmed") ? "Confirmed" : "Expected";
      return { tri: t.teamAbbreviation, home, status, at: Math.max(0, ...starters.map((p) => p.at || 0)) || null, starters: starters.map(({ name, pos }) => ({ name, pos })),
        inactive: pl.filter((p) => /inactive/i.test(p.rosterStatus || "")).map((p) => p.playerName || `${p.firstName} ${p.lastName}`) };
    });
    teams[0].opp = teams[1].tri; teams[1].opp = teams[0].tri;
    out.push({ gameId: g.gameId, gameStatus: g.gameStatus, statusText: g.gameStatusText || "", teams });
  }
  return out;
}

/** Who's in and out between two fives (names). */
export function diff(before, after) {
  const b = new Set(before.map(nameKey)), a = new Set(after.map(nameKey));
  return { in: after.filter((n) => !b.has(nameKey(n))), out: before.filter((n) => !a.has(nameKey(n))) };
}

/** Starters in a team's last game, from our box-score file ({ names, games: [{ d, opp, pl: { id: [starter, …] } }] }). */
export function lastStarters(file, beforeYmd) {
  const games = (file?.games || []).filter((g) => !beforeYmd || g.d < beforeYmd).sort((a, b) => a.d.localeCompare(b.d));
  const g = games[games.length - 1];
  if (!g) return null;
  const names = Object.entries(g.pl || {}).filter(([, r]) => r[0] === 1).map(([id]) => file.names?.[id] || id);
  return names.length === 5 ? { d: g.d, opp: g.opp, names } : null;
}

/**
 * A swap that doesn't fit the season so far: a player going OUT who has started every game he has played (3+)
 * and isn't on tonight's injury report. 11/12/26: NBA.com briefly had Justin Edwards (0 starts) in for Jaylen
 * Brown (11 of 11, not on the report); a different five, with Brown, started. Returns a note or null.
 */
/** Regulars missing from the five who aren't on the site's injury report (a reason to read the league's latest). */
export function unlistedRegulars(file, injuries, out, tri, ymd) {
  if (!file || !out?.length) return [];
  const ids = Object.fromEntries(Object.entries(file.names || {}).map(([id, n]) => [nameKey(n), id]));
  const games = (file.games || []).filter((g) => !ymd || g.d < ymd);
  const listed = new Set((injuries && (!ymd || injuries.date === ymd) ? injuries.players || [] : []).filter((p) => p.team === tri).map((p) => nameKey(p.name)));
  return out.filter((n) => { const c = startCount(file, ids, games, n); return c.gp >= 3 && c.gs === c.gp && !listed.has(nameKey(n)); });
}
function startCount(file, ids, games, name) {
  const id = ids[nameKey(name)]; let gp = 0, gs = 0;
  if (id) for (const g of games) { const r = g.pl?.[id]; if (r && (r[1] > 0 || r[0] === 1)) { gp++; if (r[0] === 1) gs++; } }
  return { gp, gs };
}
/**
 * A swap worth checking: a player out of the five who has started every game he's played and isn't on the injury
 * report. `report` (0.68) is the league's latest report as the Worker read it ({ asOf, text }, cloudflare/injurypdf.js):
 * a player on it isn't flagged, and his status is said instead (11/14: Porter Jr. Out, personal reasons, 7:15 PM).
 */
export function suspicion(file, injuries, out, inn, tri, ymd, report = null) {
  if (!file || !out?.length) return null;
  const ids = Object.fromEntries(Object.entries(file.names || {}).map(([id, n]) => [nameKey(n), id]));
  const games = (file.games || []).filter((g) => !ymd || g.d < ymd);
  const count = (name) => startCount(file, ids, games, name);
  const cand = unlistedRegulars(file, injuries, out, tri, ymd);
  const onReport = report ? cand.map((n) => [n, statusOnReport(report, n)]).filter(([, st]) => st) : [];
  const odd = cand.filter((n) => !onReport.some(([m]) => m === n));
  const notes = onReport.map(([n, st]) => `🩹 ${n}: ${st.status}${st.reason ? ` (${st.reason})` : ""} on the ${report.asOf} injury report.`);
  if (!odd.length) return notes.length ? notes.join("\n") : null;
  const asOf = report?.asOf || (injuries?.report?.asOf ? String(injuries.report.asOf).replace(/^\S+\s+/, "").replace(/^0/, "") : null);
  const who = odd.map((n) => { const c = count(n); return `${n} has started all ${c.gp} games he's played and isn't on the ${asOf ? `${asOf} ` : ""}injury report`; }).join("; ");
  const subs = (inn || []).map((n) => { const c = count(n); return `${n} ${c.gs} start${c.gs === 1 ? "" : "s"} in ${c.gp} game${c.gp === 1 ? "" : "s"}`; }).join(", ");
  return [...notes, `⚠️ **Check before using:** ${who}${subs ? ` (${subs})` : ""}. Could be an NBA.com entry error; rechecking every minute until tip.`].join("\n");
}

/**
 * Context for a confirmed five, from the team's box-score file (0.74; the user's OK, 11/15: "that'll be a nice addition
 * for context"). Two kinds of line, each only when there is something to say:
 *   the five as a unit   "This five has started together 6 times this season (4-2)" / "First time this five starts
 *                        together this season" (once the team has played 3 games);
 *   a new starter        "X: first start of the season (5 games off the bench)" / "X: first game of the season" /
 *                        "X: 2nd start of the season (9 games)" for a player with 2 starts or fewer in 5+ games.
 * Who is OUT of the five isn't called "off the bench" here: before tip the program can't tell a benching from an absence
 * (the injury-report note and the warning cover those).
 */
export function lineupContext(file, names, ymd = null) {
  if (!file || names?.length !== 5) return [];
  const ids = Object.fromEntries(Object.entries(file.names || {}).map(([id, n]) => [nameKey(n), id]));
  const games = (file.games || []).filter((g) => !ymd || g.d < ymd);
  if (!games.length) return [];
  const out = [];
  const want = names.map((n) => ids[nameKey(n)]);
  if (games.length >= 3) {
    let n = 0, w = 0;
    if (want.every(Boolean)) for (const g of games) {
      const five = Object.entries(g.pl || {}).filter(([, r]) => r[0] === 1).map(([id]) => id);
      if (five.length === 5 && want.every((id) => five.includes(id))) { n++; if (g.pf > g.pa) w++; }
    }
    out.push(n ? `This five has started together ${n === 1 ? "once" : `${n} times`} this season (${w}-${n - w}; ${games.length} team games).` : `First time this five starts together this season (${games.length} team games).`);
  }
  const ordinal = (k) => (k === 1 ? "1st" : k === 2 ? "2nd" : k === 3 ? "3rd" : `${k}th`);
  for (const name of names) {
    const c = startCount(file, ids, games, name);
    if (c.gp === 0) { if (games.length >= 3) out.push(`${name}: first game of the season.`); }
    else if (c.gs === 0) out.push(`${name}: first start of the season (${c.gp} game${c.gp === 1 ? "" : "s"} off the bench).`);
    else if (c.gs <= 2 && c.gp >= 5) out.push(`${name}: ${ordinal(c.gs + 1)} start of the season (${c.gp} games).`);
  }
  return out;
}

const md = (ymd) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const list = (xs) => xs.join(", ");

/** The Discord embed for a team's confirmed five (or a change to it). */
export function lineupEmbed(game, team, { expected = null, last = null, previous = null, test = false, kind = null, warn = null, context = null } = {}) {
  const lines = team.starters.map((p) => p.name); // in position order, PG to C (the user: no labels)
  const notes = [];
  if (previous) { const d = diff(previous, team.starters.map((p) => p.name)); if (d.in.length) notes.push(`🔄 **${kind === "tip" ? "Started differently than confirmed" : "Changed after it was confirmed"}:** in ${list(d.in)} · out ${list(d.out)}`); }
  if (last) {
    const d = diff(last.names, team.starters.map((p) => p.name));
    notes.push(d.in.length ? `**vs last game** (${md(last.d)} vs ${last.opp}): in **${list(d.in)}** · out ${list(d.out)}` : `Same five as last game (${md(last.d)} vs ${last.opp}).`);
  }
  if (expected) { const d = diff(expected, team.starters.map((p) => p.name)); if (d.in.length) notes.push(`**vs expected earlier today:** in ${list(d.in)} · out ${list(d.out)}`); }
  if (context?.length) notes.push(context.map((c) => `📌 ${c}`).join("\n"));
  if (warn) notes.push(warn);
  if (team.inactive.length) notes.push(`Inactive: ${list(team.inactive)}`);
  const changed = notes.some((n) => /^\*\*vs|^🔄/.test(n) && /in \*\*|in [A-Z]/.test(n));
  return {
    author: { name: `${test ? "TEST (last night's data) · " : ""}${kind === "tip" ? (previous ? "STARTED DIFFERENTLY" : "Starters at tip (none confirmed before)") : previous ? "LINEUP CHANGE" : "Confirmed starters"} · ${kind === "tip" ? "ESPN box score" : "NBA.com"}` },
    title: `${team.tri} ${team.home ? "vs" : "@"} ${team.opp}${game.statusText && !/final/i.test(game.statusText) ? ` · ${game.statusText}` : ""}`.slice(0, 256),
    description: [lines.join("\n"), notes.join("\n")].filter(Boolean).join("\n\n").slice(0, 4000),
    color: previous ? 0xef4444 : changed ? 0xf59e0b : 0x22c55e,
    footer: { text: kind === "tip" ? "Checked after tip-off" : `Confirmed ${team.at ? `${etClock(team.at)} ET` : "(time not given)"}` },
  };
}

/**
 * An earlier card once a newer one replaces it (a change before tip, or different starters at tip): greyed,
 * and its header says so, so nobody reads the old five as the current one.
 */
export function supersededEmbed(embed, why) {
  return { ...embed, color: 0x6b7280, author: { name: `⚠️ REPLACED (${why}) · see the newer post`.slice(0, 256) } };
}
async function editDiscord(url, id, payload) {
  if (!id || id === true) return false;
  try { const res = await tfetch(`${url}/messages/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }) }, LIMIT_MS.discord); return res.ok; } catch { return false; }
}

/** Who started, by team, from an ESPN game summary -> { TRI: [{ name, pos }] } (only teams with five starters). */
export function espnStarters(summary) {
  const out = {};
  for (const t of summary?.boxscore?.players || []) {
    const a = (t.statistics?.[0]?.athletes || []).filter((x) => x.starter);
    if (a.length === 5) out[triOf(t.team?.abbreviation)] = a.map((x) => ({ name: x.athlete?.displayName, pos: x.athlete?.position?.abbreviation || "" }))
      .sort((p, q) => (POS_ORDER[p.pos] ?? 9) - (POS_ORDER[q.pos] ?? 9));
  }
  return out;
}

/** Posts; returns the message id (or true if Discord gave none), false on failure. */
async function postDiscord(url, payload) {
  for (let attempt = 0; attempt < 3; attempt++) {
    // 0.73: a time limit; a request that times out or can't connect counts as a failed post (tried again next minute).
    const res = await tfetch(`${url}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "NBA Command Center · Lineups", allowed_mentions: { parse: [] }, ...payload }) }, LIMIT_MS.discord);
    if (res.ok) { const m = await res.json().catch(() => null); return m?.id || true; }
    if (res.status === 429) { const b = await res.json().catch(() => ({})); await new Promise((r) => setTimeout(r, Math.ceil((b.retry_after || 1) * 1000) + 200)); continue; }
    return false;
  }
  return false;
}

export async function readFeed(yyyymmdd) {
  // 0.73: 8 seconds at most (the next read is 30 seconds on); a slow or failed read is "not this time", never an error.
  const res = await tfetch(FEED(yyyymmdd), { redirect: "manual", headers: { Accept: "application/json", Referer: "https://www.nba.com/", "User-Agent": "ncc-lineups/1.0 (personal use)" } }, LIMIT_MS.feed);
  if (res.status === 301 || res.status === 302) return { ok: false, status: res.status, note: "not posted yet" };
  if (!res.ok) return { ok: false, status: res.status, ...(res.status === 504 && res.statusText ? { note: res.statusText } : {}) };
  const text = await bodyText(res);
  if (text == null) return { ok: false, status: res.status, note: "cut off" };
  try { return { ok: true, status: res.status, json: JSON.parse(text) }; } catch { return { ok: false, status: res.status, note: "not JSON" }; }
}

// 0.107 (the user's yes, 11/18): the live box score file marks the five starters too, and on 11/16 it had them first for
// 11 of 16 teams (median 80 seconds sooner, up to 340). It does not exist until 20 to 30 minutes before tip (403 until
// then), so it is read beside the lineups file, never instead of it: whichever shows a team's five first is posted.
export const BOX = (gameId) => `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`;
export const BOX_FROM = 40, BOX_MAX = 8; // minutes before tip from which it is tried; files read per run at most
export async function readBox(gameId) {
  const res = await tfetch(BOX(gameId), { headers: { Accept: "application/json", Referer: "https://www.nba.com/", "User-Agent": "ncc-lineups/1.0 (personal use)" } }, LIMIT_MS.feed);
  if (!res.ok) return { ok: false, status: res.status };
  const text = await bodyText(res);
  if (text == null) return { ok: false, status: res.status, note: "cut off" };
  try { return { ok: true, status: res.status, json: JSON.parse(text) }; } catch { return { ok: false, status: res.status, note: "not JSON" }; }
}
/** The box score file in parseLineups' shape: only teams that show exactly five starters, each "Confirmed", src "box". */
export function parseBoxStarters(json, gameId = null) {
  const g = json?.game;
  if (!g) return null;
  const tris = [g.homeTeam?.teamTricode, g.awayTeam?.teamTricode];
  const side = (t, home, i) => {
    const five = (t?.players || []).filter((p) => String(p.starter) === "1");
    if (!t?.teamTricode || five.length !== 5) return null;
    const starters = five.map((p) => ({ name: String(p.name || `${p.firstName || ""} ${p.familyName || ""}`).trim(), pos: p.position || "" }));
    if (starters.some((p) => p.name.length < 3) || new Set(starters.map((p) => nameKey(p.name))).size !== 5) return null; // a five is five different names, or it is not posted
    return { tri: t.teamTricode, opp: tris[1 - i], home, status: "Confirmed", at: null, src: "box", inactive: [], starters };
  };
  return { gameId: g.gameId || gameId, gameStatus: g.gameStatus, statusText: "", teams: [side(g.homeTeam, true, 0), side(g.awayTeam, false, 1)].filter(Boolean) };
}

/** Today's games from ESPN's scoreboard: [{ id, tip (ms, scheduled), teams: [TRI, TRI] }]. */
export function readSchedule(board) {
  return (board?.events || []).map((e) => ({ id: e.id, tip: Date.parse(e.date), teams: (e.competitions?.[0]?.competitors || []).map((c) => triOf(c.team?.abbreviation)) }))
    .filter((g) => g.teams.length === 2 && !Number.isNaN(g.tip));
}

// The timing the user set (11/14, fourth version, after two nights' diagnostics: 13 games' NBA.com stamps 19-30 minutes
// before tip, four teams first seen at the old window's last minute), by minutes before each game's scheduled tip:
//   90 → 35: NBA.com's file every 5 minutes (90, 85, … 35);
//   35 → 10: every 30 seconds (34:30, 34, 33:30, … 10);
//   10 → 2:  every 3 minutes (9, 6, 3);
//   from tip: ESPN's box every minute until it shows who started (giving up 45 minutes after).
// (11/13: every minute from 34 to 16. Until 11/13: every 20 seconds from 31 to 29 out, then every 3 minutes from 29.)
// The 1-minute cron run reads at :00 and :30 of its minute when a game is due.
export const WINDOW_MIN = 90, FAST_FROM = 35, FAST_TO = 10, TIP_GIVE_UP_MIN = 45;
export const BURST_EVERY_S = 30;

/** Is NBA.com's file due at time t (ms) for a game tipping at tip (ms)? */
export function feedDue(tip, t) {
  const m = (tip - t) / 60e3; // minutes before tip
  if (m <= 0 || m > WINDOW_MIN) return false;
  const half = Math.round(m * 2) / 2;
  if (Math.abs(m - half) > 1 / 120) return false; // whole and half minutes only
  if (half < FAST_FROM && half >= FAST_TO) return true; // 34:30 … 10: every 30 seconds
  if (half !== Math.round(half)) return false;
  if (half >= FAST_FROM) return (WINDOW_MIN - half) % 5 === 0; // 90, 85, … 35
  return half % 3 === 0 && half > 0; // 9, 6, 3
}

/** What a team needs at time t: null (nothing), "pregame" (within 90 minutes of tip), or "tip". */
export function phaseOf(s, tip, now) {
  if (s.tip) return null; // starters checked after tip: done
  if (now >= tip) return now < tip + TIP_GIVE_UP_MIN * 60e3 ? "tip" : null;
  return now >= tip - WINDOW_MIN * 60e3 ? "pregame" : null;
}

/**
 * One run (every minute, from the Worker's 1-minute cron). env: { STATE (KV), LINEUPS_WEBHOOK }.
 * KV "lineups": { date, sched: [{ id, tip, teams }], teams: { TRI: { expected, posted, postedTeam, tip } }, done }; replaced
 * each day, written only when something changes (schedule, first expected five, a post, a tip check).
 * opts (the private /lineups endpoint and the checks): { dry: report without posting or saving; date: "YYYYMMDD" reads
 * that day's NBA.com file regardless of timing; test: with date, posts one sample; sleep: (ms) => Promise, for the checks }.
 */
export async function lineupCheck(env, now = Date.now(), { dry = false, date = null, test = false, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!env.LINEUPS_WEBHOOK && !dry) return { skipped: "no LINEUPS_WEBHOOK secret" };
  if (date) return lineupTest(env, date, { dry, test });
  const et = etParts(now);
  if (et.hour < 10) return { skipped: "before 10 AM ET" };
  const ymd = et.ymd, compact = ymd.replace(/-/g, "");
  const st0 = (await env.STATE.get("lineups", "json")) || {};
  const st = st0.date === ymd ? st0 : { date: ymd, sched: null, teams: {} };
  if (st.done) return { skipped: "all of today's games have tipped" };
  let changed = false;
  // 0.73: whatever this run has done (a lineup posted, a tip checked) is saved even if a later step fails, so the
  // next minute doesn't post it again.
  try {
  if (!st.sched) {
    const res = await tfetch(ESPN_SCOREBOARD(compact), {}, LIMIT_MS.espn);
    if (!res.ok) return { error: `ESPN scoreboard ${res.status}` };
    const board = await bodyJson(res);
    if (!board) return { error: "ESPN scoreboard unreadable" };
    st.sched = readSchedule(board); changed = true;
  }
  const report = { phases: {}, read: [], posted: 0 };
  for (const g of st.sched) for (const tri of g.teams) {
    const s = (st.teams[tri] ??= { expected: null, posted: null, tip: null });
    report.phases[tri] = phaseOf(s, g.tip, now);
  }
  // NBA.com's file at :00, :20 and :40 of this minute, whenever any game is due then (one read covers every game).
  const minute0 = Math.floor(now / 60e3) * 60e3;
  let boxReads = 0;
  let irep; // the league's latest injury report, read at most once a run (only when a post would warn)
  for (const off of [0, BURST_EVERY_S]) {
    const t = minute0 + off * 1000;
    const due = st.sched.some((g) => g.teams.some((tri) => phaseOf(st.teams[tri], g.tip, t) === "pregame")
      && (feedDue(g.tip, t) || (off === 0 && g.teams.some((tri) => st.teams[tri]?.suspect))));
    if (!due && !(dry && off === 0)) continue;
    if (t > Date.now()) await sleep(t - Date.now());
    const feed = await readFeed(compact);
    // 0.68: when the read really happened (a run can start late); the slot time if the clock says otherwise.
    const late = Date.now() - t, readAt = late >= 0 && late < 60e3 ? t + late : t;
    report.read.push(`${off}s nba.com ${feed.status}${feed.note ? ` (${feed.note})` : ""}`);
    const games = feed.ok ? parseLineups(feed.json) : [];
    const schedOf = (g) => st.sched.find((x) => x.teams.includes(g.teams[0]?.tri) && x.teams.includes(g.teams[1]?.tri));
    // the league's game id (the box score file is named by it) and each five's positions come from the lineups file
    for (const g of games) {
      const sg = schedOf(g);
      if (sg && g.gameId && sg.nba !== g.gameId) { sg.nba = g.gameId; changed = true; }
      for (const tm of g.teams) { const s = st.teams[tm.tri]; if (!s || tm.starters.length !== 5) continue; const pos = Object.fromEntries(tm.starters.map((p) => [nameKey(p.name), p.pos])); if (JSON.stringify(pos) !== JSON.stringify(s.pos || null)) { s.pos = pos; changed = true; } }
    }
    // 0.107: the box score file of each game inside 40 minutes with a team still unconfirmed here and in this read
    for (const sg of st.sched) {
      const m = (sg.tip - t) / 60e3;
      if (!sg.nba || boxReads >= BOX_MAX || m <= 0 || m > BOX_FROM) continue;
      const need = sg.teams.filter((tri) => phaseOf(st.teams[tri], sg.tip, t) === "pregame" && !st.teams[tri].posted && !games.some((g) => g.teams.some((tm) => tm.tri === tri && tm.status === "Confirmed")));
      if (!need.length) continue;
      boxReads++;
      let b = { ok: false, status: 0 };
      try { b = await readBox(sg.nba); } catch { /* the lineups file still covers this game */ }
      report.read.push(`${off}s box ${sg.teams.join("-")} ${b.status}${b.note ? ` (${b.note})` : ""}`);
      const bg = b.ok ? parseBoxStarters(b.json, sg.nba) : null;
      if (!bg) continue;
      bg.teams = bg.teams.filter((tm) => need.includes(tm.tri));
      for (const tm of bg.teams) { // PG-to-C order as in the lineups file, when it has the same players
        const pos = st.teams[tm.tri]?.pos || {};
        tm.starters = tm.starters.map((p) => ({ ...p, pos: pos[nameKey(p.name)] || p.pos })).sort((p, q) => (POS_ORDER[p.pos] ?? 9) - (POS_ORDER[q.pos] ?? 9));
      }
      bg.sg = sg;
      if (bg.teams.length) games.push(bg);
    }
    for (const g of games) {
      const sg = g.sg || schedOf(g);
      for (const tm of g.teams) {
        const s = st.teams[tm.tri];
        if (!sg || !s || phaseOf(s, sg.tip, t) !== "pregame") continue;
        const names = tm.starters.map((p) => p.name);
        // a five first posted from the box score file: note when the lineups file caught up (timing only)
        if (tm.status === "Confirmed" && !tm.src && s.when?.src === "box" && !s.when.feedSeen) { s.when.feedSeen = readAt; s.when.feed = tm.at; changed = true; }
        if (tm.status === "Expected" && !s.expected) { s.expected = names; changed = true; }
        // Timing (times only, for the nightly summary): when NBA.com stamped it confirmed, when we first saw it.
        if (tm.status === "Confirmed") { const w = (s.when ??= {}); if (!w.seen) { w.seen = readAt; w.slot = t; w.feed = tm.at; if (tm.src) w.src = tm.src; changed = true; } }
        if (tm.status !== "Confirmed") continue;
        const again = s.posted && diff(s.posted, names).in.length > 0;
        if (s.posted && !again) continue;
        if (dry) { (report.wouldPost ??= []).push(`${tm.tri} ${again ? "change" : "confirmed"}`); continue; }
        let last = null, file = null, injuries = null;
        try { const r = await tfetch(TEAM_FILE(tm.tri), {}, LIMIT_MS.site); if (r.ok) { file = await r.json(); if (!again) last = lastStarters(file, ymd); } } catch {}
        try { const r = await tfetch(INJURIES_FILE, {}, LIMIT_MS.site); if (r.ok) injuries = await r.json(); } catch {}
        // Who left the five: since the last post (a change), or since the team's last game (a first post).
        const base = again ? s.posted : last?.names;
        const d = base ? diff(base, names) : null;
        // 0.68: a regular missing who isn't on the site's (older) injury report: read the league's latest first.
        if (d && irep === undefined && unlistedRegulars(file, injuries, d.out, tm.tri, ymd).length) irep = await latestReport(Date.now(), (u) => tfetch(u, {}, LIMIT_MS.pdf));
        const warn = d ? suspicion(file, injuries, d.out, d.in, tm.tri, ymd, irep || null) : null;
        let context = null;
        try { context = lineupContext(file, names, ymd); } catch { /* context is an extra: the post goes out without it */ }
        const embed = lineupEmbed({ ...g, statusText: g.statusText || etClock(sg.tip) + " ET" }, tm, { expected: again ? null : s.expected, last, previous: again ? s.posted : null, warn, context });
        const id = await postDiscord(env.LINEUPS_WEBHOOK, { embeds: [embed] });
        if (id) {
          if (again && s.card) await editDiscord(env.LINEUPS_WEBHOOK, s.card.id, { embeds: [supersededEmbed(s.card.embed, `changed at ${etClock(Date.now())} ET`)] });
          s.card = { id, embed };
          s.suspect = !!warn; // read every minute until tip, to catch a correction fast
          s.posted = names; s.postedTeam = { starters: tm.starters }; changed = true; report.posted++;
          const w = (s.when ??= {});
          if (again) (w.changes ??= []).push({ seen: readAt, feed: tm.at, posted: Date.now() }); else w.posted = Date.now();
        }
      }
    }
  }
  const due = { tip: st.sched.filter((g) => g.teams.some((tri) => phaseOf(st.teams[tri], g.tip, now) === "tip")) };
  // From the scheduled tip: who actually started (ESPN's box), every minute until it's there.
  for (const g of due.tip) {
    let five = null;
    try {
      const res = await tfetch(ESPN_SUMMARY(g.id), {}, LIMIT_MS.espn);
      report.read.push(`espn ${g.id} ${res.status}`);
      if (res.ok) five = espnStarters(await res.json());
    } catch {}
    for (const tri of g.teams) {
      const s = st.teams[tri];
      if (phaseOf(s, g.tip, now) !== "tip") continue;
      let starters = five?.[tri];
      if (!starters) continue; // not in the box yet: next minute
      const opp = g.teams.find((x) => x !== tri);
      // Keep NBA.com's positions where it had them, so the order matches the confirmed post (PG to C).
      const nbaPos = Object.fromEntries((s.postedTeam?.starters || []).map((p) => [nameKey(p.name), p.pos]));
      starters = starters.map((p) => ({ ...p, pos: nbaPos[nameKey(p.name)] || p.pos })).sort((p, q) => (POS_ORDER[p.pos] ?? 9) - (POS_ORDER[q.pos] ?? 9));
      const names = starters.map((p) => p.name);
      const same = s.posted && diff(s.posted, names).in.length === 0;
      if (!same) {
        if (dry) { (report.wouldPost ??= []).push(`${tri} tip`); continue; }
        let last = null;
        if (!s.posted) { try { const r = await tfetch(TEAM_FILE(tri), {}, LIMIT_MS.site); if (r.ok) last = lastStarters(await r.json(), ymd); } catch {} }
        const home = g.teams[0] === tri; // ESPN lists home first
        const embed = lineupEmbed({ statusText: "" }, { tri, opp, home, starters, inactive: [] }, { previous: s.posted, last, kind: "tip" });
        const id = await postDiscord(env.LINEUPS_WEBHOOK, { embeds: [embed] });
        if (!id) continue;
        if (s.card) await editDiscord(env.LINEUPS_WEBHOOK, s.card.id, { embeds: [supersededEmbed(s.card.embed, "a different five started")] });
        s.card = { id, embed };
        report.posted++;
      }
      s.tip = same ? "same" : "posted"; changed = true;
      (s.when ??= {}).tipSeen = now;
    }
  }
  // Teams whose box never showed up within the window: give up quietly.
  for (const g of st.sched) for (const tri of g.teams) {
    const s = st.teams[tri];
    if (!s.tip && now >= g.tip + TIP_GIVE_UP_MIN * 60e3) { s.tip = "gave up"; changed = true; }
  }
  if (st.sched.every((g) => g.teams.every((tri) => st.teams[tri]?.tip)) && !st.done) {
    st.done = true; changed = true;
    // The night's timing: kept 8 days (times only, no lineups) and posted to #lineups as one summary.
    if (!dry && st.sched.length) {
      const timing = nightTiming(st);
      await env.STATE.put(`lineups-timing:${ymd}`, JSON.stringify(timing), { expirationTtl: 8 * 86400 });
      await postDiscord(env.LINEUPS_WEBHOOK, { embeds: [timingEmbed(timing)] });
    }
  }
  return report;
  } finally {
    if (changed && !dry) await env.STATE.put("lineups", JSON.stringify(st));
  }
}

/** The night's timing per team: minutes before the scheduled tip that NBA.com confirmed and we posted. */
export function nightTiming(st) {
  const rows = [];
  for (const g of st.sched || []) for (const tri of g.teams) {
    const s = st.teams[tri] || {}, w = s.when || {};
    const before = (ms) => (ms ? Math.round(((g.tip - ms) / 60e3) * 10) / 10 : null); // minutes before tip
    rows.push({ team: tri, opp: g.teams.find((x) => x !== tri), tip: g.tip,
      feedMin: before(w.feed), seenMin: before(w.seen), postedMin: before(w.posted),
      lagSec: w.posted && w.feed ? Math.round((w.posted - w.feed) / 1000) : null,
      lateSec: w.seen && w.slot ? Math.round((w.seen - w.slot) / 1000) : null, // 0.68: how late the read ran after its slot
      changes: (w.changes || []).map((c) => ({ seenMin: before(c.seen), feedMin: before(c.feed), postedMin: before(c.posted) })),
      src: w.src || null, feedLaterSec: w.src === "box" && w.feedSeen && w.seen ? Math.round((w.feedSeen - w.seen) / 1000) : null,
      tipResult: s.tip || null });
  }
  return { date: st.date, teams: rows.sort((a, b) => a.tip - b.tip || a.team.localeCompare(b.team)) };
}

/** One Discord embed summing up the night's timing. */
export function timingEmbed(timing) {
  const fmt = (m) => (m == null ? "—" : `${m.toFixed(1)} min`);
  // Diagnostic (11/13): "seen" is our first read that had it; NBA.com stamp → seen is their publishing delay plus our
  // check interval; seen → posted is ours.
  const lines = timing.teams.map((r) => {
    const tip = r.tipResult === "posted" ? " · 🚨 started differently" : r.tipResult === "gave up" ? " · box never checked" : "";
    if (r.postedMin == null) return `**${r.team}** (${etClock(r.tip)}): not confirmed before tip${tip}`;
    if (r.src === "box") return `**${r.team}** (${etClock(r.tip)}): from the box score file · seen ${fmt(r.seenMin)} · posted ${fmt(r.postedMin)} before tip${r.feedLaterSec != null ? ` · the lineups file had it ${r.feedLaterSec}s later` : " · the lineups file never confirmed it"}${r.changes.length ? ` · ${r.changes.length} change${r.changes.length > 1 ? "s" : ""}` : ""}${tip}`;
    const toSeen = r.feedMin != null && r.seenMin != null ? Math.round((r.feedMin - r.seenMin) * 60) : null;
    return `**${r.team}** (${etClock(r.tip)}): NBA.com ${fmt(r.feedMin)} · seen ${fmt(r.seenMin)} · posted ${fmt(r.postedMin)} before tip${r.lagSec != null ? ` (+${r.lagSec}s${toSeen != null ? `; ${toSeen}s to see it` : ""})` : ""}${r.changes.length ? ` · ${r.changes.length} change${r.changes.length > 1 ? "s" : ""}` : ""}${tip}`;
  });
  const conf = timing.teams.filter((r) => r.feedMin != null).map((r) => r.feedMin).sort((a, b) => a - b);
  const mid = conf.length ? (conf.length % 2 ? conf[(conf.length - 1) / 2] : (conf[conf.length / 2 - 1] + conf[conf.length / 2]) / 2) : null;
  const inFast = conf.filter((m) => m <= FAST_FROM && m > FAST_TO).length;
  const lags = timing.teams.filter((r) => r.lagSec != null).map((r) => r.lagSec).sort((a, b) => a - b);
  const lagMid = lags.length ? (lags.length % 2 ? lags[(lags.length - 1) / 2] : (lags[lags.length / 2 - 1] + lags[lags.length / 2]) / 2) : null;
  return {
    author: { name: "Lineup timing · tonight" },
    title: `${timing.date}: median confirmation ${mid == null ? "—" : `${mid.toFixed(1)} min`} before tip (range ${conf.length ? `${conf[0].toFixed(1)}-${conf[conf.length - 1].toFixed(1)}` : "—"}) · ${inFast} of ${conf.length} in the ${FAST_FROM}-${FAST_TO} window · median lag ${lagMid == null ? "—" : `${Math.round(lagMid)}s`}`,
    description: lines.join("\n").slice(0, 4000),
    color: 0x64748b,
  };
}

/** The /lineups?date= path: read another day's NBA.com file; report, or post one sample (test). */
async function lineupTest(env, date, { dry, test }) {
  const feed = await readFeed(date);
  if (!feed.ok) return { feed: { status: feed.status, note: feed.note || null } };
  const games = parseLineups(feed.json);
  const report = { feed: { status: feed.status, games: games.length }, teams: games.flatMap((g) => g.teams.map((t) => ({ team: t.tri, opp: t.opp, status: t.status, starters: t.starters.map((p) => p.name) }))), posted: 0 };
  if (test && !dry) {
    const g = games.find((x) => x.teams.some((t) => t.status === "Confirmed"));
    const t = g?.teams.find((x) => x.status === "Confirmed");
    if (t) {
      const ymd = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
      let last = null;
      try { const r = await tfetch(TEAM_FILE(t.tri), {}, LIMIT_MS.site); if (r.ok) last = lastStarters(await r.json(), ymd); } catch {}
      if (await postDiscord(env.LINEUPS_WEBHOOK, { embeds: [lineupEmbed(g, t, { last, test: true })] })) report.posted = 1;
    }
  }
  return report;
}
