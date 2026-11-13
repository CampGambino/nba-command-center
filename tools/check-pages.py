"""
Render every site page at desktop (1400 px) and phone (390 px) widths in headless Chrome and report problems:
script errors, failed loads (except favicon), a "Couldn't load" message, a nav without all 10 tabs, or a page
wider than the screen (anything not inside an area built to scroll sideways).

  python3 tools/check-pages.py            (serves docs/ itself on port 8794)

Exit code 1 if any page has a problem. Needs Python Playwright and Chrome (the cloud workspace has both).
"""
import asyncio, os, subprocess, sys, time
from playwright.async_api import async_playwright

DOCS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs")
PAGES = ["index.html", "situations.html", "clutch.html", "clutch.html?mode=q4", "players.html?team=SAS", "players.html?a=3936299&b=3112335",
         "trends.html", "leaders.html", "defenses.html", "defenses.html?by=defense", "defenses.html?view=players", "defenses.html?view=thirty", "national.html", "gameflow.html", "records.html",
         "records.html#reach", "records.html#lists", "records.html#franchise", "records.html#season", "records.html#cup", "records.html#book", "records.html#checks"]
CHROME = "/usr/bin/google-chrome"


async def check(browser, url, width):
    pg = await browser.new_page(viewport={"width": width, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append("JS: " + str(e)))
    pg.on("response", lambda r: errs.append(f"{r.status} {r.url.split('/')[-1]}") if r.status >= 400 and not r.url.endswith("favicon.ico") else None)
    await pg.goto("http://localhost:8794/" + url)
    await pg.wait_for_timeout(1500)
    info = await pg.evaluate("""() => ({
      nav: [...document.querySelectorAll('nav a')].length,
      sub: (document.getElementById('sub') || {}).textContent || '',
      rows: document.querySelectorAll('tr').length,
      wide: [...document.querySelectorAll('body *')].filter((e) => {
        if (e.getBoundingClientRect().right <= window.innerWidth + 1) return false;
        // inside an area built to scroll sideways (a table wrapper, tonight's games strip): fine
        for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (/auto|scroll/.test(getComputedStyle(a).overflowX)) return false;
        return true;
      }).slice(0, 2).map((e) => e.tagName + '.' + e.className)
    })""")
    await pg.close()
    problems = errs[:3]
    if "Couldn't" in info["sub"]: problems.append(info["sub"][:80])
    if info["nav"] != 10: problems.append(f"nav has {info['nav']} links")
    if info["wide"]: problems.append("wider than the screen: " + ", ".join(info["wide"]))
    return problems, info


async def main():
    server = subprocess.Popen([sys.executable, "-m", "http.server", "8794", "--directory", DOCS], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    bad = 0
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME)
            for width in (1400, 390):
                for url in PAGES:
                    problems, info = await check(browser, url, width)
                    bad += 1 if problems else 0
                    print(f"{'BAD' if problems else 'OK '} {width:>4} {url:28} rows={info['rows']:<4} {'; '.join(problems)}")
            await browser.close()
    finally:
        server.terminate()
    print(f"{bad} page(s) with problems" if bad else "all pages OK")
    sys.exit(1 if bad else 0)


asyncio.run(main())
