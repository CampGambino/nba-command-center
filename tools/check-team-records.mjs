// Each guide's printed points marks (most, fewest, most allowed, fewest allowed in a game) beside the same marks counted
// from the games on file, value and date. A print older than a team's game list cannot match; anything else that
// differs is a misprint or a reader fault and wants looking up.
//
//   node tools/check-team-records.mjs [src/data/team-game-records-2026-27.json] [TRI ...]
import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib"; import { fileURLToPath } from "node:url";
import { deepSeqs } from "../src/situations/deepseq.js";
import { teamGameRecords } from "../src/records/teamgame.js";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), D = (f) => path.join(root, "src", "data", f);
const gz = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(D(f)))), js = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const args = process.argv.slice(2), file = args.find((a) => a.endsWith(".json")) || D("team-game-records-2026-27.json"), want = args.filter((a) => /^[A-Z]{3}$/.test(a));
const official = js(D("nba-team-seasons-2026-27.json")).teams;
const deep = deepSeqs({ older: gz("nba-results-older.json.gz"), guide: gz("guide-games-2026-27.json.gz"), official });
const dir = path.join(root, "history", "results");
const rows = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d{4}-/.test(f)).flatMap((f) => { const j = js(path.join(dir, f)); return j.games || j; }) : [];
const T = teamGameRecords({ deep, history: js(D("nba-results-history.json")), rows });      // counted only: no printed marks passed in
const P = js(file).teams;
let same = 0, all = 0;
for (const t of Object.keys(P).sort()) {
  if (want.length && !want.includes(t)) continue;
  const r = T[t], f = (side, kind) => P[t].find((m) => m.stat === "pts" && m.period === "game" && m.kind === kind && (m.side || "team") === side);
  const pairs = [["most", f("team", "most"), r.marks.most], ["fewest", f("team", "fewest"), r.marks.fewest], ["allowed", f("opp", "most"), r.marks.allowed], ["held", f("opp", "fewest"), r.marks.held]];
  for (const [, p, g] of pairs) { if (p && g) { all++; same += p.value === g.v; } }
  console.log(t, `${r.window.from}${r.window.whole ? "*" : ""}`, pairs.map(([n, p, g]) => `${n} print ${p ? `${p.value} ${p.games[0]?.date || p.times || ""}` : "-"} / games ${g ? `${g.v} ${g.d}` : "-"}${p && g && p.value === g.v ? " ✓" : ""}`).join(" | "));
}
console.log(`${same} of ${all} printed points marks equal the mark counted from the games (* = games on file reach the franchise's first season)`);
