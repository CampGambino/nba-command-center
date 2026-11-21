/**
 * Data contracts (0.141.6): what NBA Live and the Cloudflare Worker read from the published files, checked against
 * the real files.
 *
 * NBA Live loads docs/bridge/cc-bridge.js, which reads seven files from the site. The bridge tests in tests/run.js
 * run on invented data; nothing checked that the REAL files still carry what that invented data assumes, so a
 * renamed field (as `injury.source` → `injury.from`, 0.141.2) could switch NBA Live's cards off without a sound.
 * Here the bridge itself runs on the real files in a stand-in NBA Live and must accept each of them, and every field
 * its tests depend on must be on the real items. The fields are written down in docs/DATA.md.
 *
 * The files are whatever the last build published (docs/data). On a day with no games the watch-list checks are
 * skipped and said to be.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

// The fields NBA Live's cards read (docs/DATA.md). Keep in step with the bridge and with the fixtures in tests/run.js.
export const CONTRACT = {
  "watch.json": {
    top: ["today", "teams"],
    team: ["team", "items"],
    // items the bridge takes: notes milestones (origin "notes"), not stale, with an ESPN id and a count still needed
    item: ["espnId", "player", "stat", "label", "kind", "scope", "target", "need", "importance", "pTonight", "publishable", "tracking", "review", "origin"],
  },
  "records.json": {
    top: ["today", "items"],
    // items the bridge takes: an id and kind pass / round / franchise / cup; `passing` and `rank` only on passes, and
    // `pTonight` only where a chance could be worked out, so they aren't required on every item
    item: ["id", "who", "team", "stat", "label", "kind", "need", "target", "score", "text"],
  },
  // the bridge's pre-game cards read away/home/lines; the Worker's digests (cloudflare/digest.js) also read `start`
  "tonight.json": { top: ["today", "games"], game: ["away", "home", "lines", "start"], line: ["kind", "text"] },
  // the Worker only (fetched from raw.githubusercontent.com): health alerts (cloudflare/health.js), #lineups (lineups.js)
  "health.json": { top: ["at", "steps"], step: ["step", "ok"] },
  "injuries.json": { top: ["date", "players"], player: ["team", "name", "status"] },
  "teammarks.json": { top: ["v", "teams"], v: 1 },
  "oddlive.json": { top: ["v", "t"], v: 1 },
  "linerare.json": { top: ["v", "from", "combos", "few"], v: 1 },
  // v29: career feat boards and streaks entering tonight
  "featlive.json": { top: ["v", "asOf", "through", "boards", "streaks", "teamStreaks"], v: 1 },
  "flowstats.json": { top: ["quarters", "halves", "teamQuarters"] },
};

export async function contractChecks(ok, root) {
  const D = (...p) => path.join(root, "docs", ...p);
  const read = (f) => JSON.parse(fs.readFileSync(D("data", f), "utf8"));
  const missingTop = (d, keys) => keys.filter((k) => !(k in (d || {})));

  // 1. Each file has the shape written down.
  const watch = read("watch.json"), records = read("records.json"), tonight = read("tonight.json");
  const C = CONTRACT;
  const shape = {};
  for (const f of Object.keys(C)) {
    const d = read(f), miss = missingTop(d, C[f].top);
    shape[f] = miss.length ? `missing ${miss.join(", ")}` : C[f].v != null && d.v !== C[f].v ? `v is ${d.v}, the bridge takes ${C[f].v}` : "ok";
  }
  ok(Object.values(shape).every((s) => s === "ok"), "contracts (0.141.6): each file NBA Live reads has the top-level fields the bridge needs", JSON.stringify(shape));

  const hasGames = (watch.teams || []).length > 0;
  if (!hasGames) console.log("contracts: no games on the published Watch List: the item checks are skipped");
  else {
    const taken = watch.teams.flatMap((t) => (t.items || []).filter((i) => i.origin !== "espn" && !i.stale && i.espnId && i.need != null));
    const gaps = {};
    for (const k of C["watch.json"].item) { const n = taken.filter((i) => !(k in i)).length; if (n) gaps[k] = n; }
    for (const t of watch.teams) for (const k of C["watch.json"].team) if (!(k in t)) gaps[`team.${k}`] = (gaps[`team.${k}`] || 0) + 1;
    ok(taken.length > 0 && !Object.keys(gaps).length, `contracts (0.141.6): every Watch List milestone NBA Live takes (${taken.length}) has the fields its cards read`, JSON.stringify({ taken: taken.length, gaps }));
  }
  const recTaken = (records.items || []).filter((i) => i.id && ["pass", "round", "franchise", "cup"].includes(i.kind));
  const recGaps = {};
  for (const k of C["records.json"].item) { const n = recTaken.filter((i) => !(k in i)).length; if (n) recGaps[k] = n; }
  const passNoPassing = recTaken.filter((i) => i.kind === "pass" && !i.passing).length;
  ok(recTaken.length > 0 && !Object.keys(recGaps).length && !passNoPassing, `contracts (0.141.6): every record NBA Live takes (${recTaken.length}) has the fields its cards read, and every pass names who is passed`, JSON.stringify({ taken: recTaken.length, gaps: recGaps, passNoPassing }));
  const lineGaps = (tonight.games || []).flatMap((g) => [...C["tonight.json"].game.filter((k) => !(k in g)), ...(g.lines || []).flatMap((l) => C["tonight.json"].line.filter((k) => !(k in l)))]);
  ok(!lineGaps.length, "contracts (0.141.6): tonight's storylines have the game and line fields the pre-game cards and the digests read", JSON.stringify(lineGaps.slice(0, 5)));
  const health = read("health.json"), inj = read("injuries.json");
  const wGaps = [...(health.steps || []).flatMap((x) => C["health.json"].step.filter((k) => !(k in x)).map((k) => `health.steps.${k}`)),
    ...(inj.players || []).flatMap((x) => C["injuries.json"].player.filter((k) => !(k in x)).map((k) => `injuries.players.${k}`))];
  ok(Array.isArray(health.steps) && health.steps.length > 0 && Array.isArray(inj.players) && !wGaps.length, "contracts (0.141.6): the health note and the injury list have the fields the Worker reads", JSON.stringify({ steps: health.steps?.length, players: inj.players?.length, gaps: [...new Set(wGaps)] }));

  // 2. The bridge itself accepts each real file (its own tests for "this file is usable"), in a stand-in NBA Live.
  const code = fs.readFileSync(D("bridge", "cc-bridge.js"), "utf8");
  const byName = {
    "watch.json": D("data", "watch.json"), "tonight.json": D("data", "tonight.json"), "records.json": D("data", "records.json"),
    "flowstats.json": D("data", "flowstats.json"), "teammarks.json": D("data", "teammarks.json"), "oddlive.json": D("data", "oddlive.json"),
    "nba-single-game-bests.json": D("ref", "nba-single-game-bests.json"), "version.json": D("bridge", "version.json"), "oddlines.js": D("lib", "situations", "oddlines.js"),
    "linerare.json": D("data", "linerare.json"), "linerare.js": D("lib", "situations", "linerare.js"), "featlive.json": D("data", "featlive.json"),
  };
  const asked = [];
  const fetchFn = async (u) => {
    const name = String(u).split("?")[0].split("/").pop(); asked.push(name);
    const f = byName[name];
    if (!f || !fs.existsSync(f)) return { ok: false, status: 404, json: async () => null, text: async () => null };
    const body = fs.readFileSync(f, "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
  };
  const el = { style: {}, textContent: "", classList: { add() {}, contains: () => false } };
  const ctx = {
    URLSearchParams, URL, console: { log() {}, warn() {}, error() {} }, Promise, Object, Number, String, Math, Array, Date, JSON, RegExp, Map, Set,
    location: { search: "?cc=" + encodeURIComponent("https://campgambino.github.io/nba-command-center/data/watch.json") },
    document: { readyState: "complete", getElementById: (id) => (id === "cc-bridge-note" ? el : null), createElement: () => el, body: { appendChild() {} }, querySelector: () => null },
    fetch: fetchFn, setInterval() {}, setTimeout() {}, clearTimeout() {}, addEventListener() {},
    GAMES: [], MILESTONE_LADDERS: {}, fireStory() {}, runAlertChecks() {}, activeDateYMD: () => String(watch.today || "").replace(/-/g, ""),
    fmtAlertStatLine: () => "", ALERT_STORIES: { get: () => undefined, delete() {} }, endStory() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  let crashed = null;
  try { vm.runInContext(code, ctx); } catch (e) { crashed = e.message; }
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));   // let its fetches settle
  const s = ctx.CC_BRIDGE?.state || {};
  const accepted = {
    "watch.json": !!s.data && (!hasGames || s.items.length > 0), "tonight.json": !!s.tonight, "records.json": !!s.records && s.recItems.length > 0,
    "flowstats.json": !!s.flow, "teammarks.json": !!s.teamMarks, "oddlive.json": !!s.odd, "oddlines.js": !!s.oddRules, "linerare.json": !!s.rare, "linerare.js": !!s.rareRules, "nba-single-game-bests.json": !!s.bests,
    "featlive.json": !!s.feat, "feat rules": !!s.featRules,
  };
  const errors = Object.fromEntries(Object.entries(s).filter(([k, v]) => /Error$/.test(k) && v));
  ok(!crashed && Object.values(accepted).every(Boolean) && !Object.keys(errors).length && !s.error,
    `contracts (0.141.6): the NBA Live bridge, run on the real published files, accepts every one (${s.items?.length ?? 0} milestones, ${s.recItems?.length ?? 0} records)`,
    JSON.stringify({ crashed, accepted, errors, error: s.error, asked }));
}
