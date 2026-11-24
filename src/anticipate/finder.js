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
// 0.108.0 (the user, 11/18, on thirteen posts sent as "ideas and concepts… not specific to those players or teams"): "we're
// curious if any players are in their own class compared to the rest of the league"; of a scorer ranked far higher in points
// than in minutes, "who could also exhibit similar proclivity for high productivity without having to play a ton of
// minutes"; and "there should be some leeway in both what is tracked and how many of each is tracked… don't be too narrow
// on scope". So these are searches, not three more detectors: no stat list, threshold or name is fixed in advance.
//   club   every set of two to four season totals, with round thresholds taken from each candidate's own numbers, kept
//          when at most CLUB.most players meet all of them and no single threshold does the work by itself
//          ("Players with 700 points, 350 rebounds, 150 assists and 30 blocks: one man. Nobody else.")
//   rate   a player's rank in a season total set against his rank in minutes, for every total
//   group  a player's ranks inside a group (bench players; rookies), for every total and plus/minus
// 0.115.1 (the user, 11/19): "no need to put restrictions on comparing player to team stats. It's one player against a
// whole team. that limits discovery and preparation." So nothing is asked of the comparison any more: one team is enough,
// his total only has to be more than theirs, and a team counts whatever it has played in the window (one game or more).
// What keeps a second-day-of-the-month line from leading the list is the order, not a filter: `full` games of his own in
// the window before a line gets full weight.
// 0.115.2 (the user, 11/19): "for monthly checks, wait 4 games for the player side before starting to compare into the
// start of the month". `month`: the games he must have played in a calendar month before that month is compared. Nothing
// is asked of the teams.
export const OUTDO = { teams: 1, month: 4, full: 6, lines: 12, early: 7 };
const OUT_STATS = [["blk", "blocks"], ["stl", "steals"], ["oreb", "offensive rebounds"], ["fg3m", "threes"], ["ftm", "free throws"], ["fta", "free throw attempts"], ["ast", "assists"], ["reb", "rebounds"], ["pts", "points"]];
const MONTH_NAME = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const CLUB = { most: 3, sizes: [4, 3, 2], each: 4, wide: 75, near: 0.92, lines: 6, pool: 30 };   // each bar is cleared by 4 to 75 players; together by at most 3
export const RATE = { top: 20, ratio: 2.5, gap: 20, lines: 5 };
export const GROUP = { starts: 0.5, top: 10, need: 3, best: 3, lines: 4 };                              // three top-ten ranks in the group, one of them top three
const TOTALS = [["pts", "points"], ["reb", "rebounds"], ["ast", "assists"], ["stl", "steals"], ["blk", "blocks"], ["fg3m", "threes"]];
const STEP = { pts: (x) => (x >= 1000 ? 100 : 50), reb: (x) => (x >= 300 ? 50 : 25), ast: (x) => (x >= 300 ? 50 : 25), stl: (x) => (x >= 60 ? 10 : 5), blk: (x) => (x >= 60 ? 10 : 5), fg3m: (x) => (x >= 60 ? 10 : 5) };
const FLOOR = { pts: 100, reb: 25, ast: 25, stl: 10, blk: 10, fg3m: 10 };
const listOf = (a) => (a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}` : a[0]);
export const MORE = { least: 3, pts: [25, 30, 35, 40, 45, 50], reb: [0, 5, 8, 10, 12, 15], ast: [0, 5, 8, 10, 12, 15] }; // at least three such games, and more than everyone else's together
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
    const games = gs.filter((g) => g.min > 0 || g.cameo);
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
  // `more` (0.107.1; the user, 11/18, on a "most 45/5/5 games: Dončić 3, every other player combined 2" post: "finding
  // groupings of stats… that leaves all other players combined in a similar or lesser range"): a kind of game one player
  // has had more often than the rest of the league put together. Every grid of points, rebounds and assists is tried;
  // a player keeps the one where he is furthest ahead of everyone else's total.
  {
    const all = P.flatMap((p) => p.games.map((g) => [p, g])), bestMore = {};
    for (const pts of MORE.pts) for (const reb of MORE.reb) for (const ast of MORE.ast) {
      if (pts < 40 && (reb > 0) + (ast > 0) < 1) continue; // a bare "30+ points" is a list, not a kind of game
      const n = new Map(); let total = 0;
      for (const [p, g] of all) if (g.pts >= pts && g.reb >= reb && g.ast >= ast) { n.set(p, (n.get(p) || 0) + 1); total++; }
      if (total < MORE.least) continue;
      const [top, mine] = [...n.entries()].sort((x, y) => y[1] - x[1])[0], others = total - mine;
      if (mine < MORE.least || mine <= others) continue;
      const lead = mine - others, size = pts + 2 * reb + 2 * ast, cur = bestMore[top.id];
      if (!cur || lead > cur.lead || (lead === cur.lead && (mine > cur.mine || (mine === cur.mine && size < cur.size)))) bestMore[top.id] = { top, mine, others, lead, size, pts, reb, ast };
    }
    for (const m of Object.values(bestMore)) {
      const what = [`${m.pts}+ points`, m.reb ? `${m.reb}+ rebounds` : null, m.ast ? `${m.ast}+ assists` : null].filter(Boolean);
      const kind = what.length > 1 ? `${what.slice(0, -1).join(", ")} and ${what[what.length - 1]}` : what[0];
      out.push({ kind: "find", test: "more", team: m.top.team, player: m.top.name, key: `find|more|${m.top.id}`, surprise: 3 + Math.min(1, m.lead * 0.3) + (m.others ? 0 : 0.2), rare: true,
        text: `${m.top.name} has ${m.mine} games with ${kind} this season. ${m.others ? `Every other player combined has ${m.others}` : "No one else has one"}` });
    }
  }
  // ---- 0.108.0: clubs, rate, groups (see CLUB, RATE, GROUP above)
  {
    const tot = P.map((p) => { const t = { p, min: 0, pm: 0, starts: 0 }; for (const [k] of TOTALS) t[k] = 0; for (const g of p.games) { t.min += g.min || 0; t.pm += g.pm || 0; t.starts += g.starter ? 1 : 0; for (const [k] of TOTALS) t[k] += g[k] || 0; } return t; });
    const rankBy = (list, f) => { const m = new Map(); [...list].sort((a, b) => f(b) - f(a)).forEach((t, i, L) => m.set(t, i && f(L[i - 1]) === f(t) ? m.get(L[i - 1]) : i + 1)); return m; };
    const ranks = Object.fromEntries([...TOTALS.map(([k]) => k), "min"].map((k) => [k, rankBy(tot, (t) => t[k])]));
    // club: every set of two to four totals
    const pool = new Set(); for (const [k] of TOTALS) for (const t of tot) if (ranks[k].get(t) <= CLUB.pool) pool.add(t);
    const subsets = []; const keys = TOTALS.map(([k]) => k);
    for (let m = 1; m < 1 << keys.length; m++) { const S = keys.filter((_, i) => m & (1 << i)); if (CLUB.sizes.includes(S.length)) subsets.push(S); }
    const clubs = new Map();
    for (const c of pool) {
      const thr = {}; for (const k of keys) { const v = Math.floor(c[k] / STEP[k](c[k])) * STEP[k](c[k]); thr[k] = v >= FLOOR[k] ? v : null; }
      const alone = {}; for (const k of keys) alone[k] = thr[k] == null ? 0 : tot.filter((t) => t[k] >= thr[k]).length;
      for (const S of subsets) {
        if (S.some((k) => thr[k] == null || alone[k] < CLUB.each || alone[k] > CLUB.wide)) continue; // no bar does the work by itself, and none is one half the league clears
        const members = tot.filter((t) => S.every((k) => t[k] >= thr[k]));
        if (members.length > CLUB.most) continue;
        let near = 0; for (const t of tot) if (!members.includes(t)) near = Math.max(near, Math.min(...S.map((k) => t[k] / thr[k])));
        if (near > CLUB.near) continue;                                                     // someone is a game or two from joining
        const id = members.map((t) => t.p.id).sort().join(","), surprise = 3 + 2 * (1 - near) + (members.length === 1 ? 0.4 : members.length === 2 ? 0.2 : 0) + 0.1 * (S.length - 2), cur = clubs.get(id);
        if (!cur || surprise > cur.surprise) clubs.set(id, { members, S, thr, near, surprise });
      }
    }
    for (const c of [...clubs.values()].sort((a, b) => b.surprise - a.surprise).slice(0, CLUB.lines)) {
      const who = [...c.members].sort((a, b) => b.pts - a.pts), what = TOTALS.filter(([k]) => c.S.includes(k)).map(([k, w]) => `${c.thr[k].toLocaleString("en-US")} ${w}`);
      out.push({ kind: "find", test: "club", team: who[0].p.team, player: who[0].p.name, key: `find|club|${who.map((t) => t.p.id).join("+")}`, surprise: c.surprise, rare: who.length === 1, members: who.map((t) => t.p.name),
        text: `Players this season with ${listOf(what)}: ${listOf(who.map((t) => t.p.name)).replace(/\.$/, "")}. Nobody else` });
    }
    // rate: far higher in a total than in minutes
    const rate = [];
    for (const t of tot) { let best = null; for (const [k, w] of TOTALS) { const r = ranks[k].get(t), rm = ranks.min.get(t); if (r <= RATE.top && rm >= RATE.ratio * r && rm - r >= RATE.gap && (!best || rm / r > best.rm / best.r)) best = { r, rm, w }; } if (best) rate.push({ t, ...best }); }
    for (const x of rate.sort((a, b) => b.rm / b.r - a.rm / a.r).slice(0, RATE.lines))
      out.push({ kind: "find", test: "rate", team: x.t.p.team, player: x.t.p.name, key: `find|rate|${x.t.p.id}`, surprise: 3 + Math.min(1.2, (x.rm - x.r) / 60), rare: false,
        text: `${x.t.p.name} has the ${x.r === 1 ? "" : `${ord(x.r)} `}most ${x.w} in the NBA this season. He ranks ${ord(x.rm)} in minutes played` });
    // group: ranks among bench players, and among rookies
    const groups = [["bench players", tot.filter((t) => t.p.gp >= QUALIFY.games && t.starts / t.p.gp < GROUP.starts)], ...(rookies && rookies.size ? [["rookies", tot.filter((t) => rookies.has(plainName(t.p.name)) || rookies.has(t.p.id))]] : [])];
    for (const [label, G] of groups) {
      if (G.length < 20) continue;
      const gr = Object.fromEntries([...TOTALS, ["pm", "plus/minus"]].map(([k]) => [k, rankBy(G, (t) => t[k])])), found = [];
      const shared = (k, v) => G.filter((x) => x[k] === v).length;                   // a rank half the group shares (no blocks at all) is not a rank
      for (const t of G) { const said = [...TOTALS, ["pm", "plus/minus"]].filter(([k]) => t[k] > 0 && shared(k, t[k]) <= 2).map(([k, w]) => [gr[k].get(t), w, shared(k, t[k]) > 1]).filter(([r]) => r <= GROUP.top); if (said.length >= GROUP.need && said.some(([r]) => r <= GROUP.best)) found.push({ t, said, sum: said.reduce((a, [r]) => a + (GROUP.top + 1 - r), 0) }); }
      for (const f of found.sort((a, b) => b.sum - a.sum).slice(0, GROUP.lines))
        out.push({ kind: "find", test: "group", team: f.t.p.team, player: f.t.p.name, key: `find|group|${label}|${f.t.p.id}`, surprise: 2.8 + Math.min(1.2, f.sum / 20), rare: false,
          text: `${f.t.p.name} among ${label} this season: ${f.said.map(([r, w, tie]) => `${tie ? "tied for " : ""}${ord(r)} in ${w}`).join(", ")}` });   // 0.132.0: a shared rank says so
    }
  }
  // 9. outdo (0.115; the user, 11/19: "does the program check if a player has more than any stat compared to other
  //    teams? and it doesn't have to be season long. checking month stats is also viable… victor wembanyama having more
  //    blocks in a month than several teams"). The `teams` test sets a count of GAMES against teams' counts, season only.
  //    This sets a player's raw total against every team's total, for each stat and each window: the season, this
  //    calendar month, the month just ended (in the first days of the next), and the last 30 days. Every other team
  //    that has played in the window is compared, with no condition (0.115.1). One line a player and stat: the window
  //    where he outdoes the most teams. Each side's games are printed, so a reader sees an uneven comparison for himself.
  const lastDay = P.reduce((m, p) => { const d = String(p.games[p.games.length - 1].d || ""); return d > m ? d : m; }, "");
  if (/^\d{4}-\d\d-\d\d$/.test(lastDay)) {
    const last = lastDay, ym = last.slice(0, 7);
    const back = (n) => new Date(Date.parse(`${last}T12:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
    const prev = (() => { const d = new Date(Date.parse(`${ym}-01T12:00:00Z`) - 864e5); return d.toISOString().slice(0, 7); })();
    const wins = [{ key: "season", say: "this season", in: () => true, bonus: 0.4 }, { key: "month", say: `in ${MONTH_NAME[+ym.slice(5) - 1]}`, in: (d) => d.slice(0, 7) === ym, bonus: 0, monthly: true },
      { key: "d30", say: "in the last 30 days", in: (d) => d > back(30), bonus: 0 }];
    if (+last.slice(8) <= OUTDO.early) wins.push({ key: "prev", say: `in ${MONTH_NAME[+prev.slice(5) - 1]}`, in: (d) => d.slice(0, 7) === prev, bonus: 0.2, monthly: true });
    const best = {};
    for (const w of wins) {
      const T = {}, mine = [];
      for (const p of P) {
        const gs = p.games.filter((g) => typeof g.d === "string" && w.in(g.d)); if (!gs.length) continue;
        const tot = Object.fromEntries(OUT_STATS.map(([k]) => [k, 0]));
        for (const g of gs) { const t = (T[g.team] ||= { ids: new Set(), ...Object.fromEntries(OUT_STATS.map(([k]) => [k, 0])) }); t.ids.add(g.gameId || g.d); for (const [k] of OUT_STATS) { t[k] += g[k] || 0; tot[k] += g[k] || 0; } }
        mine.push({ p, n: gs.length, tot, teams: new Set(gs.map((g) => g.team)) });
      }
      for (const m of mine) for (const [k, word] of OUT_STATS) {
        const v = m.tot[k]; if (!(v > 0) || (w.monthly && m.n < OUTDO.month)) continue;
        const fewer = Object.entries(T).filter(([t, x]) => !m.teams.has(t) && x[k] < v).sort((a, b) => b[1][k] - a[1][k]);
        if (fewer.length < OUTDO.teams) continue;
        const key = `${m.p.id}|${k}`, surprise = 1 + (0.45 * Math.min(fewer.length, 8) + w.bonus) * Math.min(1, m.n / OUTDO.full);
        if (best[key] && best[key].surprise >= surprise) continue;
        best[key] = { kind: "find", test: "outdo", team: m.p.team, player: m.p.name, key: `find|outdo|${m.p.id}|${k}`, surprise, rare: fewer.length >= 5,
          text: `${m.p.name} has ${v} ${word} ${w.say} (${m.n} game${m.n === 1 ? "" : "s"}): more than ${fewer.length === 1 ? `all of ${fewer[0][0]} (${fewer[0][1][k]} in ${fewer[0][1].ids.size})` : `${fewer.length} whole teams (${fewer.slice(0, 4).map(([t, x]) => `${t} ${x[k]} in ${x.ids.size}`).join(", ")}${fewer.length > 4 ? ", …" : ""})`}` };
      }
    }
    out.push(...Object.values(best).sort((a, b) => b.surprise - a.surprise).slice(0, OUTDO.lines));
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
