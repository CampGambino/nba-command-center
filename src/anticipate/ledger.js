/**
 * The ledger (0.138.0; audit step 2, the user's go 11/20 2:39 PM): one record per claim, whichever detector found it,
 * with a memory across days of when it was first seen, whether its numbers moved, and how many days running it has
 * already been at the top of the page.
 *
 * Why. The briefing's candidate pool (tonightCandidates: notes facts, matchups, prep, records, streaks, shifts…) keyed
 * each line by the detector that made it, so one claim found twice ranked twice; numbers were stripped from the key,
 * so a claim whose numbers moved ("8 points from 6,000" → "2 points from 6,000") read as an old line; and freshness
 * counted days since first seen, not days already shown.
 *
 * A claim is:
 *   - the same subject (player, or the team for team lines) and the same words once numbers are blanked; or
 *   - the same player and two or more of the same decimal numbers in different words (11/20: 5 such pairs in 626 lines,
 *     all right: "Smith: career highs in FG%, 3P% and FT% (45.5%, 38.8%…)" and "Jabari Smith Jr. this season: 45.5% FG
 *     (career-high)…"; Dončić's 38.1 scoring lead in his notes and from the finder). Shared whole numbers alone were
 *     tried and rejected: 14 pairs, nearly all different claims (two Thunder absences, both "6-6 without him").
 *
 * Pure: no I/O. The build keeps `seen` in history/ledger-seen.json.
 */

const plain = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
export const nameKey = (n) => plain(n).toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?$/, "").replace(/[^a-z]/g, "");
/** The words of a line with its numbers blanked: the same claim tomorrow, whatever the numbers then. */
// 0.139: words are taken without a plural "s" ("4 free throws" and "1 free throw" are the same claim). The key is only
// compared with keys made the same way, so "plus" → "plu" on both sides does no harm.
export const claimSig = (t) => plain(t).replace(/ · questionable tonight$/, "").replace(/[\d.,%]+/g, "#").replace(/\s+/g, " ").trim().toLowerCase().replace(/\b([a-z]{3,})s\b/g, "$1").slice(0, 140);
/** A line's numbers, in order: what "changed" is measured on. */
export const numbersOf = (t) => (String(t || "").match(/\d[\d,]*\.?\d*%?/g) || []).join(" ");
const decimals = (t) => new Set((String(t || "").match(/\d+\.\d+%?/g) || []).map((x) => x.replace(/%$/, "")));
export const claimKeyOf = (l) => `${l.team || ""}|${nameKey(l.player)}|${claimSig(l.text)}`;
/** The key the page can rebuild from what it has (a team and the words), to find a line's claim in ledger.json. */
export const pageKey = (team, text) => `${team || ""}|${claimSig(text)}`;
/** A short stable id for a key (FNV-1a, 32 bits, base 36): the page's lookup table carries these, not the long keys. */
export const hashKey = (s) => { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };

export const LEDGER = { sourceBonus: 0.15, sourceCap: 0.3, changed: 0.25, repeat: 0.25, repeatCap: 0.75, keepDays: 30 };
/** Kinds where moved numbers mean the story moved (a streak one longer, a mark closer). A season average moves every
 *  game: there, moved numbers only stop the repeat fade. */
export const PROGRESS_KINDS = new Set(["streak", "pstreak", "milestone", "record", "pace"]);

const dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const prevDay = (d, n = 1) => new Date(Date.parse(`${d}T12:00:00Z`) - n * 864e5).toISOString().slice(0, 10);

/**
 * lines: candidate lines ({ kind, team, player, text, score, key }); seen: { claimKey: { first, nums, numsDay, prevNums, shown: [dates] } }.
 * -> { claims: [claim], of: Map(line -> claim), seen }   (seen updated for today's sighting; `shown` is added by markShown)
 */
