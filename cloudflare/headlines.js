/**
 * Headlines (0.70): what the news is about, for the briefing's "in the news" boost (src/anticipate/buzz.js).
 *
 *   GET /headlines   the last 72 hours of ESPN and Athletic NBA headlines the articles watcher saw (posted to
 *                    Discord or not): { at, src, title } only. Public, like the articles themselves; nothing from
 *                    the review page (no reasons, no rules, no links back to it).
 *
 * The daily build reads it once and counts how often each player and team on tonight's slate is in the headlines,
 * which is as close as the Command Center gets to "what NBA Twitter is talking about" without scraping Twitter.
 */
const HOURS = 72;
const MAX = 400;
// 0.141.3 (security check, 11/20): public, so the answer is kept 60 seconds in each Worker copy: a flood of reads costs
// about two KV reads a minute per copy, not two per request (the free plan has 100,000 a day, which the alerts need).
const TTL_MS = 60e3;
let cached = null;   // { at, body }
export const _resetHeadlinesCache = () => { cached = null; };
export async function handleHeadlines(req, env, url, now = Date.now()) {
  if (url.pathname !== "/headlines") return null;
  const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };
  if (req.method !== "GET") return Response.json({ error: "not found" }, { status: 404, headers });
  if (cached && now - cached.at <= TTL_MS && now >= cached.at) return Response.json(cached.body, { headers });
  const log = (env.STATE && (await env.STATE.get("log", "json"))) || [];
  const recent = log.filter((x) => x && x.title && now - (x.published || x.at || 0) <= HOURS * 3600e3)
    .slice(0, MAX).map((x) => ({ at: x.published || x.at, src: String(x.src || "").slice(0, 20), title: String(x.title).slice(0, 200), posted: !!x.posted }));   // 0.136.4: posted or held back (not why: the reasons can name muted writers or words)
  // 0.131: the live blog's state, public like the rest (a public blog address and times; no rules, no review link),
  // so a reader without the review page can tell whether it is being read.
  const st = (env.STATE && (await env.STATE.get("state", "json"))) || {};
  const lo = st.ok?.["athletic:live"] || null, err = st.errors?.["athletic:live"] || null;
  const live = { url: st.live?.url || lo?.blog || null, newest: st.live?.newest || lo?.newest || null, readAt: lo?.at || null, problem: err ? err.msg : null };
  // 0.134.0: each main feed's last read (time, items, any error), so a new source can be confirmed from outside.
  const sources = Object.fromEntries(["espn", "athletic", "fos", "nba:power-rankings", "nba:mvp-ladder", "nba:rookie-ladder"].map((k) => [k, { readAt: st.ok?.[k]?.at || null, items: st.ok?.[k]?.items ?? null, problem: st.errors?.[k]?.msg || null }]));
  cached = { at: now, body: { hours: HOURS, headlines: recent, live, sources } };
  return Response.json(cached.body, { headers });
}
