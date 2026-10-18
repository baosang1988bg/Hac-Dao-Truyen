"""Quản lý các run (mỗi run một thread + EventBus + GateController)."""
from __future__ import annotations

import datetime as _dt
import json
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

    def summary(self) -> dict:
        s = self.bus.state
        return {"id": self.id, "request": self.request, "status": s["status"], "created": self.created,
                "branch": s.get("branch"), "demo": self.demo, "spent": self.budget.spent}


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
            if any(r.thread.is_alive() and not r.demo for r in self.runs.values()) and not demo:
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
        with self._lock:
            self.runs[run_id] = run
        if start:
            th.start()
        return run

    def get(self, run_id: str) -> Run | None:
        with self._lock:
            if run_id in self.runs:
                return self.runs[run_id]
        log_file = self.runs_dir / run_id / "events.jsonl"
        if not log_file.is_file():
            return None
        bus = EventBus(run_id, log_file)
        with log_file.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.strip():
                    try:
                        ev = json.loads(line)
                        bus._events.append(ev)
                        bus._reduce(ev)
                    except Exception:
                        pass
        s = bus.state
        spent = s.get("budget", {}).get("spent", 0.0)
        budget = Budget(s.get("budget", {}).get("limit", self.cfg.run.budget_usd))
        budget.spent = spent
        gates = GateController(bus)
        dummy_th = threading.Thread(target=lambda: None)
        run = Run(run_id, s.get("request", ""), bus, gates, budget, None, dummy_th,
                  demo=bool("[demo]" in s.get("request", "") or "demo" in run_id or not s.get("branch")))
        with self._lock:
            self.runs[run_id] = run
        return run

    def list(self) -> list[dict]:
        with self._lock:
            active_ids = set(self.runs.keys())
        if self.runs_dir.is_dir():
            for p in self.runs_dir.iterdir():
                if p.is_dir() and p.name not in active_ids:
                    if (p / "events.jsonl").is_file():
                        self.get(p.name)
        with self._lock:
            return [r.summary() for r in sorted(self.runs.values(), key=lambda r: r.id, reverse=True)]

    def cancel(self, run_id: str) -> bool:
        run = self.runs.get(run_id)
        if not run:
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
