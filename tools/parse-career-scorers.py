#!/usr/bin/env python3
"""
"Top career scorers" (NBA Guide p. 136): every player with 19,000+ regular-season points, in order, with career totals.
  pdftotext -layout -f 136 -l 136 guide.pdf p.txt; python3 tools/parse-career-scorers.py p.txt > src/data/nba-career-scorers-2026-27.json
"""
import json, re, sys
ROW = re.compile(r"^(?P<name>[A-Z][^.]+?)\.{2,}\s*(?P<yrs>\d+)\s+(?P<rest>[\d,.\s]+?)\s+(?P<career>\d\d-\d\d)\s*$")
num = lambda s: int(s.replace(",", ""))
out = []
for line in open(sys.argv[1], encoding="utf-8"):
    m = ROW.match(line.strip())
    if not m: continue
    v = m.group("rest").split()
    if len(v) != 13: sys.exit(f"unexpected row: {line.strip()}")
    g, mn, fgm, fga, _, ftm, fta, _, reb, ast, pf, pts, _ = v
    out.append({"rank": len(out) + 1, "name": m.group("name").strip(), "gp": num(g), "min": num(mn), "fgm": num(fgm), "ftm": num(ftm), "reb": num(reb), "ast": num(ast), "pts": num(pts), "years": m.group("career")})
if any(a["pts"] < b["pts"] for a, b in zip(out, out[1:])): sys.exit("not in points order")
json.dump(out, sys.stdout, ensure_ascii=False, indent=0)
sys.stderr.write(f"{len(out)} scorers, {out[0]['name']} {out[0]['pts']:,} to {out[-1]['name']} {out[-1]['pts']:,}\n")
