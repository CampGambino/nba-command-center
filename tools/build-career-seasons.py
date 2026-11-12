#!/usr/bin/env python3
"""
Season-by-season regular-season lines for players active in 2025-26, from tools/parse-season-lines.py's output.
  python3 tools/build-career-seasons.py season-lines.json > src/data/nba-career-seasons-2026-27.json
- A traded player's season is his "(!)" total row; a one-team season is its single row.
- A name used by two players (an older one and today's) is split into careers at gaps of 4+ seasons; the career that
  reaches 2024-25 or 2025-26 is kept.
Output: { keys: [...], players: { name: [[season, g, min, pts, reb, ast, stl, blk, fgm, fga, fg3m, fg3a, ftm, fta, tov, hi], ...] } }
"""
import json, sys, collections
rows = json.load(open(sys.argv[1]))
KEYS = ["season", "g", "min", "pts", "reb", "ast", "stl", "blk", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "tov", "hi"]
by = collections.defaultdict(list)
for r in rows: by[(r["name"], r["season"])].append(r)
seasons = collections.defaultdict(dict)
for (name, season), rs in by.items():
    total = [r for r in rs if r["mark"] == "!"]
    if total: r = total[0]
    else:
        plain = [r for r in rs if r["mark"] == ""] or rs
        if len(plain) == 1: r = plain[0]
        else:  # two players with one name in one season can't be told apart here: skip that season
            continue
    seasons[name][season] = [season] + [r[k] for k in KEYS[1:]]
year = lambda s: int(s[:4])
out = {}
for name, ss in seasons.items():
    order = sorted(ss)
    # split careers at gaps of 4+ seasons; keep the one reaching 2024-25 or later
    careers, cur = [], [order[0]]
    for a, b in zip(order, order[1:]):
        if year(b) - year(a) >= 4: careers.append(cur); cur = [b]
        else: cur.append(b)
    careers.append(cur)
    last = careers[-1]
    if year(last[-1]) >= 2024: out[name] = [ss[s] for s in last]
json.dump({"source": "NBA 2026-27 Guide: regular-season player statistics, 2025-26 (pp. 10-19) and year by year (pp. 270-1010), 1979-80 on",
           "keys": KEYS, "players": out}, sys.stdout, ensure_ascii=False, separators=(",", ":"))
sys.stderr.write(f"{len(out)} active players, {sum(len(v) for v in out.values())} seasons\n")
