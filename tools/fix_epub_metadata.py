#!/usr/bin/env python3
"""
tools/fix_epub_metadata.py — Sửa metadata (tên/tác giả/thể loại/giới thiệu) của
~28.500 truyện EPUB đã import lên D1 với dữ liệu sai.

Bối cảnh: lượt import từ kho audiotruyenfull ghi `title` = slug (không dấu),
`author` rỗng/'Unknown', `genre` = "Tiên Hiệp, Huyền Huyễn, Đô Thị" cho MỌI
truyện (bug fetch_genres lấy link menu), synopsis còn dòng "Epub tạo bởi:
audiotruyenfull.org". Worker syncNovelBatch ON CONFLICT chỉ cập nhật
total_chapters nên sync lại không sửa được → tool này sinh câu UPDATE có điều
kiện (idempotent) từ metadata THẬT trong OPF của từng EPUB.

Quy trình an toàn (mặc định là DRY-RUN, không ghi gì lên cloud):
  1. Lấy trạng thái hiện tại D1 (CHỈ ĐỌC):
       npx wrangler d1 execute hacdao-db --remote --json --command "SELECT slug,title,author,genre,source_url,synopsis FROM novels" > current.json
     hoặc dùng --fetch-current (tool tự gọi đúng lệnh đọc này).
  2. Dry-run, sinh SQL + báo cáo để người dùng duyệt:
       python tools/fix_epub_metadata.py --epub-dir D:\\epub_library\\epubs --meta-dir D:\\epub_library\\meta ^
         --catalog D:\\epub_library\\catalog_full.jsonl --current-json current.json --out-sql out\\fix_meta
  3. Áp dụng theo ngày, có cầu chì ngân sách D1 + file resume:
       set HACDAO_ALLOW_CLOUD_WRITES=true
       python tools/fix_epub_metadata.py --out-sql out\\fix_meta --apply --max-rows-per-run 2500
  4. Hoàn tác: --apply --rollback (chạy rollback_*.sql khôi phục giá trị cũ).

Quy tắc quyết định (tránh ghi đè truyện đã có tên đúng):
  - Slug trong thư mục novels/ của repo (truyện đang dịch) và truyện có
    source_url (nguồn dịch) → KHÔNG BAO GIỜ đụng.
  - title: chỉ khi title hiện tại trống hoặc toàn ASCII (= slug / không dấu) VÀ
    title mới bỏ dấu khớp title cũ bỏ dấu hoặc ≈ slug. Lệch → ghi "cần duyệt tay".
  - author: chỉ khi trống / 'Unknown'.
  - genre: chỉ khi đúng chuỗi gán sai "Tiên Hiệp, Huyền Huyễn, Đô Thị" (hoặc
    trống) → thay bằng thể loại OPF/info; EPUB không có thể loại → 'Khác'
    (giống mặc định của batch_epub_processor; truyện vẫn lọc được trong mục
    "Khác" thay vì mang thể loại sai — để '' sẽ làm truyện biến mất khỏi bộ lọc).
  - synopsis (--fix-synopsis): lọc dòng ghi công + khối "Tác giả/Thể loại/…" đầu
    synopsis; synopsis trống thì lấy phần giới thiệu trong EPUB.
  - KHÔNG đổi updated_at: cột này xếp mục "mới cập nhật" — đổi cho 28k truyện sẽ
    đẩy toàn bộ kho EPUB lên đầu trang chủ.
"""

import argparse
import csv
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools.epub_to_chapters import (  # noqa: E402
    EpubValidationError, clean_author, clean_book_title, clean_synopsis,
    read_epub_metadata, split_genres, strip_source_suffix,
)

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

