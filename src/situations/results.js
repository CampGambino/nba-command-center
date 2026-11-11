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
 *
 * A date is complete once every regular-season game on it is final (or it is
 * 3+ days old: a game still not final then was postponed). A date ESPN
 * can't answer is left out (not marked complete), so the next run asks again.
 */
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
  // Fill in box totals and clutch scoring for games that don't have them yet.
  for (const d of Object.keys(out.dates).sort()) {
    for (const row of out.dates[d].games) {
      if (row.x) continue;
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
      row.x = 1;
    }
  }
  return out;
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
  return { season: m.season ?? null, names: m.names || {}, dates };
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
  put(`${dir}/meta.json`, JSON.stringify({ season: store.season, names: store.names || {} }));
  for (const [d, v] of Object.entries(store.dates)) put(`${dir}/${d}.json`, JSON.stringify(v));
  return n;
}
