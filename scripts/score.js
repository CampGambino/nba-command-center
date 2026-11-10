#!/usr/bin/env node
/**
 * Calibration: score a saved Watch List against what happened.
 *   node scripts/score.js data/predictions-2026-11-09.json
 * For every milestone given a chance for that night, reads the night's box
 * score and checks whether the player got there. Prints each call, the Brier
 * score (0 = perfect, 0.25 = coin-flip guessing) and hit rates by probability
 * band, and appends a summary line to data/calibration.jsonl.
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";

if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ["--no-warnings", ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  process.exit(r.status ?? 1);
}
const { createEspn } = await import("../src/espn/client.js");
const { statFromLine } = await import("../src/registry/track.js");

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/score.js <predictions.json>"); process.exit(2); }
const { today, reports } = JSON.parse(fs.readFileSync(file, "utf8"));
const espn = createEspn({ dataDir: "data" });
const teams = await espn.teams();
if (!teams.ok) { console.error(teams.error); process.exit(1); }

const calls = [];
for (const rep of reports) {
  const sched = await espn.schedule(teams.data.ids[rep.team]);
  const game = sched.ok && sched.data.games.find((g) => g.date === today && g.seasonType === 2);
  if (!game) { console.log(`${rep.team}: no game on ${today}`); continue; }
  const box = await espn.box(game.id);
  if (!box.ok || !box.data.final) { console.log(`${rep.team}: game not final yet`); continue; }
  for (const i of rep.items) {
    if (i.pTonight == null || !i.tracking || i.pPlayTonight == null) continue;
    const line = box.data.players.find((p) => (i.espnId ? p.id === i.espnId : p.team === rep.team && p.name && sameish(p.name, i.player)));
    const v = statFromLine(i.stat, line);
    if (v === null) continue;
    calls.push({ team: rep.team, player: i.player, what: i.kind === "pass" ? `pass ${i.passing?.player}` : `${i.target} ${i.label}`, need: i.need, p: i.pTonight, got: v, hit: v >= i.need });
  }
}
function sameish(a, b) {
  const k = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’'.]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
  return k(a) === k(b);
}

calls.sort((a, b) => b.p - a.p);
for (const c of calls.filter((c) => c.p >= 0.05 || c.hit)) console.log(`${c.hit ? "HIT " : "miss"} ${String(Math.round(c.p * 100)).padStart(3)}%  ${c.team} ${c.player}: ${c.what} (needed ${c.need}, got ${c.got})`);
const brier = calls.length ? calls.reduce((a, c) => a + (c.p - (c.hit ? 1 : 0)) ** 2, 0) / calls.length : null;
const bands = [[0, 0.05], [0.05, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 0.95], [0.95, 1.01]].map(([lo, hi]) => {
  const cs = calls.filter((c) => c.p >= lo && c.p < hi);
  return { band: `${Math.round(lo * 100)}-${Math.min(100, Math.round(hi * 100))}%`, n: cs.length, predicted: cs.length ? cs.reduce((a, c) => a + c.p, 0) / cs.length : null, actual: cs.length ? cs.filter((c) => c.hit).length / cs.length : null };
});
console.log(`\n${calls.length} calls scored, Brier ${brier?.toFixed(3)} (lower is better; always guessing 50% scores 0.250)`);
for (const b of bands.filter((b) => b.n)) console.log(`  ${b.band.padEnd(8)} n=${String(b.n).padStart(3)}  predicted ${(b.predicted * 100).toFixed(0)}%  happened ${(b.actual * 100).toFixed(0)}%`);
// The 0-5% band is mostly "can't happen tonight" (needs 7 more games): easy calls that flatter
// the overall score. The calls that matter are the ones given 5% or more.
const real = calls.filter((c) => c.p >= 0.05);
const brierReal = real.length ? real.reduce((a, c) => a + (c.p - (c.hit ? 1 : 0)) ** 2, 0) / real.length : null;
if (real.length) console.log(`calls given 5%+: ${real.length}, happened ${real.filter((c) => c.hit).length}, expected ${real.reduce((a, c) => a + c.p, 0).toFixed(1)}, Brier ${brierReal.toFixed(3)}`);
// One line per night: re-scoring the same night replaces its line.
if (calls.length) {
  const file = "data/calibration.jsonl";
  const keep = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() && JSON.parse(l).date !== today) : [];
  keep.push(JSON.stringify({ date: today, scoredAt: new Date().toISOString(), n: calls.length, brier, nReal: real.length, hitsReal: real.filter((c) => c.hit).length, expectedReal: real.reduce((a, c) => a + c.p, 0), brierReal, bands }));
  fs.writeFileSync(file, keep.join("\n") + "\n");
}
