"""Provider giả lập cho `python -m tools.swarm demo` và test — không gọi mạng, không tốn tiền."""
from __future__ import annotations

import re
import threading
import time

from tools.swarm.providers import LLMResult, ToolCall, estimate_tokens


class DemoResponder:
    """Trả lời có kịch bản theo vai trò; mô phỏng cả vòng QA yêu cầu sửa một lần."""

    def __init__(self, delay: float = 0.8, qa_rejects_first: bool = True):
        self.delay = delay
        self.qa_rejects_first = qa_rejects_first
        self._qa_calls = 0
        self._lock = threading.Lock()

    def __call__(self, role: str, model_ref: str, messages: list[dict], tools: list[dict] | None) -> LLMResult:
        if self.delay:
            time.sleep(self.delay)
        handler = getattr(self, f"_{role}")
        res = handler(messages)
        res.input_tokens = estimate_tokens(messages, tools)
        res.output_tokens = max(50, len(res.text) // 3 + 60 * len(res.tool_calls))
        return res

    # ------------------------------------------------------------ roles
    def _spec(self, messages):
        req = re.search(r"YÊU CẦU TÍNH NĂNG:\n(.*?)\n\n", messages[1]["content"], re.S)
        req = req.group(1).strip() if req else "tính năng demo"
        revised = any(m["role"] == "user" and m["content"].startswith("Sửa spec") for m in messages[2:])
        note = "\n\n> Đã cập nhật theo góp ý của bạn." if revised else ""
        return LLMResult(text=f"""# Feature Specification: {req}

**Status**: Draft (DEMO — sinh bởi provider giả lập){note}

## User Scenarios & Testing

### User Story 1 — {req} (Priority: P1)
Người đọc muốn {req.lower()} để thao tác nhanh hơn trên mobile.

**Acceptance Scenarios**
1. **Given** trang chi tiết truyện, **When** người dùng thao tác, **Then** hệ thống phản hồi trong < 100 ms.

## Requirements
- **FR-001**: Hệ thống PHẢI hỗ trợ {req.lower()}.
- **FR-002**: Có aria-label tiếng Việt, dùng được bằng bàn phím.

## Success Criteria
- **SC-001**: `npm run lint` sạch, test mới pass.
""")

    def _architect(self, messages):
        return LLMResult(text="""<<<PLAN>>>
# Implementation Plan (DEMO)

## Kiến trúc
- Thêm ghi chú demo trong thư mục spec; không đổi code sản phẩm.

## Constitution Check
- Không thêm dependency. Không chạm production. ✅
<<<TASKS>>>
# Tasks (DEMO)

- [ ] T001 Ghi file demo.md trong thư mục spec — specs/<feature>/demo.md
- [ ] T002 Chạy cổng chất lượng (lint)
""")

    def _coder(self, messages):
        user = messages[1]["content"]
        m = re.search(r"theo (\S+)/tasks\.md", user)
        feat = m.group(1) if m else "specs/demo"
        n_tool = sum(1 for x in messages if x["role"] == "tool")
        fixing = "VIỆC CẦN SỬA THÊM" in user
        steps = [
            ("read_file", {"path": f"{feat}/tasks.md"}),
            ("write_file", {"path": f"{feat}/demo.md",
                            "content": "# Demo\n\nFile do Coder (giả lập) tạo.\n"
                                       + ("\nĐã thêm phần xử lý edge case theo QA.\n" if fixing else "")}),
            ("run_check", {"name": "lint"}),
            ("finish", {"summary": "Đã sửa theo QA." if fixing else "Đã tạo demo.md và chạy lint."}),
        ]
        name, args = steps[min(n_tool, len(steps) - 1)]
        text = {0: "Đọc tasks.md trước khi làm.", 1: "Viết file theo T001.", 2: "Kiểm tra lint."}.get(n_tool, "")
        return LLMResult(text=text, tool_calls=[ToolCall(id=f"call_{n_tool}", name=name, arguments=args)])

    def _qa(self, messages):
        with self._lock:
            self._qa_calls += 1
            first = self._qa_calls == 1
        if first and self.qa_rejects_first:
            return LLMResult(text="""{"verdict": "changes_requested",
 "summary": "Thiếu xử lý edge case khi danh sách rỗng (giả lập).",
 "findings": [{"severity": "high", "file": "demo.md", "line": 1,
   "issue": "Chưa mô tả trường hợp danh sách chương rỗng", "suggestion": "Bổ sung đoạn xử lý edge case"}]}""")
        return LLMResult(text='{"verdict": "pass", "summary": "Ổn, không còn vấn đề nghiêm trọng (giả lập).", "findings": []}')

    def _healer(self, messages):
        n_tool = sum(1 for x in messages if x["role"] == "tool")
        if n_tool == 0:
            return LLMResult(text="", tool_calls=[ToolCall(id="h0", name="run_check", arguments={"name": "lint"})])
        return LLMResult(text="", tool_calls=[ToolCall(id="h1", name="finish", arguments={"summary": "Lint đã sạch."})])


def fake_check_runner(delay: float = 0.6):
    """Thay Sandbox.run_check trong demo: luôn PASS, không cần npm."""
    def run_check(name: str):
        time.sleep(delay)
        return True, f"[{name}] exit 0 (DEMO — không chạy thật)"
    return run_check
