"""Test cho tools/fix_epub_metadata.py (+ phần đọc OPF trong epub_to_chapters và
fetch_genres mới của download_epubs). Không mạng, không wrangler thật — EPUB
tối giản được tạo bằng zipfile trong tmp_path, SQL được chạy thử trên sqlite3."""
import json
import sqlite3
import unicodedata
import zipfile

import pytest

from tools import download_epubs
from tools import epub_to_chapters as etc
from tools import fix_epub_metadata as fx

BAD = 'Tiên Hiệp, Huyền Huyễn, Đô Thị'
CONTAINER = ('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
             '<rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/>'
             '</rootfiles></container>')


def make_epub(path, title='', creators=(), subjects=(), description='', info_html=None):
    dc = ''.join(f'<dc:title>{title}</dc:title>' for _ in [0] if title)
    dc += ''.join(f'<dc:creator>{c}</dc:creator>' for c in creators)
    dc += ''.join(f'<dc:subject>{s}</dc:subject>' for s in subjects)
    if description:
        dc += f'<dc:description>{description}</dc:description>'
    manifest = '<item id="info" href="info.xhtml" media-type="application/xhtml+xml"/>' if info_html else ''
    opf = ('<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">'
           f'<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">{dc}</metadata>'
           f'<manifest>{manifest}</manifest><spine/></package>')
    with zipfile.ZipFile(path, 'w') as zf:
        zf.writestr('mimetype', 'application/epub+zip')
        zf.writestr('META-INF/container.xml', CONTAINER)
        zf.writestr('EPUB/content.opf', opf)
        if info_html:
            zf.writestr('EPUB/info.xhtml', info_html)
    return path


INFO_HTML = ('<html><body><h1>X</h1><p>Epub tạo bởi: <a href="https://audiotruyenfull.org/app">audiotruyenfull.org</a></p>'
             '<dl class="metadata"><dt>Tác giả</dt><dd>Kỳ Khai</dd><dt>Thể loại</dt><dd>Huyền Huyễn, Toàn Dân</dd>'
             '<dt>Trạng thái</dt><dd>Đang ra</dd></dl><h2>Giới thiệu truyện</h2><p>Lam tinh tận thế!!!</p></body></html>')


# ── Đọc OPF & chuẩn hoá ───────────────────────────────────────────────────────

def test_read_opf_title_creators_subjects_description(tmp_path):
    decomposed = unicodedata.normalize('NFD', 'Lãnh Chúa Cầu Sinh')
    p = make_epub(tmp_path / 'a.epub', title=f'  {decomposed} - audiotruyenfull.org ',
                  creators=['Kỳ Khai', 'Unknown', 'Tác Giả Hai', 'Kỳ Khai'],
                  subjects=['Huyền Huyễn, Hệ Thống', 'Hệ Thống'], description='<p>Giới thiệu &amp; nội dung</p>')
    meta = etc.read_epub_metadata(p)
    assert meta['title'] == 'Lãnh Chúa Cầu Sinh'
    assert unicodedata.is_normalized('NFC', meta['title'])
    assert meta['authors'] == ['Kỳ Khai', 'Tác Giả Hai']
    assert meta['author'] == 'Kỳ Khai, Tác Giả Hai'
    assert meta['subjects'] == ['Huyền Huyễn', 'Hệ Thống']
    assert meta['description'] == 'Giới thiệu & nội dung'


def test_info_page_fallback_for_author_genre_description(tmp_path):
    p = make_epub(tmp_path / 'b.epub', title='Tên Truyện', info_html=INFO_HTML)
    meta = etc.read_epub_metadata(p)
    assert meta['author'] == 'Kỳ Khai'
    assert meta['subjects'] == ['Huyền Huyễn', 'Toàn Dân']
    assert meta['description'] == 'Lam tinh tận thế!!!'
    assert meta['status'] == 'Đang ra'


def test_missing_opf_raises_validation_error(tmp_path):
    p = tmp_path / 'c.epub'
    with zipfile.ZipFile(p, 'w') as zf:
        zf.writestr('mimetype', 'application/epub+zip')
    with pytest.raises(etc.EpubValidationError):
        etc.read_epub_metadata(p)


