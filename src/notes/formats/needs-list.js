import { HeadingTracker } from "./headings.js";
import { xAt } from "../pdf-layout.js";
import { normStat, num } from "../stats.js";

/**
 * "Target STAT (current)  Needs N" lines grouped under player-name headings.
 * Seen in: Cleveland ("9,000 PTS (8,254)   Needs 746" under "JARRETT ALLEN").
 */
const RE = /([\d,]{1,7})\s+([A-Za-z0-9][A-Za-z0-9\- ]{0,11}?)\s*\(\s*([\d,]{1,7})\s*\)\s*Needs\s+([\d,]{1,7})/gi;

export function readNeedsList(doc) {
  const out = [];
  for (const page of doc.pages) {
    const heads = new HeadingTracker();
    for (const line of page.lines) {
      if (heads.scan(line)) continue;
      for (const m of line.text.matchAll(RE)) {
        const x0 = xAt(line, m.index), x1 = xAt(line, m.index + m[0].length - 1);
        const h = heads.owner(x0, x1);
        out.push({
          format: "needs-list",
          page: page.page,
          player: h?.name ?? null,
          statRaw: m[2].trim(),
          stat: normStat(m[2]),
          target: num(m[1]),
          current: num(m[3]),
          needStated: num(m[4]),
          scope: "career",
          text: m[0].replace(/\s+/g, " ").trim(),
        });
      }
    }
  }
  return out;
}
