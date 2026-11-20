/**
 * What the Watch List shows up front, and what it folds one click away (0.137.0; the user, 11/20: "find the fat and
 * redundancies… find a way to highlight the pertinent information"). Nothing is dropped from the data or from Discord
 * or NBA Live; these only decide what the page shows first. Measured on the 11/20 build (9 games): 10,300 words,
 * 12 of the briefing's 23 lines repeated word for word in the storylines, 21 of 75 matchup lines the same series
 * template across games, 193 notes items, 327 milestone rows.
 */

export const TRIM = { shiftsPerTeam: 1, seriesLines: 2, seriesMin: 1.5, playerVsTeamPerTeam: 1, notesPerTeam: 3 };

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
/** A shift in a small-count stat at a tiny rate ("0.6 steals over his last 10"): folded even as a team's only shift. */
export const smallShift = (l) => { const m = String(l.text || "").match(/\baveraging ([\d.]+) (steals|blocks|turnovers)\b/); return !!m && Number(m[1]) < 1.5; };

/**
 * Tonight's storylines for one game: a line already in the briefing (same words) is not repeated; a team keeps its
 * strongest shift (the rest are often a few tenths of a steal or a turnover), and none under 1.5 steals, blocks or
 * turnovers a game. -> { shown, folded, inBrief }
 */
export function trimStories(lines, briefTexts = new Set()) {
  const inBrief = [], shown = [], folded = [], shifts = {};
  const byScore = [...lines].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const keepShift = new Set();
  for (const l of byScore) if (l.kind === "shift" && !smallShift(l)) { const k = l.team || "?"; if ((shifts[k] = (shifts[k] || 0) + 1) <= TRIM.shiftsPerTeam) keepShift.add(l); }
  for (const l of lines) {
    if (briefTexts.has(norm(l.text))) inBrief.push(l);
    else if (l.kind === "shift" && !keepShift.has(l)) folded.push(l);
    else shown.push(l);
  }
  return { shown, folded, inBrief };
}

/** A matchup line's family: the night's edges, series history, or one player's record against tonight's opponent. */
export function matchupFamily(i) {
  if (i.edge) return "edge";
  return /^(?:Streak vs |\d+-\d+ vs |Best vs |Worst vs )/.test(i.tag || "") ? "player" : "series";
}

/**
 * One game's matchup lines: none already in tonight's storylines; every edge; the two strongest series lines scoring 1.5 or more (one if none does: the
 * "All-time" and "Largest wins" lines score 1 or under); one player-vs-opponent line a team. -> { shown, folded }
 */
export function trimMatchups(items, storyTexts = []) {
  // A line already in tonight's storylines (the series streaks are both) is not repeated.
  const stories = storyTexts.map(norm), said = (i) => { const t = norm(i.text); return t.length > 20 && stories.some((s) => s.includes(t)); };
  const inStories = items.filter(said);
  const by = items.filter((i) => !said(i)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)), keep = new Set(), perTeam = {};
  const series = by.filter((i) => matchupFamily(i) === "series"), strong = series.filter((i) => (i.score ?? 0) >= TRIM.seriesMin);
  for (const i of (strong.length ? strong : series).slice(0, strong.length ? TRIM.seriesLines : 1)) keep.add(i);
  for (const i of by) {
    const f = matchupFamily(i);
    if (f === "edge") keep.add(i);
    if (f === "player" && (perTeam[i.team] = (perTeam[i.team] || 0) + 1) <= TRIM.playerVsTeamPerTeam) keep.add(i);
  }
  return { shown: by.filter((i) => keep.has(i)).sort((a, b) => (b.edge ? 1 : 0) - (a.edge ? 1 : 0) || (b.score ?? 0) - (a.score ?? 0)), folded: by.filter((i) => !keep.has(i)), inStories };
}

/** A notes fact with a hook: a rank, record, streak, club or race (the tag says so), or one in play tonight. */
export const hasHook = (x) => !!(x.hook?.live || (x.tag && !/^(?:Notes|Coach vs\. opponent)$/.test(x.tag)));

/**
 * One team's notes facts: those already in tonight's storylines are not repeated; the three strongest shown, facts
 * with a hook before those without, then by score. -> { shown, folded, inStories }
 */
export function trimNotes(list, storyTexts = []) {
  const stories = storyTexts.map(norm);
  const said = (x) => { const t = norm(x.text).slice(0, 60); return t.length > 20 && stories.some((s) => s.includes(t)); };
  const inStories = list.filter(said), rest = list.filter((x) => !said(x));
  const ranked = [...rest].sort((a, b) => hasHook(b) - hasHook(a) || (b.score ?? 0) - (a.score ?? 0));
  return { shown: ranked.slice(0, TRIM.notesPerTeam), folded: ranked.slice(TRIM.notesPerTeam), inStories };
}

export const briefTextSet = (b) => new Set([...(b?.top || []), ...(b?.deep || [])].map((l) => norm(l.text)));
