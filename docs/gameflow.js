// Game Flow page script (moved out of gameflow.html unchanged, 0.141.10). Loaded as a module, as it was inline.
"use strict";
import { espnToFeeds, expandFeeds } from "./lib/gameflow/feeds.js";
import { REG_LEN, OT_LEN, RUN_MIN, RUN_ALLOW, SWING_CAP, plen, clockSec, minVal, mmss,
  HOOP_X, HOOP_Y, COURT_W, COURT_L, HOOP_INSET, SPOT_SX, SPOT_SY, ARC_R, CORNER_D, CORNER_Y,
  onCourt, hasSpot, spotDist, canonSpot, statedDist, shotDist, boxLine, buildStints as buildStintsModel } from "./lib/gameflow/model.js";
import { headshot } from "./gameflow/headshots.js";
import { S } from "./gameflow/state.js";
import { REST_BUCKETS, dayNum, gameDay, restBucket, restIndex } from "./gameflow/rest.js";
import { renderRangeCourt } from "./gameflow/poster-court.js";
import { renderRangeScatter } from "./gameflow/poster-scatter.js";
import { DEF_TOP_N, buildLeague } from "./gameflow/league.js";
import { RANK_POSTER_N, rankPoster } from "./gameflow/rank-poster.js";
import { restRows, restStats } from "./gameflow/sec-rest.js";
import { renderStreaks } from "./gameflow/sec-lead.js";
import { ALL_STARS, ALL_STARS_SEASON, allStarRows, defDefinition, leaguePool, normName, renderPool, rosterStale, splitRow } from "./gameflow/sec-topdef.js";
import { FORM_MIN_RUN, LOG_CARDS_N, RUN_LIST_N, avgOf, catMoves, fillFormLens, formRows, formStreaks, medOf, sdOf, setFloorOptions, slashLine, staleness, statOf } from "./gameflow/sec-hothand.js";
import { ivAnd, ivHas, ivSec, ivSub, onOffSplit, renderSplits, splitByTeammate } from "./gameflow/sec-pairs.js";
import { buildBoard } from "./gameflow/board.js";
import { RANGE_MIN_3PA, RANGE_N, buildRange, courtSvg, fitText, pctile, posterFoot, posterShell, posterTools, rangeScope, svgEl, svgText } from "./gameflow/range.js";
// Sections moved into their own files (0.153.0, part 2).
import { FORM_CATS, FORM_FLOORS, FORM_HIGH_GOOD, FORM_LENS, FORM_MIN_BASE, FORM_MIN_MINUTES, FORM_STATS, FORM_THRESHOLDS, LAYOUTS, POOL_MIN_PPG, POOL_MIN_SIDE, POOL_N, POOL_SHARE, RUN_LABEL, rankMode, runMode, setLayoutOptions, setRankOptions } from "./gameflow/controls.js";
import { denseRanks, renderBoard, showBoard, topWithTies } from "./gameflow/sec-outliers.js";
import { PBP_SAMPLE, compactFor, franchises, loadFlowIndex, modelCache, pbpOutcome } from "./gameflow/models.js";
import { renderHighs, showHighs } from "./gameflow/sec-highs.js";
import { renderRange, showRange } from "./gameflow/sec-profile.js";
import { showLeague } from "./gameflow/sec-cup.js";
import { renderAssists, showAssists } from "./gameflow/sec-assists.js";
import { fillSpan, renderSeason, showSeason } from "./gameflow/sec-rotation.js";
// Sections moved into their own files (0.141.16).
export const buildStints = (pbp, box) => buildStintsModel(pbp, box, { minTol: MIN_TOL });
/* ============================ config ============================ */
const CDN = "https://cdn.nba.com/static/json";
const SCHEDULE_PATHS = ["staticData/scheduleLeagueV2_1.json",
                        "staticData/scheduleLeagueV2.json"];

