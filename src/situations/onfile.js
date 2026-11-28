/**
 * This season against every season on file, 1993-94 on (0.187.0). The first buzz report (11/28) found three claims we had
 * the games for and never checked; the history is src/data/onfile-history-<last season>.json (tools/onfile-history.mjs).
 *
 *   comboLines   "Luka Dončić has had 30+ points, 5+ rebounds and 5+ assists in 9 straight games: tied for the longest
 *                 run on file (since 1993-94) with …" (a current run, or one this season that reached the top 10)
 *   startLines   "Luka Dončić's 468 points through his first 12 games are the most through 12 games of any season since
 *                 1993-94 (before: …)" (now, or the most at some N this season)
 *   depthLines   "10 Grizzlies scored in double figures vs. NOP on 11/13: the most in a Grizzlies game since 1995-96 (9, three
 *                 times; last 12/2/21)"
 *
 * Every count is this season's games plus the file's; this season's games come first in a tie only when they came first.
 */
import { TEAMS } from "../teams.js";

// [key, label, test]: the combined lines; a line with more in each part is a longer label, tested first
export const COMBOS = [
  ["p30r5a5", "30+ points, 5+ rebounds and 5+ assists", (g) => g.pts >= 30 && g.reb >= 5 && g.ast >= 5],
  ["p25r5a5", "25+ points, 5+ rebounds and 5+ assists", (g) => g.pts >= 25 && g.reb >= 5 && g.ast >= 5],
  ["p20r5a5", "20+ points, 5+ rebounds and 5+ assists", (g) => g.pts >= 20 && g.reb >= 5 && g.ast >= 5],
  ["p30r10", "30+ points and 10+ rebounds", (g) => g.pts >= 30 && g.reb >= 10],
  ["p25r10", "25+ points and 10+ rebounds", (g) => g.pts >= 25 && g.reb >= 10],
  ["p20r10", "20+ points and 10+ rebounds", (g) => g.pts >= 20 && g.reb >= 10],
  ["p25a10", "25+ points and 10+ assists", (g) => g.pts >= 25 && g.ast >= 10],
  ["p20a10", "20+ points and 10+ assists", (g) => g.pts >= 20 && g.ast >= 10],
];
export const START_STATS = ["pts", "reb", "ast", "fg3m"];
export const START_N = 82;
export const ONFILE = { comboTop: 10, comboMin: 3, startTop: 5, startMinN: 5, depthMin: 8 };
const LABEL = { pts: "points", reb: "rebounds", ast: "assists", fg3m: "threes" };
const mdy = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}/${d.slice(2, 4)}`;
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const NUM = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const times = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${NUM[n] || n} times`);
const nick = (t) => TEAMS[t]?.nick || t;

function runsOf(games, test) {
  const out = []; let n = 0, s = 0;
  games.forEach((g, i) => { if (test(g)) { if (!n) s = i; n++; } else { if (n >= 2) out.push({ n, from: games[s].d, to: games[i - 1].d }); n = 0; } });
  if (n >= 2) out.push({ n, from: games[s].d, to: games[games.length - 1].d, current: true });
  return out;
}

