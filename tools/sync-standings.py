"""docs/standings.html is docs/situations.html with another data-view, title and nav link (tests keep the two in step).
Run after editing situations.html:   python3 tools/sync-standings.py"""
import os
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs")
s = open(os.path.join(D, "situations.html"), encoding="utf8").read()
PAIRS = [('<body data-view="situations">', '<body data-view="standings">'),
         ("<title>NBA Command Center · Team situations</title>", "<title>NBA Command Center · Standings</title>"),
         ('<a class="on" href="situations.html">Team situations</a><a href="standings.html">Standings</a>', '<a href="situations.html">Team situations</a><a class="on" href="standings.html">Standings</a>')]
for a, b in PAIRS:
    assert s.count(a) == 1, a
    s = s.replace(a, b)
open(os.path.join(D, "standings.html"), "w", encoding="utf8").write(s)
print("standings.html written")
