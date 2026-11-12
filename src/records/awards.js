/**
 * Award résumés from the NBA Guide's award history (src/data/nba-history-<season>.json, through 2025-26):
 *   resumes(history) -> Map(nameKey -> "3× MVP · 2× Finals MVP · Rookie of the Year")
 * Major awards only, most important first. Coaches get Coach of the Year.
 */
import { nameKey } from "../notes/names.js";

export const MAJOR = [
  ["NBA Most Valuable Player", "MVP"], ["NBA Finals Most Valuable Player", "Finals MVP"], ["NBA Defensive Player Of The Year", "DPOY"],
  ["NBA Rookie Of The Year", "Rookie of the Year"], ["NBA Sixth Man Of The Year", "Sixth Man"], ["NBA Most Improved Player", "Most Improved"],
  ["NBA Clutch Player Of The Year", "Clutch Player"], ["NBA Eastern Conference Finals MVP", "East Finals MVP"], ["NBA Western Conference Finals MVP", "West Finals MVP"],
  ["NBA All-Star Game Most Valuable Player", "All-Star MVP"], ["NBA Coach Of The Year", "Coach of the Year"],
];

export function resumes(history) {
  const won = new Map(); // key -> { label: count }
  for (const [award, label] of MAJOR) {
    for (const w of history?.awards?.[award] || []) {
      // Shared awards print both names ("Kobe Bryant and Shaquille O'Neal")
      for (const name of String(w.player).split(/\s+and\s+|\s*&\s*/)) {
        const k = nameKey(name);
        if (!k) continue;
        const m = won.get(k) || {};
        m[label] = (m[label] || 0) + 1;
        won.set(k, m);
      }
    }
  }
  const out = new Map();
  for (const [k, m] of won) out.set(k, MAJOR.map(([, l]) => l).filter((l) => m[l]).map((l) => (m[l] > 1 ? `${m[l]}× ${l}` : l)).join(" · "));
  return out;
}
