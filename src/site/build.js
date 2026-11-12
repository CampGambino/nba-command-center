import fs from "node:fs";
import path from "node:path";
import { parseNotes } from "../notes/parse.js";
import { buildWatch } from "../anticipate/watch.js";
import { discoverMilestones } from "../registry/discover.js";

/**
 * Build the website's data (docs/data/watch.json) from teams' notes.
 *
 * Teams whose notes layout has been hand-checked against the PDF are listed in
 * VERIFIED_FORMATS. For any other team the parser's output is unproven, so a
 * milestone is publishable only when ESPN independently confirms its total;
 * everything else from that team is shown as review.
 */
export const VERIFIED_FORMATS = new Set(["CLE", "LAL", "SAS", "PHX", "ATL", "CHA"]); // hand-checked 2026-11-09

/**
 * @param {object} p
 * @param {Array<{team:string, buf?:Buffer, notes?:{status:string, why?:string, error?:string}}>} p.entries
 * @param {Array} [p.games] the day's games (readScoreboard), for the games strip
 */
export async function buildSite({ entries, games = [], espn, nba = null, today, root }) {
  const reports = [], teams = [];
  for (const e of entries) {
    const base = { team: e.team, notesStatus: e.notes?.status || "local", notesWhy: e.notes?.why || e.notes?.error || null, verifiedFormat: VERIFIED_FORMATS.has(e.team) };
    const problems = [];
    let parsed = null;
    if (!e.buf) problems.push(base.notesWhy || "no notes");
    else {
      try { parsed = await parseNotes(e.buf, { team: e.team }); }
      catch (err) { problems.push(`couldn't read the notes: ${err.message}`); }
    }
    let watchItems = [], tonightGame = null;
    if (parsed) {
      const w = await buildWatch({ team: e.team, notesDate: parsed.meta.gameDate, milestones: parsed.milestones, espn, nba, today });
      reports.push({ ...w, opponent: parsed.meta.opponent, notesStatus: base.notesStatus });
      watchItems = w.items; tonightGame = w.tonightGame; problems.push(...w.problems);
    }
    // Round career numbers within ~3 games, straight from ESPN, for every rostered
    // player; notes milestones win where both exist. Projected separately with
    // today's date: ESPN's totals are already current, nothing to roll forward.
    const found = await discoverMilestones({ team: e.team, espn, skip: watchItems });
    problems.push(...found.problems);
    if (found.milestones.length) {
      const w2 = await buildWatch({ team: e.team, notesDate: today, milestones: found.milestones, espn, nba, today });
      reports.push({ ...w2, origin: "espn" });
      watchItems = [...watchItems, ...w2.items];
      tonightGame = tonightGame || w2.tonightGame;
    }
    const items = watchItems.map((i) => {
      let publishable = i.publishable, review = i.checks;
      if (i.origin === "notes" && !base.verifiedFormat) {
        // ESPN can confirm the player's own total. For a round number that is the
        // whole milestone; for a pass, the other player's total (the target) is
        // still only what the unchecked parser read.
        if (!(i.tracking === "confirmed" || i.tracking === "corrected") || i.kind !== "round") publishable = false;
        review = [...(review || []), `${e.team}'s notes layout hasn't been hand-checked yet: only round-number totals ESPN confirms are publishable`];
      }
      return {
        player: i.player, espnId: i.espnId, nbaId: i.nbaId ?? null, origin: i.origin, stat: i.stat, label: i.label, kind: i.kind, scope: i.scope,
        target: i.target, current: i.current, need: i.need,
        // Some notes print only the rank a pass reaches ("3rd all-time"), not who is passed.
        passing: i.passing ? { player: i.passing.player ?? (i.passing.rank ? `No. ${i.passing.rank}` : null), rank: i.passing.rank ?? null } : null,
        importance: i.importance, why: i.why,
        publishable, status: i.status, review, tracking: i.tracking,
        pTonight: i.pTonight ?? null, pNext3: i.pNext3 ?? null, pNext5: i.pNext5 ?? null, eta: i.eta ?? null,
        pPlayTonight: i.pPlayTonight ?? null,
        injury: i.injury ? { status: i.injury.status, returnDate: i.injury.returnDate } : null,
        confidence: i.confidence ?? null, games: i.form?.games ?? null, lineup: i.lineup ?? null,
        reached: !!i.reached, stale: !!i.stale, note: i.note ?? null,
      };
    });
    teams.push({ ...base, opponent: parsed?.meta.opponent ?? null, notesDate: parsed?.meta.gameDate ?? null, tonightGame, problems, items });
  }

  const docs = path.join(root, "docs");
  fs.mkdirSync(path.join(docs, "data"), { recursive: true });
  const site = { generatedAt: new Date().toISOString(), today, games: games.map((g) => ({ id: g.id, start: g.start, home: g.home, away: g.away, homeTri: g.homeTri, awayTri: g.awayTri })), teams };
  fs.writeFileSync(path.join(docs, "data", "watch.json"), JSON.stringify(site));
  // Same code the tests cover, for the page's live countdowns.
  for (const rel of ["teams.js", "notes/names.js", "espn/parse.js", "registry/track.js", "nba/movement.js", "situations/ratings.js", "espn/pbp.js", "situations/withwithout.js", "situations/leaders.js", "anticipate/tonight.js"]) {
    const dst = path.join(docs, "lib", rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(root, "src", rel), dst);
  }
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", `predictions-${today}.json`), JSON.stringify({ today, reports }, null, 1));
  return { site, reports };
}
