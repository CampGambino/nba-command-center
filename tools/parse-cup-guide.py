#!/usr/bin/env python3
"""
Emirates NBA Cup 2026 media guide (53 pages) -> src/data/nba-cup-2026-27.json

  pdftotext -layout -f 8 -l 8 guide.pdf p8.txt; pdftotext -layout -f 39 -l 42 guide.pdf p39.txt
  pdftotext -layout -f 31 -l 32 guide.pdf p31.txt
  python3 tools/parse-cup-guide.py p8.txt p39.txt p31.txt > src/data/nba-cup-2026-27.json

  p. 4   dates: Group Play every Friday Oct. 30 - Nov. 27 plus Tue Nov. 24 and Wed Nov. 25; Quarterfinals Dec. 4-5,
         Semifinals Dec. 8-9, Championship Dec. 11 (the Championship doesn't count in regular-season stats)
  p. 8   the 60 Group Play games (group, away, home, time)
  pp. 39-42  all-time Cup leaders (2023-2025), top 10 per stat
  pp. 31-32  all-time standings: overall, home, road (2023-2025, knockout rounds and Championships included)
"""
import json, re, sys
CITY = {"Atlanta": "ATL", "Boston": "BOS", "Brooklyn": "BKN", "Charlotte": "CHA", "Chicago": "CHI", "Cleveland": "CLE", "Dallas": "DAL", "Denver": "DEN",
        "Detroit": "DET", "Golden State": "GSW", "Houston": "HOU", "Indiana": "IND", "LA Clippers": "LAC", "LA Lakers": "LAL", "Memphis": "MEM", "Miami": "MIA",
        "Milwaukee": "MIL", "Minnesota": "MIN", "New Orleans": "NOP", "New York": "NYK", "Oklahoma City": "OKC", "Orlando": "ORL", "Philadelphia": "PHI",
        "Phoenix": "PHX", "Portland": "POR", "Sacramento": "SAC", "San Antonio": "SAS", "Toronto": "TOR", "Utah": "UTA", "Washington": "WAS"}
MONTH = {"OCTOBER": "10", "NOVEMBER": "11"}
sched_txt, leaders_txt = open(sys.argv[1], encoding="utf-8").read(), open(sys.argv[2], encoding="utf-8").read()

# Two columns of day blocks: split each line at the second "GROUP"-style column (around character 60).
cols = [[], []]
for line in sched_txt.splitlines():
    cut = 61
    cols[0].append(line[:cut]); cols[1].append(line[cut:])
games = []
names = "|".join(sorted(map(re.escape, CITY), key=len, reverse=True))
for col in cols:
    day = None
    for s in col:
        s = s.strip()
        m = re.match(r"(?:FRIDAY|TUESDAY|WEDNESDAY), (OCTOBER|NOVEMBER) (\d+)$", s)
        if m: day = f"2026-{MONTH[m.group(1)]}-{int(m.group(2)):02d}"; continue
        m = re.match(rf"(East|West) ([ABC])\s+({names})\s+at\s+({names})\s+(\d+:\d\d [AP]M)$", s)
        if m and day: games.append({"d": day, "group": f"{m.group(1)} {m.group(2)}", "away": CITY[m.group(3)], "home": CITY[m.group(4)], "time": m.group(5)})
games.sort(key=lambda g: (g["d"], g["time"]))
teams = {}
for g in games:
    for t in (g["away"], g["home"]): teams.setdefault(t, []).append(g["d"])
if len(games) != 60 or len(teams) != 30 or any(len(v) != 4 for v in teams.values()): sys.exit(f"schedule: {len(games)} games, {len(teams)} teams, counts {sorted(set(len(v) for v in teams.values()))}")

TITLES = {"GAMES": "gp", "MINUTES": "min", "POINTS": "pts", "FIELD GOALS MADE": "fgm", "THREE-POINT FIELD GOALS MADE": "fg3m", "FREE THROWS MADE": "ftm",
          "TOTAL REBOUNDS": "reb", "OFFENSIVE REBOUNDS": "oreb", "DEFENSIVE REBOUNDS": "dreb", "ASSISTS": "ast", "BLOCKS": "blk", "STEALS": "stl"}
