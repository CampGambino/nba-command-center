/**
 * Checks for the articles watcher (cloudflare/articles-worker.js), with stand-in feeds, KV and
 * Discord. They need no saved samples, so the deploy workflow runs them on GitHub before every
 * deploy (tests/articles-only.js); tests/run.js runs them as part of the full suite.
 */
import fs from "node:fs";
import articlesWorker, { check as articlesCheck, decide as articleDecide, parseRss, parseEspn, adminKey } from "../cloudflare/articles-worker.js";

export async function articlesChecks(ok) {
  const T0 = Date.parse("2026-11-12T11:00:00Z"); // 6:00 AM ET
  const iso = (min) => new Date(T0 + min * 60e3).toISOString();
  const espnArt = (id, type, headline, byline, path, min) => ({ id, type, headline, byline, published: iso(min), links: { web: { href: `https://www.espn.com${path}/_/id/${id}/x` } }, description: "d" });
  let espn = [
    espnArt(1, "Story", "Old feature from yesterday", "Writer A", "/nba/story", -600),
    espnArt(2, "HeadlineNews", "Sources: Star out a month", "Shams Charania", "/nba/story", -5),
    espnArt(3, "Recap", "Player scores 30 as Team wins", "", "/nba/recap", -4),
  ];
  const rssItem = (title, link, by, min) => `<item><title><![CDATA[${title}]]></title><link>${link}</link><dc:creator><![CDATA[${by}]]></dc:creator><pubDate>${new Date(T0 + min * 60e3).toUTCString()}</pubDate><description>&lt;p&gt;Deep dive &amp;amp; more&lt;/p&gt;</description></item>`;
  let athletic = [rssItem("Inside the Celtics' rebuild", "https://www.nytimes.com/athletic/111/2026/11/12/celtics/", "Jay King", -3)];
  // The same story listed twice in the feed (it happens when a story is updated) must post once.
  athletic.push(rssItem("Inside the Celtics' rebuild", "https://www.nytimes.com/athletic/111/2026/11/12/celtics/?smid=rss", "Jay King", -3));
  athletic.push(rssItem("Best bets: Celtics at Knicks", "https://www.nytimes.com/athletic/112/2026/11/12/bets/", "", -2));
  let nyt = [];
  let failAthletic = false, discordDown = false;
  const posts = [];
  let puts = 0;
  const kv = new Map();
  const env = { DISCORD_WEBHOOK: "https://discord.com/api/webhooks/1/test-x", STATE: {
    get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null),
    put: async (k, v) => { puts++; kv.set(k, v); },
  } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o = {}) => {
    u = String(u);
    if (u.includes("site.api.espn.com")) return new Response(JSON.stringify({ articles: espn }), { status: 200 });
    if (u.includes("athletic/rss")) return failAthletic ? new Response("nope", { status: 503 }) : new Response(`<rss><channel>${athletic.join("")}</channel></rss>`, { status: 200 });
    if (u.includes("rss.nytimes.com")) return new Response(`<rss><channel>${nyt.join("")}</channel></rss>`, { status: 200 });
    if (u.includes("discord.com")) { if (discordDown) return new Response("{}", { status: 500 }); posts.push(JSON.parse(o.body)); return new Response("{}", { status: 200 }); }
    return new Response("?", { status: 404 });
  };
  const titles = () => posts.flatMap((p) => (p.embeds || []).map((e) => e.title));
  try {
    // 1. First run: posts only what came out in the last 20 minutes; the rest is marked seen.
    let r = await articlesCheck(env, T0);
    ok(titles().join("|") === "Sources: Star out a month|Inside the Celtics' rebuild|Best bets: Celtics at Knicks", "articles: first run posts only fresh, wanted articles (not yesterday's, not the recap); every Athletic story posts (even betting titles); a story listed twice posts once", titles().join("|"));
    const e = posts[0].embeds[0];
    ok(/^🚨 Reporting · ESPN · Shams Charania/.test(e.author.name) && /Published 5:55 AM ET .* seen 5 min later/.test(e.footer.text) && e.url.includes("espn.com") && posts.every((p) => p.allowed_mentions.parse.length === 0), "articles: post says who, when published (ET) and how long until it was seen", JSON.stringify(e));
    const ath = posts[1].embeds[0];
    ok(/The Athletic · Jay King/.test(ath.author.name) && /^Deep dive & more/.test(ath.description), "articles: RSS fields decoded (CDATA, entities, HTML stripped)", JSON.stringify(ath));
    const st = { log: JSON.parse(kv.get("log")) };
    ok(st.log.find((x) => x.title.startsWith("Player scores")).reason === "game recap" && st.log.find((x) => x.title.startsWith("Old feature")).reason === "published over 6h ago", "articles: skipped items are logged with the reason", JSON.stringify(st.log.map((x) => x.reason)));
    // 2. Nothing new: nothing posted, and no KV write (the heartbeat is every 30 min).
    posts.length = 0; puts = 0;
    await articlesCheck(env, T0 + 2 * 60e3);
    ok(posts.length === 0 && puts === 0, "articles: a run with nothing new posts nothing and writes nothing", `${posts.length} posts, ${puts} writes`);
    // 3. A day of quiet runs stays within the free KV budget (1,000 writes a day).
    puts = 0;
    for (let i = 2; i < 722; i++) await articlesCheck(env, T0 + i * 2 * 60e3);
    ok(puts <= 50, "articles: 720 quiet runs (a day) write at most ~48 times (the heartbeat)", String(puts));
    // 4. New article; Discord down: not marked seen, so the next run posts it.
    const T1 = T0 + 1500 * 60e3;
    espn = [...espn, espnArt(4, "Story", "Why the Heat are stuck", "Ramona Shelburne", "/nba/story", 1499)];
    posts.length = 0; discordDown = true;
    await articlesCheck(env, T1);
    discordDown = false;
    await articlesCheck(env, T1 + 2 * 60e3);
    ok(titles().join("|") === "Why the Heat are stuck", "articles: a post Discord rejects is retried on the next run, once", titles().join("|"));
    // 5. A feed error is recorded once, and doesn't stop the other feeds.
    failAthletic = true; puts = 0;
    espn = [...espn, espnArt(5, "Story", "Trade deadline primer", "Bobby Marks", "/nba/story", 1503)];
    posts.length = 0;
    await articlesCheck(env, T1 + 4 * 60e3);
    const w1 = puts;
    await articlesCheck(env, T1 + 6 * 60e3);
    ok(titles().join("|") === "Trade deadline primer" && JSON.parse(kv.get("state")).errors.athletic.msg === "HTTP 503" && puts === w1, "articles: a failing feed is logged once and the others still post", `${titles()} ${puts} ${w1}`);
    failAthletic = false;
    // 6. Review page: hidden without the key; muting a writer works on the next article.
    const key = await adminKey(env);
    const res404 = await articlesWorker.fetch(new Request("https://w.example/review"), env);
    const resOk = await articlesWorker.fetch(new Request(`https://w.example/review?k=${key}`), env);
    const body = await resOk.text();
    ok(res404.status === 404 && resOk.status === 200 && body.includes("Why the Heat are stuck") && body.includes("game recap"), "articles: review page needs the key; lists posted and skipped with reasons");
    await articlesWorker.fetch(new Request(`https://w.example/act?k=${key}&do=mute-writer&v=Bobby%20Marks`), env);
    espn = [...espn, espnArt(6, "Story", "Second Marks column", "Bobby Marks", "/nba/story", 1510)];
    posts.length = 0;
    await articlesCheck(env, T1 + 12 * 60e3);
    ok(posts.length === 0 && JSON.parse(kv.get("log"))[0].reason === "muted writer", "articles: a muted writer is skipped from then on");
    // 7. "Post it" from the review page sends a skipped one and records the miss.
    await articlesWorker.fetch(new Request(`https://w.example/act?k=${key}&do=post&key=${encodeURIComponent(JSON.parse(kv.get("log"))[0].key)}`), env);
    ok(titles().join("|") === "Second Marks column" && JSON.parse(kv.get("labels"))[0].v === "should have posted", "articles: posting a skipped item from the review page works and is labeled", titles().join("|"));
    // 8. /setup puts the private link in Discord, not in the browser.
    posts.length = 0;
    const setup = await (await articlesWorker.fetch(new Request("https://w.example/setup"), env)).text();
    ok(!setup.includes(key) && posts[0].content.includes(`https://w.example/review?k=${key}`), "articles: /setup sends the private review link to Discord only");
    // 8b. The 11/11 bug: /setup opened before the first check made the first check post older articles.
    {
      const kv2 = new Map(); let puts2 = 0;
      const env2 = { DISCORD_WEBHOOK: "https://discord.com/api/webhooks/2/test-y", STATE: { get: async (k, t) => (kv2.has(k) ? JSON.parse(kv2.get(k)) : null), put: async (k, v) => { puts2++; kv2.set(k, v); } } };
      espn = [espnArt(21, "Story", "Two-hour-old feature", "Writer B", "/nba/story", -120), espnArt(22, "Story", "Brand new feature", "Writer C", "/nba/story", -1)];
      posts.length = 0;
      await articlesWorker.fetch(new Request("https://w2.example/setup"), env2);
      posts.length = 0;
      await articlesCheck(env2, T0);
      ok(titles().join("|").includes("Brand new feature") && !titles().join("|").includes("Two-hour-old"), "articles: opening /setup before the first check doesn't let older articles through (11/11 bug)", titles().join("|"));
    }
    // 8c. Writers in other RSS layouts.
    const by = (x) => parseRss(`<item><title>T</title><link>https://x.com/a</link>${x}</item>`, "athletic")[0].byline;
    ok(by("<author>news@x.com (Sam Amick)</author>") === "Sam Amick" && by("<author><name>Law Murray</name></author>") === "Law Murray" && by("<dc:creator>Jay King</dc:creator>") === "Jay King" && by("<author>news@x.com</author>") === "",
      "articles: writer read from dc:creator, author \"email (Name)\", author/name; a bare email is dropped", [by("<author>news@x.com (Sam Amick)</author>"), by("<author><name>Law Murray</name></author>")].join(","));
    // 9. Rules on their own.
    const now = T0;
    const mk = (o) => ({ src: "espn", type: "Story", title: "A story", byline: "W", url: "https://www.espn.com/nba/story/_/id/9/x", published: now, ...o });
    ok(!articleDecide(mk({ type: "Preview" }), {}, now).post && !articleDecide(mk({ byline: "" }), {}, now).post && !articleDecide(mk({ url: "https://www.espn.com/fantasy/basketball/story/_/id/9/x" }), {}, now).post &&
      !articleDecide(mk({ title: "Best bets for tonight" }), {}, now).post && articleDecide(mk({ url: "https://www.espn.com/espn/betting/story/_/id/9/x", byline: "W" }), { allowBylines: ["W"] }, now).post &&
      !articleDecide(mk({ title: "Nets live updates" }), {}, now).post && articleDecide(mk({ title: "Nets live updates", src: "athletic", byline: "" }), {}, now).post && !articleDecide(mk({ src: "athletic", title: "Celtics trade talk" }), { muteWords: ["trade talk"] }, now).post && !articleDecide(mk({ title: "Big trade talk" }), { muteWords: ["trade talk"] }, now).post,
      "articles: rules (previews, no writer, fantasy, betting words, allowed writer overrides section, ESPN live blogs; every Athletic story except muted phrases)");
    ok(parseRss(`<item><title>A &amp; B</title><link>https://x.com/a</link><pubDate>Thu, 12 Nov 2026 11:00:00 GMT</pubDate></item>`, "athletic")[0].title === "A & B" && parseEspn({ articles: [] }).length === 0, "articles: parsers handle plain fields and empty feeds");
  } finally {
    globalThis.fetch = realFetch;
  }
  // A deploy replaces the Worker's bindings and cron triggers with cloudflare/wrangler.toml:
  // losing STATE or the schedule there would silently stop the watcher.
  {
    const t = fs.readFileSync(new URL("../cloudflare/wrangler.toml", import.meta.url), "utf8");
    ok(/^name = "ncc-articles"$/m.test(t) && /^main = "articles-worker\.js"$/m.test(t) && /\[\[kv_namespaces\]\]\s*\nbinding = "STATE"\s*\nid = "[0-9a-f]{32}"/.test(t) && /^crons = \["\*\/5 \* \* \* \*"\]$/m.test(t) && /^workers_dev = true/m.test(t) && !/DISCORD|webhooks/i.test(t.replace(/#.*$/gm, "")),
      "articles: deploy settings keep the name, the STATE store, the 5-minute schedule and workers.dev, and hold no secret");
  }
}
