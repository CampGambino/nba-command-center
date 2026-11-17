#!/usr/bin/env python3
"""
Each team media guide's "SERIES HISTORY VS. <OPPONENT>" block (0.84): the all-time regular-season record against
every opponent (overall, home, road, neutral), the current streak in each, and the dates of the last win and loss.

  python3 tools/parse-series-history.py <dir of the 30 guides as text> [out.json]

The guides were printed before 2026-27, so every number is through 2025-26. A pairing is printed from both sides when
both teams' guides carry the block, and the two must mirror each other (A's wins are B's losses, A's home is B's
road): the check at the end counts how many do.
"""
import sys, re, os, glob, json

NICK = {"HAWKS": "ATL", "CELTICS": "BOS", "NETS": "BKN", "HORNETS": "CHA", "BULLS": "CHI", "CAVALIERS": "CLE", "MAVERICKS": "DAL", "NUGGETS": "DEN",
        "PISTONS": "DET", "WARRIORS": "GSW", "ROCKETS": "HOU", "PACERS": "IND", "CLIPPERS": "LAC", "LAKERS": "LAL", "GRIZZLIES": "MEM", "HEAT": "MIA",
        "BUCKS": "MIL", "TIMBERWOLVES": "MIN", "PELICANS": "NOP", "KNICKS": "NYK", "THUNDER": "OKC", "MAGIC": "ORL", "76ERS": "PHI", "SIXERS": "PHI",
        "SUNS": "PHX", "TRAIL BLAZERS": "POR", "BLAZERS": "POR", "KINGS": "SAC", "SPURS": "SAS", "RAPTORS": "TOR", "JAZZ": "UTA", "WIZARDS": "WAS"}
FILE = {"Atlanta-Hawks": "ATL", "Boston-Celtics": "BOS", "Brooklyn-Nets": "BKN", "Charlotte-Hornets": "CHA", "Chicago-Bulls": "CHI", "Cleveland-Cavaliers": "CLE",
        "Dallas-Mavericks": "DAL", "Denver-Nuggets": "DEN", "Detroit-Pistons": "DET", "Golden-State-Warriors": "GSW", "Houston-Rockets": "HOU", "Indiana-Pacers": "IND",
        "LA-Clippers": "LAC", "Los-Angeles-Lakers": "LAL", "Memphis-Grizzlies": "MEM", "Miami-Heat": "MIA", "Milwaukee-Bucks": "MIL", "Minnesota-Timberwolves": "MIN",
        "New-Orleans-Pelicans": "NOP", "New-York-Knicks": "NYK", "Orlando-Magic": "ORL", "Philadelphia-76ers": "PHI", "Phoenix-Suns": "PHX",
        "Portland-Trail-Blazers": "POR", "Sacramento-Kings": "SAC", "San-Antonio-Spurs": "SAS", "Thunder": "OKC", "Toronto-Raptors": "TOR", "Utah-Jazz": "UTA", "Washington-Wizards": "WAS"}
HEAD = re.compile(r"SERIES HISTORY VS\.?\s+(?:THE\s+)?([A-Z0-9 ]+?)\s*$")
DATE = r"(\d{1,2}/\d{1,2}/\d{2,4})"
ROW = re.compile(r"\b(Overall|Home|Road|Neutral)\s+(\d+)\s*-\s*(\d+)(?:\s+(Won|Lost)\s+(\d+))?(?:\s+" + DATE + r")?(?:\s+" + DATE + r")?")

def iso(d):
    if not d: return None
    m, dd, y = d.split("/"); y = int(y)
    if y < 100: y += 1900 if y >= 46 else 2000
    return f"{y:04d}-{int(m):02d}-{int(dd):02d}"

def parse(text):
    out = {}
    lines = text.split("\n")
    for i, l in enumerate(lines):
        h = HEAD.search(l.rstrip())
        if not h: continue
        opp = NICK.get(h.group(1).strip())
        if not opp: continue
        rec = {}
        for l2 in lines[i + 1:i + 9]:
            if "SERIES HISTORY" in l2: break
            for m in ROW.finditer(l2):
                k = m.group(1).lower()
                if k in rec: continue
                r = {"w": int(m.group(2)), "l": int(m.group(3))}
                if m.group(4): r["streak"] = (1 if m.group(4) == "Won" else -1) * int(m.group(5))
                if m.group(6): r["lastW"] = iso(m.group(6))
                if m.group(7): r["lastL"] = iso(m.group(7))
                rec[k] = r
        if "overall" in rec and opp not in out: out[opp] = rec
    return out

