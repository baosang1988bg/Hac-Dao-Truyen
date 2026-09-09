from pathlib import Path
import json
import migrate_to_cloudflare as migrate


def test_failed_upload_does_not_publish_chapters_delete_or_advance_state(tmp_path, monkeypatch):
    monkeypatch.setenv('HACDAO_ALLOW_CLOUD_WRITES','true')
    novels=tmp_path/'source'
    root=novels/'demo'
    (root/'translated').mkdir(parents=True)
    (root/'novel.json').write_text(json.dumps({'title':'Demo'}))
    (root/'translated'/'Chương 1.md').write_text('# Chương 1\n\nBody')
    monkeypatch.setattr(migrate,'NOVELS_DIR',novels)
    monkeypatch.setattr(migrate,'r2_get_glossary',lambda slug:{})
    sql=[]
    monkeypatch.setattr(migrate,'d1_file',lambda text,*args:sql.append(text) or True)
    monkeypatch.setattr(migrate,'r2_put',lambda *args:False)
    states=[]
    monkeypatch.setattr(migrate,'update_novel_sync',lambda *args:states.append(args))
    assert migrate.migrate_novel('demo') is False
    assert not any('INSERT INTO chapters' in text or 'DELETE FROM chapters' in text for text in sql)
    assert not states
    # Retry a previously uploaded object still repairs missing D1 rows.
    monkeypatch.setattr(migrate,'r2_exists',lambda key:True)
    monkeypatch.setattr(migrate,'get_novel_sync_info',lambda slug:{})
    monkeypatch.setattr(migrate,'get_synced_filenames',lambda slug:{'Chương 1.md'})
    assert migrate.migrate_novel('demo',resume=True) is True
    assert any('INSERT INTO chapters' in text for text in sql)
    assert len(states)==1
