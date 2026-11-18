/**
 * Kalshi's NBA markets (0.102): what a market's price is, which markets are tied to one game, and when a move is worth a
 * line. Pure logic; scripts/kalshi.js does the reading and writing.
 *
 * A price is in cents, which is the market's chance in points (31 = 31%).
 *
 *   priceOf(market)                       -> { p, how }  the midpoint of a tight bid and ask, else the last trade
 *   isGameEvent(eventTicker)              -> true for a market tied to one game (KXNBAGAME-26NOV17NYKTOR)
 *   typical(closes)                       -> the market's usual day-to-day move (median of the last 14), at least 1
 *   look(state, events, now, opts)        -> { state, alerts, moves, counts }   one pass over everything open
 *
 * When a move is a line. The first night (0.102, one rule for everything, 5 points) would have posted 67 lines in three
 * hours, most from thin markets whose quotes jump with no trading, so 0.103 sorts the markets:
 *   - headline (MVP and the other awards, champion, conference, division, top seed, Cup): a move of max(5, 3 x the market's
 *     usual daily move) from its price at the last alert, with 100+ contracts traded in the last day; a long shot (10 or
 *     under) that doubles, gains 3 and reaches 5 ("from the pack"); a new favorite by 2 or more;
 *   - every other future (win totals, seeds, stat leaders, next team...): a move of max(10, 3 x usual) with 500+ contracts
 *     traded, and one line per market group in a look (its biggest mover); no favorite lines;
 *   - anything tied to one game, or due to settle within 36 hours: logged (the winner market only), never a line.
 * After a line the market's base is its new price, so one move is reported once.
 */
