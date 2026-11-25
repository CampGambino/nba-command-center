import { repairToUnicode } from "./pdf-repair.js";
/**
 * PDF -> positioned lines.
 *
 * Every text run keeps its real position and width (pdfjs reports both), so
 * later stages can tell which column a phrase belongs to. Each line carries:
 *   text   - the visual row as one string
 *   charX  - the x position of every character in `text`, so a regex match
 *            anywhere in the row can be traced back to where it sits on the page
 *   cells  - runs merged into horizontal cells; a wide gap starts a new cell
 *
 * Nothing here interprets the content.
 */

let pdfjsPromise = null;
// pdfjs warns about missing canvas/rendering support on import; text
// extraction never renders, so those three warnings are silenced (only those).
const loadPdfjs = () =>
  (pdfjsPromise ??= (async () => {
    const warn = console.warn, log = console.log;
    const quiet = (fn) => (...a) => (/napi-rs\/canvas|Cannot polyfill/.test(String(a[0])) ? undefined : fn(...a));
    console.warn = quiet(warn); console.log = quiet(log);
    try { return await import("pdfjs-dist/legacy/build/pdf.mjs"); }
    finally { console.warn = warn; console.log = log; }
  })());

/** @param {Buffer|Uint8Array} buf */
export async function readPdf(buf) {
  const pdfjs = await loadPdfjs();
  // Fonts with a broken ToUnicode map (Boston's notes) are fixed first; any other PDF is untouched.
  const fixed = repairToUnicode(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  buf = fixed.buf;
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise;

  const pages = [];
  let pictured = null, probes = 0, picturedPages = 0; // null: not decided yet
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = [];
    for (const it of content.items) {
      if (!it.str) continue;
      const [a, b, c, d, e, f] = it.transform;
      // Rotated or vertical text (side banners) is not part of any row.
      if (Math.abs(b) > Math.abs(a) * 0.2) continue;
      const h = Math.abs(d) || Math.hypot(c, d) || it.height || 8;
      // Tightly justified text can carry its word breaks as space glyphs only
      // 0.07pt wide (Charlotte p.37: "NazReidis89points..."). Keep them as
      // markers so the gap rule alone does not glue the words together.
      if (!it.str.trim()) { items.push({ x: e, y: f, w: it.width || 0, h, str: " ", space: true }); continue; }
      items.push({ x: e, y: f, w: it.width || it.str.length * h * 0.5, h, str: it.str });
    }
    const shadow = dropShadowLayer(items);
    dropDoubled(items);
    // Text drawn as pictures (Milwaukee): decided by the first two text-heavy
    // pages, so every other team's notes pay for at most two extra page reads.
    let pic = 0;
    const runs = items.reduce((n, it) => n + (it.space ? 0 : 1), 0);
    if (pictured === true || (pictured === null && runs >= PICTURED_PROBE_RUNS)) {
      try { pic = picturedText(items, await pictureLayer(pdfjs, page)); } catch { pic = 0; }
      if (pictured === null && (pic || ++probes >= 2)) pictured = pic > 0;
      if (pic) picturedPages++;
    }
    pages.push({ page: p, width: viewport.width, height: viewport.height, lines: buildLines(items), ...(shadow ? { shadowDropped: shadow } : {}), ...(pic ? { pictured: pic } : {}) });
    page.cleanup?.();
  }
  const pageCount = doc.numPages;
  await doc.destroy?.();
  return { pageCount, pages, repairedFonts: fixed.repaired, ...(picturedPages ? { picturedPages } : {}) };
}

const PICTURED_PROBE_RUNS = 40;
/** Share of a page's text runs that must sit exactly on a picture before the page is treated as pictured. */
const PICTURED_SHARE = 0.8;
/** A run's picture is wider than its text by about this much of the font size (measured on runs that abut). */
const PICTURE_PAD = 0.45;

