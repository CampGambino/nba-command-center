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
 *
 * No imports: scripts/ci.js runs in a bare folder in the tests.
 */
export const CHECK_NAMES = ["stale", "day", "out", "ended", "junk", "empty", "conflict", "copies", "bridge", "said"];
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
  const isGone = (l) => l && l.player && l.kind !== "injury" && gone.get(`${l.team}|${nkey(l.player)}`);
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
  return out;
}
