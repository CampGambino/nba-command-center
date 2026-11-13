/**
 * NBA GameFlow's ESPN reader, moved into the Command Center (stage 1 of the GameFlow merge, 11/13).
 *
 * espnToFeeds is GameFlow 6's own function, unchanged: it rewrites an ESPN game summary into the shape
 * of the league's play-by-play and box-score feeds, which the Game Flow page's reconstruction
 * (buildStints) reads. It is shared here so the nightly build and the page use the same code.
 *
 * compactFeeds / expandFeeds: the nightly build keeps each finished game as a small file
 * (docs/data/flow/<season>/<gameId>.json, ~15 KB instead of ESPN's ~450 KB summary). expandFeeds gives
 * back exactly the fields the page reads: tests/run.js checks the round trip field by field.
 * Browser-safe and pure. Copied to docs/lib/gameflow/feeds.js by the build.
 */
/* ESPN uses its own abbreviations; fold them onto the tricodes above. */
export const ESPN_TRI = {GS:"GSW", NO:"NOP", NY:"NYK", SA:"SAS", UTAH:"UTA", WSH:"WAS"};
export const espnTri = a => ESPN_TRI[a] || a;

const HOOP_X = 25, HOOP_Y = 0;
const COURT_W = 50, COURT_L = 94, HOOP_INSET = 5.25;

const SPOT_SX = [-30, 30], SPOT_SY = [-8, 50];

const onCourt = (sx,sy) => sx>=SPOT_SX[0] && sx<=SPOT_SX[1]
                        && sy>=SPOT_SY[0] && sy<=SPOT_SY[1];

function espnShotSpot(p){
  const c=p.coordinate;
  if(!c || !Number.isFinite(+c.x) || !Number.isFinite(+c.y)) return {};
  // ESPN's own convention, already folded onto one end; canonSpot documents why
  const sx=+c.x - HOOP_X, sy=+c.y - HOOP_Y;
  return onCourt(sx,sy) ? {x:+c.x, y:+c.y, sx, sy} : {};
}

