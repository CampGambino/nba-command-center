/**
 * Third-party confirmations (src/data/verified-totals.json) applied to the Records checks.
 *
 * A disagreement between our total and a team's notes (or between two of the guide's own lists)
 * is settled when an outside source the user checked gives our number. The row settles it only
 * while our total still equals that value; once more games are played the check stands on its own.
 */
import { strictKey } from "./guide.js";

const fmt = (n) => Number(n).toLocaleString("en-US");

function find(rows, player, stat, scope, team) {
  return (rows || []).find((r) => strictKey(r.player) === strictKey(player) && r.stat === stat && r.scope === scope && (scope !== "franchise" || !team || r.team === team));
}

/**
 * checks: { same, differ: [{ player, stat, ours, theirs, source }], franchise?: { same, differ } }
 * Each differ row whose total a confirmation agrees with gets `settled: { value, asOf, by }`;
 * a confirmation from today that disagrees with ours is reported as `against: { value, asOf, by }` (ours is wrong);
 * on later days our total has moved on with new games, so an old confirmation says nothing.
 */
export function settleChecks(checks, verified, today = null) {
  const by = "Basketball Reference";
  const mark = (rows, scope) => {
    for (const x of rows || []) {
      const v = find(verified?.rows, x.player, x.stat, scope, x.team || (x.source || "").slice(0, 3));
      if (!v) continue;
      if (v.value === x.ours) x.settled = { value: v.value, asOf: v.asOf, by };
      else if (today && today === v.asOf) x.against = { value: v.value, asOf: v.asOf, by };
    }
  };
  mark(checks?.differ, "career");
  mark(checks?.franchise?.differ, "franchise");
  return checks;
}

/**
 * The guide giving two totals for one player ("X dreb: the guide gives A and B (where)"): when an outside
 * source confirms the total we use, the other figure is a slip in the guide, so it moves to errata.
 * players: currentRecords' players (totals[stat] = { base, season, now }).
 */
export function settleProblems(problems, players, verified) {
  const byName = new Map((players || []).map((p) => [strictKey(p.name), p]));
  const keep = [], errata = [];
  for (const line of problems || []) {
    const m = /^(.+?) (\w+): the guide gives ([\d,]+) and ([\d,]+) \((.+)\)$/.exec(line);
    const p = m && byName.get(strictKey(m[1]));
    const t = p?.totals?.[m?.[2]];
    const v = m && find(verified?.rows, m[1], m[2], "career");
    if (!m || !t || !v || v.value !== t.now) { keep.push(line); continue; }
    const a = Number(m[3].replace(/,/g, "")), b = Number(m[4].replace(/,/g, ""));
    const right = t.base === a ? a : b, slip = right === a ? b : a;
    errata.push(`${m[1]} ${m[2]}: the guide also gives ${fmt(slip)} (${m[5]}); ${fmt(right)} is right (Basketball Reference: ${fmt(v.value)} through ${v.asOf}, ${fmt(v.season ?? v.value - right)} of them this season)`);
  }
  return { problems: keep, errata };
}
