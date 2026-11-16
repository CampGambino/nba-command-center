#!/usr/bin/env python3
"""
Every franchise's regular-season record by season, 1946-47 on (0.80).

  python3 tools/build-team-seasons.py <guide-text>/yby.txt src/data/nba-results-history.json > src/data/nba-team-seasons-2026-27.json

Source: the standings grid on each season's "Review: Regular Season" pages of the NBA Guide (yby.txt is the text of
pp. 270-1010). A row is taken only when its wins and losses give the percentage printed beside them. The guide's last
season in that text is 2024-25; 2025-26 is counted from the results history (ESPN), which is also used to check the
ten seasons the two share. Team names and codes are mapped to today's 30 franchises the way the league keeps their
histories (Seattle with Oklahoma City, the 1988-2002 Hornets with Charlotte); clubs that folded are left out.
"""
import collections, json, re, sys

CODES = {c: c for c in "ATL BOS BKN CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS CHA".split()}
CODES.update({"BAL": "WAS", "CAP": "WAS", "BUF": "LAC", "SDC": "LAC", "CIN": "SAC", "KCO": "SAC", "KCK": "SAC", "NJN": "BKN", "NYN": "BKN", "NOJ": "UTA",
              "NOH": "NOP", "NOK": "NOP", "SDR": "HOU", "SFW": "GSW", "SEA": "OKC", "VAN": "MEM"})
# Names in the older seasons: (name, first season start year, last, franchise or None for a club that folded).
NAMES = [("Atlanta", 1968, 1969, "ATL"), ("Baltimore", 1947, 1954, None), ("Baltimore", 1963, 1969, "WAS"), ("Boston", 1946, 1969, "BOS"),
         ("Chicago", 1946, 1949, None), ("Chicago", 1961, 1962, "WAS"), ("Chicago", 1966, 1969, "CHI"), ("Cincinnati", 1957, 1969, "SAC"),
         ("Cleveland", 1946, 1946, None), ("Denver", 1949, 1949, None), ("Detroit", 1946, 1946, None), ("Detroit", 1957, 1969, "DET"),
         ("Fort Wayne", 1948, 1956, "DET"), ("Indianapolis", 1948, 1952, None), ("LA Lakers", 1960, 1969, "LAL"), ("Milwaukee", 1951, 1954, "ATL"),
         ("Milwaukee", 1968, 1969, "MIL"), ("Minneapolis", 1948, 1959, "LAL"), ("New York", 1946, 1969, "NYK"), ("Philadelphia", 1946, 1961, "GSW"),
         ("Philadelphia", 1963, 1969, "PHI"), ("Phoenix", 1968, 1969, "PHX"), ("Pittsburgh", 1946, 1946, None), ("Providence", 1946, 1948, None),
         ("Rochester", 1948, 1956, "SAC"), ("San Diego", 1967, 1969, "HOU"), ("San Francisco", 1962, 1969, "GSW"), ("Seattle", 1967, 1969, "OKC"),
         ("St. Louis", 1946, 1949, None), ("St. Louis", 1955, 1967, "ATL"), ("Syracuse", 1949, 1962, "PHI"), ("Toronto", 1946, 1946, None),
         ("Tri-Cities", 1949, 1950, "ATL"), ("Washington", 1946, 1950, None), ("Anderson", 1949, 1949, None), ("Sheboygan", 1949, 1949, None), ("Waterloo", 1949, 1949, None)]

# ESPN files the NBA Cup title game with the regular season; the league does not count it.
CUP_FINALS = {"2023-12-09", "2024-12-17", "2025-12-16"}

def franchise(token, year):
    if token in CODES: return CODES[token]
    for name, a, b, f in NAMES:
        if token == name and a <= year <= b: return f or ""
    return None

def main(yby, history):
    rows, season, unknown = {}, None, set()
    for line in open(yby, encoding="utf-8", errors="replace"):
        m = re.search(r"\b((?:19|20)\d\d-\d\d) Review: Regular Season", line)
        if m: season = m.group(1); continue
        if not season: continue
        m = (re.match(r"^\s*([A-Za-z][A-Za-z.\- ]*?)\s*(?:\.\d)?\s*\.?\s+(?:(?:\d+|--|-)\s+)+?(\d+)\s+(\d+)\s+(\.\d{3}|1\.000)(?:\s|$)", line)
             or re.match(r"^\s*([A-Z]{3})\s+(?:(?:\d+|--)\s+){28,31}(\d+)\s+(\d+)\s+\.\s*$", line))
        if not m: continue
        w, l = int(m.group(2)), int(m.group(3))
        if not 20 <= w + l <= 84: continue
        if m.lastindex >= 4 and abs(w / (w + l) - float(m.group(4))) >= 0.0015: continue
        token = m.group(1).strip().rstrip(".").strip()
        f = franchise(token, int(season[:4]))
        if f is None: unknown.add((season, token)); continue
        if f: rows.setdefault((f, season), (w, l))
    if unknown: sys.exit(f"names not mapped: {sorted(unknown)}")
    # The results history: check the shared seasons, add the ones after the guide's text.
    H = json.load(open(history)); C = {c: i for i, c in enumerate(H["columns"])}
    hist = collections.defaultdict(lambda: [0, 0])
    for g in H["games"]:
        if g[C["type"]] != 2: continue
        if g[C["date"]] in CUP_FINALS: continue                           # the Cup's title game doesn't count in the standings
        y = int(g[C["date"]][:4]) - (1 if int(g[C["date"]][5:7]) < 9 else 0)
        if g[C["date"]][:7] in ("2020-07", "2020-08"): y = 2019          # the 2019-20 season finished in August
        s = f"{y}-{str(y + 1)[2:]}"; hs, as_ = g[C["homeScore"]], g[C["awayScore"]]
        for tri, win in ((g[C["home"]], hs > as_), (g[C["away"]], as_ > hs)): hist[(tri, s)][0 if win else 1] += 1
    diffs = [(k, rows[k], tuple(v)) for k, v in hist.items() if k in rows and rows[k] != tuple(v)]
    added = 0
    for k, v in hist.items():
        if k not in rows: rows[k] = tuple(v); added += 1
    teams = collections.defaultdict(list)
    for (f, s), (w, l) in sorted(rows.items(), key=lambda x: (x[0][0], x[0][1][:4])): teams[f].append([s, w, l])
    print(json.dumps({"source": "NBA 2026-27 Guide, each season's standings (pp. 270-1010), 1946-47 to 2024-25; 2025-26 from the results history (ESPN). Regular season only.",
                      "note": "Franchise histories as the league keeps them: Seattle with OKC, the 1988-2002 Hornets with CHA, Vancouver with MEM, and so on. Clubs that folded are left out.",
                      "teams": teams}, separators=(",", ":")))
    print(f"{len(rows)} team-seasons, {len(teams)} franchises; {added} from the results history; {len(diffs)} differences in the shared seasons: {diffs[:6]}", file=sys.stderr)

if __name__ == "__main__": main(*sys.argv[1:3])
