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
      if (!i.publishable || (i.kind !== "round" && i.kind !== "pass") || i.reached || i.stale || i.minor) continue;
      const p = i.pTonight || 0;
      if (p < 0.25 || (i.importance || 0) < MIN_IMPORTANCE) continue;
      if (i.injury && /out/i.test(String(i.injury.status || i.injury))) continue;
      const label = i.label || i.stat;
      const what = i.kind === "pass"
        ? `passing ${i.passing?.player ?? "the next player"}${i.passing?.rank ? ` (No. ${i.passing.rank})` : ""} ${SCOPE[i.scope] || ""}`.trim()
        : i.scope === "career" || i.scope === "season"
          ? `${Number(i.target).toLocaleString("en-US")} ${i.scope} ${label}`
          : `${Number(i.target).toLocaleString("en-US")} ${label} ${SCOPE[i.scope] || ""}`.trim();
      out.push({ team: t.team, player: i.player, kind: "milestone", text: `${i.player}: ${i.need} ${plural(i.need, label)} from ${what} (${pct(p)} tonight)`, score: (i.importance || 0) / 10 + p, stat: i.stat, target: i.target, passing: i.passing?.player || null, ...(i.siteOnly ? { siteOnly: true } : {}) });
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
    // 0.145.0: a run carried over from last season says so (trends.js activeStreaks: thisSeason, carried).
    const every = s.carried ? `, going back to last season (every game this season, ${s.thisSeason})` : s.length === s.ofGames ? ", every game this season" : "";
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
  const games = (national?.upcoming || []).filter((g) => g.d === today && g.status !== "dropped" && teams.has(g.away) && teams.has(g.home));
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

/**
 * Fourth quarters (docs/data/flowstats.json `fourth`; 0.72.6, the user 11/15: "fourth quarter minutes for starters to see
 * which ones are getting benched"; the posts: "he's sat out the 4th quarter in 7 of 13 games"). Two different stories:
 *   rest     a scorer who hasn't played in the 4th in 3+ of his starts (30%+), with his team's record in those games;
 *   benched  a starter not on the floor to finish his team's last 3+ close games when he used to be, or one who
 *            finishes a quarter or fewer of the close games he starts (5+).
 * Close = within 5 in the last five minutes of regulation; finishing = on the floor for half of the last three.
 * 0.112: the two are different windows, and the line named only the first, so a starter who played most of the last
 * five minutes and was taken out for the final 1:33 read as if he had missed the close of the game altogether (Josh
 * Hart, 11/11/26; the user asked). The line now says "at the end", when he left in the latest one, and both rules.
 */
export const FOURTH = { sat: 3, share: 0.3, ppg: 18, miss: 3, close: 5, rarely: 0.25 };
function fourthLines(flow, teams) {
  if (!flow?.fourth) return [];
  const out = [];
  const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
  // The latest close game he did not finish: when he left it, and how many of the run he sat the whole 4th of.
  const sat = (q, e) => (q.satIn || []).includes(e.gameId) || e.gone >= 720;
  const latest = (q) => { const e = q.ends[q.ends.length - 1]; if (!e || e.fin || !(sat(q, e) || e.gone > 0)) return "";
    return `, most recently ${+e.date.slice(5, 7)}/${+e.date.slice(8, 10)} vs ${e.opp} (${sat(q, e) ? "didn't play in the 4th" : `out for the last ${Math.floor(e.gone / 60)}:${String(e.gone % 60).padStart(2, "0")}`})`; };
  const satRun = (q) => { const run = q.ends.slice(-q.miss), n = run.length === q.miss ? run.filter((e) => sat(q, e)).length : 0; return n >= 2 ? `; he sat the whole 4th in ${n} of them` : ""; };
  const RULE = "close: within 5 in the last five minutes; at the end: on the floor for half of the last three";
  for (const q of Object.values(flow.fourth)) {
    if (!teams.has(q.team)) continue;
    const before = q.close - q.miss, beforeFin = q.closed;                    // close games before the current run, and those he finished
    if (q.miss >= FOURTH.miss && before >= 2 && beforeFin / before >= 0.5) {
      out.push({ team: q.team, player: q.name, kind: "fourth", score: 3.7 + Math.min(0.5, 0.1 * q.miss),
        text: `${q.name} started but wasn't on the floor at the end of ${q.team}'s last ${q.miss} close games${latest(q)}${satRun(q)}; he had finished ${beforeFin} of ${before} before (${RULE})` });
    } else if (q.close >= FOURTH.close && q.closed / q.close <= FOURTH.rarely) {
      out.push({ team: q.team, player: q.name, kind: "fourth", score: 2.7 + (q.closed === 0 ? 0.3 : 0),
        text: `${q.name} has ${q.closed === 0 ? "not finished any" : `finished ${q.closed}`} of the ${q.close} close games he has started for ${q.team} (${RULE})` });
    } else if (q.sat >= FOURTH.sat && q.sat / q.gs >= FOURTH.share && q.satPts / q.sat >= FOURTH.ppg) {
      const m = q.satMargin / q.sat;
      const how = q.satMin >= 15 ? `every one decided by ${Math.floor(q.satMin / 5) * 5}+` : `${m >= 0 ? "+" : ""}${r1(m)} a game`;
      out.push({ team: q.team, player: q.name, kind: "fourth", score: 3.1 + Math.min(0.6, q.sat / q.gs),
        text: `${q.name} hasn't played in the 4th quarter in ${q.sat} of his ${q.gs} starts: ${q.team} ${q.satW}-${q.sat - q.satW} in those (${how}), and he averages ${r1(q.satPts / q.sat)} points in them` });
    }
  }
  return out;
}

