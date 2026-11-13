/**
 * Tonight's storylines per game, from data the site already publishes (pure, browser-safe).
 *
 *   tonightStorylines({ watch, trends, leaders, injuries?, facts?, records?, matchups?, national?, maxLines? }) -> [{ id, away, home, start, lines: [{ kind, team, text, score }] }]
 *
 * Used by the Discord digest (scripts/notify.js, 6 lines a game) and the Watch List page
 * (docs/lib/anticipate/tonight.js, a copy kept identical by the build).
 *
 * Inputs are the parsed docs/data files: watch.json, trends.json, leaders.json.
 * Every line is something that can happen or end TONIGHT:
 *   milestone  a publishable round number or pass, importance 20+, with a 25%+ chance tonight
 *   streak     an active player streak (5+ games and notable), on the line tonight; only the
 *              biggest of a family per player (30+ points beats 25+ and 20+)
 *   lead       a run of 5+ straight games leading his team in a stat
 *   shooting   a qualified shooter one or two shots from crossing 50 / 40 / 90 either way
 *   tv         tonight's national TV game: a player clearly better or worse on national TV than in his other games;
 *              at most 2 a game
 *   form       hot hand: a regular's last 5 games 1+ SD above or below his own normal in points; at most 2 a game
 *   rest       a team on the 2nd night of a back-to-back, and its regulars whose scoring moves on no rest; at most 2 a game
 *   club       50-40-90 watch: qualified on all three lines and at all three, or within 1 point of them added up
 *   team       a team win or loss streak of 4+
 *   history    a line from tonight's team notes (docs/data/notes-facts.json): what the team's PR staff
 *              wrote about history made or in reach, verbatim; new-today lines first; at most 2 a game
 *   record     career leaderboards and records kept current from the Tip-Off Guide (docs/data/records.json,
 *              src/records/guide.js): passing a numbered all-time name, a round career number, a franchise
 *              record, with a 25%+ chance tonight; a coach's milestone or a team's place in the NBA's streak
 *              and best-start lists that tonight's game decides. Where the notes already carry the same
 *              milestone, theirs is kept; a notes history line about the same pass gives way to this one.
 *              A former MVP, Finals MVP or DPOY carries it: "James (4× MVP): ...".
 *   context    this season against his own career (records.json "context", src/records/yoy.js, from the NBA Guide's
 *              year-by-year stats): a big swing from last season or a career low / high ("Harden: 16.7 points a game,
 *              down 6.9 from 23.6 in 2025-26; his lowest since 2023-24"). Not an event tonight, so ranked low:
 *              at most 1 a game, shown when there's room.
 *   injury     a regular listed out / doubtful / questionable on the official injury report, with the
 *              team's record and teammates' numbers without him (src/injuries/impact.js); at most 2 a game.
 *              The report also removes every other line about a player listed Out or Doubtful, and
 *              marks a Questionable player's lines.
 * Lines are ranked by `score` (rough newsworthiness) and capped per game.
 */
import { cushion, needed } from "../situations/leaders.js";
import { formRows } from "../situations/form.js";

const SCOPE = { nba: "in NBA history", franchise: "in franchise history", career: "career", season: "this season" };
const STREAK_WEIGHT = { pts10: 0.4, three: 0.4, pts20: 1.2, threes3: 1.5, reb10: 1.5, ast8: 1.8, dd: 1.8, pts25: 2, pts30: 3 };
const STAT_WORD = { pts: "points", reb: "rebounds", ast: "assists", stl: "steals", blk: "blocks", fg3m: "3-pointers" };
const plural = (n, w) => (n === 1 ? w.replace(/s$/, "") : w);
const pct = (p) => `${Math.round(p * 100)}%`;
export const MAX_LINES = 6;
export const MIN_IMPORTANCE = 20; // stricter than NBA Live's cards (15): these go to a phone
const FAMILY = { pts10: "pts", pts20: "pts", pts25: "pts", pts30: "pts", three: "fg3", threes3: "fg3" };

