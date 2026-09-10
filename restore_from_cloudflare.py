#!/usr/bin/env python3
import os
import sys
import json
import subprocess
import tempfile
from pathlib import Path
from datetime import datetime

from security_utils import validate_slug, safe_join, safe_novel_dir
from tools.sync_budget import atomic_json

# Set output encoding to UTF-8
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

NOVELS_BASE_DIR = Path("novels")
D1_DB_NAME = "hacdao-db"
R2_BUCKET = "hacdao-chapters"
SYNC_STATE_PATH = Path(".sync_state.json")


def q(s) -> str:
    """Escape chuỗi cho SQL literal (nhân đôi dấu nháy đơn) — dùng cho slug ghép trực tiếp."""
    return "'" + str(s).replace("'", "''") + "'"


def get_wrangler():
    """Đường dẫn wrangler an toàn, không qua shell (giống migrate_to_cloudflare.py)."""
    ext = '.cmd' if os.name == 'nt' else ''
    local = os.path.join(os.getcwd(), 'node_modules', '.bin', f'wrangler{ext}')
    if os.path.exists(local):
        return [local]
    return [f'npx{ext}', '-y', 'wrangler']


def run_command(cmd_list):
    """
    Chạy lệnh trực tiếp KHÔNG qua shell — tránh command injection nếu
    r2_key/filename lấy từ D1 chứa ký tự đặc biệt. Trước đây dùng
    `cmd /c " ".join(cmd_list)` với shell=True để né PowerShell execution
    policy trên Windows; thay bằng gọi thẳng wrangler.cmd/npx.cmd (get_wrangler)
    vẫn chạy được trên Windows mà không cần shell.
    """
    result = subprocess.run(
        cmd_list,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding='utf-8'
    )
    return result

def query_d1(sql):
    """Execute SQL query on Cloudflare D1 and parse JSON results."""
    # Write SQL to temporary file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.sql', encoding='utf-8', delete=False) as f:
        f.write(sql)
        tmp_name = f.name

    try:
        cmd = get_wrangler() + [
            "d1", "execute", D1_DB_NAME,
            "--remote", f"--file={tmp_name}", "--json"
        ]
        res = run_command(cmd)
        if res.returncode != 0:
            print(f"[D1-Error] Failed to execute query. Stderr: {res.stderr}")
            return None

        # Clean wrangler output to find JSON
        stdout = res.stdout.strip()
        data = None
        for i, line in enumerate(stdout.splitlines()):
            line = line.strip()
            if line.startswith('['):
                try:
                    data = json.loads('\n'.join(stdout.splitlines()[i:]))
                    break
                except json.JSONDecodeError:
                    continue
        
        if not data:
            return []
        
        return data[0].get('results', [])
    except Exception as e:
        print(f"[D1-Exception] {e}")
        return None
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)

# Side-channel lưu stderr của lần gọi download_r2_object() gần nhất, để phân
# biệt "object không tồn tại" với "lỗi tải khác" (mạng/auth/timeout) mà không
# phải đổi kiểu trả về bool của download_r2_object (nhiều nơi khác — bao gồm
# test hiện có — đang gọi hàm này và chỉ quan tâm True/False).
_R2_LAST_ERROR = {"stderr": ""}

# Các cụm từ wrangler in ra khi object THẬT SỰ không tồn tại trên R2 (khác với
# lỗi mạng/xác thực/timeout). Nếu wrangler đổi câu chữ, worst case là bị phân
# loại nhầm thành 'error' (an toàn — giữ dữ liệu cũ) chứ không nhầm thành
# 'absent' (nguy hiểm — có thể ghi đè dữ liệu cũ bằng rỗng).
_R2_ABSENT_MARKERS = ("does not exist", "no such key", "not found", "the specified key")


def download_r2_object(r2_key, local_path):
    """Download an object from Cloudflare R2 bucket."""
    local_path = Path(local_path)
    local_path.parent.mkdir(parents=True, exist_ok=True)

    # Không dùng shell nên không cần tự quote path — subprocess truyền
    # nguyên argv, path có khoảng trắng vẫn hoạt động đúng.
    cmd = get_wrangler() + [
        "r2", "object", "get",
        f"{R2_BUCKET}/{r2_key}", f"--file={local_path}", "--remote"
    ]
    res = run_command(cmd)
    _R2_LAST_ERROR["stderr"] = res.stderr or ""
    return res.returncode == 0


