/* Moved out of docs/gameflow.js unchanged (0.153.0, the Game Flow split's part 2): section: 3PT range (shot profile, shot charts, posters). */
import { CORNER_D, CORNER_Y, hasSpot } from "../lib/gameflow/model.js";
import { gameDay } from "./rest.js";
import { RANGE_MIN_3PA, RANGE_N, buildRange, courtSvg } from "./range.js";
import { renderRangeCourt } from "./poster-court.js";
import { renderRangeScatter } from "./poster-scatter.js";
import { S } from "./state.js";
import { $, ACTIVE, GAMES, HOWTO, SOURCE, TEAM, el, esc, finishRender, hideStatus, isFranchise, noteEl, setStatus, tcol, teamName } from "../gameflow.js";
import { layoutMode } from "./controls.js";
import { denseRanks, topWithTies } from "./sec-outliers.js";
import { spanValue } from "./sec-rotation.js";
import { allReadsFailed, franchises, reportNoPbp } from "./models.js";

/* ==================== the shot profile (0.59) ====================
 * Where a shooter's threes come from, and whether that is changing: corner threes (the short 22-foot ones, read
 * from the coordinate), deep ones (27+ feet, from the stated distance or the coordinate), his last five games
 * against his season, and, on the league view, tonight's matchups: how often each team shoots from the corner
 * and how often its opponent lets teams do it.
 */
const DEEP_FT = 27, PROFILE_MIN_3PA = 25, RECENT_N = 5;

export function threeZone(a, d){
  const spotted=hasSpot(a);
  const corner=spotted && Math.abs(a.sx)>=CORNER_D-1 && a.sy<=CORNER_Y;
  const ft=d? d.ft : (spotted? Math.hypot(a.sx,a.sy) : null);
  return {spotted, corner, deep: ft!=null && ft>=DEEP_FT && !corner};
}

const todayEastern = () => new Date().toLocaleDateString("en-CA",{timeZone:"America/New_York"});

function tonightTeams(){
  const t=todayEastern(), set=new Map();
  for(const g of GAMES){ if(gameDay(g.date)!==t || !isFranchise(g.home) || !isFranchise(g.away)) continue;
    set.set(g.home, g.away); set.set(g.away, g.home); }
  return set;       // tri -> tonight's opponent
}

function profileRow(r){
  const zs=r.zshots||[], gp=(r.games||[]).length;
  const n=f=>zs.filter(f).length, pct=(m,a)=>a? 100*m/a : null;
  const corner=n(z=>z.corner), cornerMade=n(z=>z.corner&&z.made), deep=n(z=>z.deep), deepMade=n(z=>z.deep&&z.made);
  const above=r.att-corner, aboveMade=r.made-cornerMade;
  const recentIds=new Set((r.games||[]).slice(-RECENT_N).map(g=>g.gameId));
  const rz=zs.filter(z=>recentIds.has(z.gameId));
  const avgFt=xs=>{ const f=xs.filter(z=>z.ft!=null); return f.length? f.reduce((s,z)=>s+z.ft,0)/f.length : null; };
  const recentN=Math.min(RECENT_N, gp);
  return {...r, gp, corner, cornerMade, deep, deepMade, above, aboveMade,
    perG: gp? r.att/gp : null, cornerShare: r.att? 100*corner/r.att : null,
    cornerPct: pct(cornerMade,corner), abovePct: pct(aboveMade,above), deepPct: pct(deepMade,deep),
    recentPerG: recentN? rz.length/recentN : null, recentPct: pct(rz.filter(z=>z.made).length, rz.length),
    recentFt: avgFt(rz), seasonFt: r.avg, recentN};
}

