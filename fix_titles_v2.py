"""
fix_titles_v2.py
-----------------
Chuẩn hóa tiêu đề tất cả chương về dạng:
    # Chương N: Tên chương

Hoạt động:
- Quét tất cả file _VI.md trong tất cả novels
- Kiểm tra dòng đầu tiên có phải format chuẩn chưa
- Nếu chưa chuẩn → tìm tiêu đề thực trong 15 dòng đầu → chuẩn hóa
- Cũng phát hiện tiêu đề còn ký tự Hán (chưa dịch tiêu đề)
- Đảm bảo có blank line sau tiêu đề

Cách dùng:
    python fix_titles_v2.py              # Fix tất cả truyện
    python fix_titles_v2.py --report     # Chỉ báo cáo, không sửa
    python fix_titles_v2.py --novel <slug>  # Chỉ 1 truyện
"""

import os
import re
import sys
import argparse

# Sửa lỗi Unicode khi in tiếng Việt ra terminal Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

NOVELS_DIR = "novels"

# Regex nhận diện tiêu đề chuẩn: # Chương N: <bất kỳ nội dung nào>
_GOOD_TITLE_RE = re.compile(r'^#\s+Chương\s+\d+\s*:', re.IGNORECASE)
# Regex tiêu đề có ký tự Hán (chưa dịch)
_HAN_RE = re.compile(r'[\u4e00-\u9fff]')


def extract_chapter_num(filename: str) -> int | None:
    """Trích số chương từ tên file."""
    m = re.search(r'(\d+)', filename)
    return int(m.group(1)) if m else None


def find_title_in_lines(lines: list[str]) -> tuple[str, int]:
    """Tìm dòng tiêu đề trong 15 dòng đầu.
    Trả về (title_text, line_index) hoặc ('', -1) nếu không tìm thấy.
    """
    for i, raw in enumerate(lines[:15]):
        line = raw.strip()
        if not line:
            continue
        if line.startswith('#'):
            return line, i
        if re.match(r'^[Cc]hương\s+\d+', line):
            return line, i
    return '', -1


def clean_title(raw_title: str, chap_num: int) -> str:
    """Làm sạch tiêu đề về phần tên chương thuần túy."""
    t = raw_title
    # Bỏ dấu # đầu
    t = re.sub(r'^#+\s*', '', t)
    # Bỏ "Chương N:" hoặc "Chương N -"
    t = re.sub(rf'^[Cc]hương\s+{chap_num}\s*[:\-–—]?\s*', '', t)
    # Bỏ prefix số chương dạng "1234. " hay "1234: "
    t = re.sub(rf'^{chap_num}[.\-:：]\s*', '', t)
    return t.strip()


def needs_fix(lines: list[str], chap_num: int) -> tuple[bool, str]:
    """Kiểm tra file có cần fix không.
    Trả về (needs_fix, reason).
    """
    if not lines:
        return False, ''

    first = lines[0].strip()

    # 1. Không phải dòng tiêu đề Markdown
    if not first.startswith('#'):
        return True, 'Dòng đầu không phải tiêu đề Markdown (#)'

    # 2. Còn ký tự Hán trong tiêu đề
    if _HAN_RE.search(first):
        return True, 'Tiêu đề còn ký tự Hán (chưa dịch)'

    # 3. Không đúng format "# Chương N:"
    if not _GOOD_TITLE_RE.match(first):
        return True, f'Không đúng format "# Chương {chap_num}: Tên"'

    # 4. Thiếu blank line sau tiêu đề
    if len(lines) > 1 and lines[1].strip() != '':
        return True, 'Thiếu blank line sau tiêu đề'

    return False, ''


def fix_file(filepath: str, chap_num: int, dry_run: bool = False) -> tuple[bool, str]:
    """Fix 1 file. Trả về (changed, reason)."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except Exception as e:
        return False, f'Đọc lỗi: {e}'

    changed, reason = needs_fix(lines, chap_num)
    if not changed:
        return False, ''

    # Tìm tiêu đề thực
    raw_title, title_idx = find_title_in_lines(lines)

    if raw_title:
        pure = clean_title(raw_title, chap_num)
    else:
        # Fallback: dùng tên file
        pure = os.path.splitext(os.path.basename(filepath))[0].replace('_VI', '')
        pure = clean_title(pure, chap_num)

    if not pure:
        pure = os.path.splitext(os.path.basename(filepath))[0].replace('_VI', '')

    new_title_line = f"# Chương {chap_num}: {pure}\n"

    if dry_run:
        return True, reason

    # Xây lại file: bỏ dòng tiêu đề cũ rồi thêm mới vào đầu
    new_lines = list(lines)
    if title_idx >= 0:
        new_lines.pop(title_idx)

    new_lines.insert(0, new_title_line)

    # Đảm bảo blank line sau tiêu đề
    if len(new_lines) > 1 and new_lines[1].strip() != '':
        new_lines.insert(1, '\n')

    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.writelines(new_lines)
    except Exception as e:
        return False, f'Ghi lỗi: {e}'

    return True, reason


def process_novel(slug: str, dry_run: bool = False) -> dict:
    trans_dir = os.path.join(NOVELS_DIR, slug, 'translated')
    if not os.path.isdir(trans_dir):
        return {'fixed': 0, 'skipped': 0, 'errors': []}

    fixed = 0
    skipped = 0
    errors = []

    for filename in sorted(os.listdir(trans_dir)):
        if not filename.endswith('_VI.md'):
            continue

        chap_num = extract_chapter_num(filename)
        if chap_num is None:
            skipped += 1
            continue

        filepath = os.path.join(trans_dir, filename)
        changed, reason = fix_file(filepath, chap_num, dry_run=dry_run)

        if changed:
            tag = '[DRY]' if dry_run else '[FIX]'
            print(f"  {tag} {filename[:55]}")
            print(f"       → {reason}")
            fixed += 1
        else:
            skipped += 1

    return {'fixed': fixed, 'skipped': skipped, 'errors': errors}


def main():
    parser = argparse.ArgumentParser(
        description="✨ Chuẩn hóa tiêu đề chương về dạng '# Chương N: Tên'",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument('--novel',   metavar='SLUG', help='Chỉ xử lý 1 truyện')
    parser.add_argument('--report',  action='store_true', help='Chỉ báo cáo, không sửa (= --dry-run)')
    parser.add_argument('--dry-run', action='store_true', help='Xem trước, không ghi file')
    args = parser.parse_args()

    dry_run = args.report or args.dry_run

    if not os.path.isdir(NOVELS_DIR):
        print("[!] Không tìm thấy thư mục novels/")
        return

    slugs = [args.novel] if args.novel else [
        s for s in sorted(os.listdir(NOVELS_DIR))
        if os.path.isdir(os.path.join(NOVELS_DIR, s))
    ]

    total_fixed = 0
    total_skipped = 0

    for slug in slugs:
        print(f"\n{'─'*60}")
        print(f"  📖  {slug}" + (' [DRY RUN]' if dry_run else ''))
        print(f"{'─'*60}")
        result = process_novel(slug, dry_run=dry_run)
        total_fixed   += result['fixed']
        total_skipped += result['skipped']
        if result['fixed'] == 0:
            print("  ✅ Tất cả tiêu đề đã đúng format!")
        else:
            label = 'sẽ fix' if dry_run else 'đã fix'
            print(f"\n  📊 {result['fixed']} file {label}, {result['skipped']} file OK")

    print(f"\n{'='*60}")
    label = 'sẽ fix' if dry_run else 'đã fix'
    print(f"  Tổng: {total_fixed} file {label}, {total_skipped} file OK")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
