"""
tools/backup_novels.py
----------------------
Backup dữ liệu truyện + dữ liệu người dùng (E02).

Một bản backup gồm:
  - novel.json, catalog.json, normalize_log.json (metadata + glossary — glossary
    được lưu ngay trong novel.json, không phải file riêng)
  - synopsis.md (nếu có)
  - failed_chapters.json (nếu có)
  - translated/, extras/ (và text_raw/ nếu --include-raw)
  - *.epub của mỗi truyện (trừ khi --no-epub)
  - data/users.db (SQLite local: users/sessions/bookmarks/reading_progress/
    comments/novel_requests) — backup bằng SQLite Online Backup API
    (sqlite3.Connection.backup), AN TOÀN khi có ghi đồng thời / WAL, khác với
    copy file .db trực tiếp (có thể đọc phải trạng thái nửa vời).
  - D1 remote (--include-d1, cần network + wrangler đã `wrangler login`):
    xuất toàn bộ bảng nội dung (novels/chapters) VÀ bảng user (users/
    user_sessions/bookmarks/reading_progress/comments/novel_requests) qua
    `query_d1()` tái dùng từ restore_from_cloudflare.py — KHÔNG có cách nào
    export D1 remote mà không cần mạng; nếu wrangler lỗi/không có mạng, mỗi
    bảng được ghi rõ status "error", KHÔNG bịa dữ liệu rỗng thành công.
  - R2 manifest/checksum (--r2, cũng cần network): tải bundles/manifest.json
    + glossary.json hiện có trên R2 cho từng truyện để đối chiếu sau này.

MANIFEST.json (trong zip + file `.manifest.json` cạnh zip) ghi rõ phạm vi đã
backup (thành phần nào có/không, D1/R2 có chạy hay bị skip vì sao) và sha256 +
size của từng file — restore_full() dùng để verify.

Không rotate (xoá) bản backup cũ trước khi bản mới được verify checksum
thành công.

Chạy:
  python3 tools/backup_novels.py                       # backup local
  python3 tools/backup_novels.py --include-d1           # + xuất D1 remote (cần network)
  python3 tools/backup_novels.py --r2                   # + upload R2 + snapshot R2 manifest/checksum
  python3 tools/backup_novels.py --restore backups/novels-20260716.zip --slug X --dest /tmp/x   # restore 1 truyện (chế độ cũ)
  python3 tools/backup_novels.py --restore backups/novels-20260716.zip --dest /tmp/full-restore  # restore toàn bộ + verify checksum
Lịch tuần (macOS): crontab -e →
  0 3 * * 1 cd /path/to/HacDaoTruyen && python3 tools/backup_novels.py --r2 --include-d1
"""

import os
import sys
import glob
import json
import hashlib
import sqlite3
import zipfile
import argparse
import subprocess
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

# Tái dùng helper D1/R2 đã có (wrangler không-qua-shell, phân loại lỗi) thay
# vì viết lại — restore_from_cloudflare.py nằm cùng phạm vi sửa đổi của đợt
# việc này.
from restore_from_cloudflare import query_d1, download_r2_object  # noqa: E402

NOVELS_DIR = os.path.join(ROOT, "novels")
BACKUP_DIR = os.path.join(ROOT, "backups")
USERS_DB_PATH = os.path.join(ROOT, "data", "users.db")
KEEP = 4
R2_BUCKET = "hacdao-chapters"

# Các bảng D1 cần export — cả nội dung truyện lẫn dữ liệu user đều nằm chung
# 1 D1 database (hacdao-db, xem wrangler.jsonc + schema.sql). Nếu 1 bảng
# chưa tồn tại (migration chưa chạy) thì query lỗi, được ghi nhận status
# 'error' thay vì giả vờ thành công với 0 dòng.
D1_TABLES = [
    "novels", "chapters", "users", "user_sessions",
    "bookmarks", "reading_progress", "comments", "novel_requests",
]


# ── Tiện ích ─────────────────────────────────────────────────────────────

