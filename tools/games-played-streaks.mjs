/**
 * Every player's consecutive-games-played run at the end of 2025-26, from ESPN's box scores (a local archive, one file
 * per game: f-<id>.json { d, t: [{ t, p: [[id, name, pos, starter, min, pts, …stats]] }] }), 2018-19 on (every game of
 * those seasons has its box; Mikal Bridges's run, the longest, starts with his debut in 2018-19). Cup title games are
 * left out (they don't count in a player's stats). Rules: src/records/gpstreak.js.
 *
 *   node tools/games-played-streaks.mjs <archive dir> > src/data/games-played-streaks-2025-26.json
 */
import fs from "node:fs";
import path from "node:path";
import { walkStreak, appeared } from "../src/records/gpstreak.js";

const CODE = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", PHO: "PHX", BRK: "BKN", CHO: "CHA" };
const CUP_FINALS = new Set(["2023-12-09", "2024-12-17", "2025-12-16"]);
// 2019-20 finished in the summer of 2020 (the bubble): July-October 2020 games belong to it.
export const seasonOf = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); const s = m >= 8 && !(y === 2020 && m <= 10) ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; };

export function baseline(dir, { from = "2018-19", through = "2025-26" } = {}) {
  const teamGames = {}, apps = {}, names = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith("f-")) continue;
    const g = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const season = seasonOf(g.d);
    if (season < from || season > through || CUP_FINALS.has(g.d)) continue;
    const gid = f.slice(2, -5);
    for (const t of g.t) {
      const team = CODE[t.t] || t.t;
      (teamGames[`${team}|${season}`] ??= []).push({ d: g.d, gid });
      for (const p of t.p) {
        if (!appeared(p[3], p[4], p.slice(5))) continue;
        names[p[0]] = p[1];
        (apps[p[0]] ??= []).push({ d: g.d, gid, team, season });
      }
    }
  }
  for (const L of Object.values(teamGames)) L.sort((a, b) => a.d.localeCompare(b.d) || a.gid.localeCompare(b.gid));
  const rows = [];
  for (const [id, A] of Object.entries(apps)) {
    A.sort((a, b) => a.d.localeCompare(b.d) || a.gid.localeCompare(b.gid));
    if (A[A.length - 1].season !== through) continue;
    const { n } = walkStreak(A, teamGames);
    if (n > 0) rows.push([id, names[id], n, A[A.length - 1].team]);
  }
  rows.sort((a, b) => b[2] - a[2] || a[1].localeCompare(b[1]));
  return { source: `ESPN box scores ${from} through ${through} (every game's box on file), counted by tools/games-played-streaks.mjs; a game counts when he started or had any minutes or stat. Runs alive at his team's last game of ${through}.`, through, keys: ["id", "name", "n", "team"], rows };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const out = baseline(process.argv[2]);
  console.log(JSON.stringify(out).replace(/\],\[/g, "],\n["));
}
