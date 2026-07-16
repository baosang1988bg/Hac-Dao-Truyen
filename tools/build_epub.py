#!/usr/bin/env python3
"""
tools/build_epub.py — Build EPUB từ các file chương .md đã dịch.

Bản repo-hóa của script epub-builder, dùng cho layout HacDaoTruyen
(novels/<slug>/translated/*.md) nhưng cũng chạy được với bất kỳ thư mục
chứa file markdown chương nào.

Hỗ trợ tên file tiếng Việt ("Chương 112 - Title_VI.md"), tiếng Trung
("第一百一十二章 标题_VI.md") và fallback đọc số chương từ dòng header
"# Chương N: ..." trong nội dung (ví dụ file "chapter-1431txt_VI.md").
Chương được sort theo số, dedup (giữ file mới nhất), báo gap chương thiếu.

Usage (CLI — tương thích script gốc, mặc định --novels-dir là ./novels):
  # Liệt kê truyện + số chương đã dịch
  python3 tools/build_epub.py --list

  # Build 1 truyện (slug = tên folder trong novels/)
  python3 tools/build_epub.py --novel <slug> \
      [--title "Display Title"] [--author "Author"] [--out /path/out.epub]

  # Hoặc trỏ thẳng vào 1 folder chứa file .md
  python3 tools/build_epub.py --src /path/to/chapters --title "My Book" --out /tmp/book.epub

Usage (import — dùng bởi endpoint GET /api/novels/{slug}/epub):
  from tools.build_epub import build_novel_epub
  info = build_novel_epub("xich-tam-tuan-thien", prefer_ebooklib=True)
  # → {"path": "novels/<slug>/book.epub", "chapters": N, "title": "..."}

Backend: pandoc (mặc định cho truyện ngắn) hoặc ebooklib (nhanh, bắt buộc
với truyện >800 chương hoặc khi prefer_ebooklib=True).
"""
import argparse, json, os, re, subprocess, sys

DEFAULT_NOVELS_DIR = "novels"
DEFAULT_AUTHOR = "Bản dịch HacDaoTruyen"

