"""
The largest margin each way against every opponent, as three guides print it -> src/data/series-bests-2026-27.json (0.90).

  python3 tools/parse-series-bests.py <folder of guide text> src/data/series-bests-2026-27.json

Phoenix, Philadelphia and Detroit print, on each opponent's page, their largest win over that team and their largest
loss to it. (Dallas prints a largest win too, but its lines sit apart from the opponent they belong to and are not read.) The Command Center counts the same thing from the games themselves
(src/records/pairs.js); these are the check on it.
"""
import glob, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guide_games import NICK

MON = {m: i + 1 for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"])}
def iso(s):
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{2,4})$", s.strip())
    if m:
        y = int(m.group(3)); y = y if y > 100 else (1900 + y if y >= 46 else 2000 + y)
        return f"{y}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    m = re.match(r"([A-Z][a-z]+)\.? (\d{1,2}), (\d{4})$", s.strip())
    return f"{m.group(3)}-{MON[m.group(1).lower()]:02d}-{int(m.group(2)):02d}" if m and m.group(1).lower() in MON else None
def nick(s):
    n = s.strip().upper()
    for k in sorted(NICK, key=len, reverse=True):
        if n.endswith(k): return NICK[k]
    return None

def text_of(d, key): return open([x for x in glob.glob(os.path.join(d, "*.txt")) if key in os.path.basename(x)][0], encoding="utf8", errors="replace").read()

def main():
    d = sys.argv[1]; out = {}
    put = lambda t, o, k, m, date: out.setdefault(t, {}).setdefault(o, {}).__setitem__(k, {"m": int(m), "d": date}) if o and o != t and date else None
    # Phoenix: "Suns Largest Margin of Victory ..... 39 (134-95, 12/29/90)" then "Heat Largest Margin of Victory ..... 28 (125-97, 1/27/97)"
    opp = None
    for line in text_of(d, "Phoenix-Suns").split("\n"):
        m = re.match(r"\s*([A-Z0-9][A-Za-z0-9 ]+?) Largest Margin of Victory\s*[. ]+\s*(\d+)\s*\((?:\d+-\d+,\s*)?(\d{1,2}/\d{1,2}/\d{2,4})", line)
        if not m: continue
        who = nick(m.group(1))
        if who == "PHX": mine = (m.group(2), iso(m.group(3)))
        elif who and "mine" in dir() and mine: put("PHX", who, "win", *mine); put("PHX", who, "loss", m.group(2), iso(m.group(3))); mine = None
    # Philadelphia: "76ers Largest Margin of Victory … 42, 10/29/66     Celtics Largest Margin of Victory … 48, 2/15/22"
    for line in text_of(d, "Philadelphia-76ers").split("\n"):
        ms = re.findall(r"([A-Z0-9][A-Za-z0-9 ]+?) Largest Margin of Victory\s*[.… ]+\s*(\d+),\s*(\d{1,2}/\d{1,2}/\d{2,4})", line)
        if len(ms) == 2 and nick(ms[0][0]) == "PHI": put("PHI", nick(ms[1][0]), "win", ms[0][1], iso(ms[0][2])); put("PHI", nick(ms[1][0]), "loss", ms[1][1], iso(ms[1][2]))
    # Detroit: under "PISTONS VS. X": "Largest Winning Margin: 40 vs. St. Louis, January 7, 1966 (137-97)", "Largest Losing Margin: 44 at Atlanta, …"
    opp = None
    for line in text_of(d, "Detroit-Pistons").split("\n"):
        h = re.search(r"PISTONS VS\. (.+?) (?:--|OPPONENT SERIES)", line)
        if h: opp = NICK.get(h.group(1).strip())
        m = re.match(r"\s*Largest (Winning|Losing) Margin:\s*\^?(\d+) (?:vs\.|at) [^,]+,\s*([A-Z][a-z]+ \d{1,2}, \d{4})", line)
        if m and opp: put("DET", opp, "win" if m.group(1) == "Winning" else "loss", m.group(2), iso(m.group(3)))
    for t in out: print(t, len(out[t]), "opponents;", sum(len(v) for v in out[t].values()), "margins")
    json.dump({"through": "2025-26", "source": "the Suns', 76ers' and Pistons' 2026-27 media guides: largest win and loss against each opponent (tools/parse-series-bests.py)", "teams": out}, open(sys.argv[2], "w"), separators=(",", ":"))
main()
