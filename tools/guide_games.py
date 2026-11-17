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
import datetime
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
import json as _json, os as _os
_eye = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "guide-games-by-eye.json")
BY_EYE = _json.load(open(_eye))["rows"] if _os.path.exists(_eye) else {}
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
         "minnestoa": "minnesota", "laa lakers": "los angeles", "laa clippers": "la clippers", "llc clippers": "la clippers", "lndiana": "indiana", "lindiana": "indiana", "aatlanta": "atlanta", "utaha": "utah", "gssww": "golden state", "gsw": "golden state", "sac": "sacramento", "was": "washington", "anderson duffey": "anderson", "rockets": "houston", "st louis hawks": "st. louis", "san": "san antonio", "phl": "philadelphia", "brookyln": "brooklyn", "phoenox": "phoenix", "se attle": "seattle", "n orleans okc": "new orleans oklahoma city", "vsutah": "utah", "no okla cit": "new orleans oklahoma city", "no ok city": "new orleans oklahoma city", "atutah": "utah", "atmemphis": "memphis", "phila": "philadelphia", "det": "detroit", "sea": "seattle", "atl": "atlanta", "mil": "milwaukee", "buf": "buffalo", "phi": "philadelphia", "cle": "cleveland", "hou": "houston", "por": "portland", "phx": "phoenix",
         "kansas": "kansas city", "golden": "golden state", "no okla": "new orleans oklahoma city", "new yor": "new york", "philadel": "philadelphia", "charlottee": "charlotte", "minneso": "minnesota", "philadelia": "philadelphia", "clevelad": "cleveland",
         "chiago": "chicago", "oklahaoma city": "oklahoma city", "chicago bulls": "chicago", "new orl": "new orleans", "san ant": "san antonio", "atlanta hawks": "atlanta", "tri city": "tri-cities", "san fran": "san francisco", "balt": "baltimore", "wash": "washington", "charltotte": "charlotte", "miammi": "miami", "detoit": "detroit", "la clipper": "la clippers", "oklahoma cit": "oklahoma city", "nok hornets": "new orleans oklahoma city",
         "sanantonio": "san antonio", "phoneix": "phoenix", "miani": "miami", "neworleans": "new orleans", "newyork": "new york", "tri city": "tri-cities", "tri": "tri-cities", "cinc": "cincinnati", "chiacgo": "chicago", "kc omaha": "kansas city", "miilwaukee": "milwaukee", "newjersey": "new jersey", "no oklacity": "new orleans oklahoma city", "no okl city": "new orleans oklahoma city", "oklahoma": "oklahoma city", "booklyn": "brooklyn"}
FRANCHISE["min"] = [(0, 1959, "LAL"), (1989, 9999, "MIN")]
FRANCHISE["ind"] = [(0, 1952, None), (1976, 9999, "IND")]
FRANCHISE["new orleans oklahoma city"] = [(0, 9999, "NOP")]
FRANCHISE["washington"] = [(0, 1950, None), (1973, 9999, "WAS")]          # the Bucks' guide calls the 1973-74 Capital Bullets Washington

CODES = {"ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"}
OLD_CODES = {"NJN": "BKN", "NJ": "BKN", "SEA": "OKC", "VAN": "MEM", "NOH": "NOP", "NOK": "NOP", "NO": "NOP", "WSB": "WAS", "GS": "GSW", "SA": "SAS", "NY": "NYK", "PHO": "PHX", "UTAH": "UTA", "KCK": "SAC", "SDC": "LAC", "CHH": "CHA", "BRK": "BKN", "WSH": "WAS", "NOR": "NOP"}

def franchise(name, season, own):
    code = name.replace("*", "").strip().upper()
    if code in CODES and code != own and name.strip().isupper(): return code if not (code == "CHA" and 2002 <= y0(season) <= 2003) else None
    if code in OLD_CODES and name.strip().isupper() and OLD_CODES[code] != own: return OLD_CODES[code]
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
    third = re.match(r"^(.+?)\s*(?:\sat\s+|@\s*)(.+)$", s, re.I)
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