def sha256_file(path: str, chunk_size: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            h.update(chunk)
    return h.hexdigest()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── SQLite backup an toàn (WAL) ─────────────────────────────────────────

def backup_sqlite_db(src_path: str, dest_path: str) -> bool:
    """
    Backup 1 file SQLite bằng Online Backup API (sqlite3.Connection.backup),
    KHÔNG copy file trực tiếp. Copy trực tiếp có thể đọc phải trạng thái nửa
    vời khi có ghi đồng thời (đặc biệt với journal_mode=WAL, dữ liệu mới nhất
    có thể còn nằm trong -wal chưa checkpoint). Backup API của SQLite tự xử
    lý khoá/đọc nhất quán ngay cả khi có writer khác đang hoạt động.

    Trả về False (không raise) nếu DB nguồn không tồn tại — coi là hợp lệ với
    một cài đặt local chưa từng có ai đăng ký/đăng nhập.
    """
    if not os.path.isfile(src_path):
        return False
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    if os.path.exists(dest_path):
        os.remove(dest_path)
    src_conn = sqlite3.connect(src_path)
    try:
        dest_conn = sqlite3.connect(dest_path)
        try:
            src_conn.backup(dest_conn)
        finally:
            dest_conn.close()
    finally:
        src_conn.close()
    return True


# ── D1 remote export (network) ──────────────────────────────────────────

def backup_d1(dest_dir: str, tables=None) -> dict:
    """
    Xuất toàn bộ bảng D1 remote (nội dung truyện + user) ra file JSON, tái
    dùng query_d1() (wrangler d1 execute --remote --json). Cần network +
    `wrangler login` từ trước — không có cách nào chạy thật mà không cần
    mạng; khi lỗi, mỗi bảng được ghi status 'error' rõ ràng thay vì bịa dữ
    liệu hay coi lỗi là "không có dữ liệu".
    """
    tables = list(tables) if tables else list(D1_TABLES)
    os.makedirs(dest_dir, exist_ok=True)
    result = {"attempted": True, "tables": {}, "status": "ok"}
    for table in tables:
        rows = query_d1(f"SELECT * FROM {table};")
        if rows is None:
            result["tables"][table] = {
                "status": "error",
                "note": "Không export được (wrangler lỗi / không có mạng / chưa đăng nhập / bảng chưa tồn tại).",
            }
            result["status"] = "partial"
            continue
        out_path = os.path.join(dest_dir, f"{table}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)
        result["tables"][table] = {"status": "ok", "count": len(rows)}
    if all(t["status"] == "error" for t in result["tables"].values()):
        result["status"] = "failed"
    return result


def backup_r2_manifests(slugs, dest_dir: str) -> dict:
    """
    Tải bundles/manifest.json + glossary.json hiện có trên R2 cho từng slug
    (nếu có) để lưu kèm checksum, phục vụ đối chiếu sau này. Cần network —
    chỉ gọi khi --r2. Không tồn tại trên R2 (truyện chưa từng sync qua
    R2/bundle) là kết quả hợp lệ, không phải lỗi.
    """
    result = {"attempted": True, "slugs": {}}
    for slug in slugs:
        entry = {}
        for name, key in (
            ("bundles_manifest", f"{slug}/bundles/manifest.json"),
            ("glossary", f"{slug}/glossary.json"),
        ):
            local_dir = os.path.join(dest_dir, slug)
            os.makedirs(local_dir, exist_ok=True)
            local_path = os.path.join(local_dir, f"{name}.json")
            ok = download_r2_object(key, local_path)
            if ok and os.path.isfile(local_path):
                entry[name] = {"status": "ok", "sha256": sha256_file(local_path)}
            else:
                entry[name] = {"status": "absent_or_error"}
                if os.path.isfile(local_path):
                    os.remove(local_path)
        result["slugs"][slug] = entry
    return result


# ── Tạo backup local ─────────────────────────────────────────────────────

def _iter_novel_files(slug_dir: str, include_raw: bool, include_epub: bool):
    """Sinh (đường dẫn tuyệt đối) của mọi file thuộc phạm vi backup cho 1 truyện."""
    for sub in ("novel.json", "catalog.json", "normalize_log.json",
                "synopsis.md", "failed_chapters.json"):
        p = os.path.join(slug_dir, sub)
        if os.path.isfile(p):
            yield p

    if include_epub:
        for p in sorted(glob.glob(os.path.join(slug_dir, "*.epub"))):
            yield p

    subdirs = ["translated", "extras"] + (["text_raw"] if include_raw else [])
    for sub in subdirs:
        sd = os.path.join(slug_dir, sub)
        if not os.path.isdir(sd):
            continue
        for root, _, files in os.walk(sd):
            for fname in files:
                yield os.path.join(root, fname)


def create_backup(include_raw: bool = False, include_epub: bool = True,
                   include_d1: bool = False, include_r2: bool = False) -> str:
    """
    Tạo 1 file zip backup có timestamp + MANIFEST.json (trong zip và file
    sidecar `<zip>.manifest.json`) ghi rõ phạm vi đã backup và checksum từng
    file. KHÔNG rotate bản cũ ở đây — gọi rotate() riêng, chỉ sau khi
    verify_backup() xác nhận bản mới hợp lệ.
    """
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = os.path.join(BACKUP_DIR, f"novels-{ts}.zip")

    slugs = sorted(
        s for s in os.listdir(NOVELS_DIR)
        if os.path.isdir(os.path.join(NOVELS_DIR, s))
    ) if os.path.isdir(NOVELS_DIR) else []

    manifest_files = []
    tmp_extra_dirs = []

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for slug in slugs:
            slug_dir = os.path.join(NOVELS_DIR, slug)
            for p in _iter_novel_files(slug_dir, include_raw, include_epub):
                # arcname luôn "novels/<slug>/..." tương đối theo NOVELS_DIR
                # (không theo ROOT) — để test có thể trỏ NOVELS_DIR vào
                # tmp_path mà không sinh ra arcname chứa "..".
                arcname = "novels/" + os.path.relpath(p, NOVELS_DIR).replace(os.sep, "/")
                z.write(p, arcname)
                manifest_files.append({
                    "path": arcname.replace(os.sep, "/"),
                    "sha256": sha256_file(p),
                    "size": os.path.getsize(p),
                })

        # data/users.db — backup an toàn qua SQLite Online Backup API rồi mới
        # đưa vào zip (không copy file .db thô).
        users_db_present = os.path.isfile(USERS_DB_PATH)
        if users_db_present:
            tmp_db_dir = out + ".users_db_tmp"
            os.makedirs(tmp_db_dir, exist_ok=True)
            tmp_extra_dirs.append(tmp_db_dir)
            tmp_db_path = os.path.join(tmp_db_dir, "users.db")
            backup_sqlite_db(USERS_DB_PATH, tmp_db_path)
            arcname = "data/users.db"
            z.write(tmp_db_path, arcname)
            manifest_files.append({
                "path": arcname,
                "sha256": sha256_file(tmp_db_path),
                "size": os.path.getsize(tmp_db_path),
            })

        d1_result = {"attempted": False, "status": "skipped",
                     "reason": "chỉ chạy khi truyền --include-d1 (cần network + wrangler login)"}
        if include_d1:
            tmp_d1_dir = out + ".d1_tmp"
            os.makedirs(tmp_d1_dir, exist_ok=True)
            tmp_extra_dirs.append(tmp_d1_dir)
            d1_result = backup_d1(tmp_d1_dir)
            for table, info in d1_result["tables"].items():
                if info["status"] != "ok":
                    continue
                local_path = os.path.join(tmp_d1_dir, f"{table}.json")
                arcname = f"d1/{table}.json"
                z.write(local_path, arcname)
                manifest_files.append({
                    "path": arcname,
                    "sha256": sha256_file(local_path),
                    "size": os.path.getsize(local_path),
                })

        r2_result = {"attempted": False, "status": "skipped",
                     "reason": "chỉ chạy khi truyền --r2 (cần network + wrangler login)"}
        if include_r2:
            tmp_r2_dir = out + ".r2_tmp"
            os.makedirs(tmp_r2_dir, exist_ok=True)
            tmp_extra_dirs.append(tmp_r2_dir)
            r2_result = backup_r2_manifests(slugs, tmp_r2_dir)
            r2_result["status"] = "ok"
            for slug in slugs:
                slug_tmp = os.path.join(tmp_r2_dir, slug)
                if not os.path.isdir(slug_tmp):
                    continue
                for fname in os.listdir(slug_tmp):
                    local_path = os.path.join(slug_tmp, fname)
                    arcname = f"r2_manifest/{slug}/{fname}"
                    z.write(local_path, arcname)
                    manifest_files.append({
                        "path": arcname,
                        "sha256": sha256_file(local_path),
                        "size": os.path.getsize(local_path),
                    })

        manifest = {
            "created_at": _now_iso(),
            "scope": {
                "novels": slugs,
                "metadata_glossary": True,   # novel.json (glossary nằm trong đó)
                "synopsis": True,
                "failed_chapters": True,
                "translated_extras": True,
                "text_raw": include_raw,
                "epub": include_epub,
                "users_db": users_db_present,
                "d1": d1_result,
                "r2_manifest_checksum": r2_result,
            },
            "files": manifest_files,
        }
        z.writestr("MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    for d in tmp_extra_dirs:
        _rmtree_ignore_errors(d)

    manifest_sidecar = out + ".manifest.json"
    with open(manifest_sidecar, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    size_mb = os.path.getsize(out) / 1e6
    print(f"✅ Backup: {out} ({len(manifest_files)} file, {size_mb:.1f} MB)")
    if d1_result.get("status") == "partial":
        print("⚠️  D1 export: một số bảng lỗi (xem MANIFEST.json → scope.d1.tables)")
    elif d1_result.get("status") == "skipped":
        print(f"ℹ️  D1: {d1_result['reason']}")
    return out


def _rmtree_ignore_errors(path: str):
    import shutil
    try:
        shutil.rmtree(path)
    except OSError:
        pass


def manifest_sidecar_path(zip_path: str) -> str:
    return zip_path + ".manifest.json"


# ── Verify + rotate ──────────────────────────────────────────────────────

def verify_backup(zip_path: str) -> tuple:
    """
    Đọc MANIFEST.json trong zip và đối chiếu sha256 + size của TỪNG file so
    với nội dung thật trong zip (không cần giải nén ra đĩa). Trả về
    (ok: bool, problems: list[str]).
    """
    problems = []
    try:
        with zipfile.ZipFile(zip_path) as z:
            try:
                manifest = json.loads(z.read("MANIFEST.json").decode("utf-8"))
            except KeyError:
                return False, ["Thiếu MANIFEST.json trong zip"]
            names = set(z.namelist())
            for entry in manifest.get("files", []):
                path = entry["path"]
                if path not in names:
                    problems.append(f"thiếu file trong zip: {path}")
                    continue
                data = z.read(path)
                if hashlib.sha256(data).hexdigest() != entry.get("sha256"):
                    problems.append(f"checksum sai: {path}")
                if len(data) != entry.get("size"):
                    problems.append(f"kích thước sai: {path}")
    except (zipfile.BadZipFile, FileNotFoundError) as e:
        return False, [f"Không đọc được zip: {e}"]
    return (len(problems) == 0), problems


def rotate():
    """Xoá bản backup cũ, chỉ giữ KEEP bản gần nhất — CHỈ được gọi sau khi
    bản mới đã verify_backup() thành công."""
    olds = sorted(glob.glob(os.path.join(BACKUP_DIR, "novels-*.zip")))
    while len(olds) > KEEP:
        victim = olds.pop(0)
        os.remove(victim)
        sidecar = manifest_sidecar_path(victim)
        if os.path.isfile(sidecar):
            os.remove(sidecar)
        print(f"🗑  Xóa backup cũ: {os.path.basename(victim)}")


def upload_r2(path: str) -> bool:
    key = f"_backups/{os.path.basename(path)}"
    r = subprocess.run(
        ["npx", "wrangler", "r2", "object", "put", f"{R2_BUCKET}/{key}",
         f"--file={path}", "--remote"],
        capture_output=True, text=True, cwd=ROOT, timeout=600,
    )
    if r.returncode == 0:
        print(f"☁️  Đã upload R2: {key}")
        return True
    print(f"❌ Upload R2 lỗi: {r.stderr[-300:]}")
    return False


# ── Restore ──────────────────────────────────────────────────────────────

def restore_slug(zip_path: str, slug: str, dest: str):
    """Restore 1 truyện (chế độ cũ, không verify checksum toàn phần) — giữ
    tương thích ngược cho CLI `--restore ... --slug ...`."""
    prefix = f"novels/{slug}/"
    n = 0
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            if name.startswith(prefix):
                z.extract(name, dest)
                n += 1
    print(f"✅ Restore {n} file của '{slug}' → {dest}")
    return n > 0


def restore_full(zip_path: str, dest_dir: str, verify: bool = True) -> bool:
    """
    Phục hồi TOÀN BỘ backup vào `dest_dir`. `dest_dir` PHẢI trống (an toàn:
    không được ghi đè thư mục truyện thật hay DB thật) — nếu không rỗng, từ
    chối và trả về False. Sau khi giải nén, verify checksum từng file theo
    MANIFEST.json (trừ khi verify=False). Trả về True/False — dùng để quyết
    định exit code (0 = thành công, khác 0 = lỗi).
    """
    dest_dir = os.path.abspath(dest_dir)
    os.makedirs(dest_dir, exist_ok=True)
    if os.listdir(dest_dir):
        print(f"❌ Thư mục đích '{dest_dir}' không rỗng — restore_full() chỉ ghi vào thư mục trống "
              f"để tránh đè dữ liệu thật. Hãy chỉ định --dest là thư mục rỗng/mới.")
        return False

    try:
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(dest_dir)
    except (zipfile.BadZipFile, FileNotFoundError) as e:
        print(f"❌ Không đọc được zip backup: {e}")
        return False

    manifest_path = os.path.join(dest_dir, "MANIFEST.json")
    if not os.path.isfile(manifest_path):
        print("❌ Backup thiếu MANIFEST.json — không thể xác nhận tính toàn vẹn, coi là lỗi.")
        return False

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    if verify:
        problems = []
        for entry in manifest.get("files", []):
            p = os.path.join(dest_dir, entry["path"])
            if not os.path.isfile(p):
                problems.append(f"thiếu file: {entry['path']}")
                continue
            if sha256_file(p) != entry.get("sha256"):
                problems.append(f"checksum sai: {entry['path']}")
        if problems:
            print("❌ Verify checksum thất bại sau restore:\n  - " + "\n  - ".join(problems))
            return False

    d1_status = manifest.get("scope", {}).get("d1", {}).get("status")
    if d1_status in ("skipped", "partial", "failed"):
        print(f"ℹ️  D1 trong backup này ở trạng thái '{d1_status}' — xem MANIFEST.json để biết chi tiết/giới hạn.")

    print(f"✅ Restore đầy đủ vào {dest_dir} ({len(manifest.get('files', []))} file, "
          f"verify={'ok' if verify else 'bỏ qua'})")
    return True


# ── CLI ───────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--r2", action="store_true", help="upload thêm lên R2 + snapshot R2 manifest/checksum")
    ap.add_argument("--include-raw", action="store_true")
    ap.add_argument("--include-d1", action="store_true",
                     help="xuất D1 remote (novels/chapters/users/...) — cần network + wrangler login")
    ap.add_argument("--no-epub", action="store_true", help="không backup file .epub")
    ap.add_argument("--restore", help="đường dẫn zip để restore")
    ap.add_argument("--slug", help="chỉ dùng khi restore 1 truyện (chế độ cũ, không verify)")
    ap.add_argument("--dest", default=os.path.join(ROOT, "backups", "_restore_tmp"))
    ap.add_argument("--no-verify", action="store_true", help="bỏ qua verify checksum khi restore toàn bộ (không khuyến khích)")
    args = ap.parse_args()

    if args.restore:
        if args.slug:
            ok = restore_slug(args.restore, args.slug, args.dest)
            return 0 if ok else 1
        ok = restore_full(args.restore, args.dest, verify=not args.no_verify)
        return 0 if ok else 1

    path = create_backup(include_raw=args.include_raw, include_epub=not args.no_epub,
                          include_d1=args.include_d1, include_r2=args.r2)
    ok, problems = verify_backup(path)
    if not ok:
        print("❌ Backup vừa tạo KHÔNG vượt qua verify checksum — GIỮ NGUYÊN các bản backup cũ (không rotate):")
        for p in problems:
            print(f"  - {p}")
        return 1
    rotate()

    if args.r2:
        if not upload_r2(path):
            return 1
        upload_r2(manifest_sidecar_path(path))

    return 0


if __name__ == "__main__":
    sys.exit(main())
