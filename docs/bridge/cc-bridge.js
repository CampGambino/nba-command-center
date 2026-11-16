/*
 * NBA Command Center -> NBA Live bridge.                                  version 10
 *
 * Add ONE line to NBA Live, just before </body>:
 *   <script src="https://campgambino.github.io/nba-command-center/bridge/cc-bridge.js"></script>
 *
 * What it does
 *   Loads the Command Center's Watch List (watch.json) and, every time NBA Live runs its
 *   alert checks, fires cards through NBA Live's own fireStory() for what NBA Live does
 *   not already cover:
 *     - chases and passes from the teams' game notes (franchise / NBA history),
 *     - stats outside NBA Live's career ladders (defensive rebounds, games, starts, ...),
 *     - a count note where the team's notes and ESPN disagree on a total NBA Live chases.
 *   Each card carries the pre-game chance and whether the item is verified or "review".
 *   Before tip-off (v2): each game's top 3 storylines from tonight.json (streaks on the line,
 *   runs leading the team, shooters near 50/40/90, team streaks, milestones in reach): the
 *   same lines as the Command Center's Watch List and the 3 PM Discord digest.
 *   During games (v3):
 *     - career records kept current by the Command Center (records.json): passing a name on the
 *       all-time lists (to 40th; points to 68th), round career numbers, franchise records, NBA Cup
 *       career marks on Cup nights; worded "for 26th all-time", "for the NBA Cup record";
 *     - the NBA's all-time single-game lists (ref/nba-single-game-bests.json): a player nearing or
 *       making a list (57+ points, 11+ threes, 38+ rebounds, ...), with his place among every game
 *       on it; on Cup nights also the Cup's own lists. NBA Live's own record cards (the top mark)
 *       are left to NBA Live;
 *     - (v4) each franchise's single-game records from its media guide (records.json franchiseGame):
 *       "6 from the Suns record (70, Devin Booker at Boston 3/24/17)", "ties/breaks the Suns record".
 *     - (v5) this season, from the Game Flow files (data/flowstats.json):
 *       a quarter or half among the season's 10 best by a player ("19 in the 3rd: the 4th-most in a quarter
 *       this season"), a team quarter among the 5 best;
 *       foul trouble (more fouls than the period number: 2 in the 1st, 3 by the half ...) and foul-outs, with
 *       how often it has happened to him this season;
 *       a starter still on the bench 3+ minutes after his usual return, or not out for the 3rd quarter when he
 *       nearly always is (worth a look for an injury);
 *       a 15-point lead with the season's record of leads lost and comebacks, and a 15-point lead lost;
 *       (0.59.1) a regular reserve 3+ minutes past his usual first check-in, and before tip-off a "foul watch" card for
 *       starters in early foul trouble in half their games or more.
 *     - (v10, 0.72.4; the user, 11/15: "start checking around 20 points leads, and as the lead balloons, increase the
 *       check… it shouldn't actually show if no lead was lost at that amount. a 15-point lead is pretty common place")
 *       lead context starts at a 20-point lead and is measured in steps of 5 on the biggest lead of the game: up 25 it
 *       is about 25-point leads lost (and comebacks from 25 down), up 30 about 30. No card when nothing that size has
 *       been lost or won back this season, and a card from a smaller step is taken down.
 *     - (v9, 0.72.3; the user, 11/15: "make this clickable and flip over to see the list of top players this season
 *       while also accounting for any records that were also broken the same day… one of the alerts should be trimmed
 *       but both versions should still be tracked") the season cards flip to the season's list, with tonight's quarters
 *       from every game NBA Live shows in it, and the all-time record under it; places count tonight's too. While NBA
 *       Live's own QUARTER EXPLOSION card is up for a quarter, the season place and list are added to that card (its
 *       all-time list stays) and the separate season card is not fired; it shows only where NBA Live has no card.
 *       This is the one place the bridge adds to a card of NBA Live's: two fields, on its way through fireStory.
 *     - (v8, 0.72.2; the user, 11/15) foul trouble only for tonight's starters, players who start half their games or
 *       more, and players averaging 25.0 minutes or more ("no need to send foul trouble alert for a player coming off
 *       the bench unless they are typically a starter or average at least 25.0 minutes per game": Josh Green, 4 starts
 *       in 11 games); and a milestone or record card that a later stat change undoes says so ("TAKEN BACK") instead of
 *       quietly going back to a countdown, or staying up as reached once the game is final.
 *     - (v7, 0.72.1; the user, 11/15: Thybulle and Miles Bridges opened the 3rd, sat at 6:53 and were carded "didn't
 *       start the 3rd") "not out for the 3rd" only for a starter the play-by-play hasn't shown on the floor in the 3rd at
 *       all, and "still on the bench" only for one who hasn't been back since he first sat.
 *     - (v6, 0.71) a defense's first 30-point game allowed this season, when it's the only team (or one of three) that
 *       hadn't allowed one (the user, 11/15: the Celtics); the same for 40 when two teams or fewer hadn't. From
 *       tonight.json's defense counts.
 *
 * What it never does
 *   - change NBA Live's own checks or data, or its cards beyond the one addition above (v9);
 *   - throw: if NBA Live's hooks (fireStory, runAlertChecks, GAMES) are missing or renamed,
 *     it shows a small "Command Center: not connected" note and stays idle.
 *
 * Options (URL): ?cc=<watch.json address>   ?cc=off  (disable)
 */
