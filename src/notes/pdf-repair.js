import zlib from "node:zlib";

/**
 * Repair PDFs whose fonts carry a broken ToUnicode map.
 *
 * Seen in Boston's notes (made by macOS Quartz, 2026-11-10): each Arial Narrow / Futura
 * subset maps glyph numbers to themselves ("glyph 36 = U+0024 '$'"), while the font's own
 * cmap says glyph 36 is 'A'. Text then reads "%26721 &(/7,&6" for "BOSTON CELTICS",
 * and some glyphs (parentheses, apostrophes) come out as plain spaces.
 *
 * The fix is a standard PDF incremental update: corrected ToUnicode streams, built from
 * each font's embedded TrueType cmap, are appended after the original bytes with a new
 * xref section. Nothing in the original file is changed.
 *
 * It only acts when both are proven for a font:
 *   1. its ToUnicode map is an identity map (code -> same code) for nearly all entries, and
 *   2. its embedded font's own cmap disagrees for nearly all of them.
 * Otherwise the PDF is returned untouched (same Buffer). Never throws.
 */

const latin1 = (buf) => buf.toString("latin1");

function indexObjects(text) {
  const at = new Map();
  const re = /(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(text))) at.set(Number(m[1]), m.index + m[0].indexOf(m[1]));
  return at; // last definition wins (incremental updates)
}

function objectAt(buf, text, at, num) {
  const start = at.get(num);
  if (start == null) return null;
  const end = text.indexOf("endobj", start);
  if (end < 0) return null;
  const body = text.slice(start, end);
  const si = body.indexOf("stream");
  if (si < 0) return { dict: body, data: null };
  let ds = start + si + 6;
  if (text[ds] === "\r") ds++;
  if (text[ds] === "\n") ds++;
  let de = text.lastIndexOf("endstream", end);
  let raw = buf.subarray(ds, de);
  // trim the EOL before endstream
  while (raw.length && (raw[raw.length - 1] === 0x0a || raw[raw.length - 1] === 0x0d)) raw = raw.subarray(0, raw.length - 1);
  const dict = body.slice(0, si);
  let data = raw;
  if (/\/FlateDecode/.test(dict)) {
    try { data = zlib.inflateSync(raw); } catch { try { data = zlib.inflateRawSync(raw); } catch { return { dict, data: null } } }
  } else if (/\/Filter/.test(dict)) return { dict, data: null };
  return { dict, data };
}

/** TrueType cmap (3,1) or (0,x) format 4 -> Map(glyph -> codepoint). Reads only bytes present. */
export function glyphToUnicode(font) {
  const out = new Map();
  try {
    const v = new DataView(font.buffer, font.byteOffset, font.byteLength);
    const n = v.getUint16(4);
    let cmap = -1;
    for (let i = 0; i < n; i++) {
      const r = 12 + i * 16;
      if (String.fromCharCode(font[r], font[r + 1], font[r + 2], font[r + 3]) === "cmap") cmap = v.getUint32(r + 8);
    }
    if (cmap < 0) return out;
    const subs = v.getUint16(cmap + 2);
    const order = [];
    for (let i = 0; i < subs; i++) {
      const pid = v.getUint16(cmap + 4 + i * 8), eid = v.getUint16(cmap + 6 + i * 8), off = cmap + v.getUint32(cmap + 8 + i * 8);
      if (v.getUint16(off) === 4 && (pid === 3 && eid === 1 || pid === 0)) order.push(off);
    }
    for (const off of order) {
      const segX2 = v.getUint16(off + 6), ends = off + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = v.getUint16(ends + s * 2), start = v.getUint16(starts + s * 2), delta = v.getInt16(deltas + s * 2), ro = v.getUint16(ranges + s * 2);
        for (let c = start; c <= end && c < 0xffff; c++) {
          let g;
          if (ro === 0) g = (c + delta) & 0xffff;
          else {
            const p = ranges + s * 2 + ro + (c - start) * 2;
            if (p + 2 > font.byteLength) continue;
            g = v.getUint16(p);
            if (g) g = (g + delta) & 0xffff;
          }
          if (g && !out.has(g)) out.set(g, c);
        }
      }
      if (out.size) break;
    }
  } catch { /* partial is fine */ }
  return out;
}

/** <code> -> unicode pairs from a ToUnicode CMap (bfchar and bfrange). */
function readToUnicode(text) {
  const map = new Map();
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(m[1], 16), parseInt(m[2], 16));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const a = parseInt(m[1], 16), b = parseInt(m[2], 16), u = parseInt(m[3], 16);
      for (let c = a; c <= b && c - a < 4096; c++) map.set(c, u + (c - a));
    }
  }
  return map;
}

function cmapStream(pairs) {
  const hex = (n) => n.toString(16).toUpperCase().padStart(4, "0");
  const lines = ["/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def", "/CMapType 2 def", "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange"];
  for (let i = 0; i < pairs.length; i += 100) {
    const chunk = pairs.slice(i, i + 100);
    lines.push(`${chunk.length} beginbfchar`, ...chunk.map(([g, u]) => `<${hex(g)}> <${hex(u)}>`), "endbfchar");
  }
  lines.push("endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end");
  return lines.join("\n");
}

