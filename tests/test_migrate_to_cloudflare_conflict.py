"""E03/E05 — migrate_to_cloudflare.py: expected-key conflict guard cho ghi
chương (giống expected_r2_key của Worker src/index.js:syncNovelBatch) và
three-way merge + tombstone cho glossary.

- Phần guard SQL dùng SQLite `:memory:` THẬT (không mock) để xác nhận WHERE
  clause hoạt động đúng ngữ nghĩa UPSERT, không chỉ đúng cú pháp.
- Phần tích hợp migrate_novel() dùng thư mục tmp_path + monkeypatch mọi hàm
  gọi wrangler/D1/R2 — KHÔNG gọi mạng/D1/R2 thật, KHÔNG ghi vào novels/ thật.
"""
import hashlib
import json
import sqlite3

import pytest

import migrate_to_cloudflare as migrate


# ── E03a: build_chapter_upsert_sql — guard đúng ngữ nghĩa trên SQLite thật ──

CHAPTERS_SCHEMA = """
CREATE TABLE chapters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_slug     TEXT NOT NULL,
  filename       TEXT NOT NULL,
  title          TEXT NOT NULL,
  chapter_number INTEGER DEFAULT 0,
  r2_key         TEXT NOT NULL,
  created_at     TEXT DEFAULT (datetime('now')),
  UNIQUE(novel_slug, filename)
);
"""


def _db():
    conn = sqlite3.connect(':memory:')
    conn.executescript(CHAPTERS_SCHEMA)
    return conn


def test_fresh_insert_ignores_where_guard_and_succeeds():
    conn = _db()
    conn.executescript(migrate.build_chapter_upsert_sql(
        'demo', 'c1.md', 'Chương 1', 1, 'demo/content/aaa.md', None))
    row = conn.execute("SELECT r2_key FROM chapters WHERE filename='c1.md'").fetchone()
    assert row[0] == 'demo/content/aaa.md'


def test_idempotent_rewrite_same_content_succeeds():
    conn = _db()
    conn.executescript(migrate.build_chapter_upsert_sql(
        'demo', 'c1.md', 'Chương 1', 1, 'demo/content/aaa.md', None))
    # Chạy lại migrate lần 2: old_key đọc được == key mới (nội dung không đổi)
    # → WHERE khớp vế "r2_key = excluded.r2_key" dù old_key truyền vào có thể
    # đã cũ/không chính xác.
    conn.executescript(migrate.build_chapter_upsert_sql(
        'demo', 'c1.md', 'Chương 1 (sửa tiêu đề)', 1, 'demo/content/aaa.md', 'demo/content/aaa.md'))
    row = conn.execute("SELECT title, r2_key FROM chapters WHERE filename='c1.md'").fetchone()
    assert row == ('Chương 1 (sửa tiêu đề)', 'demo/content/aaa.md')


def test_legitimate_content_change_with_correct_old_key_succeeds():
    conn = _db()
    conn.executescript(migrate.build_chapter_upsert_sql(
        'demo', 'c1.md', 'Chương 1', 1, 'demo/content/aaa.md', None))
    # Re-dịch lại chương: old_key ta đọc được TRƯỚC khi ghi khớp đúng DB hiện tại.
    conn.executescript(migrate.build_chapter_upsert_sql(
        'demo', 'c1.md', 'Chương 1 v2', 1, 'demo/content/bbb.md', 'demo/content/aaa.md'))
    row = conn.execute("SELECT r2_key FROM chapters WHERE filename='c1.md'").fetchone()
    assert row[0] == 'demo/content/bbb.md'


