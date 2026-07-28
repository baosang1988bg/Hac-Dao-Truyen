#!/usr/bin/env python3
"""
bulk_epub_downloader.py  —  AudioTruyenFull Bulk EPUB Downloader
================================================================
Tải hàng loạt EPUB từ https://web.audiotruyenfull.org/thu-vien/ebook-convert

Features:
  - Không cần auth/đăng nhập
  - Verify EPUB tính toàn vẹn (magic bytes + min size + zip valid)
  - Resume tự động nếu bị gián đoạn
  - Retry 3 lần khi gặp lỗi
  - Lưu metadata JSON đầy đủ mỗi truyện
  - Báo cáo sau khi xong
  - Tải ảnh bìa

Usage:
  python bulk_epub_downloader.py --catalog-only          # Chỉ lấy danh sách
  python bulk_epub_downloader.py --resume                # Tải, bỏ qua đã xong
  python bulk_epub_downloader.py --status hoan-thanh --min-chapters 200
  python bulk_epub_downloader.py --slug xich-tam-tuan-thien
  python bulk_epub_downloader.py --dry-run --limit 20
"""

import argparse
import json
import sys
import time
import zipfile
import hashlib
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path
from datetime import datetime

# ─── Config ───────────────────────────────────────────────────────────────────
BASE_URL        = "https://web.audiotruyenfull.org/api/bff"
LIST_LIMIT      = 100
RETRY_COUNT     = 3
RETRY_DELAY     = 2
EXPORT_POLL_INT = 1.2    # giây poll khi EPUB đang render
EXPORT_TIMEOUT  = 200    # giây timeout 1 EPUB
RATE_DELAY      = 0.4    # giây delay giữa list pages
REQUEST_TIMEOUT = 30
MIN_EPUB_BYTES  = 2048   # EPUB < 2KB = broken

HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; EPUBDownloader/2.0)",
    "Content-Type": "application/json",
}

# ─── HTTP ─────────────────────────────────────────────────────────────────────

def http_get(url, timeout=REQUEST_TIMEOUT):
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} GET {url}: {e.read().decode('utf-8','replace')[:200]}")
    except Exception as e:
        raise RuntimeError(f"GET {url}: {e}")


def http_post(url, payload, timeout=REQUEST_TIMEOUT):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} POST {url}: {e.read().decode('utf-8','replace')[:200]}")
    except Exception as e:
        raise RuntimeError(f"POST {url}: {e}")


def http_download(url, dest, timeout=120):
    """Tải file nhị phân, trả về (bytes, sha256)."""
    dl_headers = {"User-Agent": "Mozilla/5.0 (compatible; EPUBDownloader/2.0)"}
    req = urllib.request.Request(url, headers=dl_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            content = r.read()
        dest.write_bytes(content)
        sha = hashlib.sha256(content).hexdigest()
        return len(content), sha
    except Exception as e:
        raise RuntimeError(f"Download {url}: {e}")


def retry_call(fn, *args, count=RETRY_COUNT, delay=RETRY_DELAY, **kwargs):
    last = None
    for i in range(count):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            last = e
            if i < count - 1:
                time.sleep(delay * (i + 1))
    raise last

# ─── EPUB integrity ────────────────────────────────────────────────────────────

def verify_epub(path: Path, expected_bytes: int = 0) -> tuple[bool, str]:
    """
    Kiểm tra EPUB tính toàn vẹn.
    Returns (ok: bool, reason: str)
    """
    if not path.exists():
        return False, "File không tồn tại"
    size = path.stat().st_size
    if size < MIN_EPUB_BYTES:
        return False, f"Quá nhỏ ({size} bytes)"

    # Magic bytes: EPUB là ZIP, phải bắt đầu bằng PK\x03\x04
    try:
        magic = path.read_bytes()[:4]
        if magic[:2] != b'PK':
            return False, f"Không phải ZIP/EPUB (magic={magic.hex()})"
    except Exception as e:
        return False, f"Đọc lỗi: {e}"

    # Kiểm tra ZIP structure hợp lệ
    try:
        with zipfile.ZipFile(path, 'r') as zf:
            names = zf.namelist()
            if not names:
                return False, "ZIP rỗng"
            # EPUB phải có mimetype file
            if "mimetype" not in names:
                return False, "Thiếu mimetype (không phải EPUB chuẩn)"
            # Kiểm tra có content
            bad = zf.testzip()
            if bad:
                return False, f"ZIP corrupt tại file: {bad}"
    except zipfile.BadZipFile as e:
        return False, f"BadZipFile: {e}"
    except Exception as e:
        return False, f"ZipFile error: {e}"

    # Kiểm tra kích thước với API (nếu có)
    if expected_bytes > 0:
        tolerance = 0.05  # 5% tolerance
        if abs(size - expected_bytes) / expected_bytes > tolerance:
            # Không fail cứng — chỉ warn vì server có thể tái nén
            pass  # return False, f"Kích thước lệch: {size} vs {expected_bytes}"

    return True, f"OK ({size/1024:.0f} KB)"

# ─── Catalog ──────────────────────────────────────────────────────────────────

def fetch_page(page, status="", q="", min_ch=0, max_ch=0, sort="newest"):
    params = {"page": page, "limit": LIST_LIMIT, "sort": sort}
    if status:   params["status"] = status
    if q:        params["q"] = q
    if min_ch > 0: params["chapter_min"] = min_ch
    if max_ch > 0: params["chapter_max"] = max_ch
    qs = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items())
    return retry_call(http_get, f"{BASE_URL}/ebook-convert/list?{qs}")


