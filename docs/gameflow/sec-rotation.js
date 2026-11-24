/* Moved out of docs/gameflow.js unchanged (0.153.0, the Game Flow split's part 2): section: season rotation heatmap. */
import { REG_LEN } from "../lib/gameflow/model.js";
import { S } from "./state.js";
import { $, ACTIVE, HOWTO, SOURCE, TEAM, clamp, el, esc, finishRender, hideStatus, hideTip, noteEl, setStatus, showTip, tcol } from "../gameflow.js";
import { allReadsFailed, modelFor, reportNoPbp, teamGamesFor } from "./models.js";

/* ==================== season rotation heatmap ==================== */
/**
 * One row per player, one column per minute of the game. A cell is the share of
 * that minute the player spends on the floor, averaged over every game the team
 * has played — so 100% means he is always out there for that minute, and a
 * player who misses half the season tops out near 50% even when he starts.
 * The denominator is team games, not games he appeared in, which is what makes
 * the picture a rotation map rather than a per-player average.
 */
const REG_MINUTES = 48;                 // only regulation is charted (NBA: 4×12)

const Q_MIN = REG_LEN/60;               // 12: the heatmap marks a quarter every Q_MIN columns

const HEAT_STOPS = ["#151c26","#20222f","#372338","#54263c","#742b3d","#95363a",
                    "#b34a30","#cc6624","#e08a2a","#f0b445","#ffd97a"];

export const heatColor = v => HEAT_STOPS[clamp(Math.round(v*(HEAT_STOPS.length-1)),0,HEAT_STOPS.length-1)];

/**
 * limit = 0 means the whole season; otherwise only the most recent `limit`
 * games, so recent rotations aren't washed out by the season average.
 */
async function buildSeason(tri, limit, onProgress){
  const all = teamGamesFor(tri);
  const games = limit>0 ? all.slice(-limit) : all;
  const window = {limit, of:all.length,
    from:games.length? games[0].date : null,
    to:games.length? games[games.length-1].date : null};

  /* Keyed by player id, never by name: a player who changes his name mid-season
     shows up under two names in the feed, and name-keyed totals would split him
     into two rows and lose the difference. Latest name wins for display. */
  const rows = new Map();               // player id -> record
  let done=0, used=0, failed=0;

  // modest concurrency: enough to be quick, gentle enough not to get throttled
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
          for(const pl of G.players.filter(p=>p.side===side)){
            let r=rows.get(pl.id);
            if(!r){ r={id:pl.id, name:pl.name, jersey:pl.jersey, seen:g.date,
                       secs:new Array(REG_MINUTES).fill(0),
                       games:0, totalSec:0, fouls:0, foulOuts:0, troubleGames:0};
                    rows.set(pl.id,r); }
            if(new Date(g.date)>=new Date(r.seen)){       // keep the newest name
              r.name=pl.name; r.seen=g.date; if(pl.jersey) r.jersey=pl.jersey;
            }
            if(pl.played) r.games++;
            r.fouls += pl.foulCount||0;
            if(pl.fouledOut) r.foulOuts++;
            if(pl.troubleFrom) r.troubleGames++;
            for(const s of pl.stints){
              const a=Math.max(0,s.st), b=Math.min(REG_MINUTES*60, s.et);
              if(b<=a) continue;
              r.totalSec += b-a;
              const m0=Math.floor(a/60), m1=Math.min(REG_MINUTES-1, Math.floor((b-1e-9)/60));
              for(let m=m0;m<=m1;m++){
                const lo=Math.max(a,m*60), hi=Math.min(b,(m+1)*60);
                if(hi>lo) r.secs[m]+=hi-lo;
              }
            }
          }
        }
      }catch(e){ failed++; }
      done++;
      if(onProgress) onProgress(done, games.length);
    }
  };
  await Promise.all(Array.from({length:Math.min(4,games.length)},worker));

  /* Both denominators are banked so the toggle is instant and needs no re-reading:
     "share" is out of every team game, "sharePlayed" is out of the games he
     actually appeared in. */
  const out=[...rows.values()].map(r=>{
    const played=Math.max(1,r.games);
    return {...r,
      share:r.secs.map(s=>used? s/(used*60) : 0),
      sharePlayed:r.secs.map(s=>s/(played*60)),
      avgMin:used? r.totalSec/60/used : 0,
      avgMinPlayed:r.totalSec/60/played,
    };
  }).filter(r=>r.totalSec>0)
    .sort((a,b)=>b.totalSec-a.totalSec);
  return {tri, rows:out, teamGames:used, requested:games.length, failed, window};
}

