/**
 * One spelling per player (0.145.0).
 *
 * The consistency audit, 11/24: the same player was spelled two ways on one page ("Jokić (3× MVP): 11 assists…" at #2 in
 * the briefing, "Nikola Jokic has 3 games…" at #6). ESPN's box scores write names without accents; the NBA's Tip-Off Guide
 * and the records built from it write them with. Where any of our reference files (src/data/*.json) spell a name with
 * accents, that spelling is used for every line built from the box scores too. Matching across sources already ignores
 * accents (nameKey, strictKey), so only what is printed changes.
 */
const plain = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/ł/g, "l").replace(/Ł/g, "L").replace(/ø/g, "o").replace(/đ/g, "d").replace(/Đ/g, "D");

/** Accented names found in JSON text -> Map(plain spelling -> accented spelling). Only "First Last"-shaped strings. */
export function accentMap(texts) {
  const out = new Map();
  for (const t of texts) {
    for (const m of String(t).matchAll(/"([A-ZÀ-ÖØ-ÞŠŽČĆĐŁŞ][^"\d,;:()]{1,40})"/g)) {
      const w = m[1].trim();
      if (!/\s/.test(w) || w.split(/\s+/).length > 4 || plain(w) === w || !/^[\p{L}.' -]+$/u.test(w)) continue;
      const k = plain(w);
      if (!out.has(k)) out.set(k, w);
    }
  }
  return out;
}

/** names ({ id: name }) with the accented spelling where one is known. */
export function withAccents(names, map) {
  if (!map || !map.size) return { ...(names || {}) };
  return Object.fromEntries(Object.entries(names || {}).map(([id, n]) => [id, map.get(n) || n]));
}

/** A line of text with each known plain spelling replaced by the accented one (whole names only). */
export function accentText(text, map) {
  if (!map || !map.size || !text) return text;
  let t = String(text);
  for (const [k, v] of map) if (t.includes(k)) t = t.replace(new RegExp(`(?<![\\p{L}])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "gu"), v);
  return t;
}

/** The map with each accented surname too ("Jokic" -> "Jokić"), for lines that name a player by his last name. */
export function withSurnames(map) {
  const out = new Map(map);
  for (const [k, v] of map) { const a = k.split(/\s+/).pop(), b = v.split(/\s+/).pop(); if (a !== b && a.length >= 4 && !out.has(a)) out.set(a, b); }
  return out;
}

/** For matching spellings: accents, periods, apostrophes (straight or curly) and spacing ignored; suffixes kept. */
export const spellKey = (n) => plain(n).toLowerCase().replace(/[.'’`]/g, "").replace(/[^a-z0-9 -]/g, "").replace(/\s+/g, " ").trim();

/** The spelling the box-score pages print, by spellKey ({ id: name } after withAccents). */
export function canonNames(names) {
  const out = new Map();
  for (const n of Object.values(names || {})) { const k = spellKey(n); if (k && !out.has(k)) out.set(k, n); }
  return out;
}

/**
 * Records-shaped data (records.json): who, the passed player's name, last and the line's text, in the spelling the rest of
 * the site prints: the box scores' (with the accents of withAccents), so "A.J. Green" (the Guide) is "AJ Green" and
 * "De’Aaron Fox" is "De'Aaron Fox". Names only in the Guide (retired players) keep its spelling, accented by `map`. Mutates.
 */
export function accentRecords(o, map, canon = null) {
  if (!o || typeof o !== "object") return o;
  const swaps = new Map();
  const fix = (n) => { const c = canon?.get(spellKey(n)) || map?.get(n) || n; if (c !== n) swaps.set(n, c); return c; };
  const names = (x) => { if (!x || typeof x !== "object") return; if (Array.isArray(x)) { x.forEach(names); return; }
    for (const [k, v] of Object.entries(x)) { if (typeof v === "string" && (k === "who" || k === "name" || k === "player")) x[k] = fix(v); else if (v && typeof v === "object") names(v); } };
  names(o);
  const all = new Map([...(map || []), ...swaps]);
  const texts = (x) => { if (!x || typeof x !== "object") return; if (Array.isArray(x)) { x.forEach(texts); return; }
    for (const [k, v] of Object.entries(x)) { if (typeof v === "string" && (k === "last" || k === "text")) x[k] = accentText(v, all); else if (v && typeof v === "object") texts(v); } };
  texts(o);
  return o;
}
