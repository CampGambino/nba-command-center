import { TEAMS } from "../../teams.js";
import { normStat } from "../stats.js";

/**
 * Helpers shared by the table/row readers added for the 2026-11-10 layouts
 * (MIL, PHI, IND, ORL, BKN, DAL, HOU, MIN).
 */

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Nicknames, singular or plural ("as a Maverick", "Pacers points"), plus short forms.
const NICKS = [...new Set(Object.values(TEAMS).flatMap((t) => [t.nick, ...(t.alt || [])]).map((n) => n.replace(/s$/, "")))];
const NICK_RE = new RegExp(`\\b(?:${NICKS.map(esc).join("|")})s?\\b`, "gi");

/**
 * "1,000 career assists" / "5,000 Pacers points" / "Career Offensive Rebounds"
 * -> { stat, statRaw, scope }. scope: "career", "franchise", or null when the
 * wording doesn't say (the tracker then cross-checks it as a career total).
 */
export function statWithScope(raw) {
  let s = String(raw || "").replace(/\s+/g, " ").trim();
  let scope = null;
  if (/\bcareer\b/i.test(s)) { scope = "career"; s = s.replace(/\bcareer\b/gi, " "); }
  NICK_RE.lastIndex = 0;
  if (NICK_RE.test(s)) { scope = scope ?? "franchise"; NICK_RE.lastIndex = 0; s = s.replace(NICK_RE, " "); }
  s = s.replace(/\s+/g, " ").trim();
  return { stat: normStat(s), statRaw: s, scope };
}

/** "3rd" -> 3, "10th" -> 10, anything else -> null. */
export function ordinal(s) {
  const m = String(s || "").match(/^(\d{1,3})(?:st|nd|rd|th)$/i);
  return m ? Number(m[1]) : null;
}

/** "9 5 % C O M P L E T E" -> "95%COMPLETE": letter-spaced display type, squeezed. */
export const squeeze = (s) => String(s || "").replace(/\s+/g, "");

/** Text set as spaced single characters ("P O I N T S"). */
export const isLetterSpaced = (s) => {
  // Mostly single characters with spaces between; kerned pairs ("P L AY E D") allowed.
  const t = String(s || "").trim().split(/\s+/);
  return t.length >= 4 && t.every((w) => w.length <= 2) && t.filter((w) => w.length === 1).length >= t.length * 0.6;
};

/**
 * A person's name written before a verb ("MAMBA MENTALITY Kevin Durant needs"):
 * drop leading all-caps words of 3+ letters (headings) and leading filler, keep
 * suffixes. Returns null unless at least two words remain.
 */
export function trimLeadIn(name) {
  const words = String(name || "").trim().split(/\s+/);
  while (words.length > 2 && (/^[A-Z’'\-]{3,}$/.test(words[0]) && !/^(II|III|IV)$/.test(words[0]) || /^(The|In|With|And|But|Also|Meanwhile|Forward|Guard|Center|Rookie)$/.test(words[0]))) words.shift();
  return words.length >= 2 ? words.join(" ") : null;
}
