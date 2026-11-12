#!/usr/bin/env python3
"""
Assemble src/data/nba-postseason-careers-2026-27.json from tools/parse-career-lists-bbox.py's output (All-Star, Play-In,
playoffs, Finals career lists) and the All-Star selections page (NBA Guide pp. 160-161, layout text).
  python3 tools/parse-postseason-careers.py lists.json p160-161.txt > src/data/nba-postseason-careers-2026-27.json
"""
import json, re, sys
raw = json.load(open(sys.argv[1]))
KEY = {"MOST GAMES PLAYED": "gp", "MOST MINUTES PLAYED": "min", "MOST POINTS": "pts", "MOST FIELD GOAL ATTEMPTS": "fga", "MOST FIELD GOALS MADE": "fgm",
       "MOST REBOUNDS": "reb", "MOST OFFENSIVE REBOUNDS": "oreb", "MOST DEFENSIVE REBOUNDS": "dreb", "MOST ASSISTS": "ast", "MOST STEALS": "stl",
       "MOST BLOCKED SHOTS": "blk", "MOST TURNOVERS": "tov", "MOST PERSONAL FOULS": "pf", "MOST DISQUALIFICATIONS": "dq", "MOST FREE THROW ATTEMPTS": "fta",
       "MOST FREE THROWS MADE": "ftm", "MOST 3-PT. FIELD GOAL ATTEMPTS": "fg3a", "MOST 3-PT. FIELD GOALS MADE": "fg3m", "MOST SEASONS PLAYED": "seasons"}
out = {}
for book, lists in raw.items():
    for title, rows in lists.items():
        k = KEY[title]
        if any(a["value"] < b["value"] for a, b in zip(rows, rows[1:])): sys.exit(f"{book} {k} not in order")
        out.setdefault(book, {})[k] = rows
sel = [{"name": re.split(r"\s{2,}", m.group(1).strip())[-1], "selections": int(m.group(2))}
       for m in re.finditer(r"([A-Z][A-Za-z.’' \-]+?)\*{0,3}\s+(?:\.\s+){2,}\.?\s*(\d{1,2})(?=\s|$)", open(sys.argv[2], encoding="utf-8").read())]
json.dump({"source": "NBA 2026-27 Guide: career leaders for the All-Star Game (pp. 158-159), Play-In (166-167), playoffs (175-176), Finals (185-186); All-Star selections by player (160-161); through 2025-26",
           "careers": out, "allStarSelections": sel}, sys.stdout, ensure_ascii=False, indent=0)
