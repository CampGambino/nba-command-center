/**
 * "The last time…" (0.89): how long since a team, or a player on it or against it, did something.
 *
 * The user (11/17) approved reading the guides' "the last time" pages and counting them forward, so a feat can be
 * called the first since a date on the night it happens. Two sources:
 *
 *   seeded   the pages three guides print (Boston, Washington, Golden State; src/data/last-time-2026-27.json): a
 *            player's or a team's box-score feats, for the team and for its opponents
 *   scores   every team's own games as far back as they can be trusted (deepSeqs): points for and against and
 *            margins, so these exist for all 30 teams and say their window
 *
 *   advance(seed, rows, names)            -> the seeded feats with this season's games on top
 *   scoreFeats({ deep, history, rows })   -> the same shape from scores, every team
 *   firstSince(feats, since, today)       -> lines for feats done on or after `since` whose time before was long ago
 *   watchList(feats, teams, today)        -> { TRI: [...] } for NBA Live: feats a player could do tonight for the first time in years
 *
 * A feat: { team, by: "team"|"opp", who: "player"|"team", stat, n, last: { date, holder?, value?, opp? } | null,
 *           prev: the time before `last` | null, window?: { from, whole } }
 */
import { TEAMS } from "../teams.js";
import { PLAYER_BOX_KEYS, TEAM_BOX_KEYS } from "../espn/parse.js";

export const LAST = { years: 3, live: ["pts", "reb", "ast", "stl", "blk", "fg3m"], scored: [140, 150, 160], low: [70], margin: [40, 50], sane: { low: 30, high: 200 } };
const nick = (t) => TEAMS[t]?.nick || t;
const mdy = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}/${d.slice(2, 4)}`;
const years = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5);
const PI = Object.fromEntries(PLAYER_BOX_KEYS.map((k, i) => [k, i + 3])), TI = Object.fromEntries(TEAM_BOX_KEYS.map((k, i) => [k, i]));

/** What a player's line is worth for a feat (0 when it is not one). */
function playerValue(line, stat) {
  const v = (k) => line[PI[k]] || 0;
  if (stat === "td") return ["pts", "reb", "ast", "stl", "blk"].filter((k) => v(k) >= 10).length >= 3 ? 1 : 0;
  if (stat === "d2020") return v("pts") >= 20 && v("reb") >= 20 ? 1 : 0;
  return v(stat);
}
function teamValue(g, home, stat) {
  const b = home ? g.hb : g.ab, pf = home ? g.hs : g.as, pa = home ? g.as : g.hs;
  if (stat === "pts") return pf;
  if (stat === "margin") return pf - pa;
  if (!Array.isArray(b)) return 0;
  if (stat === "reb") return (b[TI.oreb] || 0) + (b[TI.dreb] || 0);
  if (stat === "fgpct") return b[TI.fga] ? Math.round((1000 * b[TI.fgm]) / b[TI.fga]) : 0;
  return b[TI[stat]] || 0;
}

export function advance(seed, rows, names = {}) {
  const games = (rows || []).filter((g) => g.hs > 0 && g.as > 0).sort((a, b) => (a.d < b.d ? -1 : 1));
  // A team's points and margins come from its own games for all 30 teams (scoreFeats): not read twice.
  return (seed?.feats || []).filter((f) => !(f.who === "team" && (f.stat === "pts" || f.stat === "margin"))).map((f) => {
    const hits = [{ date: f.date, holder: f.holder, value: f.value, opp: f.opp, guide: true }];
    for (const g of games) {
      if (g.d <= f.date || (g.h !== f.team && g.a !== f.team)) continue;
      const home = (g.h === f.team) === (f.by === "team"), other = g.h === f.team ? g.a : g.h;   // whose side does it
      if (f.who === "team") {
        const v = teamValue(g, home, f.stat);
        if (v >= f.n) hits.push({ date: g.d, value: f.stat === "fgpct" ? `.${v}` : String(v), opp: other });
      } else {
        for (const [id, line] of Object.entries(g.pl || {})) {
          if ((line[0] === 0) !== home || !(line[2] > 0)) continue;
          const v = playerValue(line, f.stat);
          if (v >= f.n) hits.push({ date: g.d, holder: names[id] || `#${id}`, value: f.stat === "td" || f.stat === "d2020" ? "" : String(v), opp: other });
        }
      }
    }
    return { team: f.team, by: f.by, who: f.who, stat: f.stat, n: f.n, last: hits[hits.length - 1], prev: hits.length > 1 ? hits[hits.length - 2] : null, source: "guide" };
  });
}

