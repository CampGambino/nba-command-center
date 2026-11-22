/*
 * NBA Command Center -> NBA Live bridge.                                  version 12
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
 *     - (v12, 0.75.1; the user, 11/15: "did the importance factor get overlooked or am I running an older version of
 *       the program?") the status note ends with the running version, and when a newer bridge has been published
 *       (bridge/version.json, looked at with each data refresh) it says so and asks for a refresh: NBA Live loads this
 *       file once, when its page loads, so cards fired by an older copy stay until then.
 *     - (v11, 0.72.8; the user, 11/15, on "Will Riley — 14 points from 800 points career · importance 25": "maybe below
 *       30 doesn't make the cut. big names are exceptions, but I doubt i need to know when someone gets to 2,000 made
 *       baskets") a round number needs importance 30 for a card (was 15). A big name (tonight.json `stars`) gets one
 *       from 25, in points, rebounds, assists, steals, blocks and threes only. A round number from the career records in
 *       any other stat needs a club of 10 or fewer (4,000 offensive rebounds: nine players ever).
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
 *     - (v30, 0.142.1; the user, 11/22: "Sure") A board from our own box scores: 25 points, 5 threes and 3 blocks since
 *       1993-94 (Wembanyama 15). Its counts can be short where our box scores miss games ("8+" on the card's back); the
 *       rules never pass, tie or place a player against such a count. The card names its source per board.
 *     - (v29, 0.142.0; the user, 11/21: "proceed with your suggestions") CAREER FEATS: the all-time boards the user sent
 *       (30-10-5, 25-10-5, 30-10 both ways, 40-point games, 30-point triple-doubles, 35 points with 5 threes, 5-block
 *       games, 15-15-15 and four more; Basketball-Reference through 11/19 plus our box scores since, featlive.json). A card
 *       when tonight's line qualifies and moves the player on the list (passes or ties a name, or adds to his record);
 *       "on the verge" from the 3rd quarter when one stat is a step short. A board with a ceiling (10-10 with single-digit
 *       points) only late, as it stands. STREAKS: runs the teams' notes name and our box scores confirm (Towns's
 *       double-doubles, Garland's 5+ assists), and Curry's made-three run on the all-time list: extended, in danger in the
 *       last 6 minutes, ended at the final. Team runs from the notes (wins over one opponent, 100+ against one, wins when
 *       holding a team to N or fewer) the same way. All-time points: a card for a place in the top 50 and for entering
 *       the top 100, 75, 50 or 25 (51st-100th otherwise is a site line only, never a card here).
 *     - (v28, 0.141.18; NBA Live's security check, 11/21) ?cc= is taken only when it is "off", an https address under
 *       the Command Center site or a relative .json path; any other is refused (said in the note) and the site is used.
 *       The odd-line and rare-combination rules are compiled into this file (tools/bundle-bridge-rules.mjs) instead of
 *       being downloaded from beside the ?cc= address and run with new Function: the bridge downloads data only.
 *     - (v27, 0.141.17; the user, 11/21: "flagging this stuff in real time in the nba live app", "should warn ahead of
 *       time", "five or fewer") RARE COMBINATIONS: a player's line that, in every column of a combination (points /
 *       rebounds / assists; points / threes / assists; rebounds / blocks / points; steals / blocks / points; assists /
 *       steals / points), has been matched or beaten in 4 or fewer regular-season games since 1993-94, so tonight's is one
 *       of five or fewer: "🦄 ONE OF ONE … 52 points and 24 rebounds: no one else has done that since 1993-94", with who
 *       did it before. Only the stats that matter are named; a line rare in one stat alone is left to the single-game
 *       lists. Points on few shots can be undone by a miss, so it waits for the final five minutes ("as it stands") and is
 *       greyed if undone. "👀 ON THE VERGE" while live when a small step would get there (5 points, 2 rebounds or
 *       assists, 1 three, steal or block); the card replaces it, and it is taken down if the game ends first. The counts
 *       are linerare.json, the rules lib/situations/linerare.js (read as text). Not in the playoffs.
 *     - (v26, 0.123; on the user's go, 11/19) the odd-line card's last words say what its count rests on, per kind of
 *       line: "ESPN and pbpstats box scores, under 1% of games not on file", or, for the six lines that need a turnover
 *       or a foul, "ESPN box scores, about 3% of games not on file" as before. Nothing else about the card changes.
 *     - (v25, 0.119; the user, 11/19: "the depending on zero is a good one to flag in the final five minutes… if it
 *       doesn't ping until the end of the game, it could get lost if it's immediately deactivated. The others seem fine")
 *       ODD LINES: a player's line with an odd shape (30 points and no free throw attempt, no field goal on 10 shots, a
 *       guard with 15 rebounds, 5 blocks and no rebound…), with how often it has happened since 1993-94. A line that can
 *       only grow fires the moment it is true. A line one play can undo fires in the final five minutes of the 4th
 *       quarter (any time in overtime) as "AS IT STANDS", is greyed if it is undone, and stays at the final. The rules
 *       are the Command Center's own (lib/situations/oddlines.js, read as text); the counts are oddlive.json. Not in
 *       the playoffs or a game that counts toward no book. One card a player (his rarest line leads; others follow in the
 *       small print). Where NBA Live has its own card for the same thing (a no-make or no-miss streak near a record,
 *       turnovers) this one stands aside, and a number far above his own average is left to NBA Live's high cards.
 *     - (v24, 0.109; the user, 11/18: "you may proceed with team record cards, but I am concerned that not all of the stats
 *       are factual given the errors already spotted") each team's single-game TEAM marks from its media guide
 *       (teammarks.json): a team total that ties or passes its franchise mark (most, live; fewest, at the final), one that
 *       is close to a "most", and the most or fewest by an opponent. An NBA record is said first, and where NBA Live has
 *       its own card for that league mark the franchise card only notes it. The small print says what backs the number:
 *       a second source by name, or "guide only".
 *     - (v22, 0.104; the user, 11/18) a foul's time no longer counts ESPN's "offensive foul turnover" line as a foul
 *       (Luka Doncic's 4th foul was shown at the time of his 3rd), and the back of the foul trouble card no longer
 *       prints the rule ("more fouls than the period number…").
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
 * Options (URL): ?cc=<watch.json address under the Command Center site, or a relative .json path>   ?cc=off  (disable)
 */
