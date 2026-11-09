/**
 * Stat names as the teams print them -> one canonical key.
 * Teams write the same stat many ways ("3FG", "3FGM", "3PT", "3- POINTERS MADE",
 * "Three-pointers", "free-throws made"); everything downstream compares
 * canonical keys only.
 */

const TABLE = [
  ["pts", /^(pts|points?( scored)?|scoring)$/],
  ["reb", /^(reb|trb|treb|rebounds?|total rebounds?|boards?)$/],
  ["oreb", /^(oreb|offensive rebounds?)$/],
  ["dreb", /^(dreb|defensive rebounds?)$/],
  ["ast", /^(ast|assists?)$/],
  ["stl", /^(stl|steals?)$/],
  ["blk", /^(blk|blocks?|blocked shots?)$/],
  ["fg3m", /^(3fg|3fgm|3pt|3pm|3p|3 ?pt fg made|3 ?pointers?( made)?|three ?pointers?( made)?|3 ?point field goals?( made)?)$/],
  ["fgm", /^(fgm|fg|field goals?( made)?|made field goals?)$/],
  ["ftm", /^(ftm|ft|free throws?( made)?|made free throws?)$/],
  ["gp", /^(gp|games?( played)?)$/],
  ["gs", /^(gs|starts|games started)$/],
  ["min", /^(min|mins|minutes)$/],
  ["dd", /^(dbl dbl|dd|double doubles?)$/],
  ["td", /^(trpl dbl|td|triple doubles?)$/],
];

export const STAT_LABEL = {
  pts: "points", reb: "rebounds", oreb: "offensive rebounds", dreb: "defensive rebounds",
  ast: "assists", stl: "steals", blk: "blocks", fg3m: "3-pointers", fgm: "field goals",
  ftm: "free throws", gp: "games", gs: "starts", min: "minutes", dd: "double-doubles", td: "triple-doubles",
};

/** @returns {string|null} canonical key, or null if unrecognized */
export function normStat(raw) {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/(\d)\s*-\s*/g, "$1 ") // "3- pointers", "3-pointers" -> "3 pointers"
    .replace(/-/g, " ")             // "free-throws", "double-doubles"
    .replace(/\s+/g, " ")
    .replace(/[.:]+$/, "")
    .trim();
  for (const [key, re] of TABLE) if (re.test(s)) return key;
  return null;
}

/**
 * Words that make a list a *subset* ("Hawks Centers Assists Leaders", "2020 NBA
 * Draft Blocks Leaders", "Career Bench Scoring", "Class of 2021"). A chase on
 * such a list is real but must be worded with the qualifier, so it is never
 * published automatically.
 */
const QUALIFIER = /\b(centers?|guards?|forwards?|point guards?|bench|reserves?|off the bench|sixth man|draft(ed)?|class of|rookies?|undrafted|active|international|foreign|teenagers?|age \d+|\d+ or younger|before (turning )?\d+|through (the first )?\d+ games|first \d+ games|since (19|20)\d\d|per game|\/ ?(game|gm)|per 36|per 100|playoffs?|postseason|home|road|vs\.? |against|when|with (him|her)|under|month)\b/i;
export function qualifierOf(title) {
  const m = String(title || "").match(QUALIFIER);
  return m ? m[0].trim() : null;
}

/**
 * Which stat a leaderboard title is about: "POINTS (7-10 RANKING)",
 * "MOST BLOCKS IN CAVS HISTORY (4-7) BLK", "# OF 30-PT GAMES", "SPURS, 3 PT FG MADE".
 * Returns a canonical key ("pts", "g30pt" for 30-point games, "list" for a
 * compound list that keeps its own title) or null.
 */
export function statFromTitle(title) {
  const t = String(title || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const direct = normStat(t.replace(/^[a-z]+,\s*/, "").replace(/^(most|career|all[- ]time)\s+/, ""));
  if (direct) return direct;
  const games = t.match(/^(?:# of |number of |most )?(\d{2})[- ]?(?:pt|point)s? games?$/);
  if (games) return `g${games[1]}pt`;
  // Compound lists ("games with 5+ 3PM in season", "consecutive games w/ a
  // 3-pointer", "points per game", "Points/Game") are not a plain career
  // total: they keep their own title as the stat.
  if (/games? w(ith|\/)|consecutive|\d+\+|first \d+ games|per game|\/ ?(game|gm)|\bppg\b|\brpg\b|\bapg\b|triple-doubles? .*\d|\d+-point triple|bench|percentage|%/.test(t)) return "list";
  const rules = [
    ["fg3m", /\b3\s*-?\s*(pt|point|fg|pm)|three/], ["ftm", /free throw|\bftm\b/], ["fgm", /field goal|\bfgm\b/],
    ["oreb", /offensive reb/], ["dreb", /defensive reb/], ["reb", /rebound|\breb\b/], ["ast", /assist|\bast\b/],
    ["stl", /steal|\bstl\b/], ["blk", /block|\bblk\b/], ["td", /triple[- ]double/], ["dd", /double[- ]double/],
    ["gs", /games started/], ["gp", /games played|\bgp\b/], ["min", /minutes/], ["pts", /points|\bpts\b|scor/],
  ];
  for (const [k, re] of rules) if (re.test(t)) return k;
  return null;
}

export function statLabel(key) {
  if (STAT_LABEL[key]) return STAT_LABEL[key];
  const g = String(key).match(/^g(\d+)pt$/);
  return g ? `${g[1]}-point games` : key;
}

/** "1,234" -> 1234, "29.4" -> 29.4; anything else -> null. */
export function num(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Was this value printed with a decimal point ("27.0", "29.4")? */
export const isDecimal = (raw) => /^\d*\.\d+$/.test(String(raw || "").trim().replace(/,/g, ""));

/** "1.944" printed where the rest of the list uses "1,944" style. */
export const looksLikeThousandsTypo = (raw) => /^\d{1,3}\.\d{3}$/.test(String(raw || "").trim());
