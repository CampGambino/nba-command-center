/**
 * Posts to the user's Discord channel through a webhook (run by scripts/ci.js after each build).
 *
 *   DISCORD_WEBHOOK=<url> node scripts/notify.js [--today YYYY-MM-DD] [--force] [--dry]
 *
 * The webhook URL comes ONLY from the environment (a GitHub Actions secret). It is
 * never written to a file or printed: anyone with it can post to the channel.
 *
 * What it sends:
 *   - once ever: a "connected" test message;
 *   - once per date: tonight's storylines (src/anticipate/tonight.js), on the
 *     first build at or after 2 PM Eastern (game notes are usually posted by then).
 *     --force sends it now; --dry prints it instead of sending.
 * What was sent is recorded in history/discord.json (dates and times only), so a
 * later build doesn't send it again.
 *
 * Never fails the build: any problem is logged and the exit code is 0.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tonightStorylines, discordDigest } from "../src/anticipate/tonight.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const today = opt("--today") || new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const hourET = Number(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }));
const dry = args.includes("--dry"), force = args.includes("--force");
const url = process.env.DISCORD_WEBHOOK || "";
const markFile = path.join(root, "history", "discord.json");
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, "docs", "data", f), "utf8"));

async function post(payload) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${url}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) return true;
    if (res.status === 429) { // rate limited: wait as told, then retry
      const body = await res.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, Math.ceil((body.retry_after || 1) * 1000) + 250));
      continue;
    }
    console.error(`discord: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return false;
  }
  return false;
}

async function main() {
  if (!url && !dry) { console.log("discord: no DISCORD_WEBHOOK secret set; nothing sent"); return; }
  if (url && !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url)) { console.error("discord: DISCORD_WEBHOOK doesn't look like a Discord webhook URL; nothing sent"); return; }
  const mark = fs.existsSync(markFile) ? JSON.parse(fs.readFileSync(markFile, "utf8")) : { hello: null, digests: {} };

  if (!mark.hello && !dry) {
    if (await post({ username: "NBA Command Center", content: "✅ Connected: the NBA Command Center will post tonight's storylines here each game day (first build after 2 PM ET).", allowed_mentions: { parse: [] } })) {
      mark.hello = new Date().toISOString();
      console.log("discord: sent the connected message");
    } else return;
  }

  const watch = read("watch.json");
  const due = force || dry || hourET >= 14;
  if (mark.digests[today] && !force && !dry) { console.log(`discord: tonight's storylines for ${today} already sent`); }
  else if (!due) console.log(`discord: storylines for ${today} wait for the first build after 2 PM ET`);
  else if (watch.today !== today || !(watch.games || []).length) console.log(`discord: no games in the site data for ${today}; nothing sent`);
  else {
    let injuries = null;
    try { injuries = read("injuries.json"); } catch { /* no injury data yet */ }
    let facts = null;
    try { facts = read("notes-facts.json"); } catch { /* no history lines yet */ }
    let matchups = null;
    try { matchups = read("matchups.json"); } catch { /* no matchups yet */ }
    const stories = tonightStorylines({ watch, trends: read("trends.json"), leaders: read("leaders.json"), injuries, facts, matchups, national: (() => { try { return read("national.json"); } catch { return null; } })(), rest: (() => { try { return read("rest.json"); } catch { return null; } })(), form: (() => { try { return read("form.json"); } catch { return null; } })() });
    const date = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    const payloads = discordDigest(stories, { date });
    const lines = stories.reduce((a, g) => a + g.lines.length, 0);
    if (dry) { console.log(JSON.stringify(payloads, null, 1)); return; }
    let ok = true;
    for (const p of payloads) { ok = (await post(p)) && ok; await new Promise((r) => setTimeout(r, 600)); }
    if (ok) { mark.digests[today] = new Date().toISOString(); console.log(`discord: sent tonight's storylines for ${today} (${stories.length} games, ${lines} lines)`); }
  }
  // Keep the last 60 dates only.
  mark.digests = Object.fromEntries(Object.entries(mark.digests).sort().slice(-60));
  fs.writeFileSync(markFile, JSON.stringify(mark, null, 1) + "\n");
}

main().catch((e) => console.error(`discord: ${e.message}`));
