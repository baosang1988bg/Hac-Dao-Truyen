#!/usr/bin/env python3
"""
download_epubs.py — Bulk EPUB Downloader với rich terminal UI
=============================================================
Đọc catalog_full.jsonl, tải EPUB, verify, resume. Không fetch API lại.
Mỗi truyện có genre từ /truyen/<slug>/ (scrape 1 lần, cache lại).

Usage:
  python download_epubs.py --dir ~/Downloads/epub_library --resume
  python download_epubs.py --dir ~/Downloads/epub_library --slug <slug>
  python download_epubs.py --dir ~/Downloads/epub_library --status hoan-thanh --min-ch 200
  python download_epubs.py --dir ~/Downloads/epub_library --retry-failed
  python download_epubs.py --dir ~/Downloads/epub_library --verify-only
  python download_epubs.py --dir ~/Downloads/epub_library --build-genre-catalog
"""
import argparse, json, hashlib, time, zipfile, re
import urllib.request, urllib.error, urllib.parse
import os, sys
from pathlib import Path
from datetime import datetime

BASE    = "https://web.audiotruyenfull.org/api/bff"
VIP_URL = "https://vip.audiotruyenfull.org/truyen"
HEADERS = {"Accept":"application/json","User-Agent":"Mozilla/5.0","Content-Type":"application/json"}
MIN_EPUB    = 2048
POLL_INT    = 1.2
EXP_TIMEOUT = 200

if sys.platform == "win32":
    os.system("") # Enable VT100 ANSI color escape sequences on Windows CMD / PowerShell

# ANSI colors
R="\033[0m"; BOLD="\033[1m"; DIM="\033[2m"
GRN="\033[92m"; RED="\033[91m"; YLW="\033[93m"
BLU="\033[94m"; CYN="\033[96m"; MGT="\033[95m"
WHT="\033[97m"; GRY="\033[90m"

GENRE_NAMES = {
    "tien-hiep":           "🧙 Tiên Hiệp",
    "huyen-huyen":         "✨ Huyền Huyễn",
    "kiem-hiep":           "⚔️  Kiếm Hiệp",
    "do-thi":              "🏙️  Đô Thị",
    "he-thong":            "⚙️  Hệ Thống",
    "khoa-huyen":          "🚀 Khoa Huyễn",
    "dong-nhan":           "📚 Đồng Nhân",
    "vong-du":             "🎮 Võng Du",
    "lich-su":             "📜 Lịch Sử",
    "tong-tai":            "💼 Tổng Tài",
    "ngon-tinh":           "💕 Ngôn Tình",
    "co-dai":              "🏯 Cổ Đại",
    "kinh-di":             "👻 Kinh Dị",
    "duc-tai":             "👑 Đức Tài",
    "co-tri":              "🏛️  Cổ Trí",
    "dam-my":              "💜 Đam Mỹ",
    "di-gioi":             "🌍 Dị Giới",
    "quan-su":             "🎖️  Quân Sự",
    "thien-tai":           "🧠 Thiên Tài",
    "goc-nhin-nam":        "🧔 Gốc Nhìn Nam",
    "dong-phuong-huyen-huyen": "🐉 Đông Phương HH",
}

# ── HTTP ──────────────────────────────────────────────────────────────────────
# TOR Proxy config
TOR_PROXY = "socks5h://127.0.0.1:9050"
use_tor_global = [False]
tor_dl_count = [0]

def renew_tor_circuit():
    """Gửi tín hiệu đổi IP cho Tor — Hỗ trợ cả Windows, macOS và Linux."""
    try:
        # Cách 1: Gửi lệnh qua Tor Control Port (9051) nếu có
        import socket
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(2)
            s.connect(("127.0.0.1", 9051))
            s.sendall(b'AUTHENTICATE ""\r\nSIGNAL NEWNYM\r\n')
            resp = s.recv(1024)
            s.close()
            if b"250" in resp:
                time.sleep(2)
                print(f"\n{YLW}[🔄 NEW IP] Đã đổi IP Tor thành công (Control Port 9051)!{R}")
                return
        except Exception:
            pass

        # Cách 2: Tín hiệu HUP / Taskkill cross-platform
        if sys.platform == "win32":
            os.system("taskkill /IM tor.exe /F >nul 2>&1")
            time.sleep(1)
            os.system("start /B tor >nul 2>&1")
        else:
            os.system("pkill -HUP tor 2>/dev/null")

        time.sleep(2)
        print(f"\n{YLW}[🔄 NEW IP] Đã đổi đường truyền Tor sang IP mới!{R}")
    except Exception as e:
        print(f"\n{RED}[!] Lỗi đổi IP Tor: {e}{R}")

