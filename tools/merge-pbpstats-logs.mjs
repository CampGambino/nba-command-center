#!/usr/bin/env node
// Puts the Bulls and Pelicans games of 2016-17 and 2017-18 into the players' logs (0.107, not yet run for real). ESPN has
// zeros for every player in those games; the numbers come from pbpstats (tools/fetch-pbpstats.mjs → tools/outside/pbpstats/).
// A player is matched to his ESPN id by name through ESPN's own (zeroed) box score for the same game, which lists who played.
//
//   node tools/merge-pbpstats-logs.mjs --boards <dir of ls-YYYY-MM-DD.json> --dir <cache of ESPN p-<id>.json> [--write] [--out file]
//
// Without --write it only reports. A game goes in only when both teams' pbpstats points add up to the score and that score
// is ESPN's. Rows get a last column, src = "p": pbpstats counts from the play-by-play, so points, field goals, threes and
// free throws are exact, and rebounds, assists, steals and blocks are a floor (see CHANGES 0.106.2). Readers must not let a
// line turn on those four for a row with src "p". Only players already in the logs file (current players) get rows.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const BOARDS = arg("--boards"), DIR = arg("--dir"), SRC = arg("--src", "tools/outside/pbpstats"), LOGS = "src/data/player-logs-history.json.gz", OUT = arg("--out", LOGS);
if (!BOARDS || !DIR) { console.error("usage: merge-pbpstats-logs.mjs --boards <dir> --dir <cache> [--write] [--out file]"); process.exit(1); }
const ALIAS = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", PHO: "PHX" }, tri = (a) => ALIAS[a] || a;
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?$/g, "").replace(/[^a-z]/g, "");
// names pbpstats and ESPN spell differently (each seen in the data)
// (0.107.8: the two below were found on the 217-game check, each from the one ESPN name left without a line that night:
// LAL at NOP 11/12/16, "Marcelinho Huertas"; NOP at OKC 12/4/16, "Enes Freedom", the name ESPN now gives Enes Kanter)
const SAME = { juanhernangomez: "juanchohernangomez", marcelohuertas: "marcelinhohuertas", eneskanter: "enesfreedom", walterlemon: "waltlemon" };
const L = JSON.parse(zlib.gunzipSync(fs.readFileSync(LOGS)));
const cols = L.columns.includes("src") ? L.columns : [...L.columns, "src"], ix = Object.fromEntries(cols.map((c, i) => [c, i]));
const stats = { games: 0, used: 0, pointsOff: 0, noEspn: 0, lines: 0, matched: 0, current: 0, added: 0, already: 0 }, unmatched = {}, shown = [];
for (const f of fs.readdirSync(SRC).filter((x) => /^box-.*\.jsonl$/.test(x)).sort()) for (const line of fs.readFileSync(path.join(SRC, f), "utf8").split("\n").filter(Boolean)) {
  const g = JSON.parse(line); stats.games++;
  const sum = (s) => g.p[s].reduce((a, p) => a + p[3], 0);
  if (sum("Home") !== g.hs || sum("Away") !== g.as) { stats.pointsOff++; continue; }
  let ev = null;
  try { ev = (JSON.parse(fs.readFileSync(path.join(BOARDS, `ls-${g.d}.json`), "utf8")).events || []).find((e) => e.type === 2 && e.c.some((c) => c.ha === "home" && tri(c.a) === g.h && c.s === g.hs) && e.c.some((c) => c.ha === "away" && tri(c.a) === g.a && c.s === g.as)); } catch { /* no scoreboard */ }
  let box = null; try { box = ev && JSON.parse(fs.readFileSync(path.join(DIR, `p-${ev.id}.json`), "utf8")); } catch { /* not fetched */ }
  if (!box) { stats.noEspn++; continue; }
  stats.used++;
  const ids = {}; for (const t of box) for (const p of t.p) ids[norm(p[1])] = String(p[0]);
  for (const [side, home, opp, won] of [["Home", 1, g.a, g.hs > g.as], ["Away", 0, g.h, g.as > g.hs]]) for (const p of g.p[side]) {
    stats.lines++;
    const key = norm(p[1]), id = ids[key] || ids[SAME[key]];
    if (!id) { unmatched[p[1]] = (unmatched[p[1]] || 0) + 1; continue; }
    stats.matched++;
    const rows = L.players[id]; if (!rows) continue; stats.current++;
    if (rows.some((r) => r[ix.date] === g.d)) { stats.already++; continue; }
    const m = /^(\d+):(\d+)/.exec(p[2] || ""), min = m ? Math.round(+m[1] + +m[2] / 60) : null;
    if (!min && !p[3] && !p[4] && !p[7]) continue; // listed, did not play
    const row = []; row[ix.date] = g.d; row[ix.opp] = opp; row[ix.home] = home; row[ix.result] = won ? "W" : "L"; row[ix.type] = 2; row[ix.min] = min;
    row[ix.pts] = p[3]; row[ix.reb] = p[4]; row[ix.ast] = p[7]; row[ix.stl] = p[8]; row[ix.blk] = p[9]; row[ix.fg3m] = p[10]; row[ix.fg3a] = p[11]; row[ix.fgm] = p[12]; row[ix.fga] = p[13]; row[ix.ftm] = p[14]; row[ix.fta] = p[15]; row[ix.src] = "p";
    for (let i = 0; i < cols.length; i++) if (row[i] === undefined) row[i] = null;
    rows.push(row); stats.added++;
    if (p[3] >= 40) shown.push(`${g.d} ${p[1]} ${p[3]} pts (${side === "Home" ? "vs" : "at"} ${opp})`);
  }
}
for (const rows of Object.values(L.players)) rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
console.log(JSON.stringify(stats)); console.log("not matched to an ESPN id:", JSON.stringify(unmatched)); console.log("40-point games now on file:", shown.join("; ") || "none");
if (process.argv.includes("--write")) { L.columns = cols; L.note = `${L.note ? L.note + " " : ""}Rows with src "p" are the Bulls and Pelicans games of 2016-17 and 2017-18, from pbpstats: points and shooting exact, rebounds, assists, steals and blocks a floor.`; fs.writeFileSync(OUT, zlib.gzipSync(JSON.stringify(L), { level: 9 })); console.log("written", OUT); }