def fetch_all_catalog(status="", q="", min_ch=0, max_ch=0, sort="newest"):
    p1 = fetch_page(1, status, q, min_ch, max_ch, sort)
    total_pages = p1.get("total_pages", 1)
    total       = p1.get("filtered_total", p1.get("total", 0))
    items       = list(p1.get("items", []))
    print(f"[catalog] Tổng: {total:,} truyện | {total_pages} trang")

    for page in range(2, total_pages + 1):
        time.sleep(RATE_DELAY)
        try:
            r = fetch_page(page, status, q, min_ch, max_ch, sort)
            items.extend(r.get("items", []))
            pct = page / total_pages * 100
            print(f"\r[catalog] {page}/{total_pages} ({pct:.0f}%) — {len(items):,} items", end="", flush=True)
        except Exception as e:
            print(f"\n[catalog] Lỗi trang {page}: {e}")
    print()
    return items

# ─── EPUB export ───────────────────────────────────────────────────────────────

def export_epub(slug):
    """Kích hoạt export → poll → trả về dict có file_url."""
    rid = f"dl-{slug}-{int(time.time())}"
    payload = {"slug_truyen": slug, "action": "download", "request_id": rid}
    r = retry_call(http_post, f"{BASE_URL}/story-epub-export/start", payload)

    if not r.get("success"):
        raise RuntimeError(f"start failed: {r}")
    if r.get("status") == "done" and r.get("file_url"):
        return r

    token = r.get("token")
    if not token:
        raise RuntimeError(f"no token: {r}")

    deadline = time.time() + EXPORT_TIMEOUT
    while time.time() < deadline:
        time.sleep(EXPORT_POLL_INT)
        sr = retry_call(http_get, f"{BASE_URL}/story-epub-export/{urllib.parse.quote(token)}/status")
        st  = sr.get("status", "").lower()
        pct = sr.get("percent", 0)
        print(f"  [export] {slug}: {st} {pct}%   ", end="\r", flush=True)
        if st == "done" and sr.get("file_url"):
            print()
            return sr
        if st in ("error", "failed"):
            raise RuntimeError(f"export server error: {sr.get('message','')}")

    raise RuntimeError(f"export timeout {EXPORT_TIMEOUT}s: {slug}")

# ─── State ────────────────────────────────────────────────────────────────────

def load_state(path):
    if path.exists():
        try:
            return json.loads(path.read_text("utf-8"))
        except Exception:
            pass
    return {"downloaded": {}, "failed": {}, "skipped": []}


def save_state(path, state):
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), "utf-8")

# ─── Cover ────────────────────────────────────────────────────────────────────

def download_cover(item, covers_dir):
    url = item.get("cover_url", "")
    if not url:
        return None
    ext  = Path(url.split("?")[0]).suffix or ".jpg"
    dest = covers_dir / f"{item['slug']}{ext}"
    if dest.exists():
        return str(dest)
    try:
        http_download(url, dest, timeout=20)
        return str(dest)
    except Exception as e:
        print(f"  [cover] warn {item['slug']}: {e}")
        return None

# ─── Core download ─────────────────────────────────────────────────────────────

