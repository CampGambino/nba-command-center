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
 * When a move is a line (futures and awards; game markets are only logged until their own guard is set from data):
 *   - move:   the price is at least max(5, 3 x its usual daily move) from where it stood at its last alert (or first sight);
 *   - surge:  a long shot (10 or under) that at least doubles and gains 3 or more ("from below");
 *   - leader: a new favorite in a market where only one outcome can win.
 * A market with an empty book (no bid, no trade in a day) is never a line. After a line the market's base is its new price,
 * so one move is reported once.
 */
export const cents = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 100));
export function priceOf(m) {
  const b = cents(m.yes_bid_dollars), a = cents(m.yes_ask_dollars), l = cents(m.last_price_dollars), two = b > 0 && a != null && a < 100 && a >= b;
  if (two && a - b <= 6) return { p: Math.round((a + b) / 2), how: "mid" };
  if (l != null && l > 0 && (!two || (l >= b && l <= a))) return { p: l, how: "last" };
  if (two) return { p: Math.round((a + b) / 2), how: "wide" };
  return { p: l, how: "none" };
}
export const isGameEvent = (ev) => /-\d{2}[A-Z]{3}\d{2}[A-Z]{4,8}$/.test(String(ev || "").toUpperCase());
export function typical(closes) {
  const d = []; for (let i = Math.max(1, (closes || []).length - 14); i < (closes || []).length; i++) d.push(Math.abs(closes[i] - closes[i - 1]));
  if (d.length < 3) return 1; d.sort((x, y) => x - y); return Math.max(1, d[Math.floor(d.length / 2)]);
}
export const threshold = (closes) => Math.max(5, 3 * typical(closes));
const dayOf = (iso) => new Date(Date.parse(iso) - 5 * 3600e3).toISOString().slice(0, 10);      // a day turns over at midnight Eastern (standard time)
export function look(prev, events, now, opts = {}) {
  const state = { at: now, m: {}, e: {} }, alerts = [], moves = [], counts = { events: 0, markets: 0, game: 0, priced: 0 }, first = !prev?.at, newDay = !first && dayOf(prev.at) !== dayOf(now);
  for (const ev of events) {
    counts.events++; const game = isGameEvent(ev.event_ticker), rows = [];
    for (const m of ev.markets || []) {
      counts.markets++; if (game) counts.game++;
      const { p, how } = priceOf(m), was = prev?.m?.[m.ticker], vol24 = Math.round(Number(m.volume_24h_fp || 0)), name = m.yes_sub_title || m.subtitle || m.title;
      if (p == null) continue; counts.priced++;
      const s = { p, base: was?.base ?? p, baseAt: was?.baseAt ?? now, d: was?.d ? [...was.d] : [], n: name, e: ev.event_ticker };
      if (newDay && was && !game) s.d = [...s.d, was.p].slice(-15);           // yesterday's last look is the day's close
      const live = how === "mid" || vol24 > 0;
      // logged: every futures move of 2 or more; for games only the winner market (KXNBAGAME), 5 or more, so the log stays small (11,000 of the 17,800 open markets are tied to one game)
      if (was && Math.abs(p - was.p) >= (game ? 5 : 2) && live && (!game || ev.series_ticker === "KXNBAGAME")) moves.push([now, m.ticker, was.p, p, vol24, ...(game ? [m.expected_expiration_time || ""] : [])]);
      if (was && !game && live) {
        const thr = threshold(s.d), up = p - s.base;
        const kind = Math.abs(up) >= thr ? "move" : s.base <= 10 && p >= Math.max(2 * s.base, s.base + 3) ? "surge" : null;
        if (kind) { alerts.push({ at: now, kind, series: ev.series_ticker, event: ev.event_ticker, title: ev.title, ticker: m.ticker, name, from: s.base, to: p, since: s.baseAt, usual: typical(s.d), vol24 }); s.base = p; s.baseAt = now; }
      }
      state.m[m.ticker] = s; rows.push({ t: m.ticker, name, p, live });
    }
    // a new favorite, where only one outcome can win
    if (!game && ev.mutually_exclusive && rows.length > 1) {
      const top = rows.filter((r) => r.live).sort((x, y) => y.p - x.p)[0], was = prev?.e?.[ev.event_ticker];
      if (top) { state.e[ev.event_ticker] = { leader: top.t, name: top.name, p: top.p };
        const old = was && rows.find((r) => r.t === was.leader);
        if (was && was.leader !== top.t && old && top.p >= old.p + 2 && !opts.noLeader) alerts.push({ at: now, kind: "leader", series: ev.series_ticker, event: ev.event_ticker, title: ev.title, ticker: top.t, name: top.name, to: top.p, past: was.name, pastTo: old.p });
        else if (was && was.leader !== top.t) state.e[ev.event_ticker] = was; }             // within 2 points: the old favorite stays the favorite
      else if (was) state.e[ev.event_ticker] = was;
    }
  }
  return { state, alerts: first ? [] : alerts, moves: first ? [] : moves, counts };
}
/** One alert as a Discord line. */
export function line(a) {
  const url = `https://kalshi.com/markets/${String(a.series).toLowerCase()}/event/${String(a.event).toLowerCase()}`, what = a.title || a.event;
  if (a.kind === "leader") return `**${what}**: new favorite **${a.name}** ${a.to}% (was ${a.past}, now ${a.pastTo}%) <${url}>`;
  const days = Math.max(0, Math.round((Date.parse(a.at) - Date.parse(a.since)) / 864e5)), span = days >= 1 ? `${days}d ago` : "earlier today";
  return `**${what}**: ${a.name} ${a.to > a.from ? "▲" : "▼"} **${a.to}%** (was ${a.from}% ${span}${a.kind === "surge" ? "; from the pack" : ""}; ${a.vol24.toLocaleString("en-US")} contracts in 24h) <${url}>`;
}
