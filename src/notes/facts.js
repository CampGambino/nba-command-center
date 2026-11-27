/**
 * What a line from a team's notes says, read for meaning (0.48).
 *
 * readHistory (narrative.js) finds the lines worth keeping and who each is about. This reads each one for:
 *   type        club | rank | streak | race | matchup | alltime | franchise | other
 *   tag         a short label for the page and the digest ("1 of 2 this season", "Leads NBA", "Active streak · 176")
 *   why         one line on why it matters tonight
 *   rank / of   "third-longest" -> rank 3; "one of five players" -> of 5; "the only team" -> of 1
 *   thresholds  "averaging 25+ points, 10+ rebounds, 1+ steal and 1+ block per game" -> [{ stat: "pts", min: 25 }, ...]
 *   features    the signals the scorer weighs (src/data/fact-model.json, learned from the user's picks)
 *
 * And readTables: the ranked tables printed beside the prose on infographic pages ("TOTAL ASSISTS LEADERS NBA,
 * SINCE 2018-19 SEASON RANK PLAYER ASSISTS 1 NIKOLA JOKIĆ 5,164 2 TRAE YOUNG 4,968 …"), so a line can say who is
 * next and by how much: the race.
 */
import { SEASON, SEASON_RE } from "../season.js";
// 0.141.6: "this season" by the season constant, not a typed "2026-27" (src/season.js; docs/SEASON.md).
const THIS_SEASON_RE = new RegExp(`\\bthis (?:season|year|campaign)\\b|\\bso far\\b|\\bcurrently\\b|\\b${SEASON_RE}\\b|\\bover the first \\d+ games of the season\\b|\\bwhich leads the league\\b`, "i");
import { blocks } from "./narrative.js";
import { TEAMS } from "../teams.js";

const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const ordNum = (w) => ORD[w.toLowerCase()] ?? (/^\d+/.test(w) ? parseInt(w, 10) : null);
export const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const plain = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");

const STAT = [
  ["pts", /^(?:points?|pts|ppg)$/i], ["reb", /^(?:rebounds?|rebs?|boards|rpg)$/i], ["ast", /^(?:assists?|asts?|apg)$/i],
  ["stl", /^(?:steals?|stls?|spg)$/i], ["blk", /^(?:blocks?|blks?|bpg|blocked shots)$/i], ["fg3m", /^(?:three-pointers|threes|3-pointers|3pm|3fgm)$/i],
];
const statKey = (w) => STAT.find(([, re]) => re.test(w))?.[0] || null;

/** "averaging 25+ points, 10+ rebounds, 1+ steal and 1+ block per game" / "posting at least 18.0 points, 4.0 assists…". */
export function thresholds(text) {
  const t = plain(text);
  const m = t.match(/\b(?:averag\w*|to average|posting|post|put up|putting up)\s+(?:at least\s+)?([^.;]*?)\s*(?:per game|a game|per contest|this season|$)/i);
  if (!m || !/per game|a game|averag|per contest/i.test(t)) return [];
  const atLeast = /at least/i.test(m[0]);
  const out = [];
  for (const x of m[1].matchAll(/(\d+(?:\.\d+)?)(\+|-plus)?\s*(?:or more\s+)?([a-z][a-z0-9-]*(?:\s+shots)?)/gi)) {
    const k = statKey(x[3]);
    if (k && (x[2] || atLeast)) out.push({ stat: k, min: Number(x[1]) });
  }
  return out;
}

function rankOf(t) {
  // "tying Michael Jordan for the seventh-most", "the third-longest active streak", "ranks 4th in the NBA", "T-3rd"
  let m = t.match(/\b(T-)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d{1,3}(?:st|nd|rd|th))[- ](?:most|highest|longest|best|fewest|lowest|least|largest|biggest|mark|in the (?:NBA|league)|among)\b/i);
  if (m) return { rank: ordNum(m[2]), tie: !!m[1] || /\btying\b|\bti(?:ed|es|e) for\b/i.test(t), at: m.index };   // 0.163.0: "which ties for second in the NBA"
  m = t.match(/\b(?:ranks?\s+|for\s+|into\s+)(T-)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d{1,3}(?:st|nd|rd|th))\b(?:\s+(?:all-time|on the|in (?:NBA|franchise|team|league) history|place))?/i);
  // 0.163.0: "…which ties for second in the NBA" is a tie (the Knicks' line of 11/25 was tagged "2nd in NBA")
  if (m) return { rank: ordNum(m[2]), tie: !!m[1] || (/^for/i.test(m[0]) && /\b(?:tie[sd]?|tying)\s+(?:(?:him|her|them|it)\s+)?$/i.test(t.slice(0, m.index))), at: m.index };
  m = t.match(/\b(T-)?(\d{1,3}(?:st|nd|rd|th)) in (?:NBA|league) history\b/i);   // 0.159.0: "…, 12th in NBA history"
  if (m && ordNum(m[2]) > 1) return { rank: ordNum(m[2]), tie: !!m[1], at: m.index };
  if (/\b(?:leads?|led|leading)\s+(?:all\s+|the\s+)?(?:NBA|league)\b|\blead(?:s)? the (?:NBA|league)\b|\b(?:owns|has|holds) the most\b|\bthe (?:most|highest|fewest|least|lowest|best)\b[^.;]{0,90}\b(?:in the (?:NBA|league)|of any (?:team|player))|\bblocked the least\b|\bwhich leads the league\b/i.test(t)) return { rank: 1, tie: false };
  return null;
}

function clubOf(t) {
  let m = t.match(/\bone of (two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+) (?:[\w-]+ ){0,2}(?:players|teams|guards|forwards|centers|rookies|duos|trios|Wizards|franchises)\b/i);
  if (m) return WORDNUM[m[1].toLowerCase()] ?? Number(m[1]);
  // "joins Atlanta and Utah as the only teams" -> 3; "joining John Wall (574) as the only players" -> 2
  m = t.match(/\bjoin(?:s|ed|ing)?\s+(.{2,120}?)\s+as the only\b/i);
  if (m) return m[1].split(/,\s*(?:and\s+)?|\s+and\s+/).filter(Boolean).length + 1;
  if (/\bthe only (?:[\w-]+ ){0,2}(?:player|team|rookie|duo|trio|franchise)\b|\bis the only\b|\bonly (?:player|team) (?:in|to)\b/i.test(t)) return 1;
  return null;
}

/** The signals the scorer weighs. Text only, plus what readHistory knew (kind, a named player, the team, the opponent). */
export function features(text, meta = {}) {
  const t = plain(text);
  const club = clubOf(t), rk = rankOf(t), th = thresholds(t);
  const league = /\bin (?:the )?(?:NBA|league)\b|\bleague-wide\b|\bof any (?:team|player)\b|\bby any (?:team|player)\b|\b(?:leads?|led) all NBA\b|\bamong (?:all )?(?:NBA|qualified|active)\b|\bin league history\b|\bin NBA history\b|\bthe NBA\b/i.test(t);
  const history = /\bin (?:NBA|league) history\b|\ball-time\b|\bsince (?:the )?(?:19[5-9]\d)\b|\bever\b|\bsince \w+ (?:began|were) (?:being )?(?:officially )?tracked\b/i.test(t);
  const teamOnly = /\bby any [A-Z][a-z]+s? player\b|\bby a [A-Z][a-z]+s? player\b|\bon the team\b|\bamong (?:all )?(?:[A-Z][a-z]+s?|team) (?:players|rookies)\b/.test(t);
  const franchise = /\b(?:in|on) (?:the )?[A-Z][a-z]+(?:['’]s?)? all-time\b|\b[A-Z][a-z]+['’]s? (?:all-time|career|franchise) (?:list|leaders?)\b|\b(?:franchise|team|club) (?:history|annals)\b/.test(t) || /\b(?:team|franchise|club) (?:history|annals|record)\b|\b[A-Z][a-z]+ (?:history|annals)\b(?<!NBA history)|\bof a [A-Z][a-z]+ career\b|\bby an? [A-Z][a-z]+(?: rookie)? (?:in|since)\b|\b(?:first|only|\w+) [A-Z][a-z]+s? (?:rookie|duo|trio|player)s? (?:to|since|in)\b/.test(t) && !/\bin (?:NBA|league) history\b/i.test(t);
  const season = THIS_SEASON_RE.test(t);
  const streak = /\b\d{2,} (?:consecutive|straight) (?:[\w-]+ ){0,2}(?:games|starts|contests)\b|\bactive streak\b|\blongest active\b/i.test(t);
  const race = /\bonly\b[^.;]{0,80}\bmore\b[^.;]{0,60}\bthan\b|\bsecond only to\b|\bbehind only\b|\b(?:owns|has|holds) the most\b[^.;]{0,40}\b(?:since|in the NBA)\b/i.test(t);
  const f = {
    club: club != null ? 1 : 0,
    clubSmall: club != null && club <= 3 ? 1 : 0,
    league: league ? 1 : 0,
    history: history ? 1 : 0,
    franchise: franchise || teamOnly ? 1 : 0,
    season: season ? 1 : 0,
    rank1: rk && rk.rank === 1 ? 1 : 0,
    rankTop3: rk && rk.rank >= 2 && rk.rank <= 3 ? 1 : 0,
    rankTop10: rk && rk.rank >= 4 && rk.rank <= 10 ? 1 : 0,
    rankDeep: rk && rk.rank > 10 ? 1 : 0,
    streak: streak ? 1 : 0,
    race: race ? 1 : 0,
    matchup: meta.matchup ? 1 : 0,
    perGame: /\bper game\b|\baverag\w*\b|\bppg\b|\ba game\b/i.test(t) ? 1 : 0,
    combo: th.length >= 3 ? 1 : 0,
    singleGame: /\bon (?:\d{1,2}\/\d{1,2}|(?:Oct|Nov|Dec|Jan|Feb|Mar|Apr)\.? \d)|\bin a (?:game|half|quarter)\b|\bseason[- ]opener\b|\bdebut\b|\bfirst game with\b/i.test(t) ? 1 : 0,
    slice: /\brookies?\b|\bunder the age of\b|\baged \d+ or younger\b|\bto start (?:his|their) career\b|\bover (?:his|the) first \d+ (?:career )?games\b|\bthrough \w+ career seasons\b|\b(?:second|third|fourth)-years?\b|\b(?:second|third)-year players?\b/i.test(t) ? 1 : 0,
    since1973: /\bsince (?:at least )?(?:19[789]\d|20[01]\d)(?:-\d\d)?\b|\bbegan being tracked\b|\bofficially (?:began|tracked)\b/i.test(t) ? 1 : 0,
    vague: /\bamong the (?:leaders|best)\b|\bone of the top\b|\bamong the top\b/i.test(t) ? 1 : 0,
    bio: /\bselected to\b|\bnamed (?:to|the)\b|\broster\b|\bAll-Star Weekend\b|\bdraft\b|\bovert?all (?:pick|selection)\b/i.test(t) ? 1 : 0,
    team: meta.team ? 1 : 0,
    player: meta.player ? 1 : 0,
    forward: meta.kind === "pass" || meta.kind === "next" ? 1 : 0,
    live: meta.live ? 1 : 0,
    long: Math.min(1.5, t.length / 250),
    // 0.49, from the user's review of 11/13: closed past one-offs score low, rarity over a long span scores high.
    opener: /\bseason[- ]opener\b|\bopening night\b|\bin (?:his|their|the) opener\b|\b(?:NBA|career) debut\b|\b(?:first|opening) (?:two|three|four|five|six|\d) (?:career )?games\b|\beach of the first\b/i.test(t) ? 1 : 0,
    pastPass: /\b(?:passed|surpassed|moved past|eclipsed|overtook)\b[^.]{0,80}\bon (?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.? \d|\d{1,2}\/\d)/i.test(t) ? 1 : 0,
    oneOff: /\btraveled to\b|\bfor the first time in (?:team|franchise) history to (?:face|play|visit|travel)\b|\b\d{1,3}(?:st|nd|rd|th) season in (?:franchise|team) history\b/i.test(t) ? 1 : 0,
    // 0.62, from the user's picks in the Rockets' and Blazers' notes (11/13): a stretch against the season, and a record when.
    stretch: /\b(?:past|last) (?:\d{1,2}|two|three|four|five|six) (?:games|GP|contests)\b|\bsince entering\b|\b\d{1,2} (?:straight|consecutive) games\b|\bin each of the (?:past|last)\b/i.test(t) ? 1 : 0,
    whenRecord: /\b\d{1,3}-\d{1,3} when\b|\bwhen (?:he|they|having|scoring|holding)\b[^.;]{0,50}\b\d{1,3}-\d{1,3}\b/i.test(t) ? 1 : 0,
    longSpan: (() => { const m = t.match(/\bsince\s+(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+)?((?:19|20)\d\d)/i); return m && new Date().getUTCFullYear() - Number(m[1]) >= 10 ? 1 : 0; })(),
  };
  return f;
}

export const FEATURES = Object.keys(features("x"));

/** The scorer: a logistic model over the features; weights learned from the user's picks (tools/train-fact-model.js). */
export function score(f, model) {
  const w = model?.weights || {};
  let z = model?.bias ?? 0;
  for (const k of FEATURES) z += (w[k] || 0) * (f[k] || 0);
  return 1 / (1 + Math.exp(-z));
}

const ENTERING = /\b(?:enter(?:ed|ing|s)?|came into|coming into|heading into)\s+(?:the\s+)?(?:20\d\d-\d\d(?:\s+(?:season|campaign))?|this (?:season|year|campaign)|the season)\b/gi;
const lastName = (n) => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV)$/, "").split(" ").pop();
/** True when the rank in the line is said of another named person: it sits in its own clause (after a dash or a
 *  semicolon), that clause names someone, and it doesn't name the line's player. */
function othersRank(t, rk, player) {
  if (!rk || rk.at == null || typeof player !== "string" || !player) return false;
  const before = t.slice(0, rk.at), cut = Math.max(before.lastIndexOf("—"), before.lastIndexOf("–"), before.lastIndexOf(";"));
  if (cut < 0) return false;
  const clause = before.slice(cut + 1).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\b[A-Z][\w'’.-]+ [A-Z][\w'’-]+/.test(clause) && !clause.includes(lastName(player));
}

/** The text without a sentence whose "only" belongs to another named person: the sentence opens with a full name that
 *  isn't the line's player (and doesn't name him), and it isn't the line's first sentence. */