/** Where a page's pictures sit, and the text of each run as written in the file (with its own spaces). */
async function pictureLayer(pdfjs, page) {
  const ops = await page.getOperatorList();
  const O = pdfjs.OPS;
  const rects = [], raws = [];
  let cm = null, tm = null;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if (fn === O.transform) cm = a;
    else if (fn === O.paintImageXObject && cm && !cm[1] && !cm[2]) rects.push({ x: cm[4], y: cm[5], w: cm[0], h: cm[3] });
    else if (fn === O.setTextMatrix) tm = a && a[0] != null && a[0].length ? a[0] : a;
    else if (fn === O.showText && tm) {
      const str = (a[0] || []).map((g) => (g && typeof g === "object" ? g.unicode || "" : "")).join("");
      raws.push({ x: tm[4], y: tm[5], str });
      tm = null; // a second string after the same position starts somewhere this does not know
    }
  }
  return { rects, raws };
}

/**
 * Some notes (Milwaukee, 2026-11-15) draw every run of text as a picture and
 * lay the real text underneath in a narrower font. Each run then measures
 * shorter than it prints, so a gap opens wherever the file splits a run:
 * "Los A  ngeles", "fifth  - earliest", "(2 6th in NBA)", while a real word
 * break at a split looks no different.
 *
 * On such a page each run starts exactly where its picture starts. The
 * picture's width is how wide the run really prints, and the run's own text
 * in the file says whether it begins or ends with a space. Both are applied
 * here: widths become the printed widths, and `lead` / `trail` mark the real
 * spaces, so the row builder joins "Los A" + "ngeles" and still separates
 * "Check " + "out".
 *
 * Nothing changes unless at least 80% of the page's runs sit on a picture.
 * @returns {number} how many runs were corrected
 */
export function picturedText(items, { rects, raws }) {
  const runs = items.filter((it) => !it.space);
  if (runs.length < 10 || rects.length < runs.length * PICTURED_SHARE) return 0;
  const rectOf = (it) => rects.find((q) => Math.abs(q.x - it.x) < 0.8 && it.y >= q.y - 0.5 && it.y <= q.y + q.h);
  const found = new Map();
  for (const it of runs) { const q = rectOf(it); if (q) found.set(it, q); }
  if (found.size < runs.length * PICTURED_SHARE) return 0;
  let fixed = 0;
  const known = new Set();
  for (const [it, q] of found) {
    const raw = raws.find((r) => Math.abs(r.x - it.x) < 0.2 && Math.abs(r.y - it.y) < 0.2);
    // Only when the run is exactly one string of the file; a run pdfjs merged from several is left alone.
    if (!raw || raw.str.trim() !== it.str.trim()) continue;
    it.w = Math.max(it.w, q.w - PICTURE_PAD * it.h);
    if (/^\s/.test(raw.str)) it.lead = true;
    if (/\s$/.test(raw.str)) it.trail = true;
    known.add(it);
    fixed++;
  }
  // The space runs pdfjs made up for the gaps after corrected runs are dropped: the real spaces are known now.
  let prev = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.space) { prev = it; continue; }
    if (prev && known.has(prev) && Math.abs(prev.y - it.y) < 0.5) items.splice(i--, 1);
  }
  return fixed;
}

/**
 * Some pages draw their text twice: the same runs in the same order, the
 * second pass shifted a few points and slightly rescaled (a drop shadow;
 * Dallas 2026-11-09 player pages read "STLSSTLS", "6.16.1"). Such a page's run
 * list is [A..., A'...], where A' repeats A string for string. The repeat is
 * found by its start s: run s matches run 0, run s+1 matches run 1, and so on,
 * each copy within 6pt across and 3pt up or down. Only a repeat covering at
 * least 30% of the page, with at least 95% of its runs matching, is dropped;
 * any other page is returned unchanged.
 * @returns {number} how many runs were dropped
 */
