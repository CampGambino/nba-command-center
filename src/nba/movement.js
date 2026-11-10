import { teamFromSlug, teamFromText } from "../teams.js";
import { nameKey } from "../notes/names.js";

/**
 * Pure readers for NBA.com's lineups and transaction files: no file system, no
 * network, so the website's in-browser code can import them too (docs/lib/).
 * The cached client that fetches them is in ./static.js.
 */
/** Player slug as nba.com writes it ("lamelo-ball", "dennis-schroder", "naeqwan-tomlin"). */
export const slugOf = (name) => nameKey(name).replace(/[^a-z0-9 ]/g, "").trim().replace(/\s+/g, "-");

export function readLineups(json) {
  const games = [];
  for (const g of json?.games || []) {
    const teams = {};
    for (const side of ["homeTeam", "awayTeam"]) {
      const t = g?.[side];
      if (!t?.teamAbbreviation) continue;
      teams[t.teamAbbreviation] = (t.players || []).map((p) => ({
        nbaId: p.personId != null ? String(p.personId) : null, name: p.playerName || `${p.firstName || ""} ${p.lastName || ""}`.trim(),
        lineupStatus: p.lineupStatus || null, position: p.position || null, rosterStatus: p.rosterStatus || null, at: p.timestamp || null,
      }));
    }
    games.push({ gameId: g.gameId || null, status: g.gameStatus ?? null, teams });
  }
  return { games };
}

/** Transactions, newest first, keyed for lookup by player slug. */
export function readMovement(json) {
  const rows = (json?.NBA_Player_Movement?.rows || []).map((r) => ({
    date: String(r.TRANSACTION_DATE || "").slice(0, 10), type: r.Transaction_Type || null,
    team: teamFromSlug(r.TEAM_SLUG || "") || null, nbaId: r.PLAYER_ID != null ? String(Math.round(r.PLAYER_ID)) : null,
    slug: r.PLAYER_SLUG || null, text: r.TRANSACTION_DESCRIPTION || "",
  })).filter((r) => r.date).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const bySlug = new Map();
  for (const r of rows) if (r.slug) { if (!bySlug.has(r.slug)) bySlug.set(r.slug, []); bySlug.get(r.slug).push(r); }
  return { rows, bySlug };
}

/**
 * What the transaction log says about a player and a team, as of a date.
 *   left:   his latest move took him away from `team` (trade elsewhere, waived by team)
 *   with:   his latest move put him on `team` (signing, trade to team, claim)
 *   null:   nothing about him, or nothing involving this team
 * Evidence, not proof: the log can lag, and ESPN's roster can disagree.
 */
// nba.com keeps suffixes in slugs ("jabari-smith-jr", "gary-payton-ii", even "ernest-udeh,-jr").
const SUFFIXES = ["", "-jr", ",-jr", "-sr", "-ii", "-iii", "-iv"];
export function rowsFor(movement, name) {
  const base = slugOf(name);
  for (const sfx of SUFFIXES) {
    const list = movement?.bySlug?.get(base + sfx);
    if (list?.length) return list;
  }
  return null;
}

export function standing(movement, name, team, asOf) {
  const list = rowsFor(movement, name);
  if (!list?.length) return { status: null, nbaId: null };
  const recent = list.filter((r) => !asOf || r.date <= asOf);
  const last = recent[0];
  const nbaId = list.find((r) => r.nbaId)?.nbaId || null;
  if (!last) return { status: null, nbaId };
  const fromTeam = /\bfrom\s+(.+?)\.?$/.exec(last.text)?.[1];
  if (last.type === "Trade") {
    if (last.team === team) return { status: "with", nbaId, last };
    if (fromTeam && teamFromText(fromTeam) === team) return { status: "left", nbaId, last, to: last.team };
  }
  if (last.type === "Waive" && last.team === team) return { status: "left", nbaId, last };
  if ((last.type === "Signing" || last.type === "ContractConverted" || last.type === "AwardOnWaivers") && last.team === team) return { status: "with", nbaId, last };
  if (last.team && last.team !== team && last.type !== "Waive") return { status: "left", nbaId, last, to: last.team };
  return { status: null, nbaId, last };
}

