/**
 * Build check (0.73; the user's OK, 11/15): one message to #alerts on a day the site's build isn't doing its job.
 *
 * The build runs on GitHub; this Worker doesn't depend on it, so it can say when it's missing. Every 5 minutes
 * from 12:30 PM to 7 PM ET it reads the site's health note (docs/data/health.json, written by every build) and
 * posts once that day if:
 *   - no build has finished today (the 8 AM and 10:30 AM builds were both missed), or
 *   - the latest build had a step that didn't finish, or
 *   - the latest build is more than 5 hours old (they run about every 2.5 hours through the day).
 * At most one message a day. After three days in a row it says so and stays quiet until a build goes through
 * (a schedule GitHub switched off over the summer shouldn't post all summer).
 *
 * Secret ALERTS_WEBHOOK (#alerts). KV "health-alert": { day, streak, quiet }.
 */
import { tfetch, bodyJson, LIMIT_MS } from "./net.js";

export const HEALTH_URL = "https://raw.githubusercontent.com/CampGambino/nba-command-center/main/docs/data/health.json";
export const RUNS_URL = "https://github.com/CampGambino/nba-command-center/actions/workflows/daily.yml";
const FROM_MIN = 12 * 60 + 30, TO_MIN = 19 * 60, STALE_HOURS = 5, QUIET_AFTER_DAYS = 3;
const STEP = { tonight: "notes and milestones", situations: "results, stats and storylines", flow: "Game Flow" };

const et = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
};
const clock = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** What's wrong with the latest build, in a sentence, or null. h: the health note; now: ms. */
export function healthProblem(h, now) {
  const at = Date.parse(h?.at);
  if (!h || Number.isNaN(at)) return null; // unreadable isn't the same as broken: say nothing
  if (et(at).ymd !== et(now).ymd) return `No build has finished today. The last one was ${clock(at)} ET.`;
  const failed = (h.steps || []).filter((x) => x && x.ok === false);
  if (failed.length) return `The ${clock(at)} ET build had a problem: ${failed.map((x) => STEP[x.step] || x.step).join(" and ")} didn't finish (${failed.map((x) => x.error || "failed").join("; ")}).`;
  const hours = (now - at) / 3600e3;
  if (hours > STALE_HOURS) return `The site hasn't rebuilt since ${clock(at)} ET (${Math.round(hours)} hours; builds run about every 2.5).`;
  return null;
}

export async function healthCheck(env, now = Date.now(), { dry = false } = {}) {
  if (!env.ALERTS_WEBHOOK && !dry) return { skipped: "no ALERTS_WEBHOOK secret" };
  const t = et(now);
  if (!dry && (t.min < FROM_MIN || t.min >= TO_MIN || t.min % 5 !== 0)) return { skipped: "outside 12:30-7 PM ET, or not a 5-minute mark" };
  const st = (await env.STATE.get("health-alert", "json")) || {};
  if (st.day === t.ymd && !dry) return { skipped: "already said so today" };
  const res = await tfetch(`${HEALTH_URL}?t=${Math.floor(now / 60e3)}`, {}, LIMIT_MS.site);
  const h = res.ok ? await bodyJson(res) : null;
  if (!h) return { waiting: `health note unreadable (${res.status})` };
  const problem = healthProblem(h, now);
  if (dry) return { problem, state: st, built: h.at };
  if (!problem) {
    // Healthy again: forget the streak (one write, only if there was one).
    if (st.streak) await env.STATE.put("health-alert", JSON.stringify({ day: null, streak: 0, quiet: false }));
    return { ok: true };
  }
  if (st.quiet) return { skipped: "said so three days running; quiet until a build goes through", problem };
  const yesterday = et(now - 864e5).ymd;
  const streak = (st.day === yesterday ? st.streak || 0 : 0) + 1;
  const last = streak >= QUIET_AFTER_DAYS;
  const content = `⚠️ **Command Center build check**\n${problem}\nThe Watch List and tonight's storylines are from the last good build until the next one goes through.\nRuns: <${RUNS_URL}>${last ? "\nThat's three days in a row: I'll stop repeating this until a build goes through." : ""}`;
  const post = await tfetch(`${env.ALERTS_WEBHOOK}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "NBA Command Center · Build check", allowed_mentions: { parse: [] }, content }) }, LIMIT_MS.discord);
  if (!post.ok) return { error: `Discord ${post.status}`, problem }; // not recorded: the next 5-minute mark tries again
  await env.STATE.put("health-alert", JSON.stringify({ day: t.ymd, streak, quiet: last }));
  return { posted: 1, problem, streak };
}