function milestoneLines(watch, teams) {
  const out = [];
  for (const t of watch.teams || []) {
    if (!teams.has(t.team)) continue;
    for (const i of t.items || []) {
      if (!i.publishable || (i.kind !== "round" && i.kind !== "pass") || i.reached || i.stale) continue;
      const p = i.pTonight || 0;
      if (p < 0.25 || (i.importance || 0) < MIN_IMPORTANCE) continue;
      if (i.injury && /out/i.test(String(i.injury.status || i.injury))) continue;
      const label = i.label || i.stat;
      const what = i.kind === "pass"
        ? `passing ${i.passing?.player ?? "the next player"}${i.passing?.rank ? ` (No. ${i.passing.rank})` : ""} ${SCOPE[i.scope] || ""}`.trim()
        : i.scope === "career" || i.scope === "season"
          ? `${Number(i.target).toLocaleString("en-US")} ${i.scope} ${label}`
          : `${Number(i.target).toLocaleString("en-US")} ${label} ${SCOPE[i.scope] || ""}`.trim();
      out.push({ team: t.team, player: i.player, kind: "milestone", text: `${i.player}: ${i.need} ${plural(i.need, label)} from ${what} (${pct(p)} tonight)`, score: (i.importance || 0) / 10 + p, stat: i.stat, target: i.target, passing: i.passing?.player || null });
    }
  }
  return out;
}

function streakLines(trends, teams) {
  const out = [];
  const best = {};
  for (const s of trends.streaks || []) {
    const f = FAMILY[s.key];
    if (!f) continue;
    const k = `${s.id}|${f}`, w = STREAK_WEIGHT[s.key] ?? 1;
    if (!best[k] || s.length * w > best[k]) best[k] = s.length * w;
  }
  for (const s of trends.streaks || []) {
    if (FAMILY[s.key] && (STREAK_WEIGHT[s.key] ?? 1) * s.length < best[`${s.id}|${FAMILY[s.key]}`]) continue;
    if (!teams.has(s.team) || s.length < 5) continue;
    const w = STREAK_WEIGHT[s.key] ?? 1;
    if (s.length * w < 6) continue; // notable enough: e.g. 10+ points needs 15 straight, 20+ points 5
    const every = s.length === s.ofGames ? ", every game this season" : "";
    out.push({ team: s.team, player: s.name, kind: "streak", text: `${s.name}: ${s.label.toLowerCase()} in ${s.length} straight games${every}`, score: (s.length * w) / 5 });
  }
  return out;
}

function leadLines(leaders, teams) {
  const out = [];
  const K = Object.fromEntries((leaders.gameKeys || []).map((k, i) => [k, i]));
  for (const r of leaders.games || []) {
    const team = r[K.team], run = r[K.run];
    if (!teams.has(team) || run < 5) continue;
    const id = r[K.id], stat = r[K.stat], played = r[K.played];
    const every = run === played ? ", every game he's played" : "";
    out.push({ team, player: leaders.names?.[id] || id, kind: "lead", text: `${leaders.names?.[id] || id}: has led ${team} in ${STAT_WORD[stat] || stat} ${run} straight games${every}`, score: run / 4 });
  }
  return out;
}

function shootingLines(leaders, teams) {
  const out = [];
  const K = Object.fromEntries((leaders.shootKeys || []).map((k, i) => [k, i]));
  for (const r of leaders.shooting || []) {
    const team = r[K.team];
    if (!teams.has(team)) continue;
    const name = leaders.names?.[r[K.id]] || r[K.id];
    for (const L of leaders.lines || []) {
      const m = r[K[`${L.key}.m`]], a = r[K[`${L.key}.a`]], q = r[K[`${L.key}.q`]] === 1;
      if (!q || !a) continue;
      const c = cushion(m, a, L.pct), n = needed(m, a, L.pct);
      const p = ((100 * m) / a).toFixed(1);
      const what = L.key === "fg" ? "from the field" : L.key === "fg3" ? "on threes" : "from the line";
      if (n > 0 && n <= 2) out.push({ team, player: name, kind: "shooting", text: `${name}: ${n === 1 ? "1 make" : `${n} straight makes`} from ${L.pct}% ${what} (${p}%, ${m}-${a})`, score: 1.2 });
      else if (c === 0) out.push({ team, player: name, kind: "shooting", text: `${name}: one miss drops him below ${L.pct}% ${what} (${p}%, ${m}-${a})`, score: 1.2 });
    }
  }
  return out;
}

