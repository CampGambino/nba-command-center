# NBA Command Center

A standalone program that anticipates NBA milestones and storylines before they happen. It reads every team's game notes, works out which marks are within reach, and (in later stages) ranks them by how likely they are and how much they matter.

Design docs live in the claude.ai project "NBA Command Center": `anticipation-engine.md` (principle #1), `command-center-architecture.md`, `storyline-detector-catalog.md`.

## What works today (v0.15.0)

**Website:** https://campgambino.github.io/nba-command-center/ (GitHub Pages, from `docs/`). Rebuild it for tonight's whole slate with `npm run tonight` (downloads every playing team's notes), or from local PDFs with `npm run publish -- samples/<date>/*.pdf`.

- **Game notes parser** (`src/notes/`): reads a team's notes PDF and returns
  - `meta`: the game date and opponent printed in the notes
  - `milestones`: every upcoming mark found, each with the exact text it came from and a status: **ok** (all checks passed) or **review** (something didn't add up; never treated as publishable)
  - `leaderboards`: every ranked list found, with its title, its scope (NBA / franchise / single-season / streak) and any ordering errors in the notes themselves
  - `notes`: forward-looking sentences ("is closing in on 30,000...") quoted word for word, read column by column
- **Milestone tracking** (`src/registry/track.js`, `src/espn/`):
  - adds every game played since the notes were written, from ESPN box scores;
  - checks each total against ESPN's career numbers;
  - marks any disagreement as review, with both numbers shown;
  - marks franchise chases by players who have left as no longer live.

  Run `npm run track -- samples/2026-11-09/hornets.pdf`.
- **Watch List engine** (`src/anticipate/`): for every live milestone,
  - the chance it happens tonight and within 3 or 5 games;
  - the expected game and date;
  - an importance score with its reasons;
  - whether it is publishable.

  It uses recent box scores, last season's games and ESPN's injury feed. `npm run watch -- samples/2026-11-09/*.pdf --json data/predictions-<date>.json`, and the next day `npm run score -- data/predictions-<date>.json` to see how the predictions did.
- **NBA Live bridge** (`docs/bridge/cc-bridge.js`). NBA Live stays on the PC (in the git-ignored `live/` folder) and is never published. Add this line just before its `</body>`:
  `<script src="https://campgambino.github.io/nba-command-center/bridge/cc-bridge.js"></script>`
  NBA Live then shows the Command Center's notes chases and passes as its own League Alerts cards: gated, at most 6 per game, never duplicating its own ladders. Test a new NBA Live version with `python3 tools/check-nba-live.py live/<file>.html docs/data/watch.json <YYYYMMDD> [<game id to replay live>]`.
- **Team situations** (`docs/situations.html`, `src/situations/`): every team's record overall, home and road, vs teams over .500, vs the teams with the top 3, 4 and 5 records, in clutch games (with clutch +/-), in games decided by 3 or fewer, in overtime, and by score at half and after three quarters. Each comes with the league rate and what a team that good would usually do there. Tonight's matchups are shown side by side, and the most unusual records are ranked. `npm run situations`; the daily build runs it.
- **Clutch** (`docs/clutch.html`, `src/espn/pbp.js`, `src/situations/clutch.js`): team and player clutch stats (the last 5 minutes of the 4th or OT, within 5), from ESPN play-by-play; team W-L and +/- match NBA.com.
- **4th quarter** (Clutch page switch): team and player 4th-quarter stats from the same play-by-play pass.
- **With / without** (`docs/players.html`, `src/situations/withwithout.js`): a team's record and each teammate's averages in games a chosen player played vs missed.
- **Streaks & outliers** (`docs/trends.html`, `src/situations/trends.js`): unusual games vs each player's own season, active player streaks, team streaks.
- **vs top defenses** (`docs/defenses.html`, `src/situations/ratings.js`): each team's offense against the top 3, 5, 8 or 10 defenses (by defensive rating from box scores) compared with everyone else.
- **Notes watcher** (`src/notes/watcher.js`): downloads a team's notes from its fixed URL, keeps every version, and says whether the file there is *tonight's* notes or a stale one.

Formats recognized so far (from the 2026-11-09 samples): Cleveland's "Needs N" lists, Boston's milestone grid (Target · Needs · Date acquired; its PDFs' broken font maps are repaired first), the Lakers' wide tracker table, San Antonio's "STAT: target current" blocks, Phoenix's inline tracker, Charlotte's "X is 93 rebounds away from 1,500 career rebounds... 36 games away from..." bullets, and ranked lists in several styles (`1. Name (total)`, `1. Name   total`, `1  Name  total`, `701  Name  1988-98`), including side-by-side and stacked lists. Atlanta has no tracker and still yields its ranked lists and forward-looking sentences.

What makes a milestone **review** instead of **ok**: a list whose scope (NBA or franchise) isn't printed clearly enough to prove; a qualified list (centers, bench, a draft class, rookies, "since 2000", per game, home games...); an average rather than a count; an unresolved tie; a duplicate rank; a stat the notes print inconsistently; or two sources in the notes that disagree. Review items are never published as fact.

## Daily updates (automatic)

`.github/workflows/daily.yml` runs on GitHub's servers, so the site stays current with the PC off. Times are Eastern in winter:
- **Builds:** 10:30 AM, 3:00 PM and 5:30 PM.
- **Scoring of the previous night:** 3:30 AM, then again at 7:00 AM in case a late game hadn't finished.

Each run commits `docs/data`, `docs/lib` and `history/` (season results in `history/results/`, one file per date):
- `history/predictions-<date>.json.gz` holds that night's predictions;
- `history/calibration.jsonl` holds one scoring line per night;
- `history/score-<date>.txt` holds the full hit/miss list.

A build that reads fewer teams' notes than the published one is never published.

To run it by hand: the repository's **Actions** tab → **daily** → **Run workflow** (job `build` or `score`, optional date). The same logic runs locally: `node scripts/ci.js build` / `node scripts/ci.js score --date YYYY-MM-DD`.

Before changing anything locally, run `git pull`, since the bot commits several times a day.

## Setup (once, on Windows)

1. Node.js 20.19 or newer (check with `node -v`).
2. In this folder: `npm install`

## Use

```
npm test                                   # full test suite (offline, uses samples/)
npm run parse -- samples/2026-11-09/cavaliers.pdf
npm run parse -- samples/2026-11-09/lakers.pdf --json
npm run track -- samples/2026-11-09/hornets.pdf          # needs internet (ESPN); add --all to list everything
```

## Tests and the audit rule

`npm test` runs two kinds of test on the saved sample notes (`samples/<date>/*.pdf`; these stay on the PC and are not in the GitHub repository, so a fresh clone needs them copied in before the tests can run):

- **Facts**: checked by hand against the PDFs (e.g. Jarrett Allen 3,997 defensive rebounds, needs 3 for 4,000). A failure means the parser is wrong.
- **Snapshot**: everything the parser finds is saved in `tests/expected/`. If any change to the code changes the output, the test lists exactly what appeared or disappeared. Accept a change only after reviewing it: `node tests/run.js --update`.

Every change ships with an entry in `CHANGES.md`: what changed, what was tested, what is still unproven.

## Folder layout

```
src/notes/            game notes: layout, readers per format, checks, watcher
src/espn/             ESPN readers + cached client (rosters, schedules, box scores, career stats)
src/nba/              NBA.com static files: starting lineups and the transaction log
src/registry/         milestone tracking: roll forward since the notes, cross-check with ESPN
src/anticipate/       P(tonight)/ETA model, importance score, Watch List assembly
docs/                 the website: index.html, data/watch.json, lib/ (copy of src/ used for live countdowns)
src/teams.js          team names, codes, notes URLs
scripts/              command-line tools (parse-notes, dump-page for debugging)
samples/<date>/       real notes PDFs used by the tests
tests/                test suite and saved snapshots
data/                 downloaded notes versions and other stored data (not in git)
```
