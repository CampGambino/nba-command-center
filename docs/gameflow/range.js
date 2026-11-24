/* Moved out of docs/gameflow.js unchanged (0.141.16: the Game Flow script split by section). */
import { ACTIVE, SOURCE, el, seasonLabel } from "../gameflow.js";
import { downloadPoster } from "./sec-outliers.js";
import { modelFor, teamGamesFor } from "./models.js";
import { threeZone } from "./sec-profile.js";
import { ARC_R, CORNER_D, CORNER_Y, COURT_W, hasSpot, shotDist, spotDist, statedDist } from "../lib/gameflow/model.js";

/* ==================== three-point range ====================
 * Who shoots from deepest. Ranked on mean distance over *all* three-point attempts,
 * not makes only: the average then describes shot selection rather than which of his
 * shots happened to drop, and makes-only would bias every shooter shorter because
 * longer shots miss more often.
 *
 * Two distance signals exist and they are not equally good, so they are kept apart
 * and both reported. The stated distance in the play text is the number the league
 * publishes and is used for the average; the coordinate is coarser (integers, ~1ft)
 * and is used to place the dot on the court, where a foot of error is invisible.
 * A shot with a coordinate but no stated distance still gets a dot and falls back to
 * the coordinate for the average, which the footer says out loud.
 */
export const RANGE_MIN_3PA = 40;      // below this an average is noise, not a tendency
export const RANGE_N = 12;

