"""
The Knicks' team offensive and defensive statistics for every season -> src/data/knicks-team-seasons-2026-27.json (0.91).

  python3 tools/parse-knicks-team-stats.py <the Knicks guide as text> src/data/knicks-team-seasons-2026-27.json

The user pointed to these tables on 11/17 (images 6-9). Only the games, points and average of each row are kept: they
take the Knicks' points for and against a game back to 1946-47, where their games on file start in 1993-94.
"""
import json, re, sys
text = open(sys.argv[1], encoding="utf8", errors="replace").read().replace("\u2011", "-").replace("\u2013", "-")
a, b = text.rindex("Team Offensive Statistics"), text.rindex("Team Defensive Statistics")      # the first of each is the table of contents
def rows(block):
    out = {}
    for line in block.split("\n"):
        m = re.match(r"^\s*(\d{4}-\d{2})\s+(\d{2})\s+.*?\s(\d{4,5})\s+(\d{2,3}\.\d)\s*$", line)
        if m and abs(int(m.group(3)) / int(m.group(2)) - float(m.group(4))) < 0.06: out[m.group(1)] = {"g": int(m.group(2)), "pts": int(m.group(3)), "avg": float(m.group(4))}
    return out
off = rows(text[a:b])
# The defensive table has no games column and ends with the margin: "1996-97  2665 … 7563 92.2 +3.1".
dfn = {}
for line in text[b:b + 30000].split("\n"):
    m = re.match(r"^\s*(\d{4}-\d{2})\s+.*?(\d{4,5})\s+(\d{2,3}\.\d)\s+[+\-–]?\d+\.\d\s*$", line)
    if m and m.group(1) in off and abs(int(m.group(2)) / off[m.group(1)]["g"] - float(m.group(3))) < 0.06: dfn[m.group(1)] = {"g": off[m.group(1)]["g"], "pts": int(m.group(2)), "avg": float(m.group(3))}
print(len(off), "seasons of offense,", len(dfn), "of defense;", min(off), "to", max(off))
json.dump({"team": "NYK", "source": "the Knicks' 2026-27 media guide, Team Offensive Statistics and Team Defensive Statistics (tools/parse-knicks-team-stats.py)", "offense": off, "defense": dfn}, open(sys.argv[2], "w"), separators=(",", ":"))
