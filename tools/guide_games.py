#!/usr/bin/env python3
"""
Every regular-season game four team media guides list season by season (0.85): Golden State (from 1962-63, its first
season in San Francisco), the Lakers (from 1948-49), Milwaukee (from 1968-69) and Washington (from 1961-62).

The user, 11/17, pointed to the pages: "starting page 236 of the warriors pdf and then every other page provides
yearly records against teams", "page 136 of lakers pdf", "page 118 starts Bucks yearly schedule", "wizards pdf for
game-by-game schedule results starts page 171".

  games(tri, text) -> [{ season, date, opp (franchise tricode or None for a defunct team), name, site: H|A|N, won, pf, pa }]
  tally(games)     -> { OPP: { overall, home, road, neutral, each { w, l, streak, lastW, lastL } } }

An opponent is printed by its city of that season ("Cincinnati", "St. Louis", "Syracuse"), so the franchise is worked
out from the name and the season (FRANCHISE below). A game at a third site ("Boston at Syracuse", "Detroit (Mad.)")
is neutral.
"""
import re

MON = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}

def y0(season): return int(season[:4])

def iso(season, month, day):
    y = y0(season) + (0 if month >= 8 else 1)
    return f"{y:04d}-{month:02d}-{day:02d}"

# name -> franchise, by the season's first year. A rule is (first, last, tricode); None = a team that no longer exists.
FRANCHISE = {
    "atlanta": [(1968, 9999, "ATL")], "tri-cities": [(0, 9999, "ATL")], "st. louis": [(1955, 1967, "ATL"), (0, 1949, None)],
    "milwaukee": [(1951, 1954, "ATL"), (1968, 9999, "MIL")],
    "boston": [(0, 9999, "BOS")],
    "brooklyn": [(0, 9999, "BKN")], "new jersey": [(0, 9999, "BKN")], "new york nets": [(0, 9999, "BKN")], "ny nets": [(0, 9999, "BKN")], "n.y. nets": [(0, 9999, "BKN")],
    "charlotte": [(0, 9999, "CHA")],
    "chicago": [(0, 1949, None), (1961, 1962, "WAS"), (1966, 9999, "CHI")],
    "cleveland": [(1970, 9999, "CLE"), (0, 1946, None)],
    "dallas": [(0, 9999, "DAL")],
    "denver": [(1949, 1949, None), (1976, 9999, "DEN")],
    "detroit": [(1957, 9999, "DET"), (0, 1946, None)], "fort wayne": [(0, 9999, "DET")], "ft. wayne": [(0, 9999, "DET")],
    "golden state": [(0, 9999, "GSW")], "san francisco": [(0, 9999, "GSW")], "philadelphia": [(0, 1961, "GSW"), (1963, 9999, "PHI")],
    "houston": [(0, 9999, "HOU")], "san diego": [(1967, 1970, "HOU"), (1978, 1983, "LAC")],
    "indiana": [(0, 9999, "IND")], "indianapolis": [(0, 1952, None)],
    "la clippers": [(0, 9999, "LAC")], "l.a. clippers": [(0, 9999, "LAC")], "clippers": [(0, 9999, "LAC")], "los angeles clippers": [(0, 9999, "LAC")], "buffalo": [(0, 9999, "LAC")], "lac": [(0, 9999, "LAC")],
    "los angeles": [(0, 9999, "LAL")], "la lakers": [(0, 9999, "LAL")], "l.a. lakers": [(0, 9999, "LAL")], "los angeles lakers": [(0, 9999, "LAL")], "lakers": [(0, 9999, "LAL")], "la": [(0, 9999, "LAL")],
    "l.a.": [(0, 9999, "LAL")], "minneapolis": [(0, 9999, "LAL")], "lal": [(0, 9999, "LAL")],
    "memphis": [(0, 9999, "MEM")], "vancouver": [(0, 9999, "MEM")],
    "miami": [(0, 9999, "MIA")], "minnesota": [(0, 9999, "MIN")],
    "new orleans": [(1974, 1978, "UTA"), (2002, 9999, "NOP")], "new orleans/oklahoma city": [(0, 9999, "NOP")], "no/oklahoma city": [(0, 9999, "NOP")], "new orleans/okc": [(0, 9999, "NOP")], "no/okc": [(0, 9999, "NOP")],
    "n.o./okla. city": [(0, 9999, "NOP")], "new orleans/okla. city": [(0, 9999, "NOP")],
    "new york": [(0, 9999, "NYK")], "ny": [(0, 9999, "NYK")], "n.y.": [(0, 9999, "NYK")], "new york knicks": [(0, 9999, "NYK")],
    "oklahoma city": [(2005, 2006, "NOP"), (2008, 9999, "OKC")], "okla. city": [(2005, 2006, "NOP"), (2008, 9999, "OKC")], "okc": [(2008, 9999, "OKC")], "seattle": [(0, 9999, "OKC")],
    "orlando": [(0, 9999, "ORL")], "syracuse": [(0, 9999, "PHI")],
    "phoenix": [(0, 9999, "PHX")], "portland": [(0, 9999, "POR")],
    "sacramento": [(0, 9999, "SAC")], "kansas city": [(0, 9999, "SAC")], "kansas city-omaha": [(0, 9999, "SAC")], "kc-omaha": [(0, 9999, "SAC")], "kc": [(0, 9999, "SAC")], "k.c.": [(0, 9999, "SAC")],
    "kansas city/omaha": [(0, 9999, "SAC")], "kc/omaha": [(0, 9999, "SAC")], "k.c.-omaha": [(0, 9999, "SAC")], "cincinnati": [(0, 9999, "SAC")], "cinncinnati": [(0, 9999, "SAC")], "rochester": [(0, 9999, "SAC")],
    "san antonio": [(0, 9999, "SAS")], "toronto": [(1995, 9999, "TOR"), (0, 1946, None)], "utah": [(0, 9999, "UTA")],
    "washington": [(0, 1950, None), (1974, 9999, "WAS")], "baltimore": [(0, 1954, None), (1963, 1972, "WAS")], "capital": [(0, 9999, "WAS")],
    "providence": [(0, 9999, None)], "anderson": [(0, 9999, None)], "sheboygan": [(0, 9999, None)], "waterloo": [(0, 9999, None)], "pittsburgh": [(0, 9999, None)],
}
UNKNOWN = {}

