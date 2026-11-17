/**
 * Learning from the user's briefing votes (0.67). Each 👍 / 👎 (cloudflare/votes.js) is about one line; what is
 * learned is about the line's features: its kind, what sort of claim it makes, whether it's about a star or a
 * lesser-known player, a team or a player. A feature's weight is its vote balance, shrunk toward 0 until it has
 * a few votes: w = 0.8 × (up − down) / (up + down + 2), only from 2 votes. A line's boost is the sum of its
 * features' weights, between −1.5 and +1.5. A line voted down itself is left out of the briefing from then on.
 */
const WORDS = [
  ["career-high", /career-high|career high/i], ["career-low", /career-low|career low/i], ["since", /\b(?:highest|lowest|first|most) since\b|since 20\d\d-\d\d|since '\d\d/i],
  ["nba-history", /NBA history|all-time/i], ["team-history", /team history|franchise history/i], ["streak", /\bstraight\b|in a row|consecutive/i],
  ["tonight", /tonight/i], ["only", /\bonly\b|no (?:other )?(?:current )?(?:team|player)/i], ["record", /\brecord\b/i], ["notes", /\bnotes\b/i],
  ["shooting", /\b(?:FG|3PT|TS%|3-point|three)/i], ["defense", /allowed|held opponents/i],
];

export function features(l, stars = {}) {
  const f = [`kind:${l.kind}`];
  const prom = l.player ? stars[l.player] ?? 0.3 : null;
  f.push(l.player ? (prom >= 0.6 ? "who:star" : prom >= 0.35 ? "who:regular" : "who:lesser") : "who:team");
  for (const [w, re] of WORDS) if (re.test(l.text || "")) f.push(`says:${w}`, `${l.kind}+${w}`);
  // 0.81: a finder line also counts for its test (part / teams / gap) and for the cut it used, so votes can tell
  // "more pieces-of-his-scoring, fewer player-against-whole-teams" apart.
  if (l.kind === "find" && l.key) { const [, test, , cut] = String(l.key).split("|"); if (test) f.push(`find:${test}`); for (const c of String(cut || "").split("+")) if (c) f.push(`find:${test}:${c}`); }
  return f;
}

export function learn(votes = [], stars = {}) {
  const tally = {};
  const down = new Set(), up = new Set();
  for (const v of votes) {
    if (!v || !v.key || !v.v) continue;
    (v.v > 0 ? up : down).add(v.key);
    for (const f of features(v, stars)) { const t = (tally[f] ??= { up: 0, down: 0 }); t[v.v > 0 ? "up" : "down"]++; }
  }
  const weights = {};
  for (const [f, t] of Object.entries(tally)) if (t.up + t.down >= 2) weights[f] = Math.round((0.8 * (t.up - t.down)) / (t.up + t.down + 2) * 100) / 100;
  return { weights, up, down, n: up.size + down.size, tally };
}

export function boost(l, model, stars = {}) {
  if (!model) return 0;
  const s = features(l, stars).reduce((a, f) => a + (model.weights[f] || 0), 0);
  return Math.max(-1.5, Math.min(1.5, Math.round(s * 100) / 100));
}
