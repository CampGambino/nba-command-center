# Changes

Each entry: what changed, how it was tested, and what is still unproven.

## 0.50.0 (2026-11-13): the user's 17-image review (Basketball Reference checks, trends, Watch List, National TV, Records tabs)

### What changed
- **Basketball Reference checks (images 12-17):** all six of our totals match B-Ref exactly:
  - Horford career DRB 6,982;
  - Wembanyama career BLK 680;
  - Mitchell CLE 3PM 916;
  - Merrill CLE 3PM 457;
  - Allen CLE REB 3,942;
  - Sabonis SAC ORB 961.

  The teams' game notes were what disagreed (917, 454, 3,442, 679 and 3,599). New `src/data/verified-totals.json` holds those confirmations, and `src/records/verified.js` applies them:
  - Records → Checks now lists a disagreement B-Ref settles as "settled by Basketball Reference in our favour". It only does so while our total still equals the confirmed one.
  - The guide's two Horford DRB figures (6,949 and 6,950) become an erratum: 6,949 + 33 this season = 6,982, so 6,950 is the slip.
- **Notes reader:** Sacramento's 3,599 "offensive rebounds" chasing Jason Thompson was Sabonis's total rebounds (961 + 2,638). A row that equals another offensive row plus the defensive row is now read as total rebounds. It stays in review.
- **Streaks & outliers:**
  - Outlier games: one row per player, with each unusual number as its own chip (value, average, "season high (was N)"). A short-minutes game says so.
  - Active streaks: "(this one)" is now "(active)".
  - Team streaks: tighter cells under two header groups.
    - Offense: Scored 120+, Scored 110+, Scored under 110.
    - Defense: Held opp. under 110, Held opp. under 100, Allowed 120+.
    - The old "Held under 110" (which meant held opponents) is now "Held opp. under 110", with a key above the table.
