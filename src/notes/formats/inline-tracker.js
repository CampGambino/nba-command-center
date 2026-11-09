import { normStat, num } from "../stats.js";
import { displayName } from "../names.js";

/**
 * "PLAYER: target Stat (current)" entries strung together with "|".
 * Seen in: Phoenix ("DEVIN BOOKER: 19,000 Points (18,322) | DILLON BROOKS: 2,000 Rebounds (1,828)").
 * Read only inside a section whose heading mentions a milestone tracker.
 */
const RE = /(\p{Lu}[\p{Lu}’'.\-]+(?:\s+\p{Lu}[\p{Lu}’'.\-]+){1,3}):\s*([\d,]{2,7})\s+([A-Za-z0-9][A-Za-z0-9\- ]{0,20}?)\s*\(\s*([\d,]{1,7})\s*\)/gu;

export function readInlineTracker(doc) {
  const out = [];
  for (const page of doc.pages) {
    let inSection = false, linesSince = 0;
    for (const line of page.lines) {
      if (/MILESTONE TRACKER|MILESTONES? WATCH|APPROACHING MILESTONES/i.test(line.text)) {
        inSection = true; linesSince = 0; continue;
      }
      if (!inSection) continue;
      const matches = [...line.text.matchAll(RE)];
      if (!matches.length) { if (++linesSince > 1) inSection = false; continue; }
      linesSince = 0;
      for (const m of matches) {
        const stat = normStat(m[3]);
        if (!stat) continue;
        out.push({
          format: "inline-tracker",
          page: page.page,
          player: displayName(m[1]),
          statRaw: m[3].trim(),
          stat,
          target: num(m[2]),
          current: num(m[4]),
          needStated: null,
          scope: "career",
          text: m[0].replace(/\s+/g, " ").trim(),
        });
      }
    }
  }
  return out;
}