/* which denominator the heatmap is currently drawn with */
const normBasis = () => ($("#norm") ? $("#norm").value : "team");

const basisOf = r => normBasis()==="played"
  ? {share:r.sharePlayed, avg:r.avgMinPlayed, n:Math.max(1,r.games)}
  : {share:r.share,       avg:r.avgMin,       n:null};

export function renderSeason(agg){
  const out=$("#out"); out.innerHTML="";
  const card=el("div","card"); out.appendChild(card);
  const tri=agg.tri, meta=TEAM[tri]||{n:tri};

  const gh=el("div","gamehead");
  const sc=el("div","score");
  const w=el("span","tri");
  const d=el("span","dot"); d.style.background=tcol(tri); w.appendChild(d);
  w.appendChild(el("span","",`${meta.n} — season rotation`));
  sc.appendChild(w);
  gh.appendChild(sc);
  const played = normBasis()==="played";
  const W=agg.window||{limit:0,of:agg.teamGames};
  const dr = d => d ? new Date(d).toLocaleDateString(undefined,{month:"short",day:"numeric"}) : "";
  const m=el("div","meta");
  m.innerHTML = (W.limit>0
      ? `<b>last ${agg.teamGames}</b> of ${W.of} team games`
      : `<b>${agg.teamGames}</b> team games`)
    + (W.from? ` · ${dr(W.from)} – ${dr(W.to)}` : "")
    + (agg.failed? ` · ${agg.failed} unavailable` : "")
    + ` · out of `
    + (played ? `<b>each player's own appearances</b>` : `<b>every game in the window</b>`);
  const src=SOURCE[ACTIVE]||{label:"?"};
  m.appendChild(el("span","badge ok",src.label));
  gh.appendChild(m);
  card.appendChild(gh);

  if(!agg.rows.length){
    card.appendChild(noteEl("No games with play-by-play for this team yet."));
    return;
  }

  const qrow=el("div","heat");
  qrow.appendChild(el("div","nm"));
  const qc=el("div","qmark");
  for(let i=0;i<REG_MINUTES;i++){
    const c=el("div","", i%Q_MIN===0 ? "Q"+(i/Q_MIN+1) : "");
    if(i%Q_MIN===0 && i>0) c.classList.add("qsep");
    qc.appendChild(c);
  }
  qrow.appendChild(qc);
  card.appendChild(qrow);

  // order by whatever average is on screen, so the chart reads top-down either way
  const ordered=agg.rows.slice().sort((a,b)=>basisOf(b).avg-basisOf(a).avg);

  for(const r of ordered){
    const B=basisOf(r);
    const row=el("div","heat");
    const nm=el("div","nm");
    if(r.jersey) nm.appendChild(el("span","jn",r.jersey));
    nm.appendChild(el("span","",r.name));
    nm.title=`${r.name} — ${B.avg.toFixed(1)} min per `
      +(played?`appearance`:`team game`)+`, played in ${r.games} of ${agg.teamGames}`;
    if(played && r.games<agg.teamGames) nm.style.color="var(--dim)";
    row.appendChild(nm);
    const cells=el("div","cells");
    B.share.forEach((v,i)=>{
      const c=el("div","cell");
      c.style.background=heatColor(v);
      if(i%Q_MIN===0 && i>0) c.classList.add("qsep");
      c.addEventListener("mousemove",ev=>showTip(
        `<div class="th">${esc(r.name)}</div>`+
        `<div class="kv"><span>minute</span><b>Q${Math.floor(i/Q_MIN)+1}, ${i%Q_MIN}:00–${i%Q_MIN+1}:00 elapsed</b></div>`+
        `<div class="kv"><span>on floor</span><b>${Math.round(v*100)}% of this minute</b></div>`+
        `<div class="kv"><span>out of</span><b>${played? r.games+" appearances" : agg.teamGames+" team games"}</b></div>`+
        `<div class="kv"><span>average</span><b>${B.avg.toFixed(1)} min per ${played?"appearance":"team game"}</b></div>`+
        `<div class="kv"><span>fouls</span><b>${(r.fouls/Math.max(1,r.games)).toFixed(1)} per game`+
          (r.foulOuts? ` · ${r.foulOuts} fouled out` : "")+`</b></div>`+
        (r.troubleGames? `<div class="kv"><span>foul trouble</span><b>${r.troubleGames} of `+
          `${r.games} games</b></div>` : "")+
        `<div class="mates">played in ${r.games} of ${agg.teamGames} team games</div>`, ev));
      c.addEventListener("mouseleave",hideTip);
      cells.appendChild(c);
    });
    row.appendChild(cells);
    card.appendChild(row);
  }

  const lg=el("div","hlegend");
  lg.appendChild(el("span","","never on floor"));
  const ramp=el("div","ramp");
  HEAT_STOPS.forEach(s=>{const i=el("i");i.style.background=s;ramp.appendChild(i);});
  lg.appendChild(ramp);
  lg.appendChild(el("span","","every game"));
  card.appendChild(lg);

  card.appendChild(noteEl( played
    ? "Each column is one minute of the game. Colour is the share of that minute the player "+
      "spends on the floor in the games he actually appeared in, so availability drops out "+
      "and you're reading how he's used when he plays — a starter back from injury looks "+
      "the same as one who never missed. Names in grey haven't played every game. "+
      "Overtime is not charted; rows are ordered by minutes per appearance."
    : "Each column is one minute of the game. Colour is the share of that minute the player "+
      "spends on the floor across all "+agg.teamGames+" team games, so someone who missed half "+
      "the window peaks near 50% even as a starter — availability stays visible. "+
      "Overtime is not charted; rows are ordered by minutes per team game."));

  if((agg.window||{}).limit>0)
    card.appendChild(noteEl(
      "This is a recent-form sample, not the season: only the last "+agg.teamGames+
      " games are counted, so a rotation change shows up here long before it moves the "+
      "season average. Small windows are noisy — one blowout with a long garbage-time "+
      "stretch can shift a bench player's row noticeably."));
  finishRender();
}

