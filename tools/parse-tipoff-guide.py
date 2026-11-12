#!/usr/bin/env python3
"""
Career leaderboards, milestone watch and team records from the NBA's Tip-Off Guide (PDF)
-> src/data/tipoff-guide-<season>.json

  python3 tools/parse-tipoff-guide.py <guide.pdf> <out.json>

Needs pdftotext (poppler). Every total is as of the start of the season (through the previous
season); src/records/guide.js adds this season's box scores to bring them up to date.

  pages 92-94  career leaders, all-time (top 10 per stat)
  pages 95-97  career leaders among players active the previous season (top 10 per stat)
  pages 76-82  milestone watch: players' totals and the marks / players ahead of them
  page  83     head coaches
  page  90     franchises' all-time regular-season records
  pages 100-103 longest win streaks, best starts, home and road win streaks

Checks itself: every "needs N to pass No. R Name (V)" sentence must agree with the player's
total (V - total + 1 = N), and every "needs N to reach V" with V - total = N. A disagreement
stops the script.
"""
import json, re, subprocess, sys

PDF, OUT = sys.argv[1], sys.argv[2]

def page_text(p, layout=True):
    args = ["pdftotext", "-f", str(p), "-l", str(p)] + (["-layout"] if layout else []) + [PDF, "-"]
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout

num = lambda s: int(s.replace(",", ""))

# ---- career leader tables -------------------------------------------------------------
TITLES = {
    "GAMES PLAYED": "gp", "MINUTES PLAYED": "min", "POINTS": "pts", "FIELD GOALS MADE": "fgm",
    "FREE THROWS MADE": "ftm", "3-PT. FIELD GOALS MADE": "fg3m", "OFFENSIVE REBOUNDS": "oreb",
    "DEFENSIVE REBOUNDS": "dreb", "TOTAL REBOUNDS": "reb", "ASSISTS": "ast", "STEALS": "stl",
    "BLOCKED SHOTS": "blk",
    # per-game tables carry games and a total: kept as extra totals
    "REBOUNDS PER GAME": "reb/g", "ASSISTS PER GAME": "ast/g", "STEALS PER GAME": "stl/g",
    "BLOCKED SHOTS PER GAME": "blk/g", "SCORING AVERAGE": "pts/g",
}
NAME = r"[A-Z][A-Za-z.’'\-]*(?: (?:[A-Z][A-Za-z.’'\-]*|[A-Z]\.|Jr\.|II|III|IV|[a-z]{2,3}(?= [A-Z])))*"
ROW = re.compile(r"(" + NAME.replace("A-Za-z", "A-Za-zÀ-ž") + r")\s+((?:\d[\d,]*(?:\.\d+)?\s*){1,5})")

def tables(pages):
    out = {}  # stat -> [(name, value, extra)]
    for p in pages:
        headers = []
        for line in page_text(p).splitlines():
            if not line.strip() or "FACTS & FIGURES" in line or "CAREER STATISTICAL" in line: continue
            segs = [(m.start(), m.group(0).strip()) for m in re.finditer(r"\S+(?: \S+)*", line)]
            if all(s in TITLES or re.search(r"PERCENTAGE|ATTEMPTED|SEASONS PLAYED", s) for _, s in segs):
                headers = segs
                continue
            if not headers or line.lstrip().startswith(("PLAYER", "(Minimum")): continue
            for m in ROW.finditer(line):
                name, nums = m.group(1).strip(), [x for x in m.group(2).split()]
                col = min(headers, key=lambda h: abs(h[0] - m.start()))
                stat = TITLES.get(col[1])
                if not stat: continue
                if "/" not in stat:
                    if len(nums) != 1: continue
                    out.setdefault(stat, []).append({"name": name, "value": num(nums[0])})
                elif stat == "pts/g" and len(nums) == 5:
                    g, fgm, ftm, pts = (num(x) for x in nums[:4])
                    for k, v in (("gp", g), ("fgm", fgm), ("ftm", ftm), ("pts", pts)):
                        out.setdefault("extra:" + k, []).append({"name": name, "value": v})
                elif stat != "pts/g" and len(nums) == 3:
                    g, tot = num(nums[0]), num(nums[1])
                    out.setdefault("extra:gp", []).append({"name": name, "value": g})
                    out.setdefault("extra:" + stat.split("/")[0], []).append({"name": name, "value": tot})
    return out