def norm(name):
    n = name.strip().lower().replace(".", "").replace("/", " ").replace("-", " ").replace("’", "").replace("'", "")
    return re.sub(r"\s+", " ", n).strip()

ALIAS = {"philidelphia": "philadelphia", "philadephia": "philadelphia", "phila": "philadelphia", "phil": "philadelphia", "philadelpha": "philadelphia", "milw": "milwaukee", "ny knicks": "new york",
         "kc omaha": "kansas city", "kansas city omaha": "kansas city", "k c omaha": "kansas city", "sf": "san francisco", "gs": "golden state", "golden st": "golden state", "sa": "san antonio",
         "no okla city": "new orleans oklahoma city", "no oklahoma city": "new orleans oklahoma city", "no okc": "new orleans oklahoma city", "new orleans okc": "new orleans oklahoma city",
         "new orleans okla city": "new orleans oklahoma city", "nok": "new orleans oklahoma city", "cinncinnati": "cincinnati", "la clippers": "la clippers", "los angeles clippers": "la clippers", "clippers": "la clippers",
         "l a clippers": "la clippers", "la lakers": "los angeles", "los angeles lakers": "los angeles", "lakers": "los angeles", "l a lakers": "los angeles", "la": "los angeles", "l a": "los angeles", "lal": "los angeles", "lac": "la clippers",
         "ft wayne": "fort wayne", "new york nets": "new jersey", "ny nets": "new jersey", "n y nets": "new jersey", "ny": "new york", "n y": "new york", "new york knicks": "new york", "okla city": "oklahoma city", "okc": "oklahoma city",
         "kc": "kansas city", "k c": "kansas city", "tri cities": "tri-cities", "st louis": "st. louis", "saint louis": "st. louis", "new orleans oklahoma city": "new orleans oklahoma city",
         "laclippers": "la clippers", "lalakers": "los angeles", "cin": "cincinnati", "san fran": "san francisco", "roch": "rochester", "balt": "baltimore", "clevland": "cleveland", "sd": "san diego", "syr": "syracuse",
         "chi": "chicago", "stlouis": "st. louis", "san anotnio": "san antonio", "bos": "boston", "porltand": "portland", "seatle": "seattle", "philadlephia": "philadelphia", "washingoton": "washington",
         "minnestoa": "minnesota", "miilwaukee": "milwaukee", "newjersey": "new jersey", "no oklacity": "new orleans oklahoma city", "no okl city": "new orleans oklahoma city", "oklahoma": "oklahoma city", "booklyn": "brooklyn"}
