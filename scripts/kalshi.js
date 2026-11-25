/**
 * Kalshi's NBA markets, read from its public market-data API (no key): every open market in every NBA series, about once
 * an hour from .github/workflows/kalshi.yml.
 *
 *   node scripts/kalshi.js [--state file] [--dry]
 *     DISCORD_WEBHOOK_KALSHI=<url>   optional: lines are posted there. It comes ONLY from the environment (a GitHub secret).
 *
 * Kept between runs in the state file (the workflow holds it in the Actions cache, not in the repo): each market's last
 * price, the price at its last alert, and its last 15 daily closes. Committed: history/kalshi/moves-YYYY-MM.jsonl (every
 * move of 2 points or more between two looks; 5 or more for a market tied to one game), history/kalshi/alerts.jsonl,
 * and history/kalshi/status.json (what the last run saw). The rules for a line are in src/kalshi.js.
 * Read only: nothing here trades or signs in. Kalshi's website is never read (its terms bar that); only the API.
 */
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { look, line, priceOf, cents } from "../src/kalshi.js";
import { KALSHI_SERIES } from "../src/situations/eligibility.js";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), args = process.argv.slice(2), arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const stateFile = arg("--state", path.join(root, ".cache", "kalshi-state.json")), dry = args.includes("--dry"), out = path.join(root, "history", "kalshi");
const BASES = ["https://external-api.kalshi.com/trade-api/v2", "https://api.elections.kalshi.com/trade-api/v2"];
const H = { headers: { "User-Agent": "nba-command-center (personal project; github.com/CampGambino/nba-command-center)", Accept: "application/json" } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let base = BASES[0], calls = 0;
async function get(p) {
  for (let k = 0; k < 5; k++) { try { calls++; const r = await fetch(base + p, H);
      if (r.status === 429 || r.status >= 500) { await sleep(Number(r.headers.get("retry-after")) * 1000 || 1500 * (k + 1)); continue; }
      if (!r.ok) throw new Error(`${r.status} ${p}`); return await r.json(); } catch (e) { if (k === 4) throw e; await sleep(1000 * (k + 1)); } }
  throw new Error("gave up: " + p);
}
const isNba = (x) => (/\bNBA\b|pro basketball/i.test(`${x.title} ${(x.tags || []).join(" ")}`) || /^KXNBA/i.test(x.ticker)) && !/WNBA|college|NCAA/i.test(`${x.ticker} ${x.title}`);
const prev = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {}, now = new Date().toISOString();
// the series: the whole list once a day (it is 7 MB), the ones that had something open in between
let series = prev.series || [], listed = prev.seriesAt || "";
if (!series.length || Date.parse(now) - Date.parse(listed) > 20 * 3600e3) {
  let j; try { j = await get("/series?category=Sports"); } catch (e) { base = BASES[1]; j = await get("/series?category=Sports"); }
  series = (j.series || []).filter(isNba).map((x) => ({ t: x.ticker, title: x.title, open: true })); listed = now;
}
const events = []; let q = series.filter((s) => s.open !== false).map((s) => s.t);
await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) { const t = q.shift(); let cursor = "", n = 0, pages = 0;
    do { const j = await get(`/events?series_ticker=${t}&status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      for (const e of j.events || []) { events.push({ series_ticker: e.series_ticker || t, event_ticker: e.event_ticker, title: e.title, mutually_exclusive: e.mutually_exclusive, markets: (e.markets || []).filter((m) => !m.status || /active|open/i.test(m.status)) }); n++; }
      cursor = j.cursor || ""; pages++; await sleep(80); } while (cursor && pages < 25);
    if (listed === now) series.find((s) => s.t === t).open = n > 0; } }));
const { state, alerts, moves, counts } = look(prev, events, now);
state.series = series; state.seriesAt = listed; state.hooked = prev.hooked || false;
const status = { at: now, api: base, calls, series: series.length, seriesOpen: series.filter((s) => s.open !== false).length, ...counts, moves: moves.length, alerts: alerts.length, firstLook: !prev.at, webhook: !!process.env.DISCORD_WEBHOOK_KALSHI };
console.log("kalshi:", JSON.stringify(status));
for (const a of alerts) console.log("  " + line(a));
if (dry) process.exit(0);
fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state));
fs.mkdirSync(out, { recursive: true });
if (moves.length) fs.appendFileSync(path.join(out, `moves-${now.slice(0, 7)}.jsonl`), moves.map((m) => JSON.stringify(m)).join("\n") + "\n");
if (alerts.length) fs.appendFileSync(path.join(out, "alerts.jsonl"), alerts.map((a) => JSON.stringify(a)).join("\n") + "\n");
// what is open, by series, and each one-winner market's favorite: small, and only rewritten when it changes
const bySeries = {}; for (const e of events) { const b = (bySeries[e.series_ticker] ||= { events: 0, markets: 0 }); b.events++; b.markets += e.markets.length; }
const board = { series: Object.fromEntries(series.filter((s) => bySeries[s.t]).map((s) => [s.t, { title: s.title, ...bySeries[s.t] }])), favorites: Object.fromEntries(Object.entries(state.e).map(([k, v]) => [k, `${v.name} ${v.p}%`])) };
const boardFile = path.join(out, "board.json"), boardText = JSON.stringify(board, null, 1);
if (!fs.existsSync(boardFile) || fs.readFileSync(boardFile, "utf8") !== boardText) fs.writeFileSync(boardFile, boardText);
fs.writeFileSync(path.join(out, "status.json"), JSON.stringify(status, null, 1));
// 0.144.0: the award markets the games-played rule covers (MVP, DPOY, Most Improved, All-NBA, All-Defensive), each
// player's price, for the award eligibility page (src/situations/eligibility.js). Rewritten only when a price changes.
{
  const awards = {};
  for (const e of events) if (KALSHI_SERIES[e.series_ticker]) (awards[e.series_ticker] ||= []).push(...e.markets.map((m) => { const pr = priceOf(m);   // 0.163.0: how the price was read, and the quote behind it, so a stale last trade can be told from a live market
    return { name: m.yes_sub_title || m.subtitle || m.title, p: pr.p, how: pr.how, bid: cents(m.yes_bid_dollars), ask: cents(m.yes_ask_dollars), v: Math.round(Number(m.volume_24h_fp || 0)) }; }).filter((m) => m.name && m.p > 0));
  for (const k of Object.keys(awards)) awards[k].sort((a, b) => b.p - a.p || a.name.localeCompare(b.name));
  const aFile = path.join(out, "awards.json"), was = fs.existsSync(aFile) ? JSON.parse(fs.readFileSync(aFile, "utf8")) : null;
  if (Object.keys(awards).length && JSON.stringify(was?.series) !== JSON.stringify(awards)) fs.writeFileSync(aFile, JSON.stringify({ at: now, series: awards }));
}
// Discord: the first time the secret is seen, one line to say the channel is connected
const url = (process.env.DISCORD_WEBHOOK_KALSHI || "").trim();
if (url) {
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url)) { console.error("kalshi: DISCORD_WEBHOOK_KALSHI doesn't look like a Discord webhook; nothing sent"); process.exit(0); }
  const lines = alerts.slice(0, 12).map(line); if (alerts.length > 12) lines.push(`…and ${alerts.length - 12} more`);
  if (!state.hooked) { lines.unshift(`Kalshi watch is connected: ${counts.markets.toLocaleString("en-US")} open NBA markets read about once an hour. A line appears here when a headline market (MVP, awards, title, conference, division) moves 5+ points or gets a new favorite, or another futures market moves 10+ on real volume. Game-night markets are not posted.`); state.hooked = true; fs.writeFileSync(stateFile, JSON.stringify(state)); }
  if (!lines.length) process.exit(0);
  let msg = ""; const posts = []; for (const l of lines) { if ((msg + "\n" + l).length > 1900) { posts.push(msg); msg = l; } else msg = msg ? msg + "\n" + l : l; } if (msg) posts.push(msg);
  const sent = [];
  for (const content of posts) { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) }); console.log("kalshi: discord", r.status); sent.push(r.status); await sleep(600); }
  // 0.106.3: what Discord answered is kept (no address, no text), so "did the lines arrive?" can be read from the repo
  fs.appendFileSync(path.join(out, "posts.jsonl"), JSON.stringify({ at: now, lines: lines.length, messages: posts.length, discord: sent }) + "\n");
}
