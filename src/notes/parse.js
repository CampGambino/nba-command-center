import { readPdf } from "./pdf-layout.js";
import { readMeta } from "./meta.js";
import { readNeedsList } from "./formats/needs-list.js";
import { readStatColon } from "./formats/stat-colon.js";
import { readInlineTracker } from "./formats/inline-tracker.js";
import { readTrackerTable } from "./formats/tracker-table.js";
import { readNeedsGrid } from "./formats/needs-grid.js";
import { readLeaderboards } from "./formats/leaderboards.js";
import { readColumnTable } from "./formats/column-table.js";
import { readNeedsRows } from "./formats/needs-rows.js";
import { readProgressCards } from "./formats/progress-cards.js";
import { readBioFor } from "./formats/bio-for.js";
import { readNeedsSentence } from "./formats/needs-sentence.js";
import { readNarrative, readAwayFrom } from "./narrative.js";
import { statLabel, qualifierOf } from "./stats.js";
import { nameKey, sameName, displayName } from "./names.js";

/**
 * Game notes PDF -> { meta, milestones, leaderboards, notes, roster, problems }.
 *
 * Every milestone carries the exact text it came from and a list of `checks`
 * that failed. Anything with a failed check has status "review": it is kept
 * and shown, but never treated as publishable. The rule throughout: when the
 * parser is not sure, the answer is "review", never "ok".
 */
export async function parseNotes(buf, { team } = {}) {
  const doc = await readPdf(buf);
  return parseDoc(doc, { team });
}

export function parseDoc(doc, { team } = {}) {
  const meta = readMeta(doc, team);
  const problems = [];

  const raw = [
    ...readNeedsList(doc),
    ...readStatColon(doc),
    ...readInlineTracker(doc),
  ];
  const tracker = readTrackerTable(doc);
  raw.push(...tracker.milestones);
  problems.push(...tracker.problems);
  const grid = readNeedsGrid(doc);
  raw.push(...grid.milestones);
  problems.push(...grid.problems);
  // Layouts learned 2026-11-10 (MIL, PHI, IND, ORL, BKN, MIN, DAL, HOU).
  for (const r of [readColumnTable(doc), readNeedsRows(doc), readProgressCards(doc), readBioFor(doc)]) {
    raw.push(...r.milestones);
    problems.push(...r.problems);
  }
  raw.push(...readNeedsSentence(doc, { team }));
  const away = readAwayFrom(doc);
  raw.push(...away.filter((a) => a.format === "away-from"));

  const leaderboards = readLeaderboards(doc).map(checkLeaderboard);
  const roster = buildRoster(doc, raw, leaderboards);

  // One spelling per player: "D. MITCHELL" and "DONOVAN MITCHELL" both become
  // "Donovan Mitchell" (the fullest roster spelling). An initial that fits two
  // different roster players is left alone and flagged.
  const canon = (name) => {
    if (!name) return { name, ambiguous: false };
    const hits = [...roster.values()].filter((r) => sameName(r.name, name));
    const full = [...new Set(hits.map((r) => nameKey(r.name)).filter((k) => !/^[a-z]\.? /.test(k)))];
    if (full.length > 1) return { name: displayName(name), ambiguous: true };
    const best = hits.map((r) => displayName(r.name)).sort((a, b) => b.replace(/\./g, "").length - a.replace(/\./g, "").length)[0];
    return { name: best || displayName(name), ambiguous: false };
  };

  const all = [
    ...raw.map((r) => (r.kind === "pass" ? passFromRow(r, team) : toMilestone(r, team))),
    ...away.filter((a) => a.format === "away-from-pass").map((a) => passFromText(a, team)),
    ...leaderboards.flatMap((lb) => chasesFrom(lb, roster, team)),
  ].map((m) => {
    const p = canon(m.player);
    const out = { ...m, player: p.name, passing: m.passing ? { ...m.passing, player: canon(m.passing.player).name } : undefined };
    if (p.ambiguous) addCheck(out, `"${m.player}" could be more than one player on this roster`);
    return out;
  });
  const milestones = dedupe(all);
  flagTwoTotals(milestones);

  // A page with a milestones heading that yielded nothing is a parsing gap,
  // not an empty page: say so instead of staying silent.
  const pagesWithFinds = new Set(milestones.flatMap((m) => m.sources.map((s) => s.page)));
  for (const page of doc.pages) {
    const heading = page.lines.find((l) => /\bMILESTONES?\b/.test(l.text) && l.text.length < 80);
    if (heading && !pagesWithFinds.has(page.page)) problems.push({ page: page.page, problem: `page has a milestones heading ("${heading.text.trim()}") but nothing was extracted from it` });
  }

  return {
    meta: { ...meta, pageCount: doc.pageCount },
    milestones,
    leaderboards,
    // Forward-looking sentences, verbatim, for the "from the notes" panel.
    notes: readNarrative(doc),
    roster: [...roster.values()],
    problems,
  };
}