D1_DB = 'hacdao-db'
DEFAULT_STATE = ROOT / 'tools' / '.fix_epub_metadata_state.json'
BAD_GENRE = 'Tiên Hiệp, Huyền Huyễn, Đô Thị'
UNKNOWN_GENRE = 'Khác'
# Mỗi UPDATE ghi 1 dòng bảng novels. Cột đổi (title/author/genre/synopsis)
# không nằm trong index nào (idx_novels_views=views, idx_novels_chapter_count=
# updated_at, idx_novels_published_updated=published+updated_at) nên thực tế
# ~1 row write; tính 2 để dư an toàn (D1 tính thêm 1
# dòng cho mỗi index bị chạm nếu sau này thêm index trên các cột này).
ROWS_PER_UPDATE = 2
UPDATE_FIELDS = ('title', 'author', 'genre', 'synopsis')
_SLUG_SUFFIX_RE = re.compile(r'(?:[-_.]?(?:www\.)?audiotruyenfull(?:\.org)?)+$', re.I)

# Thể loại tiếng Việt (map từ slug /the-loai/ — giống tools/import_epub_library.py).
GENRE_NAMES = {
    'tien-hiep': 'Tiên Hiệp', 'huyen-huyen': 'Huyền Huyễn', 'kiem-hiep': 'Kiếm Hiệp',
    'do-thi': 'Đô Thị', 'he-thong': 'Hệ Thống', 'khoa-huyen': 'Khoa Huyễn',
    'dong-nhan': 'Đồng Nhân', 'vong-du': 'Võng Du', 'lich-su': 'Lịch Sử',
    'tong-tai': 'Tổng Tài', 'ngon-tinh': 'Ngôn Tình', 'co-dai': 'Cổ Đại',
    'kinh-di': 'Kinh Dị', 'dam-my': 'Đam Mỹ', 'di-gioi': 'Dị Giới', 'quan-su': 'Quân Sự',
}


# ── Chuẩn hoá & so khớp ────────────────────────────────────────────────────────

def strip_accents(text: str) -> str:
    """Bỏ dấu tiếng Việt (đ→d) — dùng để so khớp, không dùng để ghi."""
    text = unicodedata.normalize('NFD', text or '')
    text = ''.join(ch for ch in text if unicodedata.category(ch) != 'Mn')
    return unicodedata.normalize('NFC', text).replace('đ', 'd').replace('Đ', 'D')


def fold(text: str) -> str:
    """'Lãnh Chúa: Cầu Sinh' → 'lanh-chua-cau-sinh' (dạng slug để so sánh)."""
    text = strip_accents(text).lower()
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')


def slug_from_filename(path: Path) -> str:
    """'{slug}.epub' hoặc '{slug}-audiotruyenfull.org.epub' → slug."""
    name = path.name[:-5] if path.name.lower().endswith('.epub') else path.stem
    name = _SLUG_SUFFIX_RE.sub('', strip_source_suffix(name))
    return name.strip(' -_.').lower()


def approx_slug(folded_title: str, slug: str) -> bool:
    """Tên mới (đã fold) ≈ slug: bằng nhau, là tiền tố của nhau (slug hay bị cắt
    hoặc thêm hậu tố số), hoặc giống ≥ 85%."""
    if not folded_title or not slug:
        return False
    if folded_title == slug:
        return True
    shorter, longer = sorted((folded_title, slug), key=len)
    if len(shorter) >= 8 and longer.startswith(shorter):
        return True
    return difflib.SequenceMatcher(None, folded_title, slug).ratio() >= 0.85


def is_bad_genre(genre: str) -> bool:
    parts = [p.lower() for p in split_genres(genre)]
    return parts == [p.lower() for p in split_genres(BAD_GENRE)]


def is_placeholder_author(author: str) -> bool:
    return not clean_author(author or '')


def _has_vietnamese_letters(text: str) -> bool:
    return strip_accents(text) != text


# ── Nguồn metadata dự phòng (meta/*.json, catalog_full.jsonl) ─────────────────

