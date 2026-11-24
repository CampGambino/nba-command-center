/* Moved out of docs/gameflow.js unchanged (0.153.0, the Game Flow split's part 2): section: outliers, the assist leaderboard and records boards, posters. */
import { headshot } from "./headshots.js";
import { buildBoard } from "./board.js";
import { S } from "./state.js";
import { $, ACTIVE, HOWTO, NON_COUNTING, POSTER_HS, SOURCE, TEAM, barAlpha, brandCol, el, esc, finishRender, hideStatus, noteEl, seasonLabel, setStatus, tcol, teamName, tint } from "../gameflow.js";
import { SHOT_LABEL, assistMetric, rankKey, rankMode, shotFilter } from "./controls.js";
import { astValue } from "./sec-assists.js";
import { spanValue } from "./sec-rotation.js";
import { allReadsFailed, franchises, reportNoPbp } from "./models.js";

/* ==================== outliers ====================
   Sample mean and standard deviation across qualified players, with anything at
   least 2 SD out flagged. Two honest caveats, both stated on screen: assist
   distributions are right-skewed, so a high z-score partly reflects the shape of
   the distribution rather than pure rarity; and with ~100 players you expect a
   couple of 2-SD readings by chance alone. Treat these as "look here", not proof. */
const Z_FLAG = 2;

const QUAL_GAMES = 5, QUAL_AST = 15;

function meanSd(xs){
  const n=xs.length;
  if(n<2) return {n, mean:xs[0]||0, sd:0};
  const mean=xs.reduce((a,b)=>a+b,0)/n;
  const sd=Math.sqrt(xs.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(n-1));
  return {n, mean, sd};
}

/** Metrics worth testing, each with how to read it and who qualifies. */
const OUTLIER_METRICS = [
  {key:"apg",  label:"assists per game", fmt:v=>v.toFixed(1),
   ok:r=>r.games>=QUAL_GAMES, get:r=>r.given/Math.max(1,r.games)},
  {key:"sh3",  label:"3-point share of assists", fmt:v=>Math.round(v*100)+"%",
   ok:r=>r.games>=QUAL_GAMES && r.given>=QUAL_AST, get:r=>r.given3/Math.max(1,r.given)},
  {key:"conc", label:"share of assists to one teammate", fmt:v=>Math.round(v*100)+"%",
   ok:r=>r.games>=QUAL_GAMES && r.given>=QUAL_AST,
   get:r=>{ const t=[...r.top.values()].sort((a,b)=>b-a)[0]||0; return t/Math.max(1,r.given); }},
  {key:"ppa",  label:"points created per assist", fmt:v=>v.toFixed(2),
   ok:r=>r.games>=QUAL_GAMES && r.given>=QUAL_AST, get:r=>r.gpts/Math.max(1,r.given)},
  {key:"recv", label:"assisted baskets received per game", fmt:v=>v.toFixed(1),
   ok:r=>r.games>=QUAL_GAMES, get:r=>r.got/Math.max(1,r.games)},
];

/* Metrics that still mean something for a single connection rather than a player. */
const PAIR_METRICS = ["apg","sh3","ppa"];

function findOutliers(rows, keys){
  const metrics = keys ? OUTLIER_METRICS.filter(m=>keys.includes(m.key)) : OUTLIER_METRICS;
  const out=[], byPlayer=new Map();
  for(const m of metrics){
    const pool=rows.filter(m.ok);
    if(pool.length<8) continue;                 // too few to talk about a distribution
    const vals=pool.map(m.get);
    const {mean,sd}=meanSd(vals);
    if(!(sd>0)) continue;
    pool.forEach((r,i)=>{
      const z=(vals[i]-mean)/sd;
      if(Math.abs(z)<Z_FLAG) return;
      const item={metric:m, row:r, value:vals[i], z, mean, sd, n:pool.length};
      out.push(item);
      const k=r.name+"||"+r.tri;
      if(!byPlayer.has(k)) byPlayer.set(k,new Map());
      byPlayer.get(k).set(m.key,item);
    });
  }
  out.sort((a,b)=>Math.abs(b.z)-Math.abs(a.z));
  return {items:out, byPlayer};
}

