/* Moved out of docs/gameflow.js unchanged (0.141.16: the Game Flow script split by section). */
import { $, ACTIVE, SOURCE, el, finishRender, label, noteEl, seasonLabel, tcol, teamName } from "../gameflow.js";
import { denseRanks } from "./sec-outliers.js";
import { layoutMode } from "./controls.js";
import { RANK_POSTER_N, rankPoster } from "./rank-poster.js";

/* ==================== section: holding the lead ====================
 * Two counts of games, not streaks:
 *   held    — went ahead and never lost the lead again
 *   neverLed — was never in front at any point
 * Both need the play-by-play. A final score cannot tell you whether a team led, and it
 * certainly cannot tell you whether it ever gave a lead back.
 *
 * An earlier version of this section showed the longest run without losing, which is a win
 * streak. That answered a different question and has been dropped.
 */
export function renderStreaks(agg){
  const out=$("#out"); out.innerHTML="";
  const card=el("div","card"); out.appendChild(card);

  const gh=el("div","gamehead");
  const sc=el("div","score"); const w=el("span","tri");
  w.appendChild(el("span","","League — leads & comebacks"));
  sc.appendChild(w); gh.appendChild(sc);
  const m=el("div","meta");
  m.innerHTML=(agg.window.limit>0? `<b>last ${agg.window.limit}</b> games per team`
                                 : `<b>full regular season</b>`)
    + ` · ${agg.games} games read`
    + (agg.failed? ` · ${agg.failed} unavailable`:"");
  m.appendChild(el("span","badge ok",(SOURCE[ACTIVE]||{label:"?"}).label));
  gh.appendChild(m); card.appendChild(gh);

  const table=(title, rows, cols, note)=>{
    card.appendChild(el("div","rule"));
    const h=el("div","sect nm",title);
    h.style.textAlign="left"; h.style.paddingRight="0"; card.appendChild(h);
    const tbl=el("table","per lb"); const th=el("tr");
    ["#"].concat(cols.map(c=>c[0])).forEach(x=>th.appendChild(el("th","",x)));
    tbl.appendChild(th);
    const key=cols[1][1];
    const rk=denseRanks(rows.map(t=>-key(t)));
    const rc={}; rk.forEach(r=>{rc[r]=(rc[r]||0)+1;});
    rows.forEach((t,i)=>{
      const tr=el("tr");
      tr.appendChild(el("td","",(rc[rk[i]]>1?"T":"")+rk[i]));
      cols.forEach(([label,val],k)=>{
        const td=el("td","",String(val(t)));
        if(k===0){ td.style.textAlign="left";
          td.innerHTML=`<span style="display:inline-block;width:8px;height:8px;border-radius:2px;`+
            `background:${tcol(t.tri)};margin-right:5px"></span>${t.tri}`; }
        if(k===1){ td.style.color="var(--text)"; td.style.fontWeight="500"; }
        tr.appendChild(td);
      });
      tbl.appendChild(tr);
    });
    card.appendChild(tbl);
    const n=el("div","note"); n.innerHTML=note; card.appendChild(n);
  };

  const pc=(a,b)=>b? (100*a/b).toFixed(0)+"%" : "—";

  if(layoutMode()==="poster"){
    const byTrail=agg.teams.slice().sort((a,b)=>b.neverTrailed-a.neverTrailed
      || a.tri.localeCompare(b.tri));
    const rk=denseRanks(byTrail.map(t=>-t.neverTrailed));
    const ct={}; rk.forEach(r=>{ct[r]=(ct[r]||0)+1;});
    card.appendChild(rankPoster({
      kick:`NBA ${seasonLabel()}`,
      title:"Games never trailing",
      cols:["team","games"],
      rows:byTrail.slice(0,RANK_POSTER_N).map((t,i)=>({
        rank:(ct[rk[i]]>1?"T":"")+rk[i],
        name:teamName(t.tri), tri:t.tri,
        sub:`${pc(t.neverTrailed,t.gp)} of ${t.gp} games · `+
            `${t.held} led then never behind`,
        value:String(t.neverTrailed), unit:pc(t.neverTrailed,t.gp),
        frac:t.gp? t.neverTrailed/t.gp : 0,
      })),
      notes:[`Never behind at any point. A game opens level at 0-0, which is not a deficit.`,
        `<b>Every one of these is a win</b>, since winning means being ahead at the final `+
        `whistle — the tests assert that rather than assuming it.`,
        `The bar is the share of that team's games, so teams with different game counts are `+
        `comparable; the number is the count.`],
    }));
    finishRender(); return;
  }

  /* One table, plain names (the user, 11/13: the old titles were confusing). Click a column to sort. */
  const COLS=[
    ["gp","Games",t=>t.gp,"games read"],
    ["wire","Wire to wire",t=>t.neverTrailed,"Never behind at any point: always a win"],
    ["forgood","Took the lead for good",t=>t.held-t.neverTrailed,"Fell behind, then took the lead and was never behind again: always a win"],
    ["blown","Blew a 10+ lead",t=>t.blown10,"Led by 10 or more at some point and lost"],
    ["never","Never led",t=>t.neverLed,"Never in front at any point: always a loss"],
    ["back","Came back from 10+ down",t=>t.comeback10,"Trailed by 10 or more at some point and won"],
  ];
  const sortKey = (window.__leadSort ||= {k:"wire", d:-1});
  const col=COLS.find(c=>c[0]===sortKey.k)||COLS[1];
  const rows=agg.teams.slice().sort((a,b)=>sortKey.d*(col[2](a)-col[2](b)) || a.tri.localeCompare(b.tri));
  card.appendChild(el("div","rule"));
  const tbl=el("table","per lb"); const th=el("tr");
  th.appendChild(el("th","","team"));
  COLS.forEach(c=>{ const h=el("th","",c[1]+(c[0]===sortKey.k?(sortKey.d<0?" ▾":" ▴"):"")); h.title=c[3]+". Click to sort.";
    h.style.cursor="pointer"; h.addEventListener("click",()=>{ if(sortKey.k===c[0]) sortKey.d=-sortKey.d; else { sortKey.k=c[0]; sortKey.d=-1; } renderStreaks(agg); });
    th.appendChild(h); });
  ["Biggest lead blown","Biggest comeback"].forEach(x=>th.appendChild(el("th","",x)));
  tbl.appendChild(th);
  const game = b => b? `${b.n} <span style="color:var(--dim)">(${b.home?"vs":"at"} ${b.opp}, ${new Date(b.date).toLocaleDateString(undefined,{month:"short",day:"numeric"})}, ${b.score})</span>` : "—";
  rows.forEach(t=>{
    const tr=el("tr");
    const td=el("td"); td.style.textAlign="left";
    td.innerHTML=`<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${tcol(t.tri)};margin-right:5px"></span>${t.tri}`;
    tr.appendChild(td);
    COLS.forEach(c=>{ const v=c[2](t); const d=el("td","",String(v)+(c[0]!=="gp" && t.gp? `<span style="color:var(--dimmer);margin-left:7px;font-size:.88em">(${pc(v,t.gp)})</span>`:""));
      d.innerHTML=String(v)+(c[0]!=="gp" && t.gp? `<span style="color:var(--dimmer);margin-left:7px;font-size:.88em">(${pc(v,t.gp)})</span>`:"");
      if(c[0]===sortKey.k){ d.style.color="var(--text)"; d.style.fontWeight="500"; } tr.appendChild(d); });
    [t.bigBlown,t.bigComeback].forEach(b=>{ const d=el("td"); d.innerHTML=game(b); d.style.textAlign="left"; tr.appendChild(d); });
    tbl.appendChild(tr);
  });
  card.appendChild(tbl);
  card.appendChild(noteEl(
    `<b>Wire to wire</b>: never behind at any point (a game opens level at 0-0, which is not a deficit), so always a win. `+
    `<b>Took the lead for good</b>: fell behind, then went ahead and was never behind again, also always a win. `+
    `<b>Never led</b>: never in front, always a loss. <b>Blew a 10+ lead</b> and <b>Came back from 10+ down</b> read the `+
    `biggest lead and deficit from the margin after every basket. Percentages are of the team's games. `+
    `(${agg.teams.reduce((a,t)=>a+t.heldStrict,0)} of the leads taken for good league-wide were never even tied again.)`));
  finishRender();
}