function withoutOthersOnly(t, player) {
  if (typeof player !== "string" || !player) return t;
  const mine = lastName(player), flat = (x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const parts = t.split(/(?<=[.!?])\s+(?=[A-Z])/);
  if (parts.length < 2) return t;
  return parts.filter((p, i) => !(i > 0 && /^[A-Z][\w'’.-]+ [A-Z][\w'’-]+(?: (?:Jr\.?|Sr\.?|II|III|IV))? (?:is|was|remains|are|were) (?:still )?the only\b/.test(flat(p)) && !flat(p).includes(mine))).join(" ");
}
// 0.163.0 (the user, 11/25: "an NBA record comes before a franchise record"): the best mark in NBA history, said outright
const NBA_BEST = /(?<!one of )(?<!among )\bthe (?:most|highest|best|longest|fewest|lowest|youngest|oldest|fastest|largest)\b(?:(?!\b(?:franchise|team|club)\b)[^.;,]){0,80}\bin (?:NBA|league) history\b|\b(?:holds|owns|set|sets|broke|breaks) (?:the|an) (?:NBA|league)(?: all-time)? record\b/i;

/** Type, tag and a one-line why, for the page, the storylines and the digest. */
export function describe(text, meta = {}) {
  const t = plain(text);
  const f = features(t, meta);
  // 0.163.0: an "only" said of someone else isn't this line's ("…Gobert became the 17th NBA player to register at least
  // 500 blocks with 2 different teams. Manute Bol is the only player to accomplish the feat with three teams." was "Only one")
  const club = clubOf(withoutOthersOnly(t, meta.player)), th = thresholds(t);
  // 0.159.0: a rank said of someone else isn't this line's ("Holiday is the second current Trail Blazer to crack the NBA's
  // all-time scoring top 100—Damian Lillard currently ranks 37th on the list" was tagged "37th all-time").
  const rk = othersRank(t, rankOf(t), meta.player) ? null : rankOf(t);
  // 0.159.0: "Entered 2026-27 as the only player…" is about before this season, not about it (it was "Only one this season").
  const seasonNow = f.season && THIS_SEASON_RE.test(t.replace(ENTERING, " "));
  // 0.159.0: first place shared is a tie ("tied with Boston for the most games in the NBA" was "Leads NBA").
  const tie1 = /\btied (?:with [^.;,]{1,40} )?for (?:the )?(?:first|most|(?:league|NBA) lead|lead)\b|\bT-(?:1st|first)\b/i.test(t);
  const sinceYr = (t.match(/\bsince (?:the )?((?:19|20)\d\d(?:-\d\d)?)\b/i) || [])[1] || null;
  const streakN = t.match(/\b(\d{2,}) (?:consecutive|straight) (?:games|starts|contests)\b/i);
  const teamScope = /\b(?:franchise|team|club) (?:history|annals)\b|\b[A-Z][a-z]+['’]s? (?:all-time|career|franchise)\b|\bby any [A-Z][a-z]+s? player\b/.test(t)
    || (/\b(?:the )?only (?!NBA\b)(?:[A-Z][a-z]+s|76ers)\b(?! in NBA history)|\b\d{1,2}(?:st|nd|rd|th) [A-Z][a-z]+ ever\b|\bone of \w+ (?!NBA\b|All\b)[A-Z][a-z]+ (?:rookies|players|guards|forwards|centers|reserves)\b/.test(t) && !/\bin (?:NBA|league) history\b/i.test(t)); // "the only Raptors to…" (0.69), "one of three Maverick rookies" (0.71)
  const scope = teamScope ? "franchise" : f.league ? (f.history || /since/i.test(t) && !f.season ? "nba-history" : "nba") : f.franchise ? "franchise" : null;
  let type = "other", tag = "Notes", why = "";
  // 0.170.0: a run measured against the whole league that names tonight's opponent only as its latest game ("In defeating
  // Memphis 104-95 on Nov. 21, the Wolves have now won 34 consecutive games when holding opponents to 105 points or fewer,
  // the longest active streak in the NBA", tagged "Series") is a streak; one counted against the opponent stays a series note.
  const leagueRun = f.streak && /\b(?:(?:second-|third-)?longest|only) active\b[^.;]{0,50}\bin the (?:NBA|league)\b|\bactive (?:such )?streak in the (?:NBA|league)\b/i.test(t)
    && !/\b(?:straight|consecutive)\b[^.;]{0,40}\b(?:against|vs\.?|versus|over) (?:the )?[A-Z]|\bmeetings?\b|\bseries\b/.test(t);
  if (f.matchup && !leagueRun) { type = "matchup"; tag = /\ball-time against\b[^.]*\bas a head coach\b/.test(t) ? "Coach vs. opponent" : "Series"; why = "The history with tonight's opponent."; }
  else if (f.race) { type = "race"; tag = rk && rk.rank > 1 && f.history && !sinceYr ? `${rk.tie ? "T-" : ""}${ordinal(rk.rank)} all-time` : "Race"; why = "A race on a leaderboard: both sides can move."; }   // 0.159.0: its place, when it says one
  else if (f.streak && !ABSENCE.test(t) && !/\bfrom (?:\w+\.? \d{1,2}|\d{1,2}\/\d{1,2})[^.]{0,30}\b(?:to|through|until) (?:\w+\.? \d{1,2},? (?:19|20)\d\d|\d{1,2}\/\d{1,2}\/\d{2,4})|\b(?:snapped|ended|came to an end)\b/i.test(t)) { type = "streak"; tag = streakN ? `Active streak · ${Number(streakN[1])}` : "Active streak"; why = "A live streak: it grows if he plays tonight."; }
  else if (club != null) {
    type = "club";
    // 0.159.0: "one of 23 players in the NBA … since the 2021-22 campaign" is since 2021-22, not "in NBA history"
    const where = scope === "franchise" ? " in team history" : seasonNow ? " this season" : f.history ? " in NBA history" : sinceYr ? ` since ${sinceYr}` : scope === "nba-history" ? " in NBA history" : "";
    tag = club === 1 ? `Only one${where}` : `1 of ${club}${where}`;
    why = seasonNow ? "Rare company this season, and every game moves the averages." : scope === "franchise" ? "A first for the franchise." : "Rare company in league history.";
  } else if (rk && scope === "franchise") {
    type = "franchise"; tag = `${rk.tie ? "T-" : ""}${ordinal(rk.rank)} in team history`; why = "Team history.";
  } else if (rk && scope !== "franchise" && (f.league || f.season)) {
    type = "rank";
    // 0.163.0: "leads the NBA in free throw percentage (.854) and is on pace to record the best … in NBA history" is a
    // lead held now ("Most in NBA" read as a count, and as history)
    const leadsNow = /\blead(?:s|ing)? (?:all )?(?:the )?(?:NBA|league)\b/i.test(t) && !sinceYr;
    tag = rk.rank === 1 ? (tie1 ? "T-1st in NBA" : f.season || !f.history || leadsNow ? "Leads NBA" : "Most in NBA") : `${rk.tie ? "T-" : ""}${ordinal(rk.rank)} in NBA`;
    // 0.159.0: "since the 2022-23 season" is a span too ("51 in that time, which ranks second in the NBA" was "2nd all-time")
    if ((f.history || /since/i.test(t)) && !(rk.rank === 1 && leadsNow && !tie1)) tag = rk.rank === 1 ? `Most since ${(t.match(/since (?:entering the league in |the )?((?:19|20)\d\d(?:-\d\d)?)/i) || [])[1] || "…"}`.replace(" since …", " in NBA") : `${rk.tie ? "T-" : ""}${ordinal(rk.rank)} ${sinceYr ? `since ${sinceYr}` : "all-time"}`;
    why = rk.rank === 1 ? "Best in the league right now." : rk.rank <= 3 ? "Top three in the league right now." : "Where he stands in the league.";
  } else if (scope !== "franchise" && (f.history || scope === "nba-history")) {
    const since = t.match(/\bsince (?:the )?((?:19|20)\d\d(?:-\d\d)?)\b/i);
    type = "alltime"; tag = rk ? `${rk.tie ? "T-" : ""}${ordinal(rk.rank)} ${since ? `since ${since[1]}` : "all-time"}` : since ? `Since ${since[1]}` : "NBA history"; why = "All-time company.";
  } else if (f.franchise) { type = "franchise"; tag = "Team history"; why = "Team history."; }
  { const nb = NBA_BEST.exec(t);   // 0.163.0: before a franchise rank, and before a lower rank said after it
    if (nb && (type === "franchise" || (type === "rank" && rk && rk.rank > 1 && rk.at > nb.index))) {
      type = "alltime"; tag = /\b(?:tied|ties|tying|matched|matching|equal(?:l?ed|s))\b[^.;,]{0,25}$/i.test(t.slice(0, nb.index)) ? "Ties NBA record" : "NBA record"; why = "The best mark in league history."; } }
  // A ranking within a subset says so ("Amongst all NBA centers, Sharpe ranks fifth…" is "5th among centers", 0.65).
  const subset = t.match(/\bamong(?:st)? (?:all )?(?:NBA |qualified )?(centers|rookies|guards|forwards|reserves|bench players|point guards|power forwards|sophomores|teenagers)\b/i);
  if (subset && rk && rk.rank === 1 && /^(?:Leads NBA|Most in NBA)$/.test(tag)) tag = `Leads ${subset[1].toLowerCase()}`;
  if (subset && rk && / in (?:NBA|team history)$| all-time$/.test(tag)) tag = tag.replace(/ in NBA$| in team history$| all-time$/, (m) => ` among ${subset[1].toLowerCase().replace(/([^s])$/, "$1s")}${/team/.test(m) ? " (team)" : ""}`);
  // 0.158.0: a rank in a conference isn't a rank in the NBA ("Maxey ranks tied for second most 20-point games in the Eastern
  // Conference and tied for fourth most in the league" was tagged "T-2nd in NBA")
  { const conf = t.match(/\bin the (Eastern|Western) Conference\b/i), lg = t.search(/\bin the (?:NBA|league)\b/i);
    if (conf && / in NBA$/.test(tag) && (lg < 0 || conf.index < lg)) tag = tag.replace(/ in NBA$/, ` in the ${conf[1][0].toUpperCase()}${conf[1].slice(1, -3).toLowerCase()}`); }
  return { type, tag, why, rank: rk?.rank ?? null, tie: rk?.tie ?? false, of: club, thresholds: th, streak: streakN ? Number(streakN[1]) : null, features: f };
}

/**
 * Ranked tables on the notes' pages: [{ page, title, scope, rows: [{ rank, tie, name, team, value, text }] }].
 * Infographic pages print "<TITLE> RANK <COLUMNS> 1 TRAE YOUNG WAS 100 2 DAVION MITCHELL MIA 93 …"; extra columns
 * ("SEASON(S) 2020-21", "DATE OPP. 10/21/26 VS. MIL") are allowed. A row is a rank, a name in capitals, then cells;
 * its value is its last number. The table ends at prose (a lower-case word) or at the next table's title.
 */
const TRI = new Set(["ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GSW","HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NOP","NYK","OKC","ORL","PHI","PHX","POR","SAC","SAS","TOR","UTA","WAS","GS","NO","NY","SA","UTAH","WSH","PHO","BRK","NOJ","SEA","NJN","VAN","CHH","NOH","NOK","KCK","BUF","SDC"]);
const isNum = (w) => /^(?:\d[\d,]*(?:\.\d+)?|\.\d+)%?$/.test(w);
const isRank = (w) => /^(?:T-)?\d{1,2}$/.test(w);
const isCapsWord = (w) => /^[A-Z][A-Z.'’\-]*,?$/.test(w) && /[A-Z]{2}|^(?:[A-Z]\.)+,?$/.test(w);
export function readTables(doc) {
  const out = [];
  for (const b of blocks(doc)) {
    const txt = plain(b.text).replace(/\s+/g, " ");
    const hre = /\b(?:RANK|RK\.?)\s+(?:PLAYER|TEAM|NAME)\b/g;
    let h;
    while ((h = hre.exec(txt))) {
      // Title: the run of capitals (and digits, %, punctuation) just before RANK.
      const before = txt.slice(Math.max(0, h.index - 200), h.index).trim().split(" ");
      const tt = [];
      for (let i = before.length - 1; i >= 0 && tt.length < 16; i--) { if (/[a-z]/.test(before[i])) break; tt.unshift(before[i]); }
      // The tail of the table before ("39 2 DENVER 42 3 LA CLIPPERS 44 TEAM, MOST POINTS…"): cut after its last number.
      if (tt.some((w, k) => k > 0 && isNum(tt[k - 1]) && isRank(w) && isCapsWord(tt[k + 1] || ""))) { let k = tt.length - 1; while (k >= 0 && !isNum(tt[k])) k--; tt.splice(0, k + 1); }
      while (tt.length && (/\.$/.test(tt[0]) && tt.length > 2 || /^@/.test(tt[0]))) tt.shift(); // "NBA." / "2024-25." ending the line before
      const title = tt.join(" ").replace(/^[,.\s]+/, "").trim();
      // Columns, then rows.
      const words = txt.slice(h.index + h[0].length).trim().split(" ");
      let i = 0;
      while (i < words.length && !(isRank(words[i]) && /^(?:T-)?1$/.test(words[i]) && isCapsWord(words[i + 1] || ""))) { if (/[a-z]/.test(words[i]) || i > 8) break; i++; }
      if (!/^(?:T-)?1$/.test(words[i] || "")) continue;
      const rows = [];
      let expect = 1;
      while (i < words.length && rows.length < 15) {
        const rk = words[i];
        if (!isRank(rk) || !isCapsWord(words[i + 1] || "")) break;
        const rank = Number(rk.replace("T-", ""));
        if (rank < expect - 1 || rank > expect + 3) break;
        let j = i + 1;
        const name = [];
        while (j < words.length && isCapsWord(words[j]) && !(TRI.has(words[j]) && name.length >= 1 && (name.length >= 2 || /\.$/.test(name[0]))) && name.length < 5) name.push(words[j++]);
        const cells = [];
        let endTable = false;
        while (j < words.length) {
          const w = words[j];
          if (/[a-z]/.test(w)) { endTable = true; break; }
          if (isRank(w) && isCapsWord(words[j + 1] || "") && cells.some(isNum) && Number(w.replace("T-", "")) >= rank && Number(w.replace("T-", "")) <= rank + 3) break; // next row
          // Two capital words in a row after the numbers: the next table's title.
          if (cells.some(isNum) && isCapsWord(w) && !TRI.has(w) && !/^(?:VS\.?|AT|@)$/.test(w) && isCapsWord(words[j + 1] || "") && !TRI.has(words[j + 1] || "")) { endTable = true; break; }
          cells.push(w); j++;
          if (cells.length > 8) break;
        }
        const nums = cells.filter(isNum);
        if (!name.length || !nums.length) break;
        const v = nums[nums.length - 1];
        rows.push({ rank, tie: rk.startsWith("T-"), name: name.join(" ").replace(/,$/, ""), team: cells.find((c) => TRI.has(c)) || null, value: Number(v.replace(/[,%]/g, "")), text: v });
        expect = rank + 1;
        i = j;
        if (endTable) break;
      }
      if (rows.length >= 2) out.push({ page: b.page, title, scope: /\bSINCE\b|ALL-TIME|HISTORY|CAREER/.test(title) ? "history" : /\b20\d\d-\d\d\b/.test(title) ? "season" : null, rows });
    }
  }
  return out;
}

/**
 * The race in a table for a subject (a player's or team's name): who is just above and below, and by how much.
 *   -> { rank, value, above: { name, gap }, below: { name, gap }, title } or null
 */
export function raceIn(table, names) {
  const up = (s) => plain(s).toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ").trim();
  const want = names.filter(Boolean).map(up).filter((n) => n.length >= 3);
  const i = table.rows.findIndex((r) => want.some((n) => up(r.name) === n || up(r.name).endsWith(` ${n}`) || n.endsWith(` ${up(r.name)}`)));
  if (i < 0) return null;
  const r = table.rows[i];
  const dp = Math.max(...table.rows.map((x) => (x.text.split(".")[1] || "").length));
  const gap = (a, b) => Number(Math.abs(a - b).toFixed(dp));
  const nice = (s) => (TRI.has(s) ? s : s.toLowerCase().replace(/(^|[\s'’\-.])([a-z])/g, (_, p, c) => p + c.toUpperCase()));
  return {
    rank: r.rank, value: r.value, valueText: r.text, title: table.title,
    above: i > 0 ? { name: nice(table.rows[i - 1].name), team: table.rows[i - 1].team, gap: gap(table.rows[i - 1].value, r.value), text: table.rows[i - 1].text } : null,
    below: i < table.rows.length - 1 ? { name: nice(table.rows[i + 1].name), team: table.rows[i + 1].team, gap: gap(table.rows[i + 1].value, r.value), text: table.rows[i + 1].text } : null,
  };
}

// ---------- Reading a team's lines together (0.48) ----------
const STOP = new Set("the a an of in on at to for and or with by is are has have his her their its this that as from be was were he she they it all any per game games season nba league player players team teams".split(" "));
const stem = (w) => w.replace(/(?:ies)$/, "y").replace(/(?:ing|ed|es|s)$/, "");
const SYN = [[/\bopp(?:onents?|\.)?(?=\s|$)/g, "opponent"], [/\b(?:3pt%?|3-?pt|three-point|3-point|threes|3pm|3fg%?)/g, "3p"], [/\b(?:2pt%?|two-point|twopointers?|two-pointers?|2pa)/g, "2p"],
  [/\bppg\b/g, "point"], [/\brpg\b/g, "rebound"], [/\bapg\b/g, "assist"], [/\bfgs?\b/g, "field goal"], [/\bslams?\b/g, "dunk"], [/\bba\b/g, "blocks against"]];
const bag = (t) => { let x = plain(t).toLowerCase(); for (const [re, w] of SYN) x = x.replace(re, w); return new Set(x.replace(/[^a-z0-9.%+ -]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).map(stem)); };
// Most of the shorter line's words are in the longer one (5+ shared): the same fact, told at two lengths.
const contained = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i >= 5 && i / Math.min(a.size, b.size) >= 0.7; };
const jaccard = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };
const sig = (th) => th.map((x) => `${x.stat}${x.min}`).sort().join(",");

/** The same fact printed twice (a player's page and an infographic page): keep the better-scored one. */
/** The longest run of characters two lines share, letters and digits only, case ignored. */
export function commonRun(a, b) {
  const A = plain(a).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), B = plain(b).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  let best = 0, prev = new Uint16Array(B.length + 1);
  for (let i = 1; i <= A.length; i++) { const cur = new Uint16Array(B.length + 1); for (let j = 1; j <= B.length; j++) if (A[i - 1] === B[j - 1]) { cur[j] = prev[j - 1] + 1; if (cur[j] > best) best = cur[j]; } prev = cur; }
  return best;
}
export function dedupe(lines) {
  const out = [];
  // A box's heading put before its bullet ("Rockets Offense: …", "Rockets Defense: …") is not part of what the line says.
  const said = (l) => (l.topic && l.text.startsWith(`${l.topic}: `) ? l.text.slice(l.topic.length + 2) : l.text);
  for (const l of [...lines].sort((a, b) => (b.score || 0) - (a.score || 0))) {
    const d = l.facts || describe(l.text, l), b = bag(said(l)), who = l.player || (l.matchup ? "series" : "team");
    let kin = null;
    const dup = out.find((o) => {
      // 0.158.0: the same sentence in two places with another opening, even filed under two players ("Hawkins’ effort
      // matched the most points by any Bulls reserve this season (other: …" and "His 19 points off the bench matched the
      // most points by any Bulls reserve this season (previous high: …", the second credited to Leonard Miller)
      // (and the same numbers: "…in eight-straight games from October 26 through November 10" and "…in nine-straight games
      // from October 26 through November 8" share as long a run and are two facts)
      { const A = said(l), B = said(o), na = numbersIn(A), nb = numbersIn(B), [sm, lg] = na.size <= nb.size ? [na, nb] : [nb, na];
        if (sm.size && [...sm].every((x) => lg.has(x)) && commonRun(A, B) >= 45) return true; }
      if ((o.player || (o.matchup ? "series" : "team")) !== who) return false;
      const od = o.facts, ob = bag(said(o));
      if (d.thresholds.length >= 2 && sig(d.thresholds) === sig(od.thresholds)) return true;
      if (d.streak && d.streak === od.streak) return true;
      const j = jaccard(b, ob);
      let shared = 0; for (const x of b) if (ob.has(x)) shared++;
      { const A = said(l), B = said(o), na = numbersIn(A).size, nb = numbersIn(B).size; if (na <= nb ? sameFact(A, B) : sameFact(B, A)) return true; }
      // 0.163.0: two bars are two facts ("pulled down 50+ rebounds for the sixth time this season, which ties for second
      // in the NBA" and "40+ rebounds as a team for the 13th time this season, tying for second in the NBA": the Knicks'
      // lines of 11/25 were kept apart only by the first one's tag missing its tie)
      const bars = (x) => [...plain(x).matchAll(/\b(\d+)(?:\+|-plus| or more)/g)].map((m) => m[1]).sort().join(), ba = bars(said(l)), bb = bars(said(o));
      const twoBars = !!ba && !!bb && ba !== bb, alike = d.type === od.type && d.tag === od.tag && (j >= 0.35 || (d.rank === 1 && shared >= 4));
      if (alike && twoBars && j < 0.6) kin ??= o.text;   // kept apart from this line by its bars alone: scripts/tonight.js dates it like that line for the first days of the rule
      // 0.170.0: two career counts are two facts too ("at least one steal and one block in 107 career games, which is ranked
      // 4th in franchise history" and "three steals in 73 career games, which is ranked 4th in franchise history", New
      // Orleans: the second, read for the first time on 11/27, took the first one's place)
      const games = (x) => [...plain(x).matchAll(/\bin (\d[\d,]*) career games\b/g)].map((m) => m[1]).sort().join(), ga = games(said(l)), gb = games(said(o));
      if (ga && gb && ga !== gb) return false;
      return j >= 0.6 || (alike && !twoBars);
    });
    if (!dup) out.push({ ...l, facts: d, ...(kin ? { kin } : {}) });
    // 0.77: the one that says more stays ("He ranks 11th in the NBA with 130 bench points" lost to "Wagner ranks 11 with
    // 130 bench points this season and is 8th in the NBA with a 58.4% FG"; the user, 11/16), whatever their scores.
    else if (numbersIn(said(l)).size > numbersIn(said(dup)).size && sameFact(said(dup), said(l))) out[out.indexOf(dup)] = { ...l, facts: d };
    // The same numbers both ways: the telling that opens with his name over one with a heading spliced on its front.
    else if (l.player && numbersIn(said(l)).size === numbersIn(said(dup)).size && sameFact(said(dup), said(l)) && opensWithName(l) && !opensWithName(dup)) out[out.indexOf(dup)] = { ...l, facts: d };
  }
  return out;
}

const opensWithName = (l) => { const t = plain(l.text), n = plain(l.player || "").split(" "); return !!l.player && (t.startsWith(n[0]) || t.startsWith(n[n.length - 1]) || (n.length > 2 && t.startsWith(n[n.length - 2]))); };
// ---------- The same fact told twice, at two lengths or in other words (0.77) ----------
const NUM_WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
/** Every number a line states, as written or spelled ("five straight", "11th", "58.4%", "T-1st"). */
export function numbersIn(text) {
  const out = new Set();
  const t = plain(text).toLowerCase().replace(/\b(?:19|20)\d\d-\d\d\b/g, " ");
  for (const m of t.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(String(parseFloat(m[0].replace(/,/g, ""))));
  for (const m of t.matchAll(/[a-z]+/g)) if (NUM_WORD[m[0]] != null) out.add(String(NUM_WORD[m[0]]));
  return out;
}
const SAME_SYN = [[/\bconsecutive\b/g, "straight"], [/\b(?:contests|outings)\b/g, "games"], [/\bmin\./g, "minimum"], [/\b(\d+)(?:st|nd|rd|th)\b/g, "$1"], [/\b(?:owns|holds|has)\b/g, "has"], [/\b(?:franchise|team|club)[- ]record\b/g, "franchise longest"],
  [/\bestablish(?:es|ed)?\b/g, "is"], [/\b(?:which|that|also|well|now|currently)\b/g, " "]];
const sameBag = (t) => { let x = plain(t).toLowerCase(); for (const [re, w] of SAME_SYN) x = x.replace(re, w); return bag(x); };
/**
 * Is `short` the same fact as `long`, told in fewer or other words? Every number the shorter states is in the longer,
 * and most of its words are too (four or more shared, 60% of the shorter's).
 */
export function sameFact(short, long) {
  const a = numbersIn(short), b = numbersIn(long);
  if (!a.size) return false;
  for (const n of a) if (!b.has(n)) return false;
  const x = sameBag(short), y = sameBag(long);
  let shared = 0; for (const w of x) if (y.has(w)) shared++;
  return shared >= 4 && shared / Math.min(x.size, y.size) >= 0.6;
}

/** The ranked table printed with a line (same page or the next), by its subject's row and the words they share. */
export function tableFor(line, tables, subjectNames) {
  const b = bag(line.text);
  let best = null;
  for (const t of tables) {
    if (Math.abs(t.page - (line.page ?? t.page)) > 1) continue;
    const race = raceIn(t, subjectNames);
    if (!race) continue;
    const overlap = jaccard(b, bag(t.title));
    const numHit = new RegExp(`(?:^|[^\\d.,])${race.valueText.replace(/[.]/g, "\\.")}(?!\\d|,\\d)`).test(line.text) ? 0.5 : 0;
    const s = overlap + numHit;
    // The line's own rank ("sixth-most", "leads the league") must be the subject's row, or its number must be the row's value.
    const rankOk = line.facts?.rank != null ? line.facts.rank === race.rank : false;
    if (((numHit && (rankOk || overlap >= 0.1)) || (rankOk && overlap >= 0.1)) && (!best || s + (rankOk ? 0.3 : 0) > best.s)) best = { s: s + (rankOk ? 0.3 : 0), race, table: t };
  }
  return best ? { ...best.race, scope: best.table.scope } : null;
}

const fmt = (n, like = "") => (Number.isInteger(n) ? n.toLocaleString("en-US") : /^\./.test(like) ? n.toFixed(3).replace(/^0/, "") : String(n));
const WORD = { pts: "points", reb: "rebounds", ast: "assists", stl: "steals", blk: "blocks", fg3m: "threes" };

/**
 * "One of five players averaging 18+ points, 4+ assists…": what he needs tonight to still be averaging all of it
 * (averages print to one decimal, so 24.95 counts as 25.0). From this season's box scores.
 *   -> { games, ok: true|false, need: [{ stat, min, now, need }] }  (need 0 = safe whatever he does)
 */
export function stayInClub(thresholdsList, box, playerId) {
  if (!box || !playerId || !thresholdsList?.length) return null;
  const k = Object.fromEntries((box.keys || []).map((x, i) => [x, i]));
  const g = (box.games || []).filter((x) => x.pl?.[playerId]?.[k.min] > 0 || (x.z || []).includes(String(playerId)));
  if (g.length < 3) return null;
  const need = thresholdsList.filter((t) => k[t.stat] != null).map((t) => {
    const tot = g.reduce((a, x) => a + x.pl[playerId][k[t.stat]], 0);
    const now = tot / g.length;
    return { stat: t.stat, min: t.min, now: Math.round(now * 10) / 10, need: Math.max(0, Math.ceil((t.min - 0.05) * (g.length + 1) - tot - 1e-9)) };
  });
  return { games: g.length, ok: need.every((n) => n.now >= n.min - 0.05), need };
}

/**
 * What tonight can change, in one line: the minimum to stay in a club, the gap on the list printed with the line,
 * the streak's next number. Null when the line has no live angle.
 */
export function hookFor(line, { race = null, stay = null } = {}) {
  const d = line.facts || describe(line.text, line);
  if (stay) {
    if (!stay.ok) {
      const off = stay.need.filter((n) => n.now < n.min - 0.05).map((n) => `${n.now} ${WORD[n.stat]}`);
      return { text: `No longer true: now ${off.join(", ")} a game.`, live: false, stale: true };
    }
    const tight = stay.need.filter((n) => n.need > 0).sort((a, b) => b.need / (b.min || 1) - a.need / (a.min || 1));
    if (!tight.length) return { text: "Stays in it tonight whatever he does.", live: false };
    return { text: `Stays in it with ${tight.map((n) => `${n.need}+ ${n.need === 1 ? WORD[n.stat].replace(/s$/, "") : WORD[n.stat]}`).join(", ")} tonight.`, live: true };
  }
  if (race) {
    // Live: this season's lists, active streaks, and counting lists (100+) where the gap is a game's worth (10 or less).
    const single = /\b(?:IN A|DEBUT|OPENER|SEASON-?OPENER|OVER \d+ (?:CAREER )?GAMES)\b/.test(race.title || "");
    const live = (gap) => !single && (/ACTIVE/.test(race.title || "") || race.scope === "season" && !/20\d\d-\d\d/.test((race.title || "").replace(SEASON, "")) || race.value >= 100 && gap <= 10);
    if (race.rank === 1 && race.below) return race.below.gap === 0
      ? { text: `Tied with ${race.below.name} at ${race.valueText} on the list, listed first.`, live: live(0), race }
      : { text: `Leads ${race.below.name} by ${fmt(race.below.gap, race.valueText)} (${race.valueText} to ${race.below.text}).`, live: live(race.below.gap), race };
    if (race.above) return { text: race.above.gap === 0 ? `Tied with ${race.above.name} at ${race.valueText}.` : `${fmt(race.above.gap, race.valueText)} behind ${race.above.name} (${race.above.text}) for ${ordinal(race.rank - 1)}.`, live: live(race.above.gap), race };
  }
  if (d.type === "streak" && d.streak) {
    const t = plain(line.text);
    // 0.113: a team line. Its count is the notes' until checkStreaks has set it against the results; it used to read
    // "12 with tonight's game" on a streak that had ended two days before.
    if (!line.player) return { text: `The notes' count, not checked against the results.`, live: false, unchecked: true };
    // A games-played streak goes on if he plays; any other streak goes on only if he does it again.
    return /\b(?:appeared|played|games? played|starts|started|consecutive (?:games|starts)(?: played)?\b(?! with| of| in which))/.test(t) && !/\b(?:with (?:at least|a|an|\d)|recorded|scored|made|posted|registered|tallied)\b[^.]{0,40}\b(?:consecutive|straight)\b|\b\d+(?:\+|-plus)\s/.test(t)
      ? { text: `${d.streak + 1} if he plays tonight.`, live: true } : { text: `${d.streak + 1} if he does it again tonight.`, live: true };
  }
  return null;
}

/**
 * A team's lines, read together: duplicates removed, each with type, tag, why, the table printed beside it,
 * the "stay in the club" check, a hook for tonight and the learned score (src/data/fact-model.json).
 */
const ordinalWord = (n) => ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "10th", "11th", "12th"][n] || `${n}th`;
const NUMW = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
/**
 * When a "within his first N seasons" fact happened (0.71; the user, 11/15, on Luguentz Dort's "one of only three
 * undrafted players… to start 400 games within their first seven seasons": "it doesn't tell me… when it happened").
 * seasons: the player's NBA seasons before this one, oldest first ("2019-20", …). The fact was settled by his Nth.
 */
export function whenWithin(text, seasons) {
  const m = plain(text).match(/\b(?:within|in|over|through) (?:his|their|the) first (\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (?:NBA )?seasons\b/i);
  if (!m || !Array.isArray(seasons) || !seasons.length) return null;
  const n = /\d/.test(m[1]) ? +m[1] : NUMW[m[1].toLowerCase()];
  if (!n || seasons.length < n) return null; // still in his first N: it can still happen this season
  return { n, season: seasons[n - 1] };
}

// 0.78: games missed in a row are not a streak he extends by playing ("returned to the court after missing 11 consecutive
// games due to a left knee contusion" was tagged "Active streak · 11 → 12 if he plays tonight"; the user, 11/16).
export const ABSENCE = /\b(?:miss(?:ed|ing|es)?|sat out|sitting out|sidelined|was out|been out|out for|inactive for|absent for|did not play in|unavailable for)\b[^.]{0,40}\b\d+ (?:consecutive|straight)\b|\b\d+ (?:consecutive|straight) (?:games|contests) (?:missed|out|on the sidelines)\b|\b(?:after|following) (?:a|an) \d+-game absence\b/i;
export function annotate(lines, { doc = null, tables = null, box = null, model = null, teamNames = [], careers = null } = {}) {
  const T = tables || (doc ? readTables(doc) : []);
  for (const l of lines || []) {
    const w = l.player && careers ? whenWithin(l.text, careers[l.player]) : null;
    if (w && !/\(by (?:the end of )?his /.test(l.text)) l.text = l.text.replace(/\.?$/, ` (settled by the end of his ${ordinalWord(w.n)} season, ${w.season}).`);
  }
  // 0.71: "one of three rookies to record 10+ offensive rebounds" when the same notes say "one of three Maverick
  // rookies to record 10+ offensive rebounds" elsewhere: it's a team club; say so.
  const scoped = (lines || []).map((l) => plain(l.text).match(/\bone of (\w+) ([A-Z][a-z]+(?:er)?s?) (rookies|players|guards|forwards|centers|reserves)\b([^.,;]{0,60})/)).filter(Boolean);
  for (const l of lines || []) {
    const t = plain(l.text);
    const m = t.match(/\bone of (\w+) (rookies|players|guards|forwards|centers|reserves)\b([^.,;]{0,60})/);
    if (!m || /\b(?:NBA|league) history\b|\bin (?:the )?(?:NBA|league)\b/.test(t)) continue;
    const words = (x) => new Set(x.toLowerCase().match(/[a-z0-9+]{3,}/g) || []);
    const mine = words(m[3]);
    const hit = scoped.find((x) => x[1] === m[1] && x[3] === m[2] && [...words(x[4])].filter((w) => mine.has(w)).length >= 2);
    if (hit) { l.text = l.text.replace(new RegExp(`\\bone of ${m[1]} ${m[2]}\\b`), `one of ${m[1]} ${hit[2]} ${m[2]}`); l.facts = describe(l.text, l); }
  }
  return checkCounts(checkRanksAgree(checkRecordSaid(checkDates(notCalledActive(checkStreaks(dedupe(lines).map((l) => {
    const d = l.facts;
    const names = l.player ? [l.player, l.player.split(" ").slice(-1)[0]] : teamNames;
    l.facts = d;
    const race = d.type === "rank" || d.type === "race" || d.type === "streak" || d.type === "alltime" || d.type === "club" ? tableFor(l, T, names) : null;
    const stay = d.type === "club" && d.thresholds.length >= 2 && l.playerId ? stayInClub(d.thresholds, box, l.playerId) : null;
    const hook = hookFor(l, { race, stay });
    const f = { ...d.features, live: hook?.live ? 1 : 0 };
    const p = model ? score(f, model) : null;
    return { ...l, features: f, type: d.type, tag: d.tag, why: d.why, race: race || undefined, stay: stay || undefined, hook: hook || undefined, model: p == null ? undefined : Math.round(p * 1000) / 1000 };
  }), box)), box), box)));
}
// ---------- A game's date against the schedule (0.145.0) ----------
// The Wizards' notes, 11/24: "25 points … on 11/16 vs. HOU" and, two lines on, "25 points … on 11/15 vs. Houston". The
// game was 11/15. The text stays as printed (the user's rule, 11/16); the user wants every notes-vs-ESPN difference
// flagged, so the line says what the box scores have.
const TEAM_WORDS = Object.entries(TEAMS).flatMap(([tri, t]) => [[tri, tri], [tri, t.nick], ...(t.alt || []).map((a) => [tri, a]), ...(t.city === "LA" || t.city === "Los Angeles" ? [] : [[tri, t.city]])]);
const OPP_AT = new RegExp(`\\b(?:vs\\.?|versus|at|@|against)\\s+(?:the\\s+)?(${TEAM_WORDS.map(([, w]) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|")})\\b`, "g");
const triOf = (w) => [...new Set(TEAM_WORDS.filter(([, x]) => x === w).map(([t]) => t))];
// "…in 22 consecutive games against Memphis": a run, then within a few words "against" and a team
const RUN_VS = new RegExp(`\\b(?:consecutive|straight)\\s+(?:[\\w+-]+\\s+){0,4}?(?:against|versus|vs\\.?)\\s+(?:the\\s+)?(${TEAM_WORDS.map(([, w]) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|")})\\b`);
/** -> [{ said: "YYYY-MM-DD", opp }] for each date printed next to an opponent ("on 11/16 vs. HOU", "vs. BKN (11/8/26)"). */
const MON_N = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// 0.163.0: "On 11/23 in Phoenix, …" names the game by its city. Cities only (not "in Spurs history"), and never the
// team's own city: for the Suns, "in Phoenix" is a home game against somebody else.
const CITY_WORDS = Object.entries(TEAMS).filter(([, t]) => t.city && !/^(?:LA|Los Angeles)$/.test(t.city)).map(([tri, t]) => [tri, t.city]);
const IN_CITY = new RegExp(`\\bin\\s+(${CITY_WORDS.map(([, w]) => w).sort((x, y) => y.length - x.length).join("|")})\\b(?!\\s+(?:history|franchise|uniforms?|[A-Z]))`, "g");
// A date inside a list in parentheses ("…the third-highest paint-point total in the NBA this season (New Orleans: 80 points;
// Oct. 29 vs. Sacramento and Denver: 76 points; Nov. 4 vs. Toronto)") can be another team's game.
const inList = (t, at) => { const open = t.lastIndexOf("(", at), shut = t.lastIndexOf(")", at); if (open < 0 || shut > open) return false; const end = t.indexOf(")", at), inside = t.slice(open, end < 0 ? t.length : end); return /[;:]/.test(inside); };
export function datedGames(text, startYear, { own = null } = {}) {
  const t = plain(text), out = [];
  const opps = [...t.matchAll(OPP_AT)].map((m) => ({ at: m.index, end: m.index + m[0].length, tri: triOf(m[1]) })).filter((o) => o.tri.length === 1)
    .concat([...t.matchAll(IN_CITY)].map((m) => ({ at: m.index, end: m.index + m[0].length, tri: CITY_WORDS.filter(([, w]) => w === m[1]).map(([x]) => x) })).filter((o) => o.tri.length === 1 && o.tri[0] !== own));
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const mo = +m[1], d = +m[2];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const yr = mo >= 8 ? startYear : startYear + 1;
    if (m[3] && +m[3].slice(-2) !== yr % 100) continue;   // another season
    // the nearest opponent within a few words either side
    const near = opps.map((o) => ({ o, gap: o.at >= m.index ? o.at - (m.index + m[0].length) : m.index - o.end })).filter((x) => x.gap <= 12).sort((a, b) => a.gap - b.gap)[0];
    if (near) out.push({ said: `${yr}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`, opp: near.o.tri[0], listed: inList(t, m.index) });
  }
  // 0.159.0: a date written out ("in his first-career 20-point game versus Memphis (Nov. 24)", Charlotte's notes of 11/25;
  // the game was 11/23) is checked the same way.
  for (const m of t.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:[.,]?\s*((?:19|20)\d\d))?/gi)) {
    const mo = MON_N[m[1].slice(0, 3).toLowerCase()], d = +m[2];
    if (!mo || d < 1 || d > 31) continue;
    const yr = mo >= 8 ? startYear : startYear + 1;
    if (m[3] && +m[3] !== yr) continue;   // another season
    const near = opps.map((o) => ({ o, gap: o.at >= m.index ? o.at - (m.index + m[0].length) : m.index - o.end })).filter((x) => x.gap <= 12).sort((a, b) => a.gap - b.gap)[0];
    if (near) out.push({ said: `${yr}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`, opp: near.o.tri[0], listed: inList(t, m.index) });
  }
  return out;
}
/** Lines naming a game on a date the box scores don't have against that opponent, when the team did play them a few days off. Mutates. */
export function checkDates(lines, box) {
  const games = (box?.games || []).filter((g) => g.d && g.opp);
  if (!games.length) return lines;
  const startYear = Number([...games].sort((a, b) => (a.d < b.d ? -1 : 1))[0].d.slice(0, 4));
  const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`, days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
  for (const l of lines || []) {
    for (const { said, opp, listed } of datedGames(l.text, startYear, { own: box?.team || null })) {
      if (games.some((g) => g.d === said && g.opp === opp)) continue;
      const real = games.filter((g) => g.opp === opp && days(g.d, said) <= 3).sort((a, b) => days(a.d, said) - days(b.d, said))[0];
      if (!real) {
        // 0.163.0: the team played somebody else that day, and not this opponent within three days: the game is another
        // season's. San Antonio's notes of 11/25/26 still carried "On 11/23 in Phoenix, Julian Champagnie set a new career
        // high with 12 rebounds" from 2025-26 (on 11/23/26 the Spurs were in Sacramento; his high this season is 8).
        const that = games.find((g) => g.d === said);
        if (that && that.opp !== opp && !l.dateCheck && !listed) {
          const note = `Date check: on ${md(said)} this season the box scores have the ${TEAMS[that.opp]?.nick || that.opp}, not the ${TEAMS[opp]?.nick || opp}: this reads as an earlier season's game.`;
          l.dateCheck = { said, actual: null, opp, played: that.opp, otherSeason: true };
          l.hook = l.hook ? { ...l.hook, text: `${l.hook.text} ${note}` } : { text: note, live: false };
          break;
        }
        continue;
      }
      const note = `Date check: the box scores have the ${TEAMS[opp]?.nick || opp} game on ${md(real.d)}, not ${md(said)}.`;
      l.dateCheck = { said, actual: real.d, opp };
      l.hook = l.hook ? { ...l.hook, text: `${l.hook.text} ${note}` } : { text: note, live: false };
      break;
    }
  }
  return lines;
}

