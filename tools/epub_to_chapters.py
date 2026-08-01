#!/usr/bin/env python3
"""
epub_to_chapters.py — Trích xuất synopsis và/hoặc từng chương từ EPUB.

Dùng khi:
  - Muốn hiển thị giới thiệu truyện (synopsis) trên web mà không cần tải EPUB.
  - Muốn có text chương để đọc online qua Reader hiện tại.

Sử dụng:
  python tools/epub_to_chapters.py --slug <slug> [options]

Options:
  --slug           Slug truyện (bắt buộc)
  --epub-path      Đường dẫn EPUB (mặc định: novels/<slug>/book.epub)
  --synopsis-only  Chỉ trích synopsis, không tách chương
  --chapters-only  Chỉ tách chương, không lấy synopsis
  --overwrite      Ghi đè file đã tồn tại
  --out-dir        Thư mục đầu ra (mặc định: novels/<slug>/translated/)
  --dry-run        In kết quả mà không ghi file
"""

import argparse
import os
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

# ── Đảm bảo chạy được từ root project ─────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


# ── HTML → Plain Text converter ────────────────────────────────────────────────

class _HtmlToText(HTMLParser):
    """Convert HTML sang Markdown-like plain text, không cần beautifulsoup4."""

    SKIP_TAGS = {'script', 'style', 'img', 'figure', 'svg', 'meta', 'link',
                 'head', 'nav', 'footer', 'aside'}
    HEADING_TAGS = {'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}

    def __init__(self):
        super().__init__()
        self.result: list[str] = []
        self._skip_depth = 0
        self._in_heading = False
        self._heading_tag = ''
        self._buf = ''
        self._in_block = False  # đang trong <p> hoặc <div>

    def handle_starttag(self, tag, attrs):
        if self._skip_depth > 0:
            self._skip_depth += 1
            return
        if tag in self.SKIP_TAGS:
            self._skip_depth = 1
            return
        if tag in self.HEADING_TAGS:
            self._in_heading = True
            self._heading_tag = tag
            self._buf = ''
        elif tag in ('p', 'div', 'li', 'blockquote', 'dd', 'dt'):
            self._in_block = True
            self._buf = ''
        elif tag == 'br':
            self.result.append('')

    def handle_endtag(self, tag):
        if self._skip_depth > 0:
            self._skip_depth -= 1
            return
        if tag in self.HEADING_TAGS and self._in_heading:
            text = self._buf.strip()
            if text:
                prefix = '#' * int(tag[1])
                self.result.append(f'{prefix} {text}')
            self._in_heading = False
            self._buf = ''
        elif tag in ('p', 'div', 'li', 'blockquote', 'dd', 'dt') and self._in_block:
            text = self._buf.strip()
            if text:
                self.result.append(text)
            self._in_block = False
            self._buf = ''

    def handle_data(self, data):
        if self._skip_depth > 0:
            return
        cleaned = data.replace('\r', '').replace('\n', ' ')
        if self._in_heading or self._in_block:
            self._buf += cleaned
        else:
            stripped = cleaned.strip()
            if stripped:
                self.result.append(stripped)

    def get_text(self) -> str:
        lines = []
        prev_blank = False
        for line in self.result:
            if not line:
                if not prev_blank:
                    lines.append('')
                prev_blank = True
            else:
                lines.append(line)
                prev_blank = False
        return '\n\n'.join(p for p in '\n'.join(lines).split('\n\n') if p.strip())


def html_to_text(html_bytes: bytes) -> str:
    """Convert HTML bytes sang plain text Markdown-like."""
    try:
        html = html_bytes.decode('utf-8', errors='replace')
    except Exception:
        html = str(html_bytes)
    parser = _HtmlToText()
    parser.feed(html)
    return parser.get_text()


# ── EPUB parsing ───────────────────────────────────────────────────────────────

def _try_import_ebooklib():
    try:
        import ebooklib
        from ebooklib import epub
        return ebooklib, epub
    except ImportError:
        print('[ERROR] ebooklib chưa cài. Chạy: pip install ebooklib', file=sys.stderr)
        sys.exit(1)


def _clean_chapter_title(title: str) -> str:
    """Loại bỏ các ký tự lạ khỏi tiêu đề chương."""
    # Loại bỏ pagination suffix như (1/2), （2/3）
    title = re.sub(r'\s*[\(\（]\s*\d+\s*/\s*\d+\s*[\)\）]\s*$', '', title)
    return title.strip()


def _is_synopsis_item(text: str, title: str) -> bool:
    """Phán đoán xem item này có phải synopsis/intro không."""
    lower_title = title.lower()
    # Kiểm tra keywords trong tiêu đề
    intro_keywords = ['introduction', 'intro', 'synopsis', 'summary', 'giới thiệu',
                      'tóm tắt', '简介', 'preface', 'about', 'description', 'cover',
                      'foreword', 'prologue', 'mở đầu']
    for kw in intro_keywords:
        if kw in lower_title:
            return True
    # Nội dung ngắn và không chứa dấu hiệu chương
    chapter_markers = ['chương', '章', 'chapter', '回 ', '第']
    has_chapter_marker = any(m in text[:200].lower() for m in chapter_markers)
    if not has_chapter_marker and len(text) < 5000:
        return True
    return False


def _extract_chapter_number_from_title(title: str) -> int | None:
    """Trích số chương từ tiêu đề."""
    patterns = [
        r'[Cc]hương\s*(\d+)',
        r'第\s*(\d+)\s*[章回]',
        r'[Cc]hapter\s*(\d+)',
        r'^(\d+)[.\s]',
    ]
    for pat in patterns:
        m = re.search(pat, title)
        if m:
            return int(m.group(1))
    return None


def parse_epub(epub_path: str) -> dict:
    """
    Parse EPUB và trả về dict gồm:
    - synopsis: str (nội dung giới thiệu)
    - chapters: list[dict] với keys: number, title, content
    """
    ebooklib, epub = _try_import_ebooklib()

    book = epub.read_epub(epub_path)

    # Lấy TOC để map href -> title
    toc_map: dict[str, str] = {}  # href -> title

    def _walk_toc(items):
        for item in items:
            if isinstance(item, tuple):
                section, children = item
                if hasattr(section, 'href') and hasattr(section, 'title'):
                    toc_map[section.href.split('#')[0]] = section.title
                _walk_toc(children)
            elif hasattr(item, 'href') and hasattr(item, 'title'):
                toc_map[item.href.split('#')[0]] = item.title

    _walk_toc(book.toc)

    # Duyệt spine để giữ đúng thứ tự
    synopsis = ''
    chapters: list[dict] = []
    chap_counter = 0

    for item_id, _ in book.spine:
        item = book.get_item_with_id(item_id)
        if item is None:
            continue
        if item.get_type() != ebooklib.ITEM_DOCUMENT:
            continue

        content_bytes = item.get_content()
        text = html_to_text(content_bytes)

        if not text.strip():
            continue

        # Tìm tiêu đề từ TOC map
        item_name = item.get_name().split('#')[0]
        toc_title = toc_map.get(item_name, '') or toc_map.get(os.path.basename(item_name), '')

        # Thử lấy tiêu đề từ dòng đầu nội dung
        first_line = text.split('\n')[0].lstrip('#').strip()
        raw_title = toc_title or first_line

        clean_title = _clean_chapter_title(raw_title)

        # Phán đoán synopsis
        if not synopsis and _is_synopsis_item(text, clean_title):
            # Loại bỏ heading nếu đó chỉ là "Giới thiệu" không phải nội dung
            synopsis_text = text
            if first_line.lower() in ('giới thiệu', 'tóm tắt', 'synopsis', 'introduction', 'cover'):
                synopsis_text = '\n'.join(text.split('\n')[1:]).strip()
            synopsis = synopsis_text
            continue

        # Đây là chương
        chap_counter += 1
        chap_num = _extract_chapter_number_from_title(clean_title) or chap_counter

        chapters.append({
            'number': chap_num,
            'title': clean_title or f'Chương {chap_num}',
            'content': text,
        })

    # Sắp xếp theo số chương
    chapters.sort(key=lambda c: c['number'])

    return {'synopsis': synopsis, 'chapters': chapters}


# ── File output ────────────────────────────────────────────────────────────────

def _make_chapter_filename(chap: dict) -> str:
    """Tạo tên file theo convention: NNN_VI.md"""
    num = chap['number']
    # Làm sạch tiêu đề để dùng làm filename
    title_slug = re.sub(r'[^\w\s-]', '', chap['title'].lower())
    title_slug = re.sub(r'\s+', '-', title_slug.strip())[:50]
    title_slug = title_slug.strip('-')
    return f"{num:04d}_{title_slug}_VI.md"


def _write_synopsis(slug: str, synopsis: str, overwrite: bool, dry_run: bool) -> str | None:
    """Ghi synopsis.md vào novels/<slug>/synopsis.md."""
    out_path = ROOT / 'novels' / slug / 'synopsis.md'
    if out_path.exists() and not overwrite:
        print(f'[SKIP] synopsis đã tồn tại: {out_path}')
        return str(out_path)

    content = f"# Giới Thiệu\n\n{synopsis}\n"
    if dry_run:
        print(f'[DRY-RUN] Sẽ ghi synopsis ({len(synopsis)} ký tự) → {out_path}')
        return None

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(content, encoding='utf-8')
    print(f'[OK] synopsis → {out_path} ({len(synopsis)} ký tự)')
    return str(out_path)


def _write_chapter(slug: str, chap: dict, out_dir: Path, overwrite: bool, dry_run: bool) -> str | None:
    """Ghi 1 chương ra file .md."""
    filename = _make_chapter_filename(chap)
    out_path = out_dir / filename

    if out_path.exists() and not overwrite:
        return None  # Bỏ qua silently

    # Đảm bảo nội dung có heading tiêu đề
    content = chap['content']
    if not content.startswith('#'):
        content = f"# {chap['title']}\n\n{content}"

    if dry_run:
        print(f'[DRY-RUN] Chương {chap["number"]}: {chap["title"][:50]} → {filename}')
        return None

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(content, encoding='utf-8')
    return str(out_path)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Trích xuất synopsis và chương từ EPUB.')
    parser.add_argument('--slug', required=True, help='Slug truyện')
    parser.add_argument('--epub-path', help='Đường dẫn EPUB (mặc định: novels/<slug>/book.epub)')
    parser.add_argument('--synopsis-only', action='store_true', help='Chỉ trích synopsis')
    parser.add_argument('--chapters-only', action='store_true', help='Chỉ tách chương')
    parser.add_argument('--overwrite', action='store_true', help='Ghi đè file đã tồn tại')
    parser.add_argument('--out-dir', help='Thư mục đầu ra cho chapters (mặc định: novels/<slug>/translated/)')
    parser.add_argument('--dry-run', action='store_true', help='In kết quả mà không ghi file')
    args = parser.parse_args()

    slug = args.slug

    # Tìm file EPUB
    epub_path = args.epub_path
    if not epub_path:
        default_path = ROOT / 'novels' / slug / 'book.epub'
        if default_path.exists():
            epub_path = str(default_path)
        else:
            print(f'[ERROR] Không tìm thấy EPUB tại {default_path}', file=sys.stderr)
            print('Truyền --epub-path để chỉ định đường dẫn EPUB.', file=sys.stderr)
            sys.exit(1)

    print(f'[INFO] Đang parse EPUB: {epub_path}')
    result = parse_epub(epub_path)

    synopsis = result['synopsis']
    chapters = result['chapters']

    print(f'[INFO] Tìm thấy: synopsis={bool(synopsis)}, chapters={len(chapters)}')

    # Ghi synopsis
    if not args.chapters_only and synopsis:
        _write_synopsis(slug, synopsis, args.overwrite, args.dry_run)
    elif not args.chapters_only and not synopsis:
        print('[WARN] Không tìm thấy synopsis trong EPUB.')

    # Ghi chapters
    if not args.synopsis_only and chapters:
        out_dir = Path(args.out_dir) if args.out_dir else ROOT / 'novels' / slug / 'translated'
        written = 0
        skipped = 0
        for chap in chapters:
            result_path = _write_chapter(slug, chap, out_dir, args.overwrite, args.dry_run)
            if result_path:
                written += 1
            else:
                skipped += 1
        if args.dry_run:
            print(f'[DRY-RUN] Sẽ ghi {len(chapters)} chương vào {out_dir}')
        else:
            print(f'[OK] Chapters: {written} ghi mới, {skipped} bỏ qua (đã tồn tại).')
    elif not args.synopsis_only and not chapters:
        print('[WARN] Không tìm thấy chương nào trong EPUB.')

    print('[DONE]')


if __name__ == '__main__':
    main()
