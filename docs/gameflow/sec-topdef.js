/* Moved out of docs/gameflow.js unchanged (0.141.16: the Game Flow script split by section). */
import { el, finishRender, noteEl, seasonYear } from "../gameflow.js";
import { POOL_MIN_PPG, POOL_MIN_SIDE, POOL_N, POOL_SHARE, defTopN, layoutMode, poolMode, topDefOf } from "./controls.js";

/* ============ section: scoring against the top defenses ============
 * Two pools: the All-Star roster, or every player with the games to support the split.
 * The roster is a hand-kept list, because neither feed publishes All-Star selections and
 * deriving it from whoever played the All-Star Game would silently drop anyone who was
 * picked but sat out. Editing one array is honest about being a manual step; inferring it
 * would look automatic while being wrong.
 */
/* Which season these selections are for. The list is hand-kept, so it cannot follow the
   schedule on its own — but it can notice that it no longer matches and say so, which is the
   difference between a stale list and a silently wrong one. */
export const ALL_STARS_SEASON = "2026";
export const rosterStale = () => seasonYear() !== ALL_STARS_SEASON;

export const ALL_STARS = [
  // Eastern Conference — starters
  "Giannis Antetokounmpo", // Milwaukee Bucks
  "Jaylen Brown",          // Boston Celtics
  "Jalen Brunson",         // New York Knicks
  "Cade Cunningham",       // Detroit Pistons
  "Tyrese Maxey",          // Philadelphia 76ers
  // Eastern Conference — reserves
  "Scottie Barnes",        // Toronto Raptors
  "Jalen Duren",           // Detroit Pistons
  "Jalen Johnson",         // Atlanta Hawks
  "Donovan Mitchell",      // Cleveland Cavaliers
  "Norman Powell",         // Miami Heat
  "Pascal Siakam",         // Indiana Pacers
  "Karl-Anthony Towns",    // New York Knicks
  // Western Conference — starters
  "Stephen Curry",         // Golden State Warriors
  "Luka Doncic",           // Los Angeles Lakers
  "Shai Gilgeous-Alexander", // Oklahoma City Thunder
  "Nikola Jokic",          // Denver Nuggets
  "Victor Wembanyama",     // San Antonio Spurs
  // Western Conference — reserves
  "Deni Avdija",           // Portland Trail Blazers
  "Devin Booker",          // Phoenix Suns
  "Kevin Durant",          // Houston Rockets
  "Anthony Edwards",       // Minnesota Timberwolves
  "Chet Holmgren",         // Oklahoma City Thunder
  "LeBron James",          // LA Lakers
  "Jamal Murray",          // Denver Nuggets
];

/* Names are matched loosely on purpose. An exact compare would drop De'Aaron Fox the moment
   a feed writes him with a typographic apostrophe rather than a straight one, and the same
   goes for accents and double spaces. Case, accents, apostrophe style, hyphens and spacing
   are all flattened before comparing; anything still unmatched is reported on screen rather
   than silently omitted. */
