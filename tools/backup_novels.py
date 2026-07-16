"""
tools/backup_novels.py
----------------------
Backup toàn bộ dữ liệu truyện (roadmap 1.5): novel.json + catalog.json +
translated/ + extras/ của mỗi truyện → 1 file zip có timestamp.

- Mặc định lưu vào backups/ (đã gitignore), giữ tối đa 4 bản gần nhất.
- Tùy chọn --r2: đẩy thêm lên R2 bucket qua wrangler (cần đăng nhập Cloudflare).
- KHÔNG backup text_raw/ (nguồn Trung có thể crawl lại, nặng gấp đôi) trừ khi
  thêm --include-raw.

Chạy:
  python3 tools/backup_novels.py                 # backup local
  python3 tools/backup_novels.py --r2            # backup local + upload R2
  python3 tools/backup_novels.py --restore backups/novels-20260716.zip --slug X --dest /tmp/x
Lịch tuần (macOS): crontab -e →
  0 3 * * 1 cd /path/to/HacDaoTruyen && python3 tools/backup_novels.py --r2
"""

import os
import sys
import glob
import zipfile
import argparse
import subprocess
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOVELS_DIR = os.path.join(ROOT, "novels")
BACKUP_DIR = os.path.join(ROOT, "backups")
KEEP = 4
R2_BUCKET = "hacdao-chapters"


def create_backup(include_raw: bool) -> str:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = os.path.join(BACKUP_DIR, f"novels-{ts}.zip")
    n_files = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for slug in sorted(os.listdir(NOVELS_DIR)):
            d = os.path.join(NOVELS_DIR, slug)
            if not os.path.isdir(d):
                continue
            for sub in ("novel.json", "catalog.json", "normalize_log.json"):
                p = os.path.join(d, sub)
                if os.path.isfile(p):
                    z.write(p, os.path.relpath(p, ROOT))
                    n_files += 1
            subdirs = ["translated", "extras"] + (["text_raw"] if include_raw else [])
            for sub in subdirs:
                sd = os.path.join(d, sub)
                if not os.path.isdir(sd):
                    continue
                for root, _, files in os.walk(sd):
                    for f in files:
                        p = os.path.join(root, f)
                        z.write(p, os.path.relpath(p, ROOT))
                        n_files += 1
    size_mb = os.path.getsize(out) / 1e6
    print(f"✅ Backup: {out} ({n_files} file, {size_mb:.1f} MB)")
    return out


def rotate():
    olds = sorted(glob.glob(os.path.join(BACKUP_DIR, "novels-*.zip")))
    while len(olds) > KEEP:
        victim = olds.pop(0)
        os.remove(victim)
        print(f"🗑  Xóa backup cũ: {os.path.basename(victim)}")


def upload_r2(path: str):
    key = f"_backups/{os.path.basename(path)}"
    r = subprocess.run(
        ["npx", "wrangler", "r2", "object", "put", f"{R2_BUCKET}/{key}",
         f"--file={path}", "--remote"],
        capture_output=True, text=True, cwd=ROOT, timeout=600,
    )
    if r.returncode == 0:
        print(f"☁️  Đã upload R2: {key}")
    else:
        print(f"❌ Upload R2 lỗi: {r.stderr[-300:]}")
        sys.exit(1)


def restore(zip_path: str, slug: str, dest: str):
    prefix = f"novels/{slug}/"
    n = 0
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            if name.startswith(prefix):
                z.extract(name, dest)
                n += 1
    print(f"✅ Restore {n} file của '{slug}' → {dest}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--r2", action="store_true", help="upload thêm lên R2")
    ap.add_argument("--include-raw", action="store_true")
    ap.add_argument("--restore", help="đường dẫn zip để restore")
    ap.add_argument("--slug", help="slug cần restore")
    ap.add_argument("--dest", default="/tmp/hacdao-restore")
    args = ap.parse_args()

    if args.restore:
        if not args.slug:
            sys.exit("--restore cần --slug")
        restore(args.restore, args.slug, args.dest)
        return

    path = create_backup(args.include_raw)
    rotate()
    if args.r2:
        upload_r2(path)


if __name__ == "__main__":
    main()
