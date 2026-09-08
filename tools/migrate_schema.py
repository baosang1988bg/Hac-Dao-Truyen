"""Additive schema reconciliation. Default is read-only plan; --apply writes.

Uses schema.sql as the desired snapshot. Existing columns must match their
SQLite type, PK and default; unknown user columns are preserved. No DROP or
rewrite of data is generated. History is recorded last, so partial D1 execution
can be resumed by inspecting the actual schema again.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def normalize_default(value):
    return None if value is None else str(value).strip('()').lower()


def plan(query, schema=None):
    schema = schema if schema is not None else (ROOT / 'schema.sql').read_text()
    desired = sqlite3.connect(':memory:')
    desired.row_factory = sqlite3.Row
    desired.executescript(schema)
    statements = []
    try:
        for table in desired.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
            name = table['name']
            expected = list(desired.execute(f'PRAGMA table_info({quote(name)})'))
            actual = {c['name']: c for c in query(f'PRAGMA table_info({quote(name)})')}
            if not actual:
                statements.append(table['sql'] + ';')
                continue
            for col in expected:
                old = actual.get(col['name'])
                if old is not None:
                    # Reject incompatible manual changes instead of claiming migration success.
                    if (old['type'].upper() != col['type'].upper() or old['pk'] != col['pk']
                            or old['notnull'] != col['notnull']
                            or normalize_default(old['dflt_value']) != normalize_default(col['dflt_value'])):
                        raise ValueError(f'Incompatible column {name}.{col["name"]}; inspect manually')
                    continue
                if col['pk'] or col['notnull']:
                    raise ValueError(f'Cannot safely add required column {name}.{col["name"]}')
                default = '' if col['dflt_value'] is None else ' DEFAULT ' + col['dflt_value']
                statements.append(f'ALTER TABLE {quote(name)} ADD COLUMN {quote(col["name"])} {col["type"]}{default};')
        indexes = {r['name']: r['sql'] for r in query("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")}
        for row in desired.execute("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"):
            if row['name'] not in indexes:
                statements.append(row['sql'] + ';')
        digest = hashlib.sha256(schema.encode()).hexdigest()
        statements.append('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime(\'now\')));')
        statements.append(f"INSERT OR IGNORE INTO schema_migrations(version) VALUES ('snapshot-{digest}');")
        return statements
    finally:
        desired.close()


def wrangler(database, remote, sql, config):
    with tempfile.NamedTemporaryFile('w', suffix='.sql', encoding='utf-8', delete=False) as f:
        f.write(sql)
        path = Path(f.name)
    try:
        command = [str(ROOT / 'node_modules' / '.bin' / ('wrangler.cmd' if __import__('os').name == 'nt' else 'wrangler')),
                   'd1', 'execute', database, '--remote' if remote else '--local',
                   '--config', str(config), '--file', str(path), '--json']
        result = subprocess.run(command, check=True, capture_output=True, text=True)
        blocks = json.loads(result.stdout)
        if any(b.get('success') is False for b in blocks):
            raise RuntimeError('D1 execution failed')
        return [row for block in blocks for row in block.get('results', [])]
    finally:
        path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument('--sqlite', type=Path, help='Local disposable SQLite database')
    target.add_argument('--database', help='D1 name from the chosen config')
    parser.add_argument('--remote', action='store_true')
    parser.add_argument('--config', type=Path, default=ROOT / 'wrangler.jsonc')
    parser.add_argument('--apply', action='store_true', help='Apply the printed plan; default is read-only')
    args = parser.parse_args()
    if args.sqlite:
        if args.remote:
            parser.error('--remote requires --database')
        if not args.apply and not args.sqlite.exists():
            conn = sqlite3.connect(':memory:')
        else:
            conn = sqlite3.connect(args.sqlite if args.apply else f'file:{args.sqlite}?mode=ro', uri=not args.apply)
        conn.row_factory = sqlite3.Row
        query = lambda sql: [dict(r) for r in conn.execute(sql)]
    else:
        conn = None
        query = lambda sql: wrangler(args.database, args.remote, sql, args.config)
    try:
        statements = plan(query)
        sql = '\n'.join(statements)
        print(sql)
        if args.apply:
            if conn:
                conn.executescript('BEGIN IMMEDIATE;\n' + sql + '\nCOMMIT;')
            else:
                wrangler(args.database, args.remote, sql, args.config)
    finally:
        if conn:
            conn.close()


if __name__ == '__main__':
    main()
