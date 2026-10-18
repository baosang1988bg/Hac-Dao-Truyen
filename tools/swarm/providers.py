"""Adapter gọi LLM đa provider bằng httpx (không dùng LiteLLM — xem plan.md).

Định dạng message nội bộ = OpenAI Chat Completions:
  {"role": "system"|"user"|"assistant"|"tool", "content": str,
   "tool_calls": [{"id", "type": "function", "function": {"name", "arguments": str}}],
   "tool_call_id": str}
Công cụ (tools) cũng theo định dạng OpenAI: {"type": "function", "function": {...}}.

- kind "openai_compat": Gemini, xAI, OpenAI, Ollama (cùng endpoint /chat/completions).
- kind "anthropic": Anthropic Messages API (chuyển đổi định dạng qua lại).
- fake responder: dùng cho test và `python -m tools.swarm demo` (không gọi mạng).
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Callable, Protocol

import httpx

from tools.swarm.budget import Budget, BudgetExceeded
from tools.swarm.config import ProviderCfg, SwarmConfig

ANTHROPIC_VERSION = "2023-06-01"


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class LLMResult:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    model_ref: str = ""
    stop_reason: str = ""

    def assistant_message(self) -> dict:
        """Message assistant (định dạng OpenAI) để nối vào lịch sử hội thoại."""
        msg: dict = {"role": "assistant", "content": self.text or ""}
        if self.tool_calls:
            msg["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.name, "arguments": json.dumps(tc.arguments, ensure_ascii=False)},
                }
                for tc in self.tool_calls
            ]
        return msg


class ProviderError(Exception):
    def __init__(self, message: str, *, status: int | None = None):
        self.status = status
        super().__init__(message)


class AllProvidersFailed(Exception):
    pass


class FakeResponder(Protocol):
    def __call__(self, role: str, model_ref: str, messages: list[dict], tools: list[dict] | None) -> LLMResult: ...


def estimate_tokens(messages: list[dict], tools: list[dict] | None = None) -> int:
    """Ước lượng thô ~3 ký tự/token (tiếng Việt + code thường tốn token hơn tiếng Anh)."""
    n = 0
    for m in messages:
        n += len(m.get("content") or "")
        for tc in m.get("tool_calls") or []:
            n += len(tc["function"]["arguments"])
    if tools:
        n += len(json.dumps(tools))
    return n // 3 + 16 * len(messages)


# ---------------------------------------------------------------- openai_compat
def _call_openai_compat(
    client: httpx.Client, prov: ProviderCfg, model: str, messages: list[dict],
    tools: list[dict] | None, temperature: float, max_tokens: int,
) -> LLMResult:
    payload: dict = {"model": model, "messages": messages, prov.max_tokens_field: max_tokens}
    if prov.send_temperature:
        payload["temperature"] = temperature
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    headers = {"Content-Type": "application/json"}
    key = prov.api_key()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    data = _post(client, prov.base_url.rstrip("/") + "/chat/completions", payload, headers)
    try:
        choice = data["choices"][0]
        msg = choice.get("message") or {}
    except (KeyError, IndexError, TypeError) as e:
        raise ProviderError(f"Phản hồi không hợp lệ: {str(data)[:300]}") from e
    calls = []
    for i, tc in enumerate(msg.get("tool_calls") or []):
        fn = tc.get("function") or {}
        calls.append(ToolCall(
            id=tc.get("id") or f"call_{i}",
            name=fn.get("name", ""),
            arguments=_parse_args(fn.get("arguments")),
        ))
    usage = data.get("usage") or {}
    return LLMResult(
        text=msg.get("content") or "",
        tool_calls=calls,
        input_tokens=int(usage.get("prompt_tokens") or 0),
        output_tokens=int(usage.get("completion_tokens") or 0),
        stop_reason=choice.get("finish_reason") or "",
    )


# ---------------------------------------------------------------- anthropic
def to_anthropic(messages: list[dict]) -> tuple[str, list[dict]]:
    system_parts: list[str] = []
    out: list[dict] = []

    def push(role: str, blocks: list[dict]) -> None:
        if out and out[-1]["role"] == role:
            out[-1]["content"].extend(blocks)
        else:
            out.append({"role": role, "content": list(blocks)})

    for m in messages:
        role = m["role"]
        if role == "system":
            system_parts.append(m.get("content") or "")
        elif role == "user":
            push("user", [{"type": "text", "text": m.get("content") or ""}])
        elif role == "assistant":
            blocks: list[dict] = []
            if m.get("content"):
                blocks.append({"type": "text", "text": m["content"]})
            for tc in m.get("tool_calls") or []:
                blocks.append({
                    "type": "tool_use", "id": tc["id"], "name": tc["function"]["name"],
                    "input": _parse_args(tc["function"]["arguments"]),
                })
            if blocks:
                push("assistant", blocks)
        elif role == "tool":
            push("user", [{
                "type": "tool_result", "tool_use_id": m["tool_call_id"],
                "content": m.get("content") or "",
            }])
    return "\n\n".join(system_parts), out


def _call_anthropic(
    client: httpx.Client, prov: ProviderCfg, model: str, messages: list[dict],
    tools: list[dict] | None, temperature: float, max_tokens: int,
) -> LLMResult:
    system, msgs = to_anthropic(messages)
    payload: dict = {"model": model, "messages": msgs, "max_tokens": max_tokens, "temperature": temperature}
    if system:
        payload["system"] = system
    if tools:
        payload["tools"] = [
            {
                "name": t["function"]["name"],
                "description": t["function"].get("description", ""),
                "input_schema": t["function"].get("parameters") or {"type": "object", "properties": {}},
            }
            for t in tools
        ]
    headers = {
        "Content-Type": "application/json",
        "x-api-key": prov.api_key() or "",
        "anthropic-version": ANTHROPIC_VERSION,
    }
    data = _post(client, prov.base_url.rstrip("/") + "/v1/messages", payload, headers)
    text_parts, calls = [], []
    for block in data.get("content") or []:
        if block.get("type") == "text":
            text_parts.append(block.get("text", ""))
        elif block.get("type") == "tool_use":
            calls.append(ToolCall(id=block["id"], name=block["name"], arguments=block.get("input") or {}))
    usage = data.get("usage") or {}
    return LLMResult(
        text="".join(text_parts),
        tool_calls=calls,
        input_tokens=int(usage.get("input_tokens") or 0),
        output_tokens=int(usage.get("output_tokens") or 0),
        stop_reason=data.get("stop_reason") or "",
    )


# ---------------------------------------------------------------- helpers
def _parse_args(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        val = json.loads(raw)
        return val if isinstance(val, dict) else {"value": val}
    except (TypeError, json.JSONDecodeError):
        return {"_raw": str(raw)}


def _post(client: httpx.Client, url: str, payload: dict, headers: dict, retries: int = 2) -> dict:
    delay = 2.0
    for attempt in range(retries + 1):
        try:
            r = client.post(url, json=payload, headers=headers)
        except httpx.HTTPError as e:
            if attempt < retries:
                time.sleep(delay)
                delay *= 2
                continue
            raise ProviderError(f"Lỗi kết nối {url.split('/')[2]}: {e.__class__.__name__}") from e
        if r.status_code in (429, 500, 502, 503, 504, 529) and attempt < retries:
            time.sleep(delay)
            delay *= 2
            continue
        if r.status_code >= 400:
            # Không in header/payload (có key); chỉ trích một đoạn thân lỗi.
            raise ProviderError(f"HTTP {r.status_code}: {r.text[:300]}", status=r.status_code)
        try:
            return r.json()
        except ValueError as e:
            raise ProviderError(f"Phản hồi không phải JSON: {r.text[:200]}") from e
    raise ProviderError("Hết lượt thử lại")  # pragma: no cover


# ---------------------------------------------------------------- router
class LLMRouter:
    """Chọn model theo chuỗi dự phòng của vai trò, kiểm ngân sách, ghi sự kiện."""

    def __init__(
        self, cfg: SwarmConfig, budget: Budget, emit: Callable[..., None],
        client: httpx.Client | None = None, fake: FakeResponder | None = None,
    ):
        self.cfg = cfg
        self.budget = budget
        self.emit = emit
        self.fake = fake
        self.client = client or httpx.Client(timeout=httpx.Timeout(cfg.run.http_timeout_s, connect=10))

    def complete(self, role: str, messages: list[dict], tools: list[dict] | None = None) -> LLMResult:
        rc = self.cfg.roles[role]
        errors: list[str] = []
        for ref in rc.models:
            prov = self.cfg.provider_for(ref)
            mcfg = self.cfg.model(ref)
            if not self.fake and not prov.has_key():
                errors.append(f"{ref}: thiếu biến {prov.api_key_env}")
                self.emit("log", agent=role, level="warn",
                          message=f"Bỏ qua {ref} — chưa đặt {prov.api_key_env}, chuyển model dự phòng")
                continue
            est_in = estimate_tokens(messages, tools)
            self.budget.ensure(mcfg, est_in, rc.max_output_tokens)  # BudgetExceeded: không fallback
            self.emit("agent_model", agent=role, model=ref, provider=prov.name)
            t0 = time.monotonic()
            try:
                if self.fake:
                    res = self.fake(role, ref, messages, tools)
                elif prov.kind == "anthropic":
                    res = _call_anthropic(self.client, prov, mcfg.model, messages, tools,
                                          rc.temperature, rc.max_output_tokens)
                elif prov.kind == "openai_compat":
                    res = _call_openai_compat(self.client, prov, mcfg.model, messages, tools,
                                              rc.temperature, rc.max_output_tokens)
                else:
                    raise ProviderError(f"kind '{prov.kind}' không hỗ trợ")
            except ProviderError as e:
                errors.append(f"{ref}: {e}")
                self.emit("log", agent=role, level="warn", message=f"{ref} lỗi: {e} — thử model dự phòng")
                continue
            if not res.input_tokens:
                res.input_tokens = est_in
            if not res.output_tokens:
                res.output_tokens = max(1, (len(res.text) + sum(len(json.dumps(c.arguments)) for c in res.tool_calls)) // 3)
            res.model_ref = ref
            cost = self.budget.charge(role, mcfg, res.input_tokens, res.output_tokens)
            self.emit(
                "llm_call", agent=role, model=ref, input_tokens=res.input_tokens,
                output_tokens=res.output_tokens, cost=round(cost, 6),
                seconds=round(time.monotonic() - t0, 2), budget=self.budget.snapshot(),
            )
            return res
        raise AllProvidersFailed(f"Vai trò {role}: mọi model đều lỗi — " + " | ".join(errors))


__all__ = [
    "AllProvidersFailed", "BudgetExceeded", "LLMResult", "LLMRouter", "ProviderError",
    "ToolCall", "estimate_tokens", "to_anthropic",
]
