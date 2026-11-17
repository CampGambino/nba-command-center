/**
 * The finder (0.81): numbers nobody asked for.
 *
 * The user, 11/16, on a post that ranked Luka Dončić's scoring through three quarters against the league's full
 * games: "a way to illuminate how absurd his scoring has been, something a program could find on its own since it
 * contains all the information already. it just has to know it can look for noteworthy stats that aren't surface
 * level." And on such posts in general: "I'd like the program to have the ability to find stuff like that on its
 * own, or at least suggest information that could be tracked worth tracking."
 *
 * So this is not one more detector for one more post. It takes every player's season, cuts it a number of ways,
 * and keeps a cut only when it is far out of line with the league. Three tests, each run over everyone:
 *
 *   part   A piece of a player's scoring measured against everyone's whole. "His scoring through three quarters
 *          alone would rank 3rd in the NBA." Pieces: through three quarters, first halves, second halves, without
 *          free throws, two-pointers alone, threes alone. Kept when the piece would rank in PART.top of the
 *          league's full averages (PART.half for a piece that is half a game or less).
 *   teams  One player's count against whole teams' counts. "More 30-point games than 24 teams." Counts: 30- and
 *          40-point games, triple-doubles, 10-assist games, 15-rebound games, 5-three games, 3-block games,
 *          3-steal games. Kept when he has more than TEAMS.min teams, each team's players all added together.
 *   gap    A leader's distance from second place measured against the distance from second to tenth, on every
 *          list here (the full averages and each piece). Kept when the lead is at least GAP.ratio times that.
 *
 *   noas   The highest-ranked player in scoring, rebounds or assists who has never been an All-Star (the NBA Guide's
 *          selection counts), when he is in the league's top NOAS.top. Needs `allStars`. 0.94 (the user, 11/17: a rookie
 *          "wouldn't have been able to be" one, so it "goes without saying"): never said of a rookie, and not of the
 *          league leader, whose line is `first`.
 *
 *   first  0.94: the league leader in points, rebounds, assists, steals or blocks a game who has never led the league in
 *          it (the NBA Guide's yearly leaders; `leaders`: { stat: [{ season, player }] }). The user: "since he's never led
 *          the league in assists per game before, it is notable that he is now". A rookie's line says "as a rookie".
 *
 * Every finding carries a `surprise` number so the page can list the season's most out-of-line facts for the whole
 * league (the suggestions), and the ones about tonight's teams become storyline candidates (kind `find`).
 * Thresholds are first guesses: the votes on these lines are what should move them.
 */
