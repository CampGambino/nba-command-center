/**
 * This season against each player's own career, season by season (the NBA Guide's year-by-year stats, 1979-80 to
 * 2025-26, src/data/nba-career-seasons-<season>.json) — the "lowest since" / "highest since" / "career-high pace"
 * context behind a rise or a dip (e.g. a veteran's scoring falling to its lowest in a decade).
 *
 *   careerContext({ seasons, teamFiles, minGames = 8 }) -> [{ name, team, stat, label, now, last, lastSeason, delta, kind: "low" | "high" | "change",
 *        since: "2010-11" | null (career low/high), sinceValue, seasonsCompared, text, score }]
 *
 * Per game: points, rebounds, assists, 3-pointers made, minutes. Only seasons of 20+ games count as comparisons
 * (a 9-game season isn't a "season" to measure against). Needs 3+ such seasons.
 */
import { nameKey } from "../notes/names.js";
import { seasonLines } from "./guide.js";

const STATS = [["pts", "points"], ["reb", "rebounds"], ["ast", "assists"], ["fg3m", "3-pointers"], ["min", "minutes"]];
const MIN_SEASON_GAMES = 20, MIN_SEASONS = 3, NOTABLE_SPAN = 5;
const r1 = (x) => Math.round(x * 10) / 10;

// Year-over-year change worth a line on its own (per game), even without a "since" landmark.
const BIG_CHANGE = { pts: 5, reb: 3, ast: 3, fg3m: 1.5 };
// Shooting (0.71): [stat, label, makes, attempts, attempts this season, attempts in a season compared with].
const PCTS = [["fg", "from the field", "fgm", "fga", 60, 200], ["fg3", "from three", "fg3m", "fg3a", 25, 82], ["fg2", "on twos", "fg2m", "fg2a", 25, 100], ["ft", "from the line", "ftm", "fta", 15, 50]];

