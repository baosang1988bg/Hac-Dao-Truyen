#!/usr/bin/env python3
"""
tools/auto_check_novel.py — Tự động kiểm tra & dịch chương mới cho MỌI
truyện có bật `auto_check.enabled` trong novel.json.

Tổng quát hóa từ tools/auto_check_lanh_chua.py (trước đây hardcode 1 truyện
duy nhất: NOVEL_SLUG + SOURCE_PAGE cố định trong code). Thêm truyện mới vào
cơ chế auto-check-and-translate giờ chỉ cần khai báo trong novel.json:

    "auto_check": {
      "enabled": true,
      "source_index_url": "https://www.novel543.com/<id>/"
    }

không cần viết script/workflow riêng cho từng truyện nữa.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

BASE_DIR = Path(__file__).parent.parent
NOVELS_DIR = BASE_DIR / "novels"
ANNOUNCEMENTS_JSON = BASE_DIR / "frontend" / "src" / "content" / "announcements.json"

# novel543 là site duy nhất có parser lúc này (mục lục đọc qua Jina Reader
# ra dạng markdown "[第N章 tiêu đề](url)"). Thêm site mới → thêm 1 hàm parse
# tương ứng, KHÔNG sửa vào regex chung này cho site khác.
_CHAPTER_LINK_RE = re.compile(r'\[第(\d+)章\s*([^\]]+)\]\((https?://[^\s\)]+)')


def fetch_latest_chapters(reader_url: str):
    """Lấy danh sách chương mới nhất từ 1 URL (đã qua Jina Reader để vượt
    chặn bot). Trả list [{number, original_title, raw_title, url}]."""
    print(f"🔍 Đang truy cập trang nguồn qua Jina Reader: {reader_url}...")
    req = urllib.request.Request(
        reader_url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            # Trang danh mục thay đổi thường xuyên. Jina Reader có cache URL;
            # luôn buộc lấy bản mới để cron không bỏ sót chương vừa đăng.
            "X-No-Cache": "true",
            "X-Cache-Tolerance": "0",
        }
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        content = resp.read().decode("utf-8", errors="ignore")

    matches = _CHAPTER_LINK_RE.findall(content)
    chapters = []
    for num_str, title_orig, url in matches:
        ch_num = int(num_str)
        chapters.append({
            "number": ch_num,
            "original_title": f"第{ch_num}章 {title_orig.strip()}",
            "raw_title": title_orig.strip(),
            "url": url,
        })
    return chapters


def discover_auto_check_slugs():
    """Danh sách slug các truyện có `auto_check.enabled: true` trong novel.json."""
    slugs = []
    for novel_json in sorted(NOVELS_DIR.glob("*/novel.json")):
        try:
            with open(novel_json, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        if (data.get("auto_check") or {}).get("enabled"):
            slugs.append(novel_json.parent.name)
    return slugs


def find_failed_chapters(trans_dir: Path) -> dict:
    """{số chương: file} cho các bản dịch lỗi (đầu file có "[Translation failed")."""
    from chapter_utils import is_failed_translation
    from migrate_to_cloudflare import get_chapter_number, get_title
    failed = {}
    if not trans_dir.exists():
        return failed
    for fp in sorted(trans_dir.glob("*.md")):
        if is_failed_translation(str(fp)):
            num = get_chapter_number(get_title(fp), fp.name)
            if num:
                failed[num] = fp
    return failed


def retry_failed_chapters(slug: str):
    """Dịch lại các chương lỗi của 1 truyện. Trả (đã_sửa, vẫn_lỗi) — list số chương.

    - Bản dịch mới được pipeline lưu theo tên tiêu đề tiếng Việt; ta ghi đè nó
      vào ĐÚNG tên file lỗi cũ để Worker upsert (theo filename) đè dòng D1 cũ,
      không tạo chương trùng số trên site.
    - `main.py translate --url` kéo last_chapter_number lùi về chương vừa dịch
      lại → khôi phục tiến độ cũ, nếu không lượt sau sẽ quét lại chương đã có.
    """
    novel_dir = NOVELS_DIR / slug
    trans_dir = novel_dir / "translated"
    novel_json_path = novel_dir / "novel.json"
    failed = find_failed_chapters(trans_dir)
    if not failed:
        return [], []

    catalog_path = novel_dir / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8")) if catalog_path.exists() else []
    url_by_num = {item.get("number"): item.get("url") for item in catalog}
    progress = {k: json.loads(novel_json_path.read_text(encoding="utf-8")).get(k)
                for k in ("last_translated_url", "last_chapter_number")}

    print(f"🔁 [{slug}] Dịch lại {len(failed)} chương lỗi: {sorted(failed)}")
    fixed, still_failed = [], []
    for num, old_fp in sorted(failed.items()):
        url = url_by_num.get(num)
        if not url:
            print(f"⚠️ [{slug}] Chương {num} không có URL trong catalog.json, bỏ qua.")
            still_failed.append(num)
            continue
        subprocess.run(
            [sys.executable, "-u", "main.py", "translate", "--novel", slug, "--url", url, "--chapters", "1"],
            cwd=BASE_DIR, check=False,
        )
        for fp in trans_dir.glob(f"Chương {num} *_VI.md"):
            if fp != old_fp and "[Translation failed" not in fp.read_text(encoding="utf-8")[:400]:
                os.replace(fp, old_fp)
                break
        if old_fp.exists() and "[Translation failed" not in old_fp.read_text(encoding="utf-8")[:400]:
            fixed.append(num)
        else:
            still_failed.append(num)

    meta = json.loads(novel_json_path.read_text(encoding="utf-8"))
    meta.update(progress)
    novel_json_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    failed_json = novel_dir / "failed_chapters.json"
    if failed_json.exists():
        fixed_urls = {url_by_num.get(n) for n in fixed}
        entries = [e for e in json.loads(failed_json.read_text(encoding="utf-8")) if e.get("url") not in fixed_urls]
        if entries:
            failed_json.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            failed_json.unlink()

    print(f"🔁 [{slug}] Đã sửa: {fixed} — vẫn lỗi: {still_failed}")
    return fixed, still_failed


def sync_via_worker_api(slug: str, novel_meta: dict, pending: list, base_dir: Path):
    """Đồng bộ trực tiếp lên Cloudflare D1 + R2 qua Worker API
    /api/admin/sync-novel bằng HACDAO_SYNC_KEY (dùng khi không có
    CLOUDFLARE_API_TOKEN để chạy wrangler CLI)."""
    sync_key = os.getenv("HACDAO_SYNC_KEY", "").strip()
    if not sync_key:
        print(f"ℹ️ [{slug}] Không có HACDAO_SYNC_KEY để đồng bộ qua Worker API.")
        return False

    host = os.getenv("HACDAO_SYNC_HOST", "hac-dao-truyen.nguyenbaosang1998.workers.dev")
    trans_dir = base_dir / "novels" / slug / "translated"
    if not trans_dir.exists():
        print(f"⚠️ [{slug}] Thư mục dịch {trans_dir} không tồn tại.")
        return False

    from migrate_to_cloudflare import get_chapter_number, get_title
    # Bản dịch lỗi ("[Translation failed ...") KHÔNG BAO GIỜ được lên public —
    # lọc ra, đẩy phần còn lại, và trả False để run CI đỏ (chương lỗi nằm lại
    # trong failed_chapters.json, lượt sau retry_failed_chapters dịch lại).
    failed_nums = set(find_failed_chapters(trans_dir))
    if failed_nums & {c["number"] for c in pending}:
        print(f"❌ [{slug}] Bỏ qua chương dịch lỗi, không công bố: {sorted(failed_nums)}")
    publishable = [c for c in pending if c["number"] not in failed_nums]
    if len(publishable) != len(pending):
        if publishable:
            sync_via_worker_api(slug, novel_meta, publishable, base_dir)
        return False

    chapters_to_sync = []
    for c in pending:
        ch_num = c["number"]
        found_file = None
        for fp in trans_dir.glob("*.md"):
            if get_chapter_number(get_title(fp), fp.name) == ch_num:
                found_file = fp
                break
        if not found_file:
            print(f"⚠️ [{slug}] Không tìm thấy file dịch cho Chương {ch_num}")
            continue
        content = found_file.read_text(encoding="utf-8")
        first_line = content.splitlines()[0] if content else f"Chương {ch_num}"
        title = first_line.lstrip("# ").strip()
        chapters_to_sync.append({"filename": found_file.name, "title": title, "number": ch_num, "content": content})

    if len(chapters_to_sync) != len(pending):
        # Chưa đủ chương (nguồn chặn giữa chừng...) — KHÔNG phải lỗi hạ tầng,
        # trả None để caller không coi đây là failure thật (vẫn all-or-nothing:
        # không công bố batch dở dang lên public).
        print(f"[{slug}] Thiếu bản dịch; không công bố batch chưa đủ chương")
        return None
    if not chapters_to_sync:
        print(f"⚠️ [{slug}] Không có nội dung chương nào để sync qua Worker API.")
        return None

    print(f"📡 [{slug}] Đang đẩy {len(chapters_to_sync)} chương lên Cloudflare D1 + R2 qua Worker API...")
    payload = {
        "slug": slug,
        "title": novel_meta.get("title", slug),
        "original_title": novel_meta.get("original_title", ""),
        "author": novel_meta.get("author", "Unknown"),
        "genre": novel_meta.get("genre", "cultivation"),
        "total_chapter_count": novel_meta.get("total_chapters", len(chapters_to_sync)),
        "is_first_chunk": True,
        "chapters": chapters_to_sync,
    }

    from tools.sync_budget import budget_from_env
    from tools.sync_transport import send_chunk
    budget = budget_from_env()
    conn = None
    try:
        for start in range(0, len(chapters_to_sync), 25):
            payload['chapters'] = chapters_to_sync[start:start + 25]
            payload['is_first_chunk'] = start == 0
            result, conn = send_chunk(conn, payload, host=host, sync_key=sync_key, budget=budget)
            if not result['success']:
                print(f"[{slug}] Sync thất bại: {result.get('error')}")
                return False
        return True
    finally:
        if conn:
            conn.close()


def _append_announcement(slug: str, title: str, last_chapter: int):
    today_str = datetime.now().strftime('%Y-%m-%d')
    ann_text = f"🔥 Vừa dịch & cập nhật thành công Chương {last_chapter} cho truyện '{title}'!"
    ann_data = []
    if ANNOUNCEMENTS_JSON.exists():
        try:
            with open(ANNOUNCEMENTS_JSON, encoding='utf-8') as f:
                ann_data = json.load(f)
        except Exception:
            pass
    ann_data.insert(0, {"date": today_str, "text": ann_text, "novel_slug": slug, "chapter": last_chapter})
    with open(ANNOUNCEMENTS_JSON, 'w', encoding='utf-8') as f:
        json.dump(ann_data[:5], f, ensure_ascii=False, indent=2)


def check_and_translate_novel(slug: str) -> bool:
    """Kiểm tra + dịch + đồng bộ chương mới cho 1 truyện.
    Trả True nếu chạy xong không lỗi (kể cả khi không có gì mới hoặc chưa đủ
    chương để công bố), False nếu có lỗi thật sự (nguồn lỗi, dịch lỗi, sync lỗi)."""
    novel_dir = NOVELS_DIR / slug
    novel_json_path = novel_dir / "novel.json"
    catalog_json_path = novel_dir / "catalog.json"

    if not novel_json_path.exists():
        print(f"⚠️ [{slug}] Không tìm thấy novel.json, bỏ qua.")
        return False

    (novel_dir / "translated").mkdir(parents=True, exist_ok=True)
    (novel_dir / "text_raw").mkdir(parents=True, exist_ok=True)

    with open(novel_json_path, encoding='utf-8') as f:
        novel_meta = json.load(f)

    auto_cfg = novel_meta.get("auto_check") or {}
    source_index_url = auto_cfg.get("source_index_url")
    if not source_index_url:
        print(f"⚠️ [{slug}] Thiếu auto_check.source_index_url trong novel.json, bỏ qua.")
        return True  # cấu hình thiếu không phải lỗi hạ tầng, không cần fail cả run

    # Chương dịch lỗi từ lượt trước (vd hết quota → "No backend available"):
    # dịch lại + công bố bản sửa trước khi xét chương mới. Còn lỗi → run đỏ.
    retry_ok = True
    fixed, still_failed = retry_failed_chapters(slug)
    if fixed:
        with open(novel_json_path, encoding='utf-8') as f:
            novel_meta = json.load(f)
        if not sync_via_worker_api(slug, novel_meta, [{"number": n} for n in fixed], BASE_DIR):
            print(f"❌ [{slug}] Không công bố được bản dịch lại: {fixed}")
            retry_ok = False
    if still_failed:
        retry_ok = False

    catalog = []
    if catalog_json_path.exists():
        with open(catalog_json_path, encoding='utf-8') as f:
            catalog = json.load(f)

    last_num = novel_meta.get("last_chapter_number", 0)
    print(f"⏰ [{datetime.now():%Y-%m-%d %H:%M:%S}] [{slug}] Chương hiện tại trong hệ thống: {last_num}")

    try:
        remote_chapters = fetch_latest_chapters(f"https://r.jina.ai/{source_index_url}")
    except Exception as e:
        print(f"⚠️ [{slug}] Lỗi khi lấy thông tin trang nguồn: {e}")
        return False

    pending = sorted((c for c in remote_chapters if c["number"] > last_num), key=lambda x: x["number"])
    if not pending:
        print(f"✅ [{slug}] Chưa có chương mới nào trên nguồn (vẫn ở chương {last_num}).")
        return retry_ok

    print(f"🔥 [{slug}] Phát hiện {len(pending)} chương mới: {[c['number'] for c in pending]}")
    first_new = pending[0]["number"]

    for c in pending:
        if not any(item.get("number") == c["number"] for item in catalog):
            catalog.append({
                "number": c["number"],
                "title": f"Chương {c['number']}",
                "original_title": c["original_title"],
                "url": c["url"],
                "original_chapter_number": c["number"],
                "filename": f"Chương {c['number']}_VI.md",
            })
    with open(catalog_json_path, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

    novel_meta["total_chapters"] = pending[-1]["number"]
    with open(novel_json_path, 'w', encoding='utf-8') as f:
        json.dump(novel_meta, f, ensure_ascii=False, indent=2)

    print(f"🚀 [{slug}] Đang chạy dịch {len(pending)} chương mới...")
    subprocess.run(
        [sys.executable, "-u", "main.py", "translate", "--novel", slug, "--chapters", str(len(pending))],
        cwd=BASE_DIR, check=True,
    )

    if novel_json_path.exists():
        try:
            with open(novel_json_path, encoding='utf-8') as f:
                novel_meta = json.load(f)
        except Exception:
            pass

    print(f"☁️ [{slug}] Đang đồng bộ lên Cloudflare R2/D1...")
    cf_token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
    synced = False
    # wrangler đẩy MỌI file từ first_new trở đi, kể cả bản lỗi → khi batch có
    # chương lỗi thì chỉ đi đường Worker API (có lọc bản lỗi).
    batch_has_failed = bool(set(find_failed_chapters(novel_dir / "translated")) & {c["number"] for c in pending})
    if cf_token and not batch_has_failed:
        try:
            subprocess.run(
                [sys.executable, "-u", "migrate_to_cloudflare.py", "--slug", slug, "--from-chapter", str(first_new)],
                cwd=BASE_DIR, check=True,
            )
            print(f"✅ [{slug}] Đã đồng bộ thành công qua wrangler CLI.")
            synced = True
        except Exception as e:
            print(f"⚠️ [{slug}] Lỗi khi đồng bộ qua wrangler CLI: {e}")

    if not synced:
        synced = sync_via_worker_api(slug, novel_meta, pending, BASE_DIR)
    if synced is None:
        print(f"ℹ️ [{slug}] Đã lưu tiến độ dịch; chưa đủ chương để công bố công khai.")
        return retry_ok
    if not synced:
        print(f"❌ [{slug}] Đồng bộ thất bại; không công bố thông báo thành công")
        return False

    _append_announcement(slug, novel_meta.get("title", slug), pending[-1]["number"])
    print(f"🎉 [{slug}] Tự động dịch và đồng bộ chương mới thành công!")
    return retry_ok


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", help="Chỉ kiểm tra 1 truyện cụ thể (mặc định: tất cả truyện có auto_check.enabled)")
    args = parser.parse_args()

    slugs = [args.slug] if args.slug else discover_auto_check_slugs()
    if not slugs:
        print("ℹ️ Không có truyện nào bật auto_check.enabled trong novel.json.")
        return

    print(f"📚 Sẽ kiểm tra {len(slugs)} truyện: {slugs}")
    failed = []
    for slug in slugs:
        try:
            ok = check_and_translate_novel(slug)
        except Exception as e:
            # 1 truyện lỗi không được chặn các truyện còn lại trong cùng lượt chạy.
            print(f"❌ [{slug}] Lỗi không mong đợi: {e}")
            ok = False
        if not ok:
            failed.append(slug)

    if failed:
        print(f"❌ Các truyện thất bại: {failed}")
        sys.exit(1)


if __name__ == "__main__":
    main()
