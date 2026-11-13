#!/usr/bin/env python3
"""Every team-season with a totals row (1979-80 on): its printed players must add up to it.
  python3 tools/check-team-rows-totals.py team-rows.json [N examples]"""
import json,collections,sys
raw=json.load(open(sys.argv[1]))
tot={}; s=collections.Counter()
for r in raw:
    k=(r['season'],r['team'])
    if r['name'].isupper():
        if r['name']!='OPPONENTS' and 'pts' in r: tot[k]=max(tot.get(k,0), r['pts'])
        continue
    if r['mark'] in ('(!)','‡'): continue
    s[k]+=r.get('pts',0)
bad=[(k,tot.get(k),s[k]) for k in s if tot.get(k) and tot[k]!=s[k]]
print(len(s),'team-seasons;',sum(1 for k in s if k in tot),'with a totals row;',len(bad),'mismatch')
for k,a,b in sorted(bad)[:int(sys.argv[2]) if len(sys.argv)>2 else 40]: print(k,a,b,b-a)
miss=collections.Counter(k[0][:3] for k in s if k not in tot); print('no totals row by decade', sorted(miss.items()))
