import { trackMilestones } from "../registry/track.js";
import { makeSampler, simulate } from "./model.js";
import { importance } from "./importance.js";

/**
 * The Watch List for one team's notes: every live milestone with
 *   - how likely it is tonight, and within the next 3 / 5 games
 *   - the expected game and date it falls (median)
 *   - how much it matters (importance 0-100, with reasons)
 *   - whether it is publishable (status ok, sources agree, still live)
 *
 * Inputs it gathers (all through the ESPN client, cached):
 *   - this season's box scores for the team: recent form, starts, DNPs
 *   - last season's game log for players with few games this season
 *   - the league injury feed (Out -> 0%, Day-To-Day -> at most 60%)
 *   - the schedule: tonight and the next games, with dates
 *
 * Never throws: anything it can't compute is reported on the item.
 */

const HORIZON = 15;          // games ahead
const RECENT = 20;           // games of form used
const DTD_CAP = 0.6;         // Day-To-Day: chance of playing at most this
const MIN_LINES = 8;         // fewer recent games than this -> "low" confidence
const MAX_PLAY = 0.97;       // late scratches and early exits happen: never 100%

const seasonEndYear = (iso) => { const [y, m] = iso.split("-").map(Number); return m >= 8 ? y + 1 : y; };

export async function buildWatch({ team, notesDate, milestones, espn, today, sims = 4000 }) {
  const tracked = await trackMilestones({ team, notesDate, milestones, espn });
  const warnings = [...tracked.warnings], problems = [...tracked.problems];
  const result = (items) => ({ team, today, notesDate, items, games: tracked.games, warnings, problems });

  const teams = await espn.teams();
  const espnTeam = teams.ok ? teams.data.ids[team] : null;
  const schedule = espnTeam ? await espn.schedule(espnTeam) : { ok: false, error: "no team" };
  if (!schedule.ok) { problems.push(`schedule unavailable: ${schedule.error}`); return result(tracked.milestones.map((m) => ({ ...base(m), note: "no schedule" }))); }

  const regular = schedule.data.games.filter((g) => g.seasonType === 2 && g.date);
  const upcoming = regular.filter((g) => !g.final && g.date >= today).slice(0, HORIZON);
  const played = regular.filter((g) => g.final).slice(-RECENT);
  const tonight = upcoming[0]?.date === today ? upcoming[0] : null;

  // This season's box scores (most recent first).
  const boxes = [];
  for (const g of [...played].reverse()) {
    const b = await espn.box(g.id);
    if (b.ok && b.data.final) boxes.push({ date: g.date, box: b.data });
    else warnings.push(`box score ${g.date} unavailable`);
  }
  const inj = await espn.injuries();
  if (!inj.ok) warnings.push(`injury feed unavailable (${inj.error}); everyone assumed available`);
  const injuries = inj.ok ? inj.data.players : {};

  const lastSeason = seasonEndYear(today) - 1;
  const formCache = new Map();
  async function formOf(id) {
    if (formCache.has(id)) return formCache.get(id);
    const lines = [];
    let appeared = 0, teamGames = 0;
    for (const { box } of boxes) {
      const l = box.players.find((p) => p.id === id);
      if (l) { teamGames++; if (l.played) { appeared++; lines.push({ stats: l.stats, started: l.started }); } }
    }
    let source = `${lines.length} games this season`;
    if (lines.length < RECENT) {
      const log = await espn.gameLog(id, lastSeason);
      if (log.ok) {
        const reg = log.data.types.filter((t) => /regular season/i.test(t.name) && !t.playIn).flatMap((t) => t.games);
        const extra = reg.slice(0, RECENT - lines.length).map((g) => ({ stats: g.stats, started: null }));
        if (extra.length) { lines.push(...extra); source += ` + ${extra.length} from ${lastSeason - 1}-${String(lastSeason).slice(2)}`; }
      }
    }
    // Box-score-only stats (dreb/oreb) for last season's games: share of rebounds from this season's games.
    const withSplit = lines.filter((l) => Number.isFinite(l.stats.dreb) && l.stats.reb > 0);
    const dShare = withSplit.length ? withSplit.reduce((a, l) => a + l.stats.dreb, 0) / withSplit.reduce((a, l) => a + l.stats.reb, 0) : null;
    for (const l of lines) {
      if (!Number.isFinite(l.stats.dreb) && dShare != null && Number.isFinite(l.stats.reb)) {
        l.stats = { ...l.stats, dreb: Math.round(l.stats.reb * dShare), oreb: l.stats.reb - Math.round(l.stats.reb * dShare) };
      }
    }
    // How often he has played in the team's recent games (coach's decisions count against).
    const recentTen = boxes.slice(0, 10);
    const inBox = recentTen.filter(({ box }) => box.players.some((p) => p.id === id));
    const playedTen = inBox.filter(({ box }) => box.players.find((p) => p.id === id)?.played).length;
    const pBase = Math.min(MAX_PLAY, inBox.length >= 3 ? Math.max(0.05, playedTen / inBox.length) : 0.9);
    const f = { lines, source, pBase, sample: makeSampler(lines) };
    formCache.set(id, f);
    return f;
  }

  const items = [];
  for (const m of tracked.milestones) {
    const it = base(m);
    items.push(it);
    const t = m.tracking || {};
    if (!t.espnId || t.need == null) { it.note = t.status === "off-roster" ? "not live" : "can't project (no player match or no need)"; continue; }
    if (t.reached) {
      if (t.delta > 0) { it.reached = true; it.note = `reached in the ${t.gamesSince} game(s) since the notes`; }
      else { it.stale = true; it.note = `the notes list a mark he had already passed (${t.current} vs ${t.target})`; }
      continue;
    }
    if (!upcoming.length) { it.note = "no upcoming games"; continue; }
    const f = await formOf(t.espnId);
    if (!f.lines.length) { it.note = "no recent games to project from"; continue; }
    const injury = injuries[t.espnId] || null;
    const pTonight = injury?.status === "Out" ? 0 : injury?.status === "Day-To-Day" ? Math.min(f.pBase, DTD_CAP) : f.pBase;
    // Out with a return date: 0 until then.
    const games = upcoming.map((g, i) => {
      let p = i === 0 ? pTonight : f.pBase;
      if (injury?.status === "Out" && injury.returnDate && g.date < injury.returnDate) p = 0;
      return { date: g.date, pPlay: p };
    });
    const sim = simulate({ need: t.need, stat: m.stat, sample: f.sample, games, sims, seed: hash(`${m.player}|${m.stat}|${t.need}`) });
    if (sim.unknown) { it.note = `no game-by-game data for ${m.stat}`; continue; }
    it.injury = injury ? { status: injury.status, comment: injury.comment, returnDate: injury.returnDate } : null;
    it.pPlayTonight = tonight ? games[0].pPlay : 0;
    it.pTonight = tonight ? round(sim.byGame[0]) : 0;
    it.pNext3 = round(sim.byGame[Math.min(2, sim.byGame.length - 1)]);
    it.pNext5 = round(sim.byGame[Math.min(4, sim.byGame.length - 1)]);
    it.pHorizon = round(sim.byGame[sim.byGame.length - 1]);
    it.horizonGames = upcoming.length;
    if (sim.medianGame != null) it.eta = { game: sim.medianGame + 1, date: upcoming[sim.medianGame].date };
    it.form = { source: f.source, games: f.lines.length, pPlay: round(f.pBase) };
    it.confidence = f.lines.length < MIN_LINES ? "low" : "normal";
  }
  return result(items);

  function base(m) {
    const t = m.tracking || {};
    const imp = importance(m);
    const live = t.status !== "off-roster";
    return {
      team: m.team, player: m.player, espnId: t.espnId || null, stat: m.stat, label: m.label, kind: m.kind, scope: m.scope,
      target: t.target ?? m.target, current: t.current ?? m.current, need: t.need ?? m.need,
      passing: m.passing ? { player: m.passing.player, total: m.passing.total, rank: m.passing.rank, forWhat: m.passing.forWhat } : null,
      importance: imp.score, why: imp.reasons,
      status: m.status, checks: m.checks || [], tracking: t.status || null,
      publishable: live && m.status === "ok" && t.status !== "disagrees",
      source: m.sources?.[0]?.text || null,
    };
  }
}

const round = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Order for the page: tonight's likely ones by chance x importance, then the rest by when. */
export function rank(items) {
  const live = items.filter((i) => i.pHorizon > 0 || i.reached);
  const tonight = live.filter((i) => i.pTonight >= 0.05).sort((a, b) => b.pTonight * b.importance - a.pTonight * a.importance);
  const soon = live.filter((i) => !tonight.includes(i) && i.eta).sort((a, b) => a.eta.game - b.eta.game || b.importance - a.importance);
  return { tonight, soon };
}