def _first(d: dict, *keys):
    for k in keys:
        v = d.get(k)
        if isinstance(v, dict):
            v = v.get('name') or v.get('title')
        if isinstance(v, list):
            v = ', '.join(str(x.get('name') if isinstance(x, dict) else x) for x in v if x)
        if v:
            return str(v)
    return ''


def _trusted_genres(raw) -> list[str]:
    """Danh sách thể loại từ meta/catalog. meta['genres'] do fetch_genres CŨ sinh
    ra (dump menu) → bỏ nếu bắt đầu bằng đúng 3 mục menu hoặc ≥ 10 mục."""
    names = [GENRE_NAMES.get(g, g) if isinstance(g, str) else g for g in (raw or [])] \
        if isinstance(raw, list) else split_genres(raw)
    names = split_genres(names)
    if len(names) >= 10 or [n.lower() for n in names[:3]] == [p.lower() for p in split_genres(BAD_GENRE)]:
        return []
    return names


def fallback_metadata(slug: str, meta_dir: Path | None, catalog: dict) -> dict:
    out = {'title': '', 'author': '', 'subjects': [], 'description': ''}
    sources = []
    if meta_dir:
        meta_file = meta_dir / f'{slug}.json'
        if meta_file.exists():
            try:
                sources.append(json.loads(meta_file.read_text(encoding='utf-8')))
            except (OSError, ValueError):
                pass
    if slug in catalog:
        sources.append(catalog[slug])
    for src in sources:
        out['title'] = out['title'] or clean_book_title(_first(src, 'title', 'name'))
        out['author'] = out['author'] or clean_author(_first(src, 'author', 'author_name', 'authors'))
        out['subjects'] = out['subjects'] or _trusted_genres(src.get('categories') or src.get('genres'))
        out['description'] = out['description'] or clean_synopsis(_first(src, 'description', 'intro', 'synopsis'))
    return out


def load_catalog(path: Path | None) -> dict:
    catalog = {}
    if path and path.exists():
        with path.open(encoding='utf-8') as f:
            for line in f:
                try:
                    item = json.loads(line)
                    catalog[item['slug']] = item
                except (ValueError, KeyError, TypeError):
                    continue
    return catalog


# ── Trạng thái hiện tại D1 ─────────────────────────────────────────────────────

def parse_current(data) -> dict:
    """Nhận output `wrangler d1 execute --json` ([{results:[...]}]), {results:[...]}
    hoặc list dòng → {slug: row}."""
    rows = []
    if isinstance(data, dict):
        data = [data]
    for block in data or []:
        if isinstance(block, dict) and isinstance(block.get('results'), list):
            rows.extend(block['results'])
        elif isinstance(block, dict) and 'slug' in block:
            rows.append(block)
    return {r['slug']: r for r in rows if isinstance(r, dict) and r.get('slug')}


def read_json_file(path: Path):
    """Đọc JSON từ file do PowerShell/cmd ghi: chịu BOM UTF-8/UTF-16 (PowerShell 5
    `>` ghi UTF-16LE) và vài dòng log wrangler trước khối JSON."""
    raw = path.read_bytes()
    if raw[:2] in (b'\xff\xfe', b'\xfe\xff'):
        text = raw.decode('utf-16')
    else:
        text = raw.decode('utf-8-sig')
    start = min([i for i in (text.find('['), text.find('{')) if i >= 0], default=0)
    return json.loads(text[start:])


def _npx():
    from tools.cloudflare_usage import _npx as npx
    return npx()


def fetch_current(with_synopsis: bool) -> dict:
    """Gọi wrangler CHỈ ĐỌC (SELECT) lấy trạng thái novels hiện tại."""
    cols = 'slug,title,author,genre,source_url' + (',synopsis' if with_synopsis else '')
    cmd = [_npx(), 'wrangler', 'd1', 'execute', D1_DB, '--remote', '--json',
           '--command', f'SELECT {cols} FROM novels']
    res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if res.returncode != 0:
        raise RuntimeError(f'wrangler SELECT lỗi: {res.stderr.strip()[:500]}')
    start = res.stdout.find('[')
    if start < 0:
        raise RuntimeError('wrangler không trả JSON')
    return parse_current(json.loads(res.stdout[start:]))