export async function buildRange(tris, limit, onProgress){
  const perTeam=new Map(tris.map(t=>[t, teamGamesFor(t)]));
  const slate=[];
  for(const [tri,all] of perTeam) (limit>0? all.slice(-limit):all).forEach(g=>slate.push({tri,g}));

  const rows=new Map();          // "id||tri" -> shooter
  const seen=new Set();
  /* The shot profile (0.59): games he played (a game with no three still counts against his rate), and every
     team's threes by zone, taken and allowed, for tonight's matchups. */
  const played=new Map();        // "id||tri" -> [{gameId, date}]
  const zoneT=()=>({games:new Set(), att:0, made:0, corner:0, cornerMade:0, deep:0, deepMade:0, spotted:0});
  const teamZ=new Map(), allowZ=new Map();
  const zOf=(m,t)=>{ let z=m.get(t); if(!z){ z=zoneT(); m.set(t,z); } return z; };
  let done=0, failed=0;
  // how well the two signals agree, measured rather than assumed
  let bothN=0, bothErr=0, bothMax=0;

  const queue=slate.slice();
  const worker=async()=>{
    while(queue.length){
      const {tri,g}=queue.shift();
      try{
        const G=await modelFor(g);
        const side = G.box.homeTeam.teamTricode===tri ? 1
                   : G.box.awayTeam.teamTricode===tri ? 0 : -1;
        if(side>=0){
          seen.add(g.gameId);
          const byId=new Map(G.players.map(p=>[p.id,p]));
          const oppTri=side? G.box.awayTeam.teamTricode : G.box.homeTeam.teamTricode;
          const TZ=zOf(teamZ,tri), AZ=zOf(allowZ,oppTri);
          TZ.games.add(g.gameId); AZ.games.add(g.gameId);
          for(const pl of G.players){ if(pl.side!==side || !pl.played) continue;
            const k=String(pl.id)+"||"+tri; if(!played.has(k)) played.set(k,[]); played.get(k).push({gameId:g.gameId, date:g.date}); }
          for(const a of G.acts){
            if(a.actionType!=="3pt") continue;
            const pl=byId.get(a.personId);
            if(!pl || pl.side!==side) continue;
            { const made3=a.shotResult==="Made", d3=shotDist(a), zone=threeZone(a, d3);
              for(const Z of [TZ,AZ]){ Z.att++; if(made3) Z.made++;
                if(zone.spotted) Z.spotted++;
                if(zone.corner){ Z.corner++; if(made3) Z.cornerMade++; }
                if(zone.deep){ Z.deep++; if(made3) Z.deepMade++; } } }
            const k=String(pl.id)+"||"+tri;
            let r=rows.get(k);
            if(!r){ r={id:pl.id, name:pl.name, tri, seen:g.date,
                       shots:[], dists:[], att:0, made:0, distN:0, distSum:0,
                       noDist:0, noSpot:0, fromField:0, fromText:0, fromSpot:0};
                    rows.set(k,r); }
            if(new Date(g.date)>=new Date(r.seen)){ r.name=pl.name; r.seen=g.date; }

            const made=a.shotResult==="Made";
            r.att++; if(made) r.made++;

            const d=shotDist(a), st=statedDist(a), sp=spotDist(a);
            if(st!=null && sp!=null){
              const e=Math.abs(st-sp); bothN++; bothErr+=e;
              if(e>bothMax) bothMax=e;
            }
            if(d){ r.distN++; r.distSum+=d.ft; r.dists.push(d.ft);
                   if(d.from==="field") r.fromField++;
                   else if(d.from==="text") r.fromText++;
                   else r.fromSpot++; }
            else r.noDist++;

            if(hasSpot(a)) r.shots.push({sx:a.sx, sy:a.sy, made, ft:d?d.ft:null, gameId:g.gameId, date:g.date});
            else r.noSpot++;
            (r.zshots||(r.zshots=[])).push({made, ft:d?d.ft:null, gameId:g.gameId, date:g.date, ...threeZone(a, d)});
          }
        }
      }catch(e){ failed++; }
      done++;
      if(onProgress) onProgress(done, slate.length);
    }
  };
  await Promise.all(Array.from({length:Math.min(10,slate.length)},worker));   // 10 at a time: files on this site are small

  const all=[...rows.values()].map(r=>({...r,
    avg: r.distN? r.distSum/r.distN : null,
    pct: r.att? 100*r.made/r.att : 0}));
  const eligible=all.filter(r=>r.att>=RANGE_MIN_3PA && r.avg!=null)
                    .sort((a,b)=>b.avg-a.avg || b.att-a.att);
  for(const r of all){ const pg=played.get(String(r.id)+"||"+r.tri)||[]; r.games=pg.slice().sort((a,b)=>new Date(a.date)-new Date(b.date)); }
  return {teams:tris, games:seen.size, failed, all, eligible, teamZ, allowZ,
          window:{limit},
          agree: bothN? {n:bothN, mean:bothErr/bothN, max:bothMax} : null};
}

/* ---- half court, drawn in feet and projected once ---- */
export function courtSvg(shots, w, h){
  const PAD=6, TOP=30;                       // feet of court shown beyond the arc
  const fx=sx=>PAD+((sx+COURT_W/2)/COURT_W)*(w-2*PAD);
  const fy=y=>h-PAD-((y+5.25)/(TOP+5.25))*(h-2*PAD);   // baseline sits below y=0
  const ns="http://www.w3.org/2000/svg";
  const mk=(t,at)=>{ const e=document.createElementNS(ns,t);
    for(const k in at) e.setAttribute(k,at[k]); return e; };
  const svg=mk("svg",{viewBox:`0 0 ${w} ${h}`, width:w, height:h, class:"court"});

  svg.appendChild(mk("rect",{x:fx(-COURT_W/2), y:fy(TOP), width:fx(COURT_W/2)-fx(-COURT_W/2),
    height:fy(-5.25)-fy(TOP), fill:"none", stroke:"var(--cline)", "stroke-width":1}));
  // the arc, with the straight corner segments that run to meet it
  const ax=cx=>fx(cx);
  svg.appendChild(mk("path",{d:
    `M ${ax(-CORNER_D)} ${fy(-5.25)} L ${ax(-CORNER_D)} ${fy(CORNER_Y)} `+
    `A ${fx(ARC_R-COURT_W/2)-fx(-COURT_W/2)} ${fy(0)-fy(ARC_R)} 0 0 0 ${ax(CORNER_D)} ${fy(CORNER_Y)} `+
    `L ${ax(CORNER_D)} ${fy(-5.25)}`,
    fill:"none", stroke:"var(--cline)", "stroke-width":1.4}));
  svg.appendChild(mk("circle",{cx:fx(0), cy:fy(0), r:2.2, fill:"var(--cline)"}));

  /* Coordinates are integers, so many attempts land on the exact same point. Rather
     than jitter them — which invents precision the feed doesn't have — identical
     spots stack into one dot that grows with the count. */
  const bins=new Map();
  for(const s of shots){
    const k=s.sx+","+s.sy+","+(s.made?1:0);
    const b=bins.get(k); if(b) b.n++; else bins.set(k,{...s, n:1});
  }
  for(const b of bins.values()){
    svg.appendChild(mk("circle",{cx:fx(b.sx), cy:fy(b.sy),
      r:Math.min(4.4, 1.9+0.7*Math.sqrt(b.n-1)),
      class:b.made?"sh made":"sh miss"}));
  }
  return svg;
}

