// A one-off look, from GitHub, at three outside sources before anything is built on them (the cloud workspace cannot reach them):
// Kalshi's public market-data API, PromoNight's pages and rules, and a team's own promotions page. Writes tools/probe/out.json.
import fs from "node:fs";
const H = { headers: { "User-Agent": "nba-command-center (personal project; github.com/CampGambino/nba-command-center)", Accept: "application/json,text/html;q=0.9,*/*;q=0.8" } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), out = { at: new Date().toISOString(), kalshi: {}, promonight: {}, nba: {} };
async function get(url, as = "json") { try { const r = await fetch(url, H); const t = await r.text(); let body = t; if (as === "json") { try { body = JSON.parse(t); } catch { body = null; } }
    return { status: r.status, bytes: t.length, headers: Object.fromEntries([...r.headers].filter(([k]) => /rate|retry|limit/i.test(k))), body, text: as === "json" && body == null ? t.slice(0, 300) : undefined }; } catch (e) { return { status: 0, error: String(e.cause?.code || e.message) }; } }
// 1. Kalshi
for (const base of ["https://external-api.kalshi.com/trade-api/v2", "https://api.elections.kalshi.com/trade-api/v2"]) {
  const k = (out.kalshi[base] = {});
  const s = await get(`${base}/series?category=Sports`); k.series = { status: s.status, bytes: s.bytes, headers: s.headers, error: s.error, text: s.text };
  const all = s.body?.series || []; k.series.count = all.length; k.series.keys = all[0] ? Object.keys(all[0]) : [];
  const nba = all.filter((x) => /\bNBA\b|pro basketball/i.test(`${x.title} ${(x.tags || []).join(" ")}`) || /^KXNBA/i.test(x.ticker)).filter((x) => !/WNBA|college|NCAA/i.test(`${x.ticker} ${x.title}`));
  k.nbaSeries = nba.map((x) => ({ ticker: x.ticker, title: x.title, frequency: x.frequency, tags: x.tags }));
  if (!all.length) continue;
  let events = 0, markets = 0; k.bySeries = [];
  for (const x of nba.slice(0, 150)) { let cursor = "", ev = 0, mk = 0, pages = 0, sample = null, st = 0;
    do { const r = await get(`${base}/events?series_ticker=${x.ticker}&status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${cursor}` : ""}`); st = r.status; await sleep(120);
      const es = r.body?.events || []; ev += es.length; for (const e of es) { mk += (e.markets || []).length; if (!sample && e.markets?.[0]) sample = { event: { ...e, markets: undefined }, market: e.markets[0], top: [...e.markets].sort((a, b) => Number(b.last_price_dollars ?? b.last_price ?? 0) - Number(a.last_price_dollars ?? a.last_price ?? 0)).slice(0, 5).map((m) => ({ ticker: m.ticker, name: m.yes_sub_title || m.subtitle || m.title, last: m.last_price_dollars ?? m.last_price, bid: m.yes_bid_dollars ?? m.yes_bid, ask: m.yes_ask_dollars ?? m.yes_ask, vol: m.volume_fp ?? m.volume, vol24: m.volume_24h_fp ?? m.volume_24h, oi: m.open_interest_fp ?? m.open_interest })) }; }
      cursor = r.body?.cursor || ""; pages++; } while (cursor && pages < 10);
    events += ev; markets += mk; k.bySeries.push({ ticker: x.ticker, title: x.title, status: st, events: ev, markets: mk, sample: ["KXNBAMVP", "KXNBA", "KXNBAGAME"].includes(x.ticker) || k.bySeries.length < 2 ? sample : sample && { event: sample.event.event_ticker, title: sample.event.title, top: sample.top.slice(0, 3) } }); }
  k.total = { series: nba.length, events, markets };
  // price history between two looks: one market's hourly candles for the last two days
  const mvp = k.bySeries.find((b) => b.ticker === "KXNBAMVP")?.sample?.top?.[0]?.ticker;
  if (mvp) { const now = Math.floor(Date.now() / 1000), c = await get(`${base}/series/KXNBAMVP/markets/${mvp}/candlesticks?start_ts=${now - 2 * 86400}&end_ts=${now}&period_interval=60`); k.candles = { status: c.status, n: c.body?.candlesticks?.length, first: c.body?.candlesticks?.[0], last: c.body?.candlesticks?.slice(-1)[0], text: c.text }; }
  break;
}
// 2. PromoNight: its rules for robots, its terms, and how a team page is built
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const P = "https://www.getpromonight.com";
{ const r = await get(`${P}/robots.txt`, "text"); out.promonight.robots = { status: r.status, text: String(r.body || "").slice(0, 2500) }; }
for (const path of ["/terms", "/terms-of-service", "/tos", "/legal/terms"]) { const r = await get(P + path, "text"); await sleep(300);
  if (r.status === 200 && r.bytes > 2000) { const t = strip(String(r.body)); out.promonight.terms = { path, chars: t.length, updated: (t.match(/(?:last updated|effective)[^.]{0,60}/i) || [])[0],
      lines: t.split(/(?<=[.;])\s+/).filter((x) => /scrap|crawl|robot|automat|spider|\bbots?\b|data min|harvest|reproduc|republish|redistribut|personal|non-?commercial|licen[sc]e|permission|frame|mirror/i.test(x)).slice(0, 30).map((x) => x.slice(0, 320)) }; break; }
  else (out.promonight.termsTried ||= []).push({ path, status: r.status, bytes: r.bytes }); }
{ const r = await get(`${P}/nba/atlanta-hawks`, "text"), h = String(r.body || ""); await sleep(300);
  const ld = [...h.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
  const flat = ld.flatMap((x) => (Array.isArray(x) ? x : x["@graph"] || [x]));
  const ids = [...h.matchAll(/id="(promo-\d{4}-\d\d-\d\d-[^"]+)"/g)].map((m) => m[1]);
  const at = h.indexOf('id="promo-2027-01-07'), block = at >= 0 ? h.slice(at - 200, at + 2600) : "";
  out.promonight.team = { status: r.status, bytes: r.bytes, ldTypes: flat.map((x) => x["@type"]).slice(0, 60), ldEvent: flat.find((x) => /Event/.test(String(x["@type"]))) || null, ids: ids.length, firstIds: ids.slice(0, 40), nextData: /__NEXT_DATA__/.test(h), nextF: (h.match(/self\.__next_f/g) || []).length,
    blockHtml: block.replace(/\s+/g, " ").slice(0, 2800), blockText: strip(block).slice(0, 700) }; }
{ const r = await get(`${P}/nba`, "text"), h = String(r.body || ""); out.promonight.hub = { status: r.status, teams: [...new Set([...h.matchAll(/href="\/nba\/([a-z0-9-]+)"/g)].map((m) => m[1]))] }; }
// 3. A team's own page
{ const r = await get("https://www.nba.com/hawks/tickets/promotions", "text"), h = String(r.body || "");
  const nd = (h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/) || [])[1]; let found = [];
  if (nd) { try { const j = JSON.parse(nd); const walk = (o, p, d) => { if (!o || d > 14 || found.length > 12) return; if (typeof o === "string") { if (/Single AF|Bobblehead/i.test(o) && o.length < 400) found.push({ path: p, value: o }); return; } if (typeof o !== "object") return; for (const [k2, v] of Object.entries(o)) walk(v, `${p}.${k2}`, d + 1); }; walk(j, "", 0); } catch (e) { found = [{ error: String(e.message) }]; } }
  out.nba.hawks = { status: r.status, bytes: r.bytes, error: r.error, nextData: nd ? nd.length : 0, mentions: { singleAF: (h.match(/Single AF/gi) || []).length, bobblehead: (h.match(/Bobblehead/gi) || []).length }, found, apis: [...new Set([...h.matchAll(/https?:\/\/[a-z0-9.-]+\/[^"'\s<>]{0,80}(?:promo|giveaway|theme)[^"'\s<>]{0,60}/gi)].map((m) => m[0]))].slice(0, 15) }; }
fs.writeFileSync(new URL("./out.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ kalshi: Object.values(out.kalshi).map((k) => k.total || k.series), promonight: { robots: out.promonight.robots?.status, terms: out.promonight.terms?.path, ids: out.promonight.team?.ids }, nba: out.nba.hawks?.status }));