def test_concurrent_external_write_blocks_silent_overwrite():
    conn = _db()
    conn.executescript(migrate.build_chapter_upsert_sql(
        'demo', 'c1.md', 'Chương 1', 1, 'demo/content/aaa.md', None))
    # Một writer khác (Worker HTTP sync / admin) ghi đè r2_key khác trong lúc
    # CLI đang xử lý — CLI vẫn cầm old_key CŨ (stale) đọc được trước đó.
    conn.execute("UPDATE chapters SET r2_key='demo/content/foreign.md' WHERE filename='c1.md'")
    conn.executescript(migrate.build_chapter_upsert_sql(
        'demo', 'c1.md', 'Chương 1 (CLI, stale)', 1, 'demo/content/ccc.md', 'demo/content/aaa.md'))
    # WHERE guard phải chặn UPDATE — giá trị "foreign" (ghi bởi writer khác)
    # KHÔNG được mất.
    row = conn.execute("SELECT r2_key FROM chapters WHERE filename='c1.md'").fetchone()
    assert row[0] == 'demo/content/foreign.md'


# ── E03b: get_r2_keys_for_filenames — parse JSON / lỗi mạng ────────────────

def test_get_r2_keys_for_filenames_parses_wrangler_json(monkeypatch):
    class R:
        returncode = 0
        stdout = '[{"results":[{"filename":"c1.md","r2_key":"demo/content/aaa.md"}]}]'
        stderr = ''
    monkeypatch.setattr(migrate, 'run_safe', lambda args: R())
    assert migrate.get_r2_keys_for_filenames('demo', ['c1.md']) == {'c1.md': 'demo/content/aaa.md'}


def test_get_r2_keys_for_filenames_returns_none_on_error_not_empty_dict(monkeypatch):
    class R:
        returncode = 1
        stdout = ''
        stderr = 'network reset'
    monkeypatch.setattr(migrate, 'run_safe', lambda args: R())
    # None (không xác định) phải khác {} (chắc chắn không có gì) — caller
    # migrate_novel() dựa vào phân biệt này để không ghi đè mù.
    assert migrate.get_r2_keys_for_filenames('demo', ['c1.md']) is None


def test_get_r2_keys_for_filenames_empty_filenames_short_circuits_without_query(monkeypatch):
    def boom(args):
        pytest.fail('Không được gọi wrangler khi danh sách filenames rỗng')
    monkeypatch.setattr(migrate, 'run_safe', boom)
    assert migrate.get_r2_keys_for_filenames('demo', []) == {}


# ── E03c: tích hợp migrate_novel() — conflict thật bị phát hiện & báo cáo ──

def _make_novel(tmp_path, content='Noi dung'):
    novels = tmp_path / 'source'
    root = novels / 'demo'
    (root / 'translated').mkdir(parents=True)
    (root / 'novel.json').write_text(json.dumps({'title': 'Demo'}), encoding='utf-8')
    (root / 'translated' / 'Chương 1.md').write_text(f'# Chương 1\n\n{content}', encoding='utf-8')
    return novels, root


def _content_key(slug, path):
    return f"{slug}/content/{hashlib.sha256(path.read_bytes()).hexdigest()}.md"


def test_migrate_novel_flags_concurrent_write_as_conflict_not_success(tmp_path, monkeypatch):
    monkeypatch.setenv('HACDAO_ALLOW_CLOUD_WRITES', 'true')
    novels, root = _make_novel(tmp_path)
    monkeypatch.setattr(migrate, 'NOVELS_DIR', novels)
    monkeypatch.setattr(migrate, 'r2_get_glossary', lambda slug: {})
    monkeypatch.setattr(migrate, 'r2_put', lambda *a, **k: True)
    monkeypatch.setattr(migrate, 'd1_file', lambda *a, **k: True)
    monkeypatch.setattr(migrate, 'update_novel_sync', lambda *a: None)

    calls = {'n': 0}

    def fake_keys(slug, filenames):
        calls['n'] += 1
        if calls['n'] == 1:
            # Pre-check: đã có 1 row cũ với r2_key khác nội dung hiện tại
            # (nội dung đã đổi thật, ví dụ re-dịch lại).
            return {fn: 'demo/content/OLD_STALE.md' for fn in filenames}
        # Post-verify: một writer khác đã ghi đè GIỮA lúc pre-check và lúc CLI
        # commit — mô phỏng race thật.
        return {fn: 'demo/content/FOREIGN_WRITER.md' for fn in filenames}

    monkeypatch.setattr(migrate, 'get_r2_keys_for_filenames', fake_keys)

    result = migrate.migrate_novel('demo')
    assert result is False, "Phải báo lỗi/conflict, KHÔNG được tính là thành công"
    assert calls['n'] == 2, "Phải verify lại sau khi commit cho chương at-risk"