# ---- 0.87: more guides. Each reader walks the guide's season pages and hands every game to row(). ----
def _pages(text, head, where=1200):
    """(season, page) for each page whose first `where` characters match `head` (season in group 1, or groups 1 and 2 as "1967"-"1968")."""
    for p in text.split("\f"):
        m = re.search(head, p[:where] if where else p)
        if m: yield m, p

def _mon(x): return MON.get(x[:3].lower())

def read_uta(text, row, full):
    a = re.compile(r"^\s*(?:\d+\s+)?(\d{1,2})/(\d{1,2})/\d{2}\s+(.+?)\s+([WL])\*{0,3}\s+(\d{2,3})\s*[-–]\s*(\d{2,3})", re.M)
    b = re.compile(r"^\s*([A-Z][a-z]{2})\s+(\d{1,2})\s+(.+?)\s+([WL])\s+(\d{2,3})\s*[-–]\s*(\d{2,3})", re.M)
    for p in text.split("\f"):
        h = re.search(r"(?i)(\d{4})-(\d{2,4}) (?:Utah|New Orleans) Jazz \(\d+-\d+", p) or re.search(r"(?i)(\d{4})-(\d{2,4}) (?:Utah|New Orleans) Jazz\b(?! FINAL| PRESEASON| Roster| IN-SEASON)", p)
        if not h: continue
        p = re.split(r"(?i)\n[^\n]*(?:PLAYOFFS|PRESEASON|IN-SEASON TOURNAMENT)\b", p[h.start():])[0]
        for m in a.finditer(p): row(full(h.group(1), h.group(2)), int(m.group(1)), int(m.group(2)), m.group(3), m.group(4), m.group(5), m.group(6), None)
        for m in b.finditer(p):
            if _mon(m.group(1)): row(full(h.group(1), h.group(2)), _mon(m.group(1)), int(m.group(2)), m.group(3), m.group(4), m.group(5), m.group(6), None)

def read_sac(text, row, full):
    rx = re.compile(r"(?<![\d/])\d{1,2}\s+(?:(\d{1,2})/(\d{1,2})|([A-Z][a-z]{2})\s+(\d{1,2}))\s+(\d{2,3})-(\d{2,3})\*{0,5}\s+(?:[+\-–]?\d+\s+)?(?:\dOT\s+)?([A-Za-z@][^\d\n]*?)\s*([WL])\s+(\d+)-(\d+)")
    for h, p in _pages(text, r"(\d{4}-\d{2}) (?:ROCHESTER ROYALS|CINCINNATI ROYALS|KANSAS CITY[- /]OMAHA KINGS|KANSAS CITY KINGS|SACRAMENTO KINGS|GAME-BY-GAME)", 600):
        for line in p.split("\n"):
            for m in rx.finditer(line):
                mo, d = (int(m.group(1)), int(m.group(2))) if m.group(1) else (_mon(m.group(3)), int(m.group(4)))
                if mo: row(h.group(1), mo, d, m.group(7), m.group(8), m.group(5), m.group(6), (m.group(9), m.group(10)))

def read_phi(text, row, full):
    rx = re.compile(r"(\d{1,2})/(\d{1,2})(?:/\d{2})?\s+([WL])\s+(\d{2,3})\s+(\d{2,3})\s+\*{0,5}((?:at |vs\.? )?[A-Z][A-Za-z.]+(?: [A-Z][A-Za-z.]+){0,2})")
    for h, p in _pages(text, r"(\d{4})-(\d{2,4}) (?:SEASON STATISTICS|GAME-BY-GAME RESULTS)", 0):
        for line in p.split("\n"):
            for m in rx.finditer(line): row(full(h.group(1), h.group(2)), int(m.group(1)), int(m.group(2)), m.group(6), m.group(3), m.group(4), m.group(5), None)

