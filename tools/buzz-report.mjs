#!/usr/bin/env node
// Writes the morning buzz check (0.186.0) from a draft the scheduled task made, after checking its shape.
//
//   node tools/buzz-report.mjs <draft.json>
//
// Draft: { date: "YYYY-MM-DD" (the night covered), searched: ["NBA.com recap", …], summary?: "…",
//          items: [{ claim, player?, team?, source, url?, verdict, ours, note, cut? }] }
//   verdict: "true" | "out of date" | "wrong" | "can't check";  ours: "found" | "missed" | "n/a"
//   claim and note are in the task's own words (no copied paragraphs); a quote, if any, under 15 words.
// Writes docs/data/buzz.json (the Worker posts it to #alerts once, cloudflare/buzz.js) and history/buzz/<date>.json.
// Exits 1 with the reasons when the draft is not right; nothing is written then.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VERDICTS = ["true", "out of date", "wrong", "can't check"], OURS = ["found", "missed", "n/a"];

export function checkDraft(d) {
  const bad = [];
  if (!/^\d{4}-\d\d-\d\d$/.test(d?.date || "")) bad.push("date must be YYYY-MM-DD");
  if (!Array.isArray(d?.items)) bad.push("items must be a list");
  (d?.items || []).forEach((i, n) => {
    const at = `item ${n + 1}`;
    if (!i || typeof i.claim !== "string" || i.claim.trim().length < 8) bad.push(`${at}: claim missing`);
    if (typeof i?.claim === "string" && i.claim.length > 400) bad.push(`${at}: claim over 400 characters (say it in your own words)`);
    if (!VERDICTS.includes(i?.verdict)) bad.push(`${at}: verdict must be one of ${VERDICTS.join(", ")}`);
    if (!OURS.includes(i?.ours)) bad.push(`${at}: ours must be one of ${OURS.join(", ")}`);
    if (!i?.source) bad.push(`${at}: source missing`);
    if (i?.url && !/^https?:\/\/\S+$/.test(i.url)) bad.push(`${at}: url must be a web address`);
    if (i?.verdict !== "can't check" && !i?.note) bad.push(`${at}: note missing (what our data says)`);
    if (i?.ours === "missed" && !i?.cut) bad.push(`${at}: a missed item needs cut (the check that would have found it)`);
  });
  return bad;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const file = process.argv[2];
  if (!file) { console.error("usage: node tools/buzz-report.mjs <draft.json>"); process.exit(1); }
  let d; try { d = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.error(`draft not read: ${e.message}`); process.exit(1); }
  const bad = checkDraft(d);
  if (bad.length) { console.error(`draft not written:\n- ${bad.join("\n- ")}`); process.exit(1); }
  const rep = { id: d.date, date: d.date, generatedAt: new Date().toISOString(), searched: d.searched || [], ...(d.summary ? { summary: d.summary } : {}), items: d.items };
  const body = JSON.stringify(rep, null, 1);
  fs.writeFileSync(path.join(root, "docs", "data", "buzz.json"), body);
  fs.mkdirSync(path.join(root, "history", "buzz"), { recursive: true });
  fs.writeFileSync(path.join(root, "history", "buzz", `${d.date}.json`), body);
  const n = (f) => d.items.filter(f).length;
  console.log(`buzz report ${d.date}: ${d.items.length} items (${n((i) => i.verdict === "true")} true, ${n((i) => i.verdict === "out of date")} out of date, ${n((i) => i.verdict === "wrong")} wrong, ${n((i) => i.ours === "missed")} missed by our checks); wrote docs/data/buzz.json and history/buzz/${d.date}.json`);
}
