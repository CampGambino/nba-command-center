/**
 * Clutch-time player lines from an ESPN play-by-play (browser-safe, pure).
 *
 * Clutch time: the last 5:00 of the 4th quarter or any overtime, while the
 * score is within 5 (the NBA's definition). The score is rebuilt from scoring
 * plays (team and points), not read from each play's score fields, which ESPN
 * sometimes gets wrong mid-game.
 *
 * Per player: [sec, pts, fgm, fga, fg3m, fg3a, ftm, fta, reb, ast, tov, stl, blk, pm]
 *   sec = seconds on court in clutch time, pm = plus/minus in clutch time.
 *
 * Who is on court is inferred, since ESPN gives starters only for the opening
 * tip: a player is on court at the start of a period if his first event in it
 * is anything but entering the game (so a player who is subbed out, or records
 * any stat, before being subbed in was on from the start). Substitutions then
 * move players on and off. A player who plays a whole period without a single
 * event is missed, and the line count per team is checked: when a team doesn't
 * have exactly 5 on court in clutch time, `lineupOk` is false and minutes and
 * plus/minus for that game should not be trusted (counting stats still are).
 */
export const CLUTCH_KEYS = ["sec", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "reb", "ast", "tov", "stl", "blk", "pm"];
const K = Object.fromEntries(CLUTCH_KEYS.map((k, i) => [k, i]));

export function clockSec(s) {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const m = t.match(/^(\d+):(\d{1,2})(?:\.\d+)?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const isSub = (p) => /substitution/i.test(p?.type?.text || "") || / enters the game for /i.test(p?.text || "");
const ids = (p) => (p?.participants || []).map((x) => String(x?.athlete?.id ?? "")).filter(Boolean);

/** Players on court at the start of each period, inferred from the period's own events. */
function startersByPeriod(plays, teamOf) {
  const out = {};
  const seen = {};
  for (const p of plays) {
    const per = p?.period?.number ?? 0;
    out[per] ??= new Set();
    seen[per] ??= new Set();
    const who = ids(p);
    if (isSub(p)) {
      const [inId, outId] = who;
      if (outId && !seen[per].has(outId)) out[per].add(outId); // left before doing anything: was on at the start
      if (inId) seen[per].add(inId);
      if (outId) seen[per].add(outId);
      continue;
    }
    for (const id of who) {
      if (!teamOf(id)) continue; // e.g. the other team's player in a jump ball is fine; unknown ids are skipped
      if (!seen[per].has(id)) { out[per].add(id); seen[per].add(id); }
    }
  }
  return out;
}

export function clutchPlayers(json, { homeId, awayId }) {
  const plays = json?.plays || [];
  // Player -> team, from the box score (ESPN team ids).
  const team = {}, names = {};
  for (const side of json?.boxscore?.players || []) {
    const tid = String(side?.team?.id ?? "");
    for (const a of side?.statistics?.[0]?.athletes || []) {
      const id = String(a?.athlete?.id ?? "");
      if (!id) continue;
      team[id] = tid;
      names[id] = a?.athlete?.displayName || null;
    }
  }
  const teamOf = (id) => team[id] || null;
  const starters = startersByPeriod(plays, teamOf);

  const lines = {};
  const line = (id) => (lines[id] ??= CLUTCH_KEYS.map(() => 0));
  let h = 0, a = 0, per = 0, clock = null, onCourt = new Set(), lineupOk = true;
  const within = () => Math.abs(h - a) <= 5;

  for (const p of plays) {
    const pPer = p?.period?.number ?? 0;
    const sec = clockSec(p?.clock?.displayValue);
    if (pPer !== per) {
      per = pPer;
      onCourt = new Set(starters[per] || []);
      clock = per >= 5 ? 300 : 720;
    }
    // Time since the previous event, counted for whoever was on court, if it was clutch time.
    if (per >= 4 && sec != null && clock != null && within()) {
      const from = Math.min(clock, 300), to = Math.max(0, sec);
      if (from > to) {
        const homeOn = [...onCourt].filter((id) => teamOf(id) === homeId).length;
        const awayOn = [...onCourt].filter((id) => teamOf(id) === awayId).length;
        if (homeOn !== 5 || awayOn !== 5) lineupOk = false;
        for (const id of onCourt) line(id)[K.sec] += from - to;
      }
    }
    if (sec != null) clock = sec;

    const clutch = per >= 4 && sec != null && sec <= 300 && within();
    const who = ids(p);
    const tid = String(p?.team?.id ?? "");
    const text = String(p?.text || "");

    if (isSub(p)) {
      const [inId, outId] = who;
      if (outId) onCourt.delete(outId);
      if (inId) onCourt.add(inId);
      continue;
    }

    const pts = p?.scoringPlay ? Number(p.scoreValue) || 0 : 0;
    if (clutch && who[0] && teamOf(who[0])) {
      const s = line(who[0]);
      const att = Number(p?.pointsAttempted) || 0;
      if (p?.shootingPlay && att >= 2) {
        s[K.fga]++;
        if (att === 3) s[K.fg3a]++;
        if (p.scoringPlay) { s[K.fgm]++; if (att === 3) s[K.fg3m]++; }
        if (p.scoringPlay && who[1] && teamOf(who[1]) === teamOf(who[0])) line(who[1])[K.ast]++;
        if (!p.scoringPlay && who[1] && / blocks /i.test(text)) line(who[1])[K.blk]++;
      } else if (p?.shootingPlay && att === 1) {
        s[K.fta]++;
        if (p.scoringPlay) s[K.ftm]++;
      } else if (/rebound/i.test(p?.type?.text || "") && !/team/i.test(p?.type?.text || "")) {
        s[K.reb]++;
      } else if (/\bturnover\b/i.test(text)) {
        s[K.tov]++;
        if (who[1] && /steals\)/i.test(text)) line(who[1])[K.stl]++;
      }
      if (pts) s[K.pts] += pts;
    }
    if (clutch && pts && (tid === homeId || tid === awayId)) {
      for (const id of onCourt) {
        const t = teamOf(id);
        if (t === tid) line(id)[K.pm] += pts;
        else if (t) line(id)[K.pm] -= pts;
      }
    }
    if (pts > 0) { if (tid === homeId) h += pts; else if (tid === awayId) a += pts; }
  }
  const players = {};
  for (const [id, s] of Object.entries(lines)) {
    if (s.every((v) => v === 0)) continue;
    players[id] = { team: team[id] === homeId ? "home" : "away", name: names[id], s: s.map((v) => Math.round(v * 10) / 10) };
  }
  return { players, lineupOk };
}