export function dropShadowLayer(items) {
  const n = items.length;
  if (n < 40) return 0;
  const near = (a, b) => a.str === b.str && Math.abs(a.x - b.x) <= 6 && Math.abs(a.y - b.y) <= 3;
  const firsts = [];
  for (let i = 0; i < n && firsts.length < 5; i++) if (!items[i].space) firsts.push(i);
  for (const f of firsts) {
    for (let s = f + 1; s < n; s++) {
      if (!near(items[s], items[f])) continue;
      const span = Math.min(s - f, n - s); // the copy can't be longer than what precedes it
      if (span < n * 0.3) continue;
      let match = 0, last = -1;
      for (let k = 0; k < span; k++) if (near(items[s + k], items[f + k])) { match++; last = k; }
      if (match < span * 0.95) continue;
      items.splice(s, last + 1);
      return last + 1;
    }
  }
  return 0;
}

/**
 * 0.145.2: the same words drawn twice in the same spot (an outline over a fill) are read once. Detroit's notes, 11/24:
 * the stat call-outs ("5.8", "32.5", "NOTABLE", "t-2nd", "Blocks per game") were each drawn twice, and read as "5.85.8"
 * in the middle of a sentence on NBA Live. Different from dropShadowLayer (a whole page printed twice). Mutates; -> count.
 */
export function dropDoubled(items) {
  const seen = new Set();
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.space || it.str.trim().length < 2 && !/\d/.test(it.str)) continue;
    const k = `${it.str}|${Math.round(it.x * 2)}|${Math.round(it.y * 2)}|${Math.round(it.h)}`;
    if (seen.has(k)) { items.splice(i--, 1); n++; } else seen.add(k);
  }
  return n;
}

/** Group runs into visual rows (top of page first) and build text, charX, cells. */
export function buildLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    const tol = Math.max(1.5, Math.min(it.h, row ? row.h : it.h) * 0.45);
    if (row && Math.abs(row.y - it.y) <= tol) {
      row.items.push(it);
      row.h = Math.max(row.h, it.h);
    } else {
      rows.push({ y: it.y, h: it.h, items: [it] });
    }
  }
  lowerSuperscripts(rows);
  // The call-outs pulled out of sentences are left out: kept as lines of their own (or at the end of the page) they were
  // read into the paragraph around them ("…close to a block a game. 32.5 52 31 8.6 5.8.").
  return rows.map((r) => splitCallouts(r)[0]).filter((r) => r.items.some((it) => !it.space)).map((r) => assembleRow(r));
}

/**
 * 0.159.0: a raised ordinal ending belongs to the number under it. Brooklyn's notes, 11/25: "which ranks 6" with a small
 * "th" set 3pt higher, which made a row of its own ("th") and left the sentence reading "ranks 6 among NBA centers";
 * San Antonio's "the sixth active player and 23 player in NBA history". A row holding nothing but st/nd/rd/th in type
 * smaller than the row just under it, each ending starting where a number on that row stops, is put back on that row.
 * Mutates rows (top of page first); returns how many endings were moved.
 */
export function lowerSuperscripts(rows) {
  let n = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const up = rows[i], base = rows[i + 1];
    const sup = up.items.filter((it) => !it.space);
    if (!sup.length || !sup.every((it) => /^(?:st|nd|rd|th)$/.test(it.str.trim()))) continue;
    const rise = up.y - base.y;
    if (!(rise > 0 && rise <= base.h * 0.7 && up.h <= base.h * 0.85)) continue;
    const ends = base.items.filter((it) => !it.space && /\d\s*$/.test(it.str));
    const home = (it) => ends.some((b) => Math.abs(it.x - (b.x + b.w)) <= Math.max(2, base.h * 0.35));
    if (!sup.every(home)) continue;
    for (const it of sup) base.items.push({ ...it, str: it.str.trim(), y: base.y });
    rows.splice(i--, 1);
    n += sup.length;
  }
  return n;
}

/**
 * 0.145.2: a number called out in big type beside a sentence is not part of the sentence. Detroit's notes, 11/24: "5.8"
 * (30pt) and "52" (37pt) sit on the baseline of 12pt prose and read "with 5.8 Kevin Huerter tying…" on NBA Live;
 * Chicago's "19" (52pt), Brooklyn's "64.5%". A number 2.2 times taller or more than the tallest other text on a row whose
 * other text is a sentence (6+ lower-case words) is taken off the row (the caption beside it says what it is). Stat tables
 * (numbers at most twice their labels, few lower-case words) and names or headings are never touched. -> [row, removed row or null]
 */