export function normName(s){
  return String(s||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")   // strip accents
    .replace(/[\u2018\u2019\u02bc\u0060\u00b4]/g,"'")  // any apostrophe -> '
    .replace(/[\u2010-\u2015]/g,"-")                   // any dash -> -
    .replace(/\b(jr|sr|ii|iii|iv)\.?$/i,"")
    .replace(/[^a-z0-9'\- ]/gi,"")
    .replace(/\s+/g," ").trim().toLowerCase();
}

/* One row, one definition. Both the 23-name roster and the whole-league pool come through
   here, so the two can't drift apart: a fix to the shooting split or the complement applies
   to both by construction rather than by my remembering to edit twice. */
export function splitRow(pr, top){
  const all=pr.games;
  const vs=all.filter(g=>top.has(g.opp));
  /* The complement, not the season: "vs the rest" excludes the group, so the two columns
     partition his games and the gap between them is a like-for-like comparison. Against
     the season average the group's own games sit on both sides of the subtraction. */
  const rest=all.filter(g=>!top.has(g.opp));
  const mean=a=>a.length? a.reduce((s,g)=>s+g.pts,0)/a.length : null;
  /* Shooting is summed then divided, never an average of per-game percentages: a 1-of-1
     night and a 2-of-12 night are not equally weighted evidence. */
  const shot=a=>{
    let m=0, t=0;
    a.forEach(g=>{ const L=g.line||{}; m+=L.fgm||0; t+=L.fga||0; });
    return {m, t, pct:t? 100*m/t : null};
  };
  const mv=mean(vs), mr=mean(rest);
  const sa=shot(all), sv=shot(vs), sr=shot(rest);
  return {...pr, gp:all.length, avg:mean(all),
    vsGp:vs.length, vsAvg:mv, restGp:rest.length, restAvg:mr,
    fg:sa, vsFg:sv, restFg:sr,
    fgGap:(sv.pct!=null && sr.pct!=null)? sv.pct-sr.pct : null,
    gap:(mv!=null && mr!=null)? mv-mr : null,
    delta:(mv!=null && mean(all)!=null)? mv-mean(all) : null};
}

/* Every player with the games to support the comparison, not just the All-Stars. The
   thresholds are in POOL_SHARE and POOL_MIN_SIDE; everyone dropped is counted so the
   screen can say how many rather than quietly showing a shorter list. */
export function leaguePool(agg, topDef){
  const top=new Set(topDef);
  const gpOf=new Map(agg.teams.map(t=>[t.tri, t.gp||0]));
  const stars=new Set(ALL_STARS.map(normName).filter(Boolean));
  /* Counted in the order they are tested, so every excluded player lands in exactly one
     bucket and the three add up to the total. */
  const out=[]; let considered=0, quiet=0, thin=0, oneSided=0;
  for(const pr of agg.player.values()){
    considered++;
    const r=splitRow(pr, top);
    if((r.avg??0) < POOL_MIN_PPG){ quiet++; continue; }
    /* Measured against his own team's schedule, not the league's busiest: teams have played
       a different number of games at any point in the season, and a player on a team with
       games in hand should not need more appearances than one whose team is caught up. */
    r.need=Math.ceil((gpOf.get(pr.tri)||0)*POOL_SHARE);
    r.star=stars.has(normName(pr.name));
    if(r.gp<r.need){ thin++; continue; }
    if(r.vsGp<POOL_MIN_SIDE || r.restGp<POOL_MIN_SIDE){ oneSided++; continue; }
    out.push(r);
  }
  out.sort((a,b)=>(a.gap??1e9)-(b.gap??1e9));
  return {rows:out, considered, quiet, thin, oneSided};
}

export function allStarRows(agg, topDef, roster){
  const list=roster||ALL_STARS;
  const want=new Set(list.map(normName).filter(Boolean));
  const top=new Set(topDef);
  const out=[];
  for(const pr of agg.player.values()){
    if(!want.has(normName(pr.name))) continue;
    out.push({...splitRow(pr, top), star:true});
  }
  out.sort((a,b)=>(a.gap??1e9)-(b.gap??1e9));
  /* Report the spelling as it was typed, not the normalised form: telling someone
     "de'aaron fox" was not found is a worse message than "De'Aaron Fox". */
  const seenNames=new Set([...agg.player.values()].map(p=>normName(p.name)));
  const missing=list.filter(n=>n.trim() && !seenNames.has(normName(n)));
  return {rows:out, missing};
}

/* The summary table, built once and used for however many blocks the pool needs: the
   All-Star list is one block, the league pool is a falls-off block and a holds-up block.
   Each block numbers from 1 because each is the top of its own ranking — continuing the
   numbering into the second would imply the two halves are one list, and the rows in
   between are missing. */
function splitTable(card, rows, N, teamCount){
  const tbl=el("table","per lb"); const th=el("tr");
  const pcOf=x=>x&&x.pct!=null? x.pct.toFixed(1)+"%":"—";
  ["#","player","team","games","season","fg%",`vs top ${N}`,"fg%","games",
   `vs other ${teamCount-N}`,"fg%","games","pts gap","fg% gap"]
    .forEach(x=>th.appendChild(el("th","",x)));
  tbl.appendChild(th);
  rows.forEach((r,i)=>{
    const tr=el("tr");
    const cells=[String(i+1), r.name, r.tri, String(r.gp),
      r.avg!=null? r.avg.toFixed(1):"—", pcOf(r.fg),
      r.vsAvg!=null? r.vsAvg.toFixed(1):"—", pcOf(r.vsFg), String(r.vsGp),
      r.restAvg!=null? r.restAvg.toFixed(1):"—", pcOf(r.restFg), String(r.restGp),
      r.gap!=null? (r.gap>0?"+":"")+r.gap.toFixed(1):"—",
      r.fgGap!=null? (r.fgGap>0?"+":"")+r.fgGap.toFixed(1):"—"];
    cells.forEach((c,k)=>{
      const td=el("td","",c);
      if(k===1||k===2) td.style.textAlign="left";
      if(k===1){ td.style.color="var(--text)";
        /* A star marks an All-Star inside the league pool. It is a marker, not a sort key:
           the ranking stays on the gap so the roster can't quietly reorder the table. */
        if(r.star && poolMode()!=="stars"){
          td.textContent="";
          const s=el("span","",  "★ ");
          s.style.color="var(--dim)"; s.title=`${ALL_STARS_SEASON} All-Star`;
          td.appendChild(s); td.appendChild(el("span","",r.name));
        }
      }
      if(k===4||k===6||k===9){ td.style.color="var(--text)"; }
      const signed = k===12 ? r.gap : (k===13 ? r.fgGap : null);
      if(signed!=null){ td.style.fontWeight="600";
        td.style.color = signed<0 ? "var(--bad,#e0603a)" : "var(--good,#3aa76d)"; }
      if(k===7||k===10) td.title=`${r[k===7?"vsFg":"restFg"].m}-`
        +`${r[k===7?"vsFg":"restFg"].t} from the field`;
      tr.appendChild(td);
    });
    tbl.appendChild(tr);
  });
  card.appendChild(tbl);
  return tbl;
}

/* What "top defense" means, said in the section that leans on it. Points allowed per 100
   possessions rather than per game: per game rewards a slow team for taking fewer
   possessions, which is a pace difference dressed up as defense. The two orderings often
   disagree, and when they do the screen says so rather than leaving the reader to assume
   one measure. */
export function defDefinition(agg, N){
  const byPoss=agg.teams.slice(0,N).map(t=>t.tri);
  const byGame=agg.teams.slice()
    .sort((a,b)=>(a.paPg??1e9)-(b.paPg??1e9)).slice(0,N).map(t=>t.tri);
  const same=byPoss.length===byGame.length
    && byPoss.every(t=>byGame.includes(t));
  return `<b>"Top ${N} defense" means points allowed per 100 possessions</b>, not points `+
    `allowed per game — per game rewards a slow team for taking fewer possessions, which is `+
    `pace rather than defense. Possessions are estimated as FGA - OREB + TOV + 0.44 x FTA, `+
    `the conventional formula, using the <i>opponent's</i> possessions. Hover a team code `+
    `above for both figures.`+
    (same
      ? ` Here the two measures happen to pick the same ${N} teams.`
      : ` The two measures disagree here: per game the top ${N} would be `+
        `${byGame.join(", ")} rather than ${byPoss.join(", ")}.`)+`<br>`;
}



/* Player × team points per game. Shared by both pools for the same reason as splitTable. */
function gridTable(card, rows, agg, topDef, N){
  const tris=agg.teams.map(t=>t.tri).slice().sort();
  const tbl=el("table","per lb"); const th=el("tr");
  th.appendChild(el("th","","player"));
  tris.forEach(t=>{
    const c=el("th","",t);
    if(topDef.includes(t)) c.style.color="var(--text)";
    th.appendChild(c);
  });
  tbl.appendChild(th);
  rows.forEach(r=>{
    const tr=el("tr");
    const nm=el("td","",(r.star && poolMode()!=="stars" ? "★ " : "")+r.name);
    nm.style.textAlign="left"; nm.style.color="var(--text)"; tr.appendChild(nm);
    tris.forEach(t=>{
      const gs=r.games.filter(g=>g.opp===t);
      const td=el("td","", gs.length
        ? (gs.reduce((a,g)=>a+g.pts,0)/gs.length).toFixed(1) : "·");
      if(gs.length){
        td.title=`${r.name} vs ${t}: ${gs.length} game${gs.length>1?"s":""} — `
          + gs.map(g=>g.pts).join(", ");
        if(topDef.includes(t)) td.style.color="var(--text)";
      }else td.style.color="var(--dim)";
      tr.appendChild(td);
    });
    tbl.appendChild(tr);
  });
  card.appendChild(tbl);
  card.appendChild(noteEl(
    `Points per game against each team; hover a cell for the individual games behind it. `+
    `Columns for the top ${N} defenses are brighter. Most cells rest on two or `+
    `three games, so read the pattern rather than any one number.`));
  return tbl;
}

/* The whole league rather than the 23 names. Two blocks instead of one long scroll: the
   players who fall off most against the top defenses, and the ones who go the other way.
   Both ends are interesting and neither is visible from the middle of a 120-row table. */
export function renderPool(agg, card){
  const N=defTopN(), topDef=topDefOf(agg, N);
  const {rows, considered, quiet, thin, oneSided}=leaguePool(agg, topDef);
  const gpOf=new Map(agg.teams.map(t=>[t.tri, t.gp||0]));
  const needs=[...gpOf.values()].map(g=>Math.ceil(g*POOL_SHARE));
  const needLo=needs.length? Math.min(...needs) : 0, needHi=needs.length? Math.max(...needs):0;
  const qualNote =
    `<b>Who qualifies:</b> at least ${POOL_MIN_PPG} points a game for the season, at least `+
    `half his own team's games — `+
    (needLo===needHi? `${needLo} right now` : `${needLo}–${needHi} depending on the team, `+
      `since teams have played different numbers of games`)+
    ` — and at least ${POOL_MIN_SIDE} games on <i>each</i> side of the split. `+
    `${rows.length} of ${considered} players clear it; ${quiet} average under `+
    `${POOL_MIN_PPG} and have no scoring to fall off, ${thin} are short on games, and `+
    `${oneSided} have too few on one side, where a "gap" would be a comparison against `+
    `almost nothing. A star marks a ${ALL_STARS_SEASON} All-Star; it is a label, `+
    `not a sort key.`;

  if(layoutMode()==="grid"){
    card.appendChild(el("div","rule"));
    const h=el("div","sect nm","Every qualified player against every team");
    h.style.textAlign="left"; h.style.paddingRight="0"; card.appendChild(h);
    gridTable(card, rows, agg, topDef, N);
    card.appendChild(noteEl(qualNote));
    finishRender(); return;
  }

  /* Fewer than two blocks' worth and the two ends would overlap — the same player would
     appear in both tables, once as a faller and once as a riser. One table then. */
  const split = rows.length > 2*POOL_N;
  const blocks = split
    ? [[`Falls off most against the top ${N}`, rows.slice(0, POOL_N)],
       [`Holds up best against the top ${N}`, rows.slice(-POOL_N).reverse()]]
    : [[`Season, the top ${N} defenses, and everyone else`, rows]];

  blocks.forEach(([title, part], bi)=>{
    card.appendChild(el("div","rule"));
    const h=el("div","sect nm",title);
    h.style.textAlign="left"; h.style.paddingRight="0"; card.appendChild(h);
    splitTable(card, part, N, agg.teams.length);
    if(bi===0 && split) card.appendChild(noteEl(
      `Ranked by <b>points gap</b> — his average against the top ${N} defenses minus his `+
      `average against the other ${agg.teams.length-N} teams. The two columns partition his `+
      `games, so the gap is like-for-like. Showing the ${POOL_N} largest drops of `+
      `${rows.length} qualified players; the other end of the same ranking is below.`));
    if(bi===blocks.length-1) card.appendChild(noteEl(
      (split? `The ${POOL_N} smallest drops — the top of this block is the player whose `+
              `average rises most against the best defenses. `
            : `Ranked by points gap, largest drop first. With ${rows.length} qualified `+
              `players there is no point splitting the ranking into two ends, so this is `+
              `all of them. `)+
      `<b>fg%</b> is made over attempted across the games in that column, not an average `+
      `of per-game percentages. Hover a percentage for the makes and attempts.<br>`+
      `<b>These are small samples</b> — the top-${N} column rests on `+
      `${rows.length? Math.round(rows.reduce((a,r)=>a+r.vsGp,0)/rows.length) : 0} games on `+
      `average, so a single big night moves it several points. The qualification below keeps `+
      `the worst of that out, but it cannot remove it.<br>`+
      defDefinition(agg, N)+qualNote));
  });
  finishRender();
}



