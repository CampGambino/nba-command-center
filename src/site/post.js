/**
 * Post-ready wording (0.139.0; audit step 3, the user's go 11/20 3:36 PM). A line as the page shows it carries the
 * page's own labels: where it came from ("SAC notes — Darius Acuff Jr.: Team history ·"), the matchup tag ("Series
 * streak · 9:"), the model's chance ("(66% tonight)"), the shift's odds ("(by chance: 1 in 67)"). postText() takes
 * those off and gives a notes sentence its subject back, so the line can be posted as it stands.
 *
 * It never adds a claim the line doesn't make: no new numbers, no "ever", no adjectives. What it may add is the name
 * the line is about (from the line itself) and "is" in a countdown ("Naz Reid: 8 points from 6,000" → "Naz Reid is
 * 8 points from 6,000"). Under 280 characters, cut at a sentence or a clause, never mid-word.
 */
export const POST_MAX = 280;

const VERB = /^(?:Recorded|Tallied|Totaled|Posted|Scored|Dished|Grabbed|Made|Hit|Has|Had|Is|Was|Ranks|Ranked|Leads|Led|Became|Joined|Averaged|Averages|Is averaging|Has averaged|Notched|Logged|Registered|Set|Tied|Passed|Moved|Reached|Needs|Enters|Shot|Shoots|Owns|Holds|Started|Finished|Played|Appeared|Earned|Collected|Produced|Matched|Surpassed|Eclipsed|Climbed|Sits|Stands)\b/;
const lower1 = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** text: the line as shown; player: the full name if the line is about one (briefing lines carry it). */
export function postText(text, { player = null } = {}) {
  let t = String(text || "").trim();
  // the page's own additions
  t = t.replace(/ · questionable tonight$/, "").replace(/\s*→ [^→]*$/, "").replace(/\s*\((?:\d+|<1|>99)% tonight\)/g, "").replace(/\s*\(by chance: [^)]*\)/g, "").replace(/\s*\(\d+× MVP\)/g, "");
  // a notes line: "TEAM notes — Name: Tag · sentence" or "TEAM notes: Tag · sentence"
  let m = t.match(/^[A-Z]{2,4} notes — ([^:]{2,60}): (?:[^·]{1,60} · ){0,2}(.+)$/s);
  if (m) {
    const name = m[1].trim(), body = m[2].trim().replace(/;\s+([A-Z])/g, (x, c) => `; ${c.toLowerCase()}`), sur = name.split(" ").slice(-1)[0].replace(/\.$/, "");
    let lead;
    if (/^He(?:’s|'s)\b/.test(body)) t = `${name} is${body.replace(/^He(?:’s|'s)/, "")}`;
    else if (/^(?:One of|The only|Currently|Among|Tied with)\b/.test(body)) t = `${name} is ${lower1(body)}`;
    else if ((lead = body.match(/^((?:As of|Over|In|Through|Since|After|With|During)\b[^,]{2,60}), (\S+)(.*)$/s)) && !/^[A-Z][a-z]+ [A-Z]/.test(lead[2] + lead[3].slice(0, 3))) {
      const w = lower1(lead[2]);
      t = `${lead[1]}, ${name} ${/ing$/.test(w) ? "is " : ""}${w}${lead[3]}`;
    }
    else if (/^He\b/.test(body)) t = `${name}${body.replace(/^He/, "")}`;
    else if (VERB.test(body)) t = `${name} ${lower1(body)}`;
    else if (new RegExp(`\\b${sur.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(body.slice(0, 60))) t = body;
    else t = `${name}: ${body}`;
  } else if ((m = t.match(/^[A-Z]{2,4} notes: (?:[^·]{1,60} · )?(.+)$/s))) t = m[1].trim();
  // a matchup tag in front ("Series streak · 9: ", "Last 23 · 19-4: ", "vs bottom-5 records · Franz Wagner: ")
  else if ((m = t.match(/^(?:Series streak|Series record|Season series|All-time series|Series margins|Last meeting|Last \d+|Home streak|Road streak|Streak vs [A-Z]{2,4}|\d+-\d+ vs [A-Z]{2,4}|Best vs any team|Worst vs any team|vs (?:top|bottom)-\d+ (?:defenses|records)|(?:Paint|Fast break|Second chance|Off turnovers) edge)(?: · [^:]{1,40})?: (.+)$/s))) t = m[1].trim();
  // a countdown: "Surname: 8 points from 6,000 career points" -> "Full Name is 8 points from 6,000 career points"
  if ((m = t.match(/^([^:]{2,40}): (\d[\d,]* [^:;]{1,40}? from (?:passing |tying )?.+)$/s)) && !/[.!?]$/.test(m[1])) {
    const who = player && player.split(" ").slice(-1)[0] === m[1].trim().split(" ").slice(-1)[0] ? player : m[1].trim();
    t = `${who} is ${m[2]}`;
  }
  t = t.replace(/\s+/g, " ").trim();
  return cut(t);
}

/** At most POST_MAX characters: the last sentence, then clause, that fits; failing both, the last word, with "…". */
export function cut(t, max = POST_MAX) {
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  for (const re of [/[.!?](?=\s)/g, /[;:](?=\s)/g]) {
    let last = -1, x;
    while ((x = re.exec(head))) last = x.index;
    if (last > max * 0.5) return t.slice(0, last + 1).replace(/[;:]$/, ".");
  }
  return head.slice(0, head.lastIndexOf(" ")).replace(/[,;:]$/, "") + "…";
}
