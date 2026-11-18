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

// 0.107.9 (the user, 11/18: "do the team alerts convert to league-record alerts? … I want to make sure game records have
// precedence"). They did not: a franchise mark was checked against the team's guide only, so a night that passed the NBA
// record would have been reported as a franchise record and nothing more. The league's own record book is on file
// (src/data/nba-record-book-<season>.json, regular season, 28 one-team and 28 both-teams marks for a game on the fifteen
// box-score stats, and points by half and quarter). Every game is now set against it first.
const LEAGUE_STAT = { "points": "pts", "field goals made": "fgm", "field goal attempts": "fga", "three-point field goals made": "fg3m", "three-point field goal attempts": "fg3a", "free throws made": "ftm",
  "free throw attempts": "fta", "rebounds": "reb", "offensive rebounds": "oreb", "defensive rebounds": "dreb", "assists": "ast", "personal fouls": "pf", "steals": "stl", "blocked shots": "blk", "turnovers": "tov" };
const NTH = { first: 0, second: 1, third: 2, fourth: 3 };
/** The league's team marks for a game, a half and a quarter: { "most|fg3m|one|game": { kind, stat, who, period, part, v, holder, many } }.
 *  `part` is which half or quarter (0-based) for the marks the book prints one by one; without it, any half or quarter (the best of them). */
export function leagueMarks(book) {
  const out = {};
  for (const r of book || []) {
    if (r.book !== "Regular season" || r.side !== "team" || !r.entries?.length) continue;
    const v = Number(r.entries[0].value); if (!Number.isFinite(v)) continue;
    // three "both teams" entries in the book file carry bracketed team numbers that do not add up to the mark (the 48
    // threes of 12/15/24 read "(47)" and "(41)"); the mark is right, so the brackets are left out, not repeated
    const two = [...r.entries[0].holder.matchAll(/\((\d+)\)/g)].map((x) => +x[1]);
    const holder = two.length === 2 && two[0] + two[1] !== v ? r.entries[0].holder.replace(/\s*\(\d+\)/g, "") : r.entries[0].holder;
    const n = r.entries.filter((e) => Number(e.value) === v).length;                   // how many nights share the mark (29 threes: four)
    const base = { v, holder: n > 1 ? `${holder} and ${n - 1} more` : holder, many: /^By many/i.test(holder) };
    let m = /^(Most|Fewest) (.+?), (one team|both teams), game$/.exec(r.title);
    if (m && LEAGUE_STAT[m[2]]) { const kind = m[1].toLowerCase(), who = m[3] === "one team" ? "one" : "both"; out[`${kind}|${LEAGUE_STAT[m[2]]}|${who}|game`] = { kind, stat: LEAGUE_STAT[m[2]], who, period: "game", part: null, ...base }; continue; }
    m = /^(Most|Fewest) points, (one team|both teams), (first|second|third|fourth) (half|quarter)$/.exec(r.title);
    if (!m) continue;
    const kind = m[1].toLowerCase(), who = m[2] === "one team" ? "one" : "both", period = m[4], part = NTH[m[3]];
    out[`${kind}|pts|${who}|${period}|${part}`] = { kind, stat: "pts", who, period, part, nth: m[3], ...base };
    const any = `${kind}|pts|${who}|${period}`, cur = out[any];
    if (!cur || (kind === "most" ? v > cur.v : v < cur.v)) out[any] = { kind, stat: "pts", who, period, part: null, ...base };
  }
  return out;
}

/**
 * Lines for a game on or after `since` in which a team, or the two teams together, reached an NBA record. The season is
 * walked in order from the book's marks, so a record already raised this season is the one to beat. A tie is a line
 * unless the book says the mark is held "by many" or the mark is zero (a night without a block is not news).
 */
