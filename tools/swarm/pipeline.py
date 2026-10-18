"""Orchestrator: Spec → [duyệt] → Plan/Tasks → [duyệt] → Code → QA → Heal → Converge → commit."""
from __future__ import annotations

import datetime as _dt
import json
import re
import threading
import traceback
from pathlib import Path
from typing import Callable

from tools.swarm import prompts
from tools.swarm.budget import Budget, BudgetExceeded
from tools.swarm.config import SwarmConfig
from tools.swarm.context import pack_context, repo_map
from tools.swarm.events import EventBus
from tools.swarm.providers import AllProvidersFailed, LLMResult, LLMRouter
from tools.swarm.sandbox import Sandbox, tool_defs
from tools.swarm.workspace import Workspace, create_workspace

AGENT_ORDER = ("lead", "spec", "architect", "coder", "qa", "healer")
CODER_TOOLS = ["list_files", "read_file", "search", "write_file", "edit_file", "run_check", "finish"]
HEALER_TOOLS = ["read_file", "edit_file", "run_check", "finish"]
KEEP_RECENT_MESSAGES = 14
OLD_TOOL_RESULT_CHARS = 600
MAX_DIFF_CHARS = 120_000


class Cancelled(Exception):
    pass


class StopRequested(Exception):
    pass


# ---------------------------------------------------------------- gates
class GateController:
    """Điểm dừng chờ người duyệt. Dashboard (hoặc CLI) gọi resolve()."""

    def __init__(self, bus: EventBus, auto_approve: bool = False):
        self.bus = bus
        self.auto_approve = auto_approve
        self._lock = threading.Lock()
        self._waiting: dict[str, threading.Event] = {}
        self._answers: dict[str, tuple[str, str]] = {}
        self.cancelled = threading.Event()

    def open(self, gate: str, title: str, artifacts: list[str], message: str = "") -> tuple[str, str]:
        ev = threading.Event()
        with self._lock:
            self._waiting[gate] = ev
            self._answers.pop(gate, None)
        self.bus.emit("gate_opened", gate=gate, title=title, artifacts=artifacts, message=message)
        if self.auto_approve:
            self.resolve(gate, "approve", "")
        while not ev.wait(0.5):
            if self.cancelled.is_set():
                raise Cancelled()
        with self._lock:
            self._waiting.pop(gate, None)
            return self._answers.pop(gate)

    def resolve(self, gate: str, decision: str, feedback: str = "") -> bool:
        if decision not in ("approve", "revise", "stop"):
            raise ValueError("decision phải là approve | revise | stop")
        with self._lock:
            ev = self._waiting.get(gate)
            if not ev or ev.is_set():
                return False
            self._answers[gate] = (decision, feedback or "")
            ev.set()
        self.bus.emit("gate_resolved", gate=gate, decision=decision, feedback=feedback or "")
        return True

    def pending(self) -> list[str]:
        with self._lock:
            return [g for g, e in self._waiting.items() if not e.is_set()]


