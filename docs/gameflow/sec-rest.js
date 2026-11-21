/* Moved out of docs/gameflow.js unchanged (0.141.16: the Game Flow script split by section). */
import { restBucket, restIndex } from "./rest.js";

/* ==================== section: rest and back-to-backs ====================
 * Two questions, and they are not the same one: how a team plays on no rest, and how it
 * plays against a team on no rest. The second is the more useful of the pair and the one
 * usually quoted loosely, so both are computed the same way and shown side by side.
 */
export function restRows(agg){
  const idx=restIndex();
  return agg.teamGames.map(r=>{
    const own=idx.has(r.gameId+"|"+r.tri)? idx.get(r.gameId+"|"+r.tri) : null;
    const opp=idx.has(r.gameId+"|"+r.opp)? idx.get(r.gameId+"|"+r.opp) : null;
    return {...r, rest:own, oppRest:opp, ob:restBucket(own), pb:restBucket(opp)};
  });
}

/* Records count decided games only, the same rule the standings use, while the rate columns
   pool every game in the bucket. Shooting is pooled makes over pooled attempts. */
export function restStats(list){
  const a={n:0, w:0, l:0, pf:0, pa:0, fgm:0, fga:0, tpm:0, tpa:0, tov:0, poss:0};
  list.forEach(r=>{
    a.n++;
    if(r.decided){ if(r.win) a.w++; else a.l++; }
    a.pf+=r.pts; a.pa+=r.oppPts; a.fgm+=r.fgm; a.fga+=r.fga;
    a.tpm+=r.tpm; a.tpa+=r.tpa; a.tov+=r.tov; a.poss+=r.poss;
  });
  return {...a,
    ppg:a.n? a.pf/a.n : null, oppg:a.n? a.pa/a.n : null,
    marg:a.n? (a.pf-a.pa)/a.n : null,
    fg:a.fga? 100*a.fgm/a.fga : null, tp:a.tpa? 100*a.tpm/a.tpa : null,
    topg:a.n? a.tov/a.n : null, pace:a.n? a.poss/a.n : null,
    pct:(a.w+a.l)? a.w/(a.w+a.l) : null};
}



