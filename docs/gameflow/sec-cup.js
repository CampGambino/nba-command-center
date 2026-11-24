/* Moved out of docs/gameflow.js unchanged (0.153.0, the Game Flow split's part 2): section: the NBA Cup against the rest of the season, and the league views' loader. */
import { boxLine } from "../lib/gameflow/model.js";
import { avgOf, medOf, sdOf, statOf } from "./sec-hothand.js";
import { S } from "./state.js";
import { renderStreaks } from "./sec-lead.js";
import { buildLeague } from "./league.js";
import { renderSplits } from "./sec-pairs.js";
import { $, GAMES, HOWTO, el, hideStatus, isFranchise, isRegularSeason, seasonYear, setStatus } from "../gameflow.js";
import { FLOW, allReadsFailed, franchises, modelFor, reportNoPbp, teamGamesFor } from "./models.js";
import { spanValue } from "./sec-rotation.js";

/* ==================== section: the NBA Cup against the rest of the season ====================
 * Every Cup game except the final is also a regular-season game, so the league aggregate
 * already holds each player's Cup box lines; this section only has to split them off.
 *
 * ESPN tags Cup games in the event's notes, which flattenEspnSchedule carries as g.label:
 * "NBA Cup - Group Play", "NBA Cup - Quarterfinals", "NBA Cup - Semifinals",
 * "NBA Cup Championship". The first edition (2023-24) is filed as "NBA In-Season Tournament"
 * with the same suffixes. Checked against all three Cup seasons on 12 Nov 2026: 60 group
 * games, 4 quarterfinals, 2 semifinals and a final in each complete one.
 *
 * The comparison is Cup games against every OTHER game he played — a partition, the same as
 * the top-defense split — so the two columns never share a game and the gap is like-for-like.
 *
 * The outlier score is not the Hot hand's. That section divides the gap by his single-game
 * spread. A Cup average is several games averaged, and an average wobbles less than one
 * game does, by √n. So here the gap is divided by sd/√n: the spread an n-game average of his
 * would show by chance. Without that, a seven-game finalist and a four-game group exit would
 * be measured on different scales.
 */
const CUP_RE = /NBA Cup|In-Season Tournament/i;

const isCupGame = g => CUP_RE.test((g && g.label) || "");

const isCupGroup = g => /group/i.test((g && g.label) || "");

/* The final does not count toward regular-season stats, so the league aggregate leaves it
   out and this section reads it itself. */
const isCupFinal = g => isCupGame(g) && /championship/i.test(g.label || "");

const CUP_SCOPES = {all:"all Cup games", group:"group play only", ko:"knockout rounds only"};

const cupScope = () => { const v=$("#cupscope")? $("#cupscope").value : "all";
                         return CUP_SCOPES[v]? v : "all"; };

const inCupScope = (g, scope) => scope==="all" || (scope==="group") === isCupGroup(g);

/* Two Cup games at least, or one in the knockout rounds, where most teams play only one. And
   the same five other games the Hot hand asks for before a spread means anything. */
const CUP_MIN_GAMES = scope => scope==="ko" ? 1 : 2;

const CUP_MIN_BASE = 5;

/* Threshold and direction are one decision, as in the Hot hand. "Either way" is first
   because the question is "who is different in the Cup", not "who is better". */
const CUP_ZS = [20, 15, 10];

export const CUP_THRESHOLDS = [].concat(
  ...CUP_ZS.map(t=>{ const s=(t/10).toFixed(1);
    return [["cz"+t+"b",  `|z| ≥ ${s}, either way`],
            ["cz"+t+"up", `z ≥ +${s}, better in the Cup`],
            ["cz"+t+"dn", `z ≤ −${s}, worse in the Cup`]]; }),
  [["czall", "every qualified player, by z"]]);

const cupRank = () => { const v=$("#rank")? $("#rank").value : "";
  if(v==="czall") return {k:0, dir:"b"};
  const m=/^cz(\d+)(b|up|dn)$/.exec(v);
  return m? {k:(+m[1])/10, dir:m[2]} : {k:2, dir:"b"}; };

