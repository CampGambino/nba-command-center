/* Moved out of docs/gameflow.js unchanged (0.141.16: the Game Flow script split by section). */
import { franchises, teamGamesFor } from "./models.js";

/* ==================== rest between games ====================
 * Days of rest is a calendar-day question, and the two feeds disagree about what a calendar
 * day is. The league feed hands back Eastern local time with no zone marker, so its first
 * ten characters already are the league's own scheduling date. ESPN hands back a UTC
 * instant, and a 10pm Eastern tip is already tomorrow in UTC — reading the first ten
 * characters of that would move a Tuesday night game to Wednesday and turn a back-to-back
 * into a day of rest. So the UTC form is converted back to Eastern before the date is taken.
 */
export function gameDay(iso){
  const s=String(iso||"");
  if(!s) return null;
  if(!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return s.slice(0,10);
  const d=new Date(s);
  return isNaN(d)? null : d.toLocaleDateString("en-CA",{timeZone:"America/New_York"});
}
export const dayNum = iso => {
  const day=gameDay(iso); if(!day) return null;
  const [y,m,d]=day.split("-").map(Number);
  return Math.round(Date.UTC(y,m-1,d)/86400000);
};
/* Rest is counted as calendar days between games minus one, so a team that played yesterday
   is on zero days rest — the second game of a back-to-back. Three or more is one bucket:
   past three days the schedule stops being the story. */
export const REST_BUCKETS=[0,1,2,3];
export const restBucket = r => (r==null? null : (r>=3? 3 : r));
const REST_LABEL = {0:"0 (back-to-back)", 1:"1 day", 2:"2 days", 3:"3+ days"};

/* Built from the schedule alone, so it is exact and independent of which games have been
   read. It also deliberately looks at the team's whole season rather than the selected
   window: the previous game happened whether or not it is on screen. */
export function restIndex(){
  const idx=new Map();
  for(const tri of franchises()){
    let prev=null;
    for(const g of teamGamesFor(tri)){       // chronological: GAMES is sorted by date
      const d=dayNum(g.date);
      /* The season opener has no previous game. That is not zero days rest — it is no
         measurement at all, so it stays out of every bucket rather than being counted as
         the most rested case. */
      idx.set(g.gameId+"|"+tri,
        (prev==null || d==null)? null : Math.max(0, d-prev-1));
      if(d!=null) prev=d;
    }
  }
  return idx;
}

