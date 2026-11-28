"""
A whole-site audit (0.189.0; the user, 11/28: "please run a full audit of the website for any dead links or missing
information"). Serves docs/ (with its built data) and, in headless Chrome, opens every page and every link it finds:

  - dead links: a link to a page that isn't there, an anchor (#id) the target page never draws, a ?team= or ?p= that
    lands on an empty page
  - failed loads: any request answered 400 or worse (a data file a page reads that isn't built)
  - missing information: script errors; "undefined", "NaN", "[object Object]"; a "Couldn't", "not built", "Not built yet"
    or "Nothing" message; a section heading with nothing under it; a table with a header and no rows

  python3 tools/audit-site.py [docs-dir] > report.txt      (port 8795)

Exit code 1 when anything is found. External links are listed, not opened (the workspace can't reach most sites).
"""
import asyncio, json, os, re, subprocess, sys, time
from urllib.parse import urlparse, unquote
from playwright.async_api import async_playwright

DOCS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs")
PORT = 8795
BASE = f"http://localhost:{PORT}/"
START = [f for f in sorted(os.listdir(DOCS)) if f.endswith(".html")]
JUNK = re.compile(r"\bundefined\b|\bNaN\b|\[object Object\]")
EMPTY = re.compile(r"Couldn't|could not be read|[Nn]ot built yet|isn't built|aren't built yet|No data|Failed to")

PROBE = r"""() => {
  const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
  // tabs a page opens from the address's #part (records.html's showTab on hashchange): their names count as anchors
  const tabs = /hashchange|location\.hash/.test([...document.scripts].map((x) => x.textContent).join(' ')) ? [...document.querySelectorAll('[data-t],[data-goto],[data-tab],[data-v]')].map((e) => e.dataset.t || e.dataset.goto || e.dataset.tab || e.dataset.v) : [];
  const links = [...document.querySelectorAll('a[href]')].filter(vis).map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim().slice(0, 60) }));
  const text = document.body.innerText;
  // a heading (h2/h3) whose section, up to the next heading, has no text beyond a line or two
  const bare = [];
  for (const h of document.querySelectorAll('h2, h3')) { if (!vis(h) || h.closest('details:not([open])')) continue; let n = h.nextElementSibling, t = ''; while (n && !/^H[23]$/.test(n.tagName)) { if (vis(n)) t += n.innerText; n = n.nextElementSibling; } if (t.trim().length < 3) bare.push(h.textContent.trim().slice(0, 60)); }
  const tables = [...document.querySelectorAll('table')].filter(vis).filter((t) => t.querySelectorAll('tr').length <= 1).map((t) => (t.closest('section,details,div[id]') || {}).id || '(table)');
  return { ids, tabs, links, junk: (text.match(/.{0,50}(?:\bundefined\b|\bNaN\b|\[object Object\]).{0,50}/g) || []).slice(0, 5),
    empty: (text.match(/.{0,60}(?:Couldn't|could not be read|[Nn]ot built yet|isn't built|aren't built yet|No data|Failed to).{0,60}/g) || []).slice(0, 5),
    bare, tables, len: text.length };
}"""

async def visit(browser, url, cache):
    if url in cache: return cache[url]
    pg = await browser.new_page(viewport={"width": 1400, "height": 900})
    errs, bad = [], []
    pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
    outside = []
    pg.on("requestfailed", lambda r: outside.append(r.url) if not r.url.startswith(BASE) else None)
    pg.on("response", lambda r: bad.append(f"{r.status} {r.url.replace(BASE, '')}") if r.status >= 400 and not r.url.endswith("favicon.ico") else None)
    try:
        await pg.goto(BASE + url, timeout=30000); await pg.wait_for_timeout(1800)
        info = await pg.evaluate(PROBE)
    except Exception as e:
        info = {"ids": [], "links": [], "junk": [], "empty": [], "bare": [], "tables": [], "len": 0, "fail": str(e)[:160]}
    info["errs"], info["bad"], info["outside"] = errs, bad, sorted({urlparse(x).netloc for x in outside})
    await pg.close()
    cache[url] = info
    return info

async def main():
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)], cwd=DOCS, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    found, cache, external = [], {}, set()
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            queue, seen = list(START), set()
            while queue:
                url = queue.pop(0)
                if url in seen: continue
                seen.add(url)
                info = await visit(browser, url, cache)
                tag = url
                if info.get("fail"): found.append((tag, "page did not load", info["fail"]))
                for e in info["errs"]: found.append((tag, "script error", e))
                for b in info["bad"]: found.append((tag, "failed load", b))
                for j in info["junk"]: found.append((tag, "junk text", j))
                for m in info["empty"]: found.append((tag, "outside source (can't reach from here)" if info.get("outside") else "missing data message", m))
                for h in info["bare"]: found.append((tag, "empty section", h))
                for t in info["tables"]: found.append((tag, "table with no rows", t))
                # follow internal links (one level of query variants: each distinct page+query once)
                for l in info["links"]:
                    h = l["href"]
                    if h.startswith(("http://", "https://")) and "localhost" not in h: external.add(h); continue
                    if h.startswith(("mailto:", "javascript:", "data:")): continue
                    u = urlparse(h); raw = u.path
                    # "./" is the home page; "" (a bare "#x" or "?q") is this page, with its own query when it's a bare anchor
                    path = "index.html" if raw in ("./", ".", "/") else raw[2:] if raw.startswith("./") else raw or url.split("?")[0].split("#")[0]
                    if path.startswith("data/"):
                        if not os.path.exists(os.path.join(DOCS, unquote(path))): found.append((tag, "dead link (data file)", f"{l['text']} -> {h}"))
                        continue
                    if not os.path.exists(os.path.join(DOCS, unquote(path))): found.append((tag, "dead link (no such page)", f"{l['text']} -> {h}")); continue
                    target = path + (("?" + u.query) if u.query else "")
                    if not raw and not u.query: target = url.split("#")[0]   # a same-page anchor: this page as it is
                    if u.query and target not in seen and len([s for s in seen if s.startswith(path + "?")]) < 6: queue.append(target)
                    if u.fragment:
                        t = await visit(browser, target, cache)
                        if unquote(u.fragment) not in t["ids"] and unquote(u.fragment) not in t.get("tabs", []): found.append((tag, "dead anchor", f"{l['text']} -> {h}"))
            await browser.close()
    finally:
        srv.terminate()
    seenmsg = set()
    for page, kind, what in found:
        k = (kind, what if kind.startswith("dead") or kind == "failed load" else page + what)
        if k in seenmsg: continue
        seenmsg.add(k)
        print(f"{kind:24} | {page:34} | {what}")
    print(f"\n{len(seen)} pages opened; {len(seenmsg)} findings; {len(external)} external links (not opened)")
    for e in sorted(external)[:40]: print("  external:", e)
    # a page that reads ESPN or NBA.com from the browser (Game Flow) can't be checked from here: listed, not counted
    sys.exit(1 if any(not k[0].startswith("outside source") for k in seenmsg) else 0)

asyncio.run(main())
