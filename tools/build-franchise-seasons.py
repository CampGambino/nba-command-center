#!/usr/bin/env python3
"""
Each franchise's best single seasons, from tools/parse-team-rows.py's output (the NBA Guide's team-by-team
year-by-year pages, 1946-47 to 2025-26).
  python3 tools/build-franchise-seasons.py team-rows.json > src/data/nba-franchise-seasons-2026-27.json
- A season counts only his games with that team (a traded player's other team doesn't count).
- Totals: top 10 per stat. Per game: top 10 among seasons of 70% of the team's games or more
  (the team's games: its totals row; else the most games any of its players played).
- Steals and blocks are kept from 1973-74, 3-pointers from 1979-80 (the guide prints none before).
Output: { stats, perGameStats, qualifier, franchises: { TRI: { name, totals: { stat: [[player, value, season, g]] },
          perGame: { stat: [[player, avg, season, g]] }, teamGames: { season: g } } } }
"""
import json, sys, os, math, collections
sys.path.insert(0, os.path.dirname(__file__))
from franchise_names import NAMES, NICK, franchise, clean_rows

raw = json.load(open(sys.argv[1]))
team_games = {}
for r in raw:   # the team's own totals row ("LAKERS 82 19805 ..."), not its opponents'
    if r["name"].isupper() and r["name"] != "OPPONENTS" and r.get("g"):
        k = (r["season"], r["team"])
        team_games[k] = max(team_games.get(k, 0), r["g"])
rows, _ = clean_rows(raw)
most = collections.defaultdict(int)
for r in rows: most[(r["season"], r["team"])] = max(most[(r["season"], r["team"])], r.get("g", 0))

TOTALS = ["pts", "reb", "ast", "stl", "blk", "fg3m", "fgm", "ftm", "oreb", "dreb"]
PERGAME = ["pts", "reb", "ast", "stl", "blk", "fg3m"]
# One player, one team, one season: a player listed twice under one team that season (a short stint and a return)
# is added together.
seasons = collections.defaultdict(lambda: collections.defaultdict(dict))   # tri -> (player, season, team) -> totals
for r in rows:
    t = franchise(r["team"], r["season"])
    if not t: continue
    s = seasons[t].setdefault((r["player"], r["season"], r["team"]), collections.Counter())
    for k in ["g"] + TOTALS:
        if k in r: s[k] += r[k]
out = {}
for t, S in seasons.items():
    tg = {}
    for (_, season, team) in S: tg[season] = team_games.get((season, team)) or most[(season, team)]
    totals = {k: [[p, v[k], season, v["g"]] for (p, season, _), v in sorted(S.items(), key=lambda x: -x[1].get(k, 0))[:10] if v.get(k, 0) > 0] for k in TOTALS}
    per = {}
    for k in PERGAME:
        q = [(p, v[k] / v["g"], season, v["g"]) for (p, season, _), v in S.items() if v.get("g") and k in v and v["g"] >= math.ceil(0.7 * tg[season])]
        per[k] = [[p, round(a, 3), season, g] for p, a, season, g in sorted(q, key=lambda x: -x[1])[:10] if a > 0]
    out[t] = {"name": NICK[t], "totals": totals, "perGame": per, "teamGames": tg}
missing = sorted(set(NAMES) - set(out))
if missing: sys.exit(f"franchises with no rows: {missing}")
json.dump({"source": "NBA 2026-27 Guide: team-by-team regular-season player statistics, 1946-47 to 2025-26",
           "stats": TOTALS, "perGameStats": PERGAME, "qualifier": "per game: 70% of the team's games",
           "franchises": out}, sys.stdout, ensure_ascii=False, separators=(",", ":"))
sys.stderr.write(f"{len(out)} franchises; e.g. LAL pts {out['LAL']['totals']['pts'][:2]}, per game {out['LAL']['perGame']['pts'][:2]}\n")
