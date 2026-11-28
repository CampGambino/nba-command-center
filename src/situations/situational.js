/**
 * Situational splits, players and teams (0.187.0; the user, 11/28: "it all matters if it is a drastic outlier or significant
 * departure from the norm, especially for the top players in the league. same for teams", and "build it").
 *
 * This season's games, cut four ways, each side against the other:
 *   home / road
 *   the second night of a back-to-back / every other game
 *   against teams over .500 (their record before that game) / against the rest
 *   without a teammate (one of his team's scorers, 15+ a game, out while he played) / with him
 * Players (15+ points a game): points a game and shooting. Teams: scoring margin a game and record.
 * A cut is kept when the gap is drastic (players: 6+ points and a quarter of his average, or 10+ points of FG% on 50+ shots
 * a side; teams: 10+ points of margin a game) and the chance that it is luck is 1 in 20 or less (a two-sample test). One
 * line a player or team, its strongest cut; ranked by that chance and how good the player or team is.
 *
 *   situationalLines({ rows, names, slate, teamOf }) -> [{ kind: "sit", team, player, id, key, text, score, cut, chance }]
 */
import { normTail } from "./splits.js";

export const SIT = { ppg: 15, minSide: 4, minB2B: 3, ptsGap: 6, ptsRel: 0.25, fgGap: 0.10, fgMin: 50, teamGap: 10, teamMin: 5, p: 0.05, mateMin: 15, mateMinOut: 3 };
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const pct = (m, a) => (a ? `${r1((100 * m) / a)}%` : "n/a");
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
/** Welch's two-sample test on two lists of numbers: the one-sided chance of a gap this big. */
export function gapChance(a, b, floor = 3) {
  const va = Math.max(floor, sd(a)) ** 2 / a.length, vb = Math.max(floor, sd(b)) ** 2 / b.length;
  return normTail(Math.abs(mean(a) - mean(b)) / Math.sqrt(va + vb));
}
/** Two shooting rates: the one-sided chance of a gap this big (pooled two-proportion test). */
export function rateChance(m1, a1, m2, a2) {
  const p = (m1 + m2) / (a1 + a2), se = Math.sqrt(p * (1 - p) * (1 / a1 + 1 / a2));
  return se > 0 ? normTail(Math.abs(m1 / a1 - m2 / a2) / se) : 1;
}

