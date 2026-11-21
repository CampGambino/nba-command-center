/* Moved out of docs/gameflow.js unchanged (0.141.16: the Game Flow script split by section). */
import { $, FORM_CATS, FORM_FLOORS, FORM_LENS, FORM_MIN_BASE, FORM_STATS, brandCol, el } from "../gameflow.js";
import { posterFoot, posterShell } from "./range.js";
import { dayNum } from "./rest.js";
import { headshot } from "./headshots.js";

/* ==================== section: the hot hand ====================
 * Whether a player's last few games are above his own normal, in his own units. A 20-point
 * scorer putting up 26 is not the same event as an 8-point scorer putting up 14, so the
 * comparison is against his own spread rather than against the league.
 *
 * Three decisions worth stating, because each could reasonably have gone the other way:
 *
 *   - The stretch is the last N games HE PLAYED, not the last N his team played. A player
 *     who sat two of the team's last five has a five-game stretch that reaches further back,
 *     and those five are the ones that describe his form.
 *   - His "normal" is every OTHER game, not the season. Leave the stretch in the baseline and
 *     it drags the baseline toward itself, which shrinks exactly the gap being measured - the
 *     same reason the defense splits compare against the complement rather than the season.
 *   - The spread is the standard deviation of his single games. That is the intuitive reading
 *     of "a standard deviation above normal", and the one asked for; it is not the standard
 *     error of an N-game mean, which is smaller by a factor of root N. The note says so,
 *     because the two answer different questions.
 */
const formLen  = () => { const v=$("#form")? parseInt($("#form").value,10) : 0;
                         return FORM_LENS.includes(v)? v : FORM_LENS[FORM_LENS.length-1]; };
const formStat = () => { const v=$("#stat")? $("#stat").value : "pts";
                         return FORM_STATS[v]? v : "pts"; };
const formDir  = () => /dn$/.test($("#rank")? $("#rank").value : "") ? "down" : "up";
const formFloor = () => { const v=$("#floor")? parseFloat($("#floor").value) : 0;
                          return Number.isFinite(v)? v : 0; };
const formMins  = () => { const v=$("#mins")? parseFloat($("#mins").value) : 0;
                          return Number.isFinite(v)? v : 0; };
/* Rebuilt per stat, because a floor of ten is a lot of assists and not many points. The
   previous choice is kept when the new stat also offers it. */
export function setFloorOptions(){
  const sel=$("#floor"); if(!sel) return;
  const key=formStat(), want=FORM_FLOORS[key]||FORM_FLOORS.pts;
  const same=sel.options.length===want.length
    && want.every((v,i)=>sel.options[i].value===String(v));
  if(same) return;
  const keep=sel.value;
  sel.innerHTML="";
  want.forEach(v=>sel.appendChild(new Option(
    v===0? "no floor" : `${v}+ ${key==="min"?"min":FORM_STATS[key].split(" ")[0]}`,
    String(v))));
  sel.value = want.some(v=>String(v)===keep)? keep : String(want[0]);
}
const formSd   = () => { const m=/^sd(\d+)(up|dn)$/.exec($("#rank")? $("#rank").value:"");
                         return m? (+m[1])/10 : 1; };
export function fillFormLens(){
  const sel=$("#form"); if(!sel || sel.options.length) return;
  FORM_LENS.forEach(n=>sel.appendChild(new Option(`last ${n} games played`, String(n))));
  sel.value=String(FORM_LENS[FORM_LENS.length-1]);
}

/* Points come off the box score's own total; everything else off the kept line. Minutes are
   already a float there, so a 23:40 stint reads as 23.7 rather than 23. */
export const statOf = (g, k) => {
  if(k==="pts") return g.pts||0;
  const L=g.line||{};
  if(k==="pra") return (g.pts||0)+(L.reb||0)+(L.ast||0);
  return L[k]||0;
};
/* One game, written the way these read out loud: the counting stats, then the shooting, then
   the minutes. Shooting only when he took a shot, threes only when he took one. */
