#!/usr/bin/env python3
"""Record book JSON -> a readable reference (single-game, half, quarter, overtime, streak records first).
  python3 tools/record-book-md.py src/data/nba-record-book-2026-27.json src/data/nba-single-game-bests-2026-27.json > records-reference.md"""
import json, sys
d = json.load(open(sys.argv[1])); sg = json.load(open(sys.argv[2]))
LABEL = {"pts": "points", "fgm": "field goals", "ftm": "free throws", "fg3m": "3-pointers", "reb": "rebounds", "ast": "assists", "stl": "steals", "blk": "blocks"}
L = ["# NBA records reference: game, half, quarter, overtime and streaks", "",
     "From the Elias record book and single-game lists in the NBA's 2026-27 Guide (pp. 128-135, 149, 198-268), through 2025-26. For NBA Live's in-game alerts: the record, its holder(s), and the next marks.", "",
     "## Single-game lists: what it takes to make them", ""]
for book, stats in sg.items():
    L.append(f"- **{book}:** " + "; ".join(f"{LABEL[k]} {v['floor']}+ ({len(v['games'])} games on the list; record {max(g['value'] for g in v['games'])})" for k, v in stats.items()))
L.append("")
scopes = [("game", "Game"), ("half", "One half"), ("quarter", "One quarter"), ("overtime", "Overtime period"), ("streak", "Streaks")]
for book in ["Regular season", "NBA Cup", "Play-In", "Playoffs", "Finals", "All-Star"]:
    for side in ("player", "team"):
        rows = [r for r in d if r["book"] == book and r["side"] == side]
        groups = [(None, "All-Star")] if book == "All-Star" else scopes
        if not any(sc is None or r["scope"] == sc for sc, _ in groups for r in rows): continue
        L += [f"## {book}: {side} records", ""]
        for sc, label in groups:
            rs = [r for r in rows if sc is None or r["scope"] == sc]
            if not rs: continue
            if sc: L += [f"### {label}", ""]
            for r in rs:
                top = r["entries"][0]["value"]
                held = [e["holder"] for e in r["entries"] if e["value"] == top]
                nxt = [f'{e["value"]} {e["holder"].split(",")[0]}' for e in r["entries"] if e["value"] != top][:3]
                L.append(f'- **{r["title"]}: {top}** — {"; ".join(held[:4])}{f" (+{len(held) - 4} more)" if len(held) > 4 else ""}' + (f' · next: {", ".join(nxt)}' if nxt else ""))
            L.append("")
print("\n".join(L))