/**
 * 50-40-90 watch on the Watch List: a player qualified on all three lines who is at all three (and how
 * close he is to losing one), or within a point of them added up (Dosunmu, 0.3 short on 11/13). Few
 * players get here, so it ranks above a single line.
 */
export const CLUB_SHORT = 1.0;
function clubLines(leaders, teams) {
  const out = [];
  const K = Object.fromEntries((leaders.shootKeys || []).map((k, i) => [k, i]));
  const word = { fg: "from the field", fg3: "on threes", ft: "from the line" };
  for (const r of leaders.shooting || []) {
    const team = r[K.team];
    if (!teams.has(team)) continue;
    const L = (leaders.lines || []).map((l) => {
      const m = r[K[`${l.key}.m`]], a = r[K[`${l.key}.a`]];
      return { ...l, m, a, q: r[K[`${l.key}.q`]] === 1, p: a ? (100 * m) / a : 0, need: a ? needed(m, a, l.pct) : 0, cush: a ? cushion(m, a, l.pct) : 0 };
    });
    if (L.length !== 3 || !L.every((l) => l.q && l.a)) continue;
    const short = L.reduce((x, l) => x + Math.max(0, l.pct - l.p), 0);
    if (short > CLUB_SHORT) continue;
    const name = leaders.names?.[r[K.id]] || r[K.id];
    const line = L.map((l) => l.p.toFixed(1)).join(" / ");
    let text;
    if (short === 0) {
      const edge = L.filter((l) => l.cush === 0).map((l) => word[l.key]);
      text = `${name}: shooting 50-40-90 (${line})${edge.length ? `; one miss ${edge.join(" or ")} takes him off it` : ""}`;
    } else {
      const under = L.filter((l) => l.p < l.pct);
      text = `${name}: ${short.toFixed(1)} short of 50-40-90 (${line}); ${under.map((l) => `${l.need === 1 ? "1 make" : `${l.need} straight makes`} ${word[l.key]}`).join(" and ")} gets him there`;
    }
    out.push({ team, player: name, kind: "club", text, score: short === 0 ? 2.2 : 1.8 });
  }
  return out;
}

/**
 * National TV tonight: a player in tonight's national game whose national-TV games differ clearly from his
 * other (local / League Pass) games. Fair cutoff: 3+ national and 3+ other games, 20+ minutes a game in both,
 * and a points gap of 4+ that is also 20%+ of his other-games average. The injury report removes him as it
 * does every line (Out / Doubtful). national: docs/data/national.json.
 */
export const TV_MIN_GP = 3, TV_MIN_MIN = 20, TV_GAP = 4, TV_REL = 0.2;
function tvLines(national, teams, today) {
  const out = [];
  const games = (national?.upcoming || []).filter((g) => g.d === today && teams.has(g.away) && teams.has(g.home));
  for (const g of games) {
    const game = `${g.away}${g.neutral ? " vs " : " @ "}${g.home} on ${g.networks.join(" / ")}`;
    for (const p of national.players || []) {
      if (p.team !== g.away && p.team !== g.home) continue;
      const n = p.nat, o = p.other;
      if (!n || !o || n.gp < TV_MIN_GP || o.gp < TV_MIN_GP || n.min < TV_MIN_MIN || o.min < TV_MIN_MIN) continue;
      const gap = n.pts - o.pts;
      if (Math.abs(gap) < TV_GAP || Math.abs(gap) < TV_REL * o.pts) continue;
      const ts = n.tsPct != null && o.tsPct != null ? `; TS% ${n.tsPct.toFixed(0)} vs ${o.tsPct.toFixed(0)}` : "";
      out.push({ team: p.team, player: p.name, kind: "tv", score: 1.3 + Math.min(1, Math.abs(gap) / 10),
        text: `${p.name} on national TV: ${n.pts.toFixed(1)} points a game in ${n.gp} national games vs ${o.pts.toFixed(1)} in his other ${o.gp}${ts} (${gap > 0 ? "better" : "worse"} in the spotlight) · ${game}` });
    }
  }
  return out;
}

