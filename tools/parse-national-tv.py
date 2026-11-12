"""
Reads the national TV schedule out of the NBA's Tip-Off Guide PDF (one page per network) into
src/data/national-tv-<season>.json. Used for 2026-27 (the user's PDF, 11/12):

  pdftotext/pypdf pages -> /tmp/tog/pNNN.txt, then:  python3 tools/parse-national-tv.py

Next season: check which page shows which network's logo (NET below), and the year rule (Aug-Dec = first year).
Then compare with ESPN's national broadcasts for the games already played (see CHANGES 0.30.0).
"""
import re, json, sys
NET = {16: ["ABC"], 17: ["ESPN"], 18: ["NBC", "Peacock"], 19: ["Peacock"], 20: ["Prime Video"]}
CITY = {"Atlanta":"ATL","Boston":"BOS","Brooklyn":"BKN","Charlotte":"CHA","Chicago":"CHI","Cleveland":"CLE","Dallas":"DAL","Denver":"DEN","Detroit":"DET","Golden State":"GSW","Houston":"HOU","Indiana":"IND","LA Clippers":"LAC","LA Lakers":"LAL","Memphis":"MEM","Miami":"MIA","Milwaukee":"MIL","Minnesota":"MIN","New Orleans":"NOP","New York":"NYK","Oklahoma City":"OKC","Orlando":"ORL","Philadelphia":"PHI","Phoenix":"PHX","Portland":"POR","Sacramento":"SAC","San Antonio":"SAS","Toronto":"TOR","Utah":"UTA","Washington":"WAS"}
MON = {m: i+1 for i, m in enumerate(["January","February","March","April","May","June","July","August","September","October","November","December"])}
names = "|".join(sorted(map(re.escape, CITY), key=len, reverse=True))
row = re.compile(rf"(January|February|March|April|October|November|December) (\d{{1,2}})([*+]*)\s+({names})\s+(at|vs\.?)\s+({names})\s+(\d{{1,2}}:\d\d [AP]M)")
games = {}
for page, nets in NET.items():
    t = open(f"/tmp/tog/p{page:03d}.txt").read()
    n = 0
    for m in row.finditer(t):
        mon, day, mark, away, sep, home, time = m.groups()
        y = 2026 if MON[mon] >= 8 else 2027
        d = f"{y}-{MON[mon]:02d}-{int(day):02d}"
        k = (d, CITY[away], CITY[home])
        g = games.setdefault(k, {"d": d, "away": CITY[away], "home": CITY[home], "time": time, "networks": [], "neutral": sep != "at"})
        extra = ["ESPN"] if (page == 16 and "*" in mark) or (page == 17 and "*" in mark and False) else []
        for x in nets + extra:
            if x not in g["networks"]: g["networks"].append(x)
        n += 1
    print(page, nets, n, file=sys.stderr)
out = sorted(games.values(), key=lambda g: (g["d"], g["time"], g["away"]))
json.dump(out, open("/tmp/natl/national.json", "w"), indent=0)
print(len(out), "games", file=sys.stderr)
