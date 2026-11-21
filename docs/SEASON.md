# Season rollover checklist

The Command Center is set up for one season at a time: `SEASON` in `src/season.js` (now `2026-27`). From **August 1** the calendar is in the next season, and two things say so until the rollover is done:

- every build adds a "season:" warning to the page and the build log;
- the check "the calendar is still in 2026-27" fails on every test run, so no code change can publish until this list is done.

The new guides come out in the fall, so do the steps in order as each source appears. Change `SEASON` last: with it changed and a file missing, the build fails loudly instead of reading last season's.

## 1. Key dates (from the league's announced calendar)

- [ ] **Trade deadline:** add the new season to `DEADLINE` in `src/anticipate/seasonlong.js` (`"2027-28": "YYYY-MM-DD"`).
- [ ] **NBA Cup final:** add its date to `CUP_TITLE_DATES` in `src/situations/results.js`. Cup title games count in no regular-season record; this is the only list, since `scripts/tonight.js` reads it too.

The build warns when either is missing for the season in `SEASON`.

## 2. Reference files (from the new guides), one per row

Each is rebuilt from the new season's source with its tool, then saved under the new season's name (`…-2027-28.json`). Keep last season's file until the new one has passed its checks.

| File (`src/data/…-SEASON.json`) | Source | Tool |
|---|---|---|
| `nba-record-book`, `nba-single-game-bests` | NBA Guide (record book, single-game lists) | `tools/parse-record-book.py`, `tools/parse-single-game-bests.py`, `tools/record-book-md.py` |
| `nba-guide-reference`, `nba-history`, `nba-coaches`, `nba-postseason-careers`, `nba-career-scorers` | NBA Guide | `parse-guide-reference.py`, `parse-history.py` / `parse-yearly-leaders.py`, `parse-coaches.py`, `parse-postseason-careers.py`, `parse-career-scorers.py` |
| `nba-career-seasons` | career lines through last season | `build-career-seasons.py` |
| `tipoff-guide`, `national-tv` | Tip-Off Guide (incl. the national TV schedule) | `parse-tipoff-guide.py`, `parse-national-tv.py` |
| `nba-cup` | NBA Cup media guide | `parse-cup-guide.py` |
| `nba-franchise-careers`, `nba-franchise-seasons`, `nba-franchise-streaks`, `nba-franchise-single-game`, `team-game-records`, `nba-series-history`, `series-bests`, `last-time`, `guide-games` | the 30 team media guides | `build-franchise-careers.py`, `build-franchise-seasons.py`, `parse-franchise-streaks.py`, `parse-series-bests.py`, `parse-last-time.py`, `guide_games.py`; team marks: `sweep-team-marks.mjs` then `mark-sources.mjs` |
| `nba-team-seasons` | every franchise's season records | `build-team-seasons.py`, `fetch-older-results.mjs` |
| `player-feat-runs` (`.json.gz`) | box scores through last season | `node tools/build-feat-runs.mjs --through 2026-27 --out src/data/player-feat-runs-2027-28.json.gz` |
| `knicks-team-seasons` | the Knicks' team stats (the brothers angle) | `parse-knicks-team-stats.py` |

`career-leaders-<date>.json` is dated, not seasonal: replace it when a new list is sent.

## 3. One-off tools that name the season's files

These run only by hand, so they aren't covered by `SEASON`: change their file names when you next use them. `tools/check-league-book-vs-guides.mjs`, `check-team-records.mjs`, `check-team-marks.mjs`, `check-period-points.mjs`, `check-period-marks.mjs`, `check-series-outside.mjs`, `sweep-team-marks.mjs`, `mark-sources.mjs`, `fetch-older-results.mjs`, `build-feat-runs.mjs` (its default output).

## 4. Switch

- [ ] Set `SEASON` in `src/season.js` to the new season. The notes readers' "this season" and "an older season" follow it (`src/notes/facts.js`, `src/notes/narrative.js`), as do the file names the build loads (`scripts/situations.js`, `src/site/build.js`) and franchise lists' "still playing" season (`src/records/franchise.js`).
- [ ] Run the full tests locally with the new season's notes in `samples/` (the snapshots in `tests/expected/` are last season's teams: review the differences, then `node tests/run.js --update`).
- [ ] Run a full local build, read `docs/data/health.json` and the Watch List, then push to `dev`.
- [ ] Update the page footers that name a guide's season (`docs/records.html`, `docs/national.html`).
- [ ] Update the README's counts and this checklist's "now".