/**
 * Rest tonight (docs/data/rest.json, src/situations/rest.js): a team on the second night of a back-to-back, with what no rest
 * has meant for it this season, and its regulars whose scoring clearly moves on no rest (the user, 11/13). At most 2 a game.
 */
function restLines(rest, teams, today) {
  if (!rest || (rest.today && today && rest.today !== today)) return [];
  const out = [], sg = (x) => (x == null ? "–" : `${x > 0 ? "+" : ""}${x.toFixed(1)}`);
  for (const g of rest.tonight || []) {
    for (const [tri, r, opp, or] of [[g.away, g.awayRest, g.home, g.homeRest], [g.home, g.homeRest, g.away, g.awayRest]]) {
      if (r !== 0 || !teams.has(tri)) continue;
      const t = (rest.teams || []).find((x) => x.tri === tri), z = t?.by?.[0];
      const so = z && z.n ? ` (${z.w}-${z.l} on no rest this season, margin ${sg(z.marg)} vs ${sg(t.rest?.marg)} rested)` : " (its first this season)";
      out.push({ team: tri, kind: "rest", text: `${tri}: second night of a back-to-back${or != null && or > 0 ? `; ${opp} had ${or >= 3 ? "3+ days" : or === 1 ? "a day" : `${or} days`} off` : ""}${so}`, score: 2.0 + (z && z.n && t.gap != null ? Math.min(1, Math.abs(t.gap) / 10) : 0) });
      for (const p of (rest.players || []).filter((p) => p.tri === tri && p.flag)) {
        out.push({ team: tri, player: p.name, kind: "rest", text: `${p.name} on no rest: ${p.b2b.pts.toFixed(1)} points in ${p.b2bGp} back-to-back games vs ${p.rest.pts.toFixed(1)} otherwise (${p.b2b.min.toFixed(0)} minutes vs ${p.rest.min.toFixed(0)})`, score: 1.4 + Math.min(1, Math.abs(p.gap) / 10) });
      }
    }
  }
  return out;
}

/**
 * Hot hand (docs/data/form.json, src/situations/form.js): a regular playing tonight whose last 5 games are a clear 1+ SD above
 * (or below) his own normal in points, with the median agreeing (GameFlow's "real" test), 15+ points on the side that matters,
 * 20+ minutes every game, and his latest game within 10 days. At most 2 a game.
 */
export const FORM_LEN = 5, FORM_Z = 1.0, FORM_FLOOR = 15, FORM_MIN = 20;
function formLines(form, teams, today) {
  if (!form?.players) return [];
  const fresh = (d) => !today || (Date.parse(today) - Date.parse(d)) / 864e5 <= 10;
  const out = [];
  for (const dir of ["up", "down"]) {
    for (const r of formRows(form.players, { len: FORM_LEN, key: "pts", dir, floor: FORM_FLOOR, minMinutes: FORM_MIN })) {
      if (!teams.has(r.team) || !r.real || (dir === "up" ? r.z < FORM_Z : r.z > -FORM_Z) || !fresh(r.last)) continue;
      const n = dir === "up" ? r.above : r.below;
      out.push({ team: r.team, player: r.name, kind: "form", score: 1.4 + Math.min(1.2, (Math.abs(r.z) - 1) * 0.8),
        text: `${r.name} is ${dir === "up" ? "hot" : "cold"}: ${r.recentAvg.toFixed(1)} points over his last ${FORM_LEN} vs ${r.baseAvg.toFixed(1)} in his ${r.baseN} games before (${r.z > 0 ? "+" : ""}${r.z.toFixed(1)} SD; ${n} of ${FORM_LEN} ${dir === "up" ? "above" : "below"} normal)` });
    }
  }
  return out;
}

/**
 * Foul watch (docs/data/flowstats.json fouls + rotation, src/gameflow/stats.js; the user's pick, 11/13): a regular playing tonight
 * (5+ games, starts at least half) who has been in early foul trouble (more fouls than the period number) in half his games or
 * more. At most 2 a game.
 */
