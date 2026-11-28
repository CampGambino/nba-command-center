// The site's menu (0.147.0, the redesign the user accepted 11/24): six menus in place of 13 tabs, with every section
// of every page listed under one of them (the mockup's "where every section lives"; nothing is removed), and a search
// box that opens the Index with the words typed. Each page keeps its old tab row as a fallback; it is hidden once this runs.
(() => {
const MENUS = [
  ["Tonight", [
    ["Tonight's games and the Spotlight", "./", "Tonight"],
    ["Everything else, ranked", "./#stream", "Tonight"],
    ["Storylines by game", "./#storylines", "Tonight"],
    ["Matchups tonight", "./#matchups", "Tonight"],
    ["History in tonight's notes", "./#history", "Tonight"],
    ["Milestones: likely tonight, coming up", "./#likely", "Tonight"],
    ["Record chases tonight", "records.html", "Records"],
    ["Odd lines to watch tonight", "trends.html#odd", "Streaks"],
    ["Tonight's matchups (situations)", "situations.html", "Situations"],
  ]],
  ["Storylines", [
    ["Odd lines and outlier games", "trends.html#odd", "Streaks"],
    ["Active player streaks, streak watch", "trends.html#watch", "Streaks"],
    ["Team streaks", "trends.html", "Streaks"],
    ["Hot and cold", "trends.html#form", "Streaks"],
    ["Shifts: slumps and hot stretches", "trends.html#shifts", "Streaks"],
    ["Splits: quarters, halves, clutch, situations", "trends.html#splits", "Streaks"],
    ["Most unusual records", "situations.html", "Situations"],
  ]],
  ["Players", [
    ["One player: everything on him", "player.html", "Player"],
    ["Clutch: players", "clutch.html", "Clutch"],
    ["4th quarter · final two minutes", "clutch.html?mode=q4", "Clutch"],
    ["With / without · last N games", "players.html", "With / without"],
    ["One player with / without another", "players.html?a=", "With / without"],
    ["Lineups: 2- to 5-man units", "lineups.html", "Lineups"],
    ["Hustle stats: deflections, charges, contests", "lineups.html#hustle", "Lineups"],
    ["Team leaders: categories led, 50-40-90", "leaders.html", "Leaders"],
    ["Players vs top-5 defenses", "defenses.html?view=players", "vs top teams"],
    ["National TV vs League Pass", "national.html", "National TV"],
    ["Award eligibility (65 games)", "awards.html", "Awards"],
  ]],
  ["Teams", [
    ["Standings and magic numbers", "standings.html#standings", "Standings"],
    ["Rest and back-to-backs", "standings.html#rest", "Standings"],
    ["Team situations: all teams", "situations.html", "Situations"],
    ["Lineups: a team's best and worst units", "lineups.html", "Lineups"],
    ["Clutch and 4th quarter: teams", "clutch.html", "Clutch"],
    ["vs top teams", "defenses.html", "vs top teams"],
    ["30-point games allowed · scoring by type", "defenses.html?view=thirty", "vs top teams"],
    ["Team leaders, season totals", "leaders.html", "Leaders"],
    ["Record on national TV, by network", "national.html", "National TV"],
  ]],
  ["Records", [
    ["Tonight's record chases", "records.html", "Records"],
    ["Within reach · headliners", "records.html#reach", "Records"],
    ["All-time lists", "records.html#lists", "Records"],
    ["Franchise history and records", "records.html#franchise", "Records"],
    ["This season vs his career · title races", "records.html#season", "Records"],
    ["NBA Cup", "records.html#cup", "Records"],
    ["Record book and checks", "records.html#book", "Records"],
    ["Career highs allowed", "defenses.html?view=highs", "vs top teams"],
  ]],
  ["Explore", [
    ["Game Flow: a single game", "gameflow.html", "Game Flow"],
    ["Season rotation", "gameflow.html?view=season", "Game Flow"],
    ["Assist network", "gameflow.html?view=board", "Game Flow"],
    ["Scoring highs", "gameflow.html?view=highs", "Game Flow"],
    ["Three-point range", "gameflow.html?view=range", "Game Flow"],
    ["Leads and comebacks", "gameflow.html?view=streaks", "Game Flow"],
    ["On / off court", "gameflow.html?view=splits", "Game Flow"],
    ["Every table on the site (Index)", "find.html", "Index"],
  ]],
];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const here = (location.pathname.split("/").pop() || "index.html").replace(/^$/, "index.html");
const pageOf = (href) => (href.split(/[?#]/)[0].replace(/^\.\/?$/, "index.html") || "index.html");

function draw() {
  const old = document.querySelector("header nav:not(.tabs), nav.ccnav");
  if (!old || document.querySelector(".cc-bar")) return;
  if (!document.querySelector('link[href*="Space+Grotesk"]')) {
    const f = document.createElement("link");
    f.rel = "stylesheet"; f.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@600;700&display=swap";
    document.head.appendChild(f);
  }
  const bar = document.createElement("div");
  bar.className = "cc-bar";
  const groups = MENUS.map(([name, items], gi) => {
    const on = gi === 0 ? here === "index.html" : items.some(([, href]) => pageOf(href) === here);
    return `<div class="cc-menu" data-g="${gi}"><button type="button" aria-expanded="false" class="${on ? "on" : ""}">${esc(name)} ▾</button>`
      + `<div class="cc-drop" role="menu">${items.map(([l, h, tab]) => `<a role="menuitem" href="${esc(h)}" class="${pageOf(h) === here ? "here" : ""}">${esc(l)}<small>${esc(tab)}</small></a>`).join("")}</div></div>`;
  }).join("");
  bar.innerHTML = `<div class="in"><a class="cc-brand" href="./"><i><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg></i>Command Center</a>`
    + `<nav class="cc-menus" aria-label="Main">${groups}</nav>`
    + `<form class="cc-search" role="search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5b6672" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`
    + `<input type="search" name="q" aria-label="Search" placeholder="Search every page and table" autocomplete="off"></form></div>`;
  document.body.insertBefore(bar, document.body.firstChild);
  old.classList.add("cc-old");
  document.body.classList.add("cc-on");
  const close = () => bar.querySelectorAll(".cc-menu.open").forEach((m) => { m.classList.remove("open"); m.querySelector("button")?.setAttribute("aria-expanded", "false"); });
  bar.querySelectorAll(".cc-menu > button").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const m = b.parentElement, was = m.classList.contains("open");
    close();
    if (!was) { m.classList.add("open"); b.setAttribute("aria-expanded", "true"); }
  }));
  document.addEventListener("click", (e) => { if (!bar.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  bar.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = bar.querySelector("input").value.trim();
    location.href = `find.html${q ? `?q=${encodeURIComponent(q)}` : ""}`;
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", draw); else draw();
})();