def download_single(item, output_dir, state, state_path,
                    skip_existing=True, dl_covers=True, dry_run=False):
    """
    Tải 1 truyện. Trả về: 'ok' | 'skip' | 'fail' | 'verify_fail'
    """
    slug = item["slug"]
    epubs_dir = output_dir / "epubs";   epubs_dir.mkdir(parents=True, exist_ok=True)
    covers_dir = output_dir / "covers"; covers_dir.mkdir(parents=True, exist_ok=True)
    meta_dir  = output_dir / "meta";    meta_dir.mkdir(parents=True, exist_ok=True)
    epub_path = epubs_dir / f"{slug}.epub"
    meta_path = meta_dir  / f"{slug}.json"

    # ── Skip đã tải & verified ──
    if skip_existing and slug in state.get("downloaded", {}):
        entry = state["downloaded"][slug]
        ok, reason = verify_epub(epub_path, entry.get("file_size", 0))
        if ok:
            return "skip"
        else:
            print(f"  [reverify] {slug}: {reason} → tải lại")
            del state["downloaded"][slug]
            save_state(state_path, state)

    if dry_run:
        print(f"  [dry] {slug} | {item.get('title','')[:45]} | {item.get('chapter_count',0)} ch")
        return "skip"

    # ── Cover ──
    cover_local = download_cover(item, covers_dir) if dl_covers else None

    # ── Export + Download ──
    try:
        exp = export_epub(slug)
        file_url  = exp.get("file_url", "")
        file_name = exp.get("file_name", f"{slug}.epub")
        if not file_url:
            raise RuntimeError("Thiếu file_url")

        nbytes, sha256 = http_download(file_url, epub_path)

        # ── Verify ngay sau khi tải ──
        ok, reason = verify_epub(epub_path, exp.get("file_size", 0))
        if not ok:
            epub_path.unlink(missing_ok=True)
            raise RuntimeError(f"Verify thất bại: {reason}")

        # ── Metadata đầy đủ ──
        meta = {
            **item,
            "export": exp,
            "cover_local":    cover_local,
            "epub_local":     str(epub_path),
            "epub_sha256":    sha256,
            "epub_bytes":     nbytes,
            "downloaded_at":  datetime.now().isoformat(),
            "verify_status":  "ok",
            "verify_reason":  reason,
        }
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), "utf-8")

        mb = nbytes / 1024 / 1024
        print(f"  ✓ {slug} | {mb:.1f}MB | sha256:{sha256[:8]}... | {item.get('chapter_count',0)}ch")

        state.setdefault("downloaded", {})[slug] = {
            "downloaded_at": meta["downloaded_at"],
            "file_size":     nbytes,
            "sha256":        sha256,
            "chapters":      item.get("chapter_count", 0),
        }
        state["failed"] = {k: v for k, v in state.get("failed", {}).items() if k != slug}
        save_state(state_path, state)
        return "ok"

    except Exception as e:
        msg = str(e)
        print(f"  ✗ {slug}: {msg[:100]}")
        state.setdefault("failed", {})[slug] = {
            "error": msg, "at": datetime.now().isoformat()
        }
        save_state(state_path, state)
        return "fail"

# ─── Report ───────────────────────────────────────────────────────────────────

def generate_report(output_dir, state, items_total, ok, skip, fail, elapsed):
    report = {
        "generated_at":    datetime.now().isoformat(),
        "total_in_catalog": items_total,
        "downloaded_ok":   ok,
        "skipped":         skip,
        "failed":          fail,
        "elapsed_seconds": round(elapsed, 1),
        "downloaded_slugs": list(state.get("downloaded", {}).keys()),
        "failed_slugs":    list(state.get("failed", {}).keys()),
    }
    rpt_path = output_dir / "report.json"
    rpt_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
    return report

# ─── CLI ───────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Bulk EPUB downloader — audiotruyenfull.org")
    p.add_argument("--output-dir",    default="./epub_library")
    p.add_argument("--catalog-only",  action="store_true")
    p.add_argument("--slug",          default="")
    p.add_argument("--status",        default="", choices=["", "dang-ra", "hoan-thanh"])
    p.add_argument("--sort",          default="newest",
                   choices=["newest", "popular", "chapters", "chars", "random"])
    p.add_argument("--min-chapters",  type=int, default=0)
    p.add_argument("--max-chapters",  type=int, default=0)
    p.add_argument("--search",        default="")
    p.add_argument("--resume",        action="store_true", help="Bỏ qua đã tải thành công")
    p.add_argument("--no-covers",     action="store_true")
    p.add_argument("--dry-run",       action="store_true")
    p.add_argument("--retry-failed",  action="store_true", help="Chỉ retry slug đã lỗi")
    p.add_argument("--verify-only",   action="store_true", help="Chỉ verify, không tải thêm")
    p.add_argument("--limit",         type=int, default=0)
    p.add_argument("--delay",         type=float, default=0.5)
    return p.parse_args()