/** Points and margins, every team, from its own games. */
export function scoreFeats({ deep, history, rows }) {
  const out = [], seq = {};
  const put = (t, d, pf, pa, opp) => (seq[t] ??= []).push({ d, pf, pa, opp });
  for (const [t, gs] of Object.entries(deep?.seq || {})) for (const g of gs) if (Math.min(g.pf, g.pa) >= LAST.sane.low && Math.max(g.pf, g.pa) <= LAST.sane.high) put(t, g.d, g.pf, g.pa, g.opp);
  const cols = history?.columns || [], at = (k) => cols.indexOf(k);
  for (const g of history?.games || []) {
    if (g[at("type")] !== 2) continue;
    const d = String(g[at("date")]).slice(0, 10);
    put(g[at("home")], d, g[at("homeScore")], g[at("awayScore")], g[at("away")]); put(g[at("away")], d, g[at("awayScore")], g[at("homeScore")], g[at("home")]);
  }
  for (const g of rows || []) if (g.hs > 0 && g.as > 0) { put(g.h, g.d, g.hs, g.as, g.a); put(g.a, g.d, g.as, g.hs, g.h); }
  const tests = [
    ...LAST.scored.map((n) => ["team", "pts", n, (g) => g.pf >= n, (g) => g.pf]), ...LAST.scored.map((n) => ["opp", "pts", n, (g) => g.pa >= n, (g) => g.pa]),
    ...LAST.low.map((n) => ["team", "low", n, (g) => g.pf <= n, (g) => g.pf]), ...LAST.low.map((n) => ["opp", "low", n, (g) => g.pa <= n, (g) => g.pa]),
    ...LAST.margin.map((n) => ["team", "margin", n, (g) => g.pf - g.pa >= n, (g) => g.pf - g.pa]), ...LAST.margin.map((n) => ["opp", "margin", n, (g) => g.pa - g.pf >= n, (g) => g.pa - g.pf]),
  ];
  for (const [t, gs] of Object.entries(seq)) {
    gs.sort((a, b) => (a.d < b.d ? -1 : 1));
    const window = { from: deep?.from?.[t] || null, whole: !!deep?.whole?.[t] };
    for (const [by, stat, n, test, val] of tests) {
      const hits = gs.filter(test).map((g) => ({ date: g.d, value: String(val(g)), opp: g.opp, score: `${Math.max(g.pf, g.pa)}-${Math.min(g.pf, g.pa)}` }));
      out.push({ team: t, by, who: "team", stat, n, last: hits[hits.length - 1] || null, prev: hits.length > 1 ? hits[hits.length - 2] : null, window, source: "scores" });
    }
  }
  return out;
}