@pytest.mark.parametrize('raw,expected', [
    ('Abc - audiotruyenfull.org', 'Abc'), ('Abc (audiotruyenfull.org)', 'Abc'),
    ('Abc | AudioTruyenFull', 'Abc'), ('Abc [Full]', 'Abc'), ('  A  b ', 'A b'),
])
def test_clean_book_title(raw, expected):
    assert etc.clean_book_title(raw) == expected


def test_clean_synopsis_removes_credit_and_metadata_block():
    raw = ('Epub tạo bởi: audiotruyenfull.org\n\nTác giả\n\nKỳ Khai\n\nThể loại\n\nHuyền Huyễn\n\n'
           '## Giới thiệu truyện\n\nĐoạn một.\n\nĐoạn hai.')
    assert etc.clean_synopsis(raw) == 'Đoạn một.\n\nĐoạn hai.'
    assert etc.clean_synopsis('Đoạn A.\nEpub tạo bởi: audiotruyenfull.org\n\nĐoạn B.') == 'Đoạn A.\n\nĐoạn B.'
    assert etc.clean_synopsis('Giới thiệu truyện\n\nKhông có metadata phía trước') == \
        'Giới thiệu truyện\n\nKhông có metadata phía trước'


@pytest.mark.parametrize('name,slug', [
    ('ten-truyen.epub', 'ten-truyen'),
    ('lanh-chua-cau-sinh-thien-phu-hop-thanh-audiotruyenfull.org.epub', 'lanh-chua-cau-sinh-thien-phu-hop-thanh'),
    ('Ten-Truyen_audiotruyenfull.epub', 'ten-truyen'),
])
def test_slug_from_filename(tmp_path, name, slug):
    assert fx.slug_from_filename(tmp_path / name) == slug


def test_fold_and_approx_slug():
    assert fx.fold('Lãnh Chúa: Cầu Sinh — Đại Đạo') == 'lanh-chua-cau-sinh-dai-dao'
    assert fx.approx_slug('lanh-chua-cau-sinh', 'lanh-chua-cau-sinh-12345')
    assert not fx.approx_slug('mot-truyen-khac-han', 'lanh-chua-cau-sinh')


# ── Quyết định cập nhật ───────────────────────────────────────────────────────

META = {'title': 'Lãnh Chúa Cầu Sinh', 'author': 'Kỳ Khai', 'subjects': ['Huyền Huyễn', 'Toàn Dân'],
        'description': 'Giới thiệu'}


def row(**kw):
    base = {'slug': 'lanh-chua-cau-sinh', 'title': 'lanh-chua-cau-sinh', 'author': 'Unknown', 'genre': BAD,
            'source_url': ''}
    return dict(base, **kw)


def test_decide_updates_slug_title_unknown_author_and_bad_genre():
    d = fx.decide('lanh-chua-cau-sinh', row(), META, set())
    assert d['changes'] == {'title': ('lanh-chua-cau-sinh', 'Lãnh Chúa Cầu Sinh'),
                            'author': ('Unknown', 'Kỳ Khai'),
                            'genre': (BAD, 'Huyền Huyễn, Toàn Dân')}
    assert d['skip'] is None


def test_decide_accepts_unaccented_title_matching_after_fold():
    d = fx.decide('lcs-123', row(slug='lcs-123', title='Lanh Chua Cau Sinh'), META, set())
    assert d['changes']['title'] == ('Lanh Chua Cau Sinh', 'Lãnh Chúa Cầu Sinh')


def test_decide_never_touches_protected_slug():
    d = fx.decide('lanh-chua-cau-sinh', row(), META, {'lanh-chua-cau-sinh'})
    assert d['changes'] == {} and 'bảo vệ' in d['skip']


def test_decide_never_touches_rows_with_source_url():
    d = fx.decide('lanh-chua-cau-sinh', row(source_url='https://novel543.com/1/'), META, set())
    assert d['changes'] == {} and 'source_url' in d['skip']


def test_decide_keeps_correct_accented_title_and_real_author_genre():
    current = row(title='Lãnh Chúa Cầu Sinh: Bản Dịch Riêng', author='Tác Giả Thật', genre='Đô Thị')
    d = fx.decide('lanh-chua-cau-sinh', current, META, set())
    assert d['changes'] == {}


