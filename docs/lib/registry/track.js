import { nameKey, sameName } from "../notes/names.js";
import { standing } from "../nba/movement.js";

/**
 * Milestone tracking: bring the totals printed in a team's game notes up to
 * date, and check them against a second source.
 *
 * Game notes are written before a game ("entering tonight..."). Totals printed
 * in notes dated D therefore include everything before D. If D's game, or
 * later ones, have been played (stale notes on a back-to-back, or simply the
 * morning after), each player's lines from those box scores are added.
 *
 * Then, where ESPN publishes the same total (career, or seasons with this
 * franchise), the up-to-date number is compared with ESPN's. Agreement is
 * "confirmed"; any difference makes the milestone "review" with both numbers
 * shown. Neither source is assumed right: on 2026-11-09, 9 of 39 Charlotte
 * totals differed by 1-9 and the differences sat in past seasons, not in
 * this season (ESPN's 2026-27 rows matched its box scores exactly). The
 * tiebreaker is NBA.com's own career stats (stats.nba.com, PC collector).
 * Note: ESPN keeps play-in games out of its season rows, as the NBA does.
 *
 * Nothing here throws on bad data: a step that can't be done is reported in
 * `tracking.status` / `tracking.notes`, and the milestone keeps its notes values.
 */

const loose = (s) => nameKey(s).replace(/\./g, "").replace(/\b([a-z]) (?=[a-z]\b)/g, "$1");

/** One player's contribution to a stat in one box-score line. */
export function statFromLine(stat, line) {
  if (!line || !line.played) return 0;
  const s = line.stats || {};
  if (stat === "gp") return 1;
  if (stat === "gs") return line.started ? 1 : 0;
  const g = /^g(\d+)pt$/.exec(stat || "");
  if (g) return (s.pts ?? 0) >= Number(g[1]) ? 1 : 0;
  if (stat === "dd" || stat === "td") {
    const tens = ["pts", "reb", "ast", "stl", "blk"].filter((k) => (s[k] ?? 0) >= 10).length;
    return tens >= (stat === "dd" ? 2 : 3) ? 1 : 0;
  }
  return Number.isFinite(s[stat]) ? s[stat] : null; // null = this stat isn't in the box score
}

