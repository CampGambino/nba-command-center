#!/usr/bin/env node
/**
 * Tags every version in CHANGES.md at the commit where it finished (0.141.5), so "go back to 0.140.1" is
 * `git checkout v0.140.1` (or a revert to it) instead of a hunt through ~600 commits, two-thirds of them the bot's.
 *
 * Which commit: commits name their version in the message ("0.141.3: security fixes…", "CHANGES 0.141.1: …"). For
 * each version, the newest commit naming it that is older than the first commit of the next version; a later commit
 * that only mentions an old version ("self-audit of 0.106.0") doesn't move its tag. The bot's data commits are skipped.
 * Versions no commit names are left untagged and listed. Existing tags are never moved.
 *
 * Run by "test and publish" after each publish with --since=<main before>: only versions finished in what it just
 * published are tagged and pushed. GitHub refuses a tag made by the job's own key on an older commit whose workflow
 * files differ from today's (0.141.5: 203 of 220 refused), so older history isn't pushed as tags; --list prints
 * every version's commit, which is all a rollback needs (git revert / git diff against it).
 *   node tools/tag-versions.mjs --list        every version and its commit
 *   node tools/tag-versions.mjs --dry         what would be tagged
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 << 20 }).trim();
const dry = process.argv.includes("--dry");
const ref = process.argv.find((a) => a.startsWith("--ref="))?.slice(6) || "HEAD";
const since = process.argv.find((a) => a.startsWith("--since="))?.slice(8) || null;
const list = process.argv.includes("--list");

const changes = fs.readFileSync(new URL("../CHANGES.md", import.meta.url), "utf8");
const heads = [...changes.matchAll(/^## (\d+\.\d+(?:\.\d+)?)\b[^\n]*?:\s*([^\n]*)/gm)];
const versions = [], titles = {};
for (const [, v, t] of heads) if (!(v in titles)) { versions.push(v); titles[v] = t.trim(); }   // newest first

const BOT = /^(build|score|kalshi|flow):/;
const log = git("log", "--format=%H\t%s", ref).split("\n").map((l) => { const i = l.indexOf("\t"); return { h: l.slice(0, i), s: l.slice(i + 1) }; });
const esc = (v) => v.replace(/\./g, "\\.");
const matches = versions.map((v) => {
  const re = new RegExp(`(^|[^\\d.])v?${esc(v)}([:\\s),;]|$)`);
  return log.map((c, i) => (!BOT.test(c.s) && re.test(c.s) ? i : -1)).filter((i) => i >= 0);   // indexes, 0 = newest
});

const existing = new Set(git("tag", "--list", "v*").split("\n").filter(Boolean));
const fresh = since ? new Set(git("rev-list", `${since}..${ref}`).split("\n").filter(Boolean)) : null;   // commits just published
const plan = [], unnamed = [];
versions.forEach((v, k) => {
  const m = matches[k];
  if (!m.length) { unnamed.push(v); return; }
  let pick = Math.min(...m);
  if (k > 0 && matches[k - 1].length) {
    const nextBegan = Math.max(...matches[k - 1]);          // the oldest commit of the next-newer version
    const before = m.filter((i) => i > nextBegan);
    if (before.length) pick = Math.min(...before);
  }
  if (list) { console.log(`v${v}\t${log[pick].h.slice(0, 7)}\t${log[pick].s.slice(0, 90)}`); return; }
  if (fresh && !fresh.has(log[pick].h)) return;
  if (!existing.has(`v${v}`)) plan.push({ tag: `v${v}`, commit: log[pick].h, msg: `${v}: ${titles[v]}`.slice(0, 200) });
});

if (list) process.exit(0);
for (const p of plan) {
  if (dry) console.log(`would tag ${p.tag} at ${p.commit.slice(0, 7)}`);
  else git("tag", "-a", p.tag, p.commit, "-m", p.msg);
}
console.log(`${versions.length} versions in CHANGES.md; ${existing.size} already tagged; ${plan.length} ${dry ? "to tag" : "tagged now"}${unnamed.length ? `; no commit names ${unnamed.join(", ")}` : ""}`);
if (!dry && plan.length) console.log(`new tags: ${plan.map((p) => p.tag).join(" ")}`);
if (process.env.GITHUB_ENV && !dry) fs.appendFileSync(process.env.GITHUB_ENV, `NEW_TAGS=${plan.map((p) => p.tag).join(" ")}\n`);
