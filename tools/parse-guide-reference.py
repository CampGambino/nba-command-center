#!/usr/bin/env python3
"""
Reference tables from the NBA Guide, stored for later use (nothing alerts on them yet):
  pp. 27-28  Emirates NBA Cup 2025 individual leaders (points, rebounds, assists, steals, blocks: per game)
  pp. 44-45  career playoff leaders among players active in 2025-26 (top 10 per counting stat)
  pdftotext -layout -f 27 -l 28 guide.pdf a.txt; pdftotext -layout -f 44 -l 45 guide.pdf b.txt
  python3 tools/parse-guide-reference.py a.txt b.txt > src/data/nba-guide-reference-2026-27.json
"""
import json, re, sys
cup_txt, po_txt = (open(p, encoding="utf-8").read().replace("\t", "    ") for p in sys.argv[1:3])
# Cup 2025: left column; "Name, Team . . . G ... TOTAL AVG" (the total is the next-to-last number)
SECT = {"POINTS": "pts", "REBOUNDS": "reb", "ASSISTS": "ast", "STEALS": "stl", "BLOCKS": "blk", "MINUTES": "min"}
cup, cur = {}, None
for line in cup_txt.splitlines():
    left = line[:74]
    s = left.strip()
    if s in SECT: cur = SECT[s]; continue
    if s.startswith("FIELD GOAL") or s.startswith("3-POINT") or s.startswith("FREE THROW"): continue
    row = re.compile(r"^\s*([A-Z][^,]+?), ([A-Za-z.’' ]+?)[ .]+((?:\d+\s+)+)(\d+\.\d+)\s*$")
    m = row.match(line) or row.match(left)   # page 28 is one column; page 27 has a second column on the right
    if m and cur:
        nums = [int(x) for x in m.group(3).split()]
        cup.setdefault(cur, []).append({"player": m.group(1).strip(), "team": m.group(2).strip(), "g": nums[0], "total": nums[-1], "avg": float(m.group(4))})
# Active playoff leaders: three "Name.....value" columns under MOST <STAT> headings
TITLES = {"MOST POINTS": "pts", "MOST 3-PT. FIELD GOALS MADE": "fg3m", "MOST BLOCKED SHOTS": "blk", "MOST FIELD GOAL ATTEMPTS": "fga", "MOST REBOUNDS": "reb",
          "MOST TURNOVERS": "tov", "MOST FIELD GOALS MADE": "fgm", "MOST ASSISTS": "ast", "MOST STEALS": "stl", "MOST FREE THROWS MADE": "ftm",
          "MOST FREE THROW ATTEMPTS": "fta", "MOST GAMES PLAYED": "gp", "MOST MINUTES PLAYED": "min", "MOST 3-PT. FIELD GOAL ATTEMPTS": "fg3a",
          "MOST PERSONAL FOULS": "pf", "MOST DISQUALIFICATIONS": "dq", "MOST OFFENSIVE REBOUNDS": "oreb", "MOST DEFENSIVE REBOUNDS": "dreb", "MOST SEASONS PLAYED": "seasons"}
po, heads = {}, []
for line in po_txt.splitlines():
    segs = [(m.start(), m.group(0).strip()) for m in re.finditer(r"\S+(?: \S+)*", line)]
    if segs and all(s in TITLES for _, s in segs): heads = segs; continue
    if not heads: continue
    for m in re.finditer(r"([A-Z][A-Za-z.’' \-]+?)\s?\.{2,}\s*([\d,]+)(?=\s|$)", line):
        col = min(heads, key=lambda h: abs(h[0] - m.start()))
        po.setdefault(TITLES[col[1]], []).append({"name": m.group(1).strip(), "value": int(m.group(2).replace(",", ""))})
bad = [k for k, v in po.items() if len(v) != 10 and k not in ("seasons", "dq")] + [k for k in ("pts", "reb", "ast") if len(cup.get(k, [])) < 10]
if bad: sys.exit(f"reference tables incomplete: {bad} {[(k, len(v)) for k, v in po.items()]} {[(k, len(v)) for k, v in cup.items()]}")
json.dump({"source": "NBA 2026-27 Guide pp. 27-28 (Emirates NBA Cup 2025 leaders, per game) and pp. 44-45 (career playoff leaders among players active in 2025-26)",
           "cup2025": cup, "playoffActive": po}, sys.stdout, ensure_ascii=False, indent=0)
sys.stderr.write("cup2025: " + ", ".join(f"{k} {len(v)}" for k, v in cup.items()) + "; playoff active: " + ", ".join(f"{k} {len(v)}" for k, v in po.items()) + "\n")
