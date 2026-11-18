#!/usr/bin/env python3
"""Promotion nights, second build (11/18/26 afternoon).

  python3 -I build2.py <raw sweep json> <league schedule json> <out csv> <typed file> [<typed file> ...]

Why a second build: the morning build (promos-build.py) split each page into lines at every date and
guessed which words went with which date. On several pages the title stands BEFORE its date, so the
guess paired a title with the game before it (Celtics, Bulls, Nuggets, Lakers, parts of others).
This build has one reader per page layout, and every row has to pass two checks before it is written:
  1. the date is a home game for that team in the league schedule (ESPN's schedule, fetched by sched.mjs);
  2. where the page prints an opponent, it is the schedule's opponent for that date.
Rows that fail are printed and left out. Typed rows (the files given last) are also searched for in
the raw sweep: the longest word of each part must stand in the raw line of that date or the line before.
"""
import csv, json, re, sys, collections

RAW, SCHED, OUT, TYPED = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
pages = json.load(open(RAW))['pages']
ESPN = {'GS': 'GSW', 'NO': 'NOP', 'NY': 'NYK', 'SA': 'SAS', 'UTAH': 'UTA', 'WSH': 'WAS'}
home = collections.defaultdict(dict)
for t, games in json.load(open(SCHED)).items():
    for g in games:
        h = ESPN.get(g['home'], g['home'])
        home[h][g['d']] = (ESPN.get(g['away'], g['away']), g['awayName'])
MON = {m: i + 1 for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}
DATE = re.compile(r'\b(jan|feb|mar|apr|oct|nov|dec)[a-z]*\.?,?\s+(\d{1,2})(?:st|nd|rd|th)?\b', re.I)
FROM = '2026-11-18'


def iso(mo, day):
    m = MON[mo[:3].lower()]
    return f"{2026 if m >= 8 else 2027}-{m:02d}-{int(day):02d}"


def d_of(s):
    m = DATE.search(s)
    return iso(m.group(1), m.group(2)) if m else None


def parts(line):
    return [p.strip() for p in line.lstrip('<').split(' | ')]


def br(p):
    return p.startswith('[') and p.endswith(']')


rows = []            # team, date, night, page opponent (or ''), how it was read


def add(team, date, night, opp='', how=''):
    if date and date >= FROM and night.strip():
        rows.append([team, date, re.sub(r'\s+', ' ', night).strip(), opp, how])


READ1 = 'read once by script; the page repeats the title beside the date (picture label, description or opponent)'

# ---- ATL: schedule page, each game's own row: "Nov 20: Cup Nights | [sponsor]"
for ln in pages['/hawks/schedule']:
    d = d_of(ln); ps = parts(ln.split(': ', 1)[1])
    names = [p for p in ps if not br(p)]
    spons = [p.strip('[]') for p in ps if br(p) and p != '[Peachtree TV]']
    if names: add('ATL', d, ' / '.join(names) + (f" (sponsor: {', '.join(spons)})" if spons else ''), how='read once by script; anchors: Cup night 11/20 and MLK Forever on MLK Day match')
    elif spons: add('ATL', d, 'sponsor: ' + ', '.join(spons), how='read once by script; sponsor only')

# ---- BKN: schedule page, each game's own row with its arena
for ln in pages['/nets/schedule']:
    if '?:' in ln[:16] or 'Barclays Center @' not in ln: continue
    d = d_of(ln); ps = parts(ln.split(': ', 1)[1])
    keep = [p for p in ps if not br(p) and not re.match(r'(Barclays Center|Luxury Suites|GAMEDAY|Full Arena)', p)]
    fans = [p for p in keep if re.match(r'First [\d,]+ Fans', p)]
    keep = [p for p in keep if p not in fans]
    txt = ' / '.join(re.sub(r'^Presented By', 'sponsor:', p) for p in keep)
    if fans and txt: txt += f" ({fans[0].lower()})"
    add('BKN', d, txt, how='read once by script; anchors: Cup games 11/20, 11/25, 11/27 match the Cup schedule')

# ---- IND: "<Opp | Wed, Nov 18 • | description | [picture] | NEXT title | [next opponent]"
ind = collections.OrderedDict(); prev_title = None; ind_named = ind_all = 0
for ln in pages['/pacers/tickets/theme-nights']:
    ps = parts(ln); d = d_of(ps[1]); desc = ps[2]
    title = prev_title or re.search(r' to (.+?)!', desc).group(1)      # the first card is named only in its own description
    # check: the description names the night (a shared word), or says "University Night" for a college
    ind_all += 1
    if set(re.findall(r'[a-z]{5,}', title.lower())) & set(re.findall(r'[a-z]{5,}', desc.lower())) or 'university night' in desc.lower(): ind_named += 1
    ind.setdefault((d, ps[0]), []).append(title)
    prev_title = ps[4] if len(ps) > 4 else None
