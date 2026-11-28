/**
 * Checking a notes sentence against this season's box scores (docs/data/teams/<TRI>.json):
 * "Caleb Wilson logged 30 points, 14 rebounds and two steals vs. WAS (10/24)" is a claim about one game.
 * If exactly one player on the team had that game this season, we know who the line is about and that
 * it is from this season, whatever the sentence's wording. If the player it names never had such a game,
 * the line is not from this season (or not about him).
 *
 * Only single-game claims are read: "24 points", "11 assists", "4-9 3FG". Thresholds ("30+ points",
 * "at least 25 points"), averages ("10.4 points per game") and totals ("95 points over three games",
 * "6,000 career points") are not claims about one game and are skipped.
 */
import { TEAMS } from "../teams.js";
import { playedIn } from "../situations/played.js";

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const NUM = `(\\d{1,2}|${Object.keys(WORDS).join("|")})`;
const STAT = [
  ["pts", "points|pts"],
  ["reb", "rebounds|boards|reb|rebs"],
  ["ast", "assists|ast|asts|dimes"],
  ["stl", "steals|stl|stls"],
  ["blk", "blocks|blocked shots|blk|blks"],
  ["fg3m", "3-pointers|three-pointers|threes|treys|3PM|3FGM|made 3-pointers|made threes"],
  ["oreb", "offensive rebounds|offensive boards"],
];
const CLAIM = new RegExp(`(?<![\\d,.+\\-/])${NUM}\\s+(${STAT.map(([, w]) => w).join("|")})\\b(?!\\s*(?:per|a game|in (?:the|a) (?:first|second|third|fourth|quarter|half)|in a quarter|in a half|in an? (?:opening |single )?(?:quarter|half|period)|in the opening|over|through|combined|this season|on the season|in (?:his|their|the) (?:last|first|past)|career|in \\w+ (?:straight|consecutive)|off the bench this))`, "gi");
const NOT_BEFORE = /(?:at least|more than|fewer than|under|over|averaging|averaged|career|total|totaling|a combined|combined|of his|of the|his \d+(?:st|nd|rd|th)|first|reach|reached|to)\s+(?:(?:career|season)-high\s+)?$/i;
const RANGE = [
  [/\b(\d{1,2})-(\d{1,2})\s*(?:3FG|3PT|3P|3-pt|from (?:three|deep|beyond the arc|3-point range))\b/gi, "fg3m", "fg3a"],
  [/\b(\d{1,2})-(\d{1,2})\s*(?:FGs?|from the field)\b/gi, "fgm", "fga"],
  [/\b(\d{1,2})-(\d{1,2})\s*(?:FT|from the (?:free[- ]throw|charity) (?:line|stripe))\b/gi, "ftm", "fta"],
];

