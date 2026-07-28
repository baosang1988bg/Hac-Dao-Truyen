#!/usr/bin/env python3
"""
gdrive_upload.py  —  Upload EPUB library lên Google Drive
=========================================================
Yêu cầu: pip install google-api-python-client google-auth-oauthlib

Lần đầu chạy: sẽ mở browser để xác thực OAuth2.
Các lần sau:  token tự động refresh từ token.json

Flow:
  1. Đọc catalog_full.jsonl để lấy danh sách truyện
  2. Tạo cấu trúc folder trên Drive: epub_library/<slug>/
  3. Upload EPUB + cover + meta JSON cho mỗi truyện
  4. Skip nếu file đã tồn tại trên Drive (so sánh MD5)
  5. Lưu upload_state.json để resume

Usage:
  python gdrive_upload.py --epub-dir ./epub_library --folder-id 1RKfWakoQOidHnxLXnZNgWoF_YokNt9lV
  python gdrive_upload.py --epub-dir ./epub_library --folder-id 1RKfWakoQOidHnxLXnZNgWoF_YokNt9lV --resume
  python gdrive_upload.py --epub-dir ./epub_library --folder-id 1RKfWakoQOidHnxLXnZNgWoF_YokNt9lV --verify-only
"""

import argparse
import json
import hashlib
import os
import sys
import time
from pathlib import Path
from datetime import datetime

try:
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
except ImportError:
    print("ERROR: Thiếu thư viện Google. Chạy:")
    print("  pip install google-api-python-client google-auth-oauthlib google-auth-httplib2")
    sys.exit(1)

# ─── Config ───────────────────────────────────────────────────────────────────
SCOPES            = ["https://www.googleapis.com/auth/drive"]
CREDENTIALS_FILE  = str(Path(__file__).parent / "credentials.json")  # OAuth client secret
TOKEN_FILE        = str(Path(__file__).parent / "token.json")
CHUNK_SIZE        = 4 * 1024 * 1024   # 4MB chunk upload
RETRY_COUNT       = 3
RETRY_DELAY       = 3
UPLOAD_DELAY      = 0.3               # delay giữa các file upload

MIME_EPUB   = "application/epub+zip"
MIME_JSON   = "application/json"
MIME_FOLDER = "application/vnd.google-apps.folder"
MIME_MAP    = {
    ".epub": MIME_EPUB,
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".json": MIME_JSON,
}

# ─── Auth ─────────────────────────────────────────────────────────────────────

def get_drive_service(credentials_file=CREDENTIALS_FILE, token_file=TOKEN_FILE):
    creds = None
    if Path(token_file).exists():
        creds = Credentials.from_authorized_user_file(token_file, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not Path(credentials_file).exists():
                print(f"\n[!] Không tìm thấy {credentials_file}")
                print("Hướng dẫn lấy credentials:")
                print("  1. Vào https://console.cloud.google.com/")
                print("  2. Tạo project → Enable Google Drive API")
                print("  3. Tạo OAuth 2.0 Client ID (Desktop app)")
                print("  4. Download JSON → lưu thành tools/credentials.json")
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(credentials_file, SCOPES)
            creds = flow.run_local_server(port=0)
        Path(token_file).write_text(creds.to_json())

    return build("drive", "v3", credentials=creds)

# ─── Drive helpers ─────────────────────────────────────────────────────────────

def get_or_create_folder(service, name, parent_id):
    """Tìm hoặc tạo folder con trong parent_id."""
    q = (f"name='{name}' and mimeType='{MIME_FOLDER}' "
         f"and '{parent_id}' in parents and trashed=false")
    r = service.files().list(q=q, fields="files(id,name)").execute()
    files = r.get("files", [])
    if files:
        return files[0]["id"]
    meta = {"name": name, "mimeType": MIME_FOLDER, "parents": [parent_id]}
    f = service.files().create(body=meta, fields="id").execute()
    return f["id"]


def file_exists_on_drive(service, name, parent_id, local_md5=None):
    """Kiểm tra file đã tồn tại trên Drive. Trả về (file_id hay None)."""
    q = f"name='{name}' and '{parent_id}' in parents and trashed=false"
    r = service.files().list(q=q, fields="files(id,md5Checksum,size)").execute()
    files = r.get("files", [])
    if not files:
        return None
    # Nếu có local MD5 → so sánh
    if local_md5:
        for f in files:
            if f.get("md5Checksum") == local_md5:
                return f["id"]
        return None  # Có file nhưng MD5 khác → cần re-upload
    return files[0]["id"]


def compute_md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def upload_file(service, local_path, parent_id, filename=None, retry=RETRY_COUNT):
    """Upload 1 file lên Drive. Trả về file_id."""
    local_path = Path(local_path)
    fname = filename or local_path.name
    ext   = local_path.suffix.lower()
    mime  = MIME_MAP.get(ext, "application/octet-stream")

    # Check MD5 trước để skip nếu đã có và giống
    local_md5 = compute_md5(local_path)
    existing  = file_exists_on_drive(service, fname, parent_id, local_md5)
    if existing:
        return existing, "skip"

    media = MediaFileUpload(str(local_path), mimetype=mime, chunksize=CHUNK_SIZE, resumable=True)
    meta  = {"name": fname, "parents": [parent_id]}

    last_err = None
    for attempt in range(retry):
        try:
            req = service.files().create(body=meta, media_body=media, fields="id,md5Checksum")
            resp = None
            while resp is None:
                _, resp = req.next_chunk()
            return resp["id"], "uploaded"
        except Exception as e:
            last_err = e
            if attempt < retry - 1:
                time.sleep(RETRY_DELAY * (attempt + 1))
                media = MediaFileUpload(str(local_path), mimetype=mime,
                                        chunksize=CHUNK_SIZE, resumable=True)
                meta  = {"name": fname, "parents": [parent_id]}
    raise RuntimeError(f"Upload failed: {last_err}")

# ─── State ────────────────────────────────────────────────────────────────────

def load_upload_state(path):
    if path.exists():
        try:
            return json.loads(path.read_text("utf-8"))
        except Exception:
            pass
    return {"uploaded": {}, "failed": {}}


def save_upload_state(path, state):
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), "utf-8")

