/**
 * NBA Command Center: articles watcher (a Cloudflare Worker).
 *
 * Every few minutes (on its Cloudflare cron schedule; the user runs it every 5) it reads ESPN's NBA news API and The Athletic's NBA RSS feed and posts each
 * NEW article worth reading to a Discord channel, with when it was published. Every Athletic NBA
 * story is posted. From ESPN, game recaps, the automated previews, videos, fantasy, betting and
 * unsigned wire / game stories are skipped, except injury news, which is always posted; everything it
 * decided (posted or skipped, and why) is listed on its review page, where the reader trains it:
 * mute a writer or a phrase, always allow a writer, flag a post as noise, or post a skipped one.
 *
 * Setup (Cloudflare dashboard, free plan):
 *   1. Workers & Pages > Create > Worker; replace the code with this file; Deploy.
 *   2. Storage & Databases > KV > Create namespace "ncc-articles";
 *      Worker > Settings > Bindings > Add > KV namespace: variable name STATE.
 *   3. Worker > Settings > Variables and Secrets > Add > Secret: DISCORD_WEBHOOK = the channel's webhook URL.
 *   4. Worker > Settings > Trigger events > Add > Cron: every 5 minutes (*\/5 * * * *); every 2 also fits the free plan.
 *   5. Open https://<worker>.workers.dev/setup once. It posts the review page's private address
 *      to the Discord channel (never shows it in the browser), turns on the buttons under each
 *      post, and sends a test message.
 *
 * Nothing here is secret: the webhook lives only in the Worker's secret. The review page's key
 * is derived from the webhook, so replacing the webhook also replaces the key.
 *
 * Free-plan budgets: 288 runs a day at every 5 minutes (720 at every 2); KV writes only when something new happens (plus one every
 * 30 minutes as a heartbeat), well under the 1,000 a day allowed. CPU (10 ms a run on the free
 * plan): a quiet run reads only the small "seen" record; the decision log is read and written
 * only when there is something new to log.
 */
import { lineupCheck } from "./lineups.js";
import { digestCheck } from "./digest.js";
export const ARTICLES_CRON = "*/5 * * * *";

