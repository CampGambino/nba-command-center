/* Moved out of docs/gameflow.js unchanged (0.141.16: the Game Flow script split by section). */
import { $, ACTIVE, SOURCE, el, esc, finishRender, noteEl } from "../gameflow.js";
import { layoutMode } from "./controls.js";

/* ==================== section: with / without a teammate ====================
 * One player's box lines, split by whether a second player appeared in that game. The
 * question "how did X do when Y sat out" needs three things the season totals cannot give:
 * per-game lines for X, the set of players who actually appeared in each game, and the
 * discipline to compare only games X himself played. That last point is the trap — the
 * denominator is X's games, not the team's, or a player who was also injured looks worse.
 *
 * "Did not play" means did not appear in the box score. A listed-but-unused player is a DNP
 * in both feeds, so this matches how a reader would count it.
 */
export function splitByTeammate(agg, aId, bId){
  const A=agg.player.get(String(aId));
  const bKey=String(bId);
  if(!A) return null;
  /* Three buckets, not two. A player traded mid-season has games from before the move where
     the other player was on a different roster entirely — those are not "without him", they
     are "not teammates yet", and folding them into the without side was wrong. */
  const withB=[], withoutB=[], apart=[];
  for(const g of A.games){
    const f=agg.frameBy && agg.frameBy.get(g.gameId);
    const mine=(f && f.team[A]) || g.tri;
    const theirs=f && f.team[bKey];
    if(!theirs || theirs!==mine){ apart.push(g); continue; }
    const ap=agg.appear.get(g.gameId);
    (ap && ap.has(bKey) ? withB : withoutB).push(g);
  }
  const sum=list=>{
    const t={n:list.length, min:0, pts:0, reb:0, ast:0, stl:0, blk:0, to:0,
             fgm:0, fga:0, tpm:0, tpa:0, ftm:0, fta:0, pf:0};
    list.forEach(g=>{ const L=g.line||{};
      ["min","pts","reb","ast","stl","blk","to","fgm","fga","tpm","tpa","ftm","fta","pf"]
        .forEach(k=>{ t[k]+=L[k]||0; }); });
    return t;
  };
  return {a:A, withB, withoutB, apart,
          sumWith:sum(withB), sumWithout:sum(withoutB)};
}

/* ---- interval arithmetic, for on/off inside a game ----
 * Intervals are [start, end) in seconds of game clock. Plain sorted arrays: a game has a
 * handful per player, so nothing cleverer earns its keep.
 */
export const ivSec = a => a.reduce((s2,[x,y])=>s2+Math.max(0,y-x), 0);
export function ivAnd(a, b){
  const out=[]; let i=0, j=0;
  while(i<a.length && j<b.length){
    const lo=Math.max(a[i][0], b[j][0]), hi=Math.min(a[i][1], b[j][1]);
    if(hi>lo) out.push([lo,hi]);
    if(a[i][1] < b[j][1]) i++; else j++;
  }
  return out;
}
/** a minus b: the parts of a that b does not cover. */
export function ivSub(a, b){
  const out=[];
  for(const [s0,e0] of a){
    let cur=[[s0,e0]];
    for(const [s1,e1] of b){
      const next=[];
      for(const [x,y] of cur){
        if(e1<=x || s1>=y){ next.push([x,y]); continue; }
        if(s1>x) next.push([x, Math.min(s1,y)]);
        if(e1<y) next.push([Math.max(e1,x), y]);
      }
      cur=next;
    }
    out.push(...cur);
  }
  return out.filter(([x,y])=>y>x);
}
/* Half-open: an interval includes its start and excludes its end, so an event exactly on
   a substitution boundary lands once rather than in both buckets. */
export const ivHas = (a, t) => a.some(([x,y])=>t>=x && t<y);

/* On/off inside the game: A's own production and his team's margin over the seconds he and
 * B were both on the floor, against the seconds he was on and B was not. Only A's own
 * minutes count on either side — the point is to hold A constant and vary B.
 */
