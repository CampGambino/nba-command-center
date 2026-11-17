/**
 * Each team's single-game marks from its own games (0.90): most and fewest points, most and fewest allowed, largest
 * win and loss, as far back as the games can be trusted (deepSeqs), with this season on top.
 *
 * The guides print these too, each in its own layout; the box-score ones (rebounds, assists, threes in a game) are
 * not read. What can be counted from scores is counted here for all 30 teams and says its window.
 *
 *   teamGameRecords({ deep, history, rows, printed }) -> { TRI: { window: { from, whole }, marks: { most, fewest, allowed, held, win, loss } } }
 *       a mark: { v, d, opp, score, prev: the mark before it | null }
 *       0.93: where the team's guide prints the mark (printed: src/data/team-game-records-<season>.json, 19 guides), the
 *       print is the mark through last season and only this season's games can move it: { ..., source: "guide", scope }.
 *       A game on file that beats the print (Charlotte's season page has a 107-155 loss its records page does not) is
 *       kept as { doubt: { v, d } } and never becomes the mark.
 *   recordLines(records, since, today)       -> lines for marks set or tied on or after `since`
 */
import { TEAMS } from "../teams.js";

export const SANE = { low: 30, high: 200 };
const nick = (t) => TEAMS[t]?.nick || t;
const mdy = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}/${d.slice(2, 4)}`;
const KINDS = {
  most: [(g) => g.pf, 1, "the most points in a game"], fewest: [(g) => g.pf, -1, "the fewest points in a game"],
  allowed: [(g) => g.pa, 1, "the most points allowed in a game"], held: [(g) => g.pa, -1, "the fewest points allowed in a game"],
  win: [(g) => g.pf - g.pa, 1, "the largest win"], loss: [(g) => g.pa - g.pf, 1, "the largest loss"],
};

const PRINTED = { most: ["team", "most"], fewest: ["team", "fewest"], allowed: ["opp", "most"], held: ["opp", "fewest"] };
const SHOT_CLOCK = "1954-10-01";      // guides leave out the years before it for "fewest"
const OWN = "2016-10-01";             // our own results start here

export function teamGameRecords({ deep, history, rows, printed = null }) {
  const newFrom = printed?.through ? `${Number(String(printed.through).slice(0, 4)) + 1}-07-01` : null;
  const seq = {}, put = (t, d, pf, pa, opp) => { if (t && Math.min(pf, pa) >= SANE.low && Math.max(pf, pa) <= SANE.high) (seq[t] ??= []).push({ d, pf, pa, opp }); };
  for (const [t, gs] of Object.entries(deep?.seq || {})) for (const g of gs) put(t, g.d, g.pf, g.pa, g.opp);
  const cols = history?.columns || [], at = (k) => cols.indexOf(k);
  for (const g of history?.games || []) {
    if (g[at("type")] !== 2) continue;
    const d = String(g[at("date")]).slice(0, 10);
    put(g[at("home")], d, g[at("homeScore")], g[at("awayScore")], g[at("away")]); put(g[at("away")], d, g[at("awayScore")], g[at("homeScore")], g[at("home")]);
  }
  for (const g of rows || []) if (g.hs > 0 && g.as > 0) { put(g.h, g.d, g.hs, g.as, g.a); put(g.a, g.d, g.as, g.hs, g.h); }
  const out = {};
  for (const [t, gs] of Object.entries(seq)) {
    gs.sort((a, b) => (a.d < b.d ? -1 : 1));
    const marks = {};
    for (const [k, [val, sign]] of Object.entries(KINDS)) {
      let best = null, prev = null, doubt = null;
      const pk = PRINTED[k], pm = newFrom && pk ? (printed.teams?.[t] || []).find((m) => m.stat === "pts" && m.period === "game" && m.kind === pk[1] && (m.side || "team") === pk[0]) : null;
      if (pm && pm.games.length) best = { v: pm.value, d: pm.games.map((x) => x.date).sort().pop(), opp: null, score: null };
      for (const g of gs) {
        const v = val(g);
        // A game before this season that beats the print. From our own results (2016-17 on) it is the mark and the guide
        // is behind (the Hornets' page still says 146 allowed; Milwaukee scored 147 on them on 11/14/25). From the older
        // lists it is a doubt, not a record: those are where the misprints are.
        if (pm && g.d < newFrom && !(g.d >= OWN && sign * v > sign * best.v)) { if (g.d < OWN && sign * v > sign * pm.value && g.d >= SHOT_CLOCK && (!doubt || sign * v > sign * doubt.v)) doubt = { v, d: g.d }; continue; }
        if (best === null || sign * v > sign * best.v) { prev = best; best = { v, d: g.d, opp: g.opp, score: `${Math.max(g.pf, g.pa)}-${Math.min(g.pf, g.pa)}` }; }
        else if (v === best.v && g.d !== best.d) { prev = best; best = { v, d: g.d, opp: g.opp, score: `${Math.max(g.pf, g.pa)}-${Math.min(g.pf, g.pa)}`, tied: true }; }
      }
      if (best) marks[k] = { ...best, prev: prev ? { v: prev.v, d: prev.d, opp: prev.opp } : null, ...(pm ? { source: "guide", scope: printed.scopes?.[t] || "in franchise history", ...(best.d < newFrom && best.v !== pm.value ? { behind: pm.value } : {}) } : {}), ...(doubt ? { doubt } : {}) };
    }
    out[t] = { window: { from: deep?.from?.[t] || null, whole: !!deep?.whole?.[t] }, games: gs.length, marks };
  }
  return out;
}

/** A team mark set or tied on or after `since`: "DEN scored 163 on 11/16: the most points in a game in franchise history (was 161, 3/2/90)". */
export function recordLines(records, since, today = null) {
  const out = [];
  for (const [t, r] of Object.entries(records || {})) for (const [k, m] of Object.entries(r.marks)) {
    if (m.d < since || (today && m.d >= today) || !m.prev || r.games < 400) continue;
    const scope = m.source === "guide" ? m.scope : r.window.whole ? "in franchise history" : r.window.from ? `since at least ${r.window.from}` : "";
    const did = k === "most" || k === "fewest" ? `scored ${m.v}` : k === "allowed" || k === "held" ? `allowed ${m.v}` : k === "win" ? `won by ${m.v}` : `lost by ${m.v}`;
    out.push({ kind: "unique", team: t, player: null, date: m.d, key: `teamgame|${t}|${k}`, score: 4.2 + (r.window.whole || m.source === "guide" ? 0.4 : 0),
      text: `${t} ${did} on ${mdy(m.d).replace(/\/\d\d$/, "")} (${m.score}${m.opp ? `, ${m.opp}` : ""}): ${m.tied ? KINDS[k][2].replace(/^the /, "tied for the ") : KINDS[k][2]} ${scope} for the ${nick(t)}${m.source === "guide" ? ", by its media guide" : ""} (${m.tied ? "also" : "was"} ${m.prev.v}, ${mdy(m.prev.d)})`.replace(/\s+/g, " ") });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * The marks only a box score carries (rebounds, assists, threes, steals, blocks in a game; points in a quarter or
 * half), as the guides print them (src/data/team-game-records-2026-27.json; 19 guides in 0.93, a reader per layout).
 * The season is walked in order from the printed mark, so a mark already raised this season is the one to beat; a
 * game on or after `since` that reaches the standing mark is a line. Points in a game are recordLines' job.
 *
 * 0.93: the fewest, and the most and fewest by an opponent, where a guide prints them. A tie for a fewest mark is a line
 * only for the counting stats that are rarely tied (not a second night without a block).
 */
const BOX = ["fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf"];
const WORD = { pts: "points", fgm: "field goals", fga: "field goal attempts", fg3m: "threes", fg3a: "three-point attempts", ftm: "free throws", fta: "free throw attempts", reb: "rebounds", oreb: "offensive rebounds",
  dreb: "defensive rebounds", ast: "assists", stl: "steals", blk: "blocks", tov: "turnovers", pf: "fouls" };
const TIE_FEWEST = new Set(["pts", "fgm", "fga", "reb", "ast", "tov", "ftm", "fta", "pf"]);
const boxValue = (m, who) => {
  if (m.period === "game") {
    if (m.stat === "pts") return who.pts;
    if (!Array.isArray(who.box) || !(who.box[1] >= 40)) return null;                  // a box score with fewer than 40 shots is not a whole one
    return m.stat === "reb" ? (who.box[6] || 0) + (who.box[7] || 0) : who.box[BOX.indexOf(m.stat)];
  }
  if (m.stat !== "pts" || !Array.isArray(who.q) || who.q.length < 4 || who.q.slice(0, 4).some((x) => !(x > 0))) return null;
  const parts = m.period === "quarter" ? who.q.slice(0, 4) : m.period === "half" ? [who.q[0] + who.q[1], who.q[2] + who.q[3]] : null;
  return parts ? (m.kind === "most" ? Math.max(...parts) : Math.min(...parts)) : null;
};
export function boxRecordLines(records, rows, since, today = null) {
  const out = [], run = new Map();
  const games = (rows || []).filter((g) => g.hs > 0 && g.as > 0 && (!today || g.d < today)).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  for (const g of games) {
    const H = { pts: g.hs, box: g.hb, q: g.hq }, A = { pts: g.as, box: g.ab, q: g.aq };
    for (const [t, opp, mine, theirs] of [[g.h, g.a, H, A], [g.a, g.h, A, H]]) {
      for (const m of records?.teams?.[t] || []) {
        if (!WORD[m.stat] || m.period === "ot" || (m.stat === "pts" && m.period === "game") || !["most", "fewest"].includes(m.kind)) continue;
        const side = m.side || "team", v = boxValue(m, side === "team" ? mine : theirs);
        if (v == null) continue;
        const key = `${t}|${side}|${m.kind}|${m.stat}|${m.period}`, cur = run.get(key) || { v: m.value, d: m.games[0]?.date || null, n: m.games.length, times: m.times || null }, sign = m.kind === "most" ? 1 : -1;
        if (sign * v < sign * cur.v) continue;
        const beat = v !== cur.v;
        if (!beat && m.kind === "fewest" && (v === 0 || !TIE_FEWEST.has(m.stat))) continue;
        if (g.d >= since) {
          const where = m.period === "game" ? "in a game" : `in a ${m.period}`, sup = m.kind === "most" ? "the most" : "the fewest", scope = records.scopes?.[t] || "in franchise history";
          // 0.95: a mark the guide gives with no game ("Done 2 times") has a value and how often, no date.
          const was = `(${beat ? "was" : "also"} ${cur.v}, ${cur.d ? `${mdy(cur.d)}${cur.n > 1 ? ` and ${cur.n - 1} more` : ""}` : cur.times || "no game given"})`, day = mdy(g.d).replace(/\/\d\d$/, "");
          const word = v === 1 ? WORD[m.stat].replace(/s$/, "") : WORD[m.stat];
          const text = side === "team"
            ? `${t} had ${v} ${word} ${m.period === "game" ? "" : `${where} `}on ${day} (${opp}): ${beat ? sup : `tying ${sup}`} ${where} ${scope}, by its media guide ${was}`
            : `${opp} had ${v} ${word} ${m.period === "game" ? "" : `${where} `}against ${t} on ${day}: ${beat ? sup : `tying ${sup}`} by an opponent ${where} ${scope}, by the ${nick(t)} media guide ${was}`;
          out.push({ kind: "unique", team: t, player: null, date: g.d, key: `teambox|${key}`, score: side === "team" && m.kind === "most" ? 4.4 : 4.0, text: text.replace(/\s+/g, " ") });
        }
        run.set(key, { v, d: g.d, n: beat ? 1 : cur.n + 1 });
      }
    }
  }
  return out;
}

/** The printed marks as rows for the finder: [team, stat, most, fewest, most by an opponent, fewest by an opponent]. */
export function boxTable(records) {
  const out = [], cell = (ms, side, kind, stat, period) => { const m = ms.find((x) => (x.side || "team") === side && x.kind === kind && x.stat === stat && x.period === period); return m ? `${m.value}${m.doubt ? "?" : ""} (${m.games.length ? `${mdy(m.games[0].date)}${m.games.length > 1 ? ` +${m.games.length - 1}` : ""}` : m.times || "no game given"})` : ""; };
  for (const t of Object.keys(records?.teams || {}).sort()) {
    const ms = records.teams[t];
    for (const [stat, period, label] of [["pts", "game", "points"], ["pts", "half", "points in a half"], ["pts", "quarter", "points in a quarter"], ["reb", "game", "rebounds"], ...BOX.map((k) => [k, "game", WORD[k]])]) {
      const row = [t, label, cell(ms, "team", "most", stat, period), cell(ms, "team", "fewest", stat, period), cell(ms, "opp", "most", stat, period), cell(ms, "opp", "fewest", stat, period)];
      if (row.slice(2).some(Boolean)) out.push(row);
    }
  }
  return out;
}
