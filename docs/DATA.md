# Published data: who reads what

The build writes `docs/data/*.json` and GitHub Pages serves it. The website's own pages live in this repo and change with the data, and their checks are in `tests/run.js`. Two readers live **outside** the repo's release cycle, and they break silently if a field they read is renamed or removed:

- **NBA Live**, through the bridge (`docs/bridge/cc-bridge.js`), loaded from the site.
- **The Cloudflare Worker** (`cloudflare/`), which reads three files from `raw.githubusercontent.com`.

What they read is listed below and checked against the real published files on every test run (`tests/contracts.js`, the `CONTRACT` list). **Adding a field is always safe. Renaming or removing one listed here means changing the reader in the same version and updating `CONTRACT`. Bridge changes only on the user's go.**

## NBA Live (the bridge)

| File | The bridge takes it when | Fields it reads |
|---|---|---|
| `data/watch.json` | always (its main file) | top: `today`, `teams[]`; team: `team`, `items[]`; item: `espnId`, `player`, `stat`, `label`, `kind`, `scope`, `target`, `need`, `importance`, `pTonight`, `publishable`, `tracking`, `review`, `origin`. It skips items with `origin: "espn"`, `stale`, no `espnId` or no `need`. |
| `data/records.json` | `items` is a list | item: `id`, `who`, `team`, `stat`, `label`, `kind` (only `pass`, `round`, `franchise`, `cup`), `need`, `target`, `score`, `text`; `passing` (who is passed) and `rank` on passes; `pTonight` where a chance was worked out; (v29) `tier` on a points pass that enters the top 100/75/50/25; `boards.pts` runs to about 120 ranked names |
| `data/tonight.json` | `games` is a list | game: `away`, `home`, `lines[]`; line: `kind`, `text`; a line with `bg` or (v29) `siteOnly` gets no pre-game card |
| `data/teammarks.json` | `v === 1` and `teams` | each team's single-game marks |
| `data/oddlive.json` | `v === 1` and `t` | the odd-line counts |
| `data/flowstats.json` | `quarters` is a list | `quarters`, `halves`, `teamQuarters` (season-best lists) |
| `ref/nba-single-game-bests.json` | always | the all-time single-game lists |
| (none since v28) | | the odd-line rules (`src/situations/oddlines.js`) are compiled into the bridge by `tools/bundle-bridge-rules.mjs`; the bridge downloads data only |
| `data/linerare.json` | `v === 1` and `combos` | the rare-combination boundaries and named games (0.141.17) |
| (none since v28) | | the rare-combination rules (`src/situations/linerare.js`), compiled in the same way |
| `data/featlive.json` | `v === 1` and `boards` | (v29, 0.142) `asOf`, `through`; `boards[key]`: `label`, `one`, `min`, `max`, `td`, `caveat`, `rows[]` (`name`, `id`, `team`, `live`, `now`, `games`); `streaks[]`: `id`, `name`, `team`, `tests`, `label`, `n`, `source`, `since`, `list`; `teamStreaks[]`: `team`, `kind`, `n`, `opp`, `home`, `min`, `max`, `label`; (v33) a `streaks[]` entry with `tests: ["play"]` is a games-played run, and `ironman[]` (`id`, `name`, `team`, `n`, `rank`) is the 25 longest; (v34) NBA Live cards those runs on every 50th game only; (v36, 0.166.0) a `streaks[]` entry with `source: "box"` is a player's run counted across seasons, with `bar` (the length at which this kind of run is carded), `start`, and `atLeast` when the run reaches the first game on file; a `source: "notes"` entry is no longer written and the bridge cards none; `bars` (label to bar) and `unweighed` are for reading, not read by the bridge; (v37, 0.168.0) a box run may carry `leader` (the league's longest active run of its kind), `tied`, and `everyGame` (the leader in 10+ or 20+ points: carded every game, its `bar` halved); `leaders` (label to `n`, `names`) is for reading |
| (none) | | the feat and streak rules (`src/records/featlive.js`), compiled in the same way (FEAT_RULES) |
| `bridge/version.json` | `version` is a number | tells NBA Live a newer bridge exists |

## The Worker

| File | Read by | Fields it reads |
|---|---|---|
| `data/tonight.json` | the storyline digests (`cloudflare/digest.js`) | `today`, `games[]` with `away`, `home`, `start`, `lines[]` |
| `data/health.json` | health alerts (`cloudflare/health.js`) | `at`, `steps[]` with `step`, `ok` |
| `data/injuries.json` | #lineups (`cloudflare/lineups.js`) | `date`, `players[]` with `team`, `name`, `status` |

## The rest

Every other file in `docs/data/` is read only by the site's own pages and by later build steps. `tests/run.js` checks those: every file parses, has no merge-conflict marks, and contains no copied notes text. Change them freely, along with the page that reads them.

Since 0.144.0 `data/tonight.json` lines can be of kind `awards` (award eligibility under the 65-game rule): always `siteOnly`, so the Watch List and the Worker's storyline digest show them and NBA Live doesn't. `data/eligibility.json` is read only by `awards.html`. `history/kalshi/awards.json` (written by `scripts/kalshi.js`) is read only by the build.

## Not read by anything yet

- `src/data/nba-penalties-<date>.json` (0.143.0): every NBA fine and suspension announced on pr.nba.com, Sept. 2009 on. `keys` names the row fields: `date`, `name`, `team`, `kind` (player, coach, executive, team), `type` (fine, suspension), `amount`, `games` (null with `note` "indefinite" when no length was set), `reason`, `note`, `release` (the pr.nba.com address after the slash). Built by `tools/pr-fines/build.mjs` from releases saved in the user's browser (pr.nba.com refuses GitHub's servers). Nothing in the site or NBA Live reads it yet.
