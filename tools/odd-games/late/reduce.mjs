// Rebuild each player's running line from ESPN's play-by-play and take it at marks inside the last five minutes.
export const MARKS = [300, 180, 120, 60];
const Z = () => ({ pts: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0 });
const secs = (c) => { const m = /^(\d+):(\d+)(?:\.\d+)?$/.exec(c || ""); if (m) return +m[1] * 60 + +m[2]; const f = parseFloat(c); return Number.isFinite(f) ? f : null; };
export function reduce(j) {
  const P = {}, at = (id) => (P[id] ||= Z());
  const snaps = {}, types = {};
  const plays = j.plays || [];
  let lastPer = 0;
  const snap = (k) => { if (!snaps[k]) snaps[k] = JSON.parse(JSON.stringify(P)); };
  // on the floor in the 4th: who is known to be on, per the 4th's own substitutions and plays
  const q4 = { out: new Set(), in: new Set(), acted: new Set(), subs: [] };
  for (const x of plays) {
    const per = x.period?.number, s = secs(x.clock?.displayValue), ty = x.type?.text || "", text = x.text || "", ids = (x.participants || []).map((p) => String(p.athlete?.id));
    if (per === 4 && s != null) for (const m of MARKS) if (s < m || (s === m && false)) snap(m);
    if (per > 4) for (const m of MARKS) snap(m);
    lastPer = per;
    types[ty] = (types[ty] || 0) + 1;
    const a = ids[0];
    if (/Substitution/i.test(ty)) { if (per === 4) q4.subs.push({ s, in: ids[0], out: ids[1] }); continue; }
    if (per === 4 && a) q4.acted.add(`${a}|${s}`);
    if (!a) continue;
    if (/Free Throw/i.test(ty)) { const p = at(a); p.fta++; if (x.scoringPlay) { p.ftm++; p.pts++; } continue; }
    if (x.shootingPlay) {
      const p = at(a), three = x.pointsAttempted === 3 || x.scoreValue === 3 || (x.pointsAttempted == null && /three point|three-point|3-pt/i.test(text));
      p.fga++; if (three) p.fg3a++;
      if (x.scoringPlay) { p.fgm++; p.pts += three ? 3 : 2; if (three) p.fg3m++; if (ids[1] && /assist/i.test(text)) at(ids[1]).ast++; }
      else if (ids[1] && /block/i.test(text)) at(ids[1]).blk++;
      continue;
    }
    if (/Offensive Rebound/i.test(ty)) { at(a).oreb++; continue; }
    if (/Defensive Rebound/i.test(ty)) { at(a).dreb++; continue; }
    if (/Turnover|Traveling|Bad Pass|Lost Ball|Out of Bounds|Double Dribble|Violation: Turnover|Back Court|Offensive Goaltending|3-Second|Shot Clock|Palming|Carry|Disc Dribble|Step Out/i.test(ty) && /turnover|bad pass|lost ball|traveling|steps out|out of bounds|violation|double dribble|offensive foul|charge/i.test(text + ty)) {
      at(a).tov++; if (ids[1] && /steal/i.test(text)) at(ids[1]).stl++; continue;   // "Offensive Foul Turnover" is the turnover half of an offensive foul
    }
    if (/Foul|Offensive Charge/i.test(ty) && !/Technical|Defensive 3|Delay|Double Technical|Turnover/i.test(ty)) { at(a).pf++; continue; }
  }
  for (const m of MARKS) snap(m);
  for (const k of Object.keys(P)) P[k].reb = P[k].oreb + P[k].dreb;
  for (const m of MARKS) for (const k of Object.keys(snaps[m])) snaps[m][k].reb = snaps[m][k].oreb + snaps[m][k].dreb;
  return { final: P, snaps, types, q4, periods: lastPer };
}

/**
 * Seconds each player was on the floor after each mark in the 4th quarter (regulation). The 4th's starting five are
 * inferred: a player whose first 4th-quarter substitution takes him OUT, or who has a play before he is ever subbed in.
 * -> { ok: {teamId: boolean}, after: { playerId: { 300: secs, 180:…, 120:…, 60:… } }, onAt: { 300: Set, … } }
 */
export function floorAfter(j, teamOf) {
  const plays = (j.plays || []).filter((x) => x.period?.number === 4), first = {}, acted = {};
  const sec = (x) => { const m = /^(\d+):(\d+)/.exec(x.clock?.displayValue || ""); return m ? +m[1] * 60 + +m[2] : parseFloat(x.clock?.displayValue) || 0; };
  for (const x of plays) { const ids = (x.participants || []).map((p) => String(p.athlete?.id)), s = sec(x);
    if (/Substitution/i.test(x.type?.text || "")) { if (ids[0] && !(ids[0] in first)) first[ids[0]] = "in"; if (ids[1] && !(ids[1] in first)) first[ids[1]] = "out"; }
    else for (const a of ids) if (a && !(a in first)) { first[a] = "play"; } }
  const on = {}; for (const [id, f] of Object.entries(first)) if (f !== "in" && teamOf[id]) (on[teamOf[id]] ||= new Set()).add(id);
  const ok = {}; for (const t of new Set(Object.values(teamOf))) ok[t] = (on[t]?.size || 0) === 5;
  const after = {}, onAt = {}; let last = 720;
  const credit = (from, to) => { for (const t of Object.keys(on)) for (const id of on[t]) for (const m of MARKS) { const span = Math.max(0, Math.min(from, m) - to); if (span > 0) ((after[id] ||= {})[m] = (after[id][m] || 0) + span); } };
  const markSeen = new Set();
  const note = (s) => { for (const m of MARKS) if (s < m && !markSeen.has(m)) { markSeen.add(m); onAt[m] = new Set(Object.values(on).flatMap((x) => [...x])); } };
  for (const x of plays) { const s = sec(x); note(s); if (!/Substitution/i.test(x.type?.text || "")) continue; credit(last, s); last = s;
    const ids = (x.participants || []).map((p) => String(p.athlete?.id)), t = teamOf[ids[0]] || teamOf[ids[1]]; if (!t) continue; (on[t] ||= new Set()); if (ids[1]) on[t].delete(ids[1]); if (ids[0]) on[t].add(ids[0]); }
  note(-1); credit(last, 0);
  return { ok, after, onAt };
}
