/**
 * Odd stat lines (0.117.0; pure). The user, 11/19, with thirteen posts of odd lines: "these are concepts worth
 * tracking and flagging" and "you don't need to check for these players specifically, nor these stats exactly".
 *
 * A template is a rule about the SHAPE of one player's line in one game (one column against another, or against his
 * own average or his position), kept at several levels. The same rules are run over 33 seasons of box scores by
 * tools/odd-games/build-history.mjs (-> src/data/odd-lines-history.json) and over this season's games here, so
 * "how rare" is counted with the rule that flags it.
 *
 * Seven families (claude/odd-games-study.md):
 *   1 all from one source · 2 volume without result, or result without a miss · 3 one column and nothing else ·
 *   4 out of role (position, or his own average) · 5 too much in too little · 6 coincidence lines ·
 *   7 far from his own scoring average.
 *
 * Nothing is cut for being common: every hit is listed, and the grade says how rare it is NOW (per season over the
 * history's last five seasons): rare = at most 1 a season, few = at most 5, monthly = at most 15, common = more.
 *
 * A line: { min, pts, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, reb, ast, stl, blk, tov, pf, starter }.
 * Context x: { pos: "G" | "F" | "C" | null, avg: { pts, reb, ast } | null } where avg is his average in his OTHER
 * games that season and is null unless he has ODD.games of them.
 */
export const ODD = { games: 10, rare: 1, few: 5, monthly: 15, recent: 5, list: 3, nth: 60 };
export const GRADES = ["rare", "few", "monthly", "common"];
export const FAMILY = { 1: "All from one source", 2: "Volume without result", 3: "One column and nothing else", 4: "Out of role", 5: "Too much in too little", 6: "Coincidence", 7: "Far from his average" };

const other = (l) => l.reb + l.ast + l.stl + l.blk;
const five = (l) => [l.pts, l.reb, l.ast, l.stl, l.blk];
const tens = (l) => [l.reb, l.ast, l.stl, l.blk].filter((v) => v >= 10).length;
const r1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const WORDS = [["reb", "rebound"], ["ast", "assist"], ["stl", "steal"], ["blk", "block"]];
// "one assist and no rebound, steal or block" for a line with a single entry in those four columns
const oneOther = (l) => { const has = WORDS.find(([k]) => l[k] > 0), rest = WORDS.filter(([k]) => !(l[k] > 0)).map(([, w]) => w); return `one ${has[1]} and no ${rest.slice(0, -1).join(", ")} or ${rest[rest.length - 1]}`; };
const shot = (l) => `${l.fgm}-for-${l.fga}`;
const L = (k, what, test, say) => ({ k, what, test, say });
// One template at rising levels of one number: steps(["30", "35", "40"], (n) => what, (l, n) => test, say)
const steps = (ns, what, test, say) => ns.map((n) => L(String(n), what(n), (l, x) => test(l, n, x), say));

