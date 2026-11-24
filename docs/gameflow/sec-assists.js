/* Moved out of docs/gameflow.js unchanged (0.153.0, the Game Flow split's part 2): section: assist network. */
import { S } from "./state.js";
import { allReadsFailed, modelFor, reportNoPbp, teamGamesFor } from "./models.js";
import { SHOT_LABEL, assistMetric, shotFilter } from "./controls.js";
import { $, ACTIVE, HOWTO, SOURCE, TEAM, el, esc, finishRender, hideStatus, hideTip, noteEl, setStatus, showTip, tcol } from "../gameflow.js";
import { heatColor, spanValue } from "./sec-rotation.js";

/* ==================== assist network ==================== */
/**
 * A passer x scorer matrix. Reading across a row gives everything that player set
 * up ("passes to"); reading down a column gives who set him up ("passes from").
 * One grid answers both questions, which is why there's no to/from switch.
 *
 * Only assisted field goals exist in the play-by-play, so this is the assist
 * network rather than a full passing chart — no tracking data is involved.
 */
async function buildAssists(tri, limit, onProgress){
  const all = teamGamesFor(tri);
  const games = limit>0 ? all.slice(-limit) : all;
  const window = {limit, of:all.length,
    from:games.length? games[0].date:null, to:games.length? games[games.length-1].date:null};

  const people = new Map();     // name -> {jersey, given, gpts, got, gotpts}
  const pair = new Map();       // "from||to" -> {n, pts}
  let used=0, failed=0, done=0;

  // keyed by id so a mid-season name change can't split one player into two
  const bump=(id,name,jersey,date)=>{
    let p=people.get(id);
    if(!p){ p={id, name, jersey, seen:date, given:0, given2:0, given3:0, gpts:0,
                got:0, got2:0, got3:0, gotpts:0}; people.set(id,p); }
    if(date && new Date(date)>=new Date(p.seen)){ p.name=name; p.seen=date;
      if(jersey) p.jersey=jersey; }
    if(!p.jersey && jersey) p.jersey=jersey;
    return p;
  };

  const queue=games.slice();
  const worker = async () => {
    while(queue.length){
      const g=queue.shift();
      try{
        const G=await modelFor(g);
        const side = G.box.homeTeam.teamTricode===tri ? 1
                   : G.box.awayTeam.teamTricode===tri ? 0 : -1;
        if(side>=0){
          used++;
          const byId=new Map(G.players.map(p=>[p.id,p]));
          // everyone who was available, so the axes stay stable across games
          G.players.filter(p=>p.side===side && p.played)
            .forEach(p=>bump(p.id,p.name,p.jersey,g.date));
          for(const a of G.assists){
            if(a.side!==side) continue;
            const f=byId.get(a.from), t=byId.get(a.to);
            if(!f||!t) continue;
            const pf=bump(f.id,f.name,f.jersey,g.date), pt=bump(t.id,t.name,t.jersey,g.date);
            const three=a.pts===3;
            pf.given++; pf.gpts+=a.pts; if(three) pf.given3++; else pf.given2++;
            pt.got++;   pt.gotpts+=a.pts; if(three) pt.got3++;  else pt.got2++;
            const k=String(f.id)+"||"+String(t.id);
            const cur=pair.get(k)||{n:0,pts:0,n2:0,n3:0};
            cur.n++; cur.pts+=a.pts; if(three) cur.n3++; else cur.n2++;
            pair.set(k,cur);
          }
        }
      }catch(e){ failed++; }
      done++;
      if(onProgress) onProgress(done,games.length);
    }
  };
  await Promise.all(Array.from({length:Math.min(4,games.length)},worker));

  // keep anyone involved in an assist either way; a deep bench row of zeroes is noise
  const rows=[...people.values()].filter(p=>p.given>0||p.got>0)
    .sort((a,b)=>(b.given+b.got)-(a.given+a.got) || b.given-a.given);
  return {tri, rows, pair, teamGames:used, failed, window};
}

/* One accessor for every combination of metric and shot type, so the matrix,
   the totals and the leaderboard can never disagree with each other. */
export function astValue(o, prefix){
  const s=shotFilter(), pts=assistMetric()==="pts";
  const n  = o[prefix]        || 0;
  const n2 = o[prefix+"2"]    || 0;
  const n3 = o[prefix+"3"]    || 0;
  if(s==="2") return pts ? n2*2 : n2;
  if(s==="3") return pts ? n3*3 : n3;
  return pts ? (n2*2 + n3*3) : n;
}

function pairValue(c){
  if(!c) return 0;
  const s=shotFilter(), pts=assistMetric()==="pts";
  if(s==="2") return pts ? c.n2*2 : c.n2;
  if(s==="3") return pts ? c.n3*3 : c.n3;
  return pts ? c.pts : c.n;
}

