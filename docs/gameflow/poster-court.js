/* Moved out of docs/gameflow.js unchanged (0.141.16: the Game Flow script split by section). */
import { denseRanks, el, seasonLabel, tcol, topWithTies } from "../gameflow.js";
import { posterFoot, posterShell, posterTools, rangeScope, svgEl } from "./range.js";
import { ARC_R, CORNER_D, CORNER_Y, COURT_W, HOOP_INSET } from "../lib/gameflow/model.js";
import { headshot } from "./headshots.js";

/* ==================== poster: the deepest shooters, on a court ====================
 * A half court, and above it the five deepest averages with a headshot, a name, the
 * distance and his three-point percentage.
 *
 * On the vertical placement, which has been the hard part of this poster. Three things are
 * wanted at once and only two are possible:
 *   - the five separated enough to read
 *   - their gaps in proportion to each other
 *   - their height above the line in proportion to how far behind it they actually are
 * The averages span 1.2 ft while the closest of them is already 4.2 ft behind the line, so
 * the ratio that matters is 0.1 to 4.2. Any single scale that puts a tenth of a foot far
 * enough apart to read pushes the group thousands of pixels off the court.
 *
 * So the stack is an ordered LIST, evenly spaced, and the poster says so: rank is the
 * position, and the numbers beside each face carry the measurement. It floats clear of the
 * arc rather than sitting on it, because even the fifth-deepest shooter averages four feet
 * behind the line and putting him on it was simply wrong.
 */
const COURT_TOP_N = 5;
const LANE_W = 16, LANE_L = 19, FT_R = 6, RIM_R = 0.75, RESTRICT_R = 4;
const CENTRE_L = 47, CENTRE_R = 6;
/* Full bleed: the court IS the poster, and the players sit on it. Cropped from just below
   the free-throw line up, because everything nearer the basket than that is irrelevant to
   a graphic about three-point range and only cost vertical space. */
const HS_PX = 64, ROW_PX = 78, CROP_FT = 17, TOP_FT = 50;