NICK = {"HAWKS": "ATL", "CELTICS": "BOS", "NETS": "BKN", "HORNETS": "CHA", "BOBCATS": "CHA", "BULLS": "CHI", "CAVALIERS": "CLE", "MAVERICKS": "DAL", "NUGGETS": "DEN", "PISTONS": "DET", "WARRIORS": "GSW",
        "ROCKETS": "HOU", "PACERS": "IND", "CLIPPERS": "LAC", "LAKERS": "LAL", "GRIZZLIES": "MEM", "HEAT": "MIA", "BUCKS": "MIL", "TIMBERWOLVES": "MIN", "PELICANS": "NOP", "KNICKS": "NYK", "THUNDER": "OKC",
        "MAGIC": "ORL", "76ERS": "PHI", "SIXERS": "PHI", "SUNS": "PHX", "TRAIL BLAZERS": "POR", "BLAZERS": "POR", "KINGS": "SAC", "SPURS": "SAS", "RAPTORS": "TOR", "JAZZ": "UTA", "WIZARDS": "WAS",
        "KNICKERBOCKERS": "NYK", "PHILADELPHIA": "PHI", "SUPERSONICS": "OKC", "SONICS": "OKC", "BULLETS": "WAS", "BRAVES": "LAC", "ROYALS": "SAC"}

def dated(row, y2, m, d, opp, site, letter, pf, pa, name=""):
    """A row from an all-time list against one opponent: the printed date carries the year."""
    y = int(y2); y = y if y > 100 else (1900 + y if y >= 46 else 2000 + y)
    y0_ = y if int(m) >= 9 else y - 1
    row(f"{y0_}-{str(y0_ + 1)[2:]}", int(m), int(d), name or opp, letter, pf, pa, None, {"H": "H", "A": "A", "N": "N", "R": "A"}.get(site), opp)

def read_bos(text, row, full):
    rx = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2})\*{0,3}\s+([HAN])\s+([WL])\s+(\d{2,3})\s+(\d{2,3})")
    opp = None
    for line in text.split("\n"):
        h = re.search(r"CELTICS VS\. (.+?) (GAME-BY-GAME RESULTS|OPPONENT SERIES)", line)
        if h: opp = NICK.get(h.group(1).strip()) if h.group(2).startswith("GAME") else None
        elif re.search(r"PLAYOFF", line): opp = None
        if opp:
            for m in rx.finditer(line): dated(row, m.group(3), m.group(1), m.group(2), opp, m.group(4), m.group(5), m.group(6), m.group(7))

DATE = r"(?:(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?|([A-Z][a-z]{2,8})\.?\s*(\d{1,2}))"
OPP = r"((?:at |vs\.? |@ ?)?[A-Za-z][A-Za-z.'/@ -]*?(?:\s*\([^)]*\))?)"
SC = r"\*{0,3}(\d{2,3})\s*[-–]\s*(\d{2,3})"

def _md(m, i=1):
    """(month, day, year or None) from a DATE match whose first group is group i."""
    if m.group(i): return int(m.group(i)), int(m.group(i + 1)), m.group(i + 2)
    return _mon(m.group(i + 3)), int(m.group(i + 4)), None

def _by_season(text, head, rows, row, full, where=0, start=None, stop=None, lines=True):
    """Season pages: `head` names the season; each rx in `rows` is (regex, order) where order maps names to group numbers."""
    for h, p in _pages(text, head, where):
        if start and start in p: p = p[p.index(start):]
        if stop and re.search(stop, p): p = p[:re.search(stop, p).start()]
        season = full(h.group(1), h.group(2))
        for rx, g in rows:
            for m in rx.finditer(p):
                mo, d, _ = _md(m, g["date"])
                if not mo: continue
                row(season, mo, d, m.group(g["opp"]), m.group(g["wl"]) if g.get("wl") else None, m.group(g["pf"]), m.group(g["pa"]), (m.group(g["rec"]), m.group(g["rec"] + 1)) if g.get("rec") else None)

def read_atl(text, row, full):
    # The day can carry a stray digit ("11/210 at Houston", 1988-89; the user's screenshot of p. 157, 11/17): row() trims it.
    rx = re.compile(DATE.replace(r"(\d{1,2})/(\d{1,2})", r"(\d{1,2})/(\d{1,3})", 1) + r"\*{0,3}\s+(?:\([#*\dA-Z]+\)\s*)*" + OPP + r"\s+([WL])\s+(\d{2,3})\s+(\d{2,3})\*{0,3}\s+(\d+)-(\d+)")
    _by_season(text, r"YEARLY RESULTS: (\d{4})\s*-\s*(\d{2,4})", [(rx, {"date": 1, "opp": 6, "wl": 7, "pf": 8, "pa": 9, "rec": 10})], row, full)

