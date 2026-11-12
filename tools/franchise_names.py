"""Today's 30 franchises and every name each has played under in the NBA Guide (relocations included)."""
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


import collections, re as _re
def clean_rows(rows):
    """Player rows with each team, cleaned: team and opponents totals and a traded player's totals across teams
    left out, the Guide's two known slips mended, short and squashed names joined to the full name.
    Each row gains "player" (the name to count it under). Returns (rows, fix)."""
    # Rows the Guide's team pages leave out, taken from the Guide's own league-leader lines for that season.
    OMITTED = [{"season": "2001-02", "team": "UTAH JAZZ", "name": "Karl Malone", "mark": "", "g": 80, "fgm": 635, "ftm": 509, "pts": 1788, "stl": 152,
                "note": "p. 597 (2001-02 Jazz) has no Karl Malone row; G/FGM/FTM/PTS/STL from that season's leader lines; his MIN/REB/AST/BLK that season are not counted"}]
    rows = rows + [dict(o) for o in OMITTED]
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
    for r in rows: r["player"] = fix(r)
    return rows, fix