def protected_slugs(novels_dir: Path, extra=()) -> set:
    """Slug truyện đang dịch trong repo (novels/<slug>/) — không bao giờ đụng."""
    slugs = {p.name for p in novels_dir.iterdir() if p.is_dir() and not p.name.startswith('.')} \
        if novels_dir.exists() else set()
    return slugs | {s.strip() for s in extra if s and s.strip()}


# ── Quyết định cập nhật ────────────────────────────────────────────────────────

def decide(slug: str, current: dict | None, meta: dict, protected: set,
           fix_synopsis: bool = False, unknown_genre: str = UNKNOWN_GENRE) -> dict:
    """Trả {'changes': {field: (cũ, mới)}, 'reasons': {field: lý do}, 'skip': lý do|None,
    'review': [ghi chú cần duyệt tay]}."""
    result = {'slug': slug, 'changes': {}, 'reasons': {}, 'skip': None, 'review': []}
    if slug in protected:
        result['skip'] = 'slug được bảo vệ (novels/ trong repo)'
        return result
    if current is None:
        result['skip'] = 'không có trong D1'
        return result
    if (current.get('source_url') or '').strip():
        result['skip'] = 'có source_url (truyện dịch) — không đụng'
        return result

    cur_title = current.get('title') or ''
    new_title = clean_book_title(meta.get('title'))
    if new_title and new_title != cur_title:
        slug_like = not cur_title.strip() or cur_title.isascii()
        matches = (bool(cur_title.strip()) and fold(new_title) == fold(cur_title)) or approx_slug(fold(new_title), slug)
        if not slug_like:
            pass  # title hiện tại đã có dấu/ký tự riêng → coi là đúng, không đè
        elif not (_has_vietnamese_letters(new_title) or not new_title.isascii() or not cur_title.strip()):
            pass  # title mới cũng không dấu → không cải thiện gì
        elif matches:
            result['changes']['title'] = (cur_title, new_title)
            result['reasons']['title'] = 'title hiện tại trống/không dấu; OPF khớp slug'
        else:
            result['review'].append(f'title OPF "{new_title}" không khớp title/slug hiện tại "{cur_title}"')

    cur_author = current.get('author') or ''
    new_author = clean_author(meta.get('author'))
    if new_author and is_placeholder_author(cur_author) and new_author != cur_author:
        result['changes']['author'] = (cur_author, new_author)
        result['reasons']['author'] = 'author trống/Unknown'

    cur_genre = current.get('genre') or ''
    if is_bad_genre(cur_genre) or not cur_genre.strip():
        new_genre = ', '.join(meta.get('subjects') or []) or unknown_genre
        if new_genre != cur_genre:
            result['changes']['genre'] = (cur_genre, new_genre)
            result['reasons']['genre'] = ('genre gán sai/trống → thể loại EPUB' if meta.get('subjects')
                                          else f'genre gán sai/trống, EPUB không có thể loại → {unknown_genre!r}')

    if fix_synopsis and 'synopsis' in current:
        cur_syn = current.get('synopsis') or ''
        new_syn = clean_synopsis(cur_syn) if cur_syn.strip() else clean_synopsis(meta.get('description'))
        if new_syn and new_syn != cur_syn:
            result['changes']['synopsis'] = (cur_syn, new_syn)
            result['reasons']['synopsis'] = 'lọc dòng ghi công' if cur_syn.strip() else 'synopsis trống → giới thiệu trong EPUB'
    return result


# ── SQL ────────────────────────────────────────────────────────────────────────

