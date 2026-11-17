"""
"The last time…" pages of the team media guides -> src/data/last-time-2026-27.json (0.89).

  python3 tools/parse-last-time.py <folder of guide text> src/data/last-time-2026-27.json

Three guides print one: Boston and Washington (two pages each: a feat in the middle, the last time the team did it on
the left and the last time an opponent did it on the right), and Golden State (one page, a line a feat). Only feats
this season's box scores can carry forward are kept: a player's or a team's points, rebounds, assists, steals, blocks,
field goals, threes and free throws at or above a number, a triple-double, a 20-20 game, a margin, a shooting night.
"""
import glob, json, os, re, sys

MONTHS = {m: i + 1 for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"])}
STAT = {"points": "pts", "rebounds": "reb", "assists": "ast", "blocks": "blk", "steals": "stl", "field goals": "fgm", "3-pointers": "fg3m", "free throws": "ftm", "turnovers": "tov"}

def label_feat(label, who):
    """A printed feat -> (stat, n) or None."""
    l = label.lower().strip()
    m = re.match(r"(?:scored|had|made) (\d+)\+ (points|rebounds|assists|blocks|steals|field goals|3-pointers|free throws)$", l)
    if m: return STAT[m.group(2)], int(m.group(1))
    if l == "had a triple-double" and who == "player": return "td", 1
    if l == "had a 20/20 game" and who == "player": return "d2020", 1
    m = re.match(r"won by (\d+)\+ points$", l)
    if m and who == "team": return "margin", int(m.group(1))
    if l == "shot .600+ from the field" and who == "team": return "fgpct", 600
    return None

def two_sided(tri, pages):
    """Boston's and Washington's layout: the feat in the middle column, the team's last time to its left and the
    opponents' to its right. An entry too long for its column is split onto the lines above and below the feat."""
    out = []; who = None                  # the "A TEAM..." section runs on to the second page
    for p in pages:
        lines = p.split("\n")
        rows = [[(m.start(), m.group(0).strip()) for m in re.finditer(r"\S(?:.*?\S)?(?=\s{3,}|$)", line)] for line in lines]
        verb = lambda t: bool(re.match(r"(?:Scored|Had|Made|Shot|Won|Lost|Two Players|Overtime|Double-Overtime|Triple-Overtime|Less than|More than)\b", t)) and not re.search(r"\d{2}/\d{2}/\d{2}|\(" + tri, t)
        mids = [x + len(t) / 2 for r in rows for x, t in r if verb(t)]
        if len(mids) < 8: continue
        mid = sorted(mids)[len(mids) // 2]
        centre = lambda x, t: abs(x + len(t) / 2 - mid) < 14 and not re.search(r"\d{1,2}/\d{1,2}/\d{2}|\(" + tri + r"|Never Has Happened|^--$|MEDIA GUIDE", t)
        side = lambda i, left: " ".join(t for x, t in (rows[i] if 0 <= i < len(rows) else []) if not centre(x, t) and ((x + len(t) / 2 < mid) == left))
        for i, r in enumerate(rows):
            for x, t in r:
                if not centre(x, t): continue
                if re.match(r"AN INDIVIDUAL", t): who = "player"; continue
                if re.match(r"A TEAM", t): who = "team"; continue
                feat = label_feat(t, who)
                if not feat: continue
                for by, left in (("team", True), ("opp", False)):
                    e = side(i, left) or f"{side(i - 1, left)} {side(i + 1, left)}".strip()
                    if not e or "Never Has Happened" in e or e == "--": continue
                    # "43 PTS, Jaylen Brown: (BOS W, 147-129) @ Miami, 04/01/26"; older rows have no score: "25 REB, Wes Unseld @ San Antonio, 03/18/80"
                    m = re.match(r"^(.*?)(?::?\s*\(" + tri + r" [WL], \d+-\d+(?:\s*\(\d?OT\))?\))?\s*(vs\.|@|at)\s*([A-Z][A-Za-z .]+?),\s*(\d{2})/(\d{2})/(\d{2})$", e)
                    if not m: print(f"  {tri}: not read: {t}: {e[:90]}"); continue
                    head = m.group(1).strip().rstrip(":,").strip(); value, _, holder = head.rpartition(", ") if who == "player" else (head, "", "")
                    yy = int(m.group(6)); y = 1900 + yy if yy >= 46 else 2000 + yy
                    out.append({"team": tri, "by": by, "who": who, "stat": feat[0], "n": feat[1], "date": f"{y}-{m.group(4)}-{m.group(5)}", "holder": holder.strip() or None,
                                "value": value.strip(), "opp": m.group(3).strip(), "label": t})
    return out

def gsw(pages):
    out = []
    for p in pages:
        if "THE LAST TIME" not in p[:300]: continue
        for line in p.split("\n"):
            m = re.match(r"^\s*(A Warrior|An opponent|The Warriors)\s+(.+?):\s{2,}([A-Z][a-z]+)\.? (\d{1,2}), (\d{4}) (at|vs\.) (.+?)(?: \(\d?ot\))?\s*(?:–\s*(.+?))?\s*\(([^)]*)\)\s*$", line)
            if not m: continue
            subj, what, mon, day, year = m.group(1), m.group(2).lower(), m.group(3), int(m.group(4)), int(m.group(5))
            mo = MONTHS.get(mon.lower()) or {k[:3]: v for k, v in MONTHS.items()}.get(mon.lower()[:3])
            who = "team" if subj == "The Warriors" or re.match(r"(scored|shot|had \d+-plus (rebounds|assists|steals|blocks)|made)", what) and not m.group(8) else "player"
            by = "opp" if subj == "An opponent" else "team"
            feat = None
            x = re.match(r"(?:had|scored) (\d+)-plus (points|rebounds|assists|steals|blocks)$", what)
            if x: feat = (STAT[x.group(2)], int(x.group(1)))
            elif what == "had a triple-double": feat = ("td", 1)
            elif what == "had 20 points and 20 rebounds": feat = ("d2020", 1)
            elif what == "shot .600-plus from the field": feat = ("fgpct", 600)
            x = re.match(r"made (\d+)-plus (three-pointers|3-pointers|threes|field goals|free throws)$", what)
            if x: feat = ({"three-pointers": "fg3m", "3-pointers": "fg3m", "threes": "fg3m", "field goals": "fgm", "free throws": "ftm"}[x.group(2)], int(x.group(1)))
            if not feat or not mo: continue
            out.append({"team": "GSW", "by": by, "who": "player" if m.group(8) else "team", "stat": feat[0], "n": feat[1], "date": f"{year}-{mo:02d}-{day:02d}", "holder": (m.group(8) or "").strip() or None,
                        "value": m.group(9).strip(), "opp": m.group(7).strip(), "label": f"{subj} {m.group(2)}"})
    return out

# ---- Lists of games: every triple-double, every 40-point game (0.89) ----
MON3 = {m[:3]: i for m, i in MONTHS.items()}
NAME = r"((?:[A-Z][a-zA-Z'’.\-]+|[A-Z]{2,}\b)(?: (?:“[^”]+”|\"[^\"]+\"))?(?: (?:[A-Z][a-zA-Z'’.\-]+|[A-Z]{2,}\b|Jr\.|Sr\.|II|III|IV)){1,3})"
DATE = r"(?:(\d{1,2})/(\d{1,2})/(\d{2,4})|([A-Z][a-z]{2,8})\.? (\d{1,2}), (\d{4}))"
ROW = re.compile(NAME + r"(?:\s*[,.]| )[^\n]{0,70}?" + DATE)
NOT_NAME = re.compile(r"^(?:vs|at|Vs|At|OT|The|Most|Date|Player|Opponent|Triple|Regular|Season|Points|Game|Home|Road|Total|First|Second|Round|Conference|Finals|Semifinals|[A-Z]{2,4})\b")

def playoff_day(d):
    y, m, day = int(d[:4]), int(d[5:7]), int(d[8:10])
    if m in (6, 7, 9): return True
    if m == 5: return not ((y == 1999 and day <= 5) or (y == 2021 and day <= 16))
    return m == 8 and not (y == 2020 and day <= 14)

def list_rows(text, right=None):
    """(player, date, most points printed on the row) for each game on a list page. `right`: cut each line there (a sidebar)."""
    out = []
    for line in text.split("\n"):
        if right: line = line[:right]
        line = re.sub(r"\.{3,}|(?: \.){3,}", "   ", line)
        cells = re.split(r"(?<=\d{2})\s{3,}(?=\*?[A-Z][a-z])", line)
        for k, cell in enumerate(cells):
            for m in ROW.finditer(cell):
                nm = m.group(1).strip().rstrip(".")
                if m.group(2): y = int(m.group(4)); y = y if y > 100 else (1900 + y if y >= 46 else 2000 + y); d = f"{y}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
                else:
                    mo = MON3.get(m.group(5)[:3].lower())
                    if not mo: continue
                    d = f"{int(m.group(7))}-{mo:02d}-{int(m.group(6)):02d}"
                if NOT_NAME.match(nm) or d > "2026-06-30" or playoff_day(d) or "*" in cell[max(0, m.start() - 2):m.end() + 2]: continue
                lead = cells[k - 1] if k and re.fullmatch(r"\s*\d{2,3}\s*", cells[k - 1]) else ""      # "70    Joel Embiid   vs. SAS   1/22/24"
                scope = f"{lead} {cell}" if len(cells) > 1 else line
                pts = [int(x) for x in re.findall(r"(?<![\d/.\-])(\d{2,3})(?![\d/.\-%])", scope) if 40 <= int(x) <= 100]
                out.append((nm.title() if nm.isupper() else nm, d, max(pts) if pts else None))
    return out

# guide, team, page (1-based), feat, whose, first and last line of the list on the page (None = all), sidebar cut, the count the heading prints
LISTS = [
    ("Charlotte-Hornets", "CHA", 230, "td", "team", (8, 49), None, None), ("Cleveland-Cavaliers", "CLE", 366, "td", "team", None, None, None),
    ("Indiana-Pacers", "IND", 185, "td", "team", None, None, None), ("Indiana-Pacers", "IND", 186, "td", "opp", None, None, None),
    ("Philadelphia-76ers", "PHI", 229, "td", "team", None, None, None), ("Philadelphia-76ers", "PHI", 230, "td", "team", (0, 45), None, None),
    ("Toronto-Raptors", "TOR", 277, "td", "team", None, None, 47), ("Toronto-Raptors", "TOR", 278, "td", "opp", None, None, 84),
    ("Miami-Heat", "MIA", 191, "td", "team", None, 125, 50), ("Utah-Jazz", "UTA", 139, "td", "team", (7, 33), None, 24),
    ("Philadelphia-76ers", "PHI", 247, "pts", "team", None, None, None), ("Philadelphia-76ers", "PHI", 248, "pts", "team", None, None, None),
]
SINCE = {("PHI", "td"): "1979-80"}

def game_lists(d):
    got = {}
    for key, tri, page, stat, by, span, right, printed in LISTS:
        f = [x for x in glob.glob(os.path.join(d, "*.txt")) if key in os.path.basename(x)][0]
        p = open(f, encoding="utf8", errors="replace").read().split("\f")[page - 1]
        if span: p = "\n".join(p.split("\n")[span[0]:span[1]])
        rs = list_rows(p, right)
        if printed and len(rs) != printed: print(f"  {tri} p{page}: {len(rs)} rows read, the heading says {printed}")
        got.setdefault((tri, stat, by), []).extend(rs)
    feats = []
    for (tri, stat, by), rs in got.items():
        rs = sorted(set(rs), key=lambda r: r[1])
        # A list is used only if it runs into last season: one that stops earlier may simply not have been kept up,
        # and "the first since" built on it would be wrong.
        if rs[-1][1] < "2025-10-01": print(f"{tri} {stat} ({by}): the list stops at {rs[-1][1]}: not used"); continue
        for n in ([1] if stat == "td" else [40, 50, 60]):
            sub = rs if stat == "td" else [r for r in rs if (r[2] or 0) >= n] if n > 40 else rs
            if not sub: continue
            last = sub[-1]
            feats.append({"team": tri, "by": by, "who": "player", "stat": stat, "n": n, "date": last[1], "holder": last[0], "value": "", "opp": "",
                          "label": "list of every triple-double" if stat == "td" else "list of every 40-point game", **({"since": SINCE[(tri, stat)]} if (tri, stat) in SINCE else {})})
        print(f"{tri} {'triple-doubles' if stat == 'td' else '40-point games'} ({by}): {len(rs)} on the list, the last {rs[-1][0]} {rs[-1][1]}")
    return feats

def main():
    d = sys.argv[1]; feats = []
    for key, tri in (("Boston-Celtics", "BOS"), ("Washington-Wizards", "WAS"), ("Golden-State-Warriors", "GSW")):
        f = [x for x in glob.glob(os.path.join(d, "*.txt")) if key in os.path.basename(x)][0]
        pages = open(f, encoding="utf8", errors="replace").read().split("\f")
        got = gsw(pages) if tri == "GSW" else two_sided(tri, [p for p in pages if "THE LAST TIME" in p[:400]])
        print(f"{tri}: {len(got)} feats"); feats += got
    feats += game_lists(d)
    json.dump({"through": "2025-26", "source": "\"The last time\" pages of the Celtics', Wizards' and Warriors' 2026-27 media guides, and ten guides' lists of every triple-double or 40-point game (tools/parse-last-time.py)", "feats": feats}, open(sys.argv[2], "w"), indent=0)
main()
