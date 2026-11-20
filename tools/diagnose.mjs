#!/usr/bin/env node
/**
 * The diagnostic (0.125): look for faults that are sitting quietly.
 *
 *   node tools/diagnose.mjs            the published data in this working copy, and the repo's history
 *   node tools/diagnose.mjs --net      also: every team's game notes read against ESPN's schedule, and failed workflow runs
 *   node tools/diagnose.mjs --days 14  how far back the history part looks (default 10)
 *
 * The user (11/19/26): "can you run a diagnostic that may find these issues and correct them now rather than having
 * them sit dormant." Part 1 is the same self-check every build now runs (src/site/selfcheck.js). Parts 2 and 3 need
 * git history and the network, so they are run by hand: after a day of changes, or when something looks off.
 * It changes nothing. Exit code 1 when anything is found.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const NET = process.argv.includes("--net"), DAYS = Number(arg("--days", 10));
const sh = (c) => execSync(c, { cwd: root, maxBuffer: 1 << 29, stdio: ["ignore", "pipe", "ignore"] }).toString();
const et = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
let found = 0;
const say = (head, lines) => { console.log(`\n${head}`); for (const l of lines) console.log(`  ${l}`); };
const bad = (l) => { found++; return `✗ ${l}`; };

// ---------- 1. the published data, as the build checks it ----------
{
  const { selfCheck, CHECK_NAMES } = await import(path.join(root, "src", "site", "selfcheck.js"));
  const dir = path.join(root, "docs", "data"), data = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) { try { data[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { data[f.slice(0, -5)] = null; } }
  const h = data.health || {}, secs = (h.steps || []).reduce((a, s) => a + (s.sec || 0), 0);
  const lib = path.join(root, "docs", "lib"), copies = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".js")) { const rel = path.relative(lib, p), src = path.join(root, "src", rel); if (fs.existsSync(src)) copies.push({ name: rel, same: fs.readFileSync(src, "utf8") === fs.readFileSync(p, "utf8") }); } } };
  if (fs.existsSync(lib)) walk(lib);
  let bridge = null; try { bridge = { running: Number(/var VERSION = (\d+);/.exec(fs.readFileSync(path.join(root, "docs", "bridge", "cc-bridge.js"), "utf8"))[1]), published: JSON.parse(fs.readFileSync(path.join(root, "docs", "bridge", "version.json"), "utf8")).version }; } catch { /* none */ }
  const res = selfCheck({ data, buildStart: h.at ? Date.parse(h.at) - secs * 1000 - 30e3 : null, keptFiles: h.kept ? ["watch"] : [], copies, bridge,
    said: [...Object.entries(data).filter(([, j]) => j === null).map(([n]) => `${n}.json is not valid JSON`), ...(h.steps || []).flatMap((s) => (s.notes || []).map((n) => `${s.step}: ${n}`))] });
  const lines = [`build of ${h.at ? et(h.at) : "?"} ET for ${h.today || "?"}; ${Object.keys(data).length} data files, ${copies.length} copied modules; checks: ${CHECK_NAMES.join(", ")}`];
  if (h.kept) lines.push(bad(`the Watch List was not replaced: ${h.kept}`));
  for (const s of (h.steps || []).filter((x) => !x.ok)) lines.push(bad(`step "${s.step}" failed: ${s.error || ""}`));
  for (const c of res) lines.push(bad(`${c.check}: ${c.text}`));
  // more than the build looks at: every line on the page, not only the top spots
  const inj = data.injuries, gone = new Set(), nk = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?$/, "").replace(/[^a-z]/g, "");
  if (inj && inj.date === data.watch?.today) for (const p of inj.players || []) if (/^(out|doubtful)$/i.test(p.status)) gone.add(`${p.team}|${nk(p.name)}`);
  for (const g of data.tonight?.games || []) for (const [i, l] of (g.lines || []).entries()) if (l.player && l.kind !== "injury" && gone.has(`${l.team}|${nk(l.player)}`)) lines.push(bad(`out: line ${i + 1} of ${g.away} at ${g.home} is about ${l.player}, who is listed out or doubtful`));
  const W = data.trends?.odd?.tonight;
  if (W && W.date === data.watch?.today) { const n = [...(W.runs || []), ...(W.owners || [])].filter((a) => gone.has(`${a.team}|${nk(a.name)}`)); if (n.length) lines.push(`· the odd lines' "to watch tonight" data holds ${n.length} rows for players listed out or doubtful (${[...new Set(n.map((a) => a.name))].slice(0, 6).join(", ")}…); the page leaves them out since 0.125`); }
  const ms = (data.watch?.teams || []).flatMap((t) => (t.items || []).filter((it) => gone.has(`${t.team}|${nk(it.player)}`)));
  if (ms.length) lines.push(`· ${ms.length} milestones are for players listed out or doubtful tonight (kept on purpose: they stay in reach for his next game)`);
  // 0.132.0: a final game stored with no player lines (NYK@MIN 11/19 sat a day like that; every season total and rank
  // was one game short for its players), and the results step's own warnings, which a count used to hide.
  try {
    const { loadStore, allGames } = await import(path.join(root, "src", "situations", "results.js"));
    const st = loadStore(path.join(root, "history", "results"), fs), rows = st ? allGames(st) : [];
    const thin = rows.filter((g) => !g.pl || !Object.keys(g.pl).length);
    for (const g of thin) lines.push(bad(`results: ${g.d} ${g.a}@${g.h} (${g.id}) is final ${g.as}-${g.hs} but has no player lines, so its players' season totals are a game short`));
    const pc = rows.filter((g) => g.pl && Object.keys(g.pl).length && !g.x);
    if (pc.length) lines.push(`· ${pc.length} game(s) have box scores but no clutch or 4th-quarter lines yet (play-by-play doesn't add up): ${pc.map((g) => `${g.d} ${g.a}@${g.h}`).join(", ")}`);
  } catch (e) { lines.push(bad(`results store could not be read: ${e.message}`)); }
  for (const w of data.situations?.warnings || []) lines.push(`· results step said: ${w}`);
  if (lines.length === 1) lines.push("✓ nothing found");
  say("1. THE PUBLISHED DATA", lines);
}