function splitCallouts(row) {
  const callout = (it) => !it.space && /\d/.test(it.str) && /^[\d.,%+\-–]+$/.test(it.str.trim());
  const others = row.items.filter((it) => !it.space && !callout(it));
  if (!others.length) return [row, null];
  const hMax = Math.max(...others.map((it) => it.h));
  const big = row.items.filter((it) => callout(it) && it.h >= 2.2 * hMax);
  if (!big.length) return [row, null];
  const words = others.map((it) => it.str).join(" ").match(/\b[a-z]{2,}\b/g) || [];
  if (words.length < 6) return [row, null];
  const rest = row.items.filter((it) => !big.includes(it));
  return [{ ...row, h: Math.max(...rest.map((it) => it.h)), items: rest }, { y: row.y, h: Math.max(...big.map((it) => it.h)), items: big }];
}

function assembleRow(row) {
  const items = row.items.sort((a, b) => a.x - b.x);
  let text = "";
  const charX = [];
  const cells = [];
  let cell = null;
  let prevEnd = null;
  let spaceMark = false; // an explicit space glyph sits between prevEnd and the next run
  let prev = null;
  for (const it of items) {
    if (it.space) {
      // Only counts when it sits after text already on the row; a space glyph
      // does not move prevEnd, so the gap and cell rules are unchanged.
      if (prevEnd !== null && it.x >= prevEnd - 0.5) spaceMark = true;
      continue;
    }
    const s = it.str.replace(/\s+/g, " ");
    const gap = prevEnd === null ? 0 : it.x - prevEnd;
    const cellGap = Math.max(6, it.h * 0.9);
    if (cell && gap > cellGap) {
      cells.push(finishCell(cell));
      cell = null;
    }
    // Inside a number ("3,41" + "5", "29," + "496") kerning gaps are common,
    // so digits need a wider gap before they are treated as separate.
    const inNumber = /[\d,]$/.test(text) && /^\d/.test(s);
    const spaceGap = inNumber ? it.h * 0.45 : it.h * 0.12;
    // Inside a number an explicit space glyph is ignored too: the digit rule
    // above already decides, and "1,50 0" style splits must stay joined.
    // A space written in the file itself (pictured text) always counts.
    const spaced = gap > spaceGap || (spaceMark && !inNumber) || Boolean(prev && (prev.trail || it.lead));
    spaceMark = false;
    prev = it;
    if (text) {
      // A visible gap becomes a space; a big gap becomes two, so cell
      // boundaries survive in the flat string.
      const spaces = gap > cellGap ? "  " : spaced && !text.endsWith(" ") && !s.startsWith(" ") ? " " : "";
      for (const ch of spaces) { text += ch; charX.push(prevEnd ?? it.x); }
    }
    const per = s.length ? it.w / s.length : 0;
    for (let i = 0; i < s.length; i++) { text += s[i]; charX.push(it.x + per * i); }
    if (!cell) cell = { x0: it.x, x1: it.x + it.w, parts: [] };
    if (cell.parts.length && spaced) cell.parts.push(" ");
    cell.parts.push(s);
    cell.x1 = Math.max(cell.x1, it.x + it.w);
    prevEnd = it.x + it.w;
  }
  if (cell) cells.push(finishCell(cell));
  return { y: row.y, h: row.h, text, charX, cells };
}

function finishCell(c) {
  const text = c.parts.join("").replace(/\s+/g, " ").trim();
  return { x0: c.x0, x1: c.x1, cx: (c.x0 + c.x1) / 2, text };
}

/** x position of a character index in a line (clamped). */
export function xAt(line, i) {
  if (!line.charX.length) return 0;
  return line.charX[Math.max(0, Math.min(i, line.charX.length - 1))];
}

/** Plain-text dump of a page, for debugging and for sentence harvesting. */
export function pageText(page) {
  return page.lines.map((l) => l.text).join("\n");
}
