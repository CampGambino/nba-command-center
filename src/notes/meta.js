import { teamFromText, teamFromCode, TEAMS } from "../teams.js";

/**
 * What game these notes are for: the date and the opponent, read from the
 * front pages. Used to decide whether a downloaded file is *tonight's* notes or
 * a stale copy still sitting at the team's URL.
 */
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON3 = MONTHS.map((m) => m.slice(0, 3));

export function readMeta(doc, team) {
  const front = doc.pages.slice(0, 2).flatMap((p) => p.lines.map((l) => l.text));
  const text = front.join("\n");
  const dates = [];

  // "Monday, November 9th, 2026"
  for (const m of text.matchAll(/\b(?:mon|tues|wednes|thurs|fri|satur|sun)day[,\s•|·—-]+([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)/gi)) {
    const mi = monthIndex(m[1]);
    if (mi >= 0) dates.push({ iso: iso(+m[3], mi + 1, +m[2]), how: m[0] });
  }
  // "11/09/26 @ CHARLOTTE"
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s*(?:@|vs\.?|at)\s/gi)) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    dates.push({ iso: iso(y, +m[1], +m[2]), how: m[0].trim() });
  }
  // "NOV 9 VS. SPURS" (no year: filled in by the caller's season context)
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\s+(?:vs\.?|@|at)\s+([A-Za-z. ]{3,20})/gi)) {
    const mi = monthIndex(m[1]);
    if (mi >= 0) dates.push({ iso: null, month: mi + 1, day: +m[2], how: m[0].trim() });
  }

  // "GAME NOTES VS. HOU - 11/9/26" (Denver: date after the opponent)
  for (const m of text.matchAll(/\b(?:vs\.?|@|at)\s+[A-Z]{2,3}\s*[-–—]\s*(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/gi)) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    dates.push({ iso: iso(y, +m[1], +m[2]), how: m[0].trim() });
  }
  // "November 9, 2026 — American Airlines Center" (Indiana: no weekday). Lowest
  // priority: front pages also carry other full dates (draft days, signings).
  for (const m of text.matchAll(/\b([A-Z][a-z]+)\.?\s+(\d{1,2}),\s+(20\d\d)\s*[—–-]/g)) {
    const mi = monthIndex(m[1]);
    if (mi >= 0) dates.push({ iso: iso(+m[3], mi + 1, +m[2]), how: m[0].trim(), weak: true });
  }

  const gameDate = (dates.find((d) => d.iso && !d.weak) || dates.find((d) => d.iso))?.iso ?? null;

  const opp = readOpponent(doc, team, gameDate);
  return {
    team, teamName: team && TEAMS[team] ? `${TEAMS[team].city} ${TEAMS[team].nick}` : null,
    gameDate, opponent: opp.opponent, opponentEvidence: opp.evidence, dateEvidence: dates.slice(0, 4),
  };
}

/**
 * Opponent: the other team on a "vs." / "@" / "at" cell of the front pages.
 * Scored per cell, not per line, because front pages put a schedule sidebar on
 * the same visual row as the header and body text (Cleveland p.1:
 * "CAVS QUICK FACTS  12/12 vs. Warriors" - the own-team word and the
 * schedule row are different cells and must not add up).
 *   +3  the cell names both teams (the game header)
 *   +2  the cell carries tonight's date ("11/09/26 @ CHARLOTTE", "NOV 9 VS. SPURS")
 *   +1  in the first six lines
 * Ties go to the earlier cell.
 */
function readOpponent(doc, team, gameDate) {
  const own = team && TEAMS[team] ? [TEAMS[team].nick, TEAMS[team].city, ...(TEAMS[team].alt || [])].map((w) => w.toLowerCase()) : [];
  let dateRe = null;
  if (gameDate) {
    const [y, m, d] = gameDate.split("-").map(Number);
    const yy = String(y).slice(2);
    dateRe = new RegExp(`(?:^|[^\\d/])0?${m}/0?${d}(?:/(?:20)?${yy})?(?![\\d/])|\\b${MON3[m - 1]}[a-z]*\\.?\\s+0?${d}(?!\\d)`, "i");
  }
  const lines = doc.pages.slice(0, 2).flatMap((p) => p.lines);
  let best = { opponent: null, score: -1, evidence: null };
  lines.forEach((line, i) => {
    for (const cell of line.cells?.length ? line.cells : [{ text: line.text }]) {
      const t = cell.text;
      if (!/(\bvs\.?\s|@|\bat\s)/i.test(t)) continue;
      const parts = t.split(/\bvs\.?\s|@|\bat\s/i);
      let tri = teamFromText(parts.slice(1).join(" ")) || teamFromCode(parts[1]); // "VS. HOU - 11/9/26"
      // "CLEVELAND CAVALIERS @ CHARLOTTE HORNETS" in Charlotte's own notes.
      if (!tri || tri === team) tri = teamFromText(parts[0]);
      if (!tri || tri === team) continue;
      const lower = t.toLowerCase();
      const score = (own.some((w) => lower.includes(w)) ? 3 : 0) + (dateRe && dateRe.test(t) ? 2 : 0) + (i < 6 ? 1 : 0);
      if (score > best.score) best = { opponent: tri, score, evidence: t.slice(0, 80) };
    }
  });
  return best;
}

function monthIndex(s) {
  const t = String(s).toLowerCase();
  const i = MONTHS.indexOf(t);
  return i >= 0 ? i : MON3.indexOf(t.slice(0, 3));
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
