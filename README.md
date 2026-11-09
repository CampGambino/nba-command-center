# NBA Command Center

A standalone program that anticipates NBA milestones and storylines before they happen. It reads every team's game notes, works out which marks are within reach, and (in later stages) ranks them by how likely they are and how much they matter.

Design docs live in the claude.ai project "NBA Command Center": `anticipation-engine.md` (principle #1), `command-center-architecture.md`, `storyline-detector-catalog.md`.

## What works today (v0.2.0)

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
- **Notes watcher** (`src/notes/watcher.js`): downloads a team's notes from its fixed URL, keeps every version, and says whether the file there is *tonight's* notes or a stale one.

Formats recognized so far (from the 2026-11-09 samples): Cleveland's "Needs N" lists, the Lakers' wide tracker table, San Antonio's "STAT: target current" blocks, Phoenix's inline tracker, Charlotte's "X is 93 rebounds away from 1,500 career rebounds... 36 games away from..." bullets, and ranked lists in several styles (`1. Name (total)`, `1. Name   total`, `1  Name  total`, `701  Name  1988-98`), including side-by-side and stacked lists. Atlanta has no tracker and still yields its ranked lists and forward-looking sentences.

What makes a milestone **review** instead of **ok**: a list whose scope (NBA or franchise) isn't printed clearly enough to prove; a qualified list (centers, bench, a draft class, rookies, "since 2000", per game, home games...); an average rather than a count; an unresolved tie; a duplicate rank; a stat the notes print inconsistently; or two sources in the notes that disagree. Review items are never published as fact.

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
src/registry/         milestone tracking: roll forward since the notes, cross-check with ESPN
src/teams.js          team names, codes, notes URLs
scripts/              command-line tools (parse-notes, dump-page for debugging)
samples/<date>/       real notes PDFs used by the tests
tests/                test suite and saved snapshots
data/                 downloaded notes versions and other stored data (not in git)
```
