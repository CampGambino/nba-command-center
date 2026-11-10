import fs from "node:fs";
import path from "node:path";
import { readLineups, readMovement } from "./movement.js";
export { slugOf, readLineups, readMovement, rowsFor, standing } from "./movement.js";

/**
 * NBA.com static data files that answer servers (unlike stats.nba.com/stats/... and
 * cdn.nba.com, which refuse them): checked 2026-11-10.
 *   stats.nba.com/js/data/leaders/00_daily_lineups_YYYYMMDD.json   starting lineups
 *   stats.nba.com/js/data/playermovement/NBA_Player_Movement.json  every transaction since 2015
 * Same rules as the ESPN client: never throws, cached under <dataDir>/nba/, falls back
 * to the last saved copy (marked stale) when nba.com can't be reached.
 */
const BASE = "https://stats.nba.com/js/data";
const HEADERS = { "User-Agent": "Mozilla/5.0 nba-command-center", Referer: "https://www.nba.com/" };

export function createNbaStatic({ dataDir, fetchImpl = fetch, now = () => Date.now(), timeoutMs = 30000 } = {}) {
  const dir = path.join(dataDir, "nba");
  async function getJson(key, url, maxAgeMs, shrink = (d) => d) {
    const file = path.join(dir, `${key}.json`);
    let cached = null;
    try { cached = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* none */ }
    if (cached && now() - cached.fetchedAt < maxAgeMs) return { ok: true, data: cached.data, stale: false, warnings: [] };
    let error;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      let res, body;
      try {
        res = await fetchImpl(url, { signal: ctl.signal, headers: HEADERS });
        if (res.ok) body = await res.text();
      } finally { clearTimeout(t); }
      if (!res.ok) error = `HTTP ${res.status}`;
      else {
        const data = shrink(JSON.parse(body));
        try {
          fs.mkdirSync(dir, { recursive: true });
          const tmp = `${file}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: now(), url, data }));
          fs.renameSync(tmp, file);
        } catch { /* best effort */ }
        return { ok: true, data, stale: false, warnings: [] };
      }
    } catch (e) { error = e?.name === "AbortError" ? "timed out" : `network: ${e?.message || e}`; }
    if (cached) return { ok: true, data: cached.data, stale: true, warnings: [`nba.com unreachable (${error}); using a saved copy`] };
    return { ok: false, data: null, error: `nba.com ${key}: ${error}`, warnings: [] };
  }
  const wrap = async (key, url, maxAge, reader, shrink) => {
    const r = await getJson(key, url, maxAge, shrink);
    if (!r.ok) return r;
    try { return { ...r, data: reader(r.data) }; } catch (e) { return { ok: false, data: null, error: `nba.com ${key}: unreadable (${e.message})`, warnings: r.warnings }; }
  };
  return {
    lineups: (isoDate) => wrap(`lineups-${isoDate}`, `${BASE}/leaders/00_daily_lineups_${isoDate.replace(/-/g, "")}.json`, 10 * 60e3, readLineups),
    // 4 MB raw; only the fields read are kept.
    movement: () => wrap("movement", `${BASE}/playermovement/NBA_Player_Movement.json`, 6 * 3600e3, readMovement, (d) => ({
      NBA_Player_Movement: { rows: (d?.NBA_Player_Movement?.rows || []).map((r) => ({ Transaction_Type: r.Transaction_Type, TRANSACTION_DATE: r.TRANSACTION_DATE, TRANSACTION_DESCRIPTION: r.TRANSACTION_DESCRIPTION, TEAM_SLUG: r.TEAM_SLUG, PLAYER_ID: r.PLAYER_ID, PLAYER_SLUG: r.PLAYER_SLUG })) },
    })),
  };
}
