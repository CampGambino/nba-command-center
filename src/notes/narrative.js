import { checkLine, statClaims, thresholdClaims, meetsThresholds } from "./boxscore.js";
import { SEASON, SEASON_RE, SEASON_SHORT } from "../season.js";
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

const FORWARD = /\bneeds?\s+(?:just\s+|only\s+)?\d[\d,]*\b|\b\d[\d,]*\s+(?!(?:days?|weeks?|months?|years?)\b)(?:[\w-]+\s+){0,3}(?:shy|away)\s+(?:of|from)\b(?!\s+(?:the\s+)?(?:game|court|action|basketball|home))|\bwithin\s+\d[\d,]*\s+(?:points?|rebounds?|assists?|steals?|blocks?|games?|wins?|of)\b|\bwould\s+(?:become|pass|tie|join|move|surpass|reach)\b|\bis\s+(?:approaching|closing in on|nearing)\b|\bon pace (?:to|for)\b|\bcan (?:become|pass|tie|join|move up|reach)\b|\bwith (?:his|her|their) next\b|\b(?:just|only)\s+(?:[\w,-]+\s+){0,3}(?:shy|short|away)\s+(?:of|from)\b|\b\d[\d,]*\s+(?:[\w-]+\s+){0,3}short\s+(?:of|from)\b|\bfrom (?:tying|passing|surpassing|reaching|becoming)\b/i;

const SUBJECT = /^(\p{Lu}[\p{L}’'.\-]+(?:\s+\p{Lu}[\p{L}’'.\-]+){1,2})\s+is\s+/u;
const SEG_ROUND = /^(?:and\s+)?(\d[\d,]*)\s+([a-z0-9][a-z0-9\- ]*?)\s+(?:away\s+)?from\s+(\d[\d,]*)\s+((?:career|made)\s+)*([a-z0-9][a-z0-9\- ]*?)\s*[.,;]?$/i;
const SEG_PASS = /^(?:and\s+)?(\d[\d,]*)\s+([a-z0-9][a-z0-9\- ]*?)\s+away\s+from\s+(?:passing|tying)\s+(\p{Lu}[\p{L}.’'\- ]+?)\s+for\s+(.+?)\s+in\s+(franchise|NBA|team|club)\s+history\s*[.,;]?$/iu;

/** Text blocks: every bullet / sentence of every column, in reading order. */
export function blocks(doc) {
  const out = [];
  const cols = doc.pages.map((page) => columnsOf(page).map((col) => col.join("\n")));
  const vocab = wordCounts(cols.flat());
  for (const [pi, page] of doc.pages.entries()) {
    for (const col of cols[pi]) {
      const text = col
        .replace(/([\p{L}\d]+)-\n([\p{L}\d]+)/gu, (m, l, r) => (keepsHyphen(l, r, vocab) ? `${l}-${r}` : `${l}${r}`)) // a line ending in a hyphen
        .replace(/\s*\n\s*/g, " ")
        .replace(/\s+/g, " ");
      for (const bullet of cleanSidebar(text).split(/\s*[•▪●]\s*/)) {
        // A bullet is a full note even without a final stop ("Has started 97 consecutive regular season games").
        let t = bullet.trim();
        if (t.length >= 40 && /[\p{L}\d%)]$/u.test(t) && !/\b(?:to|the|a|an|of|and|at|in|with|as|by|for|or|his|their|from|on|was|were|who|that|is|are|which)$/i.test(t)) t += ".";
        if (t) out.push({ page: page.page, text: t });
      }
    }
  }
  return out;
}

/**
 * A line that ends in a hyphen: a word cut in two ("fran-" / "chise") or a compound that happens to break there
 * ("double-" / "double", "second-" / "longest", "1968-" / "69")? Across all 30 teams' notes (11/16) the compound is
 * the common case, and joining them all gave "doubledouble", "secondlongest" and "the 196869 season".
 *
 * The notes themselves decide: a number on either side keeps the hyphen; a joined form the notes use elsewhere
 * ("franchise") is a cut word; otherwise the hyphen stays when the notes print the hyphenated form elsewhere, or
 * when the first half is a word they use on its own ("second", "career").
 * vocab: wordCounts() of the same notes.
 */
export function keepsHyphen(left, right, vocab) {
  if (/\d/.test(left) || /\d/.test(right)) return true;
  const l = left.toLowerCase(), r = right.toLowerCase();
  if (vocab.get(l + r)) return false;
  if (vocab.get(`${l}-${r}`) || COMPOUND_FIRST.has(l)) return true;
  return (vocab.get(l) || 0) >= 2; // itself at the line end, and at least once more
}
// First halves of the compounds game notes are full of ("second-longest", "career-high", "all-time", "double-double").
const COMPOUND_FIRST = new Set("first second third fourth fifth sixth seventh eighth ninth tenth career season franchise team game single double triple all two three four five six high low league best most".split(" "));

/** How often each word, and each hyphenated compound, is printed in these texts. */
export function wordCounts(texts) {
  const n = new Map();
  const add = (w) => n.set(w, (n.get(w) || 0) + 1);
  for (const t of texts) for (const w of t.toLowerCase().match(/\p{L}+(?:-\p{L}+)*/gu) || []) {
    add(w);
    if (w.includes("-")) for (const part of w.split("-")) add(part);
  }
  return n;
}

/* A player box with a stats sidebar read into the prose (Houston's "Notes/Trends" boxes, 11/13): "…once prior this
   GP 12 PPG 20.9 RPG 6.1 APG 3.6 season; back to…". The sidebar's rows start with GP, GS or MPG and run on in
   label-value pairs; they are taken out, with the box's header ("20th season (2nd w/HOU) Notes/Trends [2026-27
   Video Highlights] 2026-27 Season Stats"), so the sentences read whole. */
const SIDEBAR_ROW = /\b(?:GP|GS|MPG)\s+\d[\d.]*(?:\s+(?:PPG|RPG|APG|SPG|BPG|TPG|FG%|3PT%|FT%|MPG|GS|GP)\s+\.?\d[\d.]*)+(?:\s+bla\b)?/g;
export function cleanSidebar(text) {
  return text
    .replace(SIDEBAR_ROW, " ")
    // Portland's player boxes: the season line's header and values read into the bullets ("GP/GS PPG RPG APG SPG BPG MPG", "11/2 8.3 3.5 2.0 0.5 0.3 23.1").
    .replace(/\bGP\/GS PPG RPG APG SPG BPG MPG\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\s+\d{1,2}\.\d){6}\b/g, " ")
    .replace(/\b\d{1,2}(?:st|nd|rd|th) season \(\d{1,2}(?:st|nd|rd|th) w\/[A-Z]{2,3}\)\s*/g, " ")
    .replace(/Notes\/Trends\s*\[[^\]]{0,60}\]\s*/g, " ")
    .replace(/\b(?:19|20)\d\d-\d\d Season Stats\b\s*/g, " ")
    .replace(/\s+/g, " ").trim();
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
/**
 * Does the sentence point back at something it doesn't say? "such instances", "such a game", "in the group",
 * "during the span": only when nothing before the reference in the same sentence names a number of a stat
 * ("…12 points, four rebounds… the first NBA reserve to tally such minimums" says its own).
 */
const BACK_REF = /\bsuch (?:an? )?(?:instances?|games?|performances?|outings?|contests?|feats?|minimums|totals|numbers|nights?|quarters?|hal(?:f|ves))\b|\bin (?:the|that) group\b|\b(?:during|over|in) th(?:e|at) span\b/i;
const OWN_FEAT = /(?:\d[\d,.]*|\b(?:one|two|three|four|five|six|seven|eight|nine|ten))\+?(?:-plus)?%?[\s-]*(?:or more\s+)?(?:points?|pts|rebounds?|reb|assists?|ast|steals?|stl|blocks?|blk|threes|3-pointers?|3fgm?|3pm|three-pointers?|turnovers?|minutes?|ppg|rpg|apg|fg%?|games?|wins?)\b|\b(?:double|triple)-doubles?\b/i;
// 0.78 (the user, 11/16): "He is only the second Wizard to do so in the opening game of the season since 1973-74" (do what?)
// and "He ranks eighth among all rookies in Wizards history over nine career games" (in what?).
const DO_SO = /\b(?:to do so|did so|done so|doing so|do(?:es)? so|(?:accomplish|achieve|reach|match)(?:ed|es)? (?:the|that|this) feat|to do it)\b/i;
const RANKS = /\b(?:ranks?|ranked|sits?|stands?|is|are|is tied for|tied for)\s+(?:tied for\s+)?(?:T-)?(?:\d{1,3}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|10th|tenth)\b(?!\s+(?:season|year|game|start|straight|consecutive|time|player|team|rookie|overall|pick|quarter|half)\b)/i;
const ANY_STAT = /\b(?:points?|pts|scor\w+|rebound\w*|reb|boards|assists?|ast|dimes|steals?|stl|blocks?|blk|threes|triples|3-?point\w*|three-point\w*|3fg\w*|3pm|3pt|field goals?|fg%?|free throws?|ft%?|ftm|fta|percent\w*|shooting|shots?|minutes|mpg|ppg|rpg|apg|spg|bpg|games (?:played|started)|wins|victories|losses|double-doubles?|triple-doubles?|turnovers?|deflections|charges|dunks|paint|bench|fast[- ]break|second[- ]chance|rating|efficiency|plus[-/]minus|margin|differential|pace|average\w*|streak|starts|made|makes|attempts|usage|true shooting|ts%)\b|%/i;
export function dangling(s) {
  const ds = s.match(DO_SO);
  if (ds) {
    const before = s.slice(0, ds.index);
    if (!OWN_FEAT.test(before) && !/\d/.test(before) && before.trim().split(/\s+/).length <= 12) return true;
  }
  const rk = s.match(RANKS);
  if (rk && !ANY_STAT.test(s) && /^(?:He|She|They|It)\b/.test(s)) return true;
  const m = s.match(BACK_REF);
  if (!m) return false;
  const before = s.slice(0, m.index);
  // "Since Chris Finch took over…, the third most in the NBA during that span" names its own span.
  if (/\bspan\b/i.test(m[0]) && /\bsince\b|\b(?:last|past|first|previous) (?:\w+ )?(?:games?|seasons?|years?|months?|weeks?)\b|\bfrom\b[^.]*\b(?:to|through)\b|\bstretch\b|\b(?:19|20)\d\d\b|\b\d{1,2}\/\d{1,2}\b/i.test(before)) return false;
  return !OWN_FEAT.test(before);
}