export function renderAssists(agg){
  const out=$("#out"); out.innerHTML="";
  const card=el("div","card"); out.appendChild(card);
  const tri=agg.tri, meta=TEAM[tri]||{n:tri};
  const usePts = assistMetric()==="pts";
  const W=agg.window||{limit:0,of:agg.teamGames};
  const dr = d => d? new Date(d).toLocaleDateString(undefined,{month:"short",day:"numeric"}) : "";

  const gh=el("div","gamehead");
  const sc=el("div","score");
  const w=el("span","tri");
  const d=el("span","dot"); d.style.background=tcol(tri); w.appendChild(d);
  w.appendChild(el("span","",`${meta.n} — assist network`));
  sc.appendChild(w); gh.appendChild(sc);
  const m=el("div","meta");
  m.innerHTML = (W.limit>0? `<b>last ${agg.teamGames}</b> of ${W.of} team games`
                          : `<b>${agg.teamGames}</b> team games`)
    + (W.from? ` · ${dr(W.from)} – ${dr(W.to)}` : "")
    + ` · rows pass <b>to</b>, columns receive <b>from</b>`
    + ` · ${usePts? "points created" : "assists"} · ${SHOT_LABEL[shotFilter()]}`;
  m.appendChild(el("span","badge ok",(SOURCE[ACTIVE]||{label:"?"}).label));
  gh.appendChild(m);
  card.appendChild(gh);

  if(!agg.rows.length){
    card.appendChild(noteEl("No assisted baskets found for this team yet."));
    return;
  }

  const R=agg.rows.slice().sort((a,b)=>
    (astValue(b,"given")+astValue(b,"got")) - (astValue(a,"given")+astValue(a,"got"))
    || astValue(b,"given")-astValue(a,"given"));
  const N=R.length;
  const val=(f,t)=>pairValue(agg.pair.get(String(f.id)+"||"+String(t.id)));
  let peak=0;
  R.forEach(f=>R.forEach(t=>{ const v=val(f,t); if(v>peak) peak=v; }));

  const grid=el("div","amx");
  grid.style.gridTemplateColumns=`var(--namew) repeat(${N}, minmax(0,1fr)) 46px`;

  grid.appendChild(el("div","ah corner","passer ↓ / scorer →"));
  R.forEach((p,i)=>{
    const h=el("div","ah",p.jersey||String(i+1));
    h.title=p.name; grid.appendChild(h);
  });
  grid.appendChild(el("div","ah tot","tot"));

  for(const f of R){
    const nm=el("div","anm");
    if(f.jersey) nm.appendChild(el("span","jn",f.jersey));
    nm.appendChild(el("span","",f.name));
    nm.title=`${f.name} — created ${f.given} assists (${f.gpts} pts), `+
             `scored off ${f.got} assists (${f.gotpts} pts)`;
    grid.appendChild(nm);
    for(const t of R){
      const c=el("div","acell");
      if(f.id===t.id){ c.classList.add("self"); c.textContent="·"; grid.appendChild(c); continue; }
      const v=val(f,t);
      if(v){
        c.textContent=v;
        c.style.background=heatColor(peak? v/peak : 0);
        c.style.color = (peak && v/peak>0.55) ? "#10151d" : "var(--text)";
      }
      c.addEventListener("mousemove",ev=>{
        const cc=agg.pair.get(String(f.id)+"||"+String(t.id))||{n:0,pts:0,n2:0,n3:0};
        showTip(`<div class="th">${esc(f.name)} → ${esc(t.name)}</div>`+
          `<div class="kv"><span>assists</span><b>${cc.n}</b></div>`+
          `<div class="kv"><span>on 2-pointers</span><b>${cc.n2}</b></div>`+
          `<div class="kv"><span>on 3-pointers</span><b>${cc.n3}</b></div>`+
          `<div class="kv"><span>points created</span><b>${cc.pts}</b></div>`+
          `<div class="kv"><span>per game</span><b>${(cc.n/Math.max(1,agg.teamGames)).toFixed(2)}</b></div>`,ev);
      });
      c.addEventListener("mouseleave",hideTip);
      grid.appendChild(c);
    }
    const tot=el("div","acell tot", String(astValue(f,"given")));
    tot.title=`${f.name} created ${f.given} assists (${f.given2} on 2s, ${f.given3} on 3s) `+
              `worth ${f.gpts} points`;
    grid.appendChild(tot);
  }

  // column totals: how many of each player's baskets came off a teammate's pass
  grid.appendChild(el("div","anm tot","assisted baskets"));
  R.forEach(t=>{
    const c=el("div","acell tot", String(astValue(t,"got")));
    c.title=`${t.name} scored off ${t.got} assists (${t.got2} on 2s, ${t.got3} on 3s), `+
            `${t.gotpts} points`;
    grid.appendChild(c);
  });
  const grand=R.reduce((a,p)=>a+astValue(p,"given"),0);
  grid.appendChild(el("div","acell tot",String(grand)));
  card.appendChild(grid);

  card.appendChild(noteEl(
    "Read a row for everything that player set up, and a column for who set him up — the "+
    "same numbers, both directions, which is why there's no to/from switch. Only assisted "+
    "field goals appear in the play-by-play, so this is the assist network, not a full "+
    "passing chart: unassisted baskets and passes that didn't lead to a shot aren't here. "+
    "Free throws carry no assist. Hover a cell for both readings."));
  finishRender();
}

export async function showAssists(tri){
  const bar=el("div","prog"); const fill=el("i"); bar.appendChild(fill);
  const limit=spanValue();
  const what = limit>0 ? `the last ${limit} ${TEAM[tri]?TEAM[tri].n:tri} games`
                       : `every ${TEAM[tri]?TEAM[tri].n:tri} game`;
  setStatus(`<span class="spin"></span>Reading ${what}…`);
  $("#status").appendChild(bar);
  try{
    const agg=await buildAssists(tri,limit,(done,total)=>{
      fill.style.width=(100*done/total)+"%";
      if($("#status").childNodes[1]) $("#status").childNodes[1].textContent=
        `Reading ${what}… ${done}/${total}`;
    });
    if(allReadsFailed(agg.teamGames+agg.failed, agg.failed)){ reportNoPbp(); return; }
    S.assistAgg=agg; window.__ASSISTS=agg;
    renderAssists(agg);
    hideStatus();
  }catch(e){
    $("#out").innerHTML="";
    setStatus(`<b>Couldn't build the assist network.</b><br>${String(e.message||e)}`+HOWTO,true);
  }
}
