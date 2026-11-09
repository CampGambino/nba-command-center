import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { TEAMS } from "../teams.js";
import { parseNotes } from "./parse.js";

/**
 * Game notes watcher.
 *
 * Each team publishes its notes at one fixed URL and replaces the file in place
 * (nba.com/gamenotes/<team>.pdf). On the second night of a back-to-back the
 * file is often replaced only close to tip-off, so "the file at the URL" is not
 * necessarily tonight's notes. For every check this:
 *   1. downloads the file (with If-Modified-Since, so an unchanged file costs nothing)
 *   2. keeps every distinct version on disk, named by content hash
 *   3. reads the date and opponent printed in the notes and says whether this
 *      version is tonight's ("current"), an older game's ("stale"), dated
 *      tonight but naming a different opponent ("conflict"), or unclear
 *
 * Nothing is ever deleted; versions accumulate under data/notes/<TEAM>/.
 * versions.json lists every version ever seen; latest.json names the one the
 * site served most recently. Every failure returns a result, never throws.
 */

export const notesUrl = (tri) => `https://www.nba.com/gamenotes/${TEAMS[tri].slug}.pdf`;

const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "application/pdf,*/*",
  "accept-language": "en-US,en;q=0.9",
};

/** Write via a temp file and rename, so a crash mid-write never leaves half a file. */
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readJson(file, fallback, warnings) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    // Keep the damaged file for inspection and carry on with a fresh one.
    const keep = `${file}.damaged-${Date.now()}`;
    try { fs.renameSync(file, keep); } catch {}
    warnings.push(`${path.basename(file)} was unreadable (${e.message}); moved to ${path.basename(keep)} and started fresh`);
    return fallback;
  }
}

/**
 * @param {object} o
 * @param {string} o.team      tricode
 * @param {string} o.date      game date we want notes for (YYYY-MM-DD, local)
 * @param {string} [o.opponent] tonight's opponent tricode, if known
 * @param {string} o.dataDir   where versions are kept
 * @param {Function} [o.fetchImpl] injectable for tests
 * @returns {Promise<{team, status, isNew, version, meta, why?, error?, warnings}>}
 *   status: "current" | "stale" | "conflict" | "unknown-date" | "unreachable"
 */
export async function checkNotes({ team, date, opponent = null, dataDir, fetchImpl = fetch }) {
  const warnings = [];
  const dir = path.join(dataDir, "notes", team);
  fs.mkdirSync(dir, { recursive: true });
  const indexFile = path.join(dir, "versions.json");
  const latestFile = path.join(dir, "latest.json");
  const versions = readJson(indexFile, [], warnings);
  const latestHash = readJson(latestFile, null, warnings)?.hash;
  const latest = versions.find((v) => v.hash === latestHash) || versions[versions.length - 1] || null;
  const unreachable = (error) => ({ team, status: "unreachable", isNew: false, version: latest, meta: latest?.meta || null, error, warnings });

  let res, buf;
  try {
    const headers = { ...HEADERS };
    if (latest?.lastModified) headers["if-modified-since"] = latest.lastModified;
    res = await fetchImpl(notesUrl(team), { headers, redirect: "follow" });
    if (res.status === 304 && latest) {
      // Unchanged on the site. Re-read our stored copy only if its date was never found.
      if (latest.meta?.gameDate && !latest.meta?.error) return { ...judge(team, latest, false, date, opponent), warnings };
      buf = fs.readFileSync(path.join(dir, latest.file));
    } else {
      if (!res.ok) return unreachable(`HTTP ${res.status} from www.nba.com${res.status === 403 ? " (the site is refusing automated downloads)" : ""}`);
      buf = Buffer.from(await res.arrayBuffer());
    }
  } catch (e) {
    return unreachable(`network: ${e.message}`);
  }

  // A real PDF starts with "%PDF-" within its first kilobyte.
  if (buf.subarray(0, 1024).indexOf("%PDF-") < 0) return unreachable("the URL returned something that isn't a PDF (probably a block page)");
  // The end marker must be at the end: "%%EOF" also appears mid-file after each
  // incremental update, so a cut-off download can still contain an early one.
  if (buf.subarray(Math.max(0, buf.length - 1024)).indexOf("%%EOF") < 0) return unreachable("the PDF looks cut off (no end marker); download probably interrupted");

  const hash = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  let version = versions.find((v) => v.hash === hash);
  let isNew = false;
  // Re-read a stored version whose date couldn't be found: the date reader may have learned its format since.
  if (!version || version.meta?.error || !version.meta?.gameDate) {
    let meta;
    try {
      const m = (await parseNotes(buf, { team })).meta;
      meta = { gameDate: m.gameDate ?? null, opponent: m.opponent ?? null, pageCount: m.pageCount ?? null };
    } catch (e) {
      meta = { error: `couldn't read the PDF: ${e.message}` };
    }
    if (!version) {
      version = { hash, file: `${hash}.pdf`, fetchedAt: new Date().toISOString(), lastModified: res.headers.get?.("last-modified") || null, bytes: buf.length, meta };
      writeAtomic(path.join(dir, version.file), buf);
      versions.push(version);
      isNew = true;
    } else {
      version.meta = meta; // retry of a version that failed to parse before
    }
    writeAtomic(indexFile, JSON.stringify(versions, null, 2));
  }
  // The site may also roll back to a version seen before: latest.json follows it.
  writeAtomic(latestFile, JSON.stringify({ hash, seenAt: new Date().toISOString() }));
  return { ...judge(team, version, isNew, date, opponent), warnings };
}

/** Is this version tonight's notes? */
export function judge(team, version, isNew, date, opponent) {
  const m = version.meta || {};
  let status, why;
  if (m.error) { status = "unknown-date"; why = m.error; }
  else if (!m.gameDate) { status = "unknown-date"; why = "couldn't find the game date printed in the notes"; }
  else if (m.gameDate !== date) {
    status = "stale";
    why = `notes on the site are for ${m.gameDate}${m.opponent ? ` vs ${m.opponent}` : ""}, not ${date}${opponent ? ` vs ${opponent}` : ""}: not updated yet`;
  } else if (opponent && m.opponent && m.opponent !== opponent) {
    status = "conflict";
    why = `notes are dated ${date} but name ${m.opponent} as the opponent; the schedule says ${opponent}. Check the notes before using them`;
  } else {
    status = "current";
    why = `notes are for ${m.gameDate}${m.opponent ? ` vs ${m.opponent}` : ""}`;
  }
  return { team, status, isNew, version, meta: m, why };
}

/** Path to a stored version's PDF. */
export const versionPath = (dataDir, team, version) => path.join(dataDir, "notes", team, version.file);