/* Recent-form windows. Capped at 15 games: beyond that you're reading the season
   average anyway, and below about 3 a single blowout distorts the picture. */
const MAX_SPAN = 15;

export function fillSpan(){
  const sel=$("#span"); if(sel.options.length) return;
  sel.appendChild(new Option("Full season","0"));
  for(let n=MAX_SPAN;n>=2;n--) sel.appendChild(new Option(`Last ${n} games`,String(n)));
}

export const spanValue = () => $("#span") ? (parseInt($("#span").value,10)||0) : 0;

export async function showSeason(tri){
  const bar=el("div","prog"); const fill=el("i"); bar.appendChild(fill);
  const limit=spanValue();
  const what = limit>0 ? `the last ${limit} ${TEAM[tri]?TEAM[tri].n:tri} games`
                       : `every ${TEAM[tri]?TEAM[tri].n:tri} game`;
  setStatus(`<span class="spin"></span>Reading ${what}…`);
  $("#status").appendChild(bar);
  try{
    const agg=await buildSeason(tri,limit,(done,total)=>{
      fill.style.width=(100*done/total)+"%";
      const s=$("#status").firstChild;
      if(s&&s.nextSibling) $("#status").childNodes[1].textContent=
        `Reading ${what}… ${done}/${total}`;
    });
    if(allReadsFailed(agg.requested, agg.failed)){ reportNoPbp(); return; }
    S.seasonAgg=agg; window.__SEASON=agg;
    renderSeason(agg);
    hideStatus();
  }catch(e){
    $("#out").innerHTML="";
    setStatus(`<b>Couldn't build the season view.</b><br>${String(e.message||e)}`+HOWTO,true);
  }
}
