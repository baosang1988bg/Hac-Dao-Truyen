"""migrate_to_cloudflare.py --edition: đọc/kiểm tra bản dịch phụ, chia lô, dry-run.
KHÔNG gọi mạng — phần gửi dùng hàm send giả."""
import json

import pytest

import migrate_to_cloudflare as migrate

META = {'name': 'Bản dịch nhóm A', 'translator': 'Nhóm A', 'kind': 'human',
        'license_note': 'Nhóm A cho phép đăng (email 2026-11-20)', 'published': True}


def make_edition(tmp_path, meta=None, chapters=None, slug='demo', code='nhom-a'):
    ed = tmp_path / slug / 'editions' / code
    (ed / 'translated').mkdir(parents=True)
    if meta is not False:
        (ed / 'edition.json').write_text(json.dumps(META if meta is None else meta, ensure_ascii=False), encoding='utf-8')
    for name, body in (chapters if chapters is not None else
                       [('0002_chuong-2_VI.md', '# Chương 2: Hai\n\nB'), ('0001_chuong-1_VI.md', '# Chương 1: Một\n\nA'),
                        ('ghi-chu.txt', 'bỏ qua')]):
        (ed / 'translated' / name).write_text(body, encoding='utf-8')
    return tmp_path


def test_load_edition_reads_meta_and_vi_files_in_order(tmp_path):
    root = make_edition(tmp_path)
    meta, chapters = migrate.load_edition('demo', 'nhom-a', root)
    assert meta == {'code': 'nhom-a', **META}
    assert [c['number'] for c in chapters] == [1, 2]
    assert chapters[0] == {'filename': '0001_chuong-1_VI.md', 'title': 'Chương 1: Một', 'number': 1,
                           'content': '# Chương 1: Một\n\nA'}


@pytest.mark.parametrize('code', ['he-thong', 'Nhom-A', 'a_b', 'a' * 41, '', 'x\n'])
def test_rejects_bad_or_default_code(tmp_path, code):
    with pytest.raises(ValueError):
        migrate.load_edition('demo', code, make_edition(tmp_path))


@pytest.mark.parametrize('patch,msg', [
    ({'license_note': ''}, 'license_note'),
    ({'license_note': '   '}, 'license_note'),
    ({'kind': 'pirate'}, 'kind'),
    ({'published': 'yes'}, 'published'),
    ({'name': ''}, 'name'),
])
def test_rejects_invalid_meta(tmp_path, patch, msg):
    root = make_edition(tmp_path, meta={**META, **patch})
    with pytest.raises(ValueError, match=msg):
        migrate.load_edition('demo', 'nhom-a', root)


def test_missing_license_note_key_and_missing_files(tmp_path):
    meta = {k: v for k, v in META.items() if k != 'license_note'}
    with pytest.raises(ValueError, match='license_note'):
        migrate.load_edition('demo', 'nhom-a', make_edition(tmp_path / 'a', meta=meta))
    with pytest.raises(ValueError, match='edition.json'):
        migrate.load_edition('demo', 'nhom-a', make_edition(tmp_path / 'b', meta=False))
    with pytest.raises(ValueError, match='_VI.md'):
        migrate.load_edition('demo', 'nhom-a', make_edition(tmp_path / 'c', chapters=[]))
    with pytest.raises(ValueError, match='rỗng'):
        migrate.load_edition('demo', 'nhom-a', make_edition(tmp_path / 'd', chapters=[('0001_c_VI.md', '  ')]))


def test_payloads_split_by_25_and_2mib():
    meta = {'code': 'nhom-a', **META}
    chapters = [{'filename': f'{i:04d}_VI.md', 'title': f'Chương {i}', 'number': i, 'content': 'x'} for i in range(1, 61)]
    payloads = migrate.build_edition_payloads('demo', meta, chapters)
    assert [len(p['chapters']) for p in payloads] == [25, 25, 10]
    assert all(p['edition'] == meta and p['slug'] == 'demo' for p in payloads)
    assert migrate.estimate_edition_ops(payloads) == {'chunks': 3, 'chapters': 60, 'r2_writes': 60, 'd1_rows': 4 * 60 + 15}

    big = [{'filename': f'{i}_VI.md', 'title': 't', 'number': i, 'content': 'é' * 400_000} for i in range(1, 6)]
    sized = migrate.build_edition_payloads('demo', meta, big)
    assert len(sized) > 1
    for p in sized:
        assert len(json.dumps(p, ensure_ascii=False).encode('utf-8')) <= migrate.EDITION_MAX_BYTES
    with pytest.raises(ValueError, match='2 MiB'):
        migrate.build_edition_payloads('demo', meta, [{'filename': 'a_VI.md', 'title': 't', 'number': 1,
                                                        'content': 'x' * (2 * 1024 * 1024)}])


def test_dry_run_never_calls_send(tmp_path, capsys):
    root = make_edition(tmp_path)

    def boom(*a, **kw):
        raise AssertionError('dry-run không được gửi')

    assert migrate.sync_edition('demo', 'nhom-a', dry_run=True, novels_dir=root, send=boom) is True
    out = capsys.readouterr().out
    assert 'dry-run' in out and '2 chương' in out and 'Giấy phép' in out


def test_send_uses_edition_path_and_stops_on_failure(tmp_path):
    root = make_edition(tmp_path)
    calls = []

    def fake_send(conn, payload, **kw):
        calls.append((payload, kw))
        return {'success': True}, None

    assert migrate.sync_edition('demo', 'nhom-a', novels_dir=root, host='h', sync_key='k', budget=object(), send=fake_send)
    assert len(calls) == 1
    payload, kw = calls[0]
    assert kw['path'] == '/api/sync/edition' and kw['sync_key'] == 'k' and kw['host'] == 'h'
    assert payload['edition']['code'] == 'nhom-a' and len(payload['chapters']) == 2

    def failing(conn, payload, **kw):
        return {'success': False, 'error': 'HTTP 503'}, None

    assert migrate.sync_edition('demo', 'nhom-a', novels_dir=root, host='h', sync_key='k', budget=object(), send=failing) is False
    assert migrate.sync_edition('demo', 'he-thong', dry_run=True, novels_dir=root) is False


def test_send_chunk_path_defaults_to_sync_novel(monkeypatch):
    from tools import sync_transport as st
    seen = []

    class Res:
        status = 200

        def getheader(self, _):
            return None

    def fake_request(conn, path, body, **kw):
        seen.append(path)
        return conn, Res(), '{"success": true}'

    class Budget:
        def try_reserve(self, r2, d1):
            return True

    monkeypatch.setattr(st, 'send_sync_request', fake_request)
    payload = {'slug': 'demo', 'chapters': [{'filename': 'a'}]}
    st.send_chunk(None, payload, host='h', sync_key='k', budget=Budget())
    st.send_chunk(None, payload, host='h', sync_key='k', budget=Budget(), path='/api/sync/edition')
    assert seen == ['/api/admin/sync-novel', '/api/sync/edition']
