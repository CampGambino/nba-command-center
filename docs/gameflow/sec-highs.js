/* Moved out of docs/gameflow.js unchanged (0.153.0, the Game Flow split's part 2): section: scoring highs. */
import { RANK_POSTER_N, rankPoster } from "./rank-poster.js";
import { S } from "./state.js";
import { allReadsFailed, franchises, liteOrModel, reportNoPbp, teamGamesFor } from "./models.js";
import { $, ACTIVE, HOWTO, SOURCE, TEAM, el, finishRender, hideStatus, noteEl, seasonLabel, setStatus, tcol, teamName } from "../gameflow.js";
import { denseRanks, topWithTies } from "./sec-outliers.js";
import { layoutMode } from "./controls.js";
import { spanValue } from "./sec-rotation.js";

/* ==================== scoring highs ====================
 * The biggest single-quarter and single-half scoring bursts. Overtime is kept in
 * its own list rather than competing with quarters: an OT period is five minutes
 * against a quarter's ten, so ranking them together would reward the shorter one.
 * Halves are Q1+Q2 and Q3+Q4 — overtime is not folded in for the same reason.
 * Every instance is listed, so a player with three big quarters occupies three rows.
 */
const HIGHS_N = 20;

async function buildHighs(tris, limit, onProgress){
  const perTeam=new Map(tris.map(t=>[t, teamGamesFor(t)]));
  const slate=[];
  for(const [tri,all] of perTeam) (limit>0? all.slice(-limit):all).forEach(g=>slate.push({tri,g}));

  const quarters=[], halves=[], extra=[];
  const seen=new Set();
  let done=0, failed=0;

  const queue=slate.slice();
  const worker=async()=>{
    while(queue.length){
      const {tri,g}=queue.shift();
      try{
        const G=await liteOrModel(g);
        const side = G.box.homeTeam.teamTricode===tri ? 1
                   : G.box.awayTeam.teamTricode===tri ? 0 : -1;
        if(side>=0){
          seen.add(g.gameId);
          const opp = side===1 ? g.away : g.home;
          const at  = side===1 ? "vs" : "at";
          /* Only this team's players. In a league run the same game is read twice —
             once under the home tricode, once under the away — so without the side
             filter every player lands in the list twice, the second time labelled
             with his opponent's colours. */
          for(const pl of G.players){
            if(!pl.played || pl.side!==side) continue;
            const per=pl.ptsByPeriod||{};
            const base={name:pl.name, id:pl.id, tri:pl.tri||tri, opp, at,
                        date:g.date, gameId:g.gameId};
            for(let p=1;p<=4;p++){
              const v=per[p]||0;
              if(v>0) quarters.push({...base, pts:v, when:"Q"+p, period:p});
            }
            const h1=(per[1]||0)+(per[2]||0), h2=(per[3]||0)+(per[4]||0);
            if(h1>0) halves.push({...base, pts:h1, when:"1st half", period:1});
            if(h2>0) halves.push({...base, pts:h2, when:"2nd half", period:2});
            for(let p=5;p<=G.maxP;p++){
              const v=per[p]||0;
              if(v>0) extra.push({...base, pts:v, when:"OT"+(p-4), period:p});
            }
          }
        }
      }catch(e){ failed++; }
      done++;
      if(onProgress) onProgress(done, slate.length);
    }
  };
  await Promise.all(Array.from({length:Math.min(10,slate.length)},worker));   // 10 at a time: files on this site are small

  const byPts=(a,b)=>b.pts-a.pts || new Date(a.date)-new Date(b.date);
  return {teams:tris, games:seen.size, failed,
          quarters:quarters.sort(byPts), halves:halves.sort(byPts),
          extra:extra.sort(byPts),
          window:{limit}};
}