/**
 * The final two minutes (flowstats.json `l2m`; 0.72.7): games within 3 at some point in the last two minutes of the 4th
 * or overtime, the window of the league's Last Two Minute reports. A team at either end of the record in them (4+
 * games), and the league's top scorers in those stretches (15+ points).
 */
function lastTwoLines(flow, teams) {
  const L = flow?.l2m;
  if (!L) return [];
  const out = [];
  for (const t of Object.values(L.teams || {})) {
    if (!teams.has(t.team) || t.games < 4) continue;
    const share = t.w / t.games;
    if (share > 0.2 && share < 0.8) continue;
    out.push({ team: t.team, kind: "fourth", score: 3.0 + Math.min(0.6, Math.abs(share - 0.5)) + (t.games >= 6 ? 0.2 : 0),
      text: `${t.team} is ${t.w}-${t.l} in games within 3 in the final two minutes, ${t.pts >= t.opp ? "outscoring opponents" : "outscored"} ${t.pts >= t.opp ? `${t.pts}-${t.opp}` : `${t.opp}-${t.pts}`} in those two-minute stretches` });
  }
  (L.top || []).slice(0, 3).forEach((p, i) => {
    if (!teams.has(p.team) || p.pts < 15) return;
    out.push({ team: p.team, player: p.name, kind: "fourth", score: 3.1 - 0.1 * i,
      text: `${p.name} has ${p.pts} points in the final two minutes of close games (${i === 0 ? "the most" : i === 1 ? "2nd-most" : "3rd-most"} in the NBA): ${p.fgm}-${p.fga} FG, ${p.ftm}-${p.fta} FT in ${p.gp} games (within 3 in the last two minutes)` });
  });
  return out;
}

/**
 * 0.79 (posts the user sent, 11/16), all from the Game Flow files, every team and player:
 *  - games lost after leading by 10+ in a row ("blown a double-digit lead in 3 straight games"): from two, with what a
 *    loss tonight would make it against the season's longest run;
 *  - the record when leading by 10+ ("4-5 when leading by 10+ points… 1 of 5 teams with a losing record"): a losing
 *    record, or among the three teams with the most such losses;
 *  - shots to tie or take the lead in the last 90 seconds of the 4th or overtime: the league's three with the most makes;
 *  - a full half or a full game ("players who play full halves (rare) and full games (almost never)"): anyone who did
 *    it in his team's last game, with how often it has happened this season.
 */