/** Stats ESPN's career tables carry as whole-career counts. */
const CAREER_STATS = new Set(["gp", "gs", "pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "tov", "pf"]);

/**
 * @param {object} p
 * @param {string} p.team        our tricode (the notes' team)
 * @param {string} p.notesDate   YYYY-MM-DD the notes were written for
 * @param {object[]} p.milestones from parseNotes
 * @param {object} p.espn        createEspn(...) or a test double with the same methods
 * @returns {Promise<{ milestones, games, warnings, problems }>}
 */
export async function trackMilestones({ team, notesDate, milestones, espn, nba = null }) {
  const warnings = [], problems = [];
  const done = (status, note) => ({
    milestones: milestones.map((m) => ({ ...m, tracking: { status, notes: [note] } })),
    games: [], warnings, problems: [...problems, note],
  });

  if (!notesDate) return done("unavailable", "notes date unknown: can't tell which games came after them");
  const teams = await espn.teams();
  if (!teams.ok) return done("unavailable", teams.error);
  warnings.push(...teams.warnings);
  const espnTeam = teams.data.ids[team];
  if (!espnTeam) return done("unavailable", `no ESPN team for ${team}`);

  const [roster, schedule] = await Promise.all([espn.roster(espnTeam), espn.schedule(espnTeam)]);
  if (!roster.ok) return done("unavailable", roster.error);
  if (!schedule.ok) return done("unavailable", schedule.error);
  warnings.push(...roster.warnings, ...schedule.warnings);

  // Games after the notes were written: regular season, on/after the notes date, finished.
  // Regular season only (type 2): preseason (1), playoffs (3) and play-in (5) don't count, as on ESPN's own season rows.
  const since = schedule.data.games.filter((g) => g.date && g.date >= notesDate && g.final && g.seasonType === 2);
  const pending = schedule.data.games.filter((g) => g.date && g.date >= notesDate && !g.final && /IN_PROGRESS|HALFTIME|END_PERIOD/.test(g.state || ""));
  const boxes = [];
  let boxesComplete = true;
  for (const g of since) {
    const b = await espn.box(g.id);
    if (!b.ok || !b.data.final) { boxesComplete = false; problems.push(`box score for ${g.date} (${g.id}) unavailable: ${b.error || "not final"}`); continue; }
    warnings.push(...b.warnings);
    boxes.push({ game: g, box: b.data });
  }

  // Who plays for this team: ESPN's roster, plus anyone in its last few box
  // scores (ESPN rosters leave out two-way players, e.g. CLE's Nae'Qwan Tomlin).
  const people = [...roster.data.players];
  const recent = schedule.data.games.filter((g) => g.final && g.seasonType === 2).slice(-5);
  for (const g of recent) {
    const b = await espn.box(g.id);
    if (!b.ok) continue;
    for (const p of b.data.players) {
      if (p.team === team && !people.some((x) => x.id === p.id)) people.push({ id: p.id, name: p.name, fromBox: g.date });
    }
  }
  const byKey = new Map(people.map((p) => [loose(p.name), p]));
  const findPerson = (name) => {
    if (!name) return null;
    const exact = byKey.get(loose(name));
    if (exact) return exact;
    // "J. ALLEN" style: accept only a single unambiguous match.
    const hits = people.filter((p) => sameName(p.name, name));
    return hits.length === 1 ? hits[0] : null;
  };
  const deltaFor = (personId, stat) => {
    let d = 0;
    for (const { box } of boxes) {
      const v = statFromLine(stat, box.players.find((p) => p.id === personId));
      if (v === null) return null;
      d += v;
    }
    return d;
  };
  const careers = new Map();
  // NBA.com's transaction log: who left, who signed (evidence beside ESPN's roster).
  let movement = null;
  if (nba) {
    const mv = await nba.movement();
    if (mv.ok) { movement = mv.data; warnings.push(...mv.warnings); } else warnings.push(`transactions unavailable: ${mv.error}`);
  }
  const fmtMove = (st) => {
    const l = st.last;
    if (!l) return "";
    const what = l.type === "Trade" ? (st.status === "left" ? `traded to ${l.team || "another team"}` : `acquired by ${l.team}`)
      : l.type === "Waive" ? `waived by ${l.team}` : `signed by ${l.team}`;
    return `${what} on ${l.date} (NBA transactions)`;
  };

  const out = [];
  for (const m of milestones) {
    const t = { status: "unchecked", notes: [], gamesSince: boxes.length, through: boxes.length ? boxes[boxes.length - 1].game.date : null };
    out.push({ ...m, tracking: t });
    if (!m.stat || m.stat === "list" || (m.kind !== "round" && m.kind !== "pass")) { t.notes.push("not a counting milestone"); continue; }
    const player = findPerson(m.player);
    const st = movement ? standing(movement, m.player, team) : { status: null };
    if (st.nbaId) t.nbaId = st.nbaId;
    if (!player) {
      // Not on ESPN's roster nor in the team's recent box scores. The transaction
      // log says why when it can; ESPN's roster and the log can disagree.
      t.notes.push(`${m.player} is not on ESPN's ${team} roster or in its last 5 box scores`);
      if (st.status === "left") {
        t.moved = { type: st.last.type, date: st.last.date, to: st.to || null };
        t.notes.push(fmtMove(st));
        if (m.scope === "franchise") { t.status = "off-roster"; t.notes.push("his franchise total can't grow now: this chase is not live"); }
        else t.status = "unavailable";
      } else if (st.status === "with") {
        t.status = "unavailable";
        t.notes.push(`${fmtMove(st)}: the log still has him with ${team} (two-way, G League or injured?), so the chase stays live but can't be projected`);
      } else {
        t.notes.push(movement ? "no transaction explains it (spelling, or the log lags)" : "transactions not checked");
        if (m.scope === "franchise") { t.status = "off-roster"; t.notes.push("if he has left, his franchise total can't grow: this chase is not live"); }
        else t.status = "unavailable";
      }
      continue;
    }
    t.espnId = player.id;

    // 1. Roll forward from the notes.
    let delta = 0, unknown = false;
    for (const { game, box } of boxes) {
      const line = box.players.find((p) => p.id === player.id);
      const v = statFromLine(m.stat, line);
      if (v === null) unknown = true; else delta += v;
    }
    if (unknown) { t.status = "unavailable"; t.notes.push(`box scores don't carry ${m.stat}`); continue; }
    if (!boxesComplete) t.notes.push("some box scores since the notes couldn't be read; totals may be short");
    t.delta = delta;
    if (m.current != null) t.current = m.current + delta;
    // A teammate being chased plays in the same games: his total moves too.
    t.target = m.target;
    if (m.kind === "pass" && m.passing?.player) {
      const other = findPerson(m.passing.player);
      if (other && other.id !== player.id) {
        const od = deltaFor(other.id, m.stat);
        if (od === null) t.notes.push(`can't tell how far ${m.passing.player} has moved`);
        else if (m.target != null) { t.target = m.target + od; t.targetMoved = od; }
        else if (m.need != null) t.targetMoved = od;
      }
    }
    if (t.target != null && t.current != null) t.need = t.target - t.current;
    else if (m.need != null) t.need = m.need - delta + (t.targetMoved || 0); // narrative passes print only the gap
    if (t.need != null) {
      t.reached = t.need <= 0;
      if (m.kind === "pass" && m.tieAt != null) t.tied = t.need === 1;
    }
    if (pending.length) t.notes.push(`a game is in progress (${pending.map((g) => g.date).join(", ")}); its stats are not counted yet`);

    // 2. Cross-check against ESPN.
    const scope = m.kind === "round" ? (m.scope || "career") : m.scope;
    if (!CAREER_STATS.has(m.stat)) { t.status = boxesComplete ? "rolled" : "partial"; t.notes.push(`ESPN has no career total for ${m.stat}`); continue; }
    if (scope !== "career" && scope !== "nba" && scope !== "franchise") { t.status = boxesComplete ? "rolled" : "partial"; t.notes.push(`scope "${scope}" can't be cross-checked`); continue; }
    if (t.current == null) { t.status = boxesComplete ? "rolled" : "partial"; t.notes.push("notes give no current total to check"); continue; }
    if (!careers.has(player.id)) careers.set(player.id, await espn.career(player.id));
    const c = careers.get(player.id);
    if (!c.ok) { t.status = "partial"; t.notes.push(c.error); continue; }
    // No NBA games yet: ESPN has no totals table. Zero in the notes agrees with that.
    if (!c.data.rows.length && c.data.career == null) {
      if (t.current === 0) { t.espn = { value: 0, diff: 0, stale: c.stale }; t.status = boxesComplete ? "confirmed" : "partial"; t.notes.push("no NBA games yet on ESPN; notes also say 0"); }
      else { t.status = "disagrees"; t.espn = { value: 0, diff: -t.current, stale: c.stale }; t.notes.push(`notes say ${t.current}, but ESPN has no NBA games for ${m.player}`); }
      continue;
    }
    if (c.warnings.length) t.notes.push(...c.warnings);
    let espnValue;
    if (scope === "franchise") {
      const rows = c.data.rows.filter((r) => r.teamId === espnTeam);
      espnValue = rows.every((r) => r.stats[m.stat] != null) ? rows.reduce((a, r) => a + r.stats[m.stat], 0) : null;
      t.notes.push("franchise total = this player's ESPN seasons with this team ID (relocated franchises may differ)");
    } else {
      espnValue = c.data.career?.[m.stat] ?? null;
    }
    if (espnValue == null) { t.status = "partial"; t.notes.push(`ESPN career data has no ${m.stat}`); continue; }
    t.espn = { value: espnValue, diff: espnValue - t.current, stale: c.stale };
    // Notes that were never updated this season: the notes' figure equals ESPN's total
    // through last season exactly (Boston's second milestone grid, 2026-11-10: 28 of 29
    // differences were exactly the player's 2026-27 total). Then both sources agree once
    // the season is added, and ESPN's up-to-date total is the current one.
    if (t.espn.diff !== 0) {
      const seasons = c.data.rows.map((r) => r.season).filter(Boolean);
      const latest = seasons.length ? seasons[seasons.length - 1] : null;
      const rowsNow = c.data.rows.filter((r) => r.season === latest && (scope !== "franchise" || r.teamId === espnTeam));
      const seasonNow = rowsNow.reduce((a, r) => a + (r.stats[m.stat] ?? 0), 0);
      if (latest && seasonNow > 0 && espnValue - seasonNow === m.current) {
        t.corrected = { from: t.current, to: espnValue, season: latest, added: seasonNow };
        t.notes.push(`the notes' total (${m.current}) is through last season; with ${latest}'s ${seasonNow} it is ${espnValue}, matching ESPN`);
        t.current = espnValue;
        t.espn.diff = 0;
        if (t.target != null) { t.need = t.target - t.current; t.reached = t.need <= 0; }
        t.status = boxesComplete ? "corrected" : "partial";
        continue;
      }
    }
    if (t.espn.diff === 0) t.status = boxesComplete ? "confirmed" : "partial";
    else {
      t.status = "disagrees";
      const lagging = boxes.length && t.espn.diff === -delta;
      t.notes.push(`notes${delta ? " + games since" : ""} say ${t.current}, ESPN says ${espnValue} (${t.espn.diff > 0 ? "+" : ""}${t.espn.diff})${lagging ? "; ESPN may not have added the latest game yet" : ""}`);
    }
  }

  // Notes pages that weren't updated for the last game or two before the notes
  // date (Brooklyn's 2026-11-08 milestone cards, a back-to-back: Randle's points
  // were short by exactly his 11/7 total). One coincidence proves nothing, so a
  // page is treated as stale only when most of its disagreements (at least 3)
  // are explained by the same number of missed games; then only those are
  // corrected, and anything else on the page still disagrees.
  const disagreeing = out.filter((m) => m.tracking.status === "disagrees" && m.tracking.espn?.diff > 0 && m.tracking.espnId);
  if (disagreeing.length >= 3) {
    const before = schedule.data.games.filter((g) => g.date && g.date < notesDate && g.final && g.seasonType === 2).slice(-3).reverse();
    const prior = [];
    for (const g of before) { const b = await espn.box(g.id); if (!b.ok || !b.data.final) break; prior.push({ game: g, box: b.data }); }
    const explainedBy = (m) => {
      let add = 0;
      for (let k = 0; k < prior.length; k++) {
        const v = statFromLine(m.stat, prior[k].box.players.find((p) => p.id === m.tracking.espnId));
        if (v === null) return null;
        add += v;
        if (add === m.tracking.espn.diff) return k + 1;
        if (add > m.tracking.espn.diff) return null;
      }
      return null;
    };
    const pages = new Map();
    for (const m of disagreeing) {
      const src = m.sources?.[0] || {};
      const key = `${src.format}|${src.page}`;
      if (!pages.has(key)) pages.set(key, []);
      pages.get(key).push({ m, k: explainedBy(m) });
    }
    for (const list of pages.values()) {
      const counts = new Map();
      for (const { k } of list) if (k) counts.set(k, (counts.get(k) || 0) + 1);
      const [k, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
      if (!k || n < 3 || n < list.length * 0.6) continue;
      const dates = prior.slice(0, k).map((p) => p.game.date).reverse();
      for (const { m, k: mk } of list) {
        if (mk !== k) continue;
        const t = m.tracking;
        t.corrected = { from: t.current, to: t.espn.value, gamesBefore: k, dates, added: t.espn.diff };
        t.notes.push(`this notes page was not updated for ${k === 1 ? "the game" : `the ${k} games`} on ${dates.join(", ")} (${n} of ${list.length} differences on it match exactly); with ${t.espn.diff} more it is ${t.espn.value}, matching ESPN`);
        t.current = t.espn.value;
        t.espn.diff = 0;
        if (t.target != null) { t.need = t.target - t.current; t.reached = t.need <= 0; }
        else if (m.need != null && t.need != null) { t.need -= t.corrected.added; t.reached = t.need <= 0; }
        t.status = boxesComplete ? "corrected" : "partial";
      }
    }
  }

  // Disagreement, or a chase that can no longer happen, never stays "ok".
  for (const m of out) {
    const t = m.tracking;
    if (t.status === "disagrees") {
      m.checks = [...(m.checks || []), `sources disagree: ${t.notes[t.notes.length - 1]}`];
      m.status = "review";
    } else if (t.status === "off-roster") {
      const why = t.moved ? `${t.moved.type === "Trade" ? `traded${t.moved.to ? ` to ${t.moved.to}` : ""}` : t.moved.type === "Waive" ? "waived" : "moved"} on ${t.moved.date}, per NBA transactions` : "per ESPN's roster";
      m.checks = [...(m.checks || []), `${m.player} is not with ${team} now (${why})`];
      m.status = "review";
    }
  }
  return { milestones: out, games: boxes.map((b) => ({ id: b.game.id, date: b.game.date })), warnings, problems };
}
