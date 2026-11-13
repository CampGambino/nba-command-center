"""
Re-test a new NBA Live version with the Command Center bridge, in headless Chrome.

  python3 tools/check-nba-live.py <nba-live.html> <watch.json> <YYYYMMDD> [<espn game id to replay as live>] [seconds]

Serves a copy of NBA Live with the bridge line added, passes ESPN / pbpstats requests through
(others are blocked, as they can be for a user), optionally turns one finished game back into a
"live" one, then reports: bridge connected?, cards from the Command Center vs NBA Live's own,
and page errors. Needs Python Playwright and Chrome (the cloud workspace has both).
"""
import asyncio, json, os, ssl, urllib.request, sys, shutil, tempfile, subprocess, time
from playwright.async_api import async_playwright
CA = os.path.expanduser("~/.ccr/ca-bundle.crt")
ctx = ssl.create_default_context(cafile=CA) if os.path.exists(CA) else ssl.create_default_context()
proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
opener = urllib.request.build_opener(urllib.request.ProxyHandler({"https": proxy, "http": proxy}), urllib.request.HTTPSHandler(context=ctx))
ALLOW = ("site.api.espn.com", "site.web.api.espn.com", "api.pbpstats.com")
HTML, WATCH, DATE = sys.argv[1], sys.argv[2], sys.argv[3]
LIVE_GAME = sys.argv[4] if len(sys.argv) > 4 else None
SECONDS = int(sys.argv[5]) if len(sys.argv) > 5 else 75
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = tempfile.mkdtemp(prefix="nbalive-")
page = open(HTML, encoding="utf-8").read()
cut = page.rfind("</body>")
page = (page[:cut] if cut > 0 else page) + '<script src="cc-bridge.js"></script>\n' + (page[cut:] if cut > 0 else "")
open(os.path.join(SITE, "index.html"), "w", encoding="utf-8").write(page)
shutil.copy(os.path.join(HERE, "..", "docs", "bridge", "cc-bridge.js"), SITE)
shutil.copy(WATCH, os.path.join(SITE, "watch.json"))
# tonight.json (bridge v2's pre-game storylines) sits next to the Watch List it was built from.
_tonight = os.path.join(os.path.dirname(os.path.abspath(WATCH)), "tonight.json")
if os.path.exists(_tonight): shutil.copy(_tonight, os.path.join(SITE, "tonight.json"))
# bridge v3: career records and the single-game lists
_records = os.path.join(os.path.dirname(os.path.abspath(WATCH)), "records.json")
if os.path.exists(_records): shutil.copy(_records, os.path.join(SITE, "records.json"))
_bests = os.path.join(HERE, "..", "docs", "ref", "nba-single-game-bests.json")
if os.path.exists(_bests): os.makedirs(os.path.join(SITE, "ref"), exist_ok=True); shutil.copy(_bests, os.path.join(SITE, "ref", "nba-single-game-bests.json"))
# bridge v5: this season's Game Flow facts
_flow = os.path.join(os.path.dirname(os.path.abspath(WATCH)), "flowstats.json")
if os.path.exists(_flow): shutil.copy(_flow, os.path.join(SITE, "flowstats.json"))
server = subprocess.Popen([sys.executable, "-m", "http.server", "8791", "--directory", SITE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
log = {"passed": 0, "blocked": 0, "errors": 0, "hosts": {}}
def fake_live(obj):
    # mark the chosen game in progress, 4th quarter, wherever its status appears
    def walk(o):
        if isinstance(o, dict):
            st = o.get("status")
            if isinstance(st, dict) and isinstance(st.get("type"), dict) and st["type"].get("name") == "STATUS_FINAL":
                st["type"].update({"name": "STATUS_IN_PROGRESS", "state": "in", "completed": False, "description": "In Progress", "detail": "2:00 - 4th Quarter", "shortDetail": "2:00 - 4th"})
                st["displayClock"] = "2:00"; st["period"] = 4; st["clock"] = 120
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(obj); return obj
async def handle(route):
    url = route.request.url
    host = url.split("/")[2]
    log["hosts"][host] = log["hosts"].get(host, 0) + 1
    if host.startswith("localhost"):
        return await route.continue_()
    if not host.endswith(ALLOW) and host not in ALLOW:
        log["blocked"] += 1
        return await route.abort()
    try:
        with opener.open(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r:
            body = r.read(); ctype = r.headers.get("content-type", "application/json")
        if LIVE_GAME and (("scoreboard" in url) or (f"event={LIVE_GAME}" in url)):
            j = json.loads(body)
            if "scoreboard" in url:
                for e in j.get("events", []):
                    if e.get("id") == LIVE_GAME: fake_live(e)
            else:
                fake_live(j.get("header", {}))
            body = json.dumps(j).encode()
        log["passed"] += 1
        await route.fulfill(status=200, body=body, headers={"content-type": ctype, "access-control-allow-origin": "*"})
    except Exception as e:
        log["errors"] += 1
        await route.fulfill(status=502, body=str(e), headers={"access-control-allow-origin": "*"})
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1500, "height": 950})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        pg.on("console", lambda m: errs.append("console." + m.type + ": " + m.text[:200]) if m.type in ("error",) or "cc-bridge" in m.text else None)
        await pg.route("**/*", handle)
        await pg.goto(f"http://localhost:8791/index.html?date={DATE}&cc=watch.json", wait_until="domcontentloaded", timeout=120000)
        await pg.wait_for_timeout(SECONDS * 1000)
        st = await pg.evaluate("() => { const s = window.CC_BRIDGE && window.CC_BRIDGE.state; return s && {connected: s.connected, items: s.items.length, fired: s.fired, error: s.error, today: s.data && s.data.today, wrongNight: s.wrongNight, tonight: s.tonight ? s.tonight.games.length : null, version: window.CC_BRIDGE.version, records: s.recItems ? s.recItems.length : null, bests: !!s.bests, recErr: s.recError || s.recordsError || null, listErr: s.listError || s.bestsError || null, flow: s.flow ? s.flow.games : null, flowErr: s.flowCheckError || s.flowError || null}; }")
        note = await pg.evaluate("() => (document.getElementById('cc-bridge-note')||{}).textContent || null")
        cards = await pg.evaluate("() => [...document.querySelectorAll('#alerts-scroll > *')].map(e => e.innerText.replace(/\\s+/g,' ').slice(0,230))")
        games = await pg.evaluate("() => { try { return GAMES.map(g => g.away.tricode+'@'+g.home.tricode+' '+g.status+' box:'+(g.boxscore? (g.boxscore.away||[]).length : 0)); } catch(e) { return String(e); } }")
        await pg.screenshot(path=os.path.join(SITE, "screenshot.png")); print("screenshot:", os.path.join(SITE, "screenshot.png"))
        print("BRIDGE:", st); print("NOTE:", note); print("GAMES:", games)
        cc = [c for c in cards if "Command Center" in c]
        print(f"CARDS: {len(cards)} total, {len(cc)} from Command Center")
        for c in cc[:12]: print("  CC>", c)
        for c in [c for c in cards if "Command Center" not in c][:6]: print("  NL>", c)
        print("NET:", {k: v for k, v in log.items() if k != "hosts"}, sorted(log["hosts"].items(), key=lambda x: -x[1])[:8])
        print("ERRORS:", errs[:10])
        await b.close()
try:
    asyncio.run(main())
finally:
    server.terminate()
