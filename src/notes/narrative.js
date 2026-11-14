import { checkLine, statClaims, thresholdClaims, meetsThresholds } from "./boxscore.js";
import { normStat, num } from "./stats.js";

/**
 * Narrative milestone text, read in the right order.
 *
 * Game notes put two or three columns of prose side by side. Reading a page
 * straight across splices sentences from different columns together (seen in
 * the Game Notes Analyzer's saved runs: "...snapped its five- Jordin Canada's
 * layup at the buzzer gave..."). Here each page is first split into columns at
 * its empty vertical gutters, each column is read top to bottom, then cut at
 * bullets ("•"), "..." separators and sentence ends.
 *
 * Two outputs:
 *   readAwayFrom  - structured milestones from "X is 93 rebounds away from
 *                   1,500 career rebounds... 36 games away from 500 career
 *                   games played" bullets (Charlotte's format)
 *   readNarrative - other forward-looking sentences, verbatim, never rewritten.
 *                   Marked unverified: sidebars can still interleave.
 */

const FORWARD = /\bneeds?\s+(?:just\s+|only\s+)?\d[\d,]*\b|\b\d[\d,]*\s+(?:[\w-]+\s+){0,3}(?:shy|away)\s+(?:of|from)\b|\bwithin\s+\d[\d,]*\s+(?:points?|rebounds?|assists?|steals?|blocks?|games?|wins?|of)\b|\bwould\s+(?:become|pass|tie|join|move|surpass|reach)\b|\bis\s+(?:approaching|closing in on|nearing)\b|\bon pace (?:to|for)\b|\bcan (?:become|pass|tie|join|move up|reach)\b|\bwith (?:his|her|their) next\b|\b(?:just|only)\s+(?:[\w,-]+\s+){0,3}(?:shy|short|away)\s+(?:of|from)\b|\b\d[\d,]*\s+(?:[\w-]+\s+){0,3}short\s+(?:of|from)\b|\bfrom (?:tying|passing|surpassing|reaching|becoming)\b/i;

const SUBJECT = /^(\p{Lu}[\p{L}’'.\-]+(?:\s+\p{Lu}[\p{L}’'.\-]+){1,2})\s+is\s+/u;
const SEG_ROUND = /^(?:and\s+)?(\d[\d,]*)\s+([a-z0-9][a-z0-9\- ]*?)\s+(?:away\s+)?from\s+(\d[\d,]*)\s+((?:career|made)\s+)*([a-z0-9][a-z0-9\- ]*?)\s*[.,;]?$/i;
const SEG_PASS = /^(?:and\s+)?(\d[\d,]*)\s+([a-z0-9][a-z0-9\- ]*?)\s+away\s+from\s+(?:passing|tying)\s+(\p{Lu}[\p{L}.’'\- ]+?)\s+for\s+(.+?)\s+in\s+(franchise|NBA|team|club)\s+history\s*[.,;]?$/iu;

/** Text blocks: every bullet / sentence of every column, in reading order. */
export function blocks(doc) {
  const out = [];
  for (const page of doc.pages) {
    for (const col of columnsOf(page)) {
      const text = col
        .join("\n")
        .replace(/(\w)-\n(\w)/g, "$1$2") // word broken across lines
        .replace(/\s*\n\s*/g, " ")
        .replace(/\s+/g, " ");
      for (const bullet of cleanSidebar(text).split(/\s*[•▪●]\s*/)) {
        // A bullet is a full note even without a final stop ("Has started 97 consecutive regular season games").
        let t = bullet.trim();
        if (t.length >= 40 && /[\p{L}\d%)]$/u.test(t) && !/\b(?:to|the|a|an|of|and|at|in|with|as|by|for|or|his|their|from|on|was|were|who|that|is|are|which)$/i.test(t)) t += ".";
        if (t) out.push({ page: page.page, text: t });
      }
    }
  }
  return out;
}

/* A player box with a stats sidebar read into the prose (Houston's "Notes/Trends" boxes, 11/13): "…once prior this
   GP 12 PPG 20.9 RPG 6.1 APG 3.6 season; back to…". The sidebar's rows start with GP, GS or MPG and run on in
   label-value pairs; they are taken out, with the box's header ("20th season (2nd w/HOU) Notes/Trends [2026-27
   Video Highlights] 2026-27 Season Stats"), so the sentences read whole. */
const SIDEBAR_ROW = /\b(?:GP|GS|MPG)\s+\d[\d.]*(?:\s+(?:PPG|RPG|APG|SPG|BPG|TPG|FG%|3PT%|FT%|MPG|GS|GP)\s+\.?\d[\d.]*)+(?:\s+bla\b)?/g;
export function cleanSidebar(text) {
  return text
    .replace(SIDEBAR_ROW, " ")
    // Portland's player boxes: the season line's header and values read into the bullets ("GP/GS PPG RPG APG SPG BPG MPG", "11/2 8.3 3.5 2.0 0.5 0.3 23.1").
    .replace(/\bGP\/GS PPG RPG APG SPG BPG MPG\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\s+\d{1,2}\.\d){6}\b/g, " ")
    .replace(/\b\d{1,2}(?:st|nd|rd|th) season \(\d{1,2}(?:st|nd|rd|th) w\/[A-Z]{2,3}\)\s*/g, " ")
    .replace(/Notes\/Trends\s*\[[^\]]{0,60}\]\s*/g, " ")
    .replace(/\b(?:19|20)\d\d-\d\d Season Stats\b\s*/g, " ")
    .replace(/\s+/g, " ").trim();
}

export function readAwayFrom(doc) {
  const out = [];
  for (const b of blocks(doc)) {
    const subj = b.text.match(SUBJECT);
    if (!subj || !/away from|played from/i.test(b.text)) continue;
    const player = subj[1];
    const body = b.text.slice(subj[0].length);
    for (const seg of body.split(/\s*(?:\.{3}|…)\s*/)) {
      const s = fitSegment(seg.trim());
      if (!s) continue;
      const p = s.match(SEG_PASS);
      if (p) {
        out.push({
          format: "away-from-pass", page: b.page, player,
          statRaw: p[2], stat: normStat(p[2].replace(/\s+made$/i, "")),
          need: num(p[1]), passing: p[3].trim(), forWhat: p[4].trim(),
          scope: /nba/i.test(p[5]) ? "nba" : "franchise",
          text: `${player} is ${s}`,
        });
        continue;
      }
      const m = s.match(SEG_ROUND);
      if (!m) continue;
      const counted = normStat(m[2]);
      const named = normStat(`${m[4] && /made/i.test(m[4]) && !/made/i.test(m[5]) ? "made " : ""}${m[5]}`) || normStat(m[5]);
      const need = num(m[1]), target = num(m[3]);
      out.push({
        format: "away-from", page: b.page, player,
        statRaw: m[5], stat: named || counted,
        statMismatch: counted && named && counted !== named ? `counts "${m[2]}" toward "${m[5]}"` : null,
        target, current: need != null && target != null ? target - need : null, needStated: need,
        scope: "career",
        text: `${player} is ${s}`,
      });
    }
  }
  return out;
}