/**
 * 0.163.0: a team record said in passing that the results have moved past. Memphis's notes of 11/25/26: "Memphis moved to
 * 2-0 against Golden State this season and 12-4 overall, the team's best start since the 2014-15 season"; the Grizzlies
 * were 12-4 after 11/19 and are 13-5. The text stays as printed; the line says when that record was true and what it is
 * now, and that day is the line's date for the age rule. Only a record said as the whole season's ("12-4 overall",
 * "8-2 on the season") that the results show at exactly that many games, with games played since. Mutates.
 */
const REC_SAID = /\b(?:mov(?:ed|ing|es)|improv(?:ed|ing|es)|f(?:ell|alling|alls)|dropp?(?:ed|ing|s)|(?:ran|pushed|upped|evened) (?:its|their) record|(?:are|is) now)\b[^.;]{0,90}?(?<![\d-])(\d{1,2})-(\d{1,2})(?=\s+(?:overall|on the (?:season|year)|for the season)\b)/i;
/**
 * 0.170.0: one player's place in one stat, given two ways in the same notes ("Amongst all NBA centers, Sharpe currently
 * ranks seventh in APG (4.1)…" and "…a career-high 4.1 assists per game, which ranks 6th among NBA centers this season",
 * Brooklyn 11/27). Both lines stay as printed; each gets a note that the other says otherwise. Only when the two share
 * the group, the stat and the figure itself, so two different lists are never set against each other.
 */
