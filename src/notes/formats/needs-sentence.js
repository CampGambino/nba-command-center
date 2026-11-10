import { num } from "../stats.js";
import { blocks } from "../narrative.js";
import { statWithScope, ordinal, trimLeadIn } from "./common.js";

/**
 * "X needs N ..." sentences in prose.
 * Seen in (2026-11-10):
 *   Dallas   "P.J. Washington Jr. needs 12 assists (988) to reach 1,000 career assists."
 *   Houston  "Kevin Durant needs 816 points to pass Kobe Bryant for 4th on the
 *             all-time scoring list."
 * Only sentences that name the player themselves are read (a bio line under a
 * heading, "...needs 816 points to pass Kobe Bryant for 4th.", is left to the
 * narrative panel). Each sentence is read once even if printed on two pages.
 */
const NAME = String.raw`((?:\p{Lu}[\p{L}’'.\-]*\s+){1,4}?\p{Lu}[\p{L}’'.\-]*)`;
const REACH = new RegExp(String.raw`${NAME}\s+needs\s+([\d,]+)\s+([\p{L}\d\- ]+?)\s*(?:\(\s*([\d,]+)\s*\))?\s+to\s+reach\s+([\d,]+)\s+([\p{L}\d\- ]+?)\s*(?:[.;]|$)`, "gu");
const PASS = new RegExp(String.raw`${NAME}\s+needs\s+([\d,]+)\s+([\p{L}\d\- ]+?)\s+to\s+(?:pass|surpass)\s+${NAME}\s+for\s+(\d{1,3}(?:st|nd|rd|th))\b([^.;]*)`, "gu");

export function readNeedsSentence(doc, { team } = {}) {
  const out = [];
  const seen = new Set();
  for (const b of blocks(doc)) {
    for (const m of b.text.matchAll(REACH)) {
      const player = trimLeadIn(m[1]);
      if (!player) continue;
      const key = `r|${player}|${m[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const counted = statWithScope(m[3]), named = statWithScope(m[6]);
      const need = num(m[2]), target = num(m[5]), printed = num(m[4]);
      out.push({
        format: "needs-sentence", page: b.page, player,
        statRaw: m[6], stat: named.stat || counted.stat,
        statMismatch: counted.stat && named.stat && counted.stat !== named.stat ? `counts "${m[3]}" toward "${m[6]}"` : null,
        target, current: printed ?? (target != null && need != null ? target - need : null), needStated: need,
        scope: named.scope || "career",
        text: m[0].slice(m[0].indexOf(player)).replace(/\s+/g, " ").trim(),
      });
    }
    for (const m of b.text.matchAll(PASS)) {
      const player = trimLeadIn(m[1]);
      if (!player) continue;
      const key = `p|${player}|${m[4]}|${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const rest = m[6] || "";
      const sw = statWithScope(m[3]);
      const franchise = /\bfranchise\b/i.test(rest) || statWithScope(rest).scope === "franchise";
      const nba = /\bNBA\b/.test(rest) || /\bon the all-time\b/i.test(rest);
      out.push({
        format: "needs-sentence", page: b.page, player, kind: "pass",
        statRaw: m[3], stat: sw.stat,
        target: null, current: null, needStated: num(m[2]),
        passing: { player: m[4].trim(), total: null, rank: ordinal(m[5]), forWhat: `${m[5]}${rest.trim() ? " " + rest.trim() : ""}` },
        scope: franchise ? "franchise" : nba ? "nba" : "unknown",
        text: m[0].slice(m[0].indexOf(player)).replace(/\s+/g, " ").trim(),
      });
    }
  }
  return out;
}
