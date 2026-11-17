/**
 * Season results, one compact row per finished regular-season game, kept in a
 * store that survives between runs (history/results-<season>.json), so a run
 * only asks ESPN for dates it hasn't finished collecting.
 *
 * Store: { season, dates: { "YYYY-MM-DD": { complete, games: [row] } } }
 * Row:   { id, d, h, a, hs, as, hq: [pts by period], aq: [...], ot, n, hb, ab, cl, x }
 *        h/a = home/away tricode, hs/as = final score, ot = overtime periods,
 *        n = neutral site. From the game's summary (filled in once, x = 1):
 *        hb/ab = team box totals (see TEAM_BOX_KEYS in espn/parse.js),
 *        cl = [home, away] points in clutch time, or 0 if it had none,
 *        cp = clutch-time player lines (see espn/pbp.js; names in store.names),
 *        q4 = 4th-quarter player lines (same shape), pl = every player's box line.
 *        A summary whose box doesn't add up to the final score is not used.
 *        0.95, scoring by type (espn/misc.js): m = [home, away], each [paint, fast break, off turnovers, second
 *        chance]; mp = { espnId: [0 home | 1 away, paint, second chance, off turnovers] } when the play-by-play
 *        count agrees with ESPN's paint totals (mq = 1), else no mp (mq = 0).
 *
 * A date is complete once every regular-season game on it is final (or it is
 * 3+ days old: a game still not final then was postponed). A date ESPN
 * can't answer is left out (not marked complete), so the next run asks again.
 *
 * Stat corrections (the user, 11/13: the league posts them within a day or two): a game's summary is read
 * again once a day for RECHECK_DAYS days after it was played (row.xd = the day it was last read). A failed
 * re-read keeps what we had. Changed games are listed in store.corrected (this run only).
 */
export const RECHECK_DAYS = 3;
export const QUARTER_DAYS = 10;
export function rowFromGame(g) {
  if (!g.final || g.seasonType !== 2 || !g.homeTri || !g.awayTri) return null;
  if (g.homeScore == null || g.awayScore == null || g.homeScore === g.awayScore) return null;
  return {
    id: g.id, d: g.date, h: g.homeTri, a: g.awayTri, hs: g.homeScore, as: g.awayScore,
    hq: g.homeQ, aq: g.awayQ, ot: Math.max(0, (g.periods ?? 4) - 4), n: g.neutral || undefined,
  };
}

