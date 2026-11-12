#!/usr/bin/env python3
"""
Yearly regular-season statistical leaders (NBA Guide pp. 122-127), read from word positions.
  pdftotext -bbox -f 122 -l 127 guide.pdf words.html; python3 tools/parse-yearly-leaders.py words.html leaders.json
Then merged into src/data/nba-history-2026-27.json ("leaders"; disqualifications left out).
Each column is read top to bottom; a category title switches the category for what follows.
"""
import re, html, json, sys
TITLES = {"SCORING": "pts", "FIELD GOAL PERCENTAGE": "fgPct", "FREE THROW PERCENTAGE": "ftPct", "3-POINT FIELD GOAL PERCENTAGE": "fg3Pct", "MINUTES": "min",
          "REBOUNDING": "reb", "ASSISTS": "ast", "STEALS": "stl", "PERSONAL FOULS": "pf", "BLOCKED SHOTS": "blk", "DISQUALIFICATIONS": "dq"}
t = open(sys.argv[1], encoding="utf-8").read()
out, cat = {}, None
for p in t.split("<page ")[1:]:
    words = [(float(a), float(b), html.unescape(w)) for a, b, w in re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)</word>', p)]
    toks = [(x, y, w) for x, y, w in words if re.match(r"^\d{4}-\d{2}[—–-]", w)]
    cols = sorted({round(x / 15) * 15 for x, _, _ in toks})
    colof = lambda x: max([c for c in cols if c <= x + 12] or [cols[0]])
    events = []
    for x, y, w in toks:
        same = sorted([(wx, ww) for wx, wy, ww in words if abs(wy - y) < 2.5 and wx > x + 5])
        nxt = min([tx for tx, ty, _ in toks if abs(ty - y) < 2.5 and tx > x + 5] or [9999])
        name = " ".join(ww for wx, ww in same if wx < nxt)
        m = re.match(r"^(\d{4}-\d{2})[—–-]([\d,]*\.?\d+)\*?$", w)
        if m: events.append((colof(x), y, "e", (m.group(1), m.group(2), name)))
    # titles: join uppercase words on the same line into phrases
    lines = {}
    for x, y, w in words:
        if re.fullmatch(r"[A-Z0-9\-]{2,}", w): lines.setdefault(round(y), []).append((x, w))
    for y, ws in lines.items():
        ws.sort(); groups, cur = [], [ws[0]]
        for a, b in zip(ws, ws[1:]):
            if b[0] - a[0] < 90: cur.append(b)
            else: groups.append(cur); cur = [b]
        groups.append(cur)
        for g in groups:
            phrase = " ".join(w for _, w in g)
            if phrase in TITLES and cols: events.append((colof(g[0][0]), y, "t", TITLES[phrase]))
    for c, y, kind, v in sorted(events, key=lambda e: (e[0], e[1])):
        if kind == "t": cat = v; continue
        if cat:
            season, val, name = v
            player, _, team = name.partition(", ")
            out.setdefault(cat, []).append({"season": season, "value": float(val.replace(",", "")), "player": player.strip(), "team": team.strip()})
for k, v in out.items(): v.sort(key=lambda e: e["season"])
json.dump(out, open(sys.argv[2], "w"), ensure_ascii=False, indent=0)
for k, v in out.items():
    yrs = [int(e["season"][:4]) for e in v]
    gaps = [b for a, b in zip(yrs, yrs[1:]) if b - a != 1]
    print(k, len(v), v[0]["season"], "->", v[-1]["season"], v[-1]["player"], "| gaps/dupes:", gaps[:5])
