/**
 * NBA fines and suspensions from pr.nba.com (0.143.0; the user, 11/23: "scan all the articles from these pages to have
 * a database of fines and career totals for each player", https://pr.nba.com/tag/nba-fines/).
 * pr.nba.com refuses GitHub's servers (403, robots.txt too), so the releases are read in the user's own browser: the
 * tag's 56 listing pages and each release, plus the sitemap's fine/suspension/penalty addresses, one request a second
 * (robots.txt's Crawl-Delay), no query strings (robots.txt disallows them), saved as JSON {posts: [{url, title, date?, ps}]}.
 *   node tools/pr-fines/build.mjs tagged.json extra.json   → src/data/nba-penalties-<today>.json
 */
import fs from "node:fs"; import { parseRelease } from "./parse.mjs";
const NONNBA = /\b(WNBA|G League|D-League|Development League|2K League|BIG3)\b|Windy City|Stockton Kings|Iowa (?:Wolves|Energy)|Raptors 905|Long Island Nets|Austin (?:Spurs|Toros)|Blue Coats|Westchester|Wisconsin Herd|Lakeland Magic|Osceola|Capital City|Skyhawks|Grand Rapids|Motor City|Rip City|Rio Grande|Santa Cruz|Salt Lake City Stars|Sioux Falls|Skyforce|Texas Legends|Memphis Hustle|Maine (?:Celtics|Red Claws)|Squadron|Cleveland Charge|Canton Charge|Greensboro|Capitanes|Ontario Clippers|South Bay|Valley Suns|OKC Blue|Mad Ants|Noblesville|Erie BayHawks|Agua Caliente|D-Fenders|Bighorns|Herd's|Gold's|Charge's|Vipers|Energy coach|Swarm|Delaware|Mercury|Liberty|Sparks|Dream|Fever|Lynx|Mystics|Aces|Storm|Wings|Valkyries|Sky's|Sun's|Tempo|Fire\b/;
// Releases worded too unusually for the parser, entered by hand from their text (checked 11/23).
const MANUAL = {
  "kobe-bryant-lakers-fine/": [["Kobe Bryant", "LAL", "player", "fine", 100000, null, "a derogatory comment during a game (Commissioner David Stern's statement)"]],
  "mark-stevens-banned-fined-warriors/": [["Mark Stevens", "GSW", "executive", "fine", 500000, null, "pushing and directing obscene language toward Kyle Lowry during Game 3 of the Finals (also banned for a year)"]],
  "zaza-pachulia-jason-richardson": [["Zaza Pachulia", "ATL", "player", "suspension", null, 1, "headbutting Jason Richardson and fighting"], ["Jason Richardson", "ORL", "player", "suspension", null, 1, "shoving Pachulia in the face and fighting"]],
  "jerebko": [["Jamaal Magloire", "MIA", "player", "suspension", null, 2, "instigating the altercation and striking Jerebko in the face (preseason)"], ["Jonas Jerebko", "DET", "player", "suspension", null, 1, "retaliating and striking Magloire in the face (preseason)"]],
  "kris-dunn": [["Kris Dunn", "UTA", "player", "suspension", null, 2, "initiating an altercation and throwing a punch at Jabari Smith Jr."], ["Jabari Smith Jr.", "HOU", "player", "suspension", null, 1, "fighting with Dunn"]],
  "pistons-magic": [["Killian Hayes", "DET", "player", "suspension", null, 3, "his role in an on-court altercation"], ["Moritz Wagner", "ORL", "player", "suspension", null, 2, "his role in an on-court altercation"], ["Hamidou Diallo", "DET", "player", "suspension", null, 1, "his role in an on-court altercation"],
    ...["Cole Anthony", "R.J. Hampton", "Gary Harris", "Kevon Harris", "Admiral Schofield", "Franz Wagner", "Mo Bamba", "Wendell Carter Jr."].map((n) => [n, "ORL", "player", "suspension", null, 1, "leaving the bench area during an on-court altercation"])],
};
const posts = [];
for (const f of [...(process.argv.slice(2).length ? process.argv.slice(2) : ["raw/tagged.json", "raw/extra.json"])]) for (const p of JSON.parse(fs.readFileSync(f, "utf8")).posts) posts.push({ ...p, tagged: f.includes("tagged") });
const rows = [], skipped = [], bad = [];
for (const p of posts) {
  const title = (p.title || "").replace(/\s+-\s+NBA\.com: NBA Communications$/, "");
  const d = p.date || p.ps.map((x) => x.match(/^([A-Z][a-z]+ \d{1,2}, \d{4})$/)).find(Boolean)?.[1];
  const date = d ? new Date(d + " 12:00 UTC").toISOString().slice(0, 10) : null;
  if (NONNBA.test(title + " " + p.ps.slice(0, 4).join(" "))) { skipped.push(title); continue; }
  const key = Object.keys(MANUAL).find((k) => p.url.includes(k));
  let R;
  if (key) R = MANUAL[key].map(([name, team, kind, type, amount, games, reason]) => ({ name, team, kind, role: null, type, amount, games, reason, manual: true }));
  else {
    const body = p.ps.filter((x) => !/^(Official Release|To view|Related Posts|Share)/.test(x) && !/^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(x)).join(" ");
    const r = parseRelease(body, title); R = r.rows;
    if (r.issues.some((i) => !/named in a release with no amount/.test(i))) bad.push({ title, url: p.url, issues: r.issues });
  }
  for (const x of R) rows.push({ date, ...x, title, url: p.url });
}
for (const b of bad) console.log("check by hand:", b.title, "|", b.issues.join(" || ").slice(0, 200));
console.log({ posts: posts.length, skipped: skipped.length, rows: rows.length, bad: bad.length, noDate: rows.filter((r) => !r.date).length });
// one penalty published on two pages (Doc Rivers 5/15/2014, Clippers 11/7/2019): same who, kind, size, day and reason
export const key = (n) => n.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\b(Jr|Sr|II|III|IV)\b\.?/g, "").replace(/[^A-Za-z ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const seen = new Set(), out = [];
for (const r of rows) {
  const who = r.kind === "team" ? "team:" + r.team : key(r.name);
  const k = [who, r.type, r.amount, r.games, r.date, (r.reason || "").slice(0, 30)].join("|");
  if (seen.has(k)) continue; seen.add(k); out.push({ ...r, who });
}
// An indefinite suspension whose length a later release gives: Draymond Green, 12/13/2023 ("reinstated after 12-game suspension", 2/6/2024).
for (const r of out) if (r.who === "draymond green" && r.date === "2023-12-13" && r.type === "suspension") { r.games = 12; r.note = "announced as indefinite; 12 games (reinstatement release)"; }
const TEAMNAME = { ATL: "Atlanta Hawks", BOS: "Boston Celtics", BKN: "Brooklyn Nets", NJN: "New Jersey Nets", CHA: "Charlotte Hornets/Bobcats", CHI: "Chicago Bulls", CLE: "Cleveland Cavaliers", DAL: "Dallas Mavericks", DEN: "Denver Nuggets", DET: "Detroit Pistons", GSW: "Golden State Warriors", HOU: "Houston Rockets", IND: "Indiana Pacers", LAC: "LA Clippers", LAL: "Los Angeles Lakers", MEM: "Memphis Grizzlies", MIA: "Miami Heat", MIL: "Milwaukee Bucks", MIN: "Minnesota Timberwolves", NOP: "New Orleans Pelicans", NOH: "New Orleans Hornets", NYK: "New York Knicks", OKC: "Oklahoma City Thunder", ORL: "Orlando Magic", PHI: "Philadelphia 76ers", PHX: "Phoenix Suns", POR: "Portland Trail Blazers", SAC: "Sacramento Kings", SAS: "San Antonio Spurs", TOR: "Toronto Raptors", UTA: "Utah Jazz", WAS: "Washington Wizards", SEA: "Seattle SuperSonics" };
for (const r of out) if (r.kind === "team") { r.name = TEAMNAME[r.team] || r.name; r.who = "team:" + r.team; }
// one spelling per person: the one with accents (Jokić over Jokic), else the latest
const accented = (n) => /[\u0300-\u036f]/.test(n.normalize("NFD")), disp = new Map();
for (const r of [...out].sort((a, b) => a.date.localeCompare(b.date))) { const cur = disp.get(r.who); disp.set(r.who, cur && accented(cur) && !accented(r.name) ? cur : r.name); }
for (const r of out) r.name = disp.get(r.who);
out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // the Eastern day
const file = {
  source: "pr.nba.com: every release tagged \"NBA fines\" plus the sitemap's fine, suspension and penalty addresses, read in the user's browser; G League, WNBA and 2K League releases left out. tools/pr-fines/build.mjs",
  read: today, from: out[0].date, through: out[out.length - 1].date,
  keys: ["date", "name", "team", "kind", "type", "amount", "games", "reason", "note", "release"],
  rows: out.map((r) => [r.date, r.name, r.team || null, r.kind, r.type, r.type === "fine" ? r.amount : null, r.type === "fine" ? null : r.games, r.reason || null, r.note || null, r.url.replace("https://pr.nba.com/", "").replace(/\/$/, "")]),
};
fs.writeFileSync(new URL(`../../src/data/nba-penalties-${today}.json`, import.meta.url), JSON.stringify(file).replace(/\],\[/g, "],\n["));
console.log("after dedupe", out.length);