export function leagueRecordLines({ book, rows, since, today = null }) {
  const L = leagueMarks(book), out = [], run = new Map(Object.entries(L).map(([k, m]) => [k, { v: m.v, holder: m.holder }]));
  const games = (rows || []).filter((g) => g.hs > 0 && g.as > 0 && !g.cupFinal && (!today || g.d < today)).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const whole = (x) => Array.isArray(x.box) && x.box[1] >= 40, quarters = (x) => (Array.isArray(x.q) && x.q.length >= 4 && !x.q.slice(0, 4).some((n) => !(n > 0)) ? x.q.slice(0, 4) : null);
  const value = (m, x) => {
    if (m.period === "game") return m.stat === "pts" ? x.pts : !whole(x) ? null : m.stat === "reb" ? (x.box[6] || 0) + (x.box[7] || 0) : x.box[BOX.indexOf(m.stat)];
    const q = quarters(x); if (!q) return null;
    const parts = m.period === "quarter" ? q : [q[0] + q[1], q[2] + q[3]];
    return m.part != null ? parts[m.part] : m.kind === "most" ? Math.max(...parts) : Math.min(...parts);
  };
  const both = (m, a, b) => {      // the two teams together; for a half or a quarter, the same half or quarter
    if (m.period === "game") { const x = value(m, a), y = value(m, b); return x == null || y == null ? null : x + y; }
    const qa = quarters(a), qb = quarters(b); if (!qa || !qb) return null;
    const pa = m.period === "quarter" ? qa : [qa[0] + qa[1], qa[2] + qa[3]], pb = m.period === "quarter" ? qb : [qb[0] + qb[1], qb[2] + qb[3]], sums = pa.map((n, i) => n + pb[i]);
    return m.part != null ? sums[m.part] : m.kind === "most" ? Math.max(...sums) : Math.min(...sums);
  };
  for (const g of games) {
    const H = { pts: g.hs, box: g.hb, q: g.hq }, A = { pts: g.as, box: g.ab, q: g.aq }, day = mdy(g.d).replace(/\/\d\d$/, ""), said = new Set();
    for (const [key, m] of Object.entries(L)) {
      const tries = m.who === "one" ? [[g.h, g.a, value(m, H), `vs. ${g.a}`], [g.a, g.h, value(m, A), `at ${g.h}`]] : [[g.h, g.a, both(m, H, A), null]];
      for (const [t, opp, v, where] of tries) {
        if (v == null) continue;
        const cur = run.get(key), sign = m.kind === "most" ? 1 : -1;
        if (sign * v < sign * cur.v) continue;
        const beat = v !== cur.v;
        if (!beat && (L[key].many || v === 0)) continue;
        const tag = `${t}|${m.kind}|${m.stat}|${m.who}|${m.period}`;       // "a first quarter" and "a quarter" on the same night: said once, as the wider one
        if (g.d >= since && !(m.part != null && said.has(tag))) {
          if (m.part == null) said.add(tag);
          const word = v === 1 ? WORD[m.stat].replace(/s$/, "") : WORD[m.stat], sup = m.kind === "most" ? "the most" : "the fewest";
          const span = m.period === "game" ? "in a game" : m.part != null ? `in a ${m.nth} ${m.period}` : `in a ${m.period}`;
          const who = m.who === "one" ? `${t} had ${v} ${word} ${m.period === "game" ? "" : `${span} `}on ${day} (${opp})` : `${g.a} and ${g.h} combined for ${v} ${word} ${m.period === "game" ? "" : `${span} `}on ${day}`;
          out.push({ kind: "unique", team: t, player: null, date: g.d, league: true, mark: { kind: m.kind, stat: m.stat, who: m.who, period: m.period, part: m.part }, key: `league|${key}|${t}`, score: beat ? 5.6 : 5.2,
            text: `${who}: ${beat ? "an NBA record," : "tying the NBA record for"} ${beat ? `${sup} ` : `${sup} `}by ${m.who === "one" ? "one team" : "both teams"} ${span} (${beat ? "was" : "also"} ${cur.v}, ${cur.holder}), by the league's record book`.replace(/\s+/g, " ") });
        }
        if (beat) run.set(key, { v, holder: m.who === "one" ? `${nick(t)} ${where}, ${mdy(g.d)}` : `${g.a} at ${g.h}, ${mdy(g.d)}` });
      }
    }
  }
  // the wider line was added after the narrower one when the marks came in that order: keep one line a team, stat and span
  const best = new Map();
  for (const l of out) { const k = `${l.team}|${l.date}|${l.mark.kind}|${l.mark.stat}|${l.mark.who}|${l.mark.period}`, c = best.get(k); if (!c || (c.mark.part != null && l.mark.part == null)) best.set(k, l); }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/** NBA records first: a franchise line for the same team, night and mark is folded into the league line, not said twice. */
export function withLeagueFirst(league, franchise) {
  const gone = new Set(), out = [];
  for (const l of league || []) {
    let also = false;
    if (l.mark.who === "one" && l.mark.part == null) for (const f of franchise || []) {
      if (f.team !== l.team || f.date !== l.date) continue;
      const same = f.key === `teambox|${l.team}|team|${l.mark.kind}|${l.mark.stat}|${l.mark.period}` || (l.mark.stat === "pts" && l.mark.period === "game" && f.key === `teamgame|${l.team}|${l.mark.kind}`);
      if (same) { gone.add(f); also = true; }
    }
    out.push(also ? { ...l, text: `${l.text}; also the ${nick(l.team)}' franchise mark` } : l);
  }
  return [...out, ...(franchise || []).filter((f) => !gone.has(f))];
}