export function slashLine(g){
  const L=g.line||{};
  const bits=[`${statOf(g,"pts")} PTS`];
  if(L.reb) bits.push(`${L.reb} REB`);
  if(L.ast) bits.push(`${L.ast} AST`);
  if(L.to)  bits.push(`${L.to} TO`);
  if(L.fga) bits.push(`${L.fgm||0}-${L.fga} FG`);
  if(L.tpa) bits.push(`${L.tpm||0}-${L.tpa} 3PT`);
  if(L.min) bits.push(`${Math.round(L.min)} MIN`);
  return bits.join(", ");
}
export const avgOf = a => a.length? a.reduce((s,v)=>s+v,0)/a.length : null;
export const medOf = a => {
  if(!a.length) return null;
  const v=a.slice().sort((x,y)=>x-y), h=v.length>>1;
  return v.length%2? v[h] : (v[h-1]+v[h])/2;
};
/* Sample standard deviation: these are the games he happens to have played, not the
   population of games he could play, so the denominator is n-1. */
export function sdOf(a){
  if(a.length<2) return null;
  const m=avgOf(a);
  return Math.sqrt(a.reduce((s,v)=>s+(v-m)*(v-m),0)/(a.length-1));
}

/* How many of points, rebounds and assists moved the same way. The one-line answer to "is
   he up across the board" without turning the section into three sections. */
export function catMoves(games, len, down){
  const out=[];
  for(const c of FORM_CATS){
    const v=games.map(g=>statOf(g,c));
    const rm=avgOf(v.slice(-len)), bm=avgOf(v.slice(0,-len));
    if(rm==null || bm==null) continue;
    out.push({cat:c, recent:rm, base:bm, moved: down? rm<bm : rm>bm});
  }
  return out;
}

/* When did he last play, and how much has his team played since. A stretch that ended weeks
   ago is not current form, and the difference is invisible in the numbers themselves. */
export function staleness(agg, pr, games){
  const last=games[games.length-1];
  if(!last) return {};
  const lastDay=dayNum(last.date);
  const rows=(agg.teamGames||[]).filter(r=>r.tri===pr.tri);
  const since=rows.filter(r=>{ const d=dayNum(r.date); return d!=null && lastDay!=null
    && d>lastDay; }).length;
  return {lastDate:last.date, teamGamesSince:since};
}

export function formRows(agg, len, key, dir, floor, minMinutes){
  const down = dir==="down";
  const bar = minMinutes||0, low = floor||0;
  const out=[];
  for(const pr of agg.player.values()){
    /* Sorted by date here rather than trusted: the league read runs several games at once and
       pushes each as it finishes, so a player's games arrive in whatever order the network
       returned them. "His last five" is meaningless without this. */
    const games=pr.games.slice().sort((a,b)=> new Date(a.date)-new Date(b.date)
      || String(a.gameId).localeCompare(String(b.gameId)));
    if(games.length < len+FORM_MIN_BASE) continue;
    const recent=games.slice(-len), base=games.slice(0,-len);
    const rv=recent.map(g=>statOf(g,key)), bv=base.map(g=>statOf(g,key));
    const rm=avgOf(rv), bm=avgOf(bv), sd=sdOf(bv);
    if(rm==null || bm==null || sd==null || sd<=0) continue;
    /* Every game of the stretch has to be a real appearance. One four-minute cameo in a
       blowout is not a performance, and letting it into a slump is how a player who is not
       in the rotation ends up on a list about form. */
    const mins=recent.map(g=>(g.line||{}).min||0);
    if(bar>0 && !mins.every(m=>m>=bar)) continue;
    /* The floor is on the recent production when looking for a heater, and on his normal when
       looking for a slump: what makes a slump worth reading is that he is usually better. */
    if(low>0 && (down? bm : rm) < low) continue;
    /* A mean is one big night away from lying. Five games of 20, 2, 4, 2, 0 average 5.6
       against a normal of 2.5 and clear a standard deviation, while four of the five are at
       or below normal — that is one good game wearing a five-game costume. The middle game
       cannot be carried by an outlier, so the median is what decides whether the stretch is
       real; the mean still does the ranking, because the size of the jump is what you want
       to sort by. */
    const md=medOf(rv);
    /* Mirrored for a cold stretch: the middle game has to be on the same side of normal as
       the average claims to be. One 0-point night cannot make three quiet games a slump any
       more than one 40 can make three quiet games a heater. */
    out.push({...pr, games, recent, base, rv, bv,
              recentAvg:rm, baseAvg:bm, sd, gap:rm-bm, z:(rm-bm)/sd,
              med:md, dir:down? "down":"up",
              above:rv.filter(v=>v>bm).length, below:rv.filter(v=>v<bm).length,
              real: down? md<bm : md>bm,
              minAvg:avgOf(mins), minLow:Math.min(...mins),
              cats:catMoves(games, len, down),
              ...staleness(agg, pr, games),
              seasonAvg:avgOf(games.map(g=>statOf(g,key)))});
  }
  out.sort((a,b)=> down? a.z-b.z : b.z-a.z);
  return out;
}

