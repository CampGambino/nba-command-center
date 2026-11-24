/**
 * Tonight's record chances, kept for scoring (0.141.9): every item in the published records (all-time and franchise
 * passes, NBA Cup lists, season pace, franchise single games) that plays tonight with a chance, once each, with the raw
 * chance (what the recalibration learns from) and the chance to play. Used by the build (scripts/situations.js, into
 * history/predictions-records-<date>.json.gz) and by tools/backfill-record-predictions.mjs for past nights.
 * 0.145.0: where the published number is the milestones' (src/anticipate/onechance.js), the records' own raw chance is
 * what is kept: each model is scored on its own calls.
 */
export function tonightChances(recordsOut) {
  const keep = [], seen = new Set();
  const walk = (o, list) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { for (const x of o) walk(x, list); return; }
    if (o.tonight && o.id && o.stat && Number.isFinite(o.need) && typeof o.pTonight === "number") {
      const k = `${o.id}|${o.stat}|${o.need}|${o.kind}`;
      if (!seen.has(k)) {
        seen.add(k);
        keep.push({ list, id: String(o.id), who: o.who, team: o.team, stat: o.stat, label: o.label, kind: o.kind, need: o.need, target: o.target ?? null,
          passing: o.passing?.name ?? null, pTonight: o.own ? o.own.pTonightRaw ?? o.own.pTonight : o.pTonightRaw ?? o.pTonight, pPlay: o.pPlay ?? null,
          // 0.141.12: the active players being passed who also play tonight. The chance already counts what they add, so
          // the call is a hit only if he finishes ahead of them (scripts/score.js), not merely gets `need`.
          ...(Array.isArray(o.rivals) && o.rivals.some((r) => r.tonight) ? { rivals: o.rivals.filter((r) => r.tonight).map((r) => ({ name: r.name, id: r.id ?? null, team: r.team ?? null })) } : {}) });
      }
      return;
    }
    for (const v of Object.values(o)) walk(v, list);
  };
  walk(recordsOut?.items, "records"); walk(recordsOut?.cup, "cup"); walk(recordsOut?.franchise, "franchise");
  walk(recordsOut?.seasonPace, "pace"); walk(recordsOut?.franchiseGame, "franchise-game");
  return keep;
}

/** Whether a record chase came in tonight (0.141.12): he needed `need` more to get past the mark, plus whatever the active
 *  players he is passing added tonight (the most of any of them), as the simulation (src/anticipate/model.js) counts it. */
export const recordHit = (got, need, rivalGot = 0) => got >= need + rivalGot;
