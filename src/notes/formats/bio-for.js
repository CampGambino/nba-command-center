import { num, normStat } from "../stats.js";
import { cleanName, displayName } from "../names.js";

/**
 * Player bio pages with an "UPCOMING/RECENT MILESTONES:" column.
 * Seen in: Minnesota (2026-11-08 notes, one player per page):
 *
 *   DONTE DIVINCENZO • #0
 *   ...                       UPCOMING/RECENT MILESTONES:
 *                             …2 GAMES FOR 500
 *                             …78 FGM FOR 2000
 *                             100TH REBOUND 10/23 @ ORL     (recent: already reached)
 *
 * Upcoming entries start with an ellipsis: "…N STAT FOR TARGET". The player is
 * the "NAME • #NN" heading on the same page above the column.
 */
const HEADING = /^(.+?)\s*•\s*#\d{1,2}$/;
const ENTRY = /^(?:…|\.{2,})\s*([\d,]+)\s+(.+?)\s+FOR\s+([\d,]+)$/i;

export function readBioFor(doc) {
  const milestones = [], problems = [];
  for (const page of doc.pages) {
    let colX = null, colY = null;
    const heads = [];
    for (const line of page.lines) {
      for (const c of line.cells) {
        const h = c.text.trim().match(HEADING);
        if (h) heads.push({ y: line.y, name: displayName(cleanName(h[1])) });
        if (/^UPCOMING\s*\/\s*RECENT MILESTONES:?$/i.test(c.text.trim())) { colX = c.x0; colY = line.y; }
      }
    }
    if (colX == null) continue;
    const owner = heads.filter((h) => h.y > colY).sort((a, b) => a.y - b.y)[0];
    if (!owner) { problems.push({ page: page.page, problem: "milestones column with no player heading above it" }); continue; }
    for (const line of page.lines) {
      if (line.y >= colY || colY - line.y > 120) continue;
      for (const c of line.cells) {
        if (c.x0 < colX - 15) continue;
        const m = c.text.trim().match(ENTRY);
        if (!m) continue;
        const need = num(m[1]), target = num(m[3]);
        milestones.push({
          format: "bio-for", page: page.page, player: owner.name,
          statRaw: m[2], stat: normStat(m[2]),
          target, current: target != null && need != null ? target - need : null, needStated: need,
          scope: "career", text: `${owner.name}: ${c.text.trim()}`,
        });
      }
    }
  }
  return { milestones, problems };
}
