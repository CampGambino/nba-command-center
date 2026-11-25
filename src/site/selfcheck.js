/**
 * The build checks its own output (0.125).
 *
 * The user (11/19/26, after a day in which the Watch List sat seven hours old behind a warning nobody read, two notes
 * headers were misread, and a dead streak led the briefing): "with all the issues you are catching for yourself, can you
 * run a diagnostic that may find these issues and correct them now rather than having them sit dormant."
 *
 * selfCheck() looks at the data a build has just written and returns plain sentences for anything that is not as a
 * reader would assume. scripts/ci.js runs it at the end of every build and puts the sentences in docs/data/health.json;
 * the Watch List shows them in its warning box. tools/diagnose.mjs runs the same checks by hand, with more that need
 * the network and the repo's history.
 *
 * Each check is one of today's faults turned into a rule:
 *   stale     a data file this build did not rewrite (a part that failed quietly keeps its old file)
 *   day       a file built for another day than the Watch List (the live cards count against oddlive.json)
 *   out       a storyline in the top ten, the deep cuts or a game's first three lines about a player listed out or doubtful
 *   ended     a line about a streak the box scores say is over, in the top ten or a game's first three lines
 *   junk      "undefined", "NaN" or "[object Object]" printed in a line
 *   empty     a game on the slate with no lines, or a slate with fewer than five storylines in the briefing
 *   conflict  a team's notes set aside because they seem to name another opponent (read the PDF's header before believing it)
 *   copies    a module the pages or NBA Live read (docs/lib) that differs from its source
 *   bridge    the bridge's version and the published version number apart
 *   said      anything a step printed as a complaint
 *   agree     (0.145.0, the consistency audit 11/24) one fact, two values on two pages: a chase's chance tonight (records vs
 *             milestones), a team's record (standings vs situations), a player's games played (hot hand, award eligibility,
 *             national TV), games missing from the 4th-quarter or Game Flow tables, a player spelled two ways
 *
 * No imports: scripts/ci.js runs in a bare folder in the tests.
 */