def test_migrate_novel_succeeds_when_content_changes_without_interference(tmp_path, monkeypatch):
    monkeypatch.setenv('HACDAO_ALLOW_CLOUD_WRITES', 'true')
    novels, root = _make_novel(tmp_path)
    chapter_path = root / 'translated' / 'Chương 1.md'
    expected_new_key = _content_key('demo', chapter_path)

    monkeypatch.setattr(migrate, 'NOVELS_DIR', novels)
    monkeypatch.setattr(migrate, 'r2_get_glossary', lambda slug: {})
    monkeypatch.setattr(migrate, 'r2_put', lambda *a, **k: True)
    monkeypatch.setattr(migrate, 'd1_file', lambda *a, **k: True)
    states = []
    monkeypatch.setattr(migrate, 'update_novel_sync', lambda *a: states.append(a))
    monkeypatch.setattr(migrate, 'get_synced_filenames', lambda slug: {'Chương 1.md'})

    calls = {'n': 0}

    def fake_keys(slug, filenames):
        calls['n'] += 1
        if calls['n'] == 1:
            return {fn: 'demo/content/OLD_STALE.md' for fn in filenames}
        # Không ai ghi đè song song — commit đúng như CLI mong đợi.
        return {fn: expected_new_key for fn in filenames}

    monkeypatch.setattr(migrate, 'get_r2_keys_for_filenames', fake_keys)

    result = migrate.migrate_novel('demo')
    assert result is True
    assert len(states) == 1


def test_migrate_novel_fresh_slug_skips_post_verify(tmp_path, monkeypatch):
    """Chưa từng có row nào (slug/truyện mới) — không có gì 'at risk', không
    cần verify lại sau commit (chỉ 1 lần gọi get_r2_keys_for_filenames)."""
    monkeypatch.setenv('HACDAO_ALLOW_CLOUD_WRITES', 'true')
    novels, root = _make_novel(tmp_path)
    monkeypatch.setattr(migrate, 'NOVELS_DIR', novels)
    monkeypatch.setattr(migrate, 'r2_get_glossary', lambda slug: {})
    monkeypatch.setattr(migrate, 'r2_put', lambda *a, **k: True)
    monkeypatch.setattr(migrate, 'd1_file', lambda *a, **k: True)
    monkeypatch.setattr(migrate, 'update_novel_sync', lambda *a: None)
    monkeypatch.setattr(migrate, 'get_synced_filenames', lambda slug: {'Chương 1.md'})

    calls = {'n': 0}

    def fake_keys(slug, filenames):
        calls['n'] += 1
        return {}

    monkeypatch.setattr(migrate, 'get_r2_keys_for_filenames', fake_keys)
    result = migrate.migrate_novel('demo')
    assert result is True
    assert calls['n'] == 1


