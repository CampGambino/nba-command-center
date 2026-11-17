/**
 * The finder, for teams (0.84).
 *
 * The user, 11/16, on the finder's thresholds: "tell me the thresholds and also implement it for team stats."
 *
 * Same idea as the player finder (finder.js): nothing here is one detector for one post. Every team's season is cut
 * a number of ways and a cut is kept only when it is far out of line with the other 29. Four tests, each run over
 * all 30 teams and every stat in the lists below:
 *
 *   tgap    A team first (or last) in a stat by more than the distance from 2nd to 10th (or 21st to 29th).
 *           "OKC allow the fewest points in the NBA (103.9 a game), 4.4 fewer than 2nd-place BOS: a bigger gap than
 *           the one between 2nd and 10th." Kept when the gap is at least TEAM.gap times that distance.
 *   tpart   One quarter or one half of a team's games against everyone's whole games. "DEN outscore opponents by 6.1
 *           points in third quarters alone: only 3 teams have a better margin over a whole game." Kept when the
 *           piece would rank in the top (or bottom) TEAM.part.quarter of full-game margins (TEAM.part.half for a half).
 *   tcount  A team's count of a kind of game against the rest of the league. "NOP have 6 games allowing 130+: no
 *           other team has more than 4, and it is more than 14 other teams combined." Kept when the team is alone
 *           in front with at least TEAM.count.least, TEAM.count.ahead times the next team's count and
 *           TEAM.count.by more than it. (A first cut that only asked for "more than ten teams combined" listed 39
 *           lines on 11/16, most of them ties for the lead in a count where half the league had none.)
 *   tonly   The reverse: the one team (or one of two) without something nearly everyone has. "WAS are the only team
 *           that hasn't held an opponent under 100." Kept when at least TEAM.only.others of the other 29 have one.
 *
 * Every finding has the same shape as a player finding (kind "find", a `surprise`, a key of find|test|TEAM|cut) so
 * the page, the votes and the briefing treat them alike. Thresholds are first guesses, like the players'.
 */
export const TEAM = {
  games: 5,                              // a team needs this many games before any of it is listed
  gap: 1.0,                              // tgap: the lead is at least this many times the 2nd-to-10th distance
  part: { quarter: 6, half: 4 },         // tpart: a quarter's margin that would rank this high among full games; a half's
  count: { least: 4, ahead: 1.5, by: 2 },   // tcount: alone in front with this many, this many times the next team's count and this many more
  only: { others: 28 },                  // tonly: at least this many of the other 29 have one
};