// ---------- 2. the history: builds thrown away, failed steps, notes set aside ----------
{
  const since = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10), lines = [];
  const revs = (f) => sh(`git log --format=%h --since=${since} -- ${f}`).trim().split("\n").filter(Boolean).reverse();
  const hs = revs("docs/data/health.json"); const kept = {}, failed = {}, checks = {};
  for (const r of hs) { let j; try { j = JSON.parse(sh(`git show ${r}:docs/data/health.json`)); } catch { continue; }
    if (j.kept) (kept[j.today] ||= []).push(j.at);
    for (const s of j.steps || []) if (!s.ok) (failed[`${j.today} ${s.step}: ${s.error || "failed"}`] ||= []).push(j.at);
    for (const c of j.checks || []) (checks[`${j.today} ${c.check}: ${String(c.text).slice(0, 110)}`] ||= []).push(j.at); }
  lines.push(`${hs.length} builds since ${since}`);
  for (const [d, a] of Object.entries(kept)) lines.push(bad(`${d}: ${a.length} builds kept the old Watch List, ${et(a[0])} to ${et(a[a.length - 1])} ET`));
  for (const [k, a] of Object.entries(failed)) lines.push(bad(`${k} (${a.length} builds, first ${et(a[0])} ET)`));
  for (const [k, a] of Object.entries(checks)) lines.push(bad(`build check, ${a.length} builds, first ${et(a[0])} ET: ${k}`));
  const ws = revs("docs/data/watch.json"), odd = {}, last = {};
  for (const r of ws) { let j; try { j = JSON.parse(sh(`git show ${r}:docs/data/watch.json`)); } catch { continue; } last[j.today] = j;
    for (const t of j.teams || []) if (!["current", "stale"].includes(t.notesStatus)) (odd[`${j.today} ${t.team} ${t.notesStatus}: ${String(t.notesWhy || "").slice(0, 120)}`] ||= []).push(r); }
  lines.push(`${ws.length} published Watch Lists`);
  for (const [k, a] of Object.entries(odd).sort()) lines.push(bad(`notes not usable in ${a.length} list${a.length === 1 ? "" : "s"}: ${k}`));
  for (const [d, j] of Object.entries(last).sort()) { const x = (j.teams || []).filter((t) => t.notesStatus !== "current"); if (x.length) lines.push(`· ${d}: the day's last list (${et(j.generatedAt)} ET) still had ${x.map((t) => `${t.team} ${t.notesStatus}`).join(", ")}`); }
  if (lines.length === 2) lines.push("✓ nothing found");
  say(`2. THE LAST ${DAYS} DAYS`, lines);
}

