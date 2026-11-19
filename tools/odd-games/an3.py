import pandas as pd, numpy as np
df = pd.read_pickle("lines2.pkl"); S = df.season.nunique()
df = df.sort_values(["pid","d"]).reset_index(drop=True)
g = df.groupby(["pid","season"])
df["gp"] = g.pts.transform("size"); df["ppg"] = g.pts.transform("mean"); df["mpg"] = g["min"].transform("mean"); df["sd"] = g.pts.transform("std")
df["rpg"] = g.reb.transform("mean"); df["apg"] = g.ast.transform("mean")
# leave-one-out season average
df["ppg_x"] = (df.ppg*df.gp - df.pts)/(df.gp-1).clip(lower=1)
reg = df[(df.gp>=30)]
nm = lambda e: f"{e['name'].strip(chr(34))} {e.d} ({e.pts} pts, {e.fgm}-{e.fga}, {e['min']} min; season {e.ppg_x:.1f})"
def rate(label, pool, hit):
    P = reg[pool]; H = P[hit[P.index]]
    print(f"{label}: {len(H)} of {len(P)} player-games = 1 in {len(P)/max(1,len(H)):.0f}; {len(H)/S:.1f} a season; last five {len(H[H.season>=2021])/5:.1f} | " + "; ".join(nm(e) for _,e in H.sort_values('d',ascending=False).head(2).iterrows()))
star = (reg.ppg_x>=25); good = (reg.ppg_x>=20)
rate("25+ ppg scorer, 28+ min, 9 or fewer pts", star&(reg['min']>=28), reg.pts<=9)
rate("25+ ppg scorer, 28+ min, under half his average", star&(reg['min']>=28), reg.pts<0.5*reg.ppg_x)
rate("20+ ppg scorer, 28+ min, 5 or fewer pts", good&(reg['min']>=28), reg.pts<=5)
rate("20+ ppg scorer, 25+ min, 0 FGM", good&(reg['min']>=25), reg.fgm==0)
rate("20+ ppg scorer, 12+ FGA at 20% or worse", good&(reg.fga>=12), reg.fgm<=0.2*reg.fga)
rate("20+ ppg scorer scoreless (any minutes 10+)", good&(reg['min']>=10), reg.pts==0)
rate("under 8 ppg, scores 30+", (reg.ppg_x<8), reg.pts>=30)
rate("under 10 ppg, scores 3x average and 25+", (reg.ppg_x<10), (reg.pts>=25)&(reg.pts>=3*reg.ppg_x))
rate("anyone 10+ ppg: 30 above his average", (reg.ppg_x>=10), reg.pts>=reg.ppg_x+30)
rate("anyone: 25 above his average", (reg.ppg_x>=0), reg.pts>=reg.ppg_x+25)
reg = reg.assign(z=(reg.pts-reg.ppg_x)/reg.sd.clip(lower=1))
print("z >= 4:", int((reg.z>=4).sum()), "per season", round((reg.z>=4).sum()/S,1), "| z <= -2.5 among 20+ ppg:", int(((reg.z<=-2.5)&good).sum()), round(((reg.z<=-2.5)&good).sum()/S,1))
# rebounds / assists far above own norm
rate("rebounds: 3x his average and 15+", (reg.rpg>=2), (reg.reb>=15)&(reg.reb>=3*reg.rpg))
rate("assists: 3x his average and 12+", (reg.apg>=1.5), (reg.ast>=12)&(reg.ast>=3*reg.apg))
# context for star duds: home/road, back-to-back, blowouts
P = reg[star&(reg['min']>=24)].copy(); P["dud"] = P.pts < 0.5*P.ppg_x
tg = df.groupby(["team","d"]).size().reset_index()[["team","d"]].sort_values(["team","d"]); tg["prev"] = tg.groupby("team").d.shift(1)
tg["b2b"] = (pd.to_datetime(tg.d)-pd.to_datetime(tg.prev)).dt.days==1
P = P.merge(tg[["team","d","b2b"]], on=["team","d"], how="left"); P["margin"] = P.ts-P.os
for k,grp in [("home",P.home==1),("road",P.home==0),("2nd night of back-to-back",P.b2b==True),("rested",P.b2b==False),("won by 20+",P.margin>=20),("lost by 20+",P.margin<=-20),("decided by 5 or fewer",P.margin.abs()<=5)]:
    print(f"  25+ ppg scorer under half his average, {k}: {100*P[grp].dud.mean():.2f}% of {int(grp.sum())}")
# streaks: starters / scorers held down several games running
df2 = reg[(reg['min']>=20)].sort_values(["pid","d"]).copy()
def runs(mask_col, label, need):
    c=0; out=[]; last=None
    for pid,d,m,season in zip(df2.pid, df2.d, df2[mask_col], df2.season):
        if (pid,season)!=last: c=0; last=(pid,season)
        c = c+1 if m else 0
        if c==need: out.append((pid,d,season))
    print(f"{label}: reached {need} straight {len(out)} times ({len(out)/S:.1f} a season)")
df2["under_half"] = (df2.ppg_x>=20)&(df2.pts<0.5*df2.ppg_x)
df2["under_70"] = (df2.ppg_x>=22)&(df2.pts<0.7*df2.ppg_x)
df2["st0"] = (df2.starter==1)&(df2.pts==0)
df2["cold"] = (df2.ppg_x>=18)&(df2.fga>=10)&(df2.fgm<=0.3*df2.fga)
for col,label,ns in [("under_half","20+ ppg scorer under half his average (20+ min)",(2,3)),("under_70","22+ ppg scorer under 70% of his average",(3,4,5)),("st0","starter scoreless in 20+ min",(2,3)),("cold","18+ ppg scorer at 30% or worse on 10+ shots",(2,3,4))]:
    for n in ns: runs(col,label,n)
