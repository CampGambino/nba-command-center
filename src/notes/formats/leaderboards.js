import { xAt } from "../pdf-layout.js";
import { statFromTitle, qualifierOf, num, isDecimal, looksLikeThousandsTypo } from "../stats.js";
import { cleanName } from "../names.js";
import { teamFromText } from "../../teams.js";

/**
 * Ranked lists, often several printed side by side or stacked. Styles seen:
 *   "1. L. James (23,119)"         rank, name, value in parentheses
 *   "T-4. Luka Dončić (1)"         tied rank
 *   "1. Manu Ginobili   1,495"     rank, name, value
 *   "1  Isaiah Stewart  435"       bare rank (wide gaps only)
 *   "701  Dell Curry  1988-98"     no rank at all: value, name, years with the team
 * Rows are grouped into a table by the x position where they start, so
 * side-by-side lists never bleed into each other. The title is the text
 * printed above that column; the section is the heading above the column.
 *
 * Every list gets a `scope` only on positive evidence (a team or "NBA" named in
 * its title or its own column heading). Without evidence the scope is
 * "unknown", and nothing from that list is ever publishable on its own.
 */
const RE_PAREN = /(?:^|\s)(T-)?(\d{1,2})(t)?[.,]\s*(\p{Lu}[\p{L}’'.,\- ]*?)\s*\(\s*([\d,.]{1,7})\s*\)/gu;
const RE_PLAIN = /(?:^|\s)(T-)?(\d{1,2})(t)?[.)]\s+(\p{Lu}[\p{L}’'.\- ]*?[\p{L}.])\s{2,}([\d,.]{1,7})(?=\s|$)/gu;
// Bare rank: only accepted with wide gaps between rank, name and value
// (separate cells), which ordinary sentences never have.
const RE_BARE = /(?:^|\s{2,})(t-|T-)?(\d{1,2})()\s{2,}(\p{Lu}[\p{L}’'.,\- ]*?[\p{L}.])\s{2,}([\d,.]{1,7})(?=\s|$)/gu;
// Value first, then name, then the years with the team ("2018-present").
const RE_VALUE_FIRST = /(?:^|\s{2,})(\d[\d,.]{0,6})\s{2,}(\p{Lu}[\p{L}’'.\- ]*?[\p{L}.])\s{2,}((?:19|20)\d\d\s*-\s*(?:\d{2,4}|present)(?:,\s*(?:19|20)\d\d\s*-\s*(?:\d{2,4}|present))*)/gu;

const HEADER_NOISE = /^(player|total|no\.?|rank|name|games?|#|rank\s+player.*|rank\s+name.*)$/i;
// Body text that sometimes sits above a list: sentence breaks, dates, bullets, records.
const NOT_A_TITLE = /[a-z0-9]\)?\.\s|\)\.|•|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\(\.\d{3}\)|^\s*(T-)?\d{1,2}t?[.,]\s/;

function rowsOnLine(line) {
  const found = [];
  const take = (re, kind) => {
    for (const m of line.text.matchAll(re)) {
      const lead = m[0].length - m[0].trimStart().length;
      const start = m.index + lead, end = m.index + m[0].length;
      if (found.some((f) => start < f.end && end > f.start)) continue; // already read by an earlier style
      const row = kind === "value-first"
        ? { rank: null, tied: false, player: m[2], raw: m[1], years: m[3].replace(/\s+/g, ""), active: /present/i.test(m[3]) }
        : { rank: +m[2], tied: !!(m[1] || m[3]), player: m[4], raw: m[5] };
      found.push({ ...row, kind, start, end, x: xAt(line, start), xEnd: xAt(line, end - 1) });
    }
  };
  take(RE_PAREN, "ranked");
  take(RE_PLAIN, "ranked");
  take(RE_BARE, "ranked");
  take(RE_VALUE_FIRST, "value-first");
  return found.sort((a, b) => a.start - b.start);
}

export function readLeaderboards(doc) {
  const tables = [];
  for (const page of doc.pages) {
    const open = [];
    page.lines.forEach((line, li) => {
      const joined = new Set();
      for (const e of rowsOnLine(line)) {
        e.total = num(e.raw);
        if (e.total == null) continue;
        e.player = cleanName(e.player.replace(/^([A-Z]),\s*/, "$1. "));
        const t = open.find((t) => !t.closed && t.kind === e.kind && Math.abs(t.x - e.x) < 30 && li - t.lastLine <= 2 && (e.kind === "value-first" || nextRank(t.rows[t.rows.length - 1], e)));
        if (t) { t.rows.push(e); t.lastLine = li; t.xEnd = Math.max(t.xEnd, e.xEnd); joined.add(t); }
        else { const n = { page: page.page, kind: e.kind, x: e.x, xEnd: e.xEnd, firstLine: li, lastLine: li, rows: [e] }; open.push(n); joined.add(n); }
      }
      // Any other text printed inside an open table's column (a new title,
      // a "(1-4 RANKING)" line) ends that table, so stacked lists never merge.
      for (const t of open) {
        if (t.closed || joined.has(t)) continue;
        if (line.cells.some((c) => c.cx > t.x - 5 && c.cx < t.xEnd + 5 && c.text.length > 2)) t.closed = true;
      }
    });
    for (const t of open) {
      if (t.rows.length < 3) continue;
      if (t.kind === "value-first") t.rows.forEach((r, i) => { r.rank = i + 1; });
      t.title = titleAbove(page, t);
      t.section = sectionAbove(page, t);
      tables.push(t);
    }
  }
  return tables.map(finish);
}

function finish(t) {
  const checks = [];
  // "1.944" in a list otherwise printed "1,944": a typo for one thousand nine
  // hundred forty-four. Fixed, but flagged.
  const commaStyle = t.rows.some((r) => /,\d{3}/.test(r.raw));
  for (const r of t.rows) {
    if (commaStyle && looksLikeThousandsTypo(r.raw)) {
      r.total = Number(r.raw.replace(".", ""));
      checks.push(`"${r.raw}" for ${r.player} read as ${r.total.toLocaleString()} (decimal point printed instead of comma)`);
    }
  }
  const average = t.rows.some((r) => isDecimal(r.raw) && !(commaStyle && looksLikeThousandsTypo(r.raw)));
  const context = `${t.section || ""} ${t.title}`;
  return {
    format: "leaderboard",
    style: t.kind,
    page: t.page,
    title: t.title,
    section: t.section,
    stat: statFromTitle(t.title),
    qualifier: qualifierOf(t.title),
    scope: scopeOf(t.title, t.section),
    average,
    rankRange: (context.match(/\((\d+)\s*-\s*(\d+)(?: ranking)?\)/i) || []).slice(1).map(Number),
    rows: t.rows.map(({ rank, tied, player, total, raw, years, active }) => ({ rank, tied, player, total, raw, ...(years ? { years, active } : {}) })),
    preChecks: checks,
  };
}

/** Ranks run 1,2,3 or repeat for ties (3t, 3t, 5). A jump means a different list. */
function nextRank(prev, e) {
  if (e.rank === prev.rank) return true;
  if (e.rank === prev.rank + 1) return true;
  return (prev.tied || e.tied) && e.rank > prev.rank && e.rank <= prev.rank + 3;
}

/**
 * Column text printed above a table, within its horizontal span. Titles often
 * wrap ("POINTS" / "SCORED"), and a neighbouring column's title can sit on a
 * line in between, so a few lines are read and gaps are skipped.
 */
function titleAbove(page, t) {
  const parts = [];
  for (let k = t.firstLine - 1; k >= 0 && k >= t.firstLine - 6; k--) {
    const line = page.lines[k];
    const cells = line.cells.filter((c) => c.cx > t.x - 15 && c.cx < t.xEnd + 10);
    if (!cells.length) continue;
    // A data row of a list printed above this one (a bare rank, a value, a
    // "5 Moses Moody .378%" row) means the title search has gone too far.
    if (cells.some((c) => /^[\d,.%\s\-t]+$/i.test(c.text) || (/^\s*(T-|t-)?\d{1,2}t?[.,]?\s+\p{Lu}/u.test(c.text) && /\d\s*\)?\s*$/.test(c.text)))) break;
    // Titles are short; a long cell or sentence-like text is body copy that
    // happens to sit above the list.
    const words = cells.map((c) => c.text).filter((s) => !HEADER_NOISE.test(s.trim()) && s.length <= 60 && !NOT_A_TITLE.test(s.replace(/\([^)]*\)/g, "")));
    if (!words.length) continue;
    parts.unshift(words.join(" "));
    if (parts.length >= 3) break;
  }
  return parts.join(" ").replace(/\s+/g, " ").trim() || `Leaderboard (page ${t.page})`;
}

/**
 * What kind of list it is, which decides whether a "chase" is even meaningful:
 *   streak         - consecutive-games lists (a chase only if the streak is alive)
 *   season-record  - best single seasons (a chase only if the row is this season)
 *   season         - this season's leaders
 *   nba / franchise - career totals, only with positive evidence
 *   unknown        - no evidence either way
 */
function scopeOf(title, section) {
  if (/consecutive|straight|streak/i.test(title)) return "streak";
  if (/single[- ]season|in a season|in season|of a season|first \d+ games/i.test(title)) return "season-record";
  if (/this season|season leaders|through the first|20\d\d-\d\d (leaders|season)/i.test(`${section || ""} ${title}`)) return "season";
  if (/\bNBA\b/.test(title)) return "nba";
  if (teamFromText(title) || /franchise|club history|team history/i.test(title)) return "franchise";
  if (section && /\bNBA\b/.test(section) && /all[- ]?-?\s?time|history|career/i.test(section)) return "nba";
  if (section && (teamFromText(section) || /franchise/i.test(section))) return "franchise";
  return "unknown";
}

/**
 * The heading a list sits under, e.g. "NBA ALL-TIME REGULAR SEASON RANKS" vs
 * "LAKERS ALL-TIME REGULAR SEASON RANKS" printed side by side over two columns
 * of lists. Only a heading that actually overlaps this list's column counts
 * (a sidebar next to the list is not its heading).
 */
const SECTION_WORDS = /rank|leader|all[ -]?-?\s?time|franchise|history|milestone/i;
function sectionAbove(page, t) {
  const mid = (t.x + t.xEnd) / 2;
  for (let k = t.firstLine - 1; k >= 0 && k >= t.firstLine - 40; k--) {
    const cells = page.lines[k].cells;
    // A heading alone on its line (e.g. "Charlotte Hornets All-Time
    // Leaderboard") covers every column below it.
    const standalone = cells.length === 1;
    const hits = cells.filter((c) => {
      if (!standalone && (c.x1 <= t.x || c.x0 >= t.xEnd)) return false;
      const s = c.text.replace(/\s+/g, " ").trim();
      if (s.length > 90 || /\d{1,2}t?[.,]\s+\p{Lu}/u.test(s) || /\(\d+\s*-\s*\d+/.test(s)) return false;
      const letters = s.replace(/[^A-Za-z]/g, "");
      const capsy = letters.length >= 6 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.6;
      return (capsy || (standalone && s.length >= 15 && s.length <= 70)) && SECTION_WORDS.test(s);
    });
    // Two headings side by side: take the one centred over this list.
    if (hits.length) return hits.sort((a, b) => Math.abs(a.cx - mid) - Math.abs(b.cx - mid))[0].text.replace(/\s+/g, " ").trim();
  }
  return null;
}