CITY = {"atlanta": "ATL", "boston": "BOS", "brooklyn": "BKN", "charlotte": "CHA", "chicago": "CHI", "cleveland": "CLE", "dallas": "DAL", "denver": "DEN",
        "detroit": "DET", "golden state": "GSW", "houston": "HOU", "indiana": "IND", "l.a. clippers": "LAC", "la clippers": "LAC", "l.a. lakers": "LAL", "la lakers": "LAL",
        "memphis": "MEM", "miami": "MIA", "milwaukee": "MIL", "minnesota": "MIN", "new orleans": "NOP", "new york": "NYK", "oklahoma city": "OKC", "orlando": "ORL",
        "philadelphia": "PHI", "phoenix": "PHX", "portland": "POR", "sacramento": "SAC", "san antonio": "SAS", "toronto": "TOR", "utah": "UTA", "washington": "WAS"}

def parse_uta(text):
    """Utah: one table, "RECORD VS. OPPONENTS": this-season home/road/total, then all-time home, road, total."""
    out = {}
    i = text.find("RECORD VS. OPPONENTS")
    for m in re.finditer(r"^vs\. (.+?)\s+\d+-\d+\s+\d+-\d+\s+\d+-\d+\s+(\d+)-(\d+)\s+(\d+)-(\d+)\s+(\d+)-(\d+)\s+\.\d+", text[i:i + 6000] if i >= 0 else "", re.M):
        opp = CITY.get(m.group(1).strip().lower())
        if opp and opp not in out:
            v = list(map(int, m.groups()[1:]))
            out[opp] = {"overall": {"w": v[4], "l": v[5]}, "home": {"w": v[0], "l": v[1]}, "road": {"w": v[2], "l": v[3]}}
    return out

def parse_orl(text):
    """Orlando: "ALL-TIME SERIES: ORLANDO VS. <TEAM>" then "Regular Season Record: 65-78 (Magic 42-29 @ home, 23-48 @ Atlanta, 0-1 @ Mexico City)"."""
    out = {}
    for m in re.finditer(r"ALL-TIME SERIES: ORLANDO VS\.\s+([A-Z0-9 .]+?)\s*\n\s*Regular Season Record: (\d+)-(\d+) \(Magic (\d+)-(\d+) @ home((?:, \d+-\d+ @ [^,)]+)*)\)", text):
        name = m.group(1).strip()
        opp = next((t for n, t in sorted(NICK.items(), key=lambda kv: -len(kv[0])) if name.endswith(n)), None)
        if not opp or opp in out: continue
        rec = {"overall": {"w": int(m.group(2)), "l": int(m.group(3))}, "home": {"w": int(m.group(4)), "l": int(m.group(5))}}
        away = {"w": rec["overall"]["w"] - rec["home"]["w"], "l": rec["overall"]["l"] - rec["home"]["l"]}
        sites = re.findall(r"(\d+)-(\d+) @ ([^,)]+)", m.group(6))
        if len(sites) == 1: rec["road"] = away               # one other site: the opponent's building
        else: rec["away"] = away                             # several (a former city, neutral sites): not split here
        out[opp] = rec
    return out

