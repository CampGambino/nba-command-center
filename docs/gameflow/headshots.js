/* Moved out of docs/gameflow.js unchanged (0.141.16: the Game Flow script split by section). */
import { el, tcol } from "../gameflow.js";

/* ==================== headshots ====================
   A player's mark on the posters: his initials on the team colour. (Until 0.141.16 this
   loaded a portrait from ESPN's or the league's photo servers and fell back to the
   initials; the photos are gone, the fallback is the mark.) */
/* 0.141.16: no photos. The user's decision when Game Flow was ported ("no posters/headshots"), and no web photos of public
   figures: every portrait is the initials on the team colour, the fallback this code always had. */
function headshotUrl(id){
  return null;
}
const initialsOf = n => String(n||"").split(/\s+/).map(w=>w[0]||"").join("").slice(0,2).toUpperCase();

export function headshot(name, id, tri, size){
  const box=el("div","hs");
  box.style.width=box.style.height=size+"px";
  box.style.background=tcol(tri);
  const ini=el("span","hsi",initialsOf(name));
  ini.style.fontSize=Math.round(size*0.34)+"px";
  box.appendChild(ini);
  const url=headshotUrl(id);
  if(url){
    const img=new Image();
    img.alt=name; img.loading="lazy"; img.decoding="async";
    img.addEventListener("load",()=>{ box.classList.add("has"); });
    img.addEventListener("error",()=>{ img.remove(); });
    img.src=url;
    box.appendChild(img);
  }
  return box;
}

