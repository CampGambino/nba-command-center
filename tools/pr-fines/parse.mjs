// Parse pr.nba.com fine/suspension releases into penalty rows (one per person or team per penalty).
const NICK = { "Trail Blazers": "POR", "Blazers": "POR", "SuperSonics": "SEA", "Timberwolves": "MIN", "Cavaliers": "CLE", "Mavericks": "DAL", "Grizzlies": "MEM", "Warriors": "GSW", "Clippers": "LAC", "Pelicans": "NOP", "Celtics": "BOS", "Bobcats": "CHA", "Hornets": "CHA", "Nuggets": "DEN", "Pistons": "DET", "Rockets": "HOU", "Raptors": "TOR", "Wizards": "WAS", "Thunder": "OKC", "Lakers": "LAL", "Knicks": "NYK", "Pacers": "IND", "Hawks": "ATL", "Bulls": "CHI", "Bucks": "MIL", "Magic": "ORL", "76ers": "PHI", "Sixers": "PHI", "Kings": "SAC", "Spurs": "SAS", "Suns": "PHX", "Heat": "MIA", "Nets": "BKN", "Jazz": "UTA", "Cavs": "CLE", "Mavs": "DAL", "Wolves": "MIN" };
const CITY = { "Golden State": "GSW", "Oklahoma City": "OKC", "New Orleans": "NOP", "San Antonio": "SAS", "New Jersey": "NJN", "Los Angeles": null, "New York": "NYK", "LA": "LAC", "Atlanta": "ATL", "Boston": "BOS", "Brooklyn": "BKN", "Charlotte": "CHA", "Chicago": "CHI", "Cleveland": "CLE", "Dallas": "DAL", "Denver": "DEN", "Detroit": "DET", "Houston": "HOU", "Indiana": "IND", "Memphis": "MEM", "Miami": "MIA", "Milwaukee": "MIL", "Minnesota": "MIN", "Orlando": "ORL", "Philadelphia": "PHI", "Phoenix": "PHX", "Portland": "POR", "Sacramento": "SAC", "Toronto": "TOR", "Utah": "UTA", "Washington": "WAS", "Seattle": "SEA" };
const alt = (o) => Object.keys(o).sort((a, b) => b.length - a.length).map((s) => s.replace(/\s/g, "\\s")).join("|");
const TEAM = `(?:(?:${alt(CITY)})\\s+(?:${alt(NICK)})|(?:${alt(NICK)})|(?:${alt(CITY)}))`;
const ROLES = ["guard-forward", "forward-guard", "forward-center", "center-forward", "guard/forward", "forward/guard", "forward/center", "center/forward", "point guard", "shooting guard", "small forward", "power forward", "guard", "forward", "center", "player", "head coach", "acting head coach", "interim head coach", "associate head coach", "assistant coach", "player development coach", "coach", "owner", "majority owner", "governor", "alternate governor", "chairman", "general manager", "president of basketball operations", "president, basketball operations", "president", "vice president", "executive vice president", "team president", "managing partner", "co-owner", "director of player personnel", "trainer", "assistant general manager", "executive vice president of basketball operations", "executive vice president, basketball operations", "scout", "investor", "minority owner", "an owner"];
const ci = (w) => w.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
const ROLE = `(?:${ROLES.sort((a, b) => b.length - a.length).map((r) => ci(r).replace(/\s/g, "\\s") + "(?:es|s)?").join("|")})`;
const NAMEW = "(?:[A-ZÀ-ÝŠŽČĆ][\\p{L}.'’-]*|Jr\\.|Sr\\.|II|III|IV|de|van|Van|da|del|Del|St\\.|O['’][A-Z][\\p{L}'’-]+|Mc[A-Z][\\p{L}'’-]+)";
const NAME = `${NAMEW}(?:\\s+${NAMEW})*`;
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, twenty: 20, "twenty-five": 25, thirty: 30, "eighty-six": 86, a: 1 };
const ABBR = /(?:^|\s)(?:[A-Z]\.){1,3}$|(?:^|\s)(?:Jr|Sr|St|Mr|Dr|No|Jan|Feb|Mar|Apr|Aug|Sept|Sep|Oct|Nov|Dec|vs|Inc|Co|Ave|Mt|U\.S)\.$/;