const FOOTER = /^(?:[@#]\w+\s+)?(?:PAGE\s+)?\d{1,3}$|^[@#]\w+$/i;
const STRAY_HEAD = /^(?:Date|Opponent|Result|Score)$/;
const SPACED_LABEL = /^(?:[\p{Lu}\d] ){2,}[\p{Lu}\d]$/u;
export function columnsOf(page) {
  const width = Math.ceil(page.width || 612);
  const cover = new Uint16Array(width + 1);
  // 0.77: the page's own footer (a bare page number, "@nuggets PAGE 5", "@BullsPR PAGE 16") was read as the end of the
  // last sentence above it ("…an NBA single-season record. 1."), and a table's header word printed inside a paragraph
  // ("…in three consecutive / Date / games…") as part of it.
  // 0.157.0: the second line of a bio header ("G • 6-4 • 186 • NBA G League Ignite/USA • 6th" / "Season") printed beside a
  // paragraph landed inside its sentence: "(Nov. 2 and Nov. Season 4)" (Phoenix, 11/25; on 11/16 the same word was at
  // the sentence's end). A line that is only "Season", under a line ending in "• 6th", is that header's.
  const bioSeason = (l, i) => /^Seasons?$/.test(l.text.trim()) && page.lines.slice(Math.max(0, i - 3), i).some((u) => u.cells.some((c) => /•\s*\d{1,2}(?:st|nd|rd|th)\s*$/.test(c.text)));
  const lines = page.lines.filter((l, i) => !STRAY_HEAD.test(l.text.trim()) && !bioSeason(l, i))
    .map((l) => (l.y < 45 && l.cells.some((c) => FOOTER.test(c.text.trim())) ? { ...l, cells: l.cells.filter((c) => !FOOTER.test(c.text.trim())) } : l))
    // 0.158.0: a chart's letter-spaced label on the same line as a sentence ("…each on 11/22).   3 F G M", Chicago 11/25)
    // was read into it: "…on 11/22). 3 F G M Jordan Hawkins scored…". A heading alone on its line is left for the topic reader.
    .map((l) => (l.cells.length > 1 && l.cells.some((c) => SPACED_LABEL.test(c.text.trim())) ? { ...l, cells: l.cells.filter((c) => !SPACED_LABEL.test(c.text.trim())) } : l))
    .filter((l) => l.cells.length);
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
      perCol[Math.max(0, i)].push(c);
    }
    perCol.forEach((parts, i) => { if (parts.length) { parts.y = l.y; cols[i].push(parts); } });
  }
  return cols.filter((c) => c.length).map(sideBySide);
}

const SIDE_GUTTER = 6, SIDE_ROWS = 3, SIDE_CHARS = 20;
/**
 * Two lists of sentences printed side by side on part of a page (Dallas p.5, 11/15: "UPCOMING MILESTONES" beside
 * "RECENT MILESTONES"). The page's own gutters miss them when full-width text above covers the gap, and reading
 * straight across then splices the two ("…and 2,000 points as a Naji Marshall (494) needs 6 more assists as a
 * Dallas Maverick for 500 career assists Maverick (2,010), moving into 47th place…").
 *
 * rows: one column's rows, each a list of cells. A run of 3+ rows that all leave the same strip empty, with
 * sentences (not table cells) on both sides of it in at least 3 of them, is read left side first, then right.
 * Tables keep reading across: their cells are short or numeric, and the lists read from them depend on it.
 * -> the column's lines as text
 */
export function sideBySide(rows) {
  const text = (cells) => cells.map((c) => c.text).join(" ");
  const out = [];
  let i = 0;
  while (i < rows.length) {
    let best = null;
    const r0 = [...rows[i]].sort((a, b) => a.x0 - b.x0);
    for (let k = 0; k + 1 < r0.length; k++) {
      let lo = r0[k].x1, hi = r0[k + 1].x0;
      if (hi - lo < SIDE_GUTTER) continue;
      let j = i, both = 0;
      const L = [], R = [], steps = [];
      for (; j < rows.length; j++) {
        // A wider space than the rows above have between them is the end of the lists (the page footer, the next box).
        if (j > i && rows[j].y != null && rows[j - 1].y != null) {
          const step = Math.abs(rows[j - 1].y - rows[j].y);
          const usual = steps.length ? [...steps].sort((p, q) => p - q)[steps.length >> 1] : null;
          if (usual && step > usual * 2.2) break;
          steps.push(step);
        }
        let a = lo, z = hi, cut = false;
        for (const c of rows[j]) {
          if (c.x1 <= a || c.x0 >= z) continue;          // clear of the strip
          if (c.x0 < a && c.x1 > z) { cut = true; break; } // runs across it
          if (c.cx < (a + z) / 2) a = Math.max(a, c.x1); else z = Math.min(z, c.x0);
        }
        if (cut || z - a < SIDE_GUTTER) break;
        lo = a; hi = z;
        const left = rows[j].filter((c) => c.x1 <= lo), right = rows[j].filter((c) => c.x0 >= hi);
        if (left.length && right.length) both++;
        L.push(left); R.push(right);
      }
      if (j - i < SIDE_ROWS || both < SIDE_ROWS) continue;
      // Sentences on both sides: long cells with words in them, few bare numbers.
      const pairs = L.map((l, n) => [text(l), text(R[n])]).filter(([l, r]) => l && r);
      const prose = (t) => t.length >= SIDE_CHARS && /[a-z]{3,}\s+[a-z]{2,}/.test(t) && !/^[\d.,%\s()\-–/]+$/.test(t);
      const ok = pairs.filter(([l, r]) => prose(l) && prose(r)).length;
      if (ok < SIDE_ROWS || ok < pairs.length * 0.6) continue;
      if (!best || j - i > best.j - i) best = { j, L, R };
    }
    if (!best) { out.push(text(rows[i])); i++; continue; }
    for (const side of [best.L, best.R]) for (const cells of side) if (cells.length) out.push(text(cells));
    i = best.j;
  }
  return out;
}

const ORD = (n) => { const v = n % 100; return n + (v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"); };
/**
 * Layout repairs before a sentence is judged (0.65):
 *   a game-log row spliced in ("…the highest11/2 at NYK L 21:51 1-5 0-0 2-2 3 3 6 … offensive rebound percentage…",
 *   "Joins 10/30 vs. Pistons 94-110 L 0-5 11/1 @ Pacers 98-90 W 1-5 Luka Dončić…") is cut out;
 *   superscript suffixes printed apart ("3.5 th th triples", "th the 9 -best mark") go back on their number;
 *   the page footer ("2026-27 Game Notes.") is dropped.
 */
export function repairLayout(s) {
  let t = s.replace(/\s*\d{1,2}\/\d{1,2}\s+(?:at|vs\.?|@)\s+\p{Lu}[\p{L}.]*(?:\s+\p{Lu}[\p{L}.]*)?\s+(?:\d{2,3}-\d{2,3}\s+)?[WL](?:\s+\d{2,3}-\d{2,3})?(?:\s+\d{1,2}:\d{2})?(?:\s+\d{1,3}(?:-\d{1,3})?)+(?=\s|[.,;]|$)/gu, " ");
  t = t.replace(/\s*\b(?:19|20)\d\d-\d\d Game Notes\.?/g, "");
  t = t.replace(/\b(\d{1,2})-\s+of-(\d{1,2})\b/g, "$1-of-$2"); // "shooting 6- of-26" (Houston, 11/15)
  // 0.107.1 (the user's image, 11/18): a table's header word printed inside a sentence and stuck to the word before it
  // ("he's gone 100% fromDate the free-throw line", Denver). 0.77 drops such a word when it stands alone on a line.
  t = t.replace(/(\p{Ll})(?:Date|Opponent|Result|Score)(?=\s+\p{Ll})/gu, "$1");
  t = t.replace(/^(?:\p{Lu} ){3,}\p{Lu}(?:\s*[\/&]\s*(?:\p{Lu} ){2,}\p{Lu})*\s+(?=\p{Lu}\p{Ll})/u, ""); // a letter-spaced heading before the sentence ("S T E A L S / B L O C K S With five assists…", Chicago; 0.78)
  t = t.replace(/(\))\s+20\d\d-\d\d\.?$/, "$1."); // the next header's season after the last bullet ("…(70 on 3/24/17) 2026-27.", Phoenix)
  // 0.71: a letter-spaced footer ("2 0 2 6 - 2 7 D A L L A S M A V E R I C K S G A M E N O T E S."), and a page number
  // with the PR accounts ("17 Find us on X: @spurs | Facebook: http://…").
  t = t.replace(/(?:\s|^)(?:[\p{Lu}0-9\-&](?:\s+|(?=\.?\s*$))){8,}\.?/gu, " ");
  t = t.replace(/\s*(?:\b\d{1,3}\s+)?(?:Find|Follow) us on\b.*$/i, "");
  // A date from the next table cell after a closing bracket ("(vs. BOS, 11/11/26) 12/22/24 and joins…", 0.69).
  t = t.replace(/\)\s+\d{1,2}\/\d{1,2}\/\d{2,4}(?=\s+[a-z])/g, ")");
  let stray = 0;
  t = t.replace(/(^|\s)(?:st|nd|rd|th)(?=\s|$)/g, (m, a) => { stray++; return a; });
  if (stray) {
    t = t.replace(/\b(T-)?(\d{1,3})\s?-(best|most|highest|lowest|fewest|longest|largest|worst|ranked)\b/g, (m, tie, n, w) => `${tie || ""}${ORD(+n)}-${w}`)
      .replace(/\b(T-)?(\d{1,3})(?= (?:in|among) (?:the )?(?:NBA|league|East|West|Eastern|Western)\b)/g, (m, tie, n) => `${tie || ""}${ORD(+n)}`);
  }
  return t.replace(/\s{2,}/g, " ").replace(/\s+([.,;])(?!\d)/g, "$1").trim();
}

/**
 * Two bullets run together because the first has no full stop (Detroit, 11/17: "Cade Cunningham made all 14 of his free
 * throws, the most he has made without a miss in his career Duncan Robinson knocked down two three-point field goals…").
 * A sentence that opens with one player's full name is cut where a different player's full name starts a new clause:
 * after a plain word (no comma, no "and", "by", "with", "teammate"…) and before a verb.
 */
