#!/usr/bin/env python3
"""
Every game a guide prints beside a team mark (src/data/team-game-records-2026-27.json: whole games, halves, quarters and
overtimes, every stat), checked against the games themselves. No box score is needed, so this reaches the marks nothing
else here can (a rebound mark for a quarter, a game in 1971):

  1. the team played that day (ESPN's results from 1993-94, the guides' own game lists before);
  2. the opponent the guide names is the opponent of that day (the site is only counted: guides write "vs." for road games too);
  3. two guides, one night: a team's mark and the other team's "by an opponent" mark for the same stat and period agree.

A wrong date is the commonest fault on these pages (about 1 printed game in 30), and most wrong dates land on a day
the team did not play, or played someone else.

  python3 tools/check-mark-nights.py [--out file.json]
"""
import json, gzip, os, re, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import guide_games as GG

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."); D = lambda f: os.path.join(ROOT, "src", "data", f)
R = json.load(open(D("team-game-records-2026-27.json")))["teams"]
games = collections.defaultdict(lambda: collections.defaultdict(list))        # team -> date -> [(opp, site H/A/N, source)]
for f in (json.load(open(D("nba-results-history.json"))), json.load(gzip.open(D("nba-results-older.json.gz")))):
    for g in f["games"]:
        if len(g) > 5 and g[5] is not None and g[5] != 2: continue
        d = g[0][:10]; games[g[1]][d].append((g[2], "H", "espn")); games[g[2]][d].append((g[1], "A", "espn"))
LISTS = json.load(gzip.open(D("guide-games-2026-27.json.gz")))["teams"]
for t, gs in LISTS.items():
    for g in gs:
        if not any(x[2] == "espn" for x in games[t][g[0]]): games[t][g[0]].append((g[2], g[3], "guide"))
for t, gs in LISTS.items():                                                   # a team with no list of its own for a year is in its opponents'
    for g in gs:
        if g[2] and not any(x[0] == t for x in games[g[2]][g[0]]): games[g[2]][g[0]].append((t, {"H": "A", "A": "H"}.get(g[3], "N"), "guide"))
season = lambda d: f"{int(d[:4]) - (int(d[5:7]) < 8)}-{(int(d[:4]) - (int(d[5:7]) < 8) + 1) % 100:02d}"
own_years = {t: collections.Counter(season(g[0]) for g in gs) for t, gs in LISTS.items()}      # how many games of a season the team's own list has

OLD = {"FTW": "fort wayne", "STL": "st. louis", "SFW": "san francisco", "ROC": "rochester", "SYR": "syracuse", "UTH": "utah", "CIN": "cincinnati", "MPL": "minneapolis", "BAL": "baltimore", "BLB": "baltimore", "IND": "IND",
       "SDR": "san diego", "SDC": "san diego", "BUF": "buffalo", "TRI": "tri-cities", "CAP": "capital", "KCO": "kansas city-omaha"}
ERA = {"PHI": "philadelphia", "MIL": "milwaukee", "CHI": "chicago", "DEN": "denver", "WAS": "washington", "DET": "detroit", "CLE": "cleveland"}
def defunct(name, y):
    """A club that folded (Indianapolis, the first Baltimore): the games against it are in the lists with no opponent code."""
    n = GG.norm(name); n = GG.ALIAS.get(n, n)
    return any(a <= y <= b and t is None for a, b, t in GG.FRANCHISE.get(n, []))