/** Single-game stat claims in a sentence -> [{ stat, n }] (each stat once). */
export function statClaims(text) {
  const out = new Map();
  // Totals over several games ("151 points, 18 3FGM and 14 steals through the first seven games") aren't one game.
  if (/\b(?:through|over|across|in|within|during)\s+(?:the\s+|his\s+|their\s+|a\s+)?(?:first\s+|last\s+|past\s+)?(?:\w+\s+){0,2}(?:straight\s+|consecutive\s+)?games\b|\bspan\b|\bcombined\b|\btotals?\b/i.test(text)) return [];
  let prevEnd = -1, prevSkipped = false;
  for (const m of text.matchAll(CLAIM)) {
    // A threshold ("at least 35 points, 10 rebounds and 5 assists") covers the rest of its list too.
    const chained = prevSkipped && /^[\s,]*(?:and\s+|or\s+)?$/.test(text.slice(prevEnd, m.index));
    const skip = chained || NOT_BEFORE.test(text.slice(Math.max(0, m.index - 40), m.index)) || /^\s*(?:\+|-plus|or more|or better)/.test(text.slice(m.index + m[1].length));
    prevEnd = m.index + m[0].length; prevSkipped = skip;
    if (skip) continue;
    const n = WORDS[m[1].toLowerCase()] ?? +m[1];
    const word = m[2].toLowerCase();
    const stat = STAT.find(([, w]) => new RegExp(`^(?:${w})$`, "i").test(word))?.[0];
    if (stat && !out.has(stat)) out.set(stat, n);
  }
  // A stat line written as adjectives ("a 29-point, 14-rebound, 11-assist triple-double"): exact when two or more.
  const adj = [...text.matchAll(/\b(\d{1,2})-(point|rebound|assist|steal|block)\b/gi)];
  if (adj.length >= 2) for (const m of adj) {
    const stat = { point: "pts", rebound: "reb", assist: "ast", steal: "stl", block: "blk" }[m[2].toLowerCase()];
    if (!out.has(stat)) out.set(stat, +m[1]);
  }
  for (const [re, made, att] of RANGE) for (const m of text.matchAll(re)) {
    if (!out.has(made)) out.set(made, +m[1]);
    if (!out.has(att)) out.set(att, +m[2]);
  }
  // "made all 14 of his free throws", "a perfect 9-for-9 from the line", "all six of his 3-pointers" (0.94): made and tried.
  for (const [re, made, att] of [[/\b(?:made|hit|sank|converted|knocked down) all (\d{1,2}|\w+) of (?:his|her|their) (?:free throws|free-throw attempts|foul shots)\b/gi, "ftm", "fta"],
    [/\b(?:made|hit|sank|knocked down) all (\d{1,2}|\w+) of (?:his|her|their) (?:3-pointers|three-pointers|threes|3-point attempts|three-point attempts)\b/gi, "fg3m", "fg3a"],
    [/\b(?:made|hit) all (\d{1,2}|\w+) of (?:his|her|their) (?:shots|field goals|field-goal attempts)\b/gi, "fgm", "fga"]]) for (const m of text.matchAll(re)) {
    const n = WORDS[m[1].toLowerCase()] ?? +m[1];
    if (!(n > 0)) continue;
    if (!out.has(made)) out.set(made, n);
    if (!out.has(att)) out.set(att, n);
  }
  return [...out].map(([stat, n]) => ({ stat, n }));
}

/** Opponents a sentence names ("vs. WAS", "at Detroit", "versus Miami", "@ LAL") -> tricodes. */
export function opponentsIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/\b(?:vs\.?|versus|at|@|against|over|in a win (?:over|at)|win (?:over|at|against))\s+(?:the\s+)?([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+)?)/g)) {
    const w = m[1];
    for (const [tri, t] of Object.entries(TEAMS)) {
      if (w === tri || w.startsWith(t.city) || w.startsWith(t.nick) || (t.alt || []).some((a) => w.startsWith(a))) out.add(tri);
    }
  }
  return [...out];
}

/**
 * The (player, game) pairs on this team whose box score has every claim.
 * box: the team file ({ keys, names, games: [{ d, opp, pl: { id: [..] } }] }).
 * opts: { ids } to look at only these players, { dates } / { opps } to look at only these games.
 * -> [{ id, d, opp }]
 */
export function matchGames(box, claims, { ids = null, dates = null, opps = null } = {}) {
  if (!box || !box.games || !claims.length) return [];
  const idx = Object.fromEntries((box.keys || []).map((k, i) => [k, i]));
  if (claims.some((c) => idx[c.stat] === undefined)) return [];
  const out = [];
  for (const g of box.games) {
    if (dates && dates.length && !dates.includes(g.d)) continue;
    if (opps && opps.length && !opps.includes(g.opp)) continue;
    for (const [id, row] of Object.entries(g.pl || {})) {
      if (ids && !ids.includes(id)) continue;
      if (!playedIn(g, id, idx.min)) continue;                            // 0.181.0: a player who sat out has a line of zeros, and it is not a game
      if (claims.every((c) => row[idx[c.stat]] === c.n)) out.push({ id, d: g.d, opp: g.opp });
    }
  }
  return out;
}

/**
 * What the box scores say about a sentence.
 *   who:   the player id the claims point to, if exactly one player on the team had such a game
 *   named: for the player the sentence is credited to (namedId): "yes" he had such a game this season,
 *          "no" he didn't (and the claims are specific enough to tell), or null (nothing to check)
 *   game:  the matching game, when one
 * A single claim with no date or opponent is too common to decide anything ("20 points").
 */
