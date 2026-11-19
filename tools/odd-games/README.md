# Odd-games study (0.116.0)

What 33 seasons of ESPN box scores say about odd stat lines. The write-up is the project doc `claude/odd-games-study.md`.
Nothing here runs in the daily build and nothing on the site reads it yet.

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
