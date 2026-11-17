"""
Team single-game records as the guides print them -> src/data/team-game-records-2026-27.json (0.92).

  python3 tools/parse-team-records.py <folder of guide text> src/data/team-game-records-2026-27.json

The first pass over all 30 guides (11/17/26) found these pages are text, not pictures, but each guide lays them out
its own way, so each needs its own reader. Read so far: Philadelphia (pp. 243-244, one record a line: stat, period,
value, opponent, date). Add a reader per guide to READERS; claude/team-guide-inventory.md lists where each guide's
pages are.

A record: { stat, kind: "most"|"fewest", period: "game"|"half"|"quarter"|"ot", value, opp, date }. Only whole numbers
of the stats this season's box scores carry are kept.
"""
import glob, json, os, re, sys

STAT = {"POINTS": "pts", "FGM": "fgm", "FGA": "fga", "3-PT FGM": "fg3m", "3-PT FGA": "fg3a", "FTM": "ftm", "FTA": "fta", "REBOUNDS": "reb", "OFFENSIVE REBOUNDS": "oreb", "DEFENSIVE REBOUNDS": "dreb",
        "ASSISTS": "ast", "STEALS": "stl", "BLOCKS": "blk", "BLOCKED SHOTS": "blk", "TURNOVERS": "tov", "PERSONAL FOULS": "pf"}

def iso(s):
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{2,4})$", s)
    y = int(m.group(3)); y = y if y > 100 else (1900 + y if y >= 46 else 2000 + y)
    return f"{y}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"

def read_phi(pages):
    out = []; stat = kind = period = None
    for p in pages:
        if "TEAM SINGLE-GAME RECORDS" not in p[:400]: continue
        for line in p.split("\n"):
            cells = [c.strip() for c in re.split(r"\s{2,}", line.strip()) if c.strip()]
            if not cells: continue
            h = re.match(r"^(MOST|FEWEST) (.+?)(?: \(CONT\.\))?$", cells[0])
            if h: kind, stat = h.group(1).lower(), STAT.get(h.group(2)); cells = cells[1:]
            elif re.match(r"^(BEST|WORST|HIGHEST|LOWEST) ", cells[0]): stat = None; continue
            if cells and re.match(r"^(Game|Half|Quarter|OT|\d(?:st|nd|rd|th) (?:Half|Quarter))\b", cells[0]):
                period = "game" if cells[0].startswith("Game") else "half" if "Half" in cells[0] else "quarter" if "Quarter" in cells[0] else "ot"; cells = cells[1:]
            if stat and period and len(cells) >= 3 and re.fullmatch(r"\d{1,3}", cells[0]) and re.fullmatch(r"\d{1,2}/\d{1,2}/\d{2,4}", cells[-1]):
                out.append({"stat": stat, "kind": kind, "period": period, "value": int(cells[0]), "opp": " ".join(cells[1:-1]), "date": iso(cells[-1])})
    return out

READERS = {"PHI": ("Philadelphia-76ers", read_phi)}

def main():
    d = sys.argv[1]; teams = {}
    for tri, (key, fn) in READERS.items():
        f = [x for x in glob.glob(os.path.join(d, "*.txt")) if key in os.path.basename(x)][0]
        rows = fn(open(f, encoding="utf8", errors="replace").read().split("\f"))
        # The mark for a stat and period is the highest (or lowest) value printed; ties share it.
        best = {}
        for r in rows:
            k = (r["stat"], r["kind"], r["period"]); b = best.get(k)
            better = b is None or (r["value"] > b[0]["value"] if r["kind"] == "most" else r["value"] < b[0]["value"])
            if better: best[k] = [r]
            elif r["value"] == b[0]["value"]: b.append(r)
        teams[tri] = [{"stat": k[0], "kind": k[1], "period": k[2], "value": v[0]["value"], "games": [{"opp": x["opp"], "date": x["date"]} for x in v]} for k, v in best.items()]
        print(tri, len(rows), "rows read;", len(teams[tri]), "marks;", ", ".join(f"{m['kind']} {m['stat']} {m['period']} {m['value']}" for m in teams[tri] if m["period"] == "game")[:400])
    json.dump({"through": "2025-26", "source": "team media guides for 2026-27, team single-game records (tools/parse-team-records.py)", "teams": teams}, open(sys.argv[2], "w"), separators=(",", ":"))
main()
