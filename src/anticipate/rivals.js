/**
 * The man being passed, when he is still adding to his total (0.146.0).
 *
 * A Watch List pass ("needs 12 to pass DeMar DeRozan") was simulated as if the other man's total stood still. When he
 * plays too, often the same night, the bar moves: the chance is for finishing ahead of him, as the record chases
 * already do (src/records/guide.js addChances, 0.141.12). This builds, from this season's team files, a lookup the
 * milestone simulation (src/anticipate/watch.js) calls for each pass:
 *   - nba / season lists: any active player with 3+ games this season adds to his total wherever he plays
 *   - franchise lists (and lists of unproven scope, read the stricter way): only while he is on that franchise
 *   - a subset list ("by a teen", a qualifier): his total is frozen; a window to now ("since 2018-19") is not
 *   - a franchise list printed by surname ("Wagner"): the one player on that team now with that surname
 * Tonight he adds only if his team plays tonight, capped by tonight's injury grade.
 */
import { seasonLines, strictKey } from "../records/guide.js";

const surKey = (w) => String(w || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’'.]/g, "").toLowerCase().trim();
export const RIVAL_CAP = { Out: 0, Doubtful: 0.25, Questionable: 0.6, "Day-To-Day": 0.6 };
const MAX_PLAY = 0.97;

/**
 * @param {object} teamFiles   { TRI: team file } as in docs/data/teams
 * @param {object} o
 * @param {Set<string>} [o.tonightTeams]  teams playing tonight
 * @param {object} [o.statusOf]           (name, team) -> tonight's grade ("Out", "Questionable", …) or null
 * @param {Function} o.makeSampler        src/anticipate/model.js
 * @returns {(m: {kind, scope, team, qualifier, passing, espnId}) => null | {id, name, team, tonight, pPlay, pTonight, sample}}
 */
export function rivalLookup(teamFiles, { tonightTeams = null, statusOf = null, makeSampler }) {
  const L = seasonLines(teamFiles);
  const byName = new Map();
  for (const p of Object.values(L)) { const k = strictKey(p.name); byName.set(k, byName.has(k) ? null : p); }   // null: two players, one name
  const playRate = (p) => {
    const tg = (p.teamGames[p.team] || []).filter((g) => !g.out).slice(-10);
    return Math.min(MAX_PLAY, tg.length >= 3 ? Math.max(0.05, tg.filter((g) => g.played).length / tg.length) : 0.9);
  };
  return (m) => {
    // A subset list is frozen ("by a teen"), except a window that runs to now ("since 2018-19": his total there grows).
    if (m.kind !== "pass" || !m.passing?.player || (m.qualifier && !/^\s*since\b/i.test(m.qualifier))) return null;
    const scope = m.scope == null ? "nba" : m.scope;
    if (!["nba", "season", "franchise", "unknown"].includes(scope)) return null;
    let q = byName.get(strictKey(m.passing.player));
    // Team notes print franchise lists by surname ("Wagner"): on a franchise list, the one player on that team now with
    // that surname (two, or none: no rival). A retired namesake can't be told apart, so a surname alone never reaches
    // beyond his current team.
    if (!q && (scope === "franchise" || scope === "unknown") && !/\s/.test(String(m.passing.player).trim())) {
      const sur = surKey(m.passing.player);
      const c = Object.values(L).filter((p) => p.team === m.team && String(p.id) !== String(m.espnId) && surKey(p.name.split(" ").filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w)).pop()) === sur);
      q = c.length === 1 ? c[0] : null;
    }
    if (!q || String(q.id) === String(m.espnId)) return null;
    if ((scope === "franchise" || scope === "unknown") && q.team !== m.team) return null;   // his total there is frozen
    if (q.lines.length < 3) return null;
    const pPlay = playRate(q);
    const tonight = !tonightTeams || tonightTeams.has(q.team);
    const cap = RIVAL_CAP[statusOf?.(q.name, q.team)];
    const pTonight = !tonight ? 0 : cap == null ? pPlay : Math.min(pPlay, cap);
    return { id: String(q.id), name: q.name, team: q.team, tonight: tonight && pTonight > 0, pPlay, pTonight, sample: makeSampler(q.lines.slice(0, 20), { smooth: 0.2 }) };
  };
}
