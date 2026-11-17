import { TEAMS } from "../../teams.js";

/**
 * A head coach's record against every team, as printed in the notes (0.76; the user, 11/16, on Indiana's
 * "RICK CARLISLE'S ALL-TIME RECORD VS. THE NBA (ENTERING 11/15/2026)"). Atlanta, Chicago, Detroit, Indiana,
 * New Orleans, Toronto and the Lakers print the same table: nickname, wins, losses, three teams to a row.
 *
 *   -> { coach, entering, page, teams: { PHI: { w, l }, … }, career: { w, l } | null, ok }
 *
 * ok only when the table reads whole: at least 28 teams, and, where the page prints his career record, the rows
 * add up to it. A table that doesn't add up is not used.
 */
const NICK = new Map(Object.entries(TEAMS).flatMap(([tri, t]) => [[t.nick.toLowerCase(), tri], ...(t.alt || []).map((a) => [a.toLowerCase(), tri])]));
const TITLE = /(?:^|\s{2,})([\p{Lu}][\p{Lu}.\- ]{3,40}?)['’]S ALL-TIME (?:COACHING )?RECORD VS\.? THE NBA(?:\s*\(ENTERING (\d{1,2}\/\d{1,2})\/\d{2,4}\))?/u;
const ROW = /(76ers|Trail Blazers|\p{Lu}\p{Ll}+)\s+(\d{1,3})\s+(\d{1,3})(?=\s|$)/gu;
const proper = (caps) => caps.trim().split(/\s+/).map((w) => (w.length <= 2 ? w : w.split("-").map((p) => p[0] + p.slice(1).toLowerCase()).join("-"))).join(" ");

export function readCoachRecord(doc) {
  for (const page of doc.pages || []) {
    const at = page.lines.findIndex((l) => TITLE.test(l.text));
    if (at < 0) continue;
    const m = page.lines[at].text.match(TITLE);
    const teams = {};
    const near = page.lines.slice(at + 1, at + 40);
    for (const [i, line] of near.entries()) {
      for (const r of line.text.matchAll(ROW)) {
        const tri = NICK.get(r[1].toLowerCase());
        if (tri && !teams[tri]) teams[tri] = { w: +r[2], l: +r[3] };
      }
      // A row whose names and numbers print a hair apart (Detroit: "Jazz  Clippers  Grizzlies" under "… 11 13 8 14 8 8"):
      // names only on this line, and a neighbouring line ending in exactly two numbers for each.
      const names = line.text.trim().split(/\s{2,}/).map((w) => NICK.get(w.toLowerCase()));
      if (names.length >= 2 && names.every(Boolean) && names.every((t) => !teams[t])) {
        for (const other of [near[i - 1], near[i + 1], near[i - 2], near[i + 2]]) {
          // The numbers close the neighbouring line (Detroit), or open it with another table's row after them
          // (New Orleans, 0.81: "6  6  4  7  3  9  2022-23  Magic  34-47  .420" over "Jazz  Clippers  Grizzlies").
          const n = other?.text.match(new RegExp(`(?:^|\\s)((?:\\d{1,3}\\s+){${names.length * 2 - 1}}\\d{1,3})\\s*$`))
            || other?.text.match(new RegExp(`^\\s*((?:\\d{1,3}\\s+){${names.length * 2 - 1}}\\d{1,3})(?!\\s+\\d{1,3}(?:\\s|$))(?=\\s|$)`));
          if (!n) continue;
          const v = n[1].trim().split(/\s+/).map(Number);
          names.forEach((t, k) => { teams[t] = { w: v[2 * k], l: v[2 * k + 1] }; });
          break;
        }
      }
      if (Object.keys(teams).length >= 30) break;
    }
    const all = page.lines.map((l) => l.text).join("\n");
    const c = all.match(/CAREER REGULAR SEASON RECORD(?:\s*\([^)]*\))?:\s*(\d{1,4})-(\d{1,4})/);
    const career = c ? { w: +c[1], l: +c[2] } : null;
    const sum = Object.values(teams).reduce((a, r) => ({ w: a.w + r.w, l: a.l + r.l }), { w: 0, l: 0 });
    const ok = Object.keys(teams).length >= 28 && (!career || (career.w === sum.w && career.l === sum.l));
    return { coach: proper(m[1]), entering: m[2] || null, page: page.page, teams, career, sum, ok };
  }
  return null;
}

/**
 * 0.83: a coach whose notes print no table (Chicago prints the heading and two totals for Tiago Splitter, nothing by
 * opponent; the user, 11/16: "I don't see his records vs. every team"). When we know which teams he has coached and
 * when (src/data/coach-tenures.json) and hold every one of those games, the record by opponent is counted from the
 * results. It is used only if the count adds up to the career record his notes print: the same check as a table.
 *
 * rec: readCoachRecord's result (coach, career); tenures: [{ team, from, to? }]; games: [{ d, h, a, hs, as }] regular
 * season, Cup title games already out; before: today (the notes are entering today).
 */
export function fromTenures(rec, tenures, games, before) {
  if (!rec || !rec.career || !Array.isArray(tenures) || !tenures.length) return rec;
  const teams = {};
  for (const g of games || []) {
    if (g.hs == null || g.as == null || g.d >= before) continue;
    for (const t of tenures) {
      if (g.d < t.from || (t.to && g.d > t.to) || (g.h !== t.team && g.a !== t.team)) continue;
      const home = g.h === t.team, opp = home ? g.a : g.h, won = home ? g.hs > g.as : g.as > g.hs;
      const r = (teams[opp] ??= { w: 0, l: 0 });
      if (won) r.w++; else r.l++;
    }
  }
  const sum = Object.values(teams).reduce((a, r) => ({ w: a.w + r.w, l: a.l + r.l }), { w: 0, l: 0 });
  return { ...rec, teams, sum, ok: sum.w === rec.career.w && sum.l === rec.career.l, counted: true };
}

/** The line for tonight: his record against tonight's opponent. Null when the table didn't read whole. */
export function coachLine(rec, opp) {
  const r = rec?.ok ? rec.teams[opp] : null;
  const T = TEAMS[opp];
  if (!r || !T || r.w + r.l < (rec.counted ? 2 : 4)) return null;   // a second-year coach has met few teams four times
  const who = `the ${T.nick}`;   // "the Heat", "the Jazz": every nickname takes the article
  const tot = rec.career || rec.sum;
  return `${rec.coach} is ${r.w}-${r.l} all-time against ${who} as a head coach (${tot.w.toLocaleString("en-US")}-${tot.l.toLocaleString("en-US")} overall${rec.entering ? `, entering ${rec.entering}` : ""}${rec.counted ? "; counted from our results, which add up to the record his notes print" : ""}).`;
}