export function onOffSplit(agg, aId, bId){
  const A=String(aId), B=String(bId);
  const blank=()=>({sec:0, pts:0, fgm:0, fga:0, tpm:0, tpa:0, ftm:0, fta:0,
                    ast:0, reb:0, to:0, teamFor:0, teamAgs:0, games:0});
  const both=blank(), only=blank();
  let apart=0;
  for(const f of (agg.frames||[])){
    const ai=f.iv[A]; if(!ai || !ai.length) continue;
    /* Same roster only. Otherwise every minute from before a trade counts as "B off court",
       which is true in the trivial sense and useless as a comparison. */
    const mine=f.team && f.team[A], theirs=f.team && f.team[B];
    if(!theirs || theirs!==mine){ apart++; continue; }
    const bi=f.iv[B] || [];
    const shared=ivAnd(ai, bi), alone=ivSub(ai, bi);
    both.sec+=ivSec(shared); only.sec+=ivSec(alone);
    if(ivSec(shared)>0) both.games++;
    if(ivSec(alone)>0) only.games++;
    const aSide=(f.ev.find(e=>e.pid===A && e.side!=null)||{}).side;
    for(const e of f.ev){
      const bucket = ivHas(shared, e.t) ? both : (ivHas(alone, e.t) ? only : null);
      if(!bucket) continue;
      if(e.pid===A){
        if(e.k==="pts") bucket.pts+=e.v;
        else if(e.k==="fgm"){ bucket.fgm++; bucket.fga++;
          if(e.v===3){ bucket.tpm++; bucket.tpa++; } }
        else if(e.k==="fga0"){ bucket.fga++; if(e.v===3) bucket.tpa++; }
        else if(e.k==="ftm"){ bucket.ftm++; bucket.fta++; }
        else if(e.k==="fta0") bucket.fta++;
        else if(e.k==="ast") bucket.ast++;
        else if(e.k==="reb") bucket.reb++;
        else if(e.k==="to") bucket.to++;
      }
      if(e.k==="pts" && aSide!=null && e.side!=null){
        if(e.side===aSide) bucket.teamFor+=e.v; else bucket.teamAgs+=e.v;
      }
    }
  }
  return {both, only, apart};
}

function renderOnOff(agg, card, aId, bId){
  const A=agg.player.get(String(aId)), B=agg.player.get(String(bId));
  const {both, only, apart}=onOffSplit(agg, aId, bId);
  const aName=A?A.name:"that player", bName=B?B.name:"that player";

  card.appendChild(el("div","rule"));
  const h=el("div","sect nm",`${aName} — on court, with and without ${bName}`);
  h.style.textAlign="left"; h.style.paddingRight="0"; card.appendChild(h);

  if(apart)
    card.appendChild(noteEl(
      `<b>${apart} game${apart===1?"":"s"} set aside</b> where the two were not on the same `+
      `roster. Without that check every minute from before a trade would count as `+
      `"${bName} off court", which is true in the trivial sense and useless as a comparison.`));
  if(both.sec<1 && only.sec<1){
    card.appendChild(noteEl(
      `No shared-roster floor time found for ${aName} with ${bName} in this selection.`));
    finishRender(); return;
  }
  if(both.sec<1)
    card.appendChild(noteEl(
      `<b>${aName} and ${bName} have never been on the floor together.</b> On/off needs `+
      `shared minutes to compare, so only one side of this split exists — which is exactly `+
      `what you should expect if they are not teammates.`));

  const per36=(t,k)=>t.sec? (t[k]*2160/t.sec) : 0;   // 36 minutes = 2160 seconds
  const pc=(m,a2)=>a2? (100*m/a2).toFixed(1)+"%" : "—";
  const row=(label,t)=>{
    const tr=el("tr");
    const net=t.teamFor-t.teamAgs;
    [label, (t.sec/60).toFixed(1), String(t.games),
     per36(t,"pts").toFixed(1), per36(t,"reb").toFixed(1), per36(t,"ast").toFixed(1),
     per36(t,"to").toFixed(1), `${t.fgm}-${t.fga}`, pc(t.fgm,t.fga),
     `${t.tpm}-${t.tpa}`, pc(t.tpm,t.tpa),
     (net>=0?"+":"")+net,
     t.sec? ((net*2400/t.sec>=0?"+":"")+(net*2400/t.sec).toFixed(1)) : "—"]
      .forEach((c,k)=>{
        const td=el("td","",c);
        if(k===0){ td.style.textAlign="left"; td.style.color="var(--text)";
                   td.style.fontWeight="600"; }
        if(k===3){ td.style.color="var(--text)"; td.style.fontWeight="500"; }
        tr.appendChild(td);
      });
    return tr;
  };
  const tbl=el("table","per lb"); const th=el("tr");
  ["split","minutes","games","pts/36","reb/36","ast/36","to/36","fg","fg%","3pt","3p%",
   "team +/−","per 40"].forEach(x=>th.appendChild(el("th","",x)));
  tbl.appendChild(th);
  tbl.appendChild(row(`${bName} on court`, both));
  tbl.appendChild(row(`${bName} off court`, only));
  card.appendChild(tbl);

  card.appendChild(noteEl(
    `Measured in <b>seconds of shared floor time</b>, not games. Both rows count only `+
    `minutes ${aName} himself was on the court — ${bName} is the variable and ${aName} is `+
    `held constant, which is what makes the two rows comparable.<br>`+
    `Rates are per 36 minutes so the two sides compare despite different sample sizes; `+
    `<b>team +/−</b> is his team's margin over those same seconds and <b>per 40</b> scales `+
    `it to a full game. The samples here are <b>${(both.sec/60).toFixed(0)} and `+
    `${(only.sec/60).toFixed(0)} minutes</b> — a per-36 rate off a couple of minutes is not `+
    `a rate, it is one possession with a multiplier on it.<br>`+
    `Steals and blocks are absent on purpose: the league feed records them as a field on `+
    `another player's action rather than as their own, and the normalised ESPN shape does `+
    `not keep them, so counting them here would be guesswork.`));
  finishRender();
}

