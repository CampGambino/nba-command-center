// node --max-old-space-size=6000 tools/odd-games/late/eval-late.mjs [--write]
// How often does an odd line that stands at 5:00, 3:00, 2:00 or 1:00 left in the 4th still stand at the final?
// Reads the files fetch-late.mjs wrote, runs the site's own rules (src/situations/oddlines.js) on each player's line
// at each mark and on his box-score line, and prints the table. --write also writes src/data/odd-lines-hold.json.
// Only players whose rebuilt final line equals the box score in all fifteen columns are used ("clean").
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".."), WORK = process.env.WORK || "/home/claude/work";
const R = await import(path.join(ROOT, "src", "situations", "oddlines.js"));
const { MARKS } = await import("./reduce.mjs");
const DIR = `${WORK}/late/g`, K = ["pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "blk", "tov", "pf"];
const seasonOf = (d) => (+d.slice(5, 7) >= 8 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const files = fs.readdirSync(DIR), games = [], sum = new Map();
let none = 0, ot = 0, players = 0, clean = 0, floorKnown = 0;
for (const f of files) { const g = JSON.parse(fs.readFileSync(`${DIR}/${f}`, "utf8")); if (g.none) { none++; continue; } g.id = f.slice(0, -5); games.push(g);
  const season = seasonOf(g.d); for (const p of g.p) if (p.min > 0) { const pk = `${p.id}|${season}`, s = sum.get(pk) || { n: 0, pts: 0, reb: 0, ast: 0 }; s.n++; s.pts += p.box[0]; s.reb += p.box[9]; s.ast += p.box[10]; sum.set(pk, s); } }
const line = (arr, min, st) => { const l = Object.fromEntries(K.map((k, i) => [k, arr[i]])); l.min = min; l.starter = st; return l; };
const T = {}, add = (k, m, held, heldKey, onFloor, isOt) => { const e = (T[k] ||= {}), c = (e[m] ||= { n: 0, held: 0, key: 0, on: 0, onHeld: 0, ot: 0, otHeld: 0 }); if (isOt) { c.ot++; if (held) c.otHeld++; return; } c.n++; if (held) c.held++; if (heldKey) c.key++; if (onFloor) { c.on++; if (held) c.onHeld++; } };
const caught = {};   // of the lines that stood at the final, how many already stood at each mark
const examples = {};
for (const g of games) {
  const season = seasonOf(g.d), isOt = g.per > 4; if (isOt) ot++;
  for (const p of g.p) { players++; if (!p.clean) continue; clean++; if (!p.after) continue; floorKnown++;
    const s = sum.get(`${p.id}|${season}`), mine = p.min > 0 ? 1 : 0, n = s ? s.n - mine : 0;
    const x = { pos: R.posGroup(p.pos), avg: n >= R.ODD.games ? { pts: (s.pts - mine * p.box[0]) / n, reb: (s.reb - mine * p.box[9]) / n, ast: (s.ast - mine * p.box[10]) / n } : null };
    const fin = R.matchLine(line(p.box, p.min, p.st), x).filter((h) => R.liveKind(h.id) === "late"), finIds = new Set(fin.map((h) => h.id)), finKeys = new Set(fin.map((h) => h.key));
    MARKS.forEach((m, mi) => {
      const minAt = Math.max(0, Math.round(p.min - p.after[mi] / 60));
      const hits = R.matchLine(line(p.at[m], minAt, p.st), x).filter((h) => R.liveKind(h.id) === "late");
      const best = {}; for (const h of hits) best[h.id] = h;   // one a template: the last listed level is the strongest matched
      for (const h of Object.values(best)) { const held = finIds.has(h.id), hk = finKeys.has(h.key); add(h.id, m, held, hk, p.on[mi], isOt); add("ALL", m, held, hk, p.on[mi], isOt);
        if (!isOt && m === 300 && !held && (examples[h.id] ||= []).length < 2) examples[h.id].push(`${p.n} ${g.d}: ${h.say}; final ${p.box[0]}p ${p.box[9]}r ${p.box[10]}a ${p.box[1]}-${p.box[2]} fg ${p.box[5]}-${p.box[6]} ft ${p.min}m`); }
      if (!isOt) { const at = new Set(Object.keys(best)); for (const id of finIds) { const c = ((caught[id] ||= {})[m] ||= [0, 0]); c[1]++; if (at.has(id)) c[0]++; const a = ((caught.ALL ||= {})[m] ||= [0, 0]); a[1]++; if (at.has(id)) a[0]++; } }
    }); } }
const pct = (a, b) => (b ? `${Math.round(100 * a / b)}%` : "-");
console.log(JSON.stringify({ games: games.length, noPlays: none, overtime: ot, players, clean, cleanPct: pct(clean, players), floorKnown, floorPct: pct(floorKnown, clean) }));
const names = Object.fromEntries(R.TEMPLATES.map((t) => [t.id, t.what || t.name || t.id]));
console.log("template".padEnd(11), MARKS.map((m) => `${m / 60}:00 left  n / held`.padEnd(22)).join(""), "| on floor at 5:00: held | OT games at 5:00: n, held | of finals, standing at 5:00");
for (const [k, e] of Object.entries(T).sort((a, b) => (b[1][300]?.n || 0) - (a[1][300]?.n || 0))) {
  console.log(k.padEnd(11), MARKS.map((m) => `${String(e[m]?.n || 0).padStart(6)} ${pct(e[m]?.held, e[m]?.n).padStart(5)}`.padEnd(22)).join(""), "|", pct(e[300]?.onHeld, e[300]?.on).padStart(5), `(${e[300]?.on || 0})`.padEnd(8), "|", String(e[300]?.ot || 0).padStart(5), pct(e[300]?.otHeld, e[300]?.ot).padStart(5), "|", pct(caught[k]?.[300]?.[0], caught[k]?.[300]?.[1]).padStart(5), `(${caught[k]?.[300]?.[1] || 0})`, "|", String(names[k] || "").slice(0, 46));
}
fs.writeFileSync(`${WORK}/late/hold.json`, JSON.stringify({ T, caught, examples, counts: { games: games.length, noPlays: none, overtime: ot, players, clean, floorKnown } }));
if (process.argv.includes("--write")) {
  // Minutes at a mark are the box score's whole minutes less his seconds on the floor after it, so they can be a minute
  // off: the two rules that turn on exactly zero minutes cannot be judged this way and are left out.
  const SKIP = ["zeromin", "nothing"], dates = games.map((g) => g.d).sort();
  const t = {}; for (const [k, e] of Object.entries(T)) { if (SKIP.includes(k)) continue; t[k] = Object.fromEntries(MARKS.map((m) => { const c = e[m] || { n: 0, held: 0, on: 0, onHeld: 0, ot: 0, otHeld: 0 }; return [m, [c.n, c.held, c.on, c.onHeld, c.ot, c.otHeld]]; })); }
  // ALL without the two skipped rules
  for (const m of MARKS) for (const k of SKIP) { const c = T[k]?.[m]; if (!c) continue; const a = t.ALL[m]; a[0] -= c.n; a[1] -= c.held; a[2] -= c.on; a[3] -= c.onHeld; a[4] -= c.ot; a[5] -= c.otHeld; }
  const out = { v: 1, made: new Date().toISOString().slice(0, 10), from: dates[0], through: dates[dates.length - 1], marks: MARKS, cols: ["n", "held", "onFloor", "onFloorHeld", "overtimeGames", "overtimeHeld"],
    note: "Regulation games in n/held; a line 'held' when the same template still matched the final box score. Players whose rebuilt line equals the box score only.",
    counts: { games: games.length, noPlays: none, overtime: ot, playerGames: players, clean, floorKnown }, skipped: SKIP, t };
  fs.writeFileSync(path.join(ROOT, "src", "data", "odd-lines-hold.json"), JSON.stringify(out));
  console.log("wrote src/data/odd-lines-hold.json", JSON.stringify(out.t.ALL));
}