SEP = re.compile(r"\s+(vs\.?|at|@)\s+|^(vs\.?|at|@)\s*", re.I)
def who(text, own, d):
    """The guide's words for a game -> (opponent code or None, site "H"/"A"/None, names not understood)."""
    s = re.sub(r"\([^)]*\)?", " ", text or "")                               # (OT), (2nd), (BLF), (NBA record ...)
    s = re.sub(r"^.*?\b(?:last|most recent(?:ly)?)\b[:,]?\s*(?:by\s+)?", "", s, flags=re.I)   # "11x; Last: at CHI", "seven times, last Golden State at Chicago"
    s = re.sub(r",?\s*\b(?:[1-4](?:st|nd|rd|th)|\d?\s*OT|[23]OT)\b\.?", " ", s, flags=re.I)
    s = re.sub(r"[*#†]", "", s); s = re.sub(r"\s+", " ", s).strip(" ,;.")
    parts, seps, pos = [], [], 0
    for m in SEP.finditer(s):
        if m.start() > pos or pos == 0 and m.start() == 0: parts.append(s[pos:m.start()].strip(" ,;")); seps.append((m.group(1) or m.group(2)).lower().rstrip("."))
        pos = m.end()
    parts.append(s[pos:].strip(" ,;"))
    if parts and parts[0] == "": parts = parts[1:]; lead = seps[0] if seps else None; seps = seps[1:]
    else: lead = None
    sea = season(d); res = []; y = int(sea[:4])
    for p in parts:
        p2 = re.sub(r",\s*[A-Z]{2}$", "", p).strip()                         # "Hershey, PA"
        p2 = re.sub(r"^(?:by|against|the)\s+", "", p2, flags=re.I)
        if p2.upper() in OLD and (p2.isupper() or p2.upper() in ("UTH",)): p2 = OLD[p2.upper()] if p2.upper() != "IND" else ("indianapolis" if y < 1967 else "IND")
        elif p2.isupper() and p2 in ERA and y < 1993: p2 = ERA[p2]            # a code for a city that was another franchise then (PHI in 1957 is the Warriors)
        code = GG.franchise(p2, sea, "") if p2 else None
        if code is None and p2: code = GG.NICK.get(p2.upper().rstrip("S") + "S") or GG.NICK.get(p2.upper())
        if code is None and " " in p2: code = GG.franchise(p2.rsplit(" ", 1)[0], sea, "") or GG.NICK.get(p2.rsplit(" ", 1)[1].upper())   # "Detroit Pistons"
        if code is None and p2 and defunct(p2, y): code = "(gone)"
        res.append(code)
    opp = next((c for c in res if c and c != own and c != "(gone)"), None) or next((c for c in res if c == "(gone)"), None); unknown = [p for p, c in zip(parts, res) if p and c is None]
    site = None
    if lead in ("at", "@"): site = "A"
    elif lead == "vs" or (len(parts) == 1 and res and res[0] == opp): site = "H" if lead == "vs" else None
    elif len(res) >= 2 and seps:
        first_own = res[0] == own
        if seps[0] in ("at", "@"): site = "A" if first_own else ("H" if res[1] == own else None)
        else: site = "H" if first_own else ("A" if res[1] == own else None)
    if len(parts) >= 2 and seps and seps[-1] in ("at", "@") and len(res) >= 2 and res[-1] is None and (lead or len(parts) >= 3): site = "N"   # "vs. Boston at Providence"
    return opp, site, unknown

rows = []
for t, ms in R.items():
    for m in ms:
        for g in m["games"]:
            if g.get("date"): rows.append({"t": t, "side": m.get("side", "team"), "stat": m["stat"], "kind": m["kind"], "period": m["period"], "value": m["value"], "date": g["date"], "text": g.get("opp") or ""})
out = collections.defaultdict(list)
for r in rows:
    t, d = r["t"], r["date"]; played = games[t].get(d) or []
    opp, site, unknown = who(r["text"], t, d); r["named"] = opp; r["site"] = site
    if not played:
        if d >= "1993-10-01" or own_years.get(t, {}).get(season(d), 0) >= 60: out["no game that day"].append(r)
        else: out["before our games"].append(r)
        continue
    r["played"] = [p[0] for p in played]; r["src"] = played[0][2]
    if opp is None: out["no opponent read from the words" if not r["text"] or unknown or True else ""].append(r); continue
    if opp == "(gone)":
        out["same" if None in r["played"] else "another opponent that day"].append(r); continue
    if opp not in r["played"]: out["another opponent that day"].append(r); continue
    real = next(p[1] for p in played if p[0] == opp)
    out["same"].append(r)
    if site == "A" and real == "H" and re.match(r"^\s*(?:at|@)", r["text"] or "", re.I): out["printed 'at', played at home"].append(r)
