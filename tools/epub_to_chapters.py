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

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

# ── Đảm bảo chạy được từ root project ─────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


# ── HTML → Markdown converter (giữ định dạng đậm/nghiêng/heading/hr) ──────────

_MD_ESCAPE_RE = re.compile(r'([\\`*_])')


def _escape_md(text: str) -> str:
    """Escape các ký tự markdown đặc biệt trong text thô, tránh format lạ ngoài ý muốn."""
    return _MD_ESCAPE_RE.sub(r'\\\1', text)


class _HtmlToText(HTMLParser):
    """Convert HTML sang Markdown, giữ nguyên format gốc (đậm/nghiêng/heading/hr),
    không cần beautifulsoup4."""

    SKIP_TAGS = {'script', 'style', 'img', 'figure', 'svg', 'meta', 'link',
                 'head', 'nav', 'footer', 'aside'}
    HEADING_TAGS = {'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}
    BLOCK_TAGS = {'p', 'div', 'li', 'blockquote', 'dd', 'dt'}
    BOLD_TAGS = {'b', 'strong'}
    ITALIC_TAGS = {'i', 'em', 'cite'}

    def __init__(self):
        super().__init__()
        self.result: list[str] = []
        self._skip_depth = 0
        self._in_heading = False
        self._heading_tag = ''
        self._buf = ''
        self._block_depth = 0  # cho phép block lồng nhau (vd <div><p>...)

    def _in_content_ctx(self) -> bool:
        return self._in_heading or self._block_depth > 0

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
        elif tag in self.BLOCK_TAGS:
            if self._block_depth == 0:
                self._buf = ''
            self._block_depth += 1
        elif tag in self.BOLD_TAGS:
            if self._in_content_ctx():
                self._buf += '**'
        elif tag in self.ITALIC_TAGS:
            if self._in_content_ctx():
                self._buf += '*'
        elif tag == 'br':
            if self._in_content_ctx():
                self._buf += '  \n'
            else:
                self.result.append('')
        elif tag == 'hr':
            self.result.append('---')

    def handle_startendtag(self, tag, attrs):
        # Thẻ tự đóng kiểu <br/>, <hr/>, <head/> — PHẢI gọi cả start lẫn end,
        # nếu không skip_depth (vd sau <head/>) sẽ không bao giờ giảm lại,
        # khiến toàn bộ nội dung phía sau bị coi là "đang skip".
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

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
        elif tag in self.BLOCK_TAGS and self._block_depth > 0:
            self._block_depth -= 1
            if self._block_depth == 0:
                text = self._buf.strip()
                if text:
                    self.result.append(text)
                self._buf = ''
        elif tag in self.BOLD_TAGS:
            if self._in_content_ctx():
                self._buf += '**'
        elif tag in self.ITALIC_TAGS:
            if self._in_content_ctx():
                self._buf += '*'

    def handle_data(self, data):
        if self._skip_depth > 0:
            return
        cleaned = _escape_md(data.replace('\r', '').replace('\n', ' '))
        if self._in_content_ctx():
            self._buf += cleaned
        else:
            stripped = cleaned.strip()
            if stripped:
                self.result.append(stripped)

    def get_text(self) -> str:
        # Mỗi phần tử trong self.result là 1 heading/đoạn/hr hoàn chỉnh -> nối
        # bằng dòng trống để tạo đúng ranh giới đoạn văn (markdown paragraph).
        paragraphs = [p for p in self.result if p.strip()]
        return '\n\n'.join(paragraphs)


def html_to_text(html_bytes: bytes) -> str:
    """Convert HTML bytes sang Markdown giữ định dạng (đậm/nghiêng/heading/hr)."""
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
    """Fallback: phán đoán synopsis/intro khi không xác định được chương nào có số
    thứ tự rõ ràng (dùng khi không thể áp dụng logic vị trí trong _split_front_matter)."""
    lower_title = title.lower()
    intro_keywords = ['introduction', 'intro', 'synopsis', 'summary', 'giới thiệu',
                      'tóm tắt', '简介', 'preface', 'about', 'description', 'cover',
                      'foreword', 'prologue', 'mở đầu']
    for kw in intro_keywords:
        if kw in lower_title:
            return True
    chapter_markers = ['chương', '章', 'chapter', '回 ', '第']
    has_chapter_marker = any(m in text[:200].lower() for m in chapter_markers)
    if not has_chapter_marker and len(text) < 5000:
        return True
    return False


_TOC_MARKERS = {
    'mục lục', 'muc luc', 'table of contents', 'contents', '目录', '目錄', 'toc',
}


def _looks_like_toc_marker(paragraph: str) -> bool:
    """Nhận diện 1 đoạn có phải tiêu đề 'Mục Lục' / TOC hay không."""
    p = paragraph.strip().lstrip('#').strip().lower()
    # Bỏ dấu ':' cuối nếu có, kiểu "Mục lục:"
    p = p.rstrip(':').strip()
    return p in _TOC_MARKERS


def _split_before_toc(text: str) -> str:
    """Cắt bỏ toàn bộ nội dung TỪ mục lục trở đi, chỉ giữ phần trước đó.
    Nếu không tìm thấy mục lục thì giữ nguyên toàn bộ text."""
    paragraphs = text.split('\n\n')
    for i, para in enumerate(paragraphs):
        if _looks_like_toc_marker(para):
            return '\n\n'.join(paragraphs[:i]).strip()
    return text.strip()


def _strip_leading_title(text: str, book_title: str) -> str:
    """Bỏ dòng đầu nếu nó chỉ lặp lại tên truyện, để synopsis bắt đầu ngay SAU tên truyện."""
    if not book_title:
        return text
    normalized_title = book_title.strip().lower()
    paragraphs = text.split('\n\n')
    while paragraphs:
        first = paragraphs[0].strip().lstrip('#').strip().lower()
        if first and first == normalized_title:
            paragraphs.pop(0)
        else:
            break
    return '\n\n'.join(paragraphs).strip()


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


_WATERMARK_PATTERNS = [
    re.compile(r'^Nguồn\s*:.*', re.IGNORECASE),
    re.compile(r'^Epub\s+tạo\s+bởi\s*:.*', re.IGNORECASE),
    re.compile(r'^Tác\s+giả\s*:.*', re.IGNORECASE),
    re.compile(r'^Thể\s+loại\s*:.*', re.IGNORECASE),
    re.compile(r'^Trạng\s+thái\s*:.*', re.IGNORECASE),
    re.compile(r'^Truyện\s+được\s+đăng\s+tại.*', re.IGNORECASE),
]


def _normalize_title_key(title: str) -> str:
    """Loại bỏ dấu câu và ký tự đặc biệt để so sánh 2 tiêu đề."""
    t = title.lstrip('#').strip().lower()
    t = re.sub(r'[^\w\s]', '', t)
    return re.sub(r'\s+', ' ', t).strip()


def _clean_chapter_text(text: str, title: str) -> str:
    """Loại bỏ watermark rác, khử lặp tiêu đề, và gom các câu tự sự lẻ thành đoạn văn chuẩn."""
    if not text:
        return ''

    paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
    if not paragraphs:
        return ''

    # Step 1: Lọc watermark & tiêu đề lặp
    title_key = _normalize_title_key(title)
    cleaned_paras = []
    seen_paras = set()

    for i, p in enumerate(paragraphs):
        # Lọc watermark/quảng cáo
        is_watermark = False
        for pat in _WATERMARK_PATTERNS:
            if pat.match(p):
                is_watermark = True
                break
        if is_watermark:
            continue

        # Bỏ dòng lặp tiêu đề ở đầu (vd: # Chương 1. ... và Chương 1; ...)
        p_key = _normalize_title_key(p)
        if i < 2 and title_key and (p_key == title_key or (len(title_key) > 5 and (title_key in p_key or p_key in title_key))):
            continue

        # Khử trùng lặp dòng/đoạn văn lặp lại hoàn toàn
        if p != '---' and len(p) > 15:
            if p_key in seen_paras:
                continue
            seen_paras.add(p_key)

        cleaned_paras.append(p)

    if not cleaned_paras:
        cleaned_paras = paragraphs

    # Step 2: Merge broken narrative lines into paragraphs
    merged_paras = []
    current_block = []

    def is_standalone_line(p_str: str) -> bool:
        if p_str.startswith('#'):
            return True
        if p_str in ('---', '. . .', '...', '***'):
            return True
        first_char = p_str[0]
        if first_char in ('"', '«', '“', "'", '‘', '「', '【', '（', '('):
            return True
        if p_str.startswith('- ') or p_str.startswith('* ') or re.match(r'^\d+[\.\)]\s', p_str):
            return True
        if p_str.startswith('«') or p_str.startswith('»'):
            return True
        return False

    for p in cleaned_paras:
        if is_standalone_line(p):
            if current_block:
                merged_paras.append(' '.join(current_block))
                current_block = []
            merged_paras.append(p)
        else:
            curr_len = sum(len(x) for x in current_block)
            if curr_len > 450:
                merged_paras.append(' '.join(current_block))
                current_block = [p]
            else:
                current_block.append(p)

    if current_block:
        merged_paras.append(' '.join(current_block))

    return '\n\n'.join(merged_paras).strip()


def parse_epub(epub_path: str) -> dict:
    """
    Parse EPUB và trả về dict gồm:
    - synopsis: str (toàn bộ nội dung từ SAU tên truyện đến TRƯỚC mục lục)
    - chapters: list[dict] với keys: number, title, content (giữ format markdown)
    """
    ebooklib, epub = _try_import_ebooklib()

    book = epub.read_epub(epub_path)

    # Tên truyện từ metadata — dùng để cắt dòng lặp lại tiêu đề trong synopsis
    book_title = ''
    try:
        title_meta = book.get_metadata('DC', 'title')
        if title_meta:
            book_title = title_meta[0][0]
    except Exception:
        pass

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

    # Duyệt spine, giữ đúng thứ tự, gom (title, text) cho từng item có nội dung
    docs: list[dict] = []  # {'title': str, 'text': str, 'chap_num': int|None}

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

        # Bỏ qua các item chỉ là trang Mục Lục thuần túy trong spine
        if _looks_like_toc_marker(clean_title):
            continue

        docs.append({
            'title': clean_title,
            'text': text,
            'chap_num': _extract_chapter_number_from_title(clean_title),
        })

    # Xác định chương THẬT đầu tiên (có số thứ tự rõ ràng qua tiêu đề/TOC).
    # Mọi item ĐỨNG TRƯỚC nó trong spine được coi là "front matter" (bìa, lời tựa,
    # giới thiệu, mục lục...) — gộp lại rồi cắt lấy đúng phần giới thiệu.
    first_chapter_idx = next(
        (i for i, d in enumerate(docs) if d['chap_num'] is not None), None
    )

    synopsis = ''
    chapters: list[dict] = []
    chap_counter = 0

    if first_chapter_idx is not None and first_chapter_idx > 0:
        front_matter_text = '\n\n'.join(d['text'] for d in docs[:first_chapter_idx])
        synopsis_text = _split_before_toc(front_matter_text)
        synopsis_text = _strip_leading_title(synopsis_text, book_title)
        synopsis = synopsis_text.strip()
        chapter_docs = docs[first_chapter_idx:]
    elif first_chapter_idx is None and docs:
        # Không xác định được chương nào có số thứ tự -> dùng fallback heuristic
        # cũ cho đúng 1 item đầu tiên, phần còn lại coi là chương theo thứ tự spine.
        first_doc = docs[0]
        if _is_synopsis_item(first_doc['text'], first_doc['title']):
            synopsis_text = _split_before_toc(first_doc['text'])
            synopsis = _strip_leading_title(synopsis_text, book_title).strip()
            chapter_docs = docs[1:]
        else:
            chapter_docs = docs
    else:
        chapter_docs = docs

    for d in chapter_docs:
        # Bỏ qua item là Mục Lục
        if _looks_like_toc_marker(d['title']):
            continue

        clean_text = _clean_chapter_text(d['text'], d['title'])
        if not clean_text:
            continue

        chap_counter += 1
        chap_num = d['chap_num'] or chap_counter
        chapters.append({
            'number': chap_num,
            'title': d['title'] or f'Chương {chap_num}',
            'content': clean_text,
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
