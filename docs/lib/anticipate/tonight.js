/**
 * Tonight's storylines per game, from data the site already publishes (pure, browser-safe).
 *
 *   tonightStorylines({ watch, trends, leaders, maxLines? }) -> [{ id, away, home, start, lines: [{ kind, team, text, score }] }]
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
 *   team       a team win or loss streak of 4+
 *   history    a line from tonight's team notes (docs/data/notes-facts.json): what the team's PR staff
 *              wrote about history made or in reach, verbatim; new-today lines first; at most 2 a game
 *   record     career leaderboards and records kept current from the Tip-Off Guide (docs/data/records.json,
 *              src/records/guide.js): passing a numbered all-time name, a round career number, a franchise
 *              record, with a 25%+ chance tonight; a coach's milestone or a team's place in the NBA's streak
 *              and best-start lists that tonight's game decides. Where the notes already carry the same
 *              milestone, theirs is kept; a notes history line about the same pass gives way to this one.
 *   injury     a regular listed out / doubtful / questionable on the official injury report, with the
 *              team's record and teammates' numbers without him (src/injuries/impact.js); at most 2 a game.
 *              The report also removes every other line about a player listed Out or Doubtful, and
 *              marks a Questionable player's lines.
 * Lines are ranked by `score` (rough newsworthiness) and capped per game.
 */
import { cushion, needed } from "../situations/leaders.js";

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
      out.push({ team, player: f.player, kind: "history", text: `${team} notes${who} ${f.text.length > 260 ? f.text.slice(0, 257).replace(/\s+\S*$/, "") + "…" : f.text}`, score: Math.min(4.5, f.score), isNew: f.isNew });
    }
  }
  return out;
}

const surname = (n) => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV)$/, "").split(" ").pop().toLowerCase();

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
      out.push({ team: i.team, player: i.who, kind: "record", text: `${i.text} (${pct(p)} tonight)`, score: i.score + p, passing: i.passing?.name || null });
    } else if (i.need === 1) {
      const text = i.kind === "coach"
        ? i.stat === "games" ? `${i.text.replace(/: 1 game from passing/, ": coaches tonight to pass")}` : `${i.text.replace(/: 1 win from passing/, ": a win tonight passes")}`
        : i.text;
      out.push({ team: i.team, kind: "record", text, score: i.score });
    }
  }
  return out;
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

export function tonightStorylines({ watch, trends = {}, leaders = {}, injuries = null, facts = null, records = null, maxLines = MAX_LINES }) {
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
  const others = [...hist, ...miles, ...recs, ...streakLines(trends, teams), ...leadLines(leaders, teams), ...shootingLines(leaders, teams), ...teamLines(trends, teams)]
    .flatMap((l) => {
      const st = l.player ? listed.get(`${l.team}|${nameKey(l.player)}`) : null;
      if (st === "Out" || st === "Doubtful") return [];
      return [st === "Questionable" ? { ...l, text: `${l.text} · questionable tonight`, score: l.score * 0.8 } : l];
    });
  const all = [...injuryLines(injuries, teams, watch.today), ...others];
  return games.map((g) => {
    let inj = 0, hist = 0;
    const lines = all.filter((l) => l.team === g.away || l.team === g.home).sort((a, b) => b.score - a.score)
      .filter((l) => (l.kind !== "injury" || ++inj <= 2) && (l.kind !== "history" || ++hist <= 2)).slice(0, maxLines);
    return { ...g, lines };
  });
}

export { discordDigest } from "./discord-digest.js";
