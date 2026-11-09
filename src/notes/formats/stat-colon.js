import { HeadingTracker } from "./headings.js";
import { xAt } from "../pdf-layout.js";
import { normStat, num } from "../stats.js";

/**
 * "STAT: target   current" rows under "#40 HARRISON BARNES" headings.
 * Seen in: San Antonio ("PTS: 15,000   14,613").
 * Only accepted under a heading and when the target is a round number, so box
 * score lines like "PTS: 32 vs NYK" are never mistaken for milestones.
 */
const RE = /\b([A-Z0-9]{2,4}):\s*([\d,]{2,7})\s+([\d,]{1,7})(?=\s|$)/g;

export function readStatColon(doc) {
  const out = [];
  for (const page of doc.pages) {
    const heads = new HeadingTracker();
    for (const line of page.lines) {
      if (heads.scan(line)) continue;
      for (const m of line.text.matchAll(RE)) {
        const target = num(m[2]), current = num(m[3]);
        const stat = normStat(m[1]);
        if (!stat || target == null || current == null) continue;
        if (target % 25 !== 0) continue;
        const x0 = xAt(line, m.index), x1 = xAt(line, m.index + m[0].length - 1);
        const h = heads.owner(x0, x1);
        if (!h) continue;
        out.push({
          format: "stat-colon",
          page: page.page,
          player: h.name,
          statRaw: m[1],
          stat,
          target,
          current,
          needStated: null,
          scope: "career",
          text: m[0].replace(/\s+/g, " ").trim(),
        });
      }
    }
  }
  return out;
}
