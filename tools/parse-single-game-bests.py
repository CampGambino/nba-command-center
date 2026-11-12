#!/usr/bin/env python3
"""
"Single-game bests" lists from the NBA's guide (regular season pp. 128-135, NBA Cup p. 149) -> JSON.

  pdftotext -layout -f 128 -l 135 guide.pdf rs.txt; pdftotext -layout -f 149 -l 149 guide.pdf cup.txt
  python3 tools/parse-single-game-bests.py rs.txt cup.txt > src/data/nba-single-game-bests-2026-27.json

Each list holds every game at or above its floor: { book: { stat: { floor, games: [{ player, team, home, opp, date, ot, value, detail }] } } }
"""
import json, re, sys
STATS = {"POINTS": "pts", "FIELD GOALS MADE": "fgm", "FREE THROWS MADE": "ftm", "THREE-POINTERS MADE": "fg3m", "REBOUNDS": "reb",
         "ASSISTS": "ast", "STEALS": "stl", "BLOCKED SHOTS": "blk"}
ROW = re.compile(r"^(?P<player>[^,]+), (?P<team>.+?) (?P<va>vs\.|at) (?P<opp>.+?), (?P<date>[A-Z][a-z]+\.? \d{1,2}, \d{4})(?P<ot>\**)(?P<final>\^?)[\s.]+(?P<nums>(?:\d+\s*)+)$")
out = {}
# Arguments: rs.txt cup.txt (the regular season and the NBA Cup), then optional more books as Book=path
# ("Play-In=p164.txt", "Playoffs=p171.txt", "Finals=p181.txt": the same layout).
pairs = list(zip(sys.argv[1:3], ["Regular season", "NBA Cup"])) + [(a.split("=", 1)[1], a.split("=", 1)[0]) for a in sys.argv[3:]]
for path, book in pairs:
    stat = None
    lines = [l.strip() for l in open(path, encoding="utf-8")]
    # a row whose numbers wrapped onto the next line (Joe Fulks, 2/10/49)
    for i in range(len(lines) - 1):
        if re.search(r"\d{4}\**\^?[ .]+$", lines[i]) and re.fullmatch(r"(?:\d+\s*)+", lines[i + 1]): lines[i], lines[i + 1] = f"{lines[i]} {lines[i + 1]}", ""
    for s in lines:
        # a heading, alone or followed by its column labels ("FIELD GOALS MADE    FGM   FGA")
        head = re.match(r"^([A-Z][A-Z -]+?)(?:\s{2,}[A-Z0-9 ]+)?$", s)
        if head and head.group(1).strip() in STATS: stat = STATS[head.group(1).strip()]; continue
        if book != "Regular season" and ("CAREER LEADERS" in s or "CAREER POINTS" in s): break
        m = ROW.match(s)
        if not (m and stat): continue
        nums = [int(x) for x in m.group("nums").split()]
        # the stat is the last column for points (FGM FTM PTS), the first otherwise (FGM FGA, 3PM 3PA)
        value = nums[-1] if stat == "pts" or len(nums) == 1 else nums[0]
        g = {"player": m.group("player").strip(), "team": m.group("team"), "home": m.group("va") == "vs.", "opp": m.group("opp"), "date": m.group("date"),
             "ot": len(m.group("ot")), "value": value, "detail": nums}
        if m.group("final"): g["final"] = True
        out.setdefault(book, {}).setdefault(stat, {"games": []})["games"].append(g)
for book in out.values():
    for st, L in book.items(): L["floor"] = min(g["value"] for g in L["games"])
json.dump(out, sys.stdout, ensure_ascii=False, indent=0)
sys.stderr.write("; ".join(f"{b}: " + ", ".join(f"{k} {len(v['games'])} games (floor {v['floor']}, top {max(g['value'] for g in v['games'])})" for k, v in d.items()) for b, d in out.items()) + "\n")
