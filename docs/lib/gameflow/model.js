/*
 * Game Flow's model: shot geometry, clock helpers and the stint reconstruction
 * (buildStints), moved out of docs/gameflow.html (0.59.0) so the page and the nightly
 * build (scripts/flowstats.js) run the same code. Browser-safe: no Node imports.
 * Copied to docs/lib/gameflow/model.js by src/site/build.js.
 */
"use strict";
export const REG_LEN = 720, OT_LEN = 300;      // NBA: 12-min quarters (720s), 5-min OT (300s)
/* A run has to clear this margin to be worth drawing. RUN_ALLOW is how many opposing
   baskets the "near" definition tolerates; SWING_CAP bounds the capped-swing window,
   which is the whole point of it. */
export const RUN_MIN = 8, RUN_ALLOW = 1, SWING_CAP = 240;          // NBA: 12-min quarters, 5-min OT
export const plen = p => p <= 4 ? REG_LEN : OT_LEN;

export function clockSec(c){
  if(!c) return 0;
  const m = /PT(\d+)M([\d.]+)S/.exec(c);
  return m ? (+m[1])*60 + parseFloat(m[2]) : 0;
}
// "PT28M29.00S" -> minutes (float)
export function minVal(s){
  if(!s) return 0;
  const m = /PT(\d+)M([\d.]+)S/.exec(s);
  return m ? (+m[1]) + parseFloat(m[2])/60 : 0;
}
export const mmss = s => Math.floor(s/60) + ":" + String(Math.round(s%60)).padStart(2,"0");

/* ==================== shot geometry ====================
 * Court space, verified against the feed rather than assumed. ESPN gives every shot
 * a coordinate {x,y}: x is feet across a 50-foot court, y is feet out from the
 * baseline, and both teams' shots are normalised to one attacking end. The hoop sits
 * at (25, 0) in that space — not at the physical 5.25ft from the baseline. Checked by
 * comparing hypot(x-25, y) against the distance ESPN states in its own play text:
 *
 *   22-foot corner three at (2,-1)  -> 23.0ft   (+1.0)
 *   4-foot turnaround    at (29,1)  ->  4.1ft   (+0.1)
 *   2-foot driving layup at (23,2)  ->  2.8ft   (+0.8)
 *   3-foot layup         at (27,2)  ->  2.8ft   (-0.2)
 *
 * Mean absolute error 0.54ft, which is what 1-foot integer rounding of both the
 * coordinate and the stated distance would produce. Assuming the physical hoop
 * position instead gives a uniform +1.8ft bias, so (25,0) is the right origin.
 *
 * That sample was pulled from ESPN's WNBA feed during the original build. ESPN
 * serves NBA and WNBA play-by-play through the same coordinate schema, so the
 * (25,0) origin should carry over unchanged — but it hasn't been re-measured
 * against real NBA play text, and this file (running offline) can't fetch a
 * live game to check. Worth re-running this same comparison — a handful of
 * "makes N-foot ___" plays against their coordinates — the first time this is
 * pointed at a real NBA game.
 *
 * Missing coordinates are the Int32 sentinel, not zero — a shot at (0,0) would
 * otherwise read as a 25-foot attempt from the corner.
 */
export const HOOP_X = 25, HOOP_Y = 0;
export const COURT_W = 50, COURT_L = 94, HOOP_INSET = 5.25;
/* Canonical space, used everywhere downstream: sx feet across from the hoop
   (negative left), sy feet out from the hoop's plane. A shot is believed only if it
   lands on or near a half court — ESPN writes {x:-214748340,...} for "no location",
   and validating against the court catches that plus any other garbage without
   depending on one magic number. */
export const SPOT_SX = [-30, 30], SPOT_SY = [-8, 50];
/* NBA line: 23'9" (23.75ft) arc, 22ft corners. The straight corner segment runs
   from the baseline until it meets the arc, which is what fixes its length.
   (Ported from a WNBA build, where this was 22.15ft / 21.67ft — the WNBA and NBA
   arcs differ, so this is the one geometry constant that had to change on fact
   rather than on a find-and-replace.) */
export const ARC_R = 23.75, CORNER_D = 22;
export const CORNER_Y = Math.sqrt(Math.max(0, ARC_R*ARC_R - CORNER_D*CORNER_D));

export const onCourt = (sx,sy) => sx>=SPOT_SX[0] && sx<=SPOT_SX[1]
                        && sy>=SPOT_SY[0] && sy<=SPOT_SY[1];