export function renderRangeCourt(card, agg){
  const rows=topWithTies(agg.eligible, COURT_TOP_N, r=>r.avg);
  const ranks=denseRanks(rows.map(r=>+r.avg.toFixed(1)));
  const counts={}; ranks.forEach(r=>{counts[r]=(counts[r]||0)+1;});

  const W=1038;                                  // the poster's full width, border to border
  const CS=W/COURT_W;
  const H=(TOP_FT-CROP_FT)*CS;
  const fx=ft=>W/2+ft*CS, fy=ft=>H-(ft-CROP_FT)*CS;
  const arcTo=(r,x,y,sweep)=>`A ${r*CS} ${r*CS} 0 0 ${sweep} ${fx(x)} ${fy(y)}`;

  const wrap=el("div","ctwrap"); wrap.style.height=H+"px";
  const svg=svgEl("svg",{viewBox:`0 0 ${W} ${H}`, width:W, height:H, class:"ctplot"});

  /* ---- the floor ----
   * Boards, a lighting gradient and a few grain streaks. All deterministic: the streaks
   * come off a fixed list rather than Math.random, so two renders of the same data produce
   * the same poster and the tests have something stable to assert. */
  const uid="ct"+Math.abs(Math.round(CS*1000));
  const defs=svgEl("defs",{});
  const grad=svgEl("linearGradient",{id:uid+"g", x1:"0", y1:"0", x2:"0.15", y2:"1"});
  [["0","#e9c99e"],["0.42","#dcb684"],["0.78","#d0a56e"],["1","#c4965f"]]
    .forEach(([o,c])=>grad.appendChild(svgEl("stop",{offset:o,"stop-color":c})));
  defs.appendChild(grad);
  const glow=svgEl("radialGradient",{id:uid+"h", cx:"0.5", cy:"0.28", r:"0.62"});
  glow.appendChild(svgEl("stop",{offset:"0","stop-color":"#fff","stop-opacity":".30"}));
  glow.appendChild(svgEl("stop",{offset:"1","stop-color":"#fff","stop-opacity":"0"}));
  defs.appendChild(glow);
  const pat=svgEl("pattern",{id:uid+"p", width:9.2, height:H,
    patternUnits:"userSpaceOnUse"});
  pat.appendChild(svgEl("line",{x1:0, y1:0, x2:0, y2:H, stroke:"#a87a4c",
    "stroke-opacity":".22", "stroke-width":1}));
  defs.appendChild(pat);
  svg.appendChild(defs);

  svg.appendChild(svgEl("rect",{x:0, y:0, width:W, height:H, fill:`url(#${uid}g)`,
    class:"ctfloor"}));
  [0.06,0.17,0.23,0.35,0.41,0.52,0.58,0.67,0.74,0.81,0.88,0.95].forEach((f,k)=>
    svg.appendChild(svgEl("rect",{x:f*W, y:0, width:9.2*(k%3?1:2), height:H,
      fill:"#a87a4c", "fill-opacity":(k%2?0.05:0.08)})));
  svg.appendChild(svgEl("rect",{x:0, y:0, width:W, height:H, fill:`url(#${uid}p)`,
    class:"ctboards"}));
  svg.appendChild(svgEl("rect",{x:0, y:0, width:W, height:H, fill:`url(#${uid}h)`}));

  // ---- markings ----
  svg.appendChild(svgEl("rect",{x:fx(-LANE_W/2), y:fy(LANE_L), width:LANE_W*CS,
    height:(LANE_L-CROP_FT)*CS, class:"ctpaint"}));
  svg.appendChild(svgEl("line",{x1:fx(-LANE_W/2), y1:fy(LANE_L), x2:fx(LANE_W/2),
    y2:fy(LANE_L), class:"ctmark"}));
  [-LANE_W/2, LANE_W/2].forEach(x=>svg.appendChild(svgEl("line",
    {x1:fx(x), y1:fy(LANE_L), x2:fx(x), y2:fy(CROP_FT), class:"ctmark"})));
  svg.appendChild(svgEl("path",{d:`M ${fx(-FT_R)} ${fy(LANE_L)} `
    + arcTo(FT_R,FT_R,LANE_L,1), class:"ctmark"}));
  svg.appendChild(svgEl("path",{d:`M ${fx(-FT_R)} ${fy(LANE_L)} `
    + arcTo(FT_R,FT_R,LANE_L,0), class:"ctmark dash"}));
  const cyft=HOOP_INSET+CORNER_Y;
  svg.appendChild(svgEl("path",{d:
    `M ${fx(-CORNER_D)} ${fy(CROP_FT)} L ${fx(-CORNER_D)} ${fy(cyft)} `
    + arcTo(ARC_R,CORNER_D,cyft,1)
    + ` L ${fx(CORNER_D)} ${fy(CROP_FT)}`, class:"ctarc"}));
  // half way line and the near half of the centre circle, so the crop reads as a real floor
  svg.appendChild(svgEl("line",{x1:0, y1:fy(CENTRE_L), x2:W, y2:fy(CENTRE_L),
    class:"ctmark"}));
  svg.appendChild(svgEl("path",{d:`M ${fx(-CENTRE_R)} ${fy(CENTRE_L)} `
    + arcTo(CENTRE_R,CENTRE_R,CENTRE_L,0), class:"ctmark"}));
  [-COURT_W/2, COURT_W/2].forEach(x=>svg.appendChild(svgEl("line",
    {x1:fx(x), y1:0, x2:fx(x), y2:H, class:"ctmark"})));

  const apexY=fy(HOOP_INSET+ARC_R);
  const stack=(rows.length-1)*ROW_PX+HS_PX;
  const top0=Math.max(16, apexY-46-stack);
  svg.appendChild(svgEl("line",{x1:fx(0), y1:apexY, x2:fx(0), y2:top0+stack+4,
    class:"ctgauge"}));
  wrap.appendChild(svg);

  // ---- the players, on the floor ----
  rows.forEach((r,i)=>{
    const row=el("div","ctrow");
    row.style.top=(top0+i*ROW_PX)+"px";
    row.style.left=(W/2-HS_PX/2-14)+"px";
    const hs=headshot(r.name, r.id, r.tri, HS_PX);
    hs.style.setProperty("--ring", tcol(r.tri));
    row.appendChild(hs);
    const txt=el("div","cttext");
    txt.appendChild(el("div","ctrank2",(counts[ranks[i]]>1?"T":"")+ranks[i]));
    txt.appendChild(el("div","ctrname",r.name));
    txt.appendChild(el("div","ctrdist",
      `${r.avg.toFixed(1)} ft · ${r.pct.toFixed(1)}% from three`));
    row.appendChild(txt);
    wrap.appendChild(row);
  });

  const near=Math.min(...rows.map(r=>r.avg))-ARC_R;
  const p=posterShell(`NBA ${seasonLabel()}`, "Where the deepest shooters live");
  p.appendChild(wrap);
  posterFoot(p, [rangeScope(agg, agg.eligible.length),
    `Ranked by the average distance of every three he took; the percentage is how many went in.`,
    // 0.152.0: the span was printed as a fixed "1.2 ft" whatever the five were
    `<b>Ordered, not to scale:</b> these ${rows.length} span ${(Math.max(...rows.map(r=>r.avg))-Math.min(...rows.map(r=>r.avg))).toFixed(1)} ft, `+
    `all ${near.toFixed(1)}+ ft behind the line.`]);
  card.appendChild(p);
  posterTools(card, p, "Where the deepest shooters live", "nba-3pt-court.html");
}