def test_decide_mismatched_title_goes_to_review_not_update():
    d = fx.decide('lanh-chua-cau-sinh', row(), dict(META, title='Một Truyện Hoàn Toàn Khác'), set())
    assert 'title' not in d['changes']
    assert d['review'] and 'không khớp' in d['review'][0]


def test_decide_genre_without_subjects_becomes_khac():
    d = fx.decide('lanh-chua-cau-sinh', row(), dict(META, subjects=[]), set())
    assert d['changes']['genre'] == (BAD, 'Khác')
    assert 'Khác' in d['reasons']['genre']


def test_decide_missing_in_d1_is_skipped():
    assert fx.decide('x', None, META, set())['skip'] == 'không có trong D1'


def test_decide_fix_synopsis_only_when_requested():
    current = row(synopsis='Epub tạo bởi: audiotruyenfull.org\n\nNội dung.')
    assert 'synopsis' not in fx.decide('lanh-chua-cau-sinh', current, META, set())['changes']
    d = fx.decide('lanh-chua-cau-sinh', current, META, set(), fix_synopsis=True)
    assert d['changes']['synopsis'][1] == 'Nội dung.'
    empty = fx.decide('lanh-chua-cau-sinh', row(synopsis=''), META, set(), fix_synopsis=True)
    assert empty['changes']['synopsis'] == ('', 'Giới thiệu')


def test_meta_fallback_ignores_menu_dump_genres(tmp_path):
    (tmp_path / 'abc.json').write_text(json.dumps({
        'title': 'Tên Từ Meta', 'author': 'Tác Giả Meta',
        'genres': ['tien-hiep', 'huyen-huyen', 'do-thi', 'kiem-hiep']}, ensure_ascii=False), encoding='utf-8')
    fb = fx.fallback_metadata('abc', tmp_path, {'abc': {'slug': 'abc', 'description': 'Mô tả'}})
    assert fb['title'] == 'Tên Từ Meta' and fb['author'] == 'Tác Giả Meta'
    assert fb['subjects'] == []
    assert fb['description'] == 'Mô tả'


# ── SQL: escape, idempotent, rollback, chia lô ────────────────────────────────

def _db(rows):
    con = sqlite3.connect(':memory:')
    con.execute("CREATE TABLE novels (slug TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT DEFAULT '', "
                "genre TEXT DEFAULT '', synopsis TEXT DEFAULT '', updated_at TEXT DEFAULT 'x')")
    con.executemany('INSERT INTO novels (slug,title,author,genre,synopsis) VALUES (?,?,?,?,?)', rows)
    return con


def test_sql_str_escapes_quotes_semicolons_and_nul():
    assert fx.sql_str("Ta's") == "'Ta''s'"
    assert fx.sql_str(None) == 'NULL'
    assert ';' not in fx.sql_str("a; b'; DROP TABLE novels; --")
    con = sqlite3.connect(':memory:')
    tricky = "Ta's; DROP TABLE x; -- 'nháy'\x00"
    assert con.execute('SELECT ' + fx.sql_str(tricky)).fetchone()[0] == tricky.replace('\x00', '')


def test_update_and_rollback_roundtrip_on_sqlite_is_idempotent():
    slug = "ten-o'neil"
    con = _db([(slug, slug, 'Unknown', BAD, 'cũ')])
    changes = {'title': (slug, "Tên O'Neil; Phần 1"), 'author': ('Unknown', 'Kỳ Khai')}
    upd, rb = fx.build_update(slug, changes), fx.build_update(slug, changes, reverse=True)
    assert con.execute(upd).rowcount == 1
    assert con.execute('SELECT title, author, genre, updated_at FROM novels').fetchone() == \
        ("Tên O'Neil; Phần 1", 'Kỳ Khai', BAD, 'x')
    assert con.execute(upd).rowcount == 0            # chạy lại: không ghi gì
    assert con.execute(rb).rowcount == 1
    assert con.execute('SELECT title, author FROM novels').fetchone() == (slug, 'Unknown')


def test_update_does_not_overwrite_title_changed_after_snapshot():
    con = _db([('s', 'Tên Admin Sửa Tay', 'Unknown', BAD, '')])
    upd = fx.build_update('s', {'title': ('s', 'Tên Mới')})
    assert con.execute(upd).rowcount == 0
    assert con.execute('SELECT title FROM novels').fetchone()[0] == 'Tên Admin Sửa Tay'


