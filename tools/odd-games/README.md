# Odd-games study (0.116.0) and the history table (0.117.0)

What 33 seasons of ESPN box scores say about odd stat lines. The write-up is the project doc `claude/odd-games-study.md`.
Nothing here runs in the daily build. The site reads one thing made here: `src/data/odd-lines-history.json`.

The data is not in the repo (about 180 MB as a table). To rebuild it in the cloud workspace:

1. `NODE_USE_ENV_PROXY=1 node fetch-full.mjs 540` until it prints 0 to fetch. Needs the scoreboards in `/home/claude/work/ls`
   (`ls-YYYY-MM-DD.json`). Writes one file a game to `/home/claude/work/full`. About nine minutes for 39,065 games.
2. `node mk-lines.mjs` writes `lines.csv`: one row a player a game, only from games where the players' points add up to
   the score (37,816 of 39,065; the 1,016 Bulls and Pelicans games of 2012-13 to 2017-18 have no player numbers at ESPN).
3. `python3 an0.py` (coverage by season, writes `lines.pkl`), then `an1.py` (the templates from the user's posts; writes
   `lines2.pkl`), `an2.py` (a high number beside a zero; two highs together), `an3.py` (against his own average, context,
   runs), `an4.py` (who does it; by era), `an5.py` (recomputes every number in Findings 1 and 2 of the write-up).

The scripts read and write in the folder they are run from. `season` is the year the season started (2025 = 2025-26).
`grp` is G, F or C from ESPN's position label for the player, which is coarse and sometimes wrong.

## The history table (0.117.0)

`node --max-old-space-size=3000 tools/odd-games/build-history.mjs` (from the repo root; about ten seconds) counts every level
of every template in `src/situations/oddlines.js` over the files in `/home/claude/work/full` and writes
`src/data/odd-lines-history.json`. Run it again after changing a template or a level, and once a season with
`--through <year the season started>` after fetching that season's games. `--out` and `--through` also make a table that
stops early, to replay a later season against it.

0.118.0: the same run also writes `runs` and `again` into the table (how often each run of bad nights reached each length,
and each level was repeated in consecutive games) and `src/data/odd-lines-players.json` (each player's counts over the last
three seasons; `--window N` changes that, `--players <file>` the path). ESPN marks no starters for 482 old team-games; a side
without exactly five is treated as "starters unknown".

0.121.0: the run also reads `tools/outside/pbpstats/box-*.jsonl` (`--fill <dir>`) and counts the Bulls' and Pelicans' games
ESPN has no player numbers for.

0.122.0: those games are whole lines now. The user's five Basketball Reference box scores (11/19/26, read into
`tools/outside/bref-screens/box-2026-11-19.json`; `teamTurnovers` there is the team turnover Basketball Reference adds to
the players') matched pbpstats for all 102 players in every column it has. Each pbpstats player takes his ESPN id,
position and starter flag from ESPN's zeroed box score of the same game, by name (`SAME` holds the twelve names spelled
differently). pbpstats has no turnovers or fouls, so `TOV_PF` (in `src/situations/oddlines.js`) is not counted for these
games, except for a player whose box score has been read: any `*.json` in `tools/outside/bref-screens` supplies his
turnovers and fouls (78 lines today; the fifth box score, CHI at LAL 1/28/16, is a game ESPN has whole).
