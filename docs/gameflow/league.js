/* Moved out of docs/gameflow.js unchanged (0.141.16: the Game Flow script split by section). */
import { franchises, modelFor, teamGamesFor } from "./models.js";
import { boxLine } from "../lib/gameflow/model.js";

/* ==================== league-wide game reads ====================
 * One pass over the season that every one of the three sections below draws on:
 *   - opposing players who reached 30 in a game, credited to the defense
 *   - the team totals a possession estimate needs
 *   - each player's points game by game, with the opponent attached
 * Read once, shared, and cached with every other view through modelFor.
 */
const THIRTY_PT = 30;
export const DEF_TOP_N = 5;
/** Possessions, estimated. Neither feed publishes them; this is the standard form. */
const possOf = t => t.fga - t.oreb + t.tov + 0.44*t.fta;

export async function buildLeague(limit, onProgress){
  const tris=franchises();
  const slate=[];
  const seen=new Set();
  for(const t of tris) (limit>0? teamGamesFor(t).slice(-limit) : teamGamesFor(t))
    .forEach(g=>{ if(!seen.has(g.gameId)){ seen.add(g.gameId); slate.push(g); } });

  const team=new Map();        // tri -> defensive and offensive totals
  const big=[];                // every 30-point game, credited to the defense
  const player=new Map();      // id -> {name, tri, games:[{opp,pts,date,line}]}
  const appear=new Map();      // gameId -> Set of ids who actually played, both teams
  /* Enough per game to answer on/off questions later without re-reading anything: each
     player's stints as intervals, and every event that can be attributed to a player.
     Steals and blocks are deliberately absent — the league feed carries them as a field on
     someone else's action rather than as their own, and ESPN's normalised shape does not
     preserve them, so counting them here would be guesswork. */
  const frames=[];
  const teamGames=[];         // one row per team per game, for the rest splits
  let done=0, failed=0;
  const T=t=>{ let r=team.get(t);
    if(!r){ r={tri:t, gp:0, pf:0, pa:0, fga:0, fta:0, tov:0, oreb:0,
               ofga:0, ofta:0, otov:0, ooreb:0, allowed30:0, neverLed:0, neverTrailed:0, held:0, heldStrict:0,
               blown10:0, comeback10:0, bigBlown:null, bigComeback:null}; team.set(t,r); }
    return r; };

  const queue=slate.slice();
  const worker=async()=>{
    while(queue.length){
      const g=queue.shift();
      try{
        const G=await modelFor(g);
        const tri=[G.box.awayTeam.teamTricode, G.box.homeTeam.teamTricode];
        const box=[G.box.awayTeam, G.box.homeTeam];
        // one lookup map per game, not a linear scan per action
        const byId=new Map(G.players.map(p=>[p.id,p]));
        const tally=[0,1].map(side=>{
          /* Makes as well as attempts now: the rest section reports shooting per bucket, and
             taking it from the same actions as the possession estimate keeps one row of
             numbers from mixing two sources. */
          const c={fga:0, fgm:0, tpa:0, tpm:0, fta:0, tov:0, oreb:0};
          for(const a of G.acts){
            const pl=byId.get(a.personId);
            const sd=pl? pl.side : (String(a.teamId)===String(box[side].teamId)? side : -1);
            if(sd!==side) continue;
            if(a.actionType==="2pt"||a.actionType==="3pt"){
              c.fga++;
              if(a.shotResult==="Made") c.fgm++;
              if(a.actionType==="3pt"){ c.tpa++; if(a.shotResult==="Made") c.tpm++; }
            }
            else if(a.actionType==="freethrow") c.fta++;
            else if(a.actionType==="turnover") c.tov++;
            else if(a.actionType==="rebound" && /off/i.test(a.subType||"")) c.oreb++;
          }
          return c;
        });
        const pts=[+box[0].score||0, +box[1].score||0];
        /* One row per team-game, kept alongside the season totals. The rest section needs to
           group games rather than read a season sum, and nothing else in the aggregate can
           be re-split after the fact. */
        [0,1].forEach(side=>{
          const op=1-side;
          teamGames.push({gameId:g.gameId, date:g.date, tri:tri[side], opp:tri[op],
            home:side===1, pts:pts[side], oppPts:pts[op],
            decided:pts[side]!==pts[op], win:pts[side]>pts[op],
            ...tally[side], poss:possOf(tally[side])});
        });
        [0,1].forEach(side=>{
          const me=T(tri[side]), op=1-side;
          /* Never trailed means the OTHER side never led, which is why this reads the
             opponent's flag rather than negating its own. */
          if(G.everLed && !G.everLed[side]) me.neverLed++;
          if(G.everLed && !G.everLed[op]) me.neverTrailed++;
          const ls=G.leadState && G.leadState[side];
          if(ls && ls.held) me.held++;
          if(ls && ls.heldStrict) me.heldStrict++;
          /* Blown leads and comebacks (the user, 11/13): the biggest lead and deficit this side had, from the
             margin after every basket (home minus away), against how the game ended. */
          const sign = side===1? 1 : -1;
          const ms = (G.flow||[]).map(f=>f.d*sign);
          const maxLead = Math.max(0, ...ms), maxDef = Math.max(0, ...ms.map(v=>-v));
          const won = pts[side]>pts[op];
          const vs = {opp:tri[op], date:g.date, home:side===1, score:`${pts[side]}-${pts[op]}`};
          if(!won && maxLead>=10){ me.blown10++; if(!me.bigBlown || maxLead>me.bigBlown.n) me.bigBlown={n:maxLead, ...vs}; }
          if(won && maxDef>=10){ me.comeback10++; if(!me.bigComeback || maxDef>me.bigComeback.n) me.bigComeback={n:maxDef, ...vs}; }
          me.gp++; me.pf+=pts[side]; me.pa+=pts[op];
          me.fga+=tally[side].fga; me.fta+=tally[side].fta;
          me.tov+=tally[side].tov; me.oreb+=tally[side].oreb;
          me.ofga+=tally[op].fga;  me.ofta+=tally[op].fta;
          me.otov+=tally[op].tov;  me.ooreb+=tally[op].oreb;
        });
        /* Both rosters on purpose: every player's opponent is the other side, which is
           derived from pl.side rather than assumed. */
        for(const pl of G.players){
          if(!pl.played) continue;
          const opp=tri[1-pl.side];
          /* Keyed by String(id): the league feed hands out numeric person ids, ESPN string
             ones, and a <select> value is always a string. One key type or the pickers
             silently look up nothing. */
          const pid=String(pl.id);
          let pr=player.get(pid);
          if(!pr){ pr={id:pid, name:pl.name, tri:pl.tri, seen:g.date, games:[]};
                   player.set(pid,pr); }
          if(new Date(g.date)>=new Date(pr.seen)){ pr.name=pl.name; pr.tri=pl.tri;
                                                   pr.seen=g.date; }
          pr.games.push({opp, tri:pl.tri, pts:pl.boxPts||0, date:g.date, gameId:g.gameId,
                         home:pl.side===1, line:pl.line||boxLine(null)});
          let ap=appear.get(g.gameId);
          if(!ap){ ap=new Set(); appear.set(g.gameId,ap); }
          ap.add(pid);
          if((pl.boxPts||0)>=THIRTY_PT){
            T(opp).allowed30++;
            big.push({name:pl.name, id:pl.id, tri:pl.tri, against:opp,
                      pts:pl.boxPts, date:g.date, gameId:g.gameId,
                      home:pl.side===1});
          }
        }
        const iv={}, ev=[];
        /* Who was on which roster this game, whether he played or not. This is what makes a
           mid-season trade tractable: without it, every game before the move looks like a
           game "without" the new teammate, when the two were never teammates at all. */
        const team={};
        for(const pl of G.players) team[String(pl.id)]=pl.tri;
        // both rosters on purpose: on/off needs the opponent's stints too
        for(const pl of G.players){
          if(!pl.played) continue;
          iv[String(pl.id)]=(pl.stints||[])
            .filter(st=>st.et!=null && st.et>st.st).map(st=>[st.st, st.et]);
        }
        const sideById=new Map(G.players.map(pl=>[pl.id, pl.side]));  // id -> side lookup
        for(const a of G.acts){
          const side=sideById.has(a.personId)? sideById.get(a.personId) : null;
          const v=a.actionType==="3pt"?3 : a.actionType==="2pt"?2
                : a.actionType==="freethrow"?1 : 0;
          const made=a.shotResult==="Made";
          if(v && made) ev.push({t:a._t, pid:String(a.personId), side, k:"pts", v});
          if(a.actionType==="2pt"||a.actionType==="3pt")
            ev.push({t:a._t, pid:String(a.personId), side,
                     k:made?"fgm":"fga0", v:a.actionType==="3pt"?3:2});
          if(a.actionType==="freethrow")
            ev.push({t:a._t, pid:String(a.personId), side, k:made?"ftm":"fta0", v:1});
          if(made && a.assistPersonId)
            ev.push({t:a._t, pid:String(a.assistPersonId), side, k:"ast", v:1});
          if(a.actionType==="rebound" && a.personId)
            ev.push({t:a._t, pid:String(a.personId), side, k:"reb", v:1});
          if(a.actionType==="turnover" && a.personId)
            ev.push({t:a._t, pid:String(a.personId), side, k:"to", v:1});
        }
        frames.push({gameId:g.gameId, date:g.date, tri, total:G.total, iv, ev, team});
      }catch(e){ failed++; }
      done++;
      if(onProgress) onProgress(done, slate.length);
    }
  };
  await Promise.all(Array.from({length:Math.min(10,slate.length)},worker));   // 10 at a time: files on this site are small

  const teams=[...team.values()].map(r=>({...r,
    poss:possOf({fga:r.fga, oreb:r.oreb, tov:r.tov, fta:r.fta}),
    oposs:possOf({fga:r.ofga, oreb:r.ooreb, tov:r.otov, fta:r.ofta})}))
    .map(r=>({...r,
      /* Defensive efficiency: points allowed per 100 of the opponent's possessions.
         Possessions are estimated, so this is close to but not identical with a
         provider's published figure. */
      dre: r.oposs>0 ? 100*r.pa/r.oposs : null,
      ore: r.poss>0  ? 100*r.pf/r.poss  : null,
      paPg: r.gp? r.pa/r.gp : null}));
  teams.sort((a,b)=>(a.dre??1e9)-(b.dre??1e9));
  return {teams, big:big.sort((a,b)=>b.pts-a.pts || new Date(a.date)-new Date(b.date)),
          player, appear, frames, teamGames,
          frameBy:new Map(frames.map(f=>[f.gameId,f])),
          games:seen.size, failed, window:{limit},
          topDef:teams.slice(0,DEF_TOP_N).map(t=>t.tri)};
}

