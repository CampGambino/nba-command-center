"""
Team single-game records as the guides print them -> src/data/team-game-records-2026-27.json (0.92).

  python3 tools/parse-team-records.py <folder of guide text> src/data/team-game-records-2026-27.json

The first pass over all 30 guides (11/17/26) found these pages are text, not pictures, but each guide lays them out
its own way. claude/team-guide-inventory.md lists where each guide's pages are.

A mark: { stat, kind: "most"|"fewest", period: "game"|"half"|"quarter"|"ot", value, games: [{ opp, date }], side: "opp" when
it is the most or fewest by an opponent, doubt: [values] when the guide prints the same game with two values }. Only whole
numbers of the stats this season's box scores carry are kept.

0.93: 19 guides are read. PHI has its own reader; the rest share one scanner (scan) and differ in a few facts each.
Not read: ATL (three columns run together), DEN (DEN / OPP rows), MEM (three stats across each row), TOR (points only),
SAC; not found in the text: CLE (pictures), IND, MIA, NYK, UTA, WAS.
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

def iso2(s):
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
                state["period"] = state["value"] = None
                continue
            if v:
                state["value"] = int(v.group(1)); rest = rest[v.end():]
                if not lab and state.get("label_after") and i + 1 < len(lines) and LABEL.fullmatch(lines[i + 1]): state["period"] = period_of(lines[i + 1])
            elif lab: state["value"] = None; continue      # "Game 1.000 ...": a percentage or a total, not a count
            d = DATED.search(rest)
            if not d or state["value"] is None or not (state["side"] and state["kind"] and state["stat"] and state["period"]): continue
            out.append({"side": state["side"], "stat": state["stat"], "kind": state["kind"], "period": state["period"], "value": state["value"],
                        "opp": re.sub(r"^(?:\(\d+\)\s*)?(?:(?:Several|\w+|\d+x?) times[.,;:]?\s*)?(?:(?:Most recent(?:ly)?|last|MR)[:,]?\s*)?", "", rest[:d.start()].strip(" ,;("), flags=re.I).strip(" ,;"), "date": iso2(d.group(1))})

UPPER = lambda l: l == l.upper() and re.search(r"[A-Z]{3}", l) is not None
TITLE = lambda l: re.match(r"^(Most|Fewest|Highest|Lowest|Largest|Smallest|Best|Worst|Consecutive|Longest)\b", l) is not None
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
        if re.match(r"^(Highest|Lowest|Best|Worst)\b", l): s["period"] = s["value"] = None; return ""
        return None
    for p in pages:
        if not re.search(r"^\s*TEAM RECORDS\s*\n\s*BUCKS\s+OPPONENTS", p): continue
        state = {"side": None, "kind": None, "stat": None, "period": None, "value": None}
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

M = lambda *names: (r"^(?:" + "|".join(names) + r")$", "off", "none")
READERS = {
    "PHI": ("Philadelphia-76ers", read_phi),
    "LAL": ("Lakers", by_page_title([(r"REGULAR SEASON OPPONENT TEAM RECORDS \(HIGHS\)", ("opp", "most")), (r"REGULAR SEASON OPPONENT TEAM RECORDS \(LOWS\)", ("opp", "fewest")),
                                     (r"REGULAR SEASON TEAM RECORDS \(HIGHS\)", ("team", "most")), (r"REGULAR SEASON TEAM RECORDS \(LOWS\)", ("team", "fewest"))], top=200)),
    "MIN": ("Timberwolves", by_page_title([(r"OPPONENT TEAM HIGHS", ("opp", "most")), (r"OPPONENT TEAM LOWS", ("opp", "fewest")), (r"WOLVES TEAM HIGHS", ("team", "most")), (r"WOLVES TEAM LOWS", ("team", "fewest"))])),
    "PHX": ("Suns", by_marker(144, 152, [(r"^Suns Team Records - Highs$", "team", "most"), (r"^Suns Team Records - Lows$", "team", "fewest"), (r"^Opponents Team Records -\s*Highs$", "opp", "most"),
                                         (r"^Opponents Team Records -\s*Lows$", "opp", "fewest"), (r"^Opponents Team Records -$", "opp", "none"), (r"^Highs$", "same", "most"), (r"^Lows$", "same", "fewest"),
                                         (r"^(?:Opponents Single-Game|Opponents Top Nights|Suns Top Nights|Arena Records|Suns Single-Game|Suns Individual|(?-i:Records)$)", "off", "none")], heading_like=TITLE, anchor=[(LBL_AT, 25), (re.compile(r"(?<=\s{3})\S"), 46)])),
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
}

def main():
    d = sys.argv[1]; teams = {}
    for tri, (key, fn) in READERS.items():
        f = [x for x in glob.glob(os.path.join(d, "*.txt")) if key in os.path.basename(x)][0]
        rows = fn(open(f, encoding="utf8", errors="replace").read().split("\f"))
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
            if r["period"] == "game" and any(x["date"] == r["date"] for x in best[k]) and r["value"] != best[k][0]["value"]: doubt.setdefault(k, set()).update({r["value"], best[k][0]["value"]})
        teams[tri] = [dict({"stat": k[1], "kind": k[2], "period": k[3], "value": v[0]["value"], "games": [{"opp": x["opp"], "date": x["date"]} for x in v]}, **({"side": "opp"} if k[0] == "opp" else {}), **({"doubt": sorted(doubt[k])} if k in doubt else {})) for k, v in best.items()]
        for k, vals in doubt.items(): print(f"   {tri} prints one game twice with two values: {k} {sorted(vals)}")
        g = lambda side, kind: ", ".join(f"{m['stat']} {m['value']}" for m in teams[tri] if m["period"] == "game" and m["kind"] == kind and m.get("side", "team") == side)
        print(f"{tri}: {len(rows)} rows, {len(teams[tri])} marks\n   most: {g('team', 'most')}\n   fewest: {g('team', 'fewest')}\n   opp most: {g('opp', 'most')}\n   opp fewest: {g('opp', 'fewest')}")
    # What "all-time" means where it is not the franchise's whole history: the Thunder's guide starts in Oklahoma City.
    scopes = {"OKC": "in Oklahoma City history (since 2008-09)"}
    notes = {"LAL": "the Lakers' fewest marks leave out games before the shot clock (1954-55)", "BOS": "pp. 197 and 198 print the same game with two values for field goals (72, 77) and free throw attempts (65, 66)"}
    json.dump({"through": "2025-26", "source": "team media guides for 2026-27, team single-game records (tools/parse-team-records.py)", "scopes": scopes, "notes": notes, "teams": teams}, open(sys.argv[2], "w"), separators=(",", ":"))
main()
