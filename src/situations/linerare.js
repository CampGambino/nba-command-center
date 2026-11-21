/**
 * Rare combinations (0.141.17; the user, 11/21: "I'm more concerned about flagging this stuff in real time in the nba live
 * app", "should warn ahead of time", "five or fewer"). A player's line that, in every column of a combination, has been
 * matched or beaten in 4 or fewer regular-season games since 1993-94, so tonight's would be one of five or fewer: Victor
 * Wembanyama's 52 points and 24 rebounds (no one else), Nikola Jokić's 56-16-15.
 *
 * No imports: the NBA Live bridge reads this file as text (docs/lib/situations/linerare.js, a copy the build keeps) and
 * the build imports it (scripts/situations.js → docs/data/linerare.json). One set of rules for both.
 *
 * The published file holds, per combination, a boundary and a short list:
 *   zmin[x][y]  the smallest value of the third stat at which 4 or fewer games since 1993-94 are at least (x, y, z) in
 *               all three. The count only falls as z rises, so "4 or fewer" is z >= zmin[x][y]. (Few shots: per points
 *               total, the most shots at which 4 or fewer games had at least those points on at most those shots.)
 *   games       every game whose own count is 5 or fewer. Any game at least as big as tonight's line in every column
 *               has a count no bigger than tonight's, so when tonight's is 4 or fewer every such game is on this list:
 *               counting the list gives the exact number, and names them.
 */
export const RARE_MAX = 4;   // games before tonight: tonight's would be the 5th or fewer
export const COMBOS = [
  { id: "pra", keys: ["pts", "reb", "ast"], caps: [100, 40, 30] },
  { id: "p3a", keys: ["pts", "fg3m", "ast"], caps: [100, 16, 30] },
  { id: "rbp", keys: ["reb", "blk", "pts"], caps: [40, 15, 100] },
  { id: "sbp", keys: ["stl", "blk", "pts"], caps: [12, 15, 100] },
  { id: "asp", keys: ["ast", "stl", "pts"], caps: [30, 12, 100] },
];
export const FEW = { id: "few", minPts: 30, capPts: 100, capFga: 60 };   // points on few shots: can be undone by a miss
const WORD = { pts: ["point", "points"], reb: ["rebound", "rebounds"], ast: ["assist", "assists"], fg3m: ["three", "threes"], stl: ["steal", "steals"], blk: ["block", "blocks"] };
const ORDER = ["pts", "reb", "ast", "fg3m", "stl", "blk"];
export const STEP = { pts: 5, reb: 2, ast: 2, fg3m: 1, stl: 1, blk: 1 };   // how close counts as "on the verge"
// A stat counts toward a combination only when it is notable on its own: "50 points, 23 rebounds and 1 block" is rare only
// because of the 1 block, which no one would say. Below these it is left out (set to 0) before anything is counted.
export const NOTABLE = { pts: 20, reb: 10, ast: 10, fg3m: 5, stl: 4, blk: 4 };
function notable(keys, l) { const t = Object.assign({}, l); for (const k of keys) if ((Number(t[k]) || 0) < (NOTABLE[k] || 0)) t[k] = 0; return t; }

// ---------- build side ----------
/** Histogram of lines: Map key "x,y,z" -> count, capped. */
function cell(r, c) { return c.keys.map((k, i) => Math.min(c.caps[i], Math.max(0, Math.floor(Number(r[k]) || 0)))); }
/**
 * hist: { pra: [[x,y,z,n],…], …, few: [[pts,fga,n],…] } (the archive's counts), rows: this season's player lines
 * ({ pts, reb, ast, fg3m, stl, blk, fga }), top: { pra: [[x,y,z,name,team,date],…], … } (the archive's games whose own
 * count is small), season: the same for this season's rows (name, team, date, gid on each). -> the published object.
 */