def test_migrate_novel_falls_back_when_conflict_check_query_fails(tmp_path, monkeypatch):
    """Query lỗi (None) — không có gì để guard; migrate vẫn tiếp tục ghi
    (fallback tài liệu hóa) thay vì treo toàn bộ vì 1 lỗi mạng thoáng qua,
    nhưng phải KHÔNG crash và vẫn thành công khi D1 thật ghi được."""
    monkeypatch.setenv('HACDAO_ALLOW_CLOUD_WRITES', 'true')
    novels, root = _make_novel(tmp_path)
    monkeypatch.setattr(migrate, 'NOVELS_DIR', novels)
    monkeypatch.setattr(migrate, 'r2_get_glossary', lambda slug: {})
    monkeypatch.setattr(migrate, 'r2_put', lambda *a, **k: True)
    monkeypatch.setattr(migrate, 'd1_file', lambda *a, **k: True)
    monkeypatch.setattr(migrate, 'update_novel_sync', lambda *a: None)
    monkeypatch.setattr(migrate, 'get_synced_filenames', lambda slug: {'Chương 1.md'})
    monkeypatch.setattr(migrate, 'get_r2_keys_for_filenames', lambda slug, filenames: None)

    result = migrate.migrate_novel('demo')
    assert result is True


# ── E05: r2_get_glossary phân biệt lỗi thật với "chưa từng tồn tại" ────────

def test_r2_get_glossary_raises_on_real_network_error(monkeypatch):
    class R:
        returncode = 1
        stdout = ''
        stderr = 'connection reset by peer'
    monkeypatch.setattr(migrate, 'run_safe', lambda args: R())
    with pytest.raises(migrate.GlossaryFetchError):
        migrate.r2_get_glossary('demo')


def test_r2_get_glossary_returns_empty_dict_when_object_truly_missing(monkeypatch):
    class R:
        returncode = 1
        stdout = ''
        stderr = 'The specified key does not exist.'
    monkeypatch.setattr(migrate, 'run_safe', lambda args: R())
    assert migrate.r2_get_glossary('demo') == {}


def test_r2_get_glossary_raises_on_corrupt_json(monkeypatch):
    class R:
        returncode = 0
        stdout = ''
        stderr = ''

    def fake_run_safe(args):
        # args = [wrangler(list), 'r2', 'object', 'get', key, '--file=<tmp>', '--remote']
        file_arg = next(a for a in args if isinstance(a, str) and a.startswith('--file='))
        tmp_path = file_arg.split('=', 1)[1]
        with open(tmp_path, 'w', encoding='utf-8') as f:
            f.write('not valid json {{{')
        return R()

    monkeypatch.setattr(migrate, 'run_safe', fake_run_safe)
    with pytest.raises(migrate.GlossaryFetchError):
        migrate.r2_get_glossary('demo')


# ── E05: three-way merge + tombstone ────────────────────────────────────────

def test_merge_keeps_deletion_without_resurrecting_term():
    base = {'A': '1', 'B': '2'}
    local = {'A': '1', 'B': '2'}   # local không đổi gì
    remote = {'A': '1'}            # remote đã XÓA 'B'
    merged, conflicts = migrate.merge_glossary_three_way(base, local, remote)
    assert merged == {'A': '1'}
    assert conflicts == []


def test_merge_keeps_local_deletion_when_remote_unchanged():
    base = {'A': '1', 'B': '2'}
    local = {'A': '1'}             # local đã xóa 'B'
    remote = {'A': '1', 'B': '2'}  # remote không đổi
    merged, conflicts = migrate.merge_glossary_three_way(base, local, remote)
    assert merged == {'A': '1'}
    assert conflicts == []


def test_merge_detects_real_conflict_without_picking_a_winner():
    base = {'A': '1'}
    local = {'A': 'local-edit'}
    remote = {'A': 'remote-edit'}
    merged, conflicts = migrate.merge_glossary_three_way(base, local, remote)
    assert len(conflicts) == 1
    c = conflicts[0]
    assert c['term'] == 'A' and c['base'] == '1'
    assert c['local'] == 'local-edit' and c['remote'] == 'remote-edit'
    # Không tự động chọn remote thắng vô điều kiện.
    assert merged['A'] == 'local-edit'