export const CHECK_NAMES = ["stale", "day", "out", "ended", "junk", "empty", "conflict", "copies", "bridge", "said", "agree"];
const SAME_DAY = ["briefing", "tonight", "notes-facts", "prep", "shifts", "matchups", "edges"];
const JUNK = /\bundefined\b|\bNaN\b|\[object Object\]/;
const nkey = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?$/, "").replace(/[^a-z]/g, "");
const clockET = (iso) => { try { return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET"; } catch { return String(iso); } };

/**
 * @param {object} o
 * @param {Record<string, any>} o.data   parsed docs/data files by name without ".json" (watch, tonight, briefing, …)
 * @param {number} [o.buildStart]        when this build began (ms); files older than it were not rewritten
 * @param {string[]} [o.keptFiles]       files knowingly left as published (the notes guard keeps "watch")
 * @param {Array<{name: string, same: boolean}>} [o.copies]
 * @param {{ running: number, published: number }} [o.bridge]
 * @param {string[]} [o.said]            complaint lines from the steps
 * @returns {Array<{ check: string, text: string }>}
 */
export function selfCheck({ data = {}, buildStart = null, keptFiles = [], copies = [], bridge = null, said = [] } = {}) {
  const out = [], add = (check, text) => out.push({ check, text });
  const watch = data.watch || null, today = watch?.today || null;

  if (buildStart) for (const [name, j] of Object.entries(data)) {
    if (!j || !j.generatedAt || keptFiles.includes(name) || name === "health") continue;
    const at = Date.parse(j.generatedAt);
    if (Number.isFinite(at) && at < buildStart - 60e3) add("stale", `${name}.json was not rebuilt by this build: it is from ${clockET(j.generatedAt)}, so the part of the site that reads it is showing older data`);
  }

  if (today) {
    for (const name of SAME_DAY) { const j = data[name]; if (j && j.today && j.today !== today) add("day", `${name}.json is for ${j.today}, the Watch List for ${today}`); }
    const live = data.oddlive;
    if (live && live.before && live.before !== today && (watch.games || []).length) add("day", `oddlive.json counts games before ${live.before}, not before ${today}: NBA Live's odd-line cards would count from the wrong day`);
  }

  // who is listed out or doubtful tonight
  const inj = data.injuries, gone = new Map();
  if (inj && today && inj.date === today) for (const p of inj.players || []) if (/^(out|doubtful)$/i.test(p.status || "")) gone.set(`${p.team}|${nkey(p.name)}`, p.status);
  // 0.157.0: an award-eligibility line is about the games he misses ("can miss 3 more games and stay award-eligible"):
  // his being out tonight is the story, as with an injury line (11/25: Anthony Edwards' was flagged on the Watch List)
  const isGone = (l) => l && l.player && l.kind !== "injury" && l.kind !== "awards" && gone.get(`${l.team}|${nkey(l.player)}`);
  const spots = [];
  for (const [i, l] of (data.briefing?.top || []).entries()) spots.push([`#${i + 1} in the briefing`, l]);
  for (const [i, l] of (data.briefing?.deep || []).entries()) spots.push([`deep cut ${i + 1}`, l]);
  for (const g of data.tonight?.games || []) for (const [i, l] of (g.lines || []).slice(0, 3).entries()) spots.push([`line ${i + 1} of ${g.away} at ${g.home} (a pre-game card in NBA Live)`, l]);
  for (const [where, l] of spots) {
    const st = isGone(l);
    if (st) add("out", `${where} is about ${l.player}, who is listed ${String(st).toLowerCase()} tonight: "${String(l.text).slice(0, 90)}"`);
    if (l.ended || /^[A-Z]{3} notes[^·]{0,40}Streak over ·/.test(String(l.text))) add("ended", `${where} is about a streak the box scores say is over: "${String(l.text).slice(0, 90)}"`);
  }

  const texts = [];
  for (const l of [...(data.briefing?.top || []), ...(data.briefing?.deep || []), ...(data.briefing?.lastNight || [])]) texts.push(["the briefing", l.text]);
  for (const g of data.tonight?.games || []) for (const l of g.lines || []) texts.push([`${g.away} at ${g.home}`, l.text]);
  for (const t of watch?.teams || []) for (const it of t.items || []) texts.push([`${t.team}'s milestones`, `${it.player} ${it.label ?? ""} ${it.text ?? ""}`]);
  const junk = texts.filter(([, t]) => JUNK.test(String(t)));
  if (junk.length) add("junk", `${junk.length} line${junk.length === 1 ? "" : "s"} print a broken value, first in ${junk[0][0]}: "${String(junk[0][1]).slice(0, 100)}"`);

  if (watch && (watch.games || []).length) {
    const tg = data.tonight?.games || null;
    if (tg && data.tonight.today === today) {
      if (tg.length !== watch.games.length) add("empty", `the Watch List has ${watch.games.length} games tonight and the storylines ${tg.length}`);
      for (const g of tg) if (!(g.lines || []).length) add("empty", `${g.away} at ${g.home} has no storylines`);
    }
    if (data.briefing && data.briefing.today === today && (data.briefing.top || []).length < Math.min(5, 2 * watch.games.length)) add("empty", `the briefing has ${(data.briefing.top || []).length} storylines for ${watch.games.length} games`);
  }

  for (const t of watch?.teams || []) if (t.notesStatus === "conflict") add("conflict", `${t.team}'s notes are set aside: ${t.notesWhy || "they seem to name another opponent"}. Twice this has been a misread header, so read the first lines of the PDF`);

  for (const c of copies || []) if (!c.same) add("copies", `docs/lib/${c.name} is not the same as its source: the pages and NBA Live are reading an older copy`);
  if (bridge && bridge.running !== bridge.published) add("bridge", `the bridge is version ${bridge.running} and bridge/version.json says ${bridge.published}`);
  for (const s of said || []) add("said", String(s).slice(0, 220));
  for (const t of agreement(data)) add("agree", t);
  return out;
}

/** 0.145.0: the same fact published twice must say the same thing (see "agree" above). -> sentences, at most a few of each kind. */
export function agreement(data) {
  const out = [], few = (list, n = 3) => list.slice(0, n).join("; ") + (list.length > n ? `; and ${list.length - n} more` : "");
  const pct = (p) => `${Math.round(p * 100)}%`;
  // a chase's chance tonight
  const W = new Map();
  for (const t of data.watch?.teams || []) for (const i of t.items || []) if (i.espnId && i.target != null && i.current != null && typeof i.pTonight === "number") W.set(`${i.espnId}|${i.stat}|${i.target}|${i.current}`, i);
  const chances = [];
  const walk = (o) => { if (!o || typeof o !== "object") return; if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o.id && o.stat && o.target != null && o.now != null && typeof o.pTonight === "number") { const w = W.get(`${o.id}|${o.stat}|${o.target}|${o.now}`); if (w && Math.abs(w.pTonight - o.pTonight) >= 0.01) chances.push(`${o.who} ${Number(o.target).toLocaleString("en-US")} ${o.label || o.stat}: ${pct(o.pTonight)} on the Records page, ${pct(w.pTonight)} on the Watch List`); return; }
    for (const v of Object.values(o)) walk(v); };
  walk(data.records?.items);
  if (chances.length) out.push(`${chances.length} chase${chances.length === 1 ? "" : "s"} with two chances tonight: ${few(chances)}`);
  // a team's record
  const sit = data.situations?.teams || {}, wl = (x) => (x ? `${x.w}-${x.l}` : null), teams = [];
  for (const conf of ["East", "West"]) for (const t of data.standings?.[conf] || []) {
    const s = sit[t.tri]; if (!s?.splits) continue;
    for (const [k, a, b] of [["record", `${t.w}-${t.l}`, wl(s.splits.all)], ["home", t.home, wl(s.splits.home)], ["road", t.road, wl(s.splits.road)], ["last 10", t.last10, wl(s.last10)], ["streak", t.streak, s.streak]])
      if (a != null && b != null && a !== b) teams.push(`${t.tri} ${k} ${a} in the standings, ${b} in Team situations`);
  }
  if (teams.length) out.push(`${teams.length} team number${teams.length === 1 ? "" : "s"} differ between pages: ${few(teams)}`);
  // a player's games played
  const gp = new Map(), name = new Map(), note = (id, where, n, nm) => { if (!Number.isFinite(n)) return; (gp.get(id) || gp.set(id, {}).get(id))[where] = n; if (nm) name.set(id, nm); };
  for (const [id, p] of Object.entries(data.form?.players || {})) note(id, "hot hand", (p.g || []).length, p.name);
  for (const p of data.eligibility?.players || []) if (Number.isFinite(p.apps)) note(String(p.id), "award eligibility", p.apps, p.name);
  for (const p of data.national?.players || []) note(String(p.id), "national TV", (p.nat?.gp || 0) + (p.other?.gp || 0), p.name);
  const games = [];
  for (const [id, v] of gp) { const vals = Object.values(v); if (vals.length > 1 && Math.max(...vals) !== Math.min(...vals)) games.push(`${name.get(id) || id} (${Object.entries(v).map(([w, n]) => `${n} ${w}`).join(", ")})`); }
  if (games.length) out.push(`${games.length} player${games.length === 1 ? "" : "s"} with different games played on different pages: ${few(games)}`);
  // 0.146.0: a games-played run in the notes against our count (src/notes/facts.js checkGamesPlayed)
  const gpl = [];
  for (const [tri, L] of Object.entries(data["notes-facts"]?.teams || {})) for (const l of L || []) if (l.gpCheck && l.gpCheck.said !== l.gpCheck.now) gpl.push(`${tri} notes: ${l.player || "a player"} ${l.gpCheck.said} straight games, our count ${l.gpCheck.now}`);
  if (gpl.length) out.push(`${gpl.length} games-played run${gpl.length === 1 ? "" : "s"} in the notes differ from our box scores: ${few(gpl)}`);
  // games missing from the per-game tables
  const all = (data.games?.games || []).length;
  for (const [f, label] of [["q4-players", "4th-quarter"], ["flowstats", "Game Flow"]]) { const n = data[f]?.games; if (all && Number.isFinite(n) && n < all) out.push(`the ${label} tables count ${n} of the season's ${all} games`); }
  // a player spelled two ways
  const spell = new Map(), seen = (n, where) => { if (!n || typeof n !== "string") return; const k = nkey(n); if (!k) return; const m = spell.get(k) || spell.set(k, new Map()).get(k); if (!m.has(n)) m.set(n, where); };
  for (const l of [...(data.briefing?.top || []), ...(data.briefing?.deep || []), ...(data.briefing?.finds || [])]) seen(l.player, "the briefing");
  for (const i of data.records?.items || []) seen(i.who, "the Records page");
  for (const s of data.trends?.streaks || []) seen(s.name, "the Streaks page");
  for (const p of Object.values(data.form?.players || {})) seen(p.name, "hot hand");
  const two = [...spell.values()].filter((m) => m.size > 1).map((m) => [...m].map(([n, w]) => `"${n}" (${w})`).join(" and "));
  if (two.length) out.push(`${two.length} player${two.length === 1 ? "" : "s"} spelled two ways: ${few(two)}`);
  return out;
}

