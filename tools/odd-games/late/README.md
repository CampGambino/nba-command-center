# Does an "as it stands" odd line hold? (0.127.0)

    WORK=/home/claude/work NODE_USE_ENV_PROXY=1 node tools/odd-games/late/fetch-late.mjs 2002-10-01 2026-04-12 10
    node --max-old-space-size=6000 tools/odd-games/late/eval-late.mjs --write

- `fetch-late.mjs` needs the box-score folder (`$WORK/full`, from `tools/odd-games/fetch-full.mjs`). It writes one file a game to `$WORK/late/g` and stops itself after 560 seconds; run it again to carry on.
- `reduce.mjs` rebuilds each player's running line from ESPN's plays and his seconds on the floor after each mark.
- `eval-late.mjs` runs the site's rules at each mark and at the final and prints the table; `--write` writes `src/data/odd-lines-hold.json`.
- To add a season: fetch its box scores, run the two commands with the new end date, commit the table.

What the table means, what was checked and what is not proven: CHANGES.md, 0.127.0.
