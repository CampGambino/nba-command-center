// ESPN's scoreboard for every date the archive needs (0.149.0; the scoreboards the archive was first built from were
// scratch and are gone). One file a date in /home/claude/work/ls: { events: [{ id, type, done }] }. Regular season only
// is used downstream (type 2). Months October to May, 1993-94 to 2025-26, plus the 2020 summer restart.
//   NODE_USE_ENV_PROXY=1 node tools/odd-games/fetch-boards.mjs [first-year] [last-year]
import fs from "node:fs"; import path from "node:path";
const OUT = "/home/claude/work/ls", A = +(process.argv[2] || 1993), B = +(process.argv[3] || 2025);
fs.mkdirSync(OUT, { recursive: true });
const dates = [];
for (let y = A; y <= B; y++) for (let t = Date.UTC(y, 9, 1); t <= Date.UTC(y + 1, 4, 31); t += 864e5) dates.push(new Date(t).toISOString().slice(0, 10));
for (let t = Date.UTC(2020, 6, 1); t <= Date.UTC(2020, 7, 31); t += 864e5) dates.push(new Date(t).toISOString().slice(0, 10));
const todo = dates.filter((d) => !fs.existsSync(path.join(OUT, `ls-${d}.json`)));
let next = 0, done = 0, failed = 0;
async function one(d) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d.replace(/-/g, "")}&limit=100`, { headers: { "user-agent": "Mozilla/5.0 nba-command-center" } });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      const events = (j.events || []).map((e) => ({ id: e.id, type: e.season?.type ?? null, done: !!e.status?.type?.completed }));
      fs.writeFileSync(path.join(OUT, `ls-${d}.json`), JSON.stringify({ events })); done++; return;
    } catch { await new Promise((r) => setTimeout(r, 800 * (k + 1))); }
  }
  failed++;
}
await Promise.all(Array.from({ length: 12 }, async () => { while (next < todo.length) await one(todo[next++]); }));
console.log(dates.length, "dates;", done, "fetched;", failed, "failed");
