// Game Flow page script (moved out of gameflow.html unchanged, 0.141.10). Loaded as a module, as it was inline.
"use strict";
import { espnToFeeds, expandFeeds } from "./lib/gameflow/feeds.js";
import { REG_LEN, OT_LEN, RUN_MIN, RUN_ALLOW, SWING_CAP, plen, clockSec, minVal, mmss,
  HOOP_X, HOOP_Y, COURT_W, COURT_L, HOOP_INSET, SPOT_SX, SPOT_SY, ARC_R, CORNER_D, CORNER_Y,
  onCourt, hasSpot, spotDist, canonSpot, statedDist, shotDist, boxLine, buildStints as buildStintsModel } from "./lib/gameflow/model.js";
import { headshot } from "./gameflow/headshots.js";
import { REST_BUCKETS, dayNum, gameDay, restBucket, restIndex } from "./gameflow/rest.js";
import { renderRangeCourt } from "./gameflow/poster-court.js";
import { renderRangeScatter } from "./gameflow/poster-scatter.js";
import "./gameflow/standings.js";
import { DEF_TOP_N, buildLeague } from "./gameflow/league.js";
import { RANK_POSTER_N, rankPoster } from "./gameflow/rank-poster.js";
import { restRows, restStats } from "./gameflow/sec-rest.js";
import { renderStreaks } from "./gameflow/sec-lead.js";
import { ALL_STARS, ALL_STARS_SEASON, allStarRows, defDefinition, leaguePool, normName, renderPool, rosterStale, splitRow } from "./gameflow/sec-topdef.js";
import { FORM_MIN_RUN, LOG_CARDS_N, RUN_LIST_N, avgOf, catMoves, fillFormLens, formRows, formStreaks, medOf, sdOf, setFloorOptions, slashLine, staleness, statOf } from "./gameflow/sec-hothand.js";
import { ivAnd, ivHas, ivSec, ivSub, onOffSplit, renderSplits, splitByTeammate } from "./gameflow/sec-pairs.js";
import { buildBoard } from "./gameflow/board.js";
import { RANGE_MIN_3PA, RANGE_N, buildRange, courtSvg, fitText, pctile, posterFoot, posterShell, posterTools, rangeScope, svgEl, svgText } from "./gameflow/range.js";
// Sections moved into their own files (0.141.16).
const buildStints = (pbp, box) => buildStintsModel(pbp, box, { minTol: MIN_TOL });
/* ============================ config ============================ */
const CDN = "https://cdn.nba.com/static/json";
const SCHEDULE_PATHS = ["staticData/scheduleLeagueV2_1.json",
                        "staticData/scheduleLeagueV2.json"];

const TEAM = {
  ATL:{n:"Hawks",         a:"#E03A3E", b:"#C1D32F"},
  BOS:{n:"Celtics",       a:"#007A33", b:"#BA9653"},
  BKN:{n:"Nets",          a:"#000000", b:"#FFFFFF"},
  CHA:{n:"Hornets",       a:"#1D1160", b:"#00788C"},
  CHI:{n:"Bulls",         a:"#CE1141", b:"#000000"},
  CLE:{n:"Cavaliers",     a:"#860038", b:"#FDBB30"},
  DAL:{n:"Mavericks",     a:"#00538C", b:"#002B5E"},
  DEN:{n:"Nuggets",       a:"#0E2240", b:"#FEC524"},
  DET:{n:"Pistons",       a:"#C8102E", b:"#1D42BA"},
  GSW:{n:"Warriors",      a:"#1D428A", b:"#FFC72C"},
  HOU:{n:"Rockets",       a:"#CE1141", b:"#000000"},
  IND:{n:"Pacers",        a:"#002D62", b:"#FDBB30"},
  LAC:{n:"Clippers",      a:"#C8102E", b:"#1D428A"},
  LAL:{n:"Lakers",        a:"#552583", b:"#FDB927"},
  MEM:{n:"Grizzlies",     a:"#5D76A9", b:"#12173F"},
  MIA:{n:"Heat",          a:"#98002E", b:"#F9A01B"},
  MIL:{n:"Bucks",         a:"#00471B", b:"#EEE1C6"},
  MIN:{n:"Timberwolves",  a:"#0C2340", b:"#236192"},
  NOP:{n:"Pelicans",      a:"#0C2340", b:"#C8102E"},
  NYK:{n:"Knicks",        a:"#006BB6", b:"#F58426"},
  OKC:{n:"Thunder",       a:"#007AC1", b:"#EF3B24"},
  ORL:{n:"Magic",         a:"#0077C0", b:"#C4CED4"},
  PHI:{n:"76ers",         a:"#006BB6", b:"#ED174C"},
  PHX:{n:"Suns",          a:"#1D1160", b:"#E56020"},
  POR:{n:"Trail Blazers", a:"#E03A3E", b:"#000000"},
  SAC:{n:"Kings",         a:"#5A2D81", b:"#63727A"},
  SAS:{n:"Spurs",         a:"#C4CED4", b:"#000000"},
  TOR:{n:"Raptors",       a:"#CE1141", b:"#000000"},
  UTA:{n:"Jazz",          a:"#002B5C", b:"#00471B"},
  WAS:{n:"Wizards",       a:"#002B5C", b:"#E31837"},
};
/** The brand colour as published. Correct on the white poster, and the input to the
    dark-interface variant below — never drawn straight onto the dark chart. */
const knownTeam = t => Object.prototype.hasOwnProperty.call(TEAM, String(t));
export const teamName  = t => (TEAM[t] || {n:String(t)}).n;

/* A team the table has never heard of — an expansion franchise, most likely — gets a
   generated colour rather than one shared grey, so two newcomers in the same game are still
   telling apart. Derived from the tricode, so it is stable between reloads and between the
   chart and the tables. */
/* Returned as hex, not hsl(), because everything downstream — the contrast lift, the
   poster's rgba tints — reads channels out of a hex string. */
