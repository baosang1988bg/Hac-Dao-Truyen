"""Migration 014: migrate_to_cloudflare.py ghi novels.chapter_count sau khi ghi chương."""
import json
import sqlite3
from pathlib import Path

import migrate_to_cloudflare as migrate

ROOT = Path(__file__).resolve().parents[1]


def _schema_db():
    db = sqlite3.connect(':memory:')
    db.executescript((ROOT / 'schema.sql').read_text(encoding='utf-8'))
    return db


def test_chapter_stats_sql_counts_distinct_positive_numbers():
    db = _schema_db()
    db.execute("INSERT INTO novels (slug,title,updated_at) VALUES ('demo','Demo','2020-01-01 00:00:00')")
    db.execute("INSERT INTO novels (slug,title) VALUES ('other','Other')")
    rows = [('demo', 'c1.md', 1), ('demo', 'c1b.md', 1), ('demo', 'c2.md', 2), ('demo', 'note.md', 0),
            ('other', 'x.md', 5)]
    db.executemany("INSERT INTO chapters (novel_slug,filename,title,chapter_number,r2_key) VALUES (?,?,?,?,'k')",
                   [(s, f, f, n) for s, f, n in rows])
    db.execute(migrate.build_chapter_stats_sql('demo'))
    count, updated = db.execute("SELECT chapter_count, updated_at FROM novels WHERE slug='demo'").fetchone()
    assert count == 2  # trùng số 1 + chương 0 (author note) không tính
    assert updated != '2020-01-01 00:00:00'
    assert db.execute("SELECT chapter_count FROM novels WHERE slug='other'").fetchone()[0] == 0  # không đụng truyện khác


def test_migration_014_backfills_existing_database():
    db = sqlite3.connect(':memory:')
    # Schema TRƯỚC migration 014 (bỏ cột + index mới khỏi schema.sql).
    old = (ROOT / 'schema.sql').read_text(encoding='utf-8')
    old = old.replace(',\n  -- Migration 014', '\n  -- Migration 014').replace('  chapter_count     INTEGER DEFAULT 0\n', '')
    old = '\n'.join(l for l in old.splitlines() if 'idx_novels_published_chapters' not in l)
    db.executescript(old)
    assert 'chapter_count' not in [r[1] for r in db.execute('PRAGMA table_info(novels)')]
    db.execute("INSERT INTO novels (slug,title) VALUES ('demo','Demo'), ('epub-only','E')")
    db.executemany("INSERT INTO chapters (novel_slug,filename,title,chapter_number,r2_key) VALUES ('demo',?,?,?,'k')",
                   [('a.md', 'a', 1), ('b.md', 'b', 2), ('c.md', 'c', 3)])
    db.executescript((ROOT / 'migrations' / '014_novels_chapter_count.sql').read_text(encoding='utf-8'))
    assert dict(db.execute('SELECT slug, chapter_count FROM novels')) == {'demo': 3, 'epub-only': 0}
    plan = ' '.join(r[3] for r in db.execute(
        'EXPLAIN QUERY PLAN SELECT slug FROM novels n WHERE n.published = 1 ORDER BY n.chapter_count DESC LIMIT 10'))
    assert 'idx_novels_published_chapters' in plan and 'TEMP B-TREE' not in plan


def test_migrate_novel_refreshes_chapter_count_and_falls_back_without_column(tmp_path, monkeypatch):
    monkeypatch.setenv('HACDAO_ALLOW_CLOUD_WRITES', 'true')
    root = tmp_path / 'demo'
    (root / 'translated').mkdir(parents=True)
    (root / 'novel.json').write_text(json.dumps({'title': 'Demo'}))
    (root / 'translated' / 'Chương 1.md').write_text('# Chương 1\n\nBody')
    monkeypatch.setattr(migrate, 'NOVELS_DIR', tmp_path)
    monkeypatch.setattr(migrate, 'r2_get_glossary', lambda slug: {})
    monkeypatch.setattr(migrate, 'get_r2_keys_for_filenames', lambda slug, filenames: {})
    monkeypatch.setattr(migrate, 'r2_put', lambda *args: True)
    monkeypatch.setattr(migrate, 'get_synced_filenames', lambda slug: {'Chương 1.md'})
    monkeypatch.setattr(migrate, 'update_novel_sync', lambda *args: None)

    sql = []
    # Production chưa có cột: lệnh có chapter_count lỗi, lệnh chỉ updated_at thành công.
    def fake_d1(text, *args):
        sql.append(text)
        return 'chapter_count' not in text
    monkeypatch.setattr(migrate, 'd1_file', fake_d1)
    assert migrate.migrate_novel('demo') is True
    chapters_at = max(i for i, t in enumerate(sql) if 'INSERT INTO chapters' in t)
    tail = sql[chapters_at + 1:]
    assert len(tail) == 2 and 'chapter_count' in tail[0] and 'chapter_count' not in tail[1]
    assert all(t.startswith('UPDATE novels SET updated_at=') for t in tail)