def test_decide_keeps_none_for_null_columns():
    """Cột NULL trên D1 → giá trị cũ giữ None (không ép '') để WHERE dùng IS NULL."""
    d = fx.decide('lanh-chua-cau-sinh', row(title=None, author=None, genre=None, synopsis=None), META, set(),
                  fix_synopsis=True)
    assert d['changes']['author'] == (None, 'Kỳ Khai')
    assert d['changes']['genre'] == (None, 'Huyền Huyễn, Toàn Dân')
    assert d['changes']['title'] == (None, 'Lãnh Chúa Cầu Sinh')
    assert d['changes']['synopsis'] == (None, 'Giới thiệu')
    upd = fx.build_update('lanh-chua-cau-sinh', d['changes'])
    assert 'author IS NULL' in upd and "author IS ''" not in upd


def test_null_columns_update_and_rollback_back_to_null_on_sqlite(tmp_path):
    """sqlite3 thật: dòng có cột NULL được cập nhật (trước đây `IS ''` không khớp
    → 0 dòng) và rollback trả về đúng NULL (không phải '')."""
    con = sqlite3.connect(':memory:')
    con.execute('CREATE TABLE novels (slug TEXT PRIMARY KEY, title TEXT, author TEXT, genre TEXT, synopsis TEXT, '
                'source_url TEXT)')
    con.execute('INSERT INTO novels VALUES (?,?,?,?,?,?)', ('lanh-chua-cau-sinh', None, None, None, None, None))
    current = {'slug': 'lanh-chua-cau-sinh', 'title': None, 'author': None, 'genre': None, 'synopsis': None,
               'source_url': None}
    d = fx.decide('lanh-chua-cau-sinh', current, META, set(), fix_synopsis=True)
    files = fx.write_sql_batches([d], tmp_path, batch_size=10)
    fx.write_reports([d], tmp_path)   # report chịu được giá trị None
    before = con.total_changes
    con.executescript(files[0].read_text(encoding='utf-8'))
    assert con.total_changes - before == 1
    assert con.execute('SELECT title, author, genre, synopsis FROM novels').fetchone() == \
        ('Lãnh Chúa Cầu Sinh', 'Kỳ Khai', 'Huyền Huyễn, Toàn Dân', 'Giới thiệu')
    con.executescript((tmp_path / 'rollback_0001.sql').read_text(encoding='utf-8'))
    assert con.execute('SELECT title, author, genre, synopsis FROM novels').fetchone() == (None, None, None, None)
    assert con.execute('SELECT COUNT(*) FROM novels WHERE author IS NULL AND genre IS NULL').fetchone()[0] == 1


def test_parse_changes_reads_wrangler_json_meta():
    out = ('wrangler 3.x\n[{"results": [], "success": true, "meta": {"changes": 3, "rows_written": 3}},'
           ' {"results": [], "success": true, "meta": {"changes": 2}}]')
    assert fx.parse_changes(out) == 5
    assert fx.parse_changes('[{"results": [], "meta": {"rows_written": 4}}]') == 4
    assert fx.parse_changes('{"meta": {"changes": 0}}') == 0
    assert fx.parse_changes('') is None
    assert fx.parse_changes('{}') is None
    assert fx.parse_changes('không phải json') is None


def _decision(slug, title):
    return {'slug': slug, 'changes': {'title': (slug, title)}, 'reasons': {'title': 'r'}, 'skip': None, 'review': []}