export const FOUL_SHARE = 0.5, FOUL_MIN_GP = 5;
function foulLines(flow, teams) {
  if (!flow?.fouls) return [];
  const out = [];
  for (const [id, f] of Object.entries(flow.fouls)) {
    const r = flow.rotation?.[id];
    if (!teams.has(f.team) || !r || f.gp < FOUL_MIN_GP || (r.starts || 0) < f.gp / 2 || f.trouble < FOUL_SHARE * f.gp) continue;
    out.push({ team: f.team, player: f.name, kind: "foul", score: 1.1 + Math.min(0.8, (f.trouble / f.gp - FOUL_SHARE) * 2),
      text: `${f.name}: in early foul trouble in ${f.trouble} of ${f.gp} games this season${f.out ? `, fouled out ${f.out === 1 ? "once" : `${f.out} times`}` : ""} (2 fouls in the 1st, 3 by the half…)` });
  }
  return out;
}

/**
 * Left early (docs/data/flowstats.json leftEarly; 0.60): a starter on tonight's teams who left a game in the last 3 days
 * in the first half and never came back (not a foul-out), when he usually plays the second half. Status news more often
 * than not.
 */
export const EARLY_DAYS = 3;
function earlyLines(flow, teams, today) {
  if (!flow?.leftEarly) return [];
  const at = (t) => { const q = Math.floor(t / 720) + 1, left = q * 720 - t; return `Q${q} ${Math.floor(left / 60)}:${String(Math.round(left % 60)).padStart(2, "0")}`; };
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return flow.leftEarly.filter((e) => teams.has(e.team) && e.date && (!today || ((Date.parse(today) - Date.parse(e.date)) / 864e5 <= EARLY_DAYS && e.date < today)))
    .map((e) => ({ team: e.team, player: e.name, kind: "early", score: 2.6,
      text: `${e.name} left ${md(e.date)} vs ${e.opp} at ${at(e.out)} and didn't return (${e.min} min, ${e.pts} pts); he usually plays the second half` }));
}

function teamLines(trends, teams) {
  const out = [];
  for (const [team, t] of Object.entries(trends.teams || {})) {
    if (!teams.has(team) || !t.streak || t.streak.n < 4) continue;
    out.push({ team, kind: "team", text: `${team}: ${t.streak.type === "W" ? "won" : "lost"} ${t.streak.n} straight`, score: t.streak.n / 3 });
  }
  return out;
}

// Names compared across sources (accents, punctuation, suffixes, hyphens ignored).
const nameKey = (n) => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.'’]/g, "").replace(/-/g, " ").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ").replace(/\s+/g, " ").trim();

function injuryLines(injuries, teams, today) {
  if (!injuries || (injuries.date && today && injuries.date !== today)) return [];
  return (injuries.impact || []).filter((x) => teams.has(x.team)).map((x) => ({ team: x.team, kind: "injury", text: x.text, score: x.score }));
}

// Tonight's matchups (records/matchup.js via docs/data/matchups.json): the series, and players against tonight's opponent.
function matchupLines(matchups, teams, today) {
  if (!matchups || (matchups.today && today && matchups.today !== today)) return [];
  const out = [];
  for (const g of matchups.games || []) {
    if (!teams.has(g.away) && !teams.has(g.home)) continue;
    for (const i of (g.items || []).slice(0, 6)) out.push({ team: i.team, player: i.player || null, kind: "matchup", game: `${g.away}@${g.home}`, text: `${i.tag}: ${i.text}`, score: Math.min(4.2, (i.score || 1) + (i.active ? 0.3 : 0)) });
  }
  return out;
}

