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
      out.push({ team: t.team, player: i.player, kind: "milestone", text: `${i.player}: ${i.need} ${plural(i.need, label)} from ${what} (${pct(p)} tonight)`, score: (i.importance || 0) / 10 + p });
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
      out.push({ team, player: f.player, kind: "history", text: `${team} notes: ${f.text.length > 260 ? f.text.slice(0, 257).replace(/\s+\S*$/, "") + "…" : f.text}`, score: Math.min(4.5, f.score), isNew: f.isNew });
    }
  }
  return out;
}

export function tonightStorylines({ watch, trends = {}, leaders = {}, injuries = null, facts = null, maxLines = MAX_LINES }) {
  const games = (watch.games || []).map((g) => ({ id: g.id, away: g.awayTri, home: g.homeTri, start: g.start }));
  const teams = new Set(games.flatMap((g) => [g.away, g.home]));
  // The injury report overrules the rest: a player listed Out or Doubtful loses his other lines
  // (no "54% tonight" for a man who isn't playing); a Questionable one is marked.
  const listed = new Map();
  if (injuries && (!injuries.date || !watch.today || injuries.date === watch.today)) for (const p of injuries.players || []) listed.set(`${p.team}|${nameKey(p.name)}`, p.status);
  const others = [...historyLines(facts, teams, watch.today), ...milestoneLines(watch, teams), ...streakLines(trends, teams), ...leadLines(leaders, teams), ...shootingLines(leaders, teams), ...teamLines(trends, teams)]
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

/** Discord-ready digest: a list of webhook payloads (each within Discord's limits). */
export function discordDigest(stories, { date, site = "https://campgambino.github.io/nba-command-center/" } = {}) {
  const time = (iso) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const embeds = stories.filter((g) => g.lines.length).map((g) => ({
    title: `${g.away} @ ${g.home} · ${time(g.start)} ET`,
    description: g.lines.map((l) => `• ${l.text}`).join("\n").slice(0, 3900),
    color: 0x4f9cf7,
  }));
  const payloads = [];
  let cur = [], size = 0;
  for (const e of embeds) {
    const n = e.title.length + e.description.length;
    if (cur.length === 10 || size + n > 5500) { payloads.push(cur); cur = []; size = 0; }
    cur.push(e); size += n;
  }
  if (cur.length) payloads.push(cur);
  return payloads.map((em, i) => ({
    username: "NBA Command Center",
    content: i === 0 ? `**Tonight's storylines, ${date}** · ${stories.length} games · ${site}` : "",
    embeds: em,
    allowed_mentions: { parse: [] },
  }));
}