def read_bkn(text, row, full):
    a = re.compile(r"(?m)^\s*" + DATE + r"\s+" + OPP + r"\s+" + SC + r"\*{0,3}(?:\s*\([^)]*\))?\s*([WL])\s+(\d+)-(\d+)")
    b = re.compile(r"(?m)^\s*" + DATE + r"\s+" + OPP + r"\s+([WL])\s+" + SC)
    _by_season(text, r"(?i)(\d{4})-(\d{2,4}) SEASON RESULTS", [(a, {"date": 1, "opp": 6, "pf": 7, "pa": 8, "wl": 9, "rec": 10}), (b, {"date": 1, "opp": 6, "wl": 7, "pf": 8, "pa": 9})], row, full)

def read_chi(text, row, full):
    rx = re.compile(r"(?m)^\s*\d+\s+" + DATE + r"\s+([WL])\s+" + OPP + r"\s+" + SC + r"(?:\s*\([^)]*\))?\*{0,3}\s+(\d+)-(\d+)")
    _by_season(text, r"(\d{4})/(\d{2,4}) CHICAGO BULLS", [(rx, {"date": 1, "wl": 6, "opp": 7, "pf": 8, "pa": 9, "rec": 10})], row, full)

def read_den(text, row, full):
    rx = re.compile(r"(?m)^\s*\d+\s+" + DATE + r"\s+" + OPP + r"\s+([WL])\s+" + SC)
    _by_season(text, r"(\d{4})-(\d{2}) GAME-BY-GAME RESULTS \(\d+-\d+\)", [(rx, {"date": 1, "opp": 6, "wl": 7, "pf": 8, "pa": 9})], row, full)

def read_phx(text, row, full):
    rx = re.compile(DATE + r"\s+" + OPP + r"\s+[\d,]+\s+" + SC + r"[*^]{0,4}(?:\s*\([^)]*\))?\s+(\d+)-\s*(\d+)\s+([WL])\b")      # "130-128^": overtime (p. 178)
    season = None
    for p in text.split("\f"):
        h = re.search(r"(?m)^(?:Review)?\s+(\d{2})-(\d{2})\s*$", p[:1500])
        if h:
            y = int(h.group(1)); y = 1900 + y if y >= 46 else 2000 + y; season = f"{y}-{h.group(2)}"; continue
        if not season or "OPPONENT" not in p[:600]: continue
        for m in rx.finditer(p):
            mo, d, _ = _md(m, 1)
            if mo: row(season, mo, d, m.group(6), m.group(11), m.group(7), m.group(8), (m.group(9), m.group(10)))
        season = None

def read_por(text, row, full):
    rx = re.compile(r"(?m)^\s*\d+\.\s+" + DATE + r"\s*(?:\(\s*\w\s*\)\s*)?" + OPP + r"\s+" + SC + r"\*{0,3}(?:\s*\([^)]*\))?\s+([WL])\s+(\d+)-(\d+)")      # "76.  3/9( n) Houston @ Seattle"
    # The guide jumps from 1995-96 to a page headed 1997-98 whose list is the 1996-97 season (it opens 11/1 at Vancouver and
    # ends 49-33; Basketball Reference's 1996-97 schedule, sent by the user on 11/17, is the same 82 games). 1997-98's own
    # list is not in the guide.
    relabel = lambda a, b=None: "1996-97" if full(a, b) == "1997-98" else full(a, b)
    _by_season(text, r"(?m)^\s*(\d{4})-(\d{2,4})\s*$", [(rx, {"date": 1, "opp": 6, "pf": 7, "pa": 8, "wl": 9, "rec": 10})], row, relabel, where=300)