function generatedCol(tri){
  let h=0;
  for(const ch of String(tri)) h=(h*33 + ch.charCodeAt(0)) % 360;
  const s=0.55, l=0.48;
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  const seg=[[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][Math.floor(h/60)%6];
  return "#"+seg.map(v=>Math.round((v+m)*255).toString(16).padStart(2,"0"))
    .join("").toUpperCase();
}
export const brandCol = t => knownTeam(t) ? TEAM[t].a : generatedCol(t);
const brandAlt = t => knownTeam(t) ? TEAM[t].b : generatedCol(t+"~");

/* Several brand colours are darker than the interface they're drawn on: Dallas and
   Washington both use #0C2340, which lands at 1.01:1 against the card — a bar in it is
   invisible, which is exactly what happened. Phoenix, the Sparks, the Valkyries and Seattle
   were nearly as bad at 1.3–1.8:1.
   So each colour is brightened until it clears MIN_DARK_CONTRAST against the lightest
   surface it can sit on. Brightening is a proportional scale rather than a blend toward
   white: scaling keeps the channel ratios, so a navy stays navy instead of turning grey.
   A colour too dark to scale into range — pure black would be one — is then washed toward
   white, because scaling zero gets you nowhere.
   Anything already clearing the bar is returned untouched, so thirteen of the fifteen
   colours are exactly as published. */
const DARK_BG=[28,34,44];            // --panel2, the lightest surface a team colour sits on
const MIN_DARK_CONTRAST=2.6;         // just under the Dream's 2.72, so the reds don't move
function hexRgb(hex){
  const h=String(hex).replace("#","");
  const s=h.length===3? h.split("").map(c=>c+c).join("") : h;
  const n=parseInt(s,16);
  return [(n>>16)&255,(n>>8)&255,n&255];
}
const rgbHex = c => "#"+c.map(v=>Math.round(Math.min(255,Math.max(0,v)))
  .toString(16).padStart(2,"0")).join("").toUpperCase();
function liftForDark(hex){
  const c=hexRgb(hex);
  if(contrastOf(c,DARK_BG)>=MIN_DARK_CONTRAST) return String(hex).toUpperCase();
  /* Measured on the rounded candidate, not the float one. A colour whose float form clears
     2.60 can round down to 2.59, and then the value that ships misses the bar the code
     claims it meets — which a test caught. */
  const snap = v => hexRgb(rgbHex(v));
  let out=c;
  for(let k=1.02;k<=8;k+=0.02){
    out=c.map(v=>Math.min(255,v*k));
    if(contrastOf(snap(out),DARK_BG)>=MIN_DARK_CONTRAST) return rgbHex(out);
  }
  for(let m=0.02;m<=1;m+=0.02){
    const w=out.map(v=>v+(255-v)*m);
    if(contrastOf(snap(w),DARK_BG)>=MIN_DARK_CONTRAST) return rgbHex(w);
  }
  return rgbHex(out);
}
/* Light look (0.60): the page follows the system setting, and on a white panel the problem is the reverse:
   pale brand colours (gold, white) vanish. Those are darkened toward black until they clear the same bar. */
const LIGHT_UI = (()=>{ try{ return matchMedia("(prefers-color-scheme: light)").matches; }catch(e){ return false; } })();
const LIGHT_BG=[255,255,255], MIN_LIGHT_CONTRAST=2.2;
function lowerForLight(hex){
  const c=hexRgb(hex);
  if(contrastOf(c,LIGHT_BG)>=MIN_LIGHT_CONTRAST) return String(hex).toUpperCase();
  const snap = v => hexRgb(rgbHex(v));
  for(let m=0.02;m<=1;m+=0.02){
    const d=c.map(v=>v*(1-m));
    if(contrastOf(snap(d),LIGHT_BG)>=MIN_LIGHT_CONTRAST) return rgbHex(d);
  }
  return rgbHex(c.map(v=>v*0.4));
}
const _darkCache=new Map();
const darkOf = hex => {
  if(!_darkCache.has(hex)) _darkCache.set(hex, LIGHT_UI ? lowerForLight(hex) : liftForDark(hex));
  return _darkCache.get(hex);
};
/** The colour to draw a team in on the dark interface. */
export const tcol    = t => darkOf(brandCol(t));
const tcolAlt = t => darkOf(brandAlt(t));

/* Two teams can share a colour outright — Dallas and Washington do — and in one game that
   would draw both sides identically. When the two are too close to tell apart the second
   team falls back to its secondary. Only inside a single game: a league table has one row
   per team, so there is nothing to confuse. */
const MIN_SIDE_GAP=90;               // euclidean distance in RGB
const rgbGap = (a,b) => Math.hypot(...hexRgb(a).map((v,i)=>v-hexRgb(b)[i]));
function sideColours(awayTri, homeTri){
  const a=tcol(awayTri);
  let h=tcol(homeTri);
  if(rgbGap(a,h)<MIN_SIDE_GAP) h=tcolAlt(homeTri);
  if(rgbGap(a,h)<MIN_SIDE_GAP) h="#c8ced9";   // last resort: a neutral, still legible
  return {[awayTri]:a, [homeTri]:h};
}

/** A team colour at low opacity, for fills that sit behind text. */
export function tint(t, alpha){
  const h=brandCol(t).replace("#","");
  const n=parseInt(h.length===3? h.split("").map(c=>c+c).join("") : h, 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`;
}

/* A single opacity for every team leaves the pale colours invisible: measured
   against the meter's empty track, seafoam came out at 1.11:1 and gold at 1.22:1,
   which is no visible bar at all. Each team instead gets the opacity it needs to
   clear a minimum contrast, so a Liberty bar is as readable as a Wings bar. */
/* Portrait size on the poster, and the flex gap beside it. The PASSER and SCORER
   headers are inset by the sum of the two (--pinset) so each label's inner edge
   lands on the shared edge of the names in its column. Change one of these and the
   headers drift off the names, so the audit checks the three against each other. */
const POSTER_HS=56, POSTER_SIDE_GAP=12;

const TRACK_RGB=[241,243,246];      // matches .pmid background
const MIN_BAR_CONTRAST=1.45;
function relLum(c){
  const f=c.map(v=>{ v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); });
  return 0.2126*f[0]+0.7152*f[1]+0.0722*f[2];
}
function contrastOf(a,b){
  const la=relLum(a), lb=relLum(b);
  return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05);
}
const _alphaCache=new Map();
export function barAlpha(t){
  if(_alphaCache.has(t)) return _alphaCache.get(t);
  const h=brandCol(t).replace("#","");
  const n=parseInt(h,16), c=[(n>>16)&255,(n>>8)&255,n&255];
  let a=0.34;
  for(let x=0.34;x<=0.82;x+=0.02){
    const over=c.map(v=>x*v+(1-x)*255);
    a=x;
    if(contrastOf(over,TRACK_RGB)>=MIN_BAR_CONTRAST) break;
  }
  _alphaCache.set(t,a);
  return a;
}

/* ESPN uses its own abbreviations; fold them onto the tricodes above. */
const ESPN_TRI = {GS:"GSW", NO:"NOP", NY:"NYK", SA:"SAS", UTAH:"UTA", WSH:"WAS"};
const espnTri = a => ESPN_TRI[a] || a;

const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const ESPN_SUMMARY = "https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/summary";

/* Two sources, same chart.

   "nba"  - the official league feed. Exact to the second, matching the box score's
             floor time and points player-game for player-game. Needs the local
             helper, because the league CDN refuses direct browser requests.
   "espn"  - CORS-open, so it works from a file on disk with nothing running. ESPN
             reports minutes rounded to whole numbers, which costs some precision.
             Substitutions themselves are explicit and paired, so the bars are
             structurally sound either way — per-team floor time comes to exactly
             five players' worth in every game.
             (The specific agreement percentages quoted for this pairing in the
             original WNBA build aren't repeated here since they haven't been
             re-measured against NBA games; the mechanism is unchanged.)

   The helper is preferred when present and ESPN is the fallback, so the page always
   has something to show. */
export const SOURCE = {
  nba: {label:"league feed", detail:"exact to the second"},
  espn: {label:"ESPN", detail:"minutes rounded to whole numbers"},
};
export let ACTIVE = null;

/* How far a player's running total may exceed their box-score minutes before a
   candidate is rejected when filling a period-opening lineup. The league feed is
   exact so the tolerance is a rounding epsilon; ESPN publishes whole minutes, so
   the true value sits anywhere within half a minute either side. */
let MIN_TOL = 0.6;           // ESPN only (whole minutes): set from the start, as load() did for the first game

/* Reconciliation tolerance for the badge, same reasoning. */
let MIN_SLACK = 0.5;

/* ============================ helpers ============================ */
export const $  = s => document.querySelector(s);
/* 0.141.3 (security check, 11/20): text from the data (names, arenas, labels) is escaped before it goes into HTML. */
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const el = (t,c,x) => { const e=document.createElement(t); if(c)e.className=c;
                        if(x!=null)e.textContent=x; return e; };
/* Notes carry inline markup, so they have to be set as HTML. Handing a string with tags
   to el() renders them literally — "<b>0 games</b>" on screen — which shipped in seven
   places before it was noticed. This is the only sanctioned way to build one. */
export const noteEl = h => { const d=el("div","note"); d.innerHTML=h; return d; };
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const sgn  = v => (v>0?"+":"") + v;
const FOUL_LIMIT_UI = 6;                       // NBA disqualification
const ord = n => { const s=["th","st","nd","rd"], v=n%100;
                   return n + (s[(v-20)%10] || s[v] || s[0]); };

// "PT10M00.00S" -> seconds remaining

// game-clock label for an absolute elapsed time
function stamp(t, maxP){
  let p=1, rem=t;
  while(p<=maxP && rem>=plen(p)-1e-9){ rem-=plen(p); p++; }
  if(p>maxP){ p=maxP; rem=plen(p); }
  const left = plen(p)-rem;
  return (p<=4?"Q"+p:"OT"+(p-4)) + " " + mmss(Math.max(0,left));
}

async function getJSON(url){
  const r = await fetch(url, {cache:"no-store"});
  if(!r.ok) throw new Error("HTTP " + r.status + " for " + url);
  return r.json();
}

/* The NBA feeds send no CORS headers, so a page opened straight off disk can't
   read them. nba_gameflow.py serves this file and mirrors the feeds under /api/,
   which is same-origin. We try that first, then the CDN directly (in case this is
   hosted somewhere that can reach it). */
let BASE = null;
async function feed(path){
  const cands = BASE!=null ? [BASE] : ["api/", CDN+"/"];
  let last=null;
  for(const b of cands){
    try{ const j = await getJSON(b+path); BASE=b; return j; }
    catch(e){ last=e; }
  }
  throw last;
}

/* ==================== ESPN -> league-feed adapter ==================== */
/**
 * Rewrites an ESPN game summary into the shape of the official feeds, so the
 * reconstruction and rendering below are shared by both sources rather than
 * duplicated. The important piece is substitutions: ESPN logs one event naming
 * both players ("A enters the game for B") with their ids attached, which is
 * split back into the league feed's separate "out" then "in" pair.
 */
function espnShotSpot(p){
  const c=p.coordinate;
  if(!c || !Number.isFinite(+c.x) || !Number.isFinite(+c.y)) return {};
  // ESPN's own convention, already folded onto one end; canonSpot documents why
  const sx=+c.x - HOOP_X, sy=+c.y - HOOP_Y;
  return onCourt(sx,sy) ? {x:+c.x, y:+c.y, sx, sy} : {};
}
window.__shot={hasSpot, spotDist, statedDist, shotDist, onCourt, canonSpot,
               HOOP_X, HOOP_Y, ARC_R, CORNER_D, CORNER_Y,
               COURT_W, COURT_L, HOOP_INSET, SPOT_SX, SPOT_SY};

/* One box line, read from whichever feed supplied it. Both now use the league feed's key
   names, so this needs no source flag. */
/* ============================ rendering ============================ */
const tip=$("#tip");
let showTip=(html,ev)=>{
  tip.innerHTML=html; tip.style.opacity=1;
  const r=tip.getBoundingClientRect();
  tip.style.left = clamp(ev.clientX+14, 8, innerWidth-r.width-8)+"px";
  tip.style.top  = clamp(ev.clientY+14, 8, innerHeight-r.height-8)+"px";
};
const hideTip=()=>{tip.style.opacity=0};
addEventListener("scroll",hideTip,{passive:true});

const pmColor = pm => {
  const k = clamp(Math.abs(pm)/14, 0, 1);
  const mix=(a,b)=>Math.round(a+(b-a)*k);
  const [r0,g0,b0] = LIGHT_UI ? [205,210,218] : [58,66,80];   // the neutral end: a light grey on the light look
  return pm>=0 ? `rgb(${mix(r0,47)},${mix(g0,158)},${mix(b0,106)})`
               : `rgb(${mix(r0,208)},${mix(g0,69)},${mix(b0,63)})`;
};

function render(G, gameInfo){
  const out=$("#out"); out.innerHTML="";
  const card=el("div","card"); out.appendChild(card);
  const total=G.total, pct=t=>(t/total*100)+"%";
  const shade=$("#shade").checked;
  const away=G.box.awayTeam, home=G.box.homeTeam;
  /* One resolver for every colour in this chart, so the two sides can never be drawn the
     same. Everything below asks gc() rather than tcol() directly. */
  const _gc=sideColours(away.teamTricode, home.teamTricode);
  const gc = t => _gc[t] || tcol(t);

  /* ---------- game header ---------- */
  const gh=el("div","gamehead");
  const sc=el("div","score");
  [[away,G.box.awayTeam.score],[home,G.box.homeTeam.score]].forEach(([tm,s],k)=>{
    if(k) sc.appendChild(el("span","",""));
    const w=el("span","tri");
    const d=el("span","dot"); d.style.background=gc(tm.teamTricode); w.appendChild(d);
    w.appendChild(el("span","",tm.teamCity+" "+tm.teamName));
    sc.appendChild(w);
    const n=el("span","n "+(s>=(k?away.score:home.score)?"w":"l"), s); sc.appendChild(n);
  });
  gh.appendChild(sc);

  const bad  = G.recon.filter(r=>Math.abs(r.d)>MIN_SLACK);
  const badp = G.recon.filter(r=>r.dpm!==0);
  const bada = G.recon.filter(r=>r.dast!==0);
  const n=G.recon.length;
  const src=SOURCE[ACTIVE]||{label:"?",detail:""};
  /* 0.141.13: when the play-by-play doesn't add up to the box score (ESPN left a play out: NYK @ MIN 11/19 is missing a
     LaMelo Ball basket), nobody's +/− can be fixed for that play, so say so and whose points are missing. */
  const ptsGap=[...G.players.values()].filter(p=>p.played && (p.calcPts||0)!==(p.boxPts||0));
  const b=el("span","badge "+((bad.length||bada.length||ptsGap.length)?"warn":"ok"),
    `${src.label} · minutes ${n-bad.length}/${n}, +/− ${n-badp.length}/${n}, ast ${n-bada.length}/${n}`+(ptsGap.length?" · plays missing":""));
  b.title = [`Source: ${src.label} (${src.detail}).`,
             ACTIVE==="espn"
               ? `Minutes are checked to within ${MIN_SLACK} min because ESPN publishes whole minutes only.`
               : `Minutes are checked to the second.`,
             ...(ptsGap.length?["",`${src.label}'s play-by-play doesn't add up to its box score, so a play is missing: `+
               ptsGap.map(p=>`${p.name} has ${p.calcPts||0} points in the plays and ${p.boxPts||0} in the box score`).join("; ")+
               `. The +/− of the players on the floor for it can't be matched, and the score line is short by that much.`]:[]),
             "",
             ...bad.map(r=>`${r.name}: ${sgn(+r.d.toFixed(1))} min`),
             ...badp.map(r=>`${r.name}: ${sgn(r.dpm)} on +/−`),
             ...bada.map(r=>`${r.name}: ${sgn(r.dast)} on assists`)].join("\n");

  const dt=new Date(G.box.gameTimeLocal||gameInfo.gameDateTimeEst);
  const m=el("div","meta");
  m.innerHTML = `<b>${dt.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"})}</b>`
    + ` · ${esc(G.box.arena.arenaName)}, ${esc(G.box.arena.arenaCity)}`
    + (G.box.attendance? ` · ${(+G.box.attendance).toLocaleString()} att` : "")
    + ` · ${esc(G.box.gameStatusText)}` + (gameInfo.gameLabel? ` · ${esc(gameInfo.gameLabel)}`:"")
    + (G.live? ` · <b>in progress</b> — charted to the last play (${stamp(G.total,G.maxP)})`:"");
  m.appendChild(b);
  gh.appendChild(m);
  card.appendChild(gh);

  /* ---------- shared helpers ---------- */
  const gridRow = () => { const g=el("div","grid"); return g; };
  const qBg = track => {
    let t=0;
    for(let p=1;p<=G.maxP;p++){ t+=plen(p);
      if(p<G.maxP){ const l=el("div","qline"); l.style.left=pct(t); track.appendChild(l); } }
  };
  const trackCell = extra => { const t=el("div","track"+(extra?" "+extra:""));
    t.appendChild(el("div","lane")); qBg(t); return t; };

  function headerRow(){
    const g=gridRow();
    g.appendChild(el("div","hdr nm"));
    const q=el("div","qlabels");
    let t=0;
    for(let p=1;p<=G.maxP;p++){
      const d=el("div","",p<=4?"Q"+p:"OT"+(p-4));
      d.style.left=((t+plen(p)/2)/total*100)+"%"; q.appendChild(d); t+=plen(p);
    }
    g.appendChild(q);
    ["min","pts","+/−"].forEach(h=>g.appendChild(el("div","hdr st",h)));
    return g;
  }

  function playerRows(side){
    const frag=document.createDocumentFragment();
    const roster=G.players.filter(x=>x.side===side)
      .sort((a,b)=> (b.starter-a.starter) || b.calcMin-a.calcMin);
    for(const pl of roster){
      const g=gridRow();
      const nm=el("div","nm");
      nm.appendChild(el("span","jn",pl.jersey));
      nm.appendChild(el("span","",pl.name));
      nm.title = pl.name + (pl.starter?" (starter)":"") + (pl.dnp?" — "+pl.dnp.replace(/_/g," "):"");
      if(pl.foulCount){
        const cls = pl.fouledOut ? "pf dq" : pl.foulCount>=5 ? "pf warn" : "pf";
        const chip=el("span",cls, pl.foulCount+"f");
        chip.title = pl.fouledOut ? `Fouled out (${pl.foulCount} fouls)`
                   : `${pl.foulCount} personal foul${pl.foulCount>1?"s":""}`
                     + (pl.troubleFrom? ` — ${pl.troubleFrom.n} by ${stamp(pl.troubleFrom.t,G.maxP)}` : "");
        nm.appendChild(chip);
      }
      g.appendChild(nm);

      const tr=trackCell();
      for(const s of pl.stints){
        const w=(s.et-s.st)/total*100; if(w<=0) continue;
        const d=el("div","stint");
        d.style.left=pct(s.st); d.style.width=w+"%";
        d.style.background = shade ? pmColor(s.pm) : gc(pl.tri);
        d.style.color = "#fff";
        if(w>4.2){
          d.appendChild(el("span","sp", s.pts? String(s.pts):"·"));
          d.appendChild(el("span","spm", sgn(s.pm)));
        }
        const mates=[...G.players].filter(x=>x.side===side && x.id!==pl.id &&
              x.stints.some(q=>q.st < s.et-1 && q.et > s.st+1))
              .map(x=>x.name);
        // fouls picked up during this stint, and the count he carried off the floor
        const inStint=pl.fouls.filter(f=>f.t>=s.st-1e-6 && f.t<=s.et+1e-6);
        const carried=pl.fouls.filter(f=>f.t<=s.et+1e-6).length;
        const troubled = pl.troubleFrom && pl.troubleFrom.t<=s.et+1e-6;
        let foulLine="";
        if(inStint.length)
          foulLine += `<div class="kv"><span>fouls here</span><b>`+
            inStint.map(f=>ord(f.n)).join(", ")+`</b></div>`;
        if(carried)
          foulLine += `<div class="kv"><span>left with</span><b>${carried} foul${carried>1?"s":""}`+
            (carried>=FOUL_LIMIT_UI? " — fouled out" : troubled? " — in foul trouble":"")+`</b></div>`;
        d.addEventListener("mousemove",ev=>showTip(
          `<div class="th">${esc(pl.name)}</div>`+
          `<div class="kv"><span>on floor</span><b>${stamp(s.st,G.maxP)} → ${stamp(s.et,G.maxP)}</b></div>`+
          `<div class="kv"><span>stint length</span><b>${((s.et-s.st)/60).toFixed(1)} min</b></div>`+
          `<div class="kv"><span>his points</span><b>${s.pts}</b></div>`+
          `<div class="kv"><span>team +/−</span><b>${sgn(s.pm)}</b></div>`+
          foulLine+
          (mates.length?`<div class="mates">with: ${mates.join(", ")}</div>`:""), ev));
        d.addEventListener("mouseleave",hideTip);
        tr.appendChild(d);
      }
      // foul marks, drawn over the bars so a run of them is easy to spot
      for(const f of pl.fouls){
        const k=el("div","foul"+(f.n>=FOUL_LIMIT_UI?" dq":f.n>=FOUL_LIMIT_UI-1?" warn":""));
        k.style.left=`calc(${pct(f.t)} - 1px)`;
        tr.appendChild(k);
      }
      g.appendChild(tr);
      g.appendChild(el("div","st",pl.boxMin?pl.boxMin.toFixed(1):"—"));
      g.appendChild(el("div","st pts",pl.boxPts||(pl.played?0:"—")));
      g.appendChild(el("div","st",pl.played?sgn(pl.boxPM):"—"));
      frag.appendChild(g);
    }
    return frag;
  }

  function lineupRow(side){
    const g=gridRow();
    g.appendChild(el("div","nm","lineup +/−"));
    const tr=trackCell("");
    for(const L of G.lineups[side]){
      const w=(L.t1-L.t0)/total*100;
      const d=el("div","lp");
      d.style.left=pct(L.t0); d.style.width=w+"%";
      d.style.background=pmColor(L.pm);
      if(w>2.2) d.textContent=sgn(L.pm);
      d.addEventListener("mousemove",ev=>showTip(
        `<div class="th">Lineup ${sgn(L.pm)} in ${((L.t1-L.t0)/60).toFixed(1)} min</div>`+
        `<div class="kv"><span>span</span><b>${stamp(L.t0,G.maxP)} → ${stamp(L.t1,G.maxP)}</b></div>`+
        `<div class="mates">${L.on.map(x=>esc(x.name)).join("<br>")}</div>`,ev));
      d.addEventListener("mouseleave",hideTip);
      tr.appendChild(d);
    }
    g.className="grid lprow";
    g.appendChild(tr);
    ["","",""].forEach(()=>g.appendChild(el("div","st","")));
    return g;
  }

  function runRow(side){
    const g=gridRow(); g.className="grid runrow";
    const tm = side? home : away;
    const mode=runMode();
    g.appendChild(el("div","nm",tm.teamName+" runs"));
    const tr=trackCell();
    const list=(G.runsBy[mode]||[])[side]||[];
    for(const R of list){
      const w=Math.max((R.t1-R.t0)/total*100, 2.2);
      const d=el("div","run");
      d.style.left=pct(R.t0); d.style.width=w+"%";
      d.style.background=gc(tm.teamTricode); d.style.color="#fff";
      d.textContent = R.mine+"-"+R.theirs;
      d.addEventListener("mousemove",ev=>showTip(
        `<div class="th">${tm.teamName} run ${R.mine}-${R.theirs}</div>`+
        `<div class="kv"><span>span</span><b>${stamp(R.t0,G.maxP)} → ${stamp(R.t1,G.maxP)}</b></div>`+
        `<div class="kv"><span>rule</span><b>${RUN_LABEL[mode]}</b></div>`,ev));
      d.addEventListener("mouseleave",hideTip);
      tr.appendChild(d);
    }
    if(!list.length) tr.appendChild(el("div","runnone","no run by this rule"));
    g.appendChild(tr);
    ["","",""].forEach(()=>g.appendChild(el("div","st","")));
    return g;
  }

  /* The old calculation, kept but named honestly. It is not a run: for a wire-to-wire win
     it spans most of the game, which is the correct answer to "largest margin swing" and
     the wrong answer to "when did they go on a run". */
  function swingRow(side){
    const g=gridRow(); g.className="grid runrow";
    const tm = side? home : away;
    g.appendChild(el("div","nm","biggest swing"));
    const tr=trackCell();
    const R=G.swings[side];
    if(R){
      const w=Math.max((R.t1-R.t0)/total*100, 2.2);
      const d=el("div","run swing");
      d.style.left=pct(R.t0); d.style.width=w+"%";
      d.style.borderColor=gc(tm.teamTricode);
      d.textContent = `${R.mine}-${R.theirs} (${R.swing>0?"+":""}${R.swing})`;
      d.addEventListener("mousemove",ev=>showTip(
        `<div class="th">${tm.teamName} biggest swing +${R.swing}</div>`+
        `<div class="kv"><span>span</span><b>${stamp(R.t0,G.maxP)} → ${stamp(R.t1,G.maxP)}</b></div>`+
        `<div class="kv"><span>note</span><b>largest margin change, not a run</b></div>`,ev));
      d.addEventListener("mouseleave",hideTip);
      tr.appendChild(d);
    }else tr.appendChild(el("div","runnone","never ahead on the swing"));
    g.appendChild(tr);
    ["","",""].forEach(()=>g.appendChild(el("div","st","")));
    return g;
  }

  function flowRow(){
    const g=gridRow(); g.className="grid chartrow";
    const lab=el("div","nm"); lab.style.whiteSpace="normal";
    lab.innerHTML=`<span style="color:var(--dimmer);font-size:10.5px">score margin<br>`+
      `<span style="color:${gc(home.teamTricode)}">${home.teamTricode} up ↑</span> / `+
      `<span style="color:${gc(away.teamTricode)}">${away.teamTricode} up ↓</span></span>`;
    g.appendChild(lab);

    const tr=trackCell();
    const maxAbs=Math.max(6, ...G.flow.map(f=>Math.abs(f.d)));
    const W=1000,H=132, y=d=>H/2 - d/maxAbs*(H/2-8), x=t=>t/total*W;
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("viewBox",`0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio","none");
    const ns="http://www.w3.org/2000/svg";
    const mk=(t,at)=>{const e=document.createElementNS(ns,t);
      for(const k in at) e.setAttribute(k,at[k]); return e;};

    // zero line + shaded areas
    let dTop="M0,"+(H/2), dBot="M0,"+(H/2);
    let prev={t:0,d:0};
    const pts=[];
    for(const f of G.flow){ pts.push([x(prev.t),y(prev.d)],[x(f.t),y(prev.d)],[x(f.t),y(f.d)]); prev=f; }
    const poly=pts.map(p=>p[0].toFixed(2)+","+p[1].toFixed(2)).join(" ");
    svg.appendChild(mk("polyline",{points:poly,fill:"none",
      stroke:"#cfd8e6","stroke-width":1.6,"vector-effect":"non-scaling-stroke"}));
    svg.appendChild(mk("polygon",{points:`0,${H/2} `+poly+` ${W},${H/2}`,
      fill:gc(home.teamTricode),opacity:.13}));
    svg.appendChild(mk("line",{x1:0,y1:H/2,x2:W,y2:H/2,stroke:"#3a4356",
      "stroke-width":1,"vector-effect":"non-scaling-stroke"}));
    tr.appendChild(svg);

    const a1=el("div","axlabel",`+${maxAbs}`); a1.style.top="6px"; tr.appendChild(a1);
    const a2=el("div","axlabel","0");          a2.style.top="50%";  tr.appendChild(a2);
    const a3=el("div","axlabel",`−${maxAbs}`); a3.style.top="calc(100% - 6px)"; tr.appendChild(a3);

    tr.addEventListener("mousemove",ev=>{
      const r=tr.getBoundingClientRect();
      const t=clamp((ev.clientX-r.left)/r.width,0,1)*total;
      let cur=0; for(const f of G.flow){ if(f.t<=t) cur=f.d; }
      const hs=[...G.flow].filter(f=>f.t<=t).pop();
      showTip(`<div class="th">${stamp(t,G.maxP)}</div>`+
        `<div class="kv"><span>margin</span><b>${sgn(cur)} ${home.teamTricode}</b></div>`,ev);
    });
    tr.addEventListener("mouseleave",hideTip);
    g.appendChild(tr);
    ["","",""].forEach(()=>g.appendChild(el("div","st","")));
    return g;
  }

  /* ---------- assemble ---------- */
  card.appendChild(headerRow());
  const s1=el("div","grid"); s1.appendChild(el("div","sect nm",away.teamCity+" "+away.teamName));
  s1.appendChild(el("div","sect","")); card.appendChild(s1);
  card.appendChild(playerRows(0));
  card.appendChild(lineupRow(0));
  card.appendChild(runRow(0));
  card.appendChild(swingRow(0));
  card.appendChild(flowRow());
  card.appendChild(swingRow(1));
  card.appendChild(runRow(1));
  card.appendChild(lineupRow(1));
  const s2=el("div","grid"); s2.appendChild(el("div","sect nm",home.teamCity+" "+home.teamName));
  s2.appendChild(el("div","sect","")); card.appendChild(s2);
  card.appendChild(playerRows(1));
  card.appendChild(headerRow());

  const lg=el("div","legend");
  lg.innerHTML =
    `<span><i style="background:${gc(away.teamTricode)}"></i>${away.teamTricode} on floor</span>`+
    `<span><i style="background:${gc(home.teamTricode)}"></i>${home.teamTricode} on floor</span>`+
    `<span><i style="background:${pmColor(12)}"></i>lineup outscoring</span>`+
    `<span><i style="background:${pmColor(-12)}"></i>lineup outscored</span>`+
    `<span><i style="background:rgba(255,255,255,.62);width:3px"></i>foul</span>`+
    `<span><i style="background:#ffcf6b;width:3px"></i>5th</span>`+
    `<span><i style="background:#ff7b6b;width:3px"></i>6th — fouled out</span>`+
    `<span>each bar reads <b style="color:var(--text)">points</b> · <b style="color:var(--text)">+/−</b> for that stint</span>`;
  card.appendChild(lg);

  /* ---------- period table ---------- */
  card.appendChild(el("div","rule"));
  const tbl=el("table","per");
  const th=el("tr");
  th.appendChild(el("th","","team"));
  for(let p=1;p<=G.maxP;p++) th.appendChild(el("th","",(p<=4?"Q"+p:"OT"+(p-4))));
  ["final","fg%","3p%","reb","ast","to"].forEach(h=>th.appendChild(el("th","",h)));
  tbl.appendChild(th);
  [0,1].forEach(side=>{
    const tm=side?home:away, rows=G.per[side];
    const tr=el("tr");
    const c=el("td"); const dd=el("span","dot");
    c.innerHTML=`<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${gc(tm.teamTricode)};margin-right:6px"></span>${tm.teamTricode}`;
    tr.appendChild(c);
    rows.forEach(r=>tr.appendChild(el("td","",r.pts)));
    const T=rows.reduce((a,r)=>({fga:a.fga+r.fga,fgm:a.fgm+r.fgm,tpa:a.tpa+r.tpa,tpm:a.tpm+r.tpm,
      reb:a.reb+r.reb,ast:a.ast+r.ast,to:a.to+r.to}),{fga:0,fgm:0,tpa:0,tpm:0,reb:0,ast:0,to:0});
    const pc=(m,a)=>a? (m/a*100).toFixed(1) : "—";
    [tm.score, pc(T.fgm,T.fga), pc(T.tpm,T.tpa), T.reb, T.ast, T.to]
      .forEach(v=>tr.appendChild(el("td","",v)));
    tbl.appendChild(tr);
  });
  card.appendChild(tbl);
  finishRender();
}

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
const heatColor = v => HEAT_STOPS[clamp(Math.round(v*(HEAT_STOPS.length-1)),0,HEAT_STOPS.length-1)];

const modelCache = new Map();           // gameId -> built model, so switching teams is cheap

/* Every read of a game goes through modelFor, so this is the one place that can tell the
   difference between "this game has no play-by-play" and "this season has none". A season
   ESPN never logged fails every game, and the honest thing is to say so rather than draw
   empty tables next to a game count of zero. */
let PBP_TRIED=0, PBP_MISSING=0, NO_PBP=false;
const PBP_SAMPLE=6;      // enough that one unlucky game can't condemn a season
function pbpOutcome(missing){
  PBP_TRIED++;
  if(missing) PBP_MISSING++;
  NO_PBP = PBP_TRIED>=PBP_SAMPLE && PBP_MISSING===PBP_TRIED;
  const el2=$("#nopbp"); if(!el2) return;
  el2.hidden=!NO_PBP;
  el2.innerHTML = NO_PBP
    ? `<b>No play-by-play for the ${seasonLabel()} season.</b> ${PBP_MISSING} of `
      + `${PBP_TRIED} games were asked for and none came back with a substitution log, so `
      + `everything built from one — stints, lineups, runs, shot charts — is empty for this `
      + `season. <b>Records against top teams</b> reads the schedule's final scores instead, `
      + `so that section still works. Whether a past season's play-by-play exists is the `
      + `source's call, not this page's.<br><br>`
    : "";
}

/* A build in which every read failed is not an empty season — it is a season whose
   play-by-play the source does not have. Drawing a chart of nothing, next to a game count of
   zero, would leave the reader to guess which it was. */
function reportNoPbp(){
  $("#out").innerHTML="";
  setStatus(`<b>No play-by-play for the ${seasonLabel()} season.</b><br>`+
    `Every game asked for came back without a substitution log, so this view has nothing to `+
    `draw. <b>Records vs top teams</b> reads the schedule's final scores instead, and works `+
    `for any season. Whether a past season's play-by-play still exists is the source's call, `+
    `not this page's.`, true);
}
const allReadsFailed = (total, failed) => total>0 && failed>=total;

/* Games the nightly build has already read (docs/data/flow): the same ESPN data, kept compact, so a season or
   league view reads ~15 KB a game from this site instead of ~450 KB each from ESPN. Anything not on file — an
   older season, tonight's game, a game the build hasn't reached — comes from ESPN as before. */
let FLOW = null;
async function loadFlowIndex(){
  try{ const r=await fetch("data/flow/index.json",{cache:"no-store"}); if(!r.ok) return;
       const j=await r.json(); FLOW={season:String(j.season), ids:new Set((j.ids||[]).map(String))}; }
  catch(e){ FLOW=null; }
}
async function compactFor(g){
  if(!FLOW || seasonYear()!==FLOW.season || !FLOW.ids.has(String(g.gameId))) return null;
  try{ const r=await fetch(`data/flow/${FLOW.season}/${g.gameId}.json`); return r.ok? await r.json() : null; }
  catch(e){ return null; }
}
/* Scoring highs and the Assist leaderboard read one season file of per-game slices (data/flow/<season>-lite.json,
   built nightly from the same model, 0.60) instead of every game's file. A game not in it is read in full. */
let LITE=null;
function liteFile(){
  if(!FLOW || seasonYear()!==FLOW.season) return Promise.resolve(null);
  if(!LITE) LITE=fetch(`data/flow/${FLOW.season}-lite.json`,{cache:"no-store"}).then(r=>r.ok? r.json() : null).then(j=>j && j.games || null).catch(()=>null);
  return LITE;
}
export async function liteOrModel(g){
  const L=await liteFile();
  const m=L && L[String(g.gameId)];
  return m || modelFor(g);
}
window.__flow = { index:()=>FLOW, compactFor, liteOrModel };

export async function modelFor(g){
  if(modelCache.has(g.gameId)) return modelCache.get(g.gameId);
  let pbp, box;
  if(ACTIVE==="espn"){
    const c = await compactFor(g);
    if(c) ({pbp,box} = expandFeeds(c));
    else{
      const sum = await getJSON(`${ESPN_SUMMARY}?event=${g.gameId}`);
      if(!sum.plays || !sum.plays.length){ pbpOutcome(true); throw new Error("no play-by-play"); }
      ({pbp,box} = espnToFeeds(sum));
    }
  }else{
    [pbp,box] = await Promise.all([
      feed(`liveData/playbyplay/playbyplay_${g.gameId}.json`),
      feed(`liveData/boxscore/boxscore_${g.gameId}.json`),
    ]);
  }
  if(!pbp.game || !pbp.game.actions || !pbp.game.actions.length){
    pbpOutcome(true); throw new Error("no play-by-play"); }
  pbpOutcome(false);
  const G = buildStints(pbp, box);
  modelCache.set(g.gameId, G);
  return G;
}

/** Finished regular-season games only: a game in progress would drag the season
    down, and a non-counting game would inflate totals against every other source. */
/* Every franchise on the schedule, read from both sides of every game. Reading only the
   home side happens to cover the league once the season is under way, but it is one
   postponement away from dropping a team, and anything that walks a team's own schedule —
   rest between games, for one — would then walk nothing for that team and silently report
   no data rather than an error. */
export function franchises(){
  const s=new Set();
  for(const g of GAMES){
    if(isFranchise(g.home)) s.add(g.home);
    if(isFranchise(g.away)) s.add(g.away);
  }
  return [...s];
}

export function teamGamesFor(tri){
  return GAMES.filter(g=>g.status===3 && isRegularSeason(g) && g.pbp!==false
    && isFranchise(g.away) && isFranchise(g.home)
    && (g.away===tri || g.home===tri));
}

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

function renderSeason(agg){
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
function fillSpan(){
  const sel=$("#span"); if(sel.options.length) return;
  sel.appendChild(new Option("Full season","0"));
  for(let n=MAX_SPAN;n>=2;n--) sel.appendChild(new Option(`Last ${n} games`,String(n)));
}
const spanValue = () => $("#span") ? (parseInt($("#span").value,10)||0) : 0;

async function showSeason(tri){
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
    seasonAgg=agg; window.__SEASON=agg;
    renderSeason(agg);
    hideStatus();
  }catch(e){
    $("#out").innerHTML="";
    setStatus(`<b>Couldn't build the season view.</b><br>${String(e.message||e)}`+HOWTO,true);
  }
}

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

const assistMetric = () => ($("#metric") ? $("#metric").value : "ast");
const shotFilter   = () => ($("#shot") ? $("#shot").value : "all");
const rankMode     = () => ($("#rank") ? $("#rank").value : "pair");
const runMode      = () => ($("#runmode") ? $("#runmode").value : "unanswered");
/* Spelled out in the tooltip on every run, so the rule behind a bar is never a guess. */
const RUN_LABEL = {
  unanswered: `${RUN_MIN}+ unanswered points`,
  near: `${RUN_MIN}+ margin, at most ${RUN_ALLOW} opposing basket`,
  swing: `${RUN_MIN}+ margin swing inside ${Math.round(SWING_CAP/60)} minutes`,
};
export const layoutMode   = () => ($("#layout") ? $("#layout").value : "table");

/* The layout control serves two views with different presentations. Options are
   rebuilt on a view change and the previous choice is kept only if it still exists,
   so switching views can't leave a value the current view doesn't understand. */
/* Nine sections offer a poster now. The five that were table-only share one ranked-card
   design; the four originals keep their own, because a shot chart is not a ranking. */
const TABLE_OR_POSTER=[["table","table"],["poster","infographic"]];
const LAYOUTS={
  board:TABLE_OR_POSTER,
  highs:TABLE_OR_POSTER, streaks:TABLE_OR_POSTER,
  range:[["profile","shot profile"],["courts","shot charts"],["plot","distance on court"],["scatter","accuracy vs distance"]],
  splits:[["court","on / off court"],["game","by game"]],  // on/off first: the game-level split lives on the With / without page (0.58)
};
/* The rank control serves two views as well: it picks the unit for the assist board, and
   the size of the comparison group for records. Same rebuild-per-view treatment. */
export const FORM_LENS = [2,3,4,5];
/* Enough other games for a spread to mean anything. Below this a single quiet night sets the
   scale and everything looks like a heater. */
export const FORM_MIN_BASE = 5;
export const FORM_STATS = {pts:"points", reb:"rebounds", ast:"assists",
                    to:"turnovers", min:"minutes",
                    pra:"points + rebounds + assists"};
/* The one-number answer to "is he up across the board". Nothing new in the machinery: it is
   a per-game number like any other, so the spread, the median gate and the runs all apply
   to it unchanged. */
export const FORM_CATS = ["pts","reb","ast"];
/* Whether more of it is good. Nothing in the maths cares — the direction control asks for
   above or below his normal, which is unambiguous either way — but the screen should not
   call a run of nine-turnover games a hot streak. */
const FORM_HIGH_GOOD = {pts:true, reb:true, ast:true, to:false, min:true, pra:true};

/* Threshold and direction are one decision, so they are one control: "+1.0 SD above" and
   "−1.0 SD below" are the two ends of the same question, and splitting them across two
   dropdowns made the reader assemble the sentence themselves. Tenths, so the ids stay
   integers. */
const FORM_SDS = [10, 5];
const FORM_THRESHOLDS = [].concat(
  ...FORM_SDS.map(t=>[["sd"+t+"up", `+${(t/10).toFixed(1)} SD above normal`],
                      ["sd"+t+"dn", `−${(t/10).toFixed(1)} SD below normal`]]));

/* Two qualifiers, both learned from reading the output.
   A floor, because a standard deviation is a relative measure and small numbers have small
   spreads: 2, 5, 2, 5, 4 points against a normal of 1.3 clears +2 SD and is not a scoring
   run by any human reading. Applied to the stretch when looking for a heater — the recent
   production has to be worth reporting — and to his normal when looking for a slump, because
   what makes a slump interesting is that he is usually better than this.
   A minutes bar, because a four-minute appearance in a blowout is not a performance. Every
   game in the stretch has to clear it, so one garbage-time cameo takes a player out of the
   list rather than dragging his averages down and putting him in it. */
export const FORM_FLOORS = {
  pts:[0,5,10,15,20], reb:[0,2,4,6,8], ast:[0,2,3,5,7],
  to:[0,2,3,4], min:[0,10,15,20,25], pra:[0,10,15,20,25,30],
};
const FORM_MIN_MINUTES = [0,10,15,20,25];

/* How many defenses count as "the top". Changing it also changes what "the rest" means,
   which is the whole point of having the control: the two columns are complements. */
const DEF_GROUPS=[5,4,3];
/* Every size from the whole winning half down to the single best team, generated so the
   set stays contiguous rather than a hand-picked few. */
const RECORD_GROUPS=[8,7,6,5,4,3,2,1];
/* The All-Star roster is only a filter, so the same section can cover the whole league.
   What it can't do is cover it without a minimum: against any one team a player gets two
   or three games a season, so someone with a handful of appearances and one hot night
   would sit at the top of a "falls off most" ranking on noise alone. A player qualifies by
   having played at least half his team's games — enough that the season column means
   something — and by having games on BOTH sides of the split, because a gap between a
   column and an empty column is not a gap. */
export const POOL_SHARE = 0.5;
export const POOL_MIN_SIDE = 2;
/* A scoring floor as well as a games floor. A player averaging two points has nothing to
   fall off: his split is the difference between one quiet night and another, and a single
   basket swings it further than a 20-point scorer's best game swings his. Five is the line,
   applied to the season average so it doesn't move with the group size. */
export const POOL_MIN_PPG = 5;
export const POOL_N = 25;      // rows per block once there are enough players to rank
export const poolMode = () => ($("#pool") ? $("#pool").value : "stars");
export const defTopN = () => {
  const m=/^def(\d+)$/.exec($("#rank")? $("#rank").value : "");
  return m? +m[1] : DEF_TOP_N;
};
export const topDefOf = (agg,n) => agg.teams.slice(0,n).map(t=>t.tri);

const RANKS={
  board:[["pair","player-to-player pairs"],["given","assists created"],
         ["got","assisted baskets"]],
  records:[["win","teams with winning records"]].concat(
    RECORD_GROUPS.map(n=>["top"+n, `top ${n} by record`])),
  allstars:DEF_GROUPS.map(n=>["def"+n, `vs top ${n} defenses`]),
  form:FORM_THRESHOLDS,
  // filled in by the Cup section, which is defined further down
  cup:null,
};
function setRankOptions(v){
  const sel=$("#rank"); if(!sel) return;
  if(v==="cup" && !RANKS.cup) RANKS.cup=CUP_THRESHOLDS;
  const want=RANKS[v] || RANKS.board;
  const same=sel.options.length===want.length
    && want.every((o,i)=>sel.options[i].value===o[0]);
  if(same) return;
  const keep=sel.value;
  sel.innerHTML="";
  want.forEach(([val,label])=>{
    const o=document.createElement("option"); o.value=val; o.textContent=label;
    sel.appendChild(o);
  });
  sel.value = want.some(o=>o[0]===keep) ? keep : want[0][0];
  sel.title = v==="records" ? "How big a group to measure against"
            : v==="allstars" ? "How many defenses count as the top"
            : v==="form" ? "How far from his own normal, and which side"
            : v==="cup" ? "How far his Cup average sits from his normal, and which side"
                             : "What to rank";
}
function setLayoutOptions(v){
  const sel=$("#layout"); if(!sel) return;
  /* Looked up by view, with the board as the fallback: adding a section to LAYOUTS is now
     all it takes, rather than extending a chain of conditionals. */
  const want=LAYOUTS[v] || LAYOUTS.board;
  const same=sel.options.length===want.length
    && want.every((o,i)=>sel.options[i].value===o[0]);
  if(same) return;
  const keep=sel.value;
  sel.innerHTML="";
  want.forEach(([val,label])=>{
    const o=document.createElement("option"); o.value=val; o.textContent=label;
    sel.appendChild(o);
  });
  sel.value = want.some(o=>o[0]===keep) ? keep : want[0][0];
  sel.title = v==="range" ? "How to present the range data"
            : v==="board" ? "How to present the pair ranking"
                          : "Table, or a poster of the same ranking";
}
const rankKey      = () => (rankMode()==="got" ? "got" : "given");
const SHOT_LABEL = {all:"all field goals", "2":"2-pointers", "3":"3-pointers"};

/* One accessor for every combination of metric and shot type, so the matrix,
   the totals and the leaderboard can never disagree with each other. */
function astValue(o, prefix){
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

function renderAssists(agg){
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

async function showAssists(tri){
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
    assistAgg=agg; window.__ASSISTS=agg;
    renderAssists(agg);
    hideStatus();
  }catch(e){
    $("#out").innerHTML="";
    setStatus(`<b>Couldn't build the assist network.</b><br>${String(e.message||e)}`+HOWTO,true);
  }
}

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

function renderHighs(agg){
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

async function showHighs(){
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
    highsAgg=agg; window.__HIGHS=agg;
    renderHighs(agg);
    hideStatus();
  }catch(e){
    $("#out").innerHTML="";
    setStatus(`<b>Couldn't build the scoring highs.</b><br>${String(e.message||e)}`+HOWTO,true);
  }
}

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

function renderRange(agg){
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
  const bits=[`Ranked on mean distance over every three-point attempt, makes and misses.`,
    `${tot-noD} of ${tot} attempts carried a distance.`];
  /* Which signal fed the average decides how much the decimal is worth, so it is
     named rather than left for the reader to assume. The league feed measures to a
     hundredth of a foot; ESPN states whole feet, so the same leaderboard is roughly
     two orders of magnitude coarser per shot on that source. */
  if(nField) bits.push(`${nField} came from the league feed's own <b>shotDistance</b>, `+
    `measured to a hundredth of a foot.`);
  if(nText) bits.push(`${nText} were read from the play text, which states `+
    `<b>whole feet</b> — so each of those carries up to half a foot of rounding.`);
  if(nSpot) bits.push(`${nSpot} fell back to the shot's coordinate.`);
  if(nText && !nField) bits.push(`Running the local helper switches to the official `+
    `feed and replaces every whole-foot figure with a measured one.`);
  if(agg.agree) bits.push(`Where a stated distance and a coordinate both exist they `+
    `differ by ${agg.agree.mean.toFixed(2)} ft on average (worst `+
    `${agg.agree.max.toFixed(0)} ft).`);
  bits.push(`Dots are placed from the coordinate; attempts from the same spot stack `+
    `into one larger dot rather than being scattered to look distinct.`);
  const nt=el("div","note"); nt.innerHTML=bits.join(" ");
  card.appendChild(nt);
  finishRender();
}

async function showRange(){
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
    rangeAgg=agg; window.__RANGE=agg;
    renderRange(agg);
    hideStatus();
  }catch(e){
    $("#out").innerHTML="";
    setStatus(`<b>Couldn't build the range chart.</b><br>${String(e.message||e)}`+HOWTO,true);
  }
}

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
const CUP_THRESHOLDS = [].concat(
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
let cupExtra = null;
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

async function showLeague(which){
  /* The Cup is compared with the whole season whatever the game window says: a window of
     the last ten games would leave November's Cup games out of their own comparison. */
  const limit = which==="cup" ? 0 : spanValue();
  const bar=el("div","prog"); const fill=el("i"); bar.appendChild(fill);
  setStatus(`<span class="spin"></span>Reading the league…`);
  $("#status").appendChild(bar);
  try{
    if(which==="streaks" && !(leagueAgg && leagueAgg.window.limit===limit)){
      const N=await nightlyLeads(limit);
      if(N){ renderStreaks(N); hideStatus(); return; }
    }
    if(!leagueAgg || leagueAgg.window.limit!==limit){
      leagueAgg=await buildLeague(limit,(done,total)=>{
        fill.style.width=(100*done/total)+"%";
        if($("#status").childNodes[1]) $("#status").childNodes[1].textContent=
          `Reading the league… ${done}/${total} games`;
      });
      window.__LEAGUE=leagueAgg;
    }
    if(allReadsFailed(leagueAgg.games, leagueAgg.failed)){ reportNoPbp(); return; }
    await ({streaks:renderStreaks, splits:renderSplits}[which])(leagueAgg);
    hideStatus();
  }catch(e){
    $("#out").innerHTML="";
    setStatus(`<b>Couldn't build that section.</b><br>${String(e.message||e)}`+HOWTO,true);
  }
}



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
window.__rank = {denseRanks, topWithTies};
window.__poster = {fitText, pctile};
window.__rest = {restIndex, restRows, restStats, gameDay, dayNum, restBucket,
                REST_BUCKETS};
window.__as = {ALL_STARS, normName, allStarRows, leaguePool, splitRow, renderPool,
               defDefinition,
               POOL_SHARE, POOL_MIN_SIDE, POOL_MIN_PPG, POOL_N};
window.__split = {splitByTeammate, onOffSplit, ivAnd, ivSub, ivSec, ivHas};
window.__col = {TEAM, brandCol, brandAlt, tcol, tcolAlt, liftForDark, sideColours,
                contrastOf, hexRgb, rgbGap, tint, barAlpha,
                DARK_BG, MIN_DARK_CONTRAST, MIN_SIDE_GAP};

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
function renderBoard(agg){
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

async function showBoard(){
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
    boardAgg=agg; window.__BOARD=agg;
    renderBoard(agg);
    hideStatus();
  }catch(e){
    $("#out").innerHTML="";
    setStatus(`<b>Couldn't build the leaderboard.</b><br>${String(e.message||e)}`+HOWTO,true);
  }
}

/* ============================ app shell ============================ */
export let SCHED=null, GAMES=[], filtered=[], curIdx=-1;
let seasonAgg=null, assistAgg=null, boardAgg=null, highsAgg=null, rangeAgg=null,
    leagueAgg=null;
const viewMode = () => $("#view").value;

function setStatus(html, err){
  const s=$("#status"); s.hidden=false; s.className="status"+(err?" err":""); s.innerHTML=html;
}
const hideStatus = ()=>{ $("#status").hidden=true; };

function flattenSchedule(js){
  const ls=js.leagueSchedule||js;
  const out=[];
  (ls.gameDates||[]).forEach(gd=>(gd.games||[]).forEach(g=>{
    if(!g.gameId) return;
    out.push({
      gameId:g.gameId, status:g.gameStatus, statusText:g.gameStatusText,
      away:g.awayTeam.teamTricode, home:g.homeTeam.teamTricode,
      as:g.awayTeam.score, hs:g.homeTeam.score,
      date:g.gameDateTimeEst||g.gameDateEst,
      stype:seasonTypeOfId(g.gameId),
      label:g.gameLabel || STYPE_LABEL[seasonTypeOfId(g.gameId)] || "",
      gameLabel:g.gameLabel||"", gameDateTimeEst:g.gameDateTimeEst,
    });
  }));
  out.sort((a,b)=> new Date(a.date)-new Date(b.date) || a.gameId.localeCompare(b.gameId));
  /* The league feed writes the season as "2025-26"; everything else here numbers it by the
     year it ends, as ESPN does. */
  const sy=/^(\d{4})-(\d{2})$/.exec(String(ls.seasonYear||""));
  return {season: sy ? String(+sy[1]+1) : String(ls.seasonYear||""), games:out};
}

/* ESPN's whole season arrives in one scoreboard request over a date range. */
function flattenEspnSchedule(js){
  const out=[];
  (js.events||[]).forEach(e=>{
    const c=(e.competitions||[])[0]; if(!c) return;
    const home=(c.competitors||[]).find(x=>x.homeAway==="home");
    const awayT=(c.competitors||[]).find(x=>x.homeAway==="away");
    if(!home||!awayT) return;
    const st=(e.status&&e.status.type)||{};
    const state=st.state||"pre";
    out.push({
      gameId:String(e.id),
      /* "post" alone is not "final": ESPN gives postponed and cancelled games state "post"
         too, with completed:false. Counting those as played put four phantom games into
         2025-26 and gave eight teams an 83rd game. */
      status: (state==="post" && st.completed) ? 3 : state==="in" ? 2 : 1,
      statusText:(e.status&&e.status.type&&e.status.type.description)||"",
      away:espnTri(awayT.team.abbreviation), home:espnTri(home.team.abbreviation),
      as:parseInt(awayT.score,10)||0, hs:parseInt(home.score,10)||0,
      date:e.date,
      // ESPN gives the season type directly; anything not "2" is out of scope for
      // season totals, and its label is carried through so the scope can say so
      stype:(e.season && e.season.type) || 9,
      label:((c.notes||[])[0] && (c.notes[0].headline||"").trim())
            || STYPE_LABEL[(e.season&&e.season.type)] || "",
      gameLabel:"", gameDateTimeEst:e.date,
      pbp: !!c.playByPlayAvailable,
    });
  });
  out.sort((a,b)=> new Date(a.date)-new Date(b.date) || a.gameId.localeCompare(b.gameId));
  /* From the events, not from js.leagues: the leagues block reports the *current* season
     whatever date range was asked for, so a 2024 request would come back labelled 2026. */
  const yr=out.length? (js.events||[]).map(e=>e.season&&e.season.year).find(Boolean)||"" : "";
  return {season:String(yr), games:out};
}

/* The schedule also carries All-Star and exhibition sides (e.g. the All-Star Game's
   squads, and any Team USA / Team World-style exhibition rosters). They aren't
   franchises and have no substitution story worth charting, so anything not in the
   TEAM map is left out of both the filter and the game list. */
/* A hardcoded team table has one dangerous failure: the league adds a franchise, its games
   have a tricode nothing recognises, and every stat quietly excludes them. No error, just an
   incomplete league — the worst kind of wrong.
   So an unrecognised tricode that turns up in a *regular-season* game is treated as a
   franchise the table hasn't caught up with, and named on screen so it can be added. The
   regular-season condition is what keeps exhibition and All-Star sides out: those never
   appear in the regular-season schedule. */
let NEWCOMERS=new Set();
function scanFranchises(){
  NEWCOMERS=new Set();
  for(const g of GAMES){
    if(!isRegularSeason(g)) continue;
    /* Played games only, and never a placeholder. ESPN lists NBA Cup knockout games months
       ahead as "TBD @ TBD", filed as regular season, and without this the page announced
       TBD as a new franchise. A real new team will have finished games to show for it. */
    if(g.status!==3) continue;
    for(const t of [g.away, g.home])
      if(t && !knownTeam(t) && !/^TBD$/i.test(t)) NEWCOMERS.add(t);
  }
  return NEWCOMERS;
}
export const isFranchise = t => knownTeam(t) || NEWCOMERS.has(t);

/* Preseason games are excluded: rotations there are experiments, not the real thing.
   Digits 2-3 of the game id encode the season type ("01" preseason, "02" regular
   season, "04" post-season), which is checked alongside the schedule's own label. */
/* Season type, normalised across both sources so scope can be stated exactly:
   1 preseason · 2 regular season · 3 post-season · 4 all-star · 9 anything else.
   The league feed encodes it in digits 2-3 of the game id; ESPN gives it directly. */
const NBA_STYPE = {"01":1, "02":2, "03":3, "04":4};
const seasonTypeOfId = id => {
  const s=String(id);
  return /^\d{10}$/.test(s) ? (NBA_STYPE[s.substr(1,2)] || 9) : null;
};
const STYPE_LABEL = {1:"Preseason", 3:"All-Star", 4:"Post-season", 5:"Play-In",
                     9:"Non-regular"};

/* The season on screen, taken from whichever feed answered rather than written down. The
   fallback matters in the gap between seasons, when the schedule may be empty. */
/* How far back the picker offers. ESPN serves its scoreboard by date range, so any year is
   requestable; what varies is whether the play-by-play behind those games still exists.
   Rather than promise a floor I cannot verify from here, the picker offers back to
   SEASON_FLOOR and the page reports what it actually finds — a season whose games have no
   play-by-play says so instead of showing empty tables (see reportNoPbp below).

   This was 2019 in the WNBA build this was ported from, chosen for that league's own
   history. NBA play-by-play on ESPN goes back further; 2002 is a reasonable starting
   guess, worth walking back further once someone's actually testing it against real
   requests. */
const SEASON_FLOOR = 2002;
/* The current SEASON, not the calendar year. An NBA season runs October to June and is
   named for the year it ends — ESPN files 2026-27 as 2027 — so from October on, the current
   season is next year's number. (The WNBA build this was ported from used the calendar year,
   which is right for a league that plays April to October and wrong for this one.) */
const thisYear = () => { const d=new Date();
  return d.getMonth()>=9 ? d.getFullYear()+1 : d.getFullYear(); };
/** 2026 -> "2025-26", the way an NBA season is written. */
const seasonName = y => { const n=parseInt(y,10);
  return Number.isFinite(n)? `${n-1}-${String(n).slice(-2)}` : String(y||""); };
/* null means "whatever is current", which is the only value that can use the exact league
   feed: its schedule file is the current season and its game ids are its own. */
let WANT_SEASON = null;
/* Links in (0.60): the Watch List opens a game with ?game=<ESPN id> and the three-point matchups with ?view=range. */
const URLP = (()=>{ try{ return new URLSearchParams(location.search); }catch(e){ return new URLSearchParams(); } })();
let WANT_GAME = URLP.get("game");
/** The season as ESPN numbers it ("2026"), for comparisons. */
export const seasonYear = () => String((SCHED && SCHED.season) || thisYear());
/** The season as a reader writes it ("2025-26"), for anything on screen. */
export const seasonLabel = () => seasonName(seasonYear());

const isPreseason = g => g.stype===1 || /preseason/i.test(g.label || "");

/* Season type alone isn't enough. ESPN files the Commissioner's Cup Championship
   as a regular-season game, but it doesn't count toward regular-season stats —
   which is exactly the four assists that made Gray→Young read 51 instead of 47.
   Cup *group-stage* games do count and must be kept, so this matches the final
   only. Anything matched here is excluded from season aggregations. */
const NON_COUNTING = /championship|all[-\s]?star|exhibition|preseason|friendly/i;
export const isRegularSeason = g =>
  g.stype===2 && !NON_COUNTING.test(g.label || "");
// exposed so the test suite can check scope and ranking rules directly
window.__season = {SEASON_FLOOR, thisYear, fillSeasonPicker, clearCaches,
                   want:()=>WANT_SEASON, noPbp:()=>NO_PBP, PBP_SAMPLE};
window.__scope = {isPreseason, isRegularSeason, seasonTypeOfId, STYPE_LABEL, NON_COUNTING,
                  isFranchise, scanFranchises, seasonLabel, knownTeam, teamName,
                  generatedCol, rosterStale, ALL_STARS_SEASON,
                  franchises, newcomers:()=>[...NEWCOMERS]};

function fillTeamFilter(){
  const tris=[...new Set(GAMES.filter(g=>!isPreseason(g))
    .flatMap(g=>[g.away,g.home]))].filter(isFranchise).sort();
  const sel=$("#team"); sel.innerHTML="";
  sel.appendChild(new Option("All teams",""));
  tris.forEach(t=>sel.appendChild(new Option(t + " — " + teamName(t), t)));
}

export function label(g){
  const d=new Date(g.date);
  const ds=d.toLocaleDateString(undefined,{month:"short",day:"2-digit"});
  const sc = g.status===3 ? `  ${g.as}-${g.hs}` : g.status===2 ? "  LIVE" : "";
  return `${ds}  ${g.away} @ ${g.home}${sc}${g.label?"  ·  "+g.label:""}`;
}

/* Which knobs a section has at all. Explicit rather than derived: "does this view have a
   window?" is a question about the section, and a table you can read beside the tab strip is
   worth more than a chain of booleans. Enablement is still decided below — a control listed
   here but not usable right now is hidden too, so nothing dimmed and dead is ever on screen.
   The audit checks this table against the view list, so a new section cannot forget it. */
const VIEW_CONTROLS = {
  game:     ["season","team","game","prev","next","runmode","shade","reload"],
  season:   ["season","team","span","norm","reload"],
  assists:  ["season","team","span","metric","shot","reload"],
  board:    ["season","team","span","rank","layout","metric","shot","reload"],
  highs:    ["season","team","span","layout","reload"],
  range:    ["season","team","span","layout","reload"],
  streaks:  ["season","span","layout","reload"],
  splits:   ["season","team","span","who1","who2","layout","reload"],
};
const ALL_CONTROLS = ["season","team","span","norm","metric","rank","layout","pool","shot",
                      "form","stat","floor","mins","cupscope",
                      "game","prev","next","who1","who2","runmode","shade","reload"];

/* A section per tab, built from the select's own options so the two lists cannot drift.
   The separators mark where one kind of question ends and the next begins: one game, then
   one team, then the league. */
const TAB_SEPARATE_BEFORE = new Set(["season","streaks"]);  // thirty, allstars and records moved to "vs top teams" (0.54)
function buildTabs(){
  const strip=$("#tabs"), sel=$("#view");
  if(!strip || !sel || strip.children.length) return;
  [...sel.options].forEach(o=>{
    if(TAB_SEPARATE_BEFORE.has(o.value)) strip.appendChild(el("span","tsep"));
    const b=document.createElement("button");
    b.type="button"; b.dataset.view=o.value; b.textContent=o.textContent;
    b.setAttribute("role","tab");
    b.addEventListener("click",()=>{
      if(sel.value===o.value) return;
      sel.value=o.value;
      sel.dispatchEvent(new Event("change"));
    });
    /* Left and right walk the strip, which is what a tablist is expected to do and costs
       four lines. */
    b.addEventListener("keydown",ev=>{
      const step = ev.key==="ArrowRight" ? 1 : ev.key==="ArrowLeft" ? -1 : 0;
      if(!step) return;
      ev.preventDefault();
      const tabs=[...strip.querySelectorAll("button")];
      const i=tabs.indexOf(b);
      const next=tabs[(i+step+tabs.length)%tabs.length];
      next.focus(); next.click();
    });
    strip.appendChild(b);
  });
}

function markTab(){
  const v=viewMode();
  $("#tabs").querySelectorAll("button").forEach(b=>{
    const on=b.dataset.view===v;
    b.setAttribute("aria-selected", on? "true":"false");
    b.tabIndex = on? 0 : -1;
  });
}

/* Only what this section uses. A control that is present but greyed out takes the same room
   as a live one and reads as broken — with twelve sections and seventeen controls, eight of
   them were dead on any given screen. */
/* Two exceptions, and they are the same exception: the game arrows are navigation, not a
   filter. Their disabled state is positional — you are at one end of the list — so hiding
   them would make the pair jump about as you walk the season. Dimmed in place is right here;
   CSS already fades a disabled button. */
const SHOW_WHEN_DISABLED = new Set(["prev","next"]);
function applyControlVisibility(){
  const keep=new Set(VIEW_CONTROLS[viewMode()]||ALL_CONTROLS);
  for(const id of ALL_CONTROLS){
    const c=$("#"+id); if(!c) continue;
    // the checkbox lives inside its label, so the label is what has to go
    const box=(c.type==="checkbox" && c.closest("label")) || c;
    box.hidden = !(keep.has(id) && (SHOW_WHEN_DISABLED.has(id) || !c.disabled));
  }
}

// exposed after the definitions above, not before: a const cannot be read early
window.__form = {formRows, formStreaks, avgOf, sdOf, medOf, statOf, slashLine,
                 catMoves, staleness, setFloorOptions,
                 FORM_HIGH_GOOD, FORM_THRESHOLDS, FORM_FLOORS, FORM_MIN_MINUTES,
                 FORM_CATS, LOG_CARDS_N,
                 FORM_LENS, FORM_MIN_BASE, FORM_MIN_RUN, FORM_STATS, RUN_LIST_N};
window.__ui = {VIEW_CONTROLS, ALL_CONTROLS, TAB_SEPARATE_BEFORE, SHOW_WHEN_DISABLED,
               RANK_POSTER_N, LAYOUTS};

/* Every section ends by calling this, which is also the hook for anything that has to be
   true of all of them. Right now that is one thing: a column header takes the alignment of
   the column it labels. Left-aligned names under a right-aligned PLAYER is the sort of
   misalignment you see immediately and then cannot unsee, and it was in every table with a
   text column that was not the first. */
function alignHeaders(tbl){
  const rows=tbl.rows;
  if(rows.length<2) return;
  const head=rows[0].cells, body=rows[1].cells;
  for(let i=0;i<head.length && i<body.length;i++){
    const a=body[i].style.textAlign;
    if(a) head[i].style.textAlign=a;
  }
}
export function finishRender(root){
  (root || $("#out")).querySelectorAll("table.per").forEach(alignHeaders);
  $("#footnote").hidden=false;
}

function syncControls(){
  const v=viewMode();
  const season=v==="season", assists=v==="assists", board=v==="board", highs=v==="highs",
        range3=v==="range", thirty=v==="thirty", allstars=v==="allstars",
        records=v==="records", streaks=v==="streaks", splits=v==="splits",
        rest=v==="rest";
  const notGame = v!=="game";
  const astish = assists||board;
  $("#game").disabled=notGame; $("#prev").disabled=notGame; $("#next").disabled=notGame;
  $("#shade").disabled=notGame;
  $("#runmode").disabled=notGame;
  $("#norm").disabled=!season;
  $("#metric").disabled=!astish;
  $("#shot").disabled=!astish;
  setRankOptions(v);
  const form=v==="form", cup=v==="cup";
  $("#rank").disabled=!(board||records||allstars||form||cup);
  /* One control, two option sets. The board ranks pairs as a table or a poster; the
     range view has three presentations. Rebuilding rather than disabling keeps a stale
     value from a different view out of the way. */
  setLayoutOptions(v);
  /* Live wherever the section declares layouts. The board is the exception: only the
     pair ranking has a poster, because the other two rank single players. */
  const posterable = !!LAYOUTS[v] && (!board || rankMode()==="pair");
  $("#layout").disabled=!posterable;
  // records reads only the schedule, so a game window has nothing to act on
  $("#span").disabled=!notGame || records;
  // the roster is only a filter, and only the splits section has one to widen
  $("#pool").disabled=!allstars;
  $("#form").disabled=!form;
  // stat, floor and minutes bar are shared with the Cup section, which asks the same kind
  // of question of a different set of games
  $("#stat").disabled=$("#floor").disabled=$("#mins").disabled=!(form||cup);
  $("#cupscope").disabled=!cup;
  $("#mins").title = cup ? "Only count games of at least these minutes, Cup and normal alike"
                         : "Every game of the stretch must clear these minutes";
  // the floor is in the units of whichever stat is selected, so it is rebuilt with it
  if(form||cup) setFloorOptions();
  $("#who1").disabled=$("#who2").disabled=!splits;
  markTab();
  applyControlVisibility();
  $("#team").title = (thirty||allstars||records||streaks||splits||rest||cup)
                     ? "These sections are league-wide"
                   : (board||highs||range3) ? "One team, or all teams for the league"
                   : notGame ? "Choose a team" : "Filter by team";
}

function refreshView(){
  syncControls();
  const v=viewMode();
  // "All teams" is meaningful for these two, so no team is forced
  if(v==="board"){ showBoard(); return; }
  if(v==="highs"){ showHighs(); return; }
  if(v==="range"){ showRange(); return; }
  // 30-point games allowed, All-Stars, records vs top teams, rest, hot hand and the Cup live on the Command
  // Center's own pages since the merge (0.53-0.58); Game Flow keeps the two league views only it can draw.
  if(v==="streaks" || v==="splits"){ showLeague(v); return; }
  if(v==="season" || v==="assists"){
    let t=$("#team").value;
    if(!t){ // these views are per-team, so land on one rather than showing nothing
      const first=$("#team").options[1];
      if(!first) return;
      $("#team").value=first.value; t=first.value;
    }
    if(v==="assists") showAssists(t); else showSeason(t);
  }else{
    fillGameList();
  }
}

/* Populating the list and opening a game are separate on purpose. A season change has to
   refill the list whatever view is open — otherwise the picker sits on 2024 while the game
   dropdown still offers 2026 fixtures — but it must not load a game behind a league view's
   back. */
function fillGameOptions(){
  const t=$("#team").value;
  filtered = GAMES.filter(g=>g.status>=2 && !isPreseason(g) && g.pbp!==false
    && isFranchise(g.away) && isFranchise(g.home)
    && (!t || g.away===t || g.home===t));
  const sel=$("#game"); sel.innerHTML="";
  filtered.forEach((g,i)=>sel.appendChild(new Option(label(g), String(i))));
  if(filtered.length) sel.value=String(filtered.length-1);
  return filtered.length;
}
function fillGameList(){
  if(!fillGameOptions()){ setStatus("No played games match that filter yet.",false); return; }
  if(WANT_GAME){
    const k=filtered.findIndex(g=>String(g.gameId)===String(WANT_GAME));
    WANT_GAME=null;
    if(k>=0){ load(k); return; }
  }
  load(filtered.length-1);
}

async function load(i){
  curIdx=i;
  const g=filtered[i]; if(!g) return;
  $("#game").value=String(i);
  $("#prev").disabled = i<=0; $("#next").disabled = i>=filtered.length-1;
  setStatus(`<span class="spin"></span>Loading ${g.away} @ ${g.home}…`);
  try{
    let pbp, box;
    if(ACTIVE==="espn"){
      MIN_TOL=0.6; MIN_SLACK=0.5;
      const c = g.status===3 ? await compactFor(g) : null;
      const sum = c ? null : await getJSON(`${ESPN_SUMMARY}?event=${g.gameId}`);
      if(c) ({pbp,box} = expandFeeds(c));
      else if(!sum.plays || !sum.plays.length){
        /* Counted, not just reported: one game missing its log is a gap, a whole season
           missing it is a different message, and only the tally can tell them apart. */
        pbpOutcome(true);
        throw new Error(seasonYear()!==String(thisYear())
          ? `ESPN has no play-by-play for this ${seasonLabel()} game.`
          : "ESPN hasn't published play-by-play for this game yet.");
      }
      else ({pbp,box} = espnToFeeds(sum));
    }else{
      MIN_TOL=0.05; MIN_SLACK=0.5;
      [pbp,box] = await Promise.all([
        feed(`liveData/playbyplay/playbyplay_${g.gameId}.json`),
        feed(`liveData/boxscore/boxscore_${g.gameId}.json`),
      ]);
    }
    if(!pbp.game || !pbp.game.actions || !pbp.game.actions.length){
      pbpOutcome(true);
      throw new Error("No play-by-play published for this game yet.");
    }
    pbpOutcome(false);
    window.__G = buildStints(pbp, box);
    render(window.__G, g);
    hideStatus();
  }catch(e){
    $("#out").innerHTML="";
    setStatus(`<b>Couldn't load that game.</b><br>${String(e.message||e)}`
      + (NO_PBP? `<br><br>Every ${seasonLabel()} game asked for so far has come back the `+
                 `same way, so this looks like a season ESPN never logged rather than one `+
                 `missing game. The <b>Records vs top teams</b> view reads the schedule's `+
                 `final scores and still works.` : HOWTO), true);
  }
}

const HOWTO =
  `<br><br>This page reads ESPN directly (and this season's finished games from the Command Center's own copy), `+
  `so this usually means no internet connection, or something on the network is blocking `+
  `<code>site.api.espn.com</code>.`;

/* One season's schedule from ESPN, read a month at a time.
   ESPN's NBA scoreboard refuses every YYYYMMDD-YYYYMMDD range with a 400 — even a three-day
   one — which is what broke this page. Two other forms still answer: a single month
   (dates=YYYYMM) returns the whole month, and a calendar year (dates=YYYY) is capped at 1000
   events and silently drops to 25 if asked for more. A season is ~1,400 games across two
   calendar years, so the year form cannot hold it; months can (the busiest is ~240).
   Checked live on 31 Oct 2026.
   An NBA season runs October to June and ESPN labels it by the year it ends, so "2026" is
   2025-26: October of yr-1 through July of yr. Months on either edge carry games from the
   neighbouring season, so every event is kept only if ESPN files it under yr. */
const SEASON_MONTHS = [[-1,10],[-1,11],[-1,12],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7]];
async function espnSeason(yr){
  const pages=await Promise.all(SEASON_MONTHS.map(async ([dy,m])=>{
    const ym=`${yr+dy}${String(m).padStart(2,"0")}`;
    try{ return (await getJSON(`${ESPN_SCOREBOARD}?dates=${ym}&limit=1000`)).events||[]; }
    catch(e){ return {err:e}; }
  }));
  const bad=pages.find(p=>p && p.err);
  // a future month comes back empty, not as an error, so any error is a real failure
  if(bad) throw bad.err;
  const seen=new Set(), events=[];
  for(const e of pages.flat()){
    if(!e || seen.has(e.id) || !(e.season && +e.season.year===+yr)) continue;
    seen.add(e.id); events.push(e);
  }
  const f=flattenEspnSchedule({events});
  if(!f.games.length) throw new Error(`ESPN returned no games for the ${seasonName(yr)} season.`);
  return f;
}

/* Every aggregate is keyed by team and window, not by season, so switching seasons has to
   drop all of them — otherwise last season's board would answer for this one. */
function clearCaches(){
  modelCache.clear();
  seasonAgg=assistAgg=boardAgg=highsAgg=rangeAgg=leagueAgg=null;
  LITE=null;
  cupExtra=null;
  PBP_TRIED=PBP_MISSING=0; NO_PBP=false;
  const np=$("#nopbp"); if(np){ np.hidden=true; np.innerHTML=""; }
}

function fillSeasonPicker(loaded){
  const sel=$("#season"); if(!sel) return;
  const now=thisYear();
  sel.innerHTML="";
  for(let y=now; y>=SEASON_FLOOR; y--)
    sel.appendChild(new Option(y===now? `${seasonName(y)} (current)` : seasonName(y), String(y)));
  /* Show what was actually loaded rather than what was asked for: if the current-season
     request came back as last season's schedule — which it does in the off-season, before a
     new one is published — the picker should say so instead of insisting on the calendar. */
  const want=String(loaded||now);
  if(![...sel.options].some(o=>o.value===want))
    sel.insertBefore(new Option(seasonName(want), want), sel.firstChild);
  sel.value=want;
}

async function boot(){
  let f=null, lastErr=null, fellBack=null;
  /* A past season can only come from ESPN. The league feed publishes one schedule file — the
     current season — and its game ids are its own, so a mixed pairing would ask it for games
     it has never heard of. */
  const past = WANT_SEASON!=null && WANT_SEASON!==thisYear();
  /* Filled in before anything is fetched, so a failed load still leaves a usable control.
     Without this, a January visit — when the new season has no games yet — ended on an error
     with an empty dropdown and no way to ask for the season that just finished. */
  buildTabs();
  fillSeasonPicker(WANT_SEASON || thisYear());

  // ESPN only in the Command Center (the user's rule: no NBA.com data); games on file come from the nightly build
  await loadFlowIndex();

  // otherwise fall back to ESPN, which any browser can read directly
  if(!f){
    try{
      f=await espnSeason(past? WANT_SEASON : thisYear());
      ACTIVE="espn";
    }catch(e){ lastErr=e; }
  }

  /* Between seasons the current year has no games. Nobody opening this in February wants an
     error — they want the season that just finished — so one step back is tried, and the page
     says which season it landed on and why. Only when no season was asked for: an explicit
     pick that comes back empty is answered, not quietly redirected. */
  if(!f && !past){
    try{
      f=await espnSeason(thisYear()-1);
      ACTIVE="espn";
      fellBack=thisYear()-1;
    }catch(e){ /* keep the first error: it describes the season actually asked for */ }
  }

  if(!f){
    setStatus((past
        ? `<b>Couldn't load the ${WANT_SEASON} season.</b><br>`
        : `<b>Couldn't load the schedule from either source.</b><br>`)+
      `${String(lastErr&&lastErr.message)}`
      + `<br><br>The <b>season</b> dropdown is still live, so another season can be tried `
      + `from here.` + HOWTO, true);
    return;
  }
  SCHED=f; GAMES=f.games;
  /* Every label on the page reads the season off the schedule that was just loaded, so
     nothing says 2026 over next season's data. */
  document.title=`NBA Command Center · ${seasonLabel()} Game Flow`;
  $("h1").firstChild.textContent=`NBA Command Center · ${seasonLabel()} Game Flow `;
  /* Before anything is filtered: the franchise list has to know about a new team first. */
  scanFranchises();
  /* Included in every stat, and said out loud. A generated colour and a bare tricode are a
     worse chart than a proper one, but they are a far better chart than a league quietly
     missing a team. */
  const nt=$("#newteams");
  nt.hidden=NEWCOMERS.size===0;
  nt.innerHTML=NEWCOMERS.size
    ? `<b>New to the league:</b> ${[...NEWCOMERS].sort().join(", ")}. `
      + `${NEWCOMERS.size===1?"This team is":"These teams are"} in the ${seasonLabel()} `
      + `schedule but not in this page's team table, so ${NEWCOMERS.size===1?"it appears":"they appear"} `
      + `with a generated colour and a bare tricode instead of a name. Every stat includes `
      + `${NEWCOMERS.size===1?"it":"them"} — add ${NEWCOMERS.size===1?"it":"them"} to TEAM `
      + `near the top of the page for the proper colours.<br><br>`
    : "";
  const sn=$("#seasonnote");
  sn.hidden=!fellBack;
  sn.innerHTML=fellBack
    ? `<b>The ${seasonName(thisYear())} season has no games yet</b>, so this is `
      + `${seasonName(fellBack)} — the last `
      + `one played. Pick a season from the dropdown to look at another.<br><br>`
    : "";
  fillSeasonPicker(f.season);
  fillTeamFilter();
  fillSpan();
  fillFormLens();
  setFloorOptions();
  fillGameOptions();          // so no view can show the previous season's fixtures
  refreshView();
}

/* A season change is a different dataset, not a different view of one: everything cached is
   dropped and the schedule is read again. */
$("#season").addEventListener("change",()=>{
  const y=parseInt($("#season").value,10);
  WANT_SEASON = (y===thisYear()) ? null : y;
  clearCaches();
  $("#out").innerHTML="";
  curIdx=-1; filtered=[];
  setStatus(`<span class="spin"></span>Loading the ${y} season…`);
  boot();
});
$("#view").addEventListener("change",refreshView);
// switching the denominator only re-draws: both are already banked
$("#norm").addEventListener("change",()=>{ if(seasonAgg) renderSeason(seasonAgg); });
// changing the window re-aggregates, but every game is already in memory
$("#span").addEventListener("change",()=>{ if(viewMode()!=="game") refreshView(); });
// the matrix holds both metrics, so switching only redraws
// metric and shot type are both stored per pair, so switching only redraws
const redrawAst = () => {
  if(viewMode()==="board"){ if(boardAgg) renderBoard(boardAgg); }
  else if(assistAgg) renderAssists(assistAgg);
};
$("#metric").addEventListener("change",redrawAst);
$("#shot").addEventListener("change",redrawAst);
$("#rank").addEventListener("change",()=>{
  syncControls();
  redrawAst();
});
/* A layout change never needs new data — the aggregate is already in memory, so this
   only redraws, in whichever view owns the control. */
$("#layout").addEventListener("change",()=>{
  const v=viewMode();
  if(v==="range"){ if(rangeAgg) renderRange(rangeAgg); return; }
  if(v==="highs"){ if(highsAgg) renderHighs(highsAgg); return; }
  if(v==="splits"){ if(leagueAgg) renderSplits(leagueAgg); return; }
  if(v==="streaks"){ if(leagueAgg) renderStreaks(leagueAgg); return; }
  redrawAst();
});
/* Widening the roster to the league is a filter change, not new data: everything the pool
   needs was already read for the aggregate. */
$("#pool").addEventListener("change",()=>{
  if(viewMode()==="splits" && leagueAgg) renderSplits(leagueAgg);
});
/* Stretch length and stat only re-split what is already in memory. */
[$("#form"),$("#stat"),$("#floor"),$("#mins"),$("#cupscope")].forEach(sel=>
  sel.addEventListener("change",()=>{
    const v=viewMode();
    if(v!=="form" && v!=="cup") return;     // no view uses these since the merge; kept inert
  }));
$("#team").addEventListener("change",refreshView);
$("#game").addEventListener("change",e=>load(+e.target.value));
$("#prev").addEventListener("click",()=>load(curIdx-1));
$("#next").addEventListener("click",()=>load(curIdx+1));
$("#reload").addEventListener("click",()=>{
  if(viewMode()!=="game"){ clearCaches(); refreshView(); }
  else load(curIdx);
});
/* A run-definition change only redraws: all three are computed when the game is built,
   so switching is instant and re-reads nothing. */
$("#runmode").addEventListener("change",()=>{ if(curIdx>=0) load(curIdx); });
/* Changing either player only redraws: every line is already in the league aggregate. */
[$("#who1"),$("#who2")].forEach(sel=>sel.addEventListener("change",()=>{
  if(viewMode()==="splits" && leagueAgg) renderSplits(leagueAgg);
}));
$("#shade").addEventListener("change",()=>{ if(window.__G) render(window.__G, filtered[curIdx]); });
addEventListener("keydown",e=>{
  if(e.target.tagName==="SELECT"||e.target.tagName==="INPUT") return;
  if(viewMode()!=="game") return;
  if(e.key==="ArrowLeft"&&curIdx>0) load(curIdx-1);
  if(e.key==="ArrowRight"&&curIdx<filtered.length-1) load(curIdx+1);
});

{ const v=URLP.get("view"); if(v && [...$("#view").options].some(o=>o.value===v)) $("#view").value=v; }
boot();
