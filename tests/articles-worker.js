/**
 * Checks for the articles watcher (cloudflare/articles-worker.js), with stand-in feeds, KV and
 * Discord. They need no saved samples, so the deploy workflow runs them on GitHub before every
 * deploy (tests/articles-only.js); tests/run.js runs them as part of the full suite.
 */
import fs from "node:fs";
import { parseLineups, diff as lineupDiff, lastStarters, lineupEmbed, lineupCheck, feedTime, espnStarters, feedDue } from "../cloudflare/lineups.js";
import articlesWorker, { check as articlesCheck, decide as articleDecide, parseRss, parseEspn, adminKey, tagOf as articleTag } from "../cloudflare/articles-worker.js";

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
    ok(/^name = "ncc-articles"$/m.test(t) && /^main = "articles-worker\.js"$/m.test(t) && /\[\[kv_namespaces\]\]\s*\nbinding = "STATE"\s*\nid = "[0-9a-f]{32}"/.test(t) && /^crons = \["\*\/5 \* \* \* \*", "\* \* \* \* \*"\]$/m.test(t) && /^workers_dev = true/m.test(t) && !/DISCORD|webhooks/i.test(t.replace(/#.*$/gm, "")),
      "articles: deploy settings keep the name, the STATE store, the 5-minute (articles) and 1-minute (lineups) schedules and workers.dev, and hold no secret");
  }
  // Injury news posts even without a writer's name (user, 11/11); unsigned game stories still don't.
  {
    const now = Date.parse("2026-11-12T04:30:00Z");
    const u = (title, type = "HeadlineNews") => ({ src: "espn", type, title, byline: "", description: "", url: "https://www.espn.com/nba/story/_/id/1/x", published: now });
    const wilson = u("Bulls rookie Caleb Wilson leaves loss to Spurs with right hand injury");
    ok(articleDecide(wilson, {}, now).post && articleTag(wilson) === "🩹 Injury" && articleDecide(u("Raptors say Kawhi Leonard will miss at least 1 more week due to knee swelling", "Story"), {}, now).post,
      "articles: unsigned ESPN injury news is posted, tagged 🩹 Injury");
    ok(!articleDecide(u("Victor Wembanyama scores 40 points in 25 minutes as Spurs win 9th straight"), {}, now).post && !articleDecide(u("Paul George torches 76ers as Celtics take edge in renewed rivalry"), {}, now).post
      && !articleDecide({ ...wilson, type: "Recap" }, {}, now).post && !articleDecide({ ...wilson, type: "Media" }, {}, now).post,
      "articles: unsigned game stories, recaps and videos stay skipped even when they mention an injury");
  }
  // Lineups (cloudflare/lineups.js): confirmed fives to the private #lineups channel, once, with what changed.
  {
    const P = (name, pos, status = "Confirmed", roster = "Active") => ({ playerName: name, position: pos, lineupStatus: status, rosterStatus: roster, timestamp: "2026-11-12T23:30:00" });
    const feed = (st, swap = false) => ({ games: [{ gameId: "0022600300", gameStatus: 1, gameStatusText: "7:30 pm ET",
      homeTeam: { teamAbbreviation: "NYK", players: [P("Mikal Bridges", "SG", st), P("OG Anunoby", "SF", st), P("Jalen Brunson", "PG", st), P(swap ? "Mitchell Robinson" : "Josh Hart", "PF", st), P("Karl-Anthony Towns", "C", st), P(swap ? "Josh Hart" : "Mitchell Robinson", ""), P("Miles McBride", "", "Confirmed", "Inactive")] },
      awayTeam: { teamAbbreviation: "IND", players: [P("Aaron Nesmith", "SG", "Expected"), P("Kelly Oubre Jr.", "SF", "Expected"), P("Andrew Nembhard", "PG", "Expected"), P("Pascal Siakam", "PF", "Expected"), P("Ivica Zubac", "C", "Expected")] } }] });
    const g = parseLineups(feed("Confirmed"))[0];
    ok(g.teams[0].tri === "NYK" && g.teams[0].opp === "IND" && g.teams[0].status === "Confirmed" && g.teams[1].status === "Expected" && g.teams[0].starters.map((p) => p.pos).join() === "PG,SG,SF,PF,C" && g.teams[0].inactive.join() === "Miles McBride",
      "lineups: starters are the players with a position, PG to C; a five is Confirmed only when all five are; inactives listed", JSON.stringify(g.teams[0]));
    ok(feedTime("2026-11-11T22:49:00") === Date.parse("2026-11-11T22:49:00Z"), "lineups: feed times are UTC");
    ok(JSON.stringify(lineupDiff(["A B", "C D"], ["A B", "E F"])) === JSON.stringify({ in: ["E F"], out: ["C D"] }), "lineups: who's in and out");
    const file = { names: { 1: "Jalen Brunson", 2: "Mikal Bridges", 3: "OG Anunoby", 4: "Mitchell Robinson", 5: "Karl-Anthony Towns", 6: "Josh Hart" },
      games: [{ d: "2026-11-10", opp: "BOS", pl: { 1: [1], 2: [1], 3: [1], 4: [1], 5: [1], 6: [0] } }, { d: "2026-11-12", opp: "IND", pl: {} }] };
    const last = lastStarters(file, "2026-11-12");
    ok(last && last.d === "2026-11-10" && last.names.length === 5, "lineups: the last game's starters come from our box-score file (before today)", JSON.stringify(last));
    const e = lineupEmbed(g, g.teams[0], { last, expected: ["Jalen Brunson", "Mikal Bridges", "OG Anunoby", "Mitchell Robinson", "Karl-Anthony Towns"] });
    ok(/in \*\*Josh Hart\*\* · out Mitchell Robinson/.test(e.description) && /vs expected earlier today/.test(e.description) && /Inactive: Miles McBride/.test(e.description)  && e.title === "NYK vs IND · 7:30 pm ET" && e.description.startsWith("Jalen Brunson\nMikal Bridges\nOG Anunoby\nJosh Hart\nKarl-Anthony Towns\n"),
      "lineups: the post lists the five PG to C with no position labels (user, 11/12), and says what changed from the last game and the expected five", e.description);
    // A run: posts once per confirmed five; a later change posts again; dry runs post nothing.
    const kv = new Map(), posts = [];
    const env = { LINEUPS_WEBHOOK: "https://discord.com/api/webhooks/3/test-z", STATE: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => kv.set(k, v) } };
    const realFetch = globalThis.fetch;
    let current = feed("Confirmed");
    const A = (name, pos, starter = true) => ({ athlete: { displayName: name, position: { abbreviation: pos } }, starter });
    // At tip: NYK started Miles McBride (a late swap the NBA file never showed); IND started its expected five.
    const espn = { boxscore: { players: [
      { team: { abbreviation: "NY" }, statistics: [{ athletes: [A("Karl-Anthony Towns", "C"), A("Miles McBride", "G"), A("OG Anunoby", "F"), A("Josh Hart", "F"), A("Jalen Brunson", "G"), A("Mikal Bridges", "G", false)] }] },
      { team: { abbreviation: "IND" }, statistics: [{ athletes: [A("Aaron Nesmith", "G"), A("Kelly Oubre Jr.", "F"), A("Andrew Nembhard", "G"), A("Pascal Siakam", "F"), A("Ivica Zubac", "C")] }] } ] } };
    ok(espnStarters(espn).NYK.length === 5 && espnStarters(espn).NYK[4].name === "Karl-Anthony Towns" && espnStarters(espn).IND, "lineups: who started, from ESPN's box (NY → NYK), guards to center", JSON.stringify(espnStarters(espn)));
    let reads = 0;
    globalThis.fetch = async (u, o = {}) => {
      u = String(u);
      if (u.includes("daily_lineups_20261112")) { reads++; return new Response(JSON.stringify(current), { status: 200 }); }
      if (u.includes("raw.githubusercontent.com")) return new Response(JSON.stringify(file), { status: 200 });
      if (u.startsWith("https://discord.com/")) { posts.push(JSON.parse(o.body)); return new Response("{}", { status: 200 }); }
      if (u.includes("/scoreboard?dates=20261112")) return new Response(JSON.stringify({ events: [{ id: "401", date: "2026-11-13T00:30Z", competitions: [{ competitors: [{ team: { abbreviation: "NY" } }, { team: { abbreviation: "IND" } }] }] }] }), { status: 200 });
      if (u.includes("/summary?event=401")) return new Response(JSON.stringify(espn), { status: 200 });
      return new Response("", { status: 404 });
    };
    // Tip 7:30 PM ET (00:30 UTC). The user's timing (11/12): NBA.com every 5 minutes from 6:00 (90 out) to 6:55 (35 out);
    // every 20 seconds 6:59:00-7:00:40 (31 to 29 out); every 3 minutes from 7:01 (29 out) to 7:28; ESPN every minute from 7:30.
    const T = (hhmm, sec = 0) => Date.parse(`2026-11-12T${hhmm}:${String(sec).padStart(2, "0")}-05:00`);
    const tip = T("19:30");
    const dueAt = [];
    for (let t = T("17:55"); t < tip + 60e3; t += 20e3) if (feedDue(tip, t)) dueAt.push(new Date(t - 5 * 3600e3).toISOString().slice(11, 19));
    ok(dueAt.join() === "18:00:00,18:05:00,18:10:00,18:15:00,18:20:00,18:25:00,18:30:00,18:35:00,18:40:00,18:45:00,18:50:00,18:55:00,18:59:00,18:59:20,18:59:40,19:00:00,19:00:20,19:00:40,19:01:00,19:04:00,19:07:00,19:10:00,19:13:00,19:16:00,19:19:00,19:22:00,19:25:00,19:28:00",
      "lineups: NBA.com read every 5 min from 90 to 35 out, every 20 s from 31 to 29 out, every 3 min from 29 out to tip, never at or after tip", dueAt.join());
    const noSleep = { sleep: async () => {} };
    try {
      const pre = await lineupCheck(env, T("17:30"), noSleep);
      ok(reads === 0 && posts.length === 0 && pre.phases.NYK === null, "lineups: nothing read before 90 minutes to tip", JSON.stringify(pre));
      const dry = await lineupCheck(env, T("18:00"), { dry: true, ...noSleep });
      ok(posts.length === 0 && (dry.wouldPost || []).includes("NYK confirmed") && JSON.parse(kv.get("lineups")).teams.NYK.posted === null, "lineups: a dry run reports what it would post and posts nothing", JSON.stringify(dry));
      reads = 0;
      const r1 = await lineupCheck(env, T("18:00"), noSleep), r2 = await lineupCheck(env, T("18:03"), noSleep);
      ok(r1.posted === 1 && r2.posted === 0 && r2.read.length === 0 && posts.length === 1 && posts[0].username === "NBA Command Center · Lineups" && reads === 1,
        "lineups: from 90 minutes out, read on the 5-minute marks only; a confirmed five posted once", JSON.stringify({ reads, r2 }));
      reads = 0;
      const b1 = await lineupCheck(env, T("18:59"), noSleep), b2 = await lineupCheck(env, T("19:00"), noSleep), b3 = await lineupCheck(env, T("19:01"), noSleep), b4 = await lineupCheck(env, T("19:02"), noSleep);
      ok(reads === 7 && b1.read.length === 3 && b2.read.length === 3 && b3.read.length === 1 && b4.read.length === 0 && posts.length === 1,
        "lineups: three reads a run (:00, :20, :40) in the 31-29 minute window, then every 3 minutes; no repeat post", JSON.stringify([b1.read, b2.read, b3.read, b4.read]));
      current = feed("Confirmed", true);
      const r5 = await lineupCheck(env, T("19:04"), noSleep);
      ok(r5.posted === 1 && /LINEUP CHANGE/.test(posts[1].embeds[0].author.name) && /Changed after it was confirmed:\*\* in Mitchell Robinson · out Josh Hart/.test(posts[1].embeds[0].description), "lineups: a change after it was confirmed posts on the next 3-minute check", JSON.stringify(posts[1]?.embeds?.[0]));
      reads = 0;
      const r6 = await lineupCheck(env, T("19:30"), noSleep);
      const tipPosts = posts.slice(2).map((p) => p.embeds[0]);
      ok(r6.posted === 2 && reads === 0 && /STARTED DIFFERENTLY · ESPN box score/.test(tipPosts[0].author.name) && /Started differently than confirmed:\*\* in Miles McBride, Josh Hart · out Mikal Bridges, Mitchell Robinson/.test(tipPosts[0].description)
        && !/Inactive/.test(tipPosts[0].description) && tipPosts[0].description.startsWith("Jalen Brunson\nMiles McBride\nOG Anunoby\nJosh Hart\nKarl-Anthony Towns")
        && /Starters at tip \(none confirmed before\)/.test(tipPosts[1].author.name) && tipPosts[1].title.startsWith("IND @ NYK"),
        "lineups: at tip, ESPN's box (not NBA.com): a late swap vs the confirmed five posts 'started differently'; a team never confirmed gets its starters", JSON.stringify(tipPosts.map((e) => [e.author.name, e.title, e.description])));
      const r7 = await lineupCheck(env, T("19:31"), noSleep);
      // The night's timing: kept (times only) and summed up in one #lineups post when the day is done.
      const timing = JSON.parse(kv.get("lineups-timing:2026-11-12") || "null");
      const nyk = timing?.teams.find((x) => x.team === "NYK"), ind = timing?.teams.find((x) => x.team === "IND");
      ok(nyk && nyk.feedMin === 60 && nyk.seenMin === 90 && nyk.postedMin != null && nyk.changes.length === 1 && nyk.tipResult === "posted" && ind.postedMin === null && !JSON.stringify(timing).includes("Brunson"),
        "lineups: the night's timing per team (minutes before tip NBA.com stamped it, we saw it, we posted; changes; tip result), no names kept", JSON.stringify(timing));
      const sum = posts[posts.length - 1].embeds[0];
      ok(posts.length === 5 && sum.author.name === "Lineup timing · tonight" && /^2026-11-12: median confirmation/.test(sum.title) && /\*\*IND\*\* \(7:30 PM\): not confirmed before tip/.test(sum.description),
        "lineups: one timing summary posted when the night is done", JSON.stringify(sum));
      ok(r7.skipped === "all of today's games have tipped" && posts.length === 5, "lineups: done for the day once every game's starters were checked", JSON.stringify(r7));
      const early = await lineupCheck(env, Date.parse("2026-11-12T13:00:00Z"));
      ok(early.skipped === "before 10 AM ET", "lineups: nothing before 10 AM ET");
      // The Worker's two schedules: "*/5" runs articles only; "* * * * *" runs lineups only.
      const ran = [];
      const env3 = { DISCORD_WEBHOOK: "https://discord.com/api/webhooks/1/test-x", LINEUPS_WEBHOOK: env.LINEUPS_WEBHOOK, STATE: { get: async (k) => { ran.push(k); return null; }, put: async () => {} } };
      const wait = [];
      articlesWorker.scheduled({ cron: "* * * * *", scheduledTime: T("09:00") }, env3, { waitUntil: (p) => wait.push(p) });
      await Promise.all(wait);
      const lineupsOnly = ran.join();
      ran.length = 0; wait.length = 0;
      articlesWorker.scheduled({ cron: "*/5 * * * *", scheduledTime: T("09:00") }, env3, { waitUntil: (p) => wait.push(p) });
      await Promise.all(wait).catch(() => {});
      ok(lineupsOnly === "" && ran.includes("state") && !ran.includes("lineups"), "articles: the 5-minute schedule runs the articles check, the 1-minute one the lineups check", JSON.stringify([lineupsOnly, ran]));
    } finally { globalThis.fetch = realFetch; }
  }
}