/** Combined-line runs this season against the longest on file. One line a player: his best-placed run. */
export function comboLines({ pg = {}, names = {}, hist = null, season = "this season", slate = [] } = {}) {
  if (!hist?.combos) return [];
  const playing = new Set((slate || []).flatMap((g) => [g.home, g.away]));
  const from = hist.from, nm = (id) => names[id] || hist.names?.[id] || id;
  // this season's runs of each kind, every player (they count in each other's places)
  const mine = {};
  for (const [k, , test] of COMBOS) mine[k] = Object.entries(pg).flatMap(([id, gs]) => runsOf(gs, test).map((r) => ({ ...r, id, team: gs[gs.length - 1].team })));
  const best = new Map();
  for (const [k, label] of COMBOS) {
    const top = hist.combos[k]?.top || [];
    for (const r of mine[k]) {
      if (r.n < ONFILE.comboMin) continue;
      const longer = top.filter((x) => x[0] > r.n).length + mine[k].filter((x) => x !== r && x.n > r.n).length;
      const same = top.filter((x) => x[0] === r.n).map((x) => ({ id: x[1], season: x[2] })).concat(mine[k].filter((x) => x !== r && x.n === r.n).map((x) => ({ id: x.id, season })));
      const place = longer + 1;
      if (place > ONFILE.comboTop || (!r.current && place > 3)) continue;
      const atop = top[0] && top[0][0] > r.n ? top[0] : null;
      // grouped a player: "his own runs in 2023-24 (twice) and 2025-26", "James Harden (2018-19)"
      const cut = (l) => {
        const by = new Map(); for (const x of l) { const s = x.season === season ? "this season" : x.season; const m = (by.get(x.id) || new Map()); m.set(s, (m.get(s) || 0) + 1); by.set(x.id, m); }
        const seasons = (m) => [...m].map(([s, c]) => `${s}${c > 1 ? ` (${times(c)})` : ""}`).join(", ").replace(/, ([^,]*)$/, " and $1");
        const parts = [...by].map(([id, m]) => (id === r.id ? `his own run${l.filter((x) => x.id === id).length > 1 ? "s" : ""} in ${seasons(m)}` : `${nm(id)} (${seasons(m)})`));
        return parts.slice(0, 3).join("; ") + (parts.length > 3 ? `; ${parts.length - 3} more players` : "");
      };
      const where = place === 1 ? (same.length ? `tied for the longest run on file (since ${from}) with ${cut(same)}` : `the longest run on file (since ${from})`)
        : `${same.length ? "tied for " : ""}the ${ord(place)}-longest on file (since ${from})${atop ? `; the longest: ${atop[0]}, ${nm(atop[1])}, ${atop[2]}` : ""}`;
      const text = `${nm(r.id)} ${r.current ? "has had" : "had"} ${label} in ${r.n} straight games${r.current ? "" : ` (${md(r.from)} to ${md(r.to)})`}: ${where}`;
      const score = 3 + Math.min(0.9, (ONFILE.comboTop + 1 - place) * 0.09) + (r.current ? 0.3 : 0) + (playing.has(r.team) && r.current ? 0.2 : 0);
      const b = best.get(r.id);
      if (!b || place < b.place || (place === b.place && score > b.score)) best.set(r.id, { place, score, line: { kind: "pstreak", team: r.team, player: nm(r.id), id: r.id, key: `combo|${r.id}|${k}`, text, score: Math.round(score * 100) / 100, rare: place <= 3, onFile: true } });
    }
  }
  return [...best.values()].map((b) => b.line);
}

