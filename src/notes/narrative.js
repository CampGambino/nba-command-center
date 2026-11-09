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
function blocks(doc) {
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
