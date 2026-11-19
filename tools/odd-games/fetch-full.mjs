// Every player's whole box-score line, for the odd-games study (0.116). One file a game in /home/claude/work/full.
//   NODE_USE_ENV_PROXY=1 node fetch-full.mjs [seconds]
import fs from "node:fs"; import path from "node:path";
const BOARDS = "/home/claude/work/ls", DIR = "/home/claude/work/full", STOP = Date.now() + (+(process.argv[2] || 540)) * 1000;
const ids = [];
for (const f of fs.readdirSync(BOARDS).filter((x) => /^ls-\d{4}-\d\d-\d\d\.json$/.test(x)).sort()) {
  const d = f.slice(3, 13);
  for (const e of JSON.parse(fs.readFileSync(path.join(BOARDS, f), "utf8")).events || []) if (e.type === 2 && e.done !== false) ids.push([e.id, d]);
}
const todo = ids.filter(([id]) => !fs.existsSync(path.join(DIR, `f-${id}.json`)));
console.log(ids.length, "games;", todo.length, "to fetch");
const KEYS = { min: /^minutes$/, pts: /^points$/, fg: /^fieldGoalsMade-fieldGoalsAttempted$/, fg3: /^threePointFieldGoalsMade-threePointFieldGoalsAttempted$/, ft: /^freeThrowsMade-freeThrowsAttempted$/, oreb: /^offensiveRebounds$/, dreb: /^defensiveRebounds$/, reb: /^rebounds$/, ast: /^assists$/, stl: /^steals$/, blk: /^blocks$/, tov: /^turnovers$/, pf: /^fouls$/, pm: /^plusMinus$/ };
const n = (s) => (s == null || s === "" || s === "--" ? null : +s);
let done = 0, failed = 0, next = 0;
async function one([id, d]) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`, { headers: { "user-agent": "Mozilla/5.0 nba-command-center" } });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json(), out = [];
      for (const t of j.boxscore?.players || []) {
        const st = t.statistics?.[0]; if (!st) continue;
        const K = st.keys || [], I = Object.fromEntries(Object.entries(KEYS).map(([k2, re]) => [k2, K.findIndex((x) => re.test(x))]));
        const rows = [];
        for (const a of st.athletes || []) {
          if (!a.stats?.length) continue;
          const v = (k2) => (I[k2] < 0 ? null : a.stats[I[k2]]), pair = (k2) => { const s = v(k2); if (s == null || !/^\d+-\d+$/.test(s)) return [null, null]; return s.split("-").map(Number); };
          const [fgm, fga] = pair("fg"), [t3m, t3a] = pair("fg3"), [ftm, fta] = pair("ft");
          rows.push([a.athlete?.id, a.athlete?.displayName, a.athlete?.position?.abbreviation || null, a.starter ? 1 : 0, n(v("min")), n(v("pts")), fgm, fga, t3m, t3a, ftm, fta, n(v("oreb")), n(v("dreb")), n(v("reb")), n(v("ast")), n(v("stl")), n(v("blk")), n(v("tov")), n(v("pf")), n(String(v("pm") ?? "").replace("+", ""))]);
        }
        const comp = (j.header?.competitions?.[0]?.competitors || []).find((c) => c.team?.id === t.team?.id);
        out.push({ t: t.team?.abbreviation, home: comp?.homeAway === "home" ? 1 : 0, s: comp ? +comp.score : null, p: rows });
      }
      fs.writeFileSync(path.join(DIR, `f-${id}.json`), JSON.stringify({ d, t: out })); done++; return;
    } catch { await new Promise((r) => setTimeout(r, 700 * (k + 1))); }
  }
  failed++;
}
await Promise.all(Array.from({ length: 14 }, async () => { while (next < todo.length && Date.now() < STOP) await one(todo[next++]); }));
console.log("fetched", done, "failed", failed, "left", todo.length - done);
