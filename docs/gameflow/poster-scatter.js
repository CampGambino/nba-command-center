/* Moved out of docs/gameflow.js unchanged (0.141.16: the Game Flow script split by section). */
import { seasonLabel, tcol, topWithTies } from "../gameflow.js";
import { RANGE_N, pctile, posterFoot, posterShell, posterTools, rangeScope, svgEl, svgText } from "./range.js";

/* ==================== poster: accuracy against distance ====================
 * Every qualified shooter, with the deepest averages picked out. The comparison group
 * is the point: "deep shooters are less accurate" is only visible if the shooters who
 * aren't deep are on the same chart.
 *
 * A three-point percentage over a few dozen attempts is a very noisy number, so each
 * highlighted shooter carries a one-standard-error bar and the note states the typical
 * width. Without that the reader will happily rank two players three points apart when
 * the interval is ten points wide. No trend line is drawn for the same reason: the
 * correlation is reported as a number with its sample size, which is a claim that can
 * be checked, rather than a line that implies more than the data holds.
 */
export function renderRangeScatter(card, agg){
  const all=agg.eligible;
  const deep=new Set(topWithTies(all, RANGE_N, r=>r.avg).map(r=>r.id));

  const W=968, H=612, L=56, R=176, T=56, B=68;
  const xs=all.map(r=>r.avg), ys=all.map(r=>r.pct);
  const x0=Math.min(...xs)-0.25, x1=Math.max(...xs)+0.25;
  const y0=Math.max(0, Math.min(...ys)-3), y1=Math.min(100, Math.max(...ys)+3);
  const px=v=>L+((v-x0)/(x1-x0))*(W-L-R);
  const py=v=>H-B-((v-y0)/(y1-y0))*(H-T-B);

  const att=all.reduce((a,r)=>a+r.att,0), mad=all.reduce((a,r)=>a+r.made,0);
  const lgPct=att? 100*mad/att : 0;
  const medX=pctile(xs, 0.5);
  const se=r=>{ const p0=r.pct/100; return 100*Math.sqrt(Math.max(p0*(1-p0),1e-9)/r.att); };

  const n=all.length;
  const mx=xs.reduce((a,b)=>a+b,0)/n, my=ys.reduce((a,b)=>a+b,0)/n;
  let sxy=0, sxx=0, syy=0;
  all.forEach(r=>{ const dx=r.avg-mx, dy=r.pct-my; sxy+=dx*dy; sxx+=dx*dx; syy+=dy*dy; });
  const rr=(sxx>0&&syy>0)? sxy/Math.sqrt(sxx*syy) : 0;

  const p=posterShell(`NBA ${seasonLabel()}`, "Does shooting deeper cost you?");
  const svg=svgEl("svg",{viewBox:`0 0 ${W} ${H}`, width:W, height:H, class:"scplot"});

  /* Horizontal rules only, and faint. The previous version ruled both axes every foot
     and every five points, which put more ink into the grid than into the data. */
  for(let v=Math.ceil(y0/5)*5; v<=y1; v+=5){
    svg.appendChild(svgEl("line",{x1:L, y1:py(v), x2:W-R, y2:py(v), class:"axgrid"}));
    svg.appendChild(svgText(L-9, py(v)+4, `${v}%`, {class:"axtick","text-anchor":"end"}));
  }
  for(let d=Math.ceil(x0); d<=x1; d++)
    svg.appendChild(svgText(px(d), H-B+22, `${d}`, {class:"axtick","text-anchor":"middle"}));
  svg.appendChild(svgText(L-9, T-16, "3PT%", {class:"axcap","text-anchor":"end"}));
  svg.appendChild(svgText(W-R, H-B+42, "average distance of his threes (feet)",
    {class:"axcap","text-anchor":"end"}));

  /* Two references, so the chart reads as quadrants: deeper than most and better than
     most is the top right. Labelled in place, the way a reference line should be. */
  svg.appendChild(svgEl("line",{x1:L, y1:py(lgPct), x2:W-R, y2:py(lgPct), class:"axref"}));
  svg.appendChild(svgText(L+3, py(lgPct)-8, `all ${n} combined, ${lgPct.toFixed(1)}%`,
    {class:"axreflab"}));
  svg.appendChild(svgEl("line",{x1:px(medX), y1:T, x2:px(medX), y2:H-B, class:"axref"}));
  svg.appendChild(svgText(px(medX)+6, T+12, `median ${medX.toFixed(1)} ft`,
    {class:"axreflab"}));

  // one uniform size: every shooter here has at least RANGE_MIN_3PA attempts, and sizing
  // by attempts added a third variable to a chart about two
  all.filter(r=>!deep.has(r.id)).forEach(r=>{
    svg.appendChild(svgEl("circle",{cx:px(r.avg), cy:py(r.pct), r:3.6, class:"scdot rest"}));
  });
  const marked=all.filter(r=>deep.has(r.id));
  marked.forEach(r=>{
    svg.appendChild(svgEl("circle",{cx:px(r.avg), cy:py(r.pct), r:6.4,
      fill:tcol(r.tri), class:"scdot deep"}));
  });

  const LH=17;
  const place=marked.map(r=>({r, x:px(r.avg), y:py(r.pct)})).sort((a,b)=>a.y-b.y);
  let lastY=-1e9;
  place.forEach(o=>{ o.ly=Math.max(o.y, lastY+LH); lastY=o.ly; });
  const over=lastY-(H-B-2);
  if(over>0) place.forEach(o=>{ o.ly-=over; });
  place.forEach(o=>{
    const right = o.x < W-R-8;
    const lx = right ? o.x+11 : o.x-11;
    if(Math.abs(o.ly-o.y)>3)
      svg.appendChild(svgEl("line",{x1:o.x+(right?6:-6), y1:o.y, x2:lx-(right?2:-2),
        y2:o.ly-4, class:"sctie"}));
    svg.appendChild(svgText(lx, o.ly, o.r.name,
      {class:"sclab","text-anchor":right?"start":"end"}));
  });

  /* One representative error bar in the corner instead of twelve across the plot. The
     noise is the same either way, but drawn on every marked shooter it was the loudest
     thing on the chart and it crossed the names. */
  const seTyp=marked.map(se).sort((a,b)=>a-b);
  const seMid=seTyp[Math.floor(seTyp.length/2)]||0;
  const gx=W-R+34, gy=T+40, gh=(seMid/(y1-y0))*(H-T-B);
  svg.appendChild(svgEl("line",{x1:gx, y1:gy-gh, x2:gx, y2:gy+gh, class:"scerr",
    stroke:"#6b7480"}));
  svg.appendChild(svgEl("line",{x1:gx-4, y1:gy-gh, x2:gx+4, y2:gy-gh, class:"scerr",
    stroke:"#6b7480"}));
  svg.appendChild(svgEl("line",{x1:gx-4, y1:gy+gh, x2:gx+4, y2:gy+gh, class:"scerr",
    stroke:"#6b7480"}));
  svg.appendChild(svgText(gx+9, gy-4, `typical`, {class:"scgloss"}));
  svg.appendChild(svgText(gx+9, gy+9, `±${seMid.toFixed(1)} pts`, {class:"scgloss"}));

  p.appendChild(svg);
  posterFoot(p, [rangeScope(agg, all.length),
    `Coloured and named are the ${deep.size} deepest averages; grey are the other `+
    `qualified shooters, there so you can see whether the deep ones are unusual.`,
    `Every shooter here averages at least ${Math.min(...xs).toFixed(1)} ft, so the `+
    `three-point line sits off the left of the scale rather than wasting a third of it.`,
    `The bar at the right is one standard error on a percentage at this sample size — `+
    `typically ±${seMid.toFixed(1)} points, wide enough that small gaps between players `+
    `are not real. It is drawn once rather than on every shooter.`,
    `Across all ${n} qualified shooters the correlation between average distance and `+
    `percentage is <b>r = ${rr.toFixed(2)}</b>. That is a description of these `+
    `${n} players, not a law: no line is drawn because at this sample size one would `+
    `imply more than the data holds.`]);
  card.appendChild(p);
  posterTools(card, p, "Does shooting deeper cost you?", "nba-3pt-accuracy.html");
}