function zChip(z){
  const c=el("span","zt "+(z>0?"hi":"lo"), (z>0?"+":"")+z.toFixed(1)+" SD");
  return c;
}

function renderNotable(card, rows, keys){
  const found=findOutliers(rows, keys);
  const items=found.items;
  const box=el("div","notable");
  box.appendChild(el("h4","",`outliers · at least ${Z_FLAG} SD from the mean`));
  const ul=el("ul");
  if(!items.length){
    const li=el("li");
    li.appendChild(el("span","","Nothing beyond "+Z_FLAG+" SD in this selection — "+
      "either the group is tight or the sample is still small."));
    ul.appendChild(li);
  }else{
    items.slice(0,10).forEach(it=>{
      const li=el("li");
      li.appendChild(zChip(it.z));
      const txt=el("span");
      txt.innerHTML=`<b>${esc(it.row.name)}</b> <span style="color:var(--dimmer)">${esc(it.row.tri)}</span>`+
        ` — ${esc(it.metric.label)} <b>${it.metric.fmt(it.value)}</b>`+
        ` vs a league mean of ${it.metric.fmt(it.mean)}`+
        ` <span style="color:var(--dimmer)">(SD ${it.metric.fmt(it.sd)}, n=${it.n})</span>`;
      li.appendChild(txt);
      ul.appendChild(li);
    });
  }
  box.appendChild(ul);
  // the caveats live with the panel, so they can never be left behind by a view
  // that renders outliers but forgets the methodology note
  const cav=el("div","note");
  cav.style.marginTop="9px";
  cav.textContent=
    `Sample mean and standard deviation across ${keys?"pairs":"players"} with at least `+
    `${QUAL_GAMES} games (and ${QUAL_AST} assists for the rate measures), flagged at `+
    `${Z_FLAG} SD. Two things to keep in mind: assist distributions are right-skewed, so a `+
    `big positive z-score partly reflects the shape of the distribution rather than pure `+
    `rarity, and across a hundred-odd entries you'd expect two or three 2-SD readings by `+
    `chance. Read a flag as "look here", not as proof. Narrow windows exaggerate both.`;
  box.appendChild(cav);
  card.appendChild(box);
  return found.byPlayer;
}

/* ---- infographic: the top connections as a shareable poster ----
   Passer on the left, scorer on the right, headshots resolved from the player id
   the feed already provides. Deliberately its own layout rather than a restyled
   table: the table is for reading, this is for posting. */
const POSTER_N = 10;

const TRACK_PX = 300;          // must match the poster's middle grid column

/* A ring on a repeated portrait stops being a signal once half the rows carry one,
   so it's reserved for players who turn up three or more times. Two appearances is
   visible enough from the faces themselves. */
const RING_MIN = 3;

/* Competition ranking over a descending list: equal values share a rank and the
   next value skips (1, 2, 2, 4). Without this, tied rows get different numbers,
   which is simply wrong. */
export function denseRanks(values){
  const out=[]; let last=null, rank=0;
  values.forEach((v,i)=>{ if(v!==last){ rank=i+1; last=v; } out.push(rank); });
  return out;
}

/** Take the top n, then keep going while the next value ties the last one, so a
    tie at the cutoff is never silently dropped. */
export function topWithTies(ranked, n, valueOf){
  if(ranked.length<=n) return ranked.slice();
  const out=ranked.slice(0,n);
  const cut=valueOf(out[out.length-1]);
  for(let i=n;i<ranked.length && valueOf(ranked[i])===cut;i++) out.push(ranked[i]);
  return out;
}

