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
import hashlib
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
    queue = _load_republish_queue(slug)
    for num, old_fp in sorted(failed.items()):
        # Bản lỗi đã lên site qua Worker API → r2_key = sha256(nội dung). Worker
        # chỉ cho thay nội dung khi gửi kèm đúng key cũ (expected_r2_key).
        old_key = f"{slug}/content/{hashlib.sha256(old_fp.read_bytes()).hexdigest()}.md"
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
            queue[str(num)] = old_key
        else:
            still_failed.append(num)
    _save_republish_queue(slug, queue)

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


def _republish_queue_path(slug: str) -> Path:
    return NOVELS_DIR / slug / "republish_pending.json"


def _load_republish_queue(slug: str) -> dict:
    path = _republish_queue_path(slug)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _save_republish_queue(slug: str, queue: dict):
    path = _republish_queue_path(slug)
    if queue:
        path.write_text(json.dumps(queue, ensure_ascii=False, indent=2), encoding="utf-8")
    elif path.exists():
        path.unlink()


def publish_republish_queue(slug: str, novel_meta: dict) -> bool:
    """Đẩy các chương đã dịch lại (republish_pending.json: {số chương: r2_key
    bản lỗi đang trên site}) lên thay bản lỗi. Hàng đợi được commit cùng repo
    nên sync thất bại thì lượt sau vẫn thử lại; chỉ xóa khi đẩy thành công."""
    queue = _load_republish_queue(slug)
    if not queue:
        return True
    pending = [{"number": int(n), "expected_r2_key": k} for n, k in sorted(queue.items(), key=lambda kv: int(kv[0]))]
    print(f"♻️ [{slug}] Công bố bản dịch lại thay bản lỗi: {[c['number'] for c in pending]}")
    if sync_via_worker_api(slug, novel_meta, pending, BASE_DIR) is not True:
        print(f"❌ [{slug}] Chưa công bố được bản dịch lại; giữ hàng đợi cho lượt sau.")
        return False
    _save_republish_queue(slug, {})
    return True


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

    # Lập chỉ mục 1 lần (trước đây quét lại cả thư mục cho TỪNG chương — chậm
    # khi đẩy hàng trăm chương). Giữ file đầu tiên theo thứ tự glob như cũ.
    file_by_num = {}
    for fp in trans_dir.glob("*.md"):
        file_by_num.setdefault(get_chapter_number(get_title(fp), fp.name), fp)
    chapters_to_sync = []
    for c in pending:
        ch_num = c["number"]
        found_file = file_by_num.get(ch_num)
        if not found_file:
            print(f"⚠️ [{slug}] Không tìm thấy file dịch cho Chương {ch_num}")
            continue
        content = found_file.read_text(encoding="utf-8")
        first_line = content.splitlines()[0] if content else f"Chương {ch_num}"
        title = first_line.lstrip("# ").strip()
        item = {"filename": found_file.name, "title": title, "number": ch_num, "content": content}
        if c.get("expected_r2_key"):
            item["expected_r2_key"] = c["expected_r2_key"]
        chapters_to_sync.append(item)

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
    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    ann_text = f"🔥 Vừa dịch & cập nhật thành công Chương {last_chapter} cho truyện '{title}'!"
    ann_data = []
    if ANNOUNCEMENTS_JSON.exists():
        try:
            with open(ANNOUNCEMENTS_JSON, encoding='utf-8') as f:
                ann_data = json.load(f)
        except Exception:
            pass
    ann_data.insert(0, {"date": now_str, "text": ann_text, "novel_slug": slug, "chapter": last_chapter})
    with open(ANNOUNCEMENTS_JSON, 'w', encoding='utf-8') as f:
        json.dump(ann_data[:5], f, ensure_ascii=False, indent=2)


# Phần code mà deploy đưa lên production. Thay đổi chưa commit ở đây nghĩa là
# đang sửa dở → không được deploy.
DEPLOY_CODE_PATHS = ["src", "frontend", "wrangler.jsonc", "package.json"]


