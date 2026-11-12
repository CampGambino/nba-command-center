import { normStat, num } from "./stats.js";

/**
 * Narrative milestone text, read in the right order.
 *
 * Game notes put two or three columns of prose side by side. Reading a page
 * straight across splices sentences from different columns together (seen in
 * the Game Notes Analyzer's saved runs: "...snapped its five- Jordin Canada's
 * layup at the buzzer gave..."). Here each page is first split into columns at
 * its empty vertical gutters, each column is read top to bottom, then cut at
 * bullets ("•"), "..." separators and sentence ends.
 *
 * Two outputs:
 *   readAwayFrom  - structured milestones from "X is 93 rebounds away from
 *                   1,500 career rebounds... 36 games away from 500 career
 *                   games played" bullets (Charlotte's format)
 *   readNarrative - other forward-looking sentences, verbatim, never rewritten.
 *                   Marked unverified: sidebars can still interleave.
 */

const FORWARD = /\bneeds?\s+(?:just\s+|only\s+)?\d[\d,]*\b|\b\d[\d,]*\s+(?:[\w-]+\s+){0,3}(?:shy|away)\s+(?:of|from)\b|\bwithin\s+\d[\d,]*\s+(?:points?|rebounds?|assists?|steals?|blocks?|games?|wins?|of)\b|\bwould\s+(?:become|pass|tie|join|move|surpass|reach)\b|\bis\s+(?:approaching|closing in on|nearing)\b|\bon pace (?:to|for)\b|\bcan (?:become|pass|tie|join|move up|reach)\b|\bwith (?:his|her|their) next\b/i;