export const BY10 = { run: 2, losses: 3, swingMakes: 3, fullDays: 4 };
export function flowTeamLines(flow, teams, today = null) {
  const out = [], B = flow?.by10 || {}, md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  const tris = Object.keys(B);
  const seasonLongest = tris.reduce((m, t) => Math.max(m, B[t].longest || 0), 0);
  const losing = tris.filter((t) => B[t].upL > B[t].upW);
  const lossRank = (n) => tris.filter((t) => B[t].upL > n).length + 1;
  for (const t of tris) {
    if (!teams.has(t)) continue;
    const x = B[t], n = x.run.length;
    if (n >= BY10.run) {
      const next = n + 1;
      out.push({ team: t, kind: "team", key: `blown10|${t}`, rare: next > seasonLongest, score: 3.2 + 0.4 * (n - 2) + (next > seasonLongest ? 0.3 : 0),
        text: `${t} has lost its last ${n} games after leading by 10+ (${x.run.map((g) => `${g.lead} vs ${g.opp} ${md(g.d)}`).join(", ")}); a ${ordinalWord(next)} straight tonight would ${next > seasonLongest ? "be the longest such run in the NBA this season" : next === seasonLongest ? `tie the season's longest (${seasonLongest})` : `leave it short of the season's longest (${seasonLongest})`}` });
    }
    // 0.82: games in a row won after trailing by 10+ (the Warriors' notes: four straight, 10/30 to 11/5).
    if ((x.backRun || []).length >= BY10.run) {
      const nb = x.backRun.length, best = tris.reduce((m, o) => Math.max(m, B[o].longestBack || 0), 0);
      out.push({ team: t, kind: "team", key: `back10|${t}`, rare: nb >= 3, score: 3.2 + 0.4 * (nb - 2) + (nb + 1 > best ? 0.3 : 0),
        text: `${t} has won its last ${nb} games after trailing by 10+ (${x.backRun.map((g) => `${g.down} down to ${g.opp} ${md(g.d)}`).join(", ")}); a ${ordinalWord(nb + 1)} straight tonight would ${nb + 1 > best ? "be the longest such run in the NBA this season" : `tie the season's longest (${best})`}` });
    }
    // 0.81: a lead of 15+ held in the 4th quarter and lost (or won back), with the league's record in such games.
    if ((x.lateLost || []).length || (x.lateWon || []).length) {
      const W = tris.reduce((a, o) => a + (B[o].lateW || 0), 0), L = tris.reduce((a, o) => a + (B[o].lateLost || []).length, 0);
      const fmt = (g, k) => `${g[k]} ${k === "lead" ? "up on" : "down to"} ${g.opp} ${md(g.d)}`;
      if (x.lateLost.length) out.push({ team: t, kind: "team", key: `late15|${t}|lost`, rare: true, score: 3.3 + 0.3 * (x.lateLost.length - 1),
        text: `${t} has lost ${x.lateLost.length === 1 ? "a game" : `${x.lateLost.length} games`} it led by 15+ in the 4th quarter (${x.lateLost.map((g) => fmt(g, "lead")).join(", ")}); teams with such a lead are ${W}-${L} this season` });
      if (x.lateWon.length) out.push({ team: t, kind: "team", key: `late15|${t}|won`, rare: true, score: 3.3 + 0.3 * (x.lateWon.length - 1),
        text: `${t} has won ${x.lateWon.length === 1 ? "a game" : `${x.lateWon.length} games`} it trailed by 15+ in the 4th quarter (${x.lateWon.map((g) => fmt(g, "down")).join(", ")}); teams that far behind in a 4th quarter are ${L}-${W} this season` });
    }
    if (x.upL >= BY10.losses && (x.upL > x.upW || lossRank(x.upL) <= 3)) {
      const others = losing.filter((o) => o !== t);
      const more = tris.filter((o) => B[o].upL > x.upL), same = tris.filter((o) => o !== t && B[o].upL === x.upL);
      out.push({ team: t, kind: "team", key: `led10|${t}`, score: 2.9 + (x.upL > x.upW ? 0.3 : 0) + 0.1 * Math.min(4, x.upL - 3),
        text: `${t} is ${x.upW}-${x.upL} when leading by 10+ this season` + (x.upL > x.upW ? `: ${others.length ? `one of ${others.length + 1} teams with a losing record in those games (with ${others.join(", ")})` : "the only team with a losing record in those games"}`
          : `; ${more.length ? `only ${more.join(" and ")} ${more.length === 1 ? "has" : "have"} lost more such games` : same.length ? `tied with ${same.join(", ")} for the most such losses in the NBA` : "the most such losses in the NBA"}`) });
    }
  }
  (flow?.swing || []).slice(0, 3).forEach((p, i) => {
    if (!teams.has(p.team) || p.m < BY10.swingMakes) return;
    const tied = flow.swing.filter((o) => o.m === p.m).length > 1;
    out.push({ team: p.team, player: p.name, kind: "fourth", key: `swing|${p.id}`, score: 3.0 + 0.15 * (p.m - 3) + (p.m / p.a >= 0.6 ? 0.2 : 0),
      text: `${p.name} is ${p.m}-for-${p.a} on shots to tie or take the lead in the final 90 seconds of the 4th or overtime this season (${flow.swing[0].m === p.m ? (tied ? "tied for the most makes" : "the most makes") : `${ordinal(i + 1)}-most makes`} in the NBA)` });
  });
  const F = flow?.full;
  if (F && today) {
    const recent = (d) => d && (Date.parse(today) - Date.parse(d)) / 864e5 <= BY10.fullDays;
    const nH = F.halves.length, nG = F.games.length, games = flow.games || 0;
    for (const g of F.games) if (teams.has(g.team) && recent(g.date))
      out.push({ team: g.team, player: g.name, kind: "season", key: `fullgame|${g.id}|${g.gameId}`, rare: true, score: 4,
        text: `${g.name} played every second of ${g.team}'s last game (${g.min} minutes${g.ot ? `, ${g.ot === 1 ? "an overtime" : `${g.ot} overtimes`} included` : ""}, ${md(g.date)} vs ${g.opp}): ${nG === 1 ? "the only full game by any player" : `one of ${nG} full games`} this season (${games} games)` });
    for (const h of F.halves) if (teams.has(h.team) && recent(h.date) && !F.games.some((g) => g.id === h.id && g.gameId === h.gameId))
      out.push({ team: h.team, player: h.name, kind: "season", key: `fullhalf|${h.id}|${h.gameId}`, rare: nH <= 3, score: 3.3,
        text: `${h.name} played the entire ${h.h === 1 ? "first" : "second"} half on ${md(h.date)} vs ${h.opp} (${h.min} minutes in the game): ${nH === 1 ? "the only full half by any player" : `one of ${nH} full halves`} this season (${games} games); ${nG ? `${nG} full game${nG > 1 ? "s" : ""}` : "nobody has played a full game"}` });
    for (const f of F.fives) if (teams.has(f.team) && recent(f.date))
      out.push({ team: f.team, kind: "team", key: `fullfive|${f.team}|${f.gameId}`, rare: true, score: 3.8,
        text: `${f.team} played the same five for the entire ${f.h === 1 ? "first" : "second"} half on ${md(f.date)} vs ${f.opp} (${f.names.join(", ")}): ${F.fives.length === 1 ? "the only time a team has done it" : `one of ${F.fives.length} times`} this season` });
  }
  return out;
}
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
const ordinalWord = (n) => ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][n] || ordinal(n);

/**
 * Shots across games (flowstats.json `shots`; 0.75, the user 11/15): makes in a row, misses in a row, court time without
 * a made field goal, and court time without a free-throw attempt, for players on tonight's teams whose run is still
 * going (he played in the last 6 days). Each is measured against this season's longest, and the makes against the NBA
 * marks once they are a third of the way there. Thresholds come from this season's scale (11/15, 188 games: the longest
 * runs were 13 field goals, 7 threes and 51 free throws; 75 minutes without a field goal; 252 without a free throw).
 */
export const SHOTS = { fg: 10, fg3: 6, ft: 30, fgMiss: 10, fg3Miss: 12, dryFgMin: 25, dryFgFga: 8, dryFtMin: 50, dryFtFtaPg: 4, dryFtLongMin: 100, dryFtLongFga: 40, dryFtLongPg: 1.5, days: 6, fg3Games: 10, minorProm: 0.25, minor: { fgMiss: 4, fg3Miss: 4, dryFgFga: 4 } };
export const SHOT_RECORDS = { fg: [35, "Wilt Chamberlain, 1967"], fg3: [13, "Brent Price, Terry Mills and Shake Milton"], ft: [97, "Micheal Williams, 1993"] };
function shotLines(flow, teams, today, stars = null) {
  const S = flow?.shots;
  if (!S?.players) return [];
  const out = [];
  const md = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "");
  const WORD = { fg: "field goals", fg3: "3-pointers", ft: "free throws" };
  const scale = (k, n) => {
    const top = (S.best?.[k] || [])[0];
    const rec = SHOT_RECORDS[k];
    const season = !top || n >= top.n ? "the longest run this season" : `this season's longest is ${top.n} (${top.name})`;
    return `${season}${n * 3 >= rec[0] ? `; the NBA record is ${rec[0]} (${rec[1]})` : ""}`;
  };
  for (const p of Object.values(S.players)) {
    if (!teams.has(p.team) || !p.last || (today && (Date.parse(today) - Date.parse(p.last)) / 864e5 > SHOTS.days)) continue;
    // 0.78 (the user, 11/16, on "Dru Smith has gone 33 minutes without a made field goal (0-for-8…)" ranked 4th: such runs
    // matter "especially for the top players"). With prominence known (prep stats, 0-1), a miss run or drought counts
    // more for a bigger name, and a player who barely shoots needs a longer one (SHOTS.minor).
    const prom = stars ? stars[p.name] ?? 0 : null, minor = prom != null && prom < SHOTS.minorProm;
    const line = (score, text, key) => out.push({ team: p.team, player: p.name, kind: "pstreak", score: Math.round((score + (prom == null ? 0 : /Miss|dry/.test(key) ? 0.8 * prom - (minor ? 0.4 : 0) : 0.3 * prom)) * 100) / 100, text, key: `shots|${p.name}|${key}` });
    for (const k of ["fg", "fg3", "ft"]) if (p[k] >= SHOTS[k]) line(3.2 + Math.min(1, p[k] / SHOT_RECORDS[k][0]) * 1.5, `${p.name} has made ${p[k]} ${WORD[k]} in a row (since ${md(p[`${k}From`])}): ${scale(k, p[k])}`, k);
    // 0.81 (the user, 11/16: a time limit "disregards players who are injured for weeks at a time between games"):
    // the run counts attempts, and it is a line when it fits in SHOTS.fg3Games of his own games or fewer, however
    // far apart those games were. A player who takes a three every other game never gets there; a shooter back
    // from three weeks out carries his run with him.
    if (p.fg3Miss >= SHOTS.fg3Miss + (minor ? SHOTS.minor.fg3Miss : 0) && (p.fg3MissGames || 1) <= SHOTS.fg3Games) line(3.0 + Math.min(0.6, (p.fg3Miss - SHOTS.fg3Miss) / 10), `${p.name} has missed his last ${p.fg3Miss} 3-point attempts (${p.fg3MissGames > 1 ? `over his last ${p.fg3MissGames} games, ` : ""}since ${md(p.fg3MissFrom)})`, "fg3Miss");
    const d = p.dryFg, m = Math.round(d.sec / 60);
    if (m >= SHOTS.dryFgMin && d.fga >= SHOTS.dryFgFga + (minor ? SHOTS.minor.dryFgFga : 0)) {
      const top = (S.best?.dryFg || [])[0];
      line(2.9 + Math.min(0.8, d.fga / 20), `${p.name} has gone ${m} minutes on the floor without a made field goal (0-for-${d.fga} since ${md(d.from)}${d.games > 1 ? `, over ${d.games} games` : ""})${top && top.sec > d.sec ? `; this season's longest is ${Math.round(top.sec / 60)} minutes (${top.name}, 0-for-${top.fga})` : ": the longest this season"}`, "dryFg");
    } else if (p.fgMiss >= SHOTS.fgMiss + (minor ? SHOTS.minor.fgMiss : 0)) line(3.0, `${p.name} has missed his last ${p.fgMiss} shots (since ${md(p.fgMissFrom)})`, "fgMiss");
    const f = p.dryFt, fm = Math.round(f.sec / 60), perGame = p.gp ? p.fta / p.gp : 0;
    // A player who is at the line 4+ times a game, from 50 minutes; one who gets there at all (1.5+), from 100 minutes and
    // 40 shots; and whoever holds the season's longest such run while it is still going. (A shooter at 0.2 a game going
    // 150 minutes without one is his normal.)
    const longest = (S.best?.dryFt || [])[0];
    if ((fm >= SHOTS.dryFtMin && perGame >= SHOTS.dryFtFtaPg) || (fm >= SHOTS.dryFtLongMin && f.fga >= SHOTS.dryFtLongFga && perGame >= SHOTS.dryFtLongPg) || (longest?.active && longest.name === p.name && fm >= SHOTS.dryFtLongMin))
      line(3.0 + Math.min(0.8, f.fga / 80) + (perGame >= SHOTS.dryFtFtaPg ? 0.4 : 0), `${p.name} has played ${fm} minutes without a free-throw attempt (${f.fga} shots in that time, since ${md(f.from)}${f.games > 1 ? `, over ${f.games} games` : ""}); he averages ${(Math.round(perGame * 10) / 10).toFixed(1)} a game`, "dryFt");
  }
  return out;
}

/**
 * A list from a team's notes, counted forward (0.76): where a player on tonight's slate stands on it, and what the
 * next one does. Said only when the next one changes his place (tied with someone, or within two of the name above).
 * flow.seeded: src/gameflow/stats.js seededCounts().
 */
export function seededLines(flow, teams) {
  const out = [];
  const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
  for (const L of flow?.seeded || []) {
    L.rows.forEach((r) => {
      if (!r.team || !teams.has(r.team)) return;
      const place = L.rows.filter((x) => x.n > r.n).length + 1;
      const tied = L.rows.filter((x) => x !== r && x.n === r.n);
      const above = L.rows.filter((x) => x.n > r.n).sort((a, b) => a.n - b.n)[0] || null;
      if (!tied.length && !(above && above.n - r.n <= 2)) return;
      const where = tied.length ? `tied with ${tied.map((x) => x.name).join(" and ")} for ${place === 1 ? "the most" : ord(place)}` : place === 1 ? "the most" : `${ord(place)}-most`;
      const next = tied.length ? `the next one puts him alone in ${place === 1 ? "first" : ord(place)}` : above.n - r.n === 1 ? `the next one ties ${above.name} (${above.n})` : `two more tie ${above.name} (${above.n})`;
      out.push({ team: r.team, player: r.name, kind: "era", score: 2.8 + (L.min >= 25 ? 0.2 : 0) + (tied.length || above.n - r.n === 1 ? 0.3 : 0), key: `seed|${L.id}|${r.name}`,
        text: `${r.name} has ${r.n} ${L.what}${L.since ? ` since ${L.since}` : ""}, ${where}; ${next}. From the ${L.source.replace(/ game notes.*$/, "")}' notes, counted forward here from ${Number(L.through.slice(5, 7))}/${Number(L.through.slice(8, 10))}` });
    });
  }
  return out;
}

function teamLines(trends, teams) {
  // 0.65: the streak watch says what tonight would make of a run ("a loss tonight would be OKC's first 3-game losing
  // streak since 2023-24", "NOP has allowed 135+ in 4 straight…"); it replaces the bare "lost N straight".
  const out = (trends.watch || []).filter((w) => teams.has(w.team)).map((w) => ({ team: w.team, kind: "team", text: w.text, score: w.score }));
  const wl = new Set((trends.watch || []).filter((w) => w.stat === "W" || w.stat === "L").map((w) => w.team));
  // 0.65: a defense that has let the most opponents set career highs this season (3+, veterans only).
  const HT = (trends.highsAllowed?.teams || []).filter((t) => t.vets >= 3);
  const most = HT.length ? Math.max(...HT.map((t) => t.vets)) : 0;
  for (const t of HT) {
    if (!teams.has(t.tri) || t.vets < most) continue;
    const last = t.games.filter((g) => !g.rookie)[0];
    out.push({ team: t.tri, kind: "team", score: 2.4, text: `${t.tri} has allowed ${t.vets} career-high scoring games this season, the most in the NBA${last ? ` (latest: ${last.name} ${last.pts}, ${+last.d.slice(5, 7)}/${+last.d.slice(8, 10)})` : ""}` });
  }
  // 0.78: anyone past his rookie season who keeps raising his career high (twice or more this season), on the nights
  // he plays; the league's count of such players comes with it.
  const RH = (trends.highsAllowed?.repeat || []).filter((r) => !r.rookie);
  const rhMax = RH.length ? RH[0].n : 0;
  const times = (n) => (n === 2 ? "twice" : `${n} times`);
  for (const r of RH) {
    if (!teams.has(r.team)) continue;
    const same = RH.filter((x) => x.n >= r.n && x.id !== r.id), more = RH.filter((x) => x.n > r.n);
    out.push({ team: r.team, player: r.name, kind: "season", key: `highs|${r.id}`, rare: !more.length && same.length <= 1,
      score: Math.round((2.8 + 0.4 * (r.n - 2) + (r.n === rhMax ? 0.2 : 0)) * 100) / 100,
      text: `${r.name} has raised his career high ${times(r.n)} this season (${r.steps.filter((v) => v != null).join(" → ")}, the latest on ${+r.last.slice(5, 7)}/${+r.last.slice(8, 10)}): ${!same.length ? "the only player past his rookie season to do it more than once" : more.length ? `${more.length === 1 ? `only ${more[0].name} has` : `${more.length} players have`} done it more often (rookies aside)` : `one of ${same.length + 1} players past their rookie season to do it ${times(r.n)} (with ${same.slice(0, 3).map((x) => x.name).join(", ")}${same.length > 3 ? "…" : ""})`}` });
  }
  for (const [team, t] of Object.entries(trends.teams || {})) {
    if (!teams.has(team) || !t.streak || t.streak.n < 4 || wl.has(team)) continue;
    out.push({ team, kind: "team", text: `${team}: ${t.streak.type === "W" ? "won" : "lost"} ${t.streak.n} straight`, score: t.streak.n / 3 });
  }
  return out;
}

// Names compared across sources (accents, punctuation, suffixes, hyphens ignored).
const nameKey = (n) => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.'’]/g, "").replace(/-/g, " ").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ").replace(/\s+/g, " ").trim();

function injuryLines(injuries, teams, today) {
  if (!injuries || (injuries.date && today && injuries.date !== today)) return [];
  // 0.126: who the line is about, his status and how many straight games he has already missed, for the briefing
  // (a star's absence can be a top line; one he has been out for a while is old news). No `player` field on purpose:
  // the one-line-a-player rules elsewhere do not apply to an absence.
  const missedOf = Object.fromEntries((injuries.impact || []).filter((x) => x.name).map((x) => [x.name, x.missedInARow ?? 0]));
  return (injuries.impact || []).filter((x) => teams.has(x.team)).map((x) => {
    const who = x.names || (x.name ? [x.name] : []);
    return { team: x.team, kind: "injury", text: x.text, score: x.score, who, status: x.status || (x.names ? "Out" : null), missed: who.length ? Math.min(...who.map((n) => missedOf[n] ?? 0)) : 0 };
  });
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
      // 0.125: a streak the box scores say is over ("Streak over") is history, not tonight's storyline: it keeps its place
      // in the notes list and ranks 1.5 lower here (it was #1 in the briefing on 11/19). firstSeen is the notes' own first
      // day for the sentence, so a new tag or check in front of an old sentence does not make it "new today".
      const ended = f.tag === "Streak over";
      out.push({ team, player: f.player, kind: "history", text: `${team} notes${who} ${tag}${body}${f.hook?.text ? ` → ${f.hook.text}` : ""}`, score: Math.min(4.8, f.score) - (ended ? 1.5 : 0), isNew: f.isNew, ...(ended ? { ended: true } : {}), ...(f.firstSeen ? { firstSeen: f.firstSeen } : {}) });
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
    if (!i.tonight || !teams.has(i.team) || i.minor) continue;   // 0.64: a place not worth saying
    if (i.kind === "pass" || i.kind === "round" || i.kind === "franchise" || i.kind === "cup") {
      const p = i.pTonight || 0;
      if (p < 0.25) continue;
      // The notes' own version of the same milestone wins (same player and stat, same mark or same name passed).
      const dup = milestones.some((m) => m.team === i.team && m.stat === i.stat && nameKey(m.player) === nameKey(i.who)
        && (m.target === i.target || m.target === i.target - 1 || (m.passing && i.passing && i.passing.name.split(" and ").some((n) => surname(n) === surname(m.passing)))));
      if (dup) continue;
      out.push({ team: i.team, player: i.who, kind: "record", text: withAward(`${i.text} (${pct(p)} tonight)`, i.who, records.awards), score: i.score + p, passing: i.passing?.name || null, ...(i.siteOnly ? { siteOnly: true } : {}) });
    } else if (i.need === 1) {
      const text = i.kind === "coach"
        ? i.stat === "games" ? `${i.text.replace(/: 1 game from passing/, ": coaches tonight to pass")}` : `${i.text.replace(/: 1 win from passing/, ": a win tonight passes")}`
        : i.text;
      out.push({ team: i.team, kind: "record", text, score: i.score });
    }
  }
  return out;
}

