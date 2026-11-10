import { num } from "../stats.js";
import { cleanName } from "../names.js";
import { statWithScope, ordinal } from "./common.js";

/**
 * Milestone tables with a header row naming the columns.
 * Seen in (2026-11-10):
 *   Milwaukee     Player | Category | Current # | Milestone # | Needs
 *                 "Myles Turner | Points | 9,948 | 10,000 | 52 points"
 *   Philadelphia  PLAYER | MILESTONE | NEEDED
 *                 "Dominick Barlow | 100 Career Steals | 6"
 *                 "LeBron James | 12,092 Career Assists (3rd all-time in NBA History) | 16"
 *                 (a milestone cell can wrap onto the lines above and below its row)
 *   Indiana       PLAYER | MILESTONE | NEEDS/ACCOMPLISHED
 *                 "Tyrese Haliburton | 6,000 career points | Accomplished, 10/25",
 *                 then rows with no name that belong to the player above.
 *
 * Cells go to the header column whose center is nearest (tables are laid out
 * centered or left-aligned, never far from their header); cells far from every
 * header column belong to something else on the page (Indiana prints the table
 * beside a prose column) and are ignored. Anything that doesn't read cleanly is
 * reported, not guessed.
 */
const COLS = [
  ["player", /^player$/i],
  ["category", /^category$/i],
  ["current", /^current\s*#?$/i],
  ["milestone", /^milestone\s*#?$/i],
  ["needs", /^(needs|needed|needs\s*\/\s*accomplished)$/i],
];
const MAX_DIST = 110;

function headerOf(line) {
  const cols = [];
  for (const c of line.cells) {
    const hit = COLS.find(([, re]) => re.test(c.text.trim()));
    if (hit) cols.push({ key: hit[0], cx: c.cx, x0: c.x0 });
  }
  const keys = cols.map((c) => c.key);
  if (!keys.includes("player") || !keys.includes("milestone") || !keys.includes("needs")) return null;
  // Nothing else inside the header's span (text beside the table is fine).
  const lo = Math.min(...cols.map((c) => c.x0)), hi = Math.max(...cols.map((c) => c.cx));
  const stray = line.cells.filter((c) => !COLS.some(([, re]) => re.test(c.text.trim())) && c.cx > lo && c.cx < hi);
  if (stray.length) return null;
  return cols;
}

function assign(line, cols) {
  const row = {};
  for (const c of line.cells) {
    let best = null, d = Infinity;
    for (const col of cols) { const dd = Math.abs(c.cx - col.cx); if (dd < d) { d = dd; best = col; } }
    if (!best || d > MAX_DIST) continue;
    row[best.key] = row[best.key] ? `${row[best.key]} ${c.text}` : c.text;
  }
  return row;
}

export function readColumnTable(doc) {
  const milestones = [], problems = [];
  for (const page of doc.pages) {
    const lines = page.lines;
    for (let i = 0; i < lines.length; i++) {
      const cols = headerOf(lines[i]);
      if (!cols) continue;
      // Wording above the table: "...nears his next career milestone".
      const lead = lines.slice(Math.max(0, i - 4), i).map((l) => l.text).join(" ");
      const tableScope = /\bcareer\b/i.test(lead) ? "career" : null;

      // Rows: every following line with something in the needs column; a line
      // with only milestone text (a wrapped cell) joins the nearest such row.
      const rows = [];
      const loose = [];
      let lastY = lines[i].y;
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (lastY - line.y > 40) break; // the table has ended
        const r = assign(line, cols);
        const keys = Object.keys(r);
        if (!keys.length) continue; // only text beside the table on this line
        if (r.needs) { rows.push({ y: line.y, ...r }); lastY = line.y; }
        else if (keys.length === 1 && r.milestone) { loose.push({ y: line.y, text: r.milestone }); lastY = line.y; }
        else if (rows.length) break; // a different block starts
      }
      for (const l of loose) {
        const near = rows.reduce((b, r) => (Math.abs(r.y - l.y) < Math.abs((b?.y ?? Infinity) - l.y) ? r : b), null);
        if (!near || Math.abs(near.y - l.y) > 10) continue;
        near.milestone = l.y > near.y ? `${l.text} ${near.milestone || ""}`.trim() : `${near.milestone || ""} ${l.text}`.trim();
      }

      let player = null;
      for (const r of rows) {
        if (r.player) player = cleanName(r.player);
        const text = [r.player ? null : player, ...["player", "category", "current", "milestone", "needs"].map((k) => r[k])].filter(Boolean).join(" | ");
        if (!player) { problems.push({ page: page.page, problem: "milestone table row with no player above it", text }); continue; }
        if (/accomplished|achieved|reached/i.test(r.needs)) continue; // already done
        const need = num((r.needs.match(/^[\d,]+/) || [])[0]);
        if (need == null) { problems.push({ page: page.page, problem: "milestone table: can't read the needs column", text }); continue; }

        if (r.category) {
          // Milwaukee: category, current, milestone in separate columns.
          const target = num(r.milestone), current = num(r.current);
          const { stat, statRaw } = statWithScope(r.category);
          milestones.push({ format: "column-table", page: page.page, player, statRaw, stat, target, current, needStated: need, scope: tableScope, text });
          continue;
        }
        const m = String(r.milestone || "").match(/^([\d,]+)\s+(.+?)(?:\s*\(\s*(\d{1,3}(?:st|nd|rd|th))\s+all-time\s+in\s+(NBA|franchise)\s+history\s*\))?$/i);
        if (!m) { problems.push({ page: page.page, problem: "milestone table: can't read the milestone column", text }); continue; }
        const target = num(m[1]);
        const sw = statWithScope(m[2]);
        if (m[3]) {
          // A rank to reach, printed as the total that reaches it: who is passed
          // and their total aren't printed, so only the gap is known for sure.
          milestones.push({
            format: "column-table", page: page.page, player, statRaw: sw.statRaw, stat: sw.stat,
            kind: "pass", target, current: target - need, needStated: need,
            scope: /nba/i.test(m[4]) ? "nba" : "franchise",
            passing: { player: null, total: null, rank: ordinal(m[3]), forWhat: `${m[3]} all-time in ${/nba/i.test(m[4]) ? "NBA" : "franchise"} history` },
            text,
          });
          continue;
        }
        milestones.push({
          format: "column-table", page: page.page, player, statRaw: sw.statRaw, stat: sw.stat,
          target, current: target != null ? target - need : null, needStated: need,
          scope: sw.scope ?? tableScope, text,
        });
      }
    }
  }
  return { milestones, problems };
}
