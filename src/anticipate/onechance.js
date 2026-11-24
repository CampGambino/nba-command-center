/**
 * One chance per milestone (0.145.0).
 *
 * The consistency audit, 11/24: Paul George, 5 threes from 2,500, read 19% on the Watch List (docs/data/watch.json, the
 * milestones' simulation in src/anticipate/watch.js) and 32% on the Records page (docs/data/records.json, the records'
 * simulation in src/records/guide.js). Same career total, two models: the milestones sample his last 20 games (6 from
 * last season, where he hit fewer threes) and read the injury report, lineups and return dates; the records sample this
 * season only, and model the active player being passed. Each then gets its own recalibration. The user: "one chance".
 *
 * Where a records item and a milestone are the same chase (player, stat, target and his total now), both publish one number:
 *   - the records' number when it simulates a rival who also plays (the milestones don't model him);
 *   - otherwise the milestones' number (it knows more about whether he plays tonight).
 * The number that gave way is kept beside it as `own` ({ pTonight, pTonightRaw }) so each model is still scored on its own
 * calls (src/records/predictions.js reads records' `own`; the milestones' calls are saved before this runs).
 *
 * Mutates both. -> { matched, fromMilestones, fromRecords }
 */
export function oneChance(recordsOut, watch) {
  const W = new Map();
  for (const t of watch?.teams || []) for (const i of t.items || []) {
    // the total is part of the key: a franchise mark and a career mark can share a target number
    if (i.espnId && i.stat && i.target != null && i.current != null && typeof i.pTonight === "number") W.set(`${i.espnId}|${i.stat}|${i.target}|${i.current}`, i);
  }
  const out = { matched: 0, fromMilestones: 0, fromRecords: 0 };
  if (!W.size) return out;
  const seen = new Set();
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { for (const x of o) walk(x); return; }
    if (o.id && o.stat && o.target != null && o.now != null && typeof o.pTonight === "number" && !seen.has(o)) {
      seen.add(o);
      const w = W.get(`${o.id}|${o.stat}|${o.target}|${o.now}`);
      if (w) {
        out.matched++;
        const rival = Array.isArray(o.rivals) && o.rivals.some((r) => r.tonight);
        if (rival) {
          if (!w.own) w.own = { pTonight: w.pTonight, pTonightRaw: w.pTonightRaw ?? null };
          w.pTonight = o.pTonight; w.pTonightRaw = o.pTonightRaw ?? o.pTonight; if (typeof o.pNext5 === "number") w.pNext5 = o.pNext5;
          w.chanceFrom = "records"; out.fromRecords++;
        } else {
          if (!o.own) o.own = { pTonight: o.pTonight, pTonightRaw: o.pTonightRaw ?? null };
          o.pTonight = w.pTonight; o.pTonightRaw = w.pTonightRaw ?? w.pTonight;
          if (typeof w.pNext5 === "number") o.pNext5 = w.pNext5;
          if (typeof w.pPlayTonight === "number" && o.tonight) o.pPlay = w.pPlayTonight;
          o.chanceFrom = "milestones"; out.fromMilestones++;
        }
        return;
      }
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(recordsOut);
  return out;
}
