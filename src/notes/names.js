/**
 * Player-name handling shared by every format reader.
 *
 * Notes print names as "DONOVAN MITCHELL", "Donovan Mitchell", "D. MITCHELL",
 * "#45 Donovan Mitchell", "Luka Dončić". `nameKey` reduces all of these to a
 * comparable key; `sameName` also lets an initial match a full first name.
 */

const STOP_WORDS = new Set([
  "MILESTONES", "MILESTONE", "REGULAR", "SEASON", "CAREER", "TRACKER", "NOTES", "STAT",
  "CURRENT", "TOTAL", "PLAYER", "HIGHLIGHT", "INDICATES", "UPCOMING", "FRANCHISE",
  "LEADER", "BOARDS", "RANKINGS", "ALL-TIME", "RECENT", "ACCOMPLISHMENTS", "GAME",
  "GAMES", "POINTS", "REBOUNDS", "ASSISTS", "STEALS", "BLOCKS", "PLAYOFFS", "SERIES",
  "HISTORY", "RECORD", "SCHEDULE", "STARTERS", "NBA", "TEAM", "VS", "AT",
]);

export function cleanName(s) {
  return String(s || "")
    .replace(/^#\d{1,2}\s+/, "")
    .replace(/\*+$/, "")
    .replace(/\s+/g, " ")
    .replace(/[\s,;:]+$/, "")
    .trim();
}

export function nameKey(s) {
  return cleanName(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\.?$/i, "")
    .replace(/[^a-zA-Z. ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** "d. mitchell" matches "donovan mitchell"; full names must match exactly. */
export function sameName(a, b) {
  const ka = nameKey(a), kb = nameKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const pa = ka.split(" "), pb = kb.split(" ");
  if (pa[pa.length - 1] !== pb[pb.length - 1]) return false;
  const fa = pa[0].replace(/\.$/, ""), fb = pb[0].replace(/\.$/, "");
  if (pa.length !== pb.length) return false;
  return (fa.length === 1 && fb.startsWith(fa)) || (fb.length === 1 && fa.startsWith(fb));
}

/** Title-case an all-caps name for display: "DE’AARON FOX" -> "De’Aaron Fox". */
export function displayName(s) {
  const c = cleanName(s);
  if (c !== c.toUpperCase()) return c;
  return c
    .toLowerCase()
    .replace(/(^|[\s\-’'.])(\p{Ll})/gu, (m, p, ch) => p + ch.toUpperCase())
    .replace(/\bMc([a-z])/g, (m, ch) => "Mc" + ch.toUpperCase());
}

/**
 * Does a cell look like a player-name heading ("JARRETT ALLEN", "#40 HARRISON BARNES",
 * "CRAIG PORTER JR.")? All caps, 2-4 words, no stop words.
 */
export function looksLikeNameHeading(text) {
  const t = String(text || "").trim();
  const m = t.match(/^(#\d{1,2}\s+)?(\p{Lu}[\p{Lu}’'.\-]*(?:\s+\p{Lu}[\p{Lu}’'.\-]*){1,3})$/u);
  if (!m) return false;
  const words = m[2].split(/\s+/);
  if (words.some((w) => STOP_WORDS.has(w.replace(/[.:]/g, "")))) return false;
  return words.filter((w) => w.replace(/[^A-Z]/g, "").length >= 2).length >= 2;
}