def read_lac(text, row, full):
    rx = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2})\s+" + OPP + r"\s+([WL])\s+" + SC)
    for h, p in _pages(text, r"\d{4}-\d{2} (?:BUFFALO BRAVES|SAN DIEGO CLIPPERS|LOS ANGELES CLIPPERS|LA CLIPPERS)", 400):
        ms = list(rx.finditer(p))
        # A page holds two seasons side by side. A date ten years out ("4/8/92" on the 1981-82 page) is a misprinted year.
        def start(m): y = int(m.group(3)); y = 1900 + y if y >= 46 else 2000 + y; return y if int(m.group(1)) >= 9 else y - 1
        count = {}
        for m in ms: count[start(m)] = count.get(start(m), 0) + 1
        home = {y for y, n in count.items() if n >= 20}
        for m in ms:
            yy = int(m.group(3))
            if home and start(m) not in home:
                fix = [d for d in (-10, 10) if start(m) + d in home]
                if not fix: continue
                yy = (yy + fix[0]) % 100
            dated(row, yy, m.group(1), m.group(2), None, None, m.group(5), m.group(6), m.group(7), m.group(4))

def _nick(name):
    n = name.strip().upper()
    for k in sorted(NICK, key=len, reverse=True):
        if n.endswith(k): return NICK[k]
    return None

def read_cha(text, row, full, official=None):
    """Season pages carry no season label of their own. They run backwards from the latest season, so each page takes
    the next season back whose final record is the one the page's list ends on (or within three games of it)."""
    rx = re.compile(r"(?m)^\s*\d+\s+" + DATE + r"\s+" + SC + r"\*{0,3}\s+(@?)\s*([A-Z]{2,4})\s+([WL])\d?\s+(\d+)-(\d+)")      # "CLE  L1  12-34": a stray digit (1988-89, game 46)
    seasons = sorted(official or {}); j = 0
    for p in reversed(text.split("\f")):
        ms = list(rx.finditer(p))
        if len(ms) < 40: continue
        last = max(((int(m.group(11)), int(m.group(12))) for m in ms), key=sum)
        k = next((i for i in range(j, len(seasons)) if abs(official[seasons[i]][0] - last[0]) + abs(official[seasons[i]][1] - last[1]) <= 3), None)
        if k is None: continue
        j = k + 1
        for m in ms:
            mo, d, _ = _md(m, 1)
            row(seasons[k], mo, d, m.group(9), m.group(10), m.group(6), m.group(7), (m.group(11), m.group(12)), "A" if m.group(8) else "H")

def read_mia(text, row, full):
    rx = re.compile(r"(?m)^\s*\d+\.\s+" + DATE + r"\s+" + OPP + r"\s+" + SC + r"\*{0,3}(?:\s*\([^)]*\))?\s+([WL])\s+(\d+)-(\d+)")
    _by_season(text, r"(\d{4})-(\d{2}) GAME BY GAME", [(rx, {"date": 1, "opp": 6, "pf": 7, "pa": 8, "wl": 9, "rec": 10})], row, full, where=400)

def read_min(text, row, full):
    rx = re.compile(r"(?<![\d/])\d{1,2}\s+" + DATE + r"\s+" + OPP + r"\s+([WL])\s*" + SC + r"\*{0,3}(?:\s*\([^)]*\))?\s+(\d+)-(\d+)")
    _by_season(text, r"(?m)^\s*(\d{4})-(\d{2,4})\s*\n\s*DAY-BY-DAY", [(rx, {"date": 1, "opp": 6, "wl": 7, "pf": 8, "pa": 9, "rec": 10})], row, full, where=1500)

def read_mem(text, row, full):
    rx = re.compile(r"(?m)^\s*" + DATE + r"\s+" + OPP + r"\s+([WL])\s+(\d{2,3})\s+(\d{2,3})(?:\(\d?ot\))?\s+\d+-\d+\s+\d+-\d+\s+(\d+)-(\d+)")
    season = None
    for p in text.split("\f"):
        ms = list(rx.finditer(p))
        h = re.search(r"(?m)^\s*(\d{4})-(\d{2})\s", p[:1500])
        if len(ms) >= 40 and season:
            for m in ms:
                mo, d, _ = _md(m, 1)
                if mo: row(season, mo, d, m.group(6), m.group(7), m.group(8), m.group(9), (m.group(10), m.group(11)))
            season = None
        elif h: season = f"{h.group(1)}-{h.group(2)}"