export async function collectResults({ espn, store, through, warnings = [] }) {
  const out = store && store.dates ? store : { season: null, dates: {} };
  const probe = await espn.scoreboard(through);
  if (!probe.ok) { warnings.push(probe.error); return out; }
  out.season = probe.data.season ?? out.season;
  const dates = probe.data.calendar.filter((d) => d <= through);
  for (const d of dates) {
    if (out.dates[d]?.complete) continue;
    const sb = d === through ? probe : await espn.scoreboard(d);
    if (!sb.ok) { warnings.push(sb.error); continue; }
    const reg = sb.data.games.filter((g) => g.seasonType === 2);
    const rows = reg.map(rowFromGame).filter(Boolean);
    // A game never finished 3+ days later was postponed: the date is done anyway.
    const old = Date.parse(through) - Date.parse(d) >= 3 * 864e5;
    out.dates[d] = { complete: reg.every((g) => g.final) || old, games: rows };
  }
  // 0.78: the score by quarter is read again too. The first reading was kept for good, and ESPN moved three points of
  // GSW @ HOU (11/11) from the 3rd quarter to the 2nd afterwards (the user, 11/16: Houston "+111 in 2nd quarters" where
  // the league has +108). One scoreboard request a day covers that day's games: every day of the last QUARTER_DAYS on
  // each build, and the whole season once (out.qsweep).
  out.corrected = [];
  out.requartered = [];
  {
    const sweep = out.qsweep !== 1;
    let allOk = true;
    for (const d of Object.keys(out.dates).sort()) {
      if (d >= through || !out.dates[d].complete || !out.dates[d].games.length) continue;
      if (!sweep && Date.parse(through) - Date.parse(d) > QUARTER_DAYS * 864e5) continue;
      const sb = await espn.scoreboard(d);
      if (!sb.ok) { warnings.push(sb.error); allOk = false; continue; }
      for (const g of sb.data.games) {
        const row = out.dates[d].games.find((r) => r.id === g.id);
        const now = row && rowFromGame(g);
        if (!now || !Array.isArray(now.hq) || !Array.isArray(now.aq) || now.hq.length < 4 || now.aq.length !== now.hq.length) continue;
        const sum = (q) => q.reduce((a, b) => a + (b || 0), 0);
        if (sum(now.hq) !== now.hs || sum(now.aq) !== now.as) continue; // a half-updated line score: wait for the next read
        if (JSON.stringify([row.hq, row.aq, row.hs, row.as]) === JSON.stringify([now.hq, now.aq, now.hs, now.as])) continue;
        out.requartered.push({ id: row.id, d, h: row.h, a: row.a, was: [row.aq, row.hq], now: [now.aq, now.hq] });
        row.hq = now.hq; row.aq = now.aq; row.ot = now.ot;
        if (row.hs !== now.hs || row.as !== now.as) { row.hs = now.hs; row.as = now.as; row.x = 0; } // a changed final: read the box again
      }
    }
    if (sweep && allOk) out.qsweep = 1;
  }
  // Fill in box totals and clutch scoring for games that don't have them yet, and re-read recent ones.
  for (const d of Object.keys(out.dates).sort()) {
    for (const row of out.dates[d].games) {
      const recheck = row.x && row.d < through && Date.parse(through) - Date.parse(row.d) <= RECHECK_DAYS * 864e5 && row.xd !== through;
      if (row.x && !recheck) continue;
      const before = recheck ? JSON.stringify([row.hb, row.ab, row.pl]) : null;
      const r = await espn.detail(row.id);
      if (!r.ok) { warnings.push(r.error); continue; }
      const g = r.data;
      if (!g.final || !g.home || !g.away || !g.plays) { warnings.push(`game ${row.id}: summary incomplete`); continue; }
      if (!g.scoreOk) { warnings.push(`game ${row.id}: play-by-play doesn't add up to the final score; clutch not counted yet`); continue; }
      if (pointsOf(g.home) !== row.hs || pointsOf(g.away) !== row.as) { warnings.push(`game ${row.id}: box totals ${pointsOf(g.home)}-${pointsOf(g.away)} don't match the final ${row.hs}-${row.as}`); continue; }
      row.hb = g.home; row.ab = g.away;
      row.cl = g.clutch ? [g.clutch.home, g.clutch.away] : 0;
      // Clutch-time player lines: { ok: lineups were complete, p: { espnId: [0 home | 1 away, ...CLUTCH_KEYS] } }
      if (g.clutchPlayers) {
        row.cp = { ok: g.clutchPlayers.lineupOk ? 1 : 0, p: {} };
        for (const [id, x] of Object.entries(g.clutchPlayers.players)) {
          row.cp.p[id] = [x.team === "home" ? 0 : 1, ...x.s];
          if (x.name) (out.names ??= {})[id] = x.name;
        }
      }
      // 4th-quarter player lines (same shape as cp) and every player's box line:
      // pl = { espnId: [0 home | 1 away, starter 0/1, minutes, ...PLAYER_BOX_KEYS] }; minutes 0 = listed, didn't play.
      if (g.q4Players) {
        row.q4 = { ok: g.q4Players.lineupOk ? 1 : 0, p: {} };
        for (const [id, x] of Object.entries(g.q4Players.players)) {
          row.q4.p[id] = [x.team === "home" ? 0 : 1, ...x.s];
          if (x.name) (out.names ??= {})[id] = x.name;
        }
      }
      if (g.players) {
        row.pl = {};
        for (const [id, x] of Object.entries(g.players)) {
          row.pl[id] = [x.side === "home" ? 0 : 1, x.starter ? 1 : 0, x.min, ...x.s];
          if (x.name) (out.names ??= {})[id] = x.name;
        }
      }
      if (g.misc) setMisc(row, g.misc);
      row.x = 1;
      if (recheck) { row.xd = through; if (JSON.stringify([row.hb, row.ab, row.pl]) !== before) out.corrected.push(row.id); }
      else row.xd = through;
    }
  }
  // 0.95: games read before scoring by type was kept get it from the same summary, MISC_BACKFILL a run (a summary is
  // ~450 KB), newest first so the season's ranks fill in from the games that matter most.
  let left = typeof espn.misc === "function" ? MISC_BACKFILL : 0;
  for (const row of allGames(out).filter((r) => r.x && !r.m).reverse()) {
    if (left-- <= 0) break;
    const r = await espn.misc(row.id);
    if (!r.ok) { warnings.push(r.error); continue; }
    if (r.data.final && r.data.misc) setMisc(row, r.data.misc);
  }
  return out;
}
export const MISC_BACKFILL = Number(globalThis.process?.env?.NCC_MISC_BACKFILL) || 130;
function setMisc(row, misc) {
  if (!misc.home || !misc.away || misc.home.slice(0, 3).some((v) => v == null) || misc.away.slice(0, 3).some((v) => v == null)) return;
  row.m = [misc.home, misc.away];
  row.mq = misc.ok ? 1 : 0;
  if (misc.ok && misc.players) row.mp = misc.players; else delete row.mp;
}