export function checkLine(box, text, { namedId = null, dates = [] } = {}) {
  const claims = statClaims(text);
  if (!box || !claims.length) return { claims, who: null, named: null, game: null };
  const opps = opponentsIn(text);
  const inSeason = dates.filter((d) => box.games?.some((g) => g.d === d));
  const narrowed = inSeason.length > 0 || opps.length > 0;
  const specific = claims.length >= 2 || narrowed;
  if (!specific) return { claims, who: null, named: null, game: null };
  const look = { dates: inSeason.length ? inSeason : null, opps: opps.length ? opps : null };
  const all = matchGames(box, claims, look);
  const players = [...new Set(all.map((x) => x.id))];
  const who = players.length === 1 ? players[0] : null;
  let named = null;
  if (namedId && box.games?.some((g) => g.pl && g.pl[namedId])) {
    const mine = all.filter((x) => x.id === namedId);
    named = mine.length ? "yes" : "no";
  }
  const game = (namedId ? all.find((x) => x.id === namedId) : null) || (who ? all.find((x) => x.id === who) : null) || null;
  return { claims, who, named, game };
}

/**
 * Thresholds in a sentence ("at least 35 points, 10 rebounds and 5 assists in a game", "four-plus steals and
 * four-plus 3FGM", "40+ PTS and 15+ REB") -> [{ stat, min }]. Only read when the sentence says "in a game"
 * (or "single game"), so season and career totals don't count.
 */
export function thresholdClaims(text) {
  if (!/\bin a (?:single |regular[- ]season |)game\b|\bsingle[- ]game\b/i.test(text)) return [];
  const out = new Map();
  const word = (w) => WORDS[w.toLowerCase()] ?? +w;
  const statOf = (w) => STAT.find(([, ws]) => new RegExp(`^(?:${ws})$`, "i").test(w))?.[0];
  const re = new RegExp(`(?:\\bat least\\s+)?${NUM}(\\+|-plus|\\s+or more)?\\s+(${STAT.map(([, w]) => w).join("|")})\\b`, "gi");
  let listOpen = false, prevEnd = -1;
  for (const m of text.matchAll(re)) {
    // 0.170.0: "to reach 45 points, 15 rebounds, six assists, five steals and eight 3-pointers in a game" names bars too
    const atLeast = /^at least/i.test(m[0]) || /\breach(?:es|ed|ing)?\s+$/i.test(text.slice(Math.max(0, m.index - 12), m.index));
    const chained = listOpen && /^[\s,]*(?:and\s+|or\s+)?$/.test(text.slice(prevEnd, m.index));
    if (atLeast || m[2] || chained) {
      const stat = statOf(m[3]);
      if (stat && !out.has(stat)) out.set(stat, word(m[1]));
      listOpen = true;
    } else listOpen = false;
    prevEnd = m.index + m[0].length;
  }
  return [...out].map(([stat, min]) => ({ stat, min }));
}

/** Did this player have a game this season meeting every threshold? -> the first such game, or null. */
export function meetsThresholds(box, id, ths) {
  if (!box || !box.games || !ths.length) return null;
  const idx = Object.fromEntries((box.keys || []).map((k, i) => [k, i]));
  if (ths.some((t) => idx[t.stat] === undefined)) return null;
  for (const g of box.games) {
    const row = g.pl && g.pl[id];
    if (row && ths.every((t) => row[idx[t.stat]] >= t.min)) return { id, d: g.d, opp: g.opp };
  }
  return null;
}

// ---------- A player's count of games this season, against his box scores (0.176.0) ----------
// The user, 11/27, of "Recorded 10 or more assists 14 times with a career-high 13 double-doubles" in Indiana's notes for
// Andrew Nembhard, who had played 14 games and had three such games: "the second bullet is a recap of last season, so
// this does not apply. you have the game logs to check against such claims".
const TIMES = `(\\d{1,3}|once|twice|${Object.keys(WORDS).join("|")})`;
const timesOf = (w) => ({ once: 1, twice: 2 })[w.toLowerCase()] ?? WORDS[w.toLowerCase()] ?? (parseInt(w, 10) || null);
// A count that is not one season's: a career's, a franchise's, a stretch of games, a run, the playoffs.
const NOT_A_SEASON_COUNT = /\b(?:in|of|over|during|for|throughout|across) (?:his|her) (?:\w+ )?career\b|\bcareer (?:totals?|games?|starts?)\b|\ball-time\b|\bin (?:franchise|team|club|NBA|league) history\b|\bsince (?:19|20)\d\d\b|\b(?:last|past|previous|first|final|next) (?:\w+ )?(?:games?|starts?|outings|contests|appearances|seasons?|months?|weeks?)\b|\bplayoffs?\b|\bpostseason\b|\bstraight\b|\bconsecutive\b|\bin a row\b|\bwith (?:the )?\p{Lu}\w+\b|\bas a (?:member|starter|reserve|\p{Lu})|\b(?:in|during) (?:October|November|December|January|February|March|April)\b/u;
/**
 * The counts of his own games a sentence states that a season's box scores can settle:
 *   "10 or more assists 14 times", "topped 30+ points twice", "21 games of 20 or more points",
 *   "scored in double figures 47 times", "13 double-doubles", "in his 57 starts"
 * -> [{ said, what, test(row, k) }], k = { stat: its column in the row }. Nothing for a career's count, a stretch or a run.
 */
