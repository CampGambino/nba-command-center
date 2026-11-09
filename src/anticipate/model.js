import { statFromLine } from "../registry/track.js";

/**
 * When will a milestone fall? A small Monte Carlo over the player's upcoming games.
 *
 * Each simulated game: the player plays with probability pPlay (injury status,
 * recent DNPs); if he plays, his stat line is drawn from his recent games
 * (bootstrap), or 1 time in 5 from a smoothed version of them so that lines
 * he hasn't produced lately (a 40-point night) still have a small chance.
 * Counting continues game by game until the need is met.
 *
 * Deterministic: the same inputs and seed give the same answer, so results
 * can be tested and compared between runs.
 */

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNT_KEYS = ["min", "pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta"];

function normal(r) {
  let u = 0, v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * @param {Array<{stats:object, started?:boolean}>} lines games he played, most recent first
 * @param {object} [o]
 * @param {number} [o.smooth=0.2] share of draws from the smoothed distribution
 */
export function makeSampler(lines, { smooth = 0.2 } = {}) {
  const n = lines.length;
  const mean = {}, sd = {};
  for (const k of COUNT_KEYS) {
    const vals = lines.map((l) => l.stats?.[k]).filter((v) => Number.isFinite(v));
    if (!vals.length) continue;
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const v = vals.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, vals.length - 1);
    mean[k] = m;
    sd[k] = Math.max(Math.sqrt(v), Math.sqrt(m)); // never tighter than a Poisson count
  }
  const startRate = n ? lines.filter((l) => l.started).length / n : 0;
  return (r) => {
    if (n && r() >= smooth) {
      const l = lines[Math.floor(r() * n)];
      return { played: true, started: !!l.started, stats: l.stats };
    }
    const stats = {};
    for (const k of Object.keys(mean)) stats[k] = Math.max(0, Math.round(mean[k] + sd[k] * normal(r)));
    return { played: true, started: r() < startRate, stats };
  };
}

/**
 * @param {object} p
 * @param {number} p.need          amount still needed (<= 0: already reached)
 * @param {string} p.stat
 * @param {Function} p.sample      from makeSampler
 * @param {Array<{date:string, pPlay:number}>} p.games  upcoming games, first = next
 * @param {number} [p.sims=4000]
 * @param {number} [p.seed=7]
 * @returns {{ byGame:number[], pNever:number, medianGame:number|null, unknown?:boolean }}
 *   byGame[i] = probability the milestone has fallen by the end of game i (0 = next game)
 */
export function simulate({ need, stat, sample, games, sims = 4000, seed = 7 }) {
  if (!games.length) return { byGame: [], pNever: 1, medianGame: null };
  if (need <= 0) return { byGame: games.map(() => 1), pNever: 0, medianGame: 0 };
  const r = rng(seed);
  const hits = new Array(games.length).fill(0);
  for (let s = 0; s < sims; s++) {
    let cum = 0;
    for (let i = 0; i < games.length; i++) {
      if (r() >= games[i].pPlay) continue;
      const v = statFromLine(stat, sample(r));
      if (v === null) return { byGame: [], pNever: 1, medianGame: null, unknown: true };
      cum += v;
      if (cum >= need) { hits[i]++; break; }
    }
  }
  const byGame = [];
  let acc = 0;
  for (const h of hits) { acc += h; byGame.push(acc / sims); }
  const medianGame = byGame.findIndex((p) => p >= 0.5);
  return { byGame, pNever: 1 - acc / sims, medianGame: medianGame < 0 ? null : medianGame };
}