/** Points from box totals: 2 per field goal, 1 more per three, 1 per free throw. */
export const pointsOf = (b) => (b && b.every((v, i) => i > 5 || Number.isFinite(v)) ? 2 * b[0] + b[2] + b[4] : null);

export const allGames = (store) => Object.keys(store?.dates || {}).sort().flatMap((d) => store.dates[d].games);

/**
 * The store on disk: one file per date (history/results/<date>.json) plus
 * meta.json (season, player names). Finished dates never change, so a day's
 * commit adds a file or two instead of rewriting the whole season.
 * `fsImpl` is node:fs (passed in so this module stays browser-safe).
 */
export function loadStore(dir, fsImpl) {
  const meta = `${dir}/meta.json`;
  if (!fsImpl.existsSync(meta)) return null;
  const m = JSON.parse(fsImpl.readFileSync(meta, "utf8"));
  const dates = {};
  for (const f of fsImpl.readdirSync(dir)) {
    const d = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1];
    if (d) dates[d] = JSON.parse(fsImpl.readFileSync(`${dir}/${f}`, "utf8"));
  }
  return { season: m.season ?? null, names: m.names || {}, qsweep: m.qsweep || undefined, dates };
}

/** Writes only files whose content changed; returns how many were written. */
export function saveStore(dir, store, fsImpl) {
  fsImpl.mkdirSync(dir, { recursive: true });
  let n = 0;
  const put = (file, text) => {
    if (fsImpl.existsSync(file) && fsImpl.readFileSync(file, "utf8") === text) return;
    fsImpl.writeFileSync(file, text);
    n++;
  };
  put(`${dir}/meta.json`, JSON.stringify({ season: store.season, names: store.names || {}, qsweep: store.qsweep || undefined }));
  for (const [d, v] of Object.entries(store.dates)) put(`${dir}/${d}.json`, JSON.stringify(v));
  return n;
}

/**
 * The store against ESPN's own records (0.72). A date is kept for good once ESPN calls its games final, so a short
 * or empty scoreboard answer on that one read would lose games without a sound. Every scoreboard game carries each
 * team's season record; for today's games not yet started it's the record through yesterday, for a final one it
 * includes that game. Returns [{ team, espn: "10-2", store: "9-2" }] for teams that differ.
 */
export function recordCheck(rows, games) {
  const W = {}, L = {};
  for (const g of rows) { if (g.hs == null || g.as == null) continue; const hw = g.hs > g.as; W[hw ? g.h : g.a] = (W[hw ? g.h : g.a] || 0) + 1; L[hw ? g.a : g.h] = (L[hw ? g.a : g.h] || 0) + 1; }
  const have = new Set(rows.map((g) => String(g.id)));
  const out = [];
  for (const g of games || []) {
    if (g.seasonType !== 2 || !g.homeTri || !g.awayTri) continue;
    const counted = have.has(String(g.id));
    for (const [tri, rec, won] of [[g.homeTri, g.homeRec, g.homeScore > g.awayScore], [g.awayTri, g.awayRec, g.awayScore > g.homeScore]]) {
      if (!rec) continue;
      let w = W[tri] || 0, l = L[tri] || 0;
      if (g.state === "in") continue;                       // mid-game: the printed record may or may not have moved
      if (g.final && !counted) { if (won) w++; else l++; }   // ESPN's record includes this game; the store doesn't yet
      if (!g.final && g.state !== "pre") continue;
      if (rec[0] !== w || rec[1] !== l) out.push({ team: tri, espn: `${rec[0]}-${rec[1]}`, store: `${w}-${l}` });
    }
  }
  return out;
}
