#!/usr/bin/env python3
"""
Coaching rankings (NBA Guide p. 145): every coach with 300+ regular-season wins (W, L) and the top 20 by games.
  pdftotext -layout -f 136 -l 148 guide.pdf p.txt; python3 tools/parse-coaches.py p.txt > src/data/nba-coaches-2026-27.json
"""
import json, re, sys
txt = open(sys.argv[1], encoding="utf-8").read()
start = txt.index("COACHING RANKINGS"); end = txt.index("BY VICTORIES, COMBINED NBA/ABA")
block = txt[start:end]
num = lambda s: int(s.replace(",", ""))
wins, games = [], []
NAME = r"([A-Z][A-Za-z.’' \-]+?)\.{2,}\s*"
for line in block.splitlines():
    # W-L rows: "Name.....1,390   824   .628" (one or two per line); win-pct rows start with ".pct" and are skipped
    for m in re.finditer(NAME + r"([\d,]+)\s+([\d,]+)\s+\.\d{3}", line):
        wins.append({"name": re.split(r"\s{2,}", m.group(1).strip())[-1], "w": num(m.group(2)), "l": num(m.group(3))})
    m = re.search(NAME + r"([\d,]+)\s*$", line)
    if m and not re.search(r"\.\d{3}\s*$", line) and num(m.group(2)) > 1000: games.append({"name": re.split(r"\s{2,}", m.group(1).strip())[-1], "g": num(m.group(2))})
seen, out = set(), []
for c in sorted(wins, key=lambda c: -c["w"]):
    if c["name"] in seen: continue
    seen.add(c["name"]); out.append(c)
for i, c in enumerate(out): c["rank"] = 1 + sum(1 for x in out if x["w"] > c["w"])
for i, c in enumerate(games): c["rank"] = 1 + sum(1 for x in games if x["g"] > c["g"])
if len(out) < 70 or out[0]["name"] != "Gregg Popovich" or len(games) != 20: sys.exit(f"coaches: {len(out)} by wins, {len(games)} by games")
json.dump({"source": "NBA 2026-27 Guide p. 145 (through 2025-26)", "wins": out, "games": games}, sys.stdout, ensure_ascii=False, indent=0)
sys.stderr.write(f"{len(out)} coaches by wins ({out[-1]['name']} {out[-1]['w']}), {len(games)} by games\n")