export function espnToFeeds(sum){
  const comp = sum.header.competitions[0];
  const home = comp.competitors.find(c=>c.homeAway==="home");
  const away = comp.competitors.find(c=>c.homeAway==="away");
  const plays = (sum.plays||[]).slice();

  const clockOf = p => {
    const m=/^(\d+):(\d+)(?:\.(\d+))?$/.exec((p.clock&&p.clock.displayValue)||"0:00");
    const mm = m? +m[1] : 0, ss = m? +m[2] : 0;
    return `PT${String(mm).padStart(2,"0")}M${ss.toFixed(2).padStart(5,"0")}S`;
  };
  const T = p => (p.type && p.type.text) || "";
  const parts = p => (p.participants||[]).map(x=>String(x.athlete.id));

  const kindOf = p => {
    const t=T(p);
    if(t==="Substitution") return "substitution";
    if(/^Free Throw/i.test(t)) return "freethrow";
    if(/Rebound/i.test(t)) return "rebound";
    if(/Turnover|Traveling|Shot Clock|Kicked Ball/i.test(t)) return "turnover";
    if(/Foul|Technical/i.test(t)) return "foul";
    if(/Timeout/i.test(t)) return "timeout";
    if(/^End Period$/i.test(t)) return "period";
    if(/^End Game$/i.test(t)) return "game";
    if(/Jumpball/i.test(t)) return "jumpball";
    if(/Review/i.test(t)) return "review";
    if(p.shootingPlay) return (p.pointsAttempted===3 ? "3pt" : "2pt");
    return "other";
  };

  /* Who assisted is read out of the play text ("... (J. Young assists)") and matched
     against the roster by name, rather than trusting the order of `participants`.
     Position is only a fallback. Either way the totals are checked against the box
     score's AST column and reported in the badge. */
  const byName=new Map(), byLast=new Map();
  (sum.boxscore.players||[]).forEach(tb=>{
    const blk=tb.statistics&&tb.statistics[0];
    (blk? blk.athletes:[]).forEach(a=>{
      const id=String(a.athlete.id);
      const full=String(a.athlete.displayName||"").toLowerCase();
      byName.set(full,id);
      const last=full.split(" ").slice(-1)[0];
      if(last) byLast.set(last, byLast.has(last)? null : id);   // null marks ambiguity
    });
  });
  const assisterFrom = (p, ath) => {
    const m=/\(([^)]+?)\s+assists?\)/i.exec(p.text||"");
    if(m){
      const nm=m[1].trim().toLowerCase();
      if(byName.has(nm)) return byName.get(nm);
      const last=nm.split(" ").slice(-1)[0];
      const hit=byLast.get(last);
      if(hit) return hit;
    }
    return ath[1] || undefined;      // fall back to ESPN's ordering
  };

  const actions=[];
  let order=0;
  const push=(p,extra)=>{
    order+=100;
    actions.push({
      orderNumber:order, actionNumber:order/100,
      period:p.period.number, clock:clockOf(p),
      teamId:p.team? String(p.team.id) : undefined,
      scoreHome:String(p.homeScore==null?0:p.homeScore),
      scoreAway:String(p.awayScore==null?0:p.awayScore),
      description:p.text||"", qualifiers:[], ...extra,
    });
  };

  for(const p of plays){
    const kind=kindOf(p), ath=parts(p);
    if(kind==="substitution"){
      // ESPN order is [entering, leaving]; the league feed logs the exit first
      if(ath[1]) push(p,{actionType:"substitution", subType:"out", personId:ath[1]});
      if(ath[0]) push(p,{actionType:"substitution", subType:"in",  personId:ath[0]});
      continue;
    }
    if(kind==="2pt" || kind==="3pt"){
      push(p,{actionType:kind, subType:T(p), personId:ath[0]||0,
              shotResult:p.scoringPlay?"Made":"Missed",
              ...espnShotSpot(p),
              assistPersonId: p.scoringPlay ? assisterFrom(p,ath) : undefined});
      continue;
    }
    if(kind==="freethrow"){
      push(p,{actionType:"freethrow", subType:T(p).replace(/^Free Throw\s*-?\s*/i,""),
              personId:ath[0]||0, shotResult:p.scoringPlay?"Made":"Missed"});
      continue;
    }
    if(kind==="period"){ push(p,{actionType:"period", subType:"end", personId:0}); continue; }
    if(kind==="game"){   push(p,{actionType:"game",   subType:"end", personId:0}); continue; }
    if(kind==="review"){ push(p,{actionType:"timeout",subType:"review", personId:0}); continue; }
    push(p,{actionType:kind, subType:T(p), personId:ath[0]||0});
  }

  const mkTeam = (c) => {
    const tb=(sum.boxscore.players||[]).find(t=>String(t.team.id)===String(c.id));
    const blk=tb && tb.statistics && tb.statistics[0];
    const idx={};
    if(blk) (blk.labels||[]).forEach((l,i)=>idx[l]=i);
    const players=(blk? blk.athletes:[]).map((a,i)=>{
      const st=a.stats||[];
      const num = k => { const v=parseInt(String(st[idx[k]]).replace("+",""),10); return isNaN(v)?0:v; };
      const pair = (k,i) => { const m=/^(\d+)-(\d+)$/.exec(String(st[idx[k]]||"").trim());
        return m? +m[i+1] : 0; };
      const played = !a.didNotPlay && st.length>0;
      return {
        status:"ACTIVE", order:i+1, personId:String(a.athlete.id),
        jerseyNum:a.athlete.jersey||"", starter:a.starter?"1":"0",
        oncourt:"0", played:played?"1":"0",
        notPlayingReason: a.didNotPlay ? (a.reason||"DNP") : undefined,
        name:a.athlete.displayName, nameI:a.athlete.shortName||a.athlete.displayName,
        statistics:{
          // whole minutes is all ESPN publishes, hence the coarser reconciliation
          minutes: played ? `PT${String(num("MIN")).padStart(2,"0")}M00.00S` : "PT00M00.00S",
          points: played? num("PTS") : 0,
          plusMinusPoints: played? num("+/-") : 0,
          foulsPersonal: played? num("PF") : 0,
          assists: played? num("AST") : 0,
          /* Deliberately named the way the league feed names them, so anything reading a
             box line works on either source without knowing which it has. ESPN packs the
             shooting splits as "m-a" strings, hence the pair helper. */
          reboundsTotal: played? num("REB") : 0,
          steals: played? num("STL") : 0,
          blocks: played? num("BLK") : 0,
          turnovers: played? num("TO") : 0,
          fieldGoalsMade: played? pair("FG",0) : 0,
          fieldGoalsAttempted: played? pair("FG",1) : 0,
          threePointersMade: played? pair("3PT",0) : 0,
          threePointersAttempted: played? pair("3PT",1) : 0,
          freeThrowsMade: played? pair("FT",0) : 0,
          freeThrowsAttempted: played? pair("FT",1) : 0,
        },
      };
    });
    return {
      teamId:String(c.id), teamTricode:espnTri(c.team.abbreviation),
      teamCity:c.team.location||"", teamName:c.team.name||c.team.displayName||"",
      score:parseInt(c.score,10)||0, players, statistics:{},
    };
  };

  const venue=(sum.gameInfo&&sum.gameInfo.venue)||{};
  return {
    pbp:{ meta:{}, game:{ gameId:String(comp.id), actions } },
    box:{ meta:{}, game:{
      gameId:String(comp.id),
      gameTimeLocal:comp.date, gameStatusText:(comp.status&&comp.status.type&&comp.status.type.detail)||"Final",
      gameStatus:3, regulationPeriods:4,
      attendance:(sum.gameInfo&&sum.gameInfo.attendance)||0,
      arena:{ arenaName:venue.fullName||"", arenaCity:(venue.address&&venue.address.city)||"",
              arenaState:(venue.address&&venue.address.state)||"" },
      homeTeam:mkTeam(home), awayTeam:mkTeam(away),
    }},
  };
}