def test_merge_first_sync_no_snapshot_keeps_both_sides_additions():
    merged, conflicts = migrate.merge_glossary_three_way({}, {'X': 'local-new'}, {'Y': 'remote-new'})
    assert merged == {'X': 'local-new', 'Y': 'remote-new'}
    assert conflicts == []


def test_merge_first_sync_same_term_added_differently_is_conflict():
    # Cả 2 bên cùng thêm 1 term (chưa từng có base) nhưng giá trị khác nhau —
    # vẫn phải là conflict thật, không phải "remote thắng" hay "local thắng"
    # mặc định.
    merged, conflicts = migrate.merge_glossary_three_way({}, {'A': 'local'}, {'A': 'remote'})
    assert len(conflicts) == 1
    assert conflicts[0]['term'] == 'A'


def test_migrate_novel_skips_glossary_sync_on_fetch_error_without_overwriting(tmp_path, monkeypatch):
    monkeypatch.setenv('HACDAO_ALLOW_CLOUD_WRITES', 'true')
    novels, root = _make_novel(tmp_path)
    (root / 'novel.json').write_text(json.dumps({'title': 'Demo', 'glossary': {'A': '1'}}), encoding='utf-8')

    monkeypatch.setattr(migrate, 'NOVELS_DIR', novels)

    def boom(slug):
        raise migrate.GlossaryFetchError('network reset')

    monkeypatch.setattr(migrate, 'r2_get_glossary', boom)
    monkeypatch.setattr(migrate, 'get_r2_keys_for_filenames', lambda slug, filenames: {})
    monkeypatch.setattr(migrate, 'd1_file', lambda *a, **k: True)
    r2_calls = []
    monkeypatch.setattr(migrate, 'r2_put', lambda local, key, dry_run=False: (r2_calls.append(key), True)[1])
    monkeypatch.setattr(migrate, 'update_novel_sync', lambda *a: None)
    monkeypatch.setattr(migrate, 'get_synced_filenames', lambda slug: {'Chương 1.md'})

    result = migrate.migrate_novel('demo')
    assert result is True, "Chương vẫn phải sync bình thường dù glossary lỗi tải"
    assert not any(k.endswith('glossary.json') for k in r2_calls), \
        "KHÔNG được ghi đè glossary.json trên R2 khi tải remote lỗi"
    saved = json.loads((root / 'novel.json').read_text(encoding='utf-8'))
    assert saved.get('glossary') == {'A': '1'}, "novel.json local không bị sửa khi tải glossary lỗi"


def test_migrate_novel_persists_glossary_snapshot_for_next_run(tmp_path, monkeypatch):
    monkeypatch.setenv('HACDAO_ALLOW_CLOUD_WRITES', 'true')
    novels, root = _make_novel(tmp_path)
    (root / 'novel.json').write_text(json.dumps({'title': 'Demo', 'glossary': {'A': '1'}}), encoding='utf-8')
    sync_state = tmp_path / '.sync_state.json'
    monkeypatch.setattr(migrate, 'SYNC_STATE', sync_state)

    monkeypatch.setattr(migrate, 'NOVELS_DIR', novels)
    monkeypatch.setattr(migrate, 'r2_get_glossary', lambda slug: {'A': '1', 'B': '2'})
    monkeypatch.setattr(migrate, 'get_r2_keys_for_filenames', lambda slug, filenames: {})
    monkeypatch.setattr(migrate, 'd1_file', lambda *a, **k: True)
    monkeypatch.setattr(migrate, 'r2_put', lambda *a, **k: True)
    monkeypatch.setattr(migrate, 'update_novel_sync', lambda *a: None)
    monkeypatch.setattr(migrate, 'get_synced_filenames', lambda slug: {'Chương 1.md'})

    migrate.migrate_novel('demo')
    assert migrate.get_glossary_snapshot('demo') == {'A': '1', 'B': '2'}
    saved = json.loads((root / 'novel.json').read_text(encoding='utf-8'))
    assert saved.get('glossary') == {'A': '1', 'B': '2'}
