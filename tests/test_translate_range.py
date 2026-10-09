import json

import pytest

from tools import auto_check_novel, translate_range


def _catalog(tmp_path, monkeypatch):
    novel_dir = tmp_path / "novels" / "t"
    novel_dir.mkdir(parents=True)
    items = [{"number": n, "url": f"https://x/{i}"} for i, n in enumerate([1678, 1679, 1684, 1685, 1686], start=1)]
    (novel_dir / "catalog.json").write_text(json.dumps(items), encoding="utf-8")
    monkeypatch.setattr(auto_check_novel, "NOVELS_DIR", tmp_path / "novels")


def test_catalog_range_to_end(tmp_path, monkeypatch):
    _catalog(tmp_path, monkeypatch)
    assert [c["number"] for c in translate_range.catalog_range("t", "https://x/3", None)] == [1684, 1685, 1686]


def test_catalog_range_limited(tmp_path, monkeypatch):
    _catalog(tmp_path, monkeypatch)
    assert [c["number"] for c in translate_range.catalog_range("t", "https://x/2", 2)] == [1679, 1684]


def test_catalog_range_unknown_url(tmp_path, monkeypatch):
    _catalog(tmp_path, monkeypatch)
    with pytest.raises(SystemExit):
        translate_range.catalog_range("t", "https://x/99", None)


def test_untranslated_numbers_skips_good_and_keeps_failed(tmp_path, monkeypatch):
    trans = tmp_path / "novels" / "t" / "translated"
    trans.mkdir(parents=True)
    (trans / "Chương 1684 - A_VI.md").write_text("# Chương 1684: A\nnội dung\n", encoding="utf-8")
    (trans / "Chương 1685 - B_VI.md").write_text("# Chương 1685: B\n[Translation failed]\n", encoding="utf-8")
    monkeypatch.setattr(auto_check_novel, "NOVELS_DIR", tmp_path / "novels")

    assert translate_range.untranslated_numbers("t", [1684, 1685, 1686]) == [1685, 1686]


def test_main_publishes_republish_queue_before_range(tmp_path, monkeypatch):
    novel_dir = tmp_path / "novels" / "t"
    trans = novel_dir / "translated"
    trans.mkdir(parents=True)
    (novel_dir / "catalog.json").write_text(json.dumps([{"number": 1684, "url": "https://x/1"}]), encoding="utf-8")
    (novel_dir / "novel.json").write_text(json.dumps({"title": "T"}), encoding="utf-8")
    (trans / "Chương 1684 - A_VI.md").write_text("# Chương 1684: A\nđã sửa tên\n", encoding="utf-8")
    monkeypatch.setattr(auto_check_novel, "NOVELS_DIR", tmp_path / "novels")
    calls = []
    monkeypatch.setattr(auto_check_novel, "publish_republish_queue", lambda slug, meta: calls.append("queue") or True)
    monkeypatch.setattr(auto_check_novel, "sync_via_worker_api", lambda *a: calls.append("range") or True)
    monkeypatch.setattr("sys.argv", ["x", "--slug", "t", "--url", "https://x/1"])

    translate_range.main()

    # Chương đã đăng mà đổi nội dung phải đi hàng đợi (kèm expected_r2_key)
    # TRƯỚC, nếu không đợt đẩy thường bị Worker trả 409.
    assert calls == ["queue", "range"]
