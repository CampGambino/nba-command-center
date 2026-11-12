#!/usr/bin/env python3
"""
Award winners (NBA Guide pp. 100-121, single-winner awards) and yearly statistical leaders (pp. 122-127) -> JSON.
  pdftotext -layout -f 100 -l 121 guide.pdf a.txt; pdftotext -layout -f 122 -l 127 guide.pdf y.txt
  python3 tools/parse-history.py a.txt y.txt > src/data/nba-history-2026-27.json
Output: { awards: { "NBA Most Valuable Player": [{ season, player, team }] }, leaders: { pts: [{ season, value, player, team }] } }
"""
import json, re, sys
aw_txt, yl_txt = (open(p, encoding="utf-8").read() for p in sys.argv[1:3])
ENTRY_A = re.compile(r"(\d{4}(?:-\d{2})?) — ([^,]+?), ([A-Za-z.’' ]+?)( \(tie\))?(?=\s{3,}|\s*$)")
# A shared award prints the second winner on the next line, under the first, without the season.
TIE_2 = re.compile(r"(?:(?<=\s{3})|^)([A-Z][^,—\d]+?), ([A-Za-z.’' ]+?) \(tie\)(?=\s{3,}|\s*$)")
awards, title, ties = {}, None, {}
for line in aw_txt.splitlines():
    s = line.strip()
    if re.fullmatch(r"(NBA [A-Z].*|TWYMAN-STOKES.*|BOB LANIER.*|KAREEM.*|J\. WALTER.*)", s) and s.upper() == s:
        title = s.title().replace("Nba", "NBA").replace("Mvp", "MVP"); continue
    if s.startswith("ALL-NBA") or s.startswith("ALL-DEFENSIVE") or s.startswith("ALL-ROOKIE"): title = None; continue
    if title:
        for m in ENTRY_A.finditer(line):
            awards.setdefault(title, []).append({"season": m.group(1), "player": m.group(2).strip(), "team": m.group(3).strip()})
            if m.group(4): ties[(title, m.start() // 20)] = m.group(1)
        for m in TIE_2.finditer(line):
            if re.match(r"\s*\d{4}", line[max(0, m.start() - 12):m.start() + 1]): continue
            season = ties.pop((title, (m.start() - 7) // 20), None) or ties.pop((title, m.start() // 20), None)
            if season: awards[title].append({"season": season, "player": m.group(1).strip(), "team": m.group(2).strip()})
TITLES = {"SCORING": "pts", "FIELD GOAL PERCENTAGE": "fgPct", "FREE THROW PERCENTAGE": "ftPct", "3-POINT FIELD GOAL PERCENTAGE": "fg3Pct", "MINUTES": "min",
          "REBOUNDING": "reb", "ASSISTS": "ast", "STEALS": "stl", "PERSONAL FOULS": "pf", "BLOCKED SHOTS": "blk", "DISQUALIFICATIONS": "dq"}
ENTRY = re.compile(r"(\d{4}-\d{2})\s*—\s*([\d,]*\.?\d+)\*?\s+([^,]+?), ([A-Za-z.’' /]+?)(?=\s{3,}|\s*$)")
leaders, cur = {}, [None, None]
for line in yl_txt.splitlines():
    for t, k in TITLES.items():
        for m in re.finditer(rf"(?<![A-Z0-9\-] )(?<![A-Z0-9\-]){re.escape(t)}(?=\s{{2,}}|\s*$)", line): cur[0 if m.start() < 55 else 1] = k
    for m in ENTRY.finditer(line):
        k = cur[0 if m.start() < 55 else 1]
        if k: leaders.setdefault(k, []).append({"season": m.group(1), "value": float(m.group(2).replace(",", "")), "player": m.group(3).strip(), "team": m.group(4).strip()})
for k in leaders: leaders[k].sort(key=lambda e: e["season"])
for k in awards: awards[k].sort(key=lambda e: e["season"])
# The yearly leaders' layout (columns that change width from page to page) isn't read reliably yet:
# every list must reach 2025-26 and run without a gap, or it's left out.
def whole(v):
    seasons = [int(e["season"][:4]) for e in v]
    return seasons and seasons[-1] == 2025 and all(b - a == 1 for a, b in zip(seasons, seasons[1:]))
dropped = [k for k, v in leaders.items() if not whole(v)]
leaders = {k: v for k, v in leaders.items() if whole(v)}
if len(awards) < 10: sys.exit(f"history: {len(awards)} awards")
json.dump({"source": "NBA 2026-27 Guide pp. 100-127 (through 2025-26)", "awards": awards, "leaders": leaders, "leadersNotRead": dropped}, sys.stdout, ensure_ascii=False, indent=0)
sys.stderr.write(f"{len(awards)} awards ({sum(len(v) for v in awards.values())} winners); leaders: " + ", ".join(f"{k} {len(v)}" for k, v in leaders.items()) + "\n")
