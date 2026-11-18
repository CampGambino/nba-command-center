"""
Team single-game records as the guides print them -> src/data/team-game-records-2026-27.json (0.92).

  python3 tools/parse-team-records.py <folder of guide text> src/data/team-game-records-2026-27.json

The first pass over all 30 guides (11/17/26) found these pages are text, not pictures, but each guide lays them out
its own way. claude/team-guide-inventory.md lists where each guide's pages are.

A mark: { stat, kind: "most"|"fewest", period: "game"|"half"|"quarter"|"ot", value, games: [{ opp, date }], side: "opp" when
it is the most or fewest by an opponent, doubt: [values] when the guide prints the same game with two values }. Only whole
numbers of the stats this season's box scores carry are kept.

0.93: 19 guides are read. PHI has its own reader; the rest share one scanner (scan) and differ in a few facts each.
0.95: 25. Utah (points only, p. 116), Toronto (points only, p. 275), Indiana, New York, Washington and Miami have readers
of their own; all six are text (I had four of them down as "not found": I had searched for one layout's wording).
A mark the guide gives with no game ("Done 2 times") is kept with times and no games.
Not read: ATL (three columns run together), DEN (DEN / OPP rows), MEM (three stats across each row), SAC; CLE is pictures.
0.97: ATL, DEN, MEM and SAC read (29 guides).
0.98: CLE read: its records pages are text (pp. 174-175), not pictures as noted before. All 30.
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

# ---- Guides that print "Game / Half / Quarter, value, opponent, date" rows under a heading per stat (0.93) ----
# One scanner, a few facts per guide: which pages, whether the page is two columns, which lines say that what follows is
# the team's highs, its lows, or an opponent's, and whether the row label sits on the row, above it or below it.

HEAD = {"points": "pts", "fg made": "fgm", "fg": "fgm", "fg att": "fga", "3 fg made": "fg3m", "3 fg": "fg3m", "3 made": "fg3m", "3 fg att": "fg3a", "3 att": "fg3a", "ft made": "ftm", "ft": "ftm", "ft att": "fta",
        "rebounds": "reb", "offensive rebounds": "oreb", "defensive rebounds": "dreb", "assists": "ast", "steals": "stl", "blocks": "blk", "turnovers": "tov", "fouls": "pf"}
LABEL = re.compile(r"^(Thru \d Quarters|(?:Overtime |Regulation |Overall |One |Fewest )?Game(?: \((?:\d?OT|reg)\))?|(?:1st |2nd |First |Second |One |Fewest )?Half(?: \((?:1st|2nd)\))?"
                   r"|(?:1st |2nd |3rd |4th |First |Second |Third |Fourth |One |Fewest )?(?:Quarter|Qtr\.)(?: \((?:1st|2nd|3rd|4th)\))?|(?:1st |2nd |3rd |4th )?Overtime|OT|Low|Season(?: \(\d+ games\))?|\[\d+ GP\]|Career|Consecutive|Per Game)"
                   r"(?![A-Za-z])\s*[:—]?\s*", re.I)
VALUE = re.compile(r"^(\d{1,3})[*#^‡]*(?:\s+|$)")
DATED = re.compile(r"(?<![\d/])(\d{1,2}/\d{1,2}/\d{2,4}|\d{1,2}-[A-Z][a-z]{2}-\d{2,4})(?![\d/])")
LBL_AT = re.compile(r"(?<=\s{3})(?:Game|Half|Quarter|Season|Career|Overtime|1st|2nd|3rd|4th|First|Second|Third|Fourth)\b")
MONTH = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}

MISPRINT = {"10-Feb-256": "10-Feb-25"}     # New Orleans, most threes attempted by an opponent in a half, "at OKC (2nd)": the Pelicans were in Oklahoma City on 2/10/25 (ESPN: 55 attempts in the game)
def iso2(s):
    s = MISPRINT.get(s, s)
    m = re.match(r"(\d{1,2})-([A-Z][a-z]{2})-(\d{2,4})$", s)
    if not m: return iso(s)
    y = int(m.group(3)); y = y if y > 100 else (1900 + y if y >= 46 else 2000 + y)
    return f"{y}-{MONTH[m.group(2)]:02d}-{int(m.group(1)):02d}"

def columns(page, anchor=LBL_AT, min_x=25):
    """A two-column page as two streams of lines (left, then right). The right column starts where its row labels line up."""
    lines = [l.replace("\t", " ").rstrip() for l in page.split("\n")]
    for rx, lo in (anchor if isinstance(anchor, list) else [(anchor, min_x)]):      # a list: the first anchor that finds a column wins
        at = {}
        for l in lines:
            for m in rx.finditer(l):
                if m.start() > lo: at[m.start()] = at.get(m.start(), 0) + 1
        if at and max(at.values()) >= 4: return split_at(lines, max(at, key=lambda k: (at[k], -k)))
    return [lines]

def split_at(lines, x):
    left, right = [], []
    for l in lines:
        if len(l) <= x: left.append(l); continue
        cut = x
        if l[x - 1] != " ":                      # text runs across the boundary: cut at the nearest gap to its left, else it is all left-column text
            g = [m.end() for m in re.finditer(r"\s{2,}", l[:x]) if m.end() >= x - 8]
            cut = g[-1] if g else (x if l[:x].strip() == "" else None)
            if cut is None: left.append(l); continue
        left.append(l[:cut].rstrip()); right.append(l[cut:])
    return [left, right]

def period_of(label):
    w = label.lower()
    return None if re.match(r"season|career|consecutive|thru|per game|\[", w) else "game" if "game" in w or w == "low" else "half" if "half" in w else "quarter" if "quarter" in w or "qtr" in w else "ot"

def norm_head(line):
    t = re.sub(r"\([^)]*\)", "", line).lower().replace(".", "").strip(" :")
    m = re.match(r"^(most|fewest)\s+(.*)$", t); t = m.group(2) if m else t
    t = re.sub(r"\b(?:three[- ]point(?:ers?)?|3[- ]?(?:point(?:ers?)?|pt))\b", "3", t)
    t = re.sub(r"\bfield goals?\b", "fg", t); t = re.sub(r"\bfree throws?\b", "ft", t); t = re.sub(r"\b(?:attempted|attempts)\b", "att", t)
    t = re.sub(r"\b(?:scored|total|team)\b", "", t).replace("blocked shots", "blocks").replace("personal fouls", "fouls")
    return (m.group(1) if m else None), re.sub(r"\s+", " ", t).strip()

def scan(streams, state, marker, heading_like, out, prep=None, on_stream=None):
    """state: side ("team"|"opp"|None), kind, stat, period, value, and the guide's flags. Rows are appended to out."""
    for si, lines in enumerate(streams):
        if on_stream: on_stream(si, state)
        lines = [re.sub(r"(?:\s*\.){3,}", "  ", l).strip() for l in lines]
        if prep: lines = prep(lines)
        lines = [l for l in lines if l]
        for i, l in enumerate(lines):
            mk = marker(l, state)
            if mk is not None:
                l = mk
                if not l: continue
            lab = LABEL.match(l); rest = l[lab.end():] if lab else l; low = bool(lab) and (lab.group(1).lower() == "low" or lab.group(1).lower().startswith("fewest "))
            if lab and not rest:                           # a label alone: for the value line printed just above it (Dallas) or below it (Chicago)
                if not state.get("label_after"): state["period"] = period_of(lab.group(1)); state["value"] = None
                continue
            if lab and not low: state["period"] = period_of(lab.group(1)); state["value"] = None
            elif not lab and not VALUE.match(l) and not DATED.search(l):
                kind, name = norm_head(l)
                if name in HEAD and not re.search(r"\d{2,}", re.sub(r"\([^)]*\)", "", l)):
                    state["stat"] = HEAD[name]; state["period"] = state["value"] = None
                    if kind: state["kind"] = kind
                    elif state.get("default_kind"): state["kind"] = state["default_kind"]
                    elif state.get("kind_per_stat"): state["kind"] = None
                elif heading_like(l): state["stat"] = state["period"] = state["value"] = None
                continue
            v = VALUE.match(rest)
            if low:                                        # Oklahoma City's "Low" row and Golden State's "Fewest Game" row under a stat: the fewest
                d = DATED.search(rest[v.end():]) if v else None
                if v and d and state["side"] and state["stat"]:
                    out.append({"side": state["side"], "stat": state["stat"], "kind": "fewest", "period": period_of(lab.group(1)), "value": int(v.group(1)), "opp": rest[v.end():][:d.start()].strip(" ,;"), "date": iso2(d.group(1))})
                    state["low"] = (i, period_of(lab.group(1)), int(v.group(1)))        # 0.100: the rows under it with the same number are ties (Golden State's three 8-assist games)
                state["period"] = state["value"] = None
                continue
            lw = state.get("low")
            if lw and not lab and v and int(v.group(1)) == lw[2] and i == lw[0] + 1 and state["side"] and state["stat"]:
                d = DATED.search(rest[v.end():])
                if d:
                    out.append({"side": state["side"], "stat": state["stat"], "kind": "fewest", "period": lw[1], "value": lw[2], "opp": rest[v.end():][:d.start()].strip(" ,;"), "date": iso2(d.group(1))})
                    state["low"] = (i, lw[1], lw[2]); continue
            state["low"] = None
            if v:
                state["value"] = int(v.group(1)); rest = rest[v.end():]
                if not lab and state.get("label_after") and i + 1 < len(lines) and LABEL.fullmatch(lines[i + 1]): state["period"] = period_of(lines[i + 1])
            elif lab: state["value"] = None; continue      # "Game 1.000 ...": a percentage or a total, not a count
            d = DATED.search(rest)
            if d and not v and not lab and re.search(r"(?:^|\s{2,})[+\-]?\d{1,3}[*#]?\s{2,}\S", rest[:d.start()]):
                state["value"] = None; continue             # 0.99: "West Coast  162  Golden State at Denver", "Most, 0 Missed  28  LAL": a row of its own, not a tie
            if not d or state["value"] is None or not (state["side"] and state["kind"] and state["stat"] and state["period"]): continue
            out.append({"side": state["side"], "stat": state["stat"], "kind": state["kind"], "period": state["period"], "value": state["value"],
                        "opp": re.sub(r"^(?:\(\d+\)\s*)?(?:(?:Several|\w+|\d+x?) times[.,;:]?\s*)?(?:(?:Most recent(?:ly)?|last|MR)[:,]?\s*)?", "", rest[:d.start()].strip(" ,;("), flags=re.I).strip(" ,;"), "date": iso2(d.group(1))})

