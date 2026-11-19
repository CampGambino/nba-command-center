import pandas as pd, numpy as np, itertools
df = pd.read_pickle("lines2.pkl"); S = df.season.nunique()
p = df[df['min']>=10]
print("lines with 10+ min:", len(p))
HI = {"pts>=30": p.pts>=30, "pts>=40": p.pts>=40, "reb>=15": p.reb>=15, "reb>=20": p.reb>=20, "ast>=12": p.ast>=12, "ast>=15": p.ast>=15, "stl>=5": p.stl>=5, "blk>=5": p.blk>=5, "3pm>=6": p.fg3m>=6, "fga>=22": p.fga>=22, "fta>=14": p.fta>=14, "tov>=7": p.tov>=7, "min>=42": p['min']>=42, "oreb>=8": p.oreb>=8}
ZERO = {"0 pts": p.pts==0, "0 reb": p.reb==0, "0 ast": p.ast==0, "0 FGM": p.fgm==0, "0 FTA": p.fta==0, "0 3PA": p.fg3a==0, "0 tov": p.tov==0, "0 fouls": p.pf==0, "0 FGA": p.fga==0, "0 2-pt makes": (p.fgm-p.fg3m)==0, "0 dreb": p.dreb==0}
print("share of 10+ minute lines at each high:", {k: round(100*v.mean(),2) for k,v in HI.items()})
rows=[]
for hk,hm in HI.items():
    for zk,zm in ZERO.items():
        n=int((hm&zm).sum()); base=int(hm.sum())
        if base==0: continue
        rows.append((hk,zk,n,n/S,100*n/base))
r=pd.DataFrame(rows,columns=["high","zero","n","per_season","pct_of_high"])
print("HIGH with ZERO, rarest that have happened (under 2 a season):")
print(r[(r.n>0)&(r.per_season<2)].sort_values("n").head(45).to_string(index=False))
print("never happened:", "; ".join(f"{a} & {b}" for a,b,n,_,_ in rows if n==0))
print("\nHIGH with ZERO, the common ones (for scale):")
print(r.sort_values("n",ascending=False).head(8).to_string(index=False))
# two highs together
pairs=[]
keys=["pts>=30","reb>=15","ast>=12","stl>=5","blk>=5","3pm>=6","tov>=7","fta>=14","oreb>=8"]
for a,b in itertools.combinations(keys,2):
    if a.split(">")[0]==b.split(">")[0]: continue
    n=int((HI[a]&HI[b]).sum()); exp=HI[a].mean()*HI[b].mean()*len(p)
    pairs.append((a,b,n,round(n/S,2),round(exp,1),round(n/exp,2) if exp else None))
q=pd.DataFrame(pairs,columns=["A","B","n","per_season","expected_if_unrelated","lift"])
print("\nTWO HIGHS together, rarest:"); print(q.sort_values("n").head(16).to_string(index=False))