const RANK_TAG = /^(?:T-)?(\d+)(?:st|nd|rd|th) (among [a-z]+|in NBA)$/;
const RANK_STATS = [["ast", /\bassists?\b|\bapg\b/i], ["reb", /\brebound|\brpg\b/i], ["pts", /\bpoints?\b|\bppg\b|\bscoring\b/i], ["stl", /\bsteals?\b|\bspg\b/i], ["blk", /\bblocks?\b|\bbpg\b/i],
  ["fg3", /\bthree|\b3-point|\b3pm\b|\b3fg/i], ["fg", /\bfield goal|\bfg%/i], ["ft", /\bfree throw|\bft%/i]];
export function checkRanksAgree(lines) {
  const seen = [];
  for (const l of lines || []) {
    const m = l.playerId && RANK_TAG.exec(l.tag || "");
    if (!m) continue;
    const t = plain(l.text), stats = RANK_STATS.filter(([, re]) => re.test(t)).map(([k]) => k);
    if (stats.length !== 1) continue;
    seen.push({ l, rank: +m[1], key: `${l.playerId}|${m[2]}|${stats[0]}`, figures: new Set(t.match(/\b\d{1,3}\.\d\b/g) || []) });
  }
  for (const a of seen) {
    const b = seen.find((x) => x !== a && x.key === a.key && x.rank !== a.rank && [...x.figures].some((f) => a.figures.has(f)));
    if (!b) continue;
    const note = `Rank check: another line in these notes has this at ${ordinal(b.rank)}, not ${ordinal(a.rank)}.`;
    a.l.rankCheck = { said: a.rank, other: b.rank };
    a.l.hook = a.l.hook ? { ...a.l.hook, text: `${a.l.hook.text} ${note}` } : { text: note, live: false };
  }
  return lines;
}

