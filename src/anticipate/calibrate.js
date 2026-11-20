/**
 * Milestone chances, recalibrated (0.140.0; audit step 4, the user's go 11/20 3:54 PM).
 *
 * The simulation's "chance tonight" has run high in the middle: over 10 scored nights (11/10-11/19), 367 calls given
 * 5% or more came true 149 times against 170.7 expected; 25-50% calls happened 30% of the time, 50-75% calls 51%.
 * This fits one correction on the log-odds, p' = 1 / (1 + e^-(a + b·logit p)), to every scored call (the raw chance
 * and whether it happened, history/calls.jsonl), pulled toward "no change" (a = 0, b = 1) so a few nights can't swing
 * it. Fit on 11/10-11/15 and tested on 11/16-11/19 (171 calls): expected hits 73.8 → 64.0 against 65 that happened;
 * Brier 0.1575 → 0.1562. Leaving out each night in turn: 7 of 9 nights better, Brier 0.1666 → 0.1625.
 *
 * Only the chance tonight is corrected (it is the one scored); "within 3 / 5 games" stay as simulated. A per-stat
 * correction (rebounds came true 67% of expected) gained too little to trust yet (Brier 0.1625 → 0.1616) and waits for
 * more nights. The fit is redone at every build from the calls on file, so it follows the model as it changes.
 */
export const CAL = { min: 100, ridge: 2, floor: 0.05 };
const clamp = (p) => Math.min(1 - 1e-4, Math.max(1e-4, p));
const logit = (p) => Math.log(clamp(p) / (1 - clamp(p)));
const sig = (z) => 1 / (1 + Math.exp(-z));

/** calls: [{ p, hit }] (raw chances, 5%+). -> { a, b, n } or null (too few calls: no correction). */
/** Games played and starts: the chance is only whether he plays (or starts), not a stat to reach, so the fit
 *  (learned on points, rebounds…) is neither fitted on them nor applied to them (0.141.1). */
export const PLAY_ONLY = new Set(["gp", "gs"]);
export const playOnlyCall = (c) => / (games|starts)$/.test(String(c?.what || ""));

export function fitCalibration(calls, { min = CAL.min, ridge = CAL.ridge } = {}) {
  const cs = (calls || []).filter((c) => c && Number.isFinite(c.p) && c.p >= CAL.floor && !playOnlyCall(c));
  if (cs.length < min) return null;
  let a = 0, b = 1;
  for (let it = 0; it < 100; it++) {
    let ga = ridge * a, gb = ridge * (b - 1), haa = ridge, hab = 0, hbb = ridge;
    for (const c of cs) {
      const x = logit(c.p), p = sig(a + b * x), r = p - (c.hit ? 1 : 0), w = p * (1 - p);
      ga += r; gb += r * x; haa += w; hab += w * x; hbb += w * x * x;
    }
    const det = haa * hbb - hab * hab, da = (hbb * ga - hab * gb) / det, db = (haa * gb - hab * ga) / det;
    a -= da; b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-10) break;
  }
  return { a: Math.round(a * 1e4) / 1e4, b: Math.round(b * 1e4) / 1e4, n: cs.length };
}

/** The corrected chance. Under 5% (mostly "can't happen tonight") and with no fit, the chance is left as it is. */
export function calibrate(p, fit) {
  if (!fit || p == null || !Number.isFinite(p) || p < CAL.floor || p >= 1) return p;
  return Math.round(sig(fit.a + fit.b * logit(p)) * 1000) / 1000;
}

/** history/calls.jsonl -> [{ d, p, hit, ... }] */
export function readCalls(text) {
  return String(text || "").split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