alltime = tables([92, 93, 94])
active = tables([95, 96, 97])
for t in (alltime, active):
    for k, v in t.items():
        if not k.startswith("extra:") and len(v) != 10: sys.exit(f"table {k}: {len(v)} rows, expected 10")

# ---- milestone watch -------------------------------------------------------------------
STAT_WORDS = [("three-pointers made", "fg3m"), ("threepointers made", "fg3m"), ("three-point", "fg3m"), ("field goals made", "fgm"), ("free throws made", "ftm"),
              ("offensive rebounds", "oreb"), ("defensive rebounds", "dreb"), ("rebounds", "reb"), ("assists", "ast"),
              ("steals", "stl"), ("blocks", "blk"), ("triple-doubles", "td"), ("games played", "gp"), ("minutes played", "min"),
              ("points", "pts"), ("wins", "wins"), ("victories", "wins")]
FRANCHISE = {"Heat": "MIA", "Suns": "PHX", "Celtics": "BOS"}

def stat_of(text):
    t = text.lower()
    for w, k in STAT_WORDS:
        if w in t: return k
    return None

def paragraphs(pages):
    paras = []
    for p in pages:
        cur = []
        for line in page_text(p, layout=False).splitlines():
            if not line.strip():
                if cur: paras.append((p, " ".join(cur))); cur = []
            else: cur.append(line.strip())
        if cur: paras.append((p, " ".join(cur)))
    return paras

ORD = {w: i + 1 for i, w in enumerate("first second third fourth fifth sixth seventh eighth ninth tenth".split())}
def ordinal(s):
    s = s.lower()
    return ORD.get(s) or int(re.match(r"\d+", s).group(0))

def clean_name(n):
    n = re.sub(r"\s+of the [A-Z].*$", "", n.strip())
    return n.replace("Pay- ton", "Payton").replace("Ja- son", "Jason").replace("Fitzsim- mons", "Fitzsimmons")

WATCH_PLAYERS = ["LeBron James", "Kevin Durant", "James Harden", "Stephen Curry", "Bam Adebayo", "DeMar DeRozan", "Giannis Antetokounmpo",
                 "Devin Booker", "Mike Conley", "Anthony Davis", "Luka Dončić", "Andre Drummond", "Al Horford", "Tim Hardaway Jr.", "Paul George",
                 "Buddy Hield", "Rudy Gobert", "Jrue Holiday", "Kyrie Irving", "Damian Lillard", "Donovan Mitchell", "Jayson Tatum",
                 "Klay Thompson", "Brook Lopez", "CJ McCollum", "Nikola Vučević"]
SURNAME = {}
for n in WATCH_PLAYERS:
    last = re.sub(r" (Jr\.|II|III)$", "", n).split()[-1]
    SURNAME[last] = n

def para_player(text):
    m = re.search(r"\b([A-Z][A-Za-zčć]+) (?:ranks|is tied for|is the all-time leader|begins)", text)
    if m and m.group(1) in SURNAME: return SURNAME[m.group(1)]
    return None