function addCheck(m, c) {
  if (!m.checks.includes(c)) m.checks.push(c);
  m.status = m.checks.length ? "review" : "ok";
}

function toMilestone(r, team) {
  const checks = [...(r.checks || [])];
  if (!r.player) checks.push("no player heading found for this line");
  if (!r.stat) checks.push(`unrecognized stat "${r.statRaw}"`);
  if (r.statMismatch) checks.push(`stat wording doesn't agree: ${r.statMismatch}`);
  if (r.target == null || r.current == null) checks.push("missing number");
  const need = r.target != null && r.current != null ? r.target - r.current : null;
  if (need != null && need <= 0) checks.push(`already reached: current ${r.current} vs target ${r.target} (notes are stale or mislabeled)`);
  if (r.needStated != null && need != null && r.needStated !== need) checks.push(`stated need ${r.needStated} doesn't match ${r.target} - ${r.current} = ${need}`);
  return {
    team,
    player: r.player,
    stat: r.stat,
    label: r.stat ? statLabel(r.stat) : r.statRaw,
    kind: "round",
    scope: r.scope,
    current: r.current,
    target: r.target,
    need,
    ranks: r.nbaRank || r.teamRank ? { nba: r.nbaRank, team: r.teamRank, teamLabel: r.teamRankLabel } : undefined,
    sources: [{ format: r.format, page: r.page, text: r.text }],
    checks,
    status: checks.length ? "review" : "ok",
  };
}

/**
 * A pass read from a table row or sentence: who is passed is printed, and
 * sometimes their total; when both totals are known, the stated need must agree.
 */
function passFromRow(r, team) {
  const checks = [...(r.checks || [])];
  if (!r.player) checks.push("no player heading found for this line");
  if (!r.stat) checks.push(`unrecognized stat "${r.statRaw}"`);
  if (r.statMismatch) checks.push(`stat wording doesn't agree: ${r.statMismatch}`);
  const computed = r.target != null && r.current != null ? r.target - r.current : null;
  if (r.needStated != null && computed != null && r.needStated !== computed) checks.push(`stated need ${r.needStated} doesn't match ${r.target} - ${r.current} = ${computed}`);
  const need = computed ?? r.needStated ?? null;
  if (need != null && need <= 0) checks.push(`already passed: current ${r.current} vs target ${r.target} (notes are stale or mislabeled)`);
  if (r.scope === "unknown") checks.push("can't tell whether this is an NBA or a franchise list");
  return {
    team,
    player: r.player,
    stat: r.stat,
    label: r.stat ? statLabel(r.stat) : r.statRaw,
    kind: "pass",
    scope: r.scope,
    current: r.current ?? null,
    target: r.target ?? null,
    need,
    tieAt: r.passing?.total != null && r.current != null ? r.passing.total - r.current : null,
    passing: { ...r.passing, teammate: false },
    list: null,
    sources: [{ format: r.format, page: r.page, text: r.text }],
    checks,
    status: checks.length ? "review" : "ok",
  };
}

/** "Brandon Miller is 18 3-pointers made away from passing PJ Washington for seventh-most in franchise history." */
function passFromText(a, team) {
  const checks = [];
  if (!a.stat) checks.push(`unrecognized stat "${a.statRaw}"`);
  return {
    team,
    player: a.player,
    stat: a.stat,
    label: a.stat ? statLabel(a.stat) : a.statRaw,
    kind: "pass",
    scope: a.scope,
    current: null,
    target: null,
    need: a.need,
    passing: { player: a.passing, forWhat: a.forWhat },
    list: null,
    sources: [{ format: a.format, page: a.page, text: a.text }],
    checks,
    status: checks.length ? "review" : "ok",
  };
}

