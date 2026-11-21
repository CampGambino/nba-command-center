/**
 * The data behind the feat boards and live streaks (0.142): docs/data/featlive.json, read by NBA Live through the bridge
 * (featChecks, streakChecks) and by the site's storylines. Pure: no I/O. The rules are src/records/featlive.js.
 *
 *   buildFeatLive({ file, pg, names, tonightTeams, notesFacts }) -> { v, asOf, through, boards, pre, streaks, teamStreaks, teamEnded, problems }
 *
 * file: src/data/feat-boards-<date>.json (the user's screenshots, counts through file.asOf). pg: this season's games per
 * player (src/situations/trends.js playerGames, Cup final left out). A board row's count now = the screenshot's + his
 * qualifying games since file.asOf; `games` names those games so NBA Live never counts tonight's twice.
 */
import { qualifies, featNext, streakMet } from "./featlive.js";
import { strictKey } from "./guide.js";
import { noteStreak } from "../anticipate/prep.js";
import { TEAMS } from "../teams.js";

const SEASON_NOW = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7), s = m >= 8 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; };

export function buildFeatLive({ file, pg, names = {}, tonightTeams = null, notesFacts = null }) {
  const problems = [];
  const through = Object.values(pg).reduce((m, gs) => (gs.length && gs[gs.length - 1].d > m ? gs[gs.length - 1].d : m), "");
  const season = through ? SEASON_NOW(through) : null;
  // This season's players by name (two players with one name: neither is matched).
  const byKey = new Map();
  for (const id of Object.keys(pg)) { const k = strictKey(names[id] || id); byKey.set(k, byKey.has(k) ? null : id); }
  const idOf = (name) => byKey.get(strictKey(name)) ?? null;
  const teamOf = (id) => { const gs = pg[id] || []; return gs.length ? gs[gs.length - 1].team : null; };

  const boards = {}, pre = [];
  for (const [key, b] of Object.entries(file.boards || {})) {
    const rows = (b.rows || []).map(([name, from, to, count]) => {
      const id = idOf(name), gs = id ? pg[id] : null;
      if (!gs) return { name, now: count, base: count };
      const q = gs.filter((g) => qualifies(b, g));
      const since = q.filter((g) => g.d > file.asOf);
      // The screenshot's last season with such a game against our box scores: a misread count or filter shows here.
      const upTo = q.filter((g) => g.d <= file.asOf);
      if (upTo.length && to !== season) problems.push(`${key}: ${name} has ${upTo.length} such game${upTo.length > 1 ? "s" : ""} this season by ${file.asOf} but the list says his last was ${to}`);
      if (!upTo.length && to === season) problems.push(`${key}: ${name}'s last such game is this season on the list, none in our box scores by ${file.asOf}`);
      return { name, id, team: teamOf(id), live: true, base: count, now: count + since.length, games: since.map((g) => g.gameId), season: q.length, gp: gs.length };
    });
    boards[key] = { label: b.label, one: b.one, short: b.short, min: b.min, ...(b.max ? { max: b.max } : {}), ...(b.td ? { td: true } : {}), ...(b.caveat ? { caveat: b.caveat } : {}),
      complete: !!b.complete, floor: rows.length ? Math.min(...rows.map((r) => r.base)) : null, rows };
    // Pre-game: what his next one would do, for a player whose team plays tonight.
    for (const r of rows) {
      if (!r.live || (tonightTeams && !tonightTeams.has(r.team))) continue;
      const n = featNext(boards[key], r);
      // Worth a line: a count of 3 or more, and something he does now (a game like it this season), or a record, or the top 10.
      if (!n || n.after < 3 || !(r.season > 0 || n.record || n.place <= 10)) continue;
      pre.push({ board: key, id: r.id, name: r.name, team: r.team, now: r.now, place: n.place, record: n.record, line: `${n.line} (${r.season ? `${r.season} of his ${r.gp} games this season` : `none in his ${r.gp} games this season`})`,
        // Scored with the storylines' other lines (a night's eighth is about 4.8): a record he holds and does often makes it;
        // a long shot (none this season) doesn't.
        score: 3 + (n.record ? (r.season ? 1.2 : 0.4) : n.place <= 5 ? 0.6 : n.place <= 10 ? 0.3 : 0) + Math.min(1, r.gp ? (r.season / r.gp) * 3 : 0) });
    }
  }

  // ---- streaks still going entering tonight ----
  const streaks = [];
  // (a) Lists of the longest runs (the made-three list): an active run, carried on by our box scores since the list's date.
  for (const [key, S] of Object.entries(file.streaks || {})) {
    const others = S.rows.map(([name, team, n, start, end, active]) => ({ name, team, n, start, end, active }));
    for (const r of others.filter((x) => x.active)) {
      const id = idOf(r.name), gs = id ? pg[id] : null;
      if (!gs) { problems.push(`streak ${key}: ${r.name} not matched this season`); continue; }
      const lastIn = gs.filter((g) => g.d <= file.asOf).pop();
      if (lastIn && lastIn.d !== r.end) { problems.push(`streak ${key}: ${r.name}'s list run ends ${r.end}, his last game by ${file.asOf} is ${lastIn.d}`); continue; }
      const after = gs.filter((g) => g.d > file.asOf);
      const broke = after.findIndex((g) => !streakMet([{ k: Object.keys(S.min)[0], min: Object.values(S.min)[0] }], g));
      if (broke >= 0) continue;                                    // ended since the list: nothing live
      const n = r.n + after.length;
      const list = others.filter((x) => x !== r).map((x) => ({ name: x.name, n: x.n, start: x.start }));
      streaks.push({ id, name: names[id] || r.name, team: teamOf(id), tests: [{ k: Object.keys(S.min)[0], min: Object.values(S.min)[0] }], label: S.label, n, source: "list",
        since: S.since, list, last: gs[gs.length - 1].d });
    }
  }
  // (b) The teams' game notes: a run they name that our box scores show still going, of at least their count and no longer
  // than it plus his games since the note (or a run to start the season that is every game he has played).
  const seen = new Set(streaks.map((s) => `${s.id}|${JSON.stringify(s.tests)}`));
  for (const [team, facts] of Object.entries(notesFacts?.teams || {})) for (const f of facts || []) {
    const id = f.playerId && String(f.playerId), gs = id && pg[id];
    if (!gs || gs.length < 3) continue;
    const st = noteStreak(f.text);
    if (!st) continue;
    const key = `${id}|${JSON.stringify(st.tests)}`;
    if (seen.has(key)) continue;
    let n = 0; for (let i = gs.length - 1; i >= 0 && streakMet(st.tests, gs[i]); i--) n++;
    const since = f.firstSeen ? gs.filter((x) => x.d >= f.firstSeen).length : 0;
    const wholeSeason = st.fromStart && n === gs.length;
    if (n < 3 || n < st.n || (n > st.n + since + 1 && !wholeSeason)) continue;
    seen.add(key);
    streaks.push({ id, name: names[id] || f.player, team: teamOf(id) || team, tests: st.tests, label: st.label, n, source: "notes", note: f.text, ...(st.fromStart ? { fromStart: true } : {}), last: gs[gs.length - 1].d });
  }

  // (c) Team runs in the notes: wins over one opponent (home or not), 100+ points against one opponent, wins when holding
  // the opponent to N or fewer. The notes' count, carried on by this season's games since the date it is as of.
  const teamStreaks = [], teamEnded = [];
  const teamGames = teamGamesOf(pg);
  for (const [team, facts] of Object.entries(notesFacts?.teams || {})) for (const f of facts || []) {
    if (f.playerId) continue;
    const t = teamStreakOf(f.text, team);
    if (!t) continue;
    const asOf = t.asOf ? `${through.slice(0, 4)}-${t.asOf}` : f.firstSeen ? prevDay(f.firstSeen) : null;
    if (!asOf) continue;
    let n = t.n, ended = false;
    for (const g of (teamGames[team] || []).filter((g) => g.d > asOf)) {
      if ((t.kind === "winVs" || t.kind === "ptsVs") && (g.opp !== t.opp || (t.home && !g.home))) continue;
      if (t.kind === "winHolding" && g.them > t.max) continue;
        const ok = t.kind === "ptsVs" ? g.us >= t.min : g.us > g.them;
      if (ok) n++; else { ended = { d: g.d, us: g.us, them: g.them, opp: g.opp }; break; }
    }
    if (ended) { teamEnded.push({ team, label: t.label, n, ...ended }); continue; }   // over since the notes' count
    teamStreaks.push({ ...t, team, n, asOf, note: f.text });
  }
  return { v: 1, asOf: file.asOf, through, source: file.source, boards, pre: pre.sort((a, b) => b.score - a.score), streaks, teamStreaks, teamEnded, problems };
}