watch = []      # {player, stat, scope, team?, value, rank, page}
targets = []    # {stat, scope, team?, name, value, rank, page, of: player}
rounds = []     # {player, stat, value, page}
checks = []
SEG = re.compile(r"\b([A-Z][A-Za-zčć]+) (?:ranks|is tied for|is the all-time leader)")
for page, ptext in paragraphs(range(76, 83)):
    ptext = re.sub(r"(\w)- (\w)", r"\1\2", ptext)
    # One segment per "<Surname> ranks ..." sentence: a paragraph can carry several stats.
    starts = [m.start() for m in SEG.finditer(ptext)]
    for i, a in enumerate(starts):
        text = ptext[a: starts[i + 1] if i + 1 < len(starts) else len(ptext)]
        who = para_player(text)
        if not who: continue
        own = re.match(r"\w+ (?:ranks|is tied for) (\w+)(?: in| all time in)? (career|[A-Z]\w+ franchise history in) ([a-z\- ]+?) \(([\d,]+)\)", text) \
            or re.match(r"\w+ (is the all-time leader) in ()([a-z ]+?) \(([\d,]+)\)", text)
        if not own: continue
        rank = 1 if own.group(1) == "is the all-time leader" else ordinal(own.group(1))
        stat = stat_of(own.group(3))
        scope_s = own.group(2)
        scope, team = ("franchise", FRANCHISE[scope_s.split()[0]]) if "franchise" in scope_s else ("nba", None)
        if not stat: continue
        base = {"player": who, "stat": stat, "scope": scope, **({"team": team} if team else {}), "value": num(own.group(4)), "rank": rank, "page": page}
        watch.append(base)
        # Players ahead: "No. 3 Jason Kidd (12,091)"
        for m in re.finditer(r"No\. (\d+) ([A-Z][^()]*?) \(([\d,]+)\)", text):
            targets.append({"stat": stat, "scope": scope, **({"team": team} if team else {}),
                            "name": clean_name(m.group(2)), "value": num(m.group(3)), "rank": int(m.group(1)), "page": page, "of": who})
        # Arithmetic checks against the sentence's own numbers.
        for m in re.finditer(r"(?:needs (?:to play )?|and |, )([\d,]+|two|three|nine) (?:[a-z\- ]+? )?to pass No\. \d+ [A-Z][^()]*? \(([\d,]+)\)", text):
            n = {"two": 2, "three": 3, "nine": 9}.get(m.group(1)) or num(m.group(1))
            checks.append((who, stat, base["value"], "pass", n, num(m.group(2))))
        for m in re.finditer(r"([\d,]+) (?:[a-z\- ]+? )?to reach ([\d,]+)", text):
            rounds.append({"player": who, "stat": stat, "scope": scope, "value": num(m.group(2)), "page": page})
            checks.append((who, stat, base["value"], "reach", num(m.group(1)), num(m.group(2))))
        for m in re.finditer(r"(?:–|-) ([\d,]+|one|six) shy of ([\d,]+)", text):
            rounds.append({"player": who, "stat": stat, "scope": scope, "value": num(m.group(2)), "page": page})

# The guide's own slips, checked by hand: the total and the "to pass" figure agree, the "to reach" one is off by one.
ERRATA = {("Rudy Gobert", "dreb", "reach", 532, 8000)}
bad, errata = [], []
for who, stat, have, kind, n, v in checks:
    want = v - have + (1 if kind == "pass" else 0)
    if want != n and (who, stat, kind, n, v) in ERRATA: errata.append(f"{who} {stat}: guide says {n} to {kind} {v:,}, the total ({have:,}) gives {want}"); continue
    if want != n: bad.append(f"{who} {stat}: has {have}, '{n} to {kind} {v}' (expected {want})")
if bad: sys.exit("milestone watch arithmetic doesn't agree:\n  " + "\n  ".join(bad))

