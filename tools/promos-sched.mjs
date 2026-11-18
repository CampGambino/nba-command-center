// Fetch each team's 2026-27 schedule from ESPN (site API) and write home games by ET date.
import fs from "node:fs";
const out = process.argv[2];
const teams = await (await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=40")).json();
const list = teams.sports[0].leagues[0].teams.map(t => t.team);
const all = {};
for (const t of list) {
  for (const st of [2]) {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${t.id}/schedule?season=2027&seasontype=${st}`);
    const j = await r.json();
    const rows = [];
    for (const e of j.events || []) {
      const c = e.competitions[0];
      const home = c.competitors.find(x => x.homeAway === "home"), away = c.competitors.find(x => x.homeAway === "away");
      const et = new Date(e.date).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      rows.push({ d: et, utc: e.date, home: home.team.abbreviation, away: away.team.abbreviation, awayName: away.team.displayName, homeName: home.team.displayName, neutral: !!c.neutralSite, venue: c.venue?.fullName || "", tbd: !!c.timeValid === false });
    }
    all[t.abbreviation] = rows;
  }
  process.stderr.write(t.abbreviation + " " + all[t.abbreviation].length + "\n");
}
fs.writeFileSync(out, JSON.stringify(all));
