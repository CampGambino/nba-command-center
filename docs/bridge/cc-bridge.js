/*
 * NBA Command Center -> NBA Live bridge.                                  version 1
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
  var VERSION = 1;
  var DEFAULT_URL = "https://campgambino.github.io/nba-command-center/data/watch.json";
  var REFRESH_MS = 15 * 60 * 1000;
  // Editorial gate, in NBA Live's spirit ("a rung nobody celebrates produces a card nobody wants"):
  var MIN_CHANCE = 0.10;      // pre-game chance tonight needed to take a card while live
  var MIN_IMPORTANCE = 15;    // round numbers below this never get a card (passes always can). Was 20 until 0.15.2; tune from use
  var MAX_PER_GAME = 6;       // in-play cards per game, best first (reached ones always show)

  // ESPN abbreviations NBA Live shows -> Command Center tricodes.
  var TRI = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", PHO: "PHX", BRK: "BKN", CHO: "CHA" };
  var tri = function (t) { t = String(t || "").toUpperCase(); return TRI[t] || t; };

  // Command Center stat -> NBA Live box-score field.
  var FIELD = { pts: "pts", reb: "reb", ast: "ast", stl: "stl", blk: "blk", fg3m: "tpm", ftm: "ftm", fgm: "fgm", dreb: "dreb", oreb: "oreb", min: "min" };
  // NBA Live's own ladders (MILESTONE_LADDERS): those round numbers are already its cards.
  var NBA_LIVE_STAT = { pts: "pts", fg3m: "tpm", reb: "reb", ast: "ast", stl: "stl", blk: "blk" };

  var state = { data: null, items: [], loadedAt: 0, error: null, connected: false, fired: 0, keys: {} };
  window.CC_BRIDGE = { version: VERSION, state: state };

  function param(name) { try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; } }
  var url = param("cc") || DEFAULT_URL;
  if (url === "off") return;

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

  function status() {
    if (!state.connected) return note("Command Center: not connected (this NBA Live version lacks fireStory/runAlertChecks/GAMES)", true);
    if (state.error) return note("Command Center: couldn't load the Watch List (" + state.error + ")", true);
    var d = state.data && state.data.today;
    note("Command Center: " + state.items.length + " milestones" + (d ? " for " + d : "") + (state.fired ? " · " + state.fired + " cards" : ""));
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
    if (!G || !state.items.length) return;
    var night = nbaLiveNight();
    if (night && state.data && state.data.today && night !== state.data.today) {
      state.wrongNight = night;
      return note("Command Center: Watch List is for " + state.data.today + ", NBA Live shows " + night + " (rebuild the Watch List)", true);
    }
    state.wrongNight = null;
    G.forEach(function (game) {
      if (!game || game.status !== "live" && game.status !== "final") return;
      var sides = { away: tri(game.away && game.away.tricode), home: tri(game.home && game.home.tricode) };
      var box = (game.boxscore || {});
      var tag = (game.away && game.away.tricode) + " @ " + (game.home && game.home.tricode);
      var scr = game.status === "final" ? "Final" : (game.away.score + "–" + game.home.score);
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
    });
    status();
  }

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
