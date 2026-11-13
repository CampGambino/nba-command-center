#!/usr/bin/env python3
"""
Our franchise top 10s against the 30 team media guides (their text, pdftotext -layout), on the PC:
  cd guide-text && python3 verify_teams.py   (needs fc.json = src/data/nba-franchise-careers-2026-27.json, teams/*.txt)
A top-10 entry is confirmed when a line has his last name and our exact total.
"""
import json, re, os, sys, unicodedata
fc = json.load(open("fc.json"))["franchises"]
FILE = {"ATL":"Atlanta-Hawks","BOS":"Boston-Celtics","BKN":"Brooklyn-Nets","CHA":"Charlotte-Hornets","CHI":"Chicago-Bulls","CLE":"Cleveland-Cavaliers","DAL":"Dallas-Mavericks","DEN":"Denver-Nuggets","DET":"Detroit-Pistons","GSW":"Golden-State-Warriors","HOU":"Houston-Rockets","IND":"Indiana-Pacers","LAC":"LA-Clippers","LAL":"Los-Angeles-Lakers","MEM":"Memphis-Grizzlies","MIA":"Miami-Heat","MIL":"Milwaukee-Bucks","MIN":"Minnesota-Timberwolves","NOP":"New-Orleans-Pelicans","NYK":"New-York-Knicks","ORL":"Orlando-Magic","PHI":"Philadelphia-76ers","PHX":"Phoenix-Suns","POR":"Portland-Trail-Blazers","SAC":"Sacramento-Kings","SAS":"San-Antonio-Spurs","OKC":"Thunder","TOR":"Toronto-Raptors","UTA":"Utah-Jazz","WAS":"Washington-Wizards"}
STATS = ["pts","reb","ast","stl","blk","fg3m","g"]
def norm(s): return unicodedata.normalize("NFD", s.replace("\u2019", "'")).encode("ascii","ignore").decode().lower()
out = {}
for t, f in FILE.items():
    txt = norm(open(f"teams/2026-27-{f}-Media-Guide.txt", encoding="utf-8", errors="ignore").read())
    lines = txt.splitlines()
    found = miss = 0; misses = []
    for s in STATS:
        for name, v, first, last in fc[t]["top"][s][:10]:
            ln = norm(name.replace(" Jr.", "").replace(" III", "").replace(" II", "")).split()[-1]
            num = [f"{v:,}", str(v)]
            pat = re.compile(r"(?<![\d,])(" + "|".join(re.escape(n) for n in num) + r")(?![\d,]|\.\d)")
            ok = any(ln in L and pat.search(L) for L in lines)
            if ok: found += 1
            else: miss += 1; misses.append((s, name, v))
    out[t] = {"found": found, "miss": miss, "misses": misses}
    print(t, found, miss, misses[:6])
json.dump(out, open("verify-teams.json", "w"))