function renderRangeProfile(card, agg){
  const league=agg.teams.length>1;
  const tonight=tonightTeams();
  const only = (window.__rangeTonight ??= tonight.size>0);
  const sortKey = (window.__rangeSort ||= {k:"att", d:-1});
  const f1=v=>v==null? "—" : v.toFixed(1), f0=v=>v==null? "—" : v.toFixed(0)+"%";
  const sg=(v,d=1)=>v==null? "" : (v>0?"+":"")+v.toFixed(d);
  let rows=agg.all.filter(r=>r.att>=PROFILE_MIN_3PA).map(profileRow);
  if(only && tonight.size) rows=rows.filter(r=>tonight.has(r.tri));

  const bar=el("div","legend");
  if(tonight.size){
    const lab=el("label","ck"); const cb=el("input"); cb.type="checkbox"; cb.checked=only;
    cb.addEventListener("change",()=>{ window.__rangeTonight=cb.checked; renderRange(agg); });
    lab.appendChild(cb); lab.appendChild(document.createTextNode(` tonight's teams only (${tonight.size})`)); bar.appendChild(lab);
  }
  bar.appendChild(el("span","",`${rows.length} shooters with ${PROFILE_MIN_3PA}+ three-point attempts · click a column to sort`));
  card.appendChild(bar);

  /* Tonight's matchups: each side's corner habit and accuracy against what the other side allows. League view
     only, because the allowed side needs every team's games. */
  if(league && tonight.size){
    const lg={att:0, corner:0, made:0}; for(const z of agg.teamZ.values()){ lg.att+=z.att; lg.corner+=z.corner; lg.made+=z.made; }
    const lgShare=lg.att? 100*lg.corner/lg.att : null, lgPct=lg.att? 100*lg.made/lg.att : null;
    const pairs=[], done=new Set();
    for(const [a,b] of tonight){ const k=[a,b].sort().join("-"); if(done.has(k)) continue; done.add(k); pairs.push([a,b]); }
    card.appendChild(el("div","rule"));
    const h=el("div","sect nm","Tonight's three-point matchups"); h.style.textAlign="left"; card.appendChild(h);
    const tbl=el("table","per lb"); const th=el("tr");
    ["team","3PA / game","from the corner","3P%","vs","3PA / game allowed","allowed from the corner","3P% allowed"].forEach(x=>th.appendChild(el("th","",x)));
    tbl.appendChild(th);
    const z=(m,t)=>m.get(t)||null;
    const per=(Z)=>Z&&Z.games.size? Z.att/Z.games.size : null, share=Z=>Z&&Z.att? 100*Z.corner/Z.att : null, acc=Z=>Z&&Z.att? 100*Z.made/Z.att : null;
    const mark=(v,ref,hi)=>v==null||ref==null? f0(v) : `${f0(v)}`+(Math.abs(v-ref)>=(hi||3)? ` <span style="color:var(--dim)">${v>ref?"▲":"▼"}</span>`:"");
    for(const [a,b] of pairs) for(const [me,op] of [[a,b],[b,a]]){
      const T=z(agg.teamZ,me), A=z(agg.allowZ,op);
      const tr=el("tr");
      const td=el("td"); td.style.textAlign="left";
      td.innerHTML=`<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${tcol(me)};margin-right:5px"></span>${me}`;
      tr.appendChild(td);
      [f1(per(T)), mark(share(T),lgShare), mark(acc(T),lgPct,2), op, f1(per(A)), mark(share(A),lgShare), mark(acc(A),lgPct,2)]
        .forEach(v=>{ const d=el("td"); d.innerHTML=v; tr.appendChild(d); });
      tbl.appendChild(tr);
    }
    const mw=el("div"); mw.style.overflowX="auto"; mw.appendChild(tbl); card.appendChild(mw);
    card.appendChild(noteEl(`League: ${f0(lgShare)} of threes from the corner, ${f0(lgPct)} made. ▲ ▼ mark 3+ points of corner share `+
      `(2+ of accuracy) above or below the league. "Allowed" is what the opponent has given up: every three taken against it this season.`));
  }

  const COLS=[
    ["att","3PA",r=>r.att,r=>String(r.att)],
    ["perG","per game",r=>r.perG,r=>f1(r.perG)],
    ["pct","3P%",r=>r.pct,r=>f0(r.pct)],
    ["cornerShare","corner share",r=>r.cornerShare,r=>f0(r.cornerShare)],
    ["cornerPct","corner 3P%",r=>r.cornerPct??-1,r=>r.corner? `${f0(r.cornerPct)} <span style="color:var(--dimmer)">${r.cornerMade}/${r.corner}</span>` : "—"],
    ["abovePct","above the break",r=>r.abovePct??-1,r=>f0(r.abovePct)],
    ["deep",`${DEEP_FT}+ ft`,r=>r.deep,r=>r.deep? `${r.deep} <span style="color:var(--dimmer)">${f0(r.deepPct)}</span>` : "0"],
    ["avg","avg ft",r=>r.seasonFt??0,r=>f1(r.seasonFt)],
    ["recentPerG",`last ${RECENT_N}: per game`,r=>(r.recentPerG??0)-(r.perG??0),r=>r.recentPerG==null? "—" : `${f1(r.recentPerG)} <span style="color:var(--dim)">${sg(r.recentPerG-r.perG)}</span>`],
    ["recentPct",`last ${RECENT_N}: 3P%`,r=>(r.recentPct??0)-(r.pct??0),r=>r.recentPct==null? "—" : `${f0(r.recentPct)} <span style="color:var(--dim)">${sg(r.recentPct-r.pct,0)}</span>`],
    ["recentFt",`last ${RECENT_N}: avg ft`,r=>(r.recentFt??0)-(r.seasonFt??0),r=>r.recentFt==null? "—" : `${f1(r.recentFt)} <span style="color:var(--dim)">${sg(r.recentFt-r.seasonFt)}</span>`],
  ];
  const col=COLS.find(c=>c[0]===sortKey.k)||COLS[0];
  rows.sort((a,b)=>sortKey.d*(col[2](a)-col[2](b)) || b.att-a.att);
  card.appendChild(el("div","rule"));
  const wrap=el("div"); wrap.style.overflowX="auto";
  const tbl=el("table","per lb"); const th=el("tr");
  th.appendChild(el("th","","#")); th.appendChild(el("th","","shooter"));
  COLS.forEach(c=>{ const h=el("th","",c[1]+(c[0]===sortKey.k?(sortKey.d<0?" ▾":" ▴"):"")); h.style.cursor="pointer";
    h.title=c[0].startsWith("recent")? "Sorted by the change from his season" : "Click to sort";
    h.addEventListener("click",()=>{ if(sortKey.k===c[0]) sortKey.d=-sortKey.d; else { sortKey.k=c[0]; sortKey.d=-1; } renderRange(agg); });
    th.appendChild(h); });
  tbl.appendChild(th);
  rows.slice(0,60).forEach((r,i)=>{
    const tr=el("tr"); tr.appendChild(el("td","",String(i+1)));
    const td=el("td"); td.style.textAlign="left";
    td.innerHTML=`<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${tcol(r.tri)};margin-right:5px"></span>${esc(r.name)} <span style="color:var(--dim)">${r.tri}${tonight.has(r.tri)? " · vs "+tonight.get(r.tri) : ""}</span>`;
    tr.appendChild(td);
    COLS.forEach(c=>{ const d=el("td"); d.innerHTML=c[3](r); if(c[0]===sortKey.k){ d.style.color="var(--text)"; d.style.fontWeight="500"; } tr.appendChild(d); });
    tbl.appendChild(tr);
  });
  wrap.appendChild(tbl); card.appendChild(wrap);
  card.appendChild(noteEl(`Corner threes are the short ones along the baseline (${CORNER_D} ft), read from the shot's coordinate; `+
    `above the break is everything else. ${DEEP_FT}+ ft uses the distance ESPN states, or the coordinate. The last ${RECENT_N} are his `+
    `last ${RECENT_N} games played, a game without a three included; the grey number is the change from his season. `+
    `${rows.length>60? `Top 60 of ${rows.length} shown.` : ""}`));
}