def sql_str(value) -> str:
    """Literal SQL an toàn: NULL, nháy đơn nhân đôi, bỏ NUL. Dấu ';' tách bằng
    char(59) để KHÔNG bao giờ bị bộ tách câu lệnh của wrangler cắt giữa chuỗi
    (không mất dữ liệu như cách thay ';' bằng ' - ' của import_epub_library)."""
    if value is None:
        return 'NULL'
    text = str(value).replace('\x00', '')
    parts = ["'" + p.replace("'", "''") + "'" for p in text.split(';')]
    return parts[0] if len(parts) == 1 else '(' + " || char(59) || ".join(parts) + ')'


def build_update(slug: str, changes: dict, reverse: bool = False) -> str:
    """UPDATE có điều kiện: chỉ ghi khi các cột cần đổi vẫn còn đúng giá trị cũ
    (chạy lại lần 2 = không làm gì; ai đó sửa tay trong lúc chờ = không đè)."""
    fields = [f for f in UPDATE_FIELDS if f in changes]
    if not fields:
        return ''
    pick = (lambda f: changes[f][0]) if reverse else (lambda f: changes[f][1])
    guard = (lambda f: changes[f][1]) if reverse else (lambda f: changes[f][0])
    sets = ', '.join(f'{f} = {sql_str(pick(f))}' for f in fields)
    where = ' AND '.join([f'slug = {sql_str(slug)}'] + [f'{f} IS {sql_str(guard(f))}' for f in fields])
    return f'UPDATE novels SET {sets} WHERE {where};'


def chunk(items: list, size: int) -> list:
    if size <= 0:
        raise ValueError('batch-size phải > 0')
    return [items[i:i + size] for i in range(0, len(items), size)]


