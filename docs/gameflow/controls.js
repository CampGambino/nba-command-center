/* Moved out of docs/gameflow.js unchanged (0.153.0, the Game Flow split's part 2): the shared view controls: metric, shot, rank and run pickers, layouts, the hot-hand and pool settings. */
import { RUN_ALLOW, RUN_MIN, SWING_CAP } from "../lib/gameflow/model.js";
import { DEF_TOP_N } from "./league.js";
import { $ } from "../gameflow.js";
import { CUP_THRESHOLDS } from "./sec-cup.js";

export const assistMetric = () => ($("#metric") ? $("#metric").value : "ast");

export const shotFilter   = () => ($("#shot") ? $("#shot").value : "all");

export const rankMode     = () => ($("#rank") ? $("#rank").value : "pair");

export const runMode      = () => ($("#runmode") ? $("#runmode").value : "unanswered");

/* Spelled out in the tooltip on every run, so the rule behind a bar is never a guess. */
export const RUN_LABEL = {
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

export const LAYOUTS={
  board:TABLE_OR_POSTER,
  highs:TABLE_OR_POSTER,   // 0.152.0: streaks had an "infographic" choice that drew the same table; removed
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
export const FORM_HIGH_GOOD = {pts:true, reb:true, ast:true, to:false, min:true, pra:true};

/* Threshold and direction are one decision, so they are one control: "+1.0 SD above" and
   "−1.0 SD below" are the two ends of the same question, and splitting them across two
   dropdowns made the reader assemble the sentence themselves. Tenths, so the ids stay
   integers. */
const FORM_SDS = [10, 5];

export const FORM_THRESHOLDS = [].concat(
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

export const FORM_MIN_MINUTES = [0,10,15,20,25];

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

export function setRankOptions(v){
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

export function setLayoutOptions(v){
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

export const rankKey      = () => (rankMode()==="got" ? "got" : "given");

export const SHOT_LABEL = {all:"all field goals", "2":"2-pointers", "3":"3-pointers"};