export const TEMPLATES = [
  // 1. All from one source
  { id: "noft", f: 1, levels: steps([30, 35, 40], (n) => `${n}+ points without a free throw attempt`, (l, n) => l.pts >= n && l.fta === 0, (l) => `${l.pts} points without a free throw attempt`) },
  { id: "ftshare", f: 1, levels: [
    L("60", "15+ points, 60% or more of them free throws", (l) => l.pts >= 15 && l.ftm >= 0.6 * l.pts, (l) => `${l.ftm} of his ${l.pts} points were free throws (${shot(l)} from the field)`),
    L("75", "15+ points, three-quarters or more of them free throws", (l) => l.pts >= 15 && l.ftm >= 0.75 * l.pts, (l) => `${l.ftm} of his ${l.pts} points were free throws (${shot(l)} from the field)`),
    L("2fg", "20+ points on two field goals or fewer", (l) => l.pts >= 20 && l.fgm <= 2, (l) => `${l.pts} points on ${l.fgm === 1 ? "one field goal" : `${l.fgm} field goals`} (${l.ftm}-of-${l.fta} at the line)`),
  ] },
  { id: "nofg", f: 1, levels: steps([8, 10, 12], (n) => `${n}+ points without a field goal`, (l, n) => l.pts >= n && l.fgm === 0, (l) => `${l.pts} points without a field goal (0-for-${l.fga}, ${l.ftm}-of-${l.fta} at the line)`) },
  { id: "all3", f: 1, levels: steps([25, 30, 40], (n) => `${n}+ points with every basket a three`, (l, n) => l.pts >= n && l.fgm > 0 && l.fgm === l.fg3m, (l) => `${l.pts} points without a two-point basket (${l.fg3m} threes, ${l.ftm} free throws)`) },
  { id: "fta", f: 1, levels: steps([20, 25, 30], (n) => `${n}+ free throw attempts`, (l, n) => l.fta >= n, (l) => `${l.fta} free throw attempts (made ${l.ftm})`) },
  // 2. Volume without result, and result without a miss
  { id: "ofg", f: 2, levels: steps([8, 10, 12], (n) => `no field goal on ${n}+ attempts`, (l, n) => l.fgm === 0 && l.fga >= n, (l) => `0-for-${l.fga} from the field`) },
  { id: "o3", f: 2, levels: steps([8, 10, 12], (n) => `0-for-${n} or worse from three`, (l, n) => l.fg3m === 0 && l.fg3a >= n, (l) => `0-for-${l.fg3a} from three`) },
  { id: "brick", f: 2, levels: steps([15, 20, 25], (n) => `${n}+ shots at 20% or worse`, (l, n) => l.fga >= n && l.fgm <= 0.2 * l.fga, (l) => `${shot(l)} from the field`) },
  { id: "ftmiss", f: 2, levels: steps([8, 10, 12], (n) => `${n}+ free throws missed`, (l, n) => l.fta - l.ftm >= n, (l) => `missed ${l.fta - l.ftm} free throws (${l.ftm}-of-${l.fta})`) },
  { id: "perfg", f: 2, levels: steps([8, 10, 12], (n) => `${n}+ field goals without a miss`, (l, n) => l.fgm >= n && l.fgm === l.fga, (l) => `${l.fgm}-for-${l.fga} from the field`) },
  { id: "perft", f: 2, levels: steps([14, 16, 18], (n) => `${n}+ free throws without a miss`, (l, n) => l.ftm >= n && l.ftm === l.fta, (l) => `${l.ftm}-of-${l.fta} at the line`) },
  // 3. One column and nothing else
  { id: "empty", f: 3, levels: [
    L("20near", "20+ points with one rebound, assist, steal or block at most", (l) => l.pts >= 20 && other(l) <= 1, (l) => `${l.pts} points with ${other(l) ? oneOther(l) : "no rebound, assist, steal or block"}`),
    ...steps([15, 20, 25, 30], (n) => `${n}+ points with no rebound, assist, steal or block`, (l, n) => l.pts >= n && other(l) === 0, (l) => `${l.pts} points with no rebound, assist, steal or block`),
  ] },
  { id: "ast0", f: 3, levels: steps([8, 10, 12, 15], (n) => `${n}+ assists and no points`, (l, n) => l.pts === 0 && l.ast >= n, (l) => `${l.ast} assists and no points (0-for-${l.fga})`) },
  { id: "reb0", f: 3, levels: steps([12, 15, 20], (n) => `${n}+ rebounds and no points`, (l, n) => l.pts === 0 && l.reb >= n, (l) => `${l.reb} rebounds and no points (0-for-${l.fga})`) },
  { id: "min0", f: 3, levels: steps([30, 36, 42], (n) => `${n}+ minutes and no points`, (l, n) => l.pts === 0 && l.min >= n, (l) => `${l.min} minutes without a point (0-for-${l.fga})`) },
  { id: "noshot", f: 3, levels: steps([24, 30, 36], (n) => `${n}+ minutes without attempting a shot`, (l, n) => l.fga === 0 && l.min >= n, (l) => `${l.min} minutes without attempting a field goal`) },
  { id: "noshotbig", f: 3, levels: [L("1", "15+ rebounds, 10+ assists, 4+ steals or 5+ blocks without attempting a shot", (l) => l.fga === 0 && (l.reb >= 15 || l.ast >= 10 || l.stl >= 4 || l.blk >= 5),
    (l) => `${l.reb >= 15 ? `${l.reb} rebounds` : l.ast >= 10 ? `${l.ast} assists` : l.stl >= 4 ? `${l.stl} steals` : `${l.blk} blocks`} without attempting a field goal`)] },
  { id: "tov0", f: 3, levels: steps([5, 7], (n) => `${n}+ turnovers and no points`, (l, n) => l.pts === 0 && l.tov >= n, (l) => `${l.tov} turnovers and no points`) },
  { id: "pts0reb", f: 3, levels: steps([30, 40], (n) => `${n}+ points and no rebound`, (l, n) => l.reb === 0 && l.pts >= n, (l) => `${l.pts} points without a rebound`) },
  { id: "blk0reb", f: 3, levels: steps([4, 5], (n) => `${n}+ blocks and no rebound`, (l, n) => l.reb === 0 && l.blk >= n, (l) => `${l.blk} blocks without a rebound`) },
  { id: "nothing", f: 3, levels: steps([12, 15, 20], (n) => `${n}+ minutes with nothing in the box score`, (l, n) => l.min >= n && l.pts + l.fga + l.fta + l.reb + l.ast + l.stl + l.blk + l.tov + l.pf === 0, (l) => `${l.min} minutes with nothing in the box score: no shot, rebound, assist, steal, block, turnover or foul`) },
  // 4. Out of role: by position (ESPN's label for the player), and by his own average
  { id: "greb", f: 4, levels: steps([15, 18, 20], (n) => `a guard with ${n}+ rebounds`, (l, n, x) => x.pos === "G" && l.reb >= n, (l) => `${l.reb} rebounds by a guard`) },
  { id: "cast", f: 4, levels: steps([12, 15], (n) => `a center with ${n}+ assists`, (l, n, x) => x.pos === "C" && l.ast >= n, (l) => `${l.ast} assists by a center`) },
  { id: "gblk", f: 4, levels: steps([5, 6], (n) => `a guard with ${n}+ blocks`, (l, n, x) => x.pos === "G" && l.blk >= n, (l) => `${l.blk} blocks by a guard`) },
  { id: "c3", f: 4, levels: steps([6, 8], (n) => `a center with ${n}+ threes`, (l, n, x) => x.pos === "C" && l.fg3m >= n, (l) => `${l.fg3m} threes by a center`) },
  { id: "reb3x", f: 4, levels: [L("1", "15+ rebounds at three times his average", (l, x) => !!x.avg && x.avg.reb >= 2 && l.reb >= 15 && l.reb >= 3 * x.avg.reb, (l, x) => `${l.reb} rebounds (averages ${r1(x.avg.reb)})`)] },
  { id: "ast3x", f: 4, levels: [L("1", "12+ assists at three times his average", (l, x) => !!x.avg && x.avg.ast >= 1.5 && l.ast >= 12 && l.ast >= 3 * x.avg.ast, (l, x) => `${l.ast} assists (averages ${r1(x.avg.ast)})`)] },
  // 5. Too much in too little
  { id: "quick", f: 5, levels: [
    L("25in20", "25+ points in 20 minutes or fewer", (l) => l.pts >= 25 && l.min <= 20, (l) => `${l.pts} points in ${l.min} minutes`),
    L("20in15", "20+ points in 15 minutes or fewer", (l) => l.pts >= 20 && l.min <= 15, (l) => `${l.pts} points in ${l.min} minutes`),
    L("15in10", "15+ points in 10 minutes or fewer", (l) => l.pts >= 15 && l.min <= 10, (l) => `${l.pts} points in ${l.min} minutes`),
  ] },
  { id: "foulout", f: 5, levels: [12, 8].map((n) => L(String(n), `fouled out in ${n} minutes or fewer`, (l) => l.pf >= 6 && l.min <= n, (l) => `fouled out in ${l.min} minutes`)) },
  { id: "zeromin", f: 5, levels: [L("1", "a box-score entry in 0 minutes", (l) => l.min === 0 && l.pts + l.reb + l.ast + l.stl + l.blk + l.tov + l.pf + l.fga + l.fta > 0,
    (l) => `in the box score without a minute played: ${[[l.pts, "point"], [l.reb, "rebound"], [l.ast, "assist"], [l.stl, "steal"], [l.blk, "block"], [l.tov, "turnover"], [l.pf, "foul"], [l.fga, "shot"], [l.fta, "free throw attempt"]].filter(([v]) => v > 0).map(([v, w]) => `${v} ${w}${v === 1 ? "" : "s"}`).join(", ")}`)] },
  { id: "tov", f: 5, levels: steps([8, 10, 12], (n) => `${n}+ turnovers`, (l, n) => l.tov >= n, (l) => `${l.tov} turnovers`) },
  // 6. Coincidence lines
  { id: "ones", f: 6, levels: [
    L("5", "exactly one point, rebound, assist, steal and block", (l) => five(l).every((v) => v === 1), () => "exactly one point, rebound, assist, steal and block"),
    L("6", "exactly one point, rebound, assist, steal, block and turnover", (l) => five(l).every((v) => v === 1) && l.tov === 1, () => "exactly one point, rebound, assist, steal, block and turnover"),
    L("2s", "exactly two points, rebounds, assists, steals and blocks", (l) => five(l).every((v) => v === 2), () => "exactly two points, rebounds, assists, steals and blocks"),
  ] },
  { id: "x5", f: 6, levels: steps([4, 5], (n) => `${n} or more points, rebounds, assists, steals and blocks`, (l, n) => five(l).every((v) => v >= n), (l) => `${l.pts} points, ${l.reb} rebounds, ${l.ast} assists, ${l.stl} steals and ${l.blk} blocks`) },
  { id: "lowpts", f: 6, levels: [
    L("ra", "10+ rebounds and 10+ assists with under 10 points", (l) => l.reb >= 10 && l.ast >= 10 && l.pts < 10, (l) => `${l.reb} rebounds and ${l.ast} assists with ${l.pts} points`),
    L("ra5", "10+ rebounds and 10+ assists with 5 points or fewer", (l) => l.reb >= 10 && l.ast >= 10 && l.pts <= 5, (l) => `${l.reb} rebounds and ${l.ast} assists with ${l.pts} points`),
    L("dd2", "a double-double with 2 points or fewer", (l) => l.pts <= 2 && tens(l) >= 2, (l) => `a double-double with ${l.pts} points (${l.reb} rebounds, ${l.ast} assists)`),
    L("td", "a triple-double with under 10 points", (l) => l.pts < 10 && tens(l) >= 3, (l) => `a triple-double with ${l.pts} points (${l.reb} rebounds, ${l.ast} assists, ${l.stl} steals, ${l.blk} blocks)`),
  ] },
  { id: "pair", f: 6, levels: [
    L("3oreb6", "6+ threes with 6+ offensive rebounds", (l) => l.fg3m >= 6 && l.oreb >= 6, (l) => `${l.fg3m} threes and ${l.oreb} offensive rebounds`),
    L("3oreb8", "6+ threes with 8+ offensive rebounds", (l) => l.fg3m >= 6 && l.oreb >= 8, (l) => `${l.fg3m} threes and ${l.oreb} offensive rebounds`),
    L("astoreb", "12+ assists with 8+ offensive rebounds", (l) => l.ast >= 12 && l.oreb >= 8, (l) => `${l.ast} assists and ${l.oreb} offensive rebounds`),
    L("astblk10", "10+ assists with 5+ blocks", (l) => l.ast >= 10 && l.blk >= 5, (l) => `${l.ast} assists and ${l.blk} blocks`),
    L("astblk12", "12+ assists with 5+ blocks", (l) => l.ast >= 12 && l.blk >= 5, (l) => `${l.ast} assists and ${l.blk} blocks`),
    L("blk3", "5+ blocks with 5+ threes", (l) => l.blk >= 5 && l.fg3m >= 5, (l) => `${l.blk} blocks and ${l.fg3m} threes`),
    L("blk36", "5+ blocks with 6+ threes", (l) => l.blk >= 5 && l.fg3m >= 6, (l) => `${l.blk} blocks and ${l.fg3m} threes`),
    L("reb3", "15+ rebounds with 6+ threes", (l) => l.reb >= 15 && l.fg3m >= 6, (l) => `${l.reb} rebounds and ${l.fg3m} threes`),
    L("stlblk", "5+ steals with 5+ blocks", (l) => l.stl >= 5 && l.blk >= 5, (l) => `${l.stl} steals and ${l.blk} blocks`),
  ] },
  { id: "bench", f: 6, levels: [
    ...steps([35, 40], (n) => `${n}+ points off the bench`, (l, n) => l.starter === 0 && l.pts >= n, (l) => `${l.pts} points off the bench`),
    L("reb18", "18+ rebounds off the bench", (l) => l.starter === 0 && l.reb >= 18, (l) => `${l.reb} rebounds off the bench`),
    L("reb20", "20+ rebounds off the bench", (l) => l.starter === 0 && l.reb >= 20, (l) => `${l.reb} rebounds off the bench`),
  ] },
  // 7. Far from his own scoring average (his other games that season; ODD.games of them)
  { id: "dud", f: 7, levels: [
    L("half", "a 25-point scorer under half his average in 28+ minutes", (l, x) => !!x.avg && x.avg.pts >= 25 && l.min >= 28 && l.pts < 0.5 * x.avg.pts, (l, x) => `${l.pts} points in ${l.min} minutes (averages ${r1(x.avg.pts)}; ${shot(l)})`),
    L("25", "a 25-point scorer held to 9 or fewer in 28+ minutes", (l, x) => !!x.avg && x.avg.pts >= 25 && l.min >= 28 && l.pts <= 9, (l, x) => `${l.pts} points in ${l.min} minutes (averages ${r1(x.avg.pts)}; ${shot(l)})`),
    L("20", "a 20-point scorer held to 5 or fewer in 28+ minutes", (l, x) => !!x.avg && x.avg.pts >= 20 && l.min >= 28 && l.pts <= 5, (l, x) => `${l.pts} points in ${l.min} minutes (averages ${r1(x.avg.pts)}; ${shot(l)})`),
    L("nofg", "a 20-point scorer without a field goal in 25+ minutes", (l, x) => !!x.avg && x.avg.pts >= 20 && l.min >= 25 && l.fgm === 0, (l, x) => `no field goal in ${l.min} minutes (0-for-${l.fga}; averages ${r1(x.avg.pts)} points)`),
    L("zero", "a 20-point scorer scoreless in 10+ minutes", (l, x) => !!x.avg && x.avg.pts >= 20 && l.min >= 10 && l.pts === 0, (l, x) => `scoreless in ${l.min} minutes (averages ${r1(x.avg.pts)})`),
  ] },
  { id: "erupt", f: 7, levels: [
    L("3x", "25+ points at three times an average under 10", (l, x) => !!x.avg && x.avg.pts < 10 && l.pts >= 25 && l.pts >= 3 * x.avg.pts, (l, x) => `${l.pts} points (averages ${r1(x.avg.pts)})`),
    L("25", "25 or more above his average", (l, x) => !!x.avg && l.pts >= x.avg.pts + 25, (l, x) => `${l.pts} points (averages ${r1(x.avg.pts)})`),
    L("u8", "30+ points by a player averaging under 8", (l, x) => !!x.avg && x.avg.pts < 8 && l.pts >= 30, (l, x) => `${l.pts} points (averages ${r1(x.avg.pts)})`),
    L("30", "30 or more above his average", (l, x) => !!x.avg && l.pts >= x.avg.pts + 30, (l, x) => `${l.pts} points (averages ${r1(x.avg.pts)})`),
  ] },
];

