"""Quản lý các run (mỗi run một thread + EventBus + GateController)."""
from __future__ import annotations

import datetime as _dt
import re
import secrets
import shutil
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path

from tools.swarm.budget import Budget
from tools.swarm.config import SwarmConfig
from tools.swarm.demo import DemoResponder, fake_check_runner
from tools.swarm.events import EventBus
from tools.swarm.pipeline import GateController, Pipeline
from tools.swarm.providers import FakeResponder, LLMRouter
from tools.swarm.workspace import git


RUN_ID_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{4}$")
# Run nạp lại từ log mà chưa có run_finished = tiến trình đã chết giữa chừng.
INTERRUPTED = "interrupted"


@dataclass
class Run:
    id: str
    request: str
    bus: EventBus
    gates: GateController
    budget: Budget
    pipeline: Pipeline | None = None
    thread: threading.Thread | None = None
    demo: bool = False
    created: str = field(default_factory=lambda: _dt.datetime.now().isoformat(timespec="seconds"))

    @property
    def alive(self) -> bool:
        return bool(self.thread and self.thread.is_alive())

    @property
    def readonly(self) -> bool:
        """Run nạp từ đĩa: chỉ xem được, không duyệt/huỷ được."""
        return self.pipeline is None

    def summary(self) -> dict:
        s = self.bus.state
        return {"id": self.id, "request": self.request, "status": s["status"], "created": self.created,
                "branch": s.get("branch"), "demo": self.demo, "spent": self.budget.spent}


def _created_from_id(run_id: str) -> str:
    try:
        return _dt.datetime.strptime(run_id[:15], "%Y%m%d-%H%M%S").isoformat(timespec="seconds")
    except ValueError:
        return ""


class RunManager:
    def __init__(self, cfg: SwarmConfig, repo: Path, runs_dir: Path | None = None):
        self.cfg = cfg
        self.repo = Path(repo)
        self.runs_dir = runs_dir or (self.repo / ".swarm" / "runs")
        self.runs: dict[str, Run] = {}
        self._lock = threading.Lock()

    def create(self, request: str, *, budget_usd: float | None = None, base_ref: str = "HEAD",
               fake: FakeResponder | None = None, demo: bool = False, auto_approve: bool = False,
               start: bool = True) -> Run:
        request = (request or "").strip()
        if not request:
            raise ValueError("Thiếu mô tả tính năng")
        with self._lock:
            if any(r.alive and not r.demo for r in self.runs.values()) and not demo:
                raise RuntimeError("Đang có một run thật chạy — chờ xong hoặc huỷ trước khi chạy run mới")
        run_id = _dt.datetime.now().strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(2)
        bus = EventBus(run_id, self.runs_dir / run_id / "events.jsonl")
        gates = GateController(bus, auto_approve=auto_approve)
        budget = Budget(budget_usd if budget_usd is not None else self.cfg.run.budget_usd)
        repo = self.repo
        if demo:
            fake = fake or DemoResponder()
            repo = _demo_clone(self.repo)
        router = LLMRouter(self.cfg, budget, bus.emit, fake=fake)
        pipe = Pipeline(self.cfg, bus, repo, request, gates, budget, router, base_ref=base_ref)
        if demo:
            pipe.demo = True
            _patch_demo_checks(pipe)
        th = threading.Thread(target=pipe.run, name=f"swarm-{run_id}", daemon=True)
        run = Run(run_id, request, bus, gates, budget, pipe, th, demo=demo)
        pipe.meta = {"created": run.created}
        with self._lock:
            self.runs[run_id] = run
        if start:
            th.start()
        return run

    def get(self, run_id: str) -> Run | None:
        with self._lock:
            run = self.runs.get(run_id)
        if run:
            return run
        run = self._load(run_id)
        if not run:
            return None
        with self._lock:  # gọi song song → giữ bản nạp trước
            return self.runs.setdefault(run_id, run)

    def _load(self, run_id: str) -> Run | None:
        """Dựng lại run (chỉ đọc) từ ``events.jsonl`` của một lần chạy trước."""
        if not RUN_ID_RE.match(run_id or ""):
            return None
        log_file = self.runs_dir / run_id / "events.jsonl"
        if not log_file.is_file():
            return None
        bus = EventBus.load(run_id, log_file)
        s = bus.state
        if s.get("result") is None:
            # Không có run_finished → tiến trình đã dừng giữa chừng. Chỉ đánh dấu trong
            # bộ nhớ (bus.load không ghi file) để dashboard đóng gate và tắt nút Huỷ.
            bus.emit("run_finished", status=INTERRUPTED, branch=s.get("branch"), worktree=s.get("worktree"),
                     error="Tiến trình swarm đã dừng giữa chừng (tắt server/máy) — run không thể tiếp tục",
                     budget=s.get("budget") or {}, next_steps=[])
        b = s.get("budget") or {}
        budget = Budget(b.get("limit", self.cfg.run.budget_usd))
        budget.spent = float(b.get("spent", 0.0) or 0.0)
        return Run(run_id, s.get("request", ""), bus, GateController(bus), budget,
                   demo=bool(s.get("demo", False)),
                   created=s.get("created") or _created_from_id(run_id))

    def list(self) -> list[dict]:
        with self._lock:
            out = {rid: r.summary() for rid, r in self.runs.items()}
        if self.runs_dir.is_dir():
            for p in self.runs_dir.iterdir():
                if p.name in out or not p.is_dir():
                    continue
                run = self._load(p.name)  # chỉ lấy tóm tắt, không giữ cả log trong RAM
                if run:
                    out[p.name] = run.summary()
        return [out[k] for k in sorted(out, reverse=True)]

    def cancel(self, run_id: str) -> bool:
        with self._lock:
            run = self.runs.get(run_id)
        if not run or run.readonly or run.bus.state.get("result") is not None:
            return False
        run.gates.cancelled.set()
        return True


def _demo_clone(repo: Path) -> Path:
    """Demo chạy trên bản clone tạm → không tạo nhánh trong repo thật."""
    tmp = Path(tempfile.mkdtemp(prefix="swarm-demo-"))
    dst = tmp / "repo"
    git(repo, "clone", "-q", "--local", "--no-hardlinks", str(git(repo, "rev-parse", "--show-toplevel").strip()), str(dst))
    git(dst, "config", "core.longpaths", "true")
    return dst


def _patch_demo_checks(pipe: Pipeline) -> None:
    orig_prepare = pipe.prepare

    def prepare():
        orig_prepare()
        pipe.sb.run_check = fake_check_runner()  # type: ignore[method-assign]
    pipe.prepare = prepare  # type: ignore[method-assign]


def cleanup_demo(run: Run) -> None:
    wt = run.bus.state.get("worktree")
    if run.demo and wt:
        shutil.rmtree(Path(wt).parents[1], ignore_errors=True)
