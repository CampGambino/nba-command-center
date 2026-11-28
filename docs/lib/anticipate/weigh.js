/**
 * How much a line matters, beyond what its own detector said (0.188.0). The user, 11/28, going through the ranked list:
 * "continue to assess and calibrate the importance of each and where they land in the pile … I thought these notes were
 * listed with some mixture of importance, buzz, relevance, and forecasting." Each rule is general, from one of the
 * lines named:
 *
 *   notes scale    a notes line's own score was clipped at 4.8, so 93 of 170 notes lines tied there, the order among
 *                  them was lost and they filled the top whatever they said; now halved into the storylines' scale,
 *                  the order kept (Durant's chase of Kobe Bryant above a team's turnovers)
 *   small stat     turnovers and fouls are the small print ("it's turnovers"; Tristan da Silva's turnovers): −0.7;
 *                  niche stats (minutes played, second-chance, fast-break and bench points, tracking-data cuts, clutch
 *                  3-pointers; mine, by the same reading): −0.5
 *   deep rank      a notes rank past 10th in the NBA ("T-16th"): −0.6, past 20th −0.9 (mine)
 *   small stretch  a notes "over the past N games after M before" with N of 3 or less, or a change of under a fifth
 *                  ("not that much of a difference"): −0.3 and −0.5
 *   games played   a countdown to a games-played number ("8 games away from 200 career games … it's also impossible to
 *                  occur for 8 more games"): −0.8, on top of its distance
 *   record book    a chase of a top-10 or top-25 place on the NBA's all-time list ("because of the names involved and
 *                  the record book"): +1.0 and +0.5
 *   pedigree       a team line read against the team's last three seasons: a good team's slide (OKC 8-2 then 2-7, "they
 *                  have been to the conference finals each of the last two seasons") up to +1.5, its losing streak up to
 *                  +1.0; a bad team's turn or winning streak up to +0.6; a bad team's slide −0.3;
 *                  a long-window "worst record since" about a team that has been .500 or better lately ("the Magic have
 *                  been good the last few years"), or "best since" about a team that hasn't, −0.7
 *   edges          a matchup edge by how far out both ends are ("positive or negative is fine, the more outlier the
 *                  better"): up to +1.6
 *
 *   weigh(line, { pedigree }) -> { adj, why: [rule names] }
 */
export const NOTES_CEIL = 5.2;
/** A notes fact's score into the storylines' scale, the order kept. The notes scorer's middle is about 5 (half of
 *  today's 170 notes lines were 5.0 or more), well above every other kind's, so the notes filled the top of the list
 *  whatever they said; halved around 2, its middle (5.0 -> 3.9) sits with the other kinds' and its best (6.9 -> 4.85)
 *  still near the top. */
export const squash = (s) => Math.min(NOTES_CEIL, 2.4 + 0.5 * ((s || 0) - 2));

const ORD = (s) => (/^the most$|^the fewest$|^first$|^1st/.test(s) ? 1 : parseInt(s, 10));
const plain = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Each team's win share over its last three seasons, from the franchise seasons file ({ TRI: [[season, w, l], …] }). */
export function pedigreeOf(teamSeasons, n = 3) {
  const out = {};
  for (const [t, list] of Object.entries(teamSeasons || {})) {
    const last = (list || []).slice(-n); const w = last.reduce((a, x) => a + x[1], 0), g = last.reduce((a, x) => a + x[1] + x[2], 0);
    if (g) out[t] = Math.round((w / g) * 1000) / 1000;
  }
  return out;
}