export function checkRecordSaid(lines, box) {
  const games = (box?.games || []).filter((g) => g.d && g.pf != null && g.pa != null).sort((a, b) => (a.d < b.d ? -1 : 1));
  if (!games.length) return lines;
  const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`, nick = TEAMS[box.team]?.nick || box.team || "team";
  const rec = (n) => { const w = games.slice(0, n).filter((g) => g.pf > g.pa).length; return [w, n - w]; };
  const [cw, cl] = rec(games.length);
  for (const l of lines || []) {
    const m = REC_SAID.exec(plain(l.text));
    if (!m) continue;
    const W = +m[1], L = +m[2], n = W + L;
    if (n < 1 || n >= games.length) continue;
    const [w, lo] = rec(n);
    if (w !== W || lo !== L) continue;
    const note = `Record check: the ${nick} were ${W}-${L} after ${md(games[n - 1].d)}; they are ${cw}-${cl} now.`;
    l.recordCheck = { said: `${W}-${L}`, asOf: games[n - 1].d, now: `${cw}-${cl}` };
    l.hook = l.hook ? { ...l.hook, text: `${l.hook.text} ${note}` } : { text: note, live: false };
  }
  return lines;
}

/**
 * 0.113: "Active streak" is said only of a count the box scores or the results agree with tonight. Every other
 * streak line keeps its number and is marked as the notes' own: "Streak · 176 (notes)".
 */
function notCalledActive(lines) {
  for (const l of lines) {
    if (l.type !== "streak" || !/^Active streak/.test(l.tag || "")) continue;
    const ok = (l.streakNow && l.streakNow.now === l.streakNow.said) || (l.teamStreakNow && l.teamStreakNow.now === l.teamStreakNow.said);
    if (!ok) l.tag = `${l.tag.replace(/^Active streak/, "Streak")} (notes)`;
  }
  return lines;
}

// ---------- A streak the notes count, against the box scores (0.76) ----------
// The user, 11/16: the Knicks' notes carried "his eighth consecutive double-double to start the season" and "a
// double-double in nine straight games to start the season" on a night Towns' streak stood at 12. Recaps of older
// games stay in the notes; the box scores know the count as of tonight.
const COUNT = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20 };
const CNT = `(\\d{1,3}(?:st|nd|rd|th)?|${Object.keys(COUNT).join("|")})`;
const countOf = (w) => COUNT[w.toLowerCase()] ?? (parseInt(w, 10) || null);
const RUN = "(?:consecutive|straight)";
const SPAN = `(?:each of )?(?:his |her |the )?(?:first |last |past )?${CNT} ${RUN} (?:games|contests|outings)`;
const STREAK_STAT = "(points?|rebounds?|assists?|steals?|blocks?|three-pointers|3-pointers|threes)";
const DOUBLES = [["dd", "double-doubles?", 2], ["td", "triple-doubles?", 3]];
// 0.145.0: "made three three-pointers for the third straight game", "recorded a double-double for the fifth consecutive
// game", "grabbed 10 rebounds in his fourth straight game", "… for the fourth game in a row".
const DID = "(?:made|hit|knocked down|drained|scored|recorded|posted|had|grabbed|pulled down|dished out|dished|handed out|tallied|logged|notched|registered|collected)";
const NTH_GAME = new RegExp(`\\b${DID}\\s+(?:at least\\s+|an?\\s+)?${CNT}?(?:\\+|-plus| or more)?\\s*(${STREAK_STAT.slice(1, -1)}|double-doubles?|triple-doubles?)\\s+(?:for|in)\\s+(?:the|a|his|her)\\s+${CNT}\\s+(?:${RUN}\\s+(?:game|contest|outing)|(?:game|contest|outing) in a row)\\b`, "i");
// A date, a weekday or "last night" in the line: it is about that night.
const DATED = /\b\d{1,2}\/\d{1,2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.? \d{1,2}\b|\b(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b|\blast night\b/i;

// ---------- A games-played run the notes count, against ours (0.146.0) ----------
// The user, 11/24: the notes' own games-played lines should be held to the same count as the rest of the site ("using a
// selfcheck is one way to assure consistency"). Our count: src/records/featboards.js gamesPlayedRuns (0.142.6), every
// active run, in featlive.json's gpRuns as the last build left it (through last night, as the notes are).
const PLAYED = "(?:has|have)\\s+(?:now\\s+|also\\s+)?(?:played|appeared)\\s+in";   // present: "played in 179 … to start his career" (WAS, Carrington) is a closed run
const GP_SAID = [
  new RegExp(`\\b${PLAYED}\\s+(?:each of\\s+)?(?:his|the|a|an)?\\s*(?:last|past|first)?\\s*${CNT}\\s+${RUN}\\s+(?:regular[- ]season\\s+)?(?:games|contests)`, "i"),
  new RegExp(`\\b${CNT}\\s+${RUN}\\s+(?:regular[- ]season\\s+)?games\\s+played\\b`, "i"),
  new RegExp(`\\b${CNT}[- ]game\\s+(?:games[- ]played|iron[- ]?man|consecutive[- ]games(?:[- ]played)?)\\s+streak`, "i"),
];
/** The games-played run a line states as current: -> n, or null (a run that ended, or another season's, is history). */
export function statedPlayedRun(text) {
  const t = plain(text);
  if (/\b(?:snapped|ended|came to an end|was halted|last season|in 20(?:0\d|1\d|2[0-5])-\d\d)\b/i.test(t)) return null;
  if (/\b(?:first|last|past)\s+\S+\s+(?:consecutive|straight)\b/i.test(t) && !/\b(?:played|appeared)\s+in\s+(?:each of\s+)?(?:his|the)\s+(?:last|past)\b/i.test(t)) return null;
  for (const re of GP_SAID) { const m = t.match(re); const n = m && countOf(m[1]); if (n >= 2) return n; }
  return null;
}
/** Lines whose games-played run differs from ours get a hook saying so; the line keeps the notes' words. runs: [[id, n, last]]. */
export function checkGamesPlayed(lines, runs) {
  if (!Array.isArray(runs) || !runs.length) return lines;
  const R = new Map(runs.map(([id, n, last]) => [String(id), { n, last }]));
  const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  for (const l of lines || []) {
    if (!l.playerId || l.guessed) continue;
    const said = statedPlayedRun(l.text);
    if (!said) continue;
    const r = R.get(String(l.playerId));
    const now = r ? r.n : 0;
    l.gpCheck = { said, now, last: r?.last || null };
    if (now === said) continue;
    const note = r ? `Games check: our box scores count ${now} straight games played through ${md(r.last)}, not ${said}.` : `Games check: our box scores have no current run of games played for him (the notes say ${said}).`;
    l.hook = l.hook ? { ...l.hook, text: `${l.hook.text} ${note}` } : { text: note, live: false };
  }
  return lines;
}

/**
 * The streak a line counts, when it is one the box scores can count too: a double-double or triple-double streak,
 * or "N straight games with X+ points". -> { n, key, test(row, k) } or null. Only present-tense lines: a streak
 * that "ended" or "snapped", or one from another season, is history and is left as written.
 */
export function statedStreak(text) {
  const t = plain(text);
  if (/\b(?:snapped|ended|came to an end|was halted|last season|in 20(?:0\d|1\d|2[0-5])-\d\d)\b/i.test(t)) return null;
  // 0.145.0: "Made three three-pointers for the third straight game, tying the longest streak of his career." (WAS notes,
  // 11/24): no "has", no date, so it read as nothing to check and sat at #4 in the briefing a week after the run had
  // ended. A line with no date that says what he did "for the Nth straight game" is a claim about now. A dated one
  // ("… for the second game in a row on 11/20 at Chicago") is a recap of that night and is left as written.
  if (!DATED.test(t)) {
    const m = t.match(NTH_GAME);
    if (m) {
      const n = countOf(m[3]), word = m[2].toLowerCase();
      const dbl = DOUBLES.find(([, w]) => new RegExp(`^${w}$`, "i").test(word));
      if (n >= 2 && dbl) return { n, key: dbl[0], label: dbl[0] === "dd" ? "double-doubles" : "triple-doubles", test: (row, k) => ["pts", "reb", "ast", "stl", "blk"].filter((x) => row[k[x]] >= 10).length >= dbl[2] };
      const min = m[1] ? countOf(m[1]) : null;
      const stat = !dbl && statKey(/^3|three/i.test(word) ? "threes" : word.replace(/s$/, "") + "s");
      if (n >= 2 && min && stat) return { n, key: `${stat}${min}`, label: `games with ${min}+ ${WORD[stat]}`, test: (row, k) => row[k[stat]] >= min };
    }
  }
  if (!/\bto (?:start|open|begin) (?:the|this|his|a) (?:season|campaign|year)\b|\b(?:has|have) (?:now |also )?(?:recorded|posted|scored|registered|tallied|had|notched|logged|grabbed|made|hit|dished|knocked down|drained|connected on|converted|pulled down|handed out)\b|\bactive\b|\bthis season\b|\bcurrent\b|\b(?:recorded|posted|notched|registered|logged|tallied) (?:his|her)\b|\bextend(?:ed|s|ing)?\b|\bin (?:each of )?(?:his|the) (?:last|past)\b/i.test(t)) return null;
  for (const [key, word, need] of DOUBLES) {
    if (key === "dd" && /triple-double/i.test(t)) continue;
    const m = t.match(new RegExp(`\\b${CNT} ${RUN} (?:games? with (?:an? )?)?${word}`, "i")) || t.match(new RegExp(`\\b${word} in ${SPAN}`, "i"))
      || t.match(new RegExp(`\\b${CNT}-game ${word.replace("s?", "")} streak`, "i"))
      // 0.170.0: "recorded his 16th double-double to start the season" (the Knicks, 11/27, beside "a double-double in nine
      // straight games to start the season" on a night the run stood at 17): an ordinal, so it is the run's length
      || t.match(new RegExp(`\\b(?:his|her) (\\d{1,3}(?:st|nd|rd|th)|${Object.keys(COUNT).filter((w) => /(?:st|nd|rd|th)$/.test(w)).join("|")}) ${word} to (?:start|open|begin) (?:the|this|his|her) (?:season|campaign|year)\\b`, "i"));
    const n = m && countOf(m[1]);
    if (n) return { n, key, label: key === "dd" ? "double-doubles" : "triple-doubles", test: (row, k) => ["pts", "reb", "ast", "stl", "blk"].filter((x) => row[k[x]] >= 10).length >= need };
  }
  // 0.113: "both a block and a steal in 10 straight games"
  const bs = t.match(new RegExp(`\\b(?:both )?(?:a|at least one) (?:block|steal) and (?:a|at least one|one) (?:steal|block) in ${SPAN}`, "i"));
  if (bs && countOf(bs[1])) return { n: countOf(bs[1]), key: "blkstl", label: "games with a block and a steal", test: (row, k) => row[k.stl] >= 1 && row[k.blk] >= 1 };
  // 0.170.0: "at least one triple in 17 straight games" (Atlanta, 11/27): a made three every game, said without a number
  const one3 = t.match(new RegExp(`\\b(?:at least (?:one|1|a)|a|one) (?:made )?(?:three-pointer|3-pointer|three|triple|trey|(?:3|three)-point field goal)s? in ${SPAN}`, "i"));
  if (one3 && countOf(one3[1])) return { n: countOf(one3[1]), key: "fg3m1", label: "games with a made three", test: (row, k) => row[k.fg3m] >= 1 };
  // 0.176.0: "Has knocked down consecutive triples in eight straight games" (Phoenix, 11/27, of Collin Gillespie, two
  // days after an 0-for-4): more than one made three every game. It read as nothing to check, so it carried no tag and
  // the user could not tell a checked line from a copied one. "Multiple", "two or more" and "2+" say the same.
  const many3 = t.match(new RegExp(`\\b(?:multiple|consecutive|back-to-back|two or more|two-plus|at least two|2\\+|2 or more) (?:made )?(?:three-pointers|3-pointers|threes|triples|treys|(?:3|three)-point field goals|3s) in ${SPAN}`, "i"));
  if (many3 && countOf(many3[1])) return { n: countOf(many3[1]), key: "fg3m2", label: "games with 2+ made threes", test: (row, k) => row[k.fg3m] >= 2 };
  // "30+ points in five straight games", "five straight games with at least 30 points", "five straight 30-point games"
  let m = t.match(new RegExp(`\\b(\\d{1,2})(?:\\+|-plus| or more) ${STREAK_STAT} in ${SPAN}`, "i"));
  let min = m && +m[1], word = m && m[2], n = m && countOf(m[3]);
  if (!m && (m = t.match(new RegExp(`\\b${CNT} ${RUN} (?:games|contests|outings) (?:with|scoring|of|recording) (?:at least )?(\\d{1,2})(\\+|-plus| or more)? ${STREAK_STAT}`, "i"))) && (m[3] || /at least/i.test(m[0]))) { n = countOf(m[1]); min = +m[2]; word = m[4]; }
  if (!n && (m = t.match(new RegExp(`\\b${CNT} ${RUN} (\\d{1,2})-(point|rebound|assist) games`, "i")))) { n = countOf(m[1]); min = +m[2]; word = m[3]; }
  // 0.159.0: "extending his 10+ point streak to all 14 games to start the season" (Minnesota, 11/23, by then 18)
  if (!n && (m = t.match(new RegExp(`\\b(\\d{1,2})(?:\\+|-plus)[- ](point|rebound|assist|steal|block)s? streak to (?:all )?${CNT} (?:${RUN} )?(?:games|contests)`, "i")))) { min = +m[1]; word = m[2]; n = countOf(m[3]); }
  const stat = word && statKey(/^3|three/i.test(word) ? "threes" : word.replace(/s$/, "") + "s");
  if (!n || !min || !stat) return null;
  return { n, key: `${stat}${min}`, label: `games with ${min}+ ${WORD[stat]}`, test: (row, k) => row[k[stat]] >= min };
}

/** How long that streak is in the box scores, counted back from the player's last game. -> { now, last, all } */
export function streakInBox(box, playerId, stated) {
  if (!box || !playerId || !stated) return null;
  const k = Object.fromEntries((box.keys || []).map((x, i) => [x, i]));
  const played = (box.games || []).filter((g) => g.pl?.[playerId]?.[k.min] > 0 || (g.z || []).includes(String(playerId))).sort((a, b) => (a.d < b.d ? -1 : 1));   // 0.145.0: z
  if (!played.length) return null;
  let now = 0;
  for (let i = played.length - 1; i >= 0 && stated.test(played[i].pl[playerId], k); i--) now++;
  return { now, last: played[played.length - 1].d, all: now === played.length };
}

/**
 * Lines whose streak the box scores count higher get a hook saying so; the line keeps the notes' words.
 * Mutates and returns the lines. Each checked line carries streakNow: { key, said, now }.
 */
/**
 * 0.176.0: a player's count of games that the reader set against his box scores and found different (l.countCheck, from
 * src/notes/narrative.js). The line says "this season" and the box scores have fewer, or the notes are a game behind.
 */
export function checkCounts(lines) {
  for (const l of lines || []) {
    const c = l.countCheck;
    if (!c || l.hook) continue;
    const what = c.what.replace(/^games with /, "games with ").replace(/(\d+)\+ (\w+)$/, (m, n, st) => `${n}+ ${({ pts: "points", reb: "rebounds", ast: "assists", stl: "steals", blk: "blocks", fg3m: "threes", oreb: "offensive rebounds" })[st] || st}`);
    if (c.said > c.have) { l.tag = "Count check"; l.hook = { text: `Count check: the notes say ${c.said} ${what}; the box scores have ${c.have} this season.`, live: false }; }
    else l.hook = { text: `The notes are behind: the box scores have ${c.have} ${what} this season, not ${c.said}.`, live: false };
  }
  return lines;
}
export function checkStreaks(lines, box) {
  const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  for (const l of lines || []) {
    if (!l.playerId) { checkTeamStreak(l, box); continue; }
    const st = statedStreak(l.text);
    const at = st && streakInBox(box, String(l.playerId), st);
    if (!at) continue;
    l.streakNow = { key: st.key, said: st.n, now: at.now };
    // 0.113: the box scores have it SHORTER than the notes: the streak is over (or the line is a recap of an older
    // night). It was left reading "Active streak" with "N+1 if he does it again tonight".
    if (at.now < st.n) {
      l.tag = "Streak over";
      // not "stale": what the line says happened did happen; it is the "active" that is wrong
      l.hook = { text: `Not active: the notes say ${st.n} straight ${st.label.replace(/^games with /, "with ")}; the box scores have ${at.now} through ${md(at.last)}.`, live: false };
      continue;
    }
    if (at.now === st.n) continue;
    const ranked = /\b(?:ranks?|tied|tying|longest|most|history|record)\b/i.test(plain(l.text));
    l.tag = `Now ${at.now} straight`;
    l.hook = { text: `The notes are behind: the box scores have it at ${at.now} straight ${st.label.replace(/^games with /, "with ")} through ${md(at.last)}${at.all ? " (every game he has played this season)" : ""}${ranked ? ", so where this line ranks it is out of date" : ""}. ${at.now + 1} if he does it again tonight.`, live: true };
  }
  return lines;
}

// ---------- A team's winning or losing streak, against its results (0.113) ----------
// The user, 11/19, of "As of Nov. 13, San Antonio has won 11 straight games" tagged "Active streak · 11 → 12 with
// tonight's game" on a morning when the Spurs had won a 12th and then lost: "this nugget was misinterpreted. it was
// taken as factual without fact checking". A streak of wins or losses is the easiest thing in the notes to check.
const TEAM_RUN = [
  ["W", new RegExp(`\\b(?:has|have|had|having) (?:now )?won ${CNT} ${RUN}\\b`, "i")], ["W", new RegExp(`\\bwon ${CNT} in a row\\b`, "i")], ["W", new RegExp(`\\b${CNT}-game win(?:ning)? streak\\b`, "i")],
  ["L", new RegExp(`\\b(?:has|have|had|having) (?:now )?(?:lost|dropped) ${CNT} ${RUN}\\b`, "i")], ["L", new RegExp(`\\b(?:lost|dropped) ${CNT} in a row\\b`, "i")], ["L", new RegExp(`\\b${CNT}-game losing streak\\b`, "i")]];
// A streak over some of the games only (home games, against one team, in overtime) is not the plain run of results.
const SOME_GAMES = /\b(?:home|road|away|on the road|against|versus|vs\.?|overtime|division(?:al)?|conference|series|meetings?|matchups?|head-to-head|openers?|back-to-backs?|when|in (?:January|February|March|April|October|November|December)|on (?:Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)days?)\b/i;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, oct: 10, nov: 11, dec: 12 };
/** -> { kind: "W"|"L", n, plain, asOf: "MM-DD"|null } for a present-tense line about the team's own run, else null. */
export function statedTeamStreak(text) {
  const t = plain(text);
  if (/\b(?:snapped|ended|came to an end|was halted|last season|in 20(?:0\d|1\d|2[0-5])-\d\d)\b|\bfrom (?:\w+\.? \d{1,2}|\d{1,2}\/\d{1,2})[^.]{0,30}\b(?:to|through|until)\b/i.test(t)) return null;
  for (const [kind, re] of TEAM_RUN) {
    const m = t.match(re), n = m && countOf(m[1]);
    if (!n) continue;
    const sentence = t.split(/(?<=[.!?])\s+/).find((x) => x.includes(m[0])) || t;
    const a = t.match(/\bas of (Jan|Feb|Mar|Apr|May|Jun|Oct|Nov|Dec)[a-z]*\.? (\d{1,2})\b/i);
    return { kind, n, plain: !SOME_GAMES.test(sentence), asOf: a ? `${String(MONTHS[a[1].toLowerCase()]).padStart(2, "0")}-${a[2].padStart(2, "0")}` : null };
  }
  return null;
}
/** The team's runs of wins and losses, oldest first, from its results (box.games: d, opp, pf, pa). */
export function teamRuns(box) {
  const gs = (box?.games || []).filter((g) => g.pf != null && g.pa != null && g.pf !== g.pa).sort((a, b) => (a.d < b.d ? -1 : 1)), runs = [];
  for (const g of gs) { const k = g.pf > g.pa ? "W" : "L", r = runs[runs.length - 1]; if (r && r.kind === k) { r.n++; r.to = g.d; } else runs.push({ kind: k, n: 1, from: g.d, to: g.d, after: null }); if (runs.length > 1 && runs[runs.length - 1].n === 1) runs[runs.length - 2].after = g; }
  return runs;
}
function checkTeamStreak(l, box) {
  if (l.player || l.type !== "streak") return;
  const st = statedTeamStreak(l.text), runs = st && teamRuns(box);
  const notes = () => { if (/^Active streak/.test(l.tag || "")) l.tag = `${l.tag.replace(/^Active streak/, "Streak")} (notes)`; };   // not checked: not called active
  if (!st || !runs.length) { if (l.hook?.unchecked) notes(); return; }
  const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`, word = st.kind === "W" ? "won" : "lost", cur = runs[runs.length - 1];
  const played = (box.games || []).filter((g) => g.pf != null && g.pa != null).sort((a, b) => (a.d < b.d ? -1 : 1)), lastD = played[played.length - 1].d;
  if (!st.plain) {
    // some of the games only: the count cannot be set against the plain run, but its own date can be
    const since = st.asOf ? played.filter((g) => g.d.slice(5) > st.asOf).length : 0;
    l.tag = `Streak · ${st.n} (notes)`;
    l.hook = { text: `The notes' count, not checked${since ? `: it is dated ${+st.asOf.slice(0, 2)}/${+st.asOf.slice(3)} and the team has played ${since} game${since === 1 ? "" : "s"} since` : ""}.`, live: false, unchecked: true };
    return;
  }
  l.teamStreakNow = { kind: st.kind, said: st.n, now: cur.kind === st.kind ? cur.n : 0 };
  const next = (n) => `${n + 1} with a ${st.kind === "W" ? "win" : "loss"} tonight.`;
  if (cur.kind === st.kind && cur.n === st.n) { l.tag = `Active streak · ${st.n}`; l.hook = { text: `Checked against the results (through ${md(lastD)}). ${next(st.n)}`, live: true }; return; }
  if (cur.kind === st.kind && cur.n > st.n) { l.tag = `Now ${cur.n} straight`; l.hook = { text: `The notes are behind: the results have it at ${cur.n} straight through ${md(lastD)}. ${next(cur.n)}`, live: true }; return; }
  // over, or never as the notes say: the last run of that kind at least as long as the notes' count, and what ended it
  const was = [...runs].reverse().find((r) => r !== cur && r.kind === st.kind && r.n >= st.n) || (cur.kind === st.kind ? null : [...runs].reverse().find((r) => r.kind === st.kind && r.n >= st.n));
  const now = `the team has ${cur.kind === "W" ? "won" : "lost"} ${cur.n === 1 ? "its last game" : `${cur.n} straight`}`;
  l.tag = "Streak over";
  l.hook = was && was.after
    ? { text: `No longer true: the streak ended at ${was.n} on ${md(was.after.d)} (${was.after.pf > was.after.pa ? "beat" : "lost to"} ${was.after.opp} ${was.after.pf}-${was.after.pa})${was.after.d === lastD ? "" : `; ${now}`}.`, live: false, stale: true }
    : { text: `Does not match the results: the notes say ${word} ${st.n} straight; ${now} through ${md(lastD)}.`, live: false, stale: true };
}

