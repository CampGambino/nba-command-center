/**
 * The NBA's official injury report (the PDF the league posts every 15 minutes on game days).
 *
 *   https://ak-static.cms.nba.com/referee/injury/Injury-Report_YYYY-MM-DD_HH_MM{AM|PM}.pdf   (Eastern time)
 *
 * The same source the user's IR Checker extension reads. This module is pure: it builds slot
 * URLs and turns the PDF's positioned text into rows. Fetching and PDF reading are done by
 * scripts/situations.js.
 *
 * Layout (checked on the 11/11/26 8:30 PM report, 8 pages): one table with columns Game Date,
 * Game Time, Matchup, Team, Player Name ("Last, First"), Current Status, Reason. Date, time,
 * matchup and team appear only on the first row they apply to (carried down, across pages).
 * A reason that wraps is split ABOVE and BELOW its player's row, so reason fragments go to the
 * nearest player row. Page 1 has the header; later pages use page 1's column positions.
 */
import { teamFromText } from "../teams.js";

export const BASE = "https://ak-static.cms.nba.com/referee/injury";
export const STATUSES = ["Out", "Doubtful", "Questionable", "Probable", "Available"];

/** A report's game date ("11/02/2026", "11/2/26") as YYYY-MM-DD; null if it isn't one. */
export function isoDate(mdY) {
  const m = String(mdY || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** Report URL for an Eastern date and time (minutes rounded down to the 15-minute slot). */
export function slotUrl(dateYmd, hour24, minute) {
  const m = Math.floor(minute / 15) * 15;
  const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const p = (n) => String(n).padStart(2, "0");
  return `${BASE}/Injury-Report_${dateYmd}_${p(h12)}_${p(m)}${hour24 < 12 ? "AM" : "PM"}.pdf`;
}

/** Slot URLs for an Eastern date, newest first, from the given Eastern time back to midnight. */
export function slotsBackFrom(dateYmd, hour24, minute) {
  const out = [];
  for (let t = hour24 * 60 + Math.floor(minute / 15) * 15; t >= 0; t -= 15) out.push(slotUrl(dateYmd, Math.floor(t / 60), t % 60));
  return out;
}

/** "Haliburton, Tyrese" -> "Tyrese Haliburton"; "McCullar Jr., Kevin" and "Udeh, Jr., Ernest" -> "... Jr.". */
export function displayName(raw) {
  const s = joinBreaks(raw);
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return s;
  const first = parts[parts.length - 1], last = parts[0], middle = parts.slice(1, -1); // middle: a suffix ("Jr.")
  return [first, last, ...middle].join(" ").replace(/\s+/g, " ").trim();
}

/** Undo line-break splits: "Jackson- Davis" -> "Jackson-Davis", "Two- Way" -> "Two-Way" (a spaced " - " stays). */
const joinBreaks = (t) => String(t || "").replace(/(\S)-\s+/g, "$1-").replace(/\s+/g, " ").trim();

/** For matching names across sources: accents, punctuation, suffixes and hyphens removed. */
export function nameKey(name) {
  return String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[.'’]/g, "").replace(/-/g, " ").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ").replace(/\s+/g, " ").trim();
}

const DEFAULT_COLS = { date: 23, time: 120, matchup: 200, team: 264, player: 425, status: 586, reason: 666 };

/** Column start positions from the header row ("Game Date | Game Time | Matchup | Team | Player Name | Current Status | Reason"). */
function columns(items) {
  const at = (word, after = -1) => items.find((it) => it.str.trim() === word && it.x > after);
  const g1 = at("Game"), g2 = g1 && at("Game", g1.x + 5), mu = at("Matchup"), tm = at("Team"), pl = at("Player"), cs = at("Current"), rs = at("Reason");
  if (!(g1 && g2 && mu && tm && pl && cs && rs)) return null;
  return { date: g1.x, time: g2.x, matchup: mu.x, team: tm.x, player: pl.x, status: cs.x, reason: rs.x };
}

/**
 * pages: [[{ x, y, str }]] (PDF text items; y grows upward, as pdf.js gives it).
 * -> { asOf: "11/11/26 08:30 PM" | null, rows: [{ date, time, matchup, team, teamName, player, name, status, reason }] }
 *    A team whose report isn't in yet gets one row with status "Not yet submitted".
 */
export function parseReport(pages) {
  let cols = null, asOf = null;
  const carry = { date: null, time: null, matchup: null, teamName: null };
  const rows = [];
  for (const items0 of pages) {
    const items = items0.filter((it) => it.str && it.str.trim());
    cols = cols || columns(items) || null;
    const C = cols || DEFAULT_COLS;
    const edges = [["date", C.date], ["time", C.time], ["matchup", C.matchup], ["team", C.team], ["player", C.player], ["status", C.status], ["reason", C.reason]];
    const colOf = (x) => { let c = "date"; for (const [name, x0] of edges) if (x >= x0 - 6) c = name; return c; };
    if (!asOf) {
      const head = items.filter((it) => Math.abs(it.y - Math.max(...items.map((i) => i.y))) < 2).map((it) => it.str).join(" ");
      const m = head.match(/Report:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2})\s*(AM|PM)/i);
      if (m) asOf = `${m[1]} ${m[2]} ${m[3].toUpperCase()}`;
    }
    // Lines by y; skip the title, header and page-number lines.
    const byY = new Map();
    for (const it of items) { const y = Math.round(it.y); (byY.get(y) || byY.set(y, []).get(y)).push(it); }
    const lines = [...byY.entries()].sort((a, b) => b[0] - a[0]).map(([y, its]) => {
      const cells = {};
      for (const it of its.sort((a, b) => a.x - b.x)) { const c = colOf(it.x); cells[c] = cells[c] ? `${cells[c]} ${it.str.trim()}` : it.str.trim(); }
      return { y, cells, text: its.map((i) => i.str).join(" ") };
    }).filter((l) => !/^\s*(Injury Report:|Page \d+ of \d+)/.test(l.text) && !/Game Date\s+Game Time/.test(l.text) && !(l.cells.date === "Game Date"));
    const pageRows = [];
    const reasonBits = [];
    for (const l of lines) {
      const c = l.cells;
      const status = STATUSES.find((s) => (c.status || "").trim() === s);
      const notIn = /NOT YET SUBMITTED/i.test(c.player || "") || /NOT YET SUBMITTED/i.test(l.text);
      if (c.date && /\d{1,2}\/\d{1,2}\/\d{4}/.test(c.date)) carry.date = c.date.match(/\d{1,2}\/\d{1,2}\/\d{4}/)[0];
      if (c.time && /\d{1,2}:\d{2}/.test(c.time)) carry.time = c.time.replace(/\s+/g, " ").trim();
      if (c.matchup && /@/.test(c.matchup)) carry.matchup = c.matchup.replace(/\s+/g, "");
      if (c.team && (status || notIn)) carry.teamName = c.team.replace(/\s+/g, " ").trim();
      if (status || notIn) {
        const r = { y: l.y, date: carry.date, time: carry.time, matchup: carry.matchup, teamName: carry.teamName, team: teamFromText(carry.teamName),
          player: notIn ? null : joinBreaks(c.player), status: notIn ? "Not yet submitted" : status, bits: [] };
        if (c.reason) r.bits.push({ y: l.y, t: c.reason });
        pageRows.push(r);
      } else if (c.reason) reasonBits.push({ y: l.y, t: c.reason });
      else if (c.team && !c.player) carry.teamName = c.team.replace(/\s+/g, " ").trim(); // a team name on its own line
    }
    for (const b of reasonBits) {
      let best = null;
      for (const r of pageRows) if (!best || Math.abs(r.y - b.y) < Math.abs(best.y - b.y)) best = r;
      if (best && Math.abs(best.y - b.y) <= 16) best.bits.push(b);
    }
    for (const r of pageRows) {
      const reason = joinBreaks(r.bits.sort((a, b) => b.y - a.y).map((b) => b.t).join(" "));
      rows.push({ date: r.date, time: r.time, matchup: r.matchup, team: r.team, teamName: r.teamName, player: r.player, name: r.player ? displayName(r.player) : null, status: r.status, reason });
    }
  }
  return { asOf, rows };
}

/** Readable reason: "Injury/Illness - Left Hamstring Strain" -> "left hamstring strain"; G League lines kept short. */
export function shortReason(reason) {
  const r = String(reason || "").trim();
  if (/^G League/i.test(r)) return r.replace(/^G League\s*-\s*/i, "G League: ").toLowerCase();
  return r.replace(/^Injury\/Illness\s*-\s*/i, "").replace(/\s*;\s*/g, "; ").toLowerCase();
}

/**
 * The newest posted report with players on it, read back from the slot at (hour, minute) ET (0.141.5). One function
 * for the three places that need tonight's report (the cards' build, the record chances, the injuries step), so each
 * reads the newest one itself instead of the copy the previous build saved (which, between the 5:30 PM and 12:15 AM
 * builds, was hours old). A slot never posted, unreadable or empty is passed over and counted.
 * Returns { url, asOf, rows, behind: { slots, missing, empty, minutes }, slotsTried } or null with slotsTried.
 */
export async function latestReport(dateYmd, hour24, minute, { fetchFn = globalThis.fetch, pdfjs = null, maxSlots = 64, timeoutMs = 20000 } = {}) {
  const lib = pdfjs || (await import("pdfjs-dist/legacy/build/pdf.mjs"));
  const slots = slotsBackFrom(dateYmd, hour24, minute).slice(0, maxSlots);
  let missing = 0, empty = 0;
  for (const url of slots) {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
    if (!res || !res.ok) { missing++; continue; }
    let parsed = null;
    try {
      const doc = await lib.getDocument({ data: new Uint8Array(await res.arrayBuffer()), verbosity: 0 }).promise;
      const pages = [];
      for (let p = 1; p <= doc.numPages; p++) pages.push((await (await doc.getPage(p)).getTextContent()).items.map((it) => ({ x: it.transform[4], y: it.transform[5], str: it.str })));
      parsed = parseReport(pages);
    } catch { parsed = null; }
    if (!parsed || !parsed.rows.length) { empty++; continue; }
    return { url, ...parsed, behind: { slots: missing + empty, missing, empty, minutes: (missing + empty) * 15 }, slotsTried: slots.length };
  }
  return { url: null, rows: [], asOf: null, behind: null, slotsTried: slots.length, none: true };
}

/** The ET clock for a build of `today`: now if today is today in New York, else the day's last slot. */
export function reportClock(today, now = new Date()) {
  const etToday = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  if (today !== etToday) return { h: 23, m: 45, live: false };
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return { h: et.getHours(), m: et.getMinutes(), live: true };
}

/** Tonight's rows in the shape docs/data/injuries.json keeps (the report writes "11/02/2026": compared as dates). */
export const tonightRowsOf = (report, today) => (report?.rows || []).filter((r) => isoDate(r.date) === today)
  .map(({ team, name, status, reason, matchup, time }) => ({ team, name, status, reason, matchup, time }));

