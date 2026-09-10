"""Test hành vi SyncBudget của batch_cloud_syncer.py: dừng ngay khi hết ngân
sách (không xử lý tiếp truyện khác kể cả trong cùng batch, kể cả khi bật
--watch), và bắt buộc opt-in ghi cloud qua require_cloud_writes()."""
import importlib
import json
import sys

import pytest


def _make_novel_dir(base, slug):
    d = base / slug
    d.mkdir()
    (d / "novel.json").write_text(json.dumps({"slug": slug, "title": slug}), encoding="utf-8")
    (d / "translated").mkdir()
    return d


@pytest.fixture
def module(monkeypatch):
    monkeypatch.setenv("HACDAO_SYNC_KEY", "test-only")
    mod = importlib.import_module("tools.batch_cloud_syncer")
    importlib.reload(mod)
    return mod


def test_budget_exceeded_stops_immediately_and_ignores_watch(tmp_path, monkeypatch, module):
    monkeypatch.setenv("HACDAO_ALLOW_CLOUD_WRITES", "true")
    _make_novel_dir(tmp_path, "a_novel")
    _make_novel_dir(tmp_path, "b_novel")

    calls = []

    def fake_sync(novel_dir, budget=None):
        calls.append(novel_dir.name)
        if len(calls) == 1:
            return {
                "slug": novel_dir.name,
                "success": False,
                "budget_exceeded": True,
                "error": "Hết ngân sách được cấu hình; chưa gửi request",
            }
        # Nếu bị gọi lần thứ 2 trở đi nghĩa là script KHÔNG dừng ngay -> lỗi.
        return {"slug": novel_dir.name, "success": True, "chapters": 1}

    monkeypatch.setattr(module, "sync_single_novel", fake_sync)
    monkeypatch.setattr(
        sys, "argv",
        ["batch-sync", "--dir", str(tmp_path), "--workers", "1", "--watch"],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    assert exc.value.code == 1
    assert calls == [calls[0]]
    assert len(calls) == 1


def test_require_cloud_writes_blocks_without_network_calls(tmp_path, monkeypatch, module):
    monkeypatch.delenv("HACDAO_ALLOW_CLOUD_WRITES", raising=False)
    _make_novel_dir(tmp_path, "a_novel")

    def fail_sync(*args, **kwargs):
        pytest.fail("Không được gọi sync khi ghi cloud đang bị chặn")

    monkeypatch.setattr(module, "sync_single_novel", fail_sync)
    monkeypatch.setattr(
        sys, "argv",
        ["batch-sync", "--dir", str(tmp_path), "--workers", "1"],
    )

    with pytest.raises(SystemExit) as exc:
        module.main()

    assert exc.value.code == 1


def test_happy_path_runs_when_budget_and_opt_in_ok(tmp_path, monkeypatch, module):
    monkeypatch.setenv("HACDAO_ALLOW_CLOUD_WRITES", "true")
    _make_novel_dir(tmp_path, "a_novel")

    calls = []

    def fake_sync(novel_dir, budget=None):
        calls.append(novel_dir.name)
        return {"slug": novel_dir.name, "success": True, "chapters": 3}

    monkeypatch.setattr(module, "sync_single_novel", fake_sync)
    monkeypatch.setattr(
        sys, "argv",
        ["batch-sync", "--dir", str(tmp_path), "--workers", "1"],
    )

    module.main()

    assert calls == ["a_novel"]
    state = json.loads((tmp_path / ".cloud_sync_state.json").read_text(encoding="utf-8"))
    assert state["synced_slugs"] == ["a_novel"]