const JOINS = /\b(?:and|or|but|by|with|of|from|to|for|as|like|than|over|past|after|before|behind|since|until|while|when|where|that|which|who|whom|vs\.?|versus|against|teammates?|guards?|forwards?|centers?|rookies?|veterans?|coach|joined|joining|passed|passing|tied|tying|surpass\w*|trailing|ahead of|alongside|between|include[sd]?|including)\s*$/i;
export function splitBullets(s, full = []) {
  const first = full.find((p) => p.re.test(s.slice(0, 45)));
  if (!first || s.length < 90) return [s];
  for (const p of full) {
    if (p === first) continue;
    const m = p.re.exec(s.slice(40));
    if (!m) continue;
    const at = 40 + m.index, before = s.slice(0, at), after = s.slice(at + m[0].length);
    if (!/[a-z0-9%)]\s$/.test(before) || JOINS.test(before) || !/^\s+[a-z]{3,}(?:ed|s)?\b/.test(after) || /^\s+(?:and|or|as|to|in|for|with|who|whose)\b/.test(after)) continue;
    return [`${before.trim()}.`, ...splitBullets(s.slice(at), full)];
  }
  return [s];
}

function sentences(text) {
  // Split after . ! ? or "…" followed by a capital, but not after initials or
  // common abbreviations (Jr., No., vs., Oct., St.).
  const parts = [];
  let last = 0;
  const re = /([.!?…])\s+(?=["“(]?[A-Z])/g;
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, m.index - 4), m.index + 1);
    if (/\b(?:[A-Z]|Jr|Sr|No|vs|St|Mt|Dr|Jan|Feb|Mar|Apr|Aug|Sept?|Oct|Nov|Dec|Def|Off|Pct|Reb|Opp)\.$/.test(before)) continue;
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
// 0.82 (the Warriors' notes): history said another way ("the second time in the play-by-play era", "the fifth time in
// his career", "according to the Elias Sports Bureau"). Used only when a sentence has no league-context or trend
// signal of its own, so a line already read as one of those keeps its kind (and its test for being current).
// 0.94: a personal best said in full ("the most he has made without a miss in his career"), which stood only because the
// next bullet had run into it.
const HISTORY_ALSO = /\b(?:first|only|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)) time (?:in|since|ever)\b|\bplay-by-play era\b|\bElias Sports Bureau\b|\bthe (?:most|fewest|longest|highest|best|lowest) (?:[\w'’-]+ ){0,9}(?:in|of) (?:his|her|their) (?:NBA )?career\b/i;
const HISTORY = /\b(?:in (?:NBA|league|franchise|team|club|[A-Z][a-z]+) history|all-time|(?:first|only|second|third|fourth|fifth|\d+(?:st|nd|rd|th)) (?:player|rookie|team|teenager|guard|center|forward|duo|trio|pair|teammates?|players|teams|coach|starter|reserve|\w+ to)\b|since (?:the )?(?:19|20)\d\d|(?:most|fewest|longest|highest|lowest|best|worst|largest|biggest|smallest)\b[^.]{0,60}\b(?:since|ever|in (?:NBA|franchise|team|league|club) history|by any|of any)|youngest|oldest|fastest|quickest|(?:NBA|franchise|team|league|club|single-game|season|career|rookie|all-time)[- ]records?\b|record for (?:the )?most)/i;
// League context (0.48, from the user's picks in the Wizards' 11/12 notes): ranks in the league this season, exclusive
// clubs, active streaks, races on a list, and the series with tonight's opponent. Not history, but what the user flags.
const CONTEXT = /\bamong(?:st)? (?:all )?(?:NBA|league|qualified)\b|\b(?:leads?|led|leading)\s+(?:all\s+|the\s+)?(?:NBA|league)\b|\blead(?:s|ing)? the (?:NBA|league)\b|\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+in (?:the )?(?:NBA|league)\b|\b(?:(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))[- ])?(?:most|highest|lowest|fewest|least|best|longest)\b[^.;]{0,90}?\b(?:in the (?:NBA|league)|of any (?:team|player)|by any (?:team|player)|league-wide|among (?:all )?(?:NBA|qualified|active))|\bone of the top\b[^.;]{0,40}\bin the (?:NBA|league)\b|\bone of (?:two|three|four|five|six|seven|eight|nine|ten|\d+) (?:players|teams|guards|forwards|centers|rookies|duos|trios)\b|\b(?:the )?only (?:[\w-]+ )?(?:player|team|rookie|duo|trio)s? in the (?:NBA|league)\b|\bas the only\b|\b\d{2,} (?:consecutive|straight) (?:[\w-]+ ){0,2}(?:games|starts|contests)\b|\b(?:longest|current) active\b|\bactive streak\b|\bonly\b[^.;]{0,80}\bmore\b[^.;]{0,60}\bthan\b|\bsecond only to\b|\bbehind only\b|\bowns the most\b|\bseason series\b|\bseries (?:history|between)\b|\bthis season['’]s series\b|\b(?:last|past) (?:\w+ )?meetings\b/i;
// Trends (11/13, from the user's picks in the Rockets' and Blazers' notes: "interesting tidbits… that didn't appear"):
// records when something happens ("Rockets are 30-12 when he has 5+ assists", "3-0 when having 15+ 3FGM"), stretches
// ("in each of the past 2 games", "4 straight games", "over the past 5 games after averaging…"), career highs over a span,
// league ranks written without "the" ("Ranks 10th in NBA in 3FG%"), percentiles, "since entering the starting lineup".
// Not schedule stretches ("will play 20 of 32 games on the road"): those say nothing about tonight.
const TREND = /\b\d{1,3}-\d{1,3} when\b|\bwhen (?:he|they|having|scoring|holding|shooting|outrebounding)\b[^.;…]{0,50}\b\d{1,3}-\d{1,3}\b|\b(?:in|over) (?:each of )?(?:the |his |their )?(?:past|last|first) \d{1,2} (?:games|GP|contests|starts)\b|\b\d{1,3} (?:straight|consecutive) (?:\w+ ){0,2}(?:games|GP|contests|starts)\b|\bcareer[- ]high\b|\bpercentile\b|\branks? (?:t-)?\w+ (?:in|among) (?:the )?(?:NBA|league)\b|\bsince (?:entering|joining|moving into|returning to) (?:the |his )?starting lineup\b|\bmost such\b|\bthrough (?:the season['’]s )?first \d+ games\b|\brank(?:s|ing)? (?:highly|top \d+)\b|\b(?:tied for )?(?:\w+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)[- ](?:most|fewest|highest|lowest|best)\b[^.;…]{0,40}\bin (?:the )?(?:NBA|league)\b/i;
const SCHEDULE = /\bwill play\b|\b(?:homestand|road trip) (?:post|after|before)\b|\bthrough (?:the )?All-Star break\b|\bof (?:their|its|our) (?:first|final|last|next) \d+ games at\b/i;
const SERIES = /\bseason series\b|\bseries (?:history|between)\b|\bthis season['’]s series\b|\b(?:last|past) (?:\w+ )?meetings\b|\bmeetings? (?:with|against|between)\b|\bhead-to-head\b/i;
// "Since entering the league in 2012-13, Davis owns…": a timeframe, not when it happened, and not background.
const SINCE_CLAUSE = /^Since (?:entering|joining|being drafted|he (?:joined|entered|arrived)|his (?:arrival|debut|rookie))[^,]{0,140},\s*/i;
const PASSY = /\b(?:pass|passing|tie|tying|surpass|move (?:up|into|past)|jump)\b/i;
const NOT_NBA = /\b(?:program record|against No\. \d+|high school|school history|program(?:'s)? (?:history|all-time)|NCAA|college|freshman|sophomore|junior|senior year|AAU|conference tournament|EuroLeague|Olympic|FIBA|national team|G League|summer league|preseason)\b/i;
const CURRENT = new RegExp(String.raw`\b(?:active streak|longest active|this season|this year|${SEASON_RE}|${SEASON_SHORT}|tonight|last game|last night|his last|over (?:his|the) (?:past|last) \d+|in (?:each of )?the first \d+ games|through \d+ games|to (?:begin|start|open) (?:the|his|their) (?:season|campaign|year)|for the \w+ (?:straight|consecutive) game|season opener|today|so far|is now|currently|this campaign|in (?:his|their) (?:\w+ )?debut with|(?:has|have) (?:now )?(?:recorded|scored|made|posted|had|tallied|grabbed|dished|hit|logged|notched) [^.]{0,60}\b(?:straight|consecutive) games)\b|\b(?:Oct|Nov|Dec)\.? \d{1,2}\b|\b1[0-2]\/\d{1,2}\b`, "i");   // 0.141.6: the season from src/season.js
// 0.141.6: seasons before this one (src/season.js), not a typed "2025-26" that next season would read as current.
const PAST_YEARS = Array.from({ length: Number(SEASON.slice(0, 4)) - 2000 }, (_, i) => String(i).padStart(2, "0")).join("|");
const OLDER = new RegExp(String.raw`\b(?:last season|in 20(?:${PAST_YEARS})-\d\d|20(?:${PAST_YEARS})-\d\d:|during (?:the )?20(?:${PAST_YEARS})|previous (?:season|\d+ seasons)|career-long|as a rookie in)\b`, "i");

const TABLEY = /\b(?:ASTS?|STLS?|REBS?|BLKS?|TREB|PTS|TOV)\s+\d|\d+[prab]-\d+[prab]\b|\s\*\s|\b\d+K (?:PTS|AST|REB)\b|(?:\b[A-Z0-9’'&]{2,}\b\s+){3,}|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+\d{1,3}\s|\b[A-Z]{2,3}\s+\d{1,3}\s+\d{1,2}\/\d{1,2}\b/;
const MONTHS = "janfebmaraprmayjunjulaugsepoctnovdec";
const ABBR = "NBA|ABA|MVP|ESPN|TNT|ABC|NBC|USA|FGM|FTM|FTA|FGA|PPG|RPG|APG|SPG|BPG|OT|ET|PT|II|III|IV|ECF|WCF|NCAA|LA|AT&T";
const CAPS_PAIR = new RegExp(`\\b(?!(?:${ABBR})\\b)[A-Z][A-Z’'&\\-]{2,}\\s+(?!(?:${ABBR})\\b)[A-Z][A-Z’'&\\-]{2,}\\b`);
const OBJECT_BEFORE = /\b(?:passed|passing|passes|surpass\w*|eclips\w*|tied|ties|tying|joined|joins|joining|behind|than|over|past|ahead of|trailing|with|and|after|by|of|from|vs\.?|against)\s+$/i;

/* A feature box's lead sentence and its table ("…in several categories: Category Value NBA Rank Total Bench Points 147 pts
   4th Points Per 36 Minutes (min. 250 MP) 18.4 4th…"; Portland, 11/13): the lead, then the table's rows in a line
   ("Total Bench Points 147 pts (4th); Points Per 36 Minutes 18.4 (4th)…"). Three layouts: value and rank; this season
   against last ("Offensive Rating 113.1 (21st) 118.5 (4th)"); a ranked list (only our own team's rows). */
export function summarizeTable(s, teamTris = []) {
  const at = s.search(/:\s+(?:Category|Offensive Category|Defensive Category|Rank Player|[A-Z][a-z]+ [A-Z][a-z]+ Value)\b/);
  if (at < 40) return null;
  const intro = s.slice(0, at).trim();
  let body = s.slice(at + 1).replace(/\s+(?:[\p{Lu}0-9’'&,\-]{2,}\s+){1,}[\p{Lu}0-9’'&,\-]{2,}\.?\s*$/u, "").replace(/\s+PAGE \d+\.?\s*$/, "");
  body = body.replace(/\((?:min\.|minimum)[^)]*\)\s*/g, "")
    .replace(/(?:^|\s)(?:Offensive |Defensive )?Category\s+(?:Value\s+NBA\s+(?:Bench\s+)?Rank|(?:19|20)\d\d-\d\d \(rank\)\s+(?:19|20)\d\d-\d\d \(rank\))\s*/g, " ")
    .replace(/(\p{Lu}[\p{L}.’'\-]+ \p{Lu}[\p{L}.’'\-]+) Value NBA (?:Bench )?Rank\s*/gu, "$1: ");
  const rows = [];
  // This season against last: "Label v1 (r1) v2 (r2)".
  for (const m of body.matchAll(/([A-Z][A-Za-z.&’' -]{3,40}?)\s+(-?[\d.]+%?(?: [A-Za-z%]{2,4})?)\s+\(((?:t-)?\d{1,2}(?:st|nd|rd|th))\)\s+(-?[\d.]+%?(?: [A-Za-z%]{2,4})?)\s+\(((?:t-)?\d{1,2}(?:st|nd|rd|th))\)/g))
    if (!/rank|Category/i.test(m[1])) rows.push(`${m[1].trim()} ${m[4]} (${m[5]}), from ${m[2]} (${m[3]})`);
  // Value and rank: "Label value rank".
  if (!rows.length) for (const m of body.matchAll(/([A-Z][A-Za-z0-9.&’'\/ -]{3,45}?)\s+((?:\.\d+|\d+(?:\.\d+)?)%?(?: ?[A-Za-z]{2,4})?)\s+((?:t-)?\d{1,2}(?:st|nd|rd|th))\b/g))
    if (!/^(?:Value|Rank|Category|NBA)\b/.test(m[1].trim())) rows.push(`${m[1].replace(/^(?:Value NBA (?:Bench )?Rank|Category Value NBA (?:Bench )?Rank)\s*/, "").trim()} ${m[2]} (${m[3]})`);
  // A ranked list: our own team's rows.
  if (!rows.length && teamTris.length) for (const m of body.matchAll(/\b(\d{1,2})\s+(\p{Lu}[\p{L}.’'\-]+(?:\s+\p{Lu}[\p{L}.’'\-]+){1,2})\s+([A-Z]{3})\s+(\.?\d[\d.]*)/gu))
    if (teamTris.includes(m[3])) rows.push(`${m[2]} ${m[4]} (${m[1]})`);
  // A table we can't read: the lead sentence alone ("…the most such games by a forward in team history").
  if (!rows.length) return /[\p{L}\d)]$/u.test(intro) ? `${intro}.` : null;
  return `${intro}: ${rows.slice(0, 6).join("; ")}.`;
}

// Words that make a count a career's or a franchise's, not a season's.
// A run ("active streak … at 174 games", "since the start of last season") can span seasons and still be current.
const NOT_SEASON = /\b(?:career|franchises?|all-time|history|records?|since (?:19|20)\d\d|since the start of|(?:his|their|its) (?:\w+ )?(?:NBA )?seasons\b|seasons? (?:with|in|for) the\b|playoffs?|postseason|all-star|streaks?|consecutive|straight|fastest|quickest|needed|min\.|minimum|winning percentage)\b|\bNBA-record\b/i;
/** True when a sentence counts more games (or a bigger season total) than `gp`, the team's games so far, allows. */
export function tooBigForSeason(s, gp) {
  if (!gp || NOT_SEASON.test(s)) return false;
  // "his 43rd double-double", "21 games with 20+ turnovers", "his 30th win": not after "last/past/first …" (a stretch
  // that can run back into last season) and not "N straight/consecutive games" (a run can too).
  for (const m of s.matchAll(/(\b(?:last|past|previous|prior|first|final|recent|over|of)\s+)?(?<![\d,\-–])\b(\d{1,4})(?:st|nd|rd|th)?\s+(?:double-doubles?|triple-doubles?|games?|starts?|wins?|victories|contests|outings|appearances)\b/gi)) {
    if (m[1]) continue;
    if (+m[2] > gp + 2) return true;
  }
  // "1,013 points this season": more than 45 a game (points), 20 (rebounds) or 15 (assists).
  if (/\b(?:this season|so far this season|on the season|this year)\b/i.test(s))
    for (const m of s.matchAll(/\b(\d{1,2},\d{3}|\d{3,4})\s+(points|rebounds|assists)\b/gi)) {
      const n = +m[1].replace(/,/g, ""), per = { points: 45, rebounds: 20, assists: 15 }[m[2].toLowerCase()];
      if (n > per * gp) return true;
    }
  return false;
}

export function readHistory(doc, players = [], { seasonStart = null, today = null, teamWords = [], oppWords = [], box = null, dropped = null, tris = [] } = {}) {
  const drop = (reason, text) => { if (dropped) dropped.push({ reason, text }); };
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
  // A capitalized word before a last name that is not a first name: a sentence opener, a role, a day or a month.
  const NOT_A_NAME = /^(?:Through|Since|After|Before|With|Without|Against|On|In|At|For|From|By|As|When|While|Tonight|Last|This|That|The|And|But|Also|Rookie|Guard|Forward|Center|Veteran|Sophomore|Captain|Coach|All-Star|Teammate|Teammates|Starter|Reserve|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Jan|Feb|Mar|Apr|May|Oct|Nov|Dec|January|February|March|April|October|November|December)\.?$/;
  const subjectOf = (t) => {
    const x = plain(t);
    let best = null, at = 1e9;
    for (const p of full) {
      const m = p.re.exec(x);
      // "Passed Nikola Vučević...", "joining Allen Iverson": a name right after such a word is the object, not the subject.
      if (m && m.index <= 40 && m.index < at && !OBJECT_BEFORE.test(x.slice(0, m.index))) { best = p; at = m.index; }
    }
    if (best) return best;
    const lead = full.find((p) => lastCount[p.last.toLowerCase()] === 1 && new RegExp(`^(?:The\\s+)?${esc(p.last)}(?:['’]s)?\\b`).test(x));
    if (lead) return lead;
    // "Through Nov. 8, Kessler led…": a unique last name early in the sentence, not as an object.
    let near = null; at = 1e9;
    for (const p of full) {
      if (lastCount[p.last.toLowerCase()] !== 1 || p.last.length < 4) continue;
      const m = new RegExp(`(?<![\\p{L}])${esc(p.last)}(?:['’]s)?(?![\\p{L}])`, "u").exec(x);
      // The words before it, less a first name ("Passed Kevin Durant": "Passed" makes Durant the object).
      const pre = m ? x.slice(0, m.index).replace(/\p{Lu}[\p{L}'’.\-]*\s+$/u, "") : "";
      // 0.86 (the user, 11/17: "the wires got crossed because of the last names"): "Sion James is 37 steals away…" in the
      // Lakers' notes went to Bronny James, the only James on the roster. A different first name right before the last
      // name is another person. A short form of his own first name still counts ("Herb Jones" for Herbert Jones).
      const before = m ? (x.slice(0, m.index).match(/(\p{Lu}[\p{L}'’.\-]*)\s+$/u) || [])[1] : null;
      const first = plain(p.name).split(" ")[0];
      const otherFirst = before && !NOT_A_NAME.test(before) && before.replace(/\./g, "").slice(0, 3).toLowerCase() !== first.replace(/\./g, "").slice(0, 3).toLowerCase()
        && before.replace(/\./g, "").toLowerCase() !== plain(p.name).split(" ").slice(0, -1).map((w) => w[0]).join("").toLowerCase();
      if (m && m.index <= 30 && m.index < at && !otherFirst && !OBJECT_BEFORE.test(pre) && !OBJECT_BEFORE.test(x.slice(0, m.index)) && !/\b(?:and|&|with)\s+$/.test(pre)) { near = p; at = m.index; }
    }
    return near;
  };
  const teamRe = teamWords.length ? new RegExp(`^(?:The\\s+)?(?:${teamWords.map(esc).join("|")})\\b`) : null;
  // The team as the subject later in the sentence ("Despite…, the Wizards have been blocked the least…", "Per Sportradar,
  // Washington joins…", "16.2% of the Wizards' field goals"), but not as an object ("vs. Washington", "beat the Wizards").
  const teamMid = teamWords.length ? new RegExp(`(?<!\\b(?:vs\\.?|against|at|over|to|beat|beating|from|host|hosts|visit|visits)\\s+(?:the\\s+)?)\\b(?:${teamWords.map(esc).join("|")})(?:(?:['’]s?)\\s|\\s+(?:currently\\s+|also\\s+|now\\s+)?(?:have|has|had|is|are|joins|join|lead|leads|rank|ranks|own|owns|became|sit|sits)\\b)`) : null;
  const oppRe = oppWords.length ? new RegExp(`\\b(?:${oppWords.map(esc).join("|")})\\b`) : null;
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
  const datesOf = (s) => [...s.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g)].map((m) => { const y = m[3].length === 2 ? (+m[3] > 50 ? 1900 : 2000) + +m[3] : +m[3]; /* "1/29/88" is 1988 */ return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; })
        .concat([...s.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2})?,?\s+((?:19|20)\d\d)\b/g)].map((m) => `${m[3]}-${String(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) / 3 + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`))
        .concat([...s.matchAll(/(\b(?:since|than|before|until|in NBA history since)\s+(?:the\s+)?(?:\w+\s+)?)?\b((?:19|20)\d\d)(?:-\d\d)?\b(?!\/)/g)].filter((m) => !m[1]).map((m) => `${m[2]}-${/-\d\d/.test(m[0]) ? "12-31" : "06-30"}`))
    .concat(undated(s)); // "on 11/9", "Nov. 4": the latest such date on or before today ("11/26" on 11/12 is last season's)
  const byId = Object.fromEntries(full.map((p) => [String(p.id), p]));
  const out = [], seen = new Set();
  let sectionWho = null, sectionPage = null; // the player whose part of the page this is: the last one named on it
  // A player's heading and his bullets can be separate blocks ("KYSHAWN GEORGE • Was selected… • Leads all… • Is one of
  // five…"): the paragraph's player carries to the next block on the page, within the same distance as inside one (0.48).
  let carry = null;
  let prevBlock = null, thisBlock = null;
  let carrySeason = null;
  for (const b of blocks(doc)) {
    prevBlock = thisBlock; thisBlock = b;
    if (b.page !== sectionPage) { sectionWho = null; sectionPage = b.page; }
    // Player-bio headers ("# 7 GIANNIS ANTETOKOUNMPO FORWARD…", "#5 Paolo Banchero (F, 6-10…"): everything after one,
    // up to the next, is about that player, however far down the page it runs.
    const bios = [];
    for (const m of plain(b.text).matchAll(/#\s?\d{1,2}\s+([A-Za-z][A-Za-z'’.\-]+(?:\s+[A-Za-z][A-Za-z'’.\-]+){1,3})/g)) {
      const words = m[1].toUpperCase();
      const p = full.find((q) => { const n = caps(q.name).trim().toUpperCase().replace(/ (JR|SR|II|III|IV)$/, ""); return n.length > 4 && caps(words).toUpperCase().startsWith(n); });
      if (p) bios.push({ at: m.index, p });
    }
    const blockBio = bios.length ? bios[bios.length - 1].p : null; // the last player header in this block
    let cursor = 0, bioWho = null;
    // 0.142.5 (the user, 11/23: Detroit's "LAST MEETING — HAWKS 130, PISTONS 129 – MARCH 25, 2026" box, whose Key Notes
    // gave "Jalen Johnson continued his breakout season with his 43rd double-double" as this season's): a last-meeting box
    // dated before this season is last season's game; everything in it, to the next box or the end of the block, is too.
    const oldMeet = [];
    if (seasonStart) for (const m of b.text.matchAll(/\b(?:LAST|PREVIOUS|PRIOR|MOST RECENT) MEETING\b|\b(?:Last|Previous|Prior|Most Recent) Meeting\b(?=\s*[:\-–—]?\s*[\p{Lu}0-9])/gu)) {
      const head = b.text.slice(m.index, m.index + 260);
      const dm = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{1,2}),?\s+((?:19|20)\d\d)\b/i.exec(head), sm = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(head);
      const d = dm ? `${dm[3]}-${String(MONTHS.indexOf(dm[1].toLowerCase()) / 3 + 1).padStart(2, "0")}-${dm[2].padStart(2, "0")}`
        : sm ? `${sm[3].length === 2 ? 2000 + +sm[3] : +sm[3]}-${sm[1].padStart(2, "0")}-${sm[2].padStart(2, "0")}` : null;
      if (!d || d >= seasonStart) continue;
      // It ends at the next box ("RECENT GAMES", "CONNECTIONS:", …) or the end of the block.
      const rest = b.text.slice(m.index + 20), next = rest.search(/\b(?:RECENT GAMES|SEASON SERIES|LAST MEETING|PREVIOUS MEETING|SERIES NOTES|PLAYER NOTES|TEAM NOTES)\b|\b(?!DNP\b)[A-Z]{4,}(?: [A-Z]{2,}){0,2}:/);
      oldMeet.push({ at: m.index, end: next >= 0 ? m.index + 20 + next : Infinity, d });
    }
    // A bio's season headers ("2023-24 (Minnesota): …", "2024-25 (Phoenix) – …"): what follows, up to the next one, is
    // that season, whatever it says ("made a total of 169 threes this season" was 2023-24; the user, 11/15).
    // 0.77: the header also covers the bullets under it when each bullet is its own block (Cleveland: "2025-26 Notes:
    // Appeared in 70 games…" and then a page of last season's games; the user, 11/16: Harden's "55 points is tied for
    // the 2nd-most… this season" was 2025-26). It carries down the page until another player's box or heading.
    let seasonHdr = carrySeason && carrySeason.page === b.page ? carrySeason.hdr : null;
    const curSeason = seasonStart ? `${seasonStart.slice(0, 4)}-${String(+seasonStart.slice(0, 4) + 1).slice(2)}` : null;
    let prevRaw = null; // the sentence before, for "That's the fifth-most…" and "They have…"
    let sIdx = 0, prevIdx = -9; // prevRaw is the sentence right before only when prevIdx === sIdx - 1
    let paraWho = null, sinceWho = 0, lastWhen = null;
    let paraHead = false; // paraWho came from a capitals heading (a player's list of bullets), not from a sentence naming him
    if (carry && carry.page === b.page && carry.bio) { bioWho = paraWho = sectionWho = carry.who; sinceWho = 0; paraHead = true; }
    else if (carry && carry.page === b.page && carry.dist <= 700) { paraWho = carry.who; sinceWho = carry.dist; paraHead = true; }
    const keep = () => { carry = paraWho && paraHead ? { who: paraWho, page: b.page, dist: sinceWho, bio: !!(bioWho && paraWho === bioWho) } : null; }; // lastWhen: "old" / "current" for the paragraph's last dated sentence // chars of text since paraWho was named // the player this paragraph is about, for its "He..." sentences
    for (let s of (sentences(b.text.replace(/\b((?:19|20)\d\d-\d\d)\s+(SEASON HIGHLIGHTS|SEASON|NOTABLES|Season Highlights|NOTES|Notes)(?=\b|:)/g, "$1\u2060$2").replace(/(^|\s)((?:19|20)\d\d-\d\d):(?=\s)/g, "$1$2\u2060:")).flatMap((x) => x.split(/\s+(?=(?:19|20)\d\d-\d\d\u2060)|\s+(?=(?:[\p{Lu}0-9\/’'&.\-]{2,}\s+)*[\p{Lu}0-9\/’'&.\-]{3,}:\s+\p{Lu}|#\s?\d{1,2}\s+\p{Lu})/u).flatMap((y) => y.split(/\s*(?:…|\.{3}|[▪●•\u0000-\u0008\u000b\u000c\u000e-\u001f]|\s[o◦▫+]\s(?=[A-Z]))\s*/u).map((z, k, all) => { let w = k > 0 && /^[a-z]/.test(z) ? z[0].toUpperCase() + z.slice(1) : z; if (k < all.length - 1 && /[\p{L}\d%)]$/u.test(w) && !/\b(?:to|the|a|an|of|and|at|in|with|as|by|for|or|his|their|from|on|was|were|who|that|is|are|which)$/i.test(w)) w += "."; return w; }))).map((x) => x.replace(/\s*\*{2,}.*$/, "").trim())).flatMap((x) => splitBullets(x, full))) {
      sinceWho += s.length + 1;
      { const at = b.text.indexOf(s.slice(0, 25).replace(/\u2060/g, " "), cursor); if (at >= 0) cursor = at; }
      if (oldMeet.some((m) => cursor >= m.at && cursor < m.end)) { drop("last-meeting-old", s); continue; }
      while (bios.length && bios[0].at <= cursor + 5) { bioWho = paraWho = sectionWho = bios.shift().p; sinceWho = 0; lastWhen = null; seasonHdr = null; }
      if (/#\s?\d{1,2}\s+\p{Lu}/u.test(s)) seasonHdr = null; // another player's box starts in this text
      // 0.71: also "2024-25 SEASON:" and "PROFESSIONAL CAREER: 2024-25 SEASON:" (Boston, Dallas), "2026-27 NOTABLES:" (Atlanta).
      // 0.114 (the user, 11/19: Keldon Johnson's "ranks second in NBA in total bench points (1,081)" shown as "2nd in
      // NBA" in November; "these stats were from last season"): San Antonio heads a bio paragraph with the bare season
      // and a colon ("2025-26: 2025-26 NBA Sixth Man of the Year … One of two Spurs who played in all 82 games …").
      // The word after the season is now optional; the colon or dash is still required.
      { const sh = s.match(/^(?:[\p{Lu} ]{3,}:\s*)?((?:19|20)\d\d)-(\d\d)\s*(?:\(([^)]{2,30})\)|\u2060?(?:SEASON HIGHLIGHTS|SEASON|NOTABLES|Season Highlights|NOTES|Notes)(?:\s*\([^)]{2,30}\))?|(\u2060)(?=:))\s*[:–—-]\s*/u);
        // the bare form only inside a player's bio: elsewhere "2025-26: 3-1" is a table row, not a heading
        if (sh && (!sh[4] || bioWho)) { seasonHdr = `${sh[1]}-${sh[2]}`; s = s.slice(sh[0].length); if (s) s = s[0].toUpperCase() + s.slice(1); } }
      s = s.replace(/\u2060/g, " ");
      if (!s.trim()) continue;   // a heading with nothing after it
      // A header that names a past season over this season's games ("2025-26 SEASON: Made his NBA debut at HOU
      // (10/21/26)…", Dallas' rookie Morez Johnson Jr.) is a typo: a full date this season overrules it.
      if (seasonHdr && curSeason && seasonHdr !== curSeason && seasonStart
        && [...s.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g)].some((m) => `${m[3].length === 2 ? 2000 + +m[3] : +m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` >= seasonStart)) seasonHdr = curSeason;
      // An infographic table printed into the sentence that follows it ("…3 NEW ORLEANS 53.6 Despite having the sixth-most…",
      // "…SERIES NOTES Detroit took the first game…"): keep the prose after the last run of capitals.
      if (s.length < 1500 && (!/^[\p{Lu}"“]/u.test(s) || /^\d/.test(s) || TABLEY.test(s) || CAPS_PAIR.test(s))) {
        const m = s.match(/^.*(?:[\p{Lu}0-9.,%\/’'&#+:()\-]{2,}\s+){2,}(?=\p{Lu}\p{Ll}+[\s,'’])/u);
        if (m && s.length - m[0].length >= 40 && /\d|(?:\S+\s+){3}/.test(m[0])) s = s.slice(m[0].length);
      }
      s = s.replace(/(?:\s+[@#][A-Za-z0-9_]{3,})+$/, ""); // the PR account's handle at the end of an infographic page
      s = repairLayout(s);   // 0.65: game-log rows spliced in, stray ordinal suffixes, the page footer
      s = s.replace(/\b(joining|joins|joined) (\p{Lu}\p{Ll}+), (\p{Lu}\p{Ll}+) and (?=\p{Lu})/u, "$1 $2 $3 and "); // "joining Moussa, Cisse and Popeye Jones" (0.71)
      if (seasonHdr && curSeason && seasonHdr !== curSeason) { drop("past-season", `${seasonHdr}: ${s}`); continue; }
      // A feature box's table, read into one line (0.62).
      let tableLine = false;
      { const t = summarizeTable(s, tris); if (t) { s = t; tableLine = true; } }
      // The next table's title after the sentence: three or more capitals words, no brackets ("…vs. CHA (5-9 3FG))." stays).
      // (One space between words: an optional one lets a long run of capitals split many ways, which never finishes.)
      s = s.replace(/(?<!\bvs)([.!?])\s+(?:\p{Lu}[\p{Lu}0-9.,%\/’'&#+:\-]+\s+){2,}\p{Lu}[\p{Lu}0-9.,%\/’'&#+:\-]+\s*$/u, "$1");
      if (s.length < 40) { const w = subjectOf(s); if (w) { paraWho = sectionWho = w; sinceWho = s.length + 1; if (bioWho && w !== bioWho) bioWho = null; } continue; }
      if (s.length > 420) continue;
      // A capitals heading glued to the sentence ("ANTHONY DAVIS Logged..."): dropped; if it is a player's name, it is the subject.
      let headWho = null;
      const hm = s.match(/^((?:[\p{Lu}0-9’'&.\-\/:]{2,}\s+){0,8}?[\p{Lu}0-9’'&.\-\/]{2,}):?\s+(?=\p{Lu}\p{Ll})/u);
      // One capitals word is a heading too ("SHARPE Assists per game…", "DEBUT: Scored…"), unless it's an abbreviation ("NBA", "LA").
      // Initials are part of a name, not a heading ("P.J. Washington Jr. surpassed…" kept its "P.J.": 0.76).
      if (hm && !(/^\S+$/.test(hm[1]) && new RegExp(`^(?:${ABBR})$`).test(hm[1])) && !/^(?:\p{Lu}\.){1,3}$/u.test(hm[1])) {
        const h = caps(hm[1]).trim().toUpperCase();
        headWho = full.find((p) => { const n = caps(p.name).trim().toUpperCase().replace(/ (JR|SR|II|III|IV)$/, ""); return n.length > 4 && h.includes(n); })
          || full.find((p) => lastCount[p.last.toLowerCase()] === 1 && p.last.length >= 4 && new RegExp(`(?:^| )${esc(caps(p.last).trim().toUpperCase())}(?: |$)`).test(h)) || null;
        s = s.slice(hm[0].length);
        if (s.length < 40) continue;
      }
      // "That's the fifth-most over the first 17 games…" says nothing alone: read it with the sentence before.
      const prevNow = prevRaw;
      prevRaw = s;
      sIdx++;
      // (The line before is replaced only if the joined one is kept.)
      let joinedFrom = null;
      // 0.71: "He has the fourth-longest streak in Mavs history." says which streak only with the sentence before.
      if (prevNow && (/^(?:That['’]s|That is|This is|That ranks|This ranks|That marks|It['’]s)\b/.test(s) || /^(?:He|She|It) (?:has|had|is|was|owns) the [\w-]+ (?:streak|mark|total|run|stretch)\b/.test(s)) && prevNow.length + s.length < 420) {
        joinedFrom = prevNow;
        s = `${prevNow} ${s}`;
      }
      // 0.77: a sentence that points back without saying at what ("Booker is tied for the second-most such instances in
      // the NBA this season", "…one of five teams this season to record such a game", "the only player in the group…
      // during the span"; the user, 11/16) is read with the sentence right before it, or not at all.
      else if (dangling(s)) {
        if (prevNow && prevIdx === sIdx - 1 && prevNow.length + s.length < 420) { joinedFrom = prevNow; s = `${prevNow} ${s}`; }
        else { drop("dangling", s); prevIdx = sIdx; continue; }
      }
      prevIdx = sIdx;
      const they = /^They\b/.test(s) && !!prevNow && !!((teamRe && teamRe.test(plain(prevNow))) || (teamMid && teamMid.test(plain(prevNow))));
      // Who this part of the paragraph is about, noted before any filter drops the sentence.
      // A capitals heading naming another player ends a season header carried from the block above.
      if (headWho && carrySeason && carrySeason.page === b.page && carrySeason.who && headWho !== carrySeason.who && seasonHdr === carrySeason.hdr) seasonHdr = null;
      { const named = subjectOf(s), early = named || headWho; if (early) { paraWho = sectionWho = early; sinceWho = s.length + 1; paraHead = !named; if (bioWho && early !== bioWho) bioWho = null; } }
      keep();
      // A span of seasons running through last season ("each of the past three seasons (2023-26)") is a run still going, not an old date.
      // 0.82: an earlier occurrence named for comparison is not when the line happened ("…, the other time coming from
      // Feb. 26 to Mar. 3, 2023", "…largest deficit to overcome since March 1, 2015 at Boston when they won…").
      const core = s.replace(SINCE_CLAUSE, "").replace(/[,;]\s*(?:with )?the (?:only )?(?:other|last|previous|most recent)(?: such)? (?:times?|instances?|occasions?|occurrences?|one)\b.*$/i, "")
        .replace(/\bsince (?:(?:a|an|the) )?(?:[\w'’-]+ ){0,6}?(?:on )?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.? \d{1,2}, (?:19|20)\d\d\b.*$/i, "")
        .replace(/\b(era|tracked|recorded|kept)\s*\((?:since\s+)?(?:19|20)\d\d(?:-\d\d)?\)/i, "$1").replace(/\b((?:19|20)\d\d)-(\d\d)\b/g, (m, a, b) => (seasonStart && +b - +a.slice(2) >= 2 && 2000 + +b >= +seasonStart.slice(0, 4) ? "these seasons" : m));
      // A stats sidebar's cell read into the sentence ("(10-14 MINS 31 at TOR 11/11/26 FG…") doesn't date it (0.71).
      const ownDates = seasonStart ? datesOf(core.replace(/\b(?:MINS|PTS|REBS?|TREB|ASTS?|STLS?|BLKS?|DREB|OREB|FGM|FGA|3PM|FTM|FTA)\s+\d+\s+(?:times\s+\([^)]*\)?|(?:at|vs\.?|@)\s+[A-Z]{2,4}\s+\d{1,2}\/\d{1,2}\/\d{2,4})/g, " ").replace(/^\d{1,2}\/\d{1,2}\/\d{2,4}\)\s*|\s\d{1,2}\/\d{1,2}\/\d{2,4}\)\s/g, " ")) : [];
      const prevWhen = lastWhen;
      if (ownDates.length) lastWhen = ownDates.some((d) => d >= seasonStart) ? "current" : "old";
      // A capitals heading starting the next item mid-sentence: cut there.
      if (!tableLine) s = s.replace(/\s+(?:[\p{Lu}0-9\/’'&.\-]{2,}\s+)*[\p{Lu}0-9\/’'&.\-]{3,}:\s.*$/u, "").trim();
      if (s.length < 40) continue;
      // Splices and table fragments: stat-table labels with numbers, stat lines, runs of capitals,
      // a start that isn't a capitalised word, unbalanced brackets, a sentence that stops mid-thought.
      if (!/^[\p{Lu}"“]/u.test(s) || /^\d|^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.? \d/.test(s)) { drop("start", s); continue; }
      if (TABLEY.test(s) && !tableLine) { drop("tabley", s); continue; }
      // Two capitals words in a row that aren't common abbreviations: a table or heading spliced in ("his seventh MOST DOUBLE-DOUBLES double-double").
      if (CAPS_PAIR.test(s) && !tableLine) { drop("caps-pair", s); continue; }
      // A stat sidebar's cells read into the line ("FTA 12 at HOU 22 at PHI 11/30/25", "OREB 2 11/9 @ TOR (3x)", "…Career vs. New York Knicks record…").
      if (!tableLine && (/\b(?:FTA|FGA|OREB|DREB|T?REBS?|ASTS?|PTS|STLS?|BLKS?|MINS|3PM|FGM|FTM)\s+\d+\s+(?:at|vs\.?|@|\d)/.test(s) || /\d\s+\(\d+x\)|\(\d+x\)\s+\d/.test(s) || /\bCareer vs\. \p{Lu}/u.test(s.slice(1)))) { drop("splice", s); continue; }
      // Two columns read into one line ("…in NBA history. offensive rebounding (3.5 per).", "…game on 11/6. with at least…").
      if (/(?:\p{L}{5,}|\d|\)|%)\. (?!(?:\d|vs\b|[A-Z]))\p{Ll}/u.test(s.replace(/\b(?:vs|No|Jr|Sr|St|approx|per|pts|reb|ast)\. /g, "$&").replace(/\b(?:[A-Z]|vs|No|Jr|Sr|St)\. \p{Ll}/gu, ""))) { drop("splice", s); continue; }
      // A table cell read twice ("Luka DoncicLuka Doncic 5252").
      if (/(\p{Lu}[\p{L}'’\-]+ \p{Lu}[\p{L}'’\-]+)\1/u.test(s) || /\b(\d{2,3})\1\b/.test(s)) continue;
      const open = (s.match(/\(/g) || []).length, close = (s.match(/\)/g) || []).length;
      if (open !== close || !/[.!?)"”]$/.test(s) || /\b(?:to|the|a|of|and|at|in|with|as|by|for)\s*$/i.test(s) || (!tableLine && (s.match(/\(\d{1,3}\)/g) || []).length >= 2)) { drop("unfinished", s); continue; }
      if (/Notes\/Trends|Video Highlights|Season Stats|\bGP \d|PPG \d|\(cont\.?\)/i.test(s)) { drop("box-header", s); continue; }
      // 0.71: a stats glossary and its table read into each other (Charlotte's Cleaning the Glass page: "Ryan Kalkbrenner
      // Effective Field Goal % 70.0% 96th percentile On/Off point differential: A statistic that measures…").
      if (/\bA (?:per-possession )?statistic that\b|\bCan be used to\b|\bA ["“]play["”] is anything\b|\bis anything that results in\b/.test(s)
        || (/\b\d{1,2}(?:st|nd|rd|th) percentile\b/.test(s) && /(?:Field Goal|Block|Steal|Assist|Turnover|Rebound|Usage|Non-Corner 3P|Corner 3P|Free Throw)\s*(?:%|Rate)|On\/Off Differential/.test(s))) { drop("glossary", s); continue; }
      // Who is on the roster is not a storyline ("…(2025-26 First Team)… are currently on the team", 0.65).
      if (/\b(?:are|is) (?:currently|all|still) on the (?:team|roster)\b|\bcurrently on the (?:team|roster)\b/i.test(s)) { drop("roster", s); continue; }
      if (s.replace(/[^0-9]/g, "").length / s.length > (tableLine ? 0.5 : /\b\d{1,3}-\d{1,3} when\b/.test(s) ? 0.32 : 0.22)) { drop("numbers", s); continue; }
      // Past tense isn't a look ahead ("was the first ... with 200 3PM within 60 games").
      const fwd = FORWARD.test(s) && !/^(?:\S+\s+){0,4}?(?:was|were|became|had)\b/.test(s), ctxHit = CONTEXT.test(s), trendHit = TREND.test(s), hist = HISTORY.test(s) || (!ctxHit && !trendHit && HISTORY_ALSO.test(s));
      // 0.78: a table's lead-in says nothing without the table ("Below is a look at where Jeremiah Fears and Derik Queen
      // matchup amongst all NBA sophomores this season."; the user, 11/16).
      if (/^(?:Below|Here|The following|See below|Listed below|The (?:chart|table|list) below)\b[^.]{0,60}\b(?:is|are|shows?|lists?|details?|breaks? down)\b|^(?:Below|Here) (?:is|are)\b|\b(?:is|are) (?:listed|shown|detailed|broken down) below\b|\ba look at (?:where|how)\b/i.test(s) && !tableLine) { drop("lead-in", s); continue; }
      if (SCHEDULE.test(s)) { drop("schedule", s); continue; }
      if (!fwd && !hist && !ctxHit && !trendHit && !tableLine) { drop("no-signal", s); continue; }
      if (NOT_NBA.test(core) || /\b(?:drafted|draft pick|overall pick|picked \w+(?: overall)?|NBA Draft|Draft Lottery|transferr|left the [A-Z]\w+|(?:with|for) the [A-Z][a-z]+ (?:from|in) (?:19|20)\d\d|All-(?:Big|ACC|SEC|Pac|American)|Ignite|Jayhawks|collegiate)\b/i.test(core)) { drop("background", s); continue; } // background
      const key = plain(s).toLowerCase().replace(/[^a-z0-9]+/g, ""); // "150-plus" and "150plus" are the same line
      if (seen.has(key)) continue;
      seen.add(key);
      // A subset from the sentence before ("…assist record for a center in franchise history…") still holds for an
      // unqualified record right after it about the same stat ("on pace to average the most assists per game in
      // franchise history (4.1)" is among centers: 0.65).
      { const sub = (t) => (t || "").match(/\b(?:for|by|among(?:st)?)\s+(?:a\s+|an\s+|all\s+(?:NBA\s+)?)?(center|rookie|guard|forward|reserve|teenager|bench player|power forward|point guard|sixth man)s?\b/i);
        const stat = (t) => new Set((plain(t || "").toLowerCase().match(/\b(?:assist|rebound|point|block|steal|three|3-pointer|triple-double|double-double)/g) || []));
        const p0 = sub(prevNow);
        if (p0 && !sub(s) && /\b(?:most|highest|fewest|record)\b[^.]{0,90}\bin (?:franchise|team|NBA|league) history\b/i.test(s) && [...stat(s)].some((w) => stat(prevNow).has(w)))
          s = s.replace(/\s+in (franchise|team|NBA|league) history\b/i, (m, w) => ` by a ${p0[1].toLowerCase()} in ${w} history`);
      }
      // WHO.
      // The sentence's own subject outranks the heading above it; a heading's player is not credited with a
      // sentence that opens with someone else's name ("TOLU SMITH Ron Holland became...").
      let own = subjectOf(s) || subjectOf(s.replace(SINCE_CLAUSE, ""));
      if (!own && tableLine) { const lead = plain(s.split(":")[0]); own = full.find((p) => p.re.test(lead) && !OBJECT_BEFORE.test(lead.slice(0, lead.search(p.re)))) || null; }
      if (!own) {
        const th = plain(s).match(/\bthan\s+(\p{Lu}[\p{L}'’.\-]+(?:\s+\p{Lu}[\p{L}'’.\-]+)?)\s*[.!]?$/u);
        const nm = th && th[1].replace(/\.$/, "");
        if (th && /\bonly\b/.test(s)) own = full.find((p) => p.re.test(nm)) || full.find((p) => lastCount[p.last.toLowerCase()] === 1 && p.last === nm.split(/\s+/).pop()) || null;
      }
      const otherName = !own && headWho && /^\p{Lu}[\p{Ll}'’]+(?:\s+\p{Lu}[\p{Ll}'’.]+){1,2}(?:\s+(?:Jr\.?|Sr\.?|II|III|IV))?,?\s+\p{Ll}/u.test(s);
      if (otherName) { drop("heading-other-name", s); continue; }
      const subj = own || headWho;
      if (subj) { paraWho = sectionWho = subj; sinceWho = s.length + 1; if (bioWho && subj !== bioWho) bioWho = null; }
      // A sentence that opens with "He…" or a bare verb ("Became…", "Passed Nikola Vučević…") is about the
      // player of its paragraph, or failing that of its part of the page.
      const pronoun = /^(?:He|His|The \d{2}-year-old|The rookie|The (?:guard|forward|center|big man|veteran|sophomore))\b/.test(s);
      const verbLed = /^(?:Had|Hit|Shooting|Shot|Along with|Since|Became|Becomes|Recorded|Records|Logged|Set|Sets|Tied|Ties|Joined|Joins|Passed|Scored|Posted|Notched|Tallied|Grabbed|Dished|Made|Hit|Owns|Holds|Ranks|Leads|Led|Moved|Reached|Surpassed|Eclipsed|Needs|Is|Has|Was|Averag\w+|Finished|Registered|Matched|Broke|Earned|Collected|Totaled|Pulled down|Handed out|Knocked down|Connected)\b/.test(s);
      let who = subj, how = own ? "named" : headWho ? "heading" : null;
      if (!who && (pronoun || verbLed || (bioWho && paraWho === bioWho))) {
        // Close to the sentence that named him (a player-info page can hold two players' columns).
        if (bioWho && paraWho === bioWho) { who = bioWho; how = "bio"; }
        else if (paraWho && sinceWho <= 700) { who = paraWho; how = "paragraph"; }
        else if (paraWho) { who = paraWho; how = "section"; }
        else if (sectionWho) { who = sectionWho; how = "section"; }
      }
      // A sentence that opens with the team ("Cleveland is averaging…", "The Cavs 201 made triples…") is the team's,
      // even inside a player's box (0.65: two Cavs team stats were credited to Jarrett Allen).
      if (!own && who && how !== "named" && teamRe && teamRe.test(plain(s))) { who = null; how = null; }
      // A coach's or front office's line on a player's page is not the player's.
      if (who && how !== "named" && how !== "heading" && /\b(?:coach\w*|his teams|under his|front office|general manager|GM|victories|wins (?:as|with)|\d+ wins\b)/i.test(s)) { drop("staff-line", s); continue; }
      // WHEN. Dates in the sentence decide; "since 1973-74" and "since 2015" are comparisons, not when.
      const dates = datesOf(core);
      const thisSeason = seasonStart ? dates.some((d) => d >= seasonStart) : false;
      // A real day this season ("10/21", "Nov. 6"), not just a season label like "2026-27" spliced in from a table.
      const dayThisSeason = seasonStart ? undated(s).concat([...s.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g)].map((m) => `${m[3].length === 2 ? 2000 + +m[3] : +m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`)).some((d) => d >= seasonStart) : false;
      // "(12.8 per overall; 25th w/11.5 in 2025-26)": last season as the comparison for a stretch this season, not the line's date.
      const datedOld = dates.length && seasonStart && !thisSeason && !(trendHit && /\b(?:past|last|first) \d+ (?:games|GP)\b|\bthis season\b/i.test(s));
      if (datedOld) { drop("dated-old", s); continue; }
      // 0.142.5 (the user, 11/23: "the number of games played this season does not allow for what is listed in the
      // notes"): a count of games no team has played yet ("his 43rd double-double", "21 games with 20+ turnovers" with 15
      // played) or a season total no one could have ("1,000 points this season" in November) isn't this season's.
      if (box?.games?.length && tooBigForSeason(s, box.games.length)) { drop("count-past-season", s); continue; }
      // "On Dec. 23, 2025… He is now the first rookie…": an undated follow-on sentence belongs to the date before it.
      if (!dates.length && how && how !== "named" && how !== "heading" && prevWhen === "old" && !/\b(?:this season|active streak|longest active)\b/i.test(s)) { drop("follows-old", s); continue; }
      // 0.71: "Harper Jr.'s six 3-pointers marked a career high" right after "…at SAS March 10": that game's, named or not.
      if (!dates.length && prevWhen === "old" && /\b(?:marked|tied|matched|equaled|set|setting|tying)\b[^.]{0,40}\b(?:career|season)[- ]high\b/i.test(s) && !/\b(?:this season|has|is|now)\b/i.test(s)) { drop("follows-old", s); continue; }
      // The box scores: a line's single-game numbers ("30 points, 14 rebounds… vs. WAS (10/24)") match a game
      // a player of ours had this season → that's who, and it's current. Numbers credited to a player who never
      // had that game → not this season's (if he was named) or not his (if he was inferred).
      const chk = box ? checkLine(box, s, { namedId: who ? String(who.id) : null, dates: dates.filter((d) => !seasonStart || d >= seasonStart) }) : { named: null, who: null };
      let boxCurrent = false, boxOld = false;
      if (chk.named === "yes") boxCurrent = true;
      else if (chk.named === "no") {
        if (how === "named" || how === "heading") boxOld = true;
        else if (chk.who && byId[chk.who]) { who = byId[chk.who]; how = "box"; boxCurrent = true; }
        else { drop("box-mismatch", s); continue; }
      } else if (!who && chk.who && byId[chk.who]) { who = byId[chk.who]; how = "box"; boxCurrent = true; }
      // "The last player named on this page" is right too often to ignore and wrong too often to trust
      // (Brandon Miller's line credited to Kon Knueppel): only with a box score that agrees.
      if (how === "section" && chk.named !== "yes") { drop("section-unconfirmed", s); continue; }
      // Series lines are about tonight's opponent only (notes keep the last opponent's series page around).
      if (SERIES.test(s) && oppRe && !oppRe.test(plain(s)) && !/\bthis season['’]s series\b/i.test(s)) { drop("other-series", s); continue; }
      // A table row read into prose ("Domantas Sabonis 413 which ranks sixth…").
      if (/^\p{Lu}[\p{L}'’.\-]+(?:\s+\p{Lu}[\p{L}'’.\-]+){1,2}\s+\d[\d,]*\s+(?:which|that|is|ranks)\b/u.test(s)) { drop("table-row", s); continue; }
      const matchup = SERIES.test(s) || (!!oppRe && oppRe.test(plain(s)) && ctxHit);
      // A team-stats box: "Rockets Offense ➢ Averaging 108.0 ppg over the past 5 games…" (the team named in the heading just above).
      // The heading can also be the end of the block before, when the box's bullets are "•" (each bullet is its own block).
      const preHead = !who && verbLed && teamWords.length ? plain(`${cursor < 120 && prevBlock && prevBlock.page === b.page ? `${prevBlock.text} ` : ""}${b.text.slice(0, cursor)}`.slice(-120)) : "";
      // The box's own heading ("Rockets Turnovers", "Rockets 3-Point Percentage") says what the bullet under it is about;
      // without it "Shooting 34.4% over the past 5 games…" names neither the team nor the stat (the user, 11/16).
      const topic = preHead ? (preHead.match(new RegExp(`\\b((?:${teamWords.map(esc).join("|")}) [A-Z0-9][\\w%'’-]*(?: [A-Z0-9][\\w%'’-]*){0,3})[^\\w)%]*$`)) || [])[1] || null : null;
      // (Until 0.76 any mention of the team in the 120 characters before counted, which credited a player's bullet
      // to the team: "Scored a career-high 14 points in a career-best 21 minutes…" in Milwaukee's notes.)
      const teamHead = !!topic;
      const team = !who && (teamHead || (teamRe && teamRe.test(plain(s))) || ((ctxHit || trendHit || tableLine || hist) && teamMid && teamMid.test(plain(s))) || they || (matchup && SERIES.test(s)));
      if (!who && !team) { drop("no-who", s); continue; }
      const kind = fwd ? (PASSY.test(s) ? "pass" : "next") : hist ? "record" : ctxHit ? "context" : "trend";
      if (boxOld && !thisSeason && !CURRENT.test(s)) { drop("box-not-this-season", s); continue; }
      // "the first … to record at least 40 PTS and 15 REB in a game": if he had such a game this season, it's this season's.
      if (!boxCurrent && !thisSeason && who && box) {
        const ths = thresholdClaims(s);
        if (ths.length >= 2 || (ths.length === 1 && ths[0].min >= 10)) {
          const g = meetsThresholds(box, String(who.id), ths);
          if (g) { boxCurrent = true; chk.game = chk.game || g; }
        }
      }
      // A standing fact in the present tense ("Giddey has recorded six games of 15-plus assists…, tied for fourth-most in
      // team history", "Duren has the 4th-highest field goal percentage…"): true as of tonight, whoever's notes say it.
      const standing = !!who && /^(?:[\p{Lu}][\p{L}'’.\-]*\s+){0,3}(?:\([^)]*\)\s+)?(?:also\s+|now\s+|currently\s+|still\s+)?(?:is|ranks|has|holds|owns|sits|leads|remains|stands|extends|trails)\b/u.test(core.replace(/^(?:He|She)\s+/, "X "))
        || (!!who && /^(?:Is|Ranks|Has|Holds|Owns|Sits|Leads|Remains|Stands|Extends|Trails)\b/.test(core));   // a box's bullet with no name: "Ranks 10th in NBA in 3FG%"
      // A series run still going ("has won each of the past two season series", "won eight of the last 12 meetings") is current.
      const seriesRun = matchup && /\b(?:each of the (?:past|last)|(?:past|last) (?:\w+ )?(?:season series|meetings)|straight (?:meetings|games against))\b/i.test(s);
      // League context in the present tense ("They have the highest rate…", "Davis owns the most blocks…") is as of tonight.
      const presentCtx = (kind === "context" || kind === "trend" || ctxHit) && /\b(?:is|are|has|have|leads?|ranks?|owns?|sits?|remains?|holds?|joins?)\b/.test(core);
      // 0.82: a team's history line said in the present ("this is just the second time in the play-by-play era the
      // Warriors have had four consecutive comeback wins…") is as of now, like a player's standing fact.
      const teamNow = !who && !!team && kind === "record" && /\bthis (?:is|was|marks|marked) (?:just |only )?the (?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)) time\b/i.test(core);
      const current = thisSeason || boxCurrent || standing || seriesRun || presentCtx || teamNow || CURRENT.test(s) || (kind !== "record" && kind !== "context");
      if (!current) { drop("not-current", s); continue; }
      // In the regular season before April, a postseason, an All-Star break or a games count past tonight's is last season's.
      if (today && !dayThisSeason && !thisSeason) {
        const mo = +today.slice(5, 7), gp = box && Array.isArray(box.games) ? box.games.length : null;
        const past = (mo >= 10 || mo <= 3) && /\b(?:postseason|playoffs?|play-in|(?:Western|Eastern) Conference (?:Semifinals|Finals)|Conference (?:Semi)?[Ff]inals|WCF|ECF|NBA Finals|First Round|Game [1-7] (?:at|vs\.?|of)|post All-Star break|(?:after|before|since) the All-Star break|all 82)\b/.test(s) && !/\b(?:appearances|titles|championships|series wins)\b/i.test(s);
        const nOver = gp != null && [...s.matchAll(/\b(?:through|first|in(?: his| their)? first|over (?:his|their) first) (\d{2,3}) games\b/gi)].some((m) => +m[1] > gp + 2 && !/career|history|with the team|with (?:the )?\p{Lu}\w+|as a \p{Lu}|uniform/u.test(s.slice(Math.max(0, m.index - 20), m.index + m[0].length + 30)));
        if (past || nOver) { drop("last-season", s); continue; }
      }
      const stretchNow = trendHit && /\b(?:past|last|first) \d+ (?:games|GP)\b|\bthis season\b/i.test(s);   // last season only as the comparison
      if (!stretchNow && OLDER.test(core.replace(/\b(?:back to|dating back to|going back to|since|including|over) last season\b/gi, "these seasons")) && !dayThisSeason) { drop("older", s); continue; }
      const score = (kind === "pass" ? 3 : kind === "next" ? 2.4 : kind === "trend" ? 1.8 : 2) + (thisSeason || CURRENT.test(s) ? 1 : 0) + (/in NBA history|all-time|since 19\d\d|first (?:player|rookie|team)/i.test(s) ? 0.8 : 0) - (how === "section" ? 0.3 : 0);
      // A single game told without its date ("Daniss Jenkins led the charge with a career-high 31 points…"): the box
      // score says which game; without one, an undated recap can't be placed and is dropped (0.65).
      if (!datesOf(s).length && !undated(s).length && !/\b(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b|\blast (?:game|night|time out|outing)\b|\brecent outing\b/.test(s) && !/\b(?:this season|per game|averag\w*|straight|consecutive|in a row|has|have|is|are|ranks?|owns?|holds?)\b/i.test(s)
        && /\b(?:led the (?:charge|way|team)|added \d+|came off the bench to|scored|recorded|grabbed|dished|tallied|poured in|finished with|chipped in)\b/i.test(s)) {
        const g = chk.game;
        if (g && g.d) s = s.replace(/([.!])$/, ` (${+g.d.slice(5, 7)}/${+g.d.slice(8, 10)}${g.opp ? ` vs. ${g.opp}` : ""})$1`);
        else if (/\bled the (?:charge|way)\b|\badded \d+\b|\bcame off the bench to\b/i.test(s)) { drop("undated-recap", s); continue; }
      }
      // 0.94 (the user, 11/17: "it also doesn't tell me when cade made those free throws"): a feat told in the past tense
      // with no date, which one box score matches, gets that game's date.
      if (chk.game?.d && !datesOf(s).length && !/\(\d{1,2}\/\d{1,2}\b/.test(s) && /^(?:[\p{Lu}][\p{L}.'’-]+\s+){1,3}(?:made|scored|recorded|grabbed|dished|tallied|poured in|finished with|knocked down|hit|posted|notched|went|shot|blocked|handed out|pulled down|sank|converted)\b/u.test(s))
        s = s.replace(/([.!…]?)$/, ` (${+chk.game.d.slice(5, 7)}/${+chk.game.d.slice(8, 10)}${chk.game.opp ? ` vs. ${chk.game.opp}` : ""})$1`);
      if (joinedFrom && out.length && out[out.length - 1].text === joinedFrom) out.pop();
      out.push({ page: b.page, text: topic && !new RegExp(`^${esc(topic)}\\b`).test(s) ? `${topic}: ${s}` : s, topic: topic || undefined, kind, player: who?.name || null, playerId: who?.id || null, team: !!team, matchup, how: who ? how : matchup && !team ? "series" : "team", resolved: !subj && !!who, boxGame: chk.game || null, when: "season", score: Math.round(score * 100) / 100 });
    }
    // A player's box header printed at the end of the block before his notes ("…W115-108 Center #28 Alperen Sengun 6-11/255"):
    // his notes are the next block, after the header's "•" (Houston, 11/13).
    if (blockBio) carry = { who: blockBio, page: b.page, dist: 0, bio: true };
    carrySeason = seasonHdr && !blockBio ? { hdr: seasonHdr, page: b.page, who: sectionWho } : null;
  }
  // The same forward fact printed twice ("needs 816 points to pass Kobe Bryant"): keep one.
  const fwdKey = (t) => { const m = t.match(/needs?\s+([\d,]+)\s+([a-z-]+(?:\s+[a-z-]+)?)\s+to\s+(?:pass|tie|surpass)\s+([A-Z][^.,]{2,40}?)(?=\s+for|[.,]|$)/i); return m ? m.slice(1).join('|').toLowerCase() : null; };
  const kept = new Set();
  // A line printed twice, once naming the player and once not ("Brandon Miller logged…" / "Logged…"): keep the named one.
  const tail = (t) => plain(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(-60);
  const namedTails = out.filter((x) => x.how === "named" || x.how === "heading").map((x) => tail(x.text));
  return out
    .filter((x) => x.how === "named" || x.how === "heading" || x.how === "team" || x.how === "bio" || !namedTails.some((t) => t.length >= 40 && (t.endsWith(tail(x.text).slice(-40)) || tail(x.text).endsWith(t.slice(-40)))))
    .filter((x) => { const k = fwdKey(x.text); if (!k) return true; if (kept.has(k)) return false; kept.add(k); return true; })
    // The same game written up twice ("Dončić recorded 45 points, 15 rebounds…" / "TORONTO, NOV. 1: Dončić finished with 45 points, 15 rebounds…").
    .filter((x) => {
      const c = statClaims(x.text);
      if (!x.playerId || c.length < 3) return true;
      const k = `${x.playerId}|${c.map((y) => y.stat + y.n).sort().join(",")}`;
      if (kept.has(k)) return false; kept.add(k); return true;
    });
}