function prevDay(d) { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); }

/** Each team's games this season from the player lines: { TRI: [{ d, gameId, opp, home, us, them }] } (final scores from the box). */
function teamGamesOf(pg) {
  const G = {};
  for (const gs of Object.values(pg)) for (const g of gs) {
    const k = `${g.team}|${g.gameId}`;
    const x = (G[k] ??= { team: g.team, d: g.d, gameId: g.gameId, opp: g.opp, home: g.home, us: 0, win: g.win });
    x.us += g.pts || 0;
  }
  const out = {};
  for (const x of Object.values(G)) (out[x.team] ??= []).push(x);
  for (const L of Object.values(out)) for (const x of L) { const o = (out[x.opp] || []).find((y) => y.gameId === x.gameId); x.them = o ? o.us : null; }
  for (const L of Object.values(out)) L.sort((a, b) => a.d.localeCompare(b.d));
  return out;
}

const MONTHS = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12" };
const NUM = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
/** A team run in a notes sentence, or null. Nicknames and cities name the opponent ("against Utah", "against the Rockets"). */
export function teamStreakOf(text, team) {
  const t = String(text || "");
  const num = (w) => (/^\d+$/.test(w) ? +w : NUM[String(w).toLowerCase()] ?? null);
  const opp = (w) => {
    const s = String(w || "").replace(/^the\s+/i, "").replace(/[.,;:]+$/, "").trim().toLowerCase();
    for (const [tri, T] of Object.entries(TEAMS)) if (tri !== team && (T.nick.toLowerCase() === s || T.city.toLowerCase() === s || `${T.city} ${T.nick}`.toLowerCase() === s)) return tri;
    return null;
  };
  const dm = /\b(?:on|as of|through)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?\s+(\d{1,2})\b/i.exec(t);
  const asOf = dm ? `${MONTHS[dm[1].toLowerCase()]}-${dm[2].padStart(2, "0")}` : null;
  let m = /\bwon (\w+) (?:consecutive|straight) (home )?games (?:against|vs\.?|over) ((?:the )?[A-Z][\w.]*(?: [A-Z][\w.]*)?)/.exec(t);
  if (m && num(m[1]) && opp(m[3])) return { kind: "winVs", n: num(m[1]), opp: opp(m[3]), home: !!m[2], asOf, label: `${m[2] ? "home " : ""}wins over the ${TEAMS[opp(m[3])].nick}` };
  m = /\bscored (\d+)\+ points in (\w+) (?:consecutive|straight) games (?:against|vs\.?) ((?:the )?[A-Z][\w.]*(?: [A-Z][\w.]*)?)/.exec(t);
  if (m && num(m[2]) && opp(m[3])) return { kind: "ptsVs", n: num(m[2]), min: +m[1], opp: opp(m[3]), asOf, label: `games with ${m[1]}+ points against the ${TEAMS[opp(m[3])].nick}` };
  m = /\bwon (\w+) (?:consecutive|straight) games when holding (?:opponents|their opponents|teams) to (\d+) points or (?:fewer|less)/.exec(t);
  if (m && num(m[1])) return { kind: "winHolding", n: num(m[1]), max: +m[2], asOf, label: `wins when holding the opponent to ${m[2]} or fewer` };
  return null;
}