/**
 * @param {Buffer} buf a PDF
 * @returns {{ buf: Buffer, repaired: string[], why?: string }}
 */
export function repairToUnicode(buf) {
  try {
    const text = latin1(buf);
    if (!text.includes("/ToUnicode") || !text.includes("/FontFile2")) return { buf, repaired: [] };
    const at = indexObjects(text);
    const fixes = []; // { num, gen, stream, name }
    for (const m of text.matchAll(/\/BaseFont\s*\/([^\s/<>\[\]()]+)/g)) {
      const start = text.lastIndexOf("<<", m.index), end = text.indexOf(">>", m.index);
      const dict = text.slice(start, end);
      if (!/\/Subtype\s*\/Type0/.test(dict) || !/\/Identity-H/.test(dict)) continue;
      const tu = /\/ToUnicode\s+(\d+)\s+(\d+)\s+R/.exec(dict);
      const df = /\/DescendantFonts\s*\[?\s*(\d+)\s+\d+\s+R/.exec(dict);
      if (!tu || !df || fixes.some((f) => f.num === Number(tu[1]))) continue;
      const cid = objectAt(buf, text, at, Number(df[1]));
      const fdRef = cid && /\/FontDescriptor\s+(\d+)\s+\d+\s+R/.exec(cid.dict);
      const fd = fdRef && objectAt(buf, text, at, Number(fdRef[1]));
      const ffRef = fd && /\/FontFile2\s+(\d+)\s+\d+\s+R/.exec(fd.dict);
      const ff = ffRef && objectAt(buf, text, at, Number(ffRef[1]));
      const tuObj = objectAt(buf, text, at, Number(tu[1]));
      if (!ff?.data || !tuObj?.data) continue;
      if (cid.dict.match(/\/CIDToGIDMap\s+\d+\s+\d+\s+R/)) continue; // codes aren't glyph ids: not this case
      const current = readToUnicode(latin1(tuObj.data));
      const truth = glyphToUnicode(ff.data);
      if (current.size < 10 || truth.size < 10) continue;
      let identity = 0, disagree = 0, both = 0;
      for (const [code, u] of current) {
        if (u === code) identity++;
        const t = truth.get(code);
        if (t != null) { both++; if (t !== u) disagree++; }
      }
      // Proven broken: >= 80% identity entries, and the font itself disagrees on >= 80% of shared codes.
      if (identity / current.size < 0.8 || !both || disagree / both < 0.8) continue;
      const pairs = [...current.keys()].filter((c) => truth.has(c)).sort((a, b) => a - b).map((c) => [c, truth.get(c)]);
      fixes.push({ num: Number(tu[1]), gen: Number(tu[2]), stream: cmapStream(pairs), name: m[1] });
    }
    if (!fixes.length) return { buf, repaired: [] };

    // Incremental update: new versions of the ToUnicode objects, new xref, trailer with /Prev.
    const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text.slice(-1024));
    const trailer = /trailer\s*<<([\s\S]*?)>>\s*startxref/.exec(text.slice(text.lastIndexOf("trailer")));
    if (!sx || !trailer) return { buf, repaired: [], why: "no classic trailer (xref stream): left as is" };
    const size = /\/Size\s+(\d+)/.exec(trailer[1]);
    const root = /\/Root\s+(\d+\s+\d+\s+R)/.exec(trailer[1]);
    const info = /\/Info\s+(\d+\s+\d+\s+R)/.exec(trailer[1]);
    const id = /\/ID\s*(\[[^\]]*\])/.exec(trailer[1]);
    if (!size || !root) return { buf, repaired: [], why: "trailer without /Size or /Root: left as is" };
    const parts = [buf, Buffer.from(buf[buf.length - 1] === 0x0a ? "" : "\n", "latin1")];
    let offset = parts.reduce((a, b) => a + b.length, 0);
    const offsets = [];
    for (const f of fixes) {
      const body = Buffer.from(`${f.num} ${f.gen} obj\n<< /Length ${Buffer.byteLength(f.stream, "latin1")} >>\nstream\n${f.stream}\nendstream\nendobj\n`, "latin1");
      offsets.push({ num: f.num, gen: f.gen, offset });
      parts.push(body);
      offset += body.length;
    }
    const xref = ["xref"];
    for (const o of offsets.sort((a, b) => a.num - b.num)) xref.push(`${o.num} 1`, `${String(o.offset).padStart(10, "0")} ${String(o.gen).padStart(5, "0")} n `);
    xref.push("trailer", `<< /Size ${size[1]} /Root ${root[1]}${info ? ` /Info ${info[1]}` : ""}${id ? ` /ID ${id[1]}` : ""} /Prev ${sx[1]} >>`, "startxref", String(offset), "%%EOF", "");
    parts.push(Buffer.from(xref.join("\n"), "latin1"));
    return { buf: Buffer.concat(parts), repaired: fixes.map((f) => f.name) };
  } catch (e) {
    return { buf, repaired: [], why: `repair skipped: ${e.message}` };
  }
}