export const HEADLINE = /^KXNBA(MVP|ROY|DPOY|COY|SIXTH|MIMP|CLUTCH|EXEC|FINMVP|EFINMVP|WFINMVP|CUPMVP|CUP|EAST|WEST|CONF|EAST1SEED|WEST1SEED|ATLANTIC|CENTRAL|SOUTHEAST|NORTHWEST|PACIFIC|SOUTHWEST|RECORD)?$/;
export const tier = (series) => (HEADLINE.test(String(series || "").toUpperCase()) ? 1 : 2);
export const cents = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 100));
export function priceOf(m) {
  const b = cents(m.yes_bid_dollars), a = cents(m.yes_ask_dollars), l = cents(m.last_price_dollars), two = b > 0 && a != null && a < 100 && a >= b;
  if (two && a - b <= 6) return { p: Math.round((a + b) / 2), how: "mid" };
  if (l != null && l > 0 && (!two || (l >= b && l <= a))) return { p: l, how: "last" };
  if (two) return { p: Math.round((a + b) / 2), how: "wide" };
  return { p: l, how: "none" };
}
export const isGameEvent = (ev) => /-\d{2}[A-Z]{3}\d{2}[A-Z]{4,8}(?:-|$)/.test(String(ev || "").toUpperCase());      // KXNBAGAME-26NOV17NYKTOR, KXNBARACE-26NOV18MILMIA-30
export function typical(closes) {
  const d = []; for (let i = Math.max(1, (closes || []).length - 14); i < (closes || []).length; i++) d.push(Math.abs(closes[i] - closes[i - 1]));
  if (d.length < 3) return 1; d.sort((x, y) => x - y); return Math.max(1, d[Math.floor(d.length / 2)]);
}
export const threshold = (closes) => Math.max(5, 3 * typical(closes));
const dayOf = (iso) => new Date(Date.parse(iso) - 5 * 3600e3).toISOString().slice(0, 10);      // a day turns over at midnight Eastern (standard time)
export function look(prev, events, now, opts = {}) {
  const state = { at: now, m: {}, e: {} }, alerts = [], moves = [], counts = { events: 0, markets: 0, game: 0, priced: 0 }, first = !prev?.at, newDay = !first && dayOf(prev.at) !== dayOf(now);
  for (const ev of events) {
    counts.events++; const rows = [], T = tier(ev.series_ticker), found = [];
    const soon = (ev.markets || []).some((m) => m.expected_expiration_time && Date.parse(m.expected_expiration_time) - Date.parse(now) < 36 * 3600e3), game = isGameEvent(ev.event_ticker) || soon;
    for (const m of ev.markets || []) {
      counts.markets++; if (game) counts.game++;
      const { p, how } = priceOf(m), was = prev?.m?.[m.ticker], vol24 = Math.round(Number(m.volume_24h_fp || 0)), name = m.yes_sub_title || m.subtitle || m.title;
      if (p == null) continue; counts.priced++;
      const s = { p, base: was?.base ?? p, baseAt: was?.baseAt ?? now, d: was?.d ? [...was.d] : [], n: name, e: ev.event_ticker };
      if (newDay && was && !game) s.d = [...s.d, was.p].slice(-15);           // yesterday's last look is the day's close
      const live = how === "mid" || vol24 > 0;
      // logged: every futures move of 2 or more; for games only the winner market (KXNBAGAME), 5 or more, so the log stays small (11,000 of the 17,800 open markets are tied to one game)
      if (was && Math.abs(p - was.p) >= (game ? 5 : 2) && live && (!game || ev.series_ticker === "KXNBAGAME")) moves.push([now, m.ticker, was.p, p, vol24, ...(game ? [m.expected_expiration_time || ""] : [])]);
      const traded = vol24 >= (T === 1 ? 100 : 500);
      if (was && !game && traded) {
        const thr = Math.max(T === 1 ? 5 : 10, 3 * typical(s.d)), up = p - s.base;
        const kind = Math.abs(up) >= thr ? "move" : s.base <= 10 && p >= Math.max(2 * s.base, s.base + 3, T === 1 ? 5 : 10) ? "surge" : null;
        if (kind) found.push({ a: { at: now, kind, tier: T, series: ev.series_ticker, event: ev.event_ticker, title: ev.title, ticker: m.ticker, name, from: s.base, to: p, since: s.baseAt, usual: typical(s.d), vol24 }, s });
      }
      state.m[m.ticker] = s; rows.push({ t: m.ticker, name, p, live: live && traded });
    }
    // a headline market reports every mover; any other group only its biggest (a win-total ladder moves all its rungs at once)
    found.sort((x, y) => Math.abs(y.a.to - y.a.from) - Math.abs(x.a.to - x.a.from));
    for (const f of T === 1 ? found : found.slice(0, 1)) { alerts.push(f.a); f.s.base = f.a.to; f.s.baseAt = now; }
    if (T !== 1 && found.length > 1) alerts[alerts.length - 1].also = found.length - 1;
    // a new favorite, where only one outcome can win
    if (!game && T === 1 && ev.mutually_exclusive && rows.length > 1) {
      const top = rows.filter((r) => r.live).sort((x, y) => y.p - x.p)[0], was = prev?.e?.[ev.event_ticker];
      if (top) { state.e[ev.event_ticker] = { leader: top.t, name: top.name, p: top.p };
        const old = was && rows.find((r) => r.t === was.leader);
        if (was && was.leader !== top.t && old && top.p >= old.p + 2 && !opts.noLeader) alerts.push({ at: now, kind: "leader", tier: 1, series: ev.series_ticker, event: ev.event_ticker, title: ev.title, ticker: top.t, name: top.name, to: top.p, past: was.name, pastTo: old.p });
        else if (was && was.leader !== top.t) state.e[ev.event_ticker] = was; }             // within 2 points: the old favorite stays the favorite
      else if (was) state.e[ev.event_ticker] = was;
    }
  }
  alerts.sort((x, y) => (x.tier || 1) - (y.tier || 1));
  return { state, alerts: first ? [] : alerts, moves: first ? [] : moves, counts };
}
/** One alert as a Discord line. */
export function line(a) {
  const url = `https://kalshi.com/markets/${String(a.series).toLowerCase()}/event/${String(a.event).toLowerCase()}`, what = a.title || a.event;
  if (a.kind === "leader") return `**${what}**: new favorite **${a.name}** ${a.to}% (was ${a.past}, now ${a.pastTo}%) <${url}>`;
  const days = Math.max(0, Math.round((Date.parse(a.at) - Date.parse(a.since)) / 864e5)), span = days >= 1 ? `${days}d ago` : "earlier today";
  return `**${what}**: ${a.name} ${a.to > a.from ? "▲" : "▼"} **${a.to}%** (was ${a.from}% ${span}${a.kind === "surge" ? "; from the pack" : ""}; ${a.vol24.toLocaleString("en-US")} contracts in 24h${a.also ? `; ${a.also} more in this group moved` : ""}) <${url}>`;
}
