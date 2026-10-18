"""End-to-end pipeline với provider giả lập + server API."""
import subprocess
import time
from pathlib import Path

from fastapi.testclient import TestClient

from tools.swarm.budget import Budget
from tools.swarm.config import load_config
from tools.swarm.demo import DemoResponder, fake_check_runner
from tools.swarm.events import EventBus
from tools.swarm.pipeline import GateController, Pipeline, parse_qa, split_plan_tasks
from tools.swarm.providers import LLMRouter
from tools.swarm.runs import RunManager
from tools.swarm.server import create_app


def make_pipeline(repo, *, budget=2.0, auto=True, qa_rejects_first=True):
    cfg = load_config()
    cfg.run.worktree_root = "../wt"
    bus = EventBus("t")
    gates = GateController(bus, auto_approve=auto)
    b = Budget(budget)
    router = LLMRouter(cfg, b, bus.emit, fake=DemoResponder(delay=0, qa_rejects_first=qa_rejects_first))
    pipe = Pipeline(cfg, bus, repo, "Thêm nút chia sẻ chương", gates, b, router)
    orig = pipe.prepare

    def prepare():
        orig()
        pipe.sb.run_check = fake_check_runner(0)
    pipe.prepare = prepare
    return pipe, bus, gates


def test_full_run_commits_on_feature_branch(tmp_repo):
    pipe, bus, _ = make_pipeline(tmp_repo)
    pipe.run()
    s = bus.snapshot()
    assert s["status"] == "completed", s["result"]
    res = s["result"]
    assert res["commit"] and res["branch"] == "feature/001-them-nut-chia-se-chuong"
    wt = Path(res["worktree"])
    for name in ("spec.md", "plan.md", "tasks.md", "demo.md"):
        assert (wt / "specs/001-them-nut-chia-se-chuong" / name).is_file()
    assert not (wt / ".env").exists()  # worktree không có secret
    # repo gốc vẫn ở main, không bị đổi
    head = subprocess.run(["git", "branch", "--show-current"], cwd=tmp_repo, capture_output=True, text=True).stdout
    assert head.strip() == "main"
    types = [e["type"] for e in bus.since(0)]
    assert types.count("gate_opened") == 2 and "handoff" in types
    assert any(e["type"] == "handoff" and e["src"] == "qa" for e in bus.since(0))  # QA yêu cầu sửa 1 vòng
    assert s["budget"]["spent"] > 0
    assert s["agents"]["healer"]["status"] == "skipped"


def test_revise_then_stop(tmp_repo):
    pipe, bus, gates = make_pipeline(tmp_repo, auto=False)
    import threading
    th = threading.Thread(target=pipe.run)
    th.start()
    _wait(lambda: "spec" in gates.pending())
    assert gates.resolve("spec", "revise", "Thêm Zalo")
    _wait(lambda: "spec" in gates.pending())
    assert "Đã cập nhật theo góp ý" in bus.snapshot()["artifacts"]["spec.md"]["content"]
    gates.resolve("spec", "approve")
    _wait(lambda: "plan" in gates.pending())
    gates.resolve("plan", "stop")
    th.join(10)
    assert bus.snapshot()["status"] == "stopped"


def test_budget_gate(tmp_repo):
    pipe, bus, gates = make_pipeline(tmp_repo, budget=0.01, auto=False)
    import threading
    th = threading.Thread(target=pipe.run)
    th.start()
    _wait(lambda: "budget" in gates.pending())
    gates.resolve("budget", "stop")
    th.join(10)
    assert bus.snapshot()["status"] == "stopped"


def test_cancel(tmp_repo):
    pipe, bus, gates = make_pipeline(tmp_repo, auto=False)
    import threading
    th = threading.Thread(target=pipe.run)
    th.start()
    _wait(lambda: "spec" in gates.pending())
    gates.cancelled.set()
    th.join(10)
    assert bus.snapshot()["status"] == "cancelled"


def test_parsers():
    assert parse_qa('```json\n{"verdict":"pass","findings":[]}\n```')["verdict"] == "pass"
    assert parse_qa("không phải json")["verdict"] == "unknown"
    plan, tasks = split_plan_tasks("<<<PLAN>>>\n# P\n<<<TASKS>>>\n- [ ] T001 x")
    assert plan == "# P" and tasks == "- [ ] T001 x"
    plan, tasks = split_plan_tasks("# Plan\n- [ ] T001 a\n- [x] T002 b")
    assert "T001" in tasks and "T002" in tasks


def test_server_auth_host_and_demo_run(tmp_repo, tmp_path):
    mgr = RunManager(load_config(), tmp_repo, runs_dir=tmp_path / "runs")
    c = TestClient(create_app(mgr, token="tok", port=8765))
    assert c.get("/api/config").status_code == 401
    assert c.get("/api/config", headers={"X-Swarm-Token": "bad"}).status_code == 401
    assert c.get("/", headers={"host": "evil.example:8765"}).status_code == 403
    assert "HacDao" in c.get("/").text
    H = {"X-Swarm-Token": "tok"}
    assert "SECRET" not in c.get("/api/config", headers=H).text
    rid = c.post("/api/runs", json={"request": "Demo nhỏ", "demo": True}, headers=H).json()["id"]
    run = mgr.get(rid)
    run.pipeline.router.fake.delay = 0
    _wait(lambda: "spec" in run.gates.pending())
    assert c.post(f"/api/runs/{rid}/gates/spec", json={"decision": "revise", "feedback": ""}, headers=H).status_code == 422
    assert c.post(f"/api/runs/{rid}/gates/spec", json={"decision": "hack"}, headers=H).status_code == 422
    assert c.post(f"/api/runs/{rid}/gates/plan", json={"decision": "approve"}, headers=H).status_code == 409
    assert c.post(f"/api/runs/{rid}/cancel", headers=H).status_code == 200
    run.thread.join(10)
    st = c.get(f"/api/runs/{rid}", headers=H).json()["state"]
    assert st["status"] == "cancelled"
    # demo chạy trên bản clone tạm → repo thật không có nhánh feature mới
    branches = subprocess.run(["git", "branch", "--list", "feature/*"], cwd=tmp_repo, capture_output=True, text=True).stdout
    assert branches.strip() == ""


def _wait(pred, timeout=10.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred():
            return
        time.sleep(0.02)
    raise AssertionError("Hết thời gian chờ")