FRANCHISE["ind"] = [(0, 1952, None), (1976, 9999, "IND")]
FRANCHISE["new orleans oklahoma city"] = [(0, 9999, "NOP")]
FRANCHISE["washington"] = [(0, 1950, None), (1973, 9999, "WAS")]          # the Bucks' guide calls the 1973-74 Capital Bullets Washington

def franchise(name, season, own):
    n = norm(name.replace("*", "")); n = ALIAS.get(n, n)
    n = re.sub(r"^(?:the )", "", n)
    if own == "LAL" and n in ("los angeles", "l.a.", "la") and y0(season) >= 1984: return "LAC"
    for a, b, t in FRANCHISE.get(n, []):
        if a <= y0(season) <= b and t != own: return t
        if a <= y0(season) <= b and t == own: continue
    if n not in FRANCHISE or not any(a <= y0(season) <= b for a, b, _ in FRANCHISE[n]): UNKNOWN[(own, n, season)] = UNKNOWN.get((own, n, season), 0) + 1
    return None

def opp_site(raw):
    """"at Chicago" / "@ Chicago" -> road; "Boston at Syracuse", "Boston (@ Chicago)", "Detroit (Mad.)" -> neutral; else home."""
    s = raw.strip()
    s = re.sub(r"^vs\.?\s+", "", s, flags=re.I)
    road = bool(re.match(r"^(?:at\s+|@\s*)", s, re.I)); s = re.sub(r"^(?:at\s+|@\s*)", "", s, flags=re.I)
    par = re.search(r"\(([^)]*)\)", s); s = re.sub(r"\s*\([^)]*\)", "", s).strip()
    third = re.match(r"^(.+?)\s+(?:at|@)\s+(.+)$", s, re.I)
    if third: return third.group(1).strip(), "N"
    if par and not re.fullmatch(r"\d?\s*OT|OT\d?", par.group(1).strip(), re.I): return s, "N"
    return s, ("A" if road else "H")

def season_pages(text, head):
    """[(season, page text)] for pages whose top matches `head` (a regex with the season as group 1)."""
    out = []
    for p in text.split("\f"):
        m = re.search(head, p)
        if m: out.append((m.group(1), p))
    return out

