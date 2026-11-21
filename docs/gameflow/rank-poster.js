/* Moved out of docs/gameflow.js unchanged (0.141.16: the Game Flow script split by section). */
import { barAlpha, brandCol, el, tint } from "../gameflow.js";
import { posterFoot, posterShell } from "./range.js";
import { headshot } from "./headshots.js";

/* ==================== one poster shape, five sections ====================
 * Five sections asked for an infographic. Five bespoke posters would have drifted apart
 * inside a week and made five places to fix a spacing bug, so there is one builder and each
 * section supplies rows: a mark (a face for a player, a team swatch for a team), a name, a
 * line of context, a value to print and a fraction to draw. Anything a section cannot fill
 * is left out rather than faked.
 */
export const RANK_POSTER_N = 10;
export function rankPoster({kick, title, cols, rows, notes}){
  const p=posterShell(kick, title);
  const head=el("div","rhead");
  ["#", "", cols[0]||"", "", cols[1]||""].forEach((t,i)=>{
    const d=el("div", i===4? "rh-val":"", t);
    head.appendChild(d);
  });
  p.appendChild(head);
  const peak=rows.reduce((m,r)=>Math.max(m, r.frac||0), 0) || 1;
  rows.forEach((r,i)=>{
    const row=el("div","rrow"+(i===0?" lead":(i%2?" alt":"")));
    row.appendChild(el("div","rrank", r.rank!=null? String(r.rank) : String(i+1)));

    /* A player gets his face; a team gets its tricode on its own colour. Same slot, so the
       rows line up whichever kind of thing is being ranked. */
    if(r.id){
      const hs=headshot(r.name, r.id, r.tri, 34);
      hs.style.setProperty("--ring", brandCol(r.tri));
      row.appendChild(hs);
    }else{
      const m=el("div","rmark", r.tri||"");
      m.style.background=brandCol(r.tri);
      row.appendChild(m);
    }

    const who=el("div","rwho");
    who.appendChild(el("div","rname", r.name));
    if(r.sub) who.appendChild(el("div","rsub", r.sub));
    row.appendChild(who);

    const track=el("div","rtrack");
    const fill=el("i","rfill");
    fill.style.width=Math.max(3, 100*(r.frac||0)/peak)+"%";
    fill.style.background=tint(r.tri, barAlpha(r.tri));
    track.appendChild(fill);
    row.appendChild(track);

    const v=el("div","rval", r.value);
    if(r.unit) v.appendChild(el("small","", r.unit));
    row.appendChild(v);
    p.appendChild(row);
  });
  posterFoot(p, notes);
  return p;
}



