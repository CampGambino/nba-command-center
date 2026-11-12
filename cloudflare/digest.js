/**
 * Pre-game storylines to #alerts, sent by the Worker on its 1-minute schedule (the user's design, 11/12),
 * instead of by the GitHub build (whose scheduled runs start up to 90 minutes late).
 *
 *   - Games tipping before 4 PM ET: their own digest 2 hours before tip ("Afternoon storylines").
 *   - Every other game: one digest at 2 PM ET ("Tonight's storylines").
 *   - Never a game that has already tipped. Each game is sent once.
 *   - The storylines come from the site's data (docs/data/tonight.json on GitHub, built by the GitHub
 *     build, which also runs at 8 AM and 1 PM for this). If that day's data isn't built yet, it waits
 *     and sends as soon as it is (still only games that haven't tipped).
 *
 * Secret ALERTS_WEBHOOK (#alerts) in Cloudflare. KV "digest": { date, sched: [{ id, start }], sent: { id: ms } }.
 */
import { discordDigest } from "../src/anticipate/discord-digest.js";

export const TONIGHT_URL = "https://raw.githubusercontent.com/CampGambino/nba-command-center/main/docs/data/tonight.json";
export const EVENING_AT_MIN = 14 * 60; // 2:00 PM ET
export const EARLY_BEFORE_MIN = 16 * 60; // a tip before 4:00 PM ET is an early game
export const EARLY_LEAD_MIN = 120; // early games: 2 hours before tip

const et = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
};

/** When a game's storylines are due (ms): 2 hours before an early tip, else 2 PM ET that day. */
export function dueAt(startMs) {
  const t = et(startMs);
  if (t.min < EARLY_BEFORE_MIN) return startMs - EARLY_LEAD_MIN * 60e3;
  return startMs - (t.min - EVENING_AT_MIN) * 60e3; // the same day's 2:00 PM (as minutes back from tip)
}

/** The games to send now: due, not tipped yet, not sent. sched: [{ id, start (ISO) }]. */
export function dueNow(sched, now, sent = {}) {
  return sched.filter((g) => { const s = Date.parse(g.start); return !sent[g.id] && now < s && now >= dueAt(s); });
}

async function postDiscord(url, payload) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${url}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) return true;
    if (res.status === 429) { const b = await res.json().catch(() => ({})); await new Promise((r) => setTimeout(r, Math.ceil((b.retry_after || 1) * 1000) + 200)); continue; }
    return false;
  }
  return false;
}

/**
 * One run (every minute). Reads the site's data only when something could be due (or, before the
 * day's schedule is known, every 5 minutes from 8 AM).
 * opts: { dry: report without posting or saving; force: send every not-yet-tipped game now (the test endpoint) }.
 */
export async function digestCheck(env, now = Date.now(), { dry = false, force = false } = {}) {
  if (!env.ALERTS_WEBHOOK && !dry) return { skipped: "no ALERTS_WEBHOOK secret" };
  const t = et(now);
  if (t.min < 8 * 60 && !force) return { skipped: "before 8 AM ET" };
  const st0 = (await env.STATE.get("digest", "json")) || {};
  const st = st0.date === t.ymd ? st0 : { date: t.ymd, sched: null, sent: {} };
  const waiting = st.sched ? dueNow(st.sched, now, st.sent).length > 0 : t.min % 5 === 0;
  if (!waiting && !force && !dry) return { skipped: st.sched ? "nothing due" : "waiting for the 5-minute mark" };
  let data = null;
  try {
    const r = await fetch(`${TONIGHT_URL}?t=${Math.floor(now / 60e3)}`);
    if (r.ok) data = await r.json();
  } catch { /* try again next run */ }
  if (!data || data.today !== t.ymd) return { waiting: `today's site data isn't built yet (${data ? data.today : "unreadable"})` };
  const games = data.games || [];
  st.sched = games.map((g) => ({ id: g.id, start: g.start }));
  const due = force ? games.filter((g) => !st.sent[g.id] && now < Date.parse(g.start)) : dueNow(st.sched, now, st.sent).map((x) => games.find((g) => g.id === x.id));
  const report = { games: games.length, due: due.map((g) => `${g.away} @ ${g.home}`), posted: 0 };
  if (due.length) {
    const early = due.every((g) => et(Date.parse(g.start)).min < EARLY_BEFORE_MIN);
    const date = new Date(`${t.ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    const payloads = discordDigest(due.sort((a, b) => a.start.localeCompare(b.start)), { date, heading: early ? "Afternoon storylines" : "Tonight's storylines", note: early ? "tip before 4 PM ET" : "" });
    if (dry) report.wouldPost = payloads.length;
    else {
      let ok = true;
      for (const p of payloads) { ok = (await postDiscord(env.ALERTS_WEBHOOK, p)) && ok; await new Promise((r) => setTimeout(r, 600)); }
      if (ok) { for (const g of due) st.sent[g.id] = now; report.posted = payloads.length; }
      // Games with no storylines still count as sent (nothing to say about them).
    }
  }
  if (!dry) await env.STATE.put("digest", JSON.stringify(st));
  return report;
}
