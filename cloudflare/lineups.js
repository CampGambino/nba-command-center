/**
 * Lineups watcher (runs inside the ncc-articles Worker, on the same 5-minute cron).
 *
 * Reads the NBA's daily lineups file (the data behind nba.com/players/todays-lineups) and posts to the
 * user's private #lineups channel (secret LINEUPS_WEBHOOK) when a team's starting five is CONFIRMED,
 * before tip-off. Each post says what changed:
 *   - from the five NBA.com first listed as "Expected" that day, and
 *   - from the team's starters in its last game (our own box-score file on GitHub).
 * If a confirmed five changes again before tip, a "lineup change" post follows.
 *
 * For the user's personal use only (their decision, 11/12; NBA.com terms: personal, non-commercial).
 * So: the channel is private; nothing is published on the public site; no lineup history is kept
 * (KV holds only today's state, for spotting changes); the file is read every 5 minutes only from
 * 10 AM ET until the day's last game has tipped.
 */
export const FEED = (yyyymmdd) => `https://stats.nba.com/js/data/leaders/00_daily_lineups_${yyyymmdd}.json`;
export const TEAM_FILE = (tri) => `https://raw.githubusercontent.com/CampGambino/nba-command-center/main/docs/data/teams/${tri}.json`;
const POS_ORDER = { PG: 0, SG: 1, G: 1.5, SF: 2, F: 2.5, PF: 3, C: 4 };

export const etParts = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, minute: +p.minute };
};
export const etClock = (ms) => new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
export const nameKey = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.'’]/g, "").replace(/-/g, " ").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ").replace(/\s+/g, " ").trim();
/** The feed's timestamps ("2026-11-11T22:49:00") are UTC without a zone. */
export const feedTime = (t) => (t ? Date.parse(/Z|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`) : null);

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
export function lineupEmbed(game, team, { expected = null, last = null, previous = null, test = false } = {}) {
  const lines = team.starters.map((p) => `\`${(p.pos || "").padEnd(2)}\` ${p.name}`);
  const notes = [];
  if (previous) { const d = diff(previous, team.starters.map((p) => p.name)); if (d.in.length) notes.push(`🔄 **Changed after it was confirmed:** in ${list(d.in)} · out ${list(d.out)}`); }
  if (last) {
    const d = diff(last.names, team.starters.map((p) => p.name));
    notes.push(d.in.length ? `**vs last game** (${md(last.d)} vs ${last.opp}): in **${list(d.in)}** · out ${list(d.out)}` : `Same five as last game (${md(last.d)} vs ${last.opp}).`);
  }
  if (expected) { const d = diff(expected, team.starters.map((p) => p.name)); if (d.in.length) notes.push(`**vs expected earlier today:** in ${list(d.in)} · out ${list(d.out)}`); }
  if (team.inactive.length) notes.push(`Inactive: ${list(team.inactive)}`);
  const changed = notes.some((n) => /^\*\*vs|^🔄/.test(n) && /in \*\*|in [A-Z]/.test(n));
  return {
    author: { name: `${test ? "TEST (last night's data) · " : ""}${previous ? "LINEUP CHANGE" : "Confirmed starters"} · NBA.com` },
    title: `${team.tri} ${team.home ? "vs" : "@"} ${team.opp}${game.statusText && !/final/i.test(game.statusText) ? ` · ${game.statusText}` : ""}`.slice(0, 256),
    description: [lines.join("\n"), notes.join("\n")].filter(Boolean).join("\n\n").slice(0, 4000),
    color: previous ? 0xef4444 : changed ? 0xf59e0b : 0x22c55e,
    footer: { text: `Confirmed ${team.at ? `${etClock(team.at)} ET` : "(time not given)"}` },
  };
}

async function postDiscord(url, payload) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${url}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "NBA Command Center · Lineups", allowed_mentions: { parse: [] }, ...payload }) });
    if (res.ok) return true;
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

/**
 * One check. env: { STATE (KV), LINEUPS_WEBHOOK }. opts: { dry: don't post or save, date: "YYYYMMDD" (test), test: post a sample }.
 * KV "lineups": { date, teams: { "<gameId>|<TRI>": { expected: [names] | null, posted: [names] | null } } }; replaced each day.
 */
export async function lineupCheck(env, now = Date.now(), { dry = false, date = null, test = false } = {}) {
  if (!env.LINEUPS_WEBHOOK && !dry) return { skipped: "no LINEUPS_WEBHOOK secret" };
  const et = etParts(now);
  if (!date && (et.hour < 10)) return { skipped: "before 10 AM ET" };
  const ymd = date ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : et.ymd;
  const st0 = (await env.STATE.get("lineups", "json")) || {};
  const st = !date && st0.date === ymd ? st0 : { date: ymd, teams: {} };
  if (!date && st.done) return { skipped: "all of today's games have tipped" };
  const feed = await readFeed(ymd.replace(/-/g, ""));
  if (!feed.ok) return { feed: { status: feed.status, note: feed.note || null } };
  const games = parseLineups(feed.json);
  const report = { feed: { status: feed.status, games: games.length }, teams: [], posted: 0 };
  let changed = false;
  for (const g of games) {
    for (const t of g.teams) {
      const k = `${g.gameId}|${t.tri}`;
      const s = (st.teams[k] ??= { expected: null, posted: null });
      const names = t.starters.map((p) => p.name);
      report.teams.push({ team: t.tri, opp: t.opp, game: g.statusText, status: t.status, starters: names, posted: !!s.posted });
      if (t.status === "Expected" && !s.expected) { s.expected = names; changed = true; }
      const pregame = g.gameStatus === 1 || test;
      if (t.status !== "Confirmed" || !pregame) continue;
      const again = s.posted && diff(s.posted, names).in.length > 0;
      if (s.posted && !again && !test) continue;
      if (dry && !test) { report.teams[report.teams.length - 1].wouldPost = again ? "change" : "confirmed"; continue; }
      let last = null;
      try { const r = await fetch(TEAM_FILE(t.tri)); if (r.ok) last = lastStarters(await r.json(), ymd); } catch {}
      const embed = lineupEmbed(g, t, { expected: s.expected, last, previous: again ? s.posted : null, test });
      if (await postDiscord(env.LINEUPS_WEBHOOK, { embeds: [embed] })) { s.posted = names; changed = true; report.posted++; }
      if (test) return report; // one sample is enough
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  // Done for the day once every game has tipped (status 2 live / 3 final).
  if (games.length && games.every((g) => g.gameStatus >= 2)) { st.done = true; changed = true; }
  if (changed && !dry && !date) await env.STATE.put("lineups", JSON.stringify(st));
  return report;
}