def test_write_sql_batches_splits_and_files_execute(tmp_path):
    decisions = [_decision(f's{i}', f"Tên {i}'") for i in range(5)]
    decisions.append({'slug': 'z', 'changes': {}, 'reasons': {}, 'skip': 'không có trong D1', 'review': []})
    files = fx.write_sql_batches(decisions, tmp_path, batch_size=2)
    assert [f.name for f in files] == ['update_0001.sql', 'update_0002.sql', 'update_0003.sql']
    assert sorted(p.name for p in tmp_path.glob('rollback_*.sql')) == ['rollback_0001.sql', 'rollback_0002.sql',
                                                                      'rollback_0003.sql']
    assert [fx.count_statements(f) for f in files] == [2, 2, 1]
    assert b'\r\n' not in files[0].read_bytes()
    con = _db([(f's{i}', f's{i}', '', BAD, '') for i in range(5)])
    for f in files:
        con.executescript(f.read_text(encoding='utf-8'))
    assert con.execute("SELECT title FROM novels WHERE slug='s4'").fetchone()[0] == "Tên 4'"
    for f in sorted(tmp_path.glob('rollback_*.sql')):
        con.executescript(f.read_text(encoding='utf-8'))
    assert con.execute("SELECT title FROM novels WHERE slug='s4'").fetchone()[0] == 's4'
    csv_path, json_path = fx.write_reports(decisions, tmp_path)
    assert 'Tên 0' in csv_path.read_text(encoding='utf-8-sig')
    report = json.loads(json_path.read_text(encoding='utf-8'))
    assert report['updates'] == 5 and report['skipped'] == {'z': 'không có trong D1'}


def test_chunk_rejects_non_positive_size():
    with pytest.raises(ValueError):
        fx.chunk([1], 0)


# ── Apply: cầu chì, ngân sách, resume ─────────────────────────────────────────

class FakeBudget:
    def __init__(self, cap):
        self.cap, self.used, self.stopped_reason = cap, 0, None

    def try_reserve(self, r2, d1):
        assert r2 == 0
        if self.used + d1 > self.cap:
            self.stopped_reason = 'Hết ngân sách được cấu hình; chưa gửi request'
            return False
        self.used += d1
        return True

    def summary(self):
        return f'D1 {self.used}/{self.cap}'


def _sql_dir(tmp_path, n_files=3, per_file=2):
    decisions = [_decision(f's{i}', f'Tên {i}') for i in range(n_files * per_file)]
    fx.write_sql_batches(decisions, tmp_path / 'sql', batch_size=per_file)
    return tmp_path / 'sql'


def test_apply_refused_without_allow_cloud_writes(tmp_path, monkeypatch):
    monkeypatch.delenv('HACDAO_ALLOW_CLOUD_WRITES', raising=False)
    runner = pytest.fail
    with pytest.raises(RuntimeError, match='HACDAO_ALLOW_CLOUD_WRITES'):
        fx.apply_batches(_sql_dir(tmp_path), tmp_path / 'st.json', 2500, budget=FakeBudget(99), runner=runner)
    rc = fx.main(['--out-sql', str(_sql_dir(tmp_path)), '--apply', '--state-file', str(tmp_path / 'st.json')])
    assert rc == 2 and not (tmp_path / 'st.json').exists()


def test_apply_respects_max_rows_and_resumes_next_day(tmp_path, monkeypatch):
    monkeypatch.setenv('HACDAO_ALLOW_CLOUD_WRITES', 'true')
    sql, state = _sql_dir(tmp_path), tmp_path / 'st.json'
    ran = []
    runner = lambda p: (ran.append(p.name), (True, '{}'))[1]  # noqa: E731
    # Mỗi file 2 UPDATE × 2 dòng = 4 dòng; trần 9 → chạy được 2 file.
    r1 = fx.apply_batches(sql, state, 9, budget=FakeBudget(100), runner=runner)
    assert r1['applied'] == ['update_0001.sql', 'update_0002.sql'] and r1['rows'] == 8
    assert 'max-rows-per-run' in r1['stopped'] and r1['remaining'] == ['update_0003.sql']
    r2 = fx.apply_batches(sql, state, 9, budget=FakeBudget(100), runner=runner)
    assert r2['applied'] == ['update_0003.sql'] and r2['remaining'] == [] and r2['stopped'] is None
    assert ran == ['update_0001.sql', 'update_0002.sql', 'update_0003.sql']
    assert set(json.loads(state.read_text(encoding='utf-8'))['update']) == set(ran)
    # Rollback có tiến độ riêng.
    r3 = fx.apply_batches(sql, state, 100, budget=FakeBudget(100), runner=runner, rollback=True)
    assert r3['applied'] == ['rollback_0001.sql', 'rollback_0002.sql', 'rollback_0003.sql']