SKIP = {"FIELD GOAL ATTEMPTS", "THREE-POINT FIELD GOAL ATTEMPTS", "FREE THROW ATTEMPTS", "TURNOVERS", "PERSONAL FOULS", "DISQUALIFICATIONS"}
ROW = re.compile(r"([A-Z][A-Za-zÀ-ž.’'\-]+(?: [A-Z][A-Za-zÀ-ž.’'\-]+)*(?: Jr\.| II| III)?)\s+(\d[\d,]*)(?=\s|$)")
leaders, headers = {}, []
for line in leaders_txt.splitlines():
    segs = [(m.start(), m.group(0).strip()) for m in re.finditer(r"\S+(?: \S+)*", line)]
    if segs and all(s in TITLES or s in SKIP for _, s in segs): headers = segs; continue
    if not headers or "PLAYER" in line or "Minimum" in line or "AVERAGE" in line or "PER GAME" in line or "PERCENTAGE" in line: 
        if "AVERAGE" in line or "PER GAME" in line or "PERCENTAGE" in line: headers = []
        continue
    for m in ROW.finditer(line):
        if m.group(1).endswith("tied"): continue
        col = min(headers, key=lambda h: abs(h[0] - m.start()))
        if col[1] in TITLES: leaders.setdefault(TITLES[col[1]], []).append({"name": m.group(1), "value": int(m.group(2).replace(",", ""))})
for k, v in leaders.items():
    if len(v) < 9 or any(a["value"] < b["value"] for a, b in zip(v, v[1:])): sys.exit(f"leaders {k}: {v}")
# All-time standings: two tables side by side; full team names.
FULL = {f"{c} {n}": t for t, (c, n) in {
    "ATL": ("Atlanta", "Hawks"), "BOS": ("Boston", "Celtics"), "BKN": ("Brooklyn", "Nets"), "CHA": ("Charlotte", "Hornets"), "CHI": ("Chicago", "Bulls"),
    "CLE": ("Cleveland", "Cavaliers"), "DAL": ("Dallas", "Mavericks"), "DEN": ("Denver", "Nuggets"), "DET": ("Detroit", "Pistons"), "GSW": ("Golden State", "Warriors"),
    "HOU": ("Houston", "Rockets"), "IND": ("Indiana", "Pacers"), "LAC": ("LA", "Clippers"), "LAL": ("Los Angeles", "Lakers"), "MEM": ("Memphis", "Grizzlies"),
    "MIA": ("Miami", "Heat"), "MIL": ("Milwaukee", "Bucks"), "MIN": ("Minnesota", "Timberwolves"), "NOP": ("New Orleans", "Pelicans"), "NYK": ("New York", "Knicks"),
    "OKC": ("Oklahoma City", "Thunder"), "ORL": ("Orlando", "Magic"), "PHI": ("Philadelphia", "76ers"), "PHX": ("Phoenix", "Suns"), "POR": ("Portland", "Trail Blazers"),
    "SAC": ("Sacramento", "Kings"), "SAS": ("San Antonio", "Spurs"), "TOR": ("Toronto", "Raptors"), "UTA": ("Utah", "Jazz"), "WAS": ("Washington", "Wizards")}.items()}
standings, which = {}, [None, None]
if len(sys.argv) > 3:
    for line in open(sys.argv[3], encoding="utf-8"):
        heads = [(m.start(), m.group(1).lower()) for m in re.finditer(r"(OVERALL|HOME|ROAD|NEUTRAL SITE) RECORDS", line)]
        if heads: which = [h for _, h in heads] + [None] * (2 - len(heads)); continue
        for i, m in enumerate(re.finditer(r"([A-Z][A-Za-z0-9 ]+?)\s{2,}(\d+)\s+(\d+)\s+[.\d]+", line)):
            t = FULL.get(m.group(1).strip())
            k = which[0 if m.start() < 45 else 1]
            if t and k and k != "neutral site": standings.setdefault(t, {})[k] = [int(m.group(2)), int(m.group(3))]
    if len(standings) != 30 or any(len(v) != 3 for v in standings.values()) or sum(v["overall"][0] for v in standings.values()) != 201:
        sys.exit(f"standings: {len(standings)} teams, {sum(v['overall'][0] for v in standings.values())} wins")
json.dump({"source": "Emirates NBA Cup 2026 Media Guide (NBA): schedule p. 8, dates p. 4, all-time leaders pp. 39-42 (2023-2025 Cups)",
           "group": games, "knockout": {"quarterfinals": ["2026-12-04", "2026-12-05"], "semifinals": ["2026-12-08", "2026-12-09"], "championship": "2026-12-11"},
           "leaders": leaders, "standings": standings}, sys.stdout, ensure_ascii=False, indent=1)
sys.stderr.write(f"{len(games)} group games; leaders: " + ", ".join(f"{k} {len(v)}" for k, v in leaders.items()) + "\n")
