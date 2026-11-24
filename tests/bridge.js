/**
 * The NBA Live bridge (docs/bridge/cc-bridge.js) against a stand-in NBA Live: which cards it fires, when, and with
 * what text, on invented data. Moved out of tests/run.js unchanged (0.141.6, the first step of splitting that file);
 * the same checks against the real published files are in tests/contracts.js.
 */
import fs from "node:fs";
import path from "node:path";

export async function bridgeChecks(ok, root, deps = {}) {
  const vm = await import("node:vm");
  const code = fs.readFileSync(path.join(root, "docs", "bridge", "cc-bridge.js"), "utf8");
  const item = (o) => ({ espnId: "1", player: "P One", stat: "pts", label: "points", kind: "round", scope: "career", target: 1000, need: 10, importance: 30, pTonight: 0.5, publishable: true, tracking: "confirmed", review: [], origin: "notes", ...o });
  const watch = { today: "2026-11-09", teams: [
    { team: "LAL", items: [
      item({}),                                                                  // in play: card
      item({ espnId: "2", player: "Low Chance", pTonight: 0.02, need: 50 }),     // < 10% and not reached: no card
      item({ espnId: "9", player: "Surprise", pTonight: 0.01 }),                 // 1% but reached tonight: card
      item({ espnId: "3", player: "Minor Mark", importance: 9 }),                // importance < 15: no card
      item({ espnId: "10", player: "Allen Like", importance: 18 }),              // 15-19 (like Allen's 4,000 defensive rebounds): card since 0.15.2
      item({ espnId: "11", player: "Just Under", importance: 14 }),              // just under the cutoff: no card
      item({ espnId: "12", player: "Star Rung", importance: 26 }),               // v11: a big name's lesser round number in points: card
      item({ espnId: "13", player: "Star Baskets", importance: 26, stat: "fgm", label: "field goals" }), // a big name's made baskets: no card
      item({ espnId: "14", player: "Plain Rung", importance: 26 }),              // not a big name: no card
      item({ espnId: "4", player: "Pass Man", kind: "pass", scope: "nba", importance: 15, passing: { player: "Old Guy", rank: 20 }, need: 2, stat: "fg3m", label: "3-pointers" }), // pass: card even below 20
      item({ espnId: "5", player: "Ladder Guy", target: 20000, need: 5 }),        // NBA Live's own ladder: skipped
      item({ espnId: "6", player: "Count Guy", target: 15000, need: 50, tracking: "disagrees", review: ["notes say 14950, ESPN says 14946"] }), // ladder + disagreement: count note
      item({ espnId: "7", player: "Bench Guy" }),                                // hasn't played: no card
      item({ espnId: "8", player: "Espn Only", origin: "espn" }),                 // ESPN-only: never
    ] },
    { team: "SAS", items: [ item({ espnId: "20", player: "Final Reach", need: 6 }), item({ espnId: "21", player: "Final Miss", need: 30 }) ] },
  ] };
  const pl = (id, o) => ({ id, min: 20, pts: 12, tpm: 3, reb: 5, ast: 2, stl: 1, blk: 0, dreb: 4, oreb: 1, starter: true, ...o });
  let flowData = null, versionData = null, teamMarksData = null, oddData = null, oddRulesText = null, rareData = null, rareRulesText = null, featData = null;
  function run({ date = "20261109", hooks = true, games, extra = {} } = {}) {
    const cards = new Map(); let original = 0;
    const el = { style: {}, textContent: "" };
    const ctx = {
      URLSearchParams, URL, console, Promise, Object, Number, String, Math, Array, Date, JSON,
      location: { search: "?cc=" + encodeURIComponent("https://campgambino.github.io/nba-command-center/data/watch.json") },
      document: { readyState: "complete", getElementById: (id) => (id === "cc-bridge-note" ? el : null), createElement: () => el, body: { appendChild() {} } },
      fetch: async (u) => ({ ok: true, json: async () => (String(u).includes("version.json") ? versionData : String(u).includes("teammarks.json") ? teamMarksData : String(u).includes("flowstats.json") ? flowData : String(u).includes("tonight.json") ? tonightData : String(u).includes("records.json") ? recordsData : String(u).includes("single-game-bests") ? bestsData : String(u).includes("oddlive.json") ? oddData : String(u).includes("linerare.json") ? rareData : String(u).includes("featlive.json") ? featData : watch), text: async () => (String(u).includes("oddlines.js") ? oddRulesText : String(u).includes("linerare.js") ? rareRulesText : "") }),
      setInterval() {}, setTimeout() {}, clearTimeout() {}, addEventListener() {},
    };
    ctx.window = ctx;
    if (hooks) {
      Object.assign(ctx, {
        GAMES: games, MILESTONE_LADDERS: { pts: { step: 1000, from: 10000 }, tpm: { step: 500, from: 1000 } },
        fireStory: (k, c) => cards.set(k, c), runAlertChecks: () => { original++; }, activeDateYMD: () => date,
        fmtAlertStatLine: (rows) => rows.map((r) => r.join(" ")).join(" · "),
        ALERT_STORIES: { get: (k) => (cards.has(k) ? { ...cards.get(k), el: { remove() {} } } : undefined), delete: (k) => cards.delete(k) },
        endStory: (k, text) => cards.set(k, { ...cards.get(k), text: text || cards.get(k).text, ended: true }),
      }, extra);
    }
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    return { ctx, cards, el, orig: () => original };
  }
  // tonight.json for the pre-game cards (v2): LAL @ ATL is live in the games below, MIA @ BOS hasn't tipped.
  const L = (kind, text) => ({ kind, text, team: "X", score: 1 });
  const tonightData = { today: "2026-11-09", stars: { "Star Rung": 0.9, "Star Baskets": 0.9 }, games: [
    { away: "LAL", home: "ATL", lines: [L("streak", "Live game line")] },
    { away: "MIA", home: "BOS", lines: [L("streak", "Pre one: 30+ points in 8 straight"), L("lead", "Pre two"), L("shooting", "Pre three"), L("team", "Pre four")] },
  ] };
  // v3: career records and the single-game lists.
  const rec = (o) => ({ id: "30", who: "Rec Man", team: "LAL", stat: "ast", label: "assists", kind: "pass", need: 3, target: 101, rank: 21, score: 3, pTonight: 0.6,
    passing: { name: "Old Passer", value: 100, rank: 21 }, text: "Man: 3 assists from passing Old Passer (100) for 21st all-time", ...o });
  const recordsData = { today: "2026-11-09", cup: { tonight: [{ away: "LAL", home: "ATL" }] },
    franchiseGame: { teams: { LAL: { name: "Lakers", src: "Lakers guide p. 99", pts: { value: 58, holders: ["Old Laker vs. Boston 1/1/60"] }, fg3m: { value: 12, holders: ["Kobe Bryant vs. Seattle 1/7/03"] } } } }, items: [
    rec({}),                                                                                      // reached tonight (5 assists): card
    rec({ id: "31", who: "Cup Man", kind: "cup", stat: "fg3m", label: "3-pointers", need: 2, rank: 1, passing: { name: "Cup King", value: 64, rank: 1 }, text: "Man: 2 3-pointers from passing Cup King (64) for the NBA Cup record; 1 ties him" }), // Cup game: card
    rec({ id: "32", who: "Far Man", need: 40, pTonight: 0.05 }),                                   // long shot, not reached: none
    rec({ id: "1", who: "P One", stat: "pts", kind: "round", target: 1000, need: 10, text: "One: 10 points from 1,000 career points", passing: null }), // the notes already carry it: none
    rec({ id: "33", who: "Board Man", stat: "oreb", label: "offensive rebounds", kind: "round", target: 4000, need: 1, club: 9, passing: null, text: "Man: 1 offensive rebound from 4,000 career offensive rebounds" }),   // v11: nine players ever: card
    rec({ id: "34", who: "Glass Man", stat: "dreb", label: "defensive rebounds", kind: "round", target: 7000, need: 1, club: 32, passing: null, text: "Man: 1 defensive rebound from 7,000 career defensive rebounds" }), // 32 players: none
  ] };
  const bestsData = { "Regular season": { pts: { floor: 57, games: [{ value: 100 }, { value: 81 }, { value: 60 }, { value: 58 }, { value: 58 }, { value: 57 }] }, fg3m: { floor: 11, games: [{ value: 14 }, { value: 11 }] } },
    "NBA Cup": { pts: { floor: 39, games: [{ value: 60 }, { value: 49 }, { value: 39 }] } } };
  const flush = () => new Promise((r) => setTimeout(r, 5));
  const games = [
    { id: "g1", status: "live", away: { tricode: "LAL", score: 50 }, home: { tricode: "ATL", score: 48 }, boxscore: { away: [pl("1"), pl("2"), pl("3"), pl("4"), pl("5"), pl("6"), pl("7", { min: 0, pts: 0 }), pl("9"), pl("10"), pl("11"), pl("12"), pl("13"), pl("14"), pl("33", { name: "Board Man" }), pl("34", { name: "Glass Man" }),
      pl("30", { name: "Rec Man", ast: 5 }), pl("31", { name: "Cup Man", tpm: 1 }), pl("32", { name: "Far Man", ast: 3 }), pl("40", { name: "Big Night", pts: 58, tpm: 9 }), pl("41", { name: "Warm Hand", pts: 52 })], home: [] } },
    { id: "g2", status: "final", away: { tricode: "SA", score: 100 }, home: { tricode: "PHX", score: 90 }, boxscore: { away: [pl("20"), pl("21")], home: [] } },
  ];
  games.push({ id: "g9", status: "pre", away: { tricode: "MIA", score: 0 }, home: { tricode: "BOS", score: 0 }, boxscore: { away: [], home: [] } });
  const t = run({ games });
  await flush(); t.ctx.runAlertChecks(); await flush();
  const keys = [...t.cards.keys()];
  const has = (frag) => keys.some((k) => k.includes(frag));
  ok(t.orig() === 1, "bridge: NBA Live's own checks still run, once");
  {
    // v12: the note carries the running version; a newer published version asks for a refresh; version.json matches the bridge.
    const running = Number(/var VERSION = (\d+);/.exec(code)[1]);
    const published = JSON.parse(fs.readFileSync(path.join(root, "docs", "bridge", "version.json"), "utf8")).version;
    versionData = { version: running + 1 };
    const tv = run({ games }); await flush(); tv.ctx.runAlertChecks(); await flush();
    versionData = { version: running };
    const ts = run({ games }); await flush(); ts.ctx.runAlertChecks(); await flush();
    versionData = null;
    ok(published === running && new RegExp(` · v${running}$`).test(t.el.textContent) && new RegExp(`a newer version is out \\(v${running + 1}; this page is running v${running}\\)\\. Refresh NBA Live`).test(tv.el.textContent) && / · v\d+$/.test(ts.el.textContent),
      "bridge v12 (0.75.1): the status note ends with the running version; when a newer one is published it says so and asks for a refresh; bridge/version.json matches the bridge", [published, t.el.textContent, tv.el.textContent].join(" | "));
  }
  ok(!keys.some((k) => k.startsWith("cc-pre-")), "bridge 0.61: once the night's first game has tipped, no pre-game cards");
  {
    const tp = run({ games: games.filter((g) => g.status !== "live" && g.status !== "final") }); await flush(); tp.ctx.runAlertChecks(); await flush();
    const pre = [...tp.cards.keys()].filter((k) => k.startsWith("cc-pre-"));
    const c0 = tp.cards.get(pre[0]);
    const tg = games.find((g) => g.status !== "live" && g.status !== "final"); const st0 = tg.status;
    tg.status = "live"; tp.ctx.runAlertChecks(); await flush(); tg.status = st0;
    ok(pre.length === 3 && ![...tp.cards.keys()].some((k) => k.startsWith("cc-pre-")), "bridge 0.61: pre-game cards are removed when the first game tips", [...tp.cards.keys()].join(" "));
    ok(pre.length === 3 && pre.every((k) => k.includes("MIA-BOS")) && c0.text === "Pre one: 30+ points in 8 straight" && /STREAK/.test(c0.icon) && c0.live === false && c0.gameScore === "Pre-game",
      "bridge v2: a game before tip-off gets its top 3 storylines as cards; a live game gets none of them", pre.join(" ") + " | tonight=" + JSON.stringify(tp.ctx.CC_BRIDGE.state.tonightError));
  }
  ok(has("cc-1-"), "bridge: an in-play milestone gets a card");
  ok(!has("cc-2-"), "bridge: under 10% tonight and not reached: no card", keys.join(" "));
  ok(!has("cc-3-"), "bridge: a minor round number gets no card even when reached", keys.join(" "));
  ok(!has("cc-10-") && !has("cc-11-") && has("cc-12-") && !has("cc-13-") && !has("cc-14-") && has("cc-1-g1"),
    "bridge v11 (0.72.8): a round number needs importance 30 for a card (18 and 14 get none); a big name gets one from 25 in a main stat (26 points), not for made baskets, and nobody else at 26", keys.join(" "));
  ok(has("cc-rec-33-oreb-round") && !has("cc-rec-34-dreb-round"), "bridge v11 (0.72.8): a career-records round number outside the six main stats gets a card only for a small club (9 players, not 32)", keys.filter((k) => k.startsWith("cc-rec")).join(" "));
  ok(has("cc-9-"), "bridge: a long-shot milestone reached tonight gets a card (the surprise is the story)");
  ok(has("cc-4-") && /passes Old Guy/.test(t.cards.get(keys.find((k) => k.includes("cc-4-"))).text), "bridge: a pass gets a card and is worded 'passes Old Guy' (needed 2, made 3)");
  ok(!has("cc-5-") && !has("cc-count-5"), "bridge: NBA Live's own ladder milestone is left to NBA Live");
  ok(has("cc-count-6"), "bridge: a ladder total the notes dispute gets a count-check card");
  ok(!has("cc-7-") && !has("cc-8-"), "bridge: a player who hasn't played, and ESPN-only items: no card");
  ok(has("cc-20-") && !has("cc-21-"), "bridge: a final game shows only what fell in it");
  ok(/SA @ PHX/.test(t.cards.get(keys.find((k) => k.includes("cc-20-"))).gameTag) && /Command Center/.test(t.cards.get(keys.find((k) => k.includes("cc-1-"))).sub), "bridge: cards carry the game and say they come from the Command Center");
  ok(/milestones.* for 2026-11-09/.test(t.el.textContent), "bridge: status note shows it is connected", t.el.textContent);
  {
    tonightData.defense = { n30: 129, n40: 27, teams: { ATL: { gp: 12, t30: 0, t40: 0 }, BOS: { gp: 12, t30: 2, t40: 0 }, LAL: { gp: 12, t30: 4, t40: 1 }, MIA: { gp: 12, t30: 3, t40: 1 } } };
    const td = run({ games: [games[0]] }); await flush(); td.ctx.runAlertChecks(); await flush();
    const dk = [...td.cards.keys()].filter((k) => k.startsWith("cc-def"));
    const c30 = td.cards.get("cc-def30-g1-40");
    delete tonightData.defense;
    ok(dk.includes("cc-def30-g1-40") && dk.includes("cc-def30-g1-41") && dk.includes("cc-def40-g1-40") && dk.includes("cc-def40-g1-41") && !dk.some((k) => /-(?:1|2|30)$/.test(k)) && /first 30-point game ATL has allowed this season \(12 games\)/.test(c30.text) && /the only team without one/.test(c30.sub),
      "bridge v6 (0.71): a defense that hadn't allowed a 30-point game (the Celtics) gets a card when someone reaches 30 against it; 40 when two teams or fewer hadn't", dk.join(" "));
  }
  // Cap: 9 in-play milestones in one game -> 6 cards.
  const many = { id: "g3", status: "live", away: { tricode: "LAL", score: 1 }, home: { tricode: "ATL", score: 1 }, boxscore: { away: Array.from({ length: 9 }, (_, k) => pl(String(100 + k))), home: [] } };
  watch.teams[0].items.push(...Array.from({ length: 9 }, (_, k) => item({ espnId: String(100 + k), player: `Many ${k}`, need: 50, importance: 60, pTonight: 0.2 + k / 100 })));
  // v18: a mark below importance 50 gets a card only inside NBA Live's own reach (10 points); a big one whenever he plays.
  watch.teams[0].items.push(item({ espnId: "150", player: "Far Run", need: pl("150").pts + 11, importance: 35 }), item({ espnId: "151", player: "Near Run", need: pl("151").pts + 10, importance: 35 }));
  many.boxscore.home = [pl("150"), pl("151")];
  const t2 = run({ games: [many] }); await flush(); t2.ctx.runAlertChecks(); await flush();
  ok([...t2.cards.keys()].filter((k) => /cc-1[0-4]\d-/.test(k)).length === 6, "bridge: at most 6 in-play cards per game");
  {
    const one = { id: "g4", status: "live", away: { tricode: "LAL", score: 1 }, home: { tricode: "ATL", score: 1 }, boxscore: { away: [pl("150"), pl("151")], home: [] } };
    const t3 = run({ games: [one] }); await flush(); t3.ctx.runAlertChecks(); await flush();
    const k3 = [...t3.cards.keys()];
    ok(k3.some((k) => /^cc-151-/.test(k)) && !k3.some((k) => /^cc-150-/.test(k)), "bridge v18 (the user, 11/16: 'we wait until the player is closer to the mark'): a run-of-the-mill round number is a card at 10 points to go, not at 11", k3.filter((k) => /cc-15/.test(k)).join(" "));
  }
  const t3 = run({ games, date: "20261110" }); await flush(); t3.ctx.runAlertChecks(); await flush();
  ok(t3.cards.size === 0 && /NBA Live shows 2026-11-10/.test(t3.el.textContent), "bridge: a Watch List for another night is not used");
  let threw = null;
  try { const t4 = run({ hooks: false }); await flush(); ok(/not connected/.test(t4.el.textContent), "bridge: an NBA Live without the hooks gets a 'not connected' note"); } catch (e) { threw = e; }
  ok(!threw, "bridge: missing hooks never throw", String(threw));
  // v3
  const recCard = t.cards.get(keys.find((k) => k.startsWith("cc-rec-30-")) || "");
  ok(recCard && recCard.text === "Rec Man (LAL) — passes Old Passer (100) for 21st all-time" && /all-time/.test(recCard.sub),
    "bridge v3: a career-list pass reached tonight gets a card, re-worded for now", recCard && recCard.text);
  const cupCard = t.cards.get(keys.find((k) => k.startsWith("cc-rec-31-")) || "");
  ok(cupCard && cupCard.text === "Cup Man (LAL) — 1 3-pointer from passing Cup King (64) for the NBA Cup record", "bridge v3: an NBA Cup mark in a Cup game, counting down live", cupCard && cupCard.text);
  // 0.61: only places worth saying; two names passed tonight make one tile; the list on the card's back.
  {
    const keep = recordsData.items;
    recordsData.cup.boards = { reb: [{ name: "Top Reb", now: 200 }, { name: "Two Reb", now: 173 }, { name: "Three Reb", now: 160 }] };
    recordsData.franchise = { LAL: { pts: [{ name: "Laker One", now: 30000 }, { name: "Laker Two", now: 25000 }, { name: "Laker Three", now: 20000 }, { name: "Laker Four", now: 19990 }] } };
    const cr = (o) => rec({ kind: "cup", stat: "reb", label: "rebounds", pTonight: 0.9, ...o });
    recordsData.items = [
      cr({ id: "50", who: "Cup Eighth", need: 1, rank: 8, passing: { name: "Somebody", value: 81, rank: 8 }, text: "Man: 1 rebound from passing Somebody (81) for 8th in NBA Cup history" }),
      cr({ id: "51", who: "Cup Big", now: 170, need: 4, target: 174, rank: 2, passing: { name: "Two Reb", value: 173, rank: 2 }, text: "Man: 4 rebounds from passing Two Reb (173) for 2nd in NBA Cup history" }),
      rec({ id: "52", who: "Fr Dreb", kind: "franchise", stat: "dreb", label: "defensive rebounds", need: 1, rank: 8, pTonight: 0.9, passing: { name: "J. Chones", value: 3000, rank: 8 }, text: "Man: 1 defensive rebound from passing J. Chones (3,000) for 8th in Lakers history" }),
      rec({ id: "53", who: "Fr Scorer", kind: "franchise", stat: "pts", label: "points", now: 19985, need: 6, target: 19991, rank: 4, pTonight: 0.9, passing: { name: "Laker Four", value: 19990, rank: 4 }, text: "Man: 6 points from passing Laker Four (19,990) for 4th in Lakers history" }),
      rec({ id: "53", who: "Fr Scorer", kind: "franchise", stat: "pts", label: "points", now: 19985, need: 16, target: 20001, rank: 3, pTonight: 0.9, passing: { name: "Laker Three", value: 20000, rank: 3 }, text: "Man: 16 points from passing Laker Three (20,000) for 3rd in Lakers history" }),
    ];
    const g9 = { id: "g9", status: "live", away: { tricode: "LAL", score: 50 }, home: { tricode: "ATL", score: 48 },
      boxscore: { away: [pl("50", { name: "Cup Eighth", reb: 3 }), pl("51", { name: "Cup Big", reb: 5 }), pl("52", { name: "Fr Dreb", dreb: 4, reb: 4 }), pl("53", { name: "Fr Scorer", pts: 20 })], home: [] } };
    const tr = run({ games: [g9] }); await flush(); tr.ctx.runAlertChecks(); await flush();
    const ks = [...tr.cards.keys()], cb = tr.cards.get("cc-rec-51-reb-cup"), fs3 = tr.cards.get("cc-rec-53-pts-franchise");
    ok(!ks.some((k) => /cc-rec-5[02]-/.test(k)) && cb && /passes Two Reb \(173\) for 2nd in NBA Cup history/.test(cb.text),
      "bridge 0.61: an NBA Cup pass for 8th and a franchise defensive-rebound pass for 8th get no card; 2nd in the Cup does", ks.join(" "));
    ok(cb && /NBA Cup · rebounds/.test(cb.backHtml) && /2\.<\/span> Cup Big · <strong>175/.test(cb.backHtml) && /1\.<\/span> Top Reb/.test(cb.backHtml),
      "bridge 0.61: the pass card's back lists the top of the board with him at tonight's total", cb && cb.backHtml);
    ok(fs3 && fs3.text === "Fr Scorer (LAL) — passes Laker Four and Laker Three (20,000) for 3rd in Lakers history · 20,005 points" && ks.filter((k) => k.startsWith("cc-rec-53-")).length === 1,
      "bridge 0.61: two names passed tonight in one tile", fs3 && fs3.text);
    // 0.63: SGA and Daniels (the user's 11/13 cards). Daniels played earlier tonight (2 steals, final); SGA has 1: no "passes",
    // the countdown is to Daniels' live total, and the back shows it.
    recordsData.cup.boards = { stl: [{ name: "Dyson Daniels", now: 40 }, { name: "Shai Gilgeous-Alexander", now: 40 }, { name: "Josh Hart", now: 32 }] };
    recordsData.cup.tonight = [{ away: "ATL", home: "CHI" }, { away: "OKC", home: "LAC" }];
    recordsData.items = [rec({ id: "70", who: "Shai Gilgeous-Alexander", team: "OKC", kind: "cup", stat: "stl", label: "steals", now: 40, need: 1, target: 41, rank: 1, pTonight: 0.7,
      passing: { name: "Dyson Daniels", value: 40, rank: 1 }, text: "Gilgeous-Alexander: 1 steal from passing Dyson Daniels (40) for the NBA Cup record" })];
    const gA = { id: "gA", status: "final", away: { tricode: "ATL", score: 110 }, home: { tricode: "CHI", score: 100 }, boxscore: { away: [pl("71", { name: "Dyson Daniels", stl: 2 })], home: [] } };
    const gO = { id: "gO", status: "live", away: { tricode: "OKC", score: 50 }, home: { tricode: "LAC", score: 48 }, boxscore: { away: [pl("70", { name: "Shai Gilgeous-Alexander", stl: 1 })], home: [] } };
    const ts = run({ games: [gA, gO] }); await flush(); ts.ctx.runAlertChecks(); await flush();
    const sga = ts.cards.get("cc-rec-70-stl-cup");
    ok(sga && sga.text === "Shai Gilgeous-Alexander (OKC) — 2 steals from passing Dyson Daniels (42, 2 tonight) for the NBA Cup record" && /1\.<\/span> Dyson Daniels · <strong>42/.test(sga.backHtml) && /2\.<\/span> Shai Gilgeous-Alexander · <strong>41/.test(sga.backHtml),
      "bridge 0.63: a pass is judged on everyone's live totals tonight (a rival's earlier game counts): no false 'passes', the countdown and the back agree", sga && [sga.text, sga.backHtml].join(" | "));
    gO.boxscore.away[0].stl = 3; ts.ctx.runAlertChecks(); await flush();
    ok(/— passes Dyson Daniels \(42\) for the NBA Cup record · 43 steals$/.test(ts.cards.get("cc-rec-70-stl-cup").text), "bridge 0.63: …and the pass when it really happens", ts.cards.get("cc-rec-70-stl-cup").text);
    recordsData.items = keep;
  }
  // 0.63: one card per player: two milestones reached in the same game read as one.
  {
    const two = [item({ espnId: "80", player: "Two Marks", target: 2500, need: 3, stat: "pts", label: "points" }), item({ espnId: "80", player: "Two Marks", target: 900, need: 2, stat: "ast", label: "assists" })];
    watch.teams[0].items.push(...two);
    const g80 = { id: "g80", status: "live", away: { tricode: "LAL", score: 50 }, home: { tricode: "ATL", score: 48 }, boxscore: { away: [pl("80", { name: "Two Marks", pts: 20, ast: 6 })], home: [] } };
    const tm = run({ games: [g80] }); await flush(); tm.ctx.runAlertChecks(); await flush();
    const k80 = [...tm.cards.keys()].filter((k) => k.startsWith("cc-80-"));
    ok(k80.length === 1 && tm.cards.get(k80[0]).text === "Two Marks (LAL) — reaches 2,500 points and 900 assists career" && /MILESTONES/.test(tm.cards.get(k80[0]).icon),
      "bridge 0.63: two milestones for one player in one game make one card", k80.map((k) => tm.cards.get(k).text).join(" | "));
    watch.teams[0].items.splice(-2, 2);
  }
  ok(!has("cc-rec-32-") && !has("cc-rec-1-"), "bridge v3: a long shot not reached, and a milestone the notes already carry: no record card", keys.filter((k) => k.startsWith("cc-rec")).join(" "));
  if (!t.cards.get("cc-list-cup-40-pts-made")) console.log("DEBUG keys", [...t.cards.keys()].filter((k) => k.includes("list")).join(" "), JSON.stringify(t.ctx.CC_BRIDGE.state.listError));
  const made = t.cards.get("cc-list-40-pts-made"), near = t.cards.get("cc-list-41-pts-near"), cupMade = t.cards.get("cc-list-cup-40-pts-made");
  ok(made && made.text === "Big Night (LAL) — 58 points: tied for the 4th-most in a game on the NBA's all-time list (6 games of 57+)" && !near && cupMade && /CUP/.test(cupMade.icon)
    && /^Big Night \(LAL\) — 58 points, 2 from the NBA Cup single-game record \(60/.test((t.cards.get("cc-list-cup-40-pts-record") || {}).text || "") && !t.cards.get("cc-list-40-pts-record"),
    "bridge v3/0.63: making the all-time single-game list (with his place) and the Cup's list on a Cup night; no 'nearing the list' card; a countdown to the Cup record (the regular season's is NBA Live's own)", [made && made.text, near && near.text, (t.cards.get("cc-list-cup-40-pts-record") || {}).text].join(" | "));
  ok(!has("cc-list-40-fg3m-near") && !has("cc-list-1-fg3m"), "bridge 0.63: no card for nearing a single-game list");
  {
    // v24 (0.109.0): each team's single-game team marks, an NBA record first, and what backs the number in the small print.
    const Z = { pts: 0, tpm: 0, tpa: 0, reb: 0, ast: 0, stl: 0, blk: 0, dreb: 0, oreb: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, to: 0, pf: 0 };
    const five = (pre, tot, n = 8) => Array.from({ length: n }, (_, i) => pl(pre + i, { ...Z, ...(i ? {} : tot) }));
    const mk = (s, k, st, v, ok = null, d = "2024-10-22", o = "vs. New York", n = 1) => ({ s, k, st, v, d, o, n, ok });
    teamMarksData = { v: 1, through: "2025-26", league: { "most|stl": { v: 27, holder: "Seattle vs. Toronto, Jan. 15, 1997", many: false }, "fewest|blk": { v: 0, holder: "By many", many: true } }, teams: {
      BOS: { name: "Celtics", scope: null, m: [mk("team", "most", "fg3m", 29, "ESPN's box score"), mk("team", "most", "fg3a", 53, "ESPN's box score"), mk("team", "most", "blk", 13), mk("team", "most", "stl", 20, "the other team's guide"),
        mk("team", "fewest", "tov", 4, "ESPN's box score", "2013-03-05", "at Philadelphia"), mk("team", "fewest", "blk", 0, null, "2020-01-01", "several, last vs. Utah", 6)] },
      MIA: { name: "Heat", scope: "since 1988-89", m: [mk("opp", "most", "fg3a", 50, "ESPN's box score", "2022-01-02", "vs. Dallas")] } } };
    const bos = { tpm: 27, tpa: 51, blk: 13, stl: 28, to: 3, fga: 85, fgm: 40, pts: 110 };
    const gm = (o = {}, tot = bos, n = 8) => [{ id: "tm1", status: "live", period: 4, clock: "5:00", away: { tricode: "BOS", score: 110 }, home: { tricode: "MIA", score: 100 }, boxscore: { away: five("b", tot, n), home: five("m", { fga: 80, blk: 2, to: 12 }) }, ...o }];
    const go = async (games, extra) => { const r = run({ games, extra }); await flush(); r.ctx.runAlertChecks(); await flush(); return Object.fromEntries([...r.cards].filter(([k]) => k.startsWith("cc-tm-"))); };
    const A = await go(gm()), B = await go(gm(), { NBA_TEAM_RECORDS: { stl: { record: 27 } } }), late = await go(gm({ clock: "1:30" })), fin = await go(gm({ status: "final", clock: "0:00" }));
    const few = await go(gm({}, bos, 4)), po = await go(gm(), { isPlayoffSlate: () => true }), fin0 = await go(gm({ status: "final", clock: "0:00" }, { ...bos, blk: 0 }));
    const K = (o) => Object.keys(o).map((k) => k.replace("cc-tm-tm1-", "")).sort().join(" ");
    ok(K(A) === "BOS-most-blk-tied BOS-most-fg3a-near BOS-most-fg3a-opp BOS-most-fg3m-near BOS-most-stl-nba"
      && A["cc-tm-tm1-BOS-most-fg3m-near"].text === "BOS — 27 threes, 2 from the Celtics record for a game (29, 10/22/24 vs. New York)" && /Celtics media guide · number checked against ESPN's box score$/.test(A["cc-tm-tm1-BOS-most-fg3m-near"].sub)
      && A["cc-tm-tm1-BOS-most-blk-tied"].text === "BOS — 13 blocks: ties the Celtics record for the most in a game (13, 10/22/24 vs. New York)" && /guide only: not checked against a box score$/.test(A["cc-tm-tm1-BOS-most-blk-tied"].sub)
      && A["cc-tm-tm1-BOS-most-stl-nba"].text === "BOS — 28 steals: an NBA record, the most by a team in a game (was 27, Seattle vs. Toronto, Jan. 15, 1997); also the Celtics record (was 20, 10/22/24 vs. New York)"
      && A["cc-tm-tm1-BOS-most-fg3a-opp"].text === "BOS — 51 three-point attempts: the most by an opponent against the Heat (was 50, 1/2/22 vs. Dallas)" && /Heat media guide, since 1988-89 · number checked/.test(A["cc-tm-tm1-BOS-most-fg3a-opp"].sub),
      "bridge v24 (0.109.0): a team total close to its franchise mark, tying one, passing the NBA record (said first, the franchise mark folded in), and the most by an opponent (shown beside \"2 from its own record\" in the same stat, not hidden by it); the small print names what backs the number or says \"guide only\"",
      JSON.stringify(Object.values(A).map((c) => [c.icon, c.text, c.sub])));
    ok(K(B).includes("BOS-most-stl-broke") && !K(B).includes("-nba") && /the most in a game in Celtics history \(was 20, 10\/22\/24 vs\. New York\); passes the NBA record too \(27\)$/.test(B["cc-tm-tm1-BOS-most-stl-broke"].text),
      "bridge v24: where NBA Live has its own card for that league mark, the Command Center's card stays the franchise one and only notes the NBA record", JSON.stringify(B["cc-tm-tm1-BOS-most-stl-broke"] || K(B)));
    ok(!K(A).includes("fewest") && late["cc-tm-tm1-BOS-fewest-tov-watch"]?.text === "BOS — 3 turnovers with 1:30 left: the Celtics record for the fewest in a game is 4 (3/5/13 at Philadelphia)"
      && fin["cc-tm-tm1-BOS-fewest-tov-broke"]?.text === "BOS — 3 turnovers: the fewest in a game in Celtics history (was 4, 3/5/13 at Philadelphia)" && !K(fin).includes("-near") && !K(fin).includes("-watch")
      && !K(fin0).includes("fewest-blk") && K(few) === "" && K(po) === "",
      "bridge v24: a \"fewest\" is a watch only in the last two minutes and a record only at the final; a final drops the close-to-a-record card; no card for a tie at zero, for a box score with fewer than five players, or in the playoffs",
      [K(A), K(late), K(fin), K(fin0), K(few), K(po)].join(" | "));
    teamMarksData = null;
  }
  {
    // v25 (0.119.0): odd lines. A line that can only grow fires at once; one a single play can undo fires in the final
    // five minutes as it stands, is greyed if undone, and stays at the final. One card a player.
    const Z = { pts: 0, tpm: 0, tpa: 0, reb: 0, ast: 0, stl: 0, blk: 0, dreb: 0, oreb: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, to: 0, pf: 0, min: 30, starter: false };
    const P = (id, name, o, starter = false) => ({ ...Z, id, name, starter, ...o });
    const filler = (pre) => [0, 1, 2, 3, 4].map((i) => P(pre + i, "Filler " + pre + i, { pts: 10, fgm: 4, fga: 9, ftm: 2, fta: 2, reb: 4, ast: 2 }, true));
    oddRulesText = fs.readFileSync(path.join(root, "docs", "lib", "situations", "oddlines.js"), "utf8");
    oddData = { v: 1, from: "1993-94", t: { "greb.15": [346, 16, "Jahmai Mashack", "2026-04-10", [["Jahmai Mashack", "2026-04-10", "16 rebounds by a guard"], ["Dyson Daniels", "2026-01-03", "15 rebounds by a guard"]]], "noft.30": [311, 22.8, "Buddy Hield", "2026-04-12"], "ofg.8": [752, 26.6, "A", "2026-03-28"], "ofg.10": [138, 4.8, "Sam Hauser", "2025-12-11"],
      "min0.30": [692, 17.8, "Rayan Rupert", "2026-03-23"], "blk0reb.4": [37, 1.2, "OG Anunoby", "2026-02-19"], "blk0reb.5": [5, 0.2, "Brook Lopez", "2023-04-04"], "bench.35": [142, 6.8, "B", "2026-03-27"], "erupt.25": [543, 32.4, "C", "2026-04-10"], "erupt.3x": [1255, 67, "D", "2026-04-12"] }, avg: {}, pos: { g1: "G" } };
    const away = () => [...filler("a"), P("g1", "Guard One", { pts: 8, fgm: 3, fga: 8, reb: 16, dreb: 14, oreb: 2 }), P("s1", "No Trips", { pts: 31, fgm: 13, fga: 22, tpm: 5, tpa: 9, reb: 4, ast: 3 }),
      P("z1", "Cold One", { fga: 10, tpa: 4, reb: 3 }), P("b1", "Swat Man", { pts: 6, fgm: 3, fga: 5, blk: 5 }), P("x1", "Sixth Man", { pts: 36, fgm: 13, fga: 20, ftm: 8, fta: 9, tpm: 2, tpa: 5, reb: 4, ast: 4 })];
    const gm = (o = {}) => [{ id: "od1", status: "live", period: 4, clock: "6:00", away: { tricode: "AAA", score: 100 }, home: { tricode: "BBB", score: 96 }, boxscore: { away: away(), home: filler("h") }, ...o }];
    const odd = (r) => Object.fromEntries([...r.cards].filter(([k]) => k.startsWith("cc-odd-")).map(([k, c]) => [k.replace("cc-odd-od1-", ""), c]));
    const go = async (games, extra, seed) => { const r = run({ games, extra }); await flush(); if (seed) seed(r); r.ctx.runAlertChecks(); await flush(); return r; };
    const early = odd(await go(gm())), rLate = await go(gm({ clock: "4:30" })), late = odd(rLate), fin = odd(await go(gm({ status: "final", clock: "0:00" }))), ot = odd(await go(gm({ period: 5, clock: "4:55" })));
    ok(Object.keys(early).sort().join(" ") === "g1 x1" && early.g1.icon === "🧩 ODD LINE" && early.g1.text === "Guard One (AAA) — 16 rebounds by a guard"
      && early.g1.sub === "Command Center · About 16 a season"
      && /🧩 A guard with 15\+ rebounds/.test(early.g1.backHtml) && /<strong>346<\/strong> since 1993-94 · about 16 a season lately/.test(early.g1.backHtml)
      && /4\/10\/26<\/span> Jahmai Mashack</.test(early.g1.backHtml) && /1\/3\/26<\/span> Dyson Daniels · 15 rebounds by a guard/.test(early.g1.backHtml) && !/not on file/.test(early.g1.backHtml)
      && /1\/1\/|<strong>142<\/strong>/.test(early.x1.backHtml)
      && early.x1.text === "Sixth Man (AAA) — 36 points off the bench",
      "bridge v25 (0.119.0; the user: \"The others seem fine to me\"): a line that can only grow (a guard's 16 rebounds, 36 off the bench) is carded the moment it is true, with how often it happens; a line one play can undo waits",
      JSON.stringify(Object.entries(early).map(([k, c]) => [k, c.icon, c.text, c.sub])));
    ok(Object.keys(late).sort().join(" ") === "b1 g1 s1 x1 z1" && late.s1.icon === "🧩 ODD LINE · AS IT STANDS" && late.s1.text === "No Trips (AAA) — 31 points without a free throw attempt, 4:30 left in the 4th"
      && late.s1.sub === "Command Center · About 23 a season · stands only if the game ends here" && late.s1.live === true
      && late.b1.text === "Swat Man (AAA) — 5 blocks without a rebound, 4:30 left in the 4th" && late.b1.sub === "Command Center · The 6th since 1993-94 · stands only if the game ends here"
      && /4\/4\/23<\/span> Brook Lopez/.test(late.b1.backHtml)
      && late.z1.text === "Cold One (AAA) — 0-for-10 from the field, 4:30 left in the 4th"
      && late.z1.sub === "Command Center · About 4.8 a season · Also: 30 minutes without a point (0-for-10) · stands only if the game ends here"
      && ot.s1?.text === "No Trips (AAA) — 31 points without a free throw attempt, 4:55 left in overtime",
      "bridge v25 (the user: \"the depending on zero is a good one to flag in the final five minutes\"): 31 points with no free throw attempt, 5 blocks and no rebound and 0-for-10 are carded \"as it stands\" inside the last five minutes of the 4th and any time in overtime, one card a player with his rarest line leading",
      JSON.stringify(Object.entries(late).map(([k, c]) => [k, c.icon, c.text, c.sub])));
    ok(fin.s1?.icon === "🧩 ODD LINE" && fin.s1.text === "No Trips (AAA) — 31 points without a free throw attempt" && !/stands only/.test(fin.s1.sub) && fin.s1.live === false && Object.keys(fin).length === 5,
      "bridge v25: at the final the same cards drop \"as it stands\" and stay", JSON.stringify(fin.s1 || Object.keys(fin)));
    // undone: he goes to the line with two minutes left
    const s1 = rLate.ctx.GAMES[0].boxscore.away.find((p) => p.id === "s1");
    rLate.ctx.GAMES[0].clock = "2:00"; s1.fta = 2; s1.ftm = 1; s1.pts = 32;
    rLate.ctx.runAlertChecks(); await flush();
    const undone = odd(rLate).s1;
    ok(undone?.ended === true && undone.text === "No Trips (AAA) — no longer an odd line: 32 pts, 13-22 FG, 1-2 FT, 4 reb, 3 ast" && odd(rLate).g1.ended !== true,
      "bridge v25: a card whose line is undone (a free throw with two minutes left) is greyed with the line as it now is, not removed; the others stay", JSON.stringify(undone));
    // NBA Live's own card for the same streak, the playoffs, a game that counts toward no book, and no rules
    const own = odd(await go(gm({ clock: "4:30" }), {}, (r) => r.cards.set("sr-0fg-od1-z1", { icon: "0-FOR", text: "NBA Live's own" })));
    const po = odd(await go(gm({ clock: "4:30" }), { isPlayoffSlate: () => true })), cup = odd(await go(gm({ clock: "4:30", countsForRecords: false })));
    // v28: the rules are built into the bridge; "can't be read" is now the bridge holding no rules (a broken build of it).
    const noRules = odd(await go(gm({ clock: "4:30" }), undefined, (r) => { r.ctx.CC_BRIDGE.state.oddRules = null; }));
    ok(own.z1?.text === "Cold One (AAA) — 30 minutes without a point (0-for-10), 4:30 left in the 4th" && !/Also/.test(own.z1.sub) && own.s1 && Object.keys(po).length === 0 && Object.keys(cup).length === 0 && Object.keys(noRules).length === 0,
      "bridge v25: where NBA Live has its own card for the same no-make streak that line stands aside and his next one leads; none in the playoffs or a game that counts toward no book; none if the rules cannot be read", JSON.stringify([own.z1, Object.keys(po), Object.keys(cup), Object.keys(noRules)]));
    {
      // bridge v26 (the user's go, 11/19): the card's last words, per kind of line
      const tovGame = (o = {}) => { const g = gm(o); g[0].boxscore.away.push(P("t1", "Loose Hands", { pts: 12, fgm: 5, fga: 11, ftm: 2, fta: 2, reb: 3, ast: 6, to: 10 })); return g; };
      oddData.t["tov.8"] = [1341, 40, "E", "2026-04-10"]; oddData.t["tov.10"] = [121, 3.2, "Jahmai Mashack", "2026-04-10"];
      const tv = odd(await go(tovGame()));
      const oldRules = odd(await go(tovGame(), undefined, (r) => { const st = r.ctx.CC_BRIDGE.state; st.oddRules = Object.assign({}, st.oddRules, { TOV_PF: [] }); }));
      const RM = await import("../src/situations/oddlines.js"), bsrc = fs.readFileSync(path.join(root, "docs", "bridge", "cc-bridge.js"), "utf8");
      delete oddData.t["tov.8"]; delete oddData.t["tov.10"];
      // v32: what the count rests on moved to the card's back (its last line).
      const lastLine = (c) => (/<div class="alert-back-play" style="opacity:\.75">([^<]*)<\/div>$/.exec(c?.backHtml || "") || [])[1];
      ok(tv.t1?.text === "Loose Hands (AAA) — 10 turnovers" && !/not on file/.test(tv.t1.backHtml + tv.g1.backHtml + oldRules.g1.backHtml + tv.t1.sub) && !lastLine(tv.t1)
        && /<strong>121<\/strong> since 1993-94/.test(tv.t1.backHtml) && (bsrc.match(/of games not on file/g) || []).length <= 3 && +(/var VERSION = (\d+);/.exec(bsrc) || [])[1] >= 35,
        "bridge v35 (the user's go, 11/24; was v26): an odd-line card no longer ends with what share of games its count is short of, for any kind of line (every game since 1993-94 is on file)",
        JSON.stringify([tv.t1?.backHtml, lastLine(tv.t1)]));
    }
    oddData.avg = { x1: [8, 3, 2, 14] };
    const big = odd(await go(gm())).x1;
    ok(big && big.text === "Sixth Man (AAA) — 36 points off the bench" && !/averages/.test(big.text + big.sub),
      "bridge v25: a number far above his own average (36 for an 8-point scorer) is left to NBA Live's own high cards; the odd line (off the bench) is still said", JSON.stringify(big));
    oddData = null; oddRulesText = null;
    // the module's side: every template is in exactly one list, and nothing that only grows can undo a GROW line
    const M = await import("../src/situations/oddlines.js");
    const ids = M.TEMPLATES.map((t) => t.id), both = M.GROW.filter((x) => M.LATE.includes(x));
    let seedN = 7; const rnd = (n) => { seedN = (seedN * 1103515245 + 12345) % 2147483648; return seedN % n; };
    const EV = [(l) => { l.fga++; l.fgm++; l.pts += 2; }, (l) => { l.fga++; l.fgm++; l.fg3a++; l.fg3m++; l.pts += 3; }, (l) => { l.fga++; }, (l) => { l.fga++; l.fg3a++; }, (l) => { l.fta++; l.ftm++; l.pts++; }, (l) => { l.fta++; },
      (l) => { l.reb++; l.oreb++; }, (l) => { l.reb++; l.dreb++; }, (l) => { l.ast++; }, (l) => { l.stl++; }, (l) => { l.blk++; }, (l) => { l.tov++; }, (l) => { l.pf++; }, (l) => { l.min++; }];
    let broke = null, seenGrow = new Set();
    for (let i = 0; i < 4000 && !broke; i++) {
      const l = { starter: rnd(2), min: 0, pts: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0 }, x = { pos: ["G", "F", "C"][rnd(3)], avg: rnd(3) ? { pts: 2 + rnd(28), reb: 1 + rnd(8), ast: 1 + rnd(6) } : null };
      const fav = [rnd(EV.length), rnd(EV.length), rnd(EV.length)];   // each simulated player leans on a few kinds of play, so the high lines are reached
      let was = new Set();
      for (let k = 0; k < 160 && l.pf < 6; k++) {
        EV[rnd(3) ? fav[rnd(3)] : rnd(EV.length)](l);
        const now = new Set(M.matchLine(l, x).map((h) => h.key).filter((key) => M.liveKind(key.split(".")[0]) === "grow"));
        for (const key of was) if (!now.has(key)) broke = key + " " + JSON.stringify(l);
        for (const key of now) seenGrow.add(key.split(".")[0]);
        was = now;
      }
    }
    ok(ids.every((id) => M.GROW.includes(id) !== M.LATE.includes(id)) && !both.length && M.GROW.length + M.LATE.length === ids.length && !broke && M.LATE_SECS === 300 && seenGrow.size >= 11,
      "0.119.0: every odd-line template is either \"can only grow\" or \"one play can undo\", and in 4,000 simulated games no basket, miss, rebound, assist, steal, block, turnover, foul or minute ever undid a can-only-grow line", String(broke || both) + " reached: " + [...seenGrow].join(","));
    const lh = M.liveHits({ ...Object.fromEntries(Object.keys(Z).map((k) => [k, 0])), min: 30, starter: 1, fg3m: 0, fg3a: 4, fga: 11, tov: 0 }, { pos: null, avg: null }, { "ofg.8": [752, 26.6, "A", "2026-03-28"], "ofg.10": [138, 4.8, "Sam Hauser", "2025-12-11"], "min0.30": [692, 17.8, "R", "2026-03-23"] });
    const srcM = fs.readFileSync(path.join(root, "src", "situations", "oddlines.js"), "utf8");
    ok(lh.length === 2 && lh[0].key === "ofg.10" && lh[1].id === "min0" && lh[0].live === "late" && lh[0].grade === "few" && lh[0].before === 138 && lh[0].say === "0-for-11 from the field"
      && srcM === fs.readFileSync(path.join(root, "docs", "lib", "situations", "oddlines.js"), "utf8") && !/^\s*import\b|from "/m.test(srcM) && JSON.parse(fs.readFileSync(path.join(root, "docs", "bridge", "version.json"), "utf8")).version >= 26,
      "0.119.0: a live line gets one hit a template (the rarest level it passes), rarest first; the bridge's copy of the rules is the site's module and has no imports; version.json says 26 (25 when this was built)", JSON.stringify(lh.map((h) => h.key)));
    const sit = fs.readFileSync(path.join(root, "scripts", "situations.js"), "utf8");
    ok(/const before = rows\.filter\(\(g\) => !g\.cupFinal && g\.d < today\)/.test(sit) && /oddlive\.json/.test(sit) && /"oddlines\.js"(, "[a-z]+\.js")*\]\) fs\.copyFileSync/.test(sit),
      "0.119.0: the live file counts only games before today (a game finished this afternoon does not count itself tonight), and the build publishes the rules beside it");
  }
  const fgTie = t.cards.get("cc-fg-40-pts-tied"), fgNear = t.cards.get("cc-fg-41-pts-near");
  ok(fgTie && fgTie.text === "Big Night (LAL) — 58 points: ties the Lakers record (58, Old Laker vs. Boston 1/1/60)" && fgNear && /6 from the Lakers record \(58, Old Laker/.test(fgNear.text) && !has("cc-fg-40-fg3m") && /Lakers guide p\. 99/.test(fgTie.sub),
    "bridge v4: a franchise single-game record tied, one nearing it (52 of 58, window 8); 9 threes isn't near 12 (window 2)", [fgTie && fgTie.text, fgNear && fgNear.text].join(" | "));
  const t5 = run({ games: [{ ...games[1], status: "final" }] }); await flush(); t5.ctx.runAlertChecks(); await flush();
  ok(![...t5.cards.keys()].some((k) => k.startsWith("cc-list-")), "bridge v3: a final game with nobody on a list gets no list card");
  // v5: this season's Game Flow facts (flowstats.json).
  const q = (pts, name, gameId = "old") => ({ pts, id: "x" + pts + name, name, team: "NYK", opp: "CHI", q: 1, gameId, date: "2026-11-04" });
  flowData = { games: 174, leadMin: 15,
    quarters: [q(22, "Jalen Brunson"), q(21, "Franz Wagner"), q(20, "A"), q(18, "B"), q(18, "C"), q(17, "D"), q(17, "E"), q(16, "F"), q(16, "G"), q(16, "H"), q(16, "I"), q(30, "Tonight Itself", "g5")],
    halves: [q(33, "Luka Doncic"), q(30, "Anthony Davis")], teamQuarters: [{ pts: 48, team: "CLE", opp: "MIL", q: 2, gameId: "o", date: "2026-10-31" }, { pts: 47, team: "UTA", opp: "LAL", q: 1, gameId: "o2", date: "2026-10-25" }],
    rotation: { "50": { name: "Sits Long", team: "GSW", gp: 10, starts: 10, open3: 10, back: 720, n: { back: 9 } }, "51": { name: "Back Soon", team: "GSW", gp: 10, starts: 10, open3: 2, back: 1100, n: { back: 8 } },
      "53": { name: "Half Out", team: "GSW", gp: 10, starts: 10, open3: 10, back: 720, n: { back: 9 } },
      "52": { name: "Foul Guy", team: "GSW", gp: 13, starts: 13, open3: 2, back: 2000, n: { back: 1 } }, "55": { name: "Sixth Man", team: "GSW", gp: 10, starts: 0, in1: 300, n: { in1: 9 } },
      "56": { name: "Rare Sub", team: "GSW", gp: 10, starts: 0, in1: 300, n: { in1: 3 } } },
    fouls: { "52": { name: "Foul Guy", team: "GSW", gp: 13, trouble: 9, out: 1, troubleIn: ["a", "b", "c", "d", "e", "f", "g", "h", "g5"], outIn: ["a"] } },
    leads: { GSW: { gp: 12, blown: [{ lead: 22, opp: "MIL", date: "2026-11-03", score: "108-112", gameId: "o3" }, { lead: 16, opp: "TOR", date: "2026-11-07", score: "99-101", gameId: "o4" }], comebacks: [] },
      HOU: { gp: 12, blown: [], comebacks: [{ down: 17, opp: "BOS", date: "2026-11-01", score: "110-104", gameId: "o5" }] }, BOS: { gp: 12, blown: [{ lead: 15, opp: "X", date: "2026-11-01", score: "1-2", gameId: "o6" }], comebacks: [] } } };
  const qp = (id, o) => pl(id, { name: "P" + id, ...o });
  const g5 = { id: "g5", status: "live", period: 2, clock: "8:00", away: { tricode: "GS", score: 60, linescores: [45, 15] }, home: { tricode: "HOU", score: 40, linescores: [22, 18] },
    plays: [{ badge: "sub", playerOutId: "50", qtr: "Q1", clock: "4:24" }],
    boxscore: { away: [qp("40", { pts: 20, qtrPts: [19, 1] }), qp("41", { pts: 12, qtrPts: [3, 9] }), qp("50", { name: "Sits Long", min: 8 }), qp("51", { name: "Back Soon", min: 8 }),
      qp("52", { name: "Foul Guy", pf: 3, pts: 4, min: 9 }), qp("54", { name: "Bench Foul", starter: false, min: 4, pf: 3 }), qp("55", { name: "Sixth Man", starter: false, min: 0, pts: 0 }), qp("56", { name: "Rare Sub", starter: false, min: 0, pts: 0 })], home: [qp("60", { pts: 30, qtrPts: [15, 15] })] } };
  const court = { away: new Set(["40", "41", "52"]), home: new Set(["60"]) };
  const t6 = run({ games: [g5], extra: { computeOnCourt: () => court } }); await flush(); t6.ctx.runAlertChecks(); await flush();
  const c6 = (k) => t6.cards.get(k), k6 = [...t6.cards.keys()];
  ok(c6("cc-sq-40-1") && c6("cc-sq-40-1").text === "P40 (GSW) — 19 points in the 1st quarter: the 4th-most in a quarter this season (most: 22, Jalen Brunson vs CHI 11/4)" && !c6("cc-sq-41-2") && !k6.some((k) => k.startsWith("cc-sq-60")),
    "bridge v5: a quarter among the season's 10 best gets a card (tonight's own game left out of the list); 9 and 16-of-a-crowded-list don't", k6.filter((k) => /cc-s[qh]/.test(k)).map((k) => c6(k).text).join(" | "));
  ok(c6("cc-sh-60-1") && /30 points in the 1st half so far: tied for the 2nd-most in a half this season \(most: 33, Luka Doncic/.test(c6("cc-sh-60-1").text),
    "bridge v5: a half among the season's best ('so far' until it ends)", c6("cc-sh-60-1") && c6("cc-sh-60-1").text);
  ok(c6("cc-tq-g5-GSW-1") && /45 points in the 1st quarter vs HOU: the 3rd-most by a team in a quarter this season/.test(c6("cc-tq-g5-GSW-1").text), "bridge v5: a team quarter among the season's 5 best", c6("cc-tq-g5-GSW-1") && c6("cc-tq-g5-GSW-1").text);
  // v19: the front is who, which foul and when; the season count is on the sub line and the back; a routine card, not a milestone.
  ok(c6("cc-ft-52-g5") && c6("cc-ft-52-g5").text === "Foul Guy (GSW) — 3rd foul, Q2 8:00" && /8 of 12 games this season/.test(c6("cc-ft-52-g5").sub) && /In early foul trouble in 8 of 12 games this season, fouled out once/.test(c6("cc-ft-52-g5").backHtml) && !/points in \d+ minutes/.test(c6("cc-ft-52-g5").backHtml)
    && c6("cc-ft-52-g5").type === "streak" && !c6("cc-ft-52-g5").statLine && !c6("cc-ft-54-g5"),
    "bridge v5: foul trouble (3 fouls in the 2nd) with his season record, tonight's game left out (a later build can hold it); a bench player with no rotation history doesn't get one", c6("cc-ft-52-g5") && c6("cc-ft-52-g5").text);
  ok(c6("cc-ret-50-g5-h1") && c6("cc-ret-50-g5-h1").text === "Sits Long (GSW) hasn't come back in · usually returns to open the 2nd quarter (median of 9 starts) · out since Q1 4:24" && !c6("cc-ret-51-g5-h1"),
    "bridge v5: a starter 4+ minutes past his usual return (to open Q2) gets a rotation card; one whose usual return is later doesn't", c6("cc-ret-50-g5-h1") && c6("cc-ret-50-g5-h1").text);
  ok(c6("cc-lead-g5-GSW") && c6("cc-lead-g5-GSW").text === "GSW lead HOU by 20 · GSW have lost a 20-point lead once this season (the most in the NBA) (last: 22-point lead vs MIL 11/3, 108-112)" && /leads of 20\+ lost/.test(c6("cc-lead-g5-GSW").sub),
    "bridge v10 (0.72.4): lead context from a 20-point lead, at that size: the 22-point lead lost counts, the 16-point one and a comeback from 17 don't", c6("cc-lead-g5-GSW") && c6("cc-lead-g5-GSW").text);
  {
    // The lead balloons: at 26 the question is 25-point leads, nobody has lost one, so the card comes down; and it stays
    // down when the lead slips back to 21 (the lead that could be lost is still 26). A lead of 18 never gets a card.
    const gL = { id: "gL", status: "live", period: 2, clock: "8:00", away: { tricode: "GS", score: 60, linescores: [] }, home: { tricode: "HOU", score: 40, linescores: [] }, plays: [], boxscore: { away: [], home: [] } };
    const tL = run({ games: [gL] }); await flush(); tL.ctx.runAlertChecks(); await flush();
    const at20 = !!tL.cards.get("cc-lead-gL-GSW");
    gL.away.score = 66; tL.ctx.runAlertChecks(); await flush();
    const at26 = !!tL.cards.get("cc-lead-gL-GSW");
    gL.away.score = 61; tL.ctx.runAlertChecks(); await flush();
    const back21 = !!tL.cards.get("cc-lead-gL-GSW");
    const gS = { ...gL, id: "gS", away: { tricode: "GS", score: 58, linescores: [] } };
    const tS = run({ games: [gS] }); await flush(); tS.ctx.runAlertChecks(); await flush();
    ok(at20 && !at26 && !back21 && !tS.cards.get("cc-lead-gS-GSW"), "bridge v10 (0.72.4): the lead-context card comes down when the lead outgrows anything lost this season, stays down if it slips back, and an 18-point lead gets none", [at20, at26, back21].join(" "));
  }
  ok(c6("cc-in-55-g5") && c6("cc-in-55-g5").text === "Sixth Man (GSW) hasn't played yet · usually checks in by Q1 7:00 (median of 9 games off the bench)" && !c6("cc-in-56-g5"),
    "bridge 0.59.1: a regular reserve 3+ minutes past his usual first check-in gets a card; one who rarely plays doesn't", c6("cc-in-55-g5") && c6("cc-in-55-g5").text);
  const t8 = run({ games: [{ id: "g8", status: "pre", away: { tricode: "GS", score: 0 }, home: { tricode: "HOU", score: 0 }, boxscore: { away: [], home: [] } }] }); await flush(); t8.ctx.runAlertChecks(); await flush();
  ok(t8.cards.get("cc-foulwatch-g8") && t8.cards.get("cc-foulwatch-g8").text === "Foul Guy (GSW) early foul trouble in 9 of 13, fouled out 1x",
    "bridge 0.59.1: before tip-off, a foul-watch card for a regular in early foul trouble in half his games", t8.cards.get("cc-foulwatch-g8") && t8.cards.get("cc-foulwatch-g8").text);
  // The clock in a foul card is when it first fired; then the game goes final with GSW's lead lost.
  Object.assign(g5, { clock: "2:00" }); t6.ctx.runAlertChecks(); await flush();
  ok(/3rd foul, Q2 8:00/.test(c6("cc-ft-52-g5").text), "bridge v5: a foul card keeps the time it fired", c6("cc-ft-52-g5").text);
  Object.assign(g5, { status: "final", period: 4, away: { ...g5.away, score: 100 }, home: { ...g5.home, score: 104 } });
  g5.boxscore.home.push(qp("61", { name: "Third Half", pf: 6, pts: 8, min: 20 }));
  t6.ctx.runAlertChecks(); await flush();
  ok(c6("cc-blown-g5-GSW") && c6("cc-blown-g5-GSW").text === "GSW lost a 20-point lead to HOU · their 2nd lost lead of 20+ this season; HOU's 1st comeback from 20+ down" && c6("cc-fo-61-g5") && /fouled out · his first foul-out this season/.test(c6("cc-fo-61-g5").text),
    "bridge v5/v10: at the final, a lead lost, counted at its own size (from the biggest lead seen), and a foul-out", [c6("cc-blown-g5-GSW"), c6("cc-fo-61-g5")].map((c) => c && c.text).join(" | "));
  // Not out for the 3rd: a starter who opens the 3rd in 10 of 10 starts, 1:00 into it.
  const g6 = { id: "g6", status: "live", period: 3, clock: "11:00", away: { tricode: "GS", score: 50, linescores: [] }, home: { tricode: "HOU", score: 52, linescores: [] }, plays: [{ badge: "fg", playerId: "40", qtr: "Q3", clock: "11:40" }],
    boxscore: { away: [qp("53", { name: "Half Out", min: 18 })], home: [] } };
  const t7 = run({ games: [g6], date: "20261110", extra: { computeOnCourt: () => ({ away: new Set(), home: new Set() }) } }); await flush(); t7.ctx.runAlertChecks(); await flush();
  ok(t7.cards.get("cc-ret-53-g6-h2") && /didn't start the 3rd quarter · he opened the 3rd in 10 of 10 starts this season/.test(t7.cards.get("cc-ret-53-g6-h2").text) && [...t7.cards.keys()].every((k) => /^cc-(ret|ft|fo|sq|sh|tq|lead|blown)-/.test(k)),
    "bridge v5: a starter not out for the 3rd gets a card, even on another night than the Watch List's (only season facts then)", [...t7.cards.keys()].join(" "));
  t7.ctx.computeOnCourt = () => ({ away: new Set(["53"]), home: new Set() }); g6.clock = "9:30"; t7.ctx.runAlertChecks(); await flush();
  const back7 = t7.cards.get("cc-ret-53-g6-h2");
  t7.ctx.computeOnCourt = () => ({ away: new Set(), home: new Set() }); g6.clock = "9:00"; t7.ctx.runAlertChecks(); await flush();
  ok(back7 && back7.ended && /^Half Out \(GSW\) is back in, Q3 9:30 · didn't start the 3rd quarter/.test(back7.text) && t7.cards.get("cc-ret-53-g6-h2").ended,
    "bridge 0.61: a rotation card ends when he checks back in, and doesn't come back", back7 && back7.text);
  // v7 (the user, 11/15: LAL @ PHX): a starter who opened the 3rd and sat at 6:53 isn't "not out for the 3rd"; one the
  // play-by-play hasn't shown in the 3rd at all still is; and a starter on his second rest isn't "still on the bench".
  {
    const g7 = { id: "g7", status: "live", period: 3, clock: "6:50", away: { tricode: "GS", score: 63, linescores: [] }, home: { tricode: "HOU", score: 81, linescores: [] },
      plays: [{ badge: "sub", playerId: "56", playerOutId: "53", qtr: "Q3", clock: "6:53" }, { badge: "fg", playerId: "40", qtr: "Q3", clock: "9:15" }, { badge: "sub", playerId: "53", playerOutId: "56", qtr: "Q3", clock: "12:00" }],
      boxscore: { away: [qp("53", { name: "Half Out", min: 20 }), qp("50", { name: "Sits Long", min: 16 })], home: [] } };
    flowData = { season: "2026-27", games: 12, quarters: [], halves: [], teamQuarters: [], fouls: {}, leads: {},
      rotation: { "53": { name: "Half Out", team: "GSW", gp: 10, starts: 10, open3: 10, back: 720, n: { back: 9 } }, "50": { name: "Sits Long", team: "GSW", gp: 10, starts: 10, open3: 10, back: 720, n: { back: 9 } } } };
    const t8 = run({ games: [g7], date: "20261110", extra: { computeOnCourt: () => ({ away: new Set(), home: new Set() }) } }); await flush(); t8.ctx.runAlertChecks(); await flush();
    const g8 = { id: "g8", status: "live", period: 2, clock: "4:00", away: { tricode: "GS", score: 40, linescores: [] }, home: { tricode: "HOU", score: 41, linescores: [] },
      plays: [{ badge: "sub", playerId: "56", playerOutId: "53", qtr: "Q2", clock: "5:00" }, { badge: "sub", playerId: "53", playerOutId: "56", qtr: "Q2", clock: "9:00" }, { badge: "sub", playerId: "56", playerOutId: "53", qtr: "Q1", clock: "4:00" }, { badge: "sub", playerId: "57", playerOutId: "50", qtr: "Q1", clock: "4:00" }],
      boxscore: { away: [qp("53", { name: "Half Out", min: 14 }), qp("50", { name: "Sits Long", min: 8 })], home: [] } };
    const t9 = run({ games: [g8], date: "20261110", extra: { computeOnCourt: () => ({ away: new Set(), home: new Set() }) } }); await flush(); t9.ctx.runAlertChecks(); await flush();
    ok(!t8.cards.get("cc-ret-53-g7-h2") && /^Sits Long \(GSW\) didn't start the 3rd quarter/.test(t8.cards.get("cc-ret-50-g7-h2")?.text || "")
      && !t9.cards.get("cc-ret-53-g8-h1") && /^Sits Long \(GSW\) hasn't come back in/.test(t9.cards.get("cc-ret-50-g8-h1")?.text || ""),
      "bridge v7 (0.72.1): a starter who opened the 3rd and then sat isn't carded \"didn't start the 3rd\"; one on his second rest isn't \"hasn't come back in\"; the real cases still are", [...t8.cards.keys(), ...t9.cards.keys()].join(" "));
  }
  // v15 (0.79): a player who hasn't left the game, from 5:00 left; a half, from 2:00 left; a rare game state.
  {
    flowData = { season: "2026-27", games: 197, quarters: [], halves: [], teamQuarters: [], fouls: {}, leads: {}, rotation: {},
      full: { halves: [{ id: "9", name: "Max Christie", team: "DAL", h: 2, date: "2026-10-23", gameId: "old" }], games: [], fives: [] } };
    const mk = (o) => ({ id: "gi", status: "live", period: 4, clock: "4:30", away: { tricode: "GS", score: 100, linescores: [] }, home: { tricode: "HOU", score: 98, linescores: [] },
      plays: [{ badge: "sub", playerId: "72", playerOutId: "71", qtr: "Q3", clock: "12:00" }, { badge: "sub", playerId: "71", playerOutId: "72", qtr: "Q2", clock: "6:00" }, { badge: "fg", playerId: "73", qtr: "Q3", clock: "8:00" }, { badge: "sub", playerId: "73", playerOutId: "74", qtr: "Q2", clock: "3:00" }],
      boxscore: { away: [qp("70", { name: "Iron Man", min: 43, pts: 31 }), qp("72", { name: "Sat Once", min: 37 }), qp("75", { name: "Box Says Less", min: 30 }), qp("73", { name: "Second Half", min: 25, starter: false })], home: [] }, ...o });
    const court = { away: new Set(["70", "72", "75", "73"]), home: new Set() };
    const early = mk({ clock: "5:30" });
    const tE = run({ games: [early], date: "20261110", extra: { computeOnCourt: () => court } }); await flush(); tE.ctx.runAlertChecks(); await flush();
    const gi = mk({});
    const tI = run({ games: [gi], date: "20261110", extra: { computeOnCourt: () => court } }); await flush(); tI.ctx.runAlertChecks(); await flush();
    const iron = tI.cards.get("cc-iron-70-gi");
    ok(![...tE.cards.keys()].some((k) => /^cc-iron/.test(k)) && iron && iron.icon === "🦾 HASN'T LEFT THE GAME" && iron.text === "Iron Man (GSW) has played every second so far (43:30) · nobody has played a full game this season (197 games)"
      && !tI.cards.get("cc-iron-72-gi") && !tI.cards.get("cc-iron-75-gi") && !tI.cards.get("cc-iron-73-gi"),
      "bridge v15: a starter with no substitution out gets a card from 5:00 left in the 4th (not at 5:30; not one who sat, nor one whose box minutes disagree)", [...tI.cards.entries()].filter(([k]) => /iron/.test(k)).map(([k, c]) => k + ": " + c.text).join(" | "));
    gi.clock = "1:30"; tI.ctx.runAlertChecks(); await flush();
    const half = tI.cards.get("cc-ironh-73-gi-2");
    ok(half && half.text === "Second Half (GSW) has played the whole second half so far (22:30) · 1 full half by any player this season (last: Max Christie, 10/23)" && !tI.cards.get("cc-ironh-70-gi-2") && !tI.cards.get("cc-ironh-72-gi-2"),
      "bridge v15: from 2:00 left in a half, a player who has played all of it (a reserve who opened the 3rd); not the one with a full-game card, nor one who came in during the half", half && half.text);
    gi.plays.unshift({ badge: "sub", playerId: "76", playerOutId: "73", qtr: "Q4", clock: "1:10" }); gi.clock = "1:00";
    tI.ctx.computeOnCourt = () => ({ away: new Set(["70", "72", "75"]), home: new Set() }); tI.ctx.runAlertChecks(); await flush();
    ok(tI.cards.get("cc-ironh-73-gi-2").ended && /^Second Half \(GSW\) came out at Q4 1:10 · he had played all of the second half until then$/.test(tI.cards.get("cc-ironh-73-gi-2").text) && !tI.cards.get("cc-iron-70-gi").ended,
      "bridge v15: the card ends when he comes out", tI.cards.get("cc-ironh-73-gi-2").text);
    Object.assign(gi, { status: "final", clock: "0:00" }); gi.boxscore.away[0].min = 48; tI.ctx.runAlertChecks(); await flush();
    ok(tI.cards.get("cc-iron-70-gi").icon === "🦾 FULL GAME" && tI.cards.get("cc-iron-70-gi").text === "Iron Man (GSW) played every second of the game (48 minutes) · the first full game by any player this season (197 games before tonight)",
      "bridge v15: at the final, a player who never came out has a full game", tI.cards.get("cc-iron-70-gi").text);
    // A feed with no substitutions at all says nothing.
    const bare = mk({ id: "gb", plays: [{ badge: "fg", playerId: "70", qtr: "Q4", clock: "5:00" }] });
    const tB = run({ games: [bare], date: "20261110", extra: { computeOnCourt: () => court } }); await flush(); tB.ctx.runAlertChecks(); await flush();
    // A rare game state: down 11 in overtime.
    tonightData.situations = [{ id: "ot-down-10", when: { ot: true, minDown: 10 }, text: "teams down 10+ in overtime are 1-180 over the last 29 seasons", asOf: "2026-03-26" }];
    const ot = mk({ id: "go", period: 5, clock: "2:00", away: { tricode: "GS", score: 120, linescores: [] }, home: { tricode: "HOU", score: 109, linescores: [] } });
    const close = mk({ id: "gc", period: 5, clock: "2:00", away: { tricode: "GS", score: 120, linescores: [] }, home: { tricode: "HOU", score: 112, linescores: [] } });
    const tO = run({ games: [ot, close], date: "20261109", extra: { computeOnCourt: () => court } }); await flush(); tO.ctx.runAlertChecks(); await flush();
    delete tonightData.situations;
    const sit = tO.cards.get("cc-sit-ot-down-10-go");
    ok(![...tB.cards.keys()].some((k) => /^cc-iron/.test(k)) && sit && sit.icon === "🧮 ALMOST NEVER" && sit.text === "HOU trail GSW by 11 in overtime · teams down 10+ in overtime are 1-180 over the last 29 seasons" && /looked up on 3\/26\/26, not counted since/.test(sit.sub) && !tO.cards.get("cc-sit-ot-down-10-gc"),
      "bridge v15: no play-by-play substitutions, no iron-man card; a team down 10+ in overtime gets the looked-up record (not at 8 down)", sit && sit.text + " // " + sit.sub);
    flowData = null;
  }
  // v8 (0.72.2; the user, 11/15: Josh Green, 4 starts in 11 games, carded for a 4th foul off the bench): foul trouble only
  // for tonight's starters, players who start half their games or more, and players at 25.0 minutes a game or more.
  {
    flowData = { season: "2026-27", games: 12, quarters: [], halves: [], teamQuarters: [], fouls: {}, leads: {},
      rotation: { "70": { name: "Usual Starter", team: "GSW", gp: 10, starts: 6, mpg: 24 }, "71": { name: "Big Minutes", team: "GSW", gp: 10, starts: 0, mpg: 26.3 }, "72": { name: "Spot Starter", team: "GSW", gp: 11, starts: 4, mpg: 21.5 } } };
    const gA = { id: "gA", status: "live", period: 3, clock: "9:14", away: { tricode: "GS", score: 67, linescores: [] }, home: { tricode: "HOU", score: 67, linescores: [] }, plays: [],
      boxscore: { away: [qp("70", { name: "Usual Starter", starter: false, pf: 4 }), qp("71", { name: "Big Minutes", starter: false, pf: 4 }), qp("72", { name: "Spot Starter", starter: false, pf: 4, min: 14 }),
        qp("73", { name: "New Guy", starter: false, pf: 4, min: 18 }), qp("74", { name: "Starts Tonight", pf: 4 })], home: [] } };
    const tA = run({ games: [gA], date: "20261110" }); await flush(); tA.ctx.runAlertChecks(); await flush();
    const ft = (id) => !!tA.cards.get("cc-ft-" + id + "-gA");
    ok(ft("70") && ft("71") && ft("74") && !ft("72") && !ft("73"),
      "bridge v8 (0.72.2): foul trouble for tonight's starter, a usual starter off the bench and a 25-minute reserve; not for a spot starter (4 of 11) or a reserve with no history", [...tA.cards.keys()].join(" "));
    flowData = null;
    // A milestone and a record this page showed as reached, then undone by a stat change: the card says so, live and final.
    const gB = { id: "gB", status: "live", away: { tricode: "LAL", score: 50 }, home: { tricode: "ATL", score: 48 }, boxscore: { away: [pl("1"), pl("30", { name: "Rec Man", ast: 5 })], home: [] } };
    const tB = run({ games: [gB] }); await flush(); tB.ctx.runAlertChecks(); await flush();
    const first = [tB.cards.get("cc-1-gB-watch")?.icon, tB.cards.get("cc-rec-30-ast-pass")?.icon];
    gB.boxscore.away[0].pts = 9; gB.boxscore.away[1].ast = 2;
    tB.ctx.runAlertChecks(); await flush();
    const live = [tB.cards.get("cc-1-gB-watch"), tB.cards.get("cc-rec-30-ast-pass")];
    gB.status = "final";
    tB.ctx.runAlertChecks(); await flush();
    const fin = [tB.cards.get("cc-1-gB-watch"), tB.cards.get("cc-rec-30-ast-pass")];
    const tC = run({ games: [gB] }); await flush(); tC.ctx.runAlertChecks(); await flush();
    ok(/^🎉/.test(first[0]) && /^🎉/.test(first[1]) && live[0].icon === "↩️ TAKEN BACK" && live[0].text === "P One (LAL) — taken back by a stat change (points tonight 12 → 9): 1 point from 1,000 points career"
      && live[1].icon === "↩️ TAKEN BACK" && /1 assist from passing Old Passer.* · showed as reached earlier tonight; a stat change has taken it back$/.test(live[1].text)
      && fin[0].icon === "↩️ TAKEN BACK" && fin[0].live === false && fin[1].icon === "↩️ TAKEN BACK" && !tC.cards.get("cc-1-gB-watch") && !tC.cards.get("cc-rec-30-ast-pass"),
      "bridge v8 (0.72.2): a milestone and a record shown as reached, then undone by a stat change, say 'taken back' (live and after the final); a page opened afterwards shows neither", [first.join(" "), live[0] && live[0].text, live[1] && live[1].text, fin[0] && fin[0].icon].join(" | "));
  }
  // v9 (0.72.3; the user, 11/15): the season cards flip to the season's list with tonight's quarters from every game in
  // it; and while NBA Live's own QUARTER EXPLOSION card is up, the season place rides on that card instead of a second one.
  {
    flowData = { season: "2026-27", games: 188, halves: [], teamQuarters: [], fouls: {}, leads: {}, rotation: {},
      quarters: [q(22, "Jalen Brunson"), q(21, "Franz Wagner"), q(20, "A"), q(18, "B"), q(18, "C"), q(17, "D"), q(17, "E"), q(16, "F"), q(16, "G"), q(16, "H"), q(16, "I")] };
    const mk = () => [
      { id: "gX", status: "live", period: 4, clock: "1:13", away: { tricode: "GS", score: 100, linescores: [] }, home: { tricode: "HOU", score: 99, linescores: [] }, plays: [],
        boxscore: { away: [qp("80", { pts: 30, qtrPts: [5, 3, 3, 19] })], home: [] } },
      { id: "gY", status: "final", away: { tricode: "LAL", score: 110, linescores: [] }, home: { tricode: "ATL", score: 100, linescores: [] }, plays: [],
        boxscore: { away: [qp("81", { pts: 25, qtrPts: [20, 2, 3, 0] })], home: [] } } ];
    const tD = run({ games: mk() }); await flush(); tD.ctx.runAlertChecks(); await flush();
    const own = tD.cards.get("cc-sq-80-4"), other = tD.cards.get("cc-sq-81-1");
    ok(own && own.text === "P80 (GSW) — 19 points in the 4th quarter: the 5th-most in a quarter this season (most: 22, Jalen Brunson vs CHI 11/4)"
      && /tied for the 3rd-most in a quarter this season/.test(other?.text || "")
      && /This season · points in a quarter/.test(own.backHtml) && /P81 \(LAL\) · 1st vs ATL tonight · <strong>20<\/strong>/.test(own.backHtml)
      && /font-weight:700"><span class="abp-time">5\.<\/span> P80 \(GSW\) · 4th vs HOU tonight · <strong>19/.test(own.backHtml) && (own.backHtml.match(/alert-back-play/g) || []).length === 10,
      "bridge v9 (0.72.3): a season-best quarter flips to the season's list (10 rows, his in bold), and a 20-point quarter in another game tonight counts in the list and in his place", [own && own.text, other && other.text, own && own.backHtml].join(" | "));
    // NBA Live's own card for the quarter, fired from its checks: it carries the season place; no second card.
    const G2 = mk(); let nbaLive = true;
    const tE = run({ games: G2, extra: { runAlertChecks: function () { if (nbaLive) this.fireStory("qexp-gX-80-4", { type: "streak", icon: "💥 QUARTER EXPLOSION", text: "P80 (GS) — 4th quarter explosion", sub: "", statLine: "19 Q4 PTS", backHtml: "<div class=\"alert-back-title\">🏆 points in a quarter</div>", live: true, gameId: "gX" }); } } });
    await flush(); tE.ctx.runAlertChecks(); await flush();
    const theirs = tE.cards.get("qexp-gX-80-4"), dup = tE.cards.get("cc-sq-80-4");
    nbaLive = false; tE.cards.delete("qexp-gX-80-4");                    // NBA Live dissolves its card two quarters on
    tE.ctx.runAlertChecks(); await flush();
    const mid = tE.cards.get("cc-sq-80-4");
    G2[0].status = "final"; tE.ctx.runAlertChecks(); await flush();
    const end = tE.cards.get("cc-sq-80-4");
    ok(theirs && theirs.icon === "💥 QUARTER EXPLOSION" && theirs.text === "P80 (GS) — 4th quarter explosion" && theirs.sub === "The 5th-most in a quarter this season (most: 22, Jalen Brunson vs CHI 11/4)"
      && /^<div class="alert-back-title">🏆 points in a quarter<\/div><div class="alert-back-title">📅 This season/.test(theirs.backHtml) && !dup && !mid && end && end.live === false && tE.cards.get("cc-sq-81-1"),
      "bridge v9 (0.72.3): NBA Live's quarter card gets the season place and list added (its text, icon and all-time list untouched) and no second card fires; ours waits for the final once NBA Live's is gone", [theirs && theirs.sub, !!dup, !!mid, end && end.text].join(" | "));
    const tF = run({ games: mk(), extra: { runAlertChecks: function () { this.fireStory("qexp-gX-80-4", { icon: "💥 QUARTER EXPLOSION", text: "x", sub: "", gameId: "gX" }); this.fireStory("other-key", { icon: "A", text: "b", sub: "c" }); } } });
    flowData = null;
    await flush(); tF.ctx.runAlertChecks(); await flush();
    ok(tF.cards.get("qexp-gX-80-4")?.sub === "" && tF.cards.get("other-key")?.sub === "c", "bridge v9: without the season file, and for every other card, NBA Live's cards pass through unchanged");
    // v19: NBA Live's bench card picks up how often a bench has finished ahead of its starters (tonight.json `bench`).
    tonightData.bench = { gp: 394, n: 24, teams: { GSW: { gp: 13, n: 2 }, HOU: { gp: 12, n: 0 } } };
    const tG = run({ games: mk(), extra: { runAlertChecks: function () { this.fireStory("bench-gX-away", { type: "streak", icon: "📋 BENCH IMPACT", text: "GS bench outscoring starters", sub: "", gameId: "gX" }); this.fireStory("bench-gY-away", { icon: "📋 BENCH IMPACT", text: "LAL bench outscoring starters", sub: "", gameId: "gY" }); } } });
    await flush(); tG.ctx.runAlertChecks(); await flush();
    delete tonightData.bench;
    ok(tG.cards.get("bench-gX-away")?.sub === "Command Center · GSW's bench has outscored its starters in 2 of 13 games this season; 24 of 394 team games league-wide" && tG.cards.get("bench-gX-away").text === "GS bench outscoring starters" && tG.cards.get("bench-gY-away")?.sub === "",
      "bridge v19: NBA Live's BENCH IMPACT card says how often that has been the final result, for the team and the league; a team with no count passes through unchanged", JSON.stringify([tG.cards.get("bench-gX-away")?.sub, tG.cards.get("bench-gY-away")?.sub]));
  }
  {
    // v27 (0.141.17; the user, 11/21: "flagging this stuff in real time", "should warn ahead of time", "five or fewer"): rare
    // combinations against every regular-season line since 1993-94 (the real archive), one card a player.
    const zlib = await import("node:zlib");
    const LR = await import(path.join(root, "src", "situations", "linerare.js"));
    const A = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "src", "data", "line-rarity-archive.json.gz"))));
    // A build that already has tonight's game (Big Man's 52-24, game rr1) must not count it against itself.
    rareData = LR.buildRare({ hist: A.hist, top: A.top, rows: [{ pts: 52, reb: 24, ast: 2, fg3m: 1, stl: 2, blk: 2, fga: 30, name: "Big Man", team: "AAA", d: "2026-11-21", gid: "rr1" }], before: "2026-11-22" });
    rareRulesText = fs.readFileSync(path.join(root, "docs", "lib", "situations", "linerare.js"), "utf8");
    const Z = { pts: 0, tpm: 0, tpa: 0, reb: 0, ast: 0, stl: 0, blk: 0, dreb: 0, oreb: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, to: 0, pf: 0, min: 30, starter: true };
    const P = (id, name, o) => ({ ...Z, id, name, ...o });
    const team = () => [P("w1", "Big Man", { pts: 52, reb: 24, ast: 2, tpm: 1, stl: 2, blk: 2, fga: 30 }), P("v1", "Verge Man", { pts: 34, reb: 19, ast: 11, tpm: 1, fga: 20 }),
      P("q1", "Quick One", { pts: 40, reb: 4, ast: 5, tpm: 3, fga: 13 }), P("o1", "Plain Guy", { pts: 31, reb: 9, ast: 7, tpm: 3, fga: 22 }), P("o2", "Filler", { pts: 8, reb: 3, ast: 2, fga: 7 })];
    const gm = (o = {}) => [{ id: "rr1", status: "live", period: 3, clock: "5:00", away: { tricode: "AAA", score: 100 }, home: { tricode: "BBB", score: 96 }, boxscore: { away: team(), home: [P("h1", "Home Guy", { pts: 10 })] }, ...o }];
    const rare = (r) => Object.fromEntries([...r.cards].filter(([k]) => k.startsWith("cc-rare-")).map(([k, c]) => [k.replace("cc-rare-rr1-", ""), c]));
    const go = async (games) => { const r = run({ games }); await flush(); r.ctx.runAlertChecks(); await flush(); return r; };
    const r3 = await go(gm()), q3 = rare(r3);
    ok(Object.keys(q3).sort().join(" ") === "v1 w1" && q3.w1.icon === "🦄 ONE OF ONE" && q3.w1.text === "Big Man (AAA) — 52 points and 24 rebounds: no one else has done that since 1993-94"
      && q3.w1.sub === "Command Center · regular season, ESPN box scores since 1993-94" && q3.w1.statLine === "52 PTS · 24 REB"
      && q3.v1.icon === "👀 ON THE VERGE" && q3.v1.text === "Verge Man (AAA) — 2 more assists would make it 34 points, 19 rebounds and 13 assists: done once since 1993-94",
      "bridge v27 (0.141.17): a line matched by no one since 1993-94 is carded at once, naming only the stats that matter (tonight's game, already in the file, not counted against itself); one a small step short is \"on the verge\"; 40 points on 13 shots waits; 31-9-7 says nothing",
      JSON.stringify(Object.entries(q3).map(([k, c]) => [k, c.icon, c.text, c.sub, c.statLine])));
    // He gets there: the card replaces the warning, with who did it before.
    const v1 = r3.ctx.GAMES[0].boxscore.away.find((p) => p.id === "v1"); v1.ast = 13; r3.ctx.runAlertChecks(); await flush();
    const reached = rare(r3).v1;
    ok(reached?.icon === "🦄 RARE LINE" && reached.text === "Verge Man (AAA) — 34 points, 19 rebounds and 13 assists: the 2nd time since 1993-94" && /^Command Center · Before: [^·]+ \d+\/\d+\/\d\d · regular season/.test(reached.sub),
      "bridge v27: reaching it turns the warning into the card, with who did it before", JSON.stringify(reached));
    const r4 = await go(gm({ period: 4, clock: "4:00" })), q4 = rare(r4);
    ok(q4.q1?.icon === "🦄 RARE LINE · AS IT STANDS" && q4.q1.text === "Quick One (AAA) — 40 points on 13 shots: the 3rd time since 1993-94, 4:00 left in the 4th" && q4.q1.sub.includes("stands only if the game ends here"),
      "bridge v27: points on few shots is carded \"as it stands\" in the last five minutes", JSON.stringify(q4.q1));
    const q1 = r4.ctx.GAMES[0].boxscore.away.find((p) => p.id === "q1"); q1.fga = 16; r4.ctx.GAMES[0].clock = "2:00"; r4.ctx.runAlertChecks(); await flush();
    ok(rare(r4).q1?.ended === true && rare(r4).q1.text === "Quick One (AAA) — no longer a rare line: 40 pts on 16 shots, 4 reb, 5 ast",
      "bridge v27: undone by more misses, the card is greyed with the line as it now is", JSON.stringify(rare(r4).q1));
    // The final: the warning that never came true is taken down; the cards stay.
    const rF = await go(gm()); r3.ctx; rF.ctx.GAMES[0].status = "final"; rF.ctx.GAMES[0].period = 4; rF.ctx.GAMES[0].clock = "0:00"; rF.ctx.runAlertChecks(); await flush();
    const fin = rare(rF);
    ok(!fin.v1 && fin.w1?.icon === "🦄 ONE OF ONE" && fin.w1.live === false && fin.q1?.icon === "🦄 RARE LINE" && !/AS IT STANDS/.test(fin.q1.icon),
      "bridge v27: at the final an unreached warning comes down, the cards stay (points on few shots without \"as it stands\")", JSON.stringify(Object.entries(fin).map(([k, c]) => [k, c.icon, c.text])));
    const po = rare(await go(gm({ countsForRecords: false })));
    ok(!Object.keys(po).length, "bridge v27: nothing for a game that counts toward no book", Object.keys(po).join(" "));
    rareData = null; rareRulesText = null;
  }
  {
    // v28 (0.141.18; NBA Live's security check, 11/21): "?cc=https://attacker.example/watch.json" made the bridge fetch from
    // that host and run oddlines.js and linerare.js from beside it. Now: only off, the site, or a relative .json path; no code
    // is downloaded at all (the rules are compiled in, and must equal their sources).
    const B = await import(path.join(root, "tools", "bundle-bridge-rules.mjs"));
    const src = fs.readFileSync(path.join(root, "docs", "bridge", "cc-bridge.js"), "utf8");
    const want = B.bundle(fs.readFileSync(path.join(root, "src", "situations", "oddlines.js"), "utf8"), fs.readFileSync(path.join(root, "src", "situations", "linerare.js"), "utf8"), fs.readFileSync(path.join(root, "src", "records", "featlive.js"), "utf8"));
    const loadWith = async (cc) => {
      const fetched = [], el = { style: {}, textContent: "" };
      const ctx = { URLSearchParams, URL, console, Promise, Object, Number, String, Math, Array, Date, JSON,
        location: { search: cc == null ? "" : "?cc=" + encodeURIComponent(cc) },
        document: { readyState: "complete", getElementById: (id) => (id === "cc-bridge-note" ? el : null), createElement: () => el, body: { appendChild() {} } },
        fetch: async (u) => { fetched.push(String(u)); return { ok: true, json: async () => (String(u).includes("watch.json") ? watch : null), text: async () => "throw new Error('ran downloaded code')" }; },
        setInterval() {}, setTimeout() {}, clearTimeout() {}, addEventListener() {},
        GAMES: [], MILESTONE_LADDERS: {}, fireStory() {}, runAlertChecks() {}, activeDateYMD: () => "20261109", fmtAlertStatLine: () => "", ALERT_STORIES: { get: () => undefined, delete() {} }, endStory() {} };
      ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src, ctx); await flush(); await flush();
      return { fetched, st: ctx.CC_BRIDGE.state, note: el.textContent };
    };
    const bad = await loadWith("https://attacker.example/watch.json"), look = await loadWith("https://campgambino.github.io.attacker.example/nba-command-center/data/watch.json");
    const rel = await loadWith("data/watch.json"), site = await loadWith(null), off = await loadWith("off");
    const outside = (r) => r.fetched.filter((u) => !/^https:\/\/campgambino\.github\.io\/nba-command-center\//.test(u) && !/^data\//.test(u));
    const codeFetched = [bad, look, rel, site].flatMap((r) => r.fetched.filter((u) => /\.js(\?|$)/.test(u)));
    const noEval = !/new Function|\beval\((?!name\))/.test(src.split("\n").filter((l) => !/^\s*(\*|\/\/)/.test(l)).join("\n"));
    ok(B.currentBlock(src) === want && !!site.st.oddRules && !!site.st.rareRules && typeof site.st.rareRules.liveRare === "function"
      && bad.st.refusedCc === "https://attacker.example/watch.json" && !outside(bad).length && /ignored an outside \?cc= address/.test(bad.note) && !outside(look).length && look.st.refusedCc
      && rel.fetched.includes("data/watch.json") && !rel.st.refusedCc && !site.st.refusedCc && !off.fetched.length && !codeFetched.length && noEval
      && JSON.parse(fs.readFileSync(path.join(root, "docs", "bridge", "version.json"), "utf8")).version === +(/var VERSION = (\d+);/.exec(src) || [])[1],
      "bridge v28 (0.141.18): an outside ?cc= (attacker.example, a lookalike host) fetches nothing from it and is said in the note; a relative .json path and the site still work; ?cc=off fetches nothing; no .js file is ever fetched and nothing is run with new Function or eval; the rules compiled in equal their sources",
      JSON.stringify({ bad: bad.fetched.slice(0, 4), look: outside(look), rel: rel.fetched.slice(0, 3), codeFetched, noEval, note: bad.note }));
  }
  {
    // v29 (0.142.0; the user, 11/21: "proceed with your suggestions"): career feat boards, live streaks, team streaks.
    featData = { v: 1, today: "2026-11-09", asOf: "2026-11-07", through: "2026-11-08", boards: {
      p30r10a5: { label: "30-point, 10-rebound, 5-assist games", one: "30-10-5 game", min: { pts: 30, reb: 10, ast: 5 }, rows: [
        { name: "Big Ten", now: 164 }, { name: "Old Guard", now: 157 }, { name: "Tie Man", id: "f1", team: "AAA", live: true, now: 136, games: ["fz1"] }, { name: "Other Tie", now: 135 }, { name: "Verge Guy", id: "f4", team: "AAA", live: true, now: 156, games: [] }] },
      t15: { label: "15-15-15 games", one: "15-15-15 game", min: { pts: 15, reb: 15, ast: 15 }, rows: [{ name: "Triple Man", id: "f2", team: "AAA", live: true, now: 18, games: [] }, { name: "Oscar Old", now: 14 }] },
      lowtd: { label: "10-10 games with single-digit points", one: "10-10 game with single-digit points", min: { reb: 10, ast: 10 }, max: { pts: 9 }, rows: [{ name: "Pass First", id: "f3", team: "AAA", live: true, now: 24, games: [] }, { name: "Old Kidd", now: 25 }] } },
      streaks: [{ id: "s1", name: "Dub Guy", team: "AAA", tests: ["dd"], label: "a double-double", n: 15, source: "notes" },
        { id: "s2", name: "Three Guy", team: "AAA", tests: [{ k: "fg3m", min: 1 }], label: "a made three", n: 102, source: "list", since: "1967-68", list: [{ name: "Long One", n: 268 }, { name: "Six Man", n: 110 }, { name: "Nine Nine", n: 99 }] },
        { id: "s3", name: "Dime Guy", team: "AAA", tests: [{ k: "ast", min: 5 }], label: "5+ assists", n: 13, source: "notes" }],
      teamStreaks: [{ team: "AAA", kind: "ptsVs", n: 31, min: 100, opp: "BBB", label: "games with 100+ points against the Bees" }, { team: "BBB", kind: "winHolding", n: 33, max: 105, label: "wins when holding the opponent to 105 or fewer" }] };
    const Z = { pts: 0, tpm: 0, tpa: 0, reb: 0, ast: 0, stl: 0, blk: 0, dreb: 0, oreb: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, to: 0, pf: 0, min: 30, starter: true };
    const P = (id, name, o) => ({ ...Z, id, name, ...o });
    const team = () => [P("f1", "Tie Man", { pts: 31, reb: 12, ast: 6 }), P("f2", "Triple Man", { pts: 16, reb: 15, ast: 15 }), P("f3", "Pass First", { pts: 6, reb: 11, ast: 12 }),
      P("f4", "Verge Guy", { pts: 27, reb: 11, ast: 6 }), P("s1", "Dub Guy", { pts: 18, reb: 7, ast: 3 }), P("s2", "Three Guy", { pts: 9, tpm: 1 }), P("s3", "Dime Guy", { pts: 12, ast: 3 })];
    const gm = (o = {}) => [{ id: "fz1", status: "live", period: 3, clock: "6:00", away: { tricode: "AAA", score: 96 }, home: { tricode: "BBB", score: 90 }, boxscore: { away: team(), home: [P("h9", "Home Nine", { pts: 10 })] }, ...o }];
    const pick = (r, pre) => Object.fromEntries([...r.cards].filter(([k]) => k.startsWith(pre)).map(([k, c]) => [k.slice(pre.length), c]));
    const go = async (games, date = "20261109") => { const r = run({ games, date }); await flush(); r.ctx.runAlertChecks(); await flush(); return r; };
    const r3 = await go(gm()), f3 = pick(r3, "cc-feat-");
    ok(f3["p30r10a5-f1-fz1"]?.icon === "📊 CAREER FEAT" && f3["p30r10a5-f1-fz1"].text === "Tie Man (AAA) — his 136th 30-10-5 game, passing Other Tie (135) for 4th all-time"
      && f3["t15-f2-fz1"]?.icon === "🏆 CAREER FEAT · RECORD" && f3["t15-f2-fz1"].text === "Triple Man (AAA) — his 19th 15-15-15 game, adding to his NBA record (Oscar Old is next with 14)"
      && !f3["lowtd-f3-fz1"] && f3["p30r10a5-f4-fz1"]?.icon === "👀 ON THE VERGE" && f3["p30r10a5-f4-fz1"].text === "Verge Guy (AAA) — 3 points from his 157th 30-10-5 game, tying Old Guard for 2nd all-time"
      && /Basketball-Reference through 2026-11-07 plus box scores since/.test(f3["p30r10a5-f1-fz1"].sub),
      "bridge v29 (0.142.0): a qualifying line that moves him on a career board is carded (a count that already holds tonight's game is taken back first); adding to a record he holds is a record card; one stat a step short from the 3rd quarter is \"on the verge\"; a board with a ceiling (single-digit points) waits for the end",
      JSON.stringify(Object.entries(f3).map(([k, c]) => [k, c.icon, c.text])));
    const r4 = await go(gm({ period: 4, clock: "4:00" })), f4 = pick(r4, "cc-feat-");
    ok(f4["lowtd-f3-fz1"]?.icon === "🏆 CAREER FEAT · RECORD · AS IT STANDS" && f4["lowtd-f3-fz1"].text === "Pass First (AAA) — his 25th 10-10 game with single-digit points, tying Old Kidd for the NBA record, 4:00 left",
      "bridge v29: the ceiling board is carded \"as it stands\" in the last five minutes", JSON.stringify(f4["lowtd-f3-fz1"]));
    const pf = r4.ctx.GAMES[0].boxscore.away.find((p) => p.id === "f3"); pf.pts = 11; r4.ctx.runAlertChecks(); await flush();
    ok(pick(r4, "cc-feat-")["lowtd-f3-fz1"]?.ended === true, "bridge v29: more points undo it and the card is greyed", JSON.stringify(pick(r4, "cc-feat-")["lowtd-f3-fz1"]));
    // Streaks: the night is after the file's through date. Live in the 3rd: the made three extends; nothing else yet.
    const s3 = pick(r3, "cc-streak-");
    ok(s3["s2-fz1"]?.icon === "🔥 STREAK EXTENDED" && s3["s2-fz1"].text === "Three Guy (AAA) — a made three in 103 straight games, the 3rd-longest since 1967-68; Six Man's 110 is next" && !s3["s1-fz1"] && !s3["s3-fz1"],
      "bridge v29: a run on the all-time list extends the moment the line meets it, with where it now stands", JSON.stringify(s3));
    const late = await go(gm({ period: 4, clock: "4:30" })), sl = pick(late, "cc-streak-");
    ok(sl["s1-fz1"]?.icon === "⚠️ STREAK IN DANGER" && sl["s1-fz1"].text === "Dub Guy (AAA) — 3 rebounds short of a double-double for 16 straight games, 4:30 left in the 4th"
      && sl["s3-fz1"]?.text === "Dime Guy (AAA) — 2 assists short of 5+ assists for 14 straight games, 4:30 left in the 4th",
      "bridge v29: inside the last six minutes, a notes run he hasn't met yet is \"in danger\", saying what's missing", JSON.stringify(sl));
    const d = late.ctx.GAMES[0].boxscore.away.find((p) => p.id === "s3"); d.ast = 5; late.ctx.GAMES[0].status = "final"; late.ctx.runAlertChecks(); await flush();
    const sf = pick(late, "cc-streak-");
    ok(sf["s3-fz1"]?.icon === "🔥 STREAK EXTENDED" && sf["s3-fz1"].text === "Dime Guy (AAA) — 5+ assists in 14 straight games" && sf["s1-fz1"]?.icon === "🧊 STREAK ENDS" && /^Dub Guy \(AAA\) — his run of 15 straight games with a double-double ends \(18 pts, 7 reb, 3 ast\)$/.test(sf["s1-fz1"].text),
      "bridge v29: getting there replaces the warning; at the final an unmet run ends, with his line", JSON.stringify(sf));
    // Team runs: 100+ against that one opponent, live; a win while holding the opponent under the bar, at stake only under it.
    const t3 = pick(await go(gm({ away: { tricode: "AAA", score: 101 }, home: { tricode: "BBB", score: 99 } })), "cc-tstreak-");
    ok(t3["AAA-ptsVs-fz1"]?.icon === "🔥 TEAM STREAK EXTENDED" && t3["AAA-ptsVs-fz1"].text === "AAA — 32 straight games with 100+ points against the Bees" && !t3["BBB-winHolding-fz1"],
      "bridge v29: a team run vs one opponent extends when the bar is reached; one that needs a win waits", JSON.stringify(t3));
    const tl = pick(await go(gm({ period: 4, clock: "2:00", away: { tricode: "AAA", score: 98 }, home: { tricode: "BBB", score: 96 } })), "cc-tstreak-");
    ok(tl["BBB-winHolding-fz1"]?.icon === "⚠️ TEAM STREAK IN DANGER" && tl["BBB-winHolding-fz1"].text === "BBB — 33 straight wins when holding the opponent to 105 or fewer on the line: 96-98, 2:00 left in the 4th",
      "bridge v29: late, trailing while holding the opponent under the bar puts the team run in danger", JSON.stringify(tl));
    const old = pick(await go(gm(), "20261108"), "cc-streak-");
    ok(!Object.keys(old).length, "bridge v29: a night the file already counts gets no streak cards", Object.keys(old).join(" "));
    // v33 (0.142.6): games-played runs. Every 50th game or a pass on the active list gets a card; a plain game doesn't;
    // a final without him in his team's box ends it.
    featData = { v: 1, today: "2026-11-09", asOf: "2026-11-07", through: "2026-11-08", boards: {}, teamStreaks: [], streaks: [
      { id: "i1", name: "Iron One", team: "AAA", tests: ["play"], label: "a game played", n: 199, source: "gp", list: [{ name: "Long Man", n: 653 }, { name: "Third Guy", n: 111 }] },
      { id: "i2", name: "Iron Two", team: "AAA", tests: ["play"], label: "a game played", n: 111, source: "gp", list: [{ name: "Long Man", n: 653 }, { name: "Iron One", n: 199 }, { name: "Third Guy", n: 111 }] },
      { id: "i3", name: "Iron Three", team: "AAA", tests: ["play"], label: "a game played", n: 120, source: "gp", list: [{ name: "Long Man", n: 653 }, { name: "Iron One", n: 199 }] },
      { id: "i4", name: "Iron Four", team: "AAA", tests: ["play"], label: "a game played", n: 150, source: "gp", list: [{ name: "Long Man", n: 653 }, { name: "Iron One", n: 199 }] }] };
    const ir = (o = {}) => [{ id: "iz1", status: "live", period: 1, clock: "9:00", away: { tricode: "AAA", score: 10 }, home: { tricode: "BBB", score: 8 },
      boxscore: { away: [P("i1", "Iron One", { min: 2, starter: true }), P("i2", "Iron Two", { min: 3, starter: false }), P("i3", "Iron Three", { min: 4 }), P("i4", "Iron Four", { min: 0, starter: false })], home: [P("h1", "Home One", {})] }, ...o }];
    const g1 = pick(await go(ir()), "cc-streak-");
    ok(g1["i1-iz1"]?.text === "Iron One (AAA) — 200 straight games played, the 2nd-longest active run" && !g1["i2-iz1"]
      && !g1["i3-iz1"] && !g1["i4-iz1"],
      "bridge v34 (0.142.7): a games-played run gets a card on its 50th, 100th… game only; passing a name on the active list (everyone adds one at a time) and an ordinary night get none", JSON.stringify(g1));
    const gf = pick(await go(ir({ status: "final", period: 4, clock: "0:00" })), "cc-streak-");
    ok(gf["i4-iz1"]?.icon === "🧊 STREAK ENDS" && gf["i4-iz1"].text === "Iron Four (AAA) — his run of 150 straight games played ends (the 3rd-longest active run in the NBA)" && !gf["i3-iz1"],
      "bridge v33: at the final, a run whose man is in his team's box without playing ends", JSON.stringify(gf));
    const gs = pick(await go(ir({ status: "final", period: 4, clock: "0:00", plays: [{ badge: "sub", qtr: 4, playerId: "i4", playerOutId: "h9", desc: "Iron Four enters the game" }] })), "cc-streak-");
    ok(!gs["i4-iz1"], "bridge v34: a few seconds on the floor (0 minutes, empty line) counts when the play-by-play shows him: no ends card", JSON.stringify(gs));
    featData = null;
  }
  flowData = null;
}