function renderPoster(card, agg, ranked){
  const pts=assistMetric()==="pts";
  const league=agg.teams.length>1;
  const top=topWithTies(ranked, POSTER_N, r=>astValue(r,"given"));
  const ranks=denseRanks(top.map(r=>astValue(r,"given")));
  /* Three identical "10"s down the page look like a rendering fault. Sports
     convention marks a shared rank with a T, which reads as deliberate. */
  const rankCount={};
  ranks.forEach(r=>{ rankCount[r]=(rankCount[r]||0)+1; });
  const rankLabel=i=>(rankCount[ranks[i]]>1 ? "T" : "")+ranks[i];
  const peak=top.length? astValue(top[0],"given") : 1;

  const p=el("div","poster");
  const totGames=[...agg.gamesPerTeam.values()].reduce((a,b)=>a+b,0);
  const unit = pts ? "points" : "assists";

  /* The kicker used to read "… · PASSER → SCORER", written before the table had
     column headers. It now sits just above a header row saying PASSER and SCORER, so
     it labelled the same two columns twice. It carries only league and season now —
     the eyebrow orients a glancer, the footer carries the full scope. */
  p.appendChild(el("p","pkick", league ? `NBA ${seasonLabel()}`
                                       : `${teamName(agg.teams[0])} ${seasonLabel()}`));
  p.appendChild(el("h3","ptitle", pts ? "Where the points come from"
                                      : "The NBA's Best Assist Connections"));
  /* The scope used to sit under the title; it now rides in the footer so the
     headline has room to breathe without the provenance being lost. */
  const scope = `${SHOT_LABEL[shotFilter()]} · `+
    (agg.window.limit>0 ? `last ${agg.window.limit} games per team`
                        : `${seasonLabel()} regular season`)+
    ` · ${totGames} team-games · top ${top.length}, min. `+
    `${astValue(top[top.length-1],"given")} ${unit}.`;

  p.appendChild(el("div","prule"));

  // column names live here once, instead of beside all 22 players
  const hd=el("div","phead");
  hd.appendChild(el("div","h-rank",""));
  hd.appendChild(el("div","h-passer","passer"));
  hd.appendChild(el("div","h-mid", unit));
  hd.appendChild(el("div","h-scorer","scorer"));
  p.appendChild(hd);

  /* How often each player shows up anywhere in the list, either side. A hub that
     appears three times is the story the ranking alone doesn't tell. */
  const appearances=new Map();
  top.forEach(r=>{
    appearances.set(r.from,(appearances.get(r.from)||0)+1);
    appearances.set(r.to,(appearances.get(r.to)||0)+1);
  });
  /* Count the players who actually get a ring, not merely those who repeat. Gating
     the footer legend on n>1 explained a ring that wasn't on the poster whenever the
     most anyone appeared was twice — a legend for an absent encoding, which makes a
     reader hunt for something that isn't there. */
  const ringed=[...appearances.values()].filter(n=>n>=RING_MIN).length;
  const nameCell=(name)=>{
    const w=el("div"); w.style.minWidth="0";
    w.appendChild(el("div","pname",name));
    return w;
  };
  /** Portrait, ringed in the team colour when this player appears more than once. */
  const portrait=(name,id,tri)=>{
    const hs=headshot(name,id,tri,POSTER_HS);
    const n=appearances.get(name)||1;
    if(n>=RING_MIN){
      hs.classList.add("dup");
      hs.style.setProperty("--ring", brandCol(tri));   // the poster is white
    }
    if(n>1) hs.title=`${name} appears ${n} times in this top ${top.length}`;
    return hs;
  };

  top.forEach((r,i)=>{
    const row=el("div","prow"+(i===0?" lead":(i%2?" alt":"")));
    const v=astValue(r,"given");
    const frac=peak? v/peak : 0;

    row.appendChild(el("div","prank",rankLabel(i)));

    // passer: name then portrait, pushed right so it sits beside the number
    const L=el("div","pside");
    L.appendChild(nameCell(r.from));
    L.appendChild(portrait(r.from, r.fromId, r.tri));
    row.appendChild(L);

    /* the meter sits between the portraits: filled to this pair's share of the
       leader, with the number riding on top */
    const mid=el("div","pmid");
    const band=el("div","pband");
    const fillPct=Math.max(7, 100*frac);
    band.style.width=fillPct+"%";
    band.style.background=tint(r.tri, barAlpha(r.tri));
    mid.appendChild(band);

    /* Put the number just past the end of the fill so it labels the bar and the
       endpoint stays visible. Only when the bar is too long to leave room does it
       move inside, right-aligned — and there the endpoint is the track edge, so
       nothing is hidden. */
    const val=el("div","pval");
    val.appendChild(el("b","",String(v)));
    const chipPx=String(v).length*18+10;
    if((fillPct/100)*TRACK_PX + 10 + chipPx <= TRACK_PX) val.style.left=`calc(${fillPct}% + 10px)`;
    else val.style.right="11px";
    mid.appendChild(val);
    // same game-by-game breakdown the table carries, on the number itself
    if(r.log && r.log.size){
      const d=x=>new Date(x).toLocaleDateString(undefined,{month:"short",day:"numeric"});
      const entries=[...r.log.values()].sort((a,b)=>new Date(a.date)-new Date(b.date));
      mid.title=`${r.from} → ${r.to} — ${r.given} across ${entries.length} games\n`+
        entries.map(e=>`${d(e.date)} ${e.away}@${e.home}: ${e.n}`).join("\n");
    }
    row.appendChild(mid);

    // scorer: portrait then name, pushed left so it sits beside the number
    const R=el("div","pside r");
    R.appendChild(portrait(r.to, r.toId, r.tri));
    R.appendChild(nameCell(r.to));
    row.appendChild(R);

    p.appendChild(row);
  });

  const f=el("div","pfoot");
  f.appendChild(el("p","",
    scope+(ringed? ` A ring round a portrait means that player appears ${RING_MIN} `+
                   `or more times, on either side.` : "")+
    " Assisted field goals only, from official play-by-play. Free throws carry no assist "+
    "and unassisted baskets aren't counted, so this is the assist network rather than a "+
    "full passing chart. Direction matters: each row is one passer feeding one scorer."));
  f.appendChild(el("div","brand",
    `NBA GameFlow · ${(SOURCE[ACTIVE]||{label:"?"}).label}`));
  p.appendChild(f);
  card.appendChild(p);

  const tools=el("div","legend");
  const dl=el("button","","Download this poster");
  dl.style.font="inherit";
  dl.addEventListener("click",()=>downloadPoster(p));
  tools.appendChild(dl);
  tools.appendChild(el("span","",
    "Saves a standalone HTML file. Headshots load from the provider by player id, "+
    "so they stay current."));
  card.appendChild(tools);
}

