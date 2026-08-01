#!/usr/bin/env python3
"""
dedupe_chapters.py — Khử trùng lặp chương khi 2 (hoặc nhiều) quy ước đặt tên
file cùng map ra 1 số chương trong novels/<slug>/translated/.

Bối cảnh: epub_to_chapters.py có thể được chạy nhiều lần trên cùng 1 EPUB ở
các thời điểm khác nhau (vd trước/sau một bản fix format). Vì tên file được
sinh từ tiêu đề chương, chỉ cần tiêu đề lệch 1 ký tự (do độ dài chuỗi UTF-8
thay đổi khi thêm dòng trống/escape markdown) là đã tạo ra 2 file khác tên
cho cùng 1 số chương — gây trùng lặp ở API /chapters, làm sai lệch điều hướng
"chương tiếp theo" và lịch sử đọc.

Cách hoạt động:
  1. Gom file theo số chương (dùng đúng logic extract_chapter_number_from_text
     mà backend routers/chapters.py dùng, đảm bảo nhất quán).
  2. Với mỗi nhóm có >1 file: chuẩn hoá nội dung (bỏ khoảng trắng thừa + bỏ
     escape markdown \\*, \\_, \\`, \\\\) rồi so sánh.
     - Nếu nội dung THỰC SỰ giống nhau (chỉ khác format/escape) -> AN TOÀN,
       giữ lại bản LỚN NHẤT (thường là bản mới, có dòng trống + escape đúng),
       xoá các bản còn lại.
     - Nếu nội dung THỰC SỰ khác nhau -> KHÔNG tự xoá, in cảnh báo để xem thủ công.
  3. Phát hiện và xoá riêng các file "chương" thực chất là trang Mục Lục bị
     lưu nhầm (title khớp _looks_like_toc_marker) — không phải chương thật.

Dùng:
  python tools/dedupe_chapters.py --slug <slug> --dry-run   # xem trước
  python tools/dedupe_chapters.py --slug <slug>              # xoá thật
"""

import argparse
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from chapter_utils import extract_chapter_number_from_text  # noqa: E402

try:
    from tools.epub_to_chapters import _looks_like_toc_marker
except Exception:
    def _looks_like_toc_marker(text: str) -> bool:
        t = text.strip().lstrip('#').strip().rstrip(':').strip().lower()
        return t in {'mục lục', 'muc luc', 'table of contents', 'contents', '目录', '目錄', 'toc'}

_ESCAPE_RE = re.compile(r'\\([\\`*_])')
_WS_RE = re.compile(r'\s+')


def _normalize(raw: str) -> str:
    """Bỏ khoảng trắng thừa + escape markdown để so sánh đúng nội dung thật,
    bất kể khác biệt định dạng giữa các lần chạy script khác nhau."""
    t = _ESCAPE_RE.sub(r'\1', raw)
    t = _WS_RE.sub(' ', t).strip()
    return t


def _get_title(text: str) -> str:
    for line in text.split('\n')[:5]:
        line = line.strip()
        if line:
            return line.lstrip('#').strip()
    return ''


def dedupe(slug: str, dry_run: bool) -> None:
    translated_dir = ROOT / 'novels' / slug / 'translated'
    if not translated_dir.exists():
        print(f'[ERROR] Không tìm thấy {translated_dir}', file=sys.stderr)
        sys.exit(1)

    files = [f for f in os.listdir(translated_dir) if f.endswith('.md')]
    by_num: dict[int, list[str]] = defaultdict(list)
    for f in files:
        by_num[extract_chapter_number_from_text(f)].append(f)

    to_remove: list[str] = []
    unsafe: list[tuple[int, list[str]]] = []
    toc_leaks: list[str] = []

    for num, fnames in sorted(by_num.items()):
        contents = {}
        for fn in fnames:
            raw = (translated_dir / fn).read_text(encoding='utf-8')
            contents[fn] = raw

        # Phát hiện file là trang Mục Lục bị lưu nhầm thành chương
        real_files = []
        for fn, raw in contents.items():
            if _looks_like_toc_marker(_get_title(raw)):
                toc_leaks.append(fn)
            else:
                real_files.append(fn)

        if len(real_files) <= 1:
            continue

        norm_map = {fn: _normalize(contents[fn]) for fn in real_files}
        if len(set(norm_map.values())) == 1:
            sizes = {fn: len(contents[fn]) for fn in real_files}
            keep = max(sizes, key=sizes.get)
            to_remove.extend(fn for fn in real_files if fn != keep)
        else:
            unsafe.append((num, real_files))

    print(f'[INFO] Tổng số file: {len(files)} | Số chương duy nhất: {len(by_num)}')
    print(f'[INFO] File trang Mục Lục bị lưu nhầm thành chương: {len(toc_leaks)}')
    for f in toc_leaks:
        print(f'  - {f}')
    print(f'[INFO] File trùng lặp AN TOÀN để xoá (cùng nội dung, khác format): {len(to_remove)}')
    if unsafe:
        print(f'[WARN] {len(unsafe)} nhóm nội dung KHÁC NHAU THẬT SỰ — KHÔNG tự xoá, cần xem thủ công:')
        for num, fnames in unsafe:
            print(f'  - Chương {num}: {fnames}')

    all_to_remove = sorted(set(to_remove) | set(toc_leaks))
    if not all_to_remove:
        print('[OK] Không có gì cần xoá.')
        return

    print(f'\n[INFO] Sẽ xoá {len(all_to_remove)} file:')
    for f in all_to_remove:
        print(f'  - {f}')

    if dry_run:
        print('\n[DRY-RUN] Chưa xoá gì. Bỏ --dry-run để xoá thật.')
        return

    removed = 0
    failed = []
    for f in all_to_remove:
        try:
            (translated_dir / f).unlink()
            removed += 1
        except Exception as e:
            failed.append((f, str(e)))
    print(f'\n[OK] Đã xoá {removed}/{len(all_to_remove)} file.')
    if failed:
        print('[WARN] Không xoá được các file sau (xoá thủ công):')
        for f, err in failed:
            print(f'  - {f}: {err}')


def main():
    ap = argparse.ArgumentParser(description='Khử trùng lặp chương trong novels/<slug>/translated/.')
    ap.add_argument('--slug', required=True)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    dedupe(args.slug, args.dry_run)


if __name__ == '__main__':
    main()
