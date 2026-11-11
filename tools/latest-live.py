"""
Bring the newest NBA Live / GameFlow from a folder (normally Downloads) into the private live/ folder.

  python3 tools/latest-live.py <folder> [<live dir, default: live/ next to tools/>]

Picks the newest file of each kind by SAVE TIME, never by the number in its name: NBA Live's
numbering restarts at 0 (or no number) once the old versions are deleted, so "_14" can be older
than "nba-live.html". A file is copied only when its content differs from every copy already in
live/, and copies are never overwritten (a name clash gets a "-<n>" suffix). Prints one line per
kind: "new", "same as <file>", or "none found". Exit code 0 always; nothing is deleted.
"""
import hashlib, os, re, shutil, sys

KINDS = {  # kind -> file name pattern (case-insensitive); Windows adds " (3)" for duplicates
    "nba-live": re.compile(r"^nba-live(?:[_ -]?\(?\d+\)?)?\.html$", re.I),
    "nba-gameflow": re.compile(r"^nba-gameflow(?:[_ -]?\(?\d+\)?)?\.html$", re.I),
}

def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def newest(folder, pattern):
    files = [os.path.join(folder, n) for n in os.listdir(folder) if pattern.match(n)]
    files = [p for p in files if os.path.isfile(p)]
    return max(files, key=lambda p: (os.path.getmtime(p), p)) if files else None

def free_name(live, name):
    stem, ext = os.path.splitext(name)
    cand, n = name, 1
    while os.path.exists(os.path.join(live, cand)):
        cand, n = f"{stem}-{n}{ext}", n + 1
    return cand

def run(folder, live):
    os.makedirs(live, exist_ok=True)
    out = {}
    for kind, pattern in KINDS.items():
        src = newest(folder, pattern)
        if not src:
            out[kind] = ("none found", None)
            continue
        have = {md5(os.path.join(live, n)): n for n in os.listdir(live) if pattern.match(n) or n.lower().startswith(kind)}
        digest = md5(src)
        if digest in have:
            out[kind] = (f"same as {have[digest]}", src)
            continue
        dest = os.path.join(live, free_name(live, os.path.basename(src)))
        shutil.copy2(src, dest)
        out[kind] = (f"new -> {os.path.basename(dest)}", src)
    return out

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__.strip()); sys.exit(0)
    here = os.path.dirname(os.path.abspath(__file__))
    live = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "..", "live")
    for kind, (msg, src) in run(sys.argv[1], live).items():
        print(f"{kind}: {msg}" + (f"  (from {os.path.basename(src)})" if src else ""))
