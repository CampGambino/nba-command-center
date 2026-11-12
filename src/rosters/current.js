/**
 * Each player's CURRENT team, for the league-wide player lists (Clutch, 4th quarter, Streaks).
 * Without this, a player's team is the one in his last box score, so a traded player shows his old
 * team until he plays for the new one (Nique Clifford, SAC → OKC, 11/8, debuted 11/10).
 *
 * Evidence (the user's design, 11/12: NBA.com's official moves are the fallback that catches changes):
 *   - his newest official move on NBA.com (nba.com/players/transactions) dated on or after his last game,
 *     if it moves him (a trade or signing elsewhere → that team; waived → no team): that, even if ESPN
 *     hasn't caught up;
 *   - otherwise ESPN's team rosters, read on every build: the team that lists him now;
 *   - otherwise his last box score.
 * Only the resulting team code reaches the public site; no NBA.com text is published.
 *
 * Team-specific numbers (Team leaders, With / without, team files) stay with the team they were
 * made for: his Kings games stay Kings games.
 */
export const NBA_TEAM_ID = {
  1610612737: "ATL", 1610612738: "BOS", 1610612739: "CLE", 1610612740: "NOP", 1610612741: "CHI", 1610612742: "DAL",
  1610612743: "DEN", 1610612744: "GSW", 1610612745: "HOU", 1610612746: "LAC", 1610612747: "LAL", 1610612748: "MIA",
  1610612749: "MIL", 1610612750: "MIN", 1610612751: "BKN", 1610612752: "NYK", 1610612753: "ORL", 1610612754: "IND",
  1610612755: "PHI", 1610612756: "PHX", 1610612757: "POR", 1610612758: "SAC", 1610612759: "SAS", 1610612760: "OKC",
  1610612761: "TOR", 1610612762: "UTA", 1610612763: "MEM", 1610612764: "WAS", 1610612765: "DET", 1610612766: "CHA",
};
export const MOVES_URL = "https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json";
export const ESPN_ROSTER = (tri) => `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${tri.toLowerCase()}/roster`;

export const nameKey = (n) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[.'’]/g, "").replace(/-/g, " ").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ").replace(/\s+/g, " ").trim();

/**
 * NBA.com's movement file -> [{ d, type, team, from, key }], newest first, for player moves on or after `since`.
 * type: "to" (trade, signing, waiver claim) or "out" (waived). key: the player's name key (from the slug).
 */
export function readMoves(json, { since = "0000" } = {}) {
  const out = [];
  for (const r of json?.NBA_Player_Movement?.rows || []) {
    const d = String(r.TRANSACTION_DATE || "").slice(0, 10);
    if (d < since || !r.PLAYER_ID || !r.PLAYER_SLUG) continue;
    const team = NBA_TEAM_ID[Math.round(r.TEAM_ID)];
    if (!team) continue;
    const t = r.Transaction_Type;
    const type = t === "Waive" ? "out" : t === "Trade" || t === "Signing" || t === "AwardOnWaivers" ? "to" : null;
    if (!type) continue; // ContractConverted: same team
    out.push({ d, type, team, from: t === "Trade" ? NBA_TEAM_ID[Math.round(r.Additional_Sort)] || null : null, key: nameKey(String(r.PLAYER_SLUG).replace(/-/g, " ")) });
  }
  return out.sort((a, b) => b.d.localeCompare(a.d));
}

/** ESPN roster JSON -> [{ id, name }]. */
export const readEspnRoster = (json) => (json?.athletes || []).map((a) => ({ id: String(a.id), name: a.displayName || a.fullName }));

/**
 * players: { id: { name, team, d } } (team and date of his last box score).
 * espn: { TRI: [{ id, name }] } (teams that couldn't be read are left out). moves: readMoves() output.
 * -> { id: { team, was, since, source } } for players whose current team isn't his last box-score team
 *    (team null = waived, no new team yet).
 */
export function currentTeams(players, espn, moves) {
  const onEspn = {};
  for (const [tri, list] of Object.entries(espn || {})) for (const p of list) onEspn[p.id] = tri;
  const movesBy = {};
  for (const m of moves || []) (movesBy[m.key] ??= []).push(m); // newest first
  const out = {};
  for (const [id, p] of Object.entries(players)) {
    // 1. An official move on or after his last game (a trade the day after counts; one from before doesn't).
    // Only his newest move counts (waived, then re-signed by the same team = still there).
    const newest = (movesBy[nameKey(p.name)] || []).find((x) => x.d >= p.d);
    const m = newest && (newest.type === "out" ? newest.team === p.team : newest.team !== p.team) ? newest : null;
    if (m) { out[id] = { team: m.type === "out" ? null : m.team, was: p.team, since: m.d, source: m.type === "out" ? "waived" : m.from ? "trade" : "signing" }; continue; }
    // 2. ESPN's roster now (only when every team's roster was read, so "not listed" means something).
    const e = onEspn[id];
    if (e && e !== p.team) out[id] = { team: e, was: p.team, since: null, source: "espn" };
  }
  return out;
}