export function teamOf(t) {
  if (!t) return null; t = t.replace(/\s+/g, " ").replace(/['’]s?$/, "").trim();
  if (/New Orleans Hornets/.test(t)) return "NOH"; if (/New Jersey/.test(t)) return "NJN"; if (/Charlotte Bobcats/.test(t)) return "CHA";
  for (const n of Object.keys(NICK).sort((a, b) => b.length - a.length)) if (t.endsWith(n)) return NICK[n];
  return CITY[t] ?? null;
}
function sentences(text) {
  const out = []; let cur = "";
  const parts = text.replace(/\s+/g, " ").split(/(?<=[.;?!])\s+/);
  for (const p of parts) { cur = cur ? cur + " " + p : p; if (!ABBR.test(cur) && /^[A-Z“"(\d]/.test(parts[parts.indexOf(p) + 1] || "A")) { out.push(cur); cur = ""; } }
  if (cur) out.push(cur); return out;
}
const words = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "");
const LEAD = /^(?:.*\bannounced (?:today )?(?:that )?(?:it has )?|NEW YORK\s*[–—-]\s*|The NBA (?:announced today|today announced)(?: that)?(?: it has)?\s*|(?:Additionally|In addition|Also|Separately(?: from [^,]+)?|Separately),\s*|and\s+|also\s+|the\s+|The\s+|both\s+)+/;
// One item of a subject list: a team org, a person with team/role, or a known name.
const STOP = /^(?:Additionally|In addition|Also|Separately|However|Meanwhile|Furthermore|Accordingly|Following|Both|Each|The NBA|NBA)$/;
export function item(raw, ctx) {
  if (STOP.test(raw.trim())) return null;
  let s = raw.trim().replace(LEAD, "").replace(/[,]+$/, "").replace(/\s+also$/, "").replace(/(?<!\b(?:Jr|Sr|St|[A-Z]))\.$/, "").trim();
  if (!s) return null;
  let m;
  if ((m = s.match(new RegExp(`^(${TEAM})(?:['’]s?)?(?:\\s+(?:organization|franchise|team))?$`, "u")))) return { kind: "team", name: m[1], team: teamOf(m[1]), role: "team" };
  if ((m = s.match(new RegExp(`^(?:(${TEAM})(?:['’]s?)?\\s+)?(?:(${ROLE})\\s+)?(${NAME})$`, "u"))) && (m[1] || m[2] || ctx.known(m[3]))) {
    const name = m[3].trim(); if (new RegExp(`^${TEAM}$`, "u").test(name)) return { kind: "team", name, team: teamOf(name), role: "team" };
    const k = ctx.known(name); const role = (m[2] || k?.role || "").toLowerCase();
    if (!m[1] && !m[2] && k) return { ...k };
    if (!/^[A-ZÀ-ÝŠŽČĆ]/.test(name) || /^(NBA|The|He|His|In|For|After|During)\b/.test(name)) return null;
    return { kind: role ? (/coach|trainer/.test(role) ? "coach" : /guard|forward|center|player/.test(role) ? "player" : "executive") : "player", name, team: m[1] ? teamOf(m[1]) : ctx.lastTeam, role: role.replace(/s$/, "") || null, inherit: !m[1] };
  }
  // "Daryl Morey, Philadelphia 76ers President of Basketball Operations"
  if ((m = s.match(new RegExp(`^(${NAME}),?\\s+(?:an?\\s+)?(?:(${TEAM})(?:['’]s)?\\s+)?(${ROLE})(?:\\s+of\\s+the\\s+(${TEAM}))?$`, "u")))) return { kind: /coach/i.test(m[3]) ? "coach" : /guard|forward|center|player/i.test(m[3]) ? "player" : "executive", name: m[1], team: teamOf(m[2] || m[4]), role: m[3].toLowerCase() };
  // "Kevin Durant of the Oklahoma City Thunder" (older releases)
  if ((m = s.match(new RegExp(`^(${NAME})\\s+of\\s+(?:the\\s+)?(${TEAM})$`, "u")))) { const k = ctx.known(m[1]); return { kind: k?.kind || "player", name: m[1], team: teamOf(m[2]), role: k?.role || null }; }
  if (/^(?:he|He)$/.test(s) && (ctx.inSentence || ctx.lastSubject)) return { ...(ctx.inSentence || ctx.lastSubject) };
  if (ctx.plural && new RegExp(`^${NAME}$`, "u").test(s) && !new RegExp(`^${TEAM}$`, "u").test(s)) return { kind: ctx.plural.kind, name: s, team: ctx.plural.team, role: ctx.plural.role };
  return null;
}
export function splitList(seg) { return seg.split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*;\s*/).filter((x) => x.trim()); }
function amounts(s) { return [...s.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s*(million)?/g)].map((m) => Math.round(Number(m[1].replace(/,/g, "")) * (m[2] ? 1e6 : 1))); }
function gamesOf(s) {
  if (/indefinite/i.test(s)) return { games: null, note: "indefinitely" };
  if (/(?:remainder|rest) of the (?:regular )?season/i.test(s)) return { games: null, note: "rest of the season" };
  const h = s.match(/\b(\w+)-game\s+suspension/i); if (h && (NUM[h[1].toLowerCase()] || /^\d+$/.test(h[1]))) return { games: NUM[h[1].toLowerCase()] ?? Number(h[1]), note: null };
  const m = s.match(/(\w+(?:-\w+)?)\s+(?:\(\d+\)\s+)?(?:additional\s+|more\s+)?(?:NBA\s+)?(?:regular[- ]season\s+|playoff\s+|preseason\s+|Summer League\s+|NBA Summer League\s+)?games?\b/i);
  if (!m) return null; const w = m[1].toLowerCase(); const n = NUM[w] ?? (/^\d+$/.test(w) ? Number(w) : null);
  return n == null ? null : { games: n, note: /summer league/i.test(m[0]) ? "Summer League" : /preseason/i.test(m[0]) ? "preseason" : null };
}
function addPerson(people, p) {
  p = { ...p, name: p.name.replace(/[’']s$/, "").replace(/(?<!\b(?:Jr|Sr|St|[A-Z]))\.$/, "") };
  const t = p.name.split(" "); people.set(p.name, p);
  const core = t.filter((w) => !/^(Jr\.|Sr\.|II|III|IV)$/.test(w));
  if (core.length > 1) people.set(core[core.length - 1], people.get(core[core.length - 1]) && people.get(core[core.length - 1]).name !== p.name ? { ambiguous: true } : p);
  if (t.length > 2 && /^(Jr\.|Sr\.|II|III|IV)$/.test(t[t.length - 1])) people.set(t.slice(-2).join(" "), p);
  if (core.length > 2) people.set(core.slice(1).join(" "), p); // "Van Gundy"
}
export function parseRelease(text, title = "") {
  const rows = [], issues = [];
  const S = sentences(text);
  const people = new Map();
  const mentionRe = new RegExp(`(${TEAM})(?:['’]s?)?\\s+(${ROLE})\\s+(${NAME})`, "gu");
  for (const s of S) for (const m of s.matchAll(mentionRe)) {
    // shared team: "Houston Rockets head coach Ime Udoka, forward Tari Eason and center Alperen Sengun"
    const name = m[3].trim(); const p = { kind: /coach/i.test(m[2]) ? "coach" : /guard|forward|center|player/i.test(m[2]) ? "player" : "executive", name, team: teamOf(m[1]), role: m[2].toLowerCase() };
    addPerson(people, p);
    let rest = s.slice(m.index + m[0].length), r;
    const cont = new RegExp(`^(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+)(?:(${ROLE})\\s+)?(${NAME})`, "u");
    while ((r = rest.match(cont)) && (r[1] || /s$/.test(m[2]))) { addPerson(people, { ...p, name: r[2], role: (r[1] || p.role).toLowerCase(), kind: r[1] ? (/coach|trainer/i.test(r[1]) ? "coach" : /guard|forward|center|player/i.test(r[1]) ? "player" : "executive") : p.kind }); rest = rest.slice(r[0].length); }
  }
  for (const s of S) {
    for (const m of s.matchAll(new RegExp(`(${NAME})\\s+of\\s+(?:the\\s+)?(${TEAM})\\b`, "gu"))) if (!people.has(m[1])) addPerson(people, { kind: "player", name: m[1].replace(/^(?:NEW YORK|In addition|Additionally)\b.*?\s(?=[A-Z])/, ""), team: teamOf(m[2]), role: null });
    for (const m of s.matchAll(new RegExp(`(${TEAM})['’]s?\\s+(${NAME})`, "gu"))) if (!people.has(m[2]) && !new RegExp(`^${ROLE}`, "u").test(m[2])) addPerson(people, { kind: "player", name: m[2], team: teamOf(m[1]), role: null });
  }
  const ctx = { lastTeam: null, known: (n) => { const k = people.get(n) || people.get(n.replace(/['’]s$/, "")); return k && !k.ambiguous ? k : null; } };
  const done = new Set(); // name|type already recorded from an umbrella sentence with no amount
  for (const s of S) {
    if (!/\b(fined|suspended|suspension)\b/.test(s)) continue;
    const pens = [];
    for (const m of s.matchAll(/\b(?:(?:has|have|had)\s+(?:(?:also|each|both|additionally)\s+)*been|was|were|is|are)\s+(?:(?:also|each|both|additionally)\s+)*(fined|suspended)\b/g)) pens.push({ at: m.index, end: m.index + m[0].length, kind: m[1], passive: true });
    for (const m of s.matchAll(/\b(?:has|have)\s+received\s+an?\s+|\bwill\s+serve\s+an?\s+(?=\w+-game\s+suspension)/g)) if (/^\w+-game\s+suspension/.test(s.slice(m.index + m[0].length))) pens.push({ at: m.index, end: m.index + m[0].length, kind: "suspended", passive: true });
    for (const m of s.matchAll(/\b(?:has|have|NBA|NBA\s+also|NBA\s+today|Association)\s+(?:also\s+|today\s+)?(fined|suspended)\s+(?!for\b)/g)) pens.push({ at: m.index, end: m.index + m[0].length, kind: m[1], passive: false });
    if (!pens.length) continue;
    pens.sort((a, b) => a.at - b.at);
    let prev = 0;
    { const ms = [...s.slice(0, pens[0].at).matchAll(mentionRe)]; ctx.inSentence = ms.length ? ctx.known(ms[ms.length - 1][3].replace(/['’]s$/, "").replace(/\.$/, "")) : null; }
    pens.forEach((p, i) => {
      const next = pens[i + 1]?.at ?? s.length;
      const tail = s.slice(p.end, next);
      let subjSeg, terms;
      if (p.passive) {
        // subjects: back from the phrase to the last boundary (sentence start, a prior penalty's reason, "for ...", "after", "–")
        let seg = s.slice(prev, p.at).replace(/,\s*(?:who|which)\b[\s\S]*$/, "").replace(/^[\s\S]*\bannounced (?:today )?(?:that )?/, "");
        seg = seg.replace(new RegExp(`(${NAME}),\\s+(?:an?\\s+)?(${ROLE})\\s+of\\s+the\\s+(${TEAM}),?`, "u"), "$3 $2 $1");
        const cut = Math.max(seg.lastIndexOf(" for "), seg.lastIndexOf("–"), seg.lastIndexOf(" after "), seg.lastIndexOf(" while "), seg.lastIndexOf(" when "));
        if (cut >= 0) seg = seg.slice(cut).replace(/^\s*(?:–|(?:for|after|while|when)\b)/, "");
        // the reason clause of the previous penalty, if any, ends at its last " and "/", and" before a person
        seg = seg.replace(/\s+(?:also\s+)?(?:received|was assessed|was ejected|was also assessed)\b[\s\S]*?\band\s*$/, "");
        subjSeg = seg; terms = tail;
      } else {
        const stop = tail.search(/\$|\s+for\s+|\s+without\s+|\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:\w+\s+)?games?\b/);
        const pair = tail.match(/^(.+?)\s+\$([\d,]+)\s+and\s+(.+?)\s+\$([\d,]+)\b/);
        if (pair) { const a = item(pair[1], ctx), b = item(pair[3], ctx); const reason = (tail.match(/\bfor\s+(.+?)(?:,\s*it was announced|$)/) || [])[1]?.replace(/[.;]$/, "") || null;
          if (a && b) { rows.push({ ...strip(a), type: "fine", amount: Number(pair[2].replace(/,/g, "")), games: null, reason }, { ...strip(b), type: "fine", amount: Number(pair[4].replace(/,/g, "")), games: null, reason }); return void (prev = p.end); } }
        subjSeg = stop < 0 ? tail : tail.slice(0, stop); terms = stop < 0 ? "" : tail.slice(stop);
        subjSeg = subjSeg.replace(new RegExp(`^(${NAME}),\\s+(${TEAM})\\s+(${ROLE}),?\\s*$`, "u"), "$2 $3 $1").replace(new RegExp(`^(${NAME})\\s+of\\s+the\\s+(${TEAM})\\s*$`, "u"), "$1 of the $2");
      }
      const plural = subjSeg.match(new RegExp(`(${TEAM})(?:['’]s)?\\s+(${ROLE.replace(/\(\?:es\|s\)\?/g, "")})(?:s|es)\\b`, "u"));
      ctx.plural = plural ? { team: teamOf(plural[1]), role: plural[2].toLowerCase(), kind: /coach/i.test(plural[2]) ? "coach" : "player" } : null;
      let parts = splitList(subjSeg).map((x) => item(x, ctx));
      // keep the run of parsed items at the end (passive) / start (active)
      const raw = splitList(subjSeg);
      for (let j = 1; j < parts.length; j++) if (!parts[j] && parts[j - 1] && parts[j - 1].kind !== "team" && new RegExp(`^${NAME}$`, "u").test(raw[j].trim().replace(LEAD, "")) && raw[j].trim().replace(LEAD, "").includes(" ")) parts[j] = { kind: parts[j - 1].kind, name: raw[j].trim().replace(LEAD, ""), team: parts[j - 1].team, role: parts[j - 1].role };
      if (p.passive) { let k = parts.length; while (k > 0 && parts[k - 1]) k--; parts = parts.slice(k); }
      if (p.passive && !parts.length) { const one = subjSeg.trim().replace(LEAD, ""); if (/announced|NEW YORK/.test(s.slice(0, p.at)) && new RegExp(`^${NAME}$`, "u").test(one) && /^\S+(\s\S+){1,2}$/.test(one)) parts = [{ kind: "player", name: one, team: teamOf((title.match(new RegExp(`(${TEAM})['’]`, "u")) || [])[1]), role: null }]; }
      if (p.passive && !parts.length) { const lm = s.slice(prev).replace(LEAD, "").match(new RegExp(`^(${NAME})\\s+(?:has\\s+|was\\s+|also\\s+)?[a-z]`, "u")); const k = lm && ctx.known(lm[1]); if (k) parts = [{ ...k }]; } else { const k = parts.findIndex((x) => !x); if (k >= 0) parts = parts.slice(0, k); }
      for (let j = 0; j < parts.length; j++) { if (parts[j].inherit && j > 0) parts[j].team = parts[j - 1].team ?? parts[j].team; if (!parts[j].team) parts[j].team = ctx.known(parts[j].name)?.team ?? null; }
      if (parts.length) { ctx.lastTeam = parts[parts.length - 1].team; ctx.lastSubject = parts[parts.length - 1]; }
      const reason = (terms.match(/\bfor\s+(.+?)(?:,\s*it was announced|,\s*the NBA announced|\s+by the NBA|$)/) || [])[1]?.replace(new RegExp(`,?\\s+and\\s+(?:the\\s+)?(?:${TEAM})(?:['’]s?)?\\s[\\s\\S]*$`, "u"), "").replace(/[.;]$/, "").trim() || null;
      const before = terms.split(/\s+for\s+/)[0];
      if (p.kind === "fined") {
        let A = amounts(before); if (!A.length && !/\bfor\b/.test(terms)) A = amounts(terms);
        if (!A.length) { if (parts.length) for (const x of parts) done.add(x.name); else if (!/\bthen of\b|\bpreviously\b|season for requesting/.test(s)) issues.push("fined, no amount or subject: " + s.slice(0, 180)); return void (prev = p.end); }
        if (!parts.length) { issues.push("fined, no subject: " + s.slice(0, 200)); return void (prev = p.end); }
        const resp = /respectively/.test(terms) && A.length === parts.length;
        parts.forEach((x, j) => rows.push({ ...strip(x), type: "fine", amount: resp ? A[j] : A[0], games: null, reason }));
        if (A.length > 1 && !resp) issues.push("several amounts: " + s.slice(0, 200));
      } else {
        if (/from (?:all )?(?:team|Heat|[A-Z]\w+) (?:facilities|activities)|suspended from/i.test(s) && !/without pay/i.test(s)) { if (parts.length) for (const x of parts) rows.push({ ...strip(x), type: "suspension", amount: null, games: null, note: "team activities", reason }); return void (prev = p.end); }
        let g = gamesOf(before) || gamesOf(terms);
        if (!g && parts.length && parts.every((x) => rows.some((r) => r.type === "suspension" && r.name === x.name))) return void (prev = p.end);
        if (!g) g = gamesOf(title);
        if (!g && /\buntil\b|indefinite/i.test(text)) g = { games: null, note: "indefinite" };
        if (!parts.length) { issues.push("suspended, no subject: " + s.slice(0, 200)); return void (prev = p.end); }
        if (!g) { issues.push("suspended, no games: " + s.slice(0, 200)); return void (prev = p.end); }
        parts.forEach((x) => rows.push({ ...strip(x), type: "suspension", amount: null, games: g.games, note: g.note || undefined, reason }));
      }
      prev = p.end;
    });
  }
  for (const n of done) if (!rows.some((r) => r.name === n || people.get(n) === people.get(r.name))) issues.push("named in a release with no amount for them: " + n);
  const kept = [];
  for (const r of rows) {
    const j = kept.findIndex((k) => k.name === r.name && k.type === r.type && k.amount === r.amount && k.games === r.games && !/additional/i.test(r.reason || ""));
    if (j < 0) kept.push(r); else if ((!kept[j].reason && r.reason) || (r.reason || "").length > 0 && !/their roles|separate (?:incidents|violations)/.test(r.reason) && /their roles|separate (?:incidents|violations)/.test(kept[j].reason || "")) kept[j] = r;
  }
  return { rows: kept, issues };
}
const strip = ({ inherit, ...x }) => x;
