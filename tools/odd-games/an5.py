# Re-derives every number printed in claude/odd-games-study.md, Finding 1 and 2, from lines2.pkl.
import pandas as pd, numpy as np
df = pd.read_pickle("lines2.pkl"); S = df.season.nunique(); L5 = df.season>=2021
print("lines", len(df), "games", df.gid.nunique(), "seasons", S, df.season.min(), df.season.max())
def row(label, m):
    print(f"{label} | {int(m.sum())} | {m.sum()/S:.1f} | {(m&L5).sum()/5:.1f}")
o4 = (df.reb==0)&(df.ast==0)&(df.stl==0)&(df.blk==0)
T = [("0 FGM on 10+", (df.fgm==0)&(df.fga>=10)), ("0 FGM on 12+", (df.fgm==0)&(df.fga>=12)),
("0-8+ 3s", (df.fg3m==0)&(df.fg3a>=8)), ("0-10+ 3s", (df.fg3m==0)&(df.fg3a>=10)),
("10+ pts 0 FGM", (df.pts>=10)&(df.fgm==0)), ("20+ pts <=2 FGM", (df.pts>=20)&(df.fgm<=2)),
("FT pts >=75% of 15+", (df.pts>=15)&(df.ftm>=0.75*df.pts)), ("FTA 20+", df.fta>=20),
("30+ 0 FTA", (df.pts>=30)&(df.fta==0)), ("35+ 0 FTA", (df.pts>=35)&(df.fta==0)), ("40+ 0 FTA", (df.pts>=40)&(df.fta==0)),
("20+ none", (df.pts>=20)&o4), ("25+ none", (df.pts>=25)&o4),
("15+ in <=10", (df.pts>=15)&(df['min']<=10)), ("20+ in <=15", (df.pts>=20)&(df['min']<=15)),
("G 15+ reb", (df.grp=="G")&(df.reb>=15)), ("G 18+ reb", (df.grp=="G")&(df.reb>=18)), ("C 12+ ast", (df.grp=="C")&(df.ast>=12)), ("G 6+ blk", (df.grp=="G")&(df.blk>=6)),
("TD <10 pts", (df.pts<10)&(((df.reb>=10).astype(int)+(df.ast>=10)+(df.stl>=10)+(df.blk>=10))>=3)),
("10r 10a <10p", (df.reb>=10)&(df.ast>=10)&(df.pts<10)),
("DD <=2 pts", (df.pts<=2)&(((df.reb>=10).astype(int)+(df.ast>=10)+(df.stl>=10)+(df.blk>=10))>=2)),
("1x5", (df.pts==1)&(df.reb==1)&(df.ast==1)&(df.stl==1)&(df.blk==1)), ("1x6", (df.pts==1)&(df.reb==1)&(df.ast==1)&(df.stl==1)&(df.blk==1)&(df.tov==1)),
("5x5", (df.pts>=5)&(df.reb>=5)&(df.ast>=5)&(df.stl>=5)&(df.blk>=5)),
("0 min stat", (df['min']==0)&((df.pts+df.reb+df.ast+df.stl+df.blk+df.tov+df.pf+df.fga+df.fta)>0)),
("20+ FGA <=20%", (df.fga>=20)&(df.fgm<=0.2*df.fga)), ("10+ FGM no miss", (df.fgm>=10)&(df.fgm==df.fga)), ("16+ FTM no miss", (df.ftm>=16)&(df.ftm==df.fta)), ("10+ FT missed", (df.fta-df.ftm)>=10),
("starter 30+ 0", (df.starter==1)&(df['min']>=30)&(df.pts==0)), ("foul out <=12", (df.pf>=6)&(df['min']<=12)), ("10+ tov", df.tov>=10),
("0 pts 10+ ast", (df.pts==0)&(df.ast>=10)), ("0 pts 15+ reb", (df.pts==0)&(df.reb>=15)), ("40+ bench", (df.starter==0)&(df.pts>=40))]
for l,m in T: row(l,m)
sh = lambda x: "; ".join(f"{e['name']} {e.d} {e.team} {e['min']}m {e.pts}p {e.fgm}-{e.fga} 3:{e.fg3m}-{e.fg3a} ft:{e.ftm}-{e.fta} {e.reb}r {e.ast}a" for _,e in x.iterrows())
print("most FGA w/o make:", sh(df[df.fgm==0].sort_values("fga",ascending=False).head(3)))
print("most pts <=2 FGM:", sh(df[df.fgm<=2].sort_values("pts",ascending=False).head(3)))
print("most pts 0 FTA:", sh(df[df.fta==0].sort_values("pts",ascending=False).head(3)))
print("most pts 0 FGM:", sh(df[df.fgm==0].sort_values("pts",ascending=False).head(3)))
print("TD<10:", sh(df[T[19][1]])); print("1x6:", sh(df[T[23][1]]))
t = df[df['min']>=10]; n=len(t); print("10+ min lines", n)
Z = [("ast>=15 & 0 pts",(t.ast>=15)&(t.pts==0)),("reb>=20 & 0 FGA",(t.reb>=20)&(t.fga==0)),("ast>=12 & 0 FGA",(t.ast>=12)&(t.fga==0)),("stl>=5 & 0 FGA",(t.stl>=5)&(t.fga==0)),
("40+ no 2pt make",(t.pts>=40)&(t.fgm==t.fg3m)),("22+ FGA no 2pt make",(t.fga>=22)&(t.fgm==t.fg3m)),("FTA>=14 & 0 FGM",(t.fta>=14)&(t.fgm==0)),("blk>=5 & 0 reb",(t.blk>=5)&(t.reb==0)),
("tov>=7 & 0 pts",(t.tov>=7)&(t.pts==0)),("reb>=20 & 0 pts",(t.reb>=20)&(t.pts==0)),("40+ & 0 reb",(t.pts>=40)&(t.reb==0)),("42+ min & 0 pts",(t['min']>=42)&(t.pts==0)),("stl>=5 & 0 pts",(t.stl>=5)&(t.pts==0))]
for l,m in Z: print(f"{l}: {int(m.sum())}" + (" -> "+sh(t[m]) if m.sum()<=2 else ""))
P = [("6+ 3s & 8+ oreb",t.fg3m>=6,t.oreb>=8),("12+ ast & 8+ oreb",t.ast>=12,t.oreb>=8),("12+ ast & 5+ blk",t.ast>=12,t.blk>=5),("5+ blk & 6+ 3s",t.blk>=5,t.fg3m>=6),("15+ reb & 6+ 3s",t.reb>=15,t.fg3m>=6),("5+ stl & 5+ blk",t.stl>=5,t.blk>=5)]
for l,a,b in P: print(f"{l}: {int((a&b).sum())} (if unrelated {a.sum()*b.sum()/n:.0f})")