/** Totals through a player's first N games, now and at their best this season, against every season on file. */
export function startLines({ pg = {}, names = {}, hist = null, season = "this season", slate = [] } = {}) {
  if (!hist?.start) return [];
  const playing = new Set((slate || []).flatMap((g) => [g.home, g.away]));
  const from = hist.from, nm = (id) => names[id] || hist.names?.[id] || id;
  const out = [];
  for (const st of START_STATS) {
    const tab = hist.start[st] || [];
    // this season's totals through N for everyone, for each N
    const cum = Object.fromEntries(Object.entries(pg).map(([id, gs]) => { let v = 0; return [id, gs.map((g) => (v += g[st] || 0))]; }));
    const placeAt = (id, n) => {
      const v = cum[id][n - 1], top = tab[n - 1] || [];
      const above = top.filter((x) => x[0] > v).length + Object.entries(cum).filter(([o, c]) => o !== id && c.length >= n && c[n - 1] > v).length;
      const ahead = top.filter((x) => x[0] > v);
      return { v, place: above + 1, ahead, below: top.find((x) => x[0] < v) || null, tie: top.filter((x) => x[0] === v) };
    };
    for (const [id, gs] of Object.entries(pg)) {
      const n = gs.length;
      if (n < ONFILE.startMinN || n > START_N) continue;
      const now = placeAt(id, n);
      let line = null;
      const nmS = (x) => `${nm(x[1])}, ${x[2]}`;
      // the latest N this season at which he had the most on file (when he doesn't now)
      let peak = null;
      if (now.place !== 1) for (let k = n - 1; k >= ONFILE.startMinN; k--) { const p = placeAt(id, k); if (p.place === 1) { peak = { k, ...p }; break; } }
      const peakSay = (p) => `his ${p.v} through ${p.k} games (through ${md(gs[p.k - 1].d)}) were the most through ${p.k} of any season on file${p.below ? ` (passing ${nm(p.below[1])}'s ${p.below[0]}, ${p.below[2]})` : ""}`;
      if (now.place <= ONFILE.startTop) {
        const lead = now.place === 1 ? `the most` : `the ${ord(now.place)}-most`;
        const tie = now.tie.length ? ` (tied with ${now.tie.slice(0, 2).map(nmS).join("; ")})` : "";
        line = { n, place: now.place, current: true, text: `${nm(id)}'s ${now.v} ${LABEL[st]} through his first ${n} games are ${lead} through ${n} games of any season on file (since ${from})${tie}`
          + (now.place === 1 ? (now.below ? `; the most before: ${now.below[0]}, ${nmS(now.below)}` : "") : now.ahead.length ? `; the most: ${now.ahead[0][0]}, ${nmS(now.ahead[0])}` : "")
          + (peak ? `. Earlier, ${peakSay(peak)}` : "") };
      } else if (peak) {
        line = { n: peak.k, place: 1, current: false, text: `${nm(id)}'s ${peak.v} ${LABEL[st]} through his first ${peak.k} games (through ${md(gs[peak.k - 1].d)}) were the most through ${peak.k} games of any season on file (since ${from})${peak.below ? `; the most before: ${peak.below[0]}, ${nmS(peak.below)}` : ""}. Through ${n} now: ${now.v}, ${ord(now.place)}` };
      }
      if (!line || (st === "pts" && cum[id][line.n - 1] < 100)) continue;
      const team = gs[gs.length - 1].team;
      const score = 3 + (line.place === 1 ? 0.6 : 0.3 - line.place * 0.05) + (st === "pts" ? 0.3 : 0) + (line.current ? 0.2 : 0) + (line.current && playing.has(team) ? 0.2 : 0);
      out.push({ kind: "pace", team, player: nm(id), id, key: `start|${id}|${st}`, stat: st, text: line.text, score: Math.round(score * 100) / 100, rare: line.place === 1, onFile: true });
    }
  }
  // one line a player: the stat where he places best (points first in a tie)
  const best = new Map();
  for (const l of out) { const b = best.get(l.id); if (!b || l.score > b.score) best.set(l.id, l); }
  return [...best.values()];
}

/** Games this season with as many players in double figures as any game of that team's on file. */
export function depthLines({ rows = [], hist = null, today = null } = {}) {
  const T = hist?.double?.teams;
  if (!T) return [];
  const out = [], mine = {};
  const games = [...rows].filter((g) => g.pl && g.hs != null && !g.cupFinal).sort((a, b) => (a.d < b.d ? -1 : 1));
  for (const g of games) for (const [side, t, o] of [[0, g.h, g.a], [1, g.a, g.h]]) {
    const n = Object.values(g.pl).filter((r) => r[0] === side && (r[3] || 0) >= 10).length;
    const h = T[t];
    if (!h || n < ONFILE.depthMin) { (mine[t] ??= []).push({ n, d: g.d }); continue; }
    const before = (mine[t] ??= []);
    const fileMax = Math.max(0, ...Object.keys(h.hist).map(Number)), seasonMax = Math.max(0, ...before.map((x) => x.n));
    const top = Math.max(fileMax, seasonMax);
    if (n >= top) {
      const same = (h.hist[top] || [0, null]), sameNow = before.filter((x) => x.n === top);
      const count = (top === fileMax ? same[0] : 0) + sameNow.length, lastD = [same[1], ...sameNow.map((x) => x.d)].filter(Boolean).sort().pop();
      const text = n > top
        ? `${n} ${nick(t)} scored in double figures vs. ${o} on ${mdy(g.d)}: the most in a ${nick(t)} game on file (since ${h.from}; before, ${top}, ${times(count)}${lastD ? `, last on ${mdy(lastD)}` : ""})`
        : `${n} ${nick(t)} scored in double figures vs. ${o} on ${mdy(g.d)}: tied for the most in a ${nick(t)} game on file (since ${h.from}; ${times(count)} before${lastD ? `, last on ${mdy(lastD)}` : ""})`;
      const age = today ? Math.max(0, (Date.parse(today) - Date.parse(g.d)) / 864e5) : 0;
      out.push({ kind: "pace", team: t, player: null, id: `team:${t}`, key: `depth|${t}|${g.d}`, text, score: Math.round((3.3 + (n > top ? 0.5 : 0) - Math.min(0.8, age * 0.03)) * 100) / 100, rare: n > top, onFile: true, d: g.d });
    }
    before.push({ n, d: g.d });
  }
  return out;
}
