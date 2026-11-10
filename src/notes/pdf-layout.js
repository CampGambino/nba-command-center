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
    pages.push({ page: p, width: viewport.width, height: viewport.height, lines: buildLines(items), ...(shadow ? { shadowDropped: shadow } : {}) });
    page.cleanup?.();
  }
  const pageCount = doc.numPages;
  await doc.destroy?.();
  return { pageCount, pages, repairedFonts: fixed.repaired };
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
  return rows.filter((r) => r.items.some((it) => !it.space)).map((r) => assembleRow(r));
}

function assembleRow(row) {
  const items = row.items.sort((a, b) => a.x - b.x);
  let text = "";
  const charX = [];
  const cells = [];
  let cell = null;
  let prevEnd = null;
  let spaceMark = false; // an explicit space glyph sits between prevEnd and the next run
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
    const spaced = gap > spaceGap || (spaceMark && !inNumber);
    spaceMark = false;
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
