import { normStat, num } from "../stats.js";
import { cleanName } from "../names.js";

/**
 * Wide tracker tables: a group-label row ("Points  Rebounds  Assists"), a header
 * row ("Player  Total Next Need NBA rank Lakers rank" repeated), then one row
 * per player with five values per group.
 * Seen in: Los Angeles Lakers ("LAKERS MILESTONES TRACKER").
 *
 * Values are read in order, not by position: every slot always holds a number,
 * "No. N", "T-No. N" or a dash, so a row with exactly 5 values per group is
 * unambiguous. Rows that don't add up are reported, never guessed.
 */
const TOKEN = /(T-No\.\s*\d+|No\.\s*\d+|[\d,]+|[—–-](?=\s|$))/g;

export function readTrackerTable(doc) {
  const out = [];
  const problems = [];
  for (const page of doc.pages) {
    const lines = page.lines;
    for (let i = 0; i < lines.length; i++) {
      const head = lines[i];
      const totals = (head.text.match(/\bTotal\b/g) || []).length;
      const needs = (head.text.match(/\bNeed\b/g) || []).length;
      if (totals < 1 || totals !== needs || !/\bNext\b/.test(head.text)) continue;
      const groups = totals;
      // Group labels sit on the line above (sometimes two above, with "Player" between).
      const labelLine = [lines[i - 1], lines[i - 2]].find(
        (l) => l && l.cells.filter((c) => normStat(c.text)).length === groups,
      );
      if (!labelLine) { problems.push({ page: page.page, problem: "tracker table without stat labels", text: head.text }); continue; }
      const stats = labelLine.cells.filter((c) => normStat(c.text)).map((c) => ({ raw: c.text, key: normStat(c.text) }));
      const teamRankLabel = (head.text.match(/(\w+) rank\s*$/) || [])[1] || "team";

      for (let j = i + 1; j < lines.length; j++) {
        const row = lines[j];
        const nameMatch = row.text.match(/^\s*([\p{L}’'.\- ]+?\*?)\s+(?=[\d—–-])/u);
        if (!nameMatch) break;
        const player = cleanName(nameMatch[1]);
        const rest = row.text.slice(nameMatch[0].length);
        const tokens = rest.match(TOKEN) || [];
        if (tokens.length !== groups * 5) {
          // Stop at the first row that doesn't fit: reading on could pick up
          // unrelated text further down the page as tracker data.
          problems.push({ page: page.page, problem: `tracker row has ${tokens.length} values, expected ${groups * 5}; table reading stopped here`, text: row.text });
          break;
        }
        stats.forEach((s, g) => {
          const [total, next, need, nbaRank, teamRank] = tokens.slice(g * 5, g * 5 + 5);
          out.push({
            format: "tracker-table",
            page: page.page,
            player,
            statRaw: s.raw,
            stat: s.key,
            target: num(next),
            current: num(total),
            needStated: num(need),
            scope: "career",
            nbaRank: rankOf(nbaRank),
            teamRank: rankOf(teamRank),
            teamRankLabel,
            text: `${player}: ${s.raw} ${total} / next ${next} / need ${need}`,
          });
        });
      }
    }
  }
  return { milestones: out, problems };
}

function rankOf(tok) {
  const m = String(tok || "").match(/(T-)?No\.\s*(\d+)/);
  return m ? { rank: Number(m[2]), tied: !!m[1] } : null;
}
