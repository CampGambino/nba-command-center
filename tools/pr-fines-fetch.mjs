/**
 * The NBA's fine and suspension releases from pr.nba.com (the user, 11/23: "scan all the articles from these pages to
 * have a database of fines and career totals for each player", https://pr.nba.com/tag/nba-fines/). Read once by the
 * "pr fines (read only)" workflow; the raw releases go to a workflow download, and tools/pr-fines-parse.mjs turns them
 * into src/data/nba-fines.json. pr.nba.com is WordPress: its public posts API gives a tag's posts with their text.
 * Polite: one request at a time, a pause between them; robots.txt is read first and the run stops if it disallows /wp-json/.
 *
 *   node tools/pr-fines-fetch.mjs out.json
 */
import fs from "node:fs";
const BASE = "https://pr.nba.com";
const UA = "nba-command-center (personal, read once; github.com/CampGambino/nba-command-center)";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json,text/html" } });
    if (r.ok) return { r, body: await r.text() };
    console.log(`  ${r.status} ${url}`);
    if (r.status === 400 || r.status === 404) return { r, body: null };
    await pause(3000 * (i + 1));
  }
  return { r: null, body: null };
}
const robots = (await get(`${BASE}/robots.txt`)).body || "";
console.log("robots.txt:\n" + robots);
const dis = [...robots.matchAll(/^disallow:\s*(\S+)/gim)].map((m) => m[1]);
if (dis.some((d) => "/wp-json/wp/v2/posts".startsWith(d) && d !== "/")) { console.log("robots.txt disallows the posts API; stopping"); process.exit(1); }

const posts = new Map();
async function sweep(label, query) {
  for (let page = 1; page < 60; page++) {
    const url = `${BASE}/wp-json/wp/v2/posts?${query}&per_page=100&page=${page}&_fields=id,date,link,slug,title,content,tags`;
    const { r, body } = await get(url);
    if (!body) break;
    const L = JSON.parse(body);
    let fresh = 0;
    for (const p of L) if (!posts.has(p.id)) { fresh++; posts.set(p.id, { id: p.id, date: p.date, link: p.link, slug: p.slug, title: p.title?.rendered, html: p.content?.rendered, tags: p.tags, via: label }); }
    console.log(`${label} page ${page}: ${L.length} posts (${fresh} new); total pages ${r.headers.get("x-wp-totalpages")}`);
    if (L.length < 100) break;
    await pause(1500);
  }
}
const tag = JSON.parse((await get(`${BASE}/wp-json/wp/v2/tags?slug=nba-fines`)).body || "[]")[0];
console.log("tag", tag && { id: tag.id, count: tag.count });
if (tag) await sweep("tag", `tags=${tag.id}`);
for (const w of ["fined", "suspended"]) { await pause(1500); await sweep(`search:${w}`, `search=${w}`); }
const out = [...posts.values()].sort((a, b) => a.date.localeCompare(b.date));
fs.writeFileSync(process.argv[2] || "pr-fines.json", JSON.stringify({ fetched: new Date().toISOString(), tag: tag && { id: tag.id, count: tag.count }, posts: out }));
console.log(`${out.length} posts, ${out[0]?.date} to ${out[out.length - 1]?.date}`);
