/**
 * Web requests with a time limit (0.73; the user's OK, 11/15, after the diagnostic).
 *
 * A request that never answers used to hold a run until Cloudflare stopped it, and whatever the run had already
 * done (a lineup posted, say) was never written down. tfetch gives every request a limit and never throws: a
 * request that times out or can't connect comes back as a 504 answer, which every caller already treats as
 * "didn't work, try again next time".
 */
export const LIMIT_MS = { feed: 8000, espn: 8000, site: 8000, discord: 10000, pdf: 5000, page: 12000 };

export async function tfetch(url, opts = {}, ms = 10000) {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    const why = e?.name === "TimeoutError" || e?.name === "AbortError" ? "timed out" : "network error";
    return new Response(null, { status: 504, statusText: why });
  }
}

/** A body read that can't throw or hang past the request's limit: null when it fails. */
export const bodyJson = (res) => res.json().catch(() => null);
export const bodyText = (res) => res.text().catch(() => null);
