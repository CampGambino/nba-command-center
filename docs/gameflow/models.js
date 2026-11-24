/* Moved out of docs/gameflow.js unchanged (0.153.0, the Game Flow split's part 2): reading games: the model cache, the nightly flow files, the play-by-play check, a team's games. */
import { S } from "./state.js";
import { espnToFeeds, expandFeeds } from "../lib/gameflow/feeds.js";
import { $, ACTIVE, ESPN_SUMMARY, GAMES, buildStints, feed, getJSON, isFranchise, isRegularSeason, seasonLabel, seasonYear, setStatus } from "../gameflow.js";

export const modelCache = new Map();           // gameId -> built model, so switching teams is cheap

/* Every read of a game goes through modelFor, so this is the one place that can tell the
   difference between "this game has no play-by-play" and "this season has none". A season
   ESPN never logged fails every game, and the honest thing is to say so rather than draw
   empty tables next to a game count of zero. */
/* PBP_TRIED, PBP_MISSING, NO_PBP now live in S (docs/gameflow/state.js, 0.153.0) */
export const PBP_SAMPLE=6;      // enough that one unlucky game can't condemn a season

export function pbpOutcome(missing){
  S.PBP_TRIED++;
  if(missing) S.PBP_MISSING++;
  S.NO_PBP = S.PBP_TRIED>=PBP_SAMPLE && S.PBP_MISSING===S.PBP_TRIED;
  const el2=$("#nopbp"); if(!el2) return;
  el2.hidden=!S.NO_PBP;
  el2.innerHTML = S.NO_PBP
    ? `<b>No play-by-play for the ${seasonLabel()} season.</b> ${S.PBP_MISSING} of `
      + `${S.PBP_TRIED} games were asked for and none came back with a substitution log, so `
      + `everything built from one — stints, lineups, runs, shot charts — is empty for this `
      + `season. <b>Records against top teams</b> reads the schedule's final scores instead, `
      + `so that section still works. Whether a past season's play-by-play exists is the `
      + `source's call, not this page's.<br><br>`
    : "";
}

/* A build in which every read failed is not an empty season — it is a season whose
   play-by-play the source does not have. Drawing a chart of nothing, next to a game count of
   zero, would leave the reader to guess which it was. */
export function reportNoPbp(){
  $("#out").innerHTML="";
  setStatus(`<b>No play-by-play for the ${seasonLabel()} season.</b><br>`+
    `Every game asked for came back without a substitution log, so this view has nothing to `+
    `draw. <b>Records vs top teams</b> reads the schedule's final scores instead, and works `+
    `for any season. Whether a past season's play-by-play still exists is the source's call, `+
    `not this page's.`, true);
}

export const allReadsFailed = (total, failed) => total>0 && failed>=total;

/* Games the nightly build has already read (docs/data/flow): the same ESPN data, kept compact, so a season or
   league view reads ~15 KB a game from this site instead of ~450 KB each from ESPN. Anything not on file — an
   older season, tonight's game, a game the build hasn't reached — comes from ESPN as before. */
export let FLOW = null;

export async function loadFlowIndex(){
  try{ const r=await fetch("data/flow/index.json",{cache:"no-store"}); if(!r.ok) return;
       const j=await r.json(); FLOW={season:String(j.season), ids:new Set((j.ids||[]).map(String))}; }
  catch(e){ FLOW=null; }
}

export async function compactFor(g){
  if(!FLOW || seasonYear()!==FLOW.season || !FLOW.ids.has(String(g.gameId))) return null;
  try{ const r=await fetch(`data/flow/${FLOW.season}/${g.gameId}.json`); return r.ok? await r.json() : null; }
  catch(e){ return null; }
}

/* Scoring highs and the Assist leaderboard read one season file of per-game slices (data/flow/<season>-lite.json,
   built nightly from the same model, 0.60) instead of every game's file. A game not in it is read in full. */
/* LITE now live in S (docs/gameflow/state.js, 0.153.0) */
function liteFile(){
  if(!FLOW || seasonYear()!==FLOW.season) return Promise.resolve(null);
  if(!S.LITE) S.LITE=fetch(`data/flow/${FLOW.season}-lite.json`,{cache:"no-store"}).then(r=>r.ok? r.json() : null).then(j=>j && j.games || null).catch(()=>null);
  return S.LITE;
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