def _write_text(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8', newline='') as f:   # newline='' → không CRLF trên Windows
        f.write(text)


def write_sql_batches(decisions: list, out_dir: Path, batch_size: int) -> list[Path]:
    """Ghi update_0001.sql… + rollback_0001.sql… (cùng lô, khôi phục giá trị cũ)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in list(out_dir.glob('update_*.sql')) + list(out_dir.glob('rollback_*.sql')):
        old.unlink()
    todo = [d for d in decisions if d['changes']]
    files = []
    for i, group in enumerate(chunk(todo, batch_size), 1):
        head = f'-- fix_epub_metadata lô {i}: {len(group)} câu UPDATE (sinh lúc {datetime.now().isoformat(timespec="seconds")})\n'
        upd = out_dir / f'update_{i:04d}.sql'
        _write_text(upd, head + '\n'.join(build_update(d['slug'], d['changes']) for d in group) + '\n')
        _write_text(out_dir / f'rollback_{i:04d}.sql',
                    head.replace('UPDATE', 'UPDATE hoàn tác') + '\n'.join(build_update(d['slug'], d['changes'], reverse=True)
                                                                         for d in group) + '\n')
        files.append(upd)
    return files


def write_reports(decisions: list, out_dir: Path) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path, json_path = out_dir / 'report.csv', out_dir / 'report.json'
    with csv_path.open('w', encoding='utf-8-sig', newline='') as f:   # BOM để Excel Windows đọc đúng tiếng Việt
        w = csv.writer(f)
        w.writerow(['slug', 'field', 'old', 'new', 'reason'])
        for d in decisions:
            for field, (old, new) in d['changes'].items():
                def short(s, field=field):
                    if field != 'synopsis':
                        return s
                    s = re.sub(r'\s*\n+\s*', ' ⏎ ', s)
                    return s[:160] + '…' if len(s) > 160 else s
                w.writerow([d['slug'], field, short(old), short(new), d['reasons'].get(field, '')])
    summary = summarize(decisions)
    summary['skipped'] = {d['slug']: d['skip'] for d in decisions if d['skip']}
    summary['review'] = {d['slug']: d['review'] for d in decisions if d['review']}
    _write_text(json_path, json.dumps(summary, ensure_ascii=False, indent=2))
    return csv_path, json_path


def summarize(decisions: list) -> dict:
    s = {'epubs': len(decisions), 'updates': 0, 'skipped_count': 0, 'review_count': 0,
         'fields': {f: 0 for f in UPDATE_FIELDS}, 'skip_reasons': {}}
    for d in decisions:
        if d['changes']:
            s['updates'] += 1
        for f in d['changes']:
            s['fields'][f] += 1
        if d['skip']:
            s['skipped_count'] += 1
            s['skip_reasons'][d['skip']] = s['skip_reasons'].get(d['skip'], 0) + 1
        if d['review']:
            s['review_count'] += 1
    s['estimated_d1_rows'] = s['updates'] * ROWS_PER_UPDATE
    return s


# ── Quét EPUB ──────────────────────────────────────────────────────────────────

def collect_decisions(epub_dir: Path, current: dict, protected: set, meta_dir=None, catalog=None,
                      fix_synopsis=False, unknown_genre=UNKNOWN_GENRE, limit=0, log=print) -> list:
    catalog = catalog or {}
    epubs = sorted(p for p in epub_dir.glob('*.epub') if not p.name.startswith('.'))
    if limit:
        epubs = epubs[:limit]
    decisions = []
    for i, path in enumerate(epubs, 1):
        slug = slug_from_filename(path)
        if slug in protected or slug not in current:
            decisions.append(decide(slug, current.get(slug), {}, protected))
            continue
        try:
            meta = read_epub_metadata(path)
        except (EpubValidationError, OSError, KeyError, ValueError) as exc:
            meta = {'title': '', 'author': '', 'subjects': [], 'description': ''}
            log(f'⚠️  {path.name}: không đọc được OPF ({exc}) — dùng meta/catalog')
        fb = fallback_metadata(slug, meta_dir, catalog)
        merged = {k: meta.get(k) or fb.get(k) for k in ('title', 'author', 'subjects', 'description')}
        decisions.append(decide(slug, current[slug], merged, protected, fix_synopsis, unknown_genre))
        if i % 2000 == 0:
            log(f'  … đã quét {i:,}/{len(epubs):,} EPUB')
    return decisions


# ── Apply (ghi D1, có cầu chì) ────────────────────────────────────────────────

def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_state(path: Path) -> dict:
    try:
        state = json.loads(path.read_text(encoding='utf-8'))
        return state if isinstance(state, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(path: Path, state: dict):
    from tools.sync_budget import atomic_json
    atomic_json(path, state)


def count_statements(path: Path) -> int:
    """Số câu UPDATE của lô (đọc từ dòng tiêu đề do write_sql_batches ghi)."""
    text = path.read_text(encoding='utf-8')
    m = re.match(r'-- fix_epub_metadata lô \d+: (\d+) câu', text)
    return int(m.group(1)) if m else sum(1 for ln in text.splitlines() if ln.startswith('UPDATE novels SET '))


def run_wrangler_file(path: Path) -> tuple[bool, str]:
    cmd = [_npx(), 'wrangler', 'd1', 'execute', D1_DB, '--remote', '--yes', '--json', '--file', str(path)]
    res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return res.returncode == 0, (res.stdout + res.stderr)[-2000:]


def apply_batches(sql_dir: Path, state_path: Path, max_rows: int, budget=None, rollback=False,
                  runner=run_wrangler_file, log=print) -> dict:
    """Chạy lần lượt update_*.sql (hoặc rollback_*.sql), dừng khi chạm
    --max-rows-per-run hoặc ngân sách. File đã chạy ghi vào state (theo sha256)
    → lần sau chạy tiếp. Ngân sách được TRỪ TRƯỚC khi gửi (như sync_budget),
    không hoàn lại nếu wrangler lỗi."""
    from tools.sync_budget import require_cloud_writes
    require_cloud_writes()
    if budget is None:
        from tools.sync_budget import budget_from_env
        budget = budget_from_env()
    kind = 'rollback' if rollback else 'update'
    files = sorted(sql_dir.glob(f'{kind}_*.sql'))
    state = load_state(state_path)
    done = state.setdefault(kind, {})
    run_rows, applied, stop = 0, [], None
    for path in files:
        digest = _sha(path)
        if done.get(path.name, {}).get('sha256') == digest:
            continue
        rows = count_statements(path) * ROWS_PER_UPDATE
        if rows == 0:
            continue
        if run_rows + rows > max_rows:
            stop = f'chạm --max-rows-per-run ({run_rows:,} + {rows:,} > {max_rows:,}) — chạy tiếp ngày sau'
            break
        if not budget.try_reserve(0, rows):
            stop = budget.stopped_reason or 'hết ngân sách D1'
            break
        log(f'▶️  {path.name}: ~{rows:,} dòng ghi D1 …')
        ok, out = runner(path)
        if not ok:
            stop = f'wrangler lỗi ở {path.name}: {out.strip()[-300:]}'
            break
        run_rows += rows
        done[path.name] = {'sha256': digest, 'rows_estimate': rows,
                           'at': datetime.now(timezone.utc).isoformat(timespec='seconds')}
        state['sql_dir'] = str(sql_dir)
        save_state(state_path, state)
        applied.append(path.name)
    remaining = [p.name for p in files if done.get(p.name, {}).get('sha256') != _sha(p)]
    return {'applied': applied, 'rows': run_rows, 'stopped': stop, 'remaining': remaining,
            'budget': budget.summary() if hasattr(budget, 'summary') else ''}


# ── CLI ────────────────────────────────────────────────────────────────────────

def build_parser():
    p = argparse.ArgumentParser(
        description='Sửa tên/tác giả/thể loại/giới thiệu truyện EPUB trên D1 từ OPF (mặc định dry-run).',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--epub-dir', type=Path, help=r'Thư mục *.epub (vd D:\epub_library\epubs) — bắt buộc khi sinh SQL')
    p.add_argument('--meta-dir', type=Path, help=r'Thư mục meta/{slug}.json (dự phòng khi OPF thiếu)')
    p.add_argument('--catalog', type=Path, help='catalog_full.jsonl (dự phòng khi OPF thiếu)')
    src = p.add_mutually_exclusive_group()
    src.add_argument('--current-json', type=Path, help='Output `wrangler d1 execute --json` SELECT slug,title,author,genre,… FROM novels')
    src.add_argument('--fetch-current', action='store_true', help='Tự gọi wrangler SELECT (CHỈ ĐỌC) để lấy trạng thái hiện tại')
    p.add_argument('--out-sql', type=Path, help='Thư mục ghi update_*.sql, rollback_*.sql, report.csv/json')
    p.add_argument('--batch-size', type=int, default=500, help='Số câu UPDATE mỗi file SQL (mặc định 500)')
    p.add_argument('--fix-synopsis', action='store_true', help='Sinh thêm UPDATE synopsis đã lọc dòng ghi công')
    p.add_argument('--unknown-genre', default=UNKNOWN_GENRE, help="Thể loại khi EPUB không khai báo (mặc định 'Khác')")
    p.add_argument('--protect', action='append', default=[], help='Thêm slug cần bảo vệ (lặp lại được)')
    p.add_argument('--limit', type=int, default=0, help='Chỉ quét N EPUB đầu (thử nghiệm)')
    p.add_argument('--sample', type=int, default=20, help='Số dòng mẫu in ra để duyệt (mặc định 20)')
    p.add_argument('--apply', action='store_true', help='Chạy các file SQL trong --out-sql lên D1 (cần HACDAO_ALLOW_CLOUD_WRITES=true)')
    p.add_argument('--rollback', action='store_true', help='Cùng --apply: chạy rollback_*.sql thay vì update_*.sql')
    p.add_argument('--max-rows-per-run', type=int, default=2500, help='Trần dòng ghi D1 ước tính mỗi lần chạy (mặc định 2500)')
    p.add_argument('--state-file', type=Path, default=DEFAULT_STATE, help='File trạng thái resume')
    return p


def _print_sample(decisions: list, n: int):
    rows = [(d['slug'], f, o, nw) for d in decisions for f, (o, nw) in d['changes'].items()][:n]
    if rows:
        print(f'\n📝 Mẫu {len(rows)} thay đổi đầu tiên:')
        for slug, f, old, new in rows:
            cut = (lambda s: (s[:60] + '…') if len(s) > 60 else s)
            print(f'  {slug:<45} {f:<8} {cut(old)!r} → {cut(new)!r}')


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.apply:
        if not args.out_sql or not args.out_sql.exists():
            print('❌ --apply cần --out-sql trỏ tới thư mục SQL đã sinh ở bước dry-run')
            return 2
        try:
            res = apply_batches(args.out_sql, args.state_file, args.max_rows_per_run, rollback=args.rollback)
        except RuntimeError as exc:
            print(f'❌ {exc}')
            return 2
        print(f"✅ Đã chạy {len(res['applied'])} file ({res['rows']:,} dòng ghi ước tính): {', '.join(res['applied']) or '—'}")
        print(f"📦 Còn lại {len(res['remaining'])} file. 💰 {res['budget']}")
        if res['stopped']:
            print(f"⏸️  Dừng: {res['stopped']}")
        return 0 if not res['stopped'] or not res['remaining'] or res['applied'] else 1

    if not args.epub_dir or not args.epub_dir.exists():
        print('❌ Thiếu/không thấy --epub-dir')
        return 2
    if args.fetch_current:
        current = fetch_current(args.fix_synopsis)
    elif args.current_json:
        current = parse_current(read_json_file(args.current_json))
    else:
        print('❌ Cần --current-json FILE hoặc --fetch-current (trạng thái D1 hiện tại)')
        return 2
    if args.fix_synopsis and current and not any('synopsis' in r for r in current.values()):
        print('⚠️  current-json không có cột synopsis → bỏ qua --fix-synopsis (thêm synopsis vào SELECT)')

    protected = protected_slugs(ROOT / 'novels', args.protect)
    print(f'🔒 Bảo vệ {len(protected)} slug: {", ".join(sorted(protected))}')
    print(f'📚 D1 hiện có {len(current):,} truyện; quét {args.epub_dir} …')
    decisions = collect_decisions(args.epub_dir, current, protected, args.meta_dir, load_catalog(args.catalog),
                                  args.fix_synopsis, args.unknown_genre, args.limit)
    s = summarize(decisions)
    print(f"\n📊 EPUB quét: {s['epubs']:,} | cần UPDATE: {s['updates']:,} | bỏ qua: {s['skipped_count']:,} | "
          f"cần duyệt tay: {s['review_count']:,}")
    print('   Theo cột: ' + ', '.join(f'{k}={v:,}' for k, v in s['fields'].items()))
    for reason, n in sorted(s['skip_reasons'].items(), key=lambda x: -x[1]):
        print(f'   Bỏ qua — {reason}: {n:,}')
    print(f"   Ước tính D1: ~{s['estimated_d1_rows']:,} dòng ghi "
          f"(≈ {-(-s['estimated_d1_rows'] // max(1, args.max_rows_per_run))} lượt × {args.max_rows_per_run:,})")
    _print_sample(decisions, args.sample)
    if args.out_sql:
        files = write_sql_batches(decisions, args.out_sql, args.batch_size)
        csv_path, json_path = write_reports(decisions, args.out_sql)
        print(f'\n💾 {len(files)} file update_*.sql (+ rollback_*.sql) tại {args.out_sql}')
        print(f'   Báo cáo: {csv_path} , {json_path}')
    print('\nℹ️  DRY-RUN: chưa ghi gì lên D1. Duyệt báo cáo rồi chạy lại với --apply.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