def _colmajor(page, rx, gap=14):
    """Matches on a multi-column page in reading order: down each column, then the next column."""
    ms = [(i, m) for i, line in enumerate(page.split("\n")) for m in rx.finditer(line)]
    xs = sorted({m.start() for _, m in ms}); cols = []
    for x in xs:
        if not cols or x - cols[-1][-1] > gap: cols.append([x])
        else: cols[-1].append(x)
    col = {x: k for k, c in enumerate(cols) for x in c}
    return sorted(ms, key=lambda im: (col[im[1].start()], im[0]))

def read_ind(text, row, full):
    rx = re.compile(r"(\*?)\s*(\d{1,2})/(\d{1,2})/(\d{2})\s+([WL])\s+" + SC + r"|(PLAYOFFS)")
    for p in text.split("\f"):
        ls = [l.strip() for l in p.split("\n") if l.strip()]
        if len(ls) < 3 or ls[0] != "OPPONENTS" or "SERIES RESULTS" not in p[:1500]: continue
        opp = _nick(ls[1]); live = True
        for _, m in _colmajor(p, rx):
            if m.group(8): live = False
            elif opp and live: dated(row, m.group(4), m.group(2), m.group(3), opp, "H" if m.group(1) else "A", m.group(5), m.group(6), m.group(7))

def read_dal(text, row, full):
    rx = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2,4})\s+([A-Z]{2,4})\s+([WL])\s+" + SC)
    opp = None
    for line in text.split("\n"):
        h = re.search(r"MAVERICKS VS\. (.+?) OPPONENT SERIES", line)
        if h: opp = NICK.get(h.group(1).strip())
        elif re.search(r"PLAYOFF (?:SERIES|RESULTS|HISTORY)", line): opp = None
        if opp:
            for m in rx.finditer(line): dated(row, m.group(3), m.group(1), m.group(2), opp, "H" if m.group(4) == "DAL" else "A", m.group(5), m.group(6), m.group(7))

def read_det(text, row, full):
    """Detroit lists its games against each opponent since 1996-97 only."""
    rx = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2,4})\s+([A-Z]{2,4})\s+([WL])\s+" + SC)
    opp = None
    for line in text.split("\n"):
        h = re.search(r"PISTONS VS\. (.+?) -- SEASON-BY-SEASON SINCE", line)
        if h: opp = NICK.get(h.group(1).strip())
        elif re.search(r"SERIES INFORMATION|PLAYOFF", line): opp = None
        if opp:
            for m in rx.finditer(line): dated(row, m.group(3), m.group(1), m.group(2), opp, "H" if m.group(4) == "DET" else "A", m.group(5), m.group(6), m.group(7))

def read_orl(text, row, full):
    rx = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2})\s+([A-Z][A-Za-z. ]+?)\s+([WL])\s+" + SC)
    opp = None
    for line in text.split("\n"):
        h = re.search(r"ALL-TIME (PLAYOFF )?SERIES: ORLANDO VS\. (.+)", line)
        if h: opp = None if h.group(1) else _nick(h.group(2))
        if opp:
            for m in rx.finditer(line): dated(row, m.group(3), m.group(1), m.group(2), opp, "H" if m.group(4).strip() == "Orlando" else "A", m.group(5), m.group(6), m.group(7))

def read_cle(text, row, full):
    """Cleveland's results are picture pages (PDF pp. 232-342): read by OCR into tools/cavaliers-results-ocr.json
    (tools/read-cavaliers-results.py), not from the guide's text."""
    f = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "cavaliers-results-ocr.json")
    if not _os.path.exists(f): return
    for season, rows in _json.load(open(f))["seasons"].items():
        for d, raw, won, pf, pa, guess in rows: row(season, int(d[5:7]), int(d[8:10]), raw, "W" if won else "L", pf, pa, None)

READERS = {"CLE": read_cle, "DET": read_det, "CHA": read_cha, "MIA": read_mia, "MIN": read_min, "MEM": read_mem, "IND": read_ind, "DAL": read_dal, "ORL": read_orl, "BOS": read_bos, "ATL": read_atl, "BKN": read_bkn, "CHI": read_chi, "DEN": read_den, "PHX": read_phx, "POR": read_por, "LAC": read_lac, "UTA": read_uta, "SAC": read_sac, "PHI": read_phi}

