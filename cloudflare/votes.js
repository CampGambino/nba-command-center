/**
 * Briefing votes (0.67): 👍 / 👎 on the Watch List's briefing lines, kept in the Worker's KV ("votes"), so the
 * daily build can learn what the user wants on top (src/anticipate/learn.js).
 *
 *   GET  /votes            every vote, public (the lines are public anyway), read by the build and the page.
 *   POST /vote?k=<key>     one vote: { key, kind, team, player, text, d, v: 1 | -1 | 0 | 2 }; 0 takes a vote back;
 *                          2 (0.139) = "used it": the user copied the line to post it (counts as a strong 👍).
 *                          Only with the private key (the review page's): the page gets it once from the review
 *                          page's "Vote on the briefing" link (in the URL's #fragment, which never reaches a server).
 *
 * Kept small: the latest vote per line, at most 3,000; text clipped to 300 characters. One KV write per vote.
 */
export const SITE = "https://campgambino.github.io";
const CORS = { "Access-Control-Allow-Origin": SITE, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
const MAX = 3000;
// 0.141.3 (security check, 11/20): /votes is public, so a flood of reads could use up the free plan's 100,000 KV reads a
// day and stop the alerts. Each Worker copy keeps the answer 60 seconds (a vote clears it), so a flood costs about one
// read a minute per copy. The page and the build read it a few times a day: a minute old is fine.
export const PUBLIC_TTL_MS = 60e3;
let cached = null;   // { at, votes }
export const _resetVotesCache = () => { cached = null; };
const clip = (s, n) => (s == null ? null : String(s).slice(0, n));

export async function handleVotes(req, env, url, key) {
  if (url.pathname !== "/votes" && url.pathname !== "/vote") return null;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const json = (body, status = 200) => Response.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store" } });
  if (!env.STATE) return json({ error: "no STATE store" }, 503);
  if (url.pathname === "/votes" && req.method === "GET") {
    if (!cached || Date.now() - cached.at > PUBLIC_TTL_MS) cached = { at: Date.now(), votes: (await env.STATE.get("votes", "json")) || [] };
    return json({ votes: cached.votes });
  }
  if (url.pathname === "/vote" && req.method === "POST") {
    if (url.searchParams.get("k") !== key) return json({ error: "not allowed" }, 403);
    let b;
    try { b = JSON.parse(await req.text()); } catch { return json({ error: "bad body" }, 400); }
    const v = Number(b?.v);
    if (!b || typeof b.key !== "string" || !b.key || ![1, -1, 0, 2].includes(v)) return json({ error: "bad vote" }, 400);
    const k = clip(b.key, 200);
    const votes = ((await env.STATE.get("votes", "json")) || []).filter((x) => x.key !== k);
    if (v) votes.push({ key: k, kind: clip(b.kind, 20), team: clip(b.team, 4), player: clip(b.player, 60), text: clip(b.text, 300), d: clip(b.d, 10), v, at: Date.now(), ...(b.claim ? { claim: clip(b.claim, 16) } : {}) });
    const kept = votes.slice(-MAX);
    await env.STATE.put("votes", JSON.stringify(kept));
    cached = null;
    return json({ ok: true, n: kept.length });
  }
  return json({ error: "not found" }, 404);
}