# a lead's likely night: a day the team did play the named opponent whose date is one slip from the printed one
def mdy(d): return f"{int(d[5:7])}/{int(d[8:10])}/{d[2:4]}"
def slip(a, b):
    """1 if b is a with one character changed, dropped, added or two swapped (as M/D/YY); else 9."""
    if a == b: return 0
    if len(a) == len(b):
        diff = [i for i in range(len(a)) if a[i] != b[i]]
        if len(diff) == 1: return 1
        if len(diff) == 2 and diff[1] == diff[0] + 1 and a[diff[0]] == b[diff[1]] and a[diff[1]] == b[diff[0]]: return 1
    if abs(len(a) - len(b)) == 1:
        lo, hi = (a, b) if len(a) < len(b) else (b, a)
        if any(hi[:i] + hi[i + 1:] == lo for i in range(len(hi))): return 1
    return 9
import datetime
def near(t, opp, d):
    out2 = []
    for d2, ps in games[t].items():
        if d2 == d or not ps or (opp and opp != "(gone)" and opp not in [p[0] for p in ps]): continue
        days = abs((datetime.date.fromisoformat(d2) - datetime.date.fromisoformat(d)).days) if re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])", d) and not (d[5:] in ("02-30", "02-31")) else 999
        if slip(mdy(d), mdy(d2)) == 1 or days <= 3 or (d2[5:] == d[5:] and abs(int(d2[:4]) - int(d[:4])) <= 10): out2.append(d2)
    return sorted(out2)
