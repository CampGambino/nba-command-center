import fs from "node:fs";
const DIR = "/home/claude/work/full", CUP = new Set(["2023-12-09", "2024-12-17", "2025-12-16"]);
const out = fs.createWriteStream("/home/claude/work/lines.csv");
out.write("gid,d,season,team,opp,home,ts,os,pid,name,pos,starter,min,pts,fgm,fga,fg3m,fg3a,ftm,fta,oreb,dreb,reb,ast,stl,blk,tov,pf,pm\n");
let games = 0, zeroed = 0, bad = 0, rows = 0; const seen = new Set();
for (const f of fs.readdirSync(DIR)) {
  const g = JSON.parse(fs.readFileSync(`${DIR}/${f}`, "utf8")), id = f.slice(2, -5);
  if (CUP.has(g.d) || g.t.length !== 2) { bad++; continue; }
  const key = `${g.d}|${g.t.map((t) => t.t).sort().join("|")}`; if (seen.has(key)) { bad++; continue; } seen.add(key);
  if (g.t.every((t) => t.p.every((p) => !p[5] && !p[14] && !p[15]))) { zeroed++; continue; }
  // only games whose players' points add up to the team's score
  if (!g.t.every((t) => t.s != null && t.p.reduce((a, p) => a + (p[5] || 0), 0) === t.s)) { bad++; continue; }
  games++;
  const y = +g.d.slice(0, 4), m = +g.d.slice(5, 7), season = m >= 8 ? y : y - 1;
  g.t.forEach((t, i) => { const o = g.t[1 - i]; for (const p of t.p) { if (!(p[4] > 0) && !p[5] && !p[18]) continue; rows++; out.write([id, g.d, season, t.t, o.t, t.home, t.s, o.s, p[0], JSON.stringify(p[1] || ""), p[2] || "", ...p.slice(3).map((v) => (v == null ? "" : v))].join(",") + "\n"); } });
}
out.end(); console.log({ games, zeroed, bad, rows });