# Read by hand from the pages (prose the patterns above don't cover); checked by tests against
# the page text.
MANUAL_WATCH = [
    {"player": "LeBron James", "stat": "wins", "scope": "nba", "value": 1048, "rank": 2, "page": 76},
    {"player": "Stephen Curry", "stat": "pts", "scope": "nba", "value": 26528, "rank": 19, "page": 79},
    {"player": "Stephen Curry", "stat": "ast", "scope": "nba", "value": 6743, "rank": 27, "page": 79},
    {"player": "James Harden", "stat": "ast", "scope": "nba", "value": 8873, "rank": 12, "page": 78},
]
MANUAL_TARGETS = [
    {"stat": "wins", "scope": "nba", "name": "Kareem Abdul-Jabbar", "value": 1074, "rank": 1, "page": 76, "of": "LeBron James"},
    {"stat": "wins", "scope": "nba", "name": "Robert Parish", "value": 1014, "rank": 3, "page": 76},
    {"stat": "wins", "scope": "nba", "name": "Tim Duncan", "value": 1001, "rank": 4, "page": 76},
    {"stat": "pts", "scope": "nba", "name": "Kobe Bryant", "value": 33643, "rank": 4, "page": 77, "of": "Kevin Durant"},
    {"stat": "td", "scope": "nba", "name": "Magic Johnson", "value": 138, "rank": 4, "page": 76, "of": "LeBron James"},
    {"stat": "pts", "scope": "nba", "name": "Dominique Wilkins", "value": 26668, "rank": 18, "page": 79, "of": "Stephen Curry"},
    {"stat": "pts", "scope": "nba", "name": "Oscar Robertson", "value": 26710, "rank": 17, "page": 79, "of": "Stephen Curry"},
    {"stat": "pts", "scope": "nba", "name": "Moses Malone", "value": 27409, "rank": 12, "page": 79, "of": "Stephen Curry"},
    {"stat": "pts", "scope": "nba", "name": "Carmelo Anthony", "value": 28289, "rank": 11, "page": 79, "of": "Stephen Curry"},
    {"stat": "ast", "scope": "nba", "name": "Gary Payton", "value": 8966, "rank": 11, "page": 78, "of": "James Harden"},
]
MANUAL_ROUNDS = [
    {"player": "LeBron James", "stat": "pts", "scope": "nba", "value": 44000, "page": 76},
    {"player": "LeBron James", "stat": "pts", "scope": "nba", "value": 45000, "page": 76},
    {"player": "LeBron James", "stat": "fgm", "scope": "nba", "value": 16000, "page": 76},
    {"player": "LeBron James", "stat": "ftm", "scope": "nba", "value": 9000, "page": 76},
    {"player": "LeBron James", "stat": "blk", "scope": "nba", "value": 1200, "page": 76},
    {"player": "Kevin Durant", "stat": "ftm", "scope": "nba", "value": 8000, "page": 77},
    {"player": "James Harden", "stat": "pts", "scope": "nba", "value": 30000, "page": 78},
    {"player": "Stephen Curry", "stat": "ast", "scope": "nba", "value": 7000, "page": 79},
    {"player": "Stephen Curry", "stat": "reb", "scope": "nba", "value": 5000, "page": 79},
    {"player": "Luka Dončić", "stat": "td", "scope": "nba", "value": 100, "page": 80},
]
watch += [w for w in MANUAL_WATCH if not any(x["player"] == w["player"] and x["stat"] == w["stat"] for x in watch)]
targets += MANUAL_TARGETS
rounds += MANUAL_ROUNDS

def dedupe(rows, key):
    seen, out = set(), []
    for r in rows:
        k = key(r)
        if k in seen: continue
        seen.add(k); out.append(r)
    return out
full = {}
for rows in alltime.values():
    for r in rows: full.setdefault(re.sub(r" (Jr\.|II|III)$", "", r["name"]).split()[-1], set()).add(r["name"])
for t in targets:
    if " " not in t["name"]:
        names = full.get(t["name"], set())
        if len(names) != 1: sys.exit(f"target '{t['name']}' ({t['stat']}, page {t['page']}): can't tell who")
        t["name"] = names.pop()
watch = dedupe(watch, lambda r: (r["player"], r["stat"], r["scope"]))
targets = dedupe(targets, lambda r: (r["name"], r["stat"], r["scope"], r.get("team")))
rounds = dedupe(rounds, lambda r: (r["player"], r["stat"], r["value"]))

# ---- coaches (page 83) -----------------------------------------------------------------
coach_text = page_text(83)
coaches = []
for row in re.finditer(r"^\s+(\d+)\s+([A-Z][A-Za-z .]+?)\s{2,}([\d,]+)\s*$", coach_text, re.M):
    coaches.append({"stat": "wins", "rank": int(row.group(1)), "name": row.group(2).strip().title() if row.group(2).isupper() else row.group(2).strip(), "value": num(row.group(3))})
COACH = [  # active coaches the page follows, with their current team
    {"name": "Rick Carlisle", "team": "IND", "wins": 1012, "games": 1935},
    {"name": "Erik Spoelstra", "team": "MIA", "wins": 830, "games": 1441},
    {"name": "Steve Kerr", "team": "GSW", "wins": 604},
]
COACH_TARGETS = [
    {"stat": "games", "name": "Dick Motta", "value": 1952, "rank": 9}, {"stat": "games", "name": "George Karl", "value": 1999, "rank": 8},
    {"stat": "games", "name": "Larry Brown", "value": 2002, "rank": 7},
    {"stat": "wins", "name": "Cotton Fitzsimmons", "value": 832, "rank": 16}, {"stat": "wins", "name": "Jack Ramsay", "value": 864, "rank": 15},
    {"stat": "wins", "name": "Mike Dunleavy", "value": 613, "rank": 27}, {"stat": "wins", "name": "Doug Moe", "value": 628, "rank": 26},
    {"stat": "wins", "name": "Chuck Daly", "value": 638, "rank": 25},
]
COACH_ROUNDS = [{"name": "Rick Carlisle", "stat": "games", "value": 2000}, {"name": "Erik Spoelstra", "stat": "games", "value": 1500}]
flat = re.sub(r"\s+", " ", page_text(83, layout=False))
for c in COACH:
    for k, v in (("wins", c.get("wins")), ("games", c.get("games"))):
        if v is not None and f"({v:,})" not in flat and f"with {v:,}" not in flat: sys.exit(f"coach {c['name']} {k} {v} not on page 83")