def _r2_glossary_status(r2_key, local_path):
    """
    Tải glossary.json và phân loại kết quả rõ ràng thành 3 nhóm (E01):
      - 'ok'     : tải thành công (chưa chắc parse được — kiểm tra ở nơi gọi)
      - 'absent' : object THẬT SỰ không tồn tại trên R2 (stderr xác nhận) —
                   trường hợp hợp lệ của truyện mới, glossary rỗng là đúng.
      - 'error'  : lỗi khác (mạng, auth, timeout, quyền truy cập...) — KHÔNG
                   được coi như "không tồn tại"; nơi gọi phải giữ glossary cũ.

    Khi download_r2_object() bị monkeypatch trong test (trả về bool đơn
    thuần, không có stderr thật), hàm mặc định phân loại 'error' thay vì đoán
    'absent' — an toàn hơn vì tránh xoá nhầm glossary cũ.
    """
    _R2_LAST_ERROR["stderr"] = ""
    if download_r2_object(r2_key, local_path):
        return "ok"
    stderr = (_R2_LAST_ERROR.get("stderr") or "").lower()
    if any(marker in stderr for marker in _R2_ABSENT_MARKERS):
        return "absent"
    return "error"

def restore_chapter(slug, chapter, destination):
    """Download to a temporary file; publish only complete standalone/bundle content."""
    import base64
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="hacdao-restore-") as tmp:
        temp = Path(tmp) / "chapter.md"
        if download_r2_object(chapter['r2_key'], temp):
            temp.replace(destination)
            return True
        manifest_path = Path(tmp) / "manifest.json"
        if not download_r2_object(f"{slug}/bundles/manifest.json", manifest_path):
            return False
        try:
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            key = manifest.get(chapter['filename'])
            if not isinstance(key, str) or not key.startswith(f"{slug}/bundles/"):
                return False
            bundle_path = Path(tmp) / "bundle.json"
            if not download_r2_object(key, bundle_path):
                return False
            bundle = json.loads(bundle_path.read_text(encoding='utf-8'))
            encoded = base64.urlsafe_b64encode(chapter['filename'].encode()).decode().rstrip('=')
            content = bundle.get(encoded)
            if not isinstance(content, str):
                return False
            temp.write_text(content, encoding='utf-8')
            temp.replace(destination)
            return True
        except (ValueError, TypeError, AttributeError):
            return False


_REQUIRED_PROFILE_FIELDS = ("slug", "title")


def _validate_profile(profile: dict) -> list:
    """Kiểm tra các thành phần bắt buộc trước khi publish novel.json (E01)."""
    problems = []
    for field_name in _REQUIRED_PROFILE_FIELDS:
        if not profile.get(field_name):
            problems.append(f"thiếu {field_name}")
    if not isinstance(profile.get("glossary"), dict):
        problems.append("glossary không phải object")
    return problems


