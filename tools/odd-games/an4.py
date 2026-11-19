import pandas as pd, numpy as np
df = pd.read_pickle("lines2.pkl"); r = df[df.season>=2021]
def rep(label, m, n=6):
    x = r[m[r.index]].groupby("name").size().sort_values(ascending=False)
    print(f"{label} (2021-22 on, {int(x.sum())} games by {len(x)} players): " + ", ".join(f"{k.strip(chr(34))} {v}" for k,v in x.head(n).items()) + f" | top {n} have {100*x.head(n).sum()/max(1,x.sum()):.0f}%")
rep("30+ pts, 0 FTA", (df.pts>=30)&(df.fta==0))
rep("0-for-8+ from three", (df.fg3m==0)&(df.fg3a>=8))
rep("FTA 20+", df.fta>=20)
rep("20+ pts, 0 reb/ast/stl/blk... loosened: 20+ pts, 1 or fewer", (df.pts>=20)&(df.other<=1))
rep("10+ reb & 10+ ast under 10 pts", (df.reb>=10)&(df.ast>=10)&(df.pts<10))
rep("center 12+ ast", (df.grp=="C")&(df.ast>=12))
rep("guard 15+ reb", (df.grp=="G")&(df.reb>=15))
rep("starter 30+ min 0 pts", (df.starter==1)&(df['min']>=30)&(df.pts==0))
rep("20+ FGA at 20% or worse", (df.fga>=20)&(df.fgm<=0.2*df.fga))
rep("15+ pts in 10 or fewer min / 20+ in 15", ((df.pts>=15)&(df['min']<=10))|((df.pts>=20)&(df['min']<=15)))
# trend over time for the era-sensitive ones
for label,m in [("30+ pts, 0 FTA",(df.pts>=30)&(df.fta==0)),("0-for-8+ from three",(df.fg3m==0)&(df.fg3a>=8)),("center with 5+ threes",(df.grp=="C")&(df.fg3m>=5)),("center with 12+ ast",(df.grp=="C")&(df.ast>=12)),("FT points 75%+ of 15+",(df.pts>=15)&(df.ftm>=0.75*df.pts)),("10+ FT missed",(df.fta-df.ftm>=10)),("fouled out in 12 or fewer",(df.pf>=6)&(df['min']<=12))]:
    by = df[m].groupby(pd.cut(df[m].season,[1992,1999,2006,2013,2020,2025],labels=["93-99","00-06","07-13","14-20","21-25"]),observed=False).size()
    yrs = {"93-99":7,"00-06":7,"07-13":7,"14-20":7,"21-25":5}
    print(f"  {label} per season by era: " + ", ".join(f"{k} {v/yrs[k]:.1f}" for k,v in by.items()))
