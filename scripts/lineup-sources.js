/**
 * Which NBA.com file shows a confirmed five first? (0.74; the user, 11/15: "anyway to close the lag time from confirmed
 * lineup to post in discord?")
 *
 *   node scripts/lineup-sources.js [--date YYYY-MM-DD] [--every 10] [--max-min 340]
 *
 * The 11/15 timing: every lineup was posted the moment the Worker saw it, 96-336 seconds after NBA.com's own
 * "confirmed" stamp, because NBA.com rewrites its daily lineups file only every few minutes. This watches two files
 * side by side for one night and prints when each first showed every team's five:
 *   - the daily lineups file the Worker reads (stats.nba.com/js/data/leaders/00_daily_lineups_<date>.json);
 *   - each game's live box score file (cdn.nba.com/static/json/liveData/boxscore/boxscore_<gameId>.json), whose
 *     players carry starter "1" before tip.
 * It also records every rewrite of the lineups file. It reads; it posts nothing and changes nothing the Worker does.
 * Run by .github/workflows/lineup-sources.yml; its log is public, so it prints team codes and clock times only.
 */
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const etDay = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const etClock = (ms) => (ms ? new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false }) : "—");
const date = opt("--date", etDay(Date.now()));
const EVERY = Number(opt("--every", 10)) * 1000, MAX_MS = Number(opt("--max-min", 340)) * 60e3;
const BEFORE_MIN = 45, AFTER_MIN = 2;
const HEAD = { Accept: "application/json", Referer: "https://www.nba.com/", "User-Agent": "ncc-lineups/1.0 (personal use)" };
const FEED = `https://stats.nba.com/js/data/leaders/00_daily_lineups_${date.replace(/-/g, "")}.json`;
const BOX = (id) => `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${id}.json`;
const ESPN = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.replace(/-/g, "")}`;
const TRI = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", PHO: "PHX" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url, init = {}) => { try { return await fetch(url, { ...init, headers: { ...HEAD, ...(init.headers || {}) }, signal: AbortSignal.timeout(8000) }); } catch { return null; } };

/** NBA.com's stamps are Eastern clock time with no zone: the same instant in ms. */
export function stampMs(stamp) {
  if (!stamp) return null;
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(stamp)) return Date.parse(stamp);
  const asUtc = Date.parse(`${stamp}Z`);
  if (Number.isNaN(asUtc)) return null;
  const shown = new Date(asUtc).toLocaleString("sv-SE", { timeZone: "America/New_York" }).replace(" ", "T"); // Eastern clock at that UTC instant
  return asUtc + (asUtc - Date.parse(`${shown}Z`));
}
/** { TRI: { gameId, stamp (ms), confirmed } } from the daily lineups file. */
export function readLineups(json) {
  const out = {};
  for (const g of json?.games || []) for (const t of [g.homeTeam, g.awayTeam]) {
    if (!t?.teamAbbreviation) continue;
    const five = (t.players || []).filter((p) => p.position);
    out[t.teamAbbreviation] = { gameId: g.gameId, confirmed: five.length === 5 && five.every((p) => p.lineupStatus === "Confirmed"),
      stamp: Math.max(0, ...five.map((p) => stampMs(p.timestamp) || 0)) || null };
  }
  return out;
}
/** { TRI: true when the box score file marks exactly five starters } for one game. */
export function readBoxStarters(json) {
  const out = {};
  for (const t of [json?.game?.homeTeam, json?.game?.awayTeam]) if (t?.teamTricode) out[t.teamTricode] = (t.players || []).filter((p) => String(p.starter) === "1").length === 5;
  return out;
}
/** One line a team, then the summary. rows: [{ team, tip, stamp, feed, box, boxThere }] (ms). */
export function report(rows, rewrites = []) {
  const sec = (a, b) => (a && b ? Math.round((a - b) / 1000) : null);
  const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)) : null; };
  const lines = rows.map((r) => {
    const f = sec(r.feed, r.stamp), b = sec(r.box, r.stamp), ahead = sec(r.feed, r.box);
    return `${r.team} tip ${etClock(r.tip)} · stamp ${etClock(r.stamp)} · lineups file ${etClock(r.feed)}${f != null ? ` (+${f}s)` : ""} · box file ${etClock(r.box)}${b != null ? ` (${b >= 0 ? "+" : ""}${b}s)` : ""}${r.boxThere ? ` · box file first there ${etClock(r.boxThere)}` : ""}${ahead != null ? ` · box ${ahead > 0 ? `ahead by ${ahead}s` : ahead < 0 ? `behind by ${-ahead}s` : "level"}` : ""}`;
  });
  const both = rows.filter((r) => r.feed && r.box);
  const gaps = rewrites.slice(1).map((t, i) => Math.round((t - rewrites[i]) / 1000));
  const sum = [`teams with both: ${both.length} of ${rows.length}`,
    `median lineups-file lag ${med(rows.map((r) => sec(r.feed, r.stamp))) ?? "—"}s`, `median box-file lag ${med(rows.map((r) => sec(r.box, r.stamp))) ?? "—"}s`,
    `box ahead in ${both.filter((r) => r.box < r.feed).length} of ${both.length} (median ${med(both.map((r) => sec(r.feed, r.box))) ?? "—"}s)`,
    `lineups file rewritten ${rewrites.length} times${gaps.length ? `, ${med(gaps)}s apart at the median (${Math.min(...gaps)}-${Math.max(...gaps)}s)` : ""}`].join(" · ");
  return { lines, summary: sum };
}

async function main() {
  const start = Date.now();
  // Can this machine read both files at all? (NBA.com turns some data centres away.) Status codes only.
  {
    const r = await get(FEED);
    const j = r?.ok ? await r.json().catch(() => null) : null;
    const id = j?.games?.[0]?.gameId;
    const b = id ? await get(BOX(id), { method: "HEAD" }) : null;
    console.log(`reach: lineups file ${r ? r.status : "no answer"}${j ? ` (${j.games.length} games)` : ""} · box score file ${id ? (b ? b.status : "no answer") : "not tried (no game id yet)"}`);
  }
  const sb = await get(ESPN);
  const board = sb?.ok ? await sb.json().catch(() => null) : null;
  const games = (board?.events || []).map((e) => ({ tip: Date.parse(e.date), teams: (e.competitions?.[0]?.competitors || []).map((c) => TRI[c.team?.abbreviation] || c.team?.abbreviation) }))
    .filter((g) => g.teams.length === 2 && !Number.isNaN(g.tip)).sort((a, b) => a.tip - b.tip);
  if (!games.length) { console.log(`${date}: no games on ESPN's scoreboard; nothing to watch`); return; }
  const todo = games.filter((g) => g.tip + AFTER_MIN * 60e3 > start);
  console.log(`${date}: ${games.length} games, ${todo.length} still to tip; first window opens ${etClock((todo[0] || games[0]).tip - BEFORE_MIN * 60e3)} ET`);
  if (!todo.length) return;
  const rows = {};
  for (const g of todo) for (const t of g.teams) rows[t] = { team: t, tip: g.tip, stamp: null, feed: null, box: null, boxThere: null, gameId: null };
  const rewrites = []; let lastMod = null, etag = {};
  const end = Math.min(start + MAX_MS, todo[todo.length - 1].tip + AFTER_MIN * 60e3);
  const wait = todo[0].tip - BEFORE_MIN * 60e3 - Date.now();
  if (wait > 0) { console.log(`waiting ${Math.round(wait / 60e3)} min`); await sleep(Math.min(wait, MAX_MS)); }
  while (Date.now() < end) {
    const t0 = Date.now();
    const open = todo.filter((g) => t0 >= g.tip - BEFORE_MIN * 60e3 && t0 <= g.tip + AFTER_MIN * 60e3);
    if (open.length) {
      // The lineups file: a cheap look at its date first; read it only when it has been rewritten.
      const h = await get(FEED, { method: "HEAD" });
      const mod = h?.ok ? h.headers.get("last-modified") : null;
      if (mod && mod !== lastMod) {
        const r = await get(FEED);
        const j = r?.ok ? await r.json().catch(() => null) : null;
        if (j) {
          lastMod = mod; rewrites.push(Date.parse(mod) || Date.now());
          const seen = Date.now();
          for (const [tri, x] of Object.entries(readLineups(j))) {
            const row = rows[tri]; if (!row) continue;
            row.gameId = x.gameId;
            if (x.confirmed && !row.feed) { row.feed = seen; row.stamp = x.stamp; }
          }
        }
      }
      // Each open game's box score file, until both of its teams show five starters.
      for (const g of open) {
        const pair = g.teams.map((t) => rows[t]);
        const id = pair[0]?.gameId || pair[1]?.gameId;
        if (!id || pair.every((r) => r.box)) continue;
        const r = await get(BOX(id), etag[id] ? { headers: { "If-None-Match": etag[id] } } : {});
        if (!r || r.status === 304 || !r.ok) continue;
        etag[id] = r.headers.get("etag") || etag[id];
        const j = await r.json().catch(() => null); if (!j) continue;
        const seen = Date.now(), st = readBoxStarters(j);
        for (const row of pair) { row.boxThere ??= seen; if (st[row.team] && !row.box) row.box = seen; }
      }
    }
    await sleep(Math.max(1000, EVERY - (Date.now() - t0)));
  }
  const R = report(Object.values(rows).sort((a, b) => a.tip - b.tip || a.team.localeCompare(b.team)), rewrites);
  for (const l of R.lines) console.log(l);
  console.log(R.summary);
}

if (process.argv[1] && process.argv[1].endsWith("lineup-sources.js")) main().catch((e) => { console.error(`lineup sources: ${e.message}`); process.exit(1); });
