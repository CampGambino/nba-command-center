import { num } from "../stats.js";
import { cleanName } from "../names.js";
import { statWithScope, ordinal } from "./common.js";

/**
 * Player blocks of "Needs ..." rows. Seen in: Orlando (2026-11-10, pp. 10-11).
 *
 *   PAOLO BANCHERO                      NEXT CAREER MILESTONE
 *   378 three-point field goals made    Needs 22 three-pointers to reach 400
 *                                       Needs 140 three-pointers to reach 600
 *
 *   PAOLO BANCHERO                      MAGIC ALL-TIME LIST
 *   2,076 field goals made              Needs 346 field goals for 10th all-time (Scott: 2,421)
 *                                       Needs 435 field goals for 9th all-time (Turkoglu: 2,510)
 *
 * The left cell is the player's current total; a row without one continues the
 * row above it. Both columns are kept and checked against each other:
 * current + need must equal the target (round) or the passed total + 1 (list).
 */
const HEAD = /^(NEXT CAREER MILESTONES?|(?:\p{Lu}[\p{L}]+\s+)?ALL-TIME LIST)$/iu;
const REACH = /^Needs\s+([\d,]+)\s+(.+?)\s+to\s+reach\s+([\d,]+)\.?$/i;
const LIST = /^Needs\s+([\d,]+)\s+(.+?)\s+for\s+(\d{1,3}(?:st|nd|rd|th))\s+all-time\s*\(\s*(.+?):\s*([\d,]+)\s*\)\.?$/i;
const TOTAL = /^([\d,]+)\s+(.+)$/;

export function readNeedsRows(doc) {
  const milestones = [], problems = [];
  for (const page of doc.pages) {
    let block = null; // { player, list }
    let left = null;  // last current-total cell: { current, stat, statRaw }
    for (const line of page.lines) {
      const head = line.cells.find((c) => HEAD.test(c.text.trim()));
      if (head) {
        const name = line.cells.filter((c) => c !== head && c.x1 <= head.x0).map((c) => c.text).join(" ").trim();
        block = name ? { player: cleanName(name), listScope: /\bNBA\b/i.test(head.text) ? "nba" : "franchise" } : null;
        left = null;
        if (!name) problems.push({ page: page.page, problem: "milestone block heading without a player name", text: line.text });
        continue;
      }
      if (!block) continue;
      const needsCell = line.cells.find((c) => /^Needs\s+\d/i.test(c.text.trim()));
      if (!needsCell) { block = null; left = null; continue; } // block ended
      const leftCell = line.cells.find((c) => c.x1 <= needsCell.x0 && TOTAL.test(c.text.trim()));
      if (leftCell) {
        const t = leftCell.text.trim().match(TOTAL);
        left = { current: num(t[1]), ...statWithScope(t[2]) };
      }
      const text = `${block.player}: ${leftCell ? leftCell.text.trim() + " | " : ""}${needsCell.text.trim()}`;
      const s = needsCell.text.trim();

      const r = s.match(REACH);
      const l = !r && s.match(LIST);
      if (!r && !l) { problems.push({ page: page.page, problem: "milestone row not understood", text }); continue; }
      const need = num((r || l)[1]);
      const said = statWithScope((r || l)[2]);
      // The left column names the stat fully ("field goals attempted"); the needs
      // column shortens it ("attempts"). Use the full name; flag a real conflict.
      const stat = left?.stat || said.stat;
      const statMismatch = left?.stat && said.stat && left.stat !== said.stat ? `"${left.statRaw}" beside "${said.statRaw}"` : null;
      if (r) {
        const target = num(r[3]);
        milestones.push({
          format: "needs-rows", page: page.page, player: block.player,
          statRaw: left?.statRaw || said.statRaw, stat, statMismatch,
          target, current: left ? left.current : target - need, needStated: need,
          scope: "career", text,
        });
      } else {
        const total = num(l[5]);
        milestones.push({
          format: "needs-rows", page: page.page, player: block.player,
          statRaw: left?.statRaw || said.statRaw, stat, statMismatch,
          kind: "pass", target: total + 1, current: left ? left.current : null, needStated: need,
          scope: block.listScope,
          passing: { player: l[4].trim(), total, rank: ordinal(l[3]), forWhat: `${l[3]} all-time` },
          text,
        });
      }
    }
  }
  return { milestones, problems };
}