/**
 * 0.113: a streak count the box scores cannot check, printed unchanged while games went by. A live count moves with
 * every game, so the same words after another game are out of date: the streak is longer now, or over. Not for a
 * streak over some of the games only (home games, one opponent), whose count can rightly stand still.
 * firstSeen: the day these exact words were first read (the notes for that day's game). Mutates and returns the line.
 */
export function staleCount(l, firstSeen, box) {
  if (!l || l.type !== "streak" || !firstSeen || !box || l.hook?.stale || l.streakNow || l.teamStreakNow || !/^(?:Active streak|Streak\b.*\(notes\)$)/.test(l.tag || "")) return l;
  const t = plain(l.text);
  if (SOME_GAMES.test(t)) return l;
  const k = Object.fromEntries((box.keys || []).map((x, i) => [x, i]));
  const since = (box.games || []).filter((g) => g.d >= firstSeen && (l.playerId ? g.pl?.[String(l.playerId)]?.[k.min] > 0 || (g.z || []).includes(String(l.playerId)) : g.pf != null)).length;
  if (!since) return l;
  const who = l.playerId ? "he has" : "the team has", n = (l.tag.match(/\d+/) || [])[0];
  l.tag = n ? `Streak · ${n} (old count)` : "Streak (old count)";
  l.hook = { text: `Out of date: the notes have printed this count unchanged since ${+firstSeen.slice(5, 7)}/${+firstSeen.slice(8, 10)} and ${who} played ${since} game${since === 1 ? "" : "s"} since. It is longer now, or over.`, live: false, stale: true };
  return l;
}

/** Which list a rank line is about, coarsely: enough to tell a scoring list from an assists list. */
export function listStat(text) {
  const t = plain(text).toLowerCase();
  // A list with a condition on it ("30+ point games", "among one-franchise players", "by a center") is its own list.
  if (/\d\+|-plus\b|\bgames? with\b|-point games\b|\bquarters?\b|\bhal(?:f|ves)\b|\bamongs?t?\b(?! all)|\bby an? \w+|\bbefore turning\b|\bundrafted\b|\brookies?\b|\bbench\b|\bplayoffs?\b|\bpostseason\b|\bactive\b|\bsingle[- ]game\b|\bin a game\b|\bstreaks?\b|\bstraight\b|\bconsecutive\b/.test(t)) return `own:${t.slice(0, 40)}`;
  // Only a line about holding or taking a place: "passed…", "moved into…", "now ranks…".
  if (!/\bpass(?:ed|es|ing)?\b|\bsurpass|\bmov(?:ed|es|ing) (?:into|past|up|ahead)\b|\bclimb|\bovert(?:ook|ake)|\branks?\b|\bsits\b|\bis now\b/.test(t)) return `own:${t.slice(0, 40)}`;
  for (const [k, re] of [["td", /triple-double/], ["dd", /double-double/], ["fg3", /three|3-point|3fg|3pm|triples/], ["reb", /rebound/], ["ast", /assist/], ["stl", /steal/], ["blk", /block/], ["gp", /games played/], ["pts", /scor|points/]]) if (re.test(t)) return k;
  return "other";
}

// ---------- What to trim (0.49, from the user's review of the 11/13 slate) ----------
// The user's rule: keep what can still move — a streak, a club, a race, a count that grows, a rank this season, the
// series — and what is rare over a long span ("the most FTA in a regulation game since Dec. 12, 2014"). Trim what is a
// closed, past one-off (a season-opener total, a "first two games" fact, a pass made weeks ago, a trip to Mexico City)
// once the team has moved on, plus filler, a stat about the other venue, and lines garbled by the page layout.
// Not too strict: a team with few lines left gets its best trimmed ones back (up to 4 shown), and every trimmed line
// is listed on the page with its reason.
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const OPENER = /\b(?:season[- ]opener|season opener|opening night|opener)\b/i;
const DEBUT = /\b(?:NBA|career|team|Bulls|[A-Z][a-z]+) debut\b/;
const FIXED_WINDOW = /\b(?:first|opening) (?:two|three|four|five|six|seven|eight|nine|ten|\d{1,2}) (?:career )?games\b|\beach of the first (?:two|three|four|five|six|\d) games\b/i;
const OPEN = /\b(?:active streak|consecutive|straight|in a row|has now|now has|now ranks|is now|career-best|this season|is averaging|averaging|leads? (?:the|all)|ranks? \w+ in the (?:NBA|league)|needs?|within|away from(?!\s+(?:the\s+)?(?:game|court|action|basketball|home))|on pace|on track|has recorded|has registered|has posted|has made|has scored|has appeared|has played|games? with)\b/i;

