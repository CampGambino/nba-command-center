/**
 * Only the articles watcher's checks (no saved samples needed): run by the deploy workflow before
 * every Cloudflare deploy. Exit code 1 on any failure, so nothing broken gets deployed.
 *
 *   node tests/articles-only.js
 */
import { articlesChecks } from "./articles-worker.js";

let pass = 0;
const failures = [];
const ok = (cond, name, detail = "") => { if (cond) pass++; else failures.push(`${name}${detail ? ` -- ${detail}` : ""}`); };
await articlesChecks(ok);
console.log(`articles watcher checks: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length || pass === 0 ? 1 : 0);