/* The final's box lines, read once per season and in the same shape as the aggregate's. */
async function cupFinals(){
  const finals=GAMES.filter(g=>g.status===3 && isCupFinal(g) && g.pbp!==false
    && isFranchise(g.away) && isFranchise(g.home));
  const by=new Map(); let failed=0;
  for(const g of finals){
    try{
      const G=await modelFor(g);
      const tri=[G.box.awayTeam.teamTricode, G.box.homeTeam.teamTricode];
      for(const pl of G.players){
        if(!pl.played) continue;
        const pid=String(pl.id);
        if(!by.has(pid)) by.set(pid,[]);
        by.get(pid).push({opp:tri[1-pl.side], tri:pl.tri, pts:pl.boxPts||0, date:g.date,
          gameId:g.gameId, home:pl.side===1, line:pl.line||boxLine(null)});
      }
    }catch(e){ failed++; }
  }
  return {season:seasonYear(), by, games:finals.length, failed};
}

/* One Cup game for the infographic. Shorter than the Hot hand's line because each one also
   carries a date and an opponent: turnovers and minutes give way, and minutes are in the
   card's footer anyway. */
function cupLine(g){
  const L=g.line||{};
  const bits=[`${statOf(g,"pts")} PTS`, `${L.reb||0} REB`, `${L.ast||0} AST`];
  if(L.fga) bits.push(`${L.fgm||0}-${L.fga} FG`);
  if(L.tpa) bits.push(`${L.tpm||0}-${L.tpa} 3PT`);
  return bits.join(", ");
}

/* Shooting as made over attempted across the games, never an average of percentages. */
function pctOver(games, m, a){
  let mm=0, aa=0;
  for(const g of games){ const L=g.line||{}; mm+=L[m]||0; aa+=L[a]||0; }
  return aa? {pct:100*mm/aa, m:mm, a:aa} : null;
}

function cupRows(agg, extra, key, scope, minMinutes){
  const cupBy=new Map(GAMES.filter(isCupGame).map(g=>[g.gameId, g]));
  const need=CUP_MIN_GAMES(scope);
  const rows=[]; let considered=0, thinCup=0, thinBase=0, flat=0;
  const ids=new Set([...agg.player.keys(), ...extra.by.keys()]);
  for(const pid of ids){
    const pr=agg.player.get(pid);
    const fin=extra.by.get(pid)||[];
    if(!pr) continue;      // a final with no regular season behind it has no normal
    const seen=new Set();
    /* A game under the minutes bar is dropped from BOTH columns. Dropping it from one side
       only would move the gap by itself. */
    const games=pr.games.concat(fin).filter(g=>{
      if(seen.has(g.gameId)) return false; seen.add(g.gameId);
      return !minMinutes || ((g.line||{}).min||0)>=minMinutes; })
      .sort((a,b)=>new Date(a.date)-new Date(b.date));
    const cup=games.filter(g=>cupBy.has(g.gameId) && inCupScope(cupBy.get(g.gameId), scope));
    if(!cup.length) continue;
    considered++;
    // every Cup game stays out of the normal, whichever rounds are in scope
    const base=games.filter(g=>!cupBy.has(g.gameId));
    if(cup.length<need){ thinCup++; continue; }
    if(base.length<CUP_MIN_BASE){ thinBase++; continue; }
    const cv=cup.map(g=>statOf(g,key)), bv=base.map(g=>statOf(g,key));
    const cupAvg=avgOf(cv), baseAvg=avgOf(bv), sd=sdOf(bv);
    if(!sd){ flat++; continue; }
    const se=sd/Math.sqrt(cv.length), gap=cupAvg-baseAvg;
    const side={};
    for(const k of ["pts","reb","ast","tpm","min"])
      side[k]=[avgOf(cup.map(g=>statOf(g,k))), avgOf(base.map(g=>statOf(g,k)))];
    rows.push({id:pid, name:pr.name, tri:pr.tri, cup, base, cv, bv,
      cupAvg, baseAvg, med:medOf(cv), sd, se, gap, z:gap/se,
      above:cv.filter(v=>v>baseAvg).length, below:cv.filter(v=>v<baseAvg).length,
      side, fg:[pctOver(cup,"fgm","fga"), pctOver(base,"fgm","fga")],
      tp:[pctOver(cup,"tpm","tpa"), pctOver(base,"tpm","tpa")],
      rounds:cup.map(g=>cupBy.get(g.gameId).label)});
  }
  return {rows, considered, thinCup, thinBase, flat, cupBy};
}