UPPER = lambda l: l == l.upper() and re.search(r"[A-Z]{3}", l) is not None
TITLE = lambda l: re.match(r"^(Most|Fewest|Highest|Lowest|Largest|Biggest|Smallest|Best|Worst|Consecutive|Longest)\b", l) is not None
NODIGIT = lambda l: not re.search(r"\d", l)
FLAGS = ("label_after", "default_kind", "kind_per_stat")

def by_page_title(titles, heading_like=UPPER, top=700, first=1, last=10 ** 6, **kw):
    """Guides where a whole page is one section, named in its title (Lakers, Timberwolves, Rockets, Warriors, Thunder)."""
    def read(pages):
        out = []
        for p in pages[first - 1:last]:
            hit = next((v for k, v in titles if re.search(k, p[:top])), None)
            if not hit: continue
            state = dict({"side": hit[0], "kind": hit[1], "stat": None, "period": None, "value": None}, **{k: v for k, v in kw.items() if k in FLAGS})
            scan(columns(p), state, lambda l, s: None, heading_like, out, prep=kw.get("prep"))
        return out
    return read

def wrap_prep(lines):
    """Phoenix wraps a long name onto the next line of its column ("Game 159 Philadelphia at   2/15/70" / "Philadelphia"):
    the name is put back before the date, so the row names its opponent (0.106; 21 rows read "Philadelphia at", "at" or nothing)."""
    out = []; i = 0
    while i < len(lines):
        l = lines[i]; d = DATED.search(l)
        if d and i + 1 < len(lines):
            before = l[:d.start()].rstrip(); nxt = lines[i + 1]
            cut = re.search(r"(?:^|\s)(?:at|vs\.?|last,?)$", before) or re.fullmatch(r"(?:[A-Za-z]+\s+)?\d{1,3}[*#^‡]*", before)
            # the name, alone on its line or ahead of the other column's text where the two were not split apart
            nm = None if LABEL.match(nxt) or VALUE.match(nxt) else re.match(r"((?:(?:vs\.?|at)\s+)?[A-Z][A-Za-z.'/]*(?: [A-Za-z.'/]+){0,4}(?:\s?\((?:1st|2nd|3rd|4th|\d?OT)\))?)(?:\s{3,}(\S.*))?$", nxt)
            if cut and nm and not DATED.search(nm.group(1)):
                l = before + " " + nm.group(1) + "   " + l[d.start():]
                if nm.group(2): lines = lines[:i + 1] + [nm.group(2)] + lines[i + 2:]
                else: i += 1
        out.append(l); i += 1
    return out

def by_marker(first, last, marks, heading_like=UPPER, two_columns=True, anchor=LBL_AT, min_x=25, prep=None, bands=False, **kw):
    """Guides where a line in the text says what follows. marks: [(regex, side, kind)], where side is "team", "opp", "off"
    (not a team section) or "same", and kind is "most", "fewest", "none" or "same". The state carries down each column and on
    to the next page. Flags: kind_per_stat (each stat heading is followed by its own HIGHS / LOWS line), label_after (the row
    label is printed under its row), default_kind (a heading without Most / Fewest means this)."""
    def marker(l, s):
        for rx, side, kind in marks:
            m = re.match(rx, l, re.I)
            if not m: continue
            if side != "same": s["side"] = None if side == "off" else side; s["stat"] = None
            if kind != "same": s["kind"] = None if kind == "none" else kind
            s["period"] = s["value"] = None
            return l[m.end():].strip()
        return None
    def read(pages):
        out = []; state = dict({"side": None, "kind": None, "stat": None, "period": None, "value": None}, **{k: v for k, v in kw.items() if k in FLAGS})
        for p in pages[first - 1:last]:
            if not bands: scan(columns(p, anchor, min_x) if two_columns else [[x.replace("\t", " ") for x in p.split("\n")]], state, marker, heading_like, out, prep=prep); continue
            # A page in bands (Charlotte): a section line alone on its row runs across both columns, so what is under it, in
            # either column, belongs to it.
            cur = []; parts = [cur]
            for l in p.split("\n"):
                st = l.strip()
                if st and any((m := re.match(rx, st, re.I)) and m.end() == len(st) for rx, _, _ in marks): cur = [l]; parts.append(cur)
                else: cur.append(l)
            for part in parts: scan(columns("\n".join(part), anchor, min_x), state, marker, heading_like, out, prep=prep)
        return out
    return read

def orl_prep(lines):
    """Orlando: "Game — 62   @ Charlotte (1-26-94); vs. Denver (12-30-90)" -> one row a game, dates as 1/26/94."""
    out = []
    for l in lines:
        l = re.sub(r"\((\d{1,2})-(\d{1,2})-(\d{2})\)", r" \1/\2/\3", l.replace("—", " "))
        out += [x.strip() for x in l.split(";")]
    return out

