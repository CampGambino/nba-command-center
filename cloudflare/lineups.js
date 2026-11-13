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
 * each scheduled tip (every 5 minutes; every 20 seconds from 31 to 29 minutes out; every 3 minutes after that),
 * then ESPN's box every minute after tip.
 */
export const FEED = (yyyymmdd) => `https://stats.nba.com/js/data/leaders/00_daily_lineups_${yyyymmdd}.json`;
export const ESPN_SCOREBOARD = (yyyymmdd) => `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${yyyymmdd}`;
export const ESPN_SUMMARY = (id) => `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`;
/** ESPN's team abbreviations that differ from the NBA's. */
export const ESPN_TRI = { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS" };
const triOf = (a) => ESPN_TRI[a] || a;
export const TEAM_FILE = (tri) => `https://raw.githubusercontent.com/CampGambino/nba-command-center/main/docs/data/teams/${tri}.json`;
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

const md = (ymd) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const list = (xs) => xs.join(", ");

/** The Discord embed for a team's confirmed five (or a change to it). */
export function lineupEmbed(game, team, { expected = null, last = null, previous = null, test = false, kind = null } = {}) {
  const lines = team.starters.map((p) => p.name); // in position order, PG to C (the user: no labels)
  const notes = [];
  if (previous) { const d = diff(previous, team.starters.map((p) => p.name)); if (d.in.length) notes.push(`🔄 **${kind === "tip" ? "Started differently than confirmed" : "Changed after it was confirmed"}:** in ${list(d.in)} · out ${list(d.out)}`); }
  if (last) {
    const d = diff(last.names, team.starters.map((p) => p.name));
    notes.push(d.in.length ? `**vs last game** (${md(last.d)} vs ${last.opp}): in **${list(d.in)}** · out ${list(d.out)}` : `Same five as last game (${md(last.d)} vs ${last.opp}).`);
  }
  if (expected) { const d = diff(expected, team.starters.map((p) => p.name)); if (d.in.length) notes.push(`**vs expected earlier today:** in ${list(d.in)} · out ${list(d.out)}`); }
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
  try { const res = await fetch(`${url}/messages/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }) }); return res.ok; } catch { return false; }
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
    const res = await fetch(`${url}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "NBA Command Center · Lineups", allowed_mentions: { parse: [] }, ...payload }) });
    if (res.ok) { const m = await res.json().catch(() => null); return m?.id || true; }
    if (res.status === 429) { const b = await res.json().catch(() => ({})); await new Promise((r) => setTimeout(r, Math.ceil((b.retry_after || 1) * 1000) + 200)); continue; }
    return false;
  }
  return false;
}

export async function readFeed(yyyymmdd) {
  const res = await fetch(FEED(yyyymmdd), { redirect: "manual", headers: { Accept: "application/json", Referer: "https://www.nba.com/", "User-Agent": "ncc-lineups/1.0 (personal use)" } });
  if (res.status === 301 || res.status === 302) return { ok: false, status: res.status, note: "not posted yet" };
  if (!res.ok) return { ok: false, status: res.status };
  const text = await res.text();
  try { return { ok: true, status: res.status, json: JSON.parse(text) }; } catch { return { ok: false, status: res.status, note: "not JSON" }; }
}

/** Today's games from ESPN's scoreboard: [{ id, tip (ms, scheduled), teams: [TRI, TRI] }]. */
export function readSchedule(board) {
  return (board?.events || []).map((e) => ({ id: e.id, tip: Date.parse(e.date), teams: (e.competitions?.[0]?.competitors || []).map((c) => triOf(c.team?.abbreviation)) }))
    .filter((g) => g.teams.length === 2 && !Number.isNaN(g.tip));
}

// The timing the user set (11/12, second version), by minutes before each game's scheduled tip:
//   90 → 35: NBA.com's file every 5 minutes (90, 85, … 35);
//   31 → 29: every 20 seconds (starting lineups usually land about 30 minutes before tip);
//   29 → 2:  every 3 minutes (29, 26, … 2);
//   from tip: ESPN's box every minute until it shows who started (giving up 45 minutes after).
// Cloudflare's cron runs at most once a minute, so the 20-second checks are three reads inside one run
// (at :00, :20 and :40).
export const WINDOW_MIN = 90, BURST_FROM = 31, BURST_TO = 29, TIP_GIVE_UP_MIN = 45;
export const BURST_EVERY_S = 20;