def parse_ind(text):
    """Indiana: "SERIES RECORD / OVERALL: / Indiana 101 wins / Atlanta 113 wins / at INDIANA / ... / at ATLANTA / ..."."""
    out = {}
    lines = text.split("\n")
    for i, l in enumerate(lines):
        if not re.search(r"^\s*SERIES RECORD\b", l): continue
        col = [re.split(r"\s{3,}|\t", x.strip())[0] for x in lines[i + 1:i + 16]]   # the left column only
        wins = lambda j: [int(x) for x in re.findall(r"(\d+) wins?", " ".join(col[j:j + 2]))]
        try:
            if "OVERALL" not in col[0]: continue
            oppn = re.match(r"\s*(.+?) \d+ wins?", col[2]).group(1).strip().lower()
            opp = CITY.get(oppn) or CITY.get({"la lakers": "l.a. lakers", "los angeles lakers": "l.a. lakers", "los angeles clippers": "l.a. clippers", "l.a. clippers": "l.a. clippers", "la clippers": "l.a. clippers"}.get(oppn, oppn))
            o = wins(1)
            rec = {"overall": {"w": o[0], "l": o[1]}}
            j = 3
            while j < len(col) and re.match(r"\s*at ", col[j]):
                site = re.sub(r"\s*\(.*?\)|:", "", col[j].strip()[3:]).strip().lower(); v = wins(j + 1)
                key = "home" if site == "indiana" else "road" if CITY.get(site) == opp or site in oppn else "neutral"
                if len(v) == 2:
                    if key in rec: rec[key] = {"w": rec[key]["w"] + v[0], "l": rec[key]["l"] + v[1]}
                    else: rec[key] = {"w": v[0], "l": v[1]}
                j += 3
            if opp and opp not in out: out[opp] = rec
        except Exception:
            continue
    return out

OWN = {"UTA": parse_uta, "ORL": parse_orl, "IND": parse_ind}

def main():
    d = sys.argv[1]; res = {}
    for f in sorted(glob.glob(os.path.join(d, "*.txt"))):
        name = os.path.basename(f)[8:-16]; tri = FILE.get(name)
        if not tri: print("?", name); continue
        text = open(f, encoding="utf8", errors="replace").read()
        got = parse(text) or (OWN[tri](text) if tri in OWN else {})
        got.pop(tri, None)
        if got: res[tri] = got
        print(f"{tri} {len(got):2d} opponents")
    # A pairing printed from both sides must mirror.
    both = same = 0; bad = []
    for a in res:
        for b, r in res[a].items():
            if a < b and b in res and a in res[b]:
                both += 1; o = res[b][a]
                okm = (r["overall"]["w"], r["overall"]["l"]) == (o["overall"]["l"], o["overall"]["w"])
                for x, y in (("home", "road"), ("road", "home")):
                    if x in r and y in o and (r[x]["w"], r[x]["l"]) != (o[y]["l"], o[y]["w"]): okm = False
                same += okm
                if not okm: bad.append((a, b, r["overall"], o["overall"], r.get("home"), o.get("road"), r.get("road"), o.get("home")))
    # Each record must add up: overall = home + road + neutral.
    adds = sum(1 for a in res for r in res[a].values() if "away" in r or all(k in r for k in ("home", "road")) and r["overall"]["w"] == r["home"]["w"] + r["road"]["w"] + r.get("neutral", {"w": 0})["w"] and r["overall"]["l"] == r["home"]["l"] + r["road"]["l"] + r.get("neutral", {"l": 0})["l"])
    n = sum(len(v) for v in res.values())
    pairs = {tuple(sorted((a, b))) for a in res for b in res[a]}
    print(f"{len(res)} guides, {n} team-opponent records, {len(pairs)} of 435 pairings covered; {adds} add up (home + road + neutral); {both} printed from both sides, {same} mirror")
    for x in bad[:40]: print("  differs", x)
    # How often each guide's overall record is mirrored by the other guide of a pairing: the measure of which guides to lean on.
    agree = {}
    for a in res:
        for b, r in res[a].items():
            if b in res and a in res[b]:
                o = res[b][a]["overall"]; m = (r["overall"]["w"], r["overall"]["l"]) == (o["l"], o["w"])
                x = agree.setdefault(a, [0, 0]); x[1] += 1; x[0] += m
    print("mirrored / compared:", " ".join(f"{t} {v[0]}/{v[1]}" for t, v in sorted(agree.items())))
    if len(sys.argv) > 2:
        json.dump({"through": "2025-26", "source": "team media guides for 2026-27 (regular season), read by tools/parse-series-history.py",
                   "guides": {t: {"agree": agree.get(t, [0, 0])} for t in sorted(res)}, "teams": res}, open(sys.argv[2], "w"), separators=(",", ":"))
main()