def _deploy_blocker() -> str | None:
    """Lý do KHÔNG được deploy (None = an toàn). Cập nhật chương chỉ là dữ liệu
    D1/R2 nên không cần deploy; nhiều agent/máy (Claude Code, Antigravity) có
    working tree khác nhau, deploy từ bản sửa dở hoặc lệch main sẽ đè
    production của nhau."""
    if os.getenv("HACDAO_AUTO_DEPLOY", "").strip() != "1":
        return "chương mới là dữ liệu D1/R2, không cần deploy (bật HACDAO_AUTO_DEPLOY=1 nếu thật sự cần)"
    status = subprocess.run(["git", "status", "--porcelain", "--", *DEPLOY_CODE_PATHS],
                            cwd=BASE_DIR, capture_output=True, text=True)
    if status.stdout.strip():
        return "code có thay đổi chưa commit:\n" + status.stdout.rstrip()
    subprocess.run(["git", "fetch", "-q", "origin", "main"], cwd=BASE_DIR, capture_output=True, text=True)
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=BASE_DIR, capture_output=True, text=True).stdout.strip()
    origin = subprocess.run(["git", "rev-parse", "origin/main"], cwd=BASE_DIR, capture_output=True, text=True).stdout.strip()
    if not head or head != origin:
        return f"HEAD ({head[:7]}) khác origin/main ({origin[:7]}) — pull/push trước khi deploy"
    return None


def deploy_to_cloudflare() -> bool:
    """Deploy frontend và worker lên Cloudflare — CHỈ khi _deploy_blocker() cho phép."""
    blocker = _deploy_blocker()
    if blocker:
        print(f"\n⏭️  Bỏ qua deploy Cloudflare: {blocker}")
        return False
    deploy_start = datetime.now()
    print(f"\n📦 [{deploy_start:%Y-%m-%d %H:%M:%S}] Bắt đầu tiến trình deploy Cloudflare Workers...")
    try:
        # npm run deploy = build frontend rồi wrangler deploy (thiếu build sẽ
        # đẩy frontend/dist cũ hoặc thiếu hẳn assets).
        if sys.platform == "win32":
            cmd = ["cmd.exe", "/c", "npm.cmd run deploy"]
        else:
            cmd = ["npm", "run", "deploy"]
        subprocess.run(cmd, cwd=BASE_DIR, check=True)
        elapsed = (datetime.now() - deploy_start).total_seconds()
        print(f"✅ [{datetime.now():%Y-%m-%d %H:%M:%S}] Deploy Cloudflare hoàn tất thành công! (Thời gian deploy: {elapsed:.1f}s)")
        return True
    except Exception as e:
        elapsed = (datetime.now() - deploy_start).total_seconds()
        print(f"⚠️ [{datetime.now():%Y-%m-%d %H:%M:%S}] Lỗi khi deploy Cloudflare ({elapsed:.1f}s): {e}")
        return False


