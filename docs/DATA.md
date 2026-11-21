# Published data: who reads what

The build writes `docs/data/*.json` and GitHub Pages serves it. The website's own pages live in this repo and change with the data, and their checks are in `tests/run.js`. Two readers live **outside** the repo's release cycle, and they break silently if a field they read is renamed or removed:

- **NBA Live**, through the bridge (`docs/bridge/cc-bridge.js`), loaded from the site.
- **The Cloudflare Worker** (`cloudflare/`), which reads three files from `raw.githubusercontent.com`.

What they read is listed below and checked against the real published files on every test run (`tests/contracts.js`, the `CONTRACT` list). **Adding a field is always safe. Renaming or removing one listed here means changing the reader in the same version and updating `CONTRACT`. Bridge changes only on the user's go.**

## NBA Live (the bridge)

| File | The bridge takes it when | Fields it reads |
|---|---|---|
| `data/watch.json` | always (its main file) | top: `today`, `teams[]`; team: `team`, `items[]`; item: `espnId`, `player`, `stat`, `label`, `kind`, `scope`, `target`, `need`, `importance`, `pTonight`, `publishable`, `tracking`, `review`, `origin`. It skips items with `origin: "espn"`, `stale`, no `espnId` or no `need`. |
| `data/records.json` | `items` is a list | item: `id`, `who`, `team`, `stat`, `label`, `kind` (only `pass`, `round`, `franchise`, `cup`), `need`, `target`, `score`, `text`; `passing` (who is passed) and `rank` on passes; `pTonight` where a chance was worked out |
| `data/tonight.json` | `games` is a list | game: `away`, `home`, `lines[]`; line: `kind`, `text` |
| `data/teammarks.json` | `v === 1` and `teams` | each team's single-game marks |
| `data/oddlive.json` | `v === 1` and `t` | the odd-line counts |
| `data/flowstats.json` | `quarters` is a list | `quarters`, `halves`, `teamQuarters` (season-best lists) |
| `ref/nba-single-game-bests.json` | always | the all-time single-game lists |
| `lib/situations/oddlines.js` | read as text | the odd-line rules (the site's own module) |
| `data/linerare.json` | `v === 1` and `combos` | the rare-combination boundaries and named games (0.141.17) |
| `lib/situations/linerare.js` | read as text | the rare-combination rules (the site's own module; no imports) |
| `bridge/version.json` | `version` is a number | tells NBA Live a newer bridge exists |

## The Worker

| File | Read by | Fields it reads |
|---|---|---|
| `data/tonight.json` | the storyline digests (`cloudflare/digest.js`) | `today`, `games[]` with `away`, `home`, `start`, `lines[]` |
| `data/health.json` | health alerts (`cloudflare/health.js`) | `at`, `steps[]` with `step`, `ok` |
| `data/injuries.json` | #lineups (`cloudflare/lineups.js`) | `date`, `players[]` with `team`, `name`, `status` |

## The rest

Every other file in `docs/data/` is read only by the site's own pages and by later build steps. `tests/run.js` checks those: every file parses, has no merge-conflict marks, and contains no copied notes text. Change them freely, along with the page that reads them.