/* ---- shared helpers for the two range posters ---- */
const SVGNS="http://www.w3.org/2000/svg";
export const svgEl=(t,at)=>{ const e=document.createElementNS(SVGNS,t);
  for(const k in at) if(at[k]!=null) e.setAttribute(k,at[k]); return e; };
export const svgText=(x,y,str,at)=>{ const e=svgEl("text",{x,y,...at}); e.textContent=str; return e; };
/* SVG offers no text metrics before layout, so a label's width is estimated from its
   character count and font size. Anything that would spill out of its lane is squeezed
   with textLength rather than allowed to run into the neighbour — NBA rosters carry
   names like "Diggins-Smith", which at 13px is half again wider than a lane. */
const TEXT_W = 0.58;
export function fitText(node, str, size, maxPx){
  if(str.length * size * TEXT_W > maxPx){
    node.setAttribute("textLength", Math.max(8, Math.round(maxPx)));
    node.setAttribute("lengthAdjust", "spacingAndGlyphs");
  }
  return node;
}
/** Linear-interpolated percentile over an unsorted list. */
export function pctile(xs, q){
  if(!xs.length) return null;
  const a=xs.slice().sort((m,n)=>m-n);
  const i=(a.length-1)*q, lo=Math.floor(i), hi=Math.ceil(i);
  return lo===hi ? a[lo] : a[lo]+(a[hi]-a[lo])*(i-lo);
}
/** Poster shell: kicker, headline, rule. Returns the card element. */
export function posterShell(kick, title){
  const p=el("div","poster");
  p.appendChild(el("p","pkick",kick));
  p.appendChild(el("h3","ptitle",title));
  p.appendChild(el("div","prule"));
  return p;
}
export function posterFoot(p, lines){
  const f=el("div","pfoot");
  const t=el("p",""); t.innerHTML=lines.join(" ");
  f.appendChild(t);
  f.appendChild(el("div","brand",`NBA GameFlow · ${(SOURCE[ACTIVE]||{label:"?"}).label}`));
  p.appendChild(f);
}
export function posterTools(card, node, title, file){
  const tools=el("div","legend");
  const dl=el("button","","Download this poster");
  dl.style.font="inherit";
  dl.addEventListener("click",()=>downloadPoster(node,title,file));
  tools.appendChild(dl);
  tools.appendChild(el("span","","Saves a standalone HTML file."));
  card.appendChild(tools);
}
/** Scope line shared by both posters, so the two never disagree. */
export function rangeScope(agg, shown){
  return `${agg.window.limit>0 ? `last ${agg.window.limit} games per team`
                              : `${seasonLabel()} regular season`} · ${agg.games} games · `+
         `${shown} shooters with ${RANGE_MIN_3PA}+ three-point attempts · all attempts, `+
         `makes and misses.`;
}