# ... and whether the number is there that night, where a saved ESPN page or another guide can say (--boxes, --boards: the folders the two ESPN tools save to)
arg = lambda k: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else None
BOX, BRD = arg("--boxes"), arg("--boards"); AL = {"GS": "GSW", "NO": "NOP", "NY": "NYK", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS", "VAN": "MEM", "SEA": "OKC", "NJ": "BKN", "NOK": "NOP", "NOH": "NOP", "PHO": "PHX", "CHH": "CHA"}
def espn(t, d):
    """(my line, their line, my box, their box) for the team's game that day, from the saved pages; None where there is none."""
    f = BRD and os.path.join(BRD, f"ls-{d}.json")
    if not f or not os.path.exists(f): return None
    for e in json.load(open(f))["events"]:
        c = {x["ha"]: x for x in e["c"]}
        if "home" not in c or "away" not in c or not all(len(x["ls"]) >= 4 for x in e["c"]): continue
        h, a = AL.get(c["home"].get("a"), c["home"].get("a")), AL.get(c["away"].get("a"), c["away"].get("a"))
        if t not in (h, a): continue
        me, you = ("home", "away") if t == h else ("away", "home"); bx = None
        g = BOX and os.path.join(BOX, f"g-{e['id']}.json")
        if g and os.path.exists(g):
            tt = {x.get("ha"): x["st"] for x in json.load(open(g)).get("t", [])}; bx = (tt.get(me), tt.get(you))
        return c[me]["ls"], c[you]["ls"], bx
    return None
def there(r, d2):
    """True / False / None (cannot tell): is the mark's number in ESPN's page for d2, or printed for d2 by the other guide?"""
    for b in rows:                                                           # the other guide
        if b["t"] != r["t"] and b["date"] == d2 and (b["stat"], b["kind"], b["period"]) == (r["stat"], r["kind"], r["period"]) and b["side"] != r["side"] and b["value"] == r["value"]: return "the other guide"
    e = espn(r["t"], d2)
    if not e: return None
    mine, theirs, bx = e; q = mine if r["side"] == "team" else theirs
    if r["stat"] == "pts":
        parts = [sum(q)] if r["period"] == "game" else q[:4] if r["period"] == "quarter" else [q[0] + q[1], q[2] + q[3]] if r["period"] == "half" else q[4:] + [sum(q[4:])]
        return "ESPN's line score" if r["value"] in parts else False
    if r["period"] != "game" or not bx or not bx[0] or not bx[1]: return None
    st = bx[0] if r["side"] == "team" else bx[1]; n = lambda v: None if v in (None, "") else int(float(v)); pr = lambda k, i: n(str(st.get(k, "")).split("-")[i]) if "-" in str(st.get(k, "")) else None
    o, dd = n(st.get("offensiveRebounds")), n(st.get("defensiveRebounds"))
    vals = {"fgm": [pr("fieldGoalsMade-fieldGoalsAttempted", 0)], "fga": [pr("fieldGoalsMade-fieldGoalsAttempted", 1)], "fg3m": [pr("threePointFieldGoalsMade-threePointFieldGoalsAttempted", 0)], "fg3a": [pr("threePointFieldGoalsMade-threePointFieldGoalsAttempted", 1)],
            "ftm": [pr("freeThrowsMade-freeThrowsAttempted", 0)], "fta": [pr("freeThrowsMade-freeThrowsAttempted", 1)], "oreb": [o], "dreb": [dd], "reb": [o + dd if o is not None and dd is not None else None, n(st.get("totalRebounds"))], "ast": [n(st.get("assists"))],
            "stl": [n(st.get("steals"))], "blk": [n(st.get("blocks"))], "tov": [n(st.get("totalTurnovers")), n(st.get("turnovers"))], "pf": [n(st.get("fouls"))]}.get(r["stat"], [])
    return "ESPN's box score" if r["value"] in vals else False
for k in ("another opponent that day", "no game that day"):
    for r in out[k]:
        r["near"] = [(d2, there(r, d2)) for d2 in near(r["t"], r["named"], r["date"])]
        r["here"] = there(r, r["date"]) if r.get("played") else None         # the number on the printed night, against the other opponent
# 3. two guides, one night
key = lambda r: (r["date"], r["stat"], r["kind"], r["period"])
by = collections.defaultdict(list)
for r in rows: by[key(r)].append(r)
mirror_same, mirror_off = 0, []
for k, rs in by.items():
    for a in rs:
        if a["side"] != "team": continue
        for b in rs:
            if b["side"] != "opp" or b["t"] == a["t"]: continue
            pa = [p[0] for p in games[a["t"]].get(k[0], [])]
            if pa and b["t"] not in pa: continue                             # two other games the same night
            if not pa and not (a.get("named") == b["t"] or b.get("named") == a["t"]): continue
            if a["value"] == b["value"]: mirror_same += 1; a["mirror"] = b["mirror"] = True
            else: mirror_off.append((a, b))
hint = lambda r: ("" if not r.get("here") else f" [the number IS in {r['here']} for the printed night: the opponent's name is the slip]") + ("" if not r.get("near") else " -> " + "; ".join(f"{d2}" + (f" ({w} has the number)" if w else " (ESPN does not have the number)" if w is False else "") for d2, w in r["near"][:6]))
say = lambda r: f"{r['t']} {'opp ' if r['side'] == 'opp' else ''}{r['kind']} {r['stat']} in a {r['period']}: {r['value']} \"{r['text']}\" {r['date']}" + (f" (played {', '.join(str(x) for x in r['played'])})" if r.get("played") else "")
n = len(rows); print(f"{n} printed games beside {sum(len(ms) for ms in R.values())} marks")
for k in ("same", "another opponent that day", "no game that day", "no opponent read from the words", "before our games", "printed 'at', played at home"):
    print(f"  {k}: {len(out[k])}")
for k in ("another opponent that day", "no game that day"):
    for r in sorted(out[k], key=lambda r: (r["t"], r["date"])): print(f"    {k.upper()}: {say(r)}{hint(r)}")
print(f"two guides, one night (every stat and period): {mirror_same + len(mirror_off)}; same {mirror_same}; different {len(mirror_off)}")
for a, b in mirror_off: print(f"    DIFFERENT: {say(a)}  /  {say(b)}")
per = [r for r in rows if r["period"] != "game" and r["stat"] != "pts"]
print(f"period marks for stats other than points: {len(per)} printed games; night and opponent agree for {sum(1 for r in per if r in out['same'])}, another guide prints the same number for {sum(1 for r in per if r.get('mirror'))}")
if "--out" in sys.argv: json.dump({k: v for k, v in out.items()}, open(sys.argv[sys.argv.index("--out") + 1], "w"), indent=1)
