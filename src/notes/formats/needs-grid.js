import { normStat, num } from "../stats.js";

/**
 * "Upcoming player milestones" grid: one row per player, and per stat three columns,
 * Target · N (needs) · DA (date acquired).
 * Seen in: Boston (2026-11-10), headed
 *   PLAYER  PTS N DA  REB N DA  AST N DA  STL N DA  BLK N DA  GAMES N DA
 * with rows like
 *   J. Tatum  14,400 24 --  4,750 243 --  2,400 2 --  ...
 * A triple with a number in N and "--" in DA is upcoming (current = target - N).
 * A triple with a date in DA was already reached that day: not a milestone to chase.
 * Every row must hold exactly 3 entries per stat; any other count is reported as a
 * problem and the row is skipped rather than guessed.
 */
const VALUE = /^(--|[\d,]+|\d{1,2}\/\d{1,2}\/\d{2,4})$/;
const isHeader = (line) => /^PLAYER\b/.test(line.text.trim()) && /\bN\b/.test(line.text) && /\bDA\b/.test(line.text);
const isLegend = (line) => /^["“]?N["”]?\s*=\s*Needs/i.test(line.text.trim());

export function readNeedsGrid(doc) {
  const milestones = [], problems = [];
  for (const page of doc.pages) {
    let stats = null;
    for (const line of page.lines) {
      const text = line.text.replace(/\s+/g, " ").trim();
      if (isHeader(line)) {
        const words = text.split(" ").filter((w) => !/^(PLAYER|N|DA)$/.test(w));
        stats = words.map((w) => ({ raw: w, key: normStat(w) }));
        continue;
      }
      if (!stats) continue;
      if (isLegend(line) || !text) { stats = null; continue; }
      const tokens = text.split(" ");
      const first = tokens.findIndex((t) => VALUE.test(t));
      if (first <= 0) continue; // not a player row
      const player = tokens.slice(0, first).join(" ");
      const values = tokens.slice(first);
      if (values.length !== stats.length * 3) {
        problems.push(`p.${page.page} milestone grid: ${player} has ${values.length} entries for ${stats.length} stats (expected ${stats.length * 3}); row skipped`);
        continue;
      }
      stats.forEach((st, k) => {
        const [t, n, da] = values.slice(k * 3, k * 3 + 3);
        if (!st.key || t === "--" || n === "--" || da !== "--") return;
        const target = num(t), need = num(n);
        if (target == null || need == null || need <= 0 || need > target) return;
        milestones.push({
          format: "needs-grid", page: page.page, player, statRaw: st.raw, stat: st.key,
          target, current: target - need, needStated: need, scope: "career",
          text: `${player}: ${st.raw} ${t} needs ${n}`,
        });
      });
    }
  }
  return { milestones, problems };
}
