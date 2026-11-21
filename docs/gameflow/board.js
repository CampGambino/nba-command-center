/* Moved out of docs/gameflow.js unchanged (0.141.16: the Game Flow script split by section). */
import { liteOrModel, teamGamesFor } from "../gameflow.js";

/* ==================== assist leaderboard ==================== */
/**
 * Ranked assist creators. With a team chosen it's that roster; with "All teams"
 * it's the whole league. Games are read once and shared with the other views, so
 * a league board is only expensive the first time.
 */
export async function buildBoard(tris, limit, onProgress){
  const perTeam = new Map(tris.map(t=>[t, teamGamesFor(t)]));
  const slate = [];
  for(const [tri,all] of perTeam) (limit>0? all.slice(-limit) : all).forEach(g=>slate.push({tri,g}));

  const rows=new Map();   // "id||tri" -> record, keyed by id so names can change
  const pairs=new Map();  // "tri||passer||scorer" -> connection record
  let done=0, failed=0;
  const gamesPerTeam=new Map(tris.map(t=>[t,0]));
  /* What kinds of game went into these totals. Special games — a Commissioner's Cup
     final, say — don't count toward regular-season stats elsewhere, so if any are
     in here the scope is stated on screen rather than left for someone to discover
     by disagreeing with another source. */
  const seenGames=new Set(), labels=new Map();
  const rec=(id,name,tri,jersey,date)=>{
    const k=String(id)+"||"+tri;
    let r=rows.get(k);
    if(!r){ r={id, name, tri, jersey, seen:date, given:0, given2:0, given3:0, gpts:0,
                got:0, got2:0, got3:0, gotpts:0, games:0,
                top:new Map(),      // who he passes to most, keyed by id
                feed:new Map()};    // who passes to him most, keyed by id
            rows.set(k,r); }
    if(date && new Date(date)>=new Date(r.seen)){ r.name=name; r.seen=date;
      if(jersey) r.jersey=jersey; }
    if(!r.jersey && jersey) r.jersey=jersey;
    return r;
  };

  const queue=slate.slice();
  const worker = async () => {
    while(queue.length){
      const {tri,g}=queue.shift();
      try{
        const G=await liteOrModel(g);
        const side = G.box.homeTeam.teamTricode===tri ? 1
                   : G.box.awayTeam.teamTricode===tri ? 0 : -1;
        if(side>=0){
          gamesPerTeam.set(tri,(gamesPerTeam.get(tri)||0)+1);
          if(!seenGames.has(g.gameId)){
            seenGames.add(g.gameId);
            const lb=(g.label||"").trim();
            if(lb) labels.set(lb,(labels.get(lb)||0)+1);
          }
          const byId=new Map(G.players.map(p=>[p.id,p]));
          G.players.filter(p=>p.side===side && p.played)
            .forEach(p=>{ rec(p.id,p.name,tri,p.jersey,g.date).games++; });
          for(const a of G.assists){
            if(a.side!==side) continue;
            const f=byId.get(a.from), t=byId.get(a.to);
            if(!f||!t) continue;
            const three=a.pts===3;
            const rf=rec(f.id,f.name,tri,f.jersey,g.date);
            const rt=rec(t.id,t.name,tri,t.jersey,g.date);
            rf.given++; rf.gpts+=a.pts; if(three) rf.given3++; else rf.given2++;
            rt.got++;   rt.gotpts+=a.pts; if(three) rt.got3++;  else rt.got2++;
            rf.top.set(String(t.id),(rf.top.get(String(t.id))||0)+1);
            rt.feed.set(String(f.id),(rt.feed.get(String(f.id))||0)+1);
            const pk=tri+"||"+String(f.id)+"||"+String(t.id);
            let pr=pairs.get(pk);
            if(!pr){ pr={tri, from:f.name, to:t.name, fromId:f.id, toId:t.id,
                          given:0, given2:0, given3:0, gpts:0, log:new Map()};
                     pairs.set(pk,pr); }
            // keep the newest spelling on the pair too
            if(new Date(g.date)>=new Date(pr.seen||0)){
              pr.from=f.name; pr.to=t.name; pr.seen=g.date;
            }
            pr.given++; pr.gpts+=a.pts; if(three) pr.given3++; else pr.given2++;
            // per-game tally, so a disagreement with another source can be located
            const lg=pr.log.get(g.gameId) || {date:g.date, n:0, away:g.away, home:g.home};
            lg.n++; pr.log.set(g.gameId, lg);
          }
        }
      }catch(e){ failed++; }
      done++;
      if(onProgress) onProgress(done, slate.length);
    }
  };
  await Promise.all(Array.from({length:Math.min(10,slate.length)},worker));   // 10 at a time: files on this site are small

  return {rows:[...rows.values()].filter(r=>r.given>0||r.got>0),
          pairs:[...pairs.values()],
          distinctGames:seenGames.size, labels,
          teams:tris, gamesPerTeam, requested:slate.length, failed,
          window:{limit, from:slate.length?slate[0].g.date:null,
                  to:slate.length?slate[slate.length-1].g.date:null}};
}