/* Team side: the schedule's own scores, so it needs no game reads and includes the final. */
function cupTeams(scope){
  const t=new Map();
  const T=tri=>{ if(!t.has(tri)) t.set(tri,{tri, c:{w:0,l:0,pf:0,pa:0}, r:{w:0,l:0,pf:0,pa:0}});
                 return t.get(tri); };
  for(const g of GAMES){
    if(g.status!==3 || !isFranchise(g.away) || !isFranchise(g.home)) continue;
    const cup=isCupGame(g);
    if(cup? !inCupScope(g, scope) : !isRegularSeason(g)) continue;
    [[g.away,g.as,g.hs],[g.home,g.hs,g.as]].forEach(([tri,f,a])=>{
      const s=T(tri)[cup?"c":"r"];
      if(f>a) s.w++; else if(f<a) s.l++;
      s.pf+=f; s.pa+=a; });
  }
  const per=s=>{ const n=s.w+s.l; return n? {n, pf:s.pf/n, pa:s.pa/n, mg:(s.pf-s.pa)/n} : null; };
  return [...t.values()].map(r=>({tri:r.tri, c:r.c, r:r.r, cs:per(r.c), rs:per(r.r)}))
    .filter(r=>r.cs && r.rs)
    .map(r=>({...r, gap:r.cs.mg-r.rs.mg}))
    .sort((a,b)=>b.gap-a.gap);
}

/* Leads & comebacks for the full season straight from the nightly build (data/flowstats.json, src/gameflow/stats.js):
   the same counts from the same model, without reading every game in the browser. Only when every finished game
   on the schedule is on file and the build counted all of them; otherwise the page reads the games as before. */
async function nightlyLeads(limit){
  if(limit>0 || !FLOW || seasonYear()!==FLOW.season) return null;
  const slate=new Set();
  for(const t of franchises()) teamGamesFor(t).forEach(g=>slate.add(String(g.gameId)));
  if(!slate.size || [...slate].some(id=>!FLOW.ids.has(id))) return null;
  try{
    const r=await fetch("data/flowstats.json",{cache:"no-store"}); if(!r.ok) return null;
    const S=await r.json();
    if(String(S.season)!==FLOW.season || S.games!==slate.size || !Array.isArray(S.leadTable)) return null;
    return {teams:S.leadTable, games:S.games, failed:0, window:{limit:0}, nightly:true};
  }catch(e){ return null; }
}

export async function showLeague(which){
  /* The Cup is compared with the whole season whatever the game window says: a window of
     the last ten games would leave November's Cup games out of their own comparison. */
  const limit = which==="cup" ? 0 : spanValue();
  const bar=el("div","prog"); const fill=el("i"); bar.appendChild(fill);
  setStatus(`<span class="spin"></span>Reading the league…`);
  $("#status").appendChild(bar);
  try{
    if(which==="streaks" && !(S.leagueAgg && S.leagueAgg.window.limit===limit)){
      const N=await nightlyLeads(limit);
      if(N){ renderStreaks(N); hideStatus(); return; }
    }
    if(!S.leagueAgg || S.leagueAgg.window.limit!==limit){
      S.leagueAgg=await buildLeague(limit,(done,total)=>{
        fill.style.width=(100*done/total)+"%";
        if($("#status").childNodes[1]) $("#status").childNodes[1].textContent=
          `Reading the league… ${done}/${total} games`;
      });
      window.__LEAGUE=S.leagueAgg;
    }
    if(allReadsFailed(S.leagueAgg.games, S.leagueAgg.failed)){ reportNoPbp(); return; }
    await ({streaks:renderStreaks, splits:renderSplits}[which])(S.leagueAgg);
    hideStatus();
  }catch(e){
    $("#out").innerHTML="";
    setStatus(`<b>Couldn't build that section.</b><br>${String(e.message||e)}`+HOWTO,true);
  }
}
