/**
 * Briefing votes (0.67): 👍 / 👎 on the Watch List's briefing lines, kept in the Worker's KV ("votes"), so the
 * daily build can learn what the user wants on top (src/anticipate/learn.js).
 *
 *   GET  /votes            every vote, public (the lines are public anyway), read by the build and the page.
 *   POST /vote?k=<key>     one vote: { key, kind, team, player, text, d, v: 1 | -1 | 0 }; 0 takes a vote back.
 *                          Only with the private key (the review page's): the page gets it once from the review
 *                          page's "Vote on the briefing" link (in the URL's #fragment, which never reaches a server).
 *
 * Kept small: the latest vote per line, at most 3,000; text clipped to 300 characters. One KV write per vote.
 */
export const SITE = "https://campgambino.github.io";
const CORS = { "Access-Control-Allow-Origin": SITE, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
const MAX = 3000;
const clip = (s, n) => (s == null ? null : String(s).slice(0, n));

export async function handleVotes(req, env, url, key) {
  if (url.pathname !== "/votes" && url.pathname !== "/vote") return null;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const json = (body, status = 200) => Response.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store" } });
  if (!env.STATE) return json({ error: "no STATE store" }, 503);
  if (url.pathname === "/votes" && req.method === "GET") return json({ votes: (await env.STATE.get("votes", "json")) || [] });
  if (url.pathname === "/vote" && req.method === "POST") {
    if (url.searchParams.get("k") !== key) return json({ error: "not allowed" }, 403);
    let b;
    try { b = JSON.parse(await req.text()); } catch { return json({ error: "bad body" }, 400); }
    const v = Number(b?.v);
    if (!b || typeof b.key !== "string" || !b.key || ![1, -1, 0].includes(v)) return json({ error: "bad vote" }, 400);
    const k = clip(b.key, 200);
    const votes = ((await env.STATE.get("votes", "json")) || []).filter((x) => x.key !== k);
    if (v) votes.push({ key: k, kind: clip(b.kind, 20), team: clip(b.team, 4), player: clip(b.player, 60), text: clip(b.text, 300), d: clip(b.d, 10), v, at: Date.now() });
    const kept = votes.slice(-MAX);
    await env.STATE.put("votes", JSON.stringify(kept));
    return json({ ok: true, n: kept.length });
  }
  return json({ error: "not found" }, 404);
}
