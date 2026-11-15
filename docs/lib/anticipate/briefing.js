/**
 * The briefing (0.66): one ranking over every candidate line for tonight's slate, for the top of the Watch List.
 * The user (11/14): "how do I extract the pertinent and relevant information to display on the main page to prepare
 * me for the evening slates… how can we highlight the obscure".
 *
 *   rank = the line's own score (how big / how rare, set by its detector)
 *        + who it's about (prominence: this season's points and minutes, 0-1)
 *        + a national TV game
 *        + new today (first seen today; a line seen for days fades)
 *        + rare (a detector's "only / first / most since" flag)
 *        + in the news (0.70: the player, or failing that his team, in the last 72 hours' headlines; src/anticipate/buzz.js)
 *
 * Top 10: mixed (at most 3 from one game, 3 of one kind, 1 per player); no injuries, rest, TV or context lines there
 * (each game's card keeps those). Deep cuts: the rare and the big about lesser-known players, which would never beat
 * a star's line on prominence.
 */
import { boost } from "./learn.js";
import { buzzBoost } from "./buzz.js";
const KEEP_OUT = new Set(["injury", "rest", "tv", "context"]);
const RARE_KINDS = new Set(["pstreak", "pace", "record"]);
const strip = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\d.,%]+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
export const lineKey = (l) => l.key || `${l.kind}|${l.team}|${l.player || ""}|${strip(l.text).slice(0, 90)}`;

const dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

/**
 * all: tonightCandidates().all; games: [{ away, home }]; stars: { name: 0-1 }; nationalGames: Set of "AWY@HOM";
 * seen: { key: "YYYY-MM-DD" first seen }; today.
 * -> { top: [line+], deep: [line+], seen }
 */
export function briefing({ all, games = [], stars = {}, nationalGames = new Set(), seen = {}, today, topN = 10, deepN = 5, model = null, buzz = null }) {
  const gameOf = new Map();
  for (const g of games) { gameOf.set(g.away, `${g.away}@${g.home}`); gameOf.set(g.home, `${g.away}@${g.home}`); }
  const next = {};
  for (const [k, d] of Object.entries(seen || {})) if (today && dayDiff(d, today) <= 30) next[k] = d;
  const scored = [];
  for (const l of all || []) {
    if (KEEP_OUT.has(l.kind) || !gameOf.has(l.team)) continue;
    const key = lineKey(l);
    if (model?.down?.has(key)) continue; // the user voted this line down (0.67)
    const first = next[key] || today;
    next[key] = first;
    const age = today ? dayDiff(first, today) : 0;
    const prom = l.player ? (stars[l.player] ?? 0.3) : 0.5;
    const fresh = age === 0 ? 0.35 : age >= 7 ? -1 : age >= 3 ? -0.5 : 0;
    const rare = l.rare || RARE_KINDS.has(l.kind) ? 0.3 : 0;
    const game = gameOf.get(l.team);
    const learned = boost(l, model, stars);   // 0.67: the user's votes, by feature
    const news = buzzBoost(l, buzz);
    const rank = (l.score || 0) + 0.9 * prom + (nationalGames.has(game) ? 0.25 : 0) + fresh + rare + learned + news;
    const inNews = l.player && buzz?.players?.[l.player] ? buzz.players[l.player] : 0;
    scored.push({ ...l, game, prom, age, learned, news: inNews, rank: Math.round(rank * 100) / 100, key });
  }
  scored.sort((a, b) => b.rank - a.rank);
  const pick = (list, n, { perGame, perKind }) => {
    const out = [], g = {}, k = {}, p = new Set();
    for (const l of list) {
      if (out.length >= n) break;
      if ((g[l.game] || 0) >= perGame || (k[l.kind] || 0) >= perKind || (l.player && p.has(l.player))) continue;
      out.push(l); g[l.game] = (g[l.game] || 0) + 1; k[l.kind] = (k[l.kind] || 0) + 1; if (l.player) p.add(l.player);
    }
    return out;
  };
  const top = pick(scored, topN, { perGame: Math.max(3, Math.ceil(topN / Math.max(1, games.length)) + 1), perKind: 3 });
  const taken = new Set(top.map((l) => l.key)), topPlayers = new Set(top.map((l) => l.player).filter(Boolean));
  // Deep cuts: lesser-known players (or a team), rare or big, by their own score (prominence doesn't count here).
  const deepPool = scored.filter((l) => !taken.has(l.key) && !topPlayers.has(l.player) && l.prom < 0.45 && (l.rare || RARE_KINDS.has(l.kind) || (l.score || 0) >= 3) && l.age < 7)
    .sort((a, b) => (b.score || 0) + (b.rare ? 0.3 : 0) + b.learned - ((a.score || 0) + (a.rare ? 0.3 : 0) + a.learned));
  const deep = pick(deepPool, deepN, { perGame: 2, perKind: 2 });
  return { top, deep, seen: next };
}