CN_DIGITS = {'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}
CN_UNITS = {'十':10,'百':100,'千':1000,'万':10000}


def cn_to_int(s):
    total, section, num = 0, 0, 0
    for ch in s:
        if ch in CN_DIGITS:
            num = CN_DIGITS[ch]
        elif ch in CN_UNITS:
            u = CN_UNITS[ch]
            if u == 10000:
                total += (section + num) * u
                section, num = 0, 0
            else:
                section += (num if num else 1) * u
                num = 0
        else:
            return None
    return total + section + num


def chapter_num(fname):
    base = fname[:-3] if fname.endswith('.md') else fname
    m = re.search(r'Chương\s+(\d+)', base, re.I)
    if m:
        return int(m.group(1))
    m = re.search(r'第(\d+)章', base)
    if m:
        return int(m.group(1))
    # Bắt buộc có 章 — nếu không, file "第一卷总结" (tổng kết quyển 1)
    # sẽ bị nhận nhầm thành chương 1 và đè mất chương thật.
    m = re.search(r'第([零一二两三四五六七八九十百千万]+)\s*章', base)
    if m:
        v = cn_to_int(m.group(1))
        if v is not None:
            return v
    # bare leading number, e.g. "0001 - title.md"
    m = re.match(r'\s*(\d+)', base)
    if m:
        return int(m.group(1))
    return None


def chapter_num_from_content(path):
    """Fallback: đọc số chương từ dòng header '# Chương N: ...' trong file
    (dùng cho file có tên không parse được, ví dụ 'chapter-1431txt_VI.md')."""
    try:
        with open(path, encoding='utf-8') as fh:
            for _ in range(5):
                line = fh.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                m = re.search(r'Chương\s+(\d+)', line, re.I) or re.search(r'第(\d+)章', line)
                if m:
                    return int(m.group(1))
                break  # chỉ xét dòng có nội dung đầu tiên
    except Exception:
        pass
    return None


def chapter_title(fname, num, first_line):
    if first_line.startswith('#'):
        t = first_line.lstrip('#').strip()
        if t:
            return t
    base = fname[:-6] if fname.endswith('_VI.md') else fname[:-3]
    m = re.match(r'Chương\s+\d+\s*[-:–]\s*(.+)', base, re.I)
    if m:
        return f"Chương {num}: {m.group(1).strip()}"
    return f"Chương {num}: {base}"


def pandoc_split_flag():
    try:
        v = subprocess.run(['pandoc', '--version'], capture_output=True, text=True).stdout
        major = int(re.search(r'pandoc(?:\.exe)?\s+(\d+)', v).group(1))
    except Exception:
        major = 2
    return '--split-level=1' if major >= 3 else '--epub-chapter-level=1'


def find_chapter_dir(novel_dir):
    """Prefer 'translated', fall back to 'text_vi'."""
    for sub in ('translated', 'text_vi'):
        p = os.path.join(novel_dir, sub)
        if os.path.isdir(p) and any(f.endswith('.md') for f in os.listdir(p)):
            return p
    return None


def list_novels(novels_dir):
    rows = []
    for slug in sorted(os.listdir(novels_dir)):
        d = os.path.join(novels_dir, slug)
        if not os.path.isdir(d):
            continue
        ch_dir = find_chapter_dir(d)
        count = len([f for f in os.listdir(ch_dir) if f.endswith('.md')]) if ch_dir else 0
        title = slug
        nj = os.path.join(d, 'novel.json')
        if os.path.isfile(nj):
            try:
                title = json.load(open(nj, encoding='utf-8')).get('title') or slug
            except Exception:
                pass
        rows.append((slug, title, count))
    return rows


def _write_epub_ebooklib(parts, title, author, out_epub):
    """Ghi EPUB bằng ebooklib — mỗi phần tử của `parts` là '# Tiêu đề\\n\\nbody'."""
    import html as _html
    from ebooklib import epub as _epub

    book = _epub.EpubBook()
    book.set_identifier('hacdao-' + re.sub(r'\W+', '-', title.lower()))
    book.set_title(title)
    book.set_language('vi')
    book.add_author(author)

    chapters = []
    for i, part in enumerate(parts, 1):
        lines = part.strip().split('\n')
        ch_title = lines[0].lstrip('#').strip() or f'Chương {i}'
        body = '\n'.join(lines[1:]).strip()
        paras = ''.join(f'<p>{_html.escape(p.strip())}</p>'
                        for p in body.split('\n\n') if p.strip())
        c = _epub.EpubHtml(title=ch_title, file_name=f'ch{i:04d}.xhtml', lang='vi')
        c.content = f'<h1>{_html.escape(ch_title)}</h1>{paras}'
        book.add_item(c)
        chapters.append(c)

    book.toc = chapters
    book.spine = ['nav'] + chapters
    book.add_item(_epub.EpubNcx())
    book.add_item(_epub.EpubNav())
    _epub.write_epub(out_epub, book)


def build(src_dir, title, author, out_epub, prefer_ebooklib=None, quiet=False):
    """
    Build EPUB từ folder chương .md.

    prefer_ebooklib:
      - True  : bắt buộc ebooklib (raise ImportError nếu chưa cài — caller xử lý)
      - False : bắt buộc pandoc
      - None  : tự chọn (>800 chương → ebooklib, fallback pandoc nếu thiếu)

    Trả về dict {"path", "chapters", "range", "skipped", "dupes", "gaps", "title"}.
    Raise RuntimeError nếu không có chương hợp lệ.
    """
    def say(msg):
        if not quiet:
            print(msg)

    files = [f for f in os.listdir(src_dir) if f.endswith('.md')]
    if not files:
        raise RuntimeError(f"no .md files in {src_dir}")
    items, skipped = [], []
    for f in files:
        n = chapter_num(f)
        if n is None:
            # Tên file không parse được → thử đọc header '# Chương N' trong nội dung
            n = chapter_num_from_content(os.path.join(src_dir, f))
        (items if n is not None else skipped).append((n, f) if n is not None else f)
    if not items:
        raise RuntimeError(f"no parseable chapter files in {src_dir} (skipped: {skipped[:10]})")
    # Same chapter number can exist under two filenames (e.g. a re-translation
    # with a Vietnamese name next to the old Chinese-named file). Keep the most
    # recently modified file — it reflects the latest translation/glossary.
    items.sort(key=lambda x: (x[0], os.path.getmtime(os.path.join(src_dir, x[1]))))
    best = {}
    dupes = []
    for n, f in items:
        if n in best:
            dupes.append((n, best[n]))  # older file being replaced
        best[n] = f
    ordered = sorted(best.items())
    seen = set(best)

    parts = []
    for n, f in ordered:
        with open(os.path.join(src_dir, f), encoding='utf-8') as fh:
            text = fh.read().strip()
        lines = text.split('\n')
        first = lines[0].strip() if lines else ''
        title_ch = chapter_title(f, n, first)
        body = '\n'.join(lines[1:]).strip() if first.startswith('#') else text
        # Strip images (often leftover ads); remote fetches slow pandoc down
        # and break offline reading anyway.
        body = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', body)
        body = re.sub(r'<img[^>]*>', '', body)
        parts.append(f"# {title_ch}\n\n{body}\n")

    os.makedirs(os.path.dirname(os.path.abspath(out_epub)), exist_ok=True)

    # Truyện dài (>800 chương) pandoc rất chậm (nhiều phút) — dùng ebooklib
    # (pip install ebooklib) nhanh hơn hàng chục lần. Truyện ngắn giữ pandoc
    # để không thêm dependency bắt buộc (trừ khi prefer_ebooklib=True).
    if prefer_ebooklib is True:
        _write_epub_ebooklib(parts, title, author, out_epub)  # ImportError → caller
    else:
        use_ebooklib = (prefer_ebooklib is None) and len(ordered) > 800
        if use_ebooklib:
            try:
                _write_epub_ebooklib(parts, title, author, out_epub)
            except ImportError:
                say("WARN: ebooklib chưa cài (pip install ebooklib) — fallback pandoc, có thể chậm.")
                use_ebooklib = False
        if not use_ebooklib:
            combined = os.path.join('/tmp', re.sub(r'\W+', '_', title) + '_build.md')
            with open(combined, 'w', encoding='utf-8') as fh:
                fh.write('\n\n'.join(parts))
            meta = combined + '.yaml'
            with open(meta, 'w', encoding='utf-8') as fh:
                fh.write(f'---\ntitle: "{title}"\nauthor: "{author}"\nlang: vi\n---\n')
            subprocess.run(['pandoc', combined, '--metadata-file', meta,
                            '-f', 'markdown', '-t', 'epub3', '--toc', '--toc-depth=1',
                            pandoc_split_flag(), '-o', out_epub], check=True)

    nums = [n for n, _ in ordered]
    gaps = [x for x in range(nums[0], nums[-1] + 1) if x not in seen]
    say(f"OK: {out_epub}")
    say(f"chapters={len(ordered)} range={nums[0]}..{nums[-1]}")
    if skipped:
        say(f"SKIPPED (unparseable filename): {skipped}")
    if dupes:
        say(f"DUPLICATES ignored: {[(n, f) for n, f in dupes]}")
    if gaps:
        say(f"GAPS ({len(gaps)} missing): {gaps[:30]}{' ...' if len(gaps) > 30 else ''}")

    return {
        "path": out_epub,
        "chapters": len(ordered),
        "range": (nums[0], nums[-1]),
        "skipped": skipped,
        "dupes": dupes,
        "gaps": gaps,
        "title": title,
    }


def build_novel_epub(slug, novels_dir=DEFAULT_NOVELS_DIR, out_path=None,
                     author=DEFAULT_AUTHOR, prefer_ebooklib=True, quiet=True):
    """
    Build EPUB cho 1 truyện theo slug — dùng bởi FastAPI endpoint và auto_update.

    Output mặc định: novels/<slug>/book.epub (file cache của endpoint /epub).
    Raise:
      FileNotFoundError — không có folder truyện / không có chương dịch
      ImportError       — prefer_ebooklib=True nhưng ebooklib chưa cài
      RuntimeError      — không có chương parse được
    """
    d = os.path.join(novels_dir, slug)
    if not os.path.isdir(d):
        raise FileNotFoundError(f"novel folder not found: {d}")
    src = find_chapter_dir(d)
    if not src:
        raise FileNotFoundError(f"no translated/ or text_vi/ chapters in {d}")

    title = None
    nj = os.path.join(d, 'novel.json')
    if os.path.isfile(nj):
        try:
            title = json.load(open(nj, encoding='utf-8')).get('title')
        except Exception:
            pass
    title = title or slug

    out = out_path or os.path.join(d, 'book.epub')
    return build(src, title, author, out, prefer_ebooklib=prefer_ebooklib, quiet=quiet)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--novels-dir', default=DEFAULT_NOVELS_DIR,
                    help='Path to the novels/ directory (default: ./novels)')
    ap.add_argument('--novel', help='Novel slug (folder name under novels/)')
    ap.add_argument('--src', help='Direct path to a folder of chapter .md files')
    ap.add_argument('--title', help='Book title (default: from novel.json or slug)')
    ap.add_argument('--author', default=DEFAULT_AUTHOR)
    ap.add_argument('--out', help='Output .epub path (default: novels/<slug>/book.epub)')
    ap.add_argument('--ebooklib', action='store_true',
                    help='Bắt buộc dùng ebooklib (nhanh) thay vì pandoc')
    ap.add_argument('--list', action='store_true', help='List novels and chapter counts')
    a = ap.parse_args()

    if a.list:
        for slug, title, count in list_novels(a.novels_dir):
            print(f"{slug}\t{title}\t{count} chapters translated")
        return

    prefer = True if a.ebooklib else None

    try:
        if a.src:
            src, title = a.src, a.title or os.path.basename(a.src.rstrip('/'))
            out = a.out or os.path.join('/tmp', re.sub(r'\W+', '', title) + '.epub')
            build(src, title, a.author, out, prefer_ebooklib=prefer)
        else:
            if not a.novel:
                sys.exit('Provide --src or --novel (or use --list)')
            build_novel_epub(a.novel, novels_dir=a.novels_dir, out_path=a.out,
                             author=a.author or DEFAULT_AUTHOR,
                             prefer_ebooklib=prefer, quiet=False)
    except (FileNotFoundError, RuntimeError) as e:
        sys.exit(f"ERROR: {e}")
    except ImportError:
        sys.exit("ERROR: ebooklib chưa cài — pip install ebooklib")


if __name__ == '__main__':
    main()
