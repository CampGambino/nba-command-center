/**
 * Checks for the articles watcher (cloudflare/articles-worker.js), with stand-in feeds, KV and
 * Discord. They need no saved samples, so the deploy workflow runs them on GitHub before every
 * deploy (tests/articles-only.js); tests/run.js runs them as part of the full suite.
 */
import fs from "node:fs";
import { parseLineups, diff as lineupDiff, lastStarters, lineupEmbed, lineupCheck, feedTime, espnStarters, feedDue, suspicion, timingEmbed, lineupContext } from "../cloudflare/lineups.js";
import { dueAt, dueNow, digestCheck } from "../cloudflare/digest.js";
import { TEAM_FEEDS, teamFeedGroup, findLiveBlog, parseLiveBlog, LIVE_FEED } from "../cloudflare/articles-worker.js";
import articlesWorker, { check as articlesCheck, decide as articleDecide, parseRss, parseEspn, adminKey, tagOf as articleTag, embedFor } from "../cloudflare/articles-worker.js";

import { handleVotes } from "../cloudflare/votes.js";
import { handleHeadlines } from "../cloudflare/headlines.js";
import { healthProblem, healthCheck } from "../cloudflare/health.js";
import { tfetch } from "../cloudflare/net.js";
import { pdfText, statusIn, slotUrls, latestReport, statusOnReport } from "../cloudflare/injurypdf.js";
import zlibMod from "node:zlib";
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
    ok(/seen \d{1,2}:\d\d [AP]M · \+\d+ min/.test(body), "articles: review page shows when each item was seen and how long after publishing", body.match(/seen[^<]{0,40}/)?.[0]);
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
    // The live blog's housekeeping and repeats (the user, 11/16, with that morning's posts).
    const lbD = (title, description = "", byline = "") => articleDecide({ src: "athletic-live", key: "lb:t", type: "LiveBlog", title, description, byline, published: now }, {}, now);
    ok(lbD("ICYMI: Yaxel Lendeborg changes the energy", "Yaxel Lendeborg wanted to make a change", "Nick Friedell").reason === "ICYMI (a repeat)" && !lbD("ICYMI: A massive Knicks win", "", "Mike Prada").post
      && !articleDecide(mk({ src: "athletic", title: "ICYMI: The week in NBA trades" }), { allowBylines: ["W"] }, now).post && !articleDecide(mk({ title: "In case you missed it: the weekend's news" }), {}, now).post,
      "articles: an ICYMI post is a repeat and never posts, from any source or writer");
    ok(lbD("Sunday's NBA scores", "We had a shootout in Phoenix").reason === "daily scores" && lbD("Sound off in our chat!", "Scroll over to the Discuss tab on this page").reason === "reader chat prompt"
      && lbD("Subscribe to The Athletic!", "Get your subscription here").reason === "subscription promo" && lbD("Missed our coverage from last week?", "Catch up by clicking over to our live blog for the fourth week of the season.").reason === "pointer to an older live blog"
      && lbD("A note for readers", "You can also email us at live@theathletic.com.").reason === "reader chat prompt",
      "articles: the live blog's scores, chat prompt, subscription promo and last-week pointer are skipped, by title or by what the post says");
    ok(lbD("BREAKING: Steph Curry out two weeks", "Curry has a sprained ankle", "Anthony Slater").post && lbD("Your NBA Cupdate", "Monday means another night of Cup games", "Mike Prada").post
      && lbD("Wembanyama scores 40 as Spurs win", "The Spurs subscribe to a simple idea: defend.").post && lbD("Knicks rally past Raptors in overtime", "They forced overtime, then hung on").post
      && articleDecide(mk({ title: "Lakers' scores of role players step up" }), {}, now).post && articleDecide({ src: "athletic-live", key: "lb:t", title: "Sunday's NBA scores", published: now }, { allowKeys: ["lb:t"] }, now).post,
      "articles: live blog news still posts (a game story, a word like 'subscribe' or 'scores' in passing), and a post allowed by hand still goes out");
    {
      const e = embedFor({ src: "athletic-live", key: "lb:9", title: "T", description: "D", byline: "Nick Friedell", published: now }, { now, base: "https://w.example", key: "K" });
      const links = e.description.split("\n\n").pop();
      ok(links === "[Mark as noise](https://w.example/act?k=K&do=noise&key=lb%3A9) · [Mute Nick Friedell](https://w.example/act?k=K&do=mute-writer&v=Nick%20Friedell) · [Review](https://w.example/review?k=K)" && !/\p{Extended_Pictographic}/u.test(links),
        "articles: the links under a post are words only (an emoji in a link opens Discord's emoji sheet on a phone)", links);
    }
    const athD = (title) => articleDecide(mk({ src: "athletic", byline: "", title }), {}, now);
    ok(!athD("The Bounce: Jaylen Brown goes cold in revenge game against Celtics").post && athD("The Bounce: x").reason === "The Bounce (show)" && !athD("This Week in Sports Trivia: Nov. 12, 2026").post
      && !athD("Fantasy basketball waiver wire: who to add").post && athD("November sports watch guide: College basketball returns, NWSL Championship").post && athD("Bouncing back: the Bulls' plan").post,
      "articles: The Athletic minus what the user ruled out (The Bounce, sports trivia, fantasy); the sports watch guide still posts");
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
    const P = (name, pos, status = "Confirmed", roster = "Active") => ({ playerName: name, position: pos, lineupStatus: status, rosterStatus: roster, timestamp: "2026-11-12T18:30:00" }); // Eastern clock (23:30 UTC)
    const feed = (st, swap = false) => ({ games: [{ gameId: "0022600300", gameStatus: 1, gameStatusText: "7:30 pm ET",
      homeTeam: { teamAbbreviation: "NYK", players: [P("Mikal Bridges", "SG", st), P("OG Anunoby", "SF", st), P("Jalen Brunson", "PG", st), P(swap ? "Mitchell Robinson" : "Josh Hart", "PF", st), P("Karl-Anthony Towns", "C", st), P(swap ? "Josh Hart" : "Mitchell Robinson", ""), P("Miles McBride", "", "Confirmed", "Inactive")] },
      awayTeam: { teamAbbreviation: "IND", players: [P("Aaron Nesmith", "SG", "Expected"), P("Kelly Oubre Jr.", "SF", "Expected"), P("Andrew Nembhard", "PG", "Expected"), P("Pascal Siakam", "PF", "Expected"), P("Ivica Zubac", "C", "Expected")] } }] });
    const g = parseLineups(feed("Confirmed"))[0];
    ok(g.teams[0].tri === "NYK" && g.teams[0].opp === "IND" && g.teams[0].status === "Confirmed" && g.teams[1].status === "Expected" && g.teams[0].starters.map((p) => p.pos).join() === "PG,SG,SF,PF,C" && g.teams[0].inactive.join() === "Miles McBride",
      "lineups: starters are the players with a position, PG to C; a five is Confirmed only when all five are; inactives listed", JSON.stringify(g.teams[0]));
    {
      // 11/12/26: NBA.com briefly had Justin Edwards (0 starts) in for Jaylen Brown (11 of 11, not on the injury report).
      const R = (st, min) => [st, min];
      const games = Array.from({ length: 11 }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, pl: { 1: R(1, 34), ...(i < 5 ? { 2: R(0, 8) } : {}), 3: R(1, 30) } }));
      const file = { names: { 1: "Jaylen Brown", 2: "Justin Edwards", 3: "Joel Embiid" }, games };
      const inj = { date: "2026-11-12", players: [{ team: "PHI", name: "Joel Embiid", status: "Questionable" }] };
      const w = suspicion(file, inj, ["Jaylen Brown"], ["Justin Edwards"], "PHI", "2026-11-12");
      ok(/Check before using:\*\* Jaylen Brown has started all 11 games he's played and isn't on the injury report \(Justin Edwards 0 starts in 5 games\)/.test(w || "")
        && suspicion(file, inj, ["Joel Embiid"], ["Justin Edwards"], "PHI", "2026-11-12") === null && suspicion(file, { date: "2026-11-11", players: [] }, ["Joel Embiid"], [], "PHI", "2026-11-12") !== null,
        "lineups: a swap is flagged when the player out has started every game he's played and isn't on tonight's injury report (Brown); not when he's listed (Embiid); an old report doesn't count", w);
    }
    ok(feedTime("2026-11-12T18:34:00") === Date.parse("2026-11-12T23:34:00Z") && feedTime("2026-07-01T18:34:00") === Date.parse("2026-07-01T22:34:00Z") && feedTime("2026-11-12T18:34:00Z") === Date.parse("2026-11-12T18:34:00Z"),
      "lineups: feed times are Eastern clock time (11/12: DET/WAS stamped 18:34, seen 6:35 PM ET); EST and EDT; a zone given is kept");
    ok(JSON.stringify(lineupDiff(["A B", "C D"], ["A B", "E F"])) === JSON.stringify({ in: ["E F"], out: ["C D"] }), "lineups: who's in and out");
    const file = { names: { 1: "Jalen Brunson", 2: "Mikal Bridges", 3: "OG Anunoby", 4: "Mitchell Robinson", 5: "Karl-Anthony Towns", 6: "Josh Hart" },
      games: [{ d: "2026-11-10", opp: "BOS", pl: { 1: [1], 2: [1], 3: [1], 4: [1], 5: [1], 6: [0] } }, { d: "2026-11-12", opp: "IND", pl: {} }] };
    const last = lastStarters(file, "2026-11-12");
    ok(last && last.d === "2026-11-10" && last.names.length === 5, "lineups: the last game's starters come from our box-score file (before today)", JSON.stringify(last));
    const e = lineupEmbed(g, g.teams[0], { last, expected: ["Jalen Brunson", "Mikal Bridges", "OG Anunoby", "Mitchell Robinson", "Karl-Anthony Towns"] });
    ok(/in \*\*Josh Hart\*\* · out Mitchell Robinson/.test(e.description) && /vs expected earlier today/.test(e.description) && /Inactive: Miles McBride/.test(e.description)  && e.title === "NYK vs IND · 7:30 pm ET" && e.description.startsWith("Jalen Brunson\nMikal Bridges\nOG Anunoby\nJosh Hart\nKarl-Anthony Towns\n"),
      "lineups: the post lists the five PG to C with no position labels (user, 11/12), and says what changed from the last game and the expected five", e.description);
    // 0.74: context on a confirmed five, from the team's box-score file.
    {
      const row = (st, min = 20) => [st, min, 10];
      const five = (ids) => Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((id) => [id, row(ids.includes(id) ? 1 : 0, id === 7 ? 0 : 20)]));
      const cf = { names: { 1: "Jalen Brunson", 2: "Mikal Bridges", 3: "OG Anunoby", 4: "Mitchell Robinson", 5: "Karl-Anthony Towns", 6: "Josh Hart", 7: "New Guy" },
        games: [1, 2, 3, 4, 5, 6].map((k) => ({ d: `2026-11-0${k}`, opp: "BOS", pf: k <= 4 ? 110 : 90, pa: 100, pl: five(k <= 5 ? [1, 2, 3, 4, 5] : [1, 2, 3, 5, 6]) })) };
      const usual = lineupContext(cf, ["Jalen Brunson", "Mikal Bridges", "OG Anunoby", "Mitchell Robinson", "Karl-Anthony Towns"], "2026-11-12");
      const swap = lineupContext(cf, ["Jalen Brunson", "Mikal Bridges", "OG Anunoby", "Josh Hart", "New Guy"], "2026-11-12");
      ok(usual.length === 1 && usual[0] === "This five has started together 5 times this season (4-1; 6 team games)."
        && swap.join(" | ") === "First time this five starts together this season (6 team games). | Josh Hart: 2nd start of the season (6 games). | New Guy: first game of the season."
        && lineupContext(cf, ["Jalen Brunson", "Mikal Bridges", "OG Anunoby", "Mitchell Robinson", "Josh Hart"], "2026-11-06").some((x) => x === "Josh Hart: first start of the season (5 games off the bench).")
        && lineupContext(null, ["a"], null).length === 0 && lineupContext({ names: {}, games: [] }, ["a", "b", "c", "d", "e"]).length === 0,
        "lineups (0.74): context for a confirmed five: how often it has started together and its record, a first or rare start, a season debut; nothing without the team's games", [usual.join(" | "), swap.join(" | ")].join(" || "));
      const ce = lineupEmbed(g, g.teams[0], { last, context: swap });
      ok(/📌 First time this five starts together this season/.test(ce.description) && /📌 New Guy: first game of the season\./.test(ce.description) && !/📌/.test(lineupEmbed(g, g.teams[0], { last }).description),
        "lineups (0.74): the context lines go on the post under what changed; a post without context is unchanged", ce.description);
    }
    // A run: posts once per confirmed five; a later change posts again; dry runs post nothing.
    const kv = new Map(), posts = [], edits = [];
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
      if (u.startsWith("https://discord.com/") && o.method === "PATCH") { edits.push({ id: u.split("/messages/")[1], ...JSON.parse(o.body) }); return new Response("{}", { status: 200 }); }
      if (u.startsWith("https://discord.com/")) { posts.push(JSON.parse(o.body)); return new Response(JSON.stringify({ id: `m${posts.length}` }), { status: 200 }); }
      if (u.includes("/scoreboard?dates=20261112")) return new Response(JSON.stringify({ events: [{ id: "401", date: "2026-11-13T00:30Z", competitions: [{ competitors: [{ team: { abbreviation: "NY" } }, { team: { abbreviation: "IND" } }] }] }] }), { status: 200 });
      if (u.includes("/summary?event=401")) return new Response(JSON.stringify(espn), { status: 200 });
      return new Response("", { status: 404 });
    };
    // Tip 7:30 PM ET (00:30 UTC). The user's timing (11/13): NBA.com every 5 minutes from 6:00 (90 out) to 6:55 (35 out);
    // every 30 seconds from 6:55:30 (34:30 out) to 7:20 (10 out); every 3 minutes after (7:21, 7:24, 7:27); ESPN every minute from 7:30.
    const T = (hhmm, sec = 0) => Date.parse(`2026-11-12T${hhmm}:${String(sec).padStart(2, "0")}-05:00`);
    const tip = T("19:30");
    const dueAt = [];
    for (let t = T("17:55"); t < tip + 60e3; t += 10e3) if (feedDue(tip, t)) dueAt.push(new Date(t - 5 * 3600e3).toISOString().slice(11, 19));
    ok(dueAt.join() === "18:00:00,18:05:00,18:10:00,18:15:00,18:20:00,18:25:00,18:30:00,18:35:00,18:40:00,18:45:00,18:50:00,18:55:00,18:55:30,18:56:00,18:56:30,18:57:00,18:57:30,18:58:00,18:58:30,18:59:00,18:59:30,19:00:00,19:00:30,19:01:00,19:01:30,19:02:00,19:02:30,19:03:00,19:03:30,19:04:00,19:04:30,19:05:00,19:05:30,19:06:00,19:06:30,19:07:00,19:07:30,19:08:00,19:08:30,19:09:00,19:09:30,19:10:00,19:10:30,19:11:00,19:11:30,19:12:00,19:12:30,19:13:00,19:13:30,19:14:00,19:14:30,19:15:00,19:15:30,19:16:00,19:16:30,19:17:00,19:17:30,19:18:00,19:18:30,19:19:00,19:19:30,19:20:00,19:21:00,19:24:00,19:27:00",
      "lineups: NBA.com read every 5 min from 90 to 35 out, every 30 seconds from 34:30 to 10 out (11/14), every 3 min after, never at or after tip", dueAt.join());
    // The night's summary (11/13 diagnostic): NBA.com's stamp, our first read, our post; the median; the 35-15 window.
    const tip7 = T("19:00");
    const row = (team, feedMin, seenMin, postedMin) => ({ team, tip: tip7, feedMin, seenMin, postedMin, lagSec: Math.round((feedMin - postedMin) * 60), changes: [], tipResult: "matched" });
    const emb = timingEmbed({ date: "2026-11-12", teams: [row("DET", 26.0, 25.0, 24.4), row("PHI", 22.1, 20.0, 19.4), row("DAL", 30.0, 25.0, 24.2), row("CHA", 27.0, 23.0, 22.4)] });
    ok(/median confirmation 26\.5 min before tip \(range 22\.1-30\.0\) · 4 of 4 in the 35-10 window · median lag \d+s/.test(emb.title) && /\*\*DET\*\* \(7:00 PM\): NBA\.com 26\.0 min · seen 25\.0 min · posted 24\.4 min before tip \(\+96s; 60s to see it\)/.test(emb.description),
      "lineups: the night's timing post shows NBA.com's stamp, when we first saw it and posted, the true median and the 35-15 window", JSON.stringify(emb));
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
      const b1 = await lineupCheck(env, T("18:59"), noSleep), b2 = await lineupCheck(env, T("19:20"), noSleep), b3 = await lineupCheck(env, T("19:21"), noSleep), b4 = await lineupCheck(env, T("19:22"), noSleep);
      ok(reads === 4 && b1.read.length === 2 && b2.read.length === 1 && b3.read.length === 1 && b4.read.length === 0 && posts.length === 1,
        "lineups: two reads a minute (:00 and :30) from 34:30 to 10 out (11/14 timing), then every 3 minutes (9 out read, 8 not); no repeat post", JSON.stringify([b1.read, b2.read, b3.read, b4.read]));
      current = feed("Confirmed", true);
      const r5 = await lineupCheck(env, T("19:04"), noSleep);
      ok(edits.length === 1 && edits[0].id === "m1" && /REPLACED \(changed at .* ET\) · see the newer post/.test(edits[0].embeds[0].author.name) && edits[0].embeds[0].color === 0x6b7280,
        "lineups: the earlier card is greyed and marked REPLACED when a change posts", JSON.stringify(edits));
      ok(r5.posted === 1 && /LINEUP CHANGE/.test(posts[1].embeds[0].author.name) && /Changed after it was confirmed:\*\* in Mitchell Robinson · out Josh Hart/.test(posts[1].embeds[0].description), "lineups: a change after it was confirmed posts on the next check", JSON.stringify(posts[1]?.embeds?.[0]));
      { // A flagged swap: NBA.com is read every minute until tip (19:23 isn't a 3-minute mark).
        const st = JSON.parse(kv.get("lineups")); st.teams.NYK.suspect = true; kv.set("lineups", JSON.stringify(st));
        reads = 0; await lineupCheck(env, T("19:23"), noSleep);
        ok(reads === 1, "lineups: after a flagged swap, NBA.com is read every minute until tip", String(reads));
        const st2 = JSON.parse(kv.get("lineups")); st2.teams.NYK.suspect = false; kv.set("lineups", JSON.stringify(st2));
      }
      reads = 0;
      const r6 = await lineupCheck(env, T("19:30"), noSleep);
      const tipPosts = posts.slice(2).map((p) => p.embeds[0]);
      ok(r6.posted === 2 && reads === 0 && /STARTED DIFFERENTLY · ESPN box score/.test(tipPosts[0].author.name) && /Started differently than confirmed:\*\* in Miles McBride, Josh Hart · out Mikal Bridges, Mitchell Robinson/.test(tipPosts[0].description)
        && !/Inactive/.test(tipPosts[0].description) && tipPosts[0].description.startsWith("Jalen Brunson\nMiles McBride\nOG Anunoby\nJosh Hart\nKarl-Anthony Towns")
        && /Starters at tip \(none confirmed before\)/.test(tipPosts[1].author.name) && tipPosts[1].title.startsWith("IND @ NYK"),
        "lineups: at tip, ESPN's box (not NBA.com): a late swap vs the confirmed five posts 'started differently'; a team never confirmed gets its starters", JSON.stringify(tipPosts.map((e) => [e.author.name, e.title, e.description])));
      ok(edits.length === 2 && edits[1].id === "m2" && /REPLACED \(a different five started\)/.test(edits[1].embeds[0].author.name),
        "lineups: at tip, the last card before tip (the change) is marked REPLACED when a different five started", JSON.stringify(edits));
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
  // Storylines digest to #alerts (cloudflare/digest.js): early games 2 hours before tip, the rest at 2 PM ET, never after tip.
  {
    const E = (hhmm) => Date.parse(`2026-11-26T${hhmm}:00-05:00`); // a day with a 12:30 PM and a 3:30 PM tip
    ok(dueAt(E("12:30")) === E("10:30") && dueAt(E("15:30")) === E("13:30") && dueAt(E("16:00")) === E("14:00") && dueAt(E("19:30")) === E("14:00"),
      "digest: tips before 4 PM ET are due 2 hours before; 4 PM and later at 2 PM");
    const sched = [{ id: "a", start: "2026-11-26T17:30Z" }, { id: "b", start: "2026-11-27T00:30Z" }]; // 12:30 PM, 7:30 PM
    ok(dueNow(sched, E("10:29")).length === 0 && dueNow(sched, E("10:30")).map((g) => g.id).join() === "a" && dueNow(sched, E("14:00"), { a: 1 }).map((g) => g.id).join() === "b" && dueNow(sched, E("14:00")).map((g) => g.id).join() === "b",
      "digest: due games, once each, and never one that has tipped (the 12:30 game isn't sent at 2 PM)");
    const kv = new Map(), posts = [];
    let data = { today: "2026-11-26", games: [
      { id: "a", away: "NYK", home: "DET", start: "2026-11-26T17:30Z", lines: [{ text: "NYK notes: a line" }] },
      { id: "b", away: "BOS", home: "LAL", start: "2026-11-27T00:30Z", lines: [{ text: "LAL notes: a line" }] },
    ] };
    let fetches = 0;
    const env = { ALERTS_WEBHOOK: "https://discord.com/api/webhooks/4/test-a", STATE: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => kv.set(k, v) } };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u, o = {}) => {
      u = String(u);
      if (u.includes("docs/data/tonight.json")) { fetches++; return new Response(JSON.stringify(data), { status: 200 }); }
      if (u.startsWith("https://discord.com/")) { posts.push(JSON.parse(o.body)); return new Response("{}", { status: 200 }); }
      return new Response("", { status: 404 });
    };
    try {
      const r0 = await digestCheck(env, E("07:55"));
      const r1 = await digestCheck(env, E("08:00")), r2 = await digestCheck(env, E("08:01"));
      ok(r0.skipped === "before 8 AM ET" && fetches === 1 && r2.skipped === "nothing due" && posts.length === 0, "digest: from 8 AM, reads the site's data once to learn the day's tips; nothing more until a game is due", JSON.stringify([r0, r1, r2, fetches]));
      const r3 = await digestCheck(env, E("10:30"));
      ok(r3.posted === 1 && posts[0].content.startsWith("**Afternoon storylines, Thu, Nov 26** · 1 game (tip before 4 PM ET)") && posts[0].embeds[0].title === "NYK @ DET · 12:30 PM ET",
        "digest: the 12:30 game posts at 10:30 as 'Afternoon storylines'", JSON.stringify(posts[0]));
      await digestCheck(env, E("10:31"));
      const r4 = await digestCheck(env, E("14:00"));
      ok(r4.posted === 1 && posts.length === 2 && posts[1].content.startsWith("**Tonight's storylines, Thu, Nov 26** · 1 game ·") && posts[1].embeds[0].title.startsWith("BOS @ LAL"),
        "digest: the evening game posts at 2 PM, without the early game again", JSON.stringify(posts[1]));
      // Data not built yet for the day: waits, then sends once it is (only games that haven't tipped).
      kv.clear(); posts.length = 0;
      data = { ...data, today: "2026-11-25" };
      const w = await digestCheck(env, E("14:00"));
      data = { ...data, today: "2026-11-26" };
      const w2 = await digestCheck(env, E("14:05"));
      ok(/isn't built yet/.test(w.waiting || "") && posts.length === 1 && posts[0].embeds.length === 1 && posts[0].embeds[0].title.startsWith("BOS @ LAL"),
        "digest: waits for the day's data, then sends what hasn't tipped (the 12:30 game is left out)", JSON.stringify([w, w2]));
      const noSecret = await digestCheck({ STATE: env.STATE }, E("14:00"));
      ok(noSecret.skipped === "no ALERTS_WEBHOOK secret", "digest: does nothing without the ALERTS_WEBHOOK secret");
    } finally { globalThis.fetch = realFetch; }
  }
  // The Athletic's 30 team feeds (11/12: the Bridges story was only in the Knicks feed; Curry's MRI result only in the Warriors').
  {
    const groups = [1, 2, 3, 4].map((m) => teamFeedGroup(m).map((f) => f.team));
    ok(TEAM_FEEDS.length === 30 && teamFeedGroup(0).length === 0 && teamFeedGroup(5).length === 0 && groups.flat().length === 30 && new Set(groups.flat()).size === 30 && groups.every((g) => g.length >= 7 && g.length <= 8)
      && TEAM_FEEDS.find((f) => f.team === "PHI").url.endsWith("/nba/sixers/") && TEAM_FEEDS.find((f) => f.team === "SAC").url.endsWith("/nba/sac-kings/"),
      "articles: 30 team feeds, read in 4 groups on the minutes between articles checks (each every 5 minutes)", JSON.stringify(groups));
    const kv = new Map([["state", JSON.stringify({ started: 1, seen: {}, errors: {}, base: null, lastWrite: 0 })]]), posts = [];
    const env = { DISCORD_WEBHOOK: "https://discord.com/api/webhooks/5/test-t", STATE: { get: async (k, t) => (kv.has(k) ? (t === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => kv.set(k, v) } };
    const T = Date.parse("2026-11-12T16:00:00Z");
    const item = (id, title, pub) => `<item><title><![CDATA[${title}]]></title><link>https://www.nytimes.com/athletic/${id}/2026/11/12/x/</link><pubDate>${new Date(pub).toUTCString()}</pubDate></item>`;
    let knicks = [item(1, "Older Knicks story", T - 3 * 3600e3), item(2, "Knicks mailbag", T - 50 * 3600e3)];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u, o = {}) => {
      u = String(u);
      if (u.includes("/rss/nba/knicks/")) {
        const body = `<rss><channel>${knicks.join("")}${"<item><title>pad</title><link>https://www.nytimes.com/athletic/9/2026/11/01/pad/</link><pubDate>Sun, 01 Nov 2026 00:00:00 GMT</pubDate></item>".repeat(2000)}</channel></rss>`;
        return new Response(body, { status: 200 });
      }
      if (u.startsWith("https://discord.com/")) { posts.push(JSON.parse(o.body)); return new Response("{}", { status: 200 }); }
      return new Response("", { status: 404 });
    };
    const feeds = TEAM_FEEDS.filter((f) => f.team === "NYK");
    try {
      const { check: articlesCheckT } = await import("../cloudflare/articles-worker.js");
      await articlesCheckT(env, T, { feeds });
      const st1 = JSON.parse(kv.get("state"));
      ok(posts.length === 0 && !kv.get("log") && st1.feedStarted["athletic:NYK"] && st1.seen[Object.keys(st1.seen).find((k) => k.includes("/1/"))], "articles: a team feed read for the first time is marked seen quietly (no posts, nothing logged)", JSON.stringify(Object.keys(st1.seen).slice(0, 3)));
      knicks = [item(3, "Knicks' Mikal Bridges is starting, not finishing. One carries more weight", T + 60e3), ...knicks];
      await articlesCheckT(env, T + 5 * 60e3, { feeds });
      const log = JSON.parse(kv.get("log") || "[]");
      ok(posts.length === 1 && posts[0].embeds[0].title.startsWith("Knicks' Mikal Bridges") && log[0].reason === "Athletic (NYK feed)" && log.length === 1,
        "articles: a new story in a team feed posts once, labeled with its team feed; the 2,000 older items past the first 60 KB aren't read", JSON.stringify(log));
      const st2 = JSON.parse(kv.get("state"));
      ok(st2.ok["athletic:NYK"].items < 500, "articles: only the top of a long team feed is downloaded", String(st2.ok["athletic:NYK"].items));
    } finally { globalThis.fetch = realFetch; }
  }
  // The Athletic's weekly NBA news live blog (11/12).
  {
    ok(findLiveBlog('<a href="/athletic/live-blogs/nba-cup-2026-live/AbC123/">x</a><a href="https://www.nytimes.com/athletic/live-blogs/nba-news-scores-games-schedule-stats-live-updates/3O8C8RgzvHTs/">y</a>') === "https://www.nytimes.com/athletic/live-blogs/nba-news-scores-games-schedule-stats-live-updates/3O8C8RgzvHTs/" && findLiveBlog("<p>none</p>") === null,
      "articles: the current NBA news live blog is found on The Athletic's NBA page (the news blog over others)");
    const T = Date.parse("2026-11-12T18:00:00Z");
    const post = (id, title, body, at, user, attach) => ({ __typename: "LiveBlogPost", id, permalink: `https://www.nytimes.com/athletic/live-blogs/nba-news/3O8/${id}/`, title, body, publishedAt: at, createdAt: at, is_pinned: false, user: { name: user }, attachments: attach || [] });
    let posts = [post("P1", "BREAKING: Steph Curry to miss at least 2 weeks", "<p>The Warriors announced that <strong>Steph Curry</strong> suffered an oblique abdominal tear.</p>", T - 60e3, "The Athletic NBA Staff", [{ type: "article", url: "https://www.nytimes.com/athletic/7776141/2026/11/12/stephen-curry-abdominal-injury-golden-state-warriors/" }])];
    const page = () => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { blog: { posts: { __typename: "LiveBlogPostsConnection", items: [...posts, { __typename: "LiveBlogDropzone", id: "d" }] } } } } })}</script></html>`;
    const items = parseLiveBlog(page(), "https://x/");
    ok(items.length === 1 && items[0].key === "lb:P1" && items[0].title.startsWith("BREAKING") && items[0].byline === "" && /Steph Curry suffered an oblique/.test(items[0].description) && items[0].articleKeys[0].includes("7776141"),
      "articles: live blog posts read from the page's data (title, text without HTML, staff byline dropped, linked articles)", JSON.stringify(items));
    const untitled = parseLiveBlog(page().replace("BREAKING: Steph Curry to miss at least 2 weeks", ""), "x")[0];
    ok(untitled.title === "The Warriors announced that Steph Curry suffered an oblique abdominal tear.", "articles: an untitled post is titled by its first sentence", untitled.title);
    const kv = new Map([["state", JSON.stringify({ started: 1, seen: {}, errors: {}, base: null, lastWrite: 0, feedStarted: { "athletic:live": 1 } })]]), sent = [];
    const env = { DISCORD_WEBHOOK: "https://discord.com/api/webhooks/6/test-l", STATE: { get: async (k, t) => (kv.has(k) ? (t === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => kv.set(k, v) } };
    const realFetch = globalThis.fetch;
    let warriors = "";
    globalThis.fetch = async (u, o = {}) => {
      u = String(u);
      if (u === LIVE_FEED.url) return new Response('<a href="/athletic/live-blogs/nba-news-scores-games-schedule-stats-live-updates/3O8C8RgzvHTs/">live</a>', { status: 200 });
      if (u.includes("/live-blogs/nba-news-scores")) return new Response(page(), { status: 200 });
      if (u.includes("/rss/nba/warriors/")) return new Response(warriors, { status: 200 });
      if (u.startsWith("https://discord.com/")) { sent.push(JSON.parse(o.body)); return new Response("{}", { status: 200 }); }
      return new Response("", { status: 404 });
    };
    try {
      const { check: articlesCheckL } = await import("../cloudflare/articles-worker.js");
      await articlesCheckL(env, T, { feeds: [LIVE_FEED] });
      ok(sent.length === 1 && sent[0].embeds[0].author.name.startsWith("📝 Live blog") && sent[0].embeds[0].title.startsWith("BREAKING: Steph Curry") && JSON.parse(kv.get("log"))[0].reason === "Athletic live blog post",
        "articles: a new live blog post goes to #articles as '📝 Live blog'", JSON.stringify(sent[0]?.embeds?.[0]?.author));
      // The article it links to shows up later in the Warriors feed: not posted again.
      warriors = `<rss><channel><item><title>Warriors' Stephen Curry to be re-evaluated in 2 weeks</title><link>https://www.nytimes.com/athletic/7776141/2026/11/12/stephen-curry-abdominal-injury-golden-state-warriors/</link><pubDate>${new Date(T).toUTCString()}</pubDate></item></channel></rss>`;
      const st = JSON.parse(kv.get("state")); st.feedStarted["athletic:GSW"] = 1; kv.set("state", JSON.stringify(st));
      await articlesCheckL(env, T + 120e3, { feeds: TEAM_FEEDS.filter((f) => f.team === "GSW") });
      await articlesCheckL(env, T + 300e3, { feeds: [LIVE_FEED] });
      ok(sent.length === 1, "articles: the article a live blog post links to isn't posted again; the same post isn't either", String(sent.length));
    } finally { globalThis.fetch = realFetch; }
  }
  // ---------- 0.67: briefing votes ----------
  {
    const kv = new Map();
    const env = { STATE: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => kv.set(k, v) } };
    const req = (method, path, body) => new Request(`https://w.example${path}`, { method, body: body ? JSON.stringify(body) : undefined });
    const call = async (method, path, body) => { const r = req(method, path, body); return handleVotes(r, env, new URL(r.url), "KEY1"); };
    const denied = await call("POST", "/vote?k=nope", { key: "a", v: 1 });
    const up = await call("POST", "/vote?k=KEY1", { key: "season|1|ppg", kind: "season", team: "GSW", player: "Stephen Curry", text: "Curry this season…", d: "2026-11-14", v: 1 });
    await call("POST", "/vote?k=KEY1", { key: "team|x", kind: "team", text: "x", v: -1 });
    await call("POST", "/vote?k=KEY1", { key: "season|1|ppg", v: -1, kind: "season" });
    await call("POST", "/vote?k=KEY1", { key: "team|x", v: 0 });
    const list = await (await call("GET", "/votes")).json();
    const bad = await call("POST", "/vote?k=KEY1", { key: "z", v: 5 });
    const other = await call("GET", "/review");
    ok(denied.status === 403 && up.status === 200 && up.headers.get("Access-Control-Allow-Origin") === "https://campgambino.github.io" && list.votes.length === 1 && list.votes[0].v === -1 && bad.status === 400 && other === null,
      "votes (0.67): a vote needs the key; the latest vote per line is kept, 0 takes it back; anyone can read; other paths pass through", JSON.stringify(list));
  }
  // ---------- 0.70: headlines for the briefing's "in the news" boost ----------
  {
    const now = Date.parse("2026-11-15T18:00:00Z");
    const log = [{ at: now - 3600e3, published: now - 2 * 3600e3, src: "athletic", title: "Jared McCain is thriving in OKC", url: "https://x", reason: "posted by you", byline: "A" },
      { at: now - 100 * 3600e3, src: "espn", title: "Old story", url: "https://y" }, { at: now - 60e3, src: "espn", title: "" }];
    const env = { STATE: { get: async (k) => (k === "log" ? log : null) } };
    const r = await handleHeadlines(new Request("https://w.example/headlines"), env, new URL("https://w.example/headlines"), now);
    const j = await r.json();
    const other = await handleHeadlines(new Request("https://w.example/votes"), env, new URL("https://w.example/votes"), now);
    ok(j.headlines.length === 1 && j.headlines[0].title === "Jared McCain is thriving in OKC" && !("reason" in j.headlines[0]) && !("url" in j.headlines[0]) && other === null,
      "headlines (0.70): the last 72 hours' titles only (no review-page reasons or links); other paths pass through", JSON.stringify(j));
  }
  // ---------- 0.73: time limits, the build check, and no duplicate storylines (the user's OK, 11/15) ----------
  {
    const realFetch = globalThis.fetch;
    const kvOf = () => { const kv = new Map(); return { kv, STATE: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => kv.set(k, v) } }; };
    try {
      // tfetch: a request that never answers, and one that can't connect, both come back as a 504 (never a throw).
      globalThis.fetch = (u, o = {}) => new Promise((_, rej) => o.signal?.addEventListener("abort", () => rej(o.signal.reason)));
      const keep = setTimeout(() => {}, 2000); // Node doesn't wait for a time limit's own timer
      const slow = await tfetch("https://x.example/slow", {}, 30);
      clearTimeout(keep);
      globalThis.fetch = async () => { throw new TypeError("connect failed"); };
      const down = await tfetch("https://x.example/down", {}, 30);
      ok(slow.status === 504 && slow.statusText === "timed out" && !slow.ok && down.status === 504 && down.statusText === "network error",
        "worker (0.73): a request has a time limit; one that times out or can't connect is a failed answer, not a crash", JSON.stringify([slow.status, slow.statusText, down.statusText]));

      // Lineups: a failed NBA.com read is "not this time"; and what a run has posted is saved even if a later step fails.
      const P = (name, pos, st) => ({ playerName: name, position: pos, lineupStatus: st, timestamp: "2026-11-20T18:50:00" });
      const five = (st) => [P("A One", "PG", st), P("B Two", "SG", st), P("C Three", "SF", st), P("D Four", "PF", st), P("E Five", "C", st)];
      const good = { games: [{ gameId: "1", gameStatusText: "7:30 pm ET", homeTeam: { teamAbbreviation: "NYK", players: five("Confirmed") }, awayTeam: { teamAbbreviation: "IND", players: [] } }] };
      const T = (hhmm) => Date.parse(`2026-11-20T${hhmm}:00-05:00`);
      const { kv, STATE } = kvOf(); const posts = []; let feedMode = "down", reads = 0;
      const env = { LINEUPS_WEBHOOK: "https://discord.com/api/webhooks/3/test-z", STATE };
      globalThis.fetch = async (u, o = {}) => {
        u = String(u);
        if (u.includes("daily_lineups_20261120")) { reads++; if (feedMode === "down") throw new TypeError("connect failed"); return new Response(JSON.stringify(feedMode === "good-then-bad" && reads % 2 === 0 ? { games: [null] } : good), { status: 200 }); }
        if (u.startsWith("https://discord.com/")) { posts.push(JSON.parse(o.body)); return new Response(JSON.stringify({ id: `m${posts.length}` }), { status: 200 }); }
        if (u.includes("/scoreboard?dates=20261120")) return new Response(JSON.stringify({ events: [{ id: "9", date: "2026-11-21T00:30Z", competitions: [{ competitors: [{ team: { abbreviation: "NY" } }, { team: { abbreviation: "IND" } }] }] }] }), { status: 200 });
        return new Response("", { status: 404 });
      };
      const noSleep = { sleep: async () => {} };
      const d1 = await lineupCheck(env, T("18:56"), noSleep);
      ok(posts.length === 0 && d1.read.length === 2 && d1.read.every((x) => /nba\.com 504 \(network error\)/.test(x)), "lineups (0.73): NBA.com not answering is a missed read, tried again 30 seconds on", JSON.stringify(d1.read));
      feedMode = "good-then-bad"; reads = 0;
      const threw = await lineupCheck(env, T("18:57"), noSleep).then(() => false, () => true);
      const saved = JSON.parse(kv.get("lineups") || "{}").teams?.NYK?.posted;
      feedMode = "good";
      const again = await lineupCheck(env, T("18:58"), noSleep);
      ok(threw && posts.length === 1 && saved?.length === 5 && again.posted === 0, "lineups (0.73): a lineup already posted is written down even when a later read breaks the run, so the next minute doesn't post it again", JSON.stringify([threw, posts.length, saved, again.posted]));

      // Storylines: Discord takes the first message and not the second; the next run sends only the rest.
      const D = kvOf(); const sent = []; let failOn = 2, tries = 0;
      const games = Array.from({ length: 14 }, (_, i) => ({ id: `g${i}`, away: "BOS", home: "LAL", start: "2026-11-21T00:30Z", lines: Array.from({ length: 6 }, (_, k) => ({ text: `Game ${i} line ${k}: ${"storyline text ".repeat(12)}` })) }));
      globalThis.fetch = async (u, o = {}) => {
        u = String(u);
        if (u.includes("docs/data/tonight.json")) return new Response(JSON.stringify({ today: "2026-11-20", games }), { status: 200 });
        if (u.startsWith("https://discord.com/")) { tries++; if (tries === failOn) return new Response("{}", { status: 500 }); sent.push(JSON.parse(o.body)); return new Response("{}", { status: 200 }); }
        return new Response("", { status: 404 });
      };
      const envD = { ALERTS_WEBHOOK: "https://discord.com/api/webhooks/4/test-a", STATE: D.STATE };
      const dry = await digestCheck(envD, T("14:00"), { dry: true });
      const p1 = await digestCheck(envD, T("14:00"), noSleep), p2 = await digestCheck(envD, T("14:01"), noSleep), p3 = await digestCheck(envD, T("14:02"), noSleep);
      const titles = sent.flatMap((m) => (m.embeds || []).map((e) => e.title + (e.description || "").slice(0, 30)));
      ok(dry.wouldPost >= 2 && /^1 of \d+ messages sent/.test(p1.partial || "") && p2.posted === dry.wouldPost && sent.length === dry.wouldPost && new Set(sent.map((m) => JSON.stringify(m))).size === sent.length && p3.skipped === "nothing due",
        "digest (0.73): when Discord takes part of the storylines post, the next run sends only what's left (no message twice)", JSON.stringify([dry.wouldPost, p1, p2.posted, sent.length, p3]));

      // The build check: one message a day when the build isn't doing its job; quiet after three days; nothing when it's fine.
      const day = (d, hhmm) => Date.parse(`2026-11-${d}T${hhmm}:00-05:00`);
      const H = (at, steps = [{ step: "tonight", ok: true }, { step: "situations", ok: true }]) => ({ at: new Date(at).toISOString(), today: "x", steps });
      ok(healthProblem(H(day(20, "10:40")), day(20, "12:30")) === null
        && /^No build has finished today\. The last one was Nov 19, 5:35 PM ET\.$/.test(healthProblem(H(day(19, "17:35")), day(20, "12:30")))
        && /^The Nov 20, 1:04 PM ET build had a problem: results, stats and storylines didn't finish \(exit 1\)\.$/.test(healthProblem(H(day(20, "13:04"), [{ step: "tonight", ok: true }, { step: "situations", ok: false, error: "exit 1" }]), day(20, "13:10")))
        && /hasn't rebuilt since Nov 20, 8:05 AM ET \(6 hours/.test(healthProblem(H(day(20, "08:05")), day(20, "14:05"))) && healthProblem(null, day(20, "13:00")) === null,
        "build check (0.73): no build today, a step that didn't finish, or a build over 5 hours old; an unreadable note isn't a problem", healthProblem(H(day(19, "17:35")), day(20, "12:30")));
      const K = kvOf(); const alerts = []; let health = H(day(19, "17:35"));
      globalThis.fetch = async (u, o = {}) => {
        u = String(u);
        if (u.includes("docs/data/health.json")) return new Response(JSON.stringify(health), { status: 200 });
        if (u.startsWith("https://discord.com/")) { alerts.push(JSON.parse(o.body)); return new Response("{}", { status: 200 }); }
        return new Response("", { status: 404 });
      };
      const envH = { ALERTS_WEBHOOK: "https://discord.com/api/webhooks/4/test-a", STATE: K.STATE };
      const h0 = await healthCheck(envH, day(20, "12:25")), h1 = await healthCheck(envH, day(20, "12:30")), h2 = await healthCheck(envH, day(20, "12:35")), h3 = await healthCheck(envH, day(20, "12:32"));
      const h4 = await healthCheck(envH, day(21, "12:30")), h5 = await healthCheck(envH, day(22, "12:30")), h6 = await healthCheck(envH, day(23, "12:30"));
      health = H(day(24, "10:40"));
      const h7 = await healthCheck(envH, day(24, "12:30"));
      health = H(day(24, "13:04"), [{ step: "tonight", ok: false, error: "stopped after 14 minutes" }]);
      const h8 = await healthCheck(envH, day(24, "13:05"));
      const noHook = await healthCheck({ STATE: K.STATE }, day(24, "13:10"));
      ok(h0.skipped && h1.posted === 1 && h1.streak === 1 && /already/.test(h2.skipped) && h3.skipped && h4.streak === 2 && h5.streak === 3 && /three days in a row/.test(alerts[2].content) && /quiet/.test(h6.skipped) && alerts.length === 4
        && h7.ok === true && h8.posted === 1 && h8.streak === 1 && /notes and milestones didn't finish \(stopped after 14 minutes\)/.test(alerts[3].content) && alerts[0].username === "NBA Command Center · Build check" && /actions\/workflows\/daily\.yml/.test(alerts[0].content) && /no ALERTS_WEBHOOK/.test(noHook.skipped),
        "build check (0.73): one message a day from 12:30 PM ET, a last one on the third day running, then quiet until a build goes through", JSON.stringify([h0, h1, h2, h4, h5, h6, h7, h8, alerts.length]));
    } finally { globalThis.fetch = realFetch; }
  }
  // ---------- 0.68: the league's latest injury report, read by the Worker (11/14: Porter Jr. Out at 7:15 PM) ----------
  {
    const content = `BT (Injury) Tj (Report:) Tj (11/14/26) Tj (07:15) Tj (PM) Tj ET BT (08:00) Tj ((ET)) Tj (BKN@MEM) Tj (Brooklyn) Tj (Nets) Tj (Bilodeau,) Tj (Tyler) Tj (Out) Tj (G) Tj (League) Tj (-) Tj (Two-) Tj (Way) Tj
      (Udeh,) Tj (Jr.,) Tj (Ernest) Tj (Out) Tj (G) Tj (League) Tj (-) Tj (Two-Way) Tj (Porter) Tj (Jr.,) Tj (Michael) Tj (Out) Tj (Personal) Tj (Reasons) Tj (Traore,) Tj (Nolan) Tj (Available) Tj (Injury/Illness) Tj (-) Tj (Right) Tj (Calf) Tj
      (Memphis) Tj (Grizzlies) Tj (Aldama,) Tj (Santi) Tj (Questionable) Tj (Injury/Illness) Tj (-) Tj (Left) Tj (Ankle) Tj ET`;
    const z = zlibMod.deflateSync(Buffer.from(content, "latin1"));
    const meta = Buffer.from("1 0 obj\n<< /Type/Metadata /Length 5 >>\nstream\n<xml>\nendstream\nendobj\n");
    const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), meta, Buffer.from(`2 0 obj\n<< /Length ${z.length} /Filter/FlateDecode >>\nstream\n`), z, Buffer.from("\r\nendstream\nendobj\n%%EOF")]);
    const text = await pdfText(pdf);
    const mpj = statusIn(text, "Michael Porter Jr."), udeh = statusIn(text, "Ernest Udeh Jr."), traore = statusIn(text, "Nolan Traore");
    ok(mpj?.status === "Out" && mpj.reason === "Personal Reasons" && udeh?.status === "Out" && traore?.status === "Available" && /Right Calf$/.test(traore.reason) && statusIn(text, "Santi Aldama")?.status === "Questionable" && statusIn(text, "LeBron James") === null,
      "injury report (0.68): the Worker reads the league's PDF: Porter Jr. Out (Personal Reasons); 'Udeh, Jr., Ernest'; a reason stops at the next team", JSON.stringify({ mpj, udeh, traore }));
    ok(/Injury-Report_2026-11-14_07_30PM\.pdf$/.test(slotUrls(Date.parse("2026-11-15T00:40:00Z"), 2)[0]) && /07_15PM/.test(slotUrls(Date.parse("2026-11-15T00:40:00Z"), 2)[1]), "injury report (0.68): the 15-minute slots back from now, Eastern time");
    const rep = await latestReport(Date.parse("2026-11-15T00:40:00Z"), async (u) => (/07_15PM/.test(u) ? new Response(pdf) : new Response("", { status: 404 })));
    ok(rep?.asOf === "7:15 PM" && rep.bodies.some((b) => /\(Porter\)/.test(b)), "injury report (0.68): the newest report that exists (7:30 not up yet, 7:15 is)", rep?.url);
    // The 7:40 PM post: the site's file was the 6:00 PM report (no Porter Jr.); the league's 7:15 PM report has him Out.
    const R = (st, min) => [st, min];
    const games = Array.from({ length: 11 }, (_, i) => ({ d: `2026-11-${String(i + 1).padStart(2, "0")}`, pl: { 1: R(1, 34), 2: R(0, 12) } }));
    const file = { names: { 1: "Michael Porter Jr.", 2: "Noah Clowney" }, games };
    const inj6 = { date: "2026-11-14", report: { asOf: "11/14/26 06:00 PM" }, players: [] };
    const withRep = suspicion(file, inj6, ["Michael Porter Jr."], ["Noah Clowney"], "BKN", "2026-11-14", rep);
    const without = suspicion(file, inj6, ["Michael Porter Jr."], ["Noah Clowney"], "BKN", "2026-11-14", null);
    ok(withRep === "🩹 Michael Porter Jr.: Out (Personal Reasons) on the 7:15 PM injury report." && /isn't on the 6:00 PM injury report/.test(without || ""),
      "lineups (0.68): no 'check before using' when the latest report has him Out (his status instead); without it, the warning says which report it checked", JSON.stringify([withRep, without]));
  }
}