export function renderHighs(agg){
  const out=$("#out"); out.innerHTML="";
  const card=el("div","card"); out.appendChild(card);
  const league=agg.teams.length>1;

  const gh=el("div","gamehead");
  const sc=el("div","score");
  const w=el("span","tri");
  if(!league){ const d=el("span","dot"); d.style.background=tcol(agg.teams[0]); w.appendChild(d); }
  w.appendChild(el("span","", league ? "League — scoring highs"
    : `${(TEAM[agg.teams[0]]||{n:agg.teams[0]}).n} — scoring highs`));
  sc.appendChild(w); gh.appendChild(sc);
  const m=el("div","meta");
  m.innerHTML=(agg.window.limit>0? `<b>last ${agg.window.limit}</b> games per team`
                                 : `<b>full regular season</b>`)
    + ` · ${agg.games} games`
    + (agg.failed? ` · ${agg.failed} unavailable`:"")
    + ` · biggest single-quarter and single-half scoring bursts`;
  m.appendChild(el("span","badge ok",(SOURCE[ACTIVE]||{label:"?"}).label));
  gh.appendChild(m);
  card.appendChild(gh);

  const section=(title, list, note)=>{
    if(!list.length) return;
    const top=topWithTies(list, HIGHS_N, r=>r.pts);
    const ranks=denseRanks(top.map(r=>r.pts));
    const counts={}; ranks.forEach(r=>{counts[r]=(counts[r]||0)+1;});

    card.appendChild(el("div","rule"));
    const h=el("div","sect nm",title); h.style.textAlign="left"; h.style.paddingRight="0";
    card.appendChild(h);

    const tbl=el("table","per lb");
    const th=el("tr");
    ["#","player","team","pts","when","opponent","date"]
      .forEach(x=>th.appendChild(el("th","",x)));
    tbl.appendChild(th);
    top.forEach((r,i)=>{
      const tr=el("tr");
      const d=new Date(r.date).toLocaleDateString(undefined,{month:"short",day:"numeric"});
      const cells=[(counts[ranks[i]]>1?"T":"")+ranks[i], r.name, r.tri,
                   String(r.pts), r.when, `${r.at} ${r.opp}`, d];
      cells.forEach((c,k)=>{
        const td=el("td","",c);
        if(k===1){ td.style.textAlign="left"; td.style.color="var(--text)"; }
        if(k===2){ td.style.textAlign="left";
          td.innerHTML=`<span style="display:inline-block;width:8px;height:8px;border-radius:2px;`+
            `background:${tcol(r.tri)};margin-right:5px"></span>${r.tri}`; }
        if(k===4||k===5){ td.style.textAlign="left"; }
        if(k===3){ td.style.color="var(--text)"; td.style.fontWeight="500"; }
        tr.appendChild(td);
      });
      tbl.appendChild(tr);
    });
    card.appendChild(tbl);
    if(note) card.appendChild(noteEl(note));
  };

  if(layoutMode()==="poster"){
    /* One list, not three: a poster is a single statement, and the quarters are the
       headline. The halves and overtime stay a click away in the table. */
    const top=topWithTies(agg.quarters, RANK_POSTER_N, r=>r.pts);
    const ranks=denseRanks(top.map(r=>r.pts));
    const counts={}; ranks.forEach(r=>{counts[r]=(counts[r]||0)+1;});
    const dt=d=>new Date(d).toLocaleDateString(undefined,{month:"short",day:"numeric"});
    card.appendChild(rankPoster({
      kick:`NBA ${seasonLabel()}`,
      title:"Biggest scoring quarters",
      cols:["player","points"],
      rows:top.map((r,i)=>({
        rank:(counts[ranks[i]]>1?"T":"")+ranks[i],
        name:r.name, id:r.id, tri:r.tri,
        sub:`${r.tri} · ${r.when} ${r.at} ${r.opp} · ${dt(r.date)}`,
        value:String(r.pts), frac:r.pts,
      })),
      notes:[`Points in a single quarter, free throws included, from `+
        `${agg.games} games. Every instance counts, so one player can appear twice.`,
        `The bar is his total against the biggest quarter on the board.`],
    }));
    finishRender(); return;
  }

  section(`Top ${HIGHS_N} quarters`, agg.quarters,
    "Points in a single quarter, free throws included. Every instance is listed, so a "+
    "player with several big quarters appears more than once.");
  section(`Top ${HIGHS_N} halves`, agg.halves,
    "First half is Q1+Q2, second half is Q3+Q4. Overtime is not folded in — a long "+
    "overtime would otherwise inflate second halves against the ones played in 20 minutes.");
  section("Overtime periods", agg.extra,
    "Overtime is ranked on its own: five minutes against a quarter's ten, so putting "+
    "these in the same list as quarters would reward the shorter period.");

  if(!agg.quarters.length)
    card.appendChild(noteEl("No scoring found in this selection yet."));
  finishRender();
}

export async function showHighs(){
  const t=$("#team").value;
  const tris = t ? [t] : [...$("#team").options].map(o=>o.value).filter(Boolean);
  const limit=spanValue();
  const bar=el("div","prog"); const fill=el("i"); bar.appendChild(fill);
  const what = t ? teamName(t) : `all ${franchises().length} teams`;
  setStatus(`<span class="spin"></span>Reading ${what}…`);
  $("#status").appendChild(bar);
  try{
    const agg=await buildHighs(tris,limit,(done,total)=>{
      fill.style.width=(100*done/total)+"%";
      if($("#status").childNodes[1]) $("#status").childNodes[1].textContent=
        `Reading ${what}… ${done}/${total} games`;
    });
    if(allReadsFailed(agg.games, agg.failed)){ reportNoPbp(); return; }
    S.highsAgg=agg; window.__HIGHS=agg;
    renderHighs(agg);
    hideStatus();
  }catch(e){
    $("#out").innerHTML="";
    setStatus(`<b>Couldn't build the scoring highs.</b><br>${String(e.message||e)}`+HOWTO,true);
  }
}