def games(tri, text):
    """Rows are read per season page, then settled: the running record printed beside each game says who won."""
    seasons = {}
    def row(season, month, day, raw, letter, pf, pa, rec):
        seasons.setdefault(season, []).append({"m": month, "d": day, "raw": raw, "letter": letter, "pf": int(pf), "pa": int(pa), "rec": (int(rec[0]), int(rec[1])) if rec and rec[0] is not None else None})
    full = lambda a, b: f"{a}-{str(int(a) + 1)[2:]}" if len(b) == 4 else f"{a}-{b}"      # "1999-2000" -> "1999-00"
    if tri == "GSW":
        for p in text.split("\f"):
            h = re.search(r"(\d{4})-(\d{2,4}) GAME-BY-GAME RESULTS", p)
            if not h: continue
            for line in p.split("\n"):
                m = re.match(r"^\s*(\d{1,2})/(\d{1,2})\s+\d+\s+(.+?)\s*\.{3,}[ .]*([WL])[\s.]+(\d{2,3})\s*-\s*(\d{2,3})(.*)$", line)
                if not m: continue
                rec = re.search(r"\s(\d+)-(\d+)\s*$", m.group(7))
                row(full(h.group(1), h.group(2)), int(m.group(1)), int(m.group(2)), m.group(3), m.group(4), m.group(5), m.group(6), rec.groups() if rec else None)
    elif tri == "MIL":
        rx = re.compile(r"^\s*\d+\s+(?:(\d{1,2})/(\d{1,2})(?:/\d{2})?|([A-Z][a-z]{2})\.?\s*(\d{1,2}))\s+(.+?)\s+([WL])\s*,?\s*(\d{2,3})\s*-\s*(\d{2,3})(?:\s*\([^)]*\))?\*?[\s\u200b]+(\d+)-(\d+)", re.M)
        for p in text.split("\f"):
            h = re.search(r"(\d{4}-\d{2}) MILWAUKEE BUCKS", p[:400])
            ms = list(rx.finditer(p)) if h else []
            if len(ms) < 20: continue
            for m in ms:
                mo, d = (int(m.group(1)), int(m.group(2))) if m.group(1) else (MON.get(m.group(3).lower()), int(m.group(4)))
                if mo: row(h.group(1), mo, d, m.group(5), m.group(6), m.group(7), m.group(8), (m.group(9), m.group(10)))
    elif tri == "LAL":
        rx = re.compile(r"([A-Z][a-z]{2,8})\.?\s*(\d{1,2})\s+(.+?)\s+([WL])\s+(\d{2,3})\s*-\s*(\d{2,3})(?:\s*\([^)]*\))?(?:\s+(\d+)-(\d+))?")
        for p in text.split("\f"):
            h = re.search(r"(\d{4}-\d{2}) (?:MINNEAPOLIS|LOS ANGELES) LAKERS", p[:900]); i = p.find("GAME-BY-GAME")
            if not h or i < 0: continue
            for line in p[i:].split("\n"):
                for m in rx.finditer(line):
                    if m.group(1)[:3].lower() in MON: row(h.group(1), MON[m.group(1)[:3].lower()], int(m.group(2)), m.group(3), m.group(4), m.group(5), m.group(6), (m.group(7), m.group(8)))
    elif tri == "WAS":
        rx = re.compile(r"([A-Z][a-z]{2,8})\.?\s*(\d{1,2})\s+(.+?)\s+(?:([WL]),\s*)?(\d{2,3})\s*-\s*(\d{2,4})(?:\s*\(?\d?\s*[O0]T\)?)?\**(?:\s+\(?(\d+)-(\d+)\)?)?")
        for p in text.split("\f"):
            h = re.search(r"(\d{4}-\d{2}) (?:CHICAGO PACKERS|CHICAGO ZEPHYRS|BALTIMORE BULLETS|CAPITAL BULLETS|WASHINGTON BULLETS|WASHINGTON WIZARDS)", p[:900]); i = p.find("GAME-BY-GAME RESULTS")
            if not h or i < 0: continue
            for line in p[i:].split("\n"):
                for m in rx.finditer(line):
                    if m.group(1)[:3].lower() in MON: row(h.group(1), MON[m.group(1)[:3].lower()], int(m.group(2)), m.group(3), m.group(4), m.group(5), m.group(6), (m.group(7), m.group(8)))
    out = []
    # A season printed twice under two headings (the Bucks' 1970-71 list also sits under 1969-70): the earlier label is dropped.
    sig = {k: tuple((r["m"], r["d"], r["pf"], r["pa"]) for r in v) for k, v in seasons.items()}
    for k in sorted(seasons):
        nxt = f"{int(k[:4]) + 1}-{str(int(k[:4]) + 2)[2:]}"
        if nxt in sig and sig[k] == sig[nxt]: del seasons[k]
    for season, rows in sorted(seasons.items()):
        when = lambda r: ((r["m"] - 8) % 12, r["d"])
        every = all(x["rec"] for x in rows)
        rows.sort(key=(lambda r: (sum(r["rec"]), when(r))) if every else when)
        prev = (0, 0)
        for r in rows:
            won = r["letter"] == "W" if r["letter"] else r["pf"] > r["pa"]
            if r["rec"]:
                if r["rec"] == (prev[0] + 1, prev[1]): won = True
                elif r["rec"] == (prev[0], prev[1] + 1): won = False
                prev = r["rec"]
            else: prev = (prev[0] + won, prev[1] + (not won))
            nm, site = opp_site(r["raw"])
            out.append({"season": season, "date": iso(season, r["m"], r["d"]), "name": nm, "opp": franchise(nm, season, tri), "site": site, "won": won, "pf": r["pf"], "pa": r["pa"]})
    return out

