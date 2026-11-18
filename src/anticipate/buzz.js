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

// Capitalized words that come before a surname without being a first name.
const NOT_NAMES = new Set([...Object.values(TEAMS).flatMap((x) => [x.nick, x.city, ...(x.alt || [])].map(plain)), "why", "how", "what", "when", "where", "and", "after", "with", "as", "for", "the", "is", "on", "in", "rookie", "star", "guard", "forward", "center", "coach", "big", "veteran", "sources", "report", "watch", "inside", "film", "nba"]);

// A team's own words (0.106): "Washington leading Memphis early" is the Wizards, not P.J. Washington, so a surname that is
// also a city or a nickname never counts on its own; his full name still does.
const PLACES = new Set(Object.values(TEAMS).flatMap((x) => [x.nick, x.city, ...(x.alt || [])]).flatMap((w) => [plain(w), ...plain(w).split(/\s+/)]));

// What headlines call some players (first names that stand alone, and nicknames).
const ALIAS = { "Victor Wembanyama": ["wemby"], "Shai Gilgeous-Alexander": ["sga", "shai"], "Karl-Anthony Towns": ["kat"], "Giannis Antetokounmpo": ["giannis"], "LeBron James": ["lebron"],
  "Luka Doncic": ["luka"], "Kevin Durant": ["kd"], "Stephen Curry": ["steph"], "Anthony Edwards": ["ant"], "Nikola Jokic": ["jokic"], "Cooper Flagg": ["flagg"], "Ja Morant": ["ja"] };

export function buzzCounts(headlines, { players = [], teams = [], league = [] } = {}) {
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
  // …and the other way round (0.106): "P.J. Washington scores 30" is not a Wizards headline, so a player's full name whose
  // surname is a team's word is taken out of the title before the teams are looked for.
  const placeNames = [...new Set([...league, ...players])].map((n) => plain(n).replace(SUFFIX, "")).filter((n) => PLACES.has(n.split(/\s+/).slice(-1)[0]));
  const sansNames = (t) => placeNames.reduce((x, n) => x.split(n).join(" "), t);
  for (const [tri, re] of Object.entries(teamRe)) for (const h of titles) if (re.test(placeNames.length ? sansNames(h.t) : h.t)) { out.teams[tri] = (out.teams[tri] || 0) + 1; note(tri, h.raw); }
  // A surname alone counts only when no other player in the league has it, and not after another first name
  // ("Donovan Mitchell" isn't Ajay Mitchell; "Draymond Green's shove" isn't Jalen Green).
  const sur = (n) => plain(n).replace(SUFFIX, "").split(/\s+/).slice(-1)[0];
  const first = (n) => plain(n).split(/\s+/)[0];
  const surCount = {};
  for (const n of new Set([...league, ...players])) surCount[sur(n)] = (surCount[sur(n)] || 0) + 1;
  for (const name of new Set(players)) {
    const full = new RegExp(`\\b${esc(plain(name).replace(SUFFIX, ""))}\\b`);
    const s = sur(name);
    const last = s.length >= 4 && surCount[s] === 1 && !PLACES.has(s) ? new RegExp(`(\\S+\\s+)?\\b${esc(s)}('s)?\\b`) : null;
    const alone = (h) => {
      const m = last && h.t.match(last);
      if (!m) return false;
      const before = (m[1] || "").trim();
      // the word before, in the original: a capitalized word that isn't his first name is someone else's first name
      const raw = h.raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const i = plain(raw).indexOf(m[0]);
      const orig = i >= 0 ? raw.slice(i, i + before.length) : "";
      // and the surname itself capitalized ("the young season" isn't Trae Young)
      const own = i >= 0 ? raw.slice(i + m[0].length - (m[2] ? m[2].length : 0) - s.length, i + m[0].length - (m[2] ? m[2].length : 0)) : "";
      if (!/^[A-Z]/.test(own)) return false;
      return !before || before === first(name) || !/^[A-Z][a-z]+$/.test(orig) || NOT_NAMES.has(before);
    };
    const nick = ALIAS[name] ? new RegExp(`\\b(?:${ALIAS[name].join("|")})('s)?\\b`, "i") : null;
    const byNick = (h) => { const m = nick && h.raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(nick); return !!m && /^[A-Z]/.test(m[0]); };
    for (const h of titles) if (full.test(h.t) || alone(h) || byNick(h)) { out.players[name] = (out.players[name] || 0) + 1; note(name, h.raw); }
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