function historyLines(facts, teams, today) {
  if (!facts || (facts.today && today && facts.today !== today)) return [];
  const out = [];
  for (const [team, list] of Object.entries(facts.teams || {})) {
    if (!teams.has(team)) continue;
    // Readable on its own: names a player, or names the team / says "team" / "franchise".
    for (const f of list) {
      if (!f.player && !/\b(?:team|franchise|club)\b/i.test(f.text) && !new RegExp(`\\b${team}\\b`).test(f.text) && /^(?:He|His|She|They|It|With|Became|Recorded|Notched|Has|Is)\b/.test(f.text)) continue;
      // A line that doesn't name its player ("He can become…", "Logged his 39th…") carries the name in front.
      const last = f.player ? f.player.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV)$/, "").split(" ").pop() : null;
      const who = last && !f.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(last) ? ` — ${f.player}:` : ":";
      if (f.hook?.stale) continue; // a club the box scores say he has left since the notes were written
      const body = f.text.length > 240 ? f.text.slice(0, 237).replace(/\s+\S*$/, "") + "…" : f.text;
      // The tag up front ("1 of 2 this season"), the hook behind ("Stays in it with 18+ points tonight").
      const tag = f.tag && f.tag !== "Notes" ? `${f.tag} · ` : "";
      out.push({ team, player: f.player, kind: "history", text: `${team} notes${who} ${tag}${body}${f.hook?.text ? ` → ${f.hook.text}` : ""}`, score: Math.min(4.8, f.score), isNew: f.isNew });
    }
  }
  return out;
}

const surname = (n) => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV)$/, "").split(" ").pop().toLowerCase();

