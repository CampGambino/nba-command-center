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
        "SUNS": "PHX", "TRAIL BLAZERS": "POR", "BLAZERS": "POR", "CAVS": "CLE", "WOLVES": "MIN", "MAVS": "DAL", "KINGS": "SAC", "SPURS": "SAS", "RAPTORS": "TOR", "JAZZ": "UTA", "WIZARDS": "WAS"}
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

def nick_of(name):
    name = name.strip().upper()
    return next((t for n, t in sorted(NICK.items(), key=lambda kv: -len(kv[0])) if name.endswith(n) or name.startswith(n)), None)

def city_of(name):
    n = re.sub(r"[^a-z. ]", "", name.strip().lower()).strip()
    n = {"la clippers": "l.a. clippers", "los angeles clippers": "l.a. clippers", "la lakers": "l.a. lakers", "los angeles lakers": "l.a. lakers", "okla. city": "oklahoma city", "l.a. clippers": "l.a. clippers"}.get(n, n)
    return CITY.get(n)

def sgn(word, n):
    return (1 if word[0].upper() == "W" else -1) * int(n)

def parse_sas(text):
    """San Antonio: "SPURS-HAWKS SERIES NOTES / OVERALL RECORD: 62-45 HOME: 38-16 ROAD: 24-29 / CURRENT STREAK: Won 4 HOME: W 2 ROAD: W 2 / SPURS LAST WIN AT HOME: … on 11/20/25"."""
    out = {}
    for m in re.finditer(r"SPURS-([A-Z0-9 ]+?) SERIES NOTES", text):
        opp = nick_of(m.group(1)); blk = text[m.end():m.end() + 2600]
        r = re.search(r"OVERALL RECORD:\s*(\d+)-(\d+)\s+HOME:\s*(\d+)-(\d+)\s+ROAD:\s*(\d+)-(\d+)", blk)
        if not opp or not r or opp in out: continue
        v = list(map(int, r.groups()))
        rec = {"overall": {"w": v[0], "l": v[1]}, "home": {"w": v[2], "l": v[3]}, "road": {"w": v[4], "l": v[5]}}
        # Its streak and last-win lines are not kept: checked against our results, 21 of them were out of date.
        # The season-by-season list under it ("76-77: ATL 4-0 … 25-26: SA 2-0") shows how far the row runs: a list that
        # stops at 24-25 is a row not brought up to date, and last season's meetings are added from our results (in main).
        lst = blk[blk.find("ALL-TIME RESULTS"):][:2200] if "ALL-TIME RESULTS" in blk else ""
        lst = lst[:lst.find("TOTALS")] if "TOTALS" in lst else lst
        if "24-25:" in lst and "25-26:" not in lst: rec["through"] = "2024-25"
        out[opp] = rec
    return out

def parse_tor(text):
    """Toronto: "All-Time Record vs. Atlanta....59-54 (.522)" then Home and Road Record lines."""
    out = {}
    for m in re.finditer(r"All-Time Record vs\. ([A-Za-z. ]+?)\.{2,}\s*(\d+)-(\d+)", text):
        opp = city_of(m.group(1)); blk = text[m.end():m.end() + 700]
        h = re.search(r"Home Record vs\. [A-Za-z. ]+?\.{2,}\s*(\d+)-(\d+)", blk); r = re.search(r"Road Record vs\. [A-Za-z. ]+?\.{2,}\s*(\d+)-(\d+)", blk)
        if not opp or opp in out: continue
        rec = {"overall": {"w": int(m.group(2)), "l": int(m.group(3))}}
        if h: rec["home"] = {"w": int(h.group(1)), "l": int(h.group(2))}
        if r: rec["road"] = {"w": int(r.group(1)), "l": int(r.group(2))}
        out[opp] = rec
    return out

