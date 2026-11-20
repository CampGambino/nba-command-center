/**
 * Should a new build's Watch List replace the published one? (scripts/ci.js)
 *
 * The guard exists for one case: nba.com refuses or cuts off a team's notes in a later build, and a list that had that
 * team's notes would be replaced by one without them. So a build with notes for FEWER teams than the published list
 * of the same day is not published.
 *
 * 0.124 (11/19/26; the user: "what is the warning about a build for 6 teams… at this point in the day, the game notes
 * should have updated for teams on a back-to-back. what gives?"): "has notes" used to mean current or stale only.
 * Minnesota's notes went from stale (yesterday's file) to conflict (today's file, opponent misread), the count fell from
 * 7 to 6, and every build from early afternoon on was thrown away while Memphis's and Milwaukee's new notes sat unread.
 * A conflict is a file that was downloaded and dated: the team has notes. Only a team whose file could not be read
 * (unreachable, no date found, nothing) counts as lost. And the note now names the teams and says when the kept list
 * was built.
 */
export const HAS_NOTES = ["current", "stale", "conflict"];
const has = (t) => HAS_NOTES.includes(t?.notesStatus);
export const notesRead = (w) => (w?.teams || []).filter(has).length;

/** @returns {{ keep: boolean, before: number, after: number, lost: Array<{team, was, now}>, text: string|null }} */
export function notesGuard(before, after, today) {
  const b = notesRead(before), a = notesRead(after);
  if (!before || before.today !== today || a >= b) return { keep: false, before: b, after: a, lost: [], text: null };
  const now = Object.fromEntries((after?.teams || []).map((t) => [t.team, t.notesStatus || "none"]));
  const lost = (before.teams || []).filter((t) => has(t) && !HAS_NOTES.includes(now[t.team])).map((t) => ({ team: t.team, was: t.notesStatus, now: now[t.team] || "not in this build" }));
  let at = "";
  try { at = before.generatedAt ? ` built at ${new Date(before.generatedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET` : ""; } catch { at = ""; }
  const who = lost.length ? lost.map((t) => `${t.team} (${t.now})`).join(", ") : `${b - a} team${b - a === 1 ? "" : "s"}`;
  return { keep: true, before: b, after: a, lost,
    text: `this build could not read the notes for ${who}; the published Watch List${at} has them and was kept, so nothing newer from the other teams' notes is showing` };
}

/**
 * 0.126: keep the one team, publish the rest. (The user was asked on 11/19; the guard above held the whole list.)
 *
 * A team that had notes in today's published list and has none in this build (the download failed, no date was
 * found) keeps its published entry: its place in watch.json's `teams`, and its history lines and status in
 * notes-facts.json. Every other team's entry is this build's. Nothing is kept across days.
 *
 * @param {object} o
 * @param {object|null} o.before       the published watch.json
 * @param {object} o.after             this build's watch.json
 * @param {object|null} o.beforeFacts  the published notes-facts.json
 * @param {object|null} o.afterFacts   this build's notes-facts.json
 * @param {string} o.today
 * @returns {{ lost: Array<{team, was, now}>, watch: object, facts: object|null, text: string|null }}
 */
export function keepLostTeams({ before, after, beforeFacts = null, afterFacts = null, today }) {
  const none = { lost: [], watch: after, facts: afterFacts, text: null };
  if (!before || !after || before.today !== today || after.today !== today) return none;
  const now = Object.fromEntries((after.teams || []).map((t) => [t.team, t]));
  const lost = (before.teams || []).filter((t) => has(t) && !has(now[t.team])).map((t) => ({ team: t.team, was: t.notesStatus, now: now[t.team]?.notesStatus || "not in this build" }));
  if (!lost.length) return none;
  let at = "";
  try { at = before.generatedAt ? new Date(before.generatedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) + " ET" : "an earlier build"; } catch { at = "an earlier build"; }
  const keep = new Set(lost.map((t) => t.team)), old = Object.fromEntries((before.teams || []).map((t) => [t.team, t]));
  const teams = (after.teams || []).map((t) => (keep.has(t.team) ? { ...old[t.team], notesKept: at } : t));
  for (const t of keep) if (!now[t]) teams.push({ ...old[t], notesKept: at });
  const watch = { ...after, teams };
  let facts = afterFacts;
  if (afterFacts && beforeFacts && beforeFacts.today === today) {
    facts = { ...afterFacts, teams: { ...(afterFacts.teams || {}) }, status: { ...(afterFacts.status || {}) } };
    for (const t of keep) { if (beforeFacts.teams?.[t]) facts.teams[t] = beforeFacts.teams[t]; if (beforeFacts.status?.[t]) facts.status[t] = beforeFacts.status[t]; }
  }
  const who = lost.map((t) => `${t.team} (${t.now})`).join(", ");
  return { lost, watch, facts, text: `this build could not read the notes for ${who}; ${lost.length === 1 ? "that team's" : "those teams'"} notes and milestones are from the ${at} build, and everything else is new` };
}
