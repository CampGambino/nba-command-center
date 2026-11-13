"""
One-off (11/13): builds docs/gameflow.html from NBA GameFlow 6 (the user's file), stage 1 of the merge.
GameFlow's code is kept as it was, with these changes only:
  - Command Center title, header and page nav;
  - the script is a module: espnToFeeds comes from lib/gameflow/feeds.js (the same function the nightly build uses),
    and a game the nightly build has on file (data/flow/) is read from there, not from ESPN;
  - ESPN only: the league-feed path through the local helper is gone (the user's no-NBA.com rule), and ESPN's
    minute tolerance (0.6) is set from the start rather than when the first game opens;
  - the help text and footnote describe that.
  python3 tools/port-gameflow.py <nba-gameflow_6.html>
"""
import re, sys
src = open(sys.argv[1], encoding="utf-8").read()
lines = src.split("\n")

def cut(start_pat, end_line_pat):
    """Remove the block from the line matching start_pat through the next line matching end_line_pat."""
    global lines
    i = next(k for k, l in enumerate(lines) if re.search(start_pat, l))
    j = next(k for k in range(i, len(lines)) if re.search(end_line_pat, lines[k]))
    del lines[i:j + 1]

# espnToFeeds: imported instead (same code, shared with the nightly build)
cut(r"^function espnToFeeds\(sum\)\{", r"^\}$")
s = "\n".join(lines)

def rep(old, new, count=1):
    global s
    assert old in s, old[:80]
    s = s.replace(old, new, count)

NAV = ('<nav class="ccnav"><a href="./">Watch List</a><a href="situations.html">Team situations</a><a href="clutch.html">Clutch</a>'
       '<a href="players.html">With / without</a><a href="trends.html">Streaks &amp; outliers</a><a href="leaders.html">Team leaders</a>'
       '<a href="defenses.html">vs top teams</a><a href="national.html">National TV</a><a class="on" href="gameflow.html">Game Flow</a>'
       '<a href="records.html">Records</a></nav>')
rep("<title>NBA GameFlow — Substitution Patterns</title>", "<title>NBA Command Center · Game Flow</title>")
rep("""  <header class="top">
    <h1>NBA GameFlow
      <small>Substitution patterns, lineup stints &amp; score flow — every game of the season</small></h1>
  </header>""", f"""  <header class="top">
    <h1>NBA Command Center · Game Flow
      <small>Rotations, lineup stints, runs &amp; score flow — every game of the season, from the play-by-play</small></h1>
  </header>
  {NAV}""")
rep("</style>", """  /* Command Center page nav (the Game Flow page keeps GameFlow's dark look) */
  .ccnav{display:flex;flex-wrap:wrap;row-gap:4px;gap:14px;margin:-6px 0 14px;font-size:13.5px}
  .ccnav a{color:var(--dim);text-decoration:none;padding-bottom:2px}
  .ccnav a.on{color:var(--text);border-bottom:2px solid var(--accent)}
</style>""")
# the module script, and the shared reader
rep('<script>\n"use strict";', '<script type="module">\n"use strict";\nimport { espnToFeeds, expandFeeds } from "./lib/gameflow/feeds.js";')
rep("let MIN_TOL = 0.05;", "let MIN_TOL = 0.6;           // ESPN only (whole minutes): set from the start, as load() did for the first game")
# games on file from the nightly build
rep("async function modelFor(g){", """/* Games the nightly build has already read (docs/data/flow): the same ESPN data, kept compact, so a season or
   league view reads ~15 KB a game from this site instead of ~450 KB each from ESPN. Anything not on file — an
   older season, tonight's game, a game the build hasn't reached — comes from ESPN as before. */
let FLOW = null;
async function loadFlowIndex(){
  try{ const r=await fetch("data/flow/index.json",{cache:"no-store"}); if(!r.ok) return;
       const j=await r.json(); FLOW={season:String(j.season), ids:new Set((j.ids||[]).map(String))}; }
  catch(e){ FLOW=null; }
}
async function compactFor(g){
  if(!FLOW || seasonYear()!==FLOW.season || !FLOW.ids.has(String(g.gameId))) return null;
  try{ const r=await fetch(`data/flow/${FLOW.season}/${g.gameId}.json`); return r.ok? await r.json() : null; }
  catch(e){ return null; }
}
window.__flow = { index:()=>FLOW, compactFor };

async function modelFor(g){""")
rep("""  if(ACTIVE==="espn"){
    const sum = await getJSON(`${ESPN_SUMMARY}?event=${g.gameId}`);
    if(!sum.plays || !sum.plays.length){ pbpOutcome(true); throw new Error("no play-by-play"); }
    ({pbp,box} = espnToFeeds(sum));
  }else{""", """  if(ACTIVE==="espn"){
    const c = await compactFor(g);
    if(c) ({pbp,box} = expandFeeds(c));
    else{
      const sum = await getJSON(`${ESPN_SUMMARY}?event=${g.gameId}`);
      if(!sum.plays || !sum.plays.length){ pbpOutcome(true); throw new Error("no play-by-play"); }
      ({pbp,box} = espnToFeeds(sum));
    }
  }else{""")
