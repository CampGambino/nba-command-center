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

const MONTHS = "janfebmaraprmayjunjulaugsepoctnovdec";
const ABBR = "NBA|ABA|MVP|ESPN|TNT|ABC|NBC|USA|FGM|FTM|FTA|FGA|PPG|RPG|APG|SPG|BPG|OT|ET|PT|II|III|IV|ECF|WCF|NCAA|LA|AT&T";
const CAPS_PAIR = new RegExp(`\\b(?!(?:${ABBR})\\b)[A-Z][A-Z’'&\\-]{2,}\\s+(?!(?:${ABBR})\\b)[A-Z][A-Z’'&\\-]{2,}\\b`);
const OBJECT_BEFORE = /\b(?:passed|passing|passes|surpass\w*|eclips\w*|tied|ties|tying|joined|joins|joining|behind|than|over|past|ahead of|trailing|with|and|after|by|of|from|vs\.?|against)\s+$/i;

export function readHistory(doc, players = [], { seasonStart = null, today = null, teamWords = [] } = {}) {
  // STRICT (11/12, after the user's review): a line is kept only if it says WHO (a player on the team as
  // the subject, or the team itself) and it is CURRENT (dated this season, says "this season", or looks
  // ahead). Unnamed lines, old facts (2016 draft, April 2026, a 2021 franchise table) and background
  // (draft trivia, college) are dropped, not just ranked lower.
  const plain = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const full = players.filter((p) => p.name).map((p) => {
    const n = plain(p.name);
    const last = n.split(" ").filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w)).pop();
    return { ...p, re: new RegExp(`\\b${esc(n)}\\b`, "i"), last };
  });
  const lastCount = {};
  for (const p of full) lastCount[p.last.toLowerCase()] = (lastCount[p.last.toLowerCase()] || 0) + 1;
  // The subject: the player's full name near the start (within 40 characters), or a sentence that opens
  // with his (unique) last name ("Mobley is...", "Jerome, who..."). A name later in the sentence is a
  // mention, not the subject ("...his teammates Matas Buzelis and Tyler Smith" is not about Tolu Smith).
  const subjectOf = (t) => {
    const x = plain(t);
    let best = null, at = 1e9;
    for (const p of full) {
      const m = p.re.exec(x);
      // "Passed Nikola Vučević...", "joining Allen Iverson": a name right after such a word is the object, not the subject.
      if (m && m.index <= 40 && m.index < at && !OBJECT_BEFORE.test(x.slice(0, m.index))) { best = p; at = m.index; }
    }
    if (best) return best;
    return full.find((p) => lastCount[p.last.toLowerCase()] === 1 && new RegExp(`^(?:The\\s+)?${esc(p.last)}(?:['’]s)?\\b`).test(x)) || null;
  };
  const teamRe = teamWords.length ? new RegExp(`^(?:The\\s+)?(?:${teamWords.map(esc).join("|")})\\b`) : null;
  const caps = (t) => plain(t).replace(/[^A-Za-z ]+/g, " ").replace(/\s+/g, " ");
  const pad = (n) => String(n).padStart(2, "0");
  const lastOnOrBefore = (mo, d) => {
    if (!today) return seasonStart; // no reference day: assume this season, as before
    const y = +today.slice(0, 4), iso = `${y}-${pad(mo)}-${pad(d)}`;
    return iso > today ? `${y - 1}-${pad(mo)}-${pad(d)}` : iso;
  };
  const undated = (t) => [
    ...[...t.matchAll(/(?<![\/\d])(\d{1,2})\/(\d{1,2})(?![\/\d])/g)].filter((m) => +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31).map((m) => lastOnOrBefore(+m[1], +m[2])),
    ...[...t.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*[-–]\s*\d{1,2},?\s*(?:19|20)\d\d)(?!,?\s*(?:19|20)\d\d)/g)].map((m) => lastOnOrBefore(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) / 3 + 1, +m[2])),
  ].filter(Boolean);
  const out = [], seen = new Set();
  for (const b of blocks(doc)) {
    let paraWho = null; // the player this paragraph is about, for its "He..." sentences
    for (let s of sentences(b.text).flatMap((x) => x.split(/\s*(?:…|\.{3}|[▪●•]|\s[o◦▫]\s(?=[A-Z]))\s*/)).map((x) => x.replace(/\s*\*{2,}.*$/, "").trim())) {
      if (s.length < 40 || s.length > 420) continue;
      // A capitals heading glued to the sentence ("ANTHONY DAVIS Logged..."): dropped; if it is a player's name, it is the subject.
      let headWho = null;
      const hm = s.match(/^((?:[\p{Lu}0-9’'&.\-\/]{2,}\s+){1,8}?[\p{Lu}0-9’'&.\-\/]{2,}):?\s+(?=\p{Lu}\p{Ll})/u);
      if (hm) {
        const h = caps(hm[1]).trim().toUpperCase();
        headWho = full.find((p) => { const n = caps(p.name).trim().toUpperCase().replace(/ (JR|SR|II|III|IV)$/, ""); return n.length > 4 && h.includes(n); }) || null;
        s = s.slice(hm[0].length);
        if (s.length < 40) continue;
      }
      // A capitals heading starting the next item mid-sentence: cut there.
      s = s.replace(/\s+(?:[\p{Lu}0-9\/’'&.\-]{2,}\s+)*[\p{Lu}0-9\/’'&.\-]{3,}:\s.*$/u, "").trim();
      if (s.length < 40) continue;
      // Splices and table fragments: stat-table labels with numbers, stat lines, runs of capitals,
      // a start that isn't a capitalised word, unbalanced brackets, a sentence that stops mid-thought.
      if (!/^[\p{Lu}"“]/u.test(s) || /^\d|^[A-Z][a-z]{2}\.? \d/.test(s)) continue;
      if (/\b(?:ASTS?|STLS?|REBS?|BLKS?|TREB|PTS|TOV)\s+\d|\d+[prab]-\d+[prab]\b|\s\*\s|\b\d+K (?:PTS|AST|REB)\b|(?:\b[A-Z0-9’'&]{2,}\b\s+){3,}|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+\d{1,3}\s/.test(s)) continue;
      // Two capitals words in a row that aren't common abbreviations: a table or heading spliced in ("his seventh MOST DOUBLE-DOUBLES double-double").
      if (CAPS_PAIR.test(s)) continue;
      const open = (s.match(/\(/g) || []).length, close = (s.match(/\)/g) || []).length;
      if (open !== close || !/[.!?)"”]$/.test(s) || /\b(?:to|the|a|of|and|at|in|with|as|by|for)\s*$/i.test(s) || (s.match(/\(\d{1,3}\)/g) || []).length >= 2) continue;
      if (/Notes\/Trends|Video Highlights|Season Stats|\bGP \d|PPG \d|\(cont\.?\)/i.test(s)) continue;
      if (s.replace(/[^0-9]/g, "").length / s.length > 0.22) continue;
      // Past tense isn't a look ahead ("was the first ... with 200 3PM within 60 games").
      const fwd = FORWARD.test(s) && !/^(?:\S+\s+){0,4}?(?:was|were|became|had)\b/.test(s), hist = HISTORY.test(s);
      if (!fwd && !hist) continue;
      if (NOT_NBA.test(s) || /\b(?:drafted|draft pick|overall pick|picked \w+(?: overall)?|NBA Draft|Draft Lottery|transferr|left the [A-Z]\w+|(?:with|for) the [A-Z][a-z]+ (?:from|in) (?:19|20)\d\d|All-(?:Big|ACC|SEC|Pac|American)|Ignite|Jayhawks|collegiate)\b/i.test(s)) continue; // background
      const key = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seen.has(key)) continue;
      seen.add(key);
      // WHO.
      // The sentence's own subject outranks the heading above it; a heading's player is not credited with a
      // sentence that opens with someone else's name ("TOLU SMITH Ron Holland became...").
      const own = subjectOf(s);
      const otherName = !own && headWho && /^\p{Lu}[\p{Ll}'’]+(?:\s+\p{Lu}[\p{Ll}'’.]+){1,2}(?:\s+(?:Jr\.?|Sr\.?|II|III|IV))?,?\s+\p{Ll}/u.test(s);
      if (otherName) continue;
      const subj = own || headWho;
      if (subj) paraWho = subj;
      const pronoun = /^(?:He|His|The \d{2}-year-old|The rookie|The (?:guard|forward|center|big man|veteran|sophomore))\b/.test(s);
      const who = subj || (pronoun ? paraWho : null);
      const team = !who && teamRe && teamRe.test(plain(s));
      if (!who && !team) continue;
      // WHEN. Dates in the sentence decide; "since 1973-74" and "since 2015" are comparisons, not when.
      const dates = [...s.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g)].map((m) => { const y = m[3].length === 2 ? (+m[3] > 50 ? 1900 : 2000) + +m[3] : +m[3]; /* "1/29/88" is 1988 */ return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; })
        .concat([...s.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2})?,?\s+((?:19|20)\d\d)\b/g)].map((m) => `${m[3]}-${String(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) / 3 + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`))
        .concat([...s.matchAll(/(\b(?:since|than|before|until|in NBA history since)\s+(?:the\s+)?(?:\w+\s+)?)?\b((?:19|20)\d\d)(?:-\d\d)?\b(?!\/)/g)].filter((m) => !m[1]).map((m) => `${m[2]}-${/-\d\d/.test(m[0]) ? "12-31" : "06-30"}`))
        .concat(undated(s)); // "on 11/9", "Nov. 4": the latest such date on or before today ("11/26" on 11/12 is last season's)
      const thisSeason = seasonStart ? dates.some((d) => d >= seasonStart) : false;
      // A real day this season ("10/21", "Nov. 6"), not just a season label like "2026-27" spliced in from a table.
      const dayThisSeason = seasonStart ? undated(s).concat([...s.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g)].map((m) => `${m[3].length === 2 ? 2000 + +m[3] : +m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`)).some((d) => d >= seasonStart) : false;
      const datedOld = dates.length && seasonStart && !thisSeason;
      if (datedOld) continue;
      const kind = fwd ? (PASSY.test(s) ? "pass" : "next") : "record";
      const current = thisSeason || CURRENT.test(s) || kind !== "record";
      if (!current || (OLDER.test(s) && !dayThisSeason)) continue;
      const score = (kind === "pass" ? 3 : kind === "next" ? 2.4 : 2) + (thisSeason || CURRENT.test(s) ? 1 : 0) + (/in NBA history|all-time|since 19\d\d|first (?:player|rookie|team)/i.test(s) ? 0.8 : 0);
      out.push({ page: b.page, text: s, kind, player: who?.name || null, playerId: who?.id || null, team: !!team, resolved: !subj && !!who, when: "season", score: Math.round(score * 100) / 100 });
    }
  }
  // The same forward fact printed twice ("needs 816 points to pass Kobe Bryant"): keep one.
  const fwdKey = (t) => { const m = t.match(/needs?\s+([\d,]+)\s+([a-z-]+(?:\s+[a-z-]+)?)\s+to\s+(?:pass|tie|surpass)\s+([A-Z][^.,]{2,40}?)(?=\s+for|[.,]|$)/i); return m ? m.slice(1).join('|').toLowerCase() : null; };
  const kept = new Set();
  return out.filter((x) => { const k = fwdKey(x.text); if (!k) return true; if (kept.has(k)) return false; kept.add(k); return true; });
}