def get_opener(use_tor=False):
    if use_tor or use_tor_global[0]:
        import socks, socket
        socks.set_default_proxy(socks.SOCKS5, "127.0.0.1", 9050)
        socket.socket = socks.socksocket

def get(url, timeout=30):
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 403:
            print(f"\n{YLW}[⚡ TOR] Bị 403 Limit -> Đổi IP Tor ngay...{R}")
            use_tor_global[0] = True
            get_opener(use_tor=True)
            renew_tor_circuit()
            return get(url, timeout)
        raise RuntimeError(f"HTTP {e.code}")

def post(url, body, timeout=30):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 403:
            print(f"\n{YLW}[⚡ TOR] Bị 403 Limit -> Đổi IP Tor ngay...{R}")
            use_tor_global[0] = True
            get_opener(use_tor=True)
            renew_tor_circuit()
            return post(url, body, timeout)
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8','replace')[:150]}")

def dl_bytes(url, dest, timeout=45):
    req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
    data = bytearray()
    t_start = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        while True:
            if time.time() - t_start > timeout:
                raise RuntimeError(f"Tải file quá lâu (> {timeout}s) -> skip")
            chunk = r.read(65536)
            if not chunk:
                break
            data.extend(chunk)
    bytes_data = bytes(data)
    dest.write_bytes(bytes_data)
    return len(bytes_data), hashlib.sha256(bytes_data).hexdigest()

def retry(fn, *a, n=3, d=2, **kw):
    for i in range(n):
        try: return fn(*a, **kw)
        except Exception as e:
            if i==n-1: raise
            time.sleep(d*(i+1))