def test_apply_stops_on_budget_and_on_wrangler_error(tmp_path, monkeypatch):
    monkeypatch.setenv('HACDAO_ALLOW_CLOUD_WRITES', 'true')
    sql, state = _sql_dir(tmp_path), tmp_path / 'st.json'
    budget = FakeBudget(5)
    r = fx.apply_batches(sql, state, 2500, budget=budget, runner=lambda p: (True, ''))
    assert r['applied'] == ['update_0001.sql'] and 'ngân sách' in r['stopped'] and budget.used == 4
    fail = fx.apply_batches(sql, state, 2500, budget=FakeBudget(100), runner=lambda p: (False, 'boom'))
    assert fail['applied'] == [] and 'boom' in fail['stopped']
    assert 'update_0002.sql' not in json.loads(state.read_text(encoding='utf-8'))['update']


def test_apply_reruns_file_whose_content_changed(tmp_path, monkeypatch):
    monkeypatch.setenv('HACDAO_ALLOW_CLOUD_WRITES', 'true')
    sql, state = _sql_dir(tmp_path, n_files=1), tmp_path / 'st.json'
    ok = lambda p: (True, '')  # noqa: E731
    assert fx.apply_batches(sql, state, 100, budget=FakeBudget(100), runner=ok)['applied'] == ['update_0001.sql']
    assert fx.apply_batches(sql, state, 100, budget=FakeBudget(100), runner=ok)['applied'] == []
    f = sql / 'update_0001.sql'
    f.write_text(f.read_text(encoding='utf-8') + '\n', encoding='utf-8')
    assert fx.apply_batches(sql, state, 100, budget=FakeBudget(100), runner=ok)['applied'] == ['update_0001.sql']


def test_apply_records_real_changes_and_warns_on_zero_row_batch(tmp_path, monkeypatch):
    """--apply ghi số dòng THỰC (meta.changes) vào state; lô 0 dòng / không đọc
    được output → cảnh báo rõ, không im lặng."""
    monkeypatch.setenv('HACDAO_ALLOW_CLOUD_WRITES', 'true')
    sql, state = _sql_dir(tmp_path), tmp_path / 'st.json'
    outputs = {
        'update_0001.sql': '[{"results": [], "success": true, "meta": {"changes": 2}}]',
        'update_0002.sql': '[{"results": [], "success": true, "meta": {"changes": 0}}]',
        'update_0003.sql': 'not json',
    }
    logs = []
    r = fx.apply_batches(sql, state, 100, budget=FakeBudget(100), runner=lambda p: (True, outputs[p.name]),
                         log=logs.append)
    assert r['applied'] == ['update_0001.sql', 'update_0002.sql', 'update_0003.sql']
    done = json.loads(state.read_text(encoding='utf-8'))['update']
    assert done['update_0001.sql']['changes'] == 2 and done['update_0001.sql']['warning'] is None
    assert done['update_0002.sql']['changes'] == 0 and '0/2' in done['update_0002.sql']['warning']
    assert done['update_0003.sql']['changes'] is None
    assert len(r['warnings']) == 2 and any('0/2' in w for w in r['warnings'])
    assert any('0/2' in line for line in logs)


def test_apply_uses_repo_budget_module_from_env(tmp_path, monkeypatch):
    """Không truyền budget → dùng tools.sync_budget.budget_from_env (HACDAO_D1_WRITE_BUDGET…)."""
    monkeypatch.setenv('HACDAO_ALLOW_CLOUD_WRITES', 'true')
    monkeypatch.setenv('HACDAO_REAL_USAGE_GUARD', '0')
    monkeypatch.setenv('HACDAO_BUDGET_FILE', str(tmp_path / 'budget.json'))
    monkeypatch.setenv('HACDAO_D1_WRITE_BUDGET', '6')
    monkeypatch.setenv('HACDAO_MAX_OPS_PER_RUN', '100')
    r = fx.apply_batches(_sql_dir(tmp_path), tmp_path / 'st.json', 2500, runner=lambda p: (True, ''))
    assert r['applied'] == ['update_0001.sql']
    assert json.loads((tmp_path / 'budget.json').read_text())['d1_ops'] == 4


# ── Dry-run đầu-cuối ──────────────────────────────────────────────────────────

