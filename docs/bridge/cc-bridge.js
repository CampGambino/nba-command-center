/*
 * NBA Command Center -> NBA Live bridge.                                  version 5
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
 *       a 15-point lead with the season's record of leads lost and comebacks, and a 15-point lead lost.
 *
 * What it never does
 *   - change NBA Live's own checks, data or cards;
 *   - throw: if NBA Live's hooks (fireStory, runAlertChecks, GAMES) are missing or renamed,
 *     it shows a small "Command Center: not connected" note and stays idle.
 *
 * Options (URL): ?cc=<watch.json address>   ?cc=off  (disable)
 */
(function () {
  "use strict";
  var VERSION = 5;
  var DEFAULT_URL = "https://campgambino.github.io/nba-command-center/data/watch.json";
  var REFRESH_MS = 15 * 60 * 1000;
  // Editorial gate, in NBA Live's spirit ("a rung nobody celebrates produces a card nobody wants"):
  var MIN_CHANCE = 0.10;      // pre-game chance tonight needed to take a card while live
  var MIN_IMPORTANCE = 15;    // round numbers below this never get a card (passes always can). Was 20 until 0.15.2; tune from use
  var MAX_PER_GAME = 6;       // in-play cards per game, best first (reached ones always show)
  var PRE_PER_GAME = 3;       // pre-game storyline cards per game
  var ICON = { history: "📜 FROM THE NOTES", injury: "🩹 INJURY", milestone: "🎯 IN REACH", streak: "🔥 STREAK", lead: "👑 TEAM LEADER", shooting: "🏹 50/40/90", team: "📈 TEAM STREAK", record: "🏛️ RECORD WATCH", context: "📊 CAREER CONTEXT" };

  // ESPN abbreviations NBA Live shows -> Command Center tricodes.
  var TRI = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", PHO: "PHX", BRK: "BKN", CHO: "CHA" };
  var tri = function (t) { t = String(t || "").toUpperCase(); return TRI[t] || t; };

  // Command Center stat -> NBA Live box-score field.
  var FIELD = { pts: "pts", reb: "reb", ast: "ast", stl: "stl", blk: "blk", fg3m: "tpm", ftm: "ftm", fgm: "fgm", dreb: "dreb", oreb: "oreb", min: "min" };
  // NBA Live's own ladders (MILESTONE_LADDERS): those round numbers are already its cards.
  var NBA_LIVE_STAT = { pts: "pts", fg3m: "tpm", reb: "reb", ast: "ast", stl: "stl", blk: "blk" };

  var state = { data: null, items: [], tonight: null, records: null, recItems: [], bests: null, flow: null, maxLead: {}, firstAt: {}, loadedAt: 0, error: null, connected: false, fired: 0, keys: {} };
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
  function pregame(game, sides, tag) {
    var T = state.tonight;
    if (!T || (state.data && T.today !== state.data.today)) return;
    var g = T.games.find(function (x) { return x.away === sides.away && x.home === sides.home; });
    if (!g) return;
    g.lines.slice(0, PRE_PER_GAME).forEach(function (l, n) {
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
    note("Command Center: " + state.items.length + " milestones" + (state.recItems.length ? " + " + state.recItems.length + " records" : "") + (d ? " for " + d : "") + (state.fired ? " · " + state.fired + " cards" : ""));
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
    var G = games();
    if (!G || (!state.items.length && !state.flow)) return;
    var night = nbaLiveNight();
    var otherNight = !!(night && state.data && state.data.today && night !== state.data.today);
    state.wrongNight = otherNight ? night : null;
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
      if (game.status !== "live" && game.status !== "final") return pregame(game, sides, tag);
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
        if (i.kind !== "pass" && i.importance < MIN_IMPORTANCE) return;   // a rung nobody celebrates, reached or not
        if (game.status === "final" && !reachedTonight) return;          // a final game: only what fell in it
        if (!reachedTonight) {
          if ((p.min || 0) < 1) return;                                  // not a story until he plays
          if ((i.pTonight || 0) < MIN_CHANCE) return;                    // not in play tonight
        }                                                                // (a surprise reach always shows)
        picks.push({ i: i, v: v, reached: reachedTonight, rank: reachedTonight ? 1e9 : (i.pTonight || 0) * i.importance });
      });
      picks.sort(function (a, b) { return b.rank - a.rank; });
      picks.filter(function (x, k) { return x.reached || k < MAX_PER_GAME; }).forEach(function (x) { card(game, x.i, x.v, tag, scr); });
      try { recordChecks(game, sides, box, tag, scr); } catch (e) { state.recError = String(e && e.message || e); }
      try { listChecks(game, sides, box, tag, scr); } catch (e) { state.listError = String(e && e.message || e); }
      try { franchiseGameChecks(game, sides, box, tag, scr); } catch (e) { state.fgError = String(e && e.message || e); }
      try { flowChecks(game, sides, box, tag, scr); } catch (e) { state.flowCheckError = String(e && e.message || e); }
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
      if (game.status === "final" && !reached) return;
      if (!reached && ((p.min || 0) < 1 || (r.pTonight || 0) < MIN_CHANCE)) return;
      picks.push({ r: r, v: v, reached: reached, rank: reached ? 1e9 : (r.pTonight || 0) * (r.score || 1) });
    });
    picks.sort(function (a, b) { return b.rank - a.rank; });
    picks.filter(function (x, k) { return x.reached || k < MAX_PER_GAME; }).forEach(function (x) {
      var r = x.r, left = r.need - x.v, label = r.label || r.stat;
      // The item's text is pre-game ("Curry: 2 3-pointers from passing ..."): re-say it for now.
      var what = String(r.text || "").split(" from ").slice(1).join(" from ").replace(/;\s*[\d,]+ ties him$/, "");
      var text = left <= 0
        ? r.who + " (" + r.team + ") — " + (r.kind === "round" ? "reaches " + what : what.replace(/^passing /, "passes "))
        : r.who + " (" + r.team + ") — " + left + " " + plural(left, label) + " from " + what;
      var stat = [[x.v, String(label).toUpperCase() + " TONIGHT"]];
      if (left > 0) stat.push([left, "TO GO"]);
      fire("cc-rec-" + r.id + "-" + r.stat + "-" + r.kind + "-" + r.target, {
        type: "milestone",
        icon: left <= 0 ? (r.rank === 1 ? "🏆 RECORD" : "🎉 " + (r.kind === "cup" ? "CUP HISTORY" : r.kind === "franchise" ? "FRANCHISE HISTORY" : r.kind === "round" ? Number(r.target).toLocaleString() : "PASSED")) : "📈 " + left + " TO GO",
        text: text,
        statLine: typeof fmtAlertStatLine === "function" ? fmtAlertStatLine(stat) : "",
        sub: "Command Center · career records (" + (r.kind === "cup" ? "NBA Cup" : r.kind === "franchise" ? "franchise" : "all-time") + ") · pre-game " + pct(r.pTonight),
        live: game.status === "live", gameId: game.id, gameTag: tag, gameScore: scr,
      });
    });
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
            if (!made && (game.status !== "live" || v < L.floor - LIST_GAP[stat])) return;
            var team = side === "away" ? sides.away : sides.home;
            var name = p.name || p.displayName || p.shortName || ("#" + p.id);
            var better = L.games.filter(function (g) { return g.value > v; }).length;
            var tied = L.games.filter(function (g) { return g.value === v; }).length;
            var top = L.games.reduce(function (a, g) { return Math.max(a, g.value); }, 0);
            var text = made
              ? name + " (" + team + ") — " + v + " " + LIST_WORD[stat] + ": " + (v > top ? "the most in a game in " + bk[1].replace(/'s$/, "") + " history" : (tied ? "tied for " : "") + "the " + ord(better + 1) + "-most in a game on the " + bk[1] + " list") + " (" + L.games.length + " games of " + L.floor + "+)"
              : name + " (" + team + ") — " + v + " " + LIST_WORD[stat] + ", " + (L.floor - v) + " from the " + bk[1] + " single-game list (" + L.floor + "+, " + L.games.length + " games)";
            fire("cc-list-" + (bk[0] === "NBA Cup" ? "cup-" : bk[0] === "Playoffs" ? "po-" : "") + p.id + "-" + stat + (made ? "-made" : "-near"), {
              type: "milestone", icon: made ? (bk[0] === "NBA Cup" ? "🏆 CUP LIST" : "📜 ALL-TIME LIST") : "👀 " + (L.floor - v) + " FROM THE LIST",
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
  var LEAD = 15;
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
    if (!better) return (tied ? "ties the most " : "the most ") + what + " this season" + (tied && best ? " (" + (best.name || best.team) + (best.opp ? " vs " + best.opp : "") + " " + md(best.date) + ")" : "");
    return (tied ? "tied for the " : "the ") + ord(better + 1) + "-most " + what + " this season (most: " + best.pts + ", " + (best.name || best.team) + (best.opp ? " vs " + best.opp : "") + " " + md(best.date) + ")";
  }
  function onCourtNow(game) { try { return typeof computeOnCourt === "function" ? computeOnCourt(game) : null; } catch (e) { return null; } }
  function lastOut(game, id) {
    var P = game.plays || [];
    for (var k = 0; k < P.length; k++) if (P[k] && P[k].badge === "sub" && String(P[k].playerOutId) === String(id)) return P[k];
    return null;
  }
  function flowChecks(game, sides, box, tag, scr) {
    var F0 = state.flow;
    if (!F0) return;
    // A later build can already hold tonight's game: never measure it against itself.
    var mine = function (x) { return String(x.gameId) !== String(game.id); };
    var mine2 = function (id) { return String(id) !== String(game.id); };
    var F = Object.assign({}, F0, { quarters: (F0.quarters || []).filter(mine), halves: (F0.halves || []).filter(mine), teamQuarters: (F0.teamQuarters || []).filter(mine), leads: {} });
    Object.keys(F0.leads || {}).forEach(function (t) { var x = F0.leads[t]; F.leads[t] = { gp: x.gp, blown: (x.blown || []).filter(mine), comebacks: (x.comebacks || []).filter(mine) }; });
    // The moment a card first fired, so its clock doesn't run on as NBA Live refreshes it.
    var at = function (key) { return state.firstAt[key] || (state.firstAt[key] = live ? clockAt(now) : ""); };
    var live = game.status === "live", per = Number(game.period) || 0;
    var now = live ? elapsedNow(game) : null;
    var court = live ? onCourtNow(game) : null;
    var stl = function (pairs) { return typeof fmtAlertStatLine === "function" ? fmtAlertStatLine(pairs) : ""; };
    var base = function (extra) { return Object.assign({ type: "milestone", live: live, gameId: game.id, gameTag: tag, gameScore: scr }, extra); };
    var through = F.games ? " (" + F.games + " games through last night)" : "";
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
          if (v < Q_MIN || placeOnList(F.quarters, v) > SEASON_TOP) continue;
          fire("cc-sq-" + p.id + "-" + k, base({ icon: "📅 SEASON-BEST QUARTER",
            text: name + " (" + team + ") — " + v + " points in the " + qName(k) + ": " + placeText(F.quarters, v, "in a quarter"),
            statLine: stl([[v, "PTS IN Q" + k]]), sub: "Command Center · Game Flow files" + through }));
        }
        [[1, 2], [3, 4]].forEach(function (h, j) {
          if (lastQ < h[0]) return;
          var v = (q[h[0] - 1] || 0) + (q[h[1] - 1] || 0);
          if (v < H_MIN || placeOnList(F.halves, v) > SEASON_TOP) return;
          fire("cc-sh-" + p.id + "-" + (j + 1), base({ icon: "📅 SEASON-BEST HALF",
            text: name + " (" + team + ") — " + v + " points in the " + (j ? "2nd" : "1st") + " half" + (live && per <= h[1] ? " so far" : "") + ": " + placeText(F.halves, v, "in a half"),
            statLine: stl([[v, "PTS IN " + (j ? "2ND" : "1ST") + " HALF"]]), sub: "Command Center · Game Flow files" + through }));
        });
      });
      var ls = (game[side] && game[side].linescores) || [];
      for (var k = 1; k <= lastQ; k++) {
        var tv = Number(ls[k - 1]) || 0;
        if (tv < TQ_MIN || placeOnList(F.teamQuarters, tv) > TEAM_TOP) continue;
        fire("cc-tq-" + game.id + "-" + team + "-" + k, base({ icon: "📅 SEASON-BEST TEAM QUARTER",
          text: team + " — " + tv + " points in the " + qName(k) + " vs " + opp + ": " + placeText(F.teamQuarters, tv, "by a team in a quarter"),
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
        var regular = p.starter || (R && R.gp >= 3 && (R.starts || 0) >= 1) || (p.min || 0) >= 15;
        if (pf >= 6) {
          fire("cc-fo-" + p.id + "-" + game.id, base({ icon: "🚫 FOULED OUT",
            text: name + " (" + team + ") — fouled out" + (at("cc-fo-" + p.id + "-" + game.id) ? " " + at("cc-fo-" + p.id + "-" + game.id) : "") + " · " + (Fo.out ? "his " + ord(Fo.out + 1) + " foul-out this season" : "his first foul-out this season") + " · " + (p.pts || 0) + " pts in " + Math.round(p.min || 0) + " min",
            statLine: stl([[pf, "FOULS"]]), sub: "Command Center · Game Flow files" + through }));
          return;
        }
        if (!live || !regular || per < 1 || pf <= Math.min(per, 4)) return;
        fire("cc-ft-" + p.id + "-" + pf, base({ icon: "⚠️ FOUL TROUBLE",
          text: name + " (" + team + ") — " + ord(pf) + " foul, " + at("cc-ft-" + p.id + "-" + pf) + " · " + (Fo.trouble ? "in early foul trouble in " + Fo.trouble + " of " + (Fo.gp || "?") + " games this season" + (Fo.out ? ", fouled out " + (Fo.out === 1 ? "once" : Fo.out + " times") : "") : "first time in early foul trouble this season"),
          statLine: stl([[pf, "FOULS"], [p.pts || 0, "PTS"], [Math.round(p.min || 0), "MIN"]]), sub: "Command Center · fouls above the period number (2 in the 1st, 3 by the half, 4 in the 3rd, 5 in the 4th)" }));
      });
      // 3. Rotation watch (live): a starter still out well past his usual return, or not out for the 3rd.
      if (live && court && court[side]) (box[side] || []).forEach(function (p) {
        if (!p || !p.id || !p.starter || (p.min || 0) < 1) return;
        if (court[side].has(p.id) || court[side].has(String(p.id))) return;
        var R = (F.rotation || {})[p.id];
        if (!R || (R.starts || 0) < 5) return;
        var name = p.name || ("#" + p.id), pf = Number(p.pf) || 0;
        var why = pf > Math.min(per, 4) ? " (" + pf + " fouls)" : "";
        var out = lastOut(game, p.id), outText = out ? " · out since " + (out.qtr || "") + " " + (out.clock || "") : "";
        if (per <= 2 && R.back != null && R.n && R.n.back >= 5 && R.n.back >= 0.6 * R.starts && now >= R.back + LATE_RETURN && now < 2 * QTR) {
          fire("cc-ret-" + p.id + "-" + game.id + "-h1", base({ icon: "🔄 STILL ON THE BENCH",
            text: name + " (" + team + ") hasn't come back in" + why + " · usually returns " + (R.back % QTR === 0 ? clockAt(R.back) : "by " + clockAt(R.back)) + " (median of " + R.n.back + " starts)" + outText,
            statLine: stl([[Math.round(p.min || 0), "MIN"], [p.pts || 0, "PTS"]]), sub: "Command Center · usual rotation from the Game Flow files · worth a look for an injury" }));
        }
        if (per === 3 && now >= 2 * QTR + 30 && now < 2 * QTR + 360 && (R.open3 || 0) >= 0.8 * R.starts && R.starts >= 5) {
          fire("cc-ret-" + p.id + "-" + game.id + "-h2", base({ icon: "🔄 NOT OUT FOR THE 3RD",
            text: name + " (" + team + ") didn't start the 3rd quarter" + why + " · he opened the 3rd in " + R.open3 + " of " + R.starts + " starts this season" + outText,
            statLine: stl([[Math.round(p.min || 0), "MIN"], [p.pts || 0, "PTS"]]), sub: "Command Center · usual rotation from the Game Flow files · worth a look for an injury" }));
        }
      });
    });
    // 4. Leads: a 15-point lead with each side's season record, and a 15-point lead lost.
    var L = F.leads || {};
    var a = Number(game.away && game.away.score) || 0, h = Number(game.home && game.home.score) || 0;
    var M = state.maxLead[game.id] || (state.maxLead[game.id] = { away: 0, home: 0 });
    M.away = Math.max(M.away, a - h, Number(game.away && game.away.biggestLead) || 0);
    M.home = Math.max(M.home, h - a, Number(game.home && game.home.biggestLead) || 0);
    var rankOf = function (key, tri) {
      var n = (L[tri] && L[tri][key] || []).length;
      var more = Object.keys(L).filter(function (t) { return (L[t][key] || []).length > n; }).length;
      return n && !more ? (Object.keys(L).some(function (t) { return t !== tri && (L[t][key] || []).length === n; }) ? " (tied for the most in the NBA)" : " (the most in the NBA)") : "";
    };
    var record = function (tri, key, word) {
      var xs = (L[tri] && L[tri][key]) || [];
      if (!xs.length) return "";
      var x = xs[xs.length - 1];
      return tri + " have " + word + " " + (xs.length === 1 ? "once" : xs.length + " times") + " this season" + rankOf(key, tri) + " (last: " + (key === "blown" ? x.lead + "-point lead" : x.down + " down") + " vs " + x.opp + " " + md(x.date) + ", " + x.score + ")";
    };
    ["away", "home"].forEach(function (side) {
      var team = side === "away" ? sides.away : sides.home, other = side === "away" ? sides.home : sides.away;
      var lead = side === "away" ? a - h : h - a;
      if (live && lead >= LEAD) {
        var bits = [record(team, "blown", "lost a " + LEAD + "-point lead"), record(other, "comebacks", "come back from " + LEAD + " down")].filter(Boolean);
        if (bits.length) fire("cc-lead-" + game.id + "-" + team, base({ icon: "📊 LEAD CONTEXT",
          text: team + " lead " + other + " by " + lead + " · " + bits.join(" · "), statLine: stl([[lead, "LEAD"]]),
          sub: "Command Center · leads of " + LEAD + "+ lost and won back this season, from the Game Flow files" }));
      }
      var won = side === "away" ? a > h : h > a;
      if (game.status === "final" && !won && M[side] >= LEAD) {
        var n = ((L[team] && L[team].blown) || []).length + 1;
        fire("cc-blown-" + game.id + "-" + team, base({ icon: "📉 LEAD LOST",
          text: team + " lost a " + M[side] + "-point lead to " + other + " · their " + ord(n) + " lost lead of " + LEAD + "+ this season" + "; " + other + "'s " + ord((((L[other] && L[other].comebacks) || []).length) + 1) + " comeback from " + LEAD + "+ down",
          statLine: stl([[M[side], "LEAD LOST"]]), sub: "Command Center · Game Flow files" + through }));
      }
    });
  }
  function placeOnList(list, v) { return (list || []).filter(function (x) { return x.pts > v; }).length + 1; }

  // NBA Live updates a card in place when its key repeats; count distinct cards, not calls.
  function fire(key, card) { fireStory(key, card); state.keys[key] = 1; state.fired = Object.keys(state.keys).length; }

  var plural = function (n, label) { return n === 1 ? String(label).replace(/s\b(?=[^s]*$)/, "") : label; };

  function card(game, i, v, tag, scr) {
    var label = i.label || i.stat;
    var need = i.need - v;
    var goal = Number(i.target).toLocaleString();
    var who = i.kind === "pass"
      ? (i.passing && i.passing.player) + (i.passing && i.passing.rank ? " (#" + i.passing.rank + ")" : "") + " " + (SCOPE[i.scope] || "")
      : goal + " " + label + " " + (SCOPE[i.scope] || "");
    var text = need <= 0
      ? i.player + " (" + i.team + ") — " + (i.kind === "pass" ? "passes " + who + " (" + label + ")" : "reaches " + who)
      : i.player + " (" + i.team + ") — " + need + " " + plural(need, label) + " from " + (i.kind === "pass" ? "passing " : "") + who;
    var flag = i.publishable ? "verified" : "review" + (i.review && i.review[0] ? ": " + i.review[0] : "");
    var stat = [[v, String(label).toUpperCase() + " TONIGHT"]];
    if (need > 0) stat.push([need, "TO GO"]);
    fire("cc-" + i.espnId + "-" + i.stat + "-" + i.kind + "-" + i.target, {
      type: "milestone",
      icon: need <= 0 ? (i.kind === "pass" ? "🎉 PASSED" : "🎉 " + goal) : "🎯 " + need + " FROM " + (i.kind === "pass" ? "PASSING" : goal),
      text: text,
      statLine: typeof fmtAlertStatLine === "function" ? fmtAlertStatLine(stat) : "",
      sub: "Command Center · pre-game " + pct(i.pTonight) + " · importance " + i.importance + " · " + flag,
      live: game.status === "live", gameId: game.id, gameTag: tag, gameScore: scr,
    });
  }

  function connect() {
    state.connected = has("fireStory") && typeof fireStory === "function" && has("runAlertChecks") && typeof runAlertChecks === "function" && Array.isArray(games());
    if (!state.connected) return status();
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