def fill(tri, gs, history, first="2016-17"):
    """Seasons the guide's lists leave out, from our own results where we have them (2016-17 on): [added seasons]."""
    have = {g["season"] for g in gs}; cols = history["columns"]; added = []
    for row in history["games"]:
        g = dict(zip(cols, row)); d = g["date"][:10]; y = int(d[:4]) - (0 if int(d[5:7]) >= 8 and not ("2020-07-01" <= d <= "2020-10-31") else 1)
        season = f"{y}-{str(y + 1)[2:]}"
        if g["type"] != 2 or season < first or season in have or tri not in (g["home"], g["away"]) or d in ("2023-12-09", "2024-12-17", "2025-12-16"): continue
        home = g["home"] == tri; pf, pa = (g["homeScore"], g["awayScore"]) if home else (g["awayScore"], g["homeScore"])
        gs.append({"season": season, "date": d, "name": g["away"] if home else g["home"], "opp": g["away"] if home else g["home"], "site": "H" if home else "A", "won": pf > pa, "pf": pf, "pa": pa, "from": "results"})
        if season not in added: added.append(season)
    return added

def repair(tri, gs, history, official, first="2016-17"):
    """A season since 2016-17 whose list does not add up to the franchise's record is replaced with our own results: [seasons]."""
    by = {}
    for g in gs:
        x = by.setdefault(g["season"], [0, 0]); x[0 if g["won"] else 1] += 1
    wrong = [s for s, (w, l) in official.items() if s >= first and s in by and tuple(by[s]) != (w, l)]
    gs[:] = [g for g in gs if g["season"] not in wrong]
    fill(tri, gs, history, first)
    return wrong

def tally(gs):
    out = {}
    for g in sorted(gs, key=lambda g: g["date"]):
        if not g["opp"]: continue
        r = out.setdefault(g["opp"], {k: {"w": 0, "l": 0, "streak": 0} for k in ("overall", "home", "road", "neutral")})
        for k in ("overall", {"H": "home", "A": "road", "N": "neutral"}[g["site"]]):
            x = r[k]; x["w" if g["won"] else "l"] += 1
            x["streak"] = (x["streak"] + 1 if x["streak"] > 0 else 1) if g["won"] else (x["streak"] - 1 if x["streak"] < 0 else -1)
            x["lastW" if g["won"] else "lastL"] = g["date"]
    for r in out.values():
        if r["neutral"]["w"] + r["neutral"]["l"] == 0: del r["neutral"]
    return out