def test_main_dry_run_writes_sql_and_reports(tmp_path, capsys):
    epubs = tmp_path / 'epubs'
    epubs.mkdir()
    make_epub(epubs / 'truyen-thu-nghiem-audiotruyenfull.org.epub', title="Truyện Thử Nghiệm Của Ta's",
              creators=['Ai Đó'], info_html=INFO_HTML)
    make_epub(epubs / 'lanh-chua-cau-sinh-thien-phu-hop-thanh.epub', title='Lãnh Chúa Cầu Sinh: Thiên Phú Hợp Thành')
    current = [{'results': [
        {'slug': 'truyen-thu-nghiem', 'title': 'truyen-thu-nghiem', 'author': '', 'genre': BAD, 'source_url': ''},
        {'slug': 'lanh-chua-cau-sinh-thien-phu-hop-thanh', 'title': 'lanh-chua-cau-sinh-thien-phu-hop-thanh',
         'author': '', 'genre': BAD, 'source_url': ''}]}]
    cur = tmp_path / 'current.json'
    cur.write_bytes(json.dumps(current, ensure_ascii=False).encode('utf-16'))   # PowerShell 5 ghi UTF-16
    out = tmp_path / 'out'
    rc = fx.main(['--epub-dir', str(epubs), '--current-json', str(cur), '--out-sql', str(out)])
    assert rc == 0
    text = (out / 'update_0001.sql').read_text(encoding='utf-8')
    assert "title = 'Truyện Thử Nghiệm Của Ta''s'" in text
    assert "genre = 'Huyền Huyễn, Toàn Dân'" in text
    # lanh-chua-cau-sinh… có trong novels/ của repo → được bảo vệ, không có câu UPDATE.
    assert 'lanh-chua-cau-sinh-thien-phu-hop-thanh' not in text
    assert 'DRY-RUN' in capsys.readouterr().out


def test_main_requires_current_state(tmp_path):
    (tmp_path / 'e').mkdir()
    assert fx.main(['--epub-dir', str(tmp_path / 'e')]) == 2


# ── download_epubs: chỉ lấy thể loại của truyện, bỏ menu ──────────────────────

GENRE_PAGE = '''<html><body>
<header><nav class="navbar"><a href="/the-loai/tien-hiep/">Tiên Hiệp</a><a href="/the-loai/huyen-huyen/">HH</a>
<a href="/the-loai/do-thi/">Đô Thị</a></nav></header>
<ul class="dropdown-menu"><li><a href="/the-loai/kiem-hiep/">KH</a></li></ul>
<div class="col"><div class="story-info"><img src="c.jpg"><br>Thể loại:
<a href="/the-loai/he-thong/">Hệ Thống</a>, <a href="https://vip.audiotruyenfull.org/the-loai/vong-du/">Võng Du</a>
</div><a href="/the-loai/lich-su/">gợi ý</a></div>
<footer><a href="/the-loai/ngon-tinh/">NT</a></footer></body></html>'''


def test_extract_story_genres_ignores_navigation_menu():
    assert download_epubs.extract_story_genres(GENRE_PAGE) == ['he-thong', 'vong-du']


def test_extract_story_genres_without_info_block_uses_non_menu_links():
    page = GENRE_PAGE.replace('class="story-info"', 'class="x"')
    assert download_epubs.extract_story_genres(page) == ['he-thong', 'vong-du', 'lich-su']


def test_drop_ubiquitous_genres():
    cache = {f's{i}': ['tien-hiep', 'do-thi'] + (['he-thong'] if i % 2 else []) for i in range(30)}
    cleaned = download_epubs.drop_ubiquitous_genres(cache)
    assert cleaned['s1'] == ['he-thong'] and cleaned['s0'] == []
    small = {'a': ['tien-hiep']}
    assert download_epubs.drop_ubiquitous_genres(small) == small


def test_fetch_genres_refetches_menu_dump_cache(monkeypatch):
    class Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return GENRE_PAGE.encode('utf-8')

    monkeypatch.setattr(download_epubs.urllib.request, 'urlopen', lambda *a, **k: Resp())
    cache = {'dump': [f'g{i}' for i in range(15)], 'ok': ['he-thong']}
    assert download_epubs.fetch_genres('ok', cache) == ['he-thong']
    assert download_epubs.fetch_genres('dump', cache) == ['he-thong', 'vong-du']