# ---------------------------------------------------------------- pipeline
class Pipeline:
    def __init__(
        self, cfg: SwarmConfig, bus: EventBus, repo: Path, request: str, gates: GateController,
        budget: Budget, router: LLMRouter, base_ref: str = "HEAD",
        workspace_factory: Callable[..., Workspace] = create_workspace,
    ):
        self.cfg, self.bus, self.repo, self.request = cfg, bus, Path(repo), request.strip()
        self.gates, self.budget, self.router, self.base_ref = gates, budget, router, base_ref
        self.workspace_factory = workspace_factory
        self.ws: Workspace | None = None
        self.sb: Sandbox | None = None
        self.checks: dict[str, bool] = {}
        self.qa_report: dict = {}
        self.demo = False

    # ------------------------------------------------------------ helpers
    def emit(self, type_: str, **kw) -> None:
        self.bus.emit(type_, **kw)

    def log(self, agent: str, message: str, level: str = "info") -> None:
        self.emit("log", agent=agent, level=level, message=message)

    def status(self, agent: str, status: str, detail: str | None = None) -> None:
        if detail is None and status != "running":
            detail = ""  # xoá dòng "Chờ duyệt…" cũ khi chuyển trạng thái
        self.emit("agent_status", agent=agent, status=status, detail=detail)

    def handoff(self, src: str, dst: str, message: str) -> None:
        self.emit("handoff", src=src, dst=dst, message=message)

    def check_cancel(self) -> None:
        if self.gates.cancelled.is_set():
            raise Cancelled()

    def llm(self, role: str, messages: list[dict], tools: list[dict] | None = None) -> LLMResult:
        while True:
            self.check_cancel()
            try:
                return self.router.complete(role, messages, tools)
            except BudgetExceeded as e:
                prev = self.bus.state["agents"].get(role, {}).get("status")
                self.status(role, "waiting", "Chờ duyệt ngân sách")
                decision, fb = self.gates.open(
                    "budget", "Sắp vượt ngân sách",
                    artifacts=[],
                    message=(f"Đã dùng ${e.spent:.3f}/${e.limit:.2f}. Lời gọi tiếp theo ({e.model}) "
                             f"có thể tốn tới ~${e.needed:.3f}. Duyệt = tăng thêm (mặc định $1, "
                             f"hoặc ghi số tiền vào ô góp ý); Dừng = kết thúc run."),
                )
                if decision != "approve":
                    raise StopRequested("Dừng vì ngân sách") from e
                try:
                    delta = float(re.findall(r"\d+(?:\.\d+)?", fb)[0]) if fb else 1.0
                except (IndexError, ValueError):
                    delta = 1.0
                self.budget.raise_limit(max(delta, e.needed))
                self.emit("budget_changed", budget=self.budget.snapshot())
                self.log("lead", f"Ngân sách tăng thêm ${max(delta, e.needed):.2f}")
                if prev:
                    self.status(role, prev)

    def read_template(self, name: str) -> str:
        p = self.ws.path / ".specify" / "templates" / name
        return p.read_text(encoding="utf-8") if p.is_file() else ""

    def write_artifact(self, name: str, content: str) -> Path:
        path = self.ws.spec_dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content.strip() + "\n", encoding="utf-8", newline="\n")
        rel = path.relative_to(self.ws.path).as_posix()
        self.emit("artifact", name=name, path=rel, content=content)
        return path

    # ------------------------------------------------------------ run
    def run(self) -> None:
        try:
            self.status("lead", "running", "Chuẩn bị worktree")
            self.prepare()
            self.stage_spec()
            self.stage_plan()
            self.stage_implement()
            self.stage_qa()
            self.stage_converge()
            self.finish("completed" if all(self.checks.values()) else "checks_failed")
        except Cancelled:
            self.finish("cancelled")
        except StopRequested as e:
            self.log("lead", str(e), "warn")
            self.finish("stopped")
        except AllProvidersFailed as e:
            self.log("lead", str(e), "error")
            self.finish("failed", error=str(e))
        except Exception as e:  # noqa: BLE001 — báo mọi lỗi lên dashboard
            self.log("lead", "".join(traceback.format_exception(e))[-3000:], "error")
            self.finish("failed", error=f"{e.__class__.__name__}: {e}")

    def prepare(self) -> None:
        self.ws = self.workspace_factory(
            self.repo, self.request, self.cfg.run.worktree_root, self.cfg.run.branch_prefix, self.base_ref
        )
        self.sb = Sandbox(self.ws.path)
        agents = {"lead": {"title": "Orchestrator", "models": ["(điều phối)"]}}
        for role in AGENT_ORDER[1:]:
            rc = self.cfg.roles[role]
            agents[role] = {"title": rc.title, "models": rc.models,
                            "model": rc.models[0], "provider": rc.models[0].split("/", 1)[0]}
        self.emit("run_started", request=self.request, branch=self.ws.branch, worktree=str(self.ws.path),
                  feature=self.ws.feature, budget=self.budget.snapshot(), agents=agents)
        self.status("lead", "running")
        self.log("lead", f"Tạo nhánh {self.ws.branch} tại {self.ws.path}")

    # ------------------------------------------------------------ spec
    def stage_spec(self) -> None:
        rc = self.cfg.roles["spec"]
        self.handoff("lead", "spec", "Khảo sát codebase và viết spec.md")
        self.status("spec", "running", "Đóng gói ngữ cảnh codebase")
        rmap = repo_map(self.sb)
        ctx, used = pack_context(self.sb, self.request, rc.context_budget_tokens)
        self.log("spec", f"Ngữ cảnh: {len(used)} file (~{len(ctx) // 3:,} token)")
        messages = [
            {"role": "system", "content": prompts.SPEC_SYSTEM},
            {"role": "user", "content": prompts.spec_user(
                self.request, self.read_template("spec-template.md"), rmap, ctx,
                _dt.date.today().isoformat(), self.ws.branch)},
        ]
        for rev in range(self.cfg.run.max_revisions + 1):
            self.status("spec", "running", "Viết spec.md" if rev == 0 else f"Sửa spec lần {rev}")
            res = self.llm("spec", messages)
            spec = _strip_fence(res.text)
            self.write_artifact("spec.md", spec)
            self.status("spec", "waiting", "Chờ bạn duyệt spec.md")
            decision, fb = self.gates.open("spec", "Duyệt đặc tả (spec.md)", ["spec.md"])
            if decision == "approve":
                self.status("spec", "completed")
                return
            if decision == "stop":
                self.status("spec", "skipped")
                raise StopRequested("Người dùng dừng ở bước Spec")
            messages += [res.assistant_message(),
                         {"role": "user", "content": f"Sửa spec theo góp ý sau, trả lại TOÀN BỘ spec.md:\n{fb}"}]
        raise StopRequested("Quá số lần sửa spec")

    # ------------------------------------------------------------ plan
    def stage_plan(self) -> None:
        rc = self.cfg.roles["architect"]
        spec = (self.ws.spec_dir / "spec.md").read_text(encoding="utf-8")
        self.handoff("spec", "architect", "Bàn giao spec.md đã duyệt")
        self.status("architect", "running", "Lập plan.md + tasks.md")
        ctx, used = pack_context(self.sb, self.request + "\n" + spec[:4000], rc.context_budget_tokens)
        messages = [
            {"role": "system", "content": prompts.ARCH_SYSTEM},
            {"role": "user", "content": prompts.arch_user(
                self.request, spec, self.read_template("plan-template.md"),
                self.read_template("tasks-template.md"), repo_map(self.sb), ctx)},
        ]
        for rev in range(self.cfg.run.max_revisions + 1):
            if rev:
                self.status("architect", "running", f"Sửa plan lần {rev}")
            res = self.llm("architect", messages)
            plan, tasks = split_plan_tasks(res.text)
            self.write_artifact("plan.md", plan)
            self.write_artifact("tasks.md", tasks)
            self.status("architect", "waiting", "Chờ bạn duyệt plan.md + tasks.md")
            decision, fb = self.gates.open("plan", "Duyệt kế hoạch + danh sách task", ["plan.md", "tasks.md"])
            if decision == "approve":
                self.status("architect", "completed")
                return
            if decision == "stop":
                self.status("architect", "skipped")
                raise StopRequested("Người dùng dừng ở bước Plan")
            messages += [res.assistant_message(),
                         {"role": "user", "content": f"Sửa theo góp ý, trả lại đủ 2 phần đúng định dạng:\n{fb}"}]
        raise StopRequested("Quá số lần sửa plan")

    # ------------------------------------------------------------ agent loop
    def agent_loop(self, role: str, system: str, user: str, tools: list[str], max_steps: int) -> str:
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        defs = tool_defs(tools)
        for _step in range(1, max_steps + 1):
            self.check_cancel()
            _compact(messages)
            res = self.llm(role, messages, defs)
            messages.append(res.assistant_message())
            if res.text.strip():
                self.log(role, res.text.strip()[:600])
            if not res.tool_calls:
                return res.text.strip() or "(không có tóm tắt)"
            summary = None
            for tc in res.tool_calls:
                if tc.name == "finish":
                    summary = str(tc.arguments.get("summary", "")).strip() or "(xong)"
                    out = "OK"
                else:
                    self.status(role, "running", f"{tc.name} {_short_args(tc.arguments)}")
                    out = self.sb.execute(tc.name, tc.arguments)
                    level = "warn" if out.startswith(("BỊ CHẶN", "LỖI", "FAIL")) else "info"
                    first = out.splitlines()[0][:160] if out else ""
                    self.log(role, f"⚙ {tc.name}({_short_args(tc.arguments)}) → {first}", level)
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": out})
            if summary is not None:
                return summary
        self.log(role, f"Hết {max_steps} bước tool-calling", "warn")
        return "(dừng vì hết số bước)"

    # ------------------------------------------------------------ implement
    def feature_rel(self) -> str:
        return self.ws.spec_dir.relative_to(self.ws.path).as_posix()

    def stage_implement(self, extra: str = "", label: str = "Triển khai tasks.md", src: str = "architect") -> str:
        self.handoff(src, "coder", label)
        self.status("coder", "running", label)
        summary = self.agent_loop("coder", prompts.CODER_SYSTEM, prompts.coder_user(self.feature_rel(), extra),
                                  CODER_TOOLS, self.cfg.run.max_coder_steps)
        self.log("coder", f"Tóm tắt: {summary}")
        self.emit("artifact", name="diff", path=None, content=self.ws.diff()[:MAX_DIFF_CHARS])
        self.status("coder", "completed", summary[:200])
        return summary

    # ------------------------------------------------------------ qa
    def stage_qa(self) -> None:
        for rnd in range(self.cfg.run.max_qa_rounds + 1):
            self.handoff("coder", "qa", "Bàn giao diff để phản biện")
            self.status("qa", "reviewing", f"Phản biện vòng {rnd + 1}")
            spec = (self.ws.spec_dir / "spec.md").read_text(encoding="utf-8")
            tasks = (self.ws.spec_dir / "tasks.md").read_text(encoding="utf-8")
            diff = self.ws.diff()
            if len(diff) > MAX_DIFF_CHARS:
                diff = diff[:MAX_DIFF_CHARS] + "\n…(diff bị cắt)"
            res = self.llm("qa", [{"role": "system", "content": prompts.QA_SYSTEM},
                                  {"role": "user", "content": prompts.qa_user(spec, tasks, diff)}])
            report = parse_qa(res.text)
            self.qa_report = report
            self.emit("artifact", name="qa_report.json", path=None,
                      content=json.dumps(report, ensure_ascii=False, indent=2))
            blocking = [f for f in report["findings"] if f.get("severity") in ("critical", "high")]
            self.log("qa", f"{report['verdict']}: {report.get('summary', '')} "
                           f"({len(report['findings'])} finding, {len(blocking)} nghiêm trọng)",
                     "warn" if blocking else "info")
            if not blocking or rnd == self.cfg.run.max_qa_rounds:
                self.status("qa", "completed" if not blocking else "failed",
                            None if not blocking else "Còn finding nghiêm trọng sau số vòng tối đa")
                return
            self.status("qa", "waiting", "Chờ Coder sửa")
            self.stage_implement(extra=json.dumps(blocking, ensure_ascii=False, indent=2),
                                 label=f"Sửa theo QA vòng {rnd + 1}", src="qa")

    # ------------------------------------------------------------ converge
    def needed_checks(self) -> list[str]:
        changed = self.ws.changed_files()
        checks = ["lint", "test_frontend"]
        if any(f.startswith("src/") or f.startswith("tests/worker/") for f in changed):
            checks.append("test_worker")
        if any(f.endswith(".py") for f in changed):
            checks.append("test_python")
        if any(f.startswith("frontend/") for f in changed):
            checks.append("build_frontend")
        return checks

    def run_checks(self) -> dict[str, tuple[bool, str]]:
        results = {}
        for name in self.needed_checks():
            self.check_cancel()
            self.status("lead", "running", f"Cổng chất lượng: {name}")
            ok, out = self.sb.run_check(name)
            results[name] = (ok, out)
            self.log("lead", f"{'✅' if ok else '❌'} {name}", "info" if ok else "warn")
        self.checks = {k: v[0] for k, v in results.items()}
        self.emit("checks", results={k: v[0] for k, v in results.items()})
        return results

    def stage_converge(self) -> None:
        results = self.run_checks()
        if "lint" in results and not results["lint"][0]:
            self.handoff("lead", "healer", "Lint đỏ — nhờ Healer sửa")
            self.status("healer", "running", "Sửa lỗi lint")
            summary = self.agent_loop("healer", prompts.HEALER_SYSTEM, prompts.healer_user(results["lint"][1]),
                                      HEALER_TOOLS, 12)
            self.status("healer", "completed", summary[:200])
            results = self.run_checks()
        else:
            self.status("healer", "skipped", "Lint xanh, không cần")
        for rnd in range(self.cfg.run.max_fix_rounds):
            failing = {k: out for k, (ok, out) in results.items() if not ok}
            if not failing:
                break
            extra = "\n\n".join(f"### {k}\n{out[-3000:]}" for k, out in failing.items())
            self.stage_implement(extra=f"Các cổng kiểm tra đang đỏ:\n{extra}",
                                 label=f"Sửa cổng kiểm tra vòng {rnd + 1}", src="lead")
            results = self.run_checks()

    # ------------------------------------------------------------ finish
    def finish(self, status: str, error: str | None = None) -> None:
        commit, diff_stat = None, ""
        if self.ws:
            try:
                diff_stat = self.ws.diff(stat=True)
                if status in ("completed", "checks_failed"):
                    tag = "" if status == "completed" else " [WIP: checks failed]"
                    commit = self.ws.commit(
                        f"feat({self.ws.feature}): {self.request[:60]}{tag}\n\n"
                        f"Sinh bởi /speckit-auto. Chi phí: ${self.budget.spent:.3f}.")
            except Exception as e:  # noqa: BLE001
                self.log("lead", f"Không commit được: {e}", "error")
        for role in AGENT_ORDER:
            st = self.bus.state["agents"].get(role, {}).get("status")
            if st in ("running", "waiting", "reviewing"):
                self.status(role, "failed" if status == "failed" else "idle")
        self.status("lead", "completed" if status == "completed" else ("failed" if status == "failed" else "idle"))
        next_steps = []
        if self.ws and commit and self.demo:
            next_steps = [f"# DEMO: chạy trên bản clone tạm {self.ws.repo}, không ảnh hưởng repo thật — xoá thoải mái"]
        elif self.ws and commit:
            next_steps = [
                f"cd {self.ws.path}",
                "git log -1 --stat   # review",
                f"git push -u origin {self.ws.branch}   # tự push sau khi review",
                f"# Dọn worktree sau khi merge: git worktree remove {self.ws.path}",
            ]
        self.emit("run_finished", status=status, error=error, branch=self.ws.branch if self.ws else None,
                  worktree=str(self.ws.path) if self.ws else None, commit=commit, diff_stat=diff_stat,
                  checks=self.checks, qa=self.qa_report, budget=self.budget.snapshot(), next_steps=next_steps)