export function buildRare({ hist, top, rows, from = "1993-94", before = null }) {
  const out = { v: 1, from, before, max: RARE_MAX, combos: {}, few: null };
  for (const c of COMBOS) {
    const [A, B, C] = c.caps, ix = (x, y, z) => (x * (B + 1) + y) * (C + 1) + z, G = new Int32Array((A + 1) * (B + 1) * (C + 1));
    for (const [x, y, z, n] of hist[c.id] || []) G[ix(x, y, z)] += n;
    for (const r of rows) { const [x, y, z] = cell(r, c); G[ix(x, y, z)]++; }
    for (let x = A; x >= 0; x--) for (let y = B; y >= 0; y--) for (let z = C; z >= 0; z--) {
      let v = G[ix(x, y, z)];
      if (x < A) v += G[ix(x + 1, y, z)]; if (y < B) v += G[ix(x, y + 1, z)]; if (z < C) v += G[ix(x, y, z + 1)];
      if (x < A && y < B) v -= G[ix(x + 1, y + 1, z)]; if (x < A && z < C) v -= G[ix(x + 1, y, z + 1)]; if (y < B && z < C) v -= G[ix(x, y + 1, z + 1)];
      if (x < A && y < B && z < C) v += G[ix(x + 1, y + 1, z + 1)];
      G[ix(x, y, z)] = v;
    }
    const zmin = [];
    for (let x = 0; x <= A; x++) { const row = []; for (let y = 0; y <= B; y++) { let z = 0; while (z <= C && G[ix(x, y, z)] > RARE_MAX) z++; row.push(z); } zmin.push(row); }
    const count = (x, y, z) => G[ix(x, y, z)];
    const games = [];
    for (const g of top[c.id] || []) if (count(g[0], g[1], g[2]) <= RARE_MAX + 1) games.push(g);
    for (const r of rows) { const [x, y, z] = cell(r, c); if (count(x, y, z) <= RARE_MAX + 1) games.push([x, y, z, r.name, r.team, r.d, r.gid || null]); }
    out.combos[c.id] = { keys: c.keys, caps: c.caps, zmin, games };
  }
  // Few shots: count(points >= p, shots <= f)
  {
    const P = FEW.capPts, F = FEW.capFga, H = new Int32Array((P + 1) * (F + 1)), ix = (p, f) => p * (F + 1) + f;
    for (const [p, f, n] of hist.few || []) H[ix(p, f)] += n;
    for (const r of rows) H[ix(Math.min(P, r.pts | 0), Math.min(F, r.fga | 0))]++;
    for (let p = P; p >= 0; p--) for (let f = 0; f <= F; f++) { let v = H[ix(p, f)]; if (p < P) v += H[ix(p + 1, f)]; if (f > 0) v += H[ix(p, f - 1)]; if (p < P && f > 0) v -= H[ix(p + 1, f - 1)]; H[ix(p, f)] = v; }
    const fmax = [];
    for (let p = 0; p <= P; p++) { let f = -1; if (p >= FEW.minPts) while (f + 1 <= F && H[ix(p, f + 1)] <= RARE_MAX) f++; fmax.push(f); }
    const games = [];
    for (const g of top.few || []) if (H[ix(g[0], g[1])] <= RARE_MAX + 1) games.push(g);
    for (const r of rows) { const p = Math.min(P, r.pts | 0), f = Math.min(F, r.fga | 0); if (p >= FEW.minPts && H[ix(p, f)] <= RARE_MAX + 1) games.push([p, f, r.name, r.team, r.d, r.gid || null]); }
    out.few = { fmax, games };
  }
  return out;
}

// ---------- live side (the bridge) ----------
function cap(v, c) { return Math.min(c, Math.max(0, Math.floor(Number(v) || 0))); }
/** Games before tonight at least (x, y, z), or null when more than RARE_MAX. exclude: tonight's game id, if a build already has it. */
export function pastCount(data, id, vals, exclude) {
  const c = data && data.combos && data.combos[id];
  if (!c) return null;
  const v = c.keys.map((k, i) => cap(vals[k], c.caps[i]));
  if (v[2] < c.zmin[v[0]][v[1]]) return null;
  const who = c.games.filter((g) => g[0] >= v[0] && g[1] >= v[1] && g[2] >= v[2] && !(exclude && g[6] && String(g[6]) === String(exclude)));
  return who.length <= RARE_MAX ? who : null;
}
export function fewCount(data, pts, fga, exclude) {
  const F = data && data.few;
  if (!F) return null;
  const p = cap(pts, FEW.capPts), f = cap(fga, FEW.capFga);
  if (p < FEW.minPts || f > F.fmax[p]) return null;
  const who = F.games.filter((g) => g[0] >= p && g[1] <= f && !(exclude && g[5] && String(g[5]) === String(exclude)));
  return who.length <= RARE_MAX ? who : null;
}
const n2 = (k, v) => `${v} ${WORD[k][v === 1 ? 0 : 1]}`;
export function phrase(keys, l) {
  const ks = ORDER.filter((k) => keys.includes(k)), parts = ks.map((k) => n2(k, l[k]));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
}
/** The stats of a combination that matter: one whose removal (set to 0) leaves the count the same is left out. */
function needed(data, c, l, n, exclude) {
  let keys = c.keys.slice();
  for (const k of c.keys) {
    if (keys.length <= 1) break;
    const t = Object.assign({}, l); for (const o of c.keys) if (!keys.includes(o) || o === k) t[o] = 0;
    const w = pastCount(data, c.id || COMBO_ID(c), t, exclude);
    if (w && w.length === n) keys = keys.filter((x) => x !== k);
  }
  return keys;
}
const COMBO_ID = (c) => COMBOS.find((x) => x.keys.join() === c.keys.join()).id;
const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
const mdY = (d) => { const [y, m, dd] = String(d).split("-"); return `${+m}/${+dd}/${String(y).slice(2)}`; };
const who = (g, i) => `${g[i]} ${mdY(g[i + 2])}`;
/**
 * A live line -> { hits: [...], warn: [...] }. hit: { id, keys, say, n (games before tonight), before: [names], live: "grow" | "late" }.
 * warn: { id, stat, more, say } — a step of STEP[stat] or less would make a growing line a hit.
 */
