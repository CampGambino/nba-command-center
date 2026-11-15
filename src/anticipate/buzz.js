/**
 * In the news (0.70). The user (11/15): "there is plenty of context behind some of these in the zeitgeist that bounce
 * around nba twitter but wouldn't be accessible through game notes or stats, so knowing when to display or promote
 * them can be tricky." The closest thing we can read for free is what the news is writing about: the articles
 * watcher's last 72 hours of ESPN and Athletic headlines (the Worker's /headlines). A player or team in several
 * headlines is a story people are already talking about, so his lines move up the briefing.
 *
 * buzzCounts(headlines, { players: [name], teams: [tri] }) -> { players: { name: n }, teams: { tri: n }, titles: { name|tri: [title] } }
 */
import { TEAMS } from "../teams.js";

const plain = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'").toLowerCase();
const SUFFIX = /\s+(jr\.?|sr\.?|ii|iii|iv)$/i;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buzzCounts(headlines, { players = [], teams = [] } = {}) {
  const titles = (headlines || []).map((h) => ({ raw: h.title, t: plain(h.title) })).filter((h) => h.t);
  // A city two teams share (Los Angeles, and New York with Brooklyn's Nets) doesn't say which team.
  const cityCount = {};
  for (const x of Object.values(TEAMS)) cityCount[plain(x.city)] = (cityCount[plain(x.city)] || 0) + 1;
  for (const c of ["los angeles", "la", "new york"]) cityCount[c] = 2; // the Lakers and the Clippers; the Knicks and the Nets
  const teamRe = {};
  for (const tri of teams) {
    const x = TEAMS[tri];
    if (!x) continue;
    const words = [x.nick, ...(x.alt || []), ...(cityCount[plain(x.city)] === 1 ? [x.city] : [])].map((w) => esc(plain(w)));
    teamRe[tri] = new RegExp(`\\b(?:${words.join("|")})\\b`);
  }
  const out = { players: {}, teams: {}, titles: {} };
  const note = (k, raw) => { (out.titles[k] ??= []).length < 3 && !out.titles[k].includes(raw) && out.titles[k].push(raw); };
  for (const [tri, re] of Object.entries(teamRe)) for (const h of titles) if (re.test(h.t)) { out.teams[tri] = (out.teams[tri] || 0) + 1; note(tri, h.raw); }
  // Surnames more than one player on the slate shares only count with the full name.
  const sur = (n) => plain(n).replace(SUFFIX, "").split(/\s+/).slice(-1)[0];
  const surCount = {};
  for (const n of new Set(players)) surCount[sur(n)] = (surCount[sur(n)] || 0) + 1;
  for (const name of new Set(players)) {
    const full = new RegExp(`\\b${esc(plain(name).replace(SUFFIX, ""))}\\b`);
    const s = sur(name);
    const last = s.length >= 4 && surCount[s] === 1 ? new RegExp(`\\b${esc(s)}('s)?\\b`) : null;
    for (const h of titles) if (full.test(h.t) || (last && last.test(h.t))) { out.players[name] = (out.players[name] || 0) + 1; note(name, h.raw); }
  }
  return out;
}

/** The briefing's boost for a line: a player in the news counts more than his team being in it. */
export function buzzBoost(l, buzz) {
  if (!buzz) return 0;
  const p = l.player ? buzz.players?.[l.player] || 0 : 0;
  const t = buzz.teams?.[l.team] || 0;
  return Math.min(0.45, 0.15 * p) + (p ? 0 : Math.min(0.2, 0.05 * t));
}