/* The other question, and the one that answers itself earliest: how many games in a row is
 * he above his own normal, right now. A five-game average needs five games; a run shows up
 * on the second.
 *
 * "Normal" excludes the run, for the same reason the stretch is excluded above — so the
 * baseline is recomputed as the run grows. The run is therefore defined by walking outward
 * from his most recent game: length L holds if all L games beat the mean of everything
 * before them, and the run is the largest L reached before that stops being true. Taking
 * instead the largest L that happens to hold anywhere would report a run that his most
 * recent games do not support.
 */
export const FORM_MIN_RUN = 2;
const FORM_DIR_WORD = {up:"above", down:"below"};
/* Long enough to see the field, short enough to read. Runs are common — most of a league is
   above its own average in any given week — so this list is a leaderboard, not a census. */
export const RUN_LIST_N = 20;
export function formStreaks(agg, key, dir){
  const down = dir==="down";
  const out=[];
  for(const pr of agg.player.values()){
    const games=pr.games.slice().sort((a,b)=> new Date(a.date)-new Date(b.date)
      || String(a.gameId).localeCompare(String(b.gameId)));
    const vals=games.map(g=>statOf(g,key));
    let run=0, baseAvg=null;
    for(let L=1; L+FORM_MIN_BASE<=vals.length; L++){
      const base=vals.slice(0, vals.length-L), tail=vals.slice(vals.length-L);
      const bm=avgOf(base);
      if(bm==null || !tail.every(v=>down? v<bm : v>bm)) break;
      run=L; baseAvg=bm;
    }
    if(run>=FORM_MIN_RUN)
      out.push({...pr, games, run, baseAvg,
                runVals:vals.slice(vals.length-run),
                runGames:games.slice(games.length-run),
                runAvg:avgOf(vals.slice(vals.length-run)),
                baseN:vals.length-run});
  }
  out.sort((a,b)=>b.run-a.run
    || (down? (a.runAvg-a.baseAvg)-(b.runAvg-b.baseAvg)
            : (b.runAvg-b.baseAvg)-(a.runAvg-a.baseAvg)));
  return out;
}

/* A poster of game logs rather than a ranking: "PLAYER, last N games", then the lines. The
   ranked-card shape answers "who is hottest"; this answers "what has he been doing", which
   is the question anyone reading a run of games actually has. */
export const LOG_CARDS_N = 8;
function logPoster({kick, title, cards, notes}){
  const p=posterShell(kick, title);
  const grid=el("div","lgrid");
  cards.forEach((c,i)=>{
    const box=el("div","lcard"+(i===0?" lead":""));
    const hd=el("div","lhead");
    if(c.id){
      const hs=headshot(c.name, c.id, c.tri, 38);
      hs.style.setProperty("--ring", brandCol(c.tri));
      hd.appendChild(hs);
    }
    const who=el("div","");
    who.appendChild(el("div","lname",c.name));
    who.appendChild(el("div","lwhen",c.when));
    hd.appendChild(who);
    box.appendChild(hd);
    const ul=el("ul","llines");
    c.lines.forEach(t=>ul.appendChild(el("li","",t)));
    box.appendChild(ul);
    if(c.foot){ const f=el("div","lfoot"); f.innerHTML=c.foot; box.appendChild(f); }
    grid.appendChild(box);
  });
  p.appendChild(grid);
  posterFoot(p, notes);
  return p;
}