def restore():
    print("=== STARTING RESTORE FROM CLOUDFLARE D1 + R2 ===")

    # 1. Fetch all novels from D1
    print("Fetching novels list from Cloudflare D1...")
    novels = query_d1("SELECT * FROM novels;")
    if novels is None:
        print("[-] Could not retrieve novels. Please make sure wrangler is authenticated.")
        return False

    if not novels:
        print("[!] No novels found in Cloudflare D1 database.")
        return True

    print(f"[+] Found {len(novels)} novels in database.")

    sync_state = json.loads(SYNC_STATE_PATH.read_text(encoding="utf-8")) if SYNC_STATE_PATH.exists() else {}
    had_failure = False

    for novel in novels:
        slug = novel['slug']
        title = novel['title']
        print(f"\nRestoring novel: {title} ({slug})...")

        # slug đến từ D1 (dữ liệu remote) — validate trước khi ghép path để
        # chặn traversal nếu D1 từng bị chèn dữ liệu bất thường.
        try:
            validate_slug(slug)
        except Exception as e:
            print(f"  [-] Bỏ qua novel có slug không hợp lệ ({slug!r}): {e}")
            had_failure = True
            continue

        novel_dir = Path(safe_novel_dir(slug))
        trans_dir = novel_dir / "translated"
        raw_dir = novel_dir / "text_raw"

        trans_dir.mkdir(parents=True, exist_ok=True)
        raw_dir.mkdir(parents=True, exist_ok=True)

        # 2. Download glossary from R2 — phân biệt rõ absent / lỗi tải / lỗi
        # parse (E01). Chỉ 'absent' (thật sự không tồn tại) mới được coi là
        # glossary rỗng hợp lệ; mọi lỗi khác phải giữ glossary cũ trên đĩa.
        glossary_key = f"{slug}/glossary.json"
        temp_glossary_path = Path(tempfile.gettempdir()) / f"{slug}_glossary.json"
        novel_json_path = novel_dir / "novel.json"

        existing_profile = None
        if novel_json_path.exists():
            try:
                existing_profile = json.loads(novel_json_path.read_text(encoding="utf-8"))
            except Exception as e:
                print(f"  [!] Không đọc được novel.json cũ để dự phòng: {e}")
                existing_profile = None

        print("  -> Downloading glossary from R2...")
        glossary = None
        try:
            status = _r2_glossary_status(glossary_key, temp_glossary_path)
            if status == "ok":
                try:
                    with open(temp_glossary_path, "r", encoding="utf-8") as f:
                        parsed = json.load(f)
                    if not isinstance(parsed, dict):
                        raise ValueError("glossary.json không phải object JSON")
                    glossary = parsed
                    print(f"  [+] Loaded {len(glossary)} glossary terms.")
                except Exception as e:
                    print(f"  [-] Lỗi parse glossary.json: {e}")
                    glossary = None
            elif status == "absent":
                glossary = {}
                print("  [i] Chưa có glossary.json trên R2 (truyện mới) — dùng glossary rỗng.")
            else:  # 'error': mạng/auth/timeout... — không phải absent
                print("  [-] Lỗi tải glossary.json (không phải do không tồn tại).")
        finally:
            if temp_glossary_path.exists():
                os.unlink(temp_glossary_path)

        if glossary is None:
            # Lỗi tải/parse thật sự: KHÔNG suy đoán glossary rỗng. Giữ profile
            # cũ nếu có; nếu không có gì để giữ thì bỏ qua publish novel.json
            # cho truyện này (vẫn tiếp tục tải chương bên dưới, best-effort).
            if existing_profile is not None and isinstance(existing_profile.get("glossary"), dict):
                glossary = existing_profile["glossary"]
                print("  [i] Giữ nguyên glossary/profile cũ trên đĩa do lỗi tải R2.")
            else:
                print("  [-] Không có glossary mới lẫn profile cũ để giữ — bỏ qua publish novel.json.")
                had_failure = True

        # 3. Recreate novel.json — stage rồi validate đầy đủ thành phần bắt
        # buộc trước khi publish (atomic_json ghi temp cùng thư mục rồi
        # os.replace atomic), tránh để lại novel.json nửa vời.
        if glossary is not None:
            novel_profile = {
                "slug": slug,
                "title": title,
                "original_title": novel.get('original_title', ''),
                "author": novel.get('author', ''),
                "source_url": novel.get('source_url', ''),
                "genre": novel.get('genre', 'cultivation'),
                "last_translated_url": novel.get('last_translated_url', ''),
                "last_chapter_number": novel.get('last_chapter_number', 0),
                "total_chapters": novel.get('total_chapters', 0),
                "glossary": glossary,
                "translation_style": novel.get('translation_style', ''),
                "notes": novel.get('notes', '')
            }

            problems = _validate_profile(novel_profile)
            if problems:
                print(f"  [-] Profile không hợp lệ ({', '.join(problems)}) — không publish, giữ dữ liệu cũ.")
                had_failure = True
            else:
                atomic_json(novel_json_path, novel_profile)
                print(f"  [+] Recreated novel.json")

        # 4. Fetch chapters list from D1
        print("  -> Fetching chapters list from D1...")
        chapters = query_d1(f"SELECT filename, title, chapter_number, r2_key FROM chapters WHERE novel_slug={q(slug)};")
        if chapters is None:
            print("  [-] Failed to fetch chapters list from D1.")
            had_failure = True
            continue
            
        print(f"  [+] Found {len(chapters)} chapters in D1.")
        
        # 5. Download chapters from R2
        downloaded_count = 0
        skipped_count = 0
        failed_count = 0
        
        last_filename = ""
        max_chap_num = -1
        
        for idx, chap in enumerate(chapters, 1):
            filename = chap['filename']
            r2_key = chap['r2_key']
            chap_num = chap['chapter_number']
            
            # Keep track of last chapter info for sync state
            if chap_num > max_chap_num:
                max_chap_num = chap_num
                last_filename = filename
                
            # filename đến từ D1 — safe_join chặn traversal ('../', path tuyệt
            # đối, null byte) trước khi ghi ra đĩa.
            try:
                local_chap_path = Path(safe_join(str(trans_dir), filename))
            except Exception as e:
                print(f"    [-] Bỏ qua chapter có filename không hợp lệ ({filename!r}): {e}")
                failed_count += 1
                continue

            if local_chap_path.exists():
                skipped_count += 1
                continue

            # print(f"    [{idx}/{len(chapters)}] Downloading {filename}...")
            if restore_chapter(slug, chap, local_chap_path):
                downloaded_count += 1
            else:
                failed_count += 1
                
        print(f"  [+] Chapter Sync complete: {downloaded_count} downloaded, {skipped_count} skipped (existed), {failed_count} failed.")
        
        if failed_count:
            had_failure = True
            continue

        # 6. Build sync state info
        sync_state[slug] = {
            "last_synced_at": datetime.now().isoformat(),
            "last_chapter_number": max_chap_num if max_chap_num >= 0 else novel.get('last_chapter_number', 0),
            "last_filename": last_filename,
            "total_synced": len(chapters) - failed_count
        }

    # Giữ checkpoint cũ của truyện lỗi; chỉ cập nhật truyện phục hồi đủ.
    atomic_json(SYNC_STATE_PATH, sync_state)
    if had_failure:
        print("\n[-] Restore incomplete; failed novels retain their previous checkpoint.")
        return False
    print("\n=== RESTORE COMPLETED SUCCESSFULLY! ===")
    return True

if __name__ == "__main__":
    raise SystemExit(0 if restore() else 1)
