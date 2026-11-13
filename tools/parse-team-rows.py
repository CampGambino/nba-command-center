import re, json, sys, collections
# Every team-by-team regular-season player row of the NBA Guide's year-by-year pages, any era, with its team.
TOK = {"G": "g", "MIN": "min", "FGM": "fgm", "FGA": "fga", "3PM": "fg3m", "3PA": "fg3a", "FTM": "ftm", "FTA": "fta", "ORB": "oreb", "OFF": "oreb", "DRB": "dreb", "DEF": "dreb",
       "REB": "reb", "TOT": "reb", "TRB": "reb", "AST": "ast", "PF": "pf", "DQ": "dq", "STL": "stl", "TO": "tov", "BLK": "blk", "PTS": "pts", "AVG": "avg", "HI": "hi",
       "PCT": "pct", "FG%": "pct", "3P%": "pct", "FT%": "pct"}
def split_glued(w):
    # "FGAFG%" -> ["FGA", "FG%"]: a header word that is several column labels printed without spaces
    u = w.rstrip(".").upper()
    if u in TOK: return [u]
    best = {0: []}
    for i in range(len(u)):
        if i not in best: continue
        for k in TOK:
            if u.startswith(k, i) and (i + len(k)) not in best: best[i + len(k)] = best[i] + [k]
    return best.get(len(u))
def header(line):
    s = re.sub(r"\.{2,}", " ", line).strip()
    if not re.match(r"^(Player\b|G\s+Min)", s): return None
    toks = [t.rstrip(".").upper() for t in s.split()[1 if s.startswith("Player") else 0:]]
    cols = [TOK.get(t) for t in toks]
    return cols if "g" in cols and "pts" in cols else None
ROW = re.compile(r"^\s*((?:[A-Z][A-Za-zÀ-ž.’'\- ]*?(?:[A-Za-z]|\b(?:Jr|Sr)\.))|76ERS)\s*(\(.\)|[†‡*#^@]+)?\s*(?:\.{2,}\s*|\s+)((?:(?:\d[\d.,]*|\.\d+|---|\.\.\.?)\s+)*(?:\d[\d.,]*|\.\d+|---|\.\.\.?))\s*$")
out, unknown = [], collections.Counter()
for path in sys.argv[1:-1]:
    pages = open(path, encoding="utf-8").read().split("\f")
    team, season = None, None
    for p in pages:
        h = re.search(r"(\d{4}-\d{2}) Review: ([A-Za-z/ -]+)", p)
        if h:
            season = h.group(1) if h.group(2).strip().startswith("Regular Season") else None
        if not season: continue
        lines = p.splitlines()
        # A name printed alone with its numbers on the next line ("Jim Les" / "<tab> 24 188 ..."): join them.
        for k in range(len(lines) - 1):
            if re.fullmatch(r"[A-Z][A-Za-z.’'\-]+(?: [A-Z][A-Za-z.’'\-]+){1,3}\s*", lines[k]) and re.match(r"^\s+\d", lines[k + 1]) and not lines[k].isupper():
                lines[k], lines[k + 1] = lines[k].rstrip() + " " + lines[k + 1].strip(), ""
        cols = None
        carry = ""
        k = 0
        while k < len(lines):
            line = lines[k]; s = line.strip()
            if s == "PLAYOFFS": break
            if re.match(r"^(Player\b|G\s+Min)", re.sub(r"\.{2,}", " ", s)):
                # a header can be broken over several lines (1990-91, 2018-19) or glued to the next name ("Pts.Avg.Bob")
                toks, caps, j = [], [], k
                while j < len(lines) and j < k + 9:
                    if j > k and ROW.match(re.sub(r"\.\s\.\s\.", "...", lines[j])): break
                    # words with their column, so labels spread over several lines (1991-92 Portland) go in page order
                    words = []
                    for m in re.finditer(r"\S+", lines[j]):
                        t = re.sub(r"%(?=[0-9A-Z])", "% ", re.sub(r"\.(?=[A-Z])", ". ", re.sub(r"\.{2,}", " ", m.group(0)))).strip()
                        for i, w in enumerate(t.split()):
                            for i2, w2 in enumerate(split_glued(w) or [w] if not re.fullmatch(r"[A-Z][a-z]+", w) else [w]):
                                words.append((m.start() + i * 0.1 + i2 * 0.01, w2))
                    lt = [TOK.get(w.rstrip(".").upper()) for _, w in words]
                    if j > k and "g" in lt and "pts" in lt: j += 1; continue   # a second copy of the header
                    for pos, w in words:
                        if w == "Player": continue
                        key = w.rstrip(".").upper()
                        if key in TOK: toks.append((pos, j, TOK[key]))
                        elif re.fullmatch(r"[A-Z][A-Z.'&/-]*|76ERS", w): caps.append(w)
                        elif re.fullmatch(r"[A-Z][a-z]+", w) and j == k: carry = w
                    j += 1
                # Two readings of a header spread over lines: line by line, or by column. Keep the one the first
                # player's numbers agree with (points = 2 FGM + 3PM + FTM; rebounds = offensive + defensive).
                by_line = [c for _, _, c in sorted(toks, key=lambda x: (x[1], x[0]))]
                by_col = [c for _, _, c in sorted(toks)]
                toks = by_line
                if j - k > 2 and by_col != by_line and j < len(lines):
                    m0 = ROW.match(re.sub(r"\.\s\.\s\.", "...", lines[j]))
                    def fits(cs):
                        if not m0: return False
                        v = {c: int(x.replace(",", "")) for c, x in zip(cs, m0.group(3).split()) if c and re.fullmatch(r"[\d,]+", x)}
                        okp = all(c in v for c in ("fgm", "ftm", "pts")) and v["pts"] == 2 * v["fgm"] + v["ftm"] + v.get("fg3m", 0)
                        okr = not all(c in v for c in ("oreb", "dreb", "reb")) or v["reb"] == v["oreb"] + v["dreb"]
                        return okp and okr
                    if not fits(by_line) and fits(by_col): toks = by_col
                if "g" in toks and "pts" in toks:
                    cols = toks
                    if caps: team = " ".join(caps)
                    else:
                        for jj in range(k - 1, max(-1, k - 5), -1):
                            t = lines[jj].strip()
                            if re.fullmatch(r"[A-Z][A-Z .'&/-]{3,}(?:76ERS)?[A-Z .'&/-]*", t) and len(t) > 6 and not re.search(r"REBOUNDS|SCORING|REVIEW|STATISTICS", t): team = t; break
                    k = j
                    continue
            k += 1
            if not cols or not team: continue
            m = ROW.match(re.sub(r"\.\s\.\s\.", "...", line))   # 1970s pages print a missing stat as ". . ."
            if not m: continue
            name, mark, vals = m.group(1).strip(), (m.group(2) or ""), m.group(3).split()
            if carry: name, carry = carry + " " + name, ""
            if name.lower() in ("totals", "team", "team totals") or len(vals) < len(cols) - 2: continue
            rec = {"season": season, "team": team, "name": name, "mark": mark}
            for c, v in zip(cols, vals):
                if c and c not in ("pct", "avg") and re.fullmatch(r"[\d,]+", v): rec[c] = int(v.replace(",", ""))
            if "g" in rec and "pts" in rec: out.append(rec)
json.dump(out, open(sys.argv[-1], "w"), ensure_ascii=False)
c = collections.Counter(r["season"] for r in out)
print(len(out), "rows;", len(c), "seasons", min(c), "-", max(c), "; teams:", len({(r['team']) for r in out}), "; marks:", collections.Counter(r["mark"] for r in out))
