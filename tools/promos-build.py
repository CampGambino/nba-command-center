# Turns a sweep of the 30 teams' promotion and schedule pages (as saved by the browser: { pages: { "/path": [lines] } }) into rows:
# date, team, opponent, night, flag ("look" = not one of the usual themes), how well that team's page read. The data itself is
# private and never in this repository (the user, 11/17). Usage: python3 -I tools/promos-build.py <sweep.json>  → rows.json, rows.tsv
import json, re, sys, csv
src = sys.argv[1]; d = json.load(open(src))['pages']
TEAM = {'hawks':'ATL','celtics':'BOS','nets':'BKN','hornets':'CHA','bulls':'CHI','cavaliers':'CLE','mavs':'DAL','nuggets':'DEN','pistons':'DET','warriors':'GSW','rockets':'HOU','pacers':'IND','clippers':'LAC','lakers':'LAL','grizzlies':'MEM','heat':'MIA','bucks':'MIL','timberwolves':'MIN','pelicans':'NOP','knicks':'NYK','thunder':'OKC','magic':'ORL','sixers':'PHI','suns':'PHX','blazers':'POR','kings':'SAC','spurs':'SAS','raptors':'TOR','jazz':'UTA','wizards':'WAS'}
USE = {'ATL':['/hawks/schedule'],'BOS':['/celtics/schedule'],'BKN':['/nets/schedule'],'SAC':['/kings/schedule'],'UTA':['/jazz/schedule']}
NICKS = ['Hawks','Celtics','Nets','Hornets','Bulls','Cavaliers','Mavericks','Nuggets','Pistons','Warriors','Rockets','Pacers','Clippers','Lakers','Grizzlies','Heat','Bucks','Timberwolves','Pelicans','Knicks','Thunder','Magic','76ers','Sixers','Suns','Trail Blazers','Blazers','Kings','Spurs','Raptors','Jazz','Wizards']
CITIES = ['Atlanta','Boston','Brooklyn','Charlotte','Chicago','Cleveland','Dallas','Denver','Detroit','Golden State','Houston','Indiana','LA','Los Angeles','Memphis','Miami','Milwaukee','Minnesota','New Orleans','New York','Oklahoma City','Orlando','Philadelphia','Phoenix','Portland','Sacramento','San Antonio','Toronto','Utah','Washington']
ABBR = ['ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GSW','HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NOP','NYK','OKC','ORL','PHI','PHX','POR','SAC','SAS','TOR','UTA','WAS']
OPP = re.compile(r'^(?:(?:vs\.?|at|@)\s+)?(?:the )?(?:(' + '|'.join(CITIES) + r')\s+)?(' + '|'.join(NICKS) + r'|' + '|'.join(ABBR) + r'|' + '|'.join(CITIES) + r')$', re.I)
MON = {m:i+1 for i,m in enumerate(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'])}
DATE = re.compile(r'\b(jan|feb|mar|apr|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b', re.I)
NOISE = re.compile(r'^(get offer|more info|buy ticket package.*|\+\d+ more|\*photo from previous season|tune in|gameday tracker|luxury suites|opponent|promo\.jpg|media-image|jersey|★|[|]|\d{1,2}(:\d\d)? ?(am|pm)( [a-z]{2,3})?|@ ?\d.*|(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?|january|february|march|april|october|november|december|upcoming theme nights|theme and promotional nights|celebration|ticket package|giveaway|theme night)$', re.I)
MEDIA = re.compile(r'(radio|\btv\b|nbcs|spectrum|espn|jazz\+|kjzz|prime video|peacock|nba tv|sportsnet|network|\bfm\b|\bam \d|center\b.*@|arena|fieldhouse| - .*, [A-Z]{2}$|^, )', re.I)
def iso(mo, day):
    m = MON[mo[:3].lower()]; return f"{2026 if m >= 8 else 2027}-{m:02d}-{int(day):02d}"
rows = []
for path, lines in d.items():
    slug = path.strip('/').split('/')[0]; tri = TEAM.get(slug)
    if not tri or not lines: continue
    if tri in USE and path not in USE[tri]: continue
    if tri not in USE and path.endswith('/schedule'): continue
    carry = None
    for ln in lines:
        m = DATE.search(ln)
        if not m: continue
        date = iso(m.group(1), m.group(2)); away = ('?:' in ln[:14])
        ln2 = re.sub(r'^[A-Za-z]+\.? \d{1,2}\??: ', '', ln) if re.match(r'^[A-Za-z]+\.? \d{1,2}\??: ', ln) else ln
        parts = [p.strip() for p in ln2.split(' | ')]
        opp = None; keep = []; lead = None
        for p in parts:
            first = p.startswith('<'); p = p.lstrip('<').strip(); br = p.startswith('[') and p.endswith(']'); p = p.strip('[]').strip()
            if not p: continue
            hasd = bool(DATE.search(p)); q = DATE.sub('', p)
            if hasd: q = re.sub(r'\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?', '', q, flags=re.I)
            q = re.sub(r'\b20\d\d\b|\d{1,2}:\d\d ?(am|pm)?( [A-Z]{2,3})?|[•·]| at $|^- | - $', ' ', q, flags=re.I).strip(' ,.-')
            mo = re.search(r'\b(?:vs\.?|VS\.?|at|@)\s+((?:the )?[A-Z][A-Za-z. ]+)$', q)
            if mo and OPP.match(mo.group(1).strip()): opp = opp or mo.group(1).strip(); q = q[:mo.start()].strip(' ,.-')
            if not q or NOISE.match(q) or MEDIA.search(q): continue
            if OPP.match(q): opp = opp or re.sub(r'^(vs\.?|at|@)\s+', '', q, flags=re.I); continue
            if re.search(r'siriusxm|sports hub|game recap|individual tickets|purchase ticket|lower level|upper level|^w$|^l$|^\(\d{3}\)|^email$|^vs$|,\s[A-Z]{2}$|\b(DAZN|WOAI|KXTN|AZFS|3TV|NBCS\w*|PCK)\b|^nbc sports|^nbc$|tickets\? start', q, re.I): continue
            if re.search(r'suite rentals|^\d{2,4}(\.\d)? |\b\d{2,3}\.\d\b|\+$|\b(KSBI|KFAA|KUNP|GCSEN|CHSN|WCCO|WWLS|BlazerVision|MavsTV|FanDuel Sports|Bally)\b| @$|^learn more$', q, re.I): continue
            q = re.sub(r'presented by$', '', q, flags=re.I).strip(' —-')
            if not q or q.lower() in ('at', 'vs'): continue
            if len(q) > 110: q = q[:107] + '…'
            if first: lead = q
            elif q.lower() not in [k.lower() for k in keep]: keep.append(q)
        if tri in ('MIA', 'ORL', 'TOR'):  # the title stands before its date; a line's last part is the next card's title
            title = carry if (carry and not (lead and not re.match(r'presented by', lead, re.I))) else lead
            if lead and re.match(r'presented by', lead, re.I): title = carry or lead
            if tri == 'ORL': title = lead or carry
            nxt = keep[-1] if (keep and tri != 'ORL' and len(keep[-1]) < 60) else None
            body = [k for k in keep if k != nxt]
            text = ' — '.join([x for x in [title] + [b for b in body if len(b) > 0][:1] if x]); carry = nxt
        else:
            ks = keep[:1] if tri == 'WAS' else keep[:4]
            ks = [k for i, k in enumerate(ks) if not any(k.lower().rstrip(' on') in o.lower() and len(o) > len(k) for o in ks)]
            text = ' / '.join(([lead] if lead and tri in ('DEN', 'LAL', 'SAC') else []) + ks)
        if tri == 'MIL' or (tri == 'UTA' and 'cup' not in text.lower()): continue
        if away and tri in ('BOS', 'BKN', 'UTA', 'SAC') and not keep: continue
        text = re.sub(r'\s+—\s+at$', '', text).strip()
        if not text.strip() or date < '2026-11-18': continue
        rows.append([date, tri, opp or '', text, path])
# one row per team, date and text
seen = set(); out = []
for r in sorted(rows):
    k = (r[0], r[1], r[3].lower())
    if k in seen: continue
    seen.add(k); out.append(r)
COMMON = re.compile(r'heritage|pride|kids|family|military|veteran|first responder|fan appreciation|opening night|home opener|nba cup|cup night|holiday|christmas|new year|mlk|black history|black excellence|hbcu|women|hispanic|noche|latin|lunar|asian|aapi|jewish|faith|education|teacher|student|college|university|school|health|cancer|autism|mental|sustain|green|earth|city edition|statement edition|classic edition|bobblehead|t-shirt|tee|poster|hat|beanie|giveaway|presented by|scout|youth|jr\.|seats for|hospital|community|inclusion|unity|small business|group|gospel|greek', re.I)
ROUGH = {'GSW': 'rough: a giveaway may sit one game off', 'LAL': 'rough: two cards can share a line', 'DEN': 'rough: two cards can share a line', 'BKN': 'rough', 'SAC': 'rough', 'PHI': 'rough', 'IND': 'rough', 'CHA': 'rough: most nights missed', 'UTA': 'Cup games only'}
for r in out:
    sponsor = r[1] == 'ATL' and not re.search(r'night|day|game|single|forever|courage|atlanta', r[3], re.I)
    r.insert(4, 'sponsor only' if sponsor else '' if COMMON.search(r[3]) else 'look'); r.insert(5, ROUGH.get(r[1], 'good'))
json.dump(out, open('rows.json', 'w'))
w = csv.writer(open('rows.tsv', 'w', newline=''), delimiter='\t'); w.writerow(['date', 'team', 'opponent', 'night', 'flag', 'read', 'page']); w.writerows(out)
import collections
c = collections.Counter(r[1] for r in out); print(len(out), 'rows;', dict(sorted(c.items())))
print(sum(1 for r in out if r[4]), 'flagged')