const NOUN = {
  pts: (n, who) => (who === "team" ? `${n}-point game` : `${n}-point game`), reb: (n) => `${n}-rebound game`, ast: (n) => `${n}-assist game`, stl: (n) => `${n}-steal game`, blk: (n) => `${n}-block game`,
  fgm: (n) => `game with ${n}+ field goals`, fg3m: (n) => `game with ${n}+ threes`, ftm: (n) => `game with ${n}+ free throws`, td: () => "triple-double", d2020: () => "20-point, 20-rebound game",
  margin: (n) => `win by ${n} or more`, fgpct: () => "game shooting 60% or better", low: (n) => `game with ${n} points or fewer`,
};
/** "the first 25-rebound game for the Celtics since Robert Parish (25, 1/9/87)" */
export function phrase(f) {
  const lost = f.by === "opp" && f.stat === "margin";      // an opponent's big win is the team's big loss
  const noun = lost ? `loss by ${f.n} or more` : NOUN[f.stat](f.n, f.who), whose = f.by === "team" ? (f.stat === "margin" ? `by the ${nick(f.team)}` : `for the ${nick(f.team)}`) : lost ? `for the ${nick(f.team)}` : `against the ${nick(f.team)}`;
  const p = f.prev;
  const since = p ? `since ${p.holder ? `${p.holder} (${[p.value, mdy(p.date)].filter(Boolean).join(", ")})` : `${mdy(p.date)}${p.score ? ` (${p.score}${p.opp ? `, ${p.opp}` : ""})` : p.value ? ` (${p.value})` : ""}`}`
    : f.window ? (f.window.whole ? "in franchise history" : `since at least ${f.window.from}`) : "";
  return `the first ${noun} ${whose} ${since}`.trim();
}

/** Lines for feats done on or after `since` whose time before was `LAST.years` or more earlier (or never, as far as the games go). */
export function firstSince(feats, since, today = null) {
  const out = [];
  for (const f of feats || []) {
    if (!f.last || f.last.guide || f.last.date < since || (today && f.last.date >= today)) continue;
    const gap = f.prev ? years(f.prev.date, f.last.date) : null;
    if (f.prev ? gap < LAST.years : !f.window) continue;
    const L = f.last, who = L.holder ? `${L.holder} (${f.by === "team" ? f.team : L.opp})` : f.by === "team" ? f.team : L.opp;
    const did = f.stat === "td" ? "had a triple-double" : f.stat === "d2020" ? "had 20 points and 20 rebounds" : f.stat === "margin" ? `won by ${L.value}` : f.stat === "fgpct" ? `shot ${L.value}` : f.stat === "low" ? `scored ${L.value}`
      : `${f.stat === "pts" ? "scored" : f.stat === "fgm" || f.stat === "fg3m" || f.stat === "ftm" ? "made" : "had"} ${L.value}${{ pts: "", reb: " rebounds", ast: " assists", stl: " steals", blk: " blocks", fgm: " field goals", fg3m: " threes", ftm: " free throws" }[f.stat]}`;
    out.push({ kind: "unique", team: f.by === "team" ? f.team : L.opp, player: L.holder || null, date: L.date, key: `lasttime|${f.team}|${f.by}|${f.who}|${f.stat}|${f.n}`,
      score: 2.2 + Math.min(1.6, (gap ?? 30) / 15) + (f.who === "player" ? 0.2 : 0), gap, n: f.stat === "low" ? -f.n : f.n,
      text: `${who} ${did} on ${mdy(L.date).replace(/\/\d\d$/, "")}: ${phrase(f)}` });
  }
  // One line a game and subject: the highest bar cleared says the lower ones too.
  const best = new Map();
  for (const l of out.sort((a, b) => b.n - a.n || b.score - a.score)) { const k = `${l.date}|${l.team}|${l.player || ""}|${l.key.split("|").slice(1, 5).join("|")}`; if (!best.has(k)) best.set(k, l); }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/** For NBA Live: what a player on (or against) tonight's teams would do for the first time in `LAST.years`+ years. */
export function watchList(feats, teams, today) {
  const out = {};
  for (const f of feats || []) {
    if (f.who !== "player" || !teams.includes(f.team) || !LAST.live.includes(f.stat) || !f.last || years(f.last.date, today) < LAST.years) continue;
    (out[f.team] ??= []).push({ by: f.by, stat: f.stat, n: f.n, date: f.last.date, holder: f.last.holder || null, phrase: phrase({ ...f, prev: f.last }) });
  }
  return out;
}
