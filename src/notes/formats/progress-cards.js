import { num } from "../stats.js";
import { cleanName } from "../names.js";
import { squeeze, isLetterSpaced } from "./common.js";

/**
 * Progress cards in two columns, under letter-spaced section headings.
 * Seen in: Brooklyn (2026-11-08 notes, p. 11, "Milestone Tracker"):
 *
 *   P O I N T S                              R E B O U N D S
 *   Julius Randle  9 5 % C O M P L E T E     Julius Randle  9 9 % C O M P L E T E
 *   15,352 / 16,000          ~31 games       7,080 / 7,100            ~3 games
 *
 * Each column is read top to bottom on its own. A card is a name cell followed
 * by a "% COMPLETE" cell, then a "current / target" cell. The printed percent
 * must agree with current / target (rounded down) or the card is flagged: that
 * catches a total paired with the wrong name.
 */
const SECTION = {
  POINTS: "pts", REBOUNDS: "reb", OFFENSIVEREBOUNDS: "oreb", DEFENSIVEREBOUNDS: "dreb",
  ASSISTS: "ast", STEALS: "stl", BLOCKS: "blk", "THREE-POINTERS": "fg3m", THREEPOINTERS: "fg3m",
  FREETHROWS: "ftm", FIELDGOALS: "fgm", GAMESPLAYED: "gp", GAMESSTARTED: "gs",
};
const PCT = /^(\d{1,3})%COMPLETE$/i;
const PAIR = /^([\d,]+)\s*\/\s*([\d,]+)$/;

export function readProgressCards(doc) {
  const milestones = [], problems = [];
  for (const page of doc.pages) {
    const title = page.lines.find((l) => /UPCOMINGCAREERMILESTONES/i.test(squeeze(l.text)));
    if (!title) continue;
    const mid = (page.width || 612) / 2;
    for (const side of [0, 1]) {
      let stat = null, statRaw = null, card = null;
      for (const line of page.lines) {
        if (line.y >= title.y) continue;
        const cells = line.cells.filter((c) => (side === 0 ? c.cx < mid : c.cx >= mid));
        for (let k = 0; k < cells.length; k++) {
          const t = cells[k].text.trim();
          const sq = squeeze(t).toUpperCase();
          if (isLetterSpaced(t) && SECTION[sq]) { stat = SECTION[sq]; statRaw = sq; card = null; continue; }
          const pct = sq.match(PCT);
          if (pct) {
            const name = k > 0 ? cells[k - 1].text.trim() : null;
            card = name ? { player: cleanName(name), pct: Number(pct[1]) } : null;
            if (!name) problems.push({ page: page.page, problem: "progress card without a name", text: line.text });
            continue;
          }
          const pair = t.match(PAIR);
          if (!pair) continue;
          if (!card || !stat) { problems.push({ page: page.page, problem: "progress total with no card above it", text: t }); continue; }
          const current = num(pair[1]), target = num(pair[2]);
          const pctNow = target ? Math.floor((current / target) * 100) : null;
          milestones.push({
            format: "progress-cards", page: page.page, player: card.player, statRaw, stat,
            target, current, scope: "career",
            checks: pctNow !== card.pct ? [`card says ${card.pct}% but ${current} / ${target} is ${pctNow}%: total may belong to another card`] : [],
            text: `${card.player}: ${statRaw} ${t} (${card.pct}% complete)`,
          });
          card = null;
        }
      }
    }
  }
  return { milestones, problems };
}
