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
 *        + the ledger (0.138: src/anticipate/ledger.js): one line per claim, whichever detectors found it (two of them:
 *          a little more); a streak or mark whose numbers moved since the last day it was seen; a claim already at the
 *          top on the days just before with the same numbers fades
 *
 * Top 10: mixed (at most 3 from one game, 3 of one kind, 1 per player); no injuries, rest, TV or context lines there
 * (each game's card keeps those). Deep cuts: the rare and the big about lesser-known players, which would never beat
 * a star's line on prominence.
 */
import { boost } from "./learn.js";
import { buzzBoost } from "./buzz.js";
import { ledgerAdjust, hashKey } from "./ledger.js";
const KEEP_OUT = new Set(["injury", "rest", "tv", "context"]);
/** 0.126: an injury line reaches the top ten when one of its players is at least this prominent (tonight.json `stars`). */
export const STAR_OUT = 0.6;
/**
 * 0.126: kinds held to fewer than three of the ten. One shift line: on 11/19 two of them (a shooting slump and a
 * minutes bump) pushed out "MIL is 1-14, its worst start" and "SAS has the best record since 2004-05". The others stay
 * in their games' lists and on the Shifts table.
 */
export const KIND_CAP = { shift: 1, injury: 2 };   // two absences at most: a full build on 11/19 put three in the ten, two of them on top
const RARE_KINDS = new Set(["pstreak", "pace", "record"]);
const strip = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\d.,%]+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
export const lineKey = (l) => l.key || `${l.kind}|${l.team}|${l.player || ""}|${strip(l.text).slice(0, 90)}`;

const dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

/**
 * all: tonightCandidates().all; games: [{ away, home }]; stars: { name: 0-1 }; nationalGames: Set of "AWY@HOM";
 * seen: { key: "YYYY-MM-DD" first seen }; today.
 * -> { top: [line+], deep: [line+], seen }
 */
export function briefing({ all, games = [], stars = {}, nationalGames = new Set(), seen = {}, today, topN = 10, deepN = 5, model = null, buzz = null, ledger = null }) {
  const gameOf = new Map();
  for (const g of games) { gameOf.set(g.away, `${g.away}@${g.home}`); gameOf.set(g.home, `${g.away}@${g.home}`); }
  const next = {};
  for (const [k, d] of Object.entries(seen || {})) if (today && dayDiff(d, today) <= 30) next[k] = d;
  const scored = [];
  for (const l of all || []) {
    // 0.138: one line per claim: the claim's best line speaks for it; the others are the same story found again.
    const claim = ledger?.of?.get(l) || null;
    if (claim && claim.best !== l) continue;
    // 0.126 (the user was asked on 11/19 whether a star's absence belongs up top; "you can work on the other things"):
    // an injury line is let in when it is about a star listed out or doubtful. Other injury lines stay in the game cards.
    const starOut = l.kind === "injury" && /^(out|doubtful)$/i.test(l.status || "") ? Math.max(0, ...(l.who || []).map((n) => stars[n] ?? 0)) : 0;
    if ((KEEP_OUT.has(l.kind) && starOut < STAR_OUT) || !gameOf.has(l.team)) continue;
    const key = lineKey(l);
    if (model?.down?.has(key)) continue; // the user voted this line down (0.67)
    // 0.139: a claim the user copied to post ("used it") stays out until its numbers move (then it's an update).
    if (claim && model?.usedClaims?.has(hashKey(claim.key)) && !claim.changed) continue;
    // 0.125: a notes line carries the day the notes first printed it (firstSeen); that wins over the day this wording
    // was first ranked, so a check or tag added in front of an old sentence is not "new today".
    const first = [l.firstSeen, next[key] || today, claim?.first].filter(Boolean).sort()[0];
    next[key] = first;
    // an absence is as old as the games he has already missed (about two days a game), however new the wording
    const age = Math.max(today ? dayDiff(first, today) : 0, l.kind === "injury" ? 2 * (l.missed || 0) : 0);
    const prom = starOut || (l.player ? (stars[l.player] ?? 0.3) : 0.5);
    const fresh = age === 0 ? 0.35 : age >= 7 ? -1 : age >= 3 ? -0.5 : 0;
    const rare = l.rare || RARE_KINDS.has(l.kind) ? 0.3 : 0;
    const game = gameOf.get(l.team);
    const learned = boost(l, model, stars);   // 0.67: the user's votes, by feature
    const news = buzzBoost(l, buzz);
    const led = ledgerAdjust(claim);
    const rank = (l.score || 0) + 0.9 * prom + (nationalGames.has(game) ? 0.25 : 0) + fresh + rare + learned + news + led;
    const inNews = l.player && buzz?.players?.[l.player] ? buzz.players[l.player] : 0;
    scored.push({ ...l, game, prom, age, learned, news: inNews, rank: Math.round(rank * 100) / 100, key, claim: claim?.key || null, status: claim ? (claim.isNew ? "new" : claim.changed ? "updated" : "seen") : null, sources: claim ? claim.kinds.length : 1 });
  }
  scored.sort((a, b) => b.rank - a.rank);
  const pick = (list, n, { perGame, perKind }) => {
    const out = [], g = {}, k = {}, p = new Set();
    for (const l of list) {
      if (out.length >= n) break;
      const names = l.player ? [l.player] : l.who || [];   // an absence line names one or two players: one line each
      if ((g[l.game] || 0) >= perGame || (k[l.kind] || 0) >= (KIND_CAP[l.kind] ?? perKind) || names.some((n) => p.has(n))) continue;
      out.push(l); g[l.game] = (g[l.game] || 0) + 1; k[l.kind] = (k[l.kind] || 0) + 1; for (const n of names) p.add(n);
    }
    return out;
  };
  // 0.125: a line about something that has ended (a notes streak the box scores say is over) is never a top storyline.
  const live = scored.filter((l) => !l.ended);
  const top = pick(live, topN, { perGame: Math.max(3, Math.ceil(topN / Math.max(1, games.length)) + 1), perKind: 3 });
  const taken = new Set(top.map((l) => l.key)), topPlayers = new Set(top.map((l) => l.player).filter(Boolean));
  // Deep cuts: lesser-known players (or a team), rare or big, by their own score (prominence doesn't count here).
  const deepPool = live.filter((l) => !taken.has(l.key) && !topPlayers.has(l.player) && l.prom < 0.45 && (l.rare || RARE_KINDS.has(l.kind) || (l.score || 0) >= 3) && l.age < 7)
    .sort((a, b) => (b.score || 0) + (b.rare ? 0.3 : 0) + b.learned - ((a.score || 0) + (a.rare ? 0.3 : 0) + a.learned));
  const deep = pick(deepPool, deepN, { perGame: 2, perKind: 2 });
  // 0.147.0: the whole ranked pool, no caps (the user, 11/24: "there shouldn't be a cap regardless of how many games are
  // played a night. the important information should rise to the front"). The Spotlight and the ranked list read it.
  return { top, deep, seen: next, ranked: live };
}

/** A line's words without the status the storylines add behind it ("… · questionable tonight"). */
export const sameLine = (text) => String(text || "").replace(/ · (?:questionable|probable|doubtful) tonight$/i, "").trim();
/** 0.159.0: the league-wide finds that tonight's lines don't already say (same words; tonight's copy carries its game). */
export function withoutTonights(finds, tonight) {
  const said = new Set((tonight || []).map((l) => sameLine(l.text)));
  return (finds || []).filter((l) => !said.has(sameLine(l.text)));
}
