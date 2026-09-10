"""Schema reconciliation. Default is read-only plan; --apply writes.

Uses schema.sql as the desired snapshot. Existing columns must match their
SQLite type, PK and default; unknown user columns are preserved. Adding a
column is always additive (ALTER TABLE ADD COLUMN).

Adding a constraint that SQLite cannot bolt onto an existing table in place
(a new NOT NULL on an existing column, a FOREIGN KEY, a table-level CHECK, or
a table-level UNIQUE) requires rebuilding that one table: rename it aside,
create the new definition, copy every row and column across (desired columns
plus any unknown ones the old table had), then fix up AUTOINCREMENT
bookkeeping. Before doing that, the existing data is *audited* against the
new constraint (orphan FK rows, NULLs, duplicates, CHECK violations); if any
row would violate it, the whole plan aborts with a specific error instead of
silently dropping or truncating data. The renamed-aside copy of the table is
left in the database (suffixed `__pre_migration`) as a manual rollback path —
`DROP TABLE <name>; ALTER TABLE <name>__pre_migration RENAME TO <name>;`
undoes the rebuild. Nothing is ever DROPed automatically to make a snapshot
"fit".

History is recorded last, so partial D1 execution can be resumed by
inspecting the actual schema again.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
import sqlite3
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def normalize_default(value):
    return None if value is None else str(value).strip('()').lower()


def normalize_sql(sql):
    return ' '.join(sql.replace('\n', ' ').split()).rstrip(';')


def get_foreign_keys(query, table):
    """{from_cols: (to_table, from_cols, to_cols, on_update, on_delete)}"""
    groups = {}
    for row in query(f'PRAGMA foreign_key_list({quote(table)})'):
        groups.setdefault(row['id'], []).append(row)
    result = {}
    for rows in groups.values():
        rows.sort(key=lambda r: r['seq'])
        from_cols = tuple(r['from'] for r in rows)
        to_cols = tuple(r['to'] for r in rows)
        fk = (rows[0]['table'], from_cols, to_cols,
              (rows[0]['on_update'] or 'NO ACTION').upper(),
              (rows[0]['on_delete'] or 'NO ACTION').upper())
        result[from_cols] = fk
    return result


def get_unique_constraints(query, table):
    """Table-level/column UNIQUE constraints (origin 'u'), not named CREATE INDEX ones."""
    result = set()
    for idx in query(f'PRAGMA index_list({quote(table)})'):
        if idx['origin'] == 'u':
            cols = tuple(r['name'] for r in query(f'PRAGMA index_info({quote(idx["name"])})'))
            result.add(cols)
    return result


def extract_checks(create_sql):
    """Paren-balanced extraction of CHECK(...) expressions from a CREATE TABLE statement."""
    checks = set()
    upper = create_sql.upper()
    i = 0
    while True:
        idx = upper.find('CHECK', i)
        if idx == -1:
            break
        j = idx + 5
        while j < len(create_sql) and create_sql[j] in ' \t\n':
            j += 1
        if j >= len(create_sql) or create_sql[j] != '(':
            i = idx + 5
            continue
        depth = 0
        start = j
        while j < len(create_sql):
            if create_sql[j] == '(':
                depth += 1
            elif create_sql[j] == ')':
                depth -= 1
                if depth == 0:
                    break
            j += 1
        expr = create_sql[start + 1:j]
        checks.add(' '.join(expr.split()))
        i = j + 1
    return checks


def audit_notnull(query, table, col):
    rows = query(f'SELECT COUNT(*) AS n FROM {quote(table)} WHERE {quote(col)} IS NULL')
    return rows[0]['n'] if rows else 0


def audit_fk(query, table, from_cols, to_table, to_cols):
    all_not_null = ' AND '.join(f't.{quote(c)} IS NOT NULL' for c in from_cols)
    join_cond = ' AND '.join(f'p.{quote(tc)} = t.{quote(fc)}' for fc, tc in zip(from_cols, to_cols))
    sql = (f'SELECT COUNT(*) AS n FROM {quote(table)} t WHERE ({all_not_null}) '
           f'AND NOT EXISTS (SELECT 1 FROM {quote(to_table)} p WHERE {join_cond})')
    rows = query(sql)
    return rows[0]['n'] if rows else 0


def audit_unique(query, table, cols):
    col_list = ', '.join(quote(c) for c in cols)
    sql = f'SELECT COUNT(*) AS n FROM (SELECT {col_list} FROM {quote(table)} GROUP BY {col_list} HAVING COUNT(*) > 1)'
    rows = query(sql)
    return rows[0]['n'] if rows else 0


def audit_check(query, table, expr):
    # A CHECK is satisfied when the expression is true or NULL; only a
    # definite false (represented by SQLite as the integer 0) violates it.
    sql = f'SELECT COUNT(*) AS n FROM {quote(table)} WHERE ({expr}) IS 0'
    rows = query(sql)
    return rows[0]['n'] if rows else 0


def rebuild_table_statements(name, create_sql, actual_cols, desired_cols):
    """Rename-aside + recreate + copy. Returns (statements, backup_table_name)."""
    old_name = f'{name}__pre_migration'
    statements = [f'ALTER TABLE {quote(name)} RENAME TO {quote(old_name)};',
                  create_sql.strip().rstrip(';') + ';']
    extra_cols = [c for cname, c in actual_cols.items() if cname not in desired_cols]
    for c in extra_cols:
        default = '' if c['dflt_value'] is None else ' DEFAULT (' + c['dflt_value'] + ')'
        statements.append(f'ALTER TABLE {quote(name)} ADD COLUMN {quote(c["name"])} {c["type"]}{default};')
    all_cols = list(desired_cols.keys()) + [c['name'] for c in extra_cols]
    col_list = ', '.join(quote(c) for c in all_cols)
    statements.append(f'INSERT INTO {quote(name)} ({col_list}) SELECT {col_list} FROM {quote(old_name)};')
    if any(c['pk'] for c in desired_cols.values()) and 'AUTOINCREMENT' in create_sql.upper():
        statements.append(
            f"INSERT INTO sqlite_sequence(name, seq) "
            f"SELECT '{name}', COALESCE((SELECT MAX(rowid) FROM {quote(name)}), 0) "
            f"WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '{name}');"
        )
        statements.append(
            f"UPDATE sqlite_sequence SET seq = COALESCE((SELECT MAX(rowid) FROM {quote(name)}), 0) "
            f"WHERE name = '{name}';"
        )
    return statements, old_name


def plan(query, schema=None):
    schema = schema if schema is not None else (ROOT / 'schema.sql').read_text()
    desired = sqlite3.connect(':memory:')
    desired.execute('PRAGMA foreign_keys = ON')
    desired.row_factory = sqlite3.Row
    desired.executescript(schema)
    desired_query = lambda sql: [dict(r) for r in desired.execute(sql)]
    statements = []
    rebuilt_tables = set()
    try:
        for table in desired.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
            name = table['name']
            expected = list(desired.execute(f'PRAGMA table_info({quote(name)})'))
            desired_cols = {c['name']: c for c in expected}
            actual = {c['name']: c for c in query(f'PRAGMA table_info({quote(name)})')}
            if not actual:
                statements.append(table['sql'] + ';')
                continue

            column_statements = []
            notnull_upgrades = []
            for col in expected:
                old = actual.get(col['name'])
                if old is not None:
                    # Reject incompatible manual changes instead of claiming migration success.
                    if (old['type'].upper() != col['type'].upper() or old['pk'] != col['pk']
                            or normalize_default(old['dflt_value']) != normalize_default(col['dflt_value'])):
                        raise ValueError(f'Incompatible column {name}.{col["name"]}; inspect manually')
                    if old['notnull'] != col['notnull']:
                        if col['notnull'] and not old['notnull']:
                            notnull_upgrades.append(col['name'])
                        # actual already stricter (NOT NULL) than desired: leave as-is, not an error.
                    continue
                if col['pk']:
                    raise ValueError(f'Cannot safely add required column {name}.{col["name"]}')
                if col['notnull'] and col['dflt_value'] is None:
                    raise ValueError(f'Cannot safely add required column {name}.{col["name"]}')
                default = '' if col['dflt_value'] is None else ' DEFAULT (' + col['dflt_value'] + ')'
                column_statements.append(f'ALTER TABLE {quote(name)} ADD COLUMN {quote(col["name"])} {col["type"]}{default};')

            desired_fks = get_foreign_keys(desired_query, name)
            actual_fks = get_foreign_keys(query, name)
            for cols, fk in desired_fks.items():
                if cols in actual_fks and actual_fks[cols] != fk:
                    raise ValueError(
                        f'Incompatible foreign key {name}({",".join(cols)}): '
                        f'actual={actual_fks[cols]} desired={fk}; inspect manually')
            for cols, fk in actual_fks.items():
                if cols not in desired_fks:
                    raise ValueError(
                        f'Unexpected foreign key {name}({",".join(cols)}) not present in desired schema: {fk}')
            missing_fks = [fk for cols, fk in desired_fks.items() if cols not in actual_fks]

            desired_uniques = get_unique_constraints(desired_query, name)
            actual_uniques = get_unique_constraints(query, name)
            extra_uniques = actual_uniques - desired_uniques
            if extra_uniques:
                raise ValueError(f'Unexpected UNIQUE constraint on {name}: {sorted(extra_uniques)}; inspect manually')
            missing_uniques = desired_uniques - actual_uniques

            desired_checks = extract_checks(table['sql'])
            actual_row = query(f"SELECT sql FROM sqlite_master WHERE type='table' AND name = '{name}'")
            actual_sql = actual_row[0]['sql'] if actual_row and actual_row[0].get('sql') else ''
            actual_checks = extract_checks(actual_sql) if actual_sql else set()
            extra_checks = actual_checks - desired_checks
            if extra_checks:
                raise ValueError(f'Unexpected CHECK constraint on {name}: {sorted(extra_checks)}; inspect manually')
            missing_checks = desired_checks - actual_checks

            if notnull_upgrades or missing_fks or missing_uniques or missing_checks:
                for col in notnull_upgrades:
                    n = audit_notnull(query, name, col)
                    if n:
                        raise ValueError(
                            f'Cannot add NOT NULL to {name}.{col}: {n} existing row(s) have NULL there; '
                            f'fix the data before migrating')
                for fk in missing_fks:
                    to_table, from_cols, to_cols, _, _ = fk
                    n = audit_fk(query, name, from_cols, to_table, to_cols)
                    if n:
                        raise ValueError(
                            f'Cannot add foreign key {name}({",".join(from_cols)}) -> '
                            f'{to_table}({",".join(to_cols)}): {n} orphan row(s) reference a missing '
                            f'{to_table} row; fix or remove them before migrating')
                for cols in missing_uniques:
                    n = audit_unique(query, name, cols)
                    if n:
                        raise ValueError(
                            f'Cannot add UNIQUE({",".join(cols)}) on {name}: {n} duplicate group(s) found; '
                            f'deduplicate before migrating')
                for expr in missing_checks:
                    n = audit_check(query, name, expr)
                    if n:
                        raise ValueError(
                            f'Cannot add CHECK ({expr}) on {name}: {n} existing row(s) violate it; '
                            f'fix the data before migrating')
                rebuild_statements, _old_name = rebuild_table_statements(name, table['sql'], actual, desired_cols)
                statements.extend(rebuild_statements)
                rebuilt_tables.add(name)
            else:
                statements.extend(column_statements)

        desired_indexes = list(desired.execute(
            "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"))
        actual_indexes = {r['name']: r for r in query(
            "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")}
        for row in desired_indexes:
            idx_name, tbl_name, idx_sql = row['name'], row['tbl_name'], row['sql']
            if tbl_name in rebuilt_tables or idx_name not in actual_indexes:
                statements.append(idx_sql + ';')
            elif normalize_sql(actual_indexes[idx_name]['sql']) != normalize_sql(idx_sql):
                raise ValueError(
                    f'Incompatible index {idx_name} on {tbl_name}: '
                    f'actual={actual_indexes[idx_name]["sql"]!r} desired={idx_sql!r}; inspect manually')

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
        conn.execute('PRAGMA foreign_keys = ON')
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
            if args.remote:
                import sys
                sys.path.insert(0,str(ROOT))
                from tools.sync_budget import require_cloud_writes
                require_cloud_writes()
            if conn:
                conn.executescript('BEGIN IMMEDIATE;\n' + sql + '\nCOMMIT;')
            else:
                wrangler(args.database, args.remote, sql, args.config)
    finally:
        if conn:
            conn.close()


if __name__ == '__main__':
    main()
