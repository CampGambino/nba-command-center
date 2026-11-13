#!/usr/bin/env python3
"""
Franchise career totals from tools/parse-team-rows.py's output: every player's regular-season totals with each of
today's 30 franchises (relocations included), 1946-47 to 2025-26.
  python3 tools/build-franchise-careers.py team-rows.json > src/data/nba-franchise-careers-2026-27.json
- Rows counted: a player's rows with that team. Rows that are his totals across teams are left out ("(!)" since
  the 1980s, "‡" in the 1970s).
- One name is one player at a franchise, all stints together, unless first to last is more than 22 seasons
  or the pair is listed in TWO_PLAYERS; those are split at gaps of 6+ seasons.
Output: { stats, franchises: { TRI: { name, top: { stat: [[player, value, first, last]] (top 60) }, active: { player: { stat: value, first, last } } } } }
"""
import json, sys, collections
rows = json.load(open(sys.argv[1]))
sys.path.insert(0, __import__("os").path.dirname(__file__))
from franchise_names import NAMES, NICK, TEAM, year, franchise, clean_rows
STATS = ["g", "min", "pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "fgm", "ftm", "fg3m"]
rows, fix = clean_rows(rows)
# Same name, same franchise, two players, within 22 seasons (checked by hand).
TWO_PLAYERS = {("NOP", "Mike James"), ("CHI", "Charles Jones")}
per = collections.defaultdict(lambda: collections.defaultdict(list))   # tri -> name -> [rows]
for r in rows:
    t = franchise(r["team"], r["season"])
    if t: per[t][r["player"]].append(r)
# Players in the league in 2024-25 or 2025-26 (with any team): their careers with every franchise are kept,
# so a player back with an old team (LeBron in Cleveland, say) starts from his total there.
league_active = {r["player"] for r in rows if year(r["season"]) >= 2024}
out = {}
for t, players in per.items():
    careers = []
    for name, rs in players.items():
        rs.sort(key=lambda r: r["season"])
        # One name, one player, unless his first and last seasons there are more than 22 apart (Bobby Jones, DEN
        # 1976-77 and 2007-08) or the pair is known to be two players. Players come back after long gaps (Pippen,
        # Willis, Kidd), and the team guides count those stints together.
        groups = [rs]
        if (t, name) in TWO_PLAYERS or year(rs[-1]["season"]) - year(rs[0]["season"]) > 22:
            groups, cur = [], [rs[0]]
            for a, b in zip(rs, rs[1:]):
                if year(b["season"]) - year(a["season"]) >= 6: groups.append(cur); cur = [b]
                else: cur.append(b)
            groups.append(cur)
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