import { teamFindings } from "./teamfinder.js";
export const QUALIFY = { share: 0.6, games: 5 };       // on the league's lists: 60% of his team's games, at least 5
export const PART = { top: 10, half: 25, max: 2 };     // a piece that would rank this high; at most two pieces in a line
export const TEAMS = { min: 24, least: 3 };            // more than this many of the other 29 teams, with at least 3 of his own
export const GAP = { ratio: 1.0, lists: 2 };
export const NOAS = { top: 12 };
/** A name as the All-Star list is matched: lower case, no accents, no punctuation, no Jr./III. */
export const plainName = (n) => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(?:jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

const ord = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

const PIECES = [
  { key: "q3", say: "through three quarters", half: false, flow: (Q) => (Q.q[0] + Q.q[1] + Q.q[2]) / Q.gp },
  { key: "noft", say: "without his free throws", half: false, box: (g) => g.pts - g.ftm },
  { key: "h1", say: "in first halves", half: true, flow: (Q) => (Q.q[0] + Q.q[1]) / Q.gp },
  { key: "h2", say: "in second halves", half: true, flow: (Q) => (Q.q[2] + Q.q[3]) / Q.gp },
  { key: "two", say: "on two-pointers", half: true, box: (g) => 2 * (g.fgm - g.fg3m) },
  { key: "three", say: "on three-pointers", half: true, box: (g) => 3 * g.fg3m },
];
const COUNTS = [
  { key: "g30", say: "30-point games", is: (g) => g.pts >= 30 }, { key: "g40", say: "40-point games", is: (g) => g.pts >= 40 },
  { key: "td", say: "triple-doubles", is: (g) => [g.pts, g.reb, g.ast, g.stl, g.blk].filter((v) => v >= 10).length >= 3 },
  { key: "a10", say: "games with 10+ assists", is: (g) => g.ast >= 10 }, { key: "r15", say: "games with 15+ rebounds", is: (g) => g.reb >= 15 },
  { key: "t5", say: "games with 5+ threes", is: (g) => g.fg3m >= 5 }, { key: "b3", say: "games with 3+ blocks", is: (g) => g.blk >= 3 },
  { key: "s3", say: "games with 3+ steals", is: (g) => g.stl >= 3 },
];

/**
 * pg: { id: [{ d, team, opp, pts, fgm, fg3m, ftm, reb, ast, stl, blk, min, … }] } (this season, before today);
 * names: { id: name }; qsum: flowstats.json `qsum` ({ id: { gp, q: [4] } }); teamGp: { TRI: games }.
 * → every finding, most surprising first: { kind: "find", test, team, player, key, text, score, surprise, rare }
 */
export function findings({ pg, names = {}, qsum = {}, teamGp = {}, allStars = null, leaders = null, rookies = null }) {
  const P = [];
  for (const [id, gs] of Object.entries(pg || {})) {
    const games = gs.filter((g) => g.min > 0);
    if (!games.length) continue;
    const team = games[games.length - 1].team, gp = games.length;
    P.push({ id, name: names[id] || id, team, gp, games, ppg: games.reduce((a, g) => a + g.pts, 0) / gp, ok: gp >= QUALIFY.games && gp >= QUALIFY.share * (teamGp[team] || gp) });
  }
  const Q = P.filter((p) => p.ok).sort((a, b) => b.ppg - a.ppg);
  const out = [];
  if (Q.length < 30) return out;
  // 1. part: a piece of his scoring against everyone's whole.
  const pieceOf = (p, c) => (c.flow ? (qsum[p.id] && qsum[p.id].gp >= QUALIFY.games ? c.flow(qsum[p.id]) : null) : p.games.reduce((a, g) => a + c.box(g), 0) / p.gp);
  const lists = { ppg: Q.map((p) => ({ p, v: p.ppg })) };
  for (const c of PIECES) lists[c.key] = Q.map((p) => ({ p, v: pieceOf(p, c) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
  for (const p of Q.slice(0, 60)) {
    const hits = [];
    for (const c of PIECES) {
      const v = pieceOf(p, c);
      if (v == null) continue;
      const rank = 1 + Q.filter((o) => o !== p && o.ppg > v).length;
      if (rank <= (c.half ? PART.half : PART.top)) hits.push({ c, v, rank, below: Q.filter((o) => o !== p && o.ppg <= v).slice(0, 2) });
    }
    if (!hits.length) continue;
    hits.sort((a, b) => (a.c.half ? a.rank / PART.half : a.rank / PART.top) - (b.c.half ? b.rank / PART.half : b.rank / PART.top));
    const use = hits.slice(0, PART.max), own = 1 + Q.indexOf(p), best = use[0];
    const surprise = 0.8 + use.reduce((a, h) => a + (1 - (h.rank - 1) / (h.c.half ? PART.half : PART.top)) * (h.c.half ? 1.3 : 1), 0);
    const sayHit = (h) => `his scoring ${h.c.say} alone (${r1(h.v)}) would ${h.rank === 1 ? `still lead everyone else${h.below[0] ? ` (next: ${h.below[0].name}, ${r1(h.below[0].ppg)})` : ""}` : `rank ${ord(h.rank)}${h === best && h.below.length ? `, ahead of ${h.below.map((o) => `${o.name}'s ${r1(o.ppg)}`).join(" and ")}` : ""}`}`;
    const said = use.map(sayHit).join("; ");
    out.push({ kind: "find", test: "part", team: p.team, player: p.name, key: `find|part|${p.id}|${use.map((h) => h.c.key).join("+")}`, surprise, rare: best.rank <= 5,
      text: `${p.name} is ${own === 1 ? "the NBA's leading scorer" : `${ord(own)} in the NBA in scoring`} at ${r1(p.ppg)} a game. ${said[0].toUpperCase()}${said.slice(1)}` });
  }
  // 2. teams: one player's count against whole teams.
  const teams = [...new Set(P.map((p) => p.team))];
  for (const c of COUNTS) {
    const byTeam = Object.fromEntries(teams.map((t) => [t, 0])), mine = [];
    for (const p of P) { let n = 0; for (const g of p.games) if (c.is(g)) { n++; byTeam[g.team] = (byTeam[g.team] || 0) + 1; } if (n >= TEAMS.least) mine.push({ p, n }); }
    for (const { p, n } of mine) {
      const fewer = teams.filter((t) => t !== p.team && byTeam[t] < n), none = fewer.filter((t) => byTeam[t] === 0);
      if (fewer.length < TEAMS.min) continue;
      const allOthers = fewer.length === teams.length - 1;
      out.push({ kind: "find", test: "teams", team: p.team, player: p.name, key: `find|teams|${p.id}|${c.key}`, surprise: 1 + (fewer.length - TEAMS.min) / 5 + (allOthers ? 0.6 : 0), rare: allOthers,
        text: `${p.name} has ${n} ${c.say} this season: more than ${allOthers ? "any other team has in total" : `${fewer.length} of the other ${teams.length - 1} teams have in total`}${none.length >= 5 ? ` (${none.length} teams have none)` : ""}` });
    }
  }
  // 3. gap: a leader far ahead of the field, on the full list and on every piece.
  const SAY = { ppg: "scoring", ...Object.fromEntries(PIECES.map((c) => [c.key, `scoring ${c.say}`])) };
  for (const [k, L] of Object.entries(lists)) {
    if (L.length < 12) continue;
    const lead = L[0].v - L[1].v, field = L[1].v - L[9].v;
    if (!(field > 0) || lead / field < GAP.ratio) continue;
    out.push({ kind: "find", test: "gap", team: L[0].p.team, player: L[0].p.name, key: `find|gap|${L[0].p.id}|${k}`, surprise: 1 + lead / field, rare: lead / field >= 1.5,
      text: `${L[0].p.name} leads the NBA in ${SAY[k]} (${r1(L[0].v)} a game) by ${r1(lead)} over ${L[1].p.name}: a bigger gap than the one between 2nd and 10th (${r1(field)})` });
  }
  // 4. noas: the best of each list who has never been an All-Star.
  if (allStars && allStars.size) {
    const per = (k) => (p) => p.games.reduce((a, g) => a + (g[k] || 0), 0) / p.gp;
    for (const [k, word, unit] of [["pts", "scoring", "points"], ["reb", "rebounding", "rebounds"], ["ast", "assists", "assists"]]) {
      const L = Q.map((p) => ({ p, v: per(k)(p) })).sort((a, b) => b.v - a.v);
      const i = L.findIndex((x) => !allStars.has(plainName(x.p.name)));
      if (i < 0 || i >= NOAS.top || rookies?.has(L[i].p.id) || (i === 0 && leaders?.[k])) continue;
      const ahead = L.slice(0, i).length;
      out.push({ kind: "find", test: "noas", team: L[i].p.team, player: L[i].p.name, key: `find|noas|${L[i].p.id}|${k}`, surprise: 0.9 + (NOAS.top - i) / 6, rare: i < 3,
        text: `${L[i].p.name} ${i ? `is ${ord(i + 1)} in the NBA in ${word}` : `leads the NBA in ${word}`} (${r1(L[i].v)} ${unit} a game) and has never been an All-Star${ahead ? `: the ${ahead === 1 ? "player" : `${ahead} players`} ahead of him ${ahead === 1 ? "has" : "have all"} been one` : ""}` });
    }
  }
  // 5. first: a league leader who has never led the league in that stat.
  if (leaders) {
    const per = (k) => (p) => p.games.reduce((a, g) => a + (g[k] || 0), 0) / p.gp;
    for (const [k, word, unit] of [["pts", "scoring", "points"], ["reb", "rebounding", "rebounds"], ["ast", "assists", "assists"], ["stl", "steals", "steals"], ["blk", "blocks", "blocks"]]) {
      const past = leaders[k];
      if (!past || !past.length) continue;
      const L = Q.map((p) => ({ p, v: per(k)(p) })).sort((a, b) => b.v - a.v), top = L[0];
      if (!top || !(top.v > 0) || (L[1] && L[1].v === top.v)) continue;
      const before = past.filter((e) => plainName(e.player) === plainName(top.p.name));
      if (before.length) continue;
      const rookie = !!rookies?.has(top.p.id), last = past[past.length - 1];
      out.push({ kind: "find", test: "first", team: top.p.team, player: top.p.name, key: `find|first|${top.p.id}|${k}`, surprise: 2.9 + (rookie ? 0.4 : 0), rare: true,       // where the leader's "never an All-Star" line used to sit
        text: `${top.p.name} leads the NBA in ${word} (${r1(top.v)} ${unit} a game)${rookie ? " as a rookie" : `: he has never led the league in ${word}`}${last ? ` (last season's leader: ${last.player}, ${r1(last.value)})` : ""}` });
    }
  }
  // One gap line a player: the list where his lead is widest.
  const gapBest = {};
  for (const f of out) if (f.test === "gap" && (!gapBest[f.player] || f.surprise > gapBest[f.player].surprise)) gapBest[f.player] = f;
  for (let i = out.length - 1; i >= 0; i--) if (out[i].test === "gap" && gapBest[out[i].player] !== out[i]) out.splice(i, 1);
  for (const f of out) f.score = Math.round((2.9 + Math.min(1.1, f.surprise * 0.35)) * 100) / 100;
  return out.sort((a, b) => b.surprise - a.surprise);
}

/**
 * Tonight's teams' findings as storyline candidates, and the league's most out-of-line few for the page.
 * 0.84: with `rows` (the season's games) the team finder (teamfinder.js) runs too, and both kinds share the list:
 * one line a player and one a team, most surprising first.
 */
export function finderLines(args, teams, { top = 8 } = {}) {
  const all = [...findings(args), ...(args.rows ? teamFindings({ rows: args.rows }) : [])].sort((a, b) => b.surprise - a.surprise);
  const seen = new Set(), said = new Set(), league = [];
  for (const f of all) {
    const who = f.player || f.team;
    if (seen.has(who) || said.has(f.text)) continue;
    seen.add(who); said.add(f.text); league.push(f);
    if (league.length >= top) break;
  }
  return { lines: all.filter((f) => teams.has(f.team)), league, n: all.length, teamFinds: all.filter((f) => !f.player).length };
}