export function careerContext({ seasons, teamFiles, minGames = 8 }) {
  const K = Object.fromEntries((seasons?.keys || []).map((k, i) => [k, i]));
  const byKey = new Map(Object.entries(seasons?.players || {}).map(([n, rows]) => [nameKey(n), rows]));
  const out = [];
  for (const p of Object.values(seasonLines(teamFiles))) {
    if (p.lines.length < minGames) continue;
    const rows = (byKey.get(nameKey(p.name)) || []).filter((r) => r[K.g] >= MIN_SEASON_GAMES);
    if (rows.length < MIN_SEASONS) continue;
    const last = rows[rows.length - 1];
    for (const [stat, label] of STATS) {
      const now = p.lines.reduce((a, l) => a + (l.stats[stat] || 0), 0) / p.lines.length;
      const per = (r) => r[K[stat]] / r[K.g];
      const lastV = per(last);
      const lastMin = r1(last[K.min] / last[K.g]);
      const short = p.name.replace(/\s+(?:Jr\.|II|III|IV)$/, "").split(" ").pop();
      // A big swing from last season, with where it sits in his career.
      if (BIG_CHANGE[stat] && Math.abs(now - lastV) >= BIG_CHANGE[stat] && last[K.g] >= MIN_SEASON_GAMES) {
        const down = now < lastV;
        const hit = [...rows].reverse().find((r) => (down ? per(r) <= now : per(r) >= now));
        const where = hit ? `his ${down ? "lowest" : "highest"} since ${hit[K.season]} (${r1(per(hit))})` : `a career ${down ? "low" : "high"}`;
        out.push({ name: p.name, team: p.team, stat, label, now: r1(now), last: r1(lastV), lastSeason: last[K.season], delta: r1(now - lastV), kind: "change", since: hit ? hit[K.season] : null,
          sinceValue: hit ? r1(per(hit)) : null, seasonsCompared: rows.length, games: p.lines.length, lastMin,
          text: `${short}: ${r1(now)} ${label} a game, ${down ? "down" : "up"} ${r1(Math.abs(now - lastV))} from ${r1(lastV)} in ${last[K.season]}; ${where}`,
          score: 1.5 + Math.min(2, Math.abs(now - lastV) / BIG_CHANGE[stat] / 2) });
      }
      for (const kind of ["low", "high"]) {
        // the most recent season at or beyond this mark
        const hit = [...rows].reverse().find((r) => (kind === "low" ? per(r) <= now : per(r) >= now));
        const span = hit ? 2026 - Number(hit[K.season].slice(0, 4)) - 1 : rows.length;
        const career = !hit;
        if (!career && span < NOTABLE_SPAN) continue;
        if (stat === "min" && !career) continue; // minutes only when it's a career low or high
        // Ignore tiny numbers (a center's 0.3 threes a game "career high" is noise).
        if ((stat === "fg3m" && Math.max(now, lastV) < 1) || (stat === "ast" && Math.max(now, lastV) < 2) || (stat === "reb" && Math.max(now, lastV) < 3) || (stat === "pts" && Math.max(now, lastV) < 8)) continue;
        const since = hit ? hit[K.season] : null;
        const what = kind === "low" ? (career ? "career low" : `lowest since ${since} (${r1(per(hit))})`) : (career ? "career high" : `highest since ${since} (${r1(per(hit))})`);
        out.push({
          name: p.name, team: p.team, stat, label, now: r1(now), last: r1(lastV), lastSeason: rows[rows.length - 1][K.season], delta: r1(now - lastV), kind, since,
          sinceValue: hit ? r1(per(hit)) : null, seasonsCompared: rows.length, games: p.lines.length, lastMin,
          text: `${short}: ${r1(now)} ${label} a game, his ${what}; ${r1(lastV)} in ${rows[rows.length - 1][K.season]}`,
          score: (career ? 2 + rows.length / 10 : 1 + span / 10) + Math.min(1.5, Math.abs(now - lastV) / Math.max(1, lastV)),
        });
      }
    }
  }
  // 0.71 (the user, 11/15: "does this also check percentages? … Toumani Camara shooting career-high on 3pt, 2pt, and FT
  // percentages"): FG%, 3P%, 2P% and FT% against every season with enough attempts; one line per player when three or
  // more are career highs (or lows).
  for (const p of Object.values(seasonLines(teamFiles))) {
    if (p.lines.length < minGames) continue;
    const all = byKey.get(nameKey(p.name)) || [];
    const tot = (k) => p.lines.reduce((a, l) => a + (l.stats[k] || 0), 0);
    const short = p.name.replace(/\s+(?:Jr\.|II|III|IV)$/, "").split(" ").pop();
    const hits = [];
    for (const [stat, label, m, a, minNow, minThen] of PCTS) {
      const mk = (o, k) => (k === "fg2m" ? o("fgm") - o("fg3m") : k === "fg2a" ? o("fga") - o("fg3a") : o(k));
      const M = mk(tot, m), A = mk(tot, a);
      if (A < minNow) continue;
      const rows = all.filter((r) => r[K.g] >= MIN_SEASON_GAMES && mk((k) => r[K[k]] || 0, a) >= minThen);
      if (rows.length < MIN_SEASONS) continue;
      const pc = (r) => (100 * mk((k) => r[K[k]] || 0, m)) / mk((k) => r[K[k]] || 0, a);
      const now = (100 * M) / A, last = rows[rows.length - 1];
      for (const kind of ["high", "low"]) {
        const hit = [...rows].reverse().find((r) => (kind === "low" ? pc(r) <= now : pc(r) >= now));
        const span = hit ? 2026 - Number(hit[K.season].slice(0, 4)) - 1 : rows.length;
        if (hit && span < NOTABLE_SPAN) continue;
        const what = hit ? `${kind === "low" ? "lowest" : "highest"} since ${hit[K.season]} (${r1(pc(hit))}%)` : `career ${kind}`;
        const row = { name: p.name, team: p.team, stat, label, now: r1(now), last: r1(pc(last)), lastSeason: last[K.season], delta: r1(now - pc(last)), kind, since: hit ? hit[K.season] : null,
          sinceValue: hit ? r1(pc(hit)) : null, seasonsCompared: rows.length, games: p.lines.length, lastMin: r1(last[K.min] / last[K.g]),
          text: `${short}: ${r1(now)}% ${label} (${M}-${A}), his ${what}; ${r1(pc(last))}% in ${last[K.season]}`,
          score: (hit ? 1 + span / 10 : 2 + rows.length / 10) + Math.min(1, Math.abs(now - pc(last)) / 8) };
        out.push(row); hits.push(row);
      }
    }
    for (const kind of ["high", "low"]) {
      const career = hits.filter((h) => h.kind === kind && !h.since);
      if (career.length < 3) continue;
      const SHORT = { fg: "FG%", fg3: "3P%", fg2: "2P%", ft: "FT%" };
      const names = career.map((h) => SHORT[h.stat]);
      out.push({ name: p.name, team: p.team, stat: "pct", label: "shooting", now: career.map((h) => h.now).join("/"), last: career.map((h) => h.last).join("/"), lastSeason: career[0].lastSeason, delta: null, kind, since: null,
        sinceValue: null, seasonsCompared: career[0].seasonsCompared, games: p.lines.length, lastMin: career[0].lastMin,
        text: `${short}: career ${kind}s in ${names.slice(0, -1).join(", ")} and ${names.at(-1)} (${career.map((h) => `${h.now}%`).join(", ")})`,
        score: 2.4 + career.length * 0.35 });
    }
  }
  // 0.71: most noteworthy first: a career mark over a long career, a big change, and who it's about (career scoring)
  // count; minutes alone count least. One player's lines sit together under his best one (the page groups them).
  const prom = new Map();
  for (const x of out) if (!prom.has(x.name)) { const r = byKey.get(nameKey(x.name)) || []; const g = r.reduce((a, y) => a + (y[K.g] || 0), 0); prom.set(x.name, g ? r.reduce((a, y) => a + (y[K.pts] || 0), 0) / g : 0); }
  const W = { pts: 1, reb: 0.8, ast: 0.8, fg3m: 0.7, min: 0.4, fg: 0.8, fg3: 0.8, fg2: 0.6, ft: 0.6, pct: 1 };
  for (const x of out) x.score = Math.round((x.score * (W[x.stat] ?? 0.7) + Math.min(1.5, (prom.get(x.name) || 0) / 12) - (x.games < 10 ? 0.2 : 0)) * 100) / 100;
  // A big change already says where it sits ("down 5.8 from 20.9…; a career low"): the separate low/high line for the
  // same stat goes, and the change line takes the better score.
  const change = new Map(out.filter((x) => x.kind === "change").map((x) => [`${x.name}|${x.stat}`, x]));
  const kept = out.filter((x) => { const c = x.kind !== "change" && change.get(`${x.name}|${x.stat}`); if (c && ((x.kind === "low") === (c.delta < 0))) { c.score = Math.max(c.score, x.score); return false; } return true; });
  return kept.sort((a, b) => b.score - a.score);
}