# ---------------------------------------------------------------- pure helpers
def _strip_fence(text: str) -> str:
    t = text.strip()
    m = re.match(r"^```(?:markdown|md)?\s*\n(.*)\n```\s*$", t, re.S)
    return m.group(1) if m else t


def split_plan_tasks(text: str) -> tuple[str, str]:
    t = text.strip()
    m = re.search(r"<<<PLAN>>>(.*?)<<<TASKS>>>(.*)$", t, re.S)
    if m:
        return _strip_fence(m.group(1)), _strip_fence(m.group(2))
    lines = [ln for ln in t.splitlines() if re.match(r"^\s*- \[[ xX]\]", ln)]
    tasks = "# Tasks\n\n" + ("\n".join(lines) if lines else "- [ ] T001 Triển khai theo plan.md")
    return _strip_fence(t), tasks


def parse_qa(text: str) -> dict:
    t = _strip_fence(text.replace("```json", "```"))
    start, end = t.find("{"), t.rfind("}")
    data: dict = {}
    if start != -1 and end > start:
        try:
            data = json.loads(t[start:end + 1])
        except json.JSONDecodeError:
            data = {}
    if not isinstance(data, dict) or "verdict" not in data:
        return {"verdict": "unknown", "summary": "QA trả về không đúng JSON — bỏ qua vòng sửa.",
                "findings": [], "raw": text[:2000]}
    findings = data.get("findings") if isinstance(data.get("findings"), list) else []
    data["findings"] = [f for f in findings if isinstance(f, dict)]
    return data


def _short_args(args: dict) -> str:
    for k in ("path", "name", "pattern"):
        if k in args:
            return str(args[k])[:80]
    return ""


def _compact(messages: list[dict]) -> None:
    """Rút gọn kết quả tool cũ để hội thoại không phình (tiết kiệm token)."""
    cutoff = len(messages) - KEEP_RECENT_MESSAGES
    for m in messages[2:max(2, cutoff)]:
        if m.get("role") == "tool" and len(m.get("content") or "") > OLD_TOOL_RESULT_CHARS:
            m["content"] = m["content"][:OLD_TOOL_RESULT_CHARS] + "\n…(kết quả cũ đã rút gọn — đọc lại nếu cần)"