export function buildLedger(lines, { seen = {}, today = null } = {}) {
  // 1. Same subject, same words.
  const groups = new Map();
  for (const l of lines || []) {
    const k = claimKeyOf(l);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(l);
  }
  // 2. Same player, two or more of the same decimal numbers, different words: merge (union-find over the groups).
  const keys = [...groups.keys()], parent = Object.fromEntries(keys.map((k) => [k, k]));
  const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  const byPlayer = {};
  for (const k of keys) { const l = groups.get(k)[0]; if (l.player) (byPlayer[`${l.team}|${nameKey(l.player)}`] ??= []).push({ k, d: decimals(l.text) }); }
  for (const list of Object.values(byPlayer)) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    let sh = 0; for (const x of list[i].d) if (list[j].d.has(x)) sh++;
    if (sh >= 2) parent[find(list[j].k)] = find(list[i].k);
  }
  const merged = new Map();
  for (const k of keys) { const r = find(k); if (!merged.has(r)) merged.set(r, []); merged.get(r).push(...groups.get(k)); }
  // 3. One claim per group: its best line speaks for it; the claim's key is the best line's (stable across days while
  //    that line leads; an earlier key of a merged line is carried in `aka` so its history isn't lost).
  const next = {};
  for (const [k, v] of Object.entries(seen || {})) if (!today || !v.last || dayDiff(v.last, today) <= LEDGER.keepDays) next[k] = v;
  const claims = [], of = new Map();
  for (const ls of merged.values()) {
    const sorted = [...ls].sort((a, b) => (b.score || 0) - (a.score || 0)), best = sorted[0];
    const key = claimKeyOf(best), aka = [...new Set(sorted.map(claimKeyOf))].filter((x) => x !== key);
    const prior = next[key] || aka.map((a) => next[a]).find(Boolean) || null;
    const nums = numbersOf(best.text);
    const firstSeen = sorted.map((l) => l.firstSeen).filter(Boolean).sort()[0] || null;
    const first = [prior?.first, firstSeen, today].filter(Boolean).sort()[0];
    // the numbers as they stood on the last earlier day this claim was seen
    const prevNums = prior ? (prior.numsDay === today ? prior.prevNums ?? null : prior.nums ?? null) : null;
    const changed = !!(prior && prevNums != null && prevNums !== nums && first !== today);
    // days running (before today) it was at the top of the page with these same numbers
    const shown = (prior?.shown || []).filter((d) => !today || d < today);
    let streak = 0;
    if (!changed && today) for (let d = prevDay(today); shown.includes(d); d = prevDay(d)) streak++;
    const claim = { key, aka, team: best.team, player: best.player || null, game: best.game || null, kinds: [...new Set(sorted.map((l) => l.kind))], sources: sorted.length,
      best, lines: sorted, first, isNew: first === today, changed, shownStreak: streak };
    claims.push(claim);
    for (const l of ls) of.set(l, claim);
    next[key] = { first, last: today, nums, numsDay: today, prevNums, shown: (prior?.shown || []).slice(-10) };
    for (const a of aka) delete next[a];
  }
  return { claims, of, seen: next };
}

/** The rank change the ledger brings: corroboration (two detectors), a claim whose numbers moved, a repeat that hasn't. */
export function ledgerAdjust(claim) {
  if (!claim) return 0;
  const corroborated = Math.min(LEDGER.sourceCap, LEDGER.sourceBonus * (new Set(claim.lines.map((l) => l.kind)).size - 1));
  const progressed = claim.changed && claim.kinds.some((k) => PROGRESS_KINDS.has(k));
  return corroborated + (progressed ? LEDGER.changed : 0) - Math.min(LEDGER.repeatCap, LEDGER.repeat * claim.shownStreak);
}

/** Record that these claims were at the top of the page today (top ten or deep cuts). */
export function markShown(seen, claims, today) {
  for (const c of claims) { const s = seen[c.key]; if (s && today && !s.shown.includes(today)) s.shown = [...s.shown, today].slice(-10); }
  return seen;
}