assert ind_named >= ind_all - 4, ('IND: too few descriptions name their night', ind_named, ind_all)
for (d, opp), ts in ind.items():
    uni = [t for t in ts if re.search(r'Universit|College|IU Indianapolis', t)]
    oth = [t for t in ts if t not in uni]
    txt = ' / '.join(oth + (['University Night: ' + ', '.join(uni)] if uni else []))
    add('IND', d, txt, opp, READ1)

# ---- LAC: "<[picture] | Fri, Nov 27 · 6:30 PM | vs. Opp | Title | description"
lac = collections.OrderedDict()
for ln in pages['/clippers/promotions-giveaways']:
    ps = parts(ln); d = d_of(ps[1])
    lac.setdefault((d, ps[2].replace('vs. ', '')), []).append(ps[3])
for (d, opp), ts in lac.items(): add('LAC', d, ' / '.join(ts), opp, READ1)

# ---- MIA: title stands before its date; a line's last part is the next card's title
carry = None
for ln in pages['/heat/tickets/theme-nights']:
    ps = parts(ln)
    title = ps[0] if ln.startswith('<') else carry
    if title.endswith('Fun Pack'): continue                 # a ticket bundle, not a night
    i = next(k for k, p in enumerate(ps) if DATE.search(p)); d = d_of(ps[i])
    add('MIA', d, title, how=READ1)
    carry = ps[-1] if not br(ps[-1]) and len(ps[-1]) < 45 else None

# ---- MIN: "<Category | Thursday, November 19 | | | 7 PM | vs. NYK | Title | extras"
mn = collections.OrderedDict()
for ln in pages['/timberwolves/promotions']:
    ps = [p for p in parts(ln) if p]
    cat = ps[0] if ln.startswith('<') else 'Giveaway'
    i = next(k for k, p in enumerate(ps) if DATE.search(p)); d = d_of(ps[i])
    j = next(k for k, p in enumerate(ps) if p.startswith('vs. '))
    title = ps[j + 1]; extra = [p for p in ps[j + 2:] if not br(p) and not re.match(r'Special Ticket', p)]
    label = {'Celebration': '', 'Ticket Package': 'Ticket package: ', 'Giveaway': 'Giveaway: '}[cat]
    txt = label + title + (' (' + ', '.join(e[0].lower() + e[1:].replace(' By ', ' by ').replace(' Fans', ' fans') for e in extra) + ')' if extra else '')
    mn.setdefault((d, ps[j][4:]), [])
    if txt not in mn[(d, ps[j][4:])]: mn[(d, ps[j][4:])].append(txt)
for (d, opp), ts in mn.items():
    ts.sort(key=lambda t: (t.startswith('Ticket package'), t.startswith('Giveaway')))
    add('MIN', d, ' / '.join(ts), opp, READ1)

# ---- NOP: "<WED | DEC 2 | vs Lakers | (Happy Hour |) Title | description | +1 more"
for ln in pages['/pelicans/promotional-calendar']:
    ps = parts(ln); d = d_of(ps[1]); opp = ps[2].replace('vs ', '')
    rest = ps[3:]; hh = rest[0] == 'Happy Hour'
    title = rest[1] if hh else rest[0]
    add('NOP', d, title + (' / Happy Hour' if hh else ''), opp, READ1)

# ---- ORL: "<Title | Sunday, December 27 at 6:00 PM | [Opp] | Opp | [picture] | (next title)"
carry = None
for ln in pages['/magic/theme-nights']:
    ps = parts(ln)
    title = ps[0] if ln.startswith('<') else carry
    i = next(k for k, p in enumerate(ps) if DATE.search(p)); d = d_of(ps[i]); opp = ps[i + 2]
    pic = set(re.findall(r'[a-z0-9]{3,}', ps[i + 3].lower())); tw = set(re.findall(r'[a-z0-9]{3,}', title.lower().replace('womens', 'women').replace('’', '')))
    if d >= FROM: assert pic & tw or ('india' in title.lower() and 'india' in pic) or 'womens' in pic, ('ORL picture label does not match its title', title, ps[i + 3])
    add('ORL', d, re.sub(r'presented by$', '', title).strip(), opp, READ1)
    carry = ps[-1] if not br(ps[-1]) and not ps[-1].startswith('*') else None

