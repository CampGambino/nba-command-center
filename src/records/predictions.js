/**
 * Tonight's record chances, kept for scoring (0.141.9): every item in the published records (all-time and franchise
 * passes, NBA Cup lists, season pace, franchise single games) that plays tonight with a chance, once each, with the raw
 * chance (what the recalibration learns from) and the chance to play. Used by the build (scripts/situations.js, into
 * history/predictions-records-<date>.json.gz) and by tools/backfill-record-predictions.mjs for past nights.
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
          passing: o.passing?.name ?? null, pTonight: o.pTonightRaw ?? o.pTonight, pPlay: o.pPlay ?? null });
      }
      return;
    }
    for (const v of Object.values(o)) walk(v, list);
  };
  walk(recordsOut?.items, "records"); walk(recordsOut?.cup, "cup"); walk(recordsOut?.franchise, "franchise");
  walk(recordsOut?.seasonPace, "pace"); walk(recordsOut?.franchiseGame, "franchise-game");
  return keep;
}
