# Changes

Each entry: what changed, how it was tested, and what is still unproven.

## 0.24.0 (2026-11-12): history lines checked against the box scores; Out players hidden

### Why
- **The user, after 0.23.1:** "not enough information is populating the game notes history section", and "Kon Knueppel is included despite being out on the injury report". They asked to loosen the rules a bit, or have the program learn which player a stat belongs to.
- **What 0.23.1 dropped** (last night's notes, 29 teams): 599 lines as "no player named" and 142 as "not this season". Many were good: unnamed lines on a player's page ("Recorded his 1,000th career steal on October 28…"), and current facts the notes don't date ("Towns has recorded a double-double in nine straight games to start the season", "Giannis is just seven points short from tying Gary Payton").

### What changed
- **New `src/notes/boxscore.js`: checking a line against this season's box scores** (`docs/data/teams/<TRI>.json`, every player's line in every game).
  - **Reads single-game claims:** "13 assists", "18 PTS, 12 REB and 12 AST", "a 29-point, 14-rebound, 11-assist triple-double", "9-17 FG, 4-9 3FG". It skips thresholds and the rest of their list ("at least 35 points, 10 rebounds and 5 assists"), averages, multi-game totals ("151 points… through the first seven games") and numbers from a quarter or half. It narrows by date and opponent ("vs. ATL", "at Detroit").
  - **Who:** if exactly one player on the team had that game, the line is his ("Posted a 29-point, 14-rebound, 11-assist triple-double on October 26 vs. Dallas" → Giannis Antetokounmpo; it had been read as Bam Adebayo's). If the player a line was credited to never had that game, the line is moved to the player who did, or dropped.
  - **When:** a match makes the line this season's. A named player who never had that game this season → not current (Flagg's 51-point game is last season's).
  - **Thresholds:** "the first rookie… with four-plus steals and four-plus 3FGM in a single game": current if he had such a game this season.
- **Who, in `readHistory`, in order of trust:**
  - **named** (subject, first 40 characters) or **heading** (capitals heading, now also one word such as "SHARPE", or a unique last name);
  - **bio:** a player-bio header ("# 7 GIANNIS ANTETOKOUNMPO FORWARD", "#5 Paolo Banchero (F…") owns what follows, up to the next header (Miami's pages put two players side by side);
  - **paragraph:** "He… / Became… / Passed…" within 700 characters of the sentence that named him. The paragraph's player is now noted even for sentences that are later filtered out, and a mid-sentence heading ("KESSLER MAKING HIS MARK:") splits instead of cutting (Kessler's 500th block had been credited to Reaves);
  - **section** (last player named on the page): only when a box score agrees. It had credited Brandon Miller's three-straight-30s line to Kon Knueppel;
  - **box:** the box-score match above.
  - "Passed Kevin Durant…" and "joining Allen Iverson" are objects, not subjects, even by last name alone. Coach and front-office lines on a player's page are dropped.
- **When:**
  - a "He…" line with no date takes the date of the sentence before it ("On Dec. 23, 2025… He is now the first rookie…" is last season's);
  - present-tense standing facts count as current ("Giddey has recorded six games of 15-plus assists…, tied for fourth-most", "Duren has the 4th-highest field goal percentage…");
  - more phrasings count: "to start the season", "today", "is now", "currently", "for the fourth straight game", "has recorded… in nine straight games";
  - more look-aheads count: "just seven points short from tying", "from passing".
- **Clean-up:** table cells read twice ("Luka DoncicLuka Doncic 5252") are dropped; "150-plus" and "150plus" copies merge; the same game written up twice (same player, same three or more numbers) is kept once; an unnamed copy of a named line is dropped.
- **Watch List panel:** lines about a player listed Out or Doubtful on tonight's injury report are hidden, with a note ("Hidden, on tonight's injury report: Brandon Miller (Out), Kon Knueppel (Out)"). Questionable is marked. `injuryStatus()` (in `src/anticipate/tonight.js`) is shared with the storylines, which already did this.
- **The build** passes each team's box scores to the reader; `notes-facts.json` lines carry `how` (named, heading, bio, paragraph, section, box, team) and the matched `game`.

### Tested
- **Last night's notes, 29 teams:** 48 lines (0.23.1) → 119. Breakdown: 73 named, 12 paragraph, 10 bio, 7 box, 4 section (box-confirmed), 2 heading, 11 team. Read every line.
  - **Gained, e.g.:** Towns's nine-straight double-doubles; Giannis 7 points from Gary Payton; Caleb Wilson's 4-steal, 4-three game; Sharpe's career-high 13 assists (box); Boozer's triple-double (box); Acuff's 32-and-10 (box); Bam's HEAT rebound record (bio); Kessler's 500th block (paragraph, fixed from Reaves).
  - **Corrected by box score:** the Oct. 26 triple-double (Bam → Giannis) and an 11-point, 11-assist opener (Pelle Larsson → Davion Mitchell).
  - **Still dropped:** the user's 9 lines from 11/12; last season's lines (312 dated, 63 following a dated one); 35 unconfirmed page-level guesses.
- **Tonight's real build** (8 teams' notes so far): 31 lines (0.23.1 had 18). Rendered the panel: CHA shows only PJ Hall, with "Hidden… Brandon Miller (Out), Kon Knueppel (Out)"; MIN hides Anthony Edwards (Out); LeBron marked Questionable.
- **New checks** (477 pass): claims vs thresholds, totals, averages and adjective stat lines; box points to the one player; one-word heading; bio headers; box attribution; "He…" after a last-season date; threshold-current; injury status lookup (old report ignored). Page sweep OK.

### Still unproven
- **Box matching needs the team file to be current;** the build reads the previous build's file (up to a day old), so last night's game can't confirm a line yet.
- **Standing facts** ("has / ranks / holds…") are trusted as current. A stale career line copied forward from last season would pass.
- **Paragraph attribution** can still be wrong when a block mixes two players without a heading; 700 characters is a guess.

## 0.23.1 (2026-11-12): history lines must say who and be from this season

### Why
- **The user's review** of the "History in tonight's notes" panel flagged 9 bad lines: some with no player ("He is the only rookie…", ".joined Shaq…"), one credited to the wrong player (a "Tolu Smith" heading over a Ron Holland line), and old or minor background (Poeltl first Austrian, Rajaković's 100th win, Mavericks picked ninth, Porziņģis as a Maverick, Texas Tech, a Nowitzki stat row).
- **The user's conclusion:** "players are not attributed in some blurbs while other blurbs are considered non critical." 0.23.0 ranked such lines lower; they should not be shown at all.

### What changed
- **`readHistory` is strict** (`src/notes/narrative.js`). A line is kept only if it says WHO and is CURRENT; everything else is dropped, not ranked lower.
  - **Who:**
    - the team's player as the subject: full name in the first 40 characters, or the sentence opens with his unique last name;
    - not a name right after "passed / tied / joined / behind / than…" ("Passed Nikola Vučević…" is not about Vučević);
    - a capitals heading's player only when the sentence doesn't open with someone else's name;
    - "He… / The rookie…" only inside the same paragraph as a named sentence;
    - or the team itself (sentence opens with its city, nickname or alias).
    - No more guesses: an unnamed line is dropped.
  - **When:**
    - a day with no year is the latest such day on or before today ("11/26" on 11/12 is last season's; "2/20" too);
    - "Dec. 19-28, 2025" ranges are read;
    - two-digit years over 50 are 1900s ("1/29/88" had been read as 2088, which made some old lines look current);
    - "last season / during 2025-26" lines are dropped unless they also carry a real day from this season (a "2026-27" spliced in from a table no longer counts);
    - a line must be dated this season, say "this season" or similar, or look ahead.
  - **Background dropped:** draft lines, transfers, college honours, "left the Miami Heat…", former-team careers.
  - **Splices dropped:** two capitals words in a row that aren't common abbreviations ("seventh MOST DOUBLE-DOUBLES double-double"); sub-bullets ("o The Pelicans…") and "**MAGIC TRICKS…" tails are split off.
  - **Look-ahead must not be past tense** ("was the first… within 60 games" is a record, not a look-ahead).
- **The build passes today's date and team words** (`scripts/tonight.js`: city, nickname, `alt` and aliases like Mavs, Cavs, Sixers, HEAT).
- **Pushes that change `scripts/tonight.js` or `src/notes/**` now rebuild** (`daily.yml`), so a reader fix reaches the site without waiting for the next scheduled build.
- **Storylines, Discord and NBA Live cards name the player** when the line doesn't ("WAS notes — Anthony Davis: Logged his 39th…"). Before, only the Watch List panel showed the name.

### Tested
- **Last night's notes, all 29 teams with notes cached:** 644 lines before (0.23.0), 48 now. All 9 flagged lines are gone. Read through the 48; examples kept:
  - Davis "Logged his 39th career 40-point double-double on 11/9…, tying Michael Jordan" (heading named);
  - Durant "needs 816 points to pass Kobe Bryant for 4th";
  - Brandon Miller "second-fastest player in NBA history to reach 500 career 3-pointers made (Oct. 26 vs. WAS)";
  - Bulls "attempted 47 free throws in their season opener… most since Dec. 12, 2014" (team line).
- **Dropped in the second pass** (found while reading): Vassell 11/26 and 12/5, Sensabaugh 1/14-1/17, Nuggets 2/20, Paul Reed Dec. 19-28 2025 (all last season); "SHARPE Assists per game…" and Sabonis splices; "Passed Nikola Vučević" credited to Vučević; Duncan Robinson's Miami record; Jalen Johnson's 2025-26 All-NBA; Knueppel's rookie-season 3PM.
- **New checks** (466 pass): the user's 9 lines rebuilt as must-drop cases; yearless future day and dated range → dropped; "Passed <name>" not the subject; a named current line kept (exactly 3 of 21 kept); unnamed line dropped; storyline label carries the player.
- **The real build** (`scripts/tonight.js --today 2026-11-11`): 33 lines from 20 teams, 25 naming a player, 8 team lines. Page sweep OK at 1400 and 390 px. Local data not committed.

### Still unproven
- **Too strict in places:** a good line can be lost (e.g. a sentence naming two players where ours is second, or a heading line that opens with an opponent's name). 48 lines a night may be fewer than the user wants; loosen from what's missed.
- **Pronoun lines** rely on the paragraph's named sentence coming first.

## 0.23.0 (2026-11-12): history from the teams' notes ("first since…", "only player in NBA history…")

### Why
- **The user's examples:** 12 @NBAPR posts (Durant 3 FGM from passing Shaq, Acuff's 259 points through 10 games since Jordan, Luka's 10 career 50-point games tying Kareem, the West's top five all on 4+ win streaks...), and the ask to get ahead of posts like these.
- **What the notes hold:** the teams' game notes carry many such facts, written by each team's PR staff. Until now the Command Center read only the notes' numbers and rankings.
- **What they don't:** others come from the league's own research (Durant/Shaq FGM wasn't in Houston's notes).
- **The user's decision:** no NBA.com stats data for a history database (its terms limit use to personal, non-commercial). History comes from the notes, and later from leaderboard sources that are clearly allowed.

### What changed
- **New `readHistory` in `src/notes/narrative.js`:** verbatim history lines from a team's notes, using the existing column-aware sentence splitter.
  - **Kinds:**
    - `pass`: "needs 816 points to pass Kobe Bryant for 4th";
    - `next`: other forward-looking lines;
    - `record`: "first rookie since…", "only player in NBA history…", "most … in franchise history", "best start since 1999-00", "youngest/fastest…", named records.
  - **Left out:** college and high-school lines; boilerplate (bio boxes, "Video Highlights"); splices across columns (unbalanced brackets, sentences that stop mid-thought, stat-table fragments like "29p-11r-9a", runs of capitals).
  - **Headings:** a capitals heading glued to a sentence ("ANTHONY DAVIS Logged…") is dropped and names the player; a heading starting the next item mid-sentence ("600/400 CLUB: …") is cut off.
  - **When a line is from:**
    - its dates decide ("On 3/27/25 … first rookie this season" is older);
    - "since 1973-74" is a comparison, not a date;
    - "on 11/9" is this season.
  - **Players:** a line names a player only when the sentence (or its heading) names him. A guess from the section is marked and not shown as a name: guesses were often wrong (Carlisle's coaching wins credited to Haliburton, Knicks team facts to Drummond).
  - **Duplicates:** a pass printed twice is kept once, the copy that names the player.
- **The daily build** (`scripts/tonight.js`) writes `docs/data/notes-facts.json` (up to 40 lines a team, best first).
  - **What's new:** each line's first-seen date is kept in `history/notes-facts/<TEAM>.json` (60 days), so "New" means not in the team's earlier notes.
  - **Ranking:** new lines, named players, this season's facts and "in NBA history / all-time / first player" rank higher; older background ranks lower.
- **Tonight's storylines:** 📜 history lines, at most 2 a game, labelled "<TEAM> notes:".
  - **Shown only when readable alone:** they name a player, the team or "franchise".
  - **The injury report still overrules:** an Out player's lines are removed.
  - **Where they go:** the Watch List, the 3 PM Discord digest, and NBA Live's pre-game cards ("📜 FROM THE NOTES").
- **Watch List: new "History in tonight's notes" panel.** Each team's best lines, with filters by team and "new today only".

### Tested
- **Tonight's real notes (20 teams):** 644 lines, 195 naming a player. Spot-checked, e.g.:
  - "Logged his 39th career 40-point double-double … tying Michael Jordan for the seventh-most since 1973-74" (Davis);
  - "This season's Warriors are the first team to start a season 0-3 and then win their next eight games";
  - Dončić "the first player in NBA history with six consecutive games of at least 35 points, five rebounds, five assists and five 3-pointers";
  - Jerome "first player in Grizzlies history to record multiple 40-point performances within the first 10 games of a season".
- **New checks** (462 pass):
  - heading dropped and naming the player;
  - old dates → older, "since 1973-74" ignored. That check caught a real bug: Davis's line had been marked older.
  - duplicate pass kept once, named;
  - college, splice and fragment lines left out;
  - unnamed = guessed;
  - storylines: team label, 2 a game, unnamed pronoun lines and an Out player's lines left out.
- **Page sweep OK;** the panel was rendered and looked at.

### Still unproven
- **Noise:** some splices from multi-column pages still get through (e.g. a Carlisle quote run into a table row). Tune from real days.
- **Everything is "New" on the first day,** since there's no earlier memory.
- **Coverage of NBA PR-style posts:** measured weekly against the user's examples.

## 0.22.1 (2026-11-11): articles watcher posts unsigned ESPN injury news

### What changed
- **ESPN stories with no writer's name** (otherwise skipped as wire or AI game stories) now post when the headline or description is injury news, tagged "🩹 Injury". The user's choice, after "Bulls rookie Caleb Wilson leaves loss to Spurs with right hand injury" (11:24 PM) was skipped.
  - **What counts as injury news:** injury, sprain, strain, fracture, surgery, MRI, tear, concussion, sidelined, day-to-day, ruled out, will / to miss, out for / at least / indefinitely, hamstring, Achilles, ankle, knee, calf, groin, illness, returns from.
  - **Still skipped:** recaps, previews and videos, even if they mention an injury.
- **Any article with an injury headline** is tagged 🩹 Injury unless it's "Sources:" reporting.

### Tested
- **Today's real ESPN feed, unsigned items:** "Kawhi Leonard will miss at least 1 more week" now posts. Wembanyama's 40-point game story, George vs. the 76ers, and the Acuff "not a loser" piece stay skipped.
- **New checks:** 19 watcher checks; the full suite passes.
- **Deployed by the new workflow** (checks first).

## 0.22.0 (2026-11-11): the articles watcher deploys itself

### What changed
- **New `cloudflare/wrangler.toml`:** the Worker's settings.
  - Name `ncc-articles`, `main = "articles-worker.js"`, workers.dev kept.
  - The `STATE` KV binding (namespace `ncc-articles`, id 308ac0ac…; ids aren't secret).
  - The 5-minute cron.
  - **Why all of it is listed:** a deploy replaces bindings and crons with this file. The `DISCORD_WEBHOOK` secret isn't in it and survives deploys.
- **New `.github/workflows/deploy-articles.yml`:** on any push to `main` that changes `cloudflare/` (or the watcher's checks), it runs the watcher's checks and then deploys with `cloudflare/wrangler-action@v3`.
  - The Cloudflare token and account id are repository secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), given to the deploy step only.
- **The token** (created by the user 11/11): "ncc-articles-deploy", their account only, Workers permissions only, no zone access. **It expires 2027-11-11; renew before then.**
- **The watcher's checks moved to `tests/articles-worker.js`,** so they can run alone (`tests/articles-only.js`): the full suite needs the saved team notes, which aren't in the repo. `tests/run.js` still runs them.
- **New check:** the deploy settings keep the name, `STATE`, the 5-minute schedule and workers.dev, and hold no secret.
- **This deploy also ships the pending wording change** (the review page says "every 5 minutes").

### Tested
- **454 checks pass** (full suite).
- **The watcher's 17 checks pass in a bare copy of the repo** (no samples, no node_modules), as GitHub will run them.

### Still unproven
- **The first automatic deploy:** this push triggers it. Afterwards, the review page should say "every 5 minutes".

## 0.21.0 (2026-11-11): the NBA Cup final is left out of records and stats

### What changed
- **Why:** the NBA Cup championship game counts in neither the standings nor season or career stats (group games, quarterfinals and semifinals do). ESPN lists it as a regular-season game.
- **How it's spotted:** its competition type is "CC" (id 39, "Commissioner's Cup") and its note reads "NBA Cup Championship", in both the scoreboard and team schedules. `src/espn/parse.js` (`isCupFinal`, `CUP_FINAL`) gives such a game its own season type, `"cup-final"`.
- **What leaves it out:** every part that counts only regular-season games (team situations and records, milestone tracking since a team's notes, the prediction model's game logs, scoring, tonight's slate) now skips it, with no other code changes.
- **Watch List on the final's night:** it lists the final in a banner ("doesn't count in the standings or in season and career stats, so it isn't tracked here") instead of looking empty. `watch.json` gains `uncounted`.

### Tested
- **Last season's real ESPN data:** the 12/16/25 final (SAS vs NYK) is marked; the 12/13/25 semifinals still count.
- **The Spurs' 2025-26 schedule** now reads 82 regular-season games plus the final; it had been 83.
- **New checks** (453 pass):
  - the final marked, a semifinal not;
  - either signal alone marks it, a group game doesn't;
  - team schedules marked too;
  - team records skip the final and keep the semifinal.
- **Tonight's data:** builds the same as before (no Cup final yet this season); page sweep OK.

### Still unproven
- **This season's final** (December) will be the first live case.
- **NBA Live's own ladders** count whatever ESPN's box shows; that's for NBA Live's own chat if wanted.

## 0.20.1 (2026-11-11): incident: broken site data for ~2 minutes, and two guards

### What happened
- **The bad push:** the 0.20.0 push (8:54:45 PM ET) carried merge-conflict markers in 7 published data files (`clutch-players`, `games`, `leaders`, `q4-players`, `situations`, `tonight`, `trends`). Every tab but the Watch List and With / without couldn't load its data.
- **Cause:**
  - I had regenerated the data locally while testing.
  - The bot had pushed newer data meanwhile.
  - Re-applying my local changes left conflicted files.
  - `git add -A` committed them.
  - The 448 checks passed because none looked at the data files.
- **Fix at ~8:56 PM:** regenerated all data, validated every file, pushed. Checked again on GitHub: all 9 data files parse.

### What changed
- **New check:** every `docs/data/**/*.json` parses and has no `<<<<<<<` / `=======` / `>>>>>>>` lines. Confirmed: it fails on a file with conflict markers.
- **A local pre-commit guard in the cloud clone** (`.git/hooks/pre-commit`; not in the repo) refuses commits with conflict markers or JSON that doesn't parse. Confirmed: it blocks one.
- **Practice:** my commits stage only the files I changed; generated data is left to the bot's builds.

### Tested
- **449 checks pass;** page sweep OK.

## 0.20.0 (2026-11-11): the official injury report in tonight's storylines

### What changed
- **New `src/injuries/report.js`:** reads the NBA's official injury report PDF (`ak-static.cms.nba.com/referee/injury/Injury-Report_<date>_<hh>_<mm><AM|PM>.pdf`, every 15 minutes, Eastern). It's the same source as the user's IR Checker extension, which is left as it is.
  - **Slot addresses:** builds each 15-minute slot's URL.
  - **The table:** reads it by column position.
  - **Blank cells:** carries date, time, matchup and team down to the rows that leave them blank, across pages.
  - **Wrapped reasons:** rejoins reasons split above and below their row.
  - **Names:** handles "Last, First", "Udeh, Jr., Ernest" and hyphens split by a line break.
  - **Teams not in yet:** keeps "NOT YET SUBMITTED" teams.
- **New `src/injuries/impact.js`:** for each regular (18+ minutes a game over 3+ games) listed Out, Doubtful or Questionable tonight, it works out:
  - the team's record and margin without him and with him;
  - up to two teammates whose points, assists, rebounds or minutes jump in the games he missed (2+ such games);
  - or "hasn't played without him this season".
  - **Ranking:** a new absence ranks above a long one, and the game count is always shown.
  - **Matching:** players are matched to ESPN ids by name within their own team.
- **Every build now reads the newest report** (`scripts/situations.js`) and writes `docs/data/injuries.json`. If none can be read, the last one for that date stays.
- **Tonight's storylines** (Watch List, Discord digest, NBA Live pre-game cards) gain 🩹 injury lines, at most 2 a game.
  - **The report overrules other lines:** a player listed Out or Doubtful loses his milestone, streak, lead and shooting lines; a Questionable player's lines say "questionable tonight".
  - **Links:** injury lines go to the With / without page for that team.
  - **Source note:** the Watch List says which report it used.

### Tested
- **Tonight's real 8:30 PM report** (8 pages, 125 rows, 26 teams including tomorrow's games):
  - every row has a team;
  - wrapped reasons rejoined (e.g. "Right Avulsion Fracture", "Left Knee Injury Management");
  - suffix and hyphenated names right;
  - the two not-yet-submitted teams kept.
- **Matching against our data:** 74 non-G-League entries tonight; 57 matched. The 17 unmatched have no box-score line at all this season (e.g. Porzingis, Isaac, Sharpe), so there's no with/without to show for them.
- **A real conflict, fixed:** before the override, Devin Vassell (OUT) also had "2 3-pointers from 800 (54% tonight)". That line is now removed.
- **New checks** (448 pass):
  - slot URLs (12 AM / 12 PM);
  - names and short reasons;
  - a made-up two-page report with the real layout's quirks (wrapped reason, carried team, no header on page 2, suffix name, G League, not yet submitted);
  - id matching;
  - the impact line on a made-up team (record without, margin, teammate jump; bench and G League left out);
  - another night ignored;
  - the storyline override (Out removes, Questionable marks, 2 injury lines a game, other night ignored).
- **Watch List** rendered with the injury lines; full page sweep passes.

### Still unproven
- **Reading the PDF from GitHub Actions:** the first push-triggered build after this change will show it.
- **Freshness:** reports change every 15 minutes, but the site updates only with builds (3 a day, sometimes late). The Watch List says which report it used.
- **Small samples:** "without him" often rests on 1-3 games this early.

## 0.19.0 (2026-11-11): tonight's storylines on the Watch List and in NBA Live before tip-off

### What changed
- **Watch List: new "Tonight's storylines" section** under tonight's games. One card per game, up to 8 lines:
  - 🎯 milestones in reach;
  - 🔥 streaks on the line;
  - 👑 runs leading the team;
  - 🏹 shooters a make or two from 50/40/90;
  - 📈 team streaks.
  - Each line links to the tab with the details. Built in the browser by the same `src/anticipate/tonight.js` as the Discord digest (copied to `docs/lib/anticipate/`, a test keeps it identical), so the site and Discord always agree.
- **New `docs/data/tonight.json`,** written by every build (`scripts/situations.js`): each game's storylines.
- **NBA Live bridge v2** (`docs/bridge/cc-bridge.js`): before a game tips off, its top 3 storylines go to NBA Live's League Alerts as cards ("🔥 STREAK", "👑 TEAM LEADER", "🏹 50/40/90", "📈 TEAM STREAK", "🎯 IN REACH"), once per night.
  - Live games are handled exactly as before.
  - If `tonight.json` is missing or for another night, there are simply no pre-game cards.
- **`tools/check-nba-live.py`** also serves `tonight.json` and reports the bridge version and storyline count.

### Tested
- **433 checks pass.** New:
  - a pre-game game gets exactly its top 3 storylines;
  - a live game gets none of them;
  - the card's icon, text and "Pre-game" tag.
- **A real bug caught by the new check:** the `tonight.json` fetch had been placed after a `return`, so it never ran (no pre-game cards at all). Moved before the return.
- **Real NBA Live (`nba-live_14.html`) with bridge v2, 11/11 at 8 PM:** 3 games live, 7 pre-game.
  - **Pre-game:** 21 storyline cards (3 for each pre-game game, e.g. "OKC @ POR · PRE-GAME 🔥 STREAK Shai Gilgeous-Alexander: 25+ points in 6 straight games").
  - **Live:** milestone cards still fire, and NBA Live's own cards and checks are unaffected. No page errors beyond the 8 requests the test blocks on purpose.
- **Watch List page** in headless Chrome at desktop and phone width: 10 game cards, 73 lines; the full page sweep passes.

### Still unproven
- **Not in the user's NBA Live yet:** the user's current file (`Downloads/nba-live.html`) doesn't include the bridge line, so neither these cards nor the earlier ones show there.
- **League Alerts shows "Q1 0:00" on pre-game cards** (NBA Live's own rendering of a card without a clock).
- **3 cards per game** could crowd League Alerts on big nights (7 pre-game games = 21 cards); tune `PRE_PER_GAME` from use.

## 0.18.2 (2026-11-11): articles watcher: The Athletic's NBA feed only, every story posted

### What changed
- **NBA feed only:** dropped the NYT Pro Basketball feed. The user wants The Athletic's NBA feed only.
- **Every Athletic NBA story is posted,** with its publish time. Only the user's muted phrases and the 6-hour age limit apply; ESPN's skip rules (betting words, live blogs...) no longer apply to The Athletic.
- **No writer on Athletic posts:** `/peek` showed the feed carries none (title, description, link, guid, pubDate, image only), so Athletic posts can't show a writer or offer "mute writer". Muting a phrase still works.

### Found while checking the live Worker
- **The redeployed 0.18.1 code is live** (new status line, `/peek` works).
- **The 2-minute schedule isn't running:** nothing was saved between the 6:49 manual check and a 7:27 manual check, though The Athletic posted at 6:53 and ESPN at 6:54 and 7:20. The manual check found all three.
  - **Expected side effect of the 0.18.1 fix:** that 7:27 check counted as the first run, so the 6:53 Athletic story was marked "already out" instead of posted. It can be posted from the review page.
  - **To confirm (user):** the cron trigger is saved under Trigger Events.

### Tested
- **430 checks pass.** Changed: every Athletic story posts, even a "Best bets" title; a story listed twice in the feed posts once; a muted phrase still skips an Athletic story; ESPN live blogs are still skipped.

- **Wording:** the user set the schedule to every 5 minutes, so the page and the connected message no longer say "every 2 minutes" (applies at the next deploy).

### Still unproven
- **The schedule running on its own:** checked again at 8:08 PM ET.

## 0.18.1 (2026-11-11): articles watcher, fixes from the first live run

### What happened on the first live run
- **Live setup:** the user set up the Worker; `/setup` posted the connected message and private link to #articles. A manual check (`/check`, run through the review page) then read all three feeds from Cloudflare: ESPN 25 items, The Athletic 100, NYT Pro Basketball 20. So The Athletic is readable from Cloudflare (it isn't from any of our own tools).
- **Bug: 5 older articles were posted (1:40-6 PM)** where the first run should post only the last 20 minutes. `/setup` had created the stored state, and "first run" was defined as "no state yet".
- **No writer names** on Athletic items: the feed doesn't use `dc:creator` the way the parser expected.
- **Misleading status:** "last read" only changes when the state is saved (new items, or every 30 minutes), so it could look stale while working.

### What changed
- **"First run" now means no check has finished yet** (`state.started`), whatever `/setup` stored.
- **More writer fields read:** `dc:creator`, `<author>` as "email (Name)", `<author><name>`, `atom:name`, `media:credit`. A bare email is dropped.
- **Honest status line:** it says when the state was last saved, and warns if that was over 40 minutes ago (the schedule may not be running).
- **New private `/peek?src=athletic|nyt|espn`:** shows a feed's first item raw, to see its layout.

### Tested
- **The 11/11 bug as a check:** `/setup` then the first check, with a 2-hour-old and a 1-minute-old article; only the new one posts. It fails with the old rule (confirmed) and passes now.
- **Writer layouts:** "email (Name)", `<author><name>`, `dc:creator`, and a bare email dropped.
- **430 checks pass.**

### Still unproven
- **The Athletic's real writer field:** the user needs to redeploy, then `/peek` shows it.
- **The cron trigger:** not yet confirmed. The review page will warn if no save happens for 40 minutes.

## 0.18.0 (2026-11-11): articles watcher (Cloudflare Worker → Discord #articles)

### What changed
- **New `cloudflare/articles-worker.js`,** a Cloudflare Worker (free plan). Every 2 minutes it reads ESPN's NBA news API and The Athletic's NBA RSS (plus NYT Pro Basketball, deduped by URL). It posts each new article worth reading to its own Discord channel.
  - **Why not GitHub Actions:** today its schedule ran 87 minutes late once and skipped a run entirely, which is useless for 6-9 AM articles.
- **ESPN: the news API, not the RSS feed** the user linked. The RSS hadn't been rebuilt since 5:13 AM and stamped 7 of 12 items with the same time. The API gives each article's real publish time and type.
- **Kept:** reporting and analysis by named writers.
- **Skipped:**
  - recaps;
  - the automated previews;
  - videos;
  - fantasy and betting sections and titles;
  - how-to-watch pieces;
  - live blogs;
  - unsigned ESPN stories (wire and game stories);
  - non-NBA sections;
  - anything published over 6 hours ago.
- **Each post shows:**
  - a tag (🚨 Reporting for "Sources:" items, 🗞️ News, 📰 Feature, ESPN+ marked);
  - source and writer;
  - the publish time in ET, and how long until the watcher saw it.
- **Training:**
  - under each post: 👎 Noise, 🔇 Mute writer, Review;
  - the review page lists every decision (posted or skipped, and why), with ✅ Post it, ⭐ Always allow writer and phrase muting.
  - Rules change on the next check; labels are kept for tuning the built-in rules.
- **Private review page:** its key is derived from the webhook. `/setup` sends the link to the Discord channel and never shows it in the browser.
- **First run:** posts only what came out in the last 20 minutes; everything older is marked seen.
- **Free-plan budgets:**
  - a quiet run reads only the small "seen" record and writes nothing;
  - KV writes happen only for new items, plus a 30-minute heartbeat;
  - at most 10 posts a run.

### Tested
- **Today's real ESPN news (50 items), as if each had just come out:** posts 12 and skips 38.
  - **Posted** (e.g.): Shams on Markkanen, Golliver on Curry/KD, Rhim's Brown-Celtics piece, Goodwill's coaches group chat.
  - **Skipped:** every recap, preview and video, fantasy and betting pieces, a how-to-watch, and unsigned game stories.
  - **Judgment call:** "NBA awards watch" is filed under betting, so it's skipped until the writer is allowed.
- **Stand-in feeds, storage and Discord** (14 new checks, 428 pass):
  - first run posts only fresh, wanted items;
  - the same story in two feeds posts once;
  - posts say who, when and the lag;
  - RSS decoding. A real bug turned up here: escaped HTML (`&lt;p&gt;`) leaked into posts. Fixed by unescaping before stripping tags.
  - skipped items logged with reasons;
  - quiet runs write nothing; a day of quiet runs writes at most ~48 times;
  - a post Discord rejects is retried next run, once;
  - a failing feed is logged once and doesn't stop the others;
  - the review page needs the key;
  - muting a writer works;
  - "post it" sends and labels a miss;
  - `/setup` never shows the key in the browser;
  - the rules on their own.
- **CPU:** a quiet run with a full log and 400 seen articles measured ~9.7 ms in the first draft (the free plan allows 10). Splitting storage and reading 25 ESPN items brought it to ~5 ms.

- **Laptop copy:** the checks crashed there, because 0.17.1's workflow check reads `.github/workflows/daily.yml`, which the laptop copy doesn't have. It was missed because the laptop checks weren't run after 0.17.1 and 0.17.2. That check now runs only where the file exists, and the laptop is back to passing.

### Still unproven
- **Not deployed yet:** the user sets it up in the Cloudflare dashboard.
- **The Athletic feeds** can't be read from the cloud workspace, the PC's workspace or the built-in browser (nytimes.com is blocked for all three). Whether Cloudflare can read them shows on the review page after the first run.
- **The real Workers runtime** hasn't run this code. It was tested in Node 22 with the same web APIs (fetch, Request, Response, crypto.subtle, Intl).
- **CPU on Cloudflare** may differ from Node's measurement. If a run exceeds 10 ms, Cloudflare stops it, and the review page's "last read" time goes stale.

## 0.17.2 (2026-11-11): page sweep; Streaks & outliers fits a phone

### What changed
- **Fix:** on a phone, the Streaks & outliers page was wider than the screen, so the whole page scrolled sideways. The detail line under each outlier game ("17 pts, 5 reb, 5 ast, 5-10 FG in 24 min...") was set never to wrap; it now wraps.
- **New `tools/check-pages.py`:** renders all 9 page views (7 tabs, plus the 4th-quarter and defense modes) at 1,400 px and 390 px in headless Chrome. It reports:
  - script errors;
  - failed loads;
  - a "Couldn't load" message;
  - a nav without all 7 tabs;
  - anything wider than the screen that isn't inside an area built to scroll sideways.
  - Exit code 1 on any problem. Part of the audit for every change from now on.

### Tested
- **Why this came up:** the user asked whether every change is audited. Today's nav change (0.16.0) touched all 7 pages, but only 3 had been rendered; the full sweep found this bug.
- **The sweep catches the bug:** with the fix removed it reports "trends.html 390 px: wider than the screen: SPAN.luck"; with the fix, all 18 views are OK.
- **The sweep ignores intended scrolling:** a first version also flagged the Watch List's sideways-scrolling strip of tonight's games, which is by design. Areas built to scroll are now skipped, and the Watch List passes.

### Still unproven
- **Only what a browser can see:** the sweep checks layout and errors, not whether the numbers are right. The numbers are covered by `tests/run.js` and the ESPN audits.

## 0.17.1 (2026-11-11): the Discord secret lives in its own workflow step

### What changed
- **Discord posting is now its own workflow step** ("Post tonight's storylines to Discord"), after the build. Only that step receives `DISCORD_WEBHOOK`; `scripts/ci.js` no longer runs `notify.js`.
  - **Why:** before, the secret sat in the build step's environment, where npm packages (pdfjs-dist and its code) also run. Now the only code that runs with the secret is `scripts/notify.js` → `src/anticipate/tonight.js` → `src/situations/leaders.js`: our own files and Node built-ins.
  - **A failed post** can't fail the run (`continue-on-error`).
- **What already protected it:**
  - GitHub encrypts repository secrets and masks the value in logs.
  - Runs started from forks or outside pull requests never receive them.
  - This workflow only runs on schedule, manual start or a push to `main`, all of which need write access to the repo.
- **If the URL ever leaks,** someone can post messages to that one channel. They can't read it or reach the account. Fix: delete the webhook in Discord, make a new one, and replace the secret.

### Tested
- **New checks** (414 pass):
  - `notify.js` and everything it imports load no npm package. The check fails if one is added, confirmed by adding `import "pdfjs-dist"`.
  - The secret appears exactly once in the workflow, on the notify step.

### Still unproven
- **The first real post** comes from the run this push triggers.

## 0.17.0 (2026-11-11): Discord: tonight's storylines once per game day

### What changed
- **New `src/anticipate/tonight.js`:** tonight's storylines per game, from data the site already publishes (`watch.json`, `trends.json`, `leaders.json`). Up to 6 lines per game, best first. The site's "tonight" cards will use the same module.
  - **Milestones:** publishable round numbers and passes with importance 20+ and a 25%+ chance tonight. That's stricter than NBA Live's cards (15), because these go to a phone.
  - **Player streaks:** 5+ games and notable; only the biggest of a family per player (30+ points, not also 25+ and 20+).
  - **Team-lead runs:** 5+ straight games.
  - **Shooters:** qualified, one or two shots from crossing 50 / 40 / 90 either way.
  - **Team streaks:** 4+ wins or losses.
- **New `scripts/notify.js`, run by `scripts/ci.js` after every build.** It posts to Discord through the webhook in the GitHub secret `DISCORD_WEBHOOK` (`daily.yml` passes it to the build step).
  - **What it sends:** a one-time "connected" message, then tonight's storylines once per date, on the first build at or after 2 PM ET (normally the 3 PM ET build).
  - **Format:** one embed per game; split across messages to stay within Discord's limits; no @-mentions.
  - **Record:** what was sent goes in `history/discord.json` (times only), so builds don't repeat it.
  - **The URL** is read only from the environment. It's never written to a file or printed, and anything that doesn't look like a Discord webhook is refused.
  - **Never fails the build;** with no secret it logs "nothing sent".
- **Pushes that change `scripts/notify.js` or `src/anticipate/tonight.js` also trigger a build.**

### Tested
- **Today's real data:** 10 games and 57 lines. Spot-checked, e.g. "Trae Young: 7 points from 12,700 career points (92% tonight)", "Luka Doncic: 30+ points in 8 straight games", "Victor Wembanyama: has led SAS in blocks 11 straight games, every game he's played".
- **The sender, against a stand-in for Discord:**
  - **Sends:** the test message plus the digest; a rate-limit (429) reply is waited out and retried.
  - **Doesn't send:** the same date twice; anything without a secret; a non-Discord URL.
  - **Webhook deleted (404):** nothing recorded, so the next build tries again.
  - **Site data for another date:** no digest.
  - **The URL never appears in `history/`.**
- **New checks** (412 pass):
  - which milestones qualify and how they're worded;
  - streak families and minimums;
  - team streak and lead-run minimums;
  - qualified shooters only;
  - 6 lines per game, best first;
  - the digest splits within Discord's limits (10 embeds and 6,000 characters per message) with no mentions.

### Still unproven
- **No real post yet:** discord.com is blocked from the cloud workspace and the laptop's workspace. The first real post happens on GitHub once the user adds the secret.
- **A possible double post:** if a post succeeds but that run's commit then fails, the next build could post the same digest again.
- **Pre-game only:** in-game alerts need something running during games, i.e. NBA Live with the bridge.

## 0.16.1 (2026-11-11): league rank beside every number on "vs top teams"

### What changed
- **Every column now shows the team's league rank** in small grey type beside the number (e.g. `+10.3 #3`), in both the record and defense modes. The user asked for the "Own record" style (`8-3 #5`) everywhere.
  - **Direction:** #1 is always the best, matching "Best first": lower is better for defensive rating, points allowed and TOV%; "Games vs top" ranks the most games #1.
  - **Ties:** teams showing the same number share a rank. W-L columns rank by win % alone, so 2-2 and 1-1 are tied at .500.
  - **No games** against the top group means no rank.
- **Wider page:** this page is now up to 1,320 px wide (was 980) so the whole table fits on a desktop screen; phones still scroll sideways.

### Tested
- **Headless Chrome** at 1,400 px and phone width, both modes: no script errors, all 30 rows.
- **Rank order:** for "Net rtg vs top", ranks never go up as values go down, and equal values always share a rank (e.g. UTA and ATL at -5.4 are both #10 in defense mode).

### Still unproven
- Nothing new: the ranks only reorder numbers the page already showed.

## 0.16.0 (2026-11-11): Team leaders tab; "vs top teams" ranks opponents by record too

### What changed
- **"vs top defenses" is now "vs top teams"** (same address, `docs/defenses.html`).
  - **New switch:** rank opponents by **Best records** (the default) or **Best defenses**. The address remembers it (`?by=record&n=5`).
  - **Record mode:** top 3 / 4 / 5 / 8 / 10 by win %, then wins. Teams tied at the cutoff are all in, the same rule as "vs top 3/4/5" on Team situations.
    - **Columns:** own record and rank; games, W-L and win % vs the top group; W-L vs the rest; margin per game; net rating vs top and vs the rest; their difference; offensive and defensive rating; points for and against.
    - **Colour:** green / red when the net rating difference is 10+ per 100.
  - **Defense mode** is unchanged.
  - `src/situations/ratings.js`: `vsTop(lines, n, "record" | "defense")`; `ratings()` adds W-L and record rank; `offense()` adds points allowed, margin, defensive and net rating. `vsTopDefenses` still works.
- **New "Team leaders" tab** (`docs/leaders.html`, `src/situations/leaders.js`, built daily into `docs/data/leaders.json`, about 100 KB or 24 KB zipped). Stats: points, rebounds, assists, steals, blocks, 3-pointers.
  - **Most categories led:** who has his team's highest season total in the most stats, with his lead over the next player (ties marked).
  - **Team leaders, season totals:** each team's leader in each stat, sortable.
  - **Led his team, game by game:** games he had the team's most of a stat.
    - **Counting:** ties count (sole leads shown separately); only games he played count. A game where nobody on the team had any of a stat has no leader.
    - **Shown:** an "every game" badge and his current run. Sort by share, games led or run.
  - **Shooting lines (50 / 40 / 90):** who is within 1-5 points of 50% FG, 40% 3P or 90% FT.
    - **Shots away:** "can miss N in a row and stay at the line", or "needs N straight makes".
    - **Qualifying:** NBA minimums (300 FGM, 82 3PM, 125 FTM over 82 games), prorated to the team's games. "All" shows anyone with 20+ FGA / 10+ 3PA / 10+ FTA.
  - **50-40-90 watch:** players at all three lines, or within 5 points of them combined.
  - **Traded players** count with the team they played for that night. Shooting is over the whole season.
- **Navigation:** every page links Team leaders. The links wrap on narrow screens.

### Tested
- **vs top teams by record:**
  - top 3 / 4 / 5 are the same teams as Team situations;
  - every team's W-L vs those groups equals Team situations' "vs top N" for all 30 teams.
- **Against ESPN's own season totals** (athlete stats, a source independent of the box scores we add up):
  - all 131 team leaders: points, rebounds, assists, steals, blocks, threes and games played all match;
  - all 148 shooters within 3 points of a line: FG, 3P and FT makes and attempts all match.
  - Script: `data/audit/leaders-espn.py`.
- **New checks** (404 pass):
  - record rank, tie at the cutoff, W-L and net-rating difference vs the top group;
  - ties count as leading, but not as sole;
  - a missed game neither counts nor breaks the run;
  - no leader when nobody had the stat;
  - a traded player is split by team;
  - season totals, lead margin and categories;
  - the shooting math (6-10 can miss 2 and stay at 50%; 8-10 needs 10 straight makes for 90%);
  - prorated qualifiers.
- **Pages rendered in headless Chrome** at desktop and phone widths, with no script errors. The page showed the game-by-game table was too long, so it now shows 40 rows plus "Show 40 more". The 50-40-90 list dropped players 15+ points short.

### Still unproven
- **Game-by-game leads** come from the same ESPN box scores as the season totals that matched ESPN. Individual games weren't checked one by one.
- **Small samples:** early in the season many teams have played the top group only 1-3 times.

## 0.15.2 (2026-11-11): newest NBA Live picked by save time; alert cutoff 15

### What changed
- **New `tools/latest-live.py <folder>`:** brings the newest NBA Live and NBA GameFlow from a folder (normally Downloads) into the private, git-ignored `live/` folder.
  - **Picks by save time, not the number in the name:** NBA Live's numbering restarts at 0 once old versions are deleted, so `nba-live_14.html` can be older than `nba-live.html`.
  - **Copies only new content:** a file identical to one already in `live/` is skipped. Nothing is overwritten (a name clash gets `-1`, `-2`, ...) and nothing is deleted.
  - **Ignores** `wnba-live*`, `unrivaled-live*` and other near-names.
- **GameFlow 5** is now in `live/`. Its only change from 4 is wording (she/her became he/his).
- **The newest NBA Live** in Downloads (`nba-live.html`, saved Nov 10) is byte-identical to `nba-live_14.html`, which already passed the bridge test.
- **NBA Live alert cutoff 20 → 15** (`MIN_IMPORTANCE` in `docs/bridge/cc-bridge.js`). Milestones like Jarrett Allen's 4,000 defensive rebounds (18) now get cards. The user didn't pick a cutoff, so this is the "let it learn" start: 15, tuned from which cards prove worth it. On 11/11's slate it adds 5 possible cards (e.g. Collin Sexton 400 steals, 63% tonight); the 6-per-game cap is unchanged.

### Tested
- **Fake folders:** older `_14` plus newer unnumbered (the newer one is picked); a later `_0` restart (picked); Windows `(2)` names; a `wnba-live.html` newer than all (ignored); a rerun (reported "same"); an empty folder ("none found"); a name clash (saved as `-1`).
- **Real Downloads folder:** reported NBA Live "same as nba-live_14.html" and GameFlow "new". Also run on the laptop itself: same result.
- **Cutoff:** a new test (importance 18 gets a card, 14 doesn't) fails with the old 20 and passes with 15. 386 checks pass.
- **Real NBA Live + bridge, headless:** connected, 870 milestones for 11/11, no page errors beyond the 8 requests the test blocks on purpose. All games were pre-game, so no cards fired.

### Still unproven
- **Not automatic yet:** it runs when asked (or when the laptop is connected), not on a timer.
- **Whether 15 is right:** no card at 15-19 has been seen in a live game yet.

## 0.15.1 (2026-11-11): daily job no longer fails when two runs overlap

### What changed
- **The failure:** the first scheduled run (20:00 UTC, which GitHub started 87 minutes late, at 21:27) was queued behind a push-triggered run. It built fine, but its push failed: the other run had already committed the same generated files, and the rebase stopped on the clash. The site wasn't affected, because the other run had published the same data minutes earlier.
- **Fix 1:** on a clash, the job now keeps its own files (`git pull --rebase -X theirs`). Everything it commits is generated data, and its data is the newer of the two. If a rebase still fails, it is aborted before retrying.
- **Fix 2:** the job checks out the latest `main` when it starts, not the commit that was current when it was queued.
- **Fix 3:** `actions/checkout` and `actions/setup-node` move to v5 (Node 24); GitHub warned that v4's Node 20 is deprecated.

### Tested
- **The clash, reproduced in two local clones:** both changed the same file, and both added the same new file under `history/results/`. The second push now goes through with its own versions of both.
- **The workflow change itself** triggers a run on push; it is checked below.

### Still unproven
- **Scheduled runs can start late,** as seen today.

## 0.15.0 (2026-11-11): Streaks & outliers page

### What changed
- **New page, "Streaks & outliers"** (`docs/trends.html`), built daily into `docs/data/trends.json`:
  - **Outlier games:** each player's game against his other games this season, for each of the last 7 game dates. The rules are in `src/situations/trends.js`; a page filter shows above-normal only, below-normal only, or one team.
    - **Strength** = distance from his average, in units of how much his games usually vary. Each stat has a minimum spread, so a steady player's 1-point change doesn't look huge.
    - **Listed when:**
      - strength is 2.5+;
      - a regular (15+ points or 20+ minutes a game) is 2.5 below normal;
      - a game is a clear season high;
      - he shot 25 points off his usual FG% on 10+ shots;
      - or he went 0-for-6+ from three.
    - Each game shows minutes, since a short night is often injury, fouls or a blowout. Last night: Miles Bridges played 18 minutes against his 31.7 average; Domantas Sabonis scored 0 against his 15.3 average.
  - **Active player streaks:**
    - 10+, 20+, 25+ and 30+ points;
    - 10+ rebounds; 8+ assists; double-doubles;
    - made a three; 3+ threes.
    - Streaks count games played (missed games don't break them), this season only.
    - "Most notable" weights length by difficulty (30+ points 3x, 10+ points 0.4x); "Longest" is plain length.
  - **Team streaks:** overall, home and road W/L; scored 120+ in a row; held under 110 in a row.
- **Link** added to every page's navigation.

### Tested
- **Spot checks against the game lines:** Luka Doncic has 8 straight 30-point games (10/25 to 11/9; he missed 2 Lakers games in that span), and Karl-Anthony Towns has 10 straight double-doubles (every game).
- **5 new checks:**
  - a DNP isn't a game played and doesn't break a streak;
  - each streak kind's minimum length;
  - a single 10-rebound game isn't a streak;
  - a 50-point season high is listed and an ordinary game isn't;
  - team W/L, home and road streaks.
- Page rendered in a browser. 385 checks pass.

### Still unproven
- **Outliers for past dates** compare against all his other games, including later ones; for the latest date, every other game is earlier.
- **Streaks that started last season** show only their this-season part.
- **The weights and thresholds are judgment calls,** to tune with use.

## 0.14.0 (2026-11-11): 4th-quarter stats, "With / without" page, player game lines

### What changed
- **Every player's box line from every game** (ESPN summary, read once per game) is now stored:
  - starter, minutes, points, FG/3P/FT made-attempted, rebounds (offensive and defensive), assists, turnovers, steals, blocks, fouls, +/-;
  - players listed but not used get 0 minutes.
- **4th-quarter player and team stats.** These use the same play-by-play pass as clutch time (`windowPlayers` in `src/espn/pbp.js`), over all of period 4 at any score.
  - The **Clutch page has a Clutch time / 4th quarter switch** (`clutch.html?mode=q4` links straight to it).
  - Team rows show 4th quarters won and lost, 4th-quarter +/- (from quarter scores), and shooting.
- **New page, "With / without"** (`docs/players.html`): pick a team and a player to see the team's record and average margin in games he played and games he missed. Each teammate's per-game averages, with and without him, cover minutes, points, rebounds, assists, FGA, FG%, 3PM, FTA, turnovers and +/-.
  - Columns sort by biggest rise or biggest drop.
  - "Without" counts games he didn't play since his first game listed with the team.
  - The math is in `src/situations/withwithout.js`, with a browser copy in `docs/lib`.
- **Team clutch / 4th-quarter totals are summed game by game.** Before, they were summed from players' season totals, which credited a traded player's points to his new team: OKC and SAC were off by 9.
- **Storage:**
  - Results now live in `history/results/` (one file per date, plus `meta.json`) instead of a single `history/results.json`. A finished date never changes, so daily commits add a file instead of rewriting the season.
  - Player lines go to `docs/data/teams/<TEAM>.json`, one per team, rewritten only when that team has played.
  - The old single file is migrated automatically on the first run.

### Tested
- **4th-quarter player points add up to the quarter score** in all 160 games, and team totals match quarter scores for all 30 teams.
- **Player box points add up to the final score** (checked on PHI at CHI).
- **10 new checks:**
  - player box reading: minutes, made-attempted pairs, signed +/-, DNP;
  - the 4th-quarter window: all of period 4, any score, seconds through a substitution;
  - team totals per game;
  - with/without: games, record, margin, teammate averages, games before a player's first listing, roster order and games missed;
  - results store: round trip, unchanged files not rewritten.
- Pages rendered in a browser.
- 380 checks pass; snapshots unchanged.

### Still unproven
- **4th-quarter minutes and +/-** use the same inferred lineups as clutch: approximate.
- **"Without" can't tell injured, rested and suspended apart**, and before his first listing a player isn't counted as missing.
- **The PC copy was not synced in this session**, because the link to the PC was unavailable.

## 0.13.0 (2026-11-11): Clutch tab (teams and players), clutch numbers checked against NBA.com

### What changed
- **New page, "Clutch" (`docs/clutch.html`):**
  - **Teams:** clutch W-L, games, +/-, points, FG%, 3P%, FT%, FTA, turnovers and assists.
  - **Players:** GP, minutes, points, FG / 3P / FT made-attempted and %, rebounds, assists, turnovers, steals, blocks, +/-.
    - Filter by team, name and minimum games.
    - Every column sorts, best or worst first.
- **Clutch scoring fix.** The running score is now rebuilt from scoring plays (team and points), instead of each play's score fields.
  - ESPN's play scores in Minnesota at Cleveland (10/26, overtime) jumped back and forth (113-116, 113-113, 113-116...). That had produced 55 "clutch points" for Cleveland.
  - A game whose rebuilt score doesn't end at the final score is not counted until it does. None so far.
- **`src/espn/pbp.js`:** clutch-time player lines from the play-by-play.
  - **Shots:** made or missed, 2 or 3 points, with the assist and the block.
  - **Free throws, rebounds, turnovers with the steal.**
  - **Seconds on court and +/-:** who is on court is inferred, because ESPN lists starters only for the opening tip. A player is on court at the start of a period if his first event in it isn't checking in; substitutions then move players on and off.
  - **Lineup check:** when a team doesn't have exactly 5 on court in clutch time, the game is marked, and the page puts * next to players with such games (2 of 70 games so far).
- **`src/situations/clutch.js`:** season totals per player. Lines are kept per game in `history/results.json` (`cp`), with names in `names`. The file grew to 87 KB.

### Tested
- **Against NBA.com's team clutch stats** (2026-11-11, read in the built-in browser): W-L matches for all 30 teams, and +/- matches for all 30 after the fix (11 differed before it).
- **Team clutch points** (LAL 71, PHI 79, BOS 52, NOP 86, SAC 8, UTA 55) match NBA.com.
- **Player spot checks vs NBA.com:** Ty Jerome, Tyrese Maxey, Zion Williamson, Cooper Flagg, Nickeil Alexander-Walker, Stephen Curry and Luka Doncic match in points, FG, 3P, FT, rebounds, assists, turnovers, steals, blocks and +/-. Tatum's +/- is 6 here vs 7 there.
- **Minutes run 0.1 to 0.7 a player under NBA.com's.** For example, Maxey has 22.1 here and 22.9 there.
- **5 new checks, from a synthetic game:**
  - each kind of event, counted only in clutch time;
  - seconds through a substitution;
  - +/- for whoever is on court;
  - season totals.
- **Updated:** the PHI at CHI 14-6 test, which now uses scoring plays.
- **New:** play-by-play that doesn't add up to the final is rejected.
- 370 checks pass.

- **Full player-by-player comparison with NBA.com** (run in the built-in browser right after this release). 302 of NBA.com's 304 players are found here; the other 2 have 0 minutes and no stats.

  | Stat | Players that differ |
  |---|---|
  | Points, FG made, 3P made, FT made, FT attempts, assists, blocks | 0 |
  | FG attempts | 8, by 1 |
  | 3P attempts | 6, by 1 |
  | Rebounds | 6, by 1 |
  | Turnovers | 2 |
  | Steals | 3 |
  | Games played | 6, all lower here: players on court in clutch time who never show up in a play |
  | +/- | 34, nearly all by 1: free throws around substitutions |
  | Minutes | 0.25 lower on average; 181 players within 0.25, the worst 5.6 |

### Still unproven
- **Minutes, games played and +/-** depend on the on-court guess: a player who goes a whole period without an event is missed. The page footer says these are approximate.
- **The handful of 1-shot / 1-rebound differences** aren't traced yet. They could be ESPN play typing, or shots NBA.com files differently.

## 0.12.0 (2026-11-11): clutch and top-team records, "vs top defenses" page, best/worst sorting

### What changed
- **Team situations, new records:**
  - **Clutch games:** within 5 points at some point in the last 5 minutes of the 4th quarter or overtime, the NBA's definition.
  - **Clutch +/-:** points scored minus allowed in those minutes.
  - **vs top-3, top-4 and top-5 records:** by win % today. Teams tied at a cutoff are all included (today the top 5 is 8 teams, four of them tied at 8-3), and the page footer lists who is in each group.
  - Matchup cards gain "vs top-5 records", "Clutch games" and "Clutch +/-".
- **Colour rule is now fixed**, the same for every team on every day:
  - **Green / red:** luck would explain the record less than 1 time in 10 for a team with that record.
  - **Bold and underlined:** less than 1 in 100, over at least 4 games.
  - Before, colour meant "in today's top-12 list", so two equally odd records could differ (Memphis' 5-0 road record was green, the Spurs' wasn't).
  - A key above the tables explains the colours. Hovering a record shows the expected wins and the luck odds.
- **Sorting:** any column sorts. Click it again (or use Best first / Worst first) to flip; teams with no games in that spot always go last.
- **New page: "vs top defenses"** (`docs/defenses.html`). It shows each team's offense against the best defenses (pick the top 3, 5, 8 or 10), and against everyone else:
  - W-L;
  - offensive rating and the difference;
  - points per game, eFG%, 3P%, TOV%, OREB%, FT rate.

  It is computed in the browser from `docs/data/games.json`, using `docs/lib/situations/ratings.js` (identical to `src`; a test checks).
- **Data:** each finished game's ESPN summary is read once and reduced to team box totals and clutch-time points (about 300 bytes kept of about 450 KB).
  - The reduced data is stored in `history/results.json`.
  - A summary whose box doesn't add up to the final score is rejected and retried on the next run.

### Tested
- All 160 games so far:
  - Every box total adds up to the final score.
  - 70 games had clutch time.
  - No game that went to overtime is non-clutch, and no non-clutch game ended within 5.
- Philadelphia 127-121 at Chicago (11/8), checked play by play: clutch time starts at 4:47, and the score was 14-6 Philadelphia in those minutes. It is a test now.
- **14 new checks:**
  - game clock;
  - no clutch time when the game was never within 5, or was close only before the last 5 minutes;
  - box totals and points;
  - a mismatched box is rejected;
  - top-3 with a tie at the cutoff;
  - record vs top 3;
  - possessions (worked by hand: 86.6 and 91.6 average to 89.1);
  - ratings and defense ranks;
  - eFG% and OREB%;
  - a top defense has no "vs top" games against itself.
- Both pages rendered in a browser. 362 checks pass; snapshots unchanged.

### Still unproven
- **Possessions are an estimate** from box scores. NBA.com's own ratings, which count possessions from play-by-play, will differ slightly.
- **Small samples:** early in the season most teams have played only 1 to 6 games against the top defenses.
- **The NBA Cup final** is still not excluded (December).
- **Player clutch and 4th-quarter stats** are not built yet. They need player-level play-by-play.

## 0.11.1 (2026-11-11): table alignment

### What changed
- **Team situations, matchup cards:**
  - Fixed column widths.
  - Team headers in bold and centred over their records.
  - Records and league rates centred.
  - Streak and last 10 on separate rows.
  - The "League" column no longer clips on phones.
- **Both pages:** number-column headers now right-align with their numbers. Before, headers were left-aligned over right-aligned numbers.

### Tested
- Rendered in headless Chrome at desktop width (light) and phone width (dark), for both pages.
- 348 checks pass.

### Still unproven
- Nothing new: only page styling changed.

## 0.11.0 (2026-11-11): Team situations tab

### What changed
- **New page, `docs/situations.html`** ("Team situations"), linked from the Watch List header. It shows:
  - **Tonight's matchups:** both teams side by side, plus the league rate for each situation:
    - overall, home, road;
    - vs teams over .500;
    - games decided by 3 or fewer;
    - trailing at half, trailing after 3, leading after 3;
    - streak and last 10.
  - **Most unusual records:** the 12 records furthest from what a team that good usually does, each with its chance of happening by luck.
  - **All teams:** every team, sortable by any situation, with the league rate underneath. It adds vs .500 or below, overtime, and leading at half.
- **`src/situations/results.js`:** one compact row per finished regular-season game (final score, points by quarter, overtime, neutral site).
  - Rows come from ESPN's daily scoreboard: one request per date, not one per game.
  - They are kept in `history/results.json` (20 KB so far), so each run only asks for new dates.
  - A date with an unfinished game is asked again, unless it is 3 or more days old (postponed).
- **`src/situations/records.js`:** the records, league baselines, and what's unusual.
  - **Expected** is the league rate in that situation, adjusted for the team's record on the log-odds scale (record padded with 5-5).
  - Without that adjustment, a 1-10 team losing every 10-point game would look unusual; it's just a bad team.
  - **Flagged** means luck would produce a record that far off 1 time in 100 or less, over at least 4 games. That's 1%, not 5%: with 30 teams and 13 situations, a 5% bar would flag about 20 records by chance alone.
- **`scripts/situations.js`** builds `docs/data/situations.json`. The daily build runs it after the Watch List. If it fails, the Watch List still publishes and the last situations stay up.
- **ESPN scoreboard reader:** now also keeps final scores, points by quarter, number of periods, neutral site and the season calendar. Existing fields are unchanged.

### Tested
- **Against ESPN:** all 30 teams' records match ESPN's standings exactly (160 games through 11/10).
- **Arithmetic:** every game's quarter scores add up to its final score, and each game has 4 periods plus overtimes.
- **Totals add up for every team:**
  - leading + tied + trailing at half = games played, and the same after 3;
  - vs over .500 + vs .500 or below = games played;
  - home + road ≤ games played (neutral sites excluded).
- **13 new checks**, built from synthetic games:
  - halftime and after-3 margins;
  - ties at half;
  - overtime;
  - neutral sites;
  - the opponent's record now;
  - streak and last 10;
  - baselines from both sides of each game;
  - only unfinished dates are asked for again;
  - postponed dates;
  - a bad team's big losses aren't flagged;
  - a 6-0 record when trailing after 3 is flagged and ranked first.
- **In a browser:** the page was rendered headless and looked at.
- **Daily build:** `ci.js build` runs it, including the protective path that kept the published data.
- 348 checks pass; snapshots unchanged.

### Still unproven
- **The NBA Cup final is a regular-season game on ESPN but doesn't count in the standings.** It isn't excluded yet, so check before December.
- **"Over .500" uses records today, not at the time of the game.** That's the common convention.
- **The flag bar is still a judgment call.** Early in the season, nothing reaches 1%; the "most unusual" list shows the closest.
- **Not built yet:** clutch and 4th-quarter player stats (need play-by-play); stats without a teammate; anomaly search.

## 0.10.0 (2026-11-11): daily updates on GitHub, no PC or chat needed

### What changed
- **`.github/workflows/daily.yml`** runs on GitHub's servers, free for a public repository. All times are UTC; Eastern is 5 hours earlier in winter and 4 in summer.
  - Builds the slate at 15:30, 20:00 and 22:30 (10:30 AM, 3 PM and 5:30 PM ET in winter).
  - Scores the previous night at 08:30, then again at 12:00 in case a late game hadn't finished.
  - Commits only `docs/data`, `docs/lib` and `history/`.
  - It can also be run by hand from the repository's Actions tab, as build or score, with a date.
- **`scripts/ci.js`** holds the job's logic, so it runs the same anywhere.
  - **`build`**: runs `tonight.js` and keeps the predictions as `history/predictions-<date>.json.gz` (about 27 KB a night).
    - **Protects good data:** if a build read fewer teams' notes than the one already published for that date, the published data is kept. A blocked or failing download can't blank the site.
    - If the build itself fails, nothing is written.
  - **`score`**: restores that night's predictions and runs `score.js`. It keeps `history/calibration.jsonl` (one line per night) and `history/score-<date>.txt` (the full hit/miss list).
- **`history/`** is seeded with 11/9 and 11/10, so the record runs from the start.

### Tested (locally, the same commands the job runs)
- `ci.js score --date 2026-11-10` reproduces the night: 26 calls, 9 hits, 12.5 expected. Only the 11/10 line's timestamp changed.
- A date with no saved predictions exits cleanly with nothing to do.
- `ci.js build` for 2026-11-11: 20 teams, notes read for all 20, 919 milestones; predictions saved.
- **Guard:** all notes downloads blocked, with no cached copies. The build read 0 teams, so the published data (20 teams) was kept byte for byte, and the predictions were not overwritten.

### Still unproven
- **Whether NBA.com and ESPN answer GitHub's servers.** If they don't, the guard keeps the last good data and the job log says so. The workflow's first run (triggered by this push) is the test.
- **Whether the bot's pushes trigger a GitHub Pages refresh.**
- **Scheduled runs can start late** when GitHub is busy.
- **Repository tests are not run in the job**, because test fixtures (`samples/`) aren't in the repository.

## 0.9.1 (2026-11-10): no duplicate rows for initial-only names

### What changed
- **ESPN-only discovery now recognises a notes milestone by the player's ESPN id**, not by name text.
  - Boston's grid writes "J. Tatum". The name check didn't match "Jayson Tatum", so the site listed his 5,000 field goals twice: once from the notes and once "from ESPN only".
  - Name matching is still used when the tracker found no ESPN id.
- **Notes milestones show ESPN's full spelling** once the tracker has matched the player ("J. Tatum" becomes "Jayson Tatum"; "Lamelo Ball" becomes ESPN's spelling). The notes' own spelling is kept as `notesName`.

### Tested
- 335 checks pass. New: discovery skips a notes item written with an initial when the ESPN id matches, and still finds the milestone when the notes don't have it.
- Tonight's site was rebuilt (12 teams, 453 milestones), with 0 notes/ESPN duplicates; the one before was Tatum.

### Still unproven
- A notes item whose player the tracker couldn't match has no ESPN id, so it still relies on the name match.

## 0.9.0 (2026-11-10): eight more teams' milestone layouts

### What changed

- **Five new readers in `src/notes/formats/`**, each learned from that team's notes and checked by hand against the PDF:
  - `column-table.js`: tables with a header row. Milwaukee (Player | Category | Current # | Milestone # | Needs), Philadelphia (PLAYER | MILESTONE | NEEDED) and Indiana (PLAYER | MILESTONE | NEEDS/ACCOMPLISHED).
    - Cells go to the nearest header column. Text far from every column is ignored, such as Indiana's prose column beside the table.
    - A row without a name belongs to the player above it.
    - "Accomplished" rows are skipped.
    - A cell wrapped over several lines is read whole (Embiid's three-line row).
    - "1,116 Career Offensive Rebounds (7th all-time in Franchise History)" becomes a rank chase. Who is passed isn't printed there.
  - `needs-rows.js`: Orlando's player blocks.
    - "Needs 22 three-pointers to reach 400" sits under NEXT CAREER MILESTONE.
    - "Needs 346 field goals for 10th all-time (Scott: 2,421)" sits under MAGIC ALL-TIME LIST.
    - The current total in the left column is checked against both: current + need must equal the target, or the passed total + 1.
  - `progress-cards.js`: Brooklyn's two-column "% COMPLETE" cards under letter-spaced headings.
    - The printed percent must agree with current / target. That catches a total paired with the wrong card.
  - `bio-for.js`: Minnesota's player pages ("…78 FGM FOR 2000" under UPCOMING/RECENT MILESTONES). Recent ones, which carry a date, are skipped.
  - `needs-sentence.js`: Dallas's "needs 12 assists (988) to reach 1,000 career assists" and Houston's "needs 816 points to pass Kobe Bryant for 4th on the all-time scoring list".
- **The PDF reader drops a page's drop-shadow copy.**
  - Dallas's player pages draw every word twice, which read as "STLSSTLS" and "6.16.1".
  - The copy is found as the page's runs repeated in the same order, slightly shifted. It must cover at least 30% of the page with 95% matching.
  - In all 30 teams' notes, only Dallas's 18 player pages qualify. Every other page is unchanged.
- **Opponent fix:** a team's own name must be a whole word. Brooklyn ("nets") was being read as playing Charlotte ("Hornets"). It now reads @ Dallas.
- **New check, two totals:** one player, stat and scope must imply one current total.
  - Indiana lists under Zubac both 7,000 rebounds (6,671 now) and 6,000 rebounds (5,294 now). Both are flagged.
  - ESPN has 5,297, so the 7,000 row belongs to someone else.
- **Merging:** a rank-only chase merges with the leaderboard row that has the same target. Philadelphia's "12,092 Career Assists (3rd all-time)" is LeBron passing Jason Kidd (12,091). That match confirms the printed number is the passed total + 1.
- **Tracker: a notes page not updated for the last game or two.**
  - Brooklyn's 11/8 cards (a back-to-back) were short by exactly each player's 11/7 line. Minnesota's bio pages were short by exactly the 11/6 line.
  - These are marked "corrected", but only when at least 3 differences on the same page, and at least 60% of them, are explained by the same number of missed games. A single match is treated as coincidence, and anything else on the page still disagrees.
- **Stats:** field-goal attempts, free-throw attempts and personal fouls are read; "OFF REB" / "DEF REB" / "minutes played" are understood.
  - They get a low importance weight (0.10 to 0.15), so they never reach the alert threshold.
  - Boston, Chicago, New Orleans and Sacramento now keep FGA/FTA rows they used to drop.
- **Site:** a rank-only pass shows "No. 7" when the notes name no player.

### Found on 2026-11-10 (ESPN cross-check)

- **ORL:** 86 milestones; 83 of 85 checked agree. One printed need is off by one: Banchero 907 attempts vs 908, flagged.
- **BKN:** 30 cards; 28 agree, 19 of them after the stale-page correction.
- **MIN:** 60; 46 of 54 agree, 21 after correction. Jaylen Clark's notes are 1 to 10 higher than ESPN in four stats.
- **PHI:** 21; 17 of 17 agree.
- **IND:** 20; 16 agree. The disagreements are Haliburton threes −6, McConnell Pacers points −10, Nesmith points −4, and the misattributed Zubac row.
- **MIL:** 8, 7 agree. **DAL:** 3 of 3. **HOU:** one pass (Durant/Kobe). It can't be checked yet because no total is printed.

### Tested

- 334 facts and checks pass, 42 new:
  - hand-read facts for all 8 layouts;
  - the shadow layer on the real Dallas page and on synthetic pages (a page without one is untouched);
  - the stale-page correction, plus its two guards (an unexplained row; fewer than 3 matches);
  - the opponent fix.
- **Snapshots:** the six hand-checked teams' snapshots are unchanged, and new ones were saved for MIL, ORL, PHI, IND, BKN, MIN, DAL and HOU.
- **30-team audit:** re-run on the saved notes. Counts changed only for these 8 teams and for BOS/CHI/NOP/SAC (the FGA/FTA rows).

### Still unproven

- **None of the 8 layouts is in VERIFIED_FORMATS yet.** Until they are, only round numbers that ESPN confirms are publishable for them.
- **The stale-page rule looks back at most 3 games**, and only for totals that are short (never ones that are ahead).
- **Rank-only passes** (Embiid's 7th) don't name who is passed, so the tracker can't move that player's total.
- **Bio names come from capitals** ("Donte Divincenzo", "Lamelo Ball"), not ESPN's spelling.

## 0.8.0 (2026-11-10): Boston's notes readable; notes still on last season's totals

### What changed

- **New `src/notes/pdf-repair.js`. It repairs PDFs whose fonts have broken ToUnicode maps.** Boston's notes (made by macOS Quartz) map every glyph to its own number, so text read "%26721 &(/7,&6" for "BOSTON CELTICS". pdf.js also turns some of those codes into spaces, losing "(", ")" and "'".
  - The fix is a standard PDF incremental update. Corrected maps, built from each font's own embedded TrueType cmap, are appended after the original bytes with a new xref section. No original byte changes.
  - It acts only when both conditions are proven for a font: its map is at least 80% identity, and the font's own table disagrees on at least 80% of codes. Otherwise the very same Buffer is returned. It never throws.
  - `readPdf` runs it first and reports `repairedFonts`.
- **New format, `formats/needs-grid.js`:** Boston's "Upcoming player milestones" grid. Each row has, per stat, Target · N (needs) · DA (date acquired).
  - A triple with N and no date is upcoming.
  - A date means the mark was already reached, so it is skipped.
  - A row must have exactly 3 entries per stat, or it is skipped and reported.
- **Tracker: notes that were never updated this season.** When the notes' figure plus the player's current-season total equals ESPN's career total exactly, the item is marked **corrected** (not disputed) and uses the up-to-date total.
  - Boston's second grid: **28 of 29** differences were exactly the player's 2026-27 total.
  - Pritchard needs 6 threes for 900, not 27.
  - Garza (300 offensive rebounds) and Queta (400) already passed their marks this season; they are shown as passed, not predicted.
  - Corrected round numbers are publishable, like confirmed ones.
- **The BOS front page** gives the date and opponent (11/10 vs PHI).

### Found on 2026-11-10

- **BOS:** 82 notes milestones; 53 confirmed, 28 corrected, 1 genuine disagreement (Conley's rebounds, +1). 81 publishable.
- **UTA** (updated notes, layout not hand-checked): 74 of 74 totals confirmed by ESPN, so the parser reads Utah correctly.
- **SAC** (updated notes, not hand-checked): 52 confirmed and 3 disagreements, all review. Its milestone table still lists players who have left (DeRozan, Westbrook, Schröder, Šarić…). Those 69 items can't be confirmed and stay unpublished.

### Tested

- 292 facts and checks pass, 18 new:
  - the repair fixes Boston's 4 fonts by appending only;
  - all 33 other sample notes are left exactly as they are;
  - Boston's date and opponent;
  - 8 grid facts checked by hand against the PDF (Tatum 14,400 points needs 24; 2,400 assists needs 2; 400 blocks needs 8; 1,600 threes needs 7; White 7,800 points needs 5; Scheierman 600 needs 1; Conley 6,800 assists needs 16; Pritchard 900 threes needs 27 as printed);
  - reached marks are skipped;
  - all rows are complete;
  - "corrected" for Pritchard and Garza, while Conley stays disputed.
- **Snapshots of the six hand-checked teams are unchanged.**

### Still unproven

- **The repair has only been seen on one producer's PDFs** (macOS Quartz, Identity-H TrueType). Other kinds of broken maps (Type1 fonts, CIDToGIDMap streams, xref-stream PDFs) are left alone, not repaired.
- **The "last season's totals" rule needs an exact match.** A section updated partway through this season isn't detected, so it remains a disagreement.

## 0.7.0 (2026-11-10): NBA.com lineups and transactions

Two NBA.com static files answer servers, unlike `stats.nba.com/stats/...` and `cdn.nba.com` (checked 2026-11-10; found via the user's Reddit link):
- `stats.nba.com/js/data/leaders/00_daily_lineups_YYYYMMDD.json`: tonight's starting fives, with each player's status and NBA ID.
- `stats.nba.com/js/data/playermovement/NBA_Player_Movement.json`: every trade, waiver and signing since 2015 (10,139 rows).

### What changed

- **New `src/nba/movement.js`** (pure, browser-safe) and **`src/nba/static.js`** (cached client: never throws, saved copy if offline, transactions trimmed to the fields read).
  - `standing(log, player, team)`: "left" (traded elsewhere or waived), "with" (signed or acquired) or no evidence.
  - Slugs keep nba.com's suffixes ("jabari-smith-jr", "ernest-udeh,-jr").
- **Tracker:** a player missing from ESPN's roster is checked against the log.
  - LaMelo Ball: "traded to MIN on 2026-07-10". Miles Bridges: "traded to PHX on 2026-07-13". Both are franchise chases that are no longer live, and the review reason now names the transaction.
  - Nae'Qwan Tomlin: the log still has him signed by CLE, so his chase stays live (two-way / G League?) instead of being called gone.
  - Every matched player gets an NBA ID, for NBA Live's league feed.
- **Tonight's chances:**
  - A listed starter is at least 95% to play, unless ESPN has him Out; a conflict note says so.
  - A games-started milestone uses tonight's lineup: 98% if confirmed, 85% if expected, 2% if the lineups are confirmed without him. Otherwise it uses his history.
- **Page:** a "starting · expected / confirmed" chip.
- **The website code is split so it never pulls in Node-only modules.** The tracker now imports `nba/movement.js`, not the client, and a new test follows the page's whole import graph to enforce it. Caught before publishing: the first version would have broken the page's live countdowns.

### Tested

- 274 facts and checks pass, 16 new. On the frozen 2026-11-10 NBA.com files:
  - the transaction order;
  - Ball (left CHA for MIN on 07-10);
  - Bridges (left CHA, with PHX);
  - Tomlin (with CLE);
  - slug suffixes and accents;
  - an unknown player is "no evidence", not "left";
  - NYK's five with NBA IDs;
  - the tracker wording "traded to MIN on 2026-07-10";
  - every matched player has an NBA ID;
  - the lineup decides a games-started milestone (98% / 2% / history);
  - browser safety for every module the page imports.
- **Live build for 2026-11-10:** 27 milestones, 25 with NBA IDs, 19 belonging to listed starters.

### Still unproven

- **Lineup status:** only "Expected" has been seen so far. "Confirmed" is assumed to appear near tip, as the field implies; confirm tonight.
- **The transaction log can lag or disagree with ESPN.** It is used as evidence, and both are shown.
- **Players without a transaction row** (some undrafted or two-way players) get no NBA ID from the log. NBA IDs for starters also come from the lineups.

## 0.6.0 (2026-11-10): the NBA Live bridge

NBA Live (the user's live tracker, `nba-live_14.html`) stays on the user's PC and is developed where it is now. The decision, made 2026-11-10: it is never published, because the repo is public and the file holds the user's relay address. It is kept in the git-ignored `live/` folder. The Command Center reaches it through one script.

### What changed

- **New `docs/bridge/cc-bridge.js`** (served at `https://campgambino.github.io/nba-command-center/bridge/cc-bridge.js`). NBA Live adds one line before `</body>`:
  `<script src="https://campgambino.github.io/nba-command-center/bridge/cc-bridge.js"></script>`

  It loads the Watch List and wraps NBA Live's `runAlertChecks()`. NBA Live's own checks run first; the bridge's checks run after and are caught, so they can't break NBA Live. Cards go out through NBA Live's own `fireStory()`. It fires only for what NBA Live doesn't already cover:
  - **notes chases and passes:** franchise and NBA history, and stats outside NBA Live's `MILESTONE_LADDERS`;
  - **a "COUNT CHECK" card** when the team's notes and ESPN disagree on a total NBA Live's ladder is chasing (NBA Live uses ESPN's count);
  - **never** NBA Live's own ladder rungs, and never ESPN-only finds.
- **Editorial gate, in NBA Live's spirit** ("a rung nobody celebrates produces a card nobody wants"):
  - live games only, and a player who has played;
  - 10%+ pre-game chance, unless the milestone was reached tonight (a surprise always shows);
  - importance 20+ for round numbers, reached or not (passes are exempt);
  - at most 6 in-play cards per game, best first;
  - a final game shows only what fell in it.
- **Safety:**
  - if NBA Live lacks `fireStory` / `runAlertChecks` / `GAMES`, a small note says "not connected" and nothing else happens;
  - a Watch List for another night than NBA Live is showing is not used;
  - `?cc=off` disables it, and `?cc=<url>` points it elsewhere;
  - the all-is-well note fades after 8 seconds, while problem notes stay.
- **New `tools/check-nba-live.py`.** Re-tests any NBA Live version with the bridge in headless Chrome, optionally replaying a finished game as live. Run it on every new NBA Live version the user brings.
- **ESPN-only discovery uses the user's NBA Live bar:** points from 10,000, threes from 1,000 by 500, rebounds from 5,000, assists from 3,000, steals and blocks from 1,000, games from 1,000. "100 career games" finds are gone.
- **Date reader:**
  - weekday dates without a year take it from the season printed in the notes (SAC, POR);
  - "7,2026" with no space (OKC);
  - "Tuesday , Nov. 10" with a space before the comma (MIL);
  - "NOVEMBER 10, 2026 *7:30" (NYK).
- **Month names must be real names or abbreviations** ("Marcus" no longer reads as March).

### Tested

- 258 facts and checks pass.
  - **14 bridge checks run against a stand-in NBA Live:** NBA Live's own checks still run once; each gate rule; the 6-card cap; wrong night; missing hooks never throw.
  - **3 discovery checks.**
  - **16 date and opponent checks** on the 2026-11-10 notes.
- **The real `nba-live_14.html` in headless Chrome,** with last night's LAL@ATL replayed as live:
  - the bridge connected;
  - **6 Command Center cards among NBA Live's 29.** Before the gate there were 227, which is why the gate exists. They were: Dončić passing Nash (pre-game 93%), Curry passing DeRozan (review), Harper 1,000, Sion James 500 (review, count differs), Mamukelashvili 2,000 (a 1% surprise), and Dončić 1 50-point game from Mikan;
  - NBA Live's own cards were unchanged;
  - no page errors from the bridge;
  - a wrong-night run, a run without the hooks, and `?cc=off` all behave as described.
- **The 2026-11-10 Watch List was built.** The builder correctly flags PHX (yesterday's notes, a back-to-back) and OKC (notes from 11/7) as stale.

### Still unproven

- **The bridge in a real live game** (tonight is the first).
- **The bridge on NBA Live versions other than 14.** Use `tools/check-nba-live.py` on each.
- **Boston's notes can't be read.** Their font scrambles every character by a fixed shift ("127(6" is "NOTES"). The fix is a decoding step, not yet built.
- **Most of 2026-11-10's teams use notes layouts the parser doesn't read yet:** 27 milestones across 12 teams.
- **The importance gate of 20 drops some notes items** that teams highlight, like Jarrett Allen's 4,000 defensive rebounds (importance 18). It is a setting, open to tuning.

## 0.5.0 (2026-11-09): tonight's whole slate, automatically

### What changed

- **New `scripts/tonight.js`.** Reads ESPN's scoreboard for the day, downloads every playing team's notes from nba.com, checks that each is tonight's (current / stale / conflict / unknown date), and builds the site. On 2026-11-09: 8 games, 16 teams, all 16 sets of notes current.
- **New `src/site/build.js`,** shared by `publish.js` and `tonight.js`.
  - The site data now lists the day's games (away @ home), and each team's notes status.
  - Stale or conflicting notes are shown in a banner. They are still used, and their totals are rolled forward.
- **New `src/registry/discover.js`.** Milestones straight from ESPN: every rostered player within about 3 games of a round career number. These are marked **from ESPN only** and held for review, because ESPN's counts can differ from NBA.com's by a few. Where the notes have the same milestone, the notes' version is used.
- **Unchecked notes layouts.** `VERIFIED_FORMATS` lists the six teams whose layouts were hand-checked (CLE, LAL, SAS, PHX, ATL, CHA). For other teams, only round-number milestones whose total ESPN confirms are publishable. Passes stay review, because the passed player's total comes from an unchecked reading. Example: Golden State's "Curry 9 points from passing DeRozan" is shown as review.
- **Date reader:** two new forms, Denver's "VS. HOU - 11/9/26" and Indiana's "November 9, 2026 — Arena" (the latter is used only if nothing stronger is found).
- **Opponent reader:** team codes are read ("VS. HOU"; also GS, NO, NY, SA, UTAH, WSH and others).
- **Notes downloader:**
  - It re-reads a stored copy whose date was never found, including when the site answers "not modified" (it used to keep the first, dateless reading forever).
- **Page:**
  - the full slate of games;
  - a notes-status banner;
  - live polling per game, shared by both teams;
  - a "from ESPN only" chip, and "ESPN ✓" where ESPN confirms a total.

### Tested

- 223 facts and checks pass, 21 new:
  - the date and opponent for the 10 newly downloaded teams' notes, each checked against its PDF's front page;
  - team codes at the start of a phrase ("PM" and "Houston" are not codes).
- **Live run on 2026-11-09:**
  - 430 milestones across 16 teams;
  - no unchecked team has a publishable pass;
  - Stephen Curry's DeRozan pass is review.
- **In headless Chrome:** 8 games shown, ESPN-only and review chips render, no script errors.

### Still unproven

- **10 notes layouts aren't parsed:** DET, MEM, TOR, IND, DAL, DEN, HOU, NOP, GSW and WAS. They yield 0-15 milestones each. Their franchise and NBA-history chases (which ESPN can't supply) are missing until each layout is learned and hand-checked. Samples are saved in `samples/2026-11-09-slate/`.
- **ESPN-only milestones are single-source:** review by design.
- **First scored night: 2026-11-09 (all 8 games, scored 01:03 ET 11/10).**
  - 30 calls were given a 5%+ chance tonight. 17 happened, against 15.6 expected (Brier 0.13).
  - Bands: 25-50% → 33% happened; 50-75% → 67%; 75-95% → 100%; 95%+ → 100%.
  - Slightly underconfident, but this is one night and 6 calls per band: far too few to recalibrate on.
  - Two of 346 calls given under 5% happened: Mamukelashvili scored 23 for 2,000, and Podziemski made 10 field goals for 1,000.
  - Passes are scored only against the target set before the game. Whether the passed player also scored that night (Curry passing DeRozan) isn't checked.
- **`tonight.js` takes about 1.5 minutes** on a cold cache (about 250 ESPN requests, spaced 250 ms apart). It is faster when cached.

## 0.4.0 (2026-11-09): the Watch List website, with live countdowns

### What changed

- **New `docs/index.html`** (GitHub Pages serves `docs/`). One page with no build step and no server:
  - **Tonight's games:** away @ home, tip time in the viewer's time zone, live score and clock.
  - **Likely tonight:** cards with the chance, what is needed, the 3-game chance, the expected game and date, the importance, and flags (review / not live / Out / Day-To-Day / few games). "Why" lists the importance reasons, the review reasons and the form behind the estimate.
  - **Next 5 games**, and **All milestones** (team filter, player search, include review). The first 40 are shown, with "Show all".
  - **Live countdowns.** From 10 minutes before tip, the page reads ESPN's box score in the browser every 30 seconds (every 2 minutes when nothing is live; paused while the tab is hidden), and stops when the game is final. ESPN allows this: `access-control-allow-origin: *`.
    - Each milestone's need counts down.
    - A milestone turns green ("Reached 500 points tonight") when it falls.
  - **The live counting uses the tested code itself** (`docs/lib/` is a copy of `src/`), not a second implementation.
  - If the data is older than today, the page says so.
- **New `scripts/publish.js`.** Builds `docs/data/watch.json` and copies the shared code into `docs/lib/`. It also saves the full predictions to `data/predictions-<date>.json` for scoring.
  - Only numbers are published: no text from the teams' notes.
- **Schedule entries now carry the start time and home/away.** The Watch List records tonight's game ID for each team.

### Tested

- 202 facts and checks pass, 7 new:
  - the page's copy of the code matches `src/` (the test fails if publish wasn't rerun after a code change);
  - every module the page imports exists;
  - `watch.json` has the expected shape;
  - no notes text is published.
- **In a real browser (headless Chrome), at desktop and phone widths:**
  - the page loads with no script errors;
  - all 379 milestones render;
  - tonight's three games appear with tip times.
- **Live path.** The Charlotte game was pointed at the finished 11/6 Hornets-Celtics game, with the network replaced by that game's real box score.
  - One request was made, and the page showed "Final · CHA 80 – BOS 119".
  - Sion James turned green: he needed 5 points and scored 11.
  - A finished game is labelled "final", not "LIVE".

### Still unproven

- **A game actually in progress** (tonight is the first). The clock text and the in-progress state come from ESPN's live feed and have only been read from a finished game.
- **The page only knows what was last published.** Until the PC's scheduled job republishes daily, it goes stale after tonight (it shows a banner saying so).
- **No outlier detection yet.** The live layer only counts down known milestones. Finding outliers during a game is the next layer.
- **Rebound and assist splits mid-game.** ESPN's live box score is assumed to carry the same fields as the final one.

## 0.3.0 (2026-11-09): P(tonight), ETA and importance (the Watch List engine)

### What changed

- **New `src/anticipate/model.js`.** A seeded Monte Carlo over the player's next 15 games estimates the milestone's chance tonight, within 3 and 5 games, and its median game and date. Same inputs give the same answer.
  - Each game, the player plays with a probability, and his line is drawn from his recent games.
  - 1 draw in 5 comes from a smoothed version of those games, so a big night he hasn't had lately keeps a small chance.
  - Stats the game data doesn't carry are reported as unknown, not guessed.
- **New `src/anticipate/importance.js`.** A transparent 0-100 score with its reasons. NBA-history passes rank above franchise passes, which rank above round numbers. Higher ranks, bigger landmarks and points weigh more. "seventh-most" in a sentence is read as rank 7.
- **New `src/anticipate/watch.js`.** Builds a team's Watch List from:
  - this season's box scores: form, starts, missed games;
  - last season's game log when there are fewer than 20 games;
  - ESPN's injury feed: Out is 0% until the return date; Day-To-Day is at most 60%;
  - the schedule.

  Nobody is ever 100% to play (cap 97%). Items are **publishable** only if:
  - the parser said ok;
  - ESPN agrees with the total;
  - the player is still with the team.

  A mark the notes list but the player had already passed (De'Aaron Fox, 3,600 assists with 3,766) is labelled stale, not "reached".
- **New `scripts/watch.js`.** Prints tonight's likely milestones and the next 5 games, and saves the predictions as JSON.
- **New `scripts/score.js`.** Scores saved predictions against that night's box scores: each call, the Brier score, hit rates by probability band, and a line appended to `data/calibration.jsonl`.
- **The ESPN cache keeps only what is read.** Box scores drop play-by-play, and game logs and the injury feed drop logos and links (about 1 MB each, down to a few KB).

### First run: 2026-11-09 (CLE@CHA, LAL@ATL, SAS@PHX)

- 379 milestones: 9 possible tonight, 22 more within 5 games.
- The top calls:
  - Dončić passing Steve Nash in NBA 3-pointers: 93%.
  - Dylan Harper needs 6 points for 1,000: 97%.
  - Sion James needs 5 points for 500: 54%, held for review because ESPN disagrees on his total.
  - Jarrett Allen needs 3 defensive rebounds for 4,000: 54%, because he is Day-To-Day.
  - Dončić's 5th 50-point game as a Laker, passing Mikan: 20%.
- Saved as `data/predictions-2026-11-09.json`. Score it tomorrow with `node scripts/score.js data/predictions-2026-11-09.json`.

### Tested

- 195 facts and checks pass, including 19 new ones, all offline. The new checks:
  - Exact answers in controlled cases: 10 points a game needing 25 lands exactly in game 3; a 0-or-20-point scorer is 50% tonight and 75% within 2 games; 50% to play needing 1 game is 50%.
  - Determinism: same inputs, same answer.
  - Unknown stats are not guessed.
  - Importance ordering.
  - On Charlotte's real notes:
    - Grant Williams (Out) is 0% tonight.
    - Naz Reid (7 games away) is 0% tonight, with an ETA of game 7 or later.
    - Sion James is likely but held for review.
    - Traded players are never projected.
    - Rankings follow the documented order.
    - Nobody is 100% to play.
- The test fixtures were rebuilt smaller: 71 files, 2.3 MB.

### Still unproven

- **The probabilities are uncalibrated until scored.** Tonight's games are the first test. Calibration needs many nights before the numbers can be trusted at face value.
- **Recent form only:** 10 games this season plus last season's games. Opponent strength, minutes limits, back-to-backs and blowouts are not modelled.
- **A player just back from injury.** His chance of playing is too low, because the recent games he missed count against him.
- **An Out player with no return date.** Only the next game is set to 0.
- **ESPN's injury feed has only Out and Day-To-Day.** The official NBA report's Questionable, Doubtful and Probable would come from the user's injury report checkers, not yet connected.
- **A chased teammate.** His total moving is handled by the tracker, but not inside the simulation.
- **Importance weights are a first guess** and are meant to be tuned.
- **Hot streaks.** A 50-point-game chance rests on a player's last 20 games. Dončić's 20% reflects two 50-point games in his last 10, which may overstate it.

## 0.2.0 (2026-11-09): milestone tracking with ESPN

### What changed

- **New `src/espn/`.** Readers and a cached client for ESPN's public feeds: teams, rosters, schedules, box scores, career stats and game logs.
  - The client never throws.
  - It caches under `data/espn/`. Finished box scores are kept forever.
  - If ESPN can't be reached it falls back to the last saved copy, marked stale.
  - Requests are spaced 250 ms apart.
  - ESPN's game times are converted from UTC to New York dates.
- **New `src/registry/track.js`.** For each milestone in a team's notes:
  1. **Roll forward.** The stats from every regular-season game played since the notes' date are added from box scores, so stale notes are corrected automatically. Players who didn't play add nothing. When the player being chased is a teammate, his total moves with the same games.
  2. **Cross-check.** The current total is compared with ESPN's career total, or with his ESPN seasons for this team on franchise lists.
     - A match is **confirmed**.
     - Any difference is **disagrees**: the milestone becomes **review** and both numbers are shown. Neither source is assumed right.
  3. **Players who have left.** A franchise chase by a player who is on neither ESPN's roster nor the team's last 5 box scores becomes **review**: it is no longer live. For career milestones the check is simply skipped.
- **New `scripts/track.js`** (`npm run track -- samples/2026-11-09/hornets.pdf`) and `scripts/make-espn-fixtures.js`.

### Found on the 2026-11-09 notes

| Team | Confirmed | Disagree | Other |
|---|---|---|---|
| LAL | 146 | 0 | 27 (no ESPN equivalent) |
| PHX | 15 | 0 | 0 |
| CLE | 50 | 9 | 11 |
| SAS | 37 | 4 | 10 |
| CHA | 29 | 10 | 16 (Ball and Bridges were traded) |
| ATL | 8 | 0 | 7 |

- **Cleveland's franchise rebound list prints "8. J. ALLEN (3,421)".** ESPN has 3,921 for his Cleveland seasons. The parser had already flagged that list as misordered, because Chones at 3,790 sits below Allen. With 3,921 the order is correct, so this is very likely a typo in the notes. It changes his chase of Varejão from 1,034 rebounds to 534.
- **LaMelo Ball and Miles Bridges.** Charlotte's notes say both were traded in July 2026, yet the notes' franchise leaderboard still lists them as "present". Their franchise chases are now marked not live.
- **Most disagreements are 1 to 4 and sit in past seasons.** ESPN's 2026-27 rows match its own box scores exactly. Play-in games are not the cause: ESPN leaves them out of its season rows, as the NBA does (checked against three players). The tiebreaker has to be NBA.com's official career stats, which means the PC collector.

### Tested

- 176 facts and checks pass (22 new for tracking), all from saved ESPN data with no network access. A test fails if any request is attempted. The new checks:
  - UTC dates converted to New York dates.
  - 30-point games, double-doubles and triple-doubles, starts and games missed.
  - Traded seasons not double counted (Schröder: 4,482 assists).
  - Accented names (Schröder, Salaün).
  - Pretending the notes were written for 11/4: Brandon Miller +10 +8 = 3,378 points, McNeeley's missed game adds nothing, Naz Reid 7 games → 5.
  - A chased teammate's target moves.
  - Offline with no saved data: every milestone says "unavailable" and nothing crashes.
- **Independent recomputation.** 32 randomly sampled cross-checks were recomputed in Python straight from ESPN's raw JSON: 0 mismatches.
- **Mistakes caught while building:**
  - A play-in adjustment, based on a wrong assumption, was written, disproved against the data, and removed.
  - A rookie ESPN has no games for was being shown as "partial". He is now confirmed at 0.
  - A two-way player missing from ESPN's roster was being called "left the team". Box scores are now checked first, and only franchise chases are taken off the publishable list.

### Still unproven

- **The roll-forward has only been exercised on simulated dates.** Tonight's games will be the first real ones.
- **NBA Cup championship games.** The NBA doesn't count them in player stats. ESPN may file them as regular season, and they aren't excluded yet. Before the Cup final (December), check how ESPN labels it.
- **A chased player on another team.** His total can also move, and only teammates are followed so far.
- **Franchise totals use ESPN's team ID.** Charlotte's 1988-2002 Hornets years and New Orleans' history may not line up with the NBA's franchise records.
- **ESPN rosters leave out two-way players.** They are found only if they appear in the team's last 5 box scores.
- **Small disagreements can't be settled yet.** Settling them needs NBA.com's career stats (stats.nba.com, PC collector).
- **The test fixtures are a frozen copy taken on 2026-11-09** (`samples/2026-11-09/espn/`). If they are rebuilt after that date, the "games since 11/4" test changes by design.

## 0.1.1 (2026-11-09): fixes from the independent audit

An independent review of v0.1 checked the parser's output against the six sample PDFs and found 18 milestones marked **ok** that should not have been, plus Charlotte's whole milestone section going unread. All of them are fixed below.

### What changed

- **Unproven scope is no longer a guess.** A ranked list with no clear "franchise" or "NBA" heading used to be treated as franchise history. It is now `unknown` and the milestone is marked **review**. (Atlanta: 14 milestones moved from ok to review.)
- **Qualified lists go to review.** Lists limited to centers, bench players, a draft class, rookies, "since 2000", per-game figures, home games and similar cases can't be treated as all-time records. They are flagged for review, and their stat is recorded as `list`, not as plain points or rebounds (San Antonio: Keldon Johnson vs. Malik Rose).
- **Averages go to review.** A gap such as "29.4 vs 30.1 PPG" isn't a counting milestone (Lakers: Dončić vs. Chamberlain).
- **Charlotte's format is read.** Bullets such as "Grayson Allen is 93 rebounds away from 1,500 career rebounds... 36 games away from 500 career games played" are split at "..." and each part becomes its own milestone. Charlotte now yields 55 milestones. Value-first lists such as "701 Dell Curry 1988-98" are read too.
- **Two PDF-reading bugs fixed:**
  - Tightly justified lines lost all their spaces ("NazReidis89points..."). Their word breaks are space glyphs only 0.07pt wide, and those used to be thrown away. They are now kept. Audit: all 12,301 lines of the six samples were compared old vs. new. 176 changed, and every change only added whitespace.
  - The last bullet of a list ran into the heading below it, so Coby White's "25 games away from 500" was dropped. The bullet is now cut at the sentence end when that is what makes it readable.
- **The opponent is read per table cell.** Cleveland's front page puts "CAVS QUICK FACTS" and a schedule row ("12/12 vs. Warriors") on the same printed line, and the reader picked Golden State. Each cell is now scored on its own: both teams named (+3), tonight's date in the cell (+2), near the top (+1).
- **Merging duplicates.** Duplicates are merged only when they are the same player, stat and target (or the same passed player and scope). Different lists no longer swallow each other.
- **Roster names.** Suffixes (Jr., III) are stripped before checking a name.
- **The notes watcher never crashes and never corrupts its store:**
  - Every failure (offline, 403, an HTML block page, a body that fails mid-read, a truncated PDF) comes back as a status.
  - Files are written atomically (temp file, then rename).
  - A damaged index is set aside with a warning.
  - `latest.json` follows the newest version.
  - A file dated tonight that names a different opponent is reported as **conflict**, not as tonight's notes.
- **Truncated downloads.** A download is accepted only if `%%EOF` appears in its last 1KB. An earlier `%%EOF` from an incremental update no longer passes a cut-off file.

### Tested

- 154 hand-verified facts and checks pass, including:
  - every case the audit raised;
  - all six front pages (date and opponent);
  - 13 watcher situations, run with a fake network;
  - the invariant that no milestone with unknown scope, a qualifier, an average or an unresolved tie is ever **ok**.
- The snapshot was reviewed line by line before it was accepted. Each changed value was checked against the PDF text (Charlotte franchise lists: LaMelo Ball, Miles Bridges, Brandon Miller; Lakers 50- and 60-point games).

Current output:

| Team | Milestones | ok | review |
|---|---|---|---|
| CLE | 70 | 66 | 4 |
| LAL | 173 | 172 | 1 |
| CHA | 55 | 52 | 3 |
| SAS | 51 | 42 | 9 |
| PHX | 15 | 15 | 0 |
| ATL | 15 | 1 | 14 |

### Still unproven

- **Only six PDFs from one night have been tested.** Other teams' layouts, and these teams' layouts later in the season, are unseen.
- **Current totals come only from the notes.** Nothing yet rolls them forward or cross-checks them against box scores, which needs NBA/ESPN data access.
- **Scope can be conservative.** Some lists that really are franchise lists are marked unknown and go to review (Charlotte rebounds, blocks and free throws; most of Atlanta).
- **"Career" is assumed for round-number milestones.** That is right for every sample so far, but it isn't checked.
- **The roster comes from the notes,** not from an official roster feed.
- **Old pages can survive in current notes.** A file can be dated tonight and still carry a page from an earlier game. The date check doesn't catch that.
- **Two copies of the watcher could collide.** There is no lock, so the scheduler must run one at a time.
- **Records like "185-89" can print as "185- 89".** That is how the PDF spaces them. Anything that later reads W-L records must allow spaces around the dash.