export function liveRare(data, l, { exclude = null } = {}) {
  const hits = [], warn = [];
  if (!data || !data.combos) return { hits, warn };
  for (const c0 of COMBOS) {
    const c = Object.assign({ id: c0.id }, data.combos[c0.id] || {});
    if (!c.zmin) continue;
    const ln = notable(c0.keys, l);
    if (c0.keys.filter((k) => ln[k] > 0).length < 2 && !c0.keys.some((k) => (Number(l[k]) || 0) + (STEP[k] || 0) >= NOTABLE[k] && !(ln[k] > 0))) continue;
    const w = c0.keys.filter((k) => ln[k] > 0).length >= 2 ? pastCount(data, c0.id, ln, exclude) : null;
    if (w) {
      const keys = needed(data, c, ln, w.length, exclude);
      hits.push({ id: c0.id, keys, n: w.length, live: "grow", line: phrase(keys, ln),
        before: w.slice().sort((a, b) => String(b[5]).localeCompare(String(a[5]))).map((g) => who(g, 3)) });
      continue;
    }
    for (const k of c0.keys) {
      for (let d = 1; d <= (STEP[k] || 0); d++) {
        const t = notable(c0.keys, Object.assign({}, l, { [k]: (Number(l[k]) || 0) + d }));
        if (c0.keys.filter((x) => t[x] > 0).length < 2) continue;
        const w2 = pastCount(data, c0.id, t, exclude);
        if (w2) { const keys = needed(data, c, t, w2.length, exclude); warn.push({ id: c0.id, stat: k, more: d, n: w2.length, keys, line: phrase(keys, t) }); break; }
      }
    }
  }
  // Points on few shots, unless the points alone are that rare (then it's a single-game list's card, not this one).
  const f = fewCount(data, l.pts, l.fga, exclude);
  if (f && !fewCount(data, l.pts, FEW.capFga, exclude)) hits.push({ id: "few", keys: ["pts", "fga"], n: f.length, live: "late", line: `${l.pts} points on ${l.fga} shot${l.fga === 1 ? "" : "s"}`,
    before: f.slice().sort((a, b) => String(b[4]).localeCompare(String(a[4]))).map((g) => who(g, 2)) });
  // A combination, not one number: a line rare in one stat alone is the all-time single-game lists' card. One entry per wording.
  const seen = new Set();
  const ci = (id) => { const i = COMBOS.findIndex((c) => c.id === id); return i < 0 ? COMBOS.length : i; };
  const H = hits.filter((h) => h.keys.length >= 2).sort((a, b) => a.n - b.n || a.keys.length - b.keys.length || ci(a.id) - ci(b.id))
    .filter((h) => !seen.has(h.line) && seen.add(h.line));
  // Warnings only while nothing is a hit yet; the closest first.
  const seenW = new Set();
  const W = H.length ? [] : warn.filter((w) => w.keys.length >= 2).sort((a, b) => a.n - b.n || a.more - b.more).filter((w) => { const k = warnText(w); return !seenW.has(k) && seenW.add(k); });
  return { hits: H, warn: W };
}
export function ordinal(n) { return ord(n); }
/** "no one else since 1993-94" / "the 3rd time since 1993-94". */
export function countText(n, from = "1993-94") { return n === 0 ? `no one else has done that since ${from}` : `the ${ord(n + 1)} time since ${from}`; }
export function warnText(w, from = "1993-94") {
  const more = `${w.more} more ${WORD[w.stat][w.more === 1 ? 0 : 1]}`;
  return `${more} would make it ${w.line}: ${w.n === 0 ? `no one has done that since ${from}` : `done ${w.n === 1 ? "once" : `${w.n} times`} since ${from}`}`;
}
