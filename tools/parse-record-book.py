#!/usr/bin/env python3
"""
The Elias record book in the NBA's annual guide (2026-27 NBA Guide, pp. 198-268) -> JSON.

  pdftotext -f 198 -l 216 guide.pdf rs.txt; pdftotext -f 217 -l 268 guide.pdf rest.txt   (reading order, no -layout)
  python3 tools/parse-record-book.py rs.txt rest.txt > src/data/nba-record-book-2026-27.json

Output: [{ book, section, title, scope, entries: [{ value, holder }] }]
  book     Regular season | NBA Cup | All-Star | Play-In | Playoffs | Finals
  section  the all-caps heading (SCORING, REBOUNDS...); team records are marked by the PLAYER/TEAM RECORDS headings
  title    "Most points, game"
  scope    game | half | quarter | overtime | season | career | other (from the title)
  entries  "60—De'Aaron Fox, Sacramento vs. Minnesota, Nov. 15, 2024 (OT)" -> value "60", holder the rest;
           a line without a value shares the value above (a tie).
"""
import json, re, sys

BOOKS = [("REGULAR SEASON", "Regular season"), ("EMIRATES NBA CUP", "NBA Cup"), ("ALL-STAR GAME", "All-Star"), ("PLAY-IN TOURNAMENT", "Play-In"),
         ("PLAYOFFS", "Playoffs"), ("NBA FINALS", "Finals")]
PAGE_JUNK = re.compile(r"^(Records: .*|– \d+ –|\d+|Compiled by Elias.*)$")
VALUE = re.compile(r"^([\d,]+(?:\.\d+)?|\.\d+|\d+-\d+|[\d,]+ \(.+?\))\s*[—–-]\s*(.+)$")

def scope_of(t):
    t = re.sub(r"\s*\(.*?\)", "", t.lower())
    if "consecutive" in t: return "streak"
    for k, rx in (("overtime", r"overtime period"), ("quarter", r"quarter"), ("half", r"\bhalf\b"), ("career", r"career"), ("season", r"season"), ("game", r"(, |\b)game$|, game,|rookie, game|first game")):
        if re.search(rx, t): return k
    return "other"

out, book, side, section, cur = [], "Regular season", "player", None, None
for path in sys.argv[1:]:
    for raw in open(path, encoding="utf-8"):
        line = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", raw.replace("\t", " ")).strip()
        if not line or PAGE_JUNK.match(line): continue
        b = next((name for k, name in BOOKS if line == k), None)
        if b: book, section, cur = b, None, None; continue
        if line in ("PLAYER RECORDS", "PLAYER AND TEAM RECORDS"): side = "player"; continue
        if line == "TEAM RECORDS": side = "team"; continue
        if re.fullmatch(r"[A-Z][A-Z0-9 ,'’\-\.()/&]+", line) and len(line) > 3:
            section, cur = line.title(), None; continue
        if re.match(r"^(Most|Fewest|Highest|Lowest|Largest|Smallest|Longest|Best|Worst|Oldest|Youngest|Earliest|Latest)\b", line) and not VALUE.match(line):
            cur = {"book": book, "side": side, "section": section, "title": line.rstrip(":"), "scope": scope_of(line), "entries": []}
            out.append(cur); continue
        if cur is None: continue
        if re.match(r"^(Championship Game|Finals|Playoffs)\s*:?$", line):
            cur = {**cur, "title": f"{cur['title']} ({line.rstrip(':')})", "entries": []}; out.append(cur); continue
        m = VALUE.match(line)
        if m: cur["entries"].append({"value": m.group(1), "holder": m.group(2)})
        elif cur["entries"]:
            # a tie (same value) or a wrapped line
            last = cur["entries"][-1]
            if re.match(r"^[A-Z][^,]+, ", line) and not re.match(r"^(Nov|Dec|Jan|Feb|March|April|May|June|Oct)\.? \d", line) and last["holder"].rstrip().endswith((")", "4", "5", "6", "7", "8", "9", "0", "1", "2", "3")):
                cur["entries"].append({"value": last["value"], "holder": line})
            else: last["holder"] += " " + line
        # notes before the first entry are ignored
out = [r for r in out if r["entries"]]
json.dump(out, sys.stdout, ensure_ascii=False, indent=0)
sys.stderr.write(f"{len(out)} records, {sum(len(r['entries']) for r in out)} entries; " + ", ".join(f"{b}: {sum(1 for r in out if r['book'] == b)}" for _, b in BOOKS) + "\n")