for t in COACH_TARGETS:
    if f"{t['name']} ({t['value']:,})" not in flat.replace("Fitzsim- mons", "Fitzsimmons"): sys.exit(f"coach target {t} not on page 83")

# ---- franchise records (page 90) ------------------------------------------------------
franchises = []
for m in re.finditer(r"^([A-Z][A-Za-z0-9 .]+?)\s{2,}([\d,]+)\s+([\d,]+)\s+\.\d{3}", page_text(90), re.M):
    if "*" not in m.group(1) and m.group(1).strip() != "TOTALS": franchises.append({"team": m.group(1).strip(), "w": num(m.group(2)), "l": num(m.group(3))})
if len(franchises) != 30: sys.exit(f"franchise records: {len(franchises)} teams, expected 30")

# ---- team streaks and starts (pages 100-103) ------------------------------------------
LISTS = {
    "MOST CONSECUTIVE GAMES WON, WITHIN A SEASON": "winStreak",
    "MOST CONSECUTIVE GAMES WON, START OF SEASON": "startUnbeaten",
    "MOST GAMES WON, WITH ONE LOSS, START OF SEASON": "start1",
    "MOST GAMES WON, WITH TWO LOSSES, START OF SEASON": "start2",
    "MOST GAMES WON, WITH THREE LOSSES, START OF SEASON": "start3",
    "MOST CONSECUTIVE HOME GAMES WON, START OF SEASON": "homeStart",
    "MOST CONSECUTIVE HOME GAMES WON, WITHIN A SEASON": "homeStreak",
    "MOST CONSECUTIVE ROAD GAMES WON, START OF SEASON": "roadStart",
    "MOST CONSECUTIVE ROAD GAMES WON, WITHIN A SEASON": "roadStreak",
}
team_records = {}
for p in (100, 101, 102, 103):
    cur = None
    for line in page_text(p).splitlines():
        s = line.strip()
        if s in LISTS: cur = LISTS[s]; team_records[cur] = []; continue
        if s.startswith("MOST CONSECUTIVE") or s.startswith("MOST GAMES"): cur = None; continue
        if not cur: continue
        m = re.match(r"(\d+)(?:-(\d+))?\s{2,}([A-Z][A-Za-z0-9. ]+?)\s{2,}(\S.*?)\s*$", s)
        if not m: continue
        rest = re.split(r"\s{2,}", m.group(4))
        team_records[cur].append({"w": int(m.group(1)), **({"l": int(m.group(2))} if m.group(2) else {}), "team": m.group(3).strip(), "when": rest[0]})
for k in LISTS.values():
    if len(team_records.get(k, [])) < 5: sys.exit(f"team records {k}: {len(team_records.get(k, []))} rows")

json.dump({
    "source": "2026-27 NBA Tip-Off Guide (NBA Communications, 10/8/26): totals through 2025-26, regular season",
    "season": "2026-27", "asOf": "2026-10-01",
    "alltime": {k: v for k, v in alltime.items() if not k.startswith("extra:")},
    "active": {k: v for k, v in active.items() if not k.startswith("extra:")},
    "extra": {k[6:]: alltime.get(k, []) + active.get(k, []) for k in sorted(set(alltime) | set(active)) if k.startswith("extra:")},
    "watch": watch, "targets": targets, "rounds": rounds, "errata": errata,
    "coaches": {"wins": coaches, "watch": COACH, "targets": COACH_TARGETS, "rounds": COACH_ROUNDS},
    "franchises": franchises, "teamRecords": team_records,
}, open(OUT, "w"), ensure_ascii=False, indent=1)
print(f"alltime {len(alltime)} lists, active {len(active)} lists; watch {len(watch)} totals, {len(targets)} players ahead, {len(rounds)} round marks, "
      f"{len(checks)} arithmetic checks ok; {len(coaches)} coaches; {len(franchises)} franchises; {sum(len(v) for v in team_records.values())} team-record rows")