# ─── Upload 1 truyện ──────────────────────────────────────────────────────────

def upload_novel(service, slug, epub_dir, root_folder_id, state, state_path):
    """Upload EPUB + cover + meta cho 1 truyện. Trả về 'ok'|'skip'|'fail'."""
    if slug in state.get("uploaded", {}):
        # Nhanh skip nếu đã upload đủ
        return "skip"

    epubs_dir  = epub_dir / "epubs"
    covers_dir = epub_dir / "covers"
    meta_dir   = epub_dir / "meta"
    epub_path  = epubs_dir / f"{slug}.epub"

    if not epub_path.exists():
        return "skip"  # Chưa có EPUB local

    try:
        # Tạo sub-folder cho truyện
        novel_folder_id = get_or_create_folder(service, slug, root_folder_id)

        uploaded_files = {}

        # Upload EPUB
        fid, status = upload_file(service, epub_path, novel_folder_id)
        uploaded_files["epub"] = {"id": fid, "status": status}
        time.sleep(UPLOAD_DELAY)

        # Upload cover (nếu có)
        for ext in [".jpg", ".jpeg", ".png", ".webp"]:
            cov = covers_dir / f"{slug}{ext}"
            if cov.exists():
                fid2, st2 = upload_file(service, cov, novel_folder_id)
                uploaded_files["cover"] = {"id": fid2, "status": st2}
                time.sleep(UPLOAD_DELAY)
                break

        # Upload metadata JSON
        meta_path = meta_dir / f"{slug}.json"
        if meta_path.exists():
            fid3, st3 = upload_file(service, meta_path, novel_folder_id)
            uploaded_files["meta"] = {"id": fid3, "status": st3}
            time.sleep(UPLOAD_DELAY)

        state.setdefault("uploaded", {})[slug] = {
            "at": datetime.now().isoformat(),
            "folder_id": novel_folder_id,
            "files": uploaded_files,
        }
        state["failed"] = {k: v for k, v in state.get("failed", {}).items() if k != slug}
        save_upload_state(state_path, state)

        statuses = [v["status"] for v in uploaded_files.values()]
        overall = "skip" if all(s == "skip" for s in statuses) else "ok"
        return overall

    except Exception as e:
        msg = str(e)[:200]
        print(f"  ✗ upload {slug}: {msg}")
        state.setdefault("failed", {})[slug] = {"error": msg, "at": datetime.now().isoformat()}
        save_upload_state(state_path, state)
        return "fail"

# ─── CLI ───────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Upload EPUB library lên Google Drive")
    p.add_argument("--epub-dir",   default="./epub_library", help="Thư mục epub_library local")
    p.add_argument("--folder-id",  required=True,  help="Google Drive Folder ID (đích)")
    p.add_argument("--credentials", default=CREDENTIALS_FILE, help="Path credentials.json")
    p.add_argument("--token",       default=TOKEN_FILE,       help="Path token.json")
    p.add_argument("--resume",      action="store_true", default=True, help="Bỏ qua đã upload thành công (mặc định: True)")
    p.add_argument("--force-reupload", action="store_true", help="Ép buộc upload lại tất cả")
    p.add_argument("--retry-failed", action="store_true")
    p.add_argument("--verify-only",  action="store_true", help="Chỉ verify file trên Drive")
    p.add_argument("--limit",        type=int, default=0)
    p.add_argument("--delay",        type=float, default=0.3)
    return p.parse_args()