function checkLeaderboard(lb) {
  const checks = [...(lb.preChecks || [])];
  for (let i = 1; i < lb.rows.length; i++) {
    const a = lb.rows[i - 1], b = lb.rows[i];
    if (b.rank < a.rank) checks.push(`rank goes backwards at ${a.rank} -> ${b.rank}`);
    if (b.total > a.total) checks.push(`out of order: #${b.rank} ${b.player} (${b.total}) is above #${a.rank} ${a.player} (${a.total})`);
    if (b.rank === a.rank && b.total !== a.total && !a.tied && !b.tied) checks.push(`rank ${a.rank} printed twice without a tie (${a.player} ${a.total}, ${b.player} ${b.total})`);
  }
  if (!lb.stat) checks.push(`couldn't tell which stat "${lb.title}" is`);
  return { ...lb, checks };
}

const ROSTER_STOP = /^(last|home|road|game|games|guard|forward|center|position|starters?|bench|coach|notes|record|season|career|series|team|player|stats?|info|information)$/i;
const SUFFIX = /\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i;

/**
 * Current players named in these notes: milestone headings, "#NN Name" player
 * headings, names printed with a capitalized surname inside leaderboards (teams
 * use that to mark active players), and "2018-present" spans in all-time lists.
 */
function buildRoster(doc, raw, leaderboards) {
  const roster = new Map();
  const add = (name, how) => {
    if (!name) return;
    const words = name.replace(SUFFIX, "").split(" ");
    if (words.length < 2 || words.some((w) => ROSTER_STOP.test(w))) return;
    const k = nameKey(name);
    if (k && !roster.has(k)) roster.set(k, { name, how });
  };
  raw.forEach((r) => add(r.player, "milestone section"));
  for (const page of doc.pages) {
    for (const line of page.lines) {
      // Single spaces only: a double space is a gap between cells, and a name
      // never spans two cells ("Devin Booker  Guard").
      for (const m of line.text.matchAll(/#\d{1,2} (?:[FGC](?:-[FGC])? )?(\p{Lu}[\p{L}’'.\-]+(?: \p{Lu}[\p{L}’'.\-]+){1,2})/gu)) {
        add(m[1].replace(/ (G|F|C|PG|SG|SF|PF)$/, ""), "player heading");
      }
    }
  }
  for (const lb of leaderboards) {
    for (const r of lb.rows) {
      if (r.active) add(r.player, `"${r.years}" in an all-time list`);
      const base = r.player.replace(SUFFIX, "");
      const last = base.split(" ").pop();
      const letters = last.replace(/[^A-Za-z]/g, "");
      if (letters.length >= 3 && last === last.toUpperCase() && base !== base.toUpperCase()) add(r.player, "capitalized in leaderboard");
      if (/^[A-Z]\.\s+[A-Z’'\-]{3,}$/.test(base)) add(r.player, "capitalized in leaderboard");
    }
  }
  return roster;
}

const onRoster = (roster, name) => [...roster.values()].some((r) => sameName(r.name, name));

function chasesFrom(lb, roster, team) {
  if (!lb.stat) return [];
  const out = [];
  for (let i = 1; i < lb.rows.length; i++) {
    const chaser = lb.rows[i], target = lb.rows[i - 1];
    if (!onRoster(roster, chaser.player)) continue;
    const checks = [...lb.checks.filter((c) => c.includes(chaser.player) || c.includes(target.player))];
    if (chaser.total > target.total) checks.push("chaser already ahead of the name listed above (list is out of order)");
    if (lb.scope === "streak") checks.push("streak list: only a live chase if this streak is still active (verify with game logs)");
    if (lb.scope === "season-record") checks.push("single-season list: only a live chase if this row is the current season (verify with game logs)");
    if (lb.scope === "season") checks.push("this-season leaders list: ranks change nightly (verify with current stats)");
    if (lb.scope === "unknown") checks.push(`can't tell whether "${lb.title}" is an NBA or a franchise list`);
    if (lb.qualifier) checks.push(`list is limited to a subset ("${lb.qualifier}"): the wording must say so`);
    if (lb.average) checks.push("per-game averages are rounded in the notes; a gap of a few tenths may not be real");
    // Equal totals just above: passing the target also passes everyone tied with it.
    const tiedAbove = lb.rows.filter((r, k) => k < i && r.total === target.total).length;
    if (tiedAbove > 1) checks.push(`${tiedAbove} players are tied at ${target.total}: passing one passes all of them`);
    const gap = Math.round((target.total - chaser.total) * 10) / 10;
    const need = lb.average ? gap : target.total - chaser.total + 1;
    out.push({
      team,
      player: chaser.player,
      stat: lb.stat,
      label: lb.stat === "list" ? lb.title.toLowerCase() : statLabel(lb.stat),
      kind: lb.average ? "average-gap" : "pass",
      scope: lb.scope,
      current: chaser.total,
      target: lb.average ? target.total : target.total + 1,
      need,
      tieAt: lb.average ? null : target.total - chaser.total,
      passing: { player: target.player, total: target.total, rank: target.rank, teammate: onRoster(roster, target.player) },
      fromRank: chaser.rank,
      list: lb.title,
      sources: [{ format: "leaderboard", page: lb.page, text: `${lb.section ? lb.section + " / " : ""}${lb.title}: #${target.rank} ${target.player} ${target.total}, #${chaser.rank} ${chaser.player} ${chaser.total}` }],
      checks,
      status: checks.length ? "review" : "ok",
    });
  }
  return out;
}

/**
 * One player, one stat, one scope: every row in the notes must imply the same
 * current total. Indiana (2026-11-09) lists under Ivica Zubac both "7,000 career
 * rebounds, needs 329" (6,671 now) and "6,000 career rebounds, needs 706"
 * (5,294 now), so one of those rows belongs to someone else. Both are flagged.
 */
function flagTwoTotals(list) {
  const groups = new Map();
  for (const m of list) {
    if (m.current == null || !m.stat || m.stat === "list" || !m.player || (m.kind !== "round" && m.kind !== "pass")) continue;
    if (m.list && qualifierOf(m.list)) continue; // a subset list ("as a starter") has its own total
    if (m.scope !== "career" && m.scope !== "franchise" && m.scope !== "nba" && m.scope != null) continue;
    const scope = m.scope === "nba" ? "career" : m.scope ?? "career";
    const k = `${nameKey(m.player)}|${m.stat}|${scope}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  for (const g of groups.values()) {
    const totals = [...new Set(g.map((m) => m.current))];
    if (totals.length < 2) continue;
    for (const m of g) addCheck(m, `the notes imply ${totals.length} different current ${m.label || m.stat} totals for ${m.player} (${totals.join(", ")}): a row may belong to another player`);
  }
}

/**
 * Merge the same milestone found twice. Round numbers merge on player + stat +
 * target; passes merge on player + stat + scope + who is being passed, so a
 * chase on an NBA list is never merged with one on a franchise list.
 */
function dedupe(list) {
  const out = [];
  const same = (o, m) => {
    if (o.kind !== m.kind || o.stat !== m.stat || !o.player || !m.player || !sameName(o.player, m.player)) return false;
    if (m.kind === "round") return o.target === m.target;
    // A rank printed without the passed player's name ("12,092 Career Assists
    // (3rd all-time)") is the same chase as a list row with that name and target.
    if (o.passing && m.passing && (!o.passing.player || !m.passing.player)) return o.target != null && o.target === m.target;
    return o.scope === m.scope && !!o.passing && !!m.passing && sameName(o.passing.player, m.passing.player);
  };
  for (const m of list) {
    const twin = out.find((o) => same(o, m));
    if (!twin) { out.push(m); continue; }
    twin.sources.push(...m.sources);
    if (twin.current != null && m.current != null && twin.current !== m.current) addCheck(twin, `sources disagree on current total: ${twin.current} vs ${m.current}`);
    if (twin.need != null && m.need != null && twin.need !== m.need) addCheck(twin, `sources disagree on what's needed: ${twin.need} vs ${m.need}`);
    if (twin.current == null && m.current != null) Object.assign(twin, { current: m.current, target: m.target, list: m.list, fromRank: m.fromRank });
    // Fill in what one source lacks: the passed player's name and total, or the scope.
    if (twin.passing && m.passing) {
      if (!twin.passing.player && m.passing.player) twin.passing = { ...m.passing, forWhat: twin.passing.forWhat ?? m.passing.forWhat, rank: twin.passing.rank ?? m.passing.rank };
      if (twin.tieAt == null && m.tieAt != null) twin.tieAt = m.tieAt;
    }
    const scopeKnown = twin.scope === "nba" || twin.scope === "franchise";
    m.checks.filter((c) => !(scopeKnown && /^can't tell whether .* is an NBA or a franchise list$/.test(c))).forEach((c) => addCheck(twin, c));
    twin.status = twin.checks.length ? "review" : "ok";
  }
  return out;
}
