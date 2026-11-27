# Odd-games study (0.116.0) and the history table (0.117.0)

What 33 seasons of ESPN box scores say about odd stat lines. The write-up is the project doc `claude/odd-games-study.md`.
Nothing here runs in the daily build. The site reads one thing made here: `src/data/odd-lines-history.json`.

The data is not in the repo (about 180 MB as a table). To rebuild it in the cloud workspace (0.149.0, from the repo root):

0. `NODE_USE_ENV_PROXY=1 node tools/odd-games/fetch-boards.mjs` writes ESPN's scoreboards to `/home/claude/work/ls` (8,089
   dates, October to May 1993-94 to 2025-26 and the 2020 restart; about five minutes).
1. `NODE_USE_ENV_PROXY=1 node tools/odd-games/fetch-full.mjs 560` until it prints 0 to fetch. Writes one file a game to
   `/home/claude/work/full`. About nine minutes for 39,099 entries (All-Star games and ESPN's empty copies among them).
1b. `node tools/odd-games/patch-nbacom.mjs` writes NBA.com's own box score over every game ESPN has without player numbers
   or whose box doesn't add up (1,106), and adds the 28 games ESPN's scoreboards don't list (`f-nba-<id>.json`), from
   `tools/outside/nbacom` (`espn-map.json` says which file is which game). After it, every regular-season game from 1993-94
   to 2025-26 is in the archive once (38,949, checked against NBA.com's season game lists; BOS-IND 4/16/13 was cancelled).
   `tools/odd-games/counted.mjs` is the one rule every reader uses for which files are games.
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

## Every current player's career (0.172.0)

`node tools/build-career-logs.mjs` (from the repo root; a few seconds) reads the same archive and writes
`src/data/player-logs-career.json.gz`: each current player's regular-season games, his whole career through last season, in
the ESPN logs' columns. The matchup lines and the Streaks page's "Against one team, with him playing" read it. It also
prints how the archive compares with the ESPN player logs from 2016-17 on. Run it again once a season, and when the daily
build warns "career logs: N players with past seasons and no games on file" (a veteran new to this season's box scores).