def main():
    args     = parse_args()
    epub_dir = Path(args.epub_dir).expanduser().resolve()

    upload_state_path = epub_dir / "upload_state.json"
    ustate = load_upload_state(upload_state_path)
    resume_active = args.resume and not args.force_reupload

    print("=" * 64)
    print("  Google Drive Upload — AudioTruyenFull EPUB Library")
    print(f"  Local : {epub_dir}")
    print(f"  Drive : https://drive.google.com/drive/folders/{args.folder_id}")
    print(f"  Resume: {'Có (Tự động bỏ qua file đã up)' if resume_active else 'Tắt (Upload lại)'}")
    print("=" * 64)

    # Auth
    print("\n[auth] Xác thực Google Drive...")
    service = get_drive_service(args.credentials, args.token)
    print("[auth] OK")

    # Đọc catalog để lấy danh sách slug
    jsonl_path = epub_dir / "catalog_full.jsonl"
    if jsonl_path.exists():
        slugs = []
        with open(jsonl_path, encoding="utf-8") as f:
            for line in f:
                try:
                    slugs.append(json.loads(line.strip()).get("slug", ""))
                except Exception:
                    pass
        slugs = [s for s in slugs if s]
    else:
        # Fallback: dùng files có trong epubs/
        epubs_dir = epub_dir / "epubs"
        slugs = [p.stem for p in epubs_dir.glob("*.epub")] if epubs_dir.exists() else []

    print(f"\n[scan] Tổng catalog: {len(slugs):,} slug")

    # Filter
    work = slugs
    if args.retry_failed:
        failed = set(ustate.get("failed", {}).keys())
        work   = [s for s in slugs if s in failed]
        print(f"[filter] Retry {len(work)} slug lỗi")
    elif resume_active:
        done  = set(ustate.get("uploaded", {}).keys())
        work  = [s for s in slugs if s not in done]
        print(f"[filter] Resume: Bỏ qua {len(done):,} đã upload trên Drive, còn lại {len(work):,} cần kiểm tra/upload")

    # Chỉ tải những slug đã có EPUB local
    epubs_dir = epub_dir / "epubs"
    work = [s for s in work if (epubs_dir / f"{s}.epub").exists()]
    print(f"[scan] Có EPUB local: {len(work):,}")

    if args.limit > 0:
        work = work[:args.limit]

    if args.verify_only:
        print(f"\n[verify] Kiểm tra {len(work)} EPUB trên Drive...")
        ok_cnt = 0
        for slug in work:
            epub_path = epubs_dir / f"{slug}.epub"
            local_md5 = compute_md5(epub_path)
            eid = file_exists_on_drive(service, f"{slug}.epub", args.folder_id, local_md5)
            if eid:
                ok_cnt += 1
            else:
                print(f"  MISSING/MISMATCH: {slug}")
        print(f"\n[verify] {ok_cnt}/{len(work)} OK")
        return

    # Upload loop
    print(f"\n[upload] Bắt đầu upload {len(work):,} truyện...")
    ok = skip = fail = 0
    total = len(work)
    t0 = time.time()

    for i, slug in enumerate(work, 1):
        if i % 10 == 1 or i == total:
            pct = i / total * 100
            elapsed = time.time() - t0
            rate = i / elapsed * 60 if elapsed > 0 else 0
            eta  = (total - i) / (rate / 60) / 60 if rate > 0 else 0
            print(f"\n[{i:>5}/{total}] {pct:.0f}% | {rate:.0f}/min | ETA {eta:.0f}h | {slug}")

        r = upload_novel(service, slug, epub_dir, args.folder_id, ustate, upload_state_path)
        sym = "✓" if r == "ok" else ("⤼" if r == "skip" else "✗")
        if r != "ok":
            print(f"  {sym} {slug}")

        if r == "ok":   ok   += 1
        elif r == "skip": skip += 1
        else:           fail += 1

        if r in ("ok", "fail"):
            time.sleep(args.delay)

    elapsed = time.time() - t0
    print("\n" + "=" * 64)
    print(f"  ✓ Uploaded: {ok:>6,}")
    print(f"  ⤼ Skipped:  {skip:>6,}")
    print(f"  ✗ Failed:   {fail:>6,}")
    print(f"  Time:       {elapsed/60:.1f} min")
    print(f"\n  Drive: https://drive.google.com/drive/folders/{args.folder_id}")
    print("=" * 64)
    if ustate.get("failed"):
        print(f"\n[!] {len(ustate['failed'])} lỗi → dùng --retry-failed --resume")


if __name__ == "__main__":
    main()