def check_and_translate_novel(slug: str) -> bool:
    """Kiểm tra + dịch + đồng bộ chương mới cho 1 truyện.
    Trả True nếu chạy xong không lỗi (kể cả khi không có gì mới hoặc chưa đủ
    chương để công bố), False nếu có lỗi thật sự (nguồn lỗi, dịch lỗi, sync lỗi)."""
    t_start = datetime.now()
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
    if not publish_republish_queue(slug, novel_meta):
        retry_ok = False
    if still_failed:
        retry_ok = False

    catalog = []
    if catalog_json_path.exists():
        with open(catalog_json_path, encoding='utf-8') as f:
            catalog = json.load(f)

    last_num = novel_meta.get("last_chapter_number", 0)
    novel_display_title = novel_meta.get("title", slug)
    print(f"⏰ [{t_start:%Y-%m-%d %H:%M:%S}] [{novel_display_title}] Chương hiện tại: {last_num}")

    try:
        remote_chapters = fetch_latest_chapters(f"https://r.jina.ai/{source_index_url}")
    except Exception as e:
        print(f"⚠️ [{slug}] Lỗi khi lấy thông tin trang nguồn: {e}")
        return False

    pending = sorted((c for c in remote_chapters if c["number"] > last_num), key=lambda x: x["number"])
    if not pending:
        print(f"✅ [{novel_display_title}] Chưa có chương mới nào trên nguồn (vẫn ở chương {last_num}).")
        return retry_ok

    print(f"🔥 [{novel_display_title}] Phát hiện {len(pending)} chương mới: {[c['number'] for c in pending]}")
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

    t_trans_start = datetime.now()
    print(f"🚀 [{t_trans_start:%Y-%m-%d %H:%M:%S}] [{novel_display_title}] Bắt đầu dịch {len(pending)} chương mới...")
    subprocess.run(
        [sys.executable, "-u", "main.py", "translate", "--novel", slug, "--chapters", str(len(pending))],
        cwd=BASE_DIR, check=True,
    )
    t_trans_done = datetime.now()

    if novel_json_path.exists():
        try:
            with open(novel_json_path, encoding='utf-8') as f:
                novel_meta = json.load(f)
        except Exception:
            pass

    t_sync_start = datetime.now()
    print(f"☁️ [{t_sync_start:%Y-%m-%d %H:%M:%S}] [{novel_display_title}] Đang đồng bộ lên Cloudflare R2/D1...")
    cf_token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
    synced = False
    # wrangler đẩy MỌI file từ first_new trở đi, kể cả bản lỗi → khi batch có
    # chương lỗi thì chỉ đi đường Worker API (có lọc bản lỗi).
    batch_has_failed = bool(set(find_failed_chapters(novel_dir / "translated")) & {c["number"] for c in pending})
    if cf_token and not batch_has_failed:
        try:
            sub_env = os.environ.copy()
            sub_env.setdefault("HACDAO_ALLOW_CLOUD_WRITES", "true")
            subprocess.run(
                [sys.executable, "-u", "migrate_to_cloudflare.py", "--slug", slug, "--from-chapter", str(first_new)],
                cwd=BASE_DIR, check=True, env=sub_env,
            )
            print(f"✅ [{novel_display_title}] Đã đồng bộ thành công qua wrangler CLI.")
            synced = True
        except Exception as e:
            print(f"⚠️ [{novel_display_title}] Lỗi khi đồng bộ qua wrangler CLI: {e}")

    if not synced:
        synced = sync_via_worker_api(slug, novel_meta, pending, BASE_DIR)
    t_sync_done = datetime.now()

    if synced is None:
        print(f"ℹ️ [{novel_display_title}] Đã lưu tiến độ dịch; chưa đủ chương để công bố công khai.")
        return retry_ok
    if not synced:
        print(f"❌ [{novel_display_title}] Đồng bộ thất bại; không công bố thông báo thành công")
        return False

    # Deploy Cloudflare
    t_deploy_start = datetime.now()
    deploy_to_cloudflare()
    t_deploy_done = datetime.now()

    t_end = datetime.now()
    novel_meta["last_updated_at"] = t_end.strftime('%Y-%m-%d %H:%M:%S')
    with open(novel_json_path, 'w', encoding='utf-8') as f:
        json.dump(novel_meta, f, ensure_ascii=False, indent=2)

    _append_announcement(slug, novel_meta.get("title", slug), pending[-1]["number"])

    print(f"\n{'='*75}")
    print(f"📊 BÁO CÁO TIẾN TRÌNH CẬP NHẬT & DEPLOY — {novel_meta.get('title', slug)}")
    print(f"{'='*75}")
    print(f"  • Thời điểm bắt đầu   : {t_start:%Y-%m-%d %H:%M:%S}")
    print(f"  • Thời gian dịch       : {t_trans_start:%H:%M:%S} -> {t_trans_done:%H:%M:%S} ({(t_trans_done - t_trans_start).total_seconds():.1f}s)")
    print(f"  • Thời gian sync D1/R2 : {t_sync_start:%H:%M:%S} -> {t_sync_done:%H:%M:%S} ({(t_sync_done - t_sync_start).total_seconds():.1f}s)")
    print(f"  • Thời gian deploy     : {t_deploy_start:%H:%M:%S} -> {t_deploy_done:%H:%M:%S} ({(t_deploy_done - t_deploy_start).total_seconds():.1f}s)")
    print(f"  • Thời điểm hoàn tất   : {t_end:%Y-%m-%d %H:%M:%S}")
    print(f"  • Tổng thời gian chạy  : {(t_end - t_start).total_seconds():.1f}s")
    print(f"{'='*75}\n")
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
