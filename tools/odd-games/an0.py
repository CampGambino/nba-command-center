import pandas as pd, numpy as np
df = pd.read_csv("lines.csv")
df.to_pickle("lines.pkl")
print(len(df), df.gid.nunique(), df.season.min(), df.season.max())
cov = df.groupby("season").agg(rows=("pid","size"), games=("gid","nunique"), fga=("fga", lambda s: s.notna().mean()), tov=("tov", lambda s: s.notna().mean()), oreb=("oreb", lambda s: s.notna().mean()), pm=("pm", lambda s: (s.fillna(0)!=0).mean()), start=("starter","mean"), pos=("pos", lambda s: s.notna().mean()), min0=("min", lambda s: (s.fillna(0)==0).mean()))
print(cov.round(2).to_string())
print(df.pos.value_counts().head(12).to_dict())
