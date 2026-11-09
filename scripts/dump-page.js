#!/usr/bin/env node
// Debug helper: print the positioned lines of one page.  node scripts/dump-page.js file.pdf 9 [filter]
import fs from "node:fs";
import { readPdf } from "../src/notes/pdf-layout.js";
const [file, pageNo, filter] = process.argv.slice(2);
const doc = await readPdf(fs.readFileSync(file));
const page = doc.pages[Number(pageNo) - 1];
for (const l of page.lines) {
  if (filter && !new RegExp(filter, "i").test(l.text)) continue;
  console.log(`${l.y.toFixed(1).padStart(6)} | ${l.text}`);
  if (filter) console.log("        cells:", l.cells.map((c) => `[${c.x0.toFixed(0)}-${c.x1.toFixed(0)}] ${c.text}`).join(" || "));
}