// ---------- 3. the network: every team's notes against the schedule; failed workflow runs ----------
if (NET) {
  const lines = [];
  const { TEAMS } = await import(path.join(root, "src", "teams.js"));
  const { readPdf } = await import(path.join(root, "src", "notes", "pdf-layout.js"));
  const { readMeta } = await import(path.join(root, "src", "notes", "meta.js"));
  const { readScoreboard } = await import(path.join(root, "src", "espn", "parse.js"));
  const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", accept: "application/pdf,*/*" };
  const boards = {};
  const board = async (d) => (boards[d] ||= readScoreboard(await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d.replace(/-/g, "")}&limit=100`, { signal: AbortSignal.timeout(20000) })).json()).games);
  let ok = 0, n = 0;
  for (const tri of Object.keys(TEAMS)) {
    n++;
    try {
      const r = await fetch(`https://www.nba.com/gamenotes/${TEAMS[tri].slug}.pdf`, { headers: UA, signal: AbortSignal.timeout(40000) });
      if (!r.ok) { lines.push(bad(`${tri}: notes not downloaded (HTTP ${r.status})`)); continue; }
      const m = readMeta(await readPdf(Buffer.from(await r.arrayBuffer())), tri);
      if (!m.gameDate) { lines.push(bad(`${tri}: no game date found in the notes`)); continue; }
      const g = (await board(m.gameDate)).find((x) => x.awayTri === tri || x.homeTri === tri);
      if (!g) { lines.push(bad(`${tri}: notes dated ${m.gameDate}, and ESPN has no ${tri} game that day`)); continue; }
      const opp = g.awayTri === tri ? g.homeTri : g.awayTri;
      if (m.opponent !== opp) { lines.push(bad(`${tri}: notes for ${m.gameDate} read as vs ${m.opponent}; ESPN has ${opp} (read from: "${String(m.opponentEvidence).slice(0, 70)}")`)); continue; }
      ok++;
    } catch (e) { lines.push(bad(`${tri}: ${e.message}`)); }
  }
  lines.unshift(`${ok} of ${n} teams' notes name the date and opponent ESPN has`);
  try {
    const j = await (await fetch("https://api.github.com/repos/CampGambino/nba-command-center/actions/runs?per_page=100", { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(20000) })).json();
    const runs = j.workflow_runs || [], f = runs.filter((r) => r.conclusion === "failure" || r.conclusion === "timed_out");
    lines.push(`${runs.length} latest workflow runs (back to ${runs.length ? et(runs[runs.length - 1].created_at) : "?"} ET): ${f.length} failed`);
    for (const r of f) lines.push(bad(`${r.name} ${r.conclusion}, ${et(r.created_at)} ET (run ${r.id})`));
  } catch (e) { lines.push(`· workflow runs not read: ${e.message}`); }
  say("3. THE NETWORK", lines);
} else console.log("\n3. THE NETWORK: not run (add --net)");

console.log(`\n${found ? `${found} thing${found === 1 ? "" : "s"} found` : "nothing found"}`);
process.exit(found ? 1 : 0);