export function weigh(l, { pedigree = null } = {}) {
  const t = plain(l.text), why = [];
  let adj = 0;
  const add = (v, w) => { adj += v; why.push(w); };
  // small stat: turnovers and fouls (not points off turnovers, not assists per turnover, not a record)
  if (/\bturnovers?\b|\btpg\b|\bfouls?\b/i.test(t.replace(/\b(?:points )?off (?:of )?(?:opponents?[’']? )?turnovers\b|\bper turnover\b|\bassist[- ]to[- ]turnover\b/gi, "")) && !/\bNBA history\b|\ball-time\b|\bfranchise (?:history|record)\b/i.test(t)) add(-0.7, "small stat");
  // niche stats (mine, from the same reading as turnovers: the box-score small print and tracking-data cuts)
  if (/\bminutes played\b|\bsecond[- ]chance points\b|\bfast[- ]break points\b|\bpoints off (?:opponents?['’]? )?turnovers\b|\bbench points\b|\bdribble[- ]handoffs?\b|\bper (?:Sportradar|Cleaning The Glass)\b|\b"?tight"? defense\b|\bdunks\b|\bclutch 3-pointers\b|\bclutch three-pointers\b|\bclutch situations\b/i.test(t) && !/\bNBA history\b|\ball-time\b/i.test(t)) add(-0.5, "niche stat");
  if (l.kind === "history") {
    // a rank deep in the league ("T-16th in NBA"): the further down, the less it says
    const rk = t.match(/\b(?:T-)?(\d+)(?:st|nd|rd|th) in (?:the )?NBA\b/i) || t.match(/\branks? (?:T-)?(\d+)(?:st|nd|rd|th) (?:in the (?:NBA|league)|among)\b/i);
    if (rk && +rk[1] > 20) add(-0.9, "deep rank"); else if (rk && +rk[1] > 10) add(-0.6, "deep rank");
    // a stretch of three games or fewer, with or without a comparison
    const short = t.match(/\bover (?:the|his|their) (?:past|last) (\d+|two|three) (?:games|GP|contests)\b/i);
    if (short && !/\bafter|up from|down from|compared to\b/i.test(t) && (/^(?:two|three)$/i.test(short[1]) || +short[1] <= 3)) add(-0.3, "small stretch");
    // a stretch against the games before it: "Averaging 13.0 tpg over the past 2 games after averaging 15.3 the 4 games prior"
    const m = t.match(/\bover (?:the|his|their) (?:past|last) (\d+) (?:games|GP|contests)\b/i);
    if (m && /\b(?:after|up from|down from|compared to)\b/i.test(t)) {
      // the first average on each side of "after" (averages print with a decimal point)
      const [pre, post] = t.replace(/\([^)]*\)/g, "").split(/\b(?:after|up from|down from|compared to)\b/i), dec = (x) => +((x || "").match(/\d+\.\d+/) || [NaN])[0];
      const a = dec(pre), b = dec(post);
      if (+m[1] <= 3) add(-0.3, "small stretch");
      if (Number.isFinite(a) && Number.isFinite(b) && Math.max(a, b) > 0 && Math.abs(a - b) / Math.max(a, b) < 0.2) add(-0.5, "small change");
    }
    if (l.reach?.stat === "gp") add(-0.8, "games played");
    // the NBA's all-time list (not a franchise's): a chase of a top-10 or top-25 place
    const at = t.match(/\b(\d+)(?:st|nd|rd|th) (?:on the |in )?(?:NBA['’]s )?all-time\b/i) || t.match(/\bfor (\d+)(?:st|nd|rd|th) (?:on|in) (?:the )?(?:NBA['’]s )?all-time\b/i);
    if (at && /\b(?:pass|passing|catch|tie|move (?:past|into))\b/i.test(t) && !/\bfranchise\b|\bteam (?:history|record)\b|\bclub\b|\b(?:Hawks|Celtics|Nets|Hornets|Bulls|Cavaliers|Mavericks|Nuggets|Pistons|Warriors|Rockets|Pacers|Clippers|Lakers|Grizzlies|Heat|Bucks|Timberwolves|Pelicans|Knicks|Thunder|Magic|76ers|Sixers|Suns|Trail Blazers|Blazers|Kings|Spurs|Raptors|Jazz|Wizards)['’]?s? (?:all-time|history|annals)\b/i.test(t)) {
      const r = +at[1]; if (r <= 10) add(1.0, "record book"); else if (r <= 25) add(0.5, "record book");
    }
  }
  // pedigree: a team line read against its last three seasons
  const ped = pedigree && !l.player ? pedigree[l.team] : null;
  if (ped != null) {
    const turn = t.match(/\bwent (\d+)-(\d+) in its first \d+ games; (\d+)-(\d+) since\b/) || (() => { const x = t.match(/\bis (\d+)-(\d+) since [\d/]+; it went (\d+)-(\d+)\b/); return x ? [x[0], x[3], x[4], x[1], x[2]] : null; })();
    if (turn && l.kind === "turn") {
      const [a, b, c, d] = turn.slice(1).map(Number), before = a / Math.max(1, a + b), after = c / Math.max(1, c + d);
      if (after < before && ped >= 0.6) add(Math.min(1.5, (ped - 0.5) * 5), "pedigree: a good team's slide");
      else if (after > before && ped < 0.4) add(Math.min(0.6, (0.5 - ped) * 3), "pedigree: a bad team's turn");
      else if (after < before && ped < 0.4) add(-0.3, "pedigree: a bad team's slide");
    }
    // a losing streak by a team that has been winning, a winning streak by one that hasn't
    if (/^[A-Z]{2,3} has lost \d+ straight\b/.test(t) && ped >= 0.6) add(Math.min(1.0, (ped - 0.5) * 4), "pedigree: a good team losing");
    if (/^[A-Z]{2,3} has won \d+ straight\b/.test(t) && ped < 0.4) add(Math.min(0.6, (0.5 - ped) * 3), "pedigree: a bad team winning");
    if (/\b(?:\d+(?:st|nd|rd|th)-)?worst record since\b/i.test(t) && ped >= 0.5) add(-0.7, "pedigree: winning lately");
    if (/\b(?:\d+(?:st|nd|rd|th)-)?best record since\b/i.test(t) && ped < 0.45) add(-0.7, "pedigree: losing lately");
  }
  // matchup edges: both ends far out
  if (l.kind === "matchup" && /^[\w' -]*\bedge\b/i.test(t)) {
    const r = [...t.matchAll(/\((the most|the fewest|\d+(?:st|nd|rd|th))(?: in the NBA| most| fewest)?\)/g)].map((x) => ORD(x[1])).filter(Number.isFinite);
    if (r.length >= 2) { const v = Math.max(0, Math.min(1.6, 1.6 * (1 - (r[0] + r[1] - 2) / 28))); if (v > 0) add(Math.round(v * 100) / 100, "edge"); }
  }
  return { adj: Math.round(adj * 100) / 100, why };
}