export function situationalLines({ rows = [], names = {}, slate = [], teamOf = (id, t) => t } = {}) {
  const playing = new Set((slate || []).flatMap((g) => [g.home, g.away]));
  const games = [...rows].filter((g) => g.pl && g.hs != null).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  // each team's record before each game, its previous game's date (back-to-backs) and its games in order
  const rec = {}, prev = {}, ctx = new Map();
  const day = (d) => Date.parse(`${d}T12:00:00Z`) / 864e5;
  for (const g of games) {
    const c = {};
    for (const [t, o] of [[g.h, g.a], [g.a, g.h]]) {
      const ro = rec[o] || { w: 0, l: 0 };
      c[t] = { home: t === g.h && !g.n, road: t !== g.h && !g.n, b2b: prev[t] != null && day(g.d) - prev[t] === 1, oppAbove: ro.w + ro.l >= 5 ? ro.w > ro.l : null, opp: o };
    }
    ctx.set(g, c);
    const hw = g.hs > g.as;
    (rec[g.h] ??= { w: 0, l: 0 })[hw ? "w" : "l"]++; (rec[g.a] ??= { w: 0, l: 0 })[hw ? "l" : "w"]++;
    prev[g.h] = day(g.d); prev[g.a] = day(g.d);
  }
  const played = (g, id) => g.pl[id] && (g.pl[id][2] > 0 || (g.z || []).includes(id));
  // players' games: { d, team, pts, fgm, fga, c }
  const P = {};
  for (const g of games) for (const id of Object.keys(g.pl)) {
    if (!played(g, id)) continue;
    const r = g.pl[id], t = r[0] === 0 ? g.h : g.a;
    (P[id] ??= []).push({ g, team: t, pts: r[3], fgm: r[4], fga: r[5], c: ctx.get(g)[t] });
  }
  const ppgOf = (id) => mean(P[id].map((x) => x.pts));
  const out = [];
  // [cut, side A, side B]: a game in neither (a neutral site; an opponent with fewer than 5 games) counts on neither side
  const CUTS = [
    ["home", (x) => x.c.home, (x) => x.c.road, "at home", "on the road"],
    ["b2b", (x) => x.c.b2b, (x) => !x.c.b2b, "on the second night of a back-to-back", "in his other games"],
    ["above", (x) => x.c.oppAbove === true, (x) => x.c.oppAbove === false, "against teams over .500 (their record going in)", "against the rest"],
  ];
  for (const [id, list] of Object.entries(P)) {
    if (list.length < 8) continue;
    const ppg = ppgOf(id);
    if (ppg < SIT.ppg) continue;
    const tri = teamOf(id, list[list.length - 1].team) || list[list.length - 1].team, name = names[id] || id;
    const cands = [];
    const judge = (cut, a, b, sayA, sayB, min = SIT.minSide) => {
      if (a.length < min || b.length < SIT.minSide) return;
      const pa = mean(a.map((x) => x.pts)), pb = mean(b.map((x) => x.pts));
      const fa = a.reduce((s, x) => [s[0] + x.fgm, s[1] + x.fga], [0, 0]), fb = b.reduce((s, x) => [s[0] + x.fgm, s[1] + x.fga], [0, 0]);
      const ptsBig = Math.abs(pa - pb) >= SIT.ptsGap && Math.abs(pa - pb) >= SIT.ptsRel * ppg;
      const fgBig = fa[1] >= SIT.fgMin && fb[1] >= SIT.fgMin && Math.abs(fa[0] / fa[1] - fb[0] / fb[1]) >= SIT.fgGap;
      if (!ptsBig && !fgBig) return;
      const chance = Math.min(ptsBig ? gapChance(a.map((x) => x.pts), b.map((x) => x.pts), 4) : 1, fgBig ? rateChance(fa[0], fa[1], fb[0], fb[1]) : 1);
      if (chance > SIT.p) return;
      cands.push({ cut, chance, small: Math.min(a.length, b.length) < SIT.minSide, text: `${name} ${sayA}: ${r1(pa)} points a game on ${pct(fa[0], fa[1])} shooting (${a.length} games); ${sayB}: ${r1(pb)} on ${pct(fb[0], fb[1])} (${b.length})` });
    };
    for (const [cut, a, b, sayA, sayB] of CUTS) judge(cut, list.filter(a), list.filter(b), sayA, sayB, cut === "b2b" ? SIT.minB2B : SIT.minSide);
    // without a teammate: one of his team's scorers (15+ a game) out of a game he played, for the same team
    const team = list[list.length - 1].team;
    const mates = Object.keys(P).filter((m) => m !== id && P[m].some((x) => x.team === team) && ppgOf(m) >= SIT.mateMin);
    for (const m of mates) {
      const mine = list.filter((x) => x.team === team);
      const mateTeamGames = new Set(P[m].filter((x) => x.team === team).map((x) => x.g));
      if (!mateTeamGames.size) continue;
      const ds = [...mateTeamGames].map((g) => g.d).sort(), first = ds[0], lastD = ds[ds.length - 1];
      // only games while the teammate was on the team (his first to his last game for it), as the With / without page counts
      const span = mine.filter((x) => x.g.d >= first && x.g.d <= lastD);
      const without = span.filter((x) => !mateTeamGames.has(x.g)), withHim = span.filter((x) => mateTeamGames.has(x.g));
      if (without.length < SIT.mateMinOut) continue;
      judge(`without|${m}`, without, withHim, `without ${names[m] || m}`, `with him`, SIT.mateMinOut);
    }
    if (!cands.length) continue;
    const best = cands.sort((a, b) => a.chance - b.chance)[0];
    // three games a side (back-to-backs, a teammate out) is a small sample: ranked a little lower
    const score = 2.8 + Math.min(0.8, -Math.log10(best.chance) / 3) + Math.min(0.6, (ppg - SIT.ppg) / 20) + (playing.has(tri) ? 0.2 : 0) - (best.small ? 0.3 : 0);
    out.push({ kind: "sit", team: tri, player: name, id, key: `sit|${id}|${best.cut}`, text: best.text, score: Math.round(score * 100) / 100, cut: best.cut.split("|")[0], chance: Number(best.chance.toPrecision(2)), rare: best.chance <= 0.001 });
  }
  // teams: margin a game
  const T = {};
  for (const g of games) for (const t of [g.h, g.a]) { const mine = t === g.h; (T[t] ??= []).push({ g, m: mine ? g.hs - g.as : g.as - g.hs, c: ctx.get(g)[t] }); }
  for (const [t, list] of Object.entries(T)) {
    const wp = list.filter((x) => x.m > 0).length / list.length, cands = [];
    const sayT = { home: ["at home", "on the road"], b2b: ["on the second night of a back-to-back", "in its other games"], above: ["against teams over .500 (their record going in)", "against the rest"] };
    for (const [cut, ta, tb] of CUTS) {
      const a = list.filter(ta), b = list.filter(tb), min = cut === "b2b" ? SIT.minB2B : SIT.teamMin;
      if (a.length < min || b.length < SIT.teamMin) continue;
      const ma = mean(a.map((x) => x.m)), mb = mean(b.map((x) => x.m));
      if (Math.abs(ma - mb) < SIT.teamGap) continue;
      const chance = gapChance(a.map((x) => x.m), b.map((x) => x.m), 8);
      if (chance > SIT.p) continue;
      const wl = (l) => `${l.filter((x) => x.m > 0).length}-${l.filter((x) => x.m < 0).length}`, sg = (x) => (x >= 0 ? `+${r1(x)}` : `−${r1(-x)}`);
      cands.push({ cut, chance, text: `${t} ${sayT[cut][0]}: ${wl(a)}, ${sg(ma)} a game; ${sayT[cut][1]}: ${wl(b)}, ${sg(mb)}` });
    }
    if (!cands.length) continue;
    const best = cands.sort((a, b) => a.chance - b.chance)[0];
    const score = 2.8 + Math.min(0.8, -Math.log10(best.chance) / 3) + Math.min(0.5, Math.max(0, wp - 0.4)) + (playing.has(t) ? 0.2 : 0);
    out.push({ kind: "sit", team: t, player: null, id: `team:${t}`, key: `sit|${t}|${best.cut}`, text: best.text, score: Math.round(score * 100) / 100, cut: best.cut, chance: Number(best.chance.toPrecision(2)), teamLine: true, rare: best.chance <= 0.001 });
  }
  return out.sort((a, b) => b.score - a.score);
}