(function () {
  "use strict";
  var VERSION = 30;
  var DEFAULT_URL = "https://campgambino.github.io/nba-command-center/data/watch.json";
  var REFRESH_MS = 15 * 60 * 1000;
  // Editorial gate, in NBA Live's spirit ("a rung nobody celebrates produces a card nobody wants"):
  var MIN_CHANCE = 0.10;      // pre-game chance tonight needed to take a card while live
  var MIN_IMPORTANCE = 30;    // round numbers below this never get a card (passes always can). 15 until v11 (the user, 11/15)
  var STAR_IMPORTANCE = 25;   // ...except a big name's, in the six main stats
  var SMALL_CLUB = 10;        // a career-records round number in any other stat: only a club this small
  var MAX_PER_GAME = 6;       // in-play cards per game, best first (reached ones always show)
  var PRE_PER_GAME = 3;       // pre-game storyline cards per game
  var ICON = { find: "🔎 FOUND IN THE NUMBERS", history: "📜 FROM THE NOTES", injury: "🩹 INJURY", milestone: "🎯 IN REACH", streak: "🔥 STREAK", lead: "👑 TEAM LEADER", shooting: "🏹 50/40/90", team: "📈 TEAM STREAK", feat: "📊 CAREER FEAT", record: "🏛️ RECORD WATCH", context: "📊 CAREER CONTEXT", foul: "⚠️ FOUL WATCH", early: "🔄 LEFT EARLY LAST TIME", fourth: "⏳ 4TH QUARTER", qtr: "🕒 BY QUARTER", clinch: "🔒 CLINCH WATCH", season: "📊 THIS SEASON", span: "🧩 IN THAT SPAN", pstreak: "🔥 STREAK WATCH", vsopp: "🆚 VS TONIGHT'S OPPONENT", pace: "⏱️ PACE", trade: "🔁 SINCE THE TRADE", role: "🪑 STARTER VS BENCH", lineup: "🖐️ STARTING FIVE", turn: "↪️ RECORD TURN", beaten: "⚔️ WHO'S BEATEN THEM", month: "🗓️ THIS MONTH", monthp: "🗓️ THIS MONTH", rookie: "🌱 ROOKIES", era: "📆 SINCE THEN", defense: "🛡️ DEFENSE WATCH", cup: "🏆 NBA CUP" };

  // ESPN abbreviations NBA Live shows -> Command Center tricodes.
  var TRI = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", PHO: "PHX", BRK: "BKN", CHO: "CHA" };
  var tri = function (t) { t = String(t || "").toUpperCase(); return TRI[t] || t; };

  // Command Center stat -> NBA Live box-score field.
  var FIELD = { pts: "pts", reb: "reb", ast: "ast", stl: "stl", blk: "blk", fg3m: "tpm", ftm: "ftm", fgm: "fgm", dreb: "dreb", oreb: "oreb", min: "min" };
  // NBA Live's own ladders (MILESTONE_LADDERS): those round numbers are already its cards.
  var NBA_LIVE_STAT = { pts: "pts", fg3m: "tpm", reb: "reb", ast: "ast", stl: "stl", blk: "blk" };

  var state = { data: null, items: [], tonight: null, records: null, recItems: [], bests: null, flow: null, ftShown: {}, maxLead: {}, firstAt: {}, done: {}, hit: {}, merged: {}, decorated: {}, loadedAt: 0, error: null, connected: false, fired: 0, keys: {} };
  window.CC_BRIDGE = { version: VERSION, state: state };

  // v28: the odd-line and rare-combination rules are part of the bridge (they were downloaded and run with new Function).
  // ===== BUNDLED RULES: generated by tools/bundle-bridge-rules.mjs from src/situations/oddlines.js, linerare.js and src/records/featlive.js. Edit those, then run the tool. =====
  var ODD_RULES = (function () {
/**
 * Odd stat lines (0.117.0; pure). The user, 11/19, with thirteen posts of odd lines: "these are concepts worth
 * tracking and flagging" and "you don't need to check for these players specifically, nor these stats exactly".
 *
 * A template is a rule about the SHAPE of one player's line in one game (one column against another, or against his
 * own average or his position), kept at several levels. The same rules are run over 33 seasons of box scores by
 * tools/odd-games/build-history.mjs (-> src/data/odd-lines-history.json) and over this season's games here, so
 * "how rare" is counted with the rule that flags it.
 *
 * Seven families (claude/odd-games-study.md):
 *   1 all from one source · 2 volume without result, or result without a miss · 3 one column and nothing else ·
 *   4 out of role (position, or his own average) · 5 too much in too little · 6 coincidence lines ·
 *   7 far from his own scoring average.
 *
 * Nothing is cut for being common: every hit is listed, and the grade says how rare it is NOW (per season over the
 * history's last five seasons): rare = at most 1 a season, few = at most 5, monthly = at most 15, common = more.
 *
 * A line: { min, pts, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, reb, ast, stl, blk, tov, pf, starter }.
 * Context x: { pos: "G" | "F" | "C" | null, avg: { pts, reb, ast } | null } where avg is his average in his OTHER
 * games that season and is null unless he has ODD.games of them.
 */
const ODD = { games: 10, rare: 1, few: 5, monthly: 15, recent: 5, list: 3, nth: 60 };
const GRADES = ["rare", "few", "monthly", "common"];
const FAMILY = { 1: "All from one source", 2: "Volume without result", 3: "One column and nothing else", 4: "Out of role", 5: "Too much in too little", 6: "Coincidence", 7: "Far from his average" };

const other = (l) => l.reb + l.ast + l.stl + l.blk;
const five = (l) => [l.pts, l.reb, l.ast, l.stl, l.blk];
const tens = (l) => [l.reb, l.ast, l.stl, l.blk].filter((v) => v >= 10).length;
const r1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const WORDS = [["reb", "rebound"], ["ast", "assist"], ["stl", "steal"], ["blk", "block"]];
// "one assist and no rebound, steal or block" for a line with a single entry in those four columns
const oneOther = (l) => { const has = WORDS.find(([k]) => l[k] > 0), rest = WORDS.filter(([k]) => !(l[k] > 0)).map(([, w]) => w); return `one ${has[1]} and no ${rest.slice(0, -1).join(", ")} or ${rest[rest.length - 1]}`; };
const shot = (l) => `${l.fgm}-for-${l.fga}`;
const L = (k, what, test, say) => ({ k, what, test, say });
// One template at rising levels of one number: steps(["30", "35", "40"], (n) => what, (l, n) => test, say)
const steps = (ns, what, test, say) => ns.map((n) => L(String(n), what(n), (l, x) => test(l, n, x), say));

const TEMPLATES = [
  // 1. All from one source
  { id: "noft", f: 1, levels: steps([30, 35, 40], (n) => `${n}+ points without a free throw attempt`, (l, n) => l.pts >= n && l.fta === 0, (l) => `${l.pts} points without a free throw attempt`) },
  { id: "ftshare", f: 1, levels: [
    L("60", "15+ points, 60% or more of them free throws", (l) => l.pts >= 15 && l.ftm >= 0.6 * l.pts, (l) => `${l.ftm} of his ${l.pts} points were free throws (${shot(l)} from the field)`),
    L("75", "15+ points, three-quarters or more of them free throws", (l) => l.pts >= 15 && l.ftm >= 0.75 * l.pts, (l) => `${l.ftm} of his ${l.pts} points were free throws (${shot(l)} from the field)`),
    L("2fg", "20+ points on two field goals or fewer", (l) => l.pts >= 20 && l.fgm <= 2, (l) => `${l.pts} points on ${l.fgm === 1 ? "one field goal" : `${l.fgm} field goals`} (${l.ftm}-of-${l.fta} at the line)`),
  ] },
  { id: "nofg", f: 1, levels: steps([8, 10, 12], (n) => `${n}+ points without a field goal`, (l, n) => l.pts >= n && l.fgm === 0, (l) => `${l.pts} points without a field goal (0-for-${l.fga}, ${l.ftm}-of-${l.fta} at the line)`) },
  { id: "all3", f: 1, levels: steps([25, 30, 40], (n) => `${n}+ points with every basket a three`, (l, n) => l.pts >= n && l.fgm > 0 && l.fgm === l.fg3m, (l) => `${l.pts} points without a two-point basket (${l.fg3m} threes, ${l.ftm} free throws)`) },
  { id: "fta", f: 1, levels: steps([20, 25, 30], (n) => `${n}+ free throw attempts`, (l, n) => l.fta >= n, (l) => `${l.fta} free throw attempts (made ${l.ftm})`) },
  // 2. Volume without result, and result without a miss
  { id: "ofg", f: 2, levels: steps([8, 10, 12], (n) => `no field goal on ${n}+ attempts`, (l, n) => l.fgm === 0 && l.fga >= n, (l) => `0-for-${l.fga} from the field`) },
  { id: "o3", f: 2, levels: steps([8, 10, 12], (n) => `0-for-${n} or worse from three`, (l, n) => l.fg3m === 0 && l.fg3a >= n, (l) => `0-for-${l.fg3a} from three`) },
  { id: "brick", f: 2, levels: steps([15, 20, 25], (n) => `${n}+ shots at 20% or worse`, (l, n) => l.fga >= n && l.fgm <= 0.2 * l.fga, (l) => `${shot(l)} from the field`) },
  { id: "ftmiss", f: 2, levels: steps([8, 10, 12], (n) => `${n}+ free throws missed`, (l, n) => l.fta - l.ftm >= n, (l) => `missed ${l.fta - l.ftm} free throws (${l.ftm}-of-${l.fta})`) },
  { id: "perfg", f: 2, levels: steps([8, 10, 12], (n) => `${n}+ field goals without a miss`, (l, n) => l.fgm >= n && l.fgm === l.fga, (l) => `${l.fgm}-for-${l.fga} from the field`) },
  { id: "perft", f: 2, levels: steps([14, 16, 18], (n) => `${n}+ free throws without a miss`, (l, n) => l.ftm >= n && l.ftm === l.fta, (l) => `${l.ftm}-of-${l.fta} at the line`) },
  // 3. One column and nothing else
  { id: "empty", f: 3, levels: [
    L("20near", "20+ points with one rebound, assist, steal or block at most", (l) => l.pts >= 20 && other(l) <= 1, (l) => `${l.pts} points with ${other(l) ? oneOther(l) : "no rebound, assist, steal or block"}`),
    ...steps([15, 20, 25, 30], (n) => `${n}+ points with no rebound, assist, steal or block`, (l, n) => l.pts >= n && other(l) === 0, (l) => `${l.pts} points with no rebound, assist, steal or block`),
  ] },
  { id: "ast0", f: 3, levels: steps([8, 10, 12, 15], (n) => `${n}+ assists and no points`, (l, n) => l.pts === 0 && l.ast >= n, (l) => `${l.ast} assists and no points (0-for-${l.fga})`) },
  { id: "reb0", f: 3, levels: steps([12, 15, 20], (n) => `${n}+ rebounds and no points`, (l, n) => l.pts === 0 && l.reb >= n, (l) => `${l.reb} rebounds and no points (0-for-${l.fga})`) },
  { id: "min0", f: 3, levels: steps([30, 36, 42], (n) => `${n}+ minutes and no points`, (l, n) => l.pts === 0 && l.min >= n, (l) => `${l.min} minutes without a point (0-for-${l.fga})`) },
  { id: "noshot", f: 3, levels: steps([24, 30, 36], (n) => `${n}+ minutes without attempting a shot`, (l, n) => l.fga === 0 && l.min >= n, (l) => `${l.min} minutes without attempting a field goal`) },
  { id: "noshotbig", f: 3, levels: [L("1", "15+ rebounds, 10+ assists, 4+ steals or 5+ blocks without attempting a shot", (l) => l.fga === 0 && (l.reb >= 15 || l.ast >= 10 || l.stl >= 4 || l.blk >= 5),
    (l) => `${l.reb >= 15 ? `${l.reb} rebounds` : l.ast >= 10 ? `${l.ast} assists` : l.stl >= 4 ? `${l.stl} steals` : `${l.blk} blocks`} without attempting a field goal`)] },
  { id: "tov0", f: 3, levels: steps([5, 7], (n) => `${n}+ turnovers and no points`, (l, n) => l.pts === 0 && l.tov >= n, (l) => `${l.tov} turnovers and no points`) },
  { id: "pts0reb", f: 3, levels: steps([30, 40], (n) => `${n}+ points and no rebound`, (l, n) => l.reb === 0 && l.pts >= n, (l) => `${l.pts} points without a rebound`) },
  { id: "blk0reb", f: 3, levels: steps([4, 5], (n) => `${n}+ blocks and no rebound`, (l, n) => l.reb === 0 && l.blk >= n, (l) => `${l.blk} blocks without a rebound`) },
  { id: "nothing", f: 3, levels: steps([12, 15, 20], (n) => `${n}+ minutes with nothing in the box score`, (l, n) => l.min >= n && l.pts + l.fga + l.fta + l.reb + l.ast + l.stl + l.blk + l.tov + l.pf === 0, (l) => `${l.min} minutes with nothing in the box score: no shot, rebound, assist, steal, block, turnover or foul`) },
  // 4. Out of role: by position (ESPN's label for the player), and by his own average
  { id: "greb", f: 4, levels: steps([15, 18, 20], (n) => `a guard with ${n}+ rebounds`, (l, n, x) => x.pos === "G" && l.reb >= n, (l) => `${l.reb} rebounds by a guard`) },
  { id: "cast", f: 4, levels: steps([12, 15], (n) => `a center with ${n}+ assists`, (l, n, x) => x.pos === "C" && l.ast >= n, (l) => `${l.ast} assists by a center`) },
  { id: "gblk", f: 4, levels: steps([5, 6], (n) => `a guard with ${n}+ blocks`, (l, n, x) => x.pos === "G" && l.blk >= n, (l) => `${l.blk} blocks by a guard`) },
  { id: "c3", f: 4, levels: steps([6, 8], (n) => `a center with ${n}+ threes`, (l, n, x) => x.pos === "C" && l.fg3m >= n, (l) => `${l.fg3m} threes by a center`) },
  { id: "reb3x", f: 4, levels: [L("1", "15+ rebounds at three times his average", (l, x) => !!x.avg && x.avg.reb >= 2 && l.reb >= 15 && l.reb >= 3 * x.avg.reb, (l, x) => `${l.reb} rebounds (averages ${r1(x.avg.reb)})`)] },
  { id: "ast3x", f: 4, levels: [L("1", "12+ assists at three times his average", (l, x) => !!x.avg && x.avg.ast >= 1.5 && l.ast >= 12 && l.ast >= 3 * x.avg.ast, (l, x) => `${l.ast} assists (averages ${r1(x.avg.ast)})`)] },
  // 5. Too much in too little
  { id: "quick", f: 5, levels: [
    L("25in20", "25+ points in 20 minutes or fewer", (l) => l.pts >= 25 && l.min <= 20, (l) => `${l.pts} points in ${l.min} minutes`),
    L("20in15", "20+ points in 15 minutes or fewer", (l) => l.pts >= 20 && l.min <= 15, (l) => `${l.pts} points in ${l.min} minutes`),
    L("15in10", "15+ points in 10 minutes or fewer", (l) => l.pts >= 15 && l.min <= 10, (l) => `${l.pts} points in ${l.min} minutes`),
  ] },
  { id: "foulout", f: 5, levels: [12, 8].map((n) => L(String(n), `fouled out in ${n} minutes or fewer`, (l) => l.pf >= 6 && l.min <= n, (l) => `fouled out in ${l.min} minutes`)) },
  { id: "zeromin", f: 5, levels: [L("1", "a box-score entry in 0 minutes", (l) => l.min === 0 && l.pts + l.reb + l.ast + l.stl + l.blk + l.tov + l.pf + l.fga + l.fta > 0,
    (l) => `in the box score without a minute played: ${[[l.pts, "point"], [l.reb, "rebound"], [l.ast, "assist"], [l.stl, "steal"], [l.blk, "block"], [l.tov, "turnover"], [l.pf, "foul"], [l.fga, "shot"], [l.fta, "free throw attempt"]].filter(([v]) => v > 0).map(([v, w]) => `${v} ${w}${v === 1 ? "" : "s"}`).join(", ")}`)] },
  { id: "tov", f: 5, levels: steps([8, 10, 12], (n) => `${n}+ turnovers`, (l, n) => l.tov >= n, (l) => `${l.tov} turnovers`) },
  // 6. Coincidence lines
  { id: "ones", f: 6, levels: [
    L("5", "exactly one point, rebound, assist, steal and block", (l) => five(l).every((v) => v === 1), () => "exactly one point, rebound, assist, steal and block"),
    L("6", "exactly one point, rebound, assist, steal, block and turnover", (l) => five(l).every((v) => v === 1) && l.tov === 1, () => "exactly one point, rebound, assist, steal, block and turnover"),
    L("2s", "exactly two points, rebounds, assists, steals and blocks", (l) => five(l).every((v) => v === 2), () => "exactly two points, rebounds, assists, steals and blocks"),
  ] },
  { id: "x5", f: 6, levels: steps([4, 5], (n) => `${n} or more points, rebounds, assists, steals and blocks`, (l, n) => five(l).every((v) => v >= n), (l) => `${l.pts} points, ${l.reb} rebounds, ${l.ast} assists, ${l.stl} steals and ${l.blk} blocks`) },
  { id: "lowpts", f: 6, levels: [
    L("ra", "10+ rebounds and 10+ assists with under 10 points", (l) => l.reb >= 10 && l.ast >= 10 && l.pts < 10, (l) => `${l.reb} rebounds and ${l.ast} assists with ${l.pts} points`),
    L("ra5", "10+ rebounds and 10+ assists with 5 points or fewer", (l) => l.reb >= 10 && l.ast >= 10 && l.pts <= 5, (l) => `${l.reb} rebounds and ${l.ast} assists with ${l.pts} points`),
    L("dd2", "a double-double with 2 points or fewer", (l) => l.pts <= 2 && tens(l) >= 2, (l) => `a double-double with ${l.pts} points (${l.reb} rebounds, ${l.ast} assists)`),
    L("td", "a triple-double with under 10 points", (l) => l.pts < 10 && tens(l) >= 3, (l) => `a triple-double with ${l.pts} points (${l.reb} rebounds, ${l.ast} assists, ${l.stl} steals, ${l.blk} blocks)`),
  ] },
  { id: "pair", f: 6, levels: [
    L("3oreb6", "6+ threes with 6+ offensive rebounds", (l) => l.fg3m >= 6 && l.oreb >= 6, (l) => `${l.fg3m} threes and ${l.oreb} offensive rebounds`),
    L("3oreb8", "6+ threes with 8+ offensive rebounds", (l) => l.fg3m >= 6 && l.oreb >= 8, (l) => `${l.fg3m} threes and ${l.oreb} offensive rebounds`),
    L("astoreb", "12+ assists with 8+ offensive rebounds", (l) => l.ast >= 12 && l.oreb >= 8, (l) => `${l.ast} assists and ${l.oreb} offensive rebounds`),
    L("astblk10", "10+ assists with 5+ blocks", (l) => l.ast >= 10 && l.blk >= 5, (l) => `${l.ast} assists and ${l.blk} blocks`),
    L("astblk12", "12+ assists with 5+ blocks", (l) => l.ast >= 12 && l.blk >= 5, (l) => `${l.ast} assists and ${l.blk} blocks`),
    L("blk3", "5+ blocks with 5+ threes", (l) => l.blk >= 5 && l.fg3m >= 5, (l) => `${l.blk} blocks and ${l.fg3m} threes`),
    L("blk36", "5+ blocks with 6+ threes", (l) => l.blk >= 5 && l.fg3m >= 6, (l) => `${l.blk} blocks and ${l.fg3m} threes`),
    L("reb3", "15+ rebounds with 6+ threes", (l) => l.reb >= 15 && l.fg3m >= 6, (l) => `${l.reb} rebounds and ${l.fg3m} threes`),
    L("stlblk", "5+ steals with 5+ blocks", (l) => l.stl >= 5 && l.blk >= 5, (l) => `${l.stl} steals and ${l.blk} blocks`),
  ] },
  { id: "bench", f: 6, levels: [
    ...steps([35, 40], (n) => `${n}+ points off the bench`, (l, n) => l.starter === 0 && l.pts >= n, (l) => `${l.pts} points off the bench`),
    L("reb18", "18+ rebounds off the bench", (l) => l.starter === 0 && l.reb >= 18, (l) => `${l.reb} rebounds off the bench`),
    L("reb20", "20+ rebounds off the bench", (l) => l.starter === 0 && l.reb >= 20, (l) => `${l.reb} rebounds off the bench`),
  ] },
  // 7. Far from his own scoring average (his other games that season; ODD.games of them)
  { id: "dud", f: 7, levels: [
    L("half", "a 25-point scorer under half his average in 28+ minutes", (l, x) => !!x.avg && x.avg.pts >= 25 && l.min >= 28 && l.pts < 0.5 * x.avg.pts, (l, x) => `${l.pts} points in ${l.min} minutes (averages ${r1(x.avg.pts)}; ${shot(l)})`),
    L("25", "a 25-point scorer held to 9 or fewer in 28+ minutes", (l, x) => !!x.avg && x.avg.pts >= 25 && l.min >= 28 && l.pts <= 9, (l, x) => `${l.pts} points in ${l.min} minutes (averages ${r1(x.avg.pts)}; ${shot(l)})`),
    L("20", "a 20-point scorer held to 5 or fewer in 28+ minutes", (l, x) => !!x.avg && x.avg.pts >= 20 && l.min >= 28 && l.pts <= 5, (l, x) => `${l.pts} points in ${l.min} minutes (averages ${r1(x.avg.pts)}; ${shot(l)})`),
    L("nofg", "a 20-point scorer without a field goal in 25+ minutes", (l, x) => !!x.avg && x.avg.pts >= 20 && l.min >= 25 && l.fgm === 0, (l, x) => `no field goal in ${l.min} minutes (0-for-${l.fga}; averages ${r1(x.avg.pts)} points)`),
    L("zero", "a 20-point scorer scoreless in 10+ minutes", (l, x) => !!x.avg && x.avg.pts >= 20 && l.min >= 10 && l.pts === 0, (l, x) => `scoreless in ${l.min} minutes (averages ${r1(x.avg.pts)})`),
  ] },
  { id: "erupt", f: 7, levels: [
    L("3x", "25+ points at three times an average under 10", (l, x) => !!x.avg && x.avg.pts < 10 && l.pts >= 25 && l.pts >= 3 * x.avg.pts, (l, x) => `${l.pts} points (averages ${r1(x.avg.pts)})`),
    L("25", "25 or more above his average", (l, x) => !!x.avg && l.pts >= x.avg.pts + 25, (l, x) => `${l.pts} points (averages ${r1(x.avg.pts)})`),
    L("u8", "30+ points by a player averaging under 8", (l, x) => !!x.avg && x.avg.pts < 8 && l.pts >= 30, (l, x) => `${l.pts} points (averages ${r1(x.avg.pts)})`),
    L("30", "30 or more above his average", (l, x) => !!x.avg && l.pts >= x.avg.pts + 30, (l, x) => `${l.pts} points (averages ${r1(x.avg.pts)})`),
  ] },
];

/**
 * 0.121.0, widened in 0.122.0. ESPN has no player numbers for the Bulls' and Pelicans' games of 2012-13 to 2017-18; pbpstats
 * has them. The user's five Basketball Reference box scores (11/19/26) matched pbpstats for all 102 players in every
 * column it has: points, shots, rebounds, assists, steals, blocks, minutes. It has no turnovers and no fouls.
 *   TOV_PF: what cannot be counted for those games: the templates (and the one level) that need a turnover or a foul.
 *   NO_TOV_PF: of those, the two a missing (zero) turnover or foul could make TRUE by mistake; the history drops them
 *   for a filled line. The others simply cannot fire without turnovers or fouls.
 * Tested: for every other template, changing turnovers and fouls never changes whether it matches.
 * (0.121.0 counted these games for eleven shooting-only templates; the user: "I thought we grabbed and filed all of the
 * bulls and pelicans stats. why are the not being included in some searches?")
 */
const TOV_PF = ["tov", "tov0", "foulout", "nothing", "zeromin", "ones.6"];
const NO_TOV_PF = ["nothing", "zeromin"];

/**
 * 0.127: a short name for each template whose line a later play can undo (LATE), for the "does it hold" table
 * (src/data/odd-lines-hold.json, tools/odd-games/late). The levels' own wording names a number; this names the shape.
 */
const LATE_NAMES = {
  noft: "Points without a free throw attempt", ftshare: "Most of his points from the line", nofg: "Points without a field goal", all3: "Every basket a three",
  ofg: "No field goal on 8+ attempts", o3: "0-for-8 or worse from three", brick: "15+ shots at 20% or worse", perfg: "8+ field goals without a miss", perft: "14+ free throws without a miss",
  empty: "Points and next to nothing else", ast0: "Assists and no points", reb0: "Rebounds and no points", min0: "Long minutes and no points", noshot: "Long minutes without a shot",
  noshotbig: "A big rebound, assist, steal or block night without a shot", tov0: "Turnovers and no points", pts0reb: "30+ points and no rebound", blk0reb: "Blocks and no rebound",
  quick: "A scoring burst in few minutes", ones: "Exactly one (or two) of everything", lowpts: "Double figures in rebounds and assists, few points", dud: "A scorer far under his average",
  nothing: "Minutes with nothing in the box score", zeromin: "A box-score entry in 0 minutes",
};

/** ESPN's position label -> "G" | "F" | "C" | null (anything else, or none). */
const posGroup = (p) => (p === "G" || p === "PG" || p === "SG" ? "G" : p === "C" ? "C" : p === "F" || p === "SF" || p === "PF" ? "F" : null);

/** Every template level this line passes: [{ key: "id.k", id, k, f, what, say }]. */
function matchLine(l, x = {}) {
  const cx = { pos: x.pos ?? null, avg: x.avg ?? null }, out = [];
  for (const t of TEMPLATES) for (const lv of t.levels) if (lv.test(l, cx)) out.push({ key: `${t.id}.${lv.k}`, id: t.id, k: lv.k, f: t.f, what: lv.what, say: lv.say(l, cx) });
  return out;
}

/** Per season over the history's last five seasons; the grade that follows. */
const rateOf = (h) => (h ? h.l5 / ODD.recent : 0);
const gradeOf = (rate) => (rate <= ODD.rare ? "rare" : rate <= ODD.few ? "few" : rate <= ODD.monthly ? "monthly" : "common");

const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}/${d.slice(2, 4)}`;
const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
// With a history entry before without; then the lower recent rate; then the fewer ever.
const rarer = (a, b) => ((a.grade == null) !== (b.grade == null) ? b.grade == null : a.rate !== b.rate ? a.rate < b.rate : a.before < b.before);
const lineOf = (v, IX) => { const l = {}; for (const [k, i] of Object.entries(IX)) if (i >= 1) l[k] = v[i] || 0; return l; };
/**
 * 0.118.0: ESPN lists no starters at all for 447 team-games (mostly 2001-02, 2004-05 and 2005-06), which made every
 * player in them look like a reserve (Dwyane Wade's 40 on 3/8/06 counted as "off the bench"). A side's starter flags
 * are used only when exactly five are marked; otherwise `starter` is null and the bench and starter rules say nothing.
 */
const STARTERS = 5;
function linesOf(g, IX) {
  const n = [0, 0];
  for (const v of Object.values(g.pl)) if (v[IX.starter]) n[v[IX.side] === 0 ? 0 : 1]++;
  return Object.entries(g.pl).map(([id, v]) => { const l = lineOf(v, IX); if (n[v[IX.side] === 0 ? 0 : 1] !== STARTERS) l.starter = null; return [id, v, l]; });
}

/**
 * The odd lines on each of `dates`, rarest first.
 *   rows: this season's results rows with `pl` (id -> array indexed by IX; see trends.js LINE_IX)
 *   history: src/data/odd-lines-history.json ({ t: { "id.k": { n, l5, last: [[name, d, team, text]] } }, from, through })
 *   names: { id: name } · pos: { id: ESPN position label } · tally: optional {} filled with this season's { n, last } for every level
 * -> { date: [{ id, name, team, opp, home, win, d, min, box, grade, rate, hits: [{ key, f, what, say, grade, rate, before, last, note, text }] }] }
 * One hit a template: the rarest level the line passes (lowest recent rate, then fewest ever).
 * `before` counts the history plus this season's earlier nights (same-night lines do not count each other).
 */
function oddNights({ rows = [], history = null, names = {}, pos = {}, dates = [], IX, tally = null }) {
  const H = history?.t || {}, want = new Set(dates), played = [...rows].filter((g) => g.pl && /^\d{4}-\d\d-\d\d$/.test(g.d || "")).sort((a, b) => a.d.localeCompare(b.d));
  // his average in his other games this season
  const sum = {};
  for (const g of played) for (const [id, v] of Object.entries(g.pl)) { if (!(v[IX.min] > 0)) continue; const s = (sum[id] ??= { n: 0, pts: 0, reb: 0, ast: 0 }); s.n++; s.pts += v[IX.pts] || 0; s.reb += v[IX.reb] || 0; s.ast += v[IX.ast] || 0; }
  const ctx = (id, l) => {
    const s = sum[id], mine = l.min > 0 ? 1 : 0, n = (s?.n || 0) - mine;
    return { pos: posGroup(pos[id]), avg: n >= ODD.games ? { pts: (s.pts - mine * l.pts) / n, reb: (s.reb - mine * l.reb) / n, ast: (s.ast - mine * l.ast) / n, n } : null };
  };
  const seen = {}, out = Object.fromEntries(dates.map((d) => [d, []]));   // seen: key -> [[name, d, team, text]] this season, oldest first
  let i = 0;
  while (i < played.length) {
    const d = played[i].d, tonight = [];
    for (; i < played.length && played[i].d === d; i++) {
      const g = played[i];
      for (const [id, v, l] of linesOf(g, IX)) {
        const x = ctx(id, l), hits = matchLine(l, x);
        if (!hits.length) continue;
        const home = v[IX.side] === 0;
        tonight.push({ id, g, home, l, x, hits });
      }
    }
    if (want.has(d)) {
      for (const { id, g, home, l, hits } of tonight) {
        const best = {};
        for (const h of hits) {
          const hist = H[h.key] || null, mine = seen[h.key] || [], rate = rateOf(hist), before = (hist?.n || 0) + mine.length;
          const lastOne = mine.length ? mine[mine.length - 1] : hist?.last?.[0] || null;
          const cand = { ...h, rate: Math.round(rate * 10) / 10, grade: hist ? gradeOf(rate) : null, before, last: lastOne };
          const cur = best[h.id];
          if (!cur || rarer(cand, cur)) best[h.id] = cand;
        }
        const list = Object.values(best).map((h) => ({ ...h, note: note(h, history), text: sentence(h, history) })).sort((a, b) => GRADES.indexOf(a.grade ?? "common") - GRADES.indexOf(b.grade ?? "common") || a.rate - b.rate || a.before - b.before);
        out[d].push({ id, name: names[id] || id, team: home ? g.h : g.a, opp: home ? g.a : g.h, home: home && !g.n, win: home ? g.hs > g.as : g.as > g.hs, d, min: l.min,
          box: `${l.pts} pts, ${l.reb} reb, ${l.ast} ast, ${l.stl} stl, ${l.blk} blk, ${l.fgm}-${l.fga} FG, ${l.fg3m}-${l.fg3a} 3PT, ${l.ftm}-${l.fta} FT, ${l.tov} TO in ${l.min} min`,
          grade: list[0].grade, rate: list[0].rate, hits: list });
      }
      out[d].sort((a, b) => GRADES.indexOf(a.grade ?? "common") - GRADES.indexOf(b.grade ?? "common") || a.rate - b.rate || a.hits[0].before - b.hits[0].before || a.name.localeCompare(b.name));
    }
    for (const { id, g, home, hits } of tonight) for (const h of hits) (seen[h.key] ??= []).push([names[id] || id, d, home ? g.h : g.a, h.say]);
  }
  if (tally) for (const [k, v] of Object.entries(seen)) tally[k] = { n: v.length, last: v[v.length - 1] };
  return out;
}

/**
 * How rare the class is, for a hit: "40+ points off the bench: the 56th on file since 1993-94 (last: X, 1/14/26, 43 points
 * off the bench)." or "8+ turnovers: about 42 a season over the last five seasons (last: …)." "On file": the history
 * leaves out the games ESPN has no player numbers for.
 */
function note(h, history) {
  if (h.grade == null) return "";
  const since = history?.from || "1993-94", cls = `${h.what[0].toUpperCase()}${h.what.slice(1)}`;
  const last = h.last ? ` (last: ${h.last[0]}, ${md(h.last[1])}${h.last[3] && h.last[3] !== h.say ? `, ${h.last[3]}` : ""})` : "";
  if (h.before === 0) return `${cls}: the first on file since ${since}.`;
  if (h.before <= ODD.nth) return `${cls}: the ${ord(h.before + 1)} on file since ${since}${last}.`;
  return `${cls}: about ${h.rate >= 10 ? Math.round(h.rate) : h.rate} a season over the last five seasons${last}.`;
}
const sentence = (h, history) => `${h.say}. ${note(h, history)}`.trim();

/* ---------------------------------------------------------------------------------------------------------------
 * 0.118.0: tonight's watch lists (step 2 of the study's order; the user, 11/19 1:00 PM: "keep going").
 *
 * RUNS: a bad night repeated. A run is counted over a player's games of RUN_MIN minutes or more within one season
 * (shorter games neither extend nor break it), with his average taken from his other games that season.
 * AGAIN: the same template level in consecutive games he played.
 * The history of both ("a third straight has happened 21 times") is counted by tools/odd-games/build-history.mjs
 * with `runLengths` below, the same function the site uses on this season.
 * ------------------------------------------------------------------------------------------------------------- */
const RUN_MIN = 20;
const RUN_MAX = 6;
const RUNS = [
  { id: "half", what: "a 20-point scorer under half his average", test: (l, x) => !!x.avg && x.avg.pts >= 20 && l.pts < 0.5 * x.avg.pts, say: "under half his scoring average" },
  { id: "seventy", what: "a 22-point scorer under 70% of his average", test: (l, x) => !!x.avg && x.avg.pts >= 22 && l.pts < 0.7 * x.avg.pts, say: "under 70% of his scoring average" },
  { id: "st0", what: "a starter scoreless in 20+ minutes", test: (l) => l.starter === 1 && l.pts === 0, say: "scoreless as a starter" },
  { id: "cold", what: "an 18-point scorer at 30% or worse on 10+ shots", test: (l, x) => !!x.avg && x.avg.pts >= 18 && l.fga >= 10 && l.fgm <= 0.3 * l.fga, say: "at 30% or worse on 10+ shots" },
];
/** Template levels that make no sense as "the same again" (a line with no minutes is not a game played). */
const NOT_AGAIN = new Set(["zeromin.1"]);

/**
 * One player's season, in date order: games = [{ l, x, d }] (x: his context for that game).
 * -> { runs: { id: [length after each qualifying game…] }, again: { key: [length…] }, now: { runs: { id: k }, again: { key: k } }, hits: [[keys] per game] }
 * `runs[id]` lists the length the run had reached at each game that extended it (so "reached 3" is a 3 in the list);
 * `now` is the run still standing after his latest game of that kind.
 */
function runLengths(games) {
  const runs = {}, again = {}, cur = {}, curA = {}, hits = [];
  for (const g of games) {
    if (g.l.min >= RUN_MIN) for (const r of RUNS) { if (r.test(g.l, g.x)) { cur[r.id] = (cur[r.id] || 0) + 1; (runs[r.id] ??= []).push(cur[r.id]); } else cur[r.id] = 0; }
    if (g.l.min > 0) {
      const ks = matchLine(g.l, g.x).map((h) => h.key).filter((k) => !NOT_AGAIN.has(k)); hits.push(ks);
      for (const k of Object.keys(curA)) if (!ks.includes(k)) curA[k] = 0;
      for (const k of ks) { curA[k] = (curA[k] || 0) + 1; (again[k] ??= []).push(curA[k]); }
    } else hits.push([]);
  }
  const live = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v > 0));
  return { runs, again, now: { runs: live(cur), again: live(curA) }, hits };
}

const nthWord = (n) => ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh"][n] || ord(n);
const times = (n) => (n === 0 ? "has not happened" : n === 1 ? "has happened once" : `has happened ${n} times`);

/**
 * Tonight's watch lists for the players on tonight's teams.
 *   rows, history, names, pos, IX as in oddNights · players: src/data/odd-lines-players.json (each player's counts over the
 *   last seasons) · teams: Set of tonight's teams · vs: { TRI: "vs BOS" | "@ BOS" } · teamNow: (id, lastTeam) => his team today
 * -> { runs: [{ id, name, team, vs, kind: "run" | "again", key, length, next, n, grade, rate, d, text }],
 *      owners: [{ id, name, team, vs, key, f, what, n, season, games, league, last, grade, rate, text }] }
 * runs: he is `length` games into something; `next` more would be the (length+1)th, which has happened `n` times on file.
 * owners: he has done this `n` times since the players' table starts (at least OWN.min), `season` of them this season.
 */
const OWN = { min: 2 };
function oddWatch({ rows = [], history = null, players = null, names = {}, pos = {}, teams = new Set(), vs = {}, teamNow = (id, t) => t, IX }) {
  const played = [...rows].filter((g) => g.pl && /^\d{4}-\d\d-\d\d$/.test(g.d || "")).sort((a, b) => a.d.localeCompare(b.d));
  const sum = {}, seq = {}, lastTeam = {};
  for (const g of played) for (const [id, v, l] of linesOf(g, IX)) {
    lastTeam[id] = v[IX.side] === 0 ? g.h : g.a; (seq[id] ??= []).push({ l, d: g.d });
    if (l.min > 0) { const s = (sum[id] ??= { n: 0, pts: 0, reb: 0, ast: 0 }); s.n++; s.pts += l.pts; s.reb += l.reb; s.ast += l.ast; }
  }
  const H = history?.t || {}, since = history?.from || "1993-94", out = { runs: [], owners: [] };
  const leagueSeason = {}, mine = {};
  for (const [id, gs] of Object.entries(seq)) {
    const s = sum[id];
    for (const g of gs) { const me = g.l.min > 0 ? 1 : 0, n = (s?.n || 0) - me; g.x = { pos: posGroup(pos[id]), avg: n >= ODD.games ? { pts: (s.pts - me * g.l.pts) / n, reb: (s.reb - me * g.l.reb) / n, ast: (s.ast - me * g.l.ast) / n } : null }; }
    const R = runLengths(gs), cnt = {}, lastD = {};
    R.hits.forEach((ks, i) => { for (const k of ks) { cnt[k] = (cnt[k] || 0) + 1; lastD[k] = gs[i].d; leagueSeason[k] = (leagueSeason[k] || 0) + 1; } });
    mine[id] = { R, cnt, lastD, gp: s?.n || 0, gs };
  }
  const lastOf = (e) => (e?.last ? ` (last: ${e.last[0]}, ${md(e.last[1])})` : "");
  for (const [id, m] of Object.entries(mine)) {
    const team = teamNow(id, lastTeam[id]); if (!teams.has(team)) continue;
    const name = names[id] || id, base = { id, name, team, vs: vs[team] || "" };
    // runs he is in
    for (const r of RUNS) {
      const k = m.R.now.runs[r.id] || 0; if (!k || k >= RUN_MAX) continue;
      const e = history?.runs?.[r.id]?.[k + 1] || null, n = e?.n || 0, rate = e ? Math.round((e.l5 / ODD.recent) * 10) / 10 : 0;
      const lastG = [...m.gs].reverse().find((g) => g.l.min >= RUN_MIN);
      out.runs.push({ ...base, kind: "run", key: r.id, length: k, n, rate, grade: history?.runs ? gradeOf(rate) : null, d: lastG?.d || null,
        text: `${name} ${k === 1 ? "was" : "has been"} ${r.say} in ${k === 1 ? "his last game" : `${k} straight games`} of ${RUN_MIN}+ minutes (${lastG.l.pts} points on ${lastG.l.fgm}-for-${lastG.l.fga} on ${md(lastG.d)}${lastG.x.avg ? `; averages ${r1(lastG.x.avg.pts)}` : ""}). A ${nthWord(k + 1)} straight for ${r.what} ${times(n)} on file since ${since}${lastOf(e)}.` });
    }
    // the same odd line again: the rarest level of each template that his latest game passed
    const best = {};
    for (const [key, k] of Object.entries(m.R.now.again)) {
      const [tid] = key.split("."), hist = H[key] || null, cand = { key, k, rate: rateOf(hist), before: hist?.n || 0, grade: hist ? "x" : null };
      if (!best[tid] || rarer(cand, best[tid])) best[tid] = cand;
    }
    const latest = [...m.gs].reverse().find((g) => g.l.min > 0);
    for (const c of Object.values(best)) {
      if (c.k >= RUN_MAX) continue;
      const e = history?.again?.[c.key]?.[c.k + 1] || null, n = e?.n || 0, rate = e ? Math.round((e.l5 / ODD.recent) * 10) / 10 : 0;
      const hit = matchLine(latest.l, latest.x).find((h) => h.key === c.key);
      out.runs.push({ ...base, kind: "again", key: c.key, length: c.k, n, rate, grade: history?.again ? gradeOf(rate) : null, d: latest.d,
        text: `${name}: ${hit.say} on ${md(latest.d)}${c.k > 1 ? `, his ${nthWord(c.k)} straight game with ${H[c.key]?.what || hit.what}` : ""}. ${hit.what[0].toUpperCase()}${hit.what.slice(1)} in ${c.k + 1} straight games ${times(n)} on file since ${since}${lastOf(e)}.` });
    }
    // what he tends to do: his count since the players' table starts, plus this season
    const P = players?.p?.[id] || null, ownBest = {};
    for (const key of new Set([...Object.keys(P?.k || {}), ...Object.keys(m.cnt)])) {
      const past = P?.k?.[key]?.[0] || 0, now = m.cnt[key] || 0, n = past + now; if (n < OWN.min) continue;
      const [tid] = key.split("."), hist = H[key] || null, cand = { key, n, now, rate: rateOf(hist), before: hist?.n || 0, grade: hist ? "x" : null };
      if (!ownBest[tid] || rarer(cand, ownBest[tid])) ownBest[tid] = cand;
    }
    for (const c of Object.values(ownBest)) {
      const hist = H[c.key], league = (players?.league?.[c.key] || 0) + (leagueSeason[c.key] || 0), games = (P?.g || 0) + m.gp;
      const last = [P?.k?.[c.key]?.[1], m.lastD[c.key]].filter(Boolean).sort().pop() || null, rate = Math.round(c.rate * 10) / 10;
      out.owners.push({ ...base, key: c.key, f: TEMPLATES.find((t) => t.id === c.key.split(".")[0])?.f, what: hist?.what || c.key, n: c.n, season: c.now, games, league, last, rate, grade: hist ? gradeOf(c.rate) : null,
        text: `${name}: ${hist?.what || c.key}, ${c.n === 2 ? "twice" : `${c.n} times`} in ${games} games since ${players?.since || "this season began"}${c.now ? ` (${c.now} this season)` : ""}${league ? `; the league has ${league}` : ""}${last ? `. Last: ${md(last)}` : ""}.` });
    }
  }
  const gi = (g) => GRADES.indexOf(g ?? "common");
  out.runs.sort((a, b) => gi(a.grade) - gi(b.grade) || a.rate - b.rate || a.n - b.n || b.length - a.length || a.name.localeCompare(b.name));
  out.owners.sort((a, b) => gi(a.grade) - gi(b.grade) || (b.league ? b.n / b.league : 0) - (a.league ? a.n / a.league : 0) || b.n - a.n || a.name.localeCompare(b.name));
  return out;
}

/* ---------------------------------------------------------------------------------------------------------------
 * 0.119.0: live, for the NBA Live bridge (the user, 11/19 2:48 PM: "the depending on zero is a good one to flag in the
 * final five minutes… if it doesn't ping until the end of the game, it could get lost if it's immediately deactivated.
 * The others seem fine to me").
 *
 * GROW: a line that, once true, stays true however long he plays (every condition is "at least N" of something that
 * only goes up; a player who has fouled out is finished). It can be said the moment it happens.
 * LATE: a line that one more basket, free throw, rebound or minute can undo (it rests on a zero, a ratio, an exact
 * number, a low total, or few minutes). It is said in the final five minutes while it stands, and at the final.
 * Every template is in exactly one list (tested), and no line that only grows can undo a GROW template (tested).
 * This file has no imports: the bridge reads its published copy as text.
 * ------------------------------------------------------------------------------------------------------------- */
const GROW = ["fta", "ftmiss", "greb", "cast", "gblk", "c3", "reb3x", "ast3x", "foulout", "tov", "x5", "pair", "bench", "erupt"];
const LATE = ["noft", "ftshare", "nofg", "all3", "ofg", "o3", "brick", "perfg", "perft", "empty", "ast0", "reb0", "min0", "noshot", "noshotbig", "tov0", "pts0reb", "blk0reb", "nothing", "quick", "zeromin", "ones", "lowpts", "dud"];
const LATE_SECS = 300;
const liveKind = (id) => (GROW.includes(id) ? "grow" : "late");

/**
 * For one live line: one hit a template (the rarest level it passes), with how rare the class is.
 *   table: docs/data/oddlive.json's `t`: { "id.k": [times before today, per season lately, last name, last date] }
 * -> [{ id, key, f, live: "grow" | "late", what, say, grade, rate, before, last, note }], rarest first.
 */
function liveHits(l, x, table, from = "1993-94") {
  const best = {};
  for (const h of matchLine(l, x)) {
    const e = table?.[h.key] || null, cand = { ...h, rate: e ? e[1] : 0, before: e ? e[0] : 0, grade: e ? gradeOf(e[1]) : null, last: e && e[2] ? [e[2], e[3]] : null };
    if (!best[h.id] || rarer(cand, best[h.id])) best[h.id] = cand;
  }
  return Object.values(best).map((h) => ({ ...h, live: liveKind(h.id), note: note(h, { from }) }))
    .sort((a, b) => GRADES.indexOf(a.grade ?? "common") - GRADES.indexOf(b.grade ?? "common") || a.rate - b.rate || a.before - b.before);
}
    return { ODD, GRADES, FAMILY, TEMPLATES, TOV_PF, NO_TOV_PF, LATE_NAMES, posGroup, matchLine, rateOf, gradeOf, STARTERS, oddNights, note, sentence, RUN_MIN, RUN_MAX, RUNS, runLengths, OWN, oddWatch, GROW, LATE, LATE_SECS, liveKind, liveHits };
  })();
  var RARE_RULES = (function () {
/**
 * Rare combinations (0.141.17; the user, 11/21: "I'm more concerned about flagging this stuff in real time in the nba live
 * app", "should warn ahead of time", "five or fewer"). A player's line that, in every column of a combination, has been
 * matched or beaten in 4 or fewer regular-season games since 1993-94, so tonight's would be one of five or fewer: Victor
 * Wembanyama's 52 points and 24 rebounds (no one else), Nikola Jokić's 56-16-15.
 *
 * No imports: the NBA Live bridge reads this file as text (docs/lib/situations/linerare.js, a copy the build keeps) and
 * the build imports it (scripts/situations.js → docs/data/linerare.json). One set of rules for both.
 *
 * The published file holds, per combination, a boundary and a short list:
 *   zmin[x][y]  the smallest value of the third stat at which 4 or fewer games since 1993-94 are at least (x, y, z) in
 *               all three. The count only falls as z rises, so "4 or fewer" is z >= zmin[x][y]. (Few shots: per points
 *               total, the most shots at which 4 or fewer games had at least those points on at most those shots.)
 *   games       every game whose own count is 5 or fewer. Any game at least as big as tonight's line in every column
 *               has a count no bigger than tonight's, so when tonight's is 4 or fewer every such game is on this list:
 *               counting the list gives the exact number, and names them.
 */
const RARE_MAX = 4;   // games before tonight: tonight's would be the 5th or fewer
const COMBOS = [
  { id: "pra", keys: ["pts", "reb", "ast"], caps: [100, 40, 30] },
  { id: "p3a", keys: ["pts", "fg3m", "ast"], caps: [100, 16, 30] },
  { id: "rbp", keys: ["reb", "blk", "pts"], caps: [40, 15, 100] },
  { id: "sbp", keys: ["stl", "blk", "pts"], caps: [12, 15, 100] },
  { id: "asp", keys: ["ast", "stl", "pts"], caps: [30, 12, 100] },
];
const FEW = { id: "few", minPts: 30, capPts: 100, capFga: 60 };   // points on few shots: can be undone by a miss
const WORD = { pts: ["point", "points"], reb: ["rebound", "rebounds"], ast: ["assist", "assists"], fg3m: ["three", "threes"], stl: ["steal", "steals"], blk: ["block", "blocks"] };
const ORDER = ["pts", "reb", "ast", "fg3m", "stl", "blk"];
const STEP = { pts: 5, reb: 2, ast: 2, fg3m: 1, stl: 1, blk: 1 };   // how close counts as "on the verge"
// A stat counts toward a combination only when it is notable on its own: "50 points, 23 rebounds and 1 block" is rare only
// because of the 1 block, which no one would say. Below these it is left out (set to 0) before anything is counted.
const NOTABLE = { pts: 20, reb: 10, ast: 10, fg3m: 5, stl: 4, blk: 4 };
function notable(keys, l) { const t = Object.assign({}, l); for (const k of keys) if ((Number(t[k]) || 0) < (NOTABLE[k] || 0)) t[k] = 0; return t; }

// ---------- build side ----------
/** Histogram of lines: Map key "x,y,z" -> count, capped. */
function cell(r, c) { return c.keys.map((k, i) => Math.min(c.caps[i], Math.max(0, Math.floor(Number(r[k]) || 0)))); }
/**
 * hist: { pra: [[x,y,z,n],…], …, few: [[pts,fga,n],…] } (the archive's counts), rows: this season's player lines
 * ({ pts, reb, ast, fg3m, stl, blk, fga }), top: { pra: [[x,y,z,name,team,date],…], … } (the archive's games whose own
 * count is small), season: the same for this season's rows (name, team, date, gid on each). -> the published object.
 */
function buildRare({ hist, top, rows, from = "1993-94", before = null }) {
  const out = { v: 1, from, before, max: RARE_MAX, combos: {}, few: null };
  for (const c of COMBOS) {
    const [A, B, C] = c.caps, ix = (x, y, z) => (x * (B + 1) + y) * (C + 1) + z, G = new Int32Array((A + 1) * (B + 1) * (C + 1));
    for (const [x, y, z, n] of hist[c.id] || []) G[ix(x, y, z)] += n;
    for (const r of rows) { const [x, y, z] = cell(r, c); G[ix(x, y, z)]++; }
    for (let x = A; x >= 0; x--) for (let y = B; y >= 0; y--) for (let z = C; z >= 0; z--) {
      let v = G[ix(x, y, z)];
      if (x < A) v += G[ix(x + 1, y, z)]; if (y < B) v += G[ix(x, y + 1, z)]; if (z < C) v += G[ix(x, y, z + 1)];
      if (x < A && y < B) v -= G[ix(x + 1, y + 1, z)]; if (x < A && z < C) v -= G[ix(x + 1, y, z + 1)]; if (y < B && z < C) v -= G[ix(x, y + 1, z + 1)];
      if (x < A && y < B && z < C) v += G[ix(x + 1, y + 1, z + 1)];
      G[ix(x, y, z)] = v;
    }
    const zmin = [];
    for (let x = 0; x <= A; x++) { const row = []; for (let y = 0; y <= B; y++) { let z = 0; while (z <= C && G[ix(x, y, z)] > RARE_MAX) z++; row.push(z); } zmin.push(row); }
    const count = (x, y, z) => G[ix(x, y, z)];
    const games = [];
    for (const g of top[c.id] || []) if (count(g[0], g[1], g[2]) <= RARE_MAX + 1) games.push(g);
    for (const r of rows) { const [x, y, z] = cell(r, c); if (count(x, y, z) <= RARE_MAX + 1) games.push([x, y, z, r.name, r.team, r.d, r.gid || null]); }
    out.combos[c.id] = { keys: c.keys, caps: c.caps, zmin, games };
  }
  // Few shots: count(points >= p, shots <= f)
  {
    const P = FEW.capPts, F = FEW.capFga, H = new Int32Array((P + 1) * (F + 1)), ix = (p, f) => p * (F + 1) + f;
    for (const [p, f, n] of hist.few || []) H[ix(p, f)] += n;
    for (const r of rows) H[ix(Math.min(P, r.pts | 0), Math.min(F, r.fga | 0))]++;
    for (let p = P; p >= 0; p--) for (let f = 0; f <= F; f++) { let v = H[ix(p, f)]; if (p < P) v += H[ix(p + 1, f)]; if (f > 0) v += H[ix(p, f - 1)]; if (p < P && f > 0) v -= H[ix(p + 1, f - 1)]; H[ix(p, f)] = v; }
    const fmax = [];
    for (let p = 0; p <= P; p++) { let f = -1; if (p >= FEW.minPts) while (f + 1 <= F && H[ix(p, f + 1)] <= RARE_MAX) f++; fmax.push(f); }
    const games = [];
    for (const g of top.few || []) if (H[ix(g[0], g[1])] <= RARE_MAX + 1) games.push(g);
    for (const r of rows) { const p = Math.min(P, r.pts | 0), f = Math.min(F, r.fga | 0); if (p >= FEW.minPts && H[ix(p, f)] <= RARE_MAX + 1) games.push([p, f, r.name, r.team, r.d, r.gid || null]); }
    out.few = { fmax, games };
  }
  return out;
}

// ---------- live side (the bridge) ----------
function cap(v, c) { return Math.min(c, Math.max(0, Math.floor(Number(v) || 0))); }
/** Games before tonight at least (x, y, z), or null when more than RARE_MAX. exclude: tonight's game id, if a build already has it. */
function pastCount(data, id, vals, exclude) {
  const c = data && data.combos && data.combos[id];
  if (!c) return null;
  const v = c.keys.map((k, i) => cap(vals[k], c.caps[i]));
  if (v[2] < c.zmin[v[0]][v[1]]) return null;
  const who = c.games.filter((g) => g[0] >= v[0] && g[1] >= v[1] && g[2] >= v[2] && !(exclude && g[6] && String(g[6]) === String(exclude)));
  return who.length <= RARE_MAX ? who : null;
}
function fewCount(data, pts, fga, exclude) {
  const F = data && data.few;
  if (!F) return null;
  const p = cap(pts, FEW.capPts), f = cap(fga, FEW.capFga);
  if (p < FEW.minPts || f > F.fmax[p]) return null;
  const who = F.games.filter((g) => g[0] >= p && g[1] <= f && !(exclude && g[5] && String(g[5]) === String(exclude)));
  return who.length <= RARE_MAX ? who : null;
}
const n2 = (k, v) => `${v} ${WORD[k][v === 1 ? 0 : 1]}`;
function phrase(keys, l) {
  const ks = ORDER.filter((k) => keys.includes(k)), parts = ks.map((k) => n2(k, l[k]));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
}
/** The stats of a combination that matter: one whose removal (set to 0) leaves the count the same is left out. */
function needed(data, c, l, n, exclude) {
  let keys = c.keys.slice();
  for (const k of c.keys) {
    if (keys.length <= 1) break;
    const t = Object.assign({}, l); for (const o of c.keys) if (!keys.includes(o) || o === k) t[o] = 0;
    const w = pastCount(data, c.id || COMBO_ID(c), t, exclude);
    if (w && w.length === n) keys = keys.filter((x) => x !== k);
  }
  return keys;
}
const COMBO_ID = (c) => COMBOS.find((x) => x.keys.join() === c.keys.join()).id;
const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
const mdY = (d) => { const [y, m, dd] = String(d).split("-"); return `${+m}/${+dd}/${String(y).slice(2)}`; };
const who = (g, i) => `${g[i]} ${mdY(g[i + 2])}`;
/**
 * A live line -> { hits: [...], warn: [...] }. hit: { id, keys, say, n (games before tonight), before: [names], live: "grow" | "late" }.
 * warn: { id, stat, more, say } — a step of STEP[stat] or less would make a growing line a hit.
 */
function liveRare(data, l, { exclude = null } = {}) {
  const hits = [], warn = [];
  if (!data || !data.combos) return { hits, warn };
  for (const c0 of COMBOS) {
    const c = Object.assign({ id: c0.id }, data.combos[c0.id] || {});
    if (!c.zmin) continue;
    const ln = notable(c0.keys, l);
    if (c0.keys.filter((k) => ln[k] > 0).length < 2 && !c0.keys.some((k) => (Number(l[k]) || 0) + (STEP[k] || 0) >= NOTABLE[k] && !(ln[k] > 0))) continue;
    const w = c0.keys.filter((k) => ln[k] > 0).length >= 2 ? pastCount(data, c0.id, ln, exclude) : null;
    if (w) {
      const keys = needed(data, c, ln, w.length, exclude);
      hits.push({ id: c0.id, keys, n: w.length, live: "grow", line: phrase(keys, ln),
        before: w.slice().sort((a, b) => String(b[5]).localeCompare(String(a[5]))).map((g) => who(g, 3)) });
      continue;
    }
    for (const k of c0.keys) {
      for (let d = 1; d <= (STEP[k] || 0); d++) {
        const t = notable(c0.keys, Object.assign({}, l, { [k]: (Number(l[k]) || 0) + d }));
        if (c0.keys.filter((x) => t[x] > 0).length < 2) continue;
        const w2 = pastCount(data, c0.id, t, exclude);
        if (w2) { const keys = needed(data, c, t, w2.length, exclude); warn.push({ id: c0.id, stat: k, more: d, n: w2.length, keys, line: phrase(keys, t) }); break; }
      }
    }
  }
  // Points on few shots, unless the points alone are that rare (then it's a single-game list's card, not this one).
  const f = fewCount(data, l.pts, l.fga, exclude);
  if (f && !fewCount(data, l.pts, FEW.capFga, exclude)) hits.push({ id: "few", keys: ["pts", "fga"], n: f.length, live: "late", line: `${l.pts} points on ${l.fga} shot${l.fga === 1 ? "" : "s"}`,
    before: f.slice().sort((a, b) => String(b[4]).localeCompare(String(a[4]))).map((g) => who(g, 2)) });
  // A combination, not one number: a line rare in one stat alone is the all-time single-game lists' card. One entry per wording.
  const seen = new Set();
  const ci = (id) => { const i = COMBOS.findIndex((c) => c.id === id); return i < 0 ? COMBOS.length : i; };
  const H = hits.filter((h) => h.keys.length >= 2).sort((a, b) => a.n - b.n || a.keys.length - b.keys.length || ci(a.id) - ci(b.id))
    .filter((h) => !seen.has(h.line) && seen.add(h.line));
  // Warnings only while nothing is a hit yet; the closest first.
  const seenW = new Set();
  const W = H.length ? [] : warn.filter((w) => w.keys.length >= 2).sort((a, b) => a.n - b.n || a.more - b.more).filter((w) => { const k = warnText(w); return !seenW.has(k) && seenW.add(k); });
  return { hits: H, warn: W };
}
function ordinal(n) { return ord(n); }
/** "no one else since 1993-94" / "the 3rd time since 1993-94". */
function countText(n, from = "1993-94") { return n === 0 ? `no one else has done that since ${from}` : `the ${ord(n + 1)} time since ${from}`; }
function warnText(w, from = "1993-94") {
  const more = `${w.more} more ${WORD[w.stat][w.more === 1 ? 0 : 1]}`;
  return `${more} would make it ${w.line}: ${w.n === 0 ? `no one has done that since ${from}` : `done ${w.n === 1 ? "once" : `${w.n} times`} since ${from}`}`;
}
    return { RARE_MAX, COMBOS, FEW, STEP, NOTABLE, buildRare, pastCount, fewCount, phrase, liveRare, ordinal, countText, warnText };
  })();
  var FEAT_RULES = (function () {
/**
 * Career feat boards and live streaks (0.142; pure, no imports: bundled into docs/bridge/cc-bridge.js as FEAT_RULES by
 * tools/bundle-bridge-rules.mjs, and used by the build for the site's lines). The user, 11/21: "proceed with your
 * suggestions" (combination-feat boards with an active player near the top; live streak cards from the game notes).
 *
 * A board: { label, one (one game: "30-10-5 game"), short, min: { stat: n }, max?: { stat: n }, td?: true, since?,
 * rows: [{ name, id?, now, live?, atLeast? }] }. Its counts are Basketball-Reference's career game-finder results as the
 * user sent them (all of NBA history, regular season) plus the qualifying games in our box scores since; or (since:
 * "1993-94", 0.142.1) our own box scores, where a count marked atLeast may be short and is never passed, tied or placed. A card only when a game moves a player on the board: passing or tying a
 * name, or adding to a record he holds. A board with a ceiling (single-digit points) can be undone by more scoring, so
 * it is said only late, "as it stands", like the rare lines.
 *
 * A streak: { tests: ["dd" | "td" | "start" | { k, min }], n } for a player, or a team streak (see teamStake).
 */
const FEAT_STEP = { pts: 5, reb: 2, ast: 2, fg3m: 1, stl: 1, blk: 1 };   // how close counts as "on the verge"
const FEAT_WORD = { pts: ["point", "points"], reb: ["rebound", "rebounds"], ast: ["assist", "assists"], fg3m: ["three", "threes"], stl: ["steal", "steals"], blk: ["block", "blocks"] };
const say = (k, n) => `${n} ${FEAT_WORD[k] ? FEAT_WORD[k][n === 1 ? 0 : 1] : k}`;
const featOrd = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const isTd = (l) => ["pts", "reb", "ast", "stl", "blk"].filter((k) => (Number(l[k]) || 0) >= 10).length >= 3;
const isDd = (l) => ["pts", "reb", "ast", "stl", "blk"].filter((k) => (Number(l[k]) || 0) >= 10).length >= 2;

/** Does a line meet the board? */
function qualifies(board, l) {
  for (const k in board.min || {}) if ((Number(l[k]) || 0) < board.min[k]) return false;
  for (const k in board.max || {}) if ((Number(l[k]) || 0) > board.max[k]) return false;
  return !board.td || isTd(l);
}

/** What a line still lacks: [[stat, more]], or null when it can't get there (a ceiling already passed). A triple-double
 *  board's missing third stat is the nearest of the others. */
function shortOf(board, l) {
  for (const k in board.max || {}) if ((Number(l[k]) || 0) > board.max[k]) return null;
  const out = [];
  for (const k in board.min || {}) { const m = board.min[k] - (Number(l[k]) || 0); if (m > 0) out.push([k, m]); }
  if (board.td && !isTd(Object.assign({}, l, Object.fromEntries(out.map(([k, m]) => [k, (Number(l[k]) || 0) + m]))))) {
    const t = Object.assign({}, l); for (const [k, m] of out) t[k] = (Number(t[k]) || 0) + m;
    const tens = ["pts", "reb", "ast", "stl", "blk"].map((k) => [k, 10 - (Number(t[k]) || 0)]).filter((x) => x[1] > 0).sort((a, b) => a[1] - b[1]);
    const have = 5 - tens.length;
    for (const x of tens.slice(0, Math.max(0, 3 - have))) out.push(x);
  }
  return out;
}

/** Where a count puts a player on a board (others only): his place, who he passes going from `before` to `after`, who he
 *  ties, the leader. Rows are { name, now }. */
// A count marked atLeast is taken to be up to this much short (the archive misses about 13% of games in its worst seasons,
// and these feats come once in dozens of games): a lead or a place is said only when that couldn't change it.
const LEAD_SLACK = 2;
function standing(rows, me, before, after) {
  const others = rows.filter((r) => r.name !== me);
  // A count marked atLeast (games missing from our box scores) may be higher: never passed or tied, and if it is at or
  // below his, his place isn't known.
  const sure = others.filter((r) => !r.atLeast), unsure = others.filter((r) => r.atLeast);
  const place = 1 + others.filter((r) => r.now > after).length;
  const placeKnown = !unsure.some((r) => r.now <= after && r.now + LEAD_SLACK >= after);
  const passed = sure.filter((r) => r.now >= before && r.now < after).sort((a, b) => b.now - a.now);
  const tied = sure.filter((r) => r.now === after);
  const top = others.reduce((a, r) => (!a || r.now > a.now ? r : a), null);
  const next = others.filter((r) => r.now > after).sort((a, b) => a.now - b.now)[0] || null;
  const clear = (n) => !unsure.some((r) => r.now + LEAD_SLACK >= n);
  return { place, placeKnown, passed, tied, top, next, leading: place === 1 && !tied.length && clear(after), wasLeading: !!top && before > top.now && clear(before) };
}

const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
// Two names said; past that, "Larry Bird, Jason Kidd and three others".
const names = (L) => (L.length === 1 ? L[0].name : L.length === 2 ? `${L[0].name} and ${L[1].name}`
  : L.length === 3 ? `${L[0].name}, ${L[1].name} and ${L[2].name}` : `${L[0].name}, ${L[1].name} and ${WORDS[L.length - 2] || L.length - 2} others`);

/** What a qualifying game does: null unless it moves him (passes or ties a name, or adds to a record he holds). */
function featMove(board, me, before) {
  const after = before + 1, s = standing(board.rows || [], me, before, after);
  if (!s.passed.length && !s.tied.length && !s.wasLeading) return null;
  // A board from our own box scores says "since 1993-94"; Basketball-Reference's boards are all of NBA history.
  const where = board.since ? `since ${board.since}` : "all-time", rec = board.since ? `the most since ${board.since}` : "the NBA record";
  const at = (p) => (p === 1 ? rec : s.placeKnown ? `${featOrd(p)} ${where}` : null);
  const nth = featOrd(after);
  let what;
  if (s.wasLeading) what = `adding to ${board.since ? `his lead since ${board.since}` : "his NBA record"}${s.top ? ` (${s.top.name} is next with ${s.top.now}${s.top.atLeast ? " or more" : ""})` : ""}`;
  else if (s.leading) what = `passing ${names(s.passed)} (${s.passed[0].now}) for ${rec}`;
  else if (s.tied.length && !s.passed.length) what = `tying ${names(s.tied)}${at(s.place) ? ` for ${at(s.place)}` : ""}`;
  else what = `passing ${names(s.passed)} (${s.passed[0].now})${s.tied.length ? `, level with ${names(s.tied)}` : ""}${at(s.place) ? ` for ${s.tied.length ? "a share of " : ""}${at(s.place)}` : ""}`;
  return { after, place: s.placeKnown ? s.place : null, record: s.place === 1 && s.placeKnown, passed: s.passed.map((r) => r.name), tied: s.tied.map((r) => r.name), top: s.top,
    what, text: `his ${nth} ${board.one || board.label}, ${what}`, s };
}

/** The pre-game line for a board player: what his next qualifying game would do, or null. */
function featNext(board, row) {
  const m = featMove(board, row.name, row.now);
  return m ? { ...m, line: `${row.name}: his next ${board.one || board.label} would be his ${featOrd(m.after)}, ${m.what}` } : null;
}

/** Live: a hit (qualifies now and moves him) or a warning (one stat short by a step or less, and getting there would move
 *  him). `before` is his count entering tonight. -> { hit } | { warn: { k, more } } | null */
function featLive(board, me, before, l) {
  if (qualifies(board, l)) { const m = featMove(board, me, before); return m ? { hit: m } : null; }
  const s = shortOf(board, l);
  if (!s || s.length !== 1 || s[0][1] > (FEAT_STEP[s[0][0]] || 0)) return null;
  if (board.max) return null;                         // a ceiling: only said once it stands
  const m = featMove(board, me, before);
  return m ? { warn: { k: s[0][0], more: s[0][1], move: m } } : null;
}
const featWarnText = (board, w) => `${say(w.k, w.more)} from ${w.move.text.replace(/^his /, "his ")}`;

// ---- streaks ----
/** Does a line meet a streak's tests? */
function streakMet(tests, l) {
  return (tests || []).every((x) => (x === "dd" ? isDd(l) : x === "td" ? isTd(l) : x === "start" ? !!l.starter : (Number(l[x.k]) || 0) >= x.min));
}
/** What a line still lacks for a streak's tests (stat tests only): [[stat, more]]. */
function streakShort(tests, l) {
  const out = [];
  for (const x of tests || []) {
    if (x && x.k) { const m = x.min - (Number(l[x.k]) || 0); if (m > 0) out.push([x.k, m]); }
    else if (x === "dd" || x === "td") {
      const need = x === "dd" ? 2 : 3, tens = ["pts", "reb", "ast", "stl", "blk"].map((k) => [k, 10 - (Number(l[k]) || 0)]).sort((a, b) => a[1] - b[1]);
      for (const t of tens.slice(0, need)) if (t[1] > 0) out.push(t);
    }
  }
  return out;
}
const shortText = (L) => L.map(([k, m]) => say(k, m)).join(" and ");

/** A team streak at stake tonight? kind winVs (wins vs one opponent, home games only if home), ptsVs (points vs one
 *  opponent), winHolding (wins when holding the opponent to `max` or fewer). -> { atStake, met, ended, inDanger } */
function teamStake(t, g) {
  const us = Number(g.us) || 0, them = Number(g.them) || 0;
  if ((t.kind === "winVs" || t.kind === "ptsVs") && (g.opp !== t.opp || (t.home && !g.home))) return { atStake: false };
  if (t.kind === "ptsVs") return { atStake: true, met: us >= t.min, ended: g.final && us < t.min, inDanger: !g.final && g.late && us < t.min };
  if (t.kind === "winVs") return { atStake: true, met: g.final && us > them, ended: g.final && us < them, inDanger: !g.final && g.late && us <= them };
  if (t.kind === "winHolding") {
    if (them > t.max) return { atStake: false, off: true };
    return { atStake: true, met: g.final && us > them, ended: g.final && us < them, inDanger: !g.final && g.late && us <= them };
  }
  return { atStake: false };
}
    return { FEAT_STEP, FEAT_WORD, featOrd, qualifies, shortOf, LEAD_SLACK, standing, featMove, featNext, featLive, featWarnText, streakMet, streakShort, shortText, teamStake };
  })();
  // ===== END BUNDLED RULES =====
  state.oddRules = ODD_RULES && typeof ODD_RULES.liveHits === "function" && typeof ODD_RULES.liveKind === "function" ? ODD_RULES : null;
  state.rareRules = RARE_RULES && typeof RARE_RULES.liveRare === "function" && typeof RARE_RULES.countText === "function" ? RARE_RULES : null;
  state.featRules = typeof FEAT_RULES !== "undefined" && FEAT_RULES && typeof FEAT_RULES.featLive === "function" && typeof FEAT_RULES.streakMet === "function" ? FEAT_RULES : null;

  function param(name) { try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; } }
  // v28 (NBA Live's security check, 11/21: "?cc=https://attacker.example/watch.json" ran outside code inside NBA Live):
  // ?cc= is taken only when it is "off", an https address under the Command Center site, or a relative .json path (a copy
  // beside NBA Live: no scheme, no leading slash or backslash, no "..", no colon). Anything else is refused, said in the
  // bridge's note, and the site's own address is used. The bridge also no longer downloads code (v28: the rules are below).
  var SITE = "https://campgambino.github.io/nba-command-center/";
  function safeAddress(v) {
    if (v == null || v === "") return DEFAULT_URL;
    v = String(v).trim();
    if (v === "off") return "off";
    var u = null;
    try { u = new URL(v); } catch (e) { u = null; }
    if (u) return u.protocol === "https:" && u.origin === "https://campgambino.github.io" && u.pathname.indexOf("/nba-command-center/") === 0 && !u.username && !u.password ? u.href : null;
    return /^[A-Za-z0-9_][A-Za-z0-9_.\-\/]*\.json(\?[A-Za-z0-9_=&.\-]*)?$/.test(v) && !/(^|\/)\.\.(\/|$)/.test(v) && v.indexOf("//") < 0 ? v : null;
  }
  var asked = param("cc"), url = safeAddress(asked);
  if (url === null) { state.refusedCc = String(asked).slice(0, 200); url = DEFAULT_URL; }
  if (url === "off") return;
  var tonightUrl = url.replace(/watch\.json(\?.*)?$/, "tonight.json");
  var recordsUrl = url.replace(/watch\.json(\?.*)?$/, "records.json");
  var flowUrl = url.replace(/watch\.json(\?.*)?$/, "flowstats.json");
  var teamMarksUrl = url.replace(/watch\.json(\?.*)?$/, "teammarks.json");
  var oddUrl = url.replace(/watch\.json(\?.*)?$/, "oddlive.json");
  // v27: rare combinations (linerare.json and the rules, the site's own module read as text, as the odd lines).
  var rareUrl = url.replace(/watch\.json(\?.*)?$/, "linerare.json");
  // v29: career feat boards and live streaks.
  var featUrl = url.replace(/watch\.json(\?.*)?$/, "featlive.json");
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

  // v12: is a newer bridge published than the one this page loaded? (The page keeps whatever it loaded.)
  var versionUrl = url === DEFAULT_URL ? url.replace(/data\/watch\.json(\?.*)?$/, "bridge/version.json") : url.replace(/watch\.json(\?.*)?$/, "version.json");
  function checkVersion() {
    fetch(versionUrl, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) { state.latest = v && typeof v.version === "number" ? v.version : null; if (state.latest > VERSION) status(); }).catch(function () { state.latest = null; });
  }
  function load() {
    checkVersion();
    // Tonight's storylines: optional; a missing file just means no pre-game cards.
    if (tonightUrl !== url) fetch(tonightUrl, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (t) { state.tonight = t && Array.isArray(t.games) ? t : null; }).catch(function (e) { state.tonight = null; state.tonightError = String(e && e.message || e); });
    // v3: career records (records.json) and the all-time single-game lists. Both optional.
    if (recordsUrl !== url) fetch(recordsUrl, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { state.records = d; state.recItems = d && Array.isArray(d.items) ? d.items.filter(function (i) { return i.id && (i.kind === "pass" || i.kind === "round" || i.kind === "franchise" || i.kind === "cup"); }) : []; })
      .catch(function (e) { state.records = null; state.recItems = []; state.recordsError = String(e && e.message || e); });
    if (bestsUrl !== url && !state.bests) fetch(bestsUrl, { cache: "force-cache" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { state.bests = d; }).catch(function (e) { state.bestsError = String(e && e.message || e); });
    // v24: each team's single-game team marks. Optional.
    if (teamMarksUrl !== url) fetch(teamMarksUrl, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { state.teamMarks = d && d.v === 1 && d.teams ? d : null; }).catch(function (e) { state.teamMarks = null; state.teamMarksError = String(e && e.message || e); });
    // v25: odd lines. The counts (oddlive.json) and the rules (the site's own module, read as text so nothing depends on
    // module loading from wherever NBA Live is opened). Both optional: without either, no odd-line cards.
    if (oddUrl !== url) fetch(oddUrl, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { state.odd = d && d.v === 1 && d.t ? d : null; }).catch(function (e) { state.odd = null; state.oddError = String(e && e.message || e); });
    // v27: rare combinations. Both optional: without either, no rare-combination cards.
    if (rareUrl !== url) fetch(rareUrl, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { state.rare = d && d.v === 1 && d.combos ? d : null; }).catch(function (e) { state.rare = null; state.rareError = String(e && e.message || e); });
    // v29: career feats and streaks. Optional: without it, no feat or streak cards.
    if (featUrl !== url) fetch(featUrl, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { state.feat = d && d.v === 1 && d.boards ? d : null; }).catch(function (e) { state.feat = null; state.featError = String(e && e.message || e); });
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
    // v14 (the user, 11/16): a standing fact ("leads the decade in points, rebounds…": bg) is for the Watch List, not a card here.
    g.lines.filter(function (l) { return !l.bg && !l.siteOnly && (l.kind !== "foul" || !state.flow); }).slice(0, PRE_PER_GAME).forEach(function (l, n) {
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
    if (state.refusedCc) return note("Command Center: ignored an outside ?cc= address (only the Command Center site or a file beside NBA Live) · using the site · v" + VERSION, true);
    if (state.latest > VERSION) return note("Command Center: a newer version is out (v" + state.latest + "; this page is running v" + VERSION + "). Refresh NBA Live to load it.", true);
    note("Command Center: " + state.items.length + " milestones" + (state.recItems.length ? " + " + state.recItems.length + " records" : "") + (d ? " for " + d : "") + (state.flow ? " · season facts: " + state.flow.games + " games" : state.flowError ? " · season facts not loaded" : "") + (state.fired ? " · " + state.fired + " cards" : "") + " · v" + VERSION);
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
    // "g30pt": a 30-point game; "g10ast": a game with 10+ assists (v13, for lists like "games with 10+ assists").
    var m = /^g(\d{1,2})(pt|reb|ast|stl|blk|fg3m)$/.exec(i.stat || "");
    if (m) { var gf = FIELD[m[2] === "pt" ? "pts" : m[2]]; return gf ? ((Number(p[gf]) || 0) >= Number(m[1]) ? 1 : 0) : null; }
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
              type: "streak", icon: "🧮 COUNT CHECK",
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
        if (i.kind !== "pass" && i.importance < MIN_IMPORTANCE && !(MAJOR[i.stat] && i.importance >= STAR_IMPORTANCE && bigName(i.player))) return;   // a rung nobody celebrates, reached or not
        if (i.kind === "pass" && (i.minor || i.siteOnly || !worthPlace(i.scope, i.stat, i.passing && i.passing.rank))) return;   // 0.61: a place worth saying (0.64: i.minor also covers lists of unproven scope; v29: siteOnly, points 51st-100th)
        if (game.status === "final" && !reachedTonight && was === null) return;   // a final game: only what fell in it
        if (!reachedTonight && was === null) {
          if ((p.min || 0) < 1) return;                                  // not a story until he plays
          if ((i.pTonight || 0) < MIN_CHANCE) return;                    // not in play tonight
          // v18 (the user, 11/16, on "11 points from 5,000 points career" in the 1st quarter: "we wait until the player is
          // closer to the mark… i'll make exceptions for big milestones, but this is pretty run of the mill"): a mark below
          // BIG_IMPORTANCE gets its card only inside NBA Live's own reach for that stat (its MILESTONE_LADDERS).
          if (i.importance < BIG_IMPORTANCE && (i.need - v) > reachOf(i.stat)) return;
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
      try { teamMarkChecks(game, sides, box, tag, scr); } catch (e) { state.teamMarkError = String(e && e.message || e); }
      try { oddLineChecks(game, sides, box, tag, scr); } catch (e) { state.oddCheckError = String(e && e.message || e); }
      try { rareChecks(game, sides, box, tag, scr); } catch (e) { state.rareCheckError = String(e && e.message || e); }
      try { featChecks(game, sides, box, tag, scr); } catch (e) { state.featCheckError = String(e && e.message || e); }
      try { streakChecks(game, sides, box, tag, scr); } catch (e) { state.streakCheckError = String(e && e.message || e); }
      try { arenaChecks(game, sides, box, tag, scr); } catch (e) { state.arenaError = String(e && e.message || e); }
      try { lastTimeChecks(game, sides, box, tag, scr); } catch (e) { state.lastTimeError = String(e && e.message || e); }
      try { zeroChecks(game, sides, box, tag, scr); } catch (e) { state.zeroError = String(e && e.message || e); }
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
      if (i.siteOnly) return false;   // v29: a notes line that never gets a card here doesn't hold back the records one (a tier entry)
      return String(i.espnId) === String(r.id) && i.stat === r.stat && (i.target === r.target || i.target === r.target - 1
        || (i.passing && r.passing && String(r.passing.name).split(" and ").some(function (n) { return surname(n) === surname(i.passing.player); })));
    });
  }
  /* 0.61 (the user, 11/13: "consider player, team, new placement, and stat… scale back"): a pass gets a card only for a
     place worth saying. NBA Cup: top 2. Franchise: top 3 in points, rebounds, assists, steals, blocks, threes; top 2 in
     anything else. All-time: top 25 in those six, top 10 in anything else. Round numbers are left to the cadence. */
  var MAJOR = { pts: 1, reb: 1, ast: 1, stl: 1, blk: 1, fg3m: 1 };
  // v11: the night's big names (tonight.json `stars`, from the prep stats' prominence). No list: no exceptions.
  function bigName(name) { var S = state.tonight && state.tonight.stars; return !!(S && S[name] != null); }
  /* v29 (the user, 11/21): all-time points get a card for a place in the top 50, and for entering the top 100, 75, 50 or 25
     from below (tierOf); 51st-100th otherwise is a site line only. src/records/notable.js has the same rule. */
  function worthPlace(scope, stat, place) {
    if (!place) return true;
    var major = !!MAJOR[stat];
    if (scope === "cup") return place <= 2;
    if (scope === "franchise") return place <= (major ? 3 : 2);
    if (scope === "nba") return place <= (stat === "pts" ? 50 : major ? 25 : 10);
    return true;
  }
  var PTS_TIERS = [25, 50, 75, 100];
  function tierOf(scope, stat, before, after) {
    if (scope !== "nba" || stat !== "pts" || !after) return null;
    var b = before || Infinity;
    for (var k = 0; k < PTS_TIERS.length; k++) if (after <= PTS_TIERS[k] && b > PTS_TIERS[k]) return PTS_TIERS[k];
    return null;
  }
  var escH = function (x) { return String(x == null ? "" : x).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  // The card's back (tap to flip): the list's top 5 with him at tonight's total, and his place if lower.
  function boardBack(title, rows, who, total) {
    if (!Array.isArray(rows) || !rows.length) return null;
    var me = surname(who);
    var L = rows.filter(function (r) { return !(surname(r.name) === me && String(r.name).split(" ")[0] === String(who).split(" ")[0]); })
      .map(function (r) { return { name: r.name, v: Number(r.now != null ? r.now : r.value) || 0, al: !!r.atLeast }; });
    L.push({ name: who, v: total, me: true });
    L.sort(function (a, b) { return b.v - a.v || (a.me ? -1 : 0); });
    var mine = L.findIndex(function (r) { return r.me; });
    var place = function (k) { return L.filter(function (r) { return r.v > L[k].v; }).length + 1; };
    var line = function (k) { var r = L[k]; return '<div class="alert-back-play"' + (r.me ? ' style="font-weight:700"' : "") + '><span class="abp-time">' + place(k) + ".</span> " + escH(r.name) + " · <strong>" + r.v.toLocaleString() + (r.al ? "+" : "") + "</strong></div>"; };   // v29.1: "8+" = at least (games missing from our box scores)
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
      if (r.kind === "round" && !MAJOR[r.stat] && !(r.club && r.club <= SMALL_CLUB)) return;   // v11: 7,000 defensive rebounds (32 players) isn't a card
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
      else if ((!SCOPE_OF[x.r.kind] || worthPlace(SCOPE_OF[x.r.kind], x.r.stat, x.r.rank) || x.r.tier) && (!G0.next || x.r.need < G0.next.r.need)) G0.next = x;
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
    }).filter(function (x) { return x && (x.live || !SCOPE_OF[x.r.kind] || worthPlace(SCOPE_OF[x.r.kind], x.r.stat, x.r.rank) || x.r.tier); });   // judged by the place he ends on
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
          icon: undone ? "↩️ TAKEN BACK" : x.reached ? (x.place === 1 ? "🏆 RECORD" : x.tier ? "🎉 TOP " + x.tier : "🎉 " + (r.kind === "cup" ? "CUP HISTORY" : r.kind === "franchise" ? "FRANCHISE HISTORY" : "PASSED")) : "📈 " + x.need + " TO GO",
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
    var prePlace = 1 + rows.filter(function (x) { return x.pre > pre; }).length;   // v29: his place this morning, for a tier entry
    var passed = rows.filter(function (x) { return x.pre >= pre && x.now < mine; }).sort(function (a, b) { return a.now - b.now; });
    var tail = r.kind === "cup" ? (place === 1 ? "the NBA Cup record" : ord(place) + " in NBA Cup history")
      : r.kind === "franchise" ? (function () { var h = (String(r.text).match(/in ([A-Z][\w.' ]+? history)/) || [])[1] || r.team + " history"; return place === 1 ? "the most in " + h : ord(place) + " in " + h; })()
      : (place === 1 ? "the most all-time" : ord(place) + " all-time");
    var scope = SCOPE_OF[r.kind];
    if (passed.length) {
      var tier = tierOf(scope, r.stat, prePlace, place);
      if (!worthPlace(scope, r.stat, place) && !tier) return null;
      var names = passed.map(function (x) { return x.name; });
      var who2 = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
      return { r: r, v: v, live: true, reached: true, rank: 1e9, place: place, rows: rows, tier: tier,
        text: r.who + " (" + r.team + ") — passes " + who2 + " (" + passed[passed.length - 1].now.toLocaleString() + ") for " + tail + (tier ? ", into the top " + tier : "") + " · " + mine.toLocaleString() + " " + (r.label || r.stat) };
    }
    // Not yet: the next name above him, live.
    var ahead = rows.filter(function (x) { return x.now >= mine; }).sort(function (a, b) { return a.now - b.now; })[0];
    if (!ahead) return null;
    var need = ahead.now - mine + 1, placeAfter = 1 + rows.filter(function (x) { return x.now > ahead.now; }).length;
    var tierAfter = tierOf(scope, r.stat, prePlace, placeAfter);
    if (!worthPlace(scope, r.stat, placeAfter) && !tierAfter) return null;
    var tail2 = r.kind === "cup" ? (placeAfter === 1 ? "the NBA Cup record" : ord(placeAfter) + " in NBA Cup history")
      : r.kind === "franchise" ? (function () { var h = (String(r.text).match(/in ([A-Z][\w.' ]+? history)/) || [])[1] || r.team + " history"; return placeAfter === 1 ? "the most in " + h : ord(placeAfter) + " in " + h; })()
      : (placeAfter === 1 ? "the most all-time" : ord(placeAfter) + " all-time");
    return { r: r, v: v, live: true, reached: false, need: need, rank: rank, place: place, rows: rows,
      text: r.who + " (" + r.team + ") — " + need + " " + plural(need, r.label || r.stat) + " from passing " + ahead.name + " (" + ahead.now.toLocaleString() + (ahead.tonight ? ", " + ahead.tonight + " tonight" : "") + ") for " + tail2 + (tierAfter ? ", into the top " + tierAfter : "") };
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

  // ---- v18: still at zero late (tonight.json `zeros`: players who have never finished a game without a point, a
  // rebound or an assist, where that stat is theirs). The user, 11/16, on Trae Young's first scoreless game in 512:
  // "this is something worth incorporating". A card from the start of the 4th quarter once he has played ZERO_MIN
  // minutes; it goes when he gets one, and says so at the final if he never did.
  var ZERO_MIN = 15;
  var ZERO_SAY = { pts: ["points", "SCORELESS", "been held scoreless"], reb: ["rebounds", "NO REBOUNDS", "finished without a rebound"], ast: ["assists", "NO ASSISTS", "finished without an assist"] };
  function zeroChecks(game, sides, box, tag, scr) {
    var T = state.tonight, Z = T && T.zeros;
    if (!Z) return;
    var per = Number(game.period) || 0, live = game.status === "live", fin = game.status === "final";
    ["away", "home"].forEach(function (side) {
      var team = side === "away" ? sides.away : sides.home;
      (box[side] || []).forEach(function (p) {
        var W = p && Z[p.id];
        if (!W) return;
        (W.stats || []).forEach(function (k) {
          var key = "cc-zero-" + game.id + "-" + p.id + "-" + k, v = Number(p[LIST_FIELD[k]]) || 0, say = ZERO_SAY[k];
          if (!say) return;
          if (v > 0) { if (state.keys[key]) dropCard(key); return; }
          if (!((live && per >= 4) || fin) || (p.min || 0) < ZERO_MIN) return;
          var span = W.full ? "in " + Number(W.games).toLocaleString() + " career games" : "in " + Number(W.games).toLocaleString() + " games since 2016-17";
          var shot = k === "pts" ? " (" + (p.fgm || 0) + "-" + (p.fga || 0) + " FG)" : "";
          fire(key, {
            type: "milestone", icon: fin ? "😶 FIRST " + (k === "pts" ? "SCORELESS GAME" : "GAME WITH " + say[1]) : "😶 " + (k === "pts" ? "STILL SCORELESS" : say[1] + " YET"),
            text: (p.name || ("#" + p.id)) + " (" + team + ") — " + (fin ? "0 " + say[0] + shot + " in " + Math.round(p.min || 0) + " minutes: the first time he has " + say[2] + " " + span
              : "0 " + say[0] + shot + " through " + Math.round(p.min || 0) + " minutes · he has never " + say[2] + " " + span),
            statLine: typeof fmtAlertStatLine === "function" ? fmtAlertStatLine([[0, say[0].toUpperCase()], [Math.round(p.min || 0), "MIN"]]) : "",
            sub: "Command Center · the NBA Guide's career games and ESPN's game logs" + (W.full ? "" : " (game by game from 2016-17)"),
            live: live, gameId: game.id, gameTag: tag, gameScore: scr,
          });
        });
      });
    });
  }

  // ---- v17: the most points by a player in tonight's building (tonight.json `arenas`, home team's code) ----
  // A list the user sent (11/16/26), checked where our own results reach, with this season's games on top. Either
  // team's player counts. A row we could not check says so on the card. Only when the game is on tonight's list
  // (so a neutral-site game, which is left out of `arenas`, never gets one).
  var ARENA_GAP = 8;
  function arenaChecks(game, sides, box, tag, scr) {
    var T = state.tonight, A = T && T.arenas && T.arenas[sides.home];
    if (!A || !A.pts || !T.games.some(function (x) { return x.away === sides.away && x.home === sides.home; })) return;
    ["away", "home"].forEach(function (side) {
      (box[side] || []).forEach(function (p) {
        if (!p || (p.min || 0) < 1) return;
        var v = Number(p.pts != null ? p.pts : p.points) || 0, made = v >= A.pts;
        if (!made && (game.status !== "live" || v < A.pts - ARENA_GAP)) return;
        var name = p.name || p.displayName || p.shortName || ("#" + p.id), team = side === "away" ? sides.away : sides.home;
        var unsure = A.check === "unconfirmed" || A.check === "quiz" ? " · this record is from a quiz list, not checked against a league source" : "";
        fire("cc-arena-" + game.id + "-" + p.id + (made ? (v > A.pts ? "-broke" : "-tied") : "-near"), {
          type: "milestone", icon: made ? (v > A.pts ? "🏟️ ARENA RECORD" : "🏟️ TIES ARENA RECORD") : "👀 " + (A.pts - v) + " FROM ARENA RECORD",
          text: name + " (" + team + ") — " + v + " points" + (made ? (v > A.pts ? ": the most ever at " : ": ties the most ever at ") : ", " + (A.pts - v) + " from the most ever at ") + A.arena + " (" + A.pts + ", " + A.who + ")",
          statLine: typeof fmtAlertStatLine === "function" ? fmtAlertStatLine([[v, "POINTS"]]) : "",
          sub: "Command Center · arena scoring records (a list of 6/9/26 plus every game since)" + unsure,
          live: game.status === "live", gameId: game.id, gameTag: tag, gameScore: scr,
        });
      });
    });
  }

  // ---- v21: "the first since…" (tonight.json `lasttime`, by team) ----
  // Three guides print "the last time" a player of theirs, or one against them, reached a number (Boston, Washington,
  // Golden State), and a few more print every triple-double. The build counts those forward and sends the ones not
  // done in three years or more, with the sentence already written. A player who gets there tonight gets one card
  // per stat, for the highest bar he has cleared.
  function lastTimeChecks(game, sides, box, tag, scr) {
    var L = state.tonight && state.tonight.lasttime;
    if (!L) return;
    var post = false;
    try { post = typeof isPlayoffSlate === "function" && !!isPlayoffSlate(); } catch (e) { post = false; }
    if (post) return;
    ["away", "home"].forEach(function (side) {
      var team = side === "away" ? sides.away : sides.home, other = side === "away" ? sides.home : sides.away;
      (box[side] || []).forEach(function (p) {
        if (!p || (p.min || 0) < 1) return;
        var name = p.name || p.displayName || p.shortName || ("#" + p.id);
        [[L[team], "team", team], [L[other], "opp", other]].forEach(function (x) {
          var best = {};
          (x[0] || []).forEach(function (f) {
            if (f.by !== x[1] || !LIST_FIELD[f.stat]) return;
            var v = Number(p[LIST_FIELD[f.stat]]) || 0;
            if (v >= f.n && (!best[f.stat] || f.n > best[f.stat].f.n)) best[f.stat] = { f: f, v: v };
          });
          Object.keys(best).forEach(function (stat) {
            var f = best[stat].f, v = best[stat].v;
            fire("cc-last-" + game.id + "-" + p.id + "-" + x[2] + "-" + stat, {
              type: "milestone", icon: "🕰️ FIRST SINCE " + String(f.date).slice(0, 4),
              text: name + " (" + team + ") — " + v + " " + LIST_WORD[stat] + ": " + f.phrase,
              statLine: typeof fmtAlertStatLine === "function" ? fmtAlertStatLine([[v, LIST_WORD[stat].toUpperCase()]]) : "",
              sub: "Command Center · the team media guides' \"last time\" pages and lists, counted forward",
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

  // ---- v24: each team's single-game TEAM marks (the team media guides; teammarks.json) ----
  // What a card needs: "most" — the total ties or passes the mark (live or final), or is within TM_NEAR of the team's own
  // mark while the game is live. "Fewest" — only once it can no longer change much: at the final, or for the team's own
  // mark inside the last two minutes of the 4th quarter or an overtime. A tie of a "fewest" at zero, or in a stat where
  // ties are common (TM_TIE_FEWEST leaves those out), is not a card: the same rules as the morning lines.
  var TM_STATS = ["pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf"];
  var TM_FIELD = { fgm: "fgm", fga: "fga", fg3m: "tpm", fg3a: "tpa", ftm: "ftm", fta: "fta", reb: "reb", oreb: "oreb", dreb: "dreb", ast: "ast", stl: "stl", blk: "blk", pf: "pf" };
  var TM_WORD = { pts: "points", fgm: "field goals", fga: "field goal attempts", fg3m: "threes", fg3a: "three-point attempts", ftm: "free throws", fta: "free throw attempts", reb: "rebounds",
    oreb: "offensive rebounds", dreb: "defensive rebounds", ast: "assists", stl: "steals", blk: "blocks", tov: "turnovers", pf: "fouls" };
  var TM_NEAR = { pts: 8, fgm: 4, fga: 5, fg3m: 2, fg3a: 4, ftm: 4, fta: 4, reb: 5, oreb: 3, dreb: 4, ast: 4, stl: 2, blk: 2, tov: 2, pf: 3 };
  var TM_TIE_FEWEST = { pts: 1, fgm: 1, fga: 1, reb: 1, ast: 1, tov: 1, ftm: 1, fta: 1, pf: 1 };
  var TM_LIVE_OWN = { pts: "pts", reb: "reb", ast: "ast", stl: "stl", blk: "blk", fg3m: "tpm", fgm: "fgm", ftm: "ftm", fta: "fta", fg3a: "tpa", oreb: "oreb", dreb: "dreb", tov: "tov" };   // NBA Live's NBA_TEAM_RECORDS
  var TM_LATE = 120;   // seconds left in the 4th quarter or an overtime for a "fewest" watch
  function teamTotal(game, side, stat, low) {
    if (stat === "pts") { var sc = Number(game[side] && game[side].score); return isFinite(sc) ? sc : null; }
    var ps = ((game.boxscore || {})[side] || []).filter(function (p) { return p && (p.min || 0) > 0; });
    if (ps.length < 5) return null;                                   // not a box score yet
    var sum = function (f) { return ps.reduce(function (s, p) { return s + (Number(p[f]) || 0); }, 0); };
    if (stat === "tov") {
      // players' turnovers for a "most" (a guide may leave team turnovers out); the official total, team turnovers
      // included, for a "fewest". Either way the card errs toward not firing.
      var own = ps.reduce(function (s, p) { return s + (Number(p.to != null ? p.to : p.tov) || 0); }, 0), off = own;
      try { if (low && typeof teamOfficialTotal === "function") off = Math.max(own, Number(teamOfficialTotal(game, side, "tov")) || 0); } catch (e) { off = own; }
      return low ? off : own;
    }
    return sum(TM_FIELD[stat]);
  }
  function secsLeftNow(game) {
    var c = String(game.clock || "").trim(), m = /^(\d+):(\d+)/.exec(c);
    return m ? Number(m[1]) * 60 + Number(m[2]) : (c === "" ? null : Math.round(parseFloat(c) || 0));
  }
  function teamMarkChecks(game, sides, box, tag, scr) {
    var M = state.teamMarks;
    if (!M || !M.teams || (game.status !== "live" && game.status !== "final")) return;
    var post = false;
    try { post = typeof isPlayoffSlate === "function" && !!isPlayoffSlate(); } catch (e) { post = false; }
    if (post) return;                                                 // the guides' marks here are regular season
    var live = game.status === "live", fin = game.status === "final", per = Number(game.period) || 0, left = secsLeftNow(game);
    var late = live && per >= 4 && left != null && left <= TM_LATE;
    var mdy = function (d) { return d ? Number(d.slice(5, 7)) + "/" + Number(d.slice(8, 10)) + "/" + d.slice(2, 4) : ""; };
    var held = function (m) { return (m.d ? mdy(m.d) : "") + (m.o ? (m.d ? " " : "") + m.o : "") + (m.n > 1 ? " and " + (m.n - 1) + " more" : ""); };
    var backs = function (T, m) { return T.name + " media guide" + (T.scope ? ", " + T.scope : "") + " · " + (m.ok ? "number checked against " + m.ok : "guide only: not checked against a box score"); };
    var find = function (T, s, k, st) { return T ? (T.m || []).filter(function (m) { return m.s === s && m.k === k && m.st === st; })[0] : null; };
    var liveOwns = function (k, st) { try { return k === "most" && !!TM_LIVE_OWN[st] && typeof NBA_TEAM_RECORDS !== "undefined" && !!NBA_TEAM_RECORDS[TM_LIVE_OWN[st]]; } catch (e) { return false; } };
    ["away", "home"].forEach(function (side) {
      var other = side === "away" ? "home" : "away", team = sides[side], opp = sides[other], T = M.teams[team], O = M.teams[opp];
      var fga = teamTotal(game, side, "fga", false);
      ["most", "fewest"].forEach(function (k) {
        var low = k === "fewest";
        TM_STATS.forEach(function (st) {
          var base = "cc-tm-" + game.id + "-" + team + "-" + k + "-" + st, keys = ["-nba", "-broke", "-tied", "-near", "-watch"].map(function (x) { return base + x; });
          var only = function (key, card) { keys.forEach(function (x) { if (x !== key && state.keys[x]) dropCard(x); }); if (key) fire(key, card); };
          var v = teamTotal(game, side, st, low);
          if (v == null || (st !== "pts" && low && !(fga >= 40))) { if (state.keys[base + "-opp"]) dropCard(base + "-opp"); return only(null); }   // a "fewest" needs a whole box score
          var F = find(T, "team", k, st), P = find(O, "opp", k, st), L = (M.league || {})[k + "|" + st];
          var reach = function (m) { return !!m && (low ? v <= m.v : v >= m.v) && !(low && v === m.v && (v === 0 || !TM_TIE_FEWEST[st])); };
          var settled = !low || fin;                                                      // a "most" stands once reached; a "fewest" only at the final
          var word = v === 1 ? TM_WORD[st].replace(/s$/, "") : TM_WORD[st], sup = low ? "fewest" : "most";
          var stat = typeof fmtAlertStatLine === "function" ? fmtAlertStatLine([[v, TM_WORD[st].toUpperCase()]]) : "";
          var card = function (icon, text, sub) { return { type: "milestone", icon: icon, text: text, statLine: stat, sub: "Command Center · " + sub, live: live, gameId: game.id, gameTag: tag, gameScore: scr }; };
          var nba = L && !L.many && settled && reach(L) && !(low && v === 0);
          // the most or fewest by an opponent, in the other team's guide: a card of its own, beside this team's (v24: it
          // used to wait behind "close to its own record", which hid a mark already made)
          if (P && settled && reach(P) && !nba)
            fire(base + "-opp", card(v === P.v ? "🏛️ TIES OPPONENT MARK" : "🏛️ OPPONENT RECORD",
              team + " — " + v + " " + word + ": " + (v === P.v ? "ties the " : "the ") + sup + " by an opponent against the " + O.name + " (" + (v === P.v ? "" : "was ") + P.v + ", " + held(P) + ")", backs(O, P)));
          else if (state.keys[base + "-opp"]) dropCard(base + "-opp");
          var also = F && reach(F) ? "; also the " + T.name + " record (" + (v === F.v ? "ties " : "was ") + F.v + ", " + held(F) + ")" : "";
          if (nba && !liveOwns(k, st))
            return only(base + "-nba", card(v === L.v ? "🏆 TIES NBA RECORD" : "🏆 NBA RECORD",
              team + " — " + v + " " + word + ": " + (v === L.v ? "ties the NBA record for the " : "an NBA record, the ") + sup + " by a team in a game (" + (v === L.v ? "" : "was ") + L.v + ", " + L.holder + ")" + also,
              "the league's record book" + (F ? " · " + backs(T, F) : "")));
          if (F && settled && reach(F)) {
            var broke = v !== F.v;
            return only(base + (broke ? "-broke" : "-tied"), card(broke ? "🏛️ TEAM RECORD" : "🏛️ TIES TEAM RECORD",
              team + " — " + v + " " + word + ": " + (broke ? "the " + sup + " in a game in " + T.name + " history (was " : "ties the " + T.name + " record for the " + sup + " in a game (") + F.v + ", " + held(F) + ")"
                + (nba ? "; " + (v === L.v ? "ties" : "passes") + " the NBA record too (" + L.v + ")" : ""), backs(T, F)));
          }
          if (F && live && !low && v >= F.v - TM_NEAR[st] && v >= 0.8 * F.v)
            return only(base + "-near", card("👀 " + (F.v - v) + " FROM TEAM RECORD", team + " — " + v + " " + word + ", " + (F.v - v) + " from the " + T.name + " record for a game (" + F.v + ", " + held(F) + ")", backs(T, F)));
          if (F && late && low && (v < F.v || (v === F.v && v > 0 && TM_TIE_FEWEST[st])))
            return only(base + "-watch", card("👀 FEWEST WATCH", team + " — " + v + " " + word + " with " + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0") + " left" + (per > 4 ? " in overtime" : "")
              + ": the " + T.name + " record for the fewest in a game is " + F.v + " (" + held(F) + ")", backs(T, F)));
          only(null);                                                                     // nothing now: a card from earlier that no longer holds comes down
        });
      });
    });
  }

  // ---- v5: this season, from the Game Flow files (data/flowstats.json) ----
  var QTR = 720;
  var SEASON_TOP = 10, TEAM_TOP = 5;         // a place on the season's lists worth a card
  var Q_MIN = 15, H_MIN = 22, TQ_MIN = 40;    // and the least that can make one
  var IRON_GAME = 300, IRON_HALF = 120;        // v15: a player who hasn't sat: from 5:00 left in the game, 2:00 left in a half
  var LATE_RETURN = 180;                      // seconds past his usual return
  var LEAD = 20;                              // a lead lost is a card from here (v16: 20, was 15: 18 of the season's first 197 games
                                              // had a 15-point lead lost, 8 a 20-point one; the user, 11/16)
  var BIG_IMPORTANCE = 50;                    // v18: a milestone this big shows as soon as he plays; a lesser one only within reach
  var REACH = { pts: 10, fg3m: 3, reb: 4, ast: 4, stl: 3, blk: 3, fgm: 4, ftm: 4, dreb: 4, oreb: 3, min: 15, tov: 2 };   // the first six are NBA Live's
  var reachOf = function (stat) { return REACH[stat] != null ? REACH[stat] : 1; };   // counts of games (g10ast, dd, td, gp): the next one
  var LATE_LEAD = 15;                         // v17: or a lead this big held in the 4th quarter or overtime (1 lost in 117 such games through 11/15)
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
    // v19: NBA Live's BENCH IMPACT / BENCH DOMINANCE card (bench-<game>-<side>) gets how often that has been the
    // final result this season, for the team and the league (the user, 11/16: "maybe there is a way to track if this
    // is a common occurrence, which it generally shouldn't be"). tonight.json `bench`.
    var bm = /^bench-([^-]+)-(away|home)$/.exec(String(key));
    if (bm && card && !card.ended) {
      var Bn = state.tonight && state.tonight.bench, bg = (games() || []).filter(function (g) { return g && String(g.id) === bm[1]; })[0];
      var bt = bg && bg[bm[2]] ? tri(bg[bm[2]].tricode) : null, mine = Bn && bt && Bn.teams ? Bn.teams[bt] : null;
      if (!Bn || !mine || !Bn.gp) return card;
      return Object.assign({}, card, { sub: (card.sub ? card.sub + " · " : "") + "Command Center · " + bt + "'s bench has outscored its starters in " + mine.n + " of " + mine.gp + " games this season; " + Bn.n + " of " + Bn.gp + " team games league-wide" });
    }
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
  // v25: odd lines (see the header). The rules module has no imports; its exports become one object.
  // NBA Live's own cards that already say the same thing: a prefix of its key for that player in this game.
  var ODD_OWN = { ofg: "sr-0fg-", o3: "sr-0tpa-", perft: "sr-pft-", tov: "sr-tov-" };
  // Left to NBA Live's own season-high and career-high cards: a number far above his own average is a big night, not an
  // odd line. They stay on the website's list. (Remove an id here to card it.)
  var ODD_SKIP = { erupt: 1, reb3x: 1, ast3x: 1 };
  var ODD_GRADE = { rare: "Rare (once a season or less)", few: "A few a season", monthly: "About monthly", common: "Common" };
  // v26: what the count behind the card rests on. The Bulls' and Pelicans' games of 2012-13 to 2017-18 are in the counts
  // from pbpstats (no turnovers or fouls), so only a line that needs a turnover or a foul is still short of about 3% of
  // games; every other line is short of under 1%. The module says which (TOV_PF: a template's id, or one level's key).
  function oddOnFile(R, h) {
    var short = R && R.TOV_PF;
    if (!short || !short.length) return "ESPN box scores, about 3% of games not on file";   // an older copy of the rules: the old wording
    return short.indexOf(h.id) >= 0 || short.indexOf(h.key) >= 0 ? "ESPN box scores, about 3% of games not on file" : "ESPN and pbpstats box scores, under 1% of games not on file";
  }
  function oddLineChecks(game, sides, box, tag, scr) {
    var O = state.odd, R = state.oddRules;
    if (!O || !R || (game.status !== "live" && game.status !== "final")) return;
    var post = false;
    try { post = typeof isPlayoffSlate === "function" && !!isPlayoffSlate(); } catch (e) { post = false; }
    if (post || game.countsForRecords === false) return;                // the counts are regular-season games
    var live = game.status === "live", fin = game.status === "final", per = Number(game.period) || 0, left = secsLeftNow(game);
    var lateSecs = R.LATE_SECS || 300;
    var closing = fin || (live && (per >= 5 || (per === 4 && left != null && left <= lateSecs)));
    var clock = String(game.clock || "").trim(), when = per >= 5 ? (per === 5 ? "overtime" : (per - 4) + " overtimes in") : "the 4th";
    state.oddEnded = state.oddEnded || {};
    ["away", "home"].forEach(function (side) {
      var ps = (box[side] || []).filter(Boolean), team = sides[side];
      var known = ps.filter(function (p) { return !!p.starter; }).length === 5;   // "off the bench" only when five starters are marked
      ps.forEach(function (p) {
        if (p.id == null) return;
        var n = function (f) { return Number(p[f]) || 0; };
        var l = { min: n("min"), pts: n("pts"), fgm: n("fgm"), fga: n("fga"), fg3m: n("tpm"), fg3a: n("tpa"), ftm: n("ftm"), fta: n("fta"), oreb: n("oreb"), dreb: n("dreb"), reb: n("reb"), ast: n("ast"),
          stl: n("stl"), blk: n("blk"), tov: Number(p.to != null ? p.to : p.tov) || 0, pf: n("pf"), starter: known ? (p.starter ? 1 : 0) : null };
        var a = (O.avg || {})[String(p.id)], x = { pos: R.posGroup((O.pos || {})[String(p.id)]), avg: a ? { pts: a[0], reb: a[1], ast: a[2] } : null };
        // One card a player: his rarest line that may be said now is the headline, any others follow in the small print.
        var key = "cc-odd-" + game.id + "-" + p.id;
        var hits = R.liveHits(l, x, O.t, O.from).filter(function (h) {
          if (ODD_SKIP[h.id]) return false;
          var own = ODD_OWN[h.id] && typeof ALERT_STORIES !== "undefined" && ALERT_STORIES.get(ODD_OWN[h.id] + game.id + "-" + p.id);
          return (h.live === "grow" || closing) && !(own && !own.ended);
        });
        if (!hits.length) {
          // a card that was up and is no longer true (a late line undone, or a stat taken back): grey it with the line as it is now
          if (state.keys[key] && !state.oddEnded[key]) {
            state.oddEnded[key] = 1;
            if (typeof endStory === "function") endStory(key, p.name + " (" + team + ") — no longer an odd line: " + l.pts + " pts, " + l.fgm + "-" + l.fga + " FG, " + l.ftm + "-" + l.fta + " FT, " + l.reb + " reb, " + l.ast + " ast");
            else dropCard(key);
          }
          return;
        }
        delete state.oddEnded[key];
        var h = hits[0], standing = live && h.live === "late";
        var also = hits.slice(1).map(function (o) { return o.say + (live && o.live === "late" && !standing ? " (as it stands)" : ""); });
        var noteText = String(h.note || "").replace(/\.$/, "");
        fire(key, { type: "streak", icon: standing ? "🧩 ODD LINE · AS IT STANDS" : "🧩 ODD LINE",
          text: p.name + " (" + team + ") — " + h.say + (standing && clock ? ", " + clock + " left in " + when : ""),
          statLine: typeof fmtAlertStatLine === "function" ? fmtAlertStatLine([[l.pts, "PTS"], [l.reb, "REB"], [l.ast, "AST"]]) : "",
          sub: "Command Center · " + (h.grade ? ODD_GRADE[h.grade] + " · " : "") + (noteText ? noteText + " · " : "") + (also.length ? "Also: " + also.join("; ") + " · " : "")
            + (standing ? "stands only if the game ends here · " : "") + oddOnFile(R, h),
          live: live, gameId: game.id, gameTag: tag, gameScore: scr });
      });
    });
  }
  // v27: rare combinations (see the header). The module has no imports; its exports become one object.
  var RARE_LABEL = { pts: "PTS", reb: "REB", ast: "AST", fg3m: "3PM", stl: "STL", blk: "BLK", fga: "FGA" };
  function rareChecks(game, sides, box, tag, scr) {
    var D = state.rare, R = state.rareRules;
    if (!D || !R || (game.status !== "live" && game.status !== "final")) return;
    var post = false;
    try { post = typeof isPlayoffSlate === "function" && !!isPlayoffSlate(); } catch (e) { post = false; }
    if (post || game.countsForRecords === false) return;                // the counts are regular-season games
    var live = game.status === "live", fin = game.status === "final", per = Number(game.period) || 0, left = secsLeftNow(game);
    var closing = fin || (live && (per >= 5 || (per === 4 && left != null && left <= 300)));
    var clock = String(game.clock || "").trim(), when = per >= 5 ? (per === 5 ? "overtime" : (per - 4) + " overtimes in") : "the 4th";
    var from = D.from || "1993-94";
    state.rareEnded = state.rareEnded || {}; state.rareWarn = state.rareWarn || {}; state.rareHit = state.rareHit || {};
    ["away", "home"].forEach(function (side) {
      var ps = (box[side] || []).filter(Boolean), team = sides[side];
      ps.forEach(function (p) {
        if (p.id == null) return;
        var n = function (f) { return Number(p[f]) || 0; };
        var l = { pts: n("pts"), reb: n("reb"), ast: n("ast"), fg3m: n("tpm"), stl: n("stl"), blk: n("blk"), fga: n("fga") };
        var key = "cc-rare-" + game.id + "-" + p.id;
        // A build that already holds tonight's game: it is left out of the counts, never measured against itself.
        var res = R.liveRare(D, l, { exclude: game.id });
        var hits = res.hits.filter(function (h) { return h.live === "grow" || closing; });
        if (hits.length) {
          var h = hits[0], standing = live && h.live === "late";
          var also = hits.slice(1, 3).map(function (o) { return o.line + " (" + (o.n === 0 ? "no one else" : R.ordinal(o.n + 1)) + ")"; });
          fire(key, { type: "streak", icon: (h.n === 0 ? "🦄 ONE OF ONE" : "🦄 RARE LINE") + (standing ? " · AS IT STANDS" : ""),
            text: p.name + " (" + team + ") — " + h.line + ": " + R.countText(h.n, from) + (standing && clock ? ", " + clock + " left in " + when : ""),
            statLine: typeof fmtAlertStatLine === "function" ? fmtAlertStatLine(h.keys.map(function (k) { return [l[k], RARE_LABEL[k] || k]; })) : "",
            sub: "Command Center · " + (h.before.length ? "Before: " + h.before.join("; ") + " · " : "") + (also.length ? "Also: " + also.join("; ") + " · " : "")
              + (standing ? "stands only if the game ends here · " : "") + "regular season, ESPN box scores since " + from,
            live: live, gameId: game.id, gameTag: tag, gameScore: scr });
          state.rareHit[key] = 1; delete state.rareWarn[key]; delete state.rareEnded[key];
          return;
        }
        // A late line undone (more shots): greyed with the line as it is now.
        if (state.rareHit[key] && state.keys[key] && !state.rareEnded[key]) {
          state.rareEnded[key] = 1;
          if (typeof endStory === "function") endStory(key, p.name + " (" + team + ") — no longer a rare line: " + l.pts + " pts on " + l.fga + " shots, " + l.reb + " reb, " + l.ast + " ast");
          else dropCard(key);
          return;
        }
        if (state.rareHit[key]) return;
        // On the verge (the user, 11/21: "should warn ahead of time"): live only; replaced by the card if he gets there.
        if (live && res.warn.length) {
          var w = res.warn[0];
          fire(key, { type: "streak", icon: "👀 ON THE VERGE", text: p.name + " (" + team + ") — " + R.warnText(w, from),
            statLine: typeof fmtAlertStatLine === "function" ? fmtAlertStatLine(w.keys.map(function (k) { return [l[k], RARE_LABEL[k] || k]; })) : "",
            sub: "Command Center · " + (w.n ? "done " + (w.n === 1 ? "once" : w.n + " times") + " before · " : "") + "regular season, ESPN box scores since " + from,
            live: true, gameId: game.id, gameTag: tag, gameScore: scr });
          state.rareWarn[key] = 1;
          return;
        }
        // A warning that no longer applies (the final, or the line moved past it in a way that isn't a hit): taken down.
        if (state.rareWarn[key]) { dropCard(key); delete state.rareWarn[key]; }
      });
    });
  }
  // ---- v29: career feats (featlive.json boards) ----
  var FEAT_LABEL = { pts: "PTS", reb: "REB", ast: "AST", fg3m: "3PM", stl: "STL", blk: "BLK" };
  function boxLine(p) { var n = function (f) { return Number(p[f]) || 0; }; return { pts: n("pts"), reb: n("reb"), ast: n("ast"), fg3m: n("tpm"), stl: n("stl"), blk: n("blk"), starter: !!p.starter }; }
  function lateNow(game) { var per = Number(game.period) || 0, left = secsLeftNow(game); return game.status === "live" && (per >= 5 || (per === 4 && left != null && left <= 360)); }
  function featChecks(game, sides, box, tag, scr) {
    var D = state.feat, R = state.featRules;
    if (!D || !R || !D.boards || (game.status !== "live" && game.status !== "final")) return;
    var post = false;
    try { post = typeof isPlayoffSlate === "function" && !!isPlayoffSlate(); } catch (e) { post = false; }
    if (post || game.countsForRecords === false) return;                 // the boards are regular-season games
    var live = game.status === "live", fin = game.status === "final", per = Number(game.period) || 0, left = secsLeftNow(game);
    var closing = fin || (live && (per >= 5 || (per === 4 && left != null && left <= 300)));
    var clock = String(game.clock || "").trim(), gid = String(game.id), idx = tonightIndex();
    state.featHit = state.featHit || {}; state.featWarn = state.featWarn || {}; state.featEnded = state.featEnded || {};
    // A count that already holds tonight's game (a build after it) is taken back to before it.
    var before = function (r) { return r.now - ((r.games || []).map(String).indexOf(gid) >= 0 ? 1 : 0); };
    ["away", "home"].forEach(function (side) {
      var team = sides[side];
      (box[side] || []).forEach(function (p) {
        if (!p || p.id == null || (p.min || 0) < 1) return;
        var l = boxLine(p);
        Object.keys(D.boards).forEach(function (key) {
          var b = D.boards[key], row = (b.rows || []).find(function (r) { return r.id != null && String(r.id) === String(p.id); });
          if (!row) return;
          // Everyone else on the list at tonight's count: another one of them may do it tonight too (any game NBA Live shows).
          var rows = b.rows.filter(function (r) { return r !== row; }).map(function (r) {
            var q = r.live ? idx[normName(r.name)] : null, c = r.live ? before(r) : r.now;
            return { name: r.name, now: c + (q && R.qualifies(b, boxLine(q)) ? 1 : 0), atLeast: !!r.atLeast };
          });
          var res = R.featLive({ label: b.label, one: b.one, min: b.min, max: b.max, td: b.td, since: b.since, rows: rows }, row.name, before(row), l);
          var k = "cc-feat-" + key + "-" + p.id + "-" + gid;
          var stat = Object.keys(b.min || {}).concat(Object.keys(b.max || {})).filter(function (x, i, a) { return a.indexOf(x) === i; });
          var statLine = typeof fmtAlertStatLine === "function" ? fmtAlertStatLine(stat.map(function (x) { return [l[x], FEAT_LABEL[x] || x]; })) : "";
          // v29.1: each board says where its counts come from (Basketball-Reference's all-time lists, or our box scores since 1993-94).
          var src = b.from === "ours" ? "regular season since " + (b.since || "1993-94") + ", our box scores" : "regular season, Basketball-Reference through " + (b.asOf || D.asOf) + " plus box scores since";
          if (b.caveat) src += " · " + b.caveat;
          if (res && res.hit && (!b.max || closing)) {
            var standing = !!b.max && live;
            var h = res.hit;
            fire(k, { type: "milestone", icon: (h.record ? "🏆 CAREER FEAT · RECORD" : "📊 CAREER FEAT") + (standing ? " · AS IT STANDS" : ""),
              text: row.name + " (" + team + ") — " + h.text + (standing && clock ? ", " + clock + " left" : ""), statLine: statLine,
              backHtml: boardBack("📊 " + (b.since ? "Since " + b.since : "All-time") + " · " + b.label, rows, row.name, h.after),
              sub: "Command Center · " + (standing ? "stands only if the game ends here · " : "") + src, live: live, gameId: game.id, gameTag: tag, gameScore: scr });
            state.featHit[k] = 1; delete state.featWarn[k]; delete state.featEnded[k];
            return;
          }
          if (state.featHit[k] && state.keys[k] && !state.featEnded[k] && !(res && res.hit)) {
            state.featEnded[k] = 1;   // taken back: a stat change, or more points on a board with a ceiling
            if (typeof endStory === "function") endStory(k, row.name + " (" + team + ") — no longer a " + (b.one || b.label) + " (" + stat.map(function (x) { return l[x] + " " + (FEAT_LABEL[x] || x).toLowerCase(); }).join(", ") + ")");
            else dropCard(k);
            return;
          }
          if (state.featHit[k]) return;
          if (live && per >= 3 && res && res.warn) {
            fire(k, { type: "milestone", icon: "👀 ON THE VERGE", text: row.name + " (" + team + ") — " + R.featWarnText(b, res.warn), statLine: statLine,
              backHtml: boardBack("📊 " + (b.since ? "Since " + b.since : "All-time") + " · " + b.label, rows, row.name, res.warn.move.after),
              sub: "Command Center · career feat board · " + src, live: true, gameId: game.id, gameTag: tag, gameScore: scr });
            state.featWarn[k] = 1;
            return;
          }
          if (state.featWarn[k]) { dropCard(k); delete state.featWarn[k]; }
        });
      });
    });
  }
  // ---- v29: streaks entering tonight (featlive.json streaks, teamStreaks) ----
  function streakChecks(game, sides, box, tag, scr) {
    var D = state.feat, R = state.featRules;
    if (!D || !R || (game.status !== "live" && game.status !== "final")) return;
    var night = nbaLiveNight();
    if (night && D.through && night <= D.through) return;               // already in the counts
    var post = false;
    try { post = typeof isPlayoffSlate === "function" && !!isPlayoffSlate(); } catch (e) { post = false; }
    if (post) return;
    var live = game.status === "live", fin = game.status === "final", late = lateNow(game), clock = String(game.clock || "").trim();
    var per = Number(game.period) || 0, when = per >= 5 ? "overtime" : "the 4th";
    var ON_FILE = function (s) { return s.source === "list" ? "the all-time list of runs since " + (s.since || "1967-68") + " (Basketball-Reference), plus box scores since" : "a run the " + s.team + " game notes name; the count is our box scores'"; };
    (D.streaks || []).forEach(function (s) {
      if (s.team !== sides.away && s.team !== sides.home) return;
      var side = s.team === sides.away ? "away" : "home", team = s.team;
      var p = (box[side] || []).find(function (x) { return x && String(x.id) === String(s.id); });
      if (!p || ((p.min || 0) < 1 && !(p.starter && s.tests.indexOf("start") >= 0))) return;   // a game he doesn't play leaves a run alone
      var l = boxLine(p), k = "cc-streak-" + s.id + "-" + game.id, n1 = s.n + 1;
      var met = R.streakMet(s.tests, l), startOnly = s.tests.length === 1 && s.tests[0] === "start";
      var place = "";
      if (s.source === "list" && Array.isArray(s.list)) {
        var above = s.list.filter(function (x) { return x.n > n1; }), passed = s.list.filter(function (x) { return x.n === s.n; });
        var rk = 1 + above.length, next = above.slice().sort(function (a, b) { return a.n - b.n; })[0];
        place = ", " + (rk === 1 ? "the longest" : "the " + R.featOrd(rk) + "-longest") + " since " + (s.since || "1967-68") + (passed.length ? ", passing " + passed.map(function (x) { return x.name + " (" + x.n + ")"; }).join(" and ") : "") + (next ? "; " + next.name + "'s " + next.n + " is next" : "");
      }
      if (met) {
        fire(k, { type: "streak", icon: "🔥 STREAK EXTENDED", text: p.name + " (" + team + ") — " + (startOnly ? "starts" : s.label) + " in " + n1 + " straight games" + place,
          sub: "Command Center · " + ON_FILE(s), live: live, gameId: game.id, gameTag: tag, gameScore: scr });
        return;
      }
      if (fin || (startOnly && !p.starter)) {
        fire(k, { type: "streak", icon: "🧊 STREAK ENDS", text: p.name + " (" + team + ") — his run of " + s.n + " straight games with " + s.label + " ends" + (startOnly ? " (off the bench)" : " (" + l.pts + " pts, " + l.reb + " reb, " + l.ast + " ast" + (s.tests.some(function (x) { return x && x.k === "fg3m"; }) ? ", " + l.fg3m + " 3PM" : "") + ")"),
          sub: "Command Center · " + ON_FILE(s), live: live, gameId: game.id, gameTag: tag, gameScore: scr });
        return;
      }
      if (late) {
        var short = R.shortText(R.streakShort(s.tests, l));
        fire(k, { type: "streak", icon: "⚠️ STREAK IN DANGER", text: p.name + " (" + team + ") — " + (short ? short + " short of " : "") + s.label + " for " + n1 + " straight games" + (clock ? ", " + clock + " left in " + when : ""),
          sub: "Command Center · " + ON_FILE(s), live: true, gameId: game.id, gameTag: tag, gameScore: scr });
      }
    });
    (D.teamStreaks || []).forEach(function (t) {
      if (t.team !== sides.away && t.team !== sides.home) return;
      var home = t.team === sides.home, us = Number((home ? game.home : game.away).score) || 0, them = Number((home ? game.away : game.home).score) || 0;
      var st = R.teamStake(t, { opp: home ? sides.away : sides.home, home: home, us: us, them: them, final: fin, late: late });
      var k = "cc-tstreak-" + t.team + "-" + t.kind + "-" + game.id, n1 = t.n + 1;
      if (!st.atStake) { if (st.off && state.keys[k] && !state.done[k]) dropCard(k); return; }
      var src = "Command Center · the " + t.team + " game notes' count (" + t.n + " entering tonight)";
      if (st.met) fire(k, { type: "streak", icon: "🔥 TEAM STREAK EXTENDED", text: t.team + " — " + n1 + " straight " + t.label, sub: src, live: live, gameId: game.id, gameTag: tag, gameScore: scr });
      else if (st.ended) fire(k, { type: "streak", icon: "🧊 TEAM STREAK ENDS", text: t.team + " — " + t.n + " straight " + t.label + " ends (" + us + "-" + them + ")", sub: src, live: live, gameId: game.id, gameTag: tag, gameScore: scr });
      else if (st.inDanger) fire(k, { type: "streak", icon: "⚠️ TEAM STREAK IN DANGER", text: t.team + " — " + t.n + " straight " + t.label + " on the line: " + us + "-" + them + (clock ? ", " + clock + " left in " + when : ""), sub: src, live: true, gameId: game.id, gameTag: tag, gameScore: scr });
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
  // v18: when his nth personal foul was called, from the play-by-play ("Q1 6:15"); null when the feed doesn't show it.
  // (The user, 11/16: a card read "2nd foul, end of the 1st" midway through the 2nd for a foul midway through the 1st.)
  function foulTime(game, id, n, asPlay) {
    var P = game.plays || [], mine = [];
    var twins = [];
    for (var k = 0; k < P.length; k++) if (P[k] && P[k].badge === "foul" && String(P[k].playerId) === String(id) && !/tech|flagrant foul type 2 ejection|defensive 3-seconds|delay/i.test(P[k].desc || "")) (/turnover/i.test(P[k].desc || "") ? twins : mine).push(P[k]);
    // v23 (self-audit of v22, 11/18): a charge is written "offensive charge" + "offensive foul turnover". The first has no
    // "foul" in it, so NBA Live does not tag it, and v22 threw the second away: a charge was not counted at all. A turnover
    // line is the foul itself when no foul line of his stands at the same instant. Checked on 78 games, 11/7-11/17: the
    // count equals the box score for 1,733 of 1,740 players (v22: 1,704); the other 7 are fouls ESPN's feed does not have,
    // or the second player of a double foul. "Hanging techfoul" is a technical too.
    for (var t = 0; t < twins.length; t++) { var has = false; for (var m = 0; m < mine.length; m++) if (mine[m].qtr === twins[t].qtr && String(mine[m].clock) === String(twins[t].clock) && !/turnover/i.test(mine[m].desc || "")) has = true; if (!has) mine.push(twins[t]); }
    // v22 (the user, 11/18: "luka didn't get his 4th foul at the same time he got his 3rd foul"): ESPN writes an offensive
    // foul as two plays at the same instant, "offensive foul" and "offensive foul turnover". The second is the turnover,
    // not another foul; counted, it put his next foul at the time of this one and dropped the real one off the list.
    if (mine.length < n) return null;
    var num = function (x) { var q = /^OT/.test(x.qtr) ? 4 + Number(String(x.qtr).slice(2)) : Number(String(x.qtr).slice(1)), m = /^(\d+):(\d+)/.exec(String(x.clock || "")); return q * 10000 - (m ? Number(m[1]) * 60 + Number(m[2]) : Math.round(parseFloat(x.clock) || 0)); };
    mine.sort(function (a, b) { return num(a) - num(b) || (a.seqNum || 0) - (b.seqNum || 0); });
    var f = mine[n - 1];
    return f && f.qtr ? (asPlay ? f : f.qtr + " " + (f.clock || "")) : null;
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
    // v19 (the user, 11/16: "the command center alerts feel pinned to the top when most should filter in
    // chronologically… when a player got in foul trouble doesn't meet that threshold"): NBA Live sorts by tier before
    // time, and every season card had been sent as a "milestone" (its top tier). Now a season card is routine
    // ("streak": it files in by when it happened) unless it says otherwise: `rare` for the ones that almost never
    // happen, "clutch" for a lead lost.
    var base = function (extra) { return Object.assign({ type: "streak", live: live, gameId: game.id, gameTag: tag, gameScore: scr }, extra); };
    var rare = function (extra) { return base(Object.assign({ type: "milestone" }, extra)); };
    var through = F.games ? " (" + F.games + " games through last night, and tonight's)" : "";
    var S = seasonLists();
    // v18: is this starter sitting past his usual first-half return with two or more fouls? (Then the fouls are why.)
    var benchFor = function (p) {
      if (!live || per > 2 || !p || !p.starter || (Number(p.pf) || 0) < 2 || !court) return null;
      var sd = (box.away || []).indexOf(p) >= 0 ? "away" : "home";
      if (!court[sd] || court[sd].has(p.id) || court[sd].has(String(p.id))) return null;
      var R = (F.rotation || {})[p.id];
      if (!R || (R.starts || 0) < 5 || R.back == null || !R.n || R.n.back < 5 || now < R.back + LATE_RETURN || now >= 2 * QTR || cameBackIn(game, p.id)) return null;
      var out = lastOut(game, p.id);
      return { since: out ? (out.qtr || "") + " " + (out.clock || "") : "", usual: clockAt(R.back) };
    };
    var benchNote = function (p) { var b = benchFor(p); return b ? " · on the bench" + (b.since.trim() ? " since " + b.since.trim() : "") + " (usually back by " + b.usual + ")" : ""; };
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
            text: name + " (" + team + ") — fouled out" + (foulTime(game, p.id, 6) ? ", " + foulTime(game, p.id, 6) : at("cc-fo-" + p.id + "-" + game.id) ? " " + at("cc-fo-" + p.id + "-" + game.id) : "") + " · " + (Fo.out ? "his " + ord(Fo.out + 1) + " foul-out this season" : "his first foul-out this season"),
            statLine: "", sub: "Command Center · Game Flow files" + through }));
          return;
        }
        // v18 (the user, 11/16: "alex sarr in foul trouble means that's why he's not in… so both alerts aren't active"):
        // in the first half a starter with two or more fouls who is sitting past his usual return is on the bench for
        // the fouls. That is this card, with where he has been since; the bench card is not fired for him.
        var sitting = benchFor(p);
        if (!live || !regular || per < 1 || (pf <= Math.min(per, 4) && !sitting)) return;
        state.ftShown[game.id + "|" + p.id] = per;
        // v19 (the user, 11/16: "the text in the foul trouble alerts is too much. the details can go on the back of the
        // card"): the front says who, which foul and when; the season count, tonight's line and the rule are on the back.
        // The card is filed at the time of the foul itself.
        var fp = foulTime(game, p.id, pf, true), when = fp ? fp.qtr + " " + (fp.clock || "") : at("cc-ft-" + p.id + "-" + pf);
        var season = Fo.trouble ? "In early foul trouble in " + Fo.trouble + " of " + (Fo.gp || "?") + " games this season" + (Fo.out ? ", fouled out " + (Fo.out === 1 ? "once" : Fo.out + " times") : "") : "First time in early foul trouble this season" + (Fo.gp ? " (" + Fo.gp + " games)" : "");
        // v20 (the user, 11/16: "why am i told how many points he has? this is a foul trouble alert" and "redundancy
        // telling me he has 4 fouls twice"): the back holds only fouls: when each of tonight's came, the season, the rule.
        var times = []; for (var fn = 1; fn <= pf; fn++) { var ftm = foulTime(game, p.id, fn); if (ftm) times.push(ftm); }
        // v22 (the user, 11/18: "no need for the explainer line on the bottom"): the rule itself is no longer printed.
        var rows = (times.length === pf && pf > 1 ? ["Tonight's fouls: " + times.join(" · ")] : []).concat([season]);
        var ft = { icon: "⚠️ FOUL TROUBLE", text: name + " (" + team + ") — " + ord(pf) + " foul, " + when + benchNote(p),
          statLine: "", sub: "Command Center · " + (Fo.trouble ? Fo.trouble + " of " + (Fo.gp || "?") + " games this season" : "first time this season"),
          backHtml: '<div class="alert-back-title">' + escH("⚠️ Foul trouble · " + name) + "</div>" + rows.map(function (r) { return '<div class="alert-back-play">' + escH(r) + "</div>"; }).join("") };
        if (fp && typeof playToAbsT === "function") { var ft0 = playToAbsT(fp); if (typeof ft0 === "number") { ft.t = ft0; if (fp.wallClock) ft.wt = fp.wallClock; } }
        fire("cc-ft-" + p.id + "-" + game.id, base(ft));
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
        fire("cc-in-" + p.id + "-" + game.id, base({ hold: true, icon: "🔄 HASN'T CHECKED IN",
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
        if (per <= 2 && (pf >= 2 || state.ftShown[game.id + "|" + p.id])) { dropCard("cc-ret-" + p.id + "-" + game.id + "-h1"); }   // v18: the foul-trouble card says it
        else if (per <= 2 && R.back != null && R.n && R.n.back >= 5 && R.n.back >= 0.6 * R.starts && now >= R.back + LATE_RETURN && now < 2 * QTR && !cameBackIn(game, p.id)) {
          fire("cc-ret-" + p.id + "-" + game.id + "-h1", base({ hold: true, icon: "🔄 STILL ON THE BENCH",
            text: name + " (" + team + ") hasn't come back in" + why + " · usually returns " + (R.back % QTR === 0 ? clockAt(R.back) : "by " + clockAt(R.back)) + " (median of " + R.n.back + " starts)" + outText,
            statLine: stl([[Math.round(p.min || 0), "MIN"], [p.pts || 0, "PTS"]]), sub: "Command Center · usual rotation from the Game Flow files · worth a look for an injury" }));
        }
        // v7: only if the play-by-play has reached the 3rd and hasn't shown him on the floor in it. Before, a starter who
        // opened the 3rd and sat inside its first six minutes got this card ("didn't start the 3rd · out since Q3 6:53").
        if (per === 3 && now >= 2 * QTR + 60 && now < 2 * QTR + 360 && (R.open3 || 0) >= 0.8 * R.starts && R.starts >= 5 && feedReached(game, "Q3") && !onFloorIn(game, p.id, "Q3")) {
          fire("cc-ret-" + p.id + "-" + game.id + "-h2", base({ hold: true, icon: "🔄 NOT OUT FOR THE 3RD",
            text: name + " (" + team + ") didn't start the 3rd quarter" + why + " · he opened the 3rd in " + R.open3 + " of " + R.starts + " starts this season" + outText,
            statLine: stl([[Math.round(p.min || 0), "MIN"], [p.pts || 0, "PTS"]]), sub: "Command Center · usual rotation from the Game Flow files · worth a look for an injury" }));
        }
      });
    });
    // v15 (the user, 11/16: "checking for players who play full halves (rare) and full games (almost never)… start
    // alerting in the final five minutes if that player hasn't exited the game yet"). A starter with no substitution out
    // in the play-by-play, on the floor now, with box minutes that agree: from 5:00 left in the 4th (and through any
    // overtime) for the game; in the last two minutes of a half for that half. The card ends when he comes out.
    var FULL0 = F0.full || {}, FULL = { halves: (FULL0.halves || []).filter(mine), games: (FULL0.games || []).filter(mine), fives: (FULL0.fives || []).filter(mine) };
    var hasSubs = (game.plays || []).some(function (x) { return x && x.badge === "sub"; });
    var subIn = function (id, qs) { var P = game.plays || []; for (var k = 0; k < P.length; k++) if (P[k] && P[k].badge === "sub" && qs.indexOf(P[k].qtr) >= 0 && String(P[k].playerId) === String(id)) return true; return false; };
    var subOut = function (id, qs) { var P = game.plays || []; for (var k = 0; k < P.length; k++) if (P[k] && P[k].badge === "sub" && (!qs || qs.indexOf(P[k].qtr) >= 0) && String(P[k].playerOutId) === String(id)) return P[k]; return null; };
    var mmss = function (t) { return Math.floor(t / 60) + ":" + String(Math.round(t % 60)).padStart(2, "0"); };
    var seasonGames = F0.games || 0;
    var fullGamesText = FULL.games.length ? FULL.games.length + " full game" + (FULL.games.length > 1 ? "s" : "") + " this season (last: " + FULL.games[0].name + ", " + md(FULL.games[0].date) + ")" : "nobody has played a full game this season (" + seasonGames + " games)";
    var fullHalvesText = FULL.halves.length ? FULL.halves.length + " full hal" + (FULL.halves.length > 1 ? "ves" : "f") + " by any player this season (last: " + FULL.halves[0].name + ", " + md(FULL.halves[0].date) + ")" : "nobody has played a full half this season (" + seasonGames + " games)";
    ["away", "home"].forEach(function (side) {
      var team = side === "away" ? sides.away : sides.home;
      var roster = (box[side] || []).filter(function (p) { return p && p.id; });
      // Cards already up: he came out, or the game ended with him still in.
      roster.forEach(function (p) {
        [["cc-iron-" + p.id + "-" + game.id, null, "the game"], ["cc-ironh-" + p.id + "-" + game.id + "-1", ["Q1", "Q2"], "the first half"], ["cc-ironh-" + p.id + "-" + game.id + "-2", ["Q3", "Q4"], "the second half"]].forEach(function (c) {
          var ex = typeof ALERT_STORIES !== "undefined" && ALERT_STORIES.get(c[0]);
          if (!ex || ex.ended || typeof endStory !== "function") return;
          var out = subOut(p.id, c[1]);
          if (out) { state.done[c[0]] = 1; endStory(c[0], (p.name || ("#" + p.id)) + " (" + team + ") came out at " + (out.qtr || "") + " " + (out.clock || "") + " · he had played all of " + c[2] + " until then"); }
        });
      });
      if (!hasSubs) return;                                   // no substitutions in the feed: nothing can be said
      var agree = function (p, sec) { return (Number(p.min) || 0) >= sec / 60 - 2; };
      if (live && court && court[side]) {
        var onNow = function (p) { return court[side].has(p.id) || court[side].has(String(p.id)); };
        // The whole game.
        if (per >= 4 && now >= 4 * QTR - IRON_GAME) roster.forEach(function (p) {
          if (!p.starter || !onNow(p) || subOut(p.id, null) || !agree(p, now)) return;
          fire("cc-iron-" + p.id + "-" + game.id, rare({ icon: "🦾 HASN'T LEFT THE GAME",
            text: (p.name || ("#" + p.id)) + " (" + team + ") has played every second so far (" + mmss(now) + ")" + (per > 4 ? ", overtime included" : "") + " · " + fullGamesText,
            statLine: stl([[Math.round(p.min || 0), "MIN"], [p.pts || 0, "PTS"]]), sub: "Command Center · no substitution out in the play-by-play · ends when he comes out" }));
        });
        // A half: the last two minutes of the 2nd or 4th quarter.
        [[2, ["Q1", "Q2"], "first", 0], [4, ["Q3", "Q4"], "second", 2 * QTR]].forEach(function (h) {
          if (per !== h[0] || now < h[0] * QTR - IRON_HALF) return;
          var whole = roster.filter(function (p) {
            if (!onNow(p) || subOut(p.id, h[1])) return false;
            return h[0] === 2 ? p.starter && agree(p, now) : feedReached(game, "Q3") && !subIn(p.id, h[1]) && onFloorIn(game, p.id, "Q3");
          });
          var sofar = mmss(now - h[3]);
          if (whole.length >= 5) {
            fire("cc-iron5-" + team + "-" + game.id + "-" + h[0], base({ icon: "🦾 SAME FIVE ALL HALF",
              text: team + " have played the same five for the whole " + h[2] + " half so far (" + sofar + "): " + whole.map(function (p) { return p.name; }).join(", ") + " · " + (FULL.fives.length ? FULL.fives.length + " time" + (FULL.fives.length > 1 ? "s" : "") + " a team has done it this season" : "no team has done it this season (" + seasonGames + " games)"),
              statLine: "", sub: "Command Center · no substitution in the half in the play-by-play" }));
            return;
          }
          whole.forEach(function (p) {
            if (state.keys["cc-iron-" + p.id + "-" + game.id] && !state.done["cc-iron-" + p.id + "-" + game.id]) return;   // the full-game card says more
            fire("cc-ironh-" + p.id + "-" + game.id + "-" + (h[0] === 2 ? 1 : 2), base({ icon: "🦾 HASN'T SAT THIS HALF",
              text: (p.name || ("#" + p.id)) + " (" + team + ") has played the whole " + h[2] + " half so far (" + sofar + ") · " + fullHalvesText,
              statLine: stl([[Math.round(p.min || 0), "MIN"], [p.pts || 0, "PTS"]]), sub: "Command Center · no substitution out in the half in the play-by-play · ends when he comes out" }));
          });
        });
      }
      // The game is over and he never came out.
      if (game.status === "final") roster.forEach(function (p) {
        var k = "cc-iron-" + p.id + "-" + game.id;
        if (!state.keys[k] || state.done[k] || subOut(p.id, null)) return;
        fire(k, rare({ icon: "🦾 FULL GAME",
          text: (p.name || ("#" + p.id)) + " (" + team + ") played every second of the game (" + Math.round(p.min || 0) + " minutes) · " + (FULL.games.length ? "the " + ord(FULL.games.length + 1) + " full game by any player this season" : "the first full game by any player this season (" + seasonGames + " games before tonight)"),
          statLine: stl([[Math.round(p.min || 0), "MIN"], [p.pts || 0, "PTS"]]), sub: "Command Center · no substitution out in the play-by-play" }));
      });
    });
    // v15: a game state with a record someone looked up over many seasons (tonight.json `situations`), once a game.
    var a0 = Number(game.away && game.away.score) || 0, h0 = Number(game.home && game.home.score) || 0;
    if (live) ((state.tonight && state.tonight.situations) || []).forEach(function (S0) {
      var w = S0.when || {}, perEnd = per <= 4 ? per * QTR : 4 * QTR + (per - 4) * 300, left = perEnd - now, m = Math.abs(a0 - h0);
      if (w.ot && per < 5) return;
      if (w.period && per !== w.period) return;
      if (w.maxLeft != null && left > w.maxLeft) return;
      if (w.minDown != null && m < w.minDown) return;
      if (w.roadMin != null && a0 < w.roadMin) return;
      if (w.homeMax != null && h0 > w.homeMax) return;
      var lead = a0 > h0 ? sides.away : sides.home, trail = a0 > h0 ? sides.home : sides.away;
      var head = w.roadMin != null ? sides.away + " have " + a0 + ", " + sides.home + " have " + h0 : trail + " trail " + lead + " by " + m + (per > 4 ? " in overtime" : " with " + mmss(Math.max(0, left)) + " left in the " + qName(Math.min(per, 4)));
      fire("cc-sit-" + S0.id + "-" + game.id, rare({ icon: "🧮 ALMOST NEVER", text: head + " · " + S0.text, statLine: stl([[m, "MARGIN"]]),
        sub: "Command Center · a record looked up on " + md(S0.asOf) + "/" + String(S0.asOf).slice(2, 4) + ", not counted since" }));
    });
    // 4. Leads: a big lead with each side's season record at that size (v10: from 20, in steps of 5), and a lead lost.
    var L = F.leads || {};
    var a = Number(game.away && game.away.score) || 0, h = Number(game.home && game.home.score) || 0;
    var M = state.maxLead[game.id] || (state.maxLead[game.id] = { away: 0, home: 0 });
    M.away = Math.max(M.away, a - h, Number(game.away && game.away.biggestLead) || 0);
    M.home = Math.max(M.home, h - a, Number(game.home && game.home.biggestLead) || 0);
    // v17: the biggest lead each side has held in the 4th quarter or overtime, from the score at each update there
    // (the first update of the 4th carries the margin it started with).
    if ((Number(game.period) || 0) >= 4 && (a + h) > 0) { M.away4 = Math.max(M.away4 || 0, a - h); M.home4 = Math.max(M.home4 || 0, h - a); }
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
      // A lead lost (v17): the game's biggest lead at any time from LEAD, or a lead of LATE_LEAD+ held in the 4th quarter
      // or overtime. "Losing a 15-point lead in the 4th quarter is noteworthy, just not one that was created in the
      // 1st quarter" (the user, 11/16). One card for both.
      var late = M[side + "4"] || 0;
      if (game.status === "final" && !won && (M[side] >= LEAD || late >= LATE_LEAD)) {
        var bits2 = [];
        if (M[side] >= LEAD) {
          var lost = Math.max(LEAD, Math.floor(M[side] / LEAD_STEP) * LEAD_STEP);   // v10: counted at its own size
          var n = sized(team, "blown", lost).length + 1;
          bits2.push("their " + ord(n) + " lost lead of " + lost + "+ this season" + "; " + other + "'s " + ord(sized(other, "comebacks", lost).length + 1) + " comeback from " + lost + "+ down");
        }
        if (late >= LATE_LEAD) {
          var B = F.by10 || {}, lw = 0, ll = 0;
          Object.keys(B).forEach(function (t) { lw += B[t].lateW || 0; ll += (B[t].lateLost || []).length; });
          var mine = ((B[team] && B[team].lateLost) || []).length;
          bits2.push("led by " + late + " in the 4th quarter" + (lw + ll ? ": before tonight, teams leading by " + LATE_LEAD + "+ in a 4th quarter were " + lw + "-" + ll + " this season" : "") + (mine ? "; " + team + "'s " + ord(mine + 1) + " such loss" : ""));
        }
        fire("cc-blown-" + game.id + "-" + team, base({ type: "clutch", icon: late >= LATE_LEAD ? "📉 4TH-QUARTER LEAD LOST" : "📉 LEAD LOST",
          text: team + " lost a " + M[side] + "-point lead to " + other + " · " + bits2.join(" · "),
          statLine: late >= LATE_LEAD ? stl([[late, "4TH-QTR LEAD LOST"]]) : stl([[M[side], "LEAD LOST"]]), sub: "Command Center · Game Flow files" + through }));
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
    fire("cc-foulwatch-" + game.id, { type: "streak", icon: "⚠️ FOUL WATCH",
      text: who.map(function (f) { return f.name + " (" + f.team + ") early foul trouble in " + f.trouble + " of " + f.gp + (f.out ? ", fouled out " + f.out + "x" : ""); }).join(" · "),
      sub: "Command Center · fouls above the period number (2 in the 1st, 3 by the half…) this season, from the Game Flow files",
      live: false, gameId: game.id, gameTag: tag, gameScore: "Pre-game" });
  }
  function placeOnList(list, v) { return (list || []).filter(function (x) { return x.pts > v; }).length + 1; }

  // NBA Live updates a card in place when its key repeats; count distinct cards, not calls.
  function fire(key, card) {
    if (state.done[key]) return;            // a card ended for good (a rotation card once he came back)
    // v20 (the user, 11/16, on v19's blanket rule: "I don't want the first alert to be stuck in the queue even as the
    // player is scoring more points... tell me you didn't completely override the guideline"): NBA Live's own rule
    // stands. A card whose text or numbers change is re-stamped to the player's latest play and moves up: a countdown
    // getting closer, a record chase, a quarter still growing. Only a card marked `hold` (something that happened at
    // one moment and whose small print merely ticks: a starter still on the bench) keeps the time it first fired,
    // and only while its label is the same. v19 had done that to every Command Center card.
    var ex = typeof ALERT_STORIES !== "undefined" && ALERT_STORIES.get(key);
    var label = function (x) { return String(x || "").replace(/[\d,]+/g, "#"); };
    if (card && card.hold) {
      var held = ex && card.t == null && card.wt == null && label(ex.icon) === label(card.icon);
      card = Object.assign({}, card, held ? { t: ex.t, wt: ex.wt } : {}); delete card.hold;
    }
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
