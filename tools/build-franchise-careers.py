#!/usr/bin/env python3
"""
Franchise career totals from tools/parse-team-rows.py's output: every player's regular-season totals with each of
today's 30 franchises (relocations included), 1946-47 to 2025-26.
  python3 tools/build-franchise-careers.py team-rows.json > src/data/nba-franchise-careers-2026-27.json
- Rows counted: a player's rows with that team. Rows that are his totals across teams are left out ("(!)" since
  the 1980s, "‡" in the 1970s).
- One name used by two players at one franchise is split at gaps of 6+ seasons (except stints since 2003-04
  of a player still active).
Output: { stats, franchises: { TRI: { name, top: { stat: [[player, value, first, last]] (top 60) }, active: { player: { stat: value, first, last } } } } }
"""
import json, sys, collections
rows = json.load(open(sys.argv[1]))
sys.path.insert(0, __import__("os").path.dirname(__file__))
from franchise_names import NAMES, NICK, TEAM, year, franchise, clean_rows
STATS = ["g", "min", "pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "fgm", "ftm", "fg3m"]
rows, fix = clean_rows(rows)
per = collections.defaultdict(lambda: collections.defaultdict(list))   # tri -> name -> [rows]
for r in rows:
    t = franchise(r["team"], r["season"])
    if t: per[t][fix(r)].append(r)
# Players in the league in 2024-25 or 2025-26 (with any team): their careers with every franchise are kept,
# so a player back with an old team (LeBron in Cleveland, say) starts from his total there.
league_active = {fix(r) for r in rows if year(r["season"]) >= 2024}
out = {}
for t, players in per.items():
    careers = []
    for name, rs in players.items():
        rs.sort(key=lambda r: r["season"])
        groups, cur = [], [rs[0]]
        for a, b in zip(rs, rs[1:]):
            if year(b["season"]) - year(a["season"]) >= 6: groups.append(cur); cur = [b]
            else: cur.append(b)
        groups.append(cur)
        # A player active now who left and came back 6+ seasons later is still one player: his stints since
        # 2003-04 (LeBron's first season, the earliest of anyone playing now) are put back together.
        if name in league_active:
            modern = [g for g in groups if year(g[0]["season"]) >= 2003]
            if len(modern) > 1: groups = [g for g in groups if year(g[0]["season"]) < 2003] + [[r for g in modern for r in g]]
        for g in groups:
            careers.append({"name": name, "first": g[0]["season"], "last": g[-1]["season"], **{k: sum(r.get(k, 0) for r in g) for k in STATS}})
    top = {k: [[c["name"], c[k], c["first"], c["last"]] for c in sorted(careers, key=lambda c: -c[k])[:60] if c[k] > 0] for k in STATS}
    active = {c["name"]: {**{k: c[k] for k in STATS}, "first": c["first"], "last": c["last"]} for c in careers if c["name"] in league_active and year(c["first"]) >= 2003}
    out[t] = {"name": NICK[t], "top": top, "active": active}
missing = sorted(set(NAMES) - set(out))
if missing: sys.exit(f"franchises with no rows: {missing}")
json.dump({"source": "NBA 2026-27 Guide: team-by-team regular-season player statistics, 1946-47 to 2025-26 (pp. 10-19, 270-1010)",
           "stats": STATS, "franchises": out}, sys.stdout, ensure_ascii=False, separators=(",", ":"))
sys.stderr.write(f"{len(out)} franchises; e.g. LAL pts {out['LAL']['top']['pts'][:3]}\n")