// 0.142: career feat boards (docs/data/featlive.json `pre`): what a player's next 30-10-5 game (and the like) would do on
// the all-time list. Only lines where the next one passes or ties a name, or adds to a record he holds.
function featLines(featlive, teams, today) {
  if (!featlive || (featlive.today && today && featlive.today !== today)) return [];
  return (featlive.pre || []).filter((p) => teams.has(p.team)).map((p) => ({ team: p.team, player: p.name, kind: "feat", text: p.line, score: p.score }));
}

function contextLines(records, teams, today) {
  if (!records || !Array.isArray(records.context) || (records.today && today && records.today !== today)) return [];
  // Regulars only (24+ minutes a game last season), points / rebounds / assists; a swing from last season first.
  return records.context.filter((c) => teams.has(c.team) && c.games >= 8 && (c.lastMin ?? 0) >= 24 && ["pts", "reb", "ast"].includes(c.stat)
    && (c.kind === "change" || (c.since === null && c.last >= ({ pts: 15, reb: 7, ast: 5 })[c.stat])))
    .map((c) => ({ team: c.team, player: c.name, kind: "context", text: c.text, score: Math.min(1.7, 0.8 + c.score / 5 + (c.kind === "change" ? 0.2 : 0) + (c.stat === "pts" ? 0.1 : 0)) }))
    // 0.71: shooting career highs (or lows) in three or more of FG%, 3P%, 2P%, FT% (Camara, 11/15).
    .concat(records.context.filter((c) => teams.has(c.team) && c.stat === "pct" && c.games >= 8 && (c.lastMin ?? 0) >= 20)
      .map((c) => ({ team: c.team, player: c.name, kind: "context", text: c.text, score: 1.6 })))
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

/**
 * Prep stats (0.66, src/anticipate/prep.js → docs/data/prep.json): season vs career, spans (since a teammate went
 * out, over a winning streak), player streak watch, vs tonight's opponent, through N games.
 */
// 0.70 (src/anticipate/seasonlong.js): trade and starter/bench splits, lineups, record turns and "since Christmas",
// who has beaten the best teams, month ratings and totals, rookies.
const PREP_KINDS = new Set(["broken", "luck", "paradox", "scarce", "defpos", "season", "span", "pstreak", "vsopp", "pace", "trade", "role", "lineup", "turn", "brothers", "beaten", "month", "monthp", "rookie", "defense", "cup", "era", "qtr", "clinch", "find", "shift"]);
function prepStoryLines(prep, teams, games, today) {
  if (!prep || !Array.isArray(prep.lines) || (prep.today && today && prep.today !== today)) return [];
  const opp = new Map();
  for (const g of games) { opp.set(g.away, g.home); opp.set(g.home, g.away); }
  return prep.lines.filter((l) => PREP_KINDS.has(l.kind) && teams.has(l.team) && (l.kind !== "vsopp" || opp.get(l.team) === l.opp))
    .map((l) => ({ team: l.team, player: l.player, kind: l.kind, text: l.text, score: l.score, key: l.key, rare: !!l.rare, ...(l.standing ? { standing: true } : {}) }));
}

/**
 * NBA Cup all-time records on a Cup night (0.71; the user, 11/15: "the Magic are the only undefeated team at home…
 * worth noting in the watch list the next time they have a home NBA Cup game"). From records.json cup.standings
 * (the Cup guide's all-time records plus this season's games) and cup.tonight.
 */
function cupLines(records, teams, today) {
  const C = records?.cup;
  if (!C || !Array.isArray(C.standings) || !Array.isArray(C.tonight) || !C.tonight.length || (records.today && today && records.today !== today)) return [];
  const S = Object.fromEntries(C.standings.map((x) => [x.team, x]));
  const rec = (r) => `${r[0]}-${r[1]}`;
  const out = [];
  const perfect = (k) => C.standings.filter((x) => x[k] && x[k][0] >= 3 && x[k][1] === 0).map((x) => x.team);
  const winless = (k) => C.standings.filter((x) => x[k] && x[k][1] >= 3 && x[k][0] === 0).map((x) => x.team);
  const pct = (r) => (r[0] + r[1] ? r[0] / (r[0] + r[1]) : 0);
  const best = [...C.standings].filter((x) => x.overall && x.overall[0] + x.overall[1] >= 8).sort((a, b) => pct(b.overall) - pct(a.overall));
  for (const g of C.tonight) {
    for (const [t, where, k] of [[g.home, "at home", "home"], [g.away, "on the road", "road"]]) {
      const x = S[t];
      if (!x || !teams.has(t)) continue;
      const P = perfect(k), W = winless(k);
      if (P.includes(t)) out.push({ kind: "cup", team: t, text: `${t} is ${rec(x[k])} ${where} in NBA Cup games all-time: ${P.length === 1 ? "the only team unbeaten" : `one of ${P.length} teams unbeaten`} ${where}; tonight is a ${k === "home" ? "home" : "road"} Cup game`, score: 3.6 + (P.length === 1 ? 0.5 : 0), rare: P.length === 1 });
      if (W.includes(t)) out.push({ kind: "cup", team: t, text: `${t} is ${rec(x[k])} ${where} in NBA Cup games all-time: ${W.length === 1 ? "the only team without a win" : `one of ${W.length} teams without a win`} ${where}`, score: 3.2 });
    }
    for (const t of [g.away, g.home]) {
      const i = best.findIndex((x) => x.team === t);
      if (i === 0 && teams.has(t)) out.push({ kind: "cup", team: t, text: `${t} has the best all-time record in NBA Cup games: ${rec(S[t].overall)}`, score: 3.1 });
    }
  }
  return out;
}

// 0.144.0: award eligibility under the 65-game rule (docs/data/eligibility.json `lines`, made by src/situations/eligibility.js).
// These stay when the player is listed out tonight: sitting is the story.
function awardLines(elig, teams, today) {
  if (!elig || (elig.today && today && elig.today !== today)) return [];
  return (elig.lines || []).filter((l) => teams.has(l.team)).map((l) => ({ ...l, siteOnly: true }));
}

/** Every candidate line for tonight, after the injury report (shared by the per-game storylines and the briefing). */
export function tonightCandidates({ watch, trends = {}, leaders = {}, injuries = null, facts = null, records = null, matchups = null, national = null, rest = null, form = null, fouls = null, prep = null, featlive = null, elig = null }) {
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
  const others = [...hist, ...miles, ...recs, ...streakLines(trends, teams), ...leadLines(leaders, teams), ...shootingLines(leaders, teams).filter((l) => !clubLines(leaders, teams).some((c) => c.player === l.player)), ...clubLines(leaders, teams), ...teamLines(trends, teams), ...contextLines(records, teams, watch.today), ...matchupLines(matchups, teams, watch.today), ...tvLines(national, teams, watch.today), ...restLines(rest, teams, watch.today), ...formLines(form, teams, watch.today), ...foulLines(fouls, teams), ...earlyLines(fouls, teams, watch.today), ...fourthLines(fouls, teams), ...lastTwoLines(fouls, teams), ...shotLines(fouls, teams, watch.today, prep?.stars || null), ...flowTeamLines(fouls, teams, watch.today), ...seededLines(fouls, teams), ...prepStoryLines(prep, teams, games, watch.today), ...cupLines(records, teams, watch.today), ...featLines(featlive, teams, watch.today)]
    .flatMap((l) => {
      const st = l.player ? listed.get(`${l.team}|${nameKey(l.player)}`) : null;
      if (st === "Out" || st === "Doubtful") return [];
      return [st === "Questionable" ? { ...l, text: `${l.text} · questionable tonight`, score: l.score * 0.8 } : l];
    });
  return { games, all: [...injuryLines(injuries, teams, watch.today), ...others, ...awardLines(elig, teams, watch.today)] };
}

// At most this many of a kind in one game's card.
const PER_GAME = { awards: 2, feat: 2, broken: 1,  luck: 1, paradox: 1, scarce: 1, defpos: 1,  injury: 2, history: 2, context: 1, matchup: 2, tv: 2, rest: 2, form: 2, foul: 2, season: 2, span: 2, pstreak: 2, vsopp: 1, pace: 1, trade: 1, role: 1, lineup: 1, turn: 1, beaten: 1, month: 1, monthp: 1, rookie: 1, defense: 1, cup: 1, era: 1, fourth: 2, qtr: 1, clinch: 2, find: 1 };
const KEEP_KINDS = ["club", "tv", "awards"];
export function tonightStorylines(args) {
  const maxLines = args.maxLines ?? MAX_LINES;
  const { games, all } = tonightCandidates(args);
  return games.map((g) => {
    const n = {};
    const ranked = all.filter((l) => (l.team === g.away || l.team === g.home) && (l.kind !== "matchup" || l.game === `${g.away}@${g.home}`)).sort((a, b) => b.score - a.score)
      .filter((l) => !PER_GAME[l.kind] || (n[l.kind] = (n[l.kind] || 0) + 1) <= PER_GAME[l.kind]);
    // The user asked for these on the Watch List: the best of each keeps a place even on a crowded night, taking the place
    // of the lowest line that isn't one of them (0.144.0: award eligibility, the user's countdown, joins club and TV).
    const lines = ranked.slice(0, maxLines);
    for (const k of KEEP_KINDS) {
      const best = ranked.find((l) => l.kind === k);
      if (!best || lines.includes(best) || !lines.length) continue;
      let i = lines.length - 1; while (i >= 0 && KEEP_KINDS.includes(lines[i].kind)) i--;
      if (i >= 0) lines[i] = best;
    }
    return { ...g, lines };
  });
}

export { discordDigest } from "./discord-digest.js";
