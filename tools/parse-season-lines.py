#!/usr/bin/env python3
"""
Every regular-season player stat line in the NBA Guide (2025-26 on pp. 10-19; earlier seasons from p. 270), 1979-80 on
(the 23-column layout with 3-pointers). Run in two halves (pdftotext per page is slow):
  python3 tools/parse-season-lines.py 1 520 a.json; python3 tools/parse-season-lines.py 521 1010 b.json
Then tools/build-career-seasons.py keeps the seasons of active players.
Marks: "(!)" his totals for all teams that season, "(*)" with this team (his last), "(>)" with a team he left.
"""
import re, json, subprocess, sys
pdf = sys.argv[4] if len(sys.argv) > 4 else "2026-27-NBA-Guide-new.pdf"
def page(p): return subprocess.run(["pdftotext", "-layout", "-f", str(p), "-l", str(p), pdf, "-"], capture_output=True, text=True).stdout
# "(!)" totals for all his teams that season, "(*)" with this team (his last), "(>)" with this team (one he left)
ROW = re.compile(r"^\s*([A-Z][A-Za-zÀ-ž.’'\- ]+?)(\([!*>]\))?\s+((?:(?:[\d.]+|---)\s+){22}(?:[\d.]+|---))\s*$")
out, pages_used, seasons = [], 0, set()
lo, hi, dest = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
for p in [q for q in list(range(10, 20)) + list(range(270, 1011)) if lo <= q <= hi]:
    t = page(p)
    head = re.search(r"(\d{4}-\d{2}) Review: (Regular Season|Playoffs)", t)
    if not head or head.group(2) != "Regular Season": continue
    season = head.group(1)
    if int(season[:4]) < 1979: continue   # the 23-column layout (3-pointers) starts in 1979-80
    team = None
    used = False
    for line in t.splitlines():
        s = line.strip()
        if re.fullmatch(r"[A-Z][A-Z0-9 .'\-]+", s) and len(s) > 6 and "REVIEW" not in s and "STATISTICS" not in s: team = s
        m = ROW.match(line)
        if not m: continue
        name, mark = m.group(1).strip(), (m.group(2) or "")[1:2]
        if name.lower() in ("totals", "team", "team totals"): continue
        v = m.group(3).split()
        n = lambda i: None if v[i] == "---" else (float(v[i]) if "." in v[i] else int(v[i]))
        out.append({"season": season, "team": team, "name": name, "mark": mark, "g": n(0), "min": n(1), "fgm": n(2), "fga": n(3), "fg3m": n(5), "fg3a": n(6), "ftm": n(8), "fta": n(9),
                    "oreb": n(11), "dreb": n(12), "reb": n(13), "ast": n(14), "pf": n(15), "stl": n(17), "tov": n(18), "blk": n(19), "pts": n(20), "hi": n(22)})
        used = True; seasons.add(season)
    pages_used += used
json.dump(out, open(dest, "w"), ensure_ascii=False)
print(len(out), "rows from", pages_used, "pages;", len(seasons), "seasons", min(seasons or ["-"]), "-", max(seasons or ["-"]))
