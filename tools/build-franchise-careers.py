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
NAMES = {
  "ATL": ["TRI-CITIES BLACKHAWKS", "MILWAUKEE HAWKS", "ST. LOUIS HAWKS", "ATLANTA HAWKS"], "BOS": ["BOSTON CELTICS"],
  "BKN": ["NEW YORK NETS", "NEW JERSEY NETS", "BROOKLYN NETS"], "CHA": ["CHARLOTTE HORNETS", "CHARLOTTE BOBCATS"], "CHI": ["CHICAGO BULLS"],
  "CLE": ["CLEVELAND CAVALIERS"], "DAL": ["DALLAS MAVERICKS"], "DEN": ["DENVER NUGGETS"], "DET": ["FORT WAYNE PISTONS", "DETROIT PISTONS"],
  "GSW": ["PHILADELPHIA WARRIORS", "SAN FRANCISCO WARRIORS", "GOLDEN STATE WARRIORS"], "HOU": ["SAN DIEGO ROCKETS", "HOUSTON ROCKETS"],
  "IND": ["INDIANA PACERS"], "LAC": ["BUFFALO BRAVES", "SAN DIEGO CLIPPERS", "LA CLIPPERS", "LOS ANGELES CLIPPERS"], "LAL": ["MINNEAPOLIS LAKERS", "LOS ANGELES LAKERS"],
  "MEM": ["VANCOUVER GRIZZLIES", "MEMPHIS GRIZZLIES"], "MIA": ["MIAMI HEAT"], "MIL": ["MILWAUKEE BUCKS"], "MIN": ["MINNESOTA TIMBERWOLVES"],
  "NOP": ["NEW ORLEANS HORNETS", "NEW ORLEANS/OKLAHOMA CITY HORNETS", "NEW ORLEANS PELICANS"], "NYK": ["NEW YORK KNICKS"],
  "OKC": ["SEATTLE SUPERSONICS", "OKLAHOMA CITY THUNDER"], "ORL": ["ORLANDO MAGIC"], "PHI": ["SYRACUSE NATIONALS", "PHILADELPHIA 76ERS"],
  "PHX": ["PHOENIX SUNS"], "POR": ["PORTLAND TRAIL BLAZERS"],
  "SAC": ["ROCHESTER ROYALS", "CINCINNATI ROYALS", "KANSAS CITY-OMAHA KINGS", "KANSAS CITY KINGS", "SACRAMENTO KINGS"], "SAS": ["SAN ANTONIO SPURS"],
  "TOR": ["TORONTO RAPTORS"], "UTA": ["NEW ORLEANS JAZZ", "UTAH JAZZ"],
  "WAS": ["CHICAGO PACKERS", "CHICAGO ZEPHYRS", "BALTIMORE BULLETS", "CAPITAL BULLETS", "WASHINGTON BULLETS", "WASHINGTON WIZARDS"]}
NICK = {"ATL": "Hawks", "BOS": "Celtics", "BKN": "Nets", "CHA": "Hornets", "CHI": "Bulls", "CLE": "Cavaliers", "DAL": "Mavericks", "DEN": "Nuggets", "DET": "Pistons",
        "GSW": "Warriors", "HOU": "Rockets", "IND": "Pacers", "LAC": "Clippers", "LAL": "Lakers", "MEM": "Grizzlies", "MIA": "Heat", "MIL": "Bucks", "MIN": "Timberwolves",
        "NOP": "Pelicans", "NYK": "Knicks", "OKC": "Thunder", "ORL": "Magic", "PHI": "76ers", "PHX": "Suns", "POR": "Trail Blazers", "SAC": "Kings", "SAS": "Spurs",
        "TOR": "Raptors", "UTA": "Jazz", "WAS": "Wizards"}
TEAM = {n: t for t, names in NAMES.items() for n in names}
year = lambda s: int(s[:4])
def franchise(team, season):
    t = TEAM.get(team)
    if team == "DENVER NUGGETS" and year(season) < 1976: return None      # the 1949-50 Denver Nuggets aren't today's
    if team == "BALTIMORE BULLETS" and year(season) < 1963: return None   # the 1947-54 Baltimore Bullets folded
    return t
STATS = ["g", "min", "pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "fgm", "ftm", "fg3m"]
# Rows the Guide's team pages leave out, taken from the Guide's own league-leader lines for that season.
OMITTED = [{"season": "2001-02", "team": "UTAH JAZZ", "name": "Karl Malone", "mark": "", "g": 80, "fgm": 635, "ftm": 509, "pts": 1788, "stl": 152,
            "note": "p. 597 (2001-02 Jazz) has no Karl Malone row; G/FGM/FTM/PTS/STL from that season's leader lines; his MIN/REB/AST/BLK that season are not counted"}]
rows = rows + OMITTED
for r in rows:   # one misprinted row (1977-78 Maravich prints a stray "8" before PTS): points from the made shots when they disagree
    if "note" not in r and all(k in r for k in ("fgm", "ftm", "pts")) and r["pts"] != 2 * r["fgm"] + r["ftm"] + r.get("fg3m", 0): r["pts"] = 2 * r["fgm"] + r["ftm"] + r.get("fg3m", 0)
rows = [r for r in rows if not r["name"].isupper() and r["mark"] not in ("(!)", "‡")]   # team and opponents totals; a player's totals across teams
# The same (season, team, player) twice with no mark read: one is his totals; keep the smaller (with this team).
seen = {}
for r in rows:
    k = (r["season"], r["team"], r["name"])
    if k not in seen or r.get("g", 0) < seen[k].get("g", 0): seen[k] = r
rows = list(seen.values())
# Names printed short in older pages: "K. Abdul-Jabbar" -> "Kareem Abdul-Jabbar", "KermitWashington" -> "Kermit Washington",
# when exactly one full name at the same franchise fits.
full = collections.defaultdict(set)
for r in rows:
    if not __import__("re").match(r"^[A-Z]\. ", r["name"]): full[(franchise(r["team"], r["season"]), r["name"].split()[-1])].add(r["name"])
squash = collections.defaultdict(set)
for r in rows: squash[r["name"].replace(" ", "")].add(r["name"])
import re as _re
def fix(r):
    n, t = r["name"], franchise(r["team"], r["season"])
    m = _re.match(r"^([A-Z])\. (.+)$", n)
    if m:
        c = [f for f in full.get((t, n.split()[-1]), ()) if f.startswith(m.group(1)) and f != n]
        if len(c) == 1: return c[0]
    if " " not in n:
        c = [f for f in squash.get(n, ()) if " " in f]
        if len(c) == 1: return c[0]
    return n
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
