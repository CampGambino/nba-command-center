#!/usr/bin/env python3
"""
Each franchise's longest winning and losing streaks within a season (NBA Guide pp. 142-143).
  pdftotext -layout -f 136 -l 148 guide.pdf p.txt; python3 tools/parse-franchise-streaks.py p.txt > src/data/nba-franchise-streaks-2026-27.json
Output: { win: { TRI: { n, seasons, also: [{ n, seasons }] } }, lose: { ... } }  (also = the franchise's other cities)
"""
import json, re, sys
FULL = {"Atlanta Hawks": "ATL", "Boston Celtics": "BOS", "Brooklyn Nets": "BKN", "Charlotte Hornets": "CHA", "Chicago Bulls": "CHI", "Cleveland Cavaliers": "CLE",
        "Dallas Mavericks": "DAL", "Denver Nuggets": "DEN", "Detroit Pistons": "DET", "Golden State Warriors": "GSW", "Houston Rockets": "HOU", "Indiana Pacers": "IND",
        "LA Clippers": "LAC", "Los Angeles Lakers": "LAL", "Memphis Grizzlies": "MEM", "Miami Heat": "MIA", "Milwaukee Bucks": "MIL", "Minnesota Timberwolves": "MIN",
        "New Orleans Pelicans": "NOP", "New York Knicks": "NYK", "Oklahoma City Thunder": "OKC", "Orlando Magic": "ORL", "Philadelphia 76ers": "PHI", "Phoenix Suns": "PHX",
        "Portland Trail Blazers": "POR", "Sacramento Kings": "SAC", "San Antonio Spurs": "SAS", "Toronto Raptors": "TOR", "Utah Jazz": "UTA", "Washington Wizards": "WAS"}
txt = open(sys.argv[1], encoding="utf-8").read().replace("\t", "    ")
out = {}
for key, title in (("win", "LONGEST TEAM WINNING STREAKS (SINGLE SEASON)"), ("lose", "LONGEST TEAM LOSING STREAKS (SINGLE SEASON)")):
    block = txt[txt.index(title):]
    block = block[:block.index("– 14", 10)]
    teams, cur = {}, None
    for line in block.splitlines()[2:]:
        if not line.strip(): continue
        m = re.match(r"^\s*([A-Z][A-Za-z0-9 ]+?)\s+(\d+)\s+(\S.*?)\s*$", line)
        if m and m.group(1).strip() in FULL:
            cur = FULL[m.group(1).strip()]
            teams[cur] = {"n": int(m.group(2)), "seasons": m.group(3).strip(), "also": []}
            continue
        m = re.match(r"^\s+(\d+)\s+(\S.*?)\s*$", line)
        if m and cur: teams[cur]["also"].append({"n": int(m.group(1)), "seasons": m.group(2).strip()}); continue
        m = re.match(r"^\s+(\S.*?)\s*$", line)   # a season list that wrapped
        if m and cur and re.match(r"^\d{4}-\d{2}", m.group(1)):
            (teams[cur]["also"][-1] if teams[cur]["also"] else teams[cur])["seasons"] += " " + m.group(1)
    if len(teams) != 30: sys.exit(f"{key}: {len(teams)} teams: {sorted(set(FULL.values()) - set(teams))}")
    out[key] = teams
json.dump({"source": "NBA 2026-27 Guide pp. 142-143 (through 2025-26)", **out}, sys.stdout, ensure_ascii=False, indent=0)
sys.stderr.write(f"streaks: win {len(out['win'])}, lose {len(out['lose'])}; e.g. DET win {out['win']['DET']}, DET lose {out['lose']['DET']}\n")