const FEEDS = [
  { src: "espn", kind: "espn", url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=25" },
  { src: "athletic", kind: "rss", url: "https://www.nytimes.com/athletic/rss/nba/" }, // NBA feed only (the user's choice, 11/11)
];
const SOURCE = { espn: "ESPN", athletic: "The Athletic", nyt: "NYT / The Athletic" };
const COLOR = { espn: 0xd00000, athletic: 0x1f1f1f, nyt: 0x1f1f1f };
const FRESH_MIN = 20;        // first run: post only what was published in the last 20 minutes
const MAX_AGE_H = 6;         // never post anything published more than 6 hours ago
const MAX_POSTS_PER_RUN = 10;
const HEARTBEAT_MIN = 30;
const LOG_KEEP = 250;
const SEEN_DAYS = 5;

// ---------- rules ----------
const ESPN_SKIP_TYPE = { Recap: "game recap", Preview: "automated game preview", Media: "video" };
const ESPN_KEEP_TYPE = new Set(["Story", "HeadlineNews"]);
const SECTION_SKIP = [[/\/fantasy\//, "fantasy"], [/\/betting\//, "betting"], [/\/recap/, "game recap"]];
// Injury news: posted even without a writer's name (the user's choice, 11/11). Unsigned ESPN stories
// are otherwise mostly AI-written game stories, which stay skipped.
export const INJURY = /\b(injur(y|ies|ed)|sprain(ed)?|strain(ed)?|fractur(e|ed)|surgery|mri|torn|tear|ruptured?|concussion|sidelined|day-to-day|ruled out|will miss|expected to miss|to miss|out (for|at least|indefinitely)|hamstring|achilles|ankle|knee|calf|groin|illness|(return|returns|returning) (from|to the lineup))\b/i;
const isInjury = (item) => INJURY.test(`${item.title || ""} ${item.description || ""}`);

const TITLE_SKIP = [
  [/\b(where|how) to watch\b/i, "how-to-watch"],
  [/\bodds\b|\bbest bets?\b|\bparlay|\bpicks?\b|\bprops?\b|\bbetting\b/i, "betting"],
  [/\bfantasy\b/i, "fantasy"],
  [/\bhighlights?\b/i, "highlights"],
  [/\blive (updates|blog|coverage)\b|\blive:/i, "live blog"],
];

export const ATHLETIC_SKIP = [
  [/^the bounce\b/i, "The Bounce (show)"],
  [/\bsports trivia\b/i, "trivia"],
  [/\bfantasy\b/i, "fantasy"],
];

export function decide(item, rules = {}, now = Date.now()) {
  const by = (item.byline || "").toLowerCase();
  const allowWriter = by && (rules.allowBylines || []).some((b) => by.includes(b.toLowerCase()));
  if ((rules.allowKeys || []).includes(item.key)) return { post: true, reason: "you allowed it" };
  if (item.published && now - item.published > MAX_AGE_H * 3600e3) return { post: false, reason: `published over ${MAX_AGE_H}h ago` };
  if (by && (rules.muteBylines || []).some((b) => by.includes(b.toLowerCase()))) return { post: false, reason: `muted writer` };
  const t = item.title || "";
  const word = (rules.muteWords || []).find((w) => w && t.toLowerCase().includes(w.toLowerCase()));
  if (word) return { post: false, reason: `muted phrase "${word}"` };
  if (item.src === "espn") {
    if (ESPN_SKIP_TYPE[item.type]) return { post: false, reason: ESPN_SKIP_TYPE[item.type] };
    if (!ESPN_KEEP_TYPE.has(item.type)) return { post: false, reason: `type ${item.type}` };
    let path = "";
    try { path = item.url ? new URL(item.url).pathname : ""; } catch { path = ""; }
    for (const [re, why] of SECTION_SKIP) if (re.test(path) && !allowWriter) return { post: false, reason: why };
    if (path && !path.startsWith("/nba/") && !allowWriter) return { post: false, reason: "not the NBA section" };
    if (!by) return isInjury(item) ? { post: true, reason: "injury news (no writer named)" } : { post: false, reason: "no writer named (wire or game story)" };
  }
  // The Athletic: every NBA story is wanted, except what the user ruled out (11/12): The Bounce (their daily
  // show), the weekly sports trivia, and fantasy. (The sports watch guide stays: it covers the NBA too.)
  if (item.src === "athletic") {
    for (const [re, why] of ATHLETIC_SKIP) if (re.test(t)) return { post: false, reason: why };
    return { post: true, reason: "Athletic NBA story" };
  }
  if (!allowWriter) for (const [re, why] of TITLE_SKIP) if (re.test(t)) return { post: false, reason: why };
  return { post: true, reason: allowWriter ? "allowed writer" : "kept" };
}

export function tagOf(item) {
  if (/^sources?\b|\bsources (say|tell|said)\b|\bsources:/i.test(item.title || "") || /\bsources (told|said|say)\b/i.test(item.description || "")) return "🚨 Reporting";
  if (INJURY.test(item.title || "")) return "🩹 Injury";
  if (item.type === "HeadlineNews") return "🗞️ News";
  if (item.src === "espn") return item.premium ? "📰 Feature · ESPN+" : "📰 Feature";
  return "📰 Article";
}

// ---------- reading the feeds ----------
// Feeds often carry HTML as escaped text (&lt;p&gt;), sometimes escaped twice (&amp;amp;):
// unescape, strip tags, then unescape what's left.
const unescape = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const decode = (s) => unescape(unescape(String(s ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).replace(/<[^>]+>/g, " "))
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ").trim();
export const normUrl = (u) => {
  try { const x = new URL(u); return (x.host.replace(/^www\./, "") + x.pathname).replace(/\/+$/, "").toLowerCase(); } catch { return String(u || ""); }
};

export function parseEspn(json) {
  return (json.articles || []).map((a) => {
    const url = a.links?.web?.href || "";
    return { src: "espn", key: url ? normUrl(url) : `espn:${a.id}`, id: String(a.id), type: a.type, title: a.headline || "", url, byline: a.byline || "",
      description: a.description || "", published: Date.parse(a.published) || null, premium: !!a.premium };
  });
}

export function parseRss(xml, src) {
  const out = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const body = m[1];
    const tag = (name) => { const r = body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i")); return r ? decode(r[1]) : ""; };
    const tags = (name) => [...body.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "gi"))].map((r) => decode(r[1]));
    let url = tag("link");
    if (!url) { const r = body.match(/<link\b[^>]*href="([^"]+)"/i); url = r ? r[1] : tag("guid"); }
    // Writers: dc:creator, <author> (may be "email (Name)"), Atom-style <author><name>, or media:credit.
    const creators = [...tags("dc:creator"), ...tags("atom:name"), ...tags("name"), ...tags("author").map((a) => (a.match(/\(([^)]+)\)/) || [, a])[1]), ...tags("media:credit")]
      .map((x) => x.trim()).filter((x, i, a) => x && !/@/.test(x) && a.indexOf(x) === i);
    out.push({ src, key: normUrl(url), id: tag("guid") || url, type: "Article", title: tag("title"), url, byline: creators.join(", "),
      description: tag("description"), published: Date.parse(tag("pubDate") || tag("dc:date")) || null, categories: tags("category") });
  }
  return out;
}

async function readFeed(feed) {
  const res = await fetch(feed.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; NBA-Command-Center articles watcher)", Accept: feed.kind === "espn" ? "application/json" : "application/rss+xml, application/xml, text/xml" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return feed.kind === "espn" ? parseEspn(await res.json()) : parseRss(await res.text(), feed.src);
}

// ---------- Discord ----------
const etTime = (ms) => new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const etDate = (ms) => new Date(ms).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
const mins = (ms) => (ms < 90e3 ? "under 2 min" : ms < 90 * 60e3 ? `${Math.round(ms / 60e3)} min` : `${(ms / 3600e3).toFixed(1)} h`);

export function embedFor(item, { now = Date.now(), base = null, key = null } = {}) {
  const who = [SOURCE[item.src] || item.src, item.byline].filter(Boolean).join(" · ");
  const when = item.published ? `Published ${etTime(item.published)} ET (${etDate(item.published)}) · seen ${mins(Math.max(0, now - item.published))} later` : "Publish time not given";
  const buttons = base && key ? `\n\n[👎 Noise](${base}/act?k=${key}&do=noise&key=${encodeURIComponent(item.key)})` +
    (item.byline ? ` · [🔇 Mute ${item.byline.split(/,| and /)[0].trim().slice(0, 40)}](${base}/act?k=${key}&do=mute-writer&v=${encodeURIComponent(item.byline.split(/,| and /)[0].trim())})` : "") +
    ` · [Review](${base}/review?k=${key})` : "";
  const desc = (item.description || "").slice(0, 300);
  return {
    author: { name: `${tagOf(item)} · ${who}`.slice(0, 256) },
    title: (item.title || "(untitled)").slice(0, 256),
    url: item.url || undefined,
    description: (desc + buttons).slice(0, 4000) || undefined,
    color: COLOR[item.src] ?? 0x4f9cf7,
    footer: { text: when.slice(0, 2048) },
    timestamp: item.published ? new Date(item.published).toISOString() : undefined,
  };
}

async function discord(env, payload) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${env.DISCORD_WEBHOOK}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "NBA Command Center · Articles", allowed_mentions: { parse: [] }, ...payload }) });
    if (res.ok) return true;
    if (res.status === 429) { const b = await res.json().catch(() => ({})); await new Promise((r) => setTimeout(r, Math.ceil((b.retry_after || 1) * 1000) + 200)); continue; }
    return false;
  }
  return false;
}