SCORE_FIRST = {"ATL": True}        # guides that print their own score first, where a letter and score that agree outrank a misprinted running record

def games(tri, text, official=None):
    """Rows are read per season page, then settled: the running record printed beside each game says who won."""
    seasons = {}
    def row(season, month, day, raw, letter, pf, pa, rec, site=None, opp=None):
        while day > 31: day //= 10       # "11/40 (#)", "11/210": a stray digit printed against the day
        try: datetime.date(2000 if month == 2 and day == 29 else 2001, month, day)
        except ValueError: return         # a date that does not exist: the row is not used
        seasons.setdefault(season, []).append({"m": month, "d": day, "raw": raw, "letter": letter, "pf": int(pf), "pa": int(pa), "rec": (int(rec[0]), int(rec[1])) if rec and rec[0] is not None else None, "site": site, "opp": opp})
    full = lambda a, b=None: f"{a}-{str(int(a) + 1)[2:]}"      # "1999-2000", "1999/20" -> "1999-00": the first year names the season
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
    elif tri in READERS:
        READERS[tri](text, row, full, official) if tri == "CHA" else READERS[tri](text, row, full)
    # Rows the text lost but the page shows (read from the user's screenshots; tools/guide-games-by-eye.json).
    for r in BY_EYE.get(tri, []):
        seasons.setdefault(r["season"], []).append({"m": int(r["date"][5:7]), "d": int(r["date"][8:10]), "raw": r["name"], "letter": "W" if r["won"] else "L", "pf": r["pf"], "pa": r["pa"], "rec": tuple(r["rec"]) if r.get("rec") else None, "site": r["site"], "opp": None})
    out = []
    # A season printed twice under two headings (the Bucks' 1970-71 list also sits under 1969-70): the earlier label is dropped.
    sig = {k: tuple((r["m"], r["d"], r["pf"], r["pa"]) for r in v) for k, v in seasons.items()}
    for k in sorted(seasons):
        nxt = f"{int(k[:4]) + 1}-{str(int(k[:4]) + 2)[2:]}"
        if nxt in sig and sig[k] == sig[nxt]: del seasons[k]
    for season, rows in sorted(seasons.items()):
        when = lambda r: ((r["m"] - 8) % 12, r["d"])
        if rows and rows[0]["opp"]:                     # all-time lists against one opponent: a block printed twice is read once
            seen = set(); rows[:] = [r for r in rows if not ((k := (r["m"], r["d"], r["opp"], r["pf"], r["pa"])) in seen or seen.add(k))]
        every = all(x["rec"] for x in rows)
        rows.sort(key=(lambda r: (sum(r["rec"]), when(r))) if every else when)
        prev = (0, 0)
        for r in rows:
            won = r["letter"] == "W" if r["letter"] else r["pf"] > r["pa"]
            agree = r["letter"] and r["pf"] != r["pa"] and (r["pf"] > r["pa"]) == won and SCORE_FIRST.get(tri)     # the letter and an own-score-first score say the same thing
            if r["rec"]:
                if agree: pass
                elif r["rec"] == (prev[0] + 1, prev[1]): won = True
                elif r["rec"] == (prev[0], prev[1] + 1): won = False
                prev = r["rec"]
            else: prev = (prev[0] + won, prev[1] + (not won))
            nm, site = opp_site(r["raw"])
            out.append({"season": season, "date": iso(season, r["m"], r["d"]), "name": nm, "opp": r["opp"] or franchise(nm, season, tri), "site": r["site"] or site, "won": won, "pf": r["pf"], "pa": r["pa"]})
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
        for k in ("overall",) + (({"H": "home", "A": "road", "N": "neutral"}[g["site"]],) if g["site"] in "HAN" else ()):
            x = r[k]; x["w" if g["won"] else "l"] += 1
            x["streak"] = (x["streak"] + 1 if x["streak"] > 0 else 1) if g["won"] else (x["streak"] - 1 if x["streak"] < 0 else -1)
            x["lastW" if g["won"] else "lastL"] = g["date"]
    for r in out.values():
        if r["neutral"]["w"] + r["neutral"]["l"] == 0: del r["neutral"]
    return out
