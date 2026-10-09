import json

from tools import auto_check_novel, publish_range


def test_publish_range_publishes_queue_then_good_chapters_in_range(tmp_path, monkeypatch):
    trans = tmp_path / "novels" / "t" / "translated"
    trans.mkdir(parents=True)
    (tmp_path / "novels" / "t" / "novel.json").write_text(json.dumps({"title": "T"}), encoding="utf-8")
    for n, body in [(1185, "cũ"), (1186, "tốt"), (1187, "[Translation failed]"), (1188, "tốt"), (1684, "ngoài khoảng")]:
        (trans / f"Chương {n} - X_VI.md").write_text(f"# Chương {n}: X\n{body}\n", encoding="utf-8")
    monkeypatch.setattr(auto_check_novel, "NOVELS_DIR", tmp_path / "novels")
    calls = []
    monkeypatch.setattr(auto_check_novel, "publish_republish_queue", lambda slug, meta: calls.append("queue") or True)
    monkeypatch.setattr(auto_check_novel, "sync_via_worker_api",
                        lambda slug, meta, pending, base: calls.append([c["number"] for c in pending]) or True)

    assert publish_range.publish(slug="t", first=1186, last=1683) is True
    # Bản lỗi (1187) không được đẩy; chương ngoài khoảng không đụng tới.
    assert calls == ["queue", [1186, 1188]]
