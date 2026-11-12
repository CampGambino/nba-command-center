#!/usr/bin/env python3
"""
Career "MOST <stat>" lists from word positions (pdftotext -bbox): All-Star (NBA Guide pp. 158-159), Play-In (166-167),
playoffs (175-176), Finals (185-186).
  python3 tools/parse-career-lists-bbox.py guide.pdf "allStar:158:159,playIn:166:167,playoffs:175:176,finals:185:186" out.json
Titles are centred over their column: an entry belongs to the lowest title above it within 55 points of its x.
"""
# "MOST <STAT>" career lists from word positions. Every "MOST ..." title opens a list at its x; an entry
# ("Name......value") belongs to the title above it whose x is nearest (column), the lowest such title.
pdf, ranges, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
result = {}
for spec in ranges.split(","):
    book, a, b = spec.split(":")
    xml = subprocess.run(["pdftotext", "-bbox", "-f", a, "-l", b, pdf, "-"], capture_output=True, text=True).stdout
    lists = {}
    for p in xml.split("<page ")[1:]:
        words = [(float(x0), float(y0), html.unescape(w)) for x0, y0, w in re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)</word>', p)]
        rows = {}
        for x, y, w in words: rows.setdefault(round(y / 3), []).append((x, y, w))
        titles, entries = [], []
        for _, ws in sorted(rows.items()):
            ws.sort()
            i = 0
            while i < len(ws):
                x, y, w = ws[i]
                if w == "MOST":
                    j, t = i + 1, ["MOST"]
                    while j < len(ws) and re.fullmatch(r"[A-Z0-9.\-]+", ws[j][2]) and ws[j][2] != "MOST" and ws[j][0] - ws[j - 1][0] < 120: t.append(ws[j][2]); j += 1
                    titles.append((x, y, " ".join(t))); i = j; continue
                # an entry: name words, the last ending in a dot leader (or a separate leader word), then a number
                j, name = i, []
                while j < len(ws) and not re.fullmatch(r"[\d,]+", ws[j][2]):
                    name.append(ws[j][2]); j += 1
                    if re.search(r"\.{2,}$", name[-1]): break
                if j < len(ws) and name and re.search(r"\.{2,}$", name[-1]) and re.fullmatch(r"[\d,]+", ws[j][2]):
                    nm = re.sub(r"\.{2,}$", "", " ".join(name)).strip().rstrip("*").strip()
                    nm = re.sub(r"\.+$", "", nm).strip()
                    if nm: entries.append((x, y, nm, int(ws[j][2].replace(",", ""))))
                    i = j + 1; continue
                i += 1
        for x, y, nm, val in entries:
            above = [t for t in titles if t[1] < y - 1]
            if not above: continue
            col = [t for t in above if abs(t[0] - x) <= 55]   # titles are centred over their column
            if not col: continue
            t = max(col, key=lambda t: t[1])
            lists.setdefault(t[2], []).append({"name": nm, "value": val})
    result[book] = lists
json.dump(result, open(out_path, "w"), ensure_ascii=False, indent=0)
for book, L in result.items(): print(book, {k: len(v) for k, v in L.items()})