/** Serialise the poster into a self-contained HTML file. */
export function downloadPoster(node, title, file){
  const css=[...document.styleSheets].map(s=>{
    try{ return [...s.cssRules].map(r=>r.cssText).join("\n"); }catch(e){ return ""; }
  }).join("\n");
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8">`+
    `<meta name="viewport" content="width=1104">`+
    `<title>${title||"The NBA's Best Assist Connections"}</title><style>`+
    `body{margin:0;background:#fff;padding:0;display:flex;justify-content:center;`+
    `font:13px/1.4 ui-sans-serif,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}`+
    `.poster{margin:0!important;border:none!important;border-radius:0!important}`+
    `${css}</style></head><body>${node.outerHTML}</body></html>`;
  const blob=new Blob([html],{type:"text/html"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=file||"nba-assist-connections.html";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}

/* ---- pair leaderboard: every passer -> scorer connection, ranked ---- */
function renderPairBoard(card, agg){
  const pts=assistMetric()==="pts";
  const gamesOf = tri => Math.max(1, agg.gamesPerTeam.get(tri)||1);
  const totals=new Map(agg.rows.map(r=>[String(r.id)+"||"+r.tri,r]));

  // shaped like a player row so the same outlier machinery applies
  const rows=agg.pairs.map(p=>({
    name:`${p.from} → ${p.to}`, tri:p.tri, from:p.from, to:p.to,
    fromId:p.fromId, toId:p.toId, log:p.log,
    games:gamesOf(p.tri),
    given:p.given, given2:p.given2, given3:p.given3, gpts:p.gpts,
    got:0, got2:0, got3:0, gotpts:0, top:new Map(), feed:new Map(),
  }));

  const ranked=rows.slice()
    .sort((a,b)=>astValue(b,"given")-astValue(a,"given") || b.gpts-a.gpts)
    .filter(r=>astValue(r,"given")>0);

  if(!ranked.length){
    card.appendChild(noteEl("No assisted baskets in this selection yet."));
    return;
  }

  if($("#layout") && $("#layout").value==="poster"){
    renderPoster(card, agg, ranked);
    return;
  }

  const flagged=renderNotable(card, rows, PAIR_METRICS);
  const flagFor=(r,key)=>{ const m=flagged.get(r.name+"||"+r.tri); return m? m.get(key):null; };
  const marker=(td,it)=>{
    if(!it) return;
    const s=el("span","om "+(it.z>0?"hi":"lo"), it.z>0?"▲":"▼");
    s.title=`${it.metric.label}: ${it.metric.fmt(it.value)} — `+
      `${(it.z>0?"+":"")+it.z.toFixed(1)} SD from a mean of ${it.metric.fmt(it.mean)} `+
      `across ${it.n} qualified pairs`;
    td.appendChild(s);
  };

  const tbl=el("table","per lb");
  const th=el("tr");
  ["#","passer","scorer","team", pts?"pts created":"assists","per game","on 2s","on 3s",
   "3pt share","pts created","% of passer's","% of scorer's"]
    .forEach((h,i)=>{
      const c=el("th","", h + (i===4? " ▼":""));
      if(i===4) c.style.color="var(--text)";
      th.appendChild(c);
    });
  tbl.appendChild(th);

  const pairRanks=denseRanks(ranked.map(r=>astValue(r,"given")));
  ranked.forEach((r,i)=>{
    const tr=el("tr");
    const v=astValue(r,"given");
    const passer=totals.get(String(r.fromId)+"||"+r.tri);
    const scorer=totals.get(String(r.toId)+"||"+r.tri);
    const ofPasser = passer && passer.given ? (100*r.given/passer.given).toFixed(0)+"%" : "—";
    const ofScorer = scorer && scorer.got   ? (100*r.given/scorer.got).toFixed(0)+"%" : "—";
    const cells=[String(pairRanks[i]), r.from, r.to, r.tri, String(v), (v/r.games).toFixed(2),
      String(r.given2), String(r.given3),
      r.given? (100*r.given3/r.given).toFixed(0)+"%":"—",
      String(r.gpts), ofPasser, ofScorer];
    /* game-by-game breakdown on the row, so a total that disagrees with another
       source can be traced to the game rather than argued about */
    if(r.log && r.log.size){
      const d=x=>new Date(x).toLocaleDateString(undefined,{month:"short",day:"numeric"});
      const entries=[...r.log.values()].sort((a,b)=>new Date(a.date)-new Date(b.date));
      tr.title=`${r.from} → ${r.to} — ${r.given} across ${entries.length} games\n`+
        entries.map(e=>`${d(e.date)} ${e.away}@${e.home}: ${e.n}`).join("\n");
    }
    cells.forEach((c,k)=>{
      const td=el("td","",c);
      if(k===1||k===2){ td.style.textAlign="left"; td.style.color="var(--text)"; }
      if(k===3){ td.style.textAlign="left";
        td.innerHTML=`<span style="display:inline-block;width:8px;height:8px;border-radius:2px;`+
          `background:${tcol(r.tri)};margin-right:5px"></span>${r.tri}`; }
      if(k===5) marker(td, flagFor(r,"apg"));
      if(k===8) marker(td, flagFor(r,"sh3"));
      if(k===9) marker(td, flagFor(r,"ppa"));
      tr.appendChild(td);
    });
    tbl.appendChild(tr);
  });
  card.appendChild(tbl); pageTable(card, tbl);

  card.appendChild(noteEl(
    "Every passer-to-scorer connection, ranked highest to lowest. \"% of passer's\" is how "+
    "much of that passer's total went to this scorer, and \"% of scorer's\" is how much of "+
    "that scorer's assisted baskets came from this passer — together they show whether a big "+
    "raw number is a real partnership or just two high-volume players sharing a floor. "+
    "Outliers here are measured across pairs, not players."));
  finishRender();
}

/* 0.71 (the user, 11/15: "too many rows… converted to pages so the scrolling isn't infinite"): a long leaderboard
   shows 25 rows a page, with the pages under it. The ranking and the outliers above it are unchanged. */
function pageTable(card, tbl, per = 25){
  const rows=[...tbl.querySelectorAll("tr")].slice(1);
  if(rows.length<=per) return;
  const pages=Math.ceil(rows.length/per);
  const nav=el("div","pager");
  nav.style.cssText="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 2px;font-size:12.5px";
  let at=0;
  const show=(p)=>{ at=Math.max(0,Math.min(pages-1,p)); rows.forEach((r,i)=>{ r.style.display = Math.floor(i/per)===at ? "" : "none"; }); draw(); };
  const btn=(label,p,on)=>{ const b=el("button","",label); b.style.cssText="padding:2px 8px;border:1px solid var(--line);border-radius:6px;background:"+(on?"var(--accent,#3b82f6)":"transparent")+";color:"+(on?"#fff":"var(--text)")+";cursor:pointer"; b.onclick=()=>show(p); return b; };
  const draw=()=>{ nav.innerHTML=""; nav.appendChild(btn("‹",at-1,false));
    for(let p=0;p<pages;p++) if(p<2||p>pages-3||Math.abs(p-at)<=1) nav.appendChild(btn(String(p+1),p,p===at)); else if(!nav.lastChild.dataset.gap){ const g=el("span","","…"); g.dataset.gap="1"; nav.appendChild(g); }
    nav.appendChild(btn("›",at+1,false)); nav.appendChild(el("span","",` rows ${at*per+1}–${Math.min(rows.length,(at+1)*per)} of ${rows.length}`)); };
  tbl.after(nav);
  show(0);
}

window.pageTable = pageTable; // reached by tools/check-pages.py

export function renderBoard(agg){
  const out=$("#out"); out.innerHTML="";
  const card=el("div","card"); out.appendChild(card);
  const pts=assistMetric()==="pts";
  const league=agg.teams.length>1;

  const gh=el("div","gamehead");
  const sc=el("div","score");
  const w=el("span","tri");
  if(!league){ const d=el("span","dot"); d.style.background=tcol(agg.teams[0]); w.appendChild(d); }
  w.appendChild(el("span","", league ? "League — assist leaderboard"
    : `${(TEAM[agg.teams[0]]||{n:agg.teams[0]}).n} — assist leaderboard`));
  sc.appendChild(w); gh.appendChild(sc);
  const totGames=[...agg.gamesPerTeam.values()].reduce((a,b)=>a+b,0);
  const m=el("div","meta");
  const mode=rankMode();
  const rankedBy = mode==="pair"
      ? (pts? "points created by each passer-to-scorer pair" : "player-to-player assisted baskets")
    : mode==="got"
      ? (pts? "points scored off assists" : "assisted baskets received")
      : (pts? "points created" : "assists created");
  /* Cup group-stage games and rescheduled games are ordinary regular-season games,
     so they're context, not a warning. Only something that shouldn't be in a season
     total gets the amber treatment. */
  const all=[...(agg.labels||new Map()).entries()];
  const improper=all.filter(([k])=>NON_COUNTING.test(k)).map(([k,n])=>`${n} ${k}`).join(", ");
  const context=all.filter(([k])=>!NON_COUNTING.test(k)).map(([k,n])=>`${n} ${k}`).join(", ");
  m.innerHTML = (agg.window.limit>0? `<b>last ${agg.window.limit}</b> games per team`
                                   : `<b>full regular season</b>`)
    + ` · ${agg.distinctGames||Math.round(totGames/2)} games`
    + (context? ` <span style="color:var(--dimmer)">(incl. ${context})</span>`:"")
    + (improper? ` <span style="color:var(--text-warning,#e2c078)">— warning: `+
                 `${improper} should not be in a season total</span>`:"")
    + (agg.failed? ` · ${agg.failed} unavailable`:"")
    + ` · ranked by <b>${rankedBy}</b>, most to least · ${SHOT_LABEL[shotFilter()]}`;
  m.appendChild(el("span","badge ok",(SOURCE[ACTIVE]||{label:"?"}).label));
  gh.appendChild(m);
  card.appendChild(gh);

  if(mode==="pair"){ renderPairBoard(card, agg); return; }

  /* Ranking by "created" reads the passer's side; ranking by "assisted baskets"
     flips the whole table to the scorer's side, so the columns describe how a
     player is set up rather than who he sets up. */
  const key = rankKey();
  const recv = key==="got";
  const tie = r => recv ? r.gotpts : r.gpts;
  // partner maps are keyed by id, so names are resolved here
  const nameById=new Map(agg.rows.map(r=>[String(r.id), r.name]));
  const ranked=agg.rows.slice()
    .sort((a,b)=>astValue(b,key)-astValue(a,key) || tie(b)-tie(a))
    .filter(r=>astValue(r,key)>0);

  if(!ranked.length){
    card.appendChild(noteEl("No assists found for this selection yet."));
    return;
  }

  const flagged = renderNotable(card, agg.rows);
  const flagFor = (r,key) => {
    const m=flagged.get(r.name+"||"+r.tri);
    return m? m.get(key) : null;
  };
  const marker = (td,it) => {
    if(!it) return;
    const s=el("span","om "+(it.z>0?"hi":"lo"), it.z>0?"▲":"▼");
    s.title=`${it.metric.label}: ${it.metric.fmt(it.value)} — `+
      `${(it.z>0?"+":"")+it.z.toFixed(1)} SD from a mean of ${it.metric.fmt(it.mean)} `+
      `across ${it.n} qualified players`;
    td.appendChild(s);
  };

  const tbl=el("table","per lb");
  const th=el("tr");
  const headers = recv
    ? ["#","player","team","gp", pts?"pts received":"assisted baskets", "per game",
       "on 2s","on 3s","3pt share","pts off assists","assists created","top feeder"]
    : ["#","player","team","gp", pts?"pts created":"ast", "per game",
       "on 2s","on 3s","3pt share","pts created","assisted baskets","top target"];
  headers.forEach((h,i)=>{
    const cell=el("th","", h + (i===4? " ▼" : ""));
    if(i===4) cell.style.color="var(--text)";
    th.appendChild(cell);
  });
  tbl.appendChild(th);

  const playerRanks=denseRanks(ranked.map(r=>astValue(r,key)));
  ranked.forEach((r,i)=>{
    const tr=el("tr");
    const v=astValue(r,key);
    const gp=Math.max(1,r.games);
    const partnerId=[...(recv? r.feed : r.top).entries()].sort((a,b)=>b[1]-a[1])[0];
    const partner=partnerId
      ? [nameById.get(partnerId[0]) || "—", partnerId[1]] : null;
    const n2 = recv? r.got2 : r.given2, n3 = recv? r.got3 : r.given3;
    const nAll = recv? r.got : r.given;
    const cells=[
      String(playerRanks[i]), r.name, r.tri, String(r.games), String(v), (v/gp).toFixed(1),
      String(n2), String(n3),
      nAll? (100*n3/nAll).toFixed(0)+"%" : "—",
      String(recv? r.gotpts : r.gpts),
      String(astValue(r, recv? "given" : "got")),
      partner? `${partner[0]} (${partner[1]})` : "—",
    ];
    cells.forEach((c,k)=>{
      const td=el("td","",c);
      if(k===1){ td.style.textAlign="left"; td.style.color="var(--text)"; }
      if(k===2){ td.style.textAlign="left";
                 td.innerHTML=`<span style="display:inline-block;width:8px;height:8px;`+
                   `border-radius:2px;background:${tcol(r.tri)};margin-right:5px"></span>${r.tri}`; }
      if(k===11) td.style.textAlign="left";
      // mark the columns the outlier test actually covers, per perspective
      if(k===5)  marker(td, flagFor(r, recv? "recv" : "apg"));
      if(!recv && k===8)  marker(td, flagFor(r,"sh3"));
      if(!recv && k===9)  marker(td, flagFor(r,"ppa"));
      if(!recv && k===10) marker(td, flagFor(r,"recv"));
      if(!recv && k===11) marker(td, flagFor(r,"conc"));
      if(recv && k===10)  marker(td, flagFor(r,"apg"));
      tr.appendChild(td);
    });
    tbl.appendChild(tr);
  });
  card.appendChild(tbl); pageTable(card, tbl);

  card.appendChild(noteEl(
    (recv
      ? "Ranked by baskets that came off a teammate's pass, most to least — the scorer's "+
        "side of the network. \"On 2s\" and \"on 3s\" split those baskets by what they were "+
        "worth, \"3pt share\" is the fraction that were threes, and \"top feeder\" is whoever "+
        "set him up most often. A high number here means productive, not passive: it counts "+
        "made baskets. Pair it with the created column to see who does both."
      : "Ranked by assists created, most to least. \"On 2s\" and \"on 3s\" split the same "+
        "assists by what the basket was worth, and \"3pt share\" is the fraction that "+
        "produced a three — a quick read on whether someone feeds shooters or finishers. "+
        "Switch the rank dropdown to see the receiving side.")
    + " Free throws carry no assist, and unassisted baskets aren't in the play-by-play, so "+
      "this is the assist network rather than a passing chart."));
  finishRender();
}

export async function showBoard(){
  const t=$("#team").value;
  const tris = t ? [t] : [...$("#team").options].map(o=>o.value).filter(Boolean);
  const limit=spanValue();
  const bar=el("div","prog"); const fill=el("i"); bar.appendChild(fill);
  const what = t ? teamName(t) : `all ${franchises().length} teams`;
  setStatus(`<span class="spin"></span>Reading ${what}…`+
    (t? "" : " — the first league-wide read takes a while, then it's cached"));
  $("#status").appendChild(bar);
  try{
    const agg=await buildBoard(tris,limit,(done,total)=>{
      fill.style.width=(100*done/total)+"%";
      if($("#status").childNodes[1]) $("#status").childNodes[1].textContent=
        `Reading ${what}… ${done}/${total} games`;
    });
    if(allReadsFailed(agg.requested, agg.failed)){ reportNoPbp(); return; }
    S.boardAgg=agg; window.__BOARD=agg;
    renderBoard(agg);
    hideStatus();
  }catch(e){
    $("#out").innerHTML="";
    setStatus(`<b>Couldn't build the leaderboard.</b><br>${String(e.message||e)}`+HOWTO,true);
  }
}
