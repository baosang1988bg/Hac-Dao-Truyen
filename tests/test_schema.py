import sqlite3
from tools.migrate_schema import ROOT, plan
import pytest


def db():
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    return conn


def apply(conn):
    conn.executescript('\n'.join(plan(lambda sql: [dict(r) for r in conn.execute(sql)])))


@pytest.mark.parametrize('stage', ['empty', 'base', 'epub', 'manual', 'current'])
def test_bootstrap_upgrade_and_repeat(stage):
    conn = db()
    schema = (ROOT / 'schema.sql').read_text()
    if stage != 'empty':
        # Reconstruct the pre-fix core snapshot without extension fields.
        old = schema.split('-- Current bootstrap snapshot.')[0]
        old = '\n'.join(line for line in old.splitlines() if not any(
            line.strip().startswith(name+' ') for name in ['views','rating_sum','rating_count','has_epub','drive_file_id']))
        conn.executescript(schema if stage == 'current' else old)
        conn.execute("INSERT INTO novels(slug,title) VALUES ('demo','Keep me')")
        if stage in ('epub', 'manual'):
            conn.executescript((ROOT / 'migrations/add_epub_catalog_fields.sql').read_text())
        if stage == 'manual':
            conn.execute("ALTER TABLE novels ADD COLUMN drive_file_id TEXT DEFAULT ''")
    apply(conn)
    apply(conn)
    conn.execute('SELECT drive_file_id, views, rating_sum, rating_count, has_epub, glossary_count FROM novels')
    conn.execute('SELECT * FROM novel_requests')
    assert conn.execute('SELECT COUNT(*) FROM schema_migrations').fetchone()[0] == 1
    if stage != 'empty':
        assert conn.execute('SELECT title FROM novels').fetchone()[0] == 'Keep me'
    conn.close()


def test_partial_upgrade_resumes_and_incompatible_schema_is_rejected():
    conn = db()
    statements = plan(lambda sql: [dict(r) for r in conn.execute(sql)])
    conn.executescript('\n'.join(statements[:2]))
    apply(conn)
    conn.close()
    conn = db()
    conn.execute('CREATE TABLE novels (slug INTEGER PRIMARY KEY, title TEXT NOT NULL)')
    with pytest.raises(ValueError, match='Incompatible'):
        apply(conn)
    conn.close()
