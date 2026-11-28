/**
 * The morning buzz check to #alerts (0.186.0; the user, 11/28: "scheduled task can go to discord").
 *
 * A scheduled task (a Claude session that runs by itself each morning) reads the night's NBA coverage, checks each stat
 * in it against the Command Center's data, and writes its report to docs/data/buzz.json in the repo. This posts that
 * report to #alerts once, the first time it sees a new one. The webhook stays where it is (the ALERTS_WEBHOOK secret in
 * Cloudflare); the scheduled task never touches it.
 *
 * Report: { id, date, generatedAt, searched: [labels], summary?, items: [{ claim, player?, team?, source, url?,
 *           verdict: "true" | "out of date" | "wrong" | "can't check", ours: "found" | "missed" | "n/a", note, cut? }] }
 * KV "buzz": { sent: { id: ms } } (the last 30). A report more than 36 hours old is marked and not posted.
 */
import { tfetch, bodyJson, LIMIT_MS } from "./net.js";

export const BUZZ_URL = "https://raw.githubusercontent.com/CampGambino/nba-command-center/main/docs/data/buzz.json";
export const BUZZ_EVERY_MIN = 10, BUZZ_MAX_AGE_H = 36, BUZZ_MAX_ITEMS = 30;
const MARK = { "true": "✅", "out of date": "🕓", wrong: "❌", "can't check": "❔" };
const clip = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
// no pings, no link previews: a URL goes in <…>; only http(s) links are kept
const safe = (s) => String(s ?? "").replace(/@/g, "@​");
const link = (u) => (/^https?:\/\/\S+$/.test(String(u || "")) ? ` <${u}>` : "");

/** The report as Discord messages (each under 2,000 characters). Pure, for the tests. */
export function buzzPayloads(r) {
  const items = (Array.isArray(r?.items) ? r.items : []).slice(0, BUZZ_MAX_ITEMS);
  const n = (f) => items.filter(f).length;
  const day = (() => { const d = Date.parse(`${r?.date}T12:00:00Z`); return Number.isFinite(d) ? new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : String(r?.date || ""); })();
  const head = `📰 **Buzz check · ${day}** · ${items.length} stat${items.length === 1 ? "" : "s"} from the night's coverage: ${n((i) => i.verdict === "true")} true, ${n((i) => i.verdict === "out of date")} out of date, ${n((i) => i.verdict === "wrong")} wrong`
    + ` · **${n((i) => i.ours === "missed")} our checks didn't find**`
    + (r?.summary ? `\n${safe(clip(r.summary, 400))}` : "")
    + (Array.isArray(r?.searched) && r.searched.length ? `\n-# Read: ${safe(clip(r.searched.join(", "), 300))}` : "");
  // the ones we missed first, then wrong and out of date, then the rest
  const order = (i) => (i.ours === "missed" ? 0 : i.verdict === "wrong" ? 1 : i.verdict === "out of date" ? 2 : 3);
  const lines = [...items].sort((a, b) => order(a) - order(b)).map((i) => {
    const who = [i.player, i.team].filter(Boolean).join(", ");
    const tag = i.ours === "missed" ? "🆕 **missed**" : i.ours === "found" ? "🟢 found" : "";
    return `${MARK[i.verdict] || "•"} ${tag ? `${tag} · ` : ""}${who ? `**${safe(clip(who, 60))}**: ` : ""}${safe(clip(i.claim, 260))}`
      + (i.note ? `\n  ↳ ${safe(clip(i.note, 260))}` : "") + (i.cut ? `\n  ↳ check to add: ${safe(clip(i.cut, 160))}` : "")
      + `\n  -# ${safe(clip(i.source || "", 60))}${link(i.url)}`;
  });
  const out = [];
  let cur = head;
  for (const l of lines) { if ((cur + "\n" + l).length > 1900) { out.push(cur); cur = l; } else cur += "\n" + l; }
  out.push(cur);
  if (!items.length) out[0] += "\nNothing to report.";
  return out.map((content) => ({ username: "NBA Command Center · Buzz check", content, allowed_mentions: { parse: [] }, flags: 4 }));
}

async function postDiscord(url, payload) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await tfetch(`${url}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, LIMIT_MS.discord);
    if (res.ok) return true;
    if (res.status === 429) { const b = await res.json().catch(() => ({})); await new Promise((r) => setTimeout(r, Math.ceil((b.retry_after || 1) * 1000) + 200)); continue; }
    return false;
  }
  return false;
}

/** One run (every minute, from the Worker's schedule); reads the report every BUZZ_EVERY_MIN minutes. */
export async function buzzCheck(env, now = Date.now(), { force = false } = {}) {
  if (!env.ALERTS_WEBHOOK || !env.STATE) return { skipped: "no ALERTS_WEBHOOK secret or STATE" };
  if (!force && new Date(now).getUTCMinutes() % BUZZ_EVERY_MIN !== 7) return { skipped: "not this minute" };
  const r = await tfetch(`${BUZZ_URL}?t=${Math.floor(now / 60e3)}`, {}, LIMIT_MS.site);
  if (!r.ok) return { skipped: `report not read (${r.status})` };
  const rep = await bodyJson(r);
  if (!rep?.id) return { skipped: "no report" };
  const st = (await env.STATE.get("buzz", "json")) || { sent: {} };
  if (st.sent[rep.id]) return { skipped: "already sent" };
  const age = (now - Date.parse(rep.generatedAt || 0)) / 36e5;
  if (!(age <= BUZZ_MAX_AGE_H)) { st.sent[rep.id] = -now; await env.STATE.put("buzz", JSON.stringify(st)); return { skipped: "too old" }; }
  const payloads = buzzPayloads(rep);
  for (const p of payloads) if (!(await postDiscord(env.ALERTS_WEBHOOK, p))) return { error: "Discord didn't take it; tried again next time" };
  st.sent[rep.id] = now;
  st.sent = Object.fromEntries(Object.entries(st.sent).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 30));
  await env.STATE.put("buzz", JSON.stringify(st));
  return { posted: payloads.length, id: rep.id };
}