/* ==================== compact game files ==================== */
export const FLOW_VERSION = 1;
const STAT_KEYS = ["points", "plusMinusPoints", "foulsPersonal", "assists", "reboundsTotal", "steals", "blocks", "turnovers",
  "fieldGoalsMade", "fieldGoalsAttempted", "threePointersMade", "threePointersAttempted", "freeThrowsMade", "freeThrowsAttempted"];
const clockNum = (c) => { const m = /PT(\d+)M([\d.]+)S/.exec(c || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
const clockStr = (v) => { const mm = Math.floor(v / 60), ss = v - mm * 60; return `PT${String(mm).padStart(2, "0")}M${ss.toFixed(2).padStart(5, "0")}S`; };
const minNum = (s) => { const m = /PT(\d+)M/.exec(s || ""); return m ? Number(m[1]) : 0; };

/**
 * {pbp, box} from espnToFeeds -> a compact game: { v, id, g: game header, t: [away, home] teams, d: [types], s: [subtypes], a: [actions] }.
 * An action is [period, clock seconds left, team (0 away, 1 home, or the raw id), type, subtype, person, result (1 made, 0 missed),
 * home score, away score, x, y, assister, stated distance (shots) or 1 (technical foul)].
 * Kept: everything the Game Flow page reads. Dropped: play text, except a shot's stated distance ("26-foot") and whether
 * a foul was a technical, the only two things the page reads out of it.
 */
export function compactFeeds({ pbp, box }) {
  const G = box.game, teams = [G.awayTeam, G.homeTeam];
  const types = [], subs = [], ti = (list, v) => { let i = list.indexOf(v); if (i < 0) { list.push(v); i = list.length - 1; } return i; };
  const teamIx = (id) => (id == null ? null : id === teams[0].teamId ? 0 : id === teams[1].teamId ? 1 : String(id));
  const a = pbp.game.actions.map((x) => {
    const shot = x.actionType === "2pt" || x.actionType === "3pt";
    const dist = shot ? (/(\d+)[-\s]foot/i.exec(x.description || "") || [])[1] : null;
    const tech = x.actionType === "foul" && /technical/i.test(x.description || "") ? 1 : null;
    const row = [x.period, clockNum(x.clock), teamIx(x.teamId), ti(types, x.actionType), ti(subs, x.subType ?? ""), x.personId ?? 0,
      x.shotResult === "Made" ? 1 : x.shotResult === "Missed" ? 0 : null, Number(x.scoreHome), Number(x.scoreAway),
      x.x ?? null, x.y ?? null, x.assistPersonId ?? null, dist != null ? Number(dist) : tech];
    while (row.length > 9 && row[row.length - 1] == null) row.pop();
    return row;
  });
  const team = (t) => ({ id: t.teamId, tri: t.teamTricode, city: t.teamCity, name: t.teamName, score: t.score,
    p: t.players.map((p) => [p.personId, p.jerseyNum, p.starter === "1" ? 1 : 0, p.played === "1" ? 1 : 0, p.notPlayingReason ?? null, p.name, p.nameI,
      minNum(p.statistics.minutes), ...STAT_KEYS.map((k) => p.statistics[k] ?? 0)]) });
  return { v: FLOW_VERSION, id: G.gameId, g: { time: G.gameTimeLocal, status: G.gameStatusText, att: G.attendance, arena: [G.arena.arenaName, G.arena.arenaCity, G.arena.arenaState] },
    t: teams.map(team), d: types, s: subs, a };
}

/** The compact game back into {pbp, box}, the shape espnToFeeds returns. */
export function expandFeeds(c) {
  const teams = c.t;
  let order = 0;
  const actions = c.a.map((r) => {
    const [period, clk, tm, ty, st, person, res, sh, sa, x, y, ast, extra] = r;
    const actionType = c.d[ty], subType = c.s[st];
    order += 100;
    const shot = actionType === "2pt" || actionType === "3pt";
    const out = { orderNumber: order, actionNumber: order / 100, period, clock: clockStr(clk),
      teamId: tm == null ? undefined : tm === 0 || tm === 1 ? teams[tm].id : tm,
      scoreHome: String(sh), scoreAway: String(sa),
      description: shot && extra != null ? `${extra}-foot` : actionType === "foul" && extra === 1 ? "technical" : "", qualifiers: [],
      actionType, subType, personId: person };
    if (res != null) out.shotResult = res ? "Made" : "Missed";
    if (shot) {
      if (x != null && y != null) Object.assign(out, { x, y, sx: x - 25, sy: y });
      out.assistPersonId = ast ?? undefined;
    }
    return out;
  });
  const mkTeam = (t) => ({ teamId: t.id, teamTricode: t.tri, teamCity: t.city, teamName: t.name, score: t.score, statistics: {},
    players: t.p.map((p, i) => {
      const [personId, jerseyNum, starter, played, why, name, nameI, min, ...s] = p;
      return { status: "ACTIVE", order: i + 1, personId, jerseyNum, starter: starter ? "1" : "0", oncourt: "0", played: played ? "1" : "0",
        notPlayingReason: why ?? undefined, name, nameI,
        statistics: { minutes: played ? `PT${String(min).padStart(2, "0")}M00.00S` : "PT00M00.00S", ...Object.fromEntries(STAT_KEYS.map((k, j) => [k, s[j]])) } };
    }) });
  return {
    pbp: { meta: {}, game: { gameId: c.id, actions } },
    box: { meta: {}, game: { gameId: c.id, gameTimeLocal: c.g.time, gameStatusText: c.g.status, gameStatus: 3, regulationPeriods: 4, attendance: c.g.att,
      arena: { arenaName: c.g.arena[0], arenaCity: c.g.arena[1], arenaState: c.g.arena[2] }, homeTeam: mkTeam(teams[1]), awayTeam: mkTeam(teams[0]) } },
  };
}