// A headline award in front of a record line: "James (4× MVP): ...". MVP, Finals MVP and DPOY only, the first one.
function withAward(text, who, awards) {
  const top = String(awards?.[who] || "").split(" · ")[0];
  return /^(?:\d+× )?(?:MVP|Finals MVP|DPOY)$/.test(top) ? text.replace(/^([^:(]+):/, `$1 (${top}):`) : text;
}

function recordLines(records, teams, today, milestones) {
  if (!records || (records.today && today && records.today !== today)) return [];
  const out = [];
  for (const i of records.items || []) {
    if (!i.tonight || !teams.has(i.team)) continue;
    if (i.kind === "pass" || i.kind === "round" || i.kind === "franchise" || i.kind === "cup") {
      const p = i.pTonight || 0;
      if (p < 0.25) continue;
      // The notes' own version of the same milestone wins (same player and stat, same mark or same name passed).
      const dup = milestones.some((m) => m.team === i.team && m.stat === i.stat && nameKey(m.player) === nameKey(i.who)
        && (m.target === i.target || m.target === i.target - 1 || (m.passing && i.passing && i.passing.name.split(" and ").some((n) => surname(n) === surname(m.passing)))));
      if (dup) continue;
      out.push({ team: i.team, player: i.who, kind: "record", text: withAward(`${i.text} (${pct(p)} tonight)`, i.who, records.awards), score: i.score + p, passing: i.passing?.name || null });
    } else if (i.need === 1) {
      const text = i.kind === "coach"
        ? i.stat === "games" ? `${i.text.replace(/: 1 game from passing/, ": coaches tonight to pass")}` : `${i.text.replace(/: 1 win from passing/, ": a win tonight passes")}`
        : i.text;
      out.push({ team: i.team, kind: "record", text, score: i.score });
    }
  }
  return out;
}

function contextLines(records, teams, today) {
  if (!records || !Array.isArray(records.context) || (records.today && today && records.today !== today)) return [];
  // Regulars only (24+ minutes a game last season), points / rebounds / assists; a swing from last season first.
  return records.context.filter((c) => teams.has(c.team) && c.games >= 8 && (c.lastMin ?? 0) >= 24 && ["pts", "reb", "ast"].includes(c.stat)
    && (c.kind === "change" || (c.since === null && c.last >= ({ pts: 15, reb: 7, ast: 5 })[c.stat])))
    .map((c) => ({ team: c.team, player: c.name, kind: "context", text: c.text, score: Math.min(1.7, 0.8 + c.score / 5 + (c.kind === "change" ? 0.2 : 0) + (c.stat === "pts" ? 0.1 : 0)) }))
    // A franchise single-season record on pace (src/records/franchiseSeason.js): only the record itself.
    .concat((records.seasonPace || []).filter((x) => x.place === 1 && teams.has(x.team))
      .map((x) => ({ team: x.team, player: x.who, kind: "context", text: x.text, score: Math.min(1.9, x.score - 0.2 + (["pts", "reb", "ast"].includes(x.stat) ? 0.1 : 0)) })));
}

/**
 * The injury report as a lookup: (team, player name) -> "Out" / "Doubtful" / "Questionable" / … or undefined.
 * Only a report for tonight's date counts.
 */
export function injuryStatus(injuries, today) {
  const listed = new Map();
  if (injuries && (!injuries.date || !today || injuries.date === today)) for (const p of injuries.players || []) listed.set(`${p.team}|${nameKey(p.name)}`, p.status);
  return (team, player) => (player ? listed.get(`${team}|${nameKey(player)}`) : undefined);
}

export function tonightStorylines({ watch, trends = {}, leaders = {}, injuries = null, facts = null, records = null, matchups = null, national = null, rest = null, form = null, fouls = null, maxLines = MAX_LINES }) {
  const games = (watch.games || []).map((g) => ({ id: g.id, away: g.awayTri, home: g.homeTri, start: g.start }));
  const teams = new Set(games.flatMap((g) => [g.away, g.home]));
  // The injury report overrules the rest: a player listed Out or Doubtful loses his other lines
  // (no "54% tonight" for a man who isn't playing); a Questionable one is marked.
  const listed = new Map();
  if (injuries && (!injuries.date || !watch.today || injuries.date === watch.today)) for (const p of injuries.players || []) listed.set(`${p.team}|${nameKey(p.name)}`, p.status);
  const miles = milestoneLines(watch, teams);
  const recs = recordLines(records, teams, watch.today, miles);
  // A notes history line about a pass this record line already carries (both names in it) gives way.
  const hist = historyLines(facts, teams, watch.today).filter((h) => !recs.some((r) => r.player && r.passing && r.team === h.team
    && new RegExp(`\\b${surname(r.player)}\\b`, "i").test(h.text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    && r.passing.split(" and ").some((n) => new RegExp(`\\b${surname(n)}\\b`, "i").test(h.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")))));
  const others = [...hist, ...miles, ...recs, ...streakLines(trends, teams), ...leadLines(leaders, teams), ...shootingLines(leaders, teams).filter((l) => !clubLines(leaders, teams).some((c) => c.player === l.player)), ...clubLines(leaders, teams), ...teamLines(trends, teams), ...contextLines(records, teams, watch.today), ...matchupLines(matchups, teams, watch.today), ...tvLines(national, teams, watch.today), ...restLines(rest, teams, watch.today), ...formLines(form, teams, watch.today), ...foulLines(fouls, teams), ...earlyLines(fouls, teams, watch.today)]
    .flatMap((l) => {
      const st = l.player ? listed.get(`${l.team}|${nameKey(l.player)}`) : null;
      if (st === "Out" || st === "Doubtful") return [];
      return [st === "Questionable" ? { ...l, text: `${l.text} · questionable tonight`, score: l.score * 0.8 } : l];
    });
  const all = [...injuryLines(injuries, teams, watch.today), ...others];
  return games.map((g) => {
    let inj = 0, hist = 0, ctx = 0, mu = 0, tv = 0, rs = 0, fm = 0, fo = 0;
    const ranked = all.filter((l) => (l.team === g.away || l.team === g.home) && (l.kind !== "matchup" || l.game === `${g.away}@${g.home}`)).sort((a, b) => b.score - a.score)
      .filter((l) => (l.kind !== "injury" || ++inj <= 2) && (l.kind !== "history" || ++hist <= 2) && (l.kind !== "context" || ++ctx <= 1) && (l.kind !== "matchup" || ++mu <= 2) && (l.kind !== "tv" || ++tv <= 2) && (l.kind !== "rest" || ++rs <= 2) && (l.kind !== "form" || ++fm <= 2) && (l.kind !== "foul" || ++fo <= 2));
    // The user asked for these two on the Watch List: the best of each keeps a place even on a crowded night.
    const lines = ranked.slice(0, maxLines);
    for (const k of ["club", "tv"]) {
      const best = ranked.find((l) => l.kind === k);
      if (best && !lines.includes(best) && lines.length) lines[lines.length - 1 - (k === "tv" && lines[lines.length - 1].kind === "club" ? 1 : 0)] = best;
    }
    return { ...g, lines };
  });
}

export { discordDigest } from "./discord-digest.js";