// ---------- state (KV) ----------
async function load(env, name, fallback) { return (await env.STATE.get(name, "json")) ?? fallback; }
async function save(env, name, value) { await env.STATE.put(name, JSON.stringify(value)); }
export async function adminKey(env) {
  const data = new TextEncoder().encode(`ncc-articles:${env.DISCORD_WEBHOOK || ""}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- one check ----------
export async function check(env, now = Date.now()) {
  if (!env.DISCORD_WEBHOOK || !env.STATE) return { error: "missing DISCORD_WEBHOOK secret or STATE KV binding" };
  const state = await load(env, "state", null);
  // First run = no check has completed yet. (/setup can create the state before any check,
  // so "no state" alone isn't enough: on 11/11 that let 5 older articles through.)
  const first = !state || !state.started;
  const st = state || { seen: {}, errors: {}, base: null, lastWrite: 0 };
  if (st.log) { await save(env, "log", st.log); delete st.log; } // older layout kept the log here
  let log = null; // loaded only if something new needs logging
  const rules = await load(env, "rules", { muteBylines: [], muteWords: [], allowBylines: [], allowKeys: [] });
  const key = await adminKey(env);
  let changed = false;
  const fresh = [];
  for (const feed of FEEDS) {
    try {
      const items = await readFeed(feed);
      if (st.errors[feed.src]) { delete st.errors[feed.src]; changed = true; }
      st.ok = st.ok || {}; st.ok[feed.src] = { at: now, items: items.length };
      for (const it of items) if (it.key && !st.seen[it.key] && !fresh.some((f) => f.key === it.key)) fresh.push(it);
    } catch (e) {
      const msg = String(e.message || e).slice(0, 160);
      if (st.errors[feed.src]?.msg !== msg) changed = true;
      st.errors[feed.src] = { msg, at: now };
    }
  }
  fresh.sort((a, b) => (a.published || now) - (b.published || now));
  let posted = 0;
  for (const it of fresh) {
    let d = decide(it, rules, now);
    if (first && d.post && it.published && now - it.published > FRESH_MIN * 60e3) d = { post: false, reason: "already out when the watcher started" };
    if (d.post && posted >= MAX_POSTS_PER_RUN) continue; // next run
    let sent = false;
    if (d.post) {
      sent = await discord(env, { embeds: [embedFor(it, { now, base: st.base, key })] });
      if (!sent) continue; // try again next run
      posted++;
      await new Promise((r) => setTimeout(r, 350));
    }
    st.seen[it.key] = now;
    log = log || (await load(env, "log", []));
    log.unshift({ at: now, key: it.key, src: it.src, type: it.type, title: it.title, url: it.url, byline: it.byline, published: it.published, description: (it.description || "").slice(0, 200), premium: it.premium || false, posted: sent, reason: d.reason });
    changed = true;
  }
  if (log) await save(env, "log", log.slice(0, LOG_KEEP));
  if (first) st.started = now;
  if (changed || first || now - (st.lastWrite || 0) > HEARTBEAT_MIN * 60e3) {
    const cut = now - SEEN_DAYS * 864e5;
    for (const [k, t] of Object.entries(st.seen)) if (t < cut) delete st.seen[k];
    st.lastWrite = now;
    await save(env, "state", st);
  }
  return { first, fresh: fresh.length, posted, errors: st.errors };
}

// ---------- review page ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function page(st, log, rules, key, labels) {
  const a = (doIt, v, label, extra = "") => `<a class="b" href="/act?k=${key}&do=${doIt}&${extra}v=${encodeURIComponent(v)}">${label}</a>`;
  const ago = (t) => (t ? mins(Date.now() - t) + " ago" : "never");
  const src = FEEDS.map((f) => `<li><b>${SOURCE[f.src]}</b>: ${st.errors?.[f.src] ? `<span class="bad">error: ${esc(st.errors[f.src].msg)}</span> (${ago(st.errors[f.src].at)})` : st.ok?.[f.src] ? `OK, ${st.ok[f.src].items} items when last saved` : "not read yet"}</li>`).join("");
  const list = (name, arr, undo) => `<p><b>${name}:</b> ${arr.length ? arr.map((x) => `${esc(x)} ${a(undo, x, "✕")}`).join(" · ") : "<span class=m>none</span>"}</p>`;
  const lab = Object.fromEntries((labels || []).map((l) => [l.key, l.v]));
  // When the watcher first saw it, and how long after publishing (the first column is the publish time).
  const seen = (r) => (r.at && r.published && r.at >= r.published && r.at - r.published < 6 * 3600e3 ? `<br><span class=m>seen ${etTime(r.at)} · +${Math.max(0, Math.round((r.at - r.published) / 60e3))} min</span>` : "");
  const rows = (log || []).map((r) => `<tr class="${r.posted ? "" : "skip"}"><td>${r.published ? etTime(r.published) + "<br><span class=m>" + etDate(r.published) + "</span>" : "–"}${seen(r)}</td>
    <td><span class=m>${esc(SOURCE[r.src] || r.src)}${r.byline ? " · " + esc(r.byline) : ""}</span><br><a href="${esc(r.url)}" target=_blank>${esc(r.title)}</a></td>
    <td>${r.posted ? "posted" : `skipped: ${esc(r.reason)}`}${lab[r.key] ? `<br><b>you: ${esc(lab[r.key])}</b>` : ""}</td>
    <td>${r.posted ? a("noise", r.key, "👎 noise", "key=" + encodeURIComponent(r.key) + "&") : a("post", r.key, "✅ post it", "key=" + encodeURIComponent(r.key) + "&")}
      ${r.byline ? (r.posted ? a("mute-writer", r.byline.split(/,| and /)[0].trim(), "🔇 writer") : a("allow-writer", r.byline.split(/,| and /)[0].trim(), "⭐ always allow writer")) : ""}</td></tr>`).join("");
  return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Articles watcher</title>
<style>body{font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;margin:16px;max-width:1100px}table{border-collapse:collapse;width:100%}td{border-top:1px solid #ddd;padding:7px 6px;vertical-align:top}
tr.skip td{color:#777}.m{color:#888;font-size:12px}.b{display:inline-block;margin:2px 4px 2px 0;padding:2px 7px;border:1px solid #ccc;border-radius:6px;text-decoration:none;font-size:12px;white-space:nowrap}.bad{color:#c00}
input{padding:5px;font-size:14px}</style>
<h2>NBA Command Center · Articles watcher</h2>
<ul>${src}</ul><p class=m>Checks on its Cloudflare schedule (every 5 minutes); saves only when something new arrives, or every 30 minutes to show it's alive. Last saved ${ago(st.lastWrite)}${st.lastWrite && Date.now() - st.lastWrite > 40 * 60e3 ? ` <span class=bad>(over 40 minutes: the 2-minute schedule may not be running)</span>` : ""}.</p>
${list("Muted writers", rules.muteBylines, "unmute-writer")}${list("Always-allowed writers", rules.allowBylines, "unallow-writer")}${list("Muted phrases", rules.muteWords, "unmute-word")}
<form action="/act"><input type=hidden name=k value="${key}"><input type=hidden name=do value="mute-word"><input name=v placeholder="mute a phrase in titles"> <button>Mute</button></form>
<h3>Recent decisions</h3><table>${rows || "<tr><td>Nothing yet.</td></tr>"}</table>`;
}

async function act(env, url, key) {
  const p = url.searchParams, what = p.get("do"), v = (p.get("v") || "").trim().slice(0, 80), itemKey = p.get("key") || v;
  const rules = await load(env, "rules", { muteBylines: [], muteWords: [], allowBylines: [], allowKeys: [] });
  const labels = await load(env, "labels", []);
  const add = (arr, x) => (x && !arr.includes(x) ? arr.push(x) : 0);
  const del = (arr, x) => arr.splice(0, arr.length, ...arr.filter((y) => y !== x));
  let note = "";
  if (what === "mute-writer") { add(rules.muteBylines, v); del(rules.allowBylines, v); note = `Muted ${v}.`; }
  else if (what === "unmute-writer") { del(rules.muteBylines, v); note = `Unmuted ${v}.`; }
  else if (what === "allow-writer") { add(rules.allowBylines, v); del(rules.muteBylines, v); note = `${v} will always be posted (except recaps, previews and videos).`; }
  else if (what === "unallow-writer") { del(rules.allowBylines, v); note = `${v} is back to the normal rules.`; }
  else if (what === "mute-word") { add(rules.muteWords, v.toLowerCase()); note = `Titles with "${v}" will be skipped.`; }
  else if (what === "unmute-word") { del(rules.muteWords, v); note = `"${v}" unmuted.`; }
  else if (what === "noise") { labels.unshift({ key: itemKey, v: "noise", at: Date.now() }); note = "Marked as noise. Thanks: this is how the rules get tuned."; }
  else if (what === "post") {
    const st = await load(env, "state", null);
    const log = await load(env, "log", []);
    const r = log.find((x) => x.key === itemKey);
    if (r && !r.posted) {
      const ok = await discord(env, { embeds: [embedFor({ ...r }, { base: st?.base, key })] });
      if (ok) { r.posted = true; r.reason = "posted by you"; await save(env, "log", log); }
      labels.unshift({ key: itemKey, v: "should have posted", at: Date.now() });
      note = ok ? "Posted to Discord, and noted as a miss." : "Discord didn't accept it; try again.";
    }
  } else return new Response("Unknown action", { status: 400 });
  await save(env, "rules", rules);
  await save(env, "labels", labels.slice(0, 500));
  return new Response(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><meta http-equiv=refresh content="2;url=/review?k=${key}"><p style="font:16px sans-serif;margin:20px">${esc(note)} Back to the review page…</p>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export default {
  // Two schedules (wrangler.toml), each its own run with its own CPU budget:
  //   every 5 minutes: articles;  every minute: lineups (cloudflare/lineups.js; private #lineups, LINEUPS_WEBHOOK
  //   secret), which does nothing unless a game is within 90 minutes of tip or just tipped, and the pre-game
  //   storylines to #alerts (cloudflare/digest.js; ALERTS_WEBHOOK secret), which reads only when one is due.
  async scheduled(event, env, ctx) {
    const at = event.scheduledTime || Date.now();
    ctx.waitUntil(event.cron === ARTICLES_CRON ? check(env) : Promise.allSettled([lineupCheck(env, at), digestCheck(env, at)]));
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    const key = await adminKey(env);
    const html = (body, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
    if (url.pathname === "/setup") {
      if (!env.DISCORD_WEBHOOK || !env.STATE) return html("<p>Not ready: add the DISCORD_WEBHOOK secret and the STATE KV binding, then reload.</p>", 503);
      // The private review address goes to the Discord channel, never to this browser: whoever
      // opens /setup learns nothing. Opening it again just re-sends the link to the channel.
      const st = await load(env, "state", null) || { seen: {}, errors: {}, lastWrite: 0 };
      if (st.base !== url.origin) { st.base = url.origin; await save(env, "state", st); }
      const ok = await discord(env, { content: `✅ Articles watcher connected. New ESPN and Athletic NBA articles will post here within a few minutes of going up (every Athletic NBA story; from ESPN, recaps, previews, videos, fantasy and betting are skipped).\nYour private review page, to train what gets posted: ${url.origin}/review?k=${key}` });
      return html(ok ? "<p style='font:16px sans-serif'>Done. Check the Discord channel: a test message with your private review link is there.</p>" : "<p>Discord didn't accept the message. Check the DISCORD_WEBHOOK secret.</p>", ok ? 200 : 502);
    }
    if (url.searchParams.get("k") !== key) return new Response("Not found", { status: 404 });
    if (url.pathname === "/review") return html(page(await load(env, "state", {}), await load(env, "log", []), await load(env, "rules", { muteBylines: [], muteWords: [], allowBylines: [] }), key, await load(env, "labels", [])));
    if (url.pathname === "/act") return act(env, url, key);
    if (url.pathname === "/check") return Response.json(await check(env));
    // Private diagnostics: every item of an Athletic feed (?list=nba or nba/knicks), or a slice of an Athletic page
    // (?page=<nytimes.com/athletic/... URL>&find=<text>), to see what a feed carries and how a page is built.
    if (url.pathname === "/peek" && (url.searchParams.get("list") || url.searchParams.get("page"))) {
      const UA = { "User-Agent": "Mozilla/5.0 (compatible; NBA-Command-Center articles watcher)" };
      const list = url.searchParams.get("list");
      if (list) {
        if (!/^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(list)) return new Response("bad list", { status: 400 });
        const res = await fetch(`https://www.nytimes.com/athletic/rss/${list}/`, { headers: UA });
        const text = await res.text();
        const items = [...text.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => {
          const g = (tag) => (m[0].match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, "i")) || [])[1] || "";
          return `${g("pubDate")} | ${g("title")} | ${g("link")}`;
        });
        return new Response(`${res.status} ${items.length} items\n${items.join("\n")}`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
      const page = url.searchParams.get("page");
      if (!/^https:\/\/www\.nytimes\.com\/athletic\//.test(page)) return new Response("bad page", { status: 400 });
      const res = await fetch(page, { headers: UA });
      const text = await res.text();
      const find = url.searchParams.get("find") || "";
      const at = find ? text.indexOf(find) : 0;
      const from = Math.max(0, at < 0 ? 0 : at - 300);
      return new Response(`${res.status} ${text.length} chars; "${find}" at ${at}\n\n${text.slice(from, from + 4000)}`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/peek") { // first item of a feed, raw, to see its layout (private)
      const f = FEEDS.find((x) => x.src === url.searchParams.get("src")) || FEEDS[1];
      const text = await (await fetch(f.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; NBA-Command-Center articles watcher)" } })).text();
      const m = text.match(/<item\b[\s\S]*?<\/item>/i);
      return new Response(`${f.url}\n\nfeed head:\n${text.slice(0, 700)}\n\nfirst item:\n${m ? m[0].slice(0, 3000) : "(no <item>)"}`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/labels") return Response.json({ labels: await load(env, "labels", []), rules: await load(env, "rules", {}) });
    // Lineups: ?dry=1 reads and reports without posting; &date=YYYYMMDD reads another day's file;
    // &test=1 (with a past date) posts one sample to #lineups to check the webhook.
    // Storylines digest: ?dry=1 reports what's due without posting; ?test=1 posts a TEST message to #alerts.
    if (url.pathname === "/digest") {
      const q = url.searchParams;
      if (q.get("test") === "1") {
        if (!env.ALERTS_WEBHOOK) return Response.json({ error: "no ALERTS_WEBHOOK secret yet" });
        const r = await fetch(`${env.ALERTS_WEBHOOK}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "NBA Command Center", content: "✅ TEST: Cloudflare can post the pre-game storylines here (games before 4 PM ET: 2 hours before tip; the rest: 2 PM ET).", allowed_mentions: { parse: [] } }) });
        return Response.json({ posted: r.ok, status: r.status });
      }
      return Response.json(await digestCheck(env, Date.now(), { dry: true }));
    }
    if (url.pathname === "/lineups") {
      const q = url.searchParams;
      if (q.get("timing")) return Response.json((await env.STATE.get(`lineups-timing:${q.get("timing")}`, "json")) || (await env.STATE.get("lineups", "json")) || {}); // ?timing=YYYY-MM-DD
      return Response.json(await lineupCheck(env, Date.now(), { dry: q.get("dry") === "1", date: q.get("date") || null, test: q.get("test") === "1" && !!q.get("date") }));
    }
    return new Response("Not found", { status: 404 });
  },
};