/**
 * The last bullet of a list can run into whatever follows it in the column
 * (Charlotte p.37: "...25 games away from 500 career games played. Charlotte
 * Hornets All-Time Leaderboard GAMES PLAYED 701 Dell Curry..."). If the whole
 * segment doesn't read, try it cut at each sentence end, shortest first; a cut
 * inside a name ("P.J. Washington") simply fails to match and the next is tried.
 */
function fitSegment(s) {
  if (!s || SEG_PASS.test(s) || SEG_ROUND.test(s)) return s;
  for (const m of s.matchAll(/\.\s+(?=\p{Lu})/gu)) {
    const head = s.slice(0, m.index + 1);
    if (SEG_PASS.test(head) || SEG_ROUND.test(head)) return head;
  }
  return s;
}

export function readNarrative(doc) {
  const out = [];
  for (const b of blocks(doc)) {
    for (const s of sentences(b.text)) {
      if (s.length < 25 || s.length > 420) continue;
      // Headings and table labels are runs of capitals, not prose.
      if (/(?:\b[A-Z0-9’'&\-]{2,}\b[ :,]+){4,}/.test(s)) continue;
      const letters = s.replace(/[^A-Za-z]/g, "");
      if (letters.length && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.6) continue;
      if (FORWARD.test(s)) out.push({ page: b.page, text: s, verbatim: true, verified: false });
    }
  }
  // The same sentence can be printed twice (front page and player page).
  const seen = new Set();
  return out.filter((n) => { const k = n.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Split a page into columns at vertical gutters: x-ranges that almost no line
 * has text in. Returns each column as a list of its lines, top to bottom.
 */
export function columnsOf(page) {
  const width = Math.ceil(page.width || 612);
  const cover = new Uint16Array(width + 1);
  const lines = page.lines.filter((l) => l.cells.length);
  for (const l of lines) for (const c of l.cells) for (let x = Math.max(0, Math.floor(c.x0)); x <= Math.min(width, Math.ceil(c.x1)); x++) cover[x]++;

  const limit = Math.max(1, Math.floor(lines.length * 0.03));
  const gutters = [];
  let start = null;
  for (let x = Math.floor(width * 0.12); x <= Math.ceil(width * 0.88); x++) {
    if (cover[x] <= limit) { if (start === null) start = x; }
    else if (start !== null) { if (x - start >= 8) gutters.push((start + x) / 2); start = null; }
  }
  const bounds = [-Infinity, ...gutters, Infinity];
  const cols = bounds.slice(1).map(() => []);
  for (const l of lines) {
    const perCol = cols.map(() => []);
    for (const c of l.cells) {
      const i = bounds.findIndex((b, k) => k < bounds.length - 1 && c.cx >= b && c.cx < bounds[k + 1]);
      perCol[Math.max(0, i)].push(c.text);
    }
    perCol.forEach((parts, i) => parts.length && cols[i].push(parts.join(" ")));
  }
  return cols.filter((c) => c.length);
}

function sentences(text) {
  // Split after . ! ? or "…" followed by a capital, but not after initials or
  // common abbreviations (Jr., No., vs., Oct., St.).
  const parts = [];
  let last = 0;
  const re = /([.!?…])\s+(?=["“(]?[A-Z])/g;
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, m.index - 4), m.index + 1);
    if (/\b(?:[A-Z]|Jr|Sr|No|vs|St|Mt|Dr|Jan|Feb|Mar|Apr|Aug|Sept?|Oct|Nov|Dec|Def|Off|Pct|Reb|Opp)\.$/.test(before)) continue;
    parts.push(text.slice(last, m.index + 1).trim());
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last).trim());
  return parts.filter(Boolean);
}

/**
 * History lines from a team's notes: what the team's PR staff found worth noting, verbatim.
 *   pass     forward-looking passes / ties ("needs 816 points to pass Kobe Bryant for 4th")
 *   next     other forward-looking lines ("is 12 assists away from 1,000", "on pace to become")
 *   record   history already made ("first rookie since Luka Dončić to...", "only player in NBA history",
 *            "most ... in franchise history", "best start since 1999-00")
 * College / high-school lines are left out; this season's facts score above older background.
 * players: [{ id, name }] of the team, to tie a line to a player (named in it, or under his page heading).
 * -> [{ page, text, kind, player, playerId, when: "season" | "older" | null, score }]
 */
const HISTORY = /\b(?:in (?:NBA|league|franchise|team|club|[A-Z][a-z]+) history|all-time|(?:first|only|second|third|fourth|fifth|\d+(?:st|nd|rd|th)) (?:player|rookie|team|teenager|guard|center|forward|duo|trio|pair|teammates?|players|teams|coach|starter|reserve|\w+ to)\b|since (?:the )?(?:19|20)\d\d|(?:most|fewest|longest|highest|lowest|best|worst)\b[^.]{0,60}\b(?:since|ever|in (?:NBA|franchise|team|league|club) history|by any|of any)|youngest|oldest|fastest|quickest|(?:NBA|franchise|team|league|club|single-game|season|career|rookie|all-time)[- ]records?\b|record for (?:the )?most)/i;
// League context (0.48, from the user's picks in the Wizards' 11/12 notes): ranks in the league this season, exclusive
// clubs, active streaks, races on a list, and the series with tonight's opponent. Not history, but what the user flags.
const CONTEXT = /\b(?:leads?|led|leading)\s+(?:all\s+|the\s+)?(?:NBA|league)\b|\blead(?:s|ing)? the (?:NBA|league)\b|\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+in (?:the )?(?:NBA|league)\b|\b(?:(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))[- ])?(?:most|highest|lowest|fewest|least|best|longest)\b[^.;]{0,90}?\b(?:in the (?:NBA|league)|of any (?:team|player)|by any (?:team|player)|league-wide|among (?:all )?(?:NBA|qualified|active))|\bone of the top\b[^.;]{0,40}\bin the (?:NBA|league)\b|\bone of (?:two|three|four|five|six|seven|eight|nine|ten|\d+) (?:players|teams|guards|forwards|centers|rookies|duos|trios)\b|\b(?:the )?only (?:[\w-]+ )?(?:player|team|rookie|duo|trio)s? in the (?:NBA|league)\b|\bas the only\b|\b\d{2,} (?:consecutive|straight) (?:[\w-]+ ){0,2}(?:games|starts|contests)\b|\b(?:longest|current) active\b|\bactive streak\b|\bonly\b[^.;]{0,80}\bmore\b[^.;]{0,60}\bthan\b|\bsecond only to\b|\bbehind only\b|\bowns the most\b|\bseason series\b|\bseries (?:history|between)\b|\bthis season['’]s series\b|\b(?:last|past) (?:\w+ )?meetings\b/i;
// Trends (11/13, from the user's picks in the Rockets' and Blazers' notes: "interesting tidbits… that didn't appear"):
// records when something happens ("Rockets are 30-12 when he has 5+ assists", "3-0 when having 15+ 3FGM"), stretches
// ("in each of the past 2 games", "4 straight games", "over the past 5 games after averaging…"), career highs over a span,
// league ranks written without "the" ("Ranks 10th in NBA in 3FG%"), percentiles, "since entering the starting lineup".
// Not schedule stretches ("will play 20 of 32 games on the road"): those say nothing about tonight.
const TREND = /\b\d{1,3}-\d{1,3} when\b|\bwhen (?:he|they|having|scoring|holding|shooting|outrebounding)\b[^.;…]{0,50}\b\d{1,3}-\d{1,3}\b|\b(?:in|over) (?:each of )?(?:the |his |their )?(?:past|last|first) \d{1,2} (?:games|GP|contests|starts)\b|\b\d{1,3} (?:straight|consecutive) (?:\w+ ){0,2}(?:games|GP|contests|starts)\b|\bcareer[- ]high\b|\bpercentile\b|\branks? (?:t-)?\w+ (?:in|among) (?:the )?(?:NBA|league)\b|\bsince (?:entering|joining|moving into|returning to) (?:the |his )?starting lineup\b|\bmost such\b|\bthrough (?:the season['’]s )?first \d+ games\b|\brank(?:s|ing)? (?:highly|top \d+)\b|\b(?:tied for )?(?:\w+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)[- ](?:most|fewest|highest|lowest|best)\b[^.;…]{0,40}\bin (?:the )?(?:NBA|league)\b/i;
const SCHEDULE = /\bwill play\b|\b(?:homestand|road trip) (?:post|after|before)\b|\bthrough (?:the )?All-Star break\b|\bof (?:their|its|our) (?:first|final|last|next) \d+ games at\b/i;
const SERIES = /\bseason series\b|\bseries (?:history|between)\b|\bthis season['’]s series\b|\b(?:last|past) (?:\w+ )?meetings\b|\bmeetings? (?:with|against|between)\b|\bhead-to-head\b/i;
// "Since entering the league in 2012-13, Davis owns…": a timeframe, not when it happened, and not background.
const SINCE_CLAUSE = /^Since (?:entering|joining|being drafted|he (?:joined|entered|arrived)|his (?:arrival|debut|rookie))[^,]{0,140},\s*/i;
const PASSY = /\b(?:pass|passing|tie|tying|surpass|move (?:up|into|past)|jump)\b/i;
const NOT_NBA = /\b(?:program record|against No\. \d+|high school|school history|program(?:'s)? (?:history|all-time)|NCAA|college|freshman|sophomore|junior|senior year|AAU|conference tournament|EuroLeague|Olympic|FIBA|national team|G League|summer league|preseason)\b/i;
const CURRENT = /\b(?:active streak|longest active|this season|this year|2026-27|26-27|tonight|last game|last night|his last|over (?:his|the) (?:past|last) \d+|in (?:each of )?the first \d+ games|through \d+ games|to (?:begin|start|open) (?:the|his|their) (?:season|campaign|year)|for the \w+ (?:straight|consecutive) game|season opener|today|so far|is now|currently|this campaign|in (?:his|their) (?:\w+ )?debut with|(?:has|have) (?:now )?(?:recorded|scored|made|posted|had|tallied|grabbed|dished|hit|logged|notched) [^.]{0,60}\b(?:straight|consecutive) games)\b|\b(?:Oct|Nov|Dec)\.? \d{1,2}\b|\b1[0-2]\/\d{1,2}\b/i;
const OLDER = /\b(?:last season|in 20(?:0\d|1\d|2[0-5])-\d\d|20(?:0\d|1\d|2[0-5])-\d\d:|during (?:the )?20(?:0\d|1\d|2[0-5])|previous (?:season|\d+ seasons)|career-long|as a rookie in)\b/i;

const TABLEY = /\b(?:ASTS?|STLS?|REBS?|BLKS?|TREB|PTS|TOV)\s+\d|\d+[prab]-\d+[prab]\b|\s\*\s|\b\d+K (?:PTS|AST|REB)\b|(?:\b[A-Z0-9’'&]{2,}\b\s+){3,}|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+\d{1,3}\s|\b[A-Z]{2,3}\s+\d{1,3}\s+\d{1,2}\/\d{1,2}\b/;
const MONTHS = "janfebmaraprmayjunjulaugsepoctnovdec";
const ABBR = "NBA|ABA|MVP|ESPN|TNT|ABC|NBC|USA|FGM|FTM|FTA|FGA|PPG|RPG|APG|SPG|BPG|OT|ET|PT|II|III|IV|ECF|WCF|NCAA|LA|AT&T";
const CAPS_PAIR = new RegExp(`\\b(?!(?:${ABBR})\\b)[A-Z][A-Z’'&\\-]{2,}\\s+(?!(?:${ABBR})\\b)[A-Z][A-Z’'&\\-]{2,}\\b`);
const OBJECT_BEFORE = /\b(?:passed|passing|passes|surpass\w*|eclips\w*|tied|ties|tying|joined|joins|joining|behind|than|over|past|ahead of|trailing|with|and|after|by|of|from|vs\.?|against)\s+$/i;

/* A feature box's lead sentence and its table ("…in several categories: Category Value NBA Rank Total Bench Points 147 pts
   4th Points Per 36 Minutes (min. 250 MP) 18.4 4th…"; Portland, 11/13): the lead, then the table's rows in a line
   ("Total Bench Points 147 pts (4th); Points Per 36 Minutes 18.4 (4th)…"). Three layouts: value and rank; this season
   against last ("Offensive Rating 113.1 (21st) 118.5 (4th)"); a ranked list (only our own team's rows). */
export function summarizeTable(s, teamTris = []) {
  const at = s.search(/:\s+(?:Category|Offensive Category|Defensive Category|Rank Player|[A-Z][a-z]+ [A-Z][a-z]+ Value)\b/);
  if (at < 40) return null;
  const intro = s.slice(0, at).trim();
  let body = s.slice(at + 1).replace(/\s+(?:[\p{Lu}0-9’'&,\-]{2,}\s+){1,}[\p{Lu}0-9’'&,\-]{2,}\.?\s*$/u, "").replace(/\s+PAGE \d+\.?\s*$/, "");
  body = body.replace(/\((?:min\.|minimum)[^)]*\)\s*/g, "")
    .replace(/(?:^|\s)(?:Offensive |Defensive )?Category\s+(?:Value\s+NBA\s+(?:Bench\s+)?Rank|(?:19|20)\d\d-\d\d \(rank\)\s+(?:19|20)\d\d-\d\d \(rank\))\s*/g, " ")
    .replace(/(\p{Lu}[\p{L}.’'\-]+ \p{Lu}[\p{L}.’'\-]+) Value NBA (?:Bench )?Rank\s*/gu, "$1: ");
  const rows = [];
  // This season against last: "Label v1 (r1) v2 (r2)".
  for (const m of body.matchAll(/([A-Z][A-Za-z.&’' -]{3,40}?)\s+(-?[\d.]+%?(?: [A-Za-z%]{2,4})?)\s+\(((?:t-)?\d{1,2}(?:st|nd|rd|th))\)\s+(-?[\d.]+%?(?: [A-Za-z%]{2,4})?)\s+\(((?:t-)?\d{1,2}(?:st|nd|rd|th))\)/g))
    if (!/rank|Category/i.test(m[1])) rows.push(`${m[1].trim()} ${m[4]} (${m[5]}), from ${m[2]} (${m[3]})`);
  // Value and rank: "Label value rank".
  if (!rows.length) for (const m of body.matchAll(/([A-Z][A-Za-z0-9.&’'\/ -]{3,45}?)\s+((?:\.\d+|\d+(?:\.\d+)?)%?(?: ?[A-Za-z]{2,4})?)\s+((?:t-)?\d{1,2}(?:st|nd|rd|th))\b/g))
    if (!/^(?:Value|Rank|Category|NBA)\b/.test(m[1].trim())) rows.push(`${m[1].replace(/^(?:Value NBA (?:Bench )?Rank|Category Value NBA (?:Bench )?Rank)\s*/, "").trim()} ${m[2]} (${m[3]})`);
  // A ranked list: our own team's rows.
  if (!rows.length && teamTris.length) for (const m of body.matchAll(/\b(\d{1,2})\s+(\p{Lu}[\p{L}.’'\-]+(?:\s+\p{Lu}[\p{L}.’'\-]+){1,2})\s+([A-Z]{3})\s+(\.?\d[\d.]*)/gu))
    if (teamTris.includes(m[3])) rows.push(`${m[2]} ${m[4]} (${m[1]})`);
  // A table we can't read: the lead sentence alone ("…the most such games by a forward in team history").
  if (!rows.length) return /[\p{L}\d)]$/u.test(intro) ? `${intro}.` : null;
  return `${intro}: ${rows.slice(0, 6).join("; ")}.`;
}

export function readHistory(doc, players = [], { seasonStart = null, today = null, teamWords = [], oppWords = [], box = null, dropped = null, tris = [] } = {}) {
  const drop = (reason, text) => { if (dropped) dropped.push({ reason, text }); };
  // STRICT (11/12, after the user's review): a line is kept only if it says WHO (a player on the team as
  // the subject, or the team itself) and it is CURRENT (dated this season, says "this season", or looks
  // ahead). Unnamed lines, old facts (2016 draft, April 2026, a 2021 franchise table) and background
  // (draft trivia, college) are dropped, not just ranked lower.
  const plain = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const full = players.filter((p) => p.name).map((p) => {
    const n = plain(p.name);
    const last = n.split(" ").filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w)).pop();
    return { ...p, re: new RegExp(`\\b${esc(n)}\\b`, "i"), last };
  });
  const lastCount = {};
  for (const p of full) lastCount[p.last.toLowerCase()] = (lastCount[p.last.toLowerCase()] || 0) + 1;
  // The subject: the player's full name near the start (within 40 characters), or a sentence that opens
  // with his (unique) last name ("Mobley is...", "Jerome, who..."). A name later in the sentence is a
  // mention, not the subject ("...his teammates Matas Buzelis and Tyler Smith" is not about Tolu Smith).
  const subjectOf = (t) => {
    const x = plain(t);
    let best = null, at = 1e9;
    for (const p of full) {
      const m = p.re.exec(x);
      // "Passed Nikola Vučević...", "joining Allen Iverson": a name right after such a word is the object, not the subject.
      if (m && m.index <= 40 && m.index < at && !OBJECT_BEFORE.test(x.slice(0, m.index))) { best = p; at = m.index; }
    }
    if (best) return best;
    const lead = full.find((p) => lastCount[p.last.toLowerCase()] === 1 && new RegExp(`^(?:The\\s+)?${esc(p.last)}(?:['’]s)?\\b`).test(x));
    if (lead) return lead;
    // "Through Nov. 8, Kessler led…": a unique last name early in the sentence, not as an object.
    let near = null; at = 1e9;
    for (const p of full) {
      if (lastCount[p.last.toLowerCase()] !== 1 || p.last.length < 4) continue;
      const m = new RegExp(`(?<![\\p{L}])${esc(p.last)}(?:['’]s)?(?![\\p{L}])`, "u").exec(x);
      // The words before it, less a first name ("Passed Kevin Durant": "Passed" makes Durant the object).
      const pre = m ? x.slice(0, m.index).replace(/\p{Lu}[\p{L}'’.\-]*\s+$/u, "") : "";
      if (m && m.index <= 30 && m.index < at && !OBJECT_BEFORE.test(pre) && !OBJECT_BEFORE.test(x.slice(0, m.index)) && !/\b(?:and|&|with)\s+$/.test(pre)) { near = p; at = m.index; }
    }
    return near;
  };
  const teamRe = teamWords.length ? new RegExp(`^(?:The\\s+)?(?:${teamWords.map(esc).join("|")})\\b`) : null;
  // The team as the subject later in the sentence ("Despite…, the Wizards have been blocked the least…", "Per Sportradar,
  // Washington joins…", "16.2% of the Wizards' field goals"), but not as an object ("vs. Washington", "beat the Wizards").
  const teamMid = teamWords.length ? new RegExp(`(?<!\\b(?:vs\\.?|against|at|over|to|beat|beating|from|host|hosts|visit|visits)\\s+(?:the\\s+)?)\\b(?:${teamWords.map(esc).join("|")})(?:(?:['’]s?)\\s|\\s+(?:currently\\s+|also\\s+|now\\s+)?(?:have|has|had|is|are|joins|join|lead|leads|rank|ranks|own|owns|became|sit|sits)\\b)`) : null;
  const oppRe = oppWords.length ? new RegExp(`\\b(?:${oppWords.map(esc).join("|")})\\b`) : null;
  const caps = (t) => plain(t).replace(/[^A-Za-z ]+/g, " ").replace(/\s+/g, " ");
  const pad = (n) => String(n).padStart(2, "0");
  const lastOnOrBefore = (mo, d) => {
    if (!today) return seasonStart; // no reference day: assume this season, as before
    const y = +today.slice(0, 4), iso = `${y}-${pad(mo)}-${pad(d)}`;
    return iso > today ? `${y - 1}-${pad(mo)}-${pad(d)}` : iso;
  };
  const undated = (t) => [
    ...[...t.matchAll(/(?<![\/\d])(\d{1,2})\/(\d{1,2})(?![\/\d])/g)].filter((m) => +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31).map((m) => lastOnOrBefore(+m[1], +m[2])),
    ...[...t.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*[-–]\s*\d{1,2},?\s*(?:19|20)\d\d)(?!,?\s*(?:19|20)\d\d)/g)].map((m) => lastOnOrBefore(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) / 3 + 1, +m[2])),
  ].filter(Boolean);
  const datesOf = (s) => [...s.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g)].map((m) => { const y = m[3].length === 2 ? (+m[3] > 50 ? 1900 : 2000) + +m[3] : +m[3]; /* "1/29/88" is 1988 */ return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; })
        .concat([...s.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2})?,?\s+((?:19|20)\d\d)\b/g)].map((m) => `${m[3]}-${String(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) / 3 + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`))
        .concat([...s.matchAll(/(\b(?:since|than|before|until|in NBA history since)\s+(?:the\s+)?(?:\w+\s+)?)?\b((?:19|20)\d\d)(?:-\d\d)?\b(?!\/)/g)].filter((m) => !m[1]).map((m) => `${m[2]}-${/-\d\d/.test(m[0]) ? "12-31" : "06-30"}`))
    .concat(undated(s)); // "on 11/9", "Nov. 4": the latest such date on or before today ("11/26" on 11/12 is last season's)
  const byId = Object.fromEntries(full.map((p) => [String(p.id), p]));
  const out = [], seen = new Set();
  let sectionWho = null, sectionPage = null; // the player whose part of the page this is: the last one named on it
  // A player's heading and his bullets can be separate blocks ("KYSHAWN GEORGE • Was selected… • Leads all… • Is one of
  // five…"): the paragraph's player carries to the next block on the page, within the same distance as inside one (0.48).
  let carry = null;
  for (const b of blocks(doc)) {
    if (b.page !== sectionPage) { sectionWho = null; sectionPage = b.page; }
    // Player-bio headers ("# 7 GIANNIS ANTETOKOUNMPO FORWARD…", "#5 Paolo Banchero (F, 6-10…"): everything after one,
    // up to the next, is about that player, however far down the page it runs.
    const bios = [];
    for (const m of plain(b.text).matchAll(/#\s?\d{1,2}\s+([A-Za-z][A-Za-z'’.\-]+(?:\s+[A-Za-z][A-Za-z'’.\-]+){1,3})/g)) {
      const words = m[1].toUpperCase();
      const p = full.find((q) => { const n = caps(q.name).trim().toUpperCase().replace(/ (JR|SR|II|III|IV)$/, ""); return n.length > 4 && caps(words).toUpperCase().startsWith(n); });
      if (p) bios.push({ at: m.index, p });
    }
    const blockBio = bios.length ? bios[bios.length - 1].p : null; // the last player header in this block
    let cursor = 0, bioWho = null;
    let prevRaw = null; // the sentence before, for "That's the fifth-most…" and "They have…"
    let paraWho = null, sinceWho = 0, lastWhen = null;
    let paraHead = false; // paraWho came from a capitals heading (a player's list of bullets), not from a sentence naming him
    if (carry && carry.page === b.page && carry.bio) { bioWho = paraWho = sectionWho = carry.who; sinceWho = 0; paraHead = true; }
    else if (carry && carry.page === b.page && carry.dist <= 700) { paraWho = carry.who; sinceWho = carry.dist; paraHead = true; }
    const keep = () => { carry = paraWho && paraHead ? { who: paraWho, page: b.page, dist: sinceWho, bio: !!(bioWho && paraWho === bioWho) } : null; }; // lastWhen: "old" / "current" for the paragraph's last dated sentence // chars of text since paraWho was named // the player this paragraph is about, for its "He..." sentences
    for (let s of sentences(b.text).flatMap((x) => x.split(/\s+(?=(?:[\p{Lu}0-9\/’'&.\-]{2,}\s+)*[\p{Lu}0-9\/’'&.\-]{3,}:\s+\p{Lu}|#\s?\d{1,2}\s+\p{Lu})/u).flatMap((y) => y.split(/\s*(?:…|\.{3}|[▪●•]|\s[o◦▫]\s(?=[A-Z]))\s*/).map((z, k, all) => { let w = k > 0 && /^[a-z]/.test(z) ? z[0].toUpperCase() + z.slice(1) : z; if (k < all.length - 1 && /[\p{L}\d%)]$/u.test(w) && !/\b(?:to|the|a|an|of|and|at|in|with|as|by|for|or|his|their|from|on|was|were|who|that|is|are|which)$/i.test(w)) w += "."; return w; }))).map((x) => x.replace(/\s*\*{2,}.*$/, "").trim())) {
      sinceWho += s.length + 1;
      { const at = b.text.indexOf(s.slice(0, 25), cursor); if (at >= 0) cursor = at; }
      while (bios.length && bios[0].at <= cursor + 5) { bioWho = paraWho = sectionWho = bios.shift().p; sinceWho = 0; lastWhen = null; }
      // An infographic table printed into the sentence that follows it ("…3 NEW ORLEANS 53.6 Despite having the sixth-most…",
      // "…SERIES NOTES Detroit took the first game…"): keep the prose after the last run of capitals.
      if (s.length < 1500 && (!/^[\p{Lu}"“]/u.test(s) || /^\d/.test(s) || TABLEY.test(s) || CAPS_PAIR.test(s))) {
        const m = s.match(/^.*(?:[\p{Lu}0-9.,%\/’'&#+:()\-]{2,}\s+){2,}(?=\p{Lu}\p{Ll}+[\s,'’])/u);
        if (m && s.length - m[0].length >= 40 && /\d|(?:\S+\s+){3}/.test(m[0])) s = s.slice(m[0].length);
      }
      s = s.replace(/(?:\s+[@#][A-Za-z0-9_]{3,})+$/, ""); // the PR account's handle at the end of an infographic page
      // A feature box's table, read into one line (0.62).
      let tableLine = false;
      { const t = summarizeTable(s, tris); if (t) { s = t; tableLine = true; } }
      // The next table's title after the sentence: three or more capitals words, no brackets ("…vs. CHA (5-9 3FG))." stays).
      // (One space between words: an optional one lets a long run of capitals split many ways, which never finishes.)
      s = s.replace(/(?<!\bvs)([.!?])\s+(?:\p{Lu}[\p{Lu}0-9.,%\/’'&#+:\-]+\s+){2,}\p{Lu}[\p{Lu}0-9.,%\/’'&#+:\-]+\s*$/u, "$1");
      if (s.length < 40) { const w = subjectOf(s); if (w) { paraWho = sectionWho = w; sinceWho = s.length + 1; if (bioWho && w !== bioWho) bioWho = null; } continue; }
      if (s.length > 420) continue;
      // A capitals heading glued to the sentence ("ANTHONY DAVIS Logged..."): dropped; if it is a player's name, it is the subject.
      let headWho = null;
      const hm = s.match(/^((?:[\p{Lu}0-9’'&.\-\/:]{2,}\s+){0,8}?[\p{Lu}0-9’'&.\-\/]{2,}):?\s+(?=\p{Lu}\p{Ll})/u);
      // One capitals word is a heading too ("SHARPE Assists per game…", "DEBUT: Scored…"), unless it's an abbreviation ("NBA", "LA").
      if (hm && !(/^\S+$/.test(hm[1]) && new RegExp(`^(?:${ABBR})$`).test(hm[1]))) {
        const h = caps(hm[1]).trim().toUpperCase();
        headWho = full.find((p) => { const n = caps(p.name).trim().toUpperCase().replace(/ (JR|SR|II|III|IV)$/, ""); return n.length > 4 && h.includes(n); })
          || full.find((p) => lastCount[p.last.toLowerCase()] === 1 && p.last.length >= 4 && new RegExp(`(?:^| )${esc(caps(p.last).trim().toUpperCase())}(?: |$)`).test(h)) || null;
        s = s.slice(hm[0].length);
        if (s.length < 40) continue;
      }
      // "That's the fifth-most over the first 17 games…" says nothing alone: read it with the sentence before.
      const prevNow = prevRaw;
      prevRaw = s;
      // (The line before is replaced only if the joined one is kept.)
      let joinedFrom = null;
      if (prevNow && /^(?:That['’]s|That is|This is|That ranks|This ranks|That marks|It['’]s)\b/.test(s) && prevNow.length + s.length < 420) {
        joinedFrom = prevNow;
        s = `${prevNow} ${s}`;
      }
      const they = /^They\b/.test(s) && !!prevNow && !!((teamRe && teamRe.test(plain(prevNow))) || (teamMid && teamMid.test(plain(prevNow))));
      // Who this part of the paragraph is about, noted before any filter drops the sentence.
      { const named = subjectOf(s), early = named || headWho; if (early) { paraWho = sectionWho = early; sinceWho = s.length + 1; paraHead = !named; if (bioWho && early !== bioWho) bioWho = null; } }
      keep();
      // A span of seasons running through last season ("each of the past three seasons (2023-26)") is a run still going, not an old date.
      const core = s.replace(SINCE_CLAUSE, "").replace(/\b((?:19|20)\d\d)-(\d\d)\b/g, (m, a, b) => (seasonStart && +b - +a.slice(2) >= 2 && 2000 + +b >= +seasonStart.slice(0, 4) ? "these seasons" : m));
      const ownDates = seasonStart ? datesOf(core) : [];
      const prevWhen = lastWhen;
      if (ownDates.length) lastWhen = ownDates.some((d) => d >= seasonStart) ? "current" : "old";
      // A capitals heading starting the next item mid-sentence: cut there.
      if (!tableLine) s = s.replace(/\s+(?:[\p{Lu}0-9\/’'&.\-]{2,}\s+)*[\p{Lu}0-9\/’'&.\-]{3,}:\s.*$/u, "").trim();
      if (s.length < 40) continue;
      // Splices and table fragments: stat-table labels with numbers, stat lines, runs of capitals,
      // a start that isn't a capitalised word, unbalanced brackets, a sentence that stops mid-thought.
      if (!/^[\p{Lu}"“]/u.test(s) || /^\d|^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.? \d/.test(s)) { drop("start", s); continue; }
      if (TABLEY.test(s) && !tableLine) { drop("tabley", s); continue; }
      // Two capitals words in a row that aren't common abbreviations: a table or heading spliced in ("his seventh MOST DOUBLE-DOUBLES double-double").
      if (CAPS_PAIR.test(s) && !tableLine) { drop("caps-pair", s); continue; }
      // A stat sidebar's cells read into the line ("FTA 12 at HOU 22 at PHI 11/30/25", "OREB 2 11/9 @ TOR (3x)", "…Career vs. New York Knicks record…").
      if (!tableLine && (/\b(?:FTA|FGA|OREB|DREB|REB|AST|PTS|STL|BLK|3PM|FGM|FTM)\s+\d+\s+(?:at|vs\.?|@|\d)/.test(s) || /\d\s+\(\d+x\)|\(\d+x\)\s+\d/.test(s) || /\bCareer vs\. \p{Lu}/u.test(s.slice(1)))) { drop("splice", s); continue; }
      // Two columns read into one line ("…in NBA history. offensive rebounding (3.5 per).", "…game on 11/6. with at least…").
      if (/(?:\p{L}{5,}|\d|\)|%)\. (?!(?:\d|vs\b|[A-Z]))\p{Ll}/u.test(s.replace(/\b(?:vs|No|Jr|Sr|St|approx|per|pts|reb|ast)\. /g, "$&").replace(/\b(?:[A-Z]|vs|No|Jr|Sr|St)\. \p{Ll}/gu, ""))) { drop("splice", s); continue; }
      // A table cell read twice ("Luka DoncicLuka Doncic 5252").
      if (/(\p{Lu}[\p{L}'’\-]+ \p{Lu}[\p{L}'’\-]+)\1/u.test(s) || /\b(\d{2,3})\1\b/.test(s)) continue;
      const open = (s.match(/\(/g) || []).length, close = (s.match(/\)/g) || []).length;
      if (open !== close || !/[.!?)"”]$/.test(s) || /\b(?:to|the|a|of|and|at|in|with|as|by|for)\s*$/i.test(s) || (!tableLine && (s.match(/\(\d{1,3}\)/g) || []).length >= 2)) { drop("unfinished", s); continue; }
      if (/Notes\/Trends|Video Highlights|Season Stats|\bGP \d|PPG \d|\(cont\.?\)/i.test(s)) { drop("box-header", s); continue; }
      if (s.replace(/[^0-9]/g, "").length / s.length > (tableLine ? 0.5 : /\b\d{1,3}-\d{1,3} when\b/.test(s) ? 0.32 : 0.22)) { drop("numbers", s); continue; }
      // Past tense isn't a look ahead ("was the first ... with 200 3PM within 60 games").
      const fwd = FORWARD.test(s) && !/^(?:\S+\s+){0,4}?(?:was|were|became|had)\b/.test(s), hist = HISTORY.test(s), ctxHit = CONTEXT.test(s), trendHit = TREND.test(s);
      if (SCHEDULE.test(s)) { drop("schedule", s); continue; }
      if (!fwd && !hist && !ctxHit && !trendHit && !tableLine) { drop("no-signal", s); continue; }
      if (NOT_NBA.test(core) || /\b(?:drafted|draft pick|overall pick|picked \w+(?: overall)?|NBA Draft|Draft Lottery|transferr|left the [A-Z]\w+|(?:with|for) the [A-Z][a-z]+ (?:from|in) (?:19|20)\d\d|All-(?:Big|ACC|SEC|Pac|American)|Ignite|Jayhawks|collegiate)\b/i.test(core)) { drop("background", s); continue; } // background
      const key = plain(s).toLowerCase().replace(/[^a-z0-9]+/g, ""); // "150-plus" and "150plus" are the same line
      if (seen.has(key)) continue;
      seen.add(key);
      // WHO.
      // The sentence's own subject outranks the heading above it; a heading's player is not credited with a
      // sentence that opens with someone else's name ("TOLU SMITH Ron Holland became...").
      let own = subjectOf(s) || subjectOf(s.replace(SINCE_CLAUSE, ""));
      if (!own && tableLine) { const lead = plain(s.split(":")[0]); own = full.find((p) => p.re.test(lead) && !OBJECT_BEFORE.test(lead.slice(0, lead.search(p.re)))) || null; }
      if (!own) {
        const th = plain(s).match(/\bthan\s+(\p{Lu}[\p{L}'’.\-]+(?:\s+\p{Lu}[\p{L}'’.\-]+)?)\s*[.!]?$/u);
        const nm = th && th[1].replace(/\.$/, "");
        if (th && /\bonly\b/.test(s)) own = full.find((p) => p.re.test(nm)) || full.find((p) => lastCount[p.last.toLowerCase()] === 1 && p.last === nm.split(/\s+/).pop()) || null;
      }
      const otherName = !own && headWho && /^\p{Lu}[\p{Ll}'’]+(?:\s+\p{Lu}[\p{Ll}'’.]+){1,2}(?:\s+(?:Jr\.?|Sr\.?|II|III|IV))?,?\s+\p{Ll}/u.test(s);
      if (otherName) { drop("heading-other-name", s); continue; }
      const subj = own || headWho;
      if (subj) { paraWho = sectionWho = subj; sinceWho = s.length + 1; if (bioWho && subj !== bioWho) bioWho = null; }
      // A sentence that opens with "He…" or a bare verb ("Became…", "Passed Nikola Vučević…") is about the
      // player of its paragraph, or failing that of its part of the page.
      const pronoun = /^(?:He|His|The \d{2}-year-old|The rookie|The (?:guard|forward|center|big man|veteran|sophomore))\b/.test(s);
      const verbLed = /^(?:Had|Hit|Shooting|Shot|Along with|Since|Became|Becomes|Recorded|Records|Logged|Set|Sets|Tied|Ties|Joined|Joins|Passed|Scored|Posted|Notched|Tallied|Grabbed|Dished|Made|Hit|Owns|Holds|Ranks|Leads|Led|Moved|Reached|Surpassed|Eclipsed|Needs|Is|Has|Was|Averag\w+|Finished|Registered|Matched|Broke|Earned|Collected|Totaled|Pulled down|Handed out|Knocked down|Connected)\b/.test(s);
      let who = subj, how = own ? "named" : headWho ? "heading" : null;
      if (!who && (pronoun || verbLed || (bioWho && paraWho === bioWho))) {
        // Close to the sentence that named him (a player-info page can hold two players' columns).
        if (bioWho && paraWho === bioWho) { who = bioWho; how = "bio"; }
        else if (paraWho && sinceWho <= 700) { who = paraWho; how = "paragraph"; }
        else if (paraWho) { who = paraWho; how = "section"; }
        else if (sectionWho) { who = sectionWho; how = "section"; }
      }
      // A coach's or front office's line on a player's page is not the player's.
      if (who && how !== "named" && how !== "heading" && /\b(?:coach\w*|his teams|under his|front office|general manager|GM|victories|wins (?:as|with)|\d+ wins\b)/i.test(s)) { drop("staff-line", s); continue; }
      // WHEN. Dates in the sentence decide; "since 1973-74" and "since 2015" are comparisons, not when.
      const dates = datesOf(core);
      const thisSeason = seasonStart ? dates.some((d) => d >= seasonStart) : false;
      // A real day this season ("10/21", "Nov. 6"), not just a season label like "2026-27" spliced in from a table.
      const dayThisSeason = seasonStart ? undated(s).concat([...s.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g)].map((m) => `${m[3].length === 2 ? 2000 + +m[3] : +m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`)).some((d) => d >= seasonStart) : false;
      // "(12.8 per overall; 25th w/11.5 in 2025-26)": last season as the comparison for a stretch this season, not the line's date.
      const datedOld = dates.length && seasonStart && !thisSeason && !(trendHit && /\b(?:past|last|first) \d+ (?:games|GP)\b|\bthis season\b/i.test(s));
      if (datedOld) { drop("dated-old", s); continue; }
      // "On Dec. 23, 2025… He is now the first rookie…": an undated follow-on sentence belongs to the date before it.
      if (!dates.length && how && how !== "named" && how !== "heading" && prevWhen === "old" && !/\b(?:this season|active streak|longest active)\b/i.test(s)) { drop("follows-old", s); continue; }
      // The box scores: a line's single-game numbers ("30 points, 14 rebounds… vs. WAS (10/24)") match a game
      // a player of ours had this season → that's who, and it's current. Numbers credited to a player who never
      // had that game → not this season's (if he was named) or not his (if he was inferred).
      const chk = box ? checkLine(box, s, { namedId: who ? String(who.id) : null, dates: dates.filter((d) => !seasonStart || d >= seasonStart) }) : { named: null, who: null };
      let boxCurrent = false, boxOld = false;
      if (chk.named === "yes") boxCurrent = true;
      else if (chk.named === "no") {
        if (how === "named" || how === "heading") boxOld = true;
        else if (chk.who && byId[chk.who]) { who = byId[chk.who]; how = "box"; boxCurrent = true; }
        else { drop("box-mismatch", s); continue; }
      } else if (!who && chk.who && byId[chk.who]) { who = byId[chk.who]; how = "box"; boxCurrent = true; }
      // "The last player named on this page" is right too often to ignore and wrong too often to trust
      // (Brandon Miller's line credited to Kon Knueppel): only with a box score that agrees.
      if (how === "section" && chk.named !== "yes") { drop("section-unconfirmed", s); continue; }
      // Series lines are about tonight's opponent only (notes keep the last opponent's series page around).
      if (SERIES.test(s) && oppRe && !oppRe.test(plain(s)) && !/\bthis season['’]s series\b/i.test(s)) { drop("other-series", s); continue; }
      // A table row read into prose ("Domantas Sabonis 413 which ranks sixth…").
      if (/^\p{Lu}[\p{L}'’.\-]+(?:\s+\p{Lu}[\p{L}'’.\-]+){1,2}\s+\d[\d,]*\s+(?:which|that|is|ranks)\b/u.test(s)) { drop("table-row", s); continue; }
      const matchup = SERIES.test(s) || (!!oppRe && oppRe.test(plain(s)) && ctxHit);
      // A team-stats box: "Rockets Offense ➢ Averaging 108.0 ppg over the past 5 games…" (the team named in the heading just above).
      const teamHead = !who && verbLed && teamWords.length && new RegExp(`\\b(?:${teamWords.map(esc).join("|")})\\b`).test(plain(b.text.slice(Math.max(0, cursor - 120), cursor)));
      const team = !who && (teamHead || (teamRe && teamRe.test(plain(s))) || ((ctxHit || trendHit || tableLine) && teamMid && teamMid.test(plain(s))) || they || (matchup && SERIES.test(s)));
      if (!who && !team) { drop("no-who", s); continue; }
      const kind = fwd ? (PASSY.test(s) ? "pass" : "next") : hist ? "record" : ctxHit ? "context" : "trend";
      if (boxOld && !thisSeason && !CURRENT.test(s)) { drop("box-not-this-season", s); continue; }
      // "the first … to record at least 40 PTS and 15 REB in a game": if he had such a game this season, it's this season's.
      if (!boxCurrent && !thisSeason && who && box) {
        const ths = thresholdClaims(s);
        if (ths.length >= 2 || (ths.length === 1 && ths[0].min >= 10)) {
          const g = meetsThresholds(box, String(who.id), ths);
          if (g) { boxCurrent = true; chk.game = chk.game || g; }
        }
      }
      // A standing fact in the present tense ("Giddey has recorded six games of 15-plus assists…, tied for fourth-most in
      // team history", "Duren has the 4th-highest field goal percentage…"): true as of tonight, whoever's notes say it.
      const standing = !!who && /^(?:[\p{Lu}][\p{L}'’.\-]*\s+){0,3}(?:\([^)]*\)\s+)?(?:also\s+|now\s+|currently\s+|still\s+)?(?:is|ranks|has|holds|owns|sits|leads|remains|stands|extends|trails)\b/u.test(core.replace(/^(?:He|She)\s+/, "X "))
        || (!!who && /^(?:Is|Ranks|Has|Holds|Owns|Sits|Leads|Remains|Stands|Extends|Trails)\b/.test(core));   // a box's bullet with no name: "Ranks 10th in NBA in 3FG%"
      // A series run still going ("has won each of the past two season series", "won eight of the last 12 meetings") is current.
      const seriesRun = matchup && /\b(?:each of the (?:past|last)|(?:past|last) (?:\w+ )?(?:season series|meetings)|straight (?:meetings|games against))\b/i.test(s);
      // League context in the present tense ("They have the highest rate…", "Davis owns the most blocks…") is as of tonight.
      const presentCtx = (kind === "context" || kind === "trend" || ctxHit) && /\b(?:is|are|has|have|leads?|ranks?|owns?|sits?|remains?|holds?|joins?)\b/.test(core);
      const current = thisSeason || boxCurrent || standing || seriesRun || presentCtx || CURRENT.test(s) || (kind !== "record" && kind !== "context");
      if (!current) { drop("not-current", s); continue; }
      // In the regular season before April, a postseason, an All-Star break or a games count past tonight's is last season's.
      if (today && !dayThisSeason && !thisSeason) {
        const mo = +today.slice(5, 7), gp = box && Array.isArray(box.games) ? box.games.length : null;
        const past = (mo >= 10 || mo <= 3) && /\b(?:postseason|playoffs?|play-in|(?:Western|Eastern) Conference (?:Semifinals|Finals)|Conference (?:Semi)?[Ff]inals|WCF|ECF|NBA Finals|First Round|Game [1-7] (?:at|vs\.?|of)|post All-Star break|(?:after|before|since) the All-Star break|all 82)\b/.test(s) && !/\b(?:appearances|titles|championships|series wins)\b/i.test(s);
        const nOver = gp != null && [...s.matchAll(/\b(?:through|first|in(?: his| their)? first|over (?:his|their) first) (\d{2,3}) games\b/gi)].some((m) => +m[1] > gp + 2 && !/career|history|with the team|with (?:the )?\p{Lu}\w+|as a \p{Lu}|uniform/u.test(s.slice(Math.max(0, m.index - 20), m.index + m[0].length + 30)));
        if (past || nOver) { drop("last-season", s); continue; }
      }
      const stretchNow = trendHit && /\b(?:past|last|first) \d+ (?:games|GP)\b|\bthis season\b/i.test(s);   // last season only as the comparison
      if (!stretchNow && OLDER.test(core.replace(/\b(?:back to|dating back to|going back to|since|including|over) last season\b/gi, "these seasons")) && !dayThisSeason) { drop("older", s); continue; }
      const score = (kind === "pass" ? 3 : kind === "next" ? 2.4 : kind === "trend" ? 1.8 : 2) + (thisSeason || CURRENT.test(s) ? 1 : 0) + (/in NBA history|all-time|since 19\d\d|first (?:player|rookie|team)/i.test(s) ? 0.8 : 0) - (how === "section" ? 0.3 : 0);
      if (joinedFrom && out.length && out[out.length - 1].text === joinedFrom) out.pop();
      out.push({ page: b.page, text: s, kind, player: who?.name || null, playerId: who?.id || null, team: !!team, matchup, how: who ? how : matchup && !team ? "series" : "team", resolved: !subj && !!who, boxGame: chk.game || null, when: "season", score: Math.round(score * 100) / 100 });
    }
    // A player's box header printed at the end of the block before his notes ("…W115-108 Center #28 Alperen Sengun 6-11/255"):
    // his notes are the next block, after the header's "•" (Houston, 11/13).
    if (blockBio) carry = { who: blockBio, page: b.page, dist: 0, bio: true };
  }
  // The same forward fact printed twice ("needs 816 points to pass Kobe Bryant"): keep one.
  const fwdKey = (t) => { const m = t.match(/needs?\s+([\d,]+)\s+([a-z-]+(?:\s+[a-z-]+)?)\s+to\s+(?:pass|tie|surpass)\s+([A-Z][^.,]{2,40}?)(?=\s+for|[.,]|$)/i); return m ? m.slice(1).join('|').toLowerCase() : null; };
  const kept = new Set();
  // A line printed twice, once naming the player and once not ("Brandon Miller logged…" / "Logged…"): keep the named one.
  const tail = (t) => plain(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(-60);
  const namedTails = out.filter((x) => x.how === "named" || x.how === "heading").map((x) => tail(x.text));
  return out
    .filter((x) => x.how === "named" || x.how === "heading" || x.how === "team" || x.how === "bio" || !namedTails.some((t) => t.length >= 40 && (t.endsWith(tail(x.text).slice(-40)) || tail(x.text).endsWith(t.slice(-40)))))
    .filter((x) => { const k = fwdKey(x.text); if (!k) return true; if (kept.has(k)) return false; kept.add(k); return true; })
    // The same game written up twice ("Dončić recorded 45 points, 15 rebounds…" / "TORONTO, NOV. 1: Dončić finished with 45 points, 15 rebounds…").
    .filter((x) => {
      const c = statClaims(x.text);
      if (!x.playerId || c.length < 3) return true;
      const k = `${x.playerId}|${c.map((y) => y.stat + y.n).sort().join(",")}`;
      if (kept.has(k)) return false; kept.add(k); return true;
    });
}