export function seasonCounts(text) {
  const t = String(text || ""), out = [];
  if (NOT_A_SEASON_COUNT.test(t)) return out;
  const statOf = (w) => STAT.find(([, ws]) => new RegExp(`^(?:${ws})$`, "i").test(w))?.[0];
  const words = STAT.map(([, w]) => w).join("|"), num = (w) => WORDS[w.toLowerCase()] ?? +w;
  const add = (said, what, test) => { if (said >= 1 && !out.some((o) => o.what === what)) out.push({ said, what, test }); };
  // "10 or more assists 14 times", "30+ points twice"
  for (const m of t.matchAll(new RegExp(`(?<![\\d,.\\-/])${NUM}(?:\\+|-plus|\\s+or more)\\s+(${words})\\s+(?:on\\s+)?${TIMES}(?:\\s+times\\b|(?<=once|twice)\\b)`, "gi"))) {
    const stat = statOf(m[2]), min = num(m[1]);
    if (stat) add(timesOf(m[3]), `games with ${min}+ ${stat}`, (row, k) => row[k[stat]] >= min);
  }
  // "21 games of 20 or more points", "three games with at least 10 assists"
  for (const m of t.matchAll(new RegExp(`(?<![\\d,.\\-/])${TIMES}\\s+games?\\s+(?:of|with|scoring|recording)\\s+(at least\\s+)?${NUM}(\\+|-plus|\\s+or more)?\\s+(${words})\\b`, "gi"))) {
    const stat = statOf(m[5]), min = num(m[3]);
    if (stat && (m[2] || m[4])) add(timesOf(m[1]), `games with ${min}+ ${stat}`, (row, k) => row[k[stat]] >= min);
  }
  // "scored in double figures 47 times", "in double figures in 13 games"
  for (const m of t.matchAll(new RegExp(`\\bin double figures\\s+(?:in\\s+)?${TIMES}\\s+(?:times|games)\\b`, "gi"))) add(timesOf(m[1]), "games in double figures", (row, k) => row[k.pts] >= 10);
  // "13 double-doubles", "a career-high 13 double-doubles", "two triple-doubles" (an ordinal, "his 13th", counts the same)
  for (const m of t.matchAll(new RegExp(`(?<![\\d,.\\-/])(\\d{1,3}|${Object.keys(WORDS).join("|")})(?:st|nd|rd|th)?\\s+(double|triple)-doubles?\\b`, "gi"))) {
    const need = /triple/i.test(m[2]) ? 3 : 2;
    add(num(m[1]), need === 3 ? "triple-doubles" : "double-doubles", (row, k) => ["pts", "reb", "ast", "stl", "blk"].filter((x) => row[k[x]] >= 10).length >= need);
  }
  // "in his 57 starts", "over 45 appearances": games he started or played
  for (const m of t.matchAll(/\b(?:in|over|across|through) (?:his |her |all )?(\d{1,3}) (starts|games|appearances|contests)\b/gi)) {
    if (/starts/i.test(m[2])) add(+m[1], "starts", (row, k) => row[k.starter] === 1 && row[k.min] > 0);
    else add(+m[1], "games played", (row, k) => row[k.min] > 0);
  }
  return out;
}
/** How many of his games this season pass `test`, and how many he has played. -> { have, played } or null without his rows. */
export function countInSeason(box, id, test) {
  const k = Object.fromEntries((box?.keys || []).map((x, i) => [x, i]));
  if (k.min == null) return null;
  let have = 0, played = 0;
  for (const g of box.games || []) { const row = g.pl && g.pl[String(id)]; if (!row || !(row[k.min] > 0)) continue; played++; try { if (test(row, k)) have++; } catch { return null; } }
  return { have, played };
}