/** The latest date a line is about, ignoring a "since …" span and dates from other seasons ("most: 64 vs. PHI, 10/10/72"). */
export function eventDate(text, { today, firstGame = null } = {}) {
  const t = plain(text).replace(/\bsince\s+(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+)?(?:19|20)\d\d(?:-\d\d)?/gi, "");
  const y = Number(today.slice(0, 4)), m0 = Number(today.slice(5, 7));
  const iso = (mo, d) => { const yr = mo > m0 + 1 ? y - 1 : y; return `${yr}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
  const out = [];
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    if (m[3] && !(Number(m[3].slice(-2)) === y % 100 || Number(m[3].slice(-2)) === (y - 1) % 100)) continue;
    if (Number(m[1]) <= 12 && Number(m[2]) <= 31) out.push(iso(Number(m[1]), Number(m[2])));
  }
  for (const m of t.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:[.,]?\s*((?:19|20)\d\d))?/gi)) {   // 0.160.0: "Nov. 9. 2022"
    if (m[3] && !(Number(m[3]) === y || Number(m[3]) === y - 1)) continue; // another season's date
    out.push(iso(MON[m[1].toLowerCase()], Number(m[2])));
  }
  if (firstGame && (OPENER.test(t) || FIXED_WINDOW.test(t))) out.push(firstGame);
  const ok = out.filter((d) => d <= today).sort();
  return ok.length ? ok[ok.length - 1] : null;
}

/** Rare over a long span: "since 2014", "since 1985-86", "first time in 12 years". */
export function longSpan(text, today) {
  const y = Number(today.slice(0, 4));
  const m = plain(text).match(/\bsince\s+(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+)?((?:19|20)\d\d)/i);
  if (m && y - Number(m[1]) >= 10) return true;
  const n = plain(text).match(/\b(?:in|over|more than|first time in)\s+(?:over\s+)?(\d{2,3})\s+years\b/i);
  return !!(n && Number(n[1]) >= 10);
}

/**
 * Why a line should be trimmed tonight, or null to keep it.
 *   { box, today, home: true|false|null (tonight's venue for this team) }
 */
/**
 * 0.78: a season total the box scores say this season can't hold yet ("Shot a career-high .671 (403-601 FG) from the
 * floor" in mid-November; "at least one steal in a career-high 42 games" after 14 games; the user, 11/16). Both were
 * last season's bullets under a header the reader didn't know. Returns the reason, or null.
 * Career totals and spans ("in his career", "since 2023-24", "all-time") are left alone.
 */
export function cantBeThisSeason(text, { box = null, playerId = null } = {}) {
  if (!box || !(box.games || []).length) return null;
  const t = plain(text);
  if (/\b(?:in|of|for|over) (?:his|her|their) career\b|\bcareer (?:totals?|games|starts|points|rebounds|assists)\b|\ball-time\b|\bsince\b|\b(?:last|past|previous) (?:\w+ )?(?:seasons?|years?)\b|\bhistory\b|\blast season\b/i.test(t)) return null;
  const k = Object.fromEntries((box.keys || []).map((x, i) => [x, i]));
  const gp = box.games.length;
  const m = t.match(/\bcareer[- ](?:high|best) (\d{2,3}) (?:games|times|contests|starts)\b|\b(\d{2,3}) (?:games|times|contests|starts),? (?:a|his|which (?:is|was) a) career[- ](?:high|best)\b|\ba career[- ](?:high|best) (\d{2,3}) times\b/i);
  if (m) { const n = +(m[1] || m[2] || m[3]); if (n > gp) return `last season's count (${n} games; the team has played ${gp})`; }
  if (playerId) {
    const sum = (key) => box.games.reduce((a, g) => a + (g.pl?.[playerId]?.[k[key]] || 0), 0);
    for (const sh of t.matchAll(/\((\d{2,4})-(?:of-)?(\d{2,4})\s*(FGs?|3FGs?|3PT|3-PT|FTs?)\)/g)) {
      const att = +sh[2], key = /^3/.test(sh[3]) ? "fg3a" : /^FT/.test(sh[3]) ? "fta" : "fga";
      const have = sum(key);
      if (+sh[1] <= att && att >= 40 && att > have * 1.05) return `last season's total (${sh[1]}-${att}; he has ${have} ${key === "fga" ? "field goal attempts" : key === "fta" ? "free throw attempts" : "three-point attempts"} this season)`;
    }
  }
  return null;
}

/**
 * 0.157.0 (the user, 11/25, on "Recorded multiple blocks in consecutive games (Nov. 2 and Nov. 4) for the first time in
 * his career" shown three weeks later: "there has to be a balance in time from note from game notes and how important it
 * is"): how many days a dated happening that is over keeps a place, by how big the claim is.
 *   - a first, an only or a record in NBA history: SHELF.nba days
 *   - the same in a team's history: SHELF.team days
 *   - everything else (a recap, a career or season high, a pass on a list): the rule since 0.49, two games or a week
 * A pass on a list ("passed Julius Erving for the 79th most points in NBA history") is a recap: the place he holds now
 * is the line (the user, 11/16). A player averaging SHELF.starPpg or more gets half as long again on the first two.
 * The lengths agree with what the user cut on 11/13: an NBA-history first at 23 days, a team-history first at 11.
 */
export const SHELF = { nba: 14, team: 10, recap: 7, grace: 2, star: 1.5, starPpg: 20, penalty: 2.5, standing: 14 };
// 0.160.0: the dates in a line that are its own, not a comparison's: "(other: Leonard Miller - 19 points at MIL, 10/23)",
// "the other time coming from Feb. 26 to March 6", "(since 11/13)", "for the first time since 11/2" say when something
// else happened, or where a span starts.
export const ownDates = (text) => plain(text)
  .replace(/\((?:others?|previous(?:ly)?|prev\.?|last|most|record|high|career[- ]high|season[- ]high|franchise record|the other)\b[^)]*\)/gi, " ")
  .replace(/\bthe other (?:times?|instances?|occasions?)\b[^;]*/gi, " ")   // to the end: "Feb." would stop a sentence match
  .replace(/\bsince (?:the )?(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/gi, " ");
const LIST_PASS = /\b(?:pass(?:ed|ing|es)|surpass\w*|moved (?:past|into|up)|eclips\w*|overt(?:ook|ak\w*)|entered the top|climbed)\b/i;
const FIRST_OR_RECORD = /\b(?:first|only|youngest|oldest|fastest|records?)\b|\b(?:second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)) (?:\w+ ){0,2}(?:players?|rookies?|guards?|forwards?|centers?|teams?|duos?|trios?|pairs?|reserves?|teammates|teenagers?|starters?)\b/i;
export function shelfLife(text, { star = false } = {}) {
  const t = plain(text);
  const big = FIRST_OR_RECORD.test(t) && !LIST_PASS.test(t);
  // a team's own history first ("in Bulls history", "the franchise record"), then the league's
  const teamScope = /\b(?:franchise|team|club)(?:['’]s)? (?:history|record|all-time)\b|\b[A-Z][A-Za-z]+(?:['’]s|s['’]) all-time\b|\bin (?!NBA\b)[A-Z][A-Za-z]+ history\b/.test(t);
  const nbaScope = !teamScope && /\b(?:NBA|league) history\b|\ball-time\b|\bNBA record\b/i.test(t);
  const [days, why] = big && nbaScope ? [SHELF.nba, "an NBA-history first"] : big && teamScope ? [SHELF.team, "a team-history first"] : [SHELF.recap, "a recap"];
  return { days: Math.round(days * (star && why !== "a recap" ? SHELF.star : 1)), why, recap: why === "a recap" };
}
const isStar = (box, playerId) => {
  if (!box || !playerId) return false;
  const k = Object.fromEntries((box.keys || []).map((x, i) => [x, i]));
  const rows = (box.games || []).map((g) => g.pl?.[String(playerId)]).filter((r) => r && r[k.min] > 0);
  return rows.length >= 5 && rows.reduce((a, r) => a + (r[k.pts] || 0), 0) / rows.length >= SHELF.starPpg;
};
// a run told in the past tense: "Recorded multiple blocks in consecutive games (Nov. 2 and Nov. 4)…"
const RUN_ANY = /\b(?:consecutive|straight|in a row)\b/i;
const PAST_VERBS = "recorded|tallied|posted|had|scored|notched|registered|made|grabbed|dished|blocked|finished|totaled|became|earned|reached|shot|hit|collected|handed out|pulled down|knocked down|logged|compiled|produced|put up|went";
const PAST_LEAD = new RegExp(`^(?:[A-Z][\\w.'’-]+ ){0,3}(?:${PAST_VERBS})\\b`, "i"), PAST_ANY = new RegExp(`\\b(?:${PAST_VERBS})\\b`, "i");
// words that say it is still going
const PRESENT = /\b(?:has|(?<!to )have|is|are|active|current(?:ly)?|now|averag\w+|leads?|ranks?|needs?|on pace|on track|within|away from)\b/i;   // "to have" is not "they have"

/**
 * A line about a dated happening that is over: { when, age (days), since (the team's games after it), days, why, recap },
 * or null for anything still going, undated, or rare over ten years or more.
 */
export function closedEvent(line, { box = null, today } = {}) {
  if (!today) return null;
  const t = plain(line.text), d = line.facts || describe(line.text, line);
  const games = (box?.games || []).filter((g) => g.d < today).map((g) => g.d).sort();
  const when = eventDate(line.text, { today, firstGame: games[0] || null });
  if (!when) return null;
  const since = games.filter((g) => g > when).length;
  // A stretch against the start of the season ("averaging 108.0 over the past 5 games after averaging 120.7 the first 7") is now.
  const stretch = /\b(?:past|last) (?:\d{1,2}|two|three|four|five|six|seven|eight|nine|ten) (?:games|GP|contests)\b|\bsince entering\b|\bper overall\b|\boverall this season\b|\b\d+ (?:straight|consecutive) games\b[^.]{0,40}\bthis season\b/i.test(t);
  const singleGame = OPENER.test(t) || DEBUT.test(t) || /\bin (?:his|her|their) return\b|\breturn to play\b/i.test(t) || (FIXED_WINDOW.test(t) && !stretch) || /\bin a (?:single )?game\b|\btraveled to\b|\b(?:passed|surpassed|moved past|eclipsed|overtook)\b[^.]{0,80}\bon (?:\w+\.? \d|\d)/i.test(t);
  // 0.157.0: a run in the past tense whose last printed date the team has played past is over (or the count is old):
  // "consecutive" alone no longer makes it a live streak.
  // 0.158.0: the past-tense verb can come anywhere ("With 29 points … on Nov. 10th, he recorded his seventh consecutive
  // game with 20+ points and 5+ assists, the second longest streak this season": still shown 15 days later), and then
  // only a series line, a race or a live hook keeps it open.
  const closedRun = since >= 1 && RUN_ANY.test(t) && PAST_ANY.test(t) && !PRESENT.test(t);
  // A happening led by a past-tense verb with its game's date ("Recorded his second game with 20+ points and 10+ assists
  // vs. LAL (11/4), becoming the sixth teenager in NBA history…", 21 days old): "game with" doesn't make it a growing count.
  // 0.159.0: the same when the game itself is the subject ("The Nov. 6 game marked Lyles' seventh career game with 3+
  // steals", shown 19 days later), and "career-best" or "this season" inside such a telling is that night's count too
  // ("Scored a career-high 18 points with a career-best 9 rebounds … on Nov. 19", "Logged his third game this season
  // with 15+ REB … at Atlanta (Nov. 20)"): a recap, kept two games or a week like any other.
  const pastTelling = since >= 1 && (PAST_LEAD.test(t) || /^(?:The )?(?:(?:Jan|Feb|Mar|Apr|Oct|Nov|Dec)[a-z]*\.? \d{1,2}|\d{1,2}\/\d{1,2}) (?:game|win|loss|victory|contest) (?:marked|was|gave|made)\b/i.test(t)) && !PRESENT.test(t);
  const openWords = OPEN.test(pastTelling ? t.replace(/\bgames? (?:this season )?with\b|\bcareer-best\b|\bthis season\b/gi, " ") : t);
  const live = !!line.matchup || line.kind === "pass" || line.kind === "next" || !!line.hook?.live;
  const open = !singleGame && (closedRun ? live : stretch || openWords || /\branks? (?:t-)?\w+ in (?:the )?(?:NBA|league)\b/i.test(t) || d.type === "club" || d.type === "race" || d.type === "streak" || live);
  if (open || longSpan(t, today)) return null;   // rare over a long span: the user keeps these
  const age = Math.round((Date.parse(today) - Date.parse(when)) / 864e5);
  return { when, age, since, ...shelfLife(t, { star: isStar(box, line.playerId) }) };
}
// ---------- How far off a countdown is (0.159.0) ----------
// The page's own milestone lines are ranked by the chance it happens tonight, and dropped under 25%. A countdown printed
// in the notes had no such measure: "Is 21 assists short from the 1,000th of his career" (Bobby Portis, 1.4 a game: about
// fourteen games off) ranked 28th of 650 on 11/25, above Antetokounmpo's "46 points short from the 22,000th" (two games).
const REACH_STAT = [
  ["oreb", /^offensive (?:rebounds?|boards?)$/i], ["dreb", /^defensive (?:rebounds?|boards?)$/i], ["reb", /^(?:total )?(?:rebounds?|boards?)$/i],
  ["fg3m", /^(?:3-?pointers?|three-?pointers?|threes|triples|3-?pt field goals?|three-point field goals?|3PM|3FGM?|3-pointers? made)$/i],
  ["ftm", /^(?:free[- ]throws?|FTM?|made free throws?)$/i], ["fgm", /^(?:field goals?|FGM?|made field goals?)$/i],
  ["pts", /^points?$/i], ["ast", /^assists?$/i], ["stl", /^steals?$/i], ["blk", /^(?:blocks?|blocked shots?)$/i], ["gp", /^(?:games?|games? played|appearances?)$/i], ["w", /^(?:wins?|victories)$/i]];
const REACH_WORD = "((?:offensive |defensive |total |made |three-point |3-?pt )?[A-Za-z3][\\w-]*(?: (?:field goals?|throws?|shots?|played))?)(?: made)?";
const REACH_RE = [
  new RegExp(`\\b(\\d[\\d,]*) ${REACH_WORD} (?:short (?:of|from)|shy of|away from|from (?:tying|passing|reaching|becoming|moving|the\\b|his\\b|\\d))`, "i"),
  new RegExp(`\\bneeds? (?:just |only )?(\\d[\\d,]*) (?:more )?${REACH_WORD} (?:to|for)\\b`, "i")];
/**
 * A countdown's distance: { need, stat, per (a game this season), games (need / per) }, or null when the line isn't one,
 * the stat isn't in the box scores, or he has played fewer than three games. A team's wins count against its record.
 */
export function reach(line, { box = null } = {}) {
  if (!box || !(box.games || []).length) return null;
  const t = plain(line.text);
  let m = null; for (const re of REACH_RE) { m = t.match(re); if (m) break; }
  if (!m) return null;
  const need = Number(m[1].replace(/,/g, "")), stat = REACH_STAT.find(([, re]) => re.test(m[2].trim()))?.[0];
  if (!need || !stat) return null;
  const k = Object.fromEntries((box.keys || []).map((x, i) => [x, i]));
  let per;
  if (stat === "w") { if (line.playerId) return null; per = box.games.filter((g) => g.pf > g.pa).length / box.games.length; }
  else {
    if (!line.playerId) return null;
    const rows = box.games.map((g) => g.pl?.[String(line.playerId)]).filter((r) => r && r[k.min] > 0);
    if (rows.length < 3) return null;
    per = stat === "gp" ? rows.length / box.games.length : k[stat] == null ? null : rows.reduce((a, r) => a + (r[k[stat]] || 0), 0) / rows.length;
    if (per == null) return null;
  }
  const games = per > 0 ? need / per : Infinity;
  return { need, stat, per: Math.round(per * 100) / 100, games: Number.isFinite(games) ? Math.round(games * 10) / 10 : null };
}
/** What a countdown loses in rank for being far off: nothing within two games' reach, then half a point each time the
 *  distance doubles, 1.5 at most (four games 0.5, eight 1.0, sixteen or more 1.5). The line stays on the page. */
export const farShare = (r) => (!r ? 0 : r.games == null ? 1.5 : r.games <= 2 ? 0 : Math.min(1.5, Math.round(0.5 * Math.log2(r.games / 2) * 100) / 100));

/**
 * What a kept line loses in rank (× SHELF.penalty): 0 while fresh (SHELF.grace days), 1 at the end of its shelf life,
 * and slowly at first (the square of the way through). An NBA-history first three days old loses next to nothing; at
 * day 8 a quarter; at day 14 all of it.
 */
export const agedShare = (ev) => (!ev || ev.recap ? 0 : Math.max(0, Math.min(1, (ev.age - SHELF.grace) / Math.max(1, ev.days - SHELF.grace))) ** 2);

export function trimReason(line, { box = null, today, home = null, opp = null } = {}) {
  const t = plain(line.text);
  const d = line.facts || describe(line.text, line);
  // 0.158.0: a sentence the next column cut off ("Only had more than 6 rebounds once over the past 6 games after.", Houston 11/25)
  if (/\b(?:after|before|and|or|the|of|with|to|for|while|when|than|by|from|a|an|as|but)\.?$/i.test(t.trim()) && !/\b(?:and|or) (?:more|counting|so on)\.?$/i.test(t.trim())) return "garbled (cut off mid-sentence)";
  { const cant = cantBeThisSeason(line.text, { box, playerId: line.playerId }); if (cant) return cant; }
  // 0.163.0: a game the box scores place in another season (checkDates), in a line that doesn't say it is about this one
  if (line.dateCheck?.otherSeason && !THIS_SEASON_RE.test(t)) return `an earlier season's game (on ${+line.dateCheck.said.slice(5, 7)}/${+line.dateCheck.said.slice(8, 10)} this season the team played ${line.dateCheck.played}, not ${line.dateCheck.opp})`;
  // Layout damage: a bio-table row ("… on Virginia / USA 8th Season 10/21/26 vs UTA") or two columns read across.
  if (/\b[A-Z][a-z]+(?: [A-Z][a-z]+)? \/ [A-Z]{2,3}\b|\b\d{1,2}(?:st|nd|rd|th) Season\b/.test(t)) return "garbled (a table row)";
  if ((t.match(/\bjoining\b/g) || []).length >= 2 || /\b(?:of|in|to|the|for|and)\s+[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+(?:Jr|Sr)\.?|\s+I{2,3})?\s+(?:notches|notched|records|recorded|becomes|became|scores|scored|posts|posted|tallies|tallied)\b/.test(t)) return "garbled (two columns read as one)";
  // 0.69 (the user, 11/15): a table read into the sentence ("DREB 92 times (@ CHI, 10 at DEN 1/9/26 Totaled…").
  // 0.76: a season list cut by the next column ("…(2018-19, 2021-22, 2022-5-of-19 over the past 4 games (…). 23).").
  if (/\b(?:19|20)\d\d-\d{1,2}-of-\d|\)\. \d{1,2}\)\.?$/.test(t)) return "garbled (two columns read as one)";
  if (/\b(?:DREB|OREB)\b|\(@ [A-Z]{2,4},|\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.? \d{1,2} (?:at|vs\.?) [A-Z][a-z]+:/.test(t)) return "garbled (a table read into it)";
  // Last season's text left in this season's notes: it says "this season" but every date in it is before this season
  // ("5+ blocks in 23 straight games from Jan. 17 to March 8, 2026, the longest streak in the NBA this season").
  const seasonStart = today ? `${+today.slice(5, 7) >= 8 ? today.slice(0, 4) : +today.slice(0, 4) - 1}-10-01` : null;
  const fullDates = [...t.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}(?:\s*[-–]\s*\d{1,2})?,? ((?:19|20)\d\d)\b/g)].map((m) => `${m[2]}-${String("JanFebMarAprMayJunJulAugSepOctNovDec".indexOf(m[1]) / 3 + 1).padStart(2, "0")}-15`)
    .concat([...t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g)].map((m) => `${m[3].length === 2 ? 2000 + +m[3] : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`));
  const curTag = seasonStart ? `${seasonStart.slice(0, 4)}-${String(+seasonStart.slice(0, 4) + 1).slice(2)}` : null;
  if (seasonStart && /\bthis season\b/i.test(t) && !t.includes(curTag) && fullDates.length && fullDates.every((x) => x < seasonStart)) return "last season's note (its dates are all before this season)";
  // A title from past seasons ("Third consecutive NBA blocks champion"): background now, a storyline again from March,
  // when he could add another (the user, 11/15).
  if (/\b(?:champion|scoring title|blocks title|rebounding title|assists title)\b|\blead(?:s|ing)? the (?:league|NBA) in [^.]{0,40}\b(?:consecutive|straight) seasons\b/i.test(t) && !/\b(?:this season|on pace|currently|so far)\b/i.test(t)
    && today && +today.slice(5, 7) >= 8) return "a title from past seasons (back from March, when another is in reach)";
  // Filler about the franchise's age.
  if (!line.player && /\b\d{1,3}(?:st|nd|rd|th) season in (?:franchise|team) history\b/i.test(t) && t.length < 120) return "filler";
  // 0.77 (the user, 11/16, on "Bam Adebayo has now started eight season openers with Miami"): the opener is news for the
  // first three weeks of the season. A run that began on opening night ("in every game since the opener") is still going,
  // and a mark rare over ten years or more ("the most FTA in a regulation game since Dec. 12, 2014") stays, as before.
  {
    const first = (box?.games || []).map((g) => g.d).sort()[0] || seasonStart?.replace(/-10-01$/, "-10-20");
    const weeks = first && today ? (Date.parse(today) - Date.parse(first)) / 6048e5 : 0;
    if (weeks > 3 && /\bseason[- ]open(?:er|ers|ing)\b|\bopening[- ]night\b|\bopening[- ]day\b/i.test(t) && !/\b(?:since|every game since|dating back to)\b[^.]{0,30}\b(?:opener|opening)/i.test(t) && !longSpan(t, today)) return "past one-off (season opener, over three weeks ago)";
  }
  // A recap written the night of an earlier game and left in ("Gobert had 10 rebounds through three quarters of tonight's
  // game, marking his 37th…", from Oct. 25, read on Nov. 16): "tonight" was that night, and its counts have moved since.
  if (/\b(?:of|in|during|through) tonight['’]s (?:game|contest|win|loss|victory|matchup)\b/i.test(t) && /\b(?:had|scored|recorded|tallied|finished|posted|grabbed|marking|marked|made|dished|notched)\b/i.test(t)) return "a recap from the night of an earlier game (its counts are as of that night)";
  // 0.158.0: the same with "today" ("Drummond’s double-double in the first half today was the third fastest…", still in
  // the Knicks' notes two games later).
  if (/\b(?:today|tonight) (?:was|were|marked|made|gave|moved|tied|set)\b|\b(?:in|during|of|through) (?:the )?(?:first|second|third|fourth|1st|2nd|3rd|4th) (?:half|quarter|period) (?:today|tonight)\b/i.test(t)) return "a recap from the night of an earlier game (its counts are as of that night)";
  // 0.158.0: a run "to start the season" whose printed dates ended over three weeks ago ("five consecutive 20+ point games
  // to start the season (10/21 - 10/29)", shown on 11/25). One still going prints no end date, or a recent one.
  if (/\bto (?:start|begin|open) (?:the|this|a) season\b/i.test(t) && today && !longSpan(t, today)) {
    const ended = eventDate(line.text, { today });
    const days = ended ? Math.round((Date.parse(today) - Date.parse(ended)) / 864e5) : 0;
    if (days > 21) return `past one-off (the start of the season, ${days} days ago)`;
  }
  // 0.158.0: a streak against a team that isn't tonight's opponent ("at least 10 threes in 22 consecutive games against
  // Memphis", in Minnesota's notes on a night at Oklahoma City): the last opponent's series note, left in.
  if (opp) {
    const m = t.match(RUN_VS);
    const other = m ? triOf(m[1]) : [];
    if (other.length === 1 && other[0] !== opp) return `a streak against another opponent (${m[1]}), not tonight's`;
  }
  // The other venue: a home-only stat on a road night, and the reverse.
  const homeStat = /\bhome (?:sellouts?|sellout streak|attendance|crowds?|games?|record|winning streak|win streak|losing streak|court)\b|\bsellouts?\b|\bat home\b/i.test(t);
  const roadStat = /\bon the road\b|\broad (?:games?|record|trip|winning streak|win streak|losing streak|wins?|losses)\b|\baway from home\b/i.test(t);
  if (home === false && homeStat && !roadStat) return "a home stat, on a road night";
  if (home === true && roadStat && !homeStat) return "a road stat, on a home night";
  // Closed, past one-offs: a recap after two games or a week, as before; a bigger claim after its shelf life (0.157.0).
  const ev = closedEvent(line, { box, today });
  if (!ev) {
    // 0.160.0 (the user, 11/25: "do you make rules across all teams so those issues don't continue to arise?"): the rules
    // above know an old line by its wording, and each round another wording got by ("is the first 76er … in three
    // consecutive games (10/28…)", 25 days old, stayed because it says "is"). This one doesn't read the wording: a line
    // whose own latest date is more than SHELF.standing days back (longer for a first with a longer shelf life) is past,
    // whatever tense it is told in, because what it counts or where it ranks is as of that date. Left alone: a countdown,
    // a series line, a streak the box scores still carry (a live hook), and anything rare over ten years or more.
    const live = !!line.matchup || line.kind === "pass" || line.kind === "next" || !!line.hook?.live;
    const own = today && !live && !longSpan(t, today) ? eventDate(ownDates(line.text), { today }) || line.recordCheck?.asOf || null : null;   // 0.163.0: or the day its stated record was true
    if (!own) return null;
    const ageOwn = Math.round((Date.parse(today) - Date.parse(own)) / 864e5);
    const keep = Math.max(SHELF.standing, shelfLife(t, { star: isStar(box, line.playerId) }).days);
    return ageOwn > keep ? `past one-off (its latest date is ${ageOwn} days old; what it counts is as of then)` : null;
  }
  const { age, since } = ev;
  // An event, not a stat (a trip, a first visit): over once it's past, and not brought back for a team with few lines.
  if (/\btraveled to\b|\bfor the first time in (?:team|franchise) history to (?:face|play|visit|travel)\b/i.test(t) && (since >= 1 || age > 3)) return `past event (${age} days ago)`;
  if (ev.recap ? since >= 2 || age > SHELF.recap : age > ev.days) return `past one-off (${OPENER.test(t) ? "season opener, " : ""}${age} days ago, ${since} games since${ev.recap ? "" : `; ${ev.why} keeps its place ${ev.days} days`})`;
  return null;
}

/**
 * Split a team's lines into kept and trimmed. A team left with fewer than `floor` lines gets its best trimmed
 * past one-offs back (never garbled, filler or wrong-venue ones).
 */
export function trimLines(lines, { box = null, today, home = null, floor = 4, opp = null } = {}) {
  let keep = [], trimmed = [];
  // The same streak counted at two points of the season (a recap from three games ago beside the latest): the
  // higher count is the one to read; the lower is listed as trimmed (0.76).
  const top = new Map();
  for (const l of lines) if (l.streakNow) { const k = `${l.playerId}|${l.streakNow.key}`; top.set(k, Math.max(top.get(k) || 0, l.streakNow.said)); }
  const older = (l) => (l.streakNow && l.streakNow.said < top.get(`${l.playerId}|${l.streakNow.key}`) ? `an older count of the same streak (${l.streakNow.said}; it is at ${Math.max(l.streakNow.now, top.get(`${l.playerId}|${l.streakNow.key}`))})` : null);
  // 0.77: a climb up one list told place by place ("passed Julius Erving for the 79th most points", "passed Tracy McGrady
  // for the 78th", "now ranks 77th"; the user, 11/16): the place he holds now is the line; the rungs below are trimmed.
  const rung = (l) => { const m = /^(?:T-)?(\d+)(?:st|nd|rd|th) (all-time|in team history)$/.exec(l.tag || ""); return m && l.playerId ? { n: +m[1], key: `${l.playerId}|${m[2]}|${listStat(l.text)}` } : null; };
  const rungs = new Map();
  for (const l of lines) { const r = rung(l); if (r) rungs.set(r.key, [...(rungs.get(r.key) || []), r.n]); }
  // A climb goes rung by rung: the place a line is measured against is the nearest better one within five, followed up
  // the ladder (79th -> 78th -> 77th). A place far above belongs to some other list that shares the wording.
  const topOf = (key, n) => { for (;;) { const up = (rungs.get(key) || []).filter((m) => m < n && n - m <= 5); if (!up.length) return n; n = Math.min(...up); } };
  const lower = (l) => { const r = rung(l); const top = r ? topOf(r.key, r.n) : null; return r && top < r.n ? `an earlier place on the same list (${ordinal(r.n)}; he is ${ordinal(top)} now)` : null; };
  // 0.164.0 (the user, 11/25: "Sellout streak can't be two different numbers unless it's two different stats"): the
  // Warriors' notes give the home sellout streak twice, "Entering the 2026-27 season, the Warriors had sold out 606
  // consecutive home games" and "…is at 614 consecutive games (8 sellouts in 2026-27)". One streak at two points in time:
  // the count now is the line. A count said as of the season's start goes when another line of the same owner counts
  // the same thing higher by no more than the games played since (the box scores' count; a few more allowed for the
  // preseason and play-in the notes may count).
  const startCount = (l) => { const t = plain(l.text); if (l.streakNow || !/\b(?:entering|coming into|heading into|prior to|before|at the start of) (?:the |this )?(?:\d{4}-\d{2} )?(?:season|campaign)\b/i.test(t)) return null; const m = /\b(\d{1,4}) (?:consecutive|straight)\b/.exec(t); return m ? +m[1] : null; };
  const nowCount = (l) => { const t = plain(l.text); const m = /\b(\d{1,4}) (?:consecutive|straight)\b/.exec(t) || /\bstreak\b[^.;]{0,60}?\b(?:at|to|reached|stands at) (\d{1,4})\b/i.exec(t); return m ? +m[1] : null; };
  const GENERIC = new Set("the a an of in at is are was were had has have and with to for their his its on by as that this it from consecutive straight game games streak streaks season seasons campaign entering currently regular".split(" "));
  const subject = (l) => new Set(plain(l.text).toLowerCase().replace(/\bsold[- ]out\b|\bsell[- ]?outs?\b/g, "sellout").replace(/[^a-z ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !GENERIC.has(w)).map((w) => w.replace(/s$/, "")));
  const played = (box?.games || []).length;
  const passed = (l) => {
    const n = startCount(l); if (n == null) return null;
    const mine = subject(l);
    const now = lines.filter((o) => o !== l && (o.playerId || null) === (l.playerId || null) && startCount(o) == null).map((o) => ({ m: nowCount(o), shared: [...subject(o)].filter((w) => mine.has(w)).length }))
      .filter((x) => x.m != null && x.m > n && x.m <= n + played + 8 && x.shared >= 2).sort((a, b) => b.m - a.m)[0];
    return now ? `the count entering the season (${n}); the same streak is at ${now.m} in another line` : null;
  };
  for (const l of lines) { const why = older(l) || lower(l) || passed(l) || trimReason(l, { box, today, home, opp }); (why ? trimmed : keep).push(why ? { ...l, trimmed: why } : l); }
  // The same fact told twice, once with its date and once without ("Wilson is the first rookie in Bulls history to…"):
  // when the dated telling is a past one-off, so is the other.
  const firstName = (l) => (l.player || "").split(" ").slice(-1)[0];
  keep = keep.filter((l) => {
    const twin = trimmed.find((x) => /^past/.test(x.trimmed) && (x.player && l.player ? firstName(x) === firstName(l) : !x.player && !l.player) && contained(bag(l.text), bag(x.text)));
    if (twin) trimmed.push({ ...l, trimmed: `${twin.trimmed.replace(/ \(.*$/, "")} (told again)` });
    return !twin;
  });
  if (keep.length < floor) {
    const back = trimmed.filter((l) => /^past one-off/.test(l.trimmed)).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, floor - keep.length);
    for (const b of back) { keep.push({ ...b, trimmed: undefined, kept: "few lines tonight" }); trimmed.splice(trimmed.indexOf(b), 1); }
  }
  return { keep, trimmed };
}
