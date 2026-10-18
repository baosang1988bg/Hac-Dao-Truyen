"""EventBus: nguồn sự thật cho dashboard (SSE) và nhật ký JSONL của mỗi run."""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

AGENT_STATUSES = ("idle", "running", "reviewing", "waiting", "completed", "failed", "skipped")
MAX_ARTIFACT_CHARS = 200_000


class EventBus:
    def __init__(self, run_id: str, log_path: Path | None = None):
        self.run_id = run_id
        self.log_path = log_path
        self._events: list[dict] = []
        self._cond = threading.Condition()
        self.state: dict = {
            "run_id": run_id,
            "status": "starting",
            "request": "",
            "agents": {},
            "gates": {},
            "artifacts": {},
            "budget": {},
            "result": None,
        }
        if log_path:
            log_path.parent.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------ emit
    def emit(self, type_: str, **data) -> dict:
        with self._cond:
            ev = {"seq": len(self._events) + 1, "ts": time.time(), "type": type_, **data}
            if type_ == "artifact" and len(ev.get("content") or "") > MAX_ARTIFACT_CHARS:
                ev["content"] = ev["content"][:MAX_ARTIFACT_CHARS] + "\n…(cắt bớt)"
            self._events.append(ev)
            self._reduce(ev)
            if self.log_path:
                with self.log_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(ev, ensure_ascii=False) + "\n")
            self._cond.notify_all()
            return ev

    def _reduce(self, ev: dict) -> None:
        s, t = self.state, ev["type"]
        if t == "run_started":
            s.update(status="running", request=ev.get("request", ""), budget=ev.get("budget", {}),
                     branch=ev.get("branch"), worktree=ev.get("worktree"), feature=ev.get("feature"))
            for role, info in (ev.get("agents") or {}).items():
                s["agents"][role] = {"status": "idle", **info}
        elif t == "agent_status":
            a = s["agents"].setdefault(ev["agent"], {})
            a["status"] = ev["status"]
            if ev.get("detail") is not None:
                a["detail"] = ev["detail"]
        elif t == "agent_model":
            a = s["agents"].setdefault(ev["agent"], {})
            a["model"], a["provider"] = ev["model"], ev["provider"]
        elif t == "llm_call":
            s["budget"] = ev.get("budget", s["budget"])
        elif t == "artifact":
            s["artifacts"][ev["name"]] = {"path": ev.get("path"), "content": ev.get("content", "")}
        elif t == "gate_opened":
            s["gates"][ev["gate"]] = {"status": "open", "title": ev.get("title"), "artifacts": ev.get("artifacts", []),
                                      "message": ev.get("message", "")}
            s["status"] = "waiting"
        elif t == "gate_resolved":
            g = s["gates"].setdefault(ev["gate"], {})
            g.update(status=ev["decision"], feedback=ev.get("feedback", ""))
            s["status"] = "running"
        elif t == "budget_changed":
            s["budget"] = ev.get("budget", s["budget"])
        elif t == "run_finished":
            s["status"] = ev.get("status", "finished")
            s["result"] = {k: v for k, v in ev.items() if k not in ("seq", "ts", "type")}

    # ------------------------------------------------------------ read
    def since(self, seq: int) -> list[dict]:
        with self._cond:
            return self._events[seq:]

    def wait_since(self, seq: int, timeout: float = 15.0) -> list[dict]:
        with self._cond:
            if len(self._events) <= seq:
                self._cond.wait(timeout)
            return self._events[seq:]

    def snapshot(self) -> dict:
        with self._cond:
            return json.loads(json.dumps(self.state, ensure_ascii=False))

    @property
    def last_seq(self) -> int:
        with self._cond:
            return len(self._events)