const SUBJECT = /^(\p{Lu}[\p{L}’'.\-]+(?:\s+\p{Lu}[\p{L}’'.\-]+){1,2})\s+is\s+/u;
const SEG_ROUND = /^(?:and\s+)?(\d[\d,]*)\s+([a-z0-9][a-z0-9\- ]*?)\s+(?:away\s+)?from\s+(\d[\d,]*)\s+((?:career|made)\s+)*([a-z0-9][a-z0-9\- ]*?)\s*[.,;]?$/i;
const SEG_PASS = /^(?:and\s+)?(\d[\d,]*)\s+([a-z0-9][a-z0-9\- ]*?)\s+away\s+from\s+(?:passing|tying)\s+(\p{Lu}[\p{L}.’'\- ]+?)\s+for\s+(.+?)\s+in\s+(franchise|NBA|team|club)\s+history\s*[.,;]?$/iu;

/** Text blocks: every bullet / sentence of every column, in reading order. */
export function blocks(doc) {
  const out = [];
  for (const page of doc.pages) {
    for (const col of columnsOf(page)) {
      const text = col
        .join("\n")
        .replace(/(\w)-\n(\w)/g, "$1$2") // word broken across lines
        .replace(/\s*\n\s*/g, " ")
        .replace(/\s+/g, " ");
      for (const bullet of text.split(/\s*[•▪●]\s*/)) {
        if (bullet.trim()) out.push({ page: page.page, text: bullet.trim() });
      }
    }
  }
  return out;
}

export function readAwayFrom(doc) {
  const out = [];
  for (const b of blocks(doc)) {
    const subj = b.text.match(SUBJECT);
    if (!subj || !/away from|played from/i.test(b.text)) continue;
    const player = subj[1];
    const body = b.text.slice(subj[0].length);
    for (const seg of body.split(/\s*(?:\.{3}|…)\s*/)) {
      const s = fitSegment(seg.trim());
      if (!s) continue;
      const p = s.match(SEG_PASS);
      if (p) {
        out.push({
          format: "away-from-pass", page: b.page, player,
          statRaw: p[2], stat: normStat(p[2].replace(/\s+made$/i, "")),
          need: num(p[1]), passing: p[3].trim(), forWhat: p[4].trim(),
          scope: /nba/i.test(p[5]) ? "nba" : "franchise",
          text: `${player} is ${s}`,
        });
        continue;
      }
      const m = s.match(SEG_ROUND);
      if (!m) continue;
      const counted = normStat(m[2]);
      const named = normStat(`${m[4] && /made/i.test(m[4]) && !/made/i.test(m[5]) ? "made " : ""}${m[5]}`) || normStat(m[5]);
      const need = num(m[1]), target = num(m[3]);
      out.push({
        format: "away-from", page: b.page, player,
        statRaw: m[5], stat: named || counted,
        statMismatch: counted && named && counted !== named ? `counts "${m[2]}" toward "${m[5]}"` : null,
        target, current: need != null && target != null ? target - need : null, needStated: need,
        scope: "career",
        text: `${player} is ${s}`,
      });
    }
  }
  return out;
}

/**
 * The last bullet of a list can run into whatever follows it in the column
 * (Charlotte p.37: "...25 games away from 500 career games played. Charlotte
 * Hornets All-Time Leaderboard GAMES PLAYED 701 Dell Curry..."). If the whole
 * segment doesn't read, try it cut at each sentence end, shortest first; a cut
 * inside a name ("P.J. Washington") simply fails to match and the next is tried.
 */
function fitSegment(s) {
  if (!s || SEG_PASS.test(s) || SEG_ROUND.test(s)) return s;
  for (const m of s.matchAll(/\.\s+(?=\p{Lu})/gu)) {
    const head = s.slice(0, m.index + 1);
    if (SEG_PASS.test(head) || SEG_ROUND.test(head)) return head;
  }
  return s;
}

export function readNarrative(doc) {
  const out = [];
  for (const b of blocks(doc)) {
    for (const s of sentences(b.text)) {
      if (s.length < 25 || s.length > 420) continue;
      // Headings and table labels are runs of capitals, not prose.
      if (/(?:\b[A-Z0-9’'&\-]{2,}\b[ :,]+){4,}/.test(s)) continue;
      const letters = s.replace(/[^A-Za-z]/g, "");
      if (letters.length && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.6) continue;
      if (FORWARD.test(s)) out.push({ page: b.page, text: s, verbatim: true, verified: false });
    }
  }
  // The same sentence can be printed twice (front page and player page).
  const seen = new Set();
  return out.filter((n) => { const k = n.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Split a page into columns at vertical gutters: x-ranges that almost no line
 * has text in. Returns each column as a list of its lines, top to bottom.
 */
export function columnsOf(page) {
  const width = Math.ceil(page.width || 612);
  const cover = new Uint16Array(width + 1);
  const lines = page.lines.filter((l) => l.cells.length);
  for (const l of lines) for (const c of l.cells) for (let x = Math.max(0, Math.floor(c.x0)); x <= Math.min(width, Math.ceil(c.x1)); x++) cover[x]++;

  const limit = Math.max(1, Math.floor(lines.length * 0.03));
  const gutters = [];
  let start = null;
  for (let x = Math.floor(width * 0.12); x <= Math.ceil(width * 0.88); x++) {
    if (cover[x] <= limit) { if (start === null) start = x; }
    else if (start !== null) { if (x - start >= 8) gutters.push((start + x) / 2); start = null; }
  }
  const bounds = [-Infinity, ...gutters, Infinity];
  const cols = bounds.slice(1).map(() => []);
  for (const l of lines) {
    const perCol = cols.map(() => []);
    for (const c of l.cells) {
      const i = bounds.findIndex((b, k) => k < bounds.length - 1 && c.cx >= b && c.cx < bounds[k + 1]);
      perCol[Math.max(0, i)].push(c.text);
    }
    perCol.forEach((parts, i) => parts.length && cols[i].push(parts.join(" ")));
  }
  return cols.filter((c) => c.length);
}

function sentences(text) {
  // Split after . ! ? or "…" followed by a capital, but not after initials or
  // common abbreviations (Jr., No., vs., Oct., St.).
  const parts = [];
  let last = 0;
  const re = /([.!?…])\s+(?=["“(]?[A-Z])/g;
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, m.index - 4), m.index + 1);
    if (/\b(?:[A-Z]|Jr|Sr|No|vs|St|Mt|Dr|Jan|Feb|Mar|Apr|Aug|Sept?|Oct|Nov|Dec)\.$/.test(before)) continue;
    parts.push(text.slice(last, m.index + 1).trim());
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last).trim());
  return parts.filter(Boolean);
}

/**
 * History lines from a team's notes: what the team's PR staff found worth noting, verbatim.
 *   pass     forward-looking passes / ties ("needs 816 points to pass Kobe Bryant for 4th")
 *   next     other forward-looking lines ("is 12 assists away from 1,000", "on pace to become")
 *   record   history already made ("first rookie since Luka Dončić to...", "only player in NBA history",
 *            "most ... in franchise history", "best start since 1999-00")
 * College / high-school lines are left out; this season's facts score above older background.
 * players: [{ id, name }] of the team, to tie a line to a player (named in it, or under his page heading).
 * -> [{ page, text, kind, player, playerId, when: "season" | "older" | null, score }]
 */
const HISTORY = /\b(?:in (?:NBA|league|franchise|team|club|[A-Z][a-z]+) history|all-time|(?:first|only|second|third|fourth|fifth|\d+(?:st|nd|rd|th)) (?:player|rookie|team|teenager|guard|center|forward|duo|trio|pair|teammates?|players|teams|coach|starter|reserve|\w+ to)\b|since (?:the )?(?:19|20)\d\d|(?:most|fewest|longest|highest|lowest|best|worst)\b[^.]{0,60}\b(?:since|ever|in (?:NBA|franchise|team|league|club) history|by any|of any)|youngest|oldest|fastest|quickest|(?:NBA|franchise|team|league|club|single-game|season|career|rookie|all-time)[- ]records?\b|record for (?:the )?most)/i;
const PASSY = /\b(?:pass|passing|tie|tying|surpass|move (?:up|into|past)|jump)\b/i;
const NOT_NBA = /\b(?:high school|school history|program(?:'s)? (?:history|all-time)|NCAA|college|freshman|sophomore|junior|senior year|AAU|conference tournament|EuroLeague|Olympic|FIBA|national team|G League|summer league|preseason)\b/i;
const CURRENT = /\b(?:this season|this year|2026-27|26-27|tonight|last game|last night|his last|over (?:his|the) (?:past|last) \d+|in (?:each of )?the first \d+ games|through \d+ games|to begin the season|season opener)\b|\b(?:Oct|Nov|Dec)\.? \d{1,2}\b|\b1[0-2]\/\d{1,2}\b/i;
const OLDER = /\b(?:last season|in 20(?:0\d|1\d|2[0-5])-\d\d|20(?:0\d|1\d|2[0-5])-\d\d:|during (?:the )?20(?:0\d|1\d|2[0-5])|previous (?:season|\d+ seasons)|career-long|as a rookie in)\b/i;

export function readHistory(doc, players = [], { seasonStart = null } = {}) {
  const full = players.filter((p) => p.name).map((p) => ({ ...p, re: new RegExp(`\\b${p.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
    last: p.name.split(" ").filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w)).pop() }));
  const lastCount = {};
  for (const p of full) lastCount[p.last.toLowerCase()] = (lastCount[p.last.toLowerCase()] || 0) + 1;
  const plain = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const named = (t) => {
    const x = plain(t);
    const f = full.find((p) => p.re.test(x));
    if (f) return f;
    return full.find((p) => lastCount[p.last.toLowerCase()] === 1 && new RegExp(`\\b${p.last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(x)) || null;
  };
  const out = [], seen = new Set();
  let page = null, current = null, lastNamed = null;
  for (const b of blocks(doc)) {
    // A team / opponent / coach section ends the current player's section (it may span pages).
    if (/\b(?:TEAM NOTES|TONIGHT'?S OPPONENT|NEXT OPPONENT|HEAD COACH|COACHES|SERIES HISTORY|TEAM STATISTICS|STARTERS)\b/.test(b.text)) { current = null; lastNamed = null; }
    page = b.page;
    // A player-page heading ("ALPEREN SENGUN") sets who the following bullets are about.
    // Compared on letters only ("DARIUS ACUFF JR" matches "Darius Acuff Jr."), and only in capitals,
    // so a name mentioned in prose doesn't count as a heading.
    const caps = (t) => plain(t).replace(/[^A-Za-z ]+/g, " ").replace(/\s+/g, " ");
    const headText = caps(b.text);
    const head = full.find((p) => { const n = caps(p.name).trim().toUpperCase().replace(/ (JR|SR|II|III|IV)$/, ""); return n.length > 4 && headText.includes(n); });
    if (head) current = head;
    // Notes chain facts with "…" / "..."; each piece is judged on its own.
    for (let s of sentences(b.text).flatMap((x) => x.split(/\s*(?:…|\.{3}|[\uF0A7\uF0B7\uF0D8\uF076\uF0FC\u25AA\u25CF\u2022])\s*/)).map((x) => x.trim())) {
      if (s.length < 40 || s.length > 420) continue;
      // A capitals heading glued to the sentence ("ANTHONY DAVIS Logged...", "DONČIĆ DELIVERS HISTORIC PERFORMANCE: Luka..."):
      // dropped, but if it names a player it says who the sentence is about.
      let headWho = null;
      const hm = s.match(/^((?:[\p{Lu}0-9’'&.\-\/]{2,}\s+){1,8}?[\p{Lu}0-9’'&.\-\/]{2,}):?\s+(?=\p{Lu}\p{Ll})/u);
      if (hm) { headWho = named(hm[1].replace(/[^\p{L} ]/gu, ' ')) || null; s = s.slice(hm[0].length); if (s.length < 40) continue; }
      // A capitals heading starting the next item mid-sentence ("...in NBA history. 600/400 CLUB: On Oct. 28..."): cut there.
      s = s.replace(/\s+(?:[\p{Lu}0-9\/’'&.\-]{2,}\s+)*[\p{Lu}0-9\/’'&.\-]{3,}:\s.*$/u, "").trim();
      if (s.length < 40) continue;
      // Fragments of stat tables or two bullets run together.
      if (/\d+[prab]-\d+[prab]\b|\s\*\s|\b\d+K (?:PTS|AST|REB)\b|(?:\b[A-Z0-9’'&]{2,}\b\s+){3,}/.test(s)) continue;
      // Spliced or boilerplate fragments: a mid-sentence start, bio boxes, highlight links.
      // Splices across columns: unbalanced brackets, a sentence that stops mid-thought, stray "(10)" counts.
      const open = (s.match(/\(/g) || []).length, close = (s.match(/\)/g) || []).length;
      if (open !== close || !/[.!?)"”]$/.test(s) || /\b(?:to|the|a|of|and|at|in|with|as|by|for)\s*$/i.test(s) || (s.match(/\(\d{1,3}\)/g) || []).length >= 2) continue;
      if (/^[a-z(]/.test(s) || /Notes\/Trends|Video Highlights|Season Stats|\bGP \d|PPG \d|\(cont\.?\)/i.test(s)) continue;
      if (/(?:\b[A-Z0-9’'&\-]{2,}\b[ :,]+){4,}/.test(s)) continue; // table headings
      const digits = s.replace(/[^0-9]/g, "").length;
      if (digits / s.length > 0.22) continue; // stat-table rows
      const fwd = FORWARD.test(s), hist = HISTORY.test(s);
      if (!fwd && !hist) continue;
      if (NOT_NBA.test(s)) continue;
      const key = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seen.has(key)) continue;
      seen.add(key);
      const explicit = named(s) || headWho;
      if (explicit) lastNamed = { p: explicit, page: b.page };
      // Unnamed ("Became the third teenager..."): the section heading, else the player last named just before.
      const near = lastNamed && b.page - lastNamed.page <= 1 ? lastNamed.p : null;
      const who = explicit || current || near;
      const kind = fwd ? (PASSY.test(s) ? "pass" : "next") : "record";
      // Explicit dates decide when a line is from: all before this season's start -> older ("On 3/27/25 ... first rookie this season").
      const dates = [...s.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g)].map((m) => { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; })
        .concat([...s.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+((?:19|20)\d\d)\b/g)].map((m) => `${m[3]}-${String("JanFebMarAprMayJunJulAugSepOctNovDec".indexOf(m[1].slice(0, 3)) / 3 + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`))
        .concat([...s.matchAll(/(\bsince\s+(?:the\s+)?)?\b(?:19|20)(\d\d)-\d\d\b/g)].filter((m) => !m[1]).map((m) => `${+m[2] + (+m[2] > 30 ? 1900 : 2000)}-12-31`)) // "since 1973-74" is a comparison, not when
        .concat(/(?<![\/\d])\d{1,2}\/\d{1,2}(?![\/\d])/.test(s) && seasonStart ? [seasonStart] : []); // "on 11/9": a date this season
      const datedOld = dates.length && seasonStart && dates.every((d) => d < seasonStart);
      const when = datedOld ? "older" : CURRENT.test(s) ? "season" : OLDER.test(s) ? "older" : null;
      const score = (kind === "pass" ? 3 : kind === "next" ? 2.4 : 2) + (when === "season" ? 1 : when === "older" ? -1.2 : 0) + (/in NBA history|all-time|since 19\d\d|first (?:player|rookie|team)/i.test(s) ? 0.8 : 0);
      // guessed: the player comes from the section heading, not from the sentence itself.
      out.push({ page: b.page, text: s, kind, player: who?.name || null, playerId: who?.id || null, guessed: !!who && !explicit, when, score: Math.round(score * 100) / 100 });
    }
  }
  // The same forward fact printed twice ("needs 816 points to pass Kobe Bryant"): keep the line that names the player.
  const fwdKey = (t) => { const m = t.match(/needs?\s+([\d,]+)\s+([a-z-]+(?:\s+[a-z-]+)?)\s+to\s+(?:pass|tie|surpass)\s+([A-Z][^.,]{2,40}?)(?=\s+for|[.,]|$)/i); return m ? m.slice(1).join('|').toLowerCase() : null; };
  const byKey = new Map();
  for (const x of out) { const k = fwdKey(x.text); if (!k) continue; const o = byKey.get(k); if (!o || (o.guessed && !x.guessed)) byKey.set(k, x); }
  return out.filter((x) => { const k = fwdKey(x.text); return !k || byKey.get(k) === x; });
}