def por_prep(lines):
    """Portland: "Field Goals" then "Made" / "Attempted", "Rebounds" then "Offensive" / "Defensive" / "Total", each on its own
    line, and often no "Game" line under them."""
    out = []; main = None
    for i, l in enumerate(lines):
        if re.fullmatch(r"(?:3-Point |Three-Point )?Field Goals|Free Throws|Rebounds", l): main = l; out.append(l); continue
        if main and l in ("Made", "Attempted", "Offensive", "Defensive", "Total"):
            out.append(f"{l} Rebounds" if main == "Rebounds" and l != "Total" else "Rebounds" if main == "Rebounds" else f"{main} {l}")
            nxt = next((x for x in lines[i + 1:] if x), "")
            if not LABEL.match(nxt): out.append("Game")
            continue
        if l and not re.search(r"\d", l) and not LABEL.match(l): main = None
        out.append(l)
    return out

def read_det(pages):
    """Detroit: each row carries the team mark and then an individual one. The row is cut where the individual columns begin."""
    out = []; state = {"side": None, "kind": None, "stat": None, "period": None, "value": None}
    for p in pages[86:93]:
        lines = [l.replace("\t", " ") for l in p.split("\n")]; x = None; kept = []
        for l in lines:
            if "Pistons Opponent Single-Game Records" in l: state.update(side="opp", stat=None)
            elif "Pistons Single Game Records" in l: state.update(side="team", stat=None)
            elif "Home Arena" in l or "Little Caesars" in l: state.update(side=None, stat=None)
            h = re.search(r"\bInd\.\s+Name\b", l)
            if h: x = h.start(); continue
            kept.append(l[:x - 1] if x and len(l) > x else l)
        scan([kept], state, lambda l, s: None, TITLE, out)
    return out

def read_mil(pages):
    """Milwaukee: one page, the Bucks' marks on the left and opponents' on the right; rows are "Most", "Fewest", "Most, Half"."""
    out = []
    def marker(l, s):
        m = re.match(r"^(Most|Fewest)(?:, (Half|Quarter))?\s+(?=\d)", l)
        if m: s["kind"] = m.group(1).lower(); return f"{m.group(2) or 'Game'} {l[m.end():]}"
        if re.match(r"^(Highest|Lowest|Best|Worst|Most, 0|Most DQs)\b", l): s["period"] = s["value"] = None; return ""
        return None
    for p in pages:
        if not re.search(r"^\s*TEAM RECORDS\s*\n\s*BUCKS\s+OPPONENTS", p): continue
        state = {"side": None, "kind": None, "stat": None, "period": None, "value": None}
        p = re.sub(r"\b(\d\d)/(\d\d)(\d\d)\b", r"\1/\2/\3", p)          # "04/0924": a slash is missing (4/9/24, as on the rows around it)
        scan(columns(p, re.compile(r"(?<=\s{3})(?:Most|Fewest)\b")), state, marker, UPPER, out, on_stream=lambda i, s: s.update(side="team" if i == 0 else "opp", stat=None, period=None, value=None))
    return out

def read_bos(pages):
    """Boston: p. 197 is the Celtics' highs with Game / Half / Quarter rows; pp. 198-200 list each stat with a "Boston" line
    and an "Opponent" line above the values, and no Game label (they are all single games)."""
    out = []; state = {"side": None, "kind": None, "stat": None, "period": None, "value": None, "sub": False}
    def marker(l, s):
        if l == "CELTICS TEAM HIGHS": s.update(side="team", kind="most", stat=None, sub=False); return ""
        if l in ("MOST/HIGHEST TEAM PERFORMANCES", "FEWEST/LOWEST TEAM PERFORMANCES"): s.update(side=None, stat=None, sub=True); return ""
        if s["sub"] and l in ("Boston", "Opponent"): s.update(side="team" if l == "Boston" else "opp", period="game" if s["stat"] else None, value=None); return ""
        if s["sub"] and re.match(r"^(MOST|FEWEST|HIGHEST|LOWEST)\b", l): s["side"] = None
        return None
    anchor = re.compile(r"(?<=\s{3})(?:Boston|Opponent|Game|Half|Quarter|Season|MOST|FEWEST|HIGHEST|LOWEST)\b")
    for p in pages[196:200]: scan(columns(p, anchor, 40), state, marker, UPPER, out)
    return out

