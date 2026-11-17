// Checks the guides' all-time series records against Basketball Reference's head-to-head pages
// (tools/outside/bref-head2head.json). A page includes this season's games played when it was read, so each page's
// date is worked out from the pairings both guides already agree on, and those games are taken off.
//
//   node tools/check-series-outside.mjs [--write]     --write adds the settled pairings to src/data/series-verified.json
import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib"; import { fileURLToPath } from "node:url";
import { deepSeqs } from "../src/situations/deepseq.js";
import { seriesTable, countedPairs } from "../src/records/series.js";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), D = (f) => path.join(root, "src", "data", f);
const gz = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(D(f)))), js = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const S = js(D("nba-series-history-2026-27.json")), H = js(D("nba-results-history.json")), official = js(D("nba-team-seasons-2026-27.json")).teams;
const B = js(path.join(root, "tools", "outside", "bref-head2head.json"));
S.counted = countedPairs({ deep: deepSeqs({ older: gz("nba-results-older.json.gz"), guide: gz("guide-games-2026-27.json.gz"), official }), history: H, official, through: S.through });
const T = seriesTable(S, [], "2026-10-01");                                  // through 2025-26, no outside check
const dir = path.join(root, "history", "results");
const season = fs.readdirSync(dir).filter((f) => /^2026-(1[0-2])|^2027-/.test(f)).flatMap((f) => { const j = js(path.join(dir, f)); return j.games || j; }).filter((g) => g.hs > 0 && g.as > 0 && !g.cupFinal && (g.type == null || g.type === 2));
const gamesOf = (a, b) => season.filter((g) => (g.h === a && g.a === b) || (g.h === b && g.a === a)).sort((x, y) => (x.d < y.d ? -1 : 1)).map((g) => ({ d: g.d, aWon: (g.h === a) === (g.hs > g.as) }));
const minus = ([w, l], gs) => [w - gs.filter((g) => g.aWon).length, l - gs.filter((g) => !g.aWon).length];
const row = (a, b) => T.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
const from = (r, a) => (r.a === a ? [r.overall.w, r.overall.l] : [r.overall.l, r.overall.w]);
const ABA = new Set(["BKN", "DEN", "IND", "SAS"]), aba = new Set();
// 1. each page's date: the day that makes the most already-confirmed pairings agree
const dates = [...new Set(season.map((g) => g.d))].sort(), pageDate = {};
for (const [t, opps] of Object.entries(B.pages)) {
  let best = null;
  for (const d of ["0000", ...dates]) {
    let n = 0, all = 0;
    for (const [o, wl] of Object.entries(opps)) { const r = row(t, o); if (r.status !== "confirmed" || (ABA.has(t) && ABA.has(o))) continue; all++; const m = minus(wl, gamesOf(t, o).filter((g) => g.d <= d)), mine = from(r, t); n += m[0] === mine[0] && m[1] === mine[1]; }
    if (!best || n >= best.n) best = { d, n, all };
  }
  pageDate[t] = best;
}
// 2. every pairing on a page, with that page's games taken off
const seen = {}, out = { agree: 0, confirmedOff: [], settled: [], neither: [] };
for (const [t, opps] of Object.entries(B.pages)) for (const [o, wl] of Object.entries(opps)) {
  const key = [t, o].sort().join("-"), r = row(t, o), [a, b] = [r.a, r.b];
  const m = minus(wl, gamesOf(t, o).filter((g) => g.d <= pageDate[t].d)), rec = t === a ? m : [m[1], m[0]];      // seen from a
  if (ABA.has(t) && ABA.has(o)) { aba.add(key); continue; }                  // these pages count the ABA years between the four ABA teams
  if (seen[key]) { if (seen[key][0] !== rec[0] || seen[key][1] !== rec[1]) console.log(`two pages disagree on ${key}: ${seen[key]} / ${rec}`); continue; }
  seen[key] = rec;
  const mine = [r.overall.w, r.overall.l], other = r.other?.overall ? [r.other.overall.w, r.other.overall.l] : null, eq = (x) => x && x[0] === rec[0] && x[1] === rec[1];
  if (r.status === "confirmed") { if (eq(mine)) out.agree++; else out.confirmedOff.push({ a, b, ours: mine, bref: rec, source: r.source }); continue; }
  const hit = eq(mine) ? r.source[0] : eq(other) ? r.source.length && S.teams[a] && (r.source[0] === a ? b : a) : null;
  (hit ? out.settled : out.neither).push({ a, b, status: r.status, shown: mine, by: r.source, other, bref: rec, right: hit });
}
console.log("page dates:", Object.entries(pageDate).map(([t, p]) => `${t} ${p.d} (${p.n}/${p.all})`).join(", "));
console.log(`confirmed pairings checked: ${out.agree + out.confirmedOff.length}; agree: ${out.agree}; off: ${out.confirmedOff.length}`);
for (const x of out.confirmedOff) console.log(`  OFF ${x.a}-${x.b}: ours ${x.ours.join("-")} (${x.source.join("+")}) / Basketball Reference ${x.bref.join("-")}`);
console.log(`open pairings on these pages: ${out.settled.length + out.neither.length}; one guide is right: ${out.settled.length}; neither: ${out.neither.length}`);
for (const x of out.settled) console.log(`  ${x.status} ${x.a}-${x.b}: shown ${x.shown.join("-")} (${x.by.join("+")})${x.other ? `, other ${x.other.join("-")}` : ""} / Basketball Reference ${x.bref.join("-")} -> ${x.right}`);
for (const x of out.neither) console.log(`  NEITHER ${x.status} ${x.a}-${x.b}: shown ${x.shown.join("-")} (${x.by.join("+")})${x.other ? `, other ${x.other.join("-")}` : ""} / Basketball Reference ${x.bref.join("-")}`);
console.log("left out (ABA teams against each other):", [...aba].join(" "));
const open = T.filter((r) => r.status !== "confirmed" && !seen[[r.a, r.b].sort().join("-")]); console.log("open pairings not on these pages:", open.map((r) => `${r.a}-${r.b}`).join(" ") || "none");
if (process.argv.includes("--write")) {
  const f = D("series-verified.json"), V = js(f), have = new Set(V.pairs.map((p) => [p.a, p.b].sort().join("-")));
  for (const x of out.settled) { const k = [x.a, x.b].sort().join("-"); if (have.has(k)) continue;
    V.pairs.push({ a: x.a, b: x.b, w: x.bref[0], l: x.bref[1], through: "2025-26", by: "Basketball Reference", source: `Basketball Reference's head-to-head pages, read 11/17/26, less the 2026-27 games played by then (tools/check-series-outside.mjs)` }); }
  fs.writeFileSync(f, JSON.stringify(V, null, 1) + "\n"); console.log("written:", V.pairs.length, "pairs");
}