export const hasSpot = a => Number.isFinite(a.sx) && Number.isFinite(a.sy) && onCourt(a.sx,a.sy);
export const spotDist = a => hasSpot(a) ? Math.hypot(a.sx, a.sy) : null;

/* The two feeds mean different things by x and y, which is the whole reason this
   exists. Measured against each feed's own stated distance:
 *
 * ESPN — x is feet across a 50ft court, y is feet out from the baseline, and both
 * teams are already folded onto one attacking end. The hoop sits at (25, 0), not at
 * its physical 5.25ft inset: assuming the physical spot leaves a uniform +1.8ft bias.
 *
 * League feed — x is percent along the 94ft length, y is percent across the 50ft
 * width, and shots are NOT folded; a shot at one basket reads y≈18 and at the other
 * y≈68. Checked against its own shotDistance field:
 *     Left Corner 3      (94.47, 4.14)  -> 22.93 vs stated 22.94
 *     Above the Break 3  (71.07, 17.80) -> 27.22 vs stated 27.67
 *     Above the Break 3  (29.11, 68.02) -> 23.88 vs stated 24.39
 * The corner shot lands exact and the two above-the-break shots fall ~0.5ft short,
 * so the published x/y are slightly coarser than the distance computed from them.
 * That is why shotDistance is preferred for the average and the coordinate is used
 * only to place the dot, where half a foot cannot be seen.
 *
 * (Those three rows are WNBA plays from the original build. The league feed's
 * percent-of-court convention is a schema fact, not a WNBA fact, so the conversion
 * math is unchanged — but re-run this same spot-check against a few real NBA plays
 * before trusting the "0.01ft" precision claim above for this league.)
 */
export function canonSpot(a){
  if(!Number.isFinite(+a.x) || !Number.isFinite(+a.y)) return {};
  const x=+a.x, y=+a.y;
  // percent-of-court can exceed the ESPN range, which is what tells the two apart
  const pct = Number.isFinite(a.shotDistance) || x>COURT_W || y>COURT_W;
  let sx, sy;
  if(pct){
    const along=(x/100)*COURT_L, across=(y/100)*COURT_W;
    const near = Math.abs(along-HOOP_INSET) <= Math.abs(along-(COURT_L-HOOP_INSET));
    sy = Math.abs(along - (near? HOOP_INSET : COURT_L-HOOP_INSET));
    sx = (across - COURT_W/2) * (near? 1 : -1);
  }else{
    sx = x - HOOP_X; sy = y - HOOP_Y;
  }
  return onCourt(sx,sy) ? {sx, sy} : {};
}

/** The distance the feed states in words: "makes 26-foot three point jumper". */
export function statedDist(a){
  const m=/(\d+)[-\s]foot/i.exec(a.description||"");
  return m ? +m[1] : null;
}
/** Explicit numeric field, stated text, then the coordinate — best signal first. */
export function shotDist(a){
  if(Number.isFinite(a.shotDistance)) return {ft:a.shotDistance, from:"field"};
  const s=statedDist(a);
  if(s!=null) return {ft:s, from:"text"};
  const c=spotDist(a);
  return c!=null ? {ft:c, from:"spot"} : null;
}

export function boxLine(st){
  const g=k=>{ const v=(st||{})[k]; const n=typeof v==="string"? parseInt(v,10) : v;
    return Number.isFinite(n)? n : 0; };
  return {min:minVal((st||{}).minutes), pts:g("points"), reb:g("reboundsTotal"),
          ast:g("assists"), stl:g("steals"), blk:g("blocks"), to:g("turnovers"),
          fgm:g("fieldGoalsMade"), fga:g("fieldGoalsAttempted"),
          tpm:g("threePointersMade"), tpa:g("threePointersAttempted"),
          ftm:g("freeThrowsMade"), fta:g("freeThrowsAttempted"),
          pf:g("foulsPersonal"), pm:g("plusMinusPoints")};
}


/* ==================== stint reconstruction ==================== */
/**
 * Rebuilds who was on the floor at every moment from the substitution log.
 *
 * The feed logs SUB in/out but never states period-opening lineups, so for each
 * period we (1) mark players *proven* on-court at the tip (they act, or are subbed
 * out, before their first SUB in), (2) fill the remaining slots with players who
 * cannot be proven off-court, ranked so that nobody's running total overshoots
 * their box-score minutes, preferring whoever finished the prior period.
 */