rep("""      MIN_TOL=0.6; MIN_SLACK=0.5;
      const sum = await getJSON(`${ESPN_SUMMARY}?event=${g.gameId}`);
      if(!sum.plays || !sum.plays.length){""", """      MIN_TOL=0.6; MIN_SLACK=0.5;
      const c = g.status===3 ? await compactFor(g) : null;
      const sum = c ? null : await getJSON(`${ESPN_SUMMARY}?event=${g.gameId}`);
      if(c) ({pbp,box} = expandFeeds(c));
      else if(!sum.plays || !sum.plays.length){""")
rep("""      ({pbp,box} = espnToFeeds(sum));
    }else{
      MIN_TOL=0.05; MIN_SLACK=0.5;""", """      else ({pbp,box} = espnToFeeds(sum));
    }else{
      MIN_TOL=0.05; MIN_SLACK=0.5;""")
# ESPN only: no helper
rep("""  // the league feed is exact, so prefer it whenever the helper is reachable
  if(!past) for(const p of SCHEDULE_PATHS){
    try{ f = flattenSchedule(await feed(p)); ACTIVE="nba"; break; }
    catch(e){ lastErr=e; }
  }
""", """  // ESPN only in the Command Center (the user's rule: no NBA.com data); games on file come from the nightly build
  await loadFlowIndex();
""")
rep("""const HOWTO =
  `<br><br>This page reads ESPN directly, which needs no helper — so this usually means `+
  `no internet connection, or something on the network is blocking `+
  `<code>site.api.espn.com</code>.<br><br>`+
  `For the exact league feed instead, double-click `+
  `<code>Start NBA GameFlow.bat</code> in this folder (or run `+
  `<code>python nba_gameflow.py</code>), leave its window open, and open `+
  `<a href="http://localhost:8787/">http://localhost:8787/</a>.`;""", """const HOWTO =
  `<br><br>This page reads ESPN directly (and this season's finished games from the Command Center's own copy), `+
  `so this usually means no internet connection, or something on the network is blocking `+
  `<code>site.api.espn.com</code>.`;""")
rep("""  document.title=`NBA ${seasonLabel()} GameFlow`;
  $("h1").firstChild.textContent=`NBA ${seasonLabel()} GameFlow `;""", """  document.title=`NBA Command Center · ${seasonLabel()} Game Flow`;
  $("h1").firstChild.textContent=`NBA Command Center · ${seasonLabel()} Game Flow `;""")
# footnote: one source
s = re.sub(r"    Two sources, both timestamped to the second\..*?being trusted at that precision\.</i>",
  """    One source: <b>ESPN</b>'s play-by-play, timestamped to the second. This season's finished games are read once by
    the Command Center's nightly build and kept on this site; anything else (older seasons, tonight's games) is read
    from ESPN when you open it. ESPN publishes whole minutes in its box score, so reconstructed floor time is checked
    to within half a minute. The minutes, points and +/− columns come straight from the box score.
    <br><br>
    <i>Ported from NBA GameFlow 6, which was built first for the WNBA. Its agreement figures were measured on WNBA
    games; they should be re-measured against NBA games before being trusted to that precision.</i>""", s, count=1, flags=re.S)
assert "Two sources, both timestamped" not in s
open("docs/gameflow.html", "w", encoding="utf-8").write(s)
print("wrote docs/gameflow.html", len(s))
