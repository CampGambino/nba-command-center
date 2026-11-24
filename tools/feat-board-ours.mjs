/**
 * A career feat board from our own box scores (0.142.1): ESPN's box scores since 1993-94 (a local archive, one file per
 * game: f-<id>.json with { d, t: [{ t, s, home, p: [[id, name, ?, starter, min, pts, fgm, fga, fg3m, fg3a, ftm, fta,
 * oreb, dreb, reb, ast, stl, blk, tov, pf, pm]] }] }) plus this season's results store. Regular season only; the Cup
 * title games are left out (they don't count in a player's stats).
 *
 * (0.149.0: the archive now has every regular-season game since 1993-94, so no count is "at least" unless a season is
 * short again.) Before, the archive was missing games: about 10% in 1993-95, 4% in 1995-2004, 13% in 2012-13 through 2017-18. So a player's
 * count is marked "atLeast" when a season of his has fewer games here than he played (active players: the Guide's
 * year-by-year pages) or, for a retired player, when his career touches a season the archive is short. The rules
 * (src/records/featlive.js) never pass, tie or place anyone against such a count.
 *
 *   node tools/feat-board-ours.mjs <archive dir> <key> > rows.json
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const seasonOf = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7), s = m >= 8 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; };
const CUP_FINALS = new Set(["2023-12-09", "2024-12-17", "2025-12-16"]);
import { countedGame } from "./odd-games/counted.mjs";
const COLS = ["min", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "blk", "tov", "pf", "pm"];
export const BOARDS = {
  p25t5b3: { label: "25-point games with 5+ threes and 3+ blocks", one: "25-point game with 5+ threes and 3+ blocks", short: "25 points + 5 threes + 3 blocks", min: { pts: 25, fg3m: 5, blk: 3 } },
};
// Each season's regular-season games (NBA.com's season game lists, 0.149.0; 1230 otherwise; 2012-13 had one cancelled)
const EXPECT = { "1993-94": 1107, "1994-95": 1107, "1995-96": 1189, "1996-97": 1189, "1997-98": 1189, "1998-99": 725, "1999-00": 1189, "2000-01": 1189,
  "2001-02": 1189, "2002-03": 1189, "2003-04": 1189, "2011-12": 990, "2012-13": 1229 };

export async function boardRows(dir, key) {
  const B = BOARDS[key], q = (r) => Object.entries(B.min).every(([k, v]) => (r[k] || 0) >= v);
  const count = {}, first = {}, last = {}, names = {}, seasonGames = {}, gp = {}, qFirst = {}, qLast = {}, seenGames = new Set();
  const qs = (id, s) => { if (!qFirst[id] || s < qFirst[id]) qFirst[id] = s; if (!qLast[id] || s > qLast[id]) qLast[id] = s; };   // seasons with such a game, as the screenshots give them
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith("f-")) continue;
    const g = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (!countedGame(g, seenGames, CUP_FINALS)) continue;   // 0.149.0: All-Star games, empty or broken copies, Cup titles
    const s = seasonOf(g.d);
    for (const t of g.t) for (const p of t.p) {
      // 0.149.0: in the game with 0 minutes but a stat or a start (ESPN rounds a few seconds down to 0 from 2012-13) is a game played
      if (!(p[4] > 0) && !p[3] && !p.slice(5, 20).some((x) => x > 0)) continue;
      (seasonGames[s] ??= new Set()).add(f);   // a game counts as here only with its box (some files have none)
      const r = {}; COLS.forEach((c, i) => (r[c] = p[i + 4]));
      const id = String(p[0]); names[id] = p[1];
      gp[`${id}|${s}`] = (gp[`${id}|${s}`] || 0) + 1;
      first[id] = !first[id] || s < first[id] ? s : first[id]; last[id] = !last[id] || s > last[id] ? s : last[id];
      if (q(r)) { count[id] = (count[id] || 0) + 1; qs(id, s); }
    }
  }
  const { loadStore, allGames } = await import(path.join(root, "src", "situations", "results.js"));
  const store = loadStore(path.join(root, "history", "results"), fs);
  const IX = { min: 2, pts: 3, fgm: 4, fga: 5, fg3m: 6, fg3a: 7, ftm: 8, fta: 9, reb: 10, ast: 11, tov: 12, stl: 13, blk: 14 };
  let through = "";
  for (const g of allGames(store)) {
    if (g.cupFinal || g.hs == null) continue;
    const s = seasonOf(g.d); through = g.d > through ? g.d : through;
    for (const [id, v] of Object.entries(g.pl || {})) {
      if (!(v[IX.min] > 0)) continue;
      const r = Object.fromEntries(Object.entries(IX).map(([k, i]) => [k, v[i]]));
      names[id] = store.names?.[id] || names[id];
      first[id] ??= s; last[id] = s;
      if (q(r)) { count[id] = (count[id] || 0) + 1; qs(id, s); }
    }
  }
  // Short seasons in the archive, and the Guide's games played per season for active players.
  const n = (s) => seasonGames[s]?.size || 0;
  const short = new Set(Object.keys(seasonGames).filter((s) => s !== "2019-20" && s !== "2020-21" && n(s) < (EXPECT[s] ?? 1230) - 2));
  if (n("2019-20") + n("2020-21") < 1059 + 1080 - 2) { short.add("2019-20"); short.add("2020-21"); }
  const Y = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "nba-career-seasons-2026-27.json"), "utf8")), ki = Object.fromEntries(Y.keys.map((k, i) => [k, i]));
  const norm = (n) => String(n).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.'’]/g, "").toLowerCase().trim();
  const yb = Object.fromEntries(Object.entries(Y.players).filter(([n]) => /[a-z]/.test(n)).map(([n, r]) => [norm(n), r]));
  const rows = Object.entries(count).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1] || names[a[0]].localeCompare(names[b[0]])).map(([id, c]) => {
    const y = yb[norm(names[id])];
    let atLeast;
    if (y) {
      // 2019-20's bubble games sit under 2020-21 here (dated August): those two seasons are compared together.
      const g = (s) => gp[`${id}|${s}`] || 0, want = Object.fromEntries(y.map((r) => [r[ki.season], r[ki.g]]));
      // 0.149.0: a season with every game on file can still have fewer of his games than the Guide when he got in for a few
      // seconds and ESPN's box doesn't list him; such a game can't hold the feat, so only a short season makes it "at least".
      const shortSeason = (s) => short.has(s);
      atLeast = y.some((r) => { const s = r[ki.season]; if (s < "1993-94" || s === "2019-20" || s === "2020-21") return false; return shortSeason(s) && g(s) < r[ki.g]; })
        || ((shortSeason("2019-20") || shortSeason("2020-21")) && g("2019-20") + g("2020-21") < (want["2019-20"] || 0) + (want["2020-21"] || 0));
    } else atLeast = [...short].some((s) => s >= first[id] && s <= last[id]);
    return [names[id], qFirst[id], qLast[id], c, ...(atLeast ? [1] : [])];
  });
  return { through, short: [...short].sort(), rows };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const [dir, key] = process.argv.slice(2);
  const out = await boardRows(dir, key);
  console.log(JSON.stringify(out));
}