(function () {
  "use strict";
  var VERSION = 10;
  var DEFAULT_URL = "https://campgambino.github.io/nba-command-center/data/watch.json";
  var REFRESH_MS = 15 * 60 * 1000;
  // Editorial gate, in NBA Live's spirit ("a rung nobody celebrates produces a card nobody wants"):
  var MIN_CHANCE = 0.10;      // pre-game chance tonight needed to take a card while live
  var MIN_IMPORTANCE = 15;    // round numbers below this never get a card (passes always can). Was 20 until 0.15.2; tune from use
  var MAX_PER_GAME = 6;       // in-play cards per game, best first (reached ones always show)
  var PRE_PER_GAME = 3;       // pre-game storyline cards per game
  var ICON = { history: "📜 FROM THE NOTES", injury: "🩹 INJURY", milestone: "🎯 IN REACH", streak: "🔥 STREAK", lead: "👑 TEAM LEADER", shooting: "🏹 50/40/90", team: "📈 TEAM STREAK", record: "🏛️ RECORD WATCH", context: "📊 CAREER CONTEXT", foul: "⚠️ FOUL WATCH", early: "🔄 LEFT EARLY LAST TIME", fourth: "⏳ 4TH QUARTER", qtr: "🕒 BY QUARTER", season: "📊 THIS SEASON", span: "🧩 IN THAT SPAN", pstreak: "🔥 STREAK WATCH", vsopp: "🆚 VS TONIGHT'S OPPONENT", pace: "⏱️ PACE", trade: "🔁 SINCE THE TRADE", role: "🪑 STARTER VS BENCH", lineup: "🖐️ STARTING FIVE", turn: "↪️ RECORD TURN", beaten: "⚔️ WHO'S BEATEN THEM", month: "🗓️ THIS MONTH", monthp: "🗓️ THIS MONTH", rookie: "🌱 ROOKIES", era: "📆 SINCE THEN", defense: "🛡️ DEFENSE WATCH", cup: "🏆 NBA CUP" };

  // ESPN abbreviations NBA Live shows -> Command Center tricodes.
  var TRI = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", PHO: "PHX", BRK: "BKN", CHO: "CHA" };
  var tri = function (t) { t = String(t || "").toUpperCase(); return TRI[t] || t; };

  // Command Center stat -> NBA Live box-score field.
  var FIELD = { pts: "pts", reb: "reb", ast: "ast", stl: "stl", blk: "blk", fg3m: "tpm", ftm: "ftm", fgm: "fgm", dreb: "dreb", oreb: "oreb", min: "min" };
  // NBA Live's own ladders (MILESTONE_LADDERS): those round numbers are already its cards.
  var NBA_LIVE_STAT = { pts: "pts", fg3m: "tpm", reb: "reb", ast: "ast", stl: "stl", blk: "blk" };

  var state = { data: null, items: [], tonight: null, records: null, recItems: [], bests: null, flow: null, maxLead: {}, firstAt: {}, done: {}, hit: {}, merged: {}, decorated: {}, loadedAt: 0, error: null, connected: false, fired: 0, keys: {} };
  window.CC_BRIDGE = { version: VERSION, state: state };

  function param(name) { try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; } }
  var url = param("cc") || DEFAULT_URL;
  if (url === "off") return;
  var tonightUrl = url.replace(/watch\.json(\?.*)?$/, "tonight.json");
  var recordsUrl = url.replace(/watch\.json(\?.*)?$/, "records.json");
  var flowUrl = url.replace(/watch\.json(\?.*)?$/, "flowstats.json");
  var bestsUrl = /watch\.json(\?.*)?$/.test(url) ? url.replace(/watch\.json(\?.*)?$/, "").replace(/data\/$/, "") + "ref/nba-single-game-bests.json" : url;

  function has(name) { try { return typeof eval(name) !== "undefined"; } catch (e) { return false; } }
  function games() { try { return GAMES; } catch (e) { return null; } } // NBA Live's top-level `let GAMES`

  function note(text, bad) {
    try {
      var el = document.getElementById("cc-bridge-note");
      if (!el) {
        el = document.createElement("div");
        el.id = "cc-bridge-note";
        el.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:9999;font:12px/1.3 Inter,system-ui,sans-serif;padding:4px 8px;border-radius:6px;background:rgba(20,22,28,.85);color:#cfd5df;pointer-events:none";
        document.body.appendChild(el);
      }
      el.textContent = text;
      el.style.color = bad ? "#e5a93b" : "#9fb3c8";
      // All-is-well notes get out of the way of NBA Live's panels; problems stay visible.
      el.style.display = "";
      clearTimeout(note._t);
      if (!bad) note._t = setTimeout(function () { el.style.display = "none"; }, 8000);
      state.note = text;
    } catch (e) { /* page not ready */ }
  }

  function load() {
    // Tonight's storylines: optional; a missing file just means no pre-game cards.
    if (tonightUrl !== url) fetch(tonightUrl, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (t) { state.tonight = t && Array.isArray(t.games) ? t : null; }).catch(function (e) { state.tonight = null; state.tonightError = String(e && e.message || e); });
    // v3: career records (records.json) and the all-time single-game lists. Both optional.
    if (recordsUrl !== url) fetch(recordsUrl, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { state.records = d; state.recItems = d && Array.isArray(d.items) ? d.items.filter(function (i) { return i.id && (i.kind === "pass" || i.kind === "round" || i.kind === "franchise" || i.kind === "cup"); }) : []; })
      .catch(function (e) { state.records = null; state.recItems = []; state.recordsError = String(e && e.message || e); });
    if (bestsUrl !== url && !state.bests) fetch(bestsUrl, { cache: "force-cache" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { state.bests = d; }).catch(function (e) { state.bestsError = String(e && e.message || e); });
    // v5: this season's Game Flow facts. Optional.
    if (flowUrl !== url) fetch(flowUrl, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { state.flow = d && Array.isArray(d.quarters) ? d : null; }).catch(function (e) { state.flowError = String(e && e.message || e); });
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      state.data = d;
      state.loadedAt = Date.now();
      state.error = null;
      state.items = [];
      (d.teams || []).forEach(function (t) {
        (t.items || []).forEach(function (i) {
          if (i.origin === "espn" || i.stale || !i.espnId || i.need == null) return;
          state.items.push(Object.assign({}, i, { team: t.team }));
        });
      });
      status();
    }).catch(function (e) { state.error = String(e.message || e); status(); });
  }

  // Pre-game: the top storylines for a game that hasn't tipped off, once per night.
  // 0.61 (the user, 11/13): once the night's first game tips, the pre-game cards are done: removed, and no more fire.
  function slateStarted(G) { return (G || []).some(function (g) { return g && (g.status === "live" || g.status === "final"); }); }
  function clearPregame() {
    if (state.pregameCleared || typeof ALERT_STORIES === "undefined") return;
    state.pregameCleared = true;
    Object.keys(state.keys).forEach(function (k) {
      if (!/^cc-(pre|foulwatch)-/.test(k)) return;
      var ex = ALERT_STORIES.get(k);
      if (ex) { if (ex.el) ex.el.remove(); ALERT_STORIES.delete(k); }
    });
  }
  function pregame(game, sides, tag) {
    if (state.pregameCleared) return;
    var T = state.tonight;
    if (!T || (state.data && T.today !== state.data.today)) return;
    var g = T.games.find(function (x) { return x.away === sides.away && x.home === sides.home; });
    if (!g) return;
    g.lines.filter(function (l) { return l.kind !== "foul" || !state.flow; }).slice(0, PRE_PER_GAME).forEach(function (l, n) {
      fire("cc-pre-" + T.today + "-" + sides.away + "-" + sides.home + "-" + n, {
        type: "milestone", icon: ICON[l.kind] || "📌 STORYLINE", text: l.text,
        sub: "Command Center · tonight's storyline (pre-game)",
        live: false, gameId: game.id, gameTag: tag, gameScore: "Pre-game",
      });
    });
  }

  function status() {
    if (!state.connected) return note("Command Center: not connected (this NBA Live version lacks fireStory/runAlertChecks/GAMES)", true);
    if (state.error) return note("Command Center: couldn't load the Watch List (" + state.error + ")", true);
    var d = state.data && state.data.today;
    note("Command Center: " + state.items.length + " milestones" + (state.recItems.length ? " + " + state.recItems.length + " records" : "") + (d ? " for " + d : "") + (state.flow ? " · season facts: " + state.flow.games + " games" : state.flowError ? " · season facts not loaded" : "") + (state.fired ? " · " + state.fired + " cards" : ""));
  }

  // Is this item one of NBA Live's own ladder cards? Then NBA Live already shows it.
  function coveredByNbaLive(i) {
    if (i.kind !== "round" || i.scope === "franchise") return false;
    var f = NBA_LIVE_STAT[i.stat];
    if (!f) return false;
    try {
      var L = MILESTONE_LADDERS[f];
      return !!L && i.target >= L.from && i.target % L.step === 0;
    } catch (e) { return false; }
  }

  function tonightValue(i, p) {
    if (!p) return 0;
    if (i.stat === "gp") return (p.min || 0) > 0 ? 1 : 0;
    if (i.stat === "gs") return p.starter && (p.min || 0) > 0 ? 1 : 0;
    var m = /^g(\d+)pt$/.exec(i.stat || "");
    if (m) return (p.pts || 0) >= Number(m[1]) ? 1 : 0;
    var f = FIELD[i.stat];
    return f ? (Number(p[f]) || 0) : null;
  }

  var SCOPE = { nba: "in NBA history", franchise: "in franchise history", career: "career", unknown: "(list scope unproven)" };
  var pct = function (p) { return p == null ? "–" : Math.round(p * 100) + "%"; };

  // The night NBA Live is showing (it honours ?date=), as YYYY-MM-DD.
  function nbaLiveNight() {
    try { var d = activeDateYMD(); return d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8); } catch (e) { return null; }
  }

  function checks() {
    state.cycle = (state.cycle || 0) + 1;
    var G = games();
    if (!G || (!state.items.length && !state.flow)) return;
    var night = nbaLiveNight();
    var otherNight = !!(night && state.data && state.data.today && night !== state.data.today);
    state.wrongNight = otherNight ? night : null;
    if (slateStarted(G)) clearPregame();
    G.forEach(function (game) {
      if (!game) return;
      var sides = { away: tri(game.away && game.away.tricode), home: tri(game.home && game.home.tricode) };
      var tag = (game.away && game.away.tricode) + " @ " + (game.home && game.home.tricode);
      var box = (game.boxscore || {});
      var scr = game.status === "final" ? "Final" : ((game.away && game.away.score) + "–" + (game.home && game.home.score));
      // Another night than the Watch List's: only the season facts (v5) still apply.
      if (otherNight) {
        if (game.status === "live" || game.status === "final") try { flowChecks(game, sides, box, tag, scr); } catch (e) { state.flowCheckError = String(e && e.message || e); }
        return;
      }
      if (game.status !== "live" && game.status !== "final") { if (state.pregameCleared) return; try { foulWatch(game, sides, tag); } catch (e) { state.flowCheckError = String(e && e.message || e); } return pregame(game, sides, tag); }
      var picks = [];
      state.items.forEach(function (i) {
        if (i.team !== sides.away && i.team !== sides.home) return;
        var side = i.team === sides.away ? "away" : "home";
        var p = (box[side] || []).find(function (x) { return String(x.id) === String(i.espnId); });
        var v = tonightValue(i, p);
        if (v === null) return;

        // 1. A total NBA Live already chases: add the team's count only if it differs from ESPN's.
        if (coveredByNbaLive(i)) {
          if (i.tracking === "disagrees" && game.status === "live" && p && (p.min || 0) >= 1) {
            fire("cc-count-" + i.espnId + "-" + i.stat + "-" + i.target, {
              type: "milestone", icon: "🧮 COUNT CHECK",
              text: i.player + " (" + i.team + ") — the team's notes have " + Number(i.current).toLocaleString() + " " + (i.label || i.stat) + " entering tonight; ESPN's total differs",
              sub: "Command Center · " + (i.review && i.review[0] ? i.review[0] : "sources disagree") + " · NBA Live's ladder uses ESPN's total",
              live: true, gameId: game.id, gameTag: tag, gameScore: scr,
            });
          }
          return;
        }
        // 2. Chases and passes from the notes that NBA Live doesn't know, gated.
        if (!p) return;
        var reachedTonight = i.need > 0 && v >= i.need;
        // v8: a mark this page showed as reached and a stat change has since undone (an assist or a rebound given to
        // someone else, a three ruled a two) stays on the card, said plainly, live or final.
        var hk = "cc-" + i.espnId + "-" + game.id + "|" + i.stat + "|" + i.target;
        if (reachedTonight) state.hit[hk] = v;
        var was = !reachedTonight && state.hit[hk] != null ? state.hit[hk] : null;
        if (i.kind !== "pass" && i.importance < MIN_IMPORTANCE) return;   // a rung nobody celebrates, reached or not
        if (i.kind === "pass" && (i.minor || !worthPlace(i.scope, i.stat, i.passing && i.passing.rank))) return;   // 0.61: a place worth saying (0.64: i.minor also covers lists of unproven scope)
        if (game.status === "final" && !reachedTonight && was === null) return;   // a final game: only what fell in it
        if (!reachedTonight && was === null) {
          if ((p.min || 0) < 1) return;                                  // not a story until he plays
          if ((i.pTonight || 0) < MIN_CHANCE) return;                    // not in play tonight
        }                                                                // (a surprise reach always shows)
        picks.push({ i: i, v: v, was: was, reached: reachedTonight, rank: reachedTonight || was !== null ? 1e9 : (i.pTonight || 0) * i.importance });
      });
      picks.sort(function (a, b) { return b.rank - a.rank; });
      var byPlayer = {}, order = [];
      picks.filter(function (x, k) { return x.reached || x.was !== null || k < MAX_PER_GAME; }).forEach(function (x) {
        if (!byPlayer[x.i.espnId]) { byPlayer[x.i.espnId] = []; order.push(x.i.espnId); }
        byPlayer[x.i.espnId].push(x);
      });
      order.forEach(function (id) { playerCard(game, byPlayer[id], tag, scr); });
      try { recordChecks(game, sides, box, tag, scr); } catch (e) { state.recError = String(e && e.message || e); }
      try { listChecks(game, sides, box, tag, scr); } catch (e) { state.listError = String(e && e.message || e); }
      try { franchiseGameChecks(game, sides, box, tag, scr); } catch (e) { state.fgError = String(e && e.message || e); }
      try { flowChecks(game, sides, box, tag, scr); } catch (e) { state.flowCheckError = String(e && e.message || e); }
      try { defenseChecks(game, sides, box, tag, scr); } catch (e) { state.defenseCheckError = String(e && e.message || e); }
    });
    if (otherNight) return note("Command Center: Watch List is for " + state.data.today + ", NBA Live shows " + night + " (rebuild the Watch List; season facts still on)", true);
    status();
  }

  // ---- v3: career records kept current by the Command Center ----
  var REC_FIELD = { pts: "pts", reb: "reb", ast: "ast", stl: "stl", blk: "blk", fg3m: "tpm", ftm: "ftm", fgm: "fgm", dreb: "dreb", oreb: "oreb" };
  function recValue(i, p) {
    if (!p) return null;
    if (i.stat === "gp") return (p.min || 0) > 0 ? 1 : 0;
    if (i.stat === "fg2m") return (Number(p.fgm) || 0) - (Number(p.tpm) || 0);
    if (i.stat === "td") return ["pts", "reb", "ast", "stl", "blk"].filter(function (k) { return (Number(p[k]) || 0) >= 10; }).length >= 3 ? 1 : 0;
    if (i.stat === "wins") return null; // decided at the final horn, not by a box line
    var f = REC_FIELD[i.stat];
    return f ? (Number(p[f]) || 0) : null;
  }
  var surname = function (n) { return String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV)$/, "").split(" ").pop().toLowerCase(); };
  // The same milestone already carried by the notes (Watch List) is left to that card.
  function inNotes(r) {
    return state.items.some(function (i) {
      return String(i.espnId) === String(r.id) && i.stat === r.stat && (i.target === r.target || i.target === r.target - 1
        || (i.passing && r.passing && String(r.passing.name).split(" and ").some(function (n) { return surname(n) === surname(i.passing.player); })));
    });
  }
  /* 0.61 (the user, 11/13: "consider player, team, new placement, and stat… scale back"): a pass gets a card only for a
     place worth saying. NBA Cup: top 2. Franchise: top 3 in points, rebounds, assists, steals, blocks, threes; top 2 in
     anything else. All-time: top 25 in those six, top 10 in anything else. Round numbers are left to the cadence. */
  var MAJOR = { pts: 1, reb: 1, ast: 1, stl: 1, blk: 1, fg3m: 1 };
  function worthPlace(scope, stat, place) {
    if (!place) return true;
    var major = !!MAJOR[stat];
    if (scope === "cup") return place <= 2;
    if (scope === "franchise") return place <= (major ? 3 : 2);
    if (scope === "nba") return place <= (major ? 25 : 10);
    return true;
  }
  var escH = function (x) { return String(x == null ? "" : x).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  // The card's back (tap to flip): the list's top 5 with him at tonight's total, and his place if lower.
  function boardBack(title, rows, who, total) {
    if (!Array.isArray(rows) || !rows.length) return null;
    var me = surname(who);
    var L = rows.filter(function (r) { return !(surname(r.name) === me && String(r.name).split(" ")[0] === String(who).split(" ")[0]); })
      .map(function (r) { return { name: r.name, v: Number(r.now != null ? r.now : r.value) || 0 }; });
    L.push({ name: who, v: total, me: true });
    L.sort(function (a, b) { return b.v - a.v || (a.me ? -1 : 0); });
    var mine = L.findIndex(function (r) { return r.me; });
    var place = function (k) { return L.filter(function (r) { return r.v > L[k].v; }).length + 1; };
    var line = function (k) { var r = L[k]; return '<div class="alert-back-play"' + (r.me ? ' style="font-weight:700"' : "") + '><span class="abp-time">' + place(k) + ".</span> " + escH(r.name) + " · <strong>" + r.v.toLocaleString() + "</strong></div>"; };
    var html = '<div class="alert-back-title">' + escH(title) + "</div>";
    for (var k = 0; k < Math.min(5, L.length); k++) html += line(k);
    if (mine >= 5) html += '<div class="alert-back-play" style="opacity:.6">…</div>' + line(mine);
    return html;
  }
  function recBoard(r) {
    var R = state.records || {};
    if (r.kind === "cup") return R.cup && R.cup.boards && R.cup.boards[r.stat];
    if (r.kind === "franchise") return R.franchise && R.franchise[r.team] && R.franchise[r.team][r.stat];
    if (r.kind === "pass") return R.boards && R.boards[r.stat];
    return null;
  }
  var SCOPE_OF = { cup: "cup", franchise: "franchise", pass: "nba" };

  function recordChecks(game, sides, box, tag, scr) {
    var R = state.records;
    if (!R || !state.recItems.length) return;
    if (state.data && R.today && state.data.today && R.today !== state.data.today) return;
    var cupTonight = R.cup && Array.isArray(R.cup.tonight) && R.cup.tonight.some(function (g) { return g.away === sides.away && g.home === sides.home; });
    var picks = [];
    state.recItems.forEach(function (r) {
      if (r.team !== sides.away && r.team !== sides.home) return;
      if (r.kind === "cup" && !cupTonight) return;                       // Cup marks count only in Cup games
      if (inNotes(r)) return;
      var side = r.team === sides.away ? "away" : "home";
      var p = (box[side] || []).find(function (x) { return String(x.id) === String(r.id); });
      var v = recValue(r, p);
      if (v === null || !p) return;
      var reached = v >= r.need;
      var undone = !reached && !!state.hit["cc-rec-" + r.id + "-" + r.stat + "-" + r.kind + "|" + game.id];   // v8: shown as reached, since taken back
      if (game.status === "final" && !reached && !undone) return;
      if (!reached && !undone && ((p.min || 0) < 1 || (r.pTonight || 0) < MIN_CHANCE)) return;
      picks.push({ r: r, v: v, reached: reached, rank: reached || undone ? 1e9 : (r.pTonight || 0) * (r.score || 1) });
    });
    // One tile per player, stat and list (the user, 11/13): passing two names tonight reads "passes A and B for 8th".
    var groups = {}, picksBy = {};
    picks.forEach(function (x) {
      var k = x.r.id + "-" + x.r.stat + "-" + x.r.kind;
      (picksBy[k] = picksBy[k] || []).push(x);
      var G0 = groups[k] || (groups[k] = { rank: 0, done: [], next: null });
      G0.rank = Math.max(G0.rank, x.rank);
      if (x.reached) G0.done.push(x);
      else if ((!SCOPE_OF[x.r.kind] || worthPlace(SCOPE_OF[x.r.kind], x.r.stat, x.r.rank)) && (!G0.next || x.r.need < G0.next.r.need)) G0.next = x;
    });
    var merged = Object.keys(groups).map(function (k) {
      var G0 = groups[k], any = G0.done[0] || G0.next || (picksBy[k] || [])[0];
      // 0.63 (the user, 11/13: "SGA alert cards are confusing… Daniels played a game earlier in the night"): a pass on a
      // board (NBA Cup, franchise, all-time) is decided on tonight's live totals of everyone on it, not the morning's.
      if (any && SCOPE_OF[any.r.kind] && recBoard(any.r)) { var lp = livePass(any.r, any.v, G0.rank); return lp && (lp.reached || game.status !== "final" || state.hit["cc-rec-" + k + "|" + game.id]) ? lp : null; }
      if (!G0.done.length) return G0.next;   // may be null: nothing worth saying in reach
      G0.done.sort(function (a, b) { return (a.r.rank || 99) - (b.r.rank || 99); });
      var best = G0.done[0];
      return { r: best.r, v: best.v, reached: true, rank: G0.rank, also: G0.done.slice(1).map(function (x) { return x.r.passing && x.r.passing.name; }).filter(Boolean) };
    }).filter(function (x) { return x && (x.live || !SCOPE_OF[x.r.kind] || worthPlace(SCOPE_OF[x.r.kind], x.r.stat, x.r.rank)); });   // judged by the place he ends on
    merged.sort(function (a, b) { return b.rank - a.rank; });
    var hitKey = function (x) { return "cc-rec-" + x.r.id + "-" + x.r.stat + "-" + x.r.kind + "|" + game.id; };
    merged.filter(function (x, k) { return x.reached || state.hit[hitKey(x)] || k < MAX_PER_GAME; }).forEach(function (x) {
      var r = x.r, label = r.label || r.stat;
      // v8: remember what this page showed as reached; if a stat change undoes it, the card says so.
      var nowReached = x.live ? !!x.reached : (r.need - x.v) <= 0;
      var undone = !nowReached && !!state.hit[hitKey(x)];
      if (nowReached) state.hit[hitKey(x)] = 1;
      // On a live board the other name may simply have scored again, so that case is worded without blaming the scorer.
      var undo = function (t) { return !undone ? t : t + (x.live ? " · showed as reached earlier tonight; not on the totals now" : " · showed as reached earlier tonight; a stat change has taken it back"); };
      var scopeWord = r.kind === "cup" ? "NBA Cup" : r.kind === "franchise" ? "franchise" : "all-time";
      var board = recBoard(r);
      var title = (r.kind === "cup" ? "🏆 NBA Cup" : r.kind === "franchise" ? "🏛️ " + r.team + " history" : "📜 All-time") + " · " + label + (x.live ? " · live tonight" : "");
      var back = board ? boardBack(title, x.rows || liveRows(board, r.stat, r.who), r.who, (Number(r.now) || 0) + x.v) : null;
      if (x.live) {
        var stat2 = [[x.v, String(label).toUpperCase() + " TONIGHT"]];
        if (!x.reached) stat2.push([x.need, "TO GO"]);
        fire("cc-rec-" + r.id + "-" + r.stat + "-" + r.kind, {
          type: "milestone", backHtml: back,
          icon: undone ? "↩️ TAKEN BACK" : x.reached ? (x.place === 1 ? "🏆 RECORD" : "🎉 " + (r.kind === "cup" ? "CUP HISTORY" : r.kind === "franchise" ? "FRANCHISE HISTORY" : "PASSED")) : "📈 " + x.need + " TO GO",
          text: undo(x.text),
          statLine: typeof fmtAlertStatLine === "function" ? fmtAlertStatLine(stat2) : "",
          sub: "Command Center · career records (" + scopeWord + "), live: everyone's totals tonight · pre-game " + pct(r.pTonight),
          live: game.status === "live", gameId: game.id, gameTag: tag, gameScore: scr,
        });
        return;
      }
      var left = r.need - x.v;
      // The item's text is pre-game ("Curry: 2 3-pointers from passing ..."): re-say it for now.
      var what = String(r.text || "").split(" from ").slice(1).join(" from ").replace(/;\s*[\d,]+ ties him$/, "");
      if (left <= 0 && x.also && x.also.length && r.passing && r.passing.name) {
        var names = [r.passing.name].concat(x.also.filter(function (n) { return n !== r.passing.name; }));
        what = what.replace(r.passing.name, names.length === 2 ? names[1] + " and " + names[0] : names.slice(1).join(", ") + " and " + names[0]);
      }
      var text = left <= 0
        ? r.who + " (" + r.team + ") — " + (r.kind === "round" ? "reaches " + what : what.replace(/^passing /, "passes "))
        : r.who + " (" + r.team + ") — " + left + " " + plural(left, label) + " from " + what;
      var stat = [[x.v, String(label).toUpperCase() + " TONIGHT"]];
      if (left > 0) stat.push([left, "TO GO"]);
      fire("cc-rec-" + r.id + "-" + r.stat + "-" + r.kind, {
        type: "milestone", backHtml: back,
        icon: undone ? "↩️ TAKEN BACK" : left <= 0 ? (r.rank === 1 ? "🏆 RECORD" : "🎉 " + (r.kind === "cup" ? "CUP HISTORY" : r.kind === "franchise" ? "FRANCHISE HISTORY" : r.kind === "round" ? Number(r.target).toLocaleString() : "PASSED")) : "📈 " + left + " TO GO",
        text: undo(text),
        statLine: typeof fmtAlertStatLine === "function" ? fmtAlertStatLine(stat) : "",
        sub: "Command Center · career records (" + scopeWord + ") · pre-game " + pct(r.pTonight),
        live: game.status === "live", gameId: game.id, gameTag: tag, gameScore: scr,
      });
    });
  }

  // Tonight's box line for anyone on a board, by name (every game in NBA Live, live or final). records.json is through last
  // night (it's used only while its day is NBA Live's), so tonight's numbers are added for everyone, not just the player.
  var normName = function (n) { return String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z ]/g, "").replace(/\s+(?:Jr|Sr|II|III|IV)$/, "").trim().toLowerCase(); };
  function tonightIndex() {
    if (state.tonightIdx && state.tonightIdxAt === state.cycle) return state.tonightIdx;
    var idx = {};
    (games() || []).forEach(function (g) {
      if (!g || (g.status !== "live" && g.status !== "final")) return;
      ["away", "home"].forEach(function (side) { ((g.boxscore || {})[side] || []).forEach(function (p) { var n = normName(p && (p.name || p.displayName)); if (n) idx[n] = p; }); });
    });
    state.tonightIdx = idx; state.tonightIdxAt = state.cycle;
    return idx;
  }
  function liveRows(board, stat, who) {
    var idx = tonightIndex(), me = normName(who);
    return (board || []).filter(function (e) { return normName(e.name) !== me; }).map(function (e) {
      var pre = Number(e.now != null ? e.now : e.value) || 0, p = idx[normName(e.name)];
      var add = p ? (recValue({ stat: stat }, p) || 0) : 0;
      return { name: e.name, pre: pre, now: pre + add, tonight: add };
    });
  }
  function livePass(r, v, rank) {
    var board = recBoard(r), rows = liveRows(board, r.stat, r.who);
    var pre = Number(r.now) || 0, mine = pre + v;
    var place = 1 + rows.filter(function (x) { return x.now > mine; }).length;
    var passed = rows.filter(function (x) { return x.pre >= pre && x.now < mine; }).sort(function (a, b) { return a.now - b.now; });
    var tail = r.kind === "cup" ? (place === 1 ? "the NBA Cup record" : ord(place) + " in NBA Cup history")
      : r.kind === "franchise" ? (function () { var h = (String(r.text).match(/in ([A-Z][\w.' ]+? history)/) || [])[1] || r.team + " history"; return place === 1 ? "the most in " + h : ord(place) + " in " + h; })()
      : (place === 1 ? "the most all-time" : ord(place) + " all-time");
    var scope = SCOPE_OF[r.kind];
    if (passed.length) {
      if (!worthPlace(scope, r.stat, place)) return null;
      var names = passed.map(function (x) { return x.name; });
      var who2 = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
      return { r: r, v: v, live: true, reached: true, rank: 1e9, place: place, rows: rows,
        text: r.who + " (" + r.team + ") — passes " + who2 + " (" + passed[passed.length - 1].now.toLocaleString() + ") for " + tail + " · " + mine.toLocaleString() + " " + (r.label || r.stat) };
    }
    // Not yet: the next name above him, live.
    var ahead = rows.filter(function (x) { return x.now >= mine; }).sort(function (a, b) { return a.now - b.now; })[0];
    if (!ahead) return null;
    var need = ahead.now - mine + 1, placeAfter = 1 + rows.filter(function (x) { return x.now > ahead.now; }).length;
    if (!worthPlace(scope, r.stat, placeAfter)) return null;
    var tail2 = r.kind === "cup" ? (placeAfter === 1 ? "the NBA Cup record" : ord(placeAfter) + " in NBA Cup history")
      : r.kind === "franchise" ? (function () { var h = (String(r.text).match(/in ([A-Z][\w.' ]+? history)/) || [])[1] || r.team + " history"; return placeAfter === 1 ? "the most in " + h : ord(placeAfter) + " in " + h; })()
      : (placeAfter === 1 ? "the most all-time" : ord(placeAfter) + " all-time");
    return { r: r, v: v, live: true, reached: false, need: need, rank: rank, place: place, rows: rows,
      text: r.who + " (" + r.team + ") — " + need + " " + plural(need, r.label || r.stat) + " from passing " + ahead.name + " (" + ahead.now.toLocaleString() + (ahead.tonight ? ", " + ahead.tonight + " tonight" : "") + ") for " + tail2 };
  }

  // ---- v3: the NBA's all-time single-game lists ----
  var LIST_FIELD = { pts: "pts", fgm: "fgm", ftm: "ftm", fg3m: "tpm", reb: "reb", ast: "ast", stl: "stl", blk: "blk" };
  var LIST_WORD = { pts: "points", fgm: "field goals", ftm: "free throws", fg3m: "3-pointers", reb: "rebounds", ast: "assists", stl: "steals", blk: "blocks" };
  var LIST_GAP = { pts: 6, fgm: 3, ftm: 3, fg3m: 2, reb: 4, ast: 3, stl: 2, blk: 2 }; // "nearing the list" window, live only
  var ord = function (n) { return n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"); };
  function listChecks(game, sides, box, tag, scr) {
    var B = state.bests;
    if (!B) return;
    var R = state.records;
    var cupTonight = R && R.cup && Array.isArray(R.cup.tonight) && R.cup.tonight.some(function (g) { return g.away === sides.away && g.home === sides.home; });
    // The postseason has its own lists (NBA Live knows which slate it shows).
    var post = false;
    try { post = typeof isPlayoffSlate === "function" && !!isPlayoffSlate(); } catch (e) { post = false; }
    var books = [post ? ["Playoffs", "NBA's all-time playoff"] : ["Regular season", "NBA's all-time"]];
    if (cupTonight) books.push(["NBA Cup", "NBA Cup's"]);
    ["away", "home"].forEach(function (side) {
      (box[side] || []).forEach(function (p) {
        if (!p || (p.min || 0) < 1) return;
        books.forEach(function (bk) {
          var lists = B[bk[0]] || {};
          Object.keys(LIST_FIELD).forEach(function (stat) {
            var L = lists[stat];
            if (!L || !Array.isArray(L.games)) return;
            var v = Number(p[LIST_FIELD[stat]]) || 0;
            var made = v >= L.floor;
            var top0 = L.games.reduce(function (a, g) { return Math.max(a, g.value); }, 0);
            // 0.63 (the user, 11/13: "I don't need an alert for when players are close to joining a list. let me know when
            // tracking on breaking the record"): no "N from the list" cards; a countdown to the record itself, live, for the
            // NBA Cup and playoff books (NBA Live's own record cards cover the regular season's).
            var nearRecord = !made || v < top0 ? (game.status === "live" && bk[0] !== "Regular season" && v >= top0 - LIST_GAP[stat] && v < top0) : false;
            if (!made && !nearRecord) return;
            var team = side === "away" ? sides.away : sides.home;
            var name = p.name || p.displayName || p.shortName || ("#" + p.id);
            var better = L.games.filter(function (g) { return g.value > v; }).length;
            var tied = L.games.filter(function (g) { return g.value === v; }).length;
            var top = L.games.reduce(function (a, g) { return Math.max(a, g.value); }, 0);
            var recHolder = L.games.slice().sort(function (a, b) { return b.value - a.value; })[0] || {};
            if (nearRecord) {
              var togo = top0 - v;
              fire("cc-list-" + (bk[0] === "NBA Cup" ? "cup-" : "po-") + p.id + "-" + stat + "-record", {
                type: "milestone", icon: "👀 " + togo + " FROM THE " + (bk[0] === "NBA Cup" ? "CUP" : "PLAYOFF") + " RECORD",
                text: name + " (" + team + ") — " + v + " " + LIST_WORD[stat] + ", " + togo + " from the " + bk[1].replace(/'s$/, "") + " single-game record (" + top0 + ", " + escH(recHolder.player || "") + (recHolder.date ? ", " + recHolder.date : "") + ")",
                statLine: typeof fmtAlertStatLine === "function" ? fmtAlertStatLine([[v, LIST_WORD[stat].toUpperCase()], [togo, "TO TIE"]]) : "",
                sub: "Command Center · the NBA Guide's single-game lists (through 2025-26)",
                live: true, gameId: game.id, gameTag: tag, gameScore: scr,
              });
              if (!made) return;
            }
            var text = made
              ? name + " (" + team + ") — " + v + " " + LIST_WORD[stat] + ": " + (v > top ? "the most in a game in " + bk[1].replace(/'s$/, "") + " history" : (tied ? "tied for " : "") + "the " + ord(better + 1) + "-most in a game on the " + bk[1] + " list") + " (" + L.games.length + " games of " + L.floor + "+)"
              : name + " (" + team + ") — " + v + " " + LIST_WORD[stat] + ", " + (L.floor - v) + " from the " + bk[1] + " single-game list (" + L.floor + "+, " + L.games.length + " games)";
            var top5 = L.games.slice().sort(function (a, b) { return b.value - a.value; }).slice(0, 5);
            var back = '<div class="alert-back-title">' + escH(bk[1].replace(/'s$/, "")) + " single-game list · " + LIST_WORD[stat] + " (" + L.floor + "+, " + L.games.length + " games)</div>"
              + top5.map(function (g) { return '<div class="alert-back-play"><span class="abp-time">' + g.value + "</span> · <strong>" + escH(g.player) + "</strong> · " + escH(g.team) + (g.opp ? " vs " + escH(g.opp) : "") + (g.date ? ", " + escH(g.date) : "") + "</div>"; }).join("")
              + '<div class="alert-back-play" style="font-weight:700"><span class="abp-time">' + v + "</span> · " + escH(name) + " tonight" + (made ? "" : " · " + (L.floor - v) + " to make it") + "</div>";
            fire("cc-list-" + (bk[0] === "NBA Cup" ? "cup-" : bk[0] === "Playoffs" ? "po-" : "") + p.id + "-" + stat + (made ? "-made" : "-near"), {
              type: "milestone", backHtml: back, icon: made ? (bk[0] !== "Regular season" && v >= top ? "🏆 " + (v > top ? "" : "TIES THE ") + (bk[0] === "NBA Cup" ? "NBA CUP" : "PLAYOFF") + " RECORD" : bk[0] === "NBA Cup" ? "🏆 CUP LIST" : "📜 ALL-TIME LIST") : "👀 " + (L.floor - v) + " FROM THE LIST",
              text: text,
              statLine: typeof fmtAlertStatLine === "function" ? fmtAlertStatLine([[v, LIST_WORD[stat].toUpperCase()]]) : "",
              sub: "Command Center · the NBA Guide's single-game lists (through 2025-26)" + (made && better < 3 ? " · NBA Live's record card covers the record itself" : ""),
              live: game.status === "live", gameId: game.id, gameTag: tag, gameScore: scr,
            });
          });
        });
      });
    });
  }

  // ---- v4: each franchise's single-game records (the 29 team media guides; records.json franchiseGame) ----
  var FG_GAP = { pts: 8, reb: 5, ast: 4, stl: 2, blk: 2, fg3m: 2 }; // "nearing the team record" window, live only
  function franchiseGameChecks(game, sides, box, tag, scr) {
    var R = state.records;
    var F = R && R.franchiseGame;
    if (!F || !F.teams) return;
    var post = false;
    try { post = typeof isPlayoffSlate === "function" && !!isPlayoffSlate(); } catch (e) { post = false; }
    if (post) return; // the guides' records here are regular season
    ["away", "home"].forEach(function (side) {
      var team = side === "away" ? sides.away : sides.home;
      var T = F.teams[team];
      if (!T) return;
      (box[side] || []).forEach(function (p) {
        if (!p || (p.min || 0) < 1) return;
        Object.keys(FG_GAP).forEach(function (stat) {
          var rec = T[stat];
          if (!rec || !rec.value) return;
          var v = Number(p[LIST_FIELD[stat]]) || 0;
          var made = v >= rec.value;
          if (!made && (game.status !== "live" || v < rec.value - FG_GAP[stat] || v < 0.75 * rec.value)) return;
          var name = p.name || p.displayName || p.shortName || ("#" + p.id);
          var holder = (rec.holders || [])[0] || "";
          var whose = T.name + (T.era ? " (" + T.era + ")" : "") + " record";
          var text = made
            ? name + " (" + team + ") — " + v + " " + LIST_WORD[stat] + ": " + (v > rec.value ? "breaks the " + whose + " (" + rec.value + ", " + holder + ")" : "ties the " + whose + " (" + rec.value + ", " + holder + (rec.holders.length > 1 ? " and " + (rec.holders.length - 1) + " more" : "") + ")")
            : name + " (" + team + ") — " + v + " " + LIST_WORD[stat] + ", " + (rec.value - v) + " from the " + whose + " (" + rec.value + ", " + holder + ")";
          fire("cc-fg-" + p.id + "-" + stat + (made ? (v > rec.value ? "-broke" : "-tied") : "-near"), {
            type: "milestone", icon: made ? (v > rec.value ? "🏛️ TEAM RECORD" : "🏛️ TIES TEAM RECORD") : "👀 " + (rec.value - v) + " FROM TEAM RECORD",
            text: text,
            statLine: typeof fmtAlertStatLine === "function" ? fmtAlertStatLine([[v, LIST_WORD[stat].toUpperCase()]]) : "",
            sub: "Command Center · " + (T.src || "team media guide") + " (through 2025-26)",
            live: game.status === "live", gameId: game.id, gameTag: tag, gameScore: scr,
          });
        });
      });
    });
  }

  // ---- v5: this season, from the Game Flow files (data/flowstats.json) ----
  var QTR = 720;
  var SEASON_TOP = 10, TEAM_TOP = 5;         // a place on the season's lists worth a card
  var Q_MIN = 15, H_MIN = 22, TQ_MIN = 40;    // and the least that can make one
  var LATE_RETURN = 180;                      // seconds past his usual return
  var LEAD = 15;                              // a lead lost is a card from here
  var LEAD_FROM = 20, LEAD_STEP = 5;          // lead context: from a 20-point lead, in steps of 5 (v10)
  var qName = function (q) { return ["1st", "2nd", "3rd", "4th"][q - 1] + " quarter"; };
  function elapsedNow(game) {
    var per = Number(game.period) || 1, c = String(game.clock || "").trim();
    var m = /^(\d+):(\d+)/.exec(c), left = m ? Number(m[1]) * 60 + Number(m[2]) : Math.round(parseFloat(c) || 0);
    return per <= 4 ? (per - 1) * QTR + (QTR - left) : 4 * QTR + (per - 5) * 300 + (300 - left);
  }
  function clockAt(t) {
    if (t == null) return "";
    var q = Math.min(4, Math.floor(t / QTR) + 1), left = q * QTR - t;
    if (left === QTR) return "to open the " + qName(q);
    if (t >= 4 * QTR) return "in overtime";
    return "Q" + q + " " + Math.floor(left / 60) + ":" + String(Math.round(left % 60)).padStart(2, "0");
  }
  var md = function (d) { return d ? Number(d.slice(5, 7)) + "/" + Number(d.slice(8, 10)) : ""; };
  function placeText(list, v, what) {
    var better = list.filter(function (x) { return x.pts > v; }).length;
    var tied = list.filter(function (x) { return x.pts === v; }).length;
    var best = list[0];
    var when = function (x) { return x.tonight ? "tonight" : md(x.date); };
    if (!better) return (tied ? "ties the most " : "the most ") + what + " this season" + (tied && best ? " (" + (best.name || best.team) + (best.opp ? " vs " + best.opp : "") + " " + when(best) + ")" : "");
    return (tied ? "tied for the " : "the ") + ord(better + 1) + "-most " + what + " this season (most: " + best.pts + ", " + (best.name || best.team) + (best.opp ? " vs " + best.opp : "") + " " + when(best) + ")";
  }
  // v9: the season's lists as they stand right now: the Game Flow files through last night, plus tonight's quarters,
  // halves and team quarters from every game NBA Live shows (so a 20-point quarter earlier tonight is on the list a
  // later one is measured against). Any of tonight's games a later build already holds is taken from NBA Live instead.
  function seasonLists() {
    if (state.seasonL && state.seasonAt === state.cycle) return state.seasonL;
    var F0 = state.flow || {}, ids = {}, tq = [], th = [], tt = [];
    (games() || []).forEach(function (g) {
      if (!g || (g.status !== "live" && g.status !== "final")) return;
      ids[String(g.id)] = 1;
      var lastQ = g.status === "final" ? 4 : Math.min(Number(g.period) || 0, 4);
      var T = { away: tri(g.away && g.away.tricode), home: tri(g.home && g.home.tricode) };
      ["away", "home"].forEach(function (side) {
        var team = T[side], opp = T[side === "away" ? "home" : "away"];
        (((g.boxscore || {})[side]) || []).forEach(function (p) {
          if (!p || !p.id) return;
          var q = (p.qtrPts || []).slice(0, 4).map(function (v) { return Math.min(Number(v) || 0, Number(p.pts) || 0); });
          var who = { id: String(p.id), name: p.name || ("#" + p.id), team: team, opp: opp, gameId: String(g.id), tonight: true };
          for (var k = 1; k <= lastQ; k++) if ((q[k - 1] || 0) >= Q_MIN) tq.push(Object.assign({ pts: q[k - 1], q: k }, who));
          [[1, 2], [3, 4]].forEach(function (h, j) {
            var v = (q[h[0] - 1] || 0) + (q[h[1] - 1] || 0);
            if (lastQ >= h[0] && v >= H_MIN) th.push(Object.assign({ pts: v, h: j + 1 }, who));
          });
        });
        var ls = (g[side] && g[side].linescores) || [];
        for (var k = 1; k <= lastQ; k++) { var tv = Number(ls[k - 1]) || 0; if (tv >= TQ_MIN) tt.push({ pts: tv, team: team, opp: opp, q: k, gameId: String(g.id), tonight: true }); }
      });
    });
    var old = function (x) { return !ids[String(x.gameId)]; }, by = function (a, b) { return b.pts - a.pts; };
    state.seasonAt = state.cycle;
    return (state.seasonL = { quarters: (F0.quarters || []).filter(old).concat(tq).sort(by), halves: (F0.halves || []).filter(old).concat(th).sort(by), teamQuarters: (F0.teamQuarters || []).filter(old).concat(tt).sort(by) });
  }
  // The back of a season card: the list's top rows with his own in bold (and added below if it's further down), then
  // the all-time mark from NBA Live's own book, when NBA Live has one.
  function seasonBack(title, list, isMe, rowText, rows, foot) {
    var place = function (x) { return list.filter(function (y) { return y.pts > x.pts; }).length + 1; };
    var row = function (x) { return '<div class="alert-back-play"' + (isMe(x) ? ' style="font-weight:700"' : "") + '><span class="abp-time">' + place(x) + ".</span> " + escH(rowText(x)) + " · <strong>" + x.pts + "</strong></div>"; };
    var top = list.slice(0, rows), me = list.filter(isMe)[0];
    var html = '<div class="alert-back-title">' + escH(title) + "</div>" + top.map(row).join("");
    if (me && top.indexOf(me) < 0) html += '<div class="alert-back-play" style="opacity:.6">…</div>' + row(me);
    (foot || []).forEach(function (f) { html += '<div class="alert-back-play" style="opacity:.75">' + escH(f) + "</div>"; });
    return html;
  }
  var whenOf = function (x) { return x.tonight ? "tonight" : md(x.date); };
  var qRow = function (x) { return (x.name || x.team) + (x.name ? " (" + x.team + ")" : "") + " · " + ["1st", "2nd", "3rd", "4th"][x.q - 1] + (x.opp ? " vs " + x.opp : "") + " " + whenOf(x); };
  var hRow = function (x) { return x.name + " (" + x.team + ") · " + (x.h === 2 ? "2nd" : "1st") + " half" + (x.opp ? " vs " + x.opp : "") + " " + whenOf(x); };
  // NBA Live's all-time marks (its NBA_SITUATIONAL_RECORDS / team-quarter book), read if they are there.
  function allTime(keys) {
    var out = [];
    keys.forEach(function (kv) {
      try {
        var B = kv[0] === "teamQuarter" ? (typeof NBA_TEAM_QUARTER_PTS !== "undefined" ? NBA_TEAM_QUARTER_PTS : null)
          : (typeof NBA_SITUATIONAL_RECORDS !== "undefined" ? NBA_SITUATIONAL_RECORDS[kv[0]] : null);
        if (B && typeof B.record === "number" && isFinite(B.record)) out.push(kv[1] + ": " + B.record + (B.holder ? " · " + B.holder : ""));
      } catch (e) { /* no book: no line */ }
    });
    return out;
  }
  // v9: NBA Live's own QUARTER EXPLOSION card (qexp-<game>-<player>-<period>) on its way through fireStory: when the
  // quarter is among the season's best, its season place goes on the front and the season's list under its all-time
  // list on the back. Anything unexpected and the card goes through exactly as NBA Live made it.
  function decorate(key, card) {
    var m = /^qexp-([^-]+)-([^-]+)-(\d+)$/.exec(String(key));
    if (!m || !card || !state.flow) return card;
    var k = Number(m[3]), game = (games() || []).filter(function (g) { return g && String(g.id) === m[1]; })[0];
    if (!game || k < 1 || k > 4) return card;
    var p = null;
    ["away", "home"].forEach(function (side) { (((game.boxscore || {})[side]) || []).forEach(function (x) { if (x && String(x.id) === m[2]) p = x; }); });
    if (!p) return card;
    var v = Math.min(Number((p.qtrPts || [])[k - 1]) || 0, Number(p.pts) || 0);
    var L = seasonLists().quarters, own = function (x) { return x.tonight && x.id === String(p.id) && x.q === k; };
    var others = L.filter(function (x) { return !own(x); });
    if (v < Q_MIN || placeOnList(others, v) > SEASON_TOP) { delete state.decorated[key]; return card; }
    state.decorated[key] = 1;
    var line = placeText(others, v, "in a quarter");
    return Object.assign({}, card, {
      sub: (card.sub ? card.sub + " · " : "") + line.charAt(0).toUpperCase() + line.slice(1),
      backHtml: (card.backHtml || "") + seasonBack("📅 This season · points in a quarter", L, own, qRow, 5),
    });
  }
  function dropCard(key) {
    var ex = typeof ALERT_STORIES !== "undefined" && ALERT_STORIES.get(key);
    if (ex) { if (ex.el) ex.el.remove(); ALERT_STORIES.delete(key); delete state.keys[key]; }
  }
  function onCourtNow(game) { try { return typeof computeOnCourt === "function" ? computeOnCourt(game) : null; } catch (e) { return null; } }
  function lastOut(game, id) {
    var P = game.plays || [];
    for (var k = 0; k < P.length; k++) if (P[k] && P[k].badge === "sub" && String(P[k].playerOutId) === String(id)) return P[k];
    return null;
  }
  // v7: has the play-by-play shown him on the floor in that period (a play of his, or a substitution in or out)?
  function onFloorIn(game, id, qtr) {
    var P = game.plays || [];
    for (var k = 0; k < P.length; k++) if (P[k] && P[k].qtr === qtr && (String(P[k].playerId) === String(id) || String(P[k].playerOutId) === String(id))) return true;
    return false;
  }
  // Has he come back in at any point (a substitution with him entering)?
  function cameBackIn(game, id) {
    var P = game.plays || [];
    for (var k = 0; k < P.length; k++) if (P[k] && P[k].badge === "sub" && String(P[k].playerId) === String(id)) return true;
    return false;
  }
  function feedReached(game, qtr) { var P = game.plays || []; for (var k = 0; k < P.length; k++) if (P[k] && P[k].qtr === qtr) return true; return false; }
  function flowChecks(game, sides, box, tag, scr) {
    var F0 = state.flow;
    if (!F0) return;
    // A later build can already hold tonight's game: never measure it against itself.
    var mine = function (x) { return String(x.gameId) !== String(game.id); };
    var mine2 = function (id) { return String(id) !== String(game.id); };
    var F = Object.assign({}, F0, { quarters: (F0.quarters || []).filter(mine), halves: (F0.halves || []).filter(mine), teamQuarters: (F0.teamQuarters || []).filter(mine), leads: {} });
    Object.keys(F0.leads || {}).forEach(function (t) { var x = F0.leads[t]; F.leads[t] = { gp: x.gp, blown: (x.blown || []).filter(mine), comebacks: (x.comebacks || []).filter(mine) }; });
    // The moment a card first fired, so its clock doesn't run on as NBA Live refreshes it.
    // A foul's time: a break between periods reads "at halftime" / "end of the 1st", not "to open".
    var foulClock = function (t) { var q = t / QTR; return t > 0 && t <= 4 * QTR && q === Math.round(q) ? (q === 2 ? "at halftime" : "end of the " + ["1st", "2nd", "3rd", "4th"][q - 1]) : clockAt(t); };
    var at = function (key) { return state.firstAt[key] || (state.firstAt[key] = live ? foulClock(now) : ""); };
    // In a blowout starters sit by design: no rotation cards then.
    var margin = Math.abs((Number(game.away && game.away.score) || 0) - (Number(game.home && game.home.score) || 0));
    var BLOWOUT = 25;
    var live = game.status === "live", per = Number(game.period) || 0;
    var now = live ? elapsedNow(game) : null;
    var court = live ? onCourtNow(game) : null;
    var stl = function (pairs) { return typeof fmtAlertStatLine === "function" ? fmtAlertStatLine(pairs) : ""; };
    var base = function (extra) { return Object.assign({ type: "milestone", live: live, gameId: game.id, gameTag: tag, gameScore: scr }, extra); };
    var through = F.games ? " (" + F.games + " games through last night, and tonight's)" : "";
    var S = seasonLists();
    ["away", "home"].forEach(function (side) {
      var team = side === "away" ? sides.away : sides.home, opp = side === "away" ? sides.home : sides.away;
      // 1. Quarters and halves among the season's best.
      var lastQ = game.status === "final" ? 4 : Math.min(per, 4);
      (box[side] || []).forEach(function (p) {
        if (!p || !p.id || (p.min || 0) < 1) return;
        var name = p.name || ("#" + p.id);
        var q = (p.qtrPts || []).slice(0, 4).map(function (v) { return Math.min(Number(v) || 0, Number(p.pts) || 0); });
        for (var k = 1; k <= lastQ; k++) {
          var v = q[k - 1] || 0;
          var ownQ = (function (k) { return function (x) { return x.tonight && x.id === String(p.id) && x.q === k; }; })(k);
          var othersQ = S.quarters.filter(function (x) { return !ownQ(x); });
          if (v < Q_MIN || placeOnList(othersQ, v) > SEASON_TOP) continue;
          // v9: while NBA Live's own card for this quarter is up and carries the season place, there is no second card.
          // Once NBA Live has dissolved its card (two quarters on), ours waits for the final rather than pop in mid-game.
          var sqKey = "cc-sq-" + p.id + "-" + k, theirs = "qexp-" + game.id + "-" + p.id + "-" + k;
          if (state.decorated[theirs] && typeof ALERT_STORIES !== "undefined" && ALERT_STORIES.get(theirs)) { state.merged[sqKey] = 1; dropCard(sqKey); continue; }
          if (state.merged[sqKey] && live) continue;
          fire(sqKey, base({ icon: "📅 SEASON-BEST QUARTER",
            text: name + " (" + team + ") — " + v + " points in the " + qName(k) + ": " + placeText(othersQ, v, "in a quarter"),
            backHtml: seasonBack("📅 This season · points in a quarter", S.quarters, ownQ, qRow, 10, allTime(k === 1 ? [["quarter", "NBA record"], ["firstQuarter", "1st-quarter record"]] : [["quarter", "NBA record"]])),
            statLine: stl([[v, "PTS IN Q" + k]]), sub: "Command Center · Game Flow files" + through }));
        }
        [[1, 2], [3, 4]].forEach(function (h, j) {
          if (lastQ < h[0]) return;
          var v = (q[h[0] - 1] || 0) + (q[h[1] - 1] || 0);
          var ownH = function (x) { return x.tonight && x.id === String(p.id) && x.h === j + 1; };
          var othersH = S.halves.filter(function (x) { return !ownH(x); });
          if (v < H_MIN || placeOnList(othersH, v) > SEASON_TOP) return;
          fire("cc-sh-" + p.id + "-" + (j + 1), base({ icon: "📅 SEASON-BEST HALF",
            backHtml: seasonBack("📅 This season · points in a half", S.halves, ownH, hRow, 10, allTime(j ? [["half", "NBA record"]] : [["half", "NBA record"], ["firstHalf", "1st-half record"]])),
            text: name + " (" + team + ") — " + v + " points in the " + (j ? "2nd" : "1st") + " half" + (live && per <= h[1] ? " so far" : "") + ": " + placeText(othersH, v, "in a half"),
            statLine: stl([[v, "PTS IN " + (j ? "2ND" : "1ST") + " HALF"]]), sub: "Command Center · Game Flow files" + through }));
        });
      });
      var ls = (game[side] && game[side].linescores) || [];
      for (var k = 1; k <= lastQ; k++) {
        var tv = Number(ls[k - 1]) || 0;
        var ownT = (function (k) { return function (x) { return x.tonight && x.team === team && x.gameId === String(game.id) && x.q === k; }; })(k);
        var othersT = S.teamQuarters.filter(function (x) { return !ownT(x); });
        if (tv < TQ_MIN || placeOnList(othersT, tv) > TEAM_TOP) continue;
        fire("cc-tq-" + game.id + "-" + team + "-" + k, base({ icon: "📅 SEASON-BEST TEAM QUARTER",
          backHtml: seasonBack("📅 This season · team points in a quarter", S.teamQuarters, ownT, qRow, 10, allTime([["teamQuarter", "NBA record"]])),
          text: team + " — " + tv + " points in the " + qName(k) + " vs " + opp + ": " + placeText(othersT, tv, "by a team in a quarter"),
          statLine: stl([[tv, "TEAM PTS IN Q" + k]]), sub: "Command Center · Game Flow files" + through }));
      }
      // 2. Foul trouble (live): more fouls than the period number, the coaching rule of thumb Game Flow uses.
      (box[side] || []).forEach(function (p) {
        if (!p || !p.id || (!live && !(Number(p.pf) >= 6))) return;
        var pf = Number(p.pf) || 0, name = p.name || ("#" + p.id);
        var R = (F.rotation || {})[p.id], Fo0 = (F.fouls || {})[p.id];
        var Fo = !Fo0 ? { trouble: 0, out: 0, gp: R ? R.gp : 0 } : !Fo0.outIn ? Fo0 : {   // tonight's own game, if a later build has it, comes out
          gp: Fo0.gp - ((Fo0.troubleIn || []).concat(Fo0.outIn).some(function (x) { return String(x) === String(game.id); }) ? 1 : 0),
          trouble: (Fo0.troubleIn || []).filter(mine2).length, out: Fo0.outIn.filter(mine2).length };
        // v8 (the user, 11/15): tonight's starters, players who start half their games or more, and 25.0 minutes a game or more.
        var regular = p.starter || (R && R.gp >= 3 && ((R.starts || 0) * 2 >= R.gp || (R.mpg || 0) >= 25));
        if (pf >= 6) {
          fire("cc-fo-" + p.id + "-" + game.id, base({ icon: "🚫 FOULED OUT",
            text: name + " (" + team + ") — fouled out" + (at("cc-fo-" + p.id + "-" + game.id) ? " " + at("cc-fo-" + p.id + "-" + game.id) : "") + " · " + (Fo.out ? "his " + ord(Fo.out + 1) + " foul-out this season" : "his first foul-out this season") + " · " + (p.pts || 0) + " pts in " + Math.round(p.min || 0) + " min",
            statLine: stl([[pf, "FOULS"]]), sub: "Command Center · Game Flow files" + through }));
          return;
        }
        if (!live || !regular || per < 1 || pf <= Math.min(per, 4)) return;
        fire("cc-ft-" + p.id + "-" + game.id, base({ icon: "⚠️ FOUL TROUBLE",
          text: name + " (" + team + ") — " + ord(pf) + " foul, " + at("cc-ft-" + p.id + "-" + pf) + " · " + (Fo.trouble ? "in early foul trouble in " + Fo.trouble + " of " + (Fo.gp || "?") + " games this season" + (Fo.out ? ", fouled out " + (Fo.out === 1 ? "once" : Fo.out + " times") : "") : "first time in early foul trouble this season"),
          statLine: stl([[pf, "FOULS"], [p.pts || 0, "PTS"], [Math.round(p.min || 0), "MIN"]]), sub: "Command Center · fouls above the period number (2 in the 1st, 3 by the half, 4 in the 3rd, 5 in the 4th)" }));
      });
      // 3. Rotation watch (live): a starter still out well past his usual return, or not out for the 3rd.
      // A regular reserve still waiting 3+ minutes past his usual first check-in (DNP or injury news often follows).
      // 0.61 (the user, 11/13: "the alert should go inactive once he returns"): a rotation card ends when he checks in.
      if (live && court && court[side]) (box[side] || []).forEach(function (p) {
        if (!p || !p.id) return;
        var onNow = court[side].has(p.id) || court[side].has(String(p.id));
        if (!onNow) return;
        ["cc-in-" + p.id + "-" + game.id, "cc-ret-" + p.id + "-" + game.id + "-h1", "cc-ret-" + p.id + "-" + game.id + "-h2"].forEach(function (k) {
          var ex = typeof ALERT_STORIES !== "undefined" && ALERT_STORIES.get(k);
          if (!ex || ex.ended || typeof endStory !== "function") return;
          state.done[k] = 1;
          endStory(k, (p.name || ("#" + p.id)) + " (" + team + ") is back in, " + clockAt(now) + " · " + String(ex.text).replace(/^.*?\) /, "").replace(/ · out since.*$/, ""));
        });
      });
      if (live && court && court[side] && margin < BLOWOUT) (box[side] || []).forEach(function (p) {
        if (!p || !p.id || p.starter || (p.min || 0) >= 1) return;
        if (court[side].has(p.id) || court[side].has(String(p.id))) return;
        var R = (F.rotation || {})[p.id];
        if (!R || R.in1 == null || !R.n || R.n.in1 < 5 || R.n.in1 < 0.7 * (R.gp - (R.starts || 0))) return;
        if (now < R.in1 + LATE_RETURN || now >= 2 * QTR) return;
        var name = p.name || ("#" + p.id);
        fire("cc-in-" + p.id + "-" + game.id, base({ icon: "🔄 HASN'T CHECKED IN",
          text: name + " (" + team + ") hasn't played yet · usually checks in by " + clockAt(R.in1) + " (median of " + R.n.in1 + " games off the bench)",
          statLine: stl([[0, "MIN"]]), sub: "Command Center · usual rotation from the Game Flow files · a DNP or injury may follow" }));
      });
      if (live && court && court[side] && margin < BLOWOUT) (box[side] || []).forEach(function (p) {
        if (!p || !p.id || !p.starter || (p.min || 0) < 1) return;
        if (court[side].has(p.id) || court[side].has(String(p.id))) return;
        var R = (F.rotation || {})[p.id];
        if (!R || (R.starts || 0) < 5) return;
        var name = p.name || ("#" + p.id), pf = Number(p.pf) || 0;
        var why = pf > Math.min(per, 4) ? " (" + pf + " fouls)" : "";
        var out = lastOut(game, p.id), outText = out ? " · out since " + (out.qtr || "") + " " + (out.clock || "") : "";
        // v7: not for a starter who already came back and is on a second rest.
        if (per <= 2 && R.back != null && R.n && R.n.back >= 5 && R.n.back >= 0.6 * R.starts && now >= R.back + LATE_RETURN && now < 2 * QTR && !cameBackIn(game, p.id)) {
          fire("cc-ret-" + p.id + "-" + game.id + "-h1", base({ icon: "🔄 STILL ON THE BENCH",
            text: name + " (" + team + ") hasn't come back in" + why + " · usually returns " + (R.back % QTR === 0 ? clockAt(R.back) : "by " + clockAt(R.back)) + " (median of " + R.n.back + " starts)" + outText,
            statLine: stl([[Math.round(p.min || 0), "MIN"], [p.pts || 0, "PTS"]]), sub: "Command Center · usual rotation from the Game Flow files · worth a look for an injury" }));
        }
        // v7: only if the play-by-play has reached the 3rd and hasn't shown him on the floor in it. Before, a starter who
        // opened the 3rd and sat inside its first six minutes got this card ("didn't start the 3rd · out since Q3 6:53").
        if (per === 3 && now >= 2 * QTR + 60 && now < 2 * QTR + 360 && (R.open3 || 0) >= 0.8 * R.starts && R.starts >= 5 && feedReached(game, "Q3") && !onFloorIn(game, p.id, "Q3")) {
          fire("cc-ret-" + p.id + "-" + game.id + "-h2", base({ icon: "🔄 NOT OUT FOR THE 3RD",
            text: name + " (" + team + ") didn't start the 3rd quarter" + why + " · he opened the 3rd in " + R.open3 + " of " + R.starts + " starts this season" + outText,
            statLine: stl([[Math.round(p.min || 0), "MIN"], [p.pts || 0, "PTS"]]), sub: "Command Center · usual rotation from the Game Flow files · worth a look for an injury" }));
        }
      });
    });
    // 4. Leads: a big lead with each side's season record at that size (v10: from 20, in steps of 5), and a lead lost.
    var L = F.leads || {};
    var a = Number(game.away && game.away.score) || 0, h = Number(game.home && game.home.score) || 0;
    var M = state.maxLead[game.id] || (state.maxLead[game.id] = { away: 0, home: 0 });
    M.away = Math.max(M.away, a - h, Number(game.away && game.away.biggestLead) || 0);
    M.home = Math.max(M.home, h - a, Number(game.home && game.home.biggestLead) || 0);
    var sized = function (tri, key, min) { return ((L[tri] && L[tri][key]) || []).filter(function (x) { return (key === "blown" ? x.lead : x.down) >= min; }); };
    var rankOf = function (key, tri, min) {
      var n = sized(tri, key, min).length;
      var more = Object.keys(L).filter(function (t) { return sized(t, key, min).length > n; }).length;
      return n && !more ? (Object.keys(L).some(function (t) { return t !== tri && sized(t, key, min).length === n; }) ? " (tied for the most in the NBA)" : " (the most in the NBA)") : "";
    };
    var record = function (tri, key, word, min) {
      var xs = sized(tri, key, min);
      if (!xs.length) return "";
      var x = xs[xs.length - 1];
      return tri + " have " + word + " " + (xs.length === 1 ? "once" : xs.length + " times") + " this season" + rankOf(key, tri, min) + " (last: " + (key === "blown" ? x.lead + "-point lead" : x.down + " down") + " vs " + x.opp + " " + md(x.date) + ", " + x.score + ")";
    };
    ["away", "home"].forEach(function (side) {
      var team = side === "away" ? sides.away : sides.home, other = side === "away" ? sides.home : sides.away;
      var lead = side === "away" ? a - h : h - a;
      // v10: the lead that could be lost is the biggest one of the game, so the step only goes up: 20, 25, 30…
      var step = Math.floor(Math.max(M[side], lead) / LEAD_STEP) * LEAD_STEP;
      if (live && lead >= LEAD_FROM) {
        var bits = [record(team, "blown", "lost a " + step + "-point lead", step), record(other, "comebacks", "come back from " + step + " down", step)].filter(Boolean);
        if (bits.length) fire("cc-lead-" + game.id + "-" + team, base({ icon: "📊 LEAD CONTEXT",
          text: team + " lead " + other + " by " + lead + (M[side] >= lead + LEAD_STEP ? " (by as many as " + M[side] + ")" : "") + " · " + bits.join(" · "), statLine: stl([[lead, "LEAD"]]),
          sub: "Command Center · leads of " + step + "+ lost and won back this season, from the Game Flow files" }));
        else dropCard("cc-lead-" + game.id + "-" + team);     // grown past anything lost or won back this season
      }
      var won = side === "away" ? a > h : h > a;
      if (game.status === "final" && !won && M[side] >= LEAD) {
        var lost = Math.max(LEAD, Math.floor(M[side] / LEAD_STEP) * LEAD_STEP);   // v10: counted at its own size
        var n = sized(team, "blown", lost).length + 1;
        fire("cc-blown-" + game.id + "-" + team, base({ icon: "📉 LEAD LOST",
          text: team + " lost a " + M[side] + "-point lead to " + other + " · their " + ord(n) + " lost lead of " + lost + "+ this season" + "; " + other + "'s " + ord(sized(other, "comebacks", lost).length + 1) + " comeback from " + lost + "+ down",
          statLine: stl([[M[side], "LEAD LOST"]]), sub: "Command Center · Game Flow files" + through }));
      }
    });
  }
  // v6 (0.71): a defense that hadn't allowed a 30-point game (or 40) this season allows one tonight.
  function defenseChecks(game, sides, box, tag, scr) {
    var D = state.tonight && state.tonight.defense;
    if (!D || !D.teams) return;
    var T = D.teams, tris = Object.keys(T);
    [[30, "t30", 3, D.n30], [40, "t40", 2, D.n40]].forEach(function (b) {
      var zero = tris.filter(function (t) { return T[t][b[1]] === 0; });
      if (!zero.length || zero.length > b[2]) return;
      ["away", "home"].forEach(function (side) {
        var def = side === "away" ? sides.home : sides.away;
        if (zero.indexOf(def) < 0) return;
        (box[side] || []).forEach(function (p) {
          if (!p || !p.id || (Number(p.pts) || 0) < b[0]) return;
          var others = zero.filter(function (t) { return t !== def; });
          fire("cc-def" + b[0] + "-" + game.id + "-" + p.id, { type: "milestone", icon: "🛡️ FIRST " + b[0] + " ALLOWED",
            text: (p.name || ("#" + p.id)) + " (" + (side === "away" ? sides.away : sides.home) + ") has " + p.pts + " — the first " + b[0] + "-point game " + def + " has allowed this season (" + (T[def].gp || "?") + " games)",
            statLine: typeof fmtAlertStatLine === "function" ? fmtAlertStatLine([[p.pts, "PTS"], [p.reb || 0, "REB"], [p.ast || 0, "AST"]]) : "",
            sub: "Command Center · " + (others.length ? "one of " + zero.length + " teams without one (" + others.join(", ") + ")" : "it was the only team without one") + "; " + b[3] + " across the league before tonight",
            live: game.status === "live", gameId: game.id, gameTag: tag, gameScore: scr });
        });
      });
    });
  }
  // Pre-game: tonight's foul-prone regulars (early foul trouble in half their games or more), one card a game.
  function foulWatch(game, sides, tag) {
    var F = state.flow;
    if (!F || !F.fouls) return;
    var who = [];
    Object.keys(F.fouls).forEach(function (id) {
      var f = F.fouls[id], r = (F.rotation || {})[id];
      if ((f.team !== sides.away && f.team !== sides.home) || !r || f.gp < 5 || (r.starts || 0) < f.gp / 2 || f.trouble < 0.5 * f.gp) return;
      who.push(f);
    });
    if (!who.length) return;
    who.sort(function (a, b) { return b.trouble / b.gp - a.trouble / a.gp; });
    fire("cc-foulwatch-" + game.id, { type: "milestone", icon: "⚠️ FOUL WATCH",
      text: who.map(function (f) { return f.name + " (" + f.team + ") early foul trouble in " + f.trouble + " of " + f.gp + (f.out ? ", fouled out " + f.out + "x" : ""); }).join(" · "),
      sub: "Command Center · fouls above the period number (2 in the 1st, 3 by the half…) this season, from the Game Flow files",
      live: false, gameId: game.id, gameTag: tag, gameScore: "Pre-game" });
  }
  function placeOnList(list, v) { return (list || []).filter(function (x) { return x.pts > v; }).length + 1; }

  // NBA Live updates a card in place when its key repeats; count distinct cards, not calls.
  function fire(key, card) {
    if (state.done[key]) return;            // a card ended for good (a rotation card once he came back)
    fireStory(key, card); state.keys[key] = 1; state.fired = Object.keys(state.keys).length;
  }

  var plural = function (n, label) { return n === 1 ? String(label).replace(/s\b(?=[^s]*$)/, "") : label; };

  // One item's part of a player's card (0.63: one card per player and game; the user, 11/13: "try to merge alerts for
  // the same player when possible": Castle reaching 2,500 points and 900 assists in the same minute was two cards).
  function part(i, v, was) {
    var label = i.label || i.stat;
    var need = i.need - v;
    var goal = Number(i.target).toLocaleString();
    var who = i.kind === "pass"
      ? (i.passing && i.passing.player) + (i.passing && i.passing.rank ? " (#" + i.passing.rank + ")" : "") + " " + (SCOPE[i.scope] || "")
      : goal + " " + label + " " + (SCOPE[i.scope] || "");
    var board = i.kind === "pass" && i.scope === "franchise" ? recBoard({ kind: "franchise", team: i.team, stat: i.stat })
      : i.kind === "pass" && i.scope === "nba" ? recBoard({ kind: "pass", stat: i.stat }) : null;
    return {
      i: i, v: v, need: need, label: label, reached: need <= 0,
      did: i.kind === "pass" ? "passes " + who + " (" + label + ")" : "reaches " + who,
      undone: need > 0 && was != null,
      left: (need > 0 && was != null ? "taken back by a stat change (" + label + " tonight " + was + " → " + v + "): " : "") + need + " " + plural(need, label) + " from " + (i.kind === "pass" ? "passing " : "") + who,
      icon: need <= 0 ? (i.kind === "pass" ? "🎉 PASSED" : "🎉 " + goal) : was != null ? "↩️ TAKEN BACK" : "🎯 " + need + " FROM " + (i.kind === "pass" ? "PASSING" : goal),
      back: board ? boardBack((i.scope === "franchise" ? "🏛️ " + i.team + " history" : "📜 All-time") + " · " + label, liveRows(board, i.stat, i.player), i.player, (Number(i.current) || 0) + v) : null,
      flag: i.publishable ? "verified" : "review" + (i.review && i.review[0] ? ": " + i.review[0] : ""),
    };
  }
  function playerCard(game, items, tag, scr) {
    var parts = items.map(function (x) { return part(x.i, x.v, x.was); });
    var done = parts.filter(function (x) { return x.reached; }), todo = parts.filter(function (x) { return !x.reached; }).sort(function (a, b) { return (b.undone ? 1 : 0) - (a.undone ? 1 : 0) || a.need - b.need; });
    var i0 = parts[0].i;
    // "reaches 2,500 points and 900 assists career": rungs of the same kind read as one phrase.
    var phrase = function (list) {
      var rounds = list.filter(function (x) { return x.i.kind !== "pass" && x.i.scope === list[0].i.scope; });
      if (rounds.length === list.length && rounds.length > 1)
        return "reaches " + rounds.map(function (x) { return Number(x.i.target).toLocaleString() + " " + x.label; }).join(" and ") + " " + (SCOPE[rounds[0].i.scope] || "");
      return list.map(function (x) { return x.did; }).join(" · ");
    };
    var text = i0.player + " (" + i0.team + ") — " + (done.length ? phrase(done) + (todo.length ? " · " + todo[0].left : "") : todo.map(function (x) { return x.left; }).join(" · "));
    var stat = [], seen = {};
    parts.forEach(function (x) { if (!seen[x.label]) { seen[x.label] = 1; stat.push([x.v, String(x.label).toUpperCase() + " TONIGHT"]); } });
    if (!done.length && todo.length === 1) stat.push([todo[0].need, "TO GO"]);
    var lead = todo[0] && todo[0].undone ? todo[0] : (done[0] || todo[0]);
    fire("cc-" + i0.espnId + "-" + game.id + "-watch", {
      type: "milestone", backHtml: (done.concat(todo).find(function (x) { return x.back; }) || {}).back || null,
      icon: lead.undone ? lead.icon : done.length > 1 ? "🎉 MILESTONES" : lead.icon,
      text: text,
      statLine: typeof fmtAlertStatLine === "function" ? fmtAlertStatLine(stat) : "",
      sub: "Command Center · pre-game " + pct(lead.i.pTonight) + " · importance " + lead.i.importance + " · " + lead.flag,
      live: game.status === "live", gameId: game.id, gameTag: tag, gameScore: scr,
    });
  }

  function connect() {
    state.connected = has("fireStory") && typeof fireStory === "function" && has("runAlertChecks") && typeof runAlertChecks === "function" && Array.isArray(games());
    if (!state.connected) return status();
    // v9: NBA Live's quarter card picks up the season place on its way to the screen; any failure passes it through untouched.
    var fire0 = fireStory;
    fireStory = function (key, card) {
      var out = card;
      try { out = decorate(key, card) || card; } catch (e) { out = card; state.decorateError = String(e && e.message || e); }
      return fire0.call(this, key, out);
    };
    var original = runAlertChecks;
    // Wrap NBA Live's check cycle: its own checks first, ours after, and ours can't break it.
    runAlertChecks = function () {
      var r = original.apply(this, arguments);
      try { checks(); } catch (e) { state.error = "bridge: " + e.message; status(); if (window.console) console.warn("[cc-bridge]", e); }
      return r;
    };
    load();
    setInterval(load, REFRESH_MS);
  }

  if (document.readyState === "complete") connect();
  else window.addEventListener("load", connect);
})();