export function renderRange(agg){
  const out=$("#out"); out.innerHTML="";
  const card=el("div","card"); out.appendChild(card);
  const league=agg.teams.length>1;

  const gh=el("div","gamehead");
  const sc=el("div","score"); const w=el("span","tri");
  if(!league){ const d=el("span","dot"); d.style.background=tcol(agg.teams[0]); w.appendChild(d); }
  w.appendChild(el("span","", league ? "League — three-point range"
    : `${(TEAM[agg.teams[0]]||{n:agg.teams[0]}).n} — three-point range`));
  sc.appendChild(w); gh.appendChild(sc);
  const m=el("div","meta");
  m.innerHTML=(agg.window.limit>0? `<b>last ${agg.window.limit}</b> games per team`
                                 : `<b>full regular season</b>`)
    + ` · ${agg.games} games · all three-point attempts`
    + ` · min. ${layoutMode()==="profile"? PROFILE_MIN_3PA : RANGE_MIN_3PA} attempts`
    + (agg.failed? ` · ${agg.failed} unavailable`:"");
  m.appendChild(el("span","badge ok",(SOURCE[ACTIVE]||{label:"?"}).label));
  gh.appendChild(m);
  card.appendChild(gh);

  if(layoutMode()==="profile"){ renderRangeProfile(card, agg); finishRender(); return; }
  const top=topWithTies(agg.eligible, RANGE_N, r=>r.avg);
  if(!top.length){
    card.appendChild(noteEl(
      `No shooter has reached ${RANGE_MIN_3PA} three-point attempts in this selection yet.`));
    finishRender(); return;
  }
  const ranks=denseRanks(top.map(r=>+r.avg.toFixed(1)));
  const counts={}; ranks.forEach(r=>{counts[r]=(counts[r]||0)+1;});

  /* Same aggregate, three presentations. The two posters answer questions the small
     multiples cannot: one shared axis makes the averages directly comparable, and the
     scatter puts accuracy beside distance. */
  const lay=layoutMode();
  if(lay==="plot"){ renderRangeCourt(card, agg); finishRender(); return; }
  if(lay==="scatter"){ renderRangeScatter(card, agg); finishRender(); return; }

  const grid=el("div","cgrid");
  top.forEach((r,i)=>{
    const cell=el("div","ccell");
    const hd=el("div","chead");
    hd.appendChild(el("span","crank",(counts[ranks[i]]>1?"T":"")+ranks[i]));
    const nm=el("span","cname",r.name); hd.appendChild(nm);
    const dot=el("span","dot"); dot.style.background=tcol(r.tri); hd.appendChild(dot);
    cell.appendChild(hd);
    cell.appendChild(el("div","cavg",`${r.avg.toFixed(1)} ft`));
    const sv=courtSvg(r.shots, 190, 150);
    sv.style.setProperty("--made", tcol(r.tri));
    cell.appendChild(sv);
    cell.appendChild(el("div","cfoot",
      `${r.att} attempts · ${r.pct.toFixed(1)}%`
      + (r.noSpot? ` · ${r.noSpot} unplotted`:"")));
    grid.appendChild(cell);
  });
  card.appendChild(grid);

  /* Precision, stated rather than implied. The average is only as good as the
     distances behind it, so the coverage and the two signals' disagreement are on
     screen instead of buried. */
  const tot=top.reduce((a,r)=>a+r.att,0);
  const noD=top.reduce((a,r)=>a+r.noDist,0);
  const nField=top.reduce((a,r)=>a+r.fromField,0);
  const nText=top.reduce((a,r)=>a+r.fromText,0);
  const nSpot=top.reduce((a,r)=>a+r.fromSpot,0);
  // 0.152.0: said briefly (the user, 11/24: "legible, and easily digestible"); the measurement detail is in the code
  const bits=[`Ranked by the average distance of every three he took, makes and misses (${tot-noD} of ${tot} attempts have one).`];
  if(nText) bits.push(`${nField ? "Some" : "Most"} distances are ESPN's whole feet, so a tenth of a foot between two players means little.`);
  bits.push(`Each dot is a shot's spot; several from one spot make a bigger dot.`);
  const nt=el("div","note"); nt.innerHTML=bits.join(" ");
  card.appendChild(nt);
  finishRender();
}

export async function showRange(){
  const t=$("#team").value;
  const tris = t ? [t] : [...$("#team").options].map(o=>o.value).filter(Boolean);
  const limit=spanValue();
  const bar=el("div","prog"); const fill=el("i"); bar.appendChild(fill);
  const what = t ? teamName(t) : `all ${franchises().length} teams`;
  setStatus(`<span class="spin"></span>Reading ${what}…`);
  $("#status").appendChild(bar);
  try{
    const agg=await buildRange(tris,limit,(done,total)=>{
      fill.style.width=(100*done/total)+"%";
      if($("#status").childNodes[1]) $("#status").childNodes[1].textContent=
        `Reading ${what}… ${done}/${total} games`;
    });
    if(allReadsFailed(agg.games, agg.failed)){ reportNoPbp(); return; }
    S.rangeAgg=agg; window.__RANGE=agg;
    renderRange(agg);
    hideStatus();
  }catch(e){
    $("#out").innerHTML="";
    setStatus(`<b>Couldn't build the range chart.</b><br>${String(e.message||e)}`+HOWTO,true);
  }
}