/** Is NBA.com's file due at time t (ms) for a game tipping at tip (ms)? */
export function feedDue(tip, t) {
  const m = (tip - t) / 60e3; // minutes before tip (may be fractional inside the burst)
  if (m <= 0 || m > WINDOW_MIN) return false;
  if (m <= BURST_FROM && m > BURST_TO) return true; // the burst: every check offered (every 20 s)
  const whole = Math.round(m);
  if (Math.abs(m - whole) > 1 / 120) return false; // other checks are on whole minutes only
  if (whole > BURST_FROM) return (WINDOW_MIN - whole) % 5 === 0; // 90, 85, … 35
  return whole <= BURST_TO && (BURST_TO - whole) % 3 === 0; // 29, 26, … 2
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
  if (!st.sched) {
    const res = await fetch(ESPN_SCOREBOARD(compact));
    if (!res.ok) return { error: `ESPN scoreboard ${res.status}` };
    st.sched = readSchedule(await res.json()); changed = true;
  }
  const report = { phases: {}, read: [], posted: 0 };
  for (const g of st.sched) for (const tri of g.teams) {
    const s = (st.teams[tri] ??= { expected: null, posted: null, tip: null });
    report.phases[tri] = phaseOf(s, g.tip, now);
  }
  // NBA.com's file at :00, :20 and :40 of this minute, whenever any game is due then (one read covers every game).
  const minute0 = Math.floor(now / 60e3) * 60e3;
  for (const off of [0, BURST_EVERY_S, 2 * BURST_EVERY_S]) {
    const t = minute0 + off * 1000;
    const due = st.sched.some((g) => g.teams.some((tri) => phaseOf(st.teams[tri], g.tip, t) === "pregame") && feedDue(g.tip, t));
    if (!due && !(dry && off === 0)) continue;
    if (t > Date.now()) await sleep(t - Date.now());
    const feed = await readFeed(compact);
    report.read.push(`${off}s nba.com ${feed.status}${feed.note ? ` (${feed.note})` : ""}`);
    if (!feed.ok) continue;
    for (const g of parseLineups(feed.json)) {
      const sg = st.sched.find((x) => x.teams.includes(g.teams[0].tri) && x.teams.includes(g.teams[1].tri));
      for (const tm of g.teams) {
        const s = st.teams[tm.tri];
        if (!sg || !s || phaseOf(s, sg.tip, t) !== "pregame") continue;
        const names = tm.starters.map((p) => p.name);
        if (tm.status === "Expected" && !s.expected) { s.expected = names; changed = true; }
        // Timing (times only, for the nightly summary): when NBA.com stamped it confirmed, when we first saw it.
        if (tm.status === "Confirmed") { const w = (s.when ??= {}); if (!w.seen) { w.seen = t; w.feed = tm.at; changed = true; } }
        if (tm.status !== "Confirmed") continue;
        const again = s.posted && diff(s.posted, names).in.length > 0;
        if (s.posted && !again) continue;
        if (dry) { (report.wouldPost ??= []).push(`${tm.tri} ${again ? "change" : "confirmed"}`); continue; }
        let last = null;
        if (!again) { try { const r = await fetch(TEAM_FILE(tm.tri)); if (r.ok) last = lastStarters(await r.json(), ymd); } catch {} }
        const embed = lineupEmbed({ ...g, statusText: g.statusText || etClock(sg.tip) + " ET" }, tm, { expected: again ? null : s.expected, last, previous: again ? s.posted : null });
        const id = await postDiscord(env.LINEUPS_WEBHOOK, { embeds: [embed] });
        if (id) {
          if (again && s.card) await editDiscord(env.LINEUPS_WEBHOOK, s.card.id, { embeds: [supersededEmbed(s.card.embed, `changed at ${etClock(Date.now())} ET`)] });
          s.card = { id, embed };
          s.posted = names; s.postedTeam = { starters: tm.starters }; changed = true; report.posted++;
          const w = (s.when ??= {});
          if (again) (w.changes ??= []).push({ seen: t, feed: tm.at, posted: Date.now() }); else w.posted = Date.now();
        }
      }
    }
  }
  const due = { tip: st.sched.filter((g) => g.teams.some((tri) => phaseOf(st.teams[tri], g.tip, now) === "tip")) };
  // From the scheduled tip: who actually started (ESPN's box), every minute until it's there.
  for (const g of due.tip) {
    let five = null;
    try {
      const res = await fetch(ESPN_SUMMARY(g.id));
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
        if (!s.posted) { try { const r = await fetch(TEAM_FILE(tri)); if (r.ok) last = lastStarters(await r.json(), ymd); } catch {} }
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
  if (changed && !dry) await env.STATE.put("lineups", JSON.stringify(st));
  return report;
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
      changes: (w.changes || []).map((c) => ({ seenMin: before(c.seen), feedMin: before(c.feed), postedMin: before(c.posted) })),
      tipResult: s.tip || null });
  }
  return { date: st.date, teams: rows.sort((a, b) => a.tip - b.tip || a.team.localeCompare(b.team)) };
}

/** One Discord embed summing up the night's timing. */
export function timingEmbed(timing) {
  const fmt = (m) => (m == null ? "—" : `${m.toFixed(1)} min`);
  const lines = timing.teams.map((r) => {
    const tip = r.tipResult === "posted" ? " · 🚨 started differently" : r.tipResult === "gave up" ? " · box never checked" : "";
    if (r.postedMin == null) return `**${r.team}** (${etClock(r.tip)}): not confirmed before tip${tip}`;
    return `**${r.team}** (${etClock(r.tip)}): NBA.com ${fmt(r.feedMin)} before tip · posted ${fmt(r.postedMin)} before${r.lagSec != null ? ` (+${r.lagSec}s)` : ""}${r.changes.length ? ` · ${r.changes.length} change${r.changes.length > 1 ? "s" : ""}` : ""}${tip}`;
  });
  const conf = timing.teams.filter((r) => r.feedMin != null).map((r) => r.feedMin).sort((a, b) => a - b);
  const median = conf.length ? conf[Math.floor(conf.length / 2)] : null;
  const inBurst = conf.filter((m) => m <= 31 && m > 29).length;
  return {
    author: { name: "Lineup timing · tonight" },
    title: `${timing.date}: median confirmation ${median == null ? "—" : `${median.toFixed(1)} min`} before tip · ${inBurst} of ${conf.length} in the 31-29 window`,
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
      try { const r = await fetch(TEAM_FILE(t.tri)); if (r.ok) last = lastStarters(await r.json(), ymd); } catch {}
      if (await postDiscord(env.LINEUPS_WEBHOOK, { embeds: [lineupEmbed(g, t, { last, test: true })] })) report.posted = 1;
    }
  }
  return report;
}