# ---- PHI: "<x | Mon, Nov 23| | Title | vs. Opp | description"
phi = collections.OrderedDict()
for ln in pages['/sixers/tickets/theme-nights']:
    ps = [p for p in parts(ln) if p]
    k = next((k for k, p in enumerate(ps) if re.match(r'(Mon|Tue|Tues|Wed|Thu|Thurs|Fri|Sat|Sun), ', p)), None)
    if k is None:
        m = re.search(r'On (\w+ \d+) vs\. \w+, all fans in attendance will receive (?:an? )?(.+?) courtesy', ' '.join(ps))
        if m and d_of(m.group(1)) >= FROM:      # a giveaway sentence that belongs to the card of that date
            key = next(k2 for k2 in phi if k2[0] == d_of(m.group(1)))
            phi[key].append('Giveaway: ' + m.group(2).strip() + ', all fans')
        continue
    d = d_of(ps[k])
    if d < FROM: continue
    title = ps[k + 1]; opp = ps[k + 2].replace('vs. ', '').replace('Grizlies', 'Grizzlies')
    give = [p for p in ps[k + 3:] if re.search(r'will receive', p)]
    phi.setdefault((d, opp), []).append(title)
    for g in give:
        g = re.sub(r'^.*?will receive (an? |limited edition )?', '', g).rstrip('.')
        g = re.split(r' when they visit|, presented by| with artwork', g)[0]
        phi[(d, opp)].append('Giveaway: ' + g)
for (d, opp), ts in phi.items(): add('PHI', d, ' / '.join(ts), opp, READ1)

# ---- WAS: "SAT. NOV. 28 VS. ORL | Title | ..." (the page repeats cards by category)
was = collections.OrderedDict()
for ln in pages['/wizards/promotions']:
    ps = parts(ln); k = next(k for k, p in enumerate(ps) if ' VS. ' in p and DATE.search(p))
    d = d_of(ps[k].replace('MARCH', 'MAR').replace('APRIL', 'APR')); opp = ps[k].split(' VS. ')[1]
    was.setdefault((d, opp), [])
    if ps[k + 1] not in was[(d, opp)]: was[(d, opp)].append(ps[k + 1])
for (d, opp), ts in was.items():
    uni = [t for t in ts if re.search(r'Universit', t)]; her = [t for t in ts if t.endswith(' Heritage')]
    oth = [t for t in ts if t not in uni and t not in her]
    txt = ' / '.join(oth + (['Heritage: ' + ', '.join(h[:-9] for h in her)] if her else []) + (['College night: ' + ', '.join(uni)] if uni else []))
    add('WAS', d, txt, opp, READ1)

n_script = len(rows)

# ---- typed files
HOW = {'BOS': 'read twice (two readers agree)', 'CHI': 'read twice (two readers agree)', 'DEN': 'read twice (two readers agree)',
       'GSW': 'read twice (two readers agree)', 'LAL': 'read twice (two readers agree)', 'TOR': 'read twice (two readers agree)',
       'CLE': 'read twice (two readers agree)', 'PHX': 'read twice (giveaways page); theme page read once',
       'SAC': 'read once; the page order (date, opponent, label) confirmed in a second look',
       'UTA': 'read once; matches the Cup schedule', 'CHA': "from each picture's file name; the page shows the names only inside pictures",
       'DAL': 'read once; typed rows compared again with the stored page text', 'MEM': 'read once; typed rows compared again with the stored page text',
       'POR': 'read once; typed rows compared again with the stored page text', 'SAS': 'read once; typed rows compared again with the stored page text',
       'MIL': 'read once; typed rows compared again with the stored page text',
       'DET': 'read once and typed; not read a second time', 'HOU': 'read once and typed; the page would not load for a second reading'}
typed = []
for f in TYPED:
    for ln in open(f, encoding='utf-8'):
        ln = ln.rstrip('\n')
        if not ln.strip() or ln.startswith('#'): continue
        ps = [p.strip() for p in ln.split(' | ')]
        if len(ps) == 4: team, md, opp, night = ps
        elif len(ps) == 3: (team, md, night), opp = ps, ''
        else: sys.exit('bad typed line: ' + ln)
        typed.append((team, d_of(md), night, opp, f))
        add(team, d_of(md), night.replace('*', ''), opp, HOW[team])

# ---- cross-check typed rows of the second-reading file against the raw sweep
RAWPAGES = {'BOS': ['/celtics/schedule'], 'CHI': ['/bulls/tickets/promotional-schedule'], 'DEN': ['/nuggets/promotional-schedule'],
            'GSW': ['/warriors/tickets/promotions', '/warriors/schedule'], 'LAL': ['/lakers/promo-nights-and-giveaways'], 'TOR': ['/raptors/theme-nights'],
            'PHX': ['/suns/promotions/theme-nights/', '/suns/promotions/giveaways/'], 'SAC': ['/kings/schedule'], 'UTA': ['/jazz/schedule']}
