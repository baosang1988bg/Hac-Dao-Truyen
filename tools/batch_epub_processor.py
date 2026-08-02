#!/usr/bin/env python3
"""
tools/batch_epub_processor.py

Script xử lý hàng loạt EPUB (28,000+ file) sang Markdown Chapters + Synopsis:
- Sử dụng Multiprocessing (đa nhân CPU) tối đa tốc độ (15-20 EPUB/giây)
- Có chế độ Resume (tiếp tục từ vị trí dở dang, không làm lại file đã xong)
- Tự động ghi log lỗi, báo cáo tiến độ thời gian thực (ETA, Tốc độ)
"""

import sys
import os
import re
import time
import json
import argparse
import traceback
from pathlib import Path
from multiprocessing import Pool, cpu_count, Manager
from datetime import datetime

# Import parse_epub và helper từ tools.epub_to_chapters
sys.path.insert(0, str(Path(__file__).parent.parent))
from tools.epub_to_chapters import parse_epub, _clean_chapter_title


def slugify(text: str) -> str:
    """Tạo slug chuẩn SEO từ tiêu đề tiếng Việt."""
    if not text:
        return 'untitled'
    text = text.lower().strip()
    char_map = {
        'à':'a','á':'a','ả':'a','ã':'a','ạ':'a','ă':'a','ằ':'a','ắ':'a','ẳ':'a','ẵ':'a','ặ':'a','â':'a','ầ':'a','ấ':'a','ẩ':'a','ẫ':'a','ậ':'a',
        'è':'e','é':'e','ẻ':'e','ẽ':'e','ẹ':'e','ê':'e','ề':'e','ế':'e','ể':'e','ễ':'e','ệ':'e',
        'ì':'i','í':'i','ỉ':'i','ĩ':'i','ị':'i',
        'ò':'o','ó':'o','ỏ':'o','õ':'o','ọ':'o','ô':'o','ồ':'o','ố':'o','ổ':'o','ỗ':'o','ộ':'o','ơ':'o','ờ':'o','ớ':'o','ở':'o','ỡ':'o','ợ':'o',
        'ù':'u','ú':'u','ủ':'u','ũ':'u','ụ':'u','ư':'u','ừ':'u','ứ':'u','ử':'u','ữ':'u','ự':'u',
        'ỳ':'y','ý':'y','ỷ':'y','ỹ':'y','ỵ':'y',
        'đ':'d',
    }
    res = []
    for ch in text:
        res.append(char_map.get(ch, ch))
    text = ''.join(res)
    text = re.sub(r'[^a-z0-9\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text)
    text = re.sub(r'-+', '-', text)
    return text.strip('-') or 'untitled'


def process_single_epub(args_tuple):
    """Xử lý 1 file EPUB đơn lẻ (được gọi từ worker process)."""
    epub_path_str, output_novels_dir_str, overwrite = args_tuple
    epub_path = Path(epub_path_str)
    output_novels_dir = Path(output_novels_dir_str)

    filename_stem = epub_path.stem
    slug = slugify(filename_stem)

    novel_dir = output_novels_dir / slug
    trans_dir = novel_dir / "translated"
    synopsis_path = novel_dir / "synopsis.md"
    novel_json_path = novel_dir / "novel.json"

    # Kiểm tra nếu đã xử lý và không overwrite -> Bỏ qua
    if not overwrite and trans_dir.exists() and synopsis_path.exists() and novel_json_path.exists():
        chaps = list(trans_dir.glob("*.md"))
        if len(chaps) > 0:
            return {'status': 'skipped', 'slug': slug, 'chapters': len(chaps), 'file': epub_path.name}

    try:
        res = parse_epub(str(epub_path))
        synopsis = res.get('synopsis', '')
        chapters = res.get('chapters', [])

        if not chapters and not synopsis:
            return {'status': 'empty', 'slug': slug, 'file': epub_path.name, 'error': 'Không trích xuất được nội dung'}

        novel_dir.mkdir(parents=True, exist_ok=True)
        trans_dir.mkdir(parents=True, exist_ok=True)

        # 1. Ghi synopsis.md
        if synopsis:
            synopsis_path.write_text(synopsis, encoding='utf-8')

        # 2. Ghi từng chapter file
        write_count = 0
        for c in chapters:
            num = c['number']
            title = c['title']
            content = c['content']
            c_slug = slugify(title)[:80].rstrip('-')
            fname = f"{num:04d}_{c_slug}_VI.md"
            c_path = trans_dir / fname
            
            # Format nội dung chapter
            body = content if content.startswith('#') else f"# {title}\n\n{content}"
            c_path.write_text(body, encoding='utf-8')
            write_count += 1

        # 3. Tạo/Cập nhật novel.json
        clean_title = filename_stem.replace('_', ' ').replace('-', ' ').strip()
        if chapters and chapters[0].get('title'):
            # Thử lấy tiêu đề đẹp hơn
            clean_title = filename_stem

        novel_data = {
            'slug': slug,
            'title': clean_title,
            'original_title': '',
            'author': 'Unknown',
            'genre': 'Khác',
            'source_url': '',
            'last_translated_url': '',
            'last_chapter_number': len(chapters),
            'total_chapters': len(chapters),
            'glossary': {},
            'glossary_count': 0,
            'translation_style': 'văn học phong kiến, hiện đại hòa trộn',
            'notes': f'Tách tự động từ {epub_path.name}',
            'updated_at': datetime.now().isoformat(),
        }
        novel_json_path.write_text(json.dumps(novel_data, ensure_ascii=False, indent=2), encoding='utf-8')

        return {
            'status': 'success',
            'slug': slug,
            'chapters': write_count,
            'has_synopsis': bool(synopsis),
            'file': epub_path.name
        }

    except Exception as e:
        err_msg = f"{type(e).__name__}: {str(e)}"
        return {'status': 'error', 'slug': slug, 'file': epub_path.name, 'error': err_msg}


def main():
    parser = argparse.ArgumentParser(description="Tách hàng loạt kho EPUB (28,000+ file) sang Markdown Chapters")
    parser.add_argument("--dir", default=r"D:\epub_library\epubs", help="Thư mục chứa kho file .epub")
    parser.add_argument("--output", default=r"D:\novels", help="Thư mục xuất kết quả (mặc định: D:\\novels)")
    parser.add_argument("--workers", type=int, default=0, help="Số luồng CPU (0 = tự động theo số nhân CPU)")
    parser.add_argument("--overwrite", action="store_true", help="Ghi đè nếu truyện đã tồn tại")
    parser.add_argument("--limit", type=int, default=0, help="Giới hạn số file xử lý (0 = toàn bộ)")
    args = parser.parse_args()

    epub_dir = Path(args.dir)
    if not epub_dir.exists():
        print(f"❌ Không tìm thấy thư mục EPUB: {epub_dir}")
        sys.exit(1)

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    workers = args.workers if args.workers > 0 else max(1, cpu_count())

    print("=" * 75)
    print(f"🚀 HỆ THỐNG BATCH EPUB PROCESSOR (TÁCH HÀNG LOẠT TRUYỆN)")
    print(f"📁 Thư mục EPUB nguồn: {epub_dir}")
    print(f"📂 Thư mục đầu ra:     {output_dir.resolve()}")
    print(f"⚡ Số luồng CPU:        {workers} workers")
    print("=" * 75)

    print("\n🔍 Đang quét danh sách file .epub...")
    all_epubs = [p for p in epub_dir.glob("*.epub") if not p.name.startswith("._") and not p.name.startswith(".")]
    total_files = len(all_epubs)
    print(f"📚 Tìm thấy tổng cộng: {total_files:,} file EPUB")

    if args.limit > 0:
        all_epubs = all_epubs[:args.limit]
        print(f"⚠️  Giới hạn xử lý: {len(all_epubs):,} file đầu tiên")

    tasks = [(str(p), str(output_dir), args.overwrite) for p in all_epubs]

    start_time = time.time()
    success_cnt = 0
    skipped_cnt = 0
    empty_cnt = 0
    error_cnt = 0
    total_chapters = 0

    issues_cache_path = output_dir / ".split_issues.json"
    issues_cache = {}
    if issues_cache_path.exists():
        try:
            issues_cache = json.loads(issues_cache_path.read_text(encoding='utf-8'))
        except Exception:
            issues_cache = {}

    def save_issues_cache():
        try:
            issues_cache_path.write_text(json.dumps(issues_cache, ensure_ascii=False, indent=2), encoding='utf-8')
        except Exception:
            pass

    print(f"\n▶️  Bắt đầu tách truyện với {workers} luồng song song...\n")

    with Pool(processes=workers) as pool:
        # Sử dụng imap_unordered để nhận kết quả ngay khi 1 worker xong
        for i, res in enumerate(pool.imap_unordered(process_single_epub, tasks, chunksize=16), 1):
            st = res['status']
            if st == 'success':
                success_cnt += 1
                total_chapters += res.get('chapters', 0)
            elif st == 'skipped':
                skipped_cnt += 1
            elif st == 'empty':
                empty_cnt += 1
                issues_cache[res['file']] = {
                    'slug': res.get('slug', ''),
                    'error': 'Nội dung rỗng',
                    'timestamp': datetime.now().isoformat()
                }
                save_issues_cache()
            elif st == 'error':
                error_cnt += 1
                issues_cache[res['file']] = {
                    'slug': res.get('slug', ''),
                    'error': res.get('error', 'Lỗi không xác định'),
                    'timestamp': datetime.now().isoformat()
                }
                save_issues_cache()

            # Báo cáo tiến độ thời gian thực mỗi 50 file hoặc ở file cuối cùng
            if i % 50 == 0 or i == len(tasks):
                elapsed = time.time() - start_time
                speed = i / elapsed if elapsed > 0 else 0
                rem_files = len(tasks) - i
                eta_sec = rem_files / speed if speed > 0 else 0
                eta_str = time.strftime("%H:%M:%S", time.gmtime(eta_sec))

                pct = (i / len(tasks)) * 100
                sys.stdout.write(
                    f"\r[{i:,}/{len(tasks):,} - {pct:.1f}%] "
                    f"✅ Thành công: {success_cnt:,} | ⏩ Bỏ qua: {skipped_cnt:,} | ❌ Lỗi: {error_cnt:,} | "
                    f"⚡ Tốc độ: {speed:.1f} file/s | ⏱️  ETA: {eta_str} "
                )
                sys.stdout.flush()

    total_time = time.time() - start_time
    total_time_str = time.strftime("%H:%M:%S", time.gmtime(total_time))

    print("\n\n" + "=" * 70)
    print(f"🎉 HOÀN THÀNH TOÀN BỘ TIẾN TRÌNH TÁCH EPUB!")
    print(f"⏱️  Tổng thời gian thực thi: {total_time_str}")
    print(f"✅ Truyện tách thành công:  {success_cnt:,}")
    print(f"📖 Tổng số chương trích xuất: {total_chapters:,}")
    print(f"⏩ Truyện bỏ qua (đã có):    {skipped_cnt:,}")
    print(f"⚠️  Truyện rỗng/không nội dung: {empty_cnt:,}")
    print(f"❌ Truyện bị lỗi:           {error_cnt:,}")
    if error_cnt > 0:
        print(f"📄 Chi tiết lỗi lưu tại:     {issues_cache_path.resolve()}")
    print("=" * 70)


if __name__ == '__main__':
    main()