# ---- 0.95: six more guides, each laid out its own way (Utah, Toronto, Indiana, New York, Washington, Miami) ----
LONGD = re.compile(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+(\d{1,2}),\s*(\d{4})\b")
longdate = lambda l: LONGD.sub(lambda m: f"{MONTH[m.group(1)]}/{int(m.group(2))}/{m.group(3)}", l)
undot = lambda l: re.sub(r"(?:\s*\.){3,}\s*", "   ", l)
ANY = re.compile(r"(?<=\s{3})\S")
NUMROW = re.compile(r"^(\d{1,3})\s{2,}(.+?)\s+(\d{1,2}/\d{1,2}/\d{2,4})(?!\d)")
TIEROW = re.compile(r"^((?:vs\.?|at|@)\s.+?)\s+(\d{1,2}/\d{1,2}/\d{2,4})(?!\d)")
row = lambda st, v, opp, d: {"side": st["side"], "stat": st["stat"], "kind": st["kind"], "period": st["period"], "value": v, "opp": re.sub(r"\s*\((?:1st|2nd|3rd|4th)[^)]*\)|\s*\(\d?OT\)", "", opp).strip(" ,;"), "date": iso(d)}

def stat_of(head):
    """A heading as (stat, period): "POINTS IN A QUARTER", "1st Half Points", "3-Pt. Field Goals Att.", "Assists, Game"."""
    t = head.lower().replace("defense rebounds", "defensive rebounds").replace("att.", "att")
    period = "quarter" if re.search(r"\bquarter\b", t) else "half" if re.search(r"\bhalf\b", t) else "ot" if re.search(r"\bovertime\b", t) else "game"
    if re.search(r"\b(?:double|triple|quadruple) overtime\b|without a miss|consecutive|%|pct|percentage", t): return None, None
    t = re.sub(r"\b(?:in an?|1st|2nd|3rd|4th|quarter|half|overtime|game)\b|,", " ", t)
    return HEAD.get(norm_head(t)[1]), period

def read_uta(pages):
    """Utah: p. 116, four lists of games (the Jazz's most and fewest points, and the most and fewest they allowed)."""
    SEC = {"MOST JAZZ POINTS SCORED": ("team", "most"), "FEWEST JAZZ POINTS SCORED": ("team", "fewest"), "MOST JAZZ POINTS ALLOWED": ("opp", "most"), "FEWEST JAZZ POINTS ALLOWED": ("opp", "fewest")}
    out = []; sec = None
    for p in pages:
        if "JAZZ POINTS SCORED/ALLOWED" not in p[:300]: continue
        for l in p.split("\n"):
            t = l.strip()
            if t in SEC: sec = SEC[t]; continue
            m = re.match(r"^(\d{2,3})\s+(.+?)\s+(\d{1,2}/\d{1,2}/\d{2,4})\s", t)
            if sec and m: out.append({"side": sec[0], "stat": "pts", "kind": sec[1], "period": "game", "value": int(m.group(1)), "opp": m.group(2).strip(), "date": iso(m.group(3))})
    return out

def read_tor(pages):
    """Toronto: p. 275, "TOP SINGLE GAME PERFORMANCES (TEAM)": Toronto's lists on the left, opponents' on the right, points only."""
    out = []
    for p in pages:
        if not re.search(r"TOP SINGLE GAME\s+PERFORMANCES \(TEAM\)", p[:400]): continue
        kind = {"team": None, "opp": None}
        for l in p.split("\n"):
            l = l.replace("\t", " ")
            for m in re.finditer(r"(MOST POINTS|FEWEST POINTS|HIGHEST|LOWEST|MOST|FEWEST)[A-Z0-9 %\-]*", l):
                kind["team" if m.start() < 60 else "opp"] = {"MOST POINTS": "most", "FEWEST POINTS": "fewest"}.get(m.group(1))
            for m in re.finditer(r"(?<![.\d])(\d{2,3})\.{3,}\s*(?:\dX\s*[-–]\s*last:\s*)?((?:at|vs\.)\s[^.]+?)\.{2,}\s*([A-Z][a-z]+ \d{1,2}, \d{4})", l):
                side = "team" if m.start() < 80 else "opp"
                if kind[side]: out.append({"side": side, "stat": "pts", "kind": kind[side], "period": "game", "value": int(m.group(1)), "opp": m.group(2).strip(), "date": iso(longdate(m.group(3)))})
    return out

def read_ind(pages):
    """Indiana: pp. 187-190, "SINGLE GAME TEAM RECORDS": under each stat, "Pacers High: 65" and the games under it, then
    Low, Opponents High and Low. The "(Home)" and "(at Indiana)" rows repeat a part of the same marks and are left out."""
    out = []; st = {"side": None, "kind": None, "stat": None, "period": "game", "value": None}
    for p in pages:
        if "SINGLE GAME TEAM RECORDS" not in p[:500]: continue
        for stream in columns(p, ANY, 150):
            for l in stream:
                t = undot(l).strip()
                if not t: continue
                m = re.match(r"^(Pacers|Opponents) (High|Low)( \([^)]*\))?:\s*(\d{1,3})?$", t)
                if m:
                    ok = not m.group(3) and m.group(4) is not None
                    st.update(side=("team" if m.group(1) == "Pacers" else "opp") if ok else None, kind="most" if m.group(2) == "High" else "fewest", value=int(m.group(4)) if ok else None); continue
                g = re.match(r"^(?:(vs\.|at)\s+)?(.+?)\s+(\d{1,2}/\d{1,2}/\d{2,4})$", t)
                if g and st["side"] and st["stat"] and st["value"] is not None: out.append(row(st, st["value"], " ".join(x for x in (g.group(1), g.group(2)) if x), g.group(3))); continue
                if UPPER(t) and not g: st.update(stat=stat_of(t)[0], side=None, value=None)
    return out

def read_nyk(pages):
    """New York: p. 108, "Team Highs & Lows": one row a stat with its high and its low, the Knicks' and then opponents'.
    (p. 109 is the same for the present Garden only.) A mark "Done 2 times" has a value and no game."""
    out = []
    for p in pages:
        if not re.search(r"Team Highs & Lows\s*\n", p[:600]) or "At Present MSG" in p[:600]: continue
        side = None
        for l in p.split("\n"):
            t = re.sub(r"\*+", "", longdate(l.replace("\t", " "))).strip()
            if t == "Knickerbockers": side = "team"; continue
            if t == "Opponents": side = "opp"; continue
            m = re.match(r"^([A-Z0-9][A-Za-z0-9.\- ,]*?)\s{2,}(\d{1,3})\s+(.*)$", t)
            if not m or not side: continue
            stat, period = stat_of(m.group(1))
            if not stat: continue
            ONE = r"((?:at|vs\.)\s.+?)\s+(\d{1,2}/\d{1,2}/\d{4})|(Done (?:many|twice|\w+ times))"
            hi = re.match(ONE, m.group(3)); rest = m.group(3)[hi.end():] if hi else ""
            lo = re.match(r"\s+(\d{1,3})\s+(?:" + ONE + ")", rest) if hi else None
            for kind, v, g in (("most", m.group(2), hi), ("fewest", lo.group(1) if lo else None, lo)):
                if not g: continue
                opp, d, times = g.groups()[-3:]
                if d: out.append({"side": side, "stat": stat, "kind": kind, "period": period, "value": int(v), "opp": opp.strip(), "date": iso(d)})
                elif int(v) > 0 and not re.search(r"many", times): out.append({"side": side, "stat": stat, "kind": kind, "period": period, "value": int(v), "opp": None, "date": None, "times": times[5:]})
    return out

def heads_and_rows(streams, st, marker, out):
    """Guides that print a stat heading in capitals and then "value   opponent   date" rows, ties on rows of their own."""
    for stream in streams:
        for l in stream:
            t = longdate(undot(l.replace("\t", " "))).strip()
            if not t or marker(t, st): continue
            m = NUMROW.match(t)
            if m: st["value"] = int(m.group(1))
            g = m or (TIEROW.match(t) if st["value"] is not None else None)
            if g:
                if st["side"] and st["kind"] and st["stat"] and st["period"]: out.append(row(st, st["value"], g.group(2) if m else g.group(1), g.group(3) if m else g.group(2)))
                continue
            if UPPER(t) and not re.search(r"\d{2}", t): stat, period = stat_of(t); st.update(stat=stat, period=period if stat else None, value=None)
            elif re.match(r"^\d", t): st["value"] = None                 # a row with no game ("0   Many times"): its ties are not this mark's

def read_was(pages):
    """Washington: pp. 129-132, two columns read down then across: "WIZARDS SINGLE GAME / HIGHS", "/ LOWS", "OPPONENT SINGLE
    GAME / HIGHS", "/ LOWS"; then both teams combined and the present arena, which are not these marks."""
    out = []; st = {"side": None, "kind": None, "stat": None, "period": None, "value": None, "next": None}
    def marker(t, s):
        if re.match(r"^WIZARDS SINGLE GAME", t): s.update(next="team", side=None, stat=None); return True
        if re.match(r"^OPPONENTS? SINGLE", t): s.update(next="opp", side=None, stat=None); return True
        if re.match(r"^(TWO TEAMS COMBINED|COMBINED|CAPITAL ONE ARENA|EITHER TEAM|BOTH TEAMS|NOTABLE GAMES)", t): s.update(next=None, side=None, stat=None); return True
        if t in ("HIGHS", "LOWS", "GAME HIGHS", "GAME LOWS"): s.update(side=s["next"], kind="most" if t.endswith("HIGHS") else "fewest", stat=None, value=None); return True
        return t in ("TEAM RECORDS", "GAME")
    for p in pages[128:132]: heads_and_rows(columns(p, ANY, 50), st, marker, out)
    return out

def read_mia(pages):
    """Miami: "RECORDS – HEAT" (pp. 156-165) and "OPPONENT RECORDS – TEAM" (pp. 169-177): a stat in capitals, then SEASON,
    GAME, 1ST HALF ... 4TH QUARTER, each with HIGH(S) and LOW(S) lists. The words down the page edge are the guide's tabs."""
    out = []; st = {"side": None, "kind": None, "stat": None, "period": None, "value": None}
    def marker(t, s):
        m = re.match(r"^(SEASON|GAME|(?:1ST|2ND) HALF|(?:1ST|2ND|3RD|4TH) QUARTER|OVERTIME(?: TOTAL)?|(?:SINGLE|DOUBLE|TRIPLE) OVERTIME)$", t)
        if m: s.update(period={"GAME": "game", "SEASON": None, "OVERTIME": None, "OVERTIME TOTAL": None}.get(t, "half" if "HALF" in t else "quarter" if "QUARTER" in t else None), kind=None, value=None); return True
        if t in ("HIGH", "HIGHS", "LOW", "LOWS"): s.update(kind="most" if t.startswith("HIGH") else "fewest", value=None); return True
        if UPPER(t) and not re.search(r"\d{2}", t):
            stat = stat_of(t)[0] if not re.search(r"QUARTER|HALF|OVERTIME", t) else None
            s.update(stat=stat, period=None, kind=None, value=None); return True
        return not re.match(r"^\d", t) and not TIEROW.match(t)       # the tab words (Management, Players, ...)
    for p in pages:
        top = p[:300]
        side = "opp" if re.search(r"OPPONENT RECORDS\s+[–-]\s+TEAM", top) else "team" if re.search(r"^\s*RECORDS\s+[–-]\s+HEAT", top) else None
        if not side: continue
        st.update(side=side)
        heads_and_rows(columns(p, ANY, 60), st, marker, out)
    return out

def read_den(pages):
    """Denver (pp. 344-349; NBA years only): opponents' team marks under "TEAM - SINGLE GAME" (a stat heading, then value,
    opponent and date, ties on rows of their own); "NUGGETS & OPPONENTS ALL-TIME LOWS", rows "DEN 22 @ Detroit, 3/18/08"
    and "OPP 21 by Memphis, 3/6/06" under each stat (they also run on into the next page's right column); and the Nuggets'
    own records by category from "SCORING" on, where only "MOST/FEWEST <stat>, GAME|ONE HALF|ONE QUARTER" headings are
    single-game marks ("... ALLOWED, GAME" is the opponents')."""
    out = []; st = {"mode": None, "low": None, "h": None, "o": None, "value": None, "side": None, "lastlow": None, "queue": []}
    GAMEH = re.compile(r"^(MOST|FEWEST) (.+?), (GAME|ONE HALF|ONE QUARTER|HALF|QUARTER)$")
    ROW = re.compile(r"^(\d{1,3})[*]*(?:,)?\s+(.+?),?\s+(\d{1,2}/\d{1,2}/\d{2,4})\b")
    TIE = re.compile(r"^((?:vs\.?|at|@|by)\s.+?|[A-Z][A-Za-z.]+(?: [A-Z][A-Za-z.]+)*(?: \(\d?OT\))?),?\s+(\d{1,2}/\d{1,2}/\d{2,4})\b")
    clean = lambda o: re.sub(r"^(?:(?:several|\w+) times|twice)[,]?\s*(?:last\s*)?(?:by\s+\S+(?: \S+)? (?=@|vs|at))?", "", o.strip(" ,"), flags=re.I).strip(" ,")
    def add(side, stat, kind, period, v, o, d):
        if side and stat and iso(d) < "2026-07-01":         # "11/24/28" (an assists low) is a misprint; not this mark either way
            out.append({"side": side, "stat": stat, "kind": kind, "period": period, "value": v, "opp": re.sub(r"\s*\((?:\d?OT|\d+-\d+)\)", "", clean(o)), "date": iso(d)})
    for p in pages[343:349]:
        for stream in columns(p, ANY, 55):
            for l in stream:
                t = re.sub(r"(?<=\d)\*+", "", l.replace("\t", " ")).strip().replace(" - GAME", "")
                if not t or t.startswith("*") or t.startswith("@NUGGETS"): continue
                if t == "INDIVIDUAL - SINGLE GAME": st.update(mode=None, o=None); continue
                if t == "TEAM - SINGLE GAME": st.update(mode="opp", o=None, value=None); continue
                if t == "NUGGETS & OPPONENTS ALL-TIME LOWS": st.update(mode=None, low=None); continue
                if t == "SCORING" and st["mode"] is None: st.update(mode="team", h=None); continue
                if t in ("TEAM NOTABLE GAMES", "NUGGETS ALL-TIME STREAKS"): st.update(mode=None); continue
                m = re.match(r"^(DEN|OPP)(?:\s+(.*))?$", t)
                if m:                                         # a lows row, in whichever section it is printed
                    side = "team" if m.group(1) == "DEN" else "opp"; r = ROW.match(m.group(2) or "")
                    if r: add(side, st["low"], "fewest", "game", int(r.group(1)), r.group(2), r.group(3)); st["lastlow"] = side
                    elif not m.group(2): st["queue"].append(side)
                    continue
                r = ROW.match(t); tie = TIE.match(t) if not r else None
                if (r or tie) and (st["queue"] or (st["lastlow"] and st["low"] and l[:12].strip() == "" and st["mode"] != "opp")):
                    if r:                                     # "DEN" / "OPP" printed alone, their values on the lines under them; or a tie under a lows row
                        side = st["queue"].pop(0) if st["queue"] else st["lastlow"]
                        add(side, st["low"], "fewest", "game", int(r.group(1)), r.group(2), r.group(3)); st["lastlow"] = side
                    continue
                if r or tie:
                    if r: st["value"] = int(r.group(1))
                    o, d = (r.group(2), r.group(3)) if r else (tie.group(1), tie.group(2))
                    if st["value"] is None: continue
                    if st["mode"] == "opp" and st["o"]: add("opp", st["o"][0], st["o"][1], "game", st["value"], o, d)
                    elif st["mode"] == "team" and st["h"]: add(st["h"][0], st["h"][1], st["h"][2], st["h"][3], st["value"], o, d)
                    continue
                if re.match(r"^\d", t): st["value"] = None if not re.fullmatch(r"\d{1,3}", t) else int(t); continue
                if UPPER(t) and not re.search(r"\d{2}", t):
                    st["queue"] = []; st["lastlow"] = None; st["value"] = None
                    stat = stat_of(t)[0] if not re.search(r"SEASON|CAREER|AVERAGE|PERCENTAGE|CONSECUTIVE|NO MISSES|NONE MISSED|ROOKIE|PER GAME|MARGIN", t) else None
                    st["low"] = stat
                    st["o"] = (stat, "fewest" if t.startswith("FEWEST") else "most") if stat and st["mode"] == "opp" else None
                    g = GAMEH.match(t)
                    if not g and not re.match(r"^(MOST|FEWEST|HIGHEST|LOWEST|LONGEST|LARGEST)\b", t): st["cat"] = stat      # a category line ("OFFENSIVE REBOUNDS")
                    if g and stat and st["mode"] == "team":
                        name = g.group(2); side = "opp" if name.endswith(" ALLOWED") else "team"; hs = stat_of(name.replace(" ALLOWED", ""))[0]
                        # p. 348 prints "FEWEST DEFENSIVE REBOUNDS, GAME" twice; the first, under OFFENSIVE REBOUNDS (1, 1, 2), is the offensive list
                        if {hs, st.get("cat")} == {"oreb", "dreb"}: hs = st["cat"]
                        st["h"] = (side, hs, g.group(1).lower(), "game" if g.group(3) == "GAME" else "half" if "HALF" in g.group(3) else "quarter")
                    else: st["h"] = None
                elif st["mode"] == "opp" and re.match(r"^Non-Overtime$", t): continue
    return out

MEMSTAT = {"Points": "pts", "Field Goals Made": "fgm", "Field Goal Atts": "fga", "3-Pt Field Goals Made": "fg3m", "3-Pt Field Goal Atts": "fg3a", "Free Throws Made": "ftm",
           "Free Throw Atts": "fta", "Total Rebounds": "reb", "Offensive Rebounds": "oreb", "Defensive Rebounds": "dreb", "Assists": "ast", "Steals": "stl", "Blocks": "blk",
           "Turnovers": "tov", "Personal Fouls": "pf", "Field Goal Pct": None, "Free Throw Pct": None, "3-Pt Field Goal Pct": None}
MEMCELL = re.compile(r"(?<!\S)(\.?\d[\d.]*)\s+(?:\((\d+\+?)\)\s+)?(\d{1,2}/\d{1,2}/\d{2,4})\s+((?:vs|@)\s+[A-Z]{2,3})(?:\s+\([^)]*\))?(?:\s*\*)?")

def read_mem(pages):
    """Memphis (pp. 98-101): "ALL-TIME SEASON & SINGLE-GAME HIGHS" / "LOWS", the Grizzlies' and then opponents'. Bands of three
    stats across, rows Season / Game / Half / Quarter / OT down the left, cells like "151 (2) 2/25/2025 vs PHO (OT) *" (the
    count in brackets is how many times; the date is the most recent). Cells go to a stat by where they sit across the page:
    the band's cell positions fall into three groups."""
    out = []
    def band(heads, rows, side, kind):
        cells = [(x, per, c) for per, found in rows for x, c in found]
        if not cells: return
        xs = sorted({x for x, _, _ in cells}); groups = [[xs[0]]]
        for x in xs[1:]:
            (groups[-1].append(x) if x - groups[-1][-1] <= 15 else groups.append([x]))
        if len(groups) != len(heads): print(f"   MEM: a band of {len(heads)} stats has cells in {len(groups)} places; left out: {heads}"); return
        col = {x: i for i, g in enumerate(groups) for x in g}
        for x, per, c in cells:
            stat = MEMSTAT.get(heads[col[x]])
            if not stat or not per or "." in c.group(1): continue
            out.append({"side": side, "stat": stat, "kind": kind, "period": per, "value": int(c.group(1)), "opp": c.group(4), "date": iso(c.group(3))})
    for p in pages[97:101]:
        top = p[:400]
        side = "opp" if "OPPONENTS ALL-TIME" in top else "team" if "GRIZZLIES ALL-TIME" in top else None
        kind = "most" if "HIGHS" in top else "fewest" if "LOWS" in top else None
        if not side or not kind: continue
        heads, rows, per = None, [], None
        for l in p.split("\n"):
            l = l.replace("\t", " ")
            l = l[:115] + re.sub(r"\s{3,}[A-Z]{3,}(?: [A-Z]+)?\s*$", "", l[115:]) if re.search(r"\s{3,}[A-Z]{3,}(?: [A-Z]+)?\s*$", l[100:]) else l      # the guide's tab words (INTRO, PLAYERS...) down the right edge
            toks = [t.strip() for t in re.split(r"\s{2,}", l.strip()) if t.strip()]
            if toks and all(t in MEMSTAT for t in toks):
                if heads: band(heads, rows, side, kind)
                heads, rows, per = toks, [], None; continue
            if not heads: continue
            lab = re.match(r"^\s*(Season|Game|Half|Quarter|OT)\b", l)
            if lab: per = {"Season": None, "Game": "game", "Half": "half", "Quarter": "quarter", "OT": "ot"}[lab.group(1)]
            found = [(c.start(), c) for c in MEMCELL.finditer(l)]
            if found: rows.append((per, found))
        if heads: band(heads, rows, side, kind)
    return out

def three_columns(page, skip=5):
    """Atlanta's pages run three columns across; each starts where its "Most ..." / "Game" / "Season" lines line up."""
    lines = [l.replace("\t", " ").rstrip() for l in page.split("\n")[skip:]]
    xs = sorted({m.start() for l in lines for m in re.finditer(r"(?:(?<=\s{3})|^)(?:Most|Fewest|Highest|Lowest|Game|Season|Half|Quarter)\b", l)})
    starts = [x for x in xs if x > 40]
    cuts = []
    for x in starts:
        if not cuts or x - cuts[-1] > 40: cuts.append(x)
    cuts = cuts[:2]
    streams = [[] for _ in range(len(cuts) + 1)]
    for l in lines:
        bounds = [0] + cuts + [10 ** 6]
        for i in range(len(bounds) - 1):
            a, b = bounds[i], bounds[i + 1]
            if a and len(l) > a and l[a - 1] != " ":            # text runs across the boundary: move it to the gap on its left
                g = [m.end() for m in re.finditer(r"\s{2,}", l[:a]) if m.end() >= a - 8]
                a = g[-1] if g else a
            streams[i].append(l[a:b] if i < len(bounds) - 2 else l[a:])
    return streams

def read_atl(pages):
    """Atlanta (pp. 120-123): three columns; "HAWKS TEAM RECORDS" / "HIGHS" / "LOWS", then "OPPONENT TEAM RECORDS" / "HIGHS" /
    "LOWS"; a stat heading ("Most Points"), a label ("Game (OT)", "First Half", "1st Quarter", "Overtime^") and the row under it."""
    marks = [(r"^HAWKS TEAM RECORDS$", "team", "none"), (r"^OPPONENT TEAM RECORDS$", "opp", "none"), (r"^HIGHS$", "same", "most"), (r"^LOWS$", "same", "fewest"),
             (r"^(?:HAWKS INDIVIDUAL RECORDS|OPPONENT INDIVIDUAL SINGLE GAME|RECORDS|STATE FARM ARENA.*)$", "off", "none")]
    def marker(l, s):
        for rx, side, kind in marks:
            if re.match(rx, l):
                if side != "same": s["side"] = None if side == "off" else side; s["stat"] = None
                if kind != "same": s["kind"] = None if kind == "none" else kind
                s["period"] = s["value"] = None; return ""
        return None
    out = []; state = {"side": None, "kind": None, "stat": None, "period": None, "value": None}
    prep = lambda ls: [re.sub(r"\*+", "", l).replace("Overtime^", "Overtime") for l in ls]
    for p in pages[119:123]: scan(three_columns(p), state, marker, TITLE, out, prep=prep)
    return out

def cle_prep(lines):
    """Cleveland: long dates; "Road Game" is not a period; and one block the text scrambles (p. 175: "31", "31", then the two
    opponents, then the two dates, each on a line of its own) is put back into rows."""
    ls = [re.sub(r"\s*\((?:Reg|\d ?OT|(?:1st|2nd|3rd|4th) [HQ])\)", "", longdate(l)) for l in lines if l]; out = []; i = 0
    val = lambda l: re.fullmatch(r"\d{1,3}", l); opp = lambda l: re.match(r"^(?:@|vs\.|at)\s", l) and not DATED.search(l); day = lambda l: re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", l)
    while i < len(ls):
        n = 0
        while i + n < len(ls) and val(ls[i + n]): n += 1
        if n and i + 3 * n <= len(ls) and all(opp(ls[i + n + k]) for k in range(n)) and all(day(ls[i + 2 * n + k]) for k in range(n)):
            out += [f"{ls[i + k]}   {ls[i + n + k]}   {ls[i + 2 * n + k]}" for k in range(n)]; i += 3 * n; continue
        out.append("ROAD GAME" if ls[i] == "Road Game" else ls[i]); i += 1
    return out

def sac_prep(lines):
    """Sacramento: long dates ("Feb. 24, 2023"), "Game (+ 2OT)" labels, "12+" values and "twice, last vs. Houston"."""
    out = []
    for l in lines:
        l = re.sub(r"^Game\s*\(\+\s*\d?OT\)", "Game", longdate(l))
        out.append(re.sub(r"^(\d{1,3})\+(?=\s)", r"\1", l).replace("twice, last ", ""))
    return out

M = lambda *names: (r"^(?:" + "|".join(names) + r")$", "off", "none")
READERS = {
    "PHI": ("Philadelphia-76ers", read_phi),
    "LAL": ("Lakers", by_page_title([(r"REGULAR SEASON OPPONENT TEAM RECORDS \(HIGHS\)", ("opp", "most")), (r"REGULAR SEASON OPPONENT TEAM RECORDS \(LOWS\)", ("opp", "fewest")),
                                     (r"REGULAR SEASON TEAM RECORDS \(HIGHS\)", ("team", "most")), (r"REGULAR SEASON TEAM RECORDS \(LOWS\)", ("team", "fewest"))], top=200)),
    "MIN": ("Timberwolves", by_page_title([(r"OPPONENT TEAM HIGHS", ("opp", "most")), (r"OPPONENT TEAM LOWS", ("opp", "fewest")), (r"WOLVES TEAM HIGHS", ("team", "most")), (r"WOLVES TEAM LOWS", ("team", "fewest"))])),
    "PHX": ("Suns", by_marker(144, 152, [(r"^Suns Team Records - Highs$", "team", "most"), (r"^Suns Team Records - Lows$", "team", "fewest"), (r"^Opponents Team Records -\s*Highs$", "opp", "most"),
                                         (r"^Opponents Team Records -\s*Lows$", "opp", "fewest"), (r"^Opponents Team Records -$", "opp", "none"), (r"^Highs$", "same", "most"), (r"^Lows$", "same", "fewest"),
                                         (r"^(?:Opponents Single-Game|Opponents Top Nights|Suns Top Nights|Arena Records|Suns Single-Game|Suns Individual|(?-i:Records)$)", "off", "none")], heading_like=TITLE, anchor=[(LBL_AT, 25), (re.compile(r"(?<=\s{3})\S"), 46)], prep=wrap_prep)),
    "SAS": ("Spurs", by_marker(354, 359, [(r"^SPURS TEAM RECORDS$", "team", "none"), (r"^OPPONENT RECORDS$", "opp", "none"), (r"^SPURS (?:INDIVIDUAL|PLAYOFF|ABA) RECORDS$", "off", "none"), (r"^OPPONENT PLAYOFF RECORDS$", "off", "none"),
                                          (r"^INDIVIDUAL\b", "same", "none"), (r"^(?:TEAM )?HIGHS\b", "same", "most"), (r"^(?:TEAM )?LOWS\b", "same", "fewest")], two_columns=False, kind_per_stat=True)),
    "DAL": ("Mavericks", by_marker(366, 374, [(r"^TEAM OPPONENT HIGHS$", "opp", "most"), (r"^TEAM OPPONENT LOWS$", "opp", "fewest"), (r"^TEAM HIGHS$", "team", "most"), (r"^TEAM LOWS$", "team", "fewest"),
                                              M("INDIVIDUAL", "ROOKIE LEADERS", "OPPONENT PLAYER HIGHS")], label_after=True)),
    "BKN": ("Nets", by_marker(101, 103, [(r"^Nets Team Record Highs$", "team", "most"), (r"^Nets Team Record Lows$", "team", "fewest"), (r"^Opponent Team Record Highs$", "opp", "most"), (r"^Opponent Team Record Lows$", "opp", "fewest"),
                                         M("NETS IN OVERTIME GAMES", "NETS TOP 10.*", "Opponents Combined.*")], heading_like=NODIGIT)),
    "CHA": ("Hornets", by_marker(219, 223, [(r"^TEAM HIGHS$", "team", "most"), (r"^TEAM LOWS$", "team", "fewest"), (r"^OPPONENT TEAM HIGHS$", "opp", "most"), (r"^OPPONENT TEAM LOWS(?: CONTINUED)?$", "opp", "fewest"),
                                            M("(?:OPPONENT )?INDIVIDUAL HIGHS")], bands=True)),
    "HOU": ("Rockets", by_page_title([(r"Opponents Team Records", ("opp", None)), (r"Rockets Team Records", ("team", None))], heading_like=TITLE, top=300, first=117, last=121)),
    "OKC": ("Thunder", by_page_title([(r"OKLAHOMA CITY TEAM RECORDS", ("team", "most"))], top=300, first=145, last=145, default_kind="most")),
    "GSW": ("Warriors", by_page_title([(r"OPPONENTS ALL-TIME TEAM RECORDS", ("opp", None)), (r"WARRIORS ALL-TIME TEAM RECORDS", ("team", None))], top=300, first=121, last=129, default_kind="most")),
    "DET": ("Pistons", read_det),
    "CHI": ("Bulls", by_marker(117, 121, [(r"^BULLS TEAM SINGLE GAME HIGHS$", "team", "most"), (r"^BULLS TEAM SINGLE GAME LOWS$", "team", "fewest"), (r"^OPPONENT TEAM SINGLE GAME$", "opp", "none"), (r"^HIGHS$", "same", "most"),
                                          (r"^LOWS$", "same", "fewest"), M("MISCELLANEOUS TEAM RECORDS", ".*INDIVIDUAL RECORDS")], heading_like=TITLE)),
    "POR": ("Trail-Blazers", by_marker(101, 113, [(r"^TRAIL BLAZERS TEAM GAME HIGHS$", "team", "most"), (r"^TRAIL BLAZERS TEAM GAME LOWS$", "team", "fewest"), (r"^OPPONENT TEAM GAME HIGHS$", "opp", "most"), (r"^OPPONENT TEAM GAME LOWS$", "opp", "fewest"),
                                                  (r"^(?:TRAIL BLAZERS INDIVIDUAL SINGLE-|TRAIL BLAZERS ROOKIE RECORDS|TRAIL BLAZERS TOP PERFORMANCES|TRAIL BLAZERS IN NBA'S TOP 10|OPPONENT INDIVIDUAL SINGLE-GAME|OPPONENT TOP PERFORMANCES|TRAIL BLAZERS CAREER RECORDS)", "off", "none")],
                                       heading_like=NODIGIT, prep=por_prep, anchor=re.compile(r"(?<=\s{3})\S"), min_x=56)),
    "NOP": ("Pelicans", by_marker(187, 190, [(r"^TEAM HIGHS$", "team", "most"), (r"^TEAM LOWS$", "team", "fewest"), (r"^OPPONENT TEAM HIGHS$", "opp", "most"), (r"^OPPONENT TEAM LOWS$", "opp", "fewest")], heading_like=TITLE)),
    "ORL": ("Magic", by_marker(311, 325, [(r"^MAGIC TEAM HIGHS$", "team", "most"), (r"^MAGIC TEAM LOWS$", "team", "fewest"), (r"^OPPONENT TEAM HIGHS(?: \*\*.*)?$", "opp", "most"), (r"^OPPONENT TEAM LOWS(?: \*\*.*)?$", "opp", "fewest"),
                                          M("MAGIC ROOKIE RECORDS", "MAGIC MISCELLANEOUS.*", "MAGIC INDIVIDUAL HIGHS", "OPPONENT INDIVIDUAL HIGHS", "TOP WINS.*")], two_columns=False, prep=orl_prep)),
    "LAC": ("Clippers", by_marker(66, 69, [(r"^FRANCHISE OPPONENT RECORDS\b", "opp", "none"), (r"^(?:FRANCHISE|OPPONENTS) PLAYOFF RECORDS\b", "off", "none"), (r"^FRANCHISE RECORDS\b", "team", "none"), (r"^INDIVIDUAL\b", "same", "none"),
                                           (r"^TEAM HIGH\b", "same", "most"), (r"^TEAM LOW\b", "same", "fewest")], kind_per_stat=True, anchor=re.compile(r"(?<=\s{3})(?:INDIVIDUAL|TEAM HIGH|TEAM LOW)\b"), min_x=60)),
    "MIL": ("Bucks", read_mil),
    "BOS": ("Celtics", read_bos),
    "UTA": ("Jazz", read_uta),
    "TOR": ("Raptors", read_tor),
    "IND": ("Pacers", read_ind),
    "NYK": ("Knicks", read_nyk),
    "WAS": ("Wizards", read_was),
    "MIA": ("Heat", read_mia),
    # 0.97: the Kings-Royals franchise pages (pp. 119-120 the Kings, 126-127 opponents); pp. 113-117 are the Sacramento years only.
    "ATL": ("Atlanta-Hawks", read_atl),
    # 0.98: text after all (pp. 174-175), highs only: "CAVALIERS ONE GAME", then "OPPONENTS ONE GAME" (seen from Cleveland: "@ Memphis").
    "CLE": ("Cleveland-Cavaliers", by_marker(174, 175, [(r"^CAVALIERS ONE GAME$", "team", "most"), (r"^OPPONENTS ONE GAME$", "opp", "most")], prep=cle_prep)),
    "DEN": ("Denver-Nuggets", read_den),
    "MEM": ("Memphis-Grizzlies", read_mem),
    "SAC": ("Sacramento-Kings", by_marker(119, 127, [(r"^KINGS-ROYALS TEAM RECORDS$", "team", "none"), (r"^OPPONENT TEAM RECORDS$", "opp", "none"), (r"^OPPONENT TEAM RECORDS \(MOST\)$", "opp", "most"),
                                                     (r"^\(MOST\)$", "same", "most"), (r"^\(FEWEST\)$", "same", "fewest"),
                                                     M("KINGS-ROYALS TOP PERFORMANCES", "OPPONENT INDIVIDUAL RECORDS", "KINGS-ROYALS INDIVIDUAL.*", "OPPONENT PERFORMANCES", "NOTABLE PERF.*", "TOP SCORING PERFORMANCES")], prep=sac_prep)),
}

_vf = os.path.join(os.path.dirname(os.path.abspath(__file__)), "team-records-verified.json")
_V = json.load(open(_vf)) if os.path.exists(_vf) else {}
VERIFIED, REDATE, DROP, REVALUE, UNDATE = _V.get("marks", {}), _V.get("redate", {}), _V.get("drop", {}), _V.get("revalue", {}), _V.get("undate", {})
ADD = _V.get("add", {})          # 0.100: a game that beats (or is) the mark and is not on the guide's page, found in ESPN's line scores and confirmed elsewhere

# an opponent's name with the end of the cell before it ("77-133)    vs. BOS", "2 OT          vs SAC") or a stray leader dot
tidy = lambda o: re.sub(r"\s{2,}", " ", re.sub(r"\s+\.$", "", re.sub(r"^(?:[\d\-]*\)|\d ?OT)\s{2,}", "", o or ""))).strip()

def main():
    d = sys.argv[1]; teams = {}
    for tri, (key, fn) in READERS.items():
        f = [x for x in glob.glob(os.path.join(d, "*.txt")) if key in os.path.basename(x)][0]
        rows = fn(open(f, encoding="utf8", errors="replace").read().split("\f"))
        # A mark printed two ways and looked up outside the guide (tools/team-records-verified.json): the other row goes.
        checked = {}
        for v in VERIFIED.get(tri, []):
            k = (v["side"], v["stat"], v["kind"], v["period"]); checked[k] = v["by"]
            rows = [r for r in rows if not ((r.get("side", "team"), r["stat"], r["kind"], r["period"]) == k and r["date"] == v["date"] and r["value"] != v["value"])]
        # 0.99: looked up in ESPN's box scores (tools/check-team-marks.mjs): a wrong date, a game that is not this mark, a wrong number
        K = lambda r: (r.get("side", "team"), r["stat"], r["kind"], r["period"]); KV = lambda v: (v["side"], v["stat"], v["kind"], v["period"]); used = 0
        for v in REDATE.get(tri, []):
            for r in rows:
                if K(r) == KV(v) and r["date"] == v["from"]:
                    r["date"] = v["to"]; r["fixed"] = v["by"]; used += 1
                    if v.get("opp"): r["opp"] = v["opp"]                # the guide names the wrong opponent too
        for v in DROP.get(tri, []):
            n = len(rows); rows = [r for r in rows if not (K(r) == KV(v) and r["date"] == v["date"])]; used += n - len(rows)
        for v in REVALUE.get(tri, []):
            for r in rows:
                if K(r) == KV(v) and r["date"] == v["date"]: r["value"] = v["value"]; r["fixed"] = v["by"]; used += 1
        for v in UNDATE.get(tri, []):                         # the number stays, the night the guide gives for it does not
            for r in rows:
                if K(r) == KV(v) and r["date"] == v["date"]: r["date"] = None; r["opp"] = None; r["times"] = "the night is not confirmed"; used += 1
        for v in ADD.get(tri, []):
            cur = [r["value"] for r in rows if K(r) == KV(v)]
            if cur and (max(cur) > v["value"] if v["kind"] == "most" else min(cur) < v["value"]): print(f"   {tri}: an added game does not reach the printed mark: {v}")
            rows.append({"side": v["side"], "stat": v["stat"], "kind": v["kind"], "period": v["period"], "value": v["value"], "opp": v["opp"], "date": v["date"]}); checked[KV(v)] = v["by"]
        want = len(REDATE.get(tri, [])) + len(DROP.get(tri, [])) + len(REVALUE.get(tri, [])) + len(UNDATE.get(tri, []))
        if used < want: print(f"   {tri}: {want - used} correction(s) in team-records-verified.json found no row")
        if os.environ.get("SHOW") == tri:
            for r in rows: print("   ", r.get("side", "team"), r["kind"], r["stat"], r["period"], r["value"], "|", r["opp"], "|", r["date"])
        # The mark for a stat and period is the highest (or lowest) value printed; ties share it.
        best = {}
        for r in rows:
            k = (r.get("side", "team"), r["stat"], r["kind"], r["period"]); b = best.get(k)
            better = b is None or (r["value"] > b[0]["value"] if r["kind"] == "most" else r["value"] < b[0]["value"])
            if better: best[k] = [r]
            elif r["value"] == b[0]["value"] and not any(x["date"] == r["date"] for x in b): b.append(r)
        # A guide that prints one game's mark twice with two values (Boston: 72 field goals on p. 197, 77 on p. 198, the same
        # night) is noted; the mark kept is the one harder to reach, so a record is never claimed on the easier number.
        doubt = {}
        for r in rows:
            k = (r.get("side", "team"), r["stat"], r["kind"], r["period"])
            if r["period"] == "game" and r["date"] and any(x["date"] == r["date"] for x in best[k]) and r["value"] != best[k][0]["value"]: doubt.setdefault(k, set()).update({r["value"], best[k][0]["value"]})
        teams[tri] = [dict({"stat": k[1], "kind": k[2], "period": k[3], "value": v[0]["value"], "games": [{"opp": tidy(x["opp"]), "date": x["date"]} for x in v if x["date"]]}, **({"times": v[0]["times"]} if not v[0]["date"] and v[0].get("times") else {}), **({"side": "opp"} if k[0] == "opp" else {}), **({"doubt": sorted(doubt[k])} if k in doubt else {}), **({"checked": checked[k]} if k in checked else {})) for k, v in best.items()]
        for k, vals in doubt.items(): print(f"   {tri} prints one game twice with two values: {k} {sorted(vals)}")
        g = lambda side, kind: ", ".join(f"{m['stat']} {m['value']}" for m in teams[tri] if m["period"] == "game" and m["kind"] == kind and m.get("side", "team") == side)
        print(f"{tri}: {len(rows)} rows, {len(teams[tri])} marks\n   most: {g('team', 'most')}\n   fewest: {g('team', 'fewest')}\n   opp most: {g('opp', 'most')}\n   opp fewest: {g('opp', 'fewest')}")
    # What "all-time" means where it is not the franchise's whole history: the Thunder's guide starts in Oklahoma City.
    scopes = {"OKC": "in Oklahoma City history (since 2008-09)", "DEN": "in the Nuggets' NBA years (since 1976-77)"}
    notes = {"LAL": "the Lakers' fewest marks leave out games before the shot clock (1954-55)", "BOS": "pp. 197 and 198 print the same game with two values for field goals (72, 77) and free throw attempts (65, 66); Basketball Reference's box scores have 72 and 65", "DEN": "p. 348 heads the fewest offensive rebounds list \"FEWEST DEFENSIVE REBOUNDS, GAME\" (1, 1, 2); it is read as offensive. The guide prints no team points by half or quarter (its half and quarter rows are players' records); its one team mark by half, threes (16 vs. Golden State, 2/13/17, pp. 346-347), is not read", "SAC": "the Kings-Royals franchise pages (pp. 119-120, 126-127); the guide's Sacramento-era pages (pp. 113-117) are not used"}
    json.dump({"through": "2025-26", "source": "team media guides for 2026-27, team single-game records (tools/parse-team-records.py)", "scopes": scopes, "notes": notes, "teams": teams}, open(sys.argv[2], "w"), separators=(",", ":"))
main()