export const TEAM = {
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
const LIGHT_UI = true;   // 0.147.0: the site is light only (the user, 11/24: "I prefer light mode")
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
export const POSTER_HS=56, POSTER_SIDE_GAP=12;

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
export const ESPN_SUMMARY = "https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/summary";

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
export const clamp=(v,a,b)=>v<a?a:v>b?b:v;
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

export async function getJSON(url){
  const r = await fetch(url, {cache:"no-store"});
  if(!r.ok) throw new Error("HTTP " + r.status + " for " + url);
  return r.json();
}

/* The NBA feeds send no CORS headers, so a page opened straight off disk can't
   read them. nba_gameflow.py serves this file and mirrors the feeds under /api/,
   which is same-origin. We try that first, then the CDN directly (in case this is
   hosted somewhere that can reach it). */
let BASE = null;
export async function feed(path){
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

/* One box line, read from whichever feed supplied it. Both now use the league feed's key
   names, so this needs no source flag. */
/* ============================ rendering ============================ */
const tip=$("#tip");
export let showTip=(html,ev)=>{
  tip.innerHTML=html; tip.style.opacity=1;
  const r=tip.getBoundingClientRect();
  tip.style.left = clamp(ev.clientX+14, 8, innerWidth-r.width-8)+"px";
  tip.style.top  = clamp(ev.clientY+14, 8, innerHeight-r.height-8)+"px";
};
export const hideTip=()=>{tip.style.opacity=0};
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

window.__rank = {denseRanks, topWithTies};
window.__poster = {fitText, pctile};
window.__as = {ALL_STARS, normName, allStarRows, leaguePool, splitRow, renderPool,
               defDefinition,
               POOL_SHARE, POOL_MIN_SIDE, POOL_MIN_PPG, POOL_N};
window.__split = {splitByTeammate, onOffSplit, ivAnd, ivSub, ivSec, ivHas};
window.__col = {TEAM, brandCol, brandAlt, tcol, tcolAlt, liftForDark, sideColours,
                contrastOf, hexRgb, rgbGap, tint, barAlpha,
                DARK_BG, MIN_DARK_CONTRAST, MIN_SIDE_GAP};


/* ============================ app shell ============================ */
export let SCHED=null, GAMES=[], filtered=[], curIdx=-1;
/* seasonAgg, assistAgg, boardAgg, highsAgg, rangeAgg, leagueAgg now live in S (docs/gameflow/state.js, 0.153.0) */
const viewMode = () => $("#view").value;

export function setStatus(html, err){
  const s=$("#status"); s.hidden=false; s.className="status"+(err?" err":""); s.innerHTML=html;
}
export const hideStatus = ()=>{ $("#status").hidden=true; };

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
export const NON_COUNTING = /championship|all[-\s]?star|exhibition|preseason|friendly/i;
export const isRegularSeason = g =>
  g.stype===2 && !NON_COUNTING.test(g.label || "");
// exposed so the test suite can check scope and ranking rules directly
window.__season = {SEASON_FLOOR, thisYear, fillSeasonPicker, clearCaches,
                   want:()=>WANT_SEASON, noPbp:()=>S.NO_PBP, PBP_SAMPLE};
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
  streaks:  ["season","span","reload"],
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
      + (S.NO_PBP? `<br><br>Every ${seasonLabel()} game asked for so far has come back the `+
                 `same way, so this looks like a season ESPN never logged rather than one `+
                 `missing game. The <b>Records vs top teams</b> view reads the schedule's `+
                 `final scores and still works.` : HOWTO), true);
  }
}

export const HOWTO =
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
  S.seasonAgg=S.assistAgg=S.boardAgg=S.highsAgg=S.rangeAgg=S.leagueAgg=null;
  S.LITE=null;
  S.PBP_TRIED=S.PBP_MISSING=0; S.NO_PBP=false;
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
$("#norm").addEventListener("change",()=>{ if(S.seasonAgg) renderSeason(S.seasonAgg); });
// changing the window re-aggregates, but every game is already in memory
$("#span").addEventListener("change",()=>{ if(viewMode()!=="game") refreshView(); });
// the matrix holds both metrics, so switching only redraws
// metric and shot type are both stored per pair, so switching only redraws
const redrawAst = () => {
  if(viewMode()==="board"){ if(S.boardAgg) renderBoard(S.boardAgg); }
  else if(S.assistAgg) renderAssists(S.assistAgg);
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
  if(v==="range"){ if(S.rangeAgg) renderRange(S.rangeAgg); return; }
  if(v==="highs"){ if(S.highsAgg) renderHighs(S.highsAgg); return; }
  if(v==="splits"){ if(S.leagueAgg) renderSplits(S.leagueAgg); return; }
  if(v==="streaks"){ if(S.leagueAgg) renderStreaks(S.leagueAgg); return; }
  redrawAst();
});
/* Widening the roster to the league is a filter change, not new data: everything the pool
   needs was already read for the aggregate. */
$("#pool").addEventListener("change",()=>{
  if(viewMode()==="splits" && S.leagueAgg) renderSplits(S.leagueAgg);
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
  if(viewMode()==="splits" && S.leagueAgg) renderSplits(S.leagueAgg);
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
