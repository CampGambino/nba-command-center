"""
The Cavaliers' results by season, from the picture pages of their guide -> tools/cavaliers-results-ocr.json (0.92).

  python3 tools/read-cavaliers-results.py <folder of OCR text, one file a results page: c-232.txt …> src/data/nba-team-seasons-2026-27.json tools/cavaliers-results-ocr.json

The guide's history pages (PDF pp. 231 on) are images: a season page, then "Cleveland Cavaliers Results" with every
game. The user sent pp. 231-232 on 11/17/26. Each results page (even pages 232 to 342) was rendered from the PDF
(pdftoppm -r 300 -gray), cropped to the columns Date to Record, and read with tesseract (--psm 6); the file's first line
names the season (page 232 is 1970-71, two pages a season). OCR misreads a letter or a slash here and there, so each row is taken from its numbers: the two
scores and the running record, which says who won; a date that did not survive is filled in between its neighbours and
marked. Whether a season adds up to the franchise's record is reported; the build decides what to use.
"""
import glob, json, os, re, sys

ROW = re.compile(r"^(?P<date>\S{1,7})\s+(?P<opp>(?:[@©®]\s*)?[A-Za-z][A-Za-z.'’/\- ]*?(?:\s*[@©®]\s*[A-Za-z. ]+?)?)\s*(?:\(\s*\d?\s*[O0o]\s*[T7]\s*\)\s*)?\s+(?P<wl>[WLwlIi1|][Ww]{0,2})\s+(?P<pf>\S{1,3})\s+(?P<pa>\S{1,3})\*?(?:\s+(?P<rec>\S+))?")

def candidates(tok):
    """The dates an OCR'd token could be. A clean "11/14" is itself; "1114" is 11/14 with the slash lost or 11/4 with
    the slash read as a 1; "37" may be 3/7 or 3/17."""
    m = re.match(r"^(\d{1,2})/(\d{1,2})$", tok)
    if m and 1 <= int(m.group(1)) <= 12 and 1 <= int(m.group(2)) <= 31: return [(int(m.group(1)), int(m.group(2)))]
    s = re.sub(r"\D", "", tok.replace("O", "0").replace("o", "0").replace("l", "1").replace("I", "1").replace("N", "1").replace("n", "1").replace("t", "1").replace("T", "7"))
    out = set()
    for mo in range(1, 13):
        for d in range(1, 32):
            a, b = str(mo), str(d)
            forms = {a + b, a + "1" + b}
            for f in list(forms):
                for i, ch in enumerate(f):
                    if ch == "1": forms.add(f[:i] + f[i + 1:])
            if s in forms: out.add((mo, d))
    return sorted(out)

def main():
    src, official_file, out_file = sys.argv[1:4]
    official = {s: (w, l) for s, w, l in json.load(open(official_file))["teams"]["CLE"]}
    seasons = {}
    for f in sorted(glob.glob(os.path.join(src, "c-*.txt")), key=lambda x: int(re.search(r"(\d+)", os.path.basename(x)).group(1))):
        text = open(f, encoding="utf8", errors="replace").read()
        season = re.match(r"SEASON \S* CALC (\S+)", text).group(1)      # one results page a season from p. 232 (1970-71)
        rows = []
        for line in text.split("\n")[1:]:
            m = ROW.match(line.strip())
            if not m: continue
            if not re.match(r"^\d", m.group("date")) and not candidates(m.group("date")): continue
            num = lambda x: int(x) if re.fullmatch(r"\d{2,3}", x) else 0
            pf, pa = num(m.group("pf")), num(m.group("pa"))
            if not (pf and pa): pf = pa = 0                                  # a score OCR could not read: the letter still says who won
            r = re.fullmatch(r"(\d{1,2})\s*[-:.–—~=]\s*(\d{1,2}),?", m.group("rec") or "")
            rows.append({"tok": m.group("date"), "raw": re.sub(r"^[©®]", "@", m.group("opp").strip()), "pf": pf, "pa": pa, "letter": m.group("wl")[0] in "Ww",
                         "rec": (int(r.group(1)), int(r.group(2))) if r else None})
        seasons[season] = rows
    out = {}; report = []
    for season, rows in sorted(seasons.items()):
        want = official.get(season)
        if not want: continue
        # Regular season only: stop once the record reaches the franchise's.
        prev = (0, 0); games = []
        for r in rows:
            won = r["letter"] if r["pf"] == r["pa"] else r["pf"] > r["pa"]
            if r["rec"] == (prev[0] + 1, prev[1]): won = True
            elif r["rec"] == (prev[0], prev[1] + 1): won = False
            prev = (prev[0] + won, prev[1] + (not won))
            games.append({**r, "won": won})
            if prev == want or len(games) == sum(want): break               # the playoff games follow on the same page
        w = sum(g["won"] for g in games); l = len(games) - w
        ok = (w, l) == want
        # Dates: each token's possible readings, kept in order between the clean dates around it.
        import datetime
        y0 = int(season[:4]); fixed = 0
        def iso(md): return f"{y0 if md[0] >= 9 else y0 + 1}-{md[0]:02d}-{md[1]:02d}"
        def real(md):
            try: datetime.date.fromisoformat(iso(md)); return True
            except ValueError: return False
        cands = [[c for c in candidates(g["tok"]) if real(c)] for g in games]
        clean = [iso(c[0]) if len(c) == 1 and re.match(r"^\d{1,2}/\d{1,2}$", games[i]["tok"]) else None for i, c in enumerate(cands)]
        last = None
        for i, g in enumerate(games):
            nxt = next((clean[j] for j in range(i + 1, len(games)) if clean[j] and (not last or clean[j] > last)), None)
            ok_ = [iso(c) for c in cands[i] if (not last or iso(c) > last) and (not nxt or iso(c) < nxt)]
            if clean[i] and (not last or clean[i] > last): d = clean[i]
            elif len(ok_) == 1: d = ok_[0]
            elif ok_: d = sorted(ok_)[0]; g["guess"] = True; fixed += 1
            else: d = (datetime.date.fromisoformat(last) + datetime.timedelta(days=1)).isoformat() if last else f"{y0}-10-15"; g["guess"] = True; fixed += 1
            g["iso"] = d; last = d
        report.append(f"{season}: {len(games)} games {w}-{l} (franchise {want[0]}-{want[1]}){'' if ok else '  short'}{f'; {fixed} dates uncertain' if fixed else ''}")
        out[season] = [[g["iso"], g["raw"], 1 if g["won"] else 0, g["pf"], g["pa"], 1 if g.get("guess") else 0] for g in games]
    print("\n".join(report))
    json.dump({"note": "The Cavaliers' regular-season results as their guide's picture pages print them, read by OCR (tools/read-cavaliers-results.py). A season that is a game or two short is kept too: the build uses a season only if it adds up, alone or with the opponents' lists. A row: date, opponent as printed, won, Cleveland's points, opponent's, 1 if the date was filled in.",
               "seasons": out}, open(out_file, "w"), separators=(",", ":"))
    print(sum(1 for s_ in report if "short" not in s_), "of", len(report), "seasons add up on their own")
main()
