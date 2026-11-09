/** NBA teams: tricode -> city, nickname, game-notes slug (nba.com/gamenotes/<slug>.pdf). */
export const TEAMS = {
  ATL: { city: "Atlanta", nick: "Hawks", slug: "hawks" },
  BOS: { city: "Boston", nick: "Celtics", slug: "celtics" },
  BKN: { city: "Brooklyn", nick: "Nets", slug: "nets" },
  CHA: { city: "Charlotte", nick: "Hornets", slug: "hornets" },
  CHI: { city: "Chicago", nick: "Bulls", slug: "bulls" },
  CLE: { city: "Cleveland", nick: "Cavaliers", slug: "cavaliers", alt: ["Cavs"] },
  DAL: { city: "Dallas", nick: "Mavericks", slug: "mavericks", alt: ["Mavs"] },
  DEN: { city: "Denver", nick: "Nuggets", slug: "nuggets" },
  DET: { city: "Detroit", nick: "Pistons", slug: "pistons" },
  GSW: { city: "Golden State", nick: "Warriors", slug: "warriors" },
  HOU: { city: "Houston", nick: "Rockets", slug: "rockets" },
  IND: { city: "Indiana", nick: "Pacers", slug: "pacers" },
  LAC: { city: "LA", nick: "Clippers", slug: "clippers" },
  LAL: { city: "Los Angeles", nick: "Lakers", slug: "lakers" },
  MEM: { city: "Memphis", nick: "Grizzlies", slug: "grizzlies" },
  MIA: { city: "Miami", nick: "Heat", slug: "heat" },
  MIL: { city: "Milwaukee", nick: "Bucks", slug: "bucks" },
  MIN: { city: "Minnesota", nick: "Timberwolves", slug: "timberwolves", alt: ["Wolves"] },
  NOP: { city: "New Orleans", nick: "Pelicans", slug: "pelicans" },
  NYK: { city: "New York", nick: "Knicks", slug: "knicks" },
  OKC: { city: "Oklahoma City", nick: "Thunder", slug: "thunder" },
  ORL: { city: "Orlando", nick: "Magic", slug: "magic" },
  PHI: { city: "Philadelphia", nick: "76ers", slug: "sixers", alt: ["Sixers"] },
  PHX: { city: "Phoenix", nick: "Suns", slug: "suns" },
  POR: { city: "Portland", nick: "Trail Blazers", slug: "blazers", alt: ["Blazers"] },
  SAC: { city: "Sacramento", nick: "Kings", slug: "kings" },
  SAS: { city: "San Antonio", nick: "Spurs", slug: "spurs" },
  TOR: { city: "Toronto", nick: "Raptors", slug: "raptors" },
  UTA: { city: "Utah", nick: "Jazz", slug: "jazz" },
  WAS: { city: "Washington", nick: "Wizards", slug: "wizards" },
};

export const teamName = (tri) => (TEAMS[tri] ? `${TEAMS[tri].city} ${TEAMS[tri].nick}` : tri);

/** Find which team a phrase refers to ("Charlotte Hornets", "HORNETS", "Spurs", "Charlotte"). */
export function teamFromText(text) {
  const t = String(text || "").toLowerCase();
  for (const [tri, info] of Object.entries(TEAMS)) {
    const words = [info.nick, ...(info.alt || [])].map((w) => w.toLowerCase());
    if (words.some((w) => new RegExp(`\\b${w}\\b`).test(t))) return tri;
  }
  for (const [tri, info] of Object.entries(TEAMS)) {
    if (info.city.length > 2 && new RegExp(`\\b${info.city.toLowerCase()}\\b`).test(t)) return tri;
  }
  return null;
}

// Tricodes as printed by teams and ESPN that differ from ours.
const CODE_ALIAS = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", PHO: "PHX", BRK: "BKN", CHO: "CHA", NOR: "NOP" };

/** A team code at the very start of a phrase ("HOU - 11/9/26", "GS"). Only the leading token is read. */
export function teamFromCode(text) {
  const m = /^\s*([A-Z]{2,4})\b/.exec(String(text || ""));
  if (!m) return null;
  const code = m[1];
  return TEAMS[code] ? code : CODE_ALIAS[code] || null;
}

export const teamFromSlug = (slug) =>
  Object.entries(TEAMS).find(([, i]) => i.slug === String(slug).toLowerCase())?.[0] || null;