const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const signed = (x) => `${x > 0 ? "+" : ""}${r1(x)}`;
const pct = (x) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;
const P = { side: 0, starter: 1, min: 2, pts: 3, fgm: 4, fga: 5, fg3m: 6, fg3a: 7, ftm: 8, fta: 9, reb: 10, ast: 11, tov: 12, stl: 13, blk: 14, oreb: 15, dreb: 16, pf: 17 };
const BOX = ["fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "oreb", "pf"];

/** One line per team per game: points, quarters, box totals and the bench's points, with the opponent's beside them. */
export function teamLines(rows) {
  const out = {};
  for (const g of [...(rows || [])].sort((a, b) => String(a.d).localeCompare(String(b.d)))) {
    if (!(g.hs > 0) || !(g.as > 0) || !g.pl) continue;
    const box = [Object.fromEntries(BOX.map((k) => [k, 0])), Object.fromEntries(BOX.map((k) => [k, 0]))], bench = [0, 0];
    let any = false;
    for (const v of Object.values(g.pl)) {
      const s = v[P.side] === 0 ? 0 : 1;
      for (const k of BOX) box[s][k] += v[P[k]] || 0;
      if (!v[P.starter]) bench[s] += v[P.pts] || 0;
      any = true;
    }
    if (!any) continue;
    const q = Array.isArray(g.hq) && Array.isArray(g.aq) && g.hq.length >= 4 && g.aq.length >= 4 ? [g.hq.slice(0, 4), g.aq.slice(0, 4)] : null;
    [[g.h, g.a, g.hs, g.as, 0], [g.a, g.h, g.as, g.hs, 1]].forEach(([team, opp, pts, opts, s]) => {
      (out[team] ??= []).push({ d: g.d, team, opp, pts, opts, q: q ? q[s] : null, oq: q ? q[1 - s] : null, box: box[s], obox: box[1 - s], bench: bench[s] });
    });
  }
  return out;
}

const sum = (L, f) => L.reduce((a, g) => a + (f(g) || 0), 0);
const avg = (f) => (L) => sum(L, f) / L.length;
const qAvg = (k, sign) => (L) => { const Q = L.filter((g) => g.q); return Q.length >= TEAM.games ? sum(Q, (g) => (sign >= 0 ? g.q[k] : 0) - (sign ? g.oq[k] : 0)) / Q.length : null; };
const hAvg = (a, b) => (L) => { const Q = L.filter((g) => g.q); return Q.length >= TEAM.games ? sum(Q, (g) => g.q[a] + g.q[b] - g.oq[a] - g.oq[b]) / Q.length : null; };
const ratio = (num, den) => (L) => { const d = sum(L, den); return d ? sum(L, num) / d : null; };
const NTH = ["1st", "2nd", "3rd", "4th"];

/**
 * Every list the gap test runs over. `top`: what the team at the high end does; `bot`: the low end. `more`/`fewer`:
 * the word for the distance. `fmt`: how a value is printed (per game unless a percentage).
 */
const STATS = [
  { key: "pts", v: avg((g) => g.pts), top: "score the most points in the NBA", bot: "score the fewest points in the NBA", unit: "a game" },
  { key: "opts", v: avg((g) => g.opts), top: "allow the most points in the NBA", bot: "allow the fewest points in the NBA", unit: "a game" },
  { key: "margin", v: avg((g) => g.pts - g.opts), top: "have the NBA's best point margin", bot: "have the NBA's worst point margin", unit: "a game", fmt: signed },
  ...[0, 1, 2, 3].map((k) => ({ key: `q${k + 1}m`, v: qAvg(k, 1), top: `have the NBA's best margin in ${NTH[k]} quarters`, bot: `have the NBA's worst margin in ${NTH[k]} quarters`, unit: "a game", fmt: signed })),
  ...[0, 1, 2, 3].map((k) => ({ key: `q${k + 1}`, v: qAvg(k, 0), top: `score the most in ${NTH[k]} quarters`, bot: `score the fewest in ${NTH[k]} quarters`, unit: "points a game" })),
  { key: "fg3m", v: avg((g) => g.box.fg3m), top: "make the most threes in the NBA", bot: "make the fewest threes in the NBA", unit: "a game" },
  { key: "fg3a", v: avg((g) => g.box.fg3a), top: "take the most threes in the NBA", bot: "take the fewest threes in the NBA", unit: "a game" },
  { key: "ofg3m", v: avg((g) => g.obox.fg3m), top: "allow the most threes in the NBA", bot: "allow the fewest threes in the NBA", unit: "a game" },
  { key: "fg3pct", v: ratio((g) => g.box.fg3m, (g) => g.box.fg3a), top: "shoot the NBA's best percentage on threes", bot: "shoot the NBA's worst percentage on threes", fmt: pct, scale: 100 },
  { key: "fgpct", v: ratio((g) => g.box.fgm, (g) => g.box.fga), top: "shoot the NBA's best percentage from the field", bot: "shoot the NBA's worst percentage from the field", fmt: pct, scale: 100 },
  { key: "ofgpct", v: ratio((g) => g.obox.fgm, (g) => g.obox.fga), top: "allow the NBA's highest field goal percentage", bot: "hold opponents to the NBA's lowest field goal percentage", fmt: pct, scale: 100 },
  { key: "fta", v: avg((g) => g.box.fta), top: "take the most free throws in the NBA", bot: "take the fewest free throws in the NBA", unit: "a game" },
  { key: "ofta", v: avg((g) => g.obox.fta), top: "send opponents to the line the most", bot: "send opponents to the line the least", unit: "free throws a game" },
  { key: "reb", v: avg((g) => g.box.reb), top: "lead the NBA in rebounds", bot: "are last in the NBA in rebounds", unit: "a game" },
  { key: "oreb", v: avg((g) => g.box.oreb), top: "lead the NBA in offensive rebounds", bot: "are last in the NBA in offensive rebounds", unit: "a game" },
  { key: "ast", v: avg((g) => g.box.ast), top: "lead the NBA in assists", bot: "are last in the NBA in assists", unit: "a game" },
  { key: "stl", v: avg((g) => g.box.stl), top: "lead the NBA in steals", bot: "are last in the NBA in steals", unit: "a game" },
  { key: "blk", v: avg((g) => g.box.blk), top: "lead the NBA in blocks", bot: "are last in the NBA in blocks", unit: "a game" },
  { key: "tov", v: avg((g) => g.box.tov), top: "commit the most turnovers in the NBA", bot: "commit the fewest turnovers in the NBA", unit: "a game" },
  { key: "otov", v: avg((g) => g.obox.tov), top: "force the most turnovers in the NBA", bot: "force the fewest turnovers in the NBA", unit: "a game" },
  { key: "pf", v: avg((g) => g.box.pf), top: "commit the most fouls in the NBA", bot: "commit the fewest fouls in the NBA", unit: "a game" },
  { key: "bench", v: avg((g) => g.bench), top: "get the most bench scoring in the NBA", bot: "get the least bench scoring in the NBA", unit: "points a game" },
];

/** Kinds of game a team can pile up. `n`: how many a game adds (a quarter count can add more than one). */
const COUNTS = [
  { key: "p130", say: "games of 130+ points", none: "hasn't scored 130", n: (g) => +(g.pts >= 130) },
  { key: "p120", say: "games of 120+ points", none: "hasn't scored 120", n: (g) => +(g.pts >= 120) },
  { key: "o100", say: "games holding an opponent under 100", none: "hasn't held an opponent under 100", n: (g) => +(g.opts < 100) },
  { key: "o110", say: "games holding an opponent under 110", none: "hasn't held an opponent under 110", n: (g) => +(g.opts < 110) },
  { key: "a130", say: "games allowing 130+", none: "hasn't allowed 130", n: (g) => +(g.opts >= 130) },
  { key: "a120", say: "games allowing 120+", none: "hasn't allowed 120", n: (g) => +(g.opts >= 120) },
  { key: "w20", say: "wins by 20+", none: "hasn't won a game by 20", n: (g) => +(g.pts - g.opts >= 20) },
  { key: "l20", say: "losses by 20+", none: "hasn't lost a game by 20", n: (g) => +(g.opts - g.pts >= 20) },
  { key: "w10", say: "wins by 10+", none: "hasn't won a game by 10", n: (g) => +(g.pts - g.opts >= 10) },
  { key: "t20", say: "games with 20+ threes", none: "hasn't made 20 threes in a game", n: (g) => +(g.box.fg3m >= 20) },
  { key: "t15", say: "games with 15+ threes", none: "hasn't made 15 threes in a game", n: (g) => +(g.box.fg3m >= 15) },
  { key: "a30", say: "games with 30+ assists", none: "hasn't had 30 assists in a game", n: (g) => +(g.box.ast >= 30) },
  { key: "s12", say: "games with 12+ steals", none: "hasn't had 12 steals in a game", n: (g) => +(g.box.stl >= 12) },
  { key: "b10", say: "games with 10+ blocks", none: "hasn't had 10 blocks in a game", n: (g) => +(g.box.blk >= 10) },
  { key: "r55", say: "games with 55+ rebounds", none: "hasn't had 55 rebounds in a game", n: (g) => +(g.box.reb >= 55) },
  { key: "tf20", say: "games forcing 20+ turnovers", none: "hasn't forced 20 turnovers in a game", n: (g) => +(g.obox.tov >= 20) },
  { key: "to10", say: "games with fewer than 10 turnovers", none: "hasn't had a game with fewer than 10 turnovers", n: (g) => +(g.box.tov < 10) },
  { key: "q40", say: "40-point quarters", none: "hasn't had a 40-point quarter", n: (g) => (g.q ? g.q.filter((x) => x >= 40).length : 0) },
  { key: "q35", say: "35-point quarters", none: "hasn't had a 35-point quarter", n: (g) => (g.q ? g.q.filter((x) => x >= 35).length : 0) },
  { key: "qa40", say: "40-point quarters allowed", none: "hasn't allowed a 40-point quarter", n: (g) => (g.oq ? g.oq.filter((x) => x >= 40).length : 0) },
  { key: "qu18", say: "quarters holding an opponent under 18", none: "hasn't held an opponent under 18 in a quarter", n: (g) => (g.oq ? g.oq.filter((x) => x < 18).length : 0) },
];

/** rows: this season's games before today (the results store's rows). → findings, most surprising first. */
export function teamFindings({ rows }) {
  const T = teamLines(rows);
  const teams = Object.keys(T).filter((t) => T[t].length >= TEAM.games);
  const out = [];
  if (teams.length < 20) return out;
  const score = (s) => Math.round((2.9 + Math.min(1.1, s * 0.35)) * 100) / 100;
  const push = (f) => out.push({ kind: "find", player: null, ...f, score: score(f.surprise) });

  // 1. tgap: first or last by more than the field is spread.
  const lists = {};
  for (const S of STATS) {
    const L = teams.map((t) => ({ t, v: S.v(T[t]) })).filter((x) => x.v != null && Number.isFinite(x.v)).sort((a, b) => b.v - a.v);
    lists[S.key] = L;
    if (L.length < 20) continue;
    const fmt = S.fmt || r1, k = S.scale || 1, n = L.length;
    const ends = [
      { who: L[0], next: L[1], lead: L[0].v - L[1].v, field: L[1].v - L[9].v, say: S.top, word: "more", end: "top" },
      { who: L[n - 1], next: L[n - 2], lead: L[n - 2].v - L[n - 1].v, field: L[n - 10].v - L[n - 2].v, say: S.bot, word: "fewer", end: "bot" },
    ];
    for (const e of ends) {
      if (!(e.field > 0) || e.lead / e.field < TEAM.gap) continue;
      const gap = S.scale ? `${r1(e.lead * k)} points` : r1(e.lead);
      const dir = /margin|percentage/.test(e.say) ? (e.end === "top" ? "better" : "worse") : e.word;
      push({ test: "tgap", team: e.who.t, key: `find|tgap|${e.who.t}|${S.key}${e.end === "bot" ? "-" : ""}`, surprise: 1 + e.lead / e.field, rare: e.lead / e.field >= 1.5,
        text: `${e.who.t} ${e.say} (${fmt(e.who.v)}${S.unit ? ` ${S.unit}` : ""}), ${gap} ${dir} than the next team (${e.next.t}): a wider gap than the one across the next nine teams (${S.scale ? r1(e.field * k) : r1(e.field)})` });
    }
  }

  // 2. tpart: one quarter or one half against everyone's whole games.
  const full = lists.margin || [];
  const pieces = [
    ...[0, 1, 2, 3].map((k) => ({ key: `q${k + 1}`, say: `${NTH[k]} quarters`, v: qAvg(k, 1), cut: TEAM.part.quarter, w: 1.3 })),
    { key: "h1", say: "first halves", v: hAvg(0, 1), cut: TEAM.part.half, w: 1 }, { key: "h2", say: "second halves", v: hAvg(2, 3), cut: TEAM.part.half, w: 1 },
  ];
  if (full.length >= 20) for (const t of teams) {
    const own = full.find((x) => x.t === t);
    let best = null;
    for (const c of pieces) {
      const v = c.v(T[t]);
      if (v == null || !own) continue;
      const others = full.filter((x) => x.t !== t);
      const better = others.filter((x) => x.v > v).length, worse = others.filter((x) => x.v < v).length;
      const hit = v > 0 && better < c.cut ? { c, v, rank: better + 1, up: true } : v < 0 && worse < c.cut ? { c, v, rank: worse + 1, up: false } : null;
      if (hit && (!best || hit.rank / hit.c.cut < best.rank / best.c.cut)) best = hit;
    }
    if (!best) continue;
    const n = best.rank - 1, c = best.c;
    push({ test: "tpart", team: t, key: `find|tpart|${t}|${c.key}${best.up ? "" : "-"}`, surprise: 0.9 + (1 - n / c.cut) * c.w * 1.6, rare: n <= 1,
      text: best.up
        ? `${t} outscore opponents by ${r1(best.v)} points in ${c.say} alone: ${n === 0 ? "no other team has a better margin" : `only ${n} other team${n === 1 ? " has" : "s have"} a better margin`} over a whole game (${t}'s own: ${signed(own.v)})`
        : `${t} are outscored by ${r1(-best.v)} points in ${c.say} alone: ${n === 0 ? "no other team has a worse margin" : `only ${n} other team${n === 1 ? " has" : "s have"} a worse margin`} over a whole game (${t}'s own: ${signed(own.v)})` });
  }

  // 3. tcount and 4. tonly: a kind of game one team piles up, or is alone without.
  for (const C of COUNTS) {
    const n = Object.fromEntries(teams.map((t) => [t, sum(T[t], C.n)]));
    const total = teams.reduce((a, t) => a + n[t], 0);
    for (const t of teams) {
      const others = teams.filter((o) => o !== t).map((o) => n[o]).sort((a, b) => a - b);
      const top = others[others.length - 1];
      if (n[t] >= TEAM.count.least && n[t] >= TEAM.count.ahead * top && n[t] - top >= TEAM.count.by) {
        let k = 0, acc = 0;
        while (k < others.length && acc + others[k] < n[t]) acc += others[k++];
        const all = k === others.length, none = others.filter((x) => x === 0).length;
        push({ test: "tcount", team: t, key: `find|tcount|${t}|${C.key}`, surprise: 1 + (top ? Math.min(1.5, n[t] / top - 1) : 1.5) + (all ? 0.8 : 0) + Math.min(0.5, k / 40), rare: all || n[t] >= 2 * top,
          text: `${t} have ${n[t]} ${C.say} this season: ${top ? `no other team has more than ${top}` : "no other team has one"}${all ? ", and it is more than every other team combined" : k >= 8 ? `, and it is more than ${k} other teams combined` : ""}${none >= 5 && top ? ` (${none} teams have none)` : ""}` });
      }
      if (n[t] === 0 && total >= 2 * teams.length) {
        const have = others.filter((x) => x > 0).length, alone = teams.filter((o) => n[o] === 0);
        if (have >= TEAM.only.others - (30 - teams.length)) {
          push({ test: "tonly", team: t, key: `find|tonly|${t}|${C.key}`, surprise: 1 + (alone.length === 1 ? 0.8 : 0.2) + Math.min(0.8, total / teams.length / 10), rare: alone.length === 1,
            text: alone.length === 1 ? `${t} are the only team that ${C.none} this season (the other ${others.length} have ${total} such ${/quarter/.test(C.say) ? "quarters" : "games"} between them)`
              : `${alone.join(" and ")} are the only teams that ${C.none.replace(/^hasn't/, "haven't")} this season` });
        }
      }
    }
  }
  // A threshold pair (130 and 120, 20 and 15 threes…) says one thing twice: keep the more surprising of each family.
  const fam = (key) => key.split("|").slice(1, 3).join("|") + "|" + key.split("|")[3].replace(/\d+/g, "").replace(/-$/, "");
  const bestOf = {};
  for (const f of out) if (/^t(?:count|only)$/.test(f.test)) { const k = fam(f.key); if (!bestOf[k] || f.surprise > bestOf[k].surprise) bestOf[k] = f; }
  // One gap line a team: the list where it is furthest from the field.
  const gapBest = {};
  for (const f of out) if (f.test === "tgap" && (!gapBest[f.team] || f.surprise > gapBest[f.team].surprise)) gapBest[f.team] = f;
  const kept = out.filter((f) => (f.test === "tgap" ? gapBest[f.team] === f : !/^t(?:count|only)$/.test(f.test) || bestOf[fam(f.key)] === f));
  return kept.sort((a, b) => b.surprise - a.surprise);
}