- **Team leaders:** "Led his team, game by game" opens on a Team snapshot. Each team gets one row and each stat one cell, showing who led most games (games led of the team's games, and his share of his own games), plus the next man. The old list is under "Player list".
- **Watch List:**
  - 50-40-90 watch: a qualified player at all three lines, or within 1 point of them added up, gets his own line on game night. Example: "Ayo Dosunmu: 0.3 short of 50-40-90 … 1 make from the line gets him there".
  - National TV tonight: a player in tonight's national game who is clearly better or worse on national TV gets a line, at most 2 a game. The cutoff is 3+ national and 3+ other games, 20+ minutes in both, and a gap of 4+ points that is also 20%+. The injury report removes him like any line.
- **National TV page:**
  - The other games are named League Pass (LP); "chg" is national minus LP.
  - The toggle reads "Better / Worse on national TV first". Clicking a stat sorts by it, and clicking again flips the order.
  - Players on national TV tonight are marked.
  - The team table has ABC, ESPN, NBC, Peacock and Prime Video columns. A simulcast counts in both of its networks and once in "All national".
- **Records:**
  - **Sub-tabs:** Tonight, Within reach, All-time lists, Franchise, This season, NBA Cup, Record book, Checks. One shows at a time, and the address keeps it (records.html#franchise).
  - **Odds when the man being passed is still playing (images 8, 11):** before, the chances treated his total as fixed. Now both players' games are simulated night by night (`simulate(..., rivals)`), and the pass needs our player to get beyond him.
    - He counts tonight only if his team plays tonight (for the Cup: a Cup game tonight).
    - A franchise mark moves only with games for that franchise.
    - The line says "Davis is active too … his games count in the odds".
  - **All-time lists:** a "To pass next" column for players still playing: how many to pass the next total above, how many tie it, and "(active)" when that man is still playing.
  - **Within reach:** opens "By player". There is one card per name, tonight's first (not those ruled out), with his 3 closest marks; the rest are behind "+ N more". There is a "playing tonight" box, and the full table is one click away.
- **Watch List (phone):** a long trimmed-line reason no longer runs off a 390 px screen.

### Tested
- 617 checks pass (604 before). New ones cover:
  - B-Ref settling a check, a same-day disagreement, a stale confirmation, and Horford's erratum;
  - the Sabonis rebound relabel;
  - the new team streak columns;
  - per-network records with simulcasts;
  - the 50-40-90 line and that the single-line note gives way;
  - the national-TV cutoff (2 games, a 3-point gap and a bench player are all excluded) and the injury report;
  - passing an active 30-a-game player: 15 points is likely against a frozen total and unlikely when he plays tonight too.
- The 60 watcher checks pass.
- The page sweep (`tools/check-pages.py`, now also every Records sub-tab) passes at 1400 and 390 px.
- Screenshots checked: outliers, team streaks (rebuilt from the team files), the team snapshot, the per-network table and Within reach.

### Unproven
- Tonight's build is the first with the new team streak fields, network records, rival-aware odds and the B-Ref settlement. The pages were checked with locally rebuilt data, not a live build.
- The national-TV cutoff (4 points and 20%) is a judgment call. Early in the season the samples are 3-5 games.
- In the odds, the rival's later games are assumed to follow ours game for game. Only tonight is matched exactly.

## 0.49.2 (2026-11-13): #lineups timing, from the first night's diagnostic

The user asked for this ("make your changes but also run another diagnostic tonight with 9 games for larger sample").

### What changed
- **The 11/12 diagnostic, corrected:** the night's summary read NBA.com's Eastern stamps as UTC (fixed in 0.47.x after it ran), so every minute figure was 300 too high and every lag 18,000 s too high. Corrected:
  - median confirmation 26.5 min before tip (range 22.1-30.0);
  - 2 of 8 in the 31-29 burst window;
  - lag from NBA.com's stamp to our post: 95-345 s.
  
  Three of the four games confirmed 22-27 minutes out, after the 20-second burst and inside the every-3-minutes stretch.
- **New timing** (`feedDue` in `cloudflare/lineups.js`):
  - NBA.com's file every 5 minutes from 90 to 35 out (unchanged);
  - **every minute from 34 to 16 out**;
  - every 3 minutes from 15 out (15, 12, 9, 6, 3).
  
  The 31-29 burst of 20-second reads is gone. One read still covers every game on the slate.
- **Tonight's diagnostic (9 games):** the nightly "Lineup timing · tonight" post now shows, per team, NBA.com's stamp, our first read that had it ("seen") and our post, plus the seconds from stamp to seen. That splits NBA.com's publishing delay from our checking. Its title shows the true median (it took the upper middle before), the range, how many fell in the 35-15 window, and the median lag.
- **`lineup timing (read only)` workflow:** it takes a `date` and prints that night's saved timing (team codes and minutes only; kept 8 days), so Claude can read a night without the review key.

### Tested
- 60 watcher checks pass. Changed or added:
  - the schedule of reads for a 7:30 tip (18:00…18:55 every 5 min, 18:56…19:14 every minute, 19:15…19:27 every 3);
  - one read a run in the fast window;
  - the summary post, using 11/12's corrected numbers.

### Unproven
- **Correction, the same day:** the saved 11/12 timing (read with the new workflow) shows when our checks first saw each lineup. Those times fall on our check marks: every 5 minutes for the 7 and 8 PM games (the first version of the timing was still live), every 3 minutes for the 9 PM game. For example, DAL-MIN was stamped 30.0 and seen 25. So the lag was nearly all our check interval, not NBA.com's file trailing its stamp.
- Whether every-minute checks bring the lag to about a minute is for tonight's 9-game diagnostic (a check-in is set for 11:45 PM ET).

## 0.49.1 (2026-11-13): trimming, after its first build

### What changed
The first build with 0.49 trimmed 24 lines across 18 teams' notes. It showed three gaps, now fixed:
- **The Mexico City trip came back** through the few-lines floor (Indiana had 2 lines). An event that isn't a stat (a trip, a first visit) is now "past event" once a game has been played since or 3+ days have passed, and the floor never brings it back.
- **The same fact told twice:** a dated telling was trimmed while a shorter, undated one stayed ("Wilson is the first rookie in Bulls history to…"). The undated one now goes too ("told again") when most of its words are in a trimmed line about the same player.
- **A date with its year** ("Oct. 31, 2026") is read when the year is this season's.

### Tested
- 604 checks pass. Added: the told-twice pair and the trip with the floor.

### Unproven
- The told-twice test is word overlap (5+ shared words, 70% of the shorter line). Two different facts about one player that share most words could be taken as one.

## 0.49.0 (2026-11-13): trimming the notes by the user's review

The user reviewed 13 lines from the 11/13 slate. Their rule: keep what can still move (a streak, a club, a race, a count that grows, the series) and what is rare over a long span ("the most FTA in a regulation game since Dec. 12, 2014", "most in over 10 years"). Cut what is a closed, past one-off that "can't be added to or expanded on". Their caution: "don't be too strict … for fear of missing something that might spark an idea".

### What changed
- **Trimming** (`trimReason`/`trimLines` in `src/notes/facts.js`, run by `scripts/tonight.js`). A line is trimmed when it is:
  - **A closed past one-off.** That covers a season-opener or debut total, a fixed early window ("each of the first two games"), a pass made weeks ago ("Passed Scott Skiles … on Oct. 28"), or a trip ("traveled to Mexico City"). It must also have no sign it is still going, and its date (read from the line; "season opener" is the team's first game) must be 2+ games or 7+ days back.
    - **Saved:** rarity over 10+ years ("since Dec. 12, 2014", "since 1985-86", "first time in 12 years").
    - **Not affected:** the last game's line (Jalen Smith's 11/11 game stays).
  - **Filler:** "The HEAT are currently in their 39th season in franchise history".
  - **The other venue:** a home-only stat on a road night (the Warriors' home sellout streak while at San Antonio), and the reverse.
  - **Garbled by the page layout:** a bio-table row glued to a sentence ("…on Virginia / USA 8th Season 10/21/26 vs UTA"), or two columns read as one ("…in four of Darius Acuff Jr. notches his second consecutive…", or "joining" twice).
- **Not too strict:** a team left with fewer than 4 lines gets its best trimmed one-offs back, marked "kept: few lines". This is the user's "with the Grizzlies having only 4 items … I am comfortable including them". Filler, wrong-venue and garbled lines never come back.
- **Every trimmed line is listed on the page** under its team ("N trimmed"), with its reason, so nothing is hidden for good.
- **Every team playing tonight is listed in "History in tonight's notes", lines or not,** with its notes status:
  - notes read;
  - notes read (last game's version);
  - not updated for tonight yet;
  - none posted.
  
  This is so the user can confirm each team was checked. `notes-facts.json` gains `status` and `trimmed`.
- **The scorer:**
  - Four new features (opener/debut/early window, a past pass, a one-off event or the franchise's age, rarity over 10+ years), with hand-set weights from this review.
  - The review joins the labels: 7 "not needed" lines (weight 1), the 2014 FTA line (a pick) and the Grizzlies lines (weight 0.5).
  - 44 labels in all. Held-out, the learned weights still rank below the prior (0.736 vs. 0.767), so the prior stays in use.
- **Matchups:** "his teams have won/lost N straight against them with him playing" ranks higher (base 1.8, was 1.3-1.4). The user liked "Kelly Oubre Jr.'s teams have lost 6 straight against the Knicks".

### Tested
- 603 checks pass. Added:
  - the user's 13 lines as cases: 9 cut with the right reason; kept are the 2014 FTA mark, Acuff's 7-game streak, the 11/11 line, Giddey's growing count, and the sellout streak on a home night;
  - the few-lines floor.
- check-pages OK.

### Unproven
- The "still going" signals are words ("consecutive", "this season", "has now", "averaging"…). A closed line that happens to use one stays.
- The column-splice check is a pattern, not a fix to the PDF reading; other splices can get through.
- Image 11 of the review was a second copy of image 10, so the Grizzlies line the user meant was found from the description ("on Virginia").

## 0.48.1 (2026-11-13): tags and hooks fixed after the first real slate

### What changed
- The first daily build with 0.48 (11/13, 9 games) showed tags that claimed too much. These are now tagged as team history:
  - "for eighth on the Magic's all-time free throws list" (was "NBA history", now "8th in team history");
  - "fourth most by any player in franchise history" (was "4th in NBA");
  - "second highest +/- this season by any Cavs player" (was "2nd in NBA").
  
  A rank read as "for seventh all-time since the 1968-69 season" is tagged "7th since 1968-69".
- **Streak hooks fit the kind of streak:**
  - games played: "177 if he plays tonight";
  - a stat streak (a block and a steal in 10 straight): "11 if he does it again tonight";
  - a team streak (the Warriors' sellouts): "614 with tonight's game", not "if he plays".

### Tested
- 601 checks pass. Added: one check with these six lines from the 11/13 slate.

### Unproven
- Other phrasings of team-only scope ("among Bucks players", "on the roster") may still read as league-wide. Each slate is worth a look.

## 0.48.0 (2026-11-13): notes read for meaning, and tonight's matchups

The user sent 16 screenshots from the Wizards' 11/12 notes as examples of what's worth surfacing: league ranks, "one of N" clubs, active streaks, races on a list, the series with tonight's opponent. They also asked for matchup data against tonight's opponent when it's active or lopsided.

### What changed
- **The notes reader takes in league context, not just history** (`src/notes/narrative.js`). It now keeps:
  - "leads all NBA third-years";
  - "one of five players averaging…";
  - "the third-longest active streak";
  - "blocked the least of any team";
  - "only Jokić has more assists than Young";
  - the series note about tonight's opponent.

  Fixes found along the way:
  - The team counts as the subject mid-sentence ("Despite…, the Wizards have…").
  - "They have…" and "That's the fifth-most…" are read with the sentence before. The earlier line is replaced only if the joined one is kept.
  - A player's heading carries to his bullets that follow on the page.
  - Infographic table text glued to a sentence is stripped.
  - Series lines about a past opponent are dropped.
  - Table rows read as prose are dropped.

  Over the 30 teams' latest notes, lines kept went from 155 to 259, and no old line was lost.
- **Each line is read for meaning** (`src/notes/facts.js`, new). Each line gets:
  - a type: club, rank, streak, race, matchup, all-time or franchise;
  - a tag: "1 of 2 this season", "Leads NBA", "Active streak · 176", "T-7th since 1973-74";
  - a one-line "why";
  - **what tonight can change**:
    - **Clubs:** the minimum he needs tonight to stay in, from this season's box scores. Example: Davis needs 10+ rebounds and 23+ points tonight to stay "one of two" averaging 25/10/1/1. A club he has since left is marked no longer true and kept out of the storylines.
    - **Races and ranks:** the gap, from the ranked table printed beside the line. The tables are read from the infographic pages, 46 in the Wizards' notes. Examples: Davis leads Gobert by 8 blocks since 2012-13; Young leads Davion Mitchell by 7 assists; the Wizards' 6 paint points behind Indiana. A link needs the line's own rank or number to match the table's row.
    - **Streaks:** the next number if he plays.
  - The same fact printed twice (player page and infographic) is kept once.
- **A scorer that learns from the user's picks** (`tools/train-fact-model.js`, `src/data/fact-labels.json`, `src/data/fact-model.json`).
  - It is a logistic model over about 25 features of a line: club, small club, #1 rank, active streak, race, live tonight, this season vs. all-time, bio/roster note, and so on.
  - Labels: the 23 lines in the user's screenshots are picks. The other lines read from the same notes are weak negatives (weight 0.25).
  - The fit is pulled toward a hand-set prior, and learned weights are used only when they rank held-out lines better than the prior.
  - With 33 labels from one team's notes they don't yet (held-out AUC 0.75 vs. the prior's 0.78), so the prior is in use. The file records both.
  - Even the prior puts 10 of the user's picks in the top 12 of the Wizards' 33 lines. The prior was written with these examples in view, so that is an optimistic measure.
- **Matchup history back-fill** (`tools/backfill-matchups.js`, a `backfill-matchups` workflow, run once on GitHub Actions because ESPN isn't reachable from Claude's shell):
  - every game 2016-17 to 2025-26: 12,815 games, 833 of them playoffs (`src/data/nba-results-history.json`);
  - every game of the 425 current players who played in those seasons: 129,279 games (`src/data/player-logs-history.json.gz`, 1.6 MB).
  
  Checked against the Wizards' notes: 2025-26 vs. Detroit was L 135-137 OT, W 126-117, L, L.
- **Tonight's matchups** (`src/records/matchup.js`, new; `docs/data/matchups.json` from the daily build).
  - **Team side (regular season):** 3+ straight wins in the series, 8+ of the last 10, 4+ straight at tonight's arena, 3+ straight season series, this season's series so far, and last season's playoff series.
  - **Player side (regulars, 18+ minutes):**
    - his average against tonight's opponent when it is his best or worst against any team (4+ games, 8+ opponents to compare, well off his average);
    - his teams' record in those games when 85%+ one way;
    - a streak still going against them, counted only at a bar near his own average;
    - this season's big game against them.
  - A player's lines weigh with his role (6 to 24+ points a game).
  - Each line says its window: "since 2016-17", or "in his career" when his first game is in it.
  - Tonight's 11/13 slate gives 38 lines, for example:
    - Thunder 9 straight over the Clippers;
    - Rockets 5 straight at home against Utah;
    - Wembanyama 25+ in 7 straight against Golden State;
    - VanVleet's 20.8 against Utah, his best against any team.
- **Where it shows:**
  - The storylines (Tonight page, the 3 PM Discord digest, NBA Live's pre-game cards) carry up to 2 matchup lines and 2 notes lines a game. Notes lines now read "<tag> · <line> → <what tonight can change>".
  - The Tonight page has a new **Matchups tonight** section, and the notes section shows the tag chip and the hook under each line (bold when in play tonight).

### Tested
- 600 checks pass. Added:
  - the user's Wizards sentences: subject, tag, thresholds, tables, the club math, races, the scorer;
  - matchups: series streak, best average, a streak still going, last meeting, at most two in the storylines.
- The old and new notes readers were compared over all 30 teams' notes: 104 lines added, none lost (one was lost, then fixed: the joining above).
- A regex that could take minutes on a long run of capitals was replaced; a 1,000-character worst case now runs in 0 ms.
- check-pages OK.

### Unproven
- The scorer has 33 labels from one team's notes; it learns only as more picks come in (send screenshots like today's).
- Player history starts in 2016-17, so a veteran's "best against any team" covers those seasons only (each line says so).
- Play-in games aren't in the results; preseason and the All-Star Game are left out on purpose.
- Only the Wizards print ranked tables, so the race math applies to their notes for now.
- The page was checked by the page checker, not by eye.

## 0.47.5 (2026-11-13): the Seattle SuperSonics count in Thunder history

### What changed
- **The user's call:** "use sonics with thunder in history stats". The Thunder's career lists and best seasons already counted the Seattle years (Payton, Sikma, Durant's 17,566 points), so they're unchanged.
- **Thunder single-game records now include Seattle:**
  - **points:** 58, a tie between Fred Brown (at Golden State 3/23/74) and Russell Westbrook (3/7/17);
  - **rebounds:** 30, Jim Fox vs. the Lakers 12/26/73 (was 23);
  - **assists:** 25, Nate McMillan vs. the Clippers 2/23/87 (was Westbrook's 24);
  - **steals:** 10, Fred Brown (12/3/76) and Gus Williams (2/22/78) (was 8);
  - **blocks:** still Ibaka's 11. No Sonic is on the NBA Guide's 12+ list, and the most found is 10 (Kemp, Calvin Booth);
  - **3-pointers:** 10, now **Paul George and Isaiah Joe** (at Utah 4/11/25). The Thunder guide's records page lists only George, but its own 2024-25 highs show Joe's 10. No Sonic is on the 11+ list; the most found is 9 (Dale Ellis).
  
  The Oklahoma City-era marks are kept in each record's note. Sources: points, assists and steals come from the NBA Guide's complete lists (pp. 128-135); Fox's 30 is the Sonics record per Wikipedia.
- **Stat-title races (Records tab)** count Seattle's league leaders as the Thunder's. "No Oklahoma City player has led the league" now says "no Oklahoma City or Seattle player…". When the franchise's last leader was a Sonic, the note reads "Oklahoma City's last: Gary Payton (Seattle), 1995-96". Seattle led in assists (Wilkens, Watts) and steals (Watts, McMillan, Payton).
- **The Records tab note** now says the Thunder's records include the Sonics years.

### Tested
- 589 checks pass. Two were added or changed: the Thunder's records with Seattle, and Seattle counted in the title races.
- check-pages OK.

### Unproven
- The blocks and 3-pointer checks for Seattle rest on lists found on the web: Sonics blocks game logs from 1983 on, and per-season 3-point highs. A Sonic with 11 blocks before 1983 would tie Ibaka and isn't ruled out.
- Other moved franchises are not counted with their old cities in the title races, which is unchanged. Only Seattle/OKC was asked for.

## 0.47.4 (2026-11-13): Cavaliers guide checked from the user's screenshots; one player under two names fixed in 9 franchises

### What changed
- **Bingo Smith is one Cavalier again.** The NBA Guide lists him as "Bobby Smith" in 1970-71 to 1978-79 and "Bingo Smith" in 1979-80 (8 games before his trade), so his last Cavs games were missing. He now shows as Bingo Smith with 720 games, 9,513 points and 4,182 FGM, the same as the Cavs guide.
- **A scan for the same slip elsewhere** looked at same-surname names in back-to-back seasons with one franchise. It merged these, which `tools/franchise_names.py` now lists as aliases:
  - Moe/Moritz Wagner (ORL, still active, so his Orlando totals for franchise alerts were split; now 277 games);
  - Cliff/Clifford Ray (CHI);
  - Sidney/Sonny Hertzberg (BOS);
  - Marko/Mike Todorovich, Thomas/Dike Eddleman and Warren/Red Perkins (ATL);
  - Paul/Curly Armstrong (DET);
  - Frank/Pep Saul (SAC).
  
  The scan's other pairs are different people (Lou/Marvin Williams and so on).
- **Where the Cavs guide and our data differ, the guide's own numbers favor ours:**
  - **Tristan Thompson's rebounds** (guide: 2,188 offensive, 3,379 defensive, 5,567 total; ours 2,220 / 3,481 / 5,701). The guide's games (708) include his 2024-25 Cavs season but its rebounds don't (32 + 102 = 134).
  - **Jarrett Allen's defensive rebounds** (guide 2,750; ours 2,685). The guide's 2,750 is Jim Chones's number on the line above, and its own totals give 3,859 − 1,174 = 2,685.
  - **Jim Chones's offensive rebounds** (guide 1,034; ours 1,040). The guide's own totals give 3,790 − 2,750 = 1,040.
- **Best single seasons (Cavs guide pp. "Best Individual Cavaliers Season"):** 95 of 102 values match. The others are:
  - the NBA Guide's "Cliff T. Robinson" name;
  - ties at 10th that the Cavs guide prints and ours cuts;
  - two seasons the Cavs guide leaves out: Allen's 811 rebounds in 2023-24 and J.R. Smith's 204 3-pointers in 2015-16.
  
  The per-game lists differ only by qualifier (guide: 800 rebounds or 70 games; ours: 70% of team games).
- **Single-game records agree** (71 Mitchell, 25 Varejao, 27 Huston). The Cavs "high games" rebound list leaves out Rick Roberson's 25 (1972), but the records page we use lists both.

### Tested
- 588 checks pass. The franchise-history check gains 10 Cavs totals from the screenshots: Bingo Smith's three, Allen's, Chones's, Thompson's games, Foots Walker and Larry Nance.
- `nba-franchise-seasons` is byte-for-byte unchanged. In the careers file, the changes are only the merged names above.

### Unproven
- The alias scan only finds a second name in adjacent seasons. A renamed player whose two names are years apart at one franchise would still be split.

## 0.47.3 (2026-11-12): team single-game records cross-checked with the NBA Guide's all-time lists

### What changed
- **The check:** every team record at or above the NBA Guide's single-game list floors (pp. 128-135: 57+ points, 38+ rebounds, 22+ assists, 11+ 3-pointers, …) was compared with that list, with relocated teams mapped by city. That's 113 comparisons.
- **One fix:** the Kings' points record is **60, De'Aaron Fox vs. Minnesota (OT), 11/15/24**. The Kings guide (p. 118) shows Jack Twyman's 59 (regulation, 1960) and no overtime line, while other teams' guides count overtime games (Jordan's 69, Mitchell's 71). The note on that record says so.
- **Utah's 3-pointer record is confirmed:** Bogdanovic's 11 (3/6/22) is the only Jazz game on the NBA Guide's list of every 11+ game through 2025-26. Nobody has matched or beaten it.
- **The rest agreed.** The other differences were only city names (Wilt's 100 is listed under "Philadelphia" for the Warriors; Maravich's 68 under "New Orleans" for the Jazz; Pettit under "St. Louis"; Art Williams and Elvin Hayes under "San Diego").

### Tested
- 588 checks pass.

## 0.47.2 (2026-11-12): Utah's single-game records found (all 30 teams now)

### What changed
- **The Jazz guide does have them, under "Jazz top individual…" (pp. 137-138),** not a "records" heading, which is why the first search missed it. Its lists:
  - points: 68, Pete Maravich vs. New York, 2/25/77;
  - rebounds: 28, Rudy Gobert at Golden State, 3/14/21;
  - assists: 28, John Stockton vs. San Antonio, 1/15/91;
  - steals: 9, Rickey Green twice and John Stockton;
  - blocks: 14, Mark Eaton twice.
- **3-pointers:** the guide has no game list. Its 2021-22 season notes (p. 242) say Bojan Bogdanovic "set a franchise record" with 11 at Oklahoma City, 3/6/22. That is used, with a note that the guide doesn't confirm it still stands.
- **The Records tab note** no longer says Utah is missing.

### Tested
- 588 checks pass; the single-game check now expects 30 teams.

## 0.47.1 (2026-11-12): daily build's commit step fixed (a stale docs/ref copy)

### What happened
- **The 0.46.0 push build failed** at "Commit and push": "cannot pull with rebase: You have unstaged changes". The build copies `src/data` reference files to `docs/ref/`. Since 0.45.3 (All-Star active lists), `docs/ref/nba-postseason-careers.json` in the repo was out of date. The build rewrote it but only committed `docs/data`, `docs/lib` and `history`, leaving that one file unstaged.
- **What it held back:** that build's data push, at 10:32 PM. The site kept the previous build's data until the next run.

### What changed
- **`docs/ref/nba-postseason-careers.json`** is brought up to date.
- **`daily.yml`** now also commits `docs/ref`, so a reference file that changes can't block the push again.

### Tested
- 588 checks pass (including the workflow check).

## 0.47.0 (2026-11-12): Every franchise's single-game records, live in NBA Live (29 team media guides)

### Why
- **The user:** single-game franchise records from the 30 team media guides, so NBA Live can flag "most points in a game in Grizzlies history" before it happens.

### What changed
- **New `src/data/nba-franchise-single-game-2026-27.json`:** each franchise's regular-season single-game record in points, rebounds, assists, steals, blocks and 3-pointers, through 2025-26: the number and every holder, with date and opponent, as printed. Each team's entry names the guide page it came from.
  - **How it was read:** every guide lays its records out differently and the text is out of order, so each records page was turned into an image and read by hand.
  - **Examples:** Kobe 81, Wilt 100, Bam Adebayo 83 (3/10/26), Booker 70, Embiid 70, Elmore Smith 17 blocks, Scott Skiles 30 assists, Klay 14 threes.
  - **Ties:** all holders are kept (Boston's 60 points: Tatum and Bird; Atlanta's 57: Wilkins twice, Hudson and Pettit).
  - **Gaps:**
    - Utah's guide has no single-game records pages, so the Jazz are left out.
    - The Thunder's guide gives Oklahoma City-era records only, not Seattle's; the card says "(Oklahoma City era)".
    - Denver's are NBA seasons; the Nuggets list their ABA records apart.
    - Records set in overtime games are included, as the guides list them.
- **NBA Live bridge v4 (`docs/bridge/cc-bridge.js`), in regular-season games:**
  - **Nearing a record (live only):** within 8 points, 5 rebounds, 4 assists, or 2 steals, blocks or threes, and at least 75% of the record. Example: "6 from the Lakers record (81, Kobe Bryant vs. Toronto 1/22/06)".
  - **Ties or breaks it:** "ties/breaks the Lakers record".
  - **Each card** names the guide page it came from.
- **`records.json`** gains `franchiseGame`.
- **Records tab:** a "Franchise single-game records" table (pick the stat; all 29 teams, sorted).

### Tested
- **Checks** (588 pass):
  - 29 teams with all six stats and holders;
  - known records (Wilt 100, Kobe 81, Adebayo 83, Booker 70, Elmore Smith 17, Skiles 30; Thunder OKC-era);
  - bridge v4 against the stand-in NBA Live: a tie card ("58 points: ties the Lakers record (58, …)"), a near card (52 of 58: "6 from the Lakers record"), and no card for 9 threes against a 12 record.
- **The real NBA Live** (`live/nba-live_14.html`, 11/12's games) loads bridge v4: connected, no errors, 9 Command Center cards. Nobody came near a team record, so there was no team-record card.
- **Page sweep:** OK.

### Still unproven
- **Live:** a team-record card in a real game hasn't been seen yet.
- **Hand reading:** the records were read by eye from images; a misread digit is possible. Each card names its guide page, so it can be checked.
- **NBA Live may have its own franchise-record cards;** if so, the two may overlap.
- **Not included:** playoff single-game franchise records and half/quarter records.

## 0.46.0 (2026-11-12): Franchise totals checked against all 30 team media guides; 5 reading errors fixed

### Why
- **The user** asked whether each team PDF had been checked. Only the Lakers, Raptors, Heat and Hawks lists had been, and some of the "45 of 45" figures had been checked from memory. Each team guide's franchise leader numbers are now matched against ours, for all 30.

### What we found and fixed
- **First pass:** by searching each guide's text for our top-10 franchise totals (points, rebounds, assists, steals, blocks, 3s, games), about 1,550 of 2,100 matched exactly. The misses showed real errors in our reading of the NBA Guide's team pages:
  1. **Names ending in "Jr."/"Sr." were dropped** (Otto Porter Jr., Kelly Oubre Jr., Troy Brown Jr., Jaren Jackson Jr., …): 2,000+ player-seasons. `tools/parse-team-rows.py` now reads them.
  2. **A header spread over 7 lines** (1991-92 Trail Blazers) was skipped. Drexler's 1,903-point season was missing, so he showed 16,137 Portland points instead of the guide's 18,040. Headers spread over several lines are now read both line by line and by column; the reading the first player's numbers agree with is kept (points = 2×FGM + 3PM + FTM, rebounds = offensive + defensive).
  3. **A missing stat printed ". ."** (two dots) dropped the row: Rudy Tomjanovich's 1976-77 (1,753 points; Rockets total now 13,383, as in the guide).
  4. **A name alone on its line** with the numbers on the next (Jim Les, 1994-95 Hawks) is joined.
  5. **Two stints years apart were split** as if two players. Pippen (1987-98, 2003-04) now has 15,123 Bulls points, Willis 10,582 Hawks points, Kidd, Elvin Hayes and others are whole, as the team guides count them.
     - Names are split now only when first and last seasons are more than 22 years apart (Bobby Jones DEN 1976-77 and 2007-08, Nate Williams GSW, …) or when listed as two players (Mike James NOP, Charles Jones CHI).
- **After the fixes:** 1,787 of the 2,100 top-10 totals are found exactly in the team guides (from about 1,550). Portland, Brooklyn, Dallas, the Lakers, Orlando and Toronto: all 70 of 70. Most of the rest are layout misses (below), not different numbers.
- **Also fixed:**
  - **"Johnny Kerr"** (1957-58 page) is the same player as "Red Kerr": Kerr's 76ers rebounds are now 9,506, as in the 76ers guide.
  - **Team-total rows printed in mixed case** ("New York", "Opponents") are no longer counted as players.
  - **Karl Malone's missing 2001-02 row** is now the Jazz's totals row minus every other player. That gives all his stats, not just five. Its G, FGM, FTM, PTS, STL and REB (686) match the guide's leader lines and the Jazz guide.
- **New check, `tools/check-team-rows-totals.py`:** every team-season with a totals row (1979-80 to 2025-26: 1,312 of them) must equal the sum of its printed players, in every stat. All 1,312 match in every stat except turnovers (team turnovers) and minutes (rounding). The one exception, 2001-02 Utah, is the Malone row above. Before these fixes, 182 didn't.

### Still differing from a team guide
- **Pre-1979 seasons have no totals rows to check.** A few old totals differ slightly from a team's own guide: Arizin's rebounds 6,120 vs 6,129, Naulls 4,982 vs 5,015, Guerin 10,366 vs 10,392, Seymour's assists 2,299 vs 2,335. Kerr's points are 11,699 here vs 11,059 in the 76ers guide; his rebounds match exactly, so that one looks like a slip in the 76ers guide. For players retired that long, this only moves when a pass is flagged.
- **Some guides didn't match well by text search** (Cleveland, Denver, New Orleans, Thunder, Phoenix). Their leader pages lay out names and numbers apart, so they're unconfirmed by this method rather than wrong. Their seasons from 1979-80 on pass the totals check.
- **No overrides from the team guides yet:** our totals stay as the NBA Guide's rows add up.

### Tested
- 585 checks pass, with 8 more known totals (Drexler 18,040; Pippen 15,123; Willis 10,582 points and 7,332 rebounds; Tomjanovich 13,383; Kerr 9,506 rebounds; Malone 14,601 rebounds; Unseld 10,624).
- The franchise items rebuild: 85 within reach, 56 season paces.

## 0.45.3 (2026-11-12): All-Star Game career leaders among active players (NBA Guide pp. 34-35)

### What changed
- **The 17 "MOST" lists on pp. 34-35** are now read: active players' All-Star Game career totals through the 2026 game, top 10 or more each. Examples: LeBron 23 games and 449 points; Durant 284; Curry 216; Giannis 199; Chris Paul 128 assists.
  - **Where:** `src/data/nba-postseason-careers-2026-27.json` `careers.allStarActive`, and on the Records tab as "All-Star Game, active players: …" lists.
  - **How:** `tools/parse-postseason-careers.py` takes more list files. The rebuilt file is identical otherwise.
- **`tools/parse-career-lists-bbox.py`:** its imports were missing in the committed copy (it ran on the PC from an older copy). Restored.
- **Not read:** pp. 34-35's per-game average tables (with minimums). They're reference only.

### Tested
- 584 checks pass; the page sweep is OK; the rebuilt postseason file matches the old one in every list it had.

### Still unproven
- **No All-Star alerts yet:** the All-Star Game is in February, and NBA Live's bridge doesn't watch All-Star games.

## 0.45.2 (2026-11-12): #lineups flags a swap that doesn't fit the season, and rechecks every minute

### Why
- **The user:** the Sixers' 6:50 PM "LINEUP CHANGE" (Justin Edwards in, Jaylen Brown out) "definitely raises suspicions since Jaylen Brown has started every game he has played."
- **The facts:**
  - Brown: 11 starts in 11 games, and not on the 11/12 injury report. Edwards: 0 starts in 5 games.
  - Brown started (ESPN's box score), and NBA.com's file now shows him too.
  - The file still had Edwards at our last read, 2 minutes before tip, so it was likely an entry slip on NBA.com's side, corrected at or after tip.

### What changed
- **New `suspicion()` in `cloudflare/lineups.js`:** flags a player going OUT who has started every game he has played (3+) this season and isn't on tonight's injury report (`docs/data/injuries.json`, today's only). "Out" means:
  - for a change card, compared with the five we last posted;
  - for a first card, compared with the team's last game.
- **The flag on the card:** "⚠️ Check before using: Jaylen Brown has started all 11 games he's played and isn't on the injury report (Justin Edwards 0 starts in 5 games). Could be an NBA.com entry error; rechecking every minute until tip."
- **After a flagged card,** NBA.com's file is read every minute (not every 3) until tip. A correction then posts as its own change within a minute, and the flagged card is marked REPLACED (0.45.1).

### Tested
- **Watcher checks:** 59 pass, including:
  - the Brown/Edwards case flagged;
  - no flag when the player out is on the injury report (Embiid, questionable);
  - an old injury report doesn't count;
  - a flagged team read every minute until tip.
- **Full suite:** 584 pass.

### Still unproven
- **Live:** not seen yet; it needs a night with such a swap.
- **The injury report** comes from our site (updated by the daily builds). A player added to the report in the last hour can be flagged wrongly; the card says "check", it doesn't block the post.

## 0.45.1 (2026-11-12): #lineups: confirmed times in Eastern; a replaced card is marked REPLACED

### Why
- **The user (11/12, 9:34 PM):**
  - Why did "Confirmed" say early afternoon?
  - Why was the Hornets post formatted differently?
  - Did the Sixers start a different five than confirmed? If so, that should be announced or carried over.

### What we found (the Worker's stored times, read through a new read-only workflow; times only)
- **The confirmed times were 5 hours early:**
  - NBA.com stamps its lineup times in Eastern clock time with no zone; we read them as UTC.
  - DET/WAS was stamped 18:34 and first seen by us at 6:35 PM. It showed as "Confirmed 1:34 PM".
  - Tonight's real confirmations were 22-30 minutes before tip. The summary said 322-330 minutes; its "+18095s" lags were the same 5 hours.
  - Every card was posted within 35-45 seconds of our first sight of it.
- **Hornets:** the Worker posted CHA's card at 8:37:34 PM, the same second as PHX's, as a normal card. The night's summary followed after the last tip check. Discord itself drew the 9:29 PM text block in the screenshot (both posts' text under one header, no card). Nothing we send is plain text, so no code change.
- **Sixers:**
  - **6:40 PM:** confirmed and posted.
  - **6:50 PM:** NBA.com changed the five. A "LINEUP CHANGE" card was posted.
  - **7:12 PM:** ESPN's box showed a third five had started (Edgecombe, Brown, Maxey, Wade, Embiid; NBA.com's file shows that five now). A red "STARTED DIFFERENTLY" card with those five was posted.
  - So the change was announced; the earlier cards were left as they were.

### What changed
- **`cloudflare/lineups.js` `feedTime`:** reads NBA.com's stamps as Eastern time (EST or EDT, right on the night the clocks change). A stamp with a zone is kept as given. Card footers and the nightly summary's "minutes before tip" are right from tomorrow.
- **A replaced card is marked:** when a change posts before tip, or a different five starts, the previous card is edited in place. It turns grey and its header reads "⚠️ REPLACED (changed at 6:50 PM ET / a different five started) · see the newer post". Nobody reads an old five as current. The Worker now keeps each team's last card id for the night.
- **New `.github/workflows/lineups-timing.yml` reader** (run by hand): prints the night's timing from the Worker's storage. It prints times and results only, with no names, because the repository's logs are public.

### Tested
- **Watcher checks:** 57 pass, including:
  - feed times as Eastern (EST and EDT; a zone given is kept);
  - the earlier card greyed and marked REPLACED when a change posts, and again when a different five starts at tip.
- **Full suite:** 583 pass.

### Still unproven
- **Editing cards in Discord:** a webhook can edit its own messages, but this hasn't been seen in the channel yet. It needs a night with a change.
- **Tonight's cards and summary** keep the wrong times; Discord posts aren't re-edited after the fact.

## 0.45.0 (2026-11-12): Franchise single-season records, on pace

### Why
- **The user** asked what can be done without PC access (the team PDFs and the All-Star pages are on the PC). The NBA Guide's team rows (already in the cloud since 0.44) hold every player's season with every team. So each franchise's best seasons can be built from them, and players flagged while they're on pace.

### What changed
- **`tools/franchise_names.py`:** the franchise names and the row cleanup (team totals, slips, short names) moved out of `build-franchise-careers.py`, to be shared. Its output is byte-for-byte the same.
- **New `tools/build-franchise-seasons.py` → `src/data/nba-franchise-seasons-2026-27.json`:** each franchise's top 10 single seasons in points, rebounds, assists, steals, blocks, 3-pointers, FGM, FTM, offensive and defensive rebounds.
  - **Per game:** the top 10 in points, rebounds, assists, steals, blocks and 3-pointers, among seasons of 70% of the team's games.
  - **Counting:** only his games with that team. The team's games come from its totals row.
- **New `src/records/franchiseSeason.js`:** for each player's current team, from 10 team games on:
  - **Pace:** his total plus his rate per team game over the games left, so missed games count against him. Listed when it would be a top-3 season.
  - **Per game:** once he has played 70% of the team's games since his first game for them. Listed when it would be a top-3 season.
  - **Example:** "Wembanyama: on pace for 362 blocks, which would be the most in a season in Spurs history (record: David Robinson, 320 in 1990-91)".
- **Records tab:** a "Franchise season records, on pace" table (totals or per game, stat, team). `records.json` gains `seasonPace`.
- **Storylines:** a record pace (1st only) can be the game's one context line (low priority). Tonight: Robinson's 4.2 threes a game (Pistons record pace) and Grayson Allen's 283-three pace (Hornets).

### Tested
- **Checks** (581 pass):
  - the best seasons against known records: Wilt 4,029; Jordan 3,041; Kobe 2,832; Harden 36.1 a game; Stockton 1,164 assists; Curry 402 threes; Robinson 320 blocks;
  - team games of 50 (1998-99) and 71 (2019-20);
  - the pace formula; the per-game qualifier.
- **Built:** 56 top-3 paces, 26 for the record. Page sweep OK.

### Still unproven
- **Early-season noise:** with 10-13 games played, paces swing. 3-pointer records are the most common hits, since modern volume beats every franchise's history.
- **Old per-game seasons:** the 70% qualifier is ours. The NBA's own qualifiers changed by era, so an old per-game list can differ slightly from a team guide's.
- **A player hurt before his first game for a team:** his pace counts from his first game, so the team games he missed before it don't count against him.
- **Single-game franchise records** ("most points in a game in Grizzlies history") are not built. The guide's season-high column starts in 1973-74, so it would miss older records (Wilt's 100). These need the team PDFs (PC).

## 0.44.0 (2026-11-12): Franchise history for every player on all 30 teams (NBA Guide year-by-year team pages)

### Why
- **The user:** the 30 team media guides in "Team PDF", and franchise records worth alerting on before they happen. The team guides' leader pages come in 30 layouts that don't read cleanly. The NBA Guide's year-by-year pages print every player's line with every team since 1946-47, so the franchise lists are built from those instead and checked against the team guides.

### What changed
- **`tools/parse-team-rows.py`:** every team-by-team regular-season player row in the NBA Guide's year-by-year pages, 1946-47 to 2025-26 (33,793 rows, 80 seasons, 71 team names), in any of the guide's layouts. Fixes found while checking totals:
  - **Headers broken over several lines** (1990-91 to 1993-94, 2018-19): the team's name is printed across the column labels. Before, those teams' rows went to the team above. E.g. Harden's 2018-19 Rockets season was counted for Golden State.
  - **Labels printed together** ("FGAFG%", "FG%3PM", "Pts.Avg.Bob"): split, and the first name glued to the header goes back on its row (Bob Pettit, 1954-55).
  - **A header printed twice** (1960-61 Knicks).
  - **"NEW ORLEANS/OKLAHOMA CITY HORNETS"** (2005-06, 2006-07) is now read.
- **`tools/build-franchise-careers.py` → `src/data/nba-franchise-careers-2026-27.json`:** each player's totals with each of today's 30 franchises, relocations included. Stats: games, points, rebounds (offensive and defensive too), assists, steals, blocks, FGM, FTM, 3PM.
  - **Each franchise:** its top 60 per stat, plus the totals there of every player active in 2024-25 or 2025-26.
  - **Rows left out:** team and opponents totals, and a traded player's totals across teams ("(!)", "‡").
  - **Short and squashed names merged:** "K. Abdul-Jabbar" → Kareem Abdul-Jabbar, "KermitWashington" → Kermit Washington.
  - **Two players with one name** at one franchise are split at gaps of 6+ seasons. A player active now keeps all his stints since 2003-04.
  - **Two corrections, both written down in the file:**
    - Karl Malone's 2001-02 Jazz row is missing from the guide (p. 597). His G, FGM, FTM, PTS and STL that season come from the guide's leader lines for that season.
    - Pete Maravich's 1977-78 row has a stray "8" before PTS; his points are taken from his made shots.
- **New `src/records/franchise.js`:** each franchise's lists as they stand now. A total is last season's total plus his games for that team this season.
  - **When an item is listed:** when a current player is within 10 games of passing a name for a place in the franchise's top 10, or top 20 in points, rebounds and assists.
  - **Example:** "Barnes: 14 rebounds from passing DeMar DeRozan (2,739) for 7th in Raptors history".
  - **Team changes:** a player traded in starts from his total with them. One with a retired player's name and no total there is a different player.
- **`scripts/situations.js`:** franchise items join the records with odds. A Tip-Off Guide franchise mark that says the same thing is dropped. `records.json` gains `franchise` (each team's top 25 per stat).
- **Records tab:** a "Franchise history, now" table (team and stat), and the "Within reach" filter is now "Franchise history".
- **NBA Live and storylines:** franchise items already flow to both through records.json (kind "franchise"), as the Tip-Off franchise marks did.

### Tested
- **Checks:** 579 pass, including:
  - totals against the team media guides and the Tip-Off Guide: 45 of 45 match. Examples: Kobe 33,643, Magic's 10,141 assists, Kareem's 2,694 Lakers blocks, Pettit 7,349 FGM and 792 games, Tree Rollins 814 games, Hakeem 26,511, Malone 36,374, Stockton 15,806 assists, Ewing 23,665, DeRozan 13,296, Haslem 5,791;
  - no team-total rows; LeBron keeps his 23,119 Cleveland points;
  - a pass with the place it's for; a new player with a retired player's name gets his own row.
- **Tip-Off Guide's franchise pages:** all 6 totals they give match.
- **Teams' game notes:** all 17 franchise figures they print for tonight's players and the names ahead of them match (now on the Checks line).
- **Built:** 85 franchise marks within reach, 22 for players playing tonight. Example: Scottie Barnes 3 offensive rebounds from passing Jakob Poeltl for 5th in Raptors history (41% tonight). Page sweep OK.

### Still unproven
- **Live in NBA Live:** a franchise pass firing in a live game hasn't been seen. It runs through the same path as the Tip-Off franchise marks (bridge v3), which were tested.
- **Stats the guide didn't keep:** steals, blocks and offensive/defensive rebounds start in 1973-74, and 3-pointers in 1979-80. Older players' totals in those stats are what the guide has (none).
- **Malone's 2001-02 season:** his minutes, rebounds, assists and blocks aren't counted.
- **Rows with no total:** a franchise whose top-60 list ends above a current player's total can't rank him. He gets a dash, as on the all-time lists.
- **The team media guides' other pages** (single-game franchise records, season records) aren't read.

## 0.43.0 (2026-11-12): This season vs his career (the NBA Guide's year-by-year stats)

### Why
- **The user:** the 700+ year-by-year pages, "year-over-year comparisons that shed more light on performances this season, like James Harden's dip".

### What changed
- **`tools/parse-season-lines.py`:** every regular-season player stat line in the NBA Guide, 1979-80 to 2025-26 (28,133 rows from 372 pages; 2025-26 on pp. 10-19, earlier from p. 270), in the 23-column layout. A traded player's lines are told apart by the guide's marks: "(!)" totals for all his teams, "(*)" his last team, "(>)" a team he left.
- **`tools/build-career-seasons.py` → `src/data/nba-career-seasons-2026-27.json`:** the seasons of the 716 players active in 2024-25 or 2025-26 (4,789 seasons).
  - A traded season is his "(!)" total.
  - A name two players shared is split into careers at gaps of 4+ seasons (Gary Payton II stays apart from his father).
- **New `src/records/yoy.js`:** each player's per-game points, rebounds, assists, 3-pointers and minutes this season (8+ games) against every season of his with 20+ games:
  - **big swings from last season** (5+ points, 3+ rebounds or assists, 1.5+ threes), with where it sits in his career. Example: "Harden: 16.7 points a game, down 6.9 from 23.6 in 2025-26; his lowest since 2023-24 (16.6)";
  - **lowest / highest since** a season 5+ years back, or a **career low / high**.
- **Records tab:** a "This season vs his career" table (filter by kind, stat, team, player).
- **Storylines:** at most 1 context line a game, ranked low (shown when there's room): regulars only (24+ minutes a game last season), points, rebounds or assists, a big swing or a career low/high from a real role (15+ points, 7+ rebounds, 5+ assists). Tonight: Embiid 17.7 points (career low; questionable), Trae Young 18.3 (career low), LaMelo Ball 6.0 assists (career low), Jalen Green 11.8 points (career low).
- **NBA Live bridge:** icons for the "record" and "context" pre-game lines.

### Tested
- **Checks** (575 pass):
  - Harden's 17 seasons and LeBron's 23; Gary Payton II not mixed with his father;
  - a big drop from last season worded with the last season he was that low;
  - one context line a game, a regular's, never a bench player's.
- **Built:** 250 notes. E.g. Ty Jerome up 13.7 points to a career high; Markkanen down 8.7 (lowest since 2021-22); DeRozan 10.0 (lowest since 2009-10).
- **Rendered:** page sweep OK.

### Still unproven
- **Before 1979-80:** seasons in the older layouts (no 3-pointers) aren't read; no active player played then.
- **Rookies:** this season's rookies have no history.
- **Young careers:** a player with fewer than 3 seasons of 20+ games gets no context.

## 0.42.0 (2026-11-12): All-Star, Play-In, playoff and Finals career lists and single-game lists (NBA Guide pp. 157-186)

### What changed
- **`tools/parse-career-lists-bbox.py`** reads the career "MOST <stat>" lists from word positions. Titles sit mid-column there, so a list is the lowest title above an entry in its column. Plus `tools/parse-postseason-careers.py` → `src/data/nba-postseason-careers-2026-27.json`:
  - career leaders (top 10, ties kept) for the All-Star Game (pp. 158-159), Play-In (166-167), playoffs (175-176) and Finals (185-186), up to 19 stats each;
  - All-Star selections by player (pp. 160-161; 466 players).
- **`tools/parse-single-game-bests.py`** also reads the Play-In (pp. 164-165), playoff (171-174) and Finals (181-184) single-game lists. Headings followed by their column labels are now recognized too.
- **NBA Live bridge:** on a playoff slate (NBA Live's own `isPlayoffSlate()`), the playoff single-game lists replace the regular season's.
- **Records tab:** the postseason and All-Star career lists in the list selector (as of 2025-26; not updated during the season). The record book's lists line shows each book's single-game floors.

### Tested
- **Checks** (572 pass):
  - **Careers:** playoffs (LeBron 8,521 points; Magic first in assists), Finals (West), All-Star (LeBron 449), Play-In (Curry), selections (LeBron 22).
  - **Single-game lists:** playoffs 63 top / 49 floor, Finals 61, Play-In 50.
- **Rendered:** page sweep OK.

### Still unproven
- **Not kept current:** the postseason and All-Star careers aren't updated during the season (they'd be in the playoffs and February).
- **Missing:** the Play-In and Finals single-game lists have no playoff-slate switch of their own in the bridge yet (Finals games use the playoff lists).

## 0.41.0 (2026-11-12): Former MVPs, Finals MVPs and DPOYs named in record storylines

### What changed
- **`src/anticipate/tonight.js`:** a record line (passing an all-time name, a round number, a franchise or Cup record) for a player with a headline award carries it: "James (4× MVP): 11 assists from passing Jason Kidd (12,091) for 3rd all-time (54% tonight)". MVP, Finals MVP or DPOY only, whichever comes first in his résumé (from the NBA Guide's award history, 0.38). Goes to the Watch List, NBA Live's pre-game cards and the #alerts digest.

### Tested
- **New check** (570 pass): a 4× MVP's line carries "(4× MVP)"; a Sixth Man's doesn't.

## 0.40.0 (2026-11-12): Franchise streak records; reference tables (NBA Guide pp. 25-28, 44-45, 137-148)

### Why
- **The user:** "run what must be done". Next on the NBA Guide list: pp. 25-28, 44-45, 137-148.

### What changed
- **`tools/parse-franchise-streaks.py` → `src/data/nba-franchise-streaks-2026-27.json`:** every franchise's longest winning and losing streak within a season (pp. 142-143), with the seasons and earlier cities (Vancouver for Memphis, Seattle for OKC).
- **`src/records/guide.js`:** a team within 2 of its franchise streak record (winning or losing; 3+ straight) gets an item: "Wizards: lost 15 straight; a loss tonight ties the franchise record (16, ...)". These go to tonight's storylines when tonight's game decides it (like the NBA's own streak lists in 0.31). None is close today: the longest active runs are the Spurs' 10 wins (franchise 19) and the Jazz's 10 losses (franchise 18).
- **`tools/parse-guide-reference.py` → `src/data/nba-guide-reference-2026-27.json`:** stored for later, nothing alerts on them yet:
  - the 2025 NBA Cup individual leaders (pp. 27-28: points, rebounds, assists, steals, blocks, minutes, per game);
  - career playoff leaders among active players (pp. 44-45, 19 lists).
- **Left out:**
  - **pp. 25-26:** active career leaders (the Tip-Off Guide's lists, already used).
  - **pp. 137-141:** the remaining top 10s (already in the Tip-Off Guide and the user's top-40 lists) and combined NBA/ABA lists.
  - **p. 141:** neutral-court records.
  - **pp. 142, 146-148:** best single-season records, attendance.
  - **pp. 144-145:** coaching, done in 0.34.

### Tested
- **Checks** (569 pass): all 30 teams in both lists (Lakers 33 wins, Pistons 28 losses, the Memphis-era record kept beside Vancouver's), a team one loss from tying its record tonight, the reference tables (Brunson 199 Cup points in 2025, LeBron 8,521 playoff points).

## 0.39.0 (2026-11-12): NBA Live bridge v3: career records and the all-time single-game lists, live

### Why
- **NBA Live** was the next step for the records work: the Command Center now knows the career lists (to 40th), NBA Cup careers, franchise records and the NBA's single-game lists, but NBA Live only knew the top single-game marks.

### What changed
- **`docs/bridge/cc-bridge.js` v3**, during games:
  - **Career records** from `records.json`, live: passing a name on the all-time lists (to 40th; points to 68th), round career numbers, franchise records, and NBA Cup career marks (only in Cup games). Example: "Kevin Durant (HOU) — passes Shaquille O'Neal (11,330) for 7th all-time". Same gates as the notes' milestones: a card while in play (10%+ pre-game) or when reached; 6 a game. A milestone the team's notes already carry is left to that card.
  - **The NBA's all-time single-game lists** (`ref/nba-single-game-bests.json`): a player within a few of a list ("5 from the NBA's all-time single-game list (57+, 153 games)") or on it ("58 points: tied for the 111th-most in a game on the NBA's all-time list (153 games of 57+)"). On Cup nights the NBA Cup's own lists are checked too. NBA Live's own record cards (the top mark, rookie, team, half and quarter records) are left to NBA Live.
- **Never breaks NBA Live:** the new checks run inside the bridge's existing try/catch, after NBA Live's own checks.
- **`tools/check-nba-live.py`** serves `records.json` and the single-game lists too, and reports the record count.

### Tested
- **Real NBA Live** (`nba-live_14.html`), 11/11 with GSW at HOU replayed as live: connected, 870 milestones + 161 records. In the 4th quarter: "Kevin Durant (HOU) — passes Shaquille O'Neal (11,330) for 7th all-time", the fact @NBAPR posted that night. No bridge errors. The page errors are the test's blocked hosts.
- **New stand-in checks** (6):
  - a career pass reached and re-worded for now;
  - a Cup mark counting down in a Cup game;
  - a long shot gets no card; a milestone the notes carry gets no duplicate;
  - making a single-game list with the right place (ties counted), nearing it, and the Cup list on a Cup night;
  - a final game without a list game gets no card.

### Still unproven
- **Not in the user's NBA Live yet:** the user's NBA Live still needs the one bridge line (from 0.6.0) for any of this to show.
- **Not checked by the bridge:**
  - half and quarter records (NBA Live has its own);
  - triple-doubles and wins are counted at the end, not live.

## 0.38.0 (2026-11-12): Award résumés on the Records tab

### Why
- **The user:** next NBA Guide task, put the award history (pp. 100-121, parsed in 0.34) to use.

### What changed
- **New `src/records/awards.js`:** each player's and coach's major awards through 2025-26: MVP, Finals MVP, DPOY, Rookie of the Year, Sixth Man, Most Improved, Clutch Player, conference finals MVPs, All-Star MVP, Coach of the Year. For example "4× MVP · 4× Finals MVP · Rookie of the Year · 3× All-Star MVP".
- **`tools/parse-history.py`:** shared awards are now read for both winners. The second name is printed on the next line with "(tie)" (e.g. the 2009 All-Star MVP, Kobe and Shaq), and was missed before: 665 winners, up from 647.
- **The build** writes the résumés of every name the Records tab shows (`awards` in `docs/data/records.json`).
- **Records tab:** the résumé next to each name in "Within reach", the all-time lists and the title races.

### Tested
- **Checks** (560 pass): Kobe "MVP · 2× Finals MVP · 4× All-Star MVP", Shaq "MVP · 3× Finals MVP · Rookie of the Year · 3× All-Star MVP" (both 2009 and 2000 shared All-Star MVPs counted), Jokić with or without the accent, Mazzulla Coach of the Year.
- **Rendered:** page sweep OK.

### Still unproven
- **Not in storylines yet:** e.g. "four-time MVP LeBron James..." phrasing.
- **Not used for "first MVP to..." facts:** those need the stat history the guide doesn't have per player.

## 0.37.0 (2026-11-12): Stat title races in history (NBA Guide yearly leaders)

### Why
- **The user:** next NBA Guide task, one at a time: the yearly statistical leaders (pp. 122-127). The first attempt (0.34) couldn't read them, because column widths change by page.

### What changed
- **`tools/parse-yearly-leaders.py`:** reads the pages from word positions (`pdftotext -bbox`). Each column is read top to bottom, and a category title switches the category. Every season's leader from 1946-47 to 2025-26 for points, rebounds, assists, steals, blocks, FG%, FT%, 3P%, minutes and fouls (disqualifications left out: ties break the list). Merged into `src/data/nba-history-2026-27.json` as `leaders`.
- **New `src/records/titles.js`:** the top 3 per game this season in points, rebounds, assists, steals and blocks (qualified at 70% of the team's games), each with what a title would mean: his Nth title and the last one, and the last time his team had the leader.
- **Records tab:** a "Stat title races, in history" table.

### Tested
- **The data:** every season once, without gaps, for the 5 main stats (Doncic 2025-26 scoring, Elmore Smith the first blocks leader in 1973-74); spot-checked against the pages.
- **Built now:** Doncic 38.6 (would be his 3rd scoring title); Wembanyama 30.3 (San Antonio's last: David Robinson, 1993-94); Towns 13.5 rebounds (New York's last: Harry Gallatin, 1953-54); Davion Mitchell 8.5 assists (no Miami player has led the league); Walker Kessler 2.2 blocks (the Lakers' last: Kareem, 1979-80).
- **New checks** pass.

### Still unproven
- **Team history** goes by the guide's team names, so a franchise's earlier city doesn't count (Seattle for OKC, Buffalo/San Diego for the Clippers).
- **Qualification** is 70% of team games, not the NBA's exact minimums.

## 0.36.0 (2026-11-12): Career lists 40 deep (and triple-doubles, 2-point field goals)

### Why
- **The user** sent current career leader lists (top 40, through 11/11) for rebounds, offensive and defensive rebounds, assists, steals, blocks, FGM, FTM, 3PM, games, minutes, triple-doubles (to 72), turnovers and 2-point FGM: "the command center didn't have appropriate numbers".

### What changed
- **`src/data/career-leaders-2026-11-11.json`:** the lists, typed from the user's screenshots. Left out: minutes (not counted down) and turnovers (not a milestone anyone posts).
- **`src/records/guide.js`:**
  - **Totals:** a live player's listed total is taken back to the start of the season (his games through the list's date removed), so later games add once.
  - **Ranks:** where a list is complete (top 40, or 68 for points), a rank is today's place among everyone above the list's floor. That gives ranks to 40th in every stat (it was the top 10 plus the names the guide mentions).
  - **New stats:** 2-point field goals (FGM - 3PM) and triple-doubles have full lists. LeBron needs 71 two-point field goals to pass Karl Malone for 2nd.
- The build picks up the newest `career-leaders-<date>.json`.
- The Records tab adds 2-point field goals to the list selector.

### Tested
- **Against the lists:** all 532 entries equal our own totals through 11/11 exactly. So the totals were right before; what was missing was depth.
- **Two disagreements** with the guides, shown under Checks: Al Horford's defensive rebounds (the list gives 1 fewer than the Tip-Off Guide at the start of the season) and Dolph Schayes's free throws (6,712 here, 6,979 in the NBA Guide's scorers table, an old-records difference).
- **Built:** 218 marks within reach (was 163), e.g. Drummond 7 rebounds from passing Ewing for 26th, Paul George 1 steal from passing Hersey Hawkins for 32nd, DeRozan 13 two-point field goals from passing Durant for 21st.
- **New checks:** 557 pass.

### Still unproven
- **Updates:** the lists are a snapshot; ranks beyond them still come from the guides. New snapshots go in as new dated files.

## 0.35.0 (2026-11-12): NBA Cup all-time standings, kept current

### Why
- **The user:** "and the emirates cup tasks too?" The Cup media guide still had one thing the NBA Guide doesn't: all-time Cup standings (p. 31). Its player and team records (pp. 43-53) are the same entries as the NBA Guide's record book (checked: e.g. most minutes 51 Harden, most points 60 Fox, points in a half 33 Fox, points in a quarter 26 Haliburton). They're already on the Records tab.

### What changed
- **`tools/parse-cup-guide.py`** also reads pp. 31-32: each team's all-time Cup record (overall, home, road; 2023-2025, knockout and Championship games included). The check: 30 teams, 201 wins, matching the guide's totals.
- **`src/records/cup.js`:** the standings plus this season's Cup results, overall, home and road; this season's Cup record; Cup games left.
- **Records tab:** an "NBA Cup all-time standings" table with each team's next Cup game.

### Tested
- **Bucks 14-3 in the guide:** now 14-4 with this season's loss; Lakers 14-4, Magic 12-4, Knicks 13-5.
- **New checks** (555 pass): this season's Cup results added on the right side (overall, road).
- **Rendered:** page sweep OK.

### Still unproven
- **The Cup guide's single-game bests** (pp. 33-38) aren't compared line by line with the NBA Guide's (p. 149); the pages checked match.

## 0.34.0 (2026-11-12): Every head coach's milestones; award history

### Why
- **The user:** "don't forget the nba guide pdf tasks either". Next on the list: coaching rankings (p. 145), award winners (pp. 100-121), yearly leaders (pp. 122-127).

### What changed
- **`tools/parse-coaches.py` → `src/data/nba-coaches-2026-27.json`:** the 79 coaches with 300+ wins (W-L, rank) and the top 20 by games coached.
- **Coaches on the Records tab:** today's head coach for each team comes from ESPN's rosters (read in the same pass as the players). Every ranked coach is followed, not just Carlisle, Spoelstra and Kerr. A coach's wins and games = the guide's + his team's games this season.
  - **Items:** passing the next ranked coaches, plus every 100th win and 100th game.
  - **Examples now:** Nurse 3 wins from passing Brad Stevens for 62nd; Mike Brown 5 from passing Terry Stotts for 38th; Snyder 7 from passing Stotts.
  - **Not followed:** coaches under 300 wins.
- **`tools/parse-history.py` → `src/data/nba-history-2026-27.json`:** award winners for 18 single-winner awards (MVP, ROY, DPOY, MIP, 6MOY, Clutch, Coach, Finals MVP, conference finals MVPs, All-Star MVP and others; 647 winners). Stored for reference; nothing uses it yet.

### Tested
- **Coaches:** Carlisle 1,012-923 (11th), 1,935 games, as on the Tip-Off Guide; a name sharing a line with a heading read right (Bill Russell). All 30 head coaches read from ESPN.
- **Awards:** 71 MVPs, 1955-56 to 2025-26 (Gilgeous-Alexander); Finals MVPs from 1969.
- **New checks:** 554 pass.

### Still unproven
- **Yearly statistical leaders** (pp. 122-127) are not read. The columns change width from page to page, and the plain-text order separates seasons from names. The parser keeps a list only if it runs without a gap to 2025-26; none does yet.
- **Coaches' totals** assume each coach ran every game this season (an interim game would be counted for him).

## 0.33.0 (2026-11-12): NBA Cup career lists, kept current from the Cup media guide

### Why
- **The user** added the Emirates NBA Cup 2026 media guide: it gives the Cup nights (pp. 4, 8, 9) and the Cup's records. Marking Cup games was the missing piece for tracking Cup career totals (0.32.0's "still unproven").

### What changed
- **`tools/parse-cup-guide.py` → `src/data/nba-cup-2026-27.json`:** the 60 Group Play games (group, teams, date, time; every Friday 10/30-11/27 plus Tue 11/24 and Wed 11/25), the knockout dates (quarterfinals 12/4-5, semifinals 12/8-9, Championship 12/11), and the all-time Cup leaders for 12 counting stats (pp. 39-42).
- **New `src/records/cup.js`:** picks this season's Cup games out of the box scores by the schedule (date and teams), adds them to the guide's Cup totals, and lists the Cup marks a player can still reach in his remaining Cup games. These include passing a listed name, or "for the NBA Cup record". Games played and minutes aren't listed. The chances cover his Cup games left. Knockout games will count by date once they're played (a game on 12/4-5 or 12/8-9).
- **Storylines:** a Cup line when it's 25%+ in tonight's Cup game (the first Cup night it applies to is 11/13).
- **Records tab:** "NBA Cup career" in the kind filter; NBA Cup lists in the all-time list selector; Cup progress in the header.

### Tested
- **The schedule:** 60 games, 4 per team, 9 on 11/13; all 19 games played so far found in the box scores.
- **Built with this season's data:** 117 Cup marks within reach. The Cup points list now: Gilgeous-Alexander 530, Dončić 516, Antetokounmpo 484, Brunson 481.
- **New checks** (551 pass): schedule and leaders, only scheduled Cup games counted, Cup totals plus this season, no games-played passes.
- **Rendered:** page sweep OK.

### Still unproven
- **The guide's lists** are the top 10 per stat (ties included), so ranks beyond 10th aren't known.
- **Knockout games** are matched by date alone. That's safe only if no other game is played between those two teams on those dates.
- **Not parsed yet:** the media guide's single-game bests, team and player records (pp. 33-38, 43-53). The NBA Guide's record book already has the Cup records (0.32.0).

## 0.32.0 (2026-11-12): The NBA Guide: points ranks to 68th, the Elias record book, single-game lists

### Why
- **The user** added the NBA's 2026-27 Guide (1,010 pages) and listed the useful pages: career leaders, single-game bests, NBA Cup records ("very much worth tracking now"), All-Star (February), Play-In and playoff records (later). Single-game records are wanted as a reference for NBA Live.

### What changed
- **Career scorers** (p. 136; `tools/parse-career-scorers.py` → `src/data/nba-career-scorers-2026-27.json`): all 68 players with 19,000+ points, in order, with their career totals. The Records tab's points list now ranks to 68th (it was the top 10 plus the names the Tip-Off Guide mentions), so e.g. "Davis: 19 points from passing Bernard King for 54th all-time".
- **Elias record book** (pp. 198-268; `tools/parse-record-book.py` → `src/data/nba-record-book-2026-27.json`): 1,324 records with 5,036 marks in 6 books (regular season, NBA Cup, All-Star, Play-In, playoffs, Finals). Each has its scope: game, half, quarter, overtime, streak, season or career. Ties and wrapped lines are kept with their mark.
- **Single-game lists** (pp. 128-135 and 149; `tools/parse-single-game-bests.py` → `src/data/nba-single-game-bests-2026-27.json`): every game on the NBA's lists, plus each list's floor (regular season: 57 points, 11 threes, 38 rebounds, 22 assists; NBA Cup: 39 points, 8 threes...).
- **Records tab:** a "Record book" section (filter by book, scope, players or teams, search) and the single-game floors. The build copies both files to `docs/ref/`.
- **`tools/record-book-md.py`:** a readable reference (game, half, quarter, overtime and streak records first) for NBA Live.

### Tested
- **Against the Tip-Off Guide:** every one of the 68 scorers' totals (points, games, FGM, FTM, rebounds, assists, minutes) agrees with every Tip-Off Guide total for the same player; Davis 61st and George 62nd in both.
- **Against the notes:** 17 of 18 totals agree. Anthony Davis's assists differ by 1 (ours 2,083 from the guide's 2,082 career + this season; WAS notes 2,082). Shown on the page; not resolved.
- **New checks** (548 pass): the 68 scorers; no conflicting totals; record book marks (Adebayo's 83, Klay's 14 threes, Fox's 60 in the Cup), scopes; single-game floors and the row whose numbers wrapped (Joe Fulks, 63).
- **Rendered:** page sweep OK at both widths.

### Still unproven
- **NBA Cup career totals** aren't tracked live: the box scores don't mark which games are Cup games yet.
- The record book is reference only: nothing yet checks a live game against it (that's NBA Live's job).
- The guide's pages 25-28, 34-35, 44-45 and 100-127 (awards, season leaders, All-Star, active playoff leaders) aren't parsed yet.

## 0.31.0 (2026-11-12): Records tab: career leaderboards and records kept current, and what's within reach

### Why
- **The user:** "milestones and leaderboards are a must" from the Tip-Off Guide; the numbers are from before the season and need updating; "with these other leaderboard numbers, you should be able to track and create alerts worth monitoring before they happen". Opening-night and season-opener records: not wanted.
- This is layer 2 of the NBA PR test set (all-time leaderboards, `claude/nbapr-targets.md`).

### What changed
- **`tools/parse-tipoff-guide.py` → `src/data/tipoff-guide-2026-27.json`:**
  - career leaders (pp. 92-97): top 10 all-time and among active players for 12 stats, plus the totals in the per-game lists;
  - milestone watch (pp. 76-82): each player's totals and ranks, the players ahead of him, the round numbers named;
  - coaches (p. 83), franchises' all-time records (p. 90), win streaks, best starts and home/road streaks (pp. 100-103).
  - **Self-check:** every "needs N to pass No. R Name (V)" and "needs N to reach V" sentence must agree with the player's total (69 checks). It found one slip in the guide (Gobert: "532 to reach 8,000" defensive rebounds; his total gives 531), kept as an erratum.
- **New `src/records/guide.js`:**
  - **totals now** = the guide's total + this season's box scores (all teams, so a trade doesn't lose games). Names must match with suffixes kept (the guide's Gary Payton is not Gary Payton II);
  - **the lists now**, re-ranked as listed players pass each other (e.g. Curry 19th → 16th in points);
  - **within reach (15 games)**: passing a numbered all-time name, round career numbers, franchise records (Adebayo, Booker, Tatum), coaches' wins and games (Carlisle, Spoelstra, Kerr), a team's next win reaching the NBA's streak or best-start lists, franchise win milestones and all-time .500. An NBA record chase stays listed while it's reachable this season (LeBron's wins);
  - **chances** tonight and in the next 5 games, from his games this season (`src/anticipate/model.js`).
- **The build** (`scripts/situations.js`) writes `docs/data/records.json`, with a cross-check against the same totals in the teams' notes and ESPN's career stats.
- **Storylines** (Watch List, NBA Live pre-game cards, the #alerts digest): a "record" line when it's 25%+ tonight, or a coach's or team's milestone tonight's game decides. The notes' own version of the same milestone wins; a notes history line about the same pass gives way.
- **New page `docs/records.html` ("Records" tab, in every page's nav):** tonight; everything within reach (filter by kind, team, games away); the all-time lists now with rank changes; the checks.
- **Daily build** also runs on changes to `src/records/**` and `src/data/**`.

### Tested
- **Against @NBAPR's posts** (the test set), rebuilt with only the games before each date:
  - 11/5: "Curry: 3 points from passing Oscar Robertson (26,710) for 17th all-time" (NBAPR: 3);
  - 11/10: "James: 16 assists from passing Jason Kidd (12,091) for 3rd all-time" (NBAPR: 16);
  - 11/11: "Durant: 3 field goals from passing Shaquille O'Neal (11,330) for 7th all-time" (NBAPR: 3).
- **Against the notes and ESPN:** 16 of 16 totals printed in both agree exactly (17 of 17 in the earlier dry run).
- **New checks** (544 pass): the parsed guide; totals plus this season (a DNP adds nothing); ranks moving; a broken franchise record not listed; coach totals; a team streak reaching the list; the suffix rule; chances; storylines with and without the notes' version and the history line.
- **Built with this season's data:** 42 guide players playing this season, 40 milestones within 15 games. Today's 4 games have none likely tonight (LeBron is out).
- **Rendered:** page sweep OK at both widths (9 nav links).

### Still unproven
- **Ranks** are only as good as the guide's lists: top 10, plus the names its milestone pages mention. A player outside those (e.g. 40th in assists) can't be seen passing anyone, and no rank is shown for an unlisted total.
- **Coaches** assume the coach ran every game this season.
- **Minutes** aren't counted down (box-score minutes are rounded).
- **Played games** are counted when a box line shows minutes or a stat; a 0-minute, 0-stat appearance would be missed (the NBA counts it).
- Players the guide doesn't mention get round numbers from the existing ESPN-only path (held for review), not from here.

## 0.30.0 (2026-11-12): National TV tab: players and teams on national TV vs other games

### Why
- **The user:** separate performances in national broadcast games (ESPN, ABC, NBC, Peacock, Amazon Prime) to see who performs well with the bigger spotlight. They sent the NBA's 2026-27 Tip-Off Guide (111 pages), which has the national schedule: "not really forecasting but it gives us a baseline".

### What changed
- **`src/data/national-tv-2026-27.json`:** the guide's national schedule, 236 games.
  - **Pages:** 16 ABC (Christmas games simulcast on ESPN), 17 ESPN, 18 NBC/Peacock, 19 Peacock (Mondays), 20 Prime Video.
  - **Left out:** NBA TV (p. 21) and ESPN Radio (p. 22) are not national TV here.
  - **The parser** is `tools/parse-national-tv.py` (networks are logos, so the page-to-network map is in the script).
- **New `src/situations/national.js`:**
  - each player's per-game numbers in national games vs all other games: MIN, PTS, REB, AST, 3PM, STL, BLK, TOV, +/-, FG%, TS%;
  - only games he played count; a traded player's games are combined, shown under his current team;
  - each team's record in national vs other games.
- **The build** (`scripts/situations.js`) writes `docs/data/national.json`: the splits, the next 14 national games, and how many are played.
- **New page `docs/national.html` ("National TV" tab, added to every page's nav):**
  - next national games with network and time;
  - a player table (national / other / change for each stat), sortable by any stat's change, "bigger" or "smaller" on national TV;
  - filters: team, national games played (default 2+), minutes a game (default 15+), name;
  - team records.
  - **Green / red** marks a clear change: 2+ PTS/REB/AST/3PM, 5+ TS%, 3+ +/-.
- **Page sweep:** expects 8 nav links and includes the new page.

### Tested
- **Against ESPN:** the national schedule matches ESPN's national broadcasts for every date 10/20-11/12. All 26 games played so far match, and ESPN shows no national game the guide lacks. ESPN lists the 3 Monday Peacock games as NBCSN (the Peacock/NBCSN simulcast).
- **New checks** (530 pass):
  - the schedule's 236 games: valid teams and dates, only the 5 networks, 5 on Christmas, GSW at HOU on ESPN 11/11;
  - national vs other per player across a trade (latest team shown); a 0-minute game not counted;
  - team records;
  - per-game averages, FG% and TS%.
- **Built with this season's data:** 26 of 236 national games played; 225 players with a national game.
  - e.g. Paul George 29.7 PTS on national TV (3 games) vs 18.7 otherwise;
  - Curry's national average includes the 11/11 game he left early, so read the games and minutes columns first.
- **Rendered:** no page errors; page sweep OK at both widths.

### Still unproven
- **Early samples:** 2-5 national games a player so far. The split means more by January.
- **Schedule changes:** flexed games, or ones added after the guide was printed, won't count until the schedule file is updated. A periodic check against ESPN's national listings would catch that.

## 0.29.1 (2026-11-12): articles: The Athletic's NBA news live blog

### Why
- **The user** pointed to The Athletic's NBA live blog ("posting stuff that could be useful, but I don't know how long it'll last").
- **Checked through the Worker:**
  - It's a weekly blog (this one runs 11/9 6 AM to 11/16 3 PM ET), linked near the top of The Athletic's NBA page.
  - Its posts sit in the page's `__NEXT_DATA__` JSON, each with a writer, a publish time, a title (sometimes blank), the text, and any article it links to.

### What changed
- **`LIVE_FEED` in `cloudflare/articles-worker.js`:** on minute 3 of every 5 (after that minute's team feeds, one after the other, as both update the articles state):
  - **Finding the blog:** the top of The Athletic's NBA page (120 KB) gives the current NBA news blog, so next week's is picked up on its own (`findLiveBlog`).
  - **Reading it:** the blog page's posts are read (`parseLiveBlog`).
  - **Posting:** each new post goes to #articles as "📝 Live blog" with its writer (staff bylines left off), title (or first sentence), and up to 900 characters of text.
  - **The usual rules apply:** muted writers and phrases, the 6-hour limit, the first read is silent.
  - **No double posts:** an article a post links to is marked posted, so it won't post again from a feed (e.g. Curry's MRI result: the blog post and the Warriors-feed article).
- **Review page:** shows the live blog's status.

### Tested
- **New checks** (55 watcher checks pass):
  - the news blog is found among other live blogs;
  - posts are read with text minus HTML, a staff byline dropped, and the linked article;
  - an untitled post is titled by its first sentence;
  - a new post goes to #articles once;
  - the linked article in the Warriors feed isn't posted again.

### Still unproven
- **Live:** whether reading the full blog page (~540 KB) every 5 minutes fits the free plan's CPU time. The first live read follows this deploy.

## 0.29.0 (2026-11-12): articles: The Athletic's 30 team feeds

### Why
- **The user** flagged two Athletic stories that never reached #articles: "Knicks' Mikal Bridges is starting, not finishing" (6:00 AM) and "Warriors' Stephen Curry to be re-evaluated in 2 weeks after MRI reveals oblique abdominal tear" (12:06 PM).
- **Checked through the Worker** (new private `/peek?list=`):
  - The Athletic's NBA feed (100 items) carries neither.
  - The Bridges story is only in the Knicks feed (`/athletic/rss/nba/knicks/`).
  - The Curry result is a new article (new URL) in the Warriors feed only. The NBA feed still lists the 10:31 PM "gets MRI" story under its old title.
  - Team feeds carry 200 items each, and all 30 exist. Slugs are team nicknames, except `sixers` and `sac-kings`.

### What changed
- **`TEAM_FEEDS` in `cloudflare/articles-worker.js`:** the 30 team feeds, read on the 1-minute schedule in 4 groups of 7-8 (minutes 1-4 of every 5; the articles check runs on minute 0), so each is read every 5 minutes.
  - **Only the top of each feed:** the newest 60 KB (download stopped there), to stay inside the free plan's CPU budget.
  - **A feed read for the first time:** its current items are marked seen quietly. No flood of posts or log rows.
  - **Items over a day old** are marked seen without logging (a long feed's back pages would otherwise come round again when "seen" expires after 5 days).
  - **Duplicates:** a story in both the NBA feed and a team feed posts once (same URL).
  - **Labels:** team-feed posts are labeled "Athletic (NYK feed)" on the review page.
- **Review page:** "The Athletic team feeds: N of 30 OK", plus any errors.
- **Private diagnostics:** `/peek?list=nba/<team>` lists a feed's items; `/peek?page=<athletic URL>&find=` shows part of a page (used for the live blog).

### Tested
- **New checks** (50 watcher checks pass):
  - 30 feeds in 4 groups, none on minute 0, each exactly once;
  - the `sixers` / `sac-kings` slugs;
  - first read is silent;
  - a new Bridges story posts once with the team label;
  - only the top of a 2,000-item feed is read.

### Still unproven
- **Live CPU use** with 7-8 feeds a minute. If Cloudflare reports exceeded limits, read fewer feeds a minute (every team feed every 10 minutes instead of 5).
- **Updates to an existing URL** still aren't seen: feeds keep an article's first title and time.

## 0.28.1 (2026-11-12): the GitHub digest sender is off; Cloudflare sends #alerts

### Why
- **Avoiding a double post:** with both senders on, 11/12 would have posted twice (the Worker at 2 PM, GitHub after its 3 PM build). The Worker sends as soon as its secret exists, at any time before tip, so nothing is lost by switching now.

### What changed
- **`daily.yml`:** the "Post tonight's storylines to Discord" step is removed. No GitHub step receives `DISCORD_WEBHOOK` any more; the user can delete that repository secret.
- **`scripts/notify.js`** stays for a manual send.
- **The workflow check** now asserts that no GitHub step gets the webhook or runs notify.js.

### Tested
- **Checks:** 517 pass.
- **Live Worker, dry run** (`/digest`, 1:40 PM): it read the site's 11/12 data (4 games) and nothing was due yet.

### Still unproven
- **The first send:** waiting on the `ALERTS_WEBHOOK` secret in Cloudflare. Until it's added, #alerts gets nothing. Once it is, today's evening games post right away (it's after 2 PM) if they haven't tipped.

## 0.28.0 (2026-11-12): the #alerts storylines digest sent by Cloudflare, on time, around early tips

### Why
- **The user** asked why #alerts had nothing by 1:28 PM. The digest goes out on the first GitHub build at or after 2 PM, and GitHub's scheduled runs start late (11/11: the 3 PM run 87 minutes late, the 5:30 run never; digest at 5:50 PM. 11/12: the 10:30 run at 11:27).
- **The user also asked** about days with tips before 2 PM: the digest would have arrived after those games started (nothing left them out).
- **Agreed design:** Cloudflare sends it. Games tipping before 4 PM ET go out 2 hours before tip; the rest at 2 PM; never a game that has tipped. Two more GitHub builds keep the data fresh.

### What changed
- **New `cloudflare/digest.js`, on the Worker's 1-minute schedule** (with lineups):
  - reads the site's `docs/data/tonight.json` from GitHub: once from 8 AM to learn the day's tips, then only when a game is due;
  - sends each game once: "Afternoon storylines … (tip before 4 PM ET)" 2 hours before an early tip; "Tonight's storylines" at 2 PM for the rest;
  - a game that has tipped is never sent;
  - if the day's data isn't built yet, it waits and sends as soon as it is;
  - KV `digest` holds today's schedule and what was sent.
- **Secret `ALERTS_WEBHOOK`** (#alerts; added by the user in Cloudflare): without it the Worker sends nothing.
- **Private endpoints:** `/digest?k=…` reports what's due without posting; `&test=1` posts a TEST line to #alerts.
- **Shared formatter `src/anticipate/discord-digest.js`** (no imports), used by both the Worker and `scripts/notify.js`. It takes a heading and note; `tonight.js` re-exports it, with a copy in `docs/lib`. The Worker redeploys when it changes.
- **`daily.yml`:** two more builds, 8 AM ET (13:00 UTC) and 1 PM ET (18:00 UTC).
- **The GitHub sender (`scripts/notify.js`)** stays on until the Worker's test post works, so no day is missed; then it's turned off (next version).

### Tested
- **New checks** (46 watcher checks pass):
  - due times (12:30 → 10:30; 3:30 → 1:30; 4:00 and 7:30 → 2:00 PM);
  - due games once each, never after tip;
  - a full day: 7:55 nothing; 8:00 one read; 8:01 nothing; 10:30 the 12:30 game as "Afternoon storylines"; 2:00 PM the evening game alone;
  - data not built: waits, then sends only the untipped game;
  - nothing without the secret.
- **The existing digest checks** pass with the shared formatter (510).

### Still unproven
- **The Worker's first real send:** waiting on the `ALERTS_WEBHOOK` secret and the test post.

## 0.28.0 (2026-11-12): the #alerts storylines digest sent by Cloudflare, on time, around early tips

### Why
- **The user** asked why #alerts had nothing by 1:28 PM. The digest goes out on the first GitHub build at or after 2 PM, and GitHub's scheduled runs start late (11/11: the 3 PM run 87 minutes late, the 5:30 run never; digest at 5:50 PM. 11/12: the 10:30 run at 11:27).
- **The user also asked** about days with tips before 2 PM: the digest would have arrived after those games started (nothing left them out).
- **Agreed design:** Cloudflare sends it. Games tipping before 4 PM ET go out 2 hours before tip; the rest at 2 PM; never a game that has tipped. Two more GitHub builds keep the data fresh.

### What changed
- **New `cloudflare/digest.js`, on the Worker's 1-minute schedule** (with lineups):
  - reads the site's `docs/data/tonight.json` from GitHub: once from 8 AM to learn the day's tips, then only when a game is due;
  - sends each game once: "Afternoon storylines … (tip before 4 PM ET)" 2 hours before an early tip; "Tonight's storylines" at 2 PM for the rest;
  - a game that has tipped is never sent;
  - if the day's data isn't built yet, it waits and sends as soon as it is;
  - KV `digest` holds today's schedule and what was sent.
- **Secret `ALERTS_WEBHOOK`** (#alerts; added by the user in Cloudflare): without it the Worker sends nothing.
- **Private endpoints:** `/digest?k=…` reports what's due without posting; `&test=1` posts a TEST line to #alerts.
- **Shared formatter `src/anticipate/discord-digest.js`** (no imports), used by both the Worker and `scripts/notify.js`. It takes a heading and note; `tonight.js` re-exports it, with a copy in `docs/lib`. The Worker redeploys when it changes.
- **`daily.yml`:** two more builds, 8 AM ET (13:00 UTC) and 1 PM ET (18:00 UTC).
- **The GitHub sender (`scripts/notify.js`)** stays on until the Worker's test post works, so no day is missed; then it's turned off (next version).

### Tested
- **New checks** (46 watcher checks pass):
  - due times (12:30 → 10:30; 3:30 → 1:30; 4:00 and 7:30 → 2:00 PM);
  - due games once each, never after tip;
  - a full day: 7:55 nothing; 8:00 one read; 8:01 nothing; 10:30 the 12:30 game as "Afternoon storylines"; 2:00 PM the evening game alone;
  - data not built: waits, then sends only the untipped game;
  - nothing without the secret.
- **The existing digest checks** pass with the shared formatter (517 in all).
- **Deployed:** the Worker deployed (bbd0abd).

### Still unproven
- **The Worker's first real send:** waiting on the `ALERTS_WEBHOOK` secret and the test post.

## 0.27.1 (2026-11-12): articles: skip The Bounce, sports trivia and fantasy from The Athletic; seen time on the review page

### Why
- **The first morning review (6-9 AM, 11/12):** 2 posts. ESPN's trade-deadline questions (good) and The Athletic's weekly sports trivia (noise).
- **The user:**
  - no trivia, no fantasy, no podcast posts from The Athletic ("The Bounce is not needed");
  - keep the sports watch guide (it covers the NBA too);
  - no rule for unsigned roster moves (news breakers report trades hours before they're official);
  - they ✅'d the Caleb Wilson injury story, which was skipped about 10 minutes before the injury rule went live.

### What changed
- **`ATHLETIC_SKIP` in `cloudflare/articles-worker.js`:** Athletic titles starting "The Bounce", containing "sports trivia", or "fantasy" are skipped with that reason. Every other Athletic NBA story still posts.
- **Review page:** each row also shows when the watcher first saw the item and how many minutes after publishing ("seen 6:55 AM · +2 min"). The Discord posts already said this in their footer ("Published … · seen N min later"); the page now shows it for skipped items too, in one place.

### Tested
- **New checks** (39 watcher checks pass): The Bounce, trivia and fantasy skipped; the watch guide and a title like "Bouncing back…" still post; the review page shows the seen time.

## 0.27.0 (2026-11-12): current teams from ESPN rosters, with NBA.com's official moves as the fallback

### Why
- **The user** asked how rosters are confirmed (Nique Clifford, traded SAC → OKC, showed as a King in NBA Live).
- **The Command Center already had him on OKC**, because he has played for OKC since 11/10. But between a trade and a player's first game for the new team, the league-wide lists showed the old team: they used the team in his last box score.
- **The user pointed to nba.com/players/transactions** as a fallback that checks official changes. Not a Discord feed (trades are reported long before they're official).

### What changed
- **New `src/rosters/current.js`:** each player's current team, decided in this order:
  1. **His newest official move** on NBA.com (`stats.nba.com/js/data/playermovement/NBA_Player_Movement.json`, the data behind that page), dated on or after his last game, if it moves him. A trade or signing elsewhere → that team; waived → no team. This applies even when ESPN still lists him on the old team.
  2. **Otherwise ESPN's roster:** all 30 teams are read on every build, and they only count if all 30 were read.
  3. **Otherwise** his last box score.
  - Waived then re-signed by the same team = no change. Contract conversions (two-way ↔ standard) are ignored.
- **The build** (`scripts/situations.js`) writes `docs/data/rosters.json` (only the players who moved, with source and date; no NBA.com text). The league-wide lists show the current team with "from SAC" beside it (hover: moved or waived, with the date; "these numbers are from SAC"): Clutch and 4th-quarter players, and active Streaks.
- **Team-specific numbers keep the team they belong to:** Team leaders, With / without, the team files.
- **Push builds:** `daily.yml` also builds on pushes to `src/rosters/**`.

### Tested
- **Live run:** 30/30 ESPN rosters and 624 NBA.com moves this season read.
  - 4 players moved since their last game: Enaruna (CLE), Terry (OKC) and Lovering (LAL) waived, all three from NBA.com (11/7, 11/8, 11/10); Pedulla HOU → SAC from ESPN's roster.
  - Clifford isn't listed: his last game is already with OKC.
  - Rendered: Dalen Terry shows "no team · from OKC" (hover: "waived 2026-11-08; these numbers are from OKC").
- **New checks** (507 pass):
  - moves read (a trade with its from-team; waivers; conversions and last season's moves skipped);
  - an official trade after his last game wins over a stale ESPN roster (Clifford);
  - waived → no team; waived then re-signed → no change; ESPN otherwise;
  - a move before his last game doesn't count;
  - ESPN ids match ours.
- **Page sweep:** OK.

### Still unproven
- **Name matching:** NBA.com moves are matched to players by name (NBA.com and ESPN ids differ). A player whose name is spelled differently on the two sites would be missed by the NBA.com check; ESPN's roster still catches him.
- **Usage limits:** NBA.com's file is read in the GitHub build (three times a day and on code pushes), under the user's personal-use decision; only team codes appear on the site.

## 0.26.0 (2026-11-12): Team situations: opponent records "today" or "at the time", and a .500 column

### Why
- **The user asked** whether "vs teams over .500" uses the opponent's record before the game or now (now, recomputed each build). They also asked where exactly-.500 teams go (they counted as ".500 or below").
- **This season:** 73 of 340 team-games (21%) would change column under the record-at-the-time rule. 30 of those were against 0-0 teams on opening night, and 32 against teams exactly .500 at the time. One team (CLE, 6-6) is exactly .500 today.
- **The user picked:**
  - a toggle between today's record and the record at the time;
  - a separate .500 column, shown only when some opponent is exactly .500.

### What changed
- **`src/situations/records.js`:**
  - **Today's records:** `vsAbove` (over .500), new `vs500` (exactly .500) and `vsBelow`, which is now strictly under .500 (it was ".500 or below").
  - **New at-the-time splits** `vsAboveThen` / `vs500Then` / `vsBelowThen`, by the opponent's record going into that game (games before that date). Games against a 0-0 team fall in none of them.
  - **Flags:** the at-the-time splits get expected wins and colors, but aren't flagged or listed as unusual (they're the same games as today's splits; flagging both would double the false alarms).
- **`docs/situations.html`:**
  - an "Opp. record today / At the time" toggle;
  - columns vs >.500 · vs .500 · vs <.500, with ".500" shown only when some team has a game against an exactly-.500 opponent in that mode;
  - sorting by one of these columns carries over when switching mode;
  - tonight's matchup cards follow the toggle;
  - the footer explains the rule in use.

### Tested
- **New checks** (502 pass):
  - records going into each game (AAA–BBB both 0-0: no bucket; CCC met AAA at 1-0: over; DDD met BBB at 1-1: .500; BBB met DDD at 0-1: under);
  - a .500 split only where an opponent is exactly .500;
  - at-the-time splits never flagged or listed;
  - a team at .500 today goes in "vs .500".
- **Rebuilt with this season's data and rendered:**
  - today: vs >.500 / vs .500 / vs <.500 (CLE 6-6 makes the .500 column appear);
  - at the time: LAL 5-1 / 1-0 / 4-1 (the rest of their 11-2 came against 0-0 teams).
  - No page errors; page sweep OK.

### Still unproven
- **Labels:** "vs <.500" is now strictly under .500, so a few unusual-record lines read "against teams under .500" where they said ".500 or below".

## 0.25.4 (2026-11-12): nightly lineup timing summary

### Why
- **The user** wants to see, after the first live night, how close to 30 minutes before tip each lineup was confirmed.

### What changed
- **Per team, the lineups state now records times** (no names):
  - when NBA.com stamped the five confirmed;
  - when our check first saw it;
  - when the post went out;
  - any later changes;
  - the tip-off result.
- **When the night is done** (every team's starters checked after tip), the Worker:
  - keeps the night's timing in KV `lineups-timing:<date>` for 8 days (minutes before tip, lag in seconds, changes, tip result; no lineups);
  - posts one "Lineup timing · tonight" summary to #lineups: each team's confirmation and post time in minutes before tip, the median, and how many landed in the 31-29 minute window.
- **Private endpoint `/lineups?k=…&timing=YYYY-MM-DD`** returns a night's timing (or today's state while the night is on).

### Tested
- **New checks** (37 watcher checks pass): the timing per team (NBA.com stamp 60.0 min before tip, seen 90.0, one change, tip result) holds no names; one summary posted when the night is done, with "not confirmed before tip" for a team that wasn't.

## 0.25.3 (2026-11-12): lineup checks concentrated 31-29 minutes before tip

### Why
- **The user:** starting lineups usually land about 30 minutes before tip, so that is the window that matters. Check every 5 minutes from 90 to 31 minutes out (the rare early confirmations still get caught), every 20 seconds from 31 to 29 minutes out, then every 3 minutes until tip.

### What changed
- **NBA.com's file, by minutes before each game's scheduled tip:**
  - 90, 85, … 35: every 5 minutes;
  - 31 → 29: every 20 seconds, 7 reads in all. Cloudflare's cron fires at most once a minute, so the runs at 31 and 30 minutes out each read three times (:00, :20, :40), waiting in between. Waiting costs no CPU time; a scheduled run may last up to 15 minutes;
  - 29, 26, … 2: every 3 minutes.
  - **Replaced rule:** 0.25.2's "every 3 minutes once confirmed" is gone. The timing is now by the clock, whatever the status.
- **From tip:** unchanged. ESPN's box every minute until it shows who started.
- **`feedDue(tip, t)`** holds the timing in one place. One read covers every game, so a read happens whenever any game is due.

### Tested
- **New and rewritten checks** (35 watcher checks pass), on a 7:30 PM tip:
  - the exact read times: 6:00 … 6:55 every 5 minutes; 6:59:00, :20, :40, 7:00:00, :20, :40; 7:01, 7:04 … 7:28; none at or after 7:30;
  - the runs at 6:59 and 7:00 read three times each and 7:01 once; 7:02 doesn't read;
  - no repeat post;
  - a change posts on the next 3-minute check;
  - tip-off and end of day as before.

### Still unproven
- **The 20-second reads live:** the first real window is 31 minutes before 11/12's first tip.

## 0.25.2 (2026-11-12): lineup timing set by the user (90-minute window; 5 / 3 / 1 minutes)

### Why
- **The user:** no need to read NBA.com every 5 minutes all day. Start 90 minutes before the scheduled tip; every 5 minutes until the five is confirmed; every 3 minutes once confirmed, until tip; at tip, every minute for the late-scratch check.

### What changed
- **The Worker has two schedules** (`wrangler.toml`): `*/5` runs the articles check only (as before); `* * * * *` runs the lineups check only. Each is its own run with its own CPU budget (free plan: ~10 ms), so the per-minute ESPN read can't push the articles check over.
- **Lineups (`cloudflare/lineups.js`), per team, from each game's scheduled tip** (ESPN scoreboard, read once a day):
  - **before T−90 min:** nothing is read;
  - **T−90 until the five is confirmed:** NBA.com's file on minutes divisible by 5;
  - **confirmed, until tip:** on minutes divisible by 3, so a change after confirmation posts within 3 minutes. One read covers every game, so it happens whenever any team is due;
  - **from the scheduled tip:** ESPN's box for that game every minute until it shows the five, giving up 45 minutes after tip (a delayed game is still caught, up to 45 minutes late).
  - NBA.com's file is no longer read after a game's scheduled tip.
- **KV state:** today's schedule and per-team expected / posted / tip result. Written only when something changes (about 100 writes on a full night; the free limit is 1,000 a day). One small KV read a minute from 10 AM.

### Tested
- **New and rewritten checks** (33 watcher checks pass), on a 7:30 PM tip:
  - nothing read at 5:30;
  - read at 6:00, 6:03 and 6:05 but not 6:04;
  - posted once;
  - a change at 6:06 posts within the 3-minute cycle;
  - at 7:30, ESPN only (no NBA.com read), with a late swap and a never-confirmed team both posted;
  - done at 7:31;
  - the 5-minute schedule runs articles and the 1-minute schedule runs lineups.

### Still unproven
- **Live on 11/12:** the first window opens 90 minutes before the first tip.

## 0.25.1 (2026-11-12): lineups without position labels; who actually started, checked after tip

### Why
- **The user, on the test post:** drop the position labels, keep the PG, SG, SF, PF, C order. Also: lineups are sometimes confirmed and then changed; will the program catch that?
- **Before tip, it already did:** a confirmed five that changes in NBA.com's file posts a red "LINEUP CHANGE". After tip it stopped reading, so a late scratch in warmups that never reaches NBA.com's file was missed.

### What changed
- **Posts list the five by name only,** still ordered PG to C.
- **After tip-off, who actually started** (ESPN's box score, `starter` flag; ESPN's NY/SA/GS/NO/UTAH/WSH mapped to NBA codes) is checked against the confirmed five. Tried each run until ESPN's box has the five, at most 12 tries a team.
  - **Different:** a red "STARTED DIFFERENTLY · ESPN box score" post with who's in and out, ordered with NBA.com's positions where known. NBA.com's pre-game inactive list is left off.
  - **A team with no confirmed five before tip:** "Starters at tip (none confirmed before)" with the five and the change from its last game.
  - **Same:** nothing posted.
- **The day ends** once every game has tipped and every team's starters were checked (or 12 tries ran out).

### Tested
- **New checks** (31 watcher checks pass):
  - ESPN starters read and mapped (NY → NYK);
  - a late swap after confirmation posts "started differently" with the right in/out, PG-to-C order and no inactive list;
  - a never-confirmed team gets its starters at tip;
  - the day ends only after the tip checks.
- **The 11/11 ESPN box** (IND–WAS) gives both fives, matching NBA.com's confirmed fives.

### Still unproven
- **The tip-off check live:** first real night is 11/12.

## 0.25.0 (2026-11-12): confirmed starting lineups to a private #lineups channel

### Why
- **The user:** could nba.com/players/todays-lineups be used to send confirmed starting lineups to Discord?
- **The page** loads a daily file (`stats.nba.com/js/data/leaders/00_daily_lineups_YYYYMMDD.json`): each team's five with positions, the bench, inactives, and "Expected" / "Confirmed" with the time.
- **The user's decision:** it's for their own use, not Underdog's. NBA.com's terms allow personal, non-commercial use (Section 1) and statistics for "private, non-commercial purposes" (Section 9). So: a private channel, nothing on the public site, no lineup history kept.

### What changed
- **New `cloudflare/lineups.js`, run by the ncc-articles Worker on its 5-minute schedule** (no computer needed). From 10 AM ET until the day's last game tips:
  - **Reads the day's file.** Before it's up, NBA.com redirects to an error page: nothing happens.
  - **Posts once per team when its five is Confirmed** before tip-off: positions PG to C, plus what changed vs the team's last game (from our box-score file on GitHub), what changed vs the five listed as Expected earlier that day, and inactives.
  - **Colors:** green = same five as last game; amber = a change; red = "LINEUP CHANGE", a confirmed five that changed again before tip (posted again).
  - **State:** KV `lineups` holds only today's expected and posted fives, replaced each day, and written only when something changes.
- **Secret `LINEUPS_WEBHOOK`** (#lineups, private; added by the user in Cloudflare). Without it the lineup check does nothing.
- **Private endpoint `/lineups?k=…`:** `&dry=1` reports without posting; `&date=YYYYMMDD` reads another day; `&test=1` with a past date posts one sample, marked TEST.

### Tested
- **The real 11/11 file:** 10 games, 17-18 players a team, starters marked by position, inactives listed. Times are UTC (IND confirmed 22:49 = 5:49 PM ET).
- **Live, after deploy (2:15 AM 11/12):** the Worker read the 11/11 file from Cloudflare (status 200, 10 games, every five right), and `&test=1` posted a sample (IND) to #lineups; Discord accepted it.
- **New watcher checks** (29 pass; they also run before every deploy): starters, order and status; UTC times; in/out; last game's starters; post text (vs last game, vs expected, inactives); dry run posts nothing; posted once; a change after confirmation posts again; stops after every game has tipped; nothing before 10 AM ET.

### Still unproven
- **The live timing:** how early "Confirmed" appears (the 11/11 file suggests 45-75 minutes before tip). Tonight is the first real night.

## 0.24.1 (2026-11-12): With / without counts games a player sat before his debut (from the injury reports)

### Why
- **The user:** Kon Knueppel has played one game this season (11/4), yet With / without said "missed 2". He was out from opening night. Basketball-Reference shows 1 game played, 10 inactive.
- **Cause:** "missed" counted only from a player's first box score, so that games before a trade weren't held against him. ESPN's box scores leave inactive players out entirely, so a player injured from opening night looked like he joined on the day he debuted.

### What changed
- **New `src/injuries/history.js`:** each game date's final official injury report is read once and kept in `history/injuries/<date>.json` (team, player, status, reason). Late at night the report can already list the next day's games, so earlier 15-minute slots are tried until one lists that date. The build (`scripts/situations.js`) fetches any missing dates (up to 40 a run) and adds `inj: { id: status }` to each game in `docs/data/teams/<TRI>.json` (`{}` = report read, nobody listed; no key = no report).
- **`src/situations/withwithout.js`:**
  - **When he's counted with the team:** from the first game he was in the box score or on the team's injury report, to the last such game. Games where he's in no box score and on no report, after he's gone, aren't counted as missed (a trade or a waiver). Games with no report on file are counted as before.
  - **Why he missed each game:** the reason is kept (`withoutWhy`: Out / DNP / not in box score). The injury impact lines in the storylines use the same code, so they get the corrected records too.
- **Bug fixed along the way:** the report writes dates zero-padded ("11/02/2026"), and tonight's injury step compared them to "11/2/2026". On days 1–9 of a month the Watch List and storylines would have shown no injuries. Now dates are compared as dates (`isoDate`).

### Tested
- **All 22 game dates this season** read (14 on the first pass; the other 8 needed the earlier-slot and date fixes above).
- **Knueppel:** 1 played, 10 missed, all "Out" on the report (10/21–11/2, 11/6, 11/9). CHA without him: 4-6, matching the team's results in the user's Basketball-Reference log. Rendered on the page: "Kon Knueppel · 6.0 mpg · missed 10"; "without: 4-6, average margin -11.7 (10 games…)".
- **League-wide, 72 players' missed counts changed.** Up where a player was hurt from the start: Coby White 0→7, Nic Claxton 0→8, T.J. McConnell 0→9, Santi Aldama 0→8. Down where a player left: Dalton Knecht's Lakers count 12→2 after his move to the Knicks.
- **New checks** (481 pass): games on the report before a debut count; games after he's gone don't; zero-padded report dates; report names matched only to that team's players. Page sweep OK.

### Still unproven
- **Players who haven't appeared in any box score** (injured all season) can't be matched to an ESPN id, so they don't appear in the picker yet.
- **A two-way player on G League assignment** is listed "Out" on the report and counts as missed. That's true, but not an injury.

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