miss = []; nchk = 0; nskip = 0
for team, d, night, opp, f in typed:
    if team not in RAWPAGES: continue
    for part in night.split(' / '):
        if '*' in part or part.startswith('sponsor:') and team == 'CHI': nskip += 1; continue
        core = re.sub(r'\(.*?\)', '', part); core = re.sub(r'^(Giveaway|League of Stars Night|Bobblehead Night|Fanduel Giveaway):', '', core)
        words = re.findall(r"[a-z0-9']{4,}", core.lower().replace('’', "'")) or re.findall(r'[a-z0-9]+', core.lower())
        tok = max(words, key=len)
        hit = False
        for p in RAWPAGES[team]:
            lines = pages[p]
            for i, ln in enumerate(lines):
                if d_of(ln) != d and not (DATE.search(ln) and iso(*DATE.search(ln).groups()) == d): continue
                near = (lines[i - 1] if i else '') + ' ' + ln + ' ' + (lines[i + 1] if i + 1 < len(lines) and not DATE.match(lines[i + 1].lstrip('<')) else '')
                if tok in near.lower().replace('’', "'"): hit = True
        nchk += 1
        if not hit: miss.append((team, d, part, tok))

# ---- schedule checks, opponent names from the schedule
NICK = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())
out = []; bad = []
for team, d, night, opp, how in rows:
    g = home[team].get(d)
    if not g:
        if team == 'MIN' and d == '2026-12-04':
            out.append([d, team, 'TBD', night + ' (only if Minnesota hosts a Cup quarterfinal)', how]); continue
        bad.append(('not a home game', team, d, night)); continue
    tri, name = g
    if opp:
        o = NICK(opp); n = NICK(name)
        if not (o in n or n in o or NICK(name.split()[-1]) in o or o == NICK(tri) or o in ('cavs',) and tri == 'CLE'):
            bad.append((f'page says {opp}, schedule says {name}', team, d, night)); continue
    out.append([d, team, name, night, how])

# drop ticket-bundle names; a row left with nothing is dropped
OFFER = re.compile(r'^(.*(Fun Pack|Value Plan|\d-\d Plan|Mini Plan|Anniversary Plan)|\+\d+ more)$')
final = []
for d, team, name, night, how in out:
    ps = [p for p in night.split(' / ') if not OFFER.match(p.strip())]
    if not ps: continue
    final.append([d, team, ' / '.join(ps), name, how])
# one row per team and date
seen = {}
for r in sorted(final):
    k = (r[0], r[1])
    if k in seen: seen[k][2] += ' / ' + r[2]
    else: seen[k] = r
final = sorted(seen.values())

COMMON = re.compile(r'heritage|pride|kids|family|funday|military|veteran|first responder|fan appreciation|appreciation night|opening night|home opener|nba cup|cup night|cup game|\bcup\b|holiday|christmas|new year|mlk|martin luther king|black history|black excellence|black heritage|hbcu|women|hispanic|noche|latin|lunar|asian|aapi|jewish|faith|education|educator|teacher|student|college|university|school|health|cancer|autism|mental|sustain|green|earth|city edition|statement edition|classic edition|bobblehead|t-shirt|tee\b|poster|\bhat\b|beanie|giveaway|presented by|scout|youth|jr\.|seats for|hospital|community|inclusion|unity|small business|group|gospel|greek|stem|happy hour|sponsor:', re.I)
with open(OUT, 'w', newline='', encoding='utf-8') as fh:
    w = csv.writer(fh); w.writerow(['Date', 'Team', 'Night', 'Flag', 'Opponent', 'How it was read and checked'])
    for d, team, night, name, how in final:
        flag = 'sponsor only' if night.startswith('sponsor:') and ' / ' not in night else 'name not readable' if 'not readable' in night or 'no name' in night or 'no description' in night else '' if not re.sub(COMMON, '', night) or all(COMMON.search(p) for p in night.split(' / ')) else 'look'
        w.writerow([d, team, night, flag, name, how + '; home date' + ('' if name == 'TBD' else ' and opponent') + ' match the league schedule'])

c = collections.Counter(r[1] for r in final)
print(len(final), 'rows,', len(c), 'teams;', n_script, 'script rows before grouping;', len(typed), 'typed rows')
print(' '.join(f'{t} {c[t]}' for t in sorted(c)))
print('\nfailed the schedule check and left out:', len(bad))
for b in bad: print('  ', b)
print(f'\ntyped rows searched for in the raw sweep: {nchk} parts, {nskip} skipped (second reading only), {len(miss)} not found')
for m in miss: print('  ', m)
