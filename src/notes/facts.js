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
import { blocks } from "./narrative.js";

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
  if (m) return { rank: ordNum(m[2]), tie: !!m[1] || /\btying\b|\btied for\b/i.test(t) };
  m = t.match(/\b(?:ranks?\s+|for\s+|into\s+)(T-)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d{1,3}(?:st|nd|rd|th))\b(?:\s+(?:all-time|on the|in (?:NBA|franchise|team|league) history|place))?/i);
  if (m) return { rank: ordNum(m[2]), tie: !!m[1] };
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
  const league = /\bin the (?:NBA|league)\b|\bleague-wide\b|\bof any (?:team|player)\b|\bby any (?:team|player)\b|\b(?:leads?|led) all NBA\b|\bamong (?:all )?(?:NBA|qualified|active)\b|\bin league history\b|\bin NBA history\b|\bthe NBA\b/i.test(t);
  const history = /\bin (?:NBA|league) history\b|\ball-time\b|\bsince (?:the )?(?:19[5-9]\d)\b|\bever\b|\bsince \w+ (?:began|were) (?:being )?(?:officially )?tracked\b/i.test(t);
  const teamOnly = /\bby any [A-Z][a-z]+s? player\b|\bby a [A-Z][a-z]+s? player\b|\bon the team\b|\bamong (?:all )?(?:[A-Z][a-z]+s?|team) (?:players|rookies)\b/.test(t);
  const franchise = /\b(?:in|on) (?:the )?[A-Z][a-z]+(?:['’]s?)? all-time\b|\b[A-Z][a-z]+['’]s? (?:all-time|career|franchise) (?:list|leaders?)\b|\b(?:franchise|team|club) (?:history|annals)\b/.test(t) || /\b(?:team|franchise|club) (?:history|annals|record)\b|\b[A-Z][a-z]+ (?:history|annals)\b(?<!NBA history)|\bof a [A-Z][a-z]+ career\b|\bby an? [A-Z][a-z]+(?: rookie)? (?:in|since)\b|\b(?:first|only|\w+) [A-Z][a-z]+s? (?:rookie|duo|trio|player)s? (?:to|since|in)\b/.test(t) && !/\bin (?:NBA|league) history\b/i.test(t);
  const season = /\bthis (?:season|year|campaign)\b|\bso far\b|\bcurrently\b|\b2026-27\b|\bover the first \d+ games of the season\b|\bwhich leads the league\b/i.test(t);
  const streak = /\b\d{2,} (?:consecutive|straight) (?:games|starts|contests)\b|\bactive streak\b|\blongest active\b/i.test(t);
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

/** Type, tag and a one-line why, for the page, the storylines and the digest. */
export function describe(text, meta = {}) {
  const t = plain(text);
  const f = features(t, meta);
  const club = clubOf(t), rk = rankOf(t), th = thresholds(t);
  const streakN = t.match(/\b(\d{2,}) (?:consecutive|straight) (?:games|starts|contests)\b/i);
  const teamScope = /\b(?:franchise|team|club) (?:history|annals)\b|\b[A-Z][a-z]+['’]s? (?:all-time|career|franchise)\b|\bby any [A-Z][a-z]+s? player\b/.test(t);
  const scope = teamScope ? "franchise" : f.league ? (f.history || /since/i.test(t) && !f.season ? "nba-history" : "nba") : f.franchise ? "franchise" : null;
  let type = "other", tag = "Notes", why = "";
  if (f.matchup) { type = "matchup"; tag = "Series"; why = "The history with tonight's opponent."; }
  else if (f.race) { type = "race"; tag = "Race"; why = "A race on a leaderboard: both sides can move."; }
  else if (f.streak) { type = "streak"; tag = streakN ? `Active streak · ${Number(streakN[1])}` : "Active streak"; why = "A live streak: it grows if he plays tonight."; }
  else if (club != null) {
    type = "club";
    const where = scope === "franchise" ? " in team history" : f.season ? " this season" : f.history || scope === "nba-history" ? " in NBA history" : "";
    tag = club === 1 ? `Only one${where}` : `1 of ${club}${where}`;
    why = f.season ? "Rare company this season, and every game moves the averages." : scope === "franchise" ? "A first for the franchise." : "Rare company in league history.";
  } else if (rk && scope === "franchise") {
    type = "franchise"; tag = `${rk.tie ? "T-" : ""}${ordinal(rk.rank)} in team history`; why = "Team history.";
  } else if (rk && scope !== "franchise" && (f.league || f.season)) {
    type = "rank";
    tag = rk.rank === 1 ? (f.season || !f.history ? "Leads NBA" : "Most in NBA") : `${rk.tie ? "T-" : ""}${ordinal(rk.rank)} in NBA`;
    if (f.history || /since/i.test(t)) tag = rk.rank === 1 ? `Most since ${(t.match(/since (?:entering the league in )?((?:19|20)\d\d(?:-\d\d)?)/i) || [])[1] || "…"}`.replace(" since …", " in NBA") : `${rk.tie ? "T-" : ""}${ordinal(rk.rank)} ${/since 19|since 20/i.test(t) ? `since ${t.match(/since ((?:19|20)\d\d(?:-\d\d)?)/i)[1]}` : "all-time"}`;
    why = rk.rank === 1 ? "Best in the league right now." : rk.rank <= 3 ? "Top three in the league right now." : "Where he stands in the league.";
  } else if (scope !== "franchise" && (f.history || scope === "nba-history")) {
    const since = t.match(/\bsince (?:the )?((?:19|20)\d\d(?:-\d\d)?)\b/i);
    type = "alltime"; tag = rk ? `${rk.tie ? "T-" : ""}${ordinal(rk.rank)} ${since ? `since ${since[1]}` : "all-time"}` : since ? `Since ${since[1]}` : "NBA history"; why = "All-time company.";
  } else if (f.franchise) { type = "franchise"; tag = "Team history"; why = "Team history."; }
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
export function dedupe(lines) {
  const out = [];
  for (const l of [...lines].sort((a, b) => (b.score || 0) - (a.score || 0))) {
    const d = l.facts || describe(l.text, l), b = bag(l.text), who = l.player || (l.matchup ? "series" : "team");
    const dup = out.find((o) => {
      if ((o.player || (o.matchup ? "series" : "team")) !== who) return false;
      const od = o.facts, ob = bag(o.text);
      if (d.thresholds.length >= 2 && sig(d.thresholds) === sig(od.thresholds)) return true;
      if (d.streak && d.streak === od.streak) return true;
      const j = jaccard(b, ob);
      let shared = 0; for (const x of b) if (ob.has(x)) shared++;
      return j >= 0.6 || (d.type === od.type && d.tag === od.tag && (j >= 0.35 || (d.rank === 1 && shared >= 4)));
    });
    if (!dup) out.push({ ...l, facts: d });
  }
  return out;
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
  const g = (box.games || []).filter((x) => x.pl?.[playerId]?.[k.min] > 0);
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
    const live = (gap) => !single && (/ACTIVE/.test(race.title || "") || race.scope === "season" && !/20\d\d-\d\d/.test((race.title || "").replace(/2026-27/, "")) || race.value >= 100 && gap <= 10);
    if (race.rank === 1 && race.below) return race.below.gap === 0
      ? { text: `Tied with ${race.below.name} at ${race.valueText} on the list, listed first.`, live: live(0), race }
      : { text: `Leads ${race.below.name} by ${fmt(race.below.gap, race.valueText)} (${race.valueText} to ${race.below.text}).`, live: live(race.below.gap), race };
    if (race.above) return { text: race.above.gap === 0 ? `Tied with ${race.above.name} at ${race.valueText}.` : `${fmt(race.above.gap, race.valueText)} behind ${race.above.name} (${race.above.text}) for ${ordinal(race.rank - 1)}.`, live: live(race.above.gap), race };
  }
  if (d.type === "streak" && d.streak) {
    const t = plain(line.text);
    if (!line.player) return { text: `${d.streak + 1} with tonight's game.`, live: true };
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
export function annotate(lines, { doc = null, tables = null, box = null, model = null, teamNames = [] } = {}) {
  const T = tables || (doc ? readTables(doc) : []);
  return dedupe(lines).map((l) => {
    const d = l.facts;
    const names = l.player ? [l.player, l.player.split(" ").slice(-1)[0]] : teamNames;
    l.facts = d;
    const race = d.type === "rank" || d.type === "race" || d.type === "streak" || d.type === "alltime" || d.type === "club" ? tableFor(l, T, names) : null;
    const stay = d.type === "club" && d.thresholds.length >= 2 && l.playerId ? stayInClub(d.thresholds, box, l.playerId) : null;
    const hook = hookFor(l, { race, stay });
    const f = { ...d.features, live: hook?.live ? 1 : 0 };
    const p = model ? score(f, model) : null;
    return { ...l, features: f, type: d.type, tag: d.tag, why: d.why, race: race || undefined, stay: stay || undefined, hook: hook || undefined, model: p == null ? undefined : Math.round(p * 1000) / 1000 };
  });
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
const OPEN = /\b(?:active streak|consecutive|straight|in a row|has now|now has|now ranks|is now|career-best|this season|is averaging|averaging|leads? (?:the|all)|ranks? \w+ in the (?:NBA|league)|needs?|within|away from|on pace|on track|has recorded|has registered|has posted|has made|has scored|has appeared|has played|games? with)\b/i;

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
  for (const m of t.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*((?:19|20)\d\d))?/gi)) {
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
export function trimReason(line, { box = null, today, home = null } = {}) {
  const t = plain(line.text);
  const d = line.facts || describe(line.text, line);
  // Layout damage: a bio-table row ("… on Virginia / USA 8th Season 10/21/26 vs UTA") or two columns read across.
  if (/\b[A-Z][a-z]+(?: [A-Z][a-z]+)? \/ [A-Z]{2,3}\b|\b\d{1,2}(?:st|nd|rd|th) Season\b/.test(t)) return "garbled (a table row)";
  if ((t.match(/\bjoining\b/g) || []).length >= 2 || /\b(?:of|in|to|the|for|and)\s+[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+(?:Jr|Sr)\.?|\s+I{2,3})?\s+(?:notches|notched|records|recorded|becomes|became|scores|scored|posts|posted|tallies|tallied)\b/.test(t)) return "garbled (two columns read as one)";
  // Filler about the franchise's age.
  if (!line.player && /\b\d{1,3}(?:st|nd|rd|th) season in (?:franchise|team) history\b/i.test(t) && t.length < 120) return "filler";
  // The other venue: a home-only stat on a road night, and the reverse.
  const homeStat = /\bhome (?:sellouts?|sellout streak|attendance|crowds?|games?|record|winning streak|win streak|losing streak|court)\b|\bsellouts?\b|\bat home\b/i.test(t);
  const roadStat = /\bon the road\b|\broad (?:games?|record|trip|winning streak|win streak|losing streak|wins?|losses)\b|\baway from home\b/i.test(t);
  if (home === false && homeStat && !roadStat) return "a home stat, on a road night";
  if (home === true && roadStat && !homeStat) return "a road stat, on a home night";
  // Closed, past one-offs.
  const games = (box?.games || []).filter((g) => g.d < today).map((g) => g.d).sort();
  const when = eventDate(line.text, { today, firstGame: games[0] || null });
  const singleGame = OPENER.test(t) || DEBUT.test(t) || FIXED_WINDOW.test(t) || /\bin a (?:single )?game\b|\btraveled to\b|\b(?:passed|surpassed|moved past|eclipsed|overtook)\b[^.]{0,80}\bon (?:\w+\.? \d|\d)/i.test(t);
  const open = !singleGame && (OPEN.test(t) || d.type === "club" || d.type === "race" || d.type === "streak" || !!line.matchup || line.kind === "pass" || line.kind === "next" || !!line.hook?.live);
  if (open || !when) return null;
  if (longSpan(t, today)) return null; // rare over a long span: the user keeps these
  const age = Math.round((Date.parse(today) - Date.parse(when)) / 864e5);
  const since = games.filter((g) => g > when).length;
  // An event, not a stat (a trip, a first visit): over once it's past, and not brought back for a team with few lines.
  if (/\btraveled to\b|\bfor the first time in (?:team|franchise) history to (?:face|play|visit|travel)\b/i.test(t) && (since >= 1 || age > 3)) return `past event (${age} days ago)`;
  if (since >= 2 || age > 7) return `past one-off (${OPENER.test(t) ? "season opener, " : ""}${age} days ago, ${since} games since)`;
  return null;
}

/**
 * Split a team's lines into kept and trimmed. A team left with fewer than `floor` lines gets its best trimmed
 * past one-offs back (never garbled, filler or wrong-venue ones).
 */
export function trimLines(lines, { box = null, today, home = null, floor = 4 } = {}) {
  let keep = [], trimmed = [];
  for (const l of lines) { const why = trimReason(l, { box, today, home }); (why ? trimmed : keep).push(why ? { ...l, trimmed: why } : l); }
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
