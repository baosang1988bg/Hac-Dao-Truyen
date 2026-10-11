import json
from pathlib import Path
from tools import manage_auto_check


def test_add_and_remove_tracked(tmp_path, monkeypatch):
    novels_dir = tmp_path / "novels"
    novel_dir = novels_dir / "test-novel"
    novel_dir.mkdir(parents=True)
    novel_json = novel_dir / "novel.json"
    novel_json.write_text(json.dumps({
        "slug": "test-novel",
        "title": "Test Novel",
        "source_url": "https://www.novel543.com/123456/dir",
        "last_chapter_number": 100,
    }), encoding="utf-8")

    monkeypatch.setattr(manage_auto_check, "NOVELS_DIR", novels_dir)

    # Test add with automatic url normalization
    ok = manage_auto_check.add_tracked("test-novel")
    assert ok is True

    data = json.loads(novel_json.read_text(encoding="utf-8"))
    assert data["auto_check"]["enabled"] is True
    assert data["auto_check"]["source_index_url"] == "https://www.novel543.com/123456/"

    # Test remove
    ok = manage_auto_check.remove_tracked("test-novel")
    assert ok is True

    data = json.loads(novel_json.read_text(encoding="utf-8"))
    assert data["auto_check"]["enabled"] is False


def test_add_tracked_with_explicit_url(tmp_path, monkeypatch):
    novels_dir = tmp_path / "novels"
    novel_dir = novels_dir / "test-novel-2"
    novel_dir.mkdir(parents=True)
    novel_json = novel_dir / "novel.json"
    novel_json.write_text(json.dumps({
        "slug": "test-novel-2",
        "title": "Test Novel 2",
    }), encoding="utf-8")

    monkeypatch.setattr(manage_auto_check, "NOVELS_DIR", novels_dir)

    ok = manage_auto_check.add_tracked("test-novel-2", "https://example.com/custom-index/")
    assert ok is True

    data = json.loads(novel_json.read_text(encoding="utf-8"))
    assert data["auto_check"]["enabled"] is True
    assert data["auto_check"]["source_index_url"] == "https://example.com/custom-index/"