/** ESPN's position label -> "G" | "F" | "C" | null (anything else, or none). */
export const posGroup = (p) => (p === "G" || p === "PG" || p === "SG" ? "G" : p === "C" ? "C" : p === "F" || p === "SF" || p === "PF" ? "F" : null);

/** Every template level this line passes: [{ key: "id.k", id, k, f, what, say }]. */
export function matchLine(l, x = {}) {
  const cx = { pos: x.pos ?? null, avg: x.avg ?? null }, out = [];
  for (const t of TEMPLATES) for (const lv of t.levels) if (lv.test(l, cx)) out.push({ key: `${t.id}.${lv.k}`, id: t.id, k: lv.k, f: t.f, what: lv.what, say: lv.say(l, cx) });
  return out;
}

/** Per season over the history's last five seasons; the grade that follows. */
export const rateOf = (h) => (h ? h.l5 / ODD.recent : 0);
export const gradeOf = (rate) => (rate <= ODD.rare ? "rare" : rate <= ODD.few ? "few" : rate <= ODD.monthly ? "monthly" : "common");

const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}/${d.slice(2, 4)}`;
const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
// With a history entry before without; then the lower recent rate; then the fewer ever.
const rarer = (a, b) => ((a.grade == null) !== (b.grade == null) ? b.grade == null : a.rate !== b.rate ? a.rate < b.rate : a.before < b.before);
const lineOf = (v, IX) => { const l = {}; for (const [k, i] of Object.entries(IX)) if (i >= 1) l[k] = v[i] || 0; return l; };

/**
 * The odd lines on each of `dates`, rarest first.
 *   rows: this season's results rows with `pl` (id -> array indexed by IX; see trends.js LINE_IX)
 *   history: src/data/odd-lines-history.json ({ t: { "id.k": { n, l5, last: [[name, d, team, text]] } }, from, through })
 *   names: { id: name } · pos: { id: ESPN position label } · tally: optional {} filled with this season's count of every level
 * -> { date: [{ id, name, team, opp, home, win, d, min, box, grade, rate, hits: [{ key, f, what, say, grade, rate, before, last, note, text }] }] }
 * One hit a template: the rarest level the line passes (lowest recent rate, then fewest ever).
 * `before` counts the history plus this season's earlier nights (same-night lines do not count each other).
 */
export function oddNights({ rows = [], history = null, names = {}, pos = {}, dates = [], IX, tally = null }) {
  const H = history?.t || {}, want = new Set(dates), played = [...rows].filter((g) => g.pl && /^\d{4}-\d\d-\d\d$/.test(g.d || "")).sort((a, b) => a.d.localeCompare(b.d));
  // his average in his other games this season
  const sum = {};
  for (const g of played) for (const [id, v] of Object.entries(g.pl)) { if (!(v[IX.min] > 0)) continue; const s = (sum[id] ??= { n: 0, pts: 0, reb: 0, ast: 0 }); s.n++; s.pts += v[IX.pts] || 0; s.reb += v[IX.reb] || 0; s.ast += v[IX.ast] || 0; }
  const ctx = (id, l) => {
    const s = sum[id], mine = l.min > 0 ? 1 : 0, n = (s?.n || 0) - mine;
    return { pos: posGroup(pos[id]), avg: n >= ODD.games ? { pts: (s.pts - mine * l.pts) / n, reb: (s.reb - mine * l.reb) / n, ast: (s.ast - mine * l.ast) / n, n } : null };
  };
  const seen = {}, out = Object.fromEntries(dates.map((d) => [d, []]));   // seen: key -> [[name, d, team, text]] this season, oldest first
  let i = 0;
  while (i < played.length) {
    const d = played[i].d, tonight = [];
    for (; i < played.length && played[i].d === d; i++) {
      const g = played[i];
      for (const [id, v] of Object.entries(g.pl)) {
        const l = lineOf(v, IX), x = ctx(id, l), hits = matchLine(l, x);
        if (!hits.length) continue;
        const home = v[IX.side] === 0;
        tonight.push({ id, g, home, l, x, hits });
      }
    }
    if (want.has(d)) {
      for (const { id, g, home, l, hits } of tonight) {
        const best = {};
        for (const h of hits) {
          const hist = H[h.key] || null, mine = seen[h.key] || [], rate = rateOf(hist), before = (hist?.n || 0) + mine.length;
          const lastOne = mine.length ? mine[mine.length - 1] : hist?.last?.[0] || null;
          const cand = { ...h, rate: Math.round(rate * 10) / 10, grade: hist ? gradeOf(rate) : null, before, last: lastOne };
          const cur = best[h.id];
          if (!cur || rarer(cand, cur)) best[h.id] = cand;
        }
        const list = Object.values(best).map((h) => ({ ...h, note: note(h, history), text: sentence(h, history) })).sort((a, b) => GRADES.indexOf(a.grade ?? "common") - GRADES.indexOf(b.grade ?? "common") || a.rate - b.rate || a.before - b.before);
        out[d].push({ id, name: names[id] || id, team: home ? g.h : g.a, opp: home ? g.a : g.h, home: home && !g.n, win: home ? g.hs > g.as : g.as > g.hs, d, min: l.min,
          box: `${l.pts} pts, ${l.reb} reb, ${l.ast} ast, ${l.stl} stl, ${l.blk} blk, ${l.fgm}-${l.fga} FG, ${l.fg3m}-${l.fg3a} 3PT, ${l.ftm}-${l.fta} FT, ${l.tov} TO in ${l.min} min`,
          grade: list[0].grade, rate: list[0].rate, hits: list });
      }
      out[d].sort((a, b) => GRADES.indexOf(a.grade ?? "common") - GRADES.indexOf(b.grade ?? "common") || a.rate - b.rate || a.hits[0].before - b.hits[0].before || a.name.localeCompare(b.name));
    }
    for (const { id, g, home, hits } of tonight) for (const h of hits) (seen[h.key] ??= []).push([names[id] || id, d, home ? g.h : g.a, h.say]);
  }
  if (tally) for (const [k, v] of Object.entries(seen)) tally[k] = v.length;
  return out;
}

/**
 * How rare the class is, for a hit: "40+ points off the bench: the 56th on file since 1993-94 (last: X, 1/14/26, 43 points
 * off the bench)." or "8+ turnovers: about 42 a season over the last five seasons (last: …)." "On file": the history
 * leaves out the games ESPN has no player numbers for.
 */
export function note(h, history) {
  if (h.grade == null) return "";
  const since = history?.from || "1993-94", cls = `${h.what[0].toUpperCase()}${h.what.slice(1)}`;
  const last = h.last ? ` (last: ${h.last[0]}, ${md(h.last[1])}${h.last[3] && h.last[3] !== h.say ? `, ${h.last[3]}` : ""})` : "";
  if (h.before === 0) return `${cls}: the first on file since ${since}.`;
  if (h.before <= ODD.nth) return `${cls}: the ${ord(h.before + 1)} on file since ${since}${last}.`;
  return `${cls}: about ${h.rate >= 10 ? Math.round(h.rate) : h.rate} a season over the last five seasons${last}.`;
}
export const sentence = (h, history) => `${h.say}. ${note(h, history)}`.trim();
