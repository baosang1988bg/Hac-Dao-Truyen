"""Test nạp lại lịch sử run từ .swarm/runs/*/events.jsonl (RunManager.get/list)."""
import json

import pytest
from fastapi.testclient import TestClient

from tools.swarm.config import load_config
from tools.swarm.events import EventBus
from tools.swarm.runs import INTERRUPTED, RunManager
from tools.swarm.server import create_app

H = {"X-Swarm-Token": "tok"}
RID_DONE = "20261018-210000-aaaa"
RID_HALTED = "20261018-220000-abcd"
RID_EARLY_FAIL = "20261018-230000-beef"
RID_BROKEN = "20261018-235959-0001"


def _log(runs_dir, rid, *events):
    bus = EventBus(rid, runs_dir / rid / "events.jsonl")
    for t, kw in events:
        bus.emit(t, **kw)
    return bus


@pytest.fixture
def runs_dir(tmp_path):
    d = tmp_path / "runs"
    _log(d, RID_DONE,
         ("run_started", {"request": "Xong rồi", "branch": "feature/001-a", "budget": {"limit": 2, "spent": 0},
                          "demo": True, "created": "2026-10-18T21:00:00"}),
         ("gate_opened", {"gate": "spec", "title": "Duyệt spec"}),
         ("gate_resolved", {"gate": "spec", "decision": "approve"}),
         ("run_finished", {"status": "completed", "budget": {"limit": 2, "spent": 0.12}}))
    _log(d, RID_HALTED,
         ("run_started", {"request": "Thêm nút X", "branch": "feature/007-x", "worktree": "/w/x",
                          "budget": {"limit": 2, "spent": 0.31}}),
         ("gate_opened", {"gate": "spec", "title": "Duyệt spec"}))
    _log(d, RID_EARLY_FAIL, ("run_finished", {"status": "failed", "error": "no key"}))
    p = d / RID_BROKEN / "events.jsonl"
    p.parent.mkdir(parents=True)
    p.write_text(
        json.dumps({"seq": 1, "ts": 0, "type": "run_started", "request": "r", "branch": "b"}) + "\n"
        "{hỏng\n\n"
        + json.dumps({"seq": 3, "ts": 0, "type": "run_finished", "status": "completed"}) + "\n",
        encoding="utf-8")
    (d / "rác").mkdir()
    return d


@pytest.fixture
def mgr(tmp_path, runs_dir):
    return RunManager(load_config(), tmp_path, runs_dir=runs_dir)


def test_list_reads_history_sorted_with_metadata(mgr):
    runs = mgr.list()
    assert [r["id"] for r in runs] == [RID_BROKEN, RID_EARLY_FAIL, RID_HALTED, RID_DONE]
    by = {r["id"]: r for r in runs}
    assert by[RID_DONE]["demo"] is True and by[RID_DONE]["created"] == "2026-10-18T21:00:00"
    # log cũ không có cờ demo → KHÔNG đoán là demo, kể cả khi chưa có nhánh
    assert by[RID_EARLY_FAIL]["demo"] is False and by[RID_HALTED]["demo"] is False
    # log cũ không có created → suy từ run_id, không lấy giờ đọc file
    assert by[RID_HALTED]["created"] == "2026-10-18T22:00:00"
    assert by[RID_HALTED]["spent"] == pytest.approx(0.31)
    # list() chỉ đọc tóm tắt, không giữ run cũ trong bộ nhớ
    assert mgr.runs == {}


def test_halted_run_becomes_interrupted_without_touching_log(mgr, runs_dir):
    log = runs_dir / RID_HALTED / "events.jsonl"
    before = log.read_bytes()
    run = mgr.get(RID_HALTED)
    s = run.bus.state
    assert run.readonly and not run.alive
    assert s["status"] == INTERRUPTED and s["result"]["status"] == INTERRUPTED
    assert s["gates"]["spec"]["status"] == INTERRUPTED  # gate không còn "open"
    assert run.gates.pending() == []
    assert mgr.cancel(RID_HALTED) is False
    assert log.read_bytes() == before
    assert mgr.get(RID_HALTED) is run  # lần sau lấy từ cache


def test_finished_run_kept_as_is(mgr):
    run = mgr.get(RID_DONE)
    assert run.bus.state["status"] == "completed"
    assert run.bus.state["gates"]["spec"]["status"] == "approve"


def test_broken_line_skipped_and_seq_renumbered(mgr):
    run = mgr.get(RID_BROKEN)
    assert run.bus.last_seq == 2
    assert [e["seq"] for e in run.bus.since(0)] == [1, 2]
    assert run.bus.since(1)[0]["type"] == "run_finished"


@pytest.mark.parametrize("bad", ["..", "../runs", "x", "20261018-220000-ABCD", "20261018-220000-abcd/.."])
def test_invalid_run_id_rejected(mgr, bad):
    assert mgr.get(bad) is None


def test_api_on_history_run(mgr):
    c = TestClient(create_app(mgr, token="tok", port=8765))
    assert c.get("/api/runs", headers=H).json()[0]["id"] == RID_BROKEN
    st = c.get(f"/api/runs/{RID_HALTED}", headers=H).json()
    assert st["state"]["status"] == INTERRUPTED and st["pending_gates"] == []
    assert c.post(f"/api/runs/{RID_HALTED}/gates/spec", json={"decision": "approve"}, headers=H).status_code == 409
    assert c.post(f"/api/runs/{RID_HALTED}/cancel", headers=H).status_code == 409
    assert c.get("/api/runs/20991231-000000-ffff", headers=H).status_code == 404
    # SSE của run lịch sử phát lại toàn bộ rồi đóng (không treo vì thread giả)
    with c.stream("GET", f"/api/runs/{RID_HALTED}/events?token=tok") as r:
        body = "".join(r.iter_text())
    assert "event: end" in body and INTERRUPTED in body


def test_new_run_persists_demo_and_created(tmp_repo, tmp_path):
    """Run mới ghi demo/created vào log → server khởi động lại vẫn nhận đúng."""
    import time
    d = tmp_path / "runs2"
    m1 = RunManager(load_config(), tmp_repo, runs_dir=d)
    run = m1.create("Demo lưu metadata", demo=True)
    run.pipeline.router.fake.delay = 0
    end = time.monotonic() + 10
    while "spec" not in run.gates.pending():
        assert time.monotonic() < end, "Hết thời gian chờ gate spec"
        time.sleep(0.02)
    assert m1.cancel(run.id) is True
    run.thread.join(10)
    assert m1.cancel(run.id) is False  # đã kết thúc
    again = RunManager(load_config(), tmp_repo, runs_dir=d).get(run.id)
    assert again.demo is True and again.created == run.created
    assert again.bus.state["status"] == "cancelled"