# ── Genre scraper ─────────────────────────────────────────────────────────────
def fetch_genres(slug, cache: dict) -> list:
    if slug in cache:
        return cache[slug]
    try:
        req = urllib.request.Request(
            f"{VIP_URL}/{slug}/",
            headers={"User-Agent":"Mozilla/5.0"},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            html = r.read().decode("utf-8", errors="replace")
        cats = re.findall(r'/the-loai/([^/"]+)', html)
        genres = list(dict.fromkeys(cats))  # unique, preserve order
        cache[slug] = genres
        return genres
    except:
        cache[slug] = []
        return []

# ── EPUB verify ───────────────────────────────────────────────────────────────
def verify_epub(path):
    if not path.exists(): return False, "missing"
    size = path.stat().st_size
    if size < MIN_EPUB:   return False, f"too small ({size}B)"
    try:
        if path.read_bytes()[:2] != b'PK': return False, "not ZIP"
    except Exception as e: return False, str(e)
    try:
        with zipfile.ZipFile(path,'r') as zf:
            if "mimetype" not in zf.namelist(): return False, "no mimetype"
            bad = zf.testzip()
            if bad: return False, f"CRC fail: {bad}"
    except zipfile.BadZipFile as e: return False, str(e)
    except Exception as e:           return False, str(e)
    return True, f"{size/1024:.0f}KB"

# ── Export ────────────────────────────────────────────────────────────────────
def export_epub(slug, progress_fn=None, max_timeout=45):
    rid = f"dl-{slug}-{int(time.time())}"
    r = retry(post, f"{BASE}/story-epub-export/start",
              {"slug_truyen":slug,"action":"download","request_id":rid}, n=2, d=1)
    if not r.get("success"): raise RuntimeError(f"start: {r}")
    if r.get("status")=="done" and r.get("file_url"): return r

    token = r.get("token")
    if not token: raise RuntimeError("no token")
    deadline = time.time() + EXP_TIMEOUT
    while time.time() < deadline:
        time.sleep(POLL_INT)
        sr = retry(get, f"{BASE}/story-epub-export/{urllib.parse.quote(token)}/status")
        st, pct = sr.get("status","").lower(), sr.get("percent",0)
        if progress_fn: progress_fn(st, pct)
        if st=="done" and sr.get("file_url"): return sr
        if st in ("error","failed"): raise RuntimeError(f"server: {sr.get('message','')}")
    raise RuntimeError("timeout")

# ── State ─────────────────────────────────────────────────────────────────────
def load_json(path, default):
    try:
        if path.exists(): return json.loads(path.read_text("utf-8"))
    except: pass
    return default

def save_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")

# ── Genre catalog ─────────────────────────────────────────────────────────────
def build_genre_catalog(items, genre_cache: dict, outdir: Path):
    """Tạo catalog phân loại theo thể loại."""
    print(f"\n{BLU}[catalog] Đang xây dựng genre catalog...{R}")
    genres_map = {}   # genre_slug -> [item]
    no_genre   = []

    total = len(items)
    for i, item in enumerate(items):
        slug   = item["slug"]
        genres = genre_cache.get(slug, [])

        if not genres:
            no_genre.append(item)
        for g in genres:
            genres_map.setdefault(g, []).append(item)

        if (i+1) % 1000 == 0:
            print(f"  {i+1:>6}/{total} processed...", end="\r")

    print()

    # Lưu từng file thể loại
    cat_dir = outdir / "catalogs_by_genre"
    cat_dir.mkdir(exist_ok=True)

    summary = []
    for g_slug, g_items in sorted(genres_map.items(), key=lambda x: -len(x[1])):
        g_name = GENRE_NAMES.get(g_slug, g_slug)
        fname  = cat_dir / f"{g_slug}.jsonl"
        with open(fname, "w", encoding="utf-8") as f:
            for it in g_items:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
        summary.append({"slug": g_slug, "name": g_name, "count": len(g_items)})
        print(f"  {g_name:<28} {len(g_items):>5,} truyện → {fname.name}")

    # No genre
    if no_genre:
        fname = cat_dir / "_unknown.jsonl"
        with open(fname,"w",encoding="utf-8") as f:
            for it in no_genre:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
        print(f"  {'🔖 Chưa phân loại':<28} {len(no_genre):>5,} truyện")
        summary.append({"slug":"_unknown","name":"Chưa phân loại","count":len(no_genre)})

    # Summary file
    save_json(outdir / "genre_summary.json", {
        "generated_at": datetime.now().isoformat(),
        "genres": summary,
    })
    print(f"\n{GRN}[catalog] Genre catalog lưu tại: {cat_dir}{R}")
    return genres_map

# ── Progress bar ──────────────────────────────────────────────────────────────
def progress_bar(pct, width=25):
    filled = int(width * pct / 100)
    bar    = "█" * filled + "░" * (width - filled)
    return f"[{CYN}{bar}{R}] {pct:>5.1f}%"

def fmt_size(b):
    if b >= 1024*1024: return f"{b/1024/1024:.1f}MB"
    return f"{b/1024:.0f}KB"

def fmt_time(s):
    if s < 60: return f"{s:.0f}s"
    if s < 3600: return f"{s/60:.0f}m"
    return f"{s/3600:.1f}h"

# ── Download 1 truyện ─────────────────────────────────────────────────────────
def dl_one(item, outdir, state, state_path, genre_cache,
           resume=True, covers=True, dry=False, fetch_genre=True, item_timeout=40):
    slug   = item["slug"]
    title  = item.get("title","")
    chs    = item.get("chapter_count",0)
    epubs  = outdir/"epubs";  epubs.mkdir(parents=True, exist_ok=True)
    metas  = outdir/"meta";   metas.mkdir(parents=True, exist_ok=True)
    epub_p = epubs / f"{slug}.epub"

    # ── Resume ──
    if resume and slug in state["ok"]:
        ok, _ = verify_epub(epub_p)
        if ok: return "skip", 0
        del state["ok"][slug]
        save_json(state_path, state)

    if dry:
        genres = fetch_genres(slug, genre_cache) if fetch_genre else []
        g_str  = " ".join(GENRE_NAMES.get(g, g) for g in genres[:3])
        print(f"    {DIM}{slug[:48]}{R} {GRY}| {chs}ch | {g_str}{R}")
        return "skip", 0

    # ── Export ──
    export_pct = [0]
    def on_progress(st, pct):
        export_pct[0] = pct
        bar = progress_bar(pct, 20)
        print(f"    {DIM}export{R} {bar} {GRY}{st}{R}   ", end="\r", flush=True)

    try:
        exp      = export_epub(slug, on_progress, max_timeout=item_timeout)
        file_url = exp.get("file_url","")
        if not file_url: raise RuntimeError("no file_url")

        nbytes, sha = dl_bytes(file_url, epub_p, timeout=item_timeout)
        ok, reason  = verify_epub(epub_p)
        if not ok:
            epub_p.unlink(missing_ok=True)
            raise RuntimeError(f"verify: {reason}")

        # Genre (cache)
        genres = []
        if fetch_genre:
            genres = fetch_genres(slug, genre_cache)
            save_json(outdir/"genre_cache.json", genre_cache)

        # Metadata
        meta_p = metas / f"{slug}.json"
        meta_p.write_text(json.dumps({
            **item, **exp,
            "genres": genres,
            "epub_bytes": nbytes, "sha256": sha,
            "epub_local": str(epub_p),
            "downloaded_at": datetime.now().isoformat(),
        }, ensure_ascii=False, indent=2), "utf-8")

        state["ok"][slug] = {
            "at": datetime.now().isoformat(),
            "bytes": nbytes, "sha256": sha,
            "genres": genres, "chapters": chs,
        }
        state["fail"] = {k:v for k,v in state["fail"].items() if k!=slug}
        save_json(state_path, state)
        return "ok", nbytes

    except Exception as e:
        msg = str(e)[:120]
        state["fail"][slug] = {"err": msg, "at": datetime.now().isoformat()}
        save_json(state_path, state)
        return "fail", 0

# ── Header banner ─────────────────────────────────────────────────────────────
def print_header(outdir, state):
    ok_n   = len(state["ok"])
    fail_n = len(state["fail"])
    total_bytes = sum(v.get("bytes",0) for v in state["ok"].values())
    print(f"\n{BOLD}{'═'*68}{R}")
    print(f"{BOLD}  📚  EPUB Downloader  ·  audiotruyenfull.org{R}")
    print(f"{'─'*68}")
    print(f"  {GRY}Output {R}: {outdir}")
    print(f"  {GRY}Đã OK  {R}: {GRN}{ok_n:,}{R}  {GRY}Fail:{R} {RED}{fail_n}{R}  {GRY}Size:{R} {fmt_size(total_bytes)}")
    print(f"{BOLD}{'═'*68}{R}\n")

# ── Live stats line ───────────────────────────────────────────────────────────
def print_stats(i, total, ok_n, fail_n, skip_n, bytes_total, t0):
    elapsed = time.time()-t0
    rate    = ok_n/elapsed*3600 if elapsed>0 else 0
    eta_s   = (total-i)/(ok_n/elapsed) if ok_n>0 and elapsed>0 else 0
    pct     = i/total*100
    bar     = progress_bar(pct, 30)
    print(f"\r{bar}  {BLU}{i:>6}/{total}{R}  "
          f"{GRN}✓{ok_n}{R} {RED}✗{fail_n}{R} {GRY}⤼{skip_n}{R}  "
          f"{CYN}{fmt_size(bytes_total)}{R}  "
          f"{YLW}~{rate:.0f}/h{R}  "
          f"{GRY}ETA {fmt_time(eta_s)}{R}  ", end="", flush=True)

# ── CLI ───────────────────────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dir",           default="./epub_library")
    p.add_argument("--resume",        action="store_true")
    p.add_argument("--no-covers",     action="store_true")
    p.add_argument("--dry-run",       action="store_true")
    p.add_argument("--no-genre",      action="store_true", help="Bỏ qua fetch genre")
    p.add_argument("--slug",          default="")
    p.add_argument("--status",        default="", choices=["","dang-ra","hoan-thanh"])
    p.add_argument("--min-ch",        type=int, default=0)
    p.add_argument("--max-ch",        type=int, default=0)
    p.add_argument("--search",        default="")
    p.add_argument("--limit",         type=int, default=0)
    p.add_argument("--retry-failed",  action="store_true")
    p.add_argument("--verify-only",   action="store_true")
    p.add_argument("--build-genre-catalog", action="store_true",
                   help="Xây dựng catalog phân theo thể loại từ genre_cache")
    p.add_argument("--use-tor",       action="store_true", help="Bắt đầu tải bằng Tor SOCKS5 proxy ngay")
    p.add_argument("--item-timeout",  type=float, default=40.0, help="Thời gian tối đa (giây) cho 1 truyện trước khi tự động skip (mặc định: 40s)")
    p.add_argument("--delay",         type=float, default=0.3)
    args = p.parse_args()

    if args.use_tor:
        use_tor_global[0] = True
        get_opener(use_tor=True)

    outdir     = Path(args.dir).expanduser().resolve()
    state_path = outdir/"state.json"
    state      = load_json(state_path, {"ok":{}, "fail":{}})
    genre_cache= load_json(outdir/"genre_cache.json", {})

    print_header(outdir, state)

    # ── Verify-only ──
    if args.verify_only:
        epub_dir = outdir/"epubs"
        epubs    = sorted(epub_dir.glob("*.epub")) if epub_dir.exists() else []
        print(f"{BLU}[verify]{R} Kiểm tra {len(epubs):,} file EPUB...\n")
        bad, good = [], 0
        for ep in epubs:
            ok, reason = verify_epub(ep)
            if ok: good += 1
            else:
                print(f"  {RED}BAD{R} {ep.stem}: {reason}")
                bad.append(ep.stem)
        print(f"\n{GRN}✓ OK: {good:,}{R}  {RED}✗ BAD: {len(bad):,}{R}")
        if bad: (outdir/"bad_slugs.txt").write_text("\n".join(bad))
        return

    # ── Single slug ──
    if args.slug:
        item = {"slug":args.slug,"title":args.slug,"chapter_count":0,"cover_url":"","manga_status":""}
        r,nb = dl_one(item, outdir, state, state_path, genre_cache,
                      args.resume, not args.no_covers, args.dry_run, not args.no_genre)
        print(f"\n{GRN if r=='ok' else RED}  [{r}]{R} {args.slug} {f'({fmt_size(nb)})' if nb else ''}")
        return

    # ── Đọc catalog ──
    jsonl = outdir/"catalog_full.jsonl"
    if not jsonl.exists():
        print(f"{RED}[!]{R} Chưa có catalog. Chạy trước:\n    python fetch_catalog.py --output-dir {outdir}")
        return

    items = []
    with open(jsonl, encoding="utf-8") as f:
        for line in f:
            try: items.append(json.loads(line.strip()))
            except: pass
    print(f"{GRY}[catalog]{R} {len(items):,} truyện  (từ file, không fetch API)\n")

    # ── Build genre catalog mode ──
    if args.build_genre_catalog:
        # Fetch genre cho các slug chưa có
        missing = [i for i in items if i["slug"] not in genre_cache]
        if missing:
            print(f"{YLW}[genre]{R} Fetch genre cho {len(missing):,} truyện chưa có...")
            for idx, item in enumerate(missing, 1):
                fetch_genres(item["slug"], genre_cache)
                if idx % 50 == 0:
                    save_json(outdir/"genre_cache.json", genre_cache)
                    print(f"  {idx}/{len(missing)} genres fetched...", end="\r")
                time.sleep(0.2)
            save_json(outdir/"genre_cache.json", genre_cache)
        build_genre_catalog(items, genre_cache, outdir)
        return

    # ── Filter ──
    work = items
    if args.retry_failed:
        fail_set = set(state["fail"].keys())
        work     = [i for i in items if i["slug"] in fail_set]
        print(f"{YLW}[filter]{R} Retry: {len(work)}")
    else:
        if args.status:
            work = [i for i in work if args.status in i.get("manga_status_slug","")]
        if args.min_ch > 0:
            work = [i for i in work if i.get("chapter_count",0) >= args.min_ch]
        if args.max_ch > 0:
            work = [i for i in work if i.get("chapter_count",0) <= args.max_ch]
        if args.search:
            q = args.search.lower()
            work = [i for i in work if q in i.get("title","").lower()]
    # 🎯 Sắp xếp ưu tiên:
    #   Nóm 1: Chương >= 500 & Hoàn Thành (xếp số chương từ cao -> thấp)
    #   Nhóm 2: Chương >= 500 & Chưa Hoàn Thành (xếp số chương từ cao -> thấp)
    #   Nhóm 3: Chương < 500  & Hoàn Thành (xếp số chương từ cao -> thấp)
    #   Nhóm 4: Chương < 500  & Chưa Hoàn Thành (xếp số chương từ cao -> thấp)
    def sort_priority(x):
        chs = x.get("chapter_count", 0)
        is_done = "hoan-thanh" in x.get("manga_status_slug", "")
        if chs >= 500 and is_done:
            grp = 0
        elif chs >= 500 and not is_done:
            grp = 1
        elif chs < 500 and is_done:
            grp = 2
        else:
            grp = 3
        return (grp, -chs)

    work = sorted(work, key=sort_priority)

    total = len(work)
    print(f"{GRY}[queue]{R}  {BOLD}{total:,}{R} truyện cần xử lý")
    if args.resume:
        done_in_queue = sum(1 for i in work if i["slug"] in state["ok"])
        print(f"         ~{done_in_queue:,} đã OK sẽ bị skip")
    if args.dry_run:
        print(f"\n{YLW}[DRY RUN — chỉ liệt kê]{R}\n")
    else:
        print(f"\n  Bắt đầu {datetime.now().strftime('%H:%M:%S')} | Delay {args.delay}s/truyện\n")

    # ── Download loop ──
    ok_n = skip_n = fail_n = 0
    bytes_total = 0
    t0 = time.time()

    for i, item in enumerate(work, 1):
        slug  = item.get("slug","")
        title = item.get("title","")
        chs   = item.get("chapter_count",0)
        ms    = item.get("manga_status","")

        # Print item header
        g_cached = genre_cache.get(slug,[])
        g_str    = " ".join(GENRE_NAMES.get(g,"") for g in g_cached[:2] if g in GENRE_NAMES)
        short_t  = title[:42]
        status_icon = "🔄" if "dang" in ms.lower() else "✅"
        print(f"\n{GRY}┌{'─'*66}{R}")
        print(f"{GRY}│{R} {BOLD}[{i:>5}/{total}]{R}  {WHT}{short_t}{R}")
        print(f"{GRY}│{R}  {DIM}{slug[:55]}{R}  {GRY}{chs}ch {status_icon}{R}  {MGT}{g_str}{R}")

        r, nb = dl_one(item, outdir, state, state_path, genre_cache,
                       resume=args.resume, covers=not args.no_covers,
                       dry=args.dry_run, fetch_genre=not args.no_genre,
                       item_timeout=args.item_timeout)

        if r=="ok":
            ok_n += 1; bytes_total += nb
            tor_dl_count[0] += 1
            print(f"{GRY}│{R}  {GRN}✓ OK{R}  {fmt_size(nb)}  sha:{state['ok'][slug]['sha256'][:10]}…")
            genres = state["ok"][slug].get("genres",[])
            if genres:
                g_display = "  ".join(GENRE_NAMES.get(g,g) for g in genres[:5])
                print(f"{GRY}│{R}  {MGT}{g_display}{R}")

            # Đổi IP Tor tự động mỗi 15 lần tải thành công
            if use_tor_global[0] and tor_dl_count[0] % 15 == 0:
                print(f"\n{YLW}[🔄 AUTO IP ROTATION] Đã tải {tor_dl_count[0]} truyện -> Đổi IP mới...{R}")
                renew_tor_circuit()
        elif r=="skip":
            skip_n += 1
            print(f"{GRY}│{R}  {GRY}⤼ Skip{R}")
        else:
            fail_n += 1
            err = state["fail"].get(slug,{}).get("err","?")
            print(f"{GRY}│{R}  {RED}✗ Fail{R}: {err[:60]}")

        print(f"{GRY}└{'─'*66}{R}")

        # Stats bar
        elapsed  = time.time()-t0
        dl_done  = ok_n + fail_n  # không tính skip vào rate
        rate     = dl_done/elapsed*3600 if dl_done>0 and elapsed>0 else 0
        remaining= total - i
        eta_s    = remaining/(dl_done/elapsed) if dl_done>0 and elapsed>0 else 0
        pct_done = i/total*100
        bar      = progress_bar(pct_done, 28)
        print(f"  {bar}  {CYN}{fmt_size(bytes_total)}{R}  "
              f"{YLW}{rate:.0f}/h{R}  {GRY}ETA {fmt_time(eta_s)}{R}")

        if not args.dry_run: time.sleep(args.delay)

    # ── Summary ──
    elapsed = time.time()-t0
    print(f"\n\n{BOLD}{'═'*68}{R}")
    print(f"{BOLD}  HOÀN THÀNH — {datetime.now().strftime('%H:%M:%S')}{R}")
    print(f"{'─'*68}")
    print(f"  {GRN}✓ OK:    {ok_n:>6,}{R}")
    print(f"  {GRY}⤼ Skip:  {skip_n:>6,}{R}")
    print(f"  {RED}✗ Fail:  {fail_n:>6,}{R}")
    print(f"  📦 Total: {total:>6,}")
    print(f"  💾 Size:  {fmt_size(bytes_total)}")
    print(f"  ⏱  Time:  {fmt_time(elapsed)}")
    print(f"{'─'*68}")
    if state["fail"]:
        print(f"\n  {YLW}[!]{R} {len(state['fail'])} lỗi → dùng --retry-failed --resume")

    # Tự động build genre catalog khi xong
    if ok_n > 0 and not args.dry_run and not args.no_genre:
        print(f"\n{BLU}[auto]{R} Đang cập nhật genre catalog...")
        save_json(outdir/"genre_cache.json", genre_cache)
        build_genre_catalog(items, genre_cache, outdir)

    print(f"\n{BOLD}{'═'*68}{R}\n")

if __name__ == "__main__":
    main()
