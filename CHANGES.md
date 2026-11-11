# Changes

Each entry: what changed, how it was tested, and what is still unproven.

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
