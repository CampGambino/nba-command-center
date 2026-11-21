#!/usr/bin/env node
/**
 * The Worker's saved data (KV namespace STATE, cloudflare/wrangler.toml), copied out and put back (0.141.14).
 *   node tools/kv-backup.mjs dump > kv.json                 every key with its value, expiration and metadata
 *   node tools/kv-backup.mjs restore kv.json                writes those keys back (keys not in the file are left alone)
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (the deploy secrets). The namespace id is read from wrangler.toml.
 * Run by .github/workflows/kv-backup.yml (daily, encrypted with the NCC_BACKUP_KEY secret before it is kept) and
 * kv-restore.yml (by hand). The file is never kept unencrypted: the repository is public.
 */
import fs from "node:fs";

const API = "https://api.cloudflare.com/client/v4";

export function namespaceId(toml) {
  const m = /\[\[kv_namespaces\]\][\s\S]*?binding\s*=\s*"STATE"[\s\S]*?\bid\s*=\s*"([0-9a-f]{32})"/.exec(toml);
  if (!m) throw new Error("no STATE namespace id in wrangler.toml");
  return m[1];
}

/** Every key (the list is paged by cursor, 1,000 at a time), then each value as text. */
export async function dump({ account, ns, token, fetchFn = fetch }) {
  const h = { Authorization: `Bearer ${token}` };
  const names = [];
  let cursor = "";
  do {
    const r = await fetchFn(`${API}/accounts/${account}/storage/kv/namespaces/${ns}/keys?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: h });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(`listing keys: HTTP ${r.status} ${JSON.stringify(j.errors || [])}`);
    names.push(...j.result);
    cursor = j.result_info?.cursor || "";
  } while (cursor);
  const keys = [];
  for (const k of names) {
    const r = await fetchFn(`${API}/accounts/${account}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(k.name)}`, { headers: h });
    if (r.status === 404) continue; // expired between the list and the read
    if (!r.ok) throw new Error(`reading ${k.name}: HTTP ${r.status}`);
    keys.push({ key: k.name, value: await r.text(), ...(k.expiration ? { expiration: k.expiration } : {}), ...(k.metadata ? { metadata: k.metadata } : {}) });
  }
  return { at: new Date().toISOString(), namespace: ns, n: keys.length, keys };
}

/** Writes the keys back, 1,000 a request (the bulk limit is 10,000). An expiration already past is dropped with the key. */
export async function restore({ account, ns, token, data, fetchFn = fetch, now = Date.now() }) {
  const rows = (data.keys || []).filter((k) => !k.expiration || k.expiration * 1000 > now + 60e3);
  for (let i = 0; i < rows.length; i += 1000) {
    const r = await fetchFn(`${API}/accounts/${account}/storage/kv/namespaces/${ns}/bulk`, {
      method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(rows.slice(i, i + 1000)),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(`writing keys: HTTP ${r.status} ${JSON.stringify(j.errors || [])}`);
  }
  return rows.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, file] = process.argv.slice(2);
  const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) { console.error("needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID"); process.exit(2); }
  const ns = namespaceId(fs.readFileSync(new URL("../cloudflare/wrangler.toml", import.meta.url), "utf8"));
  if (mode === "dump") {
    const d = await dump({ account, ns, token });
    process.stdout.write(JSON.stringify(d));
    console.error(`kv backup: ${d.n} keys (${d.keys.map((k) => k.key).slice(0, 12).join(", ")}${d.n > 12 ? ", …" : ""})`);
  } else if (mode === "restore" && file) {
    const n = await restore({ account, ns, token, data: JSON.parse(fs.readFileSync(file, "utf8")) });
    console.error(`kv restore: ${n} keys written`);
  } else { console.error("usage: node tools/kv-backup.mjs dump | restore <file>"); process.exit(2); }
}
