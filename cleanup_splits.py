"""
cleanup_splits.py
-----------------
Xóa các file bản dịch split (-1_VI.md, -2_VI.md,...) và raw tương ứng
sau khi đã được merge thành công vào file gốc.

Chỉ xóa khi file merged đã tồn tại và hợp lệ (không có [Translation failed]).

Cách dùng:
    python cleanup_splits.py --novel xich-tam-tuan-thien
    python cleanup_splits.py --all        # áp dụng cho tất cả truyện
    python cleanup_splits.py --novel <slug> --dry-run  # chỉ xem, không xóa
"""

import os
import re
import sys
import argparse

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')


def cleanup_splits(novel_slug: str, dry_run: bool = False) -> dict:
    translated_dir = os.path.join("novels", novel_slug, "translated")
    raw_dir        = os.path.join("novels", novel_slug, "text_raw")

    if not os.path.isdir(translated_dir):
        print(f"[!] Không tìm thấy thư mục translated/ cho '{novel_slug}'")
        return {"deleted_trans": [], "deleted_raw": [], "skipped": []}

    all_trans = set(os.listdir(translated_dir))

    # Nhận diện file split: xxx-N_VI.md
    split_pattern = re.compile(r'^(.*?)-(\d+)_VI\.md$')

    deleted_trans = []
    deleted_raw   = []
    skipped       = []

    print(f"\n{'─'*60}")
    print(f"  🧹 Dọn dẹp file split cho '{novel_slug}'" + (" [DRY RUN]" if dry_run else ""))
    print(f"{'─'*60}")

    for f in sorted(all_trans):
        match = split_pattern.match(f)
        if not match:
            continue

        base_name = match.group(1)   # "第1787章 黥面"
        part_num  = match.group(2)   # "1"
        merged_filename = f"{base_name}_VI.md"

        # Kiểm tra file merged tồn tại và không lỗi
        if merged_filename not in all_trans:
            skipped.append(f)
            continue

        merged_path = os.path.join(translated_dir, merged_filename)
        try:
            if os.path.getsize(merged_path) < 200:
                skipped.append(f)
                continue
            with open(merged_path, "r", encoding="utf-8") as mf:
                head = mf.read(300)
            if "[Translation failed" in head:
                skipped.append(f)
                continue
        except Exception:
            skipped.append(f)
            continue

        # Xóa translated part
        trans_path = os.path.join(translated_dir, f)
        if dry_run:
            print(f"  [DRY] Sẽ xóa: {f}")
        else:
            try:
                os.remove(trans_path)
                print(f"  [✓] Xóa: {f}")
                deleted_trans.append(f)
            except Exception as e:
                print(f"  [!] Lỗi khi xóa {f}: {e}")
                skipped.append(f)
                continue

        # Xóa raw part nếu có
        raw_filename = f"{base_name}-{part_num}.txt"
        raw_path     = os.path.join(raw_dir, raw_filename)
        if os.path.exists(raw_path):
            if dry_run:
                print(f"  [DRY] Sẽ xóa raw: {raw_filename}")
            else:
                try:
                    os.remove(raw_path)
                    print(f"  [✓] Xóa raw: {raw_filename}")
                    deleted_raw.append(raw_filename)
                except Exception as e:
                    print(f"  [!] Lỗi khi xóa raw {raw_filename}: {e}")

    print(f"\n  📊 Kết quả:")
    if dry_run:
        total = len([f for f in sorted(all_trans) if split_pattern.match(f)
                     and f"{split_pattern.match(f).group(1)}_VI.md" in all_trans])
        print(f"  Sẽ xóa: {total} file split translated + raw tương ứng")
    else:
        print(f"  Đã xóa: {len(deleted_trans)} file translated split")
        print(f"  Đã xóa: {len(deleted_raw)} file raw split")
    if skipped:
        print(f"  Bỏ qua: {len(skipped)} (chưa merge hoặc merge lỗi)")
    print(f"{'─'*60}\n")

    return {"deleted_trans": deleted_trans, "deleted_raw": deleted_raw, "skipped": skipped}


def main():
    parser = argparse.ArgumentParser(
        description="🧹 Dọn dẹp file split thừa sau khi đã merge",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--novel", metavar="SLUG", help="Slug truyện cần dọn")
    group.add_argument("--all",   action="store_true", help="Dọn tất cả truyện")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ xem, không xóa thật")
    args = parser.parse_args()

    if args.all:
        if not os.path.isdir("novels"):
            print("[!] Không tìm thấy thư mục novels/")
            return
        slugs = [s for s in os.listdir("novels") if os.path.isdir(os.path.join("novels", s))]
    else:
        slugs = [args.novel]

    total_trans = 0
    total_raw   = 0
    for slug in sorted(slugs):
        result = cleanup_splits(slug, dry_run=args.dry_run)
        total_trans += len(result["deleted_trans"])
        total_raw   += len(result["deleted_raw"])

    if len(slugs) > 1:
        print(f"{'='*60}")
        print(f"  Tổng: {total_trans} translated + {total_raw} raw đã xóa")
        print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
