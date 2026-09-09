import base64
import json
from pathlib import Path
import restore_from_cloudflare as restore


def test_restore_bundle_and_failed_download_never_publish_partial(tmp_path, monkeypatch):
    name = 'Chương 1 - Mở đầu_VI.md'
    encoded = base64.urlsafe_b64encode(name.encode()).decode().rstrip('=')
    objects = {
        'demo/bundles/manifest.json': json.dumps({name:'demo/bundles/bundle-0001.json'}),
        'demo/bundles/bundle-0001.json': json.dumps({encoded:'# Chương 1\n\nNội dung'}),
    }
    def download(key, path):
        Path(path).write_text(objects.get(key, 'partial'), encoding='utf-8')
        return key in objects
    monkeypatch.setattr(restore, 'download_r2_object', download)
    chapter = {'filename':name, 'r2_key':'demo/missing.md'}
    dest = tmp_path / name
    assert restore.restore_chapter('demo',chapter,dest)
    assert dest.read_text() == '# Chương 1\n\nNội dung'
    objects.clear()
    assert not restore.restore_chapter('demo',chapter,dest)
    assert dest.read_text() == '# Chương 1\n\nNội dung'
    objects['demo/missing.md'] = 'standalone'
    assert restore.restore_chapter('demo',chapter,dest)
    assert dest.read_text() == 'standalone'


def test_partial_restore_preserves_checkpoint_and_reports_failure(tmp_path, monkeypatch):
    state = tmp_path / 'state.json'
    old = {'demo': {'total_synced': 1}, 'other': {'total_synced': 4}}
    state.write_text(json.dumps(old))
    monkeypatch.setattr(restore, 'SYNC_STATE_PATH', state)
    monkeypatch.setattr(restore, 'safe_novel_dir', lambda slug: str(tmp_path / slug))
    chapters = [{'filename': '1.md', 'chapter_number': 1, 'r2_key': 'demo/1'}]
    monkeypatch.setattr(restore, 'query_d1', lambda sql: [{'slug': 'demo', 'title': 'Demo'}] if sql == 'SELECT * FROM novels;' else chapters)
    monkeypatch.setattr(restore, 'download_r2_object', lambda *args: False)
    monkeypatch.setattr(restore, 'restore_chapter', lambda *args: False)
    assert restore.restore() is False
    assert json.loads(state.read_text()) == old