def parse_cha(text):
    """Charlotte: on each opponent's page, "HEAD-TO-HEAD RECORD / All-Time....68-74 / Home....40-30 / Road....28-44". The 29 pages run in alphabetical order."""
    out = {}
    order = ["ATL", "BOS", "BKN", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"]
    blocks = []
    for m in re.finditer(r"HEAD-TO-HEAD RECORD", text):
        blk = text[m.end():m.end() + 1500]
        a = re.search(r"All-Time\.{2,}\s*(\d+)-(\d+)", blk); h = re.search(r"Home\.{2,}\s*(\d+)-(\d+)", blk); r = re.search(r"Road\.{2,}\s*(\d+)-(\d+)", blk)
        if a: blocks.append((a, h, r, text[m.end():m.end() + 9000]))
    if len(blocks) != len(order): return out
    for opp, (a, h, r, body) in zip(order, blocks):
        # The order is checked against the cities in the game list under each block, where the city is unambiguous.
        sites = [city_of(x) for x in re.findall(r"\bat ([A-Z][A-Za-z. ]+?)\s+[WL]\b", body[:body.find("HEAD-TO-HEAD RECORD") if "HEAD-TO-HEAD RECORD" in body else 9000])]
        sites = [x for x in sites if x and x != "CHA"]
        if sites and opp not in ("LAC", "LAL", "BKN", "MEM", "OKC") and max(set(sites), key=sites.count) != opp: return {}
        rec = {"overall": {"w": int(a.group(1)), "l": int(a.group(2))}}
        if h: rec["home"] = {"w": int(h.group(1)), "l": int(h.group(2))}
        if r: rec["road"] = {"w": int(r.group(1)), "l": int(r.group(2))}
        out[opp] = rec
    return out

def parse_mem(text):
    """Memphis: one "ALL-TIME SERIES" table, a conference in each half: name, then W L overall, home, road."""
    out = {}
    i = text.find("ALL-TIME SERIES\n")
    for m in re.finditer(r"([A-Z][A-Za-z. ]+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)(?=\s|$)", text[i:i + 9000] if i >= 0 else ""):
        opp = city_of(m.group(1))
        if not opp or opp in out: continue
        v = list(map(int, m.groups()[1:]))
        out[opp] = {"overall": {"w": v[0], "l": v[1]}, "home": {"w": v[2], "l": v[3]}, "road": {"w": v[4], "l": v[5]}}
    return out

def parse_hou(text):
    """Houston: "Regular Season Record vs. Opponents", two teams a line: Total, Home, Road, Neut. Indented rows are a former city's share and are skipped."""
    out = {}
    i = text.find("Regular Season Record vs. Opponents")
    lines = text[i:i + 12000].split("\n") if i >= 0 else []
    head = next((l for l in lines if l.count("Team") == 2), None)
    if not head: return out
    p2 = head.rfind("Team")
    row = re.compile(r"^(\S[A-Za-z. /]*?)\s+(\d+)-(\d+)\s+(\d+)-(\d+)\s+(\d+)-(\d+)\s+(\d+)-(\d+)")
    for l in lines[lines.index(head) + 1:lines.index(head) + 60]:
        for half in (l[:p2], l[p2 - 1:] if len(l) > p2 else ""):
            if half[:2] == "  " and half is not l[:p2] and half[1:2] == " ": continue
            m = row.match(half.lstrip(" ") if half is not l[:p2] and not half.startswith("  ") else half)
            if not m: continue
            opp = city_of(m.group(1))
            if not opp or opp in out: continue
            v = list(map(int, m.groups()[1:]))
            out[opp] = {"overall": {"w": v[0], "l": v[1]}, "home": {"w": v[2], "l": v[3]}, "road": {"w": v[4], "l": v[5]}, "neutral": {"w": v[6], "l": v[7]}}
    return out

def parse_phi(text):
    """
    Philadelphia: on each opponent's page, "ALL-TIME SERIES RESULTS" with Overall, Home, Away, Neutral; the opponent
    is named in "<Nick> Largest Margin of Victory". The values sit on the label's line or the one after it, with the
    76ers' own 2025-26 record (the same three numbers on every page) printed among them, so the block is read as:
    every W-L between the label column and the playoff column, minus those three, in order, kept only if it adds up.
    """
    out = {}; blocks = []
    for m in re.finditer(r"ALL-TIME SERIES RESULTS", text):
        blk = text[m.end():m.end() + 5000]
        end = blk.find("ALL-TIME SERIES INFORMATION")
        who = re.search(r"76ers Largest Margin of Victory.*?\s{2,}([A-Za-z0-9 ]+?) Largest Margin of Victory", blk)
        opp = nick_of(who.group(1)) if who else None
        lines = blk[:end].split("\n") if end > 0 else []
        cols = sorted({mm.start() for l in lines for mm in re.finditer(r"(?i)overall", l)})   # the label column, then the playoff column
        if not opp or not cols: continue
        c0 = cols[0]; c1 = next((c for c in cols if c > c0 + 20), c0 + 70)
        toks = [x for l in lines for x in re.findall(r"(?<![\d/])(\d{1,3})-(\d{1,3})(?![\d/])", l[max(c0 - 4, 0):c1 - 2])]
        blocks.append((opp, [tuple(map(int, x)) for x in toks]))
    from collections import Counter
    seen = Counter(t for _, toks in blocks for t in set(toks))
    noise = {t for t, n in seen.items() if n >= 0.7 * len(blocks)}
    for opp, toks in blocks:
        v = [t for t in toks if t not in noise]
        if opp in out or len(v) < 3: continue
        o, h, a = v[0], v[1], v[2]; n = v[3] if len(v) > 3 else (0, 0)
        if (h[0] + a[0] + n[0], h[1] + a[1] + n[1]) != o: continue
        rec = {"overall": {"w": o[0], "l": o[1]}, "home": {"w": h[0], "l": h[1]}, "road": {"w": a[0], "l": a[1]}}
        if len(v) > 3: rec["neutral"] = {"w": n[0], "l": n[1]}
        out[opp] = rec
    return out

def parse_lac(text):
    """LA Clippers: "SERIES HISTORY … HAWKS 2025-26 REVIEW" then "All Time: 53-83 (31-36, 22-47)" (home, road) and the streaks."""
    out = {}
    for m in re.finditer(r"SERIES HISTORY\s+([A-Z0-9 ]+?) 2025-26 REVIEW", text):
        opp = nick_of(m.group(1)); blk = text[m.end():m.end() + 6000]
        a = re.search(r"All Time:\s*(\d+)-(\d+)\s*\((\d+)-(\d+),\s*(\d+)-(\d+)\)", blk)
        if not opp or not a or opp in out: continue
        v = list(map(int, a.groups()))
        rec = {"overall": {"w": v[0], "l": v[1]}, "home": {"w": v[2], "l": v[3]}, "road": {"w": v[4], "l": v[5]}}
        for word, key in (("Overall", "overall"), ("Home Streak", "home"), ("Road Streak", "road")):
            st = re.search(word + r":\s*(Won|Lost)\s+(\d+)", blk[:2500])
            if st: rec[key]["streak"] = sgn(st.group(1), st.group(2))
        out[opp] = rec
    return out

def parse_nop(text):
    """New Orleans: "New Orleans vs. Atlanta Franchise Series Notes / Overall Record: 22-27 Home Record: 13-12 Road Record: 9-15 / Current Streak: Lost 4 Home: Lost 3 Road: Lost 2"."""
    out = {}
    for m in re.finditer(r"New Orleans vs\. ([A-Za-z. ]+?) Franchise Series Notes", text):
        opp = city_of(m.group(1)); blk = text[m.end():m.end() + 900]
        r = re.search(r"Overall Record:\s*(\d+)-(\d+).*?Home Record:\s*(\d+)-(\d+).*?Road Record:\s*(\d+)-(\d+)", blk)
        if not opp or not r or opp in out: continue
        v = list(map(int, r.groups()))
        rec = {"overall": {"w": v[0], "l": v[1]}, "home": {"w": v[2], "l": v[3]}, "road": {"w": v[4], "l": v[5]}}
        st = re.search(r"Current Streak:\s*(Won|Lost)\s+(\d+)\s+Home:\s*(Won|Lost)\s+(\d+)\s+Road:\s*(Won|Lost)\s+(\d+)", blk)
        if st:
            rec["overall"]["streak"] = sgn(st.group(1), st.group(2)); rec["home"]["streak"] = sgn(st.group(3), st.group(4)); rec["road"]["streak"] = sgn(st.group(5), st.group(6))
        out[opp] = rec
    return out

def parse_mia(text):
    """Miami: each opponent's game list is headed "HEAT VS. HAWKS (84-62, HOME: 53-21, AWAY: 31-41)"."""
    out = {}
    for m in re.finditer(r"HEAT VS\. ([A-Z0-9 ]+?) \((\d+)-(\d+), HOME: (\d+)-(\d+), AWAY: (\d+)-(\d+)\)", text):
        opp = nick_of(m.group(1))
        if not opp or opp in out: continue
        v = list(map(int, m.groups()[1:]))
        out[opp] = {"overall": {"w": v[0], "l": v[1]}, "home": {"w": v[2], "l": v[3]}, "road": {"w": v[4], "l": v[5]}}
    return out

def parse_okc(text):
    """Oklahoma City: "ALL-TIME OKLAHOMA CITY VS. ATLANTA", a row a season, then "Totals 12-5 9-8 -- 21-13" (home, away, neutral, total). Oklahoma City years only."""
    out = {}
    for m in re.finditer(r"ALL-TIME OKLAHOMA CITY VS\.\s+([A-Z. ]+?)\s*\n", text):
        opp = city_of(m.group(1)); blk = text[m.end():m.end() + 2500]
        t = re.search(r"Totals\s+(\d+)-(\d+)\s+(\d+)-(\d+)\s+(?:(\d+)-(\d+)|\S+)\s+(\d+)-(\d+)", blk)
        if not opp or not t or opp in out: continue
        g = t.groups()
        rec = {"overall": {"w": int(g[6]), "l": int(g[7])}, "home": {"w": int(g[0]), "l": int(g[1])}, "road": {"w": int(g[2]), "l": int(g[3])}}
        if g[4] is not None: rec["neutral"] = {"w": int(g[4]), "l": int(g[5])}
        out[opp] = rec
    return out

def parse_min(text):
    """Minnesota: "ALL-TIME VS. NBA", a season-by-season grid in two parts; the second part's rows end with HOME, ROAD, TOTAL."""
    out = {}
    i = text.find("ALL-TIME VS. NBA"); i = text.find("ALL-TIME VS. NBA", i + 10)
    for l in (text[i:i + 14000].split("\n") if i >= 0 else []):
        m = re.match(r"^\s*([A-Z][A-Za-z. ]+?)\d?\s+\d+-\d+", l)
        pairs = re.findall(r"(\d+)-(\d+)", l)
        if not m or len(pairs) < 8: continue
        opp = city_of(m.group(1))
        if not opp or opp in out: continue
        (hw, hl), (rw, rl), (tw, tl) = [tuple(map(int, x)) for x in pairs[-3:]]
        if hw + rw != tw or hl + rl != tl: continue           # a row that lost a column in the text
        out[opp] = {"overall": {"w": tw, "l": tl}, "home": {"w": hw, "l": hl}, "road": {"w": rw, "l": rl}}
    return out

OWN = {"UTA": parse_uta, "ORL": parse_orl, "IND": parse_ind, "SAS": parse_sas, "TOR": parse_tor, "CHA": parse_cha, "MEM": parse_mem, "HOU": parse_hou, "PHI": parse_phi,
       "LAC": parse_lac, "NOP": parse_nop, "OKC": parse_okc, "MIN": parse_min, "MIA": parse_mia}
# What a guide's own count leaves out or adds, where we know it (the mirror check is how each was found).
NOTE = {"OKC": "Oklahoma City years only (since 2008-09)", "DET": "Detroit years only (since 1957-58)", "DEN": "includes ABA games against the former ABA teams"}
ERA = {"OKC": "2008-09", "DET": "1957-58"}      # a guide whose records start here, not at the franchise's first season

def main():
    d = sys.argv[1]; res = {}
    for f in sorted(glob.glob(os.path.join(d, "*.txt"))):
        name = os.path.basename(f)[8:-16]; tri = FILE.get(name)
        if not tri: print("?", name); continue
        text = open(f, encoding="utf8", errors="replace").read()
        got = (OWN[tri](text) if tri in OWN else {}) or parse(text)
        got.pop(tri, None)
        if got: res[tri] = got
        print(f"{tri} {len(got):2d} opponents")
    # A record that does not add up (home + road + neutral = overall) is marked: a misprint in the guide ("103-43" for 103-143).
    def adds(r):
        if "home" not in r or "road" not in r: return None
        n = r.get("neutral", {"w": 0, "l": 0})
        return r["overall"]["w"] == r["home"]["w"] + r["road"]["w"] + n["w"] and r["overall"]["l"] == r["home"]["l"] + r["road"]["l"] + n["l"]
    for a in res:
        for r in res[a].values():
            if adds(r) is False and "neutral" in r: r["bad"] = True
            elif adds(r) is False and (r["overall"]["w"] < r["home"]["w"] + r["road"]["w"] or r["overall"]["l"] < r["home"]["l"] + r["road"]["l"]): r["bad"] = True
    # Last season's meetings, from our own results: where two guides differ by exactly that season series, one of them
    # either stopped a season early or counted the season twice. That one is corrected, and the correction recorded.
    last = {}
    if len(sys.argv) > 3:
        H = json.load(open(sys.argv[3])); cols = H["columns"]
        for g in H["games"]:
            g = dict(zip(cols, g))
            if g["type"] != 2 or not ("2025-10-01" <= g["date"][:10] <= "2026-04-30") or g["date"][:10] == "2025-12-16": continue
            for t, o, won, home in ((g["home"], g["away"], g["homeScore"] > g["awayScore"], True), (g["away"], g["home"], g["awayScore"] > g["homeScore"], False)):
                x = last.setdefault((t, o), {"w": 0, "l": 0, "hw": 0, "hl": 0, "rw": 0, "rl": 0})
                x["w" if won else "l"] += 1; x[("h" if home else "r") + ("w" if won else "l")] += 1
    fixed = []
    def shift(t, o, sign, why):
        r = res[t][o]; x = last[(t, o)]
        r["overall"]["w"] += sign * x["w"]; r["overall"]["l"] += sign * x["l"]
        if "home" in r: r["home"]["w"] += sign * x["hw"]; r["home"]["l"] += sign * x["hl"]
        if "road" in r: r["road"]["w"] += sign * x["rw"]; r["road"]["l"] += sign * x["rl"]
        r["adjusted"] = why; fixed.append((t, o, why))
    def rate():
        ag = {}
        for a in res:
            for b, r in res[a].items():
                if b in res and a in res[b]:
                    o = res[b][a]["overall"]; x = ag.setdefault(a, [0, 0]); x[1] += 1; x[0] += (r["overall"]["w"], r["overall"]["l"]) == (o["l"], o["w"])
        return {t: v[0] / v[1] for t, v in ag.items() if v[1]}
    base = rate()                                              # how well each guide is backed up before anything is corrected
    # 1. A row its own guide shows stopping at 2024-25 (San Antonio's season lists).
    for t in sorted(res):
        for o in sorted(res[t]):
            if res[t][o].get("through") == "2024-25" and (t, o) in last: shift(t, o, +1, "2025-26 was missing from this row")
    # 2. Two guides that differ by exactly last season's series. The side with fewer games stopped a season early,
    #    unless the side with more is a guide the others rarely back up and the other is not: then that one counted
    #    the season twice (Utah's table, against Boston, Charlotte, Cleveland and Dallas).
    for a in sorted(res):
        for b in sorted(res[a]):
            if not (a < b and b in res and a in res[b]) or (a, b) not in last: continue
            A, B, x = res[a][b]["overall"], res[b][a]["overall"], last[(a, b)]
            dw, dl = A["w"] - B["l"], A["l"] - B["w"]          # how much more a's guide has than b's, from a's side
            if (dw, dl) == (0, 0) or x["w"] + x["l"] == 0: continue
            more, fewer = (a, b) if (dw, dl) == (x["w"], x["l"]) else (b, a) if (dw, dl) == (-x["w"], -x["l"]) else (None, None)
            if not more or "adjusted" in res[more][fewer] or "adjusted" in res[fewer][more]: continue
            if base.get(more, 0) < 0.5 <= base.get(fewer, 0): shift(more, fewer, -1, "2025-26 was counted twice in this row")
            else: shift(fewer, more, +1, "2025-26 was missing from this row")
    # 3. Every other row of a guide whose compared rows were nearly all a season short (Denver's) gets last season
    #    added too, even where no second guide prints the pairing.
    short = {}
    for t, o, why in fixed:
        if "missing" in why: short[t] = short.get(t, 0) + 1
    compared = {t: sum(1 for o in res[t] if o in res and t in res[o]) for t in res}
    whole = {t for t, n in short.items() if n >= 8 and n >= 0.75 * compared[t]}
    for t in sorted(whole):
        for o in sorted(res[t]):
            if "adjusted" not in res[t][o] and (t, o) in last and not (o in res and t in res[o]):
                shift(t, o, +1, "2025-26 added: this guide's rows stop a season early")
    for t in res:
        for r in res[t].values(): r.pop("through", None)
    # A pairing printed from both sides must mirror.
    both = same = 0; bad = []
    for a in res:
        for b, r in res[a].items():
            if a < b and b in res and a in res[b]:
                both += 1; o = res[b][a]
                okm = (r["overall"]["w"], r["overall"]["l"]) == (o["overall"]["l"], o["overall"]["w"])
                same += okm
                if not okm: bad.append((a, b, r["overall"]["w"], r["overall"]["l"], "|", o["overall"]["l"], o["overall"]["w"], "last season", last.get((a, b))))
    print(f"corrected by last season's results: {len(fixed)}", " ".join(f"{t}-{o}" for t, o, _ in fixed), "| whole guide a season short:", sorted(whole))
    # Each record must add up: overall = home + road + neutral.
    addsN = sum(1 for a in res for r in res[a].values() if "away" in r or all(k in r for k in ("home", "road")) and r["overall"]["w"] == r["home"]["w"] + r["road"]["w"] + r.get("neutral", {"w": 0})["w"] and r["overall"]["l"] == r["home"]["l"] + r["road"]["l"] + r.get("neutral", {"l": 0})["l"])
    n = sum(len(v) for v in res.values())
    pairs = {tuple(sorted((a, b))) for a in res for b in res[a]}
    print(f"{len(res)} guides, {n} team-opponent records, {len(pairs)} of 435 pairings covered; {addsN} add up (home + road + neutral); {both} printed from both sides, {same} mirror")
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
                   "guides": {t: {"agree": agree.get(t, [0, 0]), **({"note": NOTE[t]} if t in NOTE else {}), **({"era": ERA[t]} if t in ERA else {})} for t in sorted(res)}, "teams": res}, open(sys.argv[2], "w"), separators=(",", ":"))
main()
