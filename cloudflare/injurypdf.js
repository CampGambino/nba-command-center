/**
 * The league's latest injury report, read by the Worker itself (0.68). The site's injuries.json is rebuilt a few
 * times a day, but the league posts a new report every 15 minutes: on 11/14 Michael Porter Jr. was listed Out
 * (personal reasons) at 7:15 PM, the 7:40 PM lineup post still warned that he "isn't on the injury report",
 * because the site's copy was the 6:00 PM report.
 *
 * Only when a lineup post would warn: find the newest report (15-minute slots back from now), inflate its
 * text streams, and look the player up by the report's "Last, First" form.
 */
const BASE = "https://ak-static.cms.nba.com/referee/injury";
const STATUSES = ["Out", "Doubtful", "Questionable", "Probable", "Available"];

const et = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) };
};
/** The report URLs for the last `n` 15-minute slots, newest first (Eastern time). */
export function slotUrls(nowMs, n = 8) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = et(nowMs - i * 15 * 60e3);
    const m = Math.floor(t.minute / 15) * 15, h12 = t.hour % 12 === 0 ? 12 : t.hour % 12, p = (x) => String(x).padStart(2, "0");
    const url = `${BASE}/Injury-Report_${t.ymd}_${p(h12)}_${p(m)}${t.hour < 12 ? "AM" : "PM"}.pdf`;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}
/** "…Injury-Report_2026-11-14_07_15PM.pdf" -> "7:15 PM". */
export const asOfLabel = (url) => { const m = String(url).match(/_(\d{2})_(\d{2})(AM|PM)\.pdf$/); return m ? `${+m[1]}:${m[2]} ${m[3]}` : null; };

async function inflate(bytes) {
  const ds = new DecompressionStream("deflate");
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}
const dec = new TextDecoder("latin1");
const unescape = (s) => s.replace(/\\([0-7]{1,3}|.)/g, (m, c) => (/^[0-7]+$/.test(c) ? String.fromCharCode(parseInt(c, 8)) : c === "n" ? "\n" : c));
const tjWords = (body) => [...body.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((t) => unescape(t[1]));

/** The PDF's content streams, inflated, as text (cheap: native inflate and decode; the Worker has little CPU time). */
export async function pdfBodies(buf) {
  const u8 = new Uint8Array(buf);
  const raw = dec.decode(u8);
  const out = [];
  let at = 0;
  for (;;) {
    let i = raw.indexOf("stream", at);
    if (i < 0) break;
    if (raw.slice(i - 3, i) === "end") { at = i + 6; continue; }
    // Only page content: fonts, images and metadata are skipped (the Worker has little CPU time).
    const dict = raw.slice(Math.max(0, raw.lastIndexOf("obj", i)), i);
    if (/\/Length[123]\b|\/Subtype\s*\/(?:Image|XML|Type1C|CIDFontType0C|OpenType)|\/Type\s*\/(?:Metadata|XObject|XRef|ObjStm)/.test(dict)) { at = i + 6; continue; }
    let start = i + 6;
    if (raw[start] === "\r") start++;
    if (raw[start] === "\n") start++;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    let e = end;
    while (e > start && (raw[e - 1] === "\n" || raw[e - 1] === "\r")) e--; // the line break before "endstream" isn't data
    try { out.push(dec.decode(await inflate(u8.subarray(start, e)))); } catch {}
    at = end + 9;
  }
  return out;
}
/** The report's text as one string of its words in order (for tests and small reports). */
export async function pdfText(buf) { return (await pdfBodies(buf)).map((b) => tjWords(b).join(" ")).join(" "); }

const plain = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const esc = (w) => w.replace(/[.'’]/g, "").replace(/[\\^$*+?()[\]{}|]/g, "\\$&").split("").join("[.'’]?");
/** "Michael Porter Jr." -> the report's "Porter Jr., Michael", as a pattern (periods and apostrophes optional). */
export function reportPattern(name) {
  const w = plain(name).trim().split(/\s+/);
  const last = w.slice(1);
  // A suffix may come after its own comma ("Udeh, Jr., Ernest").
  const sfx = /^(?:Jr|Sr|II|III|IV|V)\.?$/i.test(last[last.length - 1] || "") && last.length > 1;
  const body = sfx ? `${last.slice(0, -1).map(esc).join("\\s+")},?\\s+${esc(last[last.length - 1])}` : last.map(esc).join("\\s+");
  return `${body}[.]?,\\s+${esc(w[0])}`;
}
const TEAMS = "Atlanta Hawks|Boston Celtics|Brooklyn Nets|Charlotte Hornets|Chicago Bulls|Cleveland Cavaliers|Dallas Mavericks|Denver Nuggets|Detroit Pistons|Golden State Warriors|Houston Rockets|Indiana Pacers|LA Clippers|Los Angeles Clippers|Los Angeles Lakers|Memphis Grizzlies|Miami Heat|Milwaukee Bucks|Minnesota Timberwolves|New Orleans Pelicans|New York Knicks|Oklahoma City Thunder|Orlando Magic|Philadelphia 76ers|Phoenix Suns|Portland Trail Blazers|Sacramento Kings|San Antonio Spurs|Toronto Raptors|Utah Jazz|Washington Wizards";
const cleanReason = (r) => r.replace(new RegExp(`\\s+(?:${TEAMS})\\b.*$`), "").replace(/(\w)- (\w)/g, "$1-$2").trim();

/** A player's status on the report's text: { status, reason } or null. */
export function statusIn(text, name) {
  const re = new RegExp(`(?:^|\\s)${reportPattern(name)}\\s+(${STATUSES.join("|")})\\b\\s*(.*?)(?=\\s+[A-Z][\\w'’.-]*(?:\\s+(?:Jr|Sr|II|III|IV)\\.?)?,\\s|\\s+\\d{2}:\\d{2}|\\s+\\d{2}/\\d{2}/|\\s+Page\\s+\\d|$)`, "i");
  const m = plain(text).match(re);
  return m ? { status: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), reason: cleanReason(m[2].trim().split(/\s+/).slice(0, 12).join(" ")) } : null;
}

/** A player's status on a report read by latestReport: only the text near his last name is looked at. */
export function statusOnReport(report, name) {
  if (!report) return null;
  if (report.text) return statusIn(report.text, name);
  const first = plain(name).trim().split(/\s+/)[1];
  if (!first) return null;
  for (const b of report.bodies || []) {
    for (let i = b.indexOf(`(${first}`); i >= 0; i = b.indexOf(`(${first}`, i + 1)) {
      const st = statusIn(tjWords(b.slice(i, i + 3000)).join(" "), name);
      if (st) return st;
    }
  }
  return null;
}

/** The newest report with players on it in the last three hours: { url, asOf, bodies } or null. */
export async function latestReport(nowMs, fetchFn = fetch) {
  // 0.80 (the user, 11/16): a slot that was never posted, or a report with no player on it, is passed over for the one
  // before it; three hours back (was two).
  for (const url of slotUrls(nowMs, 12)) {
    try {
      const r = await fetchFn(url);
      if (!r.ok) continue;
      const bodies = await pdfBodies(await r.arrayBuffer());
      if (!/\b(?:Out|Questionable|Doubtful|Probable|Available)\b/.test(bodies.map((b) => tjWords(b).join(" ")).join(" "))) continue;
      return { url, asOf: asOfLabel(url), bodies };
    } catch {}
  }
  return null;
}
