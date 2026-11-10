# Changes

Each entry: what changed, how it was tested, and what is still unproven.

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
