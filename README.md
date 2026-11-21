# NBA Command Center

A personal tool that anticipates NBA milestones, records and storylines before they happen, and checks them. It reads every team's game notes, the league's injury report and ESPN's box scores, works out what could happen tonight and how likely it is, and publishes it as a website, Discord alerts and cards inside NBA Live.

- **Website:** https://campgambino.github.io/nba-command-center/ (GitHub Pages, from `docs/`)
- **Changes:** [`CHANGES.md`](CHANGES.md), newest first, one entry per version with a self-audit. Versions from 0.141.5 on are tagged (`v0.141.5`); `node tools/tag-versions.mjs --list` gives every version's commit.
- **Design and status docs:** the claude.ai project "NBA Command Center" (`command-center-architecture.md`, `anticipation-engine.md`, `standing-rules.md`, `build-status-update.md`, `security-check-2026-11-20.md`…).

Personal use. Runs for $0 on free tiers (GitHub Actions and Pages, Cloudflare Workers).

## The pages

| Page | What it shows |
|---|---|
| Watch List (`index.html`) | The briefing (top lines tonight), milestone chances tonight and over the next games, storylines and matchups per game, history from the notes |
| Records (`records.html`) | NBA and franchise record chases with chances; NBA Cup lists |
| Streaks & outliers (`trends.html`) | Current streaks and shifts from recent games |
| Team situations (`situations.html`), Standings (`standings.html`) | Records by game situation; standings |
| vs top teams (`defenses.html`) | Players and teams against the best and worst records and defenses |
| Clutch & 4th quarter (`clutch.html`), With / without (`players.html`), Team leaders (`leaders.html`), National TV (`national.html`) | Splits and leaders |
| Game Flow (`gameflow.html`) | Play-by-play charts of a game |
| Index (`find.html`) | Search across the series, last-time and arena files |

## How it runs

**Builds (GitHub Actions, `.github/workflows/daily.yml`).** `scripts/ci.js build` runs `scripts/tonight.js` (milestones and the Watch List), `scripts/situations.js` (records, situations, injuries, storylines), `scripts/flow.js`, then writes `docs/data/health.json`, the build's own check of its output. The bot commits the data to `main` and Pages publishes it. Times (Eastern, winter; an hour later in summer): builds at 8:00 AM, 10:30 AM, 1:00 PM, 3:00 PM, 5:30 PM, 6:40 PM (the evening injury report, before 7 PM tips), 12:15 AM, 1:30 AM and 2:45 AM; scoring (how last night's calls came out, `scripts/score.js`) at 3:30 AM and 7:00 AM. A code change also starts a build.

**Kalshi** (`kalshi.yml`): hourly at :17, odds from Kalshi's API only, posted to Discord.

**Discord alerts (Cloudflare Worker `ncc-articles`, `cloudflare/`).** Every 5 minutes: new articles (ESPN, The Athletic, Front Office Sports, NBA.com's power rankings and ladders on their publishing days) to #articles. Every minute: lineups (#lineups), the storyline digests and health alerts (#alerts). Deployed by `deploy-articles.yml` after its own checks. Admin pages need the review key, votes need the separate vote key; neither is in the repo.

**NBA Live** stays on the PC only and is never published. It loads `docs/bridge/cc-bridge.js` from the site to add the Command Center's cards to its League Alerts. What it and the Worker read from the published files is written down in [`docs/DATA.md`](docs/DATA.md) and checked on every test run.

## Data sources

ESPN (box scores, play-by-play, schedules, injuries feed, rosters), each team's game notes PDFs, the NBA's official injury report PDF (every 15 minutes on game days), the NBA Guide and team media guides (saved in `src/data/`), Kalshi's API. No NBA.com stats. Team notes PDFs are the NBA's documents: kept on the PC (`samples/`, git-ignored), not published.

## How code is published

1. Code goes to the **`dev`** branch, never straight to `main`.
2. **"test and publish"** (`.github/workflows/promote.yml`) puts it on top of `main`, runs `tests/articles-only.js` and `tests/run.js`, and only if every check passes moves it onto `main` (the live site, the builds and the Worker run from `main`). A failed check publishes nothing. After publishing it tags any new version and starts the Worker deploy or a build when the change needs one.
3. **"check main"** (`check-main.yml`) tests code that reached `main` some other way and turns red if it fails.
4. **Dependabot** (`.github/dependabot.yml`) opens a weekly request, to `dev`, when a pinned GitHub Action or npm dependency has an update.

Rolling back: `git revert` the change on `dev` (it goes through the same checks). To find a version's commit: its tag, or `node tools/tag-versions.mjs --list`.

## Each season

The season is set in one place (`SEASON` in `src/season.js`). From August 1 the build warns and a test fails until the rollover in [`docs/SEASON.md`](docs/SEASON.md) is done: the new guides' reference files, the trade deadline and NBA Cup final, then the switch.

## Tests

```
node tests/run.js           # 1,100 checks; the 296 that read the notes PDFs are skipped where samples/ isn't present
node tests/articles-only.js # the Worker's 98 checks
node tests/run.js --update  # after reviewing a deliberate change to the parsed milestones (snapshots in tests/expected/)
```

Both run offline. On GitHub's servers `tests/run.js` runs 804 checks (no notes PDFs there); the full 1,100 run before each push to `dev` (counts as of v0.141.6). `tests/run.js` also runs `tests/bridge.js` (NBA Live's bridge on invented data) and `tests/contracts.js` (what NBA Live and the Worker read, on the real published files).

## Secrets (names only; values never in the repo or in chat)

| Where | Name | For |
|---|---|---|
| GitHub Actions secrets | `CLOUDFLARE_API_TOKEN` | deploying the Worker (Workers + KV, this account only) |
| | `CLOUDFLARE_ACCOUNT_ID` | the same |
| | `DISCORD_WEBHOOK_KALSHI` | Kalshi posts |
| Cloudflare Worker secrets | `DISCORD_WEBHOOK`, `ALERTS_WEBHOOK`, `LINEUPS_WEBHOOK` | #articles, #alerts, #lineups (the review and vote keys are derived from `DISCORD_WEBHOOK`) |
| Cloudflare KV | `STATE` | the Worker's memory: seen articles, review rules, votes |

## Folders

| Folder | What's in it |
|---|---|
| `src/notes/` | the game notes parser (milestones, leaderboards, notes sentences, facts) |
| `src/espn/`, `src/nba/`, `src/injuries/`, `src/rosters/` | readers for ESPN, NBA.com lineups and transactions, the injury report, rosters |
| `src/registry/` | milestone tracking: totals brought up to date from box scores and checked against ESPN |
| `src/anticipate/` | the Watch List engine: chances, importance, storylines, the briefing, the claim ledger, calibration, detectors |
| `src/records/`, `src/situations/`, `src/gameflow/`, `src/site/` | record books and chases; team situations, ratings, the results store; Game Flow; page building |
| `src/data/` | saved reference data (career seasons, record books, guides) |
| `scripts/` | the build steps (`ci.js` runs them) |
| `docs/` | the website; `docs/data/` is the published data, `docs/lib/` the copies of `src/` modules the pages load (kept identical by a test) |
| `history/` | the build's memory between runs (what was seen and shown, scored calls, injury reports) |
| `cloudflare/` | the Worker |
| `tests/` | the checks (`run.js`, with `bridge.js` and `contracts.js`; `articles-only.js` for the Worker), fixtures and parsed-milestone snapshots |
| `tools/` | one-off utilities and diagnostics (`tools/diagnose.mjs`, `tools/tag-versions.mjs`…) |