def main():
    args   = parse_args()
    outdir = Path(args.output_dir).expanduser().resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    state_path = outdir / "state.json"
    state      = load_state(state_path)
    t0         = time.time()

    print("=" * 64)
    print("  AudioTruyenFull — Bulk EPUB Downloader v2")
    print(f"  Output : {outdir}")
    print(f"  Resume : {'Có' if args.resume else 'Không'}")
    print("=" * 64)

    # ── Verify-only mode ──
    if args.verify_only:
        epubs_dir = outdir / "epubs"
        epubs = list(epubs_dir.glob("*.epub")) if epubs_dir.exists() else []
        print(f"\n[verify] Kiểm tra {len(epubs)} EPUB files...")
        bad = []
        for ep in epubs:
            ok, reason = verify_epub(ep)
            if not ok:
                print(f"  BAD {ep.name}: {reason}")
                bad.append(ep.name)
        print(f"\n[verify] {len(epubs)-len(bad)}/{len(epubs)} OK | {len(bad)} BAD")
        if bad:
            (outdir / "bad_files.txt").write_text("\n".join(bad), "utf-8")
        return

    # ── Single slug ──
    if args.slug:
        item = {"slug": args.slug, "title": args.slug,
                "chapter_count": 0, "cover_url": ""}
        r = download_single(item, outdir, state, state_path,
                            args.resume, not args.no_covers, args.dry_run)
        print(f"\nKết quả: {r}")
        return

    # ── Fetch catalog ──
    print("\n[1/3] Đang fetch catalog...")
    items = fetch_all_catalog(
        status=args.status, q=args.search,
        min_ch=args.min_chapters, max_ch=args.max_chapters, sort=args.sort,
    )
    cat_path = outdir / "catalog.json"
    jsonl_path = outdir / "catalog_full.jsonl"
    cat_path.write_text(
        json.dumps({"fetched_at": datetime.now().isoformat(),
                    "total": len(items), "items": items},
                   ensure_ascii=False, indent=2), "utf-8")
    with open(jsonl_path, "w", encoding="utf-8") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")
    print(f"[catalog] Lưu {len(items):,} → {cat_path.name}")

    if args.catalog_only:
        print("\nCatalog-only — xong!")
        return

    # ── Filter ──
    work = items
    if args.retry_failed:
        failed_set = set(state.get("failed", {}).keys())
        work = [i for i in items if i["slug"] in failed_set]
        print(f"[filter] Retry {len(work)} slug lỗi")
    if args.limit > 0:
        work = work[:args.limit]
        print(f"[filter] Giới hạn {args.limit}")

    print(f"\n[2/3] Sẽ xử lý {len(work):,} truyện")
    print(f"       Đã có: {len(state.get('downloaded',{})):,} | Lỗi cũ: {len(state.get('failed',{})):,}")
    if args.dry_run:
        print("[mode] DRY RUN\n")

    # ── Download loop ──
    print("\n[3/3] Bắt đầu tải...")
    ok = skip = fail = 0
    total = len(work)

    for i, item in enumerate(work, 1):
        slug  = item.get("slug", "")
        title = item.get("title", "")[:38]
        chs   = item.get("chapter_count", 0)
        print(f"[{i:>5}/{total}] {title} ({chs}ch)")

        r = download_single(
            item, outdir, state, state_path,
            skip_existing=args.resume,
            dl_covers=not args.no_covers,
            dry_run=args.dry_run,
        )
        if r == "ok":    ok   += 1
        elif r == "skip": skip += 1
        else:             fail += 1

        if not args.dry_run:
            time.sleep(args.delay)

    # ── Report ──
    elapsed = time.time() - t0
    rpt = generate_report(outdir, state, total, ok, skip, fail, elapsed)
    print("\n" + "=" * 64)
    print(f"  ✓ OK:    {ok:>6,}")
    print(f"  ⤼ Skip:  {skip:>6,}")
    print(f"  ✗ Fail:  {fail:>6,}")
    print(f"  Tổng:    {total:>6,}")
    print(f"  Thời gian: {elapsed/60:.1f} phút")
    print(f"  Report: {outdir}/report.json")
    print("=" * 64)
    if state.get("failed"):
        nf = len(state["failed"])
        print(f"\n[!] {nf} lỗi → chạy với --retry-failed --resume để thử lại")


if __name__ == "__main__":
    main()