export function buildStints(pbp, box, opts = {}){
  const MIN_TOL = opts.minTol != null ? opts.minTol : 0.6;  // see the page: ESPN publishes whole minutes
  const acts = pbp.game.actions.slice().sort((x,y)=>x.orderNumber-y.orderNumber);
  /* Put every shot into one coordinate space before anything reads it. The two feeds
     do not agree on what x and y mean — see canonSpot — and the ESPN path already
     wrote its own, so this only has to handle actions that arrived raw from the
     league feed. Without it, a league-feed percentage gets read as ESPN feet. */
  for(const a of acts) if(a.sx===undefined) Object.assign(a, canonSpot(a));
  acts.forEach((a,i)=>a._i=i);

  const teams = [box.game.awayTeam, box.game.homeTeam];
  const maxP  = Math.max(...acts.map(a=>a.period||1));
  const scheduled = Array.from({length:maxP},(_,k)=>plen(k+1)).reduce((a,b)=>a+b,0);

  // absolute elapsed time for every action
  const off = {}; let acc=0;
  for(let p=1;p<=maxP;p++){ off[p]=acc; acc+=plen(p); }
  acts.forEach(a=>{ const p=a.period||1; a._t = off[p] + (plen(p) - clockSec(a.clock)); });

  /* A game in progress must not be charted out to the end of the current quarter —
     that would invent minutes for whoever happens to be on the floor. Everything
     is clamped to the last play on record, and the chart simply stops there. */
  const finalized = box.game.gameStatus===3;
  const lastPlayT = acts.length ? Math.max(...acts.map(a=>a._t)) : 0;
  const total = finalized ? scheduled : Math.min(scheduled, lastPlayT);
  const endOf = p => Math.min(off[p]+plen(p), total);

  // ---- players ----
  const P = new Map();   // personId -> player record
  teams.forEach((tm,ti)=>{
    (tm.players||[]).forEach(pl=>{
      P.set(pl.personId, {
        id:pl.personId, tri:tm.teamTricode, teamId:tm.teamId, side:ti, // 0 away, 1 home
        name:pl.name, nameI:pl.nameI, jersey:pl.jerseyNum,
        starter:pl.starter==="1", played:pl.played==="1",
        boxMin:minVal(pl.statistics && pl.statistics.minutes),
        boxPts:(pl.statistics||{}).points||0,
        line:boxLine(pl.statistics),
        boxPM:(pl.statistics||{}).plusMinusPoints||0,
        boxPF:(pl.statistics||{}).foulsPersonal,
        boxAst:(pl.statistics||{}).assists,
        dnp:pl.notPlayingReason||null,
        stints:[], calcMin:0, calcPts:0, fouls:[],
      });
    });
  });

  // ---- running score by action index ----
  let sh=0, sa=0;
  const scoreAt = new Array(acts.length+1);
  for(const a of acts){
    scoreAt[a._i] = [sh,sa];                       // score *before* this action
    if(a.scoreHome!=null) sh = +a.scoreHome;
    if(a.scoreAway!=null) sa = +a.scoreAway;
  }
  scoreAt[acts.length] = [sh,sa];
  const diff = i => { const s = scoreAt[Math.min(i,acts.length)]; return s[0]-s[1]; };

  // ---- scoring events (for per-stint points and the flow line) ----
  const madePts = a => {
    if(a.shotResult!=="Made") return 0;
    if(a.actionType==="2pt") return 2;
    if(a.actionType==="3pt") return 3;
    if(a.actionType==="freethrow") return 1;
    return 0;
  };

  // ---- per-period action index ----
  const byPeriod = Array.from({length:maxP+1},()=>[]);
  acts.forEach(a=>byPeriod[a.period||1].push(a));

  const isSub = a => a.actionType==="substitution";
  // events that prove a player was physically on the floor
  const onFloorEvt = a => !!a.personId && !isSub(a) &&
        a.actionType!=="period" && a.actionType!=="game" && a.actionType!=="timeout";

  let prevEnd = [new Set(), new Set()];
  const openers = [];                 // per period, per side: array of ids

  for(let p=1;p<=maxP;p++){
    const A = byPeriod[p];
    const pStartIdx = A.length ? A[0]._i : 0;
    const pEndIdx   = A.length ? A[A.length-1]._i + 1 : 0;
    const opener = [new Set(), new Set()];

    for(let side=0; side<2; side++){
      const tid = teams[side].teamId;
      const roster = [...P.values()].filter(x=>x.side===side);
      const firstIn={}, firstAny={}, outsAfterNoIn={};
      for(const a of A){
        const pl = P.get(a.personId); if(!pl || pl.side!==side) continue;
        if(isSub(a)){
          if(a.subType==="in"  && firstIn[pl.id]==null) firstIn[pl.id]=a._i;
          if(a.subType==="out" && firstAny[pl.id]==null) firstAny[pl.id]=a._i;
        }else if(onFloorEvt(a)){
          if(firstAny[pl.id]==null) firstAny[pl.id]=a._i;
        }
      }
      const proven=[], excluded=new Set();
      for(const pl of roster){
        const fi=firstIn[pl.id], fa=firstAny[pl.id];
        if(fa!=null && (fi==null || fa<fi)) proven.push(pl.id);
        else if(fi!=null) excluded.add(pl.id);
        else if(!pl.played) excluded.add(pl.id);
      }

      if(p===1){
        roster.filter(x=>x.starter).forEach(x=>opener[side].add(x.id));
      }else{
        proven.forEach(id=>opener[side].add(id));
        const need = 5 - opener[side].size;
        if(need>0){
          // minutes each candidate would log if they opened this period
          const contrib = id => {
            const outIdx = (A.find(a=>a.personId===id && isSub(a) && a.subType==="out")||{})._i;
            const endT = outIdx!=null ? acts[outIdx]._t : endOf(p);
            return (endT - off[p])/60;
          };
          const cand = roster
            .filter(x=>!opener[side].has(x.id) && !excluded.has(x.id))
            .map(x=>{
              const c = contrib(x.id);
              const over = Math.max(0, (x.calcMin + c) - (x.boxMin + MIN_TOL));
              return {id:x.id, over, prev:prevEnd[side].has(x.id)?0:1, m:-x.boxMin};
            })
            .sort((u,v)=> u.over-v.over || u.prev-v.prev || u.m-v.m);
          cand.slice(0,need).forEach(c=>opener[side].add(c.id));
        }
      }
      // open stints at the tip
      opener[side].forEach(id=>{
        const pl=P.get(id);
        pl.stints.push({period:p, si:pStartIdx, st:off[p], ei:null, et:null});
      });

      // walk the period
      for(const a of A){
        if(!isSub(a)) continue;
        const pl=P.get(a.personId); if(!pl || pl.side!==side) continue;
        const open = pl.stints.length && pl.stints[pl.stints.length-1].ei==null
                   ? pl.stints[pl.stints.length-1] : null;
        if(a.subType==="out"){
          if(open){ open.ei=a._i; open.et=a._t; }
        }else{
          if(!open) pl.stints.push({period:p, si:a._i, st:a._t, ei:null, et:null});
        }
      }
      // close anything still open at the horn
      for(const pl of roster){
        const last = pl.stints[pl.stints.length-1];
        if(last && last.ei==null){ last.ei=pEndIdx; last.et=endOf(p); }
      }
      // accumulate for the next period's overshoot test
      roster.forEach(pl=>{
        pl.calcMin = pl.stints.reduce((s,x)=>s+(x.et-x.st)/60, 0);
      });
      prevEnd[side] = new Set([...P.values()]
        .filter(x=>x.side===side && x.stints.some(s=>s.period===p && s.et>=endOf(p)-1e-6))
        .map(x=>x.id));
    }
    openers.push(opener);
  }

  /* ---- fouls, for reading why someone's minutes dried up ----
     Six personal fouls disqualifies a player in the NBA. Technicals are counted
     separately and don't move that total, so they're excluded here. The classic
     coaching heuristic for "foul trouble" is fouls > period: two in the first,
     three in the second and so on — early enough that a coach starts protecting
     the player rather than waiting for the sixth. */
  /* ---- assists as passer -> scorer pairs ----
     Only field goals carry an assist; the value of the basket is kept so the same
     matrix can be read as assists or as points created. */
  const assists=[];
  for(const a of acts){
    if(a.actionType!=="2pt" && a.actionType!=="3pt") continue;
    if(a.shotResult!=="Made" || !a.assistPersonId) continue;
    const from=P.get(a.assistPersonId), to=P.get(a.personId);
    if(!from || !to || from.side!==to.side || from.id===to.id) continue;
    assists.push({from:from.id, to:to.id, side:from.side,
                  pts:(a.actionType==="3pt"?3:2), t:a._t});
  }
  for(const pl of P.values()){
    pl.calcAst = assists.filter(x=>x.from===pl.id).length;
    pl.astPts  = assists.filter(x=>x.from===pl.id).reduce((s,x)=>s+x.pts,0);
  }

  const FOUL_LIMIT = 6;
  const isTechnical = a => /technical/i.test((a.subType||"")+" "+(a.description||""));
  for(const a of acts){
    if(a.actionType!=="foul" || isTechnical(a)) continue;
    const pl=P.get(a.personId); if(!pl) continue;
    pl.fouls.push({n:pl.fouls.length+1, t:a._t, i:a._i, period:a.period,
                   kind:(a.subType||"foul")});
  }
  for(const pl of P.values()){
    pl.foulCount = pl.fouls.length;
    pl.fouledOut = pl.foulCount >= FOUL_LIMIT;
    // first moment the foul count ran ahead of the period
    const early = pl.fouls.find(f=>f.n > f.period);
    pl.troubleFrom = early ? early : null;
  }

  // merge zero-gap stints (sub out then straight back in, or period seams)
  for(const pl of P.values()){
    const m=[];
    for(const s of pl.stints){
      const last=m[m.length-1];
      if(last && Math.abs(last.et - s.st)<1e-6) { last.et=s.et; last.ei=s.ei; }
      else m.push({...s});
    }
    pl.stints=m;
    pl.calcMin = m.reduce((a,s)=>a+(s.et-s.st)/60,0);
  }

  /* Official scoring credits free throws to whoever was on the floor when the foul
     was called, but the feed logs the substitution *before* the free throws. So for
     plus-minus we push a substitution boundary past any free throws (and the rebound
     of a missed one) that still belong to the previous dead ball. In the original
     WNBA build this was verified against every 2026 box score, lifting agreement
     from 92% to 99.1% of player-games; the fix itself is source-agnostic, but that
     figure hasn't been re-measured against NBA box scores. */
  const SKIP = new Set(["substitution","freethrow","timeout"]);
  function ftBoundary(i){
    let j=i;
    while(j<acts.length){
      const a=acts[j];
      if(SKIP.has(a.actionType)){ j++; continue; }
      if(a.actionType==="rebound"){
        let k=j+1;
        while(k<acts.length && SKIP.has(acts[k].actionType) && acts[k].actionType!=="freethrow") k++;
        if(k<acts.length && acts[k].actionType==="freethrow" && acts[k].period===a.period){ j++; continue; }
      }
      break;
    }
    return j;
  }
  const pmBound = i => (acts[i] && acts[i].actionType==="substitution") ? ftBoundary(i) : i;

  // per-stint points & plus-minus
  for(const pl of P.values()){
    for(const s of pl.stints){
      s.pm  = (diff(pmBound(s.ei)) - diff(pmBound(s.si))) * (pl.side===1 ? 1 : -1);
      s.pts = 0;
      for(let i=s.si;i<s.ei;i++){
        const a=acts[i];
        if(a.personId===pl.id) s.pts += madePts(a);
      }
    }
    pl.calcPts = pl.stints.reduce((a,s)=>a+s.pts,0);
    pl.calcPM  = pl.stints.reduce((a,s)=>a+s.pm, 0);
  }

  /* Points per period per player — free throws included, because a scoring burst
     is points, not field goals. Across periods these must sum to his box-score
     total, the same identity already checked for stint points. */
  for(const pl of P.values()) pl.ptsByPeriod={};
  for(const a of acts){
    const v=madePts(a); if(!v) continue;
    const pl=P.get(a.personId); if(!pl) continue;
    const p=a.period||1;
    pl.ptsByPeriod[p]=(pl.ptsByPeriod[p]||0)+v;
  }

  /* ---- lineup segments: every distinct 5 on the floor, per team ---- */
  const lineups=[[],[]];
  for(let side=0;side<2;side++){
    const bounds=new Set([0,total]);
    [...P.values()].filter(x=>x.side===side)
      .forEach(x=>x.stints.forEach(s=>{bounds.add(s.st);bounds.add(s.et);}));
    const B=[...bounds].sort((a,b)=>a-b);
    const L=lineups[side];
    const endIdx = t => { let i=acts.findIndex(a=>a._t>t+1e-9); return i<0?acts.length:i; };
    for(let k=0;k<B.length-1;k++){
      const t0=B[k], t1=B[k+1];
      const mid=(t0+t1)/2;
      const on=[...P.values()].filter(x=>x.side===side &&
            x.stints.some(s=>s.st<=mid && s.et>=mid));
      const i1=endIdx(t1);
      const key=on.map(x=>x.id).sort().join(",");
      const prev=L[L.length-1];
      // absorb sub-second slivers (two teammates swapping a beat apart) and repeats
      // into the previous segment so the strip always tiles the full game
      if(prev && (prev.key===key || t1-t0<1.5 || on.length!==5)){
        prev.t1=t1; prev.i1=i1;
        prev.pm=(diff(i1)-diff(prev.i0))*(side===1?1:-1);
        continue;
      }
      let i0=acts.findIndex(a=>a._t>=t0-1e-9); if(i0<0) i0=0;
      L.push({t0,t1,i0,i1,pm:(diff(i1)-diff(i0))*(side===1?1:-1),on,key});
    }
  }

  /* ---- score-flow polyline (home-minus-away over time) ---- */
  const flow=[{t:0,d:0}];
  for(const a of acts){
    if(madePts(a)>0) flow.push({t:a._t, d:(+a.scoreHome)-(+a.scoreAway)});
  }
  flow.push({t:total, d:box.game.homeTeam.score - box.game.awayTeam.score});

  /* ---- scoring runs ----
   * The first version of this maximised the margin swing with no bound on how long the
   * interval could be. For a team that leads wire to wire the largest swing in its favour
   * IS the whole game, so it drew one bar across three quarters labelled with the final
   * score. It also shared its "used" array between the two teams and computed the away
   * side first, which handed the away team first pick of the game.
   *
   * Three definitions now, chosen in the toolbar, each computed per team independently:
   *   unanswered — the opponent scores nothing at all. A true 10-0 run.
   *   near       — at most RUN_ALLOW opposing baskets, so one free throw doesn't kill it.
   *   swing      — margin swing inside a capped window, the old idea with a bound.
   * The largest swing is still computed, but on its own row and called what it is.
   */
  const evts=[];
  for(const a of acts){ const v=madePts(a); if(v>0)
    evts.push({t:a._t, home:String(a.teamId)===String(box.game.homeTeam.teamId), v}); }
  const cum=[0]; evts.forEach(e=>cum.push(cum[cum.length-1] + (e.home? e.v : -e.v)));

  /* Who was ever in front. cum is home minus away and only moves when someone scores, so
     every state the margin ever held is in this array. A tie is not a lead, which is why
     these are strict comparisons and why cum[0] === 0 counts for neither side.
     Two invariants fall out and are asserted in the tests: you cannot win without leading
     at the final whistle, so never-led implies a loss; and never-trailed implies a win,
     because a level finish is impossible. */
  const everLed=[cum.some(v=>v<0), cum.some(v=>v>0)];   // [away, home]

  /* Holding a lead is a separate question from never trailing: a team can fall behind early,
     go ahead, and never be caught. So this walks the margin once per side and records when
     the side first led and what happened after that.
       held        — went ahead and was never behind again. "Never lost the lead."
       heldStrict  — never even level again after going ahead, which is the literal reading
                     of the phrase, since being tied means you are no longer leading.
     Both are reported, because the two readings give different numbers and neither is wrong.
     cum[0] is 0, the tip, and counts as a lead for nobody. */
  function leadFacts(sign){
    let first=-1, behindAfter=false, tiedAfter=false, everBehind=false;
    for(let k=0;k<cum.length;k++){
      const m=cum[k]*sign;
      if(m<0) everBehind=true;
      if(first<0 && m>0){ first=k; continue; }
      if(first>=0){ if(m<0) behindAfter=true; else if(m===0) tiedAfter=true; }
    }
    return {led:first>=0,
            held:first>=0 && !behindAfter,
            heldStrict:first>=0 && !behindAfter && !tiedAfter,
            everTrailed:everBehind};
  }
  const leadState=[leadFacts(-1), leadFacts(1)];   // [away, home]

  /* Walk forwards taking maximal stretches. Each is trimmed to the team's own last score,
     so a run never opens or closes on an opponent basket. */
  function streaks(forHome, allow){
    const out=[]; let i=0;
    while(i<evts.length){
      while(i<evts.length && evts[i].home!==forHome) i++;
      if(i>=evts.length) break;
      let oppSeen=0, j=i, lastMine=i;
      while(j<evts.length){
        const e=evts[j];
        if(e.home===forHome) lastMine=j;
        else { if(oppSeen+1>allow) break; oppSeen++; }
        j++;
      }
      let mine=0, theirs=0;
      for(let k=i;k<=lastMine;k++){ const e=evts[k]; if(e.home===forHome) mine+=e.v; else theirs+=e.v; }
      if(mine-theirs>=RUN_MIN)
        out.push({t0:evts[i].t, t1:evts[lastMine].t, mine, theirs});
      i=lastMine+1;
    }
    return out;
  }

  /* The swing idea, but the window can't exceed SWING_CAP seconds, and `used` is local so
     neither team gets first refusal on the game. */
  function cappedSwings(forHome){
    const out=[], used=new Array(evts.length).fill(false);
    for(let guard=0; guard<8; guard++){
      let best=null;
      for(let i=0;i<evts.length;i++){
        if(used[i]) continue;
        for(let j=i;j<evts.length;j++){
          if(used[j]) break;
          if(evts[j].t-evts[i].t>SWING_CAP) break;
          const d=(cum[j+1]-cum[i])*(forHome?1:-1);
          if(d>=RUN_MIN && (!best || d>best.d || (d===best.d && j-i<best.j-best.i)))
            best={i,j,d};
        }
      }
      if(!best) break;
      let mine=0, theirs=0;
      for(let k=best.i;k<=best.j;k++){ const e=evts[k];
        if(e.home===forHome) mine+=e.v; else theirs+=e.v; }
      out.push({t0:evts[best.i].t, t1:evts[best.j].t, mine, theirs});
      for(let k=best.i;k<=best.j;k++) used[k]=true;
    }
    return out.sort((a,b)=>a.t0-b.t0);
  }

  /** The single largest margin swing, unbounded — reported as a swing, never as a run. */
  function biggestSwing(forHome){
    let best=null;
    for(let i=0;i<cum.length;i++)
      for(let j=i+1;j<cum.length;j++){
        const d=(cum[j]-cum[i])*(forHome?1:-1);
        if(d>0 && (!best || d>best.d)) best={i,j,d};
      }
    if(!best) return null;
    let mine=0, theirs=0;
    for(let k=best.i;k<best.j;k++){ const e=evts[k];
      if(e.home===forHome) mine+=e.v; else theirs+=e.v; }
    return {t0:evts[best.i].t, t1:evts[best.j-1].t, mine, theirs, swing:best.d};
  }

  const runsBy={
    unanswered:[streaks(false,0),          streaks(true,0)],
    near:      [streaks(false,RUN_ALLOW),  streaks(true,RUN_ALLOW)],
    swing:     [cappedSwings(false),       cappedSwings(true)],
  };
  const swings=[biggestSwing(false), biggestSwing(true)];

  /* ---- per-period team stats ---- */
  const per=[[],[]];
  for(let p=1;p<=maxP;p++){
    for(let side=0;side<2;side++){
      const tid=teams[side].teamId;
      const A=byPeriod[p].filter(a=>a.teamId===tid);
      const fga=A.filter(a=>a.actionType==="2pt"||a.actionType==="3pt").length;
      const fgm=A.filter(a=>(a.actionType==="2pt"||a.actionType==="3pt")&&a.shotResult==="Made").length;
      const tpa=A.filter(a=>a.actionType==="3pt").length;
      const tpm=A.filter(a=>a.actionType==="3pt"&&a.shotResult==="Made").length;
      per[side].push({
        p, pts:A.reduce((s,a)=>s+madePts(a),0),
        fga,fgm,tpa,tpm,
        reb:A.filter(a=>a.actionType==="rebound").length,
        ast:byPeriod[p].filter(a=>a.teamId===tid && a.assistPersonId).length,
        to: A.filter(a=>a.actionType==="turnover").length,
      });
    }
  }

  const players=[...P.values()];
  const recon = players.filter(x=>x.played)
    .map(x=>({name:x.name, d:x.calcMin - x.boxMin, dpm:x.calcPM - x.boxPM,
              dast:(x.boxAst==null? 0 : x.calcAst - x.boxAst)}));

  return {acts, players, teams, maxP, total, scheduled, live:!finalized, assists,
          lineups, flow, runsBy, swings, everLed, leadState, per, openers, recon,
          box:box.game, diff};
}

