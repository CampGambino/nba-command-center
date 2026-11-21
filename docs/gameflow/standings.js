/* Moved out of docs/gameflow.js unchanged (0.141.16: the Game Flow script split by section). */
import { GAMES, isFranchise, isRegularSeason } from "../gameflow.js";

/* ==================== standings, from the schedule alone ====================
 * Win-loss needs no box scores: the schedule already carries both final scores, so this
 * is free and instant where every other league aggregation reads 230-odd games.
 */
function buildStandings(){
  const rec=new Map();
  const get=t=>{ let r=rec.get(t);
    if(!r){ r={tri:t, w:0, l:0, pf:0, pa:0, vs:new Map()}; rec.set(t,r); }
    return r; };
  const played=GAMES.filter(g=>g.status===3 && isRegularSeason(g)
    && isFranchise(g.away) && isFranchise(g.home)
    && g.as!=null && g.hs!=null && +g.as!==+g.hs);
  for(const g of played){
    const a=get(g.away), h=get(g.home);
    const aw=+g.as>+g.hs;
    (aw?a:h).w++; (aw?h:a).l++;
    a.pf+=+g.as; a.pa+=+g.hs; h.pf+=+g.hs; h.pa+=+g.as;
    const link=(x,y,won)=>{ const m=x.vs.get(y.tri)||{w:0,l:0};
      won? m.w++ : m.l++; x.vs.set(y.tri,m); };
    link(a,h,aw); link(h,a,!aw);
  }
  const rows=[...rec.values()].map(r=>({...r,
    gp:r.w+r.l, pct:(r.w+r.l)? r.w/(r.w+r.l) : 0, diff:r.pf-r.pa}));
  rows.sort((x,y)=>y.pct-x.pct || y.diff-x.diff || x.tri.localeCompare(y.tri));
  return {rows, games:played.length, byTri:new Map(rows.map(r=>[r.tri,r]))};
}