export function renderSplits(agg){
  const out=$("#out"); out.innerHTML="";
  const card=el("div","card"); out.appendChild(card);

  // the pickers are filled from the league read, so they only offer players who appeared
  /* The team selector used to be live but ignored here, which is worse than disabling it:
     it looks like it filters and does not. With a team chosen the pickers offer that roster;
     on "All teams" they offer the league, which is what makes cross-team comparisons
     possible at all. */
  const tri=$("#team").value;
  const people=[...agg.player.values()]
    .filter(p=>p.games.length && (!tri || p.tri===tri))
    .sort((a,b)=>a.name.localeCompare(b.name));
  const fill=(sel, keep)=>{
    sel.innerHTML="";
    people.forEach(p=>{ const o=document.createElement("option");
      o.value=String(p.id); o.textContent=`${p.name} · ${p.tri}`; sel.appendChild(o); });
    if(keep && people.some(p=>String(p.id)===keep)) sel.value=keep;
  };
  const s1=$("#who1"), s2=$("#who2");
  const stamp2=(tri||"all")+":"+people.length;
  if(s1.dataset.filled!==stamp2){
    fill(s1, s1.value); fill(s2, s2.value);
    /* Opening with the same player in both slots produces "without himself: 0 games", which
       reads like a fault in the data rather than a default. */
    if(s2.value===s1.value && people.length>1)
      s2.value=String(people.find(p=>String(p.id)!==s1.value).id);
    s1.dataset.filled=s2.dataset.filled=stamp2;
  }
  /* After refilling, not before: bailing out first left the previous team's roster sitting in
     the pickers, so they showed names the current filter excludes. */
  if(!people.length){
    card.appendChild(noteEl(
      `No players found for ${tri||"the league"} yet. A player is listed under his most `+
      `recent team, so a mid-season move puts him under the new one.`));
    finishRender(); return;
  }

  const gh=el("div","gamehead");
  const sc=el("div","score"); const w=el("span","tri");
  w.appendChild(el("span","","League — on / off court, with and without a teammate"));
  sc.appendChild(w); gh.appendChild(sc);
  const m=el("div","meta");
  m.innerHTML=(agg.window.limit>0? `<b>last ${agg.window.limit}</b> games per team`
                                 : `<b>full regular season</b>`)
    + ` · ${agg.games} games read · ${people.length} players`;
  m.appendChild(el("span","badge ok",(SOURCE[ACTIVE]||{label:"?"}).label));
  gh.appendChild(m); card.appendChild(gh);

  if(s1.value===s2.value && layoutMode()==="court"){
    card.appendChild(noteEl(
      `<b>Both pickers are on the same player.</b> On/off against himself puts every `+
      `second on the "on court" side and none on the other. Choose a different second `+
      `player.`));
    finishRender(); return;
  }
  if(s1.value===s2.value){
    card.appendChild(noteEl(
      `<b>Both pickers are on the same player.</b> Comparing someone with himself puts every `+
      `game, and every second, on the "with" side and none on the other — that is arithmetic, `+
      `not a split. Choose a different second player.`));
    finishRender(); return;
  }
  if(layoutMode()==="court"){ renderOnOff(agg, card, s1.value, s2.value); return; }

  const sp=splitByTeammate(agg, s1.value, s2.value);
  if(!sp){ card.appendChild(noteEl("Pick a player."));
           finishRender(); return; }
  const B=agg.player.get(s2.value);
  const bName=B? B.name : "that player";

  if(sp.a.tri!==(B&&B.tri))
    card.appendChild(noteEl(
      `<b>${esc(sp.a.name)} (${sp.a.tri}) and ${esc(bName)}${B?` (${B.tri})`:""} are not teammates.</b> `+
      `The split still computes, but "without ${esc(bName)}" then means almost every game `+
      `${esc(sp.a.name)} played, which is rarely the question worth asking.`));

  const pct=(m2,a2)=>a2? (100*m2/a2).toFixed(1)+"%" : "—";
  const avgRow=(label, t)=>{
    const tr=el("tr");
    const per=k=>t.n? (t[k]/t.n) : 0;
    [label, String(t.n), per("min").toFixed(1), per("pts").toFixed(1),
     per("reb").toFixed(1), per("ast").toFixed(1), per("stl").toFixed(1),
     per("blk").toFixed(1), per("to").toFixed(1),
     `${t.fgm}-${t.fga}`, pct(t.fgm,t.fga),
     `${t.tpm}-${t.tpa}`, pct(t.tpm,t.tpa),
     `${t.ftm}-${t.fta}`, pct(t.ftm,t.fta)].forEach((c,k)=>{
      const td=el("td","",c);
      if(k===0){ td.style.textAlign="left"; td.style.color="var(--text)";
                 td.style.fontWeight="600"; }
      if(k===3){ td.style.color="var(--text)"; td.style.fontWeight="500"; }
      tr.appendChild(td);
    });
    return tr;
  };

  card.appendChild(el("div","rule"));
  const h=el("div","sect nm",`${sp.a.name} — per game`);
  h.style.textAlign="left"; h.style.paddingRight="0"; card.appendChild(h);
  const tbl=el("table","per lb"); const th=el("tr");
  ["split","games","min","pts","reb","ast","stl","blk","to","fg","fg%","3pt","3p%","ft","ft%"]
    .forEach(x=>th.appendChild(el("th","",x)));
  tbl.appendChild(th);
  tbl.appendChild(avgRow(`without ${bName}`, sp.sumWithout));
  tbl.appendChild(avgRow(`with ${bName}`, sp.sumWith));
  card.appendChild(tbl);

  const d=(k)=>{
    const a2=sp.sumWithout.n? sp.sumWithout[k]/sp.sumWithout.n : 0;
    const b2=sp.sumWith.n? sp.sumWith[k]/sp.sumWith.n : 0;
    const v=a2-b2; return (v>0?"+":"")+v.toFixed(1);
  };
  if(sp.apart.length){
    const tris=[...new Set(sp.apart.map(g=>g.tri).filter(Boolean))];
    card.appendChild(noteEl(
      `<b>${sp.apart.length} of ${esc(sp.a.name)}'s ${sp.a.games.length} games are set aside:</b> `+
      `in those the two were not on the same roster${tris.length? ` (he was with `+
      `${tris.join(", ")})`:""}, so they are neither "with" nor "without" — they are before or `+
      `after the two were teammates. Counting them as "without" is what made a traded `+
      `player's split read as though his teammate had missed most of the season.`));
  }
  card.appendChild(noteEl(
    `Averages, not totals. Without ${bName} versus with: `+
    `<b>${d("pts")} points</b>, ${d("reb")} rebounds, ${d("ast")} assists, `+
    `${d("min")} minutes.<br>`+
    `The denominator is <b>${esc(sp.a.name)}'s own games</b>, not the team's — counting games he `+
    `also missed would drag the split for a reason that has nothing to do with ${bName}. `+
    `<b>${sp.sumWithout.n} game${sp.sumWithout.n===1?"":"s"} without</b> is a small sample; `+
    `a single outing moves a per-game average by several points at this size.`));

  const list=(title, games)=>{
    if(!games.length) return;
    card.appendChild(el("div","rule"));
    const hh=el("div","sect nm",title);
    hh.style.textAlign="left"; hh.style.paddingRight="0"; card.appendChild(hh);
    const t=el("table","per lb"); const h2=el("tr");
    ["date","opp","min","pts","reb","ast","stl","blk","to","fg","3pt","ft"]
      .forEach(x=>h2.appendChild(el("th","",x)));
    t.appendChild(h2);
    games.slice().sort((x,y)=>new Date(x.date)-new Date(y.date)).forEach(g=>{
      const L=g.line||{}; const tr=el("tr");
      [new Date(g.date).toLocaleDateString(undefined,{month:"short",day:"numeric"}),
       `${g.home?"vs":"at"} ${g.opp}`,
       (L.min||0).toFixed(1), String(L.pts||0), String(L.reb||0), String(L.ast||0),
       String(L.stl||0), String(L.blk||0), String(L.to||0),
       `${L.fgm||0}-${L.fga||0}`, `${L.tpm||0}-${L.tpa||0}`, `${L.ftm||0}-${L.fta||0}`]
        .forEach((c,k)=>{
          const td=el("td","",c);
          if(k===0||k===1) td.style.textAlign="left";
          if(k===3){ td.style.color="var(--text)"; td.style.fontWeight="500"; }
          tr.appendChild(td);
        });
      t.appendChild(tr);
    });
    card.appendChild(t);
  };
  list(`Games without ${bName}`, sp.withoutB);
  finishRender();
}

